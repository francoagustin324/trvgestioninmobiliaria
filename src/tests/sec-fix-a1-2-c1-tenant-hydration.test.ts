import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  currentTenantScope,
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
  tenantRuntimeKey,
  tenantScopesEqual,
} from '../tenant-runtime.js';

const scopeA = Object.freeze({ userId: 'user-a', organizationId: 'org-a' });
const scopeB = Object.freeze({ userId: 'user-a', organizationId: 'org-b' });

test('A1.2-C1: runtime authority instala una copia exacta e inmutable', () => {
  invalidateTenantRuntimeScope();
  const mutable = { userId: 'user-a', organizationId: 'org-a' };
  const installed = installTenantRuntimeScope(mutable, 'user-a');
  mutable.organizationId = 'org-b';

  assert.equal(installed.userId, 'user-a');
  assert.equal(installed.organizationId, 'org-a');
  assert.equal(Object.isFrozen(installed), true);
  assert.equal(currentTenantScope(), installed);
  assert.equal(tenantRuntimeKey(installed), 'user-a:org:org-a');
});

test('A1.2-C1: runtime authority rechaza scope de otro usuario y logout invalida', () => {
  invalidateTenantRuntimeScope();
  assert.throws(
    () => installTenantRuntimeScope(scopeA, 'user-b'),
    /TENANT_RUNTIME_SESSION_MISMATCH/,
  );
  assert.equal(currentTenantScope(), null);

  installTenantRuntimeScope(scopeA, 'user-a');
  invalidateTenantRuntimeScope();
  assert.equal(currentTenantScope(), null);
});

test('A1.2-C1: igualdad runtime exige user + organization', () => {
  assert.equal(tenantScopesEqual(scopeA, scopeA), true);
  assert.equal(tenantScopesEqual(scopeA, scopeB), false);
  assert.equal(tenantScopesEqual(scopeA, { userId: 'user-b', organizationId: 'org-a' }), false);
});

test('A1.2-C1 static: hydration resuelve tenant antes de inspeccionar o leer storage CRM', () => {
  const source = readFileSync('src/tenant-hydration.ts', 'utf8');
  const start = source.indexOf('export async function hydrateTenantAfterAuth');
  assert.ok(start >= 0);
  const body = source.slice(start);

  const resolve = body.indexOf('resolveTenantScopeForAuthenticatedSession()');
  const inspect = body.indexOf('prepareTenantLegacyStorage(scope)');
  const activate = body.indexOf('activateStorageForTenant(scope)');
  const install = body.indexOf('installTenantRuntimeScope(scope, scope.userId)');
  const dirty = body.indexOf('tenantHasPendingLocalChanges(scope)');
  const pull = body.indexOf('pullCloudData(scope, state.crm)');

  assert.ok(resolve >= 0);
  assert.ok(resolve < inspect);
  assert.ok(inspect < activate);
  assert.ok(activate < install);
  assert.ok(install < dirty);
  assert.ok(dirty < pull);
});

