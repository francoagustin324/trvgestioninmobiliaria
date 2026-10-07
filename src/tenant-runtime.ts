import type { TenantScope } from './active-organization.js';

export const TENANT_RUNTIME_SCOPE_REQUIRED = 'TENANT_RUNTIME_SCOPE_REQUIRED';
export const TENANT_RUNTIME_SESSION_MISMATCH = 'TENANT_RUNTIME_SESSION_MISMATCH';
export const TENANT_RUNTIME_STALE = 'TENANT_RUNTIME_STALE';

export type TenantRuntimeLease = Readonly<{
  scope: TenantScope;
  generation: number;
}>;

let activeScope: TenantScope | null = null;
let generation = 0;

function canonicalScopeCopy(scope: TenantScope): TenantScope {
  if (
    typeof scope.userId !== 'string'
    || typeof scope.organizationId !== 'string'
    || !scope.userId
    || !scope.organizationId
    || scope.userId !== scope.userId.trim()
    || scope.organizationId !== scope.organizationId.trim()
  ) {
    throw new Error(TENANT_RUNTIME_SCOPE_REQUIRED);
  }
  return Object.freeze({
    userId: scope.userId,
    organizationId: scope.organizationId,
  });
}

export function tenantScopesEqual(left: TenantScope | null | undefined, right: TenantScope | null | undefined): boolean {
  return Boolean(
    left
    && right
    && left.userId === right.userId
    && left.organizationId === right.organizationId,
  );
}

export function tenantRuntimeKey(scope: TenantScope): string {
  const canonical = canonicalScopeCopy(scope);
  return `${canonical.userId}:org:${canonical.organizationId}`;
}

export function installTenantRuntimeScope(scope: TenantScope, sessionUserId: string): TenantScope {
  const canonical = canonicalScopeCopy(scope);
  if (canonical.userId !== sessionUserId) {
    throw new Error(TENANT_RUNTIME_SESSION_MISMATCH);
  }
  generation += 1;
  activeScope = canonical;
  return activeScope;
}

export function currentTenantScope(): TenantScope | null {
  return activeScope;
}

export function requireCurrentTenantScope(): TenantScope {
  if (!activeScope) throw new Error(TENANT_RUNTIME_SCOPE_REQUIRED);
  return activeScope;
}

export function invalidateTenantRuntimeScope(): void {
  generation += 1;
  activeScope = null;
}

export function captureTenantRuntimeLease(scope: TenantScope = requireCurrentTenantScope()): TenantRuntimeLease {
  if (!tenantScopesEqual(scope, activeScope)) throw new Error(TENANT_RUNTIME_STALE);
  return Object.freeze({
    scope: canonicalScopeCopy(scope),
    generation,
  });
}

export function tenantRuntimeLeaseIsCurrent(lease: TenantRuntimeLease): boolean {
  return lease.generation === generation && tenantScopesEqual(lease.scope, activeScope);
}

export function assertTenantRuntimeLeaseCurrent(lease: TenantRuntimeLease): void {
  if (!tenantRuntimeLeaseIsCurrent(lease)) throw new Error(TENANT_RUNTIME_STALE);
}
