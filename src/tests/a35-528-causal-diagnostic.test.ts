import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import {
  crmToCloudRecords,
  isSupervisedRecommendationTelemetryPayload,
  type CloudMembershipContext,
  type CloudRecordRow,
} from '../cloud-records.js';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'cloud-followup-owner';
const ORG_ID = 'cloud-followup-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const FIXED_TIME = new Date('2026-08-07T16:52:00-03:00');
const FOLLOW_UP_DATE = '2026-08-10';
const ARTIFACT_DIR = 'artifacts/a35-528-causal-diagnostic';
const FIRST_WRITE_TIMEOUT_MS = 30_000;

function log(event: string, data: Record<string, unknown> = {}): void {
  process.stdout.write(`A35_528_DIAG ${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`);
}

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

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT_${ms}MS`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  log('server_start_begin', { port });
  const server = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (d) => log('server_stdout', { text: String(d).trim() }));
  server.stderr?.on('data', (d) => log('server_stderr', { text: String(d).trim() }));
  await waitForServer(`http://127.0.0.1:${port}`);
  log('server_start_end', { port, pid: server.pid });
  return server;
}

async function stopServer(server: ChildProcess): Promise<void> {
  log('server_stop_begin', { pid: server.pid, exitCode: server.exitCode });
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { if (server.exitCode === null) server.kill('SIGKILL'); resolve(); }, 2_000);
      server.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  log('server_stop_end', { pid: server.pid, exitCode: server.exitCode });
}

function recordIdentity(record: Pick<CloudRecordRow, 'organization_id' | 'entity_type' | 'entity_key'>): string {
  return `${record.organization_id}|${record.entity_type}|${record.entity_key}`;
}

function isTelemetryRow(record: CloudRecordRow): boolean {
  return isSupervisedRecommendationTelemetryPayload(record.payload);
}

function humanActivityRows(records: CloudRecordRow[]): CloudRecordRow[] {
  return records.filter((row) => row.entity_type === 'activity' && !isTelemetryRow(row));
}