test('A1.2-C1 static: resolver usa catálogo read-only + preference y no state CRM', () => {
  const source = readFileSync('src/tenant-hydration.ts', 'utf8');
  const resolverStart = source.indexOf('export async function resolveTenantScopeForAuthenticatedSession');
  const resolverEnd = source.indexOf('export function prepareTenantLegacyStorage');
  const resolver = source.slice(resolverStart, resolverEnd);

  assert.match(resolver, /fetchMembershipCatalog\(\)/);
  assert.match(resolver, /readActiveOrganizationPreference\(session\.userId\)/);
  assert.match(resolver, /resolveActiveOrganization\(/);
  assert.match(resolver, /tenantScopeFromActiveOrganization\(context\)/);
  assert.equal(resolver.includes('state.crm'), false);
  assert.equal(resolver.includes('organization.id'), false);
});

test('A1.2-C1 static: canonical membership transport no activa invitaciones ni usa first-row/limit tenant resolution', () => {
  const context = readFileSync('src/tenant-cloud-context.ts', 'utf8');
  const catalog = readFileSync('src/membership-catalog.ts', 'utf8');
  const combined = `${context}\n${catalog}`;

  assert.equal(combined.includes('activate_my_organization_memberships'), false);
  assert.equal(combined.includes('activateMemberships('), false);
  assert.equal(context.includes("searchParams.set('limit'"), false);
  assert.equal(/rows\s*\[\s*0\s*\]/.test(context), false);
  assert.match(context, /organization_id.*scope\.organizationId/);
  assert.match(context, /!activeStatus\(own\.status\)/);
});

test('A1.2-C1 static: store ya no lee storage user-only al importar ni guarda sin scope', () => {
  const source = readFileSync('src/store.ts', 'utf8');
  assert.equal(source.includes('activateAccountStorage'), false);
  assert.equal(source.includes('readLocalSnapshot'), false);
  assert.equal(source.includes('writeLocalSnapshot'), false);
  assert.match(source, /readTenantSnapshot\(scope\)/);
  assert.match(source, /writeTenantSnapshot\(scope, state\.crm/);
  assert.match(source, /requireCurrentTenantScope\(\)/);
  assert.match(source, /queueCloudSave\(scope, state\.crm\)/);
});

test('A1.2-C1 static: legacy storage sólo migra EXACT_ORG_MATCH y todo lo demás exige recovery', () => {
  const source = readFileSync('src/tenant-hydration.ts', 'utf8');
  const start = source.indexOf('export function prepareTenantLegacyStorage');
  const end = source.indexOf('function activateAuthenticatedMember');
  const body = source.slice(start, end);

  assert.match(body, /NO_LEGACY/);
  assert.match(body, /TARGET_ALREADY_EXISTS/);
  assert.match(body, /EXACT_ORG_MATCH/);
  assert.match(body, /migrateLegacyStorageToTenant\(scope\)/);
  assert.match(body, /TENANT_LEGACY_STORAGE_RECOVERY_REQUIRED/);
  assert.equal(body.includes('organization.id ='), false);
});

test('A1.2-C1 static: cloud rows y CRM remoto exigen organization exacta', () => {
  const source = readFileSync('src/tenant-cloud-data.ts', 'utf8');
  assert.match(source, /row\.organization_id !== scope\.organizationId/);
  assert.ok((source.match(/assertTenantCrmScope\(scope,/g) ?? []).length >= 5);
  assert.match(source, /TENANT_CLOUD_RESPONSE_MISMATCH/);
  assert.equal(source.includes('organization: { ...legacy.crm.organization, id:'), false);
});

test('A1.2-C1 static: capability no puede degradar 2+ memberships a writer legacy', () => {
  const source = readFileSync('src/cloud-api-compatible.ts', 'utf8');
  const start = source.indexOf('export async function resolveTenantVisitAuthority');
  const end = source.indexOf('export async function pullCloudData');
  const body = source.slice(start, end);

  assert.match(body, /active\.length !== 1/);
  assert.match(body, /TENANT_VISIT_CAPABILITY_INDETERMINATE/);
  assert.equal(body.includes('activate_my_organization_memberships'), false);
  assert.equal(body.includes("searchParams.set('limit'"), false);
});

test('A1.2-C1 static: bootstrap de compatibilidad no puede reintentar sin event scope activo', () => {
  const source = readFileSync('src/cloud-compat-bootstrap.ts', 'utf8');
  assert.match(source, /currentTenantScope\(\)/);
  assert.match(source, /tenantScopesEqual\(activeScope, eventScope\)/);
  assert.match(source, /retryScope: TenantScope = Object\.freeze\(\{ \.\.\.activeScope \}\)/);
  assert.match(source, /retrySnapshot = structuredClone\(state\.crm\)/);
  assert.match(source, /pushCloudData\(retryScope, retrySnapshot\)/);
  assert.doesNotMatch(source, /pushCloudData\(state\.crm\)/);
});
