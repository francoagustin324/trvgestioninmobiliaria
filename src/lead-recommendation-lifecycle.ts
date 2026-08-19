import type { LeadAttentionRecommendation } from './lead-attention-queue.js';
import {
  classifyActivityAgainstRecommendation,
  recommendationLogicalId,
  type RecommendationHumanDecision,
  type RecommendationInstrumentationContext,
  type SupervisedRecommendationRecord,
} from './lead-recommendation-instrumentation-core.js';
import type { ActivityEntry, Client } from './models.js';

export type RecommendationCyclePhase = 'unshown' | 'pending' | 'resolved';

export interface RecommendationLifecycleCycle {
  clientId: number;
  semanticRecommendationId: string;
  cycleId: string;
  activationWitness: string;
  phase: RecommendationCyclePhase;
  record?: SupervisedRecommendationRecord;
}

export interface RecommendationLifecycleState {
  version: 3;
  cycles: RecommendationLifecycleCycle[];
}

export interface RecommendationLifecycleInput {
  recommendation: LeadAttentionRecommendation;
  activationWitness: string;
  displayed: boolean;
}

export interface RecommendationLifecycleMutation {
  state: RecommendationLifecycleState;
  shownRecords: SupervisedRecommendationRecord[];
  decisionRecords: SupervisedRecommendationRecord[];
  changed: number;
}

function normalized(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function stableHash(value: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  return seeds.map((seed) => {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index) + Math.imul(index + 1, 0x45d9f3b);
      hash = Math.imul(hash, 0x01000193);
      hash ^= hash >>> 13;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }).join('');
}

function latestActivity(
  activities: ActivityEntry[],
  clientId: number,
  accepted: Set<string>,
): ActivityEntry | undefined {
  return activities
    .filter((entry) => entry.entityType === 'Cliente' && entry.entityId === clientId && accepted.has(entry.action))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id - left.id)[0];
}

function activityWitness(entry: ActivityEntry | undefined): string {
  return entry ? `${entry.id}|${normalized(entry.createdAt)}|${normalized(entry.action)}` : '';
}

const SCHEDULE_ACTIVITIES = new Set([
  'Próxima acción programada',
  'Seguimiento reprogramado',
  'Próxima acción actualizada',
  'Seguimiento por WhatsApp programado',
]);
const NO_FOLLOWUP_ACTIVITIES = new Set(['Seguimiento completado', 'Cambio de etapa']);
const CREATED_ACTIVITIES = new Set(['Lead creado']);
const STAGE_ACTIVITIES = new Set(['Cambio de etapa', 'Seguimiento completado']);

/**
 * Evidencia estable que identifica la activación comercial actual, no el render.
 * Se eligen señales que pueden volver verdadera cada condición, evitando usar
 * actividades que sólo resuelven el ciclo actual como disparadores artificiales.
 */
export function recommendationActivationWitness(
  client: Client,
  activities: ActivityEntry[],
  recommendation: Pick<LeadAttentionRecommendation, 'alertKind' | 'relevantDate' | 'stage'>,
): string {
  let trigger = '';
  switch (recommendation.alertKind) {
    case 'overdue':
    case 'due-today':
    case 'visit-today':
      trigger = activityWitness(latestActivity(activities, client.id, SCHEDULE_ACTIVITIES));
      break;
    case 'new-uncontacted':
      trigger = activityWitness(latestActivity(activities, client.id, CREATED_ACTIVITIES));
      break;
    case 'no-follow-up':
    case 'no-action':
      trigger = activityWitness(latestActivity(activities, client.id, NO_FOLLOWUP_ACTIVITIES));
      break;
    case 'qualification-missing':
      trigger = normalized(client.qualificationUpdatedAt);
      break;
    default:
      trigger = activityWitness(latestActivity(activities, client.id, STAGE_ACTIVITIES))
        || normalized(client.qualificationUpdatedAt)
        || normalized(client.lastContact);
      break;
  }
  const material = [
    'activation-v1',
    recommendation.alertKind,
    recommendation.relevantDate,
    recommendation.stage,
    trigger || 'origin',
  ].map(normalized).join('\u001f');
  return `activation-v1|${stableHash(material)}`;
}

export function recommendationCycleId(semanticRecommendationId: string, activationWitness: string): string {
  return `v3|${stableHash(`${semanticRecommendationId}\u001f${activationWitness}`)}`;
}

export function emptyRecommendationLifecycleState(): RecommendationLifecycleState {
  return { version: 3, cycles: [] };
}

function recordForCycle(
  cycle: RecommendationLifecycleCycle,
  context: RecommendationInstrumentationContext,
  recommendation: LeadAttentionRecommendation,
  shownAt: string,
): SupervisedRecommendationRecord {
  return {
    id: cycle.cycleId,
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
  };
}

function semanticByClient(
  context: RecommendationInstrumentationContext,
  inputs: RecommendationLifecycleInput[],
): Map<number, string> {
  const result = new Map<number, string>();
  inputs.forEach(({ recommendation }) => {
    if (!context.visibleClientIds.has(recommendation.clientId)) return;
    result.set(
      recommendation.clientId,
      recommendationLogicalId(context.organizationId, context.actorId, recommendation),
    );
  });
  return result;
}

