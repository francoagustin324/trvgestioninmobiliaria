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

test('login y guardado automático cargan compatibilidad con TenantScope explícito', () => {
  const auth = readFileSync('src/mvp-auth.ts', 'utf8');
  const index = readFileSync('index.html', 'utf8');
  const bootstrap = readFileSync('src/cloud-compat-bootstrap.ts', 'utf8');
  assert.ok(auth.includes("from './cloud-api-compatible.js'"));
  assert.ok(index.includes('/dist/cloud-compat-bootstrap.js'));
  assert.ok(index.indexOf('cloud-compat-bootstrap.js') < index.indexOf('mvp-main.js'));
  assert.match(bootstrap, /currentTenantScope\(\)/);
  assert.match(bootstrap, /tenantScopesEqual\(activeScope, eventScope\)/);
  assert.match(bootstrap, /retryScope: TenantScope = Object\.freeze\(\{ \.\.\.activeScope \}\)/);
  assert.match(bootstrap, /retrySnapshot = structuredClone\(state\.crm\)/);
  assert.match(bootstrap, /pushCloudData\(retryScope, retrySnapshot\)/);
  assert.match(bootstrap, /retryKey = tenantRuntimeKey\(activeScope\)/);
  assert.match(bootstrap, /captureTenantRuntimeLease\(retryScope\)/);
  assert.doesNotMatch(bootstrap, /pushCloudData\(state\.crm\)/);
  assert.doesNotMatch(bootstrap, /getCloudMembershipContext|fetchMembershipCatalog|resolveActiveOrganization/);
});

test('compatibilidad legacy conserva invariantes tenant sin tocar RLS ni secretos', () => {
  const context = readFileSync('src/tenant-cloud-context.ts', 'utf8');
  const data = readFileSync('src/tenant-cloud-data.ts', 'utf8');
  const combined = `${context}\n${data}`;

  assert.match(context, /organization_members/);
  assert.match(context, /organization_id.*scope\.organizationId/);
  assert.match(context, /method:\s*'GET'/);
  assert.match(context, /!activeStatus\(own\.status\)/);
  assert.doesNotMatch(context, /searchParams\.set\('limit'/);
  assert.doesNotMatch(context, /rows\s*\[\s*0\s*\]/);

  assert.match(data, /organization_id:\s*scope\.organizationId/);
  assert.match(data, /source:\s*SNAPSHOT_SOURCE/);
  assert.match(data, /internal_data:\s*\{ crm,/);
  assert.match(data, /Prefer:\s*'return=minimal'/);
  assert.match(data, /assertTenantCrmScope\(scope,/);
  assert.match(data, /TENANT_CLOUD_RESPONSE_MISMATCH/);

  assert.equal(combined.includes('SUPABASE_SECRET_KEY'), false);
  assert.equal(combined.includes('alter policy'), false);
  assert.equal(combined.includes('create policy'), false);
});
