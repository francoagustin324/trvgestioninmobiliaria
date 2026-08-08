import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type BrowserContext, type Page, type Route } from 'playwright';
import { crmToCloudRecords, type CloudMembershipContext, type CloudRecordRow } from '../cloud-records.js';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'none-cloud-owner';
const ORG_ID = 'none-cloud-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const FIXED_TIME = new Date('2026-08-07T16:52:00-03:00');
const AUTO_DATE = '2026-08-10';

interface NoneCloudWindow extends Window {
  __noneCloudMessages?: string[];
}

function owner(): TeamMember {
  return {
    id: 1,
    userId: USER_ID,
    name: 'Franco Solis',
    email: 'franco@propcontrol.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-01T12:00:00.000Z',
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'None cloud' };
  crm.teamMembers = [owner()];
  crm.activityLog = [];
  crm.clients = [{
    id: 1,
    name: 'Lucía Martín',
    phone: '+54 9 351 511-0069',
    email: 'lucia@ejemplo.com',
    interest: 'Dúplex en Docta',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
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

function cloudContext(): CloudMembershipContext {
  return { organizationId: ORG_ID, currentMemberId: 1, currentRole: 'Dueño', members: [owner()] };
}

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(`${url}/health`)).ok) return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor de prueba no disponible.');
}

async function startServer(port: number): Promise<ChildProcess> {
  const server = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' },
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

async function installCloud(context: BrowserContext, initial: CrmData): Promise<() => CloudRecordRow[]> {
  let remote = crmToCloudRecords(initial, cloudContext(), USER_ID).map((record) => ({ ...structuredClone(record), updated_at: '2026-08-07T19:40:00.000Z' }));
  let version = 0;

  await context.route('**/api/cloud-config', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, url: new URL(route.request().url()).origin, publishableKey: 'key' }) });
  });
  await context.route('**/rest/v1/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const fulfill = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.pathname.endsWith('/rpc/activate_my_organization_memberships')) return fulfill({});
    if (url.pathname.endsWith('/organization_members')) {
      return fulfill([{ organization_id: ORG_ID, member_id: 1, user_id: USER_ID, role: 'owner', status: 'active', display_name: owner().name, email: owner().email, created_at: owner().createdAt }]);
    }
    if (url.pathname.endsWith('/propcontrol_records') && method === 'GET') return fulfill(remote);
    if (url.pathname.endsWith('/propcontrol_records') && method === 'DELETE') return fulfill([]);
    if (url.pathname.endsWith('/propcontrol_records') && method === 'POST') {
      version += 1;
      const stamp = `2026-08-07T19:55:${String(version).padStart(2, '0')}.000Z`;
      remote = (request.postDataJSON() as CloudRecordRow[]).map((record) => ({ ...structuredClone(record), updated_at: stamp }));
      return fulfill([]);
    }
    return route.fulfill({ status: 404, body: '{}' });
  });

  return () => structuredClone(remote);
}

async function installStorage(context: BrowserContext, crm: CrmData): Promise<void> {
  const actorKey = `cloud:${USER_ID}`;
  const identityKey = `propcontrol-whatsapp-human-identity-v1:${encodeURIComponent(ORG_ID)}:1:${encodeURIComponent(actorKey)}`;
  await context.addInitScript(({ data, identityStorageKey }) => {
    const target = window as NoneCloudWindow;
    target.__noneCloudMessages = [];
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({ accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000, userId: 'none-cloud-owner', email: 'franco@propcontrol.test' }));
    if (!localStorage.getItem('trv-crm-basico:user:none-cloud-owner')) localStorage.setItem('trv-crm-basico:user:none-cloud-owner', JSON.stringify(data));
    if (!localStorage.getItem('trv-crm-basico:user:none-cloud-owner:sync')) {
      localStorage.setItem('trv-crm-basico:user:none-cloud-owner:sync', JSON.stringify({ dirty: false, localUpdatedAt: '2026-08-07T19:40:00.000Z', lastCloudSavedAt: '2026-08-07T19:40:00.000Z', lastCloudVersion: '2026-08-07T19:40:00.000Z' }));
    }
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
    localStorage.setItem(identityStorageKey, JSON.stringify({ version: 1, organizationId: 'none-cloud-org', memberId: 1, actorKey: 'cloud:none-cloud-owner', humanName: 'Franco Solis', confirmedAt: '2026-08-07T19:40:00.000Z' }));
    document.addEventListener('propcontrol-cloud-status', (event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      if (message) target.__noneCloudMessages?.push(message);
    });
    Object.defineProperty(window, 'open', { configurable: true, value: () => null });
  }, { data: crm, identityStorageKey: identityKey });
}

