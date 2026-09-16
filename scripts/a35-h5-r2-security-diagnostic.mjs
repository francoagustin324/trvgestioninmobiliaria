import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { initialData } from '../dist/models.js';
import { installA35H5R1ModernTenantHarness } from '../dist/tests/a35-h5-r1-modern-tenant-harness.js';

const ORG_ID = 'a35-h5-r2-security-org';
const OWNER_USER_ID = 'a35-h5-r2-owner';
const AGENT_USER_ID = 'a35-h5-r2-agent';

const owner = () => ({ id: 1, userId: OWNER_USER_ID, name: 'Owner R2', email: 'owner-r2@example.test', role: 'Dueño', status: 'Activo', createdAt: '2026-09-01T12:00:00.000Z' });
const agent = () => ({ id: 3, userId: AGENT_USER_ID, name: 'Agent R2', email: 'agent-r2@example.test', role: 'Corredor', status: 'Activo', createdAt: '2026-09-01T12:00:00.000Z' });

function fixture() {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'R2 Security Org', seatLimit: null, planLabel: 'R2' };
  crm.teamMembers = [owner(), agent()];
  crm.settings = { ...crm.settings, profileName: 'Owner R2', profileEmail: 'owner-r2@example.test', agencyName: 'R2 Security Org' };
  return crm;
}

function chromeExecutable() {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

async function waitForServer(url) {
  let last;
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`${url}/health`)).ok) return; } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`R2 server unavailable: ${String(last ?? '')}`);
}

async function startApp(port, env = {}) {
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
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(`http://127.0.0.1:${port}`);
  return child;
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); resolve(); }, 2_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function contextFor(browser, userId, memberId, token) {
  const crm = fixture();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR' });
  await installA35H5R1ModernTenantHarness(context, crm, userId);
  await context.addInitScript(({ data, user, member, accessToken }) => {
    const key = `trv-crm-basico:user:${user}`;
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken,
      refreshToken: `${accessToken}-refresh`,
      expiresAt: Date.now() + 3_600_000,
      userId: user,
      email: user.includes('owner') ? 'owner-r2@example.test' : 'agent-r2@example.test',
    }));
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(`${key}:sync`, JSON.stringify({ dirty: false, localUpdatedAt: '2026-09-16T12:00:00.000Z', lastCloudSavedAt: '2026-09-16T12:00:00.000Z' }));
    localStorage.setItem('propcontrol-active-team-member-v1', String(member));
  }, { data: crm, user: userId, member: memberId, accessToken: token });
  return context;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('R2 security: visual member never replaces authenticated actor', { timeout: 90_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const port = 51500 + Math.floor(Math.random() * 200);
  const url = `http://127.0.0.1:${port}`;
  const app = await startApp(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const ownerContext = await contextFor(browser, OWNER_USER_ID, 1, 'owner-access-r2');
    const teamRequests = [];
    await ownerContext.route('**/api/team/**', async (route) => {
      const request = route.request();
      teamRequests.push({ method: request.method(), authorization: request.headers().authorization || '', body: request.postData() });
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'R2 intercepted' }) });
    });
    try {
      const page = await ownerContext.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
      const state = await page.evaluate(async () => {
        const store = await (new Function("return import('/dist/store.js')"))();
        const access = await (new Function("return import('/dist/team-access.js')"))();
        const tenant = await (new Function("return import('/dist/tenant-runtime.js')"))();
        const beforeScope = tenant.currentTenantScope();
        const beforeActor = store.authenticatedTenantMember(beforeScope);
        const beforeVisual = access.activeMember();
        store.setActiveMemberId(3);
        document.dispatchEvent(new CustomEvent('trv-render'));
        await new Promise((resolve) => setTimeout(resolve, 80));
        const afterScope = tenant.currentTenantScope();
        const afterActor = store.authenticatedTenantMember(afterScope);
        const afterVisual = access.activeMember();
        return {
          beforeScope,
          beforeActor: beforeActor && { id: beforeActor.id, userId: beforeActor.userId, role: beforeActor.role },
          beforeVisual: { id: beforeVisual.id, userId: beforeVisual.userId, role: beforeVisual.role },
          afterScope,
          afterActor: afterActor && { id: afterActor.id, userId: afterActor.userId, role: afterActor.role },
          afterVisual: { id: afterVisual.id, userId: afterVisual.userId, role: afterVisual.role },
          canUseRecovery: access.canUseRecovery(),
          canAdministerActor: afterActor ? access.canAdministerTeam(afterActor) : false,
          teamControls: document.querySelectorAll('#mvp-user-form, [data-toggle-user-form]').length,
          recoveryControls: document.querySelectorAll('[data-settings-security-recovery], [data-account-restore]').length,
        };
      });
      const statusButton = page.locator('[data-user-status="3"]');
      assert.equal(await statusButton.count(), 1);
      await statusButton.click();
      await page.waitForTimeout(80);
      console.log('R2_SECURITY_OWNER_VISUAL_SWITCH=' + JSON.stringify(state));
      console.log('R2_SECURITY_OWNER_TEAM_REQUESTS=' + JSON.stringify(teamRequests));
      assert.equal(state.beforeActor.userId, OWNER_USER_ID);
      assert.equal(state.afterActor.userId, OWNER_USER_ID);
      assert.equal(state.afterActor.role, 'Dueño');
      assert.equal(state.afterVisual.id, 3);
      assert.equal(state.afterVisual.role, 'Corredor');
      assert.equal(state.canUseRecovery, true);
      assert.equal(state.canAdministerActor, true);
      assert.ok(teamRequests.length >= 1);
      assert.ok(teamRequests.every((entry) => entry.authorization === 'Bearer owner-access-r2'));
    } finally { await ownerContext.close(); }

    const agentContext = await contextFor(browser, AGENT_USER_ID, 3, 'agent-access-r2');
    try {
      const page = await agentContext.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
      const state = await page.evaluate(async () => {
        const store = await (new Function("return import('/dist/store.js')"))();
        const access = await (new Function("return import('/dist/team-access.js')"))();
        const tenant = await (new Function("return import('/dist/tenant-runtime.js')"))();
        const scope = tenant.currentTenantScope();
        const actor = store.authenticatedTenantMember(scope);
        return {
          scope,
          actor: actor && { id: actor.id, userId: actor.userId, role: actor.role },
          canUseRecovery: access.canUseRecovery(),
          canAdministerActor: actor ? access.canAdministerTeam(actor) : false,
          teamControls: document.querySelectorAll('#mvp-user-form, [data-toggle-user-form]').length,
          recoveryControls: document.querySelectorAll('[data-settings-security-recovery], [data-account-restore]').length,
          teamHtml: document.querySelector('#equipo')?.innerHTML.trim() || '',
        };
      });
      console.log('R2_SECURITY_REAL_AGENT_UI=' + JSON.stringify(state));
      assert.equal(state.actor.userId, AGENT_USER_ID);
      assert.equal(state.actor.role, 'Corredor');
      assert.equal(state.canUseRecovery, false);
      assert.equal(state.canAdministerActor, false);
      assert.equal(state.teamControls, 0);
      assert.equal(state.recoveryControls, 0);
      assert.equal(state.teamHtml, '');
    } finally { await agentContext.close(); }
  } finally {
    await browser.close();
    await stopChild(app);
  }
});

