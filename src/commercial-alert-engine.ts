import { leadDaysFromToday } from './lead-list-priority.js';
import { commercialStage, isTerminalClient, localIsoDate } from './lead-pipeline.js';
import { matchDismissalActive, matchPropertiesForClient, propertyMatchCriteriaKey } from './property-matching.js';
import { assignmentVisible } from './team-policy.js';
import type {
  ActivityEntry,
  Client,
  CommercialAlert,
  CommercialAlertPriority,
  CommercialAlertState,
  CommercialAlertTarget,
  CommercialAlertType,
  Offer,
  Property,
  Reminder,
  Reservation,
  TeamRole,
  Visit,
} from './models.js';

export const VISIT_CONFIRMED_ACTION = 'Visita confirmada';

/**
 * Umbrales heredados de la capa operativa aprobada en 2G.
 * 2H los nombra como reglas de dominio para que sean visibles, testeables y
 * modificables sin esconder números dentro de un score.
 */
export const COMMERCIAL_ALERT_THRESHOLDS = {
  forgottenHotDays: 3,
  forgottenStandardDays: 7,
  stalledOfferDays: 2,
  stalledReservationDays: 2,
  visitConfirmationWindowDays: 1,
  reservationExpiryWindowDays: 2,
} as const;

const DAY_MS = 86_400_000;
const PRIORITY_ORDER: Record<CommercialAlertPriority, number> = {
  'CRÍTICO': 0,
  'ALTO': 1,
  'NORMAL': 2,
};

export interface CommercialAlertCondition {
  organizationId: string;
  type: CommercialAlertType;
  entityType: CommercialAlert['entityType'];
  entityId: number;
  ownerId?: number;
  priority: CommercialAlertPriority;
  rank: number;
  reason: string;
  action: string;
  actionType: CommercialAlert['actionType'];
  target: CommercialAlertTarget;
  name: string;
  when: string;
  conditionVersion: string;
  dedupeKey: string;
  dueAt?: string;
  clientId?: number;
  propertyId?: number;
  sourceId?: number;
}

export interface CommercialAlertEvaluationInput {
  organizationId: string;
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
  precomputedMatchConditions?: readonly CommercialAlertCondition[];
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function stablePart(value: unknown): string {
  return encodeURIComponent(String(value ?? '').trim());
}

export function commercialAlertDedupeKey(input: Pick<
  CommercialAlertCondition,
  'organizationId' | 'type' | 'entityType' | 'entityId' | 'conditionVersion'
>): string {
  return [
    stablePart(input.organizationId),
    stablePart(input.type),
    stablePart(input.entityType),
    stablePart(input.entityId),
    stablePart(input.conditionVersion),
  ].join('|');
}

function pushCondition(
  conditions: CommercialAlertCondition[],
  value: Omit<CommercialAlertCondition, 'dedupeKey'>,
): void {
  const condition: CommercialAlertCondition = {
    ...value,
    dedupeKey: commercialAlertDedupeKey(value),
  };
  if (!conditions.some((item) => item.dedupeKey === condition.dedupeKey)) {
    conditions.push(condition);
  }
}

function assignmentAllowed(input: CommercialAlertEvaluationInput, assignedToId: number | undefined): boolean {
  return !input.actor || assignmentVisible(input.actor.role, input.actor.id, assignedToId);
}

function validTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? stamp : null;
}

function ageDays(value: string | undefined, now: Date): number | null {
  const stamp = validTimestamp(value);
  if (stamp === null) return null;
  return Math.max(0, Math.floor((now.getTime() - stamp) / DAY_MS));
}

function clientActivities(client: Client, activities: readonly ActivityEntry[]): ActivityEntry[] {
  return activities.filter((entry) => entry.entityType === 'Cliente' && entry.entityId === client.id);
}

function isSchedulingOnlyActivity(entry: ActivityEntry): boolean {
  return /seguimiento.*programado|pr[oó]xima acci[oó]n programada/i.test(entry.action);
}

function latestTimestamp(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => validTimestamp(value) !== null)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function leadCreatedAt(client: Client, activities: readonly ActivityEntry[]): string | undefined {
  return clientActivities(client, activities)
    .filter((entry) => entry.action === 'Lead creado')
    .map((entry) => entry.createdAt)
    .filter((value) => validTimestamp(value) !== null)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
}

function latestCommercialTouch(client: Client, activities: readonly ActivityEntry[]): string | undefined {
  return latestTimestamp([
    client.lastContact,
    client.qualificationUpdatedAt,
    ...clientActivities(client, activities)
      .filter((entry) => !isSchedulingOnlyActivity(entry))
      .map((entry) => entry.createdAt),
  ]);
}

function validCommercialAttention(client: Client, activities: readonly ActivityEntry[]): boolean {
  if (client.lastContact) return true;
  return clientActivities(client, activities).some((entry) => (
    !isSchedulingOnlyActivity(entry)
    && /contacto|llamada|mensaje|whatsapp|email|visita|oferta|reserva/i.test(entry.action)
  ));
}

