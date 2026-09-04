import type { ActivityEntry, Client, Offer, Reservation, SyncedVisit } from './models.js';

export type ReactivationPriority = 'Alta' | 'Media' | 'Baja';
export type ReactivationDormantBucket = '30+' | '60+' | '90+';
export type ReactivationSnoozeDays = 7 | 30 | 60;

export interface ReactivationCandidate {
  clientId: number;
  priority: ReactivationPriority;
  reason: string;
  supportingReasons: string[];
  lastMilestone: string;
  suggestedAction: string;
  dormantDays?: number;
  dormantBucket?: ReactivationDormantBucket;
  overdueDays?: number;
}

export interface ReactivationOptions {
  now?: Date | string;
  visits?: SyncedVisit[];
  offers?: Offer[];
  reservations?: Reservation[];
}

interface UsefulEvent {
  at: string;
  label: string;
}

interface OpportunitySignal {
  weight: number;
  reason: string;
  event?: UsefulEvent;
}

function normalized(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function dateOnly(value: unknown): string | undefined {
  const match = String(value ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
}

function todayIso(value: Date | string = new Date()): string {
  if (typeof value === 'string') {
    const direct = dateOnly(value);
    if (direct) return direct;
    value = new Date(value);
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateMillis(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year || 1970, Math.max(0, (month || 1) - 1), day || 1, 12);
}

function daysBetween(later: string, earlier: string): number {
  return Math.max(0, Math.floor((dateMillis(later) - dateMillis(earlier)) / 86_400_000));
}

export function addIsoDays(date: string, days: number): string {
  const value = new Date(dateMillis(date));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isTerminal(client: Client): boolean {
  if (client.outcome === 'won' || client.outcome === 'lost') return true;
  const stage = normalized(client.pipeline);
  const status = normalized(client.status);
  return stage.includes('ganad')
    || stage.includes('perdid')
    || status.includes('operacion ganada')
    || status.includes('operacion perdida')
    || status === 'cerrado';
}

function sameClient(entry: ActivityEntry, client: Client): boolean {
  if (entry.entityType !== 'Cliente') return false;
  if (entry.entityId === client.id) return true;
  return Boolean(client.uid && entry.entityUid && client.uid === entry.entityUid);
}

function usefulActivity(entry: ActivityEntry): boolean {
  const action = normalized(entry.action);
  return [
    'contact',
    'whatsapp',
    'seguimiento completado',
    'visita',
    'oferta',
    'reserva',
    'calific',
    'cambio de etapa',
    'operacion reabierta',
  ].some((token) => action.includes(token));
}

function usefulEvents(
  client: Client,
  activities: ActivityEntry[],
  visits: SyncedVisit[],
  offers: Offer[],
  reservations: Reservation[],
): UsefulEvent[] {
  const events: UsefulEvent[] = [];
  const lastContact = dateOnly(client.lastContact);
  if (lastContact) events.push({ at: `${lastContact}T12:00:00.000Z`, label: 'Último contacto' });

  activities.filter((entry) => sameClient(entry, client) && usefulActivity(entry)).forEach((entry) => {
    events.push({ at: entry.createdAt, label: entry.action });
  });
  visits.filter((visit) => visit.clientId === client.id && visit.status === 'Realizada').forEach((visit) => {
    events.push({ at: visit.updatedAt || visit.scheduledAt, label: 'Visita realizada' });
  });
  offers.filter((offer) => offer.clientId === client.id).forEach((offer) => {
    events.push({ at: offer.updatedAt || offer.createdAt, label: `Oferta ${offer.status.toLowerCase()}` });
  });
  reservations.filter((reservation) => reservation.clientId === client.id).forEach((reservation) => {
    events.push({ at: reservation.updatedAt || reservation.createdAt, label: `Reserva ${reservation.status.toLowerCase()}` });
  });
  return events.filter((event) => Boolean(dateOnly(event.at)));
}

function latestUsefulEvent(events: UsefulEvent[]): UsefulEvent | undefined {
  return [...events].sort((left, right) => right.at.localeCompare(left.at))[0];
}

function opportunitySignals(
  client: Client,
  visits: SyncedVisit[],
  offers: Offer[],
  reservations: Reservation[],
  today: string,
): OpportunitySignal[] {
  const signals: OpportunitySignal[] = [];
  const realized = visits
    .filter((visit) => visit.clientId === client.id && visit.status === 'Realizada')
    .sort((left, right) => (right.updatedAt || right.scheduledAt).localeCompare(left.updatedAt || left.scheduledAt))[0];
  if (realized) {
    signals.push({
      weight: 4,
      reason: realized.interest === 'Alto' ? 'Visitó una propiedad anteriormente · interés alto' : 'Visitó una propiedad anteriormente',
      event: { at: realized.updatedAt || realized.scheduledAt, label: 'Visita realizada' },
    });
  }

  const nonCurrentReservation = reservations
    .filter((reservation) => reservation.clientId === client.id && (
      reservation.status === 'Cancelada'
      || (reservation.status === 'Activa' && Boolean(reservation.expiresAt) && String(reservation.expiresAt) < today)
    ))
    .sort((left, right) => (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt))[0];
  if (nonCurrentReservation) {
    signals.push({
      weight: 4,
      reason: 'Tuvo una reserva no vigente',
      event: { at: nonCurrentReservation.updatedAt || nonCurrentReservation.createdAt, label: 'Reserva no vigente' },
    });
  }

  const offer = offers
    .filter((item) => item.clientId === client.id)
    .sort((left, right) => (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt))[0];
  if (offer) {
    signals.push({
      weight: 3,
      reason: 'Tuvo una oferta comercial',
      event: { at: offer.updatedAt || offer.createdAt, label: `Oferta ${offer.status.toLowerCase()}` },
    });
  }

  if (client.temperature === 'Caliente' || realized?.interest === 'Alto') {
    signals.push({ weight: 2, reason: 'Interés comercial alto' });
  }
  return signals.sort((left, right) => right.weight - left.weight || (right.event?.at || '').localeCompare(left.event?.at || ''));
}

function commercialInterest(client: Client): boolean {
  return Boolean(
    client.interest?.trim()
    || client.zones?.trim()
    || client.budget?.trim()
    || client.propertyType?.trim()
    || client.operation?.trim(),
  );
}

function dormantBucket(days: number): ReactivationDormantBucket | undefined {
  if (days >= 90) return '90+';
  if (days >= 60) return '60+';
  if (days >= 30) return '30+';
  return undefined;
}

function priorityWeight(priority: ReactivationPriority): number {
  return priority === 'Alta' ? 3 : priority === 'Media' ? 2 : 1;
}

function readableEvent(event: UsefulEvent | undefined): string {
  if (!event) return 'Sin hito comercial registrado';
  const date = dateOnly(event.at);
  if (!date) return event.label;
  const [year, month, day] = date.split('-');
  return `${event.label} · ${day}/${month}/${year}`;
}

export function reactivationCandidates(
  clients: Client[],
  activities: ActivityEntry[],
  options: ReactivationOptions = {},
): ReactivationCandidate[] {
  const today = todayIso(options.now || new Date());
  const visits = options.visits || [];
  const offers = options.offers || [];
  const reservations = options.reservations || [];
  const candidates: Array<ReactivationCandidate & { sortRank: number; signalWeight: number }> = [];

  for (const client of clients) {
    if (isTerminal(client)) continue;
    const snoozedUntil = dateOnly(client.reactivationSnoozedUntil);
    if (snoozedUntil && snoozedUntil > today) continue;

    const followUp = dateOnly(client.nextFollowUp);
    if (followUp && followUp >= today) continue;

    const events = usefulEvents(client, activities, visits, offers, reservations);
    const latest = latestUsefulEvent(events);
    const latestDate = latest ? dateOnly(latest.at) : undefined;
    const dormantDays = latestDate && latestDate < today ? daysBetween(today, latestDate) : undefined;
    const bucket = dormantDays === undefined ? undefined : dormantBucket(dormantDays);
    const overdueDays = followUp && followUp < today ? daysBetween(today, followUp) : undefined;
    const noNextStep = !client.nextAction?.trim() && !followUp && commercialInterest(client);
    const signals = opportunitySignals(client, visits, offers, reservations, today);
    const strongest = signals[0];

    let priority: ReactivationPriority;
    let reason: string;
    let suggestedAction: string;
    let sortRank: number;

    if (overdueDays && overdueDays > 0) {
      priority = 'Alta';
      reason = `Seguimiento vencido hace ${overdueDays} ${overdueDays === 1 ? 'día' : 'días'}`;
      suggestedAction = 'Retomar el seguimiento hoy';
      sortRank = 500 + Math.min(overdueDays, 90);
    } else if (noNextStep) {
      priority = strongest && strongest.weight >= 3 ? 'Alta' : 'Media';
      reason = 'Sin próximo seguimiento';
      suggestedAction = 'Contactar y definir el próximo paso';
      sortRank = strongest && strongest.weight >= 3 ? 450 : 360;
    } else if (strongest) {
      priority = strongest.weight >= 3 ? 'Alta' : 'Media';
      reason = strongest.reason;
      suggestedAction = 'Retomar la oportunidad con contexto';
      sortRank = strongest.weight >= 3 ? 420 : 320;
    } else if (bucket) {
      priority = bucket === '30+' ? 'Baja' : 'Media';
      reason = `Sin movimiento comercial hace ${dormantDays} días`;
      suggestedAction = 'Validar si la búsqueda sigue activa';
      sortRank = bucket === '90+' ? 280 : bucket === '60+' ? 250 : 150;
    } else {
      continue;
    }

    const supportingReasons = signals
      .map((signal) => signal.reason)
      .filter((signalReason) => signalReason !== reason)
      .slice(0, 2);
    candidates.push({
      clientId: client.id,
      priority,
      reason,
      supportingReasons,
      lastMilestone: readableEvent(latest || strongest?.event),
      suggestedAction,
      dormantDays,
      dormantBucket: bucket,
      overdueDays,
      sortRank,
      signalWeight: strongest?.weight || 0,
    });
  }

  return candidates
    .sort((left, right) => (
      priorityWeight(right.priority) - priorityWeight(left.priority)
      || right.sortRank - left.sortRank
      || right.signalWeight - left.signalWeight
      || (right.dormantDays || 0) - (left.dormantDays || 0)
      || left.clientId - right.clientId
    ))
    .map(({ sortRank: _sortRank, signalWeight: _signalWeight, ...candidate }) => candidate);
}

export function snoozeReactivation(
  client: Client,
  days: ReactivationSnoozeDays,
  now: Date | string = new Date(),
): {
  client: Client;
  activity: Omit<ActivityEntry, 'id' | 'actorId' | 'createdAt'>;
} {
  const today = todayIso(now);
  const until = addIsoDays(today, days);
  return {
    client: { ...client, reactivationSnoozedUntil: until },
    activity: {
      action: 'Reactivación postergada',
      entityType: 'Cliente',
      entityId: client.id,
      entityUid: client.uid,
      detail: `${client.name} · ${days} días · hasta ${until}`,
    },
  };
}