test('R2 security: server rejects agent ACTIVE before privileged target access', { timeout: 30_000 }, async () => {
  let targetLookupCount = 0;
  let targetPatchCount = 0;
  const fake = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    response.setHeader('content-type', 'application/json');
    if (url.pathname === '/auth/v1/user') {
      response.statusCode = 200;
      response.end(JSON.stringify({ id: AGENT_USER_ID, email: 'agent-r2@example.test' }));
      return;
    }
    if (url.pathname === '/rest/v1/organization_members' && url.searchParams.get('user_id') === `eq.${AGENT_USER_ID}`) {
      response.statusCode = 200;
      response.end(JSON.stringify([{ organization_id: ORG_ID, member_id: 3, user_id: AGENT_USER_ID, role: 'agent', status: 'active', display_name: 'Agent R2', email: 'agent-r2@example.test' }]));
      return;
    }
    if (url.pathname === '/rest/v1/organization_members' && url.searchParams.get('member_id')) {
      targetLookupCount += 1;
      response.statusCode = 200;
      response.end(JSON.stringify([]));
      return;
    }
    if (url.pathname === '/rest/v1/organization_members' && request.method === 'PATCH') {
      targetPatchCount += 1;
      response.statusCode = 200;
      response.end(JSON.stringify([]));
      return;
    }
    response.statusCode = 500;
    response.end(JSON.stringify({ error: `UNEXPECTED ${request.method} ${url.pathname}${url.search}` }));
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const fakeAddress = fake.address();
  assert.ok(fakeAddress && typeof fakeAddress === 'object');
  const appPort = 51800 + Math.floor(Math.random() * 100);
  const app = await startApp(appPort, {
    SUPABASE_URL: `http://127.0.0.1:${fakeAddress.port}`,
    SUPABASE_PUBLISHABLE_KEY: 'r2-publishable',
    SUPABASE_SECRET_KEY: 'sb_secret_r2',
  });
  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/team/members/1`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer agent-access-r2', 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: ORG_ID, status: 'suspended' }),
    });
    const body = await response.json();
    console.log('R2_SECURITY_SERVER_AGENT=' + JSON.stringify({ status: response.status, body, targetLookupCount, targetPatchCount }));
    assert.equal(response.status, 403);
    assert.match(String(body.error || ''), /permiso/i);
    assert.equal(targetLookupCount, 0);
    assert.equal(targetPatchCount, 0);
  } finally {
    await stopChild(app);
    await closeServer(fake);
  }
});
