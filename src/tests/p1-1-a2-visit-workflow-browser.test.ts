import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'p1-a2-owner';
const ORG_ID = 'p1-a2-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;

function owner(): TeamMember {
  return {
    id: 1,
    userId: USER_ID,
    name: 'Franco Solis',
    email: 'franco@propcontrol.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-23T18:00:00.000Z',
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'P1.1-A2' };
  crm.teamMembers = [owner()];
  crm.clients = [{
    id: 1,
    name: 'Lucía Martín',
    phone: '+54 9 351 511-0069',
    email: 'lucia@ejemplo.com',
    interest: 'Dúplex en Docta',
    budget: '120000',
    currency: 'USD',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Nuevo',
    assignedToId: 1,
    createdById: 1,
    lastContact: '2026-08-23',
  }];
  crm.properties = [{
    id: 10,
    title: 'Docta Etapa 3',
    address: 'Docta, Córdoba',
    type: 'Dúplex',
    operation: 'Venta',
    price: 133000,
    owner: 'Constructor',
    status: 'Disponible',
    assignedToId: 1,
    createdById: 1,
  }];
  crm.visits = [];
  crm.reminders = [];
  crm.conversations = [];
  crm.contacts = [];
  crm.fichas = [];
  crm.activityLog = [];
  crm.settings = {
    ...crm.settings,
    profileName: owner().name,
    profileEmail: owner().email,
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
}

function chromeExecutable(): string | undefined {
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(existsSync);
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {
      // retry local test server only
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor P1.1-A2 no disponible.');
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
    server.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function seedContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(({ crm, storageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: 'p1-a2-owner',
      email: 'franco@propcontrol.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(crm));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-08-23T18:00:00.000Z',
      lastCloudSavedAt: '2026-08-23T18:00:00.000Z',
      lastCloudVersion: '2026-08-23T18:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { crm: fixture(), storageKey: STORAGE_KEY });
}

function futureLocalDate(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.mvp-lead-card[data-client-id="1"]', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('[data-lead-visits="1"]', { state: 'attached', timeout: 20_000 });
}

async function openLead(page: Page): Promise<void> {
  const sheet = page.locator('[data-lead-full-sheet="1"]');
  if (!(await sheet.evaluate((element) => (element as HTMLDetailsElement).open))) {
    const lead = page.locator('.mvp-lead-card[data-client-id="1"]');
    const actions = lead.locator('.mvp-lead-actions-menu');
    await actions.waitFor({ state: 'visible', timeout: 10_000 });
    const actionsSummary = actions.locator(':scope > summary');
    if (!(await actions.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await actionsSummary.click();
    }
    await actions.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  }
  await page.waitForSelector('[data-lead-visits="1"]', { state: 'visible', timeout: 10_000 });
}

async function assertNoOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(metrics.html <= metrics.viewport + 1, `${label}: html overflow ${JSON.stringify(metrics)}`);
  assert.ok(metrics.body <= metrics.viewport + 1, `${label}: body overflow ${JSON.stringify(metrics)}`);
}

test('P1.1-A2 browser desktop coordina una sola visita y registra resultado sin duplicarla', async () => {
  const port = 48231;
  const server = await startServer(port);
  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable() });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  try {
    await seedContext(context);
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);
    await openLead(page);

    const coordinate = page.locator('.pc-visit-coordinate');
    const coordinateSummary = coordinate.locator(':scope > summary');
    assert.equal(await coordinate.locator('form[data-coordinate-visit="1"]').count(), 0);
    assert.equal(await coordinate.locator('input[type="date"]').count(), 0);
    await coordinateSummary.click();
    let form = coordinate.locator('form[data-coordinate-visit="1"]');
    await form.waitFor({ state: 'visible' });
    assert.equal(await coordinate.locator('input[type="date"]').count(), 1);
    await coordinateSummary.click();
    await form.waitFor({ state: 'detached' });
    assert.equal(await coordinate.locator('form[data-coordinate-visit="1"]').count(), 0);
    assert.equal(await coordinate.locator('input[type="date"]').count(), 0);
    await coordinateSummary.click();
    form = coordinate.locator('form[data-coordinate-visit="1"]');
    await form.waitFor({ state: 'visible' });
    await form.locator('select[name="propertyId"]').selectOption('10');
    await form.locator('input[name="date"]').fill(futureLocalDate(3));
    await form.locator('input[name="time"]').fill('15:30');
    await form.evaluate((node) => {
      const event = () => new SubmitEvent('submit', { bubbles: true, cancelable: true });
      node.dispatchEvent(event());
      node.dispatchEvent(event());
    });
    await page.waitForFunction(async () => {
      const store = await import('/dist/store.js');
      return store.state.crm.visits.length === 1;
    });

    const afterCoordinate = await page.evaluate(async () => {
      const store = await import('/dist/store.js');
      return {
        visits: store.state.crm.visits,
        client: store.state.crm.clients[0],
        reminders: store.state.crm.reminders,
        activity: store.state.crm.activityLog,
      };
    });
    assert.equal(afterCoordinate.visits.length, 1);
    assert.equal(afterCoordinate.visits[0]?.status, 'Coordinada');
    assert.equal(afterCoordinate.visits[0]?.propertyId, 10);
    assert.equal(afterCoordinate.client.pipeline, 'Visita coordinada');
    assert.equal(afterCoordinate.client.nextAction, 'Visita · Docta Etapa 3');
    assert.equal(afterCoordinate.reminders.length, 0);
    assert.equal(afterCoordinate.activity.at(-1)?.action, 'Visita coordinada');

    await openLead(page);
    const row = page.locator('.pc-visit-row[data-visit-id="1"]');
    const resultDisclosure = row.locator('.pc-visit-result');
    const resultSummary = resultDisclosure.locator(':scope > summary');
    const resultSummaryBox = await resultSummary.boundingBox();
    assert.ok(resultSummaryBox && resultSummaryBox.height >= 43.99, `target Registrar resultado ${JSON.stringify(resultSummaryBox)}`);
    assert.equal(await resultDisclosure.locator('form[data-register-visit-result="1"]').count(), 0);
    assert.equal(await resultDisclosure.locator('input[type="date"]').count(), 0);
    await resultSummary.click();
    let resultForm = row.locator('form[data-register-visit-result="1"]');
    await resultForm.waitFor({ state: 'visible' });
    assert.equal(await resultDisclosure.locator('input[type="date"]').count(), 1);
    await resultSummary.click();
    await resultForm.waitFor({ state: 'detached' });
    assert.equal(await resultDisclosure.locator('form[data-register-visit-result="1"]').count(), 0);
    assert.equal(await resultDisclosure.locator('input[type="date"]').count(), 0);
    await resultSummary.click();
    resultForm = row.locator('form[data-register-visit-result="1"]');
    await resultForm.waitFor({ state: 'visible' });
    await resultForm.locator('select[name="status"]').selectOption('Realizada');
    await resultForm.locator('select[name="interest"]').selectOption('Alto');
    await resultForm.locator('textarea[name="objection"]').fill('Quiere revisar expensas');
    await resultForm.locator('input[name="nextAction"]').fill('Enviar propuesta');
    await resultForm.locator('input[name="nextFollowUp"]').fill(futureLocalDate(5));
    await resultForm.locator('button[type="submit"]').click();

    await page.waitForFunction(async () => {
      const store = await import('/dist/store.js');
      return store.state.crm.visits[0]?.status === 'Realizada';
    });
    const afterResult = await page.evaluate(async () => {
      const store = await import('/dist/store.js');
      return {
        visits: store.state.crm.visits,
        client: store.state.crm.clients[0],
        activity: store.state.crm.activityLog,
      };
    });
    assert.equal(afterResult.visits.length, 1);
    assert.equal(afterResult.visits[0]?.status, 'Realizada');
    assert.equal(afterResult.visits[0]?.interest, 'Alto');
    assert.equal(afterResult.client.nextAction, 'Enviar propuesta');
    assert.equal(afterResult.activity.at(-1)?.action, 'Visita realizada');
    await openLead(page);
    await page.waitForSelector('.pc-visit-status.status-realizada', { state: 'visible' });
    await assertNoOverflow(page, 'desktop');
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('P1.1-A2 browser mobile mantiene Visitas usable, targets táctiles y sin overflow', async () => {
  const port = 48232;
  const server = await startServer(port);
  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable() });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await seedContext(context);
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);
    await openLead(page);

    const coordinate = page.locator('.pc-visit-coordinate');
    const coordinateSummary = coordinate.locator(':scope > summary');
    const box = await coordinateSummary.boundingBox();
    assert.ok(box && box.height >= 43.99, `target Coordinar visita ${JSON.stringify(box)}`);
    const form = coordinate.locator('.pc-visit-form');
    assert.equal(await form.count(), 0);
    assert.equal(await coordinate.locator('input[type="date"]').count(), 0);
    await coordinateSummary.click();
    await form.waitFor({ state: 'visible' });
    assert.equal(await coordinate.locator('input[type="date"]').count(), 1);
    await coordinateSummary.click();
    await form.waitFor({ state: 'detached' });
    assert.equal(await form.count(), 0);
    assert.equal(await coordinate.locator('input[type="date"]').count(), 0);
    await coordinateSummary.click();
    await form.waitFor({ state: 'visible' });

    const inputs = coordinate.locator('.pc-visit-form input, .pc-visit-form select, .pc-visit-form button[type="submit"]');
    for (let index = 0; index < await inputs.count(); index += 1) {
      const inputBox = await inputs.nth(index).boundingBox();
      assert.ok(inputBox && inputBox.height >= 43.99, `mobile input ${index}: ${JSON.stringify(inputBox)}`);
    }
    await assertNoOverflow(page, 'mobile');
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
