import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLocalWriteAuthorityCompatible, type CloudMembershipContext } from '../cloud-records.js';
import {
  commercialAlertDedupeKey,
  evaluateCommercialAlertConditions,
  VISIT_CONFIRMED_ACTION,
  withoutVisitConfirmationActivity,
} from '../commercial-alert-engine.js';
import { defaultSettings, type Client, type CrmData, type TeamMember } from '../models.js';

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

test('Block 2H seguridad: membership faltante, suspendida o ambigua falla cerrado', () => {
  assert.throws(
    () => assertLocalWriteAuthorityCompatible(crm([]), context('Corredor', []), USER_A),
    /authenticated-member-missing/,
  );

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

test('Block 2H concurrencia derivada: snapshots equivalentes producen obligaciones equivalentes sin estado paralelo', () => {
  const snapshot = {
    organizationId: ORG_A,
    clients: [client(10, 7, { pipeline: 'Contactado', lastContact: '2026-09-20', nextAction: undefined, nextFollowUp: undefined })],
    properties: [],
    visits: [],
    offers: [],
    reservations: [],
    reminders: [],
    activityLog: [],
    actor: { id: 7, role: 'Corredor' as const },
    now: NOW,
    today: '2026-09-29',
  };
  const deviceA = evaluateCommercialAlertConditions(snapshot);
  const deviceB = evaluateCommercialAlertConditions(structuredClone(snapshot));
  assert.deepEqual(deviceA, deviceB);

  const resolved = evaluateCommercialAlertConditions({
    ...snapshot,
    clients: [{ ...snapshot.clients[0]!, nextAction: 'Llamar', nextFollowUp: '2026-10-02' }],
  });
  assert.equal(resolved.some((item) => item.type === 'FORGOTTEN_LEAD'), false);
});

test('Block 2H concurrencia: rollback de confirmación preserva mutaciones posteriores', () => {
  const confirmation = {
    id: 1,
    uid: '33333333-3333-4333-8333-333333333333',
    revision: 0,
    actorId: 7,
    action: VISIT_CONFIRMED_ACTION,
    entityType: 'Cliente' as const,
    entityId: 10,
    detail: 'visitId=90\nscheduledAt=2026-09-30T15:00:00.000Z',
    createdAt: '2026-09-29T11:00:00.000Z',
  };
  const laterActivity = {
    id: 2,
    uid: '44444444-4444-4444-8444-444444444444',
    revision: 0,
    actorId: 7,
    action: 'Seguimiento actualizado',
    entityType: 'Cliente' as const,
    entityId: 10,
    detail: 'Cambio posterior que debe sobrevivir',
    createdAt: '2026-09-29T11:01:00.000Z',
  };
  const current = crm();
  current.clients = [client(10, 7, { nextAction: 'Cambio posterior', nextFollowUp: '2026-10-03' })];
  current.activityLog = [laterActivity, confirmation];

  current.activityLog = withoutVisitConfirmationActivity(current.activityLog, confirmation);

  assert.deepEqual(current.activityLog.map((entry) => entry.id), [2], 'rollback elimina sólo la confirmación fallida');
  assert.equal(current.clients[0]!.nextAction, 'Cambio posterior', 'rollback no pisa una mutación posterior del lead');
  assert.equal(current.clients[0]!.nextFollowUp, '2026-10-03', 'rollback conserva el seguimiento posterior');

  const secondPass = withoutVisitConfirmationActivity(current.activityLog, confirmation);
  assert.deepEqual(secondPass, current.activityLog, 'rollback repetido es idempotente y no elimina otra actividad');
});
