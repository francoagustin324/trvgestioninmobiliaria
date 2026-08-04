import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { initialData, type Client, type CrmData, type TeamMember } from '../models.js';

const artifactDir = 'artifacts/b1-3-3-desktop-centering';
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
    id: 51,
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
  crm.activityLog = [];
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

async function prepareContext(context: BrowserContext, marker: string): Promise<void> {
  await context.route('**/api/cloud-config', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Nube de prueba no disponible.' }) });
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
    localStorage.setItem(keys.sync, JSON.stringify({ dirty: false, localUpdatedAt: '2026-08-04T12:00:00-03:00' }));
    localStorage.setItem(keys.activeMember, String(currentMemberId));
  }, {
    data: fixture(),
    keys: { session: sessionKey, storage: storageKey, sync: syncKey, activeMember: activeMemberKey },
    currentUserId: userId,
    currentEmail: email,
    currentMemberId: memberId,
    initMarker: marker,
  });
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 25_000 });
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

test('hotfix desktop define centrado exacto sin alterar la regla móvil', () => {
  const css = readFileSync('src/b1-3-3-mobile-postproduction-hotfix.css', 'utf8');
  assert.match(css, /@media \(min-width: 721px\)/);
  assert.match(css, /left:\s*50%/);
  assert.match(css, /transform:\s*translateX\(-50%\)/);
  assert.match(css, /width:\s*min\(920px, calc\(100vw - 64px\)\)/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /\[data-cancel-client-edit\][\s\S]*display:\s*none !important/);
});

test('modal Nuevo lead queda centrado en 1366x768 y mobile conserva el hotfix Motorola', async () => {
  mkdirSync(artifactDir, { recursive: true });
  const port = 4376;
  const server = await startServer(port);
  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable() });
  const url = `http://127.0.0.1:${port}`;

  try {
    const desktop = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-AR', timezoneId: 'America/Argentina/Cordoba', colorScheme: 'dark' });
    await prepareContext(desktop, 'b133-desktop-centering');
    const desktopPage = await desktop.newPage();
    await load(desktopPage, url);
    await desktopPage.locator('[data-toggle="client-form"]').click();
    const desktopForm = desktopPage.locator('#mvp-lead-form.b131-lead-form:not(.collapsed)');
    await desktopForm.waitFor({ state: 'visible' });
    const desktopGeometry = await desktopForm.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const fields = element.querySelector<HTMLElement>('.b131-lead-form-fields');
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        center: rect.left + rect.width / 2,
        viewportCenter: innerWidth / 2,
        overflowX: fields ? getComputedStyle(fields).overflowX : '',
        overflowY: fields ? getComputedStyle(fields).overflowY : '',
      };
    });
    assert.ok(Math.abs(desktopGeometry.center - desktopGeometry.viewportCenter) <= 1, JSON.stringify(desktopGeometry));
    assert.ok(desktopGeometry.left >= 31, JSON.stringify(desktopGeometry));
    assert.ok(desktopGeometry.right <= 1335, JSON.stringify(desktopGeometry));
    assert.ok(desktopGeometry.width <= 921, JSON.stringify(desktopGeometry));
    assert.equal(desktopGeometry.overflowX, 'hidden');
    assert.equal(desktopGeometry.overflowY, 'auto');
    await assertNoHorizontalScroll(desktopPage);
    await desktopPage.screenshot({ path: `${artifactDir}/22-hotfix-modal-centrado-1366x768.png`, fullPage: true });
    await desktop.close();

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
      userAgent: motorolaUserAgent,
      locale: 'es-AR',
      timezoneId: 'America/Argentina/Cordoba',
      colorScheme: 'dark',
    });
    await prepareContext(mobile, 'b133-mobile-regression');
    const mobilePage = await mobile.newPage();
    await load(mobilePage, url);
    await mobilePage.locator('[data-toggle="client-form"]').click();
    const mobileForm = mobilePage.locator('#mvp-lead-form.b131-lead-form:not(.collapsed)');
    await mobileForm.waitFor({ state: 'visible' });
    assert.equal(await mobileForm.getByRole('heading', { name: 'Nuevo lead', exact: true }).isVisible(), true);
    assert.equal(await mobileForm.locator('.mvp-form-heading [data-cancel-client-edit]').isVisible(), false);
    assert.equal(await mobilePage.getByText('Cerrar', { exact: true }).isVisible().catch(() => false), false);
    const toggleVisual = await mobilePage.locator('#crm [data-toggle="client-form"]').evaluate((element) => ({
      content: getComputedStyle(element, '::after').content.replaceAll('"', ''),
      fontSize: getComputedStyle(element).fontSize,
    }));
    assert.equal(toggleVisual.content, '×');
    assert.equal(toggleVisual.fontSize, '0px');
    const cancel = mobileForm.getByRole('button', { name: 'Cancelar', exact: true });
    const save = mobileForm.getByRole('button', { name: 'Guardar lead', exact: true });
    const cancelBox = await cancel.boundingBox();
    const saveBox = await save.boundingBox();
    const navBox = await mobilePage.locator('.mobile-bottom-nav').boundingBox();
    assert.ok(cancelBox && saveBox && navBox);
    assert.ok(cancelBox.y + cancelBox.height <= navBox.y + 1);
    assert.ok(saveBox.y + saveBox.height <= navBox.y + 1);
    await assertNoHorizontalScroll(mobilePage);
    await mobilePage.screenshot({ path: `${artifactDir}/23-hotfix-mobile-sin-regresion-390x844.png`, fullPage: true });
    await mobile.close();
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
