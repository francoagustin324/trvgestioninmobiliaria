import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ActiveOrganizationResolutionError,
  activeMembershipsForUser,
  activeOrganizationPreferenceKey,
  clearActiveOrganizationPreference,
  normalizeMembershipCatalogStatus,
  readActiveOrganizationPreference,
  resolveActiveOrganization,
  tenantScopeFromActiveOrganization,
  writeActiveOrganizationPreference,
  type MembershipCatalogEntry,
} from '../active-organization.js';
import { fetchMembershipCatalog } from '../membership-catalog.js';

const userId = 'user-a';
const orgA = '11111111-1111-4111-8111-111111111111';
const orgB = '22222222-2222-4222-8222-222222222222';
const orgC = '33333333-3333-4333-8333-333333333333';

function membership(
  organizationId: string,
  status: MembershipCatalogEntry['status'],
  overrides: Partial<MembershipCatalogEntry> = {},
): MembershipCatalogEntry {
  return {
    organizationId,
    userId,
    status,
    rawStatus: status,
    role: 'owner',
    ...overrides,
  };
}

function resolutionCode(run: () => unknown): string {
  try {
    run();
    return 'NO_ERROR';
  } catch (error) {
    assert.ok(error instanceof ActiveOrganizationResolutionError);
    return error.code;
  }
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('A1.2-A: 0 active exige acceso organizacional', () => {
  assert.equal(
    resolutionCode(() => resolveActiveOrganization({ userId, memberships: [] })),
    'ORGANIZATION_ACCESS_REQUIRED',
  );
});

test('A1.2-A: 1 active auto-selecciona exactamente esa organización', () => {
  const resolved = resolveActiveOrganization({
    userId,
    memberships: [membership(orgA, 'active')],
  });
  assert.deepEqual(resolved, { userId, activeOrganizationId: orgA });
  assert.equal(Object.isFrozen(resolved), true);
});

test('A1.2-A: 2 active sin preference exigen selección explícita', () => {
  assert.equal(
    resolutionCode(() => resolveActiveOrganization({
      userId,
      memberships: [membership(orgA, 'active'), membership(orgB, 'active')],
    })),
    'ORGANIZATION_SELECTION_REQUIRED',
  );
});

test('A1.2-A: 2 active + preference válida restaura la preference', () => {
  const resolved = resolveActiveOrganization({
    userId,
    memberships: [membership(orgA, 'active'), membership(orgB, 'active')],
    persistedOrganizationPreference: orgB,
  });
  assert.equal(resolved.activeOrganizationId, orgB);
});

test('A1.2-A: 2 active + preference inválida exige selección explícita', () => {
  assert.equal(
    resolutionCode(() => resolveActiveOrganization({
      userId,
      memberships: [membership(orgA, 'active'), membership(orgB, 'active')],
      persistedOrganizationPreference: orgC,
    })),
    'ORGANIZATION_SELECTION_REQUIRED',
  );
});

test('A1.2-A: active + invited deja sólo active seleccionable', () => {
  const rows = [membership(orgB, 'invited'), membership(orgA, 'active')];
  assert.deepEqual(activeMembershipsForUser(userId, rows).map((row) => row.organizationId), [orgA]);
  assert.equal(resolveActiveOrganization({ userId, memberships: rows }).activeOrganizationId, orgA);
});

test('A1.2-A: active + suspended deja sólo active seleccionable', () => {
  const rows = [membership(orgB, 'suspended'), membership(orgA, 'active')];
  assert.deepEqual(activeMembershipsForUser(userId, rows).map((row) => row.organizationId), [orgA]);
  assert.equal(resolveActiveOrganization({ userId, memberships: rows }).activeOrganizationId, orgA);
});

test('A1.2-A: invited solamente no concede acceso', () => {
  assert.equal(
    resolutionCode(() => resolveActiveOrganization({ userId, memberships: [membership(orgA, 'invited')] })),
    'ORGANIZATION_ACCESS_REQUIRED',
  );
});

test('A1.2-A: suspended solamente no concede acceso', () => {
  assert.equal(
    resolutionCode(() => resolveActiveOrganization({ userId, memberships: [membership(orgA, 'suspended')] })),
    'ORGANIZATION_ACCESS_REQUIRED',
  );
});

test('A1.2-A: status inesperado se normaliza unknown y no es seleccionable', () => {
  assert.equal(normalizeMembershipCatalogStatus('  ACTIVE  '), 'active');
  assert.equal(normalizeMembershipCatalogStatus('Invited'), 'invited');
  assert.equal(normalizeMembershipCatalogStatus('SUSPENDED'), 'suspended');
  assert.equal(normalizeMembershipCatalogStatus('pending-review'), 'unknown');
  assert.equal(normalizeMembershipCatalogStatus(null), 'unknown');
  assert.equal(
    resolutionCode(() => resolveActiveOrganization({ userId, memberships: [membership(orgA, 'unknown')] })),
    'ORGANIZATION_ACCESS_REQUIRED',
  );
});

test('A1.2-A: invertir el orden de rows no cambia el resultado', () => {
  const first = resolveActiveOrganization({
    userId,
    memberships: [membership(orgA, 'active'), membership(orgB, 'invited')],
  });
  const reversed = resolveActiveOrganization({
    userId,
    memberships: [membership(orgB, 'invited'), membership(orgA, 'active')],
  });
  assert.deepEqual(first, reversed);
});

test('A1.2-A: preference de Org B deja de ser válida cuando B ya no está active', () => {
  const resolved = resolveActiveOrganization({
    userId,
    memberships: [membership(orgA, 'active'), membership(orgB, 'suspended')],
    persistedOrganizationPreference: orgB,
  });
  assert.equal(resolved.activeOrganizationId, orgA);
});

test('A1.2-A: memberships de otro usuario nunca participan en autoridad', () => {
  const rows = [
    membership(orgA, 'active', { userId: 'other-user' }),
    membership(orgB, 'active'),
  ];
  assert.equal(resolveActiveOrganization({ userId, memberships: rows }).activeOrganizationId, orgB);
});

test('A1.2-A: TenantScope es una copia inmutable del contexto resuelto', () => {
  const context = resolveActiveOrganization({ userId, memberships: [membership(orgA, 'active')] });
  const scope = tenantScopeFromActiveOrganization(context);
  assert.deepEqual(scope, { userId, organizationId: orgA });
  assert.equal(Object.isFrozen(scope), true);
  assert.notEqual(scope, context as unknown);
});

test('A1.2-A: preference es user-scoped y nunca se comparte entre usuarios', () => {
  const storage = new MemoryStorage();
  assert.equal(activeOrganizationPreferenceKey(userId), `propcontrol-active-organization-v1:user:${userId}`);
  writeActiveOrganizationPreference(userId, orgA, storage);
  writeActiveOrganizationPreference('user-b', orgB, storage);
  assert.equal(readActiveOrganizationPreference(userId, storage), orgA);
  assert.equal(readActiveOrganizationPreference('user-b', storage), orgB);
  clearActiveOrganizationPreference(userId, storage);
  assert.equal(readActiveOrganizationPreference(userId, storage), null);
  assert.equal(readActiveOrganizationPreference('user-b', storage), orgB);
});

test('A1.2-A: preference persistida se revalida y no constituye autoridad por sí sola', () => {
  const storage = new MemoryStorage();
  writeActiveOrganizationPreference(userId, orgB, storage);
  const preference = readActiveOrganizationPreference(userId, storage);
  assert.equal(
    resolutionCode(() => resolveActiveOrganization({
      userId,
      memberships: [membership(orgA, 'invited'), membership(orgB, 'suspended')],
      persistedOrganizationPreference: preference,
    })),
    'ORGANIZATION_ACCESS_REQUIRED',
  );
});

test('A1.2-A: discovery nuevo consulta el catálogo completo en modo read-only', async () => {
  const storage = new MemoryStorage();
  storage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
    accessToken: 'token',
    refreshToken: 'refresh',
    expiresAt: Date.now() + 60_000,
    userId,
    email: 'user@example.com',
  }));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

  const requests: Array<{ pathname: string; method: string; limit: string | null; userIdFilter: string | null }> = [];
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url, 'https://app.test');
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      requests.push({
        pathname: url.pathname,
        method,
        limit: url.searchParams.get('limit'),
        userIdFilter: url.searchParams.get('user_id'),
      });
      if (url.pathname === '/api/cloud-config') {
        return json({ configured: true, url: 'https://supabase.test', publishableKey: 'key' });
      }
      if (url.pathname === '/rest/v1/organization_members') {
        return json([
          { organization_id: orgA, member_id: 1, user_id: userId, role: 'owner', status: 'active' },
          { organization_id: orgB, member_id: 2, user_id: userId, role: 'agent', status: 'invited' },
        ]);
      }
      throw new Error(`unexpected ${method} ${url.pathname}`);
    },
  });

  const catalog = await fetchMembershipCatalog();
  assert.deepEqual(catalog.map((row) => [row.organizationId, row.status]), [
    [orgA, 'active'],
    [orgB, 'invited'],
  ]);
  assert.equal(Object.isFrozen(catalog), true);
  assert.deepEqual(requests.map((request) => [request.pathname, request.method]), [
    ['/api/cloud-config', 'GET'],
    ['/rest/v1/organization_members', 'GET'],
  ]);
  assert.equal(requests[1]?.limit, null);
  assert.equal(requests[1]?.userIdFilter, `eq.${userId}`);
});

