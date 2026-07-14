import type { CrmData } from './models.js';
import { STORAGE_KEY } from './models.js';

const SESSION_KEY = 'propcontrol-cloud-session-v1';
const BACKUP_LIMIT = 5;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SyncState {
  dirty: boolean;
  localUpdatedAt?: string;
  lastCloudSavedAt?: string;
  lastCloudVersion?: string;
  lastError?: string;
}

export interface LocalBackup {
  createdAt: string;
  reason: string;
  crm: CrmData;
}

function activeStorage(storage?: StorageLike): StorageLike {
  return storage ?? localStorage;
}

function parseObject<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as T : null;
  } catch {
    return null;
  }
}

function sessionUserId(storage: StorageLike): string | null {
  const session = parseObject<{ userId?: string }>(storage.getItem(SESSION_KEY));
  return session?.userId ? String(session.userId) : null;
}

export function scopedStorageKey(storage?: StorageLike): string {
  const target = activeStorage(storage);
  const userId = sessionUserId(target);
  return userId ? `${STORAGE_KEY}:user:${userId}` : STORAGE_KEY;
}

function syncStateKey(storage: StorageLike): string {
  return `${scopedStorageKey(storage)}:sync`;
}

function backupKey(storage: StorageLike): string {
  return `${scopedStorageKey(storage)}:backups`;
}

function writeSyncState(state: SyncState, storage?: StorageLike): void {
  const target = activeStorage(storage);
  target.setItem(syncStateKey(target), JSON.stringify(state));
}

export function getSyncState(storage?: StorageLike): SyncState {
  const target = activeStorage(storage);
  const parsed = parseObject<Partial<SyncState>>(target.getItem(syncStateKey(target)));
  return {
    dirty: Boolean(parsed?.dirty),
    localUpdatedAt: parsed?.localUpdatedAt ? String(parsed.localUpdatedAt) : undefined,
    lastCloudSavedAt: parsed?.lastCloudSavedAt ? String(parsed.lastCloudSavedAt) : undefined,
    lastCloudVersion: parsed?.lastCloudVersion ? String(parsed.lastCloudVersion) : undefined,
    lastError: parsed?.lastError ? String(parsed.lastError) : undefined,
  };
}

export function activateAccountStorage(storage?: StorageLike): string {
  const target = activeStorage(storage);
  const key = scopedStorageKey(target);
  if (key === STORAGE_KEY || target.getItem(key)) return key;

  const legacy = target.getItem(STORAGE_KEY);
  if (!legacy) return key;

  target.setItem(key, legacy);
  writeSyncState({
    ...getSyncState(target),
    dirty: true,
    localUpdatedAt: new Date().toISOString(),
    lastError: undefined,
  }, target);
  return key;
}

export function readLocalSnapshot(storage?: StorageLike): CrmData | null {
  const target = activeStorage(storage);
  activateAccountStorage(target);
  return parseObject<CrmData>(target.getItem(scopedStorageKey(target)));
}

function readBackups(storage: StorageLike): LocalBackup[] {
  const parsed = parseObject<LocalBackup[]>(storage.getItem(backupKey(storage)));
  return Array.isArray(parsed) ? parsed : [];
}

function saveBackups(backups: LocalBackup[], storage: StorageLike): void {
  storage.setItem(backupKey(storage), JSON.stringify(backups.slice(0, BACKUP_LIMIT)));
}

function backupRawSnapshot(raw: string, reason: string, storage: StorageLike): void {
  const crm = parseObject<CrmData>(raw);
  if (!crm) return;
  const backups = readBackups(storage);
  backups.unshift({ createdAt: new Date().toISOString(), reason, crm });
  saveBackups(backups, storage);
}

export function writeLocalSnapshot(
  crm: CrmData,
  options: { markDirty?: boolean; reason?: string; backup?: boolean } = {},
  storage?: StorageLike,
): void {
  const target = activeStorage(storage);
  activateAccountStorage(target);
  const key = scopedStorageKey(target);
  const serialized = JSON.stringify(crm);
  const previous = target.getItem(key);

  if (options.backup !== false && previous && previous !== serialized) {
    backupRawSnapshot(previous, options.reason || 'Cambio local', target);
  }

  target.setItem(key, serialized);
  if (options.markDirty === false) return;

  writeSyncState({
    ...getSyncState(target),
    dirty: true,
    localUpdatedAt: new Date().toISOString(),
    lastError: undefined,
  }, target);
}

