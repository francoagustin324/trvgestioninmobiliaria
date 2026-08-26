import { isStrictLocalDate } from './lead-create-schedule.js';
import { applyCommercialStage, commercialStage, COMMERCIAL_STAGES, localIsoDate } from './lead-pipeline.js';
import type { ActivityEntry, Client, CrmData, Offer, OfferCurrency, Property, Reservation, ReservationStatus, TeamRole } from './models.js';
import { assignmentVisible } from './team-policy.js';

export interface ReservationActor { id: number; role: TeamRole }
export interface RegisterReservationInput {
  clientId: number; propertyId: number; offerId?: number; amount: number; currency: OfferCurrency | string;
  paymentMethod?: string; conditions?: string; reservedAt: string; expiresAt?: string; now?: Date;
}
export interface UpdateReservationStatusInput {
  reservationId: number; status: Extract<ReservationStatus, 'Cancelada' | 'Concretada'> | string; now?: Date;
}
export interface ReservationWorkflowResult { crm: CrmData; reservation: Reservation }

const CURRENCIES = new Set<OfferCurrency>(['USD', 'ARS']);
const FINAL_STATUSES = new Set<ReservationStatus>(['Cancelada', 'Concretada']);
const RESERVED_INDEX = COMMERCIAL_STAGES.indexOf('Reservado');

