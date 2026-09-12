import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TenantScope } from '../active-organization.js';
import type { CloudMembershipRow, CloudRecordRow } from '../cloud-records.js';
import {
  appendUniqueRecommendationEvents,
  flushRecommendationEventBatch,
  flushRecommendationOutbox,
  readSupervisedRecommendationOutbox,
  scheduleRecommendationOutboxFlush,
  type RecommendationTelemetryAuthorization,
  type RecommendationTelemetryTenantContext,
  type SupervisedRecommendationEvent,
} from '../lead-recommendation-telemetry.js';
import { tenantStorageNamespace } from '../tenant-storage.js';
import {
  captureTenantRuntimeLease,
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
} from '../tenant-runtime.js';

const USER = 'user-a33-telemetry';
const OTHER_USER = 'user-a33-other';
const ORG_A = '00000000-0000-0000-0000-00000000a331';
const ORG_B = '00000000-0000-0000-0000-00000000a332';
const ACTOR_A = 31;
const ACTOR_B = 32;
const SESSION_KEY = 'propcontrol-cloud-session-v1';
const OUTBOX_SUFFIX = 'supervised-recommendation-outbox-v1';
const LIFECYCLE_SUFFIX = 'supervised-recommendation-lifecycle-v3';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

function tenantScope(userId = USER, organizationId = ORG_A): TenantScope {
  return Object.freeze({ userId, organizationId });
}

function storageKey(scope: TenantScope, suffix: string, actorId: number): string {
  return `${tenantStorageNamespace(scope).crmKey}:${suffix}:${actorId}`;
}

function installStorage(userId = USER): MemoryStorage {
  const storage = new MemoryStorage();
  storage.setItem(SESSION_KEY, JSON.stringify({
    accessToken: `access-${userId}`,
    refreshToken: `refresh-${userId}`,
    expiresAt: Date.now() + 60_000,
    userId,
    email: `${userId}@example.test`,
  }));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  });
  return storage;
}

function activate(scope: TenantScope, actorId: number, visible = [1]): RecommendationTelemetryTenantContext {
  installTenantRuntimeScope(scope, scope.userId);
  return {
    organizationId: scope.organizationId,
    actorId,
    visibleClientIds: new Set(visible),
    scope,
    runtimeLease: captureTenantRuntimeLease(scope),
  };
}

function recommendationEvent(
  organizationId: string,
  actorId: number,
  clientId = 1,
  eventId = `evt-${organizationId.slice(-4)}-${actorId}-${clientId}`,
): SupervisedRecommendationEvent {
  return {
    recordKind: 'supervised_recommendation_event',
    eventId,
    eventType: 'RECOMMENDATION_SHOWN',
    logicalRecommendationId: `logical-${eventId}`,
    organizationId,
    actorId,
    clientId,
    occurredAt: '2026-09-11T12:00:00.000Z',
    reason: 'targeted security test',
    stage: 'Calificado',
  };
}

function seedOutbox(storage: Storage, context: RecommendationTelemetryTenantContext, events: SupervisedRecommendationEvent[]): void {
  storage.setItem(storageKey(context.scope, OUTBOX_SUFFIX, context.actorId), JSON.stringify(events));
}

function rawOutbox(storage: Storage, scope: TenantScope, actorId: number): SupervisedRecommendationEvent[] {
  return JSON.parse(storage.getItem(storageKey(scope, OUTBOX_SUFFIX, actorId)) || '[]') as SupervisedRecommendationEvent[];
}

function member(
  organizationId: string,
  userId: string,
  memberId: number,
  role = 'owner',
  status = 'active',
): CloudMembershipRow {
  return {
    organization_id: organizationId,
    member_id: memberId,
    user_id: userId,
    role,
    status,
    display_name: `${userId}-${memberId}`,
    email: `${userId}@example.test`,
    created_at: '2026-09-01T00:00:00.000Z',
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface FetchHarness {
  membershipOrganizations: string[];
  posts: Array<{ organizationId: string; rows: CloudRecordRow[]; prefer: string; conflict: string }>;
  postCalls: number;
}

function installFetchHarness(options: {
  memberships: CloudMembershipRow[];
  postStatus?: number;
  onMembership?: () => void;
  onPost?: () => void | Promise<void>;
}): FetchHarness {
  const harness: FetchHarness = {
    membershipOrganizations: [],
    posts: [],
    postCalls: 0,
  };

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const raw = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, 'https://app.test');
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

      if (url.pathname === '/api/cloud-config') {
        return json({ configured: true, url: 'https://supabase.test', publishableKey: 'key-a33' });
      }
      if (url.pathname.endsWith('/organization_members') && method === 'GET') {
        const filter = url.searchParams.get('organization_id') || '';
        const organizationId = filter.startsWith('eq.') ? filter.slice(3) : filter;
        harness.membershipOrganizations.push(organizationId);
        options.onMembership?.();
        return json(options.memberships.filter((row) => row.organization_id === organizationId));
      }
      if (url.pathname.endsWith('/propcontrol_records') && method === 'POST') {
        harness.postCalls += 1;
        await options.onPost?.();
        const rows = JSON.parse(String(init?.body ?? '[]')) as CloudRecordRow[];
        harness.posts.push({
          organizationId: rows[0]?.organization_id || '',
          rows,
          prefer: new Headers(init?.headers).get('Prefer') || '',
          conflict: url.searchParams.get('on_conflict') || '',
        });
        return json([], options.postStatus ?? 201);
      }
      throw new Error(`unexpected ${method} ${url}`);
    },
  });

  return harness;
}

