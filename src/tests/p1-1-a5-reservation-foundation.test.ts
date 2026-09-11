import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TenantScope } from '../active-organization.js';
import {
  cloudRecordsToCrm,
  crmToCloudRecords,
  membershipContext,
  organizationScopedEntityKey,
  reconcileCrmAssignments,
  staleCloudRecords,
  type CloudEntityType,
  type CloudMembershipRow,
} from '../cloud-records.js';
import {
  initialData,
  type CrmData,
  type Reservation,
  type ReservationStatus,
} from '../models.js';
import { reconcileCrmSnapshots } from '../sync-reconciliation.js';
import { installTenantRuntimeScope, invalidateTenantRuntimeScope } from '../tenant-runtime.js';
import { readTenantSnapshot, writeTenantSnapshot } from '../tenant-storage.js';
import { assignmentVisible } from '../team-policy.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const organizationId = '33333333-3333-4333-8333-333333333333';

const memberships: CloudMembershipRow[] = [
  { organization_id: organizationId, member_id: 10, user_id: 'owner-user', role: 'owner', status: 'active', display_name: 'Dueño', email: 'owner@example.com' },
  { organization_id: organizationId, member_id: 15, user_id: 'admin-user', role: 'admin', status: 'active', display_name: 'Administrador', email: 'admin@example.com' },
  { organization_id: organizationId, member_id: 20, user_id: 'agent-user', role: 'agent', status: 'active', display_name: 'Corredor A', email: 'agent@example.com' },
  { organization_id: organizationId, member_id: 30, user_id: 'other-agent-user', role: 'agent', status: 'active', display_name: 'Corredor B', email: 'other-agent@example.com' },
];

function context(userId: string) {
  return membershipContext(memberships, userId);
}

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 1,
    clientId: 101,
    propertyId: 201,
    offerId: 501,
    amount: 3000,
    currency: 'USD',
    paymentMethod: 'Transferencia',
    conditions: 'Sujeta a documentación respaldatoria',
    reservedAt: '2026-08-25T12:00:00.000Z',
    expiresAt: '2026-08-28T12:00:00.000Z',
    status: 'Activa',
    assignedToId: 20,
    createdById: 20,
    createdAt: '2026-08-25T12:00:00.000Z',
    updatedAt: '2026-08-25T12:00:00.000Z',
    ...overrides,
  };
}

function crmFixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.teamMembers = context('owner-user').members;
  crm.reservations = [
    reservation({ id: 1, assignedToId: 20, createdById: 20 }),
    reservation({
      id: 2,
      clientId: 102,
      propertyId: 202,
      offerId: undefined,
      amount: 1500000,
      currency: 'ARS',
      paymentMethod: undefined,
      conditions: undefined,
      expiresAt: undefined,
      status: 'Cancelada',
      assignedToId: 30,
      createdById: 30,
    }),
  ];
  return crm;
}

test('P1.1-A5 define ReservationStatus y Reservation exactos sin relación inversa en Offer', () => {
  const statuses: ReservationStatus[] = ['Activa', 'Cancelada', 'Concretada'];
  assert.deepEqual(statuses, ['Activa', 'Cancelada', 'Concretada']);

  const source = readFileSync('src/models.ts', 'utf8');
  assert.match(source, /export type ReservationStatus = 'Activa' \| 'Cancelada' \| 'Concretada';/);
  const block = source.match(/export interface Reservation \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(block);
  const fields = [...block.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)(\?)?:/gm)].map((match) => `${match[1]}${match[2] || ''}`);
  assert.deepEqual(fields, [
    'id', 'clientId', 'propertyId', 'offerId?', 'amount', 'currency', 'paymentMethod?', 'conditions?',
    'reservedAt', 'expiresAt?', 'status', 'assignedToId', 'createdById', 'createdAt', 'updatedAt',
  ]);
  assert.match(block, /currency: OfferCurrency;/);
  const offerBlock = source.match(/export interface Offer \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(offerBlock);
  assert.doesNotMatch(offerBlock, /reservationId/);
});

