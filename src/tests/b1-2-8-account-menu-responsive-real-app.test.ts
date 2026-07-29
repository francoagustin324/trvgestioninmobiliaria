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

const mobileUserAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const userId = 'b128-owner';
const storageKey = `trv-crm-basico:user:${userId}`;
const sessionKey = 'propcontrol-cloud-session-v1';
const syncKey = `${storageKey}:sync`;
const backupKey = `${storageKey}:backups`;
const fixtureMarker = 'propcontrol-b128-fixture-ready';

interface WindowWithB128 extends Window {
  __b128CloudMessages?: string[];
}

function crmFixture(): CrmData {
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
  const crm = crmFixture();
  crm.settings.defaultZone = 'Backup restaurado';
  return crm;
}

function savedSyncState() {
  return {
    dirty: false,
    localUpdatedAt: '2026-07-29T16:40:00-03:00',
    lastCloudSavedAt: '2026-07-29T14:12:00-03:00',
    lastCloudVersion: '2026-07-29T14:12:00-03:00',
  };
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

async function createContext(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<BrowserContext> {
  const mobile = viewport.width <= 430;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: viewport.width <= 720,
    isMobile: mobile,
    userAgent: mobile ? mobileUserAgent : undefined,
    locale: 'es-AR',
    colorScheme: 'dark',
  });
  await context.addInitScript(({ data, backup, user, keys, sync, marker }) => {
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
    localStorage.setItem(keys.sync, JSON.stringify(sync));
    localStorage.setItem(keys.backup, JSON.stringify([{
      createdAt: '2026-07-29T13:00:00-03:00',
      reason: 'Copia anterior de prueba',
      crm: backup,
    }]));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, {
    data: crmFixture(),
    backup: backupFixture(),
    user: userId,
    keys: {
      session: sessionKey,
      storage: storageKey,
      sync: syncKey,
      backup: backupKey,
    },
    sync: savedSyncState(),
    marker: fixtureMarker,
  });
  return context;
}

async function loadApplication(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-account-toggle]', {
    state: 'visible',
    timeout: 20_000,
  });
  await page.waitForSelector('#crm.active', {
    state: 'visible',
    timeout: 20_000,
  });
}

function accountTrigger(page: Page): Locator {
  return page.locator('[data-account-toggle]');
}

function accountPanel(page: Page): Locator {
  return page.locator('.mvp-account-panel');
}

async function openAccountMenu(page: Page): Promise<void> {
  if (await accountTrigger(page).getAttribute('aria-expanded') !== 'true') {
    await accountTrigger(page).click();
  }
  await accountPanel(page).waitFor({ state: 'visible' });
  assert.equal(await accountTrigger(page).getAttribute('aria-expanded'), 'true');
}

async function closeAccountMenuWithTrigger(page: Page): Promise<void> {
  if (await accountTrigger(page).getAttribute('aria-expanded') === 'true') {
    await accountTrigger(page).click();
  }
  await accountPanel(page).waitFor({ state: 'hidden' });
  assert.equal(await accountTrigger(page).getAttribute('aria-expanded'), 'false');
}

async function replaceIdentityData(
  page: Page,
  changes: {
    profileName: string;
    organizationName: string;
    agencyName: string;
  },
): Promise<void> {
  await page.evaluate(({ key, update }) => {
    const data = JSON.parse(localStorage.getItem(key) || '{}') as CrmData;
    data.settings.profileName = update.profileName;
    data.organization.name = update.organizationName;
    data.settings.agencyName = update.agencyName;
    localStorage.setItem(key, JSON.stringify(data));
  }, { key: storageKey, update: changes });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-account-toggle]', {
    state: 'visible',
    timeout: 20_000,
  });
}

async function restoreSavedFixture(page: Page): Promise<void> {
  await page.evaluate(({ key, stateKey, data, sync }) => {
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(stateKey, JSON.stringify(sync));
  }, {
    key: storageKey,
    stateKey: syncKey,
    data: crmFixture(),
    sync: savedSyncState(),
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-account-toggle]', {
    state: 'visible',
    timeout: 20_000,
  });
}

