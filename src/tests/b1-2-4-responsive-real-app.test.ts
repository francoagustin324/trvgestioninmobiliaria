import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { localIsoDate } from '../lead-pipeline.js';
import { initialData, type Client, type CrmData } from '../models.js';

const repositoryRoot = process.cwd();
const mandatoryBase = '34182f1b2174d86dd884014f2110eadebb838a03';
const artifactDirectory = join(repositoryRoot, 'artifacts', 'b1-2-4-visual-review');
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 720, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
] as const;
const scenarios = ['normal', 'lead-vacio', 'lead-completo', 'filtros', 'ficha', 'seguimiento'] as const;
const mobileUserAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

interface VisualMetric {
  version: 'before' | 'after';
  viewport: string;
  filterHeight: number;
  emptyCardHeight: number;
  completeCardHeight: number;
  visibleCards: number;
}

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

function visualCrm(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: 'b1-2-4-visual-org',
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Validación visual B1.2.4',
  };
  crm.teamMembers = [{
    id: 1,
    userId: 'b1-2-4-visual-owner',
    name: 'trvgestioninmobiliaria',
    email: 'franco.solis@example.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-07-01T12:00:00.000Z',
  }];
  crm.clients = [
    lead(1, {
      name: 'Grupo Norte',
      interest: 'Propiedad comercial para inversión',
      pipeline: 'Nuevo',
      nextAction: 'Definir acción',
      nextFollowUp: isoOffset(-38),
      email: 'grupo.norte@example.test',
    }),
    lead(2, {
      name: 'María Fernanda Rodríguez — búsqueda completa',
      interest: 'Dúplex premium en Docta con financiación y entrega inmediata',
      temperature: 'Caliente',
      pipeline: 'Calificado',
      nextAction: 'Enviar propuesta final y confirmar disponibilidad',
      nextFollowUp: isoOffset(2),
      budget: 'USD 146.000',
      currency: 'USD',
      paymentMethod: 'Financiación',
      creditPossible: 'No necesita',
      purchaseTimeframe: '0-3 meses',
      urgency: 'Alta',
      zones: 'Docta',
      purpose: 'Vivir',
      knowsArea: 'Sí',
      canMoveForward: 'Sí',
      preferences: 'Dos dormitorios, patio, cochera y calefacción central.',
      features: 'Acepta entrega de USD 110.000 y doce cuotas.',
      notes: 'Cliente listo para recibir documentación completa.',
      qualificationUpdatedAt: new Date().toISOString(),
    }),
    lead(3, {
      name: 'Seguimiento vencido',
      temperature: 'Caliente',
      nextAction: 'Llamar para definir visita',
      nextFollowUp: isoOffset(-5),
      budget: 'USD 110.000',
      currency: 'USD',
      paymentMethod: 'Contado',
    }),
    lead(4, {
      name: 'Visita coordinada',
      pipeline: 'Visita coordinada',
      nextAction: 'Visita hoy a las 17:30',
      nextFollowUp: isoOffset(0),
      budget: 'USD 120.000',
      currency: 'USD',
      paymentMethod: 'Crédito hipotecario',
      purchaseTimeframe: '0-3 meses',
    }),
    lead(5, {
      name: 'Operación ganada',
      pipeline: 'Ganado',
      temperature: 'Caliente',
      budget: 'USD 148.000',
      currency: 'USD',
      paymentMethod: 'Contado',
      purchaseTimeframe: 'Inmediato',
    }),
    lead(6, {
      name: 'Operación perdida',
      pipeline: 'Perdido',
      temperature: 'Frío',
      budget: 'USD 85.000',
      currency: 'USD',
      paymentMethod: 'Contado',
      purchaseTimeframe: '0-3 meses',
    }),
    lead(7, { name: 'Consulta nueva sin contactar', pipeline: 'Nuevo', lastContact: undefined }),
    lead(8, { name: 'Lead contactado', pipeline: 'Contactado', lastContact: isoOffset(-1), purchaseTimeframe: '3-6 meses' }),
    lead(9, { name: 'Lead calificado', pipeline: 'Calificado', budget: 'USD 100.000', currency: 'USD', paymentMethod: 'Contado' }),
    lead(10, { name: 'Negociación activa', pipeline: 'Negociación', nextAction: 'Revisar oferta', nextFollowUp: isoOffset(1) }),
    lead(11, { name: 'Reserva pendiente', pipeline: 'Reservado', nextAction: 'Confirmar documentación', nextFollowUp: isoOffset(3) }),
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
  crm.activityLog = [{
    id: 1,
    actorId: 1,
    action: 'Seguimiento registrado',
    entityType: 'Cliente',
    entityId: 2,
    detail: 'Se confirmó presupuesto y forma de pago.',
    createdAt: new Date().toISOString(),
  }];
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

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

async function waitForServer(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
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

async function startServer(cwd: string, port: number): Promise<ChildProcess> {
  const server = spawn(process.execPath, ['dist/server.js'], {
    cwd,
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

function ensureCommitAvailable(): void {
  try {
    execFileSync('git', ['cat-file', '-e', `${mandatoryBase}^{commit}`], { cwd: repositoryRoot, stdio: 'ignore' });
  } catch {
    execFileSync('git', ['fetch', '--depth=1', 'origin', mandatoryBase], { cwd: repositoryRoot, stdio: 'inherit' });
  }
}

function prepareBaselineWorktree(): { directory: string; cleanup: () => void } {
  ensureCommitAvailable();
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'propcontrol-b1-2-4-'));
  const directory = join(temporaryRoot, 'before');
  execFileSync('git', ['worktree', 'add', '--detach', directory, mandatoryBase], { cwd: repositoryRoot, stdio: 'inherit' });
  symlinkSync(join(repositoryRoot, 'node_modules'), join(directory, 'node_modules'), 'dir');
  execFileSync(process.execPath, [join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(directory, 'tsconfig.json')], {
    cwd: directory,
    stdio: 'inherit',
  });
  return {
    directory,
    cleanup: () => {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', directory], { cwd: repositoryRoot, stdio: 'ignore' });
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    },
  };
}

async function createContext(browser: Browser, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const mobile = viewport.width <= 430;
  const touch = viewport.width <= 720;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: touch,
    isMobile: mobile,
    userAgent: mobile ? mobileUserAgent : undefined,
    locale: 'es-AR',
    colorScheme: 'dark',
  });
  const crm = visualCrm();
  await context.addInitScript(({ data, userId }) => {
    const storageKey = `trv-crm-basico:user:${userId}`;
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'b1-2-4-access-token',
      refreshToken: 'b1-2-4-refresh-token',
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
  }, { data: crm, userId: 'b1-2-4-visual-owner' });
  return context;
}

async function waitForLeads(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-compact-card', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-compact-card').length === 11);
  await page.waitForTimeout(100);
}

