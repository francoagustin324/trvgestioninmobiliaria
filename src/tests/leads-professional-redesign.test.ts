import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import test from 'node:test';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from 'playwright';
import { initialData, type Client, type CrmData, type TeamMember } from '../models.js';

const artifactDir = 'artifacts/leads-redesign';
const organizationId = 'trvgestioninmobiliaria';
const userId = 'leads-redesign-owner';
const memberId = 1;
const email = 'owner-leads-redesign@propcontrol.test';
const sessionKey = 'propcontrol-cloud-session-v1';
const activeMemberKey = 'propcontrol-active-team-member-v1';
const storageKey = `trv-crm-basico:user:${userId}`;
const syncKey = `${storageKey}:sync`;
const motorolaUserAgent = 'Mozilla/5.0 (Linux; Android 12; moto g(60) Build/S2RIS32.32-20-7-10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

function localDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function client(
  id: number,
  name: string,
  stage: Client['pipeline'],
  temperature: Client['temperature'],
  options: Partial<Client> = {},
): Client {
  return {
    id,
    name,
    phone: `5493515110${String(id).padStart(3, '0')}`,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@propcontrol.test`,
    interest: options.interest ?? 'Departamento en General Paz',
    status: 'Lead',
    temperature,
    pipeline: stage,
    budget: 'USD 95.000',
    currency: 'USD',
    paymentMethod: 'Contado',
    purchaseTimeframe: '0-3 meses',
    purpose: 'Vivir',
    zones: 'General Paz',
    canMoveForward: 'Sí',
    knowsArea: 'Sí',
    assignedToId: options.assignedToId ?? memberId,
    createdById: memberId,
    ...options,
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  const owner: TeamMember = {
    id: memberId,
    userId,
    name: 'Franco Solís',
    email,
    phone: '5493515110001',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-04T12:00:00.000Z',
  };
  const agent: TeamMember = {
    id: 2,
    userId: 'leads-redesign-agent',
    name: 'Carla Pereyra',
    email: 'carla@propcontrol.test',
    phone: '5493515110002',
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-08-04T12:00:00.000Z',
  };
  crm.organization = {
    id: organizationId,
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Rediseño Leads',
  };
  crm.teamMembers = [owner, agent];
  crm.clients = [
    client(101, 'Ana Vencida', 'Contactado', 'Caliente', {
      nextAction: 'Confirmar disponibilidad',
      nextFollowUp: localDateOffset(-1),
    }),
    client(102, 'Bruno Hoy', 'Contactado', 'Tibio', {
      nextAction: 'Enviar alternativas',
      nextFollowUp: localDateOffset(0),
      assignedToId: 2,
    }),
    client(103, 'Camila Nueva', 'Nuevo', 'Caliente', {
      nextAction: undefined,
      nextFollowUp: undefined,
      lastContact: undefined,
    }),
    client(104, 'Diego Sin Acción', 'Calificado', 'Frío', {
      nextAction: undefined,
      nextFollowUp: localDateOffset(1),
    }),
    client(105, 'Elena Contactada', 'Contactado', 'Tibio', {
      nextAction: 'Llamar para validar presupuesto',
      nextFollowUp: localDateOffset(2),
    }),
    client(106, 'Facundo Calificado', 'Calificado', 'Caliente', {
      nextAction: 'Proponer visita',
      nextFollowUp: localDateOffset(3),
      assignedToId: 2,
    }),
    client(107, 'Gabriela Visita', 'Visita coordinada', 'Caliente', {
      nextAction: 'Visita hoy 15:00',
      nextFollowUp: localDateOffset(0),
    }),
    client(108, 'Hernán Negociación', 'Negociación', 'Tibio', {
      nextAction: 'Revisar contraoferta',
      nextFollowUp: localDateOffset(1),
    }),
  ];
  crm.conversations = [];
  crm.properties = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.activityLog = crm.clients.map((lead, index) => ({
    id: index + 1,
    actorId: memberId,
    action: 'Lead creado',
    entityType: 'Cliente' as const,
    entityId: lead.id,
    detail: `${lead.name} · ${lead.pipeline}`,
    createdAt: `2026-08-04T${String(10 + index).padStart(2, '0')}:00:00.000Z`,
  }));
  crm.settings = {
    ...crm.settings,
    profileName: 'Franco Solís',
    profileEmail: email,
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
}

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

async function portIsFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const probe = createNetServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function findFreePort(): Promise<number> {
  const first = Math.floor(Math.random() * 80);
  for (let offset = 0; offset < 80; offset += 1) {
    const port = 63000 + ((first + offset) % 80);
    if (await portIsFree(port)) return port;
  }
  throw new Error('No hay un puerto libre entre 63000 y 63079 para validar Leads.');
}

async function waitForServer(url: string, server: ChildProcess): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`El servidor terminó con código ${server.exitCode}.`);
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Servidor no disponible: ${String(lastError ?? 'sin respuesta')}`);
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const finish = (): void => resolve();
    server.once('exit', finish);
    server.kill('SIGTERM');
    setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL');
      resolve();
    }, 2_000).unref();
  });
}

