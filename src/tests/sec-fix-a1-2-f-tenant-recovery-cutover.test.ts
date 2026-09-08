import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './sec-fix-a1-2-c2-test-setup.js';
import type { TenantScope } from '../active-organization.js';
import { initialData, type CrmData } from '../models.js';
import { restoreLatestLocalBackupRecovery } from '../mvp-auth.js';
import {
  replaceDataForTenant,
  restoreLatestLocalBackupForTenant,
  state,
} from '../store.js';
import {
  captureTenantRuntimeLease,
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
} from '../tenant-runtime.js';
import {
  hasTenantLocalBackup,
  readTenantSyncState,
  tenantStorageNamespace,
  TENANT_BACKUP_SET_UNSAFE,
} from '../tenant-storage.js';

const USER = 'recovery-user';
const ORG_A = '00000000-0000-0000-0000-0000000000a1';
const ORG_B = '00000000-0000-0000-0000-0000000000b1';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function scope(organizationId: string): TenantScope {
  return Object.freeze({ userId: USER, organizationId });
}

function crmFor(organizationId: string, label: string): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.organization.name = label;
  const owner = crm.teamMembers[0]!;
  owner.userId = USER;
  owner.role = 'Dueño';
  owner.status = 'Activo';
  return crm;
}

function installStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
  return storage;
}

function prepare(tenantScope: TenantScope, crm: CrmData): void {
  installTenantRuntimeScope(tenantScope, tenantScope.userId);
  assert.equal(replaceDataForTenant(tenantScope, crm, false), true);
  state.activeMemberId = crm.teamMembers[0]!.id;
}

function seedBackup(storage: Storage, tenantScope: TenantScope, crm: CrmData): void {
  const key = tenantStorageNamespace(tenantScope).backupsKey;
  storage.setItem(key, JSON.stringify([{ createdAt: '2026-09-08T00:00:00.000Z', reason: 'fixture', crm }]));
}

function reset(): MemoryStorage {
  invalidateTenantRuntimeScope();
  state.crm = structuredClone(initialData);
  return installStorage();
}

const storeSource = readFileSync('src/store.ts', 'utf8');
const authSource = readFileSync('src/mvp-auth.ts', 'utf8');
const bootstrapSource = readFileSync('src/sync-recovery-bootstrap.ts', 'utf8');
const tenantStorageSource = readFileSync('src/tenant-storage.ts', 'utf8');

