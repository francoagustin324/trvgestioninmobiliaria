import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './sec-fix-a1-2-c2-test-setup.js';
import type { TenantScope } from '../active-organization.js';
import {
  cloudSaveQueueKey,
  createCloudSaveJob,
  type CloudSaveJob,
} from '../cloud-api-compatible.js';
import { LatestSerialQueue } from '../cloud-save-serial.js';
import { initialData, type CrmData } from '../models.js';
import { replaceDataForTenant, state } from '../store.js';
import {
  markTenantCloudSaved,
  markTenantDirty,
  readTenantBackups,
  readTenantSnapshot,
  readTenantSyncState,
  tenantStorageNamespace,
  writeTenantSnapshot,
} from '../tenant-storage.js';
import {
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
  tenantRuntimeLeaseIsCurrent,
} from '../tenant-runtime.js';

const USER_A = 'user-a';
const USER_B = 'user-b';
const ORG_A = '00000000-0000-0000-0000-0000000000a1';
const ORG_B = '00000000-0000-0000-0000-0000000000b1';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

type Deferred = Readonly<{ promise: Promise<void>; resolve: () => void }>;

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return Object.freeze({ promise, resolve });
}

function useStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  });
  return storage;
}

function scope(userId: string, organizationId: string): TenantScope {
  return Object.freeze({ userId, organizationId });
}

function crmFor(organizationId: string, label: string, clientId = 77): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.organization.name = label;
  crm.clients[0]!.id = clientId;
  crm.clients[0]!.name = `Cliente ${label}`;
  crm.clients[0]!.nextAction = `Acción ${label}`;
  return crm;
}

function dirtyJob(
  tenantScope: TenantScope,
  crm: CrmData,
  storage: Storage,
): CloudSaveJob {
  writeTenantSnapshot(tenantScope, crm, { markDirty: true, reason: `Cambio ${crm.organization.name}` }, storage);
  return createCloudSaveJob(tenantScope, crm, false);
}

function keyedQueue(
  lanes: Map<string, LatestSerialQueue<CloudSaveJob>>,
  job: CloudSaveJob,
  worker: (value: CloudSaveJob) => Promise<void>,
): LatestSerialQueue<CloudSaveJob> {
  const key = cloudSaveQueueKey(job.scope);
  const existing = lanes.get(key);
  if (existing) return existing;
  const created = new LatestSerialQueue<CloudSaveJob>(worker);
  lanes.set(key, created);
  return created;
}

test('C2 CloudSaveJob captura scope, snapshot, token y lease sin rederivar tenant', () => {
  const storage = useStorage();
  const aScope = scope(USER_A, ORG_A);
  installTenantRuntimeScope(aScope, USER_A);
  const original = crmFor(ORG_A, 'A');
  const job = dirtyJob(aScope, original, storage);

  original.organization.name = 'MUTADO DESPUÉS';
  assert.equal(job.snapshot.organization.name, 'A');
  assert.deepEqual(job.scope, aScope);
  assert.equal(Object.isFrozen(job), true);
  assert.equal(Object.isFrozen(job.scope), true);
  assert.equal(Object.isFrozen(job.token), true);
  assert.equal(Object.isFrozen(job.runtimeLease), true);
  assert.equal(job.token.generation, 1);
  assert.equal(job.visitAuthorityDecision, false);
});

test('C2 A→B: completion A sólo limpia metadata A y nunca reemplaza state/UI B', async () => {
  const storage = useStorage();
  const aScope = scope(USER_A, ORG_A);
  const bScope = scope(USER_A, ORG_B);
  installTenantRuntimeScope(aScope, USER_A);
  const aJob = dirtyJob(aScope, crmFor(ORG_A, 'A'), storage);
  const started = deferred();
  const release = deferred();
  const queue = new LatestSerialQueue<CloudSaveJob>(async (job) => {
    started.resolve();
    await release.promise;
    markTenantCloudSaved(job.scope, 'remote-a', job.token, storage);
  });

  const completion = queue.enqueue(aJob);
  await started.promise;

  installTenantRuntimeScope(bScope, USER_A);
  const bCrm = crmFor(ORG_B, 'B');
  assert.equal(replaceDataForTenant(bScope, bCrm, false), true);
  markTenantDirty(bScope, bCrm, 'B pendiente', storage);
  const bSyncBefore = readTenantSyncState(bScope, storage);

  release.resolve();
  await completion;

  assert.equal(readTenantSyncState(aScope, storage).dirty, false);
  assert.deepEqual(readTenantSyncState(bScope, storage), bSyncBefore);
  assert.equal(readTenantSnapshot(bScope, storage)?.organization.id, ORG_B);
  assert.equal(state.crm.organization.id, ORG_B);
  assert.equal(tenantRuntimeLeaseIsCurrent(aJob.runtimeLease), false);
  assert.equal(replaceDataForTenant(aScope, aJob.snapshot, false), false);
  assert.equal(state.crm.organization.id, ORG_B);
});

