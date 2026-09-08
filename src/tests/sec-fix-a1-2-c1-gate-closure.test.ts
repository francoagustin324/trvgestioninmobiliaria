import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveTenantVisitAuthority } from '../cloud-api-compatible.js';
import { initialData, STORAGE_KEY, type CrmData } from '../models.js';
import {
  authorizeTenantConfirmedCloudResolution,
  readTenantSnapshot,
  readTenantSyncState,
  restoreTenantSyncStateSnapshot,
  tenantHasPendingLocalChanges,
  tenantStorageNamespace,
  writeTenantSnapshot,
} from '../tenant-storage.js';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, String(value)); }
}

const userId = 'user-a';
const scopeA = Object.freeze({ userId, organizationId: 'org-a' });
const scopeB = Object.freeze({ userId, organizationId: 'org-b' });

function crmFor(organizationId: string): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  return crm;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function assertUnsafeRawPreserved(raw: string, storage: MemoryStorage): void {
  const key = tenantStorageNamespace(scopeB).crmKey;
  storage.setItem(key, raw);
  assert.throws(
    () => readTenantSnapshot(scopeB, storage),
    /TENANT_EXISTING_SNAPSHOT_UNSAFE/,
  );
  assert.equal(storage.getItem(key), raw);
}

test('A1.2-C1.1 snapshot: key ausente devuelve null legítimo', () => {
  const storage = new MemoryStorage();
  assert.equal(readTenantSnapshot(scopeB, storage), null);
});

test('A1.2-C1.1 snapshot: malformed JSON falla cerrado y preserva raw', () => {
  assertUnsafeRawPreserved('{not-json', new MemoryStorage());
});

test('A1.2-C1.1 snapshot: JSON primitive falla cerrado y preserva raw', () => {
  assertUnsafeRawPreserved('42', new MemoryStorage());
});

test('A1.2-C1.1 snapshot: CRM incompleto falla cerrado y preserva raw', () => {
  assertUnsafeRawPreserved(JSON.stringify({ organization: { id: 'org-b' }, clients: [] }), new MemoryStorage());
});

test('A1.2-C1.1 snapshot: organization.id ausente falla cerrado y preserva raw', () => {
  const incomplete = structuredClone(initialData) as unknown as Record<string, unknown>;
  incomplete.organization = { name: 'Sin ID' };
  assertUnsafeRawPreserved(JSON.stringify(incomplete), new MemoryStorage());
});

test('A1.2-C1.1 snapshot: CRM A bajo key B falla cerrado y preserva raw', () => {
  assertUnsafeRawPreserved(JSON.stringify(crmFor('org-a')), new MemoryStorage());
});

test('A1.2-C1.1 snapshot: CRM B válido conserva comportamiento normal', () => {
  const storage = new MemoryStorage();
  const crm = crmFor('org-b');
  const key = tenantStorageNamespace(scopeB).crmKey;
  const raw = JSON.stringify(crm);
  storage.setItem(key, raw);

  assert.deepEqual(readTenantSnapshot(scopeB, storage), crm);
  assert.equal(storage.getItem(key), raw);
});

test('A1.2-C1.1 manual sync: dirty A se lee desde tenant aunque user-only diga false', () => {
  const storage = new MemoryStorage();
  const crmA = crmFor('org-a');
  writeTenantSnapshot(scopeA, crmA, { markDirty: true, reason: 'C1 manual sync' }, storage);
  storage.setItem(`${STORAGE_KEY}:user:${userId}:sync`, JSON.stringify({ dirty: false, localGeneration: 0 }));

  assert.equal(tenantHasPendingLocalChanges(scopeA, storage), true);
  assert.equal(JSON.parse(storage.getItem(`${STORAGE_KEY}:user:${userId}:sync`) || '{}').dirty, false);

  const source = readFileSync('src/mvp-auth.ts', 'utf8');
  const start = source.indexOf('async function synchronizeNow');
  const end = source.indexOf('async function inspectCloudWithoutChangingLocalState');
  const body = source.slice(start, end);
  assert.match(body, /requireCurrentTenantScope\(\)/);
  assert.match(body, /tenantHasPendingLocalChanges\(scope\)/);
  assert.match(body, /pushCloudData\(scope, state\.crm\)/);
  assert.match(body, /pullCloudData\(scope, state\.crm\)/);
  assert.match(body, /markTenantSyncError\(scope, message\)/);
  assert.doesNotMatch(body, /hasPendingLocalChanges\(\)/);
  assert.doesNotMatch(body, /markSyncError\(/);
});

test('A1.2-C1.1 reconciliation: restore y authorize modifican sólo sync del tenant', () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const userOnlyKey = `${STORAGE_KEY}:user:${userId}:sync`;
  storage.setItem(userOnlyKey, JSON.stringify({ dirty: false, localGeneration: 91 }));

  restoreTenantSyncStateSnapshot(scopeA, {
    dirty: true,
    localGeneration: 4,
    localFingerprint: 'fp-a',
    verifiedGeneration: 1,
  });
  assert.equal(readTenantSyncState(scopeA).dirty, true);
  assert.equal(readTenantSyncState(scopeB).dirty, false);

  authorizeTenantConfirmedCloudResolution(scopeA, 'remote-a');
  assert.equal(readTenantSyncState(scopeA).lastCloudVersion, 'remote-a');
  assert.equal(readTenantSyncState(scopeA).dirty, true);
  assert.equal(JSON.parse(storage.getItem(userOnlyKey) || '{}').localGeneration, 91);

  const source = readFileSync('src/sync-reconciliation.ts', 'utf8');
  assert.match(source, /restoreTenantSyncStateSnapshot\(scope, snapshot\)/);
  assert.match(source, /authorizeTenantConfirmedCloudResolution\(scope, remoteVersion\)/);
  assert.doesNotMatch(source, /scopedStorageKey|getSyncState\(|localStorage\./);
});

test('A1.2-C1.1 Visit capability: 2 active falla indeterminado antes de cualquier writer', async () => {
  const storage = new MemoryStorage();
  storage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
    accessToken: 'token',
    refreshToken: 'refresh',
    expiresAt: Date.now() + 60_000,
    userId,
    email: 'user@example.com',
  }));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

  const requests: Array<{ method: string; pathname: string }> = [];
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url, 'https://app.test');
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      requests.push({ method, pathname: url.pathname });
      if (url.pathname === '/api/cloud-config') {
        return json({ configured: true, url: 'https://supabase.test', publishableKey: 'key' });
      }
      if (url.pathname === '/rest/v1/organization_members') {
        return json([
          { organization_id: 'org-a', member_id: 1, user_id: userId, role: 'owner', status: 'active' },
          { organization_id: 'org-b', member_id: 2, user_id: userId, role: 'owner', status: 'active' },
        ]);
      }
      throw new Error(`unexpected ${method} ${url.pathname}`);
    },
  });

  await assert.rejects(
    () => resolveTenantVisitAuthority(scopeA),
    /TENANT_VISIT_CAPABILITY_INDETERMINATE/,
  );
  assert.equal(requests.some((request) => request.method !== 'GET'), false);
  assert.equal(requests.some((request) => request.pathname.includes('visit_transaction_authority_active')), false);
});
