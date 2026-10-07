import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const RESOLVE_START = 'export async function resolveSyncDifferences(): Promise<void> {';
const RESOLVE_END = 'export function hasAuthenticatedSession(): boolean {';

function resolveSyncDifferencesBody(auth: string): string {
  const start = auth.indexOf(RESOLVE_START);
  assert.notEqual(start, -1, 'resolveSyncDifferences() must exist');
  const end = auth.indexOf(RESOLVE_END, start + RESOLVE_START.length);
  assert.notEqual(end, -1, 'resolveSyncDifferences() must remain isolated before hasAuthenticatedSession()');
  return auth.slice(start, end);
}

function requiredIndex(body: string, snippet: string, label: string): number {
  const index = body.indexOf(snippet);
  assert.notEqual(index, -1, `${label} is required inside resolveSyncDifferences()`);
  return index;
}

function assertResolveSyncDifferencesTenantContract(body: string): void {
  const mergeIndex = requiredIndex(
    body,
    'const mergedSnapshot = structuredClone(latestResult.merged)',
    'immutable merged snapshot',
  );
  const localReplacementIndex = requiredIndex(
    body,
    'replaceDataForTenant(scope, mergedSnapshot)',
    'tenant-scoped local replacement',
  );
  const dirtySnapshotIndex = requiredIndex(
    body,
    'writeTenantSnapshot(scope, mergedSnapshot',
    'tenant-scoped dirty snapshot write',
  );
  const authorizationIndex = requiredIndex(
    body,
    'authorizeConfirmedCloudResolution(scope, latestInspection.remoteVersion)',
    'confirmed cloud resolution authorization',
  );
  const pushIndex = requiredIndex(
    body,
    'await pushCloudData(scope, mergedSnapshot)',
    'tenant-scoped cloud push',
  );
  const pullIndex = requiredIndex(
    body,
    'const verified = await pullCloudData(scope, mergedSnapshot)',
    'tenant-scoped cloud verification pull',
  );
  const reconciliationIndex = requiredIndex(
    body,
    'reconcileCrmSnapshots(mergedSnapshot, verified)',
    'post-push reconciliation verification',
  );
  const finalReplacementIndex = requiredIndex(
    body,
    'replaceDataForTenant(scope, verified)',
    'verified tenant-scoped final replacement',
  );

  assert.ok(
    mergeIndex < localReplacementIndex
      && localReplacementIndex < dirtySnapshotIndex
      && dirtySnapshotIndex < authorizationIndex
      && authorizationIndex < pushIndex
      && pushIndex < pullIndex
      && pullIndex < reconciliationIndex
      && reconciliationIndex < finalReplacementIndex,
    'tenant recovery phases must stay in the protected merge -> local -> dirty -> authorize -> push -> pull -> verify -> final order',
  );

  const dirtySnapshotContract = body.slice(dirtySnapshotIndex, authorizationIndex);
  assert.ok(dirtySnapshotContract.includes('markDirty: true'), 'merged tenant snapshot must stay dirty before cloud push');
  assert.ok(
    dirtySnapshotContract.includes("reason: 'Unión segura antes de sincronizar'"),
    'merged tenant snapshot must keep the recovery audit reason',
  );
  assert.ok(dirtySnapshotContract.includes('backup: false'), 'explicit merged snapshot write must not create a second backup');

  const guardBeforeLocalReplacement = body.indexOf('assertTenantRuntimeLeaseCurrent(runtimeLease)', mergeIndex);
  assert.ok(
    guardBeforeLocalReplacement > mergeIndex && guardBeforeLocalReplacement < localReplacementIndex,
    'runtime lease must be checked immediately before the local tenant mutation phase',
  );

  const guardAfterPush = body.indexOf('assertTenantRuntimeLeaseCurrent(runtimeLease)', pushIndex);
  assert.ok(
    guardAfterPush > pushIndex && guardAfterPush < pullIndex,
    'runtime lease must be checked after cloud push before verification pull',
  );

  const guardAfterPull = body.indexOf('assertTenantRuntimeLeaseCurrent(runtimeLease)', pullIndex);
  assert.ok(
    guardAfterPull > pullIndex && guardAfterPull < reconciliationIndex,
    'runtime lease must be checked after verification pull before reconciliation',
  );

  assert.ok(
    body.includes('if (!replaceDataForTenant(scope, verified)) assertTenantRuntimeLeaseCurrent(runtimeLease);'),
    'final tenant replacement must retain its runtime-lease fence',
  );

  assert.equal(body.includes('replaceData(latestResult.merged)'), false, 'legacy global merge replacement is forbidden');
  assert.equal(body.includes('pullCloudData(state.crm)'), false, 'legacy state.crm cloud verification is forbidden');
  assert.equal(body.includes('replaceData('), false, 'global replaceData() is forbidden inside resolveSyncDifferences()');
  assert.equal(body.includes('pushCloudData(mergedSnapshot)'), false, 'cloud push without explicit tenant scope is forbidden');
  assert.equal(body.includes('replaceData(verified)'), false, 'final global replacement without tenant scope is forbidden');
}

