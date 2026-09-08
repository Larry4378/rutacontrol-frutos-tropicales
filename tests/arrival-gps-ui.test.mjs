import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const quickStyles = await readFile(new URL('../src/quick.css', import.meta.url), 'utf8');

test('si el GPS falla al registrar una salida muestra el aviso nativo', () => {
  const departureStart = mainSource.indexOf('function DepartureGpsRequired');
  const arrivalStart = mainSource.indexOf('function ArrivalSimple');
  const departureSource = mainSource.slice(departureStart, arrivalStart);
  assert.match(departureSource, /window\.alert\(error\?\.code === 1/);
  assert.match(departureSource, /Activa la ubicación \(GPS\) de tu celular/);
});

test('la salida y la llegada solicitan el GPS automáticamente al abrirse', () => {
  const departureStart = mainSource.indexOf('function DepartureGpsRequired');
  const arrivalStart = mainSource.indexOf('function ArrivalSimple');
  const departureSource = mainSource.slice(departureStart, arrivalStart);
  const arrivalSource = mainSource.slice(mainSource.indexOf('function ArrivalSimple'));
  assert.match(departureSource, /autoGpsRequested\.current = true;\s*gps\(\);/);
  assert.match(arrivalSource, /autoGpsRequested\.current = true;\s*gps\(\);/);
});

test('adjuntar la foto no vuelve a ejecutar ni reemplaza el GPS de llegada', () => {
  const arrivalSource = mainSource.slice(mainSource.indexOf('function ArrivalSimple'));
  const photoHandler = arrivalSource.slice(arrivalSource.indexOf('const odometer'), arrivalSource.indexOf('const storeArrivalPhoto'));
  assert.doesNotMatch(photoHandler, /gps\(\)/);
});

test('si existen coordenadas reales no rechaza solo por repetir el texto de la calle', () => {
  const arrivalSource = mainSource.slice(mainSource.indexOf('function ArrivalSimple'));
  assert.match(arrivalSource, /const samePlace = !Number\.isFinite\(distance\)/);
});

test('si la llegada realmente coincide con el origen muestra el aviso superior', () => {
  const arrivalSource = mainSource.slice(mainSource.indexOf('function ArrivalSimple'));
  assert.match(arrivalSource, /if \(samePlace \|\| \(Number\.isFinite\(distance\) && distance < 100\)\) \{[\s\S]*?setGpsStatus\(validationError\);/);
});

test('la salida y la llegada no muestran un botón manual para el GPS', () => {
  const departureStart = mainSource.indexOf('function DepartureGpsRequired');
  const arrivalStart = mainSource.indexOf('function ArrivalSimple');
  const departureSource = mainSource.slice(departureStart, arrivalStart);
  const arrivalSource = mainSource.slice(arrivalStart);
  assert.match(mainSource, /className="arrival-form"/);
  assert.doesNotMatch(departureSource, /Reintentar GPS/);
  assert.doesNotMatch(arrivalSource, /Reintentar GPS/);
  assert.doesNotMatch(arrivalSource, /Actualizar destino con GPS/);
  assert.doesNotMatch(quickStyles, /\.arrival-form[^\n{]*nth-of-type\(3\)[^{]*\{\s*display\s*:\s*none/);
  assert.match(quickStyles, /\.departure-form \.form-grid>\.field:nth-of-type\(3\)\{display:none\}/);
});

test('las fechas de salida y llegada permiten hoy y los dos días anteriores', () => {
  const departureStart = mainSource.indexOf('function DepartureGpsRequired');
  const arrivalStart = mainSource.indexOf('function ArrivalSimple');
  const departureSource = mainSource.slice(departureStart, arrivalStart);
  const arrivalSource = mainSource.slice(arrivalStart);
  assert.match(departureSource, /type="date" min=\{dateDaysAgo\(2\)\} max=\{today\(\)\}/);
  assert.match(arrivalSource, /type="date" min=\{dateDaysAgo\(2\)\} max=\{today\(\)\}/);
  assert.doesNotMatch(departureSource, /departureDate: today\(\), departureTime: now\(\), status/);
  assert.match(arrivalSource, /returnDate: form\.returnDate/);
  const appSource = mainSource.slice(mainSource.indexOf('function App()'), mainSource.indexOf('function SplashScreen'));
  assert.doesNotMatch(appSource, /departureDate:today\(\),departureTime:now\(\)/);
  assert.doesNotMatch(appSource, /returnDate:today\(\),returnTime:now\(\)/);
});

test('el GPS de los formularios espera una muestra precisa antes de resolver la dirección', () => {
  const departureStart = mainSource.indexOf('function DepartureGpsRequired');
  const arrivalStart = mainSource.indexOf('function ArrivalSimple');
  const departureSource = mainSource.slice(departureStart, arrivalStart);
  const arrivalSource = mainSource.slice(arrivalStart);
  assert.match(departureSource, /getPreciseGpsPosition\(navigator\.geolocation\)/);
  assert.match(arrivalSource, /getPreciseGpsPosition\(navigator\.geolocation\)/);
  assert.match(departureSource, /zoom=17&addressdetails=1&accept-language=es/);
  assert.match(arrivalSource, /zoom=17&addressdetails=1&accept-language=es/);
});

test('si el GPS falla muestra un aviso nativo para activar la ubicación', () => {
  const arrivalSource = mainSource.slice(mainSource.indexOf('function ArrivalSimple'));
  assert.match(arrivalSource, /window\.alert\(error\?\.code === 1/);
  assert.match(arrivalSource, /Activa la ubicación \(GPS\) de tu celular/);
});
