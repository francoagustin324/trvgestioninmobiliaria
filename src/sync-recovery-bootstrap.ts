export const TENANT_RECOVERY_CUTOVER_COMPLETE = 'TENANT_RECOVERY_CUTOVER_COMPLETE';

/**
 * A1.2-F recovery cutover complete.
 *
 * Recovery authority now lives exclusively in mvp-auth.ts, where both local
 * restore and cloud reconciliation capture one TenantScope + TenantRuntimeLease.
 * This bootstrap intentionally installs no click handler: in particular it no
 * longer intercepts [data-account-resolve], so the canonical tenant-aware
 * resolveSyncDifferences() handler is the only effective recovery path.
 */
