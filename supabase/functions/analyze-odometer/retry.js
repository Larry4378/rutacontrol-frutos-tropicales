export const FAST_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_GEMINI_TIMEOUT_MS = 12_000;

export const clampGeminiTimeoutMs = value => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_GEMINI_TIMEOUT_MS;
  return Math.min(15_000, Math.max(5_000, Math.round(parsed)));
};

export const buildGeminiAttempts = preferredModel => {
  const preferred = String(preferredModel || '').trim() || FAST_GEMINI_MODEL;
  return preferred === FAST_GEMINI_MODEL
    ? [FAST_GEMINI_MODEL, FAST_GEMINI_MODEL]
    : [preferred, FAST_GEMINI_MODEL];
};

export const shouldRetryGeminiStatus = status => status === 408 || status === 429 || status >= 500;