async function setPendingStateWithoutCloudAttempt(page: Page): Promise<void> {
  await page.evaluate((stateKey) => {
    const current = JSON.parse(localStorage.getItem(stateKey) || '{}') as Record<string, unknown>;
    delete current.lastError;
    localStorage.setItem(stateKey, JSON.stringify({
      ...current,
      dirty: true,
      localUpdatedAt: '2026-07-29T16:40:00-03:00',
    }));
    document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
      detail: { message: '', kind: 'working' },
    }));
  }, syncKey);
  await page.waitForFunction(() => {
    return document.querySelector('.mvp-account-sync strong')?.textContent?.trim() === 'Cambios pendientes';
  });
}

async function scrollWorkspace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.mvp-content');
    if (content && getComputedStyle(content).overflowY !== 'visible') {
      content.scrollTo({ top: 500 });
    }
    window.scrollTo({ top: 500 });
  });
  await page.waitForTimeout(60);
}

async function validatePanelGeometry(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  await openAccountMenu(page);
  const geometry = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('.mvp-account-menu');
    const panel = document.querySelector<HTMLElement>('.mvp-account-panel');
    const trigger = document.querySelector<HTMLElement>('[data-account-toggle]');
    const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');
    const topbar = document.querySelector<HTMLElement>('.app-topbar');
    const actions = [...document.querySelectorAll<HTMLElement>('.mvp-account-action')];
    const name = document.querySelector<HTMLElement>('#propcontrol-account-name');
    const detail = document.querySelector<HTMLElement>('.mvp-account-identity-copy small');
    if (!menu || !panel || !trigger || !topbar || !name || !detail) {
      throw new Error('Estructura del menú de cuenta incompleta.');
    }
    const panelRect = panel.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const navVisible = nav && getComputedStyle(nav).display !== 'none';
    const navRect = navVisible ? nav.getBoundingClientRect() : null;
    const visibleLineCount = (element: HTMLElement) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set(
        [...range.getClientRects()]
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => Math.round(rect.top)),
      ).size;
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
        scrollWidth: panel.scrollWidth,
        clientWidth: panel.clientWidth,
      },
      triggerBottom: triggerRect.bottom,
      navTop: navRect?.top ?? null,
      menuZ: Number.parseInt(getComputedStyle(menu).zIndex, 10) || 0,
      navZ: nav ? Number.parseInt(getComputedStyle(nav).zIndex, 10) || 0 : 0,
      actions: actions.map((action) => {
        const rect = action.getBoundingClientRect();
        return {
          label: action.querySelector('strong')?.textContent?.trim() || '',
          height: rect.height,
          textAlign: getComputedStyle(action).textAlign,
          left: rect.left,
          right: rect.right,
        };
      }),
      identityName: name.textContent?.trim() || '',
      identityDetail: detail.textContent?.trim() || '',
      identityNameLines: visibleLineCount(name),
      identityDetailLines: visibleLineCount(detail),
      nameWordBreak: getComputedStyle(name).wordBreak,
      detailWordBreak: getComputedStyle(detail).wordBreak,
      bodyLocked: document.body.classList.contains('account-menu-open'),
      topbarVisible: topbar.getBoundingClientRect().bottom > 0,
    };
  });

  assert.ok(
    geometry.panel.left >= 11.5,
    `Panel sin margen izquierdo: ${JSON.stringify(geometry)}`,
  );
  assert.ok(
    geometry.panel.right <= geometry.viewportWidth - 11.5,
    `Panel sin margen derecho: ${JSON.stringify(geometry)}`,
  );
  assert.ok(
    geometry.panel.top >= geometry.triggerBottom + 7,
    `Separación insuficiente respecto del avatar: ${JSON.stringify(geometry)}`,
  );
  assert.ok(
    geometry.panel.bottom <= geometry.viewportHeight + 0.5,
    `Panel fuera del alto visible: ${JSON.stringify(geometry)}`,
  );
  assert.ok(
    geometry.panel.scrollWidth <= geometry.panel.clientWidth + 1,
    `Overflow horizontal interno: ${JSON.stringify(geometry)}`,
  );
  assert.ok(
    geometry.documentWidth <= geometry.viewportWidth + 1,
    `Scroll horizontal del documento: ${JSON.stringify(geometry)}`,
  );
  assert.ok(
    geometry.bodyWidth <= geometry.viewportWidth + 1,
    `Scroll horizontal del body: ${JSON.stringify(geometry)}`,
  );
  assert.equal(geometry.topbarVisible, true);
  assert.equal(geometry.bodyLocked, viewport.width <= 520);

  if (viewport.width === 320) {
    assert.ok(
      geometry.panel.width >= 295,
      `Panel todavía angosto en 320 px: ${JSON.stringify(geometry.panel)}`,
    );
  }
  if (viewport.width === 360) {
    assert.ok(geometry.panel.left >= 11.5);
    assert.ok(geometry.panel.right <= 348.5);
  }
  if (viewport.width > 520) {
    assert.ok(geometry.panel.width >= 299 && geometry.panel.width <= 341);
  }

  assert.equal(geometry.identityName, 'Franco Solís');
  assert.equal(geometry.identityDetail, 'TRV Gestión Inmobiliaria · Dueño');
  assert.ok(geometry.identityNameLines <= 2);
  assert.ok(geometry.identityDetailLines <= 2);
  assert.notEqual(geometry.nameWordBreak, 'break-all');
  assert.notEqual(geometry.detailWordBreak, 'break-all');

  const labels = geometry.actions.map((action) => action.label);
  assert.deepEqual(labels, [
    'Sincronizar ahora',
    'Recuperar copia',
    'Configuración',
    'Cerrar sesión',
  ]);
  assert.equal(new Set(labels).size, 4);
  for (const action of geometry.actions) {
    assert.ok(
      action.height >= 47.5,
      `Acción menor a 48 px: ${JSON.stringify(action)}`,
    );
    assert.equal(action.textAlign, 'left');
    assert.ok(action.left >= geometry.panel.left);
    assert.ok(action.right <= geometry.panel.right + 0.5);
  }

  assert.equal(
    await page.locator('[data-account-sync]').getAttribute('aria-label'),
    'Sincronizar de forma segura',
  );
  assert.equal(
    await page.locator('[data-account-restore]').getAttribute('aria-label'),
    'Recuperar copia anterior',
  );
  assert.equal(
    await page.locator('.mvp-account-sync strong').innerText(),
    'Nube al día',
  );
  assert.match(
    await page.locator('.mvp-account-sync small').innerText(),
    /^Guardada/,
  );

  if (geometry.navTop !== null) {
    assert.ok(
      geometry.menuZ > geometry.navZ,
      `Panel detrás de la navegación inferior: ${JSON.stringify(geometry)}`,
    );
    await accountPanel(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const logout = await page.locator('[data-account-logout]').evaluate((button) => {
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
    assert.ok(
      logout.bottom <= logout.navTop + 0.5,
      `Cerrar sesión queda bajo la navegación: ${JSON.stringify(logout)}`,
    );
    assert.equal(
      logout.hit,
      true,
      `Cerrar sesión no es pulsable: ${JSON.stringify(logout)}`,
    );
  }
}

async function validateOpenCloseAndFocus(page: Page): Promise<void> {
  const trigger = accountTrigger(page);
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(
    await trigger.getAttribute('aria-controls'),
    'propcontrol-account-panel',
  );

  await openAccountMenu(page);
  assert.equal(
    await page.evaluate(() => {
      return (document.activeElement as HTMLElement | null)?.hasAttribute('data-account-sync');
    }),
    true,
  );

  await closeAccountMenuWithTrigger(page);
  assert.equal(
    await page.evaluate(() => {
      return document.activeElement === document.querySelector('[data-account-toggle]');
    }),
    true,
  );

  await openAccountMenu(page);
  await page.keyboard.press('Escape');
  await accountPanel(page).waitFor({ state: 'hidden' });
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(
    await page.evaluate(() => {
      return document.activeElement === document.querySelector('[data-account-toggle]');
    }),
    true,
  );

  await openAccountMenu(page);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.app-brand')?.click();
  });
  await accountPanel(page).waitFor({ state: 'hidden' });
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');

  await openAccountMenu(page);
  await page.locator('[data-account-backdrop]').click({
    position: { x: 2, y: 2 },
  });
  await accountPanel(page).waitFor({ state: 'hidden' });
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');

  for (let cycle = 0; cycle < 10; cycle += 1) {
    await trigger.click();
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    await trigger.click();
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  }
  assert.equal(await page.locator('.mvp-account-menu').count(), 1);
  assert.equal(await page.locator('.mvp-account-panel').count(), 1);
  assert.equal(
    await page.evaluate(() => document.body.classList.contains('account-menu-open')),
    false,
  );
}

