import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'p1-a4-owner';
const ORG_ID = 'p1-a4-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;

function owner(): TeamMember {
  return { id: 1, userId: USER_ID, name: 'Franco Solis', email: 'franco@propcontrol.test', phone: '5493515110069', role: 'Dueño', status: 'Activo', createdAt: '2026-08-24T18:00:00.000Z' };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'P1.1-A4' };
  crm.teamMembers = [owner()];
  crm.clients = [{
    id: 1, name: 'Lucía Martín', phone: '+54 9 351 511-0069', email: 'lucia@ejemplo.com', interest: 'Dúplex en Docta',
    budget: '120000', currency: 'USD', paymentMethod: 'Contado', zones: 'Docta', purpose: 'Vivir', purchaseTimeframe: '0-3 meses',
    canMoveForward: 'Sí', knowsArea: 'Sí', status: 'Lead', temperature: 'Caliente', pipeline: 'Visita coordinada', assignedToId: 1, createdById: 1,
  }];
  crm.properties = [{ id: 10, title: 'Docta Etapa 3', address: 'Docta, Córdoba', type: 'Dúplex', operation: 'Venta', price: 133000, owner: 'Constructor', status: 'Disponible', assignedToId: 1, createdById: 1 }];
  crm.visits = [];
  crm.offers = [];
  crm.reminders = [];
  crm.conversations = [];
  crm.contacts = [];
  crm.fichas = [];
  crm.activityLog = [];
  crm.settings = { ...crm.settings, profileName: owner().name, profileEmail: owner().email, agencyName: 'TRV Gestión Inmobiliaria' };
  return crm;
}

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(`${url}/health`)).ok) return; } catch { /* retry local server */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor P1.1-A4 no disponible.');
}

