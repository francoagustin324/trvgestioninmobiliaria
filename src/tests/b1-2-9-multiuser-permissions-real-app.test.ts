import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import { initialData, type CrmData, type TeamMember, type TeamRole } from '../models.js';

const sessionKey = 'propcontrol-cloud-session-v1';
const activeMemberKey = 'propcontrol-active-team-member-v1';
const fixtureMarker = 'propcontrol-b129-fixture-ready';
const mobileUserAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

interface FixtureIdentity {
  userId: string;
  email: string;
  memberId: number;
  storageKey: string;
  syncKey: string;
  backupKey: string;
}

interface B129Window extends Window {
  __b129RestrictedLeaks?: string[];
  __b129Restore?: HTMLButtonElement;
  __b129TeamForm?: HTMLFormElement;
  __b129RoleSelect?: HTMLSelectElement;
  __b129StatusButton?: HTMLButtonElement;
  __b129TeamRequests?: number;
}

function fixtureIdentity(role: TeamRole): FixtureIdentity {
  const slug = role === 'Dueño' ? 'owner' : role === 'Administrador' ? 'admin' : 'agent';
  const memberId = role === 'Dueño' ? 1 : role === 'Administrador' ? 2 : 3;
  const userId = `b129-${slug}`;
  const storageKey = `trv-crm-basico:user:${userId}`;
  return {
    userId,
    email: `${slug}@propcontrol.test`,
    memberId,
    storageKey,
    syncKey: `${storageKey}:sync`,
    backupKey: `${storageKey}:backups`,
  };
}

function member(role: TeamRole): TeamMember {
  const identity = fixtureIdentity(role);
  return {
    id: identity.memberId,
    userId: identity.userId,
    name: role === 'Dueño' ? 'Franco Solís' : role === 'Administrador' ? 'Ana Administradora' : 'Carla Corredora',
    email: identity.email,
    phone: `549351511000${identity.memberId}`,
    role,
    status: 'Activo',
    createdAt: `2026-07-0${identity.memberId}T12:00:00.000Z`,
  };
}

function crmFixture(role: TeamRole): CrmData {
  const crm = structuredClone(initialData);
  const identity = fixtureIdentity(role);
  crm.organization = {
    id: 'b129-organization',
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Validación B1.2.9',
  };
  crm.teamMembers = [member('Dueño'), member('Administrador'), member('Corredor')];
  crm.settings = {
    ...crm.settings,
    profileName: role === 'Dueño' ? 'Franco Solís' : role === 'Administrador' ? 'Ana Administradora' : 'Carla Corredora',
    profileEmail: identity.email,
    agencyName: 'TRV Gestión Inmobiliaria',
    defaultZone: 'Datos actuales B1.2.9',
  };
  crm.clients = crm.clients.map((item) => ({ ...item, assignedToId: identity.memberId, createdById: identity.memberId }));
  crm.properties = crm.properties.map((item) => ({ ...item, assignedToId: identity.memberId, createdById: identity.memberId }));
  crm.reminders = crm.reminders.map((item) => ({ ...item, assignedToId: identity.memberId, createdById: identity.memberId }));
  crm.contacts = crm.contacts.map((item) => ({ ...item, assignedToId: identity.memberId, createdById: identity.memberId }));
  crm.fichas = crm.fichas.map((item) => ({ ...item, assignedToId: identity.memberId, createdById: identity.memberId }));
  crm.conversations = crm.conversations.map((item) => ({ ...item, assignedToId: identity.memberId, createdById: identity.memberId }));
  return crm;
}

function backupFixture(role: TeamRole): CrmData {
  const crm = crmFixture(role);
  crm.settings.defaultZone = 'Backup restaurado B1.2.9';
  return crm;
}

function savedSyncState() {
  return {
    dirty: false,
    localUpdatedAt: '2026-07-29T20:20:00-03:00',
    lastCloudSavedAt: '2026-07-29T20:20:00-03:00',
    lastCloudVersion: '2026-07-29T20:20:00-03:00',
  };
}

