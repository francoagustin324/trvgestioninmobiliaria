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
import { createServer as createNetServer } from 'node:net';
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
import { initialData, type CrmData, type TeamMember, type TeamRole } from '../models.js';

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
  'nube-al-dia',
  'identidad-extensa',
  'cambios-pendientes',
  'seguridad-recuperacion',
  'cerrar-sesion',
  'despues-scroll',
] as const;

const mobileUserAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const fixtureMarker = 'propcontrol-b128-fixture-ready';
const sessionKey = 'propcontrol-cloud-session-v1';

interface WindowWithB128 extends Window {
  __b128CloudMessages?: string[];
}

interface FixtureIdentity {
  userId: string;
  email: string;
  storageKey: string;
  syncKey: string;
  backupKey: string;
}

function fixtureIdentity(role: TeamRole): FixtureIdentity {
  const slug = role === 'Dueño' ? 'owner' : role === 'Administrador' ? 'admin' : 'agent';
  const userId = `b128-${slug}`;
  const storageKey = `trv-crm-basico:user:${userId}`;
  return {
    userId,
    email: `${slug}@propcontrol.test`,
    storageKey,
    syncKey: `${storageKey}:sync`,
    backupKey: `${storageKey}:backups`,
  };
}

const ownerIdentity = fixtureIdentity('Dueño');

function memberName(role: TeamRole): string {
  if (role === 'Administrador') return 'Ana Administradora';
  if (role === 'Corredor') return 'Carla Corredora';
  return 'Franco Solís';
}

function crmFixture(role: TeamRole = 'Dueño'): CrmData {
  const identity = fixtureIdentity(role);
  const crm = structuredClone(initialData);
  const testedMemberId = role === 'Dueño' ? 1 : 2;
  const testedMember: TeamMember = {
    id: testedMemberId,
    userId: identity.userId,
    name: memberName(role),
    email: identity.email,
    phone: '5493515110069',
    role,
    status: 'Activo',
    createdAt: '2026-07-01T12:00:00.000Z',
  };
  const organizationOwner: TeamMember = {
    id: 1,
    userId: `b128-required-owner-${identity.userId}`,
    name: 'Dueño de la organización',
    email: `owner-${identity.email}`,
    phone: '5493515110000',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-07-01T11:00:00.000Z',
  };

  crm.organization = {
    id: `trv-${identity.userId}`,
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Validación B1.2.8',
  };
  crm.teamMembers = role === 'Dueño'
    ? [testedMember]
    : [organizationOwner, testedMember];
  crm.settings = {
    ...crm.settings,
    profileName: role === 'Dueño' ? 'trvgestioninmobiliaria' : memberName(role),
    profileEmail: identity.email,
    agencyName: 'TRV Gestión Inmobiliaria',
    defaultZone: 'Datos actuales',
  };
  crm.clients = Array.from({ length: 12 }, (_, index) => ({
    ...structuredClone(initialData.clients[index % initialData.clients.length]!),
    id: index + 1,
    name: index === 0 ? 'Lucía Martín' : `Lead de prueba ${index + 1}`,
    phone: `351555${String(index + 1).padStart(4, '0')}`,
    assignedToId: testedMemberId,
    createdById: testedMemberId,
  }));
  crm.properties = [];
  crm.activityLog = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  return crm;
}

function backupFixture(role: TeamRole = 'Dueño'): CrmData {
  const crm = crmFixture(role);
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

function pendingSyncState() {
  return {
    ...savedSyncState(),
    dirty: true,
    localUpdatedAt: '2026-07-29T16:40:00-03:00',
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

async function reserveFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('No se pudo resolver un puerto local libre para B1.2.8.'));
        return;
      }
      const port = address.port;
      probe.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForServer(url: string, server: ChildProcess, stderr: () => string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Servidor B1.2.8 terminó antes de health (code=${server.exitCode}): ${stderr().trim() || 'sin stderr'}`);
    }
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Servidor B1.2.8 no disponible: ${String(lastError ?? 'sin respuesta')} · proceso=${server.exitCode === null ? 'activo' : `exit ${server.exitCode}`} · stderr=${stderr().trim() || 'vacío'}`);
}

