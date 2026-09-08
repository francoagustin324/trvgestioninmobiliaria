from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

# tenant-storage.ts — backup availability must validate the exact tenant backup set.
p = Path('src/tenant-storage.ts')
text = p.read_text()
text = replace_once(
    text,
    "export function hasTenantLocalBackup(scope: TenantScope, storage?: Storage): boolean {\n  return hasLocalBackup(tenantView(scope, storage));\n}\n",
    "export function hasTenantLocalBackup(scope: TenantScope, storage?: Storage): boolean {\n  return readTenantBackups(scope, storage).length > 0;\n}\n",
    'tenant-storage hasTenantLocalBackup',
)
p.write_text(text)

# store.ts — explicit scope + runtime lease for restore; keep historical wrapper only as compatibility.
p = Path('src/store.ts')
text = p.read_text()
text = replace_once(
    text,
    "import {\n  currentTenantScope,\n  requireCurrentTenantScope,\n  tenantScopesEqual,\n} from './tenant-runtime.js';\n",
    "import {\n  assertTenantRuntimeLeaseCurrent,\n  captureTenantRuntimeLease,\n  currentTenantScope,\n  requireCurrentTenantScope,\n  TENANT_RUNTIME_STALE,\n  tenantScopesEqual,\n  type TenantRuntimeLease,\n} from './tenant-runtime.js';\n",
    'store tenant-runtime imports',
)
old_restore = """export function restoreLatestLocalBackup(): boolean {
  if (!canRestoreLatestLocalBackup()) return false;
  const scope = requireCurrentTenantScope();
  const restored = restoreLatestTenantBackup(scope);
  if (!restored) return false;
  const normalized = normalizedData(restored);
  assertTenantCrmScope(scope, normalized);
  state.crm = normalized;
  resetTransientState();
  writeTenantSnapshot(scope, state.crm, { markDirty: true, reason: 'Restauración confirmada', backup: false });
  queueCloudSave(scope, state.crm);
  return true;
}
"""
new_restore = """export function restoreLatestLocalBackupForTenant(
  scope: TenantScope,
  runtimeLease: TenantRuntimeLease,
): boolean {
  if (!tenantScopesEqual(scope, runtimeLease.scope)) throw new Error(TENANT_RUNTIME_STALE);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  if (!canRestoreLatestLocalBackup()) return false;

  // restoreLatestTenantBackup consumes the exact tenant backup and writes only
  // inside that tenant namespace. The lease is therefore revalidated directly
  // before entering that synchronous material section.
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  const restored = restoreLatestTenantBackup(scope);
  if (!restored) return false;
  assertTenantCrmScope(scope, restored);
  const restoredSnapshot = normalizedData(restored);
  assertTenantCrmScope(scope, restoredSnapshot);

  assertTenantRuntimeLeaseCurrent(runtimeLease);
  state.crm = structuredClone(restoredSnapshot);
  resetTransientState();

  assertTenantRuntimeLeaseCurrent(runtimeLease);
  writeTenantSnapshot(scope, restoredSnapshot, {
    markDirty: true,
    reason: 'Restauración confirmada',
    backup: false,
  });

  assertTenantRuntimeLeaseCurrent(runtimeLease);
  queueCloudSave(scope, restoredSnapshot);
  return true;
}

export function restoreLatestLocalBackup(): boolean {
  const scope = requireCurrentTenantScope();
  const runtimeLease = captureTenantRuntimeLease(scope);
  return restoreLatestLocalBackupForTenant(scope, runtimeLease);
}
"""
text = replace_once(text, old_restore, new_restore, 'store restore API')
p.write_text(text)

