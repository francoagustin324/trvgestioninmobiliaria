import { leadCardAttentionPresentation } from './lead-card-attention.js';
import { leadDaysFromToday, leadPrimaryAlert, sortLeads, type LeadAlertKind } from './lead-list-priority.js';
import { commercialStage, isTerminalClient, localIsoDate } from './lead-pipeline.js';
import { matchDismissalActive, matchPropertiesForClient } from './property-matching.js';
import { assignmentVisible } from './team-policy.js';
import type { ActivityEntry, Client, Offer, Property, Reminder, Reservation, TeamRole, Visit } from './models.js';
import { escapeHtml } from './utils.js';

export interface LeadAttentionRecommendation {
  clientId: number;
  name: string;
  reason: string;
  alertKind: LeadAlertKind;
  action: string;
  when: string;
  relevantDate: string;
  stage: string;
}

function temporalContext(reason: string, dateLabel: string): string {
  if (!dateLabel) return '';
  const normalizedReason = reason.toLocaleLowerCase('es-AR');
  const normalizedDate = dateLabel.toLocaleLowerCase('es-AR');
  return normalizedReason.includes(normalizedDate) ? '' : dateLabel;
}

export function supervisedAttentionRecommendationForClient(
  client: Client,
  today = localIsoDate(),
): LeadAttentionRecommendation | null {
  if (isTerminalClient(client)) return null;
  const primaryAlert = leadPrimaryAlert(client, today);
  const presentation = leadCardAttentionPresentation(client, today);
  const reason = primaryAlert.label;
  const dateLabel = presentation.dateLabel || presentation.scheduledDateLabel || '';
  return {
    clientId: client.id,
    name: client.name,
    reason,
    alertKind: primaryAlert.kind,
    action: presentation.actionLabel,
    when: temporalContext(reason, dateLabel),
    relevantDate: presentation.scheduledDate,
    stage: commercialStage(client),
  };
}

export function supervisedAttentionQueue(
  clients: Client[],
  today = localIsoDate(),
  limit = 3,
): LeadAttentionRecommendation[] {
  const cappedLimit = Math.min(3, Math.max(0, Math.trunc(limit)));
  const active = clients.filter((client) => !isTerminalClient(client));

  return sortLeads(active, 'priority', today)
    .slice(0, cappedLimit)
    .map((client) => supervisedAttentionRecommendationForClient(client, today))
    .filter((item): item is LeadAttentionRecommendation => Boolean(item));
}

export function renderSupervisedAttentionQueue(clients: Client[], today = localIsoDate()): string {
  const recommendations = supervisedAttentionQueue(clients, today, 3);
  const body = recommendations.length
    ? `<div class="pc-supervised-attention-list">${recommendations.map((recommendation) => `<button type="button" class="pc-supervised-attention-item" data-attention-client-id="${recommendation.clientId}" aria-label="Abrir ficha completa de ${escapeHtml(recommendation.name)}">
      <strong class="pc-supervised-attention-name">${escapeHtml(recommendation.name)}</strong>
      <span class="pc-supervised-attention-reason" title="${escapeHtml(recommendation.reason)}">${escapeHtml(recommendation.reason)}${recommendation.when ? ` <small>· ${escapeHtml(recommendation.when)}</small>` : ''}</span>
      <span class="pc-supervised-attention-action" title="${escapeHtml(recommendation.action)}"><b aria-hidden="true">→</b> ${escapeHtml(recommendation.action)}</span>
    </button>`).join('')}</div>`
    : '<p class="pc-supervised-attention-empty">No hay leads activos para atender ahora.</p>';

  return `<section class="pc-supervised-attention-queue" data-supervised-attention-queue aria-labelledby="pc-supervised-attention-title">
    <header class="pc-supervised-attention-heading">
      <strong id="pc-supervised-attention-title">LEADS PRIORITARIOS</strong>
      <span class="pc-supervised-attention-copy"><span class="pc-supervised-attention-copy-full">Gestioná primero los contactos que requieren acción.</span><span class="pc-supervised-attention-copy-compact">Contactos para gestionar primero.</span></span>
    </header>
    ${body}
    <p class="pc-supervised-attention-status" data-attention-navigation-status role="status" aria-live="polite" hidden></p>
  </section>`;
}

