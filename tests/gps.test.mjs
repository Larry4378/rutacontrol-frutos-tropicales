import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GPS_TRACKING_MAX_ACCURACY_METERS,
  gpsDistanceMeters,
  gpsPointFromLiveRow,
  isGpsPointFresh,
  shouldKeepGpsPoint,
  stabilizeGpsPoint,
  stabilizeLiveGpsRow,
} from '../src/gps.js';

const base = {
  lat: -11.033,
  lng: -77.605,
  accuracy: 6,
  timestamp: 1_000,
  at: new Date(1_000).toISOString(),
};

test('rechaza coordenadas incompletas o con precisión deficiente', () => {
  assert.equal(shouldKeepGpsPoint(null, { ...base, lat: undefined }), false);
  assert.equal(shouldKeepGpsPoint(null, { ...base, accuracy: GPS_TRACKING_MAX_ACCURACY_METERS + 1 }), false);
});

test('rechaza posiciones antiguas o demasiado seguidas', () => {
  assert.equal(shouldKeepGpsPoint(base, { ...base, timestamp: 900 }), false);
  assert.equal(shouldKeepGpsPoint(base, { ...base, timestamp: 1_500, lat: base.lat + 0.0001 }), false);
});

test('ignora el vaivén del GPS cuando el vehículo está detenido', () => {
  const jitter = { ...base, lat: base.lat + 0.00001, timestamp: 2_100 };
  assert.ok(gpsDistanceMeters(base, jitter) < 2);
  assert.equal(shouldKeepGpsPoint(base, jitter), false);
});

test('acepta un avance normal del vehículo', () => {
  const point = { ...base, lat: base.lat + 0.00009, timestamp: 2_100, speed: 9 };
  assert.ok(gpsDistanceMeters(base, point) > 9);
  assert.equal(shouldKeepGpsPoint(base, point), true);
});

test('rechaza saltos que harían aparecer el vehículo muy adelantado', () => {
  const jump = { ...base, lat: base.lat + 0.002, timestamp: 2_100, speed: 8 };
  assert.ok(gpsDistanceMeters(base, jump) > 200);
  assert.equal(shouldKeepGpsPoint(base, jump), false);
});

test('rechaza una velocidad informada imposible', () => {
  const point = { ...base, lat: base.lat + 0.00009, timestamp: 2_100, speed: 55 };
  assert.equal(shouldKeepGpsPoint(base, point), false);
});

test('el suavizado queda entre la posición anterior y la coordenada real', () => {
  const raw = { ...base, lat: base.lat + 0.0001, lng: base.lng + 0.0001, timestamp: 2_100, speed: 7 };
  const stable = stabilizeGpsPoint(base, raw);
  assert.ok(stable.lat > base.lat && stable.lat < raw.lat);
  assert.ok(stable.lng > base.lng && stable.lng < raw.lng);
});

test('tras una pausa larga usa la nueva posición real para recuperarse', () => {
  const raw = { ...base, lat: base.lat + 0.0002, timestamp: 12_500 };
  assert.deepEqual(stabilizeGpsPoint(base, raw), raw);
});

test('en un recorrido continuo el marcador nunca queda delante del GPS real', () => {
  let previous = base;
  for (let step = 1; step <= 30; step += 1) {
    const raw = {
      ...base,
      lat: base.lat + step * 0.00008,
      timestamp: base.timestamp + step * 1_100,
      at: new Date(base.timestamp + step * 1_100).toISOString(),
      speed: 8,
    };
    assert.equal(shouldKeepGpsPoint(previous, raw), true);
    const stable = stabilizeGpsPoint(previous, raw);
    assert.ok(stable.lat <= raw.lat, `el punto ${step} no debe adelantarse`);
    assert.ok(stable.lat >= previous.lat, `el punto ${step} no debe retroceder`);
    previous = stable;
  }
});

test('un salto falso intermedio no contamina las posiciones siguientes', () => {
  const validFirst = { ...base, lat: base.lat + 0.00008, timestamp: 2_100, speed: 8 };
  const stableFirst = stabilizeGpsPoint(base, validFirst);
  const falseJump = { ...base, lat: base.lat + 0.004, timestamp: 3_200, speed: 8 };
  assert.equal(shouldKeepGpsPoint(stableFirst, falseJump), false);
  const validNext = { ...base, lat: base.lat + 0.00016, timestamp: 3_200, speed: 8 };
  assert.equal(shouldKeepGpsPoint(stableFirst, validNext), true);
});

test('convierte la fila de ubicación en vivo en un punto GPS utilizable', () => {
  const capturedAt = new Date().toISOString();
  const point = gpsPointFromLiveRow({
    latitude: -11.0329,
    longitude: -77.6049,
    accuracy: 4.4,
    speed: 8,
    heading: 185,
    captured_at: capturedAt,
  });
  assert.equal(point.lat, -11.0329);
  assert.equal(point.lng, -77.6049);
  assert.equal(point.accuracy, 4);
  assert.equal(point.at, capturedAt);
});

test('el mapa remoto rechaza un salto falso recibido por Realtime', () => {
  const capturedAt = new Date(base.timestamp + 1_100).toISOString();
  const point = stabilizeLiveGpsRow(base, {
    latitude: base.lat + 0.004,
    longitude: base.lng,
    accuracy: 5,
    speed: 8,
    captured_at: capturedAt,
  });
  assert.equal(point, null);
});

test('el mapa remoto suaviza una lectura válida sin adelantar el vehículo', () => {
  const capturedAt = new Date(base.timestamp + 1_100).toISOString();
  const latitude = base.lat + 0.00009;
  const point = stabilizeLiveGpsRow(base, {
    latitude,
    longitude: base.lng,
    accuracy: 5,
    speed: 8,
    captured_at: capturedAt,
  });
  assert.ok(point.lat > base.lat);
  assert.ok(point.lat <= latitude);
});

test('distingue una ubicación en vivo de una posición atrasada', () => {
  const now = Date.now();
  assert.equal(isGpsPointFresh({ timestamp: now - 3_000 }, now), true);
  assert.equal(isGpsPointFresh({ timestamp: now - 30_000 }, now), false);
});