async function recordCloudStatusMessages(page: Page): Promise<void> {
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
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('trv-render'));
  });
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.mvp-account-menu').count(), 1);
  assert.equal(await page.locator('.mvp-account-panel').count(), 1);

  await openAccountMenu(page);
  await page.locator('[data-account-settings]').click();
  await page.locator('#configuracion.active').waitFor({ state: 'visible' });
  assert.equal(await accountTrigger(page).getAttribute('aria-expanded'), 'false');
  assert.equal(await accountPanel(page).isHidden(), true);
  assert.equal(
    await page.evaluate(() => document.body.classList.contains('account-menu-open')),
    false,
  );

  await recordCloudStatusMessages(page);
  await openAccountMenu(page);
  await page.locator('[data-account-sync]').click();
  await page.waitForTimeout(150);
  const starts = await page.evaluate(() => {
    const messages = (window as unknown as WindowWithB128).__b128CloudMessages ?? [];
    return messages.filter((message) => {
      return message === 'Comprobando datos locales y de la nube…';
    }).length;
  });
  assert.equal(
    starts,
    1,
    'Sincronizar ahora ejecutó el handler existente más de una vez.',
  );
  assert.equal(
    await page.evaluate(() => document.body.classList.contains('account-menu-open')),
    false,
  );
}