export type OperationalPriority = 'CRÍTICO' | 'ALTO' | 'NORMAL';
export type OperationalTarget = 'lead' | 'visits' | 'offers' | 'reservations' | 'matches' | 'agenda';
export type OperationalActionKind =
  | 'new-uncontacted'
  | 'follow-up-overdue'
  | 'visit-confirm'
  | 'visit-result'
  | 'offer-stalled'
  | 'reservation-attention'
  | 'advanced-no-action'
  | 'forgotten-client'
  | 'new-match'
  | 'task-overdue'
  | 'next-follow-up'
  | 'close-intervention';

export interface OperationalAttentionItem {
  key: string;
  kind: OperationalActionKind;
  priority: OperationalPriority;
  rank: number;
  clientId?: number;
  propertyId?: number;
  sourceId?: number;
  module: 'crm' | 'agenda';
  target: OperationalTarget;
  name: string;
  reason: string;
  action: string;
  when: string;
}

export interface OperationalAttentionInput {
  clients: Client[];
  properties: Property[];
  visits: Visit[];
  offers: Offer[];
  reservations: Reservation[];
  reminders: Reminder[];
  activityLog?: ActivityEntry[];
  actor?: { id: number; role: TeamRole };
  today?: string;
  now?: Date;
}

const OPERATIONAL_DAY_MS = 86_400_000;

function assignmentAllowed(input: OperationalAttentionInput, assignedToId: number | undefined): boolean {
  return !input.actor || assignmentVisible(input.actor.role, input.actor.id, assignedToId);
}

function dateAgeDays(value: string | undefined, now: Date): number | null {
  if (!value) return null;
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return null;
  return Math.max(0, Math.floor((now.getTime() - stamp) / OPERATIONAL_DAY_MS));
}