function sessionValue(role: TeamRole) {
  const identity = fixtureIdentity(role);
  return {
    accessToken: `b129-access-${identity.userId}`,
    refreshToken: `b129-refresh-${identity.userId}`,
    expiresAt: Date.now() + 3_600_000,
    userId: identity.userId,
    email: identity.email,
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
  throw new Error(`Servidor B1.2.9 no disponible: ${String(lastError ?? 'sin respuesta')}`);
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
  role: TeamRole,
): Promise<BrowserContext> {
  const identity = fixtureIdentity(role);
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

  await context.addInitScript(({ data, backup, session, memberId, keys, sync, marker, trackRestricted }) => {
    if (!localStorage.getItem(marker)) {
      localStorage.setItem(marker, '1');
      localStorage.setItem(keys.session, JSON.stringify(session));
      localStorage.setItem(keys.storage, JSON.stringify(data));
      localStorage.setItem(keys.sync, JSON.stringify(sync));
      localStorage.setItem(keys.backup, JSON.stringify([{
        createdAt: '2026-07-29T20:00:00-03:00',
        reason: 'Copia anterior B1.2.9',
        crm: backup,
      }]));
      localStorage.setItem(keys.activeMember, String(memberId));
    }

    if (!trackRestricted) return;
    const targetWindow = window as unknown as B129Window;
    targetWindow.__b129RestrictedLeaks = [];
    const selector = '[data-settings-security-recovery], [data-account-restore], #mvp-user-form, [data-toggle-user-form]';
    const inspect = (node: Node) => {
      if (!(node instanceof Element)) return;
      const matched = node.matches(selector) ? node : node.querySelector(selector);
      if (matched) targetWindow.__b129RestrictedLeaks?.push(matched.outerHTML.slice(0, 180));
    };
    const install = () => {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => mutation.addedNodes.forEach(inspect));
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) install();
    else document.addEventListener('DOMContentLoaded', install, { once: true });
  }, {
    data: crmFixture(role),
    backup: backupFixture(role),
    session: sessionValue(role),
    memberId: identity.memberId,
    keys: {
      session: sessionKey,
      storage: identity.storageKey,
      sync: identity.syncKey,
      backup: identity.backupKey,
      activeMember: activeMemberKey,
    },
    sync: savedSyncState(),
    marker: fixtureMarker,
    trackRestricted: role === 'Corredor',
  });
  return context;
}

async function loadApplication(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-account-toggle]', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(80);
}

async function navigateModules(page: Page): Promise<void> {
  for (const module of ['crm', 'whatsapp', 'agenda', 'propiedades'] as const) {
    const button = page.locator(`[data-module="${module}"]:visible`).first();
    assert.equal(await button.count(), 1, `Falta navegación visible a ${module}.`);
    await button.click();
    await page.locator(`#${module}.active`).waitFor({ state: 'visible' });
    assert.ok((await page.locator(`#${module}`).innerText()).trim().length > 0, `${module} no renderizó contenido.`);
  }

  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    mobileNavVisible: getComputedStyle(document.querySelector<HTMLElement>('.mobile-bottom-nav')!).display !== 'none',
    sidebarVisible: getComputedStyle(document.querySelector<HTMLElement>('.mvp-sidebar')!).display !== 'none',
  }));
  assert.ok(geometry.documentWidth <= geometry.viewport + 1, `Scroll horizontal del documento: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.bodyWidth <= geometry.viewport + 1, `Scroll horizontal del body: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.viewport <= 430 ? geometry.mobileNavVisible : geometry.sidebarVisible, true);
}

async function assertRecoveryAccess(page: Page, role: TeamRole): Promise<void> {
  await page.locator('[data-account-toggle]').click();
  await page.locator('.mvp-account-panel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.mvp-account-panel [data-account-restore]').count(), 0);
  const allowed = role !== 'Corredor';
  assert.equal(await page.locator('[data-account-settings]').count(), allowed ? 1 : 0);
  assert.equal(await page.locator('[data-settings-security-recovery]').count(), allowed ? 1 : 0);
  assert.equal(await page.locator('#configuracion [data-account-restore]').count(), allowed ? 1 : 0);
  await page.locator('[data-account-toggle]').click();
}

async function restoreAndAssert(page: Page, role: Exclude<TeamRole, 'Corredor'>): Promise<void> {
  const identity = fixtureIdentity(role);
  const before = await page.evaluate(({ dataKey, backupKey }) => ({
    zone: (JSON.parse(localStorage.getItem(dataKey) || '{}') as CrmData).settings.defaultZone,
    backups: (JSON.parse(localStorage.getItem(backupKey) || '[]') as unknown[]).length,
  }), { dataKey: identity.storageKey, backupKey: identity.backupKey });
  assert.deepEqual(before, { zone: 'Datos actuales B1.2.9', backups: 1 });

  const settingsNavigation = page.locator('[data-module="configuracion"]:visible').first();
  assert.equal(await settingsNavigation.count(), 1);
  await settingsNavigation.click();
  await page.locator('#configuracion.active').waitFor({ state: 'visible' });
  await page.evaluate(() => { window.confirm = () => true; });
  await page.locator('#configuracion [data-account-restore]').click();
  await page.waitForTimeout(120);
  const after = await page.evaluate(({ dataKey, backupKey }) => ({
    zone: (JSON.parse(localStorage.getItem(dataKey) || '{}') as CrmData).settings.defaultZone,
    backups: (JSON.parse(localStorage.getItem(backupKey) || '[]') as unknown[]).length,
  }), { dataKey: identity.storageKey, backupKey: identity.backupKey });
  assert.deepEqual(after, { zone: 'Backup restaurado B1.2.9', backups: 0 });
}

