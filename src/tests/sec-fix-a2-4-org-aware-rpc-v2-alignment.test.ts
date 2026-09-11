import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const r21Path = 'supabase/migrations/20260827170000_p1_1_a7_r2_1_transaction_foundation.sql';
const r22bPath = 'supabase/migrations/20260831120000_p1_1_a7_r2_2_visit_transaction_backend.sql';
const r22cPath = 'supabase/migrations/20260901223000_p1_1_a7_r2_2c_visit_authority_capability.sql';
const r22dPath = 'supabase/migrations/20260903150000_p1_1_a7_r2_2d_client_reassignment_cas.sql';
const migrationPath = 'supabase/migrations/20260910140000_sec_fix_a2_4_org_aware_rpc_v2_alignment.sql';
const tenantV2Path = 'src/tenant-visit-v2.ts';

const r21 = readFileSync(r21Path, 'utf8');
const r22b = readFileSync(r22bPath, 'utf8');
const r22c = readFileSync(r22cPath, 'utf8');
const r22d = readFileSync(r22dPath, 'utf8');
const migration = readFileSync(migrationPath, 'utf8');
const tenantV2 = readFileSync(tenantV2Path, 'utf8');

function gitBlobSha(content: string): string {
  const header = Buffer.from(`blob ${Buffer.byteLength(content)}\0`);
  return createHash('sha1').update(header).update(content).digest('hex');
}

function jsonSql(value: unknown): string {
  return `$json$${JSON.stringify(value)}$json$::jsonb`;
}

function readyClient(id: number, assignedToId = 1, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: `Cliente ${id}`,
    phone: '111',
    interest: 'Departamento',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Calificado',
    budget: '100000',
    currency: 'USD',
    paymentMethod: 'Contado',
    zones: 'Centro',
    purpose: 'Vivir',
    purchaseTimeframe: 'Este año',
    canMoveForward: 'Sí',
    knowsArea: 'Sí',
    assignedToId,
    revision: 0,
    ...overrides,
  };
}