async function startServer(): Promise<{ server: ChildProcess; url: string }> {
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
  let stderrBuffer = '';
  server.stderr?.setEncoding('utf8');
  server.stderr?.on('data', (chunk: string) => { stderrBuffer += chunk; });
  try {
    await waitForServer(url, server, () => stderrBuffer);
    return { server, url };
  } catch (error) {
    if (server.exitCode === null) server.kill('SIGTERM');
    throw error;
  }
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
  role: TeamRole = 'Dueño',
): Promise<BrowserContext> {
  const mobile = viewport.width <= 430;
  const identity = fixtureIdentity(role);
  const activeMemberId = role === 'Dueño' ? 1 : 2;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: viewport.width <= 720,
    isMobile: mobile,
    userAgent: mobile ? mobileUserAgent : undefined,
    locale: 'es-AR',
    colorScheme: 'dark',
  });
  await context.addInitScript(({ data, backup, user, email, memberId, keys, sync, marker }) => {
    if (localStorage.getItem(marker)) return;
    localStorage.setItem(marker, '1');
    localStorage.setItem(keys.session, JSON.stringify({
      accessToken: `b128-access-${user}`,
      refreshToken: `b128-refresh-${user}`,
      expiresAt: Date.now() + 3_600_000,
      userId: user,
      email,
    }));
    localStorage.setItem(keys.storage, JSON.stringify(data));
    localStorage.setItem(keys.sync, JSON.stringify(sync));
    localStorage.setItem(keys.backup, JSON.stringify([{
      createdAt: '2026-07-29T13:00:00-03:00',
      reason: 'Copia anterior de prueba',
      crm: backup,
    }]));
    localStorage.setItem('propcontrol-active-team-member-v1', String(memberId));
  }, {
    data: crmFixture(role),
    backup: backupFixture(role),
    user: identity.userId,
    email: identity.email,
    memberId: activeMemberId,
    keys: {
      session: sessionKey,
      storage: identity.storageKey,
      sync: identity.syncKey,
      backup: identity.backupKey,
    },
    sync: savedSyncState(),
    marker: fixtureMarker,
  });
  return context;
}

async function loadApplication(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-account-toggle]', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
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

async function setSyncState(page: Page, value: Record<string, unknown>, role: TeamRole = 'Dueño'): Promise<void> {
  const identity = fixtureIdentity(role);
  await page.evaluate(({ key, stateValue }) => {
    localStorage.setItem(key, JSON.stringify(stateValue));
    document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
      detail: { message: '', kind: 'working' },
    }));
  }, { key: identity.syncKey, stateValue: value });
  await page.waitForTimeout(80);
}

async function replaceIdentityData(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const data = JSON.parse(localStorage.getItem(key) || '{}') as CrmData;
    data.settings.profileName = 'Juan Ignacio Rodríguez Martínez de la Fuente';
    data.organization.name = 'Inmobiliaria Desarrollo Patrimonial del Centro de Córdoba';
    data.settings.agencyName = 'Inmobiliaria Desarrollo Patrimonial del Centro de Córdoba';
    data.teamMembers[0]!.name = 'Juan Ignacio Rodríguez Martínez de la Fuente';
    localStorage.setItem(key, JSON.stringify(data));
  }, ownerIdentity.storageKey);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-account-toggle]', { state: 'visible', timeout: 20_000 });
}

