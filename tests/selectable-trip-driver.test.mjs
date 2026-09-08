import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260907031723_selectable_trip_driver.sql', import.meta.url), 'utf8');
const hardeningMigration = await readFile(new URL('../supabase/migrations/20260907032007_harden_driver_directory.sql', import.meta.url), 'utf8');

test('el conductor del login aparece por defecto y el formulario permite seleccionar otro', () => {
  const departureStart = mainSource.indexOf('function DepartureGpsRequired');
  const arrivalStart = mainSource.indexOf('function ArrivalSimple');
  const departureSource = mainSource.slice(departureStart, arrivalStart);
  assert.match(departureSource, /driverProfileId: driverId/);
  assert.match(departureSource, /<label>Conductor asignado<\/label><select required value=\{form\.driverProfileId/);
  assert.match(departureSource, /drivers\.map\(driver => <option key=\{driver\.id\} value=\{driver\.id\}>\{driver\.full_name\}/);
  assert.match(mainSource, /assignmentReady=\{profileReady && vehiclesReady\}/);
  assert.match(mainSource, /disabled=\{!ready\}/);
});

test('la identidad autenticada conserva la propiedad y el GPS del recorrido', () => {
  assert.match(mainSource, /const tripDriverId = user\.id;/);
  assert.match(mainSource, /const tripDriverProfileId = record\.driverProfileId \|\| user\.id;/);
  assert.match(mainSource, /String\(active\?\.driver \|\| ''\) === String\(profile\?\.id \|\| ''\)/);
});

test('el directorio de conductores no expone códigos ni permisos y exige autenticación', () => {
  assert.match(migration, /returns table \(id uuid, full_name text\)/);
  assert.doesNotMatch(migration, /access_code|qr_token|permissions jsonb/i);
  assert.match(hardeningMigration, /private\.list_active_trip_drivers\(\)/);
  assert.match(hardeningMigration, /security definer\s+set search_path = ''/);
  assert.match(hardeningMigration, /public\.list_active_trip_drivers\(\)[\s\S]*security invoker/);
  assert.match(hardeningMigration, /revoke all on function public\.list_active_trip_drivers\(\) from public/);
  assert.match(hardeningMigration, /grant execute on function public\.list_active_trip_drivers\(\) to authenticated/);
  assert.match(migration, /driver_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /selected_driver\.id = driver_profile_id/);
});
