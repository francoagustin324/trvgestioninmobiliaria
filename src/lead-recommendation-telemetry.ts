import type { TenantScope } from './active-organization.js';
import { getCloudSession } from './cloud-api.js';
import { organizationScopedEntityKey, type CloudRecordRow } from './cloud-records.js';
import { tenantCloudTransport } from './tenant-cloud-context.js';
import { insertTenantCloudRecordsIgnoreDuplicates } from './tenant-cloud-data.js';
import type {
  RecommendationHumanDecision,
  RecommendationInstrumentationContext,
  SupervisedRecommendationRecord,
} from './lead-recommendation-instrumentation-core.js';
import {
  emptyRecommendationLifecycleState,
  type RecommendationLifecycleCycle,
  type RecommendationLifecycleMutation,
  type RecommendationLifecycleState,
} from './lead-recommendation-lifecycle.js';
import { STORAGE_KEY, type TeamRole } from './models.js';
import { tenantStorageNamespace } from './tenant-storage.js';
import {
  TENANT_RUNTIME_STALE,
  assertTenantRuntimeLeaseCurrent,
  tenantScopesEqual,
  type TenantRuntimeLease,
} from './tenant-runtime.js';

const LEGACY_TELEMETRY_STORAGE_SUFFIX = 'supervised-recommendations-v2';
const LIFECYCLE_STORAGE_SUFFIX = 'supervised-recommendation-lifecycle-v3';
const TELEMETRY_OUTBOX_SUFFIX = 'supervised-recommendation-outbox-v1';

export const RECOMMENDATION_TELEMETRY_TENANT_CONTEXT_REQUIRED = 'RECOMMENDATION_TELEMETRY_TENANT_CONTEXT_REQUIRED';
export const RECOMMENDATION_TELEMETRY_AUTHORITY_MISMATCH = 'RECOMMENDATION_TELEMETRY_AUTHORITY_MISMATCH';

export type RecommendationTelemetryEventType = 'RECOMMENDATION_SHOWN' | 'RECOMMENDATION_DECISION';

export interface SupervisedRecommendationEvent {
  recordKind: 'supervised_recommendation_event';
  eventId: string;
  eventType: RecommendationTelemetryEventType;
  /** Compatibilidad R2: sigue representando la identidad semántica. */
  logicalRecommendationId: string;
  recommendationCycleId?: string;
  organizationId: string;
  actorId: number;
  clientId: number;
  occurredAt: string;
  reason?: string;
  alertKind?: string;
  recommendedAction?: string;
  relevantDate?: string;
  stage?: string;
  humanDecision?: Exclude<RecommendationHumanDecision, 'pending'>;
  actualAction?: string;
  sourceActivityIdentity?: string;
  sourceActivityId?: number;
  sourceActivityCreatedAt?: string;
  sourceActivityAction?: string;
}

export interface RecommendationTelemetryAuthorization {
  organizationId: string;
  currentMemberId: number;
  currentRole: TeamRole;
  activeMemberIds: Set<number>;
  visibleClientIds: Set<number>;
}

export interface RecommendationTelemetryFlushResult {
  remaining: SupervisedRecommendationEvent[];
  sentEventIds: string[];
  attempted: number;
  failed: boolean;
}

export interface RecommendationLifecycleSnapshot {
  state: RecommendationLifecycleState;
  migratedFromR2: boolean;
}

export type RecommendationTelemetryTenantContext = RecommendationInstrumentationContext & Readonly<{
  scope: TenantScope;
  runtimeLease: TenantRuntimeLease;
}>;

type RecommendationTelemetryContext = RecommendationInstrumentationContext | RecommendationTelemetryTenantContext;

interface FlushFlight {
  running: Promise<void> | null;
  requestedAgain: boolean;
}

const flushFlights = new Map<string, FlushFlight>();

