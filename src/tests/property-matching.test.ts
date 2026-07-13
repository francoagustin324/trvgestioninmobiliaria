import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client, Property } from '../models.js';
import {
  evaluatePropertyMatch,
  extractBedrooms,
  matchClientsForProperty,
  matchPropertiesForClient,
  parseUsdBudget,
} from '../property-matching.js';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 1,
    name: 'Lucía Martín',
    phone: '5493515550101',
    interest: 'Departamento de 2 dormitorios en Nueva Córdoba',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Calificado',
    budget: 'USD 90.000',
    paymentMethod: 'Contado',
    canMoveForward: 'Sí',
    objections: 'Busca balcón y buena luz natural',
    ...overrides,
  };
}

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: 1,
    title: 'Departamento luminoso',
    address: 'Nueva Córdoba, Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 85000,
    owner: 'Propietario',
    status: 'Activa',
    bedrooms: 2,
    bathrooms: 1,
    paymentMethod: 'Contado',
    features: 'Balcón y excelente luz natural',
    ...overrides,
  };
}

test('interpreta presupuestos inmobiliarios habituales', () => {
  assert.equal(parseUsdBudget('USD 90.000'), 90000);
  assert.equal(parseUsdBudget('hasta 85k'), 85000);
  assert.equal(parseUsdBudget('entre 80 y 90 mil dólares'), 90000);
  assert.equal(parseUsdBudget('US$ 100'), 100000);
  assert.equal(parseUsdBudget(''), null);
});

test('extrae dormitorios escritos con números o palabras', () => {
  assert.equal(extractBedrooms('Busco 2 dormitorios con balcón'), 2);
  assert.equal(extractBedrooms('Casa de tres habitaciones'), 3);
  assert.equal(extractBedrooms('Sin preferencia'), null);
});

test('genera una coincidencia alta y explica los motivos', () => {
  const match = evaluatePropertyMatch(client(), property());
  assert.ok(match);
  assert.equal(match.level, 'Alta');
  assert.ok(match.score >= 70);
  assert.ok(match.reasons.some((reason) => reason.includes('presupuesto')));
  assert.ok(match.reasons.some((reason) => reason.includes('Zona')));
  assert.ok(match.reasons.some((reason) => reason.includes('2 dormitorios')));
  assert.ok(match.reasons.some((reason) => reason.includes('balcón')));
});

test('descarta propiedades claramente fuera del presupuesto', () => {
  const match = evaluatePropertyMatch(client({ budget: 'USD 80.000' }), property({ price: 100000 }));
  assert.equal(match, null);
});

test('mantiene una coincidencia posible hasta diez por ciento arriba con advertencia', () => {
  const match = evaluatePropertyMatch(client({ budget: 'USD 80.000' }), property({ price: 86000 }));
  assert.ok(match);
  assert.ok(match.warnings.some((warning) => warning.includes('por encima')));
});

test('descarta tipos de propiedad incompatibles', () => {
  const match = evaluatePropertyMatch(client({ interest: 'Casa en Nueva Córdoba' }), property({ type: 'Departamento' }));
  assert.equal(match, null);
});

test('no recomienda propiedades cerradas ni clientes terminales', () => {
  assert.equal(evaluatePropertyMatch(client(), property({ status: 'Cerrada' })), null);
  assert.equal(evaluatePropertyMatch(client({ pipeline: 'Perdido' }), property()), null);
});

test('ordena propiedades por puntaje y no modifica los datos originales', () => {
  const properties = [
    property({ id: 1, address: 'General Paz, Córdoba', features: '' }),
    property({ id: 2, address: 'Nueva Córdoba, Córdoba', features: 'Balcón y luz natural' }),
  ];
  const snapshot = structuredClone(properties);
  const matches = matchPropertiesForClient(client(), properties);
  assert.equal(matches[0]?.property.id, 2);
  assert.deepEqual(properties, snapshot);
});

test('encuentra compradores compatibles para una propiedad y excluye cerrados', () => {
  const clients = [
    client({ id: 1, name: 'Lucía' }),
    client({ id: 2, name: 'Pedro', pipeline: 'Cerrado' }),
    client({ id: 3, name: 'Ana', budget: 'USD 70.000' }),
  ];
  const matches = matchClientsForProperty(property(), clients);
  assert.deepEqual(matches.map((match) => match.client.id), [1]);
});
