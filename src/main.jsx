import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createWorker } from 'tesseract.js';
import L from 'leaflet';
import { supabase } from './supabase';
import { GPS_TRACKING_MAX_ACCURACY_METERS, gpsDistanceMeters, shouldKeepGpsPoint, stabilizeGpsPoint } from './gps.js';
import { isArrivalKilometerGreater, isPositiveKilometer, normalizeKilometerInput } from './odometer-form.js';
import 'leaflet/dist/leaflet.css';
import '../styles.css';
import '../mango.css';
import './quick.css';
import './sidebar.css';
import './maintenance-clean.css';

const empty = { vehicles: [], trips: [], maintenance: [], fuels: [], expenses: [] };
const read = () => JSON.parse(localStorage.getItem('rutacontrol-react') || localStorage.getItem('rutacontrol-v2') || 'null') || empty;
const id = () => crypto.randomUUID();
const date = value => value ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)) : '—';
const money = value => `S/ ${Number(value || 0).toFixed(2)}`;
const currentKm = (data, vehicle) => Math.max(Number(vehicle.km || 0), ...data.trips.filter(t => t.vehicleId === vehicle.id).map(t => Number(t.endKm || t.startKm || 0)));
const gpsRouteKm = points => (points || []).slice(1).reduce((total, point, index) => {
  return total + gpsDistanceMeters(points[index], point) / 1000;
}, 0);
// Un recorrido se considera pendiente solo mientras no tenga kilometraje final
// ni haya sido confirmado como finalizado en Supabase.
const isTripOpen = trip => (trip?.endKm === null || trip?.endKm === undefined || trip?.endKm === '') && trip?.status !== 'Finalizado';
const today = () => { const local = new Date(); local.setMinutes(local.getMinutes() - local.getTimezoneOffset()); return local.toISOString().slice(0, 10); };
const now = () => new Date().toTimeString().slice(0, 8);
const normalizePlace = value => String(value || '')
  .toLocaleLowerCase('es-PE')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]/g, '');
