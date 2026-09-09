import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import type { TenantScope } from '../active-organization.js';

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return Object.freeze({ promise, resolve, reject });
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  mutations = 0;
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); this.mutations += 1; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); this.mutations += 1; }
  setItem(key: string, value: string): void { this.values.set(key, value); this.mutations += 1; }
}

class FakeWindow {
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    const set = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    this.listeners.get(type)?.delete(listener);
  }

  dispatchStorage(key: string, oldValue: string | null, newValue: string | null): void {
    const event = {
      type: 'storage',
      key,
      oldValue,
      newValue,
      storageArea: sharedStorage,
      url: 'https://app.test/',
    } as unknown as StorageEvent;
    for (const listener of [...(this.listeners.get('storage') ?? [])]) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }

  setTimeout(handler: TimerHandler, timeout?: number, ...args: unknown[]): number {
    return globalThis.setTimeout(handler as (...args: unknown[]) => void, timeout, ...args) as unknown as number;
  }

  clearTimeout(id: number): void {
    globalThis.clearTimeout(id);
  }
}

const sharedStorage = new MemoryStorage();
const fakeWindow = new FakeWindow();
const locationState = { hash: '', pathname: '/' };
const historyCalls: string[] = [];

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  writable: true,
  value: fakeWindow,
});
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: sharedStorage,
});
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  writable: true,
  value: { dispatchEvent: () => true },
});
Object.defineProperty(globalThis, 'location', {
  configurable: true,
  writable: true,
  value: locationState,
});
Object.defineProperty(globalThis, 'history', {
  configurable: true,
  writable: true,
  value: { replaceState: (_state: unknown, _title: string, url: string) => historyCalls.push(url) },
});

const authState = await import('../auth-session-generation.js');
const cloudApi = await import('../cloud-api.js');
const invitationAuth = await import('../invitation-auth.js');
const tenantRuntime = await import('../tenant-runtime.js');

const ORG_A = '00000000-0000-0000-0000-00000000f201';
const ORG_B = '00000000-0000-0000-0000-00000000f202';

type AuthFixture = Readonly<{
  userId: string;
  accessToken: string;
  refreshToken: string;
  email: string;
}>;

type RefreshRequest = Readonly<{
  refreshToken: string;
  response: Deferred<Response>;
}>;

type LoginRequest = Readonly<{
  response: Deferred<Response>;
}>;

type InvitationUserRequest = Readonly<{
  response: Deferred<Response>;
}>;

function fixture(userId: string, suffix: string): AuthFixture {
  return Object.freeze({
    userId,
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    email: `${userId}@example.com`,
  });
}

function sessionFor(fixtureValue: AuthFixture, expired = false): cloudApi.CloudSession {
  return {
    accessToken: fixtureValue.accessToken,
    refreshToken: fixtureValue.refreshToken,
    expiresAt: Date.now() + (expired ? -1_000 : 3_600_000),
    userId: fixtureValue.userId,
    email: fixtureValue.email,
  };
}

