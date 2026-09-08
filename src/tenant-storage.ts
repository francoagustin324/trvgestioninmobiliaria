import type { CrmData } from './models.js';
import { STORAGE_KEY } from './models.js';
import type { TenantScope } from './active-organization.js';
import {
  assertRemoteIsSafe,
  getSyncState,
  hasLocalBackup,
  hasPendingLocalChanges,
  markCloudHydrated,
  markCloudSaved,
  markSyncError,
  readLocalSnapshot,
  scopedStorageKey,
  stableFingerprint,
  syncSaveToken,
  writeLocalSnapshot,
  type LocalBackup,
  type SyncSaveToken,
  type SyncState,
} from './sync-safety.js';

const SESSION_KEY = 'propcontrol-cloud-session-v1';

export type TenantStorageNamespace = Readonly<{
  scope: TenantScope;
  crmKey: string;
  syncKey: string;
  backupsKey: string;
}>;

export type TenantLegacyMigrationClassification =
  | 'NO_LEGACY'
  | 'EXACT_ORG_MATCH'
  | 'ORG_MISMATCH'
  | 'TARGET_ALREADY_EXISTS'
  | 'AMBIGUOUS_LEGACY'
  | 'RECOVERY_REQUIRED';

export type TenantLegacyMigrationOutcome =
  | 'NO_LEGACY'
  | 'EXACT_ORG_MATCH'
  | 'TARGET_ALREADY_EXISTS'
  | 'RECOVERY_REQUIRED';

export type TenantLegacySourceKind = 'base' | 'user';

export type TenantLegacyMigrationResult = Readonly<{
  classification: TenantLegacyMigrationClassification;
  outcome: TenantLegacyMigrationOutcome;
  copied: boolean;
  source?: TenantLegacySourceKind;
  sourceKey?: string;
  targetKey: string;
  rawOrganizationId?: string | null;
}>;

type LegacyKeys = Readonly<{
  snapshot: string;
  sync: string;
  backups: string;
}>;

type LegacyCandidate = Readonly<{
  kind: TenantLegacySourceKind;
  keys: LegacyKeys;
  snapshotRaw: string;
  syncRaw: string | null;
  backupsRaw: string | null;
}>;

function activeStorage(storage?: Storage): Storage {
  return storage ?? localStorage;
}