const receiptNumber = value => {
  const raw = String(value || '').replace(/[^\d.,]/g, '');
  if (!raw) return NaN;
  const separators = raw.match(/[.,]/g) || [];
  if (!separators.length) return Number(raw);
  const lastSeparator = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  const decimals = raw.length - lastSeparator - 1;
  return Number(separators.length === 1 && decimals <= 2 ? raw.replace(',', '.') : raw.replace(/[.,]/g, ''));
};
const receiptQuantity = value => {
  const raw = String(value || '').replace(/[^\d.,]/g, '');
  if (!raw) return NaN;
  const separators = raw.match(/[.,]/g) || [];
  return Number(separators.length === 1 ? raw.replace(',', '.') : raw.replace(/[.,]/g, ''));
};
const completePeruvianRuc = value => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) return digits;
  if (digits.length !== 10) return '';
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const remainder = digits.split('').reduce((sum, digit, index) => sum + Number(digit) * weights[index], 0) % 11;
  const verifier = 11 - remainder;
  return `${digits}${verifier === 10 ? 0 : verifier === 11 ? 1 : verifier}`;
};
// En las placas impresas es frecuente que el OCR confunda caracteres similares
// (por ejemplo, «B» por «8»). La normalización solo corrige posiciones que
// claramente forman parte de una matrícula, sin modificar el texto del recibo.
const plateDigitFromOcr = character => ({
  O: '0', Q: '0', D: '0',
  I: '1', L: '1',
  Z: '2',
  E: '3',
  S: '5',
  G: '6',
  T: '7',
  B: '8'
}[String(character || '').toUpperCase()] || character);
const normalizeReceiptPlate = value => {
  const compact = String(value || '').replace(/[^A-Za-z0-9]/g, '');
  if (compact.length < 5 || compact.length > 8) return compact.toUpperCase();
  const characters = [...compact];
  // Las tres últimas posiciones de una placa de seis caracteres suelen ser
  // numéricas. Ahí sí es seguro corregir B → 8, S → 5, O → 0, etc.
  if (characters.length === 6) {
    [3, 4, 5].forEach(index => {
      characters[index] = plateDigitFromOcr(characters[index]);
    });
    // Tesseract puede leer el «5» impreso como una «a» minúscula. En una
    // matrícula del patrón P5H827, el contexto deja claro que es un dígito.
    if (/^[A-Z]$/.test(characters[0]) && /^[a-z]$/.test(characters[1]) && /^[A-Z]$/.test(characters[2]) && characters.slice(3).every(character => /\d/.test(character))) {
      const secondCharacter = { a: '5', s: '5', b: '8', g: '6', z: '2', o: '0', i: '1', l: '1' }[characters[1].toLowerCase()];
      if (secondCharacter) characters[1] = secondCharacter;
    }
  }
  return characters.join('').toUpperCase();
};
const receiptInfo = text => {
  const lines = text.split(/\r?\n/).map(line => line.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const allText = lines.join(' ');
  const findLine = expression => lines.find(line => expression.test(line)) || '';
  const valueAfterLabel = expression => {
    const index = lines.findIndex(line => expression.test(line));
    if (index < 0) return '';
    const value = lines[index].replace(expression, '').replace(/^\s*[:.-]\s*/, '').trim();
    return value || lines[index + 1] || '';
  };
  const totalIndex = lines.findIndex(line => /(monto\s*final|costo\s*total|importe\s*total|total\s*(a\s*pagar|venta)?)/i.test(line));
  const totalCandidates = (totalIndex >= 0 ? lines.slice(totalIndex, totalIndex + 3) : lines).join(' ').match(/\d{1,5}[.,]\d{2}\b/g) || [];
  const totals = totalCandidates.map(value => Number(value.replace(',', '.'))).filter(value => value > 0);
  const total = totals.length ? Math.max(...totals) : NaN;
  const company = findLine(/(coesti|primax|repsol|petroperu|puma|pecsa|full|elizabeth|huertas|corporaci[oó]n|abastecedor|grifo|estaci[oó]n)/i);
  const providerName = company.match(/\b(?:coesti(?:\s+s\.?a\.?)?|corporaci[oó]n(?:\s+hermanos\s+huertas)?(?:\s+s\.?c\.?r\.?l\.?)?|primax|repsol|petroper[uú]|puma|pecsa|grifo\s+elizabeth)\b/i)?.[0] || company;
  const station = findLine(/\b(e\/?s|eess|estaci[oó]n de servicio|grifo)\b/i);
  const provider = providerName.replace(/\s*[-–]?\s*r\.?u\.?c\.?\s*[:+]?\s*\d{8,11}.*/i, '').replace(/^(grifo|estaci[oó]n(?: de servicio)?)\s*[:.-]?\s*/i, '').replace(/^coesti\s+s\.?a\.?$/i, 'COESTI S.A.');
  const productLine = findLine(/(g-?premium|max-?d|diesel|gasohol|gasolina|biodiesel|gnv|glp)/i);
  const productRaw = productLine.match(/(?:g-?premium|max-?d\s+diesel(?:\s+b\d+)?(?:\s+s\d+)?(?:\s+uv)?|gasohol(?:\s+(?:regular|premium|super))?|gasolina(?:\s+\w+)?|diesel(?:\s+\w+)?|biodiesel|gnv|glp)/i)?.[0] || productLine;
  const product = productRaw.replace(/\bdiesel\s+6([0-9])\b/i, 'DIESEL B$1');
  const gallonLine = findLine(/\b(gal(?:ones)?|gals?|gll|ugl|gl)\b/i);
  const gallonsBeforeUnit = gallonLine.match(/(\d{1,4}(?:[.,]\d{1,3})?)\s*(?:gal(?:ones)?|gals?|gll|ugl|gl)\b/i)?.[1];
  const gallonsAfterUnit = gallonLine.match(/(?:gal(?:ones)?|gals?|gll|ugl|gl)\s*[:.]?\s*(\d{1,4}(?:[.,]\d{1,3})?)/i)?.[1];
  const productNumbers = productLine.match(/\d{1,4}(?:[.,]\d{1,3})?/g) || [];
  // Sin unidad visible solo confiamos en una cantidad decimal: evita convertir 1.168 mal leído en 168 galones.
  const productQuantity = productNumbers.find(value => /[.,]/.test(value) && receiptQuantity(value) > 0 && receiptQuantity(value) < 100) || '';
  // Algunos tickets muestran «12.500 GLL» y otros «GLL 14.641».
  // Se descartan números de tarjeta, vale o lote que suelen quedar junto a la unidad.
  const gallons = [gallonsBeforeUnit, gallonsAfterUnit, productQuantity]
    .map(receiptQuantity)
    .find(value => Number.isFinite(value) && value > 0 && value < 1000);
  const price = receiptNumber(productNumbers.length >= 3 && productNumbers.some(value => /[.,]/.test(value)) ? productNumbers.at(-2) : '');
  const odometerLine = findLine(/(kilo[a-z]{0,12}|od[oó]metro|\bodo\b|\bkm\s*:)/i);
  const odometer = receiptNumber(odometerLine.match(/[\d.,]{3,}/)?.[0]);
  const documentTypeLine = findLine(/\b(factura(?: de venta)?|boleta|nota de despacho|ticket|vale)\b/i);
  const documentType = documentTypeLine.match(/factura(?: de venta)?|boleta|nota de despacho|ticket|vale/i)?.[0] || '';
  const numberLine = findLine(/\b(?:n(?:[e°ºo]|ro|[úu]mero|umero)?)\s*[:.-]\s*[a-z0-9]/i);
  const documentNumber = lines.join(' ').match(/\b([A-Z]{1,4}\d{1,5}\s*-\s*\d{5,})\b/i)?.[1]?.replace(/\s/g, '')
    || numberLine.match(/([A-Z]{0,4}\d{1,5}\s*-?\s*\d{5,})/i)?.[1]?.replace(/\s/g, '')
    || numberLine.match(/\b\d{6,}\b/)?.[0] || '';
  const issuedAt = allText.match(/\b\d{2}[\/-]\d{2}[\/-]\d{2,4}\s+(?:hora\s*)?\d{1,2}:\d{2}(?::\d{2})?\b/i)?.[0]
    || allText.match(/\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/i)?.[0]
    || allText.match(/\b\d{1,2}\s+de\s+\S+\s+de\s+\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/i)?.[0] || '';
  const numericDate = issuedAt.match(/(\d{2})[\/-](\d{2})[\/-](\d{4})/);
  const monthNames = { enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12' };
  const writtenDate = issuedAt.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i);
  const documentDate = numericDate ? `${numericDate[3]}-${numericDate[2]}-${numericDate[1]}` : writtenDate && monthNames[writtenDate[2].toLowerCase()] ? `${writtenDate[3]}-${monthNames[writtenDate[2].toLowerCase()]}-${writtenDate[1].padStart(2, '0')}` : '';
  const rucLine = findLine(/\br\.?u\.?c\.?\b/i);
  const rucRead = rucLine.match(/\b\d{10,11}\b/)?.[0] || '';
  const ruc = completePeruvianRuc(rucRead);
  const plateLine = findLine(/\bplaca\b/i);
  const plateRaw = plateLine.match(/placa\s*:?\s*([A-Z0-9-]{5,12})/i)?.[1] || '';
  const plate = normalizeReceiptPlate(plateRaw);
  const driverLine = findLine(/\b(chofer|conductor)\b/i);
  const driver = driverLine.replace(/^.*?(?:chofer|conductor)\s*:?\s*/i, '');
  const cardLine = findLine(/\b(?:tar\s*jeta|ar\s*jeta|card)\b/i);
  const cardNumber = cardLine.match(/(?:(?:tar|ar)\s*jeta|card)\s*:?\s*([0-9]{8,})/i)?.[1] || '';
  const siteRaw = station || findLine(/(?:car\.?|av\.?|km\.?|sede|casma|piura|sullana|tambogrande)/i);
  const site = /e\s*\/?\s*s\s+(?:lasha|casha|casma)/i.test(siteRaw) ? 'E/S Casma' : siteRaw;
  const customer = valueAfterLabel(/.*?(?:raz[óo]n\s+social|raz\.?\s*soc\.?)/i);
  const address = valueAfterLabel(/.*?(?:direcc(?:i[oó]n)?|domicilio)/i);
  const payment = valueAfterLabel(/.*?(?:forma\s+de\s+pago|pago)/i);
  const shiftLine = findLine(/(?:turno|cara|cajero)/i);
  const sideLine = findLine(/(?:lado|isla)\s*:/i);
  const terminalLine = findLine(/\bterminal\b/i);
  const details = [
    ['receiptDocumentType', 'Tipo de comprobante', documentType],
    ['receiptSite', 'Lugar / sede', site],
    ['receiptNumber', 'Número de vale', documentNumber],
    ['receiptIssuedAt', 'Fecha de emisión', issuedAt],
    ['receiptRuc', rucRead.length === 10 ? 'RUC del proveedor (completado)' : 'RUC del proveedor', ruc],
    ['receiptPlate', 'Placa indicada', plate],
    ['receiptDriver', 'Chofer indicado', driver],
    ['cardNumber', 'Número de tarjeta', cardNumber],
    ['unitPrice', 'Precio por galón S/', Number.isFinite(price) && price > 0 && price < 100 ? String(price) : ''],
    ['receiptCustomer', 'Razón social / cliente', customer],
    ['receiptAddress', 'Dirección indicada', address],
    ['receiptPayment', 'Forma de pago', payment],
    ['receiptShift', 'Turno / cara / cajero', shiftLine],
    ['receiptSide', 'Lado / isla', sideLine],
    ['receiptTerminal', 'Terminal', terminalLine]
  ].filter(([, , value]) => value).map(([key, label, value]) => ({ key, label, value }));
  return { total, provider, product, gallons, odometer, plate, documentDate, details, hasUsefulData: Boolean(provider || product || Number.isFinite(gallons) || Number.isFinite(odometer) || Number.isFinite(total) || details.length) };
};

const mergeReceiptInfo = readings => {
  const candidates = readings.map(receiptInfo);
  const firstText = key => candidates.map(candidate => candidate[key]).find(value => typeof value === 'string' && value.trim());
  const firstNumber = key => candidates.map(candidate => candidate[key]).find(value => Number.isFinite(value) && value > 0);
  const details = new Map();
  candidates.forEach(candidate => candidate.details.forEach(detail => {
    const current = details.get(detail.key);
    if (!current || String(detail.value).length > String(current.value).length) details.set(detail.key, detail);
  }));
  const provider = firstText('provider') || '';
  const product = firstText('product') || '';
  const plate = firstText('plate') || '';
  const gallons = firstNumber('gallons');
  const odometer = firstNumber('odometer');
  const total = firstNumber('total');
  const documentDate = firstText('documentDate') || '';
  return { provider, product, plate, gallons, odometer, total, documentDate, details: [...details.values()], hasUsefulData: Boolean(provider || product || plate || Number.isFinite(gallons) || Number.isFinite(odometer) || Number.isFinite(total) || details.size) };
};

const prepareReceiptImage = async (file, mode = 'wide') => {
  if (!window.createImageBitmap) return file;
  const image = await createImageBitmap(file);
  try {
    const crop = mode === 'plate'
      ? { x: 0.28, y: 0.66, width: 0.44, height: 0.18 }
      : mode === 'focus'
        ? { x: 0.14, y: 0.10, width: 0.72, height: 0.86 }
        : { x: 0.08, y: 0.06, width: 0.84, height: 0.90 };
    const sourceX = Math.round(image.width * crop.x);
    const sourceY = Math.round(image.height * crop.y);
    const sourceWidth = Math.round(image.width * crop.width);
    const sourceHeight = Math.round(image.height * crop.height);
    const scale = Math.min(3, 2200 / sourceWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.filter = 'grayscale(1) contrast(1.85) brightness(1.12)';
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.96);
  } finally {
    image.close?.();
  }
};

const readReceiptWithOcr = async file => {
  const enhanced = await prepareReceiptImage(file, 'wide').catch(() => file);
  const focused = await prepareReceiptImage(file, 'focus').catch(() => file);
  const plateImage = await prepareReceiptImage(file, 'plate').catch(() => file);
  const worker = await createWorker('eng');
  try {
    const original = await worker.recognize(file);
    const improved = enhanced === file ? { data: { text: '' } } : await worker.recognize(enhanced);
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    const focusedResult = focused === file ? { data: { text: '' } } : await worker.recognize(focused);
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const plateResult = plateImage === file ? { data: { text: '' } } : await worker.recognize(plateImage);
    return [original.data.text, improved.data.text, focusedResult.data.text, plateResult.data.text].filter(Boolean);
  } finally {
    await worker.terminate();
  }
};

const plateKey = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const isPlateLookalike = (left, right) => ['0O', '1I', '1L', '5S', '2Z', '8B', '6G'].includes([left, right].sort().join(''));
const findVehicleFromPlateOcr = (text, vehicles) => {
  const scanned = plateKey(text);
  const scoresByVehicle = new Map();
  for (const vehicle of vehicles) {
    const target = plateKey(vehicle.plate);
    if (!target || scanned.length < target.length) continue;
    for (let index = 0; index <= scanned.length - target.length; index += 1) {
      const candidate = scanned.slice(index, index + target.length);
      const score = [...target].reduce((total, character, position) => total + (character === candidate[position] ? 0 : isPlateLookalike(character, candidate[position]) ? 0.25 : 1), 0);
      const previous = scoresByVehicle.get(vehicle.id);
      if (!previous || score < previous.score) scoresByVehicle.set(vehicle.id, { vehicle, score });
    }
  }
  const matches = [...scoresByVehicle.values()].sort((left, right) => left.score - right.score);
  const [best, next] = matches;
  return best && best.score <= 2 && (!next || next.score - best.score >= 0.5) ? { ...best, approximate: best.score > 0.25 } : null;
};
const withOcrTimeout = (promise, milliseconds = 15000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('OCR_TIMEOUT')), milliseconds)),
]);
const preparePlateImage = async file => {
  if (!window.createImageBitmap) return file;
  const image = await createImageBitmap(file);
  try {
    const cropWidth = Math.round(image.width * 0.34);
    const cropHeight = Math.round(image.height * 0.24);
    const cropX = Math.round((image.width - cropWidth) / 2);
    const cropY = Math.round(image.height * 0.33);
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 620;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.95);
  } finally {
    image.close?.();
  }
};
const readPlateWithOcr = async file => {
  let worker;
  try {
    const plateImage = await withOcrTimeout(preparePlateImage(file), 5000);
    worker = await withOcrTimeout(createWorker('eng', undefined, { langPath: new URL('./tessdata', window.location.href).href }));
    await withOcrTimeout(worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-' }));
    const result = await withOcrTimeout(worker.recognize(plateImage));
    return result.data;
  } finally {
    if (worker) await worker.terminate();
  }
};
function LegacyPhotoSource({onChange,accept='image/*',withCamera=true}) { const [fileName,setFileName]=useState('');const select=e=>{const file=e.target.files?.[0];setFileName(file?.name||'');onChange(e);};return <div className="photo-source">{withCamera&&<label>◉ Tomar foto<input type="file" accept={accept} capture="environment" onChange={select}/></label>}<label>▣ Elegir de galería<input type="file" accept={accept} onChange={select}/></label>{fileName&&<small className="photo-loaded">✓ Foto cargada: {fileName}</small>}</div>; }

function App() {
  const [data, setData] = useState(read);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [view, setView] = useState('dashboard');
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [profile, setProfile] = useState(null);
  const [profileReady, setProfileReady] = useState(false);
  const [drivers, setDrivers] = useState([]);
  const [driverPreview, setDriverPreview] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => localStorage.setItem('rutacontrol-react', JSON.stringify(data)), [data]);
  useEffect(() => { const timer = setTimeout(() => setShowSplash(false), 1900); return () => clearTimeout(timer); }, []);
  useEffect(() => {
    const changeSession = nextSession => {
      // Nunca reutilizamos el historial local de una persona en la sesión de otra.
      setData(empty);
      setProfile(null);
      setDrivers([]);
      setProfileReady(false);
      setSession(nextSession);
    };
    supabase.auth.getSession().then(({ data: { session } }) => { changeSession(session); setAuthReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => changeSession(nextSession));
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) return;
    supabase.from('vehicles').select('id, plate, brand, model, vehicle_type, current_km, ownership, status').order('plate')
      .then(({ data: vehicles, error: loadError }) => {
        if (loadError) return setError(`No se pudieron cargar los vehículos: ${loadError.message}`);
        setData(previous => ({ ...previous, vehicles: vehicles.map(vehicle => ({ ...vehicle, km: vehicle.current_km })) }));
      });
  }, [session]);
  useEffect(() => {
    // Espera a conocer el rol antes de pedir datos: así un chofer nunca hace
    // una consulta general de recorridos mientras se inicializa la aplicación.
    if (!session || !profileReady || !profile) return;
    let active = true;
    const loadTrips = async () => {
      // El historial no necesita descargar miles de puntos GPS antiguos.
      // Cargar solo las rutas que siguen abiertas hace que la aplicación
      // vuelva a estar lista mucho más rápido al regresar desde el celular.
      const ownId = profile.id || session.user.id;
      const ownTripsOnly = profile.role === 'driver';
      let tripsRequest = supabase
        .from('trips')
        .select('id,vehicle_id,driver_id,driver_profile_id,departure_at,return_at,origin,destination,start_km,end_km,status,notes')
        .order('departure_at', { ascending: false });
      if (ownTripsOnly) tripsRequest = tripsRequest.or(`driver_profile_id.eq.${ownId},driver_id.eq.${ownId}`);
      const { data: trips, error: loadError } = await tripsRequest;
      if (!active) return;
      if (loadError) return setError(`No se pudieron cargar los recorridos: ${loadError.message}`);
      let routesRequest = supabase
        .from('trips')
        .select('id,route_points')
        .is('end_km', null);
      if (ownTripsOnly) routesRequest = routesRequest.or(`driver_profile_id.eq.${ownId},driver_id.eq.${ownId}`);
      const { data: openRoutes, error: routeLoadError } = await routesRequest;
      if (!active) return;
      if (routeLoadError) return setError(`No se pudieron cargar las rutas activas: ${routeLoadError.message}`);
      const routesByTrip = new Map((openRoutes || []).map(trip => [trip.id, trip.route_points || []]));
      setData(previous => ({ ...previous, trips: (trips || []).map(trip => ({
          id: trip.id, vehicleId: trip.vehicle_id, driver: trip.driver_id, driverProfileId: trip.driver_profile_id || trip.driver_id, departureDate: trip.departure_at?.slice(0, 10), departureTime: trip.departure_at?.slice(11, 19),
          returnDate: trip.return_at?.slice(0, 10), returnTime: trip.return_at?.slice(11, 19), origin: trip.origin, destination: trip.destination,
          startKm: trip.start_km, endKm: trip.end_km, status: trip.status, routePoints: routesByTrip.get(trip.id) || [], notes: trip.notes, _saved: true,
      })) }));
    };
    const refreshWhenReturning = () => {
      if (document.visibilityState === 'visible') loadTrips();
    };
    loadTrips();
    window.addEventListener('focus', loadTrips);
    document.addEventListener('visibilitychange', refreshWhenReturning);
    // Respaldo de sincronización para los teléfonos que no tengan Realtime activo:
    // muestra en pocos segundos las posiciones que envía el celular del chofer.
    const syncTimer = window.setInterval(loadTrips, 5000);
    return () => {
      active = false;
      window.removeEventListener('focus', loadTrips);
      document.removeEventListener('visibilitychange', refreshWhenReturning);
      window.clearInterval(syncTimer);
    };
  }, [session, profileReady, profile?.id, profile?.role]);
  useEffect(() => {
    if (!session || !profileReady || !profile) return;
    let active = true;
    const loadMaintenance = async () => {
      const { data: rows, error: loadError } = await supabase
        .from('maintenance_records')
        .select('id,vehicle_id,service_type,service_date,service_km,next_date,next_km,notes,created_by,created_at')
        .order('service_date', { ascending: false });
      if (!active) return;
      if (loadError) return setError(`No se pudieron cargar los mantenimientos: ${loadError.message}`);
      setData(previous => ({ ...previous, maintenance: (rows || []).map(row => ({
        id: row.id, vehicleId: row.vehicle_id, type: row.service_type, date: row.service_date,
        serviceKm: row.service_km, nextDate: row.next_date, nextKm: row.next_km,
        notes: row.notes, createdBy: row.created_by, createdAt: row.created_at, _saved: true,
      })) }));
    };
    loadMaintenance();
    window.addEventListener('focus', loadMaintenance);
    return () => { active = false; window.removeEventListener('focus', loadMaintenance); };
  }, [session, profileReady, profile?.id]);
  useEffect(() => {
    if (!session || !profileReady || !profile) return;
    let active = true;
    const loadFuel = async () => {
      let request = supabase
        .from('fuel_records')
        .select('id,vehicle_id,created_by,provider,amount,odometer_km,registered_at,fuel_product,gallons,review_status,receipt_path,receipt_details')
        .order('registered_at', { ascending: false });
      if (profile.role === 'driver') request = request.eq('created_by', profile.id || session.user.id);
      const { data: rows, error: loadError } = await request;
      if (!active) return;
      if (loadError) return setError(`No se pudieron cargar los comprobantes: ${loadError.message}`);
      setData(previous => ({ ...previous, fuels: (rows || []).map(row => ({
        id: row.id, vehicleId: row.vehicle_id, createdBy: row.created_by,
        provider: row.provider, product: row.fuel_product, gallons: row.gallons,
        cost: row.amount, km: row.odometer_km, reviewStatus: row.review_status,
        receiptPath: row.receipt_path, documentDetails: row.receipt_details || [],
        date: row.registered_at?.slice(0, 10), time: row.registered_at?.slice(11, 19), _saved: true,
      })) }));
    };
    loadFuel();
    window.addEventListener('focus', loadFuel);
    return () => { active = false; window.removeEventListener('focus', loadFuel); };
  }, [session, profileReady, profile?.id, profile?.role]);
  const loadUsers = async () => {
    if (!session) {
      setProfile(null);
      setDrivers([]);
      setProfileReady(false);
      return;
    }
    setProfileReady(false);
    const { data: own } = await supabase.from('user_profiles').select('id,full_name,role,is_active,permissions').eq('id', session.user.id).maybeSingle();
    setProfile(own || null);
    if (own?.role === 'admin') {
      const { data: rows } = await supabase.from('user_profiles').select('id,full_name,role,access_code,is_active,permissions,qr_token,created_at').eq('role','driver').order('created_at',{ascending:false});
      setDrivers(rows || []);
    } else setDrivers([]);
    setProfileReady(true);
  };
  useEffect(() => { loadUsers(); }, [session]);
  useEffect(() => {
    if (profile?.role !== 'admin' || !drivers.length || !data.vehicles.length) return;
    const pending = drivers.filter(driver => {
      const vehicle = data.vehicles.find(item => item.id === driver.permissions?.assignedVehicleId);
      return vehicle && driver.permissions?.assignedVehicleLabel !== `${vehicle.plate} · ${vehicle.brand}`;
    });
    if (!pending.length) return;
    Promise.all(pending.map(driver => {
      const vehicle = data.vehicles.find(item => item.id === driver.permissions?.assignedVehicleId);
      return supabase.from('user_profiles').update({ permissions: { ...driver.permissions, assignedVehicleLabel: `${vehicle.plate} · ${vehicle.brand}` } }).eq('id', driver.id);
    })).then(loadUsers);
  }, [profile?.role, drivers, data.vehicles]);
  const update = async (collection, record) => {
    if (collection === 'trips') {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { alert('Debes iniciar sesión para guardar el recorrido.'); return false; }
      // El GPS en vivo solo puede añadir puntos mientras el viaje siga abierto.
      // Nunca debe volver a escribir los campos de salida/llegada: de lo
      // contrario, un punto GPS que llegue unos milisegundos tarde podría
      // reabrir un recorrido que ya fue finalizado.
      if (record._routeTracking) {
        const { data: saved, error: routeError } = await supabase
          .from('trips')
          .update({ route_points: record.routePoints || [] })
          .eq('id', record.id)
          .is('end_km', null)
          .select('id,route_points,status,end_km')
          .maybeSingle();
        if (routeError) {
          console.warn('No se pudo guardar el punto GPS:', routeError.message);
          return false;
        }
        // Si no devuelve fila, la llegada se guardó antes que este punto GPS.
        // Es correcto: no hacemos nada para no reabrir el recorrido.
        if (!saved) return false;
        setData(previous => ({ ...previous, trips: previous.trips.map(trip => trip.id === saved.id ? { ...trip, routePoints: saved.route_points || [] } : trip) }));
        return true;
      }
      const isArrival = record.endKm !== null && record.endKm !== undefined && record.endKm !== '';
      if (isArrival && Number(record.endKm) <= Number(record.startKm)) {
        alert('El kilometraje final debe ser mayor al kilometraje de salida.');
        return false;
      }
      // El nombre visible del conductor nunca se envía a una columna UUID.
      // Para llegadas se conserva el ID que se registró al iniciar la salida.
      const tripDriverId = record.driverProfileId || user.id;
      const tripDriverProfileId = record.driverProfileId || user.id;
      const payload = {
        id: record.id, vehicle_id: record.vehicleId, driver_id: tripDriverId, driver_profile_id: tripDriverProfileId,
        departure_at: `${record.departureDate}T${record.departureTime}`, return_at: isArrival ? `${record.returnDate}T${record.returnTime}` : null,
        origin: record.origin, destination: record.destination || null, start_km: Number(record.startKm), end_km: isArrival ? Number(record.endKm) : null,
        status: isArrival ? 'Finalizado' : 'En ruta', route_points: record.routePoints || [], notes: record.departureNotes || record.notes || null,
      };
      const exists = data.trips.some(trip => trip.id === record.id && trip._saved);
      const request = exists ? supabase.from('trips').update(payload).eq('id', record.id).select().single() : supabase.from('trips').insert(payload).select().single();
      const { data: saved, error: saveError } = await request;
      if (saveError) { alert(`No se pudo guardar el recorrido: ${saveError.message}`); return false; }
      if (isArrival && (saved.status !== 'Finalizado' || saved.end_km === null)) {
        alert('Supabase no confirmó el cierre del recorrido. Inténtalo nuevamente.');
        return false;
      }
      // Reflejamos la respuesta confirmada por Supabase, no solo el formulario.
      // Así la salida pendiente desaparece inmediatamente al guardar la llegada.
      const savedRecord = {
        ...record,
        vehicleId: saved.vehicle_id,
        driver: saved.driver_id,
        driverProfileId: saved.driver_profile_id,
        departureDate: saved.departure_at?.slice(0, 10),
        departureTime: saved.departure_at?.slice(11, 19),
        returnDate: saved.return_at?.slice(0, 10),
        returnTime: saved.return_at?.slice(11, 19),
        origin: saved.origin,
        destination: saved.destination,
        startKm: saved.start_km,
        endKm: saved.end_km,
        status: saved.status,
        routePoints: saved.route_points || [],
        notes: saved.notes,
        _saved: true,
      };
      setData(previous => ({ ...previous, trips: previous.trips.some(trip => trip.id === record.id) ? previous.trips.map(trip => trip.id === record.id ? savedRecord : trip) : [...previous.trips, savedRecord] }));
      const photoPath = isArrival ? record.endPhoto : record.startPhoto;
      const stage = isArrival ? 'return' : 'departure';
      if (photoPath?.startsWith('odometer/')) {
        const { error: evidenceError } = await supabase.from('evidence').insert({ trip_id: saved.id, vehicle_id: record.vehicleId, created_by: user.id, storage_path: photoPath, media_type: 'image', stage });
        if (evidenceError) console.warn('No se pudo enlazar la evidencia:', evidenceError.message);
      }
      return true;
    }
    if (collection === 'maintenance') {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { alert('Debes iniciar sesión para guardar el mantenimiento.'); return false; }
      const payload = {
        id: record.id,
        vehicle_id: record.vehicleId,
        created_by: user.id,
        service_type: record.type || 'Afinamiento general',
        service_date: record.date || today(),
        service_km: Number(record.serviceKm),
        next_date: record.nextDate || null,
        next_km: record.nextKm === '' || record.nextKm === undefined ? null : Number(record.nextKm),
        notes: record.notes || null,
      };
      const request = record._saved
        ? supabase.from('maintenance_records').update(payload).eq('id', record.id).select().single()
        : supabase.from('maintenance_records').insert(payload).select().single();
      const { data: saved, error: saveError } = await request;
      if (saveError) { alert(`No se pudo guardar el mantenimiento: ${saveError.message}`); return false; }
      const savedRecord = {
        id: saved.id, vehicleId: saved.vehicle_id, type: saved.service_type, date: saved.service_date,
        serviceKm: saved.service_km, nextDate: saved.next_date, nextKm: saved.next_km,
        notes: saved.notes, createdBy: saved.created_by, createdAt: saved.created_at, _saved: true,
      };
      setData(previous => ({ ...previous, maintenance: previous.maintenance.some(item => item.id === saved.id) ? previous.maintenance.map(item => item.id === saved.id ? savedRecord : item) : [...previous.maintenance, savedRecord] }));
      return true;
    }
    if (collection === 'fuels') {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { alert('Debes iniciar sesión para enviar el comprobante.'); return false; }
      if (!record.vehicleId) { alert('No se pudo identificar el vehículo del comprobante.'); return false; }
      const recordId = record.id || id();
      let receiptPath = record.receiptPath || null;
      if (record.receiptFile) {
        let receiptFile;
        try {
          receiptFile = await prepareImageForUpload(record.receiptFile);
        } catch (error) {
          alert(`No se pudo preparar la foto del comprobante: ${error.message}`);
          return false;
        }
        const extension = (receiptFile.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        receiptPath = `fuel/${user.id}/${recordId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from('vehicle-evidence').upload(receiptPath, receiptFile, {
          contentType: receiptFile.type || 'image/jpeg', upsert: false,
        });
        if (uploadError) { alert(`No se pudo guardar la foto del comprobante: ${uploadError.message}`); return false; }
      }
      const toNumberOrNull = value => value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
      const payload = {
        id: recordId, vehicle_id: record.vehicleId, created_by: record.createdBy || user.id,
        provider: record.provider || null, amount: toNumberOrNull(record.cost), odometer_km: toNumberOrNull(record.km),
        fuel_product: record.product || null, gallons: toNumberOrNull(record.gallons ?? record.liters),
        review_status: record.reviewStatus || 'Pendiente de revisión', receipt_path: receiptPath,
        receipt_details: record.documentDetails || [],
      };
      const request = record._saved
        ? supabase.from('fuel_records').update(payload).eq('id', recordId).select().single()
        : supabase.from('fuel_records').insert(payload).select().single();
      const { data: saved, error: saveError } = await request;
      if (saveError) { alert(`No se pudo guardar el comprobante: ${saveError.message}`); return false; }
      const savedRecord = {
        id: saved.id, vehicleId: saved.vehicle_id, createdBy: saved.created_by, provider: saved.provider,
        product: saved.fuel_product, gallons: saved.gallons, cost: saved.amount, km: saved.odometer_km,
        reviewStatus: saved.review_status, receiptPath: saved.receipt_path, documentDetails: saved.receipt_details || [],
        date: saved.registered_at?.slice(0, 10) || today(), time: saved.registered_at?.slice(11, 19) || now(), _saved: true,
      };
      setData(previous => ({ ...previous, fuels: previous.fuels.some(item => item.id === saved.id)
        ? previous.fuels.map(item => item.id === saved.id ? savedRecord : item)
        : [savedRecord, ...previous.fuels] }));
      return true;
    }
    if (collection !== 'vehicles') {
      setData(previous => ({ ...previous, [collection]: previous[collection].some(x => x.id === record.id) ? previous[collection].map(x => x.id === record.id ? record : x) : [...previous[collection], { ...record, id: record.id || id() }] }));
      return true;
    }
    const vehicle = { plate: record.plate.trim().toUpperCase(), brand: record.brand, model: record.model, vehicle_type: record.vehicle_type || 'Carro', ownership: record.ownership, current_km: Number(record.km || 0), status: record.status || 'Disponible' };
    // select() devuelve una lista; usar single() generaba un error si Supabase no devolvía una fila.
    const request = record.id ? supabase.from('vehicles').update(vehicle).eq('id', record.id).select() : supabase.from('vehicles').insert(vehicle).select();
    const { data: savedRows, error: saveError } = await request;
    if (saveError) { alert(`No se pudo guardar el vehículo: ${saveError.message}`); return false; }
    const saved = savedRows?.[0];
    if (!saved) { alert('El vehículo no pudo confirmarse en Supabase. Verifica que hayas iniciado sesión como administrador.'); return false; }
    setData(previous => ({ ...previous, vehicles: previous.vehicles.some(item => item.id === saved.id) ? previous.vehicles.map(item => item.id === saved.id ? { ...saved, km: saved.current_km } : item) : [...previous.vehicles, { ...saved, km: saved.current_km }] }));
    return true;
  };
  const remove = async (collection, recordOrId) => {
    const recordId = typeof recordOrId === 'object' ? recordOrId.id : recordOrId;
    if (collection === 'vehicles') {
      const plate = String(recordOrId.plate || '').trim().toUpperCase();
      const typedPlate = prompt(`Protección contra eliminación accidental.\n\nPara eliminar el vehículo ${plate}, escribe su placa exactamente.`);
      if (typedPlate?.trim().toUpperCase() !== plate) return alert('El vehículo no fue eliminado. La placa no coincide.');
    } else if (!confirm('¿Eliminar este registro?')) return;
    if (collection === 'vehicles') { const { error: deleteError } = await supabase.from('vehicles').delete().eq('id', recordId); if (deleteError) return alert(`No se pudo eliminar el vehículo: ${deleteError.message}`); }
    if (collection === 'maintenance') { const { error: deleteError } = await supabase.from('maintenance_records').delete().eq('id', recordId); if (deleteError) return alert(`No se pudo eliminar el mantenimiento: ${deleteError.message}`); }
    if (collection === 'fuels') { const { error: deleteError } = await supabase.from('fuel_records').delete().eq('id', recordId); if (deleteError) return alert(`No se pudo eliminar el comprobante: ${deleteError.message}`); }
    setData(previous => ({ ...previous, [collection]: previous[collection].filter(x => x.id !== recordId) }));
  };
  const tripsKm = data.trips.reduce((total, trip) => total + (trip.endKm ? Math.max(0, Number(trip.endKm) - Number(trip.startKm)) : 0), 0);
  const adminNav=[['dashboard','▦','Inicio'],['trips','↗','Recorridos'],['maintenance','♧','Mantenimiento'],['fuel','◉','Combustible'],['vehicles','▣','Vehículos'],['users','◉','Usuarios'],['reports','⇩','Reportes']];
  const driverPermissions={departure:false,arrival:false,trips:false,fuel:false,maintenance:false,...(profile?.permissions||{})};
  const driverNav=[['dashboard','▦','Inicio'],...(driverPermissions.trips?[['trips','↗','Mis recorridos']]:[]),...(driverPermissions.maintenance?[['maintenance','♧','Mantenimiento']]:[]),...(driverPermissions.fuel?[['fuel','◉','Combustible']]:[])];
  const nav = profile?.role === 'admin' && !driverPreview ? adminNav : driverNav;
  const title = { dashboard:'Inicio',trips:'Historial de recorridos',maintenance:'Mantenimiento y afinamiento',fuel:'Control de combustible',expenses:'Gastos y reparaciones',vehicles:'Vehículos',users:'Usuarios y accesos',reports:'Reportes' }[view];

  if (showSplash) return <SplashScreen/>;
  if (!authReady) return <section className="login-screen"><div className="login-card"><p>Conectando con FTP - ODOMETRO…</p></div></section>;
  if (!session) return <Login error={error} onLogin={async (email, password) => { setError(''); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) setError(error.message); }} onDriverLogin={async (accessCode, pin) => { setError(''); try { const response=await fetch('https://idwyvmhfyfsklykxmcdm.supabase.co/functions/v1/driver-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessCode,pin})}); const result=await response.json().catch(()=>({})); if(!response.ok||result?.error) return setError(result?.error||'No se pudo iniciar sesión.'); const {error: sessionError}=await supabase.auth.setSession(result.session); if(sessionError)setError(sessionError.message); } catch { setError('No se pudo conectar con el acceso de chofer.'); } }} onRegister={async (name, email, password) => { setError(''); const { data: result, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } }); if (error) setError(error.message); else if (!result.session) setError('Revisa tu correo para confirmar la cuenta y luego ingresa.'); }} />;
  return <>
    <DriverVehicleAssignment profile={profile} driverPreview={driverPreview} modal={modal}/>
    <KilometerInputGuard />
    <MaintenanceFormHelper active={modal?.type === 'maintenance'} />
    <aside className="sidebar"><div className="company-name">FRUTOS TROPICALES<br/><span>EXPORT. PERÚ</span></div><div className="brand"><span className="brand-mark">F</span><span>FTP - ODOMETRO</span></div><nav>{nav.map(([key, icon, label]) => <button key={key} className={`nav-link ${view === key ? 'active' : ''}`} onClick={() => { setView(key); setModal(null); }}>{icon}<span>{label}</span></button>)}</nav><div className="sidebar-note">{session.user.email}<br/><small>{driverPreview?'Vista de chofer · Administración conservada':'Sesión segura · Administrador'}</small>{profile?.role==='admin'&&<button className="sidebar-preview" onClick={()=>{setDriverPreview(value=>!value);setView('dashboard');setModal(null);}}>{driverPreview?'↩ Volver a administrador':'◉ Vista de chofer'}</button>}<button className="sidebar-logout" onClick={() => supabase.auth.signOut()}>↪ Salir</button></div></aside>
    <main className={modal ? 'modal-open' : ''}>{error && <p className="sync-error">{error}</p>}<header><div><p className="eyebrow">FRUTOS TROPICALES EXPORT. PERÚ · CONTROL VEHICULAR</p><h1>{title}</h1></div><button className="mobile-logout" onClick={() => supabase.auth.signOut()}>↪ Cerrar sesión</button></header>
      {view === 'dashboard' && <MaintenanceAlerts data={data} profile={profile} driverPreview={driverPreview} onGo={setView} />}
      {view === 'dashboard' && <Dashboard data={data} profile={profile} driverPreview={driverPreview} km={tripsKm} permissions={profile?.role === 'driver' && !driverPreview ? driverPermissions : {departure:true,arrival:true}} driverName={profile?.role === 'driver' ? profile.full_name : ''} onGo={setView} onDeparture={() => setModal({type:'quickDeparture'})} onReturn={() => setModal({type:'quickReturn'})} onTripUpdate={record => update('trips',record)} tripForm={modal?.type === 'quickDeparture' ? <DepartureGpsRequired data={data} driverName={profile?.role === 'driver' ? profile.full_name : ''} driverId={profile?.role === 'driver' && !driverPreview ? profile.id : ''} assignedVehicleId={profile?.role === 'driver' && !driverPreview ? profile.permissions?.assignedVehicleId : ''} assignedVehicleLabel={profile?.role === 'driver' && !driverPreview ? profile.permissions?.assignedVehicleLabel : ''} onClose={() => setModal(null)} onSave={async record => { const saved={...record,...(window.departureEvidence||{}),departureDate:today(),departureTime:now()}; const registered=await update('trips',saved); if(registered){setModal(null);setSuccessMessage('Salida registrada correctamente.');} return registered; }} /> : modal?.type === 'quickReturn' ? <ArrivalSimple data={data} driverName={profile?.role === 'driver' && !driverPreview ? profile.full_name : ''} driverId={profile?.role === 'driver' && !driverPreview ? profile.id : ''} onClose={() => setModal(null)} onSave={async record => { const registered=await update('trips',{...record,returnDate:today(),returnTime:now()}); if(registered){setModal(null);setSuccessMessage('Llegada registrada correctamente.');} return registered; }} /> : null} />}
      {view === 'trips' && <List title="Historial de recorridos" text="Consulta, filtra y edita las salidas y llegadas registradas." hideAdd><Trips data={data} drivers={drivers} profile={profile} onEdit={record => setModal({type:'trip',record})} onDelete={record => remove('trips',record.id)} /></List>}
      {view === 'maintenance' && <List title="Mantenimiento" text="Afinamiento, aceite, frenos, neumáticos y revisión técnica." onAdd={() => setModal({type:'maintenance'})}><Maintenance data={data} onEdit={record => setModal({type:'maintenance',record})} onDelete={record => remove('maintenance',record.id)} /></List>}
      {view === 'fuel' && <List title="Control de combustible" text={profile?.role === 'admin' && !driverPreview ? 'Revisa los comprobantes enviados por toda la flota.' : 'Envía tu comprobante y consulta los que ya registraste.'} onAdd={() => setModal({type:'fuel'})}><Fuel data={data} drivers={drivers} profile={profile} isAdmin={profile?.role === 'admin' && !driverPreview} onEdit={record => setModal({type:'fuel',record})} onDelete={record => remove('fuels',record.id)} /></List>}
      {view === 'vehicles' && <List title="Vehículos" text="Administra placa, odómetro y estado." onAdd={() => setModal({type:'vehicle'})}><Vehicles data={data} onEdit={record => setModal({type:'vehicle',record})} onDelete={record => remove('vehicles',record)} /></List>}
      {view === 'reports' && <Reports data={data} />}
      {view === 'users' && <UsersPage drivers={drivers} vehicles={data.vehicles} onChanged={loadUsers}/>}
    </main>
    {modal?.type === 'maintenance' && <MaintenanceModal key={`maintenance-${modal.record?.id||'new'}-${profile?.role === 'driver' && !driverPreview ? driverPermissions.assignedVehicleId||'pending' : 'admin'}`} record={modal.record} data={data} assignedVehicleId={profile?.role === 'driver' && !driverPreview ? driverPermissions.assignedVehicleId : ''} onClose={() => setModal(null)} onSave={async record => { if (await update('maintenance',record)) setModal(null); }} />}
    {modal?.type === 'vehicle' && <VehicleModal record={modal.record} onClose={() => setModal(null)} onSave={async record => { if (await update('vehicles', record)) setModal(null); }} />}
    {modal?.type === 'fuel' && <FuelModalReceipt record={modal.record} data={data} assignedVehicleId={profile?.role === 'driver' && !driverPreview ? profile.permissions?.assignedVehicleId : ''} isAdmin={profile?.role === 'admin' && !driverPreview} onClose={() => setModal(null)} onSave={async record => { const saved = await update('fuels', record); if (saved) { setModal(null); setSuccessMessage('Comprobante enviado correctamente.'); } return saved; }} />}
    {modal && !['quickDeparture','quickReturn','maintenance','vehicle','fuel'].includes(modal.type) && <RecordModal type={modal.type} record={modal.record} data={data} onClose={() => setModal(null)} onSave={(collection, record) => { update(collection,record); setModal(null); }} />}
    {successMessage && <dialog open className="success-dialog" aria-label="Registro confirmado"><div className="success-dialog-content"><span className="success-check" aria-hidden="true">✓</span><h2>Registro confirmado</h2><p>{successMessage}</p><button type="button" className="primary" onClick={() => setSuccessMessage('')}>Entendido</button></div></dialog>}
  </>;
}

function SplashScreen() { return <section className="splash-screen" aria-label="Bienvenida a FTP - ODOMETRO"><span className="splash-ftp" aria-hidden="true">FTP</span><div className="splash-orbit orbit-one"/><div className="splash-orbit orbit-two"/><div className="splash-logo"><span className="splash-leaf"/><span className="splash-mango">●</span></div><p className="splash-company">FRUTOS TROPICALES</p><h1>FTP - ODOMETRO</h1><p className="splash-subtitle">Control vehicular inteligente</p><span className="splash-loader"><i/></span></section>; }

function Login({ onLogin, onDriverLogin, error }) {
  const adminAccess = new URLSearchParams(window.location.search).get('admin') === '1';
  const [driverMode] = useState(() => !adminAccess);
  const [rememberDriver, setRememberDriver] = useState(() => localStorage.getItem('rutacontrol_remember_driver') === 'true');
  const submit = event => {
    event.preventDefault();
    const values = event.target;
    if(driverMode) {
      const accessCode = values.accessCode.value.trim().toUpperCase();
      if (rememberDriver) localStorage.setItem('rutacontrol_driver_code', accessCode);
      else localStorage.removeItem('rutacontrol_driver_code');
      localStorage.setItem('rutacontrol_remember_driver', String(rememberDriver));
      return onDriverLogin(accessCode, values.pin.value);
    }
    return onLogin(values.email.value, values.password.value);
  };
  const savedDriverCode = localStorage.getItem('rutacontrol_driver_code') || '';
  return <section className="login-screen"><form className="login-card" onSubmit={submit}><div className="login-fruit">●</div><p className="eyebrow">FRUTOS TROPICALES EXPORT. PERÚ</p><h1>{driverMode?'Acceso de conductor':'Acceso administrativo'}</h1><p>{driverMode?'Ingresa el código y PIN entregados por el administrador.':'Ingresa con tu correo y contraseña de administrador.'}</p>{driverMode?<><label>Código de acceso</label><input name="accessCode" required autoFocus defaultValue={savedDriverCode} placeholder="Ejemplo: RGARCIA" pattern="[A-Za-z0-9_-]{4,20}"/><label>PIN de 6 números</label><input name="pin" required type="password" inputMode="numeric" pattern="\d{6}" maxLength="6" placeholder="••••••"/><label className="remember-driver"><input type="checkbox" checked={rememberDriver} onChange={event=>setRememberDriver(event.target.checked)}/> Recordar mi código en este equipo</label></>:<><label>Correo electrónico</label><input name="email" type="email" required autoFocus placeholder="correo@empresa.com"/><label>Contraseña</label><input name="password" type="password" required minLength="6" placeholder="Mínimo 6 caracteres"/></>}<p className="login-error">{error}</p><button className="primary">{driverMode?'Ingresar como conductor':'Ingresar como administrador'}</button>{!driverMode&&<button type="button" className="secondary" onClick={()=>window.location.assign(window.location.pathname)}>Volver al acceso de conductor</button>}<small>Acceso protegido por Supabase.</small></form></section>;
}
function Dashboard({ data, profile, driverPreview, permissions, onDeparture, onReturn, onTripUpdate, tripForm }) { return <>{(permissions.departure||permissions.arrival)&&<MangoQuickActions permissions={permissions} onDeparture={onDeparture} onReturn={onReturn}/>} {tripForm}<RouteMap data={data} profile={profile} driverPreview={driverPreview} onUpdate={onTripUpdate}/></>; }

function MaintenanceAlerts({data, profile, driverPreview, onGo}) {
  const alerts = useMemo(() => {
    const assignedVehicleId = profile?.role === 'driver' && !driverPreview ? profile?.permissions?.assignedVehicleId : '';
    const latestByVehicle = new Map();
    for (const maintenance of data.maintenance || []) {
      if (!maintenance.vehicleId) continue;
      const previous = latestByVehicle.get(maintenance.vehicleId);
      if (!previous || String(maintenance.date || '') > String(previous.date || '')) latestByVehicle.set(maintenance.vehicleId, maintenance);
    }
    const alertsForDashboard = [];
    for (const [vehicleId, maintenance] of latestByVehicle) {
      if (assignedVehicleId && String(assignedVehicleId) !== String(vehicleId)) continue;
      const vehicle = data.vehicles.find(item => String(item.id) === String(vehicleId));
      if (!vehicle) continue;
      const nextKm = Number(maintenance.nextKm);
      const kmNow = Number(currentKm(data, vehicle) || 0);
      const kmRemaining = Number.isFinite(nextKm) && nextKm > 0 ? nextKm - kmNow : null;
      // La programación de mantenimiento de la flota se controla por odómetro.
      // La fecha se conserva como referencia en el registro, pero no genera alertas.
      const due = kmRemaining !== null && kmRemaining <= 0;
      const soon = !due && kmRemaining !== null && kmRemaining <= 500;
      if (due || soon) alertsForDashboard.push({vehicle, maintenance, kmNow, kmRemaining, due});
    }
    return alertsForDashboard.sort((left, right) => Number(right.due) - Number(left.due));
  }, [data, driverPreview, profile?.permissions?.assignedVehicleId, profile?.role]);

  if (!alerts.length) return null;
  const kmText = value => Number(value).toLocaleString('es-PE', {maximumFractionDigits: 1});
  return <section className="panel maintenance-alerts"><div className="section-head"><div><p className="eyebrow">MANTENIMIENTO</p><h2>Alertas de mantenimiento</h2><p>Se activan únicamente por el próximo kilometraje programado.</p></div><button className="text-button" onClick={() => onGo('maintenance')}>Ver mantenimiento</button></div><div className="maintenance-alert-list">{alerts.map(alert => { const detail=alert.kmRemaining <= 0 ? `Kilometraje alcanzado: ${kmText(alert.kmNow)} km de ${kmText(alert.maintenance.nextKm)} km` : `Faltan ${kmText(alert.kmRemaining)} km: ${kmText(alert.kmNow)} de ${kmText(alert.maintenance.nextKm)} km`; return <article key={alert.vehicle.id} className={`maintenance-alert ${alert.due ? 'due' : 'soon'}`}><span className="maintenance-alert-icon">{alert.due ? '!' : '◷'}</span><div><b>{alert.vehicle.plate} · {alert.vehicle.brand} {alert.vehicle.model}</b><p>{alert.due ? 'Mantenimiento pendiente.' : 'Mantenimiento próximo.'} {detail}</p></div></article>; })}</div></section>;
}
function MangoQuickActions({permissions,onDeparture,onReturn}) { return <section className="mango-actions"><div><p className="eyebrow">ACCESO RÁPIDO</p><h2>¿El vehículo sale o llega?</h2><p>Registra el movimiento con un toque.</p></div><div className="mango-buttons">{permissions.departure&&<button className="mango-button departure" onClick={onDeparture}><i className="mango-fruit"/><span>Registrar<br/><b>Salida</b></span></button>}{permissions.arrival&&<button className="mango-button arrival" onClick={onReturn}><i className="mango-fruit"/><span>Registrar<br/><b>Llegada</b></span></button>}</div></section>; }
function RouteMap({data,profile,driverPreview,onUpdate}) {
  const active=data.trips.find(isTripOpen);
  const isTripDriver = Boolean(profile?.role === 'driver' && !driverPreview && String(active?.driverProfileId || active?.driver || '') === String(profile?.id || ''));
  const mapNode=useRef(null); const map=useRef(null); const marker=useRef(null); const watcher=useRef(null); const record=useRef(active); const manualMapView=useRef(false); const automaticMapMove=useRef(false);
  const markerAnimation=useRef(null); const saveInFlight=useRef(false); const pendingRouteSave=useRef(null);
  const [tracking,setTracking]=useState(false);
  const [resumeCycle,setResumeCycle]=useState(0);
  const [livePoint,setLivePoint]=useState(null);
  const [message,setMessage]=useState(active?'GPS activándose para seguir el vehículo.':'No hay un vehículo en ruta. Registra una salida primero.');
  useEffect(()=>{
    if(!active){record.current=null;return;}
    const current=record.current;
    // Una respuesta más antigua del sondeo nunca debe reemplazar los puntos que
    // el teléfono ya tiene pendientes de guardar.
    if(!current||current.id!==active.id||(active.routePoints?.length||0)>=(current.routePoints?.length||0)) record.current=active;
  },[active]);
  useEffect(()=>{manualMapView.current=false;setLivePoint(null);pendingRouteSave.current=null;},[active?.id]);
  useEffect(()=>{
    const restartGpsWhenReturning=()=>{
      if(document.visibilityState !== 'visible') return;
      setResumeCycle(previous=>previous+1);
    };
    document.addEventListener('visibilitychange',restartGpsWhenReturning);
    window.addEventListener('focus',restartGpsWhenReturning);
    return()=>{
      document.removeEventListener('visibilitychange',restartGpsWhenReturning);
      window.removeEventListener('focus',restartGpsWhenReturning);
    };
  },[]);
  useEffect(()=>{if(!mapNode.current||map.current)return;map.current=L.map(mapNode.current,{zoomControl:false,attributionControl:false}).setView([-5.1945,-80.6328],11);const markManualView=()=>{if(!automaticMapMove.current)manualMapView.current=true;};map.current.on('dragstart',markManualView);map.current.on('zoomstart',markManualView);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxNativeZoom:19,maxZoom:20}).addTo(map.current);L.control.zoom({position:'bottomright'}).addTo(map.current);L.control.attribution({position:'bottomleft',prefix:'© OpenStreetMap'}).addTo(map.current);return()=>{map.current?.off('dragstart',markManualView);map.current?.off('zoomstart',markManualView);map.current?.remove();map.current=null;};},[]);
  useEffect(()=>{
    const storedLast=(active?.routePoints||[]).at(-1);
    const latest=livePoint||storedLast;
    if(!map.current)return;
    if(!latest){
      if(marker.current){marker.current.remove();marker.current=null;}
      return;
    }
    const last=[latest.lat,latest.lng];
    const vehicle=data.vehicles.find(item=>item.id===active.vehicleId);
    const symbol=String(vehicle?.vehicle_type||'').toLowerCase().includes('moto')?'🏍️':'🚗';
    const icon=L.divIcon({className:'moving-vehicle-icon',html:`<span class="vehicle-map-pin" title="Vehículo en movimiento"><i>${symbol}</i></span>`,iconSize:[48,48],iconAnchor:[24,24]});
    if(!marker.current) marker.current=L.marker(last,{icon}).addTo(map.current);
    else {
      marker.current.setIcon(icon);
      if(markerAnimation.current) cancelAnimationFrame(markerAnimation.current);
      const from=marker.current.getLatLng();
      const target={lat:Number(latest.lat),lng:Number(latest.lng)};
      const distance=gpsDistanceMeters(from,target);
      if(!Number.isFinite(distance)||distance>180){
        marker.current.setLatLng(target);
      } else {
        const started=performance.now();
        const duration=700;
        const animate=nowTime=>{
          const progress=Math.min(1,(nowTime-started)/duration);
          // Suavizado visual sin extrapolar: el ícono siempre termina en la
          // última coordenada real y nunca se dibuja por delante de ella.
          const eased=1-Math.pow(1-progress,3);
          marker.current?.setLatLng({lat:from.lat+(target.lat-from.lat)*eased,lng:from.lng+(target.lng-from.lng)*eased});
          if(progress<1) markerAnimation.current=requestAnimationFrame(animate);
        };
        markerAnimation.current=requestAnimationFrame(animate);
      }
    }
    if(!manualMapView.current){
      automaticMapMove.current=true;
      // Mostrar calles locales y el vehículo actual, sin dibujar el recorrido histórico.
      map.current.setView(last,17,{animate:true});
      window.setTimeout(()=>{automaticMapMove.current=false;},750);
    }
    setTimeout(()=>map.current?.invalidateSize(),80);
  },[active?.routePoints,livePoint,data.vehicles]);
  const queueRouteSave = next => {
    pendingRouteSave.current=next;
    if(saveInFlight.current)return;
    const flush=async()=>{
      const pending=pendingRouteSave.current;
      if(!pending)return;
      pendingRouteSave.current=null;
      saveInFlight.current=true;
      try{await onUpdate({...pending,_routeTracking:true});}
      finally{saveInFlight.current=false;if(pendingRouteSave.current)flush();}
    };
    flush();
  };
  useEffect(()=>{
    if(watcher.current){navigator.geolocation.clearWatch(watcher.current);watcher.current=null;}
    if(!active?.id){setTracking(false);setMessage('No hay un vehículo en ruta. Registra una salida primero.');return;}
    if(!isTripDriver){setTracking(false);setMessage('Ubicación recibida desde el celular del chofer. Se actualiza automáticamente.');return;}
    if(!navigator.geolocation){setTracking(false);setMessage('Este navegador no permite GPS.');return;}
    const tripId=active.id;
    setTracking(true);setMessage('GPS activo: el ícono se moverá en el mapa mientras esta aplicación permanezca abierta.');
    watcher.current=navigator.geolocation.watchPosition(position=>{
      const previous=record.current;
      if(!previous||previous.id!==tripId||!isTripOpen(previous))return;
      const timestamp=Number(position.timestamp || Date.now());
      const rawPoint={lat:position.coords.latitude,lng:position.coords.longitude,at:new Date(timestamp).toISOString(),timestamp,accuracy:Math.round(position.coords.accuracy),speed:position.coords.speed,heading:position.coords.heading};
      const lastPoint=previous.routePoints?.at(-1);
      if (rawPoint.accuracy > GPS_TRACKING_MAX_ACCURACY_METERS) {
        setMessage(`Esperando una señal GPS más precisa (${rawPoint.accuracy} m). El vehículo se actualizará al mejorar la ubicación.`);
        return;
      }
      if(!shouldKeepGpsPoint(lastPoint,rawPoint)) return;
      const point=stabilizeGpsPoint(lastPoint,rawPoint);
      const next={...previous,routePoints:[...(previous.routePoints||[]),point]};
      record.current=next;
      // El marcador se actualiza de inmediato; el guardado en la nube se hace
      // en paralelo y de forma ordenada para no frenar la vista del conductor.
      setLivePoint(point);
      setMessage(`Ubicación actualizada con precisión de ${point.accuracy} m.`);
      queueRouteSave(next);
    },()=>{setTracking(false);setMessage('No se pudo actualizar el GPS. Activa la ubicación precisa y mantén abierta la aplicación.');},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    return()=>{if(watcher.current){navigator.geolocation.clearWatch(watcher.current);watcher.current=null;}if(markerAnimation.current){cancelAnimationFrame(markerAnimation.current);markerAnimation.current=null;}};
  },[active?.id,isTripDriver,resumeCycle]);
  const focusVehicle = () => {
    const last = record.current?.routePoints?.at(-1);
    if (!last || !map.current) return;
    manualMapView.current=false;
    automaticMapMove.current=true;
    map.current.flyTo([last.lat,last.lng], Math.max(map.current.getZoom(), 17), { animate:true, duration:.6 });
    window.setTimeout(()=>{automaticMapMove.current=false;},750);
  };
  return <section className={`route-section route-navigation ${active ? 'has-active-trip' : 'no-active-trip'}`}><div className="section-head route-section-title"><div><p className="eyebrow">SEGUIMIENTO</p><h2>{active ? 'Ubicación en tiempo real' : 'Mapa de recorridos'}</h2><p>{active ? `Movilidad ${vehicleName(data,active.vehicleId)} en ruta. Puedes explorar el mapa libremente.` : 'El mapa se ampliará automáticamente cuando inicies una salida.'}</p></div>{active&&<span className="tracking-badge">● GPS en vivo</span>}</div><div className="route-map-shell"><div ref={mapNode} className="route-map"/>{active&&<><div className="route-map-status"><span className="route-live-dot"/><div><b>{vehicleName(data,active.vehicleId)}</b><small>{isTripDriver&&tracking?'Enviando ubicación':'Ubicación del chofer'}</small></div></div><button type="button" className="map-recenter-button" onClick={focusVehicle} title="Volver a mi vehículo" aria-label="Volver a mi vehículo">⌖</button></>}</div><p className="route-note">{message}</p></section>;
}
function Metric({label,value,note}) { return <div className="metric"><span className="metric-label">{label}</span><div className="metric-value">{value}</div><small>{note}</small></div>; }
function List({title,text,onAdd,hideAdd=false,children}) { return <section><div className="section-head"><div><h2>{title}</h2><p>{text}</p></div>{!hideAdd&&<button className="primary" onClick={onAdd}>+ Agregar</button>}</div>{children}</section>; }
const vehicleName=(data,vehicleId)=>data.vehicles.find(v=>v.id===vehicleId)?.plate || 'Vehículo eliminado';
const Actions=({onEdit,onDelete})=><><button className="edit" onClick={onEdit}>Editar</button><button className="delete" onClick={onDelete}>×</button></>;
const VehicleActions=({onEdit,onDelete})=><><button className="edit" onClick={onEdit}>Editar</button><button className="delete" title="Solicita la placa antes de eliminar" onClick={onDelete}>Eliminar…</button></>;
function Table({heads,children}) { return <div className="panel table-panel"><table><thead><tr>{heads.map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Trips({data,drivers=[],profile,onEdit,onDelete}) {
  const [filters,setFilters]=useState({search:'',date:'',vehicleId:'',driver:'',status:''});
  const [photo,setPhoto]=useState(null);
  useEffect(()=>()=>{if(photo?.url) URL.revokeObjectURL(photo.url)},[photo?.url]);
  // Defensa adicional de interfaz: aunque un dato antiguo quedara en memoria,
  // cada chofer puede operar y visualizar únicamente sus propios recorridos.
  const visibleTrips = useMemo(() => {
    if (profile?.role !== 'driver') return data.trips;
    const ownId = String(profile.id || '');
    return data.trips.filter(trip => String(trip.driverProfileId || trip.driver || '') === ownId);
  }, [data.trips, profile?.id, profile?.role]);
  const driverName = trip => {
    const profileId = String(trip.driverProfileId || trip.driver || '');
    const registeredDriver = drivers.find(driver => String(driver.id) === profileId);
    if (registeredDriver?.full_name) return registeredDriver.full_name;
    if (profile && String(profile.id) === profileId && profile.full_name) return profile.full_name;
    return trip.driverName || trip.driver || 'Sin conductor registrado';
  };
  const filtered=visibleTrips.filter(t=>{
    const query=filters.search.trim().toLowerCase();
    const displayDriver=driverName(t);
    const searchable=[vehicleName(data,t.vehicleId),displayDriver,t.origin,t.destination].join(' ').toLowerCase();
    return (!query||searchable.includes(query))&&(!filters.date||t.departureDate===filters.date)&&(!filters.vehicleId||t.vehicleId===filters.vehicleId)&&(!filters.driver||displayDriver===filters.driver)&&(!filters.status||(filters.status==='En ruta'?!t.endKm:!!t.endKm));
  });
  const driverNames=[...new Set(visibleTrips.map(driverName).filter(Boolean))];
  const showOdometerPhoto=async (trip,stage)=>{
    const stageLabel=stage==='return'?'llegada':'salida';
    setPhoto({loading:true});
    const {data:evidence,error:evidenceError}=await supabase.from('evidence').select('storage_path').eq('trip_id',trip.id).eq('stage',stage).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(evidenceError||!evidence?.storage_path){
      setPhoto(null);
      alert(`Este recorrido todavía no tiene una foto de odómetro de ${stageLabel} guardada.`);
      return;
    }
    const {data:file,error:downloadError}=await supabase.storage.from('vehicle-evidence').download(evidence.storage_path);
    if(downloadError||!file){
      setPhoto(null);
      alert(`No se pudo abrir la foto del odómetro de ${stageLabel}: ${downloadError?.message || 'archivo no disponible'}`);
      return;
    }
    setPhoto({url:URL.createObjectURL(file),driver:driverName(trip),vehicle:vehicleName(data,trip.vehicleId),stageLabel});
  };
  return <>
    <div className="trip-filters">
      <input aria-label="Buscar recorridos" placeholder="Buscar placa, chofer, origen o destino" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/>
      <input aria-label="Filtrar por fecha" type="date" value={filters.date} onChange={e=>setFilters({...filters,date:e.target.value})}/>
      <select aria-label="Filtrar por vehículo" value={filters.vehicleId} onChange={e=>setFilters({...filters,vehicleId:e.target.value})}><option value="">Todos los vehículos</option>{data.vehicles.map(v=><option value={v.id} key={v.id}>{v.plate}</option>)}</select>
      <select aria-label="Filtrar por chofer" value={filters.driver} onChange={e=>setFilters({...filters,driver:e.target.value})}><option value="">Todos los choferes</option>{driverNames.map(driver=><option key={driver}>{driver}</option>)}</select>
      <select aria-label="Filtrar por estado" value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">Todos los estados</option><option>En ruta</option><option>Finalizado</option></select>
    </div>
    <Table heads={['Salida','Llegada','Vehículo','Chofer','Origen → destino','Odómetro','Total','']}>
      {filtered.slice().reverse().map(t=><tr key={t.id}>
        <td>{date(t.departureDate)}<br/><span>{t.departureTime}</span></td>
        <td>{t.endKm !== null && t.endKm !== undefined && t.endKm !== '' ? <>{date(t.returnDate)}<br/><span>{t.returnTime || '—'}</span></> : <span className="badge warn">En ruta</span>}</td>
        <td>{vehicleName(data,t.vehicleId)}</td>
        <td><div className="trip-driver-evidence"><b className="trip-driver-name">{driverName(t)}</b><div className="trip-evidence-actions"><button type="button" className="text-button" onClick={()=>showOdometerPhoto(t,'departure')}>Foto salida</button>{t.endKm&&<button type="button" className="text-button" onClick={()=>showOdometerPhoto(t,'return')}>Foto llegada</button>}</div></div></td>
        <td><div className="trip-route"><div><small>Origen</small><span>{t.origin || 'No registrado'}</span></div><i>→</i><div><small>Destino</small><span>{t.destination || 'Pendiente'}</span></div></div></td>
        <td>{t.startKm} → {t.endKm || 'Pendiente'}{String(t.notes || '').includes('ingresado manualmente') && <><br/><span className="badge warn">Km manual · revisar foto</span></>}</td>
        <td>{t.endKm ? `${Number(t.endKm)-Number(t.startKm)} km` : <span className="badge warn">En ruta</span>}</td>
        <td><Actions onEdit={()=>onEdit(t)} onDelete={()=>onDelete(t)}/></td>
      </tr>)}
    </Table>
    {filtered.length===0&&<p className="empty-message">No hay recorridos que coincidan con los filtros.</p>}
    {photo?.loading&&<p className="evidence-loading">Abriendo foto del odómetro…</p>}
    {photo?.url&&<dialog open className="odometer-photo-dialog" aria-label={`Foto del odómetro de ${photo.stageLabel}`}><div className="odometer-photo-head"><div><h2>Odómetro de {photo.stageLabel}</h2><p>{photo.vehicle} · {photo.driver}</p></div><button type="button" className="close" aria-label="Cerrar foto" onClick={()=>setPhoto(null)}>×</button></div><img src={photo.url} alt={`Foto del odómetro de ${photo.stageLabel}: ${photo.vehicle}`}/></dialog>}
  </>;
}
function Maintenance({data,onEdit,onDelete}) { return <Table heads={['Fecha','Vehículo','Servicio','Próxima fecha / km','']} >{data.maintenance.slice().reverse().map(x=><tr key={x.id}><td>{date(x.date)}</td><td>{vehicleName(data,x.vehicleId)}</td><td>{x.type}</td><td>{x.nextDate || '—'} {x.nextKm ? ` / ${x.nextKm} km` : ''}</td><td><Actions onEdit={()=>onEdit(x)} onDelete={()=>onDelete(x)}/></td></tr>)}</Table>; }
function Fuel({data,drivers=[],profile,isAdmin=false,onEdit,onDelete}) {
  const [receipt,setReceipt] = useState(null);
  const openReceipt = async record => {
    if (!record.receiptPath) return alert('Este comprobante no tiene una foto disponible.');
    setReceipt({loading:true, record});
    const { data: file, error } = await supabase.storage.from('vehicle-evidence').download(record.receiptPath);
    if (error) return setReceipt({error:'No se pudo abrir la foto del comprobante.', record});
    setReceipt({url:URL.createObjectURL(file), record});
  };
  const closeReceipt = () => {
    if (receipt?.url) URL.revokeObjectURL(receipt.url);
    setReceipt(null);
  };
  const rows = data.fuels.slice().sort((a,b) => `${b.date||''}${b.time||''}`.localeCompare(`${a.date||''}${a.time||''}`));
  const driverName = record => {
    if (String(record.createdBy || '') === String(profile?.id || '')) return profile?.full_name || 'Mi comprobante';
    return drivers.find(driver => String(driver.id) === String(record.createdBy || ''))?.full_name || 'Chofer';
  };
  return <><Table heads={[...(isAdmin ? ['Chofer'] : []),'Fecha','Vehículo','Comprobante','Estado','']}>
    {rows.map(record => <tr key={record.id}>
      {isAdmin && <td>{driverName(record)}</td>}
      <td>{date(record.date)}<small className="fuel-product-cell">{record.time || ''}</small></td>
      <td>{vehicleName(data,record.vehicleId)}</td>
      <td><b>{record.provider || 'Comprobante enviado'}</b>{record.product && <small className="fuel-product-cell">{record.product}</small>}{record.receiptPath && <button type="button" className="text-button" onClick={()=>openReceipt(record)}>Ver comprobante</button>}</td>
      <td><span className={`badge ${record.reviewStatus === 'Pendiente de revisión' ? 'warn' : 'ok'}`}>{record.reviewStatus || 'Pendiente de revisión'}</span></td>
      <td>{isAdmin && <Actions onEdit={()=>onEdit(record)} onDelete={()=>onDelete(record)}/>}</td>
    </tr>)}
  </Table>
  {rows.length===0 && <p className="empty-message">Aún no hay comprobantes enviados.</p>}
  {receipt?.loading && <p className="evidence-loading">Abriendo comprobante…</p>}
  {receipt?.error && <p className="sync-error">{receipt.error}</p>}
  {receipt?.url && <dialog open className="odometer-photo-dialog" aria-label="Foto del comprobante"><div className="odometer-photo-head"><div><h2>Comprobante de combustible</h2><p>{vehicleName(data,receipt.record.vehicleId)} · {driverName(receipt.record)}</p></div><button type="button" className="close" aria-label="Cerrar comprobante" onClick={closeReceipt}>×</button></div><img src={receipt.url} alt="Comprobante de combustible"/></dialog>}
  </>;
}
function Expenses({data,onEdit,onDelete}) { return <Table heads={['Fecha','Vehículo','Tipo','Detalle','Proveedor','Costo','']} >{data.expenses.slice().reverse().map(x=><tr key={x.id}><td>{date(x.date)}</td><td>{vehicleName(data,x.vehicleId)}</td><td>{x.type}</td><td>{x.detail}</td><td>{x.provider}</td><td>{money(x.cost)}</td><td><Actions onEdit={()=>onEdit(x)} onDelete={()=>onDelete(x)}/></td></tr>)}</Table>; }
function Vehicles({data,onEdit,onDelete}) { return <div className="vehicle-grid">{data.vehicles.map(v=>{const inRoute=data.trips.some(t=>t.vehicleId===v.id&&!t.endKm);const status=inRoute?'En ruta':(v.status||'Disponible');return <article className="vehicle-card" key={v.id}><div className="card-top"><span className={`badge ${inRoute?'warn':'ok'}`}>{status}</span><VehicleActions onEdit={()=>onEdit(v)} onDelete={()=>onDelete(v)}/></div><div className="vehicle-plate">{v.plate}</div><p>{v.vehicle_type==='Camioneta'?'Carro':(v.vehicle_type || 'Carro')} · {v.brand} {v.model}</p>{v.driver&&<div className="info-line">Chofer: {v.driver}</div>}<div className="info-line">Odómetro actual</div><h2>{currentKm(data,v).toLocaleString('es-PE')} km</h2></article>})}</div>; }
function Reports({data}) { const download=()=>{const rows=[['Tipo','Fecha','Vehículo','Detalle','Costo'],...data.trips.map(t=>['Recorrido',t.departureDate,vehicleName(data,t.vehicleId),`${t.origin} - ${t.destination}`,t.endKm?Number(t.endKm)-Number(t.startKm):'']),...data.fuels.map(x=>['Combustible',x.date,vehicleName(data,x.vehicleId),`${x.product || 'Combustible'} · ${x.gallons ?? x.liters ?? '—'} galones`,x.cost]),...data.expenses.map(x=>['Gasto',x.date,vehicleName(data,x.vehicleId),`${x.type}: ${x.detail}`,x.cost])];const blob=new Blob(['\ufeff'+rows.map(r=>r.map(v=>`"${String(v||'').replaceAll('"','""')}"`).join(',')).join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='RutaControl.csv';a.click();};return <section><div className="grid-two"><article className="panel"><h2>Exportar a Excel</h2><p>Descarga un CSV compatible con Excel.</p><br/><button className="primary" onClick={download}>⇩ Descargar Excel</button></article><article className="panel"><h2>Exportar a PDF</h2><p>Usa la impresión del navegador para guardar el reporte en PDF.</p><br/><button className="primary" onClick={()=>print()}>⇩ Guardar como PDF</button></article></div></section>; }
function UsersPage({drivers,vehicles,onChanged}) {
  const [form,setForm]=useState({fullName:'',accessCode:'',pin:''});
  const [message,setMessage]=useState('');
  const request=async body=>{
    setMessage('Creando acceso…');
    try {
      const {data:{session}}=await supabase.auth.getSession();
      const response=await fetch('https://idwyvmhfyfsklykxmcdm.supabase.co/functions/v1/quick-taskmanage-drivers',{
        method:'POST',
        headers:{Authorization:`Bearer ${session?.access_token||''}`,'Content-Type':'application/json'},
        body:JSON.stringify(body)
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||result?.error){setMessage(result?.error||'No se pudo crear el acceso.');return null;}
      await onChanged();
      setMessage('Chofer creado correctamente. Entrega su código y PIN de forma privada.');
      return result;
    } catch {
      setMessage('No se pudo conectar con el servicio de usuarios. Intenta nuevamente.');
      return null;
    }
  };
  const savePermissions=async(driver,permissions)=>{
    const {error}=await supabase.from('user_profiles').update({permissions}).eq('id',driver.id);
    if(error){setMessage(error.message);return false;}
    setMessage('Permisos guardados.');
    onChanged();
    return true;
  };
  const create=async event=>{event.preventDefault();const result=await request({action:'create',...form});if(result)setForm({fullName:'',accessCode:'',pin:''});};
  return <section className="users-page"><div className="users-intro"><p className="eyebrow">ADMINISTRACIÓN</p><h2>Choferes y accesos</h2><p>Autoriza exactamente qué puede ver y usar cada chofer.</p></div><div className="grid-two"><form className="panel users-form" onSubmit={create}><h2>Nuevo chofer</h2><label>Nombre completo</label><input required value={form.fullName} onChange={event=>setForm({...form,fullName:event.target.value})}/><label>Código de acceso</label><input required value={form.accessCode} onChange={event=>setForm({...form,accessCode:event.target.value.toUpperCase()})} pattern="[A-Za-z0-9_-]{4,20}"/><label>PIN inicial de 6 números</label><input required value={form.pin} onChange={event=>setForm({...form,pin:event.target.value.replace(/\D/g,'').slice(0,6)})} inputMode="numeric" pattern="\d{6}"/><button className="primary">Crear acceso</button></form><article className="panel"><h2>Permisos</h2><p className="users-message">{message||'Los cambios se guardan para cada chofer.'}</p></article></div><section className="panel users-list"><h2>Choferes registrados</h2>{drivers.map(driver=><article className="driver-card" key={driver.id}><div><b>{driver.full_name}</b><small>{driver.access_code}</small><Permissions driver={driver} vehicles={vehicles} onSave={savePermissions}/></div></article>)}</section></section>;
}
function Permissions({driver,vehicles,onSave}) {
  const defaults={departure:true,arrival:true,trips:true,fuel:false,maintenance:false};
  const [permissions,setPermissions]=useState({...defaults,...(driver.permissions||{})});
  const [editing,setEditing]=useState(false);
  const options=[['departure','Salida'],['arrival','Llegada'],['trips','Recorridos propios'],['fuel','Combustible'],['maintenance','Mantenimiento']];
  const cancel=()=>{setPermissions({...defaults,...(driver.permissions||{})});setEditing(false);};
  const save=async()=>{if(await onSave(driver,permissions))setEditing(false);};
  return <div className="permission-controls">
    <label>Vehículo asignado<select value={permissions.assignedVehicleId||''} disabled={!editing} onChange={event=>{const vehicle=vehicles.find(item=>item.id===event.target.value);const allowed=[...new Set([...(permissions.allowedVehicleIds||[]),event.target.value].filter(Boolean))];setPermissions({...permissions,assignedVehicleId:event.target.value,assignedVehicleLabel:vehicle?`${vehicle.plate} · ${vehicle.brand}`:'',allowedVehicleIds:allowed});}}><option value="">Sin vehículo asignado</option>{vehicles.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.brand}</option>)}</select></label>
    <label>Otros vehículos autorizados <small>(opcional)</small><select multiple size="4" disabled={!editing} value={(permissions.allowedVehicleIds||[]).filter(vehicleId=>vehicleId!==permissions.assignedVehicleId)} onChange={event=>{const extras=Array.from(event.target.selectedOptions,item=>item.value);const allowed=[...new Set([permissions.assignedVehicleId,...extras].filter(Boolean))];setPermissions({...permissions,allowedVehicleIds:allowed});}}>{vehicles.filter(vehicle=>vehicle.id!==permissions.assignedVehicleId).map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.brand}</option>)}</select><small>Para seleccionar varios, mantén presionada la tecla Ctrl.</small></label>
    {options.map(([key,label])=><label key={key}><input type="checkbox" checked={permissions[key]} disabled={!editing} onChange={event=>setPermissions({...permissions,[key]:event.target.checked})}/>{label}</label>)}
    {editing ? <div className="permission-actions"><button type="button" className="secondary" onClick={cancel}>Cancelar</button><button type="button" className="primary" onClick={save}>Guardar permisos</button></div> : <button type="button" className="secondary" onClick={()=>setEditing(true)}>Editar permisos</button>}
  </div>;
}
function DriverVehicleAssignment(){return null;}
function KilometerInputGuard() {
  useEffect(() => {
    const isKilometerField = input => {
      if (!(input instanceof HTMLInputElement) || input.type === 'file') return false;
      const label = input.closest('.field')?.querySelector('label')?.textContent || '';
      return /kilometraje|od[oó]metro/i.test(label);
    };
    const preventLetters = event => {
      if (isKilometerField(event.target) && event.data && /[^\d.,]/.test(event.data)) event.preventDefault();
    };
    const onlyKilometers = event => {
      const input = event.target;
      if (!isKilometerField(input)) return;
      const value = normalizeKilometerInput(input.value);
      if (value === input.value) return;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    document.addEventListener('beforeinput', preventLetters, true);
    document.addEventListener('input', onlyKilometers, true);
    return () => {
      document.removeEventListener('beforeinput', preventLetters, true);
      document.removeEventListener('input', onlyKilometers, true);
    };
  }, []);
  return null;
}
function MaintenanceFormHelper({active}) {
  useEffect(() => {
    if (!active) return undefined;
    const form = document.querySelector('.maintenance-modal form');
    if (!form) return undefined;
    const steps = form.querySelector('.maintenance-steps');
    const clock = document.createElement('p');
    clock.className = 'live-clock maintenance-live-clock';
    const refreshClock = () => { clock.innerHTML = `Hora actual: <b>${now()}</b>`; };
    refreshClock();
    steps?.after(clock);

    const fields = [...form.querySelectorAll('.field')];
    const serviceField = fields.find(field => field.querySelector('label')?.textContent === 'Servicio realizado');
    const kmField = fields.find(field => field.querySelector('label')?.textContent === 'Kilometraje del servicio');
    const notesField = fields.find(field => field.querySelector('label')?.textContent === 'Observaciones');
    const serviceSelect = serviceField?.querySelector('select');
    const notesLabel = notesField?.querySelector('label');
    const notesInput = notesField?.querySelector('textarea');
    const applyKmHelp = () => {
      const kmInput = kmField?.querySelector('input');
      if (!kmInput) return;
      kmInput.step = '0.1';
      kmInput.placeholder = 'Se completa con la foto o puedes escribirlo';
      if (!kmField.querySelector('.maintenance-km-help')) {
        const help = document.createElement('small');
        help.className = 'field-help maintenance-km-help';
        help.textContent = 'La foto intenta completar el kilometraje. Si no se lee correctamente, escríbelo manualmente.';
        kmField.append(help);
      }
    };
    applyKmHelp();
    const syncOtherService = () => {
      const isOther = serviceSelect?.value === 'Otro';
      if (!notesField || !notesLabel || !notesInput) return;
      notesField.hidden = !isOther;
      notesLabel.textContent = isOther ? 'Describe el servicio realizado' : 'Observaciones';
      notesInput.required = isOther;
      notesInput.placeholder = isOther
        ? 'Ejemplo: cambio de cadena, reparación de luces o trabajo realizado.'
        : 'Ejemplo: cambio de filtros, estado de neumáticos o recomendaciones del taller.';
    };
    syncOtherService();
    const scheduleOtherServiceSync = () => window.setTimeout(syncOtherService, 0);
    serviceSelect?.addEventListener('change', scheduleOtherServiceSync);
    const observer = kmField ? new MutationObserver(applyKmHelp) : null;
    observer?.observe(kmField, { childList: true, subtree: true, attributes: true, attributeFilter: ['placeholder', 'step'] });
    const timer = window.setInterval(refreshClock, 1000);
    return () => { window.clearInterval(timer); observer?.disconnect(); serviceSelect?.removeEventListener('change', scheduleOtherServiceSync); clock.remove(); kmField?.querySelector('.maintenance-km-help')?.remove(); };
  }, [active]);
  return null;
}
function EvidenceInjector(){useEffect(()=>{const form=document.querySelector('.quick-departure-modal form');if(!form||form.querySelector('.evidence-quick'))return;window.departureEvidence={};const box=document.createElement('div');box.className='evidence-quick';box.innerHTML='<b>Estado al salir <small>(opcional)</small></b><select><option value="Bien">Bien</option><option value="Con observación">Con observación</option></select><label class="evidence-camera">◉ Tomar foto<input type="file" accept="image/*" capture="environment"></label><small class="evidence-selected" aria-live="polite"></small><input type="text" placeholder="Observación breve">';const state=box.querySelector('select');const media=box.querySelector('input[type="file"]');const note=box.querySelector('input[type="text"]');const selected=box.querySelector('.evidence-selected');const sync=()=>{const fileName=media.files?.[0]?.name||'';selected.textContent=fileName?`✓ Foto lista: ${fileName}`:'';window.departureEvidence={departureCondition:state.value,departureEvidence:fileName,departureNotes:note.value};};[state,media,note].forEach(x=>x.addEventListener('change',sync));note.addEventListener('input',sync);form.querySelector('.form-actions')?.before(box);return()=>{window.departureEvidence={};box.remove();};},[]);return null;}
function LegacyDepartureGpsRequired({data,driverName='',assignedVehicleId='',assignedVehicleLabel='',onClose,onSave}) { const [form,setForm]=useState({departureDate:today(),departureTime:now(),driver:driverName,vehicleId:assignedVehicleId});const [status,setStatus]=useState('');const [gpsReady,setGpsReady]=useState(false);const [clock,setClock]=useState(now());const assignedVehicle=data.vehicles.find(vehicle=>String(vehicle.id)===String(assignedVehicleId));const assignedLabel=assignedVehicle?`${assignedVehicle.plate} · ${assignedVehicle.brand}`:assignedVehicleLabel;const change=(k,v)=>setForm(x=>({...x,[k]:v}));useEffect(()=>{if(driverName)setForm(x=>({...x,driver:driverName}));},[driverName]);useEffect(()=>{if(assignedVehicleId)setForm(x=>({...x,vehicleId:assignedVehicleId}));},[assignedVehicleId]);useEffect(()=>{const timer=setInterval(()=>{const time=now();setClock(time);setForm(x=>({...x,departureDate:today(),departureTime:time}));},1000);return()=>clearInterval(timer);},[]);const ocr=async(file)=>{if(!file)return;setStatus('Leyendo fotografía…');try{const w=await createWorker('eng');const {data:{text}}=await w.recognize(file);await w.terminate();const km=Math.max(...(text.match(/\b\d{3,7}(?:[.,]\d{3})*\b/g)||[]).map(x=>Number(x.replace(/\D/g,''))).filter(Boolean));change('startPhoto',file.name);if(Number.isFinite(km)){change('startKm',String(km));setStatus(`Odómetro reconocido: ${km.toLocaleString('es-PE')} km.`)}else setStatus('No se pudo leer el odómetro.');}catch{setStatus('No se pudo leer la fotografía.');}};const gps=()=>{if(!navigator.geolocation){setStatus('Este navegador no permite GPS.');return;}setStatus('Obteniendo ubicación y dirección…');navigator.geolocation.getCurrentPosition(async p=>{const {latitude,longitude,accuracy}=p.coords;let origin=`GPS: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;try{const response=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);const place=await response.json();origin=place.display_name||origin;}catch{}change('origin',origin);change('gpsAccuracy',Math.round(accuracy));setGpsReady(true);setStatus('Origen GPS registrado correctamente.');},()=>{setGpsReady(false);setStatus('Debes permitir la ubicación GPS para confirmar la salida.');},{enableHighAccuracy:true,timeout:15000,maximumAge:0});};const submit=e=>{e.preventDefault();if(!gpsReady)return;if(!form.startKm)return alert('Toma una foto clara del odómetro.');onSave({...form,id:id(),departureDate:today(),departureTime:now(),status:'En ruta'});};return <dialog open className="quick-departure-modal"><form onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">SALIDA</p><h2>Registrar salida rápida</h2></div><button type="button" className="close" onClick={onClose}>×</button></div><p className="live-clock">Hora actual: <b>{clock}</b></p>{status&&<p className="ocr-status">{status}</p>}<div className="form-grid"><div className="field full"><label>Vehículo asignado</label><select required value={form.vehicleId||''} onChange={e=>change('vehicleId',e.target.value)}>{assignedVehicleId&&<option value={assignedVehicleId}>{assignedLabel||'Vehículo asignado'}</option>}{!assignedVehicleId&&<option value="">Seleccionar vehículo</option>}{data.vehicles.filter(v=>String(v.id)!==String(assignedVehicleId)).map(v=><option key={v.id} value={v.id}>{v.plate} · {v.brand}</option>)}</select><small className="field-help">Tu vehículo aparece por defecto. Cámbialo solo si ese día utilizas otra movilidad.</small></div><div className="field"><label>Fecha</label><input type="date" value={form.departureDate} readOnly/></div><div className="field"><label>Hora</label><input type="time" step="1" value={form.departureTime} readOnly/></div><div className="field"><label>Conductor</label><input required value={form.driver||''} onChange={e=>change('driver',e.target.value)} readOnly={Boolean(driverName)} placeholder="Se completa al iniciar sesión"/></div><div className="field"><label>Origen detectado por GPS</label><input required value={form.origin||''} readOnly placeholder="Activa GPS para obtener la dirección"/><button type="button" className="gps-button" onClick={gps}>⌖ Activar GPS y obtener origen</button></div><div className="field full"><label>Foto del odómetro de salida</label><PhotoSource onChange={e=>ocr(e.target.files?.[0])}/></div></div><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={!gpsReady}>Confirmar salida</button></div></form></dialog>; }
function DepartureSimple({data,onClose,onSave}) { return <DepartureGpsRequired data={data} onClose={onClose} onSave={onSave}/>; }
function LegacyArrivalSimple({data,onClose,onSave}) { const active=data.trips.filter(t=>!t.endKm);const [form,setForm]=useState({returnDate:today(),returnTime:now()});const [status,setStatus]=useState('');const trip=active.find(t=>t.id===form.tripId);const change=(k,v)=>setForm(x=>({...x,[k]:v}));const gps=()=>navigator.geolocation?.getCurrentPosition(p=>{change('destination',`GPS: ${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`);setStatus('Destino real GPS registrado.');},()=>setStatus('Permite la ubicación para registrar el destino.'),{enableHighAccuracy:true});const odometer=async file=>{if(!file)return;try{const w=await createWorker('eng');const {data:{text}}=await w.recognize(file);await w.terminate();const km=Math.max(...(text.match(/\b\d{3,7}(?:[.,]\d{3})*\b/g)||[]).map(x=>Number(x.replace(/\D/g,''))).filter(Boolean));change('endPhoto',file.name);if(Number.isFinite(km)){change('endKm',String(km));setStatus(`Odómetro final: ${km.toLocaleString('es-PE')} km.`)}else setStatus('No se pudo leer el odómetro.');}catch{setStatus('No se pudo leer la fotografía.');}};const submit=e=>{e.preventDefault();if(!trip||!form.endKm||!form.destination)return alert('Registra GPS de destino y foto del odómetro.');onSave({...trip,endKm:form.endKm,endPhoto:form.endPhoto,returnDate:form.returnDate,returnTime:form.returnTime,destination:form.destination,status:'Finalizado'});};return <dialog open className="quick-departure-modal"><form onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">LLEGADA</p><h2>Registrar llegada</h2></div><button type="button" className="close" onClick={onClose}>×</button></div>{active.length===0?<p className="empty-message">No hay una salida pendiente.</p>:<><div className="form-grid"><div className="field full"><label>Vehículo en ruta</label><select required value={form.tripId||''} onChange={e=>change('tripId',e.target.value)}><option value="">Seleccionar vehículo</option>{active.map(t=><option key={t.id} value={t.id}>{vehicleName(data,t.vehicleId)} · {t.driver}</option>)}</select></div><div className="field"><label>Fecha</label><input type="date" value={form.returnDate} readOnly/></div><div className="field"><label>Hora</label><input type="time" value={form.returnTime} readOnly/></div><div className="field full"><label>Destino real</label><input required value={form.destination||''} readOnly placeholder="Se obtiene al usar GPS"/><button type="button" className="gps-button" onClick={gps}>⌖ Registrar destino con GPS</button></div><div className="field full"><label>Foto del odómetro final</label><PhotoSource onChange={e=>odometer(e.target.files?.[0])}/></div></div>{status&&<p className="ocr-status">{status}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary">Confirmar llegada</button></div></>}</form></dialog>; }
function QuickDeparture({data,onClose,onSave}) { const [form,setForm]=useState({departureDate:today(),departureTime:now()}); const [status,setStatus]=useState(''); const change=(key,value)=>setForm(x=>({...x,[key]:value})); const scanPlate=async(file)=>{if(!file)return;setStatus('Leyendo la placa…');try{const worker=await createWorker('eng');const {data:{text}}=await worker.recognize(file);await worker.terminate();const clean=text.toUpperCase().replace(/[^A-Z0-9]/g,'');const vehicle=data.vehicles.find(v=>clean.includes(String(v.plate||'').toUpperCase().replace(/[^A-Z0-9]/g,'')));change('platePhoto',file.name);if(vehicle){change('vehicleId',vehicle.id);setStatus(`Vehículo reconocido: ${vehicle.plate}. Fecha y hora registradas automáticamente.`);}else setStatus('No se encontró la placa. Toma otra foto con buena luz o selecciona el vehículo manualmente.');}catch{setStatus('No se pudo leer la foto. Verifica tu conexión e intenta otra vez.');}}; const scanOdometer=async(file)=>{if(!file)return;setStatus('Leyendo el odómetro…');try{const worker=await createWorker('eng');const {data:{text}}=await worker.recognize(file);await worker.terminate();const values=(text.match(/\b\d{3,7}(?:[.,]\d{3})*\b/g)||[]).map(x=>Number(x.replace(/[^0-9]/g,''))).filter(x=>x>0);const km=Math.max(...values);change('startPhoto',file.name);if(Number.isFinite(km)){change('startKm',String(km));setStatus(`Odómetro reconocido: ${km.toLocaleString('es-PE')} km.`);}else setStatus('No se pudo leer el odómetro. Corrige el kilometraje mostrado.');}catch{setStatus('No se pudo leer la foto del odómetro. Corrige el kilometraje mostrado.');}}; const useGps=()=>{if(!navigator.geolocation){setStatus('Este navegador no permite usar GPS.');return;}setStatus('Buscando ubicación GPS…');navigator.geolocation.getCurrentPosition(position=>{const {latitude,longitude,accuracy}=position.coords;change('origin',`GPS: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);change('gpsAccuracy',Math.round(accuracy));setStatus(`Ubicación GPS registrada con precisión aproximada de ${Math.round(accuracy)} m.`);},()=>setStatus('No se pudo obtener la ubicación. Permite el acceso al GPS e inténtalo nuevamente.'),{enableHighAccuracy:true,timeout:15000,maximumAge:0});}; const submit=e=>{e.preventDefault();if(!form.startKm)return alert('Toma una foto clara del odómetro o corrige el kilometraje.');onSave({...form,id:id(),status:'En ruta'});}; return <dialog open className="quick-departure-modal"><form onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">PASO 1 · FOTO DE PLACA</p><h2>Registrar salida rápida</h2><p>Fotografía la placa y el vehículo se seleccionará automáticamente.</p></div><button type="button" className="close" onClick={onClose}>×</button></div><div className="plate-capture"><b>▣ Tomar foto de la placa</b><small>Usa la cámara del teléfono o selecciona una imagen.</small><PhotoSource onChange={e=>scanPlate(e.target.files?.[0])}/></div>{status&&<p className="ocr-status">{status}</p>}<div className="form-grid"><div className="field full"><label>Vehículo reconocido</label><select required value={form.vehicleId||''} onChange={e=>change('vehicleId',e.target.value)}><option value="">Esperando foto de placa…</option>{data.vehicles.map(v=><option key={v.id} value={v.id}>{v.plate} · {v.brand} {v.model}</option>)}</select></div><div className="field"><label>Fecha de salida</label><input required type="date" value={form.departureDate} readOnly/></div><div className="field"><label>Hora de salida</label><input required type="time" value={form.departureTime} readOnly/></div><div className="field"><label>Chofer</label><input required value={form.driver||''} onChange={e=>change('driver',e.target.value)} placeholder="Nombre del chofer"/></div><div className="field"><label>Origen</label><input required value={form.origin||''} onChange={e=>change('origin',e.target.value)} placeholder="Lugar de partida"/><button type="button" className="gps-button" onClick={useGps}>⌖ Usar mi ubicación GPS</button></div><div className="field"><label>Destino</label><input required value={form.destination||''} onChange={e=>change('destination',e.target.value)} placeholder="Lugar de destino"/></div><div className="field full"><label>Foto del odómetro de salida</label><PhotoSource onChange={e=>scanOdometer(e.target.files?.[0])}/><small className="field-help">El kilometraje se lee automáticamente de la foto.</small><input className="km-correction" type="number" min="0" value={form.startKm||''} onChange={e=>change('startKm',e.target.value)} placeholder="Solo corrige si la lectura no fue correcta"/></div></div><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary">Confirmar salida</button></div></form></dialog>; }
function QuickReturn({data,onClose,onSave}) { const active=data.trips.filter(t=>!t.endKm); const [form,setForm]=useState({returnDate:today(),returnTime:now()}); const trip=active.find(t=>t.id===form.tripId); const change=(key,value)=>setForm(x=>({...x,[key]:value})); const submit=e=>{e.preventDefault();if(Number(form.endKm)<Number(trip.startKm))return alert('El kilometraje final no puede ser menor al de salida.');onSave({...trip,endKm:form.endKm,endPhoto:form.endPhoto||trip.endPhoto,returnDate:form.returnDate,returnTime:form.returnTime,status:'Finalizado'});}; return <dialog open><form onSubmit={submit}><div className="modal-head"><div><h2>Registrar retorno</h2><p>Completa el recorrido que regresó a la empresa.</p></div><button type="button" className="close" onClick={onClose}>×</button></div>{active.length===0?<p className="empty-message">No hay vehículos con un recorrido pendiente de retorno.</p>:<><div className="form-grid"><div className="field full"><label>Recorrido en ruta</label><select required value={form.tripId||''} onChange={e=>change('tripId',e.target.value)}><option value="">Seleccionar recorrido</option>{active.map(t=><option key={t.id} value={t.id}>{vehicleName(data,t.vehicleId)} · {t.driver} · {t.origin} → {t.destination}</option>)}</select></div><div className="field"><label>Fecha de retorno</label><input required type="date" value={form.returnDate} onChange={e=>change('returnDate',e.target.value)}/></div><div className="field"><label>Hora de retorno</label><input required type="time" value={form.returnTime} onChange={e=>change('returnTime',e.target.value)}/></div><div className="field"><label>Kilometraje de retorno</label><input required type="number" min={trip?.startKm||0} value={form.endKm||''} onChange={e=>change('endKm',e.target.value)}/></div><div className="field"><label>Foto del odómetro</label><PhotoSource onChange={e=>change('endPhoto',e.target.files?.[0]?.name||'Foto capturada')}/></div></div><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary">Finalizar recorrido</button></div></>}</form></dialog>; }
function LegacyVehicleModal({record={},onClose,onSave}){const [form,setForm]=useState(record);const change=(k,v)=>setForm(x=>({...x,[k]:v}));const submit=e=>{e.preventDefault();onSave({...form,id:form.id||id()});};return <dialog open className="maintenance-modal"><form onSubmit={submit}><div className="maintenance-hero"><div><p className="eyebrow">FRUTOS TROPICALES EXPORT. PERÚ</p><h2>{record.id?'Editar vehículo':'Registrar vehículo'}</h2><p>Agrega un vehículo a la flota de forma rápida.</p></div><i className="hero-mango"/></div><button type="button" className="close maintenance-close" onClick={onClose}>×</button><div className="form-grid maintenance-grid-form"><div className="field"><label>Placa</label><input required value={form.plate||''} onChange={e=>change('plate',e.target.value)}/></div><div className="field"><label>Marca</label><input required value={form.brand||''} onChange={e=>change('brand',e.target.value)}/></div><div className="field"><label>Modelo</label><input required value={form.model||''} onChange={e=>change('model',e.target.value)}/></div><div className="field"><label>Año</label><input required type="number" value={form.year||''} onChange={e=>change('year',e.target.value)}/></div><div className="field"><label>Kilometraje inicial</label><input required type="number" min="0" value={form.km||''} onChange={e=>change('km',e.target.value)}/></div><div className="field"><label>Estado</label><select value={form.status||'Disponible'} onChange={e=>change('status',e.target.value)}><option>Disponible</option><option>En mantenimiento</option><option>Fuera de servicio</option></select></div></div><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary">Guardar vehículo</button></div></form></dialog>;}
function FuelModalFast({record={},data,assignedVehicleId='',onClose,onSave}) { const [form,setForm]=useState(()=>({...record,vehicleId:record.vehicleId||assignedVehicleId||''}));const [status,setStatus]=useState('');const change=(k,v)=>setForm(x=>({...x,[k]:v}));const scan=async(file,type)=>{if(!file)return;setStatus('Leyendo fotografía…');try{const w=await createWorker('eng');const {data:{text}}=await w.recognize(file);await w.terminate();if(type==='receipt'){const info=receiptInfo(text);change('receipt',file.name);if(Number.isFinite(info.total))change('cost',info.total.toFixed(2));if(info.provider)change('provider',info.provider);setStatus(`${Number.isFinite(info.total)?`Monto final: S/ ${info.total.toFixed(2)}. `:''}${info.provider?`Grifo: ${info.provider}.`:''}`||'No se reconocieron monto ni grifo.');}else{const km=Math.max(...(text.match(/\b\d{3,7}(?:[.,]\d{3})*\b/g)||[]).map(x=>Number(x.replace(/\D/g,''))).filter(Boolean));change('kmPhoto',file.name);if(Number.isFinite(km)){change('km',String(km));setStatus(`Kilometraje reconocido: ${km.toLocaleString('es-PE')} km.`)}else setStatus('No se pudo leer el odómetro.');}}catch{setStatus('No se pudo leer la fotografía.');}};const submit=e=>{e.preventDefault();onSave({...form,id:form.id||id()});};return <dialog open className="quick-departure-modal"><form onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">COMBUSTIBLE</p><h2>Registrar abastecimiento</h2></div><button type="button" className="close" onClick={onClose}>×</button></div><div className="form-grid"><div className="field"><label>{assignedVehicleId?'Vehículo asignado (puedes cambiarlo)':'Vehículo'}</label><select required value={form.vehicleId||''} onChange={e=>change('vehicleId',e.target.value)}><option value="">Seleccionar vehículo</option>{data.vehicles.map(v=><option key={v.id} value={v.id}>{v.plate} · {v.brand}</option>)}</select></div><div className="field"><label>Fecha</label><input required type="date" value={form.date||today()} readOnly/></div><div className="field"><label>Grifo / proveedor</label><input required value={form.provider||''} onChange={e=>change('provider',e.target.value)}/></div><div className="field"><label>Monto final / costo total S/</label><input required type="number" min="0" step="0.01" value={form.cost||''} onChange={e=>change('cost',e.target.value)}/></div><div className="field full"><label>Foto del odómetro</label><input required type="file" accept="image/*" onChange={e=>scan(e.target.files?.[0],'km')}/></div><div className="field full"><label>Foto del comprobante</label><PhotoSource onChange={e=>scan(e.target.files?.[0],'receipt')}/></div></div>{status&&<p className="ocr-status">{status}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary">Guardar combustible</button></div></form></dialog>; }
function FuelModalReceipt({ record = {}, data, assignedVehicleId = '', isAdmin = false, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ ...record, vehicleId: record.vehicleId || assignedVehicleId || '' }));
  const [receiptFile, setReceiptFile] = useState(null);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const scanReceipt = async file => {
    if (!file) return;
    let preparedFile;
    try {
      setStatus('Comprimiendo foto…');
      preparedFile = await prepareImageForUpload(file);
    } catch (error) {
      setStatus(`No se aceptó la foto: ${error.message}`);
      return;
    }
    setReceiptFile(preparedFile);
    change('receipt', preparedFile.name);
    setStatus(`Foto lista para enviar (${imageSizeLabel(preparedFile.size)}).`);
    try {
      const readings = await readReceiptWithOcr(preparedFile);
      const info = mergeReceiptInfo(readings);
      const exactVehicle = data.vehicles.find(vehicle => plateKey(vehicle.plate) === plateKey(info.plate));
      const approximateVehicle = !exactVehicle && info.plate ? findVehicleFromPlateOcr(info.plate, data.vehicles)?.vehicle : null;
      const matchedVehicle = exactVehicle || approximateVehicle;
      setForm(current => ({
        ...current,
        provider: info.provider || current.provider || null,
        product: info.product || current.product || null,
        gallons: Number.isFinite(info.gallons) && info.gallons > 0 ? String(info.gallons) : current.gallons || null,
        km: Number.isFinite(info.odometer) && info.odometer > 0 ? String(info.odometer) : current.km || null,
        cost: Number.isFinite(info.total) ? info.total.toFixed(2) : current.cost || null,
        vehicleId: matchedVehicle?.id || current.vehicleId,
        documentDetails: info.details || [],
        reviewStatus: info.hasUsefulData ? 'Datos detectados' : 'Pendiente de revisión',
      }));
    } catch {
      change('reviewStatus', 'Pendiente de revisión');
    }
  };
  const submit = async event => {
    event.preventDefault();
    if (!receiptFile && !form.receiptPath) return alert('Primero toma una foto clara del comprobante.');
    if (!form.vehicleId) return alert('Selecciona el vehículo antes de enviar el comprobante.');
    setSaving(true);
    const saved = await onSave({ ...form, id: form.id || id(), receiptFile, reviewStatus: form.reviewStatus || 'Pendiente de revisión' });
    if (!saved) setSaving(false);
  };
  return <dialog open className="quick-departure-modal fuel-modal">
    <form onSubmit={submit}>
      <div className="modal-head"><div><p className="eyebrow">COMBUSTIBLE</p><h2>Enviar comprobante</h2></div><button type="button" className="close" onClick={onClose}>×</button></div>
      <section className="fuel-capture-start">
        <p className="eyebrow">COMPROBANTE</p><h3>Toma una foto clara</h3>
        <p>Solo envía la imagen. La oficina revisará la información del comprobante.</p>
        <label className="evidence-camera">◉ Tomar foto<input required={!form.receiptPath} type="file" accept="image/*" capture="environment" onChange={event => scanReceipt(event.target.files?.[0])}/></label>
        {receiptFile && <small className="photo-loaded">✓ Foto lista: {receiptFile.name}</small>}
      </section>
      <div className="form-grid fuel-basics">
        <div className="field"><label>{assignedVehicleId ? 'Vehículo asignado' : 'Vehículo'}</label><select required value={form.vehicleId || ''} onChange={event => change('vehicleId', event.target.value)}><option value="">Seleccionar vehículo</option>{data.vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.brand}</option>)}</select>{assignedVehicleId && <small className="field-help">Se completa con tu vehículo asignado.</small>}</div>
        <div className="field"><label>Fecha de envío</label><input type="date" value={form.date || today()} readOnly/></div>
      </div>
      {status && <p className="ocr-status">{status}</p>}
      {isAdmin && form._saved && <p className="field-help">Como administrador puedes revisar la foto en la lista de comprobantes.</p>}
      <div className="form-actions"><button type="button" className="secondary" onClick={onClose} disabled={saving}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Enviando comprobante…' : 'Enviar comprobante'}</button></div>
    </form>
  </dialog>;
}
function FuelModalSmart({record={},data,onClose,onSave}) { return <FuelModalFast record={record} data={data} onClose={onClose} onSave={onSave}/>; }
function FuelModal({record={},data,onClose,onSave}) { return <FuelModalSmart record={record} data={data} onClose={onClose} onSave={onSave}/>; }
function MaintenanceModal({record={},data,assignedVehicleId='',onClose,onSave}) {
  const [form,setForm]=useState(()=>({...record,vehicleId:record.vehicleId||assignedVehicleId||''}));
  const [status,setStatus]=useState('');
  const change=(key,value)=>setForm(current=>({...current,[key]:value}));

  useEffect(()=>{
    if(!record.vehicleId&&assignedVehicleId){
      setForm(current=>current.vehicleId?current:{...current,vehicleId:assignedVehicleId});
    }
  },[assignedVehicleId,record.vehicleId]);

  const scan=async(file,target='km')=>{
    if(!file)return;
    setStatus('Analizando la fotografía…');
    try{
      const worker=await createWorker('eng');
      const {data:{text}}=await worker.recognize(file);
      await worker.terminate();
      if(target==='plate'){
        const clean=text.toUpperCase().replace(/[^A-Z0-9]/g,'');
        const vehicle=data.vehicles.find(item=>clean.includes(String(item.plate||'').toUpperCase().replace(/[^A-Z0-9]/g,'')));
        change('platePhoto',file.name);
        if(vehicle){
          change('vehicleId',vehicle.id);
          setStatus(`Placa reconocida: ${vehicle.plate}.`);
        }else{
          setStatus('No se encontró la placa; selecciona el vehículo manualmente.');
        }
        return;
      }
      const values=(text.match(/\b\d{3,7}(?:[.,]\d{3})*\b/g)||[])
        .map(value=>Number(value.replace(/[^0-9]/g,'')))
        .filter(value=>value>0);
      const km=Math.max(...values);
      change('kmPhoto',file.name);
      if(Number.isFinite(km)){
        change('serviceKm',String(km));
        setStatus(`Odómetro reconocido: ${km.toLocaleString('es-PE')} km.`);
      }else{
        setStatus('No se pudo leer el odómetro; escríbelo manualmente.');
      }
    }catch{
      setStatus('No se pudo leer la foto. Procura buena luz y texto enfocado.');
    }
  };

  const submit=e=>{
    e.preventDefault();
    if(!String(form.type||'').trim())return alert('Escribe el servicio realizado antes de guardar.');
    if(!form.kmPhoto)return alert('Debes subir la foto del odómetro antes de guardar el mantenimiento.');
    onSave({...form,id:form.id||id()});
  };

  const canSave=Boolean(form.vehicleId&&String(form.type||'').trim()&&form.date&&form.serviceKm!==''&&form.nextDate&&form.nextKm!==''&&form.kmPhoto);

  return <dialog open className="maintenance-modal"><form onSubmit={submit}>
    <div className="maintenance-hero"><div><p className="eyebrow">FRUTOS TROPICALES EXPORT. PERÚ</p><h2>Mantenimiento del vehículo</h2><p>Un registro claro para cuidar la flota que mueve nuestra cosecha.</p></div><i className="hero-mango"/></div>
    <button type="button" className="close maintenance-close" onClick={onClose}>×</button>
    <div className="maintenance-steps"><span>1. Identifica</span><span>2. Registra</span><span>3. Programa</span></div>
    <section className="photo-capture"><label className="photo-card"><b>◫ Foto de placa</b><small>Selecciona el vehículo automáticamente</small><PhotoSource onChange={e=>scan(e.target.files?.[0],'plate')}/></label><label className="photo-card"><b>◉ Foto del odómetro</b><small>Completa el kilometraje del servicio</small><PhotoSource onChange={e=>scan(e.target.files?.[0],'km')}/></label></section>
    {status&&<p className="ocr-status">{status}</p>}
    <div className="form-grid maintenance-grid-form">
      <div className="field"><label>{assignedVehicleId?'Vehículo asignado (puedes cambiarlo)':'Vehículo'}</label><select required value={form.vehicleId||assignedVehicleId||''} onChange={e=>change('vehicleId',e.target.value)}><option value="">Seleccionar vehículo</option>{data.vehicles.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.brand} {vehicle.model}</option>)}</select><small className="field-help">Tu vehículo aparece por defecto. Puedes elegir otro si corresponde.</small></div>
      <div className="field"><label>Servicio realizado</label><input required value={form.type||''} onChange={e=>change('type',e.target.value)} placeholder="Escribe el trabajo realizado"/></div>
      <div className="field"><label>Fecha del servicio</label><input required type="date" value={form.date||today()} onChange={e=>change('date',e.target.value)}/></div>
      <div className="field"><label>Kilometraje del servicio</label><input required type="number" min="0" step="0.1" value={form.serviceKm||''} onChange={e=>change('serviceKm',e.target.value)} placeholder="Se completa con la foto o puedes escribirlo"/></div>
      <div className="field"><label>Próxima fecha</label><input required type="date" value={form.nextDate||''} onChange={e=>change('nextDate',e.target.value)}/></div>
      <div className="field"><label>Próximo kilometraje</label><input required type="number" min="0" step="0.1" value={form.nextKm||''} onChange={e=>change('nextKm',e.target.value)}/></div>
    </div>
    <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={!canSave}>Guardar mantenimiento</button></div>
  </form></dialog>;
}
function RecordModal({type,record={},data,onClose,onSave}) { const [form,setForm]=useState(record); const [ocrStatus,setOcrStatus]=useState(''); const fields={vehicle:[['plate','Placa','text'],['brand','Marca','text'],['model','Modelo','text'],['year','Año','number'],['km','Kilometraje inicial','number'],['status','Estado','status'],['color','Color','text']],trip:[['vehicleId','Vehículo','vehicle'],['departureDate','Fecha de salida','date'],['departureTime','Hora de salida','time'],['driver','Chofer','text'],['origin','Origen','text'],['destination','Destino final','text'],['startKm','Kilometraje de salida','number'],['endKm','Kilometraje de retorno','number'],['platePhoto','Foto de placa','file'],['startPhoto','Foto odómetro salida','file'],['endPhoto','Foto odómetro retorno','file'],['notes','Observaciones','textarea']],maintenance:[['vehicleId','Vehículo','vehicle'],['platePhoto','Foto de placa (autocompletar vehículo)','ocrPlate'],['kmPhoto','Foto del odómetro (autocompletar km)','ocrKm'],['type','Servicio','maintenance'],['date','Fecha','date'],['serviceKm','Kilometraje servicio','number'],['nextDate','Próxima fecha','date'],['nextKm','Próximo kilometraje','number'],['notes','Observaciones','textarea']],fuel:[['vehicleId','Vehículo','vehicle'],['date','Fecha','date'],['provider','Grifo / proveedor','text'],['liters','Litros','number'],['cost','Costo total S/','number'],['km','Kilometraje','number'],['receipt','Foto comprobante','file']],expense:[['vehicleId','Vehículo','vehicle'],['date','Fecha','date'],['type','Tipo','expense'],['detail','Detalle','text'],['provider','Taller / proveedor','text'],['cost','Costo total S/','number'],['receipt','Foto comprobante','file']] }[type]; const change=(key,value)=>setForm(previous=>({...previous,[key]:value})); const scan=async(file,kind)=>{if(!file)return;setOcrStatus('Leyendo la foto…');try{const worker=await createWorker('eng');const {data:{text}}=await worker.recognize(file);await worker.terminate();const normalized=text.toUpperCase().replace(/[^A-Z0-9]/g,'');if(kind==='ocrPlate'){const vehicle=data.vehicles.find(v=>normalized.includes(String(v.plate||'').toUpperCase().replace(/[^A-Z0-9]/g,'')));setForm(previous=>({...previous,platePhoto:file.name,...(vehicle?{vehicleId:vehicle.id}:{})}));setOcrStatus(vehicle?`Placa reconocida: ${vehicle.plate}. Vehículo seleccionado.`:'No se encontró una placa registrada. Selecciona el vehículo manualmente.');}else{const values=(text.match(/\b\d{3,7}(?:[.,]\d{3})*\b/g)||[]).map(value=>Number(value.replace(/[^0-9]/g,''))).filter(value=>value>0);const km=Math.max(...values);setForm(previous=>({...previous,kmPhoto:file.name,...(Number.isFinite(km)?{serviceKm:String(km)}:{})}));setOcrStatus(Number.isFinite(km)?`Kilometraje reconocido: ${km.toLocaleString('es-PE')} km.`:'No se pudo leer el kilometraje. Escríbelo manualmente.');}}catch{setOcrStatus('No se pudo leer la foto. Verifica conexión, iluminación o ingresa el dato manualmente.');}}; const submit=e=>{e.preventDefault();if(type==='trip'&&form.endKm&&Number(form.endKm)<Number(form.startKm))return alert('El kilometraje final no puede ser menor al inicial.');onSave(type==='trip'?'trips':type==='fuel'?'fuels':type==='expense'?'expenses':type==='vehicle'?'vehicles':'maintenance',{...form,id:form.id||id()});}; const options={status:['Disponible','En ruta','En mantenimiento','Fuera de servicio'],maintenance:['Afinamiento general','Cambio de aceite y filtros','Revisión de frenos','Rotación / cambio de neumáticos','Revisión técnica','Reparación correctiva','Otro'],expense:['Parche de llanta','Cambio de neumático','Reparación mecánica','Repuesto','Mano de obra','Lavado','Peaje','Otro']}; return <dialog open><form onSubmit={submit}><div className="modal-head"><h2>{record.id?'Editar':'Agregar'} registro</h2><button type="button" className="close" onClick={onClose}>×</button></div>{type==='maintenance'&&<p className="ocr-note">Primero toma las dos fotos: la placa selecciona el vehículo y el odómetro completa el kilometraje. Puedes corregir cualquier dato antes de guardar.</p>}<div className="form-grid">{fields.map(([key,label,kind])=><div className={`field ${kind==='textarea'||kind==='file'||kind.startsWith('ocr')?'full':''}`} key={key}><label>{label}</label>{kind==='vehicle'?<select value={form[key]||''} onChange={e=>change(key,e.target.value)} required><option value="">Seleccionar vehículo</option>{data.vehicles.map(v=><option value={v.id} key={v.id}>{v.plate} · {v.brand}</option>)}</select>:options[kind]?<select value={form[key]||options[kind][0]} onChange={e=>change(key,e.target.value)}>{options[kind].map(x=><option key={x}>{x}</option>)}</select>:kind==='textarea'?<textarea value={form[key]||''} onChange={e=>change(key,e.target.value)}/>:kind==='file'?<input type="file" accept="image/*" onChange={e=>change(key,e.target.files?.[0]?.name||'Foto capturada')}/>:kind.startsWith('ocr')?<input type="file" accept="image/*" onChange={e=>scan(e.target.files?.[0],kind)}/>:<input type={kind} value={form[key]||''} onChange={e=>change(key,e.target.value)} required={!['endKm','nextDate','nextKm','notes'].includes(key)}/>}</div>)}</div>{ocrStatus&&<p className="ocr-status">{ocrStatus}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary">Guardar</button></div></form></dialog>; }

// Versión actualizada: reemplaza el año por el tipo de propiedad del vehículo.
function VehicleModal({ record = {}, onClose, onSave }) {
  const [form, setForm] = useState(record);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));

  const submit = event => {
    event.preventDefault();
    // Un vehículo nuevo no debe traer id: Supabase genera el identificador al insertarlo.
    // Si se envía un id aquí, el guardado se interpreta como una edición de un registro inexistente.
    onSave({ ...form });
  };

  return <dialog open className="maintenance-modal"><form onSubmit={submit}>
    <div className="maintenance-hero"><div>
      <p className="eyebrow">FRUTOS TROPICALES EXPORT. PERÚ</p>
      <h2>{record.id ? 'Editar vehículo' : 'Registrar vehículo'}</h2>
      <p>Agrega un vehículo a la flota de forma rápida.</p>
    </div><i className="hero-mango" /></div>
    <button type="button" className="close maintenance-close" onClick={onClose}>×</button>
    <div className="form-grid maintenance-grid-form">
      <div className="field"><label>Placa</label><input required value={form.plate || ''} onChange={event => change('plate', event.target.value)} /></div>
      <div className="field"><label>Tipo de vehículo</label><select required value={form.vehicle_type === 'Camioneta' ? 'Carro' : (form.vehicle_type || 'Carro')} onChange={event => change('vehicle_type', event.target.value)}><option>Moto</option><option>Carro</option><option>Otro</option></select></div>
      <div className="field"><label>Marca</label><input required value={form.brand || ''} onChange={event => change('brand', event.target.value)} /></div>
      <div className="field"><label>Modelo</label><input required value={form.model || ''} onChange={event => change('model', event.target.value)} /></div>
      <div className="field"><label>Tipo de propiedad</label><select required value={form.ownership || ''} onChange={event => change('ownership', event.target.value)}><option value="">Seleccionar</option><option value="Propio">Propiedad de la empresa</option><option value="Alquilado">Alquilado por el usuario</option><option value="Alquilado por la empresa">Alquilado por la empresa</option></select></div>
      <div className="field"><label>Estado</label><select value={form.status || 'Disponible'} onChange={event => change('status', event.target.value)}><option>Disponible</option><option>En mantenimiento</option><option>Fuera de servicio</option></select></div>
    </div>
    <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary">Guardar vehículo</button></div>
  </form></dialog>;
}

const odometerStoragePaths = new WeakMap();
const preparedImageFiles = new WeakSet();
const MAX_IMAGE_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1600;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const imageSizeLabel = bytes => `${Math.max(1, Math.round(bytes / 1024))} KB`;
const isSupportedImage = file => {
  if (!file) return false;
  return SUPPORTED_IMAGE_TYPES.has(String(file.type || '').toLowerCase()) || /\.(jpe?g|png|webp)$/i.test(file.name || '');
};

// La foto se reduce en el propio teléfono antes de enviarse a Storage. Así la
// base de datos solo conserva la ruta y los archivos no crecen sin control.
const prepareImageForUpload = async originalFile => {
  if (!originalFile) throw new Error('Selecciona una fotografía.');
  if (preparedImageFiles.has(originalFile)) return originalFile;
  if (!isSupportedImage(originalFile)) throw new Error('Solo se permiten fotografías JPG, PNG o WebP. No se aceptan videos.');
  if (originalFile.size > MAX_IMAGE_SOURCE_BYTES) throw new Error('La fotografía supera 12 MB. Toma otra con menor resolución.');

  const objectUrl = URL.createObjectURL(originalFile);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('No se pudo preparar esta fotografía.'));
      element.src = objectUrl;
    });
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, width, height);
    let quality = 0.8;
    let blob = null;
    while (quality >= 0.5) {
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= MAX_IMAGE_UPLOAD_BYTES) break;
      quality -= 0.1;
    }
    if (!blob || blob.size > MAX_IMAGE_UPLOAD_BYTES) throw new Error('No se pudo reducir la foto a menos de 3 MB. Toma otra más cerca y enfocada.');
    const baseName = (originalFile.name || 'foto').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'foto';
    const file = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    preparedImageFiles.add(file);
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const readOdometerKm = text => {
  const raw = String(text || '');
  const odoReadings = [...raw.matchAll(/\bO(?:DO|D0|0O)(?:METER)?\b[^\d]{0,12}((?:\d[\s.,]*){3,9})/gi)]
    .map(match => match[1].replace(/\s/g, '').replace(/(\d)[.,](\d{1,2})$/, '$1.$2'))
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 0);
  if (odoReadings.length) return Math.max(...odoReadings);
  const decimals = [...raw.matchAll(/\b(\d{3,7})[.,](\d{1,2})\b/g)]
    .map(match => Number(`${match[1]}.${match[2]}`))
    .filter(value => Number.isFinite(value) && value > 0);
  if (decimals.length) return Math.max(...decimals);
  const wholeNumbers = (raw.match(/\b\d{4,7}\b/g) || [])
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 0);
  return wholeNumbers.length ? Math.max(...wholeNumbers) : NaN;
};

// Gemini se consulta mediante una Edge Function de Supabase. La llave de la IA
// queda solo en la nube y nunca se entrega al navegador ni a los celulares.
const fileToBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('No se pudo preparar la foto para validarla.'));
  reader.onload = () => {
    const result = String(reader.result || '');
    const comma = result.indexOf(',');
    if (comma < 0) return reject(new Error('La foto no tiene un formato válido.'));
    resolve(result.slice(comma + 1));
  };
  reader.readAsDataURL(file);
});

// Gemini recibe una copia más liviana que la destinada a Storage. Mantener el
// lado mayor en 1280 px conserva los dígitos del tablero, pero reduce el tiempo
// de subida y el procesamiento de la IA en conexiones móviles.
const prepareOdometerValidationImage = async file => {
  if (!window.createImageBitmap) return file;
  const image = await createImageBitmap(file);
  try {
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    if (scale === 1 && file.type === 'image/jpeg' && file.size <= 900 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.76));
    if (!blob) return file;
    return new File([blob], 'odometro-validacion.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    image.close?.();
  }
};

const analyzeOdometerWithGemini = async (file, { minimumKm = 0, stage = 'departure' } = {}) => {
  let validationFile = file;
  try { validationFile = await prepareOdometerValidationImage(file); } catch {}
  const imageBase64 = await fileToBase64(validationFile);
  const { data, error } = await supabase.functions.invoke('analyze-odometer', {
    body: {
      imageBase64,
      mimeType: validationFile.type || 'image/jpeg',
      minimumKm: Number(minimumKm) || 0,
      stage,
    },
  });
  if (error) throw error;
  return data || { available: false };
};

const prepareOdometerImage = async file => {
  if (!window.createImageBitmap) return null;
  const image = await createImageBitmap(file);
  try {
    const x = Math.round(image.width * 0.08);
    const y = Math.round(image.height * 0.18);
    const width = Math.round(image.width * 0.84);
    const height = Math.round(image.height * 0.62);
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const context = canvas.getContext('2d');
    context.filter = 'grayscale(1) contrast(2.25) brightness(1.1)';
    context.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  } finally { image.close(); }
};

const recognizeOdometerKm = async (file, options = {}) => {
  let vision = null;
  try {
    vision = await analyzeOdometerWithGemini(file, options);
    if (vision?.available) {
      if (!vision.isOdometer) return { km: NaN, source: 'gemini', classification: 'invalid', message: vision.message || 'La foto no parece mostrar un tablero u odómetro. Toma nuevamente la foto del kilometraje.' };
      if (!vision.readable) return { km: NaN, source: 'gemini', classification: 'blurred', message: vision.message || 'La foto del tablero no se ve lo suficientemente clara. Tómala nuevamente enfocando el kilometraje.' };
      const aiKm = Number(vision.odometerKm);
      if (Number.isFinite(aiKm) && aiKm > 0) return {
        km: aiKm,
        source: 'gemini',
        classification: 'valid',
        referenceMismatch: vision.referenceMismatch === true,
        message: vision.message || '',
      };
      return { km: NaN, source: 'gemini', classification: 'blurred', message: vision.message || 'No se pudo leer el kilometraje con claridad. Toma nuevamente una foto clara del tablero.' };
    }
    if (options.strictVisual) return { km: NaN, source: 'gemini', classification: 'unavailable', message: 'No se pudo validar la foto del tablero. Inténtalo nuevamente en unos segundos.' };
  } catch {
    // Mientras se activa la llave de Gemini o si no hay conexión, Tesseract
    // conserva la lectura local para que el registro no quede bloqueado.
    if (options.strictVisual) return { km: NaN, source: 'gemini', classification: 'unavailable', message: 'No se pudo validar la foto del tablero. Inténtalo nuevamente en unos segundos.' };
  }
  const worker = await createWorker('eng');
  try {
    const { data: { text: fullText } } = await worker.recognize(file);
    let focusedText = '';
    try {
      const focusedImage = await prepareOdometerImage(file);
      if (focusedImage) ({ data: { text: focusedText } } = await worker.recognize(focusedImage));
    } catch {}
    return { km: readOdometerKm(`${focusedText}\n${fullText}`), source: 'ocr', classification: 'valid', message: '' };
  } finally { await worker.terminate(); }
};

const uploadOdometerPhoto = async (file, stage) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Debes iniciar sesión para guardar la foto.');
  const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[file.type] || 'jpg';
  const path = `odometer/${user.id}/${stage}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('vehicle-evidence').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
  if (error) throw error;
  odometerStoragePaths.set(file, path);
  return path;
};

function PhotoSource({ onChange, onStored, accept = 'image/*', withCamera = true }) {
  const [fileName, setFileName] = useState('');
  const select = async event => {
    const input = event.currentTarget;
    const originalFile = input.files?.[0];
    if (!originalFile) return;
    const labelText = input.closest('.field')?.querySelector(':scope > label')?.textContent?.toLowerCase() || '';
    let file;
    try {
      setFileName('Preparando foto…');
      file = await prepareImageForUpload(originalFile);
    } catch (error) {
      setFileName(`No se aceptó la foto: ${error.message}`);
      input.value = '';
      return;
    }
    // Primero se valida. Una foto que no es del tablero nunca llega a Storage.
    const accepted = await onChange({ target: { files: [file] } });
    if (accepted === false) {
      setFileName('Foto rechazada: toma una imagen clara del tablero y del odómetro.');
      input.value = '';
      return;
    }
    const stage = labelText.includes('odómetro') && labelText.includes('salida') ? 'departure' : labelText.includes('odómetro') && (labelText.includes('final') || labelText.includes('retorno')) ? 'return' : '';
    setFileName(stage ? 'Guardando foto en la nube…' : `✓ Foto preparada: ${imageSizeLabel(file.size)}`);
    if (stage) {
      try {
        const path = await uploadOdometerPhoto(file, stage);
        onStored?.({ file, path });
        setFileName(`✓ Foto guardada: ${imageSizeLabel(file.size)}`);
      } catch (error) {
        setFileName(`Foto seleccionada, pero no se pudo guardar: ${error.message}`);
      }
    }
  };
  return <div className="photo-source">{withCamera && <label>◉ Tomar foto<input type="file" accept={accept} capture="environment" onChange={select} /></label>}<label>▣ Elegir de galería<input type="file" accept={accept} onChange={select} /></label>{fileName && <small className="photo-loaded">{fileName}</small>}</div>;
}

function DepartureGpsRequired({ data, driverName = '', driverId = '', assignedVehicleId = '', assignedVehicleLabel = '', onClose, onSave }) {
  const [form, setForm] = useState({ departureDate: today(), departureTime: now(), driver: driverName, vehicleId: assignedVehicleId });
  const [status, setStatus] = useState('');
  const [gpsReady, setGpsReady] = useState(false);
  const [clock, setClock] = useState(now());
  const [photoSelected, setPhotoSelected] = useState(false);
  const assignedVehicle = data.vehicles.find(vehicle => String(vehicle.id) === String(assignedVehicleId));
  const assignedLabel = assignedVehicle ? `${assignedVehicle.plate} · ${assignedVehicle.brand}` : assignedVehicleLabel;
  const pendingTrip = data.trips.find(trip => isTripOpen(trip) && (
    (driverId && String(trip.driver || '') === String(driverId)) ||
    (!driverId && form.driver && String(trip.driver || '').trim().toLowerCase() === String(form.driver).trim().toLowerCase()) ||
    (form.vehicleId && String(trip.vehicleId || '') === String(form.vehicleId))
  ));
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  useEffect(() => { if (driverName) change('driver', driverName); }, [driverName]);
  useEffect(() => { if (assignedVehicleId) change('vehicleId', assignedVehicleId); }, [assignedVehicleId]);
  useEffect(() => { const timer = setInterval(() => { const time = now(); setClock(time); setForm(current => ({ ...current, departureDate: today(), departureTime: time })); }, 1000); return () => clearInterval(timer); }, []);
  const ocr = async file => {
    if (!file) return;
    // Solo una foto nítida y validada del tablero permite registrar la salida.
    setPhotoSelected(false);
    change('startPhoto', '');
    setStatus('Validando que la foto muestre el tablero y el kilometraje…');
    try {
      const result = await recognizeOdometerKm(file, {
        minimumKm: assignedVehicle ? currentKm(data, assignedVehicle) : 0,
        stage: 'departure',
        strictVisual: true,
      });
      const km = result.km;
      if (Number.isFinite(km)) {
        setStatus('Tablero y kilometraje visibles. Foto validada; escribe manualmente el kilometraje mostrado. Guardando foto…');
        return true;
      } else {
        setStatus(result.message || 'La foto no permite leer el odómetro. Toma nuevamente una foto clara del tablero.');
        return false;
      }
    } catch {
      setStatus('No se pudo validar la fotografía. Toma nuevamente una foto clara del tablero.');
      return false;
    }
  };
  const storeDeparturePhoto = ({ path }) => {
    change('startPhoto', path);
    setPhotoSelected(true);
    setStatus('Foto del tablero guardada correctamente. Escribe manualmente el kilometraje que aparece en la foto.');
  };
  const gps = () => {
    if (!navigator.geolocation) return setStatus('Este navegador no permite GPS.');
    setStatus('Obteniendo ubicación y dirección…');
    navigator.geolocation.getCurrentPosition(async position => {
      const { latitude, longitude, accuracy } = position.coords;
      // El primer punto del recorrido es el origen real. Se conserva para
      // impedir que una llegada se confirme en la misma ubicación.
      const departurePoint = {
        lat: latitude,
        lng: longitude,
        accuracy: Math.round(accuracy),
        timestamp: Date.now(),
        at: new Date().toISOString(),
      };
      let origin = `GPS: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
      try { const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`); const place = await response.json(); origin = place.display_name || origin; } catch {}
      change('origin', origin); change('routePoints', [departurePoint]); change('gpsAccuracy', Math.round(accuracy)); setGpsReady(true); setStatus('Origen GPS registrado correctamente.');
    }, () => { setGpsReady(false); setStatus('Debes permitir la ubicación GPS para confirmar la salida.'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };
  const submit = event => {
    event.preventDefault();
    if (pendingTrip) return alert('Primero debes registrar la llegada de tu salida pendiente.');
    if (!gpsReady) return;
    if (!photoSelected) return alert('Debes subir una foto clara y validada del tablero antes de confirmar.');
    if (!isPositiveKilometer(form.startKm)) return alert('Escribe manualmente un kilometraje de salida válido.');
    onSave({ ...form, id: id(), departureDate: today(), departureTime: now(), status: 'En ruta' });
  };
  return <><dialog open className="quick-departure-modal"><form onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">SALIDA</p><h2>Registrar salida rápida</h2></div><button type="button" className="close" onClick={onClose}>×</button></div><p className="live-clock">Hora actual: <b>{clock}</b></p>{pendingTrip ? <><p className="empty-message">Ya tienes una salida pendiente con <b>{vehicleName(data, pendingTrip.vehicleId)}</b>. Registra primero tu llegada para iniciar otro recorrido.</p><div className="form-actions"><button type="button" className="primary" onClick={onClose}>Entendido</button></div></> : <>{status && <p className="ocr-status" aria-live="polite">{status}</p>}<div className="form-grid"><div className="field full"><label>Vehículo asignado</label><select required value={form.vehicleId || ''} onChange={event => change('vehicleId', event.target.value)}>{assignedVehicleId && <option value={assignedVehicleId}>{assignedLabel || 'Vehículo asignado'}</option>}{!assignedVehicleId && <option value="">Seleccionar vehículo</option>}{data.vehicles.filter(vehicle => String(vehicle.id) !== String(assignedVehicleId)).map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.brand}</option>)}</select><small className="field-help">Tu vehículo aparece por defecto. Cámbialo solo si ese día utilizas otra movilidad.</small></div><div className="field"><label>Fecha</label><input type="date" value={form.departureDate} readOnly /></div><div className="field"><label>Hora</label><input type="time" step="1" value={form.departureTime} readOnly /></div><div className="field"><label>Conductor</label><input required value={form.driver || ''} onChange={event => change('driver', event.target.value)} readOnly={Boolean(driverName)} placeholder="Se completa al iniciar sesión" /></div><div className="field"><label>Origen detectado por GPS</label><input required value={form.origin || ''} readOnly placeholder="Activa GPS para obtener la dirección" /><button type="button" className="gps-button" onClick={gps}>⌖ Activar GPS y obtener origen</button></div><div className="field full"><label>Foto del odómetro de salida</label><PhotoSource onChange={event => ocr(event.target.files?.[0])} onStored={storeDeparturePhoto} /></div><div className="field full"><label>Kilometraje de salida</label><input required type="text" inputMode="decimal" pattern="\d+(?:\.\d+)?" value={form.startKm || ''} onChange={event => change('startKm', normalizeKilometerInput(event.target.value))} placeholder="Escribe el kilometraje que muestra el tablero" /><small className="field-help">La foto validada es obligatoria. Después escribe manualmente el kilometraje que aparece en el tablero.</small></div></div><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={!gpsReady || !photoSelected || !isPositiveKilometer(form.startKm)}>Confirmar salida</button></div></>}</form></dialog>{!pendingTrip && <EvidenceInjector />}</>;
}

function ArrivalSimple({ data, driverName = '', driverId = '', onClose, onSave }) {
  const active = data.trips.filter(trip => isTripOpen(trip) && (driverId ? String(trip.driver || '') === String(driverId) : !driverName || String(trip.driver || '').trim().toLowerCase() === String(driverName).trim().toLowerCase()));
  const [form, setForm] = useState(() => ({ returnDate: today(), returnTime: now(), tripId: active.length === 1 ? active[0].id : '' }));
  const [status, setStatus] = useState('');
  const [gpsStatus, setGpsStatus] = useState('');
  const [gpsReady, setGpsReady] = useState(false);
  const [photoSelected, setPhotoSelected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clock, setClock] = useState(now());
  const trip = active.find(item => item.id === form.tripId);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  useEffect(() => { if (active.length === 1) change('tripId', active[0].id); }, [active.length, active[0]?.id]);
  useEffect(() => {
    const timer = setInterval(() => {
      const time = now();
      setClock(time);
      setForm(current => ({ ...current, returnDate: today(), returnTime: time }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const gps = () => {
    if (!navigator.geolocation) return setGpsStatus('Este navegador no permite GPS.');
    setGpsReady(false);
    setGpsStatus('Obteniendo ubicación y dirección…');
    navigator.geolocation.getCurrentPosition(async position => {
      const { latitude, longitude, accuracy } = position.coords;
      const arrivalPoint = {
        lat: latitude,
        lng: longitude,
        accuracy: Math.round(accuracy),
        timestamp: Date.now(),
        at: new Date().toISOString(),
      };
      const coordinates = `GPS: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
      change('destination', coordinates);
      change('arrivalPoint', arrivalPoint);
      change('gpsAccuracy', Math.round(accuracy));
      setGpsReady(true);
      setGpsStatus('Ubicación GPS registrada. Buscando la dirección…');
      let destination = coordinates;
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);
        const place = await response.json();
        destination = place.display_name || destination;
      } catch {}
      change('destination', destination);
      setGpsStatus('Destino GPS registrado correctamente.');
    }, () => { setGpsReady(false); setGpsStatus('Debes permitir la ubicación GPS para registrar el destino.'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };
  useEffect(() => { gps(); }, []);
  const odometer = async file => {
    if (!file) return false;
    // La llegada solo se registra con una foto clara y validada del tablero.
    setPhotoSelected(false); change('endPhoto', ''); setStatus('Validando que la foto muestre el tablero y el kilometraje…');
    try {
      const result = await recognizeOdometerKm(file, {
        minimumKm: Number(trip?.startKm) || 0,
        stage: 'arrival',
        strictVisual: true,
      });
      const km = result.km;
      if (Number.isFinite(km)) {
        setStatus('Tablero y kilometraje visibles. Foto validada; escribe manualmente el kilometraje final. Guardando foto…');
        return true;
      } else {
        setStatus(result.message || 'La foto no permite leer el odómetro. Toma nuevamente una foto clara del tablero.');
        return false;
      }
    } catch {
      setStatus('No se pudo validar la fotografía. Toma nuevamente una foto clara del tablero.');
      return false;
    }
  };
  const storeArrivalPhoto = ({ path }) => {
    change('endPhoto', path);
    setPhotoSelected(true);
    setStatus('Foto del tablero guardada correctamente. Escribe manualmente el kilometraje final que aparece en la foto.');
  };
  const submit = async event => {
    event.preventDefault();
    if (!trip || !form.destination) return alert('Registra el GPS de destino antes de confirmar.');
    if (!photoSelected) return alert('Sube una foto clara y validada del tablero antes de confirmar.');
    if (!isPositiveKilometer(form.endKm)) return alert('Escribe manualmente un kilometraje final válido.');
    if (trip.origin && normalizePlace(trip.origin) === normalizePlace(form.destination)) {
      setGpsReady(false);
      return setGpsStatus('El destino coincide con el origen. Debes registrar la llegada desde otra ubicación.');
    }
    const departurePoint = trip.routePoints?.[0];
    if (departurePoint && form.arrivalPoint) {
      const distance = gpsDistanceMeters(departurePoint, form.arrivalPoint);
      // Un margen de 100 m evita cerrar el recorrido en la misma zona, pero
      // también absorbe la variación habitual de precisión del GPS.
      if (distance < 100) {
        setGpsReady(false);
        return setGpsStatus(`La llegada está a ${Math.round(distance)} m del origen. Avanza al menos 100 m antes de confirmarla.`);
      }
    }
    if (!isArrivalKilometerGreater(trip.startKm, form.endKm)) return alert('El kilometraje final debe ser mayor al kilometraje de salida.');
    setSaving(true);
    setStatus('Guardando llegada y cerrando el recorrido…');
    const registered = await onSave({ ...trip, endKm: form.endKm, endPhoto: form.endPhoto, returnDate: today(), returnTime: now(), destination: form.destination, status: 'Finalizado' });
    if (!registered) {
      setSaving(false);
      setStatus('La llegada no se pudo confirmar. Revisa los datos e inténtalo nuevamente.');
    }
  };
  return (
    <dialog open className="quick-departure-modal">
      <form onSubmit={submit}>
        <div className="modal-head">
          <div><p className="eyebrow">LLEGADA</p><h2>Registrar llegada</h2></div>
          <button type="button" className="close" onClick={onClose}>×</button>
        </div>
        <p className="live-clock">Hora actual: <b>{clock}</b></p>
        {gpsStatus && <p className="ocr-status">{gpsStatus}</p>}
        {status && <p className="ocr-status" aria-live="polite">{status}</p>}
        {active.length === 0 ? <p className="empty-message">No hay una salida pendiente.</p> : <>
          <div className="form-grid">
            <div className="field full">
              <label>Vehículo en ruta</label>
              {active.length === 1
                ? <input value={vehicleName(data, active[0].vehicleId)} readOnly />
                : <select required value={form.tripId || ''} onChange={event => change('tripId', event.target.value)}>
                    <option value="">Seleccionar vehículo</option>
                    {active.map(item => <option key={item.id} value={item.id}>{vehicleName(data, item.vehicleId)} · {item.driver}</option>)}
                  </select>}
              <small className="field-help">Corresponde al vehículo con el que registraste tu salida.</small>
            </div>
            <div className="field full"><label>Fecha</label><input type="date" value={form.returnDate} readOnly /></div>
            <div className="field full">
              <label>Destino real</label>
              <input required value={form.destination || ''} readOnly placeholder="Obteniendo GPS…" />
              <button type="button" className="gps-button" onClick={gps}>⌖ Actualizar destino con GPS</button>
            </div>
            <div className="field full">
              <label>Foto del odómetro final</label>
              <PhotoSource onChange={event => odometer(event.target.files?.[0])} onStored={storeArrivalPhoto} />
            </div>
            <div className="field full">
              <label>Kilometraje final</label>
              <input required type="text" inputMode="decimal" pattern="\d+(?:\.\d+)?" value={form.endKm || ''} onChange={event => change('endKm', normalizeKilometerInput(event.target.value))} placeholder="Escribe el kilometraje que muestra el tablero" />
              <small className="field-help">La foto validada es obligatoria. Después escribe manualmente el kilometraje final; debe ser mayor al de salida.</small>
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="primary" disabled={saving || !trip || !gpsReady || !photoSelected || !isArrivalKilometerGreater(trip?.startKm, form.endKm)}>{saving ? 'Guardando llegada…' : 'Confirmar llegada'}</button>
          </div>
        </>}
      </form>
    </dialog>
  );
}

createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(registration => registration.update()).catch(() => {}));
}
