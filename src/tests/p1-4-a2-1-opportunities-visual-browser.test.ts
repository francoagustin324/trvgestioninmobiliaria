import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type Client, type CrmData } from '../models.js';

const repositoryRoot = process.cwd();
const visualDir = resolve(repositoryRoot, 'artifacts/p1-4-a2-1-opportunities');
const userId = 'p1-4-a2-1-visual-user';
const storageKey = `trv-crm-basico:user:${userId}`;

type ViewportCase = {
  width: number;
  height: number;
  name: string;
  primary?: boolean;
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
  { width: 1366, height: 768, name: 'desktop-1366x768', primary: true },
  { width: 1440, height: 900, name: 'desktop-1440x900' },
  { width: 390, height: 844, name: 'mobile-390x844', primary: true },
  { width: 360, height: 800, name: 'mobile-360x800' },
];

function opportunityClient(id: number, name: string, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name,
    phone: `54935155502${String(id).padStart(2, '0')}`,
    interest: 'Departamento General Paz 2 dormitorios balcón cochera',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Calificado',
    budget: 'USD 155.000',
    propertyType: 'Departamento',
    zones: 'General Paz',
    bedrooms: 2,
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function visualCrm(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: 'p1-4-a2-1-visual-org',
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Visual QA',
  };
  crm.teamMembers = [{
    id: 99,
    userId: 'p1-4-a2-1-owner',
    name: 'Dueño Visual',
    email: 'owner-visual@example.test',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-09-06T12:00:00.000Z',
  }, {
    id: 1,
    userId,
    name: 'Corredor Visual',
    email: 'visual@example.test',
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-09-06T12:05:00.000Z',
  }];
  crm.clients = [
    opportunityClient(31, 'Ana Compatibilidad Alta', {
      temperature: 'Caliente',
      features: 'balcón cochera',
      paymentMethod: 'Contado',
      canMoveForward: 'Sí',
      nextAction: 'Confirmar visita y documentación disponible',
      nextFollowUp: '2026-09-09',
    }),
    opportunityClient(32, 'Bruno Seguimiento Comercial', {
      pipeline: 'Contactado',
      zones: '',
      nextAction: 'Validar zona alternativa y cochera',
      nextFollowUp: '2026-09-11',
    }),
    opportunityClient(33, 'Carla Revisión de Requisitos', {
      pipeline: 'Nuevo',
      budget: '',
      bedrooms: undefined,
      features: '',
    }),
  ];
  crm.activityLog = [{
    id: 31,
    actorId: 1,
    action: 'Llamada registrada',
    entityType: 'Cliente',
    entityId: 31,
    detail: 'Conversación para validar disponibilidad y forma de pago',
    createdAt: '2026-09-06T14:00:00.000Z',
  }];
  crm.properties = [{
    id: 41,
    title: 'Departamento premium con cochera doble, balcón terraza y amenities completos',
    address: 'Av. 24 de Septiembre 1840, General Paz, Córdoba Capital',
    type: 'Departamento',
    operation: 'Venta',
    price: 145000,
    owner: 'Propietario Visual',
    status: 'Activa',
    bedrooms: 2,
    features: 'Balcón y cochera',
    paymentMethod: 'Contado',
    assignedToId: 1,
    createdById: 1,
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
    profileName: 'Corredor Visual',
    profileEmail: 'visual@example.test',
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
  throw new Error(`Servidor P1.4-A2.1 no disponible: ${String(lastError ?? 'sin respuesta')}`);
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
      accessToken: 'p1-4-a2-1-token',
      refreshToken: 'p1-4-a2-1-refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: accountUserId,
      email: 'visual@example.test',
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

async function openSelectedOpportunity(page: Page, baseUrl: string): Promise<void> {
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
  await page.locator('#propiedades [data-opportunity-property]').selectOption('41');
  await page.waitForSelector('#propiedades [data-opportunity-client="31"]', { state: 'visible', timeout: 10_000 });
  await page.locator('#propiedades .opportunity-page-heading').scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await removeEnvironmentNotice(page);
}

function launchVisualBrowser(t: TestContext): string {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chromium para P1.4-A2.1 visual QA.');
    t.skip('No hay Chrome/Chromium local.');
    return '';
  }
  return executable;
}

function overlap(a: RectMetrics, b: RectMetrics): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function assertVisualGeometry(page: Page, viewport: ViewportCase): Promise<void> {
  const metrics = await page.locator('#propiedades [data-property-opportunities]').evaluate((node) => {
    const plainRect = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const rect = (selector: string) => {
      const element = node.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Elemento visual faltante: ${selector}`);
      return plainRect(element);
    };
    const root = plainRect(node);
    const picker = rect('.opportunity-property-picker');
    const stepTitle = rect('#opportunity-property-step-title');
    const select = rect('[data-opportunity-property]');
    const summary = rect('.opportunity-property-summary');
    const summaryCopy = rect('.opportunity-property-summary-copy');
    const price = rect('.opportunity-property-price');
    const review = rect('.opportunity-review');
    const filters = rect('.opportunity-filters');
    const firstCard = rect('[data-opportunity-client="31"]');
    const badges = rect('[data-opportunity-client="31"] .opportunity-badges');
    const openButton = rect('[data-opportunity-client="31"] .opportunity-open-client');
    const srOnlyElement = node.querySelector<HTMLElement>('[data-opportunity-client="31"] .opportunity-selector .sr-only');
    if (!srOnlyElement) throw new Error('Texto accesible del selector faltante.');
    const srOnly = plainRect(srOnlyElement);
    const srOnlyStyle = getComputedStyle(srOnlyElement);
    const filterControls = [...node.querySelectorAll<HTMLElement>('.opportunity-filters input, .opportunity-filters select')]
      .filter((control) => control.offsetParent !== null)
      .map(plainRect);
    const selectedText = (node.querySelector<HTMLSelectElement>('[data-opportunity-property]')?.selectedOptions[0]?.textContent ?? '').trim();
    const selectStyle = getComputedStyle(node.querySelector<HTMLSelectElement>('[data-opportunity-property]')!);
    return {
      root,
      picker,
      stepTitle,
      select,
      summary,
      summaryCopy,
      price,
      review,
      filters,
      firstCard,
      badges,
      openButton,
      srOnly,
      srOnlyStyle: {
        position: srOnlyStyle.position,
        overflow: srOnlyStyle.overflow,
        whiteSpace: srOnlyStyle.whiteSpace,
      },
      filterControls,
      selectedText,
      selectStyle: {
        paddingRight: Number.parseFloat(selectStyle.paddingRight),
        lineHeight: selectStyle.lineHeight,
        textOverflow: selectStyle.textOverflow,
        whiteSpace: selectStyle.whiteSpace,
      },
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });

  const evidence = JSON.stringify({ viewport, metrics });
  assert.ok(metrics.root.left >= -1, evidence);
  assert.ok(metrics.root.right <= metrics.viewportWidth + 1, evidence);
  assert.ok(metrics.documentWidth <= metrics.viewportWidth + 1, evidence);
  assert.ok(metrics.select.height >= 43.5, evidence);
  assert.ok(metrics.select.width >= Math.min(250, viewport.width - 60), evidence);
  assert.ok(metrics.selectStyle.paddingRight >= 44, evidence);
  assert.equal(metrics.selectStyle.textOverflow, 'ellipsis', evidence);
  assert.equal(metrics.selectStyle.whiteSpace, 'nowrap', evidence);
  assert.match(metrics.selectedText, /Departamento premium con cochera doble/);
  assert.ok(metrics.select.top - metrics.stepTitle.bottom >= 11, evidence);
  assert.ok(metrics.summary.top - metrics.picker.bottom >= 16, evidence);
  assert.ok(metrics.review.top - metrics.summary.bottom >= 16, evidence);
  assert.ok(metrics.filters.top > metrics.review.top, evidence);
  assert.ok(metrics.firstCard.top > metrics.filters.top, evidence);
  assert.ok(metrics.badges.left >= metrics.firstCard.left - 1, evidence);
  assert.ok(metrics.badges.right <= metrics.firstCard.right + 1, evidence);
  assert.ok(metrics.openButton.height >= 43.5, evidence);
  assert.ok(metrics.filterControls.every((control) => control.height >= 43.5), evidence);
  assert.ok(metrics.srOnly.width <= 1.5 && metrics.srOnly.height <= 1.5, evidence);
  assert.equal(metrics.srOnlyStyle.position, 'absolute', evidence);
  assert.equal(metrics.srOnlyStyle.overflow, 'hidden', evidence);
  assert.equal(metrics.srOnlyStyle.whiteSpace, 'nowrap', evidence);

  if (viewport.width <= 640) {
    assert.ok(metrics.price.top - metrics.summaryCopy.bottom >= 10, evidence);
  } else {
    assert.equal(overlap(metrics.summaryCopy, metrics.price), false, evidence);
  }
}

test('P1.4-A2.1 visual browser: jerarquía y legibilidad reales en desktop y mobile', { timeout: 240_000 }, async (t) => {
  const executable = launchVisualBrowser(t);
  if (!executable) return;
  rmSync(visualDir, { recursive: true, force: true });
  mkdirSync(visualDir, { recursive: true });

  const server = await startServer(4334);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  try {
    for (const viewport of viewports) {
      const context = await createContext(browser, viewport);
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      try {
        await openSelectedOpportunity(page, 'http://127.0.0.1:4334');
        await assertVisualGeometry(page, viewport);
        assert.deepEqual(pageErrors, []);

        await page.screenshot({
          path: resolve(visualDir, `${viewport.name}.png`),
          fullPage: false,
        });
        if (viewport.primary) {
          await page.locator('#propiedades [data-property-opportunities]').screenshot({
            path: resolve(visualDir, `${viewport.name}-full-component.png`),
          });
        }
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
