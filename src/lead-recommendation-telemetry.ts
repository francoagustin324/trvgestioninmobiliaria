import { getCloudMembershipContext, getCloudSession } from './cloud-api.js';
import {
  isSupervisedRecommendationTelemetryPayload,
  organizationScopedEntityKey,
  type CloudRecordRow,
} from './cloud-records.js';
import { scopedStorageKey } from './sync-safety.js';
import type {
  RecommendationInstrumentationContext,
  RecommendationHumanDecision,
  SupervisedRecommendationRecord,
} from './lead-recommendation-instrumentation-core.js';

const TELEMETRY_STORAGE_SUFFIX = 'supervised-recommendations-v1';

interface PublicCloudConfig {
  configured?: boolean;
  url?: string;
  publishableKey?: string;
}

interface RecommendationTelemetryPayload extends SupervisedRecommendationRecord {
  recordKind: 'supervised_recommendation';
}

let cloudConfigPromise: Promise<{ url: string; publishableKey: string }> | null = null;
let cloudWriteQueue: Promise<void> = Promise.resolve();

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
    outcome: item.outcome === 'Ganado' || item.outcome === 'Perdido' ? item.outcome : undefined,
    outcomeAt: item.outcomeAt ? String(item.outcomeAt) : undefined,
  };
}

function localStorageKey(context: RecommendationInstrumentationContext): string {
  return [
    scopedStorageKey(),
    TELEMETRY_STORAGE_SUFFIX,
    encodeURIComponent(context.organizationId),
    String(context.actorId),
  ].join(':');
}

export function readSupervisedRecommendationTelemetry(
  context: RecommendationInstrumentationContext,
): SupervisedRecommendationRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(localStorageKey(context)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizedRecommendation)
      .filter((item): item is SupervisedRecommendationRecord => Boolean(
        item
        && item.organizationId === context.organizationId
        && item.actorId === context.actorId,
      ));
  } catch {
    return [];
  }
}

function writeLocalTelemetry(
  context: RecommendationInstrumentationContext,
  log: SupervisedRecommendationRecord[],
): void {
  const scoped = log.filter((item) => (
    item.organizationId === context.organizationId
    && item.actorId === context.actorId
  ));
  localStorage.setItem(localStorageKey(context), JSON.stringify(scoped));
}

function telemetryPayload(record: SupervisedRecommendationRecord): RecommendationTelemetryPayload {
  return { recordKind: 'supervised_recommendation', ...record };
}

export function supervisedRecommendationCloudRow(
  record: SupervisedRecommendationRecord,
  userId: string,
): CloudRecordRow {
  return {
    organization_id: record.organizationId,
    entity_type: 'activity',
    entity_key: organizationScopedEntityKey(record.organizationId, `recommendation:${record.id}`),
    assigned_member_id: record.actorId,
    payload: telemetryPayload(record),
    created_by: userId,
  };
}

function recommendationFromCloudRow(row: CloudRecordRow | undefined): SupervisedRecommendationRecord | null {
  if (!row || !isSupervisedRecommendationTelemetryPayload(row.payload)) return null;
  const payload = row.payload as RecommendationTelemetryPayload;
  return normalizedRecommendation(payload);
}

export function mergeSupervisedRecommendationTelemetry(
  existing: SupervisedRecommendationRecord,
  incoming: SupervisedRecommendationRecord,
): SupervisedRecommendationRecord {
  if (
    existing.id !== incoming.id
    || existing.organizationId !== incoming.organizationId
    || existing.actorId !== incoming.actorId
    || existing.clientId !== incoming.clientId
  ) return incoming;

  const existingDecided = existing.humanDecision !== 'pending';
  const incomingDecided = incoming.humanDecision !== 'pending';
  return {
    ...existing,
    shownAt: existing.shownAt <= incoming.shownAt ? existing.shownAt : incoming.shownAt,
    humanDecision: existingDecided ? existing.humanDecision : incoming.humanDecision,
    decisionAt: existingDecided ? existing.decisionAt : incomingDecided ? incoming.decisionAt : undefined,
    actualAction: existingDecided ? existing.actualAction : incomingDecided ? incoming.actualAction : undefined,
    outcome: existing.outcome ?? incoming.outcome,
    outcomeAt: existing.outcome ? existing.outcomeAt : incoming.outcomeAt,
  };
}

