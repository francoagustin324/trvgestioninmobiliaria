import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultClientListFilters, filterAndSortClients, type ClientListFilters } from '../client-list.js';
import type { Client, Temperature } from '../models.js';

function client(id: number, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name: `Cliente ${id}`,
    phone: `549351000000${id}`,
    interest: 'Departamento en Córdoba',
    status: 'Lead',
    temperature: 'Tibio' as Temperature,
    pipeline: 'Contactado',
    ...overrides,
  };
}

function filters(overrides: Partial<ClientListFilters> = {}): ClientListFilters {
  return { ...defaultClientListFilters(), ...overrides };
}

const today = '2026-07-13';

test('busca sin distinguir mayúsculas ni acentos', () => {
  const clients = [
    client(1, { name: 'José Álvarez', interest: 'Casa en Urca' }),
    client(2, { name: 'María Paz', interest: 'Departamento en Cofico' }),
  ];
  const result = filterAndSortClients(clients, filters({ query: 'jose alvarez' }), today);
  assert.deepEqual(result.map((item) => item.id), [1]);
});

test('encuentra un teléfono aunque se busque con otro formato', () => {
  const clients = [client(1, { phone: '5493515110069' }), client(2, { phone: '5493519999999' })];
  const result = filterAndSortClients(clients, filters({ query: '0351 15 5110069' }), today);
  assert.deepEqual(result.map((item) => item.id), [1]);
});

test('combina filtros de temperatura etapa y seguimiento', () => {
  const clients = [
    client(1, { temperature: 'Caliente', pipeline: 'Calificado', nextFollowUp: '2026-07-12' }),
    client(2, { temperature: 'Caliente', pipeline: 'Nuevo', nextFollowUp: '2026-07-12' }),
    client(3, { temperature: 'Tibio', pipeline: 'Calificado', nextFollowUp: '2026-07-12' }),
  ];
  const result = filterAndSortClients(clients, filters({ temperature: 'Caliente', pipeline: 'Calificado', followUp: 'Vencidos' }), today);
  assert.deepEqual(result.map((item) => item.id), [1]);
});

test('clasifica vencidos hoy próximos y sin fecha', () => {
  const clients = [
    client(1, { nextFollowUp: '2026-07-12' }),
    client(2, { nextFollowUp: '2026-07-13' }),
    client(3, { nextFollowUp: '2026-07-14' }),
    client(4, { nextFollowUp: '' }),
  ];
  assert.deepEqual(filterAndSortClients(clients, filters({ followUp: 'Vencidos' }), today).map((item) => item.id), [1]);
  assert.deepEqual(filterAndSortClients(clients, filters({ followUp: 'Hoy' }), today).map((item) => item.id), [2]);
  assert.deepEqual(filterAndSortClients(clients, filters({ followUp: 'Próximos' }), today).map((item) => item.id), [3]);
  assert.deepEqual(filterAndSortClients(clients, filters({ followUp: 'Sin fecha' }), today).map((item) => item.id), [4]);
});

test('ordena por urgencia de seguimiento y deja terminales al final', () => {
  const clients = [
    client(1, { nextFollowUp: '', temperature: 'Caliente' }),
    client(2, { nextFollowUp: '2026-07-14' }),
    client(3, { nextFollowUp: '2026-07-13' }),
    client(4, { nextFollowUp: '2026-07-10' }),
    client(5, { nextFollowUp: '2026-07-09', pipeline: 'Cerrado' }),
  ];
  const result = filterAndSortClients(clients, filters({ sort: 'Seguimiento urgente' }), today);
  assert.deepEqual(result.map((item) => item.id), [4, 3, 2, 1, 5]);
});

test('ordena por último contacto descendente con fechas vacías al final', () => {
  const clients = [
    client(1, { lastContact: '2026-07-10' }),
    client(2, { lastContact: '' }),
    client(3, { lastContact: '2026-07-12' }),
  ];
  const result = filterAndSortClients(clients, filters({ sort: 'Último contacto' }), today);
  assert.deepEqual(result.map((item) => item.id), [3, 1, 2]);
});

test('ordena alfabéticamente sin alterar la lista original', () => {
  const clients = [client(1, { name: 'Zulema' }), client(2, { name: 'Álvaro' })];
  const result = filterAndSortClients(clients, filters({ sort: 'Nombre A-Z' }), today);
  assert.deepEqual(result.map((item) => item.id), [2, 1]);
  assert.deepEqual(clients.map((item) => item.id), [1, 2]);
});