async function startServer(): Promise<{ server: ChildProcess; url: string }> {
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}`;
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
  await waitForServer(url, server);
  return { server, url };
}

function contextOptions(viewport: { width: number; height: number }): BrowserContextOptions {
  const mobile = viewport.width <= 430;
  return {
    viewport,
    deviceScaleFactor: 1,
    hasTouch: mobile,
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
  marker: string,
): Promise<BrowserContext> {
  const context = await browser.newContext(contextOptions(viewport));
  await context.route('**/api/cloud-config', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Nube de prueba no disponible.' }) });
  });
  await context.addInitScript(({ data, keys, currentUserId, currentEmail, currentMemberId, initMarker }) => {
    if (localStorage.getItem(initMarker)) return;
    localStorage.setItem(initMarker, '1');
    localStorage.setItem(keys.session, JSON.stringify({
      accessToken: `access-${currentUserId}`,
      refreshToken: `refresh-${currentUserId}`,
      expiresAt: Date.now() + 3_600_000,
      userId: currentUserId,
      email: currentEmail,
    }));
    localStorage.setItem(keys.storage, JSON.stringify(data));
    localStorage.setItem(keys.sync, JSON.stringify({ dirty: false, localUpdatedAt: new Date().toISOString() }));
    localStorage.setItem(keys.activeMember, String(currentMemberId));
  }, {
    data: fixture(),
    keys: { session: sessionKey, storage: storageKey, sync: syncKey, activeMember: activeMemberKey },
    currentUserId: userId,
    currentEmail: email,
    currentMemberId: memberId,
    initMarker: marker,
  });
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active.pc-leads-redesign', { state: 'visible', timeout: 25_000 });
  await page.locator('[data-pc-attention-section]').waitFor({ state: 'visible' });
  await page.locator('#mvp-lead-count').waitFor({ state: 'visible' });
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

async function assertFullyVisible(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && viewport, 'El elemento debe tener geometría visible.');
  assert.ok(box.x >= -1 && box.y >= -1, JSON.stringify(box));
  assert.ok(box.x + box.width <= viewport.width + 1, JSON.stringify({ box, viewport }));
  assert.ok(box.y + box.height <= viewport.height + 1, JSON.stringify({ box, viewport }));
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${artifactDir}/${name}`, fullPage: false });
}

async function assertInitialHierarchy(page: Page): Promise<void> {
  assert.equal(await page.locator('.pc-leads-heading h1').innerText(), 'Leads');
  assert.equal(await page.locator('.pc-leads-heading p').innerText(), 'Contactá primero a los leads que requieren atención.');
  assert.equal(await page.locator('#mvp-lead-search').getAttribute('placeholder'), 'Buscar por nombre, WhatsApp o interés');
  assert.equal(await page.locator('#mvp-lead-count').innerText(), '8 leads');
  const firstCard = page.locator('#mvp-lead-results .mvp-lead-card:visible').first();
  const firstCardBox = await firstCard.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(firstCardBox && viewport);
  assert.ok(firstCardBox.y < viewport.height - 100, JSON.stringify({ firstCardBox, viewport }));
}

