import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { buildAgendaItems } from '../agenda.js';
import { clientFromFormValues } from '../client-editor.js';
import {
  activitiesForClientSave,
  applyCommercialStage,
  commercialStage,
  completeClientFollowUp,
  filterLeads,
  isTerminalClient,
  normalizeCommercialStage,
  qualificationProgress,
  reprogramClientFollowUp,
  stageCounters,
} from '../lead-pipeline.js';
import { initialData, type Client } from '../models.js';
import { evaluatePropertyMatch } from '../property-matching.js';
import { assignmentVisible } from '../team-policy.js';
import {
  cloudRecordsToCrm,
  crmToCloudRecords,
  membershipContext,
  type CloudMembershipRow,
} from '../cloud-records.js';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 7,
    name: 'Ana Compradora',
    phone: '5493515550101',
    email: 'ana@example.com',
    interest: 'Departamento de 2 dormitorios en General Paz con balcón',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Calificado',
    budget: 'USD 100.000',
    paymentMethod: 'Contado',
    purchaseTimeframe: '1-3 meses',
    purpose: 'Vivir',
    knowsArea: 'Sí',
    canMoveForward: 'Sí',
    objections: 'Necesita buena luz natural',
    notes: 'Prefiere piso alto',
    nextAction: 'Confirmar horarios para visita',
    nextFollowUp: '2026-07-30',
    assignedToId: 2,
    createdById: 1,
    ...overrides,
  };
}

const fullValues: Record<string, string> = {
  name: ' Ana Compradora ',
  phone: '351 555 0101',
  email: 'ana@example.com',
  interest: 'Departamento de 2 dormitorios en General Paz con balcón',
  temperature: 'Caliente',
  pipeline: 'Visita coordinada',
  budget: 'USD 100.000',
  paymentMethod: 'Contado',
  purchaseTimeframe: '1-3 meses',
  purpose: 'Vivir',
  knowsArea: 'Sí',
  canMoveForward: 'Sí',
  objections: 'Necesita buena luz natural',
  notes: 'Prefiere piso alto',
  nextAction: 'Confirmar horarios para visita',
  nextFollowUp: '2026-07-30',
};

test('crea y edita un lead con todos los campos comerciales sin perder datos', () => {
  const created = clientFromFormValues(7, fullValues);
  assert.equal(created.pipeline, 'Visita coordinada');
  assert.equal(created.nextAction, 'Confirmar horarios para visita');
  assert.equal(created.nextFollowUp, '2026-07-30');
  assert.equal(created.paymentMethod, 'Contado');
  assert.equal(created.purchaseTimeframe, '1-3 meses');
  assert.equal(created.purpose, 'Vivir');
  assert.equal(created.knowsArea, 'Sí');
  assert.equal(created.canMoveForward, 'Sí');
  assert.equal(created.objections, 'Necesita buena luz natural');
  assert.equal(created.notes, 'Prefiere piso alto');

  const edited = clientFromFormValues(7, {
    ...fullValues,
    pipeline: 'Negociación',
    nextAction: 'Solicitar propuesta formal',
    nextFollowUp: '2026-08-02',
  }, created);
  assert.equal(edited.pipeline, 'Negociación');
  assert.equal(edited.nextAction, 'Solicitar propuesta formal');
  assert.equal(edited.budget, created.budget);
  assert.equal(edited.notes, created.notes);
});

test('los leads históricos sin campos nuevos siguen siendo compatibles', () => {
  const historical: Client = {
    id: 8,
    name: 'Lead histórico',
    phone: '5493515550000',
    interest: 'Casa en Córdoba',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Visita posible',
  };
  assert.equal(commercialStage(historical), 'Visita coordinada');
  assert.deepEqual(qualificationProgress(historical), {
    completed: 1,
    total: 8,
    missing: ['presupuesto', 'forma de pago', 'plazo', 'finalidad', 'conocimiento de zona', 'capacidad de avance', 'condicionantes'],
  });
  assert.doesNotThrow(() => filterLeads([historical], {
    search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false,
  }));
});

