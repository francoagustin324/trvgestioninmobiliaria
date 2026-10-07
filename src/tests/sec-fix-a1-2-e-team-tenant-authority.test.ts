import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import './sec-fix-a1-2-c2-test-setup.js';
import type { TenantScope } from '../active-organization.js';
import {
  inviteTeamMember,
  TENANT_TEAM_RESPONSE_ORGANIZATION_MISMATCH,
  updateTeamMemberAccess,
} from '../cloud-api.js';
import { handleTeamManagement } from '../server/team-management.js';
import {
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
} from '../tenant-runtime.js';

const SESSION_KEY = 'propcontrol-cloud-session-v1';
const USER = 'team-user';
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const SUPABASE_URL = 'https://team-e.test';
const OPTIONS = {
  supabaseUrl: SUPABASE_URL,
  publishableKey: 'public-key',
  secretKey: 'sb_secret_test',
  appUrl: 'https://app.test',
};

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

type Deferred = Readonly<{ promise: Promise<void>; resolve: () => void }>;
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return Object.freeze({ promise, resolve });
}

function scope(organizationId: string): TenantScope {
  return Object.freeze({ userId: USER, organizationId });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestBody(init?: RequestInit): Record<string, any> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, any>;
}

interface MembershipRow {
  organization_id: string;
  member_id: number;
  user_id: string;
  role: string;
  status?: string;
  display_name?: string;
  email?: string;
  phone?: string;
  created_at?: string;
  last_active_at?: string;
}

function member(
  organizationId: string,
  role: string,
  status: string | undefined = 'active',
  memberId = 1,
  userId = USER,
): MembershipRow {
  return {
    organization_id: organizationId,
    member_id: memberId,
    user_id: userId,
    role,
    ...(status === undefined ? {} : { status }),
    display_name: `${role}-${organizationId}`,
    email: `${userId}@example.com`,
    created_at: '2026-09-08T00:00:00.000Z',
  };
}

type ServerHarnessOptions = {
  requesterRows?: Record<string, MembershipRow[]>;
  targetRows?: Record<string, MembershipRow[]>;
  existingRows?: Record<string, MembershipRow[]>;
  seatLimits?: Record<string, number | null>;
  seatRows?: Record<string, MembershipRow[]>;
  patchResponseOrganizationId?: string;
  insertResponseOrganizationId?: string;
  generatedUserId?: string;
};

type FetchCall = Readonly<{
  url: string;
  method: string;
  body?: Record<string, any>;
}>;

function installServerHarness(options: ServerHarnessOptions = {}): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = fetchUrl(input);
      const parsed = new URL(url, SUPABASE_URL);
      const method = String(init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? requestBody(init) : undefined;
      calls.push(Object.freeze({ url: parsed.toString(), method, body }));

      if (parsed.pathname === '/auth/v1/user') {
        return json({ id: USER, email: `${USER}@example.com` });
      }

      if (parsed.pathname === '/auth/v1/admin/generate_link') {
        return json({
          action_link: 'https://app.test/access',
          user: { id: options.generatedUserId ?? 'generated-user' },
        });
      }

      if (parsed.pathname === '/rest/v1/organizations') {
        const org = String(parsed.searchParams.get('id') ?? '').replace(/^eq\./, '');
        const limit = options.seatLimits?.[org] ?? null;
        return json([{ id: org, seat_limit: limit }]);
      }

      if (parsed.pathname === '/rest/v1/organization_members') {
        if (method === 'POST') {
          const org = String(body?.organization_id ?? '');
          return json([member(
            options.insertResponseOrganizationId ?? org,
            String(body?.role ?? 'agent'),
            String(body?.status ?? 'invited'),
            77,
            String(body?.user_id ?? 'generated-user'),
          )]);
        }
        if (method === 'PATCH') {
          const org = String(parsed.searchParams.get('organization_id') ?? '').replace(/^eq\./, '');
          const memberId = Number(String(parsed.searchParams.get('member_id') ?? '').replace(/^eq\./, ''));
          const source = options.targetRows?.[`${org}:${memberId}`]?.[0]
            ?? member(org, 'agent', 'active', memberId, 'target-user');
          return json([{
            ...source,
            organization_id: options.patchResponseOrganizationId ?? org,
            ...body,
          }]);
        }

        const org = String(parsed.searchParams.get('organization_id') ?? '').replace(/^eq\./, '');
        const requestedUser = parsed.searchParams.get('user_id');
        const requestedEmail = parsed.searchParams.get('email');
        const requestedMember = parsed.searchParams.get('member_id');
        const select = String(parsed.searchParams.get('select') ?? '');

        if (requestedUser) return json(options.requesterRows?.[org] ?? []);
        if (requestedEmail) {
          const email = requestedEmail.replace(/^eq\./, '');
          return json(options.existingRows?.[`${org}:${email}`] ?? []);
        }
        if (requestedMember) {
          const memberId = Number(requestedMember.replace(/^eq\./, ''));
          return json(options.targetRows?.[`${org}:${memberId}`] ?? []);
        }
        if (select === 'organization_id,member_id,status') {
          return json(options.seatRows?.[org] ?? []);
        }
      }

      throw new Error(`E_FETCH_UNEXPECTED:${method}:${parsed.toString()}`);
    }) as typeof fetch,
  });
  return { calls };
}

