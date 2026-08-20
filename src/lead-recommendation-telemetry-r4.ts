import type { RecommendationInstrumentationContext } from './lead-recommendation-instrumentation-core.js';
import type { RecommendationLifecycleMutation, RecommendationLifecycleState } from './lead-recommendation-lifecycle.js';
import {
  appendUniqueRecommendationEvents,
  eventsFromLifecycleMutation,
  readSupervisedRecommendationLifecycle,
  readSupervisedRecommendationOutbox,
  scheduleRecommendationOutboxFlush,
  type RecommendationLifecycleSnapshot,
  type SupervisedRecommendationEvent,
} from './lead-recommendation-telemetry-r3.js';
import { scopedStorageKey } from './sync-safety.js';

const LEGACY_TELEMETRY_STORAGE_SUFFIX = 'supervised-recommendations-v2';
const LIFECYCLE_STORAGE_SUFFIX = 'supervised-recommendation-lifecycle-v3';
const TELEMETRY_OUTBOX_SUFFIX = 'supervised-recommendation-outbox-v1';

function storageKey(context: RecommendationInstrumentationContext, suffix: string): string {
  return [scopedStorageKey(), suffix, encodeURIComponent(context.organizationId), String(context.actorId)].join(':');
}

function lifecycleStorageKey(context: RecommendationInstrumentationContext): string {
  return storageKey(context, LIFECYCLE_STORAGE_SUFFIX);
}

function outboxStorageKey(context: RecommendationInstrumentationContext): string {
  return storageKey(context, TELEMETRY_OUTBOX_SUFFIX);
}

function legacyStorageKey(context: RecommendationInstrumentationContext): string {
  return storageKey(context, LEGACY_TELEMETRY_STORAGE_SUFFIX);
}

/**
 * R4 rehidrata únicamente el marker exactly-once que R3 no conocía.
 * El resto de la validación/scope sigue delegado al reader R3 existente.
 */
export function readSupervisedRecommendationLifecycleR4(
  context: RecommendationInstrumentationContext,
): RecommendationLifecycleSnapshot {
  const snapshot = readSupervisedRecommendationLifecycle(context);
  try {
    const raw = localStorage.getItem(lifecycleStorageKey(context));
    if (!raw) return snapshot;
    const parsed = JSON.parse(raw) as { cycles?: unknown };
    if (!Array.isArray(parsed.cycles)) return snapshot;
    const markers = new Map<string, string>();
    parsed.cycles.forEach((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const item = value as { clientId?: unknown; cycleId?: unknown; resolvedByActivityIdentity?: unknown };
      const clientId = Number(item.clientId || 0);
      const cycleId = String(item.cycleId || '');
      const marker = String(item.resolvedByActivityIdentity || '');
      if (clientId > 0 && cycleId && /^activity-v1\|[0-9a-f]{32}$/.test(marker)) {
        markers.set(`${clientId}|${cycleId}`, marker);
      }
    });
    if (!markers.size) return snapshot;
    return {
      ...snapshot,
      state: {
        version: 3,
        cycles: snapshot.state.cycles.map((cycle) => {
          const marker = markers.get(`${cycle.clientId}|${cycle.cycleId}`);
          return marker && cycle.phase === 'resolved'
            ? { ...cycle, resolvedByActivityIdentity: marker }
            : cycle;
        }),
      },
    };
  } catch {
    return snapshot;
  }
}

function writeLifecycleStateR4(
  context: RecommendationInstrumentationContext,
  state: RecommendationLifecycleState,
): void {
  const scoped: RecommendationLifecycleState = {
    version: 3,
    cycles: state.cycles.filter((cycle) => context.visibleClientIds.has(cycle.clientId)),
  };
  localStorage.setItem(lifecycleStorageKey(context), JSON.stringify(scoped));
}

function writeOutboxR4(
  context: RecommendationInstrumentationContext,
  events: SupervisedRecommendationEvent[],
): void {
  const scoped = events.filter((event) => (
    event.organizationId === context.organizationId
    && event.actorId === context.actorId
  ));
  localStorage.setItem(outboxStorageKey(context), JSON.stringify(scoped));
}

/**
 * Mismo contrato durable de R3, con una sola escritura lifecycle por mutación:
 * outbox primero; tombstone R4 después; flush coalescido al final.
 */
export function persistSupervisedRecommendationLifecycleR4(
  context: RecommendationInstrumentationContext,
  snapshot: RecommendationLifecycleSnapshot,
  mutation: RecommendationLifecycleMutation,
): void {
  const events = eventsFromLifecycleMutation(mutation).filter((event) => (
    event.organizationId === context.organizationId
    && event.actorId === context.actorId
    && context.visibleClientIds.has(event.clientId)
  ));

  if (events.length) {
    const current = readSupervisedRecommendationOutbox(context);
    const next = appendUniqueRecommendationEvents(current, events);
    if (next.length !== current.length) writeOutboxR4(context, next);
  }

  if (mutation.changed > 0 || snapshot.migratedFromR2) {
    writeLifecycleStateR4(context, mutation.state);
    if (snapshot.migratedFromR2) localStorage.removeItem(legacyStorageKey(context));
  }

  // No-op real: cero write lifecycle. Un outbox existente conserva una oportunidad
  // single-flight de recovery sin polling ni retries temporales artificiales.
  if (events.length || readSupervisedRecommendationOutbox(context).length > 0) {
    scheduleRecommendationOutboxFlush(context);
  }
}
