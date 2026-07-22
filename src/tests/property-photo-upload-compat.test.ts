import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const upload = readFileSync('src/property-photo-upload.ts', 'utf8');
const server = readFileSync('src/server/property-photo-storage.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260715093000_property_photos.sql', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('el navegador no consulta directamente Supabase ni convierte el upload a base64', () => {
  assert.equal(upload.includes('getCloudMembershipContext'), false);
  assert.ok(upload.includes('getCloudSession'));
  assert.ok(upload.includes('/api/property-photos?'));
  assert.ok(upload.includes('body: photo.blob'));
  assert.equal(upload.includes('blobToDataUrl'), false);
  assert.equal(upload.includes('/rest/v1/organization_members'), false);
  assert.equal(upload.includes('/storage/v1/object/'), false);
});

test('el servidor identifica usuario e inmobiliaria sin exigir columnas inexistentes', () => {
  assert.ok(server.includes("select', 'organization_id'"));
  assert.ok(server.includes('return { userId, organizationId, accessToken }'));
  assert.equal(server.includes('member_id'), false);
  assert.equal(server.includes('membership.status'), false);
  assert.equal(migration.includes('member.status'), false);
});

test('los bloqueos RLS se consideran estructurales y no se repiten', () => {
  assert.ok(upload.includes("'STORAGE_FORBIDDEN'"));
  assert.ok(upload.includes('blockedFatalUntil = now + 60_000'));
  assert.ok(server.includes('La política de seguridad de fotos todavía no está actualizada.'));
});

test('la versión nueva fuerza la actualización en celular', () => {
  assert.ok(html.includes('/dist/mvp-main.js?v=20260722-95'));
  assert.ok(html.includes('/dist/invitation-link-ux.js?v=20260722-95'));
});