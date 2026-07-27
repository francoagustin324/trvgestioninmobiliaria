import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import {
  analyzeLeadQualification,
  applyQualificationReview,
  conversationQualificationText,
  missingQualificationQuestions,
  qualificationActivities,
  suggestionBlockedByConfirmedValue,
  type QualificationSuggestion,
} from '../lead-qualification.js';
import { mergeQualificationSuggestions } from '../lead-qualification-ai-client.js';
import { sanitizeIntelligentSuggestions } from '../server/lead-qualification-ai.js';
import type { Client, WhatsAppConversation } from '../models.js';
import { evaluatePropertyMatch } from '../property-matching.js';
import {
  cloudRecordsToCrm,
  crmToCloudRecords,
  membershipContext,
  type CloudMembershipRow,
} from '../cloud-records.js';
import { initialData } from '../models.js';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 7,
    name: 'Lead prueba',
    phone: '5493515550101',
    interest: '',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    assignedToId: 2,
    createdById: 1,
    ...overrides,
  };
}

function byField(analysis: ReturnType<typeof analyzeLeadQualification>, field: string) {
  return analysis.suggestions.find((item) => item.field === field);
}

function accepted(item: QualificationSuggestion, editedValue?: string) {
  return { ...item, accepted: true, editedValue };
}

test('extrae una conversación completa sin inventar campos ausentes', () => {
  const text = [
    'Mi nombre es Ana Pérez y mi WhatsApp es +54 9 351 555 0101.',
    'Busco departamento de 2 dormitorios en General Paz o Cofico para vivir.',
    'Manejo USD 120.000 y la compra sería de contado.',
    'Quiero comprar en 3 meses, conozco bien la zona y tengo los fondos para avanzar.',
    'Necesito que tenga cochera. Me gustaría coordinar una visita el 30/07/2026.',
  ].join('\n');
  const analysis = analyzeLeadQualification(client(), text, 'whatsapp_text', new Date(2026, 6, 27));
  assert.equal(byField(analysis, 'name')?.value, 'Ana Pérez');
  assert.equal(byField(analysis, 'phone')?.value, '5493515550101');
  assert.match(byField(analysis, 'zones')?.value || '', /General Paz/);
  assert.match(byField(analysis, 'zones')?.value || '', /Cofico/);
  assert.equal(byField(analysis, 'propertyType')?.value, 'Departamento');
  assert.equal(byField(analysis, 'bedrooms')?.value, '2');
  assert.equal(byField(analysis, 'budget')?.value, 'USD 120.000');
  assert.equal(byField(analysis, 'currency')?.value, 'USD');
  assert.equal(byField(analysis, 'paymentMethod')?.value, 'Contado');
  assert.equal(byField(analysis, 'purpose')?.value, 'Vivir');
  assert.equal(byField(analysis, 'purchaseTimeframe')?.value, '1-3 meses');
  assert.equal(byField(analysis, 'knowsArea')?.value, 'Sí');
  assert.equal(byField(analysis, 'canMoveForward')?.value, 'Sí');
  assert.match(byField(analysis, 'objections')?.value || '', /cochera/i);
  assert.equal(byField(analysis, 'nextAction')?.value, 'Coordinar una visita');
  assert.equal(byField(analysis, 'nextFollowUp')?.value, '2026-07-30');
  assert.equal(byField(analysis, 'pipeline')?.value, 'Visita coordinada');
  assert.equal(analysis.visitWarning, null);
});

test('una conversación parcial solo genera datos presentes y preguntas concretas', () => {
  const analysis = analyzeLeadQualification(client(), 'Hola, busco una casa en Docta para invertir.', 'conversation');
  assert.equal(byField(analysis, 'propertyType')?.value, 'Casa');
  assert.equal(byField(analysis, 'zones')?.value, 'Docta');
  assert.equal(byField(analysis, 'purpose')?.value, 'Invertir');
  assert.equal(byField(analysis, 'budget'), undefined);
  assert.equal(analysis.missingQuestions.length, 3);
  assert.equal(analysis.missingQuestions[0], '¿Qué presupuesto manejás y en qué moneda?');
  assert.equal(analysis.missingQuestions[1], '¿La compra sería de contado, con crédito o necesitás financiación?');
  assert.ok(analysis.visitWarning);
});

