import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const auditPath = 'supabase/audits/b0_2_production_inventory_readonly.sql';
const documentationPath = 'docs/SUPABASE_PRODUCTION_BASELINE.md';
const sql = readFileSync(auditPath, 'utf8');
const documentation = readFileSync(documentationPath, 'utf8');

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

const requiredJsonKeys = [
  'check',
  'read_only',
  'generated_at',
  'server_version',
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

function stripSqlCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n\r]*/g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
}

const executableSql = stripSqlCommentsAndStrings(sql);

function assertContainsEvery(source: string, values: readonly string[]): void {
  for (const value of values) {
    assert.ok(source.includes(value), `Falta cobertura para ${value}`);
  }
}

test('el inventario vive fuera de supabase/migrations', () => {
  assert.match(auditPath, /^supabase\/audits\//);
  assert.doesNotMatch(auditPath, /^supabase\/migrations\//);
});

test('usa una única sentencia SELECT y termina en una proyección JSONB de una fila', () => {
  assert.equal((executableSql.match(/;/g) ?? []).length, 1);
  assert.match(executableSql.trim(), /^with\b/i);
  assert.match(
    executableSql,
    /final_inventory\s+as\s*\([\s\S]*?jsonb_build_object\([\s\S]*?\)\s+as\s+b0_2_production_inventory\s*\)[\s\S]*?select\s+b0_2_production_inventory\s+from\s+final_inventory\s*;\s*$/i,
  );
});

test('declara el resultado y su carácter de solo lectura', () => {
  assert.match(sql, /'check'\s*,\s*'B0\.2 production schema inventory'/i);
  assert.match(sql, /'read_only'\s*,\s*true/i);
  assert.match(sql, /as\s+b0_2_production_inventory\b/i);
});

test('no contiene DDL, DML, llamadas ni bloqueo de filas', () => {
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
      executableSql,
      new RegExp(`\\b${keyword}\\b`, 'i'),
      `La auditoría contiene la operación prohibida ${keyword}`,
    );
  }

  assert.doesNotMatch(executableSql, /\bfor\s+(?:no\s+key\s+)?update\b/i);
  assert.doesNotMatch(executableSql, /\bfor\s+share\b/i);
});

test('no usa SQL dinámico', () => {
  assert.doesNotMatch(executableSql, /\bexecute\b/i);
  assert.doesNotMatch(executableSql, /\bprepare\b/i);
  assert.doesNotMatch(executableSql, /\bdeallocate\b/i);
  assert.doesNotMatch(executableSql, /\bformat\s*\(/i);
  assert.doesNotMatch(executableSql, /\bdblink\b/i);
});

test('no consulta filas de auth.users ni de las tablas comerciales', () => {
  assert.doesNotMatch(executableSql, /\bfrom\s+auth\.users\b/i);
  assert.doesNotMatch(executableSql, /\bjoin\s+auth\.users\b/i);

  for (const tableName of requiredTables) {
    const escaped = tableName.replace('.', '\\.');
    assert.doesNotMatch(executableSql, new RegExp(`\\bfrom\\s+${escaped}\\b`, 'i'));
    assert.doesNotMatch(executableSql, new RegExp(`\\bjoin\\s+${escaped}\\b`, 'i'));
  }

  assert.doesNotMatch(executableSql, /\bfrom\s+storage\.objects\b/i);
  assert.doesNotMatch(executableSql, /\bjoin\s+storage\.objects\b/i);
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
      `El inventario menciona el campo sensible ${field}`,
    );
  }

  assert.doesNotMatch(sql, /sb_secret_|service_role_key|supabase_secret_key/i);
  assert.doesNotMatch(sql, /@[a-z0-9.-]+\.[a-z]{2,}/i);
});

test('cubre todas las tablas y sus metadatos estructurales', () => {
  assertContainsEvery(sql, requiredTables.map((value) => value.split('.')[1] ?? value));
  assert.match(sql, /pg_catalog\.pg_attribute/i);
  assert.match(sql, /pg_catalog\.pg_attrdef/i);
  assert.match(sql, /pg_catalog\.pg_constraint/i);
  assert.match(sql, /pg_catalog\.pg_index/i);
  assert.match(sql, /pg_catalog\.pg_get_indexdef/i);
  assert.match(sql, /pg_catalog\.pg_policy/i);
  assert.match(sql, /relrowsecurity/i);
  assert.match(sql, /relforcerowsecurity/i);
  assert.match(sql, /pg_catalog\.aclexplode/i);
  assert.match(sql, /nullable/i);
  assert.match(sql, /primary_keys/i);
  assert.match(sql, /foreign_keys/i);
});

