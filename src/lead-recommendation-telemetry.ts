import { getCloudMembershipContext, getCloudSession } from './cloud-api.js';
import { organizationScopedEntityKey, type CloudRecordRow } from './cloud-records.js';
import { scopedStorageKey } from './sync-safety.js';
import type {
  RecommendationHumanDecision,
  RecommendationInstrumentationContext,
  SupervisedRecommendationRecord,
} from './lead-recommendation-instrumentation-core.js';
import type { TeamRole } from './models.js';

const TELEMETRY_STORAGE_SUFFIX = 'supervised-recommendations-v2';
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
  logicalRecommendationId: string;
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

let cloudConfigPromise: Promise<{ url: string; publishableKey: string }> | null = null;
let cloudWriteQueue: Promise<void> = Promise.resolve();

function identityPart(value: unknown): string {
  return encodeURIComponent(String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase());
}

function humanDecision(value: unknown): RecommendationHumanDecision {
  return value === 'executed' || value === 'modified' ? value : 'pending';
}

function normalizedRecommendation(value: unknown): SupervisedRecommendationRecord | null {
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
    recordKind: 'supervised_recommendation_event', eventId, eventType, logicalRecommendationId, organizationId, actorId, clientId,
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

function storageKey(context: RecommendationInstrumentationContext, suffix: string): string {
  return [scopedStorageKey(), suffix, encodeURIComponent(context.organizationId), String(context.actorId)].join(':');
}

function stateStorageKey(context: RecommendationInstrumentationContext): string {
  return storageKey(context, TELEMETRY_STORAGE_SUFFIX);
}

function outboxStorageKey(context: RecommendationInstrumentationContext): string {
  return storageKey(context, TELEMETRY_OUTBOX_SUFFIX);
}

export function readSupervisedRecommendationTelemetry(context: RecommendationInstrumentationContext): SupervisedRecommendationRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(stateStorageKey(context)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizedRecommendation).filter((item): item is SupervisedRecommendationRecord => Boolean(item && item.organizationId === context.organizationId && item.actorId === context.actorId));
  } catch { return []; }
}

export function readSupervisedRecommendationOutbox(context: RecommendationInstrumentationContext): SupervisedRecommendationEvent[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(outboxStorageKey(context)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizedEvent).filter((item): item is SupervisedRecommendationEvent => Boolean(item && item.organizationId === context.organizationId && item.actorId === context.actorId));
  } catch { return []; }
}

function writeLocalTelemetry(context: RecommendationInstrumentationContext, log: SupervisedRecommendationRecord[]): void {
  localStorage.setItem(stateStorageKey(context), JSON.stringify(log.filter((item) => item.organizationId === context.organizationId && item.actorId === context.actorId)));
}

function writeOutbox(context: RecommendationInstrumentationContext, events: SupervisedRecommendationEvent[]): void {
  localStorage.setItem(outboxStorageKey(context), JSON.stringify(events.filter((item) => item.organizationId === context.organizationId && item.actorId === context.actorId)));
}

export function appendUniqueRecommendationEvents(outbox: SupervisedRecommendationEvent[], incoming: SupervisedRecommendationEvent[]): SupervisedRecommendationEvent[] {
  const byId = new Map(outbox.map((event) => [event.eventId, event]));
  incoming.forEach((event) => { if (!byId.has(event.eventId)) byId.set(event.eventId, event); });
  return [...byId.values()];
}

export function recommendationShownEventId(record: SupervisedRecommendationRecord): string {
  return ['v1', 'shown', identityPart(record.id), identityPart(record.shownAt)].join('|');
}

export function recommendationActivityIdentity(record: SupervisedRecommendationRecord): string | null {
  if (record.decisionSourceActivityId === undefined || !record.decisionSourceActivityCreatedAt || !record.decisionSourceActivityAction) return null;
  return ['v1', String(record.actorId), String(record.clientId), String(record.decisionSourceActivityId), identityPart(record.decisionSourceActivityCreatedAt), identityPart(record.decisionSourceActivityAction)].join('|');
}

export function recommendationDecisionEventId(record: SupervisedRecommendationRecord): string | null {
  const activityIdentity = recommendationActivityIdentity(record);
  return activityIdentity ? ['v1', 'decision', identityPart(record.id), identityPart(activityIdentity)].join('|') : null;
}

export function supervisedRecommendationShownEvent(record: SupervisedRecommendationRecord): SupervisedRecommendationEvent {
  return {
    recordKind: 'supervised_recommendation_event', eventId: recommendationShownEventId(record), eventType: 'RECOMMENDATION_SHOWN',
    logicalRecommendationId: record.id, organizationId: record.organizationId, actorId: record.actorId, clientId: record.clientId,
    occurredAt: record.shownAt, reason: record.reason, alertKind: record.alertKind, recommendedAction: record.recommendedAction,
    relevantDate: record.relevantDate, stage: record.stage,
  };
}

