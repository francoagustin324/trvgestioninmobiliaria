import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test, { after, before } from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'a35-downgrade-user';
const ORG_ID = 'a35-downgrade-org';
const USER_MEMBER_ID = 35;
const OTHER_MEMBER_ID = 36;
const OTHER_USER_ID = 'a35-current-owner';
const TEAM_VIEW_KEY = 'propcontrol-active-team-member-v1';
const SESSION_KEY = 'propcontrol-cloud-session-v1';
const GENERATION_KEY = 'propcontrol-cloud-auth-generation-v1';
const TENANT_KEY = `trv-crm-basico:user:${USER_ID}:org:${ORG_ID}`;
const TENANT_SYNC_KEY = `${TENANT_KEY}:sync`;
const CLOUD_ALLOWED = 'A35_CLOUD_ALLOWED_AGENT_LEAD';
const STALE_OWNER = 'A35_STALE_OWNER_LOCAL_DATA';
const STALE_SENTINEL = 'A35_STALE_OTHER_AGENT_SENTINEL';
const SAME_ROLE_DIRTY = 'A35_SAME_ROLE_DIRTY_LOCAL_DATA';
const EXPECTED_STALE_CODE = 'TENANT_LOCAL_AUTHORIZATION_STALE';

interface SyntheticFailure {
  status: number;
  body: Record<string, unknown>;
}

interface CloudTelemetry {
  catalogMembershipQueries: number;
  directoryMembershipQueries: number;
  recordsGets: number;
  recordsPosts: number;
  recordsDeletes: number;
  visitAuthorityChecks: number;
  unexpectedEndpoints: string[];
}

interface RuntimeSnapshot {
  crmActive: boolean;
  bootstrapError: string;
  authUser: string;
  authOrg: string;
  activeMemberId: number;
  activeMemberUserId: string;
  activeMemberRole: string;
  currentUserTeamRole: string;
  canViewAll: boolean;
  canAccessSettings: boolean;
  canAdministerTeam: boolean;
  teamAdminUiVisible: boolean;
  bodyHasStaleOwner: boolean;
  bodyHasSentinel: boolean;
  bodyHasSameRoleDirty: boolean;
  stateHasStaleOwner: boolean;
  stateHasSentinel: boolean;
  stateHasSameRoleDirty: boolean;
  clientNames: string[];
}

interface StoredSnapshot {
  raw: CrmData | null;
  dirty: boolean;
  lastError: string;
}

let server: ChildProcess | null = null;
let browser: Browser | null = null;
let origin = '';

function currentAgentMembership() {
  return {
    organization_id: ORG_ID,
    member_id: USER_MEMBER_ID,
    user_id: USER_ID,
    role: 'agent',
    status: 'active',
    display_name: 'A3.5 Current Agent',
    email: 'a35-agent@propcontrol.test',
    created_at: '2026-09-14T00:00:00.000Z',
    last_active_at: '2026-09-14T00:00:00.000Z',
  };
}

function currentOwnerMembership() {
  return {
    organization_id: ORG_ID,
    member_id: OTHER_MEMBER_ID,
    user_id: OTHER_USER_ID,
    role: 'owner',
    status: 'active',
    display_name: 'A3.5 Current Owner',
    email: 'a35-owner@propcontrol.test',
    created_at: '2026-09-14T00:00:00.000Z',
    last_active_at: '2026-09-14T00:00:00.000Z',
  };
}

function member(
  id: number,
  userId: string | undefined,
  role: TeamMember['role'],
  name: string,
): TeamMember {
  return {
    id,
    userId,
    name,
    email: `${userId || `member-${id}`}@propcontrol.test`,
    role,
    status: 'Activo',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function baseSnapshot(members: TeamMember[]): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: ORG_ID,
    name: 'A3.5 Characterization Realty',
    seatLimit: null,
    planLabel: 'Validation only',
  };
  crm.teamMembers = members;
  crm.activityLog = [];
  crm.properties = [];
  crm.visits = [];
  crm.offers = [];
  crm.reservations = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  return crm;
}

