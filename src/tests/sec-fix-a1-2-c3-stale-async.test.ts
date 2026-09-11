import assert from 'node:assert/strict';
import test from 'node:test';
import './sec-fix-a1-2-c2-test-setup.js';
import type { TenantScope } from '../active-organization.js';
import { pullCloudData, signInCloud, signOutCloud } from '../cloud-api-compatible.js';
import { initialData, type CrmData } from '../models.js';
import { resolveSyncDifferences, synchronizeNow } from '../mvp-auth.js';
import { replaceDataForTenant, state } from '../store.js';
import { hydrateTenantAfterAuth } from '../tenant-hydration.js';
import {
  currentTenantScope,
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
} from '../tenant-runtime.js';
import { readTenantSyncState } from '../tenant-storage.js';

const SESSION_KEY = 'propcontrol-cloud-session-v1';
const CLOUD_URL = 'https://tenant-c3.test';
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

function scope(userId: string, organizationId: string): TenantScope {
  return Object.freeze({ userId, organizationId });
}

function crmFor(organizationId: string, label: string): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.organization.name = label;
  crm.teamMembers[0]!.userId = USER_A;
  crm.teamMembers[0]!.name = `Miembro ${label}`;
  return crm;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function membershipRow(organizationId: string, userId = USER_A) {
  return {
    organization_id: organizationId,
    member_id: organizationId === ORG_A ? 11 : 22,
    user_id: userId,
    role: 'agent',
    status: 'active',
    display_name: userId,
    email: `${userId}@example.com`,
    created_at: '2026-09-08T00:00:00.000Z',
  };
}

function installDocument(): EventTarget {
  if (typeof globalThis.CustomEvent === 'undefined') {
    Object.defineProperty(globalThis, 'CustomEvent', {
      configurable: true,
      writable: true,
      value: class<T = unknown> extends Event {
        readonly detail: T;
        constructor(type: string, init: CustomEventInit<T> = {}) {
          super(type);
          this.detail = init.detail as T;
        }
      },
    });
  }
  const target = new EventTarget();
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: target,
  });
  return target;
}

function setSession(userId: string): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    accessToken: `access-${userId}`,
    refreshToken: `refresh-${userId}`,
    expiresAt: Date.now() + 60 * 60 * 1000,
    userId,
    email: `${userId}@example.com`,
  }));
}

function prepareTenant(tenantScope: TenantScope, crm: CrmData): void {
  installTenantRuntimeScope(tenantScope, tenantScope.userId);
  assert.equal(replaceDataForTenant(tenantScope, crm, false), true);
}

function resetEnvironment(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: new MemoryStorage(),
  });
  installDocument();
  invalidateTenantRuntimeScope();
  state.crm = structuredClone(initialData);
}

function fetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function installFetchHarness(options: { blockRecords?: boolean; loginUserId?: string } = {}): {
  recordsStarted: Promise<void>;
  releaseRecords: () => void;
} {
  const started = deferred();
  const release = deferred();
  const blockRecords = options.blockRecords ?? true;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL): Promise<Response> => {
      const url = fetchUrl(input);
      if (url === '/api/cloud-config') {
        return json({ configured: true, url: CLOUD_URL, publishableKey: 'public-key' });
      }
      if (url.startsWith(`${CLOUD_URL}/auth/v1/token?grant_type=password`)) {
        const userId = options.loginUserId ?? USER_B;
        return json({
          access_token: `access-${userId}`,
          refresh_token: `refresh-${userId}`,
          expires_in: 3600,
          user: { id: userId, email: `${userId}@example.com` },
        });
      }
      if (url.startsWith(`${CLOUD_URL}/rest/v1/organization_members`)) {
        const query = new URL(url);
        const organizationFilter = query.searchParams.get('organization_id');
        if (organizationFilter) {
          return json([membershipRow(organizationFilter.replace(/^eq\./, ''))]);
        }
        return json([membershipRow(ORG_A)]);
      }
      if (url.startsWith(`${CLOUD_URL}/rest/v1/propcontrol_records`)) {
        started.resolve();
        if (blockRecords) await release.promise;
        return json([]);
      }
      throw new Error(`C3_FETCH_UNEXPECTED:${url}`);
    }) as typeof fetch,
  });

  return { recordsStarted: started.promise, releaseRecords: release.resolve };
}

function switchToB(): CrmData {
  const bScope = scope(USER_A, ORG_B);
  const bCrm = crmFor(ORG_B, 'B');
  prepareTenant(bScope, bCrm);
  return bCrm;
}

test('C3 pull A pendiente → switch B: completion A no pisa state ni sync B', async () => {
  resetEnvironment();
  const aScope = scope(USER_A, ORG_A);
  setSession(USER_A);
  prepareTenant(aScope, crmFor(ORG_A, 'A'));
  const harness = installFetchHarness();

  const pending = pullCloudData(aScope, state.crm);
  await harness.recordsStarted;
  const bCrm = switchToB();
  const bSyncBefore = readTenantSyncState(scope(USER_A, ORG_B));

  harness.releaseRecords();
  await assert.rejects(pending, /TENANT_RUNTIME_STALE/);

  assert.equal(state.crm.organization.id, ORG_B);
  assert.equal(state.crm.organization.name, bCrm.organization.name);
  assert.deepEqual(readTenantSyncState(scope(USER_A, ORG_B)), bSyncBefore);
  assert.equal(readTenantSyncState(aScope).lastCloudVersion, undefined);
});

