import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium, webkit, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'text-geometry-owner';
const ORG_ID = 'text-geometry-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const CHROMIUM_WIDTHS = [320, 360, 375, 390, 412, 430, 520] as const;
const WEBKIT_WIDTHS = [375, 390, 430] as const;
const EXPECTED_NAV = ['Leads', 'Chats', 'Agenda', 'Propiedades', 'Equipo'];
const GEOMETRY_EPSILON = 0.01;

function owner(): TeamMember {
  return {
    id: 1,
    userId: USER_ID,
    name: 'Franco Solis',
    email: 'franco@propcontrol.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-10T12:00:00.000Z',
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Text geometry validation' };
  crm.teamMembers = [owner()];
  crm.activityLog = [];
  crm.clients = [{
    id: 1,
    name: 'Lucía Martín',
    phone: '+54 9 351 511-0069',
    email: 'lucia@ejemplo.com',
    interest: 'Dúplex en Docta',
    budget: 'USD 120000',
    currency: 'USD',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    assignedToId: 1,
    createdById: 1,
  }];
  crm.reminders = [];
  crm.conversations = [];
  crm.properties = [];
  crm.contacts = [];
  crm.fichas = [];
  crm.settings = {
    ...crm.settings,
    profileName: owner().name,
    profileEmail: owner().email,
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
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
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor de prueba no disponible.');
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

async function seedContext(context: BrowserContext): Promise<void> {
  const actorKey = `cloud:${USER_ID}`;
  const identityKey = `propcontrol-whatsapp-human-identity-v1:${encodeURIComponent(ORG_ID)}:1:${encodeURIComponent(actorKey)}`;
  await context.addInitScript(({ crm, identityStorageKey, storageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: 'text-geometry-owner',
      email: 'franco@propcontrol.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(crm));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-08-10T18:00:00.000Z',
      lastCloudSavedAt: '2026-08-10T18:00:00.000Z',
      lastCloudVersion: '2026-08-10T18:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
    localStorage.setItem(identityStorageKey, JSON.stringify({
      version: 1,
      organizationId: 'text-geometry-org',
      memberId: 1,
      actorKey: 'cloud:text-geometry-owner',
      humanName: 'Franco Solis',
      confirmedAt: '2026-08-10T18:00:00.000Z',
    }));
  }, { crm: fixture(), identityStorageKey: identityKey, storageKey: STORAGE_KEY });
}

async function chromiumContext(browser: Browser, width: number): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width, height: width <= 360 ? 800 : 844 },
    screen: { width, height: width <= 360 ? 800 : 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; moto g54 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
  });
  await seedContext(context);
  return context;
}

async function webkitContext(browser: Browser, width: number): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    screen: { width, height: 844 },
    hasTouch: true,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
  });
  await seedContext(context);
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('#crm #mvp-lead-search', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('#crm [data-pc-toggle-stages]', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.mobile-bottom-nav .nav-label', { state: 'visible', timeout: 20_000 });
}

async function waitForStableGeometry(page: Page): Promise<void> {
  await page.waitForFunction((epsilon) => {
    const search = document.querySelector<HTMLElement>('#crm #mvp-lead-search');
    const toggle = document.querySelector<HTMLElement>('#crm [data-pc-toggle-stages]');
    const navButtons = Array.from(document.querySelectorAll<HTMLElement>('.mobile-bottom-nav .nav-button:not([hidden])'));
    if (!search || !toggle || navButtons.length !== 5 || document.fonts.status !== 'loaded') return false;

    const searchRect = search.getBoundingClientRect();
    const toggleRect = toggle.getBoundingClientRect();
    const navRects = navButtons.map((button) => button.getBoundingClientRect());
    return document.documentElement.scrollWidth <= innerWidth + 1
      && document.body.scrollWidth <= innerWidth + 1
      && searchRect.left >= -1
      && searchRect.right <= innerWidth + 1
      && searchRect.height >= 44 - epsilon
      && toggleRect.left >= -1
      && toggleRect.right <= innerWidth + 1
      && toggleRect.height >= 44 - epsilon
      && navRects.every((rect) => rect.left >= -1 && rect.right <= innerWidth + 1 && rect.height >= 44 - epsilon);
  }, GEOMETRY_EPSILON, { timeout: 5_000 });
}

async function geometrySnapshot(page: Page) {
  return page.evaluate(() => {
    const search = document.querySelector<HTMLInputElement>('#crm #mvp-lead-search');
    const count = document.querySelector<HTMLElement>('#crm #mvp-lead-count');
    const toggle = document.querySelector<HTMLElement>('#crm [data-pc-toggle-stages]');
    const navButtons = Array.from(document.querySelectorAll<HTMLElement>('.mobile-bottom-nav .nav-button:not([hidden])'));
    if (!search || !count || !toggle || navButtons.length !== 5) throw new Error('Faltan controles móviles para medir geometría.');

    const measure = (text: string, element: HTMLElement): number => {
      const style = getComputedStyle(element);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D no disponible.');
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const letterSpacing = Number.parseFloat(style.letterSpacing);
      const spacing = Number.isFinite(letterSpacing) ? letterSpacing * Math.max(0, text.length - 1) : 0;
      return context.measureText(text).width + spacing;
    };

    const searchStyle = getComputedStyle(search);
    const searchRect = search.getBoundingClientRect();
    const countRect = count.getBoundingClientRect();
    const searchAvailable = search.clientWidth
      - Number.parseFloat(searchStyle.paddingLeft)
      - Number.parseFloat(searchStyle.paddingRight);
    const placeholderWidth = measure(search.placeholder, search);

    const toggleRect = toggle.getBoundingClientRect();
    const nav = navButtons.map((button) => {
      const label = button.querySelector<HTMLElement>('.nav-label');
      if (!label) throw new Error('Label móvil ausente.');
      const buttonRect = button.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      const text = label.textContent?.trim() ?? '';
      return {
        text,
        buttonLeft: buttonRect.left,
        buttonRight: buttonRect.right,
        buttonHeight: buttonRect.height,
        labelLeft: labelRect.left,
        labelRight: labelRect.right,
        labelClientWidth: label.clientWidth,
        labelScrollWidth: label.scrollWidth,
        labelTextWidth: measure(text, label),
      };
    });

    return {
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      placeholder: search.placeholder,
      placeholderWidth,
      searchAvailable,
      searchLeft: searchRect.left,
      searchRight: searchRect.right,
      searchHeight: searchRect.height,
      searchBottom: searchRect.bottom,
      countTop: countRect.top,
      nav,
      toggleText: toggle.textContent?.trim() ?? '',
      toggleLeft: toggleRect.left,
      toggleRight: toggleRect.right,
      toggleHeight: toggleRect.height,
      toggleClientWidth: toggle.clientWidth,
      toggleScrollWidth: toggle.scrollWidth,
    };
  });
}

function assertGeometry(snapshot: Awaited<ReturnType<typeof geometrySnapshot>>, engine: string, width: number): void {
  const label = `${engine} @${width}`;
  assert.ok(snapshot.documentWidth <= snapshot.viewport + 1, `${label}: document overflow ${JSON.stringify(snapshot)}`);
  assert.ok(snapshot.bodyWidth <= snapshot.viewport + 1, `${label}: body overflow ${JSON.stringify(snapshot)}`);

  assert.equal(snapshot.placeholder, 'Buscar por nombre, WhatsApp o interés', `${label}: placeholder`);
  assert.ok(snapshot.searchLeft >= -1 && snapshot.searchRight <= snapshot.viewport + 1 && snapshot.searchHeight >= 44 - GEOMETRY_EPSILON, `${label}: buscador fuera de viewport ${JSON.stringify(snapshot)}`);
  assert.ok(snapshot.placeholderWidth <= snapshot.searchAvailable + 1, `${label}: placeholder visualmente truncado; texto=${snapshot.placeholderWidth.toFixed(2)} disponible=${snapshot.searchAvailable.toFixed(2)}`);
  if (width <= 390) assert.ok(snapshot.countTop >= snapshot.searchBottom - 1, `${label}: el contador sigue robando ancho crítico al buscador`);

  assert.deepEqual(snapshot.nav.map((item) => item.text), EXPECTED_NAV, `${label}: labels navegación`);
  assert.ok(snapshot.nav.every((item) => item.buttonLeft >= -1 && item.buttonRight <= snapshot.viewport + 1 && item.buttonHeight >= 44 - GEOMETRY_EPSILON), `${label}: targets navegación fuera del viewport ${JSON.stringify(snapshot.nav)}`);
  assert.ok(snapshot.nav.every((item) => item.labelLeft >= -1 && item.labelRight <= snapshot.viewport + 1), `${label}: labels navegación fuera del viewport ${JSON.stringify(snapshot.nav)}`);
  assert.ok(snapshot.nav.every((item) => item.labelScrollWidth <= item.labelClientWidth + 1), `${label}: overflow interno en navegación ${JSON.stringify(snapshot.nav)}`);
  assert.ok(snapshot.nav.every((item) => item.labelTextWidth <= item.labelClientWidth + 1), `${label}: texto de navegación no entra completo ${JSON.stringify(snapshot.nav)}`);

  assert.equal(snapshot.toggleText, 'Ver todas las etapas', `${label}: texto toggle pipeline`);
  assert.ok(snapshot.toggleLeft >= -1 && snapshot.toggleRight <= snapshot.viewport + 1 && snapshot.toggleHeight >= 44 - GEOMETRY_EPSILON, `${label}: toggle pipeline fuera del viewport ${JSON.stringify(snapshot)}`);
  assert.ok(snapshot.toggleScrollWidth <= snapshot.toggleClientWidth + 1, `${label}: 'Ver todas las etapas' truncado ${JSON.stringify(snapshot)}`);
}

test('la corrección geométrica final se carga después de la validación móvil aprobada', () => {
  const html = readFileSync('index.html', 'utf8');
  const css = readFileSync('src/leads-mobile-text-geometry-fix.css', 'utf8');
  assert.ok(html.includes('/src/leads-mobile-text-geometry-fix.css?v=20260810-1'));
  assert.ok(html.indexOf('leads-mobile-text-geometry-fix.css') > html.indexOf('leads-mobile-real-validation.css'));
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /text-overflow:\s*clip/);
});

test('Chromium Android: placeholder, bottom nav y toggle no truncan texto en 320-520', { timeout: 180_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible.');
  const port = 62220 + Math.floor(Math.random() * 80);
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });

  try {
    for (const width of CHROMIUM_WIDTHS) {
      const context = await chromiumContext(browser, width);
      try {
        const page = await context.newPage();
        await load(page, `http://127.0.0.1:${port}`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await waitForStableGeometry(page);
        const snapshot = await geometrySnapshot(page);
        if (width === 320) console.log(`# PR142_GEOMETRY_320 ${JSON.stringify(snapshot)}`);
        assertGeometry(snapshot, 'Chromium', width);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
});

test('WebKit: placeholder y navegación conservan texto completo en 375/390/430', { timeout: 120_000 }, async () => {
  const port = 62320 + Math.floor(Math.random() * 80);
  const server = await startServer(port);
  const browser = await webkit.launch({ headless: true });

  try {
    for (const width of WEBKIT_WIDTHS) {
      const context = await webkitContext(browser, width);
      try {
        const page = await context.newPage();
        await load(page, `http://127.0.0.1:${port}`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await waitForStableGeometry(page);
        const snapshot = await geometrySnapshot(page);
        assertGeometry(snapshot, 'WebKit', width);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
});