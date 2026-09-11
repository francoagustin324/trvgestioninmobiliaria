import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const recovery = readFileSync('src/sync-recovery-bootstrap.ts', 'utf8');
const auth = readFileSync('src/mvp-auth.ts', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('F reemplaza el blocker C1: bootstrap ya no intercepta resolución', () => {
  assert.doesNotMatch(recovery, /document\.addEventListener\('click'/);
  assert.doesNotMatch(recovery, /event\.preventDefault\(\)|event\.stopPropagation\(\)|event\.stopImmediatePropagation\(\)/);
  assert.doesNotMatch(recovery, /TENANT_RECOVERY_CUTOVER_REQUIRED/);
  assert.match(recovery, /TENANT_RECOVERY_CUTOVER_COMPLETE/);
});

test('F habilita el único handler tenant-aware data-account-resolve', () => {
  const handlers = auth.match(/querySelector<HTMLElement>\('\[data-account-resolve\]'\)\?\.addEventListener\('click'/g) ?? [];
  assert.equal(handlers.length, 1);
  assert.match(auth, /void resolveSyncDifferences\(\)/);
  assert.match(auth, /const scope = requireCurrentTenantScope\(\);\s*const runtimeLease = captureTenantRuntimeLease\(scope\);/);
});

test('bootstrap F sigue sin conservar caminos user-only de read/write/pull/push', () => {
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

test('mantiene publicado el bootstrap sin cache-busting fuera de scope F', () => {
  const compatibilityVersion = html.match(/cloud-compat-bootstrap\.js\?v=([^"']+)/)?.[1];
  const mainVersion = html.match(/mvp-main\.js\?v=([^"']+)/)?.[1];
  const recoveryVersion = html.match(/sync-recovery-bootstrap\.js\?v=([^"']+)/)?.[1];
  assert.equal(compatibilityVersion, '20260802-1');
  assert.equal(mainVersion, '20260906-p1-4-a2-2-1');
  assert.equal(recoveryVersion, '20260802-1');
});
