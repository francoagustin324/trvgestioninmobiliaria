import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from 'playwright';
import { initialData, type Client, type CrmData, type TeamMember } from '../models.js';

const artifactDir = 'artifacts/b1-3-3';
const organizationId = 'trvgestioninmobiliaria';
const userId = 'b133-hotfix-owner';
const memberId = 1;
const email = 'owner-b133-hotfix@propcontrol.test';
const sessionKey = 'propcontrol-cloud-session-v1';
const activeMemberKey = 'propcontrol-active-team-member-v1';
const storageKey = `trv-crm-basico:user:${userId}`;
const syncKey = `${storageKey}:sync`;
const motorolaUserAgent = 'Mozilla/5.0 (Linux; Android 12; moto g(60) Build/S2RIS32.32-20-7-10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

function existingLead(): Client {
  return {
    id: 41,
    name: 'Lead WhatsApp existente',
    phone: '5493515110069',
    email: 'lead-existente@propcontrol.test',
    interest: 'Dúplex en Docta',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    nextAction: 'Contactar por WhatsApp',
    nextFollowUp: '2026-08-04',
    assignedToId: memberId,
    createdById: memberId,
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  const owner: TeamMember = {
    id: memberId,
    userId,
    name: 'trvgestioninmobiliaria',
    email,
    phone: '5493515110001',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-03T12:00:00.000Z',
  };
  crm.organization = {
    id: organizationId,
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'B1.3.3 hotfix',
  };
  crm.teamMembers = [owner];
  crm.clients = [existingLead()];
  crm.conversations = [];
  crm.properties = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.activityLog = [{
    id: 1,
    actorId: memberId,
    action: 'Lead creado',
    entityType: 'Cliente',
    entityId: 41,
    detail: 'Lead creado: Lead WhatsApp existente',
    createdAt: '2026-08-03T12:00:00.000Z',
  }];
  crm.settings = {
    ...crm.settings,
    profileName: 'Gerencia Comercial',
    profileEmail: email,
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
}

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
  throw new Error(`Servidor de hotfix no disponible: ${String(lastError ?? 'sin respuesta')}`);
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

function contextOptions(viewport: { width: number; height: number }): BrowserContextOptions {
  const mobile = viewport.width <= 430;
  return {
    viewport,
    deviceScaleFactor: 1,
    hasTouch: mobile,
    isMobile: mobile,
    userAgent: mobile ? motorolaUserAgent : undefined,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
  };
}

async function contextFor(
  browser: Browser,
  viewport: { width: number; height: number },
  marker: string,
): Promise<BrowserContext> {
  const context = await browser.newContext(contextOptions(viewport));
  await context.route('**/api/cloud-config', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Nube de prueba no disponible.' }),
    });
  });
  await context.addInitScript(({ data, keys, currentUserId, currentEmail, currentMemberId, initMarker }) => {
    if (localStorage.getItem(initMarker)) return;
    localStorage.setItem(initMarker, '1');
    localStorage.setItem(keys.session, JSON.stringify({
      accessToken: `access-${currentUserId}`,
      refreshToken: `refresh-${currentUserId}`,
      expiresAt: Date.now() + 3_600_000,
      userId: currentUserId,
      email: currentEmail,
    }));
    localStorage.setItem(keys.storage, JSON.stringify(data));
    localStorage.setItem(keys.sync, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-08-03T16:30:00-03:00',
    }));
    localStorage.setItem(keys.activeMember, String(currentMemberId));
  }, {
    data: fixture(),
    keys: {
      session: sessionKey,
      storage: storageKey,
      sync: syncKey,
      activeMember: activeMemberKey,
    },
    currentUserId: userId,
    currentEmail: email,
    currentMemberId: memberId,
    initMarker: marker,
  });
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 25_000 });
  await page.locator('#mvp-lead-order').waitFor({ state: 'attached' });
}

async function assertNoHorizontalScroll(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(geometry.document <= geometry.viewport + 1, JSON.stringify(geometry));
  assert.ok(geometry.body <= geometry.viewport + 1, JSON.stringify(geometry));
}

async function assertFullyVisible(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && viewport, 'El elemento debe tener geometría visible.');
  assert.ok(box.x >= -1, JSON.stringify(box));
  assert.ok(box.y >= -1, JSON.stringify(box));
  assert.ok(box.x + box.width <= viewport.width + 1, JSON.stringify({ box, viewport }));
  assert.ok(box.y + box.height <= viewport.height + 1, JSON.stringify({ box, viewport }));
  const topElement = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return top === element || Boolean(top && element.contains(top));
  });
  assert.equal(topElement, true, 'La navegación inferior o una capa no debe tapar el botón.');
}

async function openLeadForm(page: Page): Promise<Locator> {
  await page.locator('[data-toggle="client-form"]').click();
  const form = page.locator('#mvp-lead-form.b131-lead-form:not(.collapsed)');
  await form.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.b133-postproduction-modal-close')?.textContent === '×');
  return form;
}

