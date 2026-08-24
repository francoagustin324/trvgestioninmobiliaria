import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  cloudRecordsToCrm,
  crmToCloudRecords,
  isSupervisedRecommendationTelemetryPayload,
  membershipContext,
  organizationScopedEntityKey,
  reconcileCrmAssignments,
  staleCloudRecords,
  type CloudMembershipRow,
  type CloudRecordRow,
} from '../cloud-records.js';
import {
  initialData,
  STORAGE_KEY,
  type CrmData,
  type Offer,
  type OfferCurrency,
  type OfferOrigin,
  type OfferStatus,
} from '../models.js';
import { reconcileCrmSnapshots } from '../sync-reconciliation.js';
import {
  hasLocalBackup,
  readLocalSnapshot,
  restoreLatestBackup,
  writeLocalSnapshot,
} from '../sync-safety.js';
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

const organizationId = '22222222-2222-4222-8222-222222222222';

const memberships: CloudMembershipRow[] = [
  { organization_id: organizationId, member_id: 10, user_id: 'owner-user', role: 'owner', status: 'active', display_name: 'Dueño', email: 'owner@example.com' },
  { organization_id: organizationId, member_id: 15, user_id: 'admin-user', role: 'admin', status: 'active', display_name: 'Administrador', email: 'admin@example.com' },
  { organization_id: organizationId, member_id: 20, user_id: 'agent-user', role: 'agent', status: 'active', display_name: 'Corredor A', email: 'agent@example.com' },
  { organization_id: organizationId, member_id: 30, user_id: 'other-agent-user', role: 'agent', status: 'active', display_name: 'Corredor B', email: 'other-agent@example.com' },
];

function context(userId: string) {
  return membershipContext(memberships, userId);
}

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 1,
    clientId: 101,
    propertyId: 201,
    origin: 'Cliente',
    amount: 75000,
    currency: 'USD',
    paymentTerms: 'Contado contra escritura',
    conditions: 'Sujeto a revisión documental',
    validUntil: '2026-09-01',
    status: 'Pendiente',
    assignedToId: 20,
    createdById: 20,
    createdAt: '2026-08-24T15:00:00.000Z',
    updatedAt: '2026-08-24T15:00:00.000Z',
    ...overrides,
  };
}

function crmFixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.teamMembers = context('owner-user').members;
  crm.offers = [
    offer({ id: 1, assignedToId: 20, createdById: 20 }),
    offer({
      id: 2,
      clientId: 102,
      propertyId: 202,
      origin: 'Propietario',
      parentOfferId: 1,
      amount: 82000,
      currency: 'USD',
      status: 'Contraofertada',
      assignedToId: 30,
      createdById: 30,
    }),
  ];
  return crm;
}

test('P1.1-A3 define el modelo Offer exacto y sus dominios cerrados', () => {
  const origins: OfferOrigin[] = ['Cliente', 'Propietario'];
  const statuses: OfferStatus[] = ['Pendiente', 'Aceptada', 'Rechazada', 'Contraofertada', 'Retirada'];
  const currencies: OfferCurrency[] = ['USD', 'ARS'];
  assert.deepEqual(origins, ['Cliente', 'Propietario']);
  assert.deepEqual(statuses, ['Pendiente', 'Aceptada', 'Rechazada', 'Contraofertada', 'Retirada']);
  assert.deepEqual(currencies, ['USD', 'ARS']);

  const source = readFileSync('src/models.ts', 'utf8');
  const block = source.match(/export interface Offer \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(block);
  const fields = [...block.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)(\?)?:/gm)].map((match) => `${match[1]}${match[2] || ''}`);
  assert.deepEqual(fields, [
    'id', 'clientId', 'propertyId', 'origin', 'parentOfferId?', 'amount', 'currency', 'paymentTerms?',
    'conditions?', 'validUntil?', 'status', 'assignedToId', 'createdById', 'createdAt', 'updatedAt',
  ]);
  assert.doesNotMatch(block, /nextAction|nextFollowUp|Reminder|reservation|reservationAmount|commission|commissionPercent|commissionAmount|won|lost/);
});

test('P1.1-A3 soporta parentOfferId opcional, amount numérico y rondas independientes', () => {
  const first = offer({ id: 1, origin: 'Cliente', amount: 75000, parentOfferId: undefined });
  const second = offer({ id: 2, origin: 'Propietario', amount: 82000, parentOfferId: 1, status: 'Contraofertada' });
  const third = offer({ id: 3, origin: 'Cliente', amount: 79000, parentOfferId: 2 });
  assert.equal(typeof first.amount, 'number');
  assert.equal(first.parentOfferId, undefined);
  assert.equal(second.parentOfferId, 1);
  assert.equal(third.parentOfferId, 2);
  assert.deepEqual([first.amount, second.amount, third.amount], [75000, 82000, 79000]);
});

