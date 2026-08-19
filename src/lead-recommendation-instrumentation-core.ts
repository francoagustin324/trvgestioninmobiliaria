import type { LeadAttentionRecommendation } from './lead-attention-queue.js';
import type { ActivityEntry, SupervisedRecommendationRecord } from './models.js';

export type InstrumentedHumanActionKind = 'contact' | 'followup-completed' | 'followup-scheduled' | 'next-action-updated';

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

export function recommendationLogicalId(
  organizationId: string,
  actorId: number,
  recommendation: Pick<LeadAttentionRecommendation, 'clientId' | 'reason' | 'alertKind' | 'action' | 'when' | 'relevantDate' | 'stage'>,
): string {
  return [
    'v1',
    encodedIdentityPart(organizationId),
    String(actorId),
    String(recommendation.clientId),
    encodedIdentityPart(recommendation.alertKind),
    encodedIdentityPart(recommendation.reason),
    encodedIdentityPart(recommendation.action),
    encodedIdentityPart(recommendation.relevantDate || recommendation.when),
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
  if (activity.action === 'Seguimiento reprogramado' || activity.action === 'Próxima acción programada') return 'followup-scheduled';
  if (activity.action === 'Próxima acción actualizada') return 'next-action-updated';
  return null;
}

function actionExecutesRecommendation(record: SupervisedRecommendationRecord, action: InstrumentedHumanActionKind): boolean {
  if (record.alertKind === 'new-uncontacted') return action === 'contact';
  if (record.alertKind === 'overdue' || record.alertKind === 'due-today') {
    return action === 'contact' || action === 'followup-completed';
  }
  if (record.alertKind === 'visit-today') {
    return action === 'contact' || action === 'followup-completed';
  }
  if (record.alertKind === 'no-follow-up' || record.alertKind === 'no-action') {
    return action === 'followup-scheduled' || action === 'next-action-updated';
  }
  return false;
}

export function applyHumanActivityToRecommendations(
  log: SupervisedRecommendationRecord[],
  context: RecommendationInstrumentationContext,
  activity: ActivityEntry,
): InstrumentationMutation {
  if (activity.actorId !== context.actorId || activity.entityType !== 'Cliente' || !activity.entityId) return { log, changed: 0 };
  if (!context.visibleClientIds.has(activity.entityId)) return { log, changed: 0 };
  const actionKind = humanActionFromActivity(activity);
  if (!actionKind) return { log, changed: 0 };

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

  const next = [...log];
  next[pending.index] = {
    ...pending.item,
    humanDecision: actionExecutesRecommendation(pending.item, actionKind) ? 'executed' : 'modified',
    decisionAt: activity.createdAt,
    actualAction: activity.action,
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
