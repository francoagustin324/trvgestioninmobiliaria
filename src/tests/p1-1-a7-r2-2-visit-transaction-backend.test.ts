import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { organizationScopedEntityKey } from '../cloud-records.js';
import { visitReadiness } from '../lead-qualification.js';
import type { Client } from '../models.js';
import type {
  ClientSnapshotCasIntent,
  VisitCreateIntent,
  VisitMutationResult,
  VisitResolveIntent,
} from '../visit-transaction-contract.js';

const r21Path = 'supabase/migrations/20260827170000_p1_1_a7_r2_1_transaction_foundation.sql';
const migrationPath = 'supabase/migrations/20260831120000_p1_1_a7_r2_2_visit_transaction_backend.sql';
const r21 = readFileSync(r21Path, 'utf8');
const migration = readFileSync(migrationPath, 'utf8');

const readyClient = (overrides: Partial<Client> = {}): Client => ({
  id: 1,
  name: 'Cliente listo',
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
  revision: 0,
  ...overrides,
});

function sqlContractMissing(client: Client): string[] {
  const normalized = (value: unknown): string => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const missing: string[] = [];
  if (!client.budget?.trim()) missing.push('presupuesto');
  if (!client.currency?.trim()) missing.push('moneda');
  if (!client.paymentMethod?.trim()) missing.push('forma de pago');
  if (!client.zones?.trim()) missing.push('zona/barrios');
  if (!['vivir', 'invertir', 'otra'].includes(normalized(client.purpose))) missing.push('finalidad');
  if (!client.purchaseTimeframe?.trim() && !client.urgency?.trim()) missing.push('plazo / urgencia');
  const payment = normalized(client.paymentMethod);
  const canMove = normalized(client.canMoveForward);
  const credit = normalized(client.creditPossible);
  const creditRequired = payment.includes('credito hipotecario') || canMove === 'depende del credito';
  const creditReady = ['aprobado', 'preaprobado'].includes(credit);
  if (creditRequired && !creditReady) missing.push('situación del crédito');
  if (!canMove || ['no confirmado', 'no', 'depende de vender', 'todavia no'].includes(canMove)
    || (canMove === 'depende del credito' && !creditReady)) missing.push('capacidad de avance');
  if (normalized(client.knowsArea) !== 'si') missing.push('aceptación de la zona');
  return missing;
}

test('R2.2B contratos separan intent frontend del agregado autoritativo', () => {
  const create: VisitCreateIntent = {
    operationId: randomUUID(), operationType: 'VISIT_CREATE',
    client: { legacyId: 1 }, property: { uid: randomUUID() },
    expectedClientRevision: 0, localDate: '2035-01-02', localTime: '10:30',
  };
  const resolve: VisitResolveIntent = {
    operationId: randomUUID(), operationType: 'VISIT_RESOLVE',
    client: { uid: randomUUID() }, expectedClientRevision: 1,
    visitUid: randomUUID(), expectedVisitRevision: 0,
    status: 'Realizada', interest: 'Alto', nextAction: 'Enviar propuesta', nextFollowUp: '2035-01-03',
  };
  const cas: ClientSnapshotCasIntent = {
    action: 'update', client: { legacyId: 1 }, expectedRevision: 2, payload: readyClient(),
  };
  assert.equal(create.operationType, 'VISIT_CREATE');
  assert.equal(resolve.operationType, 'VISIT_RESOLVE');
  assert.equal(cas.action, 'update');
  const contract = readFileSync('src/visit-transaction-contract.ts', 'utf8');
  assert.doesNotMatch(contract, /organizationId:\s*string;[\s\S]*interface VisitCreateIntent/);
  assert.match(contract, /Full server-authoritative aggregate/i);
  assert.match(contract, /client: Client[\s\S]*visit: SyncedVisit[\s\S]*activity: TransactionalVisitActivity/);
  void ({} as VisitMutationResult);
});

test('R2.2B crea una migration nueva y conserva R2.1 byte a byte', () => {
  assert.equal(createHash('sha256').update(r21).digest('hex'), '4a443a0a5a1c8a065834f0cf9b019aa92547054e6f6613b283fa3658dccbbaf4');
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/);
  assert.doesNotMatch(migration, /pg_catalog\.extract\s*\(/i);
  assert.doesNotMatch(migration, /offer|counteroffer|reservation/i);
  assert.doesNotMatch(migration, /alter\s+policy|drop\s+policy\s+propcontrol_records|create\s+policy\s+propcontrol_records/i);
});

test('R2.2B instala autoridad explícita OFF y fences server-side para Visit, Client y Activity', () => {
  assert.match(migration, /create table private\.commercial_entity_authority/i);
  assert.match(migration, /transaction_owned boolean not null default false/i);
  assert.doesNotMatch(migration, /insert into private\.commercial_entity_authority/i);
  assert.match(migration, /create trigger guard_transaction_owned_records/i);
  assert.match(migration, /old_type = 'visit' or new_type = 'visit'[\s\S]*TRANSACTION_AUTHORITY_REQUIRED/i);
  assert.match(migration, /old_type = 'client' or new_type = 'client'[\s\S]*tg_op in \('UPDATE', 'DELETE'\)[\s\S]*CLIENT_CAS_REQUIRED/i);
  assert.match(migration, /old_payload ->> 'transactionOwner' = 'visit'[\s\S]*new_payload ->> 'transactionOwner' = 'visit'/i);
});

test('R2.2B usa exactamente la entity_key canónica del snapshot writer', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const uid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.equal(organizationScopedEntityKey(org, 17), `${org}:17`);
  assert.equal(organizationScopedEntityKey(org, uid), `${org}:${uid}`);
  assert.match(migration, /target_org::text \|\| ':' \|\| visit_uid::text/i);
  assert.match(migration, /target_org::text \|\| ':' \|\| activity_uid::text/i);
  assert.match(migration, /candidate\.organization_id::text \|\| ':' \|\| requested_legacy_id::text/i);
  assert.doesNotMatch(migration, /target_org, 'visit', visit_uid::text/i);
  assert.doesNotMatch(migration, /target_org, 'activity', activity_uid::text/i);
});

test('R2.2B Client snapshot CAS es el único bypass legítimo para update/delete stale', () => {
  const cas = migration.indexOf('create function public.client_snapshot_cas');
  const visit = migration.indexOf('create function public.commercial_visit_mutation');
  assert.ok(cas >= 0 && visit > cas);
  const body = migration.slice(cas, visit);
  assert.match(body, /for update/i);
  assert.match(body, /current_record\.revision <> expected_revision/i);
  assert.match(body, /CLIENT_CAS_REQUIRED|client_snapshot_cas/i);
  assert.match(body, /revision = current_record\.revision \+ 1/i);
  assert.match(body, /delete from public\.propcontrol_records/i);
  assert.match(body, /if p_force_rollback then/i);
  assert.doesNotMatch(body, /security definer|service_role/i);
});

