import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cloudRecordsToCrm, crmToCloudRecords, staleCloudRecords, type CloudMembershipContext } from '../cloud-records.js';
import { renderSupervisedAttentionQueue, supervisedAttentionQueue, type LeadAttentionRecommendation } from '../lead-attention-queue.js';
import {
  appendShownRecommendations,
  applyHumanActivityToRecommendations,
  recommendationLogicalId,
  type RecommendationInstrumentationContext,
  type SupervisedRecommendationRecord,
} from '../lead-recommendation-instrumentation-core.js';
import {
  mergeSupervisedRecommendationTelemetry,
  supervisedRecommendationCloudRow,
} from '../lead-recommendation-telemetry.js';
import { initialData, type ActivityEntry, type Client } from '../models.js';

const TODAY = '2026-08-19';
const SHOWN_AT = '2026-08-19T12:00:00.000Z';

function client(id: number, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name: `Lead ${id}`,
    phone: `549351555${String(id).padStart(4, '0')}`,
    email: `lead${id}@example.com`,
    interest: 'Propiedad en Córdoba',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    lastContact: '2026-08-18',
    nextAction: 'Enviar opciones',
    nextFollowUp: '2026-08-25',
    notes: 'Dato sensible que no debe viajar a telemetría',
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function context(visible = [1]): RecommendationInstrumentationContext {
  return { organizationId: 'org-a', actorId: 1, visibleClientIds: new Set(visible) };
}

function recommendation(overrides: Partial<LeadAttentionRecommendation> = {}): LeadAttentionRecommendation {
  return {
    clientId: 1,
    name: 'Lead 1',
    reason: 'Nuevo sin contactar',
    alertKind: 'new-uncontacted',
    action: 'Contactar por primera vez',
    when: '',
    relevantDate: '',
    stage: 'Nuevo',
    ...overrides,
  };
}

function shownRecord(rec = recommendation()): SupervisedRecommendationRecord {
  return appendShownRecommendations([], context(), [rec], SHOWN_AT).log[0]!;
}

function activity(action: string, createdAt = '2026-08-19T12:05:00.000Z', actorId = 1, clientId = 1): ActivityEntry {
  return { id: 1, actorId, action, entityType: 'Cliente', entityId: clientId, detail: 'Detalle real', createdAt };
}

test('B1.4.2 A: rerender de la misma recomendación produce un solo shown lógico', () => {
  const rec = recommendation();
  const first = appendShownRecommendations([], context(), [rec], SHOWN_AT);
  const second = appendShownRecommendations(first.log, context(), [rec, rec], '2026-08-19T12:01:00.000Z');
  assert.equal(first.changed, 1);
  assert.equal(second.changed, 0);
  assert.equal(second.log.length, 1);
  assert.equal(second.log[0]!.shownAt, SHOWN_AT);
});

test('B1.4.2 B: cambio material reason/action/context abre un ciclo lógico nuevo', () => {
  const original = recommendation();
  const changed = recommendation({
    reason: 'Seguimiento vencido ayer',
    alertKind: 'overdue',
    action: 'Confirmar financiación',
    relevantDate: '2026-08-18',
    stage: 'Contactado',
  });
  assert.notEqual(recommendationLogicalId('org-a', 1, original), recommendationLogicalId('org-a', 1, changed));
  const first = appendShownRecommendations([], context(), [original], SHOWN_AT);
  const second = appendShownRecommendations(first.log, context(), [changed], '2026-08-19T12:02:00.000Z');
  assert.equal(second.changed, 1);
  assert.equal(second.log.length, 2);
});

test('B1.4.2 C/F: executed sólo nace de actividad humana compatible posterior y queda exactly-once', () => {
  const pending = shownRecord();
  const before = applyHumanActivityToRecommendations([pending], context(), activity('Contacto por WhatsApp', '2026-08-19T11:59:59.000Z'));
  assert.equal(before.changed, 0);
  assert.equal(before.log[0]!.humanDecision, 'pending');

  const executed = applyHumanActivityToRecommendations([pending], context(), activity('Contacto por WhatsApp'));
  assert.equal(executed.changed, 1);
  assert.equal(executed.log[0]!.humanDecision, 'executed');
  assert.equal(executed.log[0]!.actualAction, 'Contacto por WhatsApp');

  const duplicate = applyHumanActivityToRecommendations(executed.log, context(), activity('Contacto por WhatsApp'));
  assert.equal(duplicate.changed, 0);
  assert.equal(duplicate.log.filter((item) => item.humanDecision === 'executed').length, 1);
});

test('B1.4.2 D/E: abrir WhatsApp y Todavía no no producen executed', () => {
  const source = readFileSync('src/whatsapp-contact-ui.ts', 'utf8');
  const openStart = source.indexOf('function openChannel()');
  const openEnd = source.indexOf('function register(', openStart);
  const openFlow = source.slice(openStart, openEnd);
  assert.match(openFlow, /window\.open\(/);
  assert.equal(openFlow.includes('registerWhatsAppContact'), false);

  const notYetStart = source.indexOf("if (target.closest('[data-whatsapp-not-yet]'))");
  const notYetEnd = source.indexOf('}', notYetStart) + 1;
  const notYet = source.slice(notYetStart, notYetEnd);
  assert.match(notYet, /dismissPendingWhatsAppAttempt/);
  assert.equal(notYet.includes('register('), false);

  const pending = shownRecord();
  assert.equal(pending.humanDecision, 'pending');
});

test('B1.4.2 G: una acción humana real diferente se clasifica modified de forma determinística', () => {
  const result = applyHumanActivityToRecommendations(
    [shownRecord()],
    context(),
    activity('Seguimiento reprogramado'),
  );
  assert.equal(result.changed, 1);
  assert.equal(result.log[0]!.humanDecision, 'modified');
  assert.equal(result.log[0]!.actualAction, 'Seguimiento reprogramado');
});

test('B1.4.2 H: render puro no guarda ni muta lead/activity/reminder/followup/pipeline', () => {
  const clients = [client(1, { pipeline: 'Nuevo', lastContact: undefined, nextAction: undefined, nextFollowUp: undefined })];
  const before = structuredClone(clients);
  const html = renderSupervisedAttentionQueue(clients, TODAY);
  assert.match(html, /ATENDER AHORA/);
  assert.deepEqual(clients, before);
  const queueSource = readFileSync('src/lead-attention-queue.ts', 'utf8');
  for (const forbidden of ['saveData', 'addActivity', 'Reminder', 'nextFollowUp =', 'nextAction =', 'pipeline =']) {
    assert.equal(queueSource.includes(forbidden), false, forbidden);
  }
  const runtimeSource = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8');
  for (const forbidden of ['saveData', 'addActivity', 'Reminder', 'nextFollowUp =', 'nextAction =', 'pipeline =']) {
    assert.equal(runtimeSource.includes(forbidden), false, forbidden);
  }
  assert.match(runtimeSource, /persistSupervisedRecommendationTelemetry\(context, previous, shown\.log\)/);
  const telemetrySource = readFileSync('src/lead-recommendation-telemetry.ts', 'utf8');
  for (const forbidden of ['queueCloudSave', 'saveData(', 'writeLocalSnapshot', 'markSyncError', 'propcontrol-cloud-status']) {
    assert.equal(telemetrySource.includes(forbidden), false, forbidden);
  }
});

test('B1.4.2 I/N: terminales fuera, motor B1.4.1 intacto y máximo tres', () => {
  const queue = supervisedAttentionQueue([
    client(1, { nextFollowUp: '2026-08-18' }),
    client(2, { pipeline: 'Nuevo', lastContact: undefined, nextAction: undefined, nextFollowUp: undefined }),
    client(3, { nextFollowUp: TODAY }),
    client(4),
    client(5, { pipeline: 'Ganado' }),
    client(6, { pipeline: 'Perdido' }),
  ], TODAY, 99);
  assert.equal(queue.length, 3);
  assert.equal(queue.some((item) => item.stage === 'Ganado' || item.stage === 'Perdido'), false);
  const source = readFileSync('src/lead-attention-queue.ts', 'utf8');
  assert.match(source, /sortLeads\(active, 'priority', today\)/);
  for (const sourceOfTruth of ['leadPrimaryAlert', 'leadCardAttentionPresentation', 'commercialStage', 'isTerminalClient']) {
    assert.ok(source.includes(sourceOfTruth), sourceOfTruth);
  }
});

test('B1.4.2 J: shown/decision respetan organization, actor y visible client boundaries', () => {
  const hidden = appendShownRecommendations([], context([1]), [recommendation({ clientId: 2, name: 'Ajeno' })], SHOWN_AT);
  assert.equal(hidden.changed, 0);

  const pending = shownRecord();
  const wrongActor = applyHumanActivityToRecommendations([pending], context(), activity('Contacto por WhatsApp', undefined, 2));
  const hiddenClient = applyHumanActivityToRecommendations([pending], context([]), activity('Contacto por WhatsApp'));
  assert.equal(wrongActor.changed, 0);
  assert.equal(hiddenClient.changed, 0);
});

test('B1.4.2 J/K: telemetría cloud queda aislada del CRM, respeta scope y minimiza payload', () => {
  const crm = structuredClone(initialData);
  crm.organization.id = 'org-a';
  crm.activityLog = [activity('Seguimiento completado')];
  const cloudContext: CloudMembershipContext = {
    organizationId: 'org-a',
    currentMemberId: 1,
    currentRole: 'Corredor',
    members: crm.teamMembers.map((member) => ({ ...member, id: 1, role: 'Corredor', status: 'Activo' })),
  };
  const crmRows = crmToCloudRecords(crm, cloudContext, 'user-1');
  const recommendationRow = supervisedRecommendationCloudRow(shownRecord(), 'user-1');
  const rows = [...crmRows, recommendationRow];
  assert.equal(recommendationRow.organization_id, 'org-a');
  assert.equal(recommendationRow.assigned_member_id, 1);
  const payload = JSON.stringify(recommendationRow.payload);
  for (const sensitive of ['phone', 'email', 'notes', 'Dato sensible', '549351']) assert.equal(payload.includes(sensitive), false, sensitive);

  const loaded = cloudRecordsToCrm(rows, cloudContext, crm);
  assert.deepEqual(Object.keys(loaded).sort(), Object.keys(initialData).sort());
  assert.equal(loaded.activityLog.some((entry) => entry.action === 'Seguimiento completado'), true);
  assert.equal(loaded.activityLog.length, 1);

  const nextCrmRows = crmToCloudRecords(loaded, cloudContext, 'user-1');
  assert.equal(staleCloudRecords(rows, nextCrmRows).some((row) => row.entity_key === recommendationRow.entity_key), false);

  const cloudSource = readFileSync('src/cloud-api.ts', 'utf8');
  assert.match(cloudSource, /crmSyncRecords\(existing\)/);
  assert.match(cloudSource, /latestRemoteVersion\(crmSyncRecords\(refreshed\)\)/);
  assert.match(cloudSource, /const crmRecords = crmSyncRecords\(records\)/);
});

test('B1.4.2 cloud: primer shown y primera decisión sobreviven escrituras concurrentes del mismo ciclo', () => {
  const first = shownRecord();
  const later = {
    ...first,
    shownAt: '2026-08-19T12:03:00.000Z',
    humanDecision: 'modified' as const,
    decisionAt: '2026-08-19T12:05:00.000Z',
    actualAction: 'Seguimiento reprogramado',
  };
  const decided = mergeSupervisedRecommendationTelemetry(first, later);
  assert.equal(decided.shownAt, SHOWN_AT);
  assert.equal(decided.humanDecision, 'modified');

  const laterContradiction = {
    ...later,
    humanDecision: 'executed' as const,
    decisionAt: '2026-08-19T12:06:00.000Z',
    actualAction: 'Contacto por WhatsApp',
  };
  const stable = mergeSupervisedRecommendationTelemetry(decided, laterContradiction);
  assert.equal(stable.shownAt, SHOWN_AT);
  assert.equal(stable.humanDecision, 'modified');
  assert.equal(stable.decisionAt, '2026-08-19T12:05:00.000Z');
});

test('B1.4.2 L/M: recent y contrato Limpiar PR143 siguen sin ser alterados', () => {
  const source = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const initial = source.slice(source.indexOf('let filters: LeadListFilters'), source.indexOf('let expandedClientId'));
  const reset = source.slice(source.indexOf('function resetFilters()'), source.indexOf('function synchronizeFilterStateFromControls'));
  const active = source.slice(source.indexOf('function activeSecondaryFilters()'), source.indexOf('function filterPanel()'));
  assert.match(initial, /order:\s*'recent'/);
  assert.match(reset, /stage:\s*'Todas'/);
  assert.match(reset, /order:\s*'recent'/);
  assert.equal(active.includes('filters.order'), false);
  const instrumentation = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8');
  assert.equal(instrumentation.includes('filters.'), false);
});

test('B1.4.2 O/P: instrumentación no agrega CSS, overlays ni controles visuales', () => {
  const runtime = readFileSync('src/lead-recommendation-instrumentation.ts', 'utf8');
  assert.equal(runtime.includes('innerHTML'), false);
  assert.equal(runtime.includes('insertAdjacentHTML'), false);
  assert.equal(runtime.includes('position:'), false);
  const polish = readFileSync('src/lead-list-polish-ui.ts', 'utf8');
  assert.match(polish, /instrumentVisibleSupervisedRecommendations\(container\)/);
});

test('B1.4.2: ignored se difiere; nunca se infiere por tiempo o timeout', () => {
  const core = readFileSync('src/lead-recommendation-instrumentation-core.ts', 'utf8');
  assert.equal(core.includes("'ignored'"), false);
  assert.equal(core.includes('setTimeout'), false);
  assert.equal(core.includes('Date.now()'), false);
});
