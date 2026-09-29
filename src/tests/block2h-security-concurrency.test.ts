import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLocalWriteAuthorityCompatible, type CloudMembershipContext } from '../cloud-records.js';
import {
  commercialAlertDedupeKey,
  evaluateCommercialAlertConditions,
  reconcileCommercialAlerts,
} from '../commercial-alert-engine.js';
import { defaultSettings, type Client, type CommercialAlert, type CrmData, type TeamMember } from '../models.js';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-09-29T12:00:00.000Z');

function member(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 7,
    userId: USER_A,
    name: 'Corredor A',
    email: 'a@example.com',
    phone: '',
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-09-29T00:00:00.000Z',
    ...overrides,
  };
}

function client(id: number, assignedToId: number, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name: `Cliente ${id}`,
    phone: '5493515550000',
    interest: 'Departamento',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    assignedToId,
    createdById: assignedToId,
    ...overrides,
  };
}

function crm(teamMembers = [member()]): CrmData {
  return {
    organization: { id: ORG_A, name: 'Inmobiliaria A', seatLimit: null, planLabel: 'Test' },
    teamMembers,
    activityLog: [],
    clients: [],
    properties: [],
    visits: [],
    offers: [],
    reservations: [],
    contacts: [],
    reminders: [],
    fichas: [],
    conversations: [],
    settings: { ...defaultSettings },
  };
}

function context(role: CloudMembershipContext['currentRole'] = 'Corredor', members = [member()]): CloudMembershipContext {
  return { organizationId: ORG_A, currentMemberId: 7, currentRole: role, members };
}

function alert(organizationId: string, id: number): CommercialAlert {
  const base = {
    organizationId,
    type: 'FOLLOW_UP_OVERDUE' as const,
    entityType: 'client' as const,
    entityId: 10,
    conditionVersion: '2026-09-28:llamar',
  };
  return {
    id,
    revision: 0,
    ...base,
    ownerId: 7,
    priority: 'ALTO',
    rank: 24,
    reason: 'Llamar',
    state: 'ACTIVE',
    createdAt: '2026-09-29T10:00:00.000Z',
    updatedAt: '2026-09-29T10:00:00.000Z',
    dueAt: '2026-09-28',
    actionType: 'REPROGRAM_FOLLOW_UP',
    action: 'Llamar',
    target: 'lead',
    name: 'Cliente',
    when: 'Vencido ayer',
    dedupeKey: commercialAlertDedupeKey(base),
    clientId: 10,
    sourceId: 10,
  };
}

test('Block 2H seguridad: evaluación queda confinada por tenant y responsable', () => {
  const own = client(10, 7);
  const other = client(11, 8);
  const conditions = evaluateCommercialAlertConditions({
    organizationId: ORG_A,
    clients: [own, other],
    properties: [],
    visits: [],
    offers: [],
    reservations: [],
    reminders: [],
    actor: { id: 7, role: 'Corredor' },
    now: NOW,
    today: '2026-09-29',
  });

  assert.ok(conditions.some((item) => item.clientId === own.id));
  assert.equal(conditions.some((item) => item.clientId === other.id), false, 'selector visual ajeno no amplía autoridad');
  assert.ok(conditions.every((item) => item.organizationId === ORG_A));

  const sameEntityA = commercialAlertDedupeKey({
    organizationId: ORG_A,
    type: 'NEW_LEAD_UNATTENDED',
    entityType: 'client',
    entityId: 10,
    conditionVersion: 'v1',
  });
  const sameEntityB = commercialAlertDedupeKey({
    organizationId: ORG_B,
    type: 'NEW_LEAD_UNATTENDED',
    entityType: 'client',
    entityId: 10,
    conditionVersion: 'v1',
  });
  assert.notEqual(sameEntityA, sameEntityB, 'mismo entityId entre tenants no colisiona');
});

test('Block 2H seguridad: membership suspendida o ambigua falla cerrado', () => {
  const suspended = member({ status: 'Suspendido' });
  assert.throws(
    () => assertLocalWriteAuthorityCompatible(crm([suspended]), context('Corredor', [suspended]), USER_A),
    /member-status-not-active/,
  );

  const duplicate = [member(), member({ id: 8 })];
  assert.throws(
    () => assertLocalWriteAuthorityCompatible(crm(duplicate), context('Corredor', duplicate), USER_A),
    /authenticated-member-ambiguous/,
  );
});

test('Block 2H concurrencia: resolución derivada es idempotente y una copia stale no resucita alerta', () => {
  const active = alert(ORG_A, 1);
  const resolvedOnce = reconcileCommercialAlerts([active], [], new Date('2026-09-29T11:00:00.000Z'));
  assert.equal(resolvedOnce[0]!.state, 'RESOLVED');

  const resolvedTwice = reconcileCommercialAlerts(resolvedOnce, [], new Date('2026-09-29T12:00:00.000Z'));
  assert.equal(resolvedTwice[0]!.state, 'RESOLVED');
  assert.equal(resolvedTwice[0]!.revision, resolvedOnce[0]!.revision, 'segunda resolución no genera write artificial');

  const staleDevice = reconcileCommercialAlerts([active], [], new Date('2026-09-29T12:00:00.000Z'));
  assert.equal(staleDevice[0]!.state, 'RESOLVED', 'sin condición de negocio no se puede reactivar ACTIVE');
});

test('Block 2H concurrencia: estados terminales equivalentes convergen sin duplicar', () => {
  const active = alert(ORG_A, 1);
  const deviceA = reconcileCommercialAlerts([active], [], new Date('2026-09-29T11:00:00.000Z'));
  const deviceB = reconcileCommercialAlerts([active], [], new Date('2026-09-29T11:00:00.000Z'));

  assert.deepEqual(deviceA, deviceB);
  const merged = reconcileCommercialAlerts(deviceA, [], new Date('2026-09-29T12:00:00.000Z'));
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.state, 'RESOLVED');
});
