import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LatestSerialQueue } from '../cloud-save-serial.js';
import { initialData } from '../models.js';
import {
  getSyncState,
  markCloudHydrated,
  markCloudSaved,
  readLocalSnapshot,
  stableFingerprint,
  syncSaveToken,
  writeLocalSnapshot,
} from '../sync-safety.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function signedStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  storage.setItem('propcontrol-cloud-session-v1', JSON.stringify({ userId: 'franco-user' }));
  return storage;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('cola serial: B nunca compite con A y empieza únicamente después de A', async () => {
  const a = deferred();
  const b = deferred();
  const started: string[] = [];
  let active = 0;
  let maxActive = 0;
  const queue = new LatestSerialQueue<string>(async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    started.push(value);
    await (value === 'A' ? a.promise : b.promise);
    active -= 1;
  });

  const saveA = queue.enqueue('A');
  await Promise.resolve();
  const saveB = queue.enqueue('B');
  await Promise.resolve();
  assert.deepEqual(started, ['A']);
  assert.equal(maxActive, 1);

  a.resolve();
  while (started.length < 2) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, ['A', 'B']);
  assert.equal(maxActive, 1);

  b.resolve();
  await Promise.all([saveA, saveB]);
  assert.equal(maxActive, 1);
});

test('cola serial colapsa cambios pendientes y conserva la generación más reciente', async () => {
  const a = deferred();
  const completed: string[] = [];
  const queue = new LatestSerialQueue<string>(async (value) => {
    if (value === 'A') await a.promise;
    completed.push(value);
  });

  const first = queue.enqueue('A');
  await Promise.resolve();
  const second = queue.enqueue('B');
  const third = queue.enqueue('C');
  a.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(completed, ['A', 'C']);
});

test('dirty: un markCloudSaved viejo no puede limpiar una generación posterior', () => {
  const storage = signedStorage();
  const a = structuredClone(initialData);
  writeLocalSnapshot(a, { reason: 'A' }, storage);
  const tokenA = syncSaveToken(a, storage);

  const b = structuredClone(a);
  b.clients[0]!.nextFollowUp = '2026-08-08';
  b.clients[0]!.nextAction = 'Volver a contactar por WhatsApp';
  writeLocalSnapshot(b, { reason: 'B' }, storage);

  const latest = markCloudSaved('2026-08-07T20:00:00.000Z', tokenA, storage);
  assert.equal(latest, false);
  assert.equal(getSyncState(storage).dirty, true);
  assert.equal(readLocalSnapshot(storage)?.clients[0]?.nextFollowUp, '2026-08-08');
});

test('sólo la generación local exacta verificada puede quedar limpia', () => {
  const storage = signedStorage();
  const crm = structuredClone(initialData);
  crm.clients[0]!.nextFollowUp = '2026-08-08';
  writeLocalSnapshot(crm, { reason: 'Seguimiento' }, storage);
  const token = syncSaveToken(crm, storage);

  assert.equal(markCloudSaved('2026-08-07T20:00:01.000Z', token, storage), true);
  const sync = getSyncState(storage);
  assert.equal(sync.dirty, false);
  assert.equal(sync.verifiedGeneration, token.generation);
  assert.equal(sync.lastCloudFingerprint, token.fingerprint);
});

test('hidratación remota vieja no limpia dirty ni autoriza reemplazo silencioso', () => {
  const storage = signedStorage();
  const local = structuredClone(initialData);
  local.clients[0]!.nextFollowUp = '2026-08-08';
  writeLocalSnapshot(local, { reason: 'Seguimiento pendiente' }, storage);

  const remoteOld = structuredClone(initialData);
  const accepted = markCloudHydrated(
    '2026-08-07T19:52:00.000Z',
    stableFingerprint(remoteOld),
    storage,
  );

  assert.equal(accepted, false);
  assert.equal(getSyncState(storage).dirty, true);
  assert.equal(readLocalSnapshot(storage)?.clients[0]?.nextFollowUp, '2026-08-08');
});


test('restaurar backup crea una generación nueva identificable y pendiente', async () => {
  const storage = signedStorage();
  const first = structuredClone(initialData);
  writeLocalSnapshot(first, { reason: 'Primera versión' }, storage);
  const second = structuredClone(first);
  second.clients[0]!.nextFollowUp = '2026-08-08';
  writeLocalSnapshot(second, { reason: 'Segunda versión' }, storage);
  const generationBeforeRestore = getSyncState(storage).localGeneration ?? 0;

  const { restoreLatestBackup } = await import('../sync-safety.js');
  const restored = restoreLatestBackup(storage);
  assert.ok(restored);
  const sync = getSyncState(storage);
  assert.equal(sync.dirty, true);
  assert.equal(sync.localGeneration, generationBeforeRestore + 1);
  assert.equal(sync.localFingerprint, stableFingerprint(restored));
});

test('todos los caminos de escritura CRM usan el coordinador compatible y el login legacy vacía dirty antes de hidratar', () => {
  const modern = readFileSync('src/cloud-api.ts', 'utf8');
  const compatible = readFileSync('src/cloud-api-compatible.ts', 'utf8');
  const store = readFileSync('src/store.ts', 'utf8');
  const auth = readFileSync('src/auth-ui.ts', 'utf8');

  assert.ok(store.includes("queueCloudSave } from './cloud-api-compatible.js'"));
  assert.ok(auth.includes("from './cloud-api-compatible.js'"));
  assert.ok(auth.includes('if (hasPendingLocalChanges()) await pushCloudData(state.crm);'));
  assert.ok(modern.includes('export function queueCloudSave'), 'se conserva sólo por compatibilidad histórica; ningún writer CRM lo importa');
  assert.ok(compatible.includes('new LatestSerialQueue<CloudSaveJob>'));
  assert.ok(compatible.includes('const verified = await pullModernCloudData(job.snapshot)'));
  assert.ok(compatible.includes('remoteComparableCrm(verified)'));
  assert.ok(compatible.includes('const authorityActive = job.visitAuthorityDecision ?? await visitTransactionAuthorityActive()'));
  assert.match(compatible, /if \(authorityActive\)[\s\S]*pushCloudDataWithVisitAuthority\(job\.snapshot\)[\s\S]*authoritativeRemoteVersion = await visitAuthorityRemoteVersion\(\)[\s\S]*else \{[\s\S]*pushModernCloudData\(job\.snapshot\)/);
  assert.ok(compatible.includes('const latest = markCloudSaved(authoritativeRemoteVersion, job.token)'));
  assert.match(compatible, /const latest = markCloudSaved\(authoritativeRemoteVersion, job\.token\);[\s\S]*if \(latest\) \{[\s\S]*propcontrol-cloud-authoritative-snapshot/);
});
