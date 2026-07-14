import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isLegacySchemaError } from '../cloud-api-compatible.js';

test('detecta la columna member_id ausente y activa compatibilidad', () => {
  assert.equal(isLegacySchemaError(new Error('column organization_members.member_id does not exist')), true);
  assert.equal(isLegacySchemaError(new Error("Could not find the 'member_id' column of 'organization_members' in the schema cache")), true);
});

test('detecta propcontrol_records ausente y activa compatibilidad', () => {
  assert.equal(isLegacySchemaError(new Error('relation public.propcontrol_records does not exist')), true);
  assert.equal(isLegacySchemaError(new Error('PGRST205: propcontrol_records was not found in the schema cache')), true);
});

test('no oculta errores de contraseña o red ajenos al esquema', () => {
  assert.equal(isLegacySchemaError(new Error('Invalid login credentials')), false);
  assert.equal(isLegacySchemaError(new Error('Failed to fetch')), false);
});

test('login y guardado automático cargan la capa compatible', () => {
  const auth = readFileSync('src/mvp-auth.ts', 'utf8');
  const index = readFileSync('index.html', 'utf8');
  const bootstrap = readFileSync('src/cloud-compat-bootstrap.ts', 'utf8');
  assert.ok(auth.includes("from './cloud-api-compatible.js'"));
  assert.ok(index.includes('/dist/cloud-compat-bootstrap.js'));
  assert.ok(index.indexOf('cloud-compat-bootstrap.js') < index.indexOf('mvp-main.js'));
  assert.ok(bootstrap.includes('pushCloudData(state.crm)'));
});

test('la compatibilidad conserva el snapshot anterior sin tocar RLS', () => {
  const source = readFileSync('src/cloud-api-compatible.ts', 'utf8');
  for (const marker of [
    "select', 'organization_id,role'",
    "source', `eq.${SNAPSHOT_SOURCE}`",
    "internal_data: { crm",
    "Prefer: 'return=minimal'",
  ]) assert.ok(source.includes(marker), marker);
  assert.equal(source.includes('SUPABASE_SECRET_KEY'), false);
});