test('P1.1-A5 agrega CrmData.reservations e initialData.reservations=[]', () => {
  const source = readFileSync('src/models.ts', 'utf8');
  const crmBlock = source.match(/export interface CrmData \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(crmBlock, /reservations: Reservation\[\];/);
  assert.deepEqual(initialData.reservations, []);
});

test('P1.1-A5 Reservation hace round-trip local tenant-aware, conserva todos sus campos y queda aislada por organización', async () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

  const scopeA: TenantScope = Object.freeze({
    userId: 'reservation-roundtrip-user',
    organizationId,
  });
  const scopeB: TenantScope = Object.freeze({
    userId: scopeA.userId,
    organizationId: '44444444-4444-4444-8444-444444444444',
  });

  const crmA = structuredClone(initialData);
  crmA.organization.id = scopeA.organizationId;
  crmA.reservations = [];
  const crmB = structuredClone(initialData);
  crmB.organization.id = scopeB.organizationId;
  crmB.reservations = [];

  writeTenantSnapshot(scopeA, crmA, { markDirty: false, reason: 'Reservation tenant A base' }, storage);
  writeTenantSnapshot(scopeB, crmB, { markDirty: false, reason: 'Reservation tenant B base' }, storage);

  const expected = reservation({ id: 9, assignedToId: 1, createdById: 1 });
  const expectedWithoutOffer = reservation({
    id: 10,
    offerId: undefined,
    assignedToId: 1,
    createdById: 1,
  });

  const store = await import('../store.js');
  try {
    installTenantRuntimeScope(scopeA, scopeA.userId);
    store.activateStorageForTenant(scopeA);
    assert.deepEqual(store.state.crm.reservations, []);

    store.state.crm.reservations = [expected, expectedWithoutOffer];
    store.saveData('P1.1-A5 tenant-aware Reservation round-trip');

    const persistedA = readTenantSnapshot(scopeA, storage);
    assert.ok(persistedA);
    assert.deepEqual(persistedA.reservations, [expected, expectedWithoutOffer]);
    assert.deepEqual(persistedA.reservations[0], expected);
    assert.deepEqual(Object.keys(persistedA.reservations[0] ?? {}), [
      'id', 'clientId', 'propertyId', 'offerId', 'amount', 'currency', 'paymentMethod', 'conditions',
      'reservedAt', 'expiresAt', 'status', 'assignedToId', 'createdById', 'createdAt', 'updatedAt',
    ]);
    assert.equal(persistedA.reservations[0]?.id, expected.id);
    assert.equal(persistedA.reservations[0]?.clientId, expected.clientId);
    assert.equal(persistedA.reservations[0]?.propertyId, expected.propertyId);
    assert.equal(persistedA.reservations[0]?.offerId, expected.offerId);
    assert.equal(persistedA.reservations[0]?.amount, expected.amount);
    assert.equal(persistedA.reservations[0]?.currency, expected.currency);
    assert.equal(persistedA.reservations[0]?.paymentMethod, expected.paymentMethod);
    assert.equal(persistedA.reservations[0]?.conditions, expected.conditions);
    assert.equal(persistedA.reservations[0]?.reservedAt, expected.reservedAt);
    assert.equal(persistedA.reservations[0]?.expiresAt, expected.expiresAt);
    assert.equal(persistedA.reservations[0]?.status, expected.status);
    assert.equal(persistedA.reservations[0]?.assignedToId, expected.assignedToId);
    assert.equal(persistedA.reservations[0]?.createdById, expected.createdById);
    assert.equal(persistedA.reservations[0]?.createdAt, expected.createdAt);
    assert.equal(persistedA.reservations[0]?.updatedAt, expected.updatedAt);
    assert.equal(persistedA.reservations[1]?.offerId, undefined);

    installTenantRuntimeScope(scopeB, scopeB.userId);
    store.activateStorageForTenant(scopeB);
    assert.deepEqual(store.state.crm.reservations, []);
    assert.deepEqual(readTenantSnapshot(scopeB, storage)?.reservations, []);

    const rereadA = readTenantSnapshot(scopeA, storage);
    assert.deepEqual(rereadA?.reservations, [expected, expectedWithoutOffer]);
  } finally {
    invalidateTenantRuntimeScope();
  }
});

test('P1.1-A5 CloudEntityType serializa reservation, hidrata y conserva offerId opcional', () => {
  const entityType: CloudEntityType = 'reservation';
  assert.equal(entityType, 'reservation');

  const crm = crmFixture();
  const owner = context('owner-user');
  const rows = crmToCloudRecords(crm, owner, 'owner-user');
  const reservationRows = rows.filter((row) => row.entity_type === 'reservation');
  assert.equal(reservationRows.length, 2);
  assert.equal(reservationRows[0]?.assigned_member_id, 20);
  assert.equal(reservationRows[0]?.created_by, 'owner-user');
  assert.equal(reservationRows[0]?.entity_key, organizationScopedEntityKey(organizationId, 1));
  assert.deepEqual(reservationRows[0]?.payload, crm.reservations[0]);

  const restored = cloudRecordsToCrm(rows, owner, structuredClone(crm));
  assert.deepEqual(restored.reservations, crm.reservations);
  assert.equal(restored.reservations[0]?.offerId, 501);
  assert.equal(restored.reservations[1]?.offerId, undefined);
});

