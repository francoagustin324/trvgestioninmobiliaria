import './sec-fix-a1-2-c2-test-setup.js';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test, { afterEach } from 'node:test';
import { chromium } from 'playwright';
import type { TenantScope } from '../active-organization.js';
import {
  AUTH_SHARED_GENERATION_STALE,
  CLOUD_AUTH_GENERATION_KEY,
  CLOUD_SESSION_KEY,
  captureSharedAuthGeneration,
  commitSharedCloudSession,
  type SharedCloudSession,
} from '../auth-session-generation.js';
import type { CrmData } from '../models.js';
import { initialData } from '../models.js';
import { state } from '../store.js';
import {
  TENANT_CLOUD_MEMBERSHIP_REQUIRED,
  TenantCloudAuthorityError,
  isTenantCloudAuthorityFailure,
  tenantCloudTransport,
} from '../tenant-cloud-context.js';
import {
  hydrateTenantAfterAuth,
  isHydrationAuthorityFailure,
  resolveTenantScopeForAuthenticatedSession,
} from '../tenant-hydration.js';
import {
  currentTenantScope,
  invalidateTenantRuntimeScope,
} from '../tenant-runtime.js';
import {
  readTenantSyncState,
  tenantStorageNamespace,
  writeTenantSnapshot,
} from '../tenant-storage.js';

const USER_A = 'a34-user-a';
const USER_B = 'a34-user-b';
const ORG_X = '00000000-0000-0000-0000-00000000a344';
const SECRET = 'A34-SENSITIVE-TENANT-X';
const TRANSIENT = 'A34_TRANSIENT_NETWORK';
const originalFetch = globalThis.fetch;

function session(userId: string, suffix: string): SharedCloudSession {
  return Object.freeze({
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    expiresAt: Date.now() + 3_600_000,
    userId,
    email: `${userId}@example.test`,
  });
}

function membership(
  userId = USER_A,
  status = 'active',
  role = 'agent',
): Record<string, unknown> {
  return {
    organization_id: ORG_X,
    member_id: 344,
    user_id: userId,
    role,
    status,
    display_name: 'A34 User',
    email: `${userId}@example.test`,
    phone: null,
    created_at: '2026-09-13T12:00:00.000Z',
    last_active_at: '2026-09-13T12:00:00.000Z',
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return Object.freeze({ promise, resolve, reject });
}

class MembershipHarness {
  readonly catalogRequests: Array<Deferred<Response>> = [];
  readonly exactMembershipRequests: Array<Deferred<Response>> = [];
  deferCatalog = false;
  deferExactMembership = false;
  catalogStatus = 'active';
  exactMembershipStatus: 'active' | 'suspended' | 'missing' = 'active';
  role = 'agent';
  failPropcontrolRecords = false;
  exactRequestCount = 0;

  constructor() {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: this.fetch,
    });
  }

  async waitForCatalog(index = 0): Promise<Deferred<Response>> {
    return this.waitFor(this.catalogRequests, index, 'membership catalog');
  }

  async waitForExactMembership(index = 0): Promise<Deferred<Response>> {
    return this.waitFor(this.exactMembershipRequests, index, 'exact membership');
  }

  private async waitFor(
    requests: Array<Deferred<Response>>,
    index: number,
    label: string,
  ): Promise<Deferred<Response>> {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const request = requests[index];
      if (request) return request;
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    }
    throw new Error(`A3.4 harness did not observe ${label} request.`);
  }

  private readonly fetch = async (input: string | URL | Request): Promise<Response> => {
    const raw = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, 'https://app.test');

    if (url.pathname === '/api/cloud-config') {
      return json({ configured: true, url: 'https://supabase.test', publishableKey: 'a34-key' });
    }

    if (url.pathname.endsWith('/rest/v1/organization_members')) {
      if (url.searchParams.has('user_id')) {
        if (!this.deferCatalog) return json([membership(USER_A, this.catalogStatus, this.role)]);
        const request = deferred<Response>();
        this.catalogRequests.push(request);
        return request.promise;
      }
      if (url.searchParams.has('organization_id')) {
        this.exactRequestCount += 1;
        if (this.deferExactMembership) {
          const request = deferred<Response>();
          this.exactMembershipRequests.push(request);
          return request.promise;
        }
        if (this.exactMembershipStatus === 'missing') return json([]);
        return json([membership(USER_A, this.exactMembershipStatus, this.role)]);
      }
    }

    if (url.pathname.endsWith('/rest/v1/rpc/visit_transaction_authority_active_v2')) {
      return json(false);
    }

    if (url.pathname.endsWith('/rest/v1/propcontrol_records')) {
      if (this.failPropcontrolRecords) throw new Error(TRANSIENT);
      if ((input instanceof Request ? input.method : 'GET') === 'POST') return json({}, 201);
      return json([]);
    }

    if (url.pathname.endsWith('/rest/v1/fichas')) return json([]);

    throw new Error(`A3.4 unexpected fetch: ${url.toString()}`);
  };
}

