import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');

test('declara la capacidad web móvil moderna junto con la compatibilidad de Apple', () => {
  assert.match(indexSource, /<meta name="mobile-web-app-capable" content="yes" \/>/);
  assert.match(indexSource, /<meta name="apple-mobile-web-app-capable" content="yes" \/>/);
});

test('el service worker ignora protocolos internos de las extensiones del navegador', () => {
  assert.match(workerSource, /requestUrl\.protocol !== 'http:' && requestUrl\.protocol !== 'https:'/);
  assert.match(workerSource, /const CACHE_NAME = 'rutacontrol-v102'/);
});

test('reemplaza una sola vez el service worker antiguo sin usar la caché', () => {
  assert.match(mainSource, /const workerVersion = 'v102'/);
  assert.match(mainSource, /await previous\.unregister\(\)/);
  assert.match(mainSource, /controllerchange/);
  assert.match(mainSource, /updateViaCache: 'none'/);
});
