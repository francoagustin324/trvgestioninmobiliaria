import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const baselinePath = '/repo/supabase/baselines/sec_fix_a2_5/baseline.psql';
const forwardMigrations = [
  '/repo/supabase/migrations/20260910130000_sec_fix_a2_1_canonical_organization_member_status.sql',
  '/repo/supabase/migrations/20260910131500_sec_fix_a2_2_active_only_membership_authority_helpers.sql',
  '/repo/supabase/migrations/20260910133000_sec_fix_a2_3_minimal_acl_hardening.sql',
  '/repo/supabase/migrations/20260910140000_sec_fix_a2_4_org_aware_rpc_v2_alignment.sql',
] as const;

const orgA = '11111111-1111-4111-8111-111111111111';
const orgB = '22222222-2222-4222-8222-222222222222';
const activeA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const activeB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const multiUser = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const invitedUser = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const suspendedUser = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const normalOnboardingUser = 'abababab-abab-4bab-8bab-abababababab';
const authInvitationUser = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function docker(args: string[]) {
  return spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
}

async function waitHealthy(containerName: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const probe = docker([
      'inspect', containerName, '--format',
      '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
    ]);
    if (probe.status === 0 && probe.stdout.trim() === 'true|healthy') return;
    if (probe.status === 0 && probe.stdout.trim().startsWith('false|')) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const logs = docker(['logs', '--tail', '120', containerName]);
  assert.fail(`PostgreSQL 17 no quedó healthy.\n${logs.stdout}\n${logs.stderr}`);
}

function lastValue(output: string): string {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? '';
}