async function assertCorredorDenied(page: Page, url: string): Promise<void> {
  const identity = fixtureIdentity('Corredor');
  assert.equal(await page.locator('[data-settings-security-recovery]').count(), 0);
  assert.equal(await page.locator('[data-account-restore]').count(), 0);
  assert.equal(await page.locator('[data-account-settings]').count(), 0);
  assert.equal(await page.locator('[data-module="configuracion"]:visible').count(), 0);
  assert.equal(await page.locator('[data-module="equipo"]:visible').count(), 0);
  assert.equal((await page.locator('#configuracion').innerHTML()).trim(), '');
  assert.equal((await page.locator('#equipo').innerHTML()).trim(), '');

  const direct = await page.evaluate(async ({ dataKey, backupKey }) => {
    const store = await import('/dist/store.js');
    store.state.activeModule = 'configuracion';
    document.dispatchEvent(new CustomEvent('trv-render'));
    const restored = store.restoreLatestLocalBackup();
    document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
      detail: { message: '', kind: 'success' },
    }));
    document.dispatchEvent(new CustomEvent('trv-render'));
    return {
      restored,
      activeModule: store.state.activeModule,
      zone: (JSON.parse(localStorage.getItem(dataKey) || '{}') as CrmData).settings.defaultZone,
      backups: (JSON.parse(localStorage.getItem(backupKey) || '[]') as unknown[]).length,
    };
  }, { dataKey: identity.storageKey, backupKey: identity.backupKey });
  assert.deepEqual(direct, {
    restored: false,
    activeModule: 'crm',
    zone: 'Datos actuales B1.2.9',
    backups: 1,
  });
  assert.equal(await page.locator('[data-settings-security-recovery], [data-account-restore]').count(), 0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  assert.equal(await page.locator('[data-settings-security-recovery], [data-account-restore], [data-account-settings]').count(), 0);

  const leaks = await page.evaluate(() => (window as unknown as B129Window).__b129RestrictedLeaks ?? []);
  assert.deepEqual(leaks, [], `Controles restringidos aparecieron temporalmente: ${JSON.stringify(leaks)}`);

  await page.locator('[data-account-toggle]').click();
  await page.locator('[data-account-logout]').click();
  await page.waitForURL(`${url}/login`, { timeout: 10_000 });
  await page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), {
    key: sessionKey,
    session: sessionValue('Corredor'),
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  assert.equal(await page.locator('[data-settings-security-recovery], [data-account-restore], [data-account-settings]').count(), 0);
}

test(
  'B1.2.9 valida Dueño, Administrador y Corredor en navegación móvil y escritorio',
  { timeout: 360_000 },
  async () => {
    const executablePath = chromeExecutable();
    assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.9.');
    const port = 49600 + Math.floor(Math.random() * 300);
    const url = `http://127.0.0.1:${port}`;
    const server = await startServer(port);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      for (const role of ['Dueño', 'Administrador', 'Corredor'] as const) {
        for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
          const context = await createContext(browser, viewport, role);
          try {
            const page = await context.newPage();
            await loadApplication(page, url);
            await assertRecoveryAccess(page, role);
            await navigateModules(page);

            if (role === 'Corredor') {
              if (viewport.width === 390) await assertCorredorDenied(page, url);
              else {
                assert.equal(await page.locator('[data-settings-security-recovery], [data-account-restore], [data-account-settings]').count(), 0);
                assert.equal((await page.locator('#configuracion').innerHTML()).trim(), '');
                assert.equal((await page.locator('#equipo').innerHTML()).trim(), '');
              }
            } else {
              assert.equal(await page.locator('[data-toggle-user-form]').count(), 2);
              const inviteRoles = await page.locator('#mvp-user-form [name="role"] option').allTextContents();
              assert.deepEqual(inviteRoles.map((value) => value.trim()), role === 'Dueño' ? ['Corredor', 'Administrador'] : ['Corredor']);
              const agentRole = page.locator('[data-user-role="3"]');
              assert.equal(await agentRole.isDisabled(), role === 'Administrador');
              assert.equal(await page.locator('[data-user-status="3"]').count(), 1);
              if (viewport.width === 390) await restoreAndAssert(page, role);
            }
          } finally {
            await context.close();
          }
        }
      }
    } finally {
      await browser.close();
      await stopServer(server);
    }
  },
);

