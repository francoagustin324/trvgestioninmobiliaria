import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const auditPath = 'supabase/audits/b0_2_production_inventory_readonly.sql';
const documentationPath = 'docs/SUPABASE_PRODUCTION_BASELINE.md';
const p0aAuditPath = 'supabase/audits/p0a_1a_production_inventory_extended_readonly.sql';
const sql = readFileSync(auditPath, 'utf8');
const p0aSql = readFileSync(p0aAuditPath, 'utf8');
const documentation = readFileSync(documentationPath, 'utf8');

const preflightBegin = '-- B0.2-A STAGE 1: PREFLIGHT BEGIN';
const preflightEnd = '-- B0.2-A STAGE 1: PREFLIGHT END';
const inventoryBegin = '-- B0.2-A STAGE 2: INVENTORY BEGIN';
const inventoryEnd = '-- B0.2-A STAGE 2: INVENTORY END';
const p0aPreflightBegin = '-- P0A.1a STAGE 1: PREFLIGHT BEGIN';
const p0aPreflightEnd = '-- P0A.1a STAGE 1: PREFLIGHT END';
const p0aInventoryBegin = '-- P0A.1a STAGE 2: INVENTORY BEGIN';
const p0aInventoryEnd = '-- P0A.1a STAGE 2: INVENTORY END';

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  assert.notEqual(startIndex, -1, `Falta marcador ${start}`);
  assert.notEqual(endIndex, -1, `Falta marcador ${end}`);
  assert.ok(endIndex > startIndex, `Orden inválido entre ${start} y ${end}`);
  return source.slice(startIndex + start.length, endIndex);
}

function stripSqlCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n\r]*/g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
}

function assertContainsEvery(source: string, values: readonly string[]): void {
  for (const value of values) {
    assert.ok(source.includes(value), `Falta cobertura para ${value}`);
  }
}

function assertReadOnly(source: string): void {
  const executable = stripSqlCommentsAndStrings(source);
  const forbidden = [
    'insert',
    'update',
    'delete',
    'merge',
    'create',
    'alter',
    'drop',
    'grant',
    'revoke',
    'do',
    'call',
    'truncate',
    'copy',
    'lock',
    'vacuum',
    'analyze',
    'refresh',
    'comment',
  ] as const;

  for (const keyword of forbidden) {
    assert.doesNotMatch(executable, new RegExp(`\\b${keyword}\\b`, 'i'));
  }

  assert.doesNotMatch(executable, /\bfor\s+(?:no\s+key\s+)?update\b/i);
  assert.doesNotMatch(executable, /\bfor\s+share\b/i);
  assert.doesNotMatch(executable, /\bexecute\b/i);
  assert.doesNotMatch(executable, /\bprepare\b/i);
  assert.doesNotMatch(executable, /\bdeallocate\b/i);
  assert.doesNotMatch(executable, /\bdblink\b/i);
  assert.doesNotMatch(executable, /\bset\s+role\b/i);
  assert.doesNotMatch(executable, /\b(?:enable|disable)\s+row\s+level\s+security\b/i);
}

const preflightSql = between(sql, preflightBegin, preflightEnd);
const inventorySql = between(sql, inventoryBegin, inventoryEnd);
const executableSql = stripSqlCommentsAndStrings(sql);
const executablePreflight = stripSqlCommentsAndStrings(preflightSql);
const executableInventory = stripSqlCommentsAndStrings(inventorySql);
const p0aPreflightSql = between(p0aSql, p0aPreflightBegin, p0aPreflightEnd);
const p0aInventorySql = between(p0aSql, p0aInventoryBegin, p0aInventoryEnd);
const executableP0aSql = stripSqlCommentsAndStrings(p0aSql);
const executableP0aPreflight = stripSqlCommentsAndStrings(p0aPreflightSql);
const executableP0aInventory = stripSqlCommentsAndStrings(p0aInventorySql);

const requiredTables = [
  'public.organizations',
  'public.organization_members',
  'public.fichas',
  'public.propcontrol_records',
  'public.public_property_fichas',
] as const;

const requiredFunctions = [
  'private.is_active_org_member',
  'private.org_member_role',
  'private.org_member_number',
  'private.can_access_property_photo',
  'public.activate_my_organization_memberships',
  'public.is_org_member',
  'public.can_manage_public_property_ficha',
  'public.handle_new_propcontrol_user',
  'public.protect_propcontrol_record_identity',
] as const;

