import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');

test('combustible muestra el mes de cada abastecimiento', () => {
  const fuelSource = source.slice(source.indexOf('function Fuel('), source.indexOf('function Expenses'));
  assert.match(fuelSource, /'Mes','Fecha','Vehículo'/);
  assert.doesNotMatch(fuelSource, /Quincena|fortnight/);
  assert.match(fuelSource, /monthLabel\(monthKey\(record\.date\)\)/);
});

test('combustible permite registrar galones manualmente sin comprobante obligatorio', () => {
  const modalSource = source.slice(source.indexOf('function FuelModalReceipt'), source.indexOf('function FuelModalSmart'));
  assert.match(modalSource, /Galones abastecidos/);
  assert.match(modalSource, /Number\(form\.gallons\) > 0/);
  assert.match(modalSource, /Foto del comprobante es opcional|foto del comprobante es opcional/i);
  assert.doesNotMatch(modalSource, /Primero toma una foto clara del comprobante/);
});

test('la sección KPI muestra rendimiento mensual cruzando recorridos y galones', () => {
  assert.match(source, /const monthKey = value/);
  assert.match(source, /data\.trips\.map\(trip => monthKey\(trip\.departureDate\)\)/);
  assert.match(source, /function FuelKpi\(\{ data \}\)/);
  assert.match(source, /Rendimiento Km\/Gl · KPI/);
  assert.match(source, /row\.km \/ row\.gallons/);
  assert.match(source, /Filtrar KPI por mes/);
  assert.match(source, /monthLabel\(row\.month\)/);
  assert.match(source, /\['kpi','◉','Rendimiento Km\/Gl · KPI'\]/);
  assert.match(source, /\['kpi','Rendimiento Km\/Gl · KPI'\]/);
  assert.match(source, /profile\?\.role === 'driver' && driverPermissions\.kpi/);
  assert.match(source, /view === 'kpi'/);
});