function resetNodeState(): void {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
  localStorage.clear();
  invalidateTenantRuntimeScope();
  state.crm = structuredClone(initialData);
}

afterEach(() => resetNodeState());

function commitSession(expectedGeneration: string, next: SharedCloudSession): string {
  return commitSharedCloudSession(expectedGeneration, next);
}

function scopeX(): TenantScope {
  return Object.freeze({ userId: USER_A, organizationId: ORG_X });
}

function sensitiveCrm(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = ORG_X;
  crm.organization.name = SECRET;
  crm.teamMembers = [{
    id: 344,
    userId: USER_A,
    name: 'Sensitive User',
    email: 'a34-user-a@example.test',
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-09-13T12:00:00.000Z',
  }];
  crm.clients = [{
    id: 9344,
    name: SECRET,
    phone: '3515559344',
    interest: 'Compra',
    status: 'Activo',
    temperature: 'Caliente',
    pipeline: 'Nuevo',
    assignedToId: 344,
    createdById: 344,
  }];
  crm.properties = [];
  crm.visits = [];
  crm.offers = [];
  crm.reservations = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.activityLog = [];
  return crm;
}

async function staleCatalogRace(sameUser = false): Promise<void> {
  const harness = new MembershipHarness();
  harness.deferCatalog = true;
  const g1 = commitSession(captureSharedAuthGeneration(), session(USER_A, sameUser ? 'same-g1' : 'a-g1'));
  const resolution = resolveTenantScopeForAuthenticatedSession();
  const pendingCatalog = await harness.waitForCatalog();
  if (sameUser) {
    commitSession(g1, session(USER_A, 'same-g2-new-token'));
  } else {
    const g2 = commitSession(g1, session(USER_B, 'b-g2'));
    commitSession(g2, session(USER_A, 'a-g3'));
  }
  pendingCatalog.resolve(json([membership(USER_A, 'active', 'agent')]));
  await assert.rejects(resolution, new RegExp(AUTH_SHARED_GENERATION_STALE));
}

test('A3.4 R1: A/G1 -> B/G2 -> A/G3 rejects the G1 membership catalog result', async () => {
  resetNodeState();
  await staleCatalogRace(false);
});

test('A3.4 R2: same user with new generation/tokens rejects the old catalog result', async () => {
  resetNodeState();
  await staleCatalogRace(true);
});

test('A3.4 R3: stale catalog authority cannot activate an existing tenant snapshot into state.crm', async () => {
  resetNodeState();
  const harness = new MembershipHarness();
  harness.deferCatalog = true;
  writeTenantSnapshot(scopeX(), sensitiveCrm(), { markDirty: true, reason: 'A3.4 synthetic pending snapshot', backup: false });

  const g1 = commitSession(captureSharedAuthGeneration(), session(USER_A, 'r3-g1'));
  const hydration = hydrateTenantAfterAuth();
  const pendingCatalog = await harness.waitForCatalog();
  const g2 = commitSession(g1, session(USER_B, 'r3-g2'));
  commitSession(g2, session(USER_A, 'r3-g3'));
  pendingCatalog.resolve(json([membership(USER_A, 'active', 'agent')]));

  await assert.rejects(hydration, new RegExp(AUTH_SHARED_GENERATION_STALE));
  assert.notEqual(state.crm.organization.name, SECRET);
  assert.equal(currentTenantScope(), null);
});

