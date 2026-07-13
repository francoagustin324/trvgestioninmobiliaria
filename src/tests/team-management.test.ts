import assert from 'node:assert/strict';
import test from 'node:test';
import { supabaseServerHeaders } from '../server/team-management.js';

test('una clave moderna solo se envía como apikey', () => {
  const headers = supabaseServerHeaders('sb_secret_example');
  assert.equal(headers.apikey, 'sb_secret_example');
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers['Content-Type'], 'application/json');
});

test('service_role heredado conserva Authorization Bearer', () => {
  const key = 'legacy-service-role-jwt';
  const headers = supabaseServerHeaders(key);
  assert.equal(headers.apikey, key);
  assert.equal(headers.Authorization, `Bearer ${key}`);
});

test('la clave no se transforma ni se registra en otros encabezados', () => {
  const key = 'sb_secret_private_value';
  const headers = supabaseServerHeaders(key);
  assert.deepEqual(Object.keys(headers).sort(), ['Content-Type', 'apikey'].sort());
});