function resetRuntime(): void {
  invalidateTenantRuntimeScope();
}

function authorization(role: 'Dueño' | 'Administrador' | 'Corredor' = 'Dueño'): RecommendationTelemetryAuthorization {
  return {
    organizationId: ORG_A,
    currentMemberId: ACTOR_A,
    currentRole: role,
    activeMemberIds: new Set([ACTOR_A, ACTOR_B]),
    visibleClientIds: new Set([1, 2]),
  };
}

test('A3.3 telemetry scope B consulta y escribe sólo B aunque el user tenga A+B', async () => {
  resetRuntime();
  const storage = installStorage();
  const scopeB = tenantScope(USER, ORG_B);
  const context = activate(scopeB, ACTOR_B);
  seedOutbox(storage, context, [recommendationEvent(ORG_B, ACTOR_B)]);
  const harness = installFetchHarness({
    memberships: [
      member(ORG_A, USER, ACTOR_A),
      member(ORG_B, OTHER_USER, 99, 'agent'),
      member(ORG_B, USER, ACTOR_B),
    ],
  });

  assert.equal(await flushRecommendationOutbox(context), true);
  assert.deepEqual(harness.membershipOrganizations, [ORG_B]);
  assert.equal(harness.posts.length, 1);
  assert.ok(harness.posts[0]!.rows.every((row) => row.organization_id === ORG_B));
  assert.equal(harness.posts[0]!.conflict, 'organization_id,entity_type,entity_key');
  assert.equal(harness.posts[0]!.prefer, 'resolution=ignore-duplicates,return=minimal');
});

test('A3.3 membership order no altera actor autenticado exacto', async () => {
  resetRuntime();
  const storage = installStorage();
  const scopeA = tenantScope();
  const context = activate(scopeA, ACTOR_A);
  seedOutbox(storage, context, [recommendationEvent(ORG_A, ACTOR_A)]);
  const harness = installFetchHarness({
    memberships: [
      member(ORG_A, OTHER_USER, ACTOR_B, 'admin'),
      member(ORG_A, USER, ACTOR_A, 'owner'),
    ],
  });

  assert.equal(await flushRecommendationOutbox(context), true);
  assert.equal(harness.posts.length, 1);
  assert.equal(harness.posts[0]!.rows[0]!.assigned_member_id, ACTOR_A);
});

test('A3.3 transport actor distinto al actor capturado falla cerrado', async () => {
  resetRuntime();
  const storage = installStorage();
  const scopeA = tenantScope();
  const context = activate(scopeA, ACTOR_A);
  seedOutbox(storage, context, [recommendationEvent(ORG_A, ACTOR_A)]);
  const harness = installFetchHarness({ memberships: [member(ORG_A, USER, ACTOR_B)] });

  assert.equal(await flushRecommendationOutbox(context), false);
  assert.equal(harness.posts.length, 0);
  assert.equal(rawOutbox(storage, scopeA, ACTOR_A).length, 1);
});

test('A3.3 row cloud conserva organizationId exacto del TenantScope', async () => {
  resetRuntime();
  const storage = installStorage();
  const scopeA = tenantScope();
  const context = activate(scopeA, ACTOR_A);
  seedOutbox(storage, context, [recommendationEvent(ORG_A, ACTOR_A)]);
  const harness = installFetchHarness({ memberships: [member(ORG_A, USER, ACTOR_A)] });

  assert.equal(await flushRecommendationOutbox(context), true);
  assert.equal(harness.posts[0]!.rows[0]!.organization_id, scopeA.organizationId);
});

test('A3.3 evento wrong-org no se envía', async () => {
  resetRuntime();
  const storage = installStorage();
  const scopeA = tenantScope();
  const context = activate(scopeA, ACTOR_A);
  seedOutbox(storage, context, [recommendationEvent(ORG_B, ACTOR_A)]);
  const harness = installFetchHarness({ memberships: [member(ORG_A, USER, ACTOR_A)] });

  assert.equal(await flushRecommendationOutbox(context), true);
  assert.equal(harness.posts.length, 0);
});