function staleOwnerSnapshot(): CrmData {
  const crm = baseSnapshot([
    member(USER_MEMBER_ID, USER_ID, 'Dueño', 'Historical Owner'),
    member(OTHER_MEMBER_ID, OTHER_USER_ID, 'Corredor', 'Historical Other Agent'),
  ]);
  crm.clients = [
    {
      id: 3501,
      name: STALE_OWNER,
      phone: '3515553501',
      interest: 'Historical same-user owner-local data',
      status: 'Lead',
      temperature: 'Tibio',
      pipeline: 'Nuevo',
      assignedToId: USER_MEMBER_ID,
      createdById: USER_MEMBER_ID,
    },
    {
      id: 3502,
      name: STALE_SENTINEL,
      phone: '3515553502',
      interest: 'Historical other-member sentinel',
      status: 'Lead',
      temperature: 'Caliente',
      pipeline: 'Contactado',
      assignedToId: OTHER_MEMBER_ID,
      createdById: OTHER_MEMBER_ID,
    },
  ];
  return crm;
}

function compatibleAgentSnapshot(): CrmData {
  const crm = baseSnapshot([
    member(USER_MEMBER_ID, USER_ID, 'Corredor', 'Current Agent Local'),
    member(OTHER_MEMBER_ID, OTHER_USER_ID, 'Dueño', 'Current Owner Local'),
  ]);
  crm.clients = [{
    id: 3510,
    name: SAME_ROLE_DIRTY,
    phone: '3515553510',
    interest: 'Legitimate same-role dirty local data',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    assignedToId: USER_MEMBER_ID,
    createdById: USER_MEMBER_ID,
  }];
  return crm;
}

function missingLocalMemberSnapshot(): CrmData {
  const crm = baseSnapshot([
    member(OTHER_MEMBER_ID, OTHER_USER_ID, 'Dueño', 'Only Other Owner'),
  ]);
  crm.clients = [{
    id: 3520,
    name: 'A35_MISSING_MEMBER_DIRTY',
    phone: '3515553520',
    interest: 'Missing authenticated local member',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    assignedToId: OTHER_MEMBER_ID,
    createdById: OTHER_MEMBER_ID,
  }];
  return crm;
}

function mismatchedMemberIdSnapshot(): CrmData {
  const crm = baseSnapshot([
    member(999, USER_ID, 'Corredor', 'Wrong Local Member Id'),
    member(OTHER_MEMBER_ID, OTHER_USER_ID, 'Dueño', 'Current Owner Local'),
  ]);
  crm.clients = [{
    id: 3530,
    name: 'A35_MEMBER_ID_MISMATCH_DIRTY',
    phone: '3515553530',
    interest: 'Member id mismatch',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    assignedToId: 999,
    createdById: 999,
  }];
  return crm;
}

function mismatchedRoleSnapshot(): CrmData {
  return staleOwnerSnapshot();
}

function allowedCloudRows() {
  return [{
    organization_id: ORG_ID,
    entity_type: 'client',
    entity_key: `${ORG_ID}:3500`,
    assigned_member_id: USER_MEMBER_ID,
    payload: {
      id: 3500,
      name: CLOUD_ALLOWED,
      phone: '3515553500',
      interest: 'Current cloud-authorized lead',
      status: 'Lead',
      temperature: 'Tibio',
      pipeline: 'Nuevo',
      assignedToId: USER_MEMBER_ID,
      createdById: USER_MEMBER_ID,
    },
    created_by: USER_ID,
    updated_at: '2026-09-14T00:05:00.000Z',
  }];
}

function syntheticJson(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
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
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('A3.5 validation server unavailable.');
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
  await waitForServer(`http://127.0.0.1:${port}`);
  return child;
}

