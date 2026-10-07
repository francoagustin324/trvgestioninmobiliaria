import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './sec-fix-a1-2-c2-test-setup.js';
import type { TenantScope } from '../active-organization.js';
import { initialData, type CrmData, type TeamMember } from '../models.js';
import {
  authenticatedTenantMember,
  canRestoreLatestLocalBackup,
  replaceDataForTenant,
  restoreLatestLocalBackupForTenant,
  setActiveMemberId,
  state,
} from '../store.js';
import { canUseRecovery } from '../team-access.js';
import {
  captureTenantRuntimeLease,
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
} from '../tenant-runtime.js';
import {
  hasTenantLocalBackup,
  readTenantSyncState,
  tenantStorageNamespace,
} from '../tenant-storage.js';

const TEAM_VIEW_KEY = 'propcontrol-active-team-member-v1';
const ORG_A = '00000000-0000-0000-0000-00000000f101';
const ORG_B = '00000000-0000-0000-0000-00000000f102';
const OWNER = 'fdr01-owner';
const ADMIN = 'fdr01-admin';
const AGENT = 'fdr01-agent';
const OTHER = 'fdr01-other';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function installStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  });
  return storage;
}

function tenantScope(userId: string, organizationId = ORG_A): TenantScope {
  return Object.freeze({ userId, organizationId });
}

function teamMember(
  id: number,
  userId: string | undefined,
  role: TeamMember['role'],
  status: TeamMember['status'] = 'Activo',
): TeamMember {
  const base = structuredClone(initialData.teamMembers[0]!);
  return {
    ...base,
    id,
    userId,
    name: `${role} ${id}`,
    email: `${userId ?? `member-${id}`}@example.com`,
    role,
    status,
    createdAt: '2026-09-09T00:00:00.000Z',
  };
}

function crmFor(
  organizationId: string,
  label: string,
  members: TeamMember[],
): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.organization.name = label;
  crm.teamMembers = structuredClone(members);
  return crm;
}

function prepare(scope: TenantScope, crm: CrmData): void {
  installTenantRuntimeScope(scope, scope.userId);
  assert.equal(replaceDataForTenant(scope, crm, false), true);
}

function seedBackup(storage: Storage, scope: TenantScope, crm: CrmData): void {
  storage.setItem(
    tenantStorageNamespace(scope).backupsKey,
    JSON.stringify([{ createdAt: '2026-09-09T00:00:00.000Z', reason: 'FDR-01 fixture', crm }]),
  );
}

function reset(): MemoryStorage {
  invalidateTenantRuntimeScope();
  state.crm = structuredClone(initialData);
  state.activeMemberId = state.crm.teamMembers[0]!.id;
  return installStorage();
}

const storeSource = readFileSync('src/store.ts', 'utf8');
const teamAccessSource = readFileSync('src/team-access.ts', 'utf8');
const authSource = readFileSync('src/mvp-auth.ts', 'utf8');
const settingsSource = readFileSync('src/settings-ui.ts', 'utf8');

