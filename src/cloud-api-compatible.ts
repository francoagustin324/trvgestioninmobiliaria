import type { TenantScope } from './active-organization.js';
import { activeMembershipsForUser } from './active-organization.js';
import type { CrmData } from './models.js';
import {
  getCloudSession,
  inviteTeamMember,
  signInCloud,
  signOutCloud,
  signUpCloud,
  updateTeamMemberAccess,
} from './cloud-api.js';
import { fetchMembershipCatalog } from './membership-catalog.js';
import {
  assertTenantCrmScope,
  markTenantSyncError,
  readTenantSyncState,
  tenantHasPendingLocalChanges,
  tenantSyncSaveToken,
} from './tenant-storage.js';
import {
  pullTenantCloudData,
  pushTenantLegacyCloudData,
  pushTenantModernCloudData,
} from './tenant-cloud-data.js';
import {
  parseTenantCloudJson,
  tenantCloudHeaders,
  tenantCloudTransport,
} from './tenant-cloud-context.js';
import { requireCurrentTenantScope } from './tenant-runtime.js';

export {
  getCloudSession,
  inviteTeamMember,
  signInCloud,
  signOutCloud,
  signUpCloud,
  updateTeamMemberAccess,
};

export const TENANT_VISIT_CAPABILITY_INDETERMINATE = 'TENANT_VISIT_CAPABILITY_INDETERMINATE';
export const TENANT_VISIT_TRANSACTION_SCOPE_REQUIRED = 'TENANT_VISIT_TRANSACTION_SCOPE_REQUIRED';

const compatibilitySaveTimers = new Map<string, number>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

function isTenantScope(value: unknown): value is TenantScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const scope = value as Partial<TenantScope>;
  return typeof scope.userId === 'string' && typeof scope.organizationId === 'string';
}

export function isLegacySchemaError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  const code = error && typeof error === 'object'
    ? String((error as { code?: unknown }).code ?? '').toLowerCase()
    : '';
  const missingLegacyColumn = message.includes('organization_members') && [
    'member_id',
    'display_name',
    'status',
    'last_active_at',
  ].some((column) => message.includes(column));
  const missingModernRelation = message.includes('propcontrol_records');
  const schemaCode = ['pgrst204', 'pgrst205', '42p01', '42703'].some((candidate) => (
    message.includes(candidate) || code === candidate
  ));
  const missingSignal = [
    'does not exist',
    'could not find',
    'schema cache',
    'undefined',
    'pgrst',
  ].some((signal) => message.includes(signal));
  return (missingLegacyColumn || missingModernRelation || schemaCode) && missingSignal;
}

function emitStatus(
  scope: TenantScope,
  message: string,
  kind: 'success' | 'error' | 'working' = 'success',
): void {
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
    detail: { scope: Object.freeze({ ...scope }), message, kind },
  }));
}

export async function resolveTenantVisitAuthority(scope: TenantScope): Promise<boolean> {
  const memberships = await fetchMembershipCatalog();
  const active = activeMembershipsForUser(scope.userId, memberships);
  if (
    active.length !== 1
    || active[0]?.organizationId !== scope.organizationId
  ) {
    throw new Error(TENANT_VISIT_CAPABILITY_INDETERMINATE);
  }

  const transport = await tenantCloudTransport(scope);
  const payload = await parseTenantCloudJson(await fetch(
    `${transport.config.url}/rest/v1/rpc/visit_transaction_authority_active`,
    {
      method: 'POST',
      headers: tenantCloudHeaders(transport.config.publishableKey, transport.accessToken),
      body: '{}',
    },
  ));
  if (typeof payload !== 'boolean') {
    throw new Error(TENANT_VISIT_CAPABILITY_INDETERMINATE);
  }
  return payload;
}

export function pullCloudData(scope: TenantScope, fallback: CrmData): Promise<CrmData | null>;
export function pullCloudData(fallback: CrmData): Promise<CrmData | null>;
export async function pullCloudData(
  scopeOrFallback: TenantScope | CrmData,
  fallbackMaybe?: CrmData,
): Promise<CrmData | null> {
  const scope = isTenantScope(scopeOrFallback) ? scopeOrFallback : requireCurrentTenantScope();
  const fallback = isTenantScope(scopeOrFallback) ? fallbackMaybe : scopeOrFallback;
  if (!fallback) throw new Error('TENANT_CLOUD_FALLBACK_REQUIRED');
  assertTenantCrmScope(scope, fallback);
  const cloud = await pullTenantCloudData(scope, fallback);
  if (cloud) assertTenantCrmScope(scope, cloud);
  return cloud;
}