function screenshotPath(version: 'before' | 'after', scenario: typeof scenarios[number], viewport: { width: number; height: number }): string {
  return join(artifactDirectory, `${version}-${scenario}-${viewport.width}x${viewport.height}.png`);
}

async function capture(page: Page, version: 'before' | 'after', scenario: typeof scenarios[number], viewport: { width: number; height: number }): Promise<void> {
  await page.waitForTimeout(40);
  await page.screenshot({ path: screenshotPath(version, scenario, viewport), fullPage: false, scale: 'css' });
}

async function captureScenarios(page: Page, version: 'before' | 'after', viewport: { width: number; height: number }): Promise<void> {
  await page.locator('#crm .mvp-lead-filter-panel').scrollIntoViewIfNeeded();
  await capture(page, version, 'normal', viewport);

  const empty = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'Grupo Norte' });
  await empty.scrollIntoViewIfNeeded();
  await capture(page, version, 'lead-vacio', viewport);

  const complete = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'María Fernanda Rodríguez' });
  await complete.scrollIntoViewIfNeeded();
  await capture(page, version, 'lead-completo', viewport);

  const filters = page.locator('#crm .mvp-lead-more-filters');
  const filterSummary = filters.locator(':scope > summary');
  if (await filterSummary.isVisible() && !(await filters.evaluate((element: HTMLDetailsElement) => element.open))) await filterSummary.click();
  await page.locator('#crm .mvp-lead-filter-panel').scrollIntoViewIfNeeded();
  await capture(page, version, 'filtros', viewport);

  const sheet = complete.locator('.mvp-lead-full-sheet');
  if (!(await sheet.evaluate((element: HTMLDetailsElement) => element.open))) await sheet.locator(':scope > summary').click();
  await complete.scrollIntoViewIfNeeded();
  await capture(page, version, 'ficha', viewport);
  await sheet.locator(':scope > summary').click();

  const overdue = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'Seguimiento vencido' });
  const menu = overdue.locator('.mvp-lead-followup-menu');
  await menu.locator(':scope > summary').click();
  await overdue.scrollIntoViewIfNeeded();
  await capture(page, version, 'seguimiento', viewport);
  await menu.evaluate((element: HTMLDetailsElement) => { element.open = false; });
}