test('R2.2B RPC autentica, deriva tenant/membership y no acepta organizationId', () => {
  const signature = migration.match(/create function public\.commercial_visit_mutation\(([\s\S]*?)\)\s*returns jsonb/i)?.[1] ?? '';
  assert.doesNotMatch(signature, /organization/i);
  assert.match(migration, /current_user_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /from public\.organization_members as member/i);
  assert.match(migration, /member\.organization_id = target_org/i);
  assert.match(migration, /visit_authority_active\(target_org\)/i);
  assert.match(migration, /candidate_orgs/i);
});

test('R2.2B idempotencia propia ocurre antes de CAS y colisión no lee payload ajeno', () => {
  const replay = migration.indexOf('select operation.* into existing_operation');
  const visitCas = migration.indexOf('select record.* into visit_record');
  const clientCas = migration.indexOf('select record.* into client_record');
  const allocator = migration.indexOf("next_visit_id := private.next_commercial_legacy_id(target_org, 'visit')");
  assert.ok(replay >= 0 && visitCas > replay && clientCas > replay && allocator > replay);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /request_hash <> computed_hash/i);
  assert.match(migration, /'errorCode', 'IDEMPOTENCY_REPLAY'/i);
  assert.match(migration, /on conflict \(organization_id, operation_id\) do nothing/i);
  assert.match(migration, /if not inserted then[\s\S]*message = 'CONFLICT'/i);
});

test('R2.2B VISIT_CREATE conserva reglas, dual refs y agregado atómico', () => {
  for (const token of [
    "message = 'QUALIFICATION_REQUIRED'", "message = 'PAST_SCHEDULE'",
    "message = 'DUPLICATE_VISIT'", "'status', 'Coordinada'",
    "'pipeline', 'Visita coordinada'", "'nextAction'", "'nextFollowUp'",
    "'clientUid'", "'propertyUid'", "'operationId'",
  ]) assert.ok(migration.includes(token), `falta ${token}`);
  assert.match(migration, /visit_uid := pg_catalog\.gen_random_uuid\(\)/i);
  assert.match(migration, /next_visit_id := private\.next_commercial_legacy_id\(target_org, 'visit'\)/i);
  assert.match(migration, /next_activity_id := private\.next_commercial_legacy_id\(target_org, 'activity'\)/i);
  const operationInsert = migration.lastIndexOf('insert into private.commercial_operations');
  assert.ok(migration.indexOf("set payload = client_payload") < operationInsert);
  assert.ok(migration.indexOf("target_org, 'visit'") < operationInsert);
  assert.ok(migration.indexOf("target_org, 'activity'") < operationInsert);
});

test('R2.2B VISIT_RESOLVE preserva CAS, estados, interés y Client terminal inmutable', () => {
  assert.match(migration, /status_name not in \('Realizada', 'Cancelada', 'No asistió'\)/i);
  assert.match(migration, /status_name = 'Realizada'[\s\S]*interest_name is null[\s\S]*interest_name not in \('Alto', 'Medio', 'Bajo'\)/i);
  assert.match(migration, /if status_name <> 'Realizada' then interest_name := null/i);
  assert.match(migration, /visit_record\.revision <> expected_visit_revision/i);
  assert.match(migration, /client_record\.revision <> expected_client_revision/i);
  assert.match(migration, /if not terminal_client then[\s\S]*revision', client_record\.revision \+ 1/i);
  assert.match(migration, /else\s+client_payload := client_record\.payload/i);
  assert.match(migration, /visit_record\.payload ->> 'status' <> 'Coordinada'/i);
});

test('R2.2B Activity mantiene texto histórico, correlación y exactly-once transaccional', () => {
  for (const action of ['Visita coordinada', 'Visita realizada', 'Visita cancelada', 'Cliente no asistió']) {
    assert.ok(migration.includes(action));
  }
  assert.match(migration, /'entityType', 'Cliente'/i);
  assert.match(migration, /'visitUid', visit_uid, 'transactionOwner', 'visit'/i);
  assert.match(migration, /'uid', activity_uid, 'revision', 0, 'operationId', p_operation_id/i);
  assert.match(migration, /activity_uid := pg_catalog\.gen_random_uuid\(\)/i);
});

test('R2.2B matriz de qualification conserva paridad de decisión TS ↔ SQL', () => {
  const cases: Client[] = [
    readyClient(),
    readyClient({ budget: '' }), readyClient({ currency: '' }), readyClient({ paymentMethod: '' }),
    readyClient({ zones: '' }), readyClient({ purpose: 'Vacaciones' }),
    readyClient({ purchaseTimeframe: '', urgency: '' }), readyClient({ canMoveForward: 'No confirmado' }),
    readyClient({ paymentMethod: 'Crédito hipotecario', creditPossible: 'En trámite' }),
    readyClient({ paymentMethod: 'Crédito hipotecario', creditPossible: 'Preaprobado' }),
    readyClient({ canMoveForward: 'Depende del crédito', creditPossible: 'Aprobado' }),
    readyClient({ knowsArea: 'No' }),
    readyClient({ operation: undefined, propertyType: undefined, bedrooms: undefined }),
  ];
  for (const client of cases) {
    const tsReady = visitReadiness(client, []).missing.length === 0;
    const sqlReady = sqlContractMissing(client).length === 0;
    assert.equal(sqlReady, tsReady, JSON.stringify(client));
  }
  for (const field of ['budget', 'currency', 'paymentMethod', 'zones', 'purpose', 'purchaseTimeframe', 'urgency', 'canMoveForward', 'creditPossible', 'knowsArea']) {
    assert.match(migration, new RegExp(`client_payload ->> '${field}'`));
  }
});

test('R2.2B4 limita SECURITY DEFINER al allocator tenant-safe y mantiene la RPC INVOKER', () => {
  const helperStart = migration.indexOf('create function private.next_commercial_legacy_id');
  const helperEnd = migration.indexOf('create function private.guard_transaction_owned_records', helperStart);
  const helper = migration.slice(helperStart, helperEnd);
  const rpcStart = migration.indexOf('create function public.commercial_visit_mutation');
  const rpcEnd = migration.indexOf('revoke all on function private.visit_authority_active', rpcStart);
  const rpc = migration.slice(rpcStart, rpcEnd);

  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  assert.equal((migration.match(/security definer/gi) ?? []).length, 1);
  assert.match(helper, /returns bigint[\s\S]*language plpgsql[\s\S]*volatile[\s\S]*security definer[\s\S]*set search_path = ''/i);
  assert.match(helper, /current_user_id uuid := auth\.uid\(\)/i);
  assert.match(helper, /target_entity_type not in \('visit', 'activity'\)/i);
  assert.match(helper, /private\.is_active_org_member\(target_organization_id, current_user_id\)/i);
  assert.match(helper, /private\.visit_authority_active\(target_organization_id\)/i);
  assert.match(helper, /pg_advisory_xact_lock[\s\S]*target_organization_id::text[\s\S]*target_entity_type/i);
  assert.match(helper, /max\(\(record\.payload ->> 'id'\)::numeric\)[\s\S]*record\.organization_id = target_organization_id[\s\S]*record\.entity_type = target_entity_type/i);
  assert.match(helper, /maximum_safe_id constant numeric := 9007199254740991/i);
  assert.doesNotMatch(helper, /\bexecute\b|\b(?:insert|update|delete|alter|drop|truncate)\s+/i);
  assert.match(rpc, /security invoker/i);
  assert.doesNotMatch(rpc, /security definer/i);
  assert.ok((migration.match(/security invoker/gi) ?? []).length >= 6);
  assert.ok((migration.match(/set search_path = ''/gi) ?? []).length >= 7);
  assert.doesNotMatch(migration, /service_role/i);
  assert.doesNotMatch(migration, /create\s+sequence|create\s+unique\s+index|create\s+table\s+private\.[^;]*(?:counter|sequence)/i);
  assert.match(migration, /grant select on table private\.commercial_entity_authority to authenticated/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]*commercial_entity_authority/i);
  assert.match(migration, /revoke all on function private\.next_commercial_legacy_id\(uuid, text\) from public/i);
  assert.match(migration, /revoke all on function private\.next_commercial_legacy_id\(uuid, text\) from anon/i);
  assert.match(migration, /grant execute on function private\.next_commercial_legacy_id\(uuid, text\) to authenticated/i);
  assert.match(migration, /grant execute on function public\.commercial_visit_mutation[\s\S]*to authenticated/i);
  assert.match(migration, /revoke all on function public\.commercial_visit_mutation[\s\S]*from anon/i);
});