test('A3.3 evento wrong-actor no se envía incluso para Dueño/Admin', async () => {
  const wrongActor = recommendationEvent(ORG_A, ACTOR_B);
  for (const role of ['Dueño', 'Administrador'] as const) {
    let posted = 0;
    const result = await flushRecommendationEventBatch(
      [wrongActor],
      authorization(role),
      USER,
      async () => { posted += 1; },
    );
    assert.equal(posted, 0);
    assert.equal(result.sentEventIds.length, 0);
    assert.equal(result.remaining.length, 1);
  }
});

test('A3.3 A→B antes del POST produce 0 POST y 0 ACK', async () => {
  resetRuntime();
  const storage = installStorage();
  const scopeA = tenantScope();
  const context = activate(scopeA, ACTOR_A);
  seedOutbox(storage, context, [recommendationEvent(ORG_A, ACTOR_A)]);
  const harness = installFetchHarness({
    memberships: [member(ORG_A, USER, ACTOR_A)],
    onMembership: () => { installTenantRuntimeScope(tenantScope(USER, ORG_B), USER); },
  });

  assert.equal(await flushRecommendationOutbox(context), false);
  assert.equal(harness.posts.length, 0);
  assert.equal(rawOutbox(storage, scopeA, ACTOR_A).length, 1);
});

test('A3.3 A→B con POST en vuelo no ACKea A ni toca outbox B', async () => {
  resetRuntime();
  const storage = installStorage();
  const scopeA = tenantScope();
  const scopeB = tenantScope(USER, ORG_B);
  const context = activate(scopeA, ACTOR_A);
  seedOutbox(storage, context, [recommendationEvent(ORG_A, ACTOR_A)]);
  storage.setItem(storageKey(scopeB, OUTBOX_SUFFIX, ACTOR_B), JSON.stringify([recommendationEvent(ORG_B, ACTOR_B)]));
  const harness = installFetchHarness({
    memberships: [member(ORG_A, USER, ACTOR_A)],
    onPost: () => { installTenantRuntimeScope(scopeB, USER); },
  });

  assert.equal(await flushRecommendationOutbox(context), false);
  assert.equal(harness.postCalls, 1);
  assert.equal(rawOutbox(storage, scopeA, ACTOR_A).length, 1);
  assert.equal(rawOutbox(storage, scopeB, ACTOR_B).length, 1);
});

test('A3.3 A→B→A mantiene stale la generación A1', async () => {
  resetRuntime();
  const storage = installStorage();
  const scopeA = tenantScope();
  const context = activate(scopeA, ACTOR_A);
  seedOutbox(storage, context, [recommendationEvent(ORG_A, ACTOR_A)]);
  const harness = installFetchHarness({
    memberships: [member(ORG_A, USER, ACTOR_A)],
    onMembership: () => {
      installTenantRuntimeScope(tenantScope(USER, ORG_B), USER);
      installTenantRuntimeScope(scopeA, USER);
    },
  });

  assert.equal(await flushRecommendationOutbox(context), false);
  assert.equal(harness.posts.length, 0);
  assert.equal(rawOutbox(storage, scopeA, ACTOR_A).length, 1);
});

test('A3.3 logout/user switch no ACKea completion previa', async () => {
  resetRuntime();
  const storage = installStorage();
  const scopeA = tenantScope();
  const context = activate(scopeA, ACTOR_A);
  seedOutbox(storage, context, [recommendationEvent(ORG_A, ACTOR_A)]);
  const harness = installFetchHarness({
    memberships: [member(ORG_A, USER, ACTOR_A)],
    onPost: () => {
      invalidateTenantRuntimeScope();
      storage.setItem(SESSION_KEY, JSON.stringify({
        accessToken: 'other-access', refreshToken: 'other-refresh', expiresAt: Date.now() + 60_000,
        userId: OTHER_USER, email: 'other@example.test',
      }));
    },
  });

  assert.equal(await flushRecommendationOutbox(context), false);
  assert.equal(harness.postCalls, 1);
  assert.equal(rawOutbox(storage, scopeA, ACTOR_A).length, 1);
});

test('A3.3 storage mismo usuario A/B usa namespaces distintos', () => {
  const a = storageKey(tenantScope(USER, ORG_A), LIFECYCLE_SUFFIX, ACTOR_A);
  const b = storageKey(tenantScope(USER, ORG_B), LIFECYCLE_SUFFIX, ACTOR_A);
  assert.notEqual(a, b);
  assert.match(a, new RegExp(`user:${USER}:org:${ORG_A}`));
  assert.match(b, new RegExp(`user:${USER}:org:${ORG_B}`));
});

