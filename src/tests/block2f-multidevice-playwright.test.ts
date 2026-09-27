import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import {
  crmToCloudRecords,
  membershipContext,
  type CloudMembershipRow,
  type CloudRecordRow,
} from '../cloud-records.js';
import { initialData, type Client, type CrmData, type Property, type TeamMember } from '../models.js';
import { tenantConcurrencyBaselineKey } from '../tenant-concurrency-baseline.js';
import { tenantStorageNamespace } from '../tenant-storage.js';

const FIXED_TIME = new Date('2026-09-26T19:00:00-03:00');
const ORG = '11111111-1111-4111-8111-2f2f2f2f2f2f';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-2f2f2f2f2f2f';
const CLIENT_UID = '22222222-2222-4222-8222-000000000101';
const PROPERTY_UID = '33333333-3333-4333-8333-000000000201';

function chromeExecutable(): string {
  const executable = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(existsSync);
  assert.ok(executable, 'Chrome/Chromium no disponible para Bloque 2F.');
  return executable;
}

function owner(): TeamMember {
  return {
    id: 1,
    userId: USER,
    name: 'Owner Block2F',
    email: 'owner-block2f@example.test',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-09-26T12:00:00.000Z',
  };
}

function client(): Client {
  return {
    id: 101,
    uid: CLIENT_UID,
    revision: 7,
    name: 'CLIENTE BLOQUE 2F',
    phone: '5493515552101',
    email: 'client-block2f@example.test',
    interest: 'Dúplex en Docta',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Calificado',
    budget: 'USD 130.000',
    currency: 'USD',
    paymentMethod: 'Contado',
    zones: 'Docta',
    purpose: 'Vivir',
    purchaseTimeframe: '0-3 meses',
    canMoveForward: 'Sí',
    knowsArea: 'Sí',
    notes: 'base-client',
    assignedToId: 1,
    createdById: 1,
  };
}

function property(): Property {
  return {
    id: 201,
    uid: PROPERTY_UID,
    revision: 11,
    title: 'PROPERTY BLOQUE 2F',
    address: 'Docta, Córdoba',
    type: 'Dúplex',
    operation: 'Venta',
    price: 120000,
    owner: 'Sintético',
    status: 'Activa',
    bedrooms: 2,
    notes: 'base-property',
    assignedToId: 1,
    createdById: 1,
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: ORG,
    name: 'OrdenBroker Block2F',
    seatLimit: null,
    planLabel: 'Block2F',
    commercialPhone: '5493515110000',
    commercialEmail: 'qa@example.test',
    address: 'Córdoba',
    logoPath: '',
    legalText: '',
    defaultCurrency: 'USD',
    defaultZone: 'Córdoba',
    shareText: '',
  };
  crm.teamMembers = [owner()];
  crm.clients = [client()];
  crm.properties = [property()];
  crm.visits = [];
  crm.offers = [];
  crm.reservations = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.activityLog = [];
  crm.settings = {
    ...crm.settings,
    agencyName: crm.organization.name,
    agencyWhatsapp: '5493515110000',
  };
  return crm;
}

function membershipRows(crm: CrmData): CloudMembershipRow[] {
  return crm.teamMembers.map((member) => ({
    organization_id: crm.organization.id,
    member_id: member.id,
    user_id: member.userId!,
    role: 'owner',
    status: 'active',
    display_name: member.name,
    email: member.email,
    created_at: member.createdAt,
    last_active_at: '2026-09-26T18:00:00.000Z',
    organizations: {
      name: crm.organization.name,
      seat_limit: null,
      plan_label: crm.organization.planLabel,
    },
  }));
}

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  };
}

async function fulfillOptions(route: Route): Promise<void> {
  await route.fulfill({
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    },
    body: '',
  });
}

type RaceEntity = 'client' | 'property';
type ContextLabel = 'A' | 'B';

type RaceCall = Readonly<{
  label: ContextLabel;
  execute: () => Promise<void>;
  done: Promise<void>;
  resolveDone: () => void;
  rejectDone: (error: unknown) => void;
}>;

