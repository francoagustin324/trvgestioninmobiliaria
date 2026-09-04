import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData } from '../models.js';

const repositoryRoot = process.cwd();
const userId = 'p1-2-a1-browser-user';
const storageKey = `trv-crm-basico:user:${userId}`;

function browserCrm(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: 'p1-2-a1-browser-org',
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
    name: 'Cliente Won Browser',
    phone: '5493515550101',
    email: 'won@example.test',
    interest: 'Departamento General Paz',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Negociación',
    nextAction: 'Confirmar propuesta final',
    nextFollowUp: '2026-09-10',
    budget: 'USD 110.000',
    currency: 'USD',
    paymentMethod: 'Contado',
    purchaseTimeframe: '0-3 meses',
    purpose: 'Vivir',
    knowsArea: 'Sí',
    canMoveForward: 'Sí',
    zones: 'General Paz',
    assignedToId: 1,
    createdById: 1,
  }, {
    id: 2,
    uid: '22222222-2222-4222-8222-222222222222',
    revision: 0,
    name: 'Cliente Lost Browser',
    phone: '5493515550102',
    email: 'lost@example.test',
    interest: 'Casa zona norte',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    nextAction: 'Enviar opciones',
    nextFollowUp: '2026-09-11',
    budget: 'ARS 120.000.000',
    currency: 'ARS',
    paymentMethod: 'Contado',
    purchaseTimeframe: '0-3 meses',
    purpose: 'Vivir',
    knowsArea: 'Sí',
    canMoveForward: 'Sí',
    zones: 'Zona norte',
    assignedToId: 1,
    createdById: 1,
  }];
  crm.properties = [{
    id: 7,
    uid: '77777777-7777-4777-8777-777777777777',
    revision: 0,
    title: 'Departamento General Paz',
    address: 'General Paz, Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 100000,
    owner: 'Propietario test',
    status: 'Activa',
    bedrooms: 2,
    assignedToId: 1,
    createdById: 1,
  }];
  crm.offers = [{
    id: 1,
    clientId: 1,
    propertyId: 7,
    origin: 'Cliente',
    amount: 100000,
    currency: 'USD',
    status: 'Aceptada',
    assignedToId: 1,
    createdById: 1,
    createdAt: '2026-09-02T12:00:00.000Z',
    updatedAt: '2026-09-02T12:00:00.000Z',
  }];
  crm.visits = [];
  crm.reservations = [];
  crm.activityLog = [];
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
  throw new Error(`Servidor P1.2-A1 no disponible: ${String(lastError ?? 'sin respuesta')}`);
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
      accessToken: 'p1-2-a1-browser-token',
      refreshToken: 'p1-2-a1-browser-refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: accountUserId,
      email: 'franco@example.test',
    }));
    localStorage.setItem(accountStorageKey, JSON.stringify(crm));
    localStorage.setItem(`${accountStorageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-09-03T12:00:00.000Z',
      lastCloudSavedAt: '2026-09-03T12:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { crm: data, accountUserId: userId, accountStorageKey: storageKey });
  return context;
}

async function openApp(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-card[data-client-id="1"]', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => Boolean(document.querySelector('#crm [data-commercial-close-summary]')));
}

async function openEditForm(page: Page, clientId: number): Promise<void> {
  const editButton = page.locator(`.mvp-lead-card[data-client-id="${clientId}"] .mvp-lead-quick-actions[data-zero-training-actions="true"] [data-edit-client="${clientId}"]`);
  await editButton.waitFor({ state: 'visible' });
  await editButton.click();
  await page.waitForSelector('#mvp-lead-form:not(.collapsed)', { state: 'visible' });
}

async function openLeadDetails(page: Page, clientId: number): Promise<void> {
  const card = page.locator(`.mvp-lead-card[data-client-id="${clientId}"]`);
  const sheet = card.locator(`[data-lead-full-sheet="${clientId}"]`);
  if ((await sheet.getAttribute('open')) !== null) return;
  const menu = card.locator('.mvp-lead-actions-menu');
  await menu.locator(':scope > summary').click();
  await menu.locator(`[data-open-lead-details="${clientId}"]`).click();
  await page.waitForFunction((id) => document.querySelector(`[data-lead-full-sheet="${id}"]`)?.hasAttribute('open'), clientId);
}

async function localCrm(page: Page): Promise<CrmData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}') as CrmData, storageKey);
}

async function assertDialogContained(page: Page): Promise<void> {
  const metrics = await page.locator('dialog[data-commercial-close-dialog][open]').evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const buttons = [...dialog.querySelectorAll<HTMLElement>('button')].map((button) => button.getBoundingClientRect().height);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: window.innerWidth,
      height: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      minButtonHeight: Math.min(...buttons),
    };
  });
  assert.ok(metrics.left >= -1 && metrics.right <= metrics.width + 1, JSON.stringify(metrics));
  assert.ok(metrics.top >= -1 && metrics.bottom <= metrics.height + 1, JSON.stringify(metrics));
  assert.ok(metrics.documentWidth <= metrics.width + 1, JSON.stringify(metrics));
  assert.ok(metrics.minButtonHeight >= 43.5, JSON.stringify(metrics));
}

test('P1.2-A1 browser: Won desktop, replay visual seguro y reapertura persistente', { timeout: 120_000 }, async (t) => {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chromium para P1.2-A1.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }
  const port = 4317;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  const context = await createContext(browser, { width: 1366, height: 768 });
  const page = await context.newPage();
  try {
    await openApp(page, `http://127.0.0.1:${port}`);
    await openEditForm(page, 1);
    await page.locator('#mvp-lead-form select[name="pipeline"]').selectOption('Ganado');
    await page.waitForSelector('dialog[data-commercial-close-dialog][open] [data-commercial-close-modal-form="won"]');
    await assertDialogContained(page);

    assert.equal(await page.locator('dialog [name="dealPropertyId"]').inputValue(), '7');
    await page.locator('dialog [name="dealAmount"]').fill('100000');
    await page.locator('dialog [name="dealCurrency"]').selectOption('USD');
    await page.locator('dialog [name="commissionPercentage"]').fill('3');
    await page.waitForFunction(() => (document.querySelector<HTMLInputElement>('dialog [name="commissionAmount"]')?.value || '') === '3000');
    assert.match(await page.locator('dialog [data-commission-calculated]').textContent() || '', /USD 3\.000/);
    await page.locator('dialog [name="closeNote"]').fill('Cierre browser desktop');
    await page.locator('dialog [data-commercial-close-confirm="Ganado"]').click();

    await page.waitForSelector('.mvp-lead-card[data-client-id="1"].terminal', { state: 'visible' });
    let crm = await localCrm(page);
    let client = crm.clients.find((item) => item.id === 1)!;
    assert.equal(client.outcome, 'won');
    assert.equal(client.dealAmount, 100000);
    assert.equal(client.commissionAmount, 3000);
    assert.equal(client.dealPropertyId, 7);
    assert.equal(client.dealPropertyLabel, 'Departamento General Paz');
    assert.equal(client.nextAction, undefined);
    assert.equal(client.nextFollowUp, undefined);
    assert.equal(crm.activityLog.filter((entry) => entry.entityId === 1 && entry.action === 'Operación ganada').length, 1);

    const card = page.locator('.mvp-lead-card[data-client-id="1"]');
    await openLeadDetails(page, 1);
    await page.waitForSelector('.mvp-lead-card[data-client-id="1"] [data-commercial-close-card].won');
    assert.match(await card.locator('[data-commercial-close-card]').textContent() || '', /USD 100\.000/);
    assert.match(await card.locator('[data-commercial-close-card]').textContent() || '', /USD 3\.000/);

    await card.locator('[data-reopen-operation="1"]').click();
    await page.waitForSelector('dialog[data-commercial-close-dialog][open] [data-commercial-close-modal-form="reopen"]');
    await page.locator('dialog [name="reopenStage"]').selectOption('Negociación');
    await page.locator('dialog [data-commercial-reopen-confirm]').click();
    await page.waitForFunction(() => document.querySelector('.mvp-lead-card[data-client-id="1"] .mvp-stage-badge')?.textContent?.trim() === 'Negociación');

    crm = await localCrm(page);
    client = crm.clients.find((item) => item.id === 1)!;
    assert.equal(client.pipeline, 'Negociación');
    assert.equal(client.outcome, undefined);
    assert.equal(client.closedAt, undefined);
    assert.equal(client.dealAmount, undefined);
    assert.equal(client.commissionAmount, undefined);
    assert.equal(crm.activityLog.filter((entry) => entry.entityId === 1 && entry.action === 'Operación ganada').length, 1);
    assert.equal(crm.activityLog.filter((entry) => entry.entityId === 1 && entry.action === 'Operación reabierta').length, 1);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('P1.2-A1 browser: Lost mobile exige detalle Otro y no deja seguimiento viejo', { timeout: 120_000 }, async (t) => {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chromium para P1.2-A1 mobile.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }
  const port = 4318;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  const context = await createContext(browser, { width: 390, height: 844 });
  const page = await context.newPage();
  try {
    await openApp(page, `http://127.0.0.1:${port}`);
    await openEditForm(page, 2);
    await page.locator('#mvp-lead-form select[name="pipeline"]').selectOption('Perdido');
    await page.waitForSelector('dialog[data-commercial-close-dialog][open] [data-commercial-close-modal-form="lost"]');
    await assertDialogContained(page);

    await page.locator('dialog [name="lostReason"]').selectOption('Otro');
    await page.locator('dialog [data-commercial-close-confirm="Perdido"]').click();
    await page.waitForSelector('dialog[data-commercial-close-dialog][open] [data-commercial-close-error]:not([hidden])');
    assert.match(await page.locator('dialog [data-commercial-close-error]').textContent() || '', /Detallá el motivo/);

    await page.locator('dialog [name="lostReasonDetail"]').fill('El cliente cambió el alcance de la búsqueda');
    await page.locator('dialog [name="closeNote"]').fill('Cierre browser mobile');
    await page.locator('dialog [data-commercial-close-confirm="Perdido"]').click();
    await page.waitForSelector('.mvp-lead-card[data-client-id="2"].terminal', { state: 'visible' });

    const crm = await localCrm(page);
    const client = crm.clients.find((item) => item.id === 2)!;
    assert.equal(client.outcome, 'lost');
    assert.equal(client.lostReason, 'Otro');
    assert.equal(client.lostReasonDetail, 'El cliente cambió el alcance de la búsqueda');
    assert.equal(client.nextAction, undefined);
    assert.equal(client.nextFollowUp, undefined);
    assert.equal(client.dealAmount, undefined);
    assert.equal(client.commissionAmount, undefined);
    assert.equal(crm.activityLog.filter((entry) => entry.entityId === 2 && entry.action === 'Operación perdida').length, 1);

    const card = page.locator('.mvp-lead-card[data-client-id="2"]');
    await openLeadDetails(page, 2);
    await page.waitForSelector('.mvp-lead-card[data-client-id="2"] [data-commercial-close-card].lost');
    assert.match(await card.locator('[data-commercial-close-card]').textContent() || '', /El cliente cambió el alcance/);
    const width = await card.evaluate((element) => ({ card: element.getBoundingClientRect().width, viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(width.card <= width.viewport + 1, JSON.stringify(width));
    assert.ok(width.document <= width.viewport + 1, JSON.stringify(width));
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