function authPayload(value: AuthFixture): Record<string, unknown> {
  return {
    access_token: value.accessToken,
    refresh_token: value.refreshToken,
    expires_in: 3600,
    user: { id: value.userId, email: value.email },
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

class CrossTabHarness {
  readonly refreshRequests: RefreshRequest[] = [];
  readonly loginRequests: LoginRequest[] = [];
  readonly invitationUserRequests: InvitationUserRequest[] = [];
  teamRequests = 0;
  membershipRequests = 0;

  constructor() {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: this.fetch,
    });
  }

  waitForRefresh(index = 0): Promise<RefreshRequest> {
    const current = this.refreshRequests[index];
    if (current) return Promise.resolve(current);
    return new Promise((resolve) => {
      const poll = () => {
        const next = this.refreshRequests[index];
        if (next) resolve(next);
        else queueMicrotask(poll);
      };
      poll();
    });
  }

  waitForLogin(index = 0): Promise<LoginRequest> {
    const current = this.loginRequests[index];
    if (current) return Promise.resolve(current);
    return new Promise((resolve) => {
      const poll = () => {
        const next = this.loginRequests[index];
        if (next) resolve(next);
        else queueMicrotask(poll);
      };
      poll();
    });
  }

  waitForInvitationUser(index = 0): Promise<InvitationUserRequest> {
    const current = this.invitationUserRequests[index];
    if (current) return Promise.resolve(current);
    return new Promise((resolve) => {
      const poll = () => {
        const next = this.invitationUserRequests[index];
        if (next) resolve(next);
        else queueMicrotask(poll);
      };
      poll();
    });
  }

  private readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, 'https://app.test');
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    if (url.pathname === '/api/cloud-config') {
      return json({ configured: true, url: 'https://supabase.test', publishableKey: 'key' });
    }

    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { refresh_token?: string };
      const request = Object.freeze({
        refreshToken: String(body.refresh_token ?? ''),
        response: deferred<Response>(),
      });
      this.refreshRequests.push(request);
      return request.response.promise;
    }

    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const request = Object.freeze({ response: deferred<Response>() });
      this.loginRequests.push(request);
      return request.response.promise;
    }

    if (url.pathname === '/auth/v1/user' && method === 'GET') {
      const request = Object.freeze({ response: deferred<Response>() });
      this.invitationUserRequests.push(request);
      return request.response.promise;
    }

    if (url.pathname.endsWith('/rest/v1/rpc/activate_my_organization_memberships') && method === 'POST') {
      return json({});
    }

    if (url.pathname.endsWith('/rest/v1/organization_members') && method === 'GET') {
      this.membershipRequests += 1;
      const current = cloudApi.getCloudSession();
      if (!current) throw new Error('FDR-02 membership request sin sesión current.');
      return json([{
        organization_id: ORG_A,
        member_id: 1,
        user_id: current.userId,
        role: 'owner',
        status: 'active',
        display_name: 'FDR02 User',
        email: current.email,
        created_at: '2026-09-09T00:00:00.000Z',
      }]);
    }

    if (url.pathname === '/api/team/invitations' && method === 'POST') {
      this.teamRequests += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as { organizationId?: string };
      return json({
        success: true,
        member: {
          member_id: 22,
          user_id: 'invited-user',
          organization_id: body.organizationId,
          display_name: 'Invitado',
          email: 'invitado@example.com',
          role: 'agent',
          status: 'invited',
          created_at: '2026-09-09T00:00:00.000Z',
        },
      });
    }

    throw new Error(`FDR-02 unexpected ${method} ${url}`);
  };
}

function resetState(): void {
  sharedStorage.clear();
  locationState.hash = '';
  locationState.pathname = '/';
  historyCalls.length = 0;
  tenantRuntime.invalidateTenantRuntimeScope();
}

function seedLegacySession(value: AuthFixture, expired = true): void {
  sharedStorage.setItem(authState.CLOUD_SESSION_KEY, JSON.stringify(sessionFor(value, expired)));
}

function externalTabCommit(session: cloudApi.CloudSession | null): string {
  const before = authState.captureSharedAuthGeneration();
  const next = authState.commitSharedCloudSession(before, session);
  fakeWindow.dispatchStorage(
    authState.CLOUD_AUTH_GENERATION_KEY,
    before || null,
    next,
  );
  return next;
}

function scope(userId: string, organizationId = ORG_A): TenantScope {
  return Object.freeze({ userId, organizationId });
}

function installRuntime(userId: string): { scope: TenantScope; lease: tenantRuntime.TenantRuntimeLease } {
  const tenantScope = scope(userId);
  tenantRuntime.installTenantRuntimeScope(tenantScope, userId);
  return { scope: tenantScope, lease: tenantRuntime.captureTenantRuntimeLease(tenantScope) };
}

