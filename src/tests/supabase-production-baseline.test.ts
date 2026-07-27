import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const auditPath = 'supabase/audits/b0_2_production_inventory_readonly.sql';
const documentationPath = 'docs/SUPABASE_PRODUCTION_BASELINE.md';
const sql = readFileSync(auditPath, 'utf8');
const documentation = readFileSync(documentationPath, 'utf8');

const preflightBegin = '-- B0.2-A STAGE 1: PREFLIGHT BEGIN';
const preflightEnd = '-- B0.2-A STAGE 1: PREFLIGHT END';
const inventoryBegin = '-- B0.2-A STAGE 2: INVENTORY BEGIN';
const inventoryEnd = '-- B0.2-A STAGE 2: INVENTORY END';

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
}

const preflightSql = between(sql, preflightBegin, preflightEnd);
const inventorySql = between(sql, inventoryBegin, inventoryEnd);
const executableSql = stripSqlCommentsAndStrings(sql);
const executablePreflight = stripSqlCommentsAndStrings(preflightSql);
const executableInventory = stripSqlCommentsAndStrings(inventorySql);

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
  assert.match(auditPath, /^supabase\/audits\//);
  assert.doesNotMatch(auditPath, /^supabase\/migrations\//);
});

test('contiene exactamente dos etapas y dos sentencias SELECT', () => {
  assert.equal((executableSql.match(/;/g) ?? []).length, 2);
  assert.equal((executablePreflight.match(/;/g) ?? []).length, 1);
  assert.equal((executableInventory.match(/;/g) ?? []).length, 1);
  assert.match(executablePreflight.trim(), /^with\b/i);
  assert.match(executableInventory.trim(), /^with\b/i);
});

test('ambas etapas son estrictamente de solo lectura y sin SQL dinámico', () => {
  assertReadOnly(preflightSql);
  assertReadOnly(inventorySql);
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
});

test('cubre el inventario estructural completo', () => {
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

test('ETAPA 1 y ETAPA 2 ejecutan en PostgreSQL 17 sin migration history', { timeout: 240_000 }, async (t) => {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    t.skip('La validación efímera PostgreSQL 17 se ejecuta en GitHub Actions.');
    return;
  }

  const { spawnSync } = await import('node:child_process');
  const { randomUUID } = await import('node:crypto');
  const containerName = `b02-optional-history-${randomUUID().slice(0, 8)}`;

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
      { encoding: 'utf8', input, maxBuffer: 20 * 1024 * 1024 },
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

    runPsql(`
      create schema storage;
      create table storage.buckets (
        name text primary key,
        public boolean not null default false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects (id bigint primary key);
      create schema auth;
      create table auth.users (id bigint primary key);
      create schema private;
      insert into storage.buckets(name, public, file_size_limit, allowed_mime_types)
      values ('test-bucket', false, 1048576, array['image/png']);
    `);

    const fingerprintSql = `
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

    const beforeFingerprint = runPsql(fingerprintSql);

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

    const afterFingerprint = runPsql(fingerprintSql);
    assert.equal(afterFingerprint, beforeFingerprint, 'El inventario modificó objetos o datos.');

    console.log(
      `B0.2 PostgreSQL 17 isolated inventory: ${JSON.stringify({
        server_version: serverVersion,
        preflight_safe: preflight.safe_to_run_inventory,
        preflight_warnings: preflight.warnings,
        inventory_row: true,
        migration_history: inventory.migration_history,
        unchanged: afterFingerprint === beforeFingerprint,
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
