import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import '../lead-source.js';
import { initialData, type CrmData } from '../models.js';

const repositoryRoot = process.cwd();
const userId = 'p1-3-a1-browser-user';
const storageKey = `trv-crm-basico:user:${userId}`;

function browserCrm(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: 'p1-3-a1-browser-org',
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Browser test',
  };
  crm.teamMembers = [{
    id: 1,
    userId,
    name: 'Franco Test',
    email: 'franco@example.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-09-01T10:00:00.000Z',
  }];
  crm.clients = [{
    id: 1,
    uid: '11111111-1111-4111-8111-111111111111',
    revision: 0,
    name: 'Cliente Zonaprop vencido',
    phone: '5493515550101',
    interest: 'Departamento General Paz',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Calificado',
    nextAction: 'Retomar visita realizada',
    nextFollowUp: '2020-01-01',
    lastContact: '2020-01-01',
    leadSource: 'Zonaprop',
    leadSourceDetail: 'Departamento General Paz',
    assignedToId: 1,
    createdById: 1,
  }, {
    id: 2,
    uid: '22222222-2222-4222-8222-222222222222',
    revision: 0,
    name: 'Cliente Meta sin próximo paso',
    phone: '5493515550102',
    interest: 'Dúplex en Docta',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Contactado',
    leadSource: 'Meta Ads',
    leadCampaign: 'Docta Septiembre',
    assignedToId: 1,
    createdById: 1,
  }, {
    id: 3,
    uid: '33333333-3333-4333-8333-333333333333',
    revision: 0,
    name: 'Cliente Meta con seguimiento futuro',
    phone: '5493515550103',
    interest: 'Casa zona norte',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    nextAction: 'Enviar opciones',
    nextFollowUp: '2099-01-10',
    leadSource: 'Meta Ads',
    leadCampaign: 'Zona Norte',
    assignedToId: 1,
    createdById: 1,
  }, {
    id: 4,
    uid: '44444444-4444-4444-8444-444444444444',
    revision: 0,
    name: 'Cliente perdido',
    phone: '5493515550104',
    interest: 'Departamento Centro',
    status: 'Operación perdida',
    temperature: 'Frío',
    pipeline: 'Perdido',
    outcome: 'lost',
    leadSource: 'Referido',
    leadSourceDetail: 'Cliente anterior',
    assignedToId: 1,
    createdById: 1,
  }];
  crm.activityLog = [];
  crm.visits = [{
    id: 1,
    clientId: 1,
    propertyId: 7,
    scheduledAt: '2020-01-01T18:00:00.000Z',
    status: 'Realizada',
    interest: 'Alto',
    assignedToId: 1,
    createdById: 1,
    createdAt: '2020-01-01T16:00:00.000Z',
    updatedAt: '2020-01-01T20:00:00.000Z',
  }];
  crm.offers = [];
  crm.reservations = [];
  crm.properties = [{
    id: 7,
    uid: '77777777-7777-4777-8777-777777777777',
    revision: 0,
    title: 'Departamento General Paz',
    address: 'General Paz, Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 100000,
    owner: 'Propietario Test',
    status: 'Activa',
    assignedToId: 1,
    createdById: 1,
  }];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.settings = {
    ...crm.settings,
    profileName: 'Franco Test',
    profileEmail: 'franco@example.test',
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
}

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find(existsSync);
}

async function waitForServer(baseUrl: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Servidor P1.3-A1 no disponible: ${String(lastError ?? 'sin respuesta')}`);
}

async function startServer(port: number): Promise<ChildProcess> {
  const server = spawn(process.execPath, ['dist/server.js'], {
    cwd: repositoryRoot,
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
    server.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function createContext(browser: Browser, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport, locale: 'es-AR' });
  const data = browserCrm();
  await context.addInitScript(({ crm, accountUserId, accountStorageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'p1-3-a1-browser-token',
      refreshToken: 'p1-3-a1-browser-refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: accountUserId,
      email: 'franco@example.test',
    }));
    localStorage.setItem(accountStorageKey, JSON.stringify(crm));
    localStorage.setItem(`${accountStorageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: new Date().toISOString(),
      lastCloudSavedAt: new Date().toISOString(),
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { crm: data, accountUserId: userId, accountStorageKey: storageKey });
  return context;
}

async function openApp(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-card[data-client-id="1"]', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('#pc-lead-source-filter', { state: 'attached', timeout: 20_000 });
  await page.waitForSelector('#crm [data-reactivation-section]', { state: 'visible', timeout: 20_000 });
}

async function localCrm(page: Page): Promise<CrmData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}') as CrmData, storageKey);
}

