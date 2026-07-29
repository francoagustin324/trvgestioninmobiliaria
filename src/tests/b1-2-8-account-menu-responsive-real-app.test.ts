import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright';
import { initialData, type CrmData } from '../models.js';

const viewports = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 430, height: 932 },
  { width: 720, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
] as const;

const captureViewports = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 720, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
] as const;

const captureScenarios = [
  'cerrado',
  'abierto',
  'nombre-largo',
  'inmobiliaria-larga',
  'estado-nube',
  'parte-inferior',
  'despues-scroll',
] as const;

const mobileUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const userId = 'b128-owner';
const storageKey = `trv-crm-basico:user:${userId}`;
const sessionKey = 'propcontrol-cloud-session-v1';
const syncKey = `${storageKey}:sync`;
const backupKey = `${storageKey}:backups`;
const fixtureMarker = 'propcontrol-b128-fixture-ready';

interface WindowWithB128 extends Window {
  __b128CloudMessages?: string[];
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: 'trvgestioninmobiliaria',
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Validación B1.2.8',
  };
  crm.teamMembers = [{
    id: 1,
    userId,
    name: 'Franco Solís',
    email: 'franco.solis@example.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-07-01T12:00:00.000Z',
  }];
  crm.settings = {
    ...crm.settings,
    profileName: 'trvgestioninmobiliaria',
    profileEmail: 'franco.solis@example.test',
    agencyName: 'TRV Gestión Inmobiliaria',
    defaultZone: 'Datos actuales',
  };
  crm.clients = Array.from({ length: 12 }, (_, index) => ({
    ...structuredClone(initialData.clients[index % initialData.clients.length]!),
    id: index + 1,
    name: index === 0 ? 'Lucía Martín' : `Lead de prueba ${index + 1}`,
    phone: `351555${String(index + 1).padStart(4, '0')}`,
    assignedToId: 1,
    createdById: 1,
  }));
  crm.properties = [];
  crm.activityLog = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  return crm;
}

function backupFixture(): CrmData {
  const crm = fixture();
  crm.settings.defaultZone = 'Backup restaurado';
  return crm;
}

function syncState(dirty = false) {
  return {
    dirty,
    localUpdatedAt: '2026-07-29T16:40:00-03:00',
    lastCloudSavedAt: '2026-07-29T14:12:00-03:00',
    lastCloudVersion: '2026-07-29T14:12:00-03:00',
  };
}

function chromePath(): string | undefined {
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(existsSync);
}

async function waitServer(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Servidor B1.2.8 no disponible: ${String(lastError ?? 'sin respuesta')}`);
}

async function startServer(port: number): Promise<ChildProcess> {
  const handle = spawn(process.execPath, ['dist/server.js'], {
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
  await waitServer(`http://127.0.0.1:${port}`);
  return handle;
}

async function stopServer(handle: ChildProcess): Promise<void> {
  if (handle.exitCode !== null) return;
  handle.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (handle.exitCode === null) handle.kill('SIGKILL');
      resolve();
    }, 2_000);
    handle.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function contextFor(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<BrowserContext> {
  const mobile = viewport.width <= 430;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: viewport.width <= 720,
    isMobile: mobile,
    userAgent: mobile ? mobileUa : undefined,
    locale: 'es-AR',
    colorScheme: 'dark',
  });
  await context.addInitScript(({ data, backup, user, keys, initialSync, marker }) => {
    if (localStorage.getItem(marker)) return;
    localStorage.setItem(marker, '1');
    localStorage.setItem(keys.session, JSON.stringify({
      accessToken: 'b128-access-token',
      refreshToken: 'b128-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      userId: user,
      email: 'franco.solis@example.test',
    }));
    localStorage.setItem(keys.storage, JSON.stringify(data));
    localStorage.setItem(keys.sync, JSON.stringify(initialSync));
    localStorage.setItem(keys.backup, JSON.stringify([{
      createdAt: '2026-07-29T13:00:00-03:00',
      reason: 'Copia anterior de prueba',
      crm: backup,
    }]));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, {
    data: fixture(),
    backup: backupFixture(),
    user: userId,
    keys: {
      session: sessionKey,
      storage: storageKey,
      sync: syncKey,
      backup: backupKey,
    },
    initialSync: syncState(false),
    marker: fixtureMarker,
  });
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-account-toggle]', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
}

