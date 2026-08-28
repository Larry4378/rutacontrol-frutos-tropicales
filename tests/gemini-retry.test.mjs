import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FAST_GEMINI_MODEL,
  buildGeminiAttempts,
  clampGeminiTimeoutMs,
  shouldRetryGeminiStatus,
} from '../supabase/functions/analyze-odometer/retry.js';

test('usa Flash-Lite por defecto y nunca supera dos intentos', () => {
  assert.deepEqual(buildGeminiAttempts(), [FAST_GEMINI_MODEL, FAST_GEMINI_MODEL]);
  assert.equal(buildGeminiAttempts().length, 2);
});

test('si se configura otro modelo, Flash-Lite queda como único respaldo', () => {
  assert.deepEqual(buildGeminiAttempts('gemini-3.5-flash'), ['gemini-3.5-flash', FAST_GEMINI_MODEL]);
});

test('el tiempo máximo queda limitado entre 5 y 15 segundos por intento', () => {
  assert.equal(clampGeminiTimeoutMs(), 12_000);
  assert.equal(clampGeminiTimeoutMs(1_000), 5_000);
  assert.equal(clampGeminiTimeoutMs(60_000), 15_000);
});

test('solo reintenta errores transitorios', () => {
  assert.equal(shouldRetryGeminiStatus(408), true);
  assert.equal(shouldRetryGeminiStatus(429), true);
  assert.equal(shouldRetryGeminiStatus(503), true);
  assert.equal(shouldRetryGeminiStatus(400), false);
  assert.equal(shouldRetryGeminiStatus(401), false);
});
