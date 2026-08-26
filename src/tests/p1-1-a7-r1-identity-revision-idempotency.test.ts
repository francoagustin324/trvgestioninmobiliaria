import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cloudRecordsToCrm,
  crmToCloudRecords,
  membershipContext,
  type CloudMembershipRow,
  type CloudRecordRow,
} from '../cloud-records.js';
import { initialData, type CrmData } from '../models.js';
import {
  canonicalUuid,
  captureLegacyIdentityBaseline,
  newOperationId,
  newSyncRecordMetadata,
  normalizeRevision,
  prepareCrmSyncContracts,
} from '../sync-identity.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const secondOrganizationId = '22222222-2222-4222-8222-222222222222';
const memberships: CloudMembershipRow[] = [{
  organization_id: organizationId,
  member_id: 10,
  user_id: 'owner-user',
  role: 'owner',
  status: 'active',
  display_name: 'Dueño',
  email: 'owner@example.com',
}];

function baseCrm(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.teamMembers = membershipContext(memberships, 'owner-user').members;
  crm.clients[0]!.assignedToId = 10;
  crm.clients[0]!.createdById = 10;
  crm.properties[0]!.assignedToId = 10;
  crm.properties[0]!.createdById = 10;
  crm.contacts = [];
  crm.reminders = [];
  crm.visits = [];
  crm.offers = [];
  crm.reservations = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.activityLog = [];
  return crm;
}

function ownerContext() {
  return membershipContext(memberships, 'owner-user');
}

test('dos altas desde el mismo snapshot conservan id legacy pero reciben UID canónico distinto', () => {
  const baseline = baseCrm();
  captureLegacyIdentityBaseline(baseline);

  const first = structuredClone(baseline);
  const second = structuredClone(baseline);
  first.clients.push({ ...first.clients[0]!, id: 2, name: 'Alta A', uid: undefined, revision: undefined });
  second.clients.push({ ...second.clients[0]!, id: 2, name: 'Alta B', uid: undefined, revision: undefined });

  prepareCrmSyncContracts(first);
  prepareCrmSyncContracts(second);

  const firstUid = first.clients[1]!.uid;
  const secondUid = second.clients[1]!.uid;
  assert.ok(canonicalUuid(firstUid));
  assert.ok(canonicalUuid(secondUid));
  assert.notEqual(firstUid, secondUid);
  assert.equal(first.clients[1]!.id, 2);
  assert.equal(second.clients[1]!.id, 2);
  assert.equal(first.clients[1]!.revision, 0);
  assert.equal(second.clients[1]!.revision, 0);
  assert.equal(baseline.clients[0]!.uid, undefined, 'el registro legacy no debe migrarse implícitamente');
});

test('un registro legacy sin UID hidrata y revision ausente normaliza a 0 sin inventar identidad nueva', () => {
  const fallback = baseCrm();
  const legacy = { ...fallback.clients[0]! };
  delete legacy.uid;
  delete legacy.revision;
  const rows: CloudRecordRow[] = [{
    organization_id: organizationId,
    entity_type: 'client',
    entity_key: `${organizationId}:1`,
    assigned_member_id: 10,
    payload: legacy,
  }];

  const hydrated = cloudRecordsToCrm(rows, ownerContext(), fallback);
  assert.equal(hydrated.clients[0]!.id, 1);
  assert.equal(hydrated.clients[0]!.uid, undefined);
  assert.equal(hydrated.clients[0]!.revision, 0);
});

test('UID revision y operationId válidos hacen round-trip local/cloud sin cambiar identidad', () => {
  const crm = baseCrm();
  captureLegacyIdentityBaseline(crm);
  const operationId = newOperationId();
  const metadata = newSyncRecordMetadata(operationId);
  crm.clients.push({
    ...crm.clients[0]!,
    ...metadata,
    revision: 7,
    id: 2,
    name: 'Cliente canónico',
  });
  prepareCrmSyncContracts(crm);

  const records = crmToCloudRecords(crm, ownerContext(), 'owner-user');
  const row = records.find((item) => item.entity_type === 'client' && (item.payload as { id?: number }).id === 2);
  assert.ok(row);
  assert.equal(row!.entity_key, `${organizationId}:${metadata.uid}`);

  const hydrated = cloudRecordsToCrm(records, ownerContext(), baseCrm());
  const client = hydrated.clients.find((item) => item.id === 2)!;
  assert.equal(client.uid, metadata.uid);
  assert.equal(client.revision, 7);
  assert.equal(client.operationId, operationId);
});

