import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client, CommercialContact, ConversationStatus, WhatsAppConversation } from '../models.js';
import {
  addWaitingSaleReminder,
  auditAllConversations,
  auditConversation,
  conversationAuditSummary,
  manualConversationAudit,
  safeConversationMode,
} from '../conversation-audit.js';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 1,
    name: 'Ana',
    phone: '5493515555555',
    interest: 'Departamento en Córdoba',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    ...overrides,
  };
}

function conversation(texts: string[], overrides: Partial<WhatsAppConversation> = {}): WhatsAppConversation {
  return {
    id: 1,
    clientId: 1,
    phone: '5493515555555',
    mode: 'IA supervisada',
    unread: 0,
    lastActivity: '2026-07-13T12:00:00.000Z',
    messages: texts.map((text, index) => ({
      id: index + 1,
      direction: 'inbound' as const,
      sender: 'Cliente' as const,
      text,
      createdAt: `2026-07-13T${String(10 + index).padStart(2, '0')}:00:00.000Z`,
    })),
    ...overrides,
  };
}

function expectStatus(text: string, status: ConversationStatus, contacts: CommercialContact[] = []): void {
  const result = auditConversation(conversation([text]), client(), contacts, '2026-07-13T15:00:00.000Z');
  assert.equal(result.status, status, text);
}

const activeCases = [
  'Sigo buscando un departamento',
  'Seguimos buscando por General Paz',
  'Todavía busco algo de dos dormitorios',
  'Continuamos buscando, mandame opciones',
  'Mandame opciones nuevas',
  'Avisame si aparece algo con balcón',
  'Quiero seguir viendo departamentos',
  'Estoy buscando para vivir',
  'Queremos comprar este año',
  'Me interesa ver opciones en Cofico',
  'Sigo en la búsqueda',
];
activeCases.forEach((message) => test(`habilita seguimiento supervisado: ${message}`, () => {
  expectStatus(message, 'Sigue buscando');
}));

const stoppedCases = [
  'No busco más',
  'Ya no estoy buscando',
  'Dejé de buscar hace un mes',
  'No estoy buscando actualmente',
  'No quiero comprar',
  'Desistimos de comprar',
  'No me escriban más',
  'No quiero recibir mensajes',
  'Sacame de la lista',
  'Por ahora no busco',
  'Pausamos la búsqueda',
];
stoppedCases.forEach((message) => test(`bloquea contacto por búsqueda finalizada: ${message}`, () => {
  expectStatus(message, 'No busca más');
}));

const boughtCases = [
  'Ya compré, gracias',
  'Ya compramos una casa',
  'Ya conseguí departamento',
  'Ya encontramos algo',
  'Ya resolví por otro lado',
  'Cerré con otra inmobiliaria',
  'Ya lo resolvimos',
];
boughtCases.forEach((message) => test(`bloquea contacto porque ya compró: ${message}`, () => {
  expectStatus(message, 'Ya compró');
}));

const waitingCases = [
  'Todavía no vendí mi casa',
  'Aún no vendimos',
  'No pude vender todavía',
  'Dependo de vender primero',
  'Primero tengo que vender',
  'Hasta que no venda no puedo avanzar',
  'Cuando venda te aviso',
  'Estoy esperando vender',
];
waitingCases.forEach((message) => test(`pausa seguimiento inmediato mientras espera vender: ${message}`, () => {
  expectStatus(message, 'Esperando vender');
}));

const commercialCases = [
  'Soy corredor inmobiliario',
  'Soy asesora inmobiliaria',
  'Trabajo para una constructora',
  'Represento a una desarrollista',
  'Soy vendedor de la constructora',
  'Te comparto una propiedad en Docta',
  'Les paso disponibilidad de unidades',
  'Compartimos comisión',
  'Soy propietario y quiero vender mi casa',
];
commercialCases.forEach((message) => test(`detecta contacto comercial: ${message}`, () => {
  expectStatus(message, 'Contacto comercial');
}));

test('la Red comercial bloquea por teléfono aunque el texto parezca una búsqueda', () => {
  const contacts: CommercialContact[] = [{
    id: 10,
    type: 'Constructor / Desarrollista',
    name: 'Desarrollista Centro',
    phone: '+54 9 351 555-5555',
    createdAt: '2026-07-01T00:00:00.000Z',
  }];
  const result = auditConversation(conversation(['Sigo buscando opciones']), client(), contacts);
  assert.equal(result.status, 'Contacto comercial');
  assert.equal(result.confidence, 100);
  assert.equal(result.decision, 'No contactar');
});

test('el último estado explícito reemplaza una búsqueda anterior', () => {
  const result = auditConversation(conversation([
    'Estoy buscando un departamento',
    'Ya compré, muchas gracias',
    'Perfecto, saludos',
  ]), client(), []);
  assert.equal(result.status, 'Ya compró');
});

