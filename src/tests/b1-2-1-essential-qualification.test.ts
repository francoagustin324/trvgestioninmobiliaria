import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import {
  analyzeLeadQualification,
  applyQualificationReview,
  conversationQualificationText,
  qualificationInputText,
  type QualificationSuggestion,
} from '../lead-qualification.js';
import { commercialQualificationState } from '../lead-pipeline.js';
import { renderLeadCommercialSummary } from '../lead-essential-ui.js';
import type { Client, WhatsAppConversation } from '../models.js';
import {
  cloudRecordsToCrm,
  crmToCloudRecords,
  membershipContext,
  type CloudMembershipRow,
} from '../cloud-records.js';
import { initialData } from '../models.js';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 21,
    name: 'Edgardo',
    phone: '5493515550123',
    interest: '',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function byField(analysis: ReturnType<typeof analyzeLeadQualification>, field: string) {
  return analysis.suggestions.find((item) => item.field === field);
}

function accepted(item: QualificationSuggestion) {
  return { ...item, accepted: true };
}

test('caso Edgardo detecta la oportunidad comercial esencial y excluye preguntas de Franco', () => {
  const text = [
    'Edgardo: Hola, estoy buscando un dúplex en Manantiales.',
    'Franco: ¿Qué presupuesto manejás?',
    'Edgardo: Hasta USD 120.000, tengo una parte y necesitaría financiar el resto.',
    'Franco: ¿Es para vivir o invertir?',
    'Edgardo: Para vivir. Conozco la zona y podría avanzar este mes.',
  ].join('\n');
  const filtered = qualificationInputText(client(), text);
  assert.doesNotMatch(filtered, /Qué presupuesto|vivir o invertir/);
  assert.match(filtered, /USD 120\.000/);

  const analysis = analyzeLeadQualification(client(), text, 'whatsapp_text', new Date(2026, 6, 27));
  assert.equal(byField(analysis, 'budget')?.value, 'USD 120.000');
  assert.equal(byField(analysis, 'currency')?.value, 'USD');
  assert.equal(byField(analysis, 'paymentMethod')?.value, 'Combinación');
  assert.equal(byField(analysis, 'zones')?.value, 'Manantiales');
  assert.equal(byField(analysis, 'purpose')?.value, 'Vivir');
  assert.equal(byField(analysis, 'purchaseTimeframe')?.value, '0-3 meses');
  assert.equal(byField(analysis, 'urgency')?.value, 'Alta');
  assert.equal(byField(analysis, 'knowsArea')?.value, 'Sí');
  assert.equal(byField(analysis, 'canMoveForward')?.value, 'Sí');
  assert.equal(byField(analysis, 'propertyType')?.value, 'Dúplex');
  assert.equal(byField(analysis, 'interest')?.value, 'Dúplex en Manantiales');
  assert.equal(byField(analysis, 'pipeline')?.value, 'Calificado');
  assert.equal(analysis.missingQuestions.length, 1);
  assert.equal(analysis.missingQuestions[0], '¿Qué monto podrías entregar y cuánto necesitarías financiar?');
  assert.match(byField(analysis, 'budget')?.evidence || '', /USD 120\.000/);
  assert.doesNotMatch(byField(analysis, 'budget')?.evidence || '', /Qué presupuesto/);
  assert.equal(analysis.visitWarning, null);
});

test('reconoce estados reales del crédito y monto aprobado solo cuando aparece', () => {
  const approved = analyzeLeadQualification(client(), 'Tengo crédito hipotecario aprobado por USD 80.000.', 'notes_transcript');
  assert.equal(byField(approved, 'paymentMethod')?.value, 'Crédito hipotecario');
  assert.equal(byField(approved, 'creditPossible')?.value, 'Aprobado');
  assert.equal(byField(approved, 'creditApprovedAmount')?.value, 'USD 80.000');

  const inProcess = analyzeLeadQualification(client(), 'El crédito está en trámite, ya presenté los papeles.', 'notes_transcript');
  assert.equal(byField(inProcess, 'creditPossible')?.value, 'En trámite');
  assert.equal(byField(inProcess, 'creditApprovedAmount'), undefined);

  const notStarted = analyzeLeadQualification(client(), 'Todavía no inicié el crédito hipotecario.', 'notes_transcript');
  assert.equal(byField(notStarted, 'creditPossible')?.value, 'Todavía no iniciado');
});

test('apto crédito de la propiedad es secundario y no inventa estado del crédito del comprador', () => {
  const analysis = analyzeLeadQualification(client(), 'Necesito que el dúplex sea apto crédito.', 'notes_transcript');
  assert.equal(byField(analysis, 'requiresCreditReady')?.value, 'Sí');
  assert.equal(byField(analysis, 'propertyType')?.value, 'Dúplex');
  assert.equal(byField(analysis, 'creditPossible'), undefined);
});

