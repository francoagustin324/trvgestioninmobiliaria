import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  executeVisitWriterSelection,
  selectVisitWriterMode,
} from '../visit-writer-selection.js';
import { snapshotOwnsVisitWhenAuthorityOff } from '../visit-transaction-cloud.js';
import {
  snapshotMayWriteCommercialEntity,
  VISIT_TRANSACTION_COMMERCIAL_AUTHORITY,
} from '../commercial-sync-transition.js';

const capabilityPath = 'supabase/migrations/20260901223000_p1_1_a7_r2_2c_visit_authority_capability.sql';
const capability = readFileSync(capabilityPath, 'utf8');
const cutover = readFileSync('src/visit-workflow-cutover.ts', 'utf8');
const cloudAdapter = readFileSync('src/visit-transaction-cloud.ts', 'utf8');
const compatible = readFileSync('src/cloud-api-compatible.ts', 'utf8');
const visitUi = readFileSync('src/visit-workflow-ui.ts', 'utf8');
const r22b = readFileSync('supabase/migrations/20260831120000_p1_1_a7_r2_2_visit_transaction_backend.sql', 'utf8');

test('R2.2C1 capability no acepta organizationId y permanece SECURITY INVOKER boolean-only', () => {
  const signature = capability.match(/create function public\.visit_transaction_authority_active\(([^)]*)\)/i)?.[1] ?? 'missing';
  assert.equal(signature.trim(), '');
  assert.match(capability, /returns boolean[\s\S]*stable[\s\S]*security invoker[\s\S]*set search_path = ''/i);
  assert.doesNotMatch(capability, /security definer|service_role/i);
  assert.match(capability, /current_user_id uuid := auth\.uid\(\)/i);
  assert.match(capability, /from public\.organization_members as member[\s\S]*member\.user_id = current_user_id/i);
  assert.match(capability, /lower\(coalesce\(member\.status, 'active'\)\) = 'active'/i);
  assert.match(capability, /array_length\(active_organizations, 1\)[\s\S]*<> 1[\s\S]*PERMISSION_DENIED/i);
  assert.match(capability, /return private\.visit_authority_active\(target_organization_id\)/i);
  assert.match(capability, /revoke all on function public\.visit_transaction_authority_active\(\) from public/i);
  assert.match(capability, /revoke all on function public\.visit_transaction_authority_active\(\) from anon/i);
  assert.match(capability, /grant execute on function public\.visit_transaction_authority_active\(\) to authenticated/i);
  assert.doesNotMatch(capability, /\b(insert|update|delete|alter table|create policy|drop policy)\b/i);
});

test('R2.2C1 no reescribe migration R2.2B ni relaja sus fences', () => {
  assert.match(r22b, /message = 'TERMINAL_STATE'/i);
  assert.match(r22b, /message = 'CLIENT_CAS_REQUIRED'/i);
  assert.match(r22b, /message = 'TRANSACTION_AUTHORITY_REQUIRED'/i);
  assert.doesNotMatch(capability, /commercial_entity_authority[\s\S]*(insert|update|delete)/i);
});

test('R2.2C selector usa local sin sesión, legacy sólo con OFF y RPC sólo con ON', () => {
  assert.equal(selectVisitWriterMode(false), 'local');
  assert.equal(selectVisitWriterMode(true, false), 'legacy-cloud');
  assert.equal(selectVisitWriterMode(true, true), 'transactional-cloud');
  assert.throws(() => selectVisitWriterMode(true), /capability/i);
});

test('R2.2C sin sesión no consulta capability ni toca writers cloud', async () => {
  const calls: string[] = [];
  const result = await executeVisitWriterSelection({
    hasCloudSession: false,
    readAuthority: async () => { calls.push('capability'); return true; },
    runLocal: () => { calls.push('local'); return 'local'; },
    runLegacyCloud: () => { calls.push('legacy'); return 'legacy'; },
    runTransactionalCloud: () => { calls.push('rpc'); return 'rpc'; },
  });
  assert.equal(result, 'local');
  assert.deepEqual(calls, ['local']);
});