function productTsFiles(root = 'src'): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const rel = relative('.', full).replaceAll('\\', '/');
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (rel === 'src/tests') continue;
      files.push(...productTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      files.push(rel);
    }
  }
  return files.sort();
}

test('FDR02-01 refresh normal de una pestaña conserva flujo y rota shared generation', async () => {
  resetState();
  const harness = new CrossTabHarness();
  const old = fixture('fdr02-normal', 'normal-old');
  const renewed = fixture(old.userId, 'normal-renewed');
  seedLegacySession(old, true);

  const pending = cloudApi.getCloudMembershipContext();
  const refresh = await harness.waitForRefresh();
  assert.equal(refresh.refreshToken, old.refreshToken);
  refresh.response.resolve(json(authPayload(renewed)));

  const context = await pending;
  assert.equal(context.organizationId, ORG_A);
  assert.equal(cloudApi.getCloudSession()?.accessToken, renewed.accessToken);
  assert.notEqual(authState.captureSharedAuthGeneration(), '');
});

test('FDR02-02 TAB A refresh pending → TAB B logout → stale success no restaura sesión y lease A queda stale', async () => {
  resetState();
  const harness = new CrossTabHarness();
  const old = fixture('fdr02-logout-a', 'logout-old');
  seedLegacySession(old, true);
  const runtime = installRuntime(old.userId);

  const pending = cloudApi.getCloudMembershipContext();
  const refresh = await harness.waitForRefresh();
  externalTabCommit(null);
  assert.equal(cloudApi.getCloudSession(), null);
  assert.equal(tenantRuntime.tenantRuntimeLeaseIsCurrent(runtime.lease), false);

  refresh.response.resolve(json(authPayload(fixture(old.userId, 'logout-stale'))));
  await assert.rejects(pending, /La sesión venció/);
  assert.equal(cloudApi.getCloudSession(), null);
});

test('FDR02-03 TAB A refresh pending → TAB B login otro user → stale success no pisa B', async () => {
  resetState();
  const harness = new CrossTabHarness();
  const old = fixture('fdr02-user-a', 'different-old');
  const freshB = fixture('fdr02-user-b', 'different-b');
  seedLegacySession(old, true);

  const pending = cloudApi.getCloudMembershipContext();
  const refresh = await harness.waitForRefresh();
  externalTabCommit(sessionFor(freshB));
  refresh.response.resolve(json(authPayload(fixture(old.userId, 'different-stale-a'))));

  await assert.rejects(pending, /La sesión venció/);
  assert.equal(cloudApi.getCloudSession()?.userId, freshB.userId);
  assert.equal(cloudApi.getCloudSession()?.accessToken, freshB.accessToken);
});

test('FDR02-04 TAB A refresh pending → TAB B login B → stale failure no borra B', async () => {
  resetState();
  const harness = new CrossTabHarness();
  const old = fixture('fdr02-failure-a', 'failure-old');
  const freshB = fixture('fdr02-failure-b', 'failure-b');
  seedLegacySession(old, true);

  const pending = cloudApi.getCloudMembershipContext();
  const refresh = await harness.waitForRefresh();
  externalTabCommit(sessionFor(freshB));
  refresh.response.reject(new Error('refresh A falló tarde'));

  await assert.rejects(pending, /La sesión venció/);
  assert.equal(cloudApi.getCloudSession()?.userId, freshB.userId);
  assert.equal(cloudApi.getCloudSession()?.accessToken, freshB.accessToken);
});

