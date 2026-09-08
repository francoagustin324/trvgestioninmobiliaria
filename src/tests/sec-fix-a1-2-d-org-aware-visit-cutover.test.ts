import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './sec-fix-a1-2-c2-test-setup.js';
import type { TenantScope } from '../active-organization.js';
import { pushCloudData, resolveTenantVisitAuthority } from '../cloud-api-compatible.js';
import { initialData, type CrmData } from '../models.js';
import { replaceDataForTenant, state } from '../store.js';
import {
  invokeClientSnapshotCasV2,
  invokeVisitTransactionV2,
  TENANT_V2_ORGANIZATION_MISMATCH,
  visitTransactionAuthorityActiveV2,
} from '../tenant-visit-v2.js';
import {
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
} from '../tenant-runtime.js';

const SESSION_KEY = 'propcontrol-cloud-session-v1';
const CLOUD_URL = 'https://tenant-d.test';
const USER = 'user-d';
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const VISIT_UID = '33333333-3333-4333-8333-333333333333';
const ACTIVITY_UID = '44444444-4444-4444-8444-444444444444';

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

function crmFor(organizationId: string, label = organizationId): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.organization.name = label;
  crm.teamMembers[0]!.userId = USER;
  return crm;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setSession(): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    accessToken: 'access-d',
    refreshToken: 'refresh-d',
    expiresAt: Date.now() + 60 * 60 * 1000,
    userId: USER,
    email: 'd@example.com',
  }));
}

function membershipRow(organizationId: string) {
  return {
    organization_id: organizationId,
    member_id: organizationId === ORG_A ? 11 : 22,
    user_id: USER,
    role: 'owner',
    status: 'active',
    display_name: 'User D',
    email: 'd@example.com',
    created_at: '2026-09-08T00:00:00.000Z',
  };
}

function prepareTenant(tenantScope: TenantScope, crm = crmFor(tenantScope.organizationId)): void {
  installTenantRuntimeScope(tenantScope, tenantScope.userId);
  assert.equal(replaceDataForTenant(tenantScope, crm, false), true);
}

function resetEnvironment(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: new MemoryStorage(),
  });
  invalidateTenantRuntimeScope();
  state.crm = structuredClone(initialData);
  setSession();
}

function fetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestBody(init?: RequestInit): Record<string, any> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, any>;
}

type HarnessOptions = {
  authority?: boolean;
  authorityError?: { status: number; body: unknown };
  casError?: { status: number; body: unknown };
  visitError?: { status: number; body: unknown };
  responseOrganizationId?: string;
  visitBarrier?: { started: Deferred; release: Deferred };
  existingRecords?: unknown[];
};

function validVisitResult(organizationId: string, body: Record<string, any>) {
  const operationType = body.p_operation_type as 'VISIT_CREATE' | 'VISIT_RESOLVE';
  const operationId = String(body.p_operation_id);
  const status = operationType === 'VISIT_RESOLVE' ? String(body.p_request?.status ?? 'Realizada') : 'Coordinada';
  return {
    success: true,
    replayed: false,
    operationId,
    operationType,
    organizationId,
    serverTimestamp: '2026-09-08T12:00:00.000Z',
    client: { ...structuredClone(initialData.clients[0]!), revision: 1 },
    visit: {
      id: 10,
      uid: VISIT_UID,
      revision: operationType === 'VISIT_RESOLVE' ? 2 : 0,
      operationId,
      clientId: 1,
      propertyId: 1,
      scheduledAt: '2026-09-09T10:30:00.000Z',
      status,
      assignedToId: 1,
      createdById: 1,
      createdAt: '2026-09-08T12:00:00.000Z',
      updatedAt: '2026-09-08T12:00:00.000Z',
    },
    activity: {
      id: 20,
      uid: ACTIVITY_UID,
      revision: 0,
      operationId,
      visitUid: VISIT_UID,
      transactionOwner: 'visit',
      actorId: 1,
      action: 'Visita',
      entityType: 'Cliente',
      entityId: 1,
      detail: 'Visita autoritativa',
      createdAt: '2026-09-08T12:00:00.000Z',
    },
  };
}

