import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20260720130000_lockout_miembros_suspendidos.sql',
  'utf8',
);

test('is_org_member excluye a los miembros suspendidos', () => {
  assert.ok(migration.includes('create or replace function public.is_org_member(target_org uuid)'));
  assert.ok(migration.includes("and lower(coalesce(status, 'active')) <> 'suspended'"));
});

test('can_manage_public_property_ficha excluye a los miembros suspendidos', () => {
  assert.ok(migration.includes('create or replace function public.can_manage_public_property_ficha(target_organization text)'));
  assert.ok(migration.includes("and lower(coalesce(member.status, 'active')) <> 'suspended'"));
});

test('la migración preserva la seguridad de las funciones (definer + search_path)', () => {
  const definerCount = migration.match(/security definer/g)?.length ?? 0;
  assert.equal(definerCount, 2);
  assert.ok(migration.includes("set search_path to 'public'"));
});

test('la migración no borra datos ni políticas', () => {
  assert.equal(/drop\s+table/i.test(migration), false);
  assert.equal(/drop\s+policy/i.test(migration), false);
  assert.equal(/delete\s+from/i.test(migration), false);
  assert.equal(/truncate/i.test(migration), false);
});