test('R2.2C cloud OFF ejecuta únicamente legacy y no llama transactional RPC', async () => {
  const calls: string[] = [];
  await executeVisitWriterSelection({
    hasCloudSession: true,
    readAuthority: async () => { calls.push('capability:false'); return false; },
    runLocal: () => { calls.push('local'); },
    runLegacyCloud: () => { calls.push('legacy'); },
    runTransactionalCloud: () => { calls.push('rpc'); },
  });
  assert.deepEqual(calls, ['capability:false', 'legacy']);
});

test('R2.2C cloud ON ejecuta únicamente RPC', async () => {
  const calls: string[] = [];
  await executeVisitWriterSelection({
    hasCloudSession: true,
    readAuthority: async () => { calls.push('capability:true'); return true; },
    runLocal: () => { calls.push('local'); },
    runLegacyCloud: () => { calls.push('legacy'); },
    runTransactionalCloud: () => { calls.push('rpc'); },
  });
  assert.deepEqual(calls, ['capability:true', 'rpc']);
});

test('R2.2C ON + TERMINAL_STATE propaga error y nunca hace fallback', async () => {
  const calls: string[] = [];
  await assert.rejects(executeVisitWriterSelection({
    hasCloudSession: true,
    readAuthority: async () => true,
    runLocal: () => { calls.push('local'); },
    runLegacyCloud: () => { calls.push('legacy'); },
    runTransactionalCloud: () => { calls.push('rpc'); throw new Error('TERMINAL_STATE'); },
  }), /TERMINAL_STATE/);
  assert.deepEqual(calls, ['rpc']);
});

test('R2.2C ON + error de red ambiguo propaga error y nunca hace fallback', async () => {
  const calls: string[] = [];
  await assert.rejects(executeVisitWriterSelection({
    hasCloudSession: true,
    readAuthority: async () => true,
    runLocal: () => { calls.push('local'); },
    runLegacyCloud: () => { calls.push('legacy'); },
    runTransactionalCloud: async () => { calls.push('rpc'); throw new Error('network timeout'); },
  }), /network timeout/);
  assert.deepEqual(calls, ['rpc']);
});

test('R2.2C error del capability falla antes de seleccionar cualquier writer', async () => {
  const calls: string[] = [];
  await assert.rejects(executeVisitWriterSelection({
    hasCloudSession: true,
    readAuthority: async () => { throw new Error('capability unavailable'); },
    runLocal: () => { calls.push('local'); },
    runLegacyCloud: () => { calls.push('legacy'); },
    runTransactionalCloud: () => { calls.push('rpc'); },
  }), /capability unavailable/);
  assert.deepEqual(calls, []);
});

test('R2.2C snapshot ownership respeta OFF/ON sin segundo writer', () => {
  assert.equal(snapshotOwnsVisitWhenAuthorityOff(), true);
  assert.equal(snapshotMayWriteCommercialEntity('visit', VISIT_TRANSACTION_COMMERCIAL_AUTHORITY), false);
  assert.match(cloudAdapter, /row\.entity_type === 'visit'[\s\S]*snapshotMayWriteCommercialEntity\('visit', authority\)/i);
  assert.match(cloudAdapter, /transactionOwner === 'visit'/i);
  assert.match(cloudAdapter, /rpc\/client_snapshot_cas/i);
  assert.match(cloudAdapter, /current\.assigned_member_id !== nextRow\.assigned_member_id[\s\S]*throw new Error/i);
  assert.doesNotMatch(cloudAdapter, /serializable|service_role/i);
});

test('R2.2C adapter fija false para carrera OFF→ON y no reconsulta esa decisión', () => {
  assert.match(cutover, /pushCloudData\(state\.crm, accountKey, false\)/i);
  assert.match(compatible, /job\.visitAuthorityDecision \?\? await visitTransactionAuthorityActive\(\)/i);
  assert.match(compatible, /if \(authorityActive\)[\s\S]*pushCloudDataWithVisitAuthority[\s\S]*else[\s\S]*pushModernCloudData/i);
  assert.doesNotMatch(cutover, /catch[\s\S]*invokeVisitTransaction/i);
});

