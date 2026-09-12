import type { TenantScope } from './active-organization.js';
import {
  cloudRecordsToCrm,
  crmToCloudRecords,
  isSupervisedRecommendationTelemetryPayload,
  staleCloudRecords,
  type CloudRecordRow,
} from './cloud-records.js';
import type { CrmData } from './models.js';
import {
  assertTenantCrmScope,
  assertTenantRemoteIsSafe,
  markTenantCloudHydrated,
  markTenantCloudSaved,
  tenantFingerprint,
  type TenantLegacyMigrationResult,
} from './tenant-storage.js';
import { latestRemoteVersion, type SyncSaveToken } from './sync-safety.js';
import {
  TENANT_CLOUD_RESPONSE_MISMATCH,
  parseTenantCloudJson,
  tenantCloudHeaders,
  tenantCloudTransport,
  type TenantCloudTransport,
} from './tenant-cloud-context.js';
import {
  TENANT_RUNTIME_STALE,
  assertTenantRuntimeLeaseCurrent,
  captureTenantRuntimeLease,
  tenantScopesEqual,
  type TenantRuntimeLease,
} from './tenant-runtime.js';

const SNAPSHOT_SOURCE = 'propcontrol_system_snapshot';

interface LegacySnapshotRow {
  id: string;
  organization_id?: string;
  internal_data?: { crm?: unknown };
  updated_at?: string;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  return String((error as { code?: unknown }).code ?? '').toUpperCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

export function isTenantModernSchemaUnavailable(error: unknown): boolean {
  const code = errorCode(error);
  const message = errorMessage(error).toLowerCase();
  return ['PGRST205', '42P01'].includes(code)
    || (message.includes('propcontrol_records') && (
      message.includes('does not exist')
      || message.includes('schema cache')
      || message.includes('could not find')
    ));
}

function isCrmData(value: unknown): value is CrmData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const crm = value as Partial<CrmData>;
  return Boolean(
    crm.organization
    && typeof crm.organization.id === 'string'
    && Array.isArray(crm.teamMembers)
    && Array.isArray(crm.activityLog)
    && Array.isArray(crm.clients)
    && Array.isArray(crm.properties)
    && Array.isArray(crm.visits)
    && Array.isArray(crm.offers)
    && Array.isArray(crm.reservations)
    && Array.isArray(crm.contacts)
    && Array.isArray(crm.reminders)
    && Array.isArray(crm.fichas)
    && Array.isArray(crm.conversations)
  );
}

function assertRowsTenant(scope: TenantScope, rows: readonly CloudRecordRow[]): void {
  if (rows.some((row) => row.organization_id !== scope.organizationId)) {
    throw new Error(TENANT_CLOUD_RESPONSE_MISMATCH);
  }
}

function assertCloudWriterLease(scope: TenantScope, runtimeLease: TenantRuntimeLease): void {
  if (!tenantScopesEqual(scope, runtimeLease.scope)) {
    throw new Error(TENANT_RUNTIME_STALE);
  }
  assertTenantRuntimeLeaseCurrent(runtimeLease);
}

function crmSyncRecords(records: readonly CloudRecordRow[]): CloudRecordRow[] {
  return records.filter((record) => !isSupervisedRecommendationTelemetryPayload(record.payload));
}

function recordsFingerprint(records: readonly CloudRecordRow[]): string {
  return tenantFingerprint(crmSyncRecords(records)
    .map((record) => ({
      organization_id: record.organization_id,
      entity_type: record.entity_type,
      entity_key: record.entity_key,
      assigned_member_id: record.assigned_member_id,
      payload: record.payload,
    }))
    .sort((left, right) => `${left.entity_type}:${left.entity_key}`.localeCompare(`${right.entity_type}:${right.entity_key}`)));
}

async function fetchCloudRecords(
  transport: TenantCloudTransport,
  runtimeLease?: TenantRuntimeLease,
): Promise<CloudRecordRow[]> {
  if (runtimeLease) assertCloudWriterLease(transport.scope, runtimeLease);
  const query = new URL(`${transport.config.url}/rest/v1/propcontrol_records`);
  query.searchParams.set('select', 'organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,updated_at');
  query.searchParams.set('organization_id', `eq.${transport.scope.organizationId}`);
  query.searchParams.set('order', 'entity_type.asc,entity_key.asc');
  const response = await fetch(query, {
    method: 'GET',
    headers: tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
    cache: 'no-store',
  });
  if (runtimeLease) assertCloudWriterLease(transport.scope, runtimeLease);
  const payload = await parseTenantCloudJson(response);
  if (runtimeLease) assertCloudWriterLease(transport.scope, runtimeLease);
  if (!Array.isArray(payload)) throw new Error(TENANT_CLOUD_RESPONSE_MISMATCH);
  const rows = payload as CloudRecordRow[];
  assertRowsTenant(transport.scope, rows);
  return rows;
}

