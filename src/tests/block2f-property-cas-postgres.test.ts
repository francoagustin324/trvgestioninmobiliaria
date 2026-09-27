import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/20260926224500_block2f_property_snapshot_cas.sql', 'utf8');

function jsonSql(value: unknown): string {
  return `$json$${JSON.stringify(value)}$json$::jsonb`;
}

class PsqlSession {
  readonly child: ChildProcessWithoutNullStreams;
  stdout = '';
  stderr = '';
  private readonly waiters = new Map<string, Array<() => void>>();

  constructor(containerName: string) {
    this.child = spawn('docker', [
      'exec', '-i', containerName,
      'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t',
    ]);
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.stdout += chunk;
      for (const [marker, callbacks] of this.waiters) {
        if (!this.stdout.includes(marker)) continue;
        this.waiters.delete(marker);
        callbacks.forEach((callback) => callback());
      }
    });
    this.child.stderr.on('data', (chunk: string) => { this.stderr += chunk; });
  }

  send(sql: string): void {
    this.child.stdin.write(sql.endsWith('\n') ? sql : sql + '\n');
  }

  async waitFor(marker: string, timeoutMs = 15000): Promise<void> {
    if (this.stdout.includes(marker)) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(
        `Timeout esperando ${marker}. stdout=${this.stdout} stderr=${this.stderr}`,
      )), timeoutMs);
      const callback = () => {
        clearTimeout(timer);
        resolve();
      };
      const callbacks = this.waiters.get(marker) ?? [];
      callbacks.push(callback);
      this.waiters.set(marker, callbacks);
    });
  }

  async close(): Promise<number | null> {
    if (!this.child.stdin.destroyed) this.child.stdin.end();
    if (this.child.exitCode !== null) return this.child.exitCode;
    return new Promise((resolve) => this.child.once('close', resolve));
  }
}

