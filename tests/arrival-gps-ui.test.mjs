import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const quickStyles = await readFile(new URL('../src/quick.css', import.meta.url), 'utf8');

test('la llegada solicita el GPS automáticamente al abrirse', () => {
  const arrivalSource = mainSource.slice(mainSource.indexOf('function ArrivalSimple'));
  assert.match(arrivalSource, /useEffect\(\(\) => \{ gps\(\); \}, \[\]\);/);
});

test('adjuntar la foto no vuelve a ejecutar ni reemplaza el GPS de llegada', () => {
  const arrivalSource = mainSource.slice(mainSource.indexOf('function ArrivalSimple'));
  const photoHandler = arrivalSource.slice(arrivalSource.indexOf('const odometer'), arrivalSource.indexOf('const storeArrivalPhoto'));
  assert.doesNotMatch(photoHandler, /gps\(\)/);
});

test('si existen coordenadas reales no rechaza solo por repetir el texto de la calle', () => {
  const arrivalSource = mainSource.slice(mainSource.indexOf('function ArrivalSimple'));
  assert.match(arrivalSource, /const samePlace = !Number\.isFinite\(distance\)/);
});

test('si la llegada realmente coincide con el origen muestra el aviso superior', () => {
  const arrivalSource = mainSource.slice(mainSource.indexOf('function ArrivalSimple'));
  assert.match(arrivalSource, /if \(samePlace \|\| \(Number\.isFinite\(distance\) && distance < 100\)\) \{[\s\S]*?setGpsStatus\(validationError\);/);
});

test('el campo de destino y su botón GPS no están ocultos en llegada', () => {
  assert.match(mainSource, /className="arrival-form"/);
  assert.match(mainSource, />⌖ Actualizar destino con GPS<\/button>/);
  assert.doesNotMatch(quickStyles, /\.arrival-form[^\n{]*nth-of-type\(3\)[^{]*\{\s*display\s*:\s*none/);
  assert.match(quickStyles, /\.departure-form \.form-grid>\.field:nth-of-type\(3\)\{display:none\}/);
});