test('interpreta presupuestos inmobiliarios seguros y conserva la moneda explícita', () => {
  const cases: Array<[string, string]> = [
    ['Mi teléfono es 351 555 0101. Manejo USD 120.000.', 'USD 120.000'],
    ['Tengo 120 mil dólares.', 'USD 120.000'],
    ['El presupuesto es 120k USD.', 'USD 120.000'],
    ['Busco entre 110 y 130, en dólares.', 'USD 110.000–130.000'],
    ['Puedo hacer una entrega de USD 80.000 y cuotas.', 'Entrega USD 80.000 + cuotas'],
  ];
  cases.forEach(([text, expected]) => {
    const analysis = analyzeLeadQualification(client(), text, 'whatsapp_text');
    assert.equal(byField(analysis, 'budget')?.value, expected, text);
  });
});

test('no asume moneda y marca importes ambiguos para confirmar', () => {
  const noCurrency = analyzeLeadQualification(client(), 'Mi presupuesto es 120k.', 'whatsapp_text');
  assert.equal(byField(noCurrency, 'budget')?.value, '120.000');
  assert.equal(byField(noCurrency, 'currency'), undefined);
  assert.equal(byField(noCurrency, 'budget')?.ambiguous, true);

  const bare = analyzeLeadQualification(client(), 'Puedo pagar 1200000.', 'whatsapp_text');
  assert.equal(byField(bare, 'budget')?.value, '1.200.000');
  assert.equal(byField(bare, 'budget')?.ambiguous, true);
  assert.match(byField(bare, 'budget')?.warning || '', /confirmación|confirmar/i);

  const partial = analyzeLeadQualification(client(), 'Tengo 100 y puedo financiar el resto.', 'whatsapp_text');
  assert.equal(byField(partial, 'budget')?.value, '100.000 disponibles + resto financiado');
  assert.equal(byField(partial, 'needsFinancing')?.value, 'Sí');
  assert.equal(byField(partial, 'paymentMethod')?.value, 'Financiación');
  assert.equal(byField(partial, 'budget')?.ambiguous, true);
});

test('distingue contado, crédito y financiación', () => {
  assert.equal(byField(analyzeLeadQualification(client(), 'Compro de contado.', 'notes_transcript'), 'paymentMethod')?.value, 'Contado');
  assert.equal(byField(analyzeLeadQualification(client(), 'Tengo crédito hipotecario preaprobado.', 'notes_transcript'), 'paymentMethod')?.value, 'Crédito hipotecario');
  assert.equal(byField(analyzeLeadQualification(client(), 'Necesito financiación en cuotas.', 'notes_transcript'), 'needsFinancing')?.value, 'Sí');
});

test('distingue finalidad vivir e invertir', () => {
  assert.equal(byField(analyzeLeadQualification(client(), 'Es para vivir con mi familia.', 'notes_transcript'), 'purpose')?.value, 'Vivir');
  assert.equal(byField(analyzeLeadQualification(client(), 'Lo quiero para invertir y obtener renta.', 'notes_transcript'), 'purpose')?.value, 'Invertir');
});

test('un pedido prematuro de visita no se convierte en Calificado', () => {
  const analysis = analyzeLeadQualification(client(), 'Hola, ¿se puede ver el departamento mañana?', 'conversation', new Date(2026, 6, 27));
  assert.equal(byField(analysis, 'pipeline')?.value, 'Contactado');
  assert.equal(byField(analysis, 'nextAction')?.value, 'Coordinar una visita');
  assert.equal(byField(analysis, 'nextFollowUp')?.value, '2026-07-28');
  assert.equal(analysis.visitWarning, 'Faltan datos para considerar este Lead calificado para visita.');
  assert.ok(analysis.visitMissingFields.includes('presupuesto o rango'));
});

test('Visita coordinada exige confirmación explícita y fecha', () => {
  const unconfirmed = analyzeLeadQualification(client(), 'Quiero ver la casa el 30/07/2026.', 'conversation');
  assert.equal(byField(unconfirmed, 'pipeline')?.value, 'Contactado');
  const confirmed = analyzeLeadQualification(client(), 'Visita confirmada para el 30/07/2026.', 'conversation');
  assert.equal(byField(confirmed, 'pipeline')?.value, 'Visita coordinada');
});

test('Negociación exige precio, oferta o condiciones reales', () => {
  const analysis = analyzeLeadQualification(client(), 'Te hago una oferta de USD 110.000 y revisamos las condiciones de pago.', 'conversation');
  assert.equal(byField(analysis, 'pipeline')?.value, 'Negociación');
});

