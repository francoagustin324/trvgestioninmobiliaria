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

const knownMigrationVersions = [
  '20260713',
  '20260715093000',
  '20260716103000',
  '20260716103100',
  '20260717113000',
  '20260717190000',
  '20260724190000',
] as const;

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
    assert.doesNotMatch(
      executable,
      new RegExp(`\\b${keyword}\\b`, 'i'),
      `Operación prohibida: ${keyword}`,
    );
  }

  assert.doesNotMatch(executable, /\bfor\s+(?:no\s+key\s+)?update\b/i);
  assert.doesNotMatch(executable, /\bfor\s+share\b/i);
  assert.doesNotMatch(executable, /\bexecute\b/i);
  assert.doesNotMatch(executable, /\bprepare\b/i);
  assert.doesNotMatch(executable, /\bdeallocate\b/i);
  assert.doesNotMatch(executable, /\bdblink\b/i);
}

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
  assert.match(executablePreflight.trim(), /select[\s\S]*;\s*$/i);
  assert.match(executableInventory.trim(), /select[\s\S]*;\s*$/i);
});

test('el preflight devuelve safe_to_run_inventory en una fila JSONB', () => {
  assert.match(preflightSql, /'safe_to_run_inventory'\s*,\s*safe_to_run_inventory/i);
  assert.match(preflightSql, /as\s+b0_2_production_inventory_preflight\b/i);
  assert.match(preflightSql, /'read_only'\s*,\s*true/i);
  assert.match(preflightSql, /'catalog_only'\s*,\s*true/i);
  assert.match(preflightSql, /from\s+preflight_summary\s*;/i);
});

test('el preflight usa únicamente pg_catalog como fuente física', () => {
  const qualifiedRelations = [
    ...executablePreflight.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi),
  ].map((match) => match[1]);

  assert.ok(qualifiedRelations.length > 0);
  for (const relation of qualifiedRelations) {
    assert.ok(
      relation?.toLowerCase().startsWith('pg_catalog.'),
      `El preflight accede fuera de pg_catalog: ${relation}`,
    );
  }

  assert.doesNotMatch(executablePreflight, /\b(?:from|join)\s+storage\./i);
  assert.doesNotMatch(executablePreflight, /\b(?:from|join)\s+supabase_migrations\./i);
  assert.doesNotMatch(executablePreflight, /\b(?:from|join)\s+auth\./i);
  assert.doesNotMatch(executablePreflight, /\b(?:from|join)\s+public\./i);
  assert.doesNotMatch(executablePreflight, /\b(?:from|join)\s+private\./i);
});

test('el preflight comprueba esquemas, relaciones y columnas indispensables', () => {
  assertContainsEvery(preflightSql, [
    'pg_catalog',
    'public',
    'private',
    'auth',
    'storage',
    'supabase_migrations',
    'buckets',
    'schema_migrations',
    'objects',
    'users',
    'file_size_limit',
    'allowed_mime_types',
    'version',
  ]);
  assert.match(preflightSql, /required_for_inventory/i);
  assert.match(preflightSql, /blocking_findings/i);
  assert.match(preflightSql, /Stop\. Do not execute Stage 2\./i);
});