test('R2.2B no conecta todavía UI, snapshot writer ni dominios R2.3+', () => {
  for (const path of ['src/visit-workflow.ts', 'src/visit-workflow-ui.ts', 'src/cloud-api.ts', 'src/store.ts']) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /commercial_visit_mutation|client_snapshot_cas/);
  }
  assert.doesNotMatch(migration, /offer|counteroffer|reservation|won|lost|whatsapp/i);
});

test('R2.2B ejecuta migration, RPC, RLS, idempotencia, CAS, rollback y fences en PostgreSQL 17', { timeout: 240_000 }, async () => {
  const { spawn, spawnSync } = await import('node:child_process');
  const containerName = `r22b-visit-${randomUUID().slice(0, 8)}`;
  const actorA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const actorB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const actorC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const actorD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const actorE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const actorF = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';
  const orgC = '55555555-5555-4555-8555-555555555555';
  const orgBClientUid = '33333333-3333-4333-8333-333333333333';
  const orgBPropertyUid = '44444444-4444-4444-8444-444444444444';
  const orgCClientUid = '66666666-6666-4666-8666-666666666666';
  const orgCPropertyUid = '77777777-7777-4777-8777-777777777777';
  const scopedKey = (organizationId: string, identity: string | number): string =>
    organizationScopedEntityKey(organizationId, identity);
  const docker = (args: string[]) => spawnSync('docker', args, {
    encoding: 'utf8', maxBuffer: 30 * 1024 * 1024,
  });
  const containerDiagnostics = (): string => {
    const inspect = docker(['inspect', containerName, '--format',
      'running={{.State.Running}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} exit={{.State.ExitCode}} error={{.State.Error}}']);
    const ready = docker(['exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'postgres']);
    const logs = docker(['logs', '--tail', '120', containerName]);
    return [
      `inspect: ${inspect.stdout || inspect.stderr}`,
      `pg_isready: ${ready.stdout || ready.stderr}`,
      `logs:\n${logs.stdout || logs.stderr}`,
    ].join('\n');
  };

  const rawPsql = (sql: string) => spawnSync(
    'docker',
    ['exec', '-i', containerName, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
    { encoding: 'utf8', input: sql, maxBuffer: 30 * 1024 * 1024 },
  );
  const psql = (sql: string): string => {
    const result = rawPsql(sql);
    assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${containerDiagnostics()}`);
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
  const visitCall = (operationId: string, type: 'VISIT_CREATE' | 'VISIT_RESOLVE', request: unknown, rollback = false): string =>
    `select public.commercial_visit_mutation('${operationId}'::uuid, '${type}', ${jsonSql(request)}, ${rollback});`;
  const createRequest = (clientId: number, propertyId = 1, expectedClientRevision = 0, date = '2035-01-02', time = '10:30') => ({
    client: { legacyId: clientId }, property: { legacyId: propertyId },
    expectedClientRevision, localDate: date, localTime: time,
  });
  const parseJson = (value: string): Record<string, any> => JSON.parse(value) as Record<string, any>;

  const started = spawnSync(
    'docker',
    [
      'run', '--detach', '--name', containerName,
      '--env', 'POSTGRES_PASSWORD=postgres',
      '--health-cmd', 'pg_isready -U postgres -d postgres',
      '--health-interval', '1s', '--health-timeout', '5s',
      '--health-start-period', '2s', '--health-retries', '60',
      'postgres:17',
    ],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );
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
    assert.equal(healthy, true, `PostgreSQL 17 no quedó healthy.\n${containerDiagnostics()}`);
    assert.equal(docker(['exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'postgres']).status, 0,
      containerDiagnostics());
    assert.equal(psql('select 1;'), '1');
    assert.match(psql('show server_version;'), /^17(?:\.|$)/);
    assert.equal(docker(['inspect', containerName, '--format', '{{.State.Running}}']).stdout.trim(), 'true',
      containerDiagnostics());

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
    psql(migration);

    const clientPayload = (id: number, overrides: Record<string, unknown> = {}) => ({
      id, name: `Cliente ${id}`, phone: '111', interest: 'Departamento', status: 'Lead',
      temperature: 'Tibio', pipeline: 'Calificado', budget: '100000', currency: 'USD',
      paymentMethod: 'Contado', zones: 'Centro', purpose: 'Vivir', purchaseTimeframe: 'Este año',
      canMoveForward: 'Sí', knowsArea: 'Sí', assignedToId: 1, revision: 0, ...overrides,
    });
    psql(`
      insert into public.organizations values ('${orgA}','A'),('${orgB}','B'),('${orgC}','C');
      insert into public.organization_members values
        ('${orgA}','${actorA}',1,'owner','active'),
        ('${orgA}','${actorB}',2,'admin','active'),
        ('${orgA}','${actorC}',3,'agent','active'),
        ('${orgA}','${actorD}',4,'agent','suspended'),
        ('${orgA}','${actorE}',6,'agent','active'),
        ('${orgB}','${actorA}',5,'owner','active'),
        ('${orgC}','${actorA}',7,'owner','active');
      ${Array.from({ length: 21 }, (_, index) => {
        const id = index + 1;
        const overrides = id === 2 ? { pipeline: 'Ganado', status: 'Operación ganada' }
          : id === 6 ? { budget: '' }
            : id === 15 ? { pipeline: 'Negociación' }
              : id === 16 ? { pipeline: 'Reservado' } : {};
        const agentAssignment = id === 3 || id === 20 ? { assignedToId: 3 }
          : id === 19 || id === 21 ? { assignedToId: 6 } : {};
        const assignedMemberId = id === 3 || id === 20 ? 3 : id === 19 || id === 21 ? 6 : id === 14 ? 'null' : 1;
        return `insert into public.propcontrol_records(organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,revision)
          values('${orgA}','client','${scopedKey(orgA, id)}',${assignedMemberId},${jsonSql(clientPayload(id, { ...overrides, ...agentAssignment }))},'${actorA}',0);`;
      }).join('\n')}
      insert into public.propcontrol_records(organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,revision)
        values('${orgA}','property','${scopedKey(orgA, 1)}',1,${jsonSql({ id: 1, title: 'Depto Centro', address: 'Calle 1', assignedToId: 1, revision: 0 })},'${actorA}',0);
      insert into public.propcontrol_records(organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,revision)
        values('${orgA}','property','${scopedKey(orgA, 2)}',3,${jsonSql({ id: 2, title: 'Depto Agente', address: 'Calle 2', assignedToId: 3, revision: 0 })},'${actorA}',0);
      insert into public.propcontrol_records(organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,revision)
        values('${orgA}','property','${scopedKey(orgA, 3)}',6,${jsonSql({ id: 3, title: 'Casa Agente B', address: 'Calle 3', assignedToId: 6, revision: 0 })},'${actorA}',0);
      insert into public.propcontrol_records(organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,uid,revision)
        values('${orgB}','client','${scopedKey(orgB, orgBClientUid)}',5,${jsonSql({ ...clientPayload(1), assignedToId: 5, uid: orgBClientUid })},'${actorA}','${orgBClientUid}',0),
          ('${orgB}','property','${scopedKey(orgB, orgBPropertyUid)}',5,${jsonSql({ id:1,title:'UID Property',address:'B',assignedToId:5,uid:orgBPropertyUid,revision:0 })},'${actorA}','${orgBPropertyUid}',0);
      insert into public.propcontrol_records(organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,uid,revision)
        values('${orgC}','client','${scopedKey(orgC, orgCClientUid)}',7,${jsonSql({ ...clientPayload(1), assignedToId: 7, uid: orgCClientUid })},'${actorA}','${orgCClientUid}',0),
          ('${orgC}','property','${scopedKey(orgC, orgCPropertyUid)}',7,${jsonSql({ id:1,title:'UID Property C',address:'C',assignedToId:7,uid:orgCPropertyUid,revision:0 })},'${actorA}','${orgCPropertyUid}',0);
    `);

    const qualificationCases: Client[] = [
      readyClient(), readyClient({ budget: '' }), readyClient({ currency: '' }),
      readyClient({ paymentMethod: '' }), readyClient({ zones: '' }),
      readyClient({ purpose: 'Vacaciones' }), readyClient({ purchaseTimeframe: '', urgency: '' }),
      readyClient({ canMoveForward: 'No confirmado' }),
      readyClient({ paymentMethod: 'Crédito hipotecario', creditPossible: 'En trámite' }),
      readyClient({ paymentMethod: 'Crédito hipotecario', creditPossible: 'Preaprobado' }),
      readyClient({ canMoveForward: 'Depende del crédito', creditPossible: 'Aprobado' }),
      readyClient({ knowsArea: 'No' }),
      readyClient({ operation: undefined, propertyType: undefined, bedrooms: undefined }),
    ];
    for (const candidate of qualificationCases) {
      const expectedMissing = visitReadiness(candidate, []).missing;
      assert.deepEqual(sqlContractMissing(candidate), expectedMissing);
      const actualMissing = JSON.parse(psql(`select pg_catalog.to_json(private.visit_qualification_missing(${jsonSql(candidate)}));`));
      assert.deepEqual(actualMissing, expectedMissing, JSON.stringify(candidate));
    }

    assert.equal(psql(`select count(*) from pg_proc where proname in ('commercial_visit_mutation','client_snapshot_cas') and prosecdef;`), '0');
    assert.equal(psql(`select count(*) from pg_catalog.pg_proc
      where proname='next_commercial_legacy_id';`), '1');
    const helperCatalog = parseJson(psql(`select pg_catalog.jsonb_build_object(
        'namespace', namespace.nspname,
        'name', procedure.proname,
        'securityDefiner', procedure.prosecdef,
        'volatility', procedure.provolatile,
        'config', procedure.proconfig,
        'definition', pg_catalog.pg_get_functiondef(procedure.oid)
      )
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid=procedure.pronamespace
      where procedure.oid='private.next_commercial_legacy_id(uuid,text)'::pg_catalog.regprocedure;`));
    assert.equal(helperCatalog.namespace, 'private');
    assert.equal(helperCatalog.name, 'next_commercial_legacy_id');
    assert.equal(helperCatalog.securityDefiner, true);
    assert.equal(helperCatalog.volatility, 'v');
    assert.deepEqual(helperCatalog.config, ['search_path=""']);
    assert.match(String(helperCatalog.definition), /security definer[\s\S]*set search_path to ''/i);
    assert.equal(psql(`select count(*) from private.commercial_entity_authority;`), '0');
    assert.match(asUserError(actorA, `insert into private.commercial_entity_authority values('${orgA}','visit',true,now(),'${actorA}');`), /permission denied/i);
    assert.match(asUserError(actorD, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(1))), /NOT_FOUND|PERMISSION_DENIED/);
    const anonCall = rawPsql(`set role anon; ${visitCall(randomUUID(), 'VISIT_CREATE', createRequest(1))}`);
    assert.notEqual(anonCall.status, 0);
    assert.match(`${anonCall.stderr}\n${anonCall.stdout}`, /permission denied/i);
    const offError = asUserError(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(1)));
    assert.match(offError, /TERMINAL_STATE/);
    const offProbeUid = randomUUID();
    asUser(actorA, `insert into public.propcontrol_records(organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,uid,revision)
      values('${orgA}','visit','${scopedKey(orgA, offProbeUid)}',1,'{"id":999,"uid":"${offProbeUid}","status":"Coordinada"}'::jsonb,'${actorA}','${offProbeUid}',0);`);
    asUser(actorA, `delete from public.propcontrol_records where organization_id='${orgA}' and entity_type='visit' and entity_key='${scopedKey(orgA, offProbeUid)}';`);

    psql(`insert into private.commercial_entity_authority(organization_id,entity_type,transaction_owned,activated_at,activated_by)
      values('${orgA}','visit',true,now(),'${actorA}'),('${orgB}','visit',true,now(),'${actorA}'),
        ('${orgC}','visit',true,now(),'${actorA}');`);

    assert.equal(asUser(actorC, `select pg_catalog.pg_typeof(private.next_commercial_legacy_id('${orgA}','visit'))::text;`), 'bigint');
    const crossTenantHelper = asUserError(actorC, `select private.next_commercial_legacy_id('${orgB}','visit');`);
    assert.match(crossTenantHelper, /PERMISSION_DENIED/);
    assert.doesNotMatch(crossTenantHelper, /Cliente|Depto|payload|transactionOwner/);
    assert.match(asUserError(actorD, `select private.next_commercial_legacy_id('${orgA}','activity');`), /PERMISSION_DENIED/);
    assert.match(asUserError(actorF, `select private.next_commercial_legacy_id('${orgA}','visit');`), /PERMISSION_DENIED/);
    assert.match(asUserError(actorC, `select private.next_commercial_legacy_id('${orgA}','offer');`), /VALIDATION_ERROR/);
    const anonAllocator = rawPsql(`set role anon; select private.next_commercial_legacy_id('${orgA}','visit');`);
    assert.notEqual(anonAllocator.status, 0);
    assert.match(`${anonAllocator.stderr}\n${anonAllocator.stdout}`, /permission denied/i);

    const createOperation = randomUUID();
    const createIntent = createRequest(1);
    const created = parseJson(asUser(actorA, visitCall(createOperation, 'VISIT_CREATE', createIntent)));
    assert.equal(created.replayed, false);
    assert.match(created.visit.uid, /^[0-9a-f-]{36}$/);
    assert.equal(created.visit.revision, 0);
    assert.equal(created.visit.id, 1);
    assert.equal(created.client.revision, 1);
    assert.equal(created.activity.transactionOwner, 'visit');
    assert.equal(psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='visit';`), '1');
    assert.equal(psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='activity';`), '1');
    assert.equal(psql(`select entity_key from public.propcontrol_records where organization_id='${orgA}' and entity_type='visit' and uid='${created.visit.uid}';`),
      scopedKey(orgA, created.visit.uid));
    assert.equal(psql(`select entity_key from public.propcontrol_records where organization_id='${orgA}' and entity_type='activity' and uid='${created.activity.uid}';`),
      scopedKey(orgA, created.activity.uid));
    assert.equal(psql(`select count(*) from public.propcontrol_records where entity_type in ('offer','counteroffer','reservation');`), '0');

    const injectedVisitUid = randomUUID();
    assert.match(asUserError(actorA, `insert into public.propcontrol_records(organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,uid,revision)
      values('${orgA}','visit','${scopedKey(orgA, injectedVisitUid)}',1,'{"id":998,"uid":"${injectedVisitUid}","status":"Coordinada"}'::jsonb,'${actorA}','${injectedVisitUid}',0);`), /TRANSACTION_AUTHORITY_REQUIRED/);
    assert.match(asUserError(actorA, `update public.propcontrol_records set entity_type='activity' where organization_id='${orgA}' and entity_type='visit' and uid='${created.visit.uid}';`), /TRANSACTION_AUTHORITY_REQUIRED/);
    assert.match(asUserError(actorA, `update public.propcontrol_records set payload=payload-'transactionOwner' where organization_id='${orgA}' and entity_type='activity' and uid='${created.activity.uid}';`), /TRANSACTION_AUTHORITY_REQUIRED/);
    assert.match(asUserError(actorA, `update public.propcontrol_records set payload=jsonb_set(payload,'{transactionOwner}','"other"') where organization_id='${orgA}' and entity_type='activity' and uid='${created.activity.uid}';`), /TRANSACTION_AUTHORITY_REQUIRED/);
    assert.match(asUserError(actorA, `delete from public.propcontrol_records where organization_id='${orgA}' and entity_type='activity' and uid='${created.activity.uid}';`), /TRANSACTION_AUTHORITY_REQUIRED/);
    const injectedActivityUid = randomUUID();
    assert.match(asUserError(actorA, `insert into public.propcontrol_records(organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,uid,revision)
      values('${orgA}','activity','${scopedKey(orgA, injectedActivityUid)}',1,'{"id":997,"uid":"${injectedActivityUid}","transactionOwner":"visit"}'::jsonb,'${actorA}','${injectedActivityUid}',0);`), /TRANSACTION_AUTHORITY_REQUIRED/);

    const replay = parseJson(asUser(actorA, visitCall(createOperation, 'VISIT_CREATE', createIntent)));
    assert.equal(replay.replayed, true);
    assert.equal(replay.errorCode, 'IDEMPOTENCY_REPLAY');
    assert.equal(replay.visit.uid, created.visit.uid);
    assert.equal(replay.visit.id, created.visit.id);
    assert.equal(replay.activity.id, created.activity.id);
    assert.equal(psql(`select count(*) from private.commercial_operations where organization_id='${orgA}' and operation_id='${createOperation}';`), '1');
    assert.equal(psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='activity' and payload->>'operationId'='${createOperation}';`), '1');
    assert.match(asUserError(actorA, visitCall(createOperation, 'VISIT_CREATE', { ...createIntent, localTime: '11:00' })), /CONFLICT/);

    assert.match(asUserError(actorA, `update public.propcontrol_records set payload=payload where organization_id='${orgA}' and entity_type='client' and entity_key='${scopedKey(orgA, 1)}';`), /CLIENT_CAS_REQUIRED/);
    assert.match(asUserError(actorA, `delete from public.propcontrol_records where organization_id='${orgA}' and entity_type='client' and entity_key='${scopedKey(orgA, 1)}';`), /CLIENT_CAS_REQUIRED/);
    assert.match(asUserError(actorA, `update public.propcontrol_records set payload=payload where organization_id='${orgA}' and entity_type='visit' and uid='${created.visit.uid}';`), /TRANSACTION_AUTHORITY_REQUIRED/);
    assert.match(asUserError(actorA, `delete from public.propcontrol_records where organization_id='${orgA}' and entity_type='visit' and uid='${created.visit.uid}';`), /TRANSACTION_AUTHORITY_REQUIRED/);
    assert.match(asUserError(actorA, `select public.client_snapshot_cas(${jsonSql({ action:'update',client:{legacyId:1},expectedRevision:0,payload:clientPayload(1) })},false);`), /CONFLICT/);
    const cas = parseJson(asUser(actorA, `select public.client_snapshot_cas(${jsonSql({
      action:'update',client:{legacyId:1},expectedRevision:1,
      payload:clientPayload(999,{uid:randomUUID(),operationId:randomUUID()}),
    })},false);`));
    assert.equal(cas.client.revision, 2);
    assert.equal(cas.client.id, 1);
    assert.equal(cas.client.uid, undefined);
    assert.equal(psql(`select entity_key||':'||revision from public.propcontrol_records where organization_id='${orgA}' and entity_type='client' and entity_key='${scopedKey(orgA, 1)}';`),
      `${scopedKey(orgA, 1)}:2`);
    assert.match(asUserError(actorA, `select public.client_snapshot_cas(${jsonSql({ action:'delete',client:{legacyId:13},expectedRevision:1 })},false);`), /CONFLICT/);
    const deleted = parseJson(asUser(actorA, `select public.client_snapshot_cas(${jsonSql({ action:'delete',client:{legacyId:13},expectedRevision:0 })},false);`));
    assert.equal(deleted.action, 'delete');
    assert.equal(psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='client' and entity_key='${scopedKey(orgA, 13)}';`), '0');

    const rollbackBefore = psql(`select revision||':'||(select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type in ('visit','activity')) from public.propcontrol_records where organization_id='${orgA}' and entity_type='client' and entity_key='${scopedKey(orgA, 4)}';`);
    const rollbackVisitId = asUser(actorA, `select private.next_commercial_legacy_id('${orgA}','visit');`);
    const rollbackActivityId = asUser(actorA, `select private.next_commercial_legacy_id('${orgA}','activity');`);
    assert.match(asUserError(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(4), true)), /INTERNAL_ERROR/);
    const rollbackAfter = psql(`select revision||':'||(select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type in ('visit','activity')) from public.propcontrol_records where organization_id='${orgA}' and entity_type='client' and entity_key='${scopedKey(orgA, 4)}';`);
    assert.equal(rollbackAfter, rollbackBefore);
    assert.equal(asUser(actorA, `select private.next_commercial_legacy_id('${orgA}','visit');`), rollbackVisitId);
    assert.equal(asUser(actorA, `select private.next_commercial_legacy_id('${orgA}','activity');`), rollbackActivityId);

    asUser(actorA, `select public.client_snapshot_cas(${jsonSql({ action:'update',client:{legacyId:5},expectedRevision:0,payload:clientPayload(5,{notes:'delayed snapshot'}) })},false);`);
    assert.match(asUserError(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(5, 1, 0, '2035-01-03'))), /CONFLICT/);
    assert.match(asUserError(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(2))), /TERMINAL_STATE/);
    assert.match(asUserError(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(6))), /QUALIFICATION_REQUIRED/);
    assert.match(asUserError(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(7, 1, 0, '2020-01-01'))), /PAST_SCHEDULE/);
    assert.match(asUserError(actorC, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(1))), /NOT_FOUND|PERMISSION_DENIED/);

    const uidCreated = parseJson(asUser(actorA, visitCall(randomUUID(), 'VISIT_CREATE', {
      client:{uid:orgBClientUid},property:{uid:orgBPropertyUid},expectedClientRevision:0,localDate:'2035-02-01',localTime:'09:00',
    })));
    assert.equal(uidCreated.visit.clientUid, orgBClientUid);
    assert.equal(uidCreated.visit.propertyUid, orgBPropertyUid);
    const otherTenantCreated = parseJson(asUser(actorA, visitCall(randomUUID(), 'VISIT_CREATE', {
      client:{uid:orgCClientUid},property:{uid:orgCPropertyUid},expectedClientRevision:0,localDate:'2035-02-01',localTime:'09:00',
    })));
    assert.notEqual(otherTenantCreated.organizationId, uidCreated.organizationId);
    assert.equal(otherTenantCreated.visit.id, uidCreated.visit.id);
    assert.equal(otherTenantCreated.activity.id, uidCreated.activity.id);
    const uidIdentity = psql(`select organization_id||':'||entity_type||':'||entity_key||':'||uid||':'||revision
      from public.propcontrol_records where organization_id='${orgB}' and entity_type='client' and uid='${orgBClientUid}';`);
    const uidCas = parseJson(asUser(actorA, `select public.client_snapshot_cas(${jsonSql({
      action:'update',client:{uid:orgBClientUid},expectedRevision:1,
      payload:{...clientPayload(999),uid:randomUUID(),operationId:randomUUID()},
    })},false);`));
    assert.equal(uidCas.client.id, 1);
    assert.equal(uidCas.client.uid, orgBClientUid);
    assert.equal(psql(`select organization_id||':'||entity_type||':'||entity_key||':'||uid||':'||(revision-1)
      from public.propcontrol_records where organization_id='${orgB}' and entity_type='client' and uid='${orgBClientUid}';`), uidIdentity);
    const crossTenantOperation = randomUUID();
    const crossA = parseJson(asUser(actorA, visitCall(crossTenantOperation, 'VISIT_CREATE', createRequest(18,1,0,'2035-02-05','08:00'))));
    const crossB = parseJson(asUser(actorA, visitCall(crossTenantOperation, 'VISIT_CREATE', {
      client:{uid:orgBClientUid},property:{uid:orgBPropertyUid},expectedClientRevision:2,localDate:'2035-02-05',localTime:'08:00',
    })));
    assert.equal(crossA.operationId, crossTenantOperation);
    assert.equal(crossB.operationId, crossTenantOperation);
    assert.notEqual(crossA.organizationId, crossB.organizationId);
    assert.equal(psql(`select count(*) from private.commercial_operations where operation_id='${crossTenantOperation}';`), '2');
    assert.equal(asUser(actorB, `select count(*) from public.propcontrol_records where organization_id='${orgB}';`), '0');

    const fallbackCreated = parseJson(asUser(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(14,1,0,'2035-02-10','09:30'))));
    assert.equal(fallbackCreated.visit.assignedToId, 1);
    assert.equal(fallbackCreated.activity.actorId, 1);
    assert.match(asUserError(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(14,1,1,'2035-02-10','09:30'))), /DUPLICATE_VISIT/);

    // Owner -> agent con visibilidad disjunta.
    const agentCreated = parseJson(asUser(actorC, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(3,2,0,'2035-02-11','10:00'))));
    assert.equal(agentCreated.visit.assignedToId, 3);
    assert.notEqual(agentCreated.visit.id, fallbackCreated.visit.id);
    assert.notEqual(agentCreated.activity.id, fallbackCreated.activity.id);

    // Agent A -> agent B con asignaciones distintas.
    const secondAgentCreated = parseJson(asUser(actorE, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(19,3,0,'2035-02-12','10:30'))));
    assert.equal(secondAgentCreated.visit.assignedToId, 6);
    assert.equal(secondAgentCreated.activity.actorId, 6);
    assert.notEqual(secondAgentCreated.visit.id, agentCreated.visit.id);
    assert.notEqual(secondAgentCreated.activity.id, agentCreated.activity.id);

    // Agent -> owner.
    const resolveCreate = parseJson(asUser(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(8,1,0,'2035-03-01','12:00'))));
    assert.notEqual(resolveCreate.visit.id, secondAgentCreated.visit.id);
    assert.notEqual(resolveCreate.activity.id, secondAgentCreated.activity.id);
    const resolveOperation = randomUUID();
    const resolveIntent = {
      client:{legacyId:8},visitUid:resolveCreate.visit.uid,expectedVisitRevision:0,expectedClientRevision:1,
      status:'Realizada',interest:'Alto',objection:'Le gustó',nextAction:'Enviar propuesta',nextFollowUp:'2035-03-02',
    };
    const resolved = parseJson(asUser(actorA, visitCall(resolveOperation, 'VISIT_RESOLVE', resolveIntent)));
    assert.equal(resolved.visit.status, 'Realizada');
    assert.equal(resolved.visit.interest, 'Alto');
    assert.equal(resolved.visit.revision, 1);
    assert.equal(resolved.client.revision, 2);
    assert.equal(parseJson(asUser(actorA, visitCall(resolveOperation, 'VISIT_RESOLVE', resolveIntent))).replayed, true);
    assert.match(asUserError(actorA, visitCall(randomUUID(), 'VISIT_RESOLVE', { ...resolveIntent, expectedClientRevision:2, expectedVisitRevision:1, status:'Cancelada', interest:undefined })), /TERMINAL_STATE/);

    const missingInterestCreate = parseJson(asUser(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(9,1,0,'2035-04-01','12:00'))));
    assert.match(asUserError(actorA, visitCall(randomUUID(), 'VISIT_RESOLVE', {
      client:{legacyId:9},visitUid:missingInterestCreate.visit.uid,expectedVisitRevision:0,expectedClientRevision:1,
      status:'Realizada',nextAction:'Llamar',nextFollowUp:'2035-04-02',
    })), /VALIDATION_ERROR/);

    const cancelledCreate = parseJson(asUser(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(15,1,0,'2035-04-10','12:00'))));
    const cancelledOperation = randomUUID();
    const cancelled = parseJson(asUser(actorA, visitCall(cancelledOperation, 'VISIT_RESOLVE', {
      client:{legacyId:15},visitUid:cancelledCreate.visit.uid,expectedVisitRevision:0,expectedClientRevision:1,
      status:'Cancelada',interest:'Alto',objection:'Cambio de planes',nextAction:'Reagendar',nextFollowUp:'2035-04-11',
    })));
    assert.equal(cancelled.visit.status, 'Cancelada');
    assert.equal(cancelled.visit.interest, undefined);
    assert.equal(cancelled.activity.action, 'Visita cancelada');
    assert.equal(cancelled.client.pipeline, 'Negociación');
    assert.equal(psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='activity' and payload->>'operationId'='${cancelledOperation}';`), '1');

    const noShowCreate = parseJson(asUser(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(16,1,0,'2035-04-20','12:00'))));
    const noShow = parseJson(asUser(actorA, visitCall(randomUUID(), 'VISIT_RESOLVE', {
      client:{legacyId:16},visitUid:noShowCreate.visit.uid,expectedVisitRevision:0,expectedClientRevision:1,
      status:'No asistió',interest:'Medio',nextAction:'Contactar',nextFollowUp:'2035-04-21',
    })));
    assert.equal(noShow.visit.status, 'No asistió');
    assert.equal(noShow.visit.interest, undefined);
    assert.equal(noShow.activity.action, 'Cliente no asistió');
    assert.equal(noShow.client.pipeline, 'Reservado');

    const wrongClientCreate = parseJson(asUser(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(17,1,0,'2035-04-25','12:00'))));
    assert.match(asUserError(actorA, visitCall(randomUUID(), 'VISIT_RESOLVE', {
      client:{legacyId:4},visitUid:wrongClientCreate.visit.uid,expectedVisitRevision:0,expectedClientRevision:0,
      status:'Cancelada',nextAction:'Seguimiento',nextFollowUp:'2035-04-26',
    })), /WRONG_CLIENT/);

    const terminalResolveCreate = parseJson(asUser(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(10,1,0,'2035-05-01','12:00'))));
    assert.equal(terminalResolveCreate.client.revision, 1);
    const terminalPayload = parseJson(psql(`select payload::text from public.propcontrol_records
      where organization_id='${orgA}' and entity_type='client' and entity_key='${scopedKey(orgA, 10)}';`));
    const terminalCas = parseJson(asUser(actorA, `select public.client_snapshot_cas(${jsonSql({
      action:'update',client:{legacyId:10},expectedRevision:1,
      payload:{...terminalPayload,pipeline:'Ganado',status:'Operación ganada'},
    })},false);`));
    assert.equal(terminalCas.client.revision, 2);
    assert.equal(terminalCas.client.pipeline, 'Ganado');
    assert.equal(terminalCas.client.status, 'Operación ganada');
    const terminalBefore = psql(`select payload::text||':'||revision from public.propcontrol_records where organization_id='${orgA}' and entity_type='client' and entity_key='${scopedKey(orgA, 10)}';`);
    const terminalResolveOperation = randomUUID();
    const terminalResolved = parseJson(asUser(actorA, visitCall(terminalResolveOperation, 'VISIT_RESOLVE', {
      client:{legacyId:10},visitUid:terminalResolveCreate.visit.uid,expectedVisitRevision:0,expectedClientRevision:2,status:'Cancelada',
    })));
    assert.equal(terminalResolved.visit.status, 'Cancelada');
    assert.equal(terminalResolved.client.revision, 2);
    assert.equal(terminalResolved.client.pipeline, 'Ganado');
    assert.equal(terminalResolved.client.status, 'Operación ganada');
    const terminalAfter = psql(`select payload::text||':'||revision from public.propcontrol_records where organization_id='${orgA}' and entity_type='client' and entity_key='${scopedKey(orgA, 10)}';`);
    assert.equal(terminalAfter, terminalBefore);
    assert.equal(psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='visit' and uid='${terminalResolveCreate.visit.uid}';`), '1');
    assert.equal(psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='activity' and payload->>'operationId'='${terminalResolveOperation}';`), '1');

    const collisionCreate = parseJson(asUser(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(11,1,0,'2035-06-01','12:00'))));
    const collisionOperation = collisionCreate.operationId as string;
    const actorCollision = asUserError(actorB, visitCall(collisionOperation, 'VISIT_CREATE', createRequest(11,1,0,'2035-06-01','12:00')));
    assert.match(actorCollision, /CONFLICT/);
    assert.doesNotMatch(actorCollision, /result_payload|transactionOwner|Depto Centro/);

    const ordinaryActivityUid = randomUUID();
    asUser(actorA, `insert into public.propcontrol_records(organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,uid,revision)
      values('${orgA}','activity','${scopedKey(orgA, ordinaryActivityUid)}',1,'{"id":${created.activity.id},"uid":"${ordinaryActivityUid}","action":"Manual"}'::jsonb,'${actorA}','${ordinaryActivityUid}',0);`);
    assert.equal(psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='activity' and payload->>'id'='${created.activity.id}';`), '2');
    asUser(actorA, `update public.propcontrol_records set payload=payload||'{"detail":"ok"}'::jsonb
      where organization_id='${orgA}' and entity_type='activity' and entity_key='${scopedKey(orgA, ordinaryActivityUid)}';`);
    assert.match(asUserError(actorA, `update public.propcontrol_records set payload=payload||'{"transactionOwner":"visit"}'::jsonb
      where organization_id='${orgA}' and entity_type='activity' and entity_key='${scopedKey(orgA, ordinaryActivityUid)}';`), /TRANSACTION_AUTHORITY_REQUIRED/);
    assert.match(asUserError(actorA, `update public.propcontrol_records set entity_type='visit'
      where organization_id='${orgA}' and entity_type='activity' and entity_key='${scopedKey(orgA, ordinaryActivityUid)}';`), /TRANSACTION_AUTHORITY_REQUIRED/);

    assert.equal(asUser(actorB, `select count(*) from private.commercial_operations where organization_id='${orgA}' and actor_user_id='${actorA}';`), '0');
    assert.equal(psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and entity_type='client' and entity_key='${scopedKey(orgA, 4)}' and revision=0;`), '1');
    assert.equal(psql(`select count(*) from pg_catalog.pg_proc
      where proname in ('commercial_visit_mutation','client_snapshot_cas','visit_authority_active','visit_qualification_missing')
        and proconfig = array['search_path=""']::text[];`), '4');

    // Dos agentes con visibilidad disjunta crean en paralelo y comparten el allocator tenant-wide.
    const parallelOperations = [randomUUID(), randomUUID()];
    const parallelCreateCommands = [
      { actor: actorC, sql: visitCall(parallelOperations[0]!, 'VISIT_CREATE', createRequest(20,2,0,'2035-06-15','10:00')) },
      { actor: actorE, sql: visitCall(parallelOperations[1]!, 'VISIT_CREATE', createRequest(21,3,0,'2035-06-15','10:30')) },
    ].map(({ actor, sql }) => `set role authenticated;
      select pg_catalog.set_config('request.jwt.claim.sub','${actor}',false);
      ${sql}`);
    const parallelCreates = await Promise.all(parallelCreateCommands.map((sql) => new Promise<{ code: number | null; output: string }>((resolve) => {
      const child = spawn('docker', ['exec','-i',containerName,'psql','-U','postgres','-d','postgres','-X','-A','-t','-v','ON_ERROR_STOP=1']);
      let output = '';
      child.stdout.on('data', (chunk) => { output += String(chunk); });
      child.stderr.on('data', (chunk) => { output += String(chunk); });
      child.on('close', (code) => resolve({ code, output }));
      child.stdin.end(sql);
    })));
    assert.equal(parallelCreates.every((item) => item.code === 0), true, parallelCreates.map((item) => item.output).join('\n'));
    const parallelResults = parallelCreates.map((item) => parseJson(
      item.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? '',
    ));
    assert.notEqual(parallelResults[0]!.visit.id, parallelResults[1]!.visit.id);
    assert.notEqual(parallelResults[0]!.activity.id, parallelResults[1]!.activity.id);
    assert.equal(psql(`select count(*) from private.commercial_operations where operation_id in ('${parallelOperations[0]}','${parallelOperations[1]}');`), '2');

    // Dos resoluciones incompatibles con el mismo CAS: una confirma y la otra observa conflicto/terminal.
    const concurrentCreate = parseJson(asUser(actorA, visitCall(randomUUID(), 'VISIT_CREATE', createRequest(12,1,0,'2035-07-01','12:00'))));
    const commands = ['Cancelada', 'No asistió'].map((status) => `set role authenticated;
      select pg_catalog.set_config('request.jwt.claim.sub','${actorA}',false);
      ${visitCall(randomUUID(), 'VISIT_RESOLVE', {
        client:{legacyId:12},visitUid:concurrentCreate.visit.uid,expectedVisitRevision:0,expectedClientRevision:1,
        status,nextAction:'Seguimiento',nextFollowUp:'2035-07-02',
      })}`);
    const concurrent = await Promise.all(commands.map((sql) => new Promise<{ code: number | null; output: string }>((resolve) => {
      const child = spawn('docker', ['exec','-i',containerName,'psql','-U','postgres','-d','postgres','-X','-A','-t','-v','ON_ERROR_STOP=1']);
      let output = '';
      child.stdout.on('data', (chunk) => { output += String(chunk); });
      child.stderr.on('data', (chunk) => { output += String(chunk); });
      child.on('close', (code) => resolve({ code, output }));
      child.stdin.end(sql);
    })));
    assert.equal(concurrent.filter((item) => item.code === 0).length, 1);
    assert.equal(concurrent.filter((item) => item.code !== 0).length, 1);
    assert.match(concurrent.find((item) => item.code !== 0)?.output ?? '', /CONFLICT|TERMINAL_STATE/);
  } finally {
    spawnSync('docker', ['rm', '--force', containerName], { encoding: 'utf8' });
  }
});
