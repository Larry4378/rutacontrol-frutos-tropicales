import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arrivalSubmissionError,
  isArrivalKilometerGreater,
  isPositiveKilometer,
  normalizeKilometerInput,
} from '../src/odometer-form.js';

test('el kilometraje manual elimina letras, signos y exponentes', () => {
  assert.equal(normalizeKilometerInput('12abc34'), '1234');
  assert.equal(normalizeKilometerInput('-30001e5'), '300015');
  assert.equal(normalizeKilometerInput('30.001.7'), '30.0017');
});

test('acepta coma decimal y la normaliza', () => {
  assert.equal(normalizeKilometerInput('30001,5'), '30001.5');
});

test('el kilometraje manual debe ser positivo', () => {
  assert.equal(isPositiveKilometer('30001'), true);
  assert.equal(isPositiveKilometer('0'), false);
  assert.equal(isPositiveKilometer(''), false);
});

test('el kilometraje de llegada debe ser estrictamente mayor al de salida', () => {
  assert.equal(isArrivalKilometerGreater('30001', '30002'), true);
  assert.equal(isArrivalKilometerGreater('30001', '30001'), false);
  assert.equal(isArrivalKilometerGreater('30001', '29999'), false);
});

test('la llegada explica cada requisito faltante junto al botón', () => {
  const base = { hasTrip: true, gpsReady: true, destination: 'Destino', photoSelected: true, departureKm: 100, arrivalKm: 101 };
  assert.match(arrivalSubmissionError({ ...base, gpsReady: false }), /GPS/);
  assert.match(arrivalSubmissionError({ ...base, photoSelected: false }), /foto/);
  assert.match(arrivalSubmissionError({ ...base, arrivalKm: '' }), /kilometraje final válido/);
  assert.match(arrivalSubmissionError({ ...base, samePlace: true }), /coincide con el origen/);
  assert.match(arrivalSubmissionError({ ...base, distanceMeters: 42 }), /42 m/);
  assert.match(arrivalSubmissionError({ ...base, arrivalKm: 100 }), /mayor/);
  assert.equal(arrivalSubmissionError(base), '');
});