const requiredInventoryKeys = [
  'check',
  'read_only',
  'generated_at',
  'server_version',
  'preflight_revalidated',
  'schemas',
  'tables',
  'functions',
  'triggers',
  'rls',
  'policies',
  'grants',
  'storage_buckets',
  'migration_history',
  'expected_objects_missing',
  'warnings',
  'blocking_findings',
] as const;

test('el artefacto permanece fuera de supabase/migrations', () => {
  for (const path of [auditPath, p0aAuditPath]) {
    assert.match(path, /^supabase\/audits\//);
    assert.doesNotMatch(path, /^supabase\/migrations\//);
  }
});

test('contiene exactamente dos etapas y dos sentencias SELECT', () => {
  assert.equal((executableSql.match(/;/g) ?? []).length, 2);
  assert.equal((executablePreflight.match(/;/g) ?? []).length, 1);
  assert.equal((executableInventory.match(/;/g) ?? []).length, 1);
  assert.match(executablePreflight.trim(), /^with\b/i);
  assert.match(executableInventory.trim(), /^with\b/i);

  assert.equal((executableP0aSql.match(/;/g) ?? []).length, 2);
  assert.equal((executableP0aPreflight.match(/;/g) ?? []).length, 1);
  assert.equal((executableP0aInventory.match(/;/g) ?? []).length, 1);
  assert.match(executableP0aPreflight.trim(), /^with\b/i);
  assert.match(executableP0aInventory.trim(), /^with\b/i);
});

test('ambas etapas son estrictamente de solo lectura y sin SQL dinámico', () => {
  assertReadOnly(preflightSql);
  assertReadOnly(inventorySql);
  assertReadOnly(p0aPreflightSql);
  assertReadOnly(p0aInventorySql);
});


test('no califica construcciones especiales como funciones de pg_catalog', () => {
  for (const specialForm of ['coalesce', 'greatest', 'least', 'nullif'] as const) {
    assert.doesNotMatch(
      sql,
      new RegExp(`\\bpg_catalog\\.${specialForm}\\b`, 'i'),
      `Construcción especial calificada incorrectamente: pg_catalog.${specialForm}`,
    );
  }
});

test('el preflight usa únicamente pg_catalog como fuente física', () => {
  const qualifiedRelations = [
    ...executablePreflight.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi),
  ].map((match) => match[1]);

  assert.ok(qualifiedRelations.length > 0);
  for (const relation of qualifiedRelations) {
    assert.ok(relation?.toLowerCase().startsWith('pg_catalog.'));
  }
  assert.doesNotMatch(executablePreflight, /\b(?:from|join)\s+(?:storage|auth|public|private|supabase_migrations)\./i);

  const p0aQualifiedRelations = [
    ...executableP0aPreflight.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi),
  ].map((match) => match[1]);
  assert.ok(p0aQualifiedRelations.length > 0);
  for (const relation of p0aQualifiedRelations) {
    assert.ok(relation?.toLowerCase().startsWith('pg_catalog.'));
  }
  assert.doesNotMatch(executableP0aPreflight, /\b(?:from|join)\s+(?:storage|auth|public|private|supabase_migrations)\./i);
});

test('migration history es opcional y no bloquea safe_to_run_inventory', () => {
  assert.match(preflightSql, /\('supabase_migrations'::text,\s*false\)/i);
  assert.match(
    preflightSql,
    /\('supabase_migrations'::text,\s*'schema_migrations'::text,\s*false\)/i,
  );
  assert.match(
    preflightSql,
    /\('supabase_migrations'::text,\s*'schema_migrations'::text,\s*'version'::text,\s*false\)/i,
  );
  assert.match(preflightSql, /migration history unavailable/i);
  assert.match(preflightSql, /'warnings'/i);
  assert.match(preflightSql, /'safe_to_run_inventory'/i);
});

