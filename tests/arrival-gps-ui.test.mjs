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
  assert.match(departureSource, /form\.departureDate && !isRecentTripDate\(form\.departureDate\)/);
  assert.match(arrivalSource, /form\.returnDate && !isRecentTripDate\(form\.returnDate\)/);
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
  assert.match(departureSource, /reverseGeocodeGpsAddress\(latitude, longitude, origin\)/);
  assert.match(arrivalSource, /reverseGeocodeGpsAddress\(latitude, longitude, destination\)/);
});

test('la llegada conserva el punto GPS exacto aunque la calle sea aproximada', () => {
  const arrivalSource = mainSource.slice(mainSource.indexOf('function ArrivalSimple'));
  assert.match(arrivalSource, /const routePoints = \[\.\.\.\(trip\.routePoints \|\| \[\]\)\];/);
  assert.match(arrivalSource, /routePoints\.push\(form\.arrivalPoint\)/);
  assert.match(arrivalSource, /GpsLocationReference point=\{form\.arrivalPoint\}/);
  assert.match(mainSource, /function GpsLocationReference\(\{ point \}\)/);
  assert.match(mainSource, /Punto GPS exacto:/);
});

test('si el GPS falla muestra un aviso nativo para activar la ubicación', () => {
  const arrivalSource = mainSource.slice(mainSource.indexOf('function ArrivalSimple'));
  assert.match(arrivalSource, /window\.alert\(error\?\.code === 1/);
  assert.match(arrivalSource, /Activa la ubicación \(GPS\) de tu celular/);
});

test('el inicio muestra un único mapa GPS de seguimiento y enlace a Google Maps', () => {
  assert.match(mainSource, /function GpsLocationCard\(\{ data, profile, driverPreview, onUpdate \}\)/);
  assert.match(mainSource, /gps-location-map/);
  assert.match(mainSource, /gps-refresh-button/);
  assert.match(mainSource, /Ver en Google Maps ↗/);
  assert.match(mainSource, /<GpsLocationCard data=\{data\} profile=\{profile\} driverPreview=\{driverPreview\} onUpdate=\{onTripUpdate\}\/\>/);
});

test('el mapa único usa el punto vivo de la salida y el icono de la movilidad', () => {
  assert.match(mainSource, /function RouteMap\(\{ data, profile, driverPreview, onUpdate, gpsPresentation = false \}\)/);
  assert.match(mainSource, /const active = data\.trips\.find\(isTripOpen\)/);
  assert.match(mainSource, /const latest = active \? \(livePoint \|\| storedLast\) : null/);
  assert.match(mainSource, /Al confirmar una llegada el viaje deja de estar activo/);
  assert.match(mainSource, /moving-vehicle-icon/);
  assert.match(mainSource, /vehicle-map-pin/);
  const dashboardSource = mainSource.slice(mainSource.indexOf('function Dashboard'), mainSource.indexOf('\n\n// El mapa superior'));
  assert.equal((dashboardSource.match(/<GpsLocationCard/g) || []).length, 1);
  assert.doesNotMatch(dashboardSource, /<RouteMap/);
});

test('recorridos muestra las columnas derivadas del reporte operativo', () => {
  const tripsSource = mainSource.slice(mainSource.indexOf('function Trips'), mainSource.indexOf('function Maintenance({data'));
  for (const header of ['Mes-año', 'Día', 'Fecha', 'Hora inicio', 'Hora término', 'Km inicial', 'Km final', 'Km recorrido', 'Tipo de vehículo', 'Observaciones']) {
    assert.match(tripsSource, new RegExp(header));
  }
  assert.match(mainSource, /vehicleType:trip=>vehicleTypeName\(data,trip\.vehicleId\)/);
});

test('recorridos muestra las coordenadas GPS debajo de origen y destino', () => {
  const tripsSource = mainSource.slice(mainSource.indexOf('function Trips'), mainSource.indexOf('function Maintenance({data'));
  assert.match(mainSource, /const gpsCoordinates = point =>/);
  assert.match(mainSource, /tripOriginGps\(t\)/);
  assert.match(mainSource, /tripDestinationGps\(t\)/);
  assert.match(tripsSource, /className="trip-gps-coordinates"/);
});

test('recorridos calcula y muestra el número de semana antes de mes-año', () => {
  const tripsSource = mainSource.slice(mainSource.indexOf('function Trips'), mainSource.indexOf('function Maintenance({data'));
  assert.match(mainSource, /const weekNumber = value =>/);
  assert.match(tripsSource, /heads=\{\['Semana','Mes-año'/);
  assert.match(tripsSource, /<td>\{weekNumber\(t\.departureDate\)\}<\/td>/);
});