test('revision legacy o inválida nunca se normaliza por encima de 0', () => {
  assert.equal(normalizeRevision(undefined), 0);
  assert.equal(normalizeRevision(-1), 0);
  assert.equal(normalizeRevision(1.5), 0);
  assert.equal(normalizeRevision('basura'), 0);
  assert.equal(normalizeRevision(4), 4);
});

test('las relaciones duales se completan sólo cuando el destino ya tiene UID canónico', () => {
  const crm = baseCrm();
  captureLegacyIdentityBaseline(crm);
  const client = { ...crm.clients[0]!, ...newSyncRecordMetadata(), id: 2, name: 'Cliente nuevo' };
  const property = { ...crm.properties[0]!, ...newSyncRecordMetadata(), id: 2, title: 'Propiedad nueva' };
  crm.clients.push(client);
  crm.properties.push(property);
  crm.visits.push({
    ...newSyncRecordMetadata(),
    id: 1,
    clientId: 2,
    propertyId: 2,
    scheduledAt: '2026-08-30T15:00:00.000Z',
    status: 'Coordinada',
    assignedToId: 10,
    createdById: 10,
    createdAt: '2026-08-26T20:00:00.000Z',
    updatedAt: '2026-08-26T20:00:00.000Z',
  });
  crm.offers.push({
    ...newSyncRecordMetadata(),
    id: 1,
    clientId: 2,
    propertyId: 2,
    origin: 'Cliente',
    amount: 100000,
    currency: 'USD',
    status: 'Pendiente',
    assignedToId: 10,
    createdById: 10,
    createdAt: '2026-08-26T20:00:00.000Z',
    updatedAt: '2026-08-26T20:00:00.000Z',
  });
  crm.reservations.push({
    ...newSyncRecordMetadata(),
    id: 1,
    clientId: 2,
    propertyId: 2,
    offerId: 1,
    amount: 1000,
    currency: 'USD',
    reservedAt: '2026-08-26',
    status: 'Activa',
    assignedToId: 10,
    createdById: 10,
    createdAt: '2026-08-26T20:00:00.000Z',
    updatedAt: '2026-08-26T20:00:00.000Z',
  });

  prepareCrmSyncContracts(crm);
  assert.equal(crm.visits[0]!.clientUid, client.uid);
  assert.equal(crm.visits[0]!.propertyUid, property.uid);
  assert.equal(crm.offers[0]!.clientUid, client.uid);
  assert.equal(crm.offers[0]!.propertyUid, property.uid);
  assert.equal(crm.reservations[0]!.clientUid, client.uid);
  assert.equal(crm.reservations[0]!.propertyUid, property.uid);
  assert.equal(crm.reservations[0]!.offerUid, crm.offers[0]!.uid);
  assert.equal(crm.clients[0]!.uid, undefined, 'la relación legacy original sigue siendo legible por id');
});

test('los tipos sincronizables nuevos reciben UID sin convertir ConversationMessage en fila independiente', () => {
  const crm = baseCrm();
  captureLegacyIdentityBaseline(crm);
  crm.contacts.push({
    id: 1, type: 'Propietario', name: 'Propietario', phone: '3515555555', createdAt: '2026-08-26T20:00:00.000Z', assignedToId: 10, createdById: 10,
  });
  crm.reminders.push({ id: 1, date: '2026-08-30', title: 'Llamar', related: 'Lead', priority: 'Alta', assignedToId: 10, createdById: 10 });
  crm.fichas.push({ id: 1, mode: 'property', title: 'Ficha', photoUrls: [], createdAt: '2026-08-26T20:00:00.000Z', assignedToId: 10, createdById: 10 });
  crm.conversations.push({
    id: 1,
    clientId: 1,
    phone: '3515555555',
    mode: 'IA supervisada',
    unread: 0,
    lastActivity: '2026-08-26T20:00:00.000Z',
    assignedToId: 10,
    createdById: 10,
    messages: [{ id: 1, direction: 'inbound', sender: 'Cliente', text: 'Hola', createdAt: '2026-08-26T20:00:00.000Z' }],
  });
  crm.activityLog.push({ id: 1, actorId: 10, action: 'Alta', entityType: 'Cliente', entityId: 1, detail: 'Alta', createdAt: '2026-08-26T20:00:00.000Z' });

  prepareCrmSyncContracts(crm);
  for (const record of [crm.contacts[0], crm.reminders[0], crm.fichas[0], crm.conversations[0], crm.activityLog[0]]) {
    assert.ok(canonicalUuid(record?.uid));
    assert.equal(record?.revision, 0);
  }
  assert.equal('uid' in crm.conversations[0]!.messages[0]!, false);
});