async function stopServer(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 2_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function installSyntheticCloud(
  context: BrowserContext,
  options: { pushFailure?: SyntheticFailure; cloudRows?: ReturnType<typeof allowedCloudRows> } = {},
): Promise<CloudTelemetry> {
  const telemetry: CloudTelemetry = {
    catalogMembershipQueries: 0,
    directoryMembershipQueries: 0,
    recordsGets: 0,
    recordsPosts: 0,
    recordsDeletes: 0,
    visitAuthorityChecks: 0,
    unexpectedEndpoints: [],
  };
  let rows = structuredClone(options.cloudRows ?? allowedCloudRows());

  await context.route('**/api/cloud-config', async (route) => {
    await route.fulfill(syntheticJson({ configured: true, url: origin, publishableKey: 'a35-publishable-key' }));
  });

  await context.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        },
        body: '',
      });
      return;
    }

    if (url.pathname.endsWith('/rest/v1/rpc/activate_my_organization_memberships')) {
      await route.fulfill(syntheticJson({}));
      return;
    }

    if (url.pathname.endsWith('/rest/v1/organization_members')) {
      const userFilter = url.searchParams.get('user_id');
      const organizationFilter = url.searchParams.get('organization_id');
      if (userFilter === `eq.${USER_ID}`) {
        telemetry.catalogMembershipQueries += 1;
        await route.fulfill(syntheticJson([currentAgentMembership()]));
        return;
      }
      if (organizationFilter === `eq.${ORG_ID}`) {
        telemetry.directoryMembershipQueries += 1;
        await route.fulfill(syntheticJson([currentAgentMembership(), currentOwnerMembership()]));
        return;
      }
      telemetry.unexpectedEndpoints.push(`${request.method()} ${url.pathname}${url.search}`);
      await route.fulfill(syntheticJson({ message: 'unexpected membership query' }, 500));
      return;
    }

    if (url.pathname.endsWith('/rest/v1/rpc/visit_transaction_authority_active_v2')) {
      telemetry.visitAuthorityChecks += 1;
      await route.fulfill(syntheticJson(false));
      return;
    }

    if (url.pathname.endsWith('/rest/v1/propcontrol_records')) {
      if (request.method() === 'GET') {
        telemetry.recordsGets += 1;
        await route.fulfill(syntheticJson(rows));
        return;
      }
      if (request.method() === 'POST') {
        telemetry.recordsPosts += 1;
        if (options.pushFailure) {
          await route.fulfill(syntheticJson(options.pushFailure.body, options.pushFailure.status));
          return;
        }
        const body = request.postDataJSON();
        rows = Array.isArray(body) ? structuredClone(body) : [structuredClone(body)];
        await route.fulfill(syntheticJson([], 201));
        return;
      }
      if (request.method() === 'DELETE') {
        telemetry.recordsDeletes += 1;
        await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
        return;
      }
    }

    if (url.pathname.endsWith('/rest/v1/fichas')) {
      await route.fulfill(syntheticJson([]));
      return;
    }

    telemetry.unexpectedEndpoints.push(`${request.method()} ${url.pathname}${url.search}`);
    await route.fulfill(syntheticJson({ message: 'unexpected synthetic endpoint' }, 500));
  });

  return telemetry;
}

async function seedContext(
  context: BrowserContext,
  crm: CrmData,
  options: { dirty: boolean; generation: string; teamView?: number },
): Promise<void> {
  await context.addInitScript(({ storedCrm, dirty, generation, teamView }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'a35-access-token',
      refreshToken: 'a35-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      userId: 'a35-downgrade-user',
      email: 'a35-agent@propcontrol.test',
      __propcontrolAuthGeneration: generation,
    }));
    localStorage.setItem('propcontrol-cloud-auth-generation-v1', generation);
    localStorage.setItem('trv-crm-basico:user:a35-downgrade-user:org:a35-downgrade-org', JSON.stringify(storedCrm));
    localStorage.setItem('trv-crm-basico:user:a35-downgrade-user:org:a35-downgrade-org:sync', JSON.stringify({
      dirty,
      localUpdatedAt: '2026-09-14T00:01:00.000Z',
      lastCloudSavedAt: '',
      lastCloudVersion: '',
      localGeneration: dirty ? 1 : 0,
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', String(teamView));
  }, {
    storedCrm: crm,
    dirty: options.dirty,
    generation: options.generation,
    teamView: options.teamView ?? USER_MEMBER_ID,
  });
}

async function loadApp(page: Page): Promise<void> {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    Boolean(document.querySelector('#crm.active'))
    || Boolean(document.querySelector('[data-bootstrap-error]'))
  ), undefined, { timeout: 20_000 });
}

