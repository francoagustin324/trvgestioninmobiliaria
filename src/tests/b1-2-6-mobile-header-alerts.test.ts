import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { renderCompactLeadCard } from '../lead-card-compact-ui.js';
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
  crm.organization = { id: 'b126', name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Validación B1.2.6' };
  crm.teamMembers = [{
    id: 1,
    userId: 'b126-owner',
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
      nextFollowUp: isoOffset(-20),
      budget: '168000',
      currency: 'USD',
      paymentMethod: 'Crédito preaprobado',
      purchaseTimeframe: '0-3 meses',
    }),
    lead(2, {
      name: 'edgardo',
      pipeline: 'Calificado',
      nextAction: 'Confirmar capacidad de avance',
      nextFollowUp: isoOffset(2),
      budget: '120000',
      currency: 'USD',
      paymentMethod: 'Contado',
      purchaseTimeframe: '0-3 meses',
      zones: 'Centro',
      purpose: 'Vivir',
    }),
    lead(3, {
      name: 'Prueba cel 1',
      pipeline: 'Nuevo',
      lastContact: undefined,
    }),
    lead(4, {
      name: 'María de los Ángeles Fernández',
      temperature: 'Caliente',
      pipeline: 'Visita coordinada',
      nextAction: 'Retomar propuesta y coordinar segunda visita',
      nextFollowUp: isoOffset(-28),
      budget: 'USD 168000',
      paymentMethod: 'Crédito preaprobado',
      purchaseTimeframe: '0-3 meses',
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

const cardContext = {
  expanded: false,
  responsible: 'Franco Solís',
  qualificationPanel: '',
  history: '',
  matches: '',
};

test('B1.2.6 renderiza una sola cadena de alerta y conserva la información accesible', () => {
  const html = renderCompactLeadCard(fixture().clients[0]!, cardContext);
  assert.match(html, /class="mvp-lead-alert-text"/);
  assert.match(html, /data-mobile-label="Vencido hace 20 días"/);
  assert.match(html, /aria-label="Seguimiento vencido hace 20 días"/);
  assert.match(html, /title="Seguimiento vencido hace 20 días"/);
  assert.equal((html.match(/mvp-lead-alert-text/g) ?? []).length, 1);
  assert.doesNotMatch(html, /mvp-lead-alert-full|mvp-lead-alert-compact/);
});

test('B1.2.6 define la estructura en la hoja responsable e invalida su caché immutable', () => {
  const compactCss = readFileSync('src/lead-list-compact.css', 'utf8');
  const polishCss = readFileSync('src/lead-list-polish.css', 'utf8');
  const html = readFileSync('index.html', 'utf8');
  assert.match(compactCss, /#crm \.mvp-lead-card \.mvp-lead-compact-header/);
  assert.match(compactCss, /grid-template-rows:\s*auto auto/);
  assert.match(compactCss, /grid-template-areas:\s*['"]identity['"]\s*['"]statuses['"]/);
  assert.match(compactCss, /\.mvp-lead-alert::after[^}]*content:\s*attr\(data-mobile-label\)/s);
  assert.match(polishCss, /@media \(min-width: 381px\) and \(max-width: 520px\)/);
  assert.ok(html.indexOf('lead-list-compact.css?v=20260729-3') < html.indexOf('lead-list-polish.css?v=20260729-1'));
  assert.equal((html.match(/lead-list-compact\.css/g) ?? []).length, 1);
});

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
  throw new Error(`Servidor visual B1.2.6 no disponible: ${String(error ?? 'sin respuesta')}`);
}

async function startServer(port: number): Promise<ChildProcess> {
  const handle = spawn(process.execPath, ['dist/server.js'], {
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
  return handle;
}

async function stopServer(handle: ChildProcess): Promise<void> {
  if (handle.exitCode !== null) return;
  handle.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (handle.exitCode === null) handle.kill('SIGKILL');
      resolve();
    }, 2_000);
    handle.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function contextFor(browser: Browser, viewport: typeof viewports[number]): Promise<BrowserContext> {
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
    const userId = 'b126-owner';
    const key = `trv-crm-basico:user:${userId}`;
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({ accessToken: 'b126-token', refreshToken: 'b126-refresh', expiresAt: Date.now() + 3_600_000, userId, email: 'franco.solis@example.test' }));
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
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-compact-card').length === 4);
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
    return [...range.getClientRects()].filter((rect) => rect.width > .5 && rect.height > .5).length;
  }, word);
}

async function validateHeader(card: Locator, name: string, stacked: boolean): Promise<void> {
  for (const word of name.split(/\s+/)) assert.equal(await wordFragments(card, word), 1, `La palabra “${word}” se dividió dentro de “${name}”.`);
  const geometry = await card.evaluate((element) => {
    const header = element.querySelector<HTMLElement>('.mvp-lead-compact-header')!;
    const identity = element.querySelector<HTMLElement>('.mvp-lead-identity')!;
    const statuses = element.querySelector<HTMLElement>('.mvp-lead-statuses')!;
    const heading = identity.querySelector<HTMLElement>('h3')!;
    const headerRect = header.getBoundingClientRect();
    const identityRect = identity.getBoundingClientRect();
    const statusesRect = statuses.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(heading);
    const lineTops = new Set([...range.getClientRects()].filter((rect) => rect.width > .5).map((rect) => Math.round(rect.top)));
    return {
      headerWidth: headerRect.width,
      identityWidth: identityRect.width,
      statusesWidth: statusesRect.width,
      identityBottom: identityRect.bottom,
      statusesTop: statusesRect.top,
      statusesLeft: statusesRect.left,
      headerLeft: headerRect.left,
      horizontal: statusesRect.top < identityRect.bottom,
      headingLines: lineTops.size,
    };
  });
  if (stacked) {
    assert.ok(geometry.statusesTop - geometry.identityBottom >= 5.5, `Separación móvil menor a 6 px: ${JSON.stringify(geometry)}`);
    assert.ok(Math.abs(geometry.identityWidth - geometry.headerWidth) <= 1.5, `Identidad sin ancho completo: ${JSON.stringify(geometry)}`);
    assert.ok(Math.abs(geometry.statusesWidth - geometry.headerWidth) <= 1.5, `Estados sin ancho completo: ${JSON.stringify(geometry)}`);
    assert.ok(Math.abs(geometry.statusesLeft - geometry.headerLeft) <= 1.5, `Estados ubicados a la derecha del nombre: ${JSON.stringify(geometry)}`);
    if (name === 'Lucía Martín') assert.equal(geometry.headingLines, 1, `Lucía Martín ocupa líneas innecesarias: ${JSON.stringify(geometry)}`);
  } else {
    assert.equal(geometry.horizontal, true, `Escritorio dejó de conservar la distribución horizontal: ${JSON.stringify(geometry)}`);
  }
}

interface ExpectedAlert {
  name: string;
  full: string;
  mobile: string;
}

const expectedAlerts: ExpectedAlert[] = [
  { name: 'Lucía Martín', full: 'Seguimiento vencido hace 20 días', mobile: 'Vencido hace 20 días' },
  { name: 'edgardo', full: 'Falta confirmar capacidad de avance', mobile: 'Falta confirmar avance' },
  { name: 'Prueba cel 1', full: 'Nuevo sin contactar', mobile: 'Nuevo sin contactar' },
  { name: 'María de los Ángeles Fernández', full: 'Seguimiento vencido hace 28 días', mobile: 'Vencido hace 28 días' },
];

async function validateAlert(page: Page, expected: ExpectedAlert, mobile: boolean): Promise<void> {
  const alert = exactCard(page, expected.name).locator('.mvp-lead-alert');
  const result = await alert.evaluate((element) => {
    const text = element.querySelector<HTMLElement>('.mvp-lead-alert-text')!;
    return {
      childCount: element.children.length,
      textCount: element.querySelectorAll('.mvp-lead-alert-text').length,
      legacyCount: element.querySelectorAll('.mvp-lead-alert-full, .mvp-lead-alert-compact').length,
      aria: element.getAttribute('aria-label'),
      title: element.getAttribute('title'),
      mobileLabel: element.getAttribute('data-mobile-label'),
      textContent: text.textContent?.trim(),
      textDisplay: getComputedStyle(text).display,
      pseudoContent: getComputedStyle(element, '::after').content.replace(/^['"]|['"]$/g, ''),
    };
  });
  assert.equal(result.childCount, 1);
  assert.equal(result.textCount, 1);
  assert.equal(result.legacyCount, 0);
  assert.equal(result.aria, expected.full);
  assert.equal(result.title, expected.full);
  assert.equal(result.mobileLabel, expected.mobile);
  assert.equal(result.textContent, expected.full);
  if (mobile) {
    assert.equal(result.textDisplay, 'none');
    assert.equal(result.pseudoContent, expected.mobile);
  } else {
    assert.notEqual(result.textDisplay, 'none');
    assert.ok(result.pseudoContent === 'none' || result.pseudoContent === '');
  }
}

async function capture(page: Page, directory: string, viewport: typeof viewports[number], name: string): Promise<void> {
  await exactCard(page, name).scrollIntoViewIfNeeded();
  await page.waitForTimeout(30);
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await page.screenshot({ path: join(directory, `${viewport.width}x${viewport.height}-${slug}.png`), fullPage: false, scale: 'css' });
}

test('B1.2.6 valida el encabezado y una sola alerta visible con la aplicación real', async () => {
  const executablePath = chromePath();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.6.');
  const port = 45000 + Math.floor(Math.random() * 1000);
  const url = `http://127.0.0.1:${port}`;
  const screenshots = mkdtempSync(join(tmpdir(), 'propcontrol-b126-'));
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  let captured = 0;
  try {
    for (const viewport of viewports) {
      const context = await contextFor(browser, viewport);
      try {
        const page = await context.newPage();
        await load(page, url);
        const mobile = viewport.width <= 520;
        await validateHeader(exactCard(page, 'Lucía Martín'), 'Lucía Martín', mobile);
        await validateHeader(exactCard(page, 'María de los Ángeles Fernández'), 'María de los Ángeles Fernández', mobile);
        for (const expected of expectedAlerts) await validateAlert(page, expected, mobile);

        const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        assert.ok(widths.document <= widths.viewport + 1, `Scroll horizontal: ${JSON.stringify(widths)}`);
        assert.ok(widths.body <= widths.viewport + 1, `Scroll horizontal del body: ${JSON.stringify(widths)}`);

        if (captureWidths.has(viewport.width)) {
          for (const expected of expectedAlerts) {
            await capture(page, screenshots, viewport, expected.name);
            captured += 1;
          }
        }
      } finally {
        await context.close();
      }
    }

    assert.equal(captured, 24);
    const files = readdirSync(screenshots).filter((name) => name.endsWith('.png'));
    assert.equal(files.length, 24);
    assert.ok(files.every((name) => statSync(join(screenshots, name)).size > 1_000), 'Alguna captura B1.2.6 está vacía o dañada.');
    console.log(`# B1.2.6 capturas efímeras inspeccionadas: ${files.length}`);
  } finally {
    await browser.close();
    await stopServer(server);
    rmSync(screenshots, { recursive: true, force: true });
  }
});
