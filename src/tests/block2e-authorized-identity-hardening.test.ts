import './sec-fix-a1-2-c2-test-setup.js';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test, { afterEach } from 'node:test';
import type { TenantScope } from '../active-organization.js';
import {
  initialData,
  modules,
  type Client,
  type CrmData,
  type Property,
  type Reminder,
  type TeamMember,
  type TeamRole,
  type WhatsAppConversation,
} from '../models.js';
import { buildPropertyOpportunities } from '../property-opportunities.js';
import {
  activeMember,
  accessibleModules,
  addActivity,
  canAccessModule,
  canAccessSettings,
  canAdministerTeam,
  canChangeTeamMemberRole,
  canChangeTeamMemberStatus,
  canInviteTeamRole,
  canManageTeam,
  canViewAll,
  defaultAssigneeId,
  selectedTeamViewMember,
  visibleClients,
  visibleConversations,
  visibleProperties,
  visibleReminders,
} from '../team-access.js';
import {
  authenticatedTenantMember,
  state,
} from '../store.js';
import {
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
} from '../tenant-runtime.js';

const TEAM_VIEW_KEY = 'propcontrol-active-team-member-v1';

function member(id: number, userId: string, role: TeamRole, status: TeamMember['status'] = 'Activo'): TeamMember {
  return {
    id,
    userId,
    name: `${role} ${id}`,
    email: `${role.toLowerCase()}-${id}@example.test`,
    role,
    status,
    createdAt: '2026-09-26T10:00:00.000Z',
  };
}

function client(id: number, assignedToId: number, name: string): Client {
  return {
    id,
    name,
    phone: `549351555${String(id).padStart(4, '0')}`,
    interest: 'Dúplex en Docta',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Calificado',
    budget: 'USD 130.000',
    currency: 'USD',
    paymentMethod: 'Contado',
    zones: 'Docta',
    propertyType: 'Dúplex',
    operation: 'Compra',
    bedrooms: 2,
    assignedToId,
    createdById: assignedToId,
  };
}

function property(id: number, assignedToId: number, title: string): Property {
  return {
    id,
    title,
    address: 'Docta, Córdoba',
    type: 'Dúplex',
    operation: 'Venta',
    price: 120000,
    owner: 'Sintético',
    status: 'Activa',
    bedrooms: 2,
    assignedToId,
    createdById: assignedToId,
  };
}

function reminder(id: number, assignedToId: number, title: string): Reminder {
  return {
    id,
    date: '2026-09-27',
    title,
    related: 'Lead',
    priority: 'Alta',
    assignedToId,
    createdById: assignedToId,
  };
}

function conversation(id: number, clientId: number, assignedToId: number): WhatsAppConversation {
  return {
    id,
    clientId,
    phone: '5493515550000',
    mode: 'Humano',
    unread: 0,
    lastActivity: '2026-09-26T10:00:00.000Z',
    messages: [],
    assignedToId,
    createdById: assignedToId,
  };
}

function crmFor(
  organizationId: string,
  members: TeamMember[],
  ownerId: number,
  agentId: number,
): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: organizationId,
    name: `Org ${organizationId}`,
    seatLimit: null,
    planLabel: 'Block2E',
  };
  crm.teamMembers = members;
  crm.activityLog = [];
  crm.clients = [
    client(101, ownerId, `${organizationId} OWNER CLIENT`),
    client(102, agentId, `${organizationId} AGENT CLIENT`),
  ];
  crm.properties = [
    property(201, ownerId, `${organizationId} OWNER PROPERTY`),
    property(202, agentId, `${organizationId} AGENT PROPERTY`),
  ];
  crm.reminders = [
    reminder(301, ownerId, `${organizationId} OWNER REMINDER`),
    reminder(302, agentId, `${organizationId} AGENT REMINDER`),
  ];
  crm.conversations = [
    conversation(401, 101, ownerId),
    conversation(402, 102, agentId),
  ];
  crm.visits = [];
  crm.offers = [];
  crm.reservations = [];
  crm.contacts = [];
  crm.fichas = [];
  return crm;
}

