import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember, type TeamRole } from '../models.js';

const sessionKey = 'propcontrol-cloud-session-v1';
const activeMemberKey = 'propcontrol-active-team-member-v1';
const artifactDir = 'artifacts/b1-3';
const mobileUserAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

interface Identity {
  role: TeamRole;
  memberId: number;
  userId: string;
  email: string;
  storageKey: string;
  syncKey: string;
}

interface B13Window extends Window {
  __b13OpenedUrl?: string;
  __b13Copied?: string;
  __b13StaleRegister?: HTMLButtonElement;
}

function identity(role: TeamRole): Identity {
  const memberId = role === 'Dueño' ? 1 : role === 'Administrador' ? 2 : 3;
  const slug = role === 'Dueño' ? 'owner' : role === 'Administrador' ? 'admin' : 'agent';
  const userId = `b13-${slug}`;
  const storageKey = `trv-crm-basico:user:${userId}`;
  return { role, memberId, userId, email: `${slug}@propcontrol.test`, storageKey, syncKey: `${storageKey}:sync` };
}

function member(role: TeamRole): TeamMember {
  const current = identity(role);
  return {
    id: current.memberId,
    userId: current.userId,
    name: role === 'Dueño' ? 'Franco Solís' : role === 'Administrador' ? 'Ana Administradora' : 'Carla Corredora',
    email: current.email,
    phone: `549351511000${current.memberId}`,
    role,
    status: 'Activo',
    createdAt: `2026-08-0${current.memberId}T12:00:00.000Z`,
  };
}

function fixture(role: TeamRole, overdue = false): CrmData {
  const current = identity(role);
  const crm = structuredClone(initialData);
  crm.organization = { id: 'b13-org', name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'B1.3' };
  crm.teamMembers = [member('Dueño'), member('Administrador'), member('Corredor')];
  crm.activityLog = [];
  crm.clients = [
    {
      id: 1,
      name: 'Lucía Martín',
      phone: '+54 9 351 511-0069',
      email: 'lucia@ejemplo.com',
      interest: 'Dúplex en Docta',
      status: 'Lead',
      temperature: 'Tibio',
      pipeline: 'Nuevo',
      budget: 'USD 130.000',
      assignedToId: current.memberId,
      createdById: current.memberId,
      nextFollowUp: overdue ? '2026-07-30' : undefined,
      nextAction: overdue ? 'Volver a contactar por WhatsApp' : undefined,
    },
    {
      id: 2,
      name: 'Lead ajeno',
      phone: '+54 9 351 555-9999',
      interest: 'Departamento en General Paz',
      status: 'Lead',
      temperature: 'Caliente',
      pipeline: 'Contactado',
      assignedToId: current.memberId === 3 ? 1 : 3,
      createdById: 1,
    },
  ];
  crm.reminders = [];
  crm.conversations = [{
    id: 1,
    clientId: 1,
    phone: crm.clients[0]!.phone,
    mode: 'Humano',
    unread: 0,
    lastActivity: '2026-08-01T14:00:00.000Z',
    assignedToId: current.memberId,
    createdById: current.memberId,
    messages: [{ id: 1, direction: 'inbound', sender: 'Cliente', text: '¿Sigue disponible?', createdAt: '2026-08-01T14:00:00.000Z' }],
  }];
  crm.settings = {
    ...crm.settings,
    profileName: member(role).name,
    profileEmail: current.email,
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
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
  throw new Error(`Servidor B1.3 no disponible: ${String(lastError ?? 'sin respuesta')}`);
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

async function contextFor(browser: Browser, role: TeamRole, viewport: { width: number; height: number }, overdue = false): Promise<BrowserContext> {
  const current = identity(role);
  const currentMember = member(role);
  const mobile = viewport.width <= 430;
  const marker = `propcontrol-b13-fixture:${current.userId}:${overdue ? 'overdue' : 'normal'}`;
  const actorKey = `cloud:${current.userId}`;
  const identityStorageKey = `propcontrol-whatsapp-human-identity-v1:${encodeURIComponent('b13-org')}:${current.memberId}:${encodeURIComponent(actorKey)}`;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: viewport.width <= 720,
    isMobile: mobile,
    userAgent: mobile ? mobileUserAgent : undefined,
    locale: 'es-AR',
    colorScheme: 'dark',
  });
  await context.addInitScript(({ crm, session, memberId, keys, markerKey, whatsappIdentity }) => {
    if (!localStorage.getItem(markerKey)) {
      localStorage.setItem(markerKey, '1');
      localStorage.setItem(keys.session, JSON.stringify(session));
      localStorage.setItem(keys.storage, JSON.stringify(crm));
      localStorage.setItem(keys.sync, JSON.stringify({
        dirty: false,
        localUpdatedAt: '2026-08-01T14:00:00-03:00',
        lastCloudSavedAt: '2026-08-01T14:00:00-03:00',
        lastCloudVersion: '2026-08-01T14:00:00-03:00',
      }));
      localStorage.setItem(keys.activeMember, String(memberId));
      localStorage.setItem(whatsappIdentity.key, JSON.stringify(whatsappIdentity.value));
    }
    const target = window as unknown as B13Window;
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: (url?: string | URL) => { target.__b13OpenedUrl = String(url || ''); return null; },
    });
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text: string) => { target.__b13Copied = text; } },
      });
    } catch { /* clipboard no configurable */ }
  }, {
    crm: fixture(role, overdue),
    session: {
      accessToken: `access-${current.userId}`,
      refreshToken: `refresh-${current.userId}`,
      expiresAt: Date.now() + 3_600_000,
      userId: current.userId,
      email: current.email,
    },
    memberId: current.memberId,
    keys: { session: sessionKey, storage: current.storageKey, sync: current.syncKey, activeMember: activeMemberKey },
    markerKey: marker,
    whatsappIdentity: {
      key: identityStorageKey,
      value: {
        version: 1,
        organizationId: 'b13-org',
        memberId: current.memberId,
        actorKey,
        humanName: currentMember.name,
        confirmedAt: '2026-08-01T14:00:00.000Z',
      },
    },
  });
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('[data-contact-whatsapp="1"]', { state: 'visible', timeout: 20_000 });
}

