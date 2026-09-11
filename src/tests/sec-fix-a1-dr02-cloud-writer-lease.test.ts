import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TenantScope } from '../active-organization.js';
import { initialData, type CrmData } from '../models.js';
import {
  pushTenantLegacyCloudData,
  pushTenantModernCloudData,
} from '../tenant-cloud-data.js';
import {
  readTenantSyncState,
  tenantSyncSaveToken,
  writeTenantSnapshot,
} from '../tenant-storage.js';
import {
  captureTenantRuntimeLease,
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
  TENANT_RUNTIME_STALE,
} from '../tenant-runtime.js';

const USER = 'user-dr02';
const ORG_A = '00000000-0000-0000-0000-00000000d201';
const ORG_B = '00000000-0000-0000-0000-00000000d202';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function scope(organizationId = ORG_A): TenantScope {
  return Object.freeze({ userId: USER, organizationId });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  storage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
    accessToken: 'access-dr02',
    refreshToken: 'refresh-dr02',
    expiresAt: Date.now() + 60_000,
    userId: USER,
    email: 'dr02@example.com',
  }));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  });
  return storage;
}

function crmFor(organizationId = ORG_A, clientCount?: number): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.organization.name = `Org ${organizationId.slice(-4)}`;
  if (clientCount !== undefined) {
    const template = structuredClone(crm.clients[0]!);
    crm.clients = Array.from({ length: clientCount }, (_, index) => ({
      ...structuredClone(template),
      id: 10_000 + index,
      uid: `dr02-client-${index}`,
      name: `Cliente DR02 ${index}`,
    }));
  }
  return crm;
}

function membership(organizationId = ORG_A) {
  return {
    organization_id: organizationId,
    member_id: 1,
    user_id: USER,
    role: 'owner',
    status: 'active',
    display_name: 'DR02 User',
    email: 'dr02@example.com',
    created_at: '2026-09-09T00:00:00.000Z',
  };
}

function prepare(crm: CrmData, storage: Storage) {
  const tenantScope = scope(crm.organization.id);
  installTenantRuntimeScope(tenantScope, USER);
  writeTenantSnapshot(tenantScope, crm, { markDirty: true, reason: 'DR-02 test' }, storage);
  return {
    tenantScope,
    runtimeLease: captureTenantRuntimeLease(tenantScope),
    token: tenantSyncSaveToken(tenantScope, crm, storage),
  };
}

type ModernHarness = Readonly<{
  postCount: () => number;
  getCount: () => number;
  remoteCount: () => number;
}>;

function installModernFetch(options: {
  onPost?: (count: number) => void;
} = {}): ModernHarness {
  let posts = 0;
  let gets = 0;
  let remote: Array<Record<string, unknown>> = [];

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
      if (url.pathname.endsWith('/organization_members')) {
        return json([membership()]);
      }
      if (url.pathname.endsWith('/propcontrol_records') && method === 'GET') {
        gets += 1;
        return json(remote);
      }
      if (url.pathname.endsWith('/propcontrol_records') && method === 'POST') {
        posts += 1;
        const chunk = JSON.parse(String(init?.body ?? '[]')) as Array<Record<string, unknown>>;
        for (const incoming of chunk) {
          const index = remote.findIndex((current) => (
            current.organization_id === incoming.organization_id
            && current.entity_type === incoming.entity_type
            && current.entity_key === incoming.entity_key
          ));
          if (index >= 0) remote[index] = incoming;
          else remote.push(incoming);
        }
        options.onPost?.(posts);
        return json([]);
      }
      if (url.pathname.endsWith('/propcontrol_records') && method === 'DELETE') {
        throw new Error('DR-02 harness no esperaba DELETE en este escenario');
      }
      throw new Error(`unexpected ${method} ${url}`);
    },
  });

  return Object.freeze({
    postCount: () => posts,
    getCount: () => gets,
    remoteCount: () => remote.length,
  });
}

type LegacyHarness = Readonly<{
  writeCount: () => number;
  getCount: () => number;
  hasRemoteSnapshot: () => boolean;
}>;

function installLegacyFetch(options: {
  onRead?: (count: number) => void;
  onWrite?: (count: number) => void;
} = {}): LegacyHarness {
  let writes = 0;
  let gets = 0;
  let stored: Record<string, unknown> | null = null;

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
      if (url.pathname.endsWith('/organization_members')) {
        return json([membership()]);
      }
      if (url.pathname.endsWith('/fichas') && method === 'GET') {
        gets += 1;
        options.onRead?.(gets);
        if (!stored) return json([]);
        return json([{
          id: 'legacy-dr02',
          organization_id: ORG_A,
          internal_data: { crm: stored.crm },
          updated_at: '2026-09-09T12:00:00.000Z',
        }]);
      }
      if (url.pathname.endsWith('/fichas') && (method === 'POST' || method === 'PATCH')) {
        writes += 1;
        const body = JSON.parse(String(init?.body ?? '{}')) as { internal_data?: { crm?: unknown } };
        stored = { crm: structuredClone(body.internal_data?.crm) };
        options.onWrite?.(writes);
        return json([]);
      }
      throw new Error(`unexpected ${method} ${url}`);
    },
  });

  return Object.freeze({
    writeCount: () => writes,
    getCount: () => gets,
    hasRemoteSnapshot: () => stored !== null,
  });
}