async function validateRestoreHandler(page: Page): Promise<void> {
  await recordCloudStatusMessages(page);
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await openAccountMenu(page);
  await page.locator('[data-account-restore]').click();
  await page.waitForTimeout(100);
  const restored = await page.evaluate(({ key, backups }) => {
    const data = JSON.parse(localStorage.getItem(key) || '{}') as CrmData;
    const remaining = JSON.parse(localStorage.getItem(backups) || '[]') as unknown[];
    const messages = (window as unknown as WindowWithB128).__b128CloudMessages ?? [];
    return {
      zone: data.settings.defaultZone,
      remaining: remaining.length,
      successCount: messages.filter((message) => {
        return message.startsWith('Copia anterior recuperada.');
      }).length,
    };
  }, { key: storageKey, backups: backupKey });
  assert.deepEqual(restored, {
    zone: 'Backup restaurado',
    remaining: 0,
    successCount: 1,
  });
  assert.equal(
    await page.evaluate(() => document.body.classList.contains('account-menu-open')),
    false,
  );
}

async function validateLogout(page: Page, url: string): Promise<void> {
  await openAccountMenu(page);
  await page.locator('[data-account-logout]').click();
  await page.waitForURL(`${url}/login`, { timeout: 10_000 });
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), sessionKey),
    null,
  );
}

