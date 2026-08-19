import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  cloudRecordsToCrm,
  crmToCloudRecords,
  isSupervisedRecommendationTelemetryPayload,
  staleCloudRecords,
  type CloudMembershipContext,
  type CloudRecordRow,
} from '../cloud-records.js';
import { supervisedAttentionQueue, type LeadAttentionRecommendation } from '../lead-attention-queue.js';
import {
  appendShownRecommendations,
  applyHumanActivityToRecommendations,
  classifyActivityAgainstRecommendation,
  recommendationLogicalId,
  type RecommendationInstrumentationContext,
  type SupervisedRecommendationRecord,
} from '../lead-recommendation-instrumentation-core.js';
import {
  appendUniqueRecommendationEvents,
  flushRecommendationEventBatch,
  recommendationDecisionEventId,
  recommendationEventsFromMutation,
  recommendationShownEventId,
  supervisedRecommendationCloudRow,
  supervisedRecommendationDecisionEvent,
  supervisedRecommendationShownEvent,
  type RecommendationTelemetryAuthorization,
  type SupervisedRecommendationEvent,
} from '../lead-recommendation-telemetry.js';
import { initialData, type ActivityEntry, type Client } from '../models.js';

const TODAY = '2026-08-19';
const SHOWN_AT = '2026-08-19T12:00:00.000Z';

function client(id: number, overrides: Partial<Client> = {}): Client {
  return {
    id, name: `Lead ${id}`, phone: `549351555${id}`, email: `lead${id}@example.com`, interest: 'Propiedad',
    status: 'Lead', temperature: 'Tibio', pipeline: 'Contactado', lastContact: '2026-08-18',
    nextAction: 'Enviar opciones', nextFollowUp: '2026-08-25', notes: 'Dato sensible', assignedToId: 1, createdById: 1,
    ...overrides,
  };
}

function context(visible = [1], organizationId = 'org-a', actorId = 1): RecommendationInstrumentationContext {
  return { organizationId, actorId, visibleClientIds: new Set(visible) };
}

function recommendation(overrides: Partial<LeadAttentionRecommendation> = {}): LeadAttentionRecommendation {
  return {
    clientId: 1, name: 'Lead 1', reason: 'Nuevo sin contactar', alertKind: 'new-uncontacted',
    action: 'Contactar por primera vez', when: '', relevantDate: '', stage: 'Nuevo', ...overrides,
  };
}

function shownRecord(rec = recommendation(), shownAt = SHOWN_AT): SupervisedRecommendationRecord {
  return appendShownRecommendations([], context([rec.clientId]), [rec], shownAt).log[0]!;
}

function activity(action: string, createdAt = '2026-08-19T12:05:00.000Z', actorId = 1, clientId = 1, id = 1): ActivityEntry {
  return { id, actorId, action, entityType: 'Cliente', entityId: clientId, detail: 'Detalle real', createdAt };
}

function auth(visible = [1]): RecommendationTelemetryAuthorization {
  return { organizationId: 'org-a', currentMemberId: 1, currentRole: 'Corredor', activeMemberIds: new Set([1]), visibleClientIds: new Set(visible) };
}

function rowId(row: CloudRecordRow): string {
  return `${row.organization_id}|${row.entity_type}|${row.entity_key}`;
}

function appendOnly(remote: Map<string, CloudRecordRow>, rows: CloudRecordRow[]): void {
  rows.forEach((row) => { if (!remote.has(rowId(row))) remote.set(rowId(row), structuredClone(row)); });
}

test('R2.1 identidad estable: copy relativo distinto no abre otro ciclo', () => {
  const a = recommendation({ reason: 'Seguimiento vencido ayer', when: 'Ayer', alertKind: 'overdue', action: 'Confirmar financiación', relevantDate: '2026-08-18', stage: 'Contactado' });
  const b = recommendation({ reason: 'Seguimiento vencido hace 2 días', when: 'Hace 2 días', alertKind: 'overdue', action: 'Confirmar financiación', relevantDate: '2026-08-18', stage: 'Contactado' });
  assert.equal(recommendationLogicalId('org-a', 1, a), recommendationLogicalId('org-a', 1, b));
});

