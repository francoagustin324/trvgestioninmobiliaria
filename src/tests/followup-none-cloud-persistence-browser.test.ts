import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type BrowserContext, type Page, type Route } from 'playwright';
import { crmToCloudRecords, type CloudMembershipContext, type CloudRecordRow } from '../cloud-records.js';
import { initialData, type CrmData, type TeamMember } from '../models.js';
import { tenantStorageNamespace } from '../tenant-storage.js';

const USER_ID = 'none-cloud-owner';
const ORG_ID = 'none-cloud-org';
const STORAGE_KEY = tenantStorageNamespace({ userId: USER_ID, organizationId: ORG_ID }).crmKey;
const SYNC_KEY = `${STORAGE_KEY}:sync`;
const AUTH_GENERATION = 'none-cloud-auth-generation';
const FIXED_TIME = new Date('2026-08-07T16:52:00-03:00');
const AUTO_DATE = '2026-08-10';
const AUTO_ACTION = 'Volver a contactar por WhatsApp';

interface NoneCloudWindow extends Window {
  __noneCloudMessages?: string[];
  __noneCloudAuthoritativeSnapshots?: CrmData[];
}

interface CloudHarness {
  remote: () => CloudRecordRow[];
  v2AuthorityCalls: () => number;
  crmPostCount: () => number;
  cloudReadScopes: () => string[];
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

function recordIdentity(record: Pick<CloudRecordRow, 'organization_id' | 'entity_type' | 'entity_key'>): string {
  return `${record.organization_id}|${record.entity_type}|${record.entity_key}`;
}

function parseInFilter(value: string): Set<string> {
  if (!value.startsWith('in.(') || !value.endsWith(')')) return new Set();
  return new Set(value.slice(4, -1).split(',').map((item) => item.trim().replace(/^"|"$/g, '')));
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

async function installCloud(context: BrowserContext, initial: CrmData): Promise<CloudHarness> {
  let remote = crmToCloudRecords(initial, cloudContext(), USER_ID)
    .map((record) => ({ ...structuredClone(record), updated_at: '2026-08-07T19:40:00.000Z' }));
  let version = 0;
  let v2AuthorityCalls = 0;
  let crmPostCount = 0;
  const cloudReadScopes: string[] = [];

  function upsert(rows: CloudRecordRow[]): void {
    version += 1;
    const stamp = `2026-08-07T19:55:${String(version).padStart(2, '0')}.000Z`;
    rows.forEach((incoming) => {
      assert.equal(incoming.organization_id, ORG_ID, 'Cada row cloud debe pertenecer exclusivamente al tenant #537.');
      const index = remote.findIndex((existing) => recordIdentity(existing) === recordIdentity(incoming));
      const next = { ...structuredClone(incoming), updated_at: stamp };
      if (index >= 0) remote[index] = { ...remote[index], ...next };
      else remote.push(next);
    });
  }

  await context.route('**/api/cloud-config', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, url: new URL(route.request().url()).origin, publishableKey: 'key' }) });
  });
  await context.route('**/rest/v1/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const fulfill = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });

    if (url.pathname.endsWith('/rpc/activate_my_organization_memberships')) return fulfill({});
    if (url.pathname.endsWith('/rpc/visit_transaction_authority_active_v2')) {
      assert.equal(method, 'POST');
      assert.equal(request.headers()['authorization'], 'Bearer access');
      assert.equal(request.headers()['apikey'], 'key');
      assert.deepEqual(request.postDataJSON(), { p_organization_id: ORG_ID });
      v2AuthorityCalls += 1;
      return fulfill(false);
    }
    if (url.pathname.endsWith('/organization_members')) {
      return fulfill([{ organization_id: ORG_ID, member_id: 1, user_id: USER_ID, role: 'owner', status: 'active', display_name: owner().name, email: owner().email, created_at: owner().createdAt }]);
    }
    if (url.pathname.endsWith('/propcontrol_records') && method === 'GET') {
      const scope = url.searchParams.get('organization_id') || '';
      cloudReadScopes.push(scope);
      assert.equal(scope, `eq.${ORG_ID}`, 'Cada lectura de propcontrol_records debe quedar scopeada al tenant #537.');
      return fulfill(filteredRows(remote, url));
    }
    if (url.pathname.endsWith('/propcontrol_records') && method === 'DELETE') {
      const deleting = new Set(filteredRows(remote, url).map(recordIdentity));
      remote = remote.filter((row) => !deleting.has(recordIdentity(row)));
      return fulfill([]);
    }
    if (url.pathname.endsWith('/propcontrol_records') && method === 'POST') {
      const rows = request.postDataJSON() as CloudRecordRow[];
      if (rows.some((row) => row.organization_id !== ORG_ID)) {
        throw new Error('CROSS_TENANT_WRITE_DETECTED');
      }
      crmPostCount += 1;
      upsert(rows);
      return fulfill([]);
    }
    return route.fulfill({ status: 404, body: '{}' });
  });

  return {
    remote: () => structuredClone(remote),
    v2AuthorityCalls: () => v2AuthorityCalls,
    crmPostCount: () => crmPostCount,
    cloudReadScopes: () => [...cloudReadScopes],
  };
}

