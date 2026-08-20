import {
  supervisedAttentionQueue,
  supervisedAttentionRecommendationForClient,
  type LeadAttentionRecommendation,
} from './lead-attention-queue.js';
import type { RecommendationInstrumentationContext } from './lead-recommendation-instrumentation-core.js';
import {
  recommendationActivationWitness,
  reconcileRecommendationLifecycle,
  type RecommendationLifecycleInput,
} from './lead-recommendation-lifecycle.js';
import {
  persistSupervisedRecommendationLifecycle,
  readSupervisedRecommendationLifecycle,
} from './lead-recommendation-telemetry.js';
import { state } from './store.js';
import { activeMember, visibleClients } from './team-access.js';

function runtimeContext(): RecommendationInstrumentationContext {
  const visible = visibleClients();
  return {
    organizationId: state.crm.organization.id,
    actorId: activeMember().id,
    visibleClientIds: new Set(visible.map((client) => client.id)),
  };
}

function actuallyDisplayedRecommendations(container: HTMLElement): LeadAttentionRecommendation[] {
  const recommendations = supervisedAttentionQueue(visibleClients());
  return recommendations.filter((recommendation) => {
    const item = container.querySelector<HTMLElement>(`[data-attention-client-id="${recommendation.clientId}"]`);
    if (!item?.isConnected || item.hidden || item.getClientRects().length === 0) return false;
    const computedStyle = getComputedStyle(item);
    return computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden';
  });
}

function lifecycleInputs(displayed: LeadAttentionRecommendation[]): RecommendationLifecycleInput[] {
  const displayedIds = new Set(displayed.map((recommendation) => recommendation.clientId));
  return visibleClients()
    .map((client) => {
      const recommendation = supervisedAttentionRecommendationForClient(client);
      if (!recommendation) return null;
      return {
        recommendation,
        activationWitness: recommendationActivationWitness(client, state.crm.activityLog, recommendation),
        displayed: displayedIds.has(client.id),
      };
    })
    .filter((input): input is RecommendationLifecycleInput => Boolean(input));
}

let pendingFrame: number | null = null;

export function instrumentVisibleSupervisedRecommendations(container: HTMLElement): void {
  if (typeof window === 'undefined') return;
  if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame);
  pendingFrame = window.requestAnimationFrame(() => {
    pendingFrame = null;
    if (!container.isConnected) return;

    const context = runtimeContext();
    const displayed = actuallyDisplayedRecommendations(container);
    const snapshot = readSupervisedRecommendationLifecycle(context);
    const mutation = reconcileRecommendationLifecycle(
      snapshot.state,
      context,
      lifecycleInputs(displayed),
      state.crm.activityLog,
      new Date().toISOString(),
    );
    persistSupervisedRecommendationLifecycle(context, snapshot, mutation);
  });
}
