import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clientCompletenessScore,
  findHistoricalDuplicateGroups,
  mergeDuplicateClients,
  recommendedPrimaryClient,
} from '../client-duplicates.js';
import type { Client } from '../models.js';

function client(overrides: Partial<Client>): Client {
  return {
    id: 1,
    name: 'Franco Solís',
    phone: '351 5110069',
    email: '',
    interest: 'Departamento en General Paz',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    lastContact: '',
    nextFollowUp: '',
    budget: '',
    paymentMethod: '',
    purchaseTimeframe: '',
    purpose: 'Vivir',
    knowsArea: 'No',
    canMoveForward: 'No',
    objections: '',
    notes: '',
    ...overrides,
  };
}

test('detecta como duplicados formatos telefónicos equivalentes', () => {
  const clients = [
    client({ id: 1, phone: '351 5110069' }),
    client({ id: 2, phone: '+54 9 351 5110069' }),
    client({ id: 3, phone: '0351 15 5110069' }),
    client({ id: 4, phone: '351 2223344' }),
  ];

  const groups = findHistoricalDuplicateGroups(clients);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.clients.map((item) => item.id), [1, 2, 3]);
});

test('recomienda conservar el registro más completo', () => {
  const incomplete = client({ id: 1 });
  const complete = client({
    id: 2,
    email: 'franco@example.com',
    budget: 'USD 90.000',
    paymentMethod: 'Contado',
    purchaseTimeframe: '0-3 meses',
    notes: 'Cliente calificado',
  });
  const group = findHistoricalDuplicateGroups([incomplete, complete])[0];

  assert.ok(group);
  assert.ok(clientCompletenessScore(complete) > clientCompletenessScore(incomplete));
  assert.equal(recommendedPrimaryClient(group).id, 2);
});

test('fusiona datos sin perder información útil', () => {
  const primary = client({
    id: 1,
    name: 'Franco Solís',
    phone: '351 5110069',
    temperature: 'Tibio',
    lastContact: '2026-07-10',
    nextFollowUp: '2026-07-20',
    notes: 'Primer contacto por Zonaprop',
  });
  const duplicate = client({
    id: 2,
    name: 'Franco',
    phone: '+54 9 351 5110069',
    email: 'franco@example.com',
    temperature: 'Caliente',
    pipeline: 'Calificado',
    lastContact: '2026-07-13',
    nextFollowUp: '2026-07-14',
    budget: 'USD 100.000',
    paymentMethod: 'Contado',
    objections: 'Necesita balcón',
    notes: 'Confirmó presupuesto',
  });
  const unrelated = client({ id: 3, phone: '351 2223344', name: 'Otra persona' });
  const original = structuredClone([primary, duplicate, unrelated]);

  const result = mergeDuplicateClients([primary, duplicate, unrelated], 1);

  assert.equal(result.clients.length, 2);
  assert.deepEqual(result.removedIds, [2]);
  assert.equal(result.mergedClient.id, 1);
  assert.equal(result.mergedClient.phone, '5493515110069');
  assert.equal(result.mergedClient.email, 'franco@example.com');
  assert.equal(result.mergedClient.temperature, 'Caliente');
  assert.equal(result.mergedClient.lastContact, '2026-07-13');
  assert.equal(result.mergedClient.nextFollowUp, '2026-07-14');
  assert.equal(result.mergedClient.budget, 'USD 100.000');
  assert.match(result.mergedClient.notes ?? '', /Primer contacto por Zonaprop/);
  assert.match(result.mergedClient.notes ?? '', /Registro fusionado: Franco/);
  assert.match(result.mergedClient.notes ?? '', /Confirmó presupuesto/);
  assert.deepEqual([primary, duplicate, unrelated], original);
});

test('permite elegir cuál registro conservar', () => {
  const first = client({ id: 1, name: 'Nombre principal', phone: '351 5110069' });
  const second = client({ id: 2, name: 'Nombre elegido', phone: '+54 9 351 5110069' });
  const result = mergeDuplicateClients([first, second], 2);

  assert.equal(result.mergedClient.id, 2);
  assert.equal(result.mergedClient.name, 'Nombre elegido');
  assert.deepEqual(result.removedIds, [1]);
});

test('rechaza una fusión cuando ya no existen duplicados', () => {
  assert.throws(
    () => mergeDuplicateClients([client({ id: 1 })], 1),
    /ya no tiene duplicados/,
  );
});