async function collectMetric(page: Page, version: 'before' | 'after', viewport: { width: number; height: number }): Promise<VisualMetric> {
  return page.evaluate(({ versionValue, viewportValue }) => {
    const panel = document.querySelector<HTMLElement>('#crm .mvp-lead-filter-panel')!;
    const empty = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')].find((card) => card.textContent?.includes('Grupo Norte'))!;
    const complete = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')].find((card) => card.textContent?.includes('María Fernanda Rodríguez'))!;
    const visibleCards = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')]
      .filter((card) => card.getBoundingClientRect().top < window.innerHeight).length;
    return {
      version: versionValue,
      viewport: viewportValue,
      filterHeight: Math.round(panel.getBoundingClientRect().height),
      emptyCardHeight: Math.round(empty.getBoundingClientRect().height),
      completeCardHeight: Math.round(complete.getBoundingClientRect().height),
      visibleCards,
    };
  }, { versionValue: version, viewportValue: `${viewport.width}x${viewport.height}` });
}

async function validateNavigation(page: Page): Promise<void> {
  const labels = await page.evaluate(() => ({
    desktop: [...document.querySelectorAll<HTMLElement>('.mvp-sidebar .nav-label')].map((item) => item.textContent?.trim()),
    mobile: [...document.querySelectorAll<HTMLElement>('.mobile-bottom-nav .nav-label')].map((item) => item.textContent?.trim()),
  }));
  assert.deepEqual(labels.desktop, ['Leads', 'Chats', 'Agenda', 'Propiedades', 'Equipo', 'Configuración']);
  assert.deepEqual(labels.mobile, ['Leads', 'Chats', 'Agenda', 'Propiedades', 'Equipo']);
}

