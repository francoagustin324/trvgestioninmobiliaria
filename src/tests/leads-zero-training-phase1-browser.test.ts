import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'zero-training-owner';
const ORG_ID = 'zero-training-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const FIXED_TIME = new Date('2026-08-07T16:00:00-03:00');
const TOMORROW = '2026-08-08';
const PLUS_THREE = '2026-08-10';
const ARTIFACT_DIR = 'artifacts/b1-3';

interface TestWindow extends Window { __zeroTrainingOpenedUrl?: string; }

function owner(): TeamMember {
  return { id: 1, userId: USER_ID, name: 'Franco Solis', email: 'franco@propcontrol.test', phone: '5493515110069', role: 'Dueño', status: 'Activo', createdAt: '2026-08-01T12:00:00.000Z' };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Zero training' };
  crm.teamMembers = [owner()];
  crm.activityLog = [];
  crm.clients = [{ id: 1, name: 'Lucía Martín', phone: '+54 9 351 511-0069', email: 'lucia@ejemplo.com', interest: 'Dúplex en Docta', budget: 'USD 120000', currency: 'USD', status: 'Lead', temperature: 'Tibio', pipeline: 'Nuevo', assignedToId: 1, createdById: 1 }];
  crm.reminders = [];
  crm.conversations = [];
  crm.properties = [];
  crm.contacts = [];
  crm.fichas = [];
  crm.settings = { ...crm.settings, profileName: owner().name, profileEmail: owner().email, agencyName: 'TRV Gestión Inmobiliaria' };
  return crm;
}

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(`${url}/health`)).ok) return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor de prueba no disponible.');
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

async function contextFor(browser: Browser, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const actorKey = `cloud:${USER_ID}`;
  const identityKey = `propcontrol-whatsapp-human-identity-v1:${encodeURIComponent(ORG_ID)}:1:${encodeURIComponent(actorKey)}`;
  const mobile = viewport.width <= 430;
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'es-AR', timezoneId: 'America/Argentina/Cordoba', colorScheme: 'dark' });
  await context.addInitScript(({ crm, identityStorageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({ accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000, userId: 'zero-training-owner', email: 'franco@propcontrol.test' }));
    localStorage.setItem('trv-crm-basico:user:zero-training-owner', JSON.stringify(crm));
    localStorage.setItem('trv-crm-basico:user:zero-training-owner:sync', JSON.stringify({ dirty: false, localUpdatedAt: '2026-08-07T18:00:00.000Z', lastCloudSavedAt: '2026-08-07T18:00:00.000Z', lastCloudVersion: '2026-08-07T18:00:00.000Z' }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
    localStorage.setItem(identityStorageKey, JSON.stringify({ version: 1, organizationId: 'zero-training-org', memberId: 1, actorKey: 'cloud:zero-training-owner', humanName: 'Franco Solis', confirmedAt: '2026-08-07T18:00:00.000Z' }));
    Object.defineProperty(window, 'open', { configurable: true, value: (url?: string | URL) => { (window as TestWindow).__zeroTrainingOpenedUrl = String(url || ''); return null; } });
  }, { crm: fixture(), identityStorageKey: identityKey });
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.mvp-lead-card[data-client-id="1"] [data-contact-whatsapp="1"]', { state: 'visible', timeout: 20_000 });
}

async function crmFromStorage(page: Page): Promise<CrmData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}') as CrmData, STORAGE_KEY);
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(geometry.doc <= geometry.viewport + 1, JSON.stringify(geometry));
  assert.ok(geometry.body <= geometry.viewport + 1, JSON.stringify(geometry));
}

async function openWhatsAppAndReturn(page: Page): Promise<void> {
  await page.locator('[data-whatsapp-open]').click();
  assert.equal((await crmFromStorage(page)).activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 0, 'Abrir WhatsApp nunca registra el contacto.');
  await page.clock.runFor(800);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible', timeout: 10_000 });
}

