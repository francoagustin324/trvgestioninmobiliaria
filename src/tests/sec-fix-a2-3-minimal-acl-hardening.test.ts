import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260910133000_sec_fix_a2_3_minimal_acl_hardening.sql';
const a21Path = 'supabase/migrations/20260910130000_sec_fix_a2_1_canonical_organization_member_status.sql';
const a22Path = 'supabase/migrations/20260910131500_sec_fix_a2_2_active_only_membership_authority_helpers.sql';
const migration = readFileSync(migrationPath, 'utf8');
const cloudApi = readFileSync('src/cloud-api.ts', 'utf8');
const tenantCloudData = readFileSync('src/tenant-cloud-data.ts', 'utf8');
const membershipCatalog = readFileSync('src/membership-catalog.ts', 'utf8');
const publicShare = readFileSync('src/public-property-share.ts', 'utf8');
const teamManagement = readFileSync('src/server/team-management.ts', 'utf8');
const photoStorage = readFileSync('src/server/property-photo-storage.ts', 'utf8');
const databaseUrl = process.env.A2_3_TEST_DATABASE_URL ?? '';

const ORG_A = '00000000-0000-0000-0000-0000000000a1';
const ORG_B = '00000000-0000-0000-0000-0000000000b1';
const USER_A = '00000000-0000-0000-0000-0000000000a2';
const USER_B = '00000000-0000-0000-0000-0000000000b2';
const USER_NEW = '00000000-0000-0000-0000-0000000000c2';
const USER_INVITED = '00000000-0000-0000-0000-0000000000d2';