function normalizedIdentifier(value: string, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} requerido para storage tenant-scoped.`);
  return normalized;
}

function frozenScopeCopy(scope: TenantScope): TenantScope {
  return Object.freeze({
    userId: normalizedIdentifier(scope.userId, 'userId'),
    organizationId: normalizedIdentifier(scope.organizationId, 'organizationId'),
  });
}

export function tenantStorageNamespace(scope: TenantScope): TenantStorageNamespace {
  const frozenScope = frozenScopeCopy(scope);
  const crmKey = `${STORAGE_KEY}:user:${frozenScope.userId}:org:${frozenScope.organizationId}`;
  return Object.freeze({
    scope: frozenScope,
    crmKey,
    syncKey: `${crmKey}:sync`,
    backupsKey: `${crmKey}:backups`,
  });
}

/**
 * Storage view that delegates every operation to the same sync-safety engine.
 * The only adaptation is the synthetic session identity used by the historical
 * scopedStorageKey() contract so the existing engine resolves the tenant key.
 */
class TenantStorageView implements Storage {
  private readonly syntheticSession: string;

  constructor(
    private readonly target: Storage,
    readonly namespace: TenantStorageNamespace,
  ) {
    this.syntheticSession = JSON.stringify({
      userId: `${namespace.scope.userId}:org:${namespace.scope.organizationId}`,
    });
  }

  get length(): number { return this.target.length; }

  clear(): void {
    throw new Error('TenantStorageView no permite clear() global.');
  }

  key(index: number): string | null {
    return this.target.key(index);
  }

  getItem(key: string): string | null {
    if (key === SESSION_KEY) return this.syntheticSession;
    return this.target.getItem(key);
  }

  removeItem(key: string): void {
    if (key === SESSION_KEY) throw new Error('TenantStorageView no modifica la sesión.');
    this.target.removeItem(key);
  }

  setItem(key: string, value: string): void {
    if (key === SESSION_KEY) throw new Error('TenantStorageView no modifica la sesión.');
    this.target.setItem(key, value);
  }
}

function tenantView(scope: TenantScope, storage?: Storage): TenantStorageView {
  const namespace = tenantStorageNamespace(scope);
  const view = new TenantStorageView(activeStorage(storage), namespace);
  if (scopedStorageKey(view) !== namespace.crmKey) {
    throw new Error('No se pudo establecer el namespace tenant-scoped esperado.');
  }
  return view;
}

export function readTenantSnapshot(scope: TenantScope, storage?: Storage): CrmData | null {
  return readLocalSnapshot(tenantView(scope, storage));
}

export function writeTenantSnapshot(
  scope: TenantScope,
  crm: CrmData,
  options: { markDirty?: boolean; reason?: string; backup?: boolean } = {},
  storage?: Storage,
): void {
  writeLocalSnapshot(crm, options, tenantView(scope, storage));
}

export function readTenantSyncState(scope: TenantScope, storage?: Storage): SyncState {
  return getSyncState(tenantView(scope, storage));
}

export function tenantHasPendingLocalChanges(scope: TenantScope, storage?: Storage): boolean {
  return hasPendingLocalChanges(tenantView(scope, storage));
}

export function tenantSyncSaveToken(
  scope: TenantScope,
  crm: CrmData,
  storage?: Storage,
): SyncSaveToken {
  return syncSaveToken(crm, tenantView(scope, storage));
}

export function markTenantDirty(
  scope: TenantScope,
  crm: CrmData,
  reason = 'Cambio local',
  storage?: Storage,
): void {
  writeLocalSnapshot(crm, { reason, backup: false }, tenantView(scope, storage));
}

export function markTenantCloudHydrated(
  scope: TenantScope,
  remoteVersion: string | null,
  remoteFingerprint?: string,
  storage?: Storage,
): boolean {
  const view = tenantView(scope, storage);
  return remoteFingerprint === undefined
    ? markCloudHydrated(remoteVersion, view)
    : markCloudHydrated(remoteVersion, remoteFingerprint, view);
}

export function markTenantCloudSaved(
  scope: TenantScope,
  remoteVersion: string | null,
  expected?: SyncSaveToken,
  storage?: Storage,
): boolean {
  return markCloudSaved(remoteVersion, expected, tenantView(scope, storage));
}

export function markTenantSyncError(
  scope: TenantScope,
  message: string,
  storage?: Storage,
): void {
  markSyncError(message, tenantView(scope, storage));
}

export function assertTenantRemoteIsSafe(
  scope: TenantScope,
  remoteVersion: string | null,
  localFingerprint?: string,
  remoteFingerprint?: string,
  storage?: Storage,
): void {
  assertRemoteIsSafe(
    remoteVersion,
    localFingerprint,
    remoteFingerprint,
    tenantView(scope, storage),
  );
}

export function hasTenantLocalBackup(scope: TenantScope, storage?: Storage): boolean {
  return hasLocalBackup(tenantView(scope, storage));
}

export function readTenantBackups(scope: TenantScope, storage?: Storage): readonly LocalBackup[] {
  const target = activeStorage(storage);
  const { backupsKey } = tenantStorageNamespace(scope);
  const raw = target.getItem(backupsKey);
  if (!raw) return Object.freeze([]);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return Object.freeze([]);
    return Object.freeze(parsed.filter((value): value is LocalBackup => Boolean(
      value
      && typeof value === 'object'
      && typeof (value as { createdAt?: unknown }).createdAt === 'string'
      && typeof (value as { reason?: unknown }).reason === 'string'
      && (value as { crm?: unknown }).crm
      && typeof (value as { crm?: unknown }).crm === 'object'
    )));
  } catch {
    return Object.freeze([]);
  }
}

export function tenantFingerprint(value: unknown): string {
  return stableFingerprint(value);
}

function baseLegacyKeys(): LegacyKeys {
  return Object.freeze({
    snapshot: STORAGE_KEY,
    sync: `${STORAGE_KEY}:sync`,
    backups: `${STORAGE_KEY}:backups`,
  });
}

function userLegacyKeys(scope: TenantScope): LegacyKeys {
  const userId = frozenScopeCopy(scope).userId;
  const snapshot = `${STORAGE_KEY}:user:${userId}`;
  return Object.freeze({
    snapshot,
    sync: `${snapshot}:sync`,
    backups: `${snapshot}:backups`,
  });
}

function legacyCandidate(
  kind: TenantLegacySourceKind,
  keys: LegacyKeys,
  storage: Storage,
): LegacyCandidate | null {
  const snapshotRaw = storage.getItem(keys.snapshot);
  if (!snapshotRaw) return null;
  return Object.freeze({
    kind,
    keys,
    snapshotRaw,
    syncRaw: storage.getItem(keys.sync),
    backupsRaw: storage.getItem(keys.backups),
  });
}

function equivalentLegacyCandidates(left: LegacyCandidate, right: LegacyCandidate): boolean {
  return left.snapshotRaw === right.snapshotRaw
    && left.syncRaw === right.syncRaw
    && left.backupsRaw === right.backupsRaw;
}

function rawOrganizationId(snapshotRaw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(snapshotRaw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const organization = (parsed as { organization?: unknown }).organization;
    if (!organization || typeof organization !== 'object' || Array.isArray(organization)) return null;
    const id = (organization as { id?: unknown }).id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

function result(
  targetKey: string,
  classification: TenantLegacyMigrationClassification,
  outcome: TenantLegacyMigrationOutcome,
  details: Partial<Pick<TenantLegacyMigrationResult, 'source' | 'sourceKey' | 'rawOrganizationId' | 'copied'>> = {},
): TenantLegacyMigrationResult {
  return Object.freeze({
    classification,
    outcome,
    copied: Boolean(details.copied),
    source: details.source,
    sourceKey: details.sourceKey,
    targetKey,
    rawOrganizationId: details.rawOrganizationId,
  });
}

/**
 * Read-only inspection. It never normalizes the CRM snapshot and never rewrites
 * organization.id. The raw organization id is compared before any migration.
 */
export function inspectTenantLegacyMigration(
  scope: TenantScope,
  storage?: Storage,
): TenantLegacyMigrationResult {
  const target = activeStorage(storage);
  const namespace = tenantStorageNamespace(scope);

  if (target.getItem(namespace.crmKey) !== null) {
    return result(namespace.crmKey, 'TARGET_ALREADY_EXISTS', 'TARGET_ALREADY_EXISTS');
  }

  const candidates = [
    legacyCandidate('base', baseLegacyKeys(), target),
    legacyCandidate('user', userLegacyKeys(namespace.scope), target),
  ].filter((candidate): candidate is LegacyCandidate => Boolean(candidate));

  if (candidates.length === 0) {
    return result(namespace.crmKey, 'NO_LEGACY', 'NO_LEGACY');
  }

  let candidate = candidates[0]!;
  if (candidates.length > 1) {
    const [first, second] = candidates;
    if (!first || !second || !equivalentLegacyCandidates(first, second)) {
      return result(namespace.crmKey, 'AMBIGUOUS_LEGACY', 'RECOVERY_REQUIRED');
    }
    // Both sources are byte-for-byte equivalent, including sync metadata and backups.
    // Prefer the user-scoped source only after proving equivalence.
    candidate = candidates.find((item) => item.kind === 'user') ?? candidate;
  }

  const organizationId = rawOrganizationId(candidate.snapshotRaw);
  if (organizationId === null) {
    return result(namespace.crmKey, 'RECOVERY_REQUIRED', 'RECOVERY_REQUIRED', {
      source: candidate.kind,
      sourceKey: candidate.keys.snapshot,
      rawOrganizationId: null,
    });
  }

  if (organizationId !== namespace.scope.organizationId) {
    return result(namespace.crmKey, 'ORG_MISMATCH', 'RECOVERY_REQUIRED', {
      source: candidate.kind,
      sourceKey: candidate.keys.snapshot,
      rawOrganizationId: organizationId,
    });
  }

  return result(namespace.crmKey, 'EXACT_ORG_MATCH', 'EXACT_ORG_MATCH', {
    source: candidate.kind,
    sourceKey: candidate.keys.snapshot,
    rawOrganizationId: organizationId,
  });
}

/**
 * Explicit, idempotent legacy copy foundation. Never runs automatically.
 * It preserves every legacy source and copies only after exact raw org match.
 */
export function migrateLegacyStorageToTenant(
  scope: TenantScope,
  storage?: Storage,
): TenantLegacyMigrationResult {
  const target = activeStorage(storage);
  const namespace = tenantStorageNamespace(scope);
  const inspection = inspectTenantLegacyMigration(namespace.scope, target);
  if (inspection.outcome !== 'EXACT_ORG_MATCH' || !inspection.source) return inspection;

  if (target.getItem(namespace.crmKey) !== null) {
    return result(namespace.crmKey, 'TARGET_ALREADY_EXISTS', 'TARGET_ALREADY_EXISTS');
  }

  const keys = inspection.source === 'base'
    ? baseLegacyKeys()
    : userLegacyKeys(namespace.scope);
  const snapshotRaw = target.getItem(keys.snapshot);
  if (!snapshotRaw) {
    return result(namespace.crmKey, 'RECOVERY_REQUIRED', 'RECOVERY_REQUIRED', {
      source: inspection.source,
      sourceKey: keys.snapshot,
      rawOrganizationId: inspection.rawOrganizationId,
    });
  }

  // Revalidate the raw id immediately before copy. No normalization or rewriting.
  const organizationId = rawOrganizationId(snapshotRaw);
  if (organizationId !== namespace.scope.organizationId) {
    return result(namespace.crmKey, 'ORG_MISMATCH', 'RECOVERY_REQUIRED', {
      source: inspection.source,
      sourceKey: keys.snapshot,
      rawOrganizationId: organizationId,
    });
  }

  target.setItem(namespace.crmKey, snapshotRaw);
  const syncRaw = target.getItem(keys.sync);
  if (syncRaw !== null) target.setItem(namespace.syncKey, syncRaw);
  const backupsRaw = target.getItem(keys.backups);
  if (backupsRaw !== null) target.setItem(namespace.backupsKey, backupsRaw);

  return result(namespace.crmKey, 'EXACT_ORG_MATCH', 'EXACT_ORG_MATCH', {
    copied: true,
    source: inspection.source,
    sourceKey: keys.snapshot,
    rawOrganizationId: organizationId,
  });
}
