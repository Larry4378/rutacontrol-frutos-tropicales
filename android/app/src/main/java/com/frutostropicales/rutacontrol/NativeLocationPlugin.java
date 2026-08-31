package com.frutostropicales.rutacontrol;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "NativeLocation",
    permissions = {
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_FINE_LOCATION
            }
        ),
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class NativeLocationPlugin extends Plugin {
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        LocationTrackingService.setLocationListener(point ->
            mainHandler.post(() -> notifyListeners("location", point, true))
        );
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                requestPermissionForAliases(new String[]{"location", "notifications"}, call, "permissionsCallback");
            } else {
                requestPermissionForAlias("location", call, "permissionsCallback");
            }
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void permissionsCallback(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Debes permitir la ubicación precisa para seguir el vehículo.", "LOCATION_PERMISSION_DENIED");
            return;
        }
        startService(call);
    }

    private void startService(PluginCall call) {
        String tripId = call.getString("tripId");
        String supabaseUrl = call.getString("supabaseUrl");
        String publishableKey = call.getString("publishableKey");
        String accessToken = call.getString("accessToken");
        String refreshToken = call.getString("refreshToken");
        if (tripId == null || supabaseUrl == null || publishableKey == null || accessToken == null) {
            call.reject("Faltan datos para iniciar el seguimiento.", "TRACKING_CONFIGURATION_MISSING");
            return;
        }

        Intent intent = new Intent(getContext(), LocationTrackingService.class);
        intent.setAction(LocationTrackingService.ACTION_START);
        intent.putExtra(LocationTrackingService.EXTRA_TRIP_ID, tripId);
        intent.putExtra(LocationTrackingService.EXTRA_SUPABASE_URL, supabaseUrl);
        intent.putExtra(LocationTrackingService.EXTRA_PUBLISHABLE_KEY, publishableKey);
        intent.putExtra(LocationTrackingService.EXTRA_ACCESS_TOKEN, accessToken);
        intent.putExtra(LocationTrackingService.EXTRA_REFRESH_TOKEN, refreshToken == null ? "" : refreshToken);
        ContextCompat.startForegroundService(getContext(), intent);

        JSObject result = new JSObject();
        result.put("started", true);
        result.put("native", true);
        result.put("tripId", tripId);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), LocationTrackingService.class));
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", LocationTrackingService.isRunning());
        JSObject point = LocationTrackingService.getLastPoint();
        if (point != null) result.put("lastPoint", point);
        call.resolve(result);
    }

    @Override
    protected void handleOnDestroy() {
        LocationTrackingService.setLocationListener(null);
        super.handleOnDestroy();
    }
}

