import type { TenantScope } from './active-organization.js';
import {
  cloudRecordIdentity,
  cloudRecordsToCrm,
  crmToCloudRecords,
  isSupervisedRecommendationTelemetryPayload,
  staleCloudRecords,
  type CloudRecordRow,
} from './cloud-records.js';
import {
  VISIT_TRANSACTION_COMMERCIAL_AUTHORITY,
  snapshotMayWriteCommercialEntity,
} from './commercial-sync-transition.js';
import type { Client, CrmData } from './models.js';
import { latestRemoteVersion, type SyncSaveToken } from './sync-safety.js';
import { canonicalUuid, normalizeRevision } from './sync-identity.js';
import {
  assertTenantCrmScope,
  assertTenantRemoteIsSafe,
  markTenantCloudSaved,
  tenantFingerprint,
} from './tenant-storage.js';
import {
  TENANT_CLOUD_RESPONSE_MISMATCH,
  parseTenantCloudJson,
  tenantCloudHeaders,
  tenantCloudTransport,
  type TenantCloudTransport,
} from './tenant-cloud-context.js';
import {
  assertTenantRuntimeLeaseCurrent,
  captureTenantRuntimeLease,
  type TenantRuntimeLease,
} from './tenant-runtime.js';
import type {
  ClientSnapshotCasIntent,
  ClientSnapshotCasResult,
  CommercialRecordReference,
  VisitMutationIntent,
  VisitMutationResult,
} from './visit-transaction-contract.js';

export const TENANT_VISIT_CAPABILITY_INDETERMINATE = 'TENANT_VISIT_CAPABILITY_INDETERMINATE';
export const TENANT_V2_ORGANIZATION_MISMATCH = 'TENANT_V2_ORGANIZATION_MISMATCH';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function assertResponseOrganization(scope: TenantScope, organizationId: unknown): void {
  if (organizationId !== scope.organizationId) {
    throw new Error(TENANT_V2_ORGANIZATION_MISMATCH);
  }
}

