import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import { crmToCloudRecords, type CloudMembershipContext, type CloudRecordRow } from '../cloud-records.js';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'cloud-followup-owner';
const ORG_ID = 'cloud-followup-org';
const SESSION_KEY = 'propcontrol-cloud-session-v1';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const SYNC_KEY = `${STORAGE_KEY}:sync`;
const ACTIVE_MEMBER_KEY = 'propcontrol-active-team-member-v1';
const FIXED_TIME = new Date('2026-08-07T16:52:00-03:00');
const FOLLOW_UP_DATE = '2026-08-10';
const ARTIFACT_DIR = 'artifacts/cloud-followup-hotfix';

interface TestWindow extends Window {
  __cloudMessages?: string[];
  __windowOpened?: boolean;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
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
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Hotfix cloud' };
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

function contextForCloud(): CloudMembershipContext {
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

function stamp(records: CloudRecordRow[], value: string): CloudRecordRow[] {
  return records.map((record) => ({ ...structuredClone(record), updated_at: value }));
}

async function installCloudRoutes(context: BrowserContext, initial: CrmData): Promise<{
  firstWriteStarted: Promise<void>;
  releaseFirstWrite: () => void;
  postCount: () => number;
  remote: () => CloudRecordRow[];
}> {
  let remote = stamp(crmToCloudRecords(initial, contextForCloud(), USER_ID), '2026-08-07T19:40:00.000Z');
  let postCount = 0;
  const firstStarted = deferred();
  const firstRelease = deferred();

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
      postCount += 1;
      const body = request.postDataJSON() as CloudRecordRow[];
      if (postCount === 1) {
        firstStarted.resolve();
        await firstRelease.promise;
      }
      remote = stamp(body, postCount === 1 ? '2026-08-07T19:52:01.000Z' : `2026-08-07T19:52:${String(postCount).padStart(2, '0')}.000Z`);
      return fulfill([]);
    }
    return route.fulfill({ status: 404, body: '{}' });
  });

  return { firstWriteStarted: firstStarted.promise, releaseFirstWrite: firstRelease.resolve, postCount: () => postCount, remote: () => structuredClone(remote) };
}

async function installStorage(context: BrowserContext, crm: CrmData): Promise<void> {
  const actorKey = `cloud:${USER_ID}`;
  const identityKey = `propcontrol-whatsapp-human-identity-v1:${encodeURIComponent(ORG_ID)}:1:${encodeURIComponent(actorKey)}`;
  await context.addInitScript(({ data, identityStorageKey }) => {
    const target = window as TestWindow;
    target.__cloudMessages = [];
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000,
      userId: 'cloud-followup-owner', email: 'franco@propcontrol.test',
    }));
    if (!localStorage.getItem('trv-crm-basico:user:cloud-followup-owner')) localStorage.setItem('trv-crm-basico:user:cloud-followup-owner', JSON.stringify(data));
    if (!localStorage.getItem('trv-crm-basico:user:cloud-followup-owner:sync')) {
      localStorage.setItem('trv-crm-basico:user:cloud-followup-owner:sync', JSON.stringify({ dirty: false, localUpdatedAt: '2026-08-07T19:40:00.000Z', lastCloudSavedAt: '2026-08-07T19:40:00.000Z', lastCloudVersion: '2026-08-07T19:40:00.000Z' }));
    }
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
    localStorage.setItem(identityStorageKey, JSON.stringify({ version: 1, organizationId: 'cloud-followup-org', memberId: 1, actorKey: 'cloud:cloud-followup-owner', humanName: 'Franco Solis', confirmedAt: '2026-08-07T19:40:00.000Z' }));
    document.addEventListener('propcontrol-cloud-status', (event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      if (message) target.__cloudMessages?.push(message);
    });
    Object.defineProperty(window, 'open', { configurable: true, value: () => { target.__windowOpened = true; return null; } });
  }, { data: crm, identityStorageKey: identityKey });
}

async function load(page: Page, url: string): Promise<void> {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('[data-contact-whatsapp="1"]', { state: 'visible', timeout: 20_000 });
}

function activityCount(records: CloudRecordRow[], action: string): number {
  return records.filter((row) => row.entity_type === 'activity' && (row.payload as { action?: string }).action === action).length;
}

async function waitForSafeCloudSave(page: Page): Promise<void> {
  await page.clock.runFor(850);
  await page.waitForFunction(() => ((window as TestWindow).__cloudMessages || []).includes('Guardado seguro en la nube.'), null, { timeout: 20_000 });
}

