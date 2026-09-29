import type { TenantScope } from './active-organization.js';
import { PRODUCT_BRAND } from './branding.js';
import {
  cloudRecordIdentity,
  cloudRecordsToCrm,
  crmToCloudRecords,
  isSupervisedRecommendationTelemetryPayload,
  type CloudEntityType,
  type CloudRecordRow,
} from './cloud-records.js';
import {
  SNAPSHOT_ONLY_COMMERCIAL_AUTHORITY,
  VISIT_TRANSACTION_COMMERCIAL_AUTHORITY,
  snapshotMayWriteCommercialEntity,
} from './commercial-sync-transition.js';
import type { Client, CrmData } from './models.js';
import {
  concurrencyBaselineMap,
  concurrencyRowFingerprint,
  concurrencyRowIdentity,
  readTenantConcurrencyBaseline,
  writeTenantConcurrencyBaseline,
  type TenantConcurrencyBaselineRow,
} from './tenant-concurrency-baseline.js';
import {
  PROPERTY_SNAPSHOT_CONFLICT,
  TenantRecordConflictError,
  invokePropertySnapshotCasV1,
  propertyPayload,
  propertyRecordReference,
  propertyRevision,
  tenantRecordConflictFrom,
} from './tenant-property-cas.js';
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

function snapshotMayWriteRecord(
  row: CloudRecordRow,
  visitAuthorityActive: boolean,
): boolean {
  const authority = visitAuthorityActive
    ? VISIT_TRANSACTION_COMMERCIAL_AUTHORITY
    : SNAPSHOT_ONLY_COMMERCIAL_AUTHORITY;
  if (row.entity_type === 'visit') {
    return snapshotMayWriteCommercialEntity('visit', authority);
  }
  if (isVisitOwnedActivity(row)) return !visitAuthorityActive;
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

function casComparableFingerprint(row: Pick<CloudRecordRow, 'assigned_member_id' | 'payload'>): string {
  const payload = structuredClone(row.payload);
  const value = record(payload);
  if (value) {
    delete value.revision;
    delete value.operationId;
  }
  return tenantFingerprint({
    assigned_member_id: row.assigned_member_id,
    payload,
  });
}

function rowMap(rows: readonly Pick<CloudRecordRow, 'entity_type' | 'entity_key'>[]): Map<string, typeof rows[number]> {
  return new Map(rows.map((row) => [concurrencyRowIdentity(row), row]));
}

function baselineAsRows(rows: readonly TenantConcurrencyBaselineRow[]): CloudRecordRow[] {
  return rows.map((row) => ({
    organization_id: row.organization_id,
    entity_type: row.entity_type,
    entity_key: row.entity_key,
    assigned_member_id: row.assigned_member_id,
    payload: structuredClone(row.payload),
  }));
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

async function insertRecordsIgnoreDuplicates(
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
        Prefer: 'resolution=ignore-duplicates,return=minimal',
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

type ProtectedReconcileResult = Readonly<{
  inserts: CloudRecordRow[];
  touched: Set<string>;
}>;

function positiveAssignedMemberId(row: Pick<CloudRecordRow, 'assigned_member_id'>, label: string): number {
  const memberId = row.assigned_member_id;
  if (typeof memberId !== 'number' || !Number.isSafeInteger(memberId) || memberId <= 0) {
    throw new Error(`${label} requiere un member id positivo válido.`);
  }
  return memberId;
}

async function reconcileClientsWithCas(
  scope: TenantScope,
  transport: TenantCloudTransport,
  runtimeLease: TenantRuntimeLease,
  existing: CloudRecordRow[],
  next: CloudRecordRow[],
  baseline: readonly TenantConcurrencyBaselineRow[],
): Promise<ProtectedReconcileResult> {
  const baselineClients = concurrencyBaselineMap(baseline, 'client');
  const existingClients = new Map(existing
    .filter((row) => row.entity_type === 'client')
    .map((row) => [concurrencyRowIdentity(row), row] as const));
  const nextClients = new Map(next
    .filter((row) => row.entity_type === 'client')
    .map((row) => [concurrencyRowIdentity(row), row] as const));
  const identities = new Set([...baselineClients.keys(), ...nextClients.keys()]);
  const inserts: CloudRecordRow[] = [];
  const touched = new Set<string>();

  for (const identity of [...identities].sort()) {
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    const base = baselineClients.get(identity);
    const local = nextClients.get(identity);
    const remote = existingClients.get(identity);

    if (!base && local) {
      if (remote) {
        if (casComparableFingerprint(remote) === casComparableFingerprint(local)) continue;
        throw new TenantRecordConflictError('client', PROPERTY_SNAPSHOT_CONFLICT);
      }
      inserts.push(local);
      touched.add(identity);
      continue;
    }
    if (!base) continue;

    if (!local) {
      try {
        await clientSnapshotCasWithTransport(scope, transport, runtimeLease, {
          action: 'delete',
          client: clientReference(base.payload),
          expectedRevision: clientRevision(base.payload),
        });
      } catch (error) {
        const conflict = tenantRecordConflictFrom(error, 'client');
        if (conflict) throw conflict;
        throw error;
      }
      touched.add(identity);
      continue;
    }

    if (concurrencyRowFingerprint(base) === concurrencyRowFingerprint(local)) continue;

    let assignedMemberId: number | undefined;
    if (base.assigned_member_id !== local.assigned_member_id) {
      assignedMemberId = positiveAssignedMemberId(local, 'La reasignación de Client');
    }
    try {
      await clientSnapshotCasWithTransport(scope, transport, runtimeLease, {
        action: 'update',
        client: clientReference(base.payload),
        expectedRevision: clientRevision(base.payload),
        payload: clientPayload(local),
        ...(assignedMemberId === undefined ? {} : { assignedMemberId }),
      });
    } catch (error) {
      const conflict = tenantRecordConflictFrom(error, 'client');
      if (conflict) throw conflict;
      throw error;
    }
    touched.add(identity);
  }

  return { inserts, touched };
}

async function reconcilePropertiesWithCas(
  scope: TenantScope,
  transport: TenantCloudTransport,
  runtimeLease: TenantRuntimeLease,
  existing: CloudRecordRow[],
  next: CloudRecordRow[],
  baseline: readonly TenantConcurrencyBaselineRow[],
): Promise<ProtectedReconcileResult> {
  const baselineProperties = concurrencyBaselineMap(baseline, 'property');
  const existingProperties = new Map(existing
    .filter((row) => row.entity_type === 'property')
    .map((row) => [concurrencyRowIdentity(row), row] as const));
  const nextProperties = new Map(next
    .filter((row) => row.entity_type === 'property')
    .map((row) => [concurrencyRowIdentity(row), row] as const));
  const identities = new Set([...baselineProperties.keys(), ...nextProperties.keys()]);
  const inserts: CloudRecordRow[] = [];
  const touched = new Set<string>();

  for (const identity of [...identities].sort()) {
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    const base = baselineProperties.get(identity);
    const local = nextProperties.get(identity);
    const remote = existingProperties.get(identity);

    if (!base && local) {
      if (remote) {
        if (casComparableFingerprint(remote) === casComparableFingerprint(local)) continue;
        throw new TenantRecordConflictError('property', PROPERTY_SNAPSHOT_CONFLICT);
      }
      // Insert nuevo: la PK tenant+entity+key y resolution=ignore-duplicates
      // hacen el alta atómica sin permitir merge last-write-wins. La verificación
      // posterior exige que el remoto coincida; una colisión distinta falla cerrado.
      inserts.push(local);
      touched.add(identity);
      continue;
    }
    if (!base) continue;

    if (!local) {
      await invokePropertySnapshotCasV1(scope, {
        action: 'delete',
        property: propertyRecordReference(base.payload),
        expectedRevision: propertyRevision(base.payload),
      }, runtimeLease, transport);
      touched.add(identity);
      continue;
    }

    if (concurrencyRowFingerprint(base) === concurrencyRowFingerprint(local)) continue;

    const assignedMemberId = base.assigned_member_id === local.assigned_member_id
      ? undefined
      : positiveAssignedMemberId(local, 'La reasignación de Property');

    await invokePropertySnapshotCasV1(scope, {
      action: 'update',
      property: propertyRecordReference(base.payload),
      expectedRevision: propertyRevision(base.payload),
      payload: propertyPayload(local.payload),
      ...(assignedMemberId === undefined ? {} : { assignedMemberId }),
    }, runtimeLease, transport);
    touched.add(identity);
  }

  return { inserts, touched };
}

type GenericDelta = Readonly<{
  inserts: CloudRecordRow[];
  upserts: CloudRecordRow[];
  deletes: CloudRecordRow[];
  touched: Set<string>;
}>;

function commercialAlertSemanticPayload(row: CloudRecordRow): Record<string, unknown> | null {
  if (row.entity_type !== 'commercial_alert') return null;
  const payload = record(row.payload);
  if (!payload) return null;
  const {
    id: _id,
    revision: _revision,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    resolvedAt: _resolvedAt,
    dismissedAt: _dismissedAt,
    ...semantic
  } = payload;
  return semantic;
}

export function commercialAlertConcurrentWriteAlreadySatisfied(
  local: CloudRecordRow,
  remote: CloudRecordRow,
): boolean {
  if (
    local.entity_type !== 'commercial_alert'
    || remote.entity_type !== 'commercial_alert'
    || local.organization_id !== remote.organization_id
    || local.entity_key !== remote.entity_key
  ) return false;
  const localPayload = commercialAlertSemanticPayload(local);
  const remotePayload = commercialAlertSemanticPayload(remote);
  if (!localPayload || !remotePayload) return false;
  const localState = String(localPayload.state ?? '');
  const remoteState = String(remotePayload.state ?? '');
  if (
    localState !== remoteState
    || !['ACTIVE', 'RESOLVED', 'DISMISSED'].includes(localState)
  ) return false;
  return tenantFingerprint(localPayload) === tenantFingerprint(remotePayload);
}

function genericWritable(
  row: Pick<CloudRecordRow, 'entity_type' | 'payload'>,
  visitAuthorityActive: boolean,
): boolean {
  if (row.entity_type === 'client' || row.entity_type === 'property') return false;
  return snapshotMayWriteRecord(row as CloudRecordRow, visitAuthorityActive);
}

function genericDelta(
  baseline: readonly TenantConcurrencyBaselineRow[],
  existing: CloudRecordRow[],
  next: CloudRecordRow[],
  visitAuthorityActive: boolean,
): GenericDelta {
  const writable = (row: CloudRecordRow) => genericWritable(row, visitAuthorityActive);
  const baseRows = baselineAsRows(baseline).filter(writable);
  const remoteRows = existing.filter(writable);
  const localRows = next.filter(writable);
  const baseMap = new Map(baseRows.map((row) => [concurrencyRowIdentity(row), row] as const));
  const remoteMap = new Map(remoteRows.map((row) => [concurrencyRowIdentity(row), row] as const));
  const localMap = new Map(localRows.map((row) => [concurrencyRowIdentity(row), row] as const));
  const identities = new Set([...baseMap.keys(), ...localMap.keys()]);
  const inserts: CloudRecordRow[] = [];
  const upserts: CloudRecordRow[] = [];
  const deletes: CloudRecordRow[] = [];
  const touched = new Set<string>();

  for (const identity of [...identities].sort()) {
    const base = baseMap.get(identity);
    const local = localMap.get(identity);
    const remote = remoteMap.get(identity);

    if (!base && local) {
      if (
        remote
        && concurrencyRowFingerprint(remote) !== concurrencyRowFingerprint(local)
        && !commercialAlertConcurrentWriteAlreadySatisfied(local, remote)
      ) {
        throw new Error('GENERIC_RECORD_CONFLICT');
      }
      if (!remote) inserts.push(local);
      if (!remote) touched.add(identity);
      continue;
    }
    if (!base) continue;

    if (!local) {
      if (!remote) continue;
      if (concurrencyRowFingerprint(remote) !== concurrencyRowFingerprint(base)) {
        throw new Error('GENERIC_RECORD_CONFLICT');
      }
      deletes.push(remote);
      touched.add(identity);
      continue;
    }

    if (concurrencyRowFingerprint(base) === concurrencyRowFingerprint(local)) continue;
    if (!remote) throw new Error('GENERIC_RECORD_CONFLICT');
    if (concurrencyRowFingerprint(remote) !== concurrencyRowFingerprint(base)) {
      if (commercialAlertConcurrentWriteAlreadySatisfied(local, remote)) continue;
      throw new Error('GENERIC_RECORD_CONFLICT');
    }
    upserts.push(local);
    touched.add(identity);
  }

  return { inserts, upserts, deletes, touched };
}

function assertProtectedVerification(
  entityType: 'client' | 'property',
  touched: ReadonlySet<string>,
  next: readonly CloudRecordRow[],
  refreshed: readonly CloudRecordRow[],
): void {
  const localMap = new Map(next
    .filter((row) => row.entity_type === entityType)
    .map((row) => [concurrencyRowIdentity(row), row] as const));
  const remoteMap = new Map(refreshed
    .filter((row) => row.entity_type === entityType)
    .map((row) => [concurrencyRowIdentity(row), row] as const));

  for (const identity of touched) {
    const local = localMap.get(identity);
    const remote = remoteMap.get(identity);
    if (!local) {
      if (remote) throw new Error(`${entityType.toUpperCase()}_DELETE_VERIFICATION_FAILED`);
      continue;
    }
    if (!remote || casComparableFingerprint(remote) !== casComparableFingerprint(local)) {
      throw new TenantRecordConflictError(entityType, PROPERTY_SNAPSHOT_CONFLICT);
    }
  }
}

function assertGenericVerification(
  delta: GenericDelta,
  next: readonly CloudRecordRow[],
  refreshed: readonly CloudRecordRow[],
): void {
  const localMap = new Map(next.map((row) => [concurrencyRowIdentity(row), row] as const));
  const remoteMap = new Map(refreshed.map((row) => [concurrencyRowIdentity(row), row] as const));
  for (const identity of delta.touched) {
    const local = localMap.get(identity);
    const remote = remoteMap.get(identity);
    if (!local) {
      if (remote) throw new Error('GENERIC_DELETE_VERIFICATION_FAILED');
      continue;
    }
    if (!remote || concurrencyRowFingerprint(remote) !== concurrencyRowFingerprint(local)) {
      throw new Error('GENERIC_WRITE_VERIFICATION_FAILED');
    }
  }
}

export async function pushCloudDataWithVisitAuthorityV2(
  scope: TenantScope,
  crm: CrmData,
  token: SyncSaveToken,
  runtimeLease: TenantRuntimeLease = captureTenantRuntimeLease(scope),
  visitAuthorityActive = true,
): Promise<CrmData> {
  assertTenantCrmScope(scope, crm);
  const transport = await transportFor(scope, runtimeLease);
  const existing = await fetchCloudRecords(scope, transport, runtimeLease);
  const next = crmToCloudRecords(crm, transport.context, scope.userId);
  assertRowsTenant(scope, next);

  const existingFingerprint = recordsFingerprint(existing);
  const nextFingerprint = recordsFingerprint(next);
  const remoteVersion = latestRemoteVersion(crmSyncRecords(existing));
  const storedBaseline = readTenantConcurrencyBaseline(scope);
  const baseline = storedBaseline ?? crmSyncRecords(existing).map((row) => ({
    organization_id: row.organization_id,
    entity_type: row.entity_type,
    entity_key: row.entity_key,
    assigned_member_id: row.assigned_member_id,
    payload: structuredClone(row.payload),
  }));

  // Upgrade bootstrap: sin baseline persistida todavía, el guard histórico global
  // sigue actuando como barrera fail-closed antes de inferir intención local.
  if (!storedBaseline && existingFingerprint !== nextFingerprint) {
    assertTenantRemoteIsSafe(scope, remoteVersion, nextFingerprint, existingFingerprint);
  }

  // Client y Property siempre pasan por CAS. La capability de Visit sólo decide
  // si Visit/Activity visit-owned quedan bajo RPC transaccional o snapshot histórico.
  const generic = genericDelta(baseline, existing, next, visitAuthorityActive);

  const clients = await reconcileClientsWithCas(
    scope,
    transport,
    runtimeLease,
    existing,
    next,
    baseline,
  );
  assertTenantRuntimeLeaseCurrent(runtimeLease);

  const properties = await reconcilePropertiesWithCas(
    scope,
    transport,
    runtimeLease,
    existing,
    next,
    baseline,
  );
  assertTenantRuntimeLeaseCurrent(runtimeLease);

  const newRecordInserts = [...clients.inserts, ...properties.inserts, ...generic.inserts];
  if (newRecordInserts.length) {
    await insertRecordsIgnoreDuplicates(scope, transport, runtimeLease, newRecordInserts);
  }
  if (generic.upserts.length) {
    await upsertRecords(scope, transport, runtimeLease, generic.upserts);
  }
  if (generic.deletes.length) {
    await deleteRecords(scope, transport, runtimeLease, generic.deletes);
  }

  const refreshed = await fetchCloudRecords(scope, transport, runtimeLease);
  assertRowsTenant(scope, refreshed);
  assertProtectedVerification('client', clients.touched, next, refreshed);
  assertProtectedVerification('property', properties.touched, next, refreshed);
  assertGenericVerification(generic, next, refreshed);

  const verified = cloudRecordsToCrm(crmSyncRecords(refreshed), transport.context, crm);
  assertTenantCrmScope(scope, verified);
  assertTenantRuntimeLeaseCurrent(runtimeLease);

  writeTenantConcurrencyBaseline(scope, crmSyncRecords(refreshed));
  markTenantCloudSaved(scope, latestRemoteVersion(crmSyncRecords(refreshed)), token);
  return structuredClone(verified);
}