function trigger(page: Page): Locator {
  return page.locator('[data-account-toggle]');
}

function panel(page: Page): Locator {
  return page.locator('.mvp-account-panel');
}

async function openMenu(page: Page): Promise<void> {
  if (await trigger(page).getAttribute('aria-expanded') !== 'true') {
    await trigger(page).click();
  }
  await panel(page).waitFor({ state: 'visible' });
  assert.equal(await trigger(page).getAttribute('aria-expanded'), 'true');
}

async function closeWithTrigger(page: Page): Promise<void> {
  if (await trigger(page).getAttribute('aria-expanded') === 'true') {
    await trigger(page).click();
  }
  await panel(page).waitFor({ state: 'hidden' });
  assert.equal(await trigger(page).getAttribute('aria-expanded'), 'false');
}

async function replaceStoredData(
  page: Page,
  changes: {
    profileName?: string;
    organizationName?: string;
    agencyName?: string;
    dirty?: boolean;
  },
): Promise<void> {
  await page.evaluate(({ key, stateKey, update }) => {
    const data = JSON.parse(localStorage.getItem(key) || '{}') as CrmData;
    if (update.profileName !== undefined) data.settings.profileName = update.profileName;
    if (update.organizationName !== undefined) data.organization.name = update.organizationName;
    if (update.agencyName !== undefined) data.settings.agencyName = update.agencyName;
    localStorage.setItem(key, JSON.stringify(data));
    if (update.dirty !== undefined) {
      const current = JSON.parse(localStorage.getItem(stateKey) || '{}') as Record<string, unknown>;
      localStorage.setItem(stateKey, JSON.stringify({ ...current, dirty: update.dirty }));
    }
  }, { key: storageKey, stateKey: syncKey, update: changes });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-account-toggle]', { state: 'visible', timeout: 20_000 });
}

async function resetStoredData(page: Page): Promise<void> {
  await page.evaluate(({ key, stateKey, data, state }) => {
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(stateKey, JSON.stringify(state));
  }, {
    key: storageKey,
    stateKey: syncKey,
    data: fixture(),
    state: syncState(false),
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-account-toggle]', { state: 'visible', timeout: 20_000 });
}

async function scrollWorkspace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.mvp-content');
    if (content && getComputedStyle(content).overflowY !== 'visible') content.scrollTo({ top: 500 });
    window.scrollTo({ top: 500 });
  });
  await page.waitForTimeout(60);
}

