import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type Client, type CrmData, type Property, type TeamMember, type TeamRole } from '../models.js';
import { tenantStorageNamespace } from '../tenant-storage.js';
import { installA35H5R1ModernTenantHarness } from './a35-h5-r1-modern-tenant-harness.js';

const FIXED_TIME = new Date('2026-09-25T15:00:00-03:00');
const TODAY = '2026-09-25';

function chromeExecutable(): string {
  const executable = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
  assert.ok(executable, 'Chrome/Chromium no disponible para Bloque 2D.');
  return executable;
}

function team(org: string): TeamMember[] {
  return [
    { id: 1, userId: 'owner-' + org, name: 'Dueño ' + org, email: 'owner-' + org + '@example.test', role: 'Dueño', status: 'Activo', createdAt: '2026-09-01T12:00:00.000Z' },
    { id: 2, userId: 'admin-' + org, name: 'Admin ' + org, email: 'admin-' + org + '@example.test', role: 'Administrador', status: 'Activo', createdAt: '2026-09-01T12:00:00.000Z' },
    { id: 3, userId: 'agent-' + org, name: 'Corredor ' + org, email: 'agent-' + org + '@example.test', role: 'Corredor', status: 'Activo', createdAt: '2026-09-01T12:00:00.000Z' },
    { id: 4, userId: 'hidden-' + org, name: 'Otro corredor ' + org, email: 'hidden-' + org + '@example.test', role: 'Corredor', status: 'Activo', createdAt: '2026-09-01T12:00:00.000Z' },
  ];
}

function fixture(org: string, extra: Partial<CrmData> = {}): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: org,
    name: 'TRV Sintética ' + org,
    seatLimit: null,
    planLabel: 'Block2D',
    commercialPhone: '5493515110000',
    commercialEmail: 'qa@example.test',
    address: 'Córdoba',
    logoPath: '',
    legalText: '',
    defaultCurrency: 'USD',
    defaultZone: 'Córdoba',
    shareText: '',
  };
  crm.teamMembers = team(org);
  crm.clients = [];
  crm.properties = [];
  crm.visits = [];
  crm.offers = [];
  crm.reservations = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.activityLog = [];
  crm.settings = { ...crm.settings, agencyName: crm.organization.name, agencyWhatsapp: '5493515110000' };
  return Object.assign(crm, extra);
}

function qualifiedClient(id: number, assignedToId = 1, name = 'Cliente rollback'): Client {
  return {
    id,
    uid: '22222222-2222-4222-8222-' + String(id).padStart(12, '0'),
    name,
    phone: '5493515550101',
    email: 'rollback@example.test',
    interest: 'Dúplex en Docta',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Calificado',
    budget: 'USD 130.000',
    currency: 'USD',
    paymentMethod: 'Contado',
    creditPossible: 'No necesita',
    zones: 'Docta',
    purpose: 'Vivir',
    purchaseTimeframe: '0-3 meses',
    canMoveForward: 'Sí',
    knowsArea: 'Sí',
    propertyType: 'Dúplex',
    operation: 'Compra',
    bedrooms: 2,
    assignedToId,
    createdById: assignedToId,
  };
}

function property(id: number, assignedToId = 1, title = 'Dúplex Docta'): Property {
  return {
    id,
    uid: '11111111-1111-4111-8111-' + String(id).padStart(12, '0'),
    title,
    address: 'Docta, Córdoba',
    type: 'Dúplex',
    operation: 'Venta',
    price: 120000,
    owner: 'Sintético',
    status: 'Activa',
    bedrooms: 2,
    assignedToId,
    createdById: assignedToId,
  };
}

async function waitForServer(baseUrl: string): Promise<void> {
  let last: unknown;
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(baseUrl + '/health')).ok) return;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor Block2D no disponible: ' + String(last ?? 'sin respuesta'));
}

async function startServer(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['dist/server.js'], {
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
  await waitForServer('http://127.0.0.1:' + port);
  return child;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 2000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function installPublicFichaHarness(context: BrowserContext): Promise<void> {
  await context.route('**/rest/v1/public_property_fichas*', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: '' });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([body]),
    });
  });
}

