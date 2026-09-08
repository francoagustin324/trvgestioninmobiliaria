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
  assertTenantRuntimeLeaseCurrent,
  captureTenantRuntimeLease,
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

async function fetchCloudRecords(transport: TenantCloudTransport): Promise<CloudRecordRow[]> {
  const query = new URL(`${transport.config.url}/rest/v1/propcontrol_records`);
  query.searchParams.set('select', 'organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,updated_at');
  query.searchParams.set('organization_id', `eq.${transport.scope.organizationId}`);
  query.searchParams.set('order', 'entity_type.asc,entity_key.asc');
  const payload = await parseTenantCloudJson(await fetch(query, {
    method: 'GET',
    headers: tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
    cache: 'no-store',
  }));
  if (!Array.isArray(payload)) throw new Error(TENANT_CLOUD_RESPONSE_MISMATCH);
  const rows = payload as CloudRecordRow[];
  assertRowsTenant(transport.scope, rows);
  return rows;
}

async function upsertRecords(transport: TenantCloudTransport, records: CloudRecordRow[]): Promise<void> {
  assertRowsTenant(transport.scope, records);
  for (let index = 0; index < records.length; index += 100) {
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
  }
}

async function deleteStaleRecords(transport: TenantCloudTransport, stale: CloudRecordRow[]): Promise<void> {
  assertRowsTenant(transport.scope, stale);
  const grouped = new Map<string, string[]>();
  stale.forEach((record) => {
    const keys = grouped.get(record.entity_type) ?? [];
    keys.push(record.entity_key);
    grouped.set(record.entity_type, keys);
  });
  for (const [entityType, keys] of grouped) {
    for (let index = 0; index < keys.length; index += 100) {
      const target = new URL(`${transport.config.url}/rest/v1/propcontrol_records`);
      target.searchParams.set('organization_id', `eq.${transport.scope.organizationId}`);
      target.searchParams.set('entity_type', `eq.${entityType}`);
      target.searchParams.set('entity_key', `in.(${keys.slice(index, index + 100).map((key) => `"${key.replaceAll('"', '')}"`).join(',')})`);
      await parseTenantCloudJson(await fetch(target, {
        method: 'DELETE',
        headers: {
          ...tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
          Prefer: 'return=minimal',
        },
      }));
    }
  }
}

async function tenantLegacySnapshotRow(transport: TenantCloudTransport): Promise<LegacySnapshotRow | null> {
  const query = new URL(`${transport.config.url}/rest/v1/fichas`);
  query.searchParams.set('select', 'id,organization_id,internal_data,updated_at');
  query.searchParams.set('organization_id', `eq.${transport.scope.organizationId}`);
  query.searchParams.set('source', `eq.${SNAPSHOT_SOURCE}`);
  query.searchParams.set('order', 'updated_at.desc');
  query.searchParams.set('limit', '1');
  const payload = await parseTenantCloudJson(await fetch(query, {
    method: 'GET',
    headers: tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
    cache: 'no-store',
  }));
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
): Promise<void> {
  assertTenantCrmScope(scope, crm);
  const transport = await tenantCloudTransport(scope);
  const existing = await fetchCloudRecords(transport);
  const next = crmToCloudRecords(crm, transport.context, scope.userId);
  assertRowsTenant(scope, next);
  const existingFingerprint = recordsFingerprint(existing);
  const nextFingerprint = recordsFingerprint(next);
  const remoteVersion = latestRemoteVersion(crmSyncRecords(existing));

  assertTenantRemoteIsSafe(scope, remoteVersion, nextFingerprint, existingFingerprint);
  if (existingFingerprint === nextFingerprint) {
    markTenantCloudSaved(scope, remoteVersion, token);
    return;
  }

  await upsertRecords(transport, next);
  await deleteStaleRecords(transport, staleCloudRecords(existing, next));
  const refreshed = await fetchCloudRecords(transport);
  const refreshedFingerprint = recordsFingerprint(refreshed);
  if (refreshedFingerprint !== nextFingerprint) {
    throw new Error('La verificación remota moderna no coincide con el snapshot tenant que PropControl intentó guardar.');
  }
  markTenantCloudSaved(scope, latestRemoteVersion(crmSyncRecords(refreshed)), token);
}

export async function pushTenantLegacyCloudData(
  scope: TenantScope,
  crm: CrmData,
  token: SyncSaveToken,
): Promise<void> {
  assertTenantCrmScope(scope, crm);
  const transport = await tenantCloudTransport(scope);
  const row = await tenantLegacySnapshotRow(transport);
  const localFingerprint = tenantFingerprint(crm);
  const remoteCrm = row?.internal_data?.crm;
  if (remoteCrm !== undefined && remoteCrm !== null) {
    if (!isCrmData(remoteCrm)) throw new Error(TENANT_CLOUD_RESPONSE_MISMATCH);
    assertTenantCrmScope(scope, remoteCrm);
  }
  const remoteFingerprint = tenantFingerprint(remoteCrm ?? null);
  assertTenantRemoteIsSafe(scope, row?.updated_at || null, localFingerprint, remoteFingerprint);

  if (row && localFingerprint === remoteFingerprint) {
    markTenantCloudSaved(scope, row.updated_at || null, token);
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
  await parseTenantCloudJson(await fetch(target, {
    method: row ? 'PATCH' : 'POST',
    headers: {
      ...tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  }));

  const refreshed = await tenantLegacySnapshotRow(transport);
  const verifiedCrm = refreshed?.internal_data?.crm;
  if (!isCrmData(verifiedCrm)) {
    throw new Error('La verificación remota legacy no devolvió un CRM válido para el tenant.');
  }
  assertTenantCrmScope(scope, verifiedCrm);
  if (tenantFingerprint(verifiedCrm) !== localFingerprint) {
    throw new Error('La verificación remota legacy no coincide con el snapshot tenant que PropControl intentó guardar.');
  }
  markTenantCloudSaved(scope, refreshed?.updated_at || new Date().toISOString(), token);
}

export async function tenantCloudRemoteVersion(scope: TenantScope): Promise<string | null> {
  const transport = await tenantCloudTransport(scope);
  const rows = await fetchCloudRecords(transport);
  return latestRemoteVersion(crmSyncRecords(rows));
}

// Keep this type import reachable for static security review of legacy migration classification ownership.
export type { TenantLegacyMigrationResult };
