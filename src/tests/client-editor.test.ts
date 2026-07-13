import assert from 'node:assert/strict';
import test from 'node:test';
import { clientFromFormValues, upsertClient } from '../client-editor.js';
import type { Client } from '../models.js';

const baseValues: Record<string, string> = {
  name: '  Franco Test  ',
  phone: ' 3510000000 ',
  email: ' test@example.com ',
  interest: ' Departamento en General Paz ',
  status: 'Lead',
  temperature: 'Caliente',
  pipeline: 'Calificado',
  lastContact: '2026-07-13',
  nextFollowUp: '2026-07-14',
  budget: 'USD 90.000',
  paymentMethod: 'Contado',
  purchaseTimeframe: '0-3 meses',
  purpose: 'Vivir',
  knowsArea: 'Sí',
  canMoveForward: 'Sí',
  objections: 'Ninguna',
  notes: 'Cliente listo para avanzar',
};

test('clientFromFormValues normaliza los campos y conserva el id', () => {
  const client = clientFromFormValues(42, baseValues);
  assert.equal(client.id, 42);
  assert.equal(client.name, 'Franco Test');
  assert.equal(client.phone, '5493510000000');
  assert.equal(client.temperature, 'Caliente');
  assert.equal(client.notes, 'Cliente listo para avanzar');
});

test('clientFromFormValues usa una temperatura segura ante valores inválidos', () => {
  const client = clientFromFormValues(1, { ...baseValues, temperature: 'Desconocida' });
  assert.equal(client.temperature, 'Tibio');
});

test('upsertClient reemplaza un cliente sin duplicarlo', () => {
  const original: Client = clientFromFormValues(7, baseValues);
  const edited: Client = { ...original, name: 'Cliente editado' };
  const result = upsertClient([original], edited);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.name, 'Cliente editado');
  assert.notEqual(result, [original]);
});

test('upsertClient agrega un cliente cuando el id no existe', () => {
  const first = clientFromFormValues(1, baseValues);
  const second = clientFromFormValues(2, { ...baseValues, name: 'Segundo cliente', phone: '3510000001' });
  const result = upsertClient([first], second);

  assert.equal(result.length, 2);
  assert.equal(result[1]?.name, 'Segundo cliente');
});