function installFetchHarness(options: HarnessOptions = {}) {
  const calls: Array<{ url: string; method: string; body?: Record<string, any> }> = [];
  let recordReads = 0;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = fetchUrl(input);
      const method = String(init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? requestBody(init) : undefined;
      calls.push({ url, method, body });

      if (url === '/api/cloud-config') {
        return json({ configured: true, url: CLOUD_URL, publishableKey: 'public-key' });
      }
      if (url.startsWith(`${CLOUD_URL}/rest/v1/organization_members`)) {
        const query = new URL(url);
        const filter = String(query.searchParams.get('organization_id') ?? '');
        const organizationId = filter.replace(/^eq\./, '');
        if (!organizationId) throw new Error('D_MEMBERSHIP_QUERY_NOT_SCOPED');
        return json([membershipRow(organizationId)]);
      }
      if (url.endsWith('/rest/v1/rpc/visit_transaction_authority_active_v2')) {
        if (options.authorityError) return json(options.authorityError.body, options.authorityError.status);
        return json(options.authority ?? true);
      }
      if (url.endsWith('/rest/v1/rpc/client_snapshot_cas_v2')) {
        if (options.casError) return json(options.casError.body, options.casError.status);
        return json({
          success: true,
          organizationId: options.responseOrganizationId ?? String(body?.p_organization_id),
          action: body?.p_request?.action,
          ...(body?.p_request?.action === 'update'
            ? { client: { ...body.p_request.payload, revision: Number(body.p_request.expectedRevision ?? 0) + 1 } }
            : {}),
          serverTimestamp: '2026-09-08T12:00:00.000Z',
        });
      }
      if (url.endsWith('/rest/v1/rpc/commercial_visit_mutation_v2')) {
        options.visitBarrier?.started.resolve();
        if (options.visitBarrier) await options.visitBarrier.release.promise;
        if (options.visitError) return json(options.visitError.body, options.visitError.status);
        return json(validVisitResult(
          options.responseOrganizationId ?? String(body?.p_organization_id),
          body ?? {},
        ));
      }
      if (url.startsWith(`${CLOUD_URL}/rest/v1/propcontrol_records`)) {
        if (method !== 'GET') throw new Error(`D_UNEXPECTED_RAW_WRITE:${method}:${url}`);
        recordReads += 1;
        return json(recordReads === 1 ? (options.existingRecords ?? []) : (options.existingRecords ?? []));
      }
      if (/\/rpc\/(visit_transaction_authority_active|client_snapshot_cas|commercial_visit_mutation)$/.test(url)) {
        throw new Error(`D_LEGACY_RPC_CALLED:${url}`);
      }
      throw new Error(`D_FETCH_UNEXPECTED:${method}:${url}`);
    }) as typeof fetch,
  });
  return { calls };
}

function rpcCalls(calls: Array<{ url: string; method: string; body?: Record<string, any> }>, name: string) {
  return calls.filter((call) => call.url.endsWith(`/rest/v1/rpc/${name}`));
}

function createIntent() {
  return {
    operationId: '55555555-5555-4555-8555-555555555555',
    operationType: 'VISIT_CREATE' as const,
    client: { legacyId: 1 } as const,
    expectedClientRevision: 0,
    property: { legacyId: 1 } as const,
    localDate: '2026-09-09',
    localTime: '10:30',
  };
}

function resolveIntent() {
  return {
    operationId: '66666666-6666-4666-8666-666666666666',
    operationType: 'VISIT_RESOLVE' as const,
    client: { legacyId: 1 } as const,
    expectedClientRevision: 1,
    visitUid: VISIT_UID,
    expectedVisitRevision: 1,
    status: 'Realizada' as const,
    interest: 'Alto' as const,
  };
}