type RaceState = {
  entityType: RaceEntity;
  calls: Map<ContextLabel, RaceCall>;
  ready: Promise<void>;
  resolveReady: () => void;
  complete: Promise<void>;
  resolveComplete: () => void;
  rejectComplete: (error: unknown) => void;
  processing: boolean;
};

class SharedCloudHarness {
  private records: CloudRecordRow[];
  private readonly memberships: CloudMembershipRow[];
  private race: RaceState | null = null;
  private protectedGenericWrites = 0;
  private resolveProtectedGenericWrite!: () => void;
  private readonly protectedGenericWrite = new Promise<void>((resolve) => {
    this.resolveProtectedGenericWrite = resolve;
  });

  constructor(
    private readonly crm: CrmData,
    private readonly visitAuthorityActive = true,
  ) {
    this.memberships = membershipRows(crm);
    const context = membershipContext(this.memberships, USER);
    this.records = crmToCloudRecords(crm, context, USER).map((row) => ({
      ...structuredClone(row),
      updated_at: '2026-09-26T18:00:00.000Z',
    }));
  }

  armRace(entityType: RaceEntity): void {
    assert.equal(this.race, null, 'No puede haber dos carreras armadas a la vez.');
    let resolveReady!: () => void;
    let resolveComplete!: () => void;
    let rejectComplete!: (error: unknown) => void;
    this.race = {
      entityType,
      calls: new Map(),
      ready: new Promise<void>((resolve) => { resolveReady = resolve; }),
      resolveReady,
      complete: new Promise<void>((resolve, reject) => {
        resolveComplete = resolve;
        rejectComplete = reject;
      }),
      resolveComplete,
      rejectComplete,
      processing: false,
    };
  }

  async waitRaceReady(): Promise<void> {
    assert.ok(this.race);
    await this.race.ready;
  }

  async waitRaceComplete(): Promise<void> {
    const race = this.race;
    assert.ok(race);
    await race.complete;
    this.race = null;
  }

  clientNotes(): string {
    const row = this.findRecord('client', CLIENT_UID);
    return String((row.payload as Client).notes ?? '');
  }

  clientRevision(): number {
    const row = this.findRecord('client', CLIENT_UID);
    return Number((row.payload as Client).revision ?? 0);
  }

  propertyPrice(): number {
    const row = this.findRecord('property', PROPERTY_UID);
    return Number((row.payload as Property).price);
  }

  propertyRevision(): number {
    const row = this.findRecord('property', PROPERTY_UID);
    return Number((row.payload as Property).revision ?? 0);
  }

  protectedGenericUpsertCount(): number {
    return this.protectedGenericWrites;
  }

  remoteActivityCount(): number {
    return this.records.filter((row) => row.entity_type === 'activity').length;
  }

  async waitCasOrProtectedGeneric(): Promise<'cas' | 'generic'> {
    return Promise.race([
      this.waitRaceReady().then(() => 'cas' as const),
      this.protectedGenericWrite.then(() => 'generic' as const),
    ]);
  }

  private findRecord(entityType: RaceEntity, uid: string): CloudRecordRow {
    const row = this.records.find((item) => (
      item.entity_type === entityType
      && String((item.payload as { uid?: unknown })?.uid ?? '') === uid
    ));
    assert.ok(row, `No existe ${entityType} ${uid} en cloud harness.`);
    return row;
  }

  private labelFrom(route: Route): ContextLabel {
    const authorization = route.request().headers().authorization ?? '';
    if (authorization.includes('block2f-access-A')) return 'A';
    if (authorization.includes('block2f-access-B')) return 'B';
    throw new Error(`BLOCK2F_CONTEXT_LABEL_REQUIRED:${authorization}`);
  }

