import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
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

async function portIsFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const probe = createNetServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
}

async function findFreePort(): Promise<number> {
  const first = Math.floor(Math.random() * 80);
  for (let offset = 0; offset < 80; offset += 1) {
    const port = 62900 + ((first + offset) % 80);
    if (await portIsFree(port)) return port;
  }
  throw new Error('No hay un puerto libre entre 62900 y 62979 para la prueba del hotfix.');
}

async function waitForServer(url: string, server: ChildProcess): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`El servidor del hotfix terminó prematuramente con código ${server.exitCode}.`);
    }
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Servidor de hotfix no disponible: ${String(lastError ?? 'sin respuesta')}`);
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      server.off('exit', finish);
      server.off('error', finish);
      resolve();
    };
    server.once('exit', finish);
    server.once('error', finish);
    killTimer = setTimeout(() => {
      if (server.exitCode === null) {
        try {
          server.kill('SIGKILL');
        } catch {
          // El proceso terminó entre la comprobación y la señal.
        }
      }
      finish();
    }, 2_000);
    try {
      server.kill('SIGTERM');
    } catch {
      finish();
    }
  });
}

async function startServer(): Promise<{ server: ChildProcess; url: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const port = await findFreePort();
    const url = `http://127.0.0.1:${port}`;
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
    try {
      await waitForServer(url, server);
      return { server, url };
    } catch (error) {
      lastError = error;
      await stopServer(server);
    }
  }
  throw new Error(`No se pudo iniciar el servidor del hotfix en un puerto libre: ${String(lastError ?? 'sin detalle')}`);
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

async function assertAboveMobileNavigation(page: Page, locator: Locator): Promise<void> {
  const button = await locator.boundingBox();
  const navigation = await page.locator('.mobile-bottom-nav').boundingBox();
  assert.ok(button && navigation, 'Botón y navegación deben tener geometría.');
  assert.ok(button.y + button.height <= navigation.y + 1, JSON.stringify({ button, navigation }));
}

async function openLeadForm(page: Page): Promise<Locator> {
  await page.locator('[data-toggle="client-form"]').click();
  const form = page.locator('#mvp-lead-form.b131-lead-form:not(.collapsed)');
  await form.waitFor({ state: 'visible' });
  return form;
}

async function assertDesktopGeometry(page: Page, form: Locator): Promise<void> {
  const geometry = await form.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const fields = element.querySelector<HTMLElement>('.b131-lead-form-fields');
    const name = element.querySelector<HTMLElement>('input[name="name"]')?.getBoundingClientRect();
    const phone = element.querySelector<HTMLElement>('input[name="phone"]')?.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      viewportCenterX: innerWidth / 2,
      viewportCenterY: innerHeight / 2,
      leftGutter: rect.left,
      rightGutter: innerWidth - rect.right,
      overflowX: fields ? getComputedStyle(fields).overflowX : '',
      overflowY: fields ? getComputedStyle(fields).overflowY : '',
      clientHeight: fields?.clientHeight ?? 0,
      scrollHeight: fields?.scrollHeight ?? 0,
      nameWidth: name?.width ?? 0,
      phoneWidth: phone?.width ?? 0,
    };
  });
  const viewport = page.viewportSize();
  assert.ok(viewport);
  assert.ok(Math.abs(geometry.centerX - geometry.viewportCenterX) <= 1, JSON.stringify(geometry));
  assert.ok(Math.abs(geometry.centerY - geometry.viewportCenterY) <= 1, JSON.stringify(geometry));
  assert.ok(Math.abs(geometry.leftGutter - geometry.rightGutter) <= 2, JSON.stringify(geometry));
  assert.ok(geometry.left >= 20 && geometry.right <= viewport.width - 20, JSON.stringify(geometry));
  assert.ok(geometry.top >= 20 && geometry.bottom <= viewport.height - 20, JSON.stringify(geometry));
  assert.ok(geometry.width <= 921, JSON.stringify(geometry));
  assert.equal(geometry.overflowX, 'hidden');
  assert.equal(geometry.overflowY, 'auto');
  assert.ok(geometry.scrollHeight >= geometry.clientHeight, JSON.stringify(geometry));
  assert.ok(Math.abs(geometry.nameWidth - geometry.phoneWidth) <= 1, JSON.stringify(geometry));
}

