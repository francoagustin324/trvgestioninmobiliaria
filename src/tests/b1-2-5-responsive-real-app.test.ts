import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { localIsoDate } from '../lead-pipeline.js';
import { initialData, type Client, type CrmData } from '../models.js';

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
] as const;
const captureWidths = new Set([360, 390, 430, 720, 1024, 1366]);
const mobileUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

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
    interest: 'Casa de 2 habitaciones en zona centro',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: 'b125', name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Validación B1.2.5' };
  crm.teamMembers = [{
    id: 1,
    userId: 'b125-owner',
    name: 'Franco Solís',
    email: 'franco.solis@example.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-07-01T12:00:00.000Z',
  }];
  crm.clients = [
    lead(1, {
      name: 'Lucía Martín',
      temperature: 'Caliente',
      pipeline: 'Visita coordinada',
      nextAction: 'Confirmar nueva visita',
      nextFollowUp: isoOffset(-19),
      budget: '168000',
      currency: 'USD',
      paymentMethod: 'Crédito preaprobado',
      purchaseTimeframe: '0-3 meses',
    }),
    lead(2, {
      name: 'María de los Ángeles Fernández',
      temperature: 'Caliente',
      pipeline: 'Visita coordinada',
      nextAction: 'Retomar propuesta y coordinar segunda visita',
      nextFollowUp: isoOffset(-27),
      budget: 'USD 168000',
      paymentMethod: 'Crédito preaprobado',
      purchaseTimeframe: '0-3 meses',
    }),
    lead(3, {
      name: 'Grupo Norte',
      pipeline: 'Nuevo',
      nextAction: 'Realizar primer contacto comercial',
      nextFollowUp: isoOffset(-12),
    }),
    lead(4, {
      name: 'TRV Gestión Inmobiliaria',
      pipeline: 'Visita coordinada',
      nextAction: 'Confirmar documentación para la visita',
      nextFollowUp: isoOffset(-8),
      budget: 'Hasta USD 120.000',
      currency: 'USD',
      paymentMethod: 'Contado',
      purchaseTimeframe: '0-3 meses',
    }),
    lead(5, {
      name: 'Importe ARS',
      pipeline: 'Calificado',
      budget: '7600000',
      currency: 'ARS',
      paymentMethod: 'Contado',
      purchaseTimeframe: '0-3 meses',
    }),
    lead(6, {
      name: 'Importe sin moneda',
      pipeline: 'Calificado',
      budget: '168000',
      currency: undefined,
      paymentMethod: 'Financiación',
      purchaseTimeframe: '3-6 meses',
    }),
    lead(7, {
      name: 'Texto de presupuesto',
      pipeline: 'Contactado',
      budget: 'Entre 100 y 120 mil dólares',
      currency: undefined,
      paymentMethod: 'A confirmar',
      purchaseTimeframe: 'A confirmar',
    }),
    lead(8, {
      name: 'Juan Ignacio Rodríguez Martínez',
      pipeline: 'Perdido',
      temperature: 'Frío',
      budget: 'A confirmar',
      currency: 'USD',
      paymentMethod: 'Contado',
      purchaseTimeframe: '0-3 meses',
      notes: 'Lead terminal utilizado para validar la accesibilidad del último control por encima de la navegación inferior.',
    }),
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
  let error: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch (caught) {
      error = caught;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Servidor visual B1.2.5 no disponible: ${String(error ?? 'sin respuesta')}`);
}

async function startServer(port: number): Promise<ChildProcess> {
  const processHandle = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
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

async function contextFor(viewport: typeof viewports[number]): Promise<BrowserContext> {
  const executablePath = chromePath();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para la prueba responsive B1.2.5.');
  const browser = await chromium.launch({ executablePath, headless: true });
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
    const userId = 'b125-owner';
    const key = `trv-crm-basico:user:${userId}`;
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'b125-token',
      refreshToken: 'b125-refresh',
      expiresAt: Date.now() + 3_600_000,
      userId,
      email: 'franco.solis@example.test',
    }));
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(`${key}:sync`, JSON.stringify({ dirty: false, localUpdatedAt: new Date().toISOString(), lastCloudSavedAt: new Date().toISOString() }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { data: fixture() });
  return context;
}

function exactCard(page: Page, name: string): Locator {
  return page.locator('#crm .mvp-lead-compact-card').filter({
    has: page.locator('h3').filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
  });
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-compact-card', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-compact-card').length === 8);
  await page.waitForTimeout(80);
}

async function wordFragments(card: Locator, word: string): Promise<number> {
  return card.locator('h3').evaluate((heading, target) => {
    const textNode = [...heading.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    const content = textNode?.textContent ?? '';
    const start = content.indexOf(target);
    if (!textNode || start < 0) return 99;
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + target.length);
    return [...range.getClientRects()].filter((rect) => rect.width > 0.5 && rect.height > 0.5).length;
  }, word);
}

async function validateName(card: Locator, name: string, mobileHeader: boolean): Promise<void> {
  for (const word of name.split(/\s+/)) {
    assert.equal(await wordFragments(card, word), 1, `La palabra “${word}” se dividió dentro de “${name}”.`);
  }
  const geometry = await card.evaluate((element, isMobile) => {
    const identity = element.querySelector<HTMLElement>('.mvp-lead-identity')!;
    const statuses = element.querySelector<HTMLElement>('.mvp-lead-statuses')!;
    const heading = identity.querySelector<HTMLElement>('h3')!;
    const stage = statuses.querySelector<HTMLElement>('.mvp-stage-badge')!;
    const alert = statuses.querySelector<HTMLElement>('.mvp-lead-alert')!;
    const cardRect = element.getBoundingClientRect();
    const identityRect = identity.getBoundingClientRect();
    const statusesRect = statuses.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const alertRect = alert.getBoundingClientRect();
    return {
      mobile: isMobile,
      cardWidth: cardRect.width,
      headingWidth: headingRect.width,
      identityBottom: identityRect.bottom,
      statusesTop: statusesRect.top,
      statusesBottom: statusesRect.bottom,
      stageInside: stageRect.left >= cardRect.left - 1 && stageRect.right <= cardRect.right + 1,
      alertInside: alertRect.left >= cardRect.left - 1 && alertRect.right <= cardRect.right + 1,
      badgesSeparated: stageRect.right <= alertRect.left + 1 || alertRect.top >= stageRect.bottom - 1,
      statusesHorizontalWithIdentity: statusesRect.top < identityRect.bottom,
    };
  }, mobileHeader);
  assert.ok(geometry.headingWidth >= geometry.cardWidth * 0.66, `Nombre sin ancho útil: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.stageInside, true);
  assert.equal(geometry.alertInside, true);
  assert.equal(geometry.badgesSeparated, true);
  if (mobileHeader) assert.ok(geometry.statusesTop >= geometry.identityBottom - 1, `Los badges no quedaron debajo: ${JSON.stringify(geometry)}`);
  else assert.equal(geometry.statusesHorizontalWithIdentity, true, `Escritorio dejó de ser horizontal: ${JSON.stringify(geometry)}`);
}

