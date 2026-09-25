import type {
  ActivityEntry,
  Client,
  Property,
  PropertyDiffusionChannel,
  PropertyDiffusionLedgerRecord,
  PropertyDiffusionStatus,
} from './models.js';
import { canonicalUuid } from './sync-identity.js';

type ConfirmedPropertyDiffusionStatus = Exclude<PropertyDiffusionStatus, 'PENDIENTE'>;

export interface PropertyDiffusionLedgerMoment {
  clientId: number;
  clientUid?: string;
  propertyId: number;
  propertyUid?: string;
  actorId: number;
  createdAt: string;
  diffusionChannel: PropertyDiffusionChannel;
  diffusionStatus: ConfirmedPropertyDiffusionStatus;
  sendCount: number;
}

function validChannel(value: unknown): value is PropertyDiffusionChannel {
  return value === 'WhatsApp' || value === 'Email';
}

function validTimestamp(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function sameEntity(
  leftId: number,
  leftUid: string | undefined,
  rightId: number,
  rightUid: string | undefined,
): boolean {
  const normalizedLeftUid = canonicalUuid(leftUid);
  const normalizedRightUid = canonicalUuid(rightUid);
  if (normalizedLeftUid && normalizedRightUid) return normalizedLeftUid === normalizedRightUid;
  return leftId === rightId;
}

function sameProperty(
  record: Pick<PropertyDiffusionLedgerRecord, 'propertyId' | 'propertyUid'>,
  property: Pick<Property, 'id' | 'uid'>,
): boolean {
  return sameEntity(record.propertyId, record.propertyUid, property.id, property.uid);
}

function normalizeLedgerRecord(
  value: unknown,
  client: Pick<Client, 'id' | 'uid'>,
): PropertyDiffusionLedgerRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<PropertyDiffusionLedgerRecord>;
  const propertyId = positiveInteger(record.propertyId);
  const clientId = positiveInteger(record.clientId) ?? client.id;
  const sendCount = positiveInteger(record.sendCount);
  const firstSentAt = validTimestamp(record.firstSentAt);
  const lastSentAt = validTimestamp(record.lastSentAt);
  const lastSentActorId = positiveInteger(record.lastSentActorId);
  if (
    !propertyId
    || clientId !== client.id
    || !sendCount
    || !firstSentAt
    || !lastSentAt
    || Date.parse(firstSentAt) > Date.parse(lastSentAt)
    || !validChannel(record.lastSentChannel)
    || !lastSentActorId
  ) return null;

  const clientUid = canonicalUuid(record.clientUid);
  const currentClientUid = canonicalUuid(client.uid);
  if (clientUid && currentClientUid && clientUid !== currentClientUid) return null;

  const lastResponseAt = validTimestamp(record.lastResponseAt);
  const lastResponseActorId = positiveInteger(record.lastResponseActorId);
  const hasValidResponse = Boolean(
    lastResponseAt
    && validChannel(record.lastResponseChannel)
    && lastResponseActorId,
  );
  const responseTime = hasValidResponse ? lastResponseAt! : '';
  const updatedAtCandidate = validTimestamp(record.updatedAt);
  const updatedAt = [lastSentAt, responseTime, updatedAtCandidate ?? '']
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]!;

  return {
    clientId: client.id,
    ...(currentClientUid || clientUid ? { clientUid: currentClientUid ?? clientUid } : {}),
    propertyId,
    ...(canonicalUuid(record.propertyUid) ? { propertyUid: canonicalUuid(record.propertyUid) } : {}),
    sendCount,
    firstSentAt,
    lastSentAt,
    lastSentChannel: record.lastSentChannel,
    lastSentActorId,
    ...(hasValidResponse ? {
      lastResponseAt: responseTime,
      lastResponseChannel: record.lastResponseChannel,
      lastResponseActorId: lastResponseActorId!,
    } : {}),
    updatedAt,
  };
}