test('analizar no modifica el Lead y aplicar requiere confirmación', () => {
  const original = client();
  const snapshot = structuredClone(original);
  const analysis = analyzeLeadQualification(original, 'Busco departamento en Cofico. Presupuesto USD 90.000, contado.', 'whatsapp_text');
  assert.deepEqual(original, snapshot);
  const reviewed = analysis.suggestions.map((item) => ({ ...item, accepted: false }));
  const ignored = applyQualificationReview(original, reviewed);
  assert.deepEqual(ignored.client, snapshot);
  const chosen = analysis.suggestions.filter((item) => ['zones', 'budget', 'currency', 'paymentMethod'].includes(item.field)).map((item) => accepted(item));
  const applied = applyQualificationReview(original, chosen);
  assert.equal(applied.client.zones, 'Cofico');
  assert.equal(applied.client.budget, 'USD 90.000');
  assert.equal(applied.client.paymentMethod, 'Contado');
});

test('un dato confirmado no se sobrescribe con menor confianza', () => {
  const original = client({ budget: 'USD 150.000', currency: 'USD' });
  const suggestion: QualificationSuggestion = {
    id: 'budget-low', field: 'budget', label: 'Presupuesto', value: 'USD 100.000',
    confidence: 'Baja', confidenceScore: 40, evidence: 'Creo que eran cien.', ambiguous: true,
  };
  assert.equal(suggestionBlockedByConfirmedValue(original, suggestion), true);
  const result = applyQualificationReview(original, [accepted(suggestion)]);
  assert.equal(result.client.budget, 'USD 150.000');
  assert.deepEqual(result.blockedFields, ['budget']);
});

test('editar y confirmar humanamente permite aplicar un valor ambiguo', () => {
  const original = client({ budget: 'USD 150.000', currency: 'USD' });
  const suggestion: QualificationSuggestion = {
    id: 'budget-edit', field: 'budget', label: 'Presupuesto', value: '100',
    confidence: 'Baja', confidenceScore: 40, evidence: 'Tengo 100.', ambiguous: true,
  };
  const result = applyQualificationReview(original, [{
    ...suggestion,
    accepted: true,
    editedValue: 'USD 100.000',
    confidence: 'Alta',
    confidenceScore: 100,
    ambiguous: false,
    allowConfirmedOverwrite: true,
  }]);
  assert.equal(result.client.budget, 'USD 100.000');
});

test('las preguntas faltantes respetan prioridad y máximo de tres', () => {
  const questions = missingQualificationQuestions(client(), []);
  assert.equal(questions.length, 3);
  assert.deepEqual(questions, [
    '¿Qué presupuesto manejás y en qué moneda?',
    '¿La compra sería de contado, con crédito o necesitás financiación?',
    '¿La propiedad sería para vivir, invertir o para otra finalidad?',
  ]);
});

test('Ganado y Perdido siempre requieren confirmación humana', () => {
  const wonAnalysis = analyzeLeadQualification(client(), 'La operación está cerrada, ya compré.', 'conversation');
  const won = byField(wonAnalysis, 'pipeline')!;
  assert.equal(won.value, 'Ganado');
  assert.equal(won.terminalConfirmationRequired, true);
  assert.equal(applyQualificationReview(client(), [accepted(won)], false).client.pipeline, 'Nuevo');
  assert.equal(applyQualificationReview(client(), [accepted(won)], true).client.pipeline, 'Ganado');

  const lostAnalysis = analyzeLeadQualification(client(), 'Compré por otro lado, no busco más.', 'conversation');
  const lost = byField(lostAnalysis, 'pipeline')!;
  assert.equal(lost.value, 'Perdido');
  assert.equal(applyQualificationReview(client(), [accepted(lost)], false).client.pipeline, 'Nuevo');
  assert.equal(applyQualificationReview(client(), [accepted(lost)], true).client.pipeline, 'Perdido');
});

test('la temperatura muestra una razón basada en señales observables', () => {
  const hot = analyzeLeadQualification(client(), 'Es urgente. Tengo USD 120.000, pago contado y puedo avanzar.', 'conversation');
  assert.equal(byField(hot, 'temperature')?.value, 'Caliente');
  assert.match(byField(hot, 'temperature')?.evidence || '', /Urgencia|presupuesto/i);
  const cold = analyzeLeadQualification(client(), 'Dependo de vender mi casa antes.', 'conversation');
  assert.equal(byField(cold, 'temperature')?.value, 'Frío');
});

