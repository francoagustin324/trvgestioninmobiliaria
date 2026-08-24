import assert from 'node:assert/strict';
import test from 'node:test';
import { visitReadiness } from '../lead-qualification.js';
import type { Client, Property, Visit } from '../models.js';
import { coordinateVisit } from '../visit-workflow.js';

function readyLead(overrides: Partial<Client> = {}): Client {
  return {
    id: 501,
    name: 'Lead calificado',
    phone: '+54 9 351 555-0501',
    interest: 'Dúplex',
    budget: '120000',
    currency: 'USD',
    paymentMethod: 'Contado',
    zones: 'Docta, Manantiales',
    purpose: 'Vivir',
    purchaseTimeframe: '0-3 meses',
    canMoveForward: 'Sí',
    knowsArea: 'Sí',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Calificado',
    nextAction: 'Enviar opciones',
    nextFollowUp: '2026-08-25',
    assignedToId: 7,
    createdById: 7,
    ...overrides,
  };
}

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: 601,
    title: 'Dúplex Docta',
    address: 'Docta, Córdoba',
    type: 'Dúplex',
    operation: 'Venta',
    price: 120000,
    owner: 'Propietario',
    status: 'Disponible',
    assignedToId: 7,
    createdById: 7,
    ...overrides,
  };
}

const actor = { id: 7, role: 'Corredor' as const };
const now = new Date(2026, 7, 24, 12, 0, 0, 0);

function coordinate(client: Client, visits: Visit[] = []) {
  return coordinateVisit({
    visits,
    client,
    property: property(),
    actor,
    localDate: '2026-08-28',
    localTime: '15:30',
    now,
  });
}

function assertBlocked(overrides: Partial<Client>, expectedBlocker: string): void {
  const client = readyLead(overrides);
  const before = structuredClone(client);
  const visits: Visit[] = [];
  const readiness = visitReadiness(client, []);
  assert.ok(readiness.warning);
  assert.ok(readiness.missing.includes(expectedBlocker), JSON.stringify(readiness.missing));
  assert.throws(() => coordinate(client, visits), /No conviene coordinar todavía/i);
  assert.deepEqual(client, before);
  assert.deepEqual(visits, []);
  assert.equal(client.pipeline, before.pipeline);
  assert.equal(client.nextAction, before.nextAction);
  assert.equal(client.nextFollowUp, before.nextFollowUp);
}

test('P1.1-A2.1 falta presupuesto bloquea visita sin writes parciales', () => {
  assertBlocked({ budget: undefined }, 'presupuesto');
});

test('P1.1-A2.1 falta moneda bloquea aunque el presupuesto tenga monto', () => {
  assertBlocked({ currency: undefined }, 'moneda');
});

test('P1.1-A2.1 falta forma de pago bloquea visita', () => {
  assertBlocked({ paymentMethod: undefined }, 'forma de pago');
});

test('P1.1-A2.1 falta zona o barrios bloquea visita', () => {
  assertBlocked({ zones: '' }, 'zona/barrios');
});

test('P1.1-A2.1 finalidad sin definir bloquea visita', () => {
  assertBlocked({ purpose: undefined }, 'finalidad');
});

test('P1.1-A2.1 finalidad fuera de Vivir, Invertir u Otra no habilita visita', () => {
  assertBlocked({ purpose: 'Sin definir' }, 'finalidad');
});

test('P1.1-A2.1 plazo o urgencia sin definir bloquea visita', () => {
  assertBlocked({ purchaseTimeframe: undefined, urgency: undefined }, 'plazo / urgencia');
});

test('P1.1-A2.1 capacidad sin confirmar bloquea visita', () => {
  assertBlocked({ canMoveForward: undefined }, 'capacidad de avance');
});

test('P1.1-A2.1 Depende de vender bloquea visita', () => {
  assertBlocked({ canMoveForward: 'Depende de vender' }, 'capacidad de avance');
});

test('P1.1-A2.1 Todavía no bloquea visita', () => {
  assertBlocked({ canMoveForward: 'Todavía no' }, 'capacidad de avance');
});

test('P1.1-A2.1 No bloquea visita por falta de capacidad real', () => {
  assertBlocked({ canMoveForward: 'No' }, 'capacidad de avance');
});

test('P1.1-A2.1 crédito hipotecario en trámite todavía no habilita visita', () => {
  assertBlocked({ paymentMethod: 'Crédito hipotecario', creditPossible: 'En trámite' }, 'situación del crédito');
});

test('P1.1-A2.1 crédito hipotecario sin estado bloquea visita', () => {
  assertBlocked({ paymentMethod: 'Crédito hipotecario', creditPossible: undefined }, 'situación del crédito');
});

test('P1.1-A2.1 Depende del crédito sólo habilita con crédito suficientemente resuelto', () => {
  assertBlocked({ paymentMethod: 'Crédito hipotecario', creditPossible: 'En trámite', canMoveForward: 'Depende del crédito' }, 'situación del crédito');
  const client = readyLead({
    paymentMethod: 'Crédito hipotecario',
    creditPossible: 'Aprobado',
    canMoveForward: 'Depende del crédito',
  });
  assert.deepEqual(visitReadiness(client, []), { warning: null, missing: [] });
  assert.doesNotThrow(() => coordinate(client));
});

test('P1.1-A2.1 conoce la zona No bloquea visita', () => {
  assertBlocked({ knowsArea: 'No' }, 'aceptación de la zona');
});

test('P1.1-A2.1 Lead correctamente calificado conserva exactamente el flujo A2', () => {
  const client = readyLead({ pipeline: 'Contactado' });
  assert.deepEqual(visitReadiness(client, []), { warning: null, missing: [] });
  const result = coordinate(client);
  assert.equal(result.visit.status, 'Coordinada');
  assert.equal(result.visit.clientId, client.id);
  assert.equal(result.visit.propertyId, 601);
  assert.equal(result.client.pipeline, 'Visita coordinada');
  assert.equal(result.client.nextAction, 'Visita · Dúplex Docta');
  assert.equal(result.client.nextFollowUp, '2026-08-28');
  assert.equal(result.activity.action, 'Visita coordinada');
});

test('P1.1-A2.1 permisos existentes siguen bloqueando una propiedad ajena', () => {
  const foreign = property({ assignedToId: 99 });
  assert.throws(() => coordinateVisit({
    visits: [],
    client: readyLead(),
    property: foreign,
    actor,
    localDate: '2026-08-28',
    localTime: '15:30',
    now,
  }), /permiso/i);
});

test('P1.1-A2.1 terminal sigue bloqueado antes del gate de calificación', () => {
  assert.throws(() => coordinate(readyLead({ pipeline: 'Ganado', budget: undefined })), /ganado o perdido/i);
  assert.throws(() => coordinate(readyLead({ pipeline: 'Perdido', budget: undefined })), /ganado o perdido/i);
});