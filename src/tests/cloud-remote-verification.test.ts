import assert from 'node:assert/strict';
import test from 'node:test';
import type { TenantScope } from '../active-organization.js';
import { initialData } from '../models.js';
import { installTenantRuntimeScope } from '../tenant-runtime.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const TENANT_SCOPE: TenantScope = Object.freeze({ userId: 'franco-user', organizationId: 'org-trv' });

function installSession(): MemoryStorage {
  const storage = new MemoryStorage();
  storage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 60_000,
    userId: 'franco-user',
    email: 'franco@example.com',
  }));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: new EventTarget() });
  installTenantRuntimeScope(TENANT_SCOPE, TENANT_SCOPE.userId);
  return storage;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

const membership = {
  organization_id: 'org-trv', member_id: 1, user_id: 'franco-user', role: 'owner', status: 'active',
  display_name: 'Franco Solis', email: 'franco@example.com', created_at: '2026-01-01T00:00:00.000Z',
};

function tenantCrm() {
  const crm = structuredClone(initialData);
  crm.organization.id = TENANT_SCOPE.organizationId;
  crm.clients[0]!.nextFollowUp = '2026-08-08';
  return crm;
}

test('modern: no declara éxito si la relectura remota no coincide con el snapshot esperado', async () => {
  const storage = installSession();
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url, 'https://app.test');
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (url.pathname === '/api/cloud-config') return json({ configured: true, url: 'https://supabase.test', publishableKey: 'key' });
      if (url.pathname.endsWith('/organization_members')) return json([membership]);
      if (url.pathname.endsWith('/propcontrol_records') && method === 'GET') return json([]);
      if (url.pathname.endsWith('/propcontrol_records') && ['POST', 'DELETE'].includes(method)) return json([]);
      if (url.pathname.endsWith('/fichas') && method === 'GET') return json([]);
      throw new Error(`unexpected ${method} ${url}`);
    },
  });

  const { writeLocalSnapshot, getSyncState } = await import('../sync-safety.js');
  const { pushCloudData } = await import('../cloud-api-compatible.js');
  const crm = tenantCrm();
  writeLocalSnapshot(crm, { reason: 'Seguimiento' }, storage);

  await assert.rejects(
    () => pushCloudData(TENANT_SCOPE, crm, false),
    /verificación remota moderna no coincide/i,
  );
  assert.equal(getSyncState(storage).dirty, true);
});

test('legacy: tampoco declara éxito si el snapshot releído no coincide', async () => {
  const storage = installSession();
  let legacyReads = 0;
  const mismatchedRemoteCrm = tenantCrm();
  mismatchedRemoteCrm.clients[0]!.nextFollowUp = '2030-01-01';

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url, 'https://app.test');
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (url.pathname === '/api/cloud-config') return json({ configured: true, url: 'https://supabase.test', publishableKey: 'key' });
      if (url.pathname.endsWith('/organization_members')) return json([membership]);
      if (url.pathname.endsWith('/propcontrol_records') && method === 'GET') {
        return json({ code: 'PGRST205', message: "Could not find the table 'public.propcontrol_records' in the schema cache" }, 400);
      }
      if (url.pathname.endsWith('/fichas') && method === 'GET') {
        legacyReads += 1;
        if (legacyReads === 1) return json([]);
        return json([{
          id: 'legacy-row',
          organization_id: TENANT_SCOPE.organizationId,
          internal_data: { crm: mismatchedRemoteCrm },
          updated_at: '2026-09-09T12:00:00.000Z',
        }]);
      }
      if (url.pathname.endsWith('/fichas') && method === 'POST') return json([]);
      throw new Error(`unexpected ${method} ${url}`);
    },
  });

  const { writeLocalSnapshot, getSyncState } = await import('../sync-safety.js');
  const { pushCloudData } = await import('../cloud-api-compatible.js');
  const crm = tenantCrm();
  writeLocalSnapshot(crm, { reason: 'Seguimiento legacy' }, storage);

  await assert.rejects(
    () => pushCloudData(TENANT_SCOPE, crm, false),
    /verificación remota legacy no coincide/i,
  );
  assert.equal(getSyncState(storage).dirty, true);
});

test('capability: schema indeterminado falla cerrado y no entra al snapshot legacy', async () => {
  const storage = installSession();
  let legacyRequests = 0;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url, 'https://app.test');
      const select = url.searchParams.get('select') || '';
      if (url.pathname === '/api/cloud-config') return json({ configured: true, url: 'https://supabase.test', publishableKey: 'key' });
      if (url.pathname.endsWith('/organization_members') && select.includes('member_id')) {
        return json({ code: 'PGRST204', message: 'Could not find member_id in organization_members schema cache' }, 400);
      }
      if (url.pathname.endsWith('/fichas')) {
        legacyRequests += 1;
        return json([]);
      }
      throw new Error(`unexpected ${String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()} ${url}`);
    },
  });

  const { writeLocalSnapshot, getSyncState } = await import('../sync-safety.js');
  const { pushCloudData } = await import('../cloud-api-compatible.js');
  const crm = tenantCrm();
  writeLocalSnapshot(crm, { reason: 'Seguimiento capability fail-closed' }, storage);

  await assert.rejects(
    () => pushCloudData(TENANT_SCOPE, crm, false),
    /Could not find member_id in organization_members schema cache/i,
  );
  assert.equal(getSyncState(storage).dirty, true);
  assert.equal(legacyRequests, 0);
});