let requestCounter = 0;
function fakeRequest(
  path: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
): IncomingMessage {
  const bytes = Buffer.from(JSON.stringify(body));
  const value = {
    url: path,
    method,
    headers: {
      authorization: 'Bearer requester-token',
      'content-type': 'application/json',
    },
    socket: { remoteAddress: `e-test-${requestCounter += 1}` },
    async *[Symbol.asyncIterator]() { yield bytes; },
  };
  return value as unknown as IncomingMessage;
}

function captureResponse(): {
  response: ServerResponse;
  result: () => { status: number; body: Record<string, any> };
} {
  let status = 0;
  let payload: Record<string, any> = {};
  const response = {
    writeHead(nextStatus: number) { status = nextStatus; return this; },
    end(chunk?: string | Buffer) {
      payload = chunk ? JSON.parse(String(chunk)) as Record<string, any> : {};
      return this;
    },
  } as unknown as ServerResponse;
  return { response, result: () => ({ status, body: payload }) };
}

async function serverMutation(
  path: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, any> }> {
  const capture = captureResponse();
  const handled = await handleTeamManagement(fakeRequest(path, method, body), capture.response, OPTIONS);
  assert.equal(handled, true);
  return capture.result();
}

function actorQuery(calls: FetchCall[], organizationId: string): URL {
  const match = calls
    .map((call) => new URL(call.url))
    .find((url) => url.pathname === '/rest/v1/organization_members'
      && url.searchParams.get('user_id') === `eq.${USER}`
      && url.searchParams.get('organization_id') === `eq.${organizationId}`);
  assert.ok(match, `Falta requester query exacta para ${organizationId}`);
  return match;
}

function target(memberId = 9, organizationId = ORG_A, role = 'agent', status = 'active'): MembershipRow {
  return member(organizationId, role, status, memberId, `target-${organizationId}`);
}

function resetClientRuntime(organizationId: string): TenantScope {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: new MemoryStorage(),
  });
  invalidateTenantRuntimeScope();
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    accessToken: 'client-token',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
    userId: USER,
    email: `${USER}@example.com`,
  }));
  const tenantScope = scope(organizationId);
  installTenantRuntimeScope(tenantScope, USER);
  return tenantScope;
}

function installClientHarness(options: {
  responseOrganizationId?: string;
  started?: Deferred;
  release?: Deferred;
} = {}): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = fetchUrl(input);
      const method = String(init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? requestBody(init) : undefined;
      calls.push(Object.freeze({ url, method, body }));
      if (!url.startsWith('/api/team/')) throw new Error(`E_CLIENT_FETCH_UNEXPECTED:${url}`);
      options.started?.resolve();
      if (options.release) await options.release.promise;
      const organizationId = options.responseOrganizationId ?? String(body?.organizationId ?? '');
      return json({
        success: true,
        member: {
          organization_id: organizationId,
          member_id: 9,
          user_id: 'target-user',
          role: 'agent',
          status: 'active',
          display_name: 'Target User',
          email: 'target@example.com',
          created_at: '2026-09-08T00:00:00.000Z',
        },
      });
    }) as typeof fetch,
  });
  return { calls };
}