test('la fuente conversación usa clientId y únicamente mensajes entrantes o transcripciones', () => {
  const conversation: WhatsAppConversation = {
    id: 10,
    clientId: 7,
    phone: '5493515550101',
    mode: 'Humano',
    unread: 0,
    lastActivity: '2026-07-27T12:00:00.000Z',
    messages: [
      { id: 1, direction: 'outbound', sender: 'Humano', text: 'El precio es USD 200.000', createdAt: '2026-07-27T10:00:00.000Z' },
      { id: 2, direction: 'inbound', sender: 'Cliente', text: 'Busco en Docta', createdAt: '2026-07-27T11:00:00.000Z' },
      { id: 3, direction: 'inbound', sender: 'Cliente', text: 'audio', kind: 'audio', transcript: 'Tengo USD 120.000', transcriptionStatus: 'Transcripto', createdAt: '2026-07-27T12:00:00.000Z' },
    ],
  };
  const text = conversationQualificationText(conversation);
  assert.doesNotMatch(text, /200\.000/);
  assert.match(text, /Docta/);
  assert.match(text, /120\.000/);
});

test('activityLog registra trazabilidad sin duplicar la conversación completa', () => {
  const analysis = analyzeLeadQualification(client(), 'Busco departamento en Docta con USD 120.000.', 'conversation');
  const result = applyQualificationReview(client(), analysis.suggestions.filter((item) => item.field === 'zones').map((item) => accepted(item)));
  const activities = qualificationActivities(7, analysis, result);
  assert.ok(activities.some((entry) => entry.action === 'Calificación analizada'));
  assert.ok(activities.some((entry) => entry.action === 'Sugerencias aplicadas'));
  assert.ok(activities.some((entry) => entry.action === 'Campos descartados'));
  assert.ok(activities.some((entry) => entry.action === 'Preguntas faltantes generadas'));
  assert.equal(activities.some((entry) => entry.detail.includes('Busco departamento en Docta')), false);
});

test('las sugerencias inteligentes se sanitizan y nunca sustituyen una determinística mejor', () => {
  const sanitized = sanitizeIntelligentSuggestions({ suggestions: [
    { field: 'purpose', value: 'Invertir', confidence: 'Media', evidence: 'Quiero obtener renta.' },
    { field: 'unknown', value: 'dato', confidence: 'Alta', evidence: 'texto' },
    { field: 'budget', value: '', confidence: 'Alta', evidence: 'texto' },
  ] });
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0]?.field, 'purpose');
  const deterministic: QualificationSuggestion[] = [{
    id: 'det', field: 'purpose', label: 'Finalidad', value: 'Vivir', confidence: 'Alta', confidenceScore: 92, evidence: 'Es para vivir.',
  }];
  assert.equal(mergeQualificationSuggestions(deterministic, sanitized)[0]?.value, 'Vivir');
});

test('los campos confirmados persisten en cloud y Leads históricos siguen cargando', () => {
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
  crm.clients = [client({
    zones: 'General Paz, Cofico', propertyType: 'Departamento', operation: 'Compra', bedrooms: 2,
    currency: 'USD', needsFinancing: 'No', creditPossible: 'Sí', urgency: 'Alta',
  })];
  crm.properties = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.activityLog = [];
  const rows = crmToCloudRecords(crm, context, 'agent-user');
  const restored = cloudRecordsToCrm(rows, context, structuredClone(crm));
  assert.equal(restored.clients[0]?.zones, 'General Paz, Cofico');
  assert.equal(restored.clients[0]?.bedrooms, 2);
  const historical = { id: 99, name: 'Histórico', phone: '3510000000', interest: 'Casa', status: 'Lead', temperature: 'Tibio', pipeline: 'Nuevo' } as Client;
  assert.doesNotThrow(() => analyzeLeadQualification(historical, 'Busco en Docta', 'notes_transcript'));
});