function latestClientTouch(client: Client, activities: ActivityEntry[]): string | undefined {
  const candidates = [
    client.lastContact,
    client.qualificationUpdatedAt,
    ...activities
      .filter((entry) => entry.entityType === 'Cliente' && entry.entityId === client.id)
      .map((entry) => entry.createdAt),
  ].filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value))));
  return candidates.sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function leadCreatedAt(client: Client, activities: ActivityEntry[]): string | undefined {
  return activities
    .filter((entry) => entry.entityType === 'Cliente' && entry.entityId === client.id && entry.action === 'Lead creado')
    .map((entry) => entry.createdAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
}

function relativeAge(value: string | undefined, now: Date): string {
  if (!value) return 'Atender ahora';
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return 'Atender ahora';
  const minutes = Math.max(0, Math.floor((now.getTime() - stamp) / 60_000));
  if (minutes < 60) return minutes <= 1 ? 'Hace 1 min' : `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'Hace 1 h' : `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Hace 1 día' : `Hace ${days} días`;
}

function relativeDate(value: string | undefined, today: string): string {
  if (!value) return '';
  const days = leadDaysFromToday(value, today);
  if (days === null) return value;
  if (days < -1) return `Vencido hace ${Math.abs(days)} días`;
  if (days === -1) return 'Vencido ayer';
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  if (days <= 7) return `En ${days} días`;
  return value;
}

function visitDate(visit: Visit): string {
  const date = new Date(visit.scheduledAt);
  return Number.isNaN(date.getTime()) ? '' : localIsoDate(date);
}

function visitTimeLabel(visit: Visit): string {
  const date = new Date(visit.scheduledAt);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function clientName(clients: Client[], clientId: number): string {
  return clients.find((client) => client.id === clientId)?.name || `Cliente #${clientId}`;
}

function propertyLabel(properties: Property[], propertyId: number): string {
  const property = properties.find((item) => item.id === propertyId);
  return property?.title?.trim() || property?.address?.trim() || `Propiedad #${propertyId}`;
}

function normalize(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function reminderClient(reminder: Reminder, clients: Client[]): Client | undefined {
  const related = normalize(reminder.related);
  if (!related) return undefined;
  return clients.find((client) => {
    const name = normalize(client.name);
    return related === name || related.includes(name) || name.includes(related);
  });
}

function alreadyDiffused(client: Client, property: Property): boolean {
  return (client.propertyDiffusions ?? []).some((record) => (
    record.sendCount > 0
    && (
      record.propertyId === property.id
      || Boolean(property.uid && record.propertyUid === property.uid)
    )
  ));
}

function pushUnique(items: OperationalAttentionItem[], item: OperationalAttentionItem): void {
  if (!items.some((current) => current.key === item.key)) items.push(item);
}

function operationalSort(items: OperationalAttentionItem[]): OperationalAttentionItem[] {
  const priorityOrder: Record<OperationalPriority, number> = { 'CRÍTICO': 0, 'ALTO': 1, 'NORMAL': 2 };
  return items.slice().sort((left, right) => (
    priorityOrder[left.priority] - priorityOrder[right.priority]
    || left.rank - right.rank
    || left.name.localeCompare(right.name, 'es-AR')
    || left.key.localeCompare(right.key)
  ));
}

export function operationalAttentionQueue(
  input: OperationalAttentionInput,
  limit = 8,
): OperationalAttentionItem[] {
  const today = input.today ?? localIsoDate(input.now ?? new Date());
  const now = input.now ?? new Date();
  const activities = input.activityLog ?? [];
  const clients = input.clients.filter((client) => !isTerminalClient(client) && assignmentAllowed(input, client.assignedToId));
  const properties = input.properties.filter((property) => assignmentAllowed(input, property.assignedToId));
  const activeClientIds = new Set(clients.map((client) => client.id));
  const items: OperationalAttentionItem[] = [];

  for (const client of clients) {
    const stage = commercialStage(client);
    const followUpDays = leadDaysFromToday(client.nextFollowUp, today);
    const isNew = stage === 'Nuevo' && !client.lastContact;

    if (isNew) {
      pushUnique(items, {
        key: `new-uncontacted:${client.id}`,
        kind: 'new-uncontacted',
        priority: 'CRÍTICO',
        rank: 10,
        clientId: client.id,
        module: 'crm',
        target: 'lead',
        name: client.name,
        reason: 'Lead nuevo todavía no atendido',
        action: 'Contactar',
        when: relativeAge(leadCreatedAt(client, activities), now),
      });
    }

    if (followUpDays !== null && followUpDays < 0) {
      pushUnique(items, {
        key: `follow-up-overdue:${client.id}`,
        kind: 'follow-up-overdue',
        priority: 'CRÍTICO',
        rank: 5,
        clientId: client.id,
        module: 'crm',
        target: 'lead',
        name: client.name,
        reason: client.nextAction?.trim() || 'Seguimiento vencido',
        action: client.nextAction?.trim() || 'Hacer seguimiento',
        when: relativeDate(client.nextFollowUp, today),
      });
    }

    if (['Visita coordinada', 'Negociación', 'Reservado'].includes(stage) && (!client.nextAction?.trim() || !client.nextFollowUp)) {
      pushUnique(items, {
        key: `advanced-no-action:${client.id}`,
        kind: 'advanced-no-action',
        priority: 'ALTO',
        rank: 48,
        clientId: client.id,
        module: 'crm',
        target: 'lead',
        name: client.name,
        reason: `${stage} sin próxima acción completa`,
        action: 'Definir próximo paso',
        when: 'Ahora',
      });
    }

    if (!isNew && !(followUpDays !== null && followUpDays <= 0)) {
      const lastTouch = latestClientTouch(client, activities);
      const inactiveDays = dateAgeDays(lastTouch, now);
      const threshold = client.temperature === 'Caliente' ? 3 : 7;
      if (inactiveDays !== null && inactiveDays >= threshold) {
        pushUnique(items, {
          key: `forgotten-client:${client.id}`,
          kind: 'forgotten-client',
          priority: client.temperature === 'Caliente' ? 'ALTO' : 'NORMAL',
          rank: client.temperature === 'Caliente' ? 52 : 88,
          clientId: client.id,
          module: 'crm',
          target: 'lead',
          name: client.name,
          reason: `Sin contacto reciente hace ${inactiveDays} días`,
          action: 'Retomar contacto',
          when: `Hace ${inactiveDays} días`,
        });
      }
    }

    if (followUpDays !== null && followUpDays >= 0 && followUpDays <= 3) {
      pushUnique(items, {
        key: `next-follow-up:${client.id}`,
        kind: 'next-follow-up',
        priority: 'NORMAL',
        rank: 90 + followUpDays,
        clientId: client.id,
        module: 'crm',
        target: 'lead',
        name: client.name,
        reason: client.nextAction?.trim() || 'Próximo seguimiento programado',
        action: client.nextAction?.trim() || 'Hacer seguimiento',
        when: relativeDate(client.nextFollowUp, today),
      });
    }

    const freshMatch = matchPropertiesForClient(client, properties)
      .find((match) => (
        match.level === 'Alta'
        && !alreadyDiffused(client, match.property)
        && !matchDismissalActive(client, match.property, activities)
      ));
    if (freshMatch) {
      pushUnique(items, {
        key: `new-match:${client.id}:${freshMatch.property.id}`,
        kind: 'new-match',
        priority: 'ALTO',
        rank: 60 + (100 - freshMatch.score) / 100,
        clientId: client.id,
        propertyId: freshMatch.property.id,
        module: 'crm',
        target: 'matches',
        name: client.name,
        reason: `${freshMatch.score}% compatible · ${freshMatch.reasons.slice(0, 2).join(' · ')}`,
        action: 'Revisar match',
        when: 'Nuevo match',
      });
    }
  }

  for (const visit of input.visits) {
    if (!activeClientIds.has(visit.clientId) || !assignmentAllowed(input, visit.assignedToId)) continue;
    const scheduledDate = visitDate(visit);
    const scheduledMs = Date.parse(visit.scheduledAt);
    const name = clientName(clients, visit.clientId);
    const property = propertyLabel(properties, visit.propertyId);
    if (visit.status === 'Coordinada' && Number.isFinite(scheduledMs) && scheduledMs < now.getTime()) {
      pushUnique(items, {
        key: `visit-result:${visit.id}`,
        kind: 'visit-result',
        priority: 'CRÍTICO',
        rank: 12,
        clientId: visit.clientId,
        propertyId: visit.propertyId,
        sourceId: visit.id,
        module: 'crm',
        target: 'visits',
        name,
        reason: `Visita programada con ${property} sin resultado cargado`,
        action: 'Cargar resultado',
        when: relativeDate(scheduledDate, today),
      });
      continue;
    }
    const visitDays = leadDaysFromToday(scheduledDate, today);
    if (visit.status === 'Coordinada' && (visitDays === 0 || visitDays === 1)) {
      pushUnique(items, {
        key: `visit-confirm:${visit.id}`,
        kind: 'visit-confirm',
        priority: visitDays === 0 ? 'CRÍTICO' : 'ALTO',
        rank: visitDays === 0 ? 14 : 35,
        clientId: visit.clientId,
        propertyId: visit.propertyId,
        sourceId: visit.id,
        module: 'crm',
        target: 'visits',
        name,
        reason: `Visita ${visitDays === 0 ? 'de hoy' : 'de mañana'} · ${property}`,
        action: 'Confirmar visita',
        when: visitDays === 0 ? `Hoy ${visitTimeLabel(visit)}`.trim() : `Mañana ${visitTimeLabel(visit)}`.trim(),
      });
    }
    const client = clients.find((item) => item.id === visit.clientId);
    if (visit.status === 'Realizada' && (!visit.interest || !client?.nextAction?.trim() || !client.nextFollowUp)) {
      pushUnique(items, {
        key: `visit-result-incomplete:${visit.id}`,
        kind: 'visit-result',
        priority: 'ALTO',
        rank: 32,
        clientId: visit.clientId,
        propertyId: visit.propertyId,
        sourceId: visit.id,
        module: 'crm',
        target: 'visits',
        name,
        reason: 'Visita realizada sin resultado o próximo paso completo',
        action: 'Completar resultado',
        when: relativeAge(visit.updatedAt, now),
      });
    }
  }

  for (const offer of input.offers) {
    if (offer.status !== 'Pendiente' || !activeClientIds.has(offer.clientId) || !assignmentAllowed(input, offer.assignedToId)) continue;
    const name = clientName(clients, offer.clientId);
    const validDays = leadDaysFromToday(offer.validUntil, today);
    const staleDays = dateAgeDays(offer.updatedAt || offer.createdAt, now) ?? 0;
    if (validDays !== null && validDays <= 0) {
      pushUnique(items, {
        key: `offer-stalled:${offer.id}`,
        kind: 'offer-stalled',
        priority: 'CRÍTICO',
        rank: 18,
        clientId: offer.clientId,
        propertyId: offer.propertyId,
        sourceId: offer.id,
        module: 'crm',
        target: 'offers',
        name,
        reason: validDays < 0 ? 'Oferta vencida sin resolución' : 'Oferta vence hoy sin resolución',
        action: 'Hacer seguimiento',
        when: relativeDate(offer.validUntil, today),
      });
    } else if (staleDays >= 2 || validDays === 1) {
      pushUnique(items, {
        key: `offer-stalled:${offer.id}`,
        kind: 'offer-stalled',
        priority: 'ALTO',
        rank: 40,
        clientId: offer.clientId,
        propertyId: offer.propertyId,
        sourceId: offer.id,
        module: 'crm',
        target: 'offers',
        name,
        reason: `Oferta sin movimiento hace ${staleDays} días · espera respuesta del ${offer.origin === 'Cliente' ? 'propietario' : 'cliente'}`,
        action: 'Hacer seguimiento',
        when: staleDays === 1 ? 'Hace 1 día' : `Hace ${staleDays} días`,
      });
    }
  }

  for (const reservation of input.reservations) {
    if (reservation.status !== 'Activa' || !activeClientIds.has(reservation.clientId) || !assignmentAllowed(input, reservation.assignedToId)) continue;
    const name = clientName(clients, reservation.clientId);
    const expiryDays = leadDaysFromToday(reservation.expiresAt, today);
    const staleDays = dateAgeDays(reservation.updatedAt || reservation.createdAt, now) ?? 0;
    if ((expiryDays !== null && expiryDays <= 2) || staleDays >= 2) {
      const critical = expiryDays !== null && expiryDays <= 0;
      pushUnique(items, {
        key: `reservation-attention:${reservation.id}`,
        kind: 'reservation-attention',
        priority: critical ? 'CRÍTICO' : 'ALTO',
        rank: critical ? 16 : 44,
        clientId: reservation.clientId,
        propertyId: reservation.propertyId,
        sourceId: reservation.id,
        module: 'crm',
        target: 'reservations',
        name,
        reason: critical
          ? (expiryDays! < 0 ? 'Reserva vencida sin movimiento' : 'Reserva vence hoy')
          : expiryDays !== null ? `Reserva vence ${relativeDate(reservation.expiresAt, today).toLowerCase()}` : `Reserva sin movimiento hace ${staleDays} días`,
        action: 'Revisar reserva',
        when: reservation.expiresAt ? relativeDate(reservation.expiresAt, today) : relativeAge(reservation.updatedAt, now),
      });
    }
  }

  for (const client of clients) {
    const stage = commercialStage(client);
    const hasActiveReservation = input.reservations.some((reservation) => reservation.clientId === client.id && reservation.status === 'Activa');
    const hasAcceptedOffer = input.offers.some((offer) => offer.clientId === client.id && offer.status === 'Aceptada');
    if ((stage === 'Reservado' || (stage === 'Negociación' && hasAcceptedOffer)) && !items.some((item) => item.clientId === client.id && item.priority === 'CRÍTICO')) {
      pushUnique(items, {
        key: `close-intervention:${client.id}`,
        kind: 'close-intervention',
        priority: 'ALTO',
        rank: hasActiveReservation ? 50 : 54,
        clientId: client.id,
        module: 'crm',
        target: hasActiveReservation ? 'reservations' : 'offers',
        name: client.name,
        reason: hasActiveReservation ? 'Operación reservada cerca de cierre' : 'Oferta aceptada pendiente de cierre',
        action: hasActiveReservation ? 'Revisar cierre' : 'Formalizar reserva o cierre',
        when: client.nextFollowUp ? relativeDate(client.nextFollowUp, today) : 'Ahora',
      });
    }
  }

  for (const reminder of input.reminders) {
    const completedAt = (reminder as Reminder & { completedAt?: string }).completedAt;
    if (completedAt || !assignmentAllowed(input, reminder.assignedToId)) continue;
    const days = leadDaysFromToday(reminder.date, today);
    if (days === null || days >= 0) continue;
    const client = reminderClient(reminder, clients);
    pushUnique(items, {
      key: `task-overdue:${reminder.id}`,
      kind: 'task-overdue',
      priority: reminder.priority === 'Alta' ? 'CRÍTICO' : 'ALTO',
      rank: reminder.priority === 'Alta' ? 22 : 46,
      ...(client ? { clientId: client.id } : {}),
      sourceId: reminder.id,
      module: 'agenda',
      target: 'agenda',
      name: client?.name || reminder.related || reminder.title,
      reason: reminder.title,
      action: 'Resolver tarea',
      when: relativeDate(reminder.date, today),
    });
  }

  const sorted = operationalSort(items);
  const perClient = new Map<number, number>();
  const capped = Math.max(0, Math.trunc(limit));
  const result: OperationalAttentionItem[] = [];
  for (const item of sorted) {
    if (item.clientId) {
      const count = perClient.get(item.clientId) ?? 0;
      if (count >= 2) continue;
      perClient.set(item.clientId, count + 1);
    }
    result.push(item);
    if (result.length >= capped) break;
  }
  return result;
}

export function renderOperationalAttentionQueue(
  input: OperationalAttentionInput,
  limit = 8,
): string {
  const items = operationalAttentionQueue(input, limit);
  const counts = {
    critical: items.filter((item) => item.priority === 'CRÍTICO').length,
    high: items.filter((item) => item.priority === 'ALTO').length,
    normal: items.filter((item) => item.priority === 'NORMAL').length,
  };
  const body = items.length
    ? `<div class="pc-daily-ops-list">${items.map((item) => `<button type="button" class="pc-supervised-attention-item pc-daily-ops-item priority-${item.priority.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')}" data-operational-action="${escapeHtml(item.kind)}"${item.clientId ? ` data-attention-client-id="${item.clientId}"` : ''} data-attention-module="${item.module}" data-attention-target="${item.target}"${item.propertyId ? ` data-attention-property-id="${item.propertyId}"` : ''} aria-label="${escapeHtml(item.clientId ? `Abrir ficha completa de ${item.name}` : `Abrir acción ${item.action}: ${item.name}`)}">
      <span class="pc-daily-ops-priority">${escapeHtml(item.priority)}</span>
      <strong class="pc-supervised-attention-name">${escapeHtml(item.name)}</strong>
      <span class="pc-supervised-attention-reason">${escapeHtml(item.reason)}</span>
      <span class="pc-daily-ops-when">${escapeHtml(item.when)}</span>
      <span class="pc-supervised-attention-action"><b aria-hidden="true">→</b> ${escapeHtml(item.action)}</span>
    </button>`).join('')}</div>`
    : '<p class="pc-supervised-attention-empty">No hay acciones operativas urgentes. Revisá los próximos seguimientos en Agenda.</p>';
  const summary = [
    counts.critical > 0 ? `<b>${counts.critical} críticos</b>` : '',
    counts.high > 0 ? `<span>${counts.high} altos</span>` : '',
    counts.normal > 0 ? `<span>${counts.normal} normales</span>` : '',
  ].filter(Boolean).join('');

  return `<section class="pc-supervised-attention-queue pc-daily-ops-queue" data-supervised-attention-queue data-operational-attention-queue aria-labelledby="pc-daily-ops-title">
    <header class="pc-daily-ops-heading">
      <div><strong id="pc-daily-ops-title">QUÉ HACER AHORA</strong><span>Prioridad explicable a partir de actividad, fechas y estado comercial.</span></div>
      ${summary ? `<div class="pc-daily-ops-summary" aria-label="Resumen de prioridades">${summary}</div>` : ''}
    </header>
    ${body}
    <p class="pc-supervised-attention-status" data-attention-navigation-status role="status" aria-live="polite" hidden></p>
  </section>`;
}
