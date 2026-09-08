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

export const TENANT_SNAPSHOT_ORGANIZATION_MISMATCH = 'TENANT_SNAPSHOT_ORGANIZATION_MISMATCH';
export const TENANT_EXISTING_SNAPSHOT_UNSAFE = 'TENANT_EXISTING_SNAPSHOT_UNSAFE';
export const TENANT_BACKUP_SET_UNSAFE = 'TENANT_BACKUP_SET_UNSAFE';
export const TENANT_SCOPE_IDENTIFIER_INVALID = 'TENANT_SCOPE_IDENTIFIER_INVALID';
export const TENANT_SCOPE_IDENTIFIER_NOT_CANONICAL = 'TENANT_SCOPE_IDENTIFIER_NOT_CANONICAL';
export const TENANT_MIGRATION_ROLLBACK_FAILED = 'TENANT_MIGRATION_ROLLBACK_FAILED';

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
  | 'TARGET_PARTIAL_EXISTS'
  | 'AMBIGUOUS_LEGACY'
  | 'UNSAFE_LEGACY_SYNC'
  | 'UNSAFE_LEGACY_BACKUP'
  | 'MIGRATION_WRITE_FAILED'
  | 'MIGRATION_VERIFICATION_FAILED'
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

type TenantLegacyCandidateSelection =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'ambiguous' }>
  | Readonly<{ kind: 'candidate'; candidate: LegacyCandidate }>;

type TargetWrite = Readonly<{
  key: string;
  value: string;
}>;

function activeStorage(storage?: Storage): Storage {
  return storage ?? localStorage;
}

function canonicalIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${TENANT_SCOPE_IDENTIFIER_INVALID}: ${label}`);
  }
  if (value !== value.trim()) {
    throw new Error(`${TENANT_SCOPE_IDENTIFIER_NOT_CANONICAL}: ${label}`);
  }
  return value;
}

function frozenScopeCopy(scope: TenantScope): TenantScope {
  return Object.freeze({
    userId: canonicalIdentifier(scope.userId, 'userId'),
    organizationId: canonicalIdentifier(scope.organizationId, 'organizationId'),
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
 * Canonical tenant identity boundary for CRM snapshots.
 *
 * The comparison is deliberately exact. This guard never trims, normalizes,
 * rewrites or repairs crm.organization.id.
 */
export function assertTenantCrmScope(scope: TenantScope, crm: CrmData): void {
  frozenScopeCopy(scope);
  if (crm.organization.id !== scope.organizationId) {
    throw new Error(TENANT_SNAPSHOT_ORGANIZATION_MISMATCH);
  }
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

function rawOrganizationIdFromValue(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const organization = (value as { organization?: unknown }).organization;
  if (!organization || typeof organization !== 'object' || Array.isArray(organization)) return null;
  const id = (organization as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function isCrmDataShape(value: unknown): value is CrmData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const crm = value as {
    organization?: unknown;
    teamMembers?: unknown;
    activityLog?: unknown;
    clients?: unknown;
    properties?: unknown;
    visits?: unknown;
    offers?: unknown;
    reservations?: unknown;
    contacts?: unknown;
    reminders?: unknown;
    fichas?: unknown;
    conversations?: unknown;
    settings?: unknown;
  };
  return rawOrganizationIdFromValue(crm) !== null
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
    && Boolean(crm.settings && typeof crm.settings === 'object' && !Array.isArray(crm.settings));
}

function assertExistingTenantSnapshotSafe(scope: TenantScope, storage?: Storage): void {
  const target = activeStorage(storage);
  const namespace = tenantStorageNamespace(scope);
  const raw = target.getItem(namespace.crmKey);
  if (raw === null) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(TENANT_EXISTING_SNAPSHOT_UNSAFE);
  }

  if (!isCrmDataShape(parsed) || rawOrganizationIdFromValue(parsed) !== namespace.scope.organizationId) {
    throw new Error(TENANT_EXISTING_SNAPSHOT_UNSAFE);
  }
}

function validBackupEntryForOrganization(value: unknown, organizationId: string): value is LocalBackup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const backup = value as { createdAt?: unknown; reason?: unknown; crm?: unknown };
  if (typeof backup.createdAt !== 'string' || typeof backup.reason !== 'string') return false;
  if (!isCrmDataShape(backup.crm)) return false;
  return rawOrganizationIdFromValue(backup.crm) === organizationId;
}

function parseTenantBackupSet(raw: string, organizationId: string): readonly LocalBackup[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(TENANT_BACKUP_SET_UNSAFE);
  }

  if (!Array.isArray(parsed) || !parsed.every((entry) => validBackupEntryForOrganization(entry, organizationId))) {
    throw new Error(TENANT_BACKUP_SET_UNSAFE);
  }
  return Object.freeze(parsed as LocalBackup[]);
}

export function readTenantSnapshot(scope: TenantScope, storage?: Storage): CrmData | null {
  tenantStorageNamespace(scope);
  const crm = readLocalSnapshot(tenantView(scope, storage));
  if (crm) assertTenantCrmScope(scope, crm);
  return crm;
}

export function writeTenantSnapshot(
  scope: TenantScope,
  crm: CrmData,
  options: { markDirty?: boolean; reason?: string; backup?: boolean } = {},
  storage?: Storage,
): void {
  tenantStorageNamespace(scope);
  assertTenantCrmScope(scope, crm);
  assertExistingTenantSnapshotSafe(scope, storage);
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
  assertTenantCrmScope(scope, crm);
  return syncSaveToken(crm, tenantView(scope, storage));
}

export function markTenantDirty(
  scope: TenantScope,
  crm: CrmData,
  reason = 'Cambio local',
  storage?: Storage,
): void {
  tenantStorageNamespace(scope);
  assertTenantCrmScope(scope, crm);
  assertExistingTenantSnapshotSafe(scope, storage);
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
  const namespace = tenantStorageNamespace(scope);
  const raw = target.getItem(namespace.backupsKey);
  if (raw === null) return Object.freeze([]);
  return parseTenantBackupSet(raw, namespace.scope.organizationId);
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
    return rawOrganizationIdFromValue(JSON.parse(snapshotRaw));
  } catch {
    return null;
  }
}

function validLegacySync(syncRaw: string | null): boolean {
  if (syncRaw === null) return true;
  try {
    const parsed: unknown = JSON.parse(syncRaw);
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

function validLegacyBackups(backupsRaw: string | null, organizationId: string): boolean {
  if (backupsRaw === null) return true;
  try {
    const parsed: unknown = JSON.parse(backupsRaw);
    return Array.isArray(parsed)
      && parsed.every((entry) => validBackupEntryForOrganization(entry, organizationId));
  } catch {
    return false;
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

function inspectTargetNamespace(
  namespace: TenantStorageNamespace,
  storage: Storage,
): TenantLegacyMigrationResult | null {
  const crmExists = storage.getItem(namespace.crmKey) !== null;
  const syncExists = storage.getItem(namespace.syncKey) !== null;
  const backupsExist = storage.getItem(namespace.backupsKey) !== null;

  if (crmExists) {
    return result(namespace.crmKey, 'TARGET_ALREADY_EXISTS', 'TARGET_ALREADY_EXISTS');
  }
  if (syncExists || backupsExist) {
    return result(namespace.crmKey, 'TARGET_PARTIAL_EXISTS', 'RECOVERY_REQUIRED');
  }
  return null;
}

function selectedLegacyCandidate(
  scope: TenantScope,
  storage: Storage,
): TenantLegacyCandidateSelection {
  const candidates = [
    legacyCandidate('base', baseLegacyKeys(), storage),
    legacyCandidate('user', userLegacyKeys(scope), storage),
  ].filter((candidate): candidate is LegacyCandidate => Boolean(candidate));

  if (candidates.length === 0) return Object.freeze({ kind: 'none' });

  let candidate = candidates[0]!;
  if (candidates.length > 1) {
    const [first, second] = candidates;
    if (!first || !second || !equivalentLegacyCandidates(first, second)) {
      return Object.freeze({ kind: 'ambiguous' });
    }
    candidate = candidates.find((item) => item.kind === 'user') ?? candidate;
  }
  return Object.freeze({ kind: 'candidate', candidate });
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

  const targetState = inspectTargetNamespace(namespace, target);
  if (targetState) return targetState;

  const selection = selectedLegacyCandidate(namespace.scope, target);
  if (selection.kind === 'none') {
    return result(namespace.crmKey, 'NO_LEGACY', 'NO_LEGACY');
  }
  if (selection.kind === 'ambiguous') {
    return result(namespace.crmKey, 'AMBIGUOUS_LEGACY', 'RECOVERY_REQUIRED');
  }

  const { candidate } = selection;
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

  if (!validLegacySync(candidate.syncRaw)) {
    return result(namespace.crmKey, 'UNSAFE_LEGACY_SYNC', 'RECOVERY_REQUIRED', {
      source: candidate.kind,
      sourceKey: candidate.keys.snapshot,
      rawOrganizationId: organizationId,
    });
  }

  if (!validLegacyBackups(candidate.backupsRaw, namespace.scope.organizationId)) {
    return result(namespace.crmKey, 'UNSAFE_LEGACY_BACKUP', 'RECOVERY_REQUIRED', {
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

function rollbackTargetWrites(storage: Storage, keys: readonly string[]): void {
  let rollbackError: unknown = null;

  for (const key of [...keys].reverse()) {
    let exists = false;
    try {
      exists = storage.getItem(key) !== null;
    } catch (error) {
      rollbackError ??= error;
      continue;
    }
    if (!exists) continue;
    try {
      storage.removeItem(key);
    } catch (error) {
      rollbackError ??= error;
    }
  }

  for (const key of keys) {
    try {
      if (storage.getItem(key) !== null) {
        rollbackError ??= new Error(`No se pudo retirar ${key}.`);
      }
    } catch (error) {
      rollbackError ??= error;
    }
  }

  if (rollbackError) {
    const detail = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
    throw new Error(`${TENANT_MIGRATION_ROLLBACK_FAILED}: ${detail}`);
  }
}

function copyFailureResult(
  namespace: TenantStorageNamespace,
  inspection: TenantLegacyMigrationResult,
  classification: Extract<TenantLegacyMigrationClassification, 'MIGRATION_WRITE_FAILED' | 'MIGRATION_VERIFICATION_FAILED'>,
): TenantLegacyMigrationResult {
  return result(namespace.crmKey, classification, 'RECOVERY_REQUIRED', {
    source: inspection.source,
    sourceKey: inspection.sourceKey,
    rawOrganizationId: inspection.rawOrganizationId,
  });
}

/**
 * Explicit, idempotent legacy copy foundation. Never runs automatically.
 * It preserves every legacy source and copies only after complete validation.
 */
export function migrateLegacyStorageToTenant(
  scope: TenantScope,
  storage?: Storage,
): TenantLegacyMigrationResult {
  const target = activeStorage(storage);
  const namespace = tenantStorageNamespace(scope);
  const inspection = inspectTenantLegacyMigration(namespace.scope, target);
  if (inspection.outcome !== 'EXACT_ORG_MATCH' || !inspection.source) return inspection;

  const targetState = inspectTargetNamespace(namespace, target);
  if (targetState) return targetState;

  const keys = inspection.source === 'base'
    ? baseLegacyKeys()
    : userLegacyKeys(namespace.scope);
  const candidate = legacyCandidate(inspection.source, keys, target);
  if (!candidate) {
    return result(namespace.crmKey, 'RECOVERY_REQUIRED', 'RECOVERY_REQUIRED', {
      source: inspection.source,
      sourceKey: keys.snapshot,
      rawOrganizationId: inspection.rawOrganizationId,
    });
  }

  // Revalidate the complete source immediately before the first target write.
  const organizationId = rawOrganizationId(candidate.snapshotRaw);
  if (organizationId !== namespace.scope.organizationId) {
    return result(namespace.crmKey, 'ORG_MISMATCH', 'RECOVERY_REQUIRED', {
      source: inspection.source,
      sourceKey: keys.snapshot,
      rawOrganizationId: organizationId,
    });
  }
  if (!validLegacySync(candidate.syncRaw)) {
    return result(namespace.crmKey, 'UNSAFE_LEGACY_SYNC', 'RECOVERY_REQUIRED', {
      source: inspection.source,
      sourceKey: keys.snapshot,
      rawOrganizationId: organizationId,
    });
  }
  if (!validLegacyBackups(candidate.backupsRaw, namespace.scope.organizationId)) {
    return result(namespace.crmKey, 'UNSAFE_LEGACY_BACKUP', 'RECOVERY_REQUIRED', {
      source: inspection.source,
      sourceKey: keys.snapshot,
      rawOrganizationId: organizationId,
    });
  }

  const writes: TargetWrite[] = [
    Object.freeze({ key: namespace.crmKey, value: candidate.snapshotRaw }),
  ];
  if (candidate.syncRaw !== null) {
    writes.push(Object.freeze({ key: namespace.syncKey, value: candidate.syncRaw }));
  }
  if (candidate.backupsRaw !== null) {
    writes.push(Object.freeze({ key: namespace.backupsKey, value: candidate.backupsRaw }));
  }

  const touchedKeys: string[] = [];

  for (const write of writes) {
    touchedKeys.push(write.key);
    try {
      target.setItem(write.key, write.value);
    } catch {
      rollbackTargetWrites(target, touchedKeys);
      return copyFailureResult(namespace, inspection, 'MIGRATION_WRITE_FAILED');
    }

    let exact = false;
    try {
      exact = target.getItem(write.key) === write.value;
    } catch {
      rollbackTargetWrites(target, touchedKeys);
      return copyFailureResult(namespace, inspection, 'MIGRATION_VERIFICATION_FAILED');
    }
    if (!exact) {
      rollbackTargetWrites(target, touchedKeys);
      return copyFailureResult(namespace, inspection, 'MIGRATION_VERIFICATION_FAILED');
    }
  }

  for (const write of writes) {
    let exact = false;
    try {
      exact = target.getItem(write.key) === write.value;
    } catch {
      rollbackTargetWrites(target, touchedKeys);
      return copyFailureResult(namespace, inspection, 'MIGRATION_VERIFICATION_FAILED');
    }
    if (!exact) {
      rollbackTargetWrites(target, touchedKeys);
      return copyFailureResult(namespace, inspection, 'MIGRATION_VERIFICATION_FAILED');
    }
  }

  return result(namespace.crmKey, 'EXACT_ORG_MATCH', 'EXACT_ORG_MATCH', {
    copied: true,
    source: inspection.source,
    sourceKey: keys.snapshot,
    rawOrganizationId: organizationId,
  });
}
