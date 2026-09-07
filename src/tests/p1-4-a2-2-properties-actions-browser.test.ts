import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type Client, type CrmData } from '../models.js';

const repositoryRoot = process.cwd();
const visualDir = resolve(repositoryRoot, 'artifacts/p1-4-a2-2-properties');
const userId = 'p1-4-a2-2-visual-user';
const storageKey = `trv-crm-basico:user:${userId}`;

type ViewportCase = {
  width: number;
  height: number;
  name: string;
  exercisePersistence?: boolean;
};

type RectMetrics = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

const viewports: ViewportCase[] = [
  { width: 1440, height: 900, name: 'desktop-1440x900' },
  { width: 1366, height: 768, name: 'desktop-1366x768', exercisePersistence: true },
  { width: 390, height: 844, name: 'mobile-390x844' },
  { width: 360, height: 800, name: 'mobile-360x800' },
];

function compatibleClient(id: number, name: string): Client {
  return {
    id,
    name,
    phone: `54935155503${String(id).padStart(2, '0')}`,
    interest: 'Departamento General Paz 2 dormitorios cochera',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Calificado',
    budget: 'USD 160.000',
    propertyType: 'Departamento',
    zones: 'General Paz',
    bedrooms: 2,
    features: 'cochera balcón',
    paymentMethod: 'Contado',
    canMoveForward: 'Sí',
    nextAction: 'Coordinar visita',
    nextFollowUp: '2026-09-10',
    assignedToId: 1,
    createdById: 1,
  };
}

function visualCrm(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: 'p1-4-a2-2-visual-org',
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Visual QA',
  };
  crm.teamMembers = [{
    id: 99,
    userId: 'p1-4-a2-2-owner',
    name: 'Dueño Visual',
    email: 'owner-properties@example.test',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-09-06T18:00:00.000Z',
  }, {
    id: 1,
    userId,
    name: 'Corredor Visual',
    email: 'properties-visual@example.test',
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-09-06T18:05:00.000Z',
  }];
  crm.clients = [compatibleClient(31, 'Ana Cliente Compatible')];
  crm.properties = [{
    id: 41,
    title: 'Departamento premium con cochera y balcón en General Paz',
    address: 'General Paz, Córdoba Capital',
    type: 'Departamento',
    operation: 'Venta',
    price: 145000,
    owner: 'Propietario Visual',
    status: 'Activa',
    bedrooms: 2,
    bathrooms: 2,
    garage: '1 cochera',
    coveredMeters: 92,
    totalMeters: 104,
    features: 'Balcón y cochera',
    paymentMethod: 'Contado',
    assignedToId: 1,
    createdById: 1,
  }];
  crm.activityLog = [];
  crm.visits = [];
  crm.offers = [];
  crm.reservations = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.settings = {
    ...crm.settings,
    profileName: 'Corredor Visual',
    profileEmail: 'properties-visual@example.test',
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
}

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find(existsSync);
}

async function waitForServer(baseUrl: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Servidor P1.4-A2.2 no disponible: ${String(lastError ?? 'sin respuesta')}`);
}

async function startServer(port: number): Promise<ChildProcess> {
  const server = spawn(process.execPath, ['dist/server.js'], {
    cwd: repositoryRoot,
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
  await new Promise<void>((resolveStop) => {
    const timer = setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL');
      resolveStop();
    }, 2_000);
    server.once('exit', () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
}

async function createContext(browser: Browser, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport, locale: 'es-AR' });
  const crm = visualCrm();
  await context.addInitScript(({ data, accountUserId, accountStorageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'p1-4-a2-2-token',
      refreshToken: 'p1-4-a2-2-refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: accountUserId,
      email: 'properties-visual@example.test',
    }));
    localStorage.setItem(accountStorageKey, JSON.stringify(data));
    localStorage.setItem(`${accountStorageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: new Date().toISOString(),
      lastCloudSavedAt: new Date().toISOString(),
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { data: crm, accountUserId: userId, accountStorageKey: storageKey });
  return context;
}

async function removeEnvironmentNotice(page: Page): Promise<void> {
  await page.evaluate(() => {
    const message = 'La conexión con Supabase todavía no está configurada.';
    const candidates = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => element.textContent?.trim() === message);
    candidates.forEach((candidate) => {
      let target = candidate;
      while (
        target.parentElement
        && target.parentElement !== document.body
        && target.parentElement.textContent?.trim() === message
      ) {
        target = target.parentElement;
      }
      target.remove();
    });
  });
}