async function upsertRecords(
  transport: TenantCloudTransport,
  records: CloudRecordRow[],
  runtimeLease: TenantRuntimeLease,
): Promise<void> {
  assertRowsTenant(transport.scope, records);
  assertCloudWriterLease(transport.scope, runtimeLease);
  for (let index = 0; index < records.length; index += 100) {
    const chunk = records.slice(index, index + 100);
    if (!chunk.length) continue;
    assertCloudWriterLease(transport.scope, runtimeLease);
    const target = new URL(`${transport.config.url}/rest/v1/propcontrol_records`);
    target.searchParams.set('on_conflict', 'organization_id,entity_type,entity_key');
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        ...tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    assertCloudWriterLease(transport.scope, runtimeLease);
    await parseTenantCloudJson(response);
    assertCloudWriterLease(transport.scope, runtimeLease);
  }
}

export async function insertTenantCloudRecordsIgnoreDuplicates(
  transport: TenantCloudTransport,
  records: readonly CloudRecordRow[],
  runtimeLease: TenantRuntimeLease,
): Promise<void> {
  assertRowsTenant(transport.scope, records);
  assertCloudWriterLease(transport.scope, runtimeLease);
  for (let index = 0; index < records.length; index += 100) {
    const chunk = records.slice(index, index + 100);
    if (!chunk.length) continue;
    assertCloudWriterLease(transport.scope, runtimeLease);
    const target = new URL(`${transport.config.url}/rest/v1/propcontrol_records`);
    target.searchParams.set('on_conflict', 'organization_id,entity_type,entity_key');
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        ...tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    assertCloudWriterLease(transport.scope, runtimeLease);
    await parseTenantCloudJson(response);
    assertCloudWriterLease(transport.scope, runtimeLease);
  }
}