test('FASE 1 navegador real: tarjeta simple, WhatsApp seguro, seguimiento automático y cambio explícito', { timeout: 180_000 }, async () => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible.');
  const port = 61800 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  const browser: Browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, { width: 1366, height: 768 });
  try {
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);
    const card = page.locator('.mvp-lead-card[data-client-id="1"]');
    const cardText = await card.innerText();
    assert.match(cardText, /Lucía Martín/);
    assert.match(cardText, /Busca:\s*Dúplex en Docta/);
    assert.match(cardText, /Presupuesto:\s*USD 120\.000/);
    assert.match(cardText, /Próximo paso/);
    assert.match(cardText, /WhatsApp/);
    assert.match(cardText, /Editar/);
    assert.doesNotMatch(cardText, /Calificar automáticamente|Ver ficha completa|Elimina\b/);
    await card.screenshot({ path: `${ARTIFACT_DIR}/20-zero-training-card-desktop.png` });

    const menu = card.locator('.mvp-lead-actions-menu');
    await menu.locator('summary').click();
    await card.screenshot({ path: `${ARTIFACT_DIR}/25-zero-training-menu-acciones.png` });
    assert.equal(await menu.getByRole('button', { name: 'Ver detalles', exact: true }).count(), 1);
    assert.equal(await menu.getByRole('button', { name: 'Completar datos con IA', exact: true }).count(), 1);
    assert.equal(await menu.getByRole('button', { name: 'Eliminar', exact: true }).count(), 1);
    const dialogPromise = page.waitForEvent('dialog');
    await menu.getByRole('button', { name: 'Eliminar', exact: true }).click();
    const dialog = await dialogPromise;
    assert.match(dialog.message(), /Eliminar este registro/i);
    await dialog.dismiss();
    assert.equal(await card.count(), 1);
    await page.evaluate(() => document.querySelector<HTMLDetailsElement>('.mvp-lead-actions-menu')?.removeAttribute('open'));

    await card.getByRole('button', { name: 'WhatsApp', exact: true }).click();
    const panel = page.locator('.whatsapp-contact-panel');
    await panel.waitFor({ state: 'visible' });
    assert.match(await panel.innerText(), /Mensaje para Lucía Martín/);
    assert.equal(await panel.locator('[data-whatsapp-open]').count(), 1);
    assert.equal(await panel.locator('[data-whatsapp-manual-register]').count(), 0);
    assert.equal(await panel.getByText('Ya lo envié, registrar', { exact: true }).count(), 0);
    assert.equal(await panel.locator('[data-whatsapp-phone]').isVisible(), false);
    assert.equal(await panel.locator('[data-whatsapp-copy]').isVisible(), false);
    assert.equal((await crmFromStorage(page)).activityLog.length, 0);
    await panel.screenshot({ path: `${ARTIFACT_DIR}/22-zero-training-whatsapp-un-cta.png` });

    await openWhatsAppAndReturn(page);
    assert.match(await panel.innerText(), /¿Enviaste el mensaje a Lucía Martín\?/);
    await panel.screenshot({ path: `${ARTIFACT_DIR}/23-zero-training-confirmacion-regreso.png` });
    await panel.getByRole('button', { name: 'Todavía no', exact: true }).click();
    assert.equal((await crmFromStorage(page)).activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 0);
    assert.equal((await crmFromStorage(page)).reminders.length, 0);

    await card.getByRole('button', { name: 'WhatsApp', exact: true }).click();
    await openWhatsAppAndReturn(page);
    await panel.getByRole('button', { name: 'Sí', exact: true }).click();
    await panel.getByText('Listo. Próximo contacto: Mañana', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await panel.locator('[data-whatsapp-followup-form]').count(), 0);
    assert.equal(await panel.locator('[data-zero-followup-form]').count(), 0);
    await panel.screenshot({ path: `${ARTIFACT_DIR}/24-zero-training-listo-proximo-contacto.png` });

    let stored = await crmFromStorage(page);
    assert.equal(stored.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 1);
    assert.equal(stored.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 1);
    assert.equal(stored.clients[0]?.nextFollowUp, TOMORROW);
    assert.equal(stored.clients[0]?.nextAction, 'Volver a contactar por WhatsApp');
    assert.equal(stored.reminders.length, 0);

    await panel.getByRole('button', { name: 'Cambiar', exact: true }).click();
    const change = panel.locator('[data-zero-followup-form]');
    const choices = await change.locator('input[name="follow-up-choice"]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));
    assert.deepEqual(choices, ['1', '3', '7', '14', '30', 'custom']);
    await change.locator('input[name="follow-up-choice"][value="3"]').check();
    assert.equal(await change.locator('input[name="selected-date"]').inputValue(), PLUS_THREE);
    await change.getByRole('button', { name: 'Guardar', exact: true }).click();
    await panel.getByText('Listo. Próximo contacto: En 3 días', { exact: true }).waitFor({ state: 'visible' });
    stored = await crmFromStorage(page);
    assert.equal(stored.clients[0]?.nextFollowUp, PLUS_THREE);
    assert.equal(stored.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 1);
    assert.equal(stored.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 1);
    assert.equal(stored.reminders.length, 0);

    await panel.locator('[data-whatsapp-close]').click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.mvp-lead-card[data-client-id="1"]', { state: 'visible' });
    assert.match(await page.locator('.mvp-lead-card[data-client-id="1"] .mvp-lead-next-action').innerText(), /WhatsApp[\s\S]*En 3 días/i);
    assert.equal((await crmFromStorage(page)).clients[0]?.nextFollowUp, PLUS_THREE);
    await noHorizontalScroll(page);
  } finally {
    await context.close(); await browser.close(); await stopServer(server);
  }
});

test('FASE 1 navegador real: tarjeta móvil 390 y 360 sin cortes ni scroll horizontal', { timeout: 120_000 }, async () => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible.');
  const port = 61920 + Math.floor(Math.random() * 70);
  const server = await startServer(port);
  const browser: Browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, { width: 390, height: 844 });
  try {
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);
    const card = page.locator('.mvp-lead-card[data-client-id="1"]');
    await card.screenshot({ path: `${ARTIFACT_DIR}/21-zero-training-card-mobile.png` });
    const actions = card.locator('.mvp-lead-quick-actions');
    const labels = await actions.locator(':scope > button, :scope > details > summary').allInnerTexts();
    assert.deepEqual(labels, ['WhatsApp', 'Editar', '•••']);
    await noHorizontalScroll(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(100);
    await noHorizontalScroll(page);
    const boxes = await actions.locator(':scope > button, :scope > details > summary').evaluateAll((nodes) => nodes.map((node) => { const box = (node as HTMLElement).getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width, viewport: innerWidth }; }));
    assert.ok(boxes.every((box) => box.left >= 0 && box.right <= box.viewport + 1 && box.width >= 44), JSON.stringify(boxes));
  } finally {
    await context.close(); await browser.close(); await stopServer(server);
  }
});
