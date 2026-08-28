import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const quickStyles = await readFile(new URL('../src/quick.css', import.meta.url), 'utf8');

test('la llegada solicita el GPS automáticamente al abrirse', () => {
  const arrivalSource = mainSource.slice(mainSource.indexOf('function ArrivalSimple'));
  assert.match(arrivalSource, /useEffect\(\(\) => \{ gps\(\); \}, \[\]\);/);
});

test('la llegada reintenta el GPS al adjuntar la foto si aún no está listo', () => {
  const arrivalSource = mainSource.slice(mainSource.indexOf('function ArrivalSimple'));
  assert.match(arrivalSource, /if \(!gpsReady\) gps\(\);/);
});

test('el campo de destino y su botón GPS no están ocultos en llegada', () => {
  assert.match(mainSource, /className="arrival-form"/);
  assert.match(mainSource, />⌖ Actualizar destino con GPS<\/button>/);
  assert.doesNotMatch(quickStyles, /\.arrival-form[^\n{]*nth-of-type\(3\)[^{]*\{\s*display\s*:\s*none/);
  assert.match(quickStyles, /\.departure-form \.form-grid>\.field:nth-of-type\(3\)\{display:none\}/);
});