test('FDR02-05 mismo user con sesión nueva en B conserva tokens nuevos frente a refresh A viejo', async () => {
  resetState();
  const harness = new CrossTabHarness();
  const old = fixture('fdr02-same-user', 'same-old');
  const fresh = fixture(old.userId, 'same-fresh-b');
  seedLegacySession(old, true);

  const pending = cloudApi.getCloudMembershipContext();
  const refresh = await harness.waitForRefresh();
  externalTabCommit(sessionFor(fresh));
  refresh.response.resolve(json(authPayload(fixture(old.userId, 'same-stale-a'))));

  await assert.rejects(pending, /La sesión venció/);
  assert.equal(cloudApi.getCloudSession()?.accessToken, fresh.accessToken);
  assert.equal(cloudApi.getCloudSession()?.refreshToken, fresh.refreshToken);
});

test('FDR02-06 storage event cross-tab invalida TenantRuntime y no reemite writes', () => {
  resetState();
  const user = fixture('fdr02-runtime', 'runtime-a');
  const runtime = installRuntime(user.userId);
  const beforeGeneration = authState.captureSharedAuthGeneration();
  const nextGeneration = authState.commitSharedCloudSession(beforeGeneration, sessionFor(user));
  const mutationsBeforeEvent = sharedStorage.mutations;

  fakeWindow.dispatchStorage(
    authState.CLOUD_AUTH_GENERATION_KEY,
    beforeGeneration || null,
    nextGeneration,
  );

  assert.equal(tenantRuntime.tenantRuntimeLeaseIsCurrent(runtime.lease), false);
  assert.equal(tenantRuntime.currentTenantScope(), null);
  assert.equal(sharedStorage.mutations, mutationsBeforeEvent);
});

test('FDR02-07 Team mutation no alcanza POST si auth cambia cross-tab durante requireSession/refresh', async () => {
  resetState();
  const harness = new CrossTabHarness();
  const old = fixture('fdr02-team-a', 'team-old');
  const freshB = fixture('fdr02-team-b', 'team-b');
  seedLegacySession(old, true);
  const runtime = installRuntime(old.userId);

  const pending = cloudApi.inviteTeamMember(
    { name: 'Nuevo', email: 'nuevo@example.com', role: 'Corredor' },
    runtime.scope,
    runtime.lease,
  );
  const refresh = await harness.waitForRefresh();
  externalTabCommit(sessionFor(freshB));
  refresh.response.resolve(json(authPayload(fixture(old.userId, 'team-stale-a'))));

  await assert.rejects(pending);
  assert.equal(harness.teamRequests, 0);
  assert.equal(cloudApi.getCloudSession()?.userId, freshB.userId);
});

test('FDR02-08 Team mutation current normal conserva POST material permitido', async () => {
  resetState();
  const harness = new CrossTabHarness();
  const owner = fixture('fdr02-team-current', 'team-current');
  authState.commitSharedCloudSession(authState.captureSharedAuthGeneration(), sessionFor(owner));
  const runtime = installRuntime(owner.userId);

  const member = await cloudApi.inviteTeamMember(
    { name: 'Nuevo', email: 'nuevo@example.com', role: 'Corredor' },
    runtime.scope,
    runtime.lease,
  );

  assert.equal(harness.teamRequests, 1);
  assert.equal(member.email, 'invitado@example.com');
});

test('FDR02-09 invitation auth stale no escribe sesión si otra pestaña cambia auth', async () => {
  resetState();
  const harness = new CrossTabHarness();
  const freshB = fixture('fdr02-invite-b', 'invite-b');
  locationState.hash = '#type=invite&access_token=invite-access-a&refresh_token=invite-refresh-a&expires_in=3600';

  const pending = invitationAuth.consumeInvitationSessionFromUrl();
  const userRequest = await harness.waitForInvitationUser();
  externalTabCommit(sessionFor(freshB));
  userRequest.response.resolve(json({ id: 'fdr02-invite-a', email: 'invite-a@example.com' }));

  await assert.rejects(pending, /AUTH_SHARED_GENERATION_STALE/);
  assert.equal(cloudApi.getCloudSession()?.userId, freshB.userId);
  assert.equal(cloudApi.getCloudSession()?.accessToken, freshB.accessToken);
  assert.equal(sharedStorage.getItem('propcontrol-pending-invitation-v1'), null);
});

