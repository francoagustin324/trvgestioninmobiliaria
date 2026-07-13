import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client, ConversationMessage, ConversationStatus, WhatsAppConversation } from '../models.js';
import { auditConversation, auditableMessageText } from '../conversation-audit.js';

function client(): Client {
  return {
    id: 1,
    name: 'Cliente semántico',
    phone: '5493515559090',
    interest: 'Propiedad en Córdoba',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
  };
}

function conversation(message: ConversationMessage): WhatsAppConversation {
  return {
    id: 1,
    clientId: 1,
    phone: '5493515559090',
    mode: 'IA supervisada',
    unread: 1,
    lastActivity: message.createdAt,
    messages: [message],
  };
}

function textMessage(text: string): ConversationMessage {
  return {
    id: 1,
    direction: 'inbound',
    sender: 'Cliente',
    text,
    createdAt: '2026-07-13T19:00:00.000Z',
    kind: 'text',
    transcriptionStatus: 'No requerida',
  };
}

function expectConcept(text: string, expected: ConversationStatus): void {
  const audit = auditConversation(conversation(textMessage(text)), client(), []);
  assert.equal(audit.status, expected, text);
  assert.equal(audit.engine, 'Comprensión por conceptos', text);
}

test('comprende búsquedas activas mediante conceptos y sinónimos', () => {
  expectConcept('Andamos buscando otra alternativa en Cofico', 'Sigue buscando');
  expectConcept('Retomamos la búsqueda de una casa', 'Sigue buscando');
  expectConcept('Me podés avisar si surge alguna oportunidad', 'Sigue buscando');
});

test('comprende dependencia de una venta sin exigir una frase exacta', () => {
  expectConcept('La compra queda atada a la venta de mi casa', 'Esperando vender');
  expectConcept('Estamos a la espera de vender antes de avanzar', 'Esperando vender');
});

test('comprende compra resuelta con expresiones equivalentes', () => {
  expectConcept('Finalmente resolvimos por nuestra cuenta y elegimos otra propiedad', 'Ya compró');
});

test('comprende bajas y pedidos de no contacto por intención', () => {
  expectConcept('Prefiero que no me mandes más opciones', 'No busca más');
  expectConcept('Cerramos la búsqueda por ahora', 'No busca más');
});

test('detecta actividad inmobiliaria por rol y contexto', () => {
  expectConcept('Me dedico a comercializar unidades en pozo', 'Contacto comercial');
});

test('evita falsos positivos fuera del sector o fuera del presente', () => {
  assert.equal(auditConversation(conversation(textMessage('Soy vendedor de autos')), client(), []).status, 'Revisar manualmente');
  assert.equal(auditConversation(conversation(textMessage('Compré hace años')), client(), []).status, 'Revisar manualmente');
  assert.equal(auditConversation(conversation(textMessage('No me interesa esta propiedad')), client(), []).status, 'Revisar manualmente');
});

test('lee la transcripción de un audio como parte del historial', () => {
  const message: ConversationMessage = {
    id: 1,
    direction: 'inbound',
    sender: 'Cliente',
    text: 'Audio recibido',
    createdAt: '2026-07-13T19:00:00.000Z',
    kind: 'audio',
    transcript: 'Prefiero que no me mandes más opciones',
    transcriptionStatus: 'Transcripto',
  };
  assert.equal(auditableMessageText(message), message.transcript);
  const audit = auditConversation(conversation(message), client(), []);
  assert.equal(audit.status, 'No busca más');
  assert.ok(audit.reasons.some((reason) => reason.includes('transcripción')));
});

test('un audio pendiente nunca habilita seguimiento', () => {
  const message: ConversationMessage = {
    id: 1,
    direction: 'inbound',
    sender: 'Cliente',
    text: 'Audio recibido',
    createdAt: '2026-07-13T19:00:00.000Z',
    kind: 'audio',
    transcriptionStatus: 'Pendiente',
  };
  const audit = auditConversation(conversation(message), client(), []);
  assert.equal(audit.status, 'Revisar manualmente');
  assert.equal(audit.decision, 'Revisión manual');
  assert.equal(audit.confidence, 10);
});
