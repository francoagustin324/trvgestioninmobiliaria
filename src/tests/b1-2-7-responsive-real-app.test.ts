import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
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
const captureNames = [
  'Grupo Norte',
  'Andrés Vega',
  'Lucía Martín',
  'Edgardo',
  'Lead nuevo',
  'Lead calificado',
  'Seguimiento futuro',
  'Ganado',
  'Perdido',
] as const;
const mobileUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

function isoOffset(days: number): string {
  const date = new Date(`${localIsoDate()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function exactDateLabel(value: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function lead(id: number, overrides: Partial<Client>): Client {
  return {
    id,
    name: `Lead ${id}`,
    phone: `549351555${String(id).padStart(4, '0')}`,
    email: `lead${id}@example.test`,
    interest: 'Departamento de dos dormitorios',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function complete(id: number, overrides: Partial<Client>): Client {
  return lead(id, {
    budget: '120000',
    currency: 'USD',
    paymentMethod: 'Contado',
    zones: 'General Paz',
    purpose: 'Vivir',
    purchaseTimeframe: '0-3 meses',
    canMoveForward: 'Sí',
    ...overrides,
  });
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: 'b127',
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Validación B1.2.7',
  };
  crm.teamMembers = [{
    id: 1,
    userId: 'b127-owner',
    name: 'Franco Solís',
    email: 'franco.solis@example.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-07-01T12:00:00.000Z',
  }];
  crm.clients = [
    lead(1, { name: 'Grupo Norte', nextFollowUp: isoOffset(-20) }),
    lead(2, { name: 'Andrés Vega', nextFollowUp: isoOffset(-20) }),
    lead(3, { name: 'Lucía Martín', temperature: 'Caliente', nextFollowUp: isoOffset(-20) }),
    lead(4, { name: 'Edgardo', nextAction: 'Confirmar visita', nextFollowUp: isoOffset(-20) }),
    lead(5, { name: 'Lead nuevo', pipeline: 'Nuevo', lastContact: undefined }),
    complete(6, { name: 'Lead calificado', pipeline: 'Calificado' }),
    lead(7, {
      name: 'Seguimiento futuro',
      budget: '120000',
      currency: 'USD',
      nextAction: 'Confirmar monto de entrega',
      nextFollowUp: isoOffset(3),
    }),
    lead(8, { name: 'Seguimiento hoy', nextAction: 'Llamar al cliente', nextFollowUp: isoOffset(0) }),
    lead(9, {
      name: 'Visita hoy',
      pipeline: 'Visita coordinada',
      nextAction: 'Confirmar visita a las 17:30',
      nextFollowUp: isoOffset(0),
    }),
    complete(10, {
      name: 'Ganado',
      pipeline: 'Ganado',
      status: 'Operación ganada',
      nextAction: 'Seguimiento heredado',
      nextFollowUp: isoOffset(-5),
    }),
    complete(11, {
      name: 'Perdido',
      pipeline: 'Perdido',
      status: 'Operación perdida',
      nextAction: 'Seguimiento heredado',
      nextFollowUp: isoOffset(-5),
    }),
  ];
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

function chromePath(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

async function waitServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {
      // Reintento controlado mientras inicia el servidor efímero.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor visual B1.2.7 no disponible.');
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
    const userId = 'b127-owner';
    const key = `trv-crm-basico:user:${userId}`;
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'b127-token',
      refreshToken: 'b127-refresh',
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
  }, { data: fixture() });
  return context;
}

function exactCard(page: Page, name: string): Locator {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.locator('#crm .mvp-lead-compact-card').filter({
    has: page.locator('h3').filter({ hasText: new RegExp(`^${escaped}$`) }),
  });
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-compact-card', {
    state: 'visible',
    timeout: 20_000,
  });
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-compact-card').length === 11);
}

async function visibleAlert(card: Locator): Promise<string> {
  const alert = card.locator('.mvp-lead-alert');
  if (await alert.getAttribute('hidden') !== null) return '';
  return alert.evaluate((element) => {
    const text = element.querySelector<HTMLElement>('.mvp-lead-alert-text');
    if (text && getComputedStyle(text).display !== 'none') return text.textContent?.trim() || '';
    return getComputedStyle(element, '::after').content.replace(/^['"]|['"]$/g, '');
  });
}

async function visualText(card: Locator): Promise<string> {
  const base = (await card.innerText()).replace(/\s+/g, ' ').trim();
  const alert = card.locator('.mvp-lead-alert:not([hidden])');
  if (await alert.count() === 0) return base;
  const hidden = await alert.locator('.mvp-lead-alert-text').evaluate(
    (element) => getComputedStyle(element).display === 'none',
  );
  return hidden ? `${base} ${await visibleAlert(card)}`.trim() : base;
}

function occurrences(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}

interface ExpectedCard {
  alert?: string;
  action?: string;
  date?: string;
  absent?: string[];
  noAlert?: boolean;
  noAction?: boolean;
}

async function expectCard(page: Page, name: string, expected: ExpectedCard): Promise<void> {
  const card = exactCard(page, name);
  assert.equal(await card.count(), 1, `No se encontró una única tarjeta para ${name}.`);
  if (expected.noAlert) {
    assert.equal(await visibleAlert(card), '', `${name} conserva una alerta visual inesperada.`);
    assert.equal(await card.locator('.mvp-lead-alert:not([hidden])').count(), 0);
  }
  if (expected.alert) assert.equal(await visibleAlert(card), expected.alert);
  if (expected.noAction) assert.equal(await card.locator('.mvp-lead-next-action').count(), 0);
  if (expected.action) {
    assert.equal((await card.locator('.mvp-lead-next-action strong').innerText()).trim(), expected.action);
  }
  const small = card.locator('.mvp-lead-next-action small');
  if (expected.date) assert.equal((await small.innerText()).trim(), expected.date);
  else if (!expected.noAction) assert.equal(await small.count(), 0);
  const text = await visualText(card);
  for (const absent of expected.absent ?? []) {
    assert.equal(occurrences(text, absent), 0, `${name} todavía muestra “${absent}”: ${text}`);
  }
}

async function simulatedLegacyHeight(
  card: Locator,
  duplicateDate: string,
): Promise<{ before: number; after: number }> {
  return card.evaluate((element, duplicate) => {
    const after = element.getBoundingClientRect().height;
    const clone = element.cloneNode(true) as HTMLElement;
    clone.style.position = 'fixed';
    clone.style.left = '-10000px';
    clone.style.top = '0';
    clone.style.width = `${element.getBoundingClientRect().width}px`;
    clone.style.visibility = 'hidden';
    const action = clone.querySelector<HTMLElement>('.mvp-lead-next-action > div');
    if (action) {
      const small = document.createElement('small');
      small.textContent = duplicate;
      action.append(small);
    }
    document.querySelector('#crm .mvp-lead-list')?.append(clone);
    const before = clone.getBoundingClientRect().height;
    clone.remove();
    return { before, after };
  }, duplicateDate);
}

async function validateStoredData(page: Page): Promise<void> {
  const stored = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('trv-crm-basico:user:b127-owner') || '{}') as CrmData;
    return data.clients.map((client) => ({
      name: client.name,
      nextAction: client.nextAction,
      nextFollowUp: client.nextFollowUp,
    }));
  });
  assert.deepEqual(stored.find((client) => client.name === 'Grupo Norte'), {
    name: 'Grupo Norte',
    nextAction: undefined,
    nextFollowUp: isoOffset(-20),
  });
  assert.deepEqual(stored.find((client) => client.name === 'Edgardo'), {
    name: 'Edgardo',
    nextAction: 'Confirmar visita',
    nextFollowUp: isoOffset(-20),
  });
}

async function validateFutureAccessibility(page: Page): Promise<void> {
  const card = exactCard(page, 'Seguimiento futuro');
  const alert = card.locator('.mvp-lead-alert:not([hidden])');
  assert.equal(await alert.getAttribute('aria-label'), 'Falta forma de pago');
  assert.equal(await alert.getAttribute('title'), 'Falta forma de pago');
  const action = card.locator('.mvp-lead-next-action');
  const expectedAction = `Próxima acción: Confirmar monto de entrega. Programada para ${exactDateLabel(isoOffset(3))}.`;
  assert.equal(await action.getAttribute('aria-label'), expectedAction);
  assert.equal(await action.getAttribute('title'), expectedAction);
}

async function validateTerminalSheet(page: Page, name: 'Ganado' | 'Perdido'): Promise<void> {
  const card = exactCard(page, name);
  const fullGridText = await card.locator('.mvp-lead-full-grid').innerText();
  assert.match(fullGridText, /Fecha de seguimiento registrada/);
  assert.match(fullGridText, new RegExp(exactDateLabel(isoOffset(-5)).replaceAll('/', '\\/')));
  assert.doesNotMatch(fullGridText, /Seguimiento programado/);
}

async function capture(
  page: Page,
  directory: string,
  viewport: typeof viewports[number],
  name: string,
): Promise<void> {
  const card = exactCard(page, name);
  await card.scrollIntoViewIfNeeded();
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  await card.screenshot({
    path: join(directory, `${viewport.width}x${viewport.height}-${slug}.png`),
    scale: 'css',
  });
}

function validateScreenshots(directory: string, expectedCount: number): void {
  const files = readdirSync(directory).filter((name) => name.endsWith('.png'));
  assert.equal(files.length, expectedCount);
  for (const name of files) {
    const path = join(directory, name);
    const buffer = readFileSync(path);
    assert.ok(statSync(path).size > 1_000, `${name} parece vacío.`);
    assert.deepEqual(
      [...buffer.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${name} no tiene firma PNG válida.`,
    );
    const viewportMatch = name.match(/^(\d+)x(\d+)-/);
    assert.ok(viewportMatch, `No se pudo obtener el viewport desde ${name}.`);
    const pngWidth = buffer.readUInt32BE(16);
    const pngHeight = buffer.readUInt32BE(20);
    assert.ok(pngWidth > 0 && pngWidth <= Number(viewportMatch[1]), `Ancho PNG inválido en ${name}: ${pngWidth}.`);
    assert.ok(pngHeight > 0 && pngHeight <= Number(viewportMatch[2]), `Alto PNG inválido en ${name}: ${pngHeight}.`);
  }
}