function normalized(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function identityPart(value: unknown): string {
  return encodeURIComponent(normalized(value));
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function hasTenantContext(context: RecommendationTelemetryContext): context is RecommendationTelemetryTenantContext {
  const candidate = context as Partial<RecommendationTelemetryTenantContext>;
  return Boolean(candidate.scope && candidate.runtimeLease);
}

function requireTenantContext(context: RecommendationTelemetryContext): RecommendationTelemetryTenantContext {
  if (!hasTenantContext(context)) throw new Error(RECOMMENDATION_TELEMETRY_TENANT_CONTEXT_REQUIRED);
  if (
    context.organizationId !== context.scope.organizationId
    || !tenantScopesEqual(context.scope, context.runtimeLease.scope)
  ) {
    throw new Error(TENANT_RUNTIME_STALE);
  }
  return context;
}

function requireCurrentTenantContext(context: RecommendationTelemetryContext): RecommendationTelemetryTenantContext {
  const tenant = requireTenantContext(context);
  assertTenantRuntimeLeaseCurrent(tenant.runtimeLease);
  return tenant;
}

function canonicalStorageKey(context: RecommendationTelemetryTenantContext, suffix: string): string {
  const namespace = tenantStorageNamespace(context.scope);
  return `${namespace.crmKey}:${suffix}:${context.actorId}`;
}

function historicalAccountStorageKey(context: RecommendationTelemetryTenantContext, suffix: string): string {
  return [
    `${STORAGE_KEY}:user:${context.scope.userId}`,
    suffix,
    encodeURIComponent(context.organizationId),
    String(context.actorId),
  ].join(':');
}

function historicalUnscopedStorageKey(context: RecommendationInstrumentationContext, suffix: string): string {
  return [STORAGE_KEY, suffix, encodeURIComponent(context.organizationId), String(context.actorId)].join(':');
}

function readStorageValue(context: RecommendationTelemetryContext, suffix: string): string | null {
  if (!hasTenantContext(context)) {
    return localStorage.getItem(historicalUnscopedStorageKey(context, suffix));
  }
  const tenant = requireCurrentTenantContext(context);
  const currentKey = canonicalStorageKey(tenant, suffix);
  const current = localStorage.getItem(currentKey);
  if (current !== null) return current;

  const historical = localStorage.getItem(historicalAccountStorageKey(tenant, suffix));
  if (historical === null) return null;
  requireCurrentTenantContext(tenant);
  localStorage.setItem(currentKey, historical);
  return historical;
}

function lifecycleStorageKey(context: RecommendationTelemetryTenantContext): string {
  return canonicalStorageKey(context, LIFECYCLE_STORAGE_SUFFIX);
}

function legacyStorageKey(context: RecommendationTelemetryTenantContext): string {
  return canonicalStorageKey(context, LEGACY_TELEMETRY_STORAGE_SUFFIX);
}

function outboxStorageKey(context: RecommendationTelemetryTenantContext): string {
  return canonicalStorageKey(context, TELEMETRY_OUTBOX_SUFFIX);
}

function humanDecision(value: unknown): RecommendationHumanDecision {
  return value === 'executed' || value === 'modified' ? value : 'pending';
}

function normalizedLegacyRecord(value: unknown): SupervisedRecommendationRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<SupervisedRecommendationRecord>;
  const id = String(item.id || '');
  const organizationId = String(item.organizationId || '');
  const actorId = Number(item.actorId || 0);
  const clientId = Number(item.clientId || 0);
  if (!id || !organizationId || actorId <= 0 || clientId <= 0) return null;
  return {
    id,
    organizationId,
    actorId,
    clientId,
    shownAt: String(item.shownAt || new Date(0).toISOString()),
    reason: String(item.reason || ''),
    alertKind: String(item.alertKind || ''),
    recommendedAction: String(item.recommendedAction || ''),
    relevantDate: item.relevantDate ? String(item.relevantDate) : undefined,
    context: item.context ? String(item.context) : undefined,
    stage: String(item.stage || ''),
    humanDecision: humanDecision(item.humanDecision),
    decisionAt: item.decisionAt ? String(item.decisionAt) : undefined,
    actualAction: item.actualAction ? String(item.actualAction) : undefined,
    decisionSourceActivityId: Number.isFinite(item.decisionSourceActivityId) ? Number(item.decisionSourceActivityId) : undefined,
    decisionSourceActivityCreatedAt: item.decisionSourceActivityCreatedAt ? String(item.decisionSourceActivityCreatedAt) : undefined,
    decisionSourceActivityAction: item.decisionSourceActivityAction ? String(item.decisionSourceActivityAction) : undefined,
    outcome: item.outcome === 'Ganado' || item.outcome === 'Perdido' ? item.outcome : undefined,
    outcomeAt: item.outcomeAt ? String(item.outcomeAt) : undefined,
  };
}

function normalizedCycle(value: unknown): RecommendationLifecycleCycle | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<RecommendationLifecycleCycle>;
  const clientId = Number(item.clientId || 0);
  const semanticRecommendationId = String(item.semanticRecommendationId || '');
  const cycleId = String(item.cycleId || '');
  const activationWitness = String(item.activationWitness || '');
  const phase = item.phase === 'unshown' || item.phase === 'pending' || item.phase === 'resolved' ? item.phase : null;
  if (clientId <= 0 || !semanticRecommendationId || !cycleId || !activationWitness || !phase) return null;
  const record = phase === 'pending' ? normalizedLegacyRecord(item.record) || undefined : undefined;
  if (phase === 'pending' && !record) return null;
  const marker = String(item.resolvedByActivityIdentity || '');
  const resolvedByActivityIdentity = phase === 'resolved' && /^activity-v1\|[0-9a-f]{32}$/.test(marker)
    ? marker
    : undefined;
  return { clientId, semanticRecommendationId, cycleId, activationWitness, phase, resolvedByActivityIdentity, record };
}

