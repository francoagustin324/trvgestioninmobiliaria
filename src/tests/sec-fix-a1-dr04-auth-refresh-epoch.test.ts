import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getCloudMembershipContext,
  getCloudSession,
  signInCloud,
  signOutCloud,
  type CloudSession,
} from '../cloud-api.js';

const SESSION_KEY = 'propcontrol-cloud-session-v1';
const ORG = '00000000-0000-0000-0000-00000000d401';

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
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

type AuthFixture = Readonly<{
  userId: string;
  accessToken: string;
  refreshToken: string;
  email?: string;
}>;

type RefreshRequest = Readonly<{
  refreshToken: string;
  response: Deferred<Response>;
}>;

function authPayload(fixture: AuthFixture) {
  return {
    access_token: fixture.accessToken,
    refresh_token: fixture.refreshToken,
    expires_in: 3600,
    user: { id: fixture.userId, email: fixture.email ?? `${fixture.userId}@example.com` },
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

class AuthHarness {
  readonly storage = new MemoryStorage();
  readonly refreshRequests: RefreshRequest[] = [];
  private readonly refreshWaiters = new Map<number, Deferred<RefreshRequest>>();
  private readonly loginResponses: AuthFixture[] = [];

  constructor() {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: this.storage,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: { dispatchEvent: () => true },
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: this.fetch,
    });
  }

  setExpiredSession(fixture: AuthFixture): void {
    const session: CloudSession = {
      accessToken: fixture.accessToken,
      refreshToken: fixture.refreshToken,
      expiresAt: Date.now() - 1_000,
      userId: fixture.userId,
      email: fixture.email ?? `${fixture.userId}@example.com`,
    };
    this.storage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  expireCurrentSession(): void {
    const session = getCloudSession();
    if (!session) throw new Error('DR-04 esperaba una sesión current para vencer.');
    this.storage.setItem(SESSION_KEY, JSON.stringify({ ...session, expiresAt: Date.now() - 1_000 }));
  }

  queueLogin(fixture: AuthFixture): void {
    this.loginResponses.push(fixture);
  }

  waitForRefresh(index: number): Promise<RefreshRequest> {
    const existing = this.refreshRequests[index];
    if (existing) return Promise.resolve(existing);
    const waiter = deferred<RefreshRequest>();
    this.refreshWaiters.set(index, waiter);
    return waiter.promise;
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
      const index = this.refreshRequests.push(request) - 1;
      this.refreshWaiters.get(index)?.resolve(request);
      this.refreshWaiters.delete(index);
      return request.response.promise;
    }

    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const next = this.loginResponses.shift();
      if (!next) throw new Error('DR-04 login response no configurada.');
      return json(authPayload(next));
    }

    if (url.pathname.endsWith('/rest/v1/rpc/activate_my_organization_memberships') && method === 'POST') {
      return json({});
    }

    if (url.pathname.endsWith('/rest/v1/organization_members') && method === 'GET') {
      const session = getCloudSession();
      if (!session) throw new Error('DR-04 membership request sin sesión current.');
      return json([{
        organization_id: ORG,
        member_id: 1,
        user_id: session.userId,
        role: 'owner',
        status: 'active',
        display_name: 'DR04 User',
        email: session.email,
        created_at: '2026-09-09T00:00:00.000Z',
      }]);
    }

    throw new Error(`DR-04 unexpected ${method} ${url}`);
  };
}

function fixture(userId: string, suffix: string): AuthFixture {
  return Object.freeze({
    userId,
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    email: `${userId}@example.com`,
  });
}

test('DR-04 refresh normal guarda renewed y conserva flujo current', async () => {
  const harness = new AuthHarness();
  const old = fixture('user-dr04-normal', 'normal-old');
  const renewed = fixture(old.userId, 'normal-renewed');
  harness.setExpiredSession(old);

  const contextPromise = getCloudMembershipContext();
  const refresh = await harness.waitForRefresh(0);
  assert.equal(refresh.refreshToken, old.refreshToken);
  refresh.response.resolve(json(authPayload(renewed)));

  const context = await contextPromise;
  assert.equal(context.organizationId, ORG);
  assert.equal(getCloudSession()?.accessToken, renewed.accessToken);
  assert.equal(getCloudSession()?.refreshToken, renewed.refreshToken);
});

