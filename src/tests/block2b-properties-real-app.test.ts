import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData } from '../models.js';
import { installA35H5R1ModernTenantHarness } from './a35-h5-r1-modern-tenant-harness.js';

const USER = 'block2b-user';
const ORG = 'block2b-org';
const OTHER_ORG = 'block2b-other-org';
const storageKey = `trv-crm-basico:user:${USER}:org:${ORG}`;

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG, name: 'Inmobiliaria Sintética Block2B', seatLimit: null, planLabel: 'QA' };
  crm.teamMembers = [{
    id: 1,
    userId: USER,
    name: 'Corredor Block2B',
    email: 'block2b@example.test',
    phone: '5493515110001',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-09-24T12:00:00.000Z',
  }, {
    id: 2,
    userId: 'block2b-other-user',
    name: 'Otro miembro',
    email: 'other@example.test',
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-09-24T12:05:00.000Z',
  }];
  crm.clients = [{
    id: 1,
    name: 'Cliente Docta',
    phone: '5493515550001',
    interest: 'Busco dúplex en Docta',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Calificado',
    budget: 'USD 130.000',
    propertyType: 'Dúplex',
    zones: 'Docta',
    assignedToId: 1,
    createdById: 1,
  }];
  crm.properties = [{
    id: 10,
    title: 'Propiedad existente',
    address: 'General Paz, Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 90000,
    owner: 'Propietario existente',
    status: 'Activa',
    bedrooms: 2,
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
  return crm;
}

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
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
  throw new Error(`Servidor Block2B no disponible: ${String(lastError ?? 'sin respuesta')}`);
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

async function contextFor(browser: Browser, viewport: { width: number; height: number }, suffix: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    hasTouch: viewport.width <= 720,
    isMobile: viewport.width <= 430,
  });
  const crm = fixture();
  await installA35H5R1ModernTenantHarness(context, crm, USER);
  await context.addInitScript(({ data, key, userId, marker }) => {
    if (localStorage.getItem(marker)) return;
    localStorage.setItem(marker, '1');
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'block2b-access',
      refreshToken: 'block2b-refresh',
      expiresAt: Date.now() + 3_600_000,
      userId,
      email: 'block2b@example.test',
    }));
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(`${key}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-09-24T12:00:00-03:00',
      lastCloudSavedAt: '2026-09-24T12:00:00-03:00',
    }));
  }, { data: crm, key: storageKey, userId: USER, marker: `block2b-fixture-${suffix}` });
  return context;
}

async function loadProperties(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.locator('[data-module="propiedades"]:visible').first().click();
  await page.waitForSelector('#propiedades.active [data-toggle="property-form"]', { state: 'visible', timeout: 20_000 });
}

async function openForm(page: Page) {
  await page.locator('#propiedades [data-toggle="property-form"]').click();
  const form = page.locator('#propiedades #mvp-property-form:not(.collapsed)');
  await form.waitFor({ state: 'visible' });
  return form;
}

async function crmState(page: Page): Promise<CrmData> {
  return page.evaluate(async () => {
    const store = await import('/dist/store.js');
    return structuredClone(store.state.crm) as CrmData;
  });
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const metric = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(metric.document <= metric.viewport + 1, JSON.stringify(metric));
}

test('Bloque 2B crea rápido en móvil, valida esenciales, entra a matching y permite completar después', { timeout: 180_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para Block2B.');
  const port = 63100 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, { width: 390, height: 844 }, 'quick');
  try {
    const page = await context.newPage();
    await loadProperties(page, baseUrl);
    let form = await openForm(page);

    const details = form.locator('details.mvp-property-progressive');
    assert.equal(await details.count(), 3);
    for (let index = 0; index < 3; index += 1) {
      assert.equal(await details.nth(index).getAttribute('open'), null);
      assert.ok(await details.nth(index).locator('summary').evaluate((node) => node.getBoundingClientRect().height >= 44));
    }
    for (const name of ['title', 'address', 'type', 'operation', 'price']) {
      assert.equal(await form.locator(`[name="${name}"]`).count(), 1, name);
    }
    assert.equal(await form.locator('input[name="bedrooms"]').isVisible(), false);

    await form.locator('[type="submit"]').click();
    assert.match(await form.locator('[data-property-error]').innerText(), /título comercial/i);

    await form.locator('input[name="title"]').fill('Dúplex rápido Docta');
    await form.locator('[type="submit"]').click();
    assert.match(await form.locator('[data-property-error]').innerText(), /zona o ubicación/i);

    await form.locator('input[name="address"]').fill('Docta, Córdoba');
    await form.locator('select[name="type"]').selectOption('Dúplex');
    await form.locator('select[name="operation"]').selectOption('Venta');
    await form.locator('input[name="price"]').fill('0');
    await form.locator('[type="submit"]').click();
    assert.match(await form.locator('[data-property-error]').innerText(), /mayor a cero/i);

    await form.locator('input[name="price"]').fill('120000');
    await form.locator('[type="submit"]').click();
    await page.locator('#propiedades #mvp-property-form.collapsed').waitFor({ state: 'attached' });
    await page.locator('#propiedades .mvp-property-title h3').getByText('Dúplex rápido Docta', { exact: true }).waitFor({ state: 'visible' });

    let crm = await crmState(page);
    const created = crm.properties.find((property) => property.title === 'Dúplex rápido Docta');
    assert.ok(created);
    assert.equal(created.address, 'Docta, Córdoba');
    assert.equal(created.type, 'Dúplex');
    assert.equal(created.operation, 'Venta');
    assert.equal(created.price, 120000);
    assert.equal(created.owner, '');
    assert.equal(created.status, 'Activa');
    assert.equal(created.bedrooms, undefined);
    assert.equal(created.assignedToId, 1);
    assert.equal(created.createdById, 1);
    assert.ok(created.uid);
    const originalUid = created.uid;

    const matching = await page.evaluate(async (propertyId) => {
      const store = await import('/dist/store.js');
      const dynamicImport = (path: string): Promise<any> => import(path);
      const matchingModule = await dynamicImport('/dist/property-matching.js');
      const opportunityModule = await dynamicImport('/dist/property-opportunities.js');
      const property = store.state.crm.properties.find((item) => item.id === propertyId)!;
      return {
        issues: opportunityModule.propertyMatchingDataIssues(property),
        clientIds: (matchingModule.matchClientsForProperty(property, store.state.crm.clients) as Array<{ client: { id: number } }>).map((match) => match.client.id),
      };
    }, created.id);
    assert.deepEqual(matching.issues, []);
    assert.deepEqual(matching.clientIds, [1]);

    await page.locator(`[data-edit-property="${created.id}"]`).click();
    form = page.locator('#propiedades #mvp-property-form:not(.collapsed)');
    await form.waitFor({ state: 'visible' });
    assert.equal(await form.locator('details.mvp-property-progressive[open]').count(), 3);
    await form.locator('input[name="bedrooms"]').fill('3');
    await form.locator('input[name="coveredMeters"]').fill('105');
    await form.locator('input[name="totalMeters"]').fill('140');
    await form.locator('select[name="deed"]').selectOption('Sí');
    await form.locator('input[name="owner"]').fill('Propietario sintético');
    await form.locator('textarea[name="notes"]').fill('Nota interna sintética');
    await form.locator('[type="submit"]').click();
    await page.locator('#propiedades #mvp-property-form.collapsed').waitFor({ state: 'attached' });

    crm = await crmState(page);
    const edited = crm.properties.find((property) => property.id === created.id);
    assert.ok(edited);
    assert.equal(edited.title, 'Dúplex rápido Docta');
    assert.equal(edited.address, 'Docta, Córdoba');
    assert.equal(edited.type, 'Dúplex');
    assert.equal(edited.operation, 'Venta');
    assert.equal(edited.price, 120000);
    assert.equal(edited.bedrooms, 3);
    assert.equal((edited as unknown as { coveredMeters?: number }).coveredMeters, 105);
    assert.equal(edited.owner, 'Propietario sintético');
    assert.equal(edited.assignedToId, 1);
    assert.equal(edited.createdById, 1);
    assert.equal(edited.uid, originalUid);

    assert.equal(await page.locator('[data-edit-property="10"]').count(), 1, 'La propiedad histórica sigue editable.');
    await noHorizontalOverflow(page);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('Bloque 2B falla cerrado ante persistencia o tenant obsoleto y conserva fotos/datos para reintentar', { timeout: 150_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para Block2B.');
  const port = 63200 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, { width: 390, height: 844 }, 'rollback');
  try {
    const page = await context.newPage();
    await loadProperties(page, baseUrl);
    const form = await openForm(page);
    await form.locator('input[name="title"]').fill('PROPIEDAD FALLA STORAGE');
    await form.locator('input[name="address"]').fill('Centro, Córdoba');
    await form.locator('select[name="type"]').selectOption('Departamento');
    await form.locator('select[name="operation"]').selectOption('Venta');
    await form.locator('input[name="price"]').fill('85000');

    const photo = 'https://images.example.test/block2b-photo.jpg';
    await form.locator('details').filter({ hasText: 'Fotos' }).locator('summary').click();
    await form.locator('textarea[name="photoUrls"]').evaluate((node, value) => {
      const textarea = node as HTMLTextAreaElement;
      textarea.value = value;
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }, photo);

    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as unknown as { __block2bSetItem?: typeof Storage.prototype.setItem }).__block2bSetItem = original;
      Storage.prototype.setItem = function setItem(key: string, value: string): void {
        if (key.includes('trv-crm-basico:user') && value.includes('PROPIEDAD FALLA STORAGE')) {
          throw new Error('Quota sintética Block2B');
        }
        original.call(this, key, value);
      };
    });

    await form.locator('[type="submit"]').click();
    await form.locator('[data-property-error]').waitFor({ state: 'visible' });
    assert.match(await form.locator('[data-property-error]').innerText(), /datos y fotos siguen en el formulario/i);
    assert.equal(await form.locator('input[name="title"]').inputValue(), 'PROPIEDAD FALLA STORAGE');
    assert.equal(await form.locator('textarea[name="photoUrls"]').inputValue(), photo);
    assert.equal((await crmState(page)).properties.some((property) => property.title === 'PROPIEDAD FALLA STORAGE'), false);
    assert.equal(await form.isVisible(), true);

    await page.evaluate(() => {
      const target = window as unknown as { __block2bSetItem?: typeof Storage.prototype.setItem };
      if (target.__block2bSetItem) Storage.prototype.setItem = target.__block2bSetItem;
    });

    await page.evaluate(async ({ userId, organizationId }) => {
      const dynamicImport = (path: string): Promise<any> => import(path);
      const runtime = await dynamicImport('/dist/tenant-runtime.js');
      const store = await import('/dist/store.js');
      const other = structuredClone(store.state.crm);
      other.organization = { ...other.organization, id: organizationId, name: 'Otra inmobiliaria sintética' };
      store.state.crm = other;
      runtime.installTenantRuntimeScope({ userId, organizationId }, userId);
    }, { userId: USER, organizationId: OTHER_ORG });

    await form.locator('[type="submit"]').click();
    await form.locator('[data-property-error]').waitFor({ state: 'visible' });
    assert.match(await form.locator('[data-property-error]').innerText(), /tenant o runtime activo cambió/i);
    const afterSwitch = await crmState(page);
    assert.equal(afterSwitch.organization.id, OTHER_ORG);
    assert.equal(afterSwitch.properties.some((property) => property.title === 'PROPIEDAD FALLA STORAGE'), false);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