function compact(value: string, max = 120): string {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
function assertAccessible(actor: ReservationActor, assignedToId: number | undefined, label: string): void {
  if (!assignmentVisible(actor.role, actor.id, assignedToId)) throw new Error(`No tenés permiso para gestionar ${label}.`);
}
function requiredClient(crm: CrmData, actor: ReservationActor, id: number): Client {
  const value = crm.clients.find((item) => item.id === id);
  if (!value) throw new Error('El lead ya no está disponible.');
  assertAccessible(actor, value.assignedToId, 'este lead'); return value;
}
function requiredProperty(crm: CrmData, actor: ReservationActor, id: number): Property {
  const value = crm.properties.find((item) => item.id === id);
  if (!value) throw new Error('La propiedad ya no está disponible.');
  assertAccessible(actor, value.assignedToId, 'esta propiedad'); return value;
}
function requiredOffer(crm: CrmData, actor: ReservationActor, id: number): Offer {
  const value = crm.offers.find((item) => item.id === id);
  if (!value) throw new Error('La oferta vinculada ya no está disponible.');
  assertAccessible(actor, value.assignedToId, 'esta oferta'); return value;
}
function requiredReservation(crm: CrmData, actor: ReservationActor, id: number): Reservation {
  const value = crm.reservations.find((item) => item.id === id);
  if (!value) throw new Error('La reserva ya no está disponible.');
  assertAccessible(actor, value.assignedToId, 'esta reserva'); return value;
}
function strictDate(value: string, label: string): string {
  const date = value.trim(); if (!isStrictLocalDate(date)) throw new Error(`${label} no es válida.`); return date;
}
function optionalDate(value: string | undefined, label: string): string | undefined {
  const date = value?.trim() || ''; return date ? strictDate(date, label) : undefined;
}
function optionalText(value: string | undefined): string | undefined { const text = value?.trim() || ''; return text || undefined; }
function plusDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return localIsoDate(date);
}
function propertyLabel(property: Property): string { return compact(property.title?.trim() || property.address?.trim() || `Propiedad ${property.id}`, 72); }
function activeCommitment(reservation: Pick<Reservation, 'id' | 'expiresAt'>, property: Property, now: Date) {
  return {
    nextAction: `Dar seguimiento a la reserva · ${propertyLabel(property)}`,
    nextFollowUp: reservation.expiresAt ? plusDays(reservation.expiresAt, reservation.expiresAt > localIsoDate(now) ? -1 : 0) : plusDays(localIsoDate(now), 2),
  };
}
function nextId(items: Array<{ id: number }>): number { return Math.max(0, ...items.map((item) => Number.isFinite(item.id) ? item.id : 0)) + 1; }
function promote(client: Client): Client {
  const index = COMMERCIAL_STAGES.indexOf(commercialStage(client));
  return index >= 0 && index < RESERVED_INDEX ? applyCommercialStage(client, 'Reservado') : { ...client };
}
function replaceClient(crm: CrmData, client: Client): void {
  const index = crm.clients.findIndex((item) => item.id === client.id); if (index < 0) throw new Error('El lead ya no está disponible.'); crm.clients[index] = client;
}
function moneyLabel(value: Pick<Reservation, 'amount' | 'currency'>): string { return `${value.currency} ${value.amount.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`; }
function addActivity(crm: CrmData, actor: ReservationActor, action: string, client: Client, property: Property, reservation: Reservation, now: Date): void {
  const entry: ActivityEntry = { id: nextId(crm.activityLog), actorId: actor.id, action, entityType: 'Cliente', entityId: client.id,
    detail: `${compact(client.name, 48)} · ${propertyLabel(property)} · ${moneyLabel(reservation)} · ${reservation.status}${reservation.expiresAt ? ` · vence ${reservation.expiresAt}` : ''}`,
    createdAt: now.toISOString() };
  crm.activityLog.unshift(entry); crm.activityLog = crm.activityLog.slice(0, 250);
}
export function reservationsForClient(reservations: Reservation[], clientId: number): Reservation[] {
  return reservations.filter((item) => item.clientId === clientId).slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id);
}
export function registerReservation(crm: CrmData, actor: ReservationActor, input: RegisterReservationInput): ReservationWorkflowResult {
  const client = requiredClient(crm, actor, input.clientId); const property = requiredProperty(crm, actor, input.propertyId);
  const amount = Number(input.amount); if (!Number.isFinite(amount) || amount <= 0) throw new Error('Ingresá un monto válido mayor a cero.');
  const currency = String(input.currency) as OfferCurrency; if (!CURRENCIES.has(currency)) throw new Error('Seleccioná una moneda válida: USD o ARS.');
  const reservedAt = strictDate(input.reservedAt, 'La fecha de reserva'); const expiresAt = optionalDate(input.expiresAt, 'El vencimiento');
  if (expiresAt && expiresAt < reservedAt) throw new Error('El vencimiento no puede ser anterior a la fecha de reserva.');
  let offer: Offer | undefined;
  if (input.offerId !== undefined) {
    if (!Number.isFinite(input.offerId) || input.offerId <= 0) throw new Error('La oferta vinculada no es válida.');
    offer = requiredOffer(crm, actor, input.offerId);
    if (offer.clientId !== client.id) throw new Error('La oferta vinculada pertenece a otro lead.');
    if (offer.propertyId !== property.id) throw new Error('La oferta vinculada corresponde a otra propiedad.');
  }
  const assignedToId = client.assignedToId ?? actor.id; assertAccessible(actor, assignedToId, 'este lead');
  const now = input.now ?? new Date(); const next = structuredClone(crm);
  const paymentMethod = optionalText(input.paymentMethod); const conditions = optionalText(input.conditions);
  const reservation: Reservation = { id: nextId(next.reservations), clientId: client.id, propertyId: property.id, ...(offer ? { offerId: offer.id } : {}), amount, currency,
    ...(paymentMethod ? { paymentMethod } : {}), ...(conditions ? { conditions } : {}), reservedAt, ...(expiresAt ? { expiresAt } : {}), status: 'Activa', assignedToId,
    createdById: actor.id, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  const commitment = activeCommitment(reservation, property, now);
  next.reservations.push(reservation); replaceClient(next, { ...promote(client), ...commitment }); addActivity(next, actor, 'Reserva registrada', client, property, reservation, now);
  return { crm: next, reservation };
}
export function updateReservationStatus(crm: CrmData, actor: ReservationActor, input: UpdateReservationStatusInput): ReservationWorkflowResult {
  const current = requiredReservation(crm, actor, input.reservationId); if (current.status !== 'Activa') throw new Error('Esta reserva ya está cerrada y no puede modificarse.');
  const status = String(input.status) as ReservationStatus; if (!FINAL_STATUSES.has(status)) throw new Error('Seleccioná Cancelada o Concretada.');
  const client = requiredClient(crm, actor, current.clientId); const property = requiredProperty(crm, actor, current.propertyId); const now = input.now ?? new Date();
  const next = structuredClone(crm); const index = next.reservations.findIndex((item) => item.id === current.id); if (index < 0) throw new Error('La reserva ya no está disponible.');
  const reservation: Reservation = { ...next.reservations[index]!, status, updatedAt: now.toISOString() }; next.reservations[index] = reservation;
  const expected = activeCommitment(current, property, new Date(current.createdAt));
  if (client.nextAction === expected.nextAction && client.nextFollowUp === expected.nextFollowUp) {
    replaceClient(next, { ...client, nextAction: status === 'Cancelada' ? 'Retomar negociación' : 'Completar cierre de la operación', nextFollowUp: plusDays(localIsoDate(now), 1) });
  }
  addActivity(next, actor, status === 'Cancelada' ? 'Reserva cancelada' : 'Reserva concretada', client, property, reservation, now);
  return { crm: next, reservation };
}