async function startServer(port: number): Promise<ChildProcess> {
  const server = spawn(process.execPath, ['dist/server.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', LEAD_QUALIFICATION_AI_ENDPOINT: '', LEAD_QUALIFICATION_AI_KEY: '', LEAD_QUALIFICATION_AI_MODEL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`http://127.0.0.1:${port}`);
  return server;
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { if (server.exitCode === null) server.kill('SIGKILL'); resolve(); }, 2_000);
    server.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function seedContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(({ crm, storageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({ accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000, userId: 'p1-a4-owner', email: 'franco@propcontrol.test' }));
    localStorage.setItem(storageKey, JSON.stringify(crm));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({ dirty: false, localUpdatedAt: '2026-08-24T18:00:00.000Z', lastCloudSavedAt: '2026-08-24T18:00:00.000Z', lastCloudVersion: '2026-08-24T18:00:00.000Z' }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { crm: fixture(), storageKey: STORAGE_KEY });
}

function futureLocalDate(days: number): string {
  const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.mvp-lead-card[data-client-id="1"]', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('[data-lead-offers="1"]', { state: 'attached', timeout: 20_000 });
}

async function openLead(page: Page): Promise<void> {
  const sheet = page.locator('[data-lead-full-sheet="1"]');
  if (!(await sheet.evaluate((element) => (element as HTMLDetailsElement).open))) {
    const lead = page.locator('.mvp-lead-card[data-client-id="1"]');
    const actions = lead.locator('.mvp-lead-actions-menu');
    await actions.waitFor({ state: 'visible', timeout: 10_000 });
    if (!(await actions.evaluate((element) => (element as HTMLDetailsElement).open))) await actions.locator(':scope > summary').click();
    await actions.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  }
  await page.waitForSelector('[data-lead-offers="1"]', { state: 'visible', timeout: 10_000 });
}

async function assertNoOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(metrics.html <= metrics.viewport + 1, `${label}: html overflow ${JSON.stringify(metrics)}`);
  assert.ok(metrics.body <= metrics.viewport + 1, `${label}: body overflow ${JSON.stringify(metrics)}`);
}

async function fillOfferForm(form: Locator, amount: string, origin: 'Cliente' | 'Propietario', action: string, days: number, withProperty = true): Promise<void> {
  if (withProperty) await form.locator('select[name="propertyId"]').selectOption('10');
  await form.locator('input[name="amount"]').fill(amount);
  await form.locator('select[name="currency"]').selectOption('USD');
  await form.locator('select[name="origin"]').selectOption(origin);
  await form.locator('input[name="paymentTerms"]').fill('Contado');
  await form.locator('input[name="nextAction"]').fill(action);
  await form.locator('input[name="nextFollowUp"]').fill(futureLocalDate(days));
}

test('P1.1-A4 browser desktop registra oferta, contraoferta y aceptación sin duplicar ni crear Reminder', async () => {
  const server = await startServer(48241);
  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable() });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  try {
    await seedContext(context);
    const page = await context.newPage();
    await load(page, 'http://127.0.0.1:48241');
    await openLead(page);
    assert.equal(await page.locator('[data-module="ofertas"]').count(), 0);
    assert.equal(await page.locator('#agenda').count(), 1);

    const register = page.locator('[data-offer-register-disclosure="1"]');
    await register.locator(':scope > summary').click();
    const form = register.locator('form[data-register-offer="1"]');
    await form.waitFor({ state: 'visible' });
    await fillOfferForm(form, '75000', 'Cliente', 'Presentar oferta al propietario', 3);
    await form.evaluate((node) => {
      const event = () => new SubmitEvent('submit', { bubbles: true, cancelable: true });
      node.dispatchEvent(event()); node.dispatchEvent(event());
    });
    await page.waitForFunction(async () => (await import('/dist/store.js')).state.crm.offers.length === 1);
    let snapshot = await page.evaluate(async () => {
      const crm = (await import('/dist/store.js')).state.crm;
      return { offers: crm.offers, client: crm.clients[0], reminders: crm.reminders, activity: crm.activityLog };
    });
    assert.equal(snapshot.offers.length, 1);
    assert.equal(snapshot.offers[0]?.status, 'Pendiente');
    assert.equal(snapshot.client.pipeline, 'Negociación');
    assert.equal(snapshot.client.nextAction, 'Presentar oferta al propietario');
    assert.equal(snapshot.reminders.length, 0);
    assert.deepEqual(snapshot.activity.map((entry) => entry.action), ['Oferta registrada']);

    await openLead(page);
    const parent = page.locator('.pc-offer-row[data-offer-id="1"]');
    await parent.locator('[data-counteroffer-disclosure="1"] > summary').click();
    const counter = parent.locator('form[data-register-counteroffer="1"]');
    await counter.waitFor({ state: 'visible' });
    await fillOfferForm(counter, '82000', 'Propietario', 'Presentar contraoferta al cliente', 4, false);
    await counter.locator('button[type="submit"]').click();
    await page.waitForFunction(async () => {
      const offers = (await import('/dist/store.js')).state.crm.offers;
      return offers.length === 2 && offers[0]?.status === 'Contraofertada' && offers[1]?.parentOfferId === 1;
    });

    await openLead(page);
    const child = page.locator('.pc-offer-row[data-offer-id="2"]');
    await child.waitFor({ state: 'visible' });
    assert.match(await child.textContent() || '', /Contraoferta de propuesta #1/);
    assert.match(await child.textContent() || '', /USD/);
    assert.match(await child.textContent() || '', /82[.,]000/);
    await child.locator('[data-resolve-offer-disclosure="2"] > summary').click();
    const resolve = child.locator('form[data-resolve-offer="2"]');
    await resolve.waitFor({ state: 'visible' });
    await resolve.locator('select[name="status"]').selectOption('Aceptada');
    await resolve.locator('input[name="nextAction"]').fill('Formalizar reserva');
    await resolve.locator('input[name="nextFollowUp"]').fill(futureLocalDate(5));
    await resolve.locator('button[type="submit"]').click();
    await page.waitForFunction(async () => (await import('/dist/store.js')).state.crm.offers.find((offer) => offer.id === 2)?.status === 'Aceptada');

    snapshot = await page.evaluate(async () => {
      const crm = (await import('/dist/store.js')).state.crm;
      return { offers: crm.offers, client: crm.clients[0], reminders: crm.reminders, activity: crm.activityLog };
    });
    assert.equal(snapshot.offers.find((offer) => offer.id === 1)?.status, 'Contraofertada');
    assert.equal(snapshot.offers.find((offer) => offer.id === 2)?.status, 'Aceptada');
    assert.equal(snapshot.client.pipeline, 'Negociación');
    assert.equal(snapshot.client.nextAction, 'Formalizar reserva');
    assert.equal(snapshot.reminders.length, 0);
    assert.deepEqual(snapshot.activity.map((entry) => entry.action), ['Oferta aceptada', 'Contraoferta registrada', 'Oferta registrada']);
    assert.equal('reservation' in snapshot, false);
    await assertNoOverflow(page, 'desktop');
  } finally { await context.close(); await browser.close(); await stopServer(server); }
});