  private async registerRaceCall(
    entityType: RaceEntity,
    input: Pick<RaceCall, 'label' | 'execute'>,
  ): Promise<boolean> {
    const race = this.race;
    if (!race || race.entityType !== entityType) return false;

    let resolveDone!: () => void;
    let rejectDone!: (error: unknown) => void;
    const call: RaceCall = {
      ...input,
      done: new Promise<void>((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      }),
      resolveDone,
      rejectDone,
    };

    assert.equal(race.calls.has(call.label), false, `CAS duplicado para contexto ${call.label}.`);
    race.calls.set(call.label, call);

    if (race.calls.size === 2 && !race.processing) {
      race.processing = true;
      race.resolveReady();
      queueMicrotask(() => {
        void (async () => {
          const a = race.calls.get('A');
          const b = race.calls.get('B');
          try {
            assert.ok(a && b, 'La barrera debe contener A y B.');
            await a.execute();
            a.resolveDone();
            await b.execute();
            b.resolveDone();
            race.resolveComplete();
          } catch (error) {
            a?.rejectDone(error);
            b?.rejectDone(error);
            race.rejectComplete(error);
          }
        })();
      });
    }

    await call.done;
    return true;
  }

  private currentRevision(entityType: RaceEntity, uid: string): number {
    const row = this.findRecord(entityType, uid);
    return Number((row.payload as { revision?: unknown }).revision ?? 0);
  }

  private async handleClientCas(route: Route): Promise<void> {
    const request = route.request().postDataJSON() as {
      p_organization_id?: string;
      p_request?: {
        action?: 'update' | 'delete';
        client?: { uid?: string; legacyId?: number };
        expectedRevision?: number;
        payload?: Client;
        assignedMemberId?: number;
      };
    };
    const label = this.labelFrom(route);
    const intent = request.p_request ?? {};
    const uid = intent.client?.uid ?? CLIENT_UID;

    const execute = async (): Promise<void> => {
      if (request.p_organization_id !== ORG) {
        await route.fulfill(json({ code: '42501', message: 'PERMISSION_DENIED' }, 403));
        return;
      }
      const row = this.findRecord('client', uid);
      const current = Number((row.payload as Client).revision ?? 0);
      if (current !== Number(intent.expectedRevision)) {
        await route.fulfill(json({ code: '40001', message: 'CONFLICT' }, 409));
        return;
      }
      if (intent.action === 'delete') {
        this.records = this.records.filter((candidate) => candidate !== row);
        await route.fulfill(json({
          success: true,
          organizationId: ORG,
          action: 'delete',
          serverTimestamp: '2026-09-26T22:00:00.000Z',
        }));
        return;
      }
      assert.equal(intent.action, 'update');
      assert.ok(intent.payload);
      const previous = structuredClone(row.payload as Client);
      const next: Client = {
        ...structuredClone(intent.payload),
        id: previous.id,
        uid: previous.uid,
        revision: current + 1,
        assignedToId: intent.assignedMemberId ?? previous.assignedToId,
      };
      row.payload = next;
      row.assigned_member_id = next.assignedToId ?? row.assigned_member_id;
      row.updated_at = '2026-09-26T22:00:00.000Z';
      await route.fulfill(json({
        success: true,
        organizationId: ORG,
        action: 'update',
        client: next,
        serverTimestamp: '2026-09-26T22:00:00.000Z',
      }));
    };

    if (await this.registerRaceCall('client', { label, execute })) return;
    await execute();
  }