function launchVisualBrowser(t: TestContext): string {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chromium para P1.4-A2.2 visual QA.');
    t.skip('No hay Chrome/Chromium local.');
    return '';
  }
  return executable;
}

async function openProperties(page: Page, baseUrl: string, viewport: ViewportCase): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-card', { state: 'visible', timeout: 20_000 });
  const navigation = viewport.width <= 980
    ? '.mobile-bottom-nav [data-module="propiedades"]'
    : '.premium-sidebar [data-module="propiedades"]';
  await page.locator(navigation).click();
  await page.waitForSelector('#propiedades.active .mvp-properties-heading', { state: 'visible', timeout: 20_000 });
  await page.evaluate(async () => { await document.fonts.ready; });
  await removeEnvironmentNotice(page);
}

async function assertExactHeader(page: Page): Promise<void> {
  const heading = page.locator('#propiedades .mvp-properties-heading');
  assert.equal((await heading.locator('h1').textContent())?.trim(), 'Propiedades');
  assert.equal((await heading.locator('p').textContent())?.trim(), 'Gestioná tu inventario y encontrá clientes compatibles.');
  assert.equal(await page.locator('#propiedades [data-toggle="property-form"]').count(), 1);
  assert.equal(await page.locator('#propiedades [data-open-property-opportunities]').count(), 1);
  assert.equal((await page.locator('#propiedades [data-toggle="property-form"]').textContent())?.trim(), 'Nueva propiedad');
  assert.equal((await page.locator('#propiedades [data-open-property-opportunities]').textContent())?.trim(), 'Buscar clientes compatibles');
  assert.equal(await page.locator('#propiedades .mvp-property-flow').count(), 0);
}