test('C2 A/B paralelo: B usa lane independiente y termina sin esperar a A', async () => {
  const storage = useStorage();
  const aScope = scope(USER_A, ORG_A);
  const bScope = scope(USER_A, ORG_B);
  const lanes = new Map<string, LatestSerialQueue<CloudSaveJob>>();
  const aStarted = deferred();
  const bStarted = deferred();
  const releaseA = deferred();
  const releaseB = deferred();

  installTenantRuntimeScope(aScope, USER_A);
  const aJob = dirtyJob(aScope, crmFor(ORG_A, 'A'), storage);
  installTenantRuntimeScope(bScope, USER_A);
  const bJob = dirtyJob(bScope, crmFor(ORG_B, 'B'), storage);

  const worker = async (job: CloudSaveJob): Promise<void> => {
    if (job.scope.organizationId === ORG_A) {
      aStarted.resolve();
      await releaseA.promise;
      markTenantCloudSaved(job.scope, 'remote-a', job.token, storage);
      return;
    }
    bStarted.resolve();
    await releaseB.promise;
    markTenantCloudSaved(job.scope, 'remote-b', job.token, storage);
  };

  const aCompletion = keyedQueue(lanes, aJob, worker).enqueue(aJob);
  await aStarted.promise;
  const bCompletion = keyedQueue(lanes, bJob, worker).enqueue(bJob);
  await bStarted.promise;

  assert.notEqual(cloudSaveQueueKey(aScope), cloudSaveQueueKey(bScope));
  assert.equal(readTenantSyncState(aScope, storage).dirty, true);
  assert.equal(readTenantSyncState(bScope, storage).dirty, true);

  releaseB.resolve();
  await bCompletion;
  assert.equal(readTenantSyncState(bScope, storage).dirty, false);
  assert.equal(readTenantSyncState(aScope, storage).dirty, true);

  releaseA.resolve();
  await aCompletion;
  assert.equal(readTenantSyncState(aScope, storage).dirty, false);
});

test('C2 mismo tenant preserva serialización y coalescing latest A1/A2/A3', async () => {
  const storage = useStorage();
  const aScope = scope(USER_A, ORG_A);
  installTenantRuntimeScope(aScope, USER_A);
  const firstCrm = crmFor(ORG_A, 'A1');
  const first = dirtyJob(aScope, firstCrm, storage);
  const secondCrm = crmFor(ORG_A, 'A2');
  const second = dirtyJob(aScope, secondCrm, storage);
  const thirdCrm = crmFor(ORG_A, 'A3');
  const third = dirtyJob(aScope, thirdCrm, storage);

  const firstStarted = deferred();
  const latestStarted = deferred();
  const releaseFirst = deferred();
  const releaseLatest = deferred();
  const generations: number[] = [];
  const queue = new LatestSerialQueue<CloudSaveJob>(async (job) => {
    generations.push(job.token.generation);
    if (generations.length === 1) {
      firstStarted.resolve();
      await releaseFirst.promise;
    } else {
      latestStarted.resolve();
      await releaseLatest.promise;
    }
    markTenantCloudSaved(job.scope, `remote-${job.token.generation}`, job.token, storage);
  });

  const p1 = queue.enqueue(first);
  await firstStarted.promise;
  const p2 = queue.enqueue(second);
  const p3 = queue.enqueue(third);
  releaseFirst.resolve();
  await latestStarted.promise;

  assert.deepEqual(generations, [first.token.generation, third.token.generation]);
  assert.notEqual(second.token.generation, third.token.generation);
  assert.equal(readTenantSyncState(aScope, storage).dirty, true);

  releaseLatest.resolve();
  await Promise.all([p1, p2, p3]);
  assert.equal(readTenantSyncState(aScope, storage).dirty, false);
  assert.equal(readTenantSyncState(aScope, storage).verifiedGeneration, third.token.generation);
});