async function verifyDesktop(page: Page, url: string): Promise<void> {
  await load(page, url);
  await assertInitialHierarchy(page);
  await assertNoHorizontalScroll(page);
  await screenshot(page, '01-leads-desktop-1366x768-inicial.png');

  await page.locator('[data-pc-attention="overdue"]').click();
  await page.waitForFunction(() => document.querySelector('#mvp-lead-count')?.textContent?.includes('de 8 leads'));
  assert.equal(await page.locator('[data-pc-attention="overdue"]').getAttribute('aria-pressed'), 'true');
  await screenshot(page, '02-leads-desktop-filtros-activos-1366x768.png');
  await page.locator('[data-pc-attention="overdue"]').click();

  await page.getByRole('button', { name: 'Crear nuevo lead' }).click();
  const form = page.locator('#mvp-lead-form.pc-lead-dialog:not(.collapsed)');
  await form.waitFor({ state: 'visible' });
  assert.equal(await form.getAttribute('role'), 'dialog');
  assert.equal(await form.locator('.pc-lead-dialog-close').innerText(), '×');
  assert.equal(await form.locator('.pc-lead-form-primary h3').innerText(), 'Datos principales');
  assert.equal(await form.locator('.pc-lead-form-commercial h3').innerText(), 'Estado comercial');
  assert.equal(await form.locator('.pc-lead-form-qualification > summary').innerText(), 'Calificación comercial');
  assert.equal(await form.locator('.pc-lead-form-optional').getAttribute('open'), null);
  await assertFullyVisible(page, form.locator('.b131-lead-form-actions'));
  await screenshot(page, '06-nuevo-lead-desktop-parte-superior.png');

  await form.locator('.b131-lead-form-fields').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await form.locator('.pc-lead-form-optional > summary').click();
  await screenshot(page, '07-nuevo-lead-desktop-parte-inferior.png');
  await assertNoHorizontalScroll(page);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#mvp-lead-form')?.classList.contains('collapsed'));
  await page.getByRole('button', { name: 'Crear nuevo lead' }).click();
  await form.waitFor({ state: 'visible' });
  await form.locator('.pc-lead-dialog-close').click();
  await page.waitForFunction(() => document.querySelector('#mvp-lead-form')?.classList.contains('collapsed'));
}

