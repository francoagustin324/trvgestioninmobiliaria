import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import {
  crmToCloudRecords,
  isSupervisedRecommendationTelemetryPayload,
  type CloudMembershipContext,
  type CloudRecordRow,
} from '../cloud-records.js';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const ATTEMPT_KEY = `propcontrol-whatsapp-contact-attempt-v1:${ORG_ID}:1`;
const ACTOR_KEY = `cloud:${USER_ID}`;
const IDENTITY_KEY = `propcontrol-whatsapp-human-identity-v1:${encodeURIComponent(ORG_ID)}:1:${encodeURIComponent(ACTOR_KEY)}`;
const FIXED_TIME = new Date('2026-08-07T16:52:00-03:00');
const FOLLOW_UP_DATE = '2026-08-10';
const FIRST_WRITE_TIMEOUT_MS = 20_000;

type DiagnosticPhase =
  | 'BEFORE_CONTACT_CLICK'
  | 'AFTER_CONTACT_CLICK'
  | 'AFTER_WHATSAPP_OPEN'
  | 'AFTER_FIRST_750'
  | 'BEFORE_CONFIRM'
  | 'IMMEDIATELY_AFTER_CONFIRM'
  | 'AFTER_SECOND_750';

type PostClassification = 'STARTUP' | 'CONTACT_ONLY' | 'CONTACT_PLUS_FOLLOWUP' | 'FOLLOWUP_UPDATE' | 'OTHER';

interface TestWindow extends Window {
  __diagStatusEvents?: Array<{ message: string; kind: string }>;
  __windowOpened?: boolean;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  isResolved: () => boolean;
}

interface PostEvidence {
  sequence: number;
  phase: DiagnosticPhase;
  entityTypesKeys: string[];
  nextFollowUp: string;
  nextAction: string;
  contactActivityCount: number;
  followUpActivityCount: number;
  organizationIds: string[];
  createdBy: string[];
  telemetryMixed: boolean;
  classification: PostClassification;
  bodySha256: string;
}

interface LocalCheckpoint {
  nextFollowUp: string;
  nextAction: string;
  contactActivityCount: number;
  followUpActivityCount: number;
  organizationId: string;
  memberUserId: string;
  attemptId: string;
  identityPresent: boolean;
  identityActorKey: string;
  statusEvents: Array<{ message: string; kind: string }>;
}

interface DomCheckpoint {
  title: string;
  changeFollowUp: boolean;
  chooseFollowUp: boolean;
  nominalFollowUpForm: boolean;
  zeroFollowUpForm: boolean;
}

function deferred(): Deferred {
  let settled = false;
  let settle!: () => void;
  const promise = new Promise<void>((done) => { settle = done; });
  return {
    promise,
    resolve: () => {
      if (settled) return;
      settled = true;
      settle();
    },
    isResolved: () => settled,
  };
}

