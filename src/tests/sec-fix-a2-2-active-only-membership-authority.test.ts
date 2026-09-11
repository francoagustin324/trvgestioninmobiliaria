import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260910131500_sec_fix_a2_2_active_only_membership_authority_helpers.sql';
const historicalMigrationPath = 'supabase/migrations/20260713_auth_multiusuario_rls.sql';
const migration = readFileSync(migrationPath, 'utf8');
const historicalMigration = readFileSync(historicalMigrationPath, 'utf8');
const databaseUrl = process.env.A2_2_TEST_DATABASE_URL ?? '';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ACTIVE_OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ACTIVE_ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const ACTIVE_AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const INVITED_OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const INVITED_ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const INVITED_AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
const SUSPENDED_OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';
const NULL_OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8';
const UNKNOWN_OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9';
const OTHER_ORG_OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const MISSING_USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function psql(sql: string): string {
  if (!databaseUrl) throw new Error('A2_2_TEST_DATABASE_URL no configurada.');
  return execFileSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', sql], {
    encoding: 'utf8',
  }).trim();
}

function applyMigration(expectFailure = false): string {
  if (!databaseUrl) throw new Error('A2_2_TEST_DATABASE_URL no configurada.');
  try {
    return execFileSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', migrationPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (!expectFailure) throw error;
    const failure = error as { stderr?: Buffer | string };
    return String(failure.stderr ?? '');
  }
}

function resetFixture(): void {
  psql(`
    drop schema if exists private cascade;
    drop schema if exists auth cascade;
    drop table if exists public.organization_members cascade;

    create schema auth;
    create schema private;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $auth_uid$
      select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid;
    $auth_uid$;

    create table public.organization_members (
      organization_id uuid not null,
      user_id uuid not null,
      role text not null,
      member_id bigint not null,
      status text null,
      primary key (organization_id, user_id)
    );

    create function private.normalized_org_role(value text)
    returns text
    language sql
    immutable
    as $normalized$
      select case
        when pg_catalog.lower(coalesce(value, '')) in ('owner','dueño','dueno') then 'owner'
        when pg_catalog.lower(coalesce(value, '')) in ('admin','administrator','administrador') then 'admin'
        else 'agent'
      end;
    $normalized$;

    create function private.org_member_role(target_org uuid, target_user uuid default auth.uid())
    returns text
    language sql
    stable
    security definer
    set search_path to ''
    as $old_role$
      select private.normalized_org_role(member.role)
      from public.organization_members as member
      where member.organization_id = target_org
        and member.user_id = target_user
        and pg_catalog.lower(coalesce(member.status, 'active')) <> 'suspended'
      limit 1;
    $old_role$;

    create function private.org_member_number(target_org uuid, target_user uuid default auth.uid())
    returns bigint
    language sql
    stable
    security definer
    set search_path to ''
    as $old_number$
      select member.member_id
      from public.organization_members as member
      where member.organization_id = target_org
        and member.user_id = target_user
        and pg_catalog.lower(coalesce(member.status, 'active')) <> 'suspended'
      limit 1;
    $old_number$;

    insert into public.organization_members (organization_id, user_id, role, member_id, status) values
      ('${ORG_A}', '${ACTIVE_OWNER}', 'owner', 101, 'active'),
      ('${ORG_A}', '${ACTIVE_ADMIN}', 'admin', 102, 'active'),
      ('${ORG_A}', '${ACTIVE_AGENT}', 'agent', 103, 'active'),
      ('${ORG_A}', '${INVITED_OWNER}', 'owner', 104, 'invited'),
      ('${ORG_A}', '${INVITED_ADMIN}', 'admin', 105, 'invited'),
      ('${ORG_A}', '${INVITED_AGENT}', 'agent', 106, 'invited'),
      ('${ORG_A}', '${SUSPENDED_OWNER}', 'owner', 107, 'suspended'),
      ('${ORG_A}', '${NULL_OWNER}', 'owner', 108, null),
      ('${ORG_A}', '${UNKNOWN_OWNER}', 'owner', 109, 'unknown'),
      ('${ORG_B}', '${OTHER_ORG_OWNER}', 'owner', 201, 'active');
  `);
}

function nullSafe(expression: string): string {
  return psql(`select coalesce((${expression})::text, '<NULL>');`);
}

function asUser(userId: string, expression: string): string {
  const raw = psql(`
    select pg_catalog.set_config('request.jwt.claim.sub', '${userId}', false);
    select (${expression})::text;
  `);
  return raw.split(/\r?\n/).at(-1) ?? '';
}

function ownerAdminAuthority(userId: string): boolean {
  return asUser(
    userId,
    `coalesce(private.org_member_role('${ORG_A}'::uuid) in ('owner','admin'), false)`,
  ) === 'true';
}

function deleteAuthority(userId: string): boolean {
  return asUser(
    userId,
    `coalesce(
      private.org_member_role('${ORG_A}'::uuid) in ('owner','admin')
      and '${ACTIVE_AGENT}'::uuid <> auth.uid()
      and pg_catalog.lower(coalesce('agent', '')) not in ('owner','dueño','dueno'),
      false
    )`,
  ) === 'true';
}