test('C2 IDs legacy iguales A/B no colisionan en token, dirty, backups ni namespace', () => {
  const storage = useStorage();
  const aScope = scope(USER_A, ORG_A);
  const bScope = scope(USER_A, ORG_B);
  installTenantRuntimeScope(aScope, USER_A);
  const aJob = dirtyJob(aScope, crmFor(ORG_A, 'A', 77), storage);
  installTenantRuntimeScope(bScope, USER_A);
  const bJob = dirtyJob(bScope, crmFor(ORG_B, 'B', 77), storage);

  assert.notEqual(tenantStorageNamespace(aScope).crmKey, tenantStorageNamespace(bScope).crmKey);
  assert.notEqual(cloudSaveQueueKey(aScope), cloudSaveQueueKey(bScope));
  assert.notEqual(aJob.token.fingerprint, bJob.token.fingerprint);
  assert.equal(readTenantSnapshot(aScope, storage)?.clients[0]?.id, 77);
  assert.equal(readTenantSnapshot(bScope, storage)?.clients[0]?.id, 77);

  markTenantCloudSaved(aScope, 'remote-a', aJob.token, storage);
  assert.equal(readTenantSyncState(aScope, storage).dirty, false);
  assert.equal(readTenantSyncState(bScope, storage).dirty, true);
  assert.equal(readTenantBackups(aScope, storage).length, 0);
  assert.equal(readTenantBackups(bScope, storage).length, 0);
});

test('C2 logout/user switch: completion user A no toca user B', async () => {
  const storage = useStorage();
  const aScope = scope(USER_A, ORG_A);
  const bScope = scope(USER_B, ORG_B);
  installTenantRuntimeScope(aScope, USER_A);
  const aJob = dirtyJob(aScope, crmFor(ORG_A, 'A'), storage);
  const started = deferred();
  const release = deferred();
  const queue = new LatestSerialQueue<CloudSaveJob>(async (job) => {
    started.resolve();
    await release.promise;
    markTenantCloudSaved(job.scope, 'remote-a', job.token, storage);
  });

  const completion = queue.enqueue(aJob);
  await started.promise;
  invalidateTenantRuntimeScope();
  installTenantRuntimeScope(bScope, USER_B);
  const bCrm = crmFor(ORG_B, 'USER-B');
  assert.equal(replaceDataForTenant(bScope, bCrm, false), true);
  markTenantDirty(bScope, bCrm, 'B pendiente', storage);
  const bBefore = readTenantSyncState(bScope, storage);

  release.resolve();
  await completion;

  assert.deepEqual(readTenantSyncState(bScope, storage), bBefore);
  assert.equal(state.crm.organization.id, ORG_B);
  assert.equal(tenantRuntimeLeaseIsCurrent(aJob.runtimeLease), false);
  assert.equal(replaceDataForTenant(aScope, aJob.snapshot, false), false);
});

test('C2 A→B→A: lease distingue A1 stale de A2 aunque vuelva la misma organización', async () => {
  const storage = useStorage();
  const aScope = scope(USER_A, ORG_A);
  const bScope = scope(USER_A, ORG_B);
  installTenantRuntimeScope(aScope, USER_A);
  const a1 = dirtyJob(aScope, crmFor(ORG_A, 'A1'), storage);

  installTenantRuntimeScope(bScope, USER_A);
  const b = dirtyJob(bScope, crmFor(ORG_B, 'B'), storage);

  installTenantRuntimeScope(aScope, USER_A);
  const a2 = dirtyJob(aScope, crmFor(ORG_A, 'A2'), storage);

  assert.equal(tenantRuntimeLeaseIsCurrent(a1.runtimeLease), false);
  assert.equal(tenantRuntimeLeaseIsCurrent(b.runtimeLease), false);
  assert.equal(tenantRuntimeLeaseIsCurrent(a2.runtimeLease), true);
  assert.notEqual(a1.token.generation, a2.token.generation);

  const releaseA1 = deferred();
  const releaseA2 = deferred();
  const releaseB = deferred();
  const a1Started = deferred();
  const a2Started = deferred();
  const bStarted = deferred();
  let aRuns = 0;

  const aQueue = new LatestSerialQueue<CloudSaveJob>(async (job) => {
    aRuns += 1;
    if (aRuns === 1) {
      a1Started.resolve();
      await releaseA1.promise;
    } else {
      a2Started.resolve();
      await releaseA2.promise;
    }
    markTenantCloudSaved(job.scope, `remote-a-${aRuns}`, job.token, storage);
  });
  const bQueue = new LatestSerialQueue<CloudSaveJob>(async (job) => {
    bStarted.resolve();
    await releaseB.promise;
    markTenantCloudSaved(job.scope, 'remote-b', job.token, storage);
  });

  const pA1 = aQueue.enqueue(a1);
  await a1Started.promise;
  const pB = bQueue.enqueue(b);
  await bStarted.promise;
  const pA2 = aQueue.enqueue(a2);

  releaseB.resolve();
  await pB;
  assert.equal(readTenantSyncState(bScope, storage).dirty, false);
  assert.equal(readTenantSyncState(aScope, storage).dirty, true);

  releaseA1.resolve();
  await a2Started.promise;
  assert.equal(readTenantSyncState(aScope, storage).dirty, true, 'A1 stale no limpia generación A2');

  releaseA2.resolve();
  await Promise.all([pA1, pA2]);
  assert.equal(readTenantSyncState(aScope, storage).dirty, false);
  assert.equal(readTenantSyncState(aScope, storage).verifiedGeneration, a2.token.generation);
  assert.equal(tenantRuntimeLeaseIsCurrent(a1.runtimeLease), false);
  assert.equal(tenantRuntimeLeaseIsCurrent(a2.runtimeLease), true);
});

