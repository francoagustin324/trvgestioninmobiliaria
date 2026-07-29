import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { localIsoDate } from '../lead-pipeline.js';
import { initialData, type Client, type CrmData } from '../models.js';

const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 720, height: 1024 },
  { width: 1366, height: 768 },
] as const;
const mobileUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

function isoOffset(days: number): string {
  const date = new Date(`${localIsoDate()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function lead(id: number, overrides: Partial<Client>): Client {
  return { id, name: `Lead ${id}`, phone: `549351555${String(id).padStart(4, '0')}`, email: `lead${id}@example.test`, interest: 'Departamento en Córdoba', status: 'Lead', temperature: 'Tibio', pipeline: 'Contactado', assignedToId: 1, createdById: 1, ...overrides };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: 'b123', name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Validación B1.2.3' };
  crm.teamMembers = [{ id: 1, userId: 'b123-owner', name: 'Franco Solís', email: 'franco.solis@example.test', phone: '5493515110069', role: 'Dueño', status: 'Activo', createdAt: '2026-07-01T12:00:00.000Z' }];
  crm.clients = [
    lead(1, { name: 'Lucía Martín', temperature: 'Caliente', pipeline: 'Visita coordinada', nextAction: 'Confirmar visita', nextFollowUp: isoOffset(-5), budget: 'USD 105.000', currency: 'USD', paymentMethod: 'Combinación', purchaseTimeframe: '0-3 meses' }),
    lead(2, { name: 'Nuevo casi vacío', pipeline: 'Nuevo', lastContact: undefined }),
    lead(3, { name: 'María de los Ángeles Fernández', temperature: 'Caliente', budget: 'USD 120.000', currency: 'USD', paymentMethod: 'Crédito hipotecario', creditPossible: 'Aprobado', purchaseTimeframe: '0-3 meses' }),
    lead(4, { name: 'Seguimiento muy vencido', nextAction: 'Llamar para confirmar decisión', nextFollowUp: isoOffset(-19), budget: 'USD 90.000', currency: 'USD', paymentMethod: 'Contado', purchaseTimeframe: '0-3 meses' }),
    lead(5, { name: 'Visita de hoy', pipeline: 'Visita coordinada', temperature: 'Caliente', nextAction: 'Visita hoy a las 17:30', nextFollowUp: isoOffset(0), budget: 'USD 140.000', currency: 'USD', paymentMethod: 'Contado', purchaseTimeframe: 'Inmediato' }),
    lead(6, { name: 'Calificado sin próxima acción', pipeline: 'Calificado', temperature: 'Caliente', budget: 'USD 110.000', currency: 'USD', paymentMethod: 'Financiación', zones: 'Manantiales', purpose: 'Invertir', purchaseTimeframe: '3-6 meses', canMoveForward: 'Sí' }),
    lead(7, { name: 'Operación ganada', pipeline: 'Ganado', status: 'Operación ganada' }),
    lead(8, { name: 'Operación perdida', pipeline: 'Perdido', status: 'Operación perdida', temperature: 'Frío' }),
  ];
  crm.properties = [];
  crm.activityLog = [];
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${url}/health`)).ok) return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor B1.2.3 no disponible.');
}

async function startServer(port: number): Promise<ChildProcess> {
  const handle = spawn(process.execPath, ['dist/server.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', LEAD_QUALIFICATION_AI_ENDPOINT: '', LEAD_QUALIFICATION_AI_KEY: '', LEAD_QUALIFICATION_AI_MODEL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitServer(`http://127.0.0.1:${port}`);
  return handle;
}

async function stopServer(handle: ChildProcess): Promise<void> {
  if (handle.exitCode !== null) return;
  handle.kill('SIGTERM');
  await new Promise<void>((resolve) => { const timer = setTimeout(() => { if (handle.exitCode === null) handle.kill('SIGKILL'); resolve(); }, 2_000); handle.once('exit', () => { clearTimeout(timer); resolve(); }); });
}

async function contextFor(browser: Browser, viewport: typeof viewports[number]): Promise<BrowserContext> {
  const mobile = viewport.width <= 390;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width <= 720, isMobile: mobile, userAgent: mobile ? mobileUa : undefined, locale: 'es-AR', colorScheme: 'dark' });
  await context.addInitScript(({ data }) => {
    const userId = 'b123-owner';
    const key = `trv-crm-basico:user:${userId}`;
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({ accessToken: 'b123-token', refreshToken: 'b123-refresh', expiresAt: Date.now() + 3_600_000, userId, email: 'franco.solis@example.test' }));
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(`${key}:sync`, JSON.stringify({ dirty: false, localUpdatedAt: new Date().toISOString(), lastCloudSavedAt: new Date().toISOString() }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { data: fixture() });
  return context;
}

function exactCard(page: Page, name: string): Locator {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.locator('#crm .mvp-lead-compact-card').filter({ has: page.locator('h3').filter({ hasText: new RegExp(`^${escaped}$`) }) });
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-compact-card', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-compact-card').length === 8);
}