async function validateAmounts(page: Page): Promise<void> {
  const budget = async (name: string): Promise<string> => exactCard(page, name).locator('[data-lead-fact="budget"] strong').innerText();
  assert.equal(await budget('Lucía Martín'), 'USD 168.000');
  assert.equal(await budget('Importe ARS'), 'ARS 7.600.000');
  assert.equal(await budget('Importe sin moneda'), '168.000 · moneda no confirmada');
  assert.equal(await budget('TRV Gestión Inmobiliaria'), 'Hasta USD 120.000');
  assert.equal(await budget('Texto de presupuesto'), 'Entre 100 y 120 mil dólares');
}

async function clearanceAboveBottomNav(control: Locator): Promise<number> {
  await control.evaluate((element) => element.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'instant' }));
  await control.page().waitForTimeout(60);
  return control.evaluate((element) => {
    const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');
    if (!nav || getComputedStyle(nav).display === 'none') return 999;
    return nav.getBoundingClientRect().top - element.getBoundingClientRect().bottom;
  });
}

async function validateBottomNavigation(page: Page): Promise<void> {
  const last = exactCard(page, 'Juan Ignacio Rodríguez Martínez');
  const qualify = last.locator('.mvp-auto-qualify-button');
  const sheetSummary = last.locator('.mvp-lead-full-sheet > summary');
  assert.ok(await clearanceAboveBottomNav(qualify) >= 16, 'Calificar automáticamente queda demasiado cerca de la navegación inferior.');
  assert.ok(await clearanceAboveBottomNav(sheetSummary) >= 16, 'Ver ficha completa queda demasiado cerca de la navegación inferior.');
  await sheetSummary.click();
  const deleteButton = last.locator('.mvp-lead-full-actions .delete');
  assert.ok(await clearanceAboveBottomNav(deleteButton) >= 16, 'Los botones de la ficha abierta quedan tapados por la navegación inferior.');

  const overdue = exactCard(page, 'Lucía Martín');
  await overdue.locator('.mvp-lead-followup-menu > summary').click();
  const complete = overdue.locator('[data-complete-client-follow-up]');
  assert.ok(await clearanceAboveBottomNav(complete) >= 16, 'El popover de seguimiento queda tapado por la navegación inferior.');
  await overdue.locator('.mvp-lead-followup-menu').evaluate((element: HTMLDetailsElement) => { element.open = false; });
}

