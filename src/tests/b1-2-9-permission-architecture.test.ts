import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { ModuleId, TeamRole } from '../models.js';
import {
  roleCanAccessModule,
  roleCanManageTeam,
  roleCanViewAll,
} from '../team-policy.js';

function source(path: string): string {
  return readFileSync(join(process.cwd(), 'src', path), 'utf8');
}

const roles: TeamRole[] = ['Dueño', 'Administrador', 'Corredor'];
const commercialModules: ModuleId[] = ['crm', 'whatsapp', 'agenda', 'propiedades'];

test('B1.2.9 conserva la matriz actual de roles y módulos', () => {
  for (const role of roles) {
    for (const module of commercialModules) {
      assert.equal(roleCanAccessModule(role, module), true, `${role} debe conservar ${module}.`);
    }
  }

  assert.equal(roleCanManageTeam('Dueño'), true);
  assert.equal(roleCanManageTeam('Administrador'), true);
  assert.equal(roleCanManageTeam('Corredor'), false);
  assert.equal(roleCanViewAll('Dueño'), true);
  assert.equal(roleCanViewAll('Administrador'), true);
  assert.equal(roleCanViewAll('Corredor'), false);
  assert.equal(roleCanAccessModule('Corredor', 'configuracion'), false);
  assert.equal(roleCanAccessModule('Corredor', 'equipo'), false);
});

test('B1.2.9 centraliza capacidades administrativas sobre la política existente', () => {
  const access = source('team-access.ts');
  for (const capability of [
    'canAccessSettings',
    'canAdministerTeam',
    'canUseRecovery',
    'canInviteTeamRole',
    'canChangeTeamMemberRole',
    'canChangeTeamMemberStatus',
  ]) {
    assert.match(access, new RegExp(`export function ${capability}\\(`));
  }

  assert.match(access, /export function canUseRecovery\(\): boolean \{\s+const member = authenticatedTenantMember\(\);\s+return Boolean\(\s+member\s+&& roleCanManageTeam\(member\.role\)\s+&& roleCanAccessModule\(member\.role, 'configuracion'\),\s+\);\s+\}/);
  assert.match(access, /return canManageTeam\(member\) && canAccessModule\('equipo', member\);/);
  assert.match(access, /roleCanManageTeam\(member\.role\)/);
});

test('B1.2.9 protege Configuración, recuperación y Equipo al renderizar y al ejecutar', () => {
  const settings = source('settings-ui.ts');
  const recovery = source('account-menu-product.ts');
  const users = source('mvp-users-ui.ts');
  const store = source('store.ts');

  assert.match(settings, /if \(!canAccessSettings\(\)\) \{/);
  assert.match(settings, /const recoverySection = canUseRecovery\(\)/);
  assert.match(settings, /form\?\.addEventListener\('submit',[\s\S]*if \(!canAccessSettings\(\)\)/);

  assert.match(recovery, /document\.addEventListener\('click',[\s\S]*\[data-account-restore\][\s\S]*!target \|\| canUseRecovery\(\)/);
  assert.match(recovery, /stopImmediatePropagation\(\)/);
  assert.match(recovery, /\[data-account-restore\], \[data-settings-security-recovery\]/);

  assert.match(users, /const actor = authenticatedTeamActor\(renderScope, renderLease\);\s+if \(!canAccessModule\('equipo', actor\)\) \{/);
  assert.match(users, /const submitActor = authenticatedTeamActor\(renderScope, renderLease\);\s+if \(!canAdministerTeam\(submitActor\) \|\| !getCloudSession\(\)\)/);
  assert.match(users, /const changeActor = authenticatedTeamActor\(renderScope, renderLease\);\s+if \(!target \|\| !canChangeTeamMemberRole\(target, changeActor\)\)/);
  assert.match(users, /const statusActor = authenticatedTeamActor\(renderScope, renderLease\);\s+if \(!target \|\| !canChangeTeamMemberStatus\(target, statusActor\)\)/);
  assert.match(users, /const actor = authenticatedTenantMember\(scope\);\s+if \(!actor\) throw new Error\('AUTHENTICATED_TENANT_MEMBER_REQUIRED'\);/);

  const guardPosition = store.indexOf('if (!canRestoreLatestLocalBackup(scope)) return false;');
  const mutationPosition = store.indexOf('const restored = restoreLatestTenantBackup(scope);');
  assert.ok(guardPosition >= 0, 'Falta el guard tenant-aware de ejecución de recuperación.');
  assert.ok(mutationPosition > guardPosition, 'La autorización tenant-aware debe evaluarse antes de leer o aplicar la copia.');
  assert.match(store, /if \(!tenantScopesEqual\(scope, runtimeLease\.scope\)\) throw new Error\(TENANT_RUNTIME_STALE\);/);
  assert.match(store, /assertTenantRuntimeLeaseCurrent\(runtimeLease\);[\s\S]*if \(!canRestoreLatestLocalBackup\(scope\)\) return false;[\s\S]*assertTenantRuntimeLeaseCurrent\(runtimeLease\);[\s\S]*const restored = restoreLatestTenantBackup\(scope\);/);
  assert.match(store, /roleCanManageTeam\(member\.role\)/);
});

test('B1.2.9 conserva la autorización del servidor para administración de Equipo', () => {
  const server = source('server/team-management.ts');
  assert.match(server, /query\.searchParams\.set\('status', 'eq\.active'\);[\s\S]*if \(rows\.length !== 1\) throw new Error\('No tenés una membership ACTIVE exacta para esta inmobiliaria\.'\);[\s\S]*const role = exactMembershipRole\(requester\.role\);\s+if \(role !== 'owner' && role !== 'admin'\) throw new Error\('No tenés permiso para administrar usuarios\.'\);/);
  assert.match(server, /if \(exactMembershipRole\(requester\.role\) === 'admin' && existingRole !== 'agent'\)/);
  assert.match(server, /if \(exactMembershipRole\(requester\.role\) === 'admin' && normalizedRole\(targetMember\.role\) !== 'agent'\)/);
  assert.match(server, /if \(exactMembershipRole\(requester\.role\) === 'admin' && role !== 'agent'\)/);
});
