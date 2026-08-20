import type { LeadAttentionRecommendation } from './lead-attention-queue.js';
import type { ActivityEntry } from './models.js';

export type RecommendationHumanDecision = 'pending' | 'executed' | 'modified';

export interface SupervisedRecommendationRecord {
  id: string;
  organizationId: string;
  actorId: number;
  clientId: number;
  shownAt: string;
  reason: string;
  alertKind: string;
  recommendedAction: string;
  relevantDate?: string;
  context?: string;
  stage: string;
  humanDecision: RecommendationHumanDecision;
  decisionAt?: string;
  actualAction?: string;
  decisionSourceActivityId?: number;
  decisionSourceActivityCreatedAt?: string;
  decisionSourceActivityAction?: string;
  outcome?: 'Ganado' | 'Perdido';
  outcomeAt?: string;
}

export type InstrumentedHumanActionKind =
  | 'contact'
  | 'followup-completed'
  | 'followup-scheduled'
  | 'next-action-updated'
  | 'visit-confirmed'
  | 'financing-confirmed';

export interface RecommendationInstrumentationContext {
  organizationId: string;
  actorId: number;
  visibleClientIds: Set<number>;
}

export interface InstrumentationMutation {
  log: SupervisedRecommendationRecord[];
  changed: number;
}

