import './sec-fix-a1-2-c2-test-setup.js';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test, { afterEach } from 'node:test';
import { chromium } from 'playwright';
import { initialData } from '../models.js';
import type { CrmData, TeamMember, TeamRole } from '../models.js';
import type { TenantScope } from '../active-organization.js';
import { setActiveMemberId, state } from '../store.js';
import {
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
} from '../tenant-runtime.js';
import {
  configureCurrentWhatsAppHumanIdentity,
  type WhatsAppHumanIdentitySnapshot,
} from '../whatsapp-human-identity.js';
import {
  CONTACT_ATTEMPT_TTL_MS,
  createPendingWhatsAppAttempt,
  loadPendingWhatsAppAttemptResult,
  savePendingWhatsAppAttempt,
  type PendingWhatsAppAttempt,
} from '../whatsapp-contact.js';

const AUTH_USER = 'a32-whatsapp-shared-user';
const TEAM_VIEW_KEY = 'propcontrol-active-team-member-v1';
const ATTEMPT_PREFIX = 'propcontrol-whatsapp-contact-attempt-v1';

function member(id: number, role: TeamRole, userId: string, name: string): TeamMember {
  return {
    id,
    userId,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`,
    role,
    status: 'Activo',
    createdAt: '2026-09-11T12:00:00.000Z',
  };
}

function crmFor(scope: TenantScope, authenticated: TeamMember, visual: TeamMember): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: scope.organizationId, name: `Org ${scope.organizationId}`, seatLimit: 10, planLabel: 'Test' };
  crm.settings.agencyName = `Agencia ${scope.organizationId}`;
  crm.teamMembers = [authenticated, visual];
  crm.activityLog = [];
  crm.clients = [{
    id: 77,
    name: `Lead ${scope.organizationId}`,
    phone: '3515550000',
    interest: 'Compra',
    status: 'Activo',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    assignedToId: authenticated.id,
    createdById: authenticated.id,
  }];
  crm.properties = [];
  crm.visits = [];
  crm.offers = [];
  crm.reservations = [];
  crm.reminders = [];
  crm.contacts = [];
  crm.conversations = [];
  return crm;
}

function installReady(
  organizationId: string,
  authenticatedId: number,
  visualId: number,
): { scope: TenantScope; authenticated: TeamMember; visual: TeamMember; crm: CrmData } {
  const scope = Object.freeze({ userId: AUTH_USER, organizationId });
  const authenticated = member(authenticatedId, 'Corredor', AUTH_USER, `Auth ${organizationId}`);
  const visual = member(visualId, 'Dueño', `visual-${organizationId}`, `Visual ${organizationId}`);
  installTenantRuntimeScope(scope, AUTH_USER);
  const crm = crmFor(scope, authenticated, visual);
  state.crm = crm;
  state.activeMemberId = authenticated.id;
  setActiveMemberId(visual.id);
  return { scope, authenticated, visual, crm };
}

function attemptKey(organizationId: string, actorId: number): string {
  return `${ATTEMPT_PREFIX}:${organizationId}:${actorId}`;
}

function configureIdentity(now: Date): WhatsAppHumanIdentitySnapshot {
  const configured = configureCurrentWhatsAppHumanIdentity({
    humanName: 'Franco Solis',
    confirmed: true,
    now,
  });
  assert.equal(configured.valid, true);
  assert.ok(configured.identity);
  return configured.identity;
}

function newAttempt(identity: WhatsAppHumanIdentitySnapshot, now: Date): PendingWhatsAppAttempt {
  return createPendingWhatsAppAttempt(
    state.crm.clients[0]!,
    '5493515550000',
    `Mensaje ${state.crm.organization.id}`,
    identity,
    now,
  );
}

afterEach(() => {
  invalidateTenantRuntimeScope();
  localStorage.clear();
});

test('A3.2 WhatsApp bootstrap unresolved es neutral y luego recupera el pending attempt del tenant autenticado exacto', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');
  const a = installReady('org-wa-bootstrap-A', 1101, 1102);
  const identityA = configureIdentity(now);
  const attemptA = newAttempt(identityA, now);
  savePendingWhatsAppAttempt(attemptA);
  const keyA = attemptKey(a.scope.organizationId, a.authenticated.id);
  const rawA = localStorage.getItem(keyA);
  assert.ok(rawA);

  const b = installReady('org-wa-bootstrap-B', 1201, 1202);
  const identityB = configureIdentity(now);
  const attemptB = newAttempt(identityB, now);
  savePendingWhatsAppAttempt(attemptB);
  const keyB = attemptKey(b.scope.organizationId, b.authenticated.id);
  const rawB = localStorage.getItem(keyB);
  assert.ok(rawB);

  const visualDecoyKey = attemptKey(a.scope.organizationId, a.visual.id);
  localStorage.setItem(visualDecoyKey, 'visual-decoy-must-not-be-read-or-deleted');

  invalidateTenantRuntimeScope();
  const noScope = loadPendingWhatsAppAttemptResult(now);
  assert.deepEqual(noScope, { attempt: null, invalidated: false, reason: '' });
  assert.equal(localStorage.getItem(keyA), rawA);
  assert.equal(localStorage.getItem(keyB), rawB);
  assert.equal(localStorage.getItem(visualDecoyKey), 'visual-decoy-must-not-be-read-or-deleted');

  installTenantRuntimeScope(a.scope, AUTH_USER);
  const scopeButMemberNotReady = loadPendingWhatsAppAttemptResult(now);
  assert.deepEqual(scopeButMemberNotReady, { attempt: null, invalidated: false, reason: '' });
  assert.equal(localStorage.getItem(keyA), rawA);
  assert.equal(localStorage.getItem(keyB), rawB);

  state.crm = a.crm;
  state.activeMemberId = a.authenticated.id;
  setActiveMemberId(a.visual.id);
  assert.equal(state.activeMemberId, a.visual.id);
  assert.equal(localStorage.getItem(TEAM_VIEW_KEY), String(a.visual.id));

  const readyA = loadPendingWhatsAppAttemptResult(now);
  assert.equal(readyA.invalidated, false);
  assert.equal(readyA.attempt?.id, attemptA.id);
  assert.equal(readyA.attempt?.actorId, a.authenticated.id);
  assert.equal(localStorage.getItem(keyA), rawA);
  assert.equal(localStorage.getItem(keyB), rawB, 'Elegir Org A no debe tocar el pending attempt de Org B.');
  assert.equal(localStorage.getItem(visualDecoyKey), 'visual-decoy-must-not-be-read-or-deleted');
});

function assertOneShotInvalidation(now: Date, key: string): void {
  const first = loadPendingWhatsAppAttemptResult(now);
  assert.equal(first.invalidated, true);
  assert.equal(first.attempt, null);
  assert.equal(localStorage.getItem(key), null, 'La primera invalidación debe eliminar únicamente el storage exacto.');

  const second = loadPendingWhatsAppAttemptResult(now);
  assert.deepEqual(second, { attempt: null, invalidated: false, reason: '' });
}

test('A3.2 WhatsApp invalidación real es one-shot para expired, malformed, identity mismatch y already recorded', () => {
  const base = new Date('2026-09-11T12:00:00.000Z');

  const expired = installReady('org-wa-expired', 2101, 2102);
  const expiredIdentity = configureIdentity(base);
  const expiredAttempt = newAttempt(expiredIdentity, base);
  savePendingWhatsAppAttempt(expiredAttempt);
  const expiredKey = attemptKey(expired.scope.organizationId, expired.authenticated.id);
  assertOneShotInvalidation(new Date(base.getTime() + CONTACT_ATTEMPT_TTL_MS + 1), expiredKey);

  const malformed = installReady('org-wa-malformed', 2201, 2202);
  configureIdentity(base);
  const malformedKey = attemptKey(malformed.scope.organizationId, malformed.authenticated.id);
  localStorage.setItem(malformedKey, '{malformed-json');
  assertOneShotInvalidation(base, malformedKey);

  const mismatch = installReady('org-wa-mismatch', 2301, 2302);
  const oldIdentity = configureIdentity(base);
  const mismatchAttempt = newAttempt(oldIdentity, base);
  savePendingWhatsAppAttempt(mismatchAttempt);
  const mismatchKey = attemptKey(mismatch.scope.organizationId, mismatch.authenticated.id);
  const changed = configureCurrentWhatsAppHumanIdentity({
    humanName: 'Juan Perez',
    confirmed: true,
    now: new Date('2026-09-11T12:01:00.000Z'),
  });
  assert.equal(changed.valid, true);
  assert.notEqual(changed.identity?.fingerprint, oldIdentity.fingerprint);
  assertOneShotInvalidation(base, mismatchKey);

  const recorded = installReady('org-wa-recorded', 2401, 2402);
  const recordedIdentity = configureIdentity(base);
  const recordedAttempt = newAttempt(recordedIdentity, base);
  savePendingWhatsAppAttempt(recordedAttempt);
  const recordedKey = attemptKey(recorded.scope.organizationId, recorded.authenticated.id);
  state.crm.activityLog.push({
    id: 1,
    actorId: recorded.authenticated.id,
    action: 'Contacto por WhatsApp',
    entityType: 'Cliente',
    entityId: 77,
    detail: `Canal: WhatsApp\nIntento: ${recordedAttempt.id}`,
    createdAt: base.toISOString(),
  });
  assertOneShotInvalidation(base, recordedKey);
});

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

async function waitForServer(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Servidor A3.2 WhatsApp no disponible: ${String(lastError ?? 'sin respuesta')}`);
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
    server.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

test('A3.2 WhatsApp bootstrap real-app llega a DOMContentLoaded sin feedback loop de propcontrol-cloud-status', { timeout: 120_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para A3.2 WhatsApp bootstrap.');
  const port = 63600 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 820 },
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
  });

  await context.addInitScript(() => {
    const target = window as Window & { __a32WhatsAppInvalidationEvents?: number };
    target.__a32WhatsAppInvalidationEvents = 0;
    document.addEventListener('propcontrol-cloud-status', (event) => {
      const message = String((event as CustomEvent<{ message?: string }>).detail?.message || '');
      if (/actor autenticado vigente|intento pendiente/i.test(message)) {
        target.__a32WhatsAppInvalidationEvents = (target.__a32WhatsAppInvalidationEvents ?? 0) + 1;
      }
    });
  });

  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
    const readyState = await page.evaluate(() => document.readyState);
    assert.ok(readyState === 'interactive' || readyState === 'complete');

    await page.waitForTimeout(100);
    const firstCount = await page.evaluate(() => (window as Window & { __a32WhatsAppInvalidationEvents?: number }).__a32WhatsAppInvalidationEvents ?? 0);
    await page.waitForTimeout(100);
    const secondCount = await page.evaluate(() => (window as Window & { __a32WhatsAppInvalidationEvents?: number }).__a32WhatsAppInvalidationEvents ?? 0);
    assert.equal(firstCount, 0, 'Bootstrap unresolved no debe emitir invalidaciones WhatsApp.');
    assert.equal(secondCount, 0, 'No debe existir recirculación de propcontrol-cloud-status.');
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
