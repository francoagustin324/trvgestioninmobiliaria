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
const artifactDir = 'artifacts/b1-3-2';
const motorolaUserAgent = 'Mozilla/5.0 (Linux; Android 12; moto g(60) Build/S2RIS32.32-20-7-10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

interface Identity {
  role: TeamRole;
  memberId: number;
  userId: string;
  email: string;
  storageKey: string;
  syncKey: string;
}

interface B132Window extends Window {
  __b132OriginalSetItem?: typeof Storage.prototype.setItem;
  __b132StaleForm?: HTMLFormElement;
}

function identity(role: TeamRole): Identity {
  const memberId = role === 'Dueño' ? 1 : role === 'Administrador' ? 2 : 3;
  const slug = role === 'Dueño' ? 'owner' : role === 'Administrador' ? 'admin' : 'agent';
  const userId = `b132-${slug}`;
  return {
    role,
    memberId,
    userId,
    email: `${slug}-b132@propcontrol.test`,
    storageKey: `trv-crm-basico:user:${userId}`,
    syncKey: `trv-crm-basico:user:${userId}:sync`,
  };
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

function existingClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 77,
    name: 'Lead Existente Motorola',
    phone: '5493515110069',
    email: 'existente@propcontrol.test',
    interest: 'Balcones del Chateau, departamento',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    nextAction: 'Confirmar visita',
    nextFollowUp: '2026-08-02',
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function fixture(role: TeamRole, clients: Client[] = []): CrmData {
  const current = identity(role);
  const crm = structuredClone(initialData);
  crm.organization = { id: 'b132-org', name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'B1.3.2' };
  crm.teamMembers = [member('Dueño'), member('Administrador'), member('Corredor')];
  crm.clients = structuredClone(clients);
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
  throw new Error(`Servidor B1.3.2 no disponible: ${String(lastError ?? 'sin respuesta')}`);
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
  role: TeamRole,
  viewport: { width: number; height: number },
  suffix: string,
  clients: Client[] = [],
): Promise<BrowserContext> {
  const current = identity(role);
  const context = await browser.newContext(contextOptions(viewport));
  await context.addInitScript(({ crm, session, memberId, keys, markerKey }) => {
    if (localStorage.getItem(markerKey)) return;
    localStorage.setItem(markerKey, '1');
    localStorage.setItem(keys.session, JSON.stringify(session));
    localStorage.setItem(keys.storage, JSON.stringify(crm));
    localStorage.setItem(keys.sync, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-08-01T18:00:00-03:00',
      lastCloudSavedAt: '2026-08-01T18:00:00-03:00',
      lastCloudVersion: '2026-08-01T18:00:00-03:00',
    }));
    localStorage.setItem(keys.activeMember, String(memberId));
  }, {
    crm: fixture(role, clients),
    session: {
      accessToken: `access-${current.userId}`,
      refreshToken: `refresh-${current.userId}`,
      expiresAt: Date.now() + 3_600_000,
      userId: current.userId,
      email: current.email,
    },
    memberId: current.memberId,
    keys: { session: sessionKey, storage: current.storageKey, sync: current.syncKey, activeMember: activeMemberKey },
    markerKey: `propcontrol-b132-fixture:${current.userId}:${suffix}`,
  });
  return context;
}

async function installCloudFailure(context: BrowserContext, latency = 350): Promise<void> {
  await context.route('**/api/cloud-config', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, latency));
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Nube B1.3.2 temporalmente no disponible.' }),
    });
  });
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 25_000 });
}

async function throttleMotorola(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: 80 * 1024,
    uploadThroughput: 35 * 1024,
    connectionType: 'cellular3g',
  });
}

async function openLeadForm(page: Page) {
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

async function localTomorrow(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
    return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  });
}

