import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260727030000_guard_invited_user_onboarding.sql';
const documentationPath = 'docs/B0_3_USER_ONBOARDING.md';
const migration = readFileSync(migrationPath, 'utf8');
const documentation = readFileSync(documentationPath, 'utf8');
const teamServer = readFileSync('src/server/team-management.ts', 'utf8');
const cloudApi = readFileSync('src/cloud-api.ts', 'utf8');
const invitationAuth = readFileSync('src/invitation-auth.ts', 'utf8');
const membershipSecurity = readFileSync(
  'supabase/migrations/20260724190000_harden_invited_membership_activation.sql',
  'utf8',
);

function stripSqlCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n\r]*/g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
}

const executableMigration = stripSqlCommentsAndStrings(migration);

test('B0.3 recrea únicamente el trigger de alta con una señal confiable de Auth', () => {
  assert.match(migration, /drop trigger if exists on_propcontrol_user_created on auth\.users/i);
  assert.match(migration, /create trigger on_propcontrol_user_created/i);
  assert.match(migration, /after insert on auth\.users/i);
  assert.match(migration, /for each row\s+when\s*\(new\.invited_at is null\)/i);
  assert.match(migration, /execute function public\.handle_new_propcontrol_user\(\)/i);
  assert.doesNotMatch(migration, /create or replace function public\.handle_new_propcontrol_user/i);
});

test('la bifurcación no confía en metadata editable del usuario', () => {
  assert.doesNotMatch(migration, /raw_user_meta_data/i);
  assert.doesNotMatch(migration, /organization_role/i);
  assert.doesNotMatch(migration, /company_name/i);
  assert.match(migration, /attribute\.attname = 'invited_at'/i);
});

