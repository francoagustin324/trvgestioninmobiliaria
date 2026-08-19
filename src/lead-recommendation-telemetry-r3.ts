import { getCloudMembershipContext, getCloudSession } from './cloud-api.js';
import { organizationScopedEntityKey, type CloudRecordRow } from './cloud-records.js';
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
import type { TeamRole } from './models.js';
import { scopedStorageKey } from './sync-safety.js';

const LEGACY_TELEMETRY_STORAGE_SUFFIX = 'supervised-recommendations-v2';
const LIFECYCLE_STORAGE_SUFFIX = 'supervised-recommendation-lifecycle-v3';
const TELEMETRY_OUTBOX_SUFFIX = 'supervised-recommendation-outbox-v1';

interface PublicCloudConfig {
  configured?: boolean;
  url?: string;
  publishableKey?: string;
}

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

interface FlushFlight {
  running: Promise<void> | null;
  requestedAgain: boolean;
}

let cloudConfigPromise: Promise<{ url: string; publishableKey: string }> | null = null;
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

function storageKey(context: RecommendationInstrumentationContext, suffix: string): string {
  return [scopedStorageKey(), suffix, encodeURIComponent(context.organizationId), String(context.actorId)].join(':');
}

function lifecycleStorageKey(context: RecommendationInstrumentationContext): string {
  return storageKey(context, LIFECYCLE_STORAGE_SUFFIX);
}

function legacyStorageKey(context: RecommendationInstrumentationContext): string {
  return storageKey(context, LEGACY_TELEMETRY_STORAGE_SUFFIX);
}