test('DR-04 refresh pending + logout + success mantiene sesión null', async () => {
  const harness = new AuthHarness();
  const old = fixture('user-dr04-logout', 'logout-old');
  harness.setExpiredSession(old);

  const pending = getCloudMembershipContext();
  const refresh = await harness.waitForRefresh(0);
  signOutCloud();
  assert.equal(getCloudSession(), null);

  refresh.response.resolve(json(authPayload(fixture(old.userId, 'logout-stale-success'))));
  await assert.rejects(pending, /La sesión venció/);
  assert.equal(getCloudSession(), null);
});

test('DR-04 refresh pending + logout + login nuevo + stale success no pisa sesión nueva', async () => {
  const harness = new AuthHarness();
  const old = fixture('user-dr04-old', 'replace-old');
  const fresh = fixture('user-dr04-new', 'replace-new');
  harness.setExpiredSession(old);

  const pending = getCloudMembershipContext();
  const refresh = await harness.waitForRefresh(0);
  signOutCloud();
  harness.queueLogin(fresh);
  await signInCloud(fresh.email!, 'password');

  refresh.response.resolve(json(authPayload(fixture(old.userId, 'replace-stale-success'))));
  await assert.rejects(pending, /La sesión venció/);
  assert.equal(getCloudSession()?.userId, fresh.userId);
  assert.equal(getCloudSession()?.accessToken, fresh.accessToken);
  assert.equal(getCloudSession()?.refreshToken, fresh.refreshToken);
});

test('DR-04 refresh pending + logout + login nuevo + stale failure no borra sesión nueva', async () => {
  const harness = new AuthHarness();
  const old = fixture('user-dr04-fail-old', 'fail-old');
  const fresh = fixture('user-dr04-fail-new', 'fail-new');
  harness.setExpiredSession(old);

  const pending = getCloudMembershipContext();
  const refresh = await harness.waitForRefresh(0);
  signOutCloud();
  harness.queueLogin(fresh);
  await signInCloud(fresh.email!, 'password');

  refresh.response.reject(new Error('refresh viejo falló'));
  await assert.rejects(pending, /La sesión venció/);
  assert.equal(getCloudSession()?.userId, fresh.userId);
  assert.equal(getCloudSession()?.accessToken, fresh.accessToken);
});

test('DR-04 mismo user pero nueva session conserva tokens nuevos frente a refresh viejo', async () => {
  const harness = new AuthHarness();
  const old = fixture('user-dr04-same', 'same-old');
  const fresh = fixture(old.userId, 'same-new-login');
  harness.setExpiredSession(old);

  const pending = getCloudMembershipContext();
  const refresh = await harness.waitForRefresh(0);
  harness.queueLogin(fresh);
  await signInCloud(fresh.email!, 'password');

  refresh.response.resolve(json(authPayload(fixture(old.userId, 'same-stale-refresh'))));
  await assert.rejects(pending, /La sesión venció/);
  assert.equal(getCloudSession()?.userId, old.userId);
  assert.equal(getCloudSession()?.accessToken, fresh.accessToken);
  assert.equal(getCloudSession()?.refreshToken, fresh.refreshToken);
});

test('DR-04 distinto user conserva sesión nueva frente a refresh viejo', async () => {
  const harness = new AuthHarness();
  const old = fixture('user-dr04-a', 'different-old');
  const fresh = fixture('user-dr04-b', 'different-new');
  harness.setExpiredSession(old);

  const pending = getCloudMembershipContext();
  const refresh = await harness.waitForRefresh(0);
  harness.queueLogin(fresh);
  await signInCloud(fresh.email!, 'password');

  refresh.response.resolve(json(authPayload(fixture(old.userId, 'different-stale-refresh'))));
  await assert.rejects(pending, /La sesión venció/);
  assert.equal(getCloudSession()?.userId, fresh.userId);
  assert.equal(getCloudSession()?.accessToken, fresh.accessToken);
});

test('DR-04 callers concurrentes del mismo epoch reutilizan un único refreshPromise', async () => {
  const harness = new AuthHarness();
  const old = fixture('user-dr04-dedupe', 'dedupe-old');
  const renewed = fixture(old.userId, 'dedupe-renewed');
  harness.setExpiredSession(old);

  const first = getCloudMembershipContext();
  const second = getCloudMembershipContext();
  const refresh = await harness.waitForRefresh(0);
  assert.equal(harness.refreshRequests.length, 1);

  refresh.response.resolve(json(authPayload(renewed)));
  await Promise.all([first, second]);
  assert.equal(harness.refreshRequests.length, 1);
  assert.equal(getCloudSession()?.accessToken, renewed.accessToken);
});

