import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260713_auth_multiusuario_rls.sql';
const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

test('la migración habilita RLS en registros y membresías', () => {
  assert.match(sql, /alter table public\.propcontrol_records enable row level security/);
  assert.match(sql, /alter table public\.organization_members enable row level security/);
  assert.match(sql, /create policy propcontrol_records_select/);
  assert.match(sql, /create policy organization_members_org_scope_restrictive/);
});

test('los corredores quedan limitados por assigned_member_id', () => {
  assert.match(sql, /assigned_member_id = private\.org_member_number\(organization_id\)/);
  assert.match(sql, /private\.org_member_role\(organization_id\) in \('owner','admin'\)/);
  assert.match(sql, /private\.is_active_org_member\(organization_id\)/);
});

test('la migración protege el snapshot anterior', () => {
  assert.match(sql, /propcontrol_snapshot_owner_admin_select/);
  assert.match(sql, /source <> 'propcontrol_system_snapshot'/);
  assert.match(sql, /as restrictive for select/);
});

test('la secuencia de miembros es repetible', () => {
  assert.match(sql, /create sequence if not exists public\.organization_members_member_id_seq/);
  assert.match(sql, /select setval\(/);
  assert.match(sql, /select max\(member_id\) from public\.organization_members/);
});

test('la membresía tiene identidades únicas por organización', () => {
  assert.match(sql, /organization_members_org_member_id_uq/);
  assert.match(sql, /organization_members_org_user_uq/);
  assert.doesNotMatch(sql, /organization_members_org_email_uq/);
});

test('la migración no contiene secretos ni claves concretas', () => {
  assert.doesNotMatch(sql, /sb_secret_/);
  assert.doesNotMatch(sql, /service_role\.[a-z0-9_-]+/);
  assert.doesNotMatch(sql, /eyj[a-z0-9_-]{20,}/);
});