async function restoreOwnerFixture(page: Page): Promise<void> {
  await page.evaluate(({ dataKey, stateKey, data, sync }) => {
    localStorage.setItem(dataKey, JSON.stringify(data));
    localStorage.setItem(stateKey, JSON.stringify(sync));
  }, {
    dataKey: ownerIdentity.storageKey,
    stateKey: ownerIdentity.syncKey,
    data: crmFixture('Dueño'),
    sync: savedSyncState(),
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

async function menuActionLabels(page: Page): Promise<string[]> {
  const labels = await accountPanel(page).locator('.mvp-account-action strong').allTextContents();
  return labels.map((label) => label.trim());
}

async function assertSavedMenu(page: Page): Promise<void> {
  await openAccountMenu(page);
  assert.equal(await page.locator('.mvp-account-sync strong').innerText(), 'Nube al día');
  assert.equal(await accountPanel(page).locator('[data-account-sync]').count(), 0);
  assert.equal(await accountPanel(page).locator('[data-account-restore]').count(), 0);
  assert.deepEqual(await menuActionLabels(page), ['Configuración', 'Cerrar sesión']);
}

async function validatePanelGeometry(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  await assertSavedMenu(page);
  const geometry = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('.mvp-account-menu');
    const panel = document.querySelector<HTMLElement>('.mvp-account-panel');
    const trigger = document.querySelector<HTMLElement>('[data-account-toggle]');
    const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');
    const name = document.querySelector<HTMLElement>('#propcontrol-account-name');
    const detail = document.querySelector<HTMLElement>('.mvp-account-identity-copy small');
    if (!menu || !panel || !trigger || !name || !detail) throw new Error('Estructura de cuenta incompleta.');
    const panelRect = panel.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const navVisible = nav && getComputedStyle(nav).display !== 'none';
    const navRect = navVisible ? nav.getBoundingClientRect() : null;
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
      bodyMenuOpen: document.body.classList.contains('account-menu-open'),
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      nameWordBreak: getComputedStyle(name).wordBreak,
      detailWordBreak: getComputedStyle(detail).wordBreak,
    };
  });

  assert.ok(geometry.panel.left >= 11.5, `Panel sin margen izquierdo: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.panel.right <= geometry.viewportWidth - 11.5, `Panel sin margen derecho: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.panel.top >= geometry.triggerBottom + 7, `Panel demasiado cerca del avatar: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.panel.bottom <= geometry.viewportHeight + 0.5, `Panel fuera del alto visible: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.panel.scrollWidth <= geometry.panel.clientWidth + 1, `Overflow horizontal interno: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.documentWidth <= geometry.viewportWidth + 1, `Scroll horizontal del documento: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.bodyWidth <= geometry.viewportWidth + 1, `Scroll horizontal del body: ${JSON.stringify(geometry)}`);
  assert.notEqual(geometry.nameWordBreak, 'break-all');
  assert.notEqual(geometry.detailWordBreak, 'break-all');
  assert.equal(geometry.bodyMenuOpen, true);
  assert.equal(geometry.bodyOverflowY === 'hidden', viewport.width <= 520);
  if (viewport.width === 320) assert.ok(geometry.panel.width >= 295);
  if (viewport.width > 520) assert.ok(geometry.panel.width >= 299 && geometry.panel.width <= 341);

  const actions = await accountPanel(page).locator('.mvp-account-action').evaluateAll((buttons) => {
    return buttons.map((button) => ({
      height: button.getBoundingClientRect().height,
      textAlign: getComputedStyle(button).textAlign,
    }));
  });
  for (const action of actions) {
    assert.ok(action.height >= 47.5);
    assert.equal(action.textAlign, 'left');
  }

  if (geometry.navTop !== null) {
    assert.ok(geometry.menuZ > geometry.navZ);
    const logout = await page.locator('[data-account-logout]').evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const navRect = document.querySelector<HTMLElement>('.mobile-bottom-nav')?.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        bottom: rect.bottom,
        navTop: navRect?.top ?? innerHeight,
        hit: hit === button || button.contains(hit),
      };
    });
    assert.ok(logout.bottom <= logout.navTop + 0.5);
    assert.equal(logout.hit, true);
  }
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
    assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const match = name.match(/^(\d+)x(\d+)-/);
    assert.ok(match, `No se pudo leer el viewport desde ${name}.`);
    assert.equal(buffer.readUInt32BE(16), Number(match[1]));
    assert.equal(buffer.readUInt32BE(20), Number(match[2]));
  }
}