function normalizedLifecycle(value: unknown, context: RecommendationInstrumentationContext): RecommendationLifecycleState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<RecommendationLifecycleState>;
  if (item.version !== 3 || !Array.isArray(item.cycles)) return null;
  const cycles = item.cycles
    .map(normalizedCycle)
    .filter((cycle): cycle is RecommendationLifecycleCycle => Boolean(cycle && context.visibleClientIds.has(cycle.clientId)));
  return { version: 3, cycles };
}

function migrateLegacyState(context: RecommendationTelemetryContext): RecommendationLifecycleState | null {
  try {
    const raw = readStorageValue(context, LEGACY_TELEMETRY_STORAGE_SUFFIX);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return emptyRecommendationLifecycleState();
    const latest = new Map<number, SupervisedRecommendationRecord>();
    parsed
      .map(normalizedLegacyRecord)
      .filter((record): record is SupervisedRecommendationRecord => Boolean(
        record
        && record.organizationId === context.organizationId
        && record.actorId === context.actorId
        && context.visibleClientIds.has(record.clientId),
      ))
      .forEach((record) => {
        const current = latest.get(record.clientId);
        if (!current || current.shownAt < record.shownAt) latest.set(record.clientId, record);
      });
    return {
      version: 3,
      cycles: [...latest.values()].map((record) => ({
        clientId: record.clientId,
        semanticRecommendationId: record.id,
        cycleId: record.id,
        activationWitness: 'legacy-r2',
        phase: record.humanDecision === 'pending' ? 'pending' : 'resolved',
        record: record.humanDecision === 'pending' ? record : undefined,
      })),
    };
  } catch {
    return emptyRecommendationLifecycleState();
  }
}

export function readSupervisedRecommendationLifecycle(
  context: RecommendationTelemetryContext,
): RecommendationLifecycleSnapshot {
  try {
    const raw = readStorageValue(context, LIFECYCLE_STORAGE_SUFFIX);
    if (raw) {
      const state = normalizedLifecycle(JSON.parse(raw), context);
      if (state) return { state, migratedFromR2: false };
    }
  } catch {
    // Un estado local corrupto no puede bloquear el CRM ni tocar datos comerciales.
  }
  const migrated = migrateLegacyState(context);
  return migrated
    ? { state: migrated, migratedFromR2: true }
    : { state: emptyRecommendationLifecycleState(), migratedFromR2: false };
}

function writeLifecycleState(context: RecommendationTelemetryTenantContext, state: RecommendationLifecycleState): void {
  const tenant = requireCurrentTenantContext(context);
  const scoped: RecommendationLifecycleState = {
    version: 3,
    cycles: state.cycles.filter((cycle) => tenant.visibleClientIds.has(cycle.clientId)),
  };
  localStorage.setItem(lifecycleStorageKey(tenant), JSON.stringify(scoped));
}

