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
const userId = 'b133-desktop-center-owner';
const memberId = 1;
const email = 'owner-b133-desktop-center@propcontrol.test';
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
    createdAt: '2026-08-04T12:00:00.000Z',
  };
  crm.organization = {
    id: organizationId,
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'B1.3.3 hotfix desktop',
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
      localUpdatedAt: '2026-08-04T11:30:00-03:00',
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
}

async function openLeadForm(page: Page): Promise<Locator> {
  await page.locator('[data-toggle="client-form"]').click();
  const form = page.locator('#mvp-lead-form.b131-lead-form:not(.collapsed)');
  await form.waitFor({ state: 'visible' });
  await page.waitForTimeout(120);
  return form;
}

async function verifyDesktopModal(page: Page, screenshotName: string): Promise<void> {
  const form = await openLeadForm(page);
  const title = form.getByRole('heading', { name: 'Nuevo lead', exact: true });
  const fields = form.locator('.b131-lead-form-fields');
  const footer = form.locator('.b131-lead-form-footer');
  const cancel = form.getByRole('button', { name: 'Cancelar', exact: true });
  const save = form.getByRole('button', { name: 'Guardar lead', exact: true });
  const internalClose = form.getByRole('button', { name: 'Cerrar', exact: true });

  assert.equal(await title.isVisible(), true);
  assert.equal(await internalClose.isVisible(), true);
  await assertFullyVisible(page, cancel);
  await assertFullyVisible(page, save);

  const geometry = await form.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const headingRect = element.querySelector('.mvp-form-heading')?.getBoundingClientRect();
    const fieldsElement = element.querySelector<HTMLElement>('.b131-lead-form-fields');
    const fieldsRect = fieldsElement?.getBoundingClientRect();
    const footerRect = element.querySelector('.b131-lead-form-footer')?.getBoundingClientRect();
    const style = getComputedStyle(element);
    const fieldsStyle = fieldsElement ? getComputedStyle(fieldsElement) : null;
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      position: style.position,
      overflowX: style.overflowX,
      headingLeft: headingRect?.left ?? 0,
      headingRight: headingRect?.right ?? 0,
      fieldsLeft: fieldsRect?.left ?? 0,
      fieldsRight: fieldsRect?.right ?? 0,
      footerLeft: footerRect?.left ?? 0,
      footerRight: footerRect?.right ?? 0,
      fieldsOverflowX: fieldsStyle?.overflowX ?? '',
      fieldsOverflowY: fieldsStyle?.overflowY ?? '',
      fieldsClientHeight: fieldsElement?.clientHeight ?? 0,
      fieldsScrollHeight: fieldsElement?.scrollHeight ?? 0,
    };
  });

  const leftGutter = geometry.left;
  const rightGutter = geometry.viewportWidth - geometry.right;
  assert.equal(geometry.position, 'fixed');
  assert.equal(geometry.overflowX, 'hidden');
  assert.ok(Math.abs(geometry.centerX - geometry.viewportWidth / 2) <= 1.5, JSON.stringify(geometry));
  assert.ok(Math.abs(geometry.centerY - geometry.viewportHeight / 2) <= 1.5, JSON.stringify(geometry));
  assert.ok(Math.abs(leftGutter - rightGutter) <= 2, JSON.stringify({ leftGutter, rightGutter, geometry }));
  assert.ok(geometry.left >= 20 && geometry.right <= geometry.viewportWidth - 20, JSON.stringify(geometry));
  assert.ok(geometry.top >= 18 && geometry.bottom <= geometry.viewportHeight - 18, JSON.stringify(geometry));
  assert.ok(geometry.width <= 921 && geometry.width >= 760, JSON.stringify(geometry));
  assert.ok(Math.abs((geometry.headingLeft - geometry.left) - (geometry.right - geometry.headingRight)) <= 8, JSON.stringify(geometry));
  assert.ok(Math.abs((geometry.fieldsLeft - geometry.left) - (geometry.right - geometry.fieldsRight)) <= 24, JSON.stringify(geometry));
  assert.ok(Math.abs((geometry.footerLeft - geometry.left) - (geometry.right - geometry.footerRight)) <= 8, JSON.stringify(geometry));
  assert.equal(geometry.fieldsOverflowX, 'hidden');
  assert.equal(geometry.fieldsOverflowY, 'auto');
  assert.ok(geometry.fieldsScrollHeight >= geometry.fieldsClientHeight);

  const firstField = fields.locator(':scope > label').nth(0);
  const secondField = fields.locator(':scope > label').nth(1);
  const firstBox = await firstField.boundingBox();
  const secondBox = await secondField.boundingBox();
  assert.ok(firstBox && secondBox, 'Las dos columnas principales deben ser visibles.');
  assert.ok(Math.abs(firstBox.width - secondBox.width) <= 2, JSON.stringify({ firstBox, secondBox }));
  assert.ok(secondBox.x > firstBox.x + firstBox.width, JSON.stringify({ firstBox, secondBox }));

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