function functionBody(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} boundary missing`);
  return source.slice(start, end);
}

test('F1 backup A sólo puede restaurarse bajo A', () => {
  const storage = reset();
  const a = scope(ORG_A);
  const current = crmFor(ORG_A, 'A-current');
  const backup = crmFor(ORG_A, 'A-backup');
  prepare(a, current);
  seedBackup(storage, a, backup);
  const lease = captureTenantRuntimeLease(a);
  assert.equal(restoreLatestLocalBackupForTenant(a, lease), true);
  assert.equal(state.crm.organization.id, ORG_A);
  assert.equal(state.crm.organization.name, 'A-backup');
});

test('F2 backup B no aparece disponible bajo A', () => {
  const storage = reset();
  const a = scope(ORG_A);
  const b = scope(ORG_B);
  seedBackup(storage, b, crmFor(ORG_B, 'B-backup'));
  assert.equal(hasTenantLocalBackup(a, storage), false);
  assert.equal(hasTenantLocalBackup(b, storage), true);
});

test('F3 backup wrong-org bajo namespace A falla cerrado', () => {
  const storage = reset();
  const a = scope(ORG_A);
  prepare(a, crmFor(ORG_A, 'A-current'));
  seedBackup(storage, a, crmFor(ORG_B, 'B-forged'));
  const lease = captureTenantRuntimeLease(a);
  assert.throws(() => restoreLatestLocalBackupForTenant(a, lease), new RegExp(TENANT_BACKUP_SET_UNSAFE));
  assert.equal(state.crm.organization.id, ORG_A);
});

test('F4 backup set malformado falla cerrado', () => {
  const storage = reset();
  const a = scope(ORG_A);
  prepare(a, crmFor(ORG_A, 'A-current'));
  storage.setItem(tenantStorageNamespace(a).backupsKey, '{not-json');
  const lease = captureTenantRuntimeLease(a);
  assert.throws(() => restoreLatestLocalBackupForTenant(a, lease), new RegExp(TENANT_BACKUP_SET_UNSAFE));
  assert.equal(state.crm.organization.name, 'A-current');
});

test('F5 restore válido single-tenant actualiza exclusivamente A', () => {
  const storage = reset();
  const a = scope(ORG_A);
  const b = scope(ORG_B);
  prepare(a, crmFor(ORG_A, 'A-current'));
  seedBackup(storage, a, crmFor(ORG_A, 'A-restored'));
  seedBackup(storage, b, crmFor(ORG_B, 'B-untouched'));
  const bRaw = storage.getItem(tenantStorageNamespace(b).backupsKey);
  assert.equal(restoreLatestLocalBackupForTenant(a, captureTenantRuntimeLease(a)), true);
  assert.equal(state.crm.organization.name, 'A-restored');
  assert.equal(storage.getItem(tenantStorageNamespace(b).backupsKey), bRaw);
});

test('F6 restore válido marca A dirty', () => {
  const storage = reset();
  const a = scope(ORG_A);
  prepare(a, crmFor(ORG_A, 'A-current'));
  seedBackup(storage, a, crmFor(ORG_A, 'A-restored'));
  assert.equal(restoreLatestLocalBackupForTenant(a, captureTenantRuntimeLease(a)), true);
  assert.equal(readTenantSyncState(a, storage).dirty, true);
});

test('F7 restore encola cloud save con scope exacto, no writer global', () => {
  const body = functionBody(storeSource, 'export function restoreLatestLocalBackupForTenant', 'export function restoreLatestLocalBackup()');
  assert.match(body, /queueCloudSave\(scope, restoredSnapshot\)/);
  assert.doesNotMatch(body, /queueCloudSave\(state\.crm\)/);
  assert.doesNotMatch(body, /queueCloudSave\(restoredSnapshot\)/);
});

test('F8 restore sin backup no muta CRM ni sync', () => {
  const storage = reset();
  const a = scope(ORG_A);
  prepare(a, crmFor(ORG_A, 'A-current'));
  const crmBefore = structuredClone(state.crm);
  const syncBefore = readTenantSyncState(a, storage);
  assert.equal(restoreLatestLocalBackupForTenant(a, captureTenantRuntimeLease(a)), false);
  assert.deepEqual(state.crm, crmBefore);
  assert.deepEqual(readTenantSyncState(a, storage), syncBefore);
});

test('F9 A→B antes del efecto material: lease A stale y B intacto', () => {
  const storage = reset();
  const a = scope(ORG_A);
  const b = scope(ORG_B);
  prepare(a, crmFor(ORG_A, 'A-current'));
  seedBackup(storage, a, crmFor(ORG_A, 'A-backup'));
  const leaseA = captureTenantRuntimeLease(a);
  prepare(b, crmFor(ORG_B, 'B-current'));
  const bBefore = structuredClone(state.crm);
  const bSyncBefore = readTenantSyncState(b, storage);
  assert.throws(() => restoreLatestLocalBackupForTenant(a, leaseA), /TENANT_RUNTIME_STALE/);
  assert.deepEqual(state.crm, bBefore);
  assert.deepEqual(readTenantSyncState(b, storage), bSyncBefore);
  assert.equal(hasTenantLocalBackup(a, storage), true);
});

test('F10 A→B→A: lease A1 continúa stale por generación', () => {
  const storage = reset();
  const a = scope(ORG_A);
  const b = scope(ORG_B);
  prepare(a, crmFor(ORG_A, 'A1'));
  seedBackup(storage, a, crmFor(ORG_A, 'A-backup'));
  const leaseA1 = captureTenantRuntimeLease(a);
  prepare(b, crmFor(ORG_B, 'B'));
  prepare(a, crmFor(ORG_A, 'A2'));
  assert.throws(() => restoreLatestLocalBackupForTenant(a, leaseA1), /TENANT_RUNTIME_STALE/);
  assert.equal(state.crm.organization.name, 'A2');
  assert.equal(hasTenantLocalBackup(a, storage), true);
});

test('F11 invalidación/logout vuelve stale el restore viejo', () => {
  const storage = reset();
  const a = scope(ORG_A);
  prepare(a, crmFor(ORG_A, 'A-current'));
  seedBackup(storage, a, crmFor(ORG_A, 'A-backup'));
  const lease = captureTenantRuntimeLease(a);
  invalidateTenantRuntimeScope();
  assert.throws(() => restoreLatestLocalBackupForTenant(a, lease), /TENANT_RUNTIME_STALE/);
  assert.equal(hasTenantLocalBackup(a, storage), true);
});

test('F12 resolve A→B conserva checks post-await canónicos de C3', () => {
  const body = functionBody(authSource, 'export async function resolveSyncDifferences', 'export function hasAuthenticatedSession');
  assert.match(body, /await inspectCloudWithoutChangingLocalState\(scope, runtimeLease, originalLocal\)/);
  assert.match(body, /assertTenantRuntimeLeaseCurrent\(runtimeLease\)/);
  assert.match(body, /if \(!tenantRuntimeLeaseIsCurrent\(runtimeLease\)\) return/);
});

test('F13 resolve A→B→A depende de TenantRuntimeLease, no sólo igualdad de scope', () => {
  const body = functionBody(authSource, 'export async function resolveSyncDifferences', 'export function hasAuthenticatedSession');
  assert.match(body, /captureTenantRuntimeLease\(scope\)/);
  assert.match(body, /assertTenantRuntimeLeaseCurrent\(runtimeLease\)/g);
  assert.doesNotMatch(body, /tenantScopesEqual/);
});

test('F14 resolve cloud wrong-org queda bajo pullCloudData(scope) tenant-aware', () => {
  const body = functionBody(authSource, 'export async function resolveSyncDifferences', 'export function hasAuthenticatedSession');
  assert.match(body, /inspectCloudWithoutChangingLocalState\(scope, runtimeLease, originalLocal\)/);
  const inspect = functionBody(authSource, 'async function inspectCloudWithoutChangingLocalState', 'function isDifferenceError');
  assert.match(inspect, /pullCloudData\(scope, structuredClone\(local\)\)/);
});

test('F15 status recovery stale está filtrado por runtimeLease', () => {
  const restore = functionBody(authSource, 'export function restoreLatestLocalBackupRecovery', 'export async function resolveSyncDifferences');
  assert.match(restore, /dispatchTenantCloudStatus\(\s*runtimeLease,/);
  assert.doesNotMatch(restore, /dispatchCloudStatus/);
});

test('F16 render recovery stale está filtrado por runtimeLease', () => {
  const restore = functionBody(authSource, 'export function restoreLatestLocalBackupRecovery', 'export async function resolveSyncDifferences');
  assert.match(restore, /dispatchTenantRender\(runtimeLease\)/);
  assert.doesNotMatch(restore, /document\.dispatchEvent\(new CustomEvent\('trv-render'\)\)/);
});

test('F17 blocker C1 ya no intercepta data-account-resolve', () => {
  assert.doesNotMatch(bootstrapSource, /addEventListener\('click'/);
  assert.doesNotMatch(bootstrapSource, /preventDefault|stopPropagation|stopImmediatePropagation/);
  assert.doesNotMatch(bootstrapSource, /TENANT_RECOVERY_CUTOVER_REQUIRED/);
  assert.match(bootstrapSource, /TENANT_RECOVERY_CUTOVER_COMPLETE/);
});

test('F18 existe un único handler efectivo de resolve differences', () => {
  const handlerMatches = authSource.match(/querySelector<HTMLElement>\('\[data-account-resolve\]'\)\?\.addEventListener\('click'/g) ?? [];
  assert.equal(handlerMatches.length, 1);
  assert.doesNotMatch(bootstrapSource, /data-account-resolve[^\n]*addEventListener|addEventListener[\s\S]*data-account-resolve/);
});

test('F19 recovery canónico no usa primitivas user-only/global como autoridad', () => {
  const resolve = functionBody(authSource, 'export async function resolveSyncDifferences', 'export function hasAuthenticatedSession');
  const restore = functionBody(authSource, 'export function restoreLatestLocalBackupRecovery', 'export async function resolveSyncDifferences');
  for (const body of [resolve, restore]) {
    assert.doesNotMatch(body, /getSyncState\(|restoreSyncStateSnapshot\([^s]|authorizeConfirmedCloudResolution\([^s]/);
    assert.doesNotMatch(body, /replaceData\(/);
    assert.doesNotMatch(body, /pushCloudData\(state\.crm|pullCloudData\(state\.crm/);
  }
});

test('F20 current tenant normal puede alcanzar resolveSyncDifferences tenant-aware', () => {
  const body = functionBody(authSource, 'export async function resolveSyncDifferences', 'export function hasAuthenticatedSession');
  assert.match(body, /const scope = requireCurrentTenantScope\(\);\s*const runtimeLease = captureTenantRuntimeLease\(scope\);/);
  assert.match(body, /replaceDataForTenant\(scope, mergedSnapshot\)/);
  assert.match(body, /pushCloudData\(scope, mergedSnapshot\)/);
  assert.match(body, /pullCloudData\(scope, mergedSnapshot\)/);
});

test('F21 current tenant normal puede restaurar backup válido por API explícita', () => {
  const storage = reset();
  const a = scope(ORG_A);
  prepare(a, crmFor(ORG_A, 'A-current'));
  seedBackup(storage, a, crmFor(ORG_A, 'A-restored'));
  assert.equal(restoreLatestLocalBackupForTenant(a, captureTenantRuntimeLease(a)), true);
  assert.equal(state.crm.organization.name, 'A-restored');
});

test('F22 cancelación del confirm produce cero mutaciones', () => {
  const storage = reset();
  const a = scope(ORG_A);
  prepare(a, crmFor(ORG_A, 'A-current'));
  seedBackup(storage, a, crmFor(ORG_A, 'A-backup'));
  const beforeCrm = structuredClone(state.crm);
  const beforeBackup = storage.getItem(tenantStorageNamespace(a).backupsKey);
  assert.equal(restoreLatestLocalBackupRecovery(() => false), false);
  assert.deepEqual(state.crm, beforeCrm);
  assert.equal(storage.getItem(tenantStorageNamespace(a).backupsKey), beforeBackup);
});

test('F23 verificación posterior conserva copia mergeada tenant-scoped antes de verificar cloud', () => {
  const body = functionBody(authSource, 'export async function resolveSyncDifferences', 'export function hasAuthenticatedSession');
  const write = body.indexOf("reason: 'Unión segura antes de sincronizar'");
  const push = body.indexOf('await pushCloudData(scope, mergedSnapshot)');
  const verify = body.indexOf('const verified = await pullCloudData(scope, mergedSnapshot)');
  assert.ok(write >= 0 && push > write && verify > push);
  assert.match(body, /markTenantSyncError\(scope, message\)/);
});

test('F24 disponibilidad y restore validan tenant; no normalizan organizationId del backup', () => {
  assert.match(tenantStorageSource, /hasTenantLocalBackup[\s\S]*readTenantBackups\(scope, storage\)\.length > 0/);
  assert.match(tenantStorageSource, /validBackupEntryForOrganization[\s\S]*rawOrganizationIdFromValue\(backup\.crm\) === organizationId/);
  assert.doesNotMatch(tenantStorageSource, /backup\.crm\.organization\.id\s*=/);
});