test('P1.1-A5 reconcile assignments incluye reservations y normaliza assignedToId/createdById', () => {
  const crm = crmFixture();
  crm.teamMembers = [{ id: 1, userId: 'agent-user', name: 'Legacy agent', email: 'agent@example.com', role: 'Corredor', status: 'Activo', createdAt: '2026-08-01T00:00:00.000Z' }];
  crm.reservations = [reservation({ assignedToId: 1, createdById: 1 })];
  const reconciled = reconcileCrmAssignments(crm, context('agent-user'));
  assert.equal(reconciled.reservations[0]?.assignedToId, 20);
  assert.equal(reconciled.reservations[0]?.createdById, 20);

  const legacy = structuredClone(crmFixture()) as Partial<CrmData> & { reservations?: Reservation[] };
  delete legacy.reservations;
  assert.deepEqual(reconcileCrmAssignments(legacy as CrmData, context('owner-user')).reservations, []);
});

test('P1.1-A5 visibilidad conserva alcance actual: corredor sólo propio y dueño/admin todo', () => {
  const crm = crmFixture();
  const ownerRows = crmToCloudRecords(crm, context('owner-user'), 'owner-user').filter((row) => row.entity_type === 'reservation');
  const adminRows = crmToCloudRecords(crm, context('admin-user'), 'admin-user').filter((row) => row.entity_type === 'reservation');
  const agentRows = crmToCloudRecords(crm, context('agent-user'), 'agent-user').filter((row) => row.entity_type === 'reservation');

  assert.deepEqual(ownerRows.map((row) => (row.payload as Reservation).id), [1, 2]);
  assert.deepEqual(adminRows.map((row) => (row.payload as Reservation).id), [1, 2]);
  assert.deepEqual(agentRows.map((row) => (row.payload as Reservation).id), [1]);
  assert.equal(agentRows[0]?.assigned_member_id, 20);
  assert.deepEqual(crm.reservations.filter((item) => assignmentVisible('Corredor', 20, item.assignedToId)).map((item) => item.id), [1]);
  assert.deepEqual(crm.reservations.filter((item) => assignmentVisible('Dueño', 10, item.assignedToId)).map((item) => item.id), [1, 2]);
  assert.deepEqual(crm.reservations.filter((item) => assignmentVisible('Administrador', 15, item.assignedToId)).map((item) => item.id), [1, 2]);
});

test('P1.1-A5 stale handling detecta Reservation removida y conserva vigente', () => {
  const crm = crmFixture();
  const owner = context('owner-user');
  const current = crmToCloudRecords(crm, owner, 'owner-user');
  assert.equal(staleCloudRecords(current, current).some((row) => row.entity_type === 'reservation'), false);

  const reduced = structuredClone(crm);
  reduced.reservations = [crm.reservations[0]!];
  const next = crmToCloudRecords(reduced, owner, 'owner-user');
  const removed = staleCloudRecords(current, next).filter((row) => row.entity_type === 'reservation');
  assert.deepEqual(removed.map((row) => row.entity_key), [organizationScopedEntityKey(organizationId, 2)]);
});

test('P1.1-A5 sync reconciliation incluye reservations sin estrategia paralela', () => {
  const base = crmFixture();
  const local = structuredClone(base);
  const cloud = structuredClone(base);
  local.reservations = [reservation({ id: 3, assignedToId: 20, createdById: 20 })];
  cloud.reservations = [reservation({ id: 4, assignedToId: 20, createdById: 20 })];

  const result = reconcileCrmSnapshots(local, cloud);
  const difference = result.differences.find((item) => item.key === 'reservations');
  assert.ok(difference);
  assert.deepEqual(difference.localOnly, ['Registro 3']);
  assert.deepEqual(difference.cloudOnly, ['Registro 4']);
  assert.deepEqual(difference.conflicts, []);
  assert.deepEqual(result.merged.reservations.map((item) => item.id), [3, 4]);
});

test('P1.1-A5 existir Reservation no modifica pipeline, nextAction, nextFollowUp, Reminder ni ActivityEntry', () => {
  const crm = structuredClone(initialData);
  const clientBefore = structuredClone(crm.clients[0]);
  const remindersBefore = structuredClone(crm.reminders);
  const activityBefore = structuredClone(crm.activityLog);
  crm.reservations = [reservation({
    assignedToId: 1,
    createdById: 1,
    clientId: crm.clients[0]!.id,
    propertyId: crm.properties[0]!.id,
  })];
  assert.equal(crm.clients[0]?.pipeline, clientBefore?.pipeline);
  assert.equal(crm.clients[0]?.nextAction, clientBefore?.nextAction);
  assert.equal(crm.clients[0]?.nextFollowUp, clientBefore?.nextFollowUp);
  assert.deepEqual(crm.clients[0], clientBefore);
  assert.deepEqual(crm.reminders, remindersBefore);
  assert.deepEqual(crm.activityLog, activityBefore);
});