function psql(sql: string): string {
  if (!databaseUrl) throw new Error('A2_3_TEST_DATABASE_URL no configurada.');
  return execFileSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function psqlAs(role: string, sql: string, userId?: string): string {
  const claim = userId ? `select pg_catalog.set_config('request.jwt.claim.sub','${userId}',false);` : '';
  return psql(`${claim} set role ${role}; ${sql} reset role;`);
}

function applyFile(path: string): void {
  if (!databaseUrl) throw new Error('A2_3_TEST_DATABASE_URL no configurada.');
  execFileSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function hasTablePrivilege(role: string, table: string, privilege: string): boolean {
  return psql(`select pg_catalog.has_table_privilege('${role}','${table}','${privilege}');`) === 't';
}

function hasSequencePrivilege(role: string, sequence: string, privilege: string): boolean {
  return psql(`select pg_catalog.has_sequence_privilege('${role}','${sequence}','${privilege}');`) === 't';
}

function hasFunctionPrivilege(role: string, signature: string): boolean {
  return psql(`select pg_catalog.has_function_privilege('${role}','${signature}','EXECUTE');`) === 't';
}

function expectDenied(run: () => unknown): void {
  assert.throws(run);
}

function fixtureDataDigest(): string {
  return psql(`
    select pg_catalog.md5(pg_catalog.concat_ws('|',
      coalesce((select pg_catalog.string_agg(id::text || ':' || name, ',' order by id) from public.organizations), ''),
      coalesce((select pg_catalog.string_agg(organization_id::text || ':' || user_id::text || ':' || role || ':' || status || ':' || member_id::text, ',' order by organization_id,user_id) from public.organization_members), ''),
      coalesce((select pg_catalog.string_agg(id::text || ':' || organization_id::text || ':' || title, ',' order by id) from public.fichas), ''),
      coalesce((select pg_catalog.string_agg(organization_id::text || ':' || entity_type || ':' || entity_key, ',' order by organization_id,entity_type,entity_key) from public.propcontrol_records), ''),
      coalesce((select pg_catalog.string_agg(organization_id::text || ':' || property_key || ':' || slug, ',' order by organization_id,property_key) from public.public_property_fichas), '')
    ));
  `);
}

function aclDigest(): string {
  return psql(`
    select pg_catalog.md5(pg_catalog.concat_ws('|',
      coalesce((select pg_catalog.string_agg(c.relname || ':' || coalesce(c.relacl::text,''), ',' order by c.relname)
        from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname in ('organizations','organization_members','fichas','propcontrol_records','public_property_fichas','organization_members_member_id_seq')), ''),
      coalesce((select pg_catalog.string_agg(n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || '):' || coalesce(p.proacl::text,'') || ':' || coalesce(p.proconfig::text,''), ',' order by n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid))
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where (n.nspname='private' and p.proname in ('is_active_org_member','org_member_role','org_member_number','normalized_org_role','can_access_property_photo','visit_authority_active','visit_normalized','visit_qualification_missing','next_commercial_legacy_id','commercial_visit_duplicate_exists','guard_transaction_owned_records'))
           or (n.nspname='public' and p.proname in ('is_org_member','activate_my_organization_memberships','can_manage_public_property_ficha','get_public_property_ficha','handle_new_propcontrol_user','protect_propcontrol_record_identity','visit_transaction_authority_active','client_snapshot_cas','commercial_visit_mutation','visit_transaction_authority_active_v2','client_snapshot_cas_v2','commercial_visit_mutation_v2'))), '')
    ));
  `);
}

function setupFixture(): void {
  psql(`
    reset role;
    drop schema if exists private cascade;
    drop schema if exists auth cascade;
    drop schema public cascade;
    create schema public;
    create schema private;
    create schema auth;

    do $roles$
    begin
      if not exists (select 1 from pg_catalog.pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_catalog.pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_catalog.pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      if not exists (select 1 from pg_catalog.pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
    end;
    $roles$;
    alter role service_role bypassrls;

    grant usage on schema public to anon, authenticated, service_role, supabase_auth_admin;
    grant usage on schema private to authenticated, service_role;
    grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;

    create table auth.users (
      id uuid primary key,
      invited_at timestamptz,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    grant insert on auth.users to supabase_auth_admin;

    create function auth.uid()
    returns uuid language sql stable set search_path to ''
    as $$ select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to public;

    create table public.organizations (
      id uuid primary key,
      name text not null,
      seat_limit integer
    );

    create sequence public.organization_members_member_id_seq;
    create table public.organization_members (
      organization_id uuid not null references public.organizations(id) on delete cascade,
      user_id uuid not null,
      role text not null,
      member_id bigint not null default nextval('public.organization_members_member_id_seq'),
      status text default 'active',
      primary key (organization_id,user_id)
    );

    create table public.fichas (
      id uuid primary key default pg_catalog.gen_random_uuid(),
      organization_id uuid not null,
      title text not null,
      source text not null default 'manual',
      public_data jsonb not null default '{}'::jsonb,
      internal_data jsonb not null default '{}'::jsonb,
      created_by uuid,
      updated_at timestamptz not null default pg_catalog.now()
    );

    create table public.propcontrol_records (
      organization_id uuid not null,
      entity_type text not null,
      entity_key text not null,
      assigned_member_id bigint,
      payload jsonb not null default '{}'::jsonb,
      created_by uuid,
      primary key (organization_id,entity_type,entity_key)
    );

    create table public.public_property_fichas (
      organization_id uuid not null,
      property_key text not null,
      slug text not null unique,
      published boolean not null default true,
      payload jsonb not null default '{}'::jsonb,
      created_by uuid,
      primary key (organization_id,property_key)
    );

    create function private.normalized_org_role(value text)
    returns text language sql immutable
    as $$ select case when lower(coalesce(value,'')) in ('owner','dueño','dueno') then 'owner' when lower(coalesce(value,'')) in ('admin','administrator','administrador') then 'admin' else 'agent' end $$;

    create function private.org_member_role(target_org uuid, target_user uuid default auth.uid())
    returns text language sql stable security definer set search_path to ''
    as $$ select private.normalized_org_role(m.role) from public.organization_members m where m.organization_id=target_org and m.user_id=target_user and lower(coalesce(m.status,'active')) <> 'suspended' limit 1 $$;

    create function private.org_member_number(target_org uuid, target_user uuid default auth.uid())
    returns bigint language sql stable security definer set search_path to ''
    as $$ select m.member_id from public.organization_members m where m.organization_id=target_org and m.user_id=target_user and lower(coalesce(m.status,'active')) <> 'suspended' limit 1 $$;

    create function private.is_active_org_member(target_org uuid, target_user uuid default auth.uid())
    returns boolean language sql stable security definer set search_path to ''
    as $$ select exists(select 1 from public.organization_members m where m.organization_id=target_org and m.user_id=target_user and m.status='active') $$;

    create function private.can_access_property_photo(folder text)
    returns boolean language sql stable security definer set search_path to ''
    as $$ select case when folder is null then false else private.is_active_org_member(folder::uuid,auth.uid()) end $$;

    create function public.is_org_member(target_org uuid)
    returns boolean language sql stable security definer set search_path to ''
    as $$ select private.is_active_org_member(target_org,auth.uid()) $$;

    create function public.activate_my_organization_memberships()
    returns void language plpgsql security definer set search_path to ''
    as $$ begin update public.organization_members set status='active' where user_id=auth.uid() and status='invited'; end $$;

    create function public.can_manage_public_property_ficha(target_organization text)
    returns boolean language plpgsql stable security definer set search_path to ''
    as $$ begin return private.is_active_org_member(target_organization::uuid,auth.uid()); exception when invalid_text_representation then return false; end $$;

    create function public.get_public_property_ficha(target_slug text)
    returns jsonb language sql stable security definer set search_path to 'public'
    as $$ select payload from public.public_property_fichas where slug=target_slug and published=true limit 1 $$;

    create function public.handle_new_propcontrol_user()
    returns trigger language plpgsql security definer set search_path to ''
    as $$ begin
      insert into public.organizations(id,name) values(new.id,coalesce(nullif(new.raw_user_meta_data->>'organization_name',''),'Mi inmobiliaria'));
      insert into public.organization_members(organization_id,user_id,role,status) values(new.id,new.id,'owner','active');
      return new;
    end $$;

    create trigger on_propcontrol_user_created
      after insert on auth.users for each row
      when (new.invited_at is null)
      execute function public.handle_new_propcontrol_user();

    create function public.protect_propcontrol_record_identity()
    returns trigger language plpgsql security invoker set search_path to '' as $$ begin return new; end $$;

    create function private.visit_authority_active(target_org uuid)
    returns boolean language sql stable security invoker set search_path to '' as $$ select private.is_active_org_member(target_org,auth.uid()) $$;
    create function private.visit_normalized(value text)
    returns text language sql immutable security invoker set search_path to '' as $$ select coalesce(value,'') $$;
    create function private.visit_qualification_missing(value jsonb)
    returns text[] language sql stable security invoker set search_path to '' as $$ select array[]::text[] $$;
    create function private.next_commercial_legacy_id(target_organization_id uuid,target_entity_type text)
    returns bigint language sql volatile security definer set search_path to '' as $$ select 1::bigint $$;
    create function private.commercial_visit_duplicate_exists(target_organization_id uuid,target_client_id bigint,target_property_id bigint,target_scheduled_at timestamptz)
    returns boolean language sql volatile security definer set search_path to '' as $$ select false $$;
    create function private.guard_transaction_owned_records()
    returns trigger language plpgsql security invoker set search_path to '' as $$ begin return case when tg_op='DELETE' then old else new end; end $$;

    create function public.visit_transaction_authority_active()
    returns boolean language sql stable security invoker set search_path to '' as $$ select true $$;
    create function public.client_snapshot_cas(p_request jsonb,p_force_rollback boolean default false)
    returns jsonb language sql volatile security invoker set search_path to '' as $$ select '{}'::jsonb $$;
    create function public.commercial_visit_mutation(p_operation_id uuid,p_operation_type text,p_request jsonb,p_force_rollback boolean default false)
    returns jsonb language sql volatile security invoker set search_path to '' as $$ select '{}'::jsonb $$;

    -- V2 presentes en repo; A2.3 debe endurecerlos si existen, sin crearlos en producción.
    create function public.visit_transaction_authority_active_v2(p_organization_id uuid)
    returns boolean language sql stable security invoker set search_path to '' as $$ select true $$;
    create function public.client_snapshot_cas_v2(p_organization_id uuid,p_request jsonb,p_force_rollback boolean default false)
    returns jsonb language sql volatile security invoker set search_path to '' as $$ select '{}'::jsonb $$;
    create function public.commercial_visit_mutation_v2(p_organization_id uuid,p_operation_id uuid,p_operation_type text,p_request jsonb,p_force_rollback boolean default false)
    returns jsonb language sql volatile security invoker set search_path to '' as $$ select '{}'::jsonb $$;

    insert into public.organizations(id,name,seat_limit) values
      ('${ORG_A}','Org A',10),('${ORG_B}','Org B',10);
    insert into public.organization_members(organization_id,user_id,role,status) values
      ('${ORG_A}','${USER_A}','owner','active'),
      ('${ORG_B}','${USER_B}','owner','active');
    insert into public.fichas(organization_id,title,source,created_by) values
      ('${ORG_A}','A ficha','manual','${USER_A}'),
      ('${ORG_B}','B ficha','manual','${USER_B}');
    insert into public.propcontrol_records(organization_id,entity_type,entity_key,payload,created_by) values
      ('${ORG_A}','client','a','{}','${USER_A}'),
      ('${ORG_B}','client','b','{}','${USER_B}');
    insert into public.public_property_fichas(organization_id,property_key,slug,published,payload,created_by) values
      ('${ORG_B}','b','public-b',true,'{"name":"B"}','${USER_B}');

    alter table public.organizations enable row level security;
    alter table public.organization_members enable row level security;
    alter table public.fichas enable row level security;
    alter table public.propcontrol_records enable row level security;
    alter table public.public_property_fichas enable row level security;

    create policy organizations_access on public.organizations for select to authenticated using(public.is_org_member(id));
    create policy members_select on public.organization_members for select to authenticated using(user_id=auth.uid() or private.is_active_org_member(organization_id));
    create policy fichas_access on public.fichas for all to authenticated using(public.is_org_member(organization_id)) with check(public.is_org_member(organization_id));
    create policy records_access on public.propcontrol_records for all to authenticated using(private.is_active_org_member(organization_id)) with check(private.is_active_org_member(organization_id));
    create policy public_ficha_select on public.public_property_fichas for select to authenticated using(public.can_manage_public_property_ficha(organization_id::text));
    create policy public_ficha_insert on public.public_property_fichas for insert to authenticated with check(public.can_manage_public_property_ficha(organization_id::text));
    create policy public_ficha_update on public.public_property_fichas for update to authenticated using(public.can_manage_public_property_ficha(organization_id::text)) with check(public.can_manage_public_property_ficha(organization_id::text));

    -- Simular drift histórico amplio previo a A2.3.
    grant all privileges on table public.organizations,public.organization_members,public.fichas,public.propcontrol_records,public.public_property_fichas to anon,authenticated,service_role;
    grant all privileges on sequence public.organization_members_member_id_seq to anon,authenticated,service_role;
    grant execute on all functions in schema public to anon,authenticated,service_role;
    grant execute on all functions in schema private to authenticated,service_role;
  `);

  applyFile(a21Path);
  applyFile(a22Path);
}

const tableExpectations: Record<string, Record<string, readonly string[]>> = {
  anon: {
    'public.organizations': [],
    'public.organization_members': [],
    'public.fichas': [],
    'public.propcontrol_records': [],
    'public.public_property_fichas': [],
  },
  authenticated: {
    'public.organizations': [],
    'public.organization_members': ['SELECT'],
    'public.fichas': ['SELECT','INSERT','UPDATE'],
    'public.propcontrol_records': ['SELECT','INSERT','UPDATE','DELETE'],
    'public.public_property_fichas': ['SELECT','INSERT','UPDATE'],
  },
  service_role: {
    'public.organizations': ['SELECT'],
    'public.organization_members': ['SELECT','INSERT','UPDATE'],
    'public.fichas': [],
    'public.propcontrol_records': [],
    'public.public_property_fichas': [],
  },
};

const allTablePrivileges = ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] as const;

const authenticatedFunctions = [
  'private.is_active_org_member(uuid,uuid)',
  'private.org_member_role(uuid,uuid)',
  'private.org_member_number(uuid,uuid)',
  'private.can_access_property_photo(text)',
  'public.is_org_member(uuid)',
  'public.activate_my_organization_memberships()',
  'public.can_manage_public_property_ficha(text)',
  'private.visit_authority_active(uuid)',
  'private.visit_normalized(text)',
  'private.visit_qualification_missing(jsonb)',
  'private.next_commercial_legacy_id(uuid,text)',
  'private.commercial_visit_duplicate_exists(uuid,bigint,bigint,timestamptz)',
  'public.visit_transaction_authority_active()',
  'public.client_snapshot_cas(jsonb,boolean)',
  'public.commercial_visit_mutation(uuid,text,jsonb,boolean)',
  'public.visit_transaction_authority_active_v2(uuid)',
  'public.client_snapshot_cas_v2(uuid,jsonb,boolean)',
  'public.commercial_visit_mutation_v2(uuid,uuid,text,jsonb,boolean)',
] as const;

const ownerOnlyFunctions = [
  'private.normalized_org_role(text)',
  'public.handle_new_propcontrol_user()',
  'public.protect_propcontrol_record_identity()',
  'private.guard_transaction_owned_records()',
] as const;

const sensitiveDefiners = [
  'private.is_active_org_member(uuid,uuid)',
  'private.org_member_role(uuid,uuid)',
  'private.org_member_number(uuid,uuid)',
  'private.can_access_property_photo(text)',
  'public.is_org_member(uuid)',
  'public.activate_my_organization_memberships()',
  'public.can_manage_public_property_ficha(text)',
  'public.get_public_property_ficha(text)',
  'public.handle_new_propcontrol_user()',
  'private.next_commercial_legacy_id(uuid,text)',
  'private.commercial_visit_duplicate_exists(uuid,bigint,bigint,timestamptz)',
] as const;

test('A2.3 inventory: los callers productivos del repo justifican la matriz mínima', () => {
  assert.match(membershipCatalog, /rest\/v1\/organization_members/);
  assert.match(cloudApi, /rest\/v1\/propcontrol_records/);
  assert.match(tenantCloudData, /rest\/v1\/fichas/);
  assert.match(publicShare, /rest\/v1\/public_property_fichas/);
  assert.match(publicShare, /rest\/v1\/rpc\/get_public_property_ficha/);
  assert.match(teamManagement, /organization_members/);
  assert.match(teamManagement, /organizations/);
  assert.match(photoStorage, /organization_members/);
  assert.equal(/rest\/v1\/organizations/.test(cloudApi + tenantCloudData + membershipCatalog + publicShare), false);
});

test('A2.3 static: migration sólo modifica ACL/search_path y no toca datos ni policies', () => {
  assert.match(migration, /^--[\s\S]*?\bbegin;[\s\S]*\bcommit;\s*$/i);
  assert.equal(/\b(insert|update|delete)\s+(into\s+|from\s+)?public\./i.test(migration), false);
  assert.equal(/\b(create|alter|drop)\s+policy\b/i.test(migration), false);
  assert.match(migration, /revoke\s+all\s+privileges\s+on\s+table\s+public\.organizations/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+public\.get_public_property_ficha\(text\)\s+to\s+anon/i);
});

test('A2.3 PostgreSQL 17: ACL mínima, RLS, onboarding y public share', { skip: !databaseUrl }, async (t) => {
  setupFixture();
  const dataBefore = fixtureDataDigest();
  applyFile(migrationPath);

  await t.test('1-4. anon/authenticated no pueden TRUNCATE organizations, organization_members ni fichas', () => {
    for (const role of ['anon','authenticated']) {
      for (const table of ['public.organizations','public.organization_members','public.fichas']) {
        assert.equal(hasTablePrivilege(role, table, 'TRUNCATE'), false, `${role} TRUNCATE ${table}`);
        expectDenied(() => psqlAs(role, `truncate table ${table};`, role === 'authenticated' ? USER_A : undefined));
      }
    }
  });

  await t.test('5-6. ACL de tablas es exactamente la requerida por anon/authenticated/service_role', () => {
    for (const [role, tables] of Object.entries(tableExpectations)) {
      for (const [table, allowed] of Object.entries(tables)) {
        for (const privilege of allTablePrivileges) {
          assert.equal(hasTablePrivilege(role, table, privilege), allowed.includes(privilege), `${role} ${table} ${privilege}`);
        }
      }
    }
    assert.equal(hasSequencePrivilege('service_role','public.organization_members_member_id_seq','USAGE'), true);
    assert.equal(hasSequencePrivilege('anon','public.organization_members_member_id_seq','USAGE'), false);
    assert.equal(hasSequencePrivilege('authenticated','public.organization_members_member_id_seq','USAGE'), false);
  });

  await t.test('7. RLS conserva aislamiento tenant para authenticated', () => {
    const visible = psqlAs('authenticated', `select pg_catalog.string_agg(organization_id::text,',' order by organization_id) from public.propcontrol_records;`, USER_A);
    assert.equal(visible, ORG_A);
    expectDenied(() => psqlAs('authenticated', `insert into public.propcontrol_records(organization_id,entity_type,entity_key,payload,created_by) values('${ORG_B}','client','forbidden','{}','${USER_A}');`, USER_A));
  });

  await t.test('8. service_role conserva operación exacta de Equipo + sequence default', () => {
    const userService = '00000000-0000-0000-0000-0000000000e2';
    psqlAs('service_role', `insert into public.organization_members(organization_id,user_id,role,status) values('${ORG_A}','${userService}','agent','invited');`);
    assert.equal(psqlAs('service_role', `select status from public.organization_members where organization_id='${ORG_A}' and user_id='${userService}';`), 'invited');
    psqlAs('service_role', `update public.organization_members set status='active' where organization_id='${ORG_A}' and user_id='${userService}';`);
    assert.equal(psqlAs('service_role', `select name from public.organizations where id='${ORG_A}';`), 'Org A');
  });

  await t.test('9-11. EXECUTE queda mínimo: PUBLIC/anon cerrados salvo RPC público; authenticated conserva callers legítimos', () => {
    for (const signature of sensitiveDefiners) {
      assert.equal(hasFunctionPrivilege('public', signature), false, `PUBLIC ${signature}`);
    }
    for (const signature of authenticatedFunctions) {
      assert.equal(hasFunctionPrivilege('authenticated', signature), true, `authenticated ${signature}`);
      assert.equal(hasFunctionPrivilege('anon', signature), false, `anon ${signature}`);
      assert.equal(hasFunctionPrivilege('service_role', signature), false, `service_role ${signature}`);
    }
    for (const signature of ownerOnlyFunctions) {
      for (const role of ['public','anon','authenticated','service_role']) {
        assert.equal(hasFunctionPrivilege(role, signature), false, `${role} ${signature}`);
      }
    }
    assert.equal(hasFunctionPrivilege('anon','public.get_public_property_ficha(text)'), true);
    assert.equal(hasFunctionPrivilege('authenticated','public.get_public_property_ficha(text)'), false);
    assert.equal(hasFunctionPrivilege('service_role','public.get_public_property_ficha(text)'), false);
  });

  await t.test('12-14. handle_new no es callable por app roles, trigger funciona e invitación no crea org secundaria', () => {
    for (const role of ['anon','authenticated','service_role','supabase_auth_admin']) {
      assert.equal(hasFunctionPrivilege(role,'public.handle_new_propcontrol_user()'), false);
    }
    psqlAs('supabase_auth_admin', `insert into auth.users(id,raw_user_meta_data) values('${USER_NEW}','{"organization_name":"Nueva Org"}');`);
    assert.equal(psql(`select count(*) from public.organizations where id='${USER_NEW}';`), '1');
    assert.equal(psql(`select role || ':' || status from public.organization_members where organization_id='${USER_NEW}' and user_id='${USER_NEW}';`), 'owner:active');

    psqlAs('supabase_auth_admin', `insert into auth.users(id,invited_at,raw_user_meta_data) values('${USER_INVITED}',pg_catalog.now(),'{}');`);
    assert.equal(psql(`select count(*) from public.organizations where id='${USER_INVITED}';`), '0');
  });

  await t.test('15. ficha pública anónima carga por RPC sin SELECT directo de tabla', () => {
    assert.equal(hasTablePrivilege('anon','public.public_property_fichas','SELECT'), false);
    const payload = psqlAs('anon', `select public.get_public_property_ficha('public-b')::text;`);
    assert.match(payload, /"name": "B"|"name":"B"/);
  });

  await t.test('16. public share authenticated conserva UPSERT directo y RLS', () => {
    psqlAs('authenticated', `
      insert into public.public_property_fichas(organization_id,property_key,slug,published,payload,created_by)
      values('${ORG_A}','a','public-a',true,'{"name":"A1"}','${USER_A}')
      on conflict (organization_id,property_key) do update set payload=excluded.payload;
    `, USER_A);
    psqlAs('authenticated', `
      insert into public.public_property_fichas(organization_id,property_key,slug,published,payload,created_by)
      values('${ORG_A}','a','public-a',true,'{"name":"A2"}','${USER_A}')
      on conflict (organization_id,property_key) do update set payload=excluded.payload;
    `, USER_A);
    assert.match(psqlAs('authenticated', `select payload::text from public.public_property_fichas where organization_id='${ORG_A}' and property_key='a';`, USER_A), /A2/);
    expectDenied(() => psqlAs('authenticated', `insert into public.public_property_fichas(organization_id,property_key,slug,published,payload,created_by) values('${ORG_B}','x','forbidden-b',true,'{}','${USER_A}');`, USER_A));
  });

  await t.test('17. A2.2 active-only sigue intacto', () => {
    const invitedUser = '00000000-0000-0000-0000-0000000000f2';
    psqlAs('service_role', `insert into public.organization_members(organization_id,user_id,role,status) values('${ORG_A}','${invitedUser}','owner','invited');`);
    assert.equal(psql(`select coalesce(private.org_member_role('${ORG_A}','${invitedUser}'),'NULL');`), 'NULL');
    assert.equal(psql(`select coalesce(private.org_member_number('${ORG_A}','${invitedUser}')::text,'NULL');`), 'NULL');
    assert.equal(psql(`select private.org_member_role('${ORG_A}','${USER_A}');`), 'owner');
  });

  await t.test('18. A2.1 status contract sigue intacto', () => {
    const definition = psql(`select pg_catalog.pg_get_constraintdef(oid,true) from pg_catalog.pg_constraint where conrelid='public.organization_members'::regclass and conname='organization_members_status_check';`);
    assert.match(definition, /status IN \('active'::text, 'invited'::text, 'suspended'::text\)|status = ANY/i);
    expectDenied(() => psql(`insert into public.organization_members(organization_id,user_id,role,status) values('${ORG_A}','00000000-0000-0000-0000-000000000099','agent','Active');`));
  });

  await t.test('postflight: SECURITY DEFINER relevantes usan search_path vacío', () => {
    for (const signature of sensitiveDefiners) {
      const definition = psql(`select pg_catalog.pg_get_functiondef('${signature}'::regprocedure);`);
      assert.match(definition, /SECURITY DEFINER/i, signature);
      assert.match(definition, /SET search_path TO ''|SET search_path = ''/i, signature);
    }
  });

  await t.test('postflight: migration no muta datos preexistentes', () => {
    // Los inserts posteriores pertenecen a tests funcionales; validamos aquí que la aplicación
    // inicial de A2.3, antes de esos flujos, no alteró el snapshot inicial.
    // El digest inicial se vuelve a comprobar en un fixture limpio en el test siguiente.
    assert.ok(dataBefore.length > 0);
  });
});

test('A2.3 PostgreSQL 17: no data mutation e idempotencia exacta de ACL', { skip: !databaseUrl }, () => {
  setupFixture();
  const dataBefore = fixtureDataDigest();
  applyFile(migrationPath);
  const dataAfterFirst = fixtureDataDigest();
  const aclAfterFirst = aclDigest();
  applyFile(migrationPath);
  const dataAfterSecond = fixtureDataDigest();
  const aclAfterSecond = aclDigest();
  assert.equal(dataAfterFirst, dataBefore);
  assert.equal(dataAfterSecond, dataBefore);
  assert.equal(aclAfterSecond, aclAfterFirst);
});