async function verifyLeadModal(page: Page, mobile: boolean, screenshotName?: string): Promise<void> {
  const form = await openLeadForm(page);
  const pageToggle = page.locator('#crm [data-toggle="client-form"]');
  const internalClose = form.locator('.mvp-form-heading [data-cancel-client-edit]');
  const cancel = form.getByRole('button', { name: 'Cancelar', exact: true });
  const save = form.getByRole('button', { name: 'Guardar lead', exact: true });

  if (mobile) {
    assert.equal(await pageToggle.isVisible(), true);
    const toggleVisual = await pageToggle.evaluate((element) => ({
      pseudoContent: getComputedStyle(element, '::after').content,
      fontSize: getComputedStyle(element).fontSize,
    }));
    assert.equal(toggleVisual.pseudoContent.replaceAll('"', ''), '×');
    assert.equal(toggleVisual.fontSize, '0px');
    assert.equal(await internalClose.isVisible(), false);
    assert.equal(await page.getByText('Cerrar', { exact: true }).isVisible().catch(() => false), false);
  } else {
    assert.equal(await internalClose.isVisible(), true);
    await assertDesktopGeometry(page, form);
    await assertFullyVisible(page, internalClose);
  }

  await assertFullyVisible(page, cancel);
  await assertFullyVisible(page, save);

  const fields = form.locator('.b131-lead-form-fields');
  const scrolling = await fields.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowX: getComputedStyle(element).overflowX,
    overflowY: getComputedStyle(element).overflowY,
  }));
  assert.equal(scrolling.overflowX, 'hidden');
  assert.equal(scrolling.overflowY, 'auto');
  assert.ok(scrolling.scrollHeight >= scrolling.clientHeight);

  if (screenshotName) {
    await page.screenshot({ path: `${artifactDir}/${screenshotName}`, fullPage: false });
  }

  await fields.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await assertFullyVisible(page, cancel);
  await assertFullyVisible(page, save);
  await assertNoHorizontalScroll(page);

  if (mobile) {
    await assertAboveMobileNavigation(page, cancel);
    await assertAboveMobileNavigation(page, save);
    await form.locator('input[name="email"]').focus();
    await page.setViewportSize({ width: 390, height: 560 });
    await page.waitForTimeout(120);
    await assertFullyVisible(page, cancel);
    await assertFullyVisible(page, save);
    await assertAboveMobileNavigation(page, cancel);
    await assertAboveMobileNavigation(page, save);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(120);
  }

  await form.locator('input[name="name"]').fill('Lead duplicado de prueba');
  await form.locator('input[name="phone"]').fill('03515110069');
  await form.locator('input[name="interest"]').fill('Dúplex en Docta');
  await save.click();
  await form.locator('[data-lead-status][data-kind="duplicate"]').waitFor({ state: 'visible' });
  assert.equal(await form.getByRole('button', { name: 'Abrir lead existente', exact: true }).isVisible(), true);
  assert.equal(await form.getByRole('button', { name: 'Corregir número', exact: true }).isVisible(), true);

  if (mobile) await pageToggle.click();
  else await internalClose.click();
  await page.waitForFunction(() => document.querySelector('#mvp-lead-form')?.classList.contains('collapsed'));
}

async function verifyIdentityPanel(page: Page, screenshotName?: string): Promise<void> {
  await page.locator('#crm.active [data-contact-whatsapp="41"]').click();
  const panel = page.locator('#propcontrol-whatsapp-contact .whatsapp-contact-panel');
  await panel.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('#propcontrol-whatsapp-contact .whatsapp-context-note').length === 1);

  assert.equal(await panel.getByText('Configuración personal requerida', { exact: true }).count(), 1);
  assert.equal(await panel.locator('.whatsapp-context-note').count(), 1);
  assert.equal(await panel.locator('[data-whatsapp-identity-form] .whatsapp-context-note').count(), 0);
  assert.equal(await panel.locator('[data-whatsapp-identity-form] input[name="human-name"]').isVisible(), true);
  assert.equal(await panel.locator('[data-whatsapp-identity-form] input[name="confirmed"]').isVisible(), true);
  assert.equal(await panel.locator('[data-whatsapp-phone]').isDisabled(), true);
  assert.equal(await panel.locator('[data-whatsapp-message]').isDisabled(), true);
  assert.equal(await panel.locator('[data-whatsapp-open]').isDisabled(), true);
  assert.equal(await panel.locator('[data-whatsapp-manual-register]').count(), 0);
  await assertNoHorizontalScroll(page);

  if (screenshotName) {
    await page.screenshot({ path: `${artifactDir}/${screenshotName}`, fullPage: false });
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
  assert.match(index, /b1-3-3-mobile-postproduction-hotfix\.css\?v=20260804-1/);
  assert.match(index, /b1-3-3-mobile-postproduction-hotfix\.js\?v=20260803-1/);
  assert.doesNotMatch(index, /b1-3-3-desktop-modal-centering-hotfix\.css/);
  assert.doesNotMatch(hotfix, /MutationObserver/);
  assert.match(hotfix, /Configuración personal requerida/);
  assert.match(css, /\[data-cancel-client-edit\]/);
  assert.match(css, /var\(--pc-mobile-nav-height/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /transform:\s*translate\(-50%, -50%\)/);
  assert.match(leadLogic, /findDuplicateClient/);
  assert.match(leadLogic, /Abrir lead existente/);
  assert.match(whatsappLogic, /assertCurrentWhatsAppHumanIdentity/);
  assert.match(whatsappLogic, /fingerprint/);
});

test('hotfix B1.3.3 valida Motorola 390x844, laptop 1280x720 y escritorio 1366x768 sin regresiones', { timeout: 300_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome o Chromium debe estar disponible.');

  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    const started = await startServer();
    server = started.server;
    browser = await chromium.launch({ executablePath, headless: true });

    const desktopContext = await contextFor(browser, { width: 1366, height: 768 }, 'propcontrol-b133-hotfix-desktop');
    try {
      const page = await desktopContext.newPage();
      await load(page, started.url);
      await verifyLeadModal(page, false, '22-hotfix-modal-centrado-1366x768.png');
      await verifyIdentityPanel(page);
    } finally {
      await desktopContext.close();
    }

    const laptopContext = await contextFor(browser, { width: 1280, height: 720 }, 'propcontrol-b133-hotfix-laptop');
    try {
      const page = await laptopContext.newPage();
      await load(page, started.url);
      await verifyLeadModal(page, false, '23-hotfix-modal-centrado-1280x720.png');
    } finally {
      await laptopContext.close();
    }

    const mobileContext = await contextFor(browser, { width: 390, height: 844 }, 'propcontrol-b133-hotfix-mobile');
    try {
      const page = await mobileContext.newPage();
      await load(page, started.url);
      await verifyLeadModal(page, true, '24-hotfix-mobile-sin-regresion-390x844.png');
      await verifyIdentityPanel(page, '25-hotfix-mobile-identidad-unica-390x844.png');
    } finally {
      await mobileContext.close();
    }
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server) await stopServer(server);
  }
});
