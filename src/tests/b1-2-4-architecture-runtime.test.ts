import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type Client, type CommercialStage, type CrmData } from '../models.js';

const root = process.cwd();
const mobileUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

function chromePath(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

function lead(id: number, pipeline: CommercialStage, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name: `Lead arquitectura ${id}`,
    phone: `549351555${String(id).padStart(4, '0')}`,
    email: `arquitectura${id}@example.test`,
    interest: 'Departamento en Córdoba',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline,
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function crmFixture(): CrmData {
  const crm = structuredClone(initialData);
  const stages: CommercialStage[] = [
    'Nuevo',
    'Contactado',
    'Calificado',
    'Visita coordinada',
    'Negociación',
    'Reservado',
    'Ganado',
    'Perdido',
    'Nuevo',
    'Contactado',
    'Calificado',
  ];
  crm.organization = { id: 'b124-architecture', name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'B1.2.4' };
  crm.teamMembers = [{
    id: 1,
    userId: 'b124-owner',
    name: 'Franco Solís',
    email: 'franco.solis@example.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-07-01T12:00:00.000Z',
  }];
  crm.clients = stages.map((stage, index) => lead(index + 1, stage, index === 1 ? {
    name: 'Lead completo de arquitectura',
    budget: 'USD 146.000',
    currency: 'USD',
    paymentMethod: 'Financiación',
    purchaseTimeframe: '0-3 meses',
    nextAction: 'Confirmar propuesta',
    nextFollowUp: '2026-08-01',
  } : {}));
  crm.properties = [];
  crm.activityLog = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.settings = {
    ...crm.settings,
    profileName: 'Franco Solís',
    profileEmail: 'franco.solis@example.test',
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
}

async function waitServer(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Servidor B1.2.4 no disponible: ${String(lastError ?? 'sin respuesta')}`);
}

async function startServer(port: number): Promise<ChildProcess> {
  const processHandle = spawn(process.execPath, ['dist/server.js'], {
    cwd: root,
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
  return processHandle;
}

async function stopServer(processHandle: ChildProcess): Promise<void> {
  if (processHandle.exitCode !== null) return;
  processHandle.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (processHandle.exitCode === null) processHandle.kill('SIGKILL');
      resolve();
    }, 2_000);
    processHandle.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function contextFor(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    userAgent: mobileUa,
    locale: 'es-AR',
    colorScheme: 'dark',
  });
  await context.addInitScript(({ data }) => {
    const userId = 'b124-owner';
    const key = `trv-crm-basico:user:${userId}`;
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'b124-token',
      refreshToken: 'b124-refresh',
      expiresAt: Date.now() + 3_600_000,
      userId,
      email: 'franco.solis@example.test',
    }));
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(`${key}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: new Date().toISOString(),
      lastCloudSavedAt: new Date().toISOString(),
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { data: crmFixture() });
  return context;
}

async function loadLeads(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-compact-card', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-compact-card').length === 11);
  await page.waitForTimeout(120);
}

async function newLeadParent(page: Page): Promise<string> {
  return page.locator('#crm [data-toggle="client-form"]').evaluate((button) => button.parentElement?.className || '');
}

async function validateIdempotentBindings(page: Page): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('trv-render')));
  }
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-compact-card').length === 11);
  await page.waitForTimeout(80);

  const result = await page.evaluate(async () => {
    const module = await import(`${location.origin}/dist/lead-list-polish-ui.js`);
    const container = document.querySelector<HTMLElement>('#crm')!;
    const track = container.querySelector<HTMLElement>('.mvp-stage-counters')!;
    let scrollByCalls = 0;
    const nativeScrollBy = track.scrollBy.bind(track);
    Object.defineProperty(track, 'scrollBy', {
      configurable: true,
      value: (options: ScrollToOptions) => {
        scrollByCalls += 1;
        nativeScrollBy(options);
      },
    });
    for (let index = 0; index < 10; index += 1) module.enhanceLeadList(container);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    track.scrollLeft = 0;
    track.dispatchEvent(new WheelEvent('wheel', { deltaY: 23, bubbles: true, cancelable: true }));
    return {
      scrollByCalls,
      bound: track.dataset.b124Bound ?? null,
      documentWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });

  assert.equal(result.scrollByCalls, 1, `El pipeline recibió listeners duplicados: ${JSON.stringify(result)}`);
  assert.equal(result.documentWidth <= result.viewport + 1, true);
}