async function contextFor(
  browser: Browser,
  crm: CrmData,
  userId: string,
  memberId: number,
  suffix: string,
  viewport = { width: 1366, height: 900 },
): Promise<{ context: BrowserContext; crmKey: string; syncKey: string }> {
  const context = await browser.newContext({
    viewport,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    hasTouch: viewport.width <= 720,
    isMobile: viewport.width <= 430,
  });
  await installA35H5R1ModernTenantHarness(context, crm, userId);
  await installPublicFichaHarness(context);
  const ns = tenantStorageNamespace({ userId, organizationId: crm.organization.id });
  const marker = 'block2d-seed:' + suffix;
  await context.addInitScript(({ data, actorUserId, activeMemberId, crmKey, syncKey, markerKey }) => {
    if (localStorage.getItem(markerKey)) return;
    localStorage.setItem(markerKey, '1');
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'block2d-access-' + actorUserId,
      refreshToken: 'block2d-refresh-' + actorUserId,
      expiresAt: Date.now() + 3600000,
      userId: actorUserId,
      email: actorUserId + '@example.test',
    }));
    localStorage.setItem(crmKey, JSON.stringify(data));
    localStorage.setItem(syncKey, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-09-25T12:00:00.000Z',
      lastCloudSavedAt: '2026-09-25T12:00:00.000Z',
      lastCloudVersion: '2026-09-25T12:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', String(activeMemberId));
  }, { data: crm, actorUserId: userId, activeMemberId: memberId, crmKey: ns.crmKey, syncKey: ns.syncKey, markerKey: marker });
  return { context, crmKey: ns.crmKey, syncKey: ns.syncKey };
}

async function openApp(page: Page, baseUrl: string): Promise<void> {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20000 });
}

async function navigate(page: Page, moduleId: string): Promise<void> {
  await page.locator('[data-module="' + moduleId + '"]:visible').first().click();
  await page.waitForSelector('#' + moduleId + '.active', { state: 'visible' });
}

async function crmState(page: Page): Promise<CrmData> {
  return page.evaluate(async () => structuredClone((await import('/dist/store.js')).state.crm) as CrmData);
}

async function waitSyncClean(page: Page, syncKey: string): Promise<void> {
  await page.waitForFunction((key) => {
    const value = JSON.parse(localStorage.getItem(key) || '{}') as { dirty?: boolean };
    return value.dirty === false;
  }, syncKey, { timeout: 30000 });
}

async function openLeadDetails(page: Page, id: number): Promise<void> {
  const sheet = '.mvp-lead-card[data-client-id="' + id + '"] [data-lead-full-sheet="' + id + '"]';
  if (await page.locator(sheet).evaluate((node) => node instanceof HTMLDetailsElement && node.open).catch(() => false)) return;
  const actions = '.mvp-lead-card[data-client-id="' + id + '"] .mvp-lead-quick-actions[data-zero-training-actions="true"]';
  await page.waitForSelector(actions, { state: 'visible' });
  await page.locator(actions + ' .mvp-lead-actions-menu > summary').click();
  await page.locator(actions + ' .mvp-lead-actions-menu[open] [data-open-lead-details="' + id + '"]').click();
  await page.waitForFunction((selector) => {
    const node = document.querySelector(selector);
    return node instanceof HTMLDetailsElement && node.open;
  }, sheet);
}

async function createQuickLead(page: Page, name: string, phone: string): Promise<number> {
  await navigate(page, 'crm');
  await page.locator('[data-toggle="client-form"]').click();
  const form = page.locator('#mvp-lead-form:not(.collapsed)');
  await form.waitFor({ state: 'visible' });
  await form.locator('input[name="name"]').fill(name);
  await form.locator('input[name="phone"]').fill(phone);
  await form.locator('input[name="email"]').fill(name.toLowerCase().replace(/\s+/g, '-') + '@example.test');
  await form.locator('[data-save-lead]').click();
  await page.locator('#mvp-lead-results').getByText(name, { exact: true }).waitFor({ state: 'visible' });
  const crm = await crmState(page);
  const lead = crm.clients.find((item) => item.name === name);
  assert.ok(lead);
  return lead.id;
}

async function completeLeadRequirements(page: Page, clientId: number, nextAction = '', nextFollowUp = ''): Promise<void> {
  await navigate(page, 'crm');
  await page.locator('[data-edit-client="' + clientId + '"]:visible').first().click();
  const form = page.locator('#mvp-lead-form:not(.collapsed)');
  await form.waitFor({ state: 'visible' });
  await form.locator('input[name="interest"]').fill('Dúplex en Docta para vivir');
  await form.locator('select[name="pipeline"]').selectOption('Calificado');
  await form.locator('input[name="budget"]').fill('USD 130.000');
  await form.locator('input[name="currency"]').fill('USD');
  await form.locator('select[name="paymentMethod"]').selectOption('Contado');
  await form.locator('select[name="creditPossible"]').selectOption('No necesita');
  await form.locator('input[name="zones"]').fill('Docta');
  await form.locator('select[name="purpose"]').selectOption('Vivir');
  await form.locator('select[name="purchaseTimeframe"]').selectOption('0-3 meses');
  await form.locator('select[name="canMoveForward"]').selectOption('Sí');
  await form.locator('select[name="knowsArea"]').selectOption('Sí');
  const secondary = form.locator('details.lead-form-secondary');
  if (await secondary.getAttribute('open') === null) await secondary.locator(':scope > summary').click();
  await form.locator('input[name="propertyType"]').fill('Dúplex');
  await form.locator('input[name="bedrooms"]').fill('2');
  await form.locator('select[name="operation"]').selectOption('Compra');
  if (nextAction) await form.locator('input[name="nextAction"]').fill(nextAction);
  if (nextFollowUp) await form.locator('input[name="nextFollowUp"]').fill(nextFollowUp);
  await form.locator('[data-save-lead]').click();
  await page.locator('#mvp-lead-form.collapsed').waitFor({ state: 'attached' });
}