test('el mismo UID sigue aislado por organization_id en la identidad cloud', () => {
  const first = baseCrm();
  const metadata = newSyncRecordMetadata();
  first.clients = [{ ...first.clients[0]!, ...metadata }];
  const firstRows = crmToCloudRecords(first, ownerContext(), 'owner-user');

  const secondMemberships: CloudMembershipRow[] = [{ ...memberships[0]!, organization_id: secondOrganizationId }];
  const secondContext = membershipContext(secondMemberships, 'owner-user');
  const second = structuredClone(first);
  second.organization.id = secondOrganizationId;
  second.teamMembers = secondContext.members;
  const secondRows = crmToCloudRecords(second, secondContext, 'owner-user');

  const firstKey = firstRows.find((row) => row.entity_type === 'client')!.entity_key;
  const secondKey = secondRows.find((row) => row.entity_type === 'client')!.entity_key;
  assert.equal(firstKey, `${organizationId}:${metadata.uid}`);
  assert.equal(secondKey, `${secondOrganizationId}:${metadata.uid}`);
  assert.notEqual(firstKey, secondKey);
});

test('datos legacy A1-A6 continúan hidratando con relaciones numéricas intactas', () => {
  const fallback = baseCrm();
  const rows: CloudRecordRow[] = [
    {
      organization_id: organizationId,
      entity_type: 'visit',
      entity_key: `${organizationId}:3`,
      assigned_member_id: 10,
      payload: { id: 3, clientId: 1, propertyId: 1, scheduledAt: '2026-08-30T15:00:00.000Z', status: 'Coordinada', assignedToId: 10, createdById: 10, createdAt: '2026-08-26T20:00:00.000Z', updatedAt: '2026-08-26T20:00:00.000Z' },
    },
    {
      organization_id: organizationId,
      entity_type: 'offer',
      entity_key: `${organizationId}:4`,
      assigned_member_id: 10,
      payload: { id: 4, clientId: 1, propertyId: 1, origin: 'Cliente', amount: 100000, currency: 'USD', status: 'Pendiente', assignedToId: 10, createdById: 10, createdAt: '2026-08-26T20:00:00.000Z', updatedAt: '2026-08-26T20:00:00.000Z' },
    },
    {
      organization_id: organizationId,
      entity_type: 'reservation',
      entity_key: `${organizationId}:5`,
      assigned_member_id: 10,
      payload: { id: 5, clientId: 1, propertyId: 1, offerId: 4, amount: 1000, currency: 'USD', reservedAt: '2026-08-26', status: 'Activa', assignedToId: 10, createdById: 10, createdAt: '2026-08-26T20:00:00.000Z', updatedAt: '2026-08-26T20:00:00.000Z' },
    },
  ];

  const hydrated = cloudRecordsToCrm(rows, ownerContext(), fallback);
  assert.equal(hydrated.visits[0]!.clientId, 1);
  assert.equal(hydrated.visits[0]!.propertyId, 1);
  assert.equal(hydrated.offers[0]!.clientId, 1);
  assert.equal(hydrated.reservations[0]!.offerId, 4);
  assert.equal(hydrated.visits[0]!.uid, undefined);
  assert.equal(hydrated.offers[0]!.uid, undefined);
  assert.equal(hydrated.reservations[0]!.uid, undefined);
  assert.equal(hydrated.visits[0]!.revision, 0);
  assert.equal(hydrated.offers[0]!.revision, 0);
  assert.equal(hydrated.reservations[0]!.revision, 0);
});
