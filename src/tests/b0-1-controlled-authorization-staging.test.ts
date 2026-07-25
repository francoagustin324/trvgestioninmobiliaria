import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const testPath = 'supabase/tests/b0_1_controlled_authorization_staging.sql';
const sql = readFileSync(testPath, 'utf8');

const expectedTests = [
  'anon no ejecuta activate_my_organization_memberships',
  'authenticated sí ejecuta activate_my_organization_memberships',
  'cero invited es no-op',
  'una invited activa solo una',
  'dos invited generan error y cero cambios',
  'active permanece active',
  'suspended permanece suspended',
  'invited no accede a organizations',
  'invited no accede a fichas',
  'invited no accede a public_property_fichas',
  'active conserva acceso',
  'PATCH directo de organization_members continúa bloqueado',
] as const;

test('la prueba controlada vive fuera de supabase/migrations', () => {
  assert.match(testPath, /^supabase\/tests\//);
  assert.doesNotMatch(testPath, /^supabase\/migrations\//);
});

test('el preflight detiene la ejecución si staging no está vacío', () => {
  assert.match(sql, /to_regclass\('public\.organizations'\) is not null/i);
  assert.match(sql, /to_regclass\('public\.organization_members'\) is not null/i);
  assert.match(sql, /to_regclass\('public\.fichas'\) is not null/i);
  assert.match(sql, /to_regclass\('public\.public_property_fichas'\) is not null/i);
  assert.match(sql, /Prueba detenida: staging no está vacío/i);
});

test('la prueba está envuelta en una transacción y limpia objetos permanentes', () => {
  assert.match(sql, /^--[\s\S]*?\bbegin;/i);
  assert.match(sql, /drop function public\.activate_my_organization_memberships\(\);/i);
  assert.match(sql, /drop function private\.is_active_org_member\(uuid, uuid\);/i);
  assert.match(sql, /drop table public\.organization_members;/i);
  assert.match(sql, /drop table public\.organizations;/i);
  assert.match(sql, /\bcommit;[\s\S]*cleanup_verified/i);
});

test('cubre exactamente los doce comportamientos obligatorios', () => {
  for (const expectedTest of expectedTests) {
    assert.ok(sql.includes(expectedTest), `Falta la prueba: ${expectedTest}`);
  }

  assert.match(sql, /'total_tests', count\(\*\)/i);
  assert.match(sql, /'passed', bool_and\(passed\)/i);
});

test('simula anon y authenticated sin incluir secretos ni datos reales', () => {
  assert.match(sql, /set local role anon;/i);
  assert.match(sql, /set local role authenticated;/i);
  assert.match(sql, /request\.jwt\.claim\.sub/i);
  assert.doesNotMatch(sql, /sb_secret_|service_role_key|supabase_secret_key/i);
  assert.doesNotMatch(sql, /@gmail\.|@hotmail\.|@outlook\.|3515110069/i);
});

test('usa las firmas y la semántica B0.1', () => {
  assert.match(sql, /target_user uuid default auth\.uid\(\)/i);
  assert.match(sql, /from public\.organization_members as om/i);
  assert.match(sql, /lower\(coalesce\(om\.status, 'active'\)\) = 'active'/i);
  assert.match(sql, /limit 2\s+for update/i);
  assert.match(sql, /if invited_count > 1 then/i);
  assert.match(sql, /private\.is_active_org_member\(target_org, auth\.uid\(\)\)/i);
});

test('el resultado final declara entorno staging y ausencia de cambios persistentes', () => {
  assert.match(sql, /'environment', 'staging'/i);
  assert.match(sql, /'persistent_changes', false/i);
  assert.match(sql, /b0_1_controlled_authorization_results/i);
});
