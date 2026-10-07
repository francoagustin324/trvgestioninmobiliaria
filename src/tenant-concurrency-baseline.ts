import type { TenantScope } from './active-organization.js';
import type { CloudEntityType, CloudRecordRow } from './cloud-records.js';
import { stableFingerprint } from './sync-safety.js';
import { tenantStorageNamespace } from './tenant-storage.js';

export const TENANT_CONCURRENCY_BASELINE_UNSAFE = 'TENANT_CONCURRENCY_BASELINE_UNSAFE';

export type ConcurrencyProtectedEntityType = 'client' | 'property';

export type TenantConcurrencyBaselineRow = Pick<
  CloudRecordRow,
  'organization_id' | 'entity_type' | 'entity_key' | 'assigned_member_id' | 'payload'
>;

type StoredBaseline = Readonly<{
  version: 1;
  organizationId: string;
  rows: TenantConcurrencyBaselineRow[];
}>;

function targetStorage(storage?: Storage): Storage {
  return storage ?? localStorage;
}

const CLOUD_ENTITY_TYPES = new Set<CloudEntityType>([
  'organization',
  'client',
  'property',
  'visit',
  'offer',
  'reservation',
  'commercial_contact',
  'reminder',
  'ficha',
  'conversation',
  'activity',
]);

function cloudEntityType(value: string): value is CloudEntityType {
  return CLOUD_ENTITY_TYPES.has(value as CloudEntityType);
}

function baselineRow(row: CloudRecordRow): TenantConcurrencyBaselineRow {
  return {
    organization_id: row.organization_id,
    entity_type: row.entity_type,
    entity_key: row.entity_key,
    assigned_member_id: row.assigned_member_id,
    payload: structuredClone(row.payload),
  };
}

function validRow(value: unknown, organizationId: string): value is TenantConcurrencyBaselineRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<TenantConcurrencyBaselineRow>;
  return row.organization_id === organizationId
    && typeof row.entity_type === 'string'
    && cloudEntityType(row.entity_type)
    && typeof row.entity_key === 'string'
    && (row.assigned_member_id === null || Number.isSafeInteger(row.assigned_member_id))
    && row.payload !== undefined;
}

export function tenantConcurrencyBaselineKey(scope: TenantScope): string {
  return `${tenantStorageNamespace(scope).crmKey}:concurrency-baseline:v1`;
}

export function writeTenantConcurrencyBaseline(
  scope: TenantScope,
  rows: readonly CloudRecordRow[],
  storage?: Storage,
): void {
  if (rows.some((row) => row.organization_id !== scope.organizationId)) {
    throw new Error(TENANT_CONCURRENCY_BASELINE_UNSAFE);
  }
  const baselineRows = rows
    .map(baselineRow)
    .sort((left, right) => `${left.entity_type}:${left.entity_key}`.localeCompare(`${right.entity_type}:${right.entity_key}`));
  const baseline: StoredBaseline = Object.freeze({
    version: 1,
    organizationId: scope.organizationId,
    rows: baselineRows,
  });
  targetStorage(storage).setItem(tenantConcurrencyBaselineKey(scope), JSON.stringify(baseline));
}

export function readTenantConcurrencyBaseline(
  scope: TenantScope,
  storage?: Storage,
): readonly TenantConcurrencyBaselineRow[] | null {
  const raw = targetStorage(storage).getItem(tenantConcurrencyBaselineKey(scope));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(TENANT_CONCURRENCY_BASELINE_UNSAFE);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(TENANT_CONCURRENCY_BASELINE_UNSAFE);
  }
  const baseline = parsed as Partial<StoredBaseline>;
  if (
    baseline.version !== 1
    || baseline.organizationId !== scope.organizationId
    || !Array.isArray(baseline.rows)
    || !baseline.rows.every((row) => validRow(row, scope.organizationId))
  ) {
    throw new Error(TENANT_CONCURRENCY_BASELINE_UNSAFE);
  }
  return Object.freeze(baseline.rows.map((row) => Object.freeze(structuredClone(row))));
}

export function concurrencyRowIdentity(
  row: Pick<CloudRecordRow, 'entity_type' | 'entity_key'>,
): string {
  return `${row.entity_type}:${row.entity_key}`;
}

export function concurrencyRowFingerprint(
  row: Pick<CloudRecordRow, 'assigned_member_id' | 'payload'>,
): string {
  return stableFingerprint({
    assigned_member_id: row.assigned_member_id,
    payload: row.payload,
  });
}

export function concurrencyBaselineMap(
  rows: readonly TenantConcurrencyBaselineRow[],
  entityType: CloudEntityType,
): ReadonlyMap<string, TenantConcurrencyBaselineRow> {
  return new Map(rows
    .filter((row) => row.entity_type === entityType)
    .map((row) => [concurrencyRowIdentity(row), row] as const));
}
