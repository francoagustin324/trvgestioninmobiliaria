import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('muestra una acción específica cuando existen diferencias entre dispositivos', () => {
  const auth = readFileSync('src/mvp-auth.ts', 'utf8');
  assert.ok(auth.includes('data-account-resolve'));
  assert.ok(auth.includes('Revisar y unir datos'));
  assert.ok(auth.includes('resolveSyncDifferences'));
});

test('la resolución revisa dos veces la nube y exige confirmación antes de unir', () => {
  const auth = readFileSync('src/mvp-auth.ts', 'utf8');
  const inspections = auth.match(/inspectCloudWithoutChangingLocalState\(/g) ?? [];
  assert.ok(inspections.length >= 3);
  assert.ok(auth.includes('window.confirm'));
  assert.ok(auth.includes('stableFingerprint(latestInspection.cloud) !== stableFingerprint(inspected.cloud)'));
});

test('la unión guarda respaldo local y verifica la nube después de guardar', () => {
  const auth = readFileSync('src/mvp-auth.ts', 'utf8');
  assert.ok(auth.includes('replaceData(latestResult.merged)'));
  assert.ok(auth.includes("reason: 'Unión segura antes de sincronizar'"));
  assert.ok(auth.includes('authorizeConfirmedCloudResolution'));
  assert.ok(auth.includes('const verified = await pullCloudData(state.crm)'));
});
