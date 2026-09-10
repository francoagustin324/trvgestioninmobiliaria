import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './sec-fix-a1-2-c2-test-setup.js';
import type { TenantScope } from '../active-organization.js';
import { initialData, type CrmData, type TeamMember } from '../models.js';
import { state } from '../store.js';
import { addActivityForAuthenticatedTenant } from '../team-access.js';
import {
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
} from '../tenant-runtime.js';
import { tenantStorageNamespace } from '../tenant-storage.js';

const leadSource = readFileSync('src/lead-create-reliability.ts', 'utf8');
const teamSource = readFileSync('src/team-access.ts', 'utf8');
const USER = 'a31-user';
const ORG_A = '00000000-0000-0000-0000-00000000a311';
const ORG_B = '00000000-0000-0000-0000-00000000b311';

function scope(organizationId: string): TenantScope {
  return Object.freeze({ userId: USER, organizationId });
}

function member(id: number, userId: string, role: TeamMember['role'] = 'Dueño'): TeamMember {
  return {
    id,
    userId,
    name: `${role} ${id}`,
    email: `${userId}-${id}@a31.test`,
    role,
    status: 'Activo',
    createdAt: '2026-09-10T12:00:00.000Z',
  };
}

function crmFor(organizationId: string, authenticatedMemberId: number, visualMemberId: number): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.organization.name = organizationId === ORG_A ? 'Org A' : 'Org B';
  crm.teamMembers = [
    member(authenticatedMemberId, USER, 'Dueño'),
    member(visualMemberId, `visual-${organizationId}`, 'Administrador'),
  ];
  crm.clients = [];
  crm.activityLog = [];
  return crm;
}

function prepare(tenantScope: TenantScope, crm: CrmData, visualMemberId: number): void {
  invalidateTenantRuntimeScope();
  installTenantRuntimeScope(tenantScope, tenantScope.userId);
  state.crm = crm;
  state.activeMemberId = visualMemberId;
  state.activeModule = 'crm';
  state.openForms.client = true;
}

function activityEntry() {
  return {
    action: 'Lead actualizado',
    entityType: 'Cliente' as const,
    entityId: 101,
    detail: 'A3.1',
  };
}

test('A3.1 Lead captura TenantScope y TenantRuntimeLease en WeakMap', () => {
  assert.match(leadSource, /new WeakMap<HTMLFormElement, LeadFormTenantContext>/);
  assert.match(leadSource, /requireCurrentTenantScope\(\)/);
  assert.match(leadSource, /captureTenantRuntimeLease\(scope\)/);
  assert.match(leadSource, /formTenantContexts\.set\(form, context\)/);
});