function switchToB(): void {
  installTenantRuntimeScope(scope(ORG_B), USER);
}

function switchBThenA(): void {
  installTenantRuntimeScope(scope(ORG_B), USER);
  installTenantRuntimeScope(scope(ORG_A), USER);
}

test('DR-02 modern normal same tenant conserva el writer funcional', async () => {
  const storage = installStorage();
  const crm = crmFor();
  const prepared = prepare(crm, storage);
  const harness = installModernFetch();

  await pushTenantModernCloudData(prepared.tenantScope, crm, prepared.token, prepared.runtimeLease);

  assert.equal(harness.postCount(), 1);
  assert.equal(harness.getCount(), 2);
  assert.ok(harness.remoteCount() > 0);
  assert.equal(readTenantSyncState(prepared.tenantScope, storage).dirty, false);
});

test('DR-02 legacy normal same tenant conserva el writer funcional', async () => {
  const storage = installStorage();
  const crm = crmFor();
  const prepared = prepare(crm, storage);
  const harness = installLegacyFetch();

  await pushTenantLegacyCloudData(prepared.tenantScope, crm, prepared.token, prepared.runtimeLease);

  assert.equal(harness.writeCount(), 1);
  assert.equal(harness.getCount(), 2);
  assert.equal(harness.hasRemoteSnapshot(), true);
  assert.equal(readTenantSyncState(prepared.tenantScope, storage).dirty, false);
});

test('DR-02 modern A→B después del primer POST bloquea el segundo write', async () => {
  const storage = installStorage();
  const crm = crmFor(ORG_A, 220);
  const prepared = prepare(crm, storage);
  const harness = installModernFetch({ onPost: (count) => { if (count === 1) switchToB(); } });

  await assert.rejects(
    () => pushTenantModernCloudData(prepared.tenantScope, crm, prepared.token, prepared.runtimeLease),
    new RegExp(TENANT_RUNTIME_STALE),
  );

  assert.equal(harness.postCount(), 1);
  assert.equal(harness.getCount(), 1);
  assert.equal(readTenantSyncState(prepared.tenantScope, storage).dirty, true);
});

test('DR-02 legacy A→B después del read inicial no alcanza la mutación posterior', async () => {
  const storage = installStorage();
  const crm = crmFor();
  const prepared = prepare(crm, storage);
  const harness = installLegacyFetch({ onRead: (count) => { if (count === 1) switchToB(); } });

  await assert.rejects(
    () => pushTenantLegacyCloudData(prepared.tenantScope, crm, prepared.token, prepared.runtimeLease),
    new RegExp(TENANT_RUNTIME_STALE),
  );

  assert.equal(harness.getCount(), 1);
  assert.equal(harness.writeCount(), 0);
  assert.equal(readTenantSyncState(prepared.tenantScope, storage).dirty, true);
});

test('DR-02 modern A→B→A mantiene A1 stale por generación y no emite segundo POST', async () => {
  const storage = installStorage();
  const crm = crmFor(ORG_A, 220);
  const prepared = prepare(crm, storage);
  const harness = installModernFetch({ onPost: (count) => { if (count === 1) switchBThenA(); } });

  await assert.rejects(
    () => pushTenantModernCloudData(prepared.tenantScope, crm, prepared.token, prepared.runtimeLease),
    new RegExp(TENANT_RUNTIME_STALE),
  );

  assert.equal(harness.postCount(), 1);
  assert.equal(harness.getCount(), 1);
  assert.equal(readTenantSyncState(prepared.tenantScope, storage).dirty, true);
});

test('DR-02 legacy A→B→A mantiene A1 stale y no alcanza el write', async () => {
  const storage = installStorage();
  const crm = crmFor();
  const prepared = prepare(crm, storage);
  const harness = installLegacyFetch({ onRead: (count) => { if (count === 1) switchBThenA(); } });

  await assert.rejects(
    () => pushTenantLegacyCloudData(prepared.tenantScope, crm, prepared.token, prepared.runtimeLease),
    new RegExp(TENANT_RUNTIME_STALE),
  );

  assert.equal(harness.writeCount(), 0);
  assert.equal(harness.getCount(), 1);
  assert.equal(readTenantSyncState(prepared.tenantScope, storage).dirty, true);
});

