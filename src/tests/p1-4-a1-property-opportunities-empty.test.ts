import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client, Property } from '../models.js';
import { buildPropertyOpportunities } from '../property-opportunities.js';

const property: Property = {
  id: 20,
  title: 'Departamento Centro',
  address: 'Centro, Córdoba',
  type: 'Departamento',
  operation: 'Venta',
  price: 100000,
  owner: 'Test',
  status: 'Activa',
};

const incompatible: Client = {
  id: 20,
  name: 'Busca casa económica',
  phone: '5493515550999',
  interest: 'Casa en Urca',
  status: 'Lead',
  temperature: 'Tibio',
  pipeline: 'Calificado',
  propertyType: 'Casa',
  zones: 'Urca',
  budget: 'USD 50.000',
};

test('P1.4-A1 propiedad sin matches devuelve lista vacía del matcher canónico', () => {
  assert.deepEqual(buildPropertyOpportunities(property, [incompatible]), []);
});
