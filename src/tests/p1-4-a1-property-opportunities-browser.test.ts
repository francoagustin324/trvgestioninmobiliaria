import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type Client, type CrmData } from '../models.js';

const repositoryRoot = process.cwd();
const userId = 'p1-4-a1-browser-user';
const storageKey = `trv-crm-basico:user:${userId}`;

function opportunityClient(id: number, name: string, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name,
    phone: `54935155501${String(id).padStart(2, '0')}`,
    interest: 'Departamento General Paz 2 dormitorios con balcón y cochera',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Calificado',
    budget: 'USD 120.000',
    propertyType: 'Departamento',
    zones: 'General Paz',
    bedrooms: 2,
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function browserCrm(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: 'p1-4-a1-browser-org',
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Browser test',
  };
  crm.teamMembers = [{
    id: 99,
    userId: 'p1-4-a1-owner',
    name: 'Dueño Test',
    email: 'owner@example.test',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-09-01T09:00:00.000Z',
  }, {
    id: 1,
    userId,
    name: 'Corredor Uno',
    email: 'corredor1@example.test',
    phone: '5493515110001',
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-09-01T10:00:00.000Z',
  }, {
    id: 2,
    userId: 'other-browser-user',
    name: 'Corredor Dos',
    email: 'corredor2@example.test',
    phone: '5493515110002',
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-09-01T10:00:00.000Z',
  }];
  crm.clients = [
    opportunityClient(1, 'Ana Alta', {
      temperature: 'Caliente',
      features: 'balcón cochera',
      paymentMethod: 'Contado',
      canMoveForward: 'Sí',
      nextAction: 'Llamar por esta propiedad',
      nextFollowUp: '2026-09-08',
    }),
    opportunityClient(2, 'Bruno Buena', {
      zones: '',
      features: '',
      paymentMethod: '',
      pipeline: 'Contactado',
      nextAction: 'Revisar disponibilidad',
    }),
    opportunityClient(3, 'Carla Posible', {
      budget: '',
      bedrooms: undefined,
      features: '',
      paymentMethod: '',
      pipeline: 'Nuevo',
    }),
    opportunityClient(4, 'Dario Ganado', {
      status: 'Operación ganada',
      pipeline: 'Ganado',
      temperature: 'Caliente',
    }),
    opportunityClient(5, 'Cliente Oculto Otro Corredor', {
      temperature: 'Caliente',
      budget: 'USD 200.000',
      features: 'balcón cochera',
      paymentMethod: 'Contado',
      assignedToId: 2,
      createdById: 2,
    }),
  ];
  crm.activityLog = [{
    id: 1,
    actorId: 1,
    action: 'Llamada registrada',
    entityType: 'Cliente',
    entityId: 1,
    detail: 'Conversación de calificación',
    createdAt: '2026-09-04T14:00:00.000Z',
  }];
  crm.properties = [{
    id: 1,
    title: 'Departamento General Paz',
    address: 'General Paz, Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 100000,
    owner: 'Propietario Test',
    status: 'Activa',
    bedrooms: 2,
    features: 'Balcón y cochera',
    paymentMethod: 'Contado',
    assignedToId: 1,
    createdById: 1,
  }, {
    id: 2,
    title: 'Propiedad Oculta Otro Corredor',
    address: 'General Paz, Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 90000,
    owner: 'Propietario oculto',
    status: 'Activa',
    assignedToId: 2,
    createdById: 2,
  }];
  crm.visits = [];
  crm.offers = [];
  crm.reservations = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.settings = {
    ...crm.settings,
    profileName: 'Corredor Uno',
    profileEmail: 'corredor1@example.test',
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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Servidor P1.4-A1 no disponible: ${String(lastError ?? 'sin respuesta')}`);
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

async function createContext(browser: Browser, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport, locale: 'es-AR' });
  const data = browserCrm();
  await context.addInitScript(({ crm, accountUserId, accountStorageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'p1-4-a1-browser-token',
      refreshToken: 'p1-4-a1-browser-refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: accountUserId,
      email: 'corredor1@example.test',
    }));
    localStorage.setItem(accountStorageKey, JSON.stringify(crm));
    localStorage.setItem(`${accountStorageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: new Date().toISOString(),
      lastCloudSavedAt: new Date().toISOString(),
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { crm: data, accountUserId: userId, accountStorageKey: storageKey });
  return context;
}

async function openOpportunities(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-card', { state: 'visible', timeout: 20_000 });
  const width = page.viewportSize()?.width ?? 1366;
  const navigation = width <= 980
    ? '.mobile-bottom-nav [data-module="propiedades"]'
    : '.premium-sidebar [data-module="propiedades"]';
  await page.locator(navigation).click();
  await page.waitForSelector('#propiedades.active [data-open-property-opportunities]', { state: 'visible', timeout: 20_000 });
  await page.locator('#propiedades [data-open-property-opportunities]').click();
  await page.waitForSelector('#propiedades.active [data-property-opportunities]', { state: 'visible', timeout: 20_000 });
}

async function selectTestProperty(page: Page): Promise<void> {
  const selector = page.locator('#propiedades [data-opportunity-property]');
  assert.equal(await selector.locator('option').count(), 2, 'Sólo debe listar la propiedad visible del corredor más el placeholder.');
  assert.doesNotMatch(await selector.textContent() || '', /Propiedad Oculta Otro Corredor/);
  await selector.selectOption('1');
  await page.waitForSelector('#propiedades [data-opportunity-client="1"]', { state: 'visible', timeout: 10_000 });
}

function launchP14Browser(t: TestContext): string {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chromium para P1.4-A1.');
    t.skip('No hay Chrome/Chromium local.');
    return '';
  }
  return executable;
}

