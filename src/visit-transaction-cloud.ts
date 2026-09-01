import {
  cloudRecordIdentity,
  crmToCloudRecords,
  isSupervisedRecommendationTelemetryPayload,
  staleCloudRecords,
  type CloudMembershipContext,
  type CloudRecordRow,
} from './cloud-records.js';
import { getCloudMembershipContext, getCloudSession } from './cloud-api.js';
import {
  SNAPSHOT_ONLY_COMMERCIAL_AUTHORITY,
  VISIT_TRANSACTION_COMMERCIAL_AUTHORITY,
  snapshotMayWriteCommercialEntity,
  type CommercialSyncAuthority,
} from './commercial-sync-transition.js';
import type { Client, CrmData } from './models.js';
import {
  assertRemoteIsSafe,
  latestRemoteVersion,
  stableFingerprint,
} from './sync-safety.js';
import { canonicalUuid, normalizeRevision } from './sync-identity.js';
import type {
  ClientSnapshotCasIntent,
  ClientSnapshotCasResult,
  CommercialRecordReference,
  VisitMutationIntent,
  VisitMutationResult,
} from './visit-transaction-contract.js';

interface PublicCloudConfig {
  configured?: boolean;
  url?: string;
  publishableKey?: string;
}

interface RpcErrorPayload {
  code?: unknown;
  message?: unknown;
  error?: unknown;
  error_description?: unknown;
  details?: unknown;
  hint?: unknown;
}

export type VisitWriterMode = 'local' | 'legacy-cloud' | 'transactional-cloud';