test('D1 multi-org A+B con scope A consulta authority V2 exclusivamente para A', async () => {
  resetEnvironment();
  const a = scope(ORG_A);
  prepareTenant(a);
  const harness = installFetchHarness();
  assert.equal(await resolveTenantVisitAuthority(a), true);
  const membership = harness.calls.find((call) => call.url.includes('/organization_members'))!;
  assert.equal(new URL(membership.url).searchParams.get('organization_id'), `eq.${ORG_A}`);
  assert.deepEqual(rpcCalls(harness.calls, 'visit_transaction_authority_active_v2')[0]?.body, { p_organization_id: ORG_A });
});

test('D2 mismo usuario con scope B consulta authority V2 exclusivamente para B', async () => {
  resetEnvironment();
  const b = scope(ORG_B);
  prepareTenant(b);
  const harness = installFetchHarness();
  assert.equal(await resolveTenantVisitAuthority(b), true);
  const membership = harness.calls.find((call) => call.url.includes('/organization_members'))!;
  assert.equal(new URL(membership.url).searchParams.get('organization_id'), `eq.${ORG_B}`);
  assert.deepEqual(rpcCalls(harness.calls, 'visit_transaction_authority_active_v2')[0]?.body, { p_organization_id: ORG_B });
});

test('D3 multi-org legítimo no depende de active.length ni produce indeterminate por multiplicidad', async () => {
  resetEnvironment();
  const a = scope(ORG_A);
  prepareTenant(a);
  installFetchHarness({ authority: false });
  assert.equal(await resolveTenantVisitAuthority(a), false);
  const source = readFileSync('src/cloud-api-compatible.ts', 'utf8');
  assert.doesNotMatch(source, /active\.length\s*!==\s*1|active\[0\]/);
});

test('D4 authority V2 ausente falla cerrado y no llama authority legacy ni writers', async () => {
  resetEnvironment();
  const a = scope(ORG_A);
  prepareTenant(a);
  const harness = installFetchHarness({
    authorityError: { status: 404, body: { code: 'PGRST202', message: 'Could not find function visit_transaction_authority_active_v2 in schema cache' } },
  });
  await assert.rejects(pushCloudData(a, state.crm), /visit_transaction_authority_active_v2|schema cache/i);
  assert.equal(rpcCalls(harness.calls, 'visit_transaction_authority_active').length, 0);
  assert.equal(harness.calls.filter((call) => call.url.includes('/propcontrol_records')).length, 0);
});

test('D5 Client CAS V2 ausente falla cerrado antes de CAS legacy o raw fallback', async () => {
  resetEnvironment();
  const a = scope(ORG_A);
  const crm = crmFor(ORG_A);
  crm.clients[0]!.notes = 'Cambio D';
  prepareTenant(a, crm);
  const remoteClient = structuredClone(initialData.clients[0]!);
  const harness = installFetchHarness({
    casError: { status: 404, body: { code: 'PGRST202', message: 'Could not find function client_snapshot_cas_v2 in schema cache' } },
    existingRecords: [{
      organization_id: ORG_A,
      entity_type: 'client',
      entity_key: `${ORG_A}:1`,
      assigned_member_id: 1,
      payload: remoteClient,
      created_by: USER,
      updated_at: '2026-09-08T10:00:00.000Z',
    }],
  });
  await assert.rejects(pushCloudData(a, state.crm, true), /client_snapshot_cas_v2|schema cache/i);
  assert.equal(rpcCalls(harness.calls, 'client_snapshot_cas').length, 0);
  assert.equal(harness.calls.filter((call) => call.url.includes('/propcontrol_records') && call.method !== 'GET').length, 0);
});