test(
  'B1.2.8 muestra Nube al día sin acción manual y conserva geometría responsive',
  { timeout: 300_000 },
  async () => {
    const executablePath = chromeExecutable();
    assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.8.');
    const { server, url } = await startServer();
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
          await assertSavedMenu(page);
          await closeAccountMenuWithTrigger(page);
          assert.equal(await page.evaluate(() => document.body.classList.contains('account-menu-open')), false);
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
  'B1.2.8 muestra sincronización solo cuando corresponde y conserva cierres, foco y Configuración',
  { timeout: 180_000 },
  async () => {
    const executablePath = chromeExecutable();
    assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.8.');
    const { server, url } = await startServer();
    const browser = await chromium.launch({ executablePath, headless: true });
    const context = await createContext(browser, { width: 390, height: 844 });
    try {
      const page = await context.newPage();
      await loadApplication(page, url);

      await assertSavedMenu(page);
      assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-account-settings')), true);
      await closeAccountMenuWithTrigger(page);
      assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('[data-account-toggle]')), true);

      await openAccountMenu(page);
      await page.keyboard.press('Escape');
      await accountPanel(page).waitFor({ state: 'hidden' });
      assert.equal(await accountTrigger(page).getAttribute('aria-expanded'), 'false');

      await openAccountMenu(page);
      await page.locator('[data-account-backdrop]').click({ position: { x: 2, y: 120 } });
      await accountPanel(page).waitFor({ state: 'hidden' });

      await openAccountMenu(page);
      await page.evaluate(() => document.querySelector<HTMLElement>('.app-brand')?.click());
      await accountPanel(page).waitFor({ state: 'hidden' });

      await setSyncState(page, pendingSyncState());
      await openAccountMenu(page);
      assert.equal(await page.locator('.mvp-account-sync strong').innerText(), 'Cambios pendientes');
      assert.equal(await accountPanel(page).locator('[data-account-sync]').count(), 1);
      assert.equal(await accountPanel(page).locator('[data-account-restore]').count(), 0);
      assert.deepEqual(await menuActionLabels(page), ['Sincronizar ahora', 'Configuración', 'Cerrar sesión']);

      await recordCloudStatusMessages(page);
      await page.locator('[data-account-sync]').click();
      await page.waitForTimeout(150);
      const syncStarts = await page.evaluate(() => {
        return ((window as unknown as WindowWithB128).__b128CloudMessages ?? [])
          .filter((message) => message === 'Comprobando datos locales y de la nube…').length;
      });
      assert.equal(syncStarts, 1);

      await setSyncState(page, { ...pendingSyncState(), lastError: 'No se pudo conectar con la nube.' });
      await openAccountMenu(page);
      assert.equal(await page.locator('.mvp-account-sync strong').innerText(), 'Error de sincronización');
      assert.equal(await accountPanel(page).locator('[data-account-sync]').count(), 1);
      await closeAccountMenuWithTrigger(page);

      await setSyncState(page, {
        ...pendingSyncState(),
        lastError: 'Hay datos distintos y cambios más nuevos en la nube.',
      });
      await openAccountMenu(page);
      assert.equal(await accountPanel(page).locator('[data-account-resolve]').count(), 1);
      assert.equal(await accountPanel(page).locator('[data-account-sync]').count(), 0);
      await page.locator('[data-account-settings]').click();
      await page.locator('#configuracion.active').waitFor({ state: 'visible' });
      assert.equal(await accountTrigger(page).getAttribute('aria-expanded'), 'false');
      assert.equal(await page.evaluate(() => document.body.classList.contains('account-menu-open')), false);
    } finally {
      await context.close();
      await browser.close();
      await stopServer(server);
    }
  },
);