test('una confirmación reciente de búsqueda reemplaza una pausa anterior', () => {
  const result = auditConversation(conversation([
    'Por ahora no busco',
    'Hola, retomamos el tema',
    'Seguimos buscando, mandame opciones',
  ]), client(), []);
  assert.equal(result.status, 'Sigue buscando');
});

test('la identidad comercial histórica prevalece sobre un mensaje posterior ambiguo', () => {
  const result = auditConversation(conversation([
    'Soy corredor inmobiliario y te comparto una unidad',
    'Hola, ¿cómo estás?',
  ]), client(), []);
  assert.equal(result.status, 'Contacto comercial');
});

test('un mensaje contradictorio queda para revisión manual', () => {
  const result = auditConversation(conversation(['Sigo buscando, pero primero tengo que vender']), client(), []);
  assert.equal(result.status, 'Revisar manualmente');
  assert.equal(result.decision, 'Revisión manual');
});

test('un historial sin estado explícito queda pausado', () => {
  const result = auditConversation(conversation(['Hola', 'Gracias por la información']), client(), []);
  assert.equal(result.status, 'Revisar manualmente');
  assert.equal(safeConversationMode(result, 'IA supervisada'), 'Pausada');
});

test('una conversación vacía nunca queda habilitada', () => {
  const result = auditConversation(conversation([]), client(), []);
  assert.equal(result.status, 'Revisar manualmente');
  assert.equal(result.confidence, 15);
});

test('si el CRM dice que no puede avanzar, una búsqueda activa requiere revisión', () => {
  const result = auditConversation(conversation(['Sigo buscando']), client({ canMoveForward: 'No' }), []);
  assert.equal(result.status, 'Revisar manualmente');
  assert.equal(result.decision, 'Revisión manual');
});

test('las notas del CRM pueden pausar por venta previa sin autorizar mensajes', () => {
  const result = auditConversation(conversation(['Gracias']), client({ notes: 'Primero tengo que vender mi casa' }), []);
  assert.equal(result.status, 'Esperando vender');
  assert.equal(result.decision, 'Pausar');
});

test('una negación no se interpreta como intención de compra', () => {
  expectStatus('No quiero comprar por ahora', 'No busca más');
  expectStatus('No estoy buscando un departamento', 'No busca más');
});

test('solo una búsqueda activa con alta confianza mantiene IA supervisada', () => {
  const active = auditConversation(conversation(['Sigo buscando']), client(), []);
  const unclear = auditConversation(conversation(['Gracias']), client(), []);
  assert.equal(safeConversationMode(active, 'IA supervisada'), 'IA supervisada');
  assert.equal(safeConversationMode(unclear, 'IA supervisada'), 'Pausada');
  assert.equal(safeConversationMode(unclear, 'Humano'), 'Humano');
});

test('la confirmación manual tiene confianza total y conserva trazabilidad', () => {
  const audit = manualConversationAudit('No busca más', '2026-07-13T18:00:00.000Z');
  assert.equal(audit.confidence, 100);
  assert.equal(audit.source, 'Manual');
  assert.equal(audit.decision, 'No contactar');
});

test('audita todas las conversaciones y pausa las inseguras', () => {
  const conversations = [
    conversation(['Sigo buscando'], { id: 1, clientId: 1 }),
    conversation(['Ya compré'], { id: 2, clientId: 2, phone: '5493515555556' }),
    conversation(['Gracias'], { id: 3, clientId: 3, phone: '5493515555557' }),
  ];
  const clients = [client({ id: 1 }), client({ id: 2, phone: '5493515555556' }), client({ id: 3, phone: '5493515555557' })];
  const result = auditAllConversations(conversations, clients, [], '2026-07-13T19:00:00.000Z');
  assert.equal(result[0]?.mode, 'IA supervisada');
  assert.equal(result[1]?.mode, 'Pausada');
  assert.equal(result[2]?.mode, 'Pausada');
  assert.equal(result[1]?.audit?.status, 'Ya compró');
});

test('resume estados auditados para el tablero', () => {
  const audited = auditAllConversations([
    conversation(['Sigo buscando'], { id: 1 }),
    conversation(['Ya compré'], { id: 2 }),
    conversation(['No busco más'], { id: 3 }),
  ], [client()], [], '2026-07-13T19:00:00.000Z');
  const summary = conversationAuditSummary(audited);
  assert.equal(summary['Sigue buscando'], 1);
  assert.equal(summary['Ya compró'], 1);
  assert.equal(summary['No busca más'], 1);
});

test('crea un único recordatorio interno a 30 días para quien espera vender', () => {
  const first = addWaitingSaleReminder([], client(), '2026-07-13');
  assert.equal(first.added, 1);
  assert.equal(first.reminders[0]?.date, '2026-08-12');
  const second = addWaitingSaleReminder(first.reminders, client(), '2026-07-13');
  assert.equal(second.added, 0);
  assert.equal(second.reminders.length, 1);
});
