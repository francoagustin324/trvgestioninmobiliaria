import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  cloudRecordsToCrm,
  crmToCloudRecords,
  membershipContext,
  organizationScopedEntityKey,
  staleCloudRecords,
  type CloudMembershipRow,
  type CloudRecordRow,
} from '../cloud-records.js';
import { initialData, STORAGE_KEY, type CrmData } from '../models.js';
import {
  canonicalUuid,
  hasVisitSyncRelations,
  newOperationId,
  newSyncRecordMetadata,
  normalizeRevision,
  prepareCrmSyncContracts,
} from '../sync-identity.js';
import {
  hasLocalBackup,
  readLocalSnapshot,
  restoreLatestBackup,
  writeLocalSnapshot,
} from '../sync-safety.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

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

function deleteReuse<T extends { id: number }>(legacy: T[]): T['id'] {
  const reduced = legacy.filter((item) => item.id !== 3);
  return Math.max(0, ...reduced.map((item) => item.id)) + 1;
}

test('R1C dos altas desde el mismo snapshot reciben UID distintos aunque reutilicen el mismo id numérico', () => {
  const base = baseCrm();
  const first = { ...base.clients[0]!, ...newSyncRecordMetadata(), id: 2, name: 'Alta A' };
  const second = { ...base.clients[0]!, ...newSyncRecordMetadata(), id: 2, name: 'Alta B' };
  assert.ok(canonicalUuid(first.uid));
  assert.ok(canonicalUuid(second.uid));
  assert.notEqual(first.uid, second.uid);
  assert.equal(first.id, second.id);
  assert.equal(first.revision, 0);
  assert.equal(second.revision, 0);
});

test('R1C delete/reuse de Client Property y Reminder nunca convierte la creación nueva en legacy', () => {
  for (const kind of ['client', 'property', 'reminder'] as const) {
    const legacy = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const reusedId = deleteReuse(legacy);
    assert.equal(reusedId, 3);
    const created = { ...newSyncRecordMetadata(), id: reusedId };
    assert.ok(canonicalUuid(created.uid), `${kind} debe recibir UID explícito`);
    assert.equal(created.revision, 0);
  }
});

