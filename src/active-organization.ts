export type TenantScope = Readonly<{
  userId: string;
  organizationId: string;
}>;

export type ActiveOrganizationContext = Readonly<{
  userId: string;
  activeOrganizationId: string;
}>;

export type MembershipCatalogStatus = 'active' | 'invited' | 'suspended' | 'unknown';

export type MembershipCatalogEntry = Readonly<{
  organizationId: string;
  userId: string;
  status: MembershipCatalogStatus;
  rawStatus: string;
  role?: string;
  memberId?: number;
  displayName?: string;
  email?: string;
  phone?: string;
}>;

export type ActiveOrganizationResolutionCode =
  | 'ORGANIZATION_ACCESS_REQUIRED'
  | 'ORGANIZATION_SELECTION_REQUIRED';

export class ActiveOrganizationResolutionError extends Error {
  constructor(readonly code: ActiveOrganizationResolutionCode) {
    super(code);
    this.name = 'ActiveOrganizationResolutionError';
  }
}

const ACTIVE_ORGANIZATION_PREFERENCE_PREFIX = 'propcontrol-active-organization-v1:user:';

export function normalizeMembershipCatalogStatus(value: unknown): MembershipCatalogStatus {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'active') return 'active';
  if (normalized === 'invited') return 'invited';
  if (normalized === 'suspended') return 'suspended';
  return 'unknown';
}

export function activeMembershipsForUser(
  userId: string,
  memberships: readonly MembershipCatalogEntry[],
): readonly MembershipCatalogEntry[] {
  return memberships
    .filter((membership) => (
      membership.userId === userId
      && membership.status === 'active'
      && Boolean(membership.organizationId)
    ))
    .slice()
    .sort((left, right) => left.organizationId.localeCompare(right.organizationId));
}

export function resolveActiveOrganization(input: Readonly<{
  userId: string;
  memberships: readonly MembershipCatalogEntry[];
  persistedOrganizationPreference?: string | null;
}>): ActiveOrganizationContext {
  const activeOrganizations = [...new Set(
    activeMembershipsForUser(input.userId, input.memberships)
      .map((membership) => membership.organizationId),
  )];

  if (activeOrganizations.length === 0) {
    throw new ActiveOrganizationResolutionError('ORGANIZATION_ACCESS_REQUIRED');
  }

  if (activeOrganizations.length === 1) {
    return Object.freeze({
      userId: input.userId,
      activeOrganizationId: activeOrganizations[0]!,
    });
  }

  const preference = String(input.persistedOrganizationPreference ?? '').trim();
  if (preference && activeOrganizations.includes(preference)) {
    return Object.freeze({
      userId: input.userId,
      activeOrganizationId: preference,
    });
  }

  throw new ActiveOrganizationResolutionError('ORGANIZATION_SELECTION_REQUIRED');
}

export function tenantScopeFromActiveOrganization(
  context: ActiveOrganizationContext,
): TenantScope {
  return Object.freeze({
    userId: context.userId,
    organizationId: context.activeOrganizationId,
  });
}

export function activeOrganizationPreferenceKey(userId: string): string {
  const normalizedUserId = String(userId).trim();
  if (!normalizedUserId) throw new Error('userId requerido para la preferencia de organización.');
  return `${ACTIVE_ORGANIZATION_PREFERENCE_PREFIX}${normalizedUserId}`;
}

function preferenceStorage(storage?: Storage): Storage {
  return storage ?? localStorage;
}

export function readActiveOrganizationPreference(
  userId: string,
  storage?: Storage,
): string | null {
  const value = preferenceStorage(storage).getItem(activeOrganizationPreferenceKey(userId));
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function writeActiveOrganizationPreference(
  userId: string,
  organizationId: string,
  storage?: Storage,
): void {
  const normalizedOrganizationId = String(organizationId).trim();
  if (!normalizedOrganizationId) throw new Error('organizationId requerido para guardar la preferencia.');
  preferenceStorage(storage).setItem(
    activeOrganizationPreferenceKey(userId),
    normalizedOrganizationId,
  );
}

export function clearActiveOrganizationPreference(
  userId: string,
  storage?: Storage,
): void {
  preferenceStorage(storage).removeItem(activeOrganizationPreferenceKey(userId));
}