async function publicCloudConfig(): Promise<{ url: string; publishableKey: string }> {
  cloudConfigPromise ??= (async () => {
    const response = await fetch('/api/cloud-config', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Cloud config ${response.status}`);
    const config = await response.json() as PublicCloudConfig;
    if (!config.configured || !config.url || !config.publishableKey) {
      throw new Error('Cloud no configurada para telemetría supervisada.');
    }
    return {
      url: config.url.replace(/\/+$/g, ''),
      publishableKey: config.publishableKey,
    };
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

async function parseCloudResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) throw new Error(`Telemetría cloud ${response.status}`);
  return payload;
}

async function persistCloudRecord(record: SupervisedRecommendationRecord): Promise<void> {
  if (!getCloudSession()) return;
  const membership = await getCloudMembershipContext();
  const session = getCloudSession();
  if (!session) return;
  if (membership.organizationId !== record.organizationId) {
    throw new Error('Organización inválida para telemetría supervisada.');
  }
  const actor = membership.members.find((member) => member.id === record.actorId && member.status === 'Activo');
  if (!actor) throw new Error('Actor inválido para telemetría supervisada.');
  if (membership.currentRole === 'Corredor' && membership.currentMemberId !== record.actorId) {
    throw new Error('Un corredor no puede persistir telemetría de otro integrante.');
  }

  const config = await publicCloudConfig();
  const incomingRow = supervisedRecommendationCloudRow(record, session.userId);
  const query = new URL(`${config.url}/rest/v1/propcontrol_records`);
  query.searchParams.set('select', 'organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,updated_at');
  query.searchParams.set('organization_id', `eq.${record.organizationId}`);
  query.searchParams.set('entity_type', 'eq.activity');
  query.searchParams.set('entity_key', `eq.${incomingRow.entity_key}`);
  query.searchParams.set('limit', '1');
  const existingRows = await parseCloudResponse(await fetch(query, {
    headers: cloudHeaders(config.publishableKey, session.accessToken),
    cache: 'no-store',
  })) as CloudRecordRow[];

  const existingRecord = recommendationFromCloudRow(existingRows[0]);
  const mergedRecord = existingRecord
    ? mergeSupervisedRecommendationTelemetry(existingRecord, record)
    : record;
  const row = supervisedRecommendationCloudRow(mergedRecord, existingRows[0]?.created_by || session.userId);
  const target = new URL(`${config.url}/rest/v1/propcontrol_records`);
  target.searchParams.set('on_conflict', 'organization_id,entity_type,entity_key');
  await parseCloudResponse(await fetch(target, {
    method: 'POST',
    headers: {
      ...cloudHeaders(config.publishableKey, session.accessToken),
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([row]),
  }));
}

function changedRecords(
  before: SupervisedRecommendationRecord[],
  after: SupervisedRecommendationRecord[],
): SupervisedRecommendationRecord[] {
  const previous = new Map(before.map((item) => [item.id, JSON.stringify(item)]));
  return after.filter((item) => previous.get(item.id) !== JSON.stringify(item));
}

export function persistSupervisedRecommendationTelemetry(
  context: RecommendationInstrumentationContext,
  before: SupervisedRecommendationRecord[],
  after: SupervisedRecommendationRecord[],
): void {
  writeLocalTelemetry(context, after);
  const changed = changedRecords(before, after).filter((item) => (
    item.organizationId === context.organizationId
    && item.actorId === context.actorId
    && context.visibleClientIds.has(item.clientId)
  ));
  if (!changed.length || !getCloudSession()) return;

  cloudWriteQueue = cloudWriteQueue
    .then(async () => {
      for (const record of changed) await persistCloudRecord(record);
    })
    .catch((error) => {
      console.warn('No se pudo persistir la telemetría supervisada.', error);
    });
}