async function runtimeSnapshot(page: Page): Promise<RuntimeSnapshot> {
  return page.evaluate(async ({ sessionKey, staleOwner, sentinel, sameRoleDirty }) => {
    const storeModule = '/dist/store.js';
    const { state } = await import(storeModule);
    const accessModule = '/dist/team-access.js';
    const access = await import(accessModule);
    const session = JSON.parse(localStorage.getItem(sessionKey) || '{}');
    const active = state.crm.teamMembers.find((item: { id: number }) => item.id === state.activeMemberId) || null;
    const current = state.crm.teamMembers.find((item: { userId?: string }) => item.userId === session.userId) || null;
    const body = document.body.textContent || '';
    return {
      crmActive: Boolean(document.querySelector('#crm.active')),
      bootstrapError: document.querySelector('[data-bootstrap-error]')?.textContent?.trim() || '',
      authUser: String(session.userId || ''),
      authOrg: String(state.crm.organization.id || ''),
      activeMemberId: state.activeMemberId,
      activeMemberUserId: active?.userId || '',
      activeMemberRole: active?.role || '',
      currentUserTeamRole: current?.role || '',
      canViewAll: access.canViewAll(),
      canAccessSettings: access.canAccessSettings(),
      canAdministerTeam: access.canAdministerTeam(),
      teamAdminUiVisible: Boolean(document.querySelector('#equipo [data-toggle-user-form], #equipo #mvp-user-form, #equipo [data-user-status], #equipo [data-user-role]:not([disabled])')),
      bodyHasStaleOwner: body.includes(staleOwner),
      bodyHasSentinel: body.includes(sentinel),
      bodyHasSameRoleDirty: body.includes(sameRoleDirty),
      stateHasStaleOwner: state.crm.clients.some((client: { name: string }) => client.name === staleOwner),
      stateHasSentinel: state.crm.clients.some((client: { name: string }) => client.name === sentinel),
      stateHasSameRoleDirty: state.crm.clients.some((client: { name: string }) => client.name === sameRoleDirty),
      clientNames: state.crm.clients.map((client: { name: string }) => client.name),
    };
  }, {
    sessionKey: SESSION_KEY,
    staleOwner: STALE_OWNER,
    sentinel: STALE_SENTINEL,
    sameRoleDirty: SAME_ROLE_DIRTY,
  });
}

async function storedSnapshot(page: Page): Promise<StoredSnapshot> {
  return page.evaluate(({ tenantKey, syncKey }) => {
    const rawValue = localStorage.getItem(tenantKey);
    const sync = JSON.parse(localStorage.getItem(syncKey) || '{}');
    return {
      raw: rawValue ? JSON.parse(rawValue) : null,
      dirty: sync.dirty === true,
      lastError: String(sync.lastError || ''),
    };
  }, { tenantKey: TENANT_KEY, syncKey: TENANT_SYNC_KEY });
}

function printSnapshot(label: string, snap: RuntimeSnapshot, stored?: StoredSnapshot): void {
  console.log(`${label}_CRM_ACTIVE=${snap.crmActive ? 'YES' : 'NO'}`);
  console.log(`${label}_AUTH_USER=${snap.authUser}`);
  console.log(`${label}_AUTH_ORG=${snap.authOrg}`);
  console.log(`${label}_ACTIVE_MEMBER_ID=${snap.activeMemberId}`);
  console.log(`${label}_ACTIVE_MEMBER_USER_ID=${snap.activeMemberUserId}`);
  console.log(`${label}_ACTIVE_MEMBER_ROLE=${snap.activeMemberRole}`);
  console.log(`${label}_CURRENT_USER_TEAM_ROLE=${snap.currentUserTeamRole}`);
  console.log(`${label}_CAN_VIEW_ALL=${snap.canViewAll ? 'YES' : 'NO'}`);
  console.log(`${label}_CAN_ACCESS_SETTINGS=${snap.canAccessSettings ? 'YES' : 'NO'}`);
  console.log(`${label}_CAN_ADMINISTER_TEAM_LOCAL=${snap.canAdministerTeam ? 'YES' : 'NO'}`);
  console.log(`${label}_STALE_OTHER_AGENT_SENTINEL_VISIBLE=${snap.bodyHasSentinel ? 'YES' : 'NO'}`);
  console.log(`${label}_STALE_OWNER_LOCAL_DATA_VISIBLE=${snap.bodyHasStaleOwner ? 'YES' : 'NO'}`);
  console.log(`${label}_BOOTSTRAP_ERROR=${snap.bootstrapError || 'NO'}`);
  console.log(`${label}_CLIENT_NAMES=${JSON.stringify(snap.clientNames)}`);
  if (stored) {
    console.log(`${label}_DIRTY_LOCAL_CHANGES_PRESERVED=${stored.dirty ? 'YES' : 'NO'}`);
    console.log(`${label}_SYNC_ERROR=${stored.lastError || 'NO'}`);
  }
}