async function validatePanelGeometry(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  await openMenu(page);
  const geometry = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('.mvp-account-menu');
    const currentPanel = document.querySelector<HTMLElement>('.mvp-account-panel');
    const currentTrigger = document.querySelector<HTMLElement>('[data-account-toggle]');
    const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');
    const topbar = document.querySelector<HTMLElement>('.app-topbar');
    const actions = [...document.querySelectorAll<HTMLElement>('.mvp-account-action')];
    const identityName = document.querySelector<HTMLElement>('#propcontrol-account-name');
    const identityDetail = document.querySelector<HTMLElement>('.mvp-account-identity-copy small');
    if (!menu || !currentPanel || !currentTrigger || !topbar || !identityName || !identityDetail) {
      throw new Error('Estructura del menú de cuenta incompleta.');
    }
    const panelRect = currentPanel.getBoundingClientRect();
    const triggerRect = currentTrigger.getBoundingClientRect();
    const navRect = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
    const lineCount = (element: HTMLElement) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    };
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      panel: {
        left: panelRect.left,
        right: panelRect.right,
        top: panelRect.top,
        bottom: panelRect.bottom,
        width: panelRect.width,
        scrollWidth: currentPanel.scrollWidth,
        clientWidth: currentPanel.clientWidth,
      },
      triggerBottom: triggerRect.bottom,
      navTop: navRect?.top ?? null,
      menuZ: Number.parseInt(getComputedStyle(menu).zIndex, 10) || 0,
      navZ: nav ? Number.parseInt(getComputedStyle(nav).zIndex, 10) || 0 : 0,
      actionMetrics: actions.map((action) => {
        const rect = action.getBoundingClientRect();
        return {
          label: action.querySelector('strong')?.textContent?.trim() || '',
          height: rect.height,
          textAlign: getComputedStyle(action).textAlign,
          left: rect.left,
          right: rect.right,
        };
      }),
      identityName: identityName.textContent?.trim() || '',
      identityDetail: identityDetail.textContent?.trim() || '',
      identityNameLines: lineCount(identityName),
      identityDetailLines: lineCount(identityDetail),
      nameWordBreak: getComputedStyle(identityName).wordBreak,
      detailWordBreak: getComputedStyle(identityDetail).wordBreak,
      bodyLocked: document.body.classList.contains('account-menu-open'),
      topbarVisible: topbar.getBoundingClientRect().bottom > 0,
    };
  });

  assert.ok(geometry.panel.left >= 11.5, `Panel sin margen izquierdo: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.panel.right <= geometry.viewportWidth - 11.5, `Panel sin margen derecho: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.panel.top >= geometry.triggerBottom + 7, `Separación insuficiente: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.panel.bottom <= geometry.viewportHeight + 0.5, `Panel fuera del alto visible: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.panel.scrollWidth <= geometry.panel.clientWidth + 1, `Overflow horizontal interno: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.documentWidth <= geometry.viewportWidth + 1, `Scroll horizontal del documento: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.bodyWidth <= geometry.viewportWidth + 1, `Scroll horizontal del body: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.topbarVisible, true);
  assert.equal(geometry.bodyLocked, viewport.width <= 520);
  if (viewport.width === 320) assert.ok(geometry.panel.width >= 295, `Panel todavía angosto: ${JSON.stringify(geometry.panel)}`);
  if (viewport.width === 360) {
    assert.ok(geometry.panel.left >= 11.5);
    assert.ok(geometry.panel.right <= 348.5);
  }
  if (viewport.width > 520) assert.ok(geometry.panel.width >= 299 && geometry.panel.width <= 341);

  assert.equal(geometry.identityName, 'Franco Solís');
  assert.equal(geometry.identityDetail, 'TRV Gestión Inmobiliaria · Dueño');
  assert.ok(geometry.identityNameLines <= 2);
  assert.ok(geometry.identityDetailLines <= 2);
  assert.notEqual(geometry.nameWordBreak, 'break-all');
  assert.notEqual(geometry.detailWordBreak, 'break-all');

  const labels = geometry.actionMetrics.map((item) => item.label);
  assert.deepEqual(labels, ['Sincronizar ahora', 'Recuperar copia', 'Configuración', 'Cerrar sesión']);
  assert.equal(new Set(labels).size, 4);
  for (const action of geometry.actionMetrics) {
    assert.ok(action.height >= 47.5, `Acción menor a 48px: ${JSON.stringify(action)}`);
    assert.equal(action.textAlign, 'left');
    assert.ok(action.left >= geometry.panel.left);
    assert.ok(action.right <= geometry.panel.right + 0.5);
  }

  assert.equal(await page.locator('[data-account-sync]').getAttribute('aria-label'), 'Sincronizar de forma segura');
  assert.equal(await page.locator('[data-account-restore]').getAttribute('aria-label'), 'Recuperar copia anterior');
  assert.equal(await page.locator('.mvp-account-sync strong').innerText(), 'Nube al día');
  assert.match(await page.locator('.mvp-account-sync small').innerText(), /^Guardada/);

  if (geometry.navTop !== null) {
    assert.ok(geometry.menuZ > geometry.navZ, `Panel detrás de la navegación: ${JSON.stringify(geometry)}`);
    await panel(page).evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const logoutVisible = await page.locator('[data-account-logout]').evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');
      const navRect = nav?.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        bottom: rect.bottom,
        navTop: navRect?.top ?? innerHeight,
        hit: hit === button || button.contains(hit),
      };
    });
    assert.ok(logoutVisible.bottom <= logoutVisible.navTop + 0.5, `Cerrar sesión bajo la navegación: ${JSON.stringify(logoutVisible)}`);
    assert.equal(logoutVisible.hit, true, `Cerrar sesión no pulsable: ${JSON.stringify(logoutVisible)}`);
  }
}

async function validateOpenCloseAndFocus(page: Page): Promise<void> {
  const accountTrigger = trigger(page);
  assert.equal(await accountTrigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await accountTrigger.getAttribute('aria-controls'), 'propcontrol-account-panel');

  await openMenu(page);
  assert.equal(
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.hasAttribute('data-account-sync')),
    true,
  );

  await closeWithTrigger(page);
  assert.equal(
    await page.evaluate(() => document.activeElement === document.querySelector('[data-account-toggle]')),
    true,
  );

  await openMenu(page);
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'hidden' });
  assert.equal(await accountTrigger.getAttribute('aria-expanded'), 'false');
  assert.equal(
    await page.evaluate(() => document.activeElement === document.querySelector('[data-account-toggle]')),
    true,
  );

  await openMenu(page);
  await page.evaluate(() => (document.querySelector('.app-brand') as HTMLElement | null)?.click());
  await panel(page).waitFor({ state: 'hidden' });
  assert.equal(await accountTrigger.getAttribute('aria-expanded'), 'false');
  assert.equal(
    await page.evaluate(() => document.activeElement === document.querySelector('[data-account-toggle]')),
    true,
  );

  await openMenu(page);
  await page.locator('[data-account-backdrop]').click({ position: { x: 2, y: 2 } });
  await panel(page).waitFor({ state: 'hidden' });
  assert.equal(await accountTrigger.getAttribute('aria-expanded'), 'false');
  assert.equal(
    await page.evaluate(() => document.activeElement === document.querySelector('[data-account-toggle]')),
    true,
  );

  for (let index = 0; index < 10; index += 1) {
    await accountTrigger.click();
    assert.equal(await accountTrigger.getAttribute('aria-expanded'), 'true');
    await accountTrigger.click();
    assert.equal(await accountTrigger.getAttribute('aria-expanded'), 'false');
  }
  assert.equal(await page.locator('.mvp-account-menu').count(), 1);
  assert.equal(await page.locator('.mvp-account-panel').count(), 1);
  assert.equal(await page.evaluate(() => document.body.classList.contains('account-menu-open')), false);
}

async function recordCloudMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as WindowWithB128;
    target.__b128CloudMessages = [];
    document.addEventListener('propcontrol-cloud-status', (event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      if (detail?.message) target.__b128CloudMessages?.push(detail.message);
    });
  });
}

async function validateRerenderSettingsAndSync(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('trv-render')));
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.mvp-account-menu').count(), 1);
  assert.equal(await page.locator('.mvp-account-panel').count(), 1);

  await openMenu(page);
  await page.locator('[data-account-settings]').click();
  await page.locator('#configuracion.active').waitFor({ state: 'visible' });
  assert.equal(await trigger(page).getAttribute('aria-expanded'), 'false');
  assert.equal(await panel(page).isHidden(), true);
  assert.equal(await page.evaluate(() => document.body.classList.contains('account-menu-open')), false);

  await recordCloudMessages(page);
  await openMenu(page);
  await page.locator('[data-account-sync]').click();
  await page.waitForTimeout(150);
  const starts = await page.evaluate(() => {
    const messages = (window as unknown as WindowWithB128).__b128CloudMessages ?? [];
    return messages.filter((message) => message === 'Comprobando datos locales y de la nube…').length;
  });
  assert.equal(starts, 1, 'Sincronizar ahora ejecutó el handler más de una vez.');
  assert.equal(await page.evaluate(() => document.body.classList.contains('account-menu-open')), false);
}

async function validateRestoreHandler(page: Page): Promise<void> {
  await recordCloudMessages(page);
  await page.evaluate(() => { window.confirm = () => true; });
  await openMenu(page);
  await page.locator('[data-account-restore]').click();
  await page.waitForTimeout(100);
  const restored = await page.evaluate(({ key, backups }) => {
    const data = JSON.parse(localStorage.getItem(key) || '{}') as CrmData;
    const remaining = JSON.parse(localStorage.getItem(backups) || '[]') as unknown[];
    const messages = (window as unknown as WindowWithB128).__b128CloudMessages ?? [];
    return {
      zone: data.settings.defaultZone,
      remaining: remaining.length,
      successCount: messages.filter((message) => message.startsWith('Copia anterior recuperada.')).length,
    };
  }, { key: storageKey, backups: backupKey });
  assert.deepEqual(restored, {
    zone: 'Backup restaurado',
    remaining: 0,
    successCount: 1,
  });
  assert.equal(await page.evaluate(() => document.body.classList.contains('account-menu-open')), false);
}

async function validateLogout(page: Page, url: string): Promise<void> {
  await openMenu(page);
  await page.locator('[data-account-logout]').click();
  await page.waitForURL(`${url}/login`, { timeout: 10_000 });
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), sessionKey), null);
}

async function validateResizeCycle(page: Page): Promise<void> {
  await openMenu(page);
  assert.equal(await page.evaluate(() => document.body.classList.contains('account-menu-open')), true);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => document.body.classList.contains('account-menu-open')), false);
  assert.equal(await trigger(page).getAttribute('aria-expanded'), 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => document.body.classList.contains('account-menu-open')), true);
  await closeWithTrigger(page);
  assert.equal(await page.evaluate(() => document.body.classList.contains('account-menu-open')), false);
}

async function capture(
  page: Page,
  directory: string,
  viewport: { width: number; height: number },
  scenario: string,
): Promise<void> {
  await page.screenshot({
    path: join(directory, `${viewport.width}x${viewport.height}-${scenario}.png`),
    fullPage: false,
    scale: 'css',
  });
}

function validateScreenshots(directory: string, expectedCount: number): void {
  const files = readdirSync(directory).filter((name) => name.endsWith('.png'));
  assert.equal(files.length, expectedCount);
  for (const name of files) {
    const path = join(directory, name);
    const buffer = readFileSync(path);
    assert.ok(statSync(path).size > 2_000, `${name} parece vacío.`);
    assert.deepEqual(
      [...buffer.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${name} no tiene firma PNG válida.`,
    );
    const match = name.match(/^(\d+)x(\d+)-/);
    assert.ok(match, `No se pudo leer el viewport desde ${name}.`);
    assert.equal(buffer.readUInt32BE(16), Number(match[1]), `Ancho PNG incorrecto en ${name}.`);
    assert.equal(buffer.readUInt32BE(20), Number(match[2]), `Alto PNG incorrecto en ${name}.`);
  }
}

