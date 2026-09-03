import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Client } from '../models.js';
import type { ClientSnapshotCasIntent } from '../visit-transaction-contract.js';

const r21Path = 'supabase/migrations/20260827170000_p1_1_a7_r2_1_transaction_foundation.sql';
const r22bPath = 'supabase/migrations/20260831120000_p1_1_a7_r2_2_visit_transaction_backend.sql';
const r22cPath = 'supabase/migrations/20260901223000_p1_1_a7_r2_2c_visit_authority_capability.sql';
const migrationPath = 'supabase/migrations/20260903150000_p1_1_a7_r2_2d_client_reassignment_cas.sql';
const r21 = readFileSync(r21Path, 'utf8');
const r22b = readFileSync(r22bPath, 'utf8');
const r22c = readFileSync(r22cPath, 'utf8');
const migration = readFileSync(migrationPath, 'utf8');
const contract = readFileSync('src/visit-transaction-contract.ts', 'utf8');
const cloudAdapter = readFileSync('src/visit-transaction-cloud.ts', 'utf8');

function gitBlobSha(content: string): string {
  const prefix = `blob ${Buffer.byteLength(content, 'utf8')}\0`;
  return createHash('sha1').update(prefix).update(content).digest('hex');
}

const clientPayload = (id: number, assignedToId: number, overrides: Partial<Client> = {}): Client => ({
  id,
  name: `Cliente ${id}`,
  phone: '111',
  interest: 'Departamento',
  status: 'Lead',
  temperature: 'Tibio',
  pipeline: 'Calificado',
  assignedToId,
  revision: 0,
  ...overrides,
});

test('R2.2D es aditiva, reemplaza sólo client_snapshot_cas y conserva R2.2B/R2.2C byte a byte', () => {
  assert.equal(gitBlobSha(r22b), 'd7f2eeff0c6703dac83b768d55922bfd3eb94aaf');
  assert.equal(gitBlobSha(r22c), '9ee2f80ea6302a7653fc1706038064591e67f279');
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /create or replace function public\.client_snapshot_cas\(\s*p_request jsonb,\s*p_force_rollback boolean default false\s*\)/i);
  assert.match(migration, /security invoker[\s\S]*set search_path = ''/i);
  assert.doesNotMatch(migration, /commercial_visit_mutation|visit_transaction_authority_active|create\s+policy|alter\s+policy|drop\s+policy/i);
  assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+private\.commercial_entity_authority/i);
});

