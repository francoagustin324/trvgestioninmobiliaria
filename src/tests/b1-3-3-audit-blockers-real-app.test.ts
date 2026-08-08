import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import test from 'node:test';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from 'playwright';
import { initialData, type Client, type CrmData, type TeamMember, type TeamRole } from '../models.js';

const sessionKey = 'propcontrol-cloud-session-v1';
const activeMemberKey = 'propcontrol-active-team-member-v1';
const artifactDir = 'artifacts/b1-3-3';
const organizationId = 'trvgestioninmobiliaria';
const organizationName = 'TRV Gestión Inmobiliaria';
const identityPrefix = 'propcontrol-whatsapp-human-identity-v1';
const motorolaUserAgent = 'Mozilla/5.0 (Linux; Android 12; moto g(60) Build/S2RIS32.32-20-7-10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

interface Identity {
  role: TeamRole;
  memberId: number;
  userId: string;
  email: string;
  storageKey: string;
  syncKey: string;
}

function identity(role: TeamRole): Identity {
  const memberId = role === 'Dueño' ? 1 : role === 'Administrador' ? 2 : 3;
  const slug = role === 'Dueño' ? 'owner' : role === 'Administrador' ? 'admin' : 'agent';
  const userId = `b133-audit-${slug}`;
  return {
    role,
    memberId,
    userId,
    email: `${slug}-b133-audit@propcontrol.test`,
    storageKey: `trv-crm-basico:user:${userId}`,
    syncKey: `trv-crm-basico:user:${userId}:sync`,
  };
}

function member(role: TeamRole, name?: string, email?: string): TeamMember {
  const current = identity(role);
  return {
    id: current.memberId,
    userId: current.userId,
    name: name ?? (role === 'Dueño' ? 'Franco Solís' : role === 'Administrador' ? 'Ana Administradora' : 'Carla Corredora'),
    email: email ?? current.email,
    phone: `549351522000${current.memberId}`,
    role,
    status: 'Activo',
    createdAt: `2026-08-0${current.memberId}T12:00:00.000Z`,
  };
}

