import type {
  ActivityEntry,
  CrmData,
  SyncedOffer,
  SyncedReservation,
  SyncedVisit,
  SyncRecordMetadata,
  Visit,
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

function records(crm: CrmData, collection: SyncCollectionKey): SyncRecord[] {
  return crm[collection] as unknown as SyncRecord[];
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function ownValue(value: object, key: PropertyKey): unknown {
  return hasOwn(value, key) ? (value as Record<PropertyKey, unknown>)[key] : undefined;
}

export function hasSyncMetadata<T extends object>(value: T): value is T & SyncRecordMetadata {
  return hasOwn(value, 'uid') || hasOwn(value, 'revision') || hasOwn(value, 'operationId');
}

export function hasVisitSyncRelations(value: Visit): value is SyncedVisit {
  const clientUid = ownValue(value, 'clientUid');
  const propertyUid = ownValue(value, 'propertyUid');
  return (typeof clientUid === 'string' || typeof propertyUid === 'string')
    && (clientUid === undefined || canonicalUuid(clientUid) !== undefined)
    && (propertyUid === undefined || canonicalUuid(propertyUid) !== undefined);
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
  const normalizedOperationId = normalizeOperationId(operationId);
  return {
    uid: newCanonicalUid(),
    revision: 0,
    ...(normalizedOperationId ? { operationId: normalizedOperationId } : {}),
  };
}

/**
 * Normaliza exclusivamente metadata que ya está materializada en el objeto.
 * La ausencia de uid/revision/operationId se conserva: un round-trip legacy no
 * crea identidad ni altera el shape histórico.
 */
export function normalizedSyncMetadata(value: object | undefined): SyncRecordMetadata {
  if (!value) return {};
  const normalized: SyncRecordMetadata = {};
  if (hasOwn(value, 'uid')) normalized.uid = canonicalUuid(ownValue(value, 'uid'));
  if (hasOwn(value, 'revision')) normalized.revision = normalizeRevision(ownValue(value, 'revision'));
  if (hasOwn(value, 'operationId')) normalized.operationId = normalizeOperationId(ownValue(value, 'operationId'));
  return normalized;
}

function normalizeRecord(record: SyncRecord): void {
  if (hasOwn(record, 'uid')) record.uid = canonicalUuid(record.uid);
  if (hasOwn(record, 'revision')) record.revision = normalizeRevision(record.revision);
  if (hasOwn(record, 'operationId')) record.operationId = normalizeOperationId(record.operationId);
}

function relationUid(current: string | undefined, target: SyncRecordMetadata | undefined): string | undefined {
  return canonicalUuid(target?.uid) ?? canonicalUuid(current);
}

function assignRelationUid(
  record: object,
  key: string,
  current: string | undefined,
  target: SyncRecordMetadata | undefined,
): void {
  const uid = relationUid(current, target);
  if (uid) {
    (record as Record<string, unknown>)[key] = uid;
    return;
  }
  if (hasOwn(record, key)) (record as Record<string, unknown>)[key] = undefined;
}

function linkCanonicalRelations(crm: CrmData): void {
  const clients = new Map(crm.clients.map((item) => [item.id, item]));
  const properties = new Map(crm.properties.map((item) => [item.id, item]));
  const contacts = new Map(crm.contacts.map((item) => [item.id, item]));
  const visits: SyncedVisit[] = crm.visits;
  const offers: SyncedOffer[] = crm.offers;
  const reservations: SyncedReservation[] = crm.reservations;
  const offersById = new Map(offers.map((item) => [item.id, item]));
  const reminders = new Map(crm.reminders.map((item) => [item.id, item]));
  const conversations = new Map(crm.conversations.map((item) => [item.id, item]));

  crm.properties.forEach((item) => {
    if (item.sourceContactId !== undefined) assignRelationUid(item, 'sourceContactUid', item.sourceContactUid, contacts.get(item.sourceContactId));
  });
  visits.forEach((item) => {
    assignRelationUid(item, 'clientUid', item.clientUid, clients.get(item.clientId));
    assignRelationUid(item, 'propertyUid', item.propertyUid, properties.get(item.propertyId));
  });
  offers.forEach((item) => {
    assignRelationUid(item, 'clientUid', item.clientUid, clients.get(item.clientId));
    assignRelationUid(item, 'propertyUid', item.propertyUid, properties.get(item.propertyId));
    if (item.parentOfferId !== undefined) assignRelationUid(item, 'parentOfferUid', item.parentOfferUid, offersById.get(item.parentOfferId));
  });
  reservations.forEach((item) => {
    assignRelationUid(item, 'clientUid', item.clientUid, clients.get(item.clientId));
    assignRelationUid(item, 'propertyUid', item.propertyUid, properties.get(item.propertyId));
    if (item.offerId !== undefined) assignRelationUid(item, 'offerUid', item.offerUid, offersById.get(item.offerId));
  });
  crm.fichas.forEach((item) => {
    if (item.sourcePropertyId !== undefined) assignRelationUid(item, 'sourcePropertyUid', item.sourcePropertyUid, properties.get(item.sourcePropertyId));
  });
  crm.conversations.forEach((item) => {
    assignRelationUid(item, 'clientUid', item.clientUid, clients.get(item.clientId));
  });
  crm.activityLog.forEach((item: ActivityEntry) => {
    if (item.entityId === undefined) return;
    const target = item.entityType === 'Cliente' ? clients.get(item.entityId)
      : item.entityType === 'Propiedad' ? properties.get(item.entityId)
        : item.entityType === 'Conversación' ? conversations.get(item.entityId)
          : item.entityType === 'Tarea' ? reminders.get(item.entityId)
            : undefined;
    assignRelationUid(item, 'entityUid', item.entityUid, target);
  });
}

/**
 * Prepara contratos de sync sin inferir historia de identidad.
 * Nunca genera UID: una entidad nueva debe llegar ya estampada desde su boundary
 * explícito de creación. Un registro legacy id-only conserva identidad numérica.
 */
export function prepareCrmSyncContracts(crm: CrmData): CrmData {
  for (const collection of SYNC_COLLECTIONS) {
    records(crm, collection).forEach(normalizeRecord);
  }
  linkCanonicalRelations(crm);
  return crm;
}

export function cloudIdentityForRecord(record: SyncRecord): string | number {
  return canonicalUuid(record.uid) ?? record.id;
}