const sequential = { concurrency: false } as const;

test('E1 owner ACTIVE en A+B, scope A consulta requester exclusivamente A', sequential, async () => {
  const harness = installServerHarness({
    requesterRows: {
      [ORG_A]: [member(ORG_A, 'owner')],
      [ORG_B]: [member(ORG_B, 'owner')],
    },
    targetRows: { [`${ORG_A}:9`]: [target()] },
  });
  const result = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_A, status: 'Suspendido' });
  assert.equal(result.status, 200);
  const query = actorQuery(harness.calls, ORG_A);
  assert.equal(query.searchParams.get('status'), 'eq.active');
  assert.equal(harness.calls.some((call) => call.url.includes(`organization_id=eq.${ORG_B}`)), false);
});

test('E2 mismo usuario scope B consulta requester exclusivamente B', sequential, async () => {
  const harness = installServerHarness({
    requesterRows: {
      [ORG_A]: [member(ORG_A, 'owner')],
      [ORG_B]: [member(ORG_B, 'owner')],
    },
    targetRows: { [`${ORG_B}:9`]: [target(9, ORG_B)] },
  });
  const result = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_B, status: 'Suspendido' });
  assert.equal(result.status, 200);
  actorQuery(harness.calls, ORG_B);
  assert.equal(harness.calls.some((call) => call.url.includes(`organization_id=eq.${ORG_A}`)), false);
});

test('E3 owner A + agent B permite Team A y deniega Team B', sequential, async () => {
  const harness = installServerHarness({
    requesterRows: {
      [ORG_A]: [member(ORG_A, 'owner')],
      [ORG_B]: [member(ORG_B, 'agent')],
    },
    targetRows: {
      [`${ORG_A}:9`]: [target()],
      [`${ORG_B}:9`]: [target(9, ORG_B)],
    },
  });
  const allowed = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_A, status: 'Suspendido' });
  const denied = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_B, status: 'Suspendido' });
  assert.equal(allowed.status, 200);
  assert.notEqual(denied.status, 200);
  actorQuery(harness.calls, ORG_A);
  actorQuery(harness.calls, ORG_B);
});

test('E4 admin A + owner B no hereda privilegios owner dentro de A', sequential, async () => {
  installServerHarness({
    requesterRows: {
      [ORG_A]: [member(ORG_A, 'admin')],
      [ORG_B]: [member(ORG_B, 'owner')],
    },
    targetRows: {
      [`${ORG_A}:9`]: [target(9, ORG_A, 'admin')],
      [`${ORG_B}:9`]: [target(9, ORG_B, 'agent')],
    },
  });
  const deniedA = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_A, status: 'Suspendido' });
  const allowedB = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_B, status: 'Suspendido' });
  assert.notEqual(deniedA.status, 200);
  assert.equal(allowedB.status, 200);
});

test('E5 owner/admin invited quedan denegados', sequential, async () => {
  for (const role of ['owner', 'admin']) {
    const harness = installServerHarness({ requesterRows: { [ORG_A]: [member(ORG_A, role, 'invited')] } });
    const result = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_A, status: 'Suspendido' });
    assert.notEqual(result.status, 200);
    assert.equal(harness.calls.some((call) => call.method === 'PATCH'), false);
  }
});

test('E6 owner/admin suspended quedan denegados', sequential, async () => {
  for (const role of ['owner', 'admin']) {
    const harness = installServerHarness({ requesterRows: { [ORG_A]: [member(ORG_A, role, 'suspended')] } });
    const result = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_A, status: 'Suspendido' });
    assert.notEqual(result.status, 200);
    assert.equal(harness.calls.some((call) => call.method === 'PATCH'), false);
  }
});

test('E7 status missing o desconocido falla cerrado', sequential, async () => {
  for (const status of [undefined, 'unknown']) {
    const harness = installServerHarness({ requesterRows: { [ORG_A]: [member(ORG_A, 'owner', status)] } });
    const result = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_A, status: 'Suspendido' });
    assert.notEqual(result.status, 200);
    assert.equal(harness.calls.some((call) => call.method === 'PATCH'), false);
  }
});