test('distingue contado, financiación y combinación', () => {
  const cash = analyzeLeadQualification(client(), 'Pago de contado.', 'notes_transcript');
  assert.equal(byField(cash, 'paymentMethod')?.value, 'Contado');
  assert.equal(byField(cash, 'creditPossible')?.value, 'No necesita');

  const financing = analyzeLeadQualification(client(), 'Necesito financiación en cuotas.', 'notes_transcript');
  assert.equal(byField(financing, 'paymentMethod')?.value, 'Financiación');
  assert.equal(byField(financing, 'needsFinancing')?.value, 'Sí');

  const combination = analyzeLeadQualification(client(), 'Tengo una parte de contado y financiaría el resto.', 'notes_transcript');
  assert.equal(byField(combination, 'paymentMethod')?.value, 'Combinación');
});

test('clasifica capacidad y plazo sin exigir datos secundarios', () => {
  const sell = analyzeLeadQualification(client(), 'Primero tengo que vender y recién después podría comprar.', 'notes_transcript');
  assert.equal(byField(sell, 'canMoveForward')?.value, 'Depende de vender');

  const noRush = analyzeLeadQualification(client(), 'Estoy averiguando sin apuro.', 'notes_transcript');
  assert.equal(byField(noRush, 'purchaseTimeframe')?.value, 'Sin apuro');
  assert.equal(byField(noRush, 'urgency')?.value, 'Baja');

  const urgent = analyzeLeadQualification(client(), 'Necesito comprar cuanto antes.', 'notes_transcript');
  assert.equal(byField(urgent, 'purchaseTimeframe')?.value, 'Inmediato');
  assert.equal(byField(urgent, 'urgency')?.value, 'Alta');
});

test('un Lead queda Calificado sin dormitorios, objeciones ni características', () => {
  const qualified = client({
    budget: 'USD 120.000',
    currency: 'USD',
    paymentMethod: 'Contado',
    creditPossible: 'No necesita',
    zones: 'Manantiales',
    purpose: 'Vivir',
    purchaseTimeframe: '0-3 meses',
    canMoveForward: 'Sí',
  });
  assert.equal(commercialQualificationState(qualified).state, 'Calificado');
  assert.equal(qualified.bedrooms, undefined);
  assert.equal(qualified.objections, undefined);
});

test('la próxima pregunta es única, breve y priorizada', () => {
  const empty = analyzeLeadQualification(client(), 'Hola, estoy buscando.', 'whatsapp_text');
  assert.deepEqual(empty.missingQuestions, ['¿Qué presupuesto aproximado manejás?']);

  const budgetOnly = analyzeLeadQualification(client(), 'Manejo USD 100.000.', 'whatsapp_text');
  assert.deepEqual(budgetOnly.missingQuestions, ['¿La compra sería de contado, con crédito o necesitás financiación?']);

  const credit = analyzeLeadQualification(client(), 'Manejo USD 100.000 y usaría crédito hipotecario.', 'whatsapp_text');
  assert.deepEqual(credit.missingQuestions, ['¿El crédito ya está aprobado o todavía está en trámite?']);
});

test('un pedido de visita sin presupuesto ni forma de pago sigue sin estar Calificado', () => {
  const analysis = analyzeLeadQualification(client(), '¿Podemos ver el dúplex mañana?', 'whatsapp_text', new Date(2026, 6, 27));
  assert.equal(byField(analysis, 'pipeline')?.value, 'Contactado');
  assert.equal(analysis.visitWarning, 'Conviene confirmar presupuesto y forma de pago antes de coordinar.');
  assert.ok(analysis.visitMissingFields.includes('presupuesto'));
});

test('texto sin interlocutores se analiza completo', () => {
  const text = 'Busco casa en Docta para invertir. Presupuesto USD 90.000, contado, puedo avanzar en 3 meses.';
  assert.equal(qualificationInputText(client(), text), text);
  const analysis = analyzeLeadQualification(client(), text, 'notes_transcript');
  assert.equal(byField(analysis, 'zones')?.value, 'Docta');
  assert.equal(byField(analysis, 'purpose')?.value, 'Invertir');
});

test('conversación interna utiliza solamente mensajes inbound del cliente', () => {
  const conversation: WhatsAppConversation = {
    id: 9,
    clientId: 21,
    phone: '5493515550123',
    mode: 'Humano',
    unread: 0,
    lastActivity: '2026-07-27T12:00:00.000Z',
    messages: [
      { id: 1, direction: 'outbound', sender: 'Humano', text: 'El precio es USD 200.000 y es para invertir.', createdAt: '2026-07-27T10:00:00.000Z' },
      { id: 2, direction: 'inbound', sender: 'Cliente', text: 'Mi presupuesto es USD 120.000 y es para vivir.', createdAt: '2026-07-27T11:00:00.000Z' },
    ],
  };
  const text = conversationQualificationText(conversation);
  assert.doesNotMatch(text, /200\.000|invertir/);
  assert.match(text, /120\.000|vivir/);
});

