import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const recovery = readFileSync('src/sync-recovery-bootstrap.ts', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('C1 recovery: intercepta resolución antes del controlador histórico', () => {
  assert.ok(recovery.includes("closest<HTMLElement>('[data-account-resolve]')"));
  assert.ok(recovery.includes('event.stopImmediatePropagation()'));
  assert.match(recovery, /document\.addEventListener\('click',[\s\S]*true\);/);
});

test('C1 recovery: queda explícitamente fail-closed hasta A1.2-F', () => {
  assert.match(recovery, /TENANT_RECOVERY_CUTOVER_REQUIRED/);
  assert.match(recovery, /No se modificó ningún dato/);
  assert.match(recovery, /kind:\s*'error'/);
});

test('C1 recovery: no conserva ningún camino user-only de read/write/pull/push', () => {
  for (const forbidden of [
    /getSyncState\(/,
    /markSyncError\(/,
    /restoreSyncStateSnapshot\(/,
    /authorizeConfirmedCloudResolution\(/,
    /pullCloudData\(/,
    /pushCloudData\(/,
    /replaceData\(/,
    /state\.crm/,
    /sync-safety\.js/,
    /cloud-api-compatible\.js/,
  ]) {
    assert.doesNotMatch(recovery, forbidden);
  }
});

test('publica compatibilidad y recovery fail-closed con mvp-main A2.2', () => {
  const compatibilityVersion = html.match(/cloud-compat-bootstrap\.js\?v=([^"']+)/)?.[1];
  const mainVersion = html.match(/mvp-main\.js\?v=([^"']+)/)?.[1];
  const recoveryVersion = html.match(/sync-recovery-bootstrap\.js\?v=([^"']+)/)?.[1];
  assert.equal(compatibilityVersion, '20260802-1');
  assert.equal(mainVersion, '20260906-p1-4-a2-2-1');
  assert.equal(recoveryVersion, '20260802-1');
});
