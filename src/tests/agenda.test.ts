import assert from 'node:assert/strict';
import test from 'node:test';
import { agendaUrgency, buildAgendaItems, groupAgendaItems, isValidIsoDate, todayIsoDate } from '../agenda.js';
import type { Client, Reminder } from '../models.js';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 1,
    name: 'Cliente de prueba',
    phone: '3510000000',
    interest: 'Departamento en Córdoba',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    nextFollowUp: '2026-07-13',
    ...overrides,
  };
}

const reminders: Reminder[] = [
  { id: 1, date: '2026-07-12', title: 'Vencido', related: 'Cliente A', priority: 'Baja' },
  { id: 2, date: '2026-07-13', title: 'Hoy alta', related: 'Cliente B', priority: 'Alta' },
  { id: 3, date: '2026-07-14', title: 'Próximo', related: 'Cliente C', priority: 'Media' },
];

test('todayIsoDate usa la fecha local sin convertirla a UTC', () => {
  assert.equal(todayIsoDate(new Date(2026, 6, 13, 23, 30)), '2026-07-13');
});

test('isValidIsoDate rechaza fechas inexistentes', () => {
  assert.equal(isValidIsoDate('2026-02-29'), false);
  assert.equal(isValidIsoDate('2026-07-13'), true);
});

test('agendaUrgency clasifica vencido, hoy y próximo', () => {
  assert.equal(agendaUrgency('2026-07-12', '2026-07-13'), 'overdue');
  assert.equal(agendaUrgency('2026-07-13', '2026-07-13'), 'today');
  assert.equal(agendaUrgency('2026-07-14', '2026-07-13'), 'upcoming');
});

test('buildAgendaItems combina clientes y recordatorios por urgencia', () => {
  const items = buildAgendaItems([
    client({ id: 7, name: 'Cliente caliente', temperature: 'Caliente', nextFollowUp: '2026-07-13' }),
  ], reminders, '2026-07-13');

  assert.deepEqual(items.map((item) => item.urgency), ['overdue', 'today', 'today', 'upcoming']);
  assert.equal(items[1]?.source, 'client');
  assert.equal(items[1]?.sourceId, 7);
});

test('buildAgendaItems excluye clientes cerrados, perdidos y fechas inválidas', () => {
  const items = buildAgendaItems([
    client({ id: 1, pipeline: 'Cerrado' }),
    client({ id: 2, pipeline: 'Perdido' }),
    client({ id: 3, nextFollowUp: 'fecha inválida' }),
  ], [], '2026-07-13');
  assert.equal(items.length, 0);
});

test('groupAgendaItems crea las tres bandejas comerciales', () => {
  const groups = groupAgendaItems(buildAgendaItems([], reminders, '2026-07-13'));
  assert.equal(groups.overdue.length, 1);
  assert.equal(groups.today.length, 1);
  assert.equal(groups.upcoming.length, 1);
});
