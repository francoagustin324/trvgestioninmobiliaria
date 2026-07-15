import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const upload = readFileSync('src/property-photo-upload.ts', 'utf8');
const server = readFileSync('src/server/property-photo-storage.ts', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('la carga de fotos no ejecuta la consulta de membresía incompatible del cliente', () => {
  assert.equal(upload.includes('getCloudMembershipContext'), false);
  assert.ok(upload.includes('getCloudSession'));
  assert.ok(upload.includes("select', 'organization_id,status'"));
});

test('el servidor valida la inmobiliaria sin pedir member_id', () => {
  assert.ok(server.includes("select', 'organization_id,status'"));
  assert.equal(server.includes("select', 'organization_id,member_id"), false);
});

test('la versión nueva fuerza la actualización en celular', () => {
  assert.ok(html.includes('/dist/mvp-main.js?v=20260715-36'));
});