test('normaliza exactamente las ocho etapas y estados históricos', () => {
  assert.deepEqual([
    'Nuevo', 'Contactado', 'Calificado', 'Visita coordinada', 'Negociación', 'Reservado', 'Ganado', 'Perdido',
  ].map(normalizeCommercialStage), [
    'Nuevo', 'Contactado', 'Calificado', 'Visita coordinada', 'Negociación', 'Reservado', 'Ganado', 'Perdido',
  ]);
  assert.equal(normalizeCommercialStage('Visita posible'), 'Visita coordinada');
  assert.equal(normalizeCommercialStage('Ganada'), 'Ganado');
  assert.equal(normalizeCommercialStage('Perdida'), 'Perdido');
  assert.equal(normalizeCommercialStage('Cerrado'), 'Ganado');
});

test('los filtros combinan etapa, temperatura, vencidos y falta de próxima acción', () => {
  const rows = [
    client({ id: 1, pipeline: 'Nuevo', temperature: 'Frío', nextAction: undefined, nextFollowUp: undefined }),
    client({ id: 2, pipeline: 'Contactado', temperature: 'Caliente', nextFollowUp: '2026-07-20' }),
    client({ id: 3, pipeline: 'Ganado', temperature: 'Caliente', nextFollowUp: undefined, nextAction: undefined }),
  ];
  assert.deepEqual(filterLeads(rows, {
    search: '', stage: 'Contactado', temperature: 'Caliente', overdueOnly: true, missingNextActionOnly: false,
  }, '2026-07-27').map((item) => item.id), [2]);
  assert.deepEqual(filterLeads(rows, {
    search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: true,
  }, '2026-07-27').map((item) => item.id), [1]);
  assert.equal(stageCounters(rows).Ganado, 1);
});

test('la visibilidad de corredor se mantiene por asignación y superiores ven todo', () => {
  const rows = [client({ id: 1, assignedToId: 2 }), client({ id: 2, assignedToId: 3 })];
  assert.deepEqual(rows.filter((item) => assignmentVisible('Corredor', 2, item.assignedToId)).map((item) => item.id), [1]);
  assert.deepEqual(rows.filter((item) => assignmentVisible('Administrador', 9, item.assignedToId)).map((item) => item.id), [1, 2]);
  assert.deepEqual(rows.filter((item) => assignmentVisible('Dueño', 1, item.assignedToId)).map((item) => item.id), [1, 2]);
});

test('Ganado y Perdido limpian la única próxima acción y conservan el objeto histórico', () => {
  const won = applyCommercialStage(client(), 'Ganado');
  const lost = applyCommercialStage(client(), 'Perdido');
  assert.equal(won.status, 'Operación ganada');
  assert.equal(lost.status, 'Operación perdida');
  assert.equal(won.nextFollowUp, undefined);
  assert.equal(won.nextAction, undefined);
  assert.equal(lost.nextFollowUp, undefined);
  assert.equal(isTerminalClient(won), true);
  assert.equal(isTerminalClient(lost), true);
  assert.equal(won.name, 'Ana Compradora');
  assert.equal(lost.notes, 'Prefiere piso alto');
});

test('Agenda genera un único seguimiento automático por lead y ningún Reminder adicional', () => {
  const lead = client();
  const reminders = [{ id: 99, date: '2026-07-30', title: 'Tarea manual', related: 'Otro asunto', priority: 'Media' }];
  const snapshot = structuredClone(reminders);
  const items = buildAgendaItems([lead], reminders, '2026-07-27');
  assert.equal(items.filter((item) => item.id === `client-${lead.id}`).length, 1);
  assert.equal(items.filter((item) => item.source === 'reminder').length, 1);
  assert.deepEqual(reminders, snapshot);
  assert.equal(buildAgendaItems([applyCommercialStage(lead, 'Ganado')], [], '2026-07-27').length, 0);
});