function install(
  organizationId: string,
  authenticatedUserId: string,
  authenticatedRole: TeamRole = 'Corredor',
  activeMemberId = 1,
): { scope: TenantScope; owner: TeamMember; actor: TeamMember } {
  const owner = member(1, `owner-${organizationId}`, 'Dueño');
  const actor = member(2, authenticatedUserId, authenticatedRole);
  const scope = Object.freeze({ userId: authenticatedUserId, organizationId });
  installTenantRuntimeScope(scope, authenticatedUserId);
  state.crm = crmFor(organizationId, [owner, actor], owner.id, actor.id);
  state.activeMemberId = activeMemberId;
  localStorage.setItem(TEAM_VIEW_KEY, String(activeMemberId));
  return { scope, owner, actor };
}

afterEach(() => {
  invalidateTenantRuntimeScope();
  localStorage.clear();
});

test('2E crítico: TEAM_VIEW_KEY=Owner no eleva a un Corredor autenticado ni amplía oportunidades', () => {
  const { scope, owner, actor } = install('tenant-a', 'agent-a', 'Corredor', 1);

  assert.equal(localStorage.getItem(TEAM_VIEW_KEY), '1');
  assert.equal(state.activeMemberId, owner.id);
  assert.equal(activeMember().id, owner.id, 'La selección visual puede seguir mostrando Owner.');
  assert.equal(authenticatedTenantMember(scope)?.id, actor.id);
  assert.equal(authenticatedTenantMember(scope)?.role, 'Corredor');

  assert.deepEqual(visibleClients().map((item) => item.id), [102]);
  assert.deepEqual(visibleProperties().map((item) => item.id), [202]);
  assert.deepEqual(visibleReminders().map((item) => item.id), [302]);
  assert.deepEqual(visibleConversations().map((item) => item.id), [402]);

  assert.equal(canManageTeam(), false);
  assert.equal(canAdministerTeam(), false);
  assert.equal(canAccessSettings(), false);
  assert.equal(canAccessModule('equipo'), false);
  assert.equal(canAccessModule('configuracion'), false);
  assert.equal(canManageTeam(owner), false, 'Un member visual explícito tampoco puede ser autoridad.');
  assert.equal(canAdministerTeam(owner), false);
  assert.equal(canAccessModule('equipo', owner), false);
  assert.equal(canInviteTeamRole('Administrador', owner), false);
  assert.equal(canChangeTeamMemberRole(actor, owner), false);
  assert.equal(canChangeTeamMemberStatus(actor, owner), false);

  assert.deepEqual(accessibleModules().map(([id]) => id), ['crm', 'whatsapp', 'agenda', 'propiedades']);
  assert.equal(defaultAssigneeId(), actor.id);

  addActivity({
    action: '2E actor autorizado',
    entityType: 'Cliente',
    entityId: 102,
    detail: 'El actor debe ser el Corredor autenticado.',
  });
  assert.equal(state.crm.activityLog[0]?.actorId, actor.id);
  assert.notEqual(state.crm.activityLog[0]?.actorId, owner.id);

  const visibleProperty = visibleProperties()[0];
  assert.ok(visibleProperty);
  const opportunities = buildPropertyOpportunities(visibleProperty, visibleClients());
  assert.deepEqual(opportunities.map((item) => item.match.client.id), [102]);
});

test('2E crítico: IDs coincidentes entre tenants no convierten TEAM_VIEW_KEY en autoridad', () => {
  const a = install('tenant-a-collision', 'owner-a-collision', 'Dueño', 1);
  assert.equal(authenticatedTenantMember(a.scope)?.role, 'Dueño');
  assert.equal(state.activeMemberId, 1);
  assert.equal(canManageTeam(), true);

  const scopeB = Object.freeze({ userId: 'agent-b-collision', organizationId: 'tenant-b-collision' });
  const ownerB = member(1, 'owner-b-collision', 'Dueño');
  const agentB = member(2, scopeB.userId, 'Corredor');
  installTenantRuntimeScope(scopeB, scopeB.userId);
  state.crm = crmFor(scopeB.organizationId, [ownerB, agentB], 1, 2);
  // La preferencia global histórica conserva exactamente el ID peligroso.
  state.activeMemberId = 1;
  localStorage.setItem(TEAM_VIEW_KEY, '1');

  assert.equal(activeMember().id, ownerB.id);
  assert.equal(authenticatedTenantMember(scopeB)?.id, agentB.id);
  assert.equal(authenticatedTenantMember(scopeB)?.role, 'Corredor');
  assert.equal(authenticatedTenantMember(a.scope), null, 'El scope A quedó stale.');
  assert.equal(canManageTeam(), false);
  assert.equal(canAccessSettings(), false);
  assert.deepEqual(visibleClients().map((item) => item.id), [102]);
  assert.deepEqual(visibleProperties().map((item) => item.id), [202]);
  assert.equal(defaultAssigneeId(), agentB.id);
});

