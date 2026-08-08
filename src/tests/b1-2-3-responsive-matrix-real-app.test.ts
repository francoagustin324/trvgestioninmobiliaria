import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { localIsoDate } from '../lead-pipeline.js';
import { initialData, type Client, type CrmData } from '../models.js';

const repositoryRoot = process.cwd();
const artifactDirectory = join(repositoryRoot, 'artifacts', 'b1-2-3-responsive-matrix');
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
  { width: 1440, height: 900 },
];
const mobileUserAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

function isoOffset(days: number): string {
  const date = new Date(`${localIsoDate()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function lead(id: number, overrides: Partial<Client>): Client {
  return {
    id,
    name: `Lead ${id}`,
    phone: `549351555${String(id).padStart(4, '0')}`,
    email: `lead${id}@example.test`,
    interest: 'Departamento en Córdoba',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function responsiveCrm(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: 'b1-2-3-responsive-org',
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Validación responsive',
  };
  crm.teamMembers = [{
    id: 1,
    userId: 'b1-2-3-responsive-owner',
    name: 'trvgestioninmobiliaria',
    email: 'franco.solis@example.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-07-01T12:00:00.000Z',
  }];
  crm.clients = [
    lead(1, {
      name: 'Seguimiento prioritario',
      interest: 'Dúplex en Docta con financiación',
      temperature: 'Caliente',
      pipeline: 'Visita coordinada',
      lastContact: isoOffset(-6),
      nextAction: 'Confirmar visita y condiciones de financiación',
      nextFollowUp: isoOffset(-2),
      budget: 'USD 146.000',
      currency: 'USD',
      paymentMethod: 'Financiación',
      zones: 'Docta',
      purpose: 'Vivir',
      purchaseTimeframe: '0-3 meses',
      urgency: 'Alta',
      canMoveForward: 'Sí',
      knowsArea: 'Sí',
      preferences: 'Entrega y cuotas claras',
      notes: 'Priorizar contacto hoy.',
      qualificationUpdatedAt: new Date().toISOString(),
    }),
    lead(2, {
      name: 'Cliente calificado',
      interest: 'Departamento apto crédito en Nueva Córdoba',
      temperature: 'Tibio',
      pipeline: 'Calificado',
      budget: 'USD 120.000',
      currency: 'USD',
      paymentMethod: 'Crédito hipotecario',
      creditPossible: 'Aprobado',
      creditApprovedAmount: 'USD 80.000',
      zones: 'Nueva Córdoba',
      purpose: 'Vivir',
      purchaseTimeframe: '3-6 meses',
      canMoveForward: 'Sí',
    }),
  ];
  crm.properties = [{
    id: 1,
    title: 'Dúplex compatible en Docta',
    address: 'Docta, Córdoba',
    type: 'Dúplex',
    operation: 'Venta',
    price: 146000,
    owner: 'Constructor de prueba',
    status: 'Activa',
    bedrooms: 2,
    bathrooms: 2,
    paymentMethod: 'Entrega y cuotas',
    features: 'Patio, cochera y calefacción central',
    assignedToId: 1,
    createdById: 1,
  }];
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

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('No se pudo reservar un puerto local para la prueba visual.'));
        return;
      }
      const port = address.port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

async function waitForServer(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`El servidor visual no quedó disponible: ${String(lastError ?? 'sin respuesta')}`);
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
  const mobile = viewport.width <= 430;
  const touch = viewport.width <= 720;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 3 : touch ? 2 : 1,
    hasTouch: touch,
    isMobile: mobile,
    userAgent: mobile ? mobileUserAgent : undefined,
    locale: 'es-AR',
    colorScheme: 'dark',
  });
  const crm = responsiveCrm();
  await context.addInitScript(({ data, userId }) => {
    const storageKey = `trv-crm-basico:user:${userId}`;
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'responsive-access-token',
      refreshToken: 'responsive-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      userId,
      email: 'franco.solis@example.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(data));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: new Date().toISOString(),
      lastCloudSavedAt: new Date().toISOString(),
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { data: crm, userId: 'b1-2-3-responsive-owner' });
  return context;
}

async function waitForLeads(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-compact-card', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-compact-card').length === 2);
}

async function validateClosedState(page: Page, viewport: { width: number; height: number }): Promise<number> {
  const metrics = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')];
    const first = cards[0]!;
    const controls = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card button, #crm .mvp-lead-compact-card a.mvp-contact-btn, #crm .mvp-lead-compact-card summary, #crm .mvp-lead-more-filters > summary')]
      .filter((control) => control.getClientRects().length > 0)
      .map((control) => {
        const rect = control.getBoundingClientRect();
        return { label: control.textContent?.trim() || control.getAttribute('aria-label') || '', width: rect.width, height: rect.height };
      });
    const auto = first.querySelector<HTMLElement>('.mvp-lead-actions-menu > summary')!;
    const selected = document.querySelector<HTMLElement>('#crm .mvp-stage-counter.active')!;
    const pipeline = document.querySelector<HTMLElement>('#crm .mvp-stage-counters')!;
    const selectedRect = selected.getBoundingClientRect();
    const pipelineRect = pipeline.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      closedHeight: first.getBoundingClientRect().height,
      cardsInside: cards.every((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= window.innerWidth + 1;
      }),
      oneAlert: cards.every((card) => card.querySelectorAll('.mvp-lead-alert').length === 1),
      openSheets: document.querySelectorAll('#crm .mvp-lead-full-sheet[open]').length,
      controls,
      autoText: auto.textContent?.trim() || '',
      autoNotClipped: auto.scrollWidth <= auto.clientWidth + 1 && auto.scrollHeight <= auto.clientHeight + 1,
      selectedVisible: selectedRect.left >= pipelineRect.left - 2 && selectedRect.right <= pipelineRect.right + 2,
      pipelineFlow: getComputedStyle(pipeline).flexWrap,
    };
  });
  assert.ok(metrics.documentWidth <= metrics.viewport + 1, `Scroll horizontal en ${viewport.width}x${viewport.height}: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.bodyWidth <= metrics.viewport + 1);
  assert.equal(metrics.cardsInside, true);
  assert.equal(metrics.oneAlert, true);
  assert.equal(metrics.openSheets, 0);
  assert.equal(metrics.autoText, '•••');
  assert.equal(metrics.autoNotClipped, true, `Menú de acciones truncado en ${viewport.width}px.`);
  assert.equal(metrics.selectedVisible, true);
  assert.equal(metrics.pipelineFlow, 'nowrap');
  assert.ok(metrics.controls.every((control) => control.width >= 43.5 && control.height >= 43.5), `Control menor a 44px en ${viewport.width}px: ${JSON.stringify(metrics.controls)}`);
  return metrics.closedHeight;
}