async function replayFromCleanDb(label: string): Promise<{ fingerprint: string; version: string }> {
  const containerName = `sec-a25-${label}-${randomUUID().slice(0, 8)}`;
  const started = docker([
    'run', '--detach', '--name', containerName,
    '--env', 'POSTGRES_PASSWORD=postgres',
    '--health-cmd', 'pg_isready -U postgres -d postgres',
    '--health-interval', '1s', '--health-timeout', '5s',
    '--health-start-period', '2s', '--health-retries', '60',
    'postgres:17',
  ]);
  assert.equal(started.status, 0, started.stderr || started.stdout);

  const rawPsql = (sql: string) => spawnSync(
    'docker',
    ['exec', '-i', containerName, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
    { encoding: 'utf8', input: sql, maxBuffer: 50 * 1024 * 1024 },
  );
  const psql = (sql: string): string => {
    const result = rawPsql(sql);
    const logs = result.status === 0 ? '' : docker(['logs', '--tail', '100', containerName]).stdout;
    assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${logs}`);
    return result.stdout.trim();
  };
  const psqlError = (sql: string): string => {
    const result = rawPsql(`\\set VERBOSITY verbose\n${sql}`);
    assert.notEqual(result.status, 0, 'La sentencia debía fallar.');
    return `${result.stderr}\n${result.stdout}`;
  };
  const psqlFile = (path: string): void => {
    const result = docker([
      'exec', containerName, 'psql', '-U', 'postgres', '-d', 'postgres', '-X',
      '-v', 'ON_ERROR_STOP=1', '-f', path,
    ]);
    assert.equal(result.status, 0, `Falló replay de ${path}.\n${result.stderr || result.stdout}`);
  };
  const asUser = (userId: string, sql: string): string => lastValue(psql(`
    set role authenticated;
    select pg_catalog.set_config('request.jwt.claim.sub', '${userId}', false);
    ${sql}
  `));
  const asUserError = (userId: string, sql: string): string => psqlError(`
    set role authenticated;
    select pg_catalog.set_config('request.jwt.claim.sub', '${userId}', false);
    ${sql}
  `);

  try {
    await waitHealthy(containerName);
    const version = lastValue(psql('show server_version;'));
    assert.match(version, /^17(?:\.|$)/);

    // Fixture-only primitives. In real Supabase these are managed by the platform.
    psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema auth;
      grant usage on schema auth to anon, authenticated, service_role;

      create function auth.uid()
      returns uuid
      language sql
      stable
      security invoker
      set search_path = ''
      as $function$
        select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid
      $function$;
      grant execute on function auth.uid() to anon, authenticated, service_role;

      create table auth.users (
        id uuid primary key,
        email text,
        invited_at timestamptz,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );

      insert into auth.users (id, email, invited_at, raw_user_meta_data) values
        ('${activeA}', 'a@example.test', null, '{}'),
        ('${activeB}', 'b@example.test', null, '{}'),
        ('${multiUser}', 'multi@example.test', null, '{}'),
        ('${invitedUser}', 'invited@example.test', now(), '{}'),
        ('${suspendedUser}', 'suspended@example.test', null, '{}');
    `);

    const mkdir = docker(['exec', containerName, 'mkdir', '-p', '/repo/supabase']);
    assert.equal(mkdir.status, 0, mkdir.stderr || mkdir.stdout);
    const copied = docker(['cp', 'supabase/.', `${containerName}:/repo/supabase/`]);
    assert.equal(copied.status, 0, copied.stderr || copied.stdout);

    // 1. Clean DB + managed fixture -> complete pre-A2.1 baseline.
    psqlFile(baselinePath);
    assert.equal(lastValue(psql(`
      select count(*) from pg_catalog.pg_constraint
      where conrelid = 'public.organization_members'::regclass
        and conname = 'organization_members_status_check';
    `)), '0', 'La baseline debe terminar inmediatamente antes del CHECK de A2.1.');
    assert.equal(lastValue(psql(`
      select to_regclass('public.organization_members_org_user_uq') is null;
    `)), 't', 'No debe recrearse el UNIQUE redundante cubierto por la PK.');

    psql(`
      insert into public.organizations (id, name) values
        ('${orgA}', 'Tenant A'), ('${orgB}', 'Tenant B');
      insert into public.organization_members (organization_id, user_id, role, status) values
        ('${orgA}', '${activeA}', 'owner', 'active'),
        ('${orgB}', '${activeB}', 'owner', 'active'),
        ('${orgA}', '${multiUser}', 'admin', 'active'),
        ('${orgB}', '${multiUser}', 'admin', 'active'),
        ('${orgA}', '${invitedUser}', 'agent', 'invited'),
        ('${orgA}', '${suspendedUser}', 'agent', 'suspended');
    `);

    // Historical compatibility is intentional: invited still had role authority pre-A2.2.
    assert.equal(asUser(invitedUser, `select private.org_member_role('${orgA}'::uuid);`), 'agent');

    // 2. A2.1 applies and owns the exact canonical status CHECK.
    psqlFile(forwardMigrations[0]);
    const statusCheck = lastValue(psql(`
      select pg_catalog.pg_get_constraintdef(oid)
      from pg_catalog.pg_constraint
      where conrelid = 'public.organization_members'::regclass
        and conname = 'organization_members_status_check';
    `));
    assert.match(statusCheck, /active/);
    assert.match(statusCheck, /invited/);
    assert.match(statusCheck, /suspended/);

    // 3. A2.2 applies and invited/suspended lose authority.
    psqlFile(forwardMigrations[1]);
    assert.equal(asUser(invitedUser, `select private.org_member_role('${orgA}'::uuid) is null;`), 't');
    assert.equal(asUser(invitedUser, `select private.org_member_number('${orgA}'::uuid) is null;`), 't');
    assert.equal(asUser(suspendedUser, `select private.org_member_role('${orgA}'::uuid) is null;`), 't');
    assert.equal(asUser(suspendedUser, `select private.org_member_number('${orgA}'::uuid) is null;`), 't');

    // 4–5. A2.3 exact ACL + A2.4 exact org-aware V2 contracts.
    psqlFile(forwardMigrations[2]);
    psqlFile(forwardMigrations[3]);

    // Final catalog: required tables and transactional dependencies.
    for (const relation of [
      'public.organizations',
      'public.organization_members',
      'public.fichas',
      'public.propcontrol_records',
      'public.public_property_fichas',
      'private.commercial_operations',
      'private.commercial_entity_authority',
    ]) {
      assert.equal(lastValue(psql(`select to_regclass('${relation}') is not null;`)), 't', `Falta ${relation}`);
    }

    const columns = JSON.parse(lastValue(psql(`
      select pg_catalog.jsonb_object_agg(
        cols.table_schema || '.' || cols.table_name || '.' || cols.column_name,
        pg_catalog.jsonb_build_object(
          'type', cols.data_type,
          'nullable', cols.is_nullable,
          'default', cols.column_default
        )
      )
      from information_schema.columns as cols
      where (cols.table_schema, cols.table_name) in (
        ('public','organizations'), ('public','organization_members'), ('public','fichas'),
        ('public','propcontrol_records'), ('public','public_property_fichas'),
        ('private','commercial_operations')
      );
    `))) as Record<string, { type: string; nullable: string; default: string | null }>;
    assert.equal(columns['public.organizations.id']?.type, 'uuid');
    assert.equal(columns['public.organization_members.member_id']?.type, 'bigint');
    assert.match(columns['public.organization_members.member_id']?.default ?? '', /organization_members_member_id_seq/);
    assert.equal(columns['public.organization_members.status']?.nullable, 'NO');
    assert.match(columns['public.organization_members.status']?.default ?? '', /active/);
    assert.equal(columns['public.propcontrol_records.uid']?.type, 'uuid');
    assert.equal(columns['public.propcontrol_records.revision']?.type, 'bigint');
    assert.match(columns['public.propcontrol_records.revision']?.default ?? '', /0/);
    assert.equal(columns['public.public_property_fichas.organization_id']?.type, 'text');

    assert.equal(lastValue(psql(`
      select count(*) from pg_catalog.pg_constraint
      where conrelid = 'public.organization_members'::regclass and contype = 'p';
    `)), '1');
    assert.equal(lastValue(psql(`
      select count(*) from pg_catalog.pg_constraint
      where conrelid = 'public.organization_members'::regclass and contype = 'f';
    `)), '2');
    assert.equal(lastValue(psql(`
      select count(*) from pg_catalog.pg_constraint
      where conrelid = 'public.fichas'::regclass and contype = 'f';
    `)), '2');

    const indexes = psql(`
      select indexname from pg_catalog.pg_indexes
      where schemaname = 'public'
        and tablename in ('organization_members','propcontrol_records')
      order by indexname;
    `);
    assert.match(indexes, /organization_members_org_member_id_uq/);
    assert.doesNotMatch(indexes, /organization_members_org_user_uq/);
    assert.match(indexes, /propcontrol_records_org_uid_uq/);
    assert.match(indexes, /propcontrol_records_org_revision_idx/);

    for (const signature of [
      'private.normalized_org_role(text)',
      'private.is_active_org_member(uuid,uuid)',
      'private.org_member_role(uuid,uuid)',
      'private.org_member_number(uuid,uuid)',
      'private.can_access_property_photo(text)',
      'private.next_commercial_legacy_id(uuid,text)',
      'private.commercial_visit_duplicate_exists(uuid,bigint,bigint,timestamptz)',
      'private.visit_authority_active(uuid)',
      'private.visit_normalized(text)',
      'private.visit_qualification_missing(jsonb)',
      'private.guard_transaction_owned_records()',
      'public.is_org_member(uuid)',
      'public.activate_my_organization_memberships()',
      'public.can_manage_public_property_ficha(text)',
      'public.get_public_property_ficha(text)',
      'public.handle_new_propcontrol_user()',
      'public.protect_propcontrol_record_identity()',
      'public.visit_transaction_authority_active()',
      'public.client_snapshot_cas(jsonb,boolean)',
      'public.commercial_visit_mutation(uuid,text,jsonb,boolean)',
      'public.visit_transaction_authority_active_v2(uuid)',
      'public.client_snapshot_cas_v2(uuid,jsonb,boolean)',
      'public.commercial_visit_mutation_v2(uuid,uuid,text,jsonb,boolean)',
    ]) {
      assert.equal(lastValue(psql(`select to_regprocedure('${signature}') is not null;`)), 't', `Falta ${signature}`);
    }

    const onboardingTrigger = lastValue(psql(`
      select pg_catalog.pg_get_triggerdef(t.oid)
      from pg_catalog.pg_trigger as t
      where t.tgrelid = 'auth.users'::regclass
        and t.tgname = 'on_propcontrol_user_created'
        and not t.tgisinternal;
    `));
    assert.match(onboardingTrigger, /AFTER INSERT/i);
    assert.match(onboardingTrigger, /new\.invited_at IS NULL/i);
    assert.match(onboardingTrigger, /handle_new_propcontrol_user/i);

    for (const relation of [
      'organizations', 'organization_members', 'fichas', 'propcontrol_records', 'public_property_fichas',
    ]) {
      assert.equal(lastValue(psql(`
        select relrowsecurity from pg_catalog.pg_class
        where oid = 'public.${relation}'::regclass;
      `)), 't', `RLS no habilitado en ${relation}`);
    }

    const policies = psql(`
      select schemaname || '.' || tablename || '.' || policyname
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename in ('organizations','organization_members','fichas','propcontrol_records','public_property_fichas')
      order by 1;
    `);
    for (const policy of [
      'organizations_member_select',
      'organization_members_org_scope_restrictive',
      'propcontrol_snapshot_owner_admin_select',
      'propcontrol_records_org_scope_restrictive',
      'public_property_fichas_org_scope_restrictive',
    ]) assert.match(policies, new RegExp(policy));

    // Exact A2.3 table ACL invariants.
    const privilege = (role: string, relation: string, name: string) =>
      lastValue(psql(`select pg_catalog.has_table_privilege('${role}', '${relation}', '${name}');`));
    assert.equal(privilege('authenticated', 'public.organizations', 'SELECT'), 'f');
    assert.equal(privilege('service_role', 'public.organizations', 'SELECT'), 't');
    assert.equal(privilege('authenticated', 'public.organization_members', 'SELECT'), 't');
    assert.equal(privilege('authenticated', 'public.organization_members', 'INSERT'), 'f');
    assert.equal(privilege('authenticated', 'public.fichas', 'SELECT'), 't');
    assert.equal(privilege('authenticated', 'public.fichas', 'INSERT'), 't');
    assert.equal(privilege('authenticated', 'public.fichas', 'UPDATE'), 't');
    assert.equal(privilege('authenticated', 'public.fichas', 'DELETE'), 'f');
    assert.equal(privilege('authenticated', 'public.propcontrol_records', 'SELECT'), 't');
    assert.equal(privilege('authenticated', 'public.propcontrol_records', 'DELETE'), 't');
    assert.equal(privilege('authenticated', 'public.public_property_fichas', 'DELETE'), 'f');

    for (const relation of [
      'public.organizations', 'public.organization_members', 'public.fichas',
      'public.propcontrol_records', 'public.public_property_fichas',
    ]) {
      assert.equal(privilege('anon', relation, 'SELECT'), 'f', `anon no debe leer ${relation}`);
      assert.equal(privilege('authenticated', relation, 'TRUNCATE'), 'f', `authenticated no debe TRUNCATE ${relation}`);
      assert.equal(privilege('authenticated', relation, 'TRIGGER'), 'f', `authenticated no debe TRIGGER ${relation}`);
      assert.equal(privilege('authenticated', relation, 'REFERENCES'), 'f', `authenticated no debe REFERENCES ${relation}`);
    }

    const functionPrivilege = (role: string, signature: string) =>
      lastValue(psql(`select pg_catalog.has_function_privilege('${role}', '${signature}', 'EXECUTE');`));
    for (const signature of [
      'private.is_active_org_member(uuid,uuid)',
      'private.org_member_role(uuid,uuid)',
      'private.org_member_number(uuid,uuid)',
      'private.can_access_property_photo(text)',
      'public.activate_my_organization_memberships()',
      'public.can_manage_public_property_ficha(text)',
      'public.handle_new_propcontrol_user()',
      'private.next_commercial_legacy_id(uuid,text)',
      'private.commercial_visit_duplicate_exists(uuid,bigint,bigint,timestamptz)',
    ]) assert.equal(functionPrivilege('anon', signature), 'f', `anon/PUBLIC EXECUTE expuesto: ${signature}`);

    for (const signature of [
      'public.visit_transaction_authority_active_v2(uuid)',
      'public.client_snapshot_cas_v2(uuid,jsonb,boolean)',
      'public.commercial_visit_mutation_v2(uuid,uuid,text,jsonb,boolean)',
    ]) {
      assert.equal(functionPrivilege('authenticated', signature), 't');
      assert.equal(functionPrivilege('anon', signature), 'f');
      assert.equal(functionPrivilege('service_role', signature), 'f');
    }
    assert.equal(functionPrivilege('anon', 'public.get_public_property_ficha(text)'), 't');

    // Unknown membership state is rejected by the final A2.1 CHECK.
    const unknownStatus = psqlError(`
      insert into public.organization_members (organization_id, user_id, role, status)
      values ('${orgB}', '${suspendedUser}', 'agent', 'unknown');
    `);
    assert.match(unknownStatus, /organization_members_status_check|check constraint/i);

    // RLS tenant isolation: owner A sees/writes A but cannot see/write B.
    psql(`
      insert into public.propcontrol_records (
        organization_id, entity_type, entity_key, assigned_member_id, payload, created_by
      ) values
        ('${orgA}', 'client', '${orgA}:1', null, '{"id":1,"name":"A"}', '${activeA}'),
        ('${orgB}', 'client', '${orgB}:1', null, '{"id":1,"name":"B"}', '${activeB}');
    `);
    assert.equal(asUser(activeA, 'select count(*) from public.propcontrol_records;'), '1');
    assert.equal(asUser(activeB, 'select count(*) from public.propcontrol_records;'), '1');
    assert.equal(asUser(activeA, `
      with changed as (
        update public.propcontrol_records set payload = payload || '{"crossTenant":true}'::jsonb
        where organization_id = '${orgB}'::uuid returning 1
      ) select count(*) from changed;
    `), '0');

    // Public share is RPC-only: anon has EXECUTE but no direct table SELECT.
    psql(`
      insert into public.public_property_fichas (
        slug, organization_id, property_key, payload, published, created_by
      ) values ('a2-5-public', '${orgA}', 'property-1', '{"title":"Ficha pública"}', true, '${activeA}');
    `);
    assert.equal(lastValue(psql(`
      set role anon;
      select public.get_public_property_ficha('a2-5-public')->>'title';
    `)), 'Ficha pública');

    // Normal signup creates one organization + active owner.
    const organizationsBeforeSignup = Number(lastValue(psql('select count(*) from public.organizations;')));
    psql(`
      insert into auth.users (id, email, invited_at, raw_user_meta_data)
      values (
        '${normalOnboardingUser}', 'normal@example.test', null,
        '{"full_name":"Normal User","organization_name":"Normal Realty"}'
      );
    `);
    assert.equal(lastValue(psql(`
      select count(*) from public.organization_members
      where user_id = '${normalOnboardingUser}'::uuid and role = 'owner' and status = 'active';
    `)), '1');
    assert.equal(Number(lastValue(psql('select count(*) from public.organizations;'))), organizationsBeforeSignup + 1);

    // Supabase invitation does not create an implicit second organization.
    const organizationsBeforeInvite = Number(lastValue(psql('select count(*) from public.organizations;')));
    psql(`
      insert into auth.users (id, email, invited_at, raw_user_meta_data)
      values ('${authInvitationUser}', 'auth-invite@example.test', now(), '{}');
    `);
    assert.equal(lastValue(psql(`
      select count(*) from public.organization_members where user_id = '${authInvitationUser}'::uuid;
    `)), '0');
    assert.equal(Number(lastValue(psql('select count(*) from public.organizations;'))), organizationsBeforeInvite);

    // Explicit multi-org V2 works for each requested tenant; the legacy singleton
    // helper rejects the same user instead of choosing a first membership.
    psql(`
      insert into private.commercial_entity_authority (organization_id, entity_type, transaction_owned)
      values ('${orgA}', 'visit', true), ('${orgB}', 'visit', true);
    `);
    assert.equal(asUser(multiUser, `select public.visit_transaction_authority_active_v2('${orgA}'::uuid);`), 't');
    assert.equal(asUser(multiUser, `select public.visit_transaction_authority_active_v2('${orgB}'::uuid);`), 't');
    assert.match(asUserError(multiUser, 'select public.visit_transaction_authority_active();'), /PERMISSION_DENIED|42501/);
    assert.match(asUserError(invitedUser, `select public.visit_transaction_authority_active_v2('${orgA}'::uuid);`), /PERMISSION_DENIED|42501/);
    assert.match(asUserError(suspendedUser, `select public.visit_transaction_authority_active_v2('${orgA}'::uuid);`), /PERMISSION_DENIED|42501/);

    // Deterministic schema fingerprint for independent replay comparison.
    const dump = docker([
      'exec', containerName, 'pg_dump', '-U', 'postgres', '-d', 'postgres',
      '--schema-only', '--no-owner', '--no-comments', '--restrict-key=A25REPRODUCIBLE',
    ]);
    assert.equal(dump.status, 0, dump.stderr || dump.stdout);
    const fingerprint = createHash('sha256').update(dump.stdout).digest('hex');
    return { fingerprint, version };
  } finally {
    docker(['rm', '-f', containerName]);
  }
}

test('SEC-FIX A2.5 reconstruye el A2 final dos veces desde PostgreSQL 17 limpio', { timeout: 360_000 }, async () => {
  const first = await replayFromCleanDb('one');
  const second = await replayFromCleanDb('two');
  assert.match(first.version, /^17(?:\.|$)/);
  assert.match(second.version, /^17(?:\.|$)/);
  assert.equal(second.fingerprint, first.fingerprint, 'Los dos clean replays deben producir el mismo schema final.');
});
