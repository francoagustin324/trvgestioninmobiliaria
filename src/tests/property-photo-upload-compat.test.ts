import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const upload = readFileSync('src/property-photo-upload.ts', 'utf8');
const server = readFileSync('src/server/property-photo-storage.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260715093000_property_photos.sql', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('la carga de fotos consulta sólo organization_id', () => {
  assert.equal(upload.includes('getCloudMembershipContext'), false);
  assert.ok(upload.includes('getCloudSession'));
  assert.ok(upload.includes("select', 'organization_id'"));
  assert.equal(upload.includes("select', 'organization_id,status'"), false);
});

test('servidor y migración no dependen de member_id ni status', () => {
  assert.ok(server.includes("select', 'organization_id'"));
  assert.equal(server.includes('member_id'), false);
  assert.equal(server.includes('membership.status'), false);
  assert.equal(migration.includes('member.status'), false);
});

test('la versión nueva fuerza la actualización en celular', () => {
  assert.ok(html.includes('/dist/mvp-main.js?v=20260715-36'));
});
