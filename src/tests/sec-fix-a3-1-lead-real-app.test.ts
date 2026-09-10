import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember, type TeamRole } from '../models.js';

const SESSION_KEY = 'propcontrol-cloud-session-v1';
const TEAM_VIEW_KEY = 'propcontrol-active-team-member-v1';
const STORAGE_KEY = 'trv-crm-basico';
const ORG_A = '00000000-0000-0000-0000-00000000a321';
const ORG_B = '00000000-0000-0000-0000-00000000b321';
const SHARED_USER = 'a31-shared-user';

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
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
  throw new Error(`Servidor A3.1 no disponible: ${String(lastError ?? 'sin respuesta')}`);
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

function teamMember(id: number, userId: string | undefined, role: TeamRole, name: string): TeamMember {
  return {
    id,
    userId,
    name,
    email: `${name.toLowerCase().replaceAll(' ', '.')}@a31.test`,
    role,
    status: 'Activo',
    createdAt: '2026-09-10T12:00:00.000Z',
  };
}

function crmFixture(options: {
  organizationId: string;
  authenticatedUserId: string;
  authenticatedMemberId: number;
  authenticatedRole: TeamRole;
  visualMemberId: number;
}): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: options.organizationId,
    name: options.organizationId === ORG_A ? 'A3.1 Org A' : 'A3.1 Org B',
    seatLimit: null,
    planLabel: 'A3.1',
  };
  const visualRole: TeamRole = options.visualMemberId === 1 ? 'Dueño' : 'Administrador';
  const visual = teamMember(options.visualMemberId, `visual-${options.organizationId}`, visualRole, `Visual ${options.visualMemberId}`);
  const authenticated = teamMember(
    options.authenticatedMemberId,
    options.authenticatedUserId,
    options.authenticatedRole,
    `Authenticated ${options.authenticatedMemberId}`,
  );
  crm.teamMembers = visual.id === authenticated.id ? [authenticated] : [visual, authenticated];
  if (!crm.teamMembers.some((member) => member.role === 'Dueño')) {
    crm.teamMembers.unshift(teamMember(1, `owner-${options.organizationId}`, 'Dueño', 'Owner Visual'));
  }
  crm.clients = [];
  crm.activityLog = [];
  crm.reminders = [];
  crm.conversations = [];
  crm.settings = {
    ...crm.settings,
    profileName: authenticated.name,
    profileEmail: authenticated.email,
    agencyName: crm.organization.name,
  };
  return crm;
}

function legacyKey(userId: string): string {
  return `${STORAGE_KEY}:user:${userId}`;
}

function tenantKey(userId: string, organizationId: string): string {
  return `${STORAGE_KEY}:user:${userId}:org:${organizationId}`;
}

async function contextFor(
  browser: Browser,
  crm: CrmData,
  userId: string,
  activeMemberId: number,
  suffix: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 820 },
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
  });
  await context.addInitScript(({ crmData, user, viewMember, marker }) => {
    if (localStorage.getItem(marker)) return;
    localStorage.setItem(marker, '1');
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: `access-${user}`,
      refreshToken: `refresh-${user}`,
      expiresAt: Date.now() + 3_600_000,
      userId: user,
      email: `${user}@a31.test`,
    }));
    localStorage.setItem(`trv-crm-basico:user:${user}`, JSON.stringify(crmData));
    localStorage.setItem('propcontrol-active-team-member-v1', String(viewMember));
  }, { crmData: crm, user: userId, viewMember: activeMemberId, marker: `a31:${suffix}` });
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
}

async function openLeadForm(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.locator('[data-toggle="client-form"]').click();
  const form = page.locator('#mvp-lead-form.b131-lead-form:not(.collapsed)');
  await form.waitFor({ state: 'visible', timeout: 10_000 });
  return form;
}