async function deleteStaleRecords(
  transport: TenantCloudTransport,
  stale: CloudRecordRow[],
  runtimeLease: TenantRuntimeLease,
): Promise<void> {
  assertRowsTenant(transport.scope, stale);
  assertCloudWriterLease(transport.scope, runtimeLease);
  const grouped = new Map<string, string[]>();
  stale.forEach((record) => {
    const keys = grouped.get(record.entity_type) ?? [];
    keys.push(record.entity_key);
    grouped.set(record.entity_type, keys);
  });
  for (const [entityType, keys] of grouped) {
    for (let index = 0; index < keys.length; index += 100) {
      assertCloudWriterLease(transport.scope, runtimeLease);
      const target = new URL(`${transport.config.url}/rest/v1/propcontrol_records`);
      target.searchParams.set('organization_id', `eq.${transport.scope.organizationId}`);
      target.searchParams.set('entity_type', `eq.${entityType}`);
      target.searchParams.set('entity_key', `in.(${keys.slice(index, index + 100).map((key) => `"${key.replaceAll('"', '')}"`).join(',')})`);
      const response = await fetch(target, {
        method: 'DELETE',
        headers: {
          ...tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
          Prefer: 'return=minimal',
        },
      });
      assertCloudWriterLease(transport.scope, runtimeLease);
      await parseTenantCloudJson(response);
      assertCloudWriterLease(transport.scope, runtimeLease);
    }
  }
}

async function tenantLegacySnapshotRow(
  transport: TenantCloudTransport,
  runtimeLease?: TenantRuntimeLease,
): Promise<LegacySnapshotRow | null> {
  if (runtimeLease) assertCloudWriterLease(transport.scope, runtimeLease);
  const query = new URL(`${transport.config.url}/rest/v1/fichas`);
  query.searchParams.set('select', 'id,organization_id,internal_data,updated_at');
  query.searchParams.set('organization_id', `eq.${transport.scope.organizationId}`);
  query.searchParams.set('source', `eq.${SNAPSHOT_SOURCE}`);
  query.searchParams.set('order', 'updated_at.desc');
  query.searchParams.set('limit', '1');
  const response = await fetch(query, {
    method: 'GET',
    headers: tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
    cache: 'no-store',
  });
  if (runtimeLease) assertCloudWriterLease(transport.scope, runtimeLease);
  const payload = await parseTenantCloudJson(response);
  if (runtimeLease) assertCloudWriterLease(transport.scope, runtimeLease);
  if (!Array.isArray(payload)) throw new Error(TENANT_CLOUD_RESPONSE_MISMATCH);
  const row = (payload as LegacySnapshotRow[])[0] ?? null;
  if (!row) return null;
  if (row.organization_id !== transport.scope.organizationId) {
    throw new Error(TENANT_CLOUD_RESPONSE_MISMATCH);
  }
  const crm = row.internal_data?.crm;
  if (crm !== undefined && crm !== null) {
    if (!isCrmData(crm)) throw new Error(TENANT_CLOUD_RESPONSE_MISMATCH);
    assertTenantCrmScope(transport.scope, crm);
  }
  return row;
}

export async function pullTenantLegacyCloudData(
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease = captureTenantRuntimeLease(scope),
): Promise<CrmData | null> {
  const transport = await tenantCloudTransport(scope);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  const row = await tenantLegacySnapshotRow(transport);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  const crm = row?.internal_data?.crm;
  if (!isCrmData(crm)) {
    markTenantCloudHydrated(scope, row?.updated_at || null);
    return null;
  }
  assertTenantCrmScope(scope, crm);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  markTenantCloudHydrated(scope, row?.updated_at || null, tenantFingerprint(crm));
  return structuredClone(crm);
}

export async function pullTenantCloudData(
  scope: TenantScope,
  fallback: CrmData,
  runtimeLease: TenantRuntimeLease = captureTenantRuntimeLease(scope),
): Promise<CrmData | null> {
  const transport = await tenantCloudTransport(scope);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  try {
    const records = await fetchCloudRecords(transport);
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    const crmRecords = crmSyncRecords(records);
    if (crmRecords.length) {
      const crm = cloudRecordsToCrm(crmRecords, transport.context, fallback);
      assertTenantCrmScope(scope, crm);
      assertTenantRuntimeLeaseCurrent(runtimeLease);
      markTenantCloudHydrated(scope, latestRemoteVersion(crmRecords));
      return crm;
    }

    if (transport.context.currentRole !== 'Corredor') {
      const legacy = await tenantLegacySnapshotRow(transport);
      assertTenantRuntimeLeaseCurrent(runtimeLease);
      const legacyCrm = legacy?.internal_data?.crm;
      if (isCrmData(legacyCrm)) {
        assertTenantCrmScope(scope, legacyCrm);
        const crm = { ...structuredClone(legacyCrm), teamMembers: transport.context.members };
        assertTenantCrmScope(scope, crm);
        assertTenantRuntimeLeaseCurrent(runtimeLease);
        markTenantCloudHydrated(scope, legacy?.updated_at || null, tenantFingerprint(crm));
        return crm;
      }
      markTenantCloudHydrated(scope, null);
      return null;
    }

    const crm = cloudRecordsToCrm([], transport.context, fallback);
    assertTenantCrmScope(scope, crm);
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    markTenantCloudHydrated(scope, null);
    return crm;
  } catch (error) {
    if (!isTenantModernSchemaUnavailable(error)) throw error;
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    if (transport.context.currentRole === 'Corredor') {
      throw new Error('La seguridad multiusuario todavía no fue activada en Supabase.');
    }
    const legacy = await tenantLegacySnapshotRow(transport);
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    const crm = legacy?.internal_data?.crm;
    if (!isCrmData(crm)) {
      markTenantCloudHydrated(scope, legacy?.updated_at || null);
      return null;
    }
    assertTenantCrmScope(scope, crm);
    assertTenantRuntimeLeaseCurrent(runtimeLease);
    markTenantCloudHydrated(scope, legacy?.updated_at || null, tenantFingerprint(crm));
    return structuredClone(crm);
  }
}

export async function pushTenantModernCloudData(
  scope: TenantScope,
  crm: CrmData,
  token: SyncSaveToken,
  runtimeLease: TenantRuntimeLease,
): Promise<void> {
  assertTenantCrmScope(scope, crm);
  assertCloudWriterLease(scope, runtimeLease);
  const transport = await tenantCloudTransport(scope);
  assertCloudWriterLease(scope, runtimeLease);
  const existing = await fetchCloudRecords(transport, runtimeLease);
  assertCloudWriterLease(scope, runtimeLease);
  const next = crmToCloudRecords(crm, transport.context, scope.userId);
  assertRowsTenant(scope, next);
  const existingFingerprint = recordsFingerprint(existing);
  const nextFingerprint = recordsFingerprint(next);
  const remoteVersion = latestRemoteVersion(crmSyncRecords(existing));

  assertTenantRemoteIsSafe(scope, remoteVersion, nextFingerprint, existingFingerprint);
  assertCloudWriterLease(scope, runtimeLease);
  if (existingFingerprint === nextFingerprint) {
    assertCloudWriterLease(scope, runtimeLease);
    markTenantCloudSaved(scope, remoteVersion, token);
    assertCloudWriterLease(scope, runtimeLease);
    return;
  }

  assertCloudWriterLease(scope, runtimeLease);
  await upsertRecords(transport, next, runtimeLease);
  assertCloudWriterLease(scope, runtimeLease);
  await deleteStaleRecords(transport, staleCloudRecords(existing, next), runtimeLease);
  assertCloudWriterLease(scope, runtimeLease);
  const refreshed = await fetchCloudRecords(transport, runtimeLease);
  assertCloudWriterLease(scope, runtimeLease);
  const refreshedFingerprint = recordsFingerprint(refreshed);
  if (refreshedFingerprint !== nextFingerprint) {
    throw new Error('La verificación remota moderna no coincide con el snapshot tenant que PropControl intentó guardar.');
  }
  assertCloudWriterLease(scope, runtimeLease);
  markTenantCloudSaved(scope, latestRemoteVersion(crmSyncRecords(refreshed)), token);
  assertCloudWriterLease(scope, runtimeLease);
}

export async function pushTenantLegacyCloudData(
  scope: TenantScope,
  crm: CrmData,
  token: SyncSaveToken,
  runtimeLease: TenantRuntimeLease,
): Promise<void> {
  assertTenantCrmScope(scope, crm);
  assertCloudWriterLease(scope, runtimeLease);
  const transport = await tenantCloudTransport(scope);
  assertCloudWriterLease(scope, runtimeLease);
  const row = await tenantLegacySnapshotRow(transport, runtimeLease);
  assertCloudWriterLease(scope, runtimeLease);
  const localFingerprint = tenantFingerprint(crm);
  const remoteCrm = row?.internal_data?.crm;
  if (remoteCrm !== undefined && remoteCrm !== null) {
    if (!isCrmData(remoteCrm)) throw new Error(TENANT_CLOUD_RESPONSE_MISMATCH);
    assertTenantCrmScope(scope, remoteCrm);
  }
  const remoteFingerprint = tenantFingerprint(remoteCrm ?? null);
  assertTenantRemoteIsSafe(scope, row?.updated_at || null, localFingerprint, remoteFingerprint);
  assertCloudWriterLease(scope, runtimeLease);

  if (row && localFingerprint === remoteFingerprint) {
    assertCloudWriterLease(scope, runtimeLease);
    markTenantCloudSaved(scope, row.updated_at || null, token);
    assertCloudWriterLease(scope, runtimeLease);
    return;
  }

  const payload = {
    organization_id: scope.organizationId,
    title: 'Estado PropControl',
    source: SNAPSHOT_SOURCE,
    public_data: { system: true, version: 1 },
    internal_data: { crm, savedAt: new Date().toISOString(), version: 1 },
    created_by: scope.userId,
  };
  const target = row
    ? `${transport.config.url}/rest/v1/fichas?id=eq.${encodeURIComponent(row.id)}&organization_id=eq.${encodeURIComponent(scope.organizationId)}`
    : `${transport.config.url}/rest/v1/fichas`;
  assertCloudWriterLease(scope, runtimeLease);
  const response = await fetch(target, {
    method: row ? 'PATCH' : 'POST',
    headers: {
      ...tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  assertCloudWriterLease(scope, runtimeLease);
  await parseTenantCloudJson(response);
  assertCloudWriterLease(scope, runtimeLease);

  assertCloudWriterLease(scope, runtimeLease);
  const refreshed = await tenantLegacySnapshotRow(transport, runtimeLease);
  assertCloudWriterLease(scope, runtimeLease);
  const verifiedCrm = refreshed?.internal_data?.crm;
  if (!isCrmData(verifiedCrm)) {
    throw new Error('La verificación remota legacy no devolvió un CRM válido para el tenant.');
  }
  assertTenantCrmScope(scope, verifiedCrm);
  if (tenantFingerprint(verifiedCrm) !== localFingerprint) {
    throw new Error('La verificación remota legacy no coincide con el snapshot tenant que PropControl intentó guardar.');
  }
  assertCloudWriterLease(scope, runtimeLease);
  markTenantCloudSaved(scope, refreshed?.updated_at || new Date().toISOString(), token);
  assertCloudWriterLease(scope, runtimeLease);
}

export async function tenantCloudRemoteVersion(scope: TenantScope): Promise<string | null> {
  const transport = await tenantCloudTransport(scope);
  const rows = await fetchCloudRecords(transport);
  return latestRemoteVersion(crmSyncRecords(rows));
}

// Keep this type import reachable for static security review of legacy migration classification ownership.
export type { TenantLegacyMigrationResult };
