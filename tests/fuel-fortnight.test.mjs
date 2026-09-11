import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');

test('la sección KPI muestra rendimiento mensual cruzando recorridos y galones', () => {
  assert.match(source, /const fortnightKey = value/);
  assert.match(source, /Number\(match\[3\]\) <= 15 \? '1' : '2'/);
  assert.match(source, /const monthKey = value/);
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