export class VisitTransactionCloudError extends Error {
  constructor(message: string, readonly status: number, readonly code = '') {
    super(message);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorText(payload: unknown, fallback: string): string {
  const value = record(payload) as RpcErrorPayload | null;
  const candidate = [value?.message, value?.error_description, value?.error, value?.details, value?.hint]
    .find((item) => typeof item === 'string' && item.trim());
  return typeof candidate === 'string' ? candidate.trim() : fallback;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) {
    const value = record(payload) as RpcErrorPayload | null;
    throw new VisitTransactionCloudError(
      errorText(payload, `Error de conexión (${response.status}).`),
      response.status,
      typeof value?.code === 'string' ? value.code : '',
    );
  }
  return payload;
}

async function publicConfig(): Promise<Required<Pick<PublicCloudConfig, 'url' | 'publishableKey'>>> {
  const payload = await parseJson(await fetch('/api/cloud-config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })) as PublicCloudConfig;
  if (!payload.configured || !payload.url || !payload.publishableKey) {
    throw new Error('La conexión con Supabase todavía no está configurada.');
  }
  return { url: payload.url.replace(/\/+$/g, ''), publishableKey: payload.publishableKey };
}

function authenticatedHeaders(publishableKey: string, accessToken: string): Record<string, string> {
  return {
    apikey: publishableKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function authenticatedTransport(): Promise<{
  context: CloudMembershipContext;
  accessToken: string;
  userId: string;
  config: Required<Pick<PublicCloudConfig, 'url' | 'publishableKey'>>;
}> {
  const context = await getCloudMembershipContext();
  const session = getCloudSession();
  if (!session) throw new Error('La sesión venció. Volvé a ingresar.');
  return {
    context,
    accessToken: session.accessToken,
    userId: session.userId,
    config: await publicConfig(),
  };
}

async function rpc(name: string, payload: unknown): Promise<unknown> {
  const transport = await authenticatedTransport();
  return parseJson(await fetch(`${transport.config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: authenticatedHeaders(transport.config.publishableKey, transport.accessToken),
    body: JSON.stringify(payload),
  }));
}

export function selectVisitWriterMode(hasCloudSession: boolean, authorityActive?: boolean): VisitWriterMode {
  if (!hasCloudSession) return 'local';
  if (authorityActive === false) return 'legacy-cloud';
  if (authorityActive === true) return 'transactional-cloud';
  throw new Error('La capability de Visit debe resolverse antes de seleccionar el writer cloud.');
}

export async function visitTransactionAuthorityActive(): Promise<boolean> {
  const payload = await rpc('visit_transaction_authority_active', {});
  if (typeof payload !== 'boolean') {
    throw new Error('La capability de Visit devolvió una respuesta inválida.');
  }
  return payload;
}

function mutationRequest(intent: VisitMutationIntent): Record<string, unknown> {
  if (intent.operationType === 'VISIT_CREATE') {
    return {
      client: intent.client,
      expectedClientRevision: intent.expectedClientRevision,
      property: intent.property,
      localDate: intent.localDate,
      localTime: intent.localTime,
    };
  }
  return {
    client: intent.client,
    expectedClientRevision: intent.expectedClientRevision,
    visitUid: intent.visitUid,
    expectedVisitRevision: intent.expectedVisitRevision,
    status: intent.status,
    ...(intent.interest ? { interest: intent.interest } : {}),
    ...(intent.objection ? { objection: intent.objection } : {}),
    ...(intent.nextAction ? { nextAction: intent.nextAction } : {}),
    ...(intent.nextFollowUp ? { nextFollowUp: intent.nextFollowUp } : {}),
  };
}

function assertVisitMutationResult(payload: unknown, intent: VisitMutationIntent): VisitMutationResult {
  const value = record(payload);
  const client = record(value?.client);
  const visit = record(value?.visit);
  const activity = record(value?.activity);
  if (
    value?.success !== true
    || value.operationId !== intent.operationId
    || value.operationType !== intent.operationType
    || typeof value.organizationId !== 'string'
    || typeof value.serverTimestamp !== 'string'
    || !client
    || !visit
    || !activity
    || typeof visit.uid !== 'string'
    || typeof visit.revision !== 'number'
    || typeof activity.uid !== 'string'
    || activity.transactionOwner !== 'visit'
  ) {
    throw new Error('La RPC de Visit devolvió un agregado autoritativo inválido.');
  }
  return payload as VisitMutationResult;
}

export async function invokeVisitTransaction(intent: VisitMutationIntent): Promise<VisitMutationResult> {
  const payload = await rpc('commercial_visit_mutation', {
    p_operation_id: intent.operationId,
    p_operation_type: intent.operationType,
    p_request: mutationRequest(intent),
    p_force_rollback: false,
  });
  return assertVisitMutationResult(payload, intent);
}

function clientReference(payload: unknown): CommercialRecordReference {
  const value = record(payload);
  const uid = canonicalUuid(value?.uid);
  if (uid) return { uid };
  const legacyId = Number(value?.id);
  if (!Number.isSafeInteger(legacyId) || legacyId <= 0) {
    throw new Error('El Client no tiene una identidad válida para CAS.');
  }
  return { legacyId };
}

function clientRevision(payload: unknown): number {
  const value = record(payload);
  return normalizeRevision(value?.revision);
}

function isVisitOwnedActivity(row: CloudRecordRow): boolean {
  return row.entity_type === 'activity' && record(row.payload)?.transactionOwner === 'visit';
}

function snapshotMayWriteRecord(row: CloudRecordRow, authority: CommercialSyncAuthority): boolean {
  if (row.entity_type === 'visit') return snapshotMayWriteCommercialEntity('visit', authority);
  if (isVisitOwnedActivity(row)) return false;
  return true;
}

function comparableRecords(records: CloudRecordRow[]): CloudRecordRow[] {
  return records.filter((row) => !isSupervisedRecommendationTelemetryPayload(row.payload));
}

function recordsFingerprint(records: CloudRecordRow[]): string {
  return stableFingerprint(comparableRecords(records)
    .map((row) => ({
      organization_id: row.organization_id,
      entity_type: row.entity_type,
      entity_key: row.entity_key,
      assigned_member_id: row.assigned_member_id,
      payload: row.payload,
    }))
    .sort((left, right) => `${left.entity_type}:${left.entity_key}`.localeCompare(`${right.entity_type}:${right.entity_key}`)));
}

function rowFingerprint(row: CloudRecordRow): string {
  return stableFingerprint({
    assigned_member_id: row.assigned_member_id,
    payload: row.payload,
  });
}

async function fetchCloudRecords(
  config: Required<Pick<PublicCloudConfig, 'url' | 'publishableKey'>>,
  accessToken: string,
  organizationId: string,
): Promise<CloudRecordRow[]> {
  const query = new URL(`${config.url}/rest/v1/propcontrol_records`);
  query.searchParams.set('select', 'organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,updated_at');
  query.searchParams.set('organization_id', `eq.${organizationId}`);
  query.searchParams.set('order', 'entity_type.asc,entity_key.asc');
  return await parseJson(await fetch(query, {
    headers: authenticatedHeaders(config.publishableKey, accessToken),
    cache: 'no-store',
  })) as CloudRecordRow[];
}

async function upsertRecords(
  config: Required<Pick<PublicCloudConfig, 'url' | 'publishableKey'>>,
  accessToken: string,
  records: CloudRecordRow[],
): Promise<void> {
  for (let index = 0; index < records.length; index += 100) {
    const chunk = records.slice(index, index + 100);
    if (!chunk.length) continue;
    const target = new URL(`${config.url}/rest/v1/propcontrol_records`);
    target.searchParams.set('on_conflict', 'organization_id,entity_type,entity_key');
    await parseJson(await fetch(target, {
      method: 'POST',
      headers: {
        ...authenticatedHeaders(config.publishableKey, accessToken),
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    }));
  }
}

async function deleteRecords(
  config: Required<Pick<PublicCloudConfig, 'url' | 'publishableKey'>>,
  accessToken: string,
  rows: CloudRecordRow[],
): Promise<void> {
  const grouped = new Map<string, string[]>();
  rows.forEach((row) => {
    const keys = grouped.get(row.entity_type) ?? [];
    keys.push(row.entity_key);
    grouped.set(row.entity_type, keys);
  });
  for (const [entityType, keys] of grouped) {
    for (let index = 0; index < keys.length; index += 100) {
      const target = new URL(`${config.url}/rest/v1/propcontrol_records`);
      target.searchParams.set('entity_type', `eq.${entityType}`);
      target.searchParams.set('entity_key', `in.(${keys.slice(index, index + 100).map((key) => `"${key.replaceAll('"', '')}"`).join(',')})`);
      await parseJson(await fetch(target, {
        method: 'DELETE',
        headers: {
          ...authenticatedHeaders(config.publishableKey, accessToken),
          Prefer: 'return=minimal',
        },
      }));
    }
  }
}

async function clientSnapshotCas(
  config: Required<Pick<PublicCloudConfig, 'url' | 'publishableKey'>>,
  accessToken: string,
  intent: ClientSnapshotCasIntent,
): Promise<ClientSnapshotCasResult> {
  const payload = await parseJson(await fetch(`${config.url}/rest/v1/rpc/client_snapshot_cas`, {
    method: 'POST',
    headers: authenticatedHeaders(config.publishableKey, accessToken),
    body: JSON.stringify({ p_request: intent, p_force_rollback: false }),
  }));
  const value = record(payload);
  if (value?.success !== true || value.action !== intent.action || typeof value.organizationId !== 'string') {
    throw new Error('Client snapshot CAS devolvió una respuesta inválida.');
  }
  return payload as ClientSnapshotCasResult;
}

function clientPayload(row: CloudRecordRow): Client {
  const value = record(row.payload);
  if (!value || !Number.isSafeInteger(Number(value.id))) {
    throw new Error('Client snapshot inválido para CAS.');
  }
  return structuredClone(value) as unknown as Client;
}

async function reconcileClientsWithCas(
  config: Required<Pick<PublicCloudConfig, 'url' | 'publishableKey'>>,
  accessToken: string,
  existing: CloudRecordRow[],
  next: CloudRecordRow[],
): Promise<{ inserts: CloudRecordRow[]; staleHandled: Set<string> }> {
  const existingClients = new Map(existing
    .filter((row) => row.entity_type === 'client')
    .map((row) => [cloudRecordIdentity(row), row]));
  const nextClients = next.filter((row) => row.entity_type === 'client');
  const inserts: CloudRecordRow[] = [];

  for (const nextRow of nextClients) {
    const identity = cloudRecordIdentity(nextRow);
    const current = existingClients.get(identity);
    if (!current) {
      inserts.push(nextRow);
      continue;
    }
    if (rowFingerprint(current) === rowFingerprint(nextRow)) continue;
    if (current.assigned_member_id !== nextRow.assigned_member_id) {
      throw new Error('La reasignación de Client requiere una operación autoritativa específica antes de activar Visit authority.');
    }
    const payload = clientPayload(nextRow);
    await clientSnapshotCas(config, accessToken, {
      action: 'update',
      client: clientReference(current.payload),
      expectedRevision: clientRevision(current.payload),
      payload,
    });
  }

  const staleHandled = new Set<string>();
  const staleClients = staleCloudRecords(existing, next).filter((row) => row.entity_type === 'client');
  for (const current of staleClients) {
    await clientSnapshotCas(config, accessToken, {
      action: 'delete',
      client: clientReference(current.payload),
      expectedRevision: clientRevision(current.payload),
    });
    staleHandled.add(cloudRecordIdentity(current));
  }
  return { inserts, staleHandled };
}

/**
 * Snapshot writer used only after the capability selected transaction-owned Visit.
 * Visit and Visit-owned Activity stay RPC-owned. Existing Client updates/deletes use CAS.
 */
export async function pushCloudDataWithVisitAuthority(crm: CrmData): Promise<void> {
  const transport = await authenticatedTransport();
  const existing = await fetchCloudRecords(
    transport.config,
    transport.accessToken,
    transport.context.organizationId,
  );
  const next = crmToCloudRecords(crm, transport.context, transport.userId);
  const existingFingerprint = recordsFingerprint(existing);
  const nextFingerprint = recordsFingerprint(next);
  const remoteVersion = latestRemoteVersion(comparableRecords(existing));

  assertRemoteIsSafe(remoteVersion, nextFingerprint, existingFingerprint);
  if (existingFingerprint === nextFingerprint) return;

  const { inserts: clientInserts, staleHandled } = await reconcileClientsWithCas(
    transport.config,
    transport.accessToken,
    existing,
    next,
  );

  const nextNonClients = next.filter((row) => row.entity_type !== 'client');
  const writableNext = nextNonClients.filter((row) => snapshotMayWriteRecord(row, VISIT_TRANSACTION_COMMERCIAL_AUTHORITY));
  await upsertRecords(transport.config, transport.accessToken, [...clientInserts, ...writableNext]);

  const stale = staleCloudRecords(existing, next).filter((row) => (
    !staleHandled.has(cloudRecordIdentity(row))
    && row.entity_type !== 'client'
    && snapshotMayWriteRecord(row, VISIT_TRANSACTION_COMMERCIAL_AUTHORITY)
  ));
  await deleteRecords(transport.config, transport.accessToken, stale);
}

/** Historical modern snapshot writer ownership, exported only for static decision tests. */
export function snapshotOwnsVisitWhenAuthorityOff(): boolean {
  return snapshotMayWriteCommercialEntity('visit', SNAPSHOT_ONLY_COMMERCIAL_AUTHORITY);
}