test('C2 static: save completion, status y authoritative event cargan scope+lease y no rederivan tenant', () => {
  const compatible = readFileSync('src/cloud-api-compatible.ts', 'utf8');
  const bootstrap = readFileSync('src/cloud-compat-bootstrap.ts', 'utf8');

  assert.match(compatible, /type CloudSaveJob = Readonly<[\s\S]*scope: TenantScope[\s\S]*snapshot: CrmData[\s\S]*token:[\s\S]*runtimeLease:[\s\S]*visitAuthorityDecision/);
  assert.match(compatible, /createCloudSaveJob[\s\S]*tenantSyncSaveToken\(frozenScope, snapshot\)[\s\S]*captureTenantRuntimeLease\(frozenScope\)/);
  assert.match(compatible, /tenantSaveQueues = new Map<string, LatestSerialQueue<CloudSaveJob>>\(\)/);
  assert.match(compatible, /cloudSaveQueueKey\(scope[\s\S]*tenantRuntimeKey\(scope\)/);
  assert.match(compatible, /timerKey = cloudSaveQueueKey\(job\.scope\)/);
  assert.doesNotMatch(compatible, /timerKey\s*=\s*(?:scope|job\.scope)\.userId\b/);
  assert.match(compatible, /runCloudPush\(job: CloudSaveJob\)[\s\S]*session\.userId !== job\.scope\.userId/);
  assert.match(compatible, /resolveTenantVisitAuthority\(job\.scope, job\.runtimeLease\)/);
  assert.match(compatible, /pushTenantModernCloudData\(job\.scope, job\.snapshot, job\.token, job\.runtimeLease\)/);
  assert.match(compatible, /pushTenantLegacyCloudData\(job\.scope, job\.snapshot, job\.token, job\.runtimeLease\)/);

  const eventStart = compatible.indexOf('function emitAuthoritativeSnapshot');
  const eventEnd = compatible.indexOf('export async function resolveTenantVisitAuthority');
  assert.ok(eventStart >= 0 && eventEnd > eventStart);
  const authoritative = compatible.slice(eventStart, eventEnd);
  assert.match(authoritative, /scope: job\.scope/);
  assert.match(authoritative, /runtimeLease: job\.runtimeLease/);
  assert.match(authoritative, /function emitAuthoritativeSnapshot\(job: CloudSaveJob, crm: CrmData = job\.snapshot\)/);
  assert.match(authoritative, /crm: structuredClone\(crm\)/);
  assert.match(authoritative, /propcontrol-cloud-authoritative-snapshot/);

  assert.match(compatible, /TenantCloudStatusDetail[\s\S]*scope:[\s\S]*runtimeLease:[\s\S]*message:[\s\S]*kind:/);
  assert.doesNotMatch(compatible, /state\.crm|resolveActiveOrganization|readActiveOrganizationPreference|organization_members.*limit/);

  assert.match(bootstrap, /scopedAsyncEventIsCurrent/);
  assert.match(bootstrap, /tenantRuntimeLeaseIsCurrent\(detail\.runtimeLease\)/);
  assert.match(bootstrap, /recoveringTenantKeys = new Set<string>\(\)/);
  assert.match(bootstrap, /retryKey = tenantRuntimeKey\(activeScope\)/);
  assert.match(bootstrap, /retrySnapshot = structuredClone\(state\.crm\)/);
  assert.match(bootstrap, /pushCloudData\(retryScope, retrySnapshot\)/);
  assert.match(bootstrap, /propcontrol-cloud-authoritative-snapshot[\s\S]*tenantScopesEqual\(activeScope, detail\.scope\)[\s\S]*tenantRuntimeLeaseIsCurrent\(detail\.runtimeLease\)/);
});