import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const recovery = readFileSync('src/sync-recovery-bootstrap.ts', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('intercepta el botón de resolución antes del controlador anterior', () => {
  assert.ok(recovery.includes("closest<HTMLElement>('[data-account-resolve]')"));
  assert.ok(recovery.includes('event.stopImmediatePropagation()'));
  assert.match(recovery, /document\.addEventListener\('click',[\s\S]*true\);/);
});

test('conserva ambas copias y usa la computadora sólo después de confirmación explícita', () => {
  assert.ok(recovery.includes('reconcileCrmSnapshots(originalLocal, inspected.cloud)'));
  assert.ok(recovery.includes('se conservará la versión de esta computadora'));
  assert.ok(recovery.includes('Los registros exclusivos de la nube también se conservarán'));
  assert.ok(recovery.includes('No se eliminará ningún registro'));
  assert.ok(recovery.includes('window.confirm(confirmation)'));
});

test('revisa nuevamente la nube y verifica el resultado final', () => {
  assert.ok(recovery.includes('latestInspection.cloud'));
  assert.ok(recovery.includes('stableFingerprint(latestInspection.cloud)'));
  assert.ok(recovery.includes('authorizeConfirmedCloudResolution(latestInspection.remoteVersion)'));
  assert.ok(recovery.includes('await pushCloudData(state.crm)'));
  assert.ok(recovery.includes('const verified = await pullCloudData(state.crm)'));
  assert.ok(recovery.includes('verification.localOnlyCount || verification.cloudOnlyCount || verification.conflictCount'));
});

test('publica los tres módulos JavaScript con la misma versión de caché', () => {
  const compatibilityVersion = html.match(/cloud-compat-bootstrap\.js\?v=([^"']+)/)?.[1];
  const mainVersion = html.match(/mvp-main\.js\?v=([^"']+)/)?.[1];
  const recoveryVersion = html.match(/sync-recovery-bootstrap\.js\?v=([^"']+)/)?.[1];
  assert.ok(compatibilityVersion);
  assert.equal(mainVersion, compatibilityVersion);
  assert.equal(recoveryVersion, compatibilityVersion);
});
