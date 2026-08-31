package com.frutostropicales.rutacontrol;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LocationTrackingService extends Service {
    public static final String ACTION_START = "com.frutostropicales.rutacontrol.START_TRACKING";
    public static final String EXTRA_TRIP_ID = "trip_id";
    public static final String EXTRA_SUPABASE_URL = "supabase_url";
    public static final String EXTRA_PUBLISHABLE_KEY = "publishable_key";
    public static final String EXTRA_ACCESS_TOKEN = "access_token";
    public static final String EXTRA_REFRESH_TOKEN = "refresh_token";

    private static final String CHANNEL_ID = "route_tracking";
    private static final int NOTIFICATION_ID = 4378;
    private static final String PREFS = "native_route_tracking";
    private static final long LOCATION_INTERVAL_MS = 1000L;
    private static final long MIN_LOCATION_INTERVAL_MS = 750L;
    private static final long NETWORK_INTERVAL_MS = 1250L;
    private static final float MIN_DISTANCE_METERS = 2f;
    private static final float MAX_ACCURACY_METERS = 35f;
    private static final float MAX_SPEED_METERS_PER_SECOND = 60f;

    public interface LocationListener {
        void onLocation(JSObject point);
    }

    private static volatile boolean running = false;
    private static volatile JSObject lastPoint;
    private static volatile LocationListener locationListener;

    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private FusedLocationProviderClient locationClient;
    private LocationCallback locationCallback;
    private SharedPreferences preferences;
    private Location lastAcceptedLocation;
    private long lastPublishedAt = 0L;
    private long lastNotificationAt = 0L;

    public static void setLocationListener(LocationListener listener) {
        locationListener = listener;
        if (listener != null && lastPoint != null) listener.onLocation(lastPoint);
    }

    public static boolean isRunning() {
        return running;
    }

    public static JSObject getLastPoint() {
        return lastPoint;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        preferences = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        locationClient = LocationServices.getFusedLocationProviderClient(this);
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                for (Location location : result.getLocations()) acceptLocation(location);
            }
        };
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_START.equals(intent.getAction())) saveConfiguration(intent);
        if (!hasConfiguration()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification("Conectando con el GPS…"));
        startLocationUpdates();
        running = true;
        return START_STICKY;
    }

    private void saveConfiguration(Intent intent) {
        preferences.edit()
            .putString(EXTRA_TRIP_ID, intent.getStringExtra(EXTRA_TRIP_ID))
            .putString(EXTRA_SUPABASE_URL, intent.getStringExtra(EXTRA_SUPABASE_URL))
            .putString(EXTRA_PUBLISHABLE_KEY, intent.getStringExtra(EXTRA_PUBLISHABLE_KEY))
            .putString(EXTRA_ACCESS_TOKEN, intent.getStringExtra(EXTRA_ACCESS_TOKEN))
            .putString(EXTRA_REFRESH_TOKEN, intent.getStringExtra(EXTRA_REFRESH_TOKEN))
            .apply();
    }

    private boolean hasConfiguration() {
        return !value(EXTRA_TRIP_ID).isEmpty()
            && !value(EXTRA_SUPABASE_URL).isEmpty()
            && !value(EXTRA_PUBLISHABLE_KEY).isEmpty()
            && !value(EXTRA_ACCESS_TOKEN).isEmpty();
    }

    @SuppressWarnings("MissingPermission")
    private void startLocationUpdates() {
        locationClient.removeLocationUpdates(locationCallback);
        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, LOCATION_INTERVAL_MS)
            .setMinUpdateIntervalMillis(MIN_LOCATION_INTERVAL_MS)
            .setMinUpdateDistanceMeters(MIN_DISTANCE_METERS)
            .setMaxUpdateDelayMillis(0L)
            .build();
        try {
            locationClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
        } catch (SecurityException exception) {
            stopSelf();
        }
    }

    private void acceptLocation(Location location) {
        if (!location.hasAccuracy() || location.getAccuracy() > MAX_ACCURACY_METERS) return;
        if (location.hasSpeed() && location.getSpeed() > MAX_SPEED_METERS_PER_SECOND) return;
        if (Math.abs(System.currentTimeMillis() - location.getTime()) > 10_000L) return;

        if (lastAcceptedLocation != null) {
            long elapsedMs = location.getTime() - lastAcceptedLocation.getTime();
            if (elapsedMs <= 0L) return;
            float distance = lastAcceptedLocation.distanceTo(location);
            float uncertainty = Math.max(lastAcceptedLocation.getAccuracy(), location.getAccuracy());
            float maximumDistance = Math.max(25f, (elapsedMs / 1000f) * MAX_SPEED_METERS_PER_SECOND + uncertainty);
            if (distance > maximumDistance) return;
        }
        lastAcceptedLocation = new Location(location);

        JSObject point = toPoint(location);
        lastPoint = point;
        LocationListener listener = locationListener;
        if (listener != null) listener.onLocation(point);

        long now = System.currentTimeMillis();
        if (now - lastNotificationAt >= 5000L) {
            lastNotificationAt = now;
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            manager.notify(NOTIFICATION_ID, buildNotification("Precisión " + Math.round(location.getAccuracy()) + " m · enviando ubicación"));
        }
        if (now - lastPublishedAt >= NETWORK_INTERVAL_MS) {
            lastPublishedAt = now;
            String payload = liveLocationPayload(point);
            networkExecutor.execute(() -> publishLocation(payload, true));
        }
    }

    private JSObject toPoint(Location location) {
        JSObject point = new JSObject();
        point.put("lat", location.getLatitude());
        point.put("lng", location.getLongitude());
        point.put("accuracy", Math.round(location.getAccuracy()));
        point.put("speed", location.hasSpeed() ? location.getSpeed() : -1);
        point.put("heading", location.hasBearing() ? location.getBearing() : -1);
        point.put("timestamp", location.getTime());
        point.put("at", isoTimestamp(location.getTime()));
        point.put("source", "android-native");
        point.put("tripId", value(EXTRA_TRIP_ID));
        return point;
    }

    private String liveLocationPayload(JSObject point) {
        JSObject payload = new JSObject();
        payload.put("trip_id", value(EXTRA_TRIP_ID));
        payload.put("latitude", point.optDouble("lat"));
        payload.put("longitude", point.optDouble("lng"));
        payload.put("accuracy", point.optDouble("accuracy"));
        double speed = point.optDouble("speed", -1);
        double heading = point.optDouble("heading", -1);
        payload.put("speed", speed >= 0 ? speed : JSONObject.NULL);
        payload.put("heading", heading >= 0 ? heading : JSONObject.NULL);
        payload.put("captured_at", point.optString("at"));
        payload.put("updated_at", point.optString("at"));
        return payload.toString();
    }

    private void publishLocation(String payload, boolean canRefresh) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(trimSlash(value(EXTRA_SUPABASE_URL)) + "/rest/v1/trip_live_locations?on_conflict=trip_id");
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("apikey", value(EXTRA_PUBLISHABLE_KEY));
            connection.setRequestProperty("Authorization", "Bearer " + value(EXTRA_ACCESS_TOKEN));
            connection.setRequestProperty("Prefer", "resolution=merge-duplicates,return=minimal");
            writeBody(connection, payload);
            int responseCode = connection.getResponseCode();
            if (responseCode == HttpURLConnection.HTTP_UNAUTHORIZED && canRefresh && refreshSession()) {
                publishLocation(payload, false);
            }
        } catch (Exception ignored) {
            // La siguiente lectura vuelve a intentarlo; nunca se detiene el GPS
            // por una pérdida temporal de datos móviles.
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private boolean refreshSession() {
        String refreshToken = value(EXTRA_REFRESH_TOKEN);
        if (refreshToken.isEmpty()) return false;
        HttpURLConnection connection = null;
        try {
            URL url = new URL(trimSlash(value(EXTRA_SUPABASE_URL)) + "/auth/v1/token?grant_type=refresh_token");
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("apikey", value(EXTRA_PUBLISHABLE_KEY));
            JSObject request = new JSObject();
            request.put("refresh_token", refreshToken);
            writeBody(connection, request.toString());
            if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300) return false;
            JSONObject response = new JSONObject(readBody(connection.getInputStream()));
            String accessToken = response.optString("access_token", "");
            String nextRefreshToken = response.optString("refresh_token", refreshToken);
            if (accessToken.isEmpty()) return false;
            preferences.edit()
                .putString(EXTRA_ACCESS_TOKEN, accessToken)
                .putString(EXTRA_REFRESH_TOKEN, nextRefreshToken)
                .apply();
            return true;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void writeBody(HttpURLConnection connection, String body) throws Exception {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(bytes);
        }
    }

    private String readBody(InputStream input) throws Exception {
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private String value(String key) {
        return preferences.getString(key, "") == null ? "" : preferences.getString(key, "");
    }

    private String trimSlash(String value) {
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    private String isoTimestamp(long timestamp) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(timestamp));
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Seguimiento del vehículo",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Mantiene el GPS activo durante un recorrido.");
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(String detail) {
        Intent openApp = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("RutaControl · GPS en vivo")
            .setContentText(detail)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (locationClient != null && locationCallback != null) locationClient.removeLocationUpdates(locationCallback);
        networkExecutor.shutdown();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