test('P1.1-A5 Reservations participa del cloud tenant-aware sin contaminar Agenda/Reminder', () => {
  const crm = crmFixture();
  const owner = context('owner-user');
  const rows = crmToCloudRecords(crm, owner, 'owner-user');
  const reservationRows = rows.filter((row) => row.entity_type === 'reservation');

  assert.equal(reservationRows.length, 2);
  assert.equal(reservationRows[0]?.organization_id, organizationId);
  assert.equal(reservationRows[0]?.entity_key, organizationScopedEntityKey(organizationId, 1));
  assert.equal(reservationRows[0]?.assigned_member_id, 20);
  assert.deepEqual(reservationRows[0]?.payload, crm.reservations[0]);
  assert.equal((reservationRows[0]?.payload as Reservation).offerId, 501);
  assert.equal((reservationRows[1]?.payload as Reservation).offerId, undefined);

  const restored = cloudRecordsToCrm(rows, owner, structuredClone(crm));
  assert.deepEqual(restored.reservations, crm.reservations);

  const reduced = structuredClone(crm);
  reduced.reservations = [crm.reservations[0]!];
  const reducedRows = crmToCloudRecords(reduced, owner, 'owner-user');
  assert.deepEqual(
    staleCloudRecords(rows, reducedRows)
      .filter((row) => row.entity_type === 'reservation')
      .map((row) => row.entity_key),
    [organizationScopedEntityKey(organizationId, 2)],
  );

  const local = structuredClone(crm);
  const cloud = structuredClone(crm);
  local.reservations = [reservation({ id: 30, assignedToId: 20, createdById: 20 })];
  cloud.reservations = [reservation({ id: 40, assignedToId: 20, createdById: 20, offerId: undefined })];
  const reconciled = reconcileCrmSnapshots(local, cloud);
  assert.deepEqual(reconciled.merged.reservations.map((item) => item.id), [30, 40]);
  assert.deepEqual(reconciled.differences.find((item) => item.key === 'reservations')?.localOnly, ['Registro 30']);
  assert.deepEqual(reconciled.differences.find((item) => item.key === 'reservations')?.cloudOnly, ['Registro 40']);

  const compatible = readFileSync('src/cloud-api-compatible.ts', 'utf8');
  assert.match(compatible, /pullTenantCloudData/);
  assert.match(compatible, /pushTenantModernCloudData/);
  assert.match(compatible, /pushTenantLegacyCloudData/);
  assert.match(compatible, /pushCloudDataWithVisitAuthorityV2/);
  assert.doesNotMatch(compatible, /\b(?:push|pull|sync|save)Reservations?\w*\b/);

  const agenda = readFileSync('src/agenda.ts', 'utf8');
  const models = readFileSync('src/models.ts', 'utf8');
  const reminderBlock = models.match(/export interface Reminder \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.doesNotMatch(agenda, /\breservations\b/);
  assert.doesNotMatch(reminderBlock, /Reservation|reservation/);
});

test('P1.1-A5 migración amplía únicamente el CHECK con exactamente 11 entity_type canónicos', () => {
  const migration = readFileSync('supabase/migrations/20260825030000_p1_1_a5_reservation_entity_type.sql', 'utf8');
  const entityTypes = [...migration.matchAll(/'([^']+)'::text/g)].map((match) => match[1]);
  assert.deepEqual(entityTypes, [
    'organization',
    'client',
    'property',
    'commercial_contact',
    'reminder',
    'ficha',
    'conversation',
    'activity',
    'visit',
    'offer',
    'reservation',
  ]);
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;/);
  assert.match(migration, /to_regclass\('public\.propcontrol_records'\)/);
  assert.match(migration, /expected check constraint propcontrol_records_entity_type_check was not found/);
  assert.match(migration, /drop constraint propcontrol_records_entity_type_check/);
  assert.match(migration, /add constraint propcontrol_records_entity_type_check/);
  assert.equal((migration.match(/alter table public\.propcontrol_records/gi) ?? []).length, 2);

  assert.doesNotMatch(migration, /\binsert\b|\bupdate\b|\bdelete\b/i);
  assert.doesNotMatch(migration, /create\s+policy|drop\s+policy|grant\s|revoke\s|row level security/i);
  assert.doesNotMatch(migration, /create\s+table|drop\s+table|add\s+column|drop\s+column|alter\s+column|create\s+index|drop\s+index/i);
  assert.doesNotMatch(migration, /create\s+(or\s+replace\s+)?function|create\s+trigger|drop\s+trigger|organization_members/i);
});