function relativeAge(value: string | undefined, now: Date): string {
  const stamp = validTimestamp(value);
  if (stamp === null) return 'Atender ahora';
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

function visitTime(visit: Visit): string {
  const date = new Date(visit.scheduledAt);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function clientName(clients: readonly Client[], id: number): string {
  return clients.find((client) => client.id === id)?.name || `Cliente #${id}`;
}

function propertyLabel(properties: readonly Property[], id: number): string {
  const property = properties.find((item) => item.id === id);
  return property?.title?.trim() || property?.address?.trim() || `Propiedad #${id}`;
}

function reminderClient(reminder: Reminder, clients: readonly Client[]): Client | undefined {
  const related = normalize(reminder.related);
  if (!related) return undefined;
  return clients.find((client) => {
    const name = normalize(client.name);
    return related === name || related.includes(name) || name.includes(related);
  });
}

function reminderMirrorsFollowUp(reminder: Reminder, client: Client | undefined): boolean {
  if (!client || !client.nextFollowUp || client.nextFollowUp !== reminder.date) return false;
  const action = normalize(client.nextAction);
  const title = normalize(reminder.title);
  return Boolean(action && title && (action === title || action.includes(title) || title.includes(action)));
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

function commercialEntityRelationMatches(
  entry: ActivityEntry,
  entityType: 'offer' | 'reservation',
  entityId: number,
  entityUid?: string,
): boolean {
  if (entry.commercialEntityType !== entityType) return false;
  if (entityUid && entry.commercialEntityUid) return entry.commercialEntityUid === entityUid;
  return entry.commercialEntityId === entityId;
}

function movementActivity(
  entityType: 'offer' | 'reservation',
  entityId: number,
  entityUid: string | undefined,
  activities: readonly ActivityEntry[],
): string | undefined {
  return activities
    .filter((entry) => commercialEntityRelationMatches(entry, entityType, entityId, entityUid))
    .map((entry) => entry.createdAt)
    .filter((value) => validTimestamp(value) !== null)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function offerMovementAt(offer: Offer, activities: readonly ActivityEntry[]): string {
  const synced = offer as Offer & { uid?: string };
  return latestTimestamp([
    offer.updatedAt,
    offer.createdAt,
    movementActivity('offer', offer.id, synced.uid, activities),
  ]) ?? offer.updatedAt ?? offer.createdAt;
}

function reservationMovementAt(reservation: Reservation, activities: readonly ActivityEntry[]): string {
  const synced = reservation as Reservation & { uid?: string };
  return latestTimestamp([
    reservation.updatedAt,
    reservation.createdAt,
    movementActivity('reservation', reservation.id, synced.uid, activities),
  ]) ?? reservation.updatedAt ?? reservation.createdAt;
}

function confirmationDetailMatches(visit: Visit, detail: string): boolean {
  const syncedVisit = visit as Visit & { uid?: string };
  const scheduled = detail.match(/(?:^|\n)scheduledAt=(.*?)(?:\n|$)/)?.[1]?.trim();
  if (scheduled !== visit.scheduledAt) return false;
  const visitUid = detail.match(/(?:^|\n)visitUid=(.*?)(?:\n|$)/)?.[1]?.trim();
  if (syncedVisit.uid && visitUid) return visitUid === syncedVisit.uid;
  const visitId = Number(detail.match(/(?:^|\n)visitId=(\d+)(?:\n|$)/)?.[1]);
  return Number.isFinite(visitId) && visitId === visit.id;
}

function confirmationRelationMatches(visit: Visit, entry: ActivityEntry): boolean {
  if (entry.commercialEntityType !== 'visit') return false;
  const syncedVisit = visit as Visit & { uid?: string };
  if (syncedVisit.uid && entry.commercialEntityUid) return entry.commercialEntityUid === syncedVisit.uid;
  return entry.commercialEntityId === visit.id;
}

export function visitConfirmationActive(
  visit: Visit,
  activities: readonly ActivityEntry[],
): boolean {
  return activities.some((entry) => (
    entry.action === VISIT_CONFIRMED_ACTION
    && entry.entityType === 'Cliente'
    && entry.entityId === visit.clientId
    && (confirmationRelationMatches(visit, entry) || confirmationDetailMatches(visit, entry.detail))
  ));
}

export function visitConfirmationDetail(visit: Visit): string {
  const syncedVisit = visit as Visit & { uid?: string };
  return [
    `visitId=${visit.id}`,
    syncedVisit.uid ? `visitUid=${syncedVisit.uid}` : '',
    `scheduledAt=${visit.scheduledAt}`,
  ].filter(Boolean).join('\n');
}

function visitResultAction(visit: Visit): string {
  if (visit.status === 'Realizada') return 'Visita realizada';
  if (visit.status === 'Cancelada') return 'Visita cancelada';
  if (visit.status === 'No asistió') return 'Cliente no asistió';
  return '';
}

function visitRelationMatches(visit: Visit, entry: ActivityEntry): boolean {
  if (entry.entityType !== 'Cliente' || entry.entityId !== visit.clientId) return false;
  const syncedVisit = visit as Visit & { uid?: string };
  if (entry.commercialEntityType === 'visit') {
    if (syncedVisit.uid && entry.commercialEntityUid) return entry.commercialEntityUid === syncedVisit.uid;
    return entry.commercialEntityId === visit.id;
  }
  const transaction = entry as ActivityEntry & { visitUid?: string; transactionOwner?: string };
  return Boolean(
    syncedVisit.uid
    && transaction.transactionOwner === 'visit'
    && transaction.visitUid === syncedVisit.uid
  );
}

export function visitResultActivityAt(
  visit: Visit,
  activities: readonly ActivityEntry[],
): string | undefined {
  const action = visitResultAction(visit);
  if (!action) return undefined;
  const exact = activities
    .filter((entry) => entry.action === action && visitRelationMatches(visit, entry))
    .map((entry) => entry.createdAt)
    .filter((value) => validTimestamp(value) !== null)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  if (exact) return exact;

  // Legacy fallback: historical visit writes used the same result timestamp but
  // did not persist the visit identity on Activity. Only a tightly coupled event
  // around visit.updatedAt is accepted; arbitrary later WhatsApp/calls never count.
  const updatedAt = validTimestamp(visit.updatedAt);
  if (updatedAt === null) return undefined;
  return activities
    .filter((entry) => {
      if (entry.action !== action || entry.entityType !== 'Cliente' || entry.entityId !== visit.clientId) return false;
      const createdAt = validTimestamp(entry.createdAt);
      if (createdAt === null) return false;
      const delta = createdAt - updatedAt;
      return delta >= -1_000 && delta <= 5 * 60_000;
    })
    .map((entry) => entry.createdAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

export function hasValidCommercialCommitment(client: Client, today: string): boolean {
  return Boolean(
    client.nextAction?.trim()
    && leadDaysFromToday(client.nextFollowUp, today) !== null
  );
}

function sameActivityIdentity(left: ActivityEntry, right: ActivityEntry): boolean {
  if (left.uid && right.uid) return left.uid === right.uid;
  return left.id === right.id
    && left.actorId === right.actorId
    && left.action === right.action
    && left.entityType === right.entityType
    && left.entityId === right.entityId
    && left.createdAt === right.createdAt
    && left.detail === right.detail;
}

/**
 * Revierte únicamente la actividad creada por "Confirmar visita".
 * No restaura un snapshot completo: así una falla cloud no puede borrar
 * mutaciones locales posteriores realizadas mientras el request estaba en vuelo.
 */
export function withoutVisitConfirmationActivity(
  activities: readonly ActivityEntry[],
  confirmation: ActivityEntry,
): ActivityEntry[] {
  if (confirmation.action !== VISIT_CONFIRMED_ACTION) return activities.slice();
  let removed = false;
  return activities.filter((entry) => {
    if (removed || !sameActivityIdentity(entry, confirmation)) return true;
    removed = true;
    return false;
  });
}

function clientMatchCriteriaVersion(client: Client): string {
  return [
    client.qualificationUpdatedAt || '',
    client.pipeline || '',
    client.status || '',
    client.temperature || '',
    client.interest || '',
    client.zones || '',
    client.propertyType || '',
    client.operation || '',
    client.bedrooms ?? '',
    client.currency || '',
    client.budget || '',
    client.paymentMethod || '',
    client.needsFinancing || '',
    client.creditPossible || '',
    client.creditApprovedAmount || '',
    client.purchaseTimeframe || '',
    client.purpose || '',
    client.knowsArea || '',
    client.canMoveForward || '',
    client.objections || '',
    client.urgency || '',
    client.garage || '',
    client.patio || '',
    client.pool || '',
    client.requiresCreditReady || '',
    client.features || '',
    client.preferences || '',
  ].map(normalize).join('~');
}

function matchVersion(client: Client, property: Property): string {
  return [
    property.uid || property.id,
    Number(property.revision ?? 0),
    clientMatchCriteriaVersion(client),
  ].join(':');
}

function advancedVersion(client: Client, activities: readonly ActivityEntry[]): string {
  return [
    commercialStage(client),
    Number(client.revision ?? 0),
    latestCommercialTouch(client, activities) || '',
  ].join(':');
}

function conditionSort(left: CommercialAlertCondition, right: CommercialAlertCondition): number {
  return PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
    || left.rank - right.rank
    || left.name.localeCompare(right.name, 'es-AR')
    || left.dedupeKey.localeCompare(right.dedupeKey);
}

export function evaluateRelevantMatchAlertConditions(
  input: Pick<
    CommercialAlertEvaluationInput,
    'organizationId' | 'clients' | 'properties' | 'activityLog' | 'actor'
  >,
): CommercialAlertCondition[] {
  const activities = input.activityLog ?? [];
  const clients = input.clients.filter((client) => (
    !isTerminalClient(client) && assignmentAllowed(input as CommercialAlertEvaluationInput, client.assignedToId)
  ));
  const properties = input.properties.filter((property) => (
    assignmentAllowed(input as CommercialAlertEvaluationInput, property.assignedToId)
  ));
  const conditions: CommercialAlertCondition[] = [];
  const byCriteria = new Map<string, Client[]>();
  for (const client of clients) {
    const key = propertyMatchCriteriaKey(client);
    const group = byCriteria.get(key) ?? [];
    group.push(client);
    byCriteria.set(key, group);
  }

  for (const group of byCriteria.values()) {
    const representative = group[0];
    if (!representative) continue;
    const highMatches = matchPropertiesForClient(representative, properties)
      .filter((match) => match.level === 'Alta');
    if (!highMatches.length) continue;

    for (const client of group) {
      const freshMatch = highMatches.find((match) => (
        !alreadyDiffused(client, match.property)
        && !matchDismissalActive(client, match.property, activities)
      ));
      if (!freshMatch) continue;
      pushCondition(conditions, {
        organizationId: input.organizationId,
        type: 'NEW_RELEVANT_MATCH',
        entityType: 'match',
        entityId: client.id,
        ownerId: client.assignedToId,
        priority: 'NORMAL',
        rank: 92 - freshMatch.score / 100,
        reason: `${freshMatch.score}% compatible · ${freshMatch.reasons.slice(0, 2).join(' · ')}`,
        action: 'Ver oportunidad',
        actionType: 'REVIEW_MATCH',
        target: 'matches',
        name: client.name,
        when: 'Nuevo match',
        conditionVersion: matchVersion(client, freshMatch.property),
        clientId: client.id,
        propertyId: freshMatch.property.id,
        sourceId: freshMatch.property.id,
      });
    }
  }

  return conditions.sort(conditionSort);
}

function taskMirrorsSpecificAlert(
  task: CommercialAlertCondition,
  specific: CommercialAlertCondition,
): boolean {
  if (task.type !== 'TASK_OVERDUE' || !task.clientId || task.clientId !== specific.clientId) return false;
  const title = normalize(task.reason);
  if (!title) return false;
  const action = normalize(specific.action);
  if (action && (title === action || title.includes(action) || action.includes(title))) return true;
  if (specific.type === 'VISIT_UNCONFIRMED') return title.includes('visita') && title.includes('confirm');
  if (specific.type === 'VISIT_RESULT_MISSING') return title.includes('visita') && (title.includes('resultado') || title.includes('cargar'));
  if (specific.type === 'OFFER_STALLED') return title.includes('oferta') && (title.includes('retomar') || title.includes('revisar'));
  if (specific.type === 'RESERVATION_STALLED') return title.includes('reserva') && (title.includes('revisar') || title.includes('retomar'));
  return false;
}

function deduplicateCommercialConditions(
  conditions: readonly CommercialAlertCondition[],
): CommercialAlertCondition[] {
  const byClient = new Map<number, CommercialAlertCondition[]>();
  for (const condition of conditions) {
    if (!condition.clientId) continue;
    const siblings = byClient.get(condition.clientId) ?? [];
    siblings.push(condition);
    byClient.set(condition.clientId, siblings);
  }

  const dominantTypes = new Set<CommercialAlertType>([
    'FOLLOW_UP_OVERDUE',
    'VISIT_UNCONFIRMED',
    'VISIT_RESULT_MISSING',
    'OFFER_STALLED',
    'RESERVATION_STALLED',
  ]);
  const taskDominantTypes = new Set<CommercialAlertType>([
    'VISIT_UNCONFIRMED',
    'VISIT_RESULT_MISSING',
    'OFFER_STALLED',
    'RESERVATION_STALLED',
  ]);

  return conditions.filter((condition) => {
    if (!condition.clientId) return true;
    const siblings = byClient.get(condition.clientId) ?? [];

    if (condition.type === 'FORGOTTEN_LEAD' || condition.type === 'ADVANCED_NO_NEXT_ACTION') {
      return !siblings.some((candidate) => candidate !== condition && dominantTypes.has(candidate.type));
    }

    if (condition.type === 'TASK_OVERDUE') {
      return !siblings.some((candidate) => (
        candidate !== condition
        && taskDominantTypes.has(candidate.type)
        && taskMirrorsSpecificAlert(condition, candidate)
      ));
    }

    return true;
  }).sort(conditionSort);
}

export function evaluateCommercialAlertConditions(
  input: CommercialAlertEvaluationInput,
): CommercialAlertCondition[] {
  const today = input.today ?? localIsoDate(input.now ?? new Date());
  const now = input.now ?? new Date();
  const activities = input.activityLog ?? [];
  const clients = input.clients.filter((client) => (
    !isTerminalClient(client) && assignmentAllowed(input, client.assignedToId)
  ));
  const properties = input.properties.filter((property) => assignmentAllowed(input, property.assignedToId));
  const activeClientIds = new Set(clients.map((client) => client.id));
  const conditions: CommercialAlertCondition[] = [];

  for (const client of clients) {
    const stage = commercialStage(client);
    const followUpDays = leadDaysFromToday(client.nextFollowUp, today);
    const createdAt = leadCreatedAt(client, activities);
    const isNewUnattended = stage === 'Nuevo' && !validCommercialAttention(client, activities);

    if (isNewUnattended) {
      pushCondition(conditions, {
        organizationId: input.organizationId,
        type: 'NEW_LEAD_UNATTENDED',
        entityType: 'client',
        entityId: client.id,
        ownerId: client.assignedToId,
        priority: 'CRÍTICO',
        rank: 10,
        reason: 'Lead nuevo todavía no atendido',
        action: 'Atender ahora',
        actionType: 'CONTACT_LEAD',
        target: 'lead',
        name: client.name,
        when: relativeAge(createdAt, now),
        conditionVersion: createdAt || client.uid || String(client.id),
        clientId: client.id,
        sourceId: client.id,
      });
    }

    if (followUpDays !== null && followUpDays < 0) {
      pushCondition(conditions, {
        organizationId: input.organizationId,
        type: 'FOLLOW_UP_OVERDUE',
        entityType: 'client',
        entityId: client.id,
        ownerId: client.assignedToId,
        priority: 'ALTO',
        rank: 24,
        reason: client.nextAction?.trim() || 'Seguimiento vencido',
        action: 'Hacer seguimiento',
        actionType: 'REPROGRAM_FOLLOW_UP',
        target: 'lead',
        name: client.name,
        when: relativeDate(client.nextFollowUp, today),
        conditionVersion: `${client.nextFollowUp || ''}:${normalize(client.nextAction)}`,
        dueAt: client.nextFollowUp,
        clientId: client.id,
        sourceId: client.id,
      });
    }

    const hasValidCommitment = hasValidCommercialCommitment(client, today);
    if (
      !isNewUnattended
      && !hasValidCommitment
      && !(followUpDays !== null && followUpDays < 0)
    ) {
      const lastTouch = latestCommercialTouch(client, activities) || createdAt;
      const inactiveDays = ageDays(lastTouch, now);
      const threshold = client.temperature === 'Caliente'
        ? COMMERCIAL_ALERT_THRESHOLDS.forgottenHotDays
        : COMMERCIAL_ALERT_THRESHOLDS.forgottenStandardDays;
      if (inactiveDays !== null && inactiveDays >= threshold) {
        pushCondition(conditions, {
          organizationId: input.organizationId,
          type: 'FORGOTTEN_LEAD',
          entityType: 'client',
          entityId: client.id,
          ownerId: client.assignedToId,
          priority: client.temperature === 'Caliente' ? 'ALTO' : 'NORMAL',
          rank: client.temperature === 'Caliente' ? 54 : 88,
          reason: `Sin movimiento comercial hace ${inactiveDays} días`,
          action: 'Retomar contacto',
          actionType: 'RESUME_CONTACT',
          target: 'lead',
          name: client.name,
          when: `Hace ${inactiveDays} días`,
          conditionVersion: lastTouch || client.uid || String(client.id),
          clientId: client.id,
          sourceId: client.id,
        });
      }
    }

  }

  const matchConditions = input.precomputedMatchConditions ?? evaluateRelevantMatchAlertConditions(input);
  for (const matchCondition of matchConditions) {
    if (matchCondition.organizationId !== input.organizationId || matchCondition.type !== 'NEW_RELEVANT_MATCH') continue;
    if (!conditions.some((condition) => condition.dedupeKey === matchCondition.dedupeKey)) {
      conditions.push({ ...matchCondition });
    }
  }

  for (const visit of input.visits) {
    if (!activeClientIds.has(visit.clientId) || !assignmentAllowed(input, visit.assignedToId)) continue;
    const scheduledMs = validTimestamp(visit.scheduledAt);
    const scheduledDate = visitDate(visit);
    const name = clientName(clients, visit.clientId);
    const property = propertyLabel(properties, visit.propertyId);
    const visitDays = leadDaysFromToday(scheduledDate, today);

    if (visit.status === 'Coordinada' && scheduledMs !== null && scheduledMs < now.getTime()) {
      pushCondition(conditions, {
        organizationId: input.organizationId,
        type: 'VISIT_RESULT_MISSING',
        entityType: 'visit',
        entityId: visit.id,
        ownerId: visit.assignedToId,
        priority: 'ALTO',
        rank: 28,
        reason: `Visita con ${property} ya ocurrió y falta cargar el resultado`,
        action: 'Cargar resultado',
        actionType: 'LOAD_VISIT_RESULT',
        target: 'visits',
        name,
        when: relativeDate(scheduledDate, today),
        conditionVersion: visit.scheduledAt,
        dueAt: visit.scheduledAt,
        clientId: visit.clientId,
        propertyId: visit.propertyId,
        sourceId: visit.id,
      });
      continue;
    }

    const visitedClient = clients.find((client) => client.id === visit.clientId);
    const resultActivityAt = visit.status === 'Realizada'
      ? visitResultActivityAt(visit, activities)
      : undefined;
    if (
      visit.status === 'Realizada'
      && (
        !visit.interest
        || !resultActivityAt
        || !visitedClient
        || !hasValidCommercialCommitment(visitedClient, today)
      )
    ) {
      pushCondition(conditions, {
        organizationId: input.organizationId,
        type: 'VISIT_RESULT_MISSING',
        entityType: 'visit',
        entityId: visit.id,
        ownerId: visit.assignedToId,
        priority: 'ALTO',
        rank: 30,
        reason: !resultActivityAt
          ? 'Visita realizada sin evidencia causal de resultado y próximo paso'
          : 'Visita realizada con resultado o próximo paso incompleto',
        action: 'Completar resultado',
        actionType: 'LOAD_VISIT_RESULT',
        target: 'visits',
        name,
        when: relativeAge(visit.updatedAt, now),
        conditionVersion: `${visit.updatedAt}:${visit.interest || ''}:${resultActivityAt || ''}:${visitedClient?.nextAction || ''}:${visitedClient?.nextFollowUp || ''}`,
        dueAt: visit.scheduledAt,
        clientId: visit.clientId,
        propertyId: visit.propertyId,
        sourceId: visit.id,
      });
      continue;
    }

    if (
      visit.status === 'Coordinada'
      && visitDays !== null
      && visitDays >= 0
      && visitDays <= COMMERCIAL_ALERT_THRESHOLDS.visitConfirmationWindowDays
      && !visitConfirmationActive(visit, activities)
    ) {
      pushCondition(conditions, {
        organizationId: input.organizationId,
        type: 'VISIT_UNCONFIRMED',
        entityType: 'visit',
        entityId: visit.id,
        ownerId: visit.assignedToId,
        priority: visitDays === 0 ? 'CRÍTICO' : 'ALTO',
        rank: visitDays === 0 ? 12 : 32,
        reason: `Visita ${visitDays === 0 ? 'de hoy' : 'de mañana'} con ${property} sin confirmar`,
        action: 'Confirmar visita',
        actionType: 'CONFIRM_VISIT',
        target: 'visits',
        name,
        when: visitDays === 0 ? `Hoy ${visitTime(visit)}`.trim() : `Mañana ${visitTime(visit)}`.trim(),
        conditionVersion: visit.scheduledAt,
        dueAt: visit.scheduledAt,
        clientId: visit.clientId,
        propertyId: visit.propertyId,
        sourceId: visit.id,
      });
    }
  }

  for (const offer of input.offers) {
    if (
      offer.status !== 'Pendiente'
      || !activeClientIds.has(offer.clientId)
      || !assignmentAllowed(input, offer.assignedToId)
    ) continue;
    const movementAt = offerMovementAt(offer, activities);
    const staleDays = ageDays(movementAt, now) ?? 0;
    const validDays = leadDaysFromToday(offer.validUntil, today);
    const name = clientName(clients, offer.clientId);
    const amount = `${offer.currency} ${new Intl.NumberFormat('es-AR').format(offer.amount)}`;

    if (validDays !== null && validDays <= 0) {
      pushCondition(conditions, {
        organizationId: input.organizationId,
        type: 'OFFER_STALLED',
        entityType: 'offer',
        entityId: offer.id,
        ownerId: offer.assignedToId,
        priority: 'CRÍTICO',
        rank: 18,
        reason: `${amount} · ${validDays < 0 ? 'oferta vencida sin resolución' : 'vence hoy sin resolución'}`,
        action: 'Retomar oferta',
        actionType: 'REVIEW_OFFER',
        target: 'offers',
        name,
        when: relativeDate(offer.validUntil, today),
        conditionVersion: `${movementAt}:${offer.validUntil || ''}`,
        dueAt: offer.validUntil,
        clientId: offer.clientId,
        propertyId: offer.propertyId,
        sourceId: offer.id,
      });
    } else if (
      staleDays >= COMMERCIAL_ALERT_THRESHOLDS.stalledOfferDays
      || validDays === 1
    ) {
      pushCondition(conditions, {
        organizationId: input.organizationId,
        type: 'OFFER_STALLED',
        entityType: 'offer',
        entityId: offer.id,
        ownerId: offer.assignedToId,
        priority: 'ALTO',
        rank: 40,
        reason: `${amount} · sin movimiento hace ${staleDays} días`,
        action: 'Retomar oferta',
        actionType: 'REVIEW_OFFER',
        target: 'offers',
        name,
        when: staleDays === 1 ? 'Hace 1 día' : `Hace ${staleDays} días`,
        conditionVersion: `${movementAt}:${offer.validUntil || ''}`,
        dueAt: offer.validUntil,
        clientId: offer.clientId,
        propertyId: offer.propertyId,
        sourceId: offer.id,
      });
    }
  }

  for (const reservation of input.reservations) {
    if (
      reservation.status !== 'Activa'
      || !activeClientIds.has(reservation.clientId)
      || !assignmentAllowed(input, reservation.assignedToId)
    ) continue;
    const movementAt = reservationMovementAt(reservation, activities);
    const staleDays = ageDays(movementAt, now) ?? 0;
    const expiryDays = leadDaysFromToday(reservation.expiresAt, today);
    const reservationClient = clients.find((client) => client.id === reservation.clientId);
    const nextStepDays = leadDaysFromToday(reservationClient?.nextFollowUp, today);
    const hasValidNextStep = Boolean(
      reservationClient?.nextAction?.trim()
      && nextStepDays !== null
      && nextStepDays >= 0
      && (!reservation.expiresAt || reservationClient.nextFollowUp! <= reservation.expiresAt)
    );
    if (hasValidNextStep) continue;
    const needsAttention = (
      (expiryDays !== null && expiryDays <= COMMERCIAL_ALERT_THRESHOLDS.reservationExpiryWindowDays)
      || staleDays >= COMMERCIAL_ALERT_THRESHOLDS.stalledReservationDays
    );
    if (!needsAttention) continue;
    const critical = expiryDays !== null && expiryDays <= 0;
    pushCondition(conditions, {
      organizationId: input.organizationId,
      type: 'RESERVATION_STALLED',
      entityType: 'reservation',
      entityId: reservation.id,
      ownerId: reservation.assignedToId,
      priority: critical ? 'CRÍTICO' : 'ALTO',
      rank: critical ? 16 : 44,
      reason: critical
        ? (expiryDays! < 0 ? 'Reserva vencida sin movimiento' : 'Reserva vence hoy')
        : expiryDays !== null
          ? `Reserva vence ${relativeDate(reservation.expiresAt, today).toLowerCase()}`
          : `Reserva sin movimiento hace ${staleDays} días`,
      action: 'Revisar reserva',
      actionType: 'REVIEW_RESERVATION',
      target: 'reservations',
      name: clientName(clients, reservation.clientId),
      when: reservation.expiresAt
        ? relativeDate(reservation.expiresAt, today)
        : relativeAge(movementAt, now),
      conditionVersion: `${movementAt}:${reservation.expiresAt || ''}`,
      dueAt: reservation.expiresAt,
      clientId: reservation.clientId,
      propertyId: reservation.propertyId,
      sourceId: reservation.id,
    });
  }

  const specificClientBlocks = new Set(
    conditions
      .filter((condition) => [
        'FOLLOW_UP_OVERDUE',
        'VISIT_UNCONFIRMED',
        'VISIT_RESULT_MISSING',
        'OFFER_STALLED',
        'RESERVATION_STALLED',
      ].includes(condition.type))
      .flatMap((condition) => condition.clientId ? [condition.clientId] : []),
  );

  for (const client of clients) {
    const stage = commercialStage(client);
    if (
      ['Calificado', 'Visita coordinada', 'Negociación', 'Reservado'].includes(stage)
      && !hasValidCommercialCommitment(client, today)
      && !specificClientBlocks.has(client.id)
    ) {
      pushCondition(conditions, {
        organizationId: input.organizationId,
        type: 'ADVANCED_NO_NEXT_ACTION',
        entityType: 'client',
        entityId: client.id,
        ownerId: client.assignedToId,
        priority: stage === 'Reservado' ? 'CRÍTICO' : 'ALTO',
        rank: stage === 'Reservado' ? 20 : 48,
        reason: `${stage} sin próxima acción completa`,
        action: 'Definir próximo paso',
        actionType: 'DEFINE_NEXT_ACTION',
        target: 'lead',
        name: client.name,
        when: 'Ahora',
        conditionVersion: advancedVersion(client, activities),
        clientId: client.id,
        sourceId: client.id,
      });
    }
  }

  for (const reminder of input.reminders) {
    const completedAt = (reminder as Reminder & { completedAt?: string }).completedAt;
    if (completedAt || !assignmentAllowed(input, reminder.assignedToId)) continue;
    const days = leadDaysFromToday(reminder.date, today);
    if (days === null || days >= 0) continue;
    const client = reminderClient(reminder, clients);
    if (reminderMirrorsFollowUp(reminder, client)) continue;
    pushCondition(conditions, {
      organizationId: input.organizationId,
      type: 'TASK_OVERDUE',
      entityType: 'reminder',
      entityId: reminder.id,
      ownerId: reminder.assignedToId,
      priority: reminder.priority === 'Alta' ? 'ALTO' : 'NORMAL',
      rank: reminder.priority === 'Alta' ? 46 : 94,
      reason: reminder.title,
      action: 'Resolver tarea',
      actionType: 'RESOLVE_TASK',
      target: 'agenda',
      name: client?.name || reminder.related || reminder.title,
      when: relativeDate(reminder.date, today),
      conditionVersion: `${reminder.date}:${Number(reminder.revision ?? 0)}:${normalize(reminder.title)}`,
      dueAt: reminder.date,
      ...(client ? { clientId: client.id } : {}),
      sourceId: reminder.id,
    });
  }

  return deduplicateCommercialConditions(conditions);
}

function nextAlertId(existing: readonly CommercialAlert[]): number {
  return Math.max(0, ...existing.map((alert) => Number.isFinite(alert.id) ? alert.id : 0)) + 1;
}

function samePresentation(alert: CommercialAlert, condition: CommercialAlertCondition): boolean {
  return alert.priority === condition.priority
    && alert.rank === condition.rank
    && alert.reason === condition.reason
    && alert.action === condition.action
    && alert.actionType === condition.actionType
    && alert.target === condition.target
    && alert.name === condition.name
    && alert.when === condition.when
    && alert.dueAt === condition.dueAt
    && alert.ownerId === condition.ownerId
    && alert.clientId === condition.clientId
    && alert.propertyId === condition.propertyId
    && alert.sourceId === condition.sourceId;
}

export function reconcileCommercialAlerts(
  existing: readonly CommercialAlert[],
  conditions: readonly CommercialAlertCondition[],
  now = new Date(),
): CommercialAlert[] {
  const timestamp = now.toISOString();
  const activeKeys = new Set(conditions.map((condition) => condition.dedupeKey));
  const byKey = new Map(existing.map((alert) => [alert.dedupeKey, alert]));
  const result = existing.map((alert) => ({ ...alert }));
  let id = nextAlertId(existing);

  for (const condition of conditions) {
    const current = byKey.get(condition.dedupeKey);
    if (current) {
      const index = result.findIndex((alert) => alert.dedupeKey === condition.dedupeKey);
      if (index < 0) continue;
      if (current.state !== 'ACTIVE') continue;
      if (!samePresentation(current, condition)) {
        result[index] = {
          ...current,
          ...condition,
          state: 'ACTIVE',
          updatedAt: timestamp,
          revision: Number(current.revision ?? 0) + 1,
        };
      }
      continue;
    }

    result.push({
      id: id++,
      revision: 0,
      ...condition,
      state: 'ACTIVE',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  return result.map((alert) => {
    if (alert.state !== 'ACTIVE' || activeKeys.has(alert.dedupeKey)) return alert;
    return {
      ...alert,
      state: 'RESOLVED' as CommercialAlertState,
      resolvedAt: timestamp,
      updatedAt: timestamp,
      revision: Number(alert.revision ?? 0) + 1,
    };
  });
}

export function reconcileEvaluatedCommercialAlerts(
  input: CommercialAlertEvaluationInput,
  existing: readonly CommercialAlert[],
): CommercialAlert[] {
  const now = input.now ?? new Date();
  return reconcileCommercialAlerts(existing, evaluateCommercialAlertConditions(input), now);
}

export function dismissCommercialAlert(
  alerts: readonly CommercialAlert[],
  dedupeKey: string,
  now = new Date(),
): CommercialAlert[] {
  const current = alerts.find((alert) => alert.dedupeKey === dedupeKey);
  if (!current || current.state !== 'ACTIVE') return alerts.map((alert) => ({ ...alert }));
  if (current.type !== 'NEW_RELEVANT_MATCH') {
    throw new Error('Esta alerta representa una obligación comercial vigente y no puede ocultarse manualmente.');
  }
  const timestamp = now.toISOString();
  return alerts.map((alert) => alert.dedupeKey === dedupeKey
    ? {
        ...alert,
        state: 'DISMISSED' as CommercialAlertState,
        dismissedAt: timestamp,
        updatedAt: timestamp,
        revision: Number(alert.revision ?? 0) + 1,
      }
    : { ...alert });
}

export function activeCommercialAlerts(alerts: readonly CommercialAlert[]): CommercialAlert[] {
  return alerts
    .filter((alert) => alert.state === 'ACTIVE')
    .slice()
    .sort((left, right) => (
      PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
      || left.rank - right.rank
      || left.name.localeCompare(right.name, 'es-AR')
      || left.dedupeKey.localeCompare(right.dedupeKey)
    ));
}