test('E8 membership de otra organización no autoriza scope actual', sequential, async () => {
  const harness = installServerHarness({ requesterRows: { [ORG_A]: [member(ORG_B, 'owner')] } });
  const result = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_A, status: 'Suspendido' });
  assert.notEqual(result.status, 200);
  assert.equal(harness.calls.some((call) => call.method === 'PATCH'), false);
});

test('E9 actor sin membership ACTIVE exacta falla cerrado', sequential, async () => {
  const harness = installServerHarness({ requesterRows: { [ORG_A]: [] } });
  const result = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_A, status: 'Suspendido' });
  assert.notEqual(result.status, 200);
  assert.equal(harness.calls.some((call) => call.method === 'PATCH'), false);
});

test('E10 invite cliente transporta organizationId exacto del TenantScope', sequential, async () => {
  const tenantScope = resetClientRuntime(ORG_A);
  const harness = installClientHarness();
  await inviteTeamMember({ name: 'Nuevo', email: 'nuevo@example.com', role: 'Corredor' }, tenantScope);
  assert.deepEqual(harness.calls[0]?.body, {
    name: 'Nuevo', email: 'nuevo@example.com', role: 'Corredor', organizationId: ORG_A,
  });
});

test('E11 update member cliente transporta organizationId exacto del TenantScope', sequential, async () => {
  const tenantScope = resetClientRuntime(ORG_B);
  const harness = installClientHarness();
  await updateTeamMemberAccess(9, { status: 'Suspendido' }, tenantScope);
  assert.equal(harness.calls[0]?.body?.organizationId, ORG_B);
  assert.equal(harness.calls[0]?.url, '/api/team/members/9');
});

test('E12 target member de otra organización falla cerrado sin PATCH', sequential, async () => {
  const harness = installServerHarness({
    requesterRows: { [ORG_A]: [member(ORG_A, 'owner')] },
    targetRows: { [`${ORG_A}:9`]: [target(9, ORG_B)] },
  });
  const result = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_A, status: 'Suspendido' });
  assert.notEqual(result.status, 200);
  assert.equal(harness.calls.some((call) => call.method === 'PATCH'), false);
});

test('E13 member response con organization_id distinto falla cerrado en cliente', sequential, async () => {
  const tenantScope = resetClientRuntime(ORG_A);
  installClientHarness({ responseOrganizationId: ORG_B });
  await assert.rejects(
    updateTeamMemberAccess(9, { status: 'Suspendido' }, tenantScope),
    new RegExp(TENANT_TEAM_RESPONSE_ORGANIZATION_MISMATCH),
  );
});

test('E14 seat-limit y active-seat consultan exclusivamente la organización activa', sequential, async () => {
  const harness = installServerHarness({
    requesterRows: { [ORG_A]: [member(ORG_A, 'owner')] },
    seatLimits: { [ORG_A]: 5 },
    seatRows: { [ORG_A]: [member(ORG_A, 'owner')] },
  });
  const result = await serverMutation('/api/team/invitations', 'POST', {
    organizationId: ORG_A,
    name: 'Invitado',
    email: 'invite@example.com',
    role: 'Corredor',
  });
  assert.equal(result.status, 201);
  const urls = harness.calls.map((call) => new URL(call.url));
  const seatLimit = urls.find((url) => url.pathname === '/rest/v1/organizations');
  const seatCount = urls.find((url) => url.pathname === '/rest/v1/organization_members'
    && url.searchParams.get('select') === 'organization_id,member_id,status');
  assert.equal(seatLimit?.searchParams.get('id'), `eq.${ORG_A}`);
  assert.equal(seatCount?.searchParams.get('organization_id'), `eq.${ORG_A}`);
});

test('E15 existing-member lookup queda limitado a organizationId activo', sequential, async () => {
  const email = 'existing@example.com';
  const harness = installServerHarness({
    requesterRows: { [ORG_A]: [member(ORG_A, 'owner')] },
    existingRows: { [`${ORG_A}:${email}`]: [member(ORG_A, 'agent', 'active', 20, 'generated-user')] },
    generatedUserId: 'generated-user',
  });
  const result = await serverMutation('/api/team/invitations', 'POST', {
    organizationId: ORG_A,
    name: 'Existing',
    email,
    role: 'Corredor',
  });
  assert.equal(result.status, 200);
  const lookup = harness.calls
    .map((call) => new URL(call.url))
    .find((url) => url.pathname === '/rest/v1/organization_members' && url.searchParams.has('email'));
  assert.equal(lookup?.searchParams.get('organization_id'), `eq.${ORG_A}`);
  assert.equal(lookup?.searchParams.get('email'), `eq.${email}`);
});