test('el preflight comprueba catálogos y funciones técnicas necesarias', () => {
  assertContainsEvery(preflightSql, [
    'pg_namespace',
    'pg_class',
    'pg_attribute',
    'pg_attrdef',
    'pg_constraint',
    'pg_index',
    'pg_policy',
    'pg_proc',
    'pg_trigger',
    'pg_depend',
    'pg_roles',
    'pg_type',
    'pg_language',
    'acldefault',
    'aclexplode',
    'format_type',
    'pg_get_expr',
    'pg_get_constraintdef',
    'pg_get_indexdef',
    'pg_get_functiondef',
    'pg_get_triggerdef',
    'pg_describe_object',
  ]);
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

test('ambas etapas son estrictamente de solo lectura y sin SQL dinámico', () => {
  assertReadOnly(preflightSql);
  assertReadOnly(inventorySql);
});

test('la etapa completa exige preflight true y lo revalida', () => {
  assert.match(sql, /EJECUTAR ESTA ETAPA SOLAMENTE SI LA ETAPA 1 DEVOLVIÓ/i);
  assert.match(inventorySql, /inventory_gate\s+as\s*\(/i);
  assert.match(inventorySql, /safe_to_run_inventory/i);
  assert.match(inventorySql, /'preflight_revalidated'\s*,\s*gate\.safe_to_run_inventory/i);
  assert.match(inventorySql, /Stage 2 preflight revalidation failed/i);
  assert.match(inventorySql, /where\s+gate\.safe_to_run_inventory/i);
});

test('table_grants protege acldefault cuando owner_oid es nulo', () => {
  assert.match(
    inventorySql,
    /table_acl_source[\s\S]*?when\s+table_info\.relation_oid\s+is\s+null\s+or\s+table_info\.owner_oid\s+is\s+null[\s\S]*?then\s+null::aclitem\[\][\s\S]*?when\s+table_info\.relacl\s+is\s+null[\s\S]*?then\s+pg_catalog\.acldefault\('r',\s*table_info\.owner_oid\)/i,
  );
  assert.match(inventorySql, /table_grants\s+as\s*\(/i);
});

test('function_grants protege acldefault cuando owner_oid es nulo', () => {
  assert.match(
    inventorySql,
    /function_acl_source[\s\S]*?when\s+function_info\.function_oid\s+is\s+null\s+or\s+function_info\.owner_oid\s+is\s+null[\s\S]*?then\s+null::aclitem\[\][\s\S]*?when\s+function_info\.proacl\s+is\s+null[\s\S]*?then\s+pg_catalog\.acldefault\('f',\s*function_info\.owner_oid\)/i,
  );
  assert.match(inventorySql, /function_grants\s+as\s*\(/i);
});

test('no consulta filas de auth.users, tablas comerciales ni storage.objects', () => {
  assert.doesNotMatch(executableSql, /\b(?:from|join)\s+auth\.users\b/i);
  assert.doesNotMatch(executableSql, /\b(?:from|join)\s+storage\.objects\b/i);

  for (const tableName of requiredTables) {
    const escaped = tableName.replace('.', '\\.');
    assert.doesNotMatch(executableSql, new RegExp(`\\b(?:from|join)\\s+${escaped}\\b`, 'i'));
  }
});

test('no solicita columnas personales, payloads ni secretos', () => {
  const forbiddenDataFields = [
    'email',
    'phone',
    'telephone',
    'whatsapp',
    'first_name',
    'last_name',
    'full_name',
    'client_name',
    'organization_name',
    'payload',
    'access_token',
    'refresh_token',
    'secret',
    'private_url',
  ] as const;

  for (const field of forbiddenDataFields) {
    assert.doesNotMatch(
      executableSql,
      new RegExp(`\\b${field}\\b`, 'i'),
      `Campo sensible detectado: ${field}`,
    );
  }

  assert.doesNotMatch(sql, /sb_secret_|service_role_key|supabase_secret_key/i);
  assert.doesNotMatch(sql, /@[a-z0-9.-]+\.[a-z]{2,}/i);
});

test('el inventario completo cubre tablas, RLS, políticas, restricciones e índices', () => {
  assertContainsEvery(inventorySql, requiredTables.map((value) => value.split('.')[1] ?? value));
  assert.match(inventorySql, /pg_catalog\.pg_attribute/i);
  assert.match(inventorySql, /pg_catalog\.pg_attrdef/i);
  assert.match(inventorySql, /pg_catalog\.pg_constraint/i);
  assert.match(inventorySql, /pg_catalog\.pg_index/i);
  assert.match(inventorySql, /pg_catalog\.pg_policy/i);
  assert.match(inventorySql, /relrowsecurity/i);
  assert.match(inventorySql, /relforcerowsecurity/i);
  assert.match(inventorySql, /primary_keys/i);
  assert.match(inventorySql, /foreign_keys/i);
  assert.match(inventorySql, /table_grants/i);
});

test('el inventario completo cubre funciones sin invocarlas', () => {
  assertContainsEvery(inventorySql, requiredFunctions.map((value) => value.split('.')[1] ?? value));

  for (const qualifiedName of requiredFunctions) {
    const escaped = qualifiedName.replace('.', '\\.');
    assert.doesNotMatch(
      executableInventory,
      new RegExp(`\\b${escaped}\\s*\\(`, 'i'),
      `No debe invocar ${qualifiedName}`,
    );
  }

  assert.match(inventorySql, /pg_catalog\.pg_get_function_identity_arguments/i);
  assert.match(inventorySql, /pg_catalog\.pg_get_function_arguments/i);
  assert.match(inventorySql, /pg_catalog\.pg_get_function_result/i);
  assert.match(inventorySql, /pg_catalog\.pg_get_functiondef/i);
  assert.match(inventorySql, /provolatile/i);
  assert.match(inventorySql, /prosecdef/i);
  assert.match(inventorySql, /proconfig/i);
  assert.match(inventorySql, /execute_grants/i);
  assert.match(inventorySql, /dependencies/i);
});

test('inventaría triggers y el trigger técnico de auth.users desde catálogos', () => {
  assert.match(inventorySql, /pg_catalog\.pg_trigger/i);
  assert.match(inventorySql, /pg_catalog\.pg_get_triggerdef/i);
  assert.match(inventorySql, /on_propcontrol_user_created/i);
  assert.match(inventorySql, /linked_function/i);
  assert.match(inventorySql, /enabled_state/i);
  assert.match(inventorySql, /timing/i);
  assert.match(inventorySql, /events/i);
});

test('inventaría metadata de buckets sin listar archivos', () => {
  assert.match(inventorySql, /from\s+storage\.buckets\s+as\s+bucket/i);
  assert.match(inventorySql, /file_size_limit/i);
  assert.match(inventorySql, /allowed_mime_types/i);
  assert.match(inventorySql, /storage_objects_policies/i);
  assert.doesNotMatch(executableInventory, /\b(?:from|join)\s+storage\.objects\b/i);
});

test('inventaría historial técnico y objetos previstos', () => {
  assert.match(inventorySql, /from\s+supabase_migrations\.schema_migrations/i);
  assertContainsEvery(inventorySql, knownMigrationVersions);
  assert.match(inventorySql, /'empty'/i);
  assert.match(inventorySql, /'incomplete'/i);
  assert.match(inventorySql, /'present'/i);
  assert.match(inventorySql, /missing_expected_versions/i);
  assert.match(inventorySql, /unrecognized_versions/i);
  assert.match(inventorySql, /public\.user_profiles/i);
  assert.match(inventorySql, /public\.organization_settings/i);
  assert.match(inventorySql, /profile-avatars/i);
});

test('incluye todas las claves obligatorias del JSON completo', () => {
  assertContainsEvery(
    inventorySql,
    requiredInventoryKeys.map((key) => `'${key}'`),
  );
  assert.match(inventorySql, /as\s+b0_2_production_inventory\b/i);
});

test('la documentación explica las dos etapas y la detención obligatoria', () => {
  assert.match(documentation, /^# PRELIMINAR\b/m);
  assert.match(documentation, /Etapa 1 — Preflight catalogal/i);
  assert.match(documentation, /Etapa 2 — Inventario completo/i);
  assert.match(documentation, /safe_to_run_inventory = false[\s\S]*detenerse/i);
  assert.match(documentation, /safe_to_run_inventory = true/i);
  assert.match(documentation, /únicamente relaciones y funciones de `pg_catalog`/i);
  assert.match(documentation, /no constituye autorización para ejecutar el SQL/i);
});

test('la documentación conserva alcance preliminar y sin correcciones', () => {
  assert.match(documentation, /no es una migración ejecutable/i);
  assert.match(documentation, /no crea una baseline ejecutable/i);
  assert.match(documentation, /no corrige `handle_new_propcontrol_user`/i);
  assert.match(documentation, /Rollback[\s\S]*No aplica rollback de base de datos/i);
  assert.match(documentation, /Riesgos de drift/i);
  assert.match(documentation, /Objetos potencialmente no versionados/i);
  assert.match(documentation, /Comparación producción contra GitHub/i);
});

test('la ETAPA 1 ejecuta realmente en PostgreSQL 17 aislado', { timeout: 180_000 }, async (t) => {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    t.skip('La validación efímera PostgreSQL 17 se ejecuta en GitHub Actions.');
    return;
  }

  const { spawnSync } = await import('node:child_process');
  const { randomUUID } = await import('node:crypto');
  const containerName = `b02-preflight-${randomUUID().slice(0, 8)}`;

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

    const versionResult = spawnSync(
      'docker',
      [
        'exec',
        containerName,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-X',
        '-A',
        '-t',
        '-c',
        'show server_version;',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(versionResult.status, 0, versionResult.stderr || versionResult.stdout);
    const serverVersion = versionResult.stdout.trim();
    assert.match(serverVersion, /^17(?:\.|$)/);

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
      {
        encoding: 'utf8',
        input: preflightSql,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    assert.equal(execution.status, 0, execution.stderr || execution.stdout);
    const outputLines = execution.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    assert.ok(outputLines.length > 0, 'La ETAPA 1 no devolvió una fila.');

    const rawJson = outputLines[outputLines.length - 1];
    assert.ok(rawJson);
    const result = JSON.parse(rawJson) as Record<string, unknown>;

    assert.equal(result.read_only, true);
    assert.equal(result.catalog_only, true);
    assert.equal(typeof result.safe_to_run_inventory, 'boolean');
    assert.ok(Array.isArray(result.blocking_findings));

    console.log(
      `B0.2 PostgreSQL 17 isolated preflight: ${JSON.stringify({
        server_version: serverVersion,
        read_only: result.read_only,
        catalog_only: result.catalog_only,
        safe_to_run_inventory: result.safe_to_run_inventory,
        blocking_findings: result.blocking_findings,
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