test('C3 A→B→A: completion A1 sigue stale por generación aunque vuelva scope A', async () => {
  resetEnvironment();
  const aScope = scope(USER_A, ORG_A);
  setSession(USER_A);
  prepareTenant(aScope, crmFor(ORG_A, 'A1'));
  const harness = installFetchHarness();

  const pending = pullCloudData(aScope, state.crm);
  await harness.recordsStarted;
  switchToB();
  prepareTenant(aScope, crmFor(ORG_A, 'A2'));

  harness.releaseRecords();
  await assert.rejects(pending, /TENANT_RUNTIME_STALE/);
  assert.equal(state.crm.organization.id, ORG_A);
  assert.equal(state.crm.organization.name, 'A2');
});

test('C3 hydrate A pendiente → B activo: late pull no reemplaza B', async () => {
  resetEnvironment();
  setSession(USER_A);
  const harness = installFetchHarness();

  const pending = hydrateTenantAfterAuth();
  await harness.recordsStarted;
  const bCrm = switchToB();

  harness.releaseRecords();
  await assert.rejects(pending, /TENANT_RUNTIME_STALE/);
  assert.equal(state.crm.organization.id, ORG_B);
  assert.equal(state.crm.organization.name, bCrm.organization.name);
});

test('C3 synchronizeNow A pendiente → B activo: no mutación B ni status tardío A', async () => {
  resetEnvironment();
  const aScope = scope(USER_A, ORG_A);
  setSession(USER_A);
  prepareTenant(aScope, crmFor(ORG_A, 'A'));
  const eventTarget = installDocument();
  const statuses: unknown[] = [];
  eventTarget.addEventListener('propcontrol-cloud-status', (event) => statuses.push((event as CustomEvent).detail));
  const harness = installFetchHarness();

  const pending = synchronizeNow();
  await harness.recordsStarted;
  const bCrm = switchToB();
  const statusCountBeforeRelease = statuses.length;

  harness.releaseRecords();
  await pending;

  assert.equal(state.crm.organization.id, ORG_B);
  assert.equal(state.crm.organization.name, bCrm.organization.name);
  assert.equal(statuses.length, statusCountBeforeRelease);
  assert.equal((statuses[0] as { kind?: string } | undefined)?.kind, 'working');
});

test('C3 resolveSyncDifferences A pendiente → B activo: reconciliation falla cerrado', async () => {
  resetEnvironment();
  const aScope = scope(USER_A, ORG_A);
  setSession(USER_A);
  prepareTenant(aScope, crmFor(ORG_A, 'A'));
  const eventTarget = installDocument();
  const statuses: unknown[] = [];
  eventTarget.addEventListener('propcontrol-cloud-status', (event) => statuses.push((event as CustomEvent).detail));
  const harness = installFetchHarness();

  const pending = resolveSyncDifferences();
  await harness.recordsStarted;
  const bCrm = switchToB();
  const bSyncBefore = readTenantSyncState(scope(USER_A, ORG_B));
  const statusCountBeforeRelease = statuses.length;

  harness.releaseRecords();
  await pending;

  assert.equal(state.crm.organization.id, ORG_B);
  assert.equal(state.crm.organization.name, bCrm.organization.name);
  assert.deepEqual(readTenantSyncState(scope(USER_A, ORG_B)), bSyncBefore);
  assert.equal(statuses.length, statusCountBeforeRelease);
});

test('C3 logout/login invalida operación pendiente de la sesión anterior', async () => {
  resetEnvironment();
  const aScope = scope(USER_A, ORG_A);
  setSession(USER_A);
  prepareTenant(aScope, crmFor(ORG_A, 'A'));
  installDocument();
  const harness = installFetchHarness({ loginUserId: USER_B });

  const pending = pullCloudData(aScope, state.crm);
  await harness.recordsStarted;
  signOutCloud();
  assert.equal(currentTenantScope(), null);
  const sessionB = await signInCloud('b@example.com', 'password-123');
  assert.equal(sessionB.userId, USER_B);
  const bScope = scope(USER_B, ORG_B);
  const bCrm = crmFor(ORG_B, 'B-login');
  bCrm.teamMembers[0]!.userId = USER_B;
  prepareTenant(bScope, bCrm);

  harness.releaseRecords();
  await assert.rejects(pending, /TENANT_RUNTIME_STALE/);
  assert.equal(state.crm.organization.id, ORG_B);
  assert.equal(currentTenantScope()?.userId, USER_B);
});

test('C3 operación current del mismo tenant conserva sync normal', async () => {
  resetEnvironment();
  const aScope = scope(USER_A, ORG_A);
  setSession(USER_A);
  prepareTenant(aScope, crmFor(ORG_A, 'A-current'));
  const eventTarget = installDocument();
  const statuses: Array<{ kind?: string }> = [];
  let renders = 0;
  eventTarget.addEventListener('propcontrol-cloud-status', (event) => {
    statuses.push((event as CustomEvent<{ kind?: string }>).detail);
  });
  eventTarget.addEventListener('trv-render', () => { renders += 1; });
  installFetchHarness({ blockRecords: false });

  await synchronizeNow();

  assert.equal(state.crm.organization.id, ORG_A);
  assert.equal(statuses.at(-1)?.kind, 'success');
  assert.equal(renders, 1);
});
