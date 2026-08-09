import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'zero-training-visual-owner';
const ORG_ID = 'zero-training-visual-org';
const FIXED_TIME = new Date('2026-08-07T16:00:00-03:00');

interface TestWindow extends Window { __zeroTrainingVisualOpenedUrl?: string; }

function owner(): TeamMember {
  return { id: 1, userId: USER_ID, name: 'Franco Solis', email: 'franco.visual@propcontrol.test', phone: '5493515110069', role: 'Dueño', status: 'Activo', createdAt: '2026-08-01T12:00:00.000Z' };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Zero training visual' };
  crm.teamMembers = [owner()];
  crm.activityLog = [];
  crm.clients = [{ id: 1, name: 'Lucía Martín', phone: '+54 9 351 511-0069', email: 'lucia@ejemplo.com', interest: 'Dúplex en Docta', budget: 'USD 120000', currency: 'USD', status: 'Lead', temperature: 'Tibio', pipeline: 'Nuevo', assignedToId: 1, createdById: 1 }];
  crm.reminders = [];
  crm.conversations = [];
  crm.properties = [];
  crm.contacts = [];
  crm.fichas = [];
  crm.settings = { ...crm.settings, profileName: owner().name, profileEmail: owner().email, agencyName: 'TRV Gestión Inmobiliaria' };
  return crm;
}

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(`${url}/health`)).ok) return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor de prueba visual no disponible.');
}