function normalizedEvent(value: unknown): SupervisedRecommendationEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<SupervisedRecommendationEvent>;
  const eventType = item.eventType === 'RECOMMENDATION_SHOWN' || item.eventType === 'RECOMMENDATION_DECISION' ? item.eventType : null;
  const eventId = String(item.eventId || '');
  const logicalRecommendationId = String(item.logicalRecommendationId || '');
  const organizationId = String(item.organizationId || '');
  const actorId = Number(item.actorId || 0);
  const clientId = Number(item.clientId || 0);
  if (item.recordKind !== 'supervised_recommendation_event' || !eventType || !eventId || !logicalRecommendationId || !organizationId || actorId <= 0 || clientId <= 0) return null;
  return {
    recordKind: 'supervised_recommendation_event',
    eventId,
    eventType,
    logicalRecommendationId,
    recommendationCycleId: item.recommendationCycleId ? String(item.recommendationCycleId) : undefined,
    organizationId,
    actorId,
    clientId,
    occurredAt: String(item.occurredAt || ''),
    reason: item.reason ? String(item.reason) : undefined,
    alertKind: item.alertKind ? String(item.alertKind) : undefined,
    recommendedAction: item.recommendedAction ? String(item.recommendedAction) : undefined,
    relevantDate: item.relevantDate ? String(item.relevantDate) : undefined,
    stage: item.stage ? String(item.stage) : undefined,
    humanDecision: item.humanDecision === 'executed' || item.humanDecision === 'modified' ? item.humanDecision : undefined,
    actualAction: item.actualAction ? String(item.actualAction) : undefined,
    sourceActivityIdentity: item.sourceActivityIdentity ? String(item.sourceActivityIdentity) : undefined,
    sourceActivityId: Number.isFinite(item.sourceActivityId) ? Number(item.sourceActivityId) : undefined,
    sourceActivityCreatedAt: item.sourceActivityCreatedAt ? String(item.sourceActivityCreatedAt) : undefined,
    sourceActivityAction: item.sourceActivityAction ? String(item.sourceActivityAction) : undefined,
  };
}

export function readSupervisedRecommendationOutbox(context: RecommendationTelemetryContext): SupervisedRecommendationEvent[] {
  try {
    const parsed: unknown = JSON.parse(readStorageValue(context, TELEMETRY_OUTBOX_SUFFIX) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizedEvent).filter((event): event is SupervisedRecommendationEvent => Boolean(
      event && event.organizationId === context.organizationId && event.actorId === context.actorId,
    ));
  } catch {
    return [];
  }
}

function writeOutbox(context: RecommendationTelemetryTenantContext, events: SupervisedRecommendationEvent[]): void {
  const tenant = requireCurrentTenantContext(context);
  localStorage.setItem(
    outboxStorageKey(tenant),
    JSON.stringify(events.filter((event) => event.organizationId === tenant.organizationId && event.actorId === tenant.actorId)),
  );
}

export function appendUniqueRecommendationEvents(
  outbox: SupervisedRecommendationEvent[],
  incoming: SupervisedRecommendationEvent[],
): SupervisedRecommendationEvent[] {
  const byId = new Map(outbox.map((event) => [event.eventId, event]));
  incoming.forEach((event) => { if (!byId.has(event.eventId)) byId.set(event.eventId, event); });
  return [...byId.values()];
}

export function acknowledgeRecommendationEvents(
  currentOutbox: SupervisedRecommendationEvent[],
  sentEventIds: string[],
): SupervisedRecommendationEvent[] {
  const acknowledged = new Set(sentEventIds);
  return currentOutbox.filter((event) => !acknowledged.has(event.eventId));
}

function semanticIdForRecord(record: SupervisedRecommendationRecord, state: RecommendationLifecycleState): string {
  return state.cycles.find((cycle) => cycle.cycleId === record.id)?.semanticRecommendationId || record.id;
}

export function recommendationActivityIdentity(record: SupervisedRecommendationRecord): string | null {
  if (record.decisionSourceActivityId === undefined || !record.decisionSourceActivityCreatedAt || !record.decisionSourceActivityAction) return null;
  return [
    'v1',
    String(record.actorId),
    String(record.clientId),
    String(record.decisionSourceActivityId),
    identityPart(record.decisionSourceActivityCreatedAt),
    identityPart(record.decisionSourceActivityAction),
  ].join('|');
}