test('B1.2.8 valida geometría, identidad y estado en la matriz responsive real', { timeout: 300_000 }, async () => {
  const executablePath = chromePath();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.8.');
  const port = 47000 + Math.floor(Math.random() * 1000);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const viewport of viewports) {
      const context = await contextFor(browser, viewport);
      try {
        const page = await context.newPage();
        await load(page, url);
        await validatePanelGeometry(page, viewport);
        await closeWithTrigger(page);
        await scrollWorkspace(page);
        await openMenu(page);
        const afterScroll = await panel(page).boundingBox();
        assert.ok(
          afterScroll
            && afterScroll.x >= 11.5
            && afterScroll.x + afterScroll.width <= viewport.width - 11.5,
          `Panel fuera del viewport después del scroll: ${JSON.stringify(afterScroll)}`,
        );
        await closeWithTrigger(page);
        assert.equal(await page.evaluate(() => document.body.classList.contains('account-menu-open')), false);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
});

test('B1.2.8 valida apertura, cierre, foco, navegación y handlers existentes', { timeout: 180_000 }, async () => {
  const executablePath = chromePath();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.8.');
  const port = 48000 + Math.floor(Math.random() * 1000);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const behaviorContext = await contextFor(browser, { width: 390, height: 844 });
    try {
      const page = await behaviorContext.newPage();
      await load(page, url);
      await validateOpenCloseAndFocus(page);
      await validateRerenderSettingsAndSync(page);
    } finally {
      await behaviorContext.close();
    }

    const restoreContext = await contextFor(browser, { width: 390, height: 844 });
    try {
      const page = await restoreContext.newPage();
      await load(page, url);
      await validateRestoreHandler(page);
    } finally {
      await restoreContext.close();
    }

    const resizeContext = await contextFor(browser, { width: 390, height: 844 });
    try {
      const page = await resizeContext.newPage();
      await load(page, url);
      await validateResizeCycle(page);
    } finally {
      await resizeContext.close();
    }

    const logoutContext = await contextFor(browser, { width: 390, height: 844 });
    try {
      const page = await logoutContext.newPage();
      await load(page, url);
      await validateLogout(page, url);
    } finally {
      await logoutContext.close();
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
});

test('B1.2.8 conserva nombres largos, estados pendientes y genera capturas efímeras estructurales', { timeout: 420_000 }, async () => {
  const executablePath = chromePath();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.8.');
  const port = 49000 + Math.floor(Math.random() * 1000);
  const url = `http://127.0.0.1:${port}`;
  const screenshots = mkdtempSync(join(tmpdir(), 'propcontrol-b128-'));
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  let captured = 0;
  try {
    for (const viewport of captureViewports) {
      const context = await contextFor(browser, viewport);
      try {
        const page = await context.newPage();
        await load(page, url);

        await closeWithTrigger(page);
        await capture(page, screenshots, viewport, 'cerrado');
        captured += 1;

        await openMenu(page);
        await capture(page, screenshots, viewport, 'abierto');
        captured += 1;

        await replaceStoredData(page, {
          profileName: 'Juan Ignacio Rodríguez Martínez de la Fuente',
          organizationName: 'TRV Gestión Inmobiliaria',
          agencyName: 'TRV Gestión Inmobiliaria',
          dirty: false,
        });
        await openMenu(page);
        const longNameMetrics = await page.locator('#propcontrol-account-name').evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return {
            text: element.textContent?.trim(),
            wordBreak: getComputedStyle(element).wordBreak,
            overflow: element.scrollWidth > element.clientWidth + 1,
            lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
          };
        });
        assert.equal(longNameMetrics.text, 'Juan Ignacio Rodríguez Martínez de la Fuente');
        assert.notEqual(longNameMetrics.wordBreak, 'break-all');
        assert.equal(longNameMetrics.overflow, false);
        assert.ok(longNameMetrics.lines <= 2);
        await capture(page, screenshots, viewport, 'nombre-largo');
        captured += 1;

        await replaceStoredData(page, {
          profileName: 'Franco Solís',
          organizationName: 'Inmobiliaria Desarrollo Patrimonial del Centro de Córdoba',
          agencyName: 'Inmobiliaria Desarrollo Patrimonial del Centro de Córdoba',
          dirty: false,
        });
        await openMenu(page);
        const longAgencyMetrics = await page.locator('.mvp-account-identity-copy small').evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return {
            text: element.textContent?.trim(),
            wordBreak: getComputedStyle(element).wordBreak,
            overflow: element.scrollWidth > element.clientWidth + 1,
            lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
          };
        });
        assert.match(longAgencyMetrics.text || '', /Inmobiliaria Desarrollo Patrimonial del Centro de Córdoba · Dueño/);
        assert.notEqual(longAgencyMetrics.wordBreak, 'break-all');
        assert.equal(longAgencyMetrics.overflow, false);
        assert.ok(longAgencyMetrics.lines <= 2);
        await capture(page, screenshots, viewport, 'inmobiliaria-larga');
        captured += 1;

        await resetStoredData(page);
        await openMenu(page);
        assert.equal(await page.locator('.mvp-account-sync strong').innerText(), 'Nube al día');
        await capture(page, screenshots, viewport, 'estado-nube');
        captured += 1;

        await panel(page).evaluate((element) => { element.scrollTop = element.scrollHeight; });
        await capture(page, screenshots, viewport, 'parte-inferior');
        captured += 1;

        await closeWithTrigger(page);
        await scrollWorkspace(page);
        await openMenu(page);
        await capture(page, screenshots, viewport, 'despues-scroll');
        captured += 1;

        await replaceStoredData(page, { dirty: true });
        await openMenu(page);
        assert.equal(await page.locator('.mvp-account-sync strong').innerText(), 'Cambios pendientes');
        assert.match(await page.locator('.mvp-account-sync small').innerText(), /^Actualizados/);
        await closeWithTrigger(page);
        assert.equal(await page.evaluate(() => document.body.classList.contains('account-menu-open')), false);
      } finally {
        await context.close();
      }
    }

    assert.equal(captured, captureViewports.length * captureScenarios.length);
    validateScreenshots(screenshots, 49);
    console.log('# B1.2.8 capturas efímeras validadas automáticamente por firma, dimensiones, tamaño y geometría: 49');
    console.log('# B1.2.8 inspección visual humana de capturas: NO');
  } finally {
    await browser.close();
    await stopServer(server);
    rmSync(screenshots, { recursive: true, force: true });
  }
});
