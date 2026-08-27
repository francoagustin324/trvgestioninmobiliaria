import { isStrictLocalDate } from './lead-create-schedule.js';
import {
  applyCommercialStage,
  commercialStage,
  COMMERCIAL_STAGES,
  isTerminalClient,
  localIsoDate,
} from './lead-pipeline.js';
import type {
  ActivityEntry,
  Client,
  CrmData,
  Offer,
  SyncedOffer,
  OfferCurrency,
  OfferOrigin,
  OfferStatus,
  Property,
  TeamRole,
} from './models.js';
import { newSyncRecordMetadata } from './sync-identity.js';
import { assignmentVisible } from './team-policy.js';

export interface OfferActor {
  id: number;
  role: TeamRole;
}

export interface RegisterOfferInput {
  clientId: number;
  propertyId: number;
  amount: number;
  currency: OfferCurrency | string;
  origin: OfferOrigin | string;
  paymentTerms?: string;
  conditions?: string;
  validUntil?: string;
  nextAction: string;
  nextFollowUp: string;
  now?: Date;
}

export interface RegisterCounterOfferInput {
  parentOfferId: number;
  amount: number;
  currency: OfferCurrency | string;
  origin: OfferOrigin | string;
  paymentTerms?: string;
  conditions?: string;
  validUntil?: string;
  nextAction: string;
  nextFollowUp: string;
  now?: Date;
}

export interface ResolveOfferInput {
  offerId: number;
  status: Extract<OfferStatus, 'Aceptada' | 'Rechazada' | 'Retirada'> | string;
  nextAction?: string;
  nextFollowUp?: string;
  now?: Date;
}

export interface OfferWorkflowResult {
  crm: CrmData;
  offer: SyncedOffer;
}

const CURRENCIES = new Set<OfferCurrency>(['USD', 'ARS']);
const ORIGINS = new Set<OfferOrigin>(['Cliente', 'Propietario']);
const RESOLUTION_STATUSES = new Set<OfferStatus>(['Aceptada', 'Rechazada', 'Retirada']);
const NEGOTIATION_INDEX = COMMERCIAL_STAGES.indexOf('Negociación');

function compact(value: string, max = 120): string {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function assertAccessible(actor: OfferActor, assignedToId: number | undefined, label: string): void {
  if (!assignmentVisible(actor.role, actor.id, assignedToId)) {
    throw new Error(`No tenés permiso para gestionar ${label}.`);
  }
}

function requiredClient(crm: CrmData, actor: OfferActor, clientId: number): Client {
  const client = crm.clients.find((item) => item.id === clientId);
  if (!client) throw new Error('El lead ya no está disponible.');
  assertAccessible(actor, client.assignedToId, 'este lead');
  return client;
}

function requiredProperty(crm: CrmData, actor: OfferActor, propertyId: number): Property {
  const property = crm.properties.find((item) => item.id === propertyId);
  if (!property) throw new Error('La propiedad ya no está disponible.');
  assertAccessible(actor, property.assignedToId, 'esta propiedad');
  return property;
}

function requiredOffer(crm: CrmData, actor: OfferActor, offerId: number): Offer {
  const offer = crm.offers.find((item) => item.id === offerId);
  if (!offer) throw new Error('La oferta ya no está disponible.');
  assertAccessible(actor, offer.assignedToId, 'esta oferta');
  return offer;
}

function validateAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Ingresá un monto válido mayor a cero.');
  return amount;
}

function validateCurrency(value: string): OfferCurrency {
  if (!CURRENCIES.has(value as OfferCurrency)) throw new Error('Seleccioná una moneda válida: USD o ARS.');
  return value as OfferCurrency;
}

function validateOrigin(value: string): OfferOrigin {
  if (!ORIGINS.has(value as OfferOrigin)) throw new Error('Seleccioná un origen válido: Cliente o Propietario.');
  return value as OfferOrigin;
}

function optionalText(value: string | undefined): string | undefined {
  const text = value?.trim() || '';
  return text || undefined;
}

function validateOptionalDate(value: string | undefined, label: string): string | undefined {
  const date = value?.trim() || '';
  if (!date) return undefined;
  if (!isStrictLocalDate(date)) throw new Error(`${label} no es válida.`);
  return date;
}