async function rpcWithTransport(
  transport: TenantCloudTransport,
  runtimeLease: TenantRuntimeLease,
  name: string,
  payload: unknown,
): Promise<unknown> {
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  const response = await fetch(`${transport.config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
    body: JSON.stringify(payload),
  });
  const result = await parseTenantCloudJson(response);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  return result;
}

async function transportFor(
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
): Promise<TenantCloudTransport> {
  const transport = await tenantCloudTransport(scope);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  if (
    transport.scope.organizationId !== scope.organizationId
    || transport.scope.userId !== scope.userId
    || transport.context.organizationId !== scope.organizationId
  ) {
    throw new Error(TENANT_CLOUD_RESPONSE_MISMATCH);
  }
  return transport;
}

export async function visitTransactionAuthorityActiveV2(
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease = captureTenantRuntimeLease(scope),
): Promise<boolean> {
  const transport = await transportFor(scope, runtimeLease);
  const payload = await rpcWithTransport(
    transport,
    runtimeLease,
    'visit_transaction_authority_active_v2',
    { p_organization_id: scope.organizationId },
  );
  if (typeof payload !== 'boolean') {
    throw new Error(TENANT_VISIT_CAPABILITY_INDETERMINATE);
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

function assertVisitMutationResult(
  scope: TenantScope,
  payload: unknown,
  intent: VisitMutationIntent,
): VisitMutationResult {
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
    throw new Error('La RPC V2 de Visit devolvió un agregado autoritativo inválido.');
  }
  assertResponseOrganization(scope, value.organizationId);
  return payload as VisitMutationResult;
}

export async function invokeVisitTransactionV2(
  scope: TenantScope,
  intent: VisitMutationIntent,
  runtimeLease: TenantRuntimeLease = captureTenantRuntimeLease(scope),
): Promise<VisitMutationResult> {
  const transport = await transportFor(scope, runtimeLease);
  const payload = await rpcWithTransport(
    transport,
    runtimeLease,
    'commercial_visit_mutation_v2',
    {
      p_organization_id: scope.organizationId,
      p_operation_id: intent.operationId,
      p_operation_type: intent.operationType,
      p_request: mutationRequest(intent),
      p_force_rollback: false,
    },
  );
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  return assertVisitMutationResult(scope, payload, intent);
}

async function clientSnapshotCasWithTransport(
  scope: TenantScope,
  transport: TenantCloudTransport,
  runtimeLease: TenantRuntimeLease,
  intent: ClientSnapshotCasIntent,
): Promise<ClientSnapshotCasResult> {
  const payload = await rpcWithTransport(
    transport,
    runtimeLease,
    'client_snapshot_cas_v2',
    {
      p_organization_id: scope.organizationId,
      p_request: intent,
      p_force_rollback: false,
    },
  );
  const value = record(payload);
  if (
    value?.success !== true
    || value.action !== intent.action
    || typeof value.organizationId !== 'string'
    || typeof value.serverTimestamp !== 'string'
  ) {
    throw new Error('Client snapshot CAS V2 devolvió una respuesta inválida.');
  }
  assertResponseOrganization(scope, value.organizationId);
  return payload as ClientSnapshotCasResult;
}

export async function invokeClientSnapshotCasV2(
  scope: TenantScope,
  intent: ClientSnapshotCasIntent,
  runtimeLease: TenantRuntimeLease = captureTenantRuntimeLease(scope),
): Promise<ClientSnapshotCasResult> {
  const transport = await transportFor(scope, runtimeLease);
  const result = await clientSnapshotCasWithTransport(scope, transport, runtimeLease, intent);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  return result;
}

function assertRowsTenant(scope: TenantScope, rows: readonly CloudRecordRow[]): void {
  if (rows.some((row) => row.organization_id !== scope.organizationId)) {
    throw new Error(TENANT_CLOUD_RESPONSE_MISMATCH);
  }
}

function isVisitOwnedActivity(row: CloudRecordRow): boolean {
  return row.entity_type === 'activity' && record(row.payload)?.transactionOwner === 'visit';
}

function snapshotMayWriteRecord(row: CloudRecordRow): boolean {
  if (row.entity_type === 'visit') {
    return snapshotMayWriteCommercialEntity('visit', VISIT_TRANSACTION_COMMERCIAL_AUTHORITY);
  }
  if (isVisitOwnedActivity(row)) return false;
  return true;
}

function crmSyncRecords(records: readonly CloudRecordRow[]): CloudRecordRow[] {
  return records.filter((row) => !isSupervisedRecommendationTelemetryPayload(row.payload));
}

function recordsFingerprint(records: readonly CloudRecordRow[]): string {
  return tenantFingerprint(crmSyncRecords(records)
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
  return tenantFingerprint({
    assigned_member_id: row.assigned_member_id,
    payload: row.payload,
  });
}

function remoteComparableCrm(crm: CrmData): unknown {
  const comparable = structuredClone(crm) as unknown as Record<string, unknown>;
  const organization = comparable.organization as Record<string, unknown> | undefined;
  if (organization) delete organization.id;
  comparable.teamMembers = [];
  ['clients', 'properties', 'visits', 'offers', 'reservations', 'contacts', 'reminders', 'fichas', 'conversations'].forEach((key) => {
    const items = comparable[key];
    if (!Array.isArray(items)) return;
    items.forEach((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      const itemRecord = item as Record<string, unknown>;
      delete itemRecord.assignedToId;
      delete itemRecord.createdById;
      if (key === 'clients') {
        delete itemRecord.revision;
        delete itemRecord.operationId;
      }
    });
    items.sort((left, right) => Number((left as Record<string, unknown>)?.id ?? 0) - Number((right as Record<string, unknown>)?.id ?? 0));
  });
  const activity = comparable.activityLog;
  if (Array.isArray(activity)) {
    activity.forEach((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      delete (item as Record<string, unknown>).actorId;
    });
    activity.sort((left, right) => Number((left as Record<string, unknown>)?.id ?? 0) - Number((right as Record<string, unknown>)?.id ?? 0));
  }
  return comparable;
}

async function fetchCloudRecords(
  scope: TenantScope,
  transport: TenantCloudTransport,
  runtimeLease: TenantRuntimeLease,
): Promise<CloudRecordRow[]> {
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  const query = new URL(`${transport.config.url}/rest/v1/propcontrol_records`);
  query.searchParams.set('select', 'organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,updated_at');
  query.searchParams.set('organization_id', `eq.${scope.organizationId}`);
  query.searchParams.set('order', 'entity_type.asc,entity_key.asc');
  const payload = await parseTenantCloudJson(await fetch(query, {
    headers: tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
    cache: 'no-store',
  }));
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  if (!Array.isArray(payload)) throw new Error(TENANT_CLOUD_RESPONSE_MISMATCH);
  const rows = payload as CloudRecordRow[];
  assertRowsTenant(scope, rows);
  return rows;
}

async function upsertRecords(
  scope: TenantScope,
  transport: TenantCloudTransport,
  runtimeLease: TenantRuntimeLease,
  records: CloudRecordRow[],
): Promise<void> {
  assertRowsTenant(scope, records);
  for (let index = 0; index < records.length; index += 100) {
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    const chunk = records.slice(index, index + 100);
    if (!chunk.length) continue;
    const target = new URL(`${transport.config.url}/rest/v1/propcontrol_records`);
    target.searchParams.set('on_conflict', 'organization_id,entity_type,entity_key');
    await parseTenantCloudJson(await fetch(target, {
      method: 'POST',
      headers: {
        ...tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    }));
    assertTenantRuntimeLeaseCurrent(runtimeLease);
  }
}

async function deleteRecords(
  scope: TenantScope,
  transport: TenantCloudTransport,
  runtimeLease: TenantRuntimeLease,
  rows: CloudRecordRow[],
): Promise<void> {
  assertRowsTenant(scope, rows);
  const grouped = new Map<string, string[]>();
  rows.forEach((row) => {
    const keys = grouped.get(row.entity_type) ?? [];
    keys.push(row.entity_key);
    grouped.set(row.entity_type, keys);
  });
  for (const [entityType, keys] of grouped) {
    for (let index = 0; index < keys.length; index += 100) {
      assertTenantRuntimeLeaseCurrent(runtimeLease);
      const target = new URL(`${transport.config.url}/rest/v1/propcontrol_records`);
      target.searchParams.set('organization_id', `eq.${scope.organizationId}`);
      target.searchParams.set('entity_type', `eq.${entityType}`);
      target.searchParams.set('entity_key', `in.(${keys.slice(index, index + 100).map((key) => `"${key.replaceAll('"', '')}"`).join(',')})`);
      await parseTenantCloudJson(await fetch(target, {
        method: 'DELETE',
        headers: {
          ...tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
          Prefer: 'return=minimal',
        },
      }));
      assertTenantRuntimeLeaseCurrent(runtimeLease);
    }
  }
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

function clientPayload(row: CloudRecordRow): Client {
  const value = record(row.payload);
  if (!value || !Number.isSafeInteger(Number(value.id))) {
    throw new Error('Client snapshot inválido para CAS.');
  }
  return structuredClone(value) as unknown as Client;
}

async function reconcileClientsWithCas(
  scope: TenantScope,
  transport: TenantCloudTransport,
  runtimeLease: TenantRuntimeLease,
  existing: CloudRecordRow[],
  next: CloudRecordRow[],
): Promise<{ inserts: CloudRecordRow[]; staleHandled: Set<string> }> {
  const existingClients = new Map(existing
    .filter((row) => row.entity_type === 'client')
    .map((row) => [cloudRecordIdentity(row), row]));
  const nextClients = next.filter((row) => row.entity_type === 'client');
  const inserts: CloudRecordRow[] = [];

  for (const nextRow of nextClients) {
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    const identity = cloudRecordIdentity(nextRow);
    const current = existingClients.get(identity);
    if (!current) {
      inserts.push(nextRow);
      continue;
    }
    if (rowFingerprint(current) === rowFingerprint(nextRow)) continue;
    let assignedMemberId: number | undefined;
    if (current.assigned_member_id !== nextRow.assigned_member_id) {
      const targetMemberId = nextRow.assigned_member_id;
      if (typeof targetMemberId !== 'number' || !Number.isSafeInteger(targetMemberId) || targetMemberId <= 0) {
        throw new Error('La reasignación de Client requiere un member id positivo válido.');
      }
      assignedMemberId = targetMemberId;
    }
    await clientSnapshotCasWithTransport(scope, transport, runtimeLease, {
      action: 'update',
      client: clientReference(current.payload),
      expectedRevision: clientRevision(current.payload),
      payload: clientPayload(nextRow),
      ...(assignedMemberId === undefined ? {} : { assignedMemberId }),
    });
  }

  const staleHandled = new Set<string>();
  const staleClients = staleCloudRecords(existing, next).filter((row) => row.entity_type === 'client');
  for (const current of staleClients) {
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    await clientSnapshotCasWithTransport(scope, transport, runtimeLease, {
      action: 'delete',
      client: clientReference(current.payload),
      expectedRevision: clientRevision(current.payload),
    });
    staleHandled.add(cloudRecordIdentity(current));
  }
  return { inserts, staleHandled };
}

export async function pushCloudDataWithVisitAuthorityV2(
  scope: TenantScope,
  crm: CrmData,
  token: SyncSaveToken,
  runtimeLease: TenantRuntimeLease = captureTenantRuntimeLease(scope),
): Promise<CrmData> {
  assertTenantCrmScope(scope, crm);
  const transport = await transportFor(scope, runtimeLease);
  const existing = await fetchCloudRecords(scope, transport, runtimeLease);
  const next = crmToCloudRecords(crm, transport.context, scope.userId);
  assertRowsTenant(scope, next);

  const existingFingerprint = recordsFingerprint(existing);
  const nextFingerprint = recordsFingerprint(next);
  const remoteVersion = latestRemoteVersion(crmSyncRecords(existing));
  assertTenantRemoteIsSafe(scope, remoteVersion, nextFingerprint, existingFingerprint);

  if (existingFingerprint !== nextFingerprint) {
    const { inserts: clientInserts, staleHandled } = await reconcileClientsWithCas(
      scope,
      transport,
      runtimeLease,
      existing,
      next,
    );
    assertTenantRuntimeLeaseCurrent(runtimeLease);

    const writableNonClients = next
      .filter((row) => row.entity_type !== 'client')
      .filter(snapshotMayWriteRecord);
    await upsertRecords(scope, transport, runtimeLease, [...clientInserts, ...writableNonClients]);

    const stale = staleCloudRecords(existing, next).filter((row) => (
      !staleHandled.has(cloudRecordIdentity(row))
      && row.entity_type !== 'client'
      && snapshotMayWriteRecord(row)
    ));
    await deleteRecords(scope, transport, runtimeLease, stale);
  }

  const refreshed = await fetchCloudRecords(scope, transport, runtimeLease);
  const verified = cloudRecordsToCrm(crmSyncRecords(refreshed), transport.context, crm);
  assertTenantCrmScope(scope, verified);
  assertTenantRuntimeLeaseCurrent(runtimeLease);

  if (tenantFingerprint(remoteComparableCrm(verified)) !== tenantFingerprint(remoteComparableCrm(crm))) {
    throw new Error('La verificación remota V2 no coincide con el snapshot tenant que PropControl intentó guardar.');
  }

  assertTenantRuntimeLeaseCurrent(runtimeLease);
  markTenantCloudSaved(scope, latestRemoteVersion(crmSyncRecords(refreshed)), token);
  return structuredClone(verified);
}
