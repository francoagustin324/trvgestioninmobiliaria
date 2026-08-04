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
const userId = 'b133-desktop-centering-owner';
const memberId = 1;
const email = 'owner-b133-desktop-centering@propcontrol.test';
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
    nextFollowUp: '2026-08-05',
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
    createdAt: '2026-08-04T12:00:00.000Z',
  };
  crm.organization = {
    id: organizationId,
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'B1.3.3 desktop centering hotfix',
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
    createdAt: '2026-08-04T12:00:00.000Z',
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

async function reserveFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('No se pudo reservar un puerto TCP libre.'));
        return;
      }
      const port = address.port;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url: string, server: ChildProcess): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`El servidor de hotfix terminó prematuramente con código ${server.exitCode}.`);
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
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      server.off('exit', finish);
      server.off('error', finish);
      resolve();
    };
    const killTimer = setTimeout(() => {
      if (server.exitCode === null) {
        try {
          server.kill('SIGKILL');
        } catch {
          // El proceso ya terminó entre la comprobación y la señal.
        }
      }
      finish();
    }, 2_000);
    server.once('exit', finish);
    server.once('error', finish);
    try {
      server.kill('SIGTERM');
    } catch {
      finish();
    }
  });
}

async function startServer(): Promise<{ server: ChildProcess; port: number; url: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const port = await reserveFreePort();
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
      return { server, port, url };
    } catch (error) {
      lastError = error;
      await stopServer(server);
    }
  }
  throw new Error(`No se pudo iniciar el servidor en un puerto libre: ${String(lastError ?? 'sin detalle')}`);
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

async function prepareContext(context: BrowserContext, marker: string): Promise<void> {
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
      localUpdatedAt: '2026-08-04T12:00:00-03:00',
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
}

async function createContext(
  browser: Browser,
  viewport: { width: number; height: number },
  marker: string,
): Promise<BrowserContext> {
  const context = await browser.newContext(contextOptions(viewport));
  await prepareContext(context, marker);
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
  assert.equal(topElement, true, 'Ninguna capa debe tapar el control.');
}

async function openLeadForm(page: Page): Promise<Locator> {
  await page.locator('[data-toggle="client-form"]').click();
  const form = page.locator('#mvp-lead-form.b131-lead-form:not(.collapsed)');
  await form.waitFor({ state: 'visible' });
  return form;
}

async function assertDesktopModal(page: Page, screenshotName: string): Promise<void> {
  const form = await openLeadForm(page);
  const fields = form.locator('.b131-lead-form-fields');
  const internalClose = form.locator('.mvp-form-heading [data-cancel-client-edit]');
  const cancel = form.getByRole('button', { name: 'Cancelar', exact: true });
  const save = form.getByRole('button', { name: 'Guardar lead', exact: true });

  const geometry = await form.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const fieldContainer = element.querySelector<HTMLElement>('.b131-lead-form-fields');
    const nameInput = element.querySelector<HTMLElement>('input[name="name"]');
    const phoneInput = element.querySelector<HTMLElement>('input[name="phone"]');
    const nameRect = nameInput?.getBoundingClientRect();
    const phoneRect = phoneInput?.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      viewportCenterX: innerWidth / 2,
      viewportCenterY: innerHeight / 2,
      leftGutter: rect.left,
      rightGutter: innerWidth - rect.right,
      overflowX: fieldContainer ? getComputedStyle(fieldContainer).overflowX : '',
      overflowY: fieldContainer ? getComputedStyle(fieldContainer).overflowY : '',
      clientHeight: fieldContainer?.clientHeight ?? 0,
      scrollHeight: fieldContainer?.scrollHeight ?? 0,
      nameWidth: nameRect?.width ?? 0,
      phoneWidth: phoneRect?.width ?? 0,
    };
  });

  assert.ok(Math.abs(geometry.centerX - geometry.viewportCenterX) <= 1, JSON.stringify(geometry));
  assert.ok(Math.abs(geometry.centerY - geometry.viewportCenterY) <= 1, JSON.stringify(geometry));
  assert.ok(Math.abs(geometry.leftGutter - geometry.rightGutter) <= 2, JSON.stringify(geometry));
  assert.ok(geometry.left >= 20 && geometry.right <= (page.viewportSize()?.width ?? 0) - 20, JSON.stringify(geometry));
  assert.ok(geometry.top >= 20 && geometry.bottom <= (page.viewportSize()?.height ?? 0) - 20, JSON.stringify(geometry));
  assert.ok(geometry.width <= 921, JSON.stringify(geometry));
  assert.equal(geometry.overflowX, 'hidden');
  assert.equal(geometry.overflowY, 'auto');
  assert.ok(geometry.scrollHeight >= geometry.clientHeight, JSON.stringify(geometry));
  assert.ok(Math.abs(geometry.nameWidth - geometry.phoneWidth) <= 1, JSON.stringify(geometry));
  assert.equal(await internalClose.isVisible(), true);

  await assertFullyVisible(page, internalClose);
  await assertFullyVisible(page, cancel);
  await assertFullyVisible(page, save);
  await fields.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await assertFullyVisible(page, cancel);
  await assertFullyVisible(page, save);
  await assertNoHorizontalScroll(page);
  await page.screenshot({ path: `${artifactDir}/${screenshotName}`, fullPage: false });
  await internalClose.click();
  await page.waitForFunction(() => document.querySelector('#mvp-lead-form')?.classList.contains('collapsed'));
}

