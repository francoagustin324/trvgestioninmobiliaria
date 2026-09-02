import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type BrowserContext, type Page, type Route } from 'playwright';
import { crmToCloudRecords, type CloudMembershipContext, type CloudRecordRow } from '../cloud-records.js';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'p1-a2-owner';
const ORG_ID = 'p1-a2-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;

interface CloudDiagnosticTrace {
  phase: string;
  sequence: number;
}

function trace(step: string, detail: unknown): void {
  console.log(`[R2.2C8] ${step} ${JSON.stringify(detail)}`);
}

function visitSummary(records: Array<{ id?: unknown; uid?: unknown }>): Array<{ id: unknown; uid: unknown }> {
  return records.map((record) => ({ id: record.id ?? null, uid: record.uid ?? null }));
}

function remoteVisitSummary(records: CloudRecordRow[]): { count: number; keys: string[] } {
  const visits = records.filter((record) => record.entity_type === 'visit');
  return { count: visits.length, keys: visits.map((record) => record.entity_key) };
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
    createdAt: '2026-08-23T18:00:00.000Z',
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'P1.1-A2' };
  crm.teamMembers = [owner()];
  crm.clients = [{
    id: 1,
    name: 'Lucía Martín',
    phone: '+54 9 351 511-0069',
    email: 'lucia@ejemplo.com',
    interest: 'Dúplex en Docta',
    budget: '120000',
    currency: 'USD',
    paymentMethod: 'Contado',
    zones: 'Docta',
    purpose: 'Vivir',
    purchaseTimeframe: '0-3 meses',
    canMoveForward: 'Sí',
    knowsArea: 'Sí',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Nuevo',
    assignedToId: 1,
    createdById: 1,
    lastContact: '2026-08-23',
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
  crm.conversations = [];
  crm.contacts = [];
  crm.fichas = [];
  crm.activityLog = [];
  crm.settings = {
    ...crm.settings,
    profileName: owner().name,
    profileEmail: owner().email,
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
}

function cloudContext(): CloudMembershipContext {
  return {
    organizationId: ORG_ID,
    currentMemberId: 1,
    currentRole: 'Dueño',
    members: [owner()],
  };
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
  throw new Error('Servidor P1.1-A2 no disponible.');
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

async function installCloud(
  context: BrowserContext,
  initial: CrmData,
  diagnostic: CloudDiagnosticTrace = { phase: 'bootstrap', sequence: 0 },
): Promise<void> {
  let remote = crmToCloudRecords(initial, cloudContext(), USER_ID)
    .map((record) => ({ ...structuredClone(record), updated_at: '2026-08-23T18:00:00.000Z' }));
  let version = 0;

  function nextSequence(): number {
    diagnostic.sequence += 1;
    return diagnostic.sequence;
  }

  function upsert(rows: CloudRecordRow[]): void {
    version += 1;
    const stamp = `2026-08-23T18:00:${String(version).padStart(2, '0')}.000Z`;
    rows.forEach((incoming) => {
      const index = remote.findIndex((existing) => recordIdentity(existing) === recordIdentity(incoming));
      const next = { ...structuredClone(incoming), updated_at: stamp };
      if (index >= 0) remote[index] = { ...remote[index], ...next };
      else remote.push(next);
    });
  }

  await context.route('**/api/cloud-config', async (route) => {
    trace('FAKE_CONFIG', { phase: diagnostic.phase, sequence: nextSequence() });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        configured: true,
        url: new URL(route.request().url()).origin,
        publishableKey: 'key',
      }),
    });
  });
  await context.route('**/rest/v1/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const fulfill = (value: unknown) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(value),
    });

    if (url.pathname.endsWith('/rpc/activate_my_organization_memberships')) {
      trace('FAKE_RPC_ACTIVATE', { phase: diagnostic.phase, sequence: nextSequence() });
      return fulfill({});
    }
    if (url.pathname.endsWith('/rpc/visit_transaction_authority_active')) {
      trace('FAKE_RPC_CAPABILITY', { phase: diagnostic.phase, sequence: nextSequence(), authority: false });
      return fulfill(false);
    }
    if (url.pathname.endsWith('/organization_members')) {
      trace('FAKE_MEMBERSHIP_GET', { phase: diagnostic.phase, sequence: nextSequence() });
      return fulfill([{
        organization_id: ORG_ID,
        member_id: 1,
        user_id: USER_ID,
        role: 'owner',
        status: 'active',
        display_name: owner().name,
        email: owner().email,
        phone: owner().phone,
        created_at: owner().createdAt,
      }]);
    }
    if (url.pathname.endsWith('/propcontrol_records') && method === 'GET') {
      const rows = filteredRows(remote, url);
      trace('FAKE_RECORDS_GET', {
        phase: diagnostic.phase,
        sequence: nextSequence(),
        organizationId: url.searchParams.get('organization_id'),
        entityType: url.searchParams.get('entity_type'),
        entityKey: url.searchParams.get('entity_key'),
        returnedRecords: rows.length,
        returnedVisits: remoteVisitSummary(rows),
        remoteVisits: remoteVisitSummary(remote),
      });
      return fulfill(rows);
    }
    if (url.pathname.endsWith('/propcontrol_records') && method === 'DELETE') {
      const selected = filteredRows(remote, url);
      trace('FAKE_RECORDS_DELETE_BEFORE', {
        phase: diagnostic.phase,
        sequence: nextSequence(),
        entityType: url.searchParams.get('entity_type'),
        entityKey: url.searchParams.get('entity_key'),
        selected: selected.map(recordIdentity),
        remoteRecords: remote.length,
        remoteVisits: remoteVisitSummary(remote),
      });
      const deleting = new Set(selected.map(recordIdentity));
      remote = remote.filter((row) => !deleting.has(recordIdentity(row)));
      trace('FAKE_RECORDS_DELETE_AFTER', {
        phase: diagnostic.phase,
        sequence: nextSequence(),
        remoteRecords: remote.length,
        remoteVisits: remoteVisitSummary(remote),
      });
      return fulfill([]);
    }
    if (url.pathname.endsWith('/propcontrol_records') && method === 'POST') {
      const incoming = request.postDataJSON() as CloudRecordRow[];
      trace('FAKE_RECORDS_POST_BEFORE', {
        phase: diagnostic.phase,
        sequence: nextSequence(),
        incomingRecords: incoming.length,
        entityTypes: [...new Set(incoming.map((record) => record.entity_type))],
        incomingVisits: remoteVisitSummary(incoming),
        remoteRecords: remote.length,
        remoteVisits: remoteVisitSummary(remote),
      });
      upsert(incoming);
      trace('FAKE_RECORDS_POST_AFTER', {
        phase: diagnostic.phase,
        sequence: nextSequence(),
        remoteRecords: remote.length,
        remoteVisits: remoteVisitSummary(remote),
      });
      return fulfill([]);
    }
    trace('FAKE_UNHANDLED_ROUTE', {
      phase: diagnostic.phase,
      sequence: nextSequence(),
      method,
      pathname: url.pathname,
    });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