test('P1.1-A3 normaliza snapshot histórico sin offers a offers=[] y conserva round-trip local', async () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

  const legacy = structuredClone(initialData) as Partial<CrmData> & { offers?: Offer[] };
  delete legacy.offers;
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

  const store = await import('../store.js');
  assert.deepEqual(store.state.crm.offers, []);

  const expected = offer({ id: 9, assignedToId: 1, createdById: 1 });
  store.state.crm.offers = [expected];
  store.saveData('P1.1-A3 local Offer');
  assert.deepEqual(readLocalSnapshot(storage)?.offers, [expected]);

  store.activateStorageForCurrentSession();
  assert.deepEqual(store.state.crm.offers, [expected]);
});

test('P1.1-A3 backup y restore conservan offers sin estrategia paralela', () => {
  const storage = new MemoryStorage();
  const first = structuredClone(initialData);
  first.offers = [offer({ id: 7, assignedToId: 1, createdById: 1 })];
  writeLocalSnapshot(first, { markDirty: true, reason: 'Offer base' }, storage);

  const second = structuredClone(first);
  second.offers[0] = offer({ id: 7, assignedToId: 1, createdById: 1, status: 'Retirada', updatedAt: '2026-08-24T16:00:00.000Z' });
  writeLocalSnapshot(second, { markDirty: true, reason: 'Offer modificada' }, storage);

  assert.equal(hasLocalBackup(storage), true);
  const restored = restoreLatestBackup(storage);
  assert.ok(restored);
  assert.deepEqual(restored.offers, first.offers);
  assert.deepEqual(readLocalSnapshot(storage)?.offers, first.offers);
});

test('P1.1-A3 tolera CRM legacy sin offers en reconcile assignments', () => {
  const legacy = structuredClone(crmFixture()) as Partial<CrmData> & { offers?: Offer[] };
  delete legacy.offers;
  const reconciled = reconcileCrmAssignments(legacy as CrmData, context('owner-user'));
  assert.deepEqual(reconciled.offers, []);
});

test('P1.1-A3 serializa Offer como entity_type offer y la hidrata idéntica', () => {
  const crm = crmFixture();
  const owner = context('owner-user');
  const rows = crmToCloudRecords(crm, owner, 'owner-user');
  const offerRows = rows.filter((row) => row.entity_type === 'offer');

  assert.equal(offerRows.length, 2);
  assert.equal(offerRows[0]?.assigned_member_id, 20);
  assert.equal(offerRows[0]?.created_by, 'owner-user');
  assert.equal(offerRows[0]?.entity_key, organizationScopedEntityKey(organizationId, 1));
  assert.deepEqual(offerRows[0]?.payload, crm.offers[0]);

  const restored = cloudRecordsToCrm(rows, owner, structuredClone(crm));
  assert.deepEqual(restored.offers, crm.offers);
});

test('P1.1-A3 owner/admin ven offers permitidas y corredor sólo assignedToId propio', () => {
  const crm = crmFixture();
  const ownerRows = crmToCloudRecords(crm, context('owner-user'), 'owner-user').filter((row) => row.entity_type === 'offer');
  const adminRows = crmToCloudRecords(crm, context('admin-user'), 'admin-user').filter((row) => row.entity_type === 'offer');
  const agentRows = crmToCloudRecords(crm, context('agent-user'), 'agent-user').filter((row) => row.entity_type === 'offer');

  assert.deepEqual(ownerRows.map((row) => (row.payload as Offer).id), [1, 2]);
  assert.deepEqual(adminRows.map((row) => (row.payload as Offer).id), [1, 2]);
  assert.deepEqual(agentRows.map((row) => (row.payload as Offer).id), [1]);
  assert.equal(agentRows[0]?.assigned_member_id, 20);
  assert.deepEqual(crm.offers.filter((item) => assignmentVisible('Corredor', 20, item.assignedToId)).map((item) => item.id), [1]);
  assert.deepEqual(crm.offers.filter((item) => assignmentVisible('Dueño', 10, item.assignedToId)).map((item) => item.id), [1, 2]);
  assert.deepEqual(crm.offers.filter((item) => assignmentVisible('Administrador', 15, item.assignedToId)).map((item) => item.id), [1, 2]);
});

test('P1.1-A3 reconcile assignments normaliza responsables legacy de Offer', () => {
  const crm = crmFixture();
  crm.teamMembers = [{ id: 1, userId: 'agent-user', name: 'Legacy agent', email: 'agent@example.com', role: 'Corredor', status: 'Activo', createdAt: '2026-08-01T00:00:00.000Z' }];
  crm.offers = [offer({ assignedToId: 1, createdById: 1 })];
  const reconciled = reconcileCrmAssignments(crm, context('agent-user'));
  assert.equal(reconciled.offers[0]?.assignedToId, 20);
  assert.equal(reconciled.offers[0]?.createdById, 20);
});