function snapshotAuthority(userId: string): boolean {
  return asUser(
    userId,
    `coalesce(
      'propcontrol_system_snapshot' <> 'propcontrol_system_snapshot'
      or private.org_member_role('${ORG_A}'::uuid) in ('owner','admin'),
      false
    )`,
  ) === 'true';
}

function functionDefinition(name: 'org_member_role' | 'org_member_number'): string {
  return psql(`
    select pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure('private.${name}(uuid,uuid)')
    );
  `);
}

test('A2.2 static: migration forward, transaccional y sin reescribir historia', () => {
  assert.notEqual(migrationPath, historicalMigrationPath);
  assert.match(historicalMigration, /lower\(coalesce\(om\.status, 'active'\)\)\s*<>\s*'suspended'/i);
  assert.match(migration, /^--[\s\S]*?\bbegin;[\s\S]*\bcommit;\s*$/i);
});

test('A2.2 static: preflight precede ambos CREATE OR REPLACE y valida dependencias esperadas', () => {
  const preflightIndex = migration.indexOf('do $preflight$');
  const roleIndex = migration.search(/create\s+or\s+replace\s+function\s+private\.org_member_role/i);
  const numberIndex = migration.search(/create\s+or\s+replace\s+function\s+private\.org_member_number/i);
  assert.ok(preflightIndex >= 0 && roleIndex > preflightIndex && numberIndex > preflightIndex);
  for (const expected of [
    'organization_id', 'user_id', 'role', 'member_id', 'status',
    'private.org_member_role(uuid,uuid)',
    'private.org_member_number(uuid,uuid)',
    'private.normalized_org_role(text)',
    'auth.uid()',
  ]) assert.ok(migration.includes(expected), `Preflight incompleto: falta ${expected}`);
});