async function installStorage(context: BrowserContext, crm: CrmData): Promise<void> {
  const actorKey = `cloud:${USER_ID}`;
  const identityKey = `propcontrol-whatsapp-human-identity-v1:${encodeURIComponent(ORG_ID)}:1:${encodeURIComponent(actorKey)}`;
  await context.addInitScript(({ data, identityStorageKey, storageKey, syncKey, authGeneration }) => {
    const target = window as NoneCloudWindow;
    target.__noneCloudMessages = [];
    target.__noneCloudAuthoritativeSnapshots = [];
    localStorage.setItem('propcontrol-cloud-auth-generation-v1', authGeneration);
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: 'none-cloud-owner',
      email: 'franco@propcontrol.test',
      __propcontrolAuthGeneration: authGeneration,
    }));
    if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify(data));
    if (!localStorage.getItem(syncKey)) {
      localStorage.setItem(syncKey, JSON.stringify({ dirty: false, localUpdatedAt: '2026-08-07T19:40:00.000Z', lastCloudSavedAt: '2026-08-07T19:40:00.000Z', lastCloudVersion: '2026-08-07T19:40:00.000Z' }));
    }
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
    localStorage.setItem(identityStorageKey, JSON.stringify({ version: 1, organizationId: 'none-cloud-org', memberId: 1, actorKey: 'cloud:none-cloud-owner', humanName: 'Franco Solis', confirmedAt: '2026-08-07T19:40:00.000Z' }));
    document.addEventListener('propcontrol-cloud-status', (event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      if (message) target.__noneCloudMessages?.push(message);
    });
    document.addEventListener('propcontrol-cloud-authoritative-snapshot', (event) => {
      const crmSnapshot = (event as CustomEvent<{ crm?: CrmData }>).detail?.crm;
      if (crmSnapshot) target.__noneCloudAuthoritativeSnapshots?.push(structuredClone(crmSnapshot));
    });
    Object.defineProperty(window, 'open', { configurable: true, value: () => null });
  }, { data: crm, identityStorageKey: identityKey, storageKey: STORAGE_KEY, syncKey: SYNC_KEY, authGeneration: AUTH_GENERATION });
}

async function load(page: Page, url: string): Promise<void> {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('[data-contact-whatsapp="1"]', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction((key) => Boolean(localStorage.getItem(key)), STORAGE_KEY, { timeout: 20_000 });
}

async function waitForSafeSave(page: Page): Promise<void> {
  await page.clock.runFor(850);
  await page.waitForFunction(() => ((window as NoneCloudWindow).__noneCloudMessages || []).includes('Guardado seguro en la nube.'), null, { timeout: 20_000 });
}

async function stored(page: Page): Promise<CrmData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}') as CrmData, STORAGE_KEY);
}