function mergeDuplicateLedgerRecords(
  left: PropertyDiffusionLedgerRecord,
  right: PropertyDiffusionLedgerRecord,
): PropertyDiffusionLedgerRecord {
  const latestSend = Date.parse(right.lastSentAt) > Date.parse(left.lastSentAt) ? right : left;
  const leftResponse = validTimestamp(left.lastResponseAt);
  const rightResponse = validTimestamp(right.lastResponseAt);
  const latestResponse = rightResponse && (!leftResponse || Date.parse(rightResponse) > Date.parse(leftResponse))
    ? right
    : left;
  const responseAt = validTimestamp(latestResponse.lastResponseAt);
  return {
    clientId: left.clientId,
    ...(left.clientUid || right.clientUid ? { clientUid: left.clientUid ?? right.clientUid } : {}),
    propertyId: left.propertyId,
    ...(left.propertyUid || right.propertyUid ? { propertyUid: left.propertyUid ?? right.propertyUid } : {}),
    sendCount: Math.max(left.sendCount, right.sendCount),
    firstSentAt: Date.parse(left.firstSentAt) <= Date.parse(right.firstSentAt) ? left.firstSentAt : right.firstSentAt,
    lastSentAt: latestSend.lastSentAt,
    lastSentChannel: latestSend.lastSentChannel,
    lastSentActorId: latestSend.lastSentActorId,
    ...(responseAt && latestResponse.lastResponseChannel && latestResponse.lastResponseActorId ? {
      lastResponseAt: responseAt,
      lastResponseChannel: latestResponse.lastResponseChannel,
      lastResponseActorId: latestResponse.lastResponseActorId,
    } : {}),
    updatedAt: Date.parse(left.updatedAt) >= Date.parse(right.updatedAt) ? left.updatedAt : right.updatedAt,
  };
}