async function waitForSignal(promise: Promise<void>, label: string, timeoutMs: number): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label}_TIMEOUT_${timeoutMs}MS`)), timeoutMs);
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
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
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'A3.5 #528 diagnostic' };
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

function recordIdentity(record: Pick<CloudRecordRow, 'organization_id' | 'entity_type' | 'entity_key'>): string {
  return `${record.organization_id}|${record.entity_type}|${record.entity_key}`;
}

function isTelemetryRow(record: CloudRecordRow): boolean {
  return isSupervisedRecommendationTelemetryPayload(record.payload);
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

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function summarizePost(rows: CloudRecordRow[], sequence: number, phase: DiagnosticPhase): PostEvidence {
  const telemetryRows = rows.filter(isTelemetryRow);
  const crmRows = rows.filter((row) => !isTelemetryRow(row));
  const clientRow = crmRows.find((row) => row.entity_type === 'client' && Number((row.payload as { id?: unknown }).id) === 1)
    ?? crmRows.find((row) => row.entity_type === 'client');
  const clientPayload = (clientRow?.payload || {}) as { nextFollowUp?: string; nextAction?: string };
  const activityRows = crmRows.filter((row) => row.entity_type === 'activity');
  const contactActivityCount = activityRows.filter((row) => (row.payload as { action?: string }).action === 'Contacto por WhatsApp').length;
  const followUpActivityCount = activityRows.filter((row) => (row.payload as { action?: string }).action === 'Seguimiento por WhatsApp programado').length;
  const nextFollowUp = clientPayload.nextFollowUp || '';
  const nextAction = clientPayload.nextAction || '';
  let classification: PostClassification = 'OTHER';
  if (contactActivityCount === 0 && followUpActivityCount === 0 && !nextFollowUp && !nextAction) classification = 'STARTUP';
  else if (contactActivityCount > 0 && followUpActivityCount === 0 && !nextFollowUp) classification = 'CONTACT_ONLY';
  else if (contactActivityCount > 0 && followUpActivityCount > 0 && nextFollowUp) classification = 'CONTACT_PLUS_FOLLOWUP';
  else if (followUpActivityCount > 0 || nextFollowUp || nextAction) classification = 'FOLLOWUP_UPDATE';
  const bodySha256 = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  return {
    sequence,
    phase,
    entityTypesKeys: crmRows.map((row) => `${row.entity_type}:${row.entity_key}`),
    nextFollowUp,
    nextAction,
    contactActivityCount,
    followUpActivityCount,
    organizationIds: unique(crmRows.map((row) => row.organization_id)),
    createdBy: unique(crmRows.map((row) => row.created_by)),
    telemetryMixed: telemetryRows.length > 0 && crmRows.length > 0,
    classification,
    bodySha256,
  };
}

async function installCloudRoutes(context: BrowserContext, initial: CrmData): Promise<{
  setPhase: (phase: DiagnosticPhase) => void;
  firstWriteStarted: Promise<void>;
  firstWriteStartedSettled: () => boolean;
  releaseFirstWrite: () => void;
  firstReleasePending: () => boolean;
  crmPostCount: () => number;
  v2AuthorityCalls: () => number;
  posts: () => PostEvidence[];
  firstHeldBodyCaptured: () => boolean;
}> {
  let phase: DiagnosticPhase = 'BEFORE_CONTACT_CLICK';
  let remote = crmToCloudRecords(initial, contextForCloud(), USER_ID)
    .map((record) => ({ ...structuredClone(record), updated_at: '2026-08-07T19:40:00.000Z' }));
  let crmPostCount = 0;
  let v2AuthorityCalls = 0;
  let writeSequence = 0;
  let firstHeldBody: CloudRecordRow[] | null = null;
  const evidence: PostEvidence[] = [];
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
    if (url.pathname.endsWith('/propcontrol_records') && method === 'GET') return fulfill(filteredRows(remote, url));
    if (url.pathname.endsWith('/propcontrol_records') && method === 'DELETE') {
      const deleting = new Set(filteredRows(remote, url).map(recordIdentity));
      remote = remote.filter((row) => !deleting.has(recordIdentity(row)));
      return fulfill([]);
    }
    if (url.pathname.endsWith('/propcontrol_records') && method === 'POST') {
      const body = structuredClone(request.postDataJSON() as CloudRecordRow[]);
      const crm = body.filter((row) => !isTelemetryRow(row));
      if (crm.length) {
        crmPostCount += 1;
        const summary = summarizePost(body, crmPostCount, phase);
        evidence.push(summary);
        console.log(`POST_${summary.sequence}_PHASE=${summary.phase}`);
        console.log(`POST_${summary.sequence}_CLASSIFICATION=${summary.classification}`);
        console.log(`POST_${summary.sequence}_ENTITY_TYPES_KEYS=${summary.entityTypesKeys.join(',')}`);
        console.log(`POST_${summary.sequence}_CLIENT_NEXT_FOLLOWUP=${summary.nextFollowUp || '<undefined>'}`);
        console.log(`POST_${summary.sequence}_CLIENT_NEXT_ACTION=${summary.nextAction || '<undefined>'}`);
        console.log(`POST_${summary.sequence}_CONTACT_ACTIVITY_COUNT=${summary.contactActivityCount}`);
        console.log(`POST_${summary.sequence}_FOLLOWUP_ACTIVITY_COUNT=${summary.followUpActivityCount}`);
        console.log(`POST_${summary.sequence}_ORGANIZATION_IDS=${summary.organizationIds.join(',')}`);
        console.log(`POST_${summary.sequence}_CREATED_BY=${summary.createdBy.join(',')}`);
        console.log(`POST_${summary.sequence}_TELEMETRY_MIXED=${summary.telemetryMixed ? 'YES' : 'NO'}`);
        console.log(`POST_${summary.sequence}_BODY_SHA256=${summary.bodySha256}`);
        if (crmPostCount === 1) {
          firstHeldBody = structuredClone(body);
          console.log('FIRST_HELD_BODY_CAPTURED_BEFORE_BLOCK=YES');
          firstStarted.resolve();
          await firstRelease.promise;
        }
      }
      upsert(body);
      return fulfill([]);
    }
    return route.fulfill({ status: 404, body: '{}' });
  });

  return {
    setPhase: (next) => { phase = next; },
    firstWriteStarted: firstStarted.promise,
    firstWriteStartedSettled: firstStarted.isResolved,
    releaseFirstWrite: firstRelease.resolve,
    firstReleasePending: () => !firstRelease.isResolved(),
    crmPostCount: () => crmPostCount,
    v2AuthorityCalls: () => v2AuthorityCalls,
    posts: () => structuredClone(evidence),
    firstHeldBodyCaptured: () => firstHeldBody !== null,
  };
}

async function installStorage(context: BrowserContext, crm: CrmData): Promise<void> {
  await context.addInitScript(({ data, identityStorageKey, userId, organizationId, storageKey }) => {
    const target = window as TestWindow;
    target.__diagStatusEvents = [];
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000,
      userId, email: 'franco@propcontrol.test',
    }));
    if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify(data));
    if (!localStorage.getItem(`${storageKey}:sync`)) {
      localStorage.setItem(`${storageKey}:sync`, JSON.stringify({ dirty: false, localUpdatedAt: '2026-08-07T19:40:00.000Z', lastCloudSavedAt: '2026-08-07T19:40:00.000Z', lastCloudVersion: '2026-08-07T19:40:00.000Z' }));
    }
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
    localStorage.setItem(identityStorageKey, JSON.stringify({ version: 1, organizationId, memberId: 1, actorKey: `cloud:${userId}`, humanName: 'Franco Solis', confirmedAt: '2026-08-07T19:40:00.000Z' }));
    document.addEventListener('propcontrol-cloud-status', (event) => {
      const detail = (event as CustomEvent<{ message?: string; kind?: string }>).detail;
      if (detail?.message) target.__diagStatusEvents?.push({ message: detail.message, kind: detail.kind || '' });
    });
    Object.defineProperty(window, 'open', { configurable: true, value: () => { target.__windowOpened = true; return null; } });
  }, { data: crm, identityStorageKey: IDENTITY_KEY, userId: USER_ID, organizationId: ORG_ID, storageKey: STORAGE_KEY });
}

async function load(page: Page, url: string): Promise<void> {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('[data-contact-whatsapp="1"]', { state: 'visible', timeout: 20_000 });
}

async function localCheckpoint(page: Page): Promise<LocalCheckpoint> {
  return page.evaluate(({ storageKey, attemptKey, identityKey }) => {
    const crm = JSON.parse(localStorage.getItem(storageKey) || '{}') as CrmData;
    const client = crm.clients?.find((item) => item.id === 1);
    const attemptRaw = localStorage.getItem(attemptKey);
    const identityRaw = localStorage.getItem(identityKey);
    const attempt = attemptRaw ? JSON.parse(attemptRaw) as { id?: string } : null;
    const identity = identityRaw ? JSON.parse(identityRaw) as { actorKey?: string } : null;
    return {
      nextFollowUp: client?.nextFollowUp || '',
      nextAction: client?.nextAction || '',
      contactActivityCount: crm.activityLog?.filter((entry) => entry.action === 'Contacto por WhatsApp').length || 0,
      followUpActivityCount: crm.activityLog?.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length || 0,
      organizationId: crm.organization?.id || '',
      memberUserId: crm.teamMembers?.find((member) => member.id === 1)?.userId || '',
      attemptId: attempt?.id || '',
      identityPresent: Boolean(identityRaw),
      identityActorKey: identity?.actorKey || '',
      statusEvents: structuredClone((window as TestWindow).__diagStatusEvents || []),
    };
  }, { storageKey: STORAGE_KEY, attemptKey: ATTEMPT_KEY, identityKey: IDENTITY_KEY });
}

async function domCheckpoint(page: Page): Promise<DomCheckpoint> {
  return page.evaluate(() => ({
    title: document.querySelector('#whatsapp-contact-title')?.textContent?.trim() || '',
    changeFollowUp: Boolean(document.querySelector('[data-whatsapp-change-followup]')),
    chooseFollowUp: Boolean(document.querySelector('[data-whatsapp-choose-followup]')),
    nominalFollowUpForm: Boolean(document.querySelector('[data-whatsapp-followup-form]')),
    zeroFollowUpForm: Boolean(document.querySelector('[data-zero-followup-form]')),
  }));
}

function logCheckpoint(label: string, local: LocalCheckpoint, dom: DomCheckpoint, crmPostCount: number, firstWriteStarted: boolean): void {
  console.log(`${label}_CRM_POST_COUNT=${crmPostCount}`);
  console.log(`${label}_FIRST_WRITE_STARTED=${firstWriteStarted ? 'YES' : 'NO'}`);
  console.log(`${label}_NEXT_FOLLOWUP=${local.nextFollowUp || '<undefined>'}`);
  console.log(`${label}_NEXT_ACTION=${local.nextAction || '<undefined>'}`);
  console.log(`${label}_CONTACT_ACTIVITY_COUNT=${local.contactActivityCount}`);
  console.log(`${label}_FOLLOWUP_ACTIVITY_COUNT=${local.followUpActivityCount}`);
  console.log(`${label}_TITLE=${dom.title || '<none>'}`);
  console.log(`${label}_CHANGE_FOLLOWUP=${dom.changeFollowUp ? 'YES' : 'NO'}`);
  console.log(`${label}_CHOOSE_FOLLOWUP=${dom.chooseFollowUp ? 'YES' : 'NO'}`);
  console.log(`${label}_NOMINAL_FOLLOWUP_FORM=${dom.nominalFollowUpForm ? 'YES' : 'NO'}`);
  console.log(`${label}_ZERO_FOLLOWUP_FORM=${dom.zeroFollowUpForm ? 'YES' : 'NO'}`);
}

async function recordedAttemptObservable(page: Page, attemptId: string): Promise<boolean> {
  if (!attemptId) return false;
  return page.evaluate(({ storageKey, marker }) => {
    const crm = JSON.parse(localStorage.getItem(storageKey) || '{}') as CrmData;
    return Boolean(crm.activityLog?.some((entry) => String(entry.detail || '').includes(marker)));
  }, { storageKey: STORAGE_KEY, marker: `Intento: ${attemptId}` });
}

test('A3.5 #528 diagnostic: exact POST provenance and zero-training state around confirm', { timeout: 120_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible.');
  const port = 61640 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  const browser: Browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-AR', timezoneId: 'America/Argentina/Cordoba', colorScheme: 'dark' });
  const data = fixture();
  await installStorage(context, data);
  const cloud = await installCloudRoutes(context, data);

  let page: Page | null = null;
  try {
    page = await context.newPage();
    const url = `http://127.0.0.1:${port}`;
    cloud.setPhase('BEFORE_CONTACT_CLICK');
    await load(page, url);

    const afterLoad = await localCheckpoint(page);
    const afterLoadDom = await domCheckpoint(page);
    const postsBeforeContact = cloud.crmPostCount();
    logCheckpoint('CHECKPOINT_1_AFTER_LOAD', afterLoad, afterLoadDom, postsBeforeContact, cloud.firstWriteStartedSettled());
    console.log(`POST_EXISTED_BEFORE_CONTACT=${postsBeforeContact > 0 ? 'YES' : 'NO'}`);

    cloud.setPhase('AFTER_CONTACT_CLICK');
    await page.locator('[data-contact-whatsapp="1"]').click();

    cloud.setPhase('AFTER_WHATSAPP_OPEN');
    await page.locator('[data-whatsapp-open]').click();
    const afterOpen = await localCheckpoint(page);
    const afterOpenDom = await domCheckpoint(page);
    logCheckpoint('CHECKPOINT_2_AFTER_WHATSAPP_OPEN_BEFORE_FIRST_750', afterOpen, afterOpenDom, cloud.crmPostCount(), cloud.firstWriteStartedSettled());

    cloud.setPhase('AFTER_FIRST_750');
    await page.clock.runFor(750);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterFirst750 = await localCheckpoint(page);
    const afterFirst750Dom = await domCheckpoint(page);
    logCheckpoint('CHECKPOINT_3_AFTER_FIRST_750', afterFirst750, afterFirst750Dom, cloud.crmPostCount(), cloud.firstWriteStartedSettled());
    if (cloud.firstWriteStartedSettled()) {
      console.log(`FIRST_POST_CLASSIFICATION_AFTER_FIRST_750=${cloud.posts()[0]?.classification || 'OTHER'}`);
    }

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible' });
    cloud.setPhase('BEFORE_CONFIRM');
    const beforeConfirm = await localCheckpoint(page);
    const beforeConfirmDom = await domCheckpoint(page);
    const postsBeforeConfirm = cloud.crmPostCount();
    const attemptIdBeforeConfirm = beforeConfirm.attemptId;
    logCheckpoint('CHECKPOINT_4_BEFORE_CONFIRM', beforeConfirm, beforeConfirmDom, postsBeforeConfirm, cloud.firstWriteStartedSettled());
    console.log(`POST_EXISTED_BEFORE_CONFIRM=${postsBeforeConfirm > 0 ? 'YES' : 'NO'}`);
    console.log(`PENDING_ATTEMPT_ID_BEFORE_CONFIRM=${attemptIdBeforeConfirm || '<none>'}`);

    cloud.setPhase('IMMEDIATELY_AFTER_CONFIRM');
    await page.locator('[data-whatsapp-confirm-sent]').click();
    const immediatelyAfterConfirm = await localCheckpoint(page);
    const immediatelyAfterConfirmDom = await domCheckpoint(page);
    const recordedAttemptAfterConfirm = await recordedAttemptObservable(page, attemptIdBeforeConfirm);
    logCheckpoint('CHECKPOINT_5_IMMEDIATELY_AFTER_CONFIRM', immediatelyAfterConfirm, immediatelyAfterConfirmDom, cloud.crmPostCount(), cloud.firstWriteStartedSettled());
    console.log(`RECORDED_ACTIVITY_FOR_ATTEMPT_OBSERVABLE=${recordedAttemptAfterConfirm ? 'PRESENT' : 'ABSENT'}`);
    console.log(`LOCAL_AFTER_CONFIRM_ORGANIZATION_ID=${immediatelyAfterConfirm.organizationId}`);
    console.log(`LOCAL_AFTER_CONFIRM_MEMBER_USER_ID=${immediatelyAfterConfirm.memberUserId}`);
    console.log(`LOCAL_AFTER_CONFIRM_IDENTITY_PRESENT=${immediatelyAfterConfirm.identityPresent ? 'YES' : 'NO'}`);
    console.log(`LOCAL_AFTER_CONFIRM_IDENTITY_ACTOR_KEY=${immediatelyAfterConfirm.identityActorKey || '<none>'}`);
    console.log(`STATUS_EVENTS_AFTER_CONFIRM=${JSON.stringify(immediatelyAfterConfirm.statusEvents)}`);

    await page.clock.runFor(699);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const after699 = await localCheckpoint(page);
    const after699Dom = await domCheckpoint(page);
    logCheckpoint('CHECKPOINT_6_AFTER_SECOND_699', after699, after699Dom, cloud.crmPostCount(), cloud.firstWriteStartedSettled());

    cloud.setPhase('AFTER_SECOND_750');
    await page.clock.runFor(51);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterSecond750 = await localCheckpoint(page);
    const afterSecond750Dom = await domCheckpoint(page);
    logCheckpoint('CHECKPOINT_7_AFTER_SECOND_750', afterSecond750, afterSecond750Dom, cloud.crmPostCount(), cloud.firstWriteStartedSettled());

    if (cloud.firstWriteStartedSettled()) {
      await waitForSignal(cloud.firstWriteStarted, 'FIRST_WRITE_STARTED', FIRST_WRITE_TIMEOUT_MS);
    }

    const posts = cloud.posts();
    const first = posts[0];
    const scheduleFailure = immediatelyAfterConfirm.statusEvents.find((event) => /no se pudo programar el próximo contacto/i.test(event.message));
    const scheduleSucceeded = immediatelyAfterConfirm.nextFollowUp === FOLLOW_UP_DATE
      && immediatelyAfterConfirm.nextAction === 'Volver a contactar por WhatsApp'
      && immediatelyAfterConfirm.followUpActivityCount === 1;
    const zeroTrainingExecuted = immediatelyAfterConfirm.contactActivityCount === 1
      && Boolean(immediatelyAfterConfirmDom.title)
      && (immediatelyAfterConfirmDom.changeFollowUp || immediatelyAfterConfirmDom.chooseFollowUp)
      && (scheduleSucceeded || Boolean(scheduleFailure));

    console.log(`ZERO_TRAINING_CONFIRM_HANDLER_EXECUTED=${zeroTrainingExecuted ? 'YES' : 'NO'}`);
    console.log(`SCHEDULE_FOLLOWUP_SUCCEEDED=${scheduleSucceeded ? 'YES' : 'NO'}`);
    console.log(`SCHEDULE_FOLLOWUP_FAILURE_REASON=${scheduleFailure?.message || ''}`);
    console.log(`DONE_TITLE_AFTER_CONFIRM=${immediatelyAfterConfirmDom.title || '<none>'}`);
    console.log(`CHANGE_FOLLOWUP_BUTTON_AFTER_CONFIRM=${immediatelyAfterConfirmDom.changeFollowUp ? 'YES' : 'NO'}`);
    console.log(`CHOOSE_FOLLOWUP_BUTTON_AFTER_CONFIRM=${immediatelyAfterConfirmDom.chooseFollowUp ? 'YES' : 'NO'}`);
    console.log(`NOMINAL_FOLLOWUP_FORM_AFTER_CONFIRM=${immediatelyAfterConfirmDom.nominalFollowUpForm ? 'YES' : 'NO'}`);
    console.log(`ZERO_FOLLOWUP_FORM_AFTER_CONFIRM=${immediatelyAfterConfirmDom.zeroFollowUpForm ? 'YES' : 'NO'}`);
    console.log(`LOCAL_BEFORE_CONFIRM_NEXT_FOLLOWUP=${beforeConfirm.nextFollowUp || '<undefined>'}`);
    console.log(`LOCAL_AFTER_CONFIRM_NEXT_FOLLOWUP=${immediatelyAfterConfirm.nextFollowUp || '<undefined>'}`);
    console.log(`LOCAL_AFTER_CONFIRM_NEXT_ACTION=${immediatelyAfterConfirm.nextAction || '<undefined>'}`);
    console.log(`LOCAL_AFTER_CONFIRM_CONTACT_ACTIVITY_COUNT=${immediatelyAfterConfirm.contactActivityCount}`);
    console.log(`LOCAL_AFTER_CONFIRM_FOLLOWUP_ACTIVITY_COUNT=${immediatelyAfterConfirm.followUpActivityCount}`);
    console.log(`V2_AUTHORITY_CALLS=${cloud.v2AuthorityCalls()}`);

    console.log(`FIRST_HELD_POST_SEQUENCE=${first?.sequence || 0}`);
    console.log(`FIRST_HELD_POST_CLASSIFICATION=${first?.classification || 'OTHER'}`);
    console.log(`FIRST_HELD_POST_CONTAINS_CONTACT_ACTIVITY=${first && first.contactActivityCount > 0 ? 'YES' : 'NO'}`);
    console.log(`FIRST_HELD_POST_CONTAINS_FOLLOWUP_ACTIVITY=${first && first.followUpActivityCount > 0 ? 'YES' : 'NO'}`);
    console.log(`FIRST_HELD_POST_CLIENT_NEXT_FOLLOWUP=${first?.nextFollowUp || '<undefined>'}`);
    console.log(`FIRST_HELD_POST_CLIENT_NEXT_ACTION=${first?.nextAction || '<undefined>'}`);
    console.log(`FIRST_HELD_POST_BODY_SHA256=${first?.bodySha256 || '<none>'}`);
    console.log(`FIRST_HELD_BODY_CAPTURED_BEFORE_BLOCK=${cloud.firstHeldBodyCaptured() ? 'YES' : 'NO'}`);
    console.log(`FIRST_RELEASE_PENDING_AT_END_OF_CHECKPOINTS=${cloud.firstReleasePending() ? 'YES' : 'NO'}`);

    const provenContactA = first?.classification === 'CONTACT_ONLY'
      && first.contactActivityCount > 0
      && first.followUpActivityCount === 0
      && !first.nextFollowUp;
    console.log(`FIRST_POST_PROVEN_TO_BE_CONTACT_A=${provenContactA ? 'YES' : 'NO'}`);

    const priorClaim = provenContactA && beforeConfirm.followUpActivityCount === 0
      ? 'CONFIRMED'
      : first?.classification === 'CONTACT_PLUS_FOLLOWUP' || (first && first.followUpActivityCount > 0)
        ? 'RETRACTED'
        : 'UNRESOLVED';
    console.log(`A_STARTED_BEFORE_B_PREVIOUS_CLAIM=${priorClaim}`);

    console.log('DIAGNOSTIC_CHECKPOINTS_COMPLETE=YES');
  } finally {
    if (cloud.firstReleasePending()) {
      cloud.releaseFirstWrite();
      await Promise.resolve();
      console.log('DIAGNOSTIC_FIRST_RELEASE_AFTER_CHECKPOINTS=YES');
    }
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
