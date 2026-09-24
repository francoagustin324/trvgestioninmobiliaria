import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client } from '../models.js';
import { argentinaNationalNumber, emailIdentity, findDuplicateClient, findDuplicateClientByEmail, formatPhone, isPlausiblePhone, normalizePhone, phoneIdentity } from '../phone-normalizer.js';

const client = (id: number, phone: string): Client => ({
  id,
  name: `Cliente ${id}`,
  phone,
  interest: 'Departamento',
  status: 'Lead',
  temperature: 'Tibio',
  pipeline: 'Nuevo',
});

test('normaliza variantes argentinas al formato compatible con WhatsApp', () => {
  assert.equal(normalizePhone('351 511-0069'), '5493515110069');
  assert.equal(normalizePhone('+54 9 351 5110069'), '5493515110069');
  assert.equal(normalizePhone('0351 15 5110069'), '5493515110069');
});

test('genera la misma identidad para formatos equivalentes', () => {
  assert.equal(phoneIdentity('0351 15 5110069'), phoneIdentity('+54 9 351 5110069'));
  assert.equal(argentinaNationalNumber('5493515110069'), '3515110069');
});

test('detecta un cliente duplicado aunque el formato del teléfono sea distinto', () => {
  const existing = client(7, '+54 9 351 5110069');
  const duplicate = findDuplicateClient([existing], '0351 15 5110069');
  assert.equal(duplicate?.id, 7);
});

test('permite editar el mismo cliente sin marcarlo como duplicado', () => {
  const existing = client(7, '5493515110069');
  const duplicate = findDuplicateClient([existing], '3515110069', 7);
  assert.equal(duplicate, null);
});

test('valida longitudes plausibles y conserva números internacionales desconocidos', () => {
  assert.equal(isPlausiblePhone('1234'), false);
  assert.equal(isPlausiblePhone('+34 612 345 678'), true);
  assert.equal(normalizePhone('+34 612 345 678'), '34612345678');
});

test('muestra los números argentinos en formato legible', () => {
  assert.equal(formatPhone('5493515110069'), '+54 9 3515110069');
});


test('normaliza email para identidad exacta sin distinguir mayúsculas ni espacios', () => {
  assert.equal(emailIdentity('  JUAN.PEREZ@Example.COM '), 'juan.perez@example.com');
  const existing = { ...client(8, ''), email: 'Juan.Perez@Example.com' };
  assert.equal(findDuplicateClientByEmail([existing], ' juan.perez@example.COM ')?.id, 8);
  assert.equal(findDuplicateClientByEmail([existing], 'juan.perez@example.com', 8), null);
});

test('email duplicado exige coincidencia exacta normalizada y no usa coincidencias débiles', () => {
  const existing = { ...client(9, ''), email: 'juan+piso@example.com' };
  assert.equal(findDuplicateClientByEmail([existing], 'juan+duplex@example.com'), null);
  assert.equal(findDuplicateClientByEmail([existing], 'juan@example.com'), null);
});