test('FDR02-10 pending signIn A no puede pisar sesión B comprometida cross-tab', async () => {
  resetState();
  const harness = new CrossTabHarness();
  const freshB = fixture('fdr02-login-b', 'login-b');
  const staleA = fixture('fdr02-login-a', 'login-a');

  const pending = cloudApi.signInCloud(staleA.email, 'password');
  const login = await harness.waitForLogin();
  externalTabCommit(sessionFor(freshB));
  login.response.resolve(json(authPayload(staleA)));

  await assert.rejects(pending, /AUTH_SESSION_STALE|AUTH_SHARED_GENERATION_STALE/);
  assert.equal(cloudApi.getCloudSession()?.userId, freshB.userId);
  assert.equal(cloudApi.getCloudSession()?.accessToken, freshB.accessToken);
});

test('FDR02-11 SESSION_KEY productivo tiene un único owner/writer contract', () => {
  const literal = 'propcontrol-cloud-session-v1';
  const matches = productTsFiles()
    .filter((file) => readFileSync(file, 'utf8').includes(literal));
  assert.deepEqual(matches, ['src/auth-session-generation.ts']);

  const owner = readFileSync('src/auth-session-generation.ts', 'utf8');
  assert.match(owner, /storage\.setItem\(CLOUD_SESSION_KEY, JSON\.stringify\(stored\)\)/);
  assert.match(owner, /storage\.removeItem\(CLOUD_SESSION_KEY\)/);
  assert.match(owner, /storage\.setItem\(CLOUD_AUTH_GENERATION_KEY, nextGeneration\)/);

  const cloudSource = readFileSync('src/cloud-api.ts', 'utf8');
  const invitationSource = readFileSync('src/invitation-auth.ts', 'utf8');
  assert.doesNotMatch(cloudSource, /localStorage\.(?:setItem|removeItem)\([^\n]*SESSION/);
  assert.doesNotMatch(invitationSource, /localStorage\.(?:setItem|removeItem)\([^\n]*SESSION/);
});

test('FDR02-12 static contract: shared event invalida runtime/epoch, stale guards preceden side-effects', () => {
  const sharedSource = readFileSync('src/auth-session-generation.ts', 'utf8');
  const cloudSource = readFileSync('src/cloud-api.ts', 'utf8');
  const invitationSource = readFileSync('src/invitation-auth.ts', 'utf8');

  const eventStart = sharedSource.indexOf('function handleCrossTabStorageEvent');
  const bindStart = sharedSource.indexOf('function bindCrossTabStorageListener');
  const eventBlock = sharedSource.slice(eventStart, bindStart);
  assert.match(eventBlock, /invalidateTenantRuntimeScope\(\)/);
  assert.doesNotMatch(eventBlock, /setItem|removeItem|commitSharedCloudSession/);

  assert.match(cloudSource, /subscribeCrossTabAuthGeneration\(\(\) => \{[\s\S]*advanceAuthSessionEpoch\(\)/);
  assert.match(cloudSource, /assertSharedAuthGenerationCurrent\(operationSharedGeneration\);[\s\S]*advanceAuthSessionEpoch\(\);[\s\S]*storeSession\(session\);/);
  assert.match(cloudSource, /if \(!sharedAuthGenerationIsCurrent\(operationSharedGeneration\)\) return null;[\s\S]*storeSession\(renewed\);/);
  assert.match(cloudSource, /const authGeneration = captureSharedAuthGeneration\(\);[\s\S]*assertSharedCloudSessionCurrent\(authGeneration, session\);[\s\S]*fetch\(path/);

  assert.match(invitationSource, /const operationSharedGeneration = captureSharedAuthGeneration\(\);[\s\S]*assertSharedAuthGenerationCurrent\(operationSharedGeneration\);[\s\S]*commitSharedCloudSession\(operationSharedGeneration, session\)/);
});