async function verifyLeadModal(page: Page, mobile: boolean): Promise<void> {
  const form = await openLeadForm(page);
  const close = form.locator('.mvp-form-heading .b133-postproduction-modal-close');
  const cancel = form.getByRole('button', { name: 'Cancelar', exact: true });
  const save = form.getByRole('button', { name: 'Guardar lead', exact: true });

  assert.equal(await close.count(), 1);
  assert.equal((await close.textContent())?.trim(), '×');
  assert.equal(await form.getByRole('button', { name: 'Cerrar', exact: true }).count(), 0);
  assert.equal(await page.locator('#crm .mvp-page-heading [data-toggle="client-form"]').isVisible(), false);
  await assertFullyVisible(page, cancel);
  await assertFullyVisible(page, save);

  const scrolling = await form.locator('.b131-lead-form-fields').evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowX: getComputedStyle(element).overflowX,
    overflowY: getComputedStyle(element).overflowY,
  }));
  assert.equal(scrolling.overflowX, 'hidden');
  assert.equal(scrolling.overflowY, 'auto');
  assert.ok(scrolling.scrollHeight >= scrolling.clientHeight);
  await form.locator('.b131-lead-form-fields').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await assertFullyVisible(page, cancel);
  await assertFullyVisible(page, save);
  await assertNoHorizontalScroll(page);

  if (mobile) {
    await page.screenshot({ path: `${artifactDir}/18-hotfix-modal-completo-390x844.png`, fullPage: true });
    await form.locator('input[name="email"]').focus();
    await page.setViewportSize({ width: 390, height: 560 });
    await page.waitForTimeout(120);
    await assertFullyVisible(page, cancel);
    await assertFullyVisible(page, save);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(120);
  }

  await form.locator('input[name="name"]').fill('Lead duplicado de prueba');
  await form.locator('input[name="phone"]').fill('03515110069');
  await form.locator('input[name="interest"]').fill('Dúplex en Docta');
  await save.click();
  await form.getByText('Este WhatsApp ya pertenece al lead Lead WhatsApp existente.').waitFor({ state: 'visible' });
  assert.equal(await form.getByRole('button', { name: 'Abrir lead existente', exact: true }).isVisible(), true);
  assert.equal(await form.getByRole('button', { name: 'Corregir número', exact: true }).isVisible(), true);
  await close.click();
  await form.waitFor({ state: 'detached' });
}

async function verifyIdentityPanel(page: Page, screenshot: boolean): Promise<void> {
  await page.locator('#crm.active [data-contact-whatsapp="41"]').click();
  const panel = page.locator('#propcontrol-whatsapp-contact .whatsapp-contact-panel');
  await panel.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('#propcontrol-whatsapp-contact .whatsapp-context-note').length === 1);

  assert.equal(await panel.getByText('Configuración personal requerida', { exact: true }).count(), 1);
  assert.equal(await panel.locator('.whatsapp-context-note').count(), 1);
  assert.equal(await panel.locator('[data-whatsapp-identity-form] .whatsapp-context-note').count(), 0);
  assert.equal(await panel.getByLabel('Nombre personal para firmar mensajes').isVisible(), true);
  assert.equal(await panel.locator('[data-whatsapp-identity-form] input[name="confirmed"]').isVisible(), true);
  assert.equal(await panel.locator('[data-whatsapp-phone]').isDisabled(), true);
  assert.equal(await panel.locator('[data-whatsapp-message]').isDisabled(), true);
  assert.equal(await panel.locator('[data-whatsapp-open]').isDisabled(), true);
  assert.equal(await panel.locator('[data-whatsapp-manual-register]').isDisabled(), true);
  await assertNoHorizontalScroll(page);

  if (screenshot) {
    await page.screenshot({ path: `${artifactDir}/19-hotfix-identidad-sin-duplicado-390x844.png`, fullPage: true });
  }
  await panel.locator('[data-whatsapp-close]').click();
}

test('hotfix B1.3.3 conserva el alcance visual y la carga responsive', () => {
  const index = readFileSync('index.html', 'utf8');
  const hotfix = readFileSync('src/b1-3-3-mobile-postproduction-hotfix.ts', 'utf8');
  const css = readFileSync('src/b1-3-3-mobile-postproduction-hotfix.css', 'utf8');
  const leadLogic = readFileSync('src/lead-create-reliability.ts', 'utf8');
  const whatsappLogic = readFileSync('src/whatsapp-contact.ts', 'utf8');

  assert.match(index, /interactive-widget=resizes-content/);
  assert.match(index, /b1-3-3-mobile-postproduction-hotfix\.css\?v=20260803-1/);
  assert.match(index, /b1-3-3-mobile-postproduction-hotfix\.js\?v=20260803-1/);
  assert.match(hotfix, /b133-postproduction-modal-close/);
  assert.match(hotfix, /Configuración personal requerida/);
  assert.match(css, /--pc-visual-viewport-height/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(leadLogic, /findDuplicateClient/);
  assert.match(leadLogic, /Abrir lead existente/);
  assert.match(whatsappLogic, /assertCurrentWhatsAppHumanIdentity/);
  assert.match(whatsappLogic, /fingerprint/);
});

test('hotfix B1.3.3 valida Motorola 390x844 y escritorio 1366x768 sin regresiones', { timeout: 300_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome o Chromium debe estar disponible.');
  const port = 62900 + Math.floor(Math.random() * 80);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const mobileContext = await contextFor(browser, { width: 390, height: 844 }, 'propcontrol-b133-hotfix-mobile');
    try {
      const page = await mobileContext.newPage();
      await load(page, url);
      await verifyLeadModal(page, true);
      await verifyIdentityPanel(page, true);
    } finally {
      await mobileContext.close();
    }

    const desktopContext = await contextFor(browser, { width: 1366, height: 768 }, 'propcontrol-b133-hotfix-desktop');
    try {
      const page = await desktopContext.newPage();
      await load(page, url);
      await verifyLeadModal(page, false);
      await verifyIdentityPanel(page, false);
      await page.screenshot({ path: `${artifactDir}/20-hotfix-escritorio-1366x768.png`, fullPage: true });
    } finally {
      await desktopContext.close();
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