async function seedContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(({ crm, storageKey }) => {
    interface BrowserDiagnosticState {
      authoritativeEvents: Array<{ incomingVisits: number; visits: Array<{ id: unknown; uid: unknown }> }>;
      cloudStatus: Array<{ kind: string; message: string }>;
      storageTransitions: Array<{ before: number; after: number; visits: Array<{ id: unknown; uid: unknown }>; stack: string[] }>;
      syncTransitions: Array<{
        dirty: boolean;
        generation: number | null;
        verifiedGeneration: number | null;
        lastCloudVersion: string | null;
        localFingerprintDigest: string;
        lastCloudFingerprintDigest: string;
      }>;
      unhandled: string[];
      errors: string[];
    }
    const diagnosticWindow = window as Window & { __r2c8?: BrowserDiagnosticState };
    diagnosticWindow.__r2c8 = {
      authoritativeEvents: [],
      cloudStatus: [],
      storageTransitions: [],
      syncTransitions: [],
      unhandled: [],
      errors: [],
    };
    const digest = (value: unknown): string => {
      const text = typeof value === 'string' ? value : '';
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return `${text.length}:${(hash >>> 0).toString(16)}`;
    };
    const parse = (value: string | null): Record<string, unknown> | null => {
      if (!value) return null;
      try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
      } catch {
        return null;
      }
    };
    const summarizeVisits = (value: unknown): Array<{ id: unknown; uid: unknown }> => {
      if (!Array.isArray(value)) return [];
      return value.map((item) => {
        const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        return { id: record.id ?? null, uid: record.uid ?? null };
      });
    };
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function diagnosticSetItem(key: string, value: string): void {
      const diagnostic = diagnosticWindow.__r2c8!;
      if (key === storageKey) {
        const previous = parse(this.getItem(key));
        const next = parse(value);
        const previousVisits = Array.isArray(previous?.visits) ? previous.visits.length : 0;
        const nextVisits = Array.isArray(next?.visits) ? next.visits.length : 0;
        if (previousVisits !== nextVisits) {
          const transition = {
            before: previousVisits,
            after: nextVisits,
            visits: summarizeVisits(next?.visits),
            stack: (new Error().stack || '').split('\n').slice(1, 9).map((line) => line.trim()),
          };
          diagnostic.storageTransitions.push(transition);
          console.info(`[R2.2C8] STORAGE_VISITS ${JSON.stringify(transition)}`);
        }
      } else if (key === `${storageKey}:sync`) {
        const next = parse(value);
        const transition = {
          dirty: Boolean(next?.dirty),
          generation: Number.isFinite(next?.localGeneration) ? Number(next?.localGeneration) : null,
          verifiedGeneration: Number.isFinite(next?.verifiedGeneration) ? Number(next?.verifiedGeneration) : null,
          lastCloudVersion: typeof next?.lastCloudVersion === 'string' ? next.lastCloudVersion : null,
          localFingerprintDigest: digest(next?.localFingerprint),
          lastCloudFingerprintDigest: digest(next?.lastCloudFingerprint),
        };
        diagnostic.syncTransitions.push(transition);
        console.info(`[R2.2C8] SYNC_STATE ${JSON.stringify(transition)}`);
      }
      nativeSetItem.call(this, key, value);
    };
    document.addEventListener('propcontrol-cloud-authoritative-snapshot', (event) => {
      const detail = (event as CustomEvent<{ crm?: { visits?: unknown[] } }>).detail;
      const visits = summarizeVisits(detail?.crm?.visits);
      const entry = { incomingVisits: visits.length, visits };
      diagnosticWindow.__r2c8!.authoritativeEvents.push(entry);
      console.info(`[R2.2C8] AUTHORITATIVE_EVENT_BEFORE_PRODUCT_LISTENER ${JSON.stringify(entry)}`);
    }, true);
    document.addEventListener('propcontrol-cloud-status', (event) => {
      const detail = (event as CustomEvent<{ kind?: unknown; message?: unknown }>).detail;
      const entry = {
        kind: String(detail?.kind ?? ''),
        message: String(detail?.message ?? ''),
      };
      diagnosticWindow.__r2c8!.cloudStatus.push(entry);
      if (entry.kind === 'error') console.info(`[R2.2C8] CLOUD_STATUS_ERROR ${JSON.stringify(entry)}`);
    }, true);
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error ? `${event.reason.name}: ${event.reason.message}` : String(event.reason ?? '');
      diagnosticWindow.__r2c8!.unhandled.push(reason);
      console.info(`[R2.2C8] UNHANDLED_REJECTION ${JSON.stringify({ reason })}`);
    });
    window.addEventListener('error', (event) => {
      const message = event.error instanceof Error ? `${event.error.name}: ${event.error.message}` : String(event.message || '');
      diagnosticWindow.__r2c8!.errors.push(message);
      console.info(`[R2.2C8] WINDOW_ERROR ${JSON.stringify({ message })}`);
    });

    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: 'p1-a2-owner',
      email: 'franco@propcontrol.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(crm));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-08-23T18:00:00.000Z',
      lastCloudSavedAt: '2026-08-23T18:00:00.000Z',
      lastCloudVersion: '2026-08-23T18:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { crm: fixture(), storageKey: STORAGE_KEY });
}