test('A1.2-A static guard: membership catalog no activa invitaciones ni usa first-row/limit tenant resolution', () => {
  const source = readFileSync('src/membership-catalog.ts', 'utf8');
  assert.doesNotMatch(source, /activate_my_organization_memberships|activateMemberships\s*\(/i);
  assert.doesNotMatch(source, /searchParams\.set\(['"]limit['"]/i);
  assert.doesNotMatch(source, /rows\s*\[\s*0\s*\]|payload\s*\[\s*0\s*\]/i);
  assert.match(source, /method:\s*['"]GET['"]/i);
  assert.doesNotMatch(source, /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/i);
});

test('A1.2-A static guard: resolver no depende de CRM, entidades ni first-row', () => {
  const source = readFileSync('src/active-organization.ts', 'utf8');
  assert.doesNotMatch(source, /state\.crm|organization\.id|rows\s*\[\s*0\s*\]/i);
  assert.doesNotMatch(source, /\bClient\b|\bProperty\b|\bVisit\b/i);
  assert.doesNotMatch(source, /limit\s*\(\s*1\s*\)|\.limit\s*\(\s*1\s*\)/i);
});

test('A1.2-A: aceptación explícita B0.3 permanece en invitation-auth y fuera del discovery', () => {
  const invitation = readFileSync('src/invitation-auth.ts', 'utf8');
  const discovery = readFileSync('src/membership-catalog.ts', 'utf8');
  const passwordUpdate = invitation.indexOf("fetch(`${config.url}/auth/v1/user`");
  const activation = invitation.indexOf('/rest/v1/rpc/activate_my_organization_memberships');
  const cleanup = invitation.indexOf('localStorage.removeItem(INVITATION_KEY)');
  assert.ok(passwordUpdate >= 0);
  assert.ok(activation > passwordUpdate);
  assert.ok(cleanup > activation);
  assert.doesNotMatch(discovery, /activate_my_organization_memberships/i);
});

test('A1.2-A post-cutover guard: hydration consume contexto/scope sin reabrir discovery implícito', () => {
  const hydration = readFileSync('src/tenant-hydration.ts', 'utf8');
  const catalog = readFileSync('src/membership-catalog.ts', 'utf8');
  const resolver = readFileSync('src/active-organization.ts', 'utf8');

  assert.match(hydration, /fetchMembershipCatalog\(\)/);
  assert.match(hydration, /resolveActiveOrganization\(/);
  assert.match(hydration, /tenantScopeFromActiveOrganization\(context\)/);
  assert.match(hydration, /hydrateTenantAfterAuth/);
  assert.match(hydration, /activateStorageForTenant\(scope\)/);
  assert.match(hydration, /installTenantRuntimeScope\(scope, scope\.userId\)/);

  assert.doesNotMatch(catalog, /activateMemberships\s*\(|activate_my_organization_memberships/i);
  assert.doesNotMatch(catalog, /searchParams\.set\(['"]limit['"]/i);
  assert.doesNotMatch(catalog, /rows\s*\[\s*0\s*\]|payload\s*\[\s*0\s*\]/i);
  assert.doesNotMatch(hydration, /state\.crm\.organization\.id/);
  assert.doesNotMatch(resolver, /state\.crm|rows\s*\[\s*0\s*\]/i);
});
