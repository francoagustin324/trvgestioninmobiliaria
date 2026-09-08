import {
  readActiveOrganizationPreference,
  resolveActiveOrganization,
  tenantScopeFromActiveOrganization,
  type TenantScope,
} from './active-organization.js';
import {
  getCloudSession,
  pullCloudData,
  pushCloudData,
} from './cloud-api-compatible.js';
import { fetchMembershipCatalog } from './membership-catalog.js';
import type { CrmData } from './models.js';
import { initialData } from './models.js';
import {
  activateStorageForTenant,
  replaceDataForTenant,
  setActiveMemberId,
  state,
} from './store.js';
import {
  inspectTenantLegacyMigration,
  markTenantSyncError,
  migrateLegacyStorageToTenant,
  tenantFingerprint,
  tenantHasPendingLocalChanges,
} from './tenant-storage.js';
import {
  currentTenantScope,
  installTenantRuntimeScope,
  tenantScopesEqual,
} from './tenant-runtime.js';

export const TENANT_HYDRATION_SESSION_CHANGED = 'TENANT_HYDRATION_SESSION_CHANGED';
export const TENANT_LEGACY_STORAGE_RECOVERY_REQUIRED = 'TENANT_LEGACY_STORAGE_RECOVERY_REQUIRED';

function sessionStillMatches(userId: string): boolean {
  return getCloudSession()?.userId === userId;
}

export async function resolveTenantScopeForAuthenticatedSession(): Promise<TenantScope> {
  const session = getCloudSession();
  if (!session) throw new Error('Ingresá a tu cuenta para cargar la inmobiliaria.');

  const memberships = await fetchMembershipCatalog();
  if (!sessionStillMatches(session.userId)) throw new Error(TENANT_HYDRATION_SESSION_CHANGED);

  const context = resolveActiveOrganization({
    userId: session.userId,
    memberships,
    persistedOrganizationPreference: readActiveOrganizationPreference(session.userId),
  });
  return tenantScopeFromActiveOrganization(context);
}

export function prepareTenantLegacyStorage(scope: TenantScope): void {
  const inspection = inspectTenantLegacyMigration(scope);
  if (inspection.classification === 'NO_LEGACY' || inspection.classification === 'TARGET_ALREADY_EXISTS') {
    return;
  }
  if (inspection.classification === 'EXACT_ORG_MATCH') {
    const migration = migrateLegacyStorageToTenant(scope);
    if (migration.classification === 'EXACT_ORG_MATCH' && migration.copied) return;
    throw new Error(`${TENANT_LEGACY_STORAGE_RECOVERY_REQUIRED}:${migration.classification}`);
  }
  throw new Error(`${TENANT_LEGACY_STORAGE_RECOVERY_REQUIRED}:${inspection.classification}`);
}

function activateAuthenticatedMember(scope: TenantScope): void {
  if (!tenantScopesEqual(currentTenantScope(), scope)) return;
  const member = state.crm.teamMembers.find(
    (item) => item.userId === scope.userId && item.status !== 'Suspendido',
  );
  if (member) setActiveMemberId(member.id);
}

function emptyOperationalData(crm: CrmData): CrmData {
  return {
    ...structuredClone(crm),
    activityLog: [],
    clients: [],
    properties: [],
    contacts: [],
    reminders: [],
    fichas: [],
    conversations: [],
  };
}

function scopedInitialData(scope: TenantScope): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = scope.organizationId;
  return crm;
}

function isUntouchedTenantDemoData(scope: TenantScope, crm: CrmData): boolean {
  return tenantFingerprint(crm) === tenantFingerprint(scopedInitialData(scope));
}

export async function hydrateTenantAfterAuth(): Promise<TenantScope> {
  const scope = await resolveTenantScopeForAuthenticatedSession();
  const session = getCloudSession();
  if (!session || session.userId !== scope.userId) throw new Error(TENANT_HYDRATION_SESSION_CHANGED);

  // No CRM storage is read before the organization is resolved and legacy state
  // has been classified against that exact TenantScope.
  prepareTenantLegacyStorage(scope);
  if (!sessionStillMatches(scope.userId)) throw new Error(TENANT_HYDRATION_SESSION_CHANGED);

  activateStorageForTenant(scope);
  installTenantRuntimeScope(scope, scope.userId);

  if (tenantHasPendingLocalChanges(scope)) {
    try {
      await pushCloudData(scope, state.crm);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron sincronizar los cambios locales.';
      markTenantSyncError(scope, message);
      activateAuthenticatedMember(scope);
      return scope;
    }
  }

  const cloud = await pullCloudData(scope, state.crm);
  if (cloud) {
    replaceDataForTenant(scope, cloud);
  } else {
    const firstData = isUntouchedTenantDemoData(scope, state.crm)
      ? emptyOperationalData(state.crm)
      : state.crm;
    if (firstData !== state.crm) replaceDataForTenant(scope, firstData);
    await pushCloudData(scope, state.crm);
    const refreshed = await pullCloudData(scope, state.crm);
    if (refreshed) replaceDataForTenant(scope, refreshed);
  }
  activateAuthenticatedMember(scope);
  return scope;
}