test('analizar no guarda y aplicar conserva supervisión y trazabilidad de cambios', () => {
  const original = client({ budget: 'USD 120.000', currency: 'USD' });
  const snapshot = structuredClone(original);
  const analysis = analyzeLeadQualification(original, 'Hasta USD 120.000, contado, en Manantiales para vivir y puedo avanzar este mes.', 'whatsapp_text');
  assert.deepEqual(original, snapshot);

  const reviewed = analysis.suggestions.map((item) => ({ ...item, accepted: ['budget', 'currency', 'paymentMethod', 'zones', 'purpose', 'purchaseTimeframe', 'canMoveForward'].includes(item.field) }));
  const result = applyQualificationReview(original, reviewed, false, new Date('2026-07-27T12:00:00.000Z'));
  assert.equal(result.client.paymentMethod, 'Contado');
  assert.equal(result.client.zones, 'Manantiales');
  assert.ok(result.alreadyConfirmedFields.includes('budget'));
  assert.ok(result.appliedFields.includes('paymentMethod'));
  assert.equal(result.client.qualificationUpdatedAt, '2026-07-27T12:00:00.000Z');
});

test('campos esenciales y secundarios persisten en payload cloud', () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const memberships: CloudMembershipRow[] = [{
    organization_id: organizationId,
    member_id: 1,
    user_id: 'owner-user',
    role: 'owner',
    status: 'active',
    display_name: 'Franco',
    email: 'franco@example.com',
  }];
  const context = membershipContext(memberships, 'owner-user');
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.teamMembers = context.members;
  crm.clients = [client({
    paymentMethod: 'Crédito hipotecario',
    creditPossible: 'Aprobado',
    creditApprovedAmount: 'USD 80.000',
    requiresCreditReady: 'Sí',
    garage: 'Sí',
    preferences: 'Barrio tranquilo',
  })];
  crm.properties = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.activityLog = [];
  const rows = crmToCloudRecords(crm, context, 'owner-user');
  const restored = cloudRecordsToCrm(rows, context, structuredClone(crm));
  assert.equal(restored.clients[0]?.creditPossible, 'Aprobado');
  assert.equal(restored.clients[0]?.creditApprovedAmount, 'USD 80.000');
  assert.equal(restored.clients[0]?.requiresCreditReady, 'Sí');
  assert.equal(restored.clients[0]?.garage, 'Sí');
});

test('la interfaz usa estado comercial simple y mensaje posterior legible', () => {
  const leads = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const qualificationUi = readFileSync('src/lead-qualification-ui.ts', 'utf8');
  assert.match(leads, /renderLeadCommercialSummary/);
  assert.doesNotMatch(leads, /Calificación \$\{qualification\.completed\}\/\$\{qualification\.total\}/);
  assert.match(qualificationUi, /datos nuevos guardados/);
  assert.match(qualificationUi, /ya estaban confirmados/);
  assert.match(qualificationUi, /requiere revisión/);
  assert.match(qualificationUi, /Próxima pregunta/);
});

test('resumen comercial esencial no desborda en móvil ni escritorio', { timeout: 120_000 }, async (t) => {
  const executable = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find(existsSync);
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chrome para validar B1.2.1.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  try {
    const css = `${readFileSync('src/mvp.css', 'utf8')}\n${readFileSync('src/lead-pipeline.css', 'utf8')}\n${readFileSync('src/lead-qualification.css', 'utf8')}`;
    const html = renderLeadCommercialSummary(client({
      budget: 'USD 120.000', currency: 'USD', paymentMethod: 'Combinación', creditPossible: 'En trámite',
      zones: 'Manantiales', purpose: 'Vivir', purchaseTimeframe: '0-3 meses', canMoveForward: 'Sí', knowsArea: 'Sí',
    }));
    for (const width of [430, 720, 1366]) {
      const page = await browser.newPage({ viewport: { width, height: width === 1366 ? 768 : 920 } });
      await page.setContent(`<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0}.mvp-content{width:100%;padding:16px}${css}</style></head><body><main class="mvp-content"><article class="mvp-lead-card mvp-lead-card-with-matches">${html}</article></main></body></html>`);
      const result = await page.evaluate(() => ({
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        cardWidth: document.querySelector<HTMLElement>('.mvp-lead-card')?.getBoundingClientRect().width || 0,
      }));
      assert.ok(result.scrollWidth <= result.viewport + 1, `Desborde en ${width}px: ${JSON.stringify(result)}`);
      assert.ok(result.cardWidth <= result.viewport, `Tarjeta demasiado ancha en ${width}px.`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
