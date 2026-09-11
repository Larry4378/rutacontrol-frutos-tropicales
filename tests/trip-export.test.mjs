import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildTripExportCsv, buildTripExportRows, buildTripExportXlsx, TRIP_EXPORT_HEADERS } from '../src/trip-export.js';

const completed = {
  departureDate: '2026-08-30',
  departureTime: '08:10:12',
  returnDate: '2026-08-30',
  returnTime: '10:25:30',
  vehicleId: 'vehicle-1',
  driver: 'driver-1',
  origin: 'Huacho',
  destination: 'Végueta',
  startKm: 118000,
  endKm: 118067,
  routePoints: [
    { lat: -5.2037362, lng: -80.6344715 },
    { lat: -5.207033, lng: -80.637222 },
  ],
  notes: 'Entrega terminada',
};

const labels = {
  vehicleName: trip => trip.vehicleId === 'vehicle-1' ? '8588 - KP' : 'Otra unidad',
  vehicleType: trip => trip.vehicleId === 'vehicle-1' ? 'Moto' : 'Carro',
  driverName: trip => trip.driver === 'driver-1' ? 'LARRY ESTEVES' : 'Otro conductor',
};

test('exporta todos los datos visibles de un recorrido finalizado', () => {
  const [row] = buildTripExportRows([completed], labels);
  assert.equal(row.length, TRIP_EXPORT_HEADERS.length);
  assert.deepEqual(row, [
    '08/2026', 'domingo', '30/08/2026', 'LARRY ESTEVES', '8588 - KP',
    '08:10:12', '10:25:30', 118000, 118067, 67, 'Moto',
    'Huacho', 'Végueta', '-5.203736, -80.634472', '-5.207033, -80.637222', 'Finalizado', 'Entrega terminada',
  ]);
});

test('un recorrido pendiente conserva vacíos los datos de llegada', () => {
  const [row] = buildTripExportRows([{ ...completed, returnDate: '', returnTime: '', endKm: '', destination: '' }], labels);
  assert.equal(row[6], '');
  assert.equal(row[8], '');
  assert.equal(row[9], '');
  assert.equal(row[14], '');
  assert.equal(row[15], 'En ruta');
});

test('el CSV abre por columnas en Excel y neutraliza fórmulas', () => {
  const rows = buildTripExportRows([{ ...completed, origin: '=HIPERVINCULO("sitio")' }], labels);
  const csv = buildTripExportCsv(rows);
  assert.ok(csv.startsWith('\ufeffsep=;\r\n'));
  assert.match(csv, /"'=HIPERVINCULO\(""sitio""\)"/);
  assert.match(csv, /118000;118067;67;"Moto";"'=HIPERVINCULO/);
});

test('el XLSX conserva filtros desplegables y encabezado inmovilizado', () => {
  const bytes = buildTripExportXlsx(buildTripExportRows([completed], labels));
  const workbook = XLSX.read(bytes, { type: 'array' });
  const worksheet = workbook.Sheets.Recorridos;
  assert.equal(worksheet['!autofilter'].ref, 'A1:Q2');
  assert.equal(worksheet.A1.v, 'Mes-año');
  assert.equal(worksheet.Q2.v, 'Entrega terminada');
});
