import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  supervisedAttentionQueue,
  type LeadAttentionRecommendation,
} from '../lead-attention-queue.js';
import {
  classifyActivityAgainstRecommendation,
  recommendationLogicalId,
  type RecommendationInstrumentationContext,
  type SupervisedRecommendationRecord,
} from '../lead-recommendation-instrumentation-core.js';
import {
  emptyRecommendationLifecycleState,
  recommendationActivationWitness,
  recommendationCycleId,
  reconcileRecommendationLifecycle,
  type RecommendationLifecycleInput,
  type RecommendationLifecycleState,
} from '../lead-recommendation-lifecycle.js';
import {
  acknowledgeRecommendationEvents,
  appendUniqueRecommendationEvents,
  eventsFromLifecycleMutation,
  flushRecommendationEventBatch,
  recommendationShownEvent,
  supervisedRecommendationCloudRow,
  type RecommendationTelemetryAuthorization,
  type SupervisedRecommendationEvent,
} from '../lead-recommendation-telemetry.js';
import { initialData, type ActivityEntry, type Client } from '../models.js';

const TODAY = '2026-08-19';
const SHOWN = '2026-08-19T12:00:00.000Z';

function client(id = 1, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name: `Lead ${id}`,
    phone: `549351555${id}`,
    email: `lead${id}@example.com`,
    interest: 'Propiedad',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Calificado',
    lastContact: '2026-08-18',
    nextAction: undefined,
    nextFollowUp: undefined,
    notes: 'Dato sensible',
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function recommendation(overrides: Partial<LeadAttentionRecommendation> = {}): LeadAttentionRecommendation {
  return {
    clientId: 1,
    name: 'Lead 1',
    reason: 'Calificado sin seguimiento',
    alertKind: 'no-follow-up',
    action: 'Programar seguimiento',
    when: '',
    relevantDate: '',
    stage: 'Calificado',
    ...overrides,
  };
}

function activity(
  id: number,
  action: string,
  createdAt: string,
  clientId = 1,
  actorId = 1,
): ActivityEntry {
  return { id, actorId, action, entityType: 'Cliente', entityId: clientId, detail: 'Acción humana real', createdAt };
}

function context(visible = [1], organizationId = 'org-a', actorId = 1): RecommendationInstrumentationContext {
  return { organizationId, actorId, visibleClientIds: new Set(visible) };
}

function auth(visible = [1]): RecommendationTelemetryAuthorization {
  return {
    organizationId: 'org-a',
    currentMemberId: 1,
    currentRole: 'Corredor',
    activeMemberIds: new Set([1]),
    visibleClientIds: new Set(visible),
  };
}

function input(
  rec: LeadAttentionRecommendation,
  witness: string,
  displayed = true,
): RecommendationLifecycleInput {
  return { recommendation: rec, activationWitness: witness, displayed };
}

function reconcile(
  state: RecommendationLifecycleState,
  inputs: RecommendationLifecycleInput[],
  activities: ActivityEntry[] = [],
  shownAt = SHOWN,
) {
  return reconcileRecommendationLifecycle(state, context(), inputs, activities, shownAt);
}

function firstPending(
  rec = recommendation(),
  witness = 'activation-v1|a',
): { state: RecommendationLifecycleState; record: SupervisedRecommendationRecord } {
  const result = reconcile(emptyRecommendationLifecycleState(), [input(rec, witness)], []);
  const record = result.shownRecords[0]!;
  assert.ok(record);
  return { state: result.state, record };
}

function shownEventFrom(rec = recommendation(), witness = 'activation-v1|a'): SupervisedRecommendationEvent {
  const result = reconcileRecommendationLifecycle(
    emptyRecommendationLifecycleState(),
    context([rec.clientId]),
    [input(rec, witness)],
    [],
    SHOWN,
  );
  return recommendationShownEvent(result.shownRecords[0]!, result.state);
}

test('R3.1 misma recomendación activa + 30 rerenders => un solo SHOWN', () => {
  const rec = recommendation();
  let state = emptyRecommendationLifecycleState();
  let shown = 0;
  for (let index = 0; index < 30; index += 1) {
    const result = reconcile(state, [input(rec, 'activation-v1|stable')], [], `2026-08-19T12:${String(index).padStart(2, '0')}:00.000Z`);
    shown += result.shownRecords.length;
    state = result.state;
  }
  assert.equal(shown, 1);
  assert.equal(state.cycles.length, 1);
});

test('R3.2 copy relativo ayer → hace 2 días no abre ciclo', () => {
  const a = recommendation({ reason: 'Seguimiento vencido ayer', when: 'Ayer', alertKind: 'overdue', action: 'Confirmar financiación', relevantDate: '2026-08-18', stage: 'Contactado' });
  const b = { ...a, reason: 'Seguimiento vencido hace 2 días', when: 'Hace 2 días' };
  const first = reconcile(emptyRecommendationLifecycleState(), [input(a, 'activation-v1|same')]);
  const second = reconcile(first.state, [input(b, 'activation-v1|same')], [], '2026-08-20T12:00:00.000Z');
  assert.equal(recommendationLogicalId('org-a', 1, a), recommendationLogicalId('org-a', 1, b));
  assert.equal(second.shownRecords.length, 0);
  assert.equal(second.state.cycles[0]!.cycleId, first.state.cycles[0]!.cycleId);
});

test('R3.3 executed sin dejar de ser válida no rearma ciclo', () => {
  const rec = recommendation();
  const first = reconcile(emptyRecommendationLifecycleState(), [input(rec, 'activation-v1|same')]);
  const human = activity(10, 'Próxima acción programada', '2026-08-19T12:05:00.000Z');
  const decided = reconcile(first.state, [input(rec, 'activation-v1|same')], [human], '2026-08-19T12:06:00.000Z');
  assert.equal(decided.decisionRecords.length, 1);
  assert.equal(decided.decisionRecords[0]!.humanDecision, 'executed');
  assert.equal(decided.shownRecords.length, 0);
  assert.equal(decided.state.cycles[0]!.phase, 'resolved');
  const rerender = reconcile(decided.state, [input(rec, 'activation-v1|same')], [human], '2026-08-19T12:07:00.000Z');
  assert.equal(rerender.shownRecords.length, 0);
});

test('R3.4 A ejecutada → condición desaparece → transición real → A reaparece => ciclo 2', () => {
  const a = recommendation();
  const first = reconcile(emptyRecommendationLifecycleState(), [input(a, 'activation-v1|first')]);
  const scheduled = activity(11, 'Próxima acción programada', '2026-08-19T12:05:00.000Z');
  const b = recommendation({ alertKind: 'ready', action: 'Enviar opciones', stage: 'Calificado' });
  const away = reconcile(first.state, [input(b, 'activation-v1|scheduled', false)], [scheduled], '2026-08-19T12:06:00.000Z');
  assert.equal(away.decisionRecords.length, 1);
  const completed = activity(12, 'Seguimiento completado', '2026-08-20T10:00:00.000Z');
  const secondWitness = recommendationActivationWitness(client(1), [scheduled, completed], a);
  const second = reconcile(away.state, [input(a, secondWitness)], [scheduled, completed], '2026-08-20T10:01:00.000Z');
  assert.equal(second.shownRecords.length, 1);
  assert.notEqual(second.state.cycles[0]!.cycleId, first.state.cycles[0]!.cycleId);
});

test('R3.5 ciclo 2 queda distinguible en analytics cloud', () => {
  const semantic = recommendationLogicalId('org-a', 1, recommendation());
  const cycle1 = recommendationCycleId(semantic, 'activation-v1|first');
  const cycle2 = recommendationCycleId(semantic, 'activation-v1|second');
  assert.notEqual(cycle1, cycle2);
  assert.equal(cycle1.length, cycle2.length);
});

test('R3.6 ciclo 2 + 30 rerenders => un SHOWN del ciclo 2', () => {
  const rec = recommendation();
  const initial = reconcile(emptyRecommendationLifecycleState(), [input(rec, 'activation-v1|first')]);
  const b = recommendation({ alertKind: 'ready', action: 'Enviar opciones' });
  let state = reconcile(initial.state, [input(b, 'activation-v1|b', false)]).state;
  let shown = 0;
  for (let index = 0; index < 30; index += 1) {
    const result = reconcile(state, [input(rec, 'activation-v1|second')], [], `2026-08-20T12:${String(index).padStart(2, '0')}:00.000Z`);
    shown += result.shownRecords.length;
    state = result.state;
  }
  assert.equal(shown, 1);
});

test('R3.7 reload/remount conserva ciclo activo', () => {
  const first = reconcile(emptyRecommendationLifecycleState(), [input(recommendation(), 'activation-v1|same')]);
  const reloaded = JSON.parse(JSON.stringify(first.state)) as RecommendationLifecycleState;
  const next = reconcile(reloaded, [input(recommendation(), 'activation-v1|same')], [], '2026-08-19T12:10:00.000Z');
  assert.equal(next.shownRecords.length, 0);
  assert.equal(next.state.cycles[0]!.cycleId, first.state.cycles[0]!.cycleId);
});

test('R3.8 cambio material kind/action/date/stage => ciclo nuevo', () => {
  const base = recommendation({ alertKind: 'overdue', action: 'Confirmar financiación', relevantDate: '2026-08-18', stage: 'Contactado' });
  const variants = [
    { ...base, alertKind: 'due-today' as const },
    { ...base, action: 'Programar seguimiento' },
    { ...base, relevantDate: '2026-08-19' },
    { ...base, stage: 'Calificado' },
  ];
  const first = reconcile(emptyRecommendationLifecycleState(), [input(base, 'activation-v1|same')]);
  for (const variant of variants) {
    const changed = reconcile(first.state, [input(variant, 'activation-v1|same')], [], '2026-08-19T12:10:00.000Z');
    assert.notEqual(changed.state.cycles[0]!.cycleId, first.state.cycles[0]!.cycleId);
  }
});

test('R3.9 una ActivityEntry no decide dos ciclos históricos', () => {
  const a = recommendation();
  const first = reconcile(emptyRecommendationLifecycleState(), [input(a, 'activation-v1|a')]);
  const human = activity(20, 'Próxima acción programada', '2026-08-19T12:05:00.000Z');
  const b = recommendation({ alertKind: 'ready', action: 'Enviar opciones' });
  const transitioned = reconcile(first.state, [input(b, 'activation-v1|b', false)], [human]);
  assert.equal(transitioned.decisionRecords.length, 1);
  const replay = reconcile(transitioned.state, [input(b, 'activation-v1|b', false)], [human]);
  assert.equal(replay.decisionRecords.length, 0);
});

test('R3.10 actividad anterior a shownAt no decide', () => {
  const first = reconcile(emptyRecommendationLifecycleState(), [input(recommendation(), 'activation-v1|a')]);
  const earlier = activity(21, 'Próxima acción programada', '2026-08-19T11:59:59.000Z');
  const result = reconcile(first.state, [input(recommendation(), 'activation-v1|a')], [earlier]);
  assert.equal(result.decisionRecords.length, 0);
  assert.equal(result.state.cycles[0]!.phase, 'pending');
});

test('R3.11 estado local queda O(leads), no O(historial)', () => {
  let state = emptyRecommendationLifecycleState();
  for (let index = 0; index < 200; index += 1) {
    const rec = index % 2 === 0
      ? recommendation()
      : recommendation({ alertKind: 'ready', action: 'Enviar opciones' });
    state = reconcile(state, [input(rec, `activation-v1|${index}`, false)]).state;
    assert.equal(state.cycles.length, 1);
  }
  assert.ok(JSON.stringify(state).length < 1000);
  assert.equal(state.cycles[0]!.record, undefined);
});

test('R3.12 evento sin ACK nunca se elimina del outbox', () => {
  const event = shownEventFrom();
  assert.deepEqual(acknowledgeRecommendationEvents([event], ['otro-evento']), [event]);
});

test('R3.13 cloud fail conserva outbox', async () => {
  const event = shownEventFrom();
  const result = await flushRecommendationEventBatch([event], auth(), 'user-1', async () => { throw new Error('offline'); });
  assert.equal(result.failed, true);
  assert.equal(result.remaining[0]!.eventId, event.eventId);
});

test('R3.14 ACK viejo no borra evento nuevo concurrente', () => {
  const a = shownEventFrom(recommendation({ clientId: 1 }));
  const b = shownEventFrom(recommendation({ clientId: 2 }), 'activation-v1|b');
  const current = appendUniqueRecommendationEvents([a], [b]);
  const remaining = acknowledgeRecommendationEvents(current, [a.eventId]);
  assert.deepEqual(remaining.map((item) => item.eventId), [b.eventId]);
});

test('R3.15 rerender no-op no genera SHOWN/DECISION', () => {
  const first = reconcile(emptyRecommendationLifecycleState(), [input(recommendation(), 'activation-v1|same')]);
  const noop = reconcile(first.state, [input(recommendation(), 'activation-v1|same')], []);
  assert.equal(noop.changed, 0);
  assert.equal(noop.shownRecords.length, 0);
  assert.equal(noop.decisionRecords.length, 0);
});

test('R3.16 no-op no reescribe lifecycle local', () => {
  const source = readFileSync('src/lead-recommendation-telemetry.ts', 'utf8');
  assert.match(source, /if \(mutation\.changed > 0 \|\| snapshot\.migratedFromR2\)/);
  assert.equal((source.match(/writeLifecycleState\(context, mutation\.state\)/g) || []).length, 1);
  assert.match(source, /No-op render: cero write local/);
});

test('R3.17 tres recomendaciones nuevas => un batch de tres rows', async () => {
  const events = [1, 2, 3].map((id) => shownEventFrom(recommendation({ clientId: id }), `activation-v1|${id}`));
  let calls = 0;
  let rows = 0;
  const result = await flushRecommendationEventBatch(events, auth([1, 2, 3]), 'user-1', async (batch) => {
    calls += 1;
    rows += batch.length;
  });
  assert.equal(calls, 1);
  assert.equal(rows, 3);
  assert.equal(result.failed, false);
});

test('R3.18 WhatsApp abrir => pending', () => {
  const source = readFileSync('src/whatsapp-contact-ui.ts', 'utf8');
  const start = source.indexOf('function openChannel()');
  const end = source.indexOf('function register(', start);
  const flow = source.slice(start, end);
  assert.match(flow, /window\.open\(/);
  assert.equal(flow.includes('registerWhatsAppContact'), false);
  assert.equal(firstPending().record.humanDecision, 'pending');
});

test('R3.19 Todavía no => pending y cero registro', () => {
  const source = readFileSync('src/whatsapp-contact-ui.ts', 'utf8');
  const start = source.indexOf("if (target.closest('[data-whatsapp-not-yet]'))");
  const end = source.indexOf('}', start) + 1;
  const flow = source.slice(start, end);
  assert.match(flow, /dismissPendingWhatsAppAttempt/);
  assert.equal(flow.includes('register('), false);
  for (const forbidden of ['nextFollowUp', 'Reminder', 'addActivity']) assert.equal(flow.includes(forbidden), false);
});

test('R3.20 Sí sólo resuelve mediante ActivityEntry humana real exactamente una vez', () => {
  const first = firstPending(recommendation({ alertKind: 'new-uncontacted', action: 'Contactar por primera vez', stage: 'Nuevo' }));
  const rec = recommendation({ alertKind: 'new-uncontacted', action: 'Contactar por primera vez', stage: 'Nuevo' });
  const human = activity(30, 'Contacto por WhatsApp', '2026-08-19T12:05:00.000Z');
  const currentInput = input(rec, first.state.cycles[0]!.activationWitness);
  const once = reconcile(first.state, [currentInput], [human]);
  assert.equal(once.decisionRecords.length, 1);
  const twice = reconcile(once.state, [currentInput], [human]);
  assert.equal(twice.decisionRecords.length, 0);
});

test('R3.21 executed/modified conserva mapping determinístico R2', () => {
  const financing = firstPending(recommendation({ alertKind: 'overdue', action: 'Confirmar financiación', relevantDate: '2026-08-18', stage: 'Contactado' })).record;
  assert.equal(classifyActivityAgainstRecommendation(financing, activity(31, 'Financiación confirmada', '2026-08-19T12:05:00.000Z')), 'executed');
  assert.equal(classifyActivityAgainstRecommendation(financing, activity(32, 'Contacto por WhatsApp', '2026-08-19T12:06:00.000Z')), 'modified');
});

test('R3.22 Won/Lost continúa human-only', () => {
  const runtime = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8');
  const lifecycle = readFileSync('src/lead-recommendation-lifecycle.ts', 'utf8');
  assert.equal(runtime.includes("pipeline = 'Ganado'"), false);
  assert.equal(runtime.includes("pipeline = 'Perdido'"), false);
  assert.equal(lifecycle.includes("pipeline = 'Ganado'"), false);
  assert.equal(lifecycle.includes("pipeline = 'Perdido'"), false);
});

test('R3.23 telemetría no modifica CRM/sync/nextAction/followup/reminder/pipeline', () => {
  const runtime = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8');
  const telemetry = readFileSync('src/lead-recommendation-telemetry.ts', 'utf8');
  for (const forbidden of ['saveData', 'queueCloudSave', 'addActivity', 'Reminder', 'nextFollowUp =', 'nextAction =', 'pipeline =', 'markSyncError', 'markCloudSaved', 'propcontrol-cloud-status']) {
    assert.equal(runtime.includes(forbidden), false, `runtime:${forbidden}`);
    assert.equal(telemetry.includes(forbidden), false, `telemetry:${forbidden}`);
  }
  assert.deepEqual(Object.keys(initialData).sort(), ['activityLog', 'clients', 'contacts', 'conversations', 'fichas', 'organization', 'properties', 'reminders', 'settings', 'teamMembers', 'visits'].sort());
});

test('R3.24 organization/actor/visibleClients siguen aislados', async () => {
  const foreign = { ...shownEventFrom(), organizationId: 'org-b' };
  let calls = 0;
  const result = await flushRecommendationEventBatch([foreign], auth(), 'user-1', async () => { calls += 1; });
  assert.equal(calls, 0);
  assert.equal(result.remaining.length, 1);
  const runtime = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8');
  assert.match(runtime, /visibleClients\(\)/);
  assert.match(runtime, /organizationId: state\.crm\.organization\.id/);
  assert.match(runtime, /actorId: activeMember\(\)\.id/);
});

test('R3.25 payload minimizado sin PII ni Client completo', () => {
  const row = supervisedRecommendationCloudRow(shownEventFrom(), 'user-1');
  const payload = JSON.stringify(row.payload);
  for (const sensitive of ['phone', 'email', 'notes', 'Dato sensible', '549351']) assert.equal(payload.includes(sensitive), false, sensitive);
});

test('R3.26 B1.4.1 mantiene priority/max3/terminales y sin score nuevo', () => {
  const queue = supervisedAttentionQueue([
    client(1, { nextFollowUp: '2026-08-18', nextAction: 'Llamar', pipeline: 'Contactado' }),
    client(2, { pipeline: 'Nuevo', lastContact: undefined }),
    client(3, { nextFollowUp: TODAY, nextAction: 'Llamar', pipeline: 'Contactado' }),
    client(4, { pipeline: 'Ganado' }),
    client(5, { pipeline: 'Perdido' }),
  ], TODAY, 99);
  assert.equal(queue.length, 3);
  assert.equal(queue.some((item) => item.stage === 'Ganado' || item.stage === 'Perdido'), false);
  const source = readFileSync('src/lead-attention-queue.ts', 'utf8');
  assert.match(source, /sortLeads\(active, 'priority', today\)/);
  assert.equal(source.includes('score'), false);
});

test('R3.27 Leads normal conserva recent / Más recientes', () => {
  const source = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const initial = source.slice(source.indexOf('let filters: LeadListFilters'), source.indexOf('let expandedClientId'));
  assert.match(initial, /order:\s*'recent'/);
  assert.match(source, /Más recientes/);
});

test('R3.28 Limpiar PR143 conserva contrato sin rebound', () => {
  const source = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const reset = source.slice(source.indexOf('function resetFilters()'), source.indexOf('function synchronizeFilterStateFromControls'));
  const active = source.slice(source.indexOf('function activeSecondaryFilters()'), source.indexOf('function filterPanel()'));
  assert.match(reset, /stage:\s*'Todas'/);
  assert.match(reset, /order:\s*'recent'/);
  assert.equal(active.includes('filters.order'), false);
});

test('R3.29 mobile conserva protección overflow/overlap existente', () => {
  const css = readFileSync('src/lead-attention-queue.css', 'utf8');
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /overflow-x:\s*hidden/);
  const runtime = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8');
  assert.equal(runtime.includes('style.'), false);
});

test('R3.30 desktop sin regresión visual: R3 no introduce UI/CSS y CI mantiene PR143', () => {
  const runtime = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8');
  const lifecycle = readFileSync('src/lead-recommendation-lifecycle.ts', 'utf8');
  const telemetry = readFileSync('src/lead-recommendation-telemetry.ts', 'utf8');
  for (const source of [runtime, lifecycle, telemetry]) {
    assert.equal(source.includes('innerHTML'), false);
    assert.equal(source.includes('insertAdjacentHTML'), false);
  }
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(workflow, /PR143/);
  assert.match(workflow, /webkit/i);
});

test('R3 compat: dos dispositivos sobre misma activación calculan mismo ciclo', () => {
  const semantic = recommendationLogicalId('org-a', 1, recommendation());
  assert.equal(
    recommendationCycleId(semantic, 'activation-v1|shared'),
    recommendationCycleId(semantic, 'activation-v1|shared'),
  );
});

test('R3 compat: eventos cloud mantienen logicalRecommendationId semántico + cycleId separado', () => {
  const result = reconcile(emptyRecommendationLifecycleState(), [input(recommendation(), 'activation-v1|shared')]);
  const event = eventsFromLifecycleMutation(result)[0]!;
  assert.equal(event.logicalRecommendationId, recommendationLogicalId('org-a', 1, recommendation()));
  assert.equal(event.recommendationCycleId, result.state.cycles[0]!.cycleId);
  assert.notEqual(event.logicalRecommendationId, event.recommendationCycleId);
});