test('R2.2 identidad material: kind/action/date/stage sí abren ciclo nuevo', () => {
  const base = recommendation({ alertKind: 'overdue', action: 'Confirmar financiación', relevantDate: '2026-08-18', stage: 'Contactado' });
  const id = recommendationLogicalId('org-a', 1, base);
  const changes = [
    { alertKind: 'due-today' as const },
    { action: 'Programar seguimiento' },
    { relevantDate: '2026-08-19' },
    { stage: 'Calificado' },
  ];
  for (const change of changes) assert.notEqual(id, recommendationLogicalId('org-a', 1, { ...base, ...change }));
});

test('R2.3 dos shown físicos independientes sobreviven y MIN(shownAt) es derivable', async () => {
  const rec = recommendation({ alertKind: 'overdue', relevantDate: '2026-08-18' });
  const a = supervisedRecommendationShownEvent(shownRecord(rec, '2026-08-19T12:00:00.000Z'));
  const b = supervisedRecommendationShownEvent(shownRecord(rec, '2026-08-19T12:03:00.000Z'));
  assert.equal(a.logicalRecommendationId, b.logicalRecommendationId);
  assert.notEqual(a.eventId, b.eventId);
  const remote = new Map<string, CloudRecordRow>();
  await Promise.all([a, b].map(async (event) => appendOnly(remote, [supervisedRecommendationCloudRow(event, 'user-1')])));
  assert.equal(remote.size, 2);
  const min = [...remote.values()].map((row) => (row.payload as SupervisedRecommendationEvent).occurredAt).sort()[0];
  assert.equal(min, '2026-08-19T12:00:00.000Z');
});

test('R2.4 dos decisiones distintas sobreviven sin last-write-wins', async () => {
  const rec = recommendation({ alertKind: 'overdue', action: 'Confirmar financiación', relevantDate: '2026-08-18', stage: 'Contactado' });
  const base = shownRecord(rec);
  const d1 = applyHumanActivityToRecommendations([structuredClone(base)], context(), activity('Financiación confirmada', '2026-08-19T12:05:00.000Z', 1, 1, 10)).log[0]!;
  const d2 = applyHumanActivityToRecommendations([structuredClone(base)], context(), activity('Confirmar financiación', '2026-08-19T12:06:00.000Z', 1, 1, 11)).log[0]!;
  const events = [supervisedRecommendationDecisionEvent(d1), supervisedRecommendationDecisionEvent(d2)].filter((value): value is SupervisedRecommendationEvent => Boolean(value));
  assert.equal(events.length, 2);
  assert.notEqual(events[0]!.eventId, events[1]!.eventId);
  const remote = new Map<string, CloudRecordRow>();
  await Promise.all(events.map(async (event) => appendOnly(remote, [supervisedRecommendationCloudRow(event, 'user-1')])));
  assert.equal(remote.size, 2);
  assert.equal(events.map((event) => event.occurredAt).sort()[0], '2026-08-19T12:05:00.000Z');
});

test('R2.5 retry del mismo eventId es idempotente', () => {
  const record = shownRecord();
  const event = supervisedRecommendationShownEvent(record);
  assert.equal(event.eventId, recommendationShownEventId(record));
  const row = supervisedRecommendationCloudRow(event, 'user-1');
  const remote = new Map<string, CloudRecordRow>();
  appendOnly(remote, [row]); appendOnly(remote, [structuredClone(row)]);
  assert.equal(remote.size, 1);
});

test('R2.6 cloud falla una vez: outbox permanece', async () => {
  const event = supervisedRecommendationShownEvent(shownRecord());
  const result = await flushRecommendationEventBatch([event], auth(), 'user-1', async () => { throw new Error('offline'); });
  assert.equal(result.failed, true);
  assert.equal(result.remaining.length, 1);
  assert.equal(result.remaining[0]!.eventId, event.eventId);
});