test('P1.1-A3 reconciliation conserva local-only, cloud-only, igualdad y conflicto sin perder offers', () => {
  const base = crmFixture();
  const local = structuredClone(base);
  const cloud = structuredClone(base);
  local.offers = [offer({ id: 1, amount: 75000 })];
  cloud.offers = [offer({ id: 2, amount: 82000 })];

  const split = reconcileCrmSnapshots(local, cloud);
  const difference = split.differences.find((item) => item.key === 'offers');
  assert.ok(difference);
  assert.deepEqual(difference.localOnly, ['Registro 1']);
  assert.deepEqual(difference.cloudOnly, ['Registro 2']);
  assert.deepEqual(difference.conflicts, []);
  assert.deepEqual(split.merged.offers.map((item) => item.id), [1, 2]);

  const sameLocal = structuredClone(base);
  const sameCloud = structuredClone(base);
  sameLocal.offers = [offer({ id: 3 })];
  sameCloud.offers = [offer({ id: 3 })];
  const same = reconcileCrmSnapshots(sameLocal, sameCloud);
  assert.deepEqual(same.merged.offers.map((item) => item.id), [3]);
  assert.deepEqual(same.differences.find((item) => item.key === 'offers')?.conflicts, []);

  sameCloud.offers = [offer({ id: 3, amount: 81000 })];
  const conflict = reconcileCrmSnapshots(sameLocal, sameCloud);
  assert.deepEqual(conflict.differences.find((item) => item.key === 'offers')?.conflicts, ['Registro 3']);
  assert.equal(conflict.merged.offers[0]?.amount, sameLocal.offers[0]?.amount);
});

test('P1.1-A3 stale Offer se detecta sin tocar telemetría B1.4.2', () => {
  const crm = crmFixture();
  const owner = context('owner-user');
  const current = crmToCloudRecords(crm, owner, 'owner-user');
  const telemetry: CloudRecordRow = {
    organization_id: organizationId,
    entity_type: 'activity',
    entity_key: organizationScopedEntityKey(organizationId, 'b1-4-2-event'),
    assigned_member_id: 10,
    payload: { recordKind: 'supervised_recommendation_event', event: 'SHOWN' },
    created_by: 'owner-user',
  };

  const unchanged = staleCloudRecords([...current, telemetry], current);
  assert.equal(unchanged.some((row) => row.entity_type === 'offer'), false);
  assert.equal(unchanged.some((row) => row.entity_key === telemetry.entity_key), false);

  const reduced = structuredClone(crm);
  reduced.offers = [crm.offers[0]!];
  const next = crmToCloudRecords(reduced, owner, 'owner-user');
  const removed = staleCloudRecords(current, next).filter((row) => row.entity_type === 'offer');
  assert.deepEqual(removed.map((row) => row.entity_key), [organizationScopedEntityKey(organizationId, 2)]);
  assert.equal(isSupervisedRecommendationTelemetryPayload(crm.offers[0]), false);
  assert.equal(isSupervisedRecommendationTelemetryPayload(telemetry.payload), true);
});

test('P1.1-A3 comparación remota incluye offers y Agenda/Reminder permanecen ajenos', () => {
  const compatible = readFileSync('src/cloud-api-compatible.ts', 'utf8');
  const agenda = readFileSync('src/agenda.ts', 'utf8');
  const models = readFileSync('src/models.ts', 'utf8');
  assert.match(compatible, /\['clients', 'properties', 'visits', 'offers', 'contacts', 'reminders', 'fichas', 'conversations'\]/);
  assert.doesNotMatch(agenda, /\boffers\b/);
  assert.doesNotMatch(models.match(/export interface Reminder \{([\s\S]*?)\n\}/)?.[1] ?? '', /Offer|offer/);
});

test('P1.1-A3 existir Offer no modifica pipeline, follow-up, Reminder ni ActivityEntry', () => {
  const crm = structuredClone(initialData);
  const clientBefore = structuredClone(crm.clients[0]);
  const remindersBefore = structuredClone(crm.reminders);
  const activityBefore = structuredClone(crm.activityLog);
  crm.offers = [offer({ assignedToId: 1, createdById: 1, clientId: crm.clients[0]!.id, propertyId: crm.properties[0]!.id })];
  assert.deepEqual(crm.clients[0], clientBefore);
  assert.deepEqual(crm.reminders, remindersBefore);
  assert.deepEqual(crm.activityLog, activityBefore);
});

test('P1.1-A3 migration sólo amplía entity_type preservando visit y sin infraestructura extra', () => {
  const migration = readFileSync('supabase/migrations/20260824165500_p1_1_a3_offer_entity_type.sql', 'utf8');
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;/);
  assert.match(migration, /to_regclass\('public\.propcontrol_records'\)/);
  assert.match(migration, /propcontrol_records_entity_type_check/);
  for (const entityType of [
    'organization', 'client', 'property', 'commercial_contact', 'reminder', 'ficha', 'conversation', 'activity', 'visit', 'offer',
  ]) assert.match(migration, new RegExp(`'${entityType}'`));
  assert.match(migration, /drop constraint propcontrol_records_entity_type_check/);
  assert.match(migration, /add constraint propcontrol_records_entity_type_check/);
  assert.doesNotMatch(migration, /insert\s|update\s|delete\s/i);
  assert.doesNotMatch(migration, /create\s+policy|drop\s+policy|grant\s|revoke\s|row level security/i);
  assert.doesNotMatch(migration, /create\s+table|drop\s+table|add\s+column|drop\s+column|alter\s+column|create\s+index|drop\s+index/i);
  assert.doesNotMatch(migration, /create\s+(or\s+replace\s+)?function|organization_members/i);
});