test('A3.3 storage usuarios distintos misma org usa namespaces distintos', () => {
  const a = storageKey(tenantScope(USER, ORG_A), OUTBOX_SUFFIX, ACTOR_A);
  const b = storageKey(tenantScope(OTHER_USER, ORG_A), OUTBOX_SUFFIX, ACTOR_A);
  assert.notEqual(a, b);
  assert.match(a, new RegExp(`user:${USER}:org:${ORG_A}`));
  assert.match(b, new RegExp(`user:${OTHER_USER}:org:${ORG_A}`));
});

test('A3.3 duplicate eventId conserva idempotencia local', () => {
  const duplicate = recommendationEvent(ORG_A, ACTOR_A, 1, 'same-event');
  const merged = appendUniqueRecommendationEvents([duplicate], [structuredClone(duplicate)]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.eventId, 'same-event');
});

test('A3.3 single-flight/coalescing mantiene un único POST para el mismo lease', async () => {
  resetRuntime();
  const storage = installStorage();
  const scopeA = tenantScope();
  const context = activate(scopeA, ACTOR_A);
  seedOutbox(storage, context, [recommendationEvent(ORG_A, ACTOR_A)]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered = 0;
  const harness = installFetchHarness({
    memberships: [member(ORG_A, USER, ACTOR_A)],
    onPost: async () => { entered += 1; await gate; },
  });

  const first = scheduleRecommendationOutboxFlush(context);
  const second = scheduleRecommendationOutboxFlush(context);
  while (entered === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await Promise.all([first, second]);

  assert.equal(harness.postCalls, 1);
  assert.equal(rawOutbox(storage, scopeA, ACTOR_A).length, 0);
});

test('A3.3 error cloud conserva outbox', async () => {
  resetRuntime();
  const storage = installStorage();
  const scopeA = tenantScope();
  const context = activate(scopeA, ACTOR_A);
  seedOutbox(storage, context, [recommendationEvent(ORG_A, ACTOR_A)]);
  const harness = installFetchHarness({ memberships: [member(ORG_A, USER, ACTOR_A)], postStatus: 500 });

  assert.equal(await flushRecommendationOutbox(context), false);
  assert.equal(harness.postCalls, 1);
  assert.equal(rawOutbox(storage, scopeA, ACTOR_A).length, 1);
});

test('A3.3 success ACKea sólo IDs realmente enviados', async () => {
  resetRuntime();
  const storage = installStorage();
  const scopeA = tenantScope();
  const context = activate(scopeA, ACTOR_A, [1]);
  const sent = recommendationEvent(ORG_A, ACTOR_A, 1, 'sent-event');
  const hidden = recommendationEvent(ORG_A, ACTOR_A, 2, 'hidden-event');
  seedOutbox(storage, context, [sent, hidden]);
  const harness = installFetchHarness({ memberships: [member(ORG_A, USER, ACTOR_A)] });

  assert.equal(await flushRecommendationOutbox(context), true);
  assert.equal(harness.posts.length, 1);
  assert.deepEqual(harness.posts[0]!.rows.map((row) => (row.payload as SupervisedRecommendationEvent).eventId), ['sent-event']);
  assert.deepEqual(rawOutbox(storage, scopeA, ACTOR_A).map((item) => item.eventId), ['hidden-event']);
});

test('A3.3 telemetry source no reintroduce membership legacy, scoped session storage ni raw writer', () => {
  const source = readFileSync('src/lead-recommendation-telemetry.ts', 'utf8');
  for (const forbidden of [
    'getCloudMembershipContext',
    'fetchMembershipRows',
    'scopedStorageKey',
    '/rest/v1/propcontrol_records',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.doesNotMatch(source, /method\s*:\s*['"]POST['"]/);
  assert.match(source, /tenantStorageNamespace\(context\.scope\)/);
  assert.match(source, /tenantCloudTransport\(tenant\.scope\)/);
  assert.match(source, /transport\.context\.currentMemberId !== context\.actorId/);
  assert.match(source, /insertTenantCloudRecordsIgnoreDuplicates/);
});

test('A3.3 writer append-only revalida lease y conserva ignore-duplicates', () => {
  const source = readFileSync('src/tenant-cloud-data.ts', 'utf8');
  const start = source.indexOf('export async function insertTenantCloudRecordsIgnoreDuplicates');
  const end = source.indexOf('\nasync function deleteStaleRecords', start);
  const writer = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(writer, /assertRowsTenant\(transport\.scope, records\)/);
  assert.ok((writer.match(/assertCloudWriterLease\(transport\.scope, runtimeLease\)/g) || []).length >= 4);
  assert.match(writer, /on_conflict/);
  assert.match(writer, /resolution=ignore-duplicates,return=minimal/);
  assert.match(writer, /await parseTenantCloudJson\(response\)/);
});
