import { leadCardAttentionPresentation } from './lead-card-attention.js';
import { leadDaysFromToday, leadPrimaryAlert, sortLeads, type LeadAlertKind } from './lead-list-priority.js';
import { commercialStage, isTerminalClient, localIsoDate } from './lead-pipeline.js';
import { activeCommercialAlerts, evaluateCommercialAlertConditions, type CommercialAlertCondition } from './commercial-alert-engine.js';
import { matchDismissalActive, matchPropertiesForClient } from './property-matching.js';
import { assignmentVisible } from './team-policy.js';
import type { ActivityEntry, Client, CommercialAlert, Offer, Property, Reminder, Reservation, TeamRole, Visit } from './models.js';
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
  organizationId?: string;
  commercialAlerts?: CommercialAlert[];
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

function assignmentAllowed(input: OperationalAttentionInput, assignedToId: number | undefined): boolean {
  return !input.actor || assignmentVisible(input.actor.role, input.actor.id, assignedToId);
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

const ALERT_KIND: Record<CommercialAlertCondition['type'], OperationalActionKind> = {
  NEW_LEAD_UNATTENDED: 'new-uncontacted',
  FOLLOW_UP_OVERDUE: 'follow-up-overdue',
  FORGOTTEN_LEAD: 'forgotten-client',
  VISIT_UNCONFIRMED: 'visit-confirm',
  VISIT_RESULT_MISSING: 'visit-result',
  OFFER_STALLED: 'offer-stalled',
  RESERVATION_STALLED: 'reservation-attention',
  ADVANCED_NO_NEXT_ACTION: 'advanced-no-action',
  NEW_RELEVANT_MATCH: 'new-match',
  TASK_OVERDUE: 'task-overdue',
};

function alertConditionToOperational(condition: CommercialAlertCondition): OperationalAttentionItem {
  return {
    key: condition.dedupeKey,
    kind: ALERT_KIND[condition.type],
    priority: condition.priority,
    rank: condition.rank,
    ...(condition.clientId ? { clientId: condition.clientId } : {}),
    ...(condition.propertyId ? { propertyId: condition.propertyId } : {}),
    ...(condition.sourceId ? { sourceId: condition.sourceId } : {}),
    module: condition.target === 'agenda' ? 'agenda' : 'crm',
    target: condition.target,
    name: condition.name,
    reason: condition.reason,
    action: condition.action,
    when: condition.when,
  };
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

function hasClientAction(
  items: readonly OperationalAttentionItem[],
  clientId: number,
  kinds: readonly OperationalActionKind[],
): boolean {
  return items.some((item) => item.clientId === clientId && kinds.includes(item.kind));
}

const SPECIFIC_FOLLOW_UP_BLOCKERS: readonly OperationalActionKind[] = [
  'follow-up-overdue',
  'visit-confirm',
  'visit-result',
  'offer-stalled',
  'reservation-attention',
  'advanced-no-action',
];

const SPECIFIC_CLOSE_BLOCKERS: readonly OperationalActionKind[] = [
  'offer-stalled',
  'reservation-attention',
  'advanced-no-action',
];

export function operationalAttentionQueue(
  input: OperationalAttentionInput,
  limit = 8,
): OperationalAttentionItem[] {
  const today = input.today ?? localIsoDate(input.now ?? new Date());
  const clients = input.clients.filter((client) => !isTerminalClient(client) && assignmentAllowed(input, client.assignedToId));
  const alertSource = input.commercialAlerts !== undefined
    ? activeCommercialAlerts(input.commercialAlerts)
    : evaluateCommercialAlertConditions({
        organizationId: input.organizationId || 'local',
        clients: input.clients,
        properties: input.properties,
        visits: input.visits,
        offers: input.offers,
        reservations: input.reservations,
        reminders: input.reminders,
        activityLog: input.activityLog,
        actor: input.actor,
        today,
        now: input.now,
      });
  const items = alertSource.map(alertConditionToOperational);

  // 2G conserva sus recordatorios proactivos; no son alertas 2H.
  for (const client of clients) {
    const followUpDays = leadDaysFromToday(client.nextFollowUp, today);
    if (
      followUpDays !== null
      && followUpDays >= 0
      && followUpDays <= 3
      && !hasClientAction(items, client.id, SPECIFIC_FOLLOW_UP_BLOCKERS)
    ) {
      pushUnique(items, {
        key: `next-follow-up:${client.id}:${client.nextFollowUp || ''}`,
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

    const stage = commercialStage(client);
    const hasActiveReservation = input.reservations.some((reservation) => (
      reservation.clientId === client.id
      && reservation.status === 'Activa'
      && assignmentAllowed(input, reservation.assignedToId)
    ));
    const hasAcceptedOffer = input.offers.some((offer) => (
      offer.clientId === client.id
      && offer.status === 'Aceptada'
      && assignmentAllowed(input, offer.assignedToId)
    ));
    if (
      (stage === 'Reservado' || (stage === 'Negociación' && hasAcceptedOffer))
      && !items.some((item) => item.clientId === client.id && item.priority === 'CRÍTICO')
      && !hasClientAction(items, client.id, SPECIFIC_CLOSE_BLOCKERS)
    ) {
      pushUnique(items, {
        key: `close-intervention:${client.id}:${stage}`,
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
    ? `<div class="pc-daily-ops-list">${items.map((item) => `<button type="button" class="pc-supervised-attention-item pc-daily-ops-item priority-${item.priority.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')}" data-operational-action="${escapeHtml(item.kind)}"${item.clientId ? ` data-attention-client-id="${item.clientId}"` : ''} data-attention-module="${item.module}" data-attention-target="${item.target}"${item.propertyId ? ` data-attention-property-id="${item.propertyId}"` : ''}${item.sourceId ? ` data-attention-source-id="${item.sourceId}"` : ''} aria-label="${escapeHtml(item.clientId ? `Abrir ficha completa de ${item.name}` : `Abrir acción ${item.action}: ${item.name}`)}">
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