async function newContextWithCloud(
  crm: CrmData,
  options: {
    dirty: boolean;
    generation: string;
    teamView?: number;
    pushFailure?: SyntheticFailure;
    cloudRows?: ReturnType<typeof allowedCloudRows>;
  },
): Promise<{ context: BrowserContext; page: Page; telemetry: CloudTelemetry }> {
  assert.ok(browser);
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const telemetry = await installSyntheticCloud(context, {
    pushFailure: options.pushFailure,
    cloudRows: options.cloudRows,
  });
  await seedContext(context, crm, options);
  const page = await context.newPage();
  return { context, page, telemetry };
}

before(async () => {
  const port = 45100 + Math.floor(Math.random() * 500);
  origin = `http://127.0.0.1:${port}`;
  server = await startServer(port);
  browser = await chromium.launch({
    headless: true,
    ...(chromeExecutable() ? { executablePath: chromeExecutable() } : {}),
  });
});

after(async () => {
  if (browser) await browser.close();
  await stopServer(server);
});

test('A3.5 A: normal role downgrade with successful cloud hydration stays safe', async () => {
  const control = await newContextWithCloud(staleOwnerSnapshot(), {
    dirty: false,
    generation: 'a35-control-a',
  });
  try {
    await loadApp(control.page);
    const snap = await runtimeSnapshot(control.page);
    printSnapshot('CONTROL_A', snap);
    assert.equal(snap.crmActive, true);
    assert.equal(snap.authUser, USER_ID);
    assert.equal(snap.authOrg, ORG_ID);
    assert.equal(snap.activeMemberUserId, USER_ID);
    assert.equal(snap.activeMemberRole, 'Corredor');
    assert.equal(snap.currentUserTeamRole, 'Corredor');
    assert.equal(snap.canViewAll, false);
    assert.equal(snap.canAccessSettings, false);
    assert.equal(snap.canAdministerTeam, false);
    assert.equal(snap.bodyHasSentinel, false);
    assert.equal(snap.bodyHasStaleOwner, false);
    assert.equal(snap.bootstrapError, '');
    assert.ok(control.telemetry.directoryMembershipQueries > 0);
    assert.ok(control.telemetry.recordsGets > 0);
    assert.equal(control.telemetry.unexpectedEndpoints.length, 0);
    console.log('CONTROL_A_NORMAL_DOWNGRADE=PASS_SAFE');
  } finally {
    await control.context.close();
  }
});