async function assertClosedLayout(page: Page, width: number): Promise<void> {
  const metrics = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')];
    const controls = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card button,#crm .mvp-lead-compact-card a,#crm .mvp-lead-full-sheet>summary,#crm .mvp-lead-followup-menu>summary')].filter((item) => item.getClientRects().length > 0);
    return {
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      inside: cards.every((card) => { const rect = card.getBoundingClientRect(); return rect.left >= -1 && rect.right <= innerWidth + 1; }),
      alertSlots: cards.every((card) => card.querySelectorAll('.mvp-lead-alert').length === 1),
      visibleAlerts: cards.every((card) => card.querySelectorAll('.mvp-lead-alert:not([hidden])').length <= 1),
      closedSheets: document.querySelectorAll('#crm .mvp-lead-full-sheet[open]').length,
      hiddenContents: [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-full-content')].every((item) => item.getClientRects().length === 0),
      controls: controls.map((item) => { const rect = item.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }),
      firstHeight: cards[0]?.getBoundingClientRect().height || 0,
    };
  });
  assert.ok(metrics.document <= metrics.viewport + 1);
  assert.ok(metrics.body <= metrics.viewport + 1);
  assert.equal(metrics.inside, true);
  assert.equal(metrics.alertSlots, true);
  assert.equal(metrics.visibleAlerts, true);
  assert.equal(metrics.closedSheets, 0);
  assert.equal(metrics.hiddenContents, true);
  assert.ok(metrics.controls.every((item) => item.width >= 43.5 && item.height >= 43.5));
  if (width === 390) assert.ok(metrics.firstHeight >= 300 && metrics.firstHeight <= 450);
}

async function assertDisclosure(page: Page): Promise<void> {
  const sheets = page.locator('#crm .mvp-lead-full-sheet');
  await sheets.nth(0).locator(':scope > summary').click();
  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 1);
  await sheets.nth(1).locator(':scope > summary').click();
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-full-sheet[open]').length === 1);
  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 1);
}

async function assertFollowUpActions(page: Page): Promise<void> {
  let card = exactCard(page, 'Seguimiento muy vencido');
  await card.locator('.mvp-lead-followup-menu > summary').click();
  const form = card.locator('[data-reprogram-client-follow-up]');
  await form.locator('input[name="date"]').fill(isoOffset(3));
  await form.locator('button[type="submit"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')].some((item) => item.textContent?.includes('Seguimiento muy vencido') && item.querySelector('.mvp-lead-next-action small')?.textContent?.includes('En 3 días')));
  card = exactCard(page, 'Seguimiento muy vencido');
  assert.match(await card.locator('.mvp-lead-next-action').innerText(), /En 3 días/);
  await card.locator('.mvp-lead-followup-menu > summary').click();
  await card.locator('[data-complete-client-follow-up]').click();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')].some((item) => item.textContent?.includes('Seguimiento muy vencido') && item.querySelector('.mvp-lead-next-action strong')?.textContent?.includes('Definir próxima acción')));
  card = exactCard(page, 'Seguimiento muy vencido');
  assert.equal((await card.locator('.mvp-lead-next-action strong').innerText()).trim(), 'Definir próxima acción');
  assert.equal(await card.locator('.mvp-lead-alert:not([hidden])').count(), 0);
}

test('B1.2.3 conserva lista compacta, disclosure y seguimiento con la aplicación real', async () => {
  const executablePath = chromePath();
  assert.ok(executablePath);
  const port = 43000 + Math.floor(Math.random() * 1000);
  const url = `http://127.0.0.1:${port}`;
  const screenshots = mkdtempSync(join(tmpdir(), 'propcontrol-b123-'));
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  let captured = 0;
  try {
    for (const viewport of viewports) {
      const context = await contextFor(browser, viewport);
      try {
        const page = await context.newPage();
        await load(page, url);
        await assertClosedLayout(page, viewport.width);
        if (viewport.width === 390) {
          await assertDisclosure(page);
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForSelector('#crm.active .mvp-lead-compact-card');
          await assertFollowUpActions(page);
        }
        await page.screenshot({ path: join(screenshots, `${viewport.width}x${viewport.height}.png`), fullPage: false, scale: 'css' });
        captured += 1;
      } finally { await context.close(); }
    }
    assert.equal(captured, 4);
    const files = readdirSync(screenshots).filter((name) => name.endsWith('.png'));
    assert.equal(files.length, 4);
    assert.ok(files.every((name) => statSync(join(screenshots, name)).size > 1_000));
  } finally {
    await browser.close();
    await stopServer(server);
    rmSync(screenshots, { recursive: true, force: true });
  }
});