function rectOverlap(a: RectMetrics, b: RectMetrics): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function assertHeaderGeometry(page: Page, viewport: ViewportCase): Promise<void> {
  const metrics = await page.locator('#propiedades .mvp-properties-heading').evaluate((heading) => {
    const plainRect = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const query = (selector: string) => {
      const element = heading.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Elemento de cabecera faltante: ${selector}`);
      return element;
    };
    const copy = query('.mvp-properties-heading-copy');
    const actions = query('.mvp-properties-heading-actions');
    const primary = query('[data-toggle="property-form"]');
    const secondary = query('[data-open-property-opportunities]');
    const primaryStyle = getComputedStyle(primary);
    const secondaryStyle = getComputedStyle(secondary);
    return {
      heading: plainRect(heading),
      copy: plainRect(copy),
      actions: plainRect(actions),
      primary: plainRect(primary),
      secondary: plainRect(secondary),
      primaryStyle: {
        backgroundImage: primaryStyle.backgroundImage,
        backgroundColor: primaryStyle.backgroundColor,
        borderRadius: primaryStyle.borderRadius,
        fontFamily: primaryStyle.fontFamily,
      },
      secondaryStyle: {
        backgroundImage: secondaryStyle.backgroundImage,
        backgroundColor: secondaryStyle.backgroundColor,
        borderRadius: secondaryStyle.borderRadius,
        fontFamily: secondaryStyle.fontFamily,
      },
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });

  const evidence = JSON.stringify({ viewport, metrics });
  assert.ok(metrics.heading.left >= -1, evidence);
  assert.ok(metrics.heading.right <= metrics.viewportWidth + 1, evidence);
  assert.ok(metrics.documentWidth <= metrics.viewportWidth + 1, evidence);
  assert.ok(metrics.primary.height >= 43.5, evidence);
  assert.ok(metrics.secondary.height >= 43.5, evidence);
  assert.ok(Math.abs(metrics.primary.height - metrics.secondary.height) <= 1.5, evidence);
  assert.equal(metrics.primaryStyle.borderRadius, metrics.secondaryStyle.borderRadius, evidence);
  assert.equal(metrics.primaryStyle.fontFamily, metrics.secondaryStyle.fontFamily, evidence);
  assert.notEqual(
    `${metrics.primaryStyle.backgroundImage}|${metrics.primaryStyle.backgroundColor}`,
    `${metrics.secondaryStyle.backgroundImage}|${metrics.secondaryStyle.backgroundColor}`,
    evidence,
  );

  if (viewport.width > 720) {
    assert.equal(rectOverlap(metrics.copy, metrics.actions), false, evidence);
    assert.ok(Math.abs(metrics.primary.top - metrics.secondary.top) <= 2, evidence);
    assert.ok(metrics.secondary.right <= metrics.primary.left, evidence);
  } else {
    assert.ok(metrics.copy.bottom < metrics.actions.top, evidence);
    assert.ok(metrics.primary.top < metrics.secondary.top, evidence);
    assert.ok(metrics.primary.width >= metrics.actions.width - 2, evidence);
    assert.ok(metrics.secondary.width >= metrics.actions.width - 2, evidence);
    assert.equal(rectOverlap(metrics.primary, metrics.secondary), false, evidence);
  }
}

async function assertEntrypointPersists(page: Page): Promise<void> {
  for (let cycle = 0; cycle < 2; cycle += 1) {
    assert.equal(await page.locator('#propiedades [data-open-property-opportunities]').count(), 1);
    await page.locator('#propiedades [data-open-property-opportunities]').click();
    await page.waitForSelector('#propiedades [data-property-opportunities]', { state: 'visible' });
    assert.equal(await page.locator('#propiedades [data-property-opportunities]').count(), 1);
    await page.locator('#propiedades [data-opportunities-back]').click();
    await page.waitForSelector('#propiedades .mvp-properties-heading', { state: 'visible' });
    assert.equal(await page.locator('#propiedades [data-open-property-opportunities]').count(), 1);
  }

  await page.locator('#propiedades [data-edit-property="41"]').click();
  await page.waitForSelector('#propiedades #mvp-property-form:not(.collapsed)', { state: 'visible' });
  assert.equal(await page.locator('#propiedades [data-open-property-opportunities]').count(), 1);

  await page.locator('#propiedades [data-cancel-property-edit]').click();
  await page.waitForSelector('#propiedades #mvp-property-form.collapsed');
  assert.equal(await page.locator('#propiedades [data-open-property-opportunities]').count(), 1);

  await page.locator('#propiedades [data-edit-property="41"]').click();
  await page.waitForSelector('#propiedades #mvp-property-form:not(.collapsed)', { state: 'visible' });
  const updatedTitle = 'Departamento premium General Paz actualizado';
  await page.locator('#propiedades #mvp-property-form input[name="title"]').fill(updatedTitle);
  await page.locator('#propiedades #mvp-property-form button[type="submit"]').click();
  await page.waitForSelector('#propiedades #mvp-property-form.collapsed');
  await page.waitForFunction((title) => [...document.querySelectorAll('#propiedades .mvp-property-title h3')]
    .some((element) => element.textContent?.trim() === title), updatedTitle);
  assert.equal(await page.locator('#propiedades [data-open-property-opportunities]').count(), 1);

  await page.locator('#propiedades [data-toggle="property-form"]').click();
  await page.waitForSelector('#propiedades #mvp-property-form:not(.collapsed)', { state: 'visible' });
  assert.equal(await page.locator('#propiedades [data-open-property-opportunities]').count(), 1);
  await page.locator('#propiedades [data-cancel-property-edit]').click();
  await page.waitForSelector('#propiedades #mvp-property-form.collapsed');
  assert.equal(await page.locator('#propiedades [data-open-property-opportunities]').count(), 1);
}

test('P1.4-A2.2 browser: jerarquía, reentrada estable y QA visual responsive', async (t) => {
  const executablePath = launchVisualBrowser(t);
  if (!executablePath) return;

  rmSync(visualDir, { recursive: true, force: true });
  mkdirSync(visualDir, { recursive: true });
  const server = await startServer(4336);
  const browser: Browser = await chromium.launch({ executablePath, headless: true });

  try {
    for (const viewport of viewports) {
      const context = await createContext(browser, viewport);
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      try {
        await openProperties(page, 'http://127.0.0.1:4336', viewport);
        await assertExactHeader(page);
        await assertHeaderGeometry(page, viewport);
        if (viewport.exercisePersistence) {
          await assertEntrypointPersists(page);
          await assertExactHeader(page);
          await page.locator('#propiedades .mvp-properties-heading').scrollIntoViewIfNeeded();
        }
        assert.deepEqual(pageErrors, []);
        await page.screenshot({
          path: resolve(visualDir, `${viewport.name}.png`),
          fullPage: false,
        });
      } finally {
        await page.close();
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
