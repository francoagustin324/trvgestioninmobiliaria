import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'p1-a2-1-owner';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;

function owner(): TeamMember {
  return {
    id: 1,
    userId: USER_ID,
    name: 'Franco Solis',
    email: 'franco@propcontrol.test',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-24T12:00:00.000Z',
  };
}

function blockedFixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: 'p1-a2-1-org', name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'P1.1-A2.1' };
  crm.teamMembers = [owner()];
  crm.clients = [{
    id: 1,
    name: 'Lead a filtrar',
    phone: '+54 9 351 555-0101',
    interest: 'Dúplex en Docta',
    budget: '120000',
    currency: 'USD',
    paymentMethod: 'Contado',
    zones: 'Docta',
    purpose: undefined,
    purchaseTimeframe: '0-3 meses',
    canMoveForward: 'Sí',
    knowsArea: 'Sí',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    nextAction: 'Confirmar finalidad',
    nextFollowUp: '2026-08-26',
    assignedToId: 1,
    createdById: 1,
  }];
  crm.properties = [{
    id: 10,
    title: 'Docta Etapa 3',
    address: 'Docta, Córdoba',
    type: 'Dúplex',
    operation: 'Venta',
    price: 133000,
    owner: 'Constructor',
    status: 'Disponible',
    assignedToId: 1,
    createdById: 1,
  }];
  crm.visits = [];
  crm.reminders = [];
  crm.activityLog = [];
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
      // retry local test server only
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor P1.1-A2.1 no disponible.');
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

async function seed(context: BrowserContext): Promise<void> {
  await context.addInitScript(({ crm, storageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: 'p1-a2-1-owner',
      email: 'franco@propcontrol.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(crm));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-08-24T12:00:00.000Z',
      lastCloudSavedAt: '2026-08-24T12:00:00.000Z',
      lastCloudVersion: '2026-08-24T12:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { crm: blockedFixture(), storageKey: STORAGE_KEY });
}

async function openLead(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  const lead = page.locator('.mvp-lead-card[data-client-id="1"]');
  await lead.waitFor({ state: 'visible', timeout: 20_000 });
  const actions = lead.locator('.mvp-lead-actions-menu');
  await actions.waitFor({ state: 'visible', timeout: 10_000 });
  if (!(await actions.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await actions.locator(':scope > summary').click();
  }
  await actions.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  await page.waitForSelector('[data-lead-visits="1"]', { state: 'visible', timeout: 10_000 });
}

async function assertNoOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(metrics.html <= metrics.viewport + 1, `${label}: html overflow ${JSON.stringify(metrics)}`);
  assert.ok(metrics.body <= metrics.viewport + 1, `${label}: body overflow ${JSON.stringify(metrics)}`);
}

test('P1.1-A2.1 browser bloquea coordinación y muestra una sola próxima pregunta en desktop/mobile', { timeout: 120_000 }, async () => {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chrome para validar P1.1-A2.1.');
    return;
  }
  const port = 48233;
  const server = await startServer(port);
  const browser = await chromium.launch({ headless: true, executablePath: executable });
  try {
    for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      try {
        await seed(context);
        const page = await context.newPage();
        await openLead(page, `http://127.0.0.1:${port}`);

        const gate = page.locator('[data-visit-qualification-gate="1"]');
        await gate.waitFor({ state: 'visible' });
        assert.match(await gate.innerText(), /No conviene coordinar todavía/);
        assert.match(await gate.innerText(), /Próxima pregunta: ¿La propiedad sería para vivir, invertir o para otra finalidad\?/);
        assert.equal(await page.locator('.pc-visit-coordinate').count(), 0);
        assert.equal(await page.locator('form[data-coordinate-visit]').count(), 0);
        assert.equal(await page.locator('[data-lead-visits="1"] input[type="date"]').count(), 0);

        const stateSnapshot = await page.evaluate(async () => {
          const store = await import('/dist/store.js');
          const client = store.state.crm.clients[0];
          return {
            visits: store.state.crm.visits.length,
            pipeline: client?.pipeline,
            nextAction: client?.nextAction,
            nextFollowUp: client?.nextFollowUp,
            activity: store.state.crm.activityLog.length,
            reminders: store.state.crm.reminders.length,
          };
        });
        assert.deepEqual(stateSnapshot, {
          visits: 0,
          pipeline: 'Contactado',
          nextAction: 'Confirmar finalidad',
          nextFollowUp: '2026-08-26',
          activity: 0,
          reminders: 0,
        });
        await assertNoOverflow(page, viewport.width === 390 ? 'mobile gate' : 'desktop gate');
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
});