test('P1.3-A1 browser desktop: filtro de origen, Para reactivar y seguimiento canónico', { timeout: 120_000 }, async (t) => {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chromium para P1.3-A1 desktop.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }
  const server = await startServer(4321);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  const context = await createContext(browser, { width: 1366, height: 768 });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await openApp(page, 'http://127.0.0.1:4321');

    const filter = page.locator('#pc-lead-source-filter');
    await filter.selectOption('Meta Ads');
    await page.waitForFunction(() => document.querySelector('.mvp-lead-card[data-client-id="1"]')?.classList.contains('pc-source-filter-hidden'));
    assert.equal(await page.locator('.mvp-lead-card[data-client-id="2"]').evaluate((node) => node.classList.contains('pc-source-filter-hidden')), false);
    assert.equal(await page.locator('.mvp-lead-card[data-client-id="3"]').evaluate((node) => node.classList.contains('pc-source-filter-hidden')), false);
    await filter.selectOption('Todas');

    const section = page.locator('[data-reactivation-section]');
    assert.match(await section.textContent() || '', /¿A quién debería llamar hoy\?/);
    assert.match(await section.textContent() || '', /Cliente Zonaprop vencido/);
    assert.match(await section.textContent() || '', /Cliente Meta sin próximo paso/);
    assert.doesNotMatch(await section.textContent() || '', /Cliente Meta con seguimiento futuro/);
    assert.doesNotMatch(await section.textContent() || '', /Cliente perdido/);

    const scheduleButton = section.locator('[data-reactivation-schedule="1"]');
    await scheduleButton.click();
    const followUpForm = section.locator('[data-reactivation-followup="1"]');
    await followUpForm.waitFor({ state: 'visible' });
    await followUpForm.locator('input[name="date"]').fill('2099-02-01');
    await followUpForm.locator('button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-reactivation-client="1"]'));

    let crm = await localCrm(page);
    const updated = crm.clients.find((item) => item.id === 1)!;
    assert.equal(updated.nextFollowUp, '2099-02-01');
    assert.equal(updated.nextAction, 'Retomar visita realizada');
    assert.equal(crm.reminders.length, 0);
    assert.equal(crm.activityLog.filter((entry) => entry.entityId === 1 && entry.action === 'Seguimiento reprogramado').length, 1);

    await page.locator('[data-toggle="client-form"]').click();
    await page.waitForSelector('#mvp-lead-form:not(.collapsed) [name="leadSource"]', { state: 'visible' });
    assert.equal(await page.locator('#mvp-lead-form [name="leadSource"]').getAttribute('required'), '');
    await page.locator('#mvp-lead-form [name="leadSource"]').selectOption('Otro');
    assert.equal(await page.locator('#mvp-lead-form [name="leadSourceDetail"]').getAttribute('required'), '');

    crm = await localCrm(page);
    assert.equal(crm.clients.length, 4);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('P1.3-A1 browser mobile 390: prioridad, snooze, targets táctiles y cero overflow', { timeout: 120_000 }, async (t) => {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chromium para P1.3-A1 mobile.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }
  const server = await startServer(4322);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  const context = await createContext(browser, { width: 390, height: 844 });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await openApp(page, 'http://127.0.0.1:4322');
    const section = page.locator('[data-reactivation-section]');
    const cards = section.locator('[data-reactivation-client]');
    assert.ok(await cards.count() <= 5);
    assert.equal(await section.locator('[data-reactivation-client="1"] .pc-reactivation-priority').textContent(), 'Alta');

    const metrics = await section.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const targets = [...node.querySelectorAll<HTMLElement>('button, summary')]
        .filter((target) => target.offsetParent !== null)
        .map((target) => target.getBoundingClientRect().height);
      return {
        left: rect.left,
        right: rect.right,
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        minTarget: Math.min(...targets),
      };
    });
    assert.ok(metrics.left >= -1, JSON.stringify(metrics));
    assert.ok(metrics.right <= metrics.viewport + 1, JSON.stringify(metrics));
    assert.ok(metrics.documentWidth <= metrics.viewport + 1, JSON.stringify(metrics));
    assert.ok(metrics.minTarget >= 43.5, JSON.stringify(metrics));

    const snoozeDetails = section.locator('[data-reactivation-client="2"] .pc-reactivation-snooze');
    await snoozeDetails.locator(':scope > summary').click();
    await snoozeDetails.locator('[data-reactivation-snooze="2"][data-days="30"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-reactivation-client="2"]'));

    const crm = await localCrm(page);
    const snoozed = crm.clients.find((item) => item.id === 2)!;
    assert.ok(Boolean(snoozed.reactivationSnoozedUntil));
    assert.ok(String(snoozed.reactivationSnoozedUntil) > new Date().toISOString().slice(0, 10));
    assert.equal(crm.activityLog.filter((entry) => entry.entityId === 2 && entry.action === 'Reactivación postergada').length, 1);
    assert.equal(crm.reminders.length, 0);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