test('A2.2 static: helpers finales exigen status active exacto sin normalización ni fallback', () => {
  for (const name of ['org_member_role', 'org_member_number'] as const) {
    const definition = migration.match(new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+private\\.${name}[\\s\\S]*?\\$function\\$;`,
      'i',
    ))?.[0] ?? '';
    assert.match(definition, /member\.status\s*=\s*'active'/i);
    assert.equal(/lower\s*\(|trim\s*\(|btrim\s*\(|coalesce\s*\(\s*member\.status|<>\s*'suspended'/i.test(definition), false);
    assert.match(definition, /security\s+definer/i);
    assert.match(definition, /set\s+search_path\s+to\s+''/i);
  }
});

test('A2.2 static: no modifica datos, policies ni grants', () => {
  assert.equal(/\b(update|insert\s+into|delete\s+from|truncate)\s+public\.organization_members\b/i.test(migration), false);
  assert.equal(/\b(create|alter|drop)\s+policy\b/i.test(migration), false);
  assert.equal(/\bgrant\b|\brevoke\b/i.test(migration), false);
});

test('A2.2 static: policies consumidoras conservan su política funcional y delegan autoridad en org_member_role', () => {
  for (const policy of [
    'organization_members_owner_admin_insert',
    'organization_members_owner_admin_update',
    'organization_members_owner_admin_delete',
    'propcontrol_snapshot_owner_admin_select',
    'propcontrol_snapshot_owner_admin_update',
    'propcontrol_snapshot_owner_admin_delete',
  ]) assert.ok(historicalMigration.includes(policy), `Falta policy histórica esperada: ${policy}`);
  assert.match(historicalMigration, /organization_members_owner_admin_insert[\s\S]*private\.org_member_role\(organization_id\)\s+in\s+\('owner','admin'\)/i);
  assert.match(historicalMigration, /organization_members_owner_admin_update[\s\S]*private\.org_member_role\(organization_id\)\s+in\s+\('owner','admin'\)/i);
  assert.match(historicalMigration, /organization_members_owner_admin_delete[\s\S]*private\.org_member_role\(organization_id\)\s+in\s+\('owner','admin'\)/i);
  assert.match(historicalMigration, /propcontrol_snapshot_owner_admin_select[\s\S]*private\.org_member_role\(organization_id\)\s+in\s+\('owner','admin'\)/i);
});

test('A2.2 PostgreSQL 17: autoridad active-only', { skip: !databaseUrl }, async (t) => {
  resetFixture();
  applyMigration();

  await t.test('1. active owner → role owner', () => {
    assert.equal(nullSafe(`private.org_member_role('${ORG_A}', '${ACTIVE_OWNER}')`), 'owner');
  });
  await t.test('2. active admin → role admin', () => {
    assert.equal(nullSafe(`private.org_member_role('${ORG_A}', '${ACTIVE_ADMIN}')`), 'admin');
  });
  await t.test('3. active agent → role agent', () => {
    assert.equal(nullSafe(`private.org_member_role('${ORG_A}', '${ACTIVE_AGENT}')`), 'agent');
  });
  await t.test('4. invited owner → NULL', () => {
    assert.equal(nullSafe(`private.org_member_role('${ORG_A}', '${INVITED_OWNER}')`), '<NULL>');
  });
  await t.test('5. invited admin → NULL', () => {
    assert.equal(nullSafe(`private.org_member_role('${ORG_A}', '${INVITED_ADMIN}')`), '<NULL>');
  });
  await t.test('6. invited agent → NULL', () => {
    assert.equal(nullSafe(`private.org_member_role('${ORG_A}', '${INVITED_AGENT}')`), '<NULL>');
  });
  await t.test('7. suspended → NULL', () => {
    assert.equal(nullSafe(`private.org_member_role('${ORG_A}', '${SUSPENDED_OWNER}')`), '<NULL>');
  });
  await t.test('8. NULL/unknown status → NULL', () => {
    assert.equal(nullSafe(`private.org_member_role('${ORG_A}', '${NULL_OWNER}')`), '<NULL>');
    assert.equal(nullSafe(`private.org_member_role('${ORG_A}', '${UNKNOWN_OWNER}')`), '<NULL>');
  });
  await t.test('9. wrong org → NULL', () => {
    assert.equal(nullSafe(`private.org_member_role('${ORG_B}', '${ACTIVE_OWNER}')`), '<NULL>');
  });
  await t.test('10. wrong user → NULL', () => {
    assert.equal(nullSafe(`private.org_member_role('${ORG_A}', '${MISSING_USER}')`), '<NULL>');
  });
  await t.test('11. member_number active → member_id', () => {
    assert.equal(nullSafe(`private.org_member_number('${ORG_A}', '${ACTIVE_OWNER}')`), '101');
    assert.equal(nullSafe(`private.org_member_number('${ORG_A}', '${ACTIVE_ADMIN}')`), '102');
    assert.equal(nullSafe(`private.org_member_number('${ORG_A}', '${ACTIVE_AGENT}')`), '103');
  });
  await t.test('12. member_number invited/suspended/unknown → NULL', () => {
    for (const user of [INVITED_OWNER, INVITED_ADMIN, INVITED_AGENT, SUSPENDED_OWNER, NULL_OWNER, UNKNOWN_OWNER]) {
      assert.equal(nullSafe(`private.org_member_number('${ORG_A}', '${user}')`), '<NULL>');
    }
  });
  await t.test('13. invited owner no satisface owner/admin INSERT authority', () => {
    assert.equal(ownerAdminAuthority(INVITED_OWNER), false);
  });
  await t.test('14. invited admin no satisface UPDATE authority', () => {
    assert.equal(ownerAdminAuthority(INVITED_ADMIN), false);
  });
  await t.test('15. invited owner/admin no satisface DELETE authority', () => {
    assert.equal(deleteAuthority(INVITED_OWNER), false);
    assert.equal(deleteAuthority(INVITED_ADMIN), false);
  });
  await t.test('16. invited owner/admin no satisface fichas snapshot privileged policy', () => {
    assert.equal(snapshotAuthority(INVITED_OWNER), false);
    assert.equal(snapshotAuthority(INVITED_ADMIN), false);
  });
  await t.test('17. active owner/admin conserva comportamiento permitido', () => {
    for (const user of [ACTIVE_OWNER, ACTIVE_ADMIN]) {
      assert.equal(ownerAdminAuthority(user), true);
      assert.equal(deleteAuthority(user), true);
      assert.equal(snapshotAuthority(user), true);
    }
  });
  await t.test('18. active agent conserva restricciones actuales', () => {
    assert.equal(ownerAdminAuthority(ACTIVE_AGENT), false);
    assert.equal(deleteAuthority(ACTIVE_AGENT), false);
    assert.equal(snapshotAuthority(ACTIVE_AGENT), false);
  });

  await t.test('postflight: definición SQL exacta mantiene SECURITY DEFINER/search_path y status = active', () => {
    const roleDefinition = functionDefinition('org_member_role');
    const numberDefinition = functionDefinition('org_member_number');
    for (const definition of [roleDefinition, numberDefinition]) {
      assert.match(definition, /SECURITY DEFINER/i);
      assert.match(definition, /SET search_path TO ''/i);
      assert.match(definition, /status\s*=\s*'active'/i);
      assert.equal(/lower\s*\(\s*member\.status|coalesce\s*\(\s*member\.status|<>\s*'suspended'/i.test(definition), false);
    }
  });
});

test('A2.2 PostgreSQL 17: preflight falla antes de mutar si falta un helper esperado', { skip: !databaseUrl }, () => {
  resetFixture();
  psql('drop function private.org_member_role(uuid, uuid);');
  const beforeNumber = functionDefinition('org_member_number');
  const failure = applyMigration(true);
  assert.match(failure, /falta private\.org_member_role\(uuid,uuid\)/i);
  assert.equal(functionDefinition('org_member_number'), beforeNumber);
});