  private async handlePropertyCas(route: Route): Promise<void> {
    const request = route.request().postDataJSON() as {
      p_organization_id?: string;
      p_request?: {
        action?: 'insert' | 'update' | 'delete';
        property?: { uid?: string; legacyId?: number };
        expectedRevision?: number;
        payload?: Property;
        assignedMemberId?: number;
      };
    };
    const label = this.labelFrom(route);
    const intent = request.p_request ?? {};
    const uid = intent.property?.uid ?? PROPERTY_UID;

    const execute = async (): Promise<void> => {
      if (request.p_organization_id !== ORG) {
        await route.fulfill(json({ code: '42501', message: 'PERMISSION_DENIED' }, 403));
        return;
      }
      const row = this.findRecord('property', uid);
      const current = Number((row.payload as Property).revision ?? 0);
      if (current !== Number(intent.expectedRevision)) {
        await route.fulfill(json({ code: '40001', message: 'STALE_REVISION' }, 409));
        return;
      }
      if (intent.action === 'delete') {
        this.records = this.records.filter((candidate) => candidate !== row);
        await route.fulfill(json({
          success: true,
          organizationId: ORG,
          action: 'delete',
          serverTimestamp: '2026-09-26T22:00:00.000Z',
        }));
        return;
      }
      assert.equal(intent.action, 'update');
      assert.ok(intent.payload);
      const previous = structuredClone(row.payload as Property);
      const next: Property = {
        ...structuredClone(intent.payload),
        id: previous.id,
        uid: previous.uid,
        revision: current + 1,
        assignedToId: intent.assignedMemberId ?? previous.assignedToId,
      };
      row.payload = next;
      row.assigned_member_id = next.assignedToId ?? row.assigned_member_id;
      row.updated_at = '2026-09-26T22:00:00.000Z';
      await route.fulfill(json({
        success: true,
        organizationId: ORG,
        action: 'update',
        property: next,
        serverTimestamp: '2026-09-26T22:00:00.000Z',
      }));
    };

    if (await this.registerRaceCall('property', { label, execute })) return;
    await execute();
  }

  async installContext(context: BrowserContext): Promise<void> {
    await context.route('**/api/cloud-config', async (route) => {
      const requestOrigin = new URL(route.request().url()).origin;
      await route.fulfill(json({
        configured: true,
        url: requestOrigin,
        publishableKey: 'block2f-publishable-key',
      }));
    });

    await context.route('**/rest/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (request.method() === 'OPTIONS') {
        await fulfillOptions(route);
        return;
      }

      if (url.pathname.endsWith('/rest/v1/rpc/activate_my_organization_memberships')) {
        await route.fulfill(json({}));
        return;
      }

      if (url.pathname.endsWith('/rest/v1/organization_members')) {
        await route.fulfill(json(this.memberships));
        return;
      }

      if (url.pathname.endsWith('/rest/v1/rpc/visit_transaction_authority_active_v2')) {
        await route.fulfill(json(this.visitAuthorityActive));
        return;
      }

      if (url.pathname.endsWith('/rest/v1/rpc/client_snapshot_cas_v2')) {
        await this.handleClientCas(route);
        return;
      }

      if (url.pathname.endsWith('/rest/v1/rpc/property_snapshot_cas_v1')) {
        await this.handlePropertyCas(route);
        return;
      }

      if (url.pathname.endsWith('/rest/v1/propcontrol_records')) {
        if (request.method() === 'GET') {
          await route.fulfill(json(structuredClone(this.records)));
          return;
        }
        if (request.method() === 'POST' || request.method() === 'PATCH') {
          const body = request.postDataJSON();
          const rows = (Array.isArray(body) ? body : [body]) as CloudRecordRow[];
          const prefer = request.headers().prefer ?? '';
          if (prefer.includes('merge-duplicates')) {
            const protectedRows = rows.filter((row) => row.entity_type === 'client' || row.entity_type === 'property');
            if (protectedRows.length) {
              this.protectedGenericWrites += protectedRows.length;
              this.resolveProtectedGenericWrite();
            }
          }
          for (const incoming of rows) {
            const index = this.records.findIndex((row) => (
              row.organization_id === incoming.organization_id
              && row.entity_type === incoming.entity_type
              && row.entity_key === incoming.entity_key
            ));
            if (index >= 0 && prefer.includes('ignore-duplicates')) continue;
            const next = { ...structuredClone(incoming), updated_at: '2026-09-26T22:00:00.000Z' };
            if (index >= 0) this.records[index] = next;
            else this.records.push(next);
          }
          await route.fulfill(json([], request.method() === 'POST' ? 201 : 200));
          return;
        }
        if (request.method() === 'DELETE') {
          await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
          return;
        }
      }

      if (url.pathname.endsWith('/rest/v1/fichas')) {
        await route.fulfill(json([]));
        return;
      }

      await route.fulfill(json({ error: 'UNEXPECTED_BLOCK2F_ENDPOINT', path: url.pathname }, 500));
    });
  }
}