test('R2.2C RPC cloud envía sólo intent y conserva operationId estable para retries', () => {
  assert.match(cloudAdapter, /rpc\('commercial_visit_mutation',[\s\S]*p_operation_id: intent\.operationId[\s\S]*p_operation_type: intent\.operationType[\s\S]*p_request: mutationRequest\(intent\)/i);
  assert.match(visitUi, /form\.dataset\.operationId[\s\S]*newOperationId\(\)[\s\S]*form\.dataset\.operationId = created/i);
  assert.match(cutover, /expectedClientRevision: normalizeRevision\(input\.client\.revision\)/i);
  assert.match(cutover, /expectedVisitRevision: normalizeRevision\(input\.visit\.revision\)/i);
});

test('R2.2C reconciliación cloud sólo reemplaza CRM cuando el job sigue siendo latest', () => {
  assert.match(compatible, /const latest = markCloudSaved\([\s\S]*if \(latest\)[\s\S]*propcontrol-cloud-authoritative-snapshot/i);
  assert.match(cutover, /propcontrol-cloud-authoritative-snapshot[\s\S]*state\.crm = structuredClone\(crm\)[\s\S]*markDirty: false[\s\S]*trv-render/i);
  assert.match(compatible, /key === 'clients'[\s\S]*delete record\.revision[\s\S]*delete record\.operationId/i);
  assert.doesNotMatch(cutover, /resetTransientState/);
});

test('R2.2C1 capability ejecuta auth, RLS y OFF/ON en PostgreSQL 17', { timeout: 120_000 }, async () => {
  const { spawnSync } = await import('node:child_process');
  const containerName = `r22c-cap-${randomUUID().slice(0, 8)}`;
  const actorA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const actorB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const suspended = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const outsider = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';

  const docker = (args: string[]) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const rawPsql = (sql: string) => spawnSync(
    'docker', ['exec', '-i', containerName, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
    { encoding: 'utf8', input: sql, maxBuffer: 20 * 1024 * 1024 },
  );
  const psql = (sql: string): string => {
    const result = rawPsql(sql);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  const asUser = (userId: string, sql: string): string => psql(`
    set role authenticated;
    select pg_catalog.set_config('request.jwt.claim.sub','${userId}',false);
    ${sql}
  `).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? '';
  const asUserError = (userId: string, sql: string): string => {
    const result = rawPsql(`
      set role authenticated;
      select pg_catalog.set_config('request.jwt.claim.sub','${userId}',false);
      ${sql}
    `);
    assert.notEqual(result.status, 0, 'La sentencia debía fallar.');
    return `${result.stderr}\n${result.stdout}`;
  };

  const started = docker([
    'run', '--detach', '--name', containerName,
    '--env', 'POSTGRES_PASSWORD=postgres',
    '--health-cmd', 'pg_isready -U postgres -d postgres',
    '--health-interval', '1s', '--health-timeout', '5s', '--health-start-period', '2s', '--health-retries', '60',
    'postgres:17',
  ]);
  assert.equal(started.status, 0, started.stderr || started.stdout);

  try {
    let healthy = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const probe = docker(['inspect', containerName, '--format', '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}']);
      if (probe.status === 0 && probe.stdout.trim() === 'true|healthy') { healthy = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(healthy, true, docker(['logs', '--tail', '100', containerName]).stdout);
    assert.match(psql('show server_version;'), /^17(?:\.|$)/);

    psql(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create schema private;
      grant usage on schema public, private, auth to authenticated;
      create function auth.uid() returns uuid language sql stable security invoker set search_path=''
      as $f$ select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
      create table public.organization_members(
        organization_id uuid not null,
        user_id uuid not null,
        status text not null,
        primary key(organization_id,user_id)
      );
      alter table public.organization_members enable row level security;
      grant select on public.organization_members to authenticated;
      create policy own_membership on public.organization_members for select to authenticated using(user_id=auth.uid());

      create table private.commercial_entity_authority(
        organization_id uuid not null,
        entity_type text not null,
        transaction_owned boolean not null default false,
        primary key(organization_id,entity_type)
      );
      alter table private.commercial_entity_authority enable row level security;
      create function private.is_active_org_member(target_org uuid, target_user uuid default auth.uid())
      returns boolean language sql stable security definer set search_path=''
      as $f$ select exists(select 1 from public.organization_members
        where organization_id=target_org and user_id=target_user and pg_catalog.lower(status)='active') $f$;
      create policy authority_member on private.commercial_entity_authority for select to authenticated
        using(private.is_active_org_member(organization_id));
      revoke all on table private.commercial_entity_authority from public, anon, authenticated;
      grant select on private.commercial_entity_authority to authenticated;
      grant execute on function private.is_active_org_member(uuid,uuid) to authenticated;
      create function private.visit_authority_active(target_org uuid)
      returns boolean language sql stable security invoker set search_path=''
      as $f$ select coalesce((select transaction_owned from private.commercial_entity_authority
        where organization_id=target_org and entity_type='visit'), false) $f$;
      revoke all on function private.visit_authority_active(uuid) from public;
      grant execute on function private.visit_authority_active(uuid) to authenticated;

      insert into public.organization_members values
        ('${orgA}','${actorA}','active'),
        ('${orgB}','${actorB}','active'),
        ('${orgA}','${suspended}','suspended');
      insert into private.commercial_entity_authority values
        ('${orgA}','visit',false),('${orgB}','visit',true);
    `);
    psql(capability);

    const metadata = JSON.parse(psql(`select pg_catalog.jsonb_build_object(
      'result', pg_catalog.pg_get_function_result(procedure.oid),
      'securityDefiner', procedure.prosecdef,
      'volatility', procedure.provolatile,
      'config', procedure.proconfig
    ) from pg_catalog.pg_proc as procedure
      where procedure.oid='public.visit_transaction_authority_active()'::pg_catalog.regprocedure;`));
    assert.equal(metadata.result, 'boolean');
    assert.equal(metadata.securityDefiner, false);
    assert.equal(metadata.volatility, 's');
    assert.deepEqual(metadata.config, ['search_path=""']);

    const anon = rawPsql(`set role anon; select public.visit_transaction_authority_active();`);
    assert.notEqual(anon.status, 0);
    assert.match(`${anon.stderr}\n${anon.stdout}`, /permission denied/i);
    assert.match(asUserError(outsider, `select public.visit_transaction_authority_active();`), /PERMISSION_DENIED/);
    assert.match(asUserError(suspended, `select public.visit_transaction_authority_active();`), /PERMISSION_DENIED/);
    assert.match(asUserError('', `select public.visit_transaction_authority_active();`), /PERMISSION_DENIED/);

    assert.equal(asUser(actorA, `select public.visit_transaction_authority_active();`), 'f');
    assert.equal(asUser(actorB, `select public.visit_transaction_authority_active();`), 't');
    assert.equal(psql(`select transaction_owned::text from private.commercial_entity_authority where organization_id='${orgA}' and entity_type='visit';`), 'false');

    psql(`update private.commercial_entity_authority set transaction_owned=true where organization_id='${orgA}' and entity_type='visit';`);
    assert.equal(asUser(actorA, `select public.visit_transaction_authority_active();`), 't');
    assert.equal(psql(`select count(*) from private.commercial_entity_authority;`), '2');
    assert.equal(psql(`select count(*) from private.commercial_entity_authority where transaction_owned;`), '2');

    psql(`insert into public.organization_members values('${orgB}','${actorA}','active');`);
    assert.match(asUserError(actorA, `select public.visit_transaction_authority_active();`), /PERMISSION_DENIED/);
  } finally {
    docker(['rm', '--force', containerName]);
  }
});
