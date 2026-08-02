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
import { initialData, type Client, type CrmData, type TeamMember, type TeamRole, type WhatsAppConversation } from '../models.js';

const sessionKey = 'propcontrol-cloud-session-v1';
const activeMemberKey = 'propcontrol-active-team-member-v1';
const artifactDir = 'artifacts/b1-3-3';
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
  const userId = `b133-${slug}`;
  return {
    role,
    memberId,
    userId,
    email: `${slug}-b133@propcontrol.test`,
    storageKey: `trv-crm-basico:user:${userId}`,
    syncKey: `trv-crm-basico:user:${userId}:sync`,
  };
}

function member(role: TeamRole, technical = false): TeamMember {
  const current = identity(role);
  return {
    id: current.memberId,
    userId: current.userId,
    name: technical
      ? 'trvgestioninmobiliaria'
      : role === 'Dueño' ? 'Franco Solís' : role === 'Administrador' ? 'Ana Administradora' : 'Carla Corredora',
    email: current.email,
    phone: `549351511000${current.memberId}`,
    role,
    status: 'Activo',
    createdAt: `2026-08-0${current.memberId}T12:00:00.000Z`,
  };
}

function lead(overrides: Partial<Client> = {}): Client {
  return {
    id: 10,
    name: 'Lead Antiguo',
    phone: '5493515110001',
    email: 'antiguo@propcontrol.test',
    interest: 'Departamento antiguo',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Nuevo',
    nextAction: 'Contactar',
    nextFollowUp: '2030-01-01',
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function vilmaConversation(): WhatsAppConversation {
  return {
    id: 90,
    clientId: 90,
    phone: '5493515110069',
    mode: 'Humano',
    unread: 0,
    lastActivity: '2026-08-02T18:30:00.000Z',
    assignedToId: 1,
    createdById: 1,
    messages: [{
      id: 1,
      direction: 'outbound',
      sender: 'Humano',
      text: '¿Seguís buscando?',
      createdAt: '2026-08-02T18:00:00.000Z',
    }, {
      id: 2,
      direction: 'inbound',
      sender: 'Cliente',
      text: 'Sí, sigo buscando. Tengo USD 120.000 y compraría de contado.',
      createdAt: '2026-08-02T18:05:00.000Z',
    }],
  };
}

function fixture(
  role: TeamRole,
  clients: Client[] = [],
  conversations: WhatsAppConversation[] = [],
  technicalCurrent = false,
  profileName?: string,
): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: 'trvgestioninmobiliaria', name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'B1.3.3' };
  crm.teamMembers = [
    member('Dueño', role === 'Dueño' && technicalCurrent),
    member('Administrador', role === 'Administrador' && technicalCurrent),
    member('Corredor', role === 'Corredor' && technicalCurrent),
  ];
  crm.clients = structuredClone(clients);
  crm.conversations = structuredClone(conversations);
  crm.properties = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.activityLog = clients.map((client, index) => ({
    id: index + 1,
    actorId: client.createdById || 1,
    action: 'Lead creado',
    entityType: 'Cliente' as const,
    entityId: client.id,
    detail: `Lead creado: ${client.name}`,
    createdAt: client.id === 10 ? '2026-06-01T12:00:00.000Z' : '2026-08-02T17:00:00.000Z',
  }));
  crm.settings = {
    ...crm.settings,
    profileName: profileName ?? member(role).name,
    profileEmail: identity(role).email,
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
  throw new Error(`Servidor B1.3.3 no disponible: ${String(lastError ?? 'sin respuesta')}`);
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
  crm: CrmData,
): Promise<BrowserContext> {
  const current = identity(role);
  const context = await browser.newContext(contextOptions(viewport));
  await context.route('**/api/cloud-config', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Nube de prueba no disponible.' }) });
  });
  await context.addInitScript(({ data, session, memberId, keys, marker }) => {
    if (!localStorage.getItem(marker)) {
      localStorage.setItem(marker, '1');
      localStorage.setItem(keys.session, JSON.stringify(session));
      localStorage.setItem(keys.storage, JSON.stringify(data));
      localStorage.setItem(keys.sync, JSON.stringify({ dirty: false, localUpdatedAt: '2026-08-02T18:00:00-03:00' }));
      localStorage.setItem(keys.activeMember, String(memberId));
    }
  }, {
    data: crm,
    session: {
      accessToken: `access-${current.userId}`,
      refreshToken: `refresh-${current.userId}`,
      expiresAt: Date.now() + 3_600_000,
      userId: current.userId,
      email: current.email,
    },
    memberId: current.memberId,
    keys: { session: sessionKey, storage: current.storageKey, sync: current.syncKey, activeMember: activeMemberKey },
    marker: `propcontrol-b133:${suffix}`,
  });
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 25_000 });
  await page.locator('#mvp-lead-order').waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('#mvp-lead-order')?.value === 'recent');
}