test(
  'B1.2.9 bloquea referencias DOM obsoletas y llamadas indirectas después de cambiar a Corredor',
  { timeout: 120_000 },
  async () => {
    const executablePath = chromeExecutable();
    assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.9.');
    const port = 49900 + Math.floor(Math.random() * 300);
    const url = `http://127.0.0.1:${port}`;
    const server = await startServer(port);
    const browser = await chromium.launch({ executablePath, headless: true });
    const context = await createContext(browser, { width: 390, height: 844 }, 'Dueño');
    try {
      const page = await context.newPage();
      await loadApplication(page, url);
      const ownerIdentity = fixtureIdentity('Dueño');

      const result = await page.evaluate(async ({ dataKey, backupKey }) => {
        const targetWindow = window as unknown as B129Window;
        targetWindow.__b129Restore = document.querySelector<HTMLButtonElement>('#configuracion [data-account-restore]') ?? undefined;
        targetWindow.__b129TeamForm = document.querySelector<HTMLFormElement>('#mvp-user-form') ?? undefined;
        targetWindow.__b129RoleSelect = document.querySelector<HTMLSelectElement>('[data-user-role="3"]') ?? undefined;
        targetWindow.__b129StatusButton = document.querySelector<HTMLButtonElement>('[data-user-status="3"]') ?? undefined;
        if (!targetWindow.__b129Restore || !targetWindow.__b129TeamForm || !targetWindow.__b129RoleSelect || !targetWindow.__b129StatusButton) {
          throw new Error('No se pudieron conservar las referencias administrativas de Dueño.');
        }

        const name = targetWindow.__b129TeamForm.querySelector<HTMLInputElement>('[name="name"]');
        const email = targetWindow.__b129TeamForm.querySelector<HTMLInputElement>('[name="email"]');
        if (name) name.value = 'Usuario no autorizado';
        if (email) email.value = 'sin-permiso@propcontrol.test';
        targetWindow.__b129TeamRequests = 0;
        const nativeFetch = window.fetch.bind(window);
        window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
          const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (requestUrl.includes('/api/team/')) targetWindow.__b129TeamRequests = (targetWindow.__b129TeamRequests ?? 0) + 1;
          return nativeFetch(input, init);
        }) as typeof window.fetch;
        window.confirm = () => true;

        const store = await import('/dist/store.js');
        store.setActiveMemberId(3);
        document.dispatchEvent(new CustomEvent('trv-render'));
        await new Promise((resolve) => setTimeout(resolve, 60));

        targetWindow.__b129Restore.click();
        targetWindow.__b129TeamForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        targetWindow.__b129RoleSelect.value = 'Administrador';
        targetWindow.__b129RoleSelect.dispatchEvent(new Event('change', { bubbles: true }));
        targetWindow.__b129StatusButton.click();
        const directRestore = store.restoreLatestLocalBackup();
        document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
          detail: { message: '', kind: 'working' },
        }));
        document.dispatchEvent(new CustomEvent('trv-render'));
        await new Promise((resolve) => setTimeout(resolve, 100));

        return {
          directRestore,
          activeMemberId: store.state.activeMemberId,
          activeModule: store.state.activeModule,
          teamRequests: targetWindow.__b129TeamRequests,
          zone: (JSON.parse(localStorage.getItem(dataKey) || '{}') as CrmData).settings.defaultZone,
          backups: (JSON.parse(localStorage.getItem(backupKey) || '[]') as unknown[]).length,
          recoveryControls: document.querySelectorAll('[data-settings-security-recovery], [data-account-restore]').length,
          teamControls: document.querySelectorAll('#mvp-user-form, [data-toggle-user-form]').length,
          settingsHtml: document.querySelector('#configuracion')?.innerHTML.trim() || '',
          teamHtml: document.querySelector('#equipo')?.innerHTML.trim() || '',
        };
      }, { dataKey: ownerIdentity.storageKey, backupKey: ownerIdentity.backupKey });

      assert.deepEqual(result, {
        directRestore: false,
        activeMemberId: 3,
        activeModule: 'crm',
        teamRequests: 0,
        zone: 'Datos actuales B1.2.9',
        backups: 1,
        recoveryControls: 0,
        teamControls: 0,
        settingsHtml: '',
        teamHtml: '',
      });
    } finally {
      await context.close();
      await browser.close();
      await stopServer(server);
    }
  },
);