async function openZeroTrainingDetails(card: ReturnType<Page['locator']>): Promise<void> {
  const sheet = card.locator('.mvp-lead-full-sheet');
  if (await sheet.getAttribute('open') !== null) return;
  await card.locator('.mvp-lead-actions-menu > summary').click();
  await card.getByRole('button', { name: 'Ver detalles', exact: true }).click();
}

async function validateExpandedState(page: Page, closedHeight: number): Promise<void> {
  const firstCard = page.locator('#crm .mvp-lead-compact-card').nth(0);
  await openZeroTrainingDetails(firstCard);
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-full-sheet[open]').length === 1);
  const openText = await page.locator('#crm .mvp-lead-full-sheet[open]').innerText();
  assert.match(openText, /Franco Solís/);
  assert.doesNotMatch(openText, /trvgestioninmobiliaria/i);
  const expandedHeight = await firstCard.evaluate((card) => card.getBoundingClientRect().height);
  assert.ok(expandedHeight > closedHeight + 80, `La ficha abierta no creció lo suficiente: cerrada ${closedHeight}, abierta ${expandedHeight}.`);
  const secondCard = page.locator('#crm .mvp-lead-compact-card').nth(1);
  await openZeroTrainingDetails(secondCard);
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-full-sheet[open]').length === 1);
  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').getAttribute('data-lead-full-sheet'), '2');
  await page.locator('#crm .mvp-lead-full-sheet[open]').evaluate((element: HTMLDetailsElement) => { element.open = false; });
  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 0);
}