async function localYesterday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    return `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  });
}

async function fillLead(
  form: ReturnType<Page['locator']>,
  values: { name: string; phone: string; email?: string; interest?: string; action?: string; date?: string },
): Promise<void> {
  await form.locator('input[name="name"]').fill(values.name);
  await form.locator('input[name="phone"]').fill(values.phone);
  if (values.email !== undefined) await form.locator('input[name="email"]').fill(values.email);
  await form.locator('input[name="interest"]').fill(values.interest ?? 'Balcones del Chateau, departamento');
  await form.locator('select[name="temperature"]').selectOption('Tibio');
  await form.locator('select[name="pipeline"]').selectOption('Nuevo');
  if (values.action !== undefined) await form.locator('input[name="nextAction"]').fill(values.action);
  if (values.date !== undefined) await form.locator('input[name="nextFollowUp"]').fill(values.date);
}

async function snapshot(page: Page, role: TeamRole): Promise<CrmData> {
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

async function requestSubmitTwice(form: ReturnType<Page['locator']>): Promise<void> {
  await form.evaluate((node) => {
    const submit = node.querySelector<HTMLButtonElement>('[data-save-lead]');
    if (!submit) throw new Error('Guardar lead no disponible.');
    node.requestSubmit(submit);
    node.requestSubmit(submit);
  });
}

async function closeAndReopenWithStorage(
  browser: Browser,
  context: BrowserContext,
  url: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const storageState = await context.storageState();
  await context.close();
  const reopened = await browser.newContext({ ...contextOptions({ width: 390, height: 844 }), storageState });
  await installCloudFailure(reopened, 80);
  const page = await reopened.newPage();
  await load(page, url);
  return { context: reopened, page };
}

test('B1.3.2 guarda una sola vez en Android, persiste localmente y sobrevive a nube fallida y reinicio', { timeout: 240_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.3.2.');
  const port = 62300 + Math.floor(Math.random() * 100);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  let context = await contextFor(browser, 'Dueño', { width: 390, height: 844 }, 'android-save');
  await installCloudFailure(context);
  try {
    let page = await context.newPage();
    await load(page, url);
    await throttleMotorola(page);
    const form = await openLeadForm(page);
    const today = await localToday(page);
    await fillLead(form, {
      name: 'PRUEBA B1.3.1',
      phone: '03515110069',
      email: 'francoagustinsolis@gmail.com',
      action: 'Confirmar visita',
      date: today,
    });
    await page.screenshot({ path: `${artifactDir}/01-android-antes-de-guardar.png`, fullPage: true });

    await form.locator('input[name="interest"]').focus();
    await page.setViewportSize({ width: 390, height: 430 });
    const saveGeometry = await form.locator('[data-save-lead]').evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height, viewport: innerHeight };
    });
    assert.ok(saveGeometry.height >= 44, JSON.stringify(saveGeometry));
    assert.ok(saveGeometry.top >= 0 && saveGeometry.bottom <= saveGeometry.viewport, JSON.stringify(saveGeometry));

    await requestSubmitTwice(form);
    const status = form.locator('[data-lead-status]');
    await status.getByText('Guardando…', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await form.locator('[data-save-lead]').isDisabled(), true);
    await page.screenshot({ path: `${artifactDir}/02-android-guardando.png`, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#notice').getByText(/Lead guardado correctamente\. PRUEBA B1\.3\.1 fue creado correctamente\./).waitFor({ state: 'visible' });
    await page.screenshot({ path: `${artifactDir}/03-android-guardado-exitoso.png`, fullPage: true });

    let saved = await snapshot(page, 'Dueño');
    assert.equal(saved.clients.length, 1, 'Doble toque crea un solo lead.');
    const client = saved.clients[0];
    assert.ok(client);
    assert.equal(client.name, 'PRUEBA B1.3.1');
    assert.equal(client.phone, '5493515110069');
    assert.equal(client.nextAction, 'Confirmar visita');
    assert.equal(client.nextFollowUp, today);
    assert.equal(saved.reminders.length, 0, 'No crea Reminder paralelo.');
    assert.equal(saved.activityLog.filter((entry) => entry.action === 'Lead creado').length, 1);
    assert.equal(saved.activityLog.filter((entry) => entry.action === 'Próxima acción programada').length, 1);
    assert.equal(saved.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 0);
    assert.equal(await page.locator('#crm.active [data-contact-whatsapp]').count(), 1);
    await page.locator('#crm.active [data-lead-full-sheet]').filter({ hasText: 'PRUEBA B1.3.1' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${artifactDir}/06-lead-visible-en-leads.png`, fullPage: true });

    await page.locator('#notice').getByText(/Guardado localmente, sincronización pendiente/).waitFor({ state: 'visible', timeout: 10_000 });
    saved = await snapshot(page, 'Dueño');
    assert.equal(saved.clients.length, 1, 'El fallo remoto no elimina el guardado local.');

    await page.locator('[data-module="agenda"]:visible').first().click();
    const agenda = page.locator('#agenda.active .agenda-card').filter({ hasText: 'PRUEBA B1.3.1' });
    await agenda.waitFor({ state: 'visible' });
    assert.equal(await agenda.count(), 1, 'Agenda muestra un único seguimiento activo.');
    assert.match(await agenda.innerText(), /Confirmar visita/);
    await page.screenshot({ path: `${artifactDir}/07-seguimiento-unico-en-agenda.png`, fullPage: true });
    await assertNoHorizontalScroll(page);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#crm.active', { state: 'visible' });
    saved = await snapshot(page, 'Dueño');
    assert.equal(saved.clients.length, 1, 'La recarga conserva un único lead.');
    assert.equal(saved.clients[0]?.nextFollowUp, today, 'Hoy local no se desplaza por UTC.');

    ({ context, page } = await closeAndReopenWithStorage(browser, context, url));
    saved = await snapshot(page, 'Dueño');
    assert.equal(saved.clients.length, 1, 'Cerrar y reabrir Chrome conserva el lead local pendiente.');
    await page.locator('#mvp-lead-results').getByText('PRUEBA B1.3.1', { exact: true }).waitFor({ state: 'visible' });
    await assertNoHorizontalScroll(page);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('B1.3.2 informa el WhatsApp duplicado y abre el lead existente sin escribir', { timeout: 150_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const port = 62400 + Math.floor(Math.random() * 100);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, 'Dueño', { width: 390, height: 844 }, 'duplicate', [existingClient()]);
  await installCloudFailure(context, 50);
  try {
    const page = await context.newPage();
    await load(page, url);
    const before = JSON.stringify(await snapshot(page, 'Dueño'));
    const form = await openLeadForm(page);
    await fillLead(form, {
      name: 'NO DEBE CREARSE',
      phone: '03515110069',
      email: 'francoagustinsolis@gmail.com',
      action: 'Confirmar visita',
      date: await localTomorrow(page),
    });
    await form.locator('[data-save-lead]').click();

    const duplicateMessage = 'Este WhatsApp ya pertenece al lead Lead Existente Motorola.';
    await form.locator('[data-lead-status]').getByText(duplicateMessage, { exact: true }).waitFor({ state: 'visible' });
    await form.getByRole('button', { name: 'Abrir lead existente' }).waitFor({ state: 'visible' });
    await form.getByRole('button', { name: 'Corregir número' }).waitFor({ state: 'visible' });
    await form.getByRole('button', { name: 'Cancelar' }).last().waitFor({ state: 'visible' });
    assert.equal((await snapshot(page, 'Dueño')).clients.length, 1);
    await page.screenshot({ path: `${artifactDir}/04-aviso-numero-duplicado.png`, fullPage: true });

    await form.getByRole('button', { name: 'Abrir lead existente' }).click();
    const details = page.locator('[data-lead-full-sheet="77"]');
    await details.waitFor({ state: 'visible' });
    assert.equal(await details.evaluate((node) => (node as HTMLDetailsElement).open), true);
    assert.equal(JSON.stringify(await snapshot(page, 'Dueño')), before, 'Abrir el existente no modifica datos.');
    await page.screenshot({ path: `${artifactDir}/05-abrir-lead-existente.png`, fullPage: true });
    await assertNoHorizontalScroll(page);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('B1.3.2 mantiene errores visibles, conserva datos y bloquea formularios obsoletos', { timeout: 180_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const port = 62500 + Math.floor(Math.random() * 100);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, 'Corredor', { width: 390, height: 844 }, 'errors');
  await installCloudFailure(context, 50);
  try {
    const page = await context.newPage();
    await load(page, url);
    let form = await openLeadForm(page);
    await fillLead(form, { name: 'VALIDACIONES B1.3.2', phone: '123', date: await localToday(page) });
    await form.locator('[data-save-lead]').click();
    await form.locator('[data-lead-status]').getByText('Ingresá un WhatsApp válido con código de área.', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await form.locator('input[name="name"]').inputValue(), 'VALIDACIONES B1.3.2');

    await form.locator('input[name="phone"]').fill('03515110068');
    await form.locator('input[name="nextAction"]').fill('Confirmar visita');
    await form.locator('input[name="nextFollowUp"]').fill(await localYesterday(page));
    await form.locator('[data-save-lead]').click();
    await form.locator('[data-lead-status]').getByText(/fecha.*pasada|pasada.*fecha/i).waitFor({ state: 'visible' });

    await form.evaluate((node) => { node.dataset.b131Actor = '999'; });
    await form.locator('input[name="nextFollowUp"]').fill(await localToday(page));
    await form.locator('[data-save-lead]').click();
    await form.locator('[data-lead-status]').getByText(/no tiene autorización/i).waitFor({ state: 'visible' });
    assert.equal((await snapshot(page, 'Corredor')).clients.length, 0);

    await page.locator('[data-toggle="client-form"]').click();
    form = await openLeadForm(page);
    await fillLead(form, { name: 'ERROR TECNICO B1.3.2', phone: '03515110067', date: await localToday(page) });
    await page.evaluate(() => {
      const target = window as unknown as B132Window;
      target.__b132OriginalSetItem = Storage.prototype.setItem;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key: string, value: string): void {
        if (key.includes('trv-crm-basico:user') && value.includes('ERROR TECNICO B1.3.2')) {
          throw new Error('Quota simulada B1.3.2');
        }
        original.call(this, key, value);
      };
    });
    await form.locator('[data-save-lead]').click();
    await form.locator('[data-lead-status]').getByText('No se pudo guardar el lead. Tus datos siguen en el formulario.', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await form.locator('input[name="name"]').inputValue(), 'ERROR TECNICO B1.3.2');
    assert.equal((await snapshot(page, 'Corredor')).clients.length, 0);
    await page.evaluate(() => {
      const target = window as unknown as B132Window;
      if (target.__b132OriginalSetItem) Storage.prototype.setItem = target.__b132OriginalSetItem;
    });

    await page.evaluate(() => {
      const target = window as unknown as B132Window;
      target.__b132StaleForm = document.querySelector<HTMLFormElement>('#mvp-lead-form') ?? undefined;
    });
    await page.evaluate(async () => {
      const store = await import('/dist/store.js');
      store.setActiveMemberId(1);
      document.dispatchEvent(new CustomEvent('trv-render'));
      const target = window as unknown as B132Window;
      const stale = target.__b132StaleForm;
      const button = stale?.querySelector<HTMLButtonElement>('[data-save-lead]');
      if (stale && button) stale.requestSubmit(button);
    });
    await page.waitForTimeout(250);
    assert.equal((await snapshot(page, 'Corredor')).clients.length, 0, 'El DOM obsoleto falla cerrado.');
    await assertNoHorizontalScroll(page);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('B1.3.2 conserva creación por rol, edición y escritorio sin desbordes', { timeout: 240_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const port = 62600 + Math.floor(Math.random() * 100);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const [index, role] of (['Dueño', 'Administrador', 'Corredor'] as TeamRole[]).entries()) {
      const viewport = role === 'Dueño' ? { width: 1366, height: 768 } : { width: 390, height: 844 };
      const context = await contextFor(browser, role, viewport, `role-${index}`);
      await installCloudFailure(context, 30);
      try {
        const page = await context.newPage();
        await load(page, url);
        const form = await openLeadForm(page);
        const phone = `0351511006${index + 1}`;
        await fillLead(form, {
          name: `LEAD ${role} B1.3.2`,
          phone,
          action: 'Confirmar visita',
          date: await localTomorrow(page),
        });
        await form.locator('[data-save-lead]').click();
        await page.locator('#mvp-lead-results').getByText(`LEAD ${role} B1.3.2`, { exact: true }).waitFor({ state: 'visible' });
        let saved = await snapshot(page, role);
        assert.equal(saved.clients.length, 1, `${role} crea un único lead.`);
        assert.equal(saved.clients[0]?.assignedToId, identity(role).memberId);
        assert.equal(saved.activityLog.filter((entry) => entry.action === 'Lead creado').length, 1);

        if (role === 'Dueño') {
          await page.screenshot({ path: `${artifactDir}/08-escritorio.png`, fullPage: true });
          await page.locator(`[data-edit-client="${saved.clients[0]?.id}"]`).click();
          const editForm = page.locator('#mvp-lead-form.b131-lead-form:not(.collapsed)');
          await editForm.locator('input[name="name"]').fill('LEAD DUEÑO EDITADO B1.3.2');
          await editForm.locator('[data-save-lead]').click();
          await page.locator('#mvp-lead-results').getByText('LEAD DUEÑO EDITADO B1.3.2', { exact: true }).waitFor({ state: 'visible' });
          saved = await snapshot(page, role);
          assert.equal(saved.clients.length, 1, 'Editar no crea otro lead.');
          assert.equal(saved.activityLog.filter((entry) => entry.action === 'Lead creado').length, 1);
        }
        await assertNoHorizontalScroll(page);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