async function snapshot(page: Page, role: TeamRole): Promise<CrmData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}') as CrmData, identity(role).storageKey);
}

async function localIso(page: Page, days = 0): Promise<string> {
  return page.evaluate((offset) => {
    const now = new Date();
    const value = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }, days);
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

async function assertReadableSelect(select: ReturnType<Page['locator']>): Promise<void> {
  const style = await select.evaluate((element) => {
    const computed = getComputedStyle(element);
    const option = element.querySelector('option');
    const optionStyle = option ? getComputedStyle(option) : null;
    return {
      color: computed.color,
      background: computed.backgroundColor,
      border: computed.borderColor,
      height: element.getBoundingClientRect().height,
      optionColor: optionStyle?.color || '',
      optionBackground: optionStyle?.backgroundColor || '',
    };
  });
  assert.notEqual(style.color, style.background, JSON.stringify(style));
  assert.ok(style.height >= 44, JSON.stringify(style));
  assert.notEqual(style.optionColor, style.optionBackground, JSON.stringify(style));
}

async function openLeadForm(page: Page) {
  await page.locator('[data-toggle="client-form"]').click();
  const form = page.locator('#mvp-lead-form.b131-lead-form:not(.collapsed)');
  await form.waitFor({ state: 'visible' });
  return form;
}

test('B1.3.3 muestra selectores legibles y el lead nuevo arriba sin F5 en Android', { timeout: 240_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const port = 62700 + Math.floor(Math.random() * 100);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(browser, 'Dueño', { width: 390, height: 844 }, 'android-create', fixture('Dueño', [lead()]));
  try {
    const page = await context.newPage();
    await load(page, url);
    const form = await openLeadForm(page);
    const temperature = form.locator('select[name="temperature"]');
    const pipeline = form.locator('select[name="pipeline"]');
    await assertReadableSelect(temperature);
    await temperature.focus();
    await page.screenshot({ path: `${artifactDir}/01-temperatura-legible.png`, fullPage: true });
    await assertReadableSelect(pipeline);
    await pipeline.focus();
    await page.screenshot({ path: `${artifactDir}/02-etapa-comercial-legible.png`, fullPage: true });

    const today = await localIso(page);
    await form.locator('input[name="name"]').fill('PRUEBA REAL B1.3.3');
    await form.locator('input[name="phone"]').fill('03515110069');
    await form.locator('input[name="email"]').fill('b133-real@example.com');
    await form.locator('input[name="interest"]').fill('Departamento en Balcones del Chateau');
    await temperature.selectOption('Tibio');
    await pipeline.selectOption('Nuevo');
    await form.locator('input[name="nextAction"]').fill('Confirmar visita');
    await form.locator('input[name="nextFollowUp"]').fill(today);

    await page.setViewportSize({ width: 390, height: 430 });
    const saveGeometry = await form.locator('[data-save-lead]').evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height, viewport: innerHeight };
    });
    assert.ok(saveGeometry.height >= 44, JSON.stringify(saveGeometry));
    assert.ok(saveGeometry.top >= 0 && saveGeometry.bottom <= saveGeometry.viewport, JSON.stringify(saveGeometry));
    await form.locator('[data-save-lead]').click();
    await page.setViewportSize({ width: 390, height: 844 });

    await page.locator('#notice').getByText(/PRUEBA REAL B1\.3\.3 fue creado correctamente/).waitFor({ state: 'visible' });
    const newCard = page.locator('#crm.active [data-client-id]').filter({ hasText: 'PRUEBA REAL B1.3.3' });
    await newCard.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[data-new-lead-visible="true"]') !== null);
    assert.match(await page.locator('#crm.active [data-client-id]').first().innerText(), /PRUEBA REAL B1\.3\.3/);
    assert.equal(await page.locator('#crm.active [data-client-id]').filter({ hasText: 'PRUEBA REAL B1.3.3' }).count(), 1);
    await page.screenshot({ path: `${artifactDir}/03-lead-recien-creado-arriba.png`, fullPage: true });

    const order = page.locator('#mvp-lead-order');
    assert.equal(await order.inputValue(), 'recent');
    await page.locator('.mvp-lead-more-filters').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
    await order.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${artifactDir}/04-orden-mas-recientes.png`, fullPage: true });
    let saved = await snapshot(page, 'Dueño');
    assert.equal(saved.clients.filter((item) => item.name === 'PRUEBA REAL B1.3.3').length, 1);
    assert.equal(saved.reminders.length, 0);

    await page.waitForTimeout(700);
    assert.equal(await page.locator('#crm.active [data-client-id]').filter({ hasText: 'PRUEBA REAL B1.3.3' }).count(), 1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#crm.active');
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('#mvp-lead-order')?.value === 'recent');
    saved = await snapshot(page, 'Dueño');
    assert.equal(saved.clients.filter((item) => item.name === 'PRUEBA REAL B1.3.3').length, 1);
    assert.match(await page.locator('#crm.active [data-client-id]').first().innerText(), /PRUEBA REAL B1\.3\.3/);

    await page.locator('#mvp-lead-order').selectOption('priority');
    assert.equal(await page.locator('#mvp-lead-order').inputValue(), 'priority');
    await assertNoHorizontalScroll(page);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('B1.3.3 firma con Franco, usa conversación y guarda exactamente la fecha visible', { timeout: 240_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const port = 62800 + Math.floor(Math.random() * 100);
  const url = `http://127.0.0.1:${port}`;
  const vilma = lead({
    id: 90,
    name: 'Vilma',
    phone: '03515110069',
    interest: 'Departamento en Balcones del Chateau',
    budget: 'USD 120.000',
    paymentMethod: 'Contado',
    nextAction: undefined,
    nextFollowUp: undefined,
  });
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await contextFor(
    browser,
    'Dueño',
    { width: 390, height: 844 },
    'context-message',
    fixture('Dueño', [vilma], [vilmaConversation()], true, 'Franco Solís'),
  );
  try {
    const page = await context.newPage();
    await load(page, url);
    await page.evaluate(() => {
      const target = window as unknown as { __b133OpenCount: number; open: typeof window.open };
      target.__b133OpenCount = 0;
      target.open = (() => {
        target.__b133OpenCount += 1;
        return null;
      }) as typeof window.open;
    });

    await page.locator('#crm.active [data-contact-whatsapp="90"]').click();
    const message = page.locator('[data-whatsapp-message]');
    await message.waitFor({ state: 'visible' });
    const text = await message.inputValue();
    assert.match(text, /^Hola Vilma, soy Franco de TRV Gestión Inmobiliaria\./);
    assert.doesNotMatch(text, /soy trvgestioninmobiliaria/i);
    assert.doesNotMatch(text, /segu[ií]s buscando/i);
    assert.match(text, /para cu[aá]ndo|cu[aá]ndo necesit[aá]s/i);
    assert.match(await page.locator('[data-whatsapp-context-note]').innerText(), /mensajes entrantes|Contexto disponible/i);
    assert.equal(await page.evaluate(() => (window as unknown as { __b133OpenCount: number }).__b133OpenCount), 0);
    await page.screenshot({ path: `${artifactDir}/05-mensaje-firmado-por-franco.png`, fullPage: true });
    await page.screenshot({ path: `${artifactDir}/06-pregunta-contextual.png`, fullPage: true });

    await page.locator('[data-whatsapp-manual-register]').click();
    const followUpForm = page.locator('[data-whatsapp-followup-form]');
    await followUpForm.waitFor({ state: 'visible' });
    await followUpForm.locator('input[name="follow-up-choice"][value="7"]').check();
    const expectedDate = await localIso(page, 7);
    await page.waitForFunction((expected) => document.querySelector<HTMLInputElement>('input[name="selected-date"]')?.value === expected, expectedDate);
    assert.equal(await followUpForm.locator('input[name="selected-date"]').inputValue(), expectedDate);
    assert.match(await followUpForm.locator('[data-whatsapp-followup-preview]').innerText(), /Se programar[aá] para:/);
    await page.screenshot({ path: `${artifactDir}/07-fecha-previa-al-guardado.png`, fullPage: true });
    await followUpForm.locator('button[type="submit"]').click();

    let saved = await snapshot(page, 'Dueño');
    const savedVilma = saved.clients.find((item) => item.id === 90);
    assert.equal(savedVilma?.nextFollowUp, expectedDate);
    assert.equal(savedVilma?.nextAction, 'Volver a contactar por WhatsApp');
    assert.equal(saved.reminders.length, 0);
    assert.equal(saved.activityLog.filter((entry) => entry.action === 'Contacto por WhatsApp').length, 1);
    assert.equal(saved.activityLog.filter((entry) => entry.action === 'Seguimiento por WhatsApp programado').length, 1);
    assert.equal(await page.evaluate(() => (window as unknown as { __b133OpenCount: number }).__b133OpenCount), 0);

    await page.locator('[data-module="agenda"]:visible').first().click();
    const agenda = page.locator('#agenda.active .agenda-card').filter({ hasText: 'Vilma' });
    await agenda.waitFor({ state: 'visible' });
    assert.equal(await agenda.count(), 1);
    assert.equal(await agenda.locator(`time[datetime="${expectedDate}"]`).count(), 1);
    await page.screenshot({ path: `${artifactDir}/08-misma-fecha-en-agenda.png`, fullPage: true });
    await assertNoHorizontalScroll(page);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#crm.active');
    saved = await snapshot(page, 'Dueño');
    assert.equal(saved.clients.find((item) => item.id === 90)?.nextFollowUp, expectedDate);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('B1.3.3 mantiene roles, bloquea identidad técnica y funciona en escritorio', { timeout: 240_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath);
  const port = 62900 + Math.floor(Math.random() * 100);
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const role of ['Dueño', 'Administrador', 'Corredor'] as TeamRole[]) {
      const current = identity(role);
      const roleLead = lead({
        id: 100 + current.memberId,
        name: `Lead ${role}`,
        phone: `0351511010${current.memberId}`,
        assignedToId: current.memberId,
        createdById: current.memberId,
      });
      const context = await contextFor(
        browser,
        role,
        role === 'Dueño' ? { width: 1366, height: 768 } : { width: 390, height: 844 },
        `role-${role}`,
        fixture(role, [roleLead]),
      );
      try {
        const page = await context.newPage();
        await load(page, url);
        const form = await openLeadForm(page);
        await assertReadableSelect(form.locator('select[name="temperature"]'));
        await assertReadableSelect(form.locator('select[name="pipeline"]'));
        await form.locator('[data-cancel-client-edit]').click();
        await page.locator(`#crm.active [data-contact-whatsapp="${roleLead.id}"]`).click();
        const text = await page.locator('[data-whatsapp-message]').inputValue();
        const expected = role === 'Dueño' ? 'Franco' : role === 'Administrador' ? 'Ana' : 'Carla';
        assert.match(text, new RegExp(`soy ${expected} de TRV Gestión Inmobiliaria`));
        await page.locator('[data-whatsapp-close]').click();
        await assertNoHorizontalScroll(page);
        if (role === 'Dueño') await page.screenshot({ path: `${artifactDir}/09-escritorio.png`, fullPage: true });
      } finally {
        await context.close();
      }
    }

    const invalidCrm = fixture('Corredor', [lead({ id: 140, assignedToId: 3, createdById: 3 })], [], true, '');
    invalidCrm.teamMembers[2]!.email = 'trvgestioninmobiliaria@example.com';
    const invalidContext = await contextFor(browser, 'Corredor', { width: 390, height: 844 }, 'invalid-identity', invalidCrm);
    try {
      const page = await invalidContext.newPage();
      await load(page, url);
      const stale = page.locator('#crm.active [data-contact-whatsapp="140"]');
      await stale.click();
      assert.match(await page.locator('[data-whatsapp-context-note]').innerText(), /Nombre para mensajes|identidad humana/i);
      assert.equal(await page.locator('[data-whatsapp-open]').isDisabled(), true);
      await page.locator('[data-whatsapp-close]').click();

      await page.evaluate(() => {
        const target = window as unknown as { __b133Stale?: HTMLElement };
        target.__b133Stale = document.querySelector<HTMLElement>('[data-contact-whatsapp="140"]') ?? undefined;
      });
      await page.evaluate(async () => {
        const store = await import('/dist/store.js');
        store.setActiveMemberId(1);
        document.dispatchEvent(new CustomEvent('trv-render'));
        (window as unknown as { __b133Stale?: HTMLElement }).__b133Stale?.click();
      });
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#propcontrol-whatsapp-contact:not([hidden])').count(), 0, 'El control DOM obsoleto falla cerrado.');
    } finally {
      await invalidContext.close();
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
