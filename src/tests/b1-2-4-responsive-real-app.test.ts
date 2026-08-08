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
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { localIsoDate } from '../lead-pipeline.js';
import { initialData, type Client, type CrmData } from '../models.js';

const root = process.cwd();
const baseSha = '34182f1b2174d86dd884014f2110eadebb838a03';
const artifacts = join(root, 'artifacts', 'b1-2-4-visual-review');
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
const mobileUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

type Version = 'before' | 'after';
type Viewport = typeof viewports[number];
type Scenario = typeof scenarios[number];

interface Metric {
  version: Version;
  viewport: string;
  filterHeight: number;
  emptyHeight: number;
  completeHeight: number;
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

function crmFixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: 'b124', name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Validación B1.2.4' };
  crm.teamMembers = [{
    id: 1,
    userId: 'b124-owner',
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
    lead(5, { name: 'Operación ganada', pipeline: 'Ganado', temperature: 'Caliente', budget: 'USD 148.000', currency: 'USD', paymentMethod: 'Contado', purchaseTimeframe: 'Inmediato' }),
    lead(6, { name: 'Operación perdida', pipeline: 'Perdido', temperature: 'Frío', budget: 'USD 85.000', currency: 'USD', paymentMethod: 'Contado', purchaseTimeframe: '0-3 meses' }),
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
  crm.settings = { ...crm.settings, profileName: 'Franco Solís', profileEmail: 'franco.solis@example.test', agencyName: 'TRV Gestión Inmobiliaria' };
  return crm;
}

function chromePath(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

async function waitServer(url: string): Promise<void> {
  let error: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch (caught) {
      error = caught;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Servidor visual no disponible: ${String(error ?? 'sin respuesta')}`);
}

async function startServer(cwd: string, port: number): Promise<ChildProcess> {
  const processHandle = spawn(process.execPath, ['dist/server.js'], {
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

function prepareBase(): { directory: string; cleanup: () => void } {
  try {
    execFileSync('git', ['cat-file', '-e', `${baseSha}^{commit}`], { cwd: root, stdio: 'ignore' });
  } catch {
    execFileSync('git', ['fetch', '--depth=1', 'origin', baseSha], { cwd: root, stdio: 'inherit' });
  }
  const temporary = mkdtempSync(join(tmpdir(), 'propcontrol-b124-'));
  const directory = join(temporary, 'before');
  execFileSync('git', ['worktree', 'add', '--detach', directory, baseSha], { cwd: root, stdio: 'inherit' });
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
  execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(directory, 'tsconfig.json')], { cwd: directory, stdio: 'inherit' });
  return {
    directory,
    cleanup: () => {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', directory], { cwd: root, stdio: 'ignore' });
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    },
  };
}

async function contextFor(browser: Browser, viewport: Viewport): Promise<BrowserContext> {
  const mobile = viewport.width <= 430;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: viewport.width <= 720,
    isMobile: mobile,
    userAgent: mobile ? mobileUa : undefined,
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
    localStorage.setItem(`${key}:sync`, JSON.stringify({ dirty: false, localUpdatedAt: new Date().toISOString(), lastCloudSavedAt: new Date().toISOString() }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { data: crmFixture() });
  return context;
}

async function loadLeads(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-compact-card', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-compact-card').length === 11);
  await page.waitForTimeout(100);
}

function exactCard(page: Page, name: string): Locator {
  return page.locator('#crm .mvp-lead-compact-card').filter({
    has: page.locator('h3').filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
  });
}

async function openDetails(card: Locator, version: Version): Promise<void> {
  const sheet = card.locator('.mvp-lead-full-sheet');
  if (await sheet.evaluate((element: HTMLDetailsElement) => element.open)) return;
  if (version === 'after') {
    await card.locator('.mvp-lead-actions-menu > summary').click();
    await card.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  } else {
    await sheet.locator(':scope > summary').click();
  }
  await sheet.evaluate((element: HTMLDetailsElement) => element.open);
}

function imagePath(version: Version, scenario: Scenario, viewport: Viewport): string {
  return join(artifacts, `${version}-${scenario}-${viewport.width}x${viewport.height}.png`);
}

async function capture(page: Page, version: Version, scenario: Scenario, viewport: Viewport): Promise<void> {
  await page.waitForTimeout(40);
  await page.screenshot({ path: imagePath(version, scenario, viewport), fullPage: false, scale: 'css' });
}

async function captureScenarios(page: Page, version: Version, viewport: Viewport): Promise<void> {
  const panel = page.locator('#crm .mvp-lead-filter-panel');
  await panel.scrollIntoViewIfNeeded();
  await capture(page, version, 'normal', viewport);

  const empty = exactCard(page, 'Grupo Norte');
  await empty.scrollIntoViewIfNeeded();
  await capture(page, version, 'lead-vacio', viewport);

  const complete = exactCard(page, 'María Fernanda Rodríguez — búsqueda completa');
  await complete.scrollIntoViewIfNeeded();
  await capture(page, version, 'lead-completo', viewport);

  const details = page.locator('#crm .mvp-lead-more-filters');
  const summary = details.locator(':scope > summary');
  const mobileFilterPanel = await summary.isVisible();
  if (mobileFilterPanel && !(await details.evaluate((element: HTMLDetailsElement) => element.open))) await summary.click();
  await panel.scrollIntoViewIfNeeded();
  await capture(page, version, 'filtros', viewport);
  if (mobileFilterPanel) await details.evaluate((element: HTMLDetailsElement) => { element.open = false; });

  const sheet = complete.locator('.mvp-lead-full-sheet');
  await openDetails(complete, version);
  await complete.scrollIntoViewIfNeeded();
  await capture(page, version, 'ficha', viewport);
  await sheet.evaluate((element: HTMLDetailsElement) => { element.open = false; });

  const overdue = exactCard(page, 'Seguimiento vencido');
  if (version === 'after') await openDetails(overdue, version);
  const menu = overdue.locator('.mvp-lead-followup-menu');
  await menu.locator(':scope > summary').click();
  await overdue.scrollIntoViewIfNeeded();
  await capture(page, version, 'seguimiento', viewport);
  await menu.evaluate((element: HTMLDetailsElement) => { element.open = false; });
}

async function metric(page: Page, version: Version, viewport: Viewport): Promise<Metric> {
  return page.evaluate(({ versionValue, viewportValue }) => {
    const panel = document.querySelector<HTMLElement>('#crm .mvp-lead-filter-panel')!;
    const cards = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')];
    const empty = cards.find((card) => card.querySelector('h3')?.textContent?.trim() === 'Grupo Norte')!;
    const complete = cards.find((card) => card.querySelector('h3')?.textContent?.trim() === 'María Fernanda Rodríguez — búsqueda completa')!;
    return {
      version: versionValue,
      viewport: viewportValue,
      filterHeight: Math.round(panel.getBoundingClientRect().height),
      emptyHeight: Math.round(empty.getBoundingClientRect().height),
      completeHeight: Math.round(complete.getBoundingClientRect().height),
      visibleCards: cards.filter((card) => card.getBoundingClientRect().top < window.innerHeight).length,
    };
  }, { versionValue: version, viewportValue: `${viewport.width}x${viewport.height}` });
}

async function validateAfter(page: Page, viewport: Viewport): Promise<Metric> {
  const data = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('#crm .mvp-lead-filter-panel')!;
    const panelRect = panel.getBoundingClientRect();
    const cards = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')];
    const empty = cards.find((card) => card.querySelector('h3')?.textContent?.trim() === 'Grupo Norte')!;
    const complete = cards.find((card) => card.querySelector('h3')?.textContent?.trim() === 'María Fernanda Rodríguez — búsqueda completa')!;
    const shell = document.querySelector<HTMLElement>('#crm [data-stage-shell]')!;
    const track = shell.querySelector<HTMLElement>('.mvp-stage-counters')!;
    const newButton = document.querySelector<HTMLElement>('#crm [data-toggle="client-form"]')!;
    const visibleChildren = [...panel.querySelectorAll<HTMLElement>(':scope > *, :scope > details > *')]
      .filter((element) => getComputedStyle(element).display !== 'none' && element.getClientRects().length > 0);
    const contentBottom = Math.max(...visibleChildren.map((element) => element.getBoundingClientRect().bottom));
    const controls = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card button, #crm .mvp-lead-compact-card a.mvp-contact-btn, #crm .mvp-lead-compact-card summary, #crm .mvp-lead-more-filters > summary')]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.textContent?.trim() || element.getAttribute('aria-label') || '', width: rect.width, height: rect.height };
      });
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      panelHeight: panelRect.height,
      unusedBottom: panelRect.bottom - contentBottom,
      emptyHeight: empty.getBoundingClientRect().height,
      completeHeight: complete.getBoundingClientRect().height,
      cardsInside: cards.every((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= window.innerWidth + 1;
      }),
      visibleCards: cards.filter((card) => card.getBoundingClientRect().top < window.innerHeight).length,
      summaryCount: empty.querySelectorAll('.mvp-lead-missing-summary').length,
      factCount: empty.querySelectorAll('.mvp-lead-fact').length,
      autoText: empty.querySelector<HTMLElement>('.mvp-auto-qualify-button')?.textContent?.trim(),
      newParent: newButton.parentElement?.className || '',
      controls,
      pipelineWrap: getComputedStyle(track).flexWrap,
      pipelineWidth: track.getBoundingClientRect().width,
      shellWidth: shell.getBoundingClientRect().width,
    };
  });

  assert.ok(data.documentWidth <= data.viewport + 1, `Scroll horizontal: ${JSON.stringify(data)}`);
  assert.ok(data.bodyWidth <= data.viewport + 1);
  assert.equal(data.cardsInside, true);
  assert.equal(data.summaryCount, 0);
  assert.equal(data.factCount, 1);
  assert.equal(data.autoText, undefined);
  assert.equal(data.pipelineWrap, 'nowrap');
  assert.ok(data.pipelineWidth <= data.shellWidth + 1);
  assert.ok(data.unusedBottom <= 24, `Espacio vacío excesivo: ${JSON.stringify(data)}`);

  if (viewport.width > 900) {
    assert.ok(data.panelHeight >= 175 && data.panelHeight <= 255, `Filtro fuera de 180-250px: ${JSON.stringify(data)}`);
    assert.match(data.newParent, /mvp-lead-filter-primary/);
    if (viewport.width >= 1366) assert.ok(data.visibleCards >= 2, `No se ven varios Leads: ${JSON.stringify(data)}`);
  } else {
    assert.doesNotMatch(data.newParent, /mvp-lead-filter-primary/);
    assert.ok(data.controls.every((control) => control.width >= 43.5 && control.height >= 43.5), `Control menor a 44px: ${JSON.stringify(data.controls)}`);
  }

  if (viewport.width === 390) {
    assert.ok(data.emptyHeight >= 220 && data.emptyHeight <= 380, `Lead vacío fuera de objetivo: ${JSON.stringify(data)}`);
    assert.ok(data.completeHeight >= 230 && data.completeHeight <= 460, `Lead normal fuera de objetivo: ${JSON.stringify(data)}`);
  }

  return {
    version: 'after',
    viewport: `${viewport.width}x${viewport.height}`,
    filterHeight: Math.round(data.panelHeight),
    emptyHeight: Math.round(data.emptyHeight),
    completeHeight: Math.round(data.completeHeight),
    visibleCards: data.visibleCards,
  };
}

async function validateNavigation(page: Page): Promise<void> {
  const labels = await page.evaluate(() => ({
    desktop: [...document.querySelectorAll<HTMLElement>('.mvp-sidebar .nav-label')].map((element) => element.textContent?.trim()),
    mobile: [...document.querySelectorAll<HTMLElement>('.mobile-bottom-nav .nav-label')].map((element) => element.textContent?.trim()),
  }));
  assert.deepEqual(labels.desktop, ['Leads', 'Chats', 'Agenda', 'Propiedades', 'Equipo', 'Configuración']);
  assert.deepEqual(labels.mobile, ['Leads', 'Chats', 'Agenda', 'Propiedades', 'Equipo']);
}

async function validatePipeline(page: Page): Promise<void> {
  const track = page.locator('#crm .mvp-stage-counters');
  const shell = page.locator('#crm [data-stage-shell]');
  await track.scrollIntoViewIfNeeded();
  await track.evaluate((element) => element.scrollTo({ left: 0, behavior: 'instant' }));
  await page.waitForTimeout(60);
  const initial = await shell.evaluate((element) => ({
    left: element.getAttribute('data-overflow-left'),
    right: element.getAttribute('data-overflow-right'),
    leftOpacity: getComputedStyle(element, '::before').opacity,
    rightOpacity: getComputedStyle(element, '::after').opacity,
  }));
  assert.equal(initial.left, 'false');
  assert.equal(initial.leftOpacity, '0');
  assert.equal(initial.rightOpacity === '1', initial.right === 'true');

  if (await track.evaluate((element) => element.scrollWidth > element.clientWidth + 2)) {
    await track.hover();
    await page.mouse.wheel(0, 160);
    await page.waitForTimeout(80);
    assert.ok(await track.evaluate((element) => element.scrollLeft > 0));
    await track.press('End');
    await page.waitForTimeout(100);
    const end = await shell.evaluate((element) => ({
      left: element.getAttribute('data-overflow-left'),
      right: element.getAttribute('data-overflow-right'),
      leftOpacity: getComputedStyle(element, '::before').opacity,
      rightOpacity: getComputedStyle(element, '::after').opacity,
    }));
    assert.equal(end.left, 'true');
    assert.equal(end.right, 'false');
    assert.equal(end.leftOpacity, '1');
    assert.equal(end.rightOpacity, '0');
  }

  await page.locator('#crm [data-stage-quick="Calificado"]').click();
  await page.waitForFunction(() => document.querySelector('#crm .mvp-stage-counter.active')?.textContent?.includes('Calificado'));
  const visible = await page.evaluate(() => {
    const selected = document.querySelector<HTMLElement>('#crm .mvp-stage-counter.active')!.getBoundingClientRect();
    const container = document.querySelector<HTMLElement>('#crm .mvp-stage-counters')!.getBoundingClientRect();
    return selected.left >= container.left - 1 && selected.right <= container.right + 1;
  });
  assert.equal(visible, true);
  await page.locator('#crm [data-stage-quick="Todas"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-compact-card').length === 11);
}

async function validateDisclosureAndPopover(page: Page): Promise<void> {
  const complete = exactCard(page, 'María Fernanda Rodríguez — búsqueda completa');
  await openDetails(complete, 'after');
  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 1);
  const text = await page.locator('#crm .mvp-lead-full-sheet[open]').innerText();
  assert.match(text, /Franco Solís/);
  assert.match(text, /propiedad compatible/i);
  await complete.locator('.mvp-lead-full-sheet').evaluate((element: HTMLDetailsElement) => { element.open = false; });

  const overdue = exactCard(page, 'Seguimiento vencido');
  await openDetails(overdue, 'after');
  await overdue.locator('.mvp-lead-followup-menu > summary').click();
  const button = overdue.locator('[data-complete-client-follow-up]');
  await button.waitFor({ state: 'visible' });
  assert.equal(await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === element || element.contains(hit);
  }), true);
  await overdue.locator('.mvp-lead-followup-menu').evaluate((element: HTMLDetailsElement) => { element.open = false; });
}

async function validateBottom(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(60);
  const result = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');
    if (!nav || getComputedStyle(nav).display === 'none') return true;
    const last = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')].at(-1);
    return Boolean(last && last.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top - 4);
  });
  assert.equal(result, true, 'La navegación inferior tapa la última tarjeta.');
}

async function validateKeyboardAndQualification(page: Page): Promise<void> {
  const original = page.viewportSize();
  assert.ok(original);
  await page.locator('#mvp-lead-search').focus();
  await page.setViewportSize({ width: original.width, height: 500 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  const details = page.locator('#crm .mvp-lead-more-filters');
  if (!(await details.evaluate((element: HTMLDetailsElement) => element.open))) await details.locator(':scope > summary').click();
  await page.locator('#mvp-lead-stage-filter').focus();
  await details.evaluate((element: HTMLDetailsElement) => { element.open = false; });

  const overdue = exactCard(page, 'Seguimiento vencido');
  await openDetails(overdue, 'after');
  await overdue.locator('.mvp-lead-followup-menu > summary').click();
  const date = overdue.locator('input[type="date"]');
  await date.focus();
  await date.scrollIntoViewIfNeeded();
  assert.equal(await date.evaluate((element) => document.activeElement === element), true);
  await overdue.locator('.mvp-lead-followup-menu').evaluate((element: HTMLDetailsElement) => { element.open = false; });

  const complete = exactCard(page, 'María Fernanda Rodríguez — búsqueda completa');
  if (await complete.locator('.mvp-lead-full-sheet').evaluate((element: HTMLDetailsElement) => element.open)) {
    await complete.locator('.mvp-lead-full-sheet').evaluate((element: HTMLDetailsElement) => { element.open = false; });
  }
  await complete.locator('.mvp-lead-actions-menu > summary').click();
  await complete.getByRole('button', { name: 'Completar datos con IA', exact: true }).click();
  const qualificationPanel = page.locator('#crm .lead-qualification-panel');
  await qualificationPanel.waitFor({ state: 'visible' });
  const input = qualificationPanel.locator('textarea, input:not([type="hidden"]), select').first();
  await input.focus();
  await input.scrollIntoViewIfNeeded();
  assert.equal(await input.evaluate((element) => document.activeElement === element), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await qualificationPanel.locator('[data-close-qualification]').click();
  await page.setViewportSize(original);
}

async function validateZoom(page: Page): Promise<void> {
  await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
  await page.waitForTimeout(80);
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert.ok(widths.document <= widths.viewport + 1, `Scroll con zoom 125%: ${JSON.stringify(widths)}`);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
}

function verifyImages(): void {
  const expected = viewports.flatMap((viewport) => (['before', 'after'] as const)
    .flatMap((version) => scenarios.map((scenario) => `${version}-${scenario}-${viewport.width}x${viewport.height}.png`))).sort();
  const actual = readdirSync(artifacts).filter((name) => name.endsWith('.png')).sort();
  assert.deepEqual(actual, expected);
  for (const name of actual) {
    const path = join(artifacts, name);
    const buffer = readFileSync(path);
    assert.ok(statSync(path).size > 4_000, `${name} parece vacío.`);
    assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const dimensions = name.match(/-(\d+)x(\d+)\.png$/);
    assert.ok(dimensions);
    assert.equal(buffer.readUInt32BE(16), Number(dimensions[1]));
    assert.equal(buffer.readUInt32BE(20), Number(dimensions[2]));
  }
}

async function runVersion(browser: Browser, version: Version, url: string, metrics: Metric[]): Promise<void> {
  for (const viewport of viewports) {
    const context = await contextFor(browser, viewport);
    const page = await context.newPage();
    try {
      await loadLeads(page, url);
      if (version === 'after') {
        await validateNavigation(page);
        metrics.push(await validateAfter(page, viewport));
        await validatePipeline(page);
        await validateDisclosureAndPopover(page);
        await validateBottom(page);
        if (viewport.width === 390) await validateKeyboardAndQualification(page);
        if (viewport.width === 1024 || viewport.width === 1440) await validateZoom(page);
      } else {
        metrics.push(await metric(page, version, viewport));
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
  const executable = chromePath();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chrome para B1.2.4.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }

  rmSync(artifacts, { recursive: true, force: true });
  mkdirSync(artifacts, { recursive: true });
  const baseline = prepareBase();
  let beforeServer: ChildProcess | null = null;
  let afterServer: ChildProcess | null = null;
  let browser: Browser | null = null;
  const metrics: Metric[] = [];

  try {
    const beforePort = 48_000 + Math.floor(Math.random() * 400);
    const afterPort = 48_500 + Math.floor(Math.random() * 400);
    beforeServer = await startServer(baseline.directory, beforePort);
    afterServer = await startServer(root, afterPort);
    browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
    await runVersion(browser, 'before', `http://127.0.0.1:${beforePort}`, metrics);
    await runVersion(browser, 'after', `http://127.0.0.1:${afterPort}`, metrics);
    verifyImages();

    const before390 = metrics.find((item) => item.version === 'before' && item.viewport === '390x844');
    const after390 = metrics.find((item) => item.version === 'after' && item.viewport === '390x844');
    assert.ok(before390 && after390);
    assert.ok(after390.emptyHeight < before390.emptyHeight, `La tarjeta vacía no redujo altura: ${JSON.stringify({ before390, after390 })}`);
    for (const width of ['1024x768', '1366x768', '1440x900']) {
      const before = metrics.find((item) => item.version === 'before' && item.viewport === width);
      const after = metrics.find((item) => item.version === 'after' && item.viewport === width);
      assert.ok(before && after);
      assert.ok(after.filterHeight < before.filterHeight, `El filtro de escritorio no redujo altura en ${width}: ${JSON.stringify({ before, after })}`);
    }
    console.log(`B1.2.4 visual metrics: ${JSON.stringify(metrics)}`);
  } finally {
    if (browser) await browser.close();
    if (afterServer) await stopServer(afterServer);
    if (beforeServer) await stopServer(beforeServer);
    baseline.cleanup();
  }
});