async function waitForServer(baseUrl: string): Promise<void> {
  let last: unknown;
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(baseUrl + '/health')).ok) return;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor Block2F no disponible: ' + String(last ?? 'sin respuesta'));
}

async function startServer(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['dist/server.js'], {
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
  await waitForServer('http://127.0.0.1:' + port);
  return child;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function contextFor(
  browser: Browser,
  harness: SharedCloudHarness,
  crm: CrmData,
  label: ContextLabel,
  viewport: { width: number; height: number },
): Promise<{ context: BrowserContext; syncKey: string; baselineKey: string }> {
  const context = await browser.newContext({
    viewport,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    hasTouch: viewport.width <= 720,
    isMobile: viewport.width <= 430,
  });
  await harness.installContext(context);

  const namespace = tenantStorageNamespace({ userId: USER, organizationId: ORG });
  const baselineKey = tenantConcurrencyBaselineKey({ userId: USER, organizationId: ORG });
  const localSeed = structuredClone(crm);
  const seededClient = localSeed.clients.find((item) => item.id === 101);
  assert.ok(seededClient);
  seededClient.notes = 'BLOCK2F-BOOTSTRAP-' + label;
  const markerKey = 'block2f-seed:' + label;
  await context.addInitScript(({ data, crmKey, syncKey, label: contextLabel, markerKey: seedMarkerKey }) => {
    if (localStorage.getItem(seedMarkerKey)) return;
    localStorage.setItem(seedMarkerKey, '1');
    const generation = 'block2f-generation-' + contextLabel;
    localStorage.setItem('propcontrol-cloud-auth-generation-v1', generation);
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'block2f-access-' + contextLabel,
      refreshToken: 'block2f-refresh-' + contextLabel,
      expiresAt: 4102444800000,
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-2f2f2f2f2f2f',
      email: 'owner-block2f@example.test',
      __propcontrolAuthGeneration: generation,
    }));
    localStorage.setItem(crmKey, JSON.stringify(data));
    localStorage.setItem(syncKey, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-09-26T18:00:00.000Z',
      lastCloudSavedAt: '2026-09-26T18:00:00.000Z',
      lastCloudVersion: '2026-09-26T18:00:00.000Z',
      localGeneration: 0,
      verifiedGeneration: 0,
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, {
    data: localSeed,
    crmKey: namespace.crmKey,
    syncKey: namespace.syncKey,
    label,
    markerKey,
  });
  return { context, syncKey: namespace.syncKey, baselineKey };
}

async function openApp(page: Page, baseUrl: string, baselineKey: string): Promise<void> {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20000 });
  await page.waitForFunction(async (key) => {
    if (!localStorage.getItem(key)) return false;
    const store = await import('/dist/store.js') as unknown as { state: { crm: CrmData } };
    return store.state.crm.clients.find((item) => item.id === 101)?.notes === 'base-client';
  }, baselineKey, { timeout: 30000 });
}

async function crmState(page: Page): Promise<CrmData> {
  return page.evaluate(async () => structuredClone((await import('/dist/store.js')).state.crm) as CrmData);
}

async function mutateClientAndSave(page: Page, notes: string): Promise<void> {
  await page.evaluate(async ({ clientId, nextNotes }) => {
    const store = await import('/dist/store.js') as unknown as {
      state: { crm: CrmData };
      saveData: (reason?: string) => void;
    };
    const target = store.state.crm.clients.find((item) => item.id === clientId);
    if (!target) throw new Error('BLOCK2F_CLIENT_NOT_FOUND');
    target.notes = nextNotes;
    store.saveData('BLOCK2F concurrent Client edit');
  }, { clientId: 101, nextNotes: notes });
}