test('D6 Visit mutation V2 ausente falla cerrado sin Visit legacy ni raw fallback', async () => {
  resetEnvironment();
  const a = scope(ORG_A);
  prepareTenant(a);
  const harness = installFetchHarness({
    visitError: { status: 404, body: { code: 'PGRST202', message: 'Could not find function commercial_visit_mutation_v2 in schema cache' } },
  });
  await assert.rejects(invokeVisitTransactionV2(a, createIntent()), /commercial_visit_mutation_v2|schema cache/i);
  assert.equal(rpcCalls(harness.calls, 'commercial_visit_mutation').length, 0);
  assert.equal(harness.calls.filter((call) => call.url.includes('/propcontrol_records')).length, 0);
});

test('D7 Client update CAS envía p_organization_id exacto', async () => {
  resetEnvironment();
  const a = scope(ORG_A);
  prepareTenant(a);
  const harness = installFetchHarness();
  await invokeClientSnapshotCasV2(a, {
    action: 'update',
    client: { legacyId: 1 },
    expectedRevision: 0,
    payload: structuredClone(initialData.clients[0]!),
  });
  assert.equal(rpcCalls(harness.calls, 'client_snapshot_cas_v2')[0]?.body?.p_organization_id, ORG_A);
});

test('D8 Client delete CAS envía p_organization_id exacto', async () => {
  resetEnvironment();
  const b = scope(ORG_B);
  prepareTenant(b);
  const harness = installFetchHarness();
  await invokeClientSnapshotCasV2(b, {
    action: 'delete',
    client: { legacyId: 1 },
    expectedRevision: 3,
  });
  assert.equal(rpcCalls(harness.calls, 'client_snapshot_cas_v2')[0]?.body?.p_organization_id, ORG_B);
});

test('D9 Visit create envía organización exacta', async () => {
  resetEnvironment();
  const a = scope(ORG_A);
  prepareTenant(a);
  const harness = installFetchHarness();
  const result = await invokeVisitTransactionV2(a, createIntent());
  assert.equal(result.organizationId, ORG_A);
  assert.equal(rpcCalls(harness.calls, 'commercial_visit_mutation_v2')[0]?.body?.p_organization_id, ORG_A);
});

test('D10 Visit resolve envía organización exacta', async () => {
  resetEnvironment();
  const b = scope(ORG_B);
  prepareTenant(b);
  const harness = installFetchHarness();
  const result = await invokeVisitTransactionV2(b, resolveIntent());
  assert.equal(result.organizationId, ORG_B);
  assert.equal(rpcCalls(harness.calls, 'commercial_visit_mutation_v2')[0]?.body?.p_organization_id, ORG_B);
});

test('D11 response organizationId B bajo scope A falla cerrado', async () => {
  resetEnvironment();
  const a = scope(ORG_A);
  prepareTenant(a);
  installFetchHarness({ responseOrganizationId: ORG_B });
  await assert.rejects(invokeVisitTransactionV2(a, createIntent()), new RegExp(TENANT_V2_ORGANIZATION_MISMATCH));
  await assert.rejects(invokeClientSnapshotCasV2(a, {
    action: 'delete', client: { legacyId: 1 }, expectedRevision: 0,
  }), new RegExp(TENANT_V2_ORGANIZATION_MISMATCH));
});

test('D12 NOT_FOUND y PERMISSION_DENIED propagan sin fallback legacy', async () => {
  resetEnvironment();
  const a = scope(ORG_A);
  prepareTenant(a);
  let harness = installFetchHarness({
    visitError: { status: 404, body: { code: 'P0002', message: 'NOT_FOUND' } },
  });
  await assert.rejects(invokeVisitTransactionV2(a, createIntent()), /NOT_FOUND/);
  assert.equal(rpcCalls(harness.calls, 'commercial_visit_mutation').length, 0);

  harness = installFetchHarness({
    casError: { status: 403, body: { code: '42501', message: 'PERMISSION_DENIED' } },
  });
  await assert.rejects(invokeClientSnapshotCasV2(a, {
    action: 'delete', client: { legacyId: 1 }, expectedRevision: 0,
  }), /PERMISSION_DENIED/);
  assert.equal(rpcCalls(harness.calls, 'client_snapshot_cas').length, 0);
});

