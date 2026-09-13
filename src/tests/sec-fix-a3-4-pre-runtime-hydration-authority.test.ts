import './sec-fix-a1-2-c2-test-setup.js';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test, { afterEach } from 'node:test';
import { chromium } from 'playwright';
import type { TenantScope } from '../active-organization.js';
import {
  AUTH_SHARED_GENERATION_STALE,
  captureSharedAuthGeneration,
  commitSharedCloudSession,
  type SharedCloudSession,
} from '../auth-session-generation.js';
import { initialData } from '../models.js';
import { state } from '../store.js';
import {
  hydrateTenantAfterAuth,
  resolveTenantScopeForAuthenticatedSession,
} from '../tenant-hydration.js';
import {
  invalidateTenantRuntimeScope,
} from '../tenant-runtime.js';
import {
  tenantStorageNamespace,
  writeTenantSnapshot,
} from '../tenant-storage.js';

const USER_A = 'a34-user-a';
const USER_B = 'a34-user-b';
const ORG_X = '00000000-0000-0000-0000-00000000a344';
const SECRET = 'A34-SENSITIVE-TENANT-X';

function session(userId: string, suffix: string): SharedCloudSession {
  return Object.freeze({
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    expiresAt: Date.now() + 3_600_000,
    userId,
    email: `${userId}@example.test`,
  });
}

function membership(userId = USER_A, status = 'active'): Record<string, unknown> {
  return {
    organization_id: ORG_X,
    member_id: 344,
    user_id: userId,
    role: 'owner',
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
  exactMembershipStatus: 'active' | 'suspended' | 'missing' = 'active';

  constructor() {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: this.fetch,
    });
  }

  async waitForCatalog(index = 0): Promise<Deferred<Response>> {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const request = this.catalogRequests[index];
      if (request) return request;
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    }
    throw new Error('A3.4 harness did not observe membership catalog request.');
  }

  private readonly fetch = async (input: string | URL | Request): Promise<Response> => {
    const raw = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, 'https://app.test');

    if (url.pathname === '/api/cloud-config') {
      return json({ configured: true, url: 'https://supabase.test', publishableKey: 'a34-key' });
    }

    if (url.pathname.endsWith('/rest/v1/organization_members')) {
      if (url.searchParams.has('user_id')) {
        const request = deferred<Response>();
        this.catalogRequests.push(request);
        return request.promise;
      }
      if (url.searchParams.has('organization_id')) {
        if (this.exactMembershipStatus === 'missing') return json([]);
        return json([membership(USER_A, this.exactMembershipStatus)]);
      }
    }

    throw new Error(`A3.4 unexpected fetch: ${url.toString()}`);
  };
}

function resetNodeState(): void {
  localStorage.clear();
  invalidateTenantRuntimeScope();
  state.crm = structuredClone(initialData);
}

afterEach(() => resetNodeState());

function commitSession(expectedGeneration: string, next: SharedCloudSession): string {
  return commitSharedCloudSession(expectedGeneration, next);
}

test('A3.4 R1 RED: A/G1 -> B/G2 -> A/G3 cannot accept the G1 membership catalog result', async () => {
  resetNodeState();
  const harness = new MembershipHarness();
  const g1 = commitSession(captureSharedAuthGeneration(), session(USER_A, 'a-g1'));
  const resolution = resolveTenantScopeForAuthenticatedSession();
  const pendingCatalog = await harness.waitForCatalog();

  const g2 = commitSession(g1, session(USER_B, 'b-g2'));
  commitSession(g2, session(USER_A, 'a-g3'));
  pendingCatalog.resolve(json([membership(USER_A, 'active')]));

  await assert.rejects(
    resolution,
    new RegExp(AUTH_SHARED_GENERATION_STALE),
    'A3.4 R1 SECURITY ASSERTION: stale G1 catalog must fail closed after A->B->A.',
  );
});

test('A3.4 R2 RED: same user with a new auth generation/token cannot accept the old catalog result', async () => {
  resetNodeState();
  const harness = new MembershipHarness();
  const g1 = commitSession(captureSharedAuthGeneration(), session(USER_A, 'same-user-g1'));
  const resolution = resolveTenantScopeForAuthenticatedSession();
  const pendingCatalog = await harness.waitForCatalog();

  commitSession(g1, session(USER_A, 'same-user-g2-new-token'));
  pendingCatalog.resolve(json([membership(USER_A, 'active')]));

  await assert.rejects(
    resolution,
    new RegExp(AUTH_SHARED_GENERATION_STALE),
    'A3.4 R2 SECURITY ASSERTION: same user with a material new session must stale the G1 catalog.',
  );
});

test('A3.4 R3 RED: stale catalog authority must never activate an existing tenant snapshot into state.crm', async () => {
  resetNodeState();
  const harness = new MembershipHarness();
  harness.exactMembershipStatus = 'missing';
  const scope: TenantScope = Object.freeze({ userId: USER_A, organizationId: ORG_X });
  const sensitive = structuredClone(initialData);
  sensitive.organization.id = ORG_X;
  sensitive.organization.name = SECRET;
  sensitive.teamMembers = [{
    id: 344,
    userId: USER_A,
    name: 'Sensitive User',
    email: 'a34-user-a@example.test',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-09-13T12:00:00.000Z',
  }];
  writeTenantSnapshot(scope, sensitive, { markDirty: true, reason: 'A3.4 synthetic pending snapshot', backup: false });

  const g1 = commitSession(captureSharedAuthGeneration(), session(USER_A, 'r3-g1'));
  const hydration = hydrateTenantAfterAuth();
  const pendingCatalog = await harness.waitForCatalog();
  const g2 = commitSession(g1, session(USER_B, 'r3-g2'));
  commitSession(g2, session(USER_A, 'r3-g3'));
  pendingCatalog.resolve(json([membership(USER_A, 'active')]));

  await hydration.catch(() => undefined);
  assert.notEqual(
    state.crm.organization.name,
    SECRET,
    'A3.4 R3 SECURITY ASSERTION: stale authority must not make the local tenant snapshot active/readable.',
  );
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
      if ((await fetch(`${url}/health`)).ok) return;
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

function browserSensitiveCrm(): ReturnType<typeof structuredClone<typeof initialData>> {
  const crm = structuredClone(initialData);
  crm.organization.id = ORG_X;
  crm.organization.name = 'A34 Browser Secret Org';
  crm.teamMembers = [{
    id: 344,
    userId: USER_A,
    name: 'A34 Browser User',
    email: 'a34-user-a@example.test',
    role: 'Dueño',
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

test('A3.4 R4 RED: bootstrap hydration failure must not render a previously activated sensitive CRM snapshot', { timeout: 120_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'A3.4 harness requires Chrome/Chromium.');
  const port = 63740 + Math.floor(Math.random() * 100);
  const origin = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 820 } });
  const crm = browserSensitiveCrm();
  const namespace = tenantStorageNamespace({ userId: USER_A, organizationId: ORG_X });
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
    sessionKey: 'propcontrol-cloud-session-v1',
    generationKey: 'propcontrol-cloud-auth-generation-v1',
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
        ? [membership(USER_A, 'active')]
        : [];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    });

    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const bodyText = await page.locator('body').innerText();
    assert.equal(
      bodyText.includes(SECRET),
      false,
      'A3.4 R4 SECURITY ASSERTION: bootstrap failure after hydration must not render tenant-sensitive CRM data.',
    );
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