async function validateGeneralGeometry(page: Page, viewport: { width: number; height: number }): Promise<VisualMetric> {
  const metrics = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('#crm .mvp-lead-filter-panel')!;
    const panelRect = panel.getBoundingClientRect();
    const children = [...panel.children].filter((child): child is HTMLElement => child instanceof HTMLElement && getComputedStyle(child).display !== 'none');
    const contentBottom = Math.max(...children.map((child) => child.getBoundingClientRect().bottom));
    const cards = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')];
    const empty = cards.find((card) => card.textContent?.includes('Grupo Norte'))!;
    const complete = cards.find((card) => card.textContent?.includes('María Fernanda Rodríguez'))!;
    const controls = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card button, #crm .mvp-lead-compact-card a.mvp-contact-btn, #crm .mvp-lead-compact-card summary, #crm .mvp-lead-more-filters > summary')]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.textContent?.trim() || element.getAttribute('aria-label') || '', width: rect.width, height: rect.height };
      });
    const newButton = document.querySelector<HTMLElement>('#crm [data-toggle="client-form"]')!;
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      panelHeight: panelRect.height,
      panelUnusedBottom: panelRect.bottom - contentBottom,
      emptyHeight: empty.getBoundingClientRect().height,
      completeHeight: complete.getBoundingClientRect().height,
      cardsInside: cards.every((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= window.innerWidth + 1;
      }),
      newButtonParent: newButton.parentElement?.className || '',
      controls,
      summaryCount: empty.querySelectorAll('.mvp-lead-missing-summary').length,
      oldMissingFacts: empty.querySelectorAll('.mvp-lead-fact').length,
      autoText: empty.querySelector<HTMLElement>('.mvp-auto-qualify-button')?.textContent?.trim(),
    };
  });

  assert.ok(metrics.documentWidth <= metrics.viewport + 1, `Scroll horizontal en ${viewport.width}x${viewport.height}: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.bodyWidth <= metrics.viewport + 1);
  assert.equal(metrics.cardsInside, true);
  assert.equal(metrics.summaryCount, 1);
  assert.equal(metrics.oldMissingFacts, 0);
  assert.equal(metrics.autoText, 'Calificar automáticamente');
  assert.ok(metrics.panelUnusedBottom <= 24, `Espacio vacío excesivo en filtros: ${JSON.stringify(metrics)}`);

  if (viewport.width > 900) {
    assert.ok(metrics.panelHeight >= 175 && metrics.panelHeight <= 255, `Altura de filtros fuera de objetivo: ${JSON.stringify(metrics)}`);
    assert.match(metrics.newButtonParent, /mvp-lead-filter-primary/);
  } else {
    assert.doesNotMatch(metrics.newButtonParent, /mvp-lead-filter-primary/);
    assert.ok(metrics.controls.every((control) => control.width >= 43.5 && control.height >= 43.5), `Control menor a 44px en ${viewport.width}px: ${JSON.stringify(metrics.controls)}`);
  }

  if (viewport.width === 390) {
    assert.ok(metrics.emptyHeight >= 300 && metrics.emptyHeight <= 380, `Lead casi vacío fuera del objetivo: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.completeHeight >= 340 && metrics.completeHeight <= 460, `Lead completo fuera del objetivo: ${JSON.stringify(metrics)}`);
  }

  return {
    version: 'after',
    viewport: `${viewport.width}x${viewport.height}`,
    filterHeight: Math.round(metrics.panelHeight),
    emptyCardHeight: Math.round(metrics.emptyHeight),
    completeCardHeight: Math.round(metrics.completeHeight),
    visibleCards: await page.locator('#crm .mvp-lead-compact-card').evaluateAll((cards) => cards.filter((card) => card.getBoundingClientRect().top < window.innerHeight).length),
  };
}