test('navegador real: contacto cloud A en vuelo + seguimiento automático B + confirmación + reload conserva tarjeta, resumen y Agenda', { timeout: 240_000 }, async () => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible.');
  const port = 61520 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  const browser: Browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-AR', timezoneId: 'America/Argentina/Cordoba', colorScheme: 'dark' });
  const data = fixture();
  await installStorage(context, data);
  const cloud = await installCloudRoutes(context, data);

  try {
    const page = await context.newPage();
    const url = `http://127.0.0.1:${port}`;
    await load(page, url);

    await page.locator('[data-contact-whatsapp="1"]').click();
    await page.locator('[data-whatsapp-open]').click();
    await page.clock.runFor(750);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible' });
    await page.locator('[data-whatsapp-confirm-sent]').click();
    await page.clock.runFor(750);

    await cloud.firstWriteStarted;
    assert.equal(cloud.postCount(), 1, 'A debe ser el único push en vuelo');

    assert.equal(await page.evaluate((key) => (JSON.parse(localStorage.getItem(key) || '{}') as CrmData).clients[0]?.nextFollowUp, STORAGE_KEY), FOLLOW_UP_DATE);
    await page.clock.runFor(850);
    assert.equal(cloud.postCount(), 1, 'La cola mantiene un único POST mientras el primero sigue en vuelo');
    cloud.releaseFirstWrite();
    await page.waitForFunction(() => ((window as TestWindow).__cloudMessages || []).includes('Guardado seguro en la nube.'), null, { timeout: 20_000 });
    assert.ok(cloud.postCount() >= 1 && cloud.postCount() <= 2, `La cola segura usó ${cloud.postCount()} push(es).`);
    let remoteClient = cloud.remote().find((row) => row.entity_type === 'client')?.payload as { nextFollowUp?: string; nextAction?: string };
    assert.equal(remoteClient.nextFollowUp, FOLLOW_UP_DATE);
    assert.equal(remoteClient.nextAction, 'Volver a contactar por WhatsApp');
    assert.equal(activityCount(cloud.remote(), 'Contacto por WhatsApp'), 1);
    assert.equal(activityCount(cloud.remote(), 'Seguimiento por WhatsApp programado'), 1);
    assert.equal(cloud.remote().filter((row) => row.entity_type === 'reminder').length, 0);

    const activitiesBeforeNone = cloud.remote().filter((row) => row.entity_type === 'activity').length;
    await page.evaluate(() => { (window as TestWindow).__cloudMessages = []; });
    await page.locator('[data-whatsapp-change-followup]').click();
    const noneForm = page.locator('[data-zero-followup-form]');
    await noneForm.locator('input[name="follow-up-choice"][value="none"]').check();
    assert.equal(await noneForm.locator('input[name="selected-date"]').inputValue(), '');
    assert.equal(await noneForm.locator('[data-zero-followup-preview]').textContent(), 'No se programará un próximo seguimiento.');
    await noneForm.locator('button[type="submit"]').click();
    await page.getByText('Contacto registrado', { exact: true }).waitFor({ state: 'visible' });
    await waitForSafeCloudSave(page);

    remoteClient = cloud.remote().find((row) => row.entity_type === 'client')?.payload as { nextFollowUp?: string; nextAction?: string };
    assert.equal(remoteClient.nextFollowUp, undefined);
    assert.equal(remoteClient.nextAction, undefined);
    assert.equal(cloud.remote().filter((row) => row.entity_type === 'activity').length, activitiesBeforeNone, 'none no agrega actividad falsa.');
    assert.equal(activityCount(cloud.remote(), 'Contacto por WhatsApp'), 1, 'El contacto confirmado se conserva.');
    assert.equal(activityCount(cloud.remote(), 'Seguimiento por WhatsApp programado'), 1, 'none no duplica la actividad histórica.');
    assert.equal(cloud.remote().filter((row) => row.entity_type === 'reminder').length, 0);
    assert.equal(await page.locator('#agenda .agenda-card').filter({ hasText: 'Lucía Martín' }).count(), 0);

    await page.evaluate(() => { (window as TestWindow).__cloudMessages = []; });
    await page.locator('[data-whatsapp-choose-followup]').click();
    const reschedule = page.locator('[data-zero-followup-form]');
    await reschedule.locator('input[name="follow-up-choice"][value="3"]').check();
    assert.equal(await reschedule.locator('input[name="selected-date"]').inputValue(), FOLLOW_UP_DATE);
    await reschedule.locator('button[type="submit"]').click();
    await page.getByText('Listo. Próximo contacto: En 3 días', { exact: true }).waitFor({ state: 'visible' });
    await waitForSafeCloudSave(page);
    remoteClient = cloud.remote().find((row) => row.entity_type === 'client')?.payload as { nextFollowUp?: string; nextAction?: string };
    assert.equal(remoteClient.nextFollowUp, FOLLOW_UP_DATE);
    assert.equal(remoteClient.nextAction, 'Volver a contactar por WhatsApp');
    assert.equal(activityCount(cloud.remote(), 'Contacto por WhatsApp'), 1);
    assert.equal(activityCount(cloud.remote(), 'Seguimiento por WhatsApp programado'), 1);
    assert.equal(cloud.remote().filter((row) => row.entity_type === 'reminder').length, 0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
    const card = page.locator('.mvp-lead-card[data-client-id="1"]');
    await card.waitFor({ state: 'visible' });
    const action = card.locator('.mvp-lead-next-action');
    await page.waitForFunction(() => document.querySelector('.mvp-lead-card[data-client-id="1"] .mvp-lead-next-action')?.textContent?.includes('En 3 días'));
    assert.match(await action.innerText(), /WhatsApp/i);
    assert.match(await action.innerText(), /En 3 días/i);
    const summary = card.locator('[data-whatsapp-contact-summary]');
    assert.match(await summary.getAttribute('data-contact-signature') || '', new RegExp(FOLLOW_UP_DATE));
    assert.match(await summary.innerText(), /Seguimiento/i);
    assert.doesNotMatch(await summary.innerText(), /Sin seguimiento/i);
    assert.equal(await page.evaluate(() => Boolean((window as TestWindow).__windowOpened)), false);
    await card.screenshot({ path: `${ARTIFACT_DIR}/01-reload-tarjeta-resumen.png` });

    await page.locator('[data-module="agenda"]:visible').first().click();
    await page.waitForSelector('#agenda.active', { state: 'visible' });
    const agenda = page.locator('#agenda.active .agenda-card').filter({ hasText: 'Lucía Martín' });
    assert.equal(await agenda.count(), 1);
    assert.equal(await agenda.locator(`time[datetime="${FOLLOW_UP_DATE}"]`).count(), 1);
    await agenda.screenshot({ path: `${ARTIFACT_DIR}/02-reload-agenda.png` });
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
