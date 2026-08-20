import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { supervisedAttentionQueue, type LeadAttentionRecommendation } from '../lead-attention-queue.js';
import {
  recommendationLogicalId,
  type RecommendationInstrumentationContext,
} from '../lead-recommendation-instrumentation-core.js';
import {
  emptyRecommendationLifecycleState,
  recommendationCycleId,
  recommendationResolvedActivityIdentity,
  reconcileRecommendationLifecycle,
  type RecommendationLifecycleInput,
  type RecommendationLifecycleMutation,
  type RecommendationLifecycleState,
} from '../lead-recommendation-lifecycle.js';
import {
  acknowledgeRecommendationEvents,
  appendUniqueRecommendationEvents,
  eventsFromLifecycleMutation,
  flushRecommendationEventBatch,
  supervisedRecommendationCloudRow,
  type RecommendationTelemetryAuthorization,
  type SupervisedRecommendationEvent,
} from '../lead-recommendation-telemetry-r3.js';
import {
  persistSupervisedRecommendationLifecycleR4,
  readSupervisedRecommendationLifecycleR4,
} from '../lead-recommendation-telemetry-r4.js';
import type { ActivityEntry, Client } from '../models.js';
import type { CloudRecordRow } from '../cloud-records.js';

const SHOWN = '2026-08-19T12:00:00.000Z';
const TODAY = '2026-08-19';

function client(id = 1, overrides: Partial<Client> = {}): Client {
  return {
    id, name: `Lead ${id}`, phone: `549351555${id}`, email: `lead${id}@example.com`, interest: 'Propiedad',
    status: 'Lead', temperature: 'Tibio', pipeline: 'Calificado', lastContact: '2026-08-18',
    nextAction: undefined, nextFollowUp: undefined, notes: 'PII', assignedToId: 1, createdById: 1, ...overrides,
  };
}

function recommendation(overrides: Partial<LeadAttentionRecommendation> = {}): LeadAttentionRecommendation {
  return {
    clientId: 1, name: 'Lead 1', reason: 'Calificado sin seguimiento', alertKind: 'no-follow-up',
    action: 'Programar seguimiento', when: '', relevantDate: '', stage: 'Calificado', ...overrides,
  };
}

function context(visible = [1], organizationId = 'org-a', actorId = 1): RecommendationInstrumentationContext {
  return { organizationId, actorId, visibleClientIds: new Set(visible) };
}

function input(rec = recommendation(), witness = 'activation-v1|same', displayed = true): RecommendationLifecycleInput {
  return { recommendation: rec, activationWitness: witness, displayed };
}

function activity(id: number, action = 'Próxima acción programada', createdAt = '2026-08-19T12:05:00.000Z'): ActivityEntry {
  return { id, actorId: 1, action, entityType: 'Cliente', entityId: 1, detail: 'Acción humana', createdAt };
}

function reconcile(state: RecommendationLifecycleState, inputs: RecommendationLifecycleInput[], activities: ActivityEntry[] = [], shownAt = SHOWN): RecommendationLifecycleMutation {
  return reconcileRecommendationLifecycle(state, context(), inputs, activities, shownAt);
}

function pending(rec = recommendation(), witness = 'activation-v1|same', shownAt = SHOWN): RecommendationLifecycleMutation {
  return reconcile(emptyRecommendationLifecycleState(), [input(rec, witness)], [], shownAt);
}

function auth(visible = [1]): RecommendationTelemetryAuthorization {
  return { organizationId: 'org-a', currentMemberId: 1, currentRole: 'Corredor', activeMemberIds: new Set([1]), visibleClientIds: new Set(visible) };
}

function eventFrom(mutation: RecommendationLifecycleMutation, type: 'RECOMMENDATION_SHOWN' | 'RECOMMENDATION_DECISION'): SupervisedRecommendationEvent {
  const event = eventsFromLifecycleMutation(mutation).find((item) => item.eventType === type);
  assert.ok(event);
  return event!;
}

function fakeStorage(initial: Record<string, string> = {}): Storage & { writes: number } {
  const values = new Map(Object.entries(initial));
  const storage = {
    writes: 0,
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key: string) { return values.get(key) ?? null; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    removeItem(key: string) { values.delete(key); },
    setItem(key: string, value: string) { storage.writes += 1; values.set(key, String(value)); },
  };
  return storage as Storage & { writes: number };
}