test('P1.1-A4 browser mobile mantiene formulario/historial usable, targets >=44px y sin overflow', async () => {
  const server = await startServer(48242);
  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable() });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await seedContext(context);
    const page = await context.newPage();
    await load(page, 'http://127.0.0.1:48242');
    await openLead(page);
    const disclosure = page.locator('[data-offer-register-disclosure="1"]');
    const summary = disclosure.locator(':scope > summary');
    const summaryBox = await summary.boundingBox();
    assert.ok(summaryBox && summaryBox.height >= 43.99, `target Registrar oferta ${JSON.stringify(summaryBox)}`);
    await summary.click();
    const form = disclosure.locator('form[data-register-offer="1"]');
    await form.waitFor({ state: 'visible' });
    const controls = form.locator('input, select, textarea, button[type="submit"]');
    for (let index = 0; index < await controls.count(); index += 1) {
      const box = await controls.nth(index).boundingBox();
      assert.ok(box && box.height >= 43.99, `control móvil ${index} ${JSON.stringify(box)}`);
    }
    await fillOfferForm(form, '79000', 'Cliente', 'Consultar respuesta', 3);
    await form.locator('button[type="submit"]').click();
    await page.waitForFunction(async () => (await import('/dist/store.js')).state.crm.offers.length === 1);
    await openLead(page);
    const row = page.locator('.pc-offer-row[data-offer-id="1"]');
    await row.waitFor({ state: 'visible' });
    assert.match(await row.textContent() || '', /Docta Etapa 3/);
    assert.match(await row.textContent() || '', /79[.,]000/);
    const actionTargets = row.locator('.pc-offer-actions summary');
    for (let index = 0; index < await actionTargets.count(); index += 1) {
      const box = await actionTargets.nth(index).boundingBox();
      assert.ok(box && box.height >= 43.99, `acción móvil ${index} ${JSON.stringify(box)}`);
    }
    const resolveDisclosure = row.locator('[data-resolve-offer-disclosure="1"]');
    await resolveDisclosure.locator(':scope > summary').click();
    const resolveForm = resolveDisclosure.locator('form[data-resolve-offer="1"]');
    await resolveForm.waitFor({ state: 'visible' });
    const resolveControls = resolveForm.locator('input, select, button[type="submit"]');
    for (let index = 0; index < await resolveControls.count(); index += 1) {
      const box = await resolveControls.nth(index).boundingBox();
      assert.ok(box && box.height >= 43.99, `control resolución móvil ${index} ${JSON.stringify(box)}`);
    }
    await resolveForm.locator('select[name="status"]').selectOption('Rechazada');
    await resolveForm.locator('input[name="nextAction"]').fill('Enviar alternativas');
    await resolveForm.locator('input[name="nextFollowUp"]').fill(futureLocalDate(4));
    await resolveForm.locator('button[type="submit"]').click();
    await page.waitForFunction(async () => (await import('/dist/store.js')).state.crm.offers[0]?.status === 'Rechazada');
    const afterReject = await page.evaluate(async () => {
      const crm = (await import('/dist/store.js')).state.crm;
      return { offer: crm.offers[0], client: crm.clients[0], reminders: crm.reminders };
    });
    assert.equal(afterReject.offer?.status, 'Rechazada');
    assert.notEqual(afterReject.client.pipeline, 'Perdido');
    assert.equal(afterReject.client.nextAction, 'Enviar alternativas');
    assert.equal(afterReject.reminders.length, 0);
    assert.equal(await page.locator('[data-module="ofertas"]').count(), 0);
    assert.equal(await page.locator('#agenda').count(), 1);
    await assertNoOverflow(page, 'mobile');
  } finally { await context.close(); await browser.close(); await stopServer(server); }
});
