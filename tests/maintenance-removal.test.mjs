import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');

test('mantenimiento no aparece en los menús ni en los permisos', () => {
  const navigation = source.slice(source.indexOf('const adminNav='), source.indexOf('if (showSplash)'));
  const permissions = source.slice(source.indexOf('function Permissions'), source.indexOf('function DriverVehicleAssignment'));
  assert.doesNotMatch(navigation, /Mantenimiento|maintenance/);
  assert.doesNotMatch(permissions, /Mantenimiento|maintenance/);
});

test('inicio no muestra alertas ni accesos de mantenimiento', () => {
  const applicationView = source.slice(source.indexOf('if (showSplash)'), source.indexOf('function SplashScreen'));
  assert.doesNotMatch(applicationView, /MaintenanceAlerts|view === 'maintenance'|type === 'maintenance'/);
});

test('la aplicación ya no consulta mantenimientos al iniciar o recuperar el foco', () => {
  assert.doesNotMatch(source, /const loadMaintenance/);
  assert.doesNotMatch(source, /addEventListener\('focus', loadMaintenance\)/);
});
