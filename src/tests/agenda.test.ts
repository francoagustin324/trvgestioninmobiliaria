import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agendaRelatedOptions,
  agendaUrgency,
  buildAgendaItems,
  completedReminders,
  daysBetweenIsoDates,
  filterAgendaRelatedOptions,
  groupAgendaItems,
  isValidIsoDate,
  todayIsoDate,
} from '../agenda.js';
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

test('daysBetweenIsoDates calcula días sin errores de zona horaria', () => {
  assert.equal(daysBetweenIsoDates('2026-07-13', '2026-07-14'), 1);
  assert.equal(daysBetweenIsoDates('2026-07-13', '2026-07-10'), -3);
});

test('el buscador de seguimientos encuentra únicamente leads por texto parcial', () => {
  const options = agendaRelatedOptions([
    client({ id: 7, name: 'Franco Prueba', interest: 'Casa en Urca' }),
    client({ id: 8, name: 'María', interest: 'Fracción en Docta' }),
  ]);
  const matches = filterAgendaRelatedOptions(options, 'fra');
  assert.deepEqual(matches.map((item) => [item.type, item.value]), [
    ['Lead', 'Franco Prueba'],
    ['Lead', 'María'],
  ]);
});

test('el buscador ignora mayúsculas y acentos y prioriza nombres que comienzan igual', () => {
  const options = agendaRelatedOptions([
    client({ id: 7, name: 'Álvaro', interest: 'Fracción en Docta' }),
    client({ id: 8, name: 'Franco', interest: 'Departamento' }),
  ]);
  assert.deepEqual(filterAgendaRelatedOptions(options, 'FRÁ').map((item) => item.value), ['Franco', 'Álvaro']);
});

test('buildAgendaItems combina clientes y recordatorios por urgencia', () => {
  const items = buildAgendaItems([
    client({ id: 7, name: 'Cliente caliente', temperature: 'Caliente', nextFollowUp: '2026-07-13' }),
  ], reminders, '2026-07-13');

  assert.deepEqual(items.map((item) => item.urgency), ['overdue', 'today', 'today', 'upcoming']);
  assert.equal(items[1]?.source, 'client');
  assert.equal(items[1]?.sourceId, 7);
});

test('buildAgendaItems ordena por fecha y luego por prioridad', () => {
  const sameDay: Reminder[] = [
    { id: 1, date: '2026-07-13', title: 'Prioridad baja', related: 'A', priority: 'Baja' },
    { id: 2, date: '2026-07-13', title: 'Prioridad alta', related: 'B', priority: 'Alta' },
  ];
  const items = buildAgendaItems([], sameDay, '2026-07-13');
  assert.deepEqual(items.map((item) => item.title), ['Prioridad alta', 'Prioridad baja']);
});

test('buildAgendaItems excluye clientes cerrados, perdidos y fechas inválidas', () => {
  const items = buildAgendaItems([
    client({ id: 1, pipeline: 'Cerrado' }),
    client({ id: 2, pipeline: 'Perdido' }),
    client({ id: 3, nextFollowUp: 'fecha inválida' }),
  ], [], '2026-07-13');
  assert.equal(items.length, 0);
});

test('los recordatorios completados salen de la agenda activa y quedan en el historial', () => {
  const completed = {
    id: 9,
    date: '2026-07-13',
    title: 'Seguimiento resuelto',
    related: 'Cliente D',
    priority: 'Alta',
    completedAt: '2026-07-13T16:00:00.000Z',
  };
  assert.equal(buildAgendaItems([], [completed], '2026-07-13').length, 0);
  assert.deepEqual(completedReminders([completed]).map((item) => item.id), [9]);
});

test('groupAgendaItems crea las tres bandejas comerciales', () => {
  const groups = groupAgendaItems(buildAgendaItems([], reminders, '2026-07-13'));
  assert.equal(groups.overdue.length, 1);
  assert.equal(groups.today.length, 1);
  assert.equal(groups.upcoming.length, 1);
});