export function recommendationShownEvent(
  record: SupervisedRecommendationRecord,
  state: RecommendationLifecycleState,
): SupervisedRecommendationEvent {
  const semanticRecommendationId = semanticIdForRecord(record, state);
  return {
    recordKind: 'supervised_recommendation_event',
    eventId: `v3|shown|${stableHash(record.id)}|${stableHash(record.shownAt)}`,
    eventType: 'RECOMMENDATION_SHOWN',
    logicalRecommendationId: semanticRecommendationId,
    recommendationCycleId: record.id,
    organizationId: record.organizationId,
    actorId: record.actorId,
    clientId: record.clientId,
    occurredAt: record.shownAt,
    reason: record.reason,
    alertKind: record.alertKind,
    recommendedAction: record.recommendedAction,
    relevantDate: record.relevantDate,
    stage: record.stage,
  };
}

export function recommendationDecisionEvent(
  record: SupervisedRecommendationRecord,
  state: RecommendationLifecycleState,
): SupervisedRecommendationEvent | null {
  if (record.humanDecision === 'pending' || !record.decisionAt || !record.actualAction) return null;
  const sourceActivityIdentity = recommendationActivityIdentity(record);
  if (!sourceActivityIdentity) return null;
  const semanticRecommendationId = semanticIdForRecord(record, state);
  return {
    recordKind: 'supervised_recommendation_event',
    eventId: `v3|decision|${stableHash(record.id)}|${stableHash(sourceActivityIdentity)}`,
    eventType: 'RECOMMENDATION_DECISION',
    logicalRecommendationId: semanticRecommendationId,
    recommendationCycleId: record.id,
    organizationId: record.organizationId,
    actorId: record.actorId,
    clientId: record.clientId,
    occurredAt: record.decisionAt,
    humanDecision: record.humanDecision,
    actualAction: record.actualAction,
    sourceActivityIdentity,
    sourceActivityId: record.decisionSourceActivityId,
    sourceActivityCreatedAt: record.decisionSourceActivityCreatedAt,
    sourceActivityAction: record.decisionSourceActivityAction,
  };
}

export function eventsFromLifecycleMutation(mutation: RecommendationLifecycleMutation): SupervisedRecommendationEvent[] {
  const events = mutation.shownRecords.map((record) => recommendationShownEvent(record, mutation.state));
  mutation.decisionRecords.forEach((record) => {
    const event = recommendationDecisionEvent(record, mutation.state);
    if (event) events.push(event);
  });
  return events;
}

export function supervisedRecommendationCloudRow(event: SupervisedRecommendationEvent, userId: string): CloudRecordRow {
  return {
    organization_id: event.organizationId,
    entity_type: 'activity',
    entity_key: organizationScopedEntityKey(event.organizationId, `recommendation-event:${encodeURIComponent(event.eventId)}`),
    assigned_member_id: event.actorId,
    payload: event,
    created_by: userId,
  };
}

function eventAllowed(event: SupervisedRecommendationEvent, authorization: RecommendationTelemetryAuthorization): boolean {
  if (event.organizationId !== authorization.organizationId) return false;
  if (event.actorId !== authorization.currentMemberId) return false;
  if (!authorization.activeMemberIds.has(event.actorId)) return false;
  if (!authorization.visibleClientIds.has(event.clientId)) return false;
  return true;
}

export async function flushRecommendationEventBatch(
  events: SupervisedRecommendationEvent[],
  authorization: RecommendationTelemetryAuthorization,
  userId: string,
  postRows: (rows: CloudRecordRow[]) => Promise<void>,
): Promise<RecommendationTelemetryFlushResult> {
  const eligible = events.filter((event) => eventAllowed(event, authorization));
  if (!eligible.length) return { remaining: events, sentEventIds: [], attempted: 0, failed: false };
  const rows = eligible.map((event) => supervisedRecommendationCloudRow(event, userId));
  try {
    await postRows(rows);
    const sent = new Set(eligible.map((event) => event.eventId));
    return {
      remaining: events.filter((event) => !sent.has(event.eventId)),
      sentEventIds: [...sent],
      attempted: rows.length,
      failed: false,
    };
  } catch {
    return { remaining: events, sentEventIds: [], attempted: rows.length, failed: true };
  }
}

function assertTransportAuthority(context: RecommendationTelemetryTenantContext, transport: Awaited<ReturnType<typeof tenantCloudTransport>>): void {
  if (
    !tenantScopesEqual(transport.scope, context.scope)
    || transport.context.organizationId !== context.scope.organizationId
    || transport.context.currentMemberId !== context.actorId
    || transport.userId !== context.scope.userId
  ) {
    throw new Error(RECOMMENDATION_TELEMETRY_AUTHORITY_MISMATCH);
  }
}