async function verifyMobileRegression(page: Page): Promise<void> {
  const form = await openLeadForm(page);
  const pageToggle = page.locator('#crm [data-toggle="client-form"]');
  const internalClose = form.locator('.mvp-form-heading [data-cancel-client-edit]');
  const cancel = form.getByRole('button', { name: 'Cancelar', exact: true });
  const save = form.getByRole('button', { name: 'Guardar lead', exact: true });
  const navigation = page.locator('.mobile-bottom-nav');

  const toggleVisual = await pageToggle.evaluate((element) => ({
    pseudoContent: getComputedStyle(element, '::after').content,
    fontSize: getComputedStyle(element).fontSize,
  }));
  assert.equal(toggleVisual.pseudoContent.replaceAll('"', ''), '×');
  assert.equal(toggleVisual.fontSize, '0px');
  assert.equal(await internalClose.isVisible(), false);
  assert.equal(await form.getByRole('heading', { name: 'Nuevo lead', exact: true }).isVisible(), true);
  await assertFullyVisible(page, cancel);
  await assertFullyVisible(page, save);

  const cancelBox = await cancel.boundingBox();
  const saveBox = await save.boundingBox();
  const navigationBox = await navigation.boundingBox();
  assert.ok(cancelBox && saveBox && navigationBox, 'Los botones y la navegación deben tener geometría.');
  assert.ok(cancelBox.y + cancelBox.height <= navigationBox.y + 1, JSON.stringify({ cancelBox, navigationBox }));
  assert.ok(saveBox.y + saveBox.height <= navigationBox.y + 1, JSON.stringify({ saveBox, navigationBox }));
  await assertNoHorizontalScroll(page);
  await page.screenshot({ path: `${artifactDir}/24-hotfix-mobile-sin-regresion-390x844.png`, fullPage: false });

  await pageToggle.click();
  await page.waitForFunction(() => document.querySelector('#mvp-lead-form')?.classList.contains('collapsed'));

  await page.locator('#crm.active [data-contact-whatsapp="41"]').click();
  const panel = page.locator('#propcontrol-whatsapp-contact .whatsapp-contact-panel');
  await panel.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('#propcontrol-whatsapp-contact .whatsapp-context-note').length === 1);
  assert.equal(await panel.getByText('Configuración personal requerida', { exact: true }).count(), 1);
  assert.equal(await panel.locator('[data-whatsapp-identity-form] input[name="human-name"]').isVisible(), true);
  assert.equal(await panel.locator('[data-whatsapp-identity-form] input[name="confirmed"]').isVisible(), true);
  assert.equal(await panel.locator('[data-whatsapp-phone]').isDisabled(), true);
  assert.equal(await panel.locator('[data-whatsapp-message]').isDisabled(), true);
  assert.equal(await panel.locator('[data-whatsapp-open]').isDisabled(), true);
  assert.equal(await panel.locator('[data-whatsapp-manual-register]').isDisabled(), true);
  await assertNoHorizontalScroll(page);
  await page.screenshot({ path: `${artifactDir}/25-hotfix-identidad-mobile-sin-regresion-390x844.png`, fullPage: false });
  await panel.locator('[data-whatsapp-close]').click();
}

test('hotfix desktop B1.3.3 permanece visual y aislado de la lógica', () => {
  const index = readFileSync('index.html', 'utf8');
  const desktopCss = readFileSync('src/b1-3-3-desktop-modal-centering-hotfix.css', 'utf8');
  const mobileCss = readFileSync('src/b1-3-3-mobile-postproduction-hotfix.css', 'utf8');
  const leadLogic = readFileSync('src/lead-create-reliability.ts', 'utf8');
  const whatsappLogic = readFileSync('src/whatsapp-contact.ts', 'utf8');

  assert.match(index, /b1-3-3-mobile-postproduction-hotfix\.css\?v=20260803-1/);
  assert.match(index, /b1-3-3-desktop-modal-centering-hotfix\.css\?v=20260804-1/);
  assert.ok(index.indexOf('b1-3-3-mobile-postproduction-hotfix.css') < index.indexOf('b1-3-3-desktop-modal-centering-hotfix.css'));
  assert.match(desktopCss, /@media \(min-width: 721px\)/);
  assert.match(desktopCss, /top: 50%/);
  assert.match(desktopCss, /left: 50%/);
  assert.match(desktopCss, /translate\(-50%, -50%\)/);
  assert.match(desktopCss, /width: min\(920px, calc\(100vw - 80px\)\)/);
  assert.doesNotMatch(desktopCss, /@media \(max-width: 720px\)/);
  assert.doesNotMatch(desktopCss, /fingerprint|snapshot|duplicate|Agenda|sync|permission/i);
  assert.match(mobileCss, /\[data-cancel-client-edit\]/);
  assert.match(mobileCss, /var\(--pc-mobile-nav-height/);
  assert.match(leadLogic, /findDuplicateClient/);
  assert.match(leadLogic, /readLocalSnapshot/);
  assert.match(leadLogic, /writeLocalSnapshot/);
  assert.match(whatsappLogic, /assertCurrentWhatsAppHumanIdentity/);
  assert.match(whatsappLogic, /fingerprint/);
});

test('hotfix desktop B1.3.3 centra el modal y conserva Motorola', { timeout: 300_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome o Chromium debe estar disponible.');
  const port = 63020 + Math.floor(Math.random() * 80);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const desktopContext = await contextFor(browser, { width: 1366, height: 768 }, 'propcontrol-b133-desktop-center-1366');
    try {
      const page = await desktopContext.newPage();
      await load(page, url);
      await verifyDesktopModal(page, '22-hotfix-modal-centrado-desktop-1366x768.png');
    } finally {
      await desktopContext.close();
    }

    const laptopContext = await contextFor(browser, { width: 1280, height: 720 }, 'propcontrol-b133-desktop-center-1280');
    try {
      const page = await laptopContext.newPage();
      await load(page, url);
      await verifyDesktopModal(page, '23-hotfix-modal-centrado-laptop-1280x720.png');
    } finally {
      await laptopContext.close();
    }

    const mobileContext = await contextFor(browser, { width: 390, height: 844 }, 'propcontrol-b133-desktop-center-mobile');
    try {
      const page = await mobileContext.newPage();
      await load(page, url);
      await verifyMobileRegression(page);
    } finally {
      await mobileContext.close();
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