async function validateBreakpointsAndButton(page: Page): Promise<void> {
  assert.match(await newLeadParent(page), /mvp-page-heading/);

  await page.setViewportSize({ width: 720, height: 1024 });
  await page.waitForTimeout(80);
  assert.match(await newLeadParent(page), /mvp-page-heading/);

  await page.setViewportSize({ width: 901, height: 768 });
  await page.waitForFunction(() => document.querySelector('#crm [data-toggle="client-form"]')?.parentElement?.classList.contains('mvp-lead-filter-primary'));
  assert.match(await newLeadParent(page), /mvp-lead-filter-primary/);

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForTimeout(80);
  assert.match(await newLeadParent(page), /mvp-lead-filter-primary/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('#crm [data-toggle="client-form"]')?.parentElement?.classList.contains('mvp-page-heading'));
  assert.match(await newLeadParent(page), /mvp-page-heading/);

  await page.locator('#crm [data-toggle="client-form"]').click();
  await page.waitForSelector('#mvp-lead-form:not(.collapsed)', { state: 'visible' });
  await page.locator('#crm [data-toggle="client-form"]').click();
  await page.waitForFunction(() => document.querySelector('#mvp-lead-form')?.classList.contains('collapsed'));
}

async function validatePipelineInputs(page: Page): Promise<void> {
  const track = page.locator('#crm .mvp-stage-counters');
  assert.equal(await track.evaluate((element) => getComputedStyle(element).touchAction), 'pan-x pan-y');

  const calificado = page.locator('#crm [data-stage-quick="Calificado"]');
  const box = await calificado.boundingBox();
  assert.ok(box);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => document.querySelector('#crm .mvp-stage-counter.active')?.textContent?.includes('Calificado'));
  await page.locator('#crm [data-stage-quick="Todas"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-compact-card').length === 11);

  const refreshed = page.locator('#crm .mvp-stage-counters');
  await refreshed.evaluate((element) => element.scrollTo({ left: 0, behavior: 'instant' }));
  await refreshed.hover();
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(60);
  assert.ok(await refreshed.evaluate((element) => element.scrollLeft > 0));

  await refreshed.focus();
  await refreshed.press('End');
  await page.waitForTimeout(60);
  assert.equal(await page.locator('#crm .mvp-stage-counter').last().evaluate((element) => document.activeElement === element), true);
  await refreshed.press('Home');
  await page.waitForTimeout(60);
  assert.equal(await page.locator('#crm .mvp-stage-counter').first().evaluate((element) => document.activeElement === element), true);
}

test('B1.2.4 inicializa Leads sin observadores globales ni listeners duplicados', { timeout: 180_000 }, async (t) => {
  const executable = chromePath();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chrome para la prueba arquitectónica B1.2.4.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }

  const port = 49_200 + Math.floor(Math.random() * 500);
  let server: ChildProcess | null = null;
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    server = await startServer(port);
    browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
    context = await contextFor(browser);
    page = await context.newPage();
    await loadLeads(page, `http://127.0.0.1:${port}`);
    await validateIdempotentBindings(page);
    await validateBreakpointsAndButton(page);
    await validatePipelineInputs(page);

    const labels = await page.evaluate(() => ({
      desktop: [...document.querySelectorAll<HTMLElement>('.mvp-sidebar .nav-label')].map((element) => element.textContent?.trim()),
      mobile: [...document.querySelectorAll<HTMLElement>('.mobile-bottom-nav .nav-label')].map((element) => element.textContent?.trim()),
      horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    }));
    assert.deepEqual(labels.desktop, ['Leads', 'Chats', 'Agenda', 'Propiedades', 'Equipo', 'Configuración']);
    assert.deepEqual(labels.mobile, ['Leads', 'Chats', 'Agenda', 'Propiedades', 'Equipo']);
    assert.equal(labels.horizontalScroll, false);
  } finally {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    if (server) await stopServer(server);
  }
});