async function crmFromStorage(page: Page, role: TeamRole): Promise<CrmData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}') as CrmData, identity(role).storageKey);
}

async function assertNoHorizontalScroll(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(geometry.document <= geometry.viewport + 1, JSON.stringify(geometry));
  assert.ok(geometry.body <= geometry.viewport + 1, JSON.stringify(geometry));
}

async function openAndReturn(page: Page): Promise<void> {
  await page.locator('[data-whatsapp-open]').click();
  await page.waitForTimeout(750);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible' });
}

test('B1.3 completa contacto, confirmación, seguimiento, reprogramación y Agenda en móvil', { timeout: 180_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.3.');
  const port = 61100 + Math.floor(Math.random() * 150);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, 'Dueño', { width: 390, height: 844 });
  try {
    const page = await context.newPage();
    await load(page, url);
    await page.locator('[data-contact-whatsapp="1"]').click();
    await page.locator('.whatsapp-contact-panel').waitFor({ state: 'visible' });
    await page.screenshot({ path: `${artifactDir}/01-mobile-panel-contacto.png`, fullPage: true });
    assert.match(await page.locator('[data-whatsapp-message]').inputValue(), /Lucía Martín/);
    assert.match(await page.locator('[data-whatsapp-message]').inputValue(), /Dúplex en Docta/);

    const edited = 'Hola Lucía 👋\n¿Seguís buscando en Nueva Córdoba?';
    await page.locator('[data-whatsapp-edit-message]').click();
    await page.locator('[data-whatsapp-message]').fill(edited);
    await page.locator('.whatsapp-zero-more-options > summary').click();
    await page.locator('[data-whatsapp-copy]').click();
    assert.equal(await page.evaluate(() => (window as unknown as B13Window).__b13Copied), edited);

    await page.locator('[data-whatsapp-phone]').fill('+54 9 351 ABC');
    assert.equal(await page.locator('[data-whatsapp-open]').isDisabled(), true);
    await page.screenshot({ path: `${artifactDir}/06-numero-invalido.png`, fullPage: true });
    await page.locator('[data-whatsapp-phone]').fill('0351 15 5110069');
    await openAndReturn(page);
    const openedUrl = await page.evaluate(() => (window as unknown as B13Window).__b13OpenedUrl || '');
    assert.equal(openedUrl, `https://wa.me/5493515110069?text=${encodeURIComponent(edited)}`);
    assert.equal((await crmFromStorage(page, 'Dueño')).activityLog.length, 0, 'Abrir WhatsApp no registra actividad.');
    await page.screenshot({ path: `${artifactDir}/02-mobile-confirmacion-regreso.png`, fullPage: true });
    await page.getByRole('button', { name: 'Todavía no' }).click();
    assert.equal((await crmFromStorage(page, 'Dueño')).activityLog.length, 0, 'Cancelar no registra.');

    await page.locator('[data-contact-whatsapp="1"]').click();
    await openAndReturn(page);
    await page.locator('[data-whatsapp-confirm-sent]').click();
    await page.locator('[data-whatsapp-change-followup]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-zero-followup-form]').count(), 0);
    await page.locator('[data-whatsapp-change-followup]').click();
    await page.locator('[data-zero-followup-form]').waitFor({ state: 'visible' });
    const choices = await page.locator('input[name="follow-up-choice"]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));
    assert.deepEqual(choices, ['1', '3', '7', '14', '30', 'custom']);
    await page.screenshot({ path: `${artifactDir}/03-mobile-proximo-seguimiento.png`, fullPage: true });
    await page.locator('input[name="follow-up-choice"][value="3"]').check();
    await page.locator('[data-zero-followup-form] button[type="submit"]').click();

    const scheduled = await crmFromStorage(page, 'Dueño');
    assert.equal(scheduled.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 1);
    assert.equal(scheduled.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 1);
    assert.equal(scheduled.clients[0]?.nextAction, 'Volver a contactar por WhatsApp');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-contact-whatsapp="1"]', { state: 'visible' });
    assert.equal((await crmFromStorage(page, 'Dueño')).activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 1);
    await page.locator('[data-module="agenda"]:visible').first().click();
    const agendaCard = page.locator('#agenda.active .agenda-card').filter({ hasText: 'Lucía Martín' }).first();
    await agendaCard.waitFor({ state: 'visible' });
    await agendaCard.locator('details.agenda-more-actions summary').click();
    const reprogram = agendaCard.locator('form[data-reprogram-source="client"]');
    await reprogram.locator('input[name="date"]').fill('2026-08-17');
    await reprogram.locator('button[type="submit"]').click();
    assert.equal((await crmFromStorage(page, 'Dueño')).clients[0]?.nextFollowUp, '2026-08-17');
    await page.locator('#agenda [data-complete-agenda="client"][data-id="1"]').click();
    const completed = await crmFromStorage(page, 'Dueño');
    assert.equal(completed.clients[0]?.nextFollowUp, undefined);
    assert.equal(completed.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 1, 'Completar no elimina el historial.');

    await page.locator('[data-module="crm"]:visible').first().click();
    await page.locator('[data-contact-whatsapp="1"]').click();
    await page.locator('[data-whatsapp-open]').click();
    await page.waitForTimeout(750);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('[data-whatsapp-confirm-sent]').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Todavía no', exact: true }).click();
    assert.equal((await crmFromStorage(page, 'Dueño')).clients[0]?.nextFollowUp, undefined, 'Todavía no no impone fecha.');
    await assertNoHorizontalScroll(page);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('B1.3 valida escritorio, roles, referencias obsoletas, módulos y vencimiento', { timeout: 180_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.3.');
  const port = 61400 + Math.floor(Math.random() * 150);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const role of ['Dueño', 'Administrador', 'Corredor'] as const) {
      const context = await contextFor(browser, role, { width: 1366, height: 768 });
      try {
        const page = await context.newPage();
        await load(page, url);
        assert.equal(await page.locator('[data-contact-whatsapp]').count(), role === 'Corredor' ? 1 : 2);
        await page.locator('[data-contact-whatsapp="1"]').click();
        if (role === 'Dueño') await page.screenshot({ path: `${artifactDir}/04-escritorio-contacto.png`, fullPage: true });
        await page.locator('.whatsapp-contact-heading [data-whatsapp-close]').click();
        for (const module of ['crm', 'propiedades', 'whatsapp', 'agenda'] as const) {
          await page.locator(`[data-module="${module}"]:visible`).first().click();
          await page.locator(`#${module}.active`).waitFor({ state: 'visible' });
          assert.ok((await page.locator(`#${module}`).innerText()).trim().length > 0);
        }
        await assertNoHorizontalScroll(page);
      } finally {
        await context.close();
      }
    }

    const staleContext = await contextFor(browser, 'Dueño', { width: 390, height: 844 });
    try {
      const page = await staleContext.newPage();
      await load(page, url);
      await page.locator('[data-contact-whatsapp="1"]').click();
      await page.evaluate(async () => {
        const target = window as unknown as B13Window;
        target.__b13StaleRegister = document.querySelector<HTMLButtonElement>('[data-whatsapp-manual-register]') || undefined;
        const store = await import('/dist/store.js');
        store.setActiveMemberId(3);
        document.dispatchEvent(new CustomEvent('trv-render'));
        target.__b13StaleRegister?.click();
      });
      await page.waitForTimeout(100);
      assert.equal((await crmFromStorage(page, 'Dueño')).activityLog.length, 0, 'Una referencia obsoleta falla cerrada al perder acceso.');
    } finally {
      await staleContext.close();
    }

    const overdueContext = await contextFor(browser, 'Dueño', { width: 390, height: 844 }, true);
    try {
      const page = await overdueContext.newPage();
      await load(page, url);
      await page.locator('[data-module="agenda"]:visible').first().click();
      await page.locator('#agenda.active .agenda-card.overdue').waitFor({ state: 'visible' });
      await page.screenshot({ path: `${artifactDir}/05-seguimiento-vencido.png`, fullPage: true });
      assert.match(await page.locator('#agenda.active .agenda-card.overdue').innerText(), /Vencido/);
    } finally {
      await overdueContext.close();
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
});

test('B1.3 garantiza idempotencia, expiración y todas las fechas programables', { timeout: 120_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.3.');
  const port = 61700 + Math.floor(Math.random() * 150);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, 'Dueño', { width: 390, height: 844 });
  try {
    const page = await context.newPage();
    await load(page, url);
    const result = await page.evaluate(async () => {
      const contact = await import('/dist/whatsapp-contact.js');
      const store = await import('/dist/store.js');
      const client = store.state.crm.clients[0];
      const attempt = contact.createPendingWhatsAppAttempt(client, '5493515110069', 'Mensaje único', new Date());
      const first = contact.registerWhatsAppContact(attempt);
      const second = contact.registerWhatsAppContact(attempt);
      const dates = ['2026-08-02', '2026-08-04', '2026-08-08', '2026-08-15', '2026-09-01', '2026-10-12'];
      const scheduled = dates.map((date) => contact.scheduleWhatsAppFollowUp(client.id, attempt.id, first?.activity.id || 0, date)?.client.nextFollowUp);
      const repeated = contact.scheduleWhatsAppFollowUp(client.id, attempt.id, first?.activity.id || 0, dates.at(-1) || '');
      const expired = { ...contact.createPendingWhatsAppAttempt(client, '5493515110069', 'Expirado', new Date(0)), expiresAt: new Date(1).toISOString() };
      const expiredResult = contact.registerWhatsAppContact(expired, new Date());
      return {
        firstDuplicate: first?.duplicate,
        secondDuplicate: second?.duplicate,
        expired: expiredResult,
        scheduled,
        repeatedDuplicate: repeated?.duplicate,
        contacts: store.state.crm.activityLog.filter((entry: { action: string }) => entry.action === 'Contacto por WhatsApp').length,
        schedules: store.state.crm.activityLog.filter((entry: { action: string }) => entry.action === 'Seguimiento por WhatsApp programado').length,
      };
    });
    assert.deepEqual(result, {
      firstDuplicate: false,
      secondDuplicate: true,
      expired: null,
      scheduled: ['2026-08-02', '2026-08-04', '2026-08-08', '2026-08-15', '2026-09-01', '2026-10-12'],
      repeatedDuplicate: true,
      contacts: 1,
      schedules: 1,
    });
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
