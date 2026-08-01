import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData } from '../models.js';

const sessionKey = 'propcontrol-cloud-session-v1';
const activeMemberKey = 'propcontrol-active-team-member-v1';
const userId = 'b131-owner';
const storageKey = `trv-crm-basico:user:${userId}`;
const syncKey = `${storageKey}:sync`;
const mobileUserAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: 'b131-org', name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'B1.3.1' };
  crm.teamMembers = [{
    id: 1,
    userId,
    name: 'Franco Solís',
    email: 'owner-b131@propcontrol.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-01T12:00:00.000Z',
  }];
  crm.clients = [];
  crm.activityLog = [];
  crm.reminders = [];
  crm.conversations = [];
  crm.settings = {
    ...crm.settings,
    profileName: 'Franco Solís',
    profileEmail: 'owner-b131@propcontrol.test',
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
  throw new Error(`Servidor B1.3.1 no disponible: ${String(lastError ?? 'sin respuesta')}`);
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
    server.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function contextFor(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    userAgent: mobileUserAgent,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
  });
  await context.addInitScript(({ crm, session, keys }) => {
    localStorage.setItem(keys.session, JSON.stringify(session));
    localStorage.setItem(keys.storage, JSON.stringify(crm));
    localStorage.setItem(keys.sync, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-08-01T15:30:00-03:00',
      lastCloudSavedAt: '2026-08-01T15:30:00-03:00',
      lastCloudVersion: '2026-08-01T15:30:00-03:00',
    }));
    localStorage.setItem(keys.activeMember, '1');
  }, {
    crm: fixture(),
    session: {
      accessToken: `access-${userId}`,
      refreshToken: `refresh-${userId}`,
      expiresAt: Date.now() + 3_600_000,
      userId,
      email: 'owner-b131@propcontrol.test',
    },
    keys: { session: sessionKey, storage: storageKey, sync: syncKey, activeMember: activeMemberKey },
  });
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.locator('[data-toggle="client-form"]').click();
  await page.locator('#mvp-lead-form:not(.collapsed)').waitFor({ state: 'visible' });
}

test('B1.3.1 reproduce: Guardar lead debe seguir accesible con teclado móvil simulado', { timeout: 120_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.3.1.');
  const port = 61260 + Math.floor(Math.random() * 120);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser);
  try {
    const page = await context.newPage();
    await load(page, url);
    const form = page.locator('#mvp-lead-form');
    await form.locator('input[name="name"]').fill('PRUEBA B1.3');
    await form.locator('input[name="phone"]').fill('03515110069');
    await form.locator('input[name="email"]').fill('prueba-b13@example.com');
    await form.locator('select[name="temperature"]').selectOption('Tibio');
    await form.locator('input[name="interest"]').fill('Balcones del Chateau, departamento');
    await form.locator('select[name="pipeline"]').selectOption('Nuevo');
    await form.locator('input[name="nextAction"]').fill('Confirmar visita');
    const today = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    await form.locator('input[name="nextFollowUp"]').fill(today);

    await form.locator('select[name="knowsArea"]').focus();
    await page.setViewportSize({ width: 390, height: 430 });
    await page.waitForTimeout(250);

    const geometry = await form.locator('button[type="submit"]').evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const navigation = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        viewportHeight: window.innerHeight,
        navigationTop: navigation?.top ?? window.innerHeight,
      };
    });

    assert.ok(geometry.height >= 44, JSON.stringify(geometry));
    assert.ok(geometry.top >= 0, `Guardar lead quedó por encima del viewport: ${JSON.stringify(geometry)}`);
    assert.ok(
      geometry.bottom <= geometry.navigationTop - 8,
      `Guardar lead no está accesible con el teclado abierto: ${JSON.stringify(geometry)}`,
    );
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