async function validatePipeline(page: Page, viewport: { width: number; height: number }): Promise<void> {
  const counters = page.locator('#crm .mvp-stage-counters');
  const shell = page.locator('#crm [data-stage-shell]');
  await counters.scrollIntoViewIfNeeded();
  await counters.evaluate((element) => element.scrollTo({ left: 0, behavior: 'instant' }));
  await page.waitForTimeout(50);
  const start = await shell.evaluate((element) => ({
    left: element.getAttribute('data-overflow-left'),
    right: element.getAttribute('data-overflow-right'),
    beforeOpacity: getComputedStyle(element, '::before').opacity,
    afterOpacity: getComputedStyle(element, '::after').opacity,
  }));
  assert.equal(start.left, 'false');
  assert.equal(start.beforeOpacity, '0');
  assert.equal(start.afterOpacity === '1', start.right === 'true');

  const overflow = await counters.evaluate((element) => element.scrollWidth > element.clientWidth + 2);
  if (overflow) {
    await counters.hover();
    await page.mouse.wheel(0, 160);
    await page.waitForTimeout(80);
    assert.ok(await counters.evaluate((element) => element.scrollLeft > 0), `La rueda no desplazó el pipeline en ${viewport.width}px.`);
    await counters.press('End');
    await page.waitForTimeout(120);
    const end = await shell.evaluate((element) => ({
      left: element.getAttribute('data-overflow-left'),
      right: element.getAttribute('data-overflow-right'),
      beforeOpacity: getComputedStyle(element, '::before').opacity,
      afterOpacity: getComputedStyle(element, '::after').opacity,
    }));
    assert.equal(end.left, 'true');
    assert.equal(end.right, 'false');
    assert.equal(end.beforeOpacity, '1');
    assert.equal(end.afterOpacity, '0');
  }

  await page.locator('#crm .mvp-stage-counter', { hasText: 'Calificado' }).click();
  await page.waitForFunction(() => document.querySelector('#crm .mvp-stage-counter.active')?.textContent?.includes('Calificado'));
  const selected = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>('#crm .mvp-stage-counter.active')!;
    const track = document.querySelector<HTMLElement>('#crm .mvp-stage-counters')!;
    const buttonRect = button.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    return { visible: buttonRect.left >= trackRect.left - 1 && buttonRect.right <= trackRect.right + 1, documentWidth: document.documentElement.scrollWidth, viewport: window.innerWidth };
  });
  assert.equal(selected.visible, true, `El chip seleccionado no quedó completamente visible: ${JSON.stringify(selected)}`);
  assert.ok(selected.documentWidth <= selected.viewport + 1);
  await page.locator('#crm .mvp-stage-counter', { hasText: /^Todos/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-compact-card').length === 11);
}

async function validatePopoverAndSheet(page: Page): Promise<void> {
  const complete = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'María Fernanda Rodríguez' });
  await complete.locator('.mvp-lead-full-sheet > summary').click();
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-full-sheet[open]').length === 1);
  const fullText = await page.locator('#crm .mvp-lead-full-sheet[open]').innerText();
  assert.match(fullText, /Franco Solís/);
  assert.match(fullText, /propiedad compatible/i);
  await complete.locator('.mvp-lead-full-sheet > summary').click();

  const overdue = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'Seguimiento vencido' });
  await overdue.locator('.mvp-lead-followup-menu > summary').click();
  const completeButton = overdue.locator('[data-complete-client-follow-up]');
  await completeButton.waitFor({ state: 'visible' });
  const hit = await completeButton.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return target === element || element.contains(target);
  });
  assert.equal(hit, true, 'El popover de seguimiento quedó detrás de otra tarjeta.');
  await overdue.locator('.mvp-lead-followup-menu').evaluate((element: HTMLDetailsElement) => { element.open = false; });
}

async function validateBottomClearance(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(80);
  const clearance = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');
    if (!nav || getComputedStyle(nav).display === 'none') return { mobile: false, clear: true };
    const last = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')].at(-1);
    return { mobile: true, clear: Boolean(last && last.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top - 4) };
  });
  if (clearance.mobile) assert.equal(clearance.clear, true, 'La navegación inferior tapa la última tarjeta.');
}

async function validateQualification(page: Page): Promise<void> {
  const complete = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'María Fernanda Rodríguez' });
  await complete.locator('[data-auto-qualify-client]').click();
  const panel = page.locator('#crm .lead-qualification-panel');
  await panel.waitFor({ state: 'visible' });
  const geometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth };
  });
  assert.ok(geometry.left >= -1 && geometry.right <= geometry.viewport + 1, JSON.stringify(geometry));
  assert.ok(geometry.documentWidth <= geometry.viewport + 1);
  await panel.locator('[data-close-qualification]').click();
}