test('2F PostgreSQL 17: Property CAS evita lost update, resurrección y lock global', { timeout: 300_000 }, async () => {
  const containerName = `block2f-${randomUUID().slice(0, 8)}`;
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';
  const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const docker = (args: string[]) => spawnSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 40 * 1024 * 1024,
  });
  const rawPsql = (sql: string) => spawnSync(
    'docker',
    ['exec', '-i', containerName, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
    { encoding: 'utf8', input: sql, maxBuffer: 40 * 1024 * 1024 },
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
  const propertyRequest = (
    uid: string,
    id: number,
    expectedRevision: number,
    price: number,
    action: 'insert' | 'update' = 'update',
  ) => ({
    action,
    property: { uid },
    expectedRevision,
    payload: {
      id,
      uid,
      revision: expectedRevision,
      title: `Property ${id}`,
      address: 'Docta, Córdoba',
      type: 'Dúplex',
      operation: 'Venta',
      price,
      owner: 'Sintético',
      status: 'Activa',
      assignedToId: 1,
      createdById: 1,
    },
    assignedMemberId: 1,
  });
  const rpc = (org: string, request: unknown) =>
    `select public.property_snapshot_cas_v1('${org}'::uuid, ${jsonSql(request)}, false);`;

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
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(healthy, true, 'PostgreSQL 17 no quedó healthy.');
    assert.match(psql('show server_version;'), /^17(?:\.|$)/);

    psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema auth;
      create schema private;
      grant usage on schema public, private, auth to authenticated;

      create function auth.uid() returns uuid
      language sql stable security invoker set search_path = ''
      as $f$ select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid $f$;

      create function private.visit_normalized(value text) returns text
      language sql immutable security invoker set search_path = ''
      as $f$ select pg_catalog.lower(coalesce(value, '')) $f$;

      grant execute on function auth.uid() to authenticated;
      grant execute on function private.visit_normalized(text) to authenticated;

      create table public.organization_members (
        organization_id uuid not null,
        user_id uuid not null,
        member_id bigint not null,
        role text not null,
        status text not null,
        primary key (organization_id, user_id),
        unique (organization_id, member_id)
      );

      create table public.propcontrol_records (
        organization_id uuid not null,
        entity_type text not null,
        entity_key text not null,
        assigned_member_id bigint,
        payload jsonb not null default '{}'::jsonb,
        created_by uuid not null,
        uid uuid,
        revision bigint not null default 0,
        created_at timestamptz not null default pg_catalog.now(),
        updated_at timestamptz not null default pg_catalog.now(),
        primary key (organization_id, entity_type, entity_key)
      );

      grant select on public.organization_members to authenticated;
      grant select, insert, update, delete on public.propcontrol_records to authenticated;

      alter table public.propcontrol_records enable row level security;
      create policy block2f_records_select on public.propcontrol_records
        for select to authenticated using (
          exists (
            select 1 from public.organization_members m
            where m.organization_id = propcontrol_records.organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
          )
        );
      create policy block2f_records_insert on public.propcontrol_records
        for insert to authenticated with check (
          created_by = auth.uid()
          and exists (
            select 1 from public.organization_members m
            where m.organization_id = propcontrol_records.organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
          )
        );
      create policy block2f_records_update on public.propcontrol_records
        for update to authenticated using (
          exists (
            select 1 from public.organization_members m
            where m.organization_id = propcontrol_records.organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
          )
        ) with check (
          exists (
            select 1 from public.organization_members m
            where m.organization_id = propcontrol_records.organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
          )
        );
      create policy block2f_records_delete on public.propcontrol_records
        for delete to authenticated using (
          exists (
            select 1 from public.organization_members m
            where m.organization_id = propcontrol_records.organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
          )
        );

      insert into public.organization_members values
        ('${orgA}', '${ownerA}', 1, 'owner', 'active'),
        ('${orgB}', '${ownerB}', 1, 'owner', 'active');
    `);

    psql(migration);

    assert.equal(psql(`
      select p.prosecdef::text || '|' || pg_catalog.coalesce(p.proconfig::text, '')
      from pg_catalog.pg_proc p
      where p.oid='public.property_snapshot_cas_v1(uuid,jsonb,boolean)'::pg_catalog.regprocedure;
    `), 'false|{"search_path=\"\""}');
    assert.equal(psql(`select has_function_privilege('authenticated','public.property_snapshot_cas_v1(uuid,jsonb,boolean)','execute');`), 't');
    assert.equal(psql(`select has_function_privilege('anon','public.property_snapshot_cas_v1(uuid,jsonb,boolean)','execute');`), 'f');

    const uidRace = '10000000-0000-4000-8000-000000000001';
    const uidOther = '10000000-0000-4000-8000-000000000002';
    const uidDelete = '10000000-0000-4000-8000-000000000003';
    const uidTenant = '10000000-0000-4000-8000-000000000004';

    psql(`
      insert into public.propcontrol_records
        (organization_id,entity_type,entity_key,assigned_member_id,payload,created_by,uid,revision)
      values
        ('${orgA}','property','${orgA}:${uidRace}',1,
          ${jsonSql({ id: 1, uid: uidRace, revision: 5, title: 'Race', address: 'Docta', type: 'Dúplex', operation: 'Venta', price: 110000, owner: 'Sintético', status: 'Activa', assignedToId: 1, createdById: 1 })},
          '${ownerA}','${uidRace}',5),
        ('${orgA}','property','${orgA}:${uidOther}',1,
          ${jsonSql({ id: 2, uid: uidOther, revision: 3, title: 'Other', address: 'Docta', type: 'Dúplex', operation: 'Venta', price: 90000, owner: 'Sintético', status: 'Activa', assignedToId: 1, createdById: 1 })},
          '${ownerA}','${uidOther}',3),
        ('${orgA}','property','${orgA}:${uidDelete}',1,
          ${jsonSql({ id: 3, uid: uidDelete, revision: 2, title: 'Delete', address: 'Docta', type: 'Dúplex', operation: 'Venta', price: 80000, owner: 'Sintético', status: 'Activa', assignedToId: 1, createdById: 1 })},
          '${ownerA}','${uidDelete}',2),
        ('${orgA}','property','${orgA}:${uidTenant}',1,
          ${jsonSql({ id: 4, uid: uidTenant, revision: 5, title: 'Tenant A', address: 'Docta', type: 'Dúplex', operation: 'Venta', price: 70000, owner: 'Sintético', status: 'Activa', assignedToId: 1, createdById: 1 })},
          '${ownerA}','${uidTenant}',5),
        ('${orgB}','property','${orgB}:${uidTenant}',1,
          ${jsonSql({ id: 4, uid: uidTenant, revision: 5, title: 'Tenant B', address: 'Docta', type: 'Dúplex', operation: 'Venta', price: 71000, owner: 'Sintético', status: 'Activa', assignedToId: 1, createdById: 1 })},
          '${ownerB}','${uidTenant}',5);
    `);

    // Dos writers parten de revision=5. A mantiene el row lock hasta que B ya inició su CAS.
    const a = new PsqlSession(containerName);
    a.send(`
      \\set ON_ERROR_STOP on
      begin;
      set role authenticated;
      select pg_catalog.set_config('request.jwt.claim.sub', '${ownerA}', false);
      ${rpc(orgA, propertyRequest(uidRace, 1, 5, 120000))}
      \\echo BLOCK2F_A_LOCKED
    `);
    await a.waitFor('BLOCK2F_A_LOCKED');

    const b = new PsqlSession(containerName);
    b.send(`
      \\set ON_ERROR_STOP off
      set role authenticated;
      select pg_catalog.set_config('request.jwt.claim.sub', '${ownerA}', false);
      \\echo BLOCK2F_B_BEFORE
      ${rpc(orgA, propertyRequest(uidRace, 1, 5, 125000))}
      \\echo BLOCK2F_B_AFTER
      \\q
    `);
    await b.waitFor('BLOCK2F_B_BEFORE');
    a.send('commit; \\q');
    await a.close();
    await b.waitFor('BLOCK2F_B_AFTER');
    await b.close();

    assert.match(a.stdout, /"revision": 6/);
    assert.match(b.stderr, /STALE_REVISION/);
    assert.equal(psql(`select payload->>'price' from public.propcontrol_records where organization_id='${orgA}' and uid='${uidRace}';`), '120000');
    assert.equal(psql(`select revision from public.propcontrol_records where organization_id='${orgA}' and uid='${uidRace}';`), '6');

    // Registros distintos: B completa mientras A mantiene abierta la transacción sobre otra fila.
    const aDifferent = new PsqlSession(containerName);
    aDifferent.send(`
      \\set ON_ERROR_STOP on
      begin;
      set role authenticated;
      select pg_catalog.set_config('request.jwt.claim.sub', '${ownerA}', false);
      ${rpc(orgA, propertyRequest(uidRace, 1, 6, 121000))}
      \\echo BLOCK2F_DIFFERENT_A_LOCKED
    `);
    await aDifferent.waitFor('BLOCK2F_DIFFERENT_A_LOCKED');

    const bDifferent = new PsqlSession(containerName);
    bDifferent.send(`
      \\set ON_ERROR_STOP on
      set role authenticated;
      select pg_catalog.set_config('request.jwt.claim.sub', '${ownerA}', false);
      ${rpc(orgA, propertyRequest(uidOther, 2, 3, 95000))}
      \\echo BLOCK2F_DIFFERENT_B_DONE
      \\q
    `);
    await bDifferent.waitFor('BLOCK2F_DIFFERENT_B_DONE');
    assert.equal(bDifferent.stderr.trim(), '');
    aDifferent.send('commit; \\q');
    await aDifferent.close();
    await bDifferent.close();

    assert.equal(psql(`select payload->>'price' from public.propcontrol_records where organization_id='${orgA}' and uid='${uidOther}';`), '95000');

    // Delete gana; el update stale no puede recrear la fila.
    const deleteA = new PsqlSession(containerName);
    deleteA.send(`
      \\set ON_ERROR_STOP on
      begin;
      set role authenticated;
      select pg_catalog.set_config('request.jwt.claim.sub', '${ownerA}', false);
      ${rpc(orgA, { action: 'delete', property: { uid: uidDelete }, expectedRevision: 2 })}
      \\echo BLOCK2F_DELETE_A_LOCKED
    `);
    await deleteA.waitFor('BLOCK2F_DELETE_A_LOCKED');

    const updateB = new PsqlSession(containerName);
    updateB.send(`
      \\set ON_ERROR_STOP off
      set role authenticated;
      select pg_catalog.set_config('request.jwt.claim.sub', '${ownerA}', false);
      \\echo BLOCK2F_UPDATE_B_BEFORE
      ${rpc(orgA, propertyRequest(uidDelete, 3, 2, 99000))}
      \\echo BLOCK2F_UPDATE_B_AFTER
      \\q
    `);
    await updateB.waitFor('BLOCK2F_UPDATE_B_BEFORE');
    deleteA.send('commit; \\q');
    await deleteA.close();
    await updateB.waitFor('BLOCK2F_UPDATE_B_AFTER');
    await updateB.close();
    assert.match(updateB.stderr, /NOT_FOUND/);
    assert.equal(psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and uid='${uidDelete}';`), '0');

    // Inserts distintos arrancan desde dos sesiones independientes y ambos persisten.
    const insertUidA = '10000000-0000-4000-8000-000000000011';
    const insertUidB = '10000000-0000-4000-8000-000000000012';
    const insertA = new PsqlSession(containerName);
    const insertB = new PsqlSession(containerName);
    insertA.send(`\\set ON_ERROR_STOP on\n\\echo INSERT_A_READY\n`);
    insertB.send(`\\set ON_ERROR_STOP on\n\\echo INSERT_B_READY\n`);
    await Promise.all([insertA.waitFor('INSERT_A_READY'), insertB.waitFor('INSERT_B_READY')]);
    insertA.send(`
      set role authenticated;
      select pg_catalog.set_config('request.jwt.claim.sub', '${ownerA}', false);
      ${rpc(orgA, propertyRequest(insertUidA, 11, 0, 131000, 'insert'))}
      \\echo INSERT_A_DONE
      \\q
    `);
    insertB.send(`
      set role authenticated;
      select pg_catalog.set_config('request.jwt.claim.sub', '${ownerA}', false);
      ${rpc(orgA, propertyRequest(insertUidB, 12, 0, 132000, 'insert'))}
      \\echo INSERT_B_DONE
      \\q
    `);
    await Promise.all([insertA.waitFor('INSERT_A_DONE'), insertB.waitFor('INSERT_B_DONE')]);
    await Promise.all([insertA.close(), insertB.close()]);
    assert.equal(psql(`select count(*) from public.propcontrol_records where organization_id='${orgA}' and uid in ('${insertUidA}','${insertUidB}');`), '2');

    // Tenant A no modifica la fila homónima de Tenant B.
    asUser(ownerA, rpc(orgA, propertyRequest(uidTenant, 4, 5, 76000)));
    assert.equal(psql(`select payload->>'price' from public.propcontrol_records where organization_id='${orgA}' and uid='${uidTenant}';`), '76000');
    assert.equal(psql(`select payload->>'price' from public.propcontrol_records where organization_id='${orgB}' and uid='${uidTenant}';`), '71000');
  } finally {
    docker(['rm', '-f', containerName]);
  }
});