function decidePending(
  cycles: Map<number, RecommendationLifecycleCycle>,
  context: RecommendationInstrumentationContext,
  currentSemantic: Map<number, string>,
  activities: ActivityEntry[],
): { decisionRecords: SupervisedRecommendationRecord[]; changed: number } {
  const decisionRecords: SupervisedRecommendationRecord[] = [];
  let changed = 0;

  [...activities]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id - right.id)
    .forEach((activity) => {
      if (
        activity.actorId !== context.actorId
        || activity.entityType !== 'Cliente'
        || !activity.entityId
        || !context.visibleClientIds.has(activity.entityId)
      ) return;
      const cycle = cycles.get(activity.entityId);
      if (!cycle || cycle.phase !== 'pending' || !cycle.record) return;
      if (cycle.record.shownAt > activity.createdAt) return;

      const decision = classifyActivityAgainstRecommendation(cycle.record, activity);
      if (!decision) return;
      const stillCurrent = currentSemantic.get(activity.entityId) === cycle.semanticRecommendationId;
      // Una acción tardía distinta no debe convertir un ciclo obsoleto en modified.
      if (!stillCurrent && decision !== 'executed') return;

      const decided: SupervisedRecommendationRecord = {
        ...cycle.record,
        humanDecision: decision,
        decisionAt: activity.createdAt,
        actualAction: activity.action,
        decisionSourceActivityId: activity.id,
        decisionSourceActivityCreatedAt: activity.createdAt,
        decisionSourceActivityAction: activity.action,
      };
      decisionRecords.push(decided);
      cycles.set(activity.entityId, { ...cycle, phase: 'resolved', record: undefined });
      changed += 1;
    });

  return { decisionRecords, changed };
}

/**
 * Estado local acotado: como máximo un ciclo por lead visible. La historia vive
 * en eventos cloud; localmente sólo queda el ciclo vigente/tombstone necesario
 * para dedupe y recurrencia, más el record completo exclusivamente mientras pending.
 */
export function reconcileRecommendationLifecycle(
  state: RecommendationLifecycleState,
  context: RecommendationInstrumentationContext,
  inputs: RecommendationLifecycleInput[],
  activities: ActivityEntry[],
  shownAt: string,
): RecommendationLifecycleMutation {
  const cycles = new Map<number, RecommendationLifecycleCycle>();
  state.cycles.forEach((cycle) => {
    if (context.visibleClientIds.has(cycle.clientId)) cycles.set(cycle.clientId, structuredClone(cycle));
  });
  let changed = state.cycles.length - cycles.size;
  const currentSemantic = semanticByClient(context, inputs);
  const decisionResult = decidePending(cycles, context, currentSemantic, activities);
  changed += decisionResult.changed;

  const shownRecords: SupervisedRecommendationRecord[] = [];
  const inputsByClient = new Map<number, RecommendationLifecycleInput>();
  inputs.forEach((input) => {
    if (context.visibleClientIds.has(input.recommendation.clientId)) inputsByClient.set(input.recommendation.clientId, input);
  });

  // Si una condición ya no existe, no necesitamos conservar su historia completa.
  [...cycles.keys()].forEach((clientId) => {
    if (!inputsByClient.has(clientId)) {
      cycles.delete(clientId);
      changed += 1;
    }
  });

  inputsByClient.forEach((input, clientId) => {
    const semanticRecommendationId = recommendationLogicalId(
      context.organizationId,
      context.actorId,
      input.recommendation,
    );
    const targetCycleId = recommendationCycleId(semanticRecommendationId, input.activationWitness);
    let cycle = cycles.get(clientId);

    // Compatibilidad R2: si el ciclo local legado representa exactamente la misma
    // semántica continua, se adopta sin crear SHOWN duplicado durante el upgrade.
    const legacyContinuous = Boolean(
      cycle
      && !cycle.cycleId.startsWith('v3|')
      && cycle.semanticRecommendationId === semanticRecommendationId,
    );
    const sameContinuousCycle = Boolean(
      cycle
      && cycle.semanticRecommendationId === semanticRecommendationId
      && (cycle.cycleId === targetCycleId || legacyContinuous),
    );

    if (!sameContinuousCycle) {
      cycle = {
        clientId,
        semanticRecommendationId,
        cycleId: targetCycleId,
        activationWitness: input.activationWitness,
        phase: 'unshown',
      };
      cycles.set(clientId, cycle);
      changed += 1;
    }

    if (input.displayed && cycle && cycle.phase === 'unshown') {
      const record = recordForCycle(cycle, context, input.recommendation, shownAt);
      cycles.set(clientId, { ...cycle, phase: 'pending', record });
      shownRecords.push(record);
      changed += 1;
    }
  });

  return {
    state: { version: 3, cycles: [...cycles.values()].sort((left, right) => left.clientId - right.clientId) },
    shownRecords,
    decisionRecords: decisionResult.decisionRecords,
    changed,
  };
}

export function lifecycleDecision(
  record: SupervisedRecommendationRecord,
  activity: ActivityEntry,
): Exclude<RecommendationHumanDecision, 'pending'> | null {
  return classifyActivityAgainstRecommendation(record, activity);
}
