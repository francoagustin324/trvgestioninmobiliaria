import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bootstrap = readFileSync('dist/property-photo-status-compat-bootstrap.js', 'utf8');
const index = readFileSync('index.html', 'utf8');
const migration = readFileSync('supabase/migrations/20260716154500_property_photos_without_member_status.sql', 'utf8');

test('la carga de fotos elimina status solo de la consulta mínima', () => {
  assert.ok(bootstrap.includes("get('select') === 'organization_id,status'"));
  assert.ok(bootstrap.includes("set('select', 'organization_id')"));
  assert.ok(index.includes('property-photo-status-compat-bootstrap.js'));
});

test('la política de fotos no depende de organization_members.status', () => {
  assert.ok(migration.includes('member.user_id = auth.uid()'));
  assert.ok(migration.includes('member.organization_id::text = target_organization'));
  assert.equal(migration.includes('member.status'), false);
});