async function assertMobileRegression(page: Page): Promise<void> {
  const form = await openLeadForm(page);
  const pageToggle = page.locator('#crm [data-toggle="client-form"]');
  const internalClose = form.locator('.mvp-form-heading [data-cancel-client-edit]');
  const cancel = form.getByRole('button', { name: 'Cancelar', exact: true });
  const save = form.getByRole('button', { name: 'Guardar lead', exact: true });

  const toggleVisual = await pageToggle.evaluate((element) => ({
    content: getComputedStyle(element, '::after').content.replaceAll('"', ''),
    fontSize: getComputedStyle(element).fontSize,
  }));
  assert.equal(toggleVisual.content, '×');
  assert.equal(toggleVisual.fontSize, '0px');
  assert.equal(await internalClose.isVisible(), false);
  assert.equal(await page.getByText('Cerrar', { exact: true }).isVisible().catch(() => false), false);

  await assertFullyVisible(page, cancel);
  await assertFullyVisible(page, save);
  const cancelBox = await cancel.boundingBox();
  const saveBox = await save.boundingBox();
  const navBox = await page.locator('.mobile-bottom-nav').boundingBox();
  assert.ok(cancelBox && saveBox && navBox, 'Botones y navegación deben tener geometría.');
  assert.ok(cancelBox.y + cancelBox.height <= navBox.y + 1, JSON.stringify({ cancelBox, navBox }));
  assert.ok(saveBox.y + saveBox.height <= navBox.y + 1, JSON.stringify({ saveBox, navBox }));

  const fields = form.locator('.b131-lead-form-fields');
  const scrolling = await fields.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowX: getComputedStyle(element).overflowX,
    overflowY: getComputedStyle(element).overflowY,
  }));
  assert.equal(scrolling.overflowX, 'hidden');
  assert.equal(scrolling.overflowY, 'auto');
  assert.ok(scrolling.scrollHeight >= scrolling.clientHeight, JSON.stringify(scrolling));
  await fields.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await assertFullyVisible(page, cancel);
  await assertFullyVisible(page, save);
  await assertNoHorizontalScroll(page);
  await page.screenshot({ path: `${artifactDir}/24-hotfix-mobile-sin-regresion-390x844.png`, fullPage: false });

  await pageToggle.click();
  await page.waitForFunction(() => document.querySelector('#mvp-lead-form')?.classList.contains('collapsed'));
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
  assert.equal(await panel.locator('[data-whatsapp-manual-register]').isDisabled(), true);
  await assertNoHorizontalScroll(page);
  await page.screenshot({ path: `${artifactDir}/25-hotfix-mobile-identidad-unica-390x844.png`, fullPage: false });
  await panel.locator('[data-whatsapp-close]').click();
}

test('hotfix desktop B1.3.3 permanece consolidado, versionado y aislado de la lógica', () => {
  const index = readFileSync('index.html', 'utf8');
  const css = readFileSync('src/b1-3-3-mobile-postproduction-hotfix.css', 'utf8');
  const leadLogic = readFileSync('src/lead-create-reliability.ts', 'utf8');
  const whatsappLogic = readFileSync('src/whatsapp-contact.ts', 'utf8');

  assert.match(index, /b1-3-3-mobile-postproduction-hotfix\.css\?v=20260804-1/);
  assert.doesNotMatch(index, /b1-3-3-desktop-modal-centering-hotfix\.css/);
  assert.equal(existsSync('src/b1-3-3-desktop-modal-centering-hotfix.css'), false);
  assert.match(css, /@media \(min-width: 721px\)/);
  assert.match(css, /top:\s*50%/);
  assert.match(css, /left:\s*50%/);
  assert.match(css, /transform:\s*translate\(-50%, -50%\)/);
  assert.match(css, /width:\s*min\(920px, calc\(100vw - 64px\)\)/);
  assert.match(css, /max-height:\s*min\(680px, calc\(100dvh - 40px\)\)/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /\[data-cancel-client-edit\][\s\S]*display:\s*none !important/);
  assert.match(leadLogic, /findDuplicateClient/);
  assert.match(leadLogic, /Abrir lead existente/);
  assert.match(whatsappLogic, /assertCurrentWhatsAppHumanIdentity/);
  assert.match(whatsappLogic, /fingerprint/);
});

test('hotfix desktop B1.3.3 centra 1366x768 y 1280x720 y conserva Motorola 390x844', { timeout: 300_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome o Chromium debe estar disponible.');

  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    const started = await startServer();
    server = started.server;
    browser = await chromium.launch({ executablePath, headless: true });

    const desktop = await createContext(browser, { width: 1366, height: 768 }, 'b133-desktop-1366');
    try {
      const page = await desktop.newPage();
      await load(page, started.url);
      await assertDesktopModal(page, '22-hotfix-modal-centrado-1366x768.png');
    } finally {
      await desktop.close();
    }

    const laptop = await createContext(browser, { width: 1280, height: 720 }, 'b133-laptop-1280');
    try {
      const page = await laptop.newPage();
      await load(page, started.url);
      await assertDesktopModal(page, '23-hotfix-modal-centrado-1280x720.png');
    } finally {
      await laptop.close();
    }

    const mobile = await createContext(browser, { width: 390, height: 844 }, 'b133-mobile-390');
    try {
      const page = await mobile.newPage();
      await load(page, started.url);
      await assertMobileRegression(page);
    } finally {
      await mobile.close();
    }
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server) await stopServer(server);
  }
});
