import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'mobile-real-validation-owner';
const ORG_ID = 'mobile-real-validation-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const VIEWPORTS = [320, 360, 375, 390, 412, 430, 520] as const;

function owner(): TeamMember {
  return {
    id: 1,
    userId: USER_ID,
    name: 'Franco Solis',
    email: 'franco@propcontrol.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-09T12:00:00.000Z',
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Mobile validation' };
  crm.teamMembers = [owner()];
  crm.activityLog = [];
  crm.clients = [{
    id: 1,
    name: 'Lucía Martín',
    phone: '+54 9 351 511-0069',
    email: 'lucia@ejemplo.com',
    interest: 'Dúplex en Docta',
    budget: 'USD 120000',
    currency: 'USD',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    assignedToId: 1,
    createdById: 1,
  }];
  crm.reminders = [];
  crm.conversations = [];
  crm.properties = [];
  crm.contacts = [];
  crm.fichas = [];
  crm.settings = {
    ...crm.settings,
    profileName: owner().name,
    profileEmail: owner().email,
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
}

function chromeExecutable(): string | undefined {
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(existsSync);
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor de prueba no disponible.');
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

async function mobileContext(browser: Browser): Promise<BrowserContext> {
  const actorKey = `cloud:${USER_ID}`;
  const identityKey = `propcontrol-whatsapp-human-identity-v1:${encodeURIComponent(ORG_ID)}:1:${encodeURIComponent(actorKey)}`;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; moto g54 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
  });
  await context.addInitScript(({ crm, identityStorageKey, storageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: 'mobile-real-validation-owner',
      email: 'franco@propcontrol.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(crm));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-08-09T18:00:00.000Z',
      lastCloudSavedAt: '2026-08-09T18:00:00.000Z',
      lastCloudVersion: '2026-08-09T18:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
    localStorage.setItem(identityStorageKey, JSON.stringify({
      version: 1,
      organizationId: 'mobile-real-validation-org',
      memberId: 1,
      actorKey: 'cloud:mobile-real-validation-owner',
      humanName: 'Franco Solis',
      confirmedAt: '2026-08-09T18:00:00.000Z',
    }));
  }, { crm: fixture(), identityStorageKey: identityKey, storageKey: STORAGE_KEY });
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.pc-leads-heading', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.pc-attention-section', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.mvp-lead-card[data-client-id="1"] .mvp-zero-primary', { state: 'visible', timeout: 20_000 });
}

test('postproducción móvil usa una hoja final nueva y cache-busteada', () => {
  const html = readFileSync('index.html', 'utf8');
  const css = readFileSync('src/leads-mobile-real-validation.css', 'utf8');
  assert.ok(html.includes('/src/leads-mobile-real-validation.css?v=20260809-1'));
  assert.ok(html.indexOf('leads-mobile-real-validation.css') > html.indexOf('leads-zero-training-safety.css'));
  assert.match(css, /mvp-zero-primary::before/);
  assert.match(css, /mvp-zero-primary::after/);
  assert.match(css, /content:\s*none\s*!important/);
  assert.match(css, /@media \(max-width: 520px\)/);
});

test('Chrome Android equivalente: CTA y cabecera Leads resisten la matriz móvil real', { timeout: 180_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible.');
  const port = 61900 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await mobileContext(browser);

  try {
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);

    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: width <= 360 ? 800 : 844 });
      await page.waitForTimeout(80);

      const snapshot = await page.evaluate(() => {
        const button = document.querySelector<HTMLElement>('#crm .mvp-zero-primary.mvp-whatsapp-contact-button');
        const actions = document.querySelector<HTMLElement>('#crm .mvp-lead-quick-actions[data-zero-training-actions="true"]');
        const heading = document.querySelector<HTMLElement>('#crm .pc-leads-heading');
        const controls = document.querySelector<HTMLElement>('#crm .pc-lead-controls');
        const card = document.querySelector<HTMLElement>('#crm .mvp-lead-card[data-client-id="1"]');
        const count = document.querySelector<HTMLElement>('#crm #mvp-lead-count');
        const priorities = document.querySelector<HTMLElement>('#crm .pc-attention-grid');
        const stages = document.querySelector<HTMLElement>('#crm .pc-stage-summary[data-expanded="false"] .mvp-stage-counters');
        const filters = document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters');
        if (!button || !actions || !heading || !controls || !card || !count || !priorities || !stages || !filters) {
          throw new Error('Faltan elementos de Leads para validar.');
        }

        const buttonStyle = getComputedStyle(button);
        const before = getComputedStyle(button, '::before');
        const after = getComputedStyle(button, '::after');
        const actionBoxes = Array.from(actions.querySelectorAll<HTMLElement>(':scope > button, :scope > details > summary')).map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            clientWidth: node.clientWidth,
            scrollWidth: node.scrollWidth,
            text: node.textContent?.trim() || '',
          };
        });
        const headingRect = heading.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const countRect = count.getBoundingClientRect();
        const prioritiesRect = priorities.getBoundingClientRect();
        const stagesRect = stages.getBoundingClientRect();
        const visibleSecondaryStages = Array.from(stages.querySelectorAll<HTMLElement>('[data-pc-secondary-stage]'))
          .filter((node) => getComputedStyle(node).display !== 'none').length;

        return {
          viewport: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          crmWidth: document.querySelector<HTMLElement>('#crm')?.scrollWidth || 0,
          crmClientWidth: document.querySelector<HTMLElement>('#crm')?.clientWidth || 0,
          text: button.textContent?.trim() || '',
          before: before.content,
          after: after.content,
          background: buttonStyle.backgroundColor,
          color: buttonStyle.color,
          actionBoxes,
          topRegionHeight: cardRect.top - headingRect.top,
          countHeight: countRect.height,
          prioritiesHeight: prioritiesRect.height,
          stagesHeight: stagesRect.height,
          filtersOpen: filters.open,
          visibleSecondaryStages,
        };
      });

      assert.equal(snapshot.text, 'WhatsApp', `texto CTA @${width}`);
      assert.equal(snapshot.before, 'none', `::before CTA @${width}`);
      assert.equal(snapshot.after, 'none', `::after CTA @${width}`);
      assert.equal(snapshot.background, 'rgb(27, 112, 69)', `verde CTA @${width}`);
      assert.equal(snapshot.color, 'rgb(247, 255, 249)', `contraste CTA @${width}`);
      assert.ok(snapshot.documentWidth <= snapshot.viewport + 1, `document overflow @${width}: ${JSON.stringify(snapshot)}`);
      assert.ok(snapshot.bodyWidth <= snapshot.viewport + 1, `body overflow @${width}: ${JSON.stringify(snapshot)}`);
      assert.ok(snapshot.crmWidth <= snapshot.crmClientWidth + 1, `CRM overflow @${width}: ${JSON.stringify(snapshot)}`);
      assert.deepEqual(snapshot.actionBoxes.map((box) => box.text), ['WhatsApp', 'Editar', '•••'], `acciones @${width}`);
      assert.ok(snapshot.actionBoxes.every((box) => box.left >= 0 && box.right <= snapshot.viewport + 1 && box.width >= 44), `geometría acciones @${width}: ${JSON.stringify(snapshot.actionBoxes)}`);
      assert.ok(snapshot.actionBoxes.every((box) => box.scrollWidth <= box.clientWidth + 1), `texto cortado @${width}: ${JSON.stringify(snapshot.actionBoxes)}`);
      assert.equal(snapshot.filtersOpen, false, `filtros cerrados por defecto @${width}`);
      assert.ok(snapshot.countHeight <= 28, `contador demasiado alto @${width}: ${snapshot.countHeight}`);
      assert.ok(snapshot.prioritiesHeight <= 48, `prioridades demasiado altas @${width}: ${snapshot.prioritiesHeight}`);
      assert.ok(snapshot.stagesHeight <= 48, `pipeline colapsado demasiado alto @${width}: ${snapshot.stagesHeight}`);
      assert.equal(snapshot.visibleSecondaryStages, 0, `pipeline secundario visible sin expandir @${width}`);
      assert.ok(snapshot.topRegionHeight <= 430, `primer lead demasiado abajo @${width}: ${snapshot.topRegionHeight}`);
    }
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