test('A3.4 R4: bootstrap hydration failure path contains no product render/bind calls', () => {
  const source = readFileSync('src/mvp-main.ts', 'utf8');
  const hydrate = source.indexOf('await hydrateAuthenticatedSession();');
  assert.ok(hydrate >= 0);
  const catchStart = source.indexOf('} catch (error) {', hydrate);
  assert.ok(catchStart >= 0);
  const catchEnd = source.indexOf('\n  }\n}\n\nvoid bootstrap();', catchStart);
  assert.ok(catchEnd > catchStart);
  const failurePath = source.slice(catchStart, catchEnd);
  assert.equal(/\brenderShell\(\)|\bbindEvents\(\)|\brender\(\)/.test(failurePath), false);
  assert.match(failurePath, /invalidateTenantRuntimeScope\(\)/);
  assert.match(failurePath, /renderSafeBootstrapFailure\(/);
});

test('A3.4 R5: A->B->A stale catalog cannot reach activateStorageForTenant', async () => {
  resetNodeState();
  const harness = new MembershipHarness();
  harness.deferCatalog = true;
  writeTenantSnapshot(scopeX(), sensitiveCrm(), { markDirty: false, reason: 'A3.4 R5 fixture', backup: false });
  const g1 = commitSession(captureSharedAuthGeneration(), session(USER_A, 'r5-g1'));
  const hydration = hydrateTenantAfterAuth();
  const pending = await harness.waitForCatalog();
  const g2 = commitSession(g1, session(USER_B, 'r5-g2'));
  commitSession(g2, session(USER_A, 'r5-g3'));
  pending.resolve(json([membership(USER_A, 'active', 'agent')]));
  await assert.rejects(hydration, new RegExp(AUTH_SHARED_GENERATION_STALE));
  assert.notEqual(state.crm.organization.name, SECRET);
  assert.equal(currentTenantScope(), null);
});

test('A3.4 R6: same-user new generation cannot reach tenant storage activation', async () => {
  resetNodeState();
  const harness = new MembershipHarness();
  harness.deferCatalog = true;
  writeTenantSnapshot(scopeX(), sensitiveCrm(), { markDirty: false, reason: 'A3.4 R6 fixture', backup: false });
  const g1 = commitSession(captureSharedAuthGeneration(), session(USER_A, 'r6-g1'));
  const hydration = hydrateTenantAfterAuth();
  const pending = await harness.waitForCatalog();
  commitSession(g1, session(USER_A, 'r6-g2-new-token'));
  pending.resolve(json([membership(USER_A, 'active', 'agent')]));
  await assert.rejects(hydration, new RegExp(AUTH_SHARED_GENERATION_STALE));
  assert.notEqual(state.crm.organization.name, SECRET);
  assert.equal(currentTenantScope(), null);
});

test('A3.4 R7: revoked/suspended exact membership blocks snapshot, runtime and CRM activation', async () => {
  resetNodeState();
  const harness = new MembershipHarness();
  harness.exactMembershipStatus = 'suspended';
  writeTenantSnapshot(scopeX(), sensitiveCrm(), { markDirty: false, reason: 'A3.4 R7 fixture', backup: false });
  commitSession(captureSharedAuthGeneration(), session(USER_A, 'r7'));

  await assert.rejects(
    hydrateTenantAfterAuth(),
    (error: unknown) => error instanceof TenantCloudAuthorityError
      && error.code === TENANT_CLOUD_MEMBERSHIP_REQUIRED,
  );
  assert.notEqual(state.crm.organization.name, SECRET);
  assert.equal(currentTenantScope(), null);
});

test('A3.4 R8: stable generation + exact ACTIVE membership preserves normal hydration happy path', async () => {
  resetNodeState();
  const harness = new MembershipHarness();
  harness.role = 'agent';
  const generation = commitSession(captureSharedAuthGeneration(), session(USER_A, 'r8-stable'));
  const scope = await hydrateTenantAfterAuth();
  assert.equal(scope.userId, USER_A);
  assert.equal(scope.organizationId, ORG_X);
  assert.deepEqual(currentTenantScope(), scope);
  assert.equal(state.crm.organization.id, ORG_X);
  assert.equal(captureSharedAuthGeneration(), generation);
  assert.ok(harness.exactRequestCount >= 2, 'R8 must exercise pre-activation proof and cloud hydration boundary.');
});

test('A3.4 R9: pending local changes + revoked membership fail closed and never return a scope', async () => {
  resetNodeState();
  const harness = new MembershipHarness();
  harness.exactMembershipStatus = 'suspended';
  writeTenantSnapshot(scopeX(), sensitiveCrm(), { markDirty: true, reason: 'A3.4 R9 pending fixture', backup: false });
  commitSession(captureSharedAuthGeneration(), session(USER_A, 'r9'));

  let returned = false;
  try {
    await hydrateTenantAfterAuth();
    returned = true;
  } catch (error) {
    assert.equal(isHydrationAuthorityFailure(error), true);
    assert.equal(isTenantCloudAuthorityFailure(error), true);
  }
  assert.equal(returned, false);
  assert.notEqual(state.crm.organization.name, SECRET);
  assert.equal(currentTenantScope(), null);
});

test('A3.4 R10: transient network failure after authority proof preserves the existing offline pending-local contract', async () => {
  resetNodeState();
  const harness = new MembershipHarness();
  harness.role = 'agent';
  harness.failPropcontrolRecords = true;
  writeTenantSnapshot(scopeX(), sensitiveCrm(), { markDirty: true, reason: 'A3.4 R10 pending fixture', backup: false });
  commitSession(captureSharedAuthGeneration(), session(USER_A, 'r10'));

  const scope = await hydrateTenantAfterAuth();
  assert.deepEqual(scope, scopeX());
  assert.deepEqual(currentTenantScope(), scopeX());
  assert.equal(isHydrationAuthorityFailure(new Error(TRANSIENT)), false);
  assert.equal(readTenantSyncState(scope).lastError, TRANSIENT);
  assert.ok(harness.exactRequestCount >= 2, 'Transient fallback is allowed only after current authority was proven.');
});

function chromeExecutable(): string | undefined {
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(existsSync);
}

async function waitForServer(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await originalFetch(`${url}/health`)).ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`A3.4 server unavailable: ${String(lastError ?? 'no response')}`);
}

