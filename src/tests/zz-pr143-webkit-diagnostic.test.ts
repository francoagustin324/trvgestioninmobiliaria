import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import test from 'node:test';
import { webkit, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'pr143-webkit-diagnostic-owner';
const ORG_ID = 'pr143-webkit-diagnostic-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;

function owner(): TeamMember {
  return {
    id: 1,
    userId: USER_ID,
    name: 'Franco Solis',
    email: 'franco-webkit-diagnostic@propcontrol.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-11T12:00:00.000Z',
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'PR143 WebKit diagnostic' };
  crm.teamMembers = [owner()];
  crm.activityLog = [];
  crm.clients = [{
    id: 1,
    name: 'Lead diagnóstico WebKit',
    phone: '+54 9 351 511-0069',
    email: 'lead-webkit@propcontrol.test',
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
  crm.settings = { ...crm.settings, profileName: owner().name, profileEmail: owner().email, agencyName: 'TRV Gestión Inmobiliaria' };
  return crm;
}

async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('No se obtuvo puerto libre.'));
        return;
      }
      const port = address.port;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url: string, server: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Servidor diagnóstico terminó con ${server.exitCode}.`);
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {
      // retry mientras arranca
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor diagnóstico no disponible.');
}

async function startServer(): Promise<{ server: ChildProcess; url: string }> {
  const port = await freePort();
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
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url, server);
  return { server, url };
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

async function seed(context: BrowserContext): Promise<void> {
  await context.addInitScript(({ crm, storageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: 'pr143-webkit-diagnostic-owner',
      email: 'franco-webkit-diagnostic@propcontrol.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(crm));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({ dirty: false, localUpdatedAt: '2026-08-11T18:00:00.000Z' }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { crm: fixture(), storageKey: STORAGE_KEY });
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.mvp-zero-primary', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => {
    const details = document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters');
    const toggle = document.querySelector<HTMLButtonElement>('#crm [data-pc-toggle-stages]');
    return Boolean(details && !details.open && toggle && !toggle.hidden);
  }, undefined, { timeout: 20_000 });
}

function snapshotScript(): Record<string, unknown> {
  const details = document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters');
  const state = (selector: string): Record<string, unknown> => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return { exists: false };
    const style = getComputedStyle(element);
    return {
      exists: true,
      hidden: element.hidden,
      display: style.display,
      visibility: style.visibility,
      rects: element.getClientRects().length,
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    };
  };
  return {
    open: details?.open ?? null,
    openAttribute: details?.getAttribute('open') ?? null,
    summaryAriaExpanded: details?.querySelector('summary')?.getAttribute('aria-expanded') ?? null,
    stage: state('#mvp-lead-stage-filter'),
    clear: state('[data-pc-clear-filters]'),
    apply: state('[data-pc-apply-filters]'),
    actions: state('[data-pc-filter-actions]'),
  };
}

test('DIAGNÓSTICO TEMPORAL PR143 WebKit disclosure', { timeout: 60_000 }, async () => {
  const started = await startServer();
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    screen: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
  });
  await seed(context);
  try {
    const page = await context.newPage();
    await load(page, started.url);
    const before = await page.evaluate(snapshotScript);
    await page.locator('#crm .mvp-lead-more-filters > summary').click();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const after = await page.evaluate(snapshotScript);
    console.log(`PR143_WEBKIT_DISCLOSURE_BEFORE=${JSON.stringify(before)}`);
    console.log(`PR143_WEBKIT_DISCLOSURE_AFTER=${JSON.stringify(after)}`);
    const visible = (value: unknown): boolean => {
      const state = value as { exists?: boolean; display?: string; visibility?: string; rects?: number };
      return state.exists === true && state.display !== 'none' && state.visibility !== 'hidden' && Number(state.rects) > 0;
    };
    assert.ok(after.open === true && visible(after.stage) && visible(after.clear) && visible(after.apply), JSON.stringify(after));
  } finally {
    await context.close();
    await browser.close();
    await stopServer(started.server);
  }
});