test(
  'B1.2.8 mueve Recuperar copia a Seguridad y recuperación y aplica permisos existentes',
  { timeout: 180_000 },
  async () => {
    const executablePath = chromeExecutable();
    assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.8.');
    const { server, url } = await startServer();
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const ownerContext = await createContext(browser, { width: 390, height: 844 }, 'Dueño');
      try {
        const page = await ownerContext.newPage();
        await loadApplication(page, url);
        await assertSavedMenu(page);
        assert.equal(await accountPanel(page).locator('[data-account-restore]').count(), 0);
        assert.equal(await page.locator('[data-settings-security-recovery]').count(), 1);
        assert.equal(await page.locator('#configuracion [data-account-restore]').count(), 1);
        assert.match(await page.locator('#propcontrol-recovery-guidance').innerText(), /solo si faltan datos o soporte lo recomienda/i);
        assert.match(await page.locator('#propcontrol-recovery-guidance').innerText(), /Nunca se ejecuta automáticamente/i);

        const before = await page.evaluate(({ dataKey, backupsKey }) => ({
          zone: (JSON.parse(localStorage.getItem(dataKey) || '{}') as CrmData).settings.defaultZone,
          backups: (JSON.parse(localStorage.getItem(backupsKey) || '[]') as unknown[]).length,
        }), { dataKey: ownerIdentity.storageKey, backupsKey: ownerIdentity.backupKey });
        assert.deepEqual(before, { zone: 'Datos actuales', backups: 1 });

        await page.locator('[data-account-settings]').click();
        await page.locator('#configuracion.active').waitFor({ state: 'visible' });
        await page.evaluate(() => { window.confirm = () => false; });
        await page.locator('#configuracion [data-account-restore]').click();
        const cancelledZone = await page.evaluate((key) => {
          return (JSON.parse(localStorage.getItem(key) || '{}') as CrmData).settings.defaultZone;
        }, ownerIdentity.storageKey);
        assert.equal(cancelledZone, 'Datos actuales');

        await recordCloudStatusMessages(page);
        await page.evaluate(() => { window.confirm = () => true; });
        await page.locator('#configuracion [data-account-restore]').click();
        await page.waitForTimeout(120);
        const restored = await page.evaluate(({ dataKey, backupsKey }) => ({
          zone: (JSON.parse(localStorage.getItem(dataKey) || '{}') as CrmData).settings.defaultZone,
          backups: (JSON.parse(localStorage.getItem(backupsKey) || '[]') as unknown[]).length,
          successCount: ((window as unknown as WindowWithB128).__b128CloudMessages ?? [])
            .filter((message) => message.startsWith('Copia anterior recuperada.')).length,
        }), { dataKey: ownerIdentity.storageKey, backupsKey: ownerIdentity.backupKey });
        assert.deepEqual(restored, { zone: 'Backup restaurado', backups: 0, successCount: 1 });
      } finally {
        await ownerContext.close();
      }

      const adminContext = await createContext(browser, { width: 390, height: 844 }, 'Administrador');
      try {
        const page = await adminContext.newPage();
        await loadApplication(page, url);
        assert.equal(await page.locator('[data-settings-security-recovery]').count(), 1);
        assert.equal(await page.locator('#configuracion [data-account-restore]').count(), 1);
        assert.equal(await accountPanel(page).locator('[data-account-restore]').count(), 0);
      } finally {
        await adminContext.close();
      }

      const corredorIdentity = fixtureIdentity('Corredor');
      const corredorContext = await createContext(browser, { width: 390, height: 844 }, 'Corredor');
      try {
        const page = await corredorContext.newPage();
        await loadApplication(page, url);
        assert.equal(await page.locator('[data-settings-security-recovery]').count(), 0);
        assert.equal(await page.locator('[data-account-restore]').count(), 0);
        assert.equal(await page.locator('[data-account-settings]').count(), 0);
        const unauthorized = await page.evaluate(({ dataKey, backupsKey }) => ({
          recoverControl: Boolean(document.querySelector('[data-account-restore]')),
          zone: (JSON.parse(localStorage.getItem(dataKey) || '{}') as CrmData).settings.defaultZone,
          backups: (JSON.parse(localStorage.getItem(backupsKey) || '[]') as unknown[]).length,
        }), { dataKey: corredorIdentity.storageKey, backupsKey: corredorIdentity.backupKey });
        assert.deepEqual(unauthorized, {
          recoverControl: false,
          zone: 'Datos actuales',
          backups: 1,
        });
      } finally {
        await corredorContext.close();
      }
    } finally {
      await browser.close();
      await stopServer(server);
    }
  },
);