async function startServer(port: number): Promise<ChildProcess> {
  const server = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      SUPABASE_SECRET_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      LEAD_QUALIFICATION_AI_ENDPOINT: '',
      LEAD_QUALIFICATION_AI_KEY: '',
      LEAD_QUALIFICATION_AI_MODEL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(`http://127.0.0.1:${port}`);
  return server;
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL');
      resolve();
    }, 2_000);
    server.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

test('A3.4 R11: bootstrap hydration failure never renders a sensitive state.crm fixture into DOM', { timeout: 120_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'A3.4 R11 requires Chrome/Chromium.');
  const port = 63840 + Math.floor(Math.random() * 100);
  const origin = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 820 } });
  const crm = sensitiveCrm();
  const namespace = tenantStorageNamespace(scopeX());
  const generation = 'a34-browser-generation-g1';
  const browserSession = {
    accessToken: 'a34-browser-access-g1',
    refreshToken: 'a34-browser-refresh-g1',
    expiresAt: Date.now() + 3_600_000,
    userId: USER_A,
    email: 'a34-user-a@example.test',
    __propcontrolAuthGeneration: generation,
  };

  await context.addInitScript(({ sessionKey, generationKey, generationValue, storedSession, crmKey, storedCrm }) => {
    localStorage.setItem(sessionKey, JSON.stringify(storedSession));
    localStorage.setItem(generationKey, generationValue);
    localStorage.setItem(crmKey, JSON.stringify(storedCrm));
  }, {
    sessionKey: CLOUD_SESSION_KEY,
    generationKey: CLOUD_AUTH_GENERATION_KEY,
    generationValue: generation,
    storedSession: browserSession,
    crmKey: namespace.crmKey,
    storedCrm: crm,
  });

  try {
    const page = await context.newPage();
    await page.route('**/api/cloud-config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ configured: true, url: origin, publishableKey: 'a34-browser-key' }),
      });
    });
    await page.route('**/rest/v1/organization_members*', async (route) => {
      const url = new URL(route.request().url());
      const rows = url.searchParams.has('user_id')
        ? [membership(USER_A, 'active', 'agent')]
        : [membership(USER_A, 'suspended', 'agent')];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    });

    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    const bodyText = await page.locator('body').innerText();
    assert.equal(bodyText.includes(SECRET), false);
    assert.equal(await page.locator('.premium-shell').count(), 0);
    assert.equal(await page.locator('[data-bootstrap-error]').count(), 1);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('A3.4 R12: generation change during tenantCloudTransport prevents the old transport capability from returning', async () => {
  resetNodeState();
  const harness = new MembershipHarness();
  harness.deferExactMembership = true;
  const g1 = commitSession(captureSharedAuthGeneration(), session(USER_A, 'r12-g1'));
  const transport = tenantCloudTransport(scopeX());
  const pending = await harness.waitForExactMembership();
  commitSession(g1, session(USER_A, 'r12-g2-new-token'));
  pending.resolve(json([membership(USER_A, 'active', 'agent')]));

  await assert.rejects(
    transport,
    (error: unknown) => error instanceof TenantCloudAuthorityError
      && error.code === AUTH_SHARED_GENERATION_STALE,
  );
});
