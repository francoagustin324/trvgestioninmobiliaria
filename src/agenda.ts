import { commercialStage, isTerminalClient } from './lead-pipeline.js';
import type { Client, Offer, Property, Reminder, Reservation, TeamMember, Visit } from './models.js';
import { assignmentVisible } from './team-policy.js';

export type AgendaUrgency = 'overdue' | 'today' | 'upcoming';
export type AgendaSource = 'client' | 'reminder' | 'visit' | 'offer' | 'reservation';
export type ReminderWithStatus = Reminder & { completedAt?: string };

export interface AgendaItem {
  id: string;
  source: AgendaSource;
  sourceId: number;
  date: string;
  urgency: AgendaUrgency;
  title: string;
  detail: string;
  secondary: string;
  priority: number;
  time?: string;
  clientId?: number;
  propertyId?: number;
}

export interface AgendaGroups {
  overdue: AgendaItem[];
  today: AgendaItem[];
  upcoming: AgendaItem[];
}

export interface AgendaRelatedOption {
  key: string;
  value: string;
  type: 'Lead';
  detail: string;
  searchable: string;
}

const urgencyOrder: Record<AgendaUrgency, number> = { overdue: 0, today: 1, upcoming: 2 };
const reminderPriority: Record<string, number> = { Alta: 0, Media: 1, Baja: 2 };
const clientPriority: Record<Client['temperature'], number> = { Caliente: 0, Tibio: 1, Frío: 2 };

function normalizedSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function todayIsoDate(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isValidIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function agendaUrgency(date: string, today: string): AgendaUrgency {
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  return 'upcoming';
}

export function daysBetweenIsoDates(from: string, to: string): number {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return 0;
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T00:00:00Z`);
  return Math.round((toTime - fromTime) / 86_400_000);
}

export function agendaRelatedOptions(clients: Client[]): AgendaRelatedOption[] {
  return clients
    .filter((client) => !isTerminalClient(client))
    .map<AgendaRelatedOption>((client) => ({
      key: `lead-${client.id}`,
      value: client.name,
      type: 'Lead',
      detail: [client.interest, client.phone].filter(Boolean).join(' · '),
      searchable: normalizedSearch([
        client.name,
        client.interest,
        client.phone,
        client.budget,
        client.nextAction,
      ].filter(Boolean).join(' ')),
    }))
    .sort((left, right) => left.value.localeCompare(right.value, 'es', { sensitivity: 'base' }));
}

export function filterAgendaRelatedOptions(
  options: AgendaRelatedOption[],
  query: string,
  limit = 8,
): AgendaRelatedOption[] {
  const normalizedQuery = normalizedSearch(query);
  if (!normalizedQuery) return [];
  return options
    .filter((option) => option.searchable.includes(normalizedQuery))
    .sort((left, right) => {
      const leftStarts = normalizedSearch(left.value).startsWith(normalizedQuery) ? 0 : 1;
      const rightStarts = normalizedSearch(right.value).startsWith(normalizedQuery) ? 0 : 1;
      return leftStarts - rightStarts
        || left.value.localeCompare(right.value, 'es', { sensitivity: 'base' });
    })
    .slice(0, limit);
}

export function buildAgendaItems(clients: Client[], reminders: Reminder[], today = todayIsoDate()): AgendaItem[] {
  const clientItems = clients.flatMap<AgendaItem>((client) => {
    if (isTerminalClient(client) || !isValidIsoDate(client.nextFollowUp)) return [];
    const budget = client.budget?.trim();
    return [{
      id: `client-${client.id}`,
      source: 'client',
      sourceId: client.id,
      date: client.nextFollowUp,
      urgency: agendaUrgency(client.nextFollowUp, today),
      title: client.name,
      detail: client.nextAction?.trim() || client.interest,
      secondary: [commercialStage(client), client.phone, budget].filter(Boolean).join(' · '),
      priority: clientPriority[client.temperature],
    }];
  });

  const reminderItems = reminders.flatMap<AgendaItem>((reminder) => {
    const reminderWithStatus = reminder as ReminderWithStatus;
    if (reminderWithStatus.completedAt || !isValidIsoDate(reminder.date)) return [];
    return [{
      id: `reminder-${reminder.id}`,
      source: 'reminder',
      sourceId: reminder.id,
      date: reminder.date,
      urgency: agendaUrgency(reminder.date, today),
      title: reminder.title,
      detail: reminder.related,
      secondary: `Recordatorio · ${reminder.priority || 'Sin prioridad'}`,
      priority: reminderPriority[reminder.priority] ?? 3,
    }];
  });

  return [...clientItems, ...reminderItems].sort((left, right) => (
    urgencyOrder[left.urgency] - urgencyOrder[right.urgency]
    || left.date.localeCompare(right.date)
    || left.priority - right.priority
    || left.title.localeCompare(right.title, 'es')
  ));
}

export interface CommercialAgendaInput {
  clients: Client[];
  reminders: Reminder[];
  visits: Visit[];
  offers: Offer[];
  reservations: Reservation[];
  properties: Property[];
  actor: Pick<TeamMember, 'id' | 'role'>;
}

function canonicalDateTime(value: string | undefined): { date: string; time?: string } | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(value.trim());
  if (!match?.[1] || !isValidIsoDate(match[1])) return null;
  return {
    date: match[1],
    ...(match[2] ? { time: match[2] } : {}),
  };
}

function agendaClientLabel(clients: Client[], clientId: number): Client | null {
  return clients.find((client) => client.id === clientId) ?? null;
}

function agendaPropertyLabel(properties: Property[], propertyId: number): Property | null {
  return properties.find((property) => property.id === propertyId) ?? null;
}

function sortAgendaItems(items: AgendaItem[]): AgendaItem[] {
  return items.sort((left, right) => (
    urgencyOrder[left.urgency] - urgencyOrder[right.urgency]
    || left.date.localeCompare(right.date)
    || String(left.time ?? '').localeCompare(String(right.time ?? ''))
    || left.priority - right.priority
    || left.title.localeCompare(right.title, 'es')
  ));
}

export function buildCommercialAgendaItems(
  input: CommercialAgendaInput,
  today = todayIsoDate(),
): AgendaItem[] {
  const baseItems = buildAgendaItems(input.clients, input.reminders, today);

  const visitItems = input.visits.flatMap<AgendaItem>((visit) => {
    if (visit.status !== 'Coordinada') return [];
    if (!assignmentVisible(input.actor.role, input.actor.id, visit.assignedToId)) return [];
    const when = canonicalDateTime(visit.scheduledAt);
    const client = agendaClientLabel(input.clients, visit.clientId);
    if (!when || !client) return [];
    const property = agendaPropertyLabel(input.properties, visit.propertyId);
    return [{
      id: `visit-${visit.id}`,
      source: 'visit',
      sourceId: visit.id,
      date: when.date,
      time: when.time,
      urgency: agendaUrgency(when.date, today),
      title: client.name,
      detail: 'Visita coordinada',
      secondary: [property?.title || property?.address || '', when.time ? `${when.time} hs` : ''].filter(Boolean).join(' · '),
      priority: 0,
      clientId: visit.clientId,
      propertyId: visit.propertyId,
    }];
  });

  const offerItems = input.offers.flatMap<AgendaItem>((offer) => {
    if (offer.status !== 'Pendiente') return [];
    if (!assignmentVisible(input.actor.role, input.actor.id, offer.assignedToId)) return [];
    const validUntil = canonicalDateTime(offer.validUntil);
    const client = agendaClientLabel(input.clients, offer.clientId);
    if (!validUntil || !client) return [];
    const property = agendaPropertyLabel(input.properties, offer.propertyId);
    return [{
      id: `offer-${offer.id}`,
      source: 'offer',
      sourceId: offer.id,
      date: validUntil.date,
      urgency: agendaUrgency(validUntil.date, today),
      title: client.name,
      detail: 'Oferta pendiente',
      secondary: [
        property?.title || property?.address || '',
        `${offer.currency} ${new Intl.NumberFormat('es-AR').format(offer.amount)}`,
      ].filter(Boolean).join(' · '),
      priority: 1,
      clientId: offer.clientId,
      propertyId: offer.propertyId,
    }];
  });

  const reservationItems = input.reservations.flatMap<AgendaItem>((reservation) => {
    if (reservation.status !== 'Activa') return [];
    if (!assignmentVisible(input.actor.role, input.actor.id, reservation.assignedToId)) return [];
    const expiresAt = canonicalDateTime(reservation.expiresAt);
    const client = agendaClientLabel(input.clients, reservation.clientId);
    if (!expiresAt || !client) return [];
    const property = agendaPropertyLabel(input.properties, reservation.propertyId);
    return [{
      id: `reservation-${reservation.id}`,
      source: 'reservation',
      sourceId: reservation.id,
      date: expiresAt.date,
      urgency: agendaUrgency(expiresAt.date, today),
      title: client.name,
      detail: 'Reserva activa',
      secondary: [
        property?.title || property?.address || '',
        `${reservation.currency} ${new Intl.NumberFormat('es-AR').format(reservation.amount)}`,
      ].filter(Boolean).join(' · '),
      priority: 1,
      clientId: reservation.clientId,
      propertyId: reservation.propertyId,
    }];
  });

  return sortAgendaItems([
    ...baseItems,
    ...visitItems,
    ...offerItems,
    ...reservationItems,
  ]);
}

export function completedReminders(reminders: Reminder[]): ReminderWithStatus[] {
  return reminders
    .map((reminder) => reminder as ReminderWithStatus)
    .filter((reminder) => Boolean(reminder.completedAt))
    .sort((left, right) => String(right.completedAt).localeCompare(String(left.completedAt)));
}

export function groupAgendaItems(items: AgendaItem[]): AgendaGroups {
  return items.reduce<AgendaGroups>((groups, item) => {
    groups[item.urgency].push(item);
    return groups;
  }, { overdue: [], today: [], upcoming: [] });
}
