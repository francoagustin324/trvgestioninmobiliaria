import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { evaluateRelevantMatchAlertConditions } from '../commercial-alert-engine.js';
import type { Client, Property } from '../models.js';

function client(id: number): Client {
  return {
    id,
    uid: `10000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    revision: 1,
    name: `Cliente ${id}`,
    phone: `549351${String(id).padStart(7, '0')}`,
    interest: 'Departamento 2 dormitorios General Paz',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Calificado',
    budget: 'USD 200000',
    currency: 'USD',
    paymentMethod: 'Contado',
    zones: 'General Paz',
    propertyType: 'Departamento',
    operation: 'Compra',
    bedrooms: 2,
    canMoveForward: 'Sí',
    assignedToId: 1,
    createdById: 1,
  };
}

function property(id: number): Property {
  return {
    id,
    uid: `20000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    revision: 1,
    title: `Departamento ${id}`,
    address: 'General Paz, Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 100000 + id,
    owner: 'Propietario',
    status: 'Activa',
    bedrooms: 2,
    paymentMethod: 'Contado',
    assignedToId: 1,
    createdById: 1,
  };
}

test('Block 2H benchmark baseline: 1000 clientes x 1000 propiedades', () => {
  const clients=Array.from({length:1000},(_,i)=>client(i+1));
  const properties=Array.from({length:1000},(_,i)=>property(i+1));
  const started=performance.now();
  const result=evaluateRelevantMatchAlertConditions({
    organizationId:'11111111-1111-4111-8111-111111111111',
    clients,
    properties,
    activityLog:[],
    actor:{id:1,role:'Dueño'},
  });
  const elapsed=performance.now()-started;
  console.log(`BLOCK2H_MATCH_BASELINE_MS=${elapsed.toFixed(2)}`);
  assert.equal(result.length,1000);
});
