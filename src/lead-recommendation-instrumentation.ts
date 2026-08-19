import { supervisedAttentionQueue, type LeadAttentionRecommendation } from './lead-attention-queue.js';
import {
  appendShownRecommendations,
  applyHumanActivitiesToRecommendations,
  type RecommendationInstrumentationContext,
} from './lead-recommendation-instrumentation-core.js';
import {
  persistSupervisedRecommendationTelemetry,
  readSupervisedRecommendationTelemetry,
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
    const style = getComputedStyle(item);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

let pendingFrame: number | null = null;

export function instrumentVisibleSupervisedRecommendations(container: HTMLElement): void {
  if (typeof window === 'undefined') return;
  if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame);
  pendingFrame = window.requestAnimationFrame(() => {
    pendingFrame = null;
    if (!container.isConnected) return;
    const context = runtimeContext();
    const previous = readSupervisedRecommendationTelemetry(context);
    const decisions = applyHumanActivitiesToRecommendations(previous, context, state.crm.activityLog);
    const shown = appendShownRecommendations(
      decisions.log,
      context,
      actuallyDisplayedRecommendations(container),
      new Date().toISOString(),
    );
    // Persistir también sin cambios permite reintentar un outbox cloud pendiente
    // en una oportunidad segura, sin tocar el estado/sync del CRM.
    persistSupervisedRecommendationTelemetry(context, previous, shown.log);
  });
}
