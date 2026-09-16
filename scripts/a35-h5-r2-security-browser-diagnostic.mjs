import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { initialData } from '../dist/models.js';
import { installA35H5R1ModernTenantHarness } from '../dist/tests/a35-h5-r1-modern-tenant-harness.js';

const ORG_ID = 'a35-h5-r2-security-org';
const OWNER_USER_ID = 'a35-h5-r2-owner';
const AGENT_USER_ID = 'a35-h5-r2-agent';

function fixture() {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'R2 Security Org', seatLimit: null, planLabel: 'R2' };
  crm.teamMembers = [
    { id: 1, userId: OWNER_USER_ID, name: 'Owner R2', email: 'owner-r2@example.test', role: 'Dueño', status: 'Activo', createdAt: '2026-09-01T12:00:00.000Z' },
    { id: 3, userId: AGENT_USER_ID, name: 'Agent R2', email: 'agent-r2@example.test', role: 'Corredor', status: 'Activo', createdAt: '2026-09-01T12:00:00.000Z' },
  ];
  crm.settings = { ...crm.settings, profileName: 'Owner R2', profileEmail: 'owner-r2@example.test', agencyName: 'R2 Security Org' };
  return crm;
}

function chromeExecutable() {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

async function waitForServer(url) {
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`${url}/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('R2 browser server unavailable');
}

async function startApp(port) {
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', LEAD_QUALIFICATION_AI_ENDPOINT: '', LEAD_QUALIFICATION_AI_KEY: '', LEAD_QUALIFICATION_AI_MODEL: '' },
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
    const legacyKey = `trv-crm-basico:user:${user}`;
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({ accessToken, refreshToken: `${accessToken}-refresh`, expiresAt: Date.now() + 3_600_000, userId: user, email: user.includes('owner') ? 'owner-r2@example.test' : 'agent-r2@example.test' }));
    localStorage.setItem(legacyKey, JSON.stringify(data));
    localStorage.setItem(`${legacyKey}:sync`, JSON.stringify({ dirty: false, localUpdatedAt: '2026-09-16T12:00:00.000Z', lastCloudSavedAt: '2026-09-16T12:00:00.000Z' }));
    localStorage.setItem('propcontrol-active-team-member-v1', String(member));
  }, { data: crm, user: userId, member: memberId, accessToken: token });
  return context;
}

test('R2 browser proves visual member is not authenticated actor', { timeout: 90_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const port = 51650 + Math.floor(Math.random() * 100);
  const url = `http://127.0.0.1:${port}`;
  const app = await startApp(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const ownerContext = await contextFor(browser, OWNER_USER_ID, 1, 'owner-access-r2');
    const teamRequests = [];
    await ownerContext.route('**/api/team/**', async (route) => {
      const request = route.request();
      teamRequests.push({ method: request.method(), authorization: request.headers().authorization || '' });
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'R2 intercepted' }) });
    });
    try {
      const page = await ownerContext.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
      const evidence = await page.evaluate(async () => {
        const store = await import('/dist/store.js');
        const access = await import('/dist/team-access.js');
        const tenant = await import('/dist/tenant-runtime.js');
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
      console.log('R2_SECURITY_OWNER_VISUAL_SWITCH=' + JSON.stringify(evidence));
      console.log('R2_SECURITY_OWNER_TEAM_REQUESTS=' + JSON.stringify(teamRequests));
      assert.equal(evidence.beforeActor.userId, OWNER_USER_ID);
      assert.equal(evidence.afterActor.userId, OWNER_USER_ID);
      assert.equal(evidence.afterActor.role, 'Dueño');
      assert.equal(evidence.afterVisual.id, 3);
      assert.equal(evidence.afterVisual.role, 'Corredor');
      assert.equal(evidence.canUseRecovery, true);
      assert.equal(evidence.canAdministerActor, true);
      assert.ok(teamRequests.length >= 1);
      assert.ok(teamRequests.every((entry) => entry.authorization === 'Bearer owner-access-r2'));
    } finally { await ownerContext.close(); }

    const agentContext = await contextFor(browser, AGENT_USER_ID, 3, 'agent-access-r2');
    try {
      const page = await agentContext.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
      const evidence = await page.evaluate(async () => {
        const store = await import('/dist/store.js');
        const access = await import('/dist/team-access.js');
        const tenant = await import('/dist/tenant-runtime.js');
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
      console.log('R2_SECURITY_REAL_AGENT_UI=' + JSON.stringify(evidence));
      assert.equal(evidence.actor.userId, AGENT_USER_ID);
      assert.equal(evidence.actor.role, 'Corredor');
      assert.equal(evidence.canUseRecovery, false);
      assert.equal(evidence.canAdministerActor, false);
      assert.equal(evidence.teamControls, 0);
      assert.equal(evidence.recoveryControls, 0);
      assert.equal(evidence.teamHtml, '');
    } finally { await agentContext.close(); }
  } finally {
    await browser.close();
    await stopChild(app);
  }
});
