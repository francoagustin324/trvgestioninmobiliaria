import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type Client, type CrmData } from '../models.js';

const root = process.cwd();
const artifacts = join(root, 'artifacts', 'b1-2-3-leads-daily');
const screenshotWidths = new Set([360, 390, 430, 720, 1366]);
const viewports = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 430, height: 932 },
  { width: 720, height: 1024 },
  { width: 1366, height: 768 },
];

const androidUserAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';

function client(id: number, overrides: Partial<Client>): Client {
  return {
    id,
    name: `Lead ${id}`,
    phone: `5493515550${String(id).padStart(2, '0')}`,
    interest: 'Propiedad en Córdoba',
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
  crm.organization = { id: 'b1-2-3-org', name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Prueba visual' };
  crm.teamMembers = [
    { id: 1, userId: 'owner-user', name: 'Franco Solís', email: 'franco@example.test', role: 'Dueño', status: 'Activo', createdAt: '2026-07-01T12:00:00.000Z' },
    { id: 2, userId: 'agent-user', name: 'Lucía Gómez', email: 'lucia@example.test', role: 'Corredor', status: 'Activo', createdAt: '2026-07-02T12:00:00.000Z' },
  ];
  crm.clients = [
    client(1, {
      name: 'María de los Ángeles Fernández',
      interest: 'Departamento de dos dormitorios en Nueva Córdoba apto crédito',
      temperature: 'Caliente', pipeline: 'Calificado', lastContact: '2026-07-27', nextAction: 'Enviar opciones y confirmar interés', nextFollowUp: '2026-07-29',
      budget: 'USD 120.000', currency: 'USD', paymentMethod: 'Crédito hipotecario', creditPossible: 'Aprobado', creditApprovedAmount: 'USD 80.000', zones: 'Nueva Córdoba, General Paz', purpose: 'Vivir', purchaseTimeframe: '0-3 meses', urgency: 'Alta', canMoveForward: 'Sí', knowsArea: 'Sí', preferences: 'Buena luz y balcón', features: 'Dos dormitorios, cochera preferible', objections: 'Expensas razonables', notes: 'Cliente con documentación lista', qualificationUpdatedAt: '2026-07-28T12:00:00.000Z', assignedToId: 1,
    }),
    client(2, { name: 'Lead nuevo casi vacío', pipeline: 'Nuevo', lastContact: undefined, interest: 'Todavía no definió búsqueda', assignedToId: 2 }),
    client(3, { name: 'Alejandra María del Valle Rodríguez', interest: 'Casa de 2 habitaciones en zona centro', budget: 'USD 95.000', currency: 'USD', paymentMethod: 'Contado', purchaseTimeframe: '3-6 meses', zones: 'Centro', purpose: 'Vivir', canMoveForward: 'Sí', assignedToId: 1 }),
    client(4, { name: 'Carlos seguimiento vencido', nextAction: 'Llamar para confirmar decisión', nextFollowUp: '2026-07-09', budget: 'USD 110.000', currency: 'USD', paymentMethod: 'Combinación', temperature: 'Caliente', assignedToId: 2 }),
    client(5, { name: 'Sofía visita de hoy', pipeline: 'Visita coordinada', nextAction: 'Visita a las 17:30', nextFollowUp: '2026-07-28', budget: 'USD 130.000', currency: 'USD', paymentMethod: 'Contado', zones: 'Docta', purpose: 'Vivir', purchaseTimeframe: 'Inmediato', canMoveForward: 'Sí', assignedToId: 1 }),
    client(6, { name: 'Martín calificado sin acción', pipeline: 'Calificado', temperature: 'Caliente', budget: 'USD 145.000', currency: 'USD', paymentMethod: 'Financiación', creditPossible: 'No necesita', zones: 'Manantiales', purpose: 'Invertir', purchaseTimeframe: '0-3 meses', canMoveForward: 'Sí', assignedToId: 2 }),
    client(7, { name: 'Operación ganada', pipeline: 'Ganado', status: 'Operación ganada', nextAction: 'Dato histórico', nextFollowUp: '2026-07-10', assignedToId: 1 }),
    client(8, { name: 'Operación perdida', pipeline: 'Perdido', status: 'Operación perdida', nextAction: 'Dato histórico', nextFollowUp: '2026-07-11', assignedToId: 2 }),
  ];
  crm.properties = [
    { id: 1, title: 'Departamento apto crédito en Nueva Córdoba', address: 'Nueva Córdoba', type: 'Departamento', operation: 'Venta', price: 118000, owner: 'Propietario', status: 'Activa', bedrooms: 2, paymentMethod: 'Apto crédito', assignedToId: 1, createdById: 1 },
    { id: 2, title: 'Dúplex en Manantiales', address: 'Manantiales', type: 'Dúplex', operation: 'Venta', price: 142000, owner: 'Desarrollista', status: 'Activa', bedrooms: 2, assignedToId: 1, createdById: 1 },
  ];
  crm.activityLog = [
    { id: 1, actorId: 1, action: 'Cambio de etapa', entityType: 'Cliente', entityId: 1, detail: 'Contactado → Calificado', createdAt: '2026-07-28T12:10:00.000Z' },
    { id: 2, actorId: 1, action: 'Próxima acción programada', entityType: 'Cliente', entityId: 1, detail: 'Enviar opciones', createdAt: '2026-07-28T12:12:00.000Z' },
  ];
  crm.reminders = [];
  crm.contacts = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.settings = { ...crm.settings, profileName: 'Franco Solís', profileEmail: 'franco@example.test', agencyName: 'TRV Gestión Inmobiliaria' };
  return crm;
}

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

async function waitForServer(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('El servidor visual B1.2.3 no quedó disponible.');
}

async function startServer(port: number): Promise<ChildProcess> {
  const server = spawn(process.execPath, ['dist/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', LEAD_QUALIFICATION_AI_ENDPOINT: '', LEAD_QUALIFICATION_AI_KEY: '', LEAD_QUALIFICATION_AI_MODEL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(`http://127.0.0.1:${port}`);
  return server;
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => { if (server.exitCode === null) server.kill('SIGKILL'); resolve(); }, 2_000);
    server.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
}

async function contextFor(browser: Browser, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const mobile = viewport.width <= 430;
  const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 3 : viewport.width <= 720 ? 2 : 1, hasTouch: viewport.width <= 720, isMobile: mobile, userAgent: mobile ? androidUserAgent : undefined, locale: 'es-AR', colorScheme: 'dark' });
  const crm = visualCrm();
  await context.addInitScript(({ data }) => {
    const userId = 'owner-user';
    const key = `trv-crm-basico:user:${userId}`;
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({ accessToken: 'test-token', refreshToken: 'test-refresh', expiresAt: Date.now() + 3_600_000, userId, email: 'franco@example.test' }));
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(`${key}:sync`, JSON.stringify({ dirty: false, localUpdatedAt: '2026-07-28T12:00:00.000Z', lastCloudSavedAt: '2026-07-28T12:00:00.000Z' }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { data: crm });
  return context;
}

async function waitForLeads(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-daily-card', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-daily-card').length === 8);
}

async function assertDocumentAndCards(page: Page, viewport: { width: number; height: number }): Promise<void> {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    cards: [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-daily-card')].map((card) => ({ width: card.getBoundingClientRect().width, height: card.getBoundingClientRect().height, right: card.getBoundingClientRect().right })),
    fullProfiles: document.querySelectorAll('#crm .mvp-lead-full-profile').length,
    controls: [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-daily-card button, #crm .mvp-lead-daily-card a')].filter((item) => getComputedStyle(item).display !== 'none').map((item) => ({ label: item.textContent?.trim() || item.getAttribute('aria-label') || '', width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height })),
  }));
  assert.ok(metrics.documentWidth <= metrics.viewport + 1, `Scroll horizontal del documento en ${viewport.width}px.`);
  assert.ok(metrics.bodyWidth <= metrics.viewport + 1, `Scroll horizontal del body en ${viewport.width}px.`);
  assert.equal(metrics.cards.length, 8);
  assert.equal(metrics.fullProfiles, 0);
  for (const card of metrics.cards) assert.ok(card.right <= metrics.viewport + 1 && card.width > 0);
  for (const control of metrics.controls) assert.ok(control.height >= 44 && control.width >= 44, `Control táctil insuficiente en ${viewport.width}px: ${JSON.stringify(control)}`);
  if (viewport.width === 390) {
    for (const card of metrics.cards) assert.ok(card.height >= 320 && card.height <= 450, `Tarjeta cerrada fuera de rango: ${card.height}px`);
  }
}

