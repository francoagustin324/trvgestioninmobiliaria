import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  analyzeLeadQualification,
  applyQualificationReview,
  conversationQualificationText,
  missingQualificationQuestions,
  qualificationActivities,
  suggestionBlockedByConfirmedValue,
  type QualificationSuggestion,
} from '../lead-qualification.js';
import {
  mergeQualificationSuggestions,
} from '../lead-qualification-ai-client.js';
import {
  leadQualificationAiConfigured,
  sanitizeIntelligentSuggestions,
} from '../server/lead-qualification-ai.js';
import type { Client, WhatsAppConversation } from '../models.js';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 7,
    name: 'Ana Pérez',
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

test('extrae una conversación completa con calificación comercial esencial', () => {
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
  assert.equal(byField(analysis, 'creditPossible')?.value, 'No necesita');
  assert.equal(byField(analysis, 'purpose')?.value, 'Vivir');
  assert.equal(byField(analysis, 'purchaseTimeframe')?.value, '0-3 meses');
  assert.equal(byField(analysis, 'knowsArea')?.value, 'Sí');
  assert.equal(byField(analysis, 'canMoveForward')?.value, 'Sí');
  assert.equal(byField(analysis, 'garage')?.value, 'Sí');
  assert.equal(byField(analysis, 'nextAction')?.value, 'Coordinar una visita');
  assert.equal(byField(analysis, 'nextFollowUp')?.value, '2026-07-30');
  assert.equal(byField(analysis, 'pipeline')?.value, 'Calificado');
  assert.equal(analysis.visitWarning, null);
});

test('una conversación parcial detecta solo lo presente y genera una pregunta', () => {
  const analysis = analyzeLeadQualification(client(), 'Hola, busco una casa en Docta para invertir.', 'conversation');
  assert.equal(byField(analysis, 'propertyType')?.value, 'Casa');
  assert.equal(byField(analysis, 'zones')?.value, 'Docta');
  assert.equal(byField(analysis, 'purpose')?.value, 'Invertir');
  assert.equal(byField(analysis, 'budget'), undefined);
  assert.deepEqual(analysis.missingQuestions, ['¿Qué presupuesto aproximado manejás?']);
  assert.equal(analysis.visitWarning, 'Conviene confirmar presupuesto y forma de pago antes de coordinar.');
});

test('interpreta presupuestos seguros y conserva la moneda explícita', () => {
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

  const partial = analyzeLeadQualification(client(), 'Tengo 100 y puedo financiar el resto.', 'whatsapp_text');
  assert.equal(byField(partial, 'budget')?.value, '100.000 disponibles + resto financiado');
  assert.equal(byField(partial, 'needsFinancing')?.value, 'Sí');
  assert.equal(byField(partial, 'paymentMethod')?.value, 'Combinación');
  assert.equal(byField(partial, 'budget')?.ambiguous, true);
});

test('distingue contado, crédito, financiación y combinación', () => {
  assert.equal(byField(analyzeLeadQualification(client(), 'Compro de contado.', 'notes_transcript'), 'paymentMethod')?.value, 'Contado');
  assert.equal(byField(analyzeLeadQualification(client(), 'Tengo crédito hipotecario preaprobado.', 'notes_transcript'), 'creditPossible')?.value, 'Preaprobado');
  assert.equal(byField(analyzeLeadQualification(client(), 'Necesito financiación en cuotas.', 'notes_transcript'), 'paymentMethod')?.value, 'Financiación');
  assert.equal(byField(analyzeLeadQualification(client(), 'Tengo una parte y financiaría el resto.', 'notes_transcript'), 'paymentMethod')?.value, 'Combinación');
});