function parseInFilter(value: string): Set<string> {
  if (!value.startsWith('in.(') || !value.endsWith(')')) return new Set();
  return new Set(value.slice(4, -1).split(',').map((item) => item.trim().replace(/^\"|\"$/g, '')));
}

function filteredRows(records: CloudRecordRow[], url: URL): CloudRecordRow[] {
  let rows = records;
  const organization = url.searchParams.get('organization_id');
  if (organization?.startsWith('eq.')) rows = rows.filter((row) => row.organization_id === organization.slice(3));
  const entityType = url.searchParams.get('entity_type');
  if (entityType?.startsWith('eq.')) rows = rows.filter((row) => row.entity_type === entityType.slice(3));
  const entityKey = url.searchParams.get('entity_key');
  if (entityKey?.startsWith('eq.')) rows = rows.filter((row) => row.entity_key === entityKey.slice(3));
  else if (entityKey?.startsWith('in.(')) {
    const keys = parseInFilter(entityKey);
    rows = rows.filter((row) => keys.has(row.entity_key));
  }
  return structuredClone(rows);
}

async function installCloudRoutes(context: BrowserContext, initial: CrmData) {
  let remote = crmToCloudRecords(initial, contextForCloud(), USER_ID)
    .map((record) => ({ ...structuredClone(record), updated_at: '2026-08-07T19:40:00.000Z' }));
  let crmPostCount = 0;
  let telemetryPostCount = 0;
  let writeSequence = 0;
  let firstStartedResolved = false;
  let firstReleaseResolved = false;
  const firstStarted = deferred();
  const firstRelease = deferred();

  function upsert(rows: CloudRecordRow[]): void {
    writeSequence += 1;
    const updatedAt = `2026-08-07T19:52:${String(writeSequence).padStart(2, '0')}.000Z`;
    rows.forEach((incoming) => {
      const index = remote.findIndex((existing) => recordIdentity(existing) === recordIdentity(incoming));
      const next = { ...structuredClone(incoming), updated_at: updatedAt };
      if (index >= 0) remote[index] = { ...remote[index], ...next };
      else remote.push(next);
    });
  }

  await context.route('**/api/cloud-config', async (route) => {
    log('cloud_config', { method: route.request().method(), url: route.request().url() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, url: new URL(route.request().url()).origin, publishableKey: 'key' }) });
  });

  await context.route('**/rest/v1/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const fulfill = async (value: unknown) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    };

    if (url.pathname.endsWith('/rpc/activate_my_organization_memberships')) {
      log('membership_activation_rpc', { method, url: request.url() });
      return fulfill({});
    }
    if (url.pathname.endsWith('/rpc/visit_transaction_authority_active')) {
      log('visit_authority_rpc', { method, url: request.url() });
      return fulfill(false);
    }
    if (url.pathname.endsWith('/organization_members')) {
      const response = [{ organization_id: ORG_ID, member_id: 1, user_id: USER_ID, role: 'owner', status: 'active', display_name: owner().name, email: owner().email, created_at: owner().createdAt }];
      log('organization_members', { method, url: request.url(), response });
      return fulfill(response);
    }
    if (url.pathname.endsWith('/propcontrol_records') && method === 'GET') {
      const rows = filteredRows(remote, url);
      log('records_get', { url: request.url(), count: rows.length });
      return fulfill(rows);
    }
    if (url.pathname.endsWith('/propcontrol_records') && method === 'DELETE') {
      const deleting = new Set(filteredRows(remote, url).map(recordIdentity));
      remote = remote.filter((row) => !deleting.has(recordIdentity(row)));
      log('records_delete', { url: request.url(), count: deleting.size });
      return fulfill([]);
    }
    if (url.pathname.endsWith('/propcontrol_records') && method === 'POST') {
      const body = request.postDataJSON() as CloudRecordRow[];
      const telemetry = body.filter(isTelemetryRow);
      const crm = body.filter((row) => !isTelemetryRow(row));
      const classification = crm.length && telemetry.length ? 'MIXED' : crm.length ? 'CRM' : telemetry.length ? 'TELEMETRY' : 'EMPTY';
      if (telemetry.length) telemetryPostCount += 1;
      if (crm.length) crmPostCount += 1;
      log('records_post', { classification, crmRows: crm.length, telemetryRows: telemetry.length, crmPostCount, telemetryPostCount });
      if (crm.length && crmPostCount === 1) {
        firstStartedResolved = true;
        log('firstStarted.resolve');
        firstStarted.resolve();
        log('firstRelease.wait_enter');
        await firstRelease.promise;
        log('firstRelease.wait_exit');
      }
      upsert(body);
      return fulfill([]);
    }
    log('rest_unhandled', { method, url: request.url() });
    return route.fulfill({ status: 404, body: '{}' });
  });

  return {
    firstWriteStarted: firstStarted.promise,
    releaseFirstWrite: () => {
      if (!firstReleaseResolved) {
        firstReleaseResolved = true;
        log('firstRelease.resolve');
        firstRelease.resolve();
      }
    },
    firstStartedResolved: () => firstStartedResolved,
    firstReleaseResolved: () => firstReleaseResolved,
    crmPostCount: () => crmPostCount,
    telemetryPostCount: () => telemetryPostCount,
    remote: () => structuredClone(remote),
  };
}