async function assertSingleExpandedAndRerender(page: Page): Promise<void> {
  const toggles = page.locator('#crm [data-toggle-lead-full]');
  await toggles.nth(0).click();
  assert.equal(await page.locator('#crm .mvp-lead-full-profile').count(), 1);
  await toggles.nth(1).click();
  assert.equal(await page.locator('#crm .mvp-lead-full-profile').count(), 1);
  const openId = await page.locator('#crm .mvp-lead-daily-card.expanded').getAttribute('data-lead-card');
  await page.locator('#mvp-lead-order').selectOption('Nombre');
  assert.equal(await page.locator('#crm .mvp-lead-daily-card.expanded').getAttribute('data-lead-card'), openId);
}

async function assertPipeline(page: Page): Promise<void> {
  const chip = page.locator('#crm [data-stage-quick="Perdido"]');
  await chip.click();
  const visible = await chip.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const parent = element.parentElement!.getBoundingClientRect();
    return rect.left >= parent.left - 1 && rect.right <= parent.right + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1;
  });
  assert.equal(visible, true);
  await page.locator('#crm [data-stage-quick="Todas"]').click();
}

async function assertFilters(page: Page): Promise<void> {
  await page.locator('#crm .mvp-lead-more-filters').evaluate((details: HTMLDetailsElement) => { details.open = true; });
  await page.locator('#mvp-lead-temperature-filter').selectOption('Caliente');
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-daily-card').length === 4);
  assert.match(await page.locator('#crm .mvp-lead-more-filters summary small').innerText(), /Temperatura/);
  await page.locator('[data-clear-lead-filters]').click();
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-daily-card').length === 8);
}

