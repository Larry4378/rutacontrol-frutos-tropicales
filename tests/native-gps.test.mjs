import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const activity = await readFile(new URL('../android/app/src/main/java/com/frutostropicales/rutacontrol/MainActivity.java', import.meta.url), 'utf8');
const service = await readFile(new URL('../android/app/src/main/java/com/frutostropicales/rutacontrol/LocationTrackingService.java', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260831000000_trip_live_locations.sql', import.meta.url), 'utf8');

test('Android declara ubicación precisa y el servicio GPS en primer plano', () => {
  assert.match(manifest, /android\.permission\.ACCESS_FINE_LOCATION/);
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_LOCATION/);
  assert.match(manifest, /android:foregroundServiceType="location"/);
  assert.match(activity, /registerPlugin\(NativeLocationPlugin\.class\)/);
});
test('el GPS nativo solicita posiciones frecuentes sin agruparlas', () => {
  assert.match(service, /LOCATION_INTERVAL_MS = 1000L/);
  assert.match(service, /MIN_LOCATION_INTERVAL_MS = 750L/);
  assert.match(service, /setMinUpdateDistanceMeters\(MIN_DISTANCE_METERS\)/);
  assert.match(service, /setMaxUpdateDelayMillis\(0L\)/);
  assert.match(service, /Priority\.PRIORITY_HIGH_ACCURACY/);
});

test('el servicio publica solo la posición vigente usando el token del conductor', () => {
  assert.match(service, /trip_live_locations\?on_conflict=trip_id/);
  assert.match(service, /Authorization", "Bearer "/);
  assert.match(service, /grant_type=refresh_token/);
  assert.doesNotMatch(service, /service_role/i);
});

test('el mapa escucha cambios en tiempo real y conserva un respaldo de red', () => {
  assert.match(mainSource, /table: 'trip_live_locations'/);
  assert.match(mainSource, /\.on\('postgres_changes'/);
  assert.match(mainSource, /window\.setInterval\(loadLatest, 5000\)/);
  assert.match(mainSource, /startNativeLocationTracking/);
});

test('la tabla en vivo usa RLS y autoriza únicamente el viaje propio o al administrador', () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /trip\.driver_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /private\.is_rutacontrol_admin\(\)/);
  assert.match(migration, /alter publication supabase_realtime add table public\.trip_live_locations/);
});