function validateCommitment(nextAction: string | undefined, nextFollowUp: string | undefined, now: Date): { nextAction: string; nextFollowUp: string } {
  const action = nextAction?.trim() || '';
  const followUp = nextFollowUp?.trim() || '';
  if (!action) throw new Error('Definí la próxima acción comercial.');
  if (!isStrictLocalDate(followUp)) throw new Error('Definí una próxima fecha válida.');
  if (followUp < localIsoDate(now)) throw new Error('La próxima fecha no puede estar en el pasado.');
  return { nextAction: action, nextFollowUp: followUp };
}

function propertyLabel(property: Property): string {
  return compact(property.title?.trim() || property.address?.trim() || `Propiedad ${property.id}`, 72);
}

function moneyLabel(offer: Pick<Offer, 'amount' | 'currency'>): string {
  return `${offer.currency} ${offer.amount.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}

function nextOfferId(offers: Offer[]): number {
  return Math.max(0, ...offers.map((offer) => Number.isFinite(offer.id) ? offer.id : 0)) + 1;
}

function nextActivityId(entries: ActivityEntry[]): number {
  return Math.max(0, ...entries.map((entry) => Number.isFinite(entry.id) ? entry.id : 0)) + 1;
}

function promoteToNegotiation(client: Client): Client {
  const stage = commercialStage(client);
  const index = COMMERCIAL_STAGES.indexOf(stage);
  if (index >= 0 && index < NEGOTIATION_INDEX) return applyCommercialStage(client, 'Negociación');
  return { ...client };
}

function withCommitment(client: Client, commitment: { nextAction: string; nextFollowUp: string }): Client {
  return {
    ...promoteToNegotiation(client),
    nextAction: commitment.nextAction,
    nextFollowUp: commitment.nextFollowUp,
  };
}

function addDerivedActivity(
  crm: CrmData,
  actor: OfferActor,
  action: string,
  client: Client,
  property: Property,
  offer: Offer,
  now: Date,
): void {
  const entry: ActivityEntry = {
    ...newSyncRecordMetadata(),
    id: nextActivityId(crm.activityLog),
    actorId: actor.id,
    action,
    entityType: 'Cliente',
    entityId: client.id,
    detail: `${compact(client.name, 48)} · ${propertyLabel(property)} · ${moneyLabel(offer)} · ${offer.status}`,
    createdAt: now.toISOString(),
  };
  crm.activityLog.unshift(entry);
  crm.activityLog = crm.activityLog.slice(0, 250);
}

function replaceClient(crm: CrmData, client: Client): void {
  const index = crm.clients.findIndex((item) => item.id === client.id);
  if (index < 0) throw new Error('El lead ya no está disponible.');
  crm.clients[index] = client;
}

function normalizedOfferFields(input: Pick<RegisterOfferInput, 'amount' | 'currency' | 'origin' | 'paymentTerms' | 'conditions' | 'validUntil'>) {
  return {
    amount: validateAmount(input.amount),
    currency: validateCurrency(String(input.currency)),
    origin: validateOrigin(String(input.origin)),
    paymentTerms: optionalText(input.paymentTerms),
    conditions: optionalText(input.conditions),
    validUntil: validateOptionalDate(input.validUntil, 'La vigencia'),
  };
}

export function offersForClient(offers: Offer[], clientId: number): Offer[] {
  return offers
    .filter((offer) => offer.clientId === clientId)
    .slice()
    .sort((left, right) => {
      const leftMs = Date.parse(left.createdAt);
      const rightMs = Date.parse(right.createdAt);
      if (leftMs !== rightMs) return rightMs - leftMs;
      return right.id - left.id;
    });
}

export function registerOffer(crm: CrmData, actor: OfferActor, input: RegisterOfferInput): OfferWorkflowResult {
  const client = requiredClient(crm, actor, input.clientId);
  if (isTerminalClient(client)) throw new Error('Un lead ganado o perdido no puede registrar ofertas nuevas.');
  const property = requiredProperty(crm, actor, input.propertyId);
  const now = input.now ?? new Date();
  const fields = normalizedOfferFields(input);
  const commitment = validateCommitment(input.nextAction, input.nextFollowUp, now);
  const assignedToId = client.assignedToId ?? actor.id;
  assertAccessible(actor, assignedToId, 'este lead');

  const next = structuredClone(crm);
  const offer: SyncedOffer = {
    ...newSyncRecordMetadata(),
    id: nextOfferId(next.offers),
    clientId: client.id,
    propertyId: property.id,
    origin: fields.origin,
    amount: fields.amount,
    currency: fields.currency,
    paymentTerms: fields.paymentTerms,
    conditions: fields.conditions,
    validUntil: fields.validUntil,
    status: 'Pendiente',
    assignedToId,
    createdById: actor.id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  next.offers.push(offer);
  replaceClient(next, withCommitment(client, commitment));
  addDerivedActivity(next, actor, 'Oferta registrada', client, property, offer, now);
  return { crm: next, offer };
}

export function registerCounterOffer(crm: CrmData, actor: OfferActor, input: RegisterCounterOfferInput): OfferWorkflowResult {
  const parent = requiredOffer(crm, actor, input.parentOfferId);
  if (parent.status !== 'Pendiente') throw new Error('Sólo una oferta pendiente puede recibir una contraoferta.');
  const client = requiredClient(crm, actor, parent.clientId);
  if (isTerminalClient(client)) throw new Error('Un lead ganado o perdido no puede registrar ofertas nuevas.');
  const property = requiredProperty(crm, actor, parent.propertyId);
  if (parent.clientId !== client.id || parent.propertyId !== property.id) {
    throw new Error('La oferta no corresponde al lead y propiedad esperados.');
  }
  const now = input.now ?? new Date();
  const fields = normalizedOfferFields(input);
  const commitment = validateCommitment(input.nextAction, input.nextFollowUp, now);
  const assignedToId = client.assignedToId ?? actor.id;
  assertAccessible(actor, assignedToId, 'este lead');

  const next = structuredClone(crm);
  const parentIndex = next.offers.findIndex((offer) => offer.id === parent.id);
  if (parentIndex < 0) throw new Error('La oferta ya no está disponible.');
  next.offers[parentIndex] = { ...next.offers[parentIndex]!, status: 'Contraofertada', updatedAt: now.toISOString() };
  const child: SyncedOffer = {
    ...newSyncRecordMetadata(),
    id: nextOfferId(next.offers),
    clientId: client.id,
    propertyId: property.id,
    parentOfferId: parent.id,
    origin: fields.origin,
    amount: fields.amount,
    currency: fields.currency,
    paymentTerms: fields.paymentTerms,
    conditions: fields.conditions,
    validUntil: fields.validUntil,
    status: 'Pendiente',
    assignedToId,
    createdById: actor.id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  next.offers.push(child);
  replaceClient(next, withCommitment(client, commitment));
  addDerivedActivity(next, actor, 'Contraoferta registrada', client, property, child, now);
  return { crm: next, offer: child };
}

function resolutionAction(status: OfferStatus): string {
  if (status === 'Aceptada') return 'Oferta aceptada';
  if (status === 'Rechazada') return 'Oferta rechazada';
  return 'Oferta retirada';
}

export function resolveOffer(crm: CrmData, actor: OfferActor, input: ResolveOfferInput): OfferWorkflowResult {
  const offer = requiredOffer(crm, actor, input.offerId);
  if (offer.status !== 'Pendiente') throw new Error('Esta oferta ya está cerrada y no puede modificarse.');
  const status = String(input.status) as OfferStatus;
  if (!RESOLUTION_STATUSES.has(status)) throw new Error('Seleccioná un estado válido para cerrar la oferta.');
  const client = requiredClient(crm, actor, offer.clientId);
  const property = requiredProperty(crm, actor, offer.propertyId);
  if (offer.clientId !== client.id || offer.propertyId !== property.id) {
    throw new Error('La oferta no corresponde al lead y propiedad esperados.');
  }
  const now = input.now ?? new Date();
  const terminal = isTerminalClient(client);
  const commitment = terminal ? null : validateCommitment(input.nextAction, input.nextFollowUp, now);

  const next = structuredClone(crm);
  const offerIndex = next.offers.findIndex((item) => item.id === offer.id);
  if (offerIndex < 0) throw new Error('La oferta ya no está disponible.');
  const resolved: Offer = { ...next.offers[offerIndex]!, status, updatedAt: now.toISOString() };
  next.offers[offerIndex] = resolved;
  if (commitment) replaceClient(next, withCommitment(client, commitment));
  addDerivedActivity(next, actor, resolutionAction(status), client, property, resolved, now);
  return { crm: next, offer: resolved };
}