async function startServer(port: number): Promise<ChildProcess> {
  const server = spawn(process.execPath, ['dist/server.js'], {
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
  await waitForServer(`http://127.0.0.1:${port}`);
  return server;
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { if (server.exitCode === null) server.kill('SIGKILL'); resolve(); }, 2_000);
    server.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function contextFor(browser: Browser, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const actorKey = `cloud:${USER_ID}`;
  const identityKey = `propcontrol-whatsapp-human-identity-v1:${encodeURIComponent(ORG_ID)}:1:${encodeURIComponent(actorKey)}`;
  const mobile = viewport.width <= 430;
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'es-AR', timezoneId: 'America/Argentina/Cordoba', colorScheme: 'dark' });
  await context.addInitScript(({ crm, identityStorageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({ accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000, userId: 'zero-training-visual-owner', email: 'franco.visual@propcontrol.test' }));
    localStorage.setItem('trv-crm-basico:user:zero-training-visual-owner', JSON.stringify(crm));
    localStorage.setItem('trv-crm-basico:user:zero-training-visual-owner:sync', JSON.stringify({ dirty: false, localUpdatedAt: '2026-08-07T18:00:00.000Z', lastCloudSavedAt: '2026-08-07T18:00:00.000Z', lastCloudVersion: '2026-08-07T18:00:00.000Z' }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
    localStorage.setItem(identityStorageKey, JSON.stringify({ version: 1, organizationId: 'zero-training-visual-org', memberId: 1, actorKey: 'cloud:zero-training-visual-owner', humanName: 'Franco Solis', confirmedAt: '2026-08-07T18:00:00.000Z' }));
    Object.defineProperty(window, 'open', { configurable: true, value: (url?: string | URL) => { (window as TestWindow).__zeroTrainingVisualOpenedUrl = String(url || ''); return null; } });
  }, { crm: fixture(), identityStorageKey: identityKey });
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.mvp-lead-card[data-client-id="1"] [data-contact-whatsapp="1"]', { state: 'visible', timeout: 20_000 });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(geometry.doc <= geometry.viewport + 1, JSON.stringify(geometry));
  assert.ok(geometry.body <= geometry.viewport + 1, JSON.stringify(geometry));
}

async function assertMobileWhatsAppGeometry(page: Page): Promise<void> {
  const card = page.locator('.mvp-lead-card[data-client-id="1"]');
  const actions = card.locator('.mvp-lead-quick-actions[data-zero-training-actions="true"]');
  const geometry = await actions.evaluate((root) => {
    const whatsapp = root.querySelector<HTMLElement>('.mvp-zero-primary');
    const edit = root.querySelector<HTMLElement>('.mvp-zero-edit');
    const menu = root.querySelector<HTMLElement>('.mvp-lead-actions-menu > summary');
    if (!whatsapp || !edit || !menu) return null;
    const primary = whatsapp.getBoundingClientRect();
    const secondary = edit.getBoundingClientRect();
    const tertiary = menu.getBoundingClientRect();
    return {
      viewport: innerWidth,
      text: whatsapp.textContent?.trim() || '',
      primary: { left: primary.left, right: primary.right, width: primary.width, height: primary.height, clientWidth: whatsapp.clientWidth, scrollWidth: whatsapp.scrollWidth },
      secondary: { left: secondary.left, right: secondary.right, width: secondary.width, height: secondary.height },
      tertiary: { left: tertiary.left, right: tertiary.right, width: tertiary.width, height: tertiary.height },
    };
  });
  assert.ok(geometry, 'No se pudo medir la fila de acciones móvil.');
  assert.equal(geometry.text, 'WhatsApp');
  assert.ok(geometry.primary.width >= 110, JSON.stringify(geometry));
  assert.ok(geometry.primary.width >= geometry.secondary.width, JSON.stringify(geometry));
  assert.ok(geometry.primary.scrollWidth <= geometry.primary.clientWidth + 1, JSON.stringify(geometry));
  assert.ok([geometry.primary, geometry.secondary, geometry.tertiary].every((box) => box.height >= 44 && box.left >= 0 && box.right <= geometry.viewport + 1), JSON.stringify(geometry));
  await noHorizontalScroll(page);
}

test('FASE 1 auditoría visual: contraste desktop, editor progresivo, resultado opaco y WhatsApp móvil estable', { timeout: 180_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible.');
  const port = 61990 + Math.floor(Math.random() * 60);
  const server = await startServer(port);
  const browser: Browser = await chromium.launch({ executablePath, headless: true });
  try {
    const desktop = await contextFor(browser, { width: 1366, height: 768 });
    try {
      const page = await desktop.newPage();
      await load(page, `http://127.0.0.1:${port}`);
      const card = page.locator('.mvp-lead-card[data-client-id="1"]');
      const nextStyle = await card.locator('.mvp-lead-next-action').evaluate((element) => {
        const label = element.querySelector<HTMLElement>('.mvp-zero-next-copy span');
        const action = element.querySelector<HTMLElement>('.mvp-zero-next-copy strong');
        return {
          background: getComputedStyle(element).backgroundColor,
          label: label ? getComputedStyle(label).color : '',
          action: action ? getComputedStyle(action).color : '',
        };
      });
      assert.match(nextStyle.background, /^rgba\(255, 255, 255, 0\.05\)$/);
      assert.notEqual(nextStyle.label, nextStyle.background);
      assert.notEqual(nextStyle.action, nextStyle.background);

      await card.getByRole('button', { name: 'WhatsApp', exact: true }).click();
      const panel = page.locator('.whatsapp-contact-panel');
      await panel.waitFor({ state: 'visible' });
      const preview = panel.locator('[data-whatsapp-message-preview]');
      const editor = panel.locator('[data-whatsapp-message-editor]');
      const textarea = panel.locator('[data-whatsapp-message]');
      assert.equal(await preview.isVisible(), true);
      assert.equal(await editor.isVisible(), false);
      assert.equal(await panel.locator('[data-whatsapp-open]:visible').count(), 1);

      await panel.getByRole('button', { name: 'Editar mensaje', exact: true }).click();
      assert.equal(await editor.isVisible(), true);
      assert.equal(await textarea.isVisible(), true);
      assert.equal(await preview.isVisible(), false);
      assert.equal(await panel.locator('[data-whatsapp-open]:visible').count(), 1);
      const editedMessage = 'Hola Lucía, te escribo por el dúplex en Docta. Quedo atento.';
      await textarea.fill(editedMessage);
      assert.equal(await textarea.inputValue(), editedMessage);

      await panel.locator('[data-whatsapp-open]').click();
      const openedUrl = await page.evaluate(() => (window as TestWindow).__zeroTrainingVisualOpenedUrl || '');
      assert.match(decodeURIComponent(openedUrl), /Quedo atento\./);
      await page.clock.runFor(800);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await panel.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible', timeout: 10_000 });
      await panel.locator('[data-whatsapp-confirm-sent]').click();
      await panel.getByText('Listo. Próximo contacto: Mañana', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
      const doneBackground = await panel.evaluate((element) => getComputedStyle(element).backgroundColor);
      assert.doesNotMatch(doneBackground, /^rgba\(/, `El resultado debe ser opaco: ${doneBackground}`);
    } finally {
      await desktop.close();
    }

    const mobile = await contextFor(browser, { width: 390, height: 844 });
    try {
      const page = await mobile.newPage();
      await load(page, `http://127.0.0.1:${port}`);
      await assertMobileWhatsAppGeometry(page);
      await page.setViewportSize({ width: 360, height: 800 });
      await page.waitForTimeout(100);
      await assertMobileWhatsAppGeometry(page);
    } finally {
      await mobile.close();
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