async function validateResizeCycle(page: Page): Promise<void> {
  await openAccountMenu(page);
  assert.equal(
    await page.evaluate(() => document.body.classList.contains('account-menu-open')),
    true,
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(50);
  assert.equal(
    await page.evaluate(() => document.body.classList.contains('account-menu-open')),
    false,
  );
  assert.equal(await accountTrigger(page).getAttribute('aria-expanded'), 'true');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(50);
  assert.equal(
    await page.evaluate(() => document.body.classList.contains('account-menu-open')),
    true,
  );
  await closeAccountMenuWithTrigger(page);
  assert.equal(
    await page.evaluate(() => document.body.classList.contains('account-menu-open')),
    false,
  );
}

function visibleTextMetrics(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  return {
    text: element.textContent?.trim() || '',
    wordBreak: getComputedStyle(element).wordBreak,
    overflow: element.scrollWidth > element.clientWidth + 1,
    lines: new Set(
      [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => Math.round(rect.top)),
    ).size,
  };
}

async function captureViewport(
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
    assert.equal(
      buffer.readUInt32BE(16),
      Number(match[1]),
      `Ancho PNG incorrecto en ${name}.`,
    );
    assert.equal(
      buffer.readUInt32BE(20),
      Number(match[2]),
      `Alto PNG incorrecto en ${name}.`,
    );
  }
}

test(
  'B1.2.8 valida geometría, identidad y estado en la matriz responsive real',
  { timeout: 300_000 },
  async () => {
    const executablePath = chromeExecutable();
    assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.8.');
    const port = 47000 + Math.floor(Math.random() * 1000);
    const url = `http://127.0.0.1:${port}`;
    const server = await startServer(port);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      for (const viewport of viewports) {
        const context = await createContext(browser, viewport);
        try {
          const page = await context.newPage();
          await loadApplication(page, url);
          await validatePanelGeometry(page, viewport);
          await closeAccountMenuWithTrigger(page);

          await scrollWorkspace(page);
          await openAccountMenu(page);
          const afterScroll = await accountPanel(page).boundingBox();
          assert.ok(
            afterScroll
              && afterScroll.x >= 11.5
              && afterScroll.x + afterScroll.width <= viewport.width - 11.5,
            `Panel fuera del viewport después del scroll: ${JSON.stringify(afterScroll)}`,
          );
          await closeAccountMenuWithTrigger(page);
          assert.equal(
            await page.evaluate(() => document.body.classList.contains('account-menu-open')),
            false,
          );
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
      await stopServer(server);
    }
  },
);

test(
  'B1.2.8 valida apertura, cierre, foco, navegación y handlers existentes',
  { timeout: 180_000 },
  async () => {
    const executablePath = chromeExecutable();
    assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.8.');
    const port = 48000 + Math.floor(Math.random() * 1000);
    const url = `http://127.0.0.1:${port}`;
    const server = await startServer(port);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const behaviorContext = await createContext(browser, { width: 390, height: 844 });
      try {
        const page = await behaviorContext.newPage();
        await loadApplication(page, url);
        await validateOpenCloseAndFocus(page);
        await validateRerenderSettingsAndSync(page);
      } finally {
        await behaviorContext.close();
      }

      const restoreContext = await createContext(browser, { width: 390, height: 844 });
      try {
        const page = await restoreContext.newPage();
        await loadApplication(page, url);
        await validateRestoreHandler(page);
      } finally {
        await restoreContext.close();
      }

      const resizeContext = await createContext(browser, { width: 390, height: 844 });
      try {
        const page = await resizeContext.newPage();
        await loadApplication(page, url);
        await validateResizeCycle(page);
      } finally {
        await resizeContext.close();
      }

      const logoutContext = await createContext(browser, { width: 390, height: 844 });
      try {
        const page = await logoutContext.newPage();
        await loadApplication(page, url);
        await validateLogout(page, url);
      } finally {
        await logoutContext.close();
      }
    } finally {
      await browser.close();
      await stopServer(server);
    }
  },
);