test('A3.1 no usa sync-safety directo ni snapshot user-only en Lead', () => {
  assert.doesNotMatch(leadSource, /from ['"]\.\/sync-safety\.js['"]/);
  assert.doesNotMatch(leadSource, /\breadLocalSnapshot\s*\(/);
  assert.doesNotMatch(leadSource, /\bwriteLocalSnapshot\s*\(/);
  assert.match(leadSource, /readTenantSnapshot\(context\.scope\)/);
  assert.match(leadSource, /writeTenantSnapshot\(context\.scope, state\.crm/);
});

test('A3.1 queue cloud de Lead recibe scope explícito', () => {
  assert.match(leadSource, /queueCloudSave\(context\.scope, state\.crm\)/);
  assert.doesNotMatch(leadSource, /queueCloudSave\(state\.crm/);
});

test('A3.1 creación usa member autenticado y edición preserva metadata histórica', () => {
  assert.match(leadSource, /const member = authenticatedWriteMember\(context\.scope\)/);
  assert.match(leadSource, /client\.assignedToId = previous\?\.assignedToId \?\? member\.id/);
  assert.match(leadSource, /client\.createdById = previous\?\.createdById \?\? member\.id/);
  assert.doesNotMatch(leadSource, /\bactiveMember\s*\(/);
});

test('A3.1 activity de Lead usa helper autenticado sin actorId controlable por UI', () => {
  assert.match(leadSource, /addActivityForAuthenticatedTenant\(context\.scope, activity\)/);
  assert.match(teamSource, /export function addActivityForAuthenticatedTenant\(scope: TenantScope, entry: NewActivityEntry\)/);
  assert.doesNotMatch(teamSource, /addActivityForAuthenticatedTenant\([^)]*actorId/);
  assert.match(teamSource, /appendActivity\(entry, member\.id\)/);
});

test('A3.1 fences cubren mutación, snapshot, cloud y rollback', () => {
  const fenceCount = (leadSource.match(/assertLeadFormTenantCurrent\(context\)/g) ?? []).length;
  assert.ok(fenceCount >= 6, `fences encontrados=${fenceCount}`);
  assert.match(leadSource, /if \(!tenantRuntimeLeaseIsCurrent\(context\.runtimeLease\)\) return;/);
  assert.match(leadSource, /assertTenantCrmScope\(context\.scope, previousCrm\)/);
  assert.match(leadSource, /assertTenantCrmScope\(context\.scope, state\.crm\)/);
});

test('A3.1 activeMemberId queda limitado a staleness visual y no write identity', () => {
  assert.match(leadSource, /viewMemberId: state\.activeMemberId/);
  assert.match(leadSource, /state\.activeMemberId !== context\.viewMemberId/);
  assert.doesNotMatch(leadSource, /createdById\s*=.*activeMemberId/);
  assert.doesNotMatch(leadSource, /assignedToId\s*=.*activeMemberId/);
});

test('A3.1 authenticated activity ignora member visual y usa owner autenticado', () => {
  const tenantScope = scope(ORG_A);
  const crm = crmFor(ORG_A, 11, 91);
  prepare(tenantScope, crm, 91);
  addActivityForAuthenticatedTenant(tenantScope, activityEntry());
  assert.equal(state.crm.activityLog[0]?.actorId, 11);
  assert.notEqual(state.crm.activityLog[0]?.actorId, state.activeMemberId);
});

test('A3.1 authenticated agent no adquiere identidad visual owner/admin', () => {
  const tenantScope = scope(ORG_A);
  const crm = structuredClone(initialData);
  crm.organization.id = ORG_A;
  crm.teamMembers = [
    member(1, 'visual-owner', 'Dueño'),
    member(31, USER, 'Corredor'),
  ];
  crm.activityLog = [];
  prepare(tenantScope, crm, 1);
  addActivityForAuthenticatedTenant(tenantScope, activityEntry());
  assert.equal(state.crm.activityLog[0]?.actorId, 31);
});

test('A3.1 mismo usuario usa member id correspondiente a Org A y Org B', () => {
  const scopeA = scope(ORG_A);
  const crmA = crmFor(ORG_A, 11, 91);
  prepare(scopeA, crmA, 91);
  addActivityForAuthenticatedTenant(scopeA, activityEntry());
  assert.equal(state.crm.activityLog[0]?.actorId, 11);

  const scopeB = scope(ORG_B);
  const crmB = crmFor(ORG_B, 22, 92);
  prepare(scopeB, crmB, 92);
  addActivityForAuthenticatedTenant(scopeB, activityEntry());
  assert.equal(state.crm.activityLog[0]?.actorId, 22);
});

test('A3.1 helper falla cerrado sin exactamente una membership activa autenticada', () => {
  const tenantScope = scope(ORG_A);
  const crm = crmFor(ORG_A, 11, 91);
  crm.teamMembers.push(member(12, USER, 'Corredor'));
  prepare(tenantScope, crm, 91);
  assert.throws(
    () => addActivityForAuthenticatedTenant(tenantScope, activityEntry()),
    /AUTHENTICATED_TENANT_MEMBER_REQUIRED/,
  );
  assert.equal(state.crm.activityLog.length, 0);
});

test('A3.1 snapshots A/B poseen namespaces distintos para el mismo usuario', () => {
  const namespaceA = tenantStorageNamespace(scope(ORG_A));
  const namespaceB = tenantStorageNamespace(scope(ORG_B));
  assert.notEqual(namespaceA.crmKey, namespaceB.crmKey);
  assert.match(namespaceA.crmKey, new RegExp(`user:${USER}:org:${ORG_A}$`));
  assert.match(namespaceB.crmKey, new RegExp(`user:${USER}:org:${ORG_B}$`));
});