function functionBody(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} boundary missing`);
  return source.slice(start, end);
}

test('FDR01-01 Owner autenticado exacto puede ejecutar Recovery', () => {
  const storage = reset();
  const scope = tenantScope(OWNER);
  const current = crmFor(ORG_A, 'owner-current', [
    teamMember(1, OWNER, 'Dueño'),
    teamMember(2, AGENT, 'Corredor'),
  ]);
  prepare(scope, current);
  seedBackup(storage, scope, crmFor(ORG_A, 'owner-restored', current.teamMembers));

  assert.equal(authenticatedTenantMember(scope)?.id, 1);
  assert.equal(canRestoreLatestLocalBackup(scope), true);
  assert.equal(canUseRecovery(), true);
  assert.equal(restoreLatestLocalBackupForTenant(scope, captureTenantRuntimeLease(scope)), true);
  assert.equal(state.crm.organization.name, 'owner-restored');
});

test('FDR01-02 Administrador autenticado exacto puede ejecutar Recovery según política actual', () => {
  const storage = reset();
  const scope = tenantScope(ADMIN);
  const current = crmFor(ORG_A, 'admin-current', [
    teamMember(1, OWNER, 'Dueño'),
    teamMember(2, ADMIN, 'Administrador'),
  ]);
  prepare(scope, current);
  seedBackup(storage, scope, crmFor(ORG_A, 'admin-restored', current.teamMembers));

  assert.equal(state.activeMemberId, 1, 'la vista puede seguir cayendo en Owner');
  assert.equal(authenticatedTenantMember(scope)?.id, 2);
  assert.equal(canRestoreLatestLocalBackup(scope), true);
  assert.equal(canUseRecovery(), true);
  assert.equal(restoreLatestLocalBackupForTenant(scope, captureTenantRuntimeLease(scope)), true);
});

test('FDR01-03 Corredor autenticado + TEAM_VIEW_KEY=Owner queda DENEGADO', () => {
  const storage = reset();
  storage.setItem(TEAM_VIEW_KEY, '1');
  const scope = tenantScope(AGENT);
  const current = crmFor(ORG_A, 'agent-current', [
    teamMember(1, OWNER, 'Dueño'),
    teamMember(2, AGENT, 'Corredor'),
  ]);
  prepare(scope, current);
  seedBackup(storage, scope, crmFor(ORG_A, 'must-not-restore', current.teamMembers));

  assert.equal(state.activeMemberId, 1);
  assert.equal(authenticatedTenantMember(scope)?.id, 2);
  assert.equal(canRestoreLatestLocalBackup(scope), false);
  assert.equal(canUseRecovery(), false);
  assert.equal(restoreLatestLocalBackupForTenant(scope, captureTenantRuntimeLease(scope)), false);
  assert.equal(state.crm.organization.name, 'agent-current');
  assert.equal(hasTenantLocalBackup(scope, storage), true);
});

test('FDR01-04 Corredor autenticado + fallback visual Owner queda DENEGADO', () => {
  const storage = reset();
  const scope = tenantScope(AGENT);
  const current = crmFor(ORG_A, 'agent-fallback-current', [
    teamMember(1, OWNER, 'Dueño'),
    teamMember(2, AGENT, 'Corredor'),
  ]);
  prepare(scope, current);
  seedBackup(storage, scope, crmFor(ORG_A, 'must-not-restore-fallback', current.teamMembers));

  assert.equal(storage.getItem(TEAM_VIEW_KEY), null);
  assert.equal(state.activeMemberId, 1);
  assert.equal(canRestoreLatestLocalBackup(scope), false);
  assert.equal(restoreLatestLocalBackupForTenant(scope, captureTenantRuntimeLease(scope)), false);
  assert.equal(state.crm.organization.name, 'agent-fallback-current');
});

test('FDR01-05 authenticated user sin TeamMember exacto falla cerrado', () => {
  const storage = reset();
  const scope = tenantScope(OTHER);
  const current = crmFor(ORG_A, 'missing-member-current', [
    teamMember(1, OWNER, 'Dueño'),
    teamMember(2, ADMIN, 'Administrador'),
  ]);
  prepare(scope, current);
  seedBackup(storage, scope, crmFor(ORG_A, 'must-not-restore-missing', current.teamMembers));

  assert.equal(authenticatedTenantMember(scope), null);
  assert.equal(canRestoreLatestLocalBackup(scope), false);
  assert.equal(canUseRecovery(), false);
  assert.equal(restoreLatestLocalBackupForTenant(scope, captureTenantRuntimeLease(scope)), false);
});

test('FDR01-06 TeamMember exacto Suspendido queda DENEGADO', () => {
  const storage = reset();
  const scope = tenantScope(ADMIN);
  const current = crmFor(ORG_A, 'suspended-current', [
    teamMember(1, OWNER, 'Dueño'),
    teamMember(2, ADMIN, 'Administrador', 'Suspendido'),
  ]);
  prepare(scope, current);
  seedBackup(storage, scope, crmFor(ORG_A, 'must-not-restore-suspended', current.teamMembers));

  assert.equal(authenticatedTenantMember(scope), null);
  assert.equal(canRestoreLatestLocalBackup(scope), false);
  assert.equal(canUseRecovery(), false);
  assert.equal(restoreLatestLocalBackupForTenant(scope, captureTenantRuntimeLease(scope)), false);
});

test('FDR01-07 preference visual originada en tenant B no altera autoridad de tenant A', () => {
  const storage = reset();
  const scopeB = tenantScope(OWNER, ORG_B);
  const crmB = crmFor(ORG_B, 'tenant-b', [teamMember(1, OWNER, 'Dueño')]);
  prepare(scopeB, crmB);
  setActiveMemberId(1);
  assert.equal(storage.getItem(TEAM_VIEW_KEY), '1');

  const scopeA = tenantScope(AGENT, ORG_A);
  const crmA = crmFor(ORG_A, 'tenant-a', [
    teamMember(1, OWNER, 'Dueño'),
    teamMember(2, AGENT, 'Corredor'),
  ]);
  prepare(scopeA, crmA);
  seedBackup(storage, scopeA, crmFor(ORG_A, 'must-not-restore-cross-visual', crmA.teamMembers));

  assert.equal(state.activeMemberId, 1, 'la preference visual global puede sobrevivir');
  assert.equal(authenticatedTenantMember(scopeA)?.id, 2);
  assert.equal(canRestoreLatestLocalBackup(scopeA), false);
  assert.equal(restoreLatestLocalBackupForTenant(scopeA, captureTenantRuntimeLease(scopeA)), false);
});

test('FDR01-08 Recovery autorizado conserva restore, write dirty y enqueue tenant-scoped', () => {
  const storage = reset();
  const scope = tenantScope(OWNER);
  const members = [teamMember(1, OWNER, 'Dueño')];
  prepare(scope, crmFor(ORG_A, 'authorized-current', members));
  seedBackup(storage, scope, crmFor(ORG_A, 'authorized-restored', members));

  assert.equal(restoreLatestLocalBackupForTenant(scope, captureTenantRuntimeLease(scope)), true);
  assert.equal(state.crm.organization.name, 'authorized-restored');
  assert.equal(readTenantSyncState(scope, storage).dirty, true);

  const restore = functionBody(
    storeSource,
    'export function restoreLatestLocalBackupForTenant',
    'export function restoreLatestLocalBackup()',
  );
  assert.match(restore, /queueCloudSave\(scope, restoredSnapshot\)/);
});

test('FDR01-09 actor visual puede seguir existiendo sin convertirse en authority', () => {
  reset();
  const scope = tenantScope(AGENT);
  const current = crmFor(ORG_A, 'visual-current', [
    teamMember(1, OWNER, 'Dueño'),
    teamMember(2, AGENT, 'Corredor'),
  ]);
  prepare(scope, current);
  setActiveMemberId(1);

  assert.equal(state.activeMemberId, 1);
  assert.equal(localStorage.getItem(TEAM_VIEW_KEY), '1');
  assert.equal(authenticatedTenantMember(scope)?.id, 2);
  assert.equal(canRestoreLatestLocalBackup(scope), false);
  assert.equal(canUseRecovery(), false);
});

test('FDR01-10 static/call-path: Recovery no deriva permiso de activeMemberId/TEAM_VIEW_KEY', () => {
  const authority = functionBody(
    storeSource,
    'export function authenticatedTenantMember',
    'export function canRestoreLatestLocalBackup',
  );
  assert.match(authority, /member\.userId === scope\.userId/);
  assert.match(authority, /member\.status === 'Activo'/);
  assert.match(authority, /matches\.length === 1/);
  assert.doesNotMatch(authority, /activeMemberId|TEAM_VIEW_KEY|role === 'Dueño'/);

  const canRestore = functionBody(
    storeSource,
    'export function canRestoreLatestLocalBackup',
    'export function restoreLatestLocalBackupForTenant',
  );
  assert.match(canRestore, /authenticatedTenantMember\(scope\)/);
  assert.doesNotMatch(canRestore, /activeMemberId|TEAM_VIEW_KEY/);

  const restore = functionBody(
    storeSource,
    'export function restoreLatestLocalBackupForTenant',
    'export function restoreLatestLocalBackup()',
  );
  const materialGuard = restore.indexOf('if (!canRestoreLatestLocalBackup(scope)) return false;');
  const materialRestore = restore.indexOf('restoreLatestTenantBackup(scope)');
  assert.ok(materialGuard >= 0 && materialRestore > materialGuard);

  const useRecovery = functionBody(
    teamAccessSource,
    'export function canUseRecovery',
    'export function canInviteTeamRole',
  );
  assert.match(useRecovery, /authenticatedTenantMember\(\)/);
  assert.doesNotMatch(useRecovery, /activeMember\(|activeMemberId|canManageTeam\(/);

  assert.match(authSource, /import \{ canUseRecovery \} from '\.\/team-access\.js'/);
  assert.match(authSource, /recoveryTarget\.innerHTML = canUseRecovery\(\) \? restoreAction : ''/);
  assert.doesNotMatch(authSource, /canManageTeam\(\)/);
  assert.match(settingsSource, /const recoverySection = canUseRecovery\(\)/);
});