async function load(page: Page, url: string): Promise<void> {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('[data-contact-whatsapp="1"]', { state: 'visible', timeout: 20_000 });
}

async function waitForSafeSave(page: Page): Promise<void> {
  await page.clock.runFor(850);
  await page.waitForFunction(() => ((window as NoneCloudWindow).__noneCloudMessages || []).includes('Guardado seguro en la nube.'), null, { timeout: 20_000 });
}

async function stored(page: Page): Promise<CrmData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}') as CrmData, STORAGE_KEY);
}

test('none persiste en nube y después de F5 conserva contacto sin Agenda ni Reminder', { timeout: 180_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible.');
  const port = 62020 + Math.floor(Math.random() * 80);
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-AR', timezoneId: 'America/Argentina/Cordoba', colorScheme: 'dark' });
  const data = fixture();
  await installStorage(context, data);
  const remote = await installCloud(context, data);

  try {
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);
    await page.locator('[data-contact-whatsapp="1"]').click();
    await page.locator('[data-whatsapp-open]').click();
    await page.clock.runFor(750);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible' });
    await page.locator('[data-whatsapp-confirm-sent]').click();
    await waitForSafeSave(page);

    let local = await stored(page);
    assert.equal(local.clients[0]?.nextFollowUp, AUTO_DATE);
    assert.equal(local.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 1);
    assert.equal(local.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 1);
    assert.equal(local.reminders.length, 0);

    await page.evaluate(() => { (window as NoneCloudWindow).__noneCloudMessages = []; });
    await page.locator('[data-whatsapp-change-followup]').click();
    const form = page.locator('[data-zero-followup-form]');
    await form.locator('input[name="follow-up-choice"][value="none"]').check();
    assert.equal(await form.locator('[data-zero-followup-preview]').textContent(), 'No se programará un próximo seguimiento.');
    await form.locator('button[type="submit"]').click();
    await page.getByText('Contacto registrado', { exact: true }).waitFor({ state: 'visible' });
    await waitForSafeSave(page);

    local = await stored(page);
    assert.equal(local.clients[0]?.nextFollowUp, undefined);
    assert.equal(local.clients[0]?.nextAction, undefined);
    assert.equal(local.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 1);
    assert.equal(local.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 1);
    assert.equal(local.reminders.length, 0);

    const remoteClient = remote().find((row) => row.entity_type === 'client')?.payload as { nextFollowUp?: string; nextAction?: string };
    assert.equal(remoteClient.nextFollowUp, undefined);
    assert.equal(remoteClient.nextAction, undefined);
    assert.equal(remote().filter((row) => row.entity_type === 'activity' && (row.payload as { action?: string }).action === 'Contacto por WhatsApp').length, 1);
    assert.equal(remote().filter((row) => row.entity_type === 'reminder').length, 0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
    local = await stored(page);
    assert.equal(local.clients[0]?.nextFollowUp, undefined);
    assert.equal(local.clients[0]?.nextAction, undefined);
    assert.equal(local.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 1, 'F5 conserva el contacto histórico.');
    assert.equal(local.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 1);
    assert.equal(local.reminders.length, 0);
    assert.doesNotMatch(await page.locator('.mvp-lead-card[data-client-id="1"] .mvp-lead-next-action').innerText(), /En 3 días/i);
    await page.locator('[data-module="agenda"]:visible').first().click();
    await page.waitForSelector('#agenda.active', { state: 'visible' });
    assert.equal(await page.locator('#agenda.active .agenda-card').filter({ hasText: 'Lucía Martín' }).count(), 0);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