# mvp-auth.ts — canonical recovery captures one scope+lease, uses explicit restore API and tenant-aware feedback.
p = Path('src/mvp-auth.ts')
text = p.read_text()
text = replace_once(
    text,
    "import {\n  hasLocalBackup,\n  replaceDataForTenant,\n  restoreLatestLocalBackup,\n  setActiveMemberId,\n  state,\n} from './store.js';\n",
    "import {\n  replaceDataForTenant,\n  restoreLatestLocalBackupForTenant,\n  setActiveMemberId,\n  state,\n} from './store.js';\n",
    'mvp-auth store imports',
)
text = replace_once(
    text,
    "import {\n  markTenantSyncError,\n  readTenantSyncState,\n  tenantHasPendingLocalChanges,\n  writeTenantSnapshot,\n} from './tenant-storage.js';\n",
    "import {\n  hasTenantLocalBackup,\n  markTenantSyncError,\n  readTenantSyncState,\n  tenantHasPendingLocalChanges,\n  writeTenantSnapshot,\n} from './tenant-storage.js';\n",
    'mvp-auth tenant-storage imports',
)
text = replace_once(
    text,
    "function dispatchCloudStatus(message: string, kind: 'success' | 'error' | 'working' = 'success'): void {\n  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', { detail: { message, kind } }));\n}\n\n",
    "",
    'mvp-auth global recovery status',
)
text = replace_once(
    text,
    "function dispatchTenantRender(runtimeLease: TenantRuntimeLease): void {\n  if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;\n  document.dispatchEvent(new CustomEvent('trv-render'));\n}\n",
    "function dispatchTenantRender(runtimeLease: TenantRuntimeLease): void {\n  if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;\n  document.dispatchEvent(new CustomEvent('trv-render'));\n}\n\nfunction tenantBackupAvailable(scope: TenantScope): boolean {\n  try {\n    return hasTenantLocalBackup(scope);\n  } catch {\n    return false;\n  }\n}\n",
    'mvp-auth tenant backup availability',
)
restore_operation = """
export function restoreLatestLocalBackupRecovery(
  confirmRestore: () => boolean = () => window.confirm('Se recuperará la copia local anterior y quedará pendiente de sincronización. ¿Continuar?'),
): boolean {
  const scope = requireCurrentTenantScope();
  const runtimeLease = captureTenantRuntimeLease(scope);

  if (!confirmRestore()) return false;
  assertTenantRuntimeLeaseCurrent(runtimeLease);

  const restored = restoreLatestLocalBackupForTenant(scope, runtimeLease);
  assertTenantRuntimeLeaseCurrent(runtimeLease);
  if (!restored) return false;

  dispatchTenantCloudStatus(
    runtimeLease,
    'Copia anterior recuperada. PropControl la guardará sin sobrescribir cambios más nuevos.',
    'success',
  );
  dispatchTenantRender(runtimeLease);
  return true;
}

"""
text = replace_once(
    text,
    "export async function resolveSyncDifferences(): Promise<void> {\n",
    restore_operation + "export async function resolveSyncDifferences(): Promise<void> {\n",
    'mvp-auth restore operation insertion',
)
text = replace_once(
    text,
    "  const backupAvailable = hasLocalBackup();\n",
    "  const backupAvailable = tenantBackupAvailable(scope);\n",
    'mvp-auth backup availability call',
)
old_handler = """  recoveryTarget?.querySelector<HTMLElement>('[data-account-restore]')?.addEventListener('click', () => {
    closeAccountMenuPanel({ restoreFocus: false });
    if (!window.confirm('Se recuperará la copia local anterior y quedará pendiente de sincronización. ¿Continuar?')) return;
    if (!restoreLatestLocalBackup()) return;
    dispatchCloudStatus('Copia anterior recuperada. PropControl la guardará sin sobrescribir cambios más nuevos.', 'success');
    document.dispatchEvent(new CustomEvent('trv-render'));
  });
"""
new_handler = """  recoveryTarget?.querySelector<HTMLElement>('[data-account-restore]')?.addEventListener('click', () => {
    closeAccountMenuPanel({ restoreFocus: false });
    restoreLatestLocalBackupRecovery();
  });
"""
text = replace_once(text, old_handler, new_handler, 'mvp-auth restore handler')
p.write_text(text)

# sync-recovery-bootstrap.ts — F closes the temporary C1 capture-phase blocker.
p = Path('src/sync-recovery-bootstrap.ts')
p.write_text("""export const TENANT_RECOVERY_CUTOVER_COMPLETE = 'TENANT_RECOVERY_CUTOVER_COMPLETE';

/**
 * A1.2-F recovery cutover complete.
 *
 * Recovery authority now lives exclusively in mvp-auth.ts, where both local
 * restore and cloud reconciliation capture one TenantScope + TenantRuntimeLease.
 * This bootstrap intentionally installs no click handler: in particular it no
 * longer intercepts [data-account-resolve], so the canonical tenant-aware
 * resolveSyncDifferences() handler is the only effective recovery path.
 */
""")