test(
  'B1.2.8 conserva identidad extensa y genera la matriz estructural de capturas',
  { timeout: 420_000 },
  async () => {
    const executablePath = chromeExecutable();
    assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.8.');
    const { server, url } = await startServer();
    const screenshots = mkdtempSync(join(tmpdir(), 'propcontrol-b128-product-'));
    const browser = await chromium.launch({ executablePath, headless: true });
    let captured = 0;
    try {
      for (const viewport of captureViewports) {
        const context = await createContext(browser, viewport);
        try {
          const page = await context.newPage();
          await loadApplication(page, url);

          await captureViewport(page, screenshots, viewport, 'cerrado');
          captured += 1;

          await assertSavedMenu(page);
          await captureViewport(page, screenshots, viewport, 'nube-al-dia');
          captured += 1;
          await closeAccountMenuWithTrigger(page);

          await replaceIdentityData(page);
          await assertSavedMenu(page);
          const identityMetrics = await page.evaluate(() => {
            const name = document.querySelector<HTMLElement>('#propcontrol-account-name');
            const detail = document.querySelector<HTMLElement>('.mvp-account-identity-copy small');
            if (!name || !detail) throw new Error('Identidad no disponible.');
            return {
              name: name.getAttribute('aria-label'),
              detail: detail.getAttribute('aria-label'),
              overflow: name.scrollWidth > name.clientWidth + 1 || detail.scrollWidth > detail.clientWidth + 1,
              documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
            };
          });
          assert.equal(identityMetrics.name, 'Juan Ignacio Rodríguez Martínez de la Fuente');
          assert.match(identityMetrics.detail || '', /Inmobiliaria Desarrollo Patrimonial del Centro de Córdoba · Dueño/);
          assert.equal(identityMetrics.overflow, false);
          assert.equal(identityMetrics.documentOverflow, false);
          await captureViewport(page, screenshots, viewport, 'identidad-extensa');
          captured += 1;
          await closeAccountMenuWithTrigger(page);

          await restoreOwnerFixture(page);
          await setSyncState(page, pendingSyncState());
          await openAccountMenu(page);
          assert.equal(await accountPanel(page).locator('[data-account-sync]').count(), 1);
          await captureViewport(page, screenshots, viewport, 'cambios-pendientes');
          captured += 1;
          await page.locator('[data-account-settings]').click();
          await page.locator('#configuracion.active').waitFor({ state: 'visible' });
          await captureViewport(page, screenshots, viewport, 'seguridad-recuperacion');
          captured += 1;

          await setSyncState(page, savedSyncState());
          await openAccountMenu(page);
          await captureViewport(page, screenshots, viewport, 'cerrar-sesion');
          captured += 1;
          await closeAccountMenuWithTrigger(page);

          await scrollWorkspace(page);
          await assertSavedMenu(page);
          await captureViewport(page, screenshots, viewport, 'despues-scroll');
          captured += 1;
          await closeAccountMenuWithTrigger(page);
        } finally {
          await context.close();
        }
      }

      assert.equal(captured, captureViewports.length * captureScenarios.length);
      validateScreenshots(screenshots, 49);
      console.log('# B1.2.8 capturas estructurales validadas por firma, dimensiones, tamaño y geometría: 49');
    } finally {
      await browser.close();
      await stopServer(server);
      rmSync(screenshots, { recursive: true, force: true });
    }
  },
);

test(
  'B1.2.8 conserva cierre de sesión y limpia la sesión autenticada',
  { timeout: 60_000 },
  async () => {
    const executablePath = chromeExecutable();
    assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.8.');
    const { server, url } = await startServer();
    const browser = await chromium.launch({ executablePath, headless: true });
    const context = await createContext(browser, { width: 390, height: 844 });
    try {
      const page = await context.newPage();
      await loadApplication(page, url);
      await assertSavedMenu(page);
      await page.locator('[data-account-logout]').click();
      await page.waitForURL(`${url}/login`, { timeout: 10_000 });
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), sessionKey), null);
    } finally {
      await context.close();
      await browser.close();
      await stopServer(server);
    }
  },
);
