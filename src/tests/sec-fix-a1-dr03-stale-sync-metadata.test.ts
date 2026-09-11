import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TenantScope } from '../active-organization.js';
import {
  queueCloudSave,
  signOutCloud,
} from '../cloud-api-compatible.js';
import { initialData, type CrmData } from '../models.js';
import {
  readTenantSyncState,
  writeTenantSnapshot,
} from '../tenant-storage.js';
import {
  installTenantRuntimeScope,
} from '../tenant-runtime.js';

const USER = 'user-dr03';
const ORG_CURRENT = '00000000-0000-0000-0000-00000000d301';
const ORG_A_TO_B_A = '00000000-0000-0000-0000-00000000d311';
const ORG_A_TO_B_B = '00000000-0000-0000-0000-00000000d312';
const ORG_ABA_A = '00000000-0000-0000-0000-00000000d321';
const ORG_ABA_B = '00000000-0000-0000-0000-00000000d322';
const ORG_LOGOUT = '00000000-0000-0000-0000-00000000d331';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

class ManualTimers {
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();

  readonly setTimeout = (handler: TimerHandler): number => {
    if (typeof handler !== 'function') throw new Error('DR-03 sólo admite timer callback funcional.');
    const id = this.nextId++;
    this.callbacks.set(id, handler as () => void);
    return id;
  };

  readonly clearTimeout = (id?: number): void => {
    if (typeof id === 'number') this.callbacks.delete(id);
  };

  runNext(): void {
    const next = this.callbacks.entries().next();
    if (next.done) throw new Error('DR-03 esperaba un timer pendiente.');
    const [id, callback] = next.value;
    this.callbacks.delete(id);
    callback();
  }
}

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return Object.freeze({ promise, resolve, reject });
}

function tenantScope(organizationId: string): TenantScope {
  return Object.freeze({ userId: USER, organizationId });
}

function crmFor(organizationId: string, label: string): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.organization.name = label;
  crm.clients[0]!.nextAction = `DR-03 ${label}`;
  return crm;
}

function installSession(storage: Storage): void {
  storage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
    accessToken: 'access-dr03',
    refreshToken: 'refresh-dr03',
    expiresAt: Date.now() + 60_000,
    userId: USER,
    email: 'dr03@example.com',
  }));
}

function installEnvironment(): { storage: MemoryStorage; timers: ManualTimers } {
  const storage = new MemoryStorage();
  const timers = new ManualTimers();
  installSession(storage);

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: new EventTarget(),
  });

  return { storage, timers };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function membership(scope: TenantScope) {
  return {
    organization_id: scope.organizationId,
    member_id: 1,
    user_id: USER,
    role: 'owner',
    status: 'active',
    display_name: 'DR03 User',
    email: 'dr03@example.com',
    created_at: '2026-09-09T00:00:00.000Z',
  };
}

function installRejectingCloudFetch(scope: TenantScope): Readonly<{
  requestStarted: Promise<void>;
  rejectRequest: (message: string) => void;
}> {
  const started = deferred<void>();
  const pending = deferred<Response>();

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const raw = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, 'https://app.test');
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

      if (url.pathname === '/api/cloud-config') {
        return json({ configured: true, url: 'https://supabase.test', publishableKey: 'key' });
      }
      if (url.pathname.endsWith('/organization_members') && method === 'GET') {
        return json([membership(scope)]);
      }
      if (url.pathname.endsWith('/propcontrol_records') && method === 'GET') {
        started.resolve();
        return pending.promise;
      }
      throw new Error(`unexpected ${method} ${url}`);
    },
  });

  return Object.freeze({
    requestStarted: started.promise,
    rejectRequest: (message: string) => pending.reject(new Error(message)),
  });
}

function makeDirty(scope: TenantScope, crm: CrmData, storage: Storage): void {
  writeTenantSnapshot(scope, crm, {
    markDirty: true,
    reason: `DR-03 ${crm.organization.name}`,
    backup: false,
  }, storage);
}

async function settlePromiseCallbacks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function withoutLastError(value: ReturnType<typeof readTenantSyncState>) {
  const { lastError: _lastError, ...rest } = value;
  return rest;
}

test('DR-03 current rejection conserva metadata y registra lastError normalmente', async () => {
  const { storage, timers } = installEnvironment();
  const scope = tenantScope(ORG_CURRENT);
  installTenantRuntimeScope(scope, USER);
  const crm = crmFor(scope.organizationId, 'CURRENT');
  makeDirty(scope, crm, storage);
  const before = readTenantSyncState(scope, storage);
  const cloud = installRejectingCloudFetch(scope);

  queueCloudSave(scope, crm, false);
  timers.runNext();
  await cloud.requestStarted;
  cloud.rejectRequest('DR03 current rejection');
  await settlePromiseCallbacks();

  const after = readTenantSyncState(scope, storage);
  assert.equal(after.lastError, 'Guardado localmente, sincronización pendiente. DR03 current rejection');
  assert.deepEqual(withoutLastError(after), withoutLastError(before));
  assert.equal(after.dirty, true);
});