async function createQuickProperty(page: Page, title: string): Promise<number> {
  await navigate(page, 'propiedades');
  await page.locator('#propiedades [data-toggle="property-form"]').click();
  const form = page.locator('#propiedades #mvp-property-form:not(.collapsed)');
  await form.waitFor({ state: 'visible' });
  await form.locator('input[name="title"]').fill(title);
  await form.locator('input[name="address"]').fill('Docta, Córdoba');
  await form.locator('select[name="type"]').selectOption('Dúplex');
  await form.locator('select[name="operation"]').selectOption('Venta');
  await form.locator('input[name="price"]').fill('120000');
  await form.locator('button[type="submit"]').click();
  await page.locator('#propiedades #mvp-property-form.collapsed').waitFor({ state: 'attached' });
  const crm = await crmState(page);
  const created = crm.properties.find((item) => item.title === title);
  assert.ok(created);
  return created.id;
}

async function prepareAndSendDiffusion(page: Page, propertyId: number, clientId: number): Promise<void> {
  await navigate(page, 'propiedades');
  await page.locator('#propiedades [data-open-property-opportunities]').click();
  await page.waitForSelector('#propiedades [data-property-opportunities]', { state: 'visible' });
  await page.locator('[data-opportunity-property]').selectOption(String(propertyId));
  await page.waitForSelector('[data-opportunity-client="' + clientId + '"]', { state: 'visible' });
  await page.locator('[data-opportunity-select="' + clientId + '"]').check();
  await page.locator('[data-prepare-diffusion]').click();
  await page.waitForSelector('[data-diffusion-review]', { state: 'visible' });
  const sent = page.locator('[data-mark-diffusion-sent="' + clientId + '"][data-diffusion-channel="WhatsApp"]');
  await sent.waitFor({ state: 'visible', timeout: 10000 });
  await sent.click();
  await page.waitForFunction(({ clientId: id }) => {
    const card = document.querySelector('[data-diffusion-client="' + id + '"]');
    return Boolean(card?.textContent?.includes('Ya enviada'));
  }, { clientId });
}

async function saveDiffusionFollowUp(page: Page, clientId: number, action: string, date: string): Promise<void> {
  await page.locator('[data-add-diffusion-followup="' + clientId + '"]').click();
  const form = page.locator('#crm.active #mvp-lead-form:not(.collapsed)');
  await form.waitFor({ state: 'visible' });
  await form.locator('input[name="nextAction"]').fill(action);
  await form.locator('input[name="nextFollowUp"]').fill(date);
  await form.locator('[data-save-lead]').click();
  await page.locator('#mvp-lead-form.collapsed').waitFor({ state: 'attached' });
}

async function agendaCardFor(page: Page, text: string) {
  await navigate(page, 'agenda');
  const card = page.locator('#agenda.active .agenda-card').filter({ hasText: text });
  await card.first().waitFor({ state: 'visible' });
  return card;
}

async function openAgendaContext(page: Page, card: ReturnType<Page['locator']>, clientId: number): Promise<void> {
  const direct = card.locator('[data-open-agenda-context="' + clientId + '"]').first();
  if (await direct.isVisible()) {
    await direct.click();
  } else {
    const menu = card.locator('.agenda-more-actions > summary');
    await menu.waitFor({ state: 'visible' });
    await menu.click();
    await card.locator('[data-open-agenda-context="' + clientId + '"]:visible').click();
  }
  await page.waitForSelector('#crm.active', { state: 'visible' });
  await page.waitForFunction((selector) => {
    const node = document.querySelector(selector);
    return node instanceof HTMLDetailsElement && node.open;
  }, '[data-lead-full-sheet="' + clientId + '"]');
}

async function armStorageFailure(page: Page, marker: string): Promise<void> {
  await page.evaluate((targetMarker) => {
    const target = window as unknown as { __block2dSetItem?: typeof Storage.prototype.setItem };
    target.__block2dSetItem ??= Storage.prototype.setItem;
    const original = target.__block2dSetItem;
    Storage.prototype.setItem = function setItem(key: string, value: string): void {
      if (key.includes('trv-crm-basico:user') && value.includes(targetMarker)) {
        throw new Error('BLOCK2D_SYNTHETIC_PERSISTENCE_FAILURE:' + targetMarker);
      }
      original.call(this, key, value);
    };
  }, marker);
}

async function restoreStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as { __block2dSetItem?: typeof Storage.prototype.setItem };
    if (target.__block2dSetItem) Storage.prototype.setItem = target.__block2dSetItem;
  });
}