function lead(id: number, name: string): Client {
  return {
    id,
    name,
    phone: '03515220069',
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@propcontrol.test`,
    interest: 'Departamento en Balcones del Chateau',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    budget: 'USD 120.000',
    paymentMethod: 'Contado',
    assignedToId: 1,
    createdById: 1,
  };
}

function fixture(client: Client, memberName = 'Nombre técnico', memberEmail = 'info@dominio.com'): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: organizationId, name: organizationName, seatLimit: null, planLabel: 'B1.3.3 auditoría' };
  crm.teamMembers = [
    member('Dueño', memberName, memberEmail),
    member('Administrador'),
    member('Corredor'),
  ];
  crm.clients = [structuredClone(client)];
  crm.conversations = [];
  crm.properties = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.activityLog = [{
    id: 1,
    actorId: 1,
    action: 'Lead creado',
    entityType: 'Cliente',
    entityId: client.id,
    detail: `Lead creado: ${client.name}`,
    createdAt: '2026-08-02T20:00:00.000Z',
  }];
  crm.settings = {
    ...crm.settings,
    profileName: 'Gerencia Comercial',
    profileEmail: 'info@dominio.com',
    agencyName: organizationName,
  };
  return crm;
}

function whatsappIdentityKey(current = identity('Dueño')): string {
  const actorKey = `cloud:${current.userId}`;
  return `${identityPrefix}:${encodeURIComponent(organizationId)}:${current.memberId}:${encodeURIComponent(actorKey)}`;
}

function identityRecord(humanName: string, current = identity('Dueño'), confirmedAt = '2026-08-02T20:30:00.000Z') {
  return {
    version: 1,
    organizationId,
    memberId: current.memberId,
    actorKey: `cloud:${current.userId}`,
    humanName,
    confirmedAt,
  };
}

function attemptKey(actorId = 1): string {
  return `propcontrol-whatsapp-contact-attempt-v1:${organizationId}:${actorId}`;
}

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
  throw new Error(`Servidor de auditoría B1.3.3 no disponible: ${String(lastError ?? 'sin respuesta')}`);
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

function contextOptions(viewport: { width: number; height: number }): BrowserContextOptions {
  const mobile = viewport.width <= 430;
  return {
    viewport,
    deviceScaleFactor: 1,
    hasTouch: viewport.width <= 720,
    isMobile: mobile,
    userAgent: mobile ? motorolaUserAgent : undefined,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
  };
}

async function contextFor(
  browser: Browser,
  viewport: { width: number; height: number },
  suffix: string,
  crm: CrmData,
  humanName: string | null,
): Promise<BrowserContext> {
  const current = identity('Dueño');
  const context = await browser.newContext(contextOptions(viewport));
  await context.route('**/api/cloud-config', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Nube de prueba no disponible.' }) });
  });
  await context.addInitScript(({ data, session, memberId, keys, marker, identityKey, configuredIdentity }) => {
    if (!localStorage.getItem(marker)) {
      localStorage.setItem(marker, '1');
      localStorage.setItem(keys.session, JSON.stringify(session));
      localStorage.setItem(keys.storage, JSON.stringify(data));
      localStorage.setItem(keys.sync, JSON.stringify({ dirty: false, localUpdatedAt: '2026-08-02T23:50:00-03:00' }));
      localStorage.setItem(keys.activeMember, String(memberId));
      if (configuredIdentity) localStorage.setItem(identityKey, JSON.stringify(configuredIdentity));
    }
  }, {
    data: crm,
    session: {
      accessToken: `access-${current.userId}`,
      refreshToken: `refresh-${current.userId}`,
      expiresAt: new Date('2026-08-04T00:00:00-03:00').getTime(),
      userId: current.userId,
      email: current.email,
    },
    memberId: current.memberId,
    keys: { session: sessionKey, storage: current.storageKey, sync: current.syncKey, activeMember: activeMemberKey },
    marker: `propcontrol-b133-audit:${suffix}`,
    identityKey: whatsappIdentityKey(current),
    configuredIdentity: humanName ? identityRecord(humanName, current) : null,
  });
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 25_000 });
  await page.locator('#mvp-lead-order').waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('#mvp-lead-order')?.value === 'recent');
}

async function snapshot(page: Page): Promise<CrmData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}') as CrmData, identity('Dueño').storageKey);
}

async function assertNoHorizontalScroll(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(geometry.document <= geometry.viewport + 1, JSON.stringify(geometry));
  assert.ok(geometry.body <= geometry.viewport + 1, JSON.stringify(geometry));
}

async function installActionCounters(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as {
      __b133OpenCount: number;
      __b133CopyCount: number;
      open: typeof window.open;
    };
    target.__b133OpenCount = 0;
    target.__b133CopyCount = 0;
    target.open = (() => {
      target.__b133OpenCount += 1;
      return null;
    }) as typeof window.open;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { target.__b133CopyCount += 1; } },
    });
  });
}

async function assertZeroWhatsAppEffects(page: Page, clientId: number): Promise<void> {
  assert.equal(await page.evaluate(() => (window as unknown as { __b133OpenCount: number }).__b133OpenCount), 0);
  assert.equal(await page.evaluate(() => (window as unknown as { __b133CopyCount: number }).__b133CopyCount), 0);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), attemptKey()), null);
  const saved = await snapshot(page);
  assert.equal(saved.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 0);
  assert.equal(saved.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 0);
  assert.equal(saved.clients.find((item) => item.id === clientId)?.nextFollowUp, undefined);
  assert.equal(saved.reminders.length, 0);
}

async function waitForFailClosedPanel(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const panel = document.querySelector<HTMLElement>('#propcontrol-whatsapp-contact .whatsapp-contact-panel');
    const message = panel?.querySelector<HTMLTextAreaElement>('[data-whatsapp-message]');
    const actions = panel
      ? Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-whatsapp-open], [data-whatsapp-copy]'))
      : [];
    return panel?.dataset.contactBlocked === 'true'
      && message?.value === ''
      && message.disabled
      && actions.length === 2
      && actions.every((action) => action.disabled);
  });
}

test('B1.3.3 exige configuración explícita y rechaza identidad departamental', { timeout: 240_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const client = lead(301, 'Lead Identidad Departamental');
  const port = 63000 + Math.floor(Math.random() * 80);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, { width: 390, height: 844 }, 'blocked-identity', fixture(client, 'PropControl'), null);
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-08-02T18:00:00-03:00'));
    await load(page, url);
    await installActionCounters(page);

    await page.locator(`#crm.active [data-contact-whatsapp="${client.id}"]`).click();
    const note = page.locator('[data-whatsapp-context-note]');
    await note.waitFor({ state: 'visible' });
    assert.match(await note.innerText(), /Nombre personal para firmar mensajes|identidad humana/i);
    const identityForm = page.locator('[data-whatsapp-identity-form]');
    await identityForm.locator('input[name="human-name"]').fill('Gerencia Comercial');
    await identityForm.locator('input[name="confirmed"]').check();
    await identityForm.locator('button[type="submit"]').click();
    assert.match(await identityForm.locator('[data-whatsapp-identity-feedback]').innerText(), /nombre personal real/i);
    for (const selector of ['[data-whatsapp-open]', '[data-whatsapp-copy]', '[data-whatsapp-message]', '[data-whatsapp-phone]']) {
      assert.equal(await page.locator(selector).isDisabled(), true, selector);
    }
    await page.screenshot({ path: `${artifactDir}/11-identidad-tecnica-bloqueada.png`, fullPage: true });
    await page.locator('[data-whatsapp-open]').evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.locator('[data-whatsapp-copy]').evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await assertZeroWhatsAppEffects(page, client.id);
    await assertNoHorizontalScroll(page);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('B1.3.3 conserva fecha inmutable, atribución validada y recarga', { timeout: 240_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const client = lead(302, 'Lead Fecha Inmutable');
  const port = 63100 + Math.floor(Math.random() * 80);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, { width: 390, height: 844 }, 'midnight-follow-up', fixture(client, 'PropControl', 'info@dominio.com'), 'Franco Agustín');
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-08-02T23:59:30-03:00'));
    await load(page, url);
    await installActionCounters(page);

    await page.locator(`#crm.active [data-contact-whatsapp="${client.id}"]`).click();
    const message = page.locator('[data-whatsapp-message]');
    await message.waitFor({ state: 'visible' });
    assert.match(await message.inputValue(), /^Hola Lead Fecha Inmutable, soy Franco de TRV Gestión Inmobiliaria\./);
    assert.doesNotMatch(await message.inputValue(), /PropControl|info@/i);
    await page.screenshot({ path: `${artifactDir}/10-franco-identidad-explicita.png`, fullPage: true });

    await page.locator('[data-whatsapp-open]').click();
    await page.clock.runFor(750);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible' });
    await page.locator('[data-whatsapp-confirm-sent]').click();
    await page.locator('[data-whatsapp-change-followup]').waitFor({ state: 'visible' });
    await page.locator('[data-whatsapp-change-followup]').click();
    const form = page.locator('[data-zero-followup-form]');
    await form.waitFor({ state: 'visible' });
    await form.locator('input[name="follow-up-choice"][value="7"]').check();
    const expectedDate = '2026-08-09';
    const selected = form.locator('input[name="selected-date"]');
    const preview = form.locator('[data-zero-followup-preview]');
    await page.waitForFunction((expected) => document.querySelector<HTMLInputElement>('input[name="selected-date"]')?.value === expected, expectedDate);
    assert.equal(await selected.inputValue(), expectedDate);
    const previewBeforeMidnight = await preview.innerText();
    assert.match(previewBeforeMidnight, /9 de agosto de 2026/i);
    await page.screenshot({ path: `${artifactDir}/12-fecha-inmutable-seleccionada.png`, fullPage: true });

    await page.clock.setFixedTime(new Date('2026-08-03T00:00:30-03:00'));
    assert.equal(await selected.inputValue(), expectedDate);
    assert.equal(await preview.innerText(), previewBeforeMidnight);
    await form.locator('button[type="submit"]').click();

    let saved = await snapshot(page);
    const contact = saved.activityLog.find((entry) => entry.action === 'Contacto por WhatsApp');
    assert.ok(contact);
    assert.match(contact.detail, /Responsable: Franco Agustín/);
    assert.match(contact.detail, /Fingerprint:/);
    assert.doesNotMatch(contact.detail, /info@dominio|PropControl/);
    assert.equal(saved.clients.find((item) => item.id === client.id)?.nextFollowUp, expectedDate);
    assert.equal(saved.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 1);
    assert.equal(saved.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 1);
    assert.equal(saved.reminders.length, 0);
    assert.equal(await page.evaluate(() => (window as unknown as { __b133OpenCount: number }).__b133OpenCount), 1);

    await page.locator('[data-module="agenda"]:visible').first().click();
    const agenda = page.locator('#agenda.active .agenda-card').filter({ hasText: client.name });
    await agenda.waitFor({ state: 'visible' });
    assert.equal(await agenda.locator(`time[datetime="${expectedDate}"]`).count(), 1);
    await page.screenshot({ path: `${artifactDir}/13-fecha-inmutable-agenda.png`, fullPage: true });
    await assertNoHorizontalScroll(page);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#crm.active');
    saved = await snapshot(page);
    assert.equal(saved.clients.find((item) => item.id === client.id)?.nextFollowUp, expectedDate);
    assert.equal(saved.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 1);
    assert.equal(saved.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 1);
    assert.equal(saved.reminders.length, 0);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('B1.3.3 invalida panel obsoleto tras cambiar identidad', { timeout: 240_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const client = lead(304, 'Lead Panel Obsoleto');
  const port = 63300 + Math.floor(Math.random() * 80);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, { width: 390, height: 844 }, 'stale-panel', fixture(client), 'Franco');
  try {
    const page = await context.newPage();
    await load(page, url);
    await installActionCounters(page);
    await page.locator(`#crm.active [data-contact-whatsapp="${client.id}"]`).click();
    await page.locator('[data-whatsapp-message]').waitFor({ state: 'visible' });
    await page.evaluate(() => {
      const target = window as unknown as { __b133StaleActions: HTMLElement[] };
      target.__b133StaleActions = [
        document.querySelector<HTMLElement>('[data-whatsapp-copy]')!,
        document.querySelector<HTMLElement>('[data-whatsapp-open]')!,
      ];
    });
    await page.evaluate(({ key, record }) => {
      localStorage.setItem(key, JSON.stringify(record));
      document.dispatchEvent(new CustomEvent('propcontrol-whatsapp-identity-changed'));
    }, {
      key: whatsappIdentityKey(),
      record: identityRecord('Carla Pereyra', identity('Dueño'), '2026-08-02T21:00:00.000Z'),
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await waitForFailClosedPanel(page);
    await page.evaluate(() => {
      const actions = (window as unknown as { __b133StaleActions: HTMLElement[] }).__b133StaleActions;
      actions.forEach((action) => action.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    });
    assert.equal(await page.locator('[data-whatsapp-message]').inputValue(), '');
    assert.equal(await page.locator('[data-whatsapp-context-note]').count(), 1);
    assert.equal(await page.locator('[data-whatsapp-context-note]').isVisible(), true);
    for (const selector of ['[data-whatsapp-open]', '[data-whatsapp-copy]']) {
      assert.equal(await page.locator(selector).isDisabled(), true, selector);
    }
    await assertZeroWhatsAppEffects(page, client.id);
    await page.screenshot({ path: `${artifactDir}/15-panel-identidad-invalidada.png`, fullPage: true });
    await assertNoHorizontalScroll(page);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('B1.3.3 invalida panel antiguo al cambiar miembro activo', { timeout: 240_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const client = lead(305, 'Lead Cambio Miembro');
  const port = 63400 + Math.floor(Math.random() * 80);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, { width: 390, height: 844 }, 'member-change', fixture(client), 'Franco');
  try {
    const page = await context.newPage();
    await load(page, url);
    await installActionCounters(page);
    await page.locator(`#crm.active [data-contact-whatsapp="${client.id}"]`).click();
    await page.evaluate(() => {
      const target = window as unknown as { __b133MemberStale: HTMLElement[] };
      target.__b133MemberStale = [
        document.querySelector<HTMLElement>('[data-whatsapp-copy]')!,
        document.querySelector<HTMLElement>('[data-whatsapp-open]')!,
      ];
    });
    await page.evaluate(async () => {
      const store = await import('/dist/store.js');
      store.setActiveMemberId(2);
      document.dispatchEvent(new CustomEvent('trv-render'));
      window.dispatchEvent(new Event('focus'));
    });
    await waitForFailClosedPanel(page);
    await page.evaluate(() => {
      const actions = (window as unknown as { __b133MemberStale: HTMLElement[] }).__b133MemberStale;
      actions.forEach((action) => action.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    });
    await assertZeroWhatsAppEffects(page, client.id);
    assert.equal(await page.locator('[data-whatsapp-context-note]').count(), 1);
    assert.equal(await page.locator('[data-whatsapp-context-note]').isVisible(), true);
    await page.screenshot({ path: `${artifactDir}/16-panel-miembro-invalidado.png`, fullPage: true });
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('B1.3.3 conserva Todavía no e invalida intento pendiente tras cambiar identidad', { timeout: 240_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const client = lead(306, 'Lead Intento Pendiente');
  const port = 63500 + Math.floor(Math.random() * 80);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, { width: 390, height: 844 }, 'pending-attempt', fixture(client), 'Franco');
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-08-02T18:00:00-03:00'));
    await load(page, url);
    await installActionCounters(page);

    await page.locator(`#crm.active [data-contact-whatsapp="${client.id}"]`).click();
    await page.locator('[data-whatsapp-open]').click();
    assert.equal(await page.evaluate(() => (window as unknown as { __b133OpenCount: number }).__b133OpenCount), 1);
    assert.notEqual(await page.evaluate((key) => localStorage.getItem(key), attemptKey()), null);
    await page.clock.setFixedTime(new Date('2026-08-02T18:00:02-03:00'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('[data-whatsapp-not-yet]').filter({ hasText: 'Todavía no' }).waitFor({ state: 'visible' });
    await page.locator('[data-whatsapp-not-yet]').filter({ hasText: 'Todavía no' }).click();
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), attemptKey()), null);
    let saved = await snapshot(page);
    assert.equal(saved.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 0);

    await page.locator(`#crm.active [data-contact-whatsapp="${client.id}"]`).click();
    await page.locator('[data-whatsapp-open]').click();
    assert.notEqual(await page.evaluate((key) => localStorage.getItem(key), attemptKey()), null);
    await page.evaluate(({ key, record }) => {
      localStorage.setItem(key, JSON.stringify(record));
      document.dispatchEvent(new CustomEvent('propcontrol-whatsapp-identity-changed'));
    }, {
      key: whatsappIdentityKey(),
      record: identityRecord('Carla Pereyra', identity('Dueño'), '2026-08-02T22:00:00.000Z'),
    });
    await page.waitForFunction((key) => localStorage.getItem(key) === null, attemptKey());
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.locator('[data-whatsapp-confirm-sent]:visible').count(), 0);
    saved = await snapshot(page);
    assert.equal(saved.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 0);
    assert.equal(saved.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 0);
    assert.equal(saved.reminders.length, 0);
    await page.screenshot({ path: `${artifactDir}/17-intento-pendiente-invalidado.png`, fullPage: true });
    await assertNoHorizontalScroll(page);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('B1.3.3 mantiene identidad confirmada y geometría en escritorio', { timeout: 180_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const client = lead(303, 'Lead Escritorio Auditoría');
  const port = 63200 + Math.floor(Math.random() * 80);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, { width: 1366, height: 768 }, 'desktop-audit', fixture(client), 'Franco Agustín');
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-08-02T18:00:00-03:00'));
    await load(page, url);
    await page.locator(`#crm.active [data-contact-whatsapp="${client.id}"]`).click();
    assert.match(await page.locator('[data-whatsapp-message]').inputValue(), /soy Franco de TRV Gestión Inmobiliaria/);
    await page.screenshot({ path: `${artifactDir}/14-escritorio-correccion-auditoria.png`, fullPage: true });
    await assertNoHorizontalScroll(page);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