test('la etapa 2 no depende físicamente de schema_migrations', () => {
  assert.doesNotMatch(
    executableInventory,
    /\b(?:from|join)\s+supabase_migrations\.schema_migrations\b/i,
  );
  assert.doesNotMatch(executableInventory, /\bto_regclass\s*\(\s*'supabase_migrations/i);
  assert.match(inventorySql, /migration_source_status\s+as\s*\(/i);
});

test('migration_history define el resultado unavailable requerido', () => {
  assertContainsEvery(inventorySql, [
    "'source_available', false",
    "'status', 'unavailable'",
    "'registered_versions', '[]'::jsonb",
    "'missing_expected_versions', '[]'::jsonb",
    "'unrecognized_versions', '[]'::jsonb",
    "'warning', 'supabase_migrations.schema_migrations is not available in this production database'",
  ]);
});

test('no consulta filas sensibles, comerciales ni archivos', () => {
  assert.doesNotMatch(executableSql, /\b(?:from|join)\s+auth\.users\b/i);
  assert.doesNotMatch(executableSql, /\b(?:from|join)\s+storage\.objects\b/i);
  for (const tableName of requiredTables) {
    const escaped = tableName.replace('.', '\\.');
    assert.doesNotMatch(executableSql, new RegExp(`\\b(?:from|join)\\s+${escaped}\\b`, 'i'));
  }

  assert.doesNotMatch(executableP0aSql, /\b(?:from|join)\s+auth\.users\b/i);
  assert.doesNotMatch(executableP0aSql, /\b(?:from|join)\s+storage\.objects\b/i);
  assert.doesNotMatch(executableP0aSql, /\b(?:from|join)\s+private\.commercial_operations\b/i);
  assert.match(executableP0aInventory, /\bfrom\s+storage\.buckets\b/i);
});

test('cubre el inventario estructural completo', () => {
  assert.match(
    p0aPreflightSql,
    /current_setting\('server_version_num'\)::integer\s*>=\s*170000[\s\S]*?<\s*180000/i,
  );
  assert.match(p0aPreflightSql, /'PostgreSQL 17\.x'/i);
  assert.doesNotMatch(p0aSql, /pg_get_function_arguments\s*\(/i);
  assert.match(p0aInventorySql, /pg_get_function_identity_arguments\s*\(/i);
  assert.match(p0aInventorySql, /'arguments',\s*function_info\.identity_arguments/i);
  assertContainsEvery(inventorySql, requiredTables.map((value) => value.split('.')[1] ?? value));
  assertContainsEvery(inventorySql, requiredFunctions.map((value) => value.split('.')[1] ?? value));
  assertContainsEvery(inventorySql, [
    'pg_attribute',
    'pg_attrdef',
    'pg_constraint',
    'pg_index',
    'pg_policy',
    'pg_trigger',
    'pg_depend',
    'table_grants',
    'function_grants',
    'storage_objects_policies',
    'on_propcontrol_user_created',
    'profile-avatars',
    'public.user_profiles',
    'public.organization_settings',
  ]);
  assertContainsEvery(inventorySql, requiredInventoryKeys.map((key) => `'${key}'`));
  assert.match(inventorySql, /as\s+b0_2_production_inventory\b/i);

  assertContainsEvery(p0aInventorySql, [
    'pg_extension',
    'pg_available_extensions',
    'pg_type',
    'pg_enum',
    'pg_sequence',
    'commercial_operations',
    'idempotency_surface',
    'operation_id',
    'request_hash',
    'cas_revision',
    'auth_metadata',
    'storage_buckets',
    'external_integrations',
    'pg_cron',
    'pg_net',
    'triggers',
    'rls',
    'policies',
    'grants',
    'migration_surface',
    'classification_hint',
  ]);
  assert.match(p0aPreflightSql, /'safe_to_run_inventory'/i);
  assert.match(p0aPreflightSql, /required inspection capability is absent/i);
});

test('no ejecuta las funciones inspeccionadas', () => {
  for (const qualifiedName of requiredFunctions) {
    const escaped = qualifiedName.replace('.', '\\.');
    assert.doesNotMatch(executableInventory, new RegExp(`\\b${escaped}\\s*\\(`, 'i'));
  }
});

test('protege acldefault cuando owner_oid es nulo', () => {
  assert.match(
    inventorySql,
    /table_acl_source[\s\S]*?relation_oid\s+is\s+null\s+or\s+table_info\.owner_oid\s+is\s+null[\s\S]*?then\s+null::aclitem\[\][\s\S]*?acldefault\('r'/i,
  );
  assert.match(
    inventorySql,
    /function_acl_source[\s\S]*?function_oid\s+is\s+null\s+or\s+function_info\.owner_oid\s+is\s+null[\s\S]*?then\s+null::aclitem\[\][\s\S]*?acldefault\('f'/i,
  );
});

test('la documentación refleja la ausencia real del historial técnico', () => {
  assert.match(documentation, /^# PRELIMINAR\b/m);
  assert.match(documentation, /producción no expone `supabase_migrations`/i);
  assert.match(documentation, /no implica que las migraciones no se hayan aplicado/i);
  assert.match(documentation, /`unavailable`/i);
  assert.match(documentation, /esquema real/i);
  assert.match(documentation, /no se debe inventar ni crear el historial faltante/i);
  assert.match(documentation, /no es una migración ejecutable/i);
});

test('ETAPA 1/2 B0.2 y P0A.1a se validan read-only en PostgreSQL 17 aislado', { timeout: 300_000 }, async (t) => {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    t.skip('La validación efímera PostgreSQL 17 se ejecuta en GitHub Actions.');
    return;
  }

  const { spawnSync } = await import('node:child_process');
  const { createHash, randomUUID } = await import('node:crypto');
  const containerName = `p0a-inventory-${randomUUID().slice(0, 8)}`;

  const runPsql = (input: string): string => {
    const execution = spawnSync(
      'docker',
      [
        'exec',
        '-i',
        containerName,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-X',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      { encoding: 'utf8', input, maxBuffer: 50 * 1024 * 1024 },
    );
    assert.equal(execution.status, 0, execution.stderr || execution.stdout);
    return execution.stdout.trim();
  };

  const parseLastJson = (output: string): Record<string, unknown> => {
    const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    assert.ok(lines.length > 0, 'La consulta no devolvió filas.');
    const lastLine = lines.at(-1);
    assert.ok(lastLine);
    return JSON.parse(lastLine) as Record<string, unknown>;
  };

  const schemaFingerprint = (): string => {
    const dump = spawnSync(
      'docker',
      [
        'exec',
        containerName,
        'pg_dump',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '--schema-only',
        '--no-owner',
        '--no-comments',
        '--restrict-key=P0A1AREADONLY',
      ],
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
    );
    assert.equal(dump.status, 0, dump.stderr || dump.stdout);
    return createHash('sha256').update(dump.stdout).digest('hex');
  };

  const lineFor = (output: string, section: string, identity: string): string =>
    output.split(/\r?\n/).find((line) => {
      const fields = line.split('|');
      return fields[0] === section && fields[4] === identity;
    }) ?? '';

  const started = spawnSync(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      containerName,
      '--env',
      'POSTGRES_PASSWORD=postgres',
      'postgres:17',
    ],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );
  assert.equal(started.status, 0, started.stderr || started.stdout);

  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const readiness = spawnSync(
        'docker',
        ['exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'postgres'],
        { encoding: 'utf8' },
      );
      if (readiness.status === 0) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    assert.equal(ready, true, 'PostgreSQL 17 no quedó disponible dentro del plazo.');

    const serverVersion = runPsql('show server_version;');
    assert.match(serverVersion, /^17(?:\.|$)/);

    // Minimal Supabase-compatible fixture. All mutations below are fixture-only.
    runPsql(`
      create schema storage;
      create table storage.buckets (
        name text primary key,
        public boolean not null default false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects (
        id uuid primary key,
        bucket_id text,
        name text
      );

      create schema auth;
      create table auth.users (
        id uuid primary key,
        email text
      );

      create schema private;

      insert into storage.buckets(name, public, file_size_limit, allowed_mime_types)
      values ('test-bucket', false, 1048576, array['image/png']);
    `);

    const b02FingerprintSql = `
      select md5(
        coalesce((
          select string_agg(
            concat_ws('|', namespace.nspname, relation.relname, relation.relkind::text,
              attribute.attnum::text, attribute.attname,
              pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)),
            E'\\n' order by namespace.nspname, relation.relname, attribute.attnum
          )
          from pg_catalog.pg_namespace as namespace
          join pg_catalog.pg_class as relation on relation.relnamespace = namespace.oid
          left join pg_catalog.pg_attribute as attribute
            on attribute.attrelid = relation.oid
           and attribute.attnum > 0
           and not attribute.attisdropped
          where namespace.nspname in ('public', 'private', 'auth', 'storage')
        ), '')
        || '|' || (select count(*)::text from storage.buckets)
        || '|' || (select count(*)::text from storage.objects)
        || '|' || (select count(*)::text from auth.users)
        || '|' || coalesce((select string_agg(name || ':' || public::text, ',' order by name) from storage.buckets), '')
      );
    `;

    const b02BeforeFingerprint = runPsql(b02FingerprintSql);

    const preflight = parseLastJson(runPsql(preflightSql));
    assert.equal(preflight.read_only, true);
    assert.equal(preflight.catalog_only, true);
    assert.equal(preflight.safe_to_run_inventory, true);
    assert.deepEqual(preflight.blocking_findings, []);
    const preflightWarnings = preflight.warnings;
    assert.ok(Array.isArray(preflightWarnings));
    assert.ok(preflightWarnings.includes('migration history unavailable'));

    const inventory = parseLastJson(runPsql(inventorySql));
    assert.equal(inventory.read_only, true);
    assert.equal(inventory.preflight_revalidated, true);
    assert.ok(Array.isArray(inventory.tables));
    assert.ok(Array.isArray(inventory.functions));
    assert.deepEqual(inventory.migration_history, {
      source_available: false,
      status: 'unavailable',
      registered_versions: [],
      missing_expected_versions: [],
      unrecognized_versions: [],
      warning: 'supabase_migrations.schema_migrations is not available in this production database',
    });

    const b02AfterFingerprint = runPsql(b02FingerprintSql);
    assert.equal(b02AfterFingerprint, b02BeforeFingerprint, 'B0.2 modificó objetos o datos.');

    // P0A.1a A — safe preflight.
    const p0aSafe = parseLastJson(runPsql(p0aPreflightSql));
    assert.equal(p0aSafe.read_only, true);
    assert.equal(p0aSafe.catalog_first, true);
    assert.equal(p0aSafe.safe_to_run_inventory, true);
    assert.deepEqual(p0aSafe.blocking_findings, []);
    assert.match(String(p0aSafe.server_version), /^17(?:\.|$)/);

    // P0A.1a B — fail closed when a critical inspection dependency is absent.
    runPsql('drop table storage.objects;');
    const p0aBlocked = parseLastJson(runPsql(p0aPreflightSql));
    assert.equal(p0aBlocked.safe_to_run_inventory, false);
    assert.ok(Array.isArray(p0aBlocked.blocking_findings));
    assert.ok((p0aBlocked.blocking_findings as unknown[]).length > 0);
    assert.match(JSON.stringify(p0aBlocked.blocking_findings), /storage\.objects/i);
    runPsql(`
      create table storage.objects (
        id uuid primary key,
        bucket_id text,
        name text
      );
    `);

    // Rich fixture proving metadata coverage without relying on production.
    runPsql(`
      create role p0a_app nologin;
      create extension if not exists pgcrypto;

      create type public.p0a_state as enum ('ready', 'done');
      create domain public.p0a_positive_int as integer check (value > 0);
      create type public.p0a_pair as (key text, value bigint);

      create sequence private.p0a_recovery_seq start with 10 increment by 5;
      create table private.p0a_sequence_owner (
        id bigint not null default nextval('private.p0a_recovery_seq')
      );
      alter sequence private.p0a_recovery_seq owned by private.p0a_sequence_owner.id;

      create table public.p0a_identity_fixture (
        id bigint generated always as identity primary key,
        label text not null
      );

      insert into auth.users(id, email)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'p0a-private@example.test');

      create table private.commercial_operations (
        operation_id uuid primary key,
        operation_type text not null,
        status text not null,
        request_hash text not null,
        actor_user_id uuid references auth.users(id),
        entity_uid uuid not null,
        revision bigint not null default 0,
        completed_at timestamptz,
        unique (operation_type, request_hash)
      );
      create index p0a_commercial_operations_entity_revision_idx
        on private.commercial_operations(entity_uid, revision);
      alter table private.commercial_operations enable row level security;
      grant usage on schema private to p0a_app;
      grant select on private.commercial_operations to p0a_app;
      create policy p0a_commercial_operations_select
        on private.commercial_operations
        for select
        to p0a_app
        using (true);

      create or replace function private.p0a_audit_helper()
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $function$
        select true
      $function$;
      revoke all on function private.p0a_audit_helper() from public;
      grant execute on function private.p0a_audit_helper() to p0a_app;

      create or replace function public.client_snapshot_cas_v2(
        target_org uuid,
        expected_revision bigint
      )
      returns bigint
      language sql
      volatile
      security definer
      set search_path = ''
      as $function$
        select expected_revision + 1
      $function$;
      revoke all on function public.client_snapshot_cas_v2(uuid, bigint) from public;
      grant execute on function public.client_snapshot_cas_v2(uuid, bigint) to p0a_app;

      create or replace function public.commercial_visit_mutation_v2(
        target_org uuid,
        entity_uid uuid,
        operation_id uuid,
        expected_revision bigint
      )
      returns bigint
      language sql
      volatile
      security definer
      set search_path = ''
      as $function$
        select expected_revision + 1
      $function$;
      revoke all on function public.commercial_visit_mutation_v2(uuid, uuid, uuid, bigint) from public;
      grant execute on function public.commercial_visit_mutation_v2(uuid, uuid, uuid, bigint) to p0a_app;

      create table public.p0a_crm_fixture (
        id bigint generated by default as identity primary key,
        organization_id uuid not null,
        secret_note text,
        touched_at timestamptz
      );
      alter table public.p0a_crm_fixture enable row level security;
      grant select on public.p0a_crm_fixture to p0a_app;
      create policy p0a_crm_select
        on public.p0a_crm_fixture
        for select
        to p0a_app
        using (true);

      create or replace function public.p0a_touch()
      returns trigger
      language plpgsql
      security invoker
      set search_path = ''
      as $function$
      begin
        new.touched_at := pg_catalog.clock_timestamp();
        return new;
      end
      $function$;
      create trigger p0a_touch_before_insert
        before insert on public.p0a_crm_fixture
        for each row
        execute function public.p0a_touch();

      insert into public.p0a_crm_fixture(organization_id, secret_note)
      values (
        '11111111-1111-4111-8111-111111111111',
        'P0A_PII_SENTINEL_CLIENT_NOTE_DO_NOT_LEAK'
      );

      alter table storage.objects enable row level security;
      grant usage on schema storage to p0a_app;
      grant select on storage.objects to p0a_app;
      create policy p0a_storage_select
        on storage.objects
        for select
        to p0a_app
        using (true);

      insert into storage.buckets(name, public, file_size_limit, allowed_mime_types)
      values ('property-photos', false, 5242880, array['image/jpeg', 'image/png']);

      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations (
        version text primary key
      );
    `);

    const extensions = runPsql(`
      select extname from pg_catalog.pg_extension order by extname;
    `);
    assert.match(extensions, /plpgsql/);
    assert.match(extensions, /pgcrypto/);

    // Absent detection for integration surfaces; no cron/job or pg_net objects exist yet.
    const absentIntegrationInventory = runPsql(p0aInventorySql);
    const cronAbsent = lineFor(absentIntegrationInventory, 'external_integrations', 'pg_cron');
    const netAbsent = lineFor(absentIntegrationInventory, 'external_integrations', 'pg_net');
    assert.match(cronAbsent, /"schema_exists": false/);
    assert.match(cronAbsent, /"relation_exists": false/);
    assert.match(netAbsent, /"schema_exists": false/);
    assert.match(netAbsent, /"function_present": false/);
    assert.doesNotMatch(absentIntegrationInventory, /P0A_PII_SENTINEL_CLIENT_NOTE_DO_NOT_LEAK/);
    assert.doesNotMatch(absentIntegrationInventory, /p0a-private@example\.test/);

    // Simulated catalog surfaces for present detection. They do not execute jobs/network calls.
    runPsql(`
      create schema cron;
      create table cron.job (
        jobid bigint primary key,
        schedule text,
        command text
      );

      create schema net;
      create or replace function net.http_post(url text)
      returns bigint
      language sql
      volatile
      security invoker
      set search_path = ''
      as $function$
        select 1::bigint
      $function$;

      create or replace function public.p0a_webhook_probe()
      returns trigger
      language plpgsql
      security invoker
      set search_path = ''
      as $function$
      begin
        perform net.http_post('https://example.invalid/p0a-fixture');
        return new;
      end
      $function$;

      create trigger p0a_webhook_after_update
        after update on public.p0a_crm_fixture
        for each row
        execute function public.p0a_webhook_probe();
    `);

    const dataFingerprintSql = `
      select md5(
        (select count(*)::text from auth.users)
        || '|' || coalesce((select string_agg(id::text || ':' || email, ',' order by id) from auth.users), '')
        || '|' || (select count(*)::text from public.p0a_crm_fixture)
        || '|' || coalesce((select string_agg(id::text || ':' || secret_note, ',' order by id) from public.p0a_crm_fixture), '')
        || '|' || (select count(*)::text from private.commercial_operations)
        || '|' || (select count(*)::text from storage.objects)
        || '|' || coalesce((select string_agg(name || ':' || public::text, ',' order by name) from storage.buckets), '')
      );
    `;

    const schemaBefore = schemaFingerprint();
    const dataBefore = runPsql(dataFingerprintSql);

    // P0A.1a C/D/E — read-only, no PII, deterministic output.
    const extendedOne = runPsql(p0aInventorySql);
    const extendedTwo = runPsql(p0aInventorySql);
    assert.equal(extendedTwo, extendedOne, 'P0A.1a debe ser determinista sobre el mismo schema.');

    assert.doesNotMatch(extendedOne, /P0A_PII_SENTINEL_CLIENT_NOTE_DO_NOT_LEAK/);
    assert.doesNotMatch(extendedOne, /p0a-private@example\.test/);

    assert.match(extendedOne, /p0a_state/);
    assert.match(extendedOne, /p0a_positive_int/);
    assert.match(extendedOne, /p0a_pair/);
    assert.match(extendedOne, /p0a_recovery_seq/);
    assert.match(extendedOne, /p0a_identity_fixture/);
    assert.match(extendedOne, /private\.commercial_operations/);
    assert.match(extendedOne, /commercial_operations_idempotency/);
    assert.match(extendedOne, /client_snapshot_cas_v2/);
    assert.match(extendedOne, /commercial_visit_mutation_v2/);
    assert.match(extendedOne, /"security": "definer"/);
    assert.match(extendedOne, /p0a_crm_select/);
    assert.match(extendedOne, /p0a_storage_select/);
    assert.match(extendedOne, /p0a_touch_before_insert/);
    assert.match(extendedOne, /p0a_webhook_after_update/);
    assert.match(extendedOne, /supabase_migrations\.schema_migrations/);

    const cronPresent = lineFor(extendedOne, 'external_integrations', 'pg_cron');
    const netPresent = lineFor(extendedOne, 'external_integrations', 'pg_net');
    assert.match(cronPresent, /"schema_exists": true/);
    assert.match(cronPresent, /"relation_exists": true/);
    assert.match(netPresent, /"schema_exists": true/);
    assert.match(netPresent, /"function_present": true/);

    const schemaAfter = schemaFingerprint();
    const dataAfter = runPsql(dataFingerprintSql);
    assert.equal(schemaAfter, schemaBefore, 'P0A.1a modificó el schema.');
    assert.equal(dataAfter, dataBefore, 'P0A.1a modificó datos.');

    console.log(
      `P0A.1a PostgreSQL 17 isolated inventory: ${JSON.stringify({
        server_version: serverVersion,
        preflight_safe: p0aSafe.safe_to_run_inventory,
        fail_closed: p0aBlocked.safe_to_run_inventory === false,
        extensions: true,
        types: true,
        sequences_identity: true,
        commercial_operations: true,
        cas_revision: true,
        auth_metadata: true,
        storage_metadata: true,
        cron_pgnet_absent_present: true,
        no_pii: true,
        deterministic: extendedOne === extendedTwo,
        schema_unchanged: schemaAfter === schemaBefore,
        data_unchanged: dataAfter === dataBefore,
      })}`,
    );
  } finally {
    spawnSync('docker', ['rm', '--force', containerName], { encoding: 'utf8' });
  }
});

test('no existe una migración baseline ejecutable de B0.2', () => {
  const migrationFiles = readdirSync('supabase/migrations');
  const forbiddenMigration = migrationFiles.find((fileName) =>
    /b0[_-]?2|baseline|production[_-]?inventory/i.test(fileName),
  );
  assert.equal(forbiddenMigration, undefined);
});