export function pushCloudData(scope: TenantScope, crm: CrmData, visitAuthorityDecision?: boolean): Promise<void>;
export function pushCloudData(crm: CrmData, expectedAccountKey?: string, visitAuthorityDecision?: boolean): Promise<void>;
export async function pushCloudData(
  scopeOrCrm: TenantScope | CrmData,
  crmOrExpectedAccountKey?: CrmData | string,
  visitAuthorityDecisionMaybe?: boolean,
): Promise<void> {
  const scoped = isTenantScope(scopeOrCrm);
  const scope = scoped ? scopeOrCrm : requireCurrentTenantScope();
  const crm = scoped ? crmOrExpectedAccountKey as CrmData : scopeOrCrm;
  const expectedAccountKey = !scoped && typeof crmOrExpectedAccountKey === 'string'
    ? crmOrExpectedAccountKey
    : undefined;
  const visitAuthorityDecision = visitAuthorityDecisionMaybe;

  const session = getCloudSession();
  if (!session || session.userId !== scope.userId || (expectedAccountKey && expectedAccountKey !== scope.userId)) {
    throw new Error('La sesión activa cambió antes de iniciar la sincronización tenant.');
  }
  assertTenantCrmScope(scope, crm);
  const snapshot = structuredClone(crm);
  const token = tenantSyncSaveToken(scope, snapshot);
  const authorityActive = visitAuthorityDecision ?? await resolveTenantVisitAuthority(scope);

  if (authorityActive) {
    // C1 deliberately does not adapt the Visit transactional writer. C2 will
    // freeze the decision inside a tenant job and transport scope without
    // changing RPC semantics. Until then this branch is fail-closed.
    throw new Error(TENANT_VISIT_TRANSACTION_SCOPE_REQUIRED);
  }

  try {
    await pushTenantModernCloudData(scope, snapshot, token);
  } catch (error) {
    if (!isLegacySchemaError(error)) throw error;
    await pushTenantLegacyCloudData(scope, snapshot, token);
  }
}

export function queueCloudSave(scope: TenantScope, crm: CrmData, visitAuthorityDecision?: boolean): void;
export function queueCloudSave(crm: CrmData, visitAuthorityDecision?: boolean): void;
export function queueCloudSave(
  scopeOrCrm: TenantScope | CrmData,
  crmOrVisitAuthorityDecision?: CrmData | boolean,
  visitAuthorityDecisionMaybe?: boolean,
): void {
  const scoped = isTenantScope(scopeOrCrm);
  const scope = scoped ? scopeOrCrm : requireCurrentTenantScope();
  const crm = scoped ? crmOrVisitAuthorityDecision as CrmData : scopeOrCrm;
  const visitAuthorityDecision = scoped
    ? visitAuthorityDecisionMaybe
    : typeof crmOrVisitAuthorityDecision === 'boolean' ? crmOrVisitAuthorityDecision : undefined;

  const session = getCloudSession();
  if (!session || session.userId !== scope.userId) return;
  assertTenantCrmScope(scope, crm);

  // C1 transports the frozen scope but intentionally retains the historical
  // user-only debounce key. C2 changes the key and serial queue to user+org.
  const timerKey = scope.userId;
  const previousTimer = compatibilitySaveTimers.get(timerKey);
  if (previousTimer !== undefined) window.clearTimeout(previousTimer);
  const frozenScope: TenantScope = Object.freeze({ ...scope });
  const snapshot = structuredClone(crm);
  const timer = window.setTimeout(() => {
    compatibilitySaveTimers.delete(timerKey);
    const active = getCloudSession();
    if (!active || active.userId !== frozenScope.userId) return;
    if (!tenantHasPendingLocalChanges(frozenScope)) return;
    emitStatus(frozenScope, 'Guardando en la nube…', 'working');
    void pushCloudData(frozenScope, snapshot, visitAuthorityDecision)
      .then(() => {
        if (!readTenantSyncState(frozenScope).dirty) {
          emitStatus(frozenScope, 'Guardado seguro en la nube.');
        }
      })
      .catch((error) => {
        const technicalMessage = errorMessage(error) || 'No se pudo guardar en la nube.';
        const message = `Guardado localmente, sincronización pendiente. ${technicalMessage}`;
        markTenantSyncError(frozenScope, message);
        emitStatus(frozenScope, message, 'error');
      });
  }, 700);
  compatibilitySaveTimers.set(timerKey, timer);
}