test('E16 path Team canónico ya no selecciona tenant con limit=1 ni rows[0]', sequential, () => {
  const server = readFileSync('src/server/team-management.ts', 'utf8');
  const requesterStart = server.indexOf('async function requesterMembership');
  const requesterEnd = server.indexOf('async function organizationMemberByEmail', requesterStart);
  const requester = server.slice(requesterStart, requesterEnd);
  assert.match(requester, /user_id.*userId/);
  assert.match(requester, /organization_id.*organizationId/);
  assert.match(requester, /status.*eq\.active/);
  assert.doesNotMatch(requester, /limit['"],\s*['"]1|rows\s*\[\s*0\s*\]/);

  const teamPath = server.slice(server.indexOf('function requestedOrganizationId'));
  assert.doesNotMatch(teamPath, /searchParams\.set\(['"]limit['"],\s*['"]1['"]\)/);
  assert.doesNotMatch(teamPath, /rows\s*\[\s*0\s*\]/);
});

test('E17 A→B completion Team tardía queda stale antes de alcanzar efectos UI B', sequential, async () => {
  const aScope = resetClientRuntime(ORG_A);
  const started = deferred();
  const release = deferred();
  installClientHarness({ started, release });
  const pending = inviteTeamMember({ name: 'A', email: 'a@example.com', role: 'Corredor' }, aScope);
  await started.promise;
  installTenantRuntimeScope(scope(ORG_B), USER);
  release.resolve();
  await assert.rejects(pending, /TENANT_RUNTIME_STALE/);

  const ui = readFileSync('src/legacy-quarantine/team-ui.ts', 'utf8');
  assert.match(ui, /\.then\(\(member\) => \{\s*assertTenantRuntimeLeaseCurrent\(runtimeLease\);\s*replaceMember\(member\)/);
  assert.match(ui, /if \(!tenantRuntimeLeaseIsCurrent\(runtimeLease\)\) return;/);
});

test('E18 A→B→A mantiene stale la generación A1', sequential, async () => {
  const a1Scope = resetClientRuntime(ORG_A);
  const started = deferred();
  const release = deferred();
  installClientHarness({ started, release });
  const pending = updateTeamMemberAccess(9, { status: 'Suspendido' }, a1Scope);
  await started.promise;
  installTenantRuntimeScope(scope(ORG_B), USER);
  installTenantRuntimeScope(scope(ORG_A), USER);
  release.resolve();
  await assert.rejects(pending, /TENANT_RUNTIME_STALE/);
});

test('E19 single-org owner ACTIVE conserva update funcional normal', sequential, async () => {
  installServerHarness({
    requesterRows: { [ORG_A]: [member(ORG_A, 'owner')] },
    targetRows: { [`${ORG_A}:9`]: [target()] },
  });
  const result = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_A, status: 'Suspendido' });
  assert.equal(result.status, 200);
  assert.equal(result.body.member.organization_id, ORG_A);
  assert.equal(result.body.member.status, 'suspended');
});

test('E20 owner/admin ACTIVE normales conservan administración permitida de agentes', sequential, async () => {
  const harness = installServerHarness({
    requesterRows: {
      [ORG_A]: [member(ORG_A, 'owner')],
      [ORG_B]: [member(ORG_B, 'admin')],
    },
    targetRows: {
      [`${ORG_A}:9`]: [target()],
      [`${ORG_B}:9`]: [target(9, ORG_B)],
    },
  });
  const ownerResult = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_A, role: 'Corredor' });
  const adminResult = await serverMutation('/api/team/members/9', 'PATCH', { organizationId: ORG_B, status: 'Suspendido' });
  assert.equal(ownerResult.status, 200);
  assert.equal(adminResult.status, 200);
  actorQuery(harness.calls, ORG_A);
  actorQuery(harness.calls, ORG_B);
});
