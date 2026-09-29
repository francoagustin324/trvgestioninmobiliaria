import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertLocalWriteAuthorityCompatible,
  cloudRecordsToCrm,
  crmToCloudRecords,
  organizationScopedEntityKey,
  type CloudMembershipContext,
  type CloudRecordRow,
} from '../cloud-records.js';
import {
  commercialAlertDedupeKey,
  reconcileCommercialAlerts,
} from '../commercial-alert-engine.js';
import { commercialAlertConcurrentWriteAlreadySatisfied } from '../tenant-visit-v2.js';
import { defaultSettings, type CommercialAlert, type CrmData, type TeamMember } from '../models.js';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

function alert(
  organizationId: string,
  id: number,
  ownerId = 7,
  overrides: Partial<CommercialAlert> = {},
): CommercialAlert {
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
    ownerId,
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
    ...overrides,
  };
}

function crm(teamMembers = [member()]): CrmData {
  return {
    organization: {
      id: ORG_A,
      name: 'Inmobiliaria A',
      seatLimit: null,
      planLabel: 'Test',
    },
    teamMembers,
    activityLog: [],
    clients: [],
    properties: [],
    visits: [],
    offers: [],
    reservations: [],
    contacts: [],
    reminders: [],
    commercialAlerts: [],
    fichas: [],
    conversations: [],
    settings: { ...defaultSettings },
  };
}

function context(role: CloudMembershipContext['currentRole'] = 'Corredor', members = [member()]): CloudMembershipContext {
  return {
    organizationId: ORG_A,
    currentMemberId: 7,
    currentRole: role,
    members,
  };
}

test('Block 2H seguridad: alertas cloud quedan confinadas por tenant y responsable', () => {
  const data = crm();
  data.commercialAlerts = [
    alert(ORG_A, 1, 7),
    alert(ORG_A, 2, 8, { entityId: 11, clientId: 11, dedupeKey: commercialAlertDedupeKey({
      organizationId: ORG_A,
      type: 'FOLLOW_UP_OVERDUE',
      entityType: 'client',
      entityId: 11,
      conditionVersion: '2026-09-28:llamar',
    }) }),
    alert(ORG_B, 3, 7),
  ];

  const rows = crmToCloudRecords(data, context('Corredor'), USER_A)
    .filter((row) => row.entity_type === 'commercial_alert');
  assert.equal(rows.length, 1, 'Corredor sólo serializa su alerta del tenant actual');
  assert.equal((rows[0]!.payload as CommercialAlert).organizationId, ORG_A);
  assert.equal(rows[0]!.assigned_member_id, 7);
  assert.ok(rows[0]!.entity_key.startsWith(`${ORG_A}:`), 'entity_key queda scopeada por organización');

  const maliciousRow: CloudRecordRow = {
    organization_id: ORG_A,
    entity_type: 'commercial_alert',
    entity_key: organizationScopedEntityKey(ORG_A, 'malicious'),
    assigned_member_id: 7,
    payload: alert(ORG_B, 99, 7),
  };
  const hydrated = cloudRecordsToCrm([maliciousRow], context('Corredor'), crm());
  assert.deepEqual(hydrated.commercialAlerts, [], 'payload de otro tenant se descarta fail closed');
});

test('Block 2H seguridad: membership suspendida o ambigua no obtiene autoridad', () => {
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

test('Block 2H concurrencia: resolver es idempotente y una copia stale no resucita la alerta', () => {
  const active = alert(ORG_A, 1);
  const resolvedOnce = reconcileCommercialAlerts(
    [active],
    [],
    new Date('2026-09-29T11:00:00.000Z'),
  );
  assert.equal(resolvedOnce.length, 1);
  assert.equal(resolvedOnce[0]!.state, 'RESOLVED');

  const resolvedTwice = reconcileCommercialAlerts(
    resolvedOnce,
    [],
    new Date('2026-09-29T12:00:00.000Z'),
  );
  assert.equal(resolvedTwice.length, 1);
  assert.equal(resolvedTwice[0]!.state, 'RESOLVED');
  assert.equal(resolvedTwice[0]!.revision, resolvedOnce[0]!.revision, 'segunda resolución no genera write artificial');

  const staleDevice = reconcileCommercialAlerts(
    [active],
    [],
    new Date('2026-09-29T12:00:00.000Z'),
  );
  assert.equal(staleDevice[0]!.state, 'RESOLVED', 'estado de negocio sin condición nunca reactiva ACTIVE');

  const sameEntityOtherTenant = alert(ORG_B, 1);
  assert.notEqual(active.dedupeKey, sameEntityOtherTenant.dedupeKey, 'mismo entityId entre tenants no colisiona');

  const row = (value: CommercialAlert): CloudRecordRow => ({
    organization_id: ORG_A,
    entity_type: 'commercial_alert',
    entity_key: organizationScopedEntityKey(ORG_A, value.dedupeKey),
    assigned_member_id: 7,
    payload: value,
  });
  const localResolved = { ...resolvedOnce[0]!, updatedAt: '2026-09-29T11:00:00.000Z' };
  const remoteResolved = { ...resolvedOnce[0]!, id: 44, revision: 9, updatedAt: '2026-09-29T11:00:05.000Z' };
  assert.equal(
    commercialAlertConcurrentWriteAlreadySatisfied(row(localResolved), row(remoteResolved)),
    true,
    'dos dispositivos con el mismo estado terminal son idempotentes aunque difieran metadata local',
  );
  assert.equal(
    commercialAlertConcurrentWriteAlreadySatisfied(row(active), row(remoteResolved)),
    false,
    'ACTIVE stale nunca satisface ni resucita un RESOLVED remoto',
  );
});
