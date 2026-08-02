import assert from 'node:assert/strict';
import test from 'node:test';
import { isHumanIdentityName, resolveHumanIdentity } from '../human-identity.js';
import { leadRecentTimestamp, setLeadActivitySource, sortLeads } from '../lead-list-priority.js';
import type { ActivityEntry, Client, WhatsAppConversation } from '../models.js';
import { buildContextualWhatsAppMessage } from '../whatsapp-message-context.js';
import { followUpDateForChoice, followUpPreview } from '../whatsapp-followup-selection.js';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 1,
    name: 'Vilma',
    phone: '5493515110069',
    interest: 'Departamento en Balcones del Chateau',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    ...overrides,
  };
}

function conversation(texts: string[], overrides: Partial<WhatsAppConversation> = {}): WhatsAppConversation {
  return {
    id: 1,
    clientId: 1,
    phone: '5493515110069',
    mode: 'Humano',
    unread: 0,
    lastActivity: '2026-08-02T18:00:00.000Z',
    messages: texts.map((text, index) => ({
      id: index + 1,
      direction: 'inbound',
      sender: 'Cliente',
      text,
      createdAt: `2026-08-02T18:0${index}:00.000Z`,
    })),
    ...overrides,
  };
}

function message(overrides: Partial<Client>, texts: string[] = []) {
  return buildContextualWhatsAppMessage({
    client: client(overrides),
    responsibleFirstName: 'Franco',
    agency: 'TRV Gestión Inmobiliaria',
    conversation: texts.length ? conversation(texts) : null,
  });
}

test('B1.3.3 resuelve la identidad humana actual como Franco', () => {
  const result = resolveHumanIdentity({
    member: { name: 'Franco Solís', email: 'franco@trv.com' },
    profileName: '',
    organizationName: 'TRV Gestión Inmobiliaria',
    organizationId: 'trv-gestion-inmobiliaria',
  });
  assert.equal(result.valid, true);
  assert.equal(result.firstName, 'Franco');
  assert.equal(result.fullName, 'Franco Solís');
});

test('B1.3.3 rechaza identidades técnicas y utiliza el perfil humano', () => {
  const result = resolveHumanIdentity({
    member: { name: 'trvgestioninmobiliaria', email: 'cuenta@trv.com' },
    profileName: 'Franco Solís',
    organizationName: 'TRV Gestión Inmobiliaria',
    organizationId: 'trvgestioninmobiliaria',
  });
  assert.equal(result.valid, true);
  assert.equal(result.firstName, 'Franco');
  assert.equal(result.source, 'profile');
  assert.equal(isHumanIdentityName('usuario123'), false);
  assert.equal(isHumanIdentityName('18f8a728-0ef4-4b84-9a76-34a843de6cd7'), false);
});

test('B1.3.3 otros miembros utilizan su propio nombre', () => {
  const result = resolveHumanIdentity({ member: { name: 'Carla Pereyra', email: 'carla@trv.com' } });
  assert.equal(result.valid, true);
  assert.equal(result.firstName, 'Carla');
});

test('B1.3.3 falta de identidad humana bloquea la generación', () => {
  const result = resolveHumanIdentity({
    member: { name: 'usuario', email: 'trvgestioninmobiliaria@example.com' },
    profileName: '',
    organizationName: 'TRV Gestión Inmobiliaria',
    organizationId: 'trvgestioninmobiliaria',
  });
  assert.equal(result.valid, false);
  assert.match(result.reason, /Nombre para mensajes/);
});

test('B1.3.3 el mensaje contextual nunca firma como identidad técnica', () => {
  const result = message({ budget: 'USD 100.000', paymentMethod: 'Contado', purchaseTimeframe: 'Este mes' });
  assert.match(result.message, /soy Franco de TRV Gestión Inmobiliaria/);
  assert.doesNotMatch(result.message, /soy trvgestioninmobiliaria/i);
});

test('B1.3.3 la conversación completa evita repetir si sigue buscando', () => {
  const result = message({}, ['Sí, sigo buscando. Quiero un departamento de dos dormitorios.']);
  assert.doesNotMatch(result.question, /segu[ií]s buscando/i);
  assert.match(result.question, /presupuesto/i);
});

test('B1.3.3 pregunta presupuesto cuando falta', () => {
  assert.match(message({}, ['Sigo buscando en esa zona.']).question, /presupuesto/i);
});