function normalizedIdentityPart(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function encodedIdentityPart(value: unknown): string {
  return encodeURIComponent(normalizedIdentityPart(value));
}

/**
 * Identidad semántica estable del ciclo de recomendación.
 * Deliberadamente NO incluye reason/when/copy relativo ("ayer", "hace N días").
 */
export function recommendationLogicalId(
  organizationId: string,
  actorId: number,
  recommendation: Pick<LeadAttentionRecommendation, 'clientId' | 'alertKind' | 'action' | 'relevantDate' | 'stage'>,
): string {
  return [
    'v2',
    encodedIdentityPart(organizationId),
    String(actorId),
    String(recommendation.clientId),
    encodedIdentityPart(recommendation.alertKind),
    encodedIdentityPart(recommendation.action),
    encodedIdentityPart(recommendation.relevantDate),
    encodedIdentityPart(recommendation.stage),
  ].join('|');
}

export function appendShownRecommendations(
  log: SupervisedRecommendationRecord[],
  context: RecommendationInstrumentationContext,
  recommendations: LeadAttentionRecommendation[],
  shownAt: string,
): InstrumentationMutation {
  const existing = new Set(log
    .filter((item) => item.organizationId === context.organizationId && item.actorId === context.actorId)
    .map((item) => item.id));
  const additions: SupervisedRecommendationRecord[] = [];

  recommendations.forEach((recommendation) => {
    if (!context.visibleClientIds.has(recommendation.clientId)) return;
    const id = recommendationLogicalId(context.organizationId, context.actorId, recommendation);
    if (existing.has(id)) return;
    existing.add(id);
    additions.push({
      id,
      organizationId: context.organizationId,
      actorId: context.actorId,
      clientId: recommendation.clientId,
      shownAt,
      reason: recommendation.reason,
      alertKind: recommendation.alertKind,
      recommendedAction: recommendation.action,
      relevantDate: recommendation.relevantDate || undefined,
      context: recommendation.when || undefined,
      stage: recommendation.stage,
      humanDecision: 'pending',
    });
  });

  return additions.length
    ? { log: [...log, ...additions], changed: additions.length }
    : { log, changed: 0 };
}

export function humanActionFromActivity(activity: ActivityEntry): InstrumentedHumanActionKind | null {
  if (activity.action === 'Contacto por WhatsApp') return 'contact';
  if (activity.action === 'Seguimiento completado') return 'followup-completed';
  if (
    activity.action === 'Seguimiento reprogramado'
    || activity.action === 'Próxima acción programada'
    || activity.action === 'Seguimiento por WhatsApp programado'
  ) return 'followup-scheduled';
  if (activity.action === 'Próxima acción actualizada') return 'next-action-updated';
  if (activity.action === 'Visita confirmada' || activity.action === 'Visita confirmada por WhatsApp') return 'visit-confirmed';
  if (activity.action === 'Financiación confirmada') return 'financing-confirmed';
  return null;
}

function actionText(value: unknown): string {
  return normalizedIdentityPart(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function exactContactRecommendation(value: string): boolean {
  return value === 'contactar por primera vez'
    || value === 'contactar por whatsapp'
    || value === 'volver a contactar por whatsapp'
    || value === 'volver a contactar';
}

function schedulesFollowUp(value: string): boolean {
  return value === 'programar seguimiento'
    || value === 'definir proxima accion'
    || value === 'definir accion';
}

/**
 * Regla conservadora: executed sólo existe cuando la equivalencia entre la
 * recomendación y la actividad humana es determinística. Una actividad humana
 * real pero distinta se clasifica modified; una actividad no instrumentada se ignora.
 */
export function classifyActivityAgainstRecommendation(
  record: SupervisedRecommendationRecord,
  activity: ActivityEntry,
): Exclude<RecommendationHumanDecision, 'pending'> | null {
  const recommended = actionText(record.recommendedAction);
  const actual = actionText(activity.action);
  const kind = humanActionFromActivity(activity);

  // Igualdad textual normalizada es evidencia determinística suficiente.
  if (recommended && actual === recommended) return 'executed';
  if (!kind) return null;

  if (kind === 'contact') {
    if (record.alertKind === 'new-uncontacted' && recommended === 'contactar por primera vez') return 'executed';
    if (exactContactRecommendation(recommended)) return 'executed';
    return 'modified';
  }

  if (kind === 'followup-scheduled') {
    return schedulesFollowUp(recommended) ? 'executed' : 'modified';
  }

  if (kind === 'next-action-updated') {
    return (recommended === 'definir proxima accion' || recommended === 'definir accion') ? 'executed' : 'modified';
  }

  if (kind === 'followup-completed') {
    return ['completar seguimiento', 'realizar seguimiento', 'hacer seguimiento'].includes(recommended)
      ? 'executed'
      : 'modified';
  }

  if (kind === 'visit-confirmed') {
    return recommended === 'confirmar visita' ? 'executed' : 'modified';
  }

  if (kind === 'financing-confirmed') {
    return recommended === 'confirmar financiacion' ? 'executed' : 'modified';
  }

  return 'modified';
}

export function applyHumanActivityToRecommendations(
  log: SupervisedRecommendationRecord[],
  context: RecommendationInstrumentationContext,
  activity: ActivityEntry,
): InstrumentationMutation {
  if (activity.actorId !== context.actorId || activity.entityType !== 'Cliente' || !activity.entityId) return { log, changed: 0 };
  if (!context.visibleClientIds.has(activity.entityId)) return { log, changed: 0 };

  const pending = log
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (
      item.organizationId === context.organizationId
      && item.actorId === context.actorId
      && item.clientId === activity.entityId
      && item.humanDecision === 'pending'
      && item.shownAt <= activity.createdAt
    ))
    .sort((left, right) => right.item.shownAt.localeCompare(left.item.shownAt))[0];
  if (!pending) return { log, changed: 0 };

  const decision = classifyActivityAgainstRecommendation(pending.item, activity);
  if (!decision) return { log, changed: 0 };

  const next = [...log];
  next[pending.index] = {
    ...pending.item,
    humanDecision: decision,
    decisionAt: activity.createdAt,
    actualAction: activity.action,
    decisionSourceActivityId: activity.id,
    decisionSourceActivityCreatedAt: activity.createdAt,
    decisionSourceActivityAction: activity.action,
  };
  return { log: next, changed: 1 };
}

export function applyHumanActivitiesToRecommendations(
  log: SupervisedRecommendationRecord[],
  context: RecommendationInstrumentationContext,
  activities: ActivityEntry[],
): InstrumentationMutation {
  let current = log;
  let changed = 0;
  [...activities]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id - right.id)
    .forEach((activity) => {
      const result = applyHumanActivityToRecommendations(current, context, activity);
      current = result.log;
      changed += result.changed;
    });
  return { log: current, changed };
}
