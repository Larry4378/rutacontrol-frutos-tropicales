export const GPS_TRACKING_MAX_ACCURACY_METERS = 18;
export const GPS_TRACKING_MIN_INTERVAL_MS = 1000;
export const GPS_TRACKING_MAX_SPEED_MPS = 45;
export const GPS_LIVE_STALE_AFTER_MS = 15_000;

const finite = value => Number.isFinite(Number(value));
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export const gpsDistanceMeters = (previous, point) => {
  const rad = value => value * Math.PI / 180;
  const lat = rad(Number(point.lat) - Number(previous.lat));
  const lng = rad(Number(point.lng) - Number(previous.lng));
  const a = Math.sin(lat / 2) ** 2
    + Math.cos(rad(Number(previous.lat))) * Math.cos(rad(Number(point.lat))) * Math.sin(lng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Conserva únicamente lecturas recientes, precisas y físicamente posibles.
// El filtro no intenta adivinar una posición futura: siempre trabaja con la
// coordenada que realmente entregó el teléfono.
export const shouldKeepGpsPoint = (previous, point) => {
  if (!finite(point?.lat) || !finite(point?.lng) || !finite(point?.accuracy)) return false;
  if (Number(point.accuracy) > GPS_TRACKING_MAX_ACCURACY_METERS) return false;
  if (!previous) return true;

  const previousTimestamp = Number(previous.timestamp || Date.parse(previous.at || ''));
  const timestamp = Number(point.timestamp || Date.parse(point.at || ''));
  if (!Number.isFinite(timestamp)) return false;
  if (Number.isFinite(previousTimestamp) && timestamp <= previousTimestamp) return false;

  const seconds = Number.isFinite(previousTimestamp) ? (timestamp - previousTimestamp) / 1000 : 0;
  if (seconds * 1000 < GPS_TRACKING_MIN_INTERVAL_MS) return false;

  const distance = gpsDistanceMeters(previous, point);
  const reportedSpeed = Number(point.speed);
  if (Number.isFinite(reportedSpeed) && reportedSpeed >= 0 && reportedSpeed > GPS_TRACKING_MAX_SPEED_MPS) return false;

  // Ignora el pequeño vaivén que produce un GPS detenido. Se mantiene bajo
  // para no esconder el avance real de una moto o automóvil a baja velocidad.
  const minimumMovement = clamp(Math.min(Number(previous.accuracy || 0), Number(point.accuracy)) * 0.3, 2.5, 5);
  if (distance < minimumMovement) return false;

  // Tolera el margen de error informado por el teléfono, pero rechaza saltos
  // incompatibles con el tiempo transcurrido (aprox. 162 km/h como máximo).
  const uncertainty = Math.max(Number(previous.accuracy || 0), Number(point.accuracy));
  const maximumDistance = Math.max(20, seconds * GPS_TRACKING_MAX_SPEED_MPS + uncertainty);
  return distance <= maximumDistance;
};

// Suaviza una lectura válida entre la última posición mostrada y la nueva.
// Al ser una interpolación (nunca una extrapolación), el ícono no se adelanta
// artificialmente al vehículo físico.
export const stabilizeGpsPoint = (previous, point) => {
  if (!previous) return { ...point };
  const previousTimestamp = Number(previous.timestamp || Date.parse(previous.at || ''));
  const timestamp = Number(point.timestamp || Date.parse(point.at || ''));
  const seconds = Number.isFinite(previousTimestamp) && Number.isFinite(timestamp)
    ? Math.max(0, (timestamp - previousTimestamp) / 1000)
    : 0;
  if (seconds > 10) return { ...point };

  const previousAccuracy = Math.max(1, Number(previous.accuracy || GPS_TRACKING_MAX_ACCURACY_METERS));
  const accuracy = Math.max(1, Number(point.accuracy || GPS_TRACKING_MAX_ACCURACY_METERS));
  const accuracyWeight = previousAccuracy / (previousAccuracy + accuracy);
  const reportedSpeed = Number(point.speed);
  // Cuando el vehículo realmente está avanzando nos acercamos casi por
  // completo a la lectura nueva. Así se elimina el retraso artificial sin
  // sacrificar el filtrado de saltos que se hizo antes.
  const speedWeight = Number.isFinite(reportedSpeed) && reportedSpeed >= 2 ? 0.28 : 0;
  const preciseWeight = accuracy <= 8 ? 0.12 : 0;
  const alpha = clamp(0.5 + accuracyWeight * 0.26 + speedWeight + preciseWeight, 0.62, 0.95);

  return {
    ...point,
    lat: Number(previous.lat) + (Number(point.lat) - Number(previous.lat)) * alpha,
    lng: Number(previous.lng) + (Number(point.lng) - Number(previous.lng)) * alpha,
    accuracy: Math.round(accuracy),
  };
};

export const gpsPointFromLiveRow = row => {
  if (!row) return null;
  const timestamp = Date.parse(row.captured_at || row.updated_at || '');
  const point = {
    lat: Number(row.latitude),
    lng: Number(row.longitude),
    accuracy: Math.round(Number(row.accuracy)),
    speed: row.speed === null || row.speed === undefined ? -1 : Number(row.speed),
    heading: row.heading === null || row.heading === undefined ? -1 : Number(row.heading),
    timestamp,
    at: row.captured_at || row.updated_at,
    source: 'supabase-realtime',
  };
  return finite(point.lat) && finite(point.lng) && finite(point.accuracy) && Number.isFinite(timestamp)
    ? point
    : null;
};

// El mapa remoto debe aplicar las mismas reglas que el teléfono. Realtime
// transporta la lectura cruda para no inventar coordenadas en el servidor;
// aquí se descartan saltos falsos y se interpola únicamente hacia el punto
// real más reciente.
export const stabilizeLiveGpsRow = (previous, row) => {
  const point = gpsPointFromLiveRow(row);
  if (!point || !shouldKeepGpsPoint(previous, point)) return null;
  return stabilizeGpsPoint(previous, point);
};

export const isGpsPointFresh = (point, now = Date.now()) => {
  const timestamp = Number(point?.timestamp || Date.parse(point?.at || ''));
  return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp <= GPS_LIVE_STALE_AFTER_MS;
};