test(
  'B1.2.8 conserva nombres largos, estados pendientes y genera capturas efímeras estructurales',
  { timeout: 420_000 },
  async () => {
    const executablePath = chromeExecutable();
    assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.8.');
    const port = 49000 + Math.floor(Math.random() * 1000);
    const url = `http://127.0.0.1:${port}`;
    const screenshots = mkdtempSync(join(tmpdir(), 'propcontrol-b128-'));
    const server = await startServer(port);
    const browser = await chromium.launch({ executablePath, headless: true });
    let captured = 0;
    try {
      for (const viewport of captureViewports) {
        const context = await createContext(browser, viewport);
        try {
          const page = await context.newPage();
          await loadApplication(page, url);

          await closeAccountMenuWithTrigger(page);
          await captureViewport(page, screenshots, viewport, 'cerrado');
          captured += 1;

          await openAccountMenu(page);
          await captureViewport(page, screenshots, viewport, 'abierto');
          captured += 1;

          await replaceIdentityData(page, {
            profileName: 'Juan Ignacio Rodríguez Martínez de la Fuente',
            organizationName: 'TRV Gestión Inmobiliaria',
            agencyName: 'TRV Gestión Inmobiliaria',
          });
          await openAccountMenu(page);
          const longName = await page
            .locator('#propcontrol-account-name')
            .evaluate(visibleTextMetrics);
          assert.equal(
            longName.text,
            'Juan Ignacio Rodríguez Martínez de la Fuente',
          );
          assert.notEqual(longName.wordBreak, 'break-all');
          assert.equal(longName.overflow, false);
          assert.ok(longName.lines <= 2);
          await captureViewport(page, screenshots, viewport, 'nombre-largo');
          captured += 1;

          await replaceIdentityData(page, {
            profileName: 'Franco Solís',
            organizationName: 'Inmobiliaria Desarrollo Patrimonial del Centro de Córdoba',
            agencyName: 'Inmobiliaria Desarrollo Patrimonial del Centro de Córdoba',
          });
          await openAccountMenu(page);
          const longAgency = await page
            .locator('.mvp-account-identity-copy small')
            .evaluate(visibleTextMetrics);
          assert.match(
            longAgency.text,
            /Inmobiliaria Desarrollo Patrimonial del Centro de Córdoba · Dueño/,
          );
          assert.notEqual(longAgency.wordBreak, 'break-all');
          assert.equal(longAgency.overflow, false);
          assert.ok(longAgency.lines <= 2);
          await captureViewport(page, screenshots, viewport, 'inmobiliaria-larga');
          captured += 1;

          await restoreSavedFixture(page);
          await openAccountMenu(page);
          assert.equal(
            await page.locator('.mvp-account-sync strong').innerText(),
            'Nube al día',
          );
          await captureViewport(page, screenshots, viewport, 'estado-nube');
          captured += 1;

          await accountPanel(page).evaluate((element) => {
            element.scrollTop = element.scrollHeight;
          });
          await captureViewport(page, screenshots, viewport, 'parte-inferior');
          captured += 1;

          await closeAccountMenuWithTrigger(page);
          await scrollWorkspace(page);
          await openAccountMenu(page);
          await captureViewport(page, screenshots, viewport, 'despues-scroll');
          captured += 1;

          await closeAccountMenuWithTrigger(page);
          await setPendingStateWithoutCloudAttempt(page);
          await openAccountMenu(page);
          assert.equal(
            await page.locator('.mvp-account-sync strong').innerText(),
            'Cambios pendientes',
          );
          assert.match(
            await page.locator('.mvp-account-sync small').innerText(),
            /^Actualizados/,
          );
          await closeAccountMenuWithTrigger(page);
          assert.equal(
            await page.evaluate(() => document.body.classList.contains('account-menu-open')),
            false,
          );
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
  },
);
