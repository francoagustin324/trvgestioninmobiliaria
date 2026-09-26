import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCommercialAgendaItems, groupAgendaItems } from '../agenda.js';
import type { Client, Offer, Property, Reservation, Visit } from '../models.js';

function client(id: number, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name: `Cliente ${id}`,
    phone: `54935155500${String(id).padStart(2, '0')}`,
    interest: 'Compra',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Calificado',
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function property(id: number, overrides: Partial<Property> = {}): Property {
  return {
    id,
    title: `Propiedad ${id}`,
    address: 'Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 100000,
    owner: 'Sintético',
    status: 'Activa',
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function visit(id: number, clientId: number, propertyId: number, scheduledAt: string, assignedToId = 1, status: Visit['status'] = 'Coordinada'): Visit {
  return {
    id,
    clientId,
    propertyId,
    scheduledAt,
    status,
    assignedToId,
    createdById: assignedToId,
    createdAt: '2026-09-24T12:00:00.000Z',
    updatedAt: '2026-09-24T12:00:00.000Z',
  };
}

function offer(id: number, clientId: number, propertyId: number, validUntil: string, assignedToId = 1, status: Offer['status'] = 'Pendiente'): Offer {
  return {
    id,
    clientId,
    propertyId,
    origin: 'Cliente',
    amount: 90000,
    currency: 'USD',
    validUntil,
    status,
    assignedToId,
    createdById: assignedToId,
    createdAt: '2026-09-24T12:00:00.000Z',
    updatedAt: '2026-09-24T12:00:00.000Z',
  };
}

function reservation(id: number, clientId: number, propertyId: number, expiresAt: string, assignedToId = 1, status: Reservation['status'] = 'Activa'): Reservation {
  return {
    id,
    clientId,
    propertyId,
    amount: 5000,
    currency: 'USD',
    reservedAt: '2026-09-25',
    expiresAt,
    status,
    assignedToId,
    createdById: assignedToId,
    createdAt: '2026-09-25T12:00:00.000Z',
    updatedAt: '2026-09-25T12:00:00.000Z',
  };
}

test('2D Agenda clasifica VENCIDO HOY PRÓXIMO, deduplica visita espejo y excluye terminales', () => {
  const today = '2026-09-25';
  const p1 = property(11, { title: 'Dúplex Docta' });
  const p2 = property(12);
  const p3 = property(13);
  const p4 = property(14);
  const clients = [
    client(1, { nextAction: 'Visita · Dúplex Docta', nextFollowUp: today }),
    client(2, { nextAction: 'Llamar por oferta', nextFollowUp: '2026-09-24' }),
    client(3, { nextAction: 'Preparar documentación', nextFollowUp: '2026-09-27' }),
    client(4, { pipeline: 'Ganado', outcome: 'won', closedAt: today }),
  ];

  const items = buildCommercialAgendaItems({
    clients,
    reminders: [],
    visits: [
      visit(101, 1, 11, '2026-09-25T15:30:00.000Z'),
      visit(104, 4, 14, '2026-09-25T18:00:00.000Z'),
    ],
    offers: [
      offer(201, 2, 12, '2026-09-25'),
      offer(204, 4, 14, '2026-09-26'),
    ],
    reservations: [
      reservation(301, 3, 13, '2026-09-28'),
      reservation(304, 4, 14, '2026-09-29'),
    ],
    properties: [p1, p2, p3, p4],
    actor: { id: 1, role: 'Dueño' },
  }, today);

  assert.equal(items.filter((item) => item.clientId === 1 || (item.source === 'client' && item.sourceId === 1)).length, 1);
  assert.equal(items.find((item) => item.source === 'visit' && item.sourceId === 101)?.date, today);
  assert.equal(items.some((item) => item.clientId === 4 || (item.source === 'client' && item.sourceId === 4)), false);
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);

  const groups = groupAgendaItems(items);
  assert.ok(groups.overdue.some((item) => item.source === 'client' && item.sourceId === 2));
  assert.ok(groups.today.some((item) => item.source === 'visit' && item.sourceId === 101));
  assert.ok(groups.today.some((item) => item.source === 'offer' && item.sourceId === 201));
  assert.ok(groups.upcoming.some((item) => item.source === 'client' && item.sourceId === 3));
  assert.ok(groups.upcoming.some((item) => item.source === 'reservation' && item.sourceId === 301));
});

test('2D Agenda retira entidades resueltas sin borrar su historial estructurado', () => {
  const today = '2026-09-25';
  const clients = [client(1, { nextAction: 'Enviar propuesta', nextFollowUp: '2026-09-26' })];
  const properties = [property(10)];
  const visits = [visit(1, 1, 10, '2026-09-26T15:00:00.000Z', 1, 'Realizada')];
  const offers = [offer(1, 1, 10, '2026-09-27', 1, 'Aceptada')];
  const reservations = [reservation(1, 1, 10, '2026-09-28', 1, 'Concretada')];

  const items = buildCommercialAgendaItems({
    clients,
    reminders: [],
    visits,
    offers,
    reservations,
    properties,
    actor: { id: 1, role: 'Dueño' },
  }, today);

  assert.equal(items.some((item) => item.source === 'visit'), false);
  assert.equal(items.some((item) => item.source === 'offer'), false);
  assert.equal(items.some((item) => item.source === 'reservation'), false);
  assert.equal(items.filter((item) => item.source === 'client').length, 1);
  assert.equal(visits[0]?.status, 'Realizada');
  assert.equal(offers[0]?.status, 'Aceptada');
  assert.equal(reservations[0]?.status, 'Concretada');
});

test('2D Agenda respeta asignación para Dueño Administrador y Corredor', () => {
  const today = '2026-09-25';
  const clients = [client(1, { assignedToId: 1 }), client(2, { assignedToId: 2 })];
  const properties = [property(10, { assignedToId: 1 }), property(20, { assignedToId: 2 })];
  const visits = [
    visit(1, 1, 10, '2026-09-26T15:00:00.000Z', 1),
    visit(2, 2, 20, '2026-09-26T16:00:00.000Z', 2),
  ];
  const input = { clients, reminders: [], visits, offers: [], reservations: [], properties };

  const owner = buildCommercialAgendaItems({ ...input, actor: { id: 99, role: 'Dueño' } }, today);
  const admin = buildCommercialAgendaItems({ ...input, actor: { id: 98, role: 'Administrador' } }, today);
  const agent1 = buildCommercialAgendaItems({ ...input, actor: { id: 1, role: 'Corredor' } }, today);
  const agent2 = buildCommercialAgendaItems({ ...input, actor: { id: 2, role: 'Corredor' } }, today);

  assert.deepEqual(owner.filter((item) => item.source === 'visit').map((item) => item.sourceId), [1, 2]);
  assert.deepEqual(admin.filter((item) => item.source === 'visit').map((item) => item.sourceId), [1, 2]);
  assert.deepEqual(agent1.filter((item) => item.source === 'visit').map((item) => item.sourceId), [1]);
  assert.deepEqual(agent2.filter((item) => item.source === 'visit').map((item) => item.sourceId), [2]);
});