test('SEC-FIX A2.4 conserva contrato A1.1, explicita tenant y no toca legacy', () => {
  assert.equal(gitBlobSha(r22b), 'd7f2eeff0c6703dac83b768d55922bfd3eb94aaf');
  assert.equal(gitBlobSha(r22c), '9ee2f80ea6302a7653fc1706038064591e67f279');
  assert.equal(gitBlobSha(r22d), 'fbe43d7fc49d8851569ad57c45818173dd8cb6d9');

  assert.match(migration, /create or replace function public\.visit_transaction_authority_active_v2\(\s*p_organization_id uuid\s*\)/i);
  assert.match(migration, /create or replace function public\.client_snapshot_cas_v2\(\s*p_organization_id uuid,\s*p_request jsonb,\s*p_force_rollback boolean default false/i);
  assert.match(migration, /create or replace function public\.commercial_visit_mutation_v2\(\s*p_organization_id uuid,\s*p_operation_id uuid,\s*p_operation_type text,\s*p_request jsonb,\s*p_force_rollback boolean default false/i);
  assert.equal((migration.match(/security invoker/gi) ?? []).length, 3);
  assert.equal((migration.match(/set search_path = ''/gi) ?? []).length, 3);
  assert.match(migration, /visit_transaction_authority_active_v2[\s\S]*language plpgsql[\s\S]*stable[\s\S]*security invoker/i);

  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?function\s+public\.visit_transaction_authority_active\s*\(\s*\)/i);
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?function\s+public\.client_snapshot_cas\s*\(\s*p_request/i);
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?function\s+public\.commercial_visit_mutation\s*\(\s*p_operation_id/i);
  assert.doesNotMatch(migration, /drop\s+function\s+public\.(?:visit_transaction_authority_active|client_snapshot_cas|commercial_visit_mutation)/i);
  assert.doesNotMatch(migration, /activate_my_organization_memberships|private\.org_member_role\s*\(/i);
  assert.doesNotMatch(migration, /alter\s+policy|create\s+policy|drop\s+policy|alter\s+table\s+public\.organization_members/i);
  assert.doesNotMatch(migration, /insert\s+into\s+private\.commercial_entity_authority/i);
assert.match(migration, /and member\.status = 'active'/);
assert.match(migration, /and target_member\.status = 'active'/);
assert.doesNotMatch(migration, /visit_normalized\(member\.status\)/);
assert.match(migration, /firma\/overload incompatible/);
assert.match(tenantV2, /'visit_transaction_authority_active_v2'[\s\S]*p_organization_id: scope\.organizationId/);
assert.match(tenantV2, /'client_snapshot_cas_v2'[\s\S]*p_organization_id: scope\.organizationId/);
assert.match(tenantV2, /'commercial_visit_mutation_v2'[\s\S]*p_organization_id: scope\.organizationId/);
assert.doesNotMatch(migration, /public\.commercial_visit_mutation\s*\(/);
assert.doesNotMatch(migration, /public\.client_snapshot_cas\s*\(/);
assert.doesNotMatch(migration, /public\.visit_transaction_authority_active\s*\(\s*\)/);

});

test('SEC-FIX A2.4 ejecuta V2 org-aware y drift alignment en PostgreSQL 17 efímero', { timeout: 240_000 }, async () => {
  const { spawnSync } = await import('node:child_process');
  const containerName = `sec-a11-${randomUUID().slice(0, 8)}`;

  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';
  const orgC = '33333333-3333-4333-8333-333333333333';
  const multiOwner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const singleOwner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const invitedUser = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const suspendedUser = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const noMember = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const unknownUser = 'abababab-abab-4bab-8bab-abababababab';
  const adminA = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const otherB = '99999999-9999-4999-8999-999999999999';

  const docker = (args: string[]) => spawnSync('docker', args, {
    encoding: 'utf8', maxBuffer: 40 * 1024 * 1024,
  });
  const rawPsql = (sql: string) => spawnSync(
    'docker',
    ['exec', '-i', containerName, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
    { encoding: 'utf8', input: sql, maxBuffer: 40 * 1024 * 1024 },
  );
  const diagnostics = (): string => {
    const inspect = docker(['inspect', containerName, '--format',
      'running={{.State.Running}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} exit={{.State.ExitCode}}']);
    const logs = docker(['logs', '--tail', '100', containerName]);
    return `${inspect.stdout || inspect.stderr}\n${logs.stdout || logs.stderr}`;
  };
  const psql = (sql: string): string => {
    const result = rawPsql(sql);
    assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${diagnostics()}`);
    return result.stdout.trim();
  };
  const asUser = (userId: string, sql: string): string => psql(`
    set role authenticated;
    select pg_catalog.set_config('request.jwt.claim.sub', '${userId}', false);
    ${sql}
  `).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? '';
  const asUserError = (userId: string, sql: string): string => {
    const result = rawPsql(`
      \\set VERBOSITY verbose
      set role authenticated;
      select pg_catalog.set_config('request.jwt.claim.sub', '${userId}', false);
      ${sql}
    `);
    assert.notEqual(result.status, 0, 'La sentencia debía fallar.');
    return `${result.stderr}\n${result.stdout}`;
  };
  const parseJson = (value: string): Record<string, any> => JSON.parse(value) as Record<string, any>;
  const key = (org: string, identity: string | number): string => `${org}:${identity}`;
  const authorityV2 = (org: string): string =>
    `select public.visit_transaction_authority_active_v2('${org}'::uuid);`;
  const casV2 = (org: string, request: unknown, rollback = false): string =>
    `select public.client_snapshot_cas_v2('${org}'::uuid, ${jsonSql(request)}, ${rollback});`;
  const visitV2 = (org: string, operationId: string, type: 'VISIT_CREATE' | 'VISIT_RESOLVE', request: unknown, rollback = false): string =>
    `select public.commercial_visit_mutation_v2('${org}'::uuid, '${operationId}'::uuid, '${type}', ${jsonSql(request)}, ${rollback});`;
  const visitLegacy = (operationId: string, type: 'VISIT_CREATE' | 'VISIT_RESOLVE', request: unknown, rollback = false): string =>
    `select public.commercial_visit_mutation('${operationId}'::uuid, '${type}', ${jsonSql(request)}, ${rollback});`;
  const createRequest = (clientId: number, propertyId: number, expectedClientRevision = 0, date = '2035-01-02', time = '10:30') => ({
    client: { legacyId: clientId }, property: { legacyId: propertyId },
    expectedClientRevision, localDate: date, localTime: time,
  });

  const started = docker([
    'run', '--detach', '--name', containerName,
    '--env', 'POSTGRES_PASSWORD=postgres',
    '--health-cmd', 'pg_isready -U postgres -d postgres',
    '--health-interval', '1s', '--health-timeout', '5s',
    '--health-start-period', '2s', '--health-retries', '60',
    'postgres:17',
  ]);
  assert.equal(started.status, 0, started.stderr || started.stdout);

  try {
    let healthy = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const probe = docker(['inspect', containerName, '--format',
        '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}']);
      if (probe.status === 0 && probe.stdout.trim() === 'true|healthy') { healthy = true; break; }
      if (probe.status === 0 && probe.stdout.trim().startsWith('false|')) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(healthy, true, `PostgreSQL 17 no quedó healthy.\n${diagnostics()}`);
    assert.match(psql('show server_version;'), /^17(?:\.|$)/);

    psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema auth;
      create schema private;
      grant usage on schema public, private, auth to authenticated;

      create function auth.uid() returns uuid language sql stable security invoker set search_path = ''
      as $f$ select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid $f$;

      create table public.organizations (id uuid primary key, name text not null);
      create table public.organization_members (
        organization_id uuid not null,
        user_id uuid not null,
        member_id bigint not null,
        role text not null,
        status text not null,
        primary key (organization_id, user_id),
        unique (organization_id, member_id)
      );

      create function private.normalized_org_role(value text) returns text
      language sql immutable security definer set search_path = '' as $f$
        select case
          when pg_catalog.lower(coalesce(value,'')) in ('owner','dueño','dueno') then 'owner'
          when pg_catalog.lower(coalesce(value,'')) in ('admin','administrator','administrador') then 'admin'
          else 'agent'
        end
      $f$;
      create function private.org_member_role(target_org uuid, target_user uuid default auth.uid()) returns text
      language sql stable security definer set search_path = '' as $f$
        select private.normalized_org_role(role)
        from public.organization_members
        where organization_id=target_org and user_id=target_user
          and pg_catalog.lower(status) <> 'suspended'
        limit 1
      $f$;
      create function private.org_member_number(target_org uuid, target_user uuid default auth.uid()) returns bigint
      language sql stable security definer set search_path = '' as $f$
        select member_id
        from public.organization_members
        where organization_id=target_org and user_id=target_user
          and pg_catalog.lower(status) <> 'suspended'
        limit 1
      $f$;
      create function private.is_active_org_member(target_org uuid, target_user uuid default auth.uid()) returns boolean
      language sql stable security definer set search_path = '' as $f$
        select exists(
          select 1 from public.organization_members
          where organization_id=target_org and user_id=target_user
            and status='active'
        )
      $f$;

      grant execute on function private.normalized_org_role(text) to authenticated;
      grant execute on function private.org_member_role(uuid,uuid) to authenticated;
      grant execute on function private.org_member_number(uuid,uuid) to authenticated;
      grant execute on function private.is_active_org_member(uuid,uuid) to authenticated;

      create table public.propcontrol_records (
        organization_id uuid not null,
        entity_type text not null,
        entity_key text not null,
        assigned_member_id bigint,
        payload jsonb not null default '{}'::jsonb,
        created_by uuid not null default auth.uid(),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (organization_id,entity_type,entity_key)
      );
      create function public.protect_propcontrol_record_identity() returns trigger
      language plpgsql security invoker set search_path=''
      as $f$
      begin
        new.organization_id:=old.organization_id;
        new.entity_type:=old.entity_type;
        new.entity_key:=old.entity_key;
        new.created_by:=old.created_by;
        new.created_at:=old.created_at;
        new.updated_at:=now();
        return new;
      end
      $f$;
      create trigger protect_propcontrol_record_identity
        before update on public.propcontrol_records
        for each row execute function public.protect_propcontrol_record_identity();

      alter table public.propcontrol_records enable row level security;
      alter table public.organization_members enable row level security;
      grant select on public.organization_members to authenticated;
      grant select,insert,update,delete on public.propcontrol_records to authenticated;
      create policy members_select on public.organization_members for select to authenticated
        using (user_id=auth.uid() or private.is_active_org_member(organization_id));
      create policy records_select on public.propcontrol_records for select to authenticated using (
        private.is_active_org_member(organization_id) and
        (private.org_member_role(organization_id) in ('owner','admin') or assigned_member_id=private.org_member_number(organization_id)));
      create policy records_insert on public.propcontrol_records for insert to authenticated with check (
        private.is_active_org_member(organization_id) and created_by=auth.uid() and
        (private.org_member_role(organization_id) in ('owner','admin') or assigned_member_id=private.org_member_number(organization_id)));
      create policy records_update on public.propcontrol_records for update to authenticated using (
        private.is_active_org_member(organization_id) and
        (private.org_member_role(organization_id) in ('owner','admin') or assigned_member_id=private.org_member_number(organization_id))) with check (
        private.is_active_org_member(organization_id) and
        (private.org_member_role(organization_id) in ('owner','admin') or assigned_member_id=private.org_member_number(organization_id)));
      create policy records_delete on public.propcontrol_records for delete to authenticated using (
        private.is_active_org_member(organization_id) and
        (private.org_member_role(organization_id) in ('owner','admin') or assigned_member_id=private.org_member_number(organization_id)));
    `);

    psql(r21);
    psql(r22b);
    psql(r22c);
    psql(r22d);

    const legacyBefore = {
      authority: psql(`select pg_catalog.md5(pg_catalog.pg_get_functiondef('public.visit_transaction_authority_active()'::pg_catalog.regprocedure));`),
      cas: psql(`select pg_catalog.md5(pg_catalog.pg_get_functiondef('public.client_snapshot_cas(jsonb,boolean)'::pg_catalog.regprocedure));`),
      visit: psql(`select pg_catalog.md5(pg_catalog.pg_get_functiondef('public.commercial_visit_mutation(uuid,text,jsonb,boolean)'::pg_catalog.regprocedure));`),
    };

    psql(migration);

    const legacyAfter = {
      authority: psql(`select pg_catalog.md5(pg_catalog.pg_get_functiondef('public.visit_transaction_authority_active()'::pg_catalog.regprocedure));`),
      cas: psql(`select pg_catalog.md5(pg_catalog.pg_get_functiondef('public.client_snapshot_cas(jsonb,boolean)'::pg_catalog.regprocedure));`),
      visit: psql(`select pg_catalog.md5(pg_catalog.pg_get_functiondef('public.commercial_visit_mutation(uuid,text,jsonb,boolean)'::pg_catalog.regprocedure));`),
    };
    assert.deepEqual(legacyAfter, legacyBefore);
    assert.notEqual(psql(`select to_regprocedure('public.visit_transaction_authority_active()') is not null;`), 'f');
    assert.notEqual(psql(`select to_regprocedure('public.client_snapshot_cas(jsonb,boolean)') is not null;`), 'f');
    assert.notEqual(psql(`select to_regprocedure('public.commercial_visit_mutation(uuid,text,jsonb,boolean)') is not null;`), 'f');

    const v2Catalog = parseJson(psql(`select pg_catalog.jsonb_object_agg(p.proname, pg_catalog.jsonb_build_object(
        'securityDefiner', p.prosecdef,
        'volatility', p.provolatile,
        'config', p.proconfig
      ))
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in (
        'visit_transaction_authority_active_v2','client_snapshot_cas_v2','commercial_visit_mutation_v2'
      );`));
    assert.deepEqual(v2Catalog.visit_transaction_authority_active_v2, {
      securityDefiner: false, volatility: 's', config: ['search_path=""'],
    });
    assert.deepEqual(v2Catalog.client_snapshot_cas_v2, {
      securityDefiner: false, volatility: 'v', config: ['search_path=""'],
    });
    assert.deepEqual(v2Catalog.commercial_visit_mutation_v2, {
      securityDefiner: false, volatility: 'v', config: ['search_path=""'],
    });
    assert.equal(psql(`select has_function_privilege('authenticated','public.visit_transaction_authority_active_v2(uuid)','execute');`), 't');
    assert.equal(psql(`select has_function_privilege('authenticated','public.client_snapshot_cas_v2(uuid,jsonb,boolean)','execute');`), 't');
    assert.equal(psql(`select has_function_privilege('authenticated','public.commercial_visit_mutation_v2(uuid,uuid,text,jsonb,boolean)','execute');`), 't');
    assert.equal(psql(`select has_function_privilege('anon','public.visit_transaction_authority_active_v2(uuid)','execute');`), 'f');
    assert.equal(psql(`select has_function_privilege('anon','public.client_snapshot_cas_v2(uuid,jsonb,boolean)','execute');`), 'f');
    assert.equal(psql(`select has_function_privilege('anon','public.commercial_visit_mutation_v2(uuid,uuid,text,jsonb,boolean)','execute');`), 'f');
    assert.equal(psql(`select has_function_privilege('public','public.visit_transaction_authority_active_v2(uuid)','execute');`), 'f');
    assert.equal(psql(`select has_function_privilege('public','public.client_snapshot_cas_v2(uuid,jsonb,boolean)','execute');`), 'f');
    assert.equal(psql(`select has_function_privilege('public','public.commercial_visit_mutation_v2(uuid,uuid,text,jsonb,boolean)','execute');`), 'f');
    assert.equal(psql(`select has_function_privilege('service_role','public.visit_transaction_authority_active_v2(uuid)','execute');`), 'f');
    assert.equal(psql(`select has_function_privilege('service_role','public.client_snapshot_cas_v2(uuid,jsonb,boolean)','execute');`), 'f');
    assert.equal(psql(`select has_function_privilege('service_role','public.commercial_visit_mutation_v2(uuid,uuid,text,jsonb,boolean)','execute');`), 'f');


    psql(`
      insert into public.organizations values ('${orgA}','A'),('${orgB}','B'),('${orgC}','C');
      insert into public.organization_members values
        ('${orgA}','${multiOwner}',1,'owner','active'),
        ('${orgB}','${multiOwner}',1,'owner','active'),
        ('${orgA}','${singleOwner}',2,'owner','active'),
        ('${orgA}','${adminA}',5,'admin','active'),
        ('${orgA}','${invitedUser}',3,'admin','invited'),
        ('${orgA}','${suspendedUser}',4,'admin','suspended'),
        ('${orgA}','${unknownUser}',6,'admin','unknown'),
        ('${orgB}','${otherB}',9,'agent','active');
      insert into private.commercial_entity_authority(organization_id,entity_type,transaction_owned,activated_at,activated_by)
        values('${orgA}','visit',true,now(),'${multiOwner}'),('${orgB}','visit',true,now(),'${multiOwner}');
    `);

    // Authority V2: active-only y selección explícita aun con dos memberships activas.
    assert.equal(asUser(singleOwner, authorityV2(orgA)), 't');
    assert.equal(asUser(multiOwner, authorityV2(orgA)), 't');
    assert.equal(asUser(multiOwner, authorityV2(orgB)), 't');
    for (const actor of [noMember, invitedUser, suspendedUser, unknownUser]) {
      const error = asUserError(actor, authorityV2(orgA));
      assert.match(error, /42501/);
      assert.match(error, /PERMISSION_DENIED/);
    }
    const manipulatedOrg = asUserError(singleOwner, authorityV2(orgC));
    assert.match(manipulatedOrg, /42501/);
    assert.match(manipulatedOrg, /PERMISSION_DENIED/);

    const insertClient = (org: string, id: number, assignedMemberId: number, createdBy: string, overrides: Record<string, unknown> = {}) => psql(`
      insert into public.propcontrol_records(organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,revision)
      values('${org}','client','${key(org,id)}',${assignedMemberId},${jsonSql(readyClient(id, assignedMemberId, overrides))},'${createdBy}',0);
    `);
    const insertProperty = (org: string, id: number, assignedMemberId: number, createdBy: string) => psql(`
      insert into public.propcontrol_records(organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,revision)
      values('${org}','property','${key(org,id)}',${assignedMemberId},${jsonSql({
        id, title: `Propiedad ${id}`, address: 'Centro', assignedToId: assignedMemberId, revision: 0,
      })},'${createdBy}',0);
    `);

    for (const id of [1,2,3,4,10,11,12,13,14]) insertClient(orgA, id, 1, multiOwner);
    insertClient(orgB, 200, 1, multiOwner);
    insertProperty(orgA, 1, 1, multiOwner);
    insertProperty(orgB, 200, 1, multiOwner);

    const clientState = (org: string, id: number): Record<string, any> => parseJson(psql(`select pg_catalog.jsonb_build_object(
      'revision',revision,'assignedMemberId',assigned_member_id,'payload',payload
    ) from public.propcontrol_records where organization_id='${org}' and entity_type='client' and entity_key='${key(org,id)}';`));

    // CAS V2: tenant A funciona, B bajo tenant A no se descubre, revisions y assignment quedan preservados.
    const casOk = parseJson(asUser(multiOwner, casV2(orgA, {
      action: 'update', client: { legacyId: 1 }, expectedRevision: 0,
      payload: readyClient(1, 999, { notes: 'cas-v2' }), assignedMemberId: 5,
    })));
    assert.equal(casOk.organizationId, orgA);
    assert.equal(casOk.client.revision, 1);
    assert.equal(casOk.client.assignedToId, 5);

    const crossClient = asUserError(multiOwner, casV2(orgA, {
      action: 'update', client: { legacyId: 200 }, expectedRevision: 0,
      payload: readyClient(200),
    }));
    assert.match(crossClient, /P0002/);
    assert.match(crossClient, /NOT_FOUND/);

    for (const actor of [invitedUser, suspendedUser, unknownUser]) {
      const denied = asUserError(actor, casV2(orgA, {
        action: 'update', client: { legacyId: 2 }, expectedRevision: 0,
        payload: readyClient(2),
      }));
      assert.match(denied, /42501/);
      assert.match(denied, /PERMISSION_DENIED/);
    }
    assert.match(asUserError(singleOwner, casV2(orgB, {
      action: 'update', client: { legacyId: 200 }, expectedRevision: 0,
      payload: readyClient(200),
    })), /PERMISSION_DENIED/);


    assert.match(asUserError(multiOwner, casV2(orgA, {
      action: 'update', client: { legacyId: 2 }, expectedRevision: 7,
      payload: readyClient(2),
    })), /CONFLICT/);
    assert.match(asUserError(multiOwner, casV2(orgA, {
      action: 'update', client: { legacyId: 2 }, expectedRevision: 0,
      payload: readyClient(2), assignedMemberId: 9,
    })), /VALIDATION_ERROR/);
    assert.match(asUserError(multiOwner, casV2(orgA, {
      action: 'update', client: { legacyId: 2 }, expectedRevision: 0,
      payload: readyClient(2), assignedMemberId: 3,
    })), /VALIDATION_ERROR/);
    assert.match(asUserError(multiOwner, casV2(orgA, {
      action: 'update', client: { legacyId: 2 }, expectedRevision: 0,
      payload: readyClient(2), assignedMemberId: 4,
    })), /VALIDATION_ERROR/);

    const rollbackCasBefore = clientState(orgA, 3);
    assert.match(asUserError(multiOwner, casV2(orgA, {
      action: 'update', client: { legacyId: 3 }, expectedRevision: 0,
      payload: readyClient(3, 1, { notes: 'rollback' }), assignedMemberId: 5,
    }, true)), /INTERNAL_ERROR/);
    assert.deepEqual(clientState(orgA, 3), rollbackCasBefore);

    const casDeleted = parseJson(asUser(multiOwner, casV2(orgA, {
      action: 'delete', client: { legacyId: 4 }, expectedRevision: 0,
    })));
    assert.equal(casDeleted.organizationId, orgA);
    assert.equal(casDeleted.action, 'delete');
    assert.equal(psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='client' and entity_key='${key(orgA,4)}';`), '0');

    // Visit V2: create/resolve atómicos dentro del tenant explícito.
    const createOp = randomUUID();
    const createIntent = createRequest(10, 1);
    const created = parseJson(asUser(multiOwner, visitV2(orgA, createOp, 'VISIT_CREATE', createIntent)));
    assert.equal(created.organizationId, orgA);
    assert.equal(created.replayed, false);
    assert.equal(created.client.revision, 1);
    assert.equal(created.visit.revision, 0);
    assert.equal(created.activity.transactionOwner, 'visit');
    assert.equal(psql(`select organization_id::text from public.propcontrol_records where uid='${created.activity.uid}'::uuid;`), orgA);

    const resolved = parseJson(asUser(multiOwner, visitV2(orgA, randomUUID(), 'VISIT_RESOLVE', {
      client: { legacyId: 10 }, expectedClientRevision: 1,
      visitUid: created.visit.uid, expectedVisitRevision: 0,
      status: 'Realizada', interest: 'Alto', nextAction: 'Enviar propuesta', nextFollowUp: '2035-01-03',
    })));
    assert.equal(resolved.organizationId, orgA);
    assert.equal(resolved.visit.revision, 1);
    assert.equal(resolved.client.revision, 2);
    assert.equal(resolved.activity.transactionOwner, 'visit');

    assert.match(asUserError(multiOwner, visitV2(orgA, randomUUID(), 'VISIT_CREATE', createRequest(200, 1))), /NOT_FOUND/);
    assert.match(asUserError(multiOwner, visitV2(orgA, randomUUID(), 'VISIT_CREATE', createRequest(11, 200))), /NOT_FOUND/);
    for (const actor of [invitedUser, suspendedUser, unknownUser]) {
      const denied = asUserError(actor, visitV2(orgA, randomUUID(), 'VISIT_CREATE', createRequest(11, 1)));
      assert.match(denied, /42501/);
      assert.match(denied, /PERMISSION_DENIED/);
    }


    const bCreated = parseJson(asUser(multiOwner, visitV2(orgB, randomUUID(), 'VISIT_CREATE', createRequest(200, 200, 0, '2035-01-04'))));
    assert.equal(bCreated.organizationId, orgB);
    assert.match(asUserError(multiOwner, visitV2(orgA, randomUUID(), 'VISIT_RESOLVE', {
      client: { legacyId: 12 }, expectedClientRevision: 0,
      visitUid: bCreated.visit.uid, expectedVisitRevision: 0,
      status: 'Cancelada', nextAction: 'Reprogramar', nextFollowUp: '2035-01-05',
    })), /NOT_FOUND/);

    const rollbackBefore = {
      client: clientState(orgA, 13),
      visits: psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='visit';`),
      activities: psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='activity';`),
      operations: psql(`select count(*) from private.commercial_operations where organization_id='${orgA}';`),
    };
    assert.match(asUserError(multiOwner, visitV2(orgA, randomUUID(), 'VISIT_CREATE', createRequest(13, 1, 0, '2035-01-06'), true)), /INTERNAL_ERROR/);
    assert.deepEqual({
      client: clientState(orgA, 13),
      visits: psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='visit';`),
      activities: psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='activity';`),
      operations: psql(`select count(*) from private.commercial_operations where organization_id='${orgA}';`),
    }, rollbackBefore);

    // Coexistencia real: operación legacy primero, replay V2 después con mismo hash y sin duplicar efectos.
    const coexistOp = randomUUID();
    const coexistIntent = createRequest(14, 1, 0, '2035-01-07', '11:00');
    const legacyCreated = parseJson(asUser(multiOwner, visitLegacy(coexistOp, 'VISIT_CREATE', coexistIntent)));
    assert.equal(legacyCreated.replayed, false);
    const coexistReplay = parseJson(asUser(multiOwner, visitV2(orgA, coexistOp, 'VISIT_CREATE', coexistIntent)));
    assert.equal(coexistReplay.replayed, true);
    assert.equal(coexistReplay.errorCode, 'IDEMPOTENCY_REPLAY');
    assert.equal(coexistReplay.visit.uid, legacyCreated.visit.uid);
    assert.equal(psql(`select count(*) from private.commercial_operations where organization_id='${orgA}' and operation_id='${coexistOp}';`), '1');
    assert.equal(psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='activity' and payload->>'operationId'='${coexistOp}';`), '1');

    // Schema/drift 23-25: absent fue creado arriba; rerun correcto es estable; drift reconciliable vuelve al contrato.
    const definitionsBeforeRerun = psql(`select pg_catalog.jsonb_object_agg(p.proname, pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)))
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('visit_transaction_authority_active_v2','client_snapshot_cas_v2','commercial_visit_mutation_v2');`);
    psql(migration);
    const definitionsAfterRerun = psql(`select pg_catalog.jsonb_object_agg(p.proname, pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)))
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('visit_transaction_authority_active_v2','client_snapshot_cas_v2','commercial_visit_mutation_v2');`);
    assert.equal(definitionsAfterRerun, definitionsBeforeRerun);

    psql(`
      create or replace function public.visit_transaction_authority_active_v2(p_organization_id uuid)
      returns boolean language sql stable security definer set search_path=public
      as $drift$ select false $drift$;
      grant execute on function public.visit_transaction_authority_active_v2(uuid) to service_role;
    `);
    assert.equal(psql(`select p.prosecdef from pg_catalog.pg_proc p where p.oid='public.visit_transaction_authority_active_v2(uuid)'::pg_catalog.regprocedure;`), 't');
    psql(migration);
    assert.equal(psql(`select p.prosecdef from pg_catalog.pg_proc p where p.oid='public.visit_transaction_authority_active_v2(uuid)'::pg_catalog.regprocedure;`), 'f');
    assert.equal(psql(`select p.proconfig = ARRAY['search_path=""']::text[] from pg_catalog.pg_proc p where p.oid='public.visit_transaction_authority_active_v2(uuid)'::pg_catalog.regprocedure;`), 't');
    assert.equal(psql(`select has_function_privilege('service_role','public.visit_transaction_authority_active_v2(uuid)','execute');`), 'f');
    assert.equal(asUser(multiOwner, authorityV2(orgA)), 't');

    // 26. dependencia crítica faltante: ABORT transaccional antes de reconciliar cualquier V2.
    psql(`
      create or replace function public.visit_transaction_authority_active_v2(p_organization_id uuid)
      returns boolean language sql stable security definer set search_path=public
      as $drift$ select false $drift$;
      alter function private.visit_qualification_missing(jsonb) rename to visit_qualification_missing_missing;
    `);
    const missingDependency = rawPsql(migration);
    assert.notEqual(missingDependency.status, 0);
    assert.match(`${missingDependency.stderr}\n${missingDependency.stdout}`, /falta dependencia private\.visit_qualification_missing\(jsonb\)/);
    assert.equal(psql(`select p.prosecdef from pg_catalog.pg_proc p where p.oid='public.visit_transaction_authority_active_v2(uuid)'::pg_catalog.regprocedure;`), 't');

  } finally {
    docker(['rm', '-f', containerName]);
  }
});