test('DR-02 logout durante modern impide writes nuevos y read-back', async () => {
  const storage = installStorage();
  const crm = crmFor(ORG_A, 220);
  const prepared = prepare(crm, storage);
  const harness = installModernFetch({ onPost: (count) => { if (count === 1) invalidateTenantRuntimeScope(); } });

  await assert.rejects(
    () => pushTenantModernCloudData(prepared.tenantScope, crm, prepared.token, prepared.runtimeLease),
    new RegExp(TENANT_RUNTIME_STALE),
  );

  assert.equal(harness.postCount(), 1);
  assert.equal(harness.getCount(), 1);
  assert.equal(readTenantSyncState(prepared.tenantScope, storage).dirty, true);
});

test('DR-02 logout durante legacy después del request impide verification y metadata', async () => {
  const storage = installStorage();
  const crm = crmFor();
  const prepared = prepare(crm, storage);
  const harness = installLegacyFetch({ onWrite: () => invalidateTenantRuntimeScope() });

  await assert.rejects(
    () => pushTenantLegacyCloudData(prepared.tenantScope, crm, prepared.token, prepared.runtimeLease),
    new RegExp(TENANT_RUNTIME_STALE),
  );

  assert.equal(harness.writeCount(), 1);
  assert.equal(harness.getCount(), 1);
  assert.equal(harness.hasRemoteSnapshot(), true);
  assert.equal(readTenantSyncState(prepared.tenantScope, storage).dirty, true);
});

test('DR-02 request modern ya emitido puede completar remoto pero no habilita fase siguiente', async () => {
  const storage = installStorage();
  const crm = crmFor(ORG_A, 220);
  const prepared = prepare(crm, storage);
  const harness = installModernFetch({ onPost: (count) => { if (count === 1) switchToB(); } });

  await assert.rejects(
    () => pushTenantModernCloudData(prepared.tenantScope, crm, prepared.token, prepared.runtimeLease),
    new RegExp(TENANT_RUNTIME_STALE),
  );

  assert.equal(harness.postCount(), 1, 'el primer request sí fue despachado');
  assert.ok(harness.remoteCount() > 0, 'el primer request pudo completar remotamente');
  assert.equal(harness.getCount(), 1, 'no hubo verification/read-back posterior');
  assert.equal(readTenantSyncState(prepared.tenantScope, storage).dirty, true);
});

test('DR-02 verification legacy stale no produce metadata ni completion exitosa', async () => {
  const storage = installStorage();
  const crm = crmFor();
  const prepared = prepare(crm, storage);
  const harness = installLegacyFetch({ onRead: (count) => { if (count === 2) switchToB(); } });

  await assert.rejects(
    () => pushTenantLegacyCloudData(prepared.tenantScope, crm, prepared.token, prepared.runtimeLease),
    new RegExp(TENANT_RUNTIME_STALE),
  );

  assert.equal(harness.writeCount(), 1);
  assert.equal(harness.getCount(), 2);
  assert.equal(readTenantSyncState(prepared.tenantScope, storage).dirty, true);
});

test('DR-02 writers reciben lease obligatorio y no lo regeneran internamente', () => {
  const source = readFileSync('src/tenant-cloud-data.ts', 'utf8');
  const modernStart = source.indexOf('export async function pushTenantModernCloudData');
  const legacyStart = source.indexOf('export async function pushTenantLegacyCloudData');
  const end = source.indexOf('export async function tenantCloudRemoteVersion');
  assert.ok(modernStart >= 0 && legacyStart > modernStart && end > legacyStart);
  const modern = source.slice(modernStart, legacyStart);
  const legacy = source.slice(legacyStart, end);

  assert.match(modern, /token: SyncSaveToken,\s*runtimeLease: TenantRuntimeLease/);
  assert.match(legacy, /token: SyncSaveToken,\s*runtimeLease: TenantRuntimeLease/);
  assert.doesNotMatch(modern, /captureTenantRuntimeLease\s*\(/);
  assert.doesNotMatch(legacy, /captureTenantRuntimeLease\s*\(/);
  assert.match(modern, /assertCloudWriterLease\(scope, runtimeLease\)/);
  assert.match(legacy, /assertCloudWriterLease\(scope, runtimeLease\)/);
});

test('DR-02 caller pasa job.runtimeLease original a ambos writers y guarda fallback', () => {
  const source = readFileSync('src/cloud-api-compatible.ts', 'utf8');
  const start = source.indexOf('async function runCloudPush');
  const end = source.indexOf('function tenantSaveQueue');
  assert.ok(start >= 0 && end > start);
  const run = source.slice(start, end);

  assert.match(run, /pushTenantModernCloudData\(job\.scope, job\.snapshot, job\.token, job\.runtimeLease\)/);
  assert.match(run, /pushTenantLegacyCloudData\(job\.scope, job\.snapshot, job\.token, job\.runtimeLease\)/);
  assert.match(run, /catch \(error\)[\s\S]*isLegacySchemaError\(error\)[\s\S]*assertTenantRuntimeLeaseCurrent\(job\.runtimeLease\)[\s\S]*pushTenantLegacyCloudData/);
  assert.doesNotMatch(run, /captureTenantRuntimeLease\s*\(/);
}
);