test('DR-03 A→B stale rejection no modifica ninguna metadata de B', async () => {
  const { storage, timers } = installEnvironment();
  const aScope = tenantScope(ORG_A_TO_B_A);
  const bScope = tenantScope(ORG_A_TO_B_B);
  installTenantRuntimeScope(aScope, USER);
  const aCrm = crmFor(aScope.organizationId, 'A1');
  makeDirty(aScope, aCrm, storage);
  const aBefore = readTenantSyncState(aScope, storage);
  const cloud = installRejectingCloudFetch(aScope);

  queueCloudSave(aScope, aCrm, false);
  timers.runNext();
  await cloud.requestStarted;

  installTenantRuntimeScope(bScope, USER);
  const bCrm = crmFor(bScope.organizationId, 'B');
  makeDirty(bScope, bCrm, storage);
  const bBefore = readTenantSyncState(bScope, storage);

  cloud.rejectRequest('DR03 stale A→B');
  await settlePromiseCallbacks();

  assert.deepEqual(readTenantSyncState(bScope, storage), bBefore);
  assert.deepEqual(readTenantSyncState(aScope, storage), aBefore);
  assert.equal(readTenantSyncState(bScope, storage).lastError, undefined);
});

test('DR-03 A→B→A stale A1 rejection no modifica metadata live de A2', async () => {
  const { storage, timers } = installEnvironment();
  const aScope = tenantScope(ORG_ABA_A);
  const bScope = tenantScope(ORG_ABA_B);
  installTenantRuntimeScope(aScope, USER);
  const a1Crm = crmFor(aScope.organizationId, 'A1');
  makeDirty(aScope, a1Crm, storage);
  const cloud = installRejectingCloudFetch(aScope);

  queueCloudSave(aScope, a1Crm, false);
  timers.runNext();
  await cloud.requestStarted;

  installTenantRuntimeScope(bScope, USER);
  installTenantRuntimeScope(aScope, USER);
  const a2Crm = crmFor(aScope.organizationId, 'A2');
  makeDirty(aScope, a2Crm, storage);
  const a2Before = readTenantSyncState(aScope, storage);

  cloud.rejectRequest('DR03 stale A1 after A→B→A');
  await settlePromiseCallbacks();

  const a2After = readTenantSyncState(aScope, storage);
  assert.deepEqual(a2After, a2Before);
  assert.equal(a2After.lastError, undefined);
  assert.ok((a2After.localGeneration ?? 0) > 1);
});

test('DR-03 logout/login invalida rejection de sesión anterior y preserva metadata nueva', async () => {
  const { storage, timers } = installEnvironment();
  const scope = tenantScope(ORG_LOGOUT);
  installTenantRuntimeScope(scope, USER);
  const oldCrm = crmFor(scope.organizationId, 'OLD-SESSION');
  makeDirty(scope, oldCrm, storage);
  const cloud = installRejectingCloudFetch(scope);

  queueCloudSave(scope, oldCrm, false);
  timers.runNext();
  await cloud.requestStarted;

  signOutCloud();
  installSession(storage);
  installTenantRuntimeScope(scope, USER);
  const newCrm = crmFor(scope.organizationId, 'NEW-SESSION');
  makeDirty(scope, newCrm, storage);
  const newBefore = readTenantSyncState(scope, storage);

  cloud.rejectRequest('DR03 stale pre-logout rejection');
  await settlePromiseCallbacks();

  const newAfter = readTenantSyncState(scope, storage);
  assert.deepEqual(newAfter, newBefore);
  assert.equal(newAfter.lastError, undefined);
});

test('DR-03 static: queue catch usa el runtimeLease original antes del único sync-error write', () => {
  const source = readFileSync('src/cloud-api-compatible.ts', 'utf8');
  const queueStart = source.lastIndexOf('export function queueCloudSave(');
  assert.ok(queueStart >= 0);
  const queue = source.slice(queueStart);
  const catchStart = queue.indexOf('.catch((error) => {');
  assert.ok(catchStart >= 0);
  const callback = queue.slice(catchStart);
  const guard = callback.indexOf('if (!tenantRuntimeLeaseIsCurrent(job.runtimeLease)) return;');
  const write = callback.indexOf('markTenantSyncError(job.scope, message);');

  assert.ok(guard >= 0 && write > guard, 'el lease guard debe preceder la mutación de sync metadata');
  assert.equal((queue.match(/markTenantSyncError\s*\(/g) ?? []).length, 1);
  assert.equal((queue.match(/\.catch\s*\(/g) ?? []).length, 1);
  assert.doesNotMatch(queue, /captureTenantRuntimeLease\s*\(/);
  assert.doesNotMatch(callback.slice(0, write), /organizationId\s*===|userId\s*===/);
});

test('DR-03 static: markTenantSyncError sólo transporta a markSyncError y éste cambia lastError', () => {
  const tenantStorage = readFileSync('src/tenant-storage.ts', 'utf8');
  const tenantStart = tenantStorage.indexOf('export function markTenantSyncError');
  const tenantEnd = tenantStorage.indexOf('export function assertTenantRemoteIsSafe', tenantStart);
  assert.ok(tenantStart >= 0 && tenantEnd > tenantStart);
  const tenantError = tenantStorage.slice(tenantStart, tenantEnd);
  assert.match(tenantError, /markSyncError\(message, tenantView\(scope, storage\)\)/);

  const syncSafety = readFileSync('src/sync-safety.ts', 'utf8');
  const syncStart = syncSafety.indexOf('export function markSyncError');
  const syncEnd = syncSafety.indexOf('export function latestRemoteVersion', syncStart);
  assert.ok(syncStart >= 0 && syncEnd > syncStart);
  const syncError = syncSafety.slice(syncStart, syncEnd);
  assert.match(syncError, /\.\.\.getSyncState\(target\)/);
  assert.match(syncError, /lastError:\s*message\.trim\(\)\s*\|\|\s*'No se pudo sincronizar\.'/);
  assert.doesNotMatch(syncError, /\bdirty\s*:/);
  assert.doesNotMatch(syncError, /\blocalGeneration\s*:/);
  assert.doesNotMatch(syncError, /\bverifiedGeneration\s*:/);
});