async function syncState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}') as Record<string, unknown>, SYNC_KEY);
}

async function authoritativeSnapshot(page: Page): Promise<CrmData | null> {
  return page.evaluate(() => {
    const snapshots = (window as NoneCloudWindow).__noneCloudAuthoritativeSnapshots || [];
    return snapshots.length ? structuredClone(snapshots.at(-1)!) : null;
  });
}

function clientPayload(rows: CloudRecordRow[]): { nextFollowUp?: string; nextAction?: string } {
  return (rows.find((row) => row.entity_type === 'client')?.payload || {}) as { nextFollowUp?: string; nextAction?: string };
}

function logTrace(stage: string, value: unknown): void {
  console.log(`R5_TRACE_${stage}=${JSON.stringify(value)}`);
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
  const cloud = await installCloud(context, data);

  try {
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);
    logTrace('AUTHORITY', {
      authenticatedUser: USER_ID,
      organizationId: ORG_ID,
      membershipRole: 'owner',
      tenantStorageKey: STORAGE_KEY,
      cloudRecordScope: `organization_id=eq.${ORG_ID}`,
    });

    await page.locator('[data-contact-whatsapp="1"]').click();
    await page.locator('[data-whatsapp-open]').click();
    await page.clock.runFor(750);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible' });
    await page.locator('[data-whatsapp-confirm-sent]').click();
    await page.getByText('Listo. Próximo contacto: En 3 días', { exact: true }).waitFor({ state: 'visible' });

    let local = await stored(page);
    assert.equal(local.clients[0]?.nextFollowUp, AUTO_DATE);
    assert.equal(local.clients[0]?.nextAction, AUTO_ACTION);
    assert.equal(local.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 1);
    assert.equal(local.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 1);
    assert.equal(local.reminders.length, 0);
    logTrace('FIRST_LOCAL_WRITE', {
      nextFollowUp: local.clients[0]?.nextFollowUp,
      nextAction: local.clients[0]?.nextAction,
      contactActivities: local.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length,
      followUpActivities: local.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length,
      reminders: local.reminders.length,
    });

    await waitForSafeSave(page);
    assert.ok(cloud.v2AuthorityCalls() >= 1, 'El writer #537 debe resolver Visit authority mediante RPC V2.');
    assert.ok(cloud.crmPostCount() >= 1, 'El writer #537 debe persistir el snapshot en propcontrol_records.');
    assert.ok(cloud.cloudReadScopes().every((scope) => scope === `eq.${ORG_ID}`), 'Todas las lecturas cloud deben permanecer en el mismo tenant.');

    let remoteClient = clientPayload(cloud.remote());
    assert.equal(remoteClient.nextFollowUp, AUTO_DATE);
    assert.equal(remoteClient.nextAction, AUTO_ACTION);
    assert.ok(cloud.remote().every((row) => row.organization_id === ORG_ID), 'El dataset cloud no puede contener otro tenant.');
    let sync = await syncState(page);
    assert.equal(sync.dirty, false, 'El ACK cloud debe dejar dirty=false.');
    let authoritative = await authoritativeSnapshot(page);
    assert.ok(authoritative, 'El ACK cloud debe emitir snapshot autoritativo.');
    assert.equal(authoritative.clients[0]?.nextFollowUp, AUTO_DATE);
    assert.equal(authoritative.clients[0]?.nextAction, AUTO_ACTION);
    logTrace('FIRST_CLOUD_ACK', {
      nextFollowUp: remoteClient.nextFollowUp,
      nextAction: remoteClient.nextAction,
      dirty: sync.dirty,
      v2AuthorityCalls: cloud.v2AuthorityCalls(),
      cloudPosts: cloud.crmPostCount(),
    });

    await page.evaluate(() => {
      (window as NoneCloudWindow).__noneCloudMessages = [];
      (window as NoneCloudWindow).__noneCloudAuthoritativeSnapshots = [];
    });
    await page.locator('[data-whatsapp-change-followup]').click();
    const form = page.locator('[data-zero-followup-form]');
    await form.locator('input[name="follow-up-choice"][value="none"]').check();
    assert.equal(await form.locator('[data-zero-followup-preview]').textContent(), 'No se programará un próximo seguimiento.');
    await form.locator('button[type="submit"]').click();
    await page.getByText('Contacto registrado', { exact: true }).waitFor({ state: 'visible' });

    local = await stored(page);
    assert.equal(local.clients[0]?.nextFollowUp, undefined);
    assert.equal(local.clients[0]?.nextAction, undefined);
    assert.equal(local.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 1);
    assert.equal(local.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 1);
    assert.equal(local.reminders.length, 0);
    sync = await syncState(page);
    assert.equal(sync.dirty, true, 'La mutación none debe quedar dirty antes del ACK cloud.');
    logTrace('NONE_LOCAL_WRITE', {
      nextFollowUp: local.clients[0]?.nextFollowUp ?? null,
      nextAction: local.clients[0]?.nextAction ?? null,
      dirty: sync.dirty,
      contactActivities: local.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length,
      followUpActivities: local.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length,
      reminders: local.reminders.length,
    });

    await waitForSafeSave(page);
    remoteClient = clientPayload(cloud.remote());
    assert.equal(remoteClient.nextFollowUp, undefined);
    assert.equal(remoteClient.nextAction, undefined);
    assert.equal(cloud.remote().filter((row) => row.entity_type === 'activity' && (row.payload as { action?: string }).action === 'Contacto por WhatsApp').length, 1);
    assert.equal(cloud.remote().filter((row) => row.entity_type === 'reminder').length, 0);
    assert.ok(cloud.remote().every((row) => row.organization_id === ORG_ID), 'El segundo ACK tampoco puede mezclar tenants.');
    sync = await syncState(page);
    assert.equal(sync.dirty, false, 'El segundo ACK cloud debe dejar dirty=false.');
    authoritative = await authoritativeSnapshot(page);
    assert.ok(authoritative, 'La mutación none debe emitir snapshot autoritativo tras ACK.');
    assert.equal(authoritative.clients[0]?.nextFollowUp, undefined);
    assert.equal(authoritative.clients[0]?.nextAction, undefined);
    logTrace('NONE_CLOUD_ACK', {
      nextFollowUp: remoteClient.nextFollowUp ?? null,
      nextAction: remoteClient.nextAction ?? null,
      dirty: sync.dirty,
      v2AuthorityCalls: cloud.v2AuthorityCalls(),
      cloudPosts: cloud.crmPostCount(),
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
    await page.waitForFunction((key) => Boolean(localStorage.getItem(key)), STORAGE_KEY, { timeout: 20_000 });
    local = await stored(page);
    assert.equal(local.organization.id, ORG_ID, 'F5 debe rehidratar el mismo tenant.');
    assert.equal(local.clients[0]?.nextFollowUp, undefined);
    assert.equal(local.clients[0]?.nextAction, undefined);
    assert.equal(local.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 1, 'F5 conserva el contacto histórico.');
    assert.equal(local.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 1);
    assert.equal(local.reminders.length, 0);
    remoteClient = clientPayload(cloud.remote());
    assert.equal(remoteClient.nextFollowUp, undefined);
    assert.equal(remoteClient.nextAction, undefined);
    assert.ok(cloud.remote().every((row) => row.organization_id === ORG_ID), 'La rehidratación debe provenir exclusivamente del mismo tenant cloud.');
    logTrace('REHYDRATED', {
      organizationId: local.organization.id,
      nextFollowUp: local.clients[0]?.nextFollowUp ?? null,
      nextAction: local.clients[0]?.nextAction ?? null,
      cloudNextFollowUp: remoteClient.nextFollowUp ?? null,
      cloudNextAction: remoteClient.nextAction ?? null,
      contactActivities: local.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length,
      followUpActivities: local.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length,
      reminders: local.reminders.length,
    });

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
