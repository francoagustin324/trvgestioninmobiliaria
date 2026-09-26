import type { TenantScope } from './active-organization.js';
import type { Property } from './models.js';
import { canonicalUuid, normalizeRevision } from './sync-identity.js';
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
import type { CommercialRecordReference } from './visit-transaction-contract.js';

export const TENANT_RECORD_CONFLICT = 'TENANT_RECORD_CONFLICT';
export const STALE_REVISION = 'STALE_REVISION';
export const PROPERTY_SNAPSHOT_CONFLICT = 'PROPERTY_SNAPSHOT_CONFLICT';

export class TenantRecordConflictError extends Error {
  readonly code = TENANT_RECORD_CONFLICT;
  readonly entityType: 'client' | 'property';
  readonly reason: typeof STALE_REVISION | typeof PROPERTY_SNAPSHOT_CONFLICT;

  constructor(
    entityType: 'client' | 'property',
    reason: typeof STALE_REVISION | typeof PROPERTY_SNAPSHOT_CONFLICT = PROPERTY_SNAPSHOT_CONFLICT,
    options: { cause?: unknown } = {},
  ) {
    super(TENANT_RECORD_CONFLICT, options);
    this.name = 'TenantRecordConflictError';
    this.entityType = entityType;
    this.reason = reason;
  }
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object'
    ? String((error as { code?: unknown }).code ?? '').toUpperCase()
    : '';
}

export function isTenantRecordConflict(error: unknown): error is TenantRecordConflictError {
  return error instanceof TenantRecordConflictError
    || (Boolean(error && typeof error === 'object')
      && String((error as { code?: unknown }).code ?? '') === TENANT_RECORD_CONFLICT);
}

export function tenantRecordConflictFrom(
  error: unknown,
  entityType: 'client' | 'property',
): TenantRecordConflictError | null {
  if (isTenantRecordConflict(error)) return error;
  const code = errorCode(error);
  if (code !== '40001' && code !== '23505' && code !== 'P0002') return null;
  return new TenantRecordConflictError(
    entityType,
    code === '40001' ? STALE_REVISION : PROPERTY_SNAPSHOT_CONFLICT,
    { cause: error },
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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

export type PropertySnapshotCasIntent = {
  property: CommercialRecordReference;
  expectedRevision: number;
} & (
  | { action: 'insert'; payload: Property; assignedMemberId?: number }
  | { action: 'update'; payload: Property; assignedMemberId?: number }
  | { action: 'delete' }
);

export interface PropertySnapshotCasResult {
  success: true;
  organizationId: string;
  action: PropertySnapshotCasIntent['action'];
  property?: Property & { revision: number };
  serverTimestamp: string;
}

export function propertyRecordReference(payload: unknown): CommercialRecordReference {
  const value = record(payload);
  const uid = canonicalUuid(value?.uid);
  if (uid) return { uid };
  const legacyId = Number(value?.id);
  if (!Number.isSafeInteger(legacyId) || legacyId <= 0) {
    throw new Error('La Property no tiene una identidad válida para CAS.');
  }
  return { legacyId };
}

export function propertyRevision(payload: unknown): number {
  const value = record(payload);
  return normalizeRevision(value?.revision);
}

export function propertyPayload(payload: unknown): Property {
  const value = record(payload);
  if (!value || !Number.isSafeInteger(Number(value.id))) {
    throw new Error('Property snapshot inválido para CAS.');
  }
  return structuredClone(value) as unknown as Property;
}

export async function invokePropertySnapshotCasV1(
  scope: TenantScope,
  intent: PropertySnapshotCasIntent,
  runtimeLease: TenantRuntimeLease = captureTenantRuntimeLease(scope),
  transportOverride?: TenantCloudTransport,
): Promise<PropertySnapshotCasResult> {
  const transport = transportOverride ?? await transportFor(scope, runtimeLease);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  let payload: unknown;
  try {
    const response = await fetch(`${transport.config.url}/rest/v1/rpc/property_snapshot_cas_v1`, {
      method: 'POST',
      headers: tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
      body: JSON.stringify({
        p_organization_id: scope.organizationId,
        p_request: intent,
        p_force_rollback: false,
      }),
    });
    payload = await parseTenantCloudJson(response);
  } catch (error) {
    const code = errorCode(error);
    if (code === '40001' || code === '23505' || code === 'P0002') {
      throw new TenantRecordConflictError(
        'property',
        code === '40001' ? STALE_REVISION : PROPERTY_SNAPSHOT_CONFLICT,
        { cause: error },
      );
    }
    throw error;
  }
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  const value = record(payload);
  if (
    value?.success !== true
    || value.action !== intent.action
    || value.organizationId !== scope.organizationId
    || typeof value.serverTimestamp !== 'string'
  ) {
    throw new Error('Property snapshot CAS V1 devolvió una respuesta inválida.');
  }
  return payload as PropertySnapshotCasResult;
}