test('2E crítico: activeMemberId inválido no hace fallback autorizado al Owner', () => {
  const { scope, actor } = install('tenant-invalid-view', 'agent-invalid-view', 'Corredor', 999999);

  assert.equal(authenticatedTenantMember(scope)?.id, actor.id);
  assert.equal(selectedTeamViewMember(), null);
  assert.throws(() => activeMember(), /TEAM_VIEW_MEMBER_REQUIRED/);
  assert.equal(canManageTeam(), false);
  assert.equal(canAdministerTeam(), false);
  assert.equal(canAccessSettings(), false);
  assert.deepEqual(visibleClients().map((item) => item.assignedToId), [actor.id]);
  assert.deepEqual(visibleProperties().map((item) => item.assignedToId), [actor.id]);
  assert.equal(defaultAssigneeId(), actor.id);
});

test('2E fail closed: miembro suspendido o membresía ambigua no usa fallback visual', () => {
  const scope = Object.freeze({ userId: 'blocked-user', organizationId: 'tenant-blocked' });
  const owner = member(1, 'owner-blocked', 'Dueño');
  const suspended = member(2, scope.userId, 'Corredor', 'Suspendido');
  installTenantRuntimeScope(scope, scope.userId);
  state.crm = crmFor(scope.organizationId, [owner, suspended], 1, 2);
  state.activeMemberId = owner.id;
  localStorage.setItem(TEAM_VIEW_KEY, String(owner.id));

  assert.equal(authenticatedTenantMember(scope), null);
  assert.equal(canManageTeam(), false);
  assert.equal(canViewAll(), false);
  assert.equal(canAccessModule('crm'), false);
  assert.deepEqual(visibleClients(), []);
  assert.deepEqual(visibleProperties(), []);
  assert.deepEqual(visibleReminders(), []);
  assert.deepEqual(visibleConversations(), []);
  assert.throws(() => defaultAssigneeId(), /AUTHENTICATED_TENANT_MEMBER_REQUIRED/);
  assert.throws(() => addActivity({ action: 'No autorizado', entityType: 'Cliente', entityId: 1, detail: 'no' }), /AUTHENTICATED_TENANT_MEMBER_REQUIRED/);

  const duplicateA = member(2, scope.userId, 'Corredor');
  const duplicateB = member(3, scope.userId, 'Administrador');
  state.crm.teamMembers = [owner, duplicateA, duplicateB];
  assert.equal(authenticatedTenantMember(scope), null);
  assert.equal(canManageTeam(), false);
  assert.deepEqual(visibleClients(), []);
});

test('2E Owner y Administrador conservan capacidades reales aunque la vista apunte a otro miembro', () => {
  const ownerScope = Object.freeze({ userId: 'owner-real', organizationId: 'tenant-owner-real' });
  const owner = member(1, ownerScope.userId, 'Dueño');
  const visualAgent = member(2, 'agent-visual', 'Corredor');
  installTenantRuntimeScope(ownerScope, ownerScope.userId);
  state.crm = crmFor(ownerScope.organizationId, [owner, visualAgent], owner.id, visualAgent.id);
  state.activeMemberId = visualAgent.id;
  assert.equal(canManageTeam(), true);
  assert.equal(canAdministerTeam(), true);
  assert.equal(canAccessSettings(), true);
  assert.equal(canViewAll(), true);
  assert.deepEqual(accessibleModules(), modules);
  assert.equal(defaultAssigneeId(), owner.id);

  const adminScope = Object.freeze({ userId: 'admin-real', organizationId: 'tenant-admin-real' });
  const visualOwner = member(1, 'owner-admin-org', 'Dueño');
  const admin = member(2, adminScope.userId, 'Administrador');
  installTenantRuntimeScope(adminScope, adminScope.userId);
  state.crm = crmFor(adminScope.organizationId, [visualOwner, admin], visualOwner.id, admin.id);
  state.activeMemberId = visualOwner.id;
  assert.equal(canManageTeam(), true);
  assert.equal(canAdministerTeam(), true);
  assert.equal(canAccessSettings(), true);
  assert.equal(canViewAll(), true);
  assert.equal(canInviteTeamRole('Corredor'), true);
  assert.equal(canInviteTeamRole('Administrador'), false);
  assert.equal(defaultAssigneeId(), admin.id);
});

