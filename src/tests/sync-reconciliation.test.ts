import assert from 'node:assert/strict';
import test from 'node:test';
import { initialData, type Client, type CrmData } from '../models.js';
import { reconcileCrmSnapshots, reconciliationMessage } from '../sync-reconciliation.js';

function crmWithClients(clients: Client[]): CrmData {
  return {
    ...structuredClone(initialData),
    clients,
    properties: [],
    contacts: [],
    reminders: [],
    fichas: [],
    conversations: [],
    activityLog: [],
  };
}

function lead(id: number, name: string, budget = 'USD 85.000'): Client {
  return {
    id,
    name,
    phone: `35150000${id}`,
    interest: 'Departamento',
    status: 'Nuevo',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    budget,
  };
}

test('une un lead guardado sólo en la computadora sin borrar los de la nube', () => {
  const cloud = crmWithClients([lead(1, 'Cliente 1')]);
  const local = crmWithClients([lead(1, 'Cliente 1'), lead(2, 'Prueba 2')]);
  const result = reconcileCrmSnapshots(local, cloud);

  assert.equal(result.canMergeSafely, true);
  assert.equal(result.localLeadCount, 2);
  assert.equal(result.cloudLeadCount, 1);
  assert.deepEqual(result.merged.clients.map((item) => item.name), ['Cliente 1', 'Prueba 2']);
  assert.deepEqual(result.differences.find((item) => item.key === 'clients')?.localOnly, ['Prueba 2']);
  assert.match(reconciliationMessage(result), /Se agregarán a la nube: Prueba 2/);
});

test('conserva registros exclusivos de la nube al hacer la unión', () => {
  const local = crmWithClients([lead(1, 'Cliente 1')]);
  const cloud = crmWithClients([lead(1, 'Cliente 1'), lead(3, 'Cliente del celular')]);
  const result = reconcileCrmSnapshots(local, cloud);

  assert.equal(result.canMergeSafely, true);
  assert.deepEqual(result.merged.clients.map((item) => item.name), ['Cliente 1', 'Cliente del celular']);
  assert.deepEqual(result.differences.find((item) => item.key === 'clients')?.cloudOnly, ['Cliente del celular']);
});

test('frena la unión automática cuando el mismo lead fue editado distinto', () => {
  const local = crmWithClients([lead(1, 'Cliente 1', 'USD 90.000')]);
  const cloud = crmWithClients([lead(1, 'Cliente 1', 'USD 85.000')]);
  const result = reconcileCrmSnapshots(local, cloud);

  assert.equal(result.canMergeSafely, false);
  assert.equal(result.conflictCount, 1);
  assert.deepEqual(result.differences.find((item) => item.key === 'clients')?.conflicts, ['Cliente 1']);
});