async function installStorage(context: BrowserContext, crm: CrmData): Promise<void> {
  const actorKey = `cloud:${USER_ID}`;
  const identityKey = `propcontrol-whatsapp-human-identity-v1:${encodeURIComponent(ORG_ID)}:1:${encodeURIComponent(actorKey)}`;
  await context.addInitScript(({ data, identityStorageKey }) => {
    const target = window as TestWindow;
    target.__cloudMessages = [];
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({ accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000, userId: 'cloud-followup-owner', email: 'franco@propcontrol.test' }));
    if (!localStorage.getItem('trv-crm-basico:user:cloud-followup-owner')) localStorage.setItem('trv-crm-basico:user:cloud-followup-owner', JSON.stringify(data));
    if (!localStorage.getItem('trv-crm-basico:user:cloud-followup-owner:sync')) localStorage.setItem('trv-crm-basico:user:cloud-followup-owner:sync', JSON.stringify({ dirty: false, localUpdatedAt: '2026-08-07T19:40:00.000Z', lastCloudSavedAt: '2026-08-07T19:40:00.000Z', lastCloudVersion: '2026-08-07T19:40:00.000Z' }));
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
  log('load_start', { url });
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  log('load_domcontentloaded');
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  log('crm_active_visible');
  await page.waitForSelector('[data-contact-whatsapp="1"]', { state: 'visible', timeout: 20_000 });
  log('load_end');
}

function activityCount(records: CloudRecordRow[], action: string): number {
  return humanActivityRows(records).filter((row) => (row.payload as { action?: string }).action === action).length;
}

async function waitForSafeCloudSave(page: Page): Promise<void> {
  await page.clock.runFor(850);
  await page.waitForFunction(() => ((window as TestWindow).__cloudMessages || []).includes('Guardado seguro en la nube.'), null, { timeout: 20_000 });
}

test('A3.5 #528 causal diagnostic', { timeout: 180_000 }, async () => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible.');
  const port = 61520 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  log('browser_launch_begin', { executablePath });
  const browser: Browser = await chromium.launch({ executablePath, headless: true });
  log('browser_launch_end');
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-AR', timezoneId: 'America/Argentina/Cordoba', colorScheme: 'dark' });
  log('context_created');
  const data = fixture();
  await installStorage(context, data);
  const cloud = await installCloudRoutes(context, data);
  let page: Page | undefined;
  let forcedRelease = false;

  try {
    page = await context.newPage();
    log('page_created');
    page.on('console', (msg) => log('console', { type: msg.type(), text: msg.text() }));
    page.on('pageerror', (error) => log('pageerror', { message: error.message, stack: error.stack }));
    page.on('requestfailed', (request) => log('requestfailed', { method: request.method(), url: request.url(), failure: request.failure()?.errorText }));
    page.on('request', (request) => {
      if (request.url().includes('/organization_members') || request.url().includes('/propcontrol_records')) log('request', { method: request.method(), url: request.url() });
    });
    page.on('response', (response) => {
      if (response.url().includes('/organization_members') || response.url().includes('/propcontrol_records')) log('response', { status: response.status(), url: response.url() });
    });

    const url = `http://127.0.0.1:${port}`;
    await load(page, url);
    const bootstrap = await page.evaluate((storageKey) => ({
      session: JSON.parse(localStorage.getItem('propcontrol-cloud-session-v1') || '{}'),
      activeMember: localStorage.getItem('propcontrol-active-team-member-v1'),
      crm: JSON.parse(localStorage.getItem(storageKey) || '{}'),
      sync: JSON.parse(localStorage.getItem(`${storageKey}:sync`) || '{}'),
      cloudMessages: (window as TestWindow).__cloudMessages || [],
    }), STORAGE_KEY);
    log('bootstrap_state', { userId: bootstrap.session.userId, organization: bootstrap.crm.organization, activeMember: bootstrap.activeMember, owner: bootstrap.crm.teamMembers?.[0], sync: bootstrap.sync, cloudMessages: bootstrap.cloudMessages });

    log('click_contact_whatsapp_begin');
    await page.locator('[data-contact-whatsapp="1"]').click();
    log('click_contact_whatsapp_end');
    await page.locator('[data-whatsapp-open]').click();
    log('click_whatsapp_open');
    await page.clock.runFor(750);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible' });
    log('confirm_sent_visible');
    await page.locator('[data-whatsapp-confirm-sent]').click();
    log('confirm_sent_clicked');
    await page.clock.runFor(750);

    log('firstWriteStarted.wait_begin', { timeoutMs: FIRST_WRITE_TIMEOUT_MS });
    await withTimeout(cloud.firstWriteStarted, FIRST_WRITE_TIMEOUT_MS, 'FIRST_WRITE_STARTED');
    log('firstWriteStarted.wait_end');

    log('assert_1_begin', { crmPostCount: cloud.crmPostCount() });
    assert.equal(cloud.crmPostCount(), 1, 'A debe ser el único push CRM en vuelo');
    log('assert_1_pass');

    const nextFollowUp = await page.evaluate((key) => (JSON.parse(localStorage.getItem(key) || '{}') as CrmData).clients[0]?.nextFollowUp, STORAGE_KEY);
    log('assert_2_begin', { nextFollowUp });
    assert.equal(nextFollowUp, FOLLOW_UP_DATE);
    log('assert_2_pass');

    await page.clock.runFor(850);
    log('assert_3_begin', { crmPostCount: cloud.crmPostCount() });
    assert.equal(cloud.crmPostCount(), 1, 'La cola CRM mantiene un único POST CRM mientras el primero sigue en vuelo');
    log('assert_3_pass');

    cloud.releaseFirstWrite();
    await page.waitForFunction(() => ((window as TestWindow).__cloudMessages || []).includes('Guardado seguro en la nube.'), null, { timeout: 20_000 });
    log('safe_cloud_save_after_release');
    assert.ok(cloud.crmPostCount() >= 1 && cloud.crmPostCount() <= 2, `La cola segura usó ${cloud.crmPostCount()} push(es) CRM.`);

    let remoteClient = cloud.remote().find((row) => row.entity_type === 'client')?.payload as { nextFollowUp?: string; nextAction?: string };
    assert.equal(remoteClient.nextFollowUp, FOLLOW_UP_DATE);
    assert.equal(remoteClient.nextAction, 'Volver a contactar por WhatsApp');
    assert.equal(activityCount(cloud.remote(), 'Contacto por WhatsApp'), 1);
    assert.equal(activityCount(cloud.remote(), 'Seguimiento por WhatsApp programado'), 1);
    assert.equal(cloud.remote().filter((row) => row.entity_type === 'reminder').length, 0);
    assert.ok(cloud.telemetryPostCount() >= 1, 'La telemetría puede escribir concurrentemente sin secuestrar el bloqueo CRM.');
    assert.ok(cloud.remote().some(isTelemetryRow), 'La telemetría append-only sobrevive junto al CRM.');

    const activitiesBeforeNone = humanActivityRows(cloud.remote()).length;
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
    assert.equal(humanActivityRows(cloud.remote()).length, activitiesBeforeNone, 'none no agrega actividad humana falsa.');
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
    assert.ok(cloud.remote().some(isTelemetryRow), 'Los POST CRM posteriores no reemplazan ni borran telemetría.');

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
    const actionsMenu = card.locator('.mvp-lead-actions-menu');
    await actionsMenu.locator('summary').click();
    await actionsMenu.getByRole('button', { name: 'Ver detalles', exact: true }).click();
    await summary.waitFor({ state: 'visible' });
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
    log('diagnostic_test_pass');
  } catch (error) {
    log('diagnostic_test_error', { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
    throw error;
  } finally {
    log('finally_enter', { firstStartedResolved: cloud.firstStartedResolved(), firstReleaseResolved: cloud.firstReleaseResolved() });
    if (cloud.firstStartedResolved() && !cloud.firstReleaseResolved()) {
      forcedRelease = true;
      log('diagnostic_forced_first_release', { value: true });
      cloud.releaseFirstWrite();
    } else {
      log('diagnostic_forced_first_release', { value: false });
    }
    log('context_close_begin');
    await withTimeout(context.close(), 15_000, 'CONTEXT_CLOSE');
    log('context_close_end');
    log('browser_close_begin');
    await withTimeout(browser.close(), 15_000, 'BROWSER_CLOSE');
    log('browser_close_end');
    await stopServer(server);
    log('diagnostic_summary', { forcedRelease, firstStartedResolved: cloud.firstStartedResolved(), firstReleaseResolved: cloud.firstReleaseResolved(), crmPostCount: cloud.crmPostCount(), telemetryPostCount: cloud.telemetryPostCount() });
  }
});