test('A3.5 B: TEAM_VIEW_KEY tamper cannot survive a successful manual sync', async () => {
  const control = await newContextWithCloud(staleOwnerSnapshot(), {
    dirty: false,
    generation: 'a35-control-b',
  });
  try {
    await loadApp(control.page);
    const before = await runtimeSnapshot(control.page);
    assert.equal(before.activeMemberId, USER_MEMBER_ID);
    assert.equal(before.activeMemberRole, 'Corredor');

    await control.page.evaluate(({ key, value }) => localStorage.setItem(key, String(value)), {
      key: TEAM_VIEW_KEY,
      value: OTHER_MEMBER_ID,
    });

    await control.page.locator('[data-edit-client="3500"]').first().click();
    await control.page.locator('#mvp-lead-form input[name="name"]').fill(`${CLOUD_ALLOWED} EDITED`);
    await control.page.locator('#mvp-lead-form button[type="submit"]').click();
    await control.page.waitForFunction(({ syncKey }) => {
      const sync = JSON.parse(localStorage.getItem(syncKey) || '{}');
      return sync.dirty === true;
    }, { syncKey: TENANT_SYNC_KEY }, { timeout: 5_000 });

    await control.page.locator('[data-account-toggle]').click();
    await control.page.locator('[data-account-sync]').waitFor({ state: 'visible', timeout: 5_000 });
    await control.page.locator('[data-account-sync]').click();
    await control.page.waitForFunction(async ({ syncKey }) => {
      const sync = JSON.parse(localStorage.getItem(syncKey) || '{}');
      return sync.dirty === false;
    }, { syncKey: TENANT_SYNC_KEY }, { timeout: 10_000 });
    await control.page.waitForTimeout(150);

    const after = await runtimeSnapshot(control.page);
    printSnapshot('CONTROL_B', after);
    assert.equal(after.activeMemberUserId, USER_ID);
    assert.equal(after.activeMemberId, USER_MEMBER_ID);
    assert.equal(after.activeMemberRole, 'Corredor');
    assert.equal(after.currentUserTeamRole, 'Corredor');
    assert.equal(after.canViewAll, false);
    assert.equal(after.canAccessSettings, false);
    assert.equal(after.canAdministerTeam, false);
    assert.equal(after.bodyHasSentinel, false);
    assert.equal(after.teamAdminUiVisible, false);
    console.log('IDENTITY_SPOOF_AFTER_SYNC=NO');
    console.log('CONTROL_B_TEAM_VIEW_TAMPER_SYNC=PASS_SAFE');
  } finally {
    await control.context.close();
  }
});

async function assertDowngradeFailureClosed(label: 'CONTROL_C1' | 'CONTROL_C2', pushFailure: SyntheticFailure): Promise<void> {
  const control = await newContextWithCloud(staleOwnerSnapshot(), {
    dirty: true,
    generation: `a35-${label.toLowerCase()}`,
    pushFailure,
    cloudRows: [],
  });
  try {
    await loadApp(control.page);
    const snap = await runtimeSnapshot(control.page);
    const stored = await storedSnapshot(control.page);
    printSnapshot(label, snap, stored);
    console.log(`${label}_CURRENT_CLOUD_ROLE=Corredor`);
    console.log(`${label}_LOCAL_HISTORICAL_ROLE=Dueño`);
    console.log(`${label}_PUSH_FAILURE_STATUS=${pushFailure.status}`);
    console.log(`${label}_PUSH_FAILURE_BODY=${JSON.stringify(pushFailure.body)}`);
    console.log(`${label}_AUTHORITY_DIRECTORY_QUERIES=${control.telemetry.directoryMembershipQueries}`);
    console.log(`${label}_RECORDS_POSTS=${control.telemetry.recordsPosts}`);

    assert.ok(control.telemetry.directoryMembershipQueries > 0, `${label}: current cloud membership authority must be proven`);
    assert.ok(control.telemetry.recordsGets > 0, `${label}: cloud read preceding push must execute`);
    assert.ok(control.telemetry.recordsPosts > 0, `${label}: controlled push failure must execute`);
    assert.equal(control.telemetry.unexpectedEndpoints.length, 0);
    assert.equal(snap.crmActive, false, `${label}: stale authorization must not complete CRM bootstrap`);
    assert.match(snap.bootstrapError, new RegExp(EXPECTED_STALE_CODE));
    assert.equal(snap.bodyHasSentinel, false);
    assert.equal(snap.bodyHasStaleOwner, false);
    assert.equal(snap.crmActive && (snap.canViewAll || snap.canAccessSettings || snap.canAdministerTeam), false);
    assert.equal(stored.dirty, true);
    assert.ok(stored.raw?.clients.some((client) => client.name === STALE_SENTINEL));
    assert.ok(stored.raw?.clients.some((client) => client.name === STALE_OWNER));
    const storedCurrent = stored.raw?.teamMembers.find((item) => item.userId === USER_ID);
    assert.equal(storedCurrent?.role, 'Dueño');
    assert.ok(stored.lastError.length > 0);
  } finally {
    await control.context.close();
  }
}