test('un pedido prematuro de visita no se convierte en Calificado', () => {
  const analysis = analyzeLeadQualification(client(), 'Hola, ¿se puede ver el departamento mañana?', 'conversation', new Date(2026, 6, 27));
  assert.equal(byField(analysis, 'pipeline')?.value, 'Contactado');
  assert.equal(byField(analysis, 'nextAction')?.value, 'Coordinar una visita');
  assert.equal(byField(analysis, 'nextFollowUp')?.value, '2026-07-28');
  assert.equal(analysis.visitWarning, 'Conviene confirmar presupuesto y forma de pago antes de coordinar.');
  assert.ok(analysis.visitMissingFields.includes('presupuesto'));
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
  const ignored = applyQualificationReview(original, analysis.suggestions.map((item) => ({ ...item, accepted: false })));
  assert.deepEqual(ignored.client, snapshot);
  const chosen = analysis.suggestions
    .filter((item) => ['zones', 'budget', 'currency', 'paymentMethod'].includes(item.field))
    .map((item) => accepted(item));
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

test('la próxima pregunta respeta prioridad y devuelve una sola', () => {
  assert.deepEqual(missingQualificationQuestions(client(), []), ['¿Qué presupuesto aproximado manejás?']);
});

test('Ganado y Perdido siempre requieren confirmación humana', () => {
  const won = byField(analyzeLeadQualification(client(), 'La operación está cerrada, ya compré.', 'conversation'), 'pipeline')!;
  assert.equal(won.value, 'Ganado');
  assert.equal(won.terminalConfirmationRequired, true);
  assert.equal(applyQualificationReview(client(), [accepted(won)], false).client.pipeline, 'Nuevo');
  assert.equal(applyQualificationReview(client(), [accepted(won)], true).client.pipeline, 'Ganado');

  const lost = byField(analyzeLeadQualification(client(), 'Compré por otro lado, no busco más.', 'conversation'), 'pipeline')!;
  assert.equal(lost.value, 'Perdido');
  assert.equal(applyQualificationReview(client(), [accepted(lost)], false).client.pipeline, 'Nuevo');
  assert.equal(applyQualificationReview(client(), [accepted(lost)], true).client.pipeline, 'Perdido');
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
  const longText = 'Busco en Docta. '.repeat(40);
  const analysis = analyzeLeadQualification(client(), longText, 'conversation');
  const analyzed = qualificationActivities(7, analysis);
  const result = applyQualificationReview(client(), analysis.suggestions.map((item) => ({ ...item, accepted: item.field === 'zones' })));
  const applied = qualificationActivities(7, analysis, result).slice(1);
  const activities = [...analyzed, ...applied];
  assert.ok(activities.some((entry) => entry.action === 'Calificación analizada'));
  assert.ok(activities.some((entry) => entry.action === 'Próxima pregunta generada'));
  assert.ok(activities.some((entry) => entry.action === 'Sugerencias aplicadas'));
  assert.equal(activities.some((entry) => entry.detail.includes(longText)), false);
});

test('las sugerencias inteligentes se sanitizan y nunca sustituyen una determinística mejor', () => {
  const intelligent = sanitizeIntelligentSuggestions({ suggestions: [
    { field: 'zones', value: 'Manantiales', confidence: 'Media', evidence: 'Busco en Manantiales.' },
    { field: 'creditApprovedAmount', value: 'USD 80.000', confidence: 'Alta', evidence: 'Me aprobaron USD 80.000.' },
    { field: 'forbidden', value: 'owner', confidence: 'Alta', evidence: 'No corresponde.' },
  ] });
  assert.equal(intelligent.length, 2);
  const deterministic: QualificationSuggestion = {
    id: 'zones-deterministic', field: 'zones', label: 'Zona', value: 'Docta',
    confidence: 'Alta', confidenceScore: 92, evidence: 'Busco en Docta.',
  };
  const merged = mergeQualificationSuggestions([deterministic], intelligent);
  assert.equal(merged.find((item) => item.field === 'zones')?.value, 'Docta');
  assert.equal(merged.find((item) => item.field === 'creditApprovedAmount')?.value, 'USD 80.000');
});

test('la capa inteligente opcional permanece desactivada sin configuración y no expone claves', () => {
  assert.equal(leadQualificationAiConfigured({
    supabaseUrl: '', publishableKey: '', endpoint: '', apiKey: '', model: '',
  }), false);
  const clientSource = readFileSync('src/lead-qualification-ai-client.ts', 'utf8');
  const serverSource = readFileSync('src/server/lead-qualification-ai.ts', 'utf8');
  assert.doesNotMatch(clientSource, /LEAD_QUALIFICATION_AI_KEY|OPENAI_API_KEY|service_role/i);
  assert.match(serverSource, /Authorization: `Bearer \$\{options\.apiKey\}`/);
  assert.match(serverSource, /No inventes datos ausentes/);
});

test('Leads y Conversaciones conservan visibilidad vigente y acceso supervisado', () => {
  const leads = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const conversations = readFileSync('src/mvp-conversations-ui.ts', 'utf8');
  assert.match(leads, /visibleClients\(\)/);
  assert.match(conversations, /visibleConversations\(\)/);
  assert.match(readFileSync('src/lead-card-compact-ui.ts', 'utf8'), /Calificar automáticamente/);
  assert.match(conversations, /Calificar Lead/);
});