test('matching utiliza zonas, tipo y dormitorios confirmados', () => {
  const property = {
    id: 1, title: 'Departamento en General Paz', address: 'General Paz, Córdoba', type: 'Departamento', operation: 'Venta',
    price: 100000, owner: 'Propietario', status: 'Activa', bedrooms: 2, paymentMethod: 'Contado', features: 'Balcón',
  };
  const qualified = client({
    interest: '', zones: 'General Paz', propertyType: 'Departamento', bedrooms: 2,
    budget: '120.000', currency: 'USD', paymentMethod: 'Contado',
  });
  const match = evaluatePropertyMatch(qualified, property);
  assert.ok(match);
  assert.ok(match.reasons.includes('Zona: General Paz'));
  assert.ok(match.reasons.includes('2 dormitorios'));
});

test('la UI usa visibleClients, no guarda al analizar y no expone claves', () => {
  const leads = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const qualificationUi = readFileSync('src/lead-qualification-ui.ts', 'utf8');
  const conversations = readFileSync('src/mvp-conversations-ui.ts', 'utf8');
  const aiClient = readFileSync('src/lead-qualification-ai-client.ts', 'utf8');
  const aiServer = readFileSync('src/server/lead-qualification-ai.ts', 'utf8');
  assert.match(leads, /visibleClients\(\)/);
  assert.match(qualificationUi, /visibleClients\(\)/);
  assert.match(qualificationUi, /Aplicar calificación/);
  assert.match(qualificationUi, /Copiar próxima pregunta/);
  assert.match(conversations, /conversation\.clientId/);
  assert.match(conversations, /Calificar este lead/);
  assert.doesNotMatch(aiClient, /LEAD_QUALIFICATION_AI_KEY|process\.env|sb_secret_|service_role/i);
  assert.match(aiServer, /Authorization: `Bearer \$\{options\.apiKey\}`/);
  assert.match(aiServer, /auth\/v1\/user/);
});

test('el panel real no desborda en 430, 720 ni 1366 px', { timeout: 120_000 }, async (t) => {
  const executable = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find(existsSync);
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chrome para validar B1.2.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  try {
    const css = `${readFileSync('src/mvp.css', 'utf8')}\n${readFileSync('src/lead-pipeline.css', 'utf8')}\n${readFileSync('src/lead-qualification.css', 'utf8')}`;
    for (const width of [430, 720, 1366]) {
      const page = await browser.newPage({ viewport: { width, height: width === 1366 ? 768 : 920 } });
      await page.setContent(`<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0}.mvp-content{width:100%;padding:16px}${css}</style></head><body><main class="mvp-content"><article class="mvp-lead-card"><section class="lead-qualification-panel"><header><div><span>Calificación supervisada</span><h3>Calificar automáticamente</h3><p>Revisión antes de guardar.</p></div><button>Cerrar</button></header><div class="lead-qualification-source"><label>Fuente<select><option>Texto de WhatsApp pegado</option></select></label><label class="qualification-textarea">Texto<textarea>Busco departamento en General Paz con USD 120.000</textarea></label></div><div class="qualification-recommendations"><div><span>Etapa sugerida</span><strong>Contactado</strong><small>Consulta comercial.</small></div><div><span>Temperatura sugerida</span><strong>Tibio</strong><small>Faltan señales.</small></div></div><div class="lead-qualification-suggestions"><article class="lead-qualification-suggestion"><div class="lead-qualification-suggestion-head"><label><input type="checkbox"><span>Presupuesto</span></label><span class="qualification-state sugerido">Sugerido</span><span class="qualification-confidence high">Confianza alta</span></div><input value="USD 120.000"><blockquote>Manejo USD 120.000.</blockquote></article></div><section class="qualification-questions"><div><h4>Próximas preguntas</h4><p>Máximo tres.</p></div><ol><li>¿La compra sería de contado?</li></ol><button>Copiar próxima pregunta</button></section><div class="lead-qualification-actions"><button>Aplicar calificación</button><small>Solo campos aceptados.</small></div></section></article></main></body></html>`);
      const result = await page.evaluate(() => ({
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        panelWidth: document.querySelector<HTMLElement>('.lead-qualification-panel')?.getBoundingClientRect().width || 0,
        minButtonHeight: Math.min(...Array.from(document.querySelectorAll('button')).map((button) => button.getBoundingClientRect().height)),
      }));
      assert.ok(result.scrollWidth <= result.viewport + 1, `Desborde en ${width}px: ${JSON.stringify(result)}`);
      assert.ok(result.panelWidth <= result.viewport, `Panel demasiado ancho en ${width}px.`);
      assert.ok(result.minButtonHeight >= 40, `Botón pequeño en ${width}px.`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
