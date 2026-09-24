import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember, type TeamRole } from '../models.js';
import { installA35H5R1ModernTenantHarness } from './a35-h5-r1-modern-tenant-harness.js';

const sessionKey = 'propcontrol-cloud-session-v1';
const activeMemberKey = 'propcontrol-active-team-member-v1';
const artifactDir = 'artifacts/b1-3-1';
const mobileUserAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

interface Identity {
  role: TeamRole;
  memberId: number;
  userId: string;
  email: string;
  storageKey: string;
  syncKey: string;
}

interface B131Window extends Window {
  __b131OpenedUrl?: string;
  __b131StaleForm?: HTMLFormElement;
}

function identity(role: TeamRole): Identity {
  const memberId = role === 'Dueño' ? 1 : role === 'Administrador' ? 2 : 3;
  const slug = role === 'Dueño' ? 'owner' : role === 'Administrador' ? 'admin' : 'agent';
  const userId = `b131-${slug}`;
  const storageKey = `trv-crm-basico:user:${userId}:org:b131-org`;
  return { role, memberId, userId, email: `${slug}-b131@propcontrol.test`, storageKey, syncKey: `${storageKey}:sync` };
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

function fixture(role: TeamRole): CrmData {
  const current = identity(role);
  const crm = structuredClone(initialData);
  crm.organization = { id: 'b131-org', name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'B1.3.1' };
  crm.teamMembers = [member('Dueño'), member('Administrador'), member('Corredor')];
  crm.clients = [];
  crm.activityLog = [];
  crm.reminders = [];
  crm.conversations = [];
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
  throw new Error(`Servidor B1.3.1 no disponible: ${String(lastError ?? 'sin respuesta')}`);
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

async function contextFor(
  browser: Browser,
  role: TeamRole,
  viewport: { width: number; height: number },
  suffix = 'default',
): Promise<BrowserContext> {
  const current = identity(role);
  const mobile = viewport.width <= 430;
  const marker = `propcontrol-b131-fixture:${current.userId}:${suffix}`;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: viewport.width <= 720,
    isMobile: mobile,
    userAgent: mobile ? mobileUserAgent : undefined,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
  });
  const crm = fixture(role);
  await installA35H5R1ModernTenantHarness(context, crm, current.userId);
  await context.addInitScript(({ crm, session, memberId, keys, markerKey }) => {
    if (!localStorage.getItem(markerKey)) {
      localStorage.setItem(markerKey, '1');
      localStorage.setItem(keys.session, JSON.stringify(session));
      localStorage.setItem(keys.storage, JSON.stringify(crm));
      localStorage.setItem(keys.sync, JSON.stringify({
        dirty: false,
        localUpdatedAt: '2026-08-01T15:30:00-03:00',
        lastCloudSavedAt: '2026-08-01T15:30:00-03:00',
        lastCloudVersion: '2026-08-01T15:30:00-03:00',
      }));
      localStorage.setItem(keys.activeMember, String(memberId));
    }
    const target = window as unknown as B131Window;
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: (opened?: string | URL) => { target.__b131OpenedUrl = String(opened || ''); return null; },
    });
  }, {
    crm,
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
  });
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
}

async function openLeadForm(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.locator('[data-toggle="client-form"]').click();
  const form = page.locator('#mvp-lead-form.b131-lead-form:not(.collapsed)');
  await form.waitFor({ state: 'visible', timeout: 10_000 });
  await form.locator('[data-save-lead]').waitFor({ state: 'visible' });
  return form;
}

async function localToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
}