function productionSources(dir = 'src'): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (full === join('src', 'tests')) continue;
    const info = statSync(full);
    if (info.isDirectory()) result.push(...productionSources(full));
    else if (/\.(?:ts|js)$/.test(full)) result.push(full);
  }
  return result.sort();
}

test('2E inventario: activeMember queda sólo como selección visual y no reaparece en autorización productiva', () => {
  const files = productionSources();
  const activeMemberCallers = files.filter((file) => {
    if (file === 'src/team-access.ts') return false;
    return /\bactiveMember\s*\(/.test(readFileSync(file, 'utf8'));
  });
  assert.deepEqual(activeMemberCallers, [], `activeMember() fuera de presentación canónica: ${activeMemberCallers.join(', ')}`);

  const teamAccess = readFileSync('src/team-access.ts', 'utf8');
  assert.match(teamAccess, /selectedTeamViewMember/);
  assert.match(teamAccess, /AUTHENTICATED_TENANT_MEMBER_REQUIRED/);
  assert.doesNotMatch(teamAccess, /member\s*=\s*activeMember\(\)/);
  assert.doesNotMatch(teamAccess, /visibleByAssignment[\s\S]*activeMember\(\)/);

  const store = readFileSync('src/store.ts', 'utf8');
  assert.match(store, /TEAM_VIEW_KEY/);
  assert.match(store, /visual preference only/);

  const opportunities = readFileSync('src/property-opportunities-ui.ts', 'utf8');
  assert.match(opportunities, /const properties = visibleProperties\(\)/);
  assert.match(opportunities, /const clients = visibleClients\(\)/);

  const matching = readFileSync('src/property-opportunities.ts', 'utf8');
  assert.match(matching, /matchClientsForProperty\(property, clients\)/);

  const propertyUi = readFileSync('src/mvp-properties-ui.ts', 'utf8');
  assert.match(propertyUi, /const properties = visibleProperties\(\) as PropertyWithFicha\[\]/);
  assert.match(propertyUi, /return \(visibleProperties\(\) as PropertyWithFicha\[\]\)\.find/);

  for (const file of [
    'src/visit-workflow-ui.ts',
    'src/offer-workflow-ui.ts',
    'src/reservation-workflow-ui.ts',
    'src/legacy-quarantine/team-scope.ts',
    'src/legacy-quarantine/team-ui.ts',
    'src/legacy-quarantine/team-bootstrap.ts',
  ]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\bactiveMember\s*\(/, file);
  }
});

test('2E inventario: activeMemberId y TEAM_VIEW_KEY quedan confinados a presentación/hidratación visual', () => {
  const files = productionSources();
  const activeMemberIdFiles = files.filter((file) => /\bactiveMemberId\b/.test(readFileSync(file, 'utf8')));
  const allowedActiveMemberIdFiles = new Set([
    'src/lead-create-reliability.ts',
    'src/mvp-auth.ts',
    'src/store.ts',
    'src/team-access.ts',
    'src/whatsapp-contact-ui.ts',
  ]);
  assert.deepEqual(activeMemberIdFiles.filter((file) => !allowedActiveMemberIdFiles.has(file)), []);

  const teamViewKeyFiles = files.filter((file) => readFileSync(file, 'utf8').includes('TEAM_VIEW_KEY'));
  assert.deepEqual(teamViewKeyFiles, ['src/store.ts']);

  const setViewFiles = files.filter((file) => /\bsetActiveMemberId\s*\(/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(setViewFiles, [
    'src/auth-ui.ts',
    'src/mvp-auth.ts',
    'src/store.ts',
    'src/tenant-hydration.ts',
  ]);
});
