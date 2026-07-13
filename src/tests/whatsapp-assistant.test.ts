import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client, WhatsAppConversation } from '../models.js';
import {
  addFollowUpPlan,
  applyQualificationFromMessage,
  appendConversationMessage,
  qualificationState,
  requiresHumanHandoff,
  suggestAssistantReply,
} from '../whatsapp-assistant.js';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 1,
    name: 'Ana',
    phone: '5493515555555',
    interest: 'Departamento de 2 dormitorios en General Paz',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    ...overrides,
  };
}

function conversation(text: string): WhatsAppConversation {
  return {
    id: 1,
    clientId: 1,
    phone: '5493515555555',
    mode: 'IA supervisada',
    unread: 1,
    lastActivity: '2026-07-13T12:00:00Z',
    messages: [{ id: 1, direction: 'inbound', sender: 'Cliente', text, createdAt: '2026-07-13T12:00:00Z' }],
  };
}

test('mide la calificación y pregunta un solo dato faltante', () => {
  const result = qualificationState(client({ purpose: 'Vivir', knowsArea: 'No' }));
  assert.equal(result.completed, 3);
  assert.equal(result.missing[0], 'budget');
});

test('no autoriza una visita si faltan datos', () => {
  const suggestion = suggestAssistantReply(client(), conversation('Hola, ¿se puede ver?'));
  assert.equal(suggestion.requiresHumanApproval, true);
  assert.match(suggestion.text, /antes de coordinar/i);
  assert.match(suggestion.text, /presupuesto|vivir|invertir/i);
});

test('deriva una visita calificada para aprobación humana', () => {
  const qualified = client({
    purpose: 'Vivir', knowsArea: 'Sí', budget: 'USD 90.000', paymentMethod: 'Contado',
    purchaseTimeframe: '0-3 meses', canMoveForward: 'Sí',
  });
  const suggestion = suggestAssistantReply(qualified, conversation('¿Podemos coordinar una visita?'));
  assert.equal(suggestion.handoff, true);
  assert.match(suggestion.text, /Franco revisa la disponibilidad/i);
});

test('detecta negociación y documentación para derivar a humano', () => {
  assert.equal(requiresHumanHandoff('Quiero hacer una oferta y revisar la escritura'), true);
  assert.equal(requiresHumanHandoff('Busco dos dormitorios'), false);
});

test('extrae presupuesto, pago, motivo y capacidad de avance', () => {
  const result = applyQualificationFromMessage(client(), 'Es para vivir, tengo USD 85.000 de contado y puedo avanzar');
  assert.equal(result.client.purpose, 'Vivir');
  assert.equal(result.client.budget, 'USD 85.000');
  assert.equal(result.client.paymentMethod, 'Contado');
  assert.equal(result.client.canMoveForward, 'Sí');
  assert.ok(result.detected.length >= 4);
});

test('agrega mensajes sin mutar la conversación original', () => {
  const original = conversation('Hola');
  const updated = appendConversationMessage(original, 'outbound', 'IA', 'Buenas tardes', '2026-07-13T13:00:00Z');
  assert.equal(original.messages.length, 1);
  assert.equal(updated.messages.length, 2);
  assert.equal(updated.unread, 0);
});

test('crea plan 24h 72h y 7 días sin duplicarlo', () => {
  const first = addFollowUpPlan([], client({ temperature: 'Caliente' }), '2026-07-13');
  assert.deepEqual(first.reminders.map((item) => item.date), ['2026-07-14', '2026-07-16', '2026-07-20']);
  assert.equal(first.added, 3);
  const second = addFollowUpPlan(first.reminders, client({ temperature: 'Caliente' }), '2026-07-13');
  assert.equal(second.added, 0);
  assert.equal(second.reminders.length, 3);
});