test('R2.7 siguiente flush exitoso: mismo evento sale del outbox', async () => {
  const event = supervisedRecommendationShownEvent(shownRecord());
  let rows: CloudRecordRow[] = [];
  const result = await flushRecommendationEventBatch([event], auth(), 'user-1', async (batch) => { rows = batch; });
  assert.equal(result.failed, false); assert.equal(result.remaining.length, 0); assert.equal(rows.length, 1);
  assert.equal((rows[0]!.payload as SupervisedRecommendationEvent).eventId, event.eventId);
});

test('R2.8 telemetría fallida no toca estado Nube al día del CRM', () => {
  const source = readFileSync('src/lead-recommendation-telemetry.ts', 'utf8');
  for (const forbidden of ['markSyncError', 'markCloudSaved', 'markCloudHydrated', 'queueCloudSave', 'saveData(', 'propcontrol-cloud-status']) assert.equal(source.includes(forbidden), false, forbidden);
  assert.match(source, /queda pendiente en outbox/);
});

test('R2.9 tres shown salen en un único batch, sin tres ciclos de membership', async () => {
  const events = [1, 2, 3].map((id) => supervisedRecommendationShownEvent(shownRecord(recommendation({ clientId: id, name: `Lead ${id}` }))));
  let calls = 0; let rows = 0;
  const result = await flushRecommendationEventBatch(events, auth([1, 2, 3]), 'user-1', async (batch) => { calls += 1; rows += batch.length; });
  assert.equal(calls, 1); assert.equal(rows, 3); assert.equal(result.remaining.length, 0);
  const source = readFileSync('src/lead-recommendation-telemetry.ts', 'utf8');
  assert.equal((source.match(/await getCloudMembershipContext\(\)/g) || []).length, 1);
});

test('R2.10 fake cloud histórico distingue CRM/telemetría y usa upsert compuesto', () => {
  const source = readFileSync('src/tests/followup-cloud-persistence-browser.test.ts', 'utf8');
  assert.match(source, /crmPostCount/); assert.match(source, /telemetryPostCount/);
  assert.match(source, /recordIdentity\(existing\) === recordIdentity\(incoming\)/);
  assert.match(source, /La telemetría append-only sobrevive junto al CRM/);
  assert.equal(source.includes('remote = stamp(body'), false);
});

test('R2.11 acción específica + contacto genérico => modified, nunca executed', () => {
  const pending = shownRecord(recommendation({ alertKind: 'overdue', action: 'Confirmar financiación', relevantDate: '2026-08-18', stage: 'Contactado' }));
  assert.equal(classifyActivityAgainstRecommendation(pending, activity('Contacto por WhatsApp')), 'modified');
  assert.equal(applyHumanActivityToRecommendations([pending], context(), activity('Contacto por WhatsApp')).log[0]!.humanDecision, 'modified');
});

test('R2.12 equivalencias determinísticas => executed', () => {
  assert.equal(classifyActivityAgainstRecommendation(shownRecord(), activity('Contacto por WhatsApp')), 'executed');
  assert.equal(classifyActivityAgainstRecommendation(shownRecord(recommendation({ alertKind: 'no-follow-up', action: 'Programar seguimiento', stage: 'Contactado' })), activity('Próxima acción programada')), 'executed');
  assert.equal(classifyActivityAgainstRecommendation(shownRecord(recommendation({ alertKind: 'visit-today', action: 'Confirmar visita', relevantDate: TODAY, stage: 'Visita' })), activity('Visita confirmada')), 'executed');
});

test('R2.13 acción humana real diferente => modified', () => {
  const pending = shownRecord(recommendation({ alertKind: 'overdue', action: 'Confirmar financiación', relevantDate: '2026-08-18' }));
  const result = applyHumanActivityToRecommendations([pending], context(), activity('Seguimiento reprogramado'));
  assert.equal(result.changed, 1); assert.equal(result.log[0]!.humanDecision, 'modified');
});

