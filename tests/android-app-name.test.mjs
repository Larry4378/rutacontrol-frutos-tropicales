import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const strings = await readFile(new URL('../android/app/src/main/res/values/strings.xml', import.meta.url), 'utf8');
const capacitor = JSON.parse(await readFile(new URL('../capacitor.config.json', import.meta.url), 'utf8'));
const service = await readFile(new URL('../android/app/src/main/java/com/frutostropicales/rutacontrol/LocationTrackingService.java', import.meta.url), 'utf8');
const deploy = await readFile(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
const verify = await readFile(new URL('../.github/workflows/verify-android.yml', import.meta.url), 'utf8');

test('el instalador y la aplicación muestran FTP-ODOMETRO', () => {
  assert.equal(capacitor.appName, 'FTP-ODOMETRO');
  assert.match(strings, /<string name="app_name">FTP-ODOMETRO<\/string>/);
  assert.match(strings, /<string name="title_activity_main">FTP-ODOMETRO<\/string>/);
  assert.match(service, /FTP-ODOMETRO · GPS en vivo/);
});

test('los workflows entregan el archivo FTP-ODOMETRO.apk', () => {
  for (const workflow of [deploy, verify]) {
    assert.match(workflow, /FTP-ODOMETRO\.apk/);
    assert.match(workflow, /cp android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk/);
  }
});
