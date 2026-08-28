import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