test('DR-04 nueva epoch no reutiliza autoridad ni refreshPromise viejo', async () => {
  const harness = new AuthHarness();
  const old = fixture('user-dr04-epoch-old', 'epoch-old');
  const fresh = fixture('user-dr04-epoch-new', 'epoch-login');
  const renewedFresh = fixture(fresh.userId, 'epoch-renewed-new');
  harness.setExpiredSession(old);

  const staleCall = getCloudMembershipContext();
  const oldRefresh = await harness.waitForRefresh(0);
  signOutCloud();
  harness.queueLogin(fresh);
  await signInCloud(fresh.email!, 'password');
  harness.expireCurrentSession();

  const freshCall = getCloudMembershipContext();
  const newRefresh = await harness.waitForRefresh(1);
  assert.equal(harness.refreshRequests.length, 2);
  assert.equal(oldRefresh.refreshToken, old.refreshToken);
  assert.equal(newRefresh.refreshToken, fresh.refreshToken);

  newRefresh.response.resolve(json(authPayload(renewedFresh)));
  await freshCall;
  oldRefresh.response.resolve(json(authPayload(fixture(old.userId, 'epoch-stale-old'))));
  await assert.rejects(staleCall, /La sesión venció/);

  assert.equal(getCloudSession()?.userId, fresh.userId);
  assert.equal(getCloudSession()?.accessToken, renewedFresh.accessToken);
});

test('DR-04 static: success stale se guarda sólo después de validar epoch exacto', () => {
  const source = readFileSync('src/cloud-api.ts', 'utf8');
  const start = source.indexOf('async function refreshCloudSession');
  const end = source.indexOf('async function requireSession');
  assert.ok(start >= 0 && end > start);
  const refresh = source.slice(start, end);

  assert.match(refresh, /const operationEpoch = authSessionEpoch/);
  const staleGuard = refresh.indexOf('if (!authSessionEpochIsCurrent(operationEpoch)) return null;');
  const storeRenewed = refresh.indexOf('storeSession(renewed);');
  assert.ok(staleGuard >= 0 && storeRenewed > staleGuard);
  assert.match(refresh, /refreshPromise\?\.epoch === operationEpoch/);
  assert.match(refresh, /refreshPromise\.promise === promise/);
});

test('DR-04 static: failure stale valida epoch antes de clear y auth replacements avanzan epoch antes de store', () => {
  const source = readFileSync('src/cloud-api.ts', 'utf8');
  const refreshStart = source.indexOf('async function refreshCloudSession');
  const requireStart = source.indexOf('async function requireSession');
  const refresh = source.slice(refreshStart, requireStart);
  const catchStart = refresh.indexOf('} catch {');
  const finallyStart = refresh.indexOf('} finally {');
  const catchBlock = refresh.slice(catchStart, finallyStart);

  assert.match(catchBlock, /if \(authSessionEpochIsCurrent\(operationEpoch\)\) \{[\s\S]*advanceAuthSessionEpoch\(\);[\s\S]*storeSession\(null\);/);

  const signOutStart = source.indexOf('export function signOutCloud');
  const signUpStart = source.indexOf('export async function signUpCloud');
  const signInStart = source.indexOf('export async function signInCloud');
  const refreshFunctionStart = source.indexOf('async function refreshCloudSession');
  const signOut = source.slice(signOutStart, signUpStart);
  const signUp = source.slice(signUpStart, signInStart);
  const signIn = source.slice(signInStart, refreshFunctionStart);

  assert.ok(signOut.indexOf('advanceAuthSessionEpoch();') < signOut.indexOf('storeSession(null);'));
  assert.match(signUp, /assertAuthSessionEpochCurrent\(operationEpoch\);[\s\S]*advanceAuthSessionEpoch\(\);[\s\S]*storeSession\(session\);/);
  assert.match(signIn, /assertAuthSessionEpochCurrent\(operationEpoch\);[\s\S]*advanceAuthSessionEpoch\(\);[\s\S]*storeSession\(session\);/);
});