test('P1.4-A1 browser desktop: matching canónico, filtros, selección y visibilidad', { timeout: 120_000 }, async (t) => {
  const executable = launchP14Browser(t);
  if (!executable) return;
  const server = await startServer(4331);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  const context = await createContext(browser, { width: 1366, height: 768 });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await openOpportunities(page, 'http://127.0.0.1:4331');
    await selectTestProperty(page);

    assert.deepEqual(await page.locator('#propiedades .opportunity-client-name').allTextContents(), ['Ana Alta', 'Bruno Buena', 'Carla Posible']);
    assert.equal(await page.locator('#propiedades [data-opportunity-client="5"]').count(), 0);
    assert.equal(await page.locator('#propiedades [data-opportunity-client="4"]').count(), 0);

    const first = page.locator('#propiedades [data-opportunity-client="1"]');
    assert.match(await first.textContent() || '', /Dentro del presupuesto/);
    assert.match(await first.textContent() || '', /Zona: General Paz/);
    assert.match(await first.textContent() || '', /Llamada registrada/);
    assert.match(await first.textContent() || '', /Llamar por esta propiedad/);

    await page.locator('#propiedades [data-opportunity-compatibility]').selectOption('high');
    const highScores = await page.locator('#propiedades .property-opportunity-card .match-score').allTextContents();
    assert.ok(highScores.length >= 1);
    assert.ok(highScores.every((value) => value.includes('Alta')));

    await page.locator('#propiedades [data-opportunity-compatibility]').selectOption('all');
    await page.locator('#propiedades [data-opportunity-followup]').selectOption('with');
    assert.deepEqual(await page.locator('#propiedades .opportunity-client-name').allTextContents(), ['Ana Alta']);
    await page.locator('#propiedades [data-opportunity-followup]').selectOption('all');

    await page.locator('#propiedades [data-opportunity-select="1"]').check();
    await page.locator('#propiedades [data-opportunity-select="2"]').check();
    assert.equal((await page.locator('#propiedades [data-opportunity-selection-count]').textContent())?.trim(), '2 clientes seleccionados');

    await page.locator('#propiedades [data-opportunity-status]').selectOption('all');
    const terminal = page.locator('#propiedades [data-opportunity-terminal]');
    assert.match(await terminal.textContent() || '', /Dario Ganado/);
    assert.match(await terminal.textContent() || '', /Fuera de acción comercial/);
    assert.doesNotMatch(await terminal.textContent() || '', /Cliente Oculto Otro Corredor/);

    await page.locator('#propiedades [data-opportunity-search]').fill('sin-resultados-xyz');
    await page.waitForSelector('#propiedades [data-opportunity-empty="filtered"]', { state: 'visible' });
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('P1.4-A1 browser mobile 390: sin overflow y controles táctiles', { timeout: 120_000 }, async (t) => {
  const executable = launchP14Browser(t);
  if (!executable) return;
  const server = await startServer(4332);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  const context = await createContext(browser, { width: 390, height: 844 });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await openOpportunities(page, 'http://127.0.0.1:4332');
    await selectTestProperty(page);

    const metrics = await page.locator('#propiedades [data-property-opportunities]').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const controls = [...node.querySelectorAll<HTMLElement>('button, select, input[type="search"]')]
        .filter((control) => control.offsetParent !== null)
        .map((control) => control.getBoundingClientRect().height);
      const selectors = [...node.querySelectorAll<HTMLElement>('.opportunity-selector')]
        .filter((control) => control.offsetParent !== null)
        .map((control) => control.getBoundingClientRect().width);
      return {
        left: rect.left,
        right: rect.right,
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        minControlHeight: Math.min(...controls),
        minSelectorWidth: Math.min(...selectors),
      };
    });
    assert.ok(metrics.left >= -1, JSON.stringify(metrics));
    assert.ok(metrics.right <= metrics.viewport + 1, JSON.stringify(metrics));
    assert.ok(metrics.documentWidth <= metrics.viewport + 1, JSON.stringify(metrics));
    assert.ok(metrics.minControlHeight >= 43.5, JSON.stringify(metrics));
    assert.ok(metrics.minSelectorWidth >= 43.5, JSON.stringify(metrics));
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