async function fillLead(form: ReturnType<Page['locator']>, name: string, phone: string): Promise<void> {
  await form.locator('input[name="name"]').fill(name);
  await form.locator('input[name="phone"]').fill(phone);
  await form.locator('input[name="interest"]').fill('A3.1 tenant security');
}

async function tenantCrm(page: Page, userId: string, organizationId: string): Promise<CrmData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}') as CrmData, tenantKey(userId, organizationId));
}

function clientActivityActors(crm: CrmData, clientId: number): number[] {
  return crm.activityLog
    .filter((entry) => entry.entityType === 'Cliente' && Number(entry.entityId) === clientId)
    .map((entry) => entry.actorId);
}

test('A3.1 owner autenticado conserva write identity bajo activeMemberId y TEAM_VIEW_KEY manipulados', { timeout: 120_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para A3.1.');
  const port = 63400 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const crm = crmFixture({
    organizationId: ORG_A,
    authenticatedUserId: SHARED_USER,
    authenticatedMemberId: 11,
    authenticatedRole: 'Dueño',
    visualMemberId: 91,
  });
  const context = await contextFor(browser, crm, SHARED_USER, 11, 'owner-tamper');
  try {
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);
    await page.evaluate(async () => {
      const modulePath = '/dist/store.js';
      const store = await import(modulePath);
      store.setActiveMemberId(91);
    });
    const form = await openLeadForm(page);
    await page.evaluate(() => localStorage.setItem('propcontrol-active-team-member-v1', '999999'));
    await fillLead(form, 'OWNER AUTH A31', '03515553111');
    await form.locator('[data-save-lead]').click();
    await page.locator('#mvp-lead-results').getByText('OWNER AUTH A31', { exact: true }).waitFor({ state: 'visible' });

    let saved = await tenantCrm(page, SHARED_USER, ORG_A);
    const client = saved.clients.find((item) => item.name === 'OWNER AUTH A31');
    assert.ok(client);
    assert.equal(client.createdById, 11);
    assert.equal(client.assignedToId, 11);
    assert.deepEqual([...new Set(clientActivityActors(saved, client.id))], [11]);
    assert.equal(saved.organization.id, ORG_A);

    await page.locator(`[data-edit-client="${client.id}"]`).first().click();
    const editForm = page.locator('#mvp-lead-form.b131-lead-form:not(.collapsed)');
    await editForm.locator('input[name="interest"]').fill('A3.1 edit preserved');
    await editForm.locator('[data-save-lead]').click();
    await page.waitForTimeout(250);
    saved = await tenantCrm(page, SHARED_USER, ORG_A);
    const edited = saved.clients.find((item) => item.id === client.id);
    assert.equal(edited?.createdById, 11);
    assert.equal(edited?.assignedToId, 11);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('A3.1 agent autenticado no adquiere identidad de owner visual', { timeout: 120_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para A3.1.');
  const port = 63520 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const userId = 'a31-agent-user';
  const crm = crmFixture({
    organizationId: ORG_A,
    authenticatedUserId: userId,
    authenticatedMemberId: 31,
    authenticatedRole: 'Corredor',
    visualMemberId: 1,
  });
  const context = await contextFor(browser, crm, userId, 31, 'agent-view-owner');
  try {
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);
    await page.evaluate(async () => {
      const modulePath = '/dist/store.js';
      const store = await import(modulePath);
      store.setActiveMemberId(1);
    });
    const form = await openLeadForm(page);
    await fillLead(form, 'AGENT AUTH A31', '03515553131');
    await form.locator('[data-save-lead]').click();
    await page.locator('#mvp-lead-results').getByText('AGENT AUTH A31', { exact: true }).waitFor({ state: 'visible' });
    const saved = await tenantCrm(page, userId, ORG_A);
    const client = saved.clients.find((item) => item.name === 'AGENT AUTH A31');
    assert.ok(client);
    assert.equal(client.createdById, 31);
    assert.equal(client.assignedToId, 31);
    assert.deepEqual([...new Set(clientActivityActors(saved, client.id))], [31]);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('A3.1 mismo usuario guarda A y B en namespaces y member ids distintos', { timeout: 150_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para A3.1.');
  const port = 63640 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const crmA = crmFixture({
    organizationId: ORG_A,
    authenticatedUserId: SHARED_USER,
    authenticatedMemberId: 11,
    authenticatedRole: 'Dueño',
    visualMemberId: 91,
  });
  const crmB = crmFixture({
    organizationId: ORG_B,
    authenticatedUserId: SHARED_USER,
    authenticatedMemberId: 22,
    authenticatedRole: 'Dueño',
    visualMemberId: 92,
  });
  const context = await contextFor(browser, crmA, SHARED_USER, 11, 'multi-org');
  try {
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);
    let form = await openLeadForm(page);
    await fillLead(form, 'LEAD ORG A', '03515553211');
    await form.locator('[data-save-lead]').click();
    await page.locator('#mvp-lead-results').getByText('LEAD ORG A', { exact: true }).waitFor({ state: 'visible' });

    await page.evaluate(async ({ userId, organizationId, crmData }) => {
      const runtimePath = '/dist/tenant-runtime.js';
      const storagePath = '/dist/tenant-storage.js';
      const storePath = '/dist/store.js';
      const runtime = await import(runtimePath);
      const storage = await import(storagePath);
      const store = await import(storePath);
      const tenantScope = { userId, organizationId };
      storage.writeTenantSnapshot(tenantScope, crmData, { markDirty: false, backup: false });
      runtime.installTenantRuntimeScope(tenantScope, userId);
      store.activateStorageForTenant(tenantScope);
      store.state.activeModule = 'crm';
      store.state.openForms.client = false;
      document.dispatchEvent(new CustomEvent('trv-render'));
    }, { userId: SHARED_USER, organizationId: ORG_B, crmData: crmB });
    await page.waitForSelector('#crm.active', { state: 'visible' });
    form = await openLeadForm(page);
    await fillLead(form, 'LEAD ORG B', '03515553222');
    await form.locator('[data-save-lead]').click();
    await page.locator('#mvp-lead-results').getByText('LEAD ORG B', { exact: true }).waitFor({ state: 'visible' });

    const savedA = await tenantCrm(page, SHARED_USER, ORG_A);
    const savedB = await tenantCrm(page, SHARED_USER, ORG_B);
    assert.deepEqual(savedA.clients.map((item) => item.name), ['LEAD ORG A']);
    assert.deepEqual(savedB.clients.map((item) => item.name), ['LEAD ORG B']);
    assert.equal(savedA.clients[0]?.createdById, 11);
    assert.equal(savedB.clients[0]?.createdById, 22);
    assert.equal(savedA.organization.id, ORG_A);
    assert.equal(savedB.organization.id, ORG_B);
    assert.notEqual(tenantKey(SHARED_USER, ORG_A), tenantKey(SHARED_USER, ORG_B));
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('A3.1 formulario A queda stale al cambiar runtime a B y no toca snapshot B', { timeout: 120_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para A3.1.');
  const port = 63760 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const crmA = crmFixture({
    organizationId: ORG_A,
    authenticatedUserId: SHARED_USER,
    authenticatedMemberId: 11,
    authenticatedRole: 'Dueño',
    visualMemberId: 91,
  });
  const crmB = crmFixture({
    organizationId: ORG_B,
    authenticatedUserId: SHARED_USER,
    authenticatedMemberId: 22,
    authenticatedRole: 'Dueño',
    visualMemberId: 92,
  });
  const context = await contextFor(browser, crmA, SHARED_USER, 11, 'stale-a-b');
  try {
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);
    const form = await openLeadForm(page);
    await fillLead(form, 'STALE A MUST FAIL', '03515553333');
    const beforeB = JSON.stringify(crmB);
    await page.evaluate(async ({ userId, organizationId, crmData, rawB }) => {
      localStorage.setItem(`trv-crm-basico:user:${userId}:org:${organizationId}`, rawB);
      const runtimePath = '/dist/tenant-runtime.js';
      const storePath = '/dist/store.js';
      const runtime = await import(runtimePath);
      const store = await import(storePath);
      const tenantScope = { userId, organizationId };
      runtime.installTenantRuntimeScope(tenantScope, userId);
      store.activateStorageForTenant(tenantScope);
      store.state.activeModule = 'crm';
      store.state.openForms.client = true;
      void crmData;
    }, { userId: SHARED_USER, organizationId: ORG_B, crmData: crmB, rawB: beforeB });

    await form.locator('[data-save-lead]').click();
    await form.locator('[data-lead-error]').waitFor({ state: 'visible' });
    assert.match(await form.locator('[data-lead-error]').innerText(), /autorización tenant|runtime activo cambió/i);
    const rawBAfter = await page.evaluate((key) => localStorage.getItem(key), tenantKey(SHARED_USER, ORG_B));
    assert.equal(rawBAfter, beforeB);
    const stateB = await page.evaluate(async () => {
      const storePath = '/dist/store.js';
      const store = await import(storePath);
      return { organizationId: store.state.crm.organization.id, clients: store.state.crm.clients.length };
    });
    assert.deepEqual(stateB, { organizationId: ORG_B, clients: 0 });
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('A3.1 error de persistencia revierte sólo A y deja snapshot B byte-identical', { timeout: 120_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para A3.1.');
  const port = 63880 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const crmA = crmFixture({
    organizationId: ORG_A,
    authenticatedUserId: SHARED_USER,
    authenticatedMemberId: 11,
    authenticatedRole: 'Dueño',
    visualMemberId: 91,
  });
  const crmB = crmFixture({
    organizationId: ORG_B,
    authenticatedUserId: SHARED_USER,
    authenticatedMemberId: 22,
    authenticatedRole: 'Dueño',
    visualMemberId: 92,
  });
  const context = await contextFor(browser, crmA, SHARED_USER, 11, 'rollback-a');
  try {
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);
    const form = await openLeadForm(page);
    await fillLead(form, 'ROLLBACK A31', '03515553444');
    const keyA = tenantKey(SHARED_USER, ORG_A);
    const keyB = tenantKey(SHARED_USER, ORG_B);
    const beforeA = await page.evaluate((key) => localStorage.getItem(key), keyA);
    const beforeB = JSON.stringify(crmB);
    await page.evaluate(({ bKey, bRaw, aKey }) => {
      localStorage.setItem(bKey, bRaw);
      const original = Storage.prototype.setItem;
      let failed = false;
      Storage.prototype.setItem = function (key: string, value: string): void {
        if (!failed && key === aKey) {
          failed = true;
          throw new Error('A31_FORCED_TENANT_WRITE_FAILURE');
        }
        original.call(this, key, value);
      };
    }, { bKey: keyB, bRaw: beforeB, aKey: keyA });

    await form.locator('[data-save-lead]').click();
    await form.locator('[data-lead-error]').waitFor({ state: 'visible' });
    assert.match(await form.locator('[data-lead-error]').innerText(), /No se pudo guardar el lead/i);
    const after = await page.evaluate(({ aKey, bKey }) => ({
      a: localStorage.getItem(aKey),
      b: localStorage.getItem(bKey),
    }), { aKey: keyA, bKey: keyB });
    assert.equal(after.a, beforeA);
    assert.equal(after.b, beforeB);
    const stateA = await page.evaluate(async () => {
      const storePath = '/dist/store.js';
      const store = await import(storePath);
      return { organizationId: store.state.crm.organization.id, clients: store.state.crm.clients.length };
    });
    assert.deepEqual(stateA, { organizationId: ORG_A, clients: 0 });
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});