test('D13 single-org normal conserva authority y Visit V2', async () => {
  resetEnvironment();
  const a = scope(ORG_A);
  prepareTenant(a);
  installFetchHarness({ authority: true });
  assert.equal(await visitTransactionAuthorityActiveV2(a), true);
  const result = await invokeVisitTransactionV2(a, createIntent());
  assert.equal(result.success, true);
  assert.equal(result.organizationId, ORG_A);
});

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

let cutoverModule: Promise<typeof import('../visit-workflow-cutover.js')> | null = null;
async function cutover() {
  if (!cutoverModule) {
    installDocument();
    cutoverModule = import('../visit-workflow-cutover.js');
  }
  return cutoverModule;
}

test('D14 A→B completion Visit tardía queda stale y no afecta B', async () => {
  resetEnvironment();
  const a = scope(ORG_A);
  prepareTenant(a, crmFor(ORG_A, 'A'));
  const started = deferred();
  const release = deferred();
  installFetchHarness({ authority: true, visitBarrier: { started, release } });
  const api = await cutover();
  const pending = api.coordinateVisitWithCutover({
    operationId: createIntent().operationId,
    client: structuredClone(state.crm.clients[0]!),
    property: structuredClone(state.crm.properties[0]!),
    localDate: '2026-09-09',
    localTime: '10:30',
  });
  await started.promise;
  const b = scope(ORG_B);
  prepareTenant(b, crmFor(ORG_B, 'B'));
  release.resolve();
  await assert.rejects(pending, /TENANT_RUNTIME_STALE/);
  assert.equal(state.crm.organization.id, ORG_B);
  assert.equal(state.crm.organization.name, 'B');
  assert.equal(state.crm.visits.length, 0);
});

test('D15 A→B→A mantiene stale la generación A1 y conserva A2', async () => {
  resetEnvironment();
  const a = scope(ORG_A);
  prepareTenant(a, crmFor(ORG_A, 'A1'));
  const started = deferred();
  const release = deferred();
  installFetchHarness({ authority: true, visitBarrier: { started, release } });
  const api = await cutover();
  const pending = api.coordinateVisitWithCutover({
    operationId: createIntent().operationId,
    client: structuredClone(state.crm.clients[0]!),
    property: structuredClone(state.crm.properties[0]!),
    localDate: '2026-09-09',
    localTime: '10:30',
  });
  await started.promise;
  prepareTenant(scope(ORG_B), crmFor(ORG_B, 'B'));
  prepareTenant(a, crmFor(ORG_A, 'A2'));
  release.resolve();
  await assert.rejects(pending, /TENANT_RUNTIME_STALE/);
  assert.equal(state.crm.organization.id, ORG_A);
  assert.equal(state.crm.organization.name, 'A2');
  assert.equal(state.crm.visits.length, 0);
});

test('D negativo: path canónico referencia sólo los tres RPC V2 y no invoca RPC legacy', () => {
  const source = [
    readFileSync('src/tenant-visit-v2.ts', 'utf8'),
    readFileSync('src/cloud-api-compatible.ts', 'utf8'),
    readFileSync('src/visit-workflow-cutover.ts', 'utf8'),
  ].join('\n');
  assert.match(source, /['"]visit_transaction_authority_active_v2['"]/);
  assert.match(source, /['"]client_snapshot_cas_v2['"]/);
  assert.match(source, /['"]commercial_visit_mutation_v2['"]/);
  assert.doesNotMatch(source, /['"]visit_transaction_authority_active['"]/);
  assert.doesNotMatch(source, /['"]client_snapshot_cas['"]/);
  assert.doesNotMatch(source, /['"]commercial_visit_mutation['"]/);
});
