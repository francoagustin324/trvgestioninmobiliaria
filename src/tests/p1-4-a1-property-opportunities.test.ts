import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Client, Property } from '../models.js';
import {
  buildPropertyOpportunities,
  DEFAULT_OPPORTUNITY_FILTERS,
  filterPropertyOpportunities,
  propertyMatchingDataIssues,
  terminalClientsForOpportunities,
} from '../property-opportunities.js';
import { matchClientsForProperty } from '../property-matching.js';

const property: Property = {
  id: 1,
  title: 'Departamento 2 dormitorios General Paz',
  address: 'General Paz, Córdoba',
  type: 'Departamento',
  operation: 'Venta',
  price: 100000,
  owner: 'Propietario test',
  status: 'Activa',
  bedrooms: 2,
  features: 'Balcón y cochera',
  paymentMethod: 'Contado',
};

function client(overrides: Partial<Client>): Client {
  return {
    id: 1,
    name: 'Cliente base',
    phone: '5493515550001',
    interest: 'Departamento en General Paz de 2 dormitorios',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Calificado',
    budget: 'USD 120.000',
    propertyType: 'Departamento',
    zones: 'General Paz',
    bedrooms: 2,
    ...overrides,
  };
}

const clients: Client[] = [
  client({
    id: 1,
    name: 'Ana Alta',
    temperature: 'Caliente',
    features: 'balcón cochera',
    paymentMethod: 'Contado',
    canMoveForward: 'Sí',
    nextAction: 'Llamar por esta opción',
    nextFollowUp: '2026-09-08',
  }),
  client({
    id: 2,
    name: 'Bruno Buena',
    zones: '',
    features: '',
    paymentMethod: '',
    nextAction: 'Revisar disponibilidad',
  }),
  client({
    id: 3,
    name: 'Carla Posible',
    budget: '',
    bedrooms: undefined,
    features: '',
    paymentMethod: '',
  }),
  client({
    id: 4,
    name: 'Dario Ganado',
    pipeline: 'Ganado',
    status: 'Operación ganada',
    temperature: 'Caliente',
    features: 'balcón cochera',
    paymentMethod: 'Contado',
  }),
  client({
    id: 5,
    name: 'Elena Perdida',
    pipeline: 'Perdido',
    status: 'Operación perdida',
    temperature: 'Caliente',
    features: 'balcón cochera',
    paymentMethod: 'Contado',
  }),
];

test('P1.4-A1 consume varios clientes y conserva orden y score exactos del matching canónico', () => {
  const canonical = matchClientsForProperty(property, clients);
  const opportunities = buildPropertyOpportunities(property, clients);

  assert.ok(opportunities.length >= 3);
  assert.deepEqual(
    opportunities.map(({ match }) => ({ id: match.client.id, score: match.score, level: match.level })),
    canonical.map((match) => ({ id: match.client.id, score: match.score, level: match.level })),
  );
  assert.deepEqual(opportunities.map(({ match }) => match.client.name), ['Ana Alta', 'Bruno Buena', 'Carla Posible']);
  assert.ok(opportunities[0]!.match.reasons.includes('Dentro del presupuesto'));
  assert.ok(opportunities[0]!.match.reasons.some((reason) => reason.startsWith('Zona:')));
  assert.ok(opportunities[2]!.match.warnings.includes('Falta confirmar presupuesto'));
});

test('P1.4-A1 filtra compatibilidad alta y seguimiento sin recalcular resultados', () => {
  const opportunities = buildPropertyOpportunities(property, clients);
  const high = filterPropertyOpportunities(opportunities, { ...DEFAULT_OPPORTUNITY_FILTERS, compatibility: 'high' });
  assert.ok(high.length >= 1);
  assert.ok(high.every(({ match }) => match.level === 'Alta'));

  const withFollowUp = filterPropertyOpportunities(opportunities, { ...DEFAULT_OPPORTUNITY_FILTERS, followUp: 'with' });
  assert.deepEqual(withFollowUp.map(({ match }) => match.client.name), ['Ana Alta']);

  const withoutFollowUp = filterPropertyOpportunities(opportunities, { ...DEFAULT_OPPORTUNITY_FILTERS, followUp: 'without' });
  assert.ok(withoutFollowUp.some(({ match }) => match.client.name === 'Bruno Buena'));
  assert.ok(withoutFollowUp.every(({ match }) => match.client.name !== 'Ana Alta'));

  const search = filterPropertyOpportunities(opportunities, { ...DEFAULT_OPPORTUNITY_FILTERS, search: 'falta confirmar presupuesto' });
  assert.deepEqual(search.map(({ match }) => match.client.name), ['Carla Posible']);
});

test('P1.4-A1 mantiene Ganado/Perdido fuera de oportunidades y los identifica aparte sin score', () => {
  const opportunities = buildPropertyOpportunities(property, clients);
  assert.ok(opportunities.every(({ match }) => !['Ganado', 'Perdido'].includes(String(match.client.pipeline))));
  assert.deepEqual(terminalClientsForOpportunities(clients).map((item) => item.name), ['Dario Ganado', 'Elena Perdida']);
});

test('P1.4-A1 detecta propiedad con información básica insuficiente sin inventar matching', () => {
  assert.deepEqual(propertyMatchingDataIssues({ ...property, address: '', type: '', price: 0 }), [
    'tipo de propiedad',
    'ubicación',
    'precio',
  ]);
  assert.deepEqual(propertyMatchingDataIssues(property), []);
});

test('P1.4-A1 no implementa un segundo motor y reutiliza visibilidad y explicación existentes', () => {
  const coreSource = readFileSync('src/property-opportunities.ts', 'utf8');
  const uiSource = readFileSync('src/property-opportunities-ui.ts', 'utf8');
  const workspaceSource = readFileSync('src/mvp-properties-workspace.ts', 'utf8');

  assert.match(coreSource, /matchClientsForProperty/);
  assert.equal((coreSource.match(/matchClientsForProperty\(/g) ?? []).length, 1);
  assert.doesNotMatch(coreSource, /evaluatePropertyMatch/);
  assert.doesNotMatch(coreSource, /score\s*[+\-*/]?=/);
  assert.doesNotMatch(uiSource, /from ['"]\.\/property-matching\.js['"]/);
  assert.match(uiSource, /propertyMatchReasonsHtml/);
  assert.match(uiSource, /visibleClients\(\)/);
  assert.match(uiSource, /visibleProperties\(\)/);
  assert.doesNotMatch(uiSource, /MutationObserver/);
  assert.match(uiSource, /clientes seleccionados/);
  assert.match(uiSource, /no envía mensajes/);
  assert.match(workspaceSource, /renderMvpProperties\(container\)/);
});