export function hasPendingLocalChanges(storage?: StorageLike): boolean {
  return getSyncState(storage).dirty;
}

export function markCloudHydrated(remoteVersion: string | null, storage?: StorageLike): void {
  const target = activeStorage(storage);
  const now = new Date().toISOString();
  writeSyncState({
    ...getSyncState(target),
    dirty: false,
    localUpdatedAt: now,
    lastCloudSavedAt: now,
    lastCloudVersion: remoteVersion || undefined,
    lastError: undefined,
  }, target);
}

export function markCloudSaved(remoteVersion: string | null, storage?: StorageLike): void {
  const target = activeStorage(storage);
  const now = new Date().toISOString();
  writeSyncState({
    ...getSyncState(target),
    dirty: false,
    localUpdatedAt: now,
    lastCloudSavedAt: now,
    lastCloudVersion: remoteVersion || getSyncState(target).lastCloudVersion,
    lastError: undefined,
  }, target);
}

export function markSyncError(message: string, storage?: StorageLike): void {
  const target = activeStorage(storage);
  writeSyncState({
    ...getSyncState(target),
    lastError: message.trim() || 'No se pudo sincronizar.',
  }, target);
}

export function latestRemoteVersion(rows: Array<{ updated_at?: string }>): string | null {
  const timestamps = rows
    .map((row) => row.updated_at)
    .filter((value): value is string => Boolean(value && !Number.isNaN(Date.parse(value))));
  if (!timestamps.length) return null;
  return timestamps.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function normalizeForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForFingerprint);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, normalizeForFingerprint(record[key])]),
  );
}

export function stableFingerprint(value: unknown): string {
  return JSON.stringify(normalizeForFingerprint(value));
}

export function assertRemoteIsSafe(
  remoteVersion: string | null,
  localFingerprint?: string,
  remoteFingerprint?: string,
  storage?: StorageLike,
): void {
  const state = getSyncState(storage);
  if (!state.dirty || !remoteVersion) return;

  if (state.lastCloudVersion) {
    const remoteTime = Date.parse(remoteVersion);
    const localBaseTime = Date.parse(state.lastCloudVersion);
    if (!Number.isNaN(remoteTime) && !Number.isNaN(localBaseTime) && remoteTime > localBaseTime) {
      throw new Error('Hay cambios más nuevos en la nube. PropControl frenó el guardado para no sobrescribir información. Tus datos locales siguen protegidos.');
    }
    return;
  }

  if (localFingerprint && remoteFingerprint && localFingerprint !== remoteFingerprint) {
    throw new Error('Encontramos datos distintos en este dispositivo y en la nube. PropControl no reemplazó ninguno. Tus datos locales siguen protegidos.');
  }
}

export function hasLocalBackup(storage?: StorageLike): boolean {
  return readBackups(activeStorage(storage)).length > 0;
}

export function restoreLatestBackup(storage?: StorageLike): CrmData | null {
  const target = activeStorage(storage);
  const backups = readBackups(target);
  const latest = backups.shift();
  if (!latest) return null;

  saveBackups(backups, target);
  target.setItem(scopedStorageKey(target), JSON.stringify(latest.crm));
  writeSyncState({
    ...getSyncState(target),
    dirty: true,
    localUpdatedAt: new Date().toISOString(),
    lastError: undefined,
  }, target);
  return latest.crm;
}

export function syncStatusLabel(state = getSyncState()): string {
  if (state.lastError) return 'Error de sincronización';
  if (state.dirty) return 'Cambios pendientes';
  if (state.lastCloudSavedAt) {
    const date = new Date(state.lastCloudSavedAt);
    if (!Number.isNaN(date.getTime())) {
      return `Nube guardada ${new Intl.DateTimeFormat('es-AR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)}`;
    }
  }
  return 'Sincronización pendiente';
}
