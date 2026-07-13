import assert from 'node:assert/strict';
import test from 'node:test';
import { initialData } from '../models.js';
import {
  cloudRecordsToCrm,
  crmToCloudRecords,
  membershipContext,
  organizationScopedEntityKey,
  reconcileCrmAssignments,
  staleCloudRecords,
  type CloudMembershipContext,
  type CloudMembershipRow,
  type CloudRecordRow,
} from '../cloud-records.js';

const organizationId = '11111111-1111-4111-8111-111111111111';

const memberships: CloudMembershipRow[] = [
  {
    organization_id: organizationId,
    member_id: 10,
    user_id: 'owner-user',
    role: 'owner',
    status: 'active',
    display_name: 'Dueño',
    email: 'dueno@example.com',
  },
  {
    organization_id: organizationId,
    member_id: 20,
    user_id: 'agent-user',
    role: 'agent',
    status: 'active',
    display_name: 'Corredor',
    email: 'corredor@example.com',
  },
];

function context(userId: string): CloudMembershipContext {
  return membershipContext(memberships, userId);
}

function crmFixture() {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.teamMembers = context('owner-user').members;
  crm.clients = [
    { ...crm.clients[0]!, id: 1, assignedToId: 10, createdById: 10, name: 'Cliente dueño' },
    { ...crm.clients[0]!, id: 2, assignedToId: 20, createdById: 20, name: 'Cliente corredor' },
  ];
  crm.properties = [
    { ...crm.properties[0]!, id: 1, assignedToId: 10, createdById: 10, title: 'Propiedad dueño' },
    { ...crm.properties[0]!, id: 2, assignedToId: 20, createdById: 20, title: 'Propiedad corredor' },
  ];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.activityLog = [
    { id: 1, actorId: 10, action: 'Dueño', entityType: 'Equipo', detail: 'Cambio dueño', createdAt: '2026-07-13T00:00:00.000Z' },
    { id: 2, actorId: 20, action: 'Corredor', entityType: 'Equipo', detail: 'Cambio corredor', createdAt: '2026-07-13T00:00:00.000Z' },
  ];
  return crm;
}

test('normaliza membresías y detecta el usuario actual', () => {
  const owner = context('owner-user');
  const agent = context('agent-user');
  assert.equal(owner.currentRole, 'Dueño');
  assert.equal(owner.currentMemberId, 10);
  assert.equal(agent.currentRole, 'Corredor');
  assert.equal(agent.currentMemberId, 20);
  assert.equal(agent.members.length, 2);
});

test('reconcilia IDs locales con los miembros reales de Supabase', () => {
  const legacy = structuredClone(initialData);
  legacy.teamMembers = [
    { id: 1, name: 'Dueño local', email: '', role: 'Dueño', status: 'Activo', createdAt: '2026-07-13T00:00:00.000Z' },
    { id: 2, name: 'Corredor local', email: 'corredor@example.com', role: 'Corredor', status: 'Activo', createdAt: '2026-07-13T00:00:00.000Z' },
  ];
  legacy.clients = [
    { ...legacy.clients[0]!, id: 1, assignedToId: 1, createdById: 1 },
    { ...legacy.clients[0]!, id: 2, assignedToId: 2, createdById: 2 },
    { ...legacy.clients[0]!, id: 3, assignedToId: 999, createdById: 999 },
  ];
  const reconciled = reconcileCrmAssignments(legacy, context('owner-user'));
  assert.deepEqual(reconciled.clients.map((client) => client.assignedToId), [10, 20, 10]);
  assert.deepEqual(reconciled.clients.map((client) => client.createdById), [10, 20, 10]);
  assert.deepEqual(reconciled.teamMembers.map((member) => member.id), [10, 20]);
});

test('el dueño serializa configuración y toda la operación', () => {
  const records = crmToCloudRecords(crmFixture(), context('owner-user'), 'owner-user');
  assert.ok(records.some((row) => row.entity_type === 'organization'));
  assert.deepEqual(
    records.filter((row) => row.entity_type === 'client').map((row) => row.assigned_member_id).sort(),
    [10, 20],
  );
  assert.equal(records.filter((row) => row.entity_type === 'activity').length, 2);
});

test('el corredor no sube configuración ni registros asignados a otros', () => {
  const records = crmToCloudRecords(crmFixture(), context('agent-user'), 'agent-user');
  assert.equal(records.some((row) => row.entity_type === 'organization'), false);
  assert.deepEqual(records.filter((row) => row.entity_type === 'client').map((row) => row.assigned_member_id), [20]);
  assert.deepEqual(records.filter((row) => row.entity_type === 'property').map((row) => row.assigned_member_id), [20]);
  assert.deepEqual(records.filter((row) => row.entity_type === 'activity').map((row) => row.assigned_member_id), [20]);
});

test('cada clave remota queda aislada por organización', () => {
  const key = organizationScopedEntityKey(organizationId, 7);
  assert.equal(key, `${organizationId}:7`);
  const records = crmToCloudRecords(crmFixture(), context('owner-user'), 'owner-user');
  assert.ok(records.every((row) => row.entity_key.startsWith(`${organizationId}:`)));
});

test('el corredor reconstruye solo las filas que Supabase autorizó', () => {
  const agent = context('agent-user');
  const authorized = crmToCloudRecords(crmFixture(), agent, 'agent-user');
  const reconstructed = cloudRecordsToCrm(authorized, agent, crmFixture());
  assert.deepEqual(reconstructed.clients.map((client) => client.id), [2]);
  assert.deepEqual(reconstructed.properties.map((property) => property.id), [2]);
  assert.equal(reconstructed.teamMembers.length, 2);
});

test('detecta registros eliminados sin confundir organizaciones', () => {
  const base: CloudRecordRow[] = [
    {
      organization_id: organizationId,
      entity_type: 'client',
      entity_key: organizationScopedEntityKey(organizationId, 1),
      assigned_member_id: 10,
      payload: { id: 1 },
    },
    {
      organization_id: organizationId,
      entity_type: 'client',
      entity_key: organizationScopedEntityKey(organizationId, 2),
      assigned_member_id: 10,
      payload: { id: 2 },
    },
  ];
  assert.deepEqual(staleCloudRecords(base, [base[0]!]).map((row) => row.entity_key), [organizationScopedEntityKey(organizationId, 2)]);
});

test('rechaza una sesión sin membresía', () => {
  assert.throws(() => membershipContext(memberships, 'unknown-user'), /membresía válida/);
});
