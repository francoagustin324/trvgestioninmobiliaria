import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20260717190000_restrictive_organization_isolation.sql',
  'utf8',
);

test('propcontrol_records exige pertenencia activa mediante política restrictiva', () => {
  assert.ok(migration.includes('create policy propcontrol_records_org_scope_restrictive'));
  assert.ok(migration.includes('on public.propcontrol_records'));
  assert.ok(migration.includes('as restrictive'));
  assert.ok(migration.includes('for all'));
  assert.ok(migration.includes('private.is_active_org_member(organization_id)'));
});

test('las fichas publicadas protegen escritura por inmobiliaria', () => {
  assert.ok(migration.includes('create policy public_property_fichas_org_scope_restrictive'));
  assert.ok(migration.includes('on public.public_property_fichas'));
  assert.ok(migration.includes('public.can_manage_public_property_ficha(organization_id)'));
});

test('anon no obtiene acceso directo a las tablas comerciales', () => {
  assert.ok(migration.includes('revoke all on table public.propcontrol_records from anon'));
  assert.ok(migration.includes('revoke all on table public.public_property_fichas from anon'));
  assert.ok(migration.includes('public.get_public_property_ficha(text)'));
});