async function mutatePropertyAndSave(page: Page, price: number): Promise<void> {
  await page.evaluate(async ({ propertyId, nextPrice }) => {
    const store = await import('/dist/store.js') as unknown as {
      state: { crm: CrmData };
      saveData: (reason?: string) => void;
    };
    const target = store.state.crm.properties.find((item) => item.id === propertyId);
    if (!target) throw new Error('BLOCK2F_PROPERTY_NOT_FOUND');
    target.price = nextPrice;
    store.saveData('BLOCK2F concurrent Property edit');
  }, { propertyId: 201, nextPrice: price });
}

async function waitSyncClean(page: Page, syncKey: string): Promise<void> {
  await page.waitForFunction((key) => {
    const state = JSON.parse(localStorage.getItem(key) || '{}') as { dirty?: boolean; lastError?: string };
    return state.dirty === false && !state.lastError;
  }, syncKey, { timeout: 30000 });
}

async function waitSyncConflict(page: Page, syncKey: string): Promise<void> {
  await page.waitForFunction((key) => {
    const state = JSON.parse(localStorage.getItem(key) || '{}') as { dirty?: boolean; lastError?: string };
    return state.dirty === true
      && String(state.lastError || '').includes('cambió en otro dispositivo')
      && String(state.lastError || '').includes('no sobrescribieron');
  }, syncKey, { timeout: 30000 });
}

