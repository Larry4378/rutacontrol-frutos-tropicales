import * as XLSX from 'xlsx';

export const TRIP_EXPORT_HEADERS = [
  'Semana',
  'Mes-año',
  'Día de la semana',
  'Fecha',
  'Conductor',
  'Vehículo',
  'Hora inicio',
  'Hora término',
  'Km inicial',
  'Km final',
  'Km recorrido',
  'Tipo de vehículo',
  'Origen',
  'Destino',
  'GPS origen',
  'GPS destino',
  'Estado',
  'Observaciones',
];

const hasValue = value => value !== null && value !== undefined && value !== '';

const excelDate = value => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '');
};

const dateObject = value => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(`${value}T12:00:00`) : null;
};

const excelMonthYear = value => {
  const date = dateObject(value);
  return date ? `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}` : '';
};

const excelWeekNumber = value => {
  const date = dateObject(value);
  if (!date) return '';
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  return Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
};

const excelWeekday = value => {
  const date = dateObject(value);
  return date ? new Intl.DateTimeFormat('es-PE', { weekday: 'long' }).format(date) : '';
};

const excelVehicleType = value => String(value || '').trim() === 'Camioneta' ? 'Carro' : String(value || '').trim() || 'Carro';
const gpsCoordinates = point => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))
  ? `${Number(point.lat).toFixed(6)}, ${Number(point.lng).toFixed(6)}`
  : '';

export const buildTripExportRows = (trips, { vehicleName, driverName, vehicleType }) => trips.map(trip => {
  const finished = hasValue(trip.endKm);
  const startKm = hasValue(trip.startKm) ? Number(trip.startKm) : '';
  const endKm = finished ? Number(trip.endKm) : '';
  const totalKm = finished && Number.isFinite(startKm) && Number.isFinite(endKm)
    ? Math.max(0, endKm - startKm)
    : '';
  return [
    excelWeekNumber(trip.departureDate),
    excelMonthYear(trip.departureDate),
    excelWeekday(trip.departureDate),
    excelDate(trip.departureDate),
    driverName(trip),
    vehicleName(trip),
    trip.departureTime || '',
    finished ? trip.returnTime || '' : '',
    Number.isFinite(startKm) ? startKm : '',
    Number.isFinite(endKm) ? endKm : '',
    totalKm,
    excelVehicleType(vehicleType?.(trip)),
    trip.origin || '',
    trip.destination || '',
    gpsCoordinates(trip.routePoints?.[0]),
    finished ? gpsCoordinates(trip.routePoints?.at(-1)) : '',
    finished ? 'Finalizado' : 'En ruta',
    trip.notes || '',
  ];
});

const csvCell = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).replace('.', ',');
  let text = String(value ?? '');
  // Evita que un texto ingresado por un usuario sea interpretado por Excel
  // como fórmula al abrir el archivo.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export const buildTripExportCsv = rows => {
  const table = [TRIP_EXPORT_HEADERS, ...rows]
    .map(row => row.map(csvCell).join(';'))
    .join('\r\n');
  // Excel en configuración regional peruana reconoce el separador indicado.
  return `\ufeffsep=;\r\n${table}`;
};

export const buildTripExportXlsx = rows => {
  const worksheet = XLSX.utils.aoa_to_sheet([TRIP_EXPORT_HEADERS, ...rows]);
  const lastRow = rows.length + 1;
  const lastColumn = String.fromCharCode(64 + TRIP_EXPORT_HEADERS.length);
  worksheet['!autofilter'] = { ref: `A1:${lastColumn}${lastRow}` };
  worksheet['!freeze'] = { ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
  worksheet['!cols'] = TRIP_EXPORT_HEADERS.map(header => ({ wch: Math.min(32, Math.max(14, header.length + 2)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Recorridos');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true });
};
