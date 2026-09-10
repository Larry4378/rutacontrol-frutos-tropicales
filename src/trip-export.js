import * as XLSX from 'xlsx';

export const TRIP_EXPORT_HEADERS = [
  'Fecha de salida',
  'Hora de salida',
  'Fecha de llegada',
  'Hora de llegada',
  'Vehículo',
  'Conductor',
  'Origen',
  'Destino',
  'Kilometraje de salida',
  'Kilometraje de llegada',
  'Total recorrido (km)',
  'Estado',
  'Observaciones',
];

const hasValue = value => value !== null && value !== undefined && value !== '';

const excelDate = value => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '');
};

export const buildTripExportRows = (trips, { vehicleName, driverName }) => trips.map(trip => {
  const finished = hasValue(trip.endKm);
  const startKm = hasValue(trip.startKm) ? Number(trip.startKm) : '';
  const endKm = finished ? Number(trip.endKm) : '';
  const totalKm = finished && Number.isFinite(startKm) && Number.isFinite(endKm)
    ? Math.max(0, endKm - startKm)
    : '';
  return [
    excelDate(trip.departureDate),
    trip.departureTime || '',
    finished ? excelDate(trip.returnDate) : '',
    finished ? trip.returnTime || '' : '',
    vehicleName(trip),
    driverName(trip),
    trip.origin || '',
    trip.destination || '',
    Number.isFinite(startKm) ? startKm : '',
    Number.isFinite(endKm) ? endKm : '',
    totalKm,
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