async function validateFollowUpPopover(page: Page): Promise<void> {
  const card = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'Seguimiento prioritario' });
  await openZeroTrainingDetails(card);
  await card.locator('.mvp-lead-followup-menu > summary').click();
  const button = card.locator('[data-complete-client-follow-up]');
  await button.waitFor({ state: 'visible' });
  const hit = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return target === element || element.contains(target);
  });
  assert.equal(hit, true, 'El popover de seguimiento quedó detrás de otro elemento.');
  await card.locator('.mvp-lead-followup-menu').evaluate((details: HTMLDetailsElement) => { details.open = false; });
}

async function validateBottomClearance(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(50);
  const clearance = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');
    if (!nav || getComputedStyle(nav).display === 'none') return { visible: false, clear: true };
    const cards = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')];
    const last = cards.at(-1);
    return { visible: true, clear: Boolean(last && last.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top - 4) };
  });
  if (clearance.visible) assert.equal(clearance.clear, true, 'La barra inferior tapa la última tarjeta.');
}

async function validateFocus(page: Page): Promise<void> {
  const button = page.locator('#crm .mvp-lead-compact-card').first().locator('.mvp-lead-actions-menu > summary');
  await button.focus();
  const focus = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      active: document.activeElement === element,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      boxShadow: style.boxShadow,
    };
  });
  assert.equal(focus.active, true);
  assert.ok((focus.outlineStyle !== 'none' && focus.outlineWidth >= 2) || focus.boxShadow !== 'none', `Foco no visible: ${JSON.stringify(focus)}`);
}

async function validateAutomaticPanel(page: Page): Promise<void> {
  const card = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'Cliente calificado' });
  await card.locator('.mvp-lead-actions-menu > summary').click();
  await card.getByRole('button', { name: 'Completar datos con IA', exact: true }).click();
  const panel = page.locator('#crm .lead-qualification-panel');
  await panel.waitFor({ state: 'visible' });
  const geometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      documentWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });
  assert.ok(geometry.left >= -1 && geometry.right <= geometry.viewport + 1, JSON.stringify(geometry));
  assert.ok(geometry.documentWidth <= geometry.viewport + 1);
  await panel.locator('[data-close-qualification]').click();
}

function verifyScreenshots(): void {
  const expected = viewports.map(({ width, height }) => `leads-${width}x${height}.png`).sort();
  const actual = readdirSync(artifactDirectory).filter((name) => name.endsWith('.png')).sort();
  assert.deepEqual(actual, expected);
  for (const name of actual) {
    const path = join(artifactDirectory, name);
    const buffer = readFileSync(path);
    assert.ok(statSync(path).size > 8_000, `${name} parece vacío.`);
    assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
}

test('B1.2.3 valida la matriz responsive completa con la aplicación real', { timeout: 300_000 }, async (t) => {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chrome para validar B1.2.3.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }

  rmSync(artifactDirectory, { recursive: true, force: true });
  mkdirSync(artifactDirectory, { recursive: true });
  const port = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });

  try {
    for (const viewport of viewports) {
      const context = await createContext(browser, viewport);
      const page = await context.newPage();
      try {
        await waitForLeads(page, baseUrl);
        const closedHeight = await validateClosedState(page, viewport);
        await validateFocus(page);
        await page.screenshot({ path: join(artifactDirectory, `leads-${viewport.width}x${viewport.height}.png`), fullPage: false, scale: 'css' });
        await validateExpandedState(page, closedHeight);
        await validateFollowUpPopover(page);
        await validateBottomClearance(page);
        if (viewport.width === 390 || viewport.width === 1440) await validateAutomaticPanel(page);
      } finally {
        await page.close();
        await context.close();
      }
    }
    verifyScreenshots();
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