test('reprogramar cambia solo la fecha y completar actualiza contacto y limpia acción', () => {
  const original = client();
  const reprogrammed = reprogramClientFollowUp(original, '2026-08-05');
  assert.equal(reprogrammed.client.nextFollowUp, '2026-08-05');
  assert.equal(reprogrammed.client.nextAction, original.nextAction);
  assert.equal(reprogrammed.client.notes, original.notes);
  assert.equal(reprogrammed.activity.action, 'Seguimiento reprogramado');

  const completed = completeClientFollowUp(reprogrammed.client, new Date(2026, 6, 27, 12, 0));
  assert.equal(completed.client.lastContact, '2026-07-27');
  assert.equal(completed.client.nextFollowUp, undefined);
  assert.equal(completed.client.nextAction, undefined);
  assert.equal(completed.activity.action, 'Seguimiento completado');
  assert.match(completed.activity.detail, /Confirmar horarios/);
});

test('activityLog recibe creación, etapa, programación, reprogramación y terminales', () => {
  const created = client({ pipeline: 'Nuevo' });
  const creation = activitiesForClientSave(null, created);
  assert.ok(creation.some((entry) => entry.action === 'Lead creado'));
  assert.ok(creation.some((entry) => entry.action === 'Próxima acción programada'));

  const negotiated = client({ pipeline: 'Negociación', nextFollowUp: '2026-08-01' });
  const changes = activitiesForClientSave(created, negotiated);
  assert.ok(changes.some((entry) => entry.action === 'Cambio de etapa'));
  assert.ok(changes.some((entry) => entry.action === 'Seguimiento reprogramado'));

  const won = applyCommercialStage(negotiated, 'Ganado');
  const terminal = activitiesForClientSave(negotiated, won);
  assert.ok(terminal.some((entry) => entry.action === 'Operación ganada'));
});

test('nextAction persiste en el payload cloud y vuelve sin pérdida', () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const memberships: CloudMembershipRow[] = [{
    organization_id: organizationId,
    member_id: 2,
    user_id: 'agent-user',
    role: 'agent',
    status: 'active',
    display_name: 'Corredor',
    email: 'agent@example.com',
  }];
  const context = membershipContext(memberships, 'agent-user');
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.teamMembers = context.members;
  crm.clients = [client({ assignedToId: 2, createdById: 2 })];
  crm.properties = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.activityLog = [];
  const rows = crmToCloudRecords(crm, context, 'agent-user');
  const payload = rows.find((row) => row.entity_type === 'client')?.payload as Client;
  assert.equal(payload.nextAction, 'Confirmar horarios para visita');
  const restored = cloudRecordsToCrm(rows, context, structuredClone(crm));
  assert.equal(restored.clients[0]?.nextAction, 'Confirmar horarios para visita');
  assert.equal(restored.clients[0]?.nextFollowUp, '2026-07-30');
});

test('matching usa la calificación visible y excluye Ganado y Perdido', () => {
  const property = {
    id: 1,
    title: 'Departamento con balcón',
    address: 'General Paz, Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 95000,
    owner: 'Propietario',
    status: 'Activa',
    bedrooms: 2,
    paymentMethod: 'Contado',
    features: 'Balcón y luz natural',
  };
  assert.ok(evaluatePropertyMatch(client(), property));
  assert.equal(evaluatePropertyMatch(applyCommercialStage(client(), 'Ganado'), property), null);
  assert.equal(evaluatePropertyMatch(applyCommercialStage(client(), 'Perdido'), property), null);
});

