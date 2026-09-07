import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const deploy = await readFile(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
const verify = await readFile(new URL('../.github/workflows/verify-web.yml', import.meta.url), 'utf8');

test('el manifiesto permite instalar FTP-ODOMETRO desde el navegador', () => {
  assert.equal(manifest.id, './');
  assert.equal(manifest.name, 'FTP-ODOMETRO');
  assert.equal(manifest.short_name, 'FTP-ODOMETRO');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
  assert.match(indexSource, /rel="manifest" href="\.\/manifest\.webmanifest"/);
});

test('la interfaz captura la instalación PWA y ofrece instrucciones alternativas', () => {
  assert.match(mainSource, /beforeinstallprompt/);
  assert.match(mainSource, /appinstalled/);
  assert.match(mainSource, /Instalar aplicación/);
  assert.match(mainSource, /Agregar a pantalla principal/);
});

test('los workflows verifican y publican solo la aplicación web', () => {
  for (const workflow of [deploy, verify]) {
    assert.doesNotMatch(workflow, /assembleDebug|gradlew|\.apk|setup-java|cap sync android/i);
    assert.match(workflow, /npm test/);
    assert.match(workflow, /npm run build/);
  }
  assert.match(deploy, /actions\/deploy-pages@v4/);
});
