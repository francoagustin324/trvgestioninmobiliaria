import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const upload = readFileSync('src/property-photo-upload.ts', 'utf8');
const server = readFileSync('src/server/property-photo-storage.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260715093000_property_photos.sql', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('el navegador no consulta directamente Supabase', () => {
  assert.equal(upload.includes('getCloudMembershipContext'), false);
  assert.ok(upload.includes('getCloudSession'));
  assert.ok(upload.includes("fetchWithRetry('/api/property-photos'"));
  assert.equal(upload.includes('/rest/v1/organization_members'), false);
  assert.equal(upload.includes('/storage/v1/object/'), false);
});

test('el servidor consulta sólo organization_id y no exige columnas inexistentes', () => {
  assert.ok(server.includes("select', 'organization_id'"));
  assert.equal(server.includes('member_id'), false);
  assert.equal(server.includes('membership.status'), false);
  assert.equal(migration.includes('member.status'), false);
});

test('la versión nueva fuerza la actualización en celular', () => {
  assert.ok(html.includes('/dist/mvp-main.js?v=20260715-38'));
});