test('B1.2.7 elimina duplicados visuales con aplicación compilada y CSS real', { timeout: 300_000 }, async () => {
  const executablePath = chromePath();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.7.');
  const port = 46000 + Math.floor(Math.random() * 1000);
  const url = `http://127.0.0.1:${port}`;
  const screenshots = mkdtempSync(join(tmpdir(), 'propcontrol-b127-'));
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const heights: Array<{ viewport: string; before: number; after: number; reduction: number }> = [];
  let captured = 0;
  try {
    for (const viewport of viewports) {
      const context = await contextFor(browser, viewport);
      try {
        const page = await context.newPage();
        await load(page, url);

        for (const name of ['Grupo Norte', 'Andrés Vega', 'Lucía Martín']) {
          await expectCard(page, name, {
            alert: 'Vencido · 20 días',
            action: 'Definir acción',
            absent: ['fecha vencida', 'Seguimiento vencido'],
          });
          const text = await visualText(exactCard(page, name));
          assert.equal(occurrences(text, 'Vencido'), 1);
          assert.equal(occurrences(text, '20 días'), 1);
          assert.equal(occurrences(text, 'Definir acción'), 1);
        }
        await expectCard(page, 'Edgardo', {
          alert: 'Vencido · 20 días',
          action: 'Confirmar visita',
          absent: ['fecha vencida', 'Seguimiento vencido'],
        });
        await expectCard(page, 'Lead nuevo', {
          alert: 'Nuevo sin contactar',
          action: 'Contactar por primera vez',
          absent: ['Sin próxima acción'],
        });
        await expectCard(page, 'Lead calificado', {
          alert: 'Sin seguimiento',
          action: 'Programar seguimiento',
          absent: ['Calificado sin seguimiento', 'Sin próxima acción', 'Falta programar seguimiento'],
        });
        await expectCard(page, 'Seguimiento futuro', {
          alert: 'Falta forma de pago',
          action: 'Confirmar monto de entrega',
          date: 'En 3 días',
        });
        await expectCard(page, 'Seguimiento hoy', {
          alert: 'Hoy',
          action: 'Llamar al cliente',
        });
        await expectCard(page, 'Visita hoy', {
          alert: 'Visita hoy · 17:30',
          action: 'Confirmar visita',
        });
        assert.equal(occurrences(await visualText(exactCard(page, 'Seguimiento hoy')), 'Hoy'), 1);
        assert.equal(occurrences(await visualText(exactCard(page, 'Visita hoy')), '17:30'), 1);

        await expectCard(page, 'Ganado', { noAlert: true, noAction: true });
        await expectCard(page, 'Perdido', { noAlert: true, noAction: true });
        assert.equal((await exactCard(page, 'Ganado').locator('.mvp-lead-statuses').innerText()).trim(), 'Ganado');
        assert.equal((await exactCard(page, 'Perdido').locator('.mvp-lead-statuses').innerText()).trim(), 'Perdido');
        await validateFutureAccessibility(page);
        await validateTerminalSheet(page, 'Ganado');
        await validateTerminalSheet(page, 'Perdido');
        await validateStoredData(page);

        const widths = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
        }));
        assert.ok(widths.document <= widths.viewport + 1, `Scroll horizontal: ${JSON.stringify(widths)}`);
        assert.ok(widths.body <= widths.viewport + 1, `Scroll horizontal del body: ${JSON.stringify(widths)}`);

        const measured = await Promise.all([
          simulatedLegacyHeight(exactCard(page, 'Grupo Norte'), 'fecha vencida hace 20 días'),
          simulatedLegacyHeight(exactCard(page, 'Andrés Vega'), 'fecha vencida hace 20 días'),
          simulatedLegacyHeight(exactCard(page, 'Lucía Martín'), 'fecha vencida hace 20 días'),
          simulatedLegacyHeight(exactCard(page, 'Edgardo'), 'Vencido hace 20 días'),
        ]);
        const before = measured.reduce((sum, item) => sum + item.before, 0) / measured.length;
        const after = measured.reduce((sum, item) => sum + item.after, 0) / measured.length;
        assert.ok(before >= after, `La deduplicación aumentó la altura en ${viewport.width}px.`);
        heights.push({
          viewport: `${viewport.width}x${viewport.height}`,
          before: Number(before.toFixed(2)),
          after: Number(after.toFixed(2)),
          reduction: Number((before - after).toFixed(2)),
        });

        if (captureWidths.has(viewport.width)) {
          for (const name of captureNames) {
            await capture(page, screenshots, viewport, name);
            captured += 1;
          }
        }
      } finally {
        await context.close();
      }
    }

    assert.equal(captured, 54);
    validateScreenshots(screenshots, 54);
    console.log('# B1.2.7 capturas efímeras generadas y validadas por firma, dimensiones y tamaño: 54');
    console.log(`# B1.2.7 alturas antes/después: ${JSON.stringify(heights)}`);
  } finally {
    await browser.close();
    await stopServer(server);
    rmSync(screenshots, { recursive: true, force: true });
  }
});