async function previousLocalDay(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date();
    const previous = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0, 0);
    return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}-${String(previous.getDate()).padStart(2, '0')}`;
  });
}

async function fillRequired(
  page: Page,
  form: ReturnType<Page['locator']>,
  values: { name: string; phone?: string; email?: string; interest?: string },
): Promise<void> {
  await form.locator('input[name="name"]').fill(values.name);
  if (values.phone !== undefined) await form.locator('input[name="phone"]').fill(values.phone);
  if (values.email !== undefined) await form.locator('input[name="email"]').fill(values.email);
  if (values.interest !== undefined) {
    const progressive = form.locator('[data-lead-commercial-details]');
    if ((await progressive.getAttribute('open')) === null) await progressive.locator(':scope > summary').click();
    await form.locator('input[name="interest"]').fill(values.interest);
  }
}

async function crmFromStorage(page: Page, role: TeamRole): Promise<CrmData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}') as CrmData, identity(role).storageKey);
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

async function saveButtonGeometry(page: Page): Promise<{
  top: number;
  bottom: number;
  height: number;
  viewportHeight: number;
  navigationTop: number;
}> {
  return page.locator('#mvp-lead-form [data-save-lead]').evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const navigation = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      viewportHeight: window.innerHeight,
      navigationTop: navigation?.top ?? window.innerHeight,
    };
  });
}

test('B2A alta rápida móvil crea con nombre + teléfono y permite completar después sin perder datos', { timeout: 180_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para B2A.');
  const port = 62000 + Math.floor(Math.random() * 120);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, 'Dueño', { width: 390, height: 844 }, 'mobile-fast-create');
  try {
    const page = await context.newPage();
    await load(page, url);
    let form = await openLeadForm(page);
    const progressive = form.locator('[data-lead-commercial-details]');
    assert.equal(await progressive.getAttribute('open'), null);
    assert.equal(await form.locator('input[name="name"]').isVisible(), true);
    assert.equal(await form.locator('input[name="phone"]').isVisible(), true);
    assert.equal(await form.locator('input[name="email"]').isVisible(), true);
    assert.equal(await form.locator('input[name="interest"]').isVisible(), false);
    assert.match(await progressive.locator(':scope > summary').innerText(), /Completar datos comerciales/);

    const fieldsGeometry = await form.locator('.b131-lead-form-fields').evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
    assert.ok(fieldsGeometry.scrollHeight <= fieldsGeometry.clientHeight + 24, JSON.stringify(fieldsGeometry));
    assert.equal(fieldsGeometry.overflowY, 'auto');

    await form.locator('input[name="phone"]').focus();
    await page.setViewportSize({ width: 390, height: 430 });
    await page.waitForTimeout(150);
    const keyboardGeometry = await saveButtonGeometry(page);
    assert.ok(keyboardGeometry.height >= 44, JSON.stringify(keyboardGeometry));
    assert.ok(keyboardGeometry.top >= 0, JSON.stringify(keyboardGeometry));
    assert.ok(keyboardGeometry.bottom <= keyboardGeometry.navigationTop - 8, JSON.stringify(keyboardGeometry));
    await page.setViewportSize({ width: 390, height: 844 });

    await fillRequired(page, form, { name: 'JUAN PÉREZ B2A', phone: '03515110069' });
    await form.evaluate((node) => {
      node.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: node.querySelector('[data-save-lead]') }));
      node.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: node.querySelector('[data-save-lead]') }));
    });
    await page.locator('#mvp-lead-results').getByText('JUAN PÉREZ B2A', { exact: true }).waitFor({ state: 'visible' });

    let saved = await crmFromStorage(page, 'Dueño');
    assert.equal(saved.clients.length, 1, 'Doble submit crea un solo lead.');
    const created = saved.clients[0];
    assert.ok(created);
    assert.equal(created.name, 'JUAN PÉREZ B2A');
    assert.equal(created.phone, '5493515110069');
    assert.equal(created.email, undefined);
    assert.equal(created.interest, '');
    assert.equal(created.nextAction, undefined);
    assert.equal(created.nextFollowUp, undefined);
    assert.equal(saved.activityLog.filter((entry) => entry.action === 'Próxima acción programada').length, 0);
    assert.equal(await page.locator(`[data-contact-whatsapp="${created.id}"]`).count(), 1);

    await page.locator(`[data-edit-client="${created.id}"]`).first().click();
    form = page.locator('#mvp-lead-form.b131-lead-form:not(.collapsed)');
    await form.waitFor({ state: 'visible' });
    assert.notEqual(await form.locator('[data-lead-commercial-details]').getAttribute('open'), null);
    assert.equal(await form.locator('input[name="phone"]').inputValue(), '5493515110069');
    await form.locator('input[name="interest"]').fill('Dúplex en Docta');
    await form.locator('input[name="budget"]').fill('USD 120.000');
    await form.locator('select[name="creditPossible"]').selectOption('Preaprobado');
    await form.locator('input[name="nextAction"]').fill('Enviar opciones de Docta');
    const today = await localToday(page);
    await form.locator('input[name="nextFollowUp"]').fill(today);
    await form.locator('[data-save-lead]').click();
    await page.waitForFunction(() => document.querySelector('#mvp-lead-form')?.classList.contains('collapsed'));
    await page.locator('#mvp-lead-results').getByText('JUAN PÉREZ B2A', { exact: true }).waitFor({ state: 'visible' });

    saved = await crmFromStorage(page, 'Dueño');
    const completed = saved.clients[0];
    assert.ok(completed);
    assert.equal(completed.name, 'JUAN PÉREZ B2A');
    assert.equal(completed.phone, '5493515110069');
    assert.equal(completed.interest, 'Dúplex en Docta');
    assert.equal(completed.budget, 'USD 120.000');
    assert.equal(completed.creditPossible, 'Preaprobado');
    assert.equal(completed.nextAction, 'Enviar opciones de Docta');
    assert.equal(completed.nextFollowUp, today);
    assert.equal(saved.clients.length, 1, 'Editar completa el mismo lead y no crea otro.');

    await page.locator('[data-module="agenda"]:visible').first().click();
    const agendaCard = page.locator('#agenda.active .agenda-card').filter({ hasText: 'JUAN PÉREZ B2A' });
    await agendaCard.waitFor({ state: 'visible' });
    assert.equal(await agendaCard.count(), 1);
    assert.match(await agendaCard.innerText(), /Enviar opciones de Docta/);
    await assertNoHorizontalScroll(page);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('B2A permite email sin teléfono, valida contacto/email y bloquea email duplicado exacto', { timeout: 150_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para B2A.');
  const port = 62200 + Math.floor(Math.random() * 120);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, 'Dueño', { width: 390, height: 844 }, 'email-fast-create');
  try {
    const page = await context.newPage();
    await load(page, url);
    let form = await openLeadForm(page);

    await form.locator('input[name="name"]').fill('SOLO NOMBRE B2A');
    await form.locator('[data-save-lead]').click();
    await form.locator('[data-lead-error]').waitFor({ state: 'visible' });
    assert.match(await form.locator('[data-lead-error]').innerText(), /al menos un medio de contacto/i);
    assert.equal((await crmFromStorage(page, 'Dueño')).clients.length, 0);

    await form.locator('input[name="email"]').fill('email-invalido');
    await form.locator('[data-save-lead]').click();
    await form.locator('[data-lead-error]').waitFor({ state: 'visible' });
    assert.match(await form.locator('[data-lead-error]').innerText(), /email válido/i);
    assert.equal((await crmFromStorage(page, 'Dueño')).clients.length, 0);

    await form.locator('input[name="email"]').fill('Juan.Email@Ejemplo.com');
    await form.locator('[data-save-lead]').click();
    await page.locator('#mvp-lead-results').getByText('SOLO NOMBRE B2A', { exact: true }).waitFor({ state: 'visible' });
    let saved = await crmFromStorage(page, 'Dueño');
    assert.equal(saved.clients.length, 1);
    assert.equal(saved.clients[0]?.phone, '');
    assert.equal(saved.clients[0]?.email, 'Juan.Email@Ejemplo.com');
    assert.equal(saved.clients[0]?.interest, '');
    assert.equal(saved.clients[0]?.nextAction, undefined);
    assert.equal(saved.clients[0]?.nextFollowUp, undefined);
    assert.equal(await page.locator('[data-module="agenda"]:visible').first().count(), 1);

    form = await openLeadForm(page);
    await fillRequired(page, form, { name: 'DUPLICADO EMAIL B2A', email: '  juan.email@ejemplo.COM ' });
    await form.locator('[data-save-lead]').click();
    await form.locator('[data-lead-error]').waitFor({ state: 'visible' });
    assert.match(await form.locator('[data-lead-error]').innerText(), /email ya pertenece al lead SOLO NOMBRE B2A/i);
    assert.equal(await form.getByRole('button', { name: 'Abrir lead existente' }).count(), 1);
    saved = await crmFromStorage(page, 'Dueño');
    assert.equal(saved.clients.length, 1, 'Email duplicado no crea un segundo lead.');
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('B1.3.1 permite cancelar y tocar fuera no guarda ni cierra el formulario', { timeout: 120_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.3.1.');
  const port = 62400 + Math.floor(Math.random() * 120);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, 'Dueño', { width: 390, height: 844 }, 'cancel');
  try {
    const page = await context.newPage();
    await load(page, url);
    const form = await openLeadForm(page);
    await fillRequired(page, form, {
      name: 'NO GUARDAR',
      phone: '03515551234',
      interest: 'Prueba de cancelación',
    });
    await page.locator('.b131-lead-form-backdrop').dispatchEvent('pointerdown');
    assert.equal(await form.isVisible(), true);
    assert.equal((await crmFromStorage(page, 'Dueño')).clients.length, 0);
    await form.getByRole('button', { name: 'Cancelar' }).click();
    await page.locator('#mvp-lead-form.collapsed').waitFor({ state: 'attached' });
    assert.equal((await crmFromStorage(page, 'Dueño')).clients.length, 0);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('B1.3.1 valida Dueño Administrador Corredor escritorio y referencias obsoletas', { timeout: 180_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.3.1.');
  const port = 62600 + Math.floor(Math.random() * 120);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const role of ['Dueño', 'Administrador', 'Corredor'] as const) {
      const context = await contextFor(browser, role, { width: 1366, height: 768 }, `role-${role}`);
      try {
        const page = await context.newPage();
        await load(page, url);
        const form = await openLeadForm(page);
        const submitGeometry = await saveButtonGeometry(page);
        assert.ok(submitGeometry.height >= 44, `${role}: ${JSON.stringify(submitGeometry)}`);
        assert.ok(submitGeometry.top >= 0 && submitGeometry.bottom <= submitGeometry.viewportHeight, `${role}: ${JSON.stringify(submitGeometry)}`);
        if (role === 'Dueño') await page.screenshot({ path: `${artifactDir}/05-escritorio.png`, fullPage: true });

        await fillRequired(page, form, {
          name: `LEAD ${role}`,
          phone: `0351555000${identity(role).memberId}`,
          interest: `Prueba ${role}`,
        });
        await form.locator('[data-save-lead]').click();
        await page.locator('#mvp-lead-results').getByText(`LEAD ${role}`, { exact: true }).waitFor({ state: 'visible' });
        const saved = await crmFromStorage(page, role);
        assert.equal(saved.clients.length, 1, `${role} crea un único lead.`);
        assert.equal(saved.clients[0]?.assignedToId, identity(role).memberId);
        assert.equal(saved.clients[0]?.createdById, identity(role).memberId);
        assert.equal(saved.clients[0]?.nextAction, undefined);
        await assertNoHorizontalScroll(page);
      } finally {
        await context.close();
      }
    }

    const staleContext = await contextFor(browser, 'Dueño', { width: 390, height: 844 }, 'stale');
    try {
      const page = await staleContext.newPage();
      await load(page, url);
      const form = await openLeadForm(page);
      await fillRequired(page, form, {
        name: 'REFERENCIA OBSOLETA',
        phone: '03515550999',
        interest: 'No debe guardarse',
      });
      await page.evaluate(async () => {
        const target = window as unknown as B131Window;
        target.__b131StaleForm = document.querySelector<HTMLFormElement>('#mvp-lead-form') || undefined;
        const store = await import('/dist/store.js');
        store.setActiveMemberId(3);
        target.__b131StaleForm?.querySelector<HTMLButtonElement>('[data-save-lead]')?.click();
      });
      await form.locator('[data-lead-error]').waitFor({ state: 'visible' });
      assert.match(await form.locator('[data-lead-error]').innerText(), /ya no tiene autorización|usuario activo cambió/i);
      assert.equal((await crmFromStorage(page, 'Dueño')).clients.length, 0, 'La referencia obsoleta falla cerrada.');
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('trv-render')));
      assert.equal(await page.evaluate(() => Boolean((window as unknown as B131Window).__b131StaleForm?.isConnected)), false);
    } finally {
      await staleContext.close();
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