function outboxStorageKey(context: RecommendationInstrumentationContext): string {
  return storageKey(context, TELEMETRY_OUTBOX_SUFFIX);
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
  return { clientId, semanticRecommendationId, cycleId, activationWitness, phase, record };
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

function migrateLegacyState(context: RecommendationInstrumentationContext): RecommendationLifecycleState | null {
  try {
    const raw = localStorage.getItem(legacyStorageKey(context));
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
  context: RecommendationInstrumentationContext,
): RecommendationLifecycleSnapshot {
  try {
    const raw = localStorage.getItem(lifecycleStorageKey(context));
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

function writeLifecycleState(context: RecommendationInstrumentationContext, state: RecommendationLifecycleState): void {
  const scoped: RecommendationLifecycleState = {
    version: 3,
    cycles: state.cycles.filter((cycle) => context.visibleClientIds.has(cycle.clientId)),
  };
  localStorage.setItem(lifecycleStorageKey(context), JSON.stringify(scoped));
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

export function readSupervisedRecommendationOutbox(context: RecommendationInstrumentationContext): SupervisedRecommendationEvent[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(outboxStorageKey(context)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizedEvent).filter((event): event is SupervisedRecommendationEvent => Boolean(
      event && event.organizationId === context.organizationId && event.actorId === context.actorId,
    ));
  } catch {
    return [];
  }
}

function writeOutbox(context: RecommendationInstrumentationContext, events: SupervisedRecommendationEvent[]): void {
  localStorage.setItem(
    outboxStorageKey(context),
    JSON.stringify(events.filter((event) => event.organizationId === context.organizationId && event.actorId === context.actorId)),
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
  if (!authorization.activeMemberIds.has(event.actorId)) return false;
  if (!authorization.visibleClientIds.has(event.clientId)) return false;
  if (authorization.currentRole === 'Corredor' && authorization.currentMemberId !== event.actorId) return false;
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

async function publicCloudConfig(): Promise<{ url: string; publishableKey: string }> {
  cloudConfigPromise ??= (async () => {
    const response = await fetch('/api/cloud-config', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Cloud config ${response.status}`);
    const config = await response.json() as PublicCloudConfig;
    if (!config.configured || !config.url || !config.publishableKey) throw new Error('Cloud no configurada para telemetría supervisada.');
    return { url: config.url.replace(/\/+$/g, ''), publishableKey: config.publishableKey };
  })();
  return cloudConfigPromise;
}

function cloudHeaders(publishableKey: string, accessToken: string): Record<string, string> {
  return {
    apikey: publishableKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function postEventRows(rows: CloudRecordRow[], accessToken: string): Promise<void> {
  const config = await publicCloudConfig();
  const target = new URL(`${config.url}/rest/v1/propcontrol_records`);
  target.searchParams.set('on_conflict', 'organization_id,entity_type,entity_key');
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      ...cloudHeaders(config.publishableKey, accessToken),
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`Telemetría cloud ${response.status}`);
}

async function flushCloudOutbox(context: RecommendationInstrumentationContext): Promise<boolean> {
  const pending = readSupervisedRecommendationOutbox(context);
  if (!pending.length || !getCloudSession()) return true;
  try {
    const membership = await getCloudMembershipContext();
    const session = getCloudSession();
    if (!session) return true;
    const authorization: RecommendationTelemetryAuthorization = {
      organizationId: membership.organizationId,
      currentMemberId: membership.currentMemberId,
      currentRole: membership.currentRole,
      activeMemberIds: new Set(membership.members.filter((member) => member.status === 'Activo').map((member) => member.id)),
      visibleClientIds: context.visibleClientIds,
    };
    const result = await flushRecommendationEventBatch(
      pending,
      authorization,
      session.userId,
      (rows) => postEventRows(rows, session.accessToken),
    );
    if (result.failed) return false;
    if (result.sentEventIds.length) {
      // ACK contra el outbox ACTUAL: un evento agregado durante el POST sobrevive.
      const current = readSupervisedRecommendationOutbox(context);
      const next = acknowledgeRecommendationEvents(current, result.sentEventIds);
      if (next.length !== current.length) writeOutbox(context, next);
    }
    return true;
  } catch (error) {
    console.warn('No se pudo persistir la telemetría supervisada; queda pendiente en outbox.', error);
    return false;
  }
}

/** Single-flight por scope; un render concurrente sólo coalescea otra oportunidad. */
export function scheduleRecommendationOutboxFlush(context: RecommendationInstrumentationContext): void {
  if (!getCloudSession()) return;
  const key = outboxStorageKey(context);
  let flight = flushFlights.get(key);
  if (!flight) {
    flight = { running: null, requestedAgain: false };
    flushFlights.set(key, flight);
  }
  if (flight.running) {
    flight.requestedAgain = true;
    return;
  }

  const activeFlight = flight;
  activeFlight.running = (async () => {
    do {
      activeFlight.requestedAgain = false;
      const success = await flushCloudOutbox(context);
      if (!success) break;
    } while (activeFlight.requestedAgain && readSupervisedRecommendationOutbox(context).length > 0);
  })().finally(() => {
    activeFlight.running = null;
    if (!activeFlight.requestedAgain) flushFlights.delete(key);
  });
}

export function persistSupervisedRecommendationLifecycle(
  context: RecommendationInstrumentationContext,
  snapshot: RecommendationLifecycleSnapshot,
  mutation: RecommendationLifecycleMutation,
): void {
  const events = eventsFromLifecycleMutation(mutation).filter((event) => (
    event.organizationId === context.organizationId
    && event.actorId === context.actorId
    && context.visibleClientIds.has(event.clientId)
  ));

  // Durabilidad: un evento nuevo entra al outbox ANTES de compactar el estado local.
  if (events.length) {
    const current = readSupervisedRecommendationOutbox(context);
    const next = appendUniqueRecommendationEvents(current, events);
    if (next.length !== current.length) writeOutbox(context, next);
  }

  if (mutation.changed > 0 || snapshot.migratedFromR2) {
    writeLifecycleState(context, mutation.state);
    if (snapshot.migratedFromR2) localStorage.removeItem(legacyStorageKey(context));
  }

  // No-op render: cero write local. Si hay outbox pendiente, conserva una
  // oportunidad coalescida de recovery cloud sin polling ni timers permanentes.
  if (events.length || readSupervisedRecommendationOutbox(context).length > 0) {
    scheduleRecommendationOutboxFlush(context);
  }
}
