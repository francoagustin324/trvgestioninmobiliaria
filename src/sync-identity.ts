import type {
  ActivityEntry,
  CrmData,
  SyncRecordMetadata,
} from './models.js';

type SyncCollectionKey = 'clients' | 'properties' | 'visits' | 'offers' | 'reservations' | 'contacts' | 'reminders' | 'fichas' | 'conversations' | 'activityLog';
type SyncRecord = SyncRecordMetadata & { id: number };

const SYNC_COLLECTIONS: SyncCollectionKey[] = [
  'clients',
  'properties',
  'visits',
  'offers',
  'reservations',
  'contacts',
  'reminders',
  'fichas',
  'conversations',
  'activityLog',
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const legacyIdentityBaseline = new Set<string>();
let legacyBaselineReady = false;

function records(crm: CrmData, collection: SyncCollectionKey): SyncRecord[] {
  return crm[collection] as unknown as SyncRecord[];
}

function legacyKey(collection: SyncCollectionKey, id: number): string {
  return `${collection}:${id}`;
}

export function canonicalUuid(value: unknown): string | undefined {
  const candidate = String(value ?? '').trim().toLowerCase();
  return UUID_PATTERN.test(candidate) ? candidate : undefined;
}

export function normalizeRevision(value: unknown): number {
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : 0;
}

export function nextRevision(value: unknown): number {
  const current = normalizeRevision(value);
  if (current >= Number.MAX_SAFE_INTEGER) throw new Error('La revisión del registro alcanzó el máximo seguro.');
  return current + 1;
}

export function normalizeOperationId(value: unknown): string | undefined {
  return canonicalUuid(value);
}

function randomUuidV4(): string {
  const runtimeCrypto = globalThis.crypto;
  if (typeof runtimeCrypto?.randomUUID === 'function') return runtimeCrypto.randomUUID();
  if (typeof runtimeCrypto?.getRandomValues !== 'function') {
    throw new Error('Este navegador no ofrece un generador criptográfico seguro para la identidad de datos.');
  }
  const bytes = new Uint8Array(16);
  runtimeCrypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export function newCanonicalUid(): string {
  return randomUuidV4().toLowerCase();
}

export function newOperationId(): string {
  return newCanonicalUid();
}

export function newSyncRecordMetadata(operationId?: string): Required<Pick<SyncRecordMetadata, 'uid' | 'revision'>> & Pick<SyncRecordMetadata, 'operationId'> {
  return {
    uid: newCanonicalUid(),
    revision: 0,
    operationId: normalizeOperationId(operationId),
  };
}

export function normalizedSyncMetadata(value: SyncRecordMetadata | undefined): SyncRecordMetadata {
  return {
    uid: canonicalUuid(value?.uid),
    revision: normalizeRevision(value?.revision),
    operationId: normalizeOperationId(value?.operationId),
  };
}

function normalizeRecord(record: SyncRecord): void {
  const uid = canonicalUuid(record.uid);
  const operationId = normalizeOperationId(record.operationId);
  if (uid) record.uid = uid;
  else delete record.uid;
  record.revision = normalizeRevision(record.revision);
  if (operationId) record.operationId = operationId;
  else delete record.operationId;
}

/**
 * Registra qué identidades numéricas pertenecían al snapshot histórico cargado.
 * Esas filas conservan su entity_key legacy hasta una migración explícita futura.
 * Los objetos creados después de este baseline reciben UUID antes de persistirse.
 */
export function captureLegacyIdentityBaseline(crm: CrmData): void {
  legacyIdentityBaseline.clear();
  for (const collection of SYNC_COLLECTIONS) {
    for (const record of records(crm, collection)) {
      normalizeRecord(record);
      if (!record.uid) legacyIdentityBaseline.add(legacyKey(collection, record.id));
    }
  }
  legacyBaselineReady = true;
}

function ensureCanonicalIdentity(record: SyncRecord, collection: SyncCollectionKey): void {
  normalizeRecord(record);
  if (record.uid || !legacyBaselineReady) return;
  if (legacyIdentityBaseline.has(legacyKey(collection, record.id))) return;
  record.uid = newCanonicalUid();
  record.revision = 0;
}

function relationUid(current: string | undefined, target: SyncRecordMetadata | undefined): string | undefined {
  return canonicalUuid(target?.uid) ?? canonicalUuid(current);
}

function linkCanonicalRelations(crm: CrmData): void {
  const clients = new Map(crm.clients.map((item) => [item.id, item]));
  const properties = new Map(crm.properties.map((item) => [item.id, item]));
  const contacts = new Map(crm.contacts.map((item) => [item.id, item]));
  const offers = new Map(crm.offers.map((item) => [item.id, item]));
  const reminders = new Map(crm.reminders.map((item) => [item.id, item]));
  const conversations = new Map(crm.conversations.map((item) => [item.id, item]));

  crm.properties.forEach((item) => {
    if (item.sourceContactId !== undefined) item.sourceContactUid = relationUid(item.sourceContactUid, contacts.get(item.sourceContactId));
  });
  crm.visits.forEach((item) => {
    item.clientUid = relationUid(item.clientUid, clients.get(item.clientId));
    item.propertyUid = relationUid(item.propertyUid, properties.get(item.propertyId));
  });
  crm.offers.forEach((item) => {
    item.clientUid = relationUid(item.clientUid, clients.get(item.clientId));
    item.propertyUid = relationUid(item.propertyUid, properties.get(item.propertyId));
    if (item.parentOfferId !== undefined) item.parentOfferUid = relationUid(item.parentOfferUid, offers.get(item.parentOfferId));
  });
  crm.reservations.forEach((item) => {
    item.clientUid = relationUid(item.clientUid, clients.get(item.clientId));
    item.propertyUid = relationUid(item.propertyUid, properties.get(item.propertyId));
    if (item.offerId !== undefined) item.offerUid = relationUid(item.offerUid, offers.get(item.offerId));
  });
  crm.fichas.forEach((item) => {
    if (item.sourcePropertyId !== undefined) item.sourcePropertyUid = relationUid(item.sourcePropertyUid, properties.get(item.sourcePropertyId));
  });
  crm.conversations.forEach((item) => {
    item.clientUid = relationUid(item.clientUid, clients.get(item.clientId));
  });
  crm.activityLog.forEach((item: ActivityEntry) => {
    if (item.entityId === undefined) return;
    const target = item.entityType === 'Cliente' ? clients.get(item.entityId)
      : item.entityType === 'Propiedad' ? properties.get(item.entityId)
        : item.entityType === 'Conversación' ? conversations.get(item.entityId)
          : item.entityType === 'Tarea' ? reminders.get(item.entityId)
            : undefined;
    item.entityUid = relationUid(item.entityUid, target);
  });
}

export function prepareCrmSyncContracts(crm: CrmData): CrmData {
  for (const collection of SYNC_COLLECTIONS) {
    records(crm, collection).forEach((record) => ensureCanonicalIdentity(record, collection));
  }
  linkCanonicalRelations(crm);
  return crm;
}

export function cloudIdentityForRecord(record: SyncRecord): string | number {
  return canonicalUuid(record.uid) ?? record.id;
}