test('B1.3.3 pregunta forma de pago cuando presupuesto ya está confirmado', () => {
  assert.match(message({ budget: 'USD 120.000' }, ['Mi presupuesto es de USD 120.000.']).question, /contado|cr[eé]dito|financiaci[oó]n/i);
});

test('B1.3.3 pregunta plazo cuando presupuesto y pago están confirmados', () => {
  const result = message({ budget: 'USD 120.000', paymentMethod: 'Contado' }, ['Tengo USD 120.000 y compraría de contado.']);
  assert.match(result.question, /cu[aá]ndo|para cu[aá]ndo/i);
});

test('B1.3.3 espera de venta genera pregunta contextual prioritaria', () => {
  const result = message({ budget: 'USD 120.000', paymentMethod: 'Contado' }, ['Primero tengo que vender mi departamento.']);
  assert.match(result.question, /c[oó]mo viene.*venta|propiedad.*vender/i);
});

test('B1.3.3 una visita solicitada confirma datos pendientes sin prometerla', () => {
  const result = message(
    { budget: 'USD 120.000', paymentMethod: 'Contado', purchaseTimeframe: 'Este mes' },
    ['Quiero coordinar una visita para ver el departamento.'],
  );
  assert.match(result.question, /d[ií]a.*franja horaria/i);
});

test('B1.3.3 ya compró y no me escribas bloquean el contacto', () => {
  assert.equal(message({}, ['Gracias, ya compré otra propiedad.']).blocked, true);
  const blocked = message({}, ['Por favor no me escribas más.']);
  assert.equal(blocked.blocked, true);
  assert.match(blocked.reason, /no recibir|no contactar/i);
});

test('B1.3.3 información contradictoria deriva a revisión humana', () => {
  const result = message({}, ['Sí, sigo buscando, pero ya compré y no busco más.']);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /contradictoria|revisi[oó]n/i);
});

test('B1.3.3 sin conversación utiliza fallback seguro y no afirma lectura externa', () => {
  const result = message({ budget: 'USD 100.000' });
  assert.equal(result.source, 'fallback');
  assert.match(result.contextNote, /No hay historial de conversaci[oó]n cargado/);
  assert.doesNotMatch(result.message, /le[ií]mos|WhatsApp|chat externo/i);
});

test('B1.3.3 Más recientes usa actividad de creación y no nextFollowUp futuro', () => {
  const activities: ActivityEntry[] = [{
    id: 1,
    actorId: 1,
    action: 'Lead creado',
    entityType: 'Cliente',
    entityId: 2,
    detail: 'Creación',
    createdAt: '2026-08-02T18:00:00.000Z',
  }, {
    id: 2,
    actorId: 1,
    action: 'Lead creado',
    entityType: 'Cliente',
    entityId: 1,
    detail: 'Creación',
    createdAt: '2026-07-01T18:00:00.000Z',
  }];
  setLeadActivitySource(() => activities);
  const oldWithFutureFollowUp = client({ id: 1, name: 'Antiguo', nextFollowUp: '2030-01-01' });
  const recent = client({ id: 2, name: 'Nuevo', nextFollowUp: '2026-08-03' });
  assert.ok(leadRecentTimestamp(recent) > leadRecentTimestamp(oldWithFutureFollowUp));
  assert.deepEqual(sortLeads([oldWithFutureFollowUp, recent], 'recent').map((item) => item.id), [2, 1]);
});

test('B1.3.3 Prioridad continúa disponible y terminales permanecen al final', () => {
  setLeadActivitySource(() => []);
  const overdue = client({ id: 1, nextFollowUp: '2026-08-01' });
  const normal = client({ id: 2, nextFollowUp: '2026-08-10' });
  const won = client({ id: 3, pipeline: 'Ganado' });
  assert.deepEqual(sortLeads([normal, won, overdue], 'priority', '2026-08-02').map((item) => item.id), [1, 2, 3]);
});

test('B1.3.3 la fecha visible es exactamente la que se guardará', () => {
  const now = new Date(2026, 7, 2, 10, 0, 0);
  assert.equal(followUpDateForChoice('1', '', now), '2026-08-03');
  assert.equal(followUpDateForChoice('7', '', now), '2026-08-09');
  assert.equal(followUpDateForChoice('custom', '2026-08-21', now), '2026-08-21');
  assert.equal(followUpDateForChoice('none', '2026-08-21', now), '');
  assert.match(followUpPreview('2026-08-21'), /Se programar[aá] para:/);
});