test('cubre todas las funciones sin invocarlas', () => {
  assertContainsEvery(sql, requiredFunctions.map((value) => value.split('.')[1] ?? value));

  for (const qualifiedName of requiredFunctions) {
    const escaped = qualifiedName.replace('.', '\\.');
    assert.doesNotMatch(
      executableSql,
      new RegExp(`\\b${escaped}\\s*\\(`, 'i'),
      `La auditoría no debe invocar ${qualifiedName}`,
    );
  }

  assert.match(sql, /pg_catalog\.pg_get_function_identity_arguments/i);
  assert.match(sql, /pg_catalog\.pg_get_function_arguments/i);
  assert.match(sql, /pg_catalog\.pg_get_function_result/i);
  assert.match(sql, /pg_catalog\.pg_get_functiondef/i);
  assert.match(sql, /provolatile/i);
  assert.match(sql, /prosecdef/i);
  assert.match(sql, /proconfig/i);
  assert.match(sql, /execute_grants/i);
  assert.match(sql, /dependencies/i);
});

test('inventaría triggers principales y el trigger técnico de auth.users', () => {
  assert.match(sql, /pg_catalog\.pg_trigger/i);
  assert.match(sql, /pg_catalog\.pg_get_triggerdef/i);
  assert.match(sql, /on_propcontrol_user_created/i);
  assert.match(sql, /'auth'::text|nspname\s*=\s*'auth'/i);
  assert.match(sql, /linked_function/i);
  assert.match(sql, /enabled_state/i);
  assert.match(sql, /timing/i);
  assert.match(sql, /events/i);
});

test('inventaría solamente metadata de Storage y no archivos', () => {
  assert.match(sql, /from\s+storage\.buckets\s+as\s+bucket/i);
  assert.match(sql, /file_size_limit/i);
  assert.match(sql, /allowed_mime_types/i);
  assert.match(sql, /storage_objects_policies/i);
  assert.doesNotMatch(executableSql, /\bfrom\s+storage\.objects\b/i);
  assert.doesNotMatch(executableSql, /\bjoin\s+storage\.objects\b/i);
  assert.doesNotMatch(executableSql, /\bselect\s+[\s\S]{0,120}\bname\s+from\s+storage\.objects\b/i);
});

test('compara el historial técnico de migraciones con las versiones conocidas', () => {
  assert.match(sql, /supabase_migrations\.schema_migrations/i);
  assert.match(sql, /to_regclass\('supabase_migrations\.schema_migrations'\)/i);
  assertContainsEvery(sql, knownMigrationVersions);
  assert.match(sql, /'absent'/i);
  assert.match(sql, /'empty'/i);
  assert.match(sql, /'incomplete'/i);
  assert.match(sql, /'present'/i);
  assert.match(sql, /missing_expected_versions/i);
  assert.match(sql, /unrecognized_versions/i);
});

test('verifica los objetos previstos para fases posteriores', () => {
  assert.match(sql, /public\.user_profiles/i);
  assert.match(sql, /public\.organization_settings/i);
  assert.match(sql, /profile-avatars/i);
  assert.match(sql, /expected_objects_missing/i);
});

test('incluye todas las claves obligatorias del JSON final', () => {
  assertContainsEvery(
    sql,
    requiredJsonKeys.map((key) => `'${key}'`),
  );
});

test('la documentación permanece preliminar y no propone una migración ejecutable', () => {
  assert.match(documentation, /^# PRELIMINAR\b/m);
  assert.match(documentation, /no es una migración ejecutable/i);
  assert.match(documentation, /todavía no contiene resultados observados/i);
  assert.match(documentation, /no se generará una migración baseline/i);
  assert.match(documentation, /no corrige ningún resultado/i);
  assert.match(documentation, /Rollback[\s\S]*no aplica/i);
});

test('la documentación explica comparación, drift, objetos no versionados y procedimiento', () => {
  assert.match(documentation, /Comparación entre producción y GitHub/i);
  assert.match(documentation, /Riesgos de drift/i);
  assert.match(documentation, /Objetos potencialmente no versionados/i);
  assert.match(documentation, /Procedimiento para completar la baseline/i);
  assert.match(documentation, /JSON real/i);
  assert.match(documentation, /no se modificará `handle_new_propcontrol_user`/i);
});

test('no existe una migración baseline ejecutable de B0.2', () => {
  const migrationFiles = readdirSync('supabase/migrations');
  const forbiddenMigration = migrationFiles.find((fileName) =>
    /b0[_-]?2|baseline|production[_-]?inventory/i.test(fileName),
  );

  assert.equal(forbiddenMigration, undefined);
});