async function validateKeyboardPressure(page: Page): Promise<void> {
  const original = page.viewportSize();
  assert.ok(original);
  const search = page.locator('#mvp-lead-search');
  await search.focus();
  await page.setViewportSize({ width: original.width, height: 500 });
  await search.scrollIntoViewIfNeeded();
  assert.equal(await search.evaluate((element) => document.activeElement === element), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  const filters = page.locator('#crm .mvp-lead-more-filters');
  if (!(await filters.evaluate((element: HTMLDetailsElement) => element.open))) await filters.locator(':scope > summary').click();
  const stage = page.locator('#mvp-lead-stage-filter');
  await stage.focus();
  assert.equal(await stage.evaluate((element) => document.activeElement === element), true);

  const overdue = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'Seguimiento vencido' });
  await overdue.locator('.mvp-lead-followup-menu > summary').click();
  const date = overdue.locator('input[type="date"]');
  await date.focus();
  await date.scrollIntoViewIfNeeded();
  assert.equal(await date.evaluate((element) => document.activeElement === element), true);
  await overdue.locator('.mvp-lead-followup-menu').evaluate((element: HTMLDetailsElement) => { element.open = false; });

  await page.setViewportSize(original);
}

async function validateZoomPressure(page: Page): Promise<void> {
  await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
  await page.waitForTimeout(100);
  const metrics = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert.ok(metrics.documentWidth <= metrics.viewport + 1, `Scroll horizontal con zoom 125%: ${JSON.stringify(metrics)}`);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
}

function verifyScreenshots(): void {
  const expected = viewports.flatMap((viewport) => ['before', 'after'].flatMap((version) => scenarios.map((scenario) => `${version}-${scenario}-${viewport.width}x${viewport.height}.png`))).sort();
  const actual = readdirSync(artifactDirectory).filter((name) => name.endsWith('.png')).sort();
  assert.deepEqual(actual, expected);
  for (const name of actual) {
    const path = join(artifactDirectory, name);
    const buffer = readFileSync(path);
    assert.ok(statSync(path).size > 4_000, `${name} parece vacío.`);
    assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
}

async function runVersion(
  browser: Browser,
  version: 'before' | 'after',
  baseUrl: string,
  metrics: VisualMetric[],
): Promise<void> {
  for (const viewport of viewports) {
    const context = await createContext(browser, viewport);
    const page = await context.newPage();
    try {
      await waitForLeads(page, baseUrl);
      if (version === 'after') {
        await validateNavigation(page);
        metrics.push(await validateGeneralGeometry(page, viewport));
        await validatePipeline(page, viewport);
        await validatePopoverAndSheet(page);
        await validateBottomClearance(page);
        if (viewport.width === 390) {
          await validateKeyboardPressure(page);
          await validateQualification(page);
        }
        if (viewport.width === 1024 || viewport.width === 1440) await validateZoomPressure(page);
      } else {
        metrics.push(await collectMetric(page, version, viewport));
      }
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
      await captureScenarios(page, version, viewport);
    } finally {
      await page.close();
      await context.close();
    }
  }
}

test('B1.2.4 compara antes y después en la aplicación real', { timeout: 600_000 }, async (t) => {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chrome para validar B1.2.4.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }

  rmSync(artifactDirectory, { recursive: true, force: true });
  mkdirSync(artifactDirectory, { recursive: true });
  const baseline = prepareBaselineWorktree();
  const beforePort = 48_000 + Math.floor(Math.random() * 400);
  const afterPort = 48_500 + Math.floor(Math.random() * 400);
  const beforeServer = await startServer(baseline.directory, beforePort);
  const afterServer = await startServer(repositoryRoot, afterPort);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  const metrics: VisualMetric[] = [];

  try {
    await runVersion(browser, 'before', `http://127.0.0.1:${beforePort}`, metrics);
    await runVersion(browser, 'after', `http://127.0.0.1:${afterPort}`, metrics);
    verifyScreenshots();
    console.log(`B1.2.4 visual metrics: ${JSON.stringify(metrics)}`);
  } finally {
    await browser.close();
    await stopServer(afterServer);
    await stopServer(beforeServer);
    baseline.cleanup();
  }
});