async function assertFollowUpActions(page: Page): Promise<void> {
  const overdue = page.locator('#crm .mvp-lead-daily-card', { hasText: 'Carlos seguimiento vencido' });
  page.once('dialog', async (dialog) => dialog.accept('2026-08-01'));
  await overdue.locator('[data-reprogram-followup]').click();
  await page.waitForTimeout(50);
  assert.match(await overdue.locator('.mvp-lead-next small').innerText(), /01\/08\/2026|En 4 días/);
  await overdue.locator('[data-complete-followup]').click();
  await page.waitForTimeout(50);
  assert.equal(await overdue.locator('.mvp-lead-next').count(), 0);
}

async function openQualification(page: Page): Promise<void> {
  const first = page.locator('#crm .mvp-lead-daily-card').first();
  await first.locator('[data-auto-qualify-client]').click();
  const panel = first.locator('.lead-qualification-panel');
  await panel.waitFor({ state: 'visible' });
  const textarea = panel.locator('[data-qualification-text]');
  await textarea.fill('Busco para vivir en Nueva Córdoba, hasta USD 120.000, con crédito aprobado.');
  await panel.locator('[data-run-qualification]').click();
  await panel.locator('[data-apply-qualification]').waitFor({ state: 'visible' });
  await textarea.focus();
  await page.waitForTimeout(500);
  const geometry = await textarea.evaluate((element) => {
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');
    const navRect = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
    return { active: document.activeElement === element, bottom: rect.bottom, visibleBottom: navRect?.top ?? window.innerHeight, left: rect.left, right: rect.right, width: window.innerWidth };
  });
  assert.equal(geometry.active, true);
  assert.ok(geometry.bottom <= geometry.visibleBottom - 4);
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.width + 1);
}

async function screenshot(page: Page, viewport: { width: number; height: number }, suffix: 'compact' | 'expanded'): Promise<void> {
  if (!screenshotWidths.has(viewport.width)) return;
  await page.screenshot({ path: join(artifacts, `leads-${suffix}-${viewport.width}x${viewport.height}.png`), fullPage: false, scale: 'css' });
}

function assertArtifacts(): void {
  const expected = [...screenshotWidths].flatMap((width) => {
    const height = viewports.find((viewport) => viewport.width === width)!.height;
    return [`leads-compact-${width}x${height}.png`, `leads-expanded-${width}x${height}.png`];
  }).sort();
  const actual = readdirSync(artifacts).filter((name) => name.endsWith('.png')).sort();
  assert.deepEqual(actual, expected);
  for (const name of actual) {
    const path = join(artifacts, name);
    assert.ok(statSync(path).size > 10_000, `Captura vacía: ${name}`);
    const match = name.match(/-(\d+)x(\d+)\.png$/)!;
    const buffer = readFileSync(path);
    assert.equal(buffer.readUInt32BE(16), Number(match[1]));
    assert.equal(buffer.readUInt32BE(20), Number(match[2]));
  }
}

test('B1.2.3 valida Leads compactos, priorizados y progresivos en la aplicación real', { timeout: 300_000 }, async (t) => {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chrome para B1.2.3.');
    t.skip('No hay Chrome local.');
    return;
  }
  rmSync(artifacts, { recursive: true, force: true });
  mkdirSync(artifacts, { recursive: true });
  const port = 45_000 + Math.floor(Math.random() * 1_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  try {
    for (const viewport of viewports) {
      const context = await contextFor(browser, viewport);
      const page = await context.newPage();
      try {
        await waitForLeads(page, baseUrl);
        await assertDocumentAndCards(page, viewport);
        await screenshot(page, viewport, 'compact');
        await assertPipeline(page);
        await assertFilters(page);
        await assertSingleExpandedAndRerender(page);
        if (viewport.width === 390) await assertFollowUpActions(page);
        await openQualification(page);
        await screenshot(page, viewport, 'expanded');
        assert.equal(await page.locator('#crm .mvp-lead-full-profile').count(), 1);
      } finally {
        await page.close();
        await context.close();
      }
    }
    assertArtifacts();
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