test('R2.14 WhatsApp open => pending', () => {
  const source = readFileSync('src/whatsapp-contact-ui.ts', 'utf8');
  const start = source.indexOf('function openChannel()'); const end = source.indexOf('function register(', start);
  const flow = source.slice(start, end);
  assert.match(flow, /window\.open\(/); assert.equal(flow.includes('registerWhatsAppContact'), false);
  assert.equal(shownRecord().humanDecision, 'pending');
});

test('R2.15 Todavía no => pending, sin registro', () => {
  const source = readFileSync('src/whatsapp-contact-ui.ts', 'utf8');
  const start = source.indexOf("if (target.closest('[data-whatsapp-not-yet]'))"); const end = source.indexOf('}', start) + 1;
  const flow = source.slice(start, end);
  assert.match(flow, /dismissPendingWhatsAppAttempt/); assert.equal(flow.includes('register('), false);
});

test('R2.16 Sí + ActivityEntry compatible => executed exactly once', () => {
  const pending = shownRecord(); const human = activity('Contacto por WhatsApp', '2026-08-19T12:05:00.000Z', 1, 1, 77);
  const executed = applyHumanActivityToRecommendations([pending], context(), human);
  assert.equal(executed.changed, 1); assert.equal(executed.log[0]!.humanDecision, 'executed');
  assert.equal(applyHumanActivityToRecommendations(executed.log, context(), human).changed, 0);
  const event = supervisedRecommendationDecisionEvent(executed.log[0]!); assert.ok(event);
  assert.equal(event.eventId, recommendationDecisionEventId(executed.log[0]!));
  assert.equal(recommendationEventsFromMutation([pending], executed.log).filter((item) => item.eventType === 'RECOMMENDATION_DECISION').length, 1);
});

test('R2.17 multi-tenant org/actor/visible scope intacto', async () => {
  assert.equal(appendShownRecommendations([], context([1]), [recommendation({ clientId: 2 })], SHOWN_AT).changed, 0);
  const pending = shownRecord();
  assert.equal(applyHumanActivityToRecommendations([pending], context(), activity('Contacto por WhatsApp', undefined, 2)).changed, 0);
  assert.equal(applyHumanActivityToRecommendations([pending], context([]), activity('Contacto por WhatsApp')).changed, 0);
  const foreign = { ...supervisedRecommendationShownEvent(pending), organizationId: 'org-b' };
  let posts = 0; const result = await flushRecommendationEventBatch([foreign], auth(), 'user-1', async () => { posts += 1; });
  assert.equal(posts, 0); assert.equal(result.remaining.length, 1);
});

test('R2.18 payload minimizado: sin phone/email/notes/full Client', () => {
  const row = supervisedRecommendationCloudRow(supervisedRecommendationShownEvent(shownRecord()), 'user-1');
  assert.equal(row.organization_id, 'org-a'); assert.equal(row.assigned_member_id, 1); assert.equal(row.created_by, 'user-1');
  const payload = JSON.stringify(row.payload);
  for (const sensitive of ['phone', 'email', 'notes', 'Dato sensible', '549351']) assert.equal(payload.includes(sensitive), false, sensitive);
});

test('R2.19 B1.4.1: prioridad/terminales/max3 intactos', () => {
  const queue = supervisedAttentionQueue([
    client(1, { nextFollowUp: '2026-08-18' }), client(2, { pipeline: 'Nuevo', lastContact: undefined, nextAction: undefined, nextFollowUp: undefined }),
    client(3, { nextFollowUp: TODAY }), client(4), client(5, { pipeline: 'Ganado' }), client(6, { pipeline: 'Perdido' }),
  ], TODAY, 99);
  assert.equal(queue.length, 3); assert.equal(queue.some((item) => item.stage === 'Ganado' || item.stage === 'Perdido'), false);
  const source = readFileSync('src/lead-attention-queue.ts', 'utf8'); assert.match(source, /sortLeads\(active, 'priority', today\)/);
});

test('R2.20 recent/Limpiar PR143 intacto', () => {
  const source = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const initial = source.slice(source.indexOf('let filters: LeadListFilters'), source.indexOf('let expandedClientId'));
  const reset = source.slice(source.indexOf('function resetFilters()'), source.indexOf('function synchronizeFilterStateFromControls'));
  const active = source.slice(source.indexOf('function activeSecondaryFilters()'), source.indexOf('function filterPanel()'));
  assert.match(initial, /order:\s*'recent'/); assert.match(reset, /stage:\s*'Todas'/); assert.match(reset, /order:\s*'recent'/); assert.equal(active.includes('filters.order'), false);
});

test('R2 CRM isolation: R1+R2 telemetría fuera de activityLog/stale y read-merge-write eliminado', () => {
  const crm = structuredClone(initialData); crm.organization.id = 'org-a'; crm.activityLog = [activity('Seguimiento completado')];
  const cloudContext: CloudMembershipContext = { organizationId: 'org-a', currentMemberId: 1, currentRole: 'Corredor', members: crm.teamMembers.map((member) => ({ ...member, id: 1, role: 'Corredor', status: 'Activo' })) };
  const crmRows = crmToCloudRecords(crm, cloudContext, 'user-1');
  const eventRow = supervisedRecommendationCloudRow(supervisedRecommendationShownEvent(shownRecord()), 'user-1');
  const oldRow: CloudRecordRow = { ...eventRow, entity_key: 'org-a:recommendation:legacy', payload: { recordKind: 'supervised_recommendation', id: 'legacy' } };
  assert.equal(isSupervisedRecommendationTelemetryPayload(eventRow.payload), true); assert.equal(isSupervisedRecommendationTelemetryPayload(oldRow.payload), true);
  const rows = [...crmRows, eventRow, oldRow]; const loaded = cloudRecordsToCrm(rows, cloudContext, crm);
  assert.deepEqual(Object.keys(loaded).sort(), Object.keys(initialData).sort()); assert.equal(loaded.activityLog.length, 1);
  const stale = staleCloudRecords(rows, crmToCloudRecords(loaded, cloudContext, 'user-1'));
  assert.equal(stale.some((row) => row.entity_key === eventRow.entity_key || row.entity_key === oldRow.entity_key), false);
  const telemetry = readFileSync('src/lead-recommendation-telemetry.ts', 'utf8');
  assert.equal(telemetry.includes('mergeSupervisedRecommendationTelemetry'), false); assert.equal(telemetry.includes("method: 'GET'"), false); assert.match(telemetry, /resolution=ignore-duplicates/);
});

test('R2 outbox: dedupe por eventId conserva retries y evidencias físicas distintas', () => {
  const a = supervisedRecommendationShownEvent(shownRecord()); const retry = structuredClone(a);
  const b = supervisedRecommendationShownEvent(shownRecord(recommendation(), '2026-08-19T12:01:00.000Z'));
  const outbox = appendUniqueRecommendationEvents([a], [retry, b]); assert.equal(outbox.length, 2); assert.equal(new Set(outbox.map((item) => item.eventId)).size, 2);
});

test('R2 gobernanza funcional: no CRM mutations, no UI nueva, ignored diferido', () => {
  const runtime = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8');
  const telemetry = readFileSync('src/lead-recommendation-telemetry.ts', 'utf8');
  const core = readFileSync('src/lead-recommendation-instrumentation-core.ts', 'utf8');
  for (const forbidden of ['saveData', 'addActivity', 'Reminder', 'nextFollowUp =', 'nextAction =', 'pipeline =', 'innerHTML', 'insertAdjacentHTML']) assert.equal(runtime.includes(forbidden), false, forbidden);
  for (const forbidden of ['queueCloudSave', 'saveData(', 'writeLocalSnapshot', 'markSyncError', 'propcontrol-cloud-status']) assert.equal(telemetry.includes(forbidden), false, forbidden);
  assert.equal(core.includes("'ignored'"), false); assert.equal(core.includes('setTimeout'), false); assert.equal(core.includes('Date.now()'), false);
});