function swapOrderedSnippets(body: string, first: string, second: string): string {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.ok(firstIndex >= 0 && secondIndex > firstIndex, 'adversarial swap requires the current safe order');
  return body.slice(0, firstIndex)
    + second
    + body.slice(firstIndex + first.length, secondIndex)
    + first
    + body.slice(secondIndex + second.length);
}

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
  const body = resolveSyncDifferencesBody(auth);
  assertResolveSyncDifferencesTenantContract(body);
});

test('el contrato estático tenant-aware rechaza regresiones legacy y pérdida de protecciones', () => {
  const auth = readFileSync('src/mvp-auth.ts', 'utf8');
  const body = resolveSyncDifferencesBody(auth);
  const localReplacement = 'if (!replaceDataForTenant(scope, mergedSnapshot)) assertTenantRuntimeLeaseCurrent(runtimeLease);';
  const cloudPush = 'await pushCloudData(scope, mergedSnapshot);';
  const finalReplacement = 'if (!replaceDataForTenant(scope, verified)) assertTenantRuntimeLeaseCurrent(runtimeLease);';

  const adversarialMutations: Array<{ name: string; mutate: (source: string) => string }> = [
    {
      name: 'legacy global merge replacement',
      mutate: (source) => source.replace(localReplacement, 'replaceData(latestResult.merged);'),
    },
    {
      name: 'legacy state.crm verification pull',
      mutate: (source) => source.replace(
        'const verified = await pullCloudData(scope, mergedSnapshot);',
        'const verified = await pullCloudData(state.crm);',
      ),
    },
    {
      name: 'cloud push without scope',
      mutate: (source) => source.replace(cloudPush, 'await pushCloudData(mergedSnapshot);'),
    },
    {
      name: 'final replacement without scope',
      mutate: (source) => source.replace(finalReplacement, 'replaceData(verified);'),
    },
    {
      name: 'push before local protection',
      mutate: (source) => swapOrderedSnippets(source, localReplacement, cloudPush),
    },
    {
      name: 'missing confirmed cloud resolution authorization',
      mutate: (source) => source.replace(
        'authorizeConfirmedCloudResolution(scope, latestInspection.remoteVersion);',
        'void latestInspection.remoteVersion;',
      ),
    },
    {
      name: 'missing final cloud verification pull',
      mutate: (source) => source.replace(
        'const verified = await pullCloudData(scope, mergedSnapshot);',
        'const verified = mergedSnapshot;',
      ),
    },
  ];

  for (const mutation of adversarialMutations) {
    const mutated = mutation.mutate(body);
    assert.notEqual(
      mutated,
      body,
      `adversarial mutation must modify source: ${mutation.name}`,
    );
    assert.throws(
      () => assertResolveSyncDifferencesTenantContract(mutated),
      Error,
      `contract must reject: ${mutation.name}`,
    );
  }
});
