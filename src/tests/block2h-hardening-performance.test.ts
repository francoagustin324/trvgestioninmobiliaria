import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { evaluateRelevantMatchAlertConditions } from '../commercial-alert-engine.js';
import { matchPropertiesForClient, matchRelevantPropertiesForClient, relevantPropertyCandidatesForClient } from '../property-matching.js';
import type { Client, Property } from '../models.js';

const ZONES = Array.from({ length: 100 }, (_, index) => `Zona ${String(index + 1).padStart(3, '0')}`);
const TYPES = ['Departamento', 'Casa', 'Terreno', 'Comercial'] as const;

function client(id: number): Client {
  const zone = ZONES[(id * 17) % ZONES.length]!;
  const propertyType = TYPES[id % TYPES.length]!;
  const bedrooms = propertyType === 'Terreno' || propertyType === 'Comercial' ? undefined : 1 + (id % 4);
  return {
    id,
    uid: `10000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    revision: 1,
    name: `Cliente ${id}`,
    phone: `549351${String(id).padStart(7, '0')}`,
    interest: `${propertyType} ${bedrooms ?? ''} ${zone} preferencia-${id}`,
    status: 'Lead',
    temperature: id % 3 === 0 ? 'Caliente' : 'Tibio',
    pipeline: 'Calificado',
    budget: `USD ${110000 + (id % 75) * 2000}`,
    currency: 'USD',
    paymentMethod: id % 2 === 0 ? 'Contado' : 'Financiación',
    zones: zone,
    propertyType,
    operation: 'Compra',
    ...(bedrooms ? { bedrooms } : {}),
    canMoveForward: id % 5 === 0 ? 'Sí' : 'No',
    preferences: `preferencia-${id}`,
    assignedToId: 1,
    createdById: 1,
  };
}

function property(id: number): Property {
  const zone = ZONES[(id * 19) % ZONES.length]!;
  const type = TYPES[id % TYPES.length]!;
  const bedrooms = type === 'Terreno' || type === 'Comercial' ? undefined : 1 + (id % 4);
  return {
    id,
    uid: `20000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    revision: 1,
    title: `${type} ${id}`,
    address: `${zone}, Córdoba`,
    type,
    operation: 'Venta',
    price: 85000 + id * 100,
    owner: 'Propietario',
    status: 'Activa',
    ...(bedrooms ? { bedrooms } : {}),
    paymentMethod: id % 2 === 0 ? 'Contado' : 'Financiación',
    assignedToId: 1,
    createdById: 1,
  };
}

test('Block 2H performance gate: 1000 clientes variados x 1000 propiedades variadas no vuelve al cruce bloqueante', () => {
  const clients=Array.from({length:1000},(_,i)=>client(i+1));
  const properties=Array.from({length:1000},(_,i)=>property(i+1));
  assert.ok(new Set(clients.map((item) => item.interest)).size > 900, 'el gate debe usar perfiles comerciales variados');
  assert.ok(new Set(properties.map((item) => `${item.type}|${item.address}|${item.price}`)).size > 900, 'el gate debe usar inventario variado');
  const candidateCounts = clients.map((item) => relevantPropertyCandidatesForClient(item, properties).length);
  assert.ok(Math.max(...candidateCounts) <= 96, 'ningún perfil puede volver a evaluar las 1000 propiedades completas');
  const started=performance.now();
  const result=evaluateRelevantMatchAlertConditions({
    organizationId:'11111111-1111-4111-8111-111111111111',
    clients,
    properties,
    activityLog:[],
    actor:{id:1,role:'Dueño'},
  });
  const elapsed=performance.now()-started;
  console.log(`BLOCK2H_MATCH_AFTER_MS=${elapsed.toFixed(2)}`);
  assert.ok(result.length > 0, 'el dataset variado debe conservar oportunidades relevantes');
  assert.ok(
    elapsed < 1500,
    `matching 1000x1000 tardó ${elapsed.toFixed(2)}ms; el gate razonable es <1500ms para impedir regresiones a segundos`,
  );
});


test('Block 2H matching acotado conserva el mejor match exhaustivo en casos representativos', () => {
  const properties = Array.from({ length: 200 }, (_, index) => property(index + 1));
  for (const id of [7, 41, 88, 133, 197]) {
    const current = client(id);
    const exhaustive = matchPropertiesForClient(current, properties).find((match) => match.level === 'Alta');
    const bounded = matchRelevantPropertiesForClient(current, properties).find((match) => match.level === 'Alta');
    assert.equal(bounded?.property.id, exhaustive?.property.id, `perfil ${id}: el candidato acotado debe conservar el mejor match alto`);
    assert.equal(bounded?.score, exhaustive?.score, `perfil ${id}: el score del mejor match debe ser idéntico`);
  }
});