async function captureScenario(page: Page, directory: string, viewport: typeof viewports[number], scenario: string, cardName: string): Promise<void> {
  const card = exactCard(page, cardName);
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(30);
  await page.screenshot({ path: join(directory, `${viewport.width}x${viewport.height}-${scenario}.png`), fullPage: false, scale: 'css' });
}

test('B1.2.5 valida nombres, badges, importes y navegación inferior con DOM y CSS reales', async () => {
  const port = 44000 + Math.floor(Math.random() * 1000);
  const url = `http://127.0.0.1:${port}`;
  const screenshots = mkdtempSync(join(tmpdir(), 'propcontrol-b125-'));
  const server = await startServer(port);
  let captured = 0;
  try {
    for (const viewport of viewports) {
      const context = await contextFor(viewport);
      const browser = context.browser();
      assert.ok(browser);
      try {
        const page = await context.newPage();
        await load(page, url);
        const mobileHeader = viewport.width <= 520;
        await validateName(exactCard(page, 'Lucía Martín'), 'Lucía Martín', mobileHeader);
        await validateName(exactCard(page, 'María de los Ángeles Fernández'), 'María de los Ángeles Fernández', mobileHeader);
        await validateName(exactCard(page, 'TRV Gestión Inmobiliaria'), 'TRV Gestión Inmobiliaria', mobileHeader);
        await validateName(exactCard(page, 'Juan Ignacio Rodríguez Martínez'), 'Juan Ignacio Rodríguez Martínez', mobileHeader);
        await validateAmounts(page);

        const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        assert.ok(widths.document <= widths.viewport + 1, `Scroll horizontal: ${JSON.stringify(widths)}`);
        assert.ok(widths.body <= widths.viewport + 1, `Scroll horizontal del body: ${JSON.stringify(widths)}`);

        const accessibleAlert = await exactCard(page, 'Lucía Martín').locator('.mvp-lead-alert').evaluate((element) => ({
          text: element.textContent?.trim(),
          aria: element.getAttribute('aria-label'),
          title: element.getAttribute('title'),
        }));
        assert.equal(accessibleAlert.aria, 'Seguimiento vencido hace 19 días');
        assert.equal(accessibleAlert.title, 'Seguimiento vencido hace 19 días');
        assert.equal(accessibleAlert.text, mobileHeader ? 'Vencido hace 19 días' : 'Seguimiento vencido hace 19 días');

        if (viewport.width <= 720) await validateBottomNavigation(page);

        if (captureWidths.has(viewport.width)) {
          const scenarios: Array<[string, string]> = [
            ['lucia-martin', 'Lucía Martín'],
            ['nombre-muy-largo', 'María de los Ángeles Fernández'],
            ['etapa-larga', 'TRV Gestión Inmobiliaria'],
            ['alerta-larga', 'Grupo Norte'],
            ['importe-usd', 'Lucía Martín'],
            ['importe-ars', 'Importe ARS'],
            ['importe-sin-moneda', 'Importe sin moneda'],
            ['ultima-tarjeta', 'Juan Ignacio Rodríguez Martínez'],
          ];
          for (const [scenario, name] of scenarios) {
            await captureScenario(page, screenshots, viewport, scenario, name);
            captured += 1;
          }
        }
      } finally {
        await context.close();
        await browser.close();
      }
    }

    assert.equal(captured, 48);
    const files = readdirSync(screenshots).filter((name) => name.endsWith('.png'));
    assert.equal(files.length, 48);
    assert.ok(files.every((name) => statSync(join(screenshots, name)).size > 1_000), 'Alguna captura responsive está vacía o dañada.');
    console.log(`# B1.2.5 capturas efímeras inspeccionadas: ${files.length}`);
  } finally {
    await stopServer(server);
    rmSync(screenshots, { recursive: true, force: true });
  }
});