test('la implementación usa visibles y no crea Reminder automático desde Leads', () => {
  const leadsUi = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const agendaUi = readFileSync('src/agenda-ui.ts', 'utf8');
  const matching = readFileSync('src/property-matching.ts', 'utf8');
  assert.match(leadsUi, /visibleClients\(\)/);
  assert.match(agendaUi, /visibleClients\(\)/);
  assert.match(agendaUi, /visibleReminders\(\)/);
  assert.doesNotMatch(leadsUi, /state\.crm\.reminders|nextId\(state\.crm\.reminders\)/);
  assert.match(agendaUi, /completeClientFollowUp/);
  assert.match(agendaUi, /reprogramClientFollowUp/);
  assert.match(matching, /isTerminalClient/);
});

test('el layout real no desborda en 430, 720 ni 1366 px', { timeout: 120_000 }, async (t) => {
  const executable = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find(existsSync);
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone un navegador Chromium para validar B1.1.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  try {
    const css = `${readFileSync('src/mvp.css', 'utf8')}\n${readFileSync('src/lead-pipeline.css', 'utf8')}`;
    for (const width of [430, 720, 1366]) {
      const page = await browser.newPage({ viewport: { width, height: width === 1366 ? 768 : 900 } });
      await page.setContent(`<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0}.mvp-content{width:100%;padding:16px}.mvp-contact-btn{display:inline-grid;width:44px;height:44px}.mvp-icon-btn{width:44px;height:44px}${css}</style></head><body><main class="mvp-content"><form class="mvp-lead-form collapsed"><label>Nombre<input></label></form><div class="mvp-lead-filter-panel"><div class="mvp-lead-filter-grid"><label><span>Buscar</span><input></label><label><span>Etapa</span><select><option>Todas</option></select></label><label><span>Temperatura</span><select><option>Todas</option></select></label></div><div class="mvp-lead-filter-toggles"><label><input type="checkbox">Seguimiento vencido</label></div><div class="mvp-stage-counters"><button class="mvp-stage-counter">Nuevo <b>4</b></button><button class="mvp-stage-counter">Visita coordinada <b>2</b></button><button class="mvp-stage-counter">Negociación <b>1</b></button></div></div><article class="mvp-lead-card mvp-lead-card-with-matches"><div class="mvp-lead-card-main"><div class="mvp-lead-main-copy"><div class="mvp-lead-title-line"><h3>Lead de validación visual con nombre extenso</h3><span class="mvp-stage-badge">Calificado</span></div><p>Busca departamento de dos dormitorios en General Paz</p></div><div class="mvp-lead-actions"><button class="mvp-icon-btn">E</button><button class="mvp-icon-btn">×</button></div></div><div class="mvp-lead-critical"><div><span>Próxima acción</span><strong>Confirmar fondos y coordinar una visita</strong></div><div><span>Fecha</span><strong>2026-07-30</strong></div><div><span>Responsable</span><strong>Corredor</strong></div></div><div class="mvp-lead-summary"><div><span>Presupuesto</span><strong>USD 100.000</strong></div><div><span>Forma de pago</span><strong>Contado</strong></div><div><span>Plazo</span><strong>1-3 meses</strong></div><div><span>Finalidad</span><strong>Vivir</strong></div></div><div class="mvp-qualification"><strong>Calificación 8/8</strong><small>Calificación completa</small></div><details class="mvp-lead-history"><summary>Últimos movimientos</summary></details></article></main></body></html>`);
      const result = await page.evaluate(() => ({
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        cardWidth: document.querySelector<HTMLElement>('.mvp-lead-card')?.getBoundingClientRect().width || 0,
        minButtonHeight: Math.min(...Array.from(document.querySelectorAll('button')).map((button) => button.getBoundingClientRect().height)),
        formHidden: getComputedStyle(document.querySelector<HTMLElement>('.mvp-lead-form')!).display === 'none',
      }));
      assert.ok(result.scrollWidth <= result.viewport + 1, `Desborde horizontal en ${width}px: ${JSON.stringify(result)}`);
      assert.ok(result.cardWidth <= result.viewport, `Tarjeta demasiado ancha en ${width}px.`);
      assert.ok(result.minButtonHeight >= 40, `Botón demasiado pequeño en ${width}px.`);
      assert.equal(result.formHidden, true);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