async function verifyMobile(page: Page, url: string): Promise<void> {
  await load(page, url);
  await assertInitialHierarchy(page);
  await assertNoHorizontalScroll(page);
  await screenshot(page, '03-leads-mobile-390x844-inicial.png');

  const stageNames = ['Todas', 'Nuevo', 'Contactado', 'Visita coordinada'];
  for (const stage of stageNames) {
    assert.equal(await page.locator(`[data-stage-quick="${stage}"]`).isVisible(), true, stage);
  }
  assert.equal(await page.locator('[data-stage-quick="Calificado"]').isVisible(), true);
  const collapsedPipeline = await page.locator('.mvp-stage-counters').evaluate((element) => ({
    flexWrap: getComputedStyle(element).flexWrap,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  assert.equal(collapsedPipeline.flexWrap, 'nowrap');
  assert.ok(collapsedPipeline.scrollWidth > collapsedPipeline.clientWidth);

  const filterDetails = page.locator('.mvp-lead-more-filters');
  await filterDetails.locator('> summary').click();
  await filterDetails.locator('#mvp-lead-temperature-filter').selectOption('Caliente');
  await page.waitForFunction(() => document.querySelector('.mvp-lead-more-filters > summary span')?.textContent?.includes('Filtros (1)'));
  assert.equal(await filterDetails.locator('[data-pc-clear-filters]').isVisible(), true);
  await screenshot(page, '04-panel-filtros-mobile-390x844.png');
  await filterDetails.locator('[data-pc-apply-filters]').click();
  assert.equal(await filterDetails.getAttribute('open'), null);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active.pc-leads-redesign', { state: 'visible' });
  await page.locator('[data-pc-toggle-stages]').click();
  await page.waitForFunction(() => document.querySelector('.pc-stage-summary')?.getAttribute('data-expanded') === 'true');
  assert.equal(await page.locator('[data-stage-quick="Calificado"]').isVisible(), true);
  assert.equal(await page.locator('.mvp-stage-counters').evaluate((element) => getComputedStyle(element).flexWrap), 'wrap');
  await screenshot(page, '05-resumen-etapas-mobile-expandido-390x844.png');

  await page.getByRole('button', { name: 'Crear nuevo lead' }).click();
  const form = page.locator('#mvp-lead-form.pc-lead-dialog:not(.collapsed)');
  await form.waitFor({ state: 'visible' });
  assert.equal(await form.locator('.pc-lead-form-section-grid').first().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
  await assertFullyVisible(page, form.locator('.b131-lead-form-actions'));
  await screenshot(page, '08-nuevo-lead-mobile-parte-superior.png');

  const fields = form.locator('.b131-lead-form-fields');
  await form.locator('.pc-lead-form-qualification').scrollIntoViewIfNeeded();
  await screenshot(page, '09-nuevo-lead-mobile-calificacion-comercial.png');

  await form.locator('input[name="zones"]').focus();
  await page.setViewportSize({ width: 390, height: 560 });
  await page.waitForTimeout(150);
  await assertFullyVisible(page, form.locator('.b131-lead-form-actions'));
  const actions = await form.locator('.b131-lead-form-actions').boundingBox();
  const navigation = await page.locator('.mobile-bottom-nav').boundingBox();
  assert.ok(actions && navigation);
  assert.ok(actions.y + actions.height <= navigation.y + 1, JSON.stringify({ actions, navigation }));
  await screenshot(page, '10-nuevo-lead-mobile-teclado-footer-accesible.png');
  await assertNoHorizontalScroll(page);

  await page.setViewportSize({ width: 390, height: 430 });
  await page.waitForTimeout(120);
  await assertFullyVisible(page, form.locator('.b131-lead-form-actions'));
  await assertNoHorizontalScroll(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(120);
  await page.getByRole('button', { name: 'Cerrar formulario' }).click();
  await page.waitForFunction(() => document.querySelector('#mvp-lead-form')?.classList.contains('collapsed'));
  await page.getByRole('button', { name: 'Crear nuevo lead' }).click();
  await form.waitFor({ state: 'visible' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active.pc-leads-redesign', { state: 'visible' });
  assert.equal(await page.locator('#mvp-lead-form:not(.collapsed)').count(), 0);
  void fields;
}

test('rediseño de Leads permanece aislado de la lógica comercial aprobada', () => {
  const index = readFileSync('index.html', 'utf8');
  const redesign = readFileSync('src/leads-professional-redesign.ts', 'utf8');
  const guards = readFileSync('src/leads-professional-redesign-guards.ts', 'utf8');
  const css = readFileSync('src/leads-professional-redesign.css', 'utf8');
  const reliability = readFileSync('src/lead-create-reliability.ts', 'utf8');
  const whatsapp = readFileSync('src/whatsapp-contact.ts', 'utf8');

  assert.match(index, /leads-professional-redesign\.css\?v=20260804-1/);
  assert.match(index, /leads-professional-redesign\.js\?v=20260804-1/);
  assert.match(index, /leads-professional-redesign-guards\.js\?v=20260804-1/);
  assert.match(redesign, /Contactá primero a los leads que requieren atención/);
  assert.match(redesign, /Buscar por nombre, WhatsApp o interés/);
  assert.match(redesign, /Atención requerida/);
  assert.match(redesign, /Resumen por etapa/);
  assert.match(redesign, /Calificación comercial/);
  assert.match(redesign, /Preferencias y datos opcionales/);
  assert.doesNotMatch(redesign, /saveData|queueCloudSave|upsertClient|openWhatsApp/);
  assert.match(guards, /Cerrar formulario/);
  assert.match(css, /interactive-widget|safe-area-inset-bottom|100dvh/);
  assert.match(reliability, /submittingForms = new WeakSet/);
  assert.match(reliability, /findDuplicateClient/);
  assert.match(reliability, /aria-busy/);
  assert.match(whatsapp, /assertCurrentWhatsAppHumanIdentity/);
  assert.match(whatsapp, /fingerprint/);
});

test('rediseño profesional valida desktop, laptop, tablet, Motorola y teclado reducido', { timeout: 420_000 }, async () => {
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome o Chromium debe estar disponible.');

  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    const started = await startServer();
    server = started.server;
    browser = await chromium.launch({ executablePath, headless: true });

    const desktop = await contextFor(browser, { width: 1366, height: 768 }, 'pc-leads-redesign-desktop');
    try {
      await verifyDesktop(await desktop.newPage(), started.url);
    } finally {
      await desktop.close();
    }

    const laptop = await contextFor(browser, { width: 1280, height: 720 }, 'pc-leads-redesign-laptop');
    try {
      const page = await laptop.newPage();
      await load(page, started.url);
      await assertNoHorizontalScroll(page);
      await page.getByRole('button', { name: 'Crear nuevo lead' }).click();
      const form = page.locator('#mvp-lead-form.pc-lead-dialog:not(.collapsed)');
      await form.waitFor({ state: 'visible' });
      await assertFullyVisible(page, form);
      await assertFullyVisible(page, form.locator('.b131-lead-form-actions'));
    } finally {
      await laptop.close();
    }

    const tablet = await contextFor(browser, { width: 768, height: 1024 }, 'pc-leads-redesign-tablet');
    try {
      const page = await tablet.newPage();
      await load(page, started.url);
      await assertNoHorizontalScroll(page);
      await assertInitialHierarchy(page);
    } finally {
      await tablet.close();
    }

    const mobile = await contextFor(browser, { width: 390, height: 844 }, 'pc-leads-redesign-mobile');
    try {
      await verifyMobile(await mobile.newPage(), started.url);
    } finally {
      await mobile.close();
    }
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server) await stopServer(server);
  }
});