test('R2.2D contrato TS representa reassignment opcional sólo en update y adapter lo envía por CAS', () => {
  const normal: ClientSnapshotCasIntent = {
    action: 'update', client: { legacyId: 1 }, expectedRevision: 0, payload: clientPayload(1, 1),
  };
  const reassign: ClientSnapshotCasIntent = {
    action: 'update', client: { legacyId: 1 }, expectedRevision: 0,
    payload: clientPayload(1, 2), assignedMemberId: 2,
  };
  assert.equal(normal.action, 'update');
  assert.equal(reassign.assignedMemberId, 2);
  assert.match(contract, /action: 'update'; payload: Client; assignedMemberId\?: number/);
  assert.doesNotMatch(contract, /assignedMemberId\?:\s*number\s*\|\s*null/);

  const reconcileStart = cloudAdapter.indexOf('async function reconcileClientsWithCas');
  const pushStart = cloudAdapter.indexOf('export async function pushCloudDataWithVisitAuthority', reconcileStart);
  assert.ok(reconcileStart >= 0 && pushStart > reconcileStart);
  const reconcile = cloudAdapter.slice(reconcileStart, pushStart);
  assert.doesNotMatch(reconcile, /La reasignación de Client requiere una operación autoritativa específica/i);
  assert.match(reconcile, /current\.assigned_member_id !== nextRow\.assigned_member_id[\s\S]*targetMemberId[\s\S]*assignedMemberId = targetMemberId/i);
  assert.match(reconcile, /clientSnapshotCas\([\s\S]*assignedMemberId === undefined \? \{\} : \{ assignedMemberId \}/i);
  assert.doesNotMatch(reconcile, /upsertRecords|method:\s*['"](?:PATCH|PUT)['"]/i);
});

test('R2.2D migration fija permisos, tenant target, canonicalización, CAS y rollback', () => {
  const conflict = migration.indexOf('current_record.revision <> expected_revision');
  const reassignment = migration.indexOf('current_record.assigned_member_id is distinct from requested_assigned_member_id');
  assert.ok(conflict >= 0 && reassignment > conflict, 'CAS debe ejecutarse antes de aplicar una reasignación');
  assert.match(migration, /from public\.organization_members as member[\s\S]*member\.organization_id = target_org[\s\S]*member\.user_id = current_user_id[\s\S]*status\) = 'active'/i);
  assert.match(migration, /actor_role not in \('owner', 'admin'\)[\s\S]*PERMISSION_DENIED/i);
  assert.match(migration, /target_member\.organization_id = target_org[\s\S]*target_member\.member_id = requested_assigned_member_id[\s\S]*status\) = 'active'/i);
  assert.match(migration, /- 'assignedToId'[\s\S]*jsonb_build_object\('assignedToId', effective_assigned_member_id\)/i);
  assert.match(migration, /set payload = next_payload,[\s\S]*revision = current_record\.revision \+ 1,[\s\S]*assigned_member_id = effective_assigned_member_id/i);
  assert.match(migration, /if p_force_rollback then[\s\S]*INTERNAL_ERROR/i);
});

test('R2.2D ejecuta reassignment CAS, permisos, tenant isolation y rollback en PostgreSQL 17', { timeout: 240_000 }, async () => {
  const { spawnSync } = await import('node:child_process');
  const containerName = `r22d-client-${randomUUID().slice(0, 8)}`;
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const admin = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const agent = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const suspended = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const invited = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const otherOwner = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';
  const scopedKey = (organizationId: string, id: number): string => `${organizationId}:${id}`;

  const docker = (args: string[]) => spawnSync('docker', args, {
    encoding: 'utf8', maxBuffer: 30 * 1024 * 1024,
  });
  const rawPsql = (sql: string) => spawnSync(
    'docker',
    ['exec', '-i', containerName, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
    { encoding: 'utf8', input: sql, maxBuffer: 30 * 1024 * 1024 },
  );
  const psql = (sql: string): string => {
    const result = rawPsql(sql);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  const asUser = (userId: string, sql: string): string => psql(`
    set role authenticated;
    select pg_catalog.set_config('request.jwt.claim.sub', '${userId}', false);
    ${sql}
  `).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? '';
  const asUserError = (userId: string, sql: string): string => {
    const result = rawPsql(`
      set role authenticated;
      select pg_catalog.set_config('request.jwt.claim.sub', '${userId}', false);
      ${sql}
    `);
    assert.notEqual(result.status, 0, 'La sentencia debía fallar.');
    return `${result.stderr}\n${result.stdout}`;
  };
  const jsonSql = (value: unknown): string => `$json$${JSON.stringify(value)}$json$::jsonb`;
  const parseJson = (value: string): Record<string, any> => JSON.parse(value) as Record<string, any>;
  const state = (id: number): Record<string, any> => parseJson(psql(`
    select pg_catalog.jsonb_build_object(
      'assignedMemberId', assigned_member_id,
      'payloadAssignedToId', payload -> 'assignedToId',
      'rowRevision', revision,
      'payloadRevision', payload -> 'revision',
      'notes', payload -> 'notes'
    )::text
    from public.propcontrol_records
    where organization_id='${orgA}' and entity_type='client' and entity_key='${scopedKey(orgA, id)}';
  `));

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
    assert.equal(healthy, true, docker(['logs', '--tail', '120', containerName]).stdout);
    assert.match(psql('show server_version;'), /^17(?:\.|$)/);

    psql(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create schema private;
      grant usage on schema public, private, auth to authenticated;
      create function auth.uid() returns uuid language sql stable security invoker set search_path = ''
      as $f$ select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
      create table public.organizations (id uuid primary key, name text not null);
      create table public.organization_members (
        organization_id uuid not null, user_id uuid not null, member_id bigint not null,
        role text not null, status text not null,
        primary key (organization_id, user_id), unique (organization_id, member_id)
      );
      create function private.normalized_org_role(value text) returns text language sql immutable security definer set search_path = ''
      as $f$ select case when pg_catalog.lower(coalesce(value,'')) in ('owner','dueño','dueno') then 'owner'
        when pg_catalog.lower(coalesce(value,'')) in ('admin','administrator','administrador') then 'admin' else 'agent' end $f$;
      create function private.org_member_role(target_org uuid, target_user uuid default auth.uid()) returns text
      language sql stable security definer set search_path = '' as $f$
        select private.normalized_org_role(role) from public.organization_members
        where organization_id=target_org and user_id=target_user and pg_catalog.lower(status) <> 'suspended' limit 1 $f$;
      create function private.org_member_number(target_org uuid, target_user uuid default auth.uid()) returns bigint
      language sql stable security definer set search_path = '' as $f$
        select member_id from public.organization_members where organization_id=target_org and user_id=target_user
          and pg_catalog.lower(status) <> 'suspended' limit 1 $f$;
      create function private.is_active_org_member(target_org uuid, target_user uuid default auth.uid()) returns boolean
      language sql stable security definer set search_path = '' as $f$
        select exists(select 1 from public.organization_members where organization_id=target_org and user_id=target_user
          and pg_catalog.lower(status)='active') $f$;
      grant execute on function private.normalized_org_role(text) to authenticated;
      grant execute on function private.org_member_role(uuid,uuid) to authenticated;
      grant execute on function private.org_member_number(uuid,uuid) to authenticated;
      grant execute on function private.is_active_org_member(uuid,uuid) to authenticated;
      create table public.propcontrol_records (
        organization_id uuid not null, entity_type text not null,
        entity_key text not null, assigned_member_id bigint, payload jsonb not null default '{}'::jsonb,
        created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(), primary key (organization_id,entity_type,entity_key)
      );
      create function public.protect_propcontrol_record_identity() returns trigger language plpgsql security invoker set search_path=''
      as $f$ begin new.organization_id:=old.organization_id; new.entity_type:=old.entity_type; new.entity_key:=old.entity_key;
        new.created_by:=old.created_by; new.created_at:=old.created_at; new.updated_at:=now(); return new; end $f$;
      create trigger protect_propcontrol_record_identity before update on public.propcontrol_records
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
    psql(migration);

    psql(`
      insert into public.organizations values ('${orgA}','A'),('${orgB}','B');
      insert into public.organization_members values
        ('${orgA}','${owner}',1,'owner','active'),
        ('${orgA}','${admin}',2,'admin','active'),
        ('${orgA}','${agent}',3,'agent','active'),
        ('${orgA}','${suspended}',4,'agent','suspended'),
        ('${orgA}','${invited}',5,'agent','invited'),
        ('${orgB}','${otherOwner}',9,'owner','active');
      insert into private.commercial_entity_authority(organization_id,entity_type,transaction_owned)
        values('${orgA}','visit',true),('${orgB}','visit',true);
    `);

    for (let id = 1; id <= 9; id += 1) {
      const assignedMemberId = id === 3 ? 3 : 1;
      psql(`insert into public.propcontrol_records(
          organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,revision
        ) values(
          '${orgA}','client','${scopedKey(orgA, id)}',${assignedMemberId},
          ${jsonSql(clientPayload(id, assignedMemberId))},'${owner}',0
        );`);
    }

    const ownerResult = parseJson(asUser(owner, `select public.client_snapshot_cas(${jsonSql({
      action: 'update', client: { legacyId: 1 }, expectedRevision: 0,
      payload: clientPayload(1, 999, { notes: 'owner reassignment' }), assignedMemberId: 2,
    })}, false);`));
    assert.equal(ownerResult.client.assignedToId, 2);
    assert.equal(ownerResult.client.revision, 1);
    assert.deepEqual(state(1), {
      assignedMemberId: 2, payloadAssignedToId: 2, rowRevision: 1, payloadRevision: 1, notes: 'owner reassignment',
    });

    const adminResult = parseJson(asUser(admin, `select public.client_snapshot_cas(${jsonSql({
      action: 'update', client: { legacyId: 9 }, expectedRevision: 0,
      payload: clientPayload(9, 777, { notes: 'admin reassignment' }), assignedMemberId: 3,
    })}, false);`));
    assert.equal(adminResult.client.assignedToId, 3);
    assert.deepEqual(state(9), {
      assignedMemberId: 3, payloadAssignedToId: 3, rowRevision: 1, payloadRevision: 1, notes: 'admin reassignment',
    });

    const conflictBefore = state(2);
    assert.match(asUserError(owner, `select public.client_snapshot_cas(${jsonSql({
      action: 'update', client: { legacyId: 2 }, expectedRevision: 7,
      payload: clientPayload(2, 2, { notes: 'stale' }), assignedMemberId: 2,
    })}, false);`), /CONFLICT/);
    assert.deepEqual(state(2), conflictBefore);

    const agentBefore = state(3);
    assert.match(asUserError(agent, `select public.client_snapshot_cas(${jsonSql({
      action: 'update', client: { legacyId: 3 }, expectedRevision: 0,
      payload: clientPayload(3, 2, { notes: 'agent forbidden' }), assignedMemberId: 2,
    })}, false);`), /PERMISSION_DENIED/);
    assert.deepEqual(state(3), agentBefore);

    const crossTenantBefore = state(4);
    assert.match(asUserError(owner, `select public.client_snapshot_cas(${jsonSql({
      action: 'update', client: { legacyId: 4 }, expectedRevision: 0,
      payload: clientPayload(4, 9), assignedMemberId: 9,
    })}, false);`), /VALIDATION_ERROR/);
    assert.deepEqual(state(4), crossTenantBefore);

    const suspendedBefore = state(5);
    assert.match(asUserError(owner, `select public.client_snapshot_cas(${jsonSql({
      action: 'update', client: { legacyId: 5 }, expectedRevision: 0,
      payload: clientPayload(5, 4), assignedMemberId: 4,
    })}, false);`), /VALIDATION_ERROR/);
    assert.deepEqual(state(5), suspendedBefore);

    const invitedBefore = state(6);
    assert.match(asUserError(owner, `select public.client_snapshot_cas(${jsonSql({
      action: 'update', client: { legacyId: 6 }, expectedRevision: 0,
      payload: clientPayload(6, 5), assignedMemberId: 5,
    })}, false);`), /VALIDATION_ERROR/);
    assert.deepEqual(state(6), invitedBefore);

    const missingBefore = state(7);
    assert.match(asUserError(owner, `select public.client_snapshot_cas(${jsonSql({
      action: 'update', client: { legacyId: 7 }, expectedRevision: 0,
      payload: clientPayload(7, 999), assignedMemberId: 999,
    })}, false);`), /VALIDATION_ERROR/);
    assert.deepEqual(state(7), missingBefore);

    const normal = parseJson(asUser(owner, `select public.client_snapshot_cas(${jsonSql({
      action: 'update', client: { legacyId: 8 }, expectedRevision: 0,
      payload: clientPayload(8, 3, { notes: 'normal update' }),
    })}, false);`));
    assert.equal(normal.client.assignedToId, 1);
    assert.deepEqual(state(8), {
      assignedMemberId: 1, payloadAssignedToId: 1, rowRevision: 1, payloadRevision: 1, notes: 'normal update',
    });

    const rollbackBefore = state(2);
    assert.match(asUserError(owner, `select public.client_snapshot_cas(${jsonSql({
      action: 'update', client: { legacyId: 2 }, expectedRevision: 0,
      payload: clientPayload(2, 2, { notes: 'must rollback' }), assignedMemberId: 2,
    })}, true);`), /INTERNAL_ERROR/);
    assert.deepEqual(state(2), rollbackBefore);
  } finally {
    docker(['rm', '-f', containerName]);
  }
});