test('A3.5 C1: downgraded agent + dirty historical Owner snapshot + transient 503 fails closed', async () => {
  await assertDowngradeFailureClosed('CONTROL_C1', {
    status: 503,
    body: {
      message: 'synthetic transient upstream failure after current authority proof',
      code: 'SYNTHETIC_503',
    },
  });
  console.log('CONTROL_C1_TRANSIENT_FAILURE=PASS_SAFE');
});

test('A3.5 C2: downgraded agent + dirty historical Owner snapshot + realistic 403 RLS denial fails closed', async () => {
  await assertDowngradeFailureClosed('CONTROL_C2', {
    status: 403,
    body: {
      code: '42501',
      message: 'new row violates row-level security policy for table "propcontrol_records"',
      details: null,
      hint: null,
    },
  });
  console.log('CONTROL_C2_PERMISSION_FAILURE=PASS_SAFE');
});

test('A3.5 D: same authority + dirty local + transient 503 preserves legitimate offline fallback', async () => {
  const control = await newContextWithCloud(compatibleAgentSnapshot(), {
    dirty: true,
    generation: 'a35-control-d',
    pushFailure: {
      status: 503,
      body: { message: 'synthetic transient failure for legitimate offline fallback', code: 'SYNTHETIC_503' },
    },
    cloudRows: [],
  });
  try {
    await loadApp(control.page);
    const snap = await runtimeSnapshot(control.page);
    const stored = await storedSnapshot(control.page);
    printSnapshot('CONTROL_D', snap, stored);
    assert.equal(snap.crmActive, true);
    assert.equal(snap.bootstrapError, '');
    assert.equal(snap.activeMemberUserId, USER_ID);
    assert.equal(snap.activeMemberId, USER_MEMBER_ID);
    assert.equal(snap.activeMemberRole, 'Corredor');
    assert.equal(snap.currentUserTeamRole, 'Corredor');
    assert.equal(snap.canViewAll, false);
    assert.equal(snap.canAccessSettings, false);
    assert.equal(snap.canAdministerTeam, false);
    assert.equal(snap.bodyHasSameRoleDirty || snap.stateHasSameRoleDirty, true);
    assert.equal(snap.bodyHasSentinel || snap.stateHasSentinel, false);
    assert.equal(stored.dirty, true);
    assert.ok(stored.raw?.clients.some((client) => client.name === SAME_ROLE_DIRTY));
    console.log('LOCAL_OWN_DIRTY_DATA_PRESERVED=YES');
    console.log('CONTROL_D_SAME_AUTHORITY_OFFLINE_FALLBACK=PASS_SAFE');
  } finally {
    await control.context.close();
  }
});

test('A3.5 E: missing or mismatched local authenticated member always fails closed without destructive storage loss', async () => {
  const cases = [
    ['MISSING', missingLocalMemberSnapshot()],
    ['MEMBER_ID_MISMATCH', mismatchedMemberIdSnapshot()],
    ['ROLE_MISMATCH', mismatchedRoleSnapshot()],
  ] as const;

  for (const [name, crm] of cases) {
    const control = await newContextWithCloud(crm, {
      dirty: true,
      generation: `a35-control-e-${name.toLowerCase()}`,
      pushFailure: {
        status: 503,
        body: { message: `synthetic transient failure for ${name}`, code: 'SYNTHETIC_503' },
      },
      cloudRows: [],
    });
    try {
      await loadApp(control.page);
      const snap = await runtimeSnapshot(control.page);
      const stored = await storedSnapshot(control.page);
      printSnapshot(`CONTROL_E_${name}`, snap, stored);
      assert.equal(snap.crmActive, false, `${name}: incompatible local authority must fail closed`);
      assert.match(snap.bootstrapError, new RegExp(EXPECTED_STALE_CODE));
      assert.equal(stored.dirty, true, `${name}: dirty flag must survive`);
      assert.deepEqual(stored.raw, crm, `${name}: local CRM snapshot must remain byte-semantically intact`);
      console.log(`CONTROL_E_${name}=PASS_SAFE`);
    } finally {
      await control.context.close();
    }
  }

  console.log('CONTROL_E=PASS_SAFE');
});
