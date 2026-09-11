import assert from 'node:assert/strict';
import test from 'node:test';
import './sec-fix-a1-2-c2-test-setup.js';
import type { TenantScope } from '../active-organization.js';
import { signOutCloud } from '../cloud-api-compatible.js';
import { initialData, type CrmData } from '../models.js';
import { resolveSyncDifferences } from '../mvp-auth.js';
import { replaceDataForTenant, state } from '../store.js';
import {
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
} from '../tenant-runtime.js';
import { readTenantSyncState } from '../tenant-storage.js';

const SESSION_KEY = 'propcontrol-cloud-session-v1';
const CLOUD_URL = 'https://tenant-f-recovery.test';
const USER = 'recovery-user';
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

function scope(organizationId: string): TenantScope {
  return Object.freeze({ userId: USER, organizationId });
}

function crmFor(organizationId: string, name: string): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.organization.name = name;
  crm.teamMembers[0]!.userId = USER;
  crm.teamMembers[0]!.role = 'Dueño';
  crm.teamMembers[0]!.status = 'Activo';
  return crm;
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
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: target });
  return target;
}

function reset(): EventTarget {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: new MemoryStorage(),
  });
  invalidateTenantRuntimeScope();
  state.crm = structuredClone(initialData);
  return installDocument();
}

function prepare(tenantScope: TenantScope, crm: CrmData): void {
  installTenantRuntimeScope(tenantScope, tenantScope.userId);
  assert.equal(replaceDataForTenant(tenantScope, crm, false), true);
  state.activeMemberId = crm.teamMembers[0]!.id;
}

function setSession(): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    accessToken: 'access-recovery-user',
    refreshToken: 'refresh-recovery-user',
    expiresAt: Date.now() + 60 * 60 * 1000,
    userId: USER,
    email: 'recovery@example.test',
  }));
}

function membershipRow(organizationId: string) {
  return {
    organization_id: organizationId,
    member_id: organizationId === ORG_A ? 11 : 22,
    user_id: USER,
    role: 'owner',
    status: 'active',
    display_name: 'Recovery Owner',
    email: 'recovery@example.test',
    created_at: '2026-09-08T00:00:00.000Z',
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function fetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function installFetchHarness(options: { wrongOrg?: boolean } = {}): {
  recordsStarted: Promise<void>;
  releaseRecords: () => void;
} {
  const started = deferred();
  const release = deferred();
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL): Promise<Response> => {
      const url = fetchUrl(input);
      if (url === '/api/cloud-config') {
        return json({ configured: true, url: CLOUD_URL, publishableKey: 'public-key' });
      }
      if (url.startsWith(`${CLOUD_URL}/rest/v1/organization_members`)) {
        const query = new URL(url);
        const organizationId = String(query.searchParams.get('organization_id') || `eq.${ORG_A}`).replace(/^eq\./, '');
        return json([membershipRow(organizationId)]);
      }
      if (url.startsWith(`${CLOUD_URL}/rest/v1/propcontrol_records`)) {
        started.resolve();
        if (options.wrongOrg) {
          return json([{
            organization_id: ORG_B,
            entity_type: 'organization',
            entity_key: 'organization',
            assigned_member_id: null,
            payload: {},
            created_by: USER,
            updated_at: '2026-09-08T00:00:00.000Z',
          }]);
        }
        await release.promise;
        return json([]);
      }
      throw new Error(`F_RECOVERY_FETCH_UNEXPECTED:${url}`);
    }) as typeof fetch,
  });
  return { recordsStarted: started.promise, releaseRecords: release.resolve };
}

test('F async A→B: resolve pendiente no muta, no status y no renderiza B', async () => {
  const events = reset();
  const a = scope(ORG_A);
  const b = scope(ORG_B);
  setSession();
  prepare(a, crmFor(ORG_A, 'A'));
  const statuses: unknown[] = [];
  let renders = 0;
  events.addEventListener('propcontrol-cloud-status', (event) => statuses.push((event as CustomEvent).detail));
  events.addEventListener('trv-render', () => { renders += 1; });
  const harness = installFetchHarness();

  const pending = resolveSyncDifferences();
  await harness.recordsStarted;
  prepare(b, crmFor(ORG_B, 'B'));
  const bBefore = structuredClone(state.crm);
  const bSyncBefore = readTenantSyncState(b);
  const statusCount = statuses.length;
  const renderCount = renders;

  harness.releaseRecords();
  await pending;

  assert.deepEqual(state.crm, bBefore);
  assert.deepEqual(readTenantSyncState(b), bSyncBefore);
  assert.equal(statuses.length, statusCount);
  assert.equal(renders, renderCount);
});

test('F async A→B→A: resolve A1 no se rehabilita por igualdad de scope', async () => {
  const events = reset();
  const a = scope(ORG_A);
  const b = scope(ORG_B);
  setSession();
  prepare(a, crmFor(ORG_A, 'A1'));
  const statuses: unknown[] = [];
  let renders = 0;
  events.addEventListener('propcontrol-cloud-status', (event) => statuses.push((event as CustomEvent).detail));
  events.addEventListener('trv-render', () => { renders += 1; });
  const harness = installFetchHarness();

  const pending = resolveSyncDifferences();
  await harness.recordsStarted;
  prepare(b, crmFor(ORG_B, 'B'));
  prepare(a, crmFor(ORG_A, 'A2'));
  const statusCount = statuses.length;
  const renderCount = renders;

  harness.releaseRecords();
  await pending;

  assert.equal(state.crm.organization.id, ORG_A);
  assert.equal(state.crm.organization.name, 'A2');
  assert.equal(statuses.length, statusCount);
  assert.equal(renders, renderCount);
});

test('F async logout durante resolve: completion vieja queda sin efecto ni feedback tardío', async () => {
  const events = reset();
  const a = scope(ORG_A);
  setSession();
  prepare(a, crmFor(ORG_A, 'A'));
  const statuses: unknown[] = [];
  let renders = 0;
  events.addEventListener('propcontrol-cloud-status', (event) => statuses.push((event as CustomEvent).detail));
  events.addEventListener('trv-render', () => { renders += 1; });
  const harness = installFetchHarness();

  const pending = resolveSyncDifferences();
  await harness.recordsStarted;
  signOutCloud();
  const statusCount = statuses.length;
  const renderCount = renders;
  const crmBefore = structuredClone(state.crm);

  harness.releaseRecords();
  await pending;

  assert.deepEqual(state.crm, crmBefore);
  assert.equal(statuses.length, statusCount);
  assert.equal(renders, renderCount);
});

test('F async cloud wrong-org: resolve falla cerrado y conserva A', async () => {
  const events = reset();
  const a = scope(ORG_A);
  setSession();
  prepare(a, crmFor(ORG_A, 'A-safe'));
  const statuses: Array<{ kind?: string; scope?: TenantScope; message?: string }> = [];
  events.addEventListener('propcontrol-cloud-status', (event) => {
    statuses.push((event as CustomEvent<{ kind?: string; scope?: TenantScope; message?: string }>).detail);
  });
  installFetchHarness({ wrongOrg: true });

  await resolveSyncDifferences();

  assert.equal(state.crm.organization.id, ORG_A);
  assert.equal(state.crm.organization.name, 'A-safe');
  assert.match(readTenantSyncState(a).lastError || '', /TENANT_CLOUD_RESPONSE_MISMATCH/);
  assert.equal(statuses.at(-1)?.kind, 'error');
  assert.equal(statuses.at(-1)?.scope?.organizationId, ORG_A);
});