test('2F Playwright determinista: mismo Client revision=7, A gana y B falla cerrado sin lost update', { timeout: 180_000 }, async () => {
  const server = await startServer(63531);
  const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
  const seed = fixture();
  const harness = new SharedCloudHarness(seed);
  const a = await contextFor(browser, harness, seed, 'A', { width: 1366, height: 900 });
  const b = await contextFor(browser, harness, seed, 'B', { width: 390, height: 844 });

  try {
    const pageA = await a.context.newPage();
    const pageB = await b.context.newPage();
    await Promise.all([
      openApp(pageA, 'http://127.0.0.1:63531', a.baselineKey),
      openApp(pageB, 'http://127.0.0.1:63531', b.baselineKey),
    ]);

    const [crmA, crmB] = await Promise.all([crmState(pageA), crmState(pageB)]);
    assert.equal(crmA.clients[0]?.revision, 7);
    assert.equal(crmB.clients[0]?.revision, 7);

    harness.armRace('client');
    await Promise.all([
      mutateClientAndSave(pageA, 'CLIENT-WINNER-A'),
      mutateClientAndSave(pageB, 'CLIENT-STALE-B'),
    ]);
    await harness.waitRaceReady();
    await harness.waitRaceComplete();

    await Promise.all([
      waitSyncClean(pageA, a.syncKey),
      waitSyncConflict(pageB, b.syncKey),
    ]);

    assert.equal(harness.clientNotes(), 'CLIENT-WINNER-A');
    assert.equal(harness.clientRevision(), 8);

    const staleLocal = await crmState(pageB);
    assert.equal(staleLocal.clients[0]?.notes, 'CLIENT-STALE-B', 'El cambio local stale debe quedar disponible para revisión.');

    await pageB.reload({ waitUntil: 'domcontentloaded' });
    await pageB.waitForSelector('#crm.active', { state: 'visible', timeout: 20000 });
    await waitSyncConflict(pageB, b.syncKey);
    const afterReload = await crmState(pageB);
    assert.equal(afterReload.clients[0]?.notes, 'CLIENT-STALE-B');
    assert.equal(harness.clientNotes(), 'CLIENT-WINNER-A');
  } finally {
    await a.context.close();
    await b.context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('2F Playwright determinista: mismo Property revision=11, notebook gana y mobile recibe conflicto', { timeout: 180_000 }, async () => {
  const server = await startServer(63532);
  const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
  const seed = fixture();
  const harness = new SharedCloudHarness(seed);
  const a = await contextFor(browser, harness, seed, 'A', { width: 1366, height: 900 });
  const b = await contextFor(browser, harness, seed, 'B', { width: 390, height: 844 });

  try {
    const pageA = await a.context.newPage();
    const pageB = await b.context.newPage();
    await Promise.all([
      openApp(pageA, 'http://127.0.0.1:63532', a.baselineKey),
      openApp(pageB, 'http://127.0.0.1:63532', b.baselineKey),
    ]);

    const [crmA, crmB] = await Promise.all([crmState(pageA), crmState(pageB)]);
    assert.equal(crmA.properties[0]?.revision, 11);
    assert.equal(crmB.properties[0]?.revision, 11);

    harness.armRace('property');
    await Promise.all([
      mutatePropertyAndSave(pageA, 125000),
      mutatePropertyAndSave(pageB, 129000),
    ]);
    await harness.waitRaceReady();
    await harness.waitRaceComplete();

    await Promise.all([
      waitSyncClean(pageA, a.syncKey),
      waitSyncConflict(pageB, b.syncKey),
    ]);

    assert.equal(harness.propertyPrice(), 125000);
    assert.equal(harness.propertyRevision(), 12);

    const staleLocal = await crmState(pageB);
    assert.equal(staleLocal.properties[0]?.price, 129000, 'El Property stale debe permanecer local para revisión.');
    const winnerLocal = await crmState(pageA);
    assert.equal(winnerLocal.properties[0]?.price, 125000);
  } finally {
    await a.context.close();
    await b.context.close();
    await browser.close();
    await stopServer(server);
  }
});


test('2F authority=false: Client y Property siguen por CAS y stale falla cerrado sin generic upsert', { timeout: 240_000 }, async () => {
  const server = await startServer(63533);
  const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
  const baseUrl = 'http://127.0.0.1:63533';

  const runScenario = async (entityType: RaceEntity): Promise<void> => {
    const seed = fixture();
    const harness = new SharedCloudHarness(seed, false);
    const a = await contextFor(browser, harness, seed, 'A', { width: 1366, height: 900 });
    const b = await contextFor(browser, harness, seed, 'B', { width: 390, height: 844 });
    try {
      const pageA = await a.context.newPage();
      const pageB = await b.context.newPage();
      await Promise.all([
        openApp(pageA, baseUrl, a.baselineKey),
        openApp(pageB, baseUrl, b.baselineKey),
      ]);

      harness.armRace(entityType);
      if (entityType === 'client') {
        await Promise.all([
          mutateClientAndSave(pageA, 'AUTH-FALSE-CLIENT-WINNER-A'),
          mutateClientAndSave(pageB, 'AUTH-FALSE-CLIENT-STALE-B'),
        ]);
      } else {
        await Promise.all([
          mutatePropertyAndSave(pageA, 126000),
          mutatePropertyAndSave(pageB, 129500),
        ]);
      }

      assert.equal(
        await harness.waitCasOrProtectedGeneric(),
        'cas',
        'authority=false no puede derivar Client/Property a merge-duplicates genérico.',
      );
      await harness.waitRaceComplete();
      await Promise.all([
        waitSyncClean(pageA, a.syncKey),
        waitSyncConflict(pageB, b.syncKey),
      ]);

      assert.equal(harness.protectedGenericUpsertCount(), 0);
      assert.equal(harness.remoteActivityCount(), 0, 'Un CAS stale no debe crear Activity remota de éxito.');

      if (entityType === 'client') {
        assert.equal(harness.clientNotes(), 'AUTH-FALSE-CLIENT-WINNER-A');
        assert.equal(harness.clientRevision(), 8);
        const stale = await crmState(pageB);
        assert.equal(stale.clients[0]?.notes, 'AUTH-FALSE-CLIENT-STALE-B');
      } else {
        assert.equal(harness.propertyPrice(), 126000);
        assert.equal(harness.propertyRevision(), 12);
        const stale = await crmState(pageB);
        assert.equal(stale.properties[0]?.price, 129500);
      }
    } finally {
      await a.context.close();
      await b.context.close();
    }
  };

  try {
    await runScenario('client');
    await runScenario('property');
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