export async function flushRecommendationOutbox(context: RecommendationTelemetryTenantContext): Promise<boolean> {
  try {
    const tenant = requireCurrentTenantContext(context);
    const pending = readSupervisedRecommendationOutbox(tenant);
    if (!pending.length || !getCloudSession()) return true;

    requireCurrentTenantContext(tenant);
    const transport = await tenantCloudTransport(tenant.scope);
    requireCurrentTenantContext(tenant);
    assertTransportAuthority(tenant, transport);

    const authorization: RecommendationTelemetryAuthorization = {
      organizationId: tenant.scope.organizationId,
      currentMemberId: transport.context.currentMemberId,
      currentRole: transport.context.currentRole,
      activeMemberIds: new Set(transport.context.members.filter((member) => member.status === 'Activo').map((member) => member.id)),
      visibleClientIds: tenant.visibleClientIds,
    };
    const result = await flushRecommendationEventBatch(
      pending,
      authorization,
      transport.userId,
      (rows) => insertTenantCloudRecordsIgnoreDuplicates(transport, rows, tenant.runtimeLease),
    );
    if (result.failed) return false;

    requireCurrentTenantContext(tenant);
    if (result.sentEventIds.length) {
      const current = readSupervisedRecommendationOutbox(tenant);
      requireCurrentTenantContext(tenant);
      const next = acknowledgeRecommendationEvents(current, result.sentEventIds);
      if (next.length !== current.length) writeOutbox(tenant, next);
      requireCurrentTenantContext(tenant);
    }
    return true;
  } catch (error) {
    console.warn('No se pudo persistir la telemetría supervisada; queda pendiente en outbox.', error);
    return false;
  }
}

/** Single-flight por tenant+actor+generación; una segunda oportunidad coalescea dentro del mismo lease. */
export function scheduleRecommendationOutboxFlush(context: RecommendationTelemetryTenantContext): Promise<void> {
  if (!getCloudSession()) return Promise.resolve();
  const tenant = requireCurrentTenantContext(context);
  const key = `${outboxStorageKey(tenant)}:lease:${tenant.runtimeLease.generation}`;
  let flight = flushFlights.get(key);
  if (!flight) {
    flight = { running: null, requestedAgain: false };
    flushFlights.set(key, flight);
  }
  if (flight.running) {
    flight.requestedAgain = true;
    return flight.running;
  }

  const activeFlight = flight;
  const running = (async () => {
    do {
      activeFlight.requestedAgain = false;
      const success = await flushRecommendationOutbox(tenant);
      if (!success) break;
    } while (activeFlight.requestedAgain && readSupervisedRecommendationOutbox(tenant).length > 0);
  })();
  activeFlight.running = running.finally(() => {
    activeFlight.running = null;
    if (!activeFlight.requestedAgain) flushFlights.delete(key);
  });
  return activeFlight.running;
}

export function persistSupervisedRecommendationLifecycle(
  context: RecommendationTelemetryContext,
  snapshot: RecommendationLifecycleSnapshot,
  mutation: RecommendationLifecycleMutation,
): void {
  const events = eventsFromLifecycleMutation(mutation).filter((event) => (
    event.organizationId === context.organizationId
    && event.actorId === context.actorId
    && context.visibleClientIds.has(event.clientId)
  ));

  if (!hasTenantContext(context)) {
    const hasPending = readSupervisedRecommendationOutbox(context).length > 0;
    if (events.length || mutation.changed > 0 || snapshot.migratedFromR2 || hasPending) {
      throw new Error(RECOMMENDATION_TELEMETRY_TENANT_CONTEXT_REQUIRED);
    }
    return;
  }

  const tenant = requireCurrentTenantContext(context);
  if (events.length) {
    const current = readSupervisedRecommendationOutbox(tenant);
    const next = appendUniqueRecommendationEvents(current, events);
    if (next.length !== current.length) writeOutbox(tenant, next);
  }

  if (mutation.changed > 0 || snapshot.migratedFromR2) {
    writeLifecycleState(tenant, mutation.state);
    if (snapshot.migratedFromR2) {
      requireCurrentTenantContext(tenant);
      localStorage.removeItem(legacyStorageKey(tenant));
    }
  }

  if (events.length || readSupervisedRecommendationOutbox(tenant).length > 0) {
    void scheduleRecommendationOutboxFlush(tenant);
  }
}