test('R1C normalizar y preparar un registro histórico id-only no inventa uid ni revision física', () => {
  const crm = baseCrm();
  delete crm.clients[0]!.uid;
  delete crm.clients[0]!.revision;
  delete crm.clients[0]!.operationId;
  prepareCrmSyncContracts(crm);
  assert.equal(crm.clients[0]!.uid, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(crm.clients[0]!, 'uid'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(crm.clients[0]!, 'revision'), false);
  assert.equal(normalizeRevision(crm.clients[0]!.revision), 0);
});

test('R1C legacy hydrate-normalize-serialize conserva entity_key numérica y no crea segunda key UUID', () => {
  const fallback = baseCrm();
  const legacy = { ...fallback.clients[0]! };
  delete legacy.uid;
  delete legacy.revision;
  delete legacy.operationId;
  const rows: CloudRecordRow[] = [{
    organization_id: organizationId,
    entity_type: 'client',
    entity_key: organizationScopedEntityKey(organizationId, 1),
    assigned_member_id: 10,
    payload: legacy,
  }];
  const hydrated = cloudRecordsToCrm(rows, ownerContext(), fallback);
  prepareCrmSyncContracts(hydrated);
  const serialized = crmToCloudRecords(hydrated, ownerContext(), 'owner-user').filter((row) => row.entity_type === 'client');
  assert.equal(serialized.length, 1);
  assert.equal(serialized[0]!.entity_key, organizationScopedEntityKey(organizationId, 1));
  assert.equal((serialized[0]!.payload as { uid?: string }).uid, undefined);
});

test('R1C Visit Offer Reservation legacy conservan numeric entity_key y stale reconciliation histórica', () => {
  const crm = baseCrm();
  crm.visits = [{ id: 3, clientId: 1, propertyId: 1, scheduledAt: '2026-08-30T15:00:00.000Z', status: 'Coordinada', assignedToId: 10, createdById: 10, createdAt: '2026-08-26T20:00:00.000Z', updatedAt: '2026-08-26T20:00:00.000Z' }];
  crm.offers = [{ id: 4, clientId: 1, propertyId: 1, origin: 'Cliente', amount: 100000, currency: 'USD', status: 'Pendiente', assignedToId: 10, createdById: 10, createdAt: '2026-08-26T20:00:00.000Z', updatedAt: '2026-08-26T20:00:00.000Z' }];
  crm.reservations = [{ id: 5, clientId: 1, propertyId: 1, offerId: 4, amount: 1000, currency: 'USD', reservedAt: '2026-08-26', status: 'Activa', assignedToId: 10, createdById: 10, createdAt: '2026-08-26T20:00:00.000Z', updatedAt: '2026-08-26T20:00:00.000Z' }];
  const current = crmToCloudRecords(crm, ownerContext(), 'owner-user');
  assert.equal(current.find((row) => row.entity_type === 'visit')!.entity_key, organizationScopedEntityKey(organizationId, 3));
  assert.equal(current.find((row) => row.entity_type === 'offer')!.entity_key, organizationScopedEntityKey(organizationId, 4));
  assert.equal(current.find((row) => row.entity_type === 'reservation')!.entity_key, organizationScopedEntityKey(organizationId, 5));

  const reduced = structuredClone(crm);
  reduced.visits = [];
  reduced.offers = [];
  reduced.reservations = [];
  const next = crmToCloudRecords(reduced, ownerContext(), 'owner-user');
  const stale = staleCloudRecords(current, next);
  assert.ok(stale.some((row) => row.entity_type === 'visit' && row.entity_key === organizationScopedEntityKey(organizationId, 3)));
  assert.ok(stale.some((row) => row.entity_type === 'offer' && row.entity_key === organizationScopedEntityKey(organizationId, 4)));
  assert.ok(stale.some((row) => row.entity_type === 'reservation' && row.entity_key === organizationScopedEntityKey(organizationId, 5)));
});

test('R1D separa contratos de dominio exactos de la metadata de sincronización', () => {
  const source = readFileSync('src/models.ts', 'utf8');
  for (const name of ['Visit', 'Offer', 'Reservation']) {
    const block = source.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
    assert.ok(block);
    assert.doesNotMatch(block, /uid|revision|operationId/);
  }
  assert.match(source, /type SyncedVisit = Visit & SyncRecordMetadata/);
  assert.match(source, /type SyncedOffer = Offer & SyncRecordMetadata/);
  assert.match(source, /type SyncedReservation = Reservation & SyncRecordMetadata/);
});

test('R1C entidad nueva tiene UID antes de writeLocalSnapshot y reload lo mantiene estable', () => {
  const storage = new MemoryStorage();
  const crm = baseCrm();
  const metadata = newSyncRecordMetadata();
  crm.clients.push({ ...crm.clients[0]!, ...metadata, id: 2, name: 'Nueva' });
  assert.ok(canonicalUuid(crm.clients[1]!.uid));
  writeLocalSnapshot(crm, { markDirty: true, reason: 'Alta R1C' }, storage);
  const reloaded = readLocalSnapshot(storage)!;
  assert.equal(reloaded.clients[1]!.uid, metadata.uid);
  assert.equal(reloaded.clients[1]!.revision, 0);
});

test('R1C backup/restore preserva identidad legacy numérica y UUID nuevo', () => {
  const storage = new MemoryStorage();
  const first = baseCrm();
  const metadata = newSyncRecordMetadata();
  first.clients.push({ ...first.clients[0]!, ...metadata, id: 2, name: 'Nueva' });
  writeLocalSnapshot(first, { markDirty: true, reason: 'Base R1C' }, storage);
  const second = structuredClone(first);
  second.clients[1]!.name = 'Nueva editada';
  writeLocalSnapshot(second, { markDirty: true, reason: 'Cambio R1C' }, storage);
  assert.equal(hasLocalBackup(storage), true);
  const restored = restoreLatestBackup(storage)!;
  assert.equal(restored.clients[0]!.uid, undefined);
  assert.equal(restored.clients[1]!.uid, metadata.uid);
  assert.equal(readLocalSnapshot(storage)!.clients[1]!.uid, metadata.uid);
});

test('R1C UID revision y operationId hacen round-trip cloud sin cambiar identidad', () => {
  const crm = baseCrm();
  const operationId = newOperationId();
  const metadata = newSyncRecordMetadata(operationId);
  crm.clients.push({ ...crm.clients[0]!, ...metadata, revision: 7, id: 2, name: 'Cliente canónico' });
  const records = crmToCloudRecords(crm, ownerContext(), 'owner-user');
  const row = records.find((item) => item.entity_type === 'client' && (item.payload as { id?: number }).id === 2)!;
  assert.equal(row.entity_key, `${organizationId}:${metadata.uid}`);
  const hydrated = cloudRecordsToCrm(records, ownerContext(), baseCrm());
  const client = hydrated.clients.find((item) => item.id === 2)!;
  assert.equal(client.uid, metadata.uid);
  assert.equal(client.revision, 7);
  assert.equal(client.operationId, operationId);
});

test('R1C revision legacy o inválida conserva semántica 0', () => {
  assert.equal(normalizeRevision(undefined), 0);
  assert.equal(normalizeRevision(-1), 0);
  assert.equal(normalizeRevision(1.5), 0);
  assert.equal(normalizeRevision('basura'), 0);
  assert.equal(normalizeRevision(4), 4);
});

test('R1C relaciones duales completan UID sólo desde el target numérico actual, sin nuevo resolver de conflictos', () => {
  const crm = baseCrm();
  const client = { ...crm.clients[0]!, ...newSyncRecordMetadata(), id: 2, name: 'Cliente nuevo' };
  const property = { ...crm.properties[0]!, ...newSyncRecordMetadata(), id: 2, title: 'Propiedad nueva' };
  crm.clients.push(client);
  crm.properties.push(property);
  crm.visits.push({ ...newSyncRecordMetadata(), id: 1, clientId: 2, propertyId: 2, scheduledAt: '2026-08-30T15:00:00.000Z', status: 'Coordinada', assignedToId: 10, createdById: 10, createdAt: '2026-08-26T20:00:00.000Z', updatedAt: '2026-08-26T20:00:00.000Z' });
  prepareCrmSyncContracts(crm);
  const visit = crm.visits[0]!;
  assert.ok(hasVisitSyncRelations(visit));
  assert.equal(visit.clientUid, client.uid);
  assert.equal(visit.propertyUid, property.uid);
  assert.equal(crm.clients[0]!.uid, undefined);
});

test('R1C boundaries efectivos de creación estampan metadata explícita y Conversation no se auto-migra', () => {
  const sources = [
    'src/client-editor.ts',
    'src/mvp-properties-ui.ts',
    'src/visit-workflow.ts',
    'src/offer-workflow.ts',
    'src/reservation-workflow.ts',
    'src/agenda-ui.ts',
    'src/commercial-network-ui.ts',
    'src/team-access.ts',
    'src/fichas-ui.ts',
  ];
  for (const path of sources) assert.match(readFileSync(path, 'utf8'), /newSyncRecordMetadata/);
  const identity = readFileSync('src/sync-identity.ts', 'utf8');
  assert.doesNotMatch(identity, /legacyIdentityBaseline|captureLegacyIdentityBaseline|legacyBaselineReady/);
  const conversations = readFileSync('src/mvp-conversations-ui.ts', 'utf8');
  assert.doesNotMatch(conversations, /newSyncRecordMetadata/);
});

test('R1C el mismo UID sigue aislado por organization_id', () => {
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