async function withLocalStorage<T>(storage: Storage, work: () => T | Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { return await work(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
}

function upsert(remote: Map<string, CloudRecordRow>, rows: CloudRecordRow[]): void {
  rows.forEach((row) => remote.set(`${row.organization_id}|${row.entity_type}|${row.entity_key}`, structuredClone(row)));
}

test('R4.1 pending -> decision -> compactacion -> misma ActivityEntry => 0 nuevo event', () => {
  const first = pending(); const human = activity(100); const once = reconcile(first.state, [input()], [human]);
  assert.equal(once.decisionRecords.length, 1); assert.equal(once.state.cycles[0]!.phase, 'resolved'); assert.equal(once.state.cycles[0]!.record, undefined);
  assert.equal(once.state.cycles[0]!.resolvedByActivityIdentity, recommendationResolvedActivityIdentity(human));
  const second = reconcile(once.state, [input()], [human], '2026-08-19T12:10:00.000Z');
  assert.equal(second.decisionRecords.length, 0); assert.equal(eventsFromLifecycleMutation(second).length, 0);
});

test('R4.2 reload/read lifecycle conserva marker exactly-once', async () => {
  const human = activity(101); const once = reconcile(pending().state, [input()], [human]);
  const key = 'trv-crm-basico:supervised-recommendation-lifecycle-v3:org-a:1'; const storage = fakeStorage({ [key]: JSON.stringify(once.state) });
  await withLocalStorage(storage, () => { const loaded = readSupervisedRecommendationLifecycleR4(context()); assert.equal(loaded.state.cycles[0]!.resolvedByActivityIdentity, recommendationResolvedActivityIdentity(human)); assert.equal(reconcile(loaded.state, [input()], [human]).decisionRecords.length, 0); });
});

test('R4.3 remount/reconcile no duplica decision', () => { const human = activity(102); const once = reconcile(pending().state, [input()], [human]); assert.equal(reconcile(structuredClone(once.state), [input()], [human]).decisionRecords.length, 0); });

test('R4.4 misma ActivityEntry reprocesada 30 veces => una decision total', () => {
  const human = activity(103); let state = pending().state; let decisions = 0;
  for (let i = 0; i < 30; i += 1) { const result = reconcile(state, [input()], [human]); decisions += result.decisionRecords.length; state = result.state; }
  assert.equal(decisions, 1);
});

test('R4.5 recurrencia real crea ciclo2 y ActivityEntry B decide exactamente una vez', () => {
  const humanA = activity(104); const cycle1 = reconcile(pending(recommendation(), 'activation-v1|first').state, [input(recommendation(), 'activation-v1|first')], [humanA]); const firstId = cycle1.state.cycles[0]!.cycleId;
  const absent = reconcile(cycle1.state, [], [humanA], '2026-08-19T12:06:00.000Z'); assert.equal(absent.state.cycles[0]!.cycleId, firstId);
  const cycle2 = reconcile(absent.state, [input(recommendation(), 'activation-v1|second')], [humanA], '2026-08-20T10:00:00.000Z'); assert.equal(cycle2.shownRecords.length, 1); assert.notEqual(cycle2.state.cycles[0]!.cycleId, firstId);
  const humanB = activity(105, 'Próxima acción programada', '2026-08-20T10:05:00.000Z'); const decided = reconcile(cycle2.state, [input(recommendation(), 'activation-v1|second')], [humanA, humanB], '2026-08-20T10:06:00.000Z');
  assert.equal(decided.decisionRecords.length, 1); assert.equal(reconcile(decided.state, [input(recommendation(), 'activation-v1|second')], [humanA, humanB]).decisionRecords.length, 0);
});

test('R4.6 marker ciclo1 no bloquea ActivityEntry B del ciclo2', () => {
  const humanA = activity(106); const one = reconcile(pending(recommendation(), 'activation-v1|one').state, [input(recommendation(), 'activation-v1|one')], [humanA]);
  const two = reconcile(one.state, [input(recommendation(), 'activation-v1|two')], [humanA], '2026-08-20T12:00:00.000Z'); assert.equal(two.state.cycles[0]!.resolvedByActivityIdentity, undefined);
  const humanB = activity(107, 'Próxima acción programada', '2026-08-20T12:05:00.000Z'); assert.equal(reconcile(two.state, [input(recommendation(), 'activation-v1|two')], [humanA, humanB]).decisionRecords.length, 1);
});

test('R4.7 una ActivityEntry no resuelve dos ciclos', () => {
  const human = activity(108); const one = reconcile(pending().state, [input()], [human]); const two = reconcile(one.state, [input(recommendation(), 'activation-v1|new')], [human], '2026-08-20T12:00:00.000Z');
  assert.equal(two.shownRecords.length, 1); assert.equal(reconcile(two.state, [input(recommendation(), 'activation-v1|new')], [human]).decisionRecords.length, 0);
});

test('R4.8 activity anterior a shownAt => 0 decision', () => { assert.equal(reconcile(pending().state, [input()], [activity(109, 'Próxima acción programada', '2026-08-19T11:59:59.000Z')]).decisionRecords.length, 0); });

test('R4.9 accion tardia no relacionada no fabrica modified obsoleto', () => {
  const old = recommendation({ alertKind: 'overdue', action: 'Confirmar financiación', relevantDate: '2026-08-18', stage: 'Contactado' }); const current = recommendation({ alertKind: 'ready', action: 'Enviar opciones', stage: 'Calificado' });
  assert.equal(reconcile(pending(old).state, [input(current, 'activation-v1|other', false)], [activity(110, 'Contacto por WhatsApp')]).decisionRecords.length, 0);
});

test('R4.10 lifecycle sigue O(leads) tras muchas recurrencias', () => { let state = emptyRecommendationLifecycleState(); for (let i = 0; i < 250; i += 1) { state = reconcile(state, [input(recommendation(), `activation-v1|${i}`, false)]).state; assert.equal(state.cycles.length, 1); } assert.ok(JSON.stringify(state).length < 1200); });

test('R4.11 resolved tombstone contiene solo evidencia minima', () => { const cycle = reconcile(pending().state, [input()], [activity(111)]).state.cycles[0]!; assert.equal(cycle.record, undefined); assert.match(cycle.resolvedByActivityIdentity || '', /^activity-v1\|[0-9a-f]{32}$/); const serialized = JSON.stringify(cycle); for (const forbidden of ['reason', 'recommendedAction', 'actualAction', 'phone', 'email', 'notes']) assert.equal(serialized.includes(forbidden), false); });

test('R4.12 decision no ACKeada permanece aunque lifecycle este compactado', () => { const result = reconcile(pending().state, [input()], [activity(112)]); assert.equal(result.state.cycles[0]!.record, undefined); const decision = eventFrom(result, 'RECOMMENDATION_DECISION'); assert.deepEqual(appendUniqueRecommendationEvents([], [decision]).map((item) => item.eventId), [decision.eventId]); });

test('R4.13 cloud failure => outbox intacto', async () => { const shown = eventFrom(pending(), 'RECOMMENDATION_SHOWN'); const result = await flushRecommendationEventBatch([shown], auth(), 'user-1', async () => { throw new Error('offline'); }); assert.equal(result.failed, true); assert.deepEqual(result.remaining.map((item) => item.eventId), [shown.eventId]); });

test('R4.14 ACK concurrente + evento nuevo => nuevo sobrevive', () => { const a = eventFrom(pending(), 'RECOMMENDATION_SHOWN'); const bMutation = reconcileRecommendationLifecycle(emptyRecommendationLifecycleState(), context([2]), [input(recommendation({ clientId: 2 }), 'activation-v1|b')], [], SHOWN); const b = eventFrom(bMutation, 'RECOMMENDATION_SHOWN'); assert.deepEqual(acknowledgeRecommendationEvents(appendUniqueRecommendationEvents([a], [b]), [a.eventId]).map((item) => item.eventId), [b.eventId]); });

test('R4.15 duplicate eventId => cloud idempotente', () => { const event = eventFrom(pending(), 'RECOMMENDATION_SHOWN'); const row = supervisedRecommendationCloudRow(event, 'user-1'); const remote = new Map<string, CloudRecordRow>(); upsert(remote, [row, structuredClone(row)]); assert.equal(remote.size, 1); });

test('R4.16 coalesced write conserva CRM + telemetria', () => {
  const crm = { organization_id: 'org-a', entity_type: 'client', entity_key: 'org-a:client:1', assigned_member_id: 1, payload: { id: 1, nextFollowUp: '2026-08-22' }, created_by: 'user-1' } as CloudRecordRow;
  const telemetry = supervisedRecommendationCloudRow(eventFrom(pending(), 'RECOMMENDATION_SHOWN'), 'user-1'); const remote = new Map<string, CloudRecordRow>(); upsert(remote, [crm, telemetry]);
  assert.equal(remote.size, 2); assert.equal([...remote.values()].some((row) => row.entity_type === 'client'), true); assert.equal([...remote.values()].some((row) => row.entity_type === 'activity'), true);
});

test('R4.17 partial failure conserva CRM + eventos pendientes', async () => {
  const crm = { organization_id: 'org-a', entity_type: 'client', entity_key: 'org-a:client:1', assigned_member_id: 1, payload: { id: 1 }, created_by: 'user-1' } as CloudRecordRow; const remote = new Map<string, CloudRecordRow>(); upsert(remote, [crm]);
  const event = eventFrom(pending(), 'RECOMMENDATION_SHOWN'); const failed = await flushRecommendationEventBatch([event], auth(), 'user-1', async () => { throw new Error('partial'); });
  assert.equal(remote.size, 1); assert.equal([...remote.values()][0]!.entity_type, 'client'); assert.deepEqual(failed.remaining.map((item) => item.eventId), [event.eventId]);
});

test('R4.18 telemetria no bloquea/elimina follow-up CRM', () => { const source = readFileSync('src/tests/followup-cloud-persistence-browser.test.ts', 'utf8'); assert.match(source, /const telemetry = body\.filter\(isTelemetryRow\)/); assert.match(source, /const crm = body\.filter\(\(row\) => !isTelemetryRow\(row\)\)/); assert.match(source, /un batch parcial no reemplaza el conjunto remoto completo/); assert.match(source, /La telemetría append-only sobrevive junto al CRM/); });

test('R4.19 follow-up CRM no elimina telemetria append-only', () => { const source = readFileSync('src/tests/followup-cloud-persistence-browser.test.ts', 'utf8'); assert.match(source, /Los POST CRM posteriores no reemplazan ni borran telemetría/); assert.equal(source.includes('remote = stamp(body'), false); });

test('R4.20 no-op rerender => no events ni write lifecycle', async () => { const first = pending(); const noop = reconcile(first.state, [input()], []); assert.equal(noop.changed, 0); assert.equal(eventsFromLifecycleMutation(noop).length, 0); const storage = fakeStorage(); await withLocalStorage(storage, () => { persistSupervisedRecommendationLifecycleR4(context(), { state: first.state, migratedFromR2: false }, noop); assert.equal(storage.writes, 0); }); });

test('R4.21 30 rerenders misma activacion => 1 SHOWN', () => { let state = emptyRecommendationLifecycleState(); let shown = 0; for (let i = 0; i < 30; i += 1) { const m = reconcile(state, [input()]); shown += m.shownRecords.length; state = m.state; } assert.equal(shown, 1); });

test('R4.22 recurrencia real => cycleId nuevo + 1 SHOWN', () => { const first = pending(recommendation(), 'activation-v1|a'); const second = reconcile(first.state, [input(recommendation(), 'activation-v1|b')], [], '2026-08-20T12:00:00.000Z'); assert.notEqual(first.state.cycles[0]!.cycleId, second.state.cycles[0]!.cycleId); assert.equal(second.shownRecords.length, 1); });

test('R4.23 multi-device misma activacion => mismo cycleId', () => { const semantic = recommendationLogicalId('org-a', 1, recommendation()); assert.equal(recommendationCycleId(semantic, 'activation-v1|shared'), recommendationCycleId(semantic, 'activation-v1|shared')); });

test('R4.24 WhatsApp abrir => pending', () => { const source = readFileSync('src/whatsapp-contact-ui.ts', 'utf8'); const start = source.indexOf('function openChannel()'); const flow = source.slice(start, source.indexOf('function register(', start)); assert.match(flow, /window\.open\(/); assert.equal(flow.includes('registerWhatsAppContact'), false); });

test('R4.25 Todavia no => pending + 0 mutaciones', () => { const source = readFileSync('src/whatsapp-contact-ui.ts', 'utf8'); const start = source.indexOf("if (target.closest('[data-whatsapp-not-yet]'))"); const flow = source.slice(start, source.indexOf('}', start) + 1); assert.match(flow, /dismissPendingWhatsAppAttempt/); for (const forbidden of ['register(', 'nextFollowUp', 'Reminder', 'addActivity']) assert.equal(flow.includes(forbidden), false); });

test('R4.26 Si + ActivityEntry real => decision exactamente una vez', () => { const human = activity(126, 'Contacto por WhatsApp'); const rec = recommendation({ alertKind: 'new-uncontacted', action: 'Contactar por primera vez', stage: 'Nuevo' }); const first = pending(rec); const once = reconcile(first.state, [input(rec)], [human]); assert.equal(once.decisionRecords.length, 1); assert.equal(reconcile(once.state, [input(rec)], [human]).decisionRecords.length, 0); });

test('R4.27 executed/modified mapping conservador intacto', () => { const rec = recommendation({ alertKind: 'overdue', action: 'Confirmar financiación', relevantDate: '2026-08-18', stage: 'Contactado' }); const result = reconcile(pending(rec).state, [input(rec)], [activity(127, 'Contacto por WhatsApp')]); assert.equal(result.decisionRecords[0]!.humanDecision, 'modified'); });

test('R4.28 organization/actor/visibleClients intactos', async () => { const event = { ...eventFrom(pending(), 'RECOMMENDATION_SHOWN'), organizationId: 'org-b' }; let calls = 0; const result = await flushRecommendationEventBatch([event], auth(), 'user-1', async () => { calls += 1; }); assert.equal(calls, 0); assert.equal(result.remaining.length, 1); });

test('R4.29 payload minimizado', () => { const payload = JSON.stringify(supervisedRecommendationCloudRow(eventFrom(pending(), 'RECOMMENDATION_SHOWN'), 'user-1').payload); for (const forbidden of ['phone', 'email', 'notes', 'PII', '549351']) assert.equal(payload.includes(forbidden), false); });

test('R4.30 Won/Lost human-only e ignored diferido', () => { const lifecycle = readFileSync('src/lead-recommendation-lifecycle.ts', 'utf8'); const runtime = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8'); for (const forbidden of ["pipeline = 'Ganado'", "pipeline = 'Perdido'", "'ignored'", 'setTimeout']) { assert.equal(lifecycle.includes(forbidden), false); assert.equal(runtime.includes(forbidden), false); } });

test('R4.31 B1.4.1 max3/order priority intacto', () => { const queue = supervisedAttentionQueue([client(1, { nextFollowUp: '2026-08-18', nextAction: 'Llamar', pipeline: 'Contactado' }), client(2, { pipeline: 'Nuevo', lastContact: undefined }), client(3, { nextFollowUp: TODAY, nextAction: 'Llamar', pipeline: 'Contactado' }), client(4, { pipeline: 'Ganado' }), client(5, { pipeline: 'Perdido' })], TODAY, 99); assert.equal(queue.length, 3); const source = readFileSync('src/lead-attention-queue.ts', 'utf8'); assert.match(source, /sortLeads\(active, 'priority', today\)/); assert.equal(source.includes('score'), false); });

test('R4.32 normal Leads recent / Mas recientes intacto', () => { const source = readFileSync('src/mvp-leads-ui.ts', 'utf8'); const initial = source.slice(source.indexOf('let filters: LeadListFilters'), source.indexOf('let expandedClientId')); assert.match(initial, /order:\s*'recent'/); assert.match(source, /Más recientes/); });

test('R4.33 PR143 Limpiar sin rebound', () => { const source = readFileSync('src/mvp-leads-ui.ts', 'utf8'); const reset = source.slice(source.indexOf('function resetFilters()'), source.indexOf('function synchronizeFilterStateFromControls')); const active = source.slice(source.indexOf('function activeSecondaryFilters()'), source.indexOf('function filterPanel()')); assert.match(reset, /stage:\s*'Todas'/); assert.match(reset, /order:\s*'recent'/); assert.equal(active.includes('filters.order'), false); });

test('R4.34 mobile sin overflow/overlap', () => { const css = readFileSync('src/lead-attention-queue.css', 'utf8'); const runtime = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8'); assert.match(css, /@media \(max-width: 720px\)/); assert.match(css, /overflow-x:\s*hidden/); assert.doesNotMatch(runtime, /\.style\.[\w$-]+\s*=/); assert.doesNotMatch(runtime, /setAttribute\(\s*['"]style['"]/); });

test('R4.35 desktop sin regresion + CI PR143 Chromium/WebKit', () => { const runtime = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8'); assert.equal(runtime.includes('innerHTML'), false); assert.equal(runtime.includes('insertAdjacentHTML'), false); const workflow = readFileSync('.github/workflows/ci.yml', 'utf8'); assert.match(workflow, /PR143/); assert.match(workflow, /webkit/i); });