function futureLocalDate(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.mvp-lead-card[data-client-id="1"]', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('[data-lead-visits="1"]', { state: 'attached', timeout: 20_000 });
}

async function openLead(page: Page): Promise<void> {
  const sheet = page.locator('[data-lead-full-sheet="1"]');
  if (!(await sheet.evaluate((element) => (element as HTMLDetailsElement).open))) {
    const lead = page.locator('.mvp-lead-card[data-client-id="1"]');
    const actions = lead.locator('.mvp-lead-actions-menu');
    await actions.waitFor({ state: 'visible', timeout: 10_000 });
    const actionsSummary = actions.locator(':scope > summary');
    if (!(await actions.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await actionsSummary.click();
    }
    await actions.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  }
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

test('P1.1-A2 browser desktop coordina una sola visita y registra resultado sin duplicarla', async () => {
  const port = 48231;
  const server = await startServer(port);
  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable() });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  try {
    const cloudTrace: CloudDiagnosticTrace = { phase: 'bootstrap', sequence: 0 };
    await installCloud(context, fixture(), cloudTrace);
    await seedContext(context);
    const page = await context.newPage();
    page.on('console', (message) => {
      const text = message.text();
      if (text.includes('[R2.2C8]') || message.type() === 'error') {
        trace('BROWSER_CONSOLE', { type: message.type(), text });
      }
    });
    page.on('pageerror', (error) => {
      trace('PAGE_ERROR', { name: error.name, message: error.message });
    });
    await load(page, `http://127.0.0.1:${port}`);
    await openLead(page);

    const coordinate = page.locator('.pc-visit-coordinate');
    const coordinateSummary = coordinate.locator(':scope > summary');
    assert.equal(await coordinate.locator('form[data-coordinate-visit="1"]').count(), 0);
    assert.equal(await coordinate.locator('input[type="date"]').count(), 0);
    await coordinateSummary.click();
    let form = coordinate.locator('form[data-coordinate-visit="1"]');
    await form.waitFor({ state: 'visible' });
    assert.equal(await coordinate.locator('input[type="date"]').count(), 1);
    await coordinateSummary.click();
    await form.waitFor({ state: 'detached' });
    assert.equal(await coordinate.locator('form[data-coordinate-visit="1"]').count(), 0);
    assert.equal(await coordinate.locator('input[type="date"]').count(), 0);
    await coordinateSummary.click();
    form = coordinate.locator('form[data-coordinate-visit="1"]');
    await form.waitFor({ state: 'visible' });
    await form.locator('select[name="propertyId"]').selectOption('10');
    await form.locator('input[name="date"]').fill(futureLocalDate(3));
    await form.locator('input[name="time"]').fill('15:30');
    cloudTrace.phase = 'coordinate';
    const beforeSubmit = await page.evaluate(async () => {
      const store = await import('/dist/store.js');
      const client = store.state.crm.clients[0];
      return {
        visitsLength: store.state.crm.visits.length,
        visits: store.state.crm.visits.map((visit) => ({ id: visit.id, uid: visit.uid ?? null })),
        clientId: client?.id ?? null,
        clientRevision: client?.revision ?? null,
        clientPipeline: client?.pipeline ?? null,
      };
    });
    trace('BEFORE_DOUBLE_SUBMIT', beforeSubmit);
    await form.evaluate((node) => {
      const event = () => new SubmitEvent('submit', { bubbles: true, cancelable: true });
      node.dispatchEvent(event());
      node.dispatchEvent(event());
    });
    trace('AFTER_DOUBLE_SUBMIT_DISPATCH', { operationId: await form.getAttribute('data-operation-id') });
    await page.waitForFunction(async () => {
      const store = await import('/dist/store.js');
      return store.state.crm.visits.length === 1;
    });
    const afterWait = await page.evaluate(async () => {
      const store = await import('/dist/store.js');
      const client = store.state.crm.clients[0];
      const diagnosticWindow = window as Window & { __r2c8?: unknown };
      return {
        visitsLength: store.state.crm.visits.length,
        visits: store.state.crm.visits.map((visit) => ({ id: visit.id, uid: visit.uid ?? null })),
        clientId: client?.id ?? null,
        clientRevision: client?.revision ?? null,
        clientPipeline: client?.pipeline ?? null,
        diagnostic: diagnosticWindow.__r2c8 ?? null,
      };
    });
    trace('WAIT_VISIT_ONE_SATISFIED', afterWait);

    const afterCoordinate = await page.evaluate(async () => {
      const store = await import('/dist/store.js');
      return {
        visits: store.state.crm.visits,
        client: store.state.crm.clients[0],
        reminders: store.state.crm.reminders,
        activity: store.state.crm.activityLog,
      };
    });
    const finalDiagnostic = await page.evaluate(async ({ storageKey }) => {
      const store = await import('/dist/store.js');
      const diagnosticWindow = window as Window & { __r2c8?: unknown };
      const syncRaw = localStorage.getItem(`${storageKey}:sync`);
      let sync: unknown = null;
      try { sync = syncRaw ? JSON.parse(syncRaw) : null; } catch { sync = { parseError: true }; }
      const error = document.querySelector<HTMLElement>('[data-coordinate-visit] [data-visit-form-error]');
      return {
        visitsLength: store.state.crm.visits.length,
        visits: store.state.crm.visits.map((visit) => ({ id: visit.id, uid: visit.uid ?? null })),
        sync,
        formError: error?.textContent || '',
        formErrorHidden: error?.hidden ?? null,
        diagnostic: diagnosticWindow.__r2c8 ?? null,
      };
    }, { storageKey: STORAGE_KEY });
    trace('BEFORE_EXISTING_AFTER_COORDINATE_ASSERTION', finalDiagnostic);
    assert.equal(afterCoordinate.visits.length, 1);
    assert.equal(afterCoordinate.visits[0]?.status, 'Coordinada');
    assert.equal(afterCoordinate.visits[0]?.propertyId, 10);
    assert.equal(afterCoordinate.client.pipeline, 'Visita coordinada');
    assert.equal(afterCoordinate.client.nextAction, 'Visita · Docta Etapa 3');
    assert.equal(afterCoordinate.reminders.length, 0);
    assert.deepEqual(
      afterCoordinate.activity.map((entry) => entry.action),
      ['Visita coordinada'],
    );

    await openLead(page);
    const row = page.locator('.pc-visit-row[data-visit-id="1"]');
    const resultDisclosure = row.locator('.pc-visit-result');
    const resultSummary = resultDisclosure.locator(':scope > summary');
    const resultSummaryBox = await resultSummary.boundingBox();
    assert.ok(resultSummaryBox && resultSummaryBox.height >= 43.99, `target Registrar resultado ${JSON.stringify(resultSummaryBox)}`);
    assert.equal(await resultDisclosure.locator('form[data-register-visit-result="1"]').count(), 0);
    assert.equal(await resultDisclosure.locator('input[type="date"]').count(), 0);
    await resultSummary.click();
    let resultForm = row.locator('form[data-register-visit-result="1"]');
    await resultForm.waitFor({ state: 'visible' });
    assert.equal(await resultDisclosure.locator('input[type="date"]').count(), 1);
    await resultSummary.click();
    await resultForm.waitFor({ state: 'detached' });
    assert.equal(await resultDisclosure.locator('form[data-register-visit-result="1"]').count(), 0);
    assert.equal(await resultDisclosure.locator('input[type="date"]').count(), 0);
    await resultSummary.click();
    resultForm = row.locator('form[data-register-visit-result="1"]');
    await resultForm.waitFor({ state: 'visible' });
    await resultForm.locator('select[name="status"]').selectOption('Realizada');
    await resultForm.locator('select[name="interest"]').selectOption('Alto');
    await resultForm.locator('textarea[name="objection"]').fill('Quiere revisar expensas');
    await resultForm.locator('input[name="nextAction"]').fill('Enviar propuesta');
    await resultForm.locator('input[name="nextFollowUp"]').fill(futureLocalDate(5));
    await resultForm.locator('button[type="submit"]').click();

    await page.waitForFunction(async () => {
      const store = await import('/dist/store.js');
      return store.state.crm.visits[0]?.status === 'Realizada';
    });
    const afterResult = await page.evaluate(async () => {
      const store = await import('/dist/store.js');
      return {
        visits: store.state.crm.visits,
        client: store.state.crm.clients[0],
        activity: store.state.crm.activityLog,
      };
    });
    assert.equal(afterResult.visits.length, 1);
    assert.equal(afterResult.visits[0]?.status, 'Realizada');
    assert.equal(afterResult.visits[0]?.interest, 'Alto');
    assert.equal(afterResult.client.nextAction, 'Enviar propuesta');
    assert.deepEqual(
      afterResult.activity.map((entry) => entry.action),
      [
        'Visita realizada',
        'Visita coordinada',
      ],
    );
    await openLead(page);
    await page.waitForSelector('.pc-visit-status.status-realizada', { state: 'visible' });
    await assertNoOverflow(page, 'desktop');
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('P1.1-A2 browser mobile mantiene Visitas usable, targets táctiles y sin overflow', async () => {
  const port = 48232;
  const server = await startServer(port);
  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable() });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await installCloud(context, fixture());
    await seedContext(context);
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);
    await openLead(page);

    const coordinate = page.locator('.pc-visit-coordinate');
    const coordinateSummary = coordinate.locator(':scope > summary');
    const box = await coordinateSummary.boundingBox();
    assert.ok(box && box.height >= 43.99, `target Coordinar visita ${JSON.stringify(box)}`);
    const form = coordinate.locator('.pc-visit-form');
    assert.equal(await form.count(), 0);
    assert.equal(await coordinate.locator('input[type="date"]').count(), 0);
    await coordinateSummary.click();
    await form.waitFor({ state: 'visible' });
    assert.equal(await coordinate.locator('input[type="date"]').count(), 1);
    await coordinateSummary.click();
    await form.waitFor({ state: 'detached' });
    assert.equal(await form.count(), 0);
    assert.equal(await coordinate.locator('input[type="date"]').count(), 0);
    await coordinateSummary.click();
    await form.waitFor({ state: 'visible' });

    const inputs = coordinate.locator('.pc-visit-form input, .pc-visit-form select, .pc-visit-form button[type="submit"]');
    for (let index = 0; index < await inputs.count(); index += 1) {
      const inputBox = await inputs.nth(index).boundingBox();
      assert.ok(inputBox && inputBox.height >= 43.99, `mobile input ${index}: ${JSON.stringify(inputBox)}`);
    }
    await assertNoOverflow(page, 'mobile');
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});