export function supervisedRecommendationDecisionEvent(record: SupervisedRecommendationRecord): SupervisedRecommendationEvent | null {
  if (record.humanDecision === 'pending' || !record.decisionAt || !record.actualAction) return null;
  const sourceActivityIdentity = recommendationActivityIdentity(record);
  const eventId = recommendationDecisionEventId(record);
  if (!sourceActivityIdentity || !eventId) return null;
  return {
    recordKind: 'supervised_recommendation_event', eventId, eventType: 'RECOMMENDATION_DECISION', logicalRecommendationId: record.id,
    organizationId: record.organizationId, actorId: record.actorId, clientId: record.clientId, occurredAt: record.decisionAt,
    humanDecision: record.humanDecision, actualAction: record.actualAction, sourceActivityIdentity,
    sourceActivityId: record.decisionSourceActivityId, sourceActivityCreatedAt: record.decisionSourceActivityCreatedAt,
    sourceActivityAction: record.decisionSourceActivityAction,
  };
}

export function recommendationEventsFromMutation(before: SupervisedRecommendationRecord[], after: SupervisedRecommendationRecord[]): SupervisedRecommendationEvent[] {
  const previous = new Map(before.map((item) => [item.id, item]));
  const events: SupervisedRecommendationEvent[] = [];
  after.forEach((record) => {
    const prior = previous.get(record.id);
    if (!prior) events.push(supervisedRecommendationShownEvent(record));
    if (record.humanDecision !== 'pending' && (!prior || prior.humanDecision === 'pending')) {
      const decision = supervisedRecommendationDecisionEvent(record);
      if (decision) events.push(decision);
    }
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
    return { remaining: events.filter((event) => !sent.has(event.eventId)), sentEventIds: [...sent], attempted: rows.length, failed: false };
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
  return { apikey: publishableKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

async function postEventRows(rows: CloudRecordRow[], accessToken: string): Promise<void> {
  const config = await publicCloudConfig();
  const target = new URL(`${config.url}/rest/v1/propcontrol_records`);
  target.searchParams.set('on_conflict', 'organization_id,entity_type,entity_key');
  const response = await fetch(target, {
    method: 'POST',
    headers: { ...cloudHeaders(config.publishableKey, accessToken), Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`Telemetría cloud ${response.status}`);
}

async function flushCloudOutbox(context: RecommendationInstrumentationContext): Promise<void> {
  const pending = readSupervisedRecommendationOutbox(context);
  if (!pending.length || !getCloudSession()) return;
  try {
    const membership = await getCloudMembershipContext();
    const session = getCloudSession();
    if (!session) return;
    const authorization: RecommendationTelemetryAuthorization = {
      organizationId: membership.organizationId,
      currentMemberId: membership.currentMemberId,
      currentRole: membership.currentRole,
      activeMemberIds: new Set(membership.members.filter((member) => member.status === 'Activo').map((member) => member.id)),
      visibleClientIds: context.visibleClientIds,
    };
    const result = await flushRecommendationEventBatch(pending, authorization, session.userId, (rows) => postEventRows(rows, session.accessToken));
    if (!result.failed && result.sentEventIds.length) {
      // ACK sobre el outbox ACTUAL: no perder eventos agregados mientras este POST estaba en vuelo.
      const acknowledged = new Set(result.sentEventIds);
      writeOutbox(context, readSupervisedRecommendationOutbox(context).filter((event) => !acknowledged.has(event.eventId)));
    }
  } catch (error) {
    console.warn('No se pudo persistir la telemetría supervisada; queda pendiente en outbox.', error);
  }
}

function scheduleOutboxFlush(context: RecommendationInstrumentationContext): void {
  if (!getCloudSession()) return;
  cloudWriteQueue = cloudWriteQueue.then(() => flushCloudOutbox(context)).catch((error) => {
    console.warn('No se pudo vaciar el outbox de telemetría supervisada.', error);
  });
}

export function persistSupervisedRecommendationTelemetry(
  context: RecommendationInstrumentationContext,
  before: SupervisedRecommendationRecord[],
  after: SupervisedRecommendationRecord[],
): void {
  writeLocalTelemetry(context, after);
  const events = recommendationEventsFromMutation(before, after).filter((event) => event.organizationId === context.organizationId && event.actorId === context.actorId && context.visibleClientIds.has(event.clientId));
  if (events.length) writeOutbox(context, appendUniqueRecommendationEvents(readSupervisedRecommendationOutbox(context), events));
  // Próxima oportunidad segura también reintenta pendientes previos; sin polling ni loop agresivo.
  scheduleOutboxFlush(context);
}