test('el handler conserva SECURITY DEFINER, search_path vacío y referencias calificadas', () => {
  assert.match(migration, /alter function public\.handle_new_propcontrol_user\(\) security definer/i);
  assert.match(migration, /alter function public\.handle_new_propcontrol_user\(\) set search_path = ''/i);
  assert.match(migration, /public\.organizations/i);
  assert.match(migration, /public\.organization_members/i);
  assert.match(migration, /pg_catalog\.pg_get_functiondef/i);
  assert.match(migration, /pg_catalog\.trigger'::pg_catalog\.regtype/i);
});

test('la migración no debilita RLS ni modifica datos, Storage o objetos del MVP', () => {
  assert.doesNotMatch(
    executableMigration,
    /\binsert\s+into\b|\bupdate\s+(?:public|auth|storage)\.|\bdelete\s+from\b|\bmerge\s+into\b|\btruncate\s+table\b/i,
  );
  assert.doesNotMatch(executableMigration, /\b(?:enable|disable|force|no force)\s+row level security\b/i);
  assert.doesNotMatch(executableMigration, /\bcreate\s+policy\b|\bdrop\s+policy\b/i);
  assert.doesNotMatch(executableMigration, /storage\./i);
  assert.doesNotMatch(executableMigration, /user_profiles|organization_settings/i);
});

test('el registro autónomo solo envía el nombre de su propia inmobiliaria', () => {
  const signupStart = cloudApi.indexOf('export async function signUpCloud');
  const signupEnd = cloudApi.indexOf('export async function signInCloud', signupStart);
  const signup = cloudApi.slice(signupStart, signupEnd);
  assert.ok(signupStart >= 0 && signupEnd > signupStart);
  assert.match(signup, /\/auth\/v1\/signup/i);
  assert.match(signup, /data:\s*\{\s*company_name:/i);
  assert.doesNotMatch(signup, /organization_id|organization_role|\brole\b|\bstatus\b/i);
  assert.doesNotMatch(signup, /service_role|SUPABASE_SECRET_KEY/i);
});

test('la ruta de Equipo deriva organización y rol en el servidor', () => {
  const handlerStart = teamServer.indexOf('async function inviteMember');
  const handlerEnd = teamServer.indexOf('async function updateMember', handlerStart);
  const handler = teamServer.slice(handlerStart, handlerEnd);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.match(handler, /const requester = await requesterMembership\(user\.id!, options\)/i);
  assert.match(handler, /const role = requestedRole\(body\.role\)/i);
  assert.match(handler, /organization_id: requester\.organization_id/i);
  assert.match(handler, /user_id: generated\.userId/i);
  assert.match(handler, /role,\s*status: 'invited'/i);
  assert.match(handler, /on_conflict', 'organization_id,user_id'/i);
  assert.match(handler, /resolution=merge-duplicates/i);
  assert.doesNotMatch(handler, /organization_id:\s*body\./i);
});

test('los reintentos usan recuperación o upsert y no crean otra membresía', () => {
  const existingMember = teamServer.indexOf('const existingMember = await organizationMemberByEmail');
  const recovery = teamServer.indexOf("generateTeamLink('recovery'", existingMember);
  const seatCheck = teamServer.indexOf('await ensureSeat(requester.organization_id, options)', existingMember);
  const upsert = teamServer.indexOf("on_conflict', 'organization_id,user_id'", seatCheck);
  assert.ok(existingMember >= 0);
  assert.ok(recovery > existingMember);
  assert.ok(seatCheck > recovery);
  assert.ok(upsert > seatCheck);
});

test('la aceptación conserva invited hasta la contraseña y luego usa el RPC B0.1', () => {
  const passwordUpdate = invitationAuth.indexOf("fetch(`${config.url}/auth/v1/user`");
  const activation = invitationAuth.indexOf('/rest/v1/rpc/activate_my_organization_memberships');
  const cleanup = invitationAuth.indexOf('localStorage.removeItem(INVITATION_KEY)');
  assert.ok(passwordUpdate >= 0);
  assert.ok(activation > passwordUpdate);
  assert.ok(cleanup > activation);
  assert.match(membershipSecurity, /pg_catalog\.lower\(coalesce\(member\.status, ''\)\) = 'invited'/i);
  assert.match(membershipSecurity, /set status = 'active'/i);
  assert.match(membershipSecurity, /invited_count > 1/i);
  assert.match(membershipSecurity, /private\.is_active_org_member/i);
});

test('ninguna clave secreta está en los clientes de registro o invitación', () => {
  for (const clientSource of [cloudApi, invitationAuth]) {
    assert.doesNotMatch(clientSource, /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|sb_secret_/i);
    assert.doesNotMatch(clientSource, /service_role/i);
  }
});

test('la documentación registra causa raíz, ambigüedad, riesgos y rollback', () => {
  assert.match(documentation, /## Causa raíz/i);
  assert.match(documentation, /todavía no existe la membresía invitada/i);
  assert.match(documentation, /## Ambigüedad observada/i);
  assert.match(documentation, /no está versionada/i);
  assert.match(documentation, /auth\.users\.invited_at/i);
  assert.match(documentation, /## Riesgos/i);
  assert.match(documentation, /## Rollback funcional/i);
  assert.match(documentation, /reintroduce el riesgo corregido/i);
  assert.match(documentation, /modifica Supabase ni producción/i);
});

test('registro, invitación y reintentos funcionan en PostgreSQL 17 aislado', { timeout: 180_000 }, async (t) => {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    t.skip('La validación efímera PostgreSQL 17 se ejecuta en GitHub Actions.');
    return;
  }

  const { spawnSync } = await import('node:child_process');
  const { randomUUID } = await import('node:crypto');
  const containerName = `b03-onboarding-${randomUUID().slice(0, 8)}`;

  const runPsql = (sql: string): string => {
    const execution = spawnSync(
      'docker',
      [
        'exec', '-i', containerName,
        'psql', '-U', 'postgres', '-d', 'postgres',
        '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
      ],
      { encoding: 'utf8', input: sql, maxBuffer: 20 * 1024 * 1024 },
    );
    assert.equal(execution.status, 0, execution.stderr || execution.stdout);
    return execution.stdout.trim();
  };

  const parseLastJson = (output: string): Record<string, unknown> => {
    const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const last = lines.at(-1);
    assert.ok(last, 'La consulta no devolvió JSON.');
    return JSON.parse(last) as Record<string, unknown>;
  };

  const started = spawnSync(
    'docker',
    ['run', '--detach', '--rm', '--name', containerName, '--env', 'POSTGRES_PASSWORD=postgres', 'postgres:17'],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );
  assert.equal(started.status, 0, started.stderr || started.stdout);

  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const probe = spawnSync(
        'docker',
        ['exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'postgres'],
        { encoding: 'utf8' },
      );
      if (probe.status === 0) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    assert.equal(ready, true, 'PostgreSQL 17 no quedó disponible.');
    assert.match(runPsql('show server_version;'), /^17(?:\.|$)/);

    runPsql(`
      create schema auth;
      create schema private;

      create table auth.users (
        id uuid primary key,
        email text not null unique,
        invited_at timestamptz,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );

      create table public.organizations (
        id uuid primary key,
        name text not null
      );

      create table public.organization_members (
        organization_id uuid not null references public.organizations(id),
        user_id uuid not null references auth.users(id),
        role text not null,
        status text not null,
        last_active_at timestamptz,
        unique (organization_id, user_id)
      );

      create or replace function public.handle_new_propcontrol_user()
      returns trigger
      language plpgsql
      security invoker
      set search_path = ''
      as $fixture$
      declare
        company_name text;
      begin
        if exists (
          select 1
          from public.organization_members as member
          where member.user_id = new.id
        ) then
          return new;
        end if;

        company_name := nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'company_name'), '');
        if company_name is null then
          return new;
        end if;

        insert into public.organizations (id, name)
        values (new.id, company_name)
        on conflict (id) do nothing;

        insert into public.organization_members (organization_id, user_id, role, status)
        values (new.id, new.id, 'owner', 'active')
        on conflict (organization_id, user_id) do nothing;

        return new;
      end;
      $fixture$;

      create trigger on_propcontrol_user_created
      after insert on auth.users
      for each row
      execute function public.handle_new_propcontrol_user();

      create or replace function private.is_active_org_member(target_org uuid, target_user uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $fixture$
        select exists (
          select 1
          from public.organization_members as member
          where member.organization_id = target_org
            and member.user_id = target_user
            and member.status = 'active'
        );
      $fixture$;

      create or replace function auth.uid()
      returns uuid
      language sql
      stable
      set search_path = ''
      as $fixture$
        select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid;
      $fixture$;

      create or replace function public.activate_my_organization_memberships()
      returns void
      language plpgsql
      security definer
      set search_path = ''
      as $fixture$
      declare
        current_user_id uuid := auth.uid();
        invited_count bigint := 0;
        invited_organization_id uuid;
      begin
        select pg_catalog.count(*), (pg_catalog.array_agg(candidate.organization_id))[1]
        into invited_count, invited_organization_id
        from (
          select member.organization_id
          from public.organization_members as member
          where member.user_id = current_user_id
            and member.status = 'invited'
          order by member.organization_id
          limit 2
          for update
        ) as candidate;

        if invited_count = 0 then return; end if;
        if invited_count > 1 then raise exception 'multiple invitations'; end if;

        update public.organization_members as member
        set status = 'active', last_active_at = pg_catalog.now()
        where member.organization_id = invited_organization_id
          and member.user_id = current_user_id
          and member.status = 'invited';
      end;
      $fixture$;
    `);

    runPsql(migration);
    runPsql(migration);

    const triggerState = parseLastJson(runPsql(`
      select pg_catalog.jsonb_build_object(
        'security_definer', function_info.prosecdef,
        'empty_search_path', function_info.proconfig @> array['search_path=""']::text[],
        'trigger_definition', pg_catalog.pg_get_triggerdef(trigger_info.oid, true)
      )
      from pg_catalog.pg_proc as function_info
      join pg_catalog.pg_namespace as function_namespace
        on function_namespace.oid = function_info.pronamespace
      join pg_catalog.pg_trigger as trigger_info
        on trigger_info.tgfoid = function_info.oid
      where function_namespace.nspname = 'public'
        and function_info.proname = 'handle_new_propcontrol_user'
        and trigger_info.tgname = 'on_propcontrol_user_created';
    `));
    assert.equal(triggerState.security_definer, true);
    assert.equal(triggerState.empty_search_path, true);
    assert.match(String(triggerState.trigger_definition), /invited_at is null/i);

    const inviterOrg = '00000000-0000-0000-0000-000000000100';
    const autonomousUser = '00000000-0000-0000-0000-000000000001';
    const invitedUser = '00000000-0000-0000-0000-000000000002';

    runPsql(`
      insert into public.organizations (id, name)
      values ('${inviterOrg}', 'Invitante');

      insert into auth.users (id, email, invited_at, raw_user_meta_data)
      values (
        '${autonomousUser}',
        'owner@example.test',
        null,
        '{"company_name":"Autónoma"}'::jsonb
      );

      insert into auth.users (id, email, invited_at, raw_user_meta_data)
      values (
        '00000000-0000-0000-0000-000000000099',
        'owner@example.test',
        null,
        '{"company_name":"Duplicada"}'::jsonb
      )
      on conflict (email) do nothing;

      insert into auth.users (id, email, invited_at, raw_user_meta_data)
      values (
        '${invitedUser}',
        'agent@example.test',
        pg_catalog.now(),
        '{"company_name":"No debe crearse","organization_id":"00000000-0000-0000-0000-000000000999","organization_role":"owner"}'::jsonb
      );
    `);

    assert.equal(runPsql(`select private.is_active_org_member('${inviterOrg}', '${invitedUser}');`), 'f');

    runPsql(`
      insert into public.organization_members (organization_id, user_id, role, status)
      values ('${inviterOrg}', '${invitedUser}', 'agent', 'invited')
      on conflict (organization_id, user_id)
      do update set role = excluded.role, status = excluded.status;

      insert into public.organization_members (organization_id, user_id, role, status)
      values ('${inviterOrg}', '${invitedUser}', 'agent', 'invited')
      on conflict (organization_id, user_id)
      do update set role = excluded.role, status = excluded.status;
    `);

    assert.equal(runPsql(`select private.is_active_org_member('${inviterOrg}', '${invitedUser}');`), 'f');

    runPsql(`
      select pg_catalog.set_config('request.jwt.claim.sub', '${invitedUser}', false);
      select public.activate_my_organization_memberships();
    `);
    runPsql(`
      select pg_catalog.set_config('request.jwt.claim.sub', '${invitedUser}', false);
      select public.activate_my_organization_memberships();
    `);

    const result = parseLastJson(runPsql(`
      select pg_catalog.jsonb_build_object(
        'organization_count', (select pg_catalog.count(*) from public.organizations),
        'autonomous_owner_count', (
          select pg_catalog.count(*)
          from public.organization_members
          where user_id = '${autonomousUser}' and role = 'owner' and status = 'active'
        ),
        'invited_own_organization_count', (
          select pg_catalog.count(*)
          from public.organizations
          where id = '${invitedUser}'
        ),
        'invited_membership_count', (
          select pg_catalog.count(*)
          from public.organization_members
          where user_id = '${invitedUser}'
        ),
        'invited_organization', (
          select organization_id::text
          from public.organization_members
          where user_id = '${invitedUser}'
        ),
        'invited_role', (
          select role
          from public.organization_members
          where user_id = '${invitedUser}'
        ),
        'invited_status', (
          select status
          from public.organization_members
          where user_id = '${invitedUser}'
        ),
        'active_access', private.is_active_org_member('${inviterOrg}', '${invitedUser}')
      );
    `));

    assert.equal(result.organization_count, 2);
    assert.equal(result.autonomous_owner_count, 1);
    assert.equal(result.invited_own_organization_count, 0);
    assert.equal(result.invited_membership_count, 1);
    assert.equal(result.invited_organization, inviterOrg);
    assert.equal(result.invited_role, 'agent');
    assert.equal(result.invited_status, 'active');
    assert.equal(result.active_access, true);

    console.log(`B0.3 PostgreSQL 17 isolated onboarding: ${JSON.stringify(result)}`);
  } finally {
    spawnSync('docker', ['rm', '--force', containerName], { encoding: 'utf8' });
  }
});