export function normalizePropertyDiffusionLedger(
  value: unknown,
  client: Pick<Client, 'id' | 'uid'>,
): PropertyDiffusionLedgerRecord[] {
  if (!Array.isArray(value)) return [];
  const result: PropertyDiffusionLedgerRecord[] = [];
  value.forEach((item) => {
    const normalized = normalizeLedgerRecord(item, client);
    if (!normalized) return;
    const index = result.findIndex((existing) => sameEntity(
      existing.propertyId,
      existing.propertyUid,
      normalized.propertyId,
      normalized.propertyUid,
    ));
    if (index < 0) {
      result.push(normalized);
      return;
    }
    result[index] = mergeDuplicateLedgerRecords(result[index]!, normalized);
  });
  return result.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function structuredLegacyDiffusion(
  entry: ActivityEntry,
  client: Pick<Client, 'id' | 'uid'>,
): entry is ActivityEntry & {
  diffusionPropertyId: number;
  diffusionClientId: number;
  diffusionChannel: PropertyDiffusionChannel;
  diffusionStatus: ConfirmedPropertyDiffusionStatus;
} {
  if (
    entry.activityKind !== 'property-diffusion'
    || !positiveInteger(entry.diffusionPropertyId)
    || !positiveInteger(entry.diffusionClientId)
    || !validChannel(entry.diffusionChannel)
    || (entry.diffusionStatus !== 'ENVIADO' && entry.diffusionStatus !== 'RESPONDIO')
    || !validTimestamp(entry.createdAt)
  ) return false;
  if (!sameEntity(entry.diffusionClientId, entry.diffusionClientUid, client.id, client.uid)) return false;
  return true;
}

function applyLegacyActivity(
  ledger: PropertyDiffusionLedgerRecord[],
  client: Pick<Client, 'id' | 'uid'>,
  activity: ActivityEntry & {
    diffusionPropertyId: number;
    diffusionClientId: number;
    diffusionChannel: PropertyDiffusionChannel;
    diffusionStatus: ConfirmedPropertyDiffusionStatus;
  },
): void {
  const propertyIdentity = {
    id: activity.diffusionPropertyId,
    uid: canonicalUuid(activity.diffusionPropertyUid),
  };
  const index = ledger.findIndex((record) => sameEntity(
    record.propertyId,
    record.propertyUid,
    propertyIdentity.id,
    propertyIdentity.uid,
  ));
  const existing = index >= 0 ? ledger[index]! : null;
  if (existing && Date.parse(activity.createdAt) <= Date.parse(existing.updatedAt)) return;

  if (activity.diffusionStatus === 'ENVIADO') {
    const next: PropertyDiffusionLedgerRecord = existing ? {
      ...existing,
      sendCount: existing.sendCount + 1,
      lastSentAt: activity.createdAt,
      lastSentChannel: activity.diffusionChannel,
      lastSentActorId: activity.actorId,
      updatedAt: activity.createdAt,
      ...(existing.propertyUid || propertyIdentity.uid
        ? { propertyUid: existing.propertyUid ?? propertyIdentity.uid }
        : {}),
    } : {
      clientId: client.id,
      ...(canonicalUuid(client.uid) ? { clientUid: canonicalUuid(client.uid) } : {}),
      propertyId: activity.diffusionPropertyId,
      ...(propertyIdentity.uid ? { propertyUid: propertyIdentity.uid } : {}),
      sendCount: 1,
      firstSentAt: activity.createdAt,
      lastSentAt: activity.createdAt,
      lastSentChannel: activity.diffusionChannel,
      lastSentActorId: activity.actorId,
      updatedAt: activity.createdAt,
    };
    if (index >= 0) ledger[index] = next;
    else ledger.push(next);
    return;
  }

  if (!existing) return;
  ledger[index] = {
    ...existing,
    lastResponseAt: activity.createdAt,
    lastResponseChannel: activity.diffusionChannel,
    lastResponseActorId: activity.actorId,
    updatedAt: activity.createdAt,
  };
}

export function hydrateLegacyPropertyDiffusionLedger(
  client: Pick<Client, 'id' | 'uid' | 'propertyDiffusions'>,
  activities: ActivityEntry[],
): PropertyDiffusionLedgerRecord[] {
  const ledger = normalizePropertyDiffusionLedger(client.propertyDiffusions, client);
  activities
    .filter((entry) => structuredLegacyDiffusion(entry, client))
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .forEach((entry) => applyLegacyActivity(ledger, client, entry));
  return ledger.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function applyPropertyDiffusionActivityToLedger(
  client: Client,
  property: Pick<Property, 'id' | 'uid'>,
  activity: ActivityEntry,
): PropertyDiffusionLedgerRecord {
  if (!structuredLegacyDiffusion(activity, client)) {
    throw new Error('PROPERTY_DIFFUSION_ACTIVITY_INVALID');
  }
  if (!sameEntity(activity.diffusionPropertyId, activity.diffusionPropertyUid, property.id, property.uid)) {
    throw new Error('PROPERTY_DIFFUSION_ACTIVITY_PROPERTY_MISMATCH');
  }

  const ledger = normalizePropertyDiffusionLedger(client.propertyDiffusions, client);
  const index = ledger.findIndex((record) => sameProperty(record, property));
  const existing = index >= 0 ? ledger[index]! : null;

  if (activity.diffusionStatus === 'RESPONDIO' && !existing) {
    throw new Error('PROPERTY_DIFFUSION_RESPONSE_WITHOUT_SEND');
  }

  if (activity.diffusionStatus === 'ENVIADO') {
    const next: PropertyDiffusionLedgerRecord = existing ? {
      ...existing,
      sendCount: existing.sendCount + 1,
      lastSentAt: activity.createdAt,
      lastSentChannel: activity.diffusionChannel,
      lastSentActorId: activity.actorId,
      updatedAt: activity.createdAt,
      ...(canonicalUuid(property.uid) ? { propertyUid: canonicalUuid(property.uid) } : {}),
    } : {
      clientId: client.id,
      ...(canonicalUuid(client.uid) ? { clientUid: canonicalUuid(client.uid) } : {}),
      propertyId: property.id,
      ...(canonicalUuid(property.uid) ? { propertyUid: canonicalUuid(property.uid) } : {}),
      sendCount: 1,
      firstSentAt: activity.createdAt,
      lastSentAt: activity.createdAt,
      lastSentChannel: activity.diffusionChannel,
      lastSentActorId: activity.actorId,
      updatedAt: activity.createdAt,
    };
    if (index >= 0) ledger[index] = next;
    else ledger.push(next);
    client.propertyDiffusions = ledger;
    return next;
  }

  const next: PropertyDiffusionLedgerRecord = {
    ...existing!,
    lastResponseAt: activity.createdAt,
    lastResponseChannel: activity.diffusionChannel,
    lastResponseActorId: activity.actorId,
    updatedAt: activity.createdAt,
  };
  ledger[index] = next;
  client.propertyDiffusions = ledger;
  return next;
}

export function propertyDiffusionLedgerRecord(
  client: Pick<Client, 'id' | 'uid' | 'propertyDiffusions'>,
  property: Pick<Property, 'id' | 'uid'>,
): PropertyDiffusionLedgerRecord | null {
  return normalizePropertyDiffusionLedger(client.propertyDiffusions, client)
    .find((record) => sameProperty(record, property)) ?? null;
}

export function latestPropertyDiffusionSent(
  client: Pick<Client, 'id' | 'uid' | 'propertyDiffusions'>,
  property: Pick<Property, 'id' | 'uid'>,
): PropertyDiffusionLedgerMoment | null {
  const record = propertyDiffusionLedgerRecord(client, property);
  if (!record) return null;
  return {
    clientId: record.clientId,
    ...(record.clientUid ? { clientUid: record.clientUid } : {}),
    propertyId: record.propertyId,
    ...(record.propertyUid ? { propertyUid: record.propertyUid } : {}),
    actorId: record.lastSentActorId,
    createdAt: record.lastSentAt,
    diffusionChannel: record.lastSentChannel,
    diffusionStatus: 'ENVIADO',
    sendCount: record.sendCount,
  };
}

export function latestPropertyDiffusionResponse(
  client: Pick<Client, 'id' | 'uid' | 'propertyDiffusions'>,
  property: Pick<Property, 'id' | 'uid'>,
): PropertyDiffusionLedgerMoment | null {
  const record = propertyDiffusionLedgerRecord(client, property);
  if (!record?.lastResponseAt || !record.lastResponseChannel || !record.lastResponseActorId) return null;
  return {
    clientId: record.clientId,
    ...(record.clientUid ? { clientUid: record.clientUid } : {}),
    propertyId: record.propertyId,
    ...(record.propertyUid ? { propertyUid: record.propertyUid } : {}),
    actorId: record.lastResponseActorId,
    createdAt: record.lastResponseAt,
    diffusionChannel: record.lastResponseChannel,
    diffusionStatus: 'RESPONDIO',
    sendCount: record.sendCount,
  };
}

export function propertyDiffusionStatus(
  client: Pick<Client, 'id' | 'uid' | 'propertyDiffusions'>,
  property: Pick<Property, 'id' | 'uid'>,
): PropertyDiffusionStatus {
  const sent = latestPropertyDiffusionSent(client, property);
  if (!sent) return 'PENDIENTE';
  const response = latestPropertyDiffusionResponse(client, property);
  return response && Date.parse(response.createdAt) >= Date.parse(sent.createdAt) ? 'RESPONDIO' : 'ENVIADO';
}

export function propertyDiffusionSendCount(
  client: Pick<Client, 'id' | 'uid' | 'propertyDiffusions'>,
  property: Pick<Property, 'id' | 'uid'>,
): number {
  return propertyDiffusionLedgerRecord(client, property)?.sendCount ?? 0;
}