test('2D E2E WON recorre Lead → Propiedad → Difusión → Seguimiento → Visita → Oferta → Reserva → Cierre y F5', { timeout: 420000 }, async () => {
  const org = 'block2d-won-org';
  const userId = 'owner-' + org;
  const server = await startServer(63521);
  const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
  const seed = fixture(org);
  const { context, syncKey } = await contextFor(browser, seed, userId, 1, 'won');
  try {
    const page = await context.newPage();
    await openApp(page, 'http://127.0.0.1:63521');

    const clientId = await createQuickLead(page, 'CLIENTE E2E WON', '351 511 2201');
    await completeLeadRequirements(page, clientId);
    const propertyId = await createQuickProperty(page, 'DÚPLEX E2E DOCTA');

    await prepareAndSendDiffusion(page, propertyId, clientId);
    let crm = await crmState(page);
    assert.equal(crm.clients.find((item) => item.id === clientId)?.propertyDiffusions?.[0]?.sendCount, 1);
    assert.equal(crm.clients.find((item) => item.id === clientId)?.pipeline, 'Calificado');

    await saveDiffusionFollowUp(page, clientId, 'Confirmar visita E2E', '2026-09-26');
    let card = await agendaCardFor(page, 'CLIENTE E2E WON');
    assert.equal(await card.count(), 1);
    assert.equal(await card.locator('[data-agenda-source="client"]').count(), 1);
    await openAgendaContext(page, card.first(), clientId);

    const visitDisclosure = page.locator('[data-visit-coordinate-disclosure="' + clientId + '"]');
    await visitDisclosure.locator(':scope > summary').click();
    const visitForm = visitDisclosure.locator('form[data-coordinate-visit="' + clientId + '"]');
    await visitForm.locator('select[name="propertyId"]').selectOption(String(propertyId));
    await visitForm.locator('input[name="date"]').fill('2026-09-27');
    await visitForm.locator('input[name="time"]').fill('15:30');
    await visitForm.locator('button[type="submit"]').click();
    await page.waitForFunction(async ({ clientId: expectedClientId, propertyId: expectedPropertyId }) => {
      const visits = (await import('/dist/store.js')).state.crm.visits;
      return visits.some((item) => (
        item.clientId === expectedClientId
        && item.propertyId === expectedPropertyId
        && item.status === 'Coordinada'
      ));
    }, { clientId, propertyId });
    await waitSyncClean(page, syncKey);
    await page.waitForFunction(async ({ clientId: expectedClientId, propertyId: expectedPropertyId }) => {
      const visits = (await import('/dist/store.js')).state.crm.visits;
      return visits.some((item) => (
        item.clientId === expectedClientId
        && item.propertyId === expectedPropertyId
        && item.status === 'Coordinada'
      ));
    }, { clientId, propertyId });

    crm = await crmState(page);
    const visit = crm.visits.find((item) => item.clientId === clientId && item.propertyId === propertyId);
    assert.ok(visit, 'La visita coordinada debe seguir presente una vez confirmada la persistencia.');
    const visitId = visit.id;
    card = await agendaCardFor(page, 'CLIENTE E2E WON');
    assert.equal(await card.count(), 1, 'La visita coordinada no debe duplicarse con el follow-up espejo.');
    assert.equal(await card.locator('[data-agenda-source="visit"]').count(), 1);
    await openAgendaContext(page, card.first(), clientId);

    const visitRow = page.locator('.pc-visit-row[data-visit-id="' + visitId + '"]');
    await visitRow.locator('[data-visit-result-disclosure="' + visitId + '"] > summary').click();
    const resultForm = visitRow.locator('form[data-register-visit-result="' + visitId + '"]');
    await resultForm.locator('select[name="status"]').selectOption('Realizada');
    await resultForm.locator('select[name="interest"]').selectOption('Alto');
    await resultForm.locator('textarea[name="objection"]').fill('Revisar expensas');
    await resultForm.locator('input[name="nextAction"]').fill('Preparar oferta');
    await resultForm.locator('input[name="nextFollowUp"]').fill('2026-09-28');
    await resultForm.locator('button[type="submit"]').click();
    await page.waitForFunction((id) => (window as any).__unused !== id || true, visitId);
    await page.waitForFunction(async (id) => (await import('/dist/store.js')).state.crm.visits.find((item) => item.id === id)?.status === 'Realizada', visitId);

    await navigate(page, 'agenda');
    assert.equal(await page.locator('[data-agenda-source="visit"]').count(), 0);
    assert.equal(await page.locator('.agenda-card').filter({ hasText: 'Preparar oferta' }).count(), 1);

    await navigate(page, 'crm');
    await openLeadDetails(page, clientId);
    const offerDisclosure = page.locator('[data-offer-register-disclosure="' + clientId + '"]');
    await offerDisclosure.locator(':scope > summary').click();
    const offerForm = offerDisclosure.locator('form[data-register-offer="' + clientId + '"]');
    await offerForm.locator('select[name="propertyId"]').selectOption(String(propertyId));
    await offerForm.locator('input[name="amount"]').fill('115000');
    await offerForm.locator('select[name="currency"]').selectOption('USD');
    await offerForm.locator('select[name="origin"]').selectOption('Cliente');
    await offerForm.locator('input[name="paymentTerms"]').fill('Contado');
    await offerForm.locator('input[name="validUntil"]').fill('2026-09-30');
    await offerForm.locator('input[name="nextAction"]').fill('Presentar oferta al propietario');
    await offerForm.locator('input[name="nextFollowUp"]').fill('2026-09-28');
    await offerForm.locator('button[type="submit"]').click();
    await page.waitForFunction(async () => (await import('/dist/store.js')).state.crm.offers.length === 1);

    await navigate(page, 'agenda');
    assert.equal(await page.locator('[data-agenda-source="offer"]').count(), 1);
    const offerAgenda = page.locator('[data-agenda-source="offer"]').locator('xpath=ancestor::article[1]');
    await openAgendaContext(page, offerAgenda, clientId);

    const offer1 = page.locator('.pc-offer-row[data-offer-id="1"]');
    await offer1.locator('[data-counteroffer-disclosure="1"] > summary').click();
    const counter = offer1.locator('form[data-register-counteroffer="1"]');
    await counter.locator('input[name="amount"]').fill('118000');
    await counter.locator('select[name="currency"]').selectOption('USD');
    await counter.locator('select[name="origin"]').selectOption('Propietario');
    await counter.locator('input[name="paymentTerms"]').fill('Contado');
    await counter.locator('input[name="validUntil"]').fill('2026-10-01');
    await counter.locator('input[name="nextAction"]').fill('Presentar contraoferta al cliente');
    await counter.locator('input[name="nextFollowUp"]').fill('2026-09-29');
    await counter.locator('button[type="submit"]').click();
    await page.waitForFunction(async () => {
      const offers = (await import('/dist/store.js')).state.crm.offers;
      return offers.length === 2 && offers[0]?.status === 'Contraofertada' && offers[1]?.status === 'Pendiente';
    });

    await navigate(page, 'agenda');
    assert.equal(await page.locator('[data-agenda-source="offer"]').count(), 1, 'Sólo la contraoferta pendiente debe quedar en Agenda.');
    await navigate(page, 'crm');
    await openLeadDetails(page, clientId);
    const offer2 = page.locator('.pc-offer-row[data-offer-id="2"]');
    await offer2.locator('[data-resolve-offer-disclosure="2"] > summary').click();
    const resolve = offer2.locator('form[data-resolve-offer="2"]');
    await resolve.locator('select[name="status"]').selectOption('Aceptada');
    await resolve.locator('input[name="nextAction"]').fill('Formalizar reserva');
    await resolve.locator('input[name="nextFollowUp"]').fill('2026-09-29');
    await resolve.locator('button[type="submit"]').click();
    await page.waitForFunction(async () => (await import('/dist/store.js')).state.crm.offers.find((item) => item.id === 2)?.status === 'Aceptada');

    await navigate(page, 'agenda');
    assert.equal(await page.locator('[data-agenda-source="offer"]').count(), 0);
    assert.equal(await page.locator('.agenda-card').filter({ hasText: 'Formalizar reserva' }).count(), 1);

    await navigate(page, 'crm');
    await openLeadDetails(page, clientId);
    const reservationDisclosure = page.locator('[data-lead-reservations="' + clientId + '"] [data-reservation-disclosure]');
    await reservationDisclosure.locator(':scope > summary').click();
    const reservationForm = reservationDisclosure.locator('form[data-register-reservation="' + clientId + '"]');
    await reservationForm.locator('select[name="propertyId"]').selectOption(String(propertyId));
    await reservationForm.locator('select[name="offerId"]').selectOption('2');
    await reservationForm.locator('input[name="amount"]').fill('5000');
    await reservationForm.locator('select[name="currency"]').selectOption('USD');
    await reservationForm.locator('input[name="paymentMethod"]').fill('Transferencia');
    await reservationForm.locator('input[name="reservedAt"]').fill('2026-09-29');
    await reservationForm.locator('input[name="expiresAt"]').fill('2026-10-03');
    await reservationForm.locator('button[type="submit"]').click();
    await page.waitForFunction(async () => (await import('/dist/store.js')).state.crm.reservations.some((item) => item.status === 'Activa'));

    await navigate(page, 'agenda');
    assert.equal(await page.locator('[data-agenda-source="reservation"]').count(), 1);
    await navigate(page, 'crm');
    await openLeadDetails(page, clientId);
    await page.locator('.mvp-lead-card[data-client-id="' + clientId + '"] [data-close-operation-stage="Ganado"]').click();
    const won = page.locator('dialog[data-commercial-close-dialog][open] [data-commercial-close-modal-form="won"]');
    await won.waitFor({ state: 'visible' });
    await won.locator('input[name="dealAmount"]').fill('118000');
    await won.locator('select[name="dealCurrency"]').selectOption('USD');
    await won.locator('select[name="dealPropertyId"]').selectOption(String(propertyId));
    await won.locator('select[name="commissionMode"]').selectOption('percentage');
    await won.locator('input[name="commissionPercentage"]').fill('3');
    await won.locator('textarea[name="closeNote"]').fill('Cierre sintético E2E');
    await won.locator('[data-commercial-close-confirm="Ganado"]').click();
    await page.waitForFunction(async (id) => {
      const client = (await import('/dist/store.js')).state.crm.clients.find((item) => item.id === id);
      return client?.outcome === 'won' && client.pipeline === 'Ganado';
    }, clientId);

    await navigate(page, 'agenda');
    assert.equal(await page.locator('.agenda-card').filter({ hasText: 'CLIENTE E2E WON' }).count(), 0, 'Un lead ganado no debe quedar en colas activas.');
    crm = await crmState(page);
    const closed = crm.clients.find((item) => item.id === clientId)!;
    assert.equal(closed.outcome, 'won');
    assert.equal(closed.closedAt, TODAY);
    assert.equal(closed.dealAmount, 118000);
    assert.equal(closed.dealPropertyId, propertyId);
    assert.equal(closed.commissionPercentage, 3);
    assert.equal(closed.nextAction, undefined);
    assert.equal(closed.nextFollowUp, undefined);
    assert.equal(crm.visits[0]?.status, 'Realizada');
    assert.deepEqual(crm.offers.map((item) => item.status), ['Contraofertada', 'Aceptada']);
    assert.equal(crm.reservations[0]?.status, 'Activa', 'El cierre no debe reescribir historia estructurada sin contrato explícito.');
    const actions = crm.activityLog.filter((item) => item.entityId === clientId).map((item) => item.action);
    for (const expected of ['Propiedad enviada', 'Visita coordinada', 'Visita realizada', 'Oferta registrada', 'Contraoferta registrada', 'Oferta aceptada', 'Reserva registrada', 'Operación ganada']) {
      assert.ok(actions.includes(expected), expected);
    }

    await waitSyncClean(page, syncKey);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#crm.active', { state: 'visible' });
    crm = await crmState(page);
    assert.equal(crm.clients.find((item) => item.id === clientId)?.outcome, 'won');
    assert.equal(crm.visits[0]?.status, 'Realizada');
    assert.equal(crm.offers[1]?.status, 'Aceptada');
    assert.equal(crm.reservations[0]?.status, 'Activa');
    assert.equal(crm.clients.find((item) => item.id === clientId)?.propertyDiffusions?.[0]?.sendCount, 1);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('2D E2E LOST exige motivo, conserva historia y sale de Agenda y oportunidades activas', { timeout: 240000 }, async () => {
  const org = 'block2d-lost-org';
  const userId = 'owner-' + org;
  const seed = fixture(org, { properties: [property(10)] });
  const server = await startServer(63522);
  const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
  const { context, syncKey } = await contextFor(browser, seed, userId, 1, 'lost');
  try {
    const page = await context.newPage();
    await openApp(page, 'http://127.0.0.1:63522');
    const clientId = await createQuickLead(page, 'CLIENTE E2E LOST', '351 511 2202');
    await completeLeadRequirements(page, clientId, 'Revisar precio final', '2026-09-26');

    await navigate(page, 'propiedades');
    await page.locator('[data-open-property-opportunities]').click();
    await page.locator('[data-opportunity-property]').selectOption('10');
    await page.waitForSelector('[data-opportunity-client="' + clientId + '"]', { state: 'visible' });
    await page.locator('[data-opportunities-back]').click();

    await navigate(page, 'crm');
    await openLeadDetails(page, clientId);
    await page.locator('.mvp-lead-card[data-client-id="' + clientId + '"] [data-close-operation-stage="Perdido"]').click();
    const lost = page.locator('dialog[data-commercial-close-dialog][open] [data-commercial-close-modal-form="lost"]');
    await lost.waitFor({ state: 'visible' });
    await lost.locator('[data-commercial-close-confirm="Perdido"]').click();
    await lost.locator('[data-commercial-close-error]').waitFor({ state: 'visible' });
    assert.match(await lost.locator('[data-commercial-close-error]').innerText(), /motivo/i);
    await lost.locator('select[name="lostReason"]').selectOption('Precio');
    await lost.locator('[data-commercial-close-confirm="Perdido"]').click();
    await page.waitForFunction(async (id) => {
      const client = (await import('/dist/store.js')).state.crm.clients.find((item) => item.id === id);
      return client?.pipeline === 'Perdido'
        && client.outcome === 'lost'
        && Boolean(client.closedAt)
        && Boolean(client.lostReason)
        && !client.nextAction
        && !client.nextFollowUp;
    }, clientId);

    let crm = await crmState(page);
    const closed = crm.clients.find((item) => item.id === clientId)!;
    assert.equal(closed.pipeline, 'Perdido');
    assert.equal(closed.outcome, 'lost');
    assert.equal(closed.closedAt, TODAY);
    assert.equal(closed.lostReason, 'Precio');
    assert.equal(closed.dealAmount, undefined);
    assert.equal(closed.commissionAmount, undefined);
    assert.equal(closed.nextAction, undefined);
    assert.equal(closed.nextFollowUp, undefined);
    assert.ok(crm.activityLog.some((item) => item.entityId === clientId && item.action === 'Operación perdida'));

    await navigate(page, 'agenda');
    assert.equal(await page.locator('.agenda-card').filter({ hasText: 'CLIENTE E2E LOST' }).count(), 0);
    await navigate(page, 'propiedades');
    await page.locator('[data-open-property-opportunities]').click();
    await page.locator('[data-opportunity-property]').selectOption('10');
    assert.equal(await page.locator('[data-opportunity-client="' + clientId + '"]').count(), 0);
    await page.locator('[data-opportunity-status]').selectOption('all');
    assert.match(await page.locator('[data-opportunity-terminal]').innerText(), /CLIENTE E2E LOST/);

    await waitSyncClean(page, syncKey);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#crm.active', { state: 'visible' });
    crm = await crmState(page);
    const reloadedLost = crm.clients.find((item) => item.id === clientId);
    assert.equal(reloadedLost?.pipeline, 'Perdido');
    assert.equal(reloadedLost?.outcome, 'lost');
    assert.equal(reloadedLost?.lostReason, 'Precio');
    assert.ok(reloadedLost?.closedAt);
    assert.equal(reloadedLost?.nextAction, undefined);
    assert.equal(reloadedLost?.nextFollowUp, undefined);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('2D fallos de persistencia revierten Visita Oferta Reserva y Cierre sin éxito falso', { timeout: 300000 }, async () => {
  const org = 'block2d-rollback-org';
  const userId = 'owner-' + org;
  const seed = fixture(org, { clients: [qualifiedClient(1)], properties: [property(10)] });
  const server = await startServer(63523);
  const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
  const { context } = await contextFor(browser, seed, userId, 1, 'rollback');
  try {
    const page = await context.newPage();
    await openApp(page, 'http://127.0.0.1:63523');
    await page.evaluate(() => localStorage.removeItem('propcontrol-cloud-session-v1'));
    await openLeadDetails(page, 1);

    const visitDisclosure = page.locator('[data-visit-coordinate-disclosure="1"]');
    await visitDisclosure.locator(':scope > summary').click();
    const visitForm = visitDisclosure.locator('form[data-coordinate-visit="1"]');
    await visitForm.locator('select[name="propertyId"]').selectOption('10');
    await visitForm.locator('input[name="date"]').fill('2026-09-27');
    await visitForm.locator('input[name="time"]').fill('15:00');
    await armStorageFailure(page, 'Visita coordinada');
    await visitForm.locator('button[type="submit"]').click();
    await visitForm.locator('[data-visit-form-error]').waitFor({ state: 'visible' });
    let crm = await crmState(page);
    assert.equal(crm.visits.length, 0);
    assert.equal(crm.clients[0]?.pipeline, 'Calificado');
    await restoreStorage(page);

    const offerDisclosure = page.locator('[data-offer-register-disclosure="1"]');
    await offerDisclosure.locator(':scope > summary').click();
    const offerForm = offerDisclosure.locator('form[data-register-offer="1"]');
    await offerForm.locator('select[name="propertyId"]').selectOption('10');
    await offerForm.locator('input[name="amount"]').fill('110000');
    await offerForm.locator('input[name="nextAction"]').fill('Presentar oferta');
    await offerForm.locator('input[name="nextFollowUp"]').fill('2026-09-28');
    await armStorageFailure(page, 'Oferta registrada');
    await offerForm.locator('button[type="submit"]').click();
    await offerForm.locator('[data-offer-form-error]').waitFor({ state: 'visible' });
    crm = await crmState(page);
    assert.equal(crm.offers.length, 0);
    assert.equal(crm.clients[0]?.pipeline, 'Calificado');
    await restoreStorage(page);

    const reservationDisclosure = page.locator('[data-reservation-disclosure]');
    await reservationDisclosure.locator(':scope > summary').click();
    const reservationForm = reservationDisclosure.locator('form[data-register-reservation="1"]');
    await reservationForm.locator('select[name="propertyId"]').selectOption('10');
    await reservationForm.locator('input[name="amount"]').fill('5000');
    await reservationForm.locator('input[name="reservedAt"]').fill('2026-09-26');
    await reservationForm.locator('input[name="expiresAt"]').fill('2026-09-30');
    await armStorageFailure(page, 'Reserva registrada');
    await reservationForm.locator('button[type="submit"]').click();
    await reservationForm.locator('[data-reservation-error]').waitFor({ state: 'visible' });
    crm = await crmState(page);
    assert.equal(crm.reservations.length, 0);
    assert.equal(crm.clients[0]?.pipeline, 'Calificado');
    await restoreStorage(page);

    await armStorageFailure(page, 'Operación ganada');
    await page.locator('.mvp-lead-card[data-client-id="1"] [data-close-operation-stage="Ganado"]').click();
    const won = page.locator('dialog[data-commercial-close-dialog][open] [data-commercial-close-modal-form="won"]');
    await won.waitFor({ state: 'visible' });
    await won.locator('input[name="dealAmount"]').fill('120000');
    await won.locator('select[name="dealCurrency"]').selectOption('USD');
    await won.locator('select[name="dealPropertyId"]').selectOption('10');
    await won.locator('input[name="commissionPercentage"]').fill('3');
    await won.locator('[data-commercial-close-confirm="Ganado"]').click();
    const leadForm = page.locator('#mvp-lead-form:not(.collapsed)');
    await leadForm.locator('[data-lead-error]').waitFor({ state: 'visible', timeout: 10000 });
    crm = await crmState(page);
    assert.equal(crm.clients[0]?.outcome, undefined);
    assert.equal(crm.clients[0]?.pipeline, 'Calificado');
    assert.equal(crm.activityLog.some((item) => item.action === 'Operación ganada'), false);
    await restoreStorage(page);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('2D mobile/roles/tenants: Dueño y Admin ven alcance permitido; Corredor sólo asignado y Tenant A/B aislados', { timeout: 240000 }, async () => {
  const orgA = 'block2d-role-a';
  const orgB = 'block2d-role-b';
  const crmA = fixture(orgA, {
    clients: [qualifiedClient(1, 1, 'TENANT A OWNER RECORD')],
    properties: [property(10, 1, 'TENANT A PROPERTY')],
  });
  const crmB = fixture(orgB, {
    clients: [
      qualifiedClient(21, 3, 'TENANT B AGENT RECORD'),
      qualifiedClient(22, 4, 'TENANT B HIDDEN RECORD'),
    ],
    properties: [
      property(210, 3, 'TENANT B AGENT PROPERTY'),
      property(220, 4, 'TENANT B HIDDEN PROPERTY'),
    ],
  });
  const server = await startServer(63524);
  const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
  try {
    const adminSetup = await contextFor(browser, crmA, 'admin-' + orgA, 2, 'admin', { width: 1366, height: 900 });
    const adminPage = await adminSetup.context.newPage();
    await openApp(adminPage, 'http://127.0.0.1:63524');
    assert.match(await adminPage.locator('#crm').innerText(), /TENANT A OWNER RECORD/);
    await openLeadDetails(adminPage, 1);
    assert.equal(await adminPage.locator('[data-visit-coordinate-disclosure="1"]').count(), 1);
    assert.equal(await adminPage.locator('[data-offer-register-disclosure="1"]').count(), 1);
    assert.equal(await adminPage.locator('[data-reservation-disclosure]').count(), 1);
    assert.doesNotMatch(await adminPage.locator('body').innerText(), /TENANT B/);
    await adminSetup.context.close();

    const agentSetup = await contextFor(browser, crmB, 'agent-' + orgB, 3, 'agent-mobile', { width: 390, height: 844 });
    const agentPage = await agentSetup.context.newPage();
    await openApp(agentPage, 'http://127.0.0.1:63524');
    const body = await agentPage.locator('body').innerText();
    assert.match(body, /TENANT B AGENT RECORD/);
    assert.doesNotMatch(body, /TENANT B HIDDEN RECORD/);
    assert.doesNotMatch(body, /TENANT A/);
    await openLeadDetails(agentPage, 21);
    for (const selector of ['[data-visit-coordinate-disclosure="21"] > summary', '[data-offer-register-disclosure="21"] > summary', '[data-reservation-disclosure] > summary', '[data-close-operation-stage="Ganado"]', '[data-close-operation-stage="Perdido"]']) {
      const node = agentPage.locator('.mvp-lead-card[data-client-id="21"] ' + selector);
      await node.waitFor({ state: 'visible' });
      const box = await node.boundingBox();
      assert.ok(box && box.height >= 43.5 && box.x >= -1 && box.x + box.width <= 391, selector + ':' + JSON.stringify(box));
    }
    const metrics = await agentPage.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }));
    assert.ok(metrics.documentWidth <= metrics.viewport + 1 && metrics.bodyWidth <= metrics.viewport + 1, JSON.stringify(metrics));
    await navigate(agentPage, 'agenda');
    assert.doesNotMatch(await agentPage.locator('#agenda').innerText(), /TENANT A|TENANT B HIDDEN/);
    await agentSetup.context.close();
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
