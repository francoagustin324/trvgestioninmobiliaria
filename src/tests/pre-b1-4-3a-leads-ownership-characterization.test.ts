import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'pre-b1-4-3a-owner';
const ORG_ID = 'pre-b1-4-3a-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const MOBILE_MATRIX = [320, 360, 375, 390, 412, 430, 520] as const;
const RISK_MATRIX = [521, 720, 900, 901] as const;

type SecondaryControlSnapshot = {
  count: number;
  stage: string;
  temperature: string;
  assignee: string;
  order: string;
  overdue: boolean;
  missingAction: boolean;
};

function owner(): TeamMember {
  return {
    id: 1,
    userId: USER_ID,
    name: 'Franco Solis',
    email: 'franco@propcontrol.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-13T12:00:00.000Z',
  };
}

function secondMember(): TeamMember {
  return {
    id: 2,
    userId: 'pre-b1-4-3a-agent',
    name: 'Agente Demo',
    email: 'agente@propcontrol.test',
    phone: '5493515110070',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-13T12:00:00.000Z',
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'PRE-B1.4.3A' };
  crm.teamMembers = [owner(), secondMember()];
  crm.activityLog = [];
  crm.clients = [
    {
      id: 1,
      name: 'Ana Nuevo',
      phone: '+54 9 351 511-1001',
      email: 'ana@ejemplo.com',
      interest: 'Dúplex en Docta',
      budget: 'USD 120000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Tibio',
      pipeline: 'Nuevo',
      assignedToId: 1,
      createdById: 1,
    },
    {
      id: 2,
      name: 'Bruno Contactado',
      phone: '+54 9 351 511-1002',
      email: 'bruno@ejemplo.com',
      interest: 'Departamento en General Paz',
      budget: 'USD 90000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Caliente',
      pipeline: 'Contactado',
      assignedToId: 2,
      createdById: 1,
      nextAction: 'Confirmar interés',
      nextFollowUp: '2099-01-01',
    },
    {
      id: 3,
      name: 'Carla Calificada',
      phone: '+54 9 351 511-1003',
      email: 'carla@ejemplo.com',
      interest: 'Casa en Manantiales',
      budget: 'USD 160000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Caliente',
      pipeline: 'Calificado',
      assignedToId: 1,
      createdById: 1,
      nextAction: 'Enviar propuesta',
      nextFollowUp: '2099-01-02',
    },
    {
      id: 4,
      name: 'Zoe Calificada',
      phone: '+54 9 351 511-1004',
      email: 'zoe@ejemplo.com',
      interest: 'Departamento en Nueva Córdoba',
      budget: 'USD 110000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Frío',
      pipeline: 'Calificado',
      assignedToId: 2,
      createdById: 1,
      nextAction: 'Agendar visita',
      nextFollowUp: '2099-01-03',
    },
    {
      id: 5,
      name: 'Diego Negociación',
      phone: '+54 9 351 511-1005',
      email: 'diego@ejemplo.com',
      interest: 'Dúplex en Docta',
      budget: 'USD 140000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Tibio',
      pipeline: 'Negociación',
      assignedToId: 1,
      createdById: 1,
      nextAction: 'Revisar oferta',
      nextFollowUp: '2099-01-04',
    },
  ];
  crm.reminders = [];
  crm.conversations = [];
  crm.properties = [];
  crm.contacts = [];
  crm.fichas = [];
  crm.settings = {
    ...crm.settings,
    profileName: owner().name,
    profileEmail: owner().email,
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
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
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor PRE-B1.4.3A no disponible.');
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
    server.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function seedContext(context: BrowserContext): Promise<void> {
  const actorKey = `cloud:${USER_ID}`;
  const identityKey = `propcontrol-whatsapp-human-identity-v1:${encodeURIComponent(ORG_ID)}:1:${encodeURIComponent(actorKey)}`;
  await context.addInitScript(({ crm, identityStorageKey, storageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: 'pre-b1-4-3a-owner',
      email: 'franco@propcontrol.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(crm));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-08-13T18:00:00.000Z',
      lastCloudSavedAt: '2026-08-13T18:00:00.000Z',
      lastCloudVersion: '2026-08-13T18:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
    localStorage.setItem(identityStorageKey, JSON.stringify({
      version: 1,
      organizationId: 'pre-b1-4-3a-org',
      memberId: 1,
      actorKey: 'cloud:pre-b1-4-3a-owner',
      humanName: 'Franco Solis',
      confirmedAt: '2026-08-13T18:00:00.000Z',
    }));
  }, { crm: fixture(), identityStorageKey: identityKey, storageKey: STORAGE_KEY });
}

async function createContext(browser: Browser, width: number, height: number, mobile = false): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width, height },
    screen: { width, height },
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
    userAgent: mobile
      ? 'Mozilla/5.0 (Linux; Android 14; moto g54 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36'
      : undefined,
  });
  await seedContext(context);
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.mvp-lead-card[data-client-id="1"]', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('#crm [data-pc-toggle-stages]', { state: 'attached', timeout: 20_000 });
  await page.waitForFunction(() => Boolean(document.querySelector('#crm.pc-leads-redesign .mvp-lead-more-filters')));
  await page.waitForTimeout(140);
}

async function visibleStages(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLButtonElement>('#crm .mvp-stage-counter'))
    .filter((button) => !button.hidden && getComputedStyle(button).display !== 'none' && button.getClientRects().length > 0)
    .map((button) => button.dataset.stageQuick ?? ''));
}

async function visibleLeadNames(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('#crm .mvp-lead-card'))
    .filter((card) => !card.hidden && getComputedStyle(card).display !== 'none' && card.getClientRects().length > 0)
    .map((card) => card.querySelector<HTMLElement>('.mvp-lead-identity h3')?.textContent?.trim() ?? '')
    .filter(Boolean));
}

async function filterSummary(page: Page): Promise<{ open: boolean; label: string; helper: string }> {
  return page.evaluate(() => {
    const details = document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters');
    return {
      open: details?.open ?? false,
      label: details?.querySelector<HTMLElement>(':scope > summary span')?.textContent?.trim() ?? '',
      helper: details?.querySelector<HTMLElement>(':scope > summary small')?.textContent?.trim() ?? '',
    };
  });
}

async function secondaryControls(page: Page): Promise<SecondaryControlSnapshot> {
  return page.evaluate(() => {
    const crm = document.querySelector<HTMLElement>('#crm');
    const stage = crm?.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter')?.value ?? '';
    const temperature = crm?.querySelector<HTMLSelectElement>('#mvp-lead-temperature-filter')?.value ?? '';
    const assignee = crm?.querySelector<HTMLSelectElement>('#mvp-lead-assignee-filter')?.value ?? 'Todos';
    const order = crm?.querySelector<HTMLSelectElement>('#mvp-lead-order')?.value ?? '';
    const overdue = crm?.querySelector<HTMLInputElement>('#mvp-lead-overdue-filter')?.checked ?? false;
    const missingAction = crm?.querySelector<HTMLInputElement>('#mvp-lead-missing-action-filter')?.checked ?? false;
    let count = 0;
    if (stage && stage !== 'Todas') count += 1;
    if (temperature && temperature !== 'Todas') count += 1;
    if (assignee && assignee !== 'Todos') count += 1;
    if (overdue) count += 1;
    if (missingAction) count += 1;
    return { count, stage, temperature, assignee, order, overdue, missingAction };
  });
}

async function assertSummaryMatchesControls(page: Page): Promise<SecondaryControlSnapshot> {
  const controls = await secondaryControls(page);
  const summary = await filterSummary(page);
  const expectedLabel = controls.count ? `Filtros (${controls.count})` : 'Filtros';
  assert.equal(summary.label, expectedLabel, `N debe derivarse del DOM real: ${JSON.stringify({ controls, summary })}`);
  return controls;
}

async function noDocumentOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    && document.body.scrollWidth <= document.body.clientWidth + 1);
}

async function waitForDetailsOpen(page: Page, expected: boolean): Promise<void> {
  await page.waitForFunction((value) => document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters')?.open === value, expected);
}

async function clearSecondaryFilters(page: Page): Promise<void> {
  const details = page.locator('#crm .mvp-lead-more-filters');
  if ((await details.getAttribute('open')) === null) {
    await details.locator(':scope > summary').click();
    await waitForDetailsOpen(page, true);
  }
  await page.locator('[data-pc-clear-filters]').click();
  await waitForDetailsOpen(page, false);
  await page.waitForFunction(() => document.querySelector('#crm .mvp-lead-more-filters > summary span')?.textContent?.trim() === 'Filtros');
  const controls = await secondaryControls(page);
  assert.equal(controls.count, 0, `Limpiar debe llevar N a cero: ${JSON.stringify(controls)}`);
}

async function currentCommercialData(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate((storageKey) => {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as { clients?: Array<Record<string, unknown>> };
    return (stored.clients ?? []).map((client) => ({
      id: client.id,
      name: client.name,
      pipeline: client.pipeline,
      temperature: client.temperature,
      nextAction: client.nextAction,
      nextFollowUp: client.nextFollowUp,
      assignedToId: client.assignedToId,
    }));
  }, STORAGE_KEY);
}

async function launchChromium(): Promise<Browser> {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible.');
  return chromium.launch({ executablePath, headless: true });
}

test('PRE-B1.4.3A ownership efectivo queda caracterizado sin modificar runtime', () => {
  const core = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  const redesign = readFileSync('src/leads-professional-redesign.ts', 'utf8');
  const blocking = readFileSync('src/leads-professional-redesign-blocking-fix.ts', 'utf8');
  const guards = readFileSync('src/leads-professional-redesign-guards.ts', 'utf8');
  const mobileCss = readFileSync('src/leads-mobile-real-validation.css', 'utf8');
  const desktopCss = readFileSync('src/leads-desktop-zero-training.css', 'utf8');

  assert.match(core, /matchMedia\('\(max-width: 520px\)'\)/, 'Core conserva su corte histórico <=520 al emitir details.');
  assert.match(core, /const open = !mobile \|\| active\.length > 0;/, 'Core sigue emitiendo el estado HTML base de filtros.');
  assert.match(core, /function synchronizeFilterStateFromControls\(container: HTMLElement\)/, 'Core es owner del estado comercial derivado de controles reales.');
  assert.match(blocking, /const MOBILE_QUERY = '\(max-width: 720px\)'/);
  assert.match(blocking, /const DESKTOP_QUERY = '\(min-width: 901px\)'/);
  assert.match(blocking, /function activeDesktopFilterCount\(crm: HTMLElement\)/, 'Blocking-fix calcula el conteo secundario desktop observable.');
  assert.match(blocking, /details\.open = true;/, 'La franja intermedia conserva el disclosure abierto efectivo actual.');
  assert.match(redesign, /let stagesExpanded = false;/, 'Redesign conserva el estado del disclosure de pipeline.');
  assert.match(redesign, /stagesExpanded = !stagesExpanded;/, 'Redesign es owner efectivo del toggle de pipeline.');
  assert.match(redesign, /toggle\.hidden = !\(isMobile\(\) \|\| isDesktop\(\)\);/, 'El toggle se muestra sólo en <=720 o >=901.');
  assert.match(guards, /function hasCoreFilters\(crm: HTMLElement\)/, 'Guards observa DOM real para presentación auxiliar.');
  assert.match(mobileCss, /@media \(max-width: 520px\)/);
  assert.match(mobileCss, /data-pc-secondary-stage\][\s\S]*display: none !important;/, 'PR142 mantiene ocultas las secundarias no seleccionadas <=520.');
  assert.match(desktopCss, /@media \(min-width: 901px\)/);
  assert.match(desktopCss, /data-pc-secondary-stage\]:not\(\.active\):not\(\[aria-pressed="true"\]\):not\(\.pc-selected-stage\)[\s\S]*display: none;/, 'PR143 mantiene pipeline compacto desktop.');
});

test('PRE-B1.4.3A desktop >=901: filtros, pipeline, rerenders y resultados comerciales quedan estables', { timeout: 180_000 }, async () => {
  const port = 62440 + Math.floor(Math.random() * 40);
  const server = await startServer(port);
  const browser = await launchChromium();
  const context = await createContext(browser, 1366, 768, false);
  const externalWrites: Array<{ method: string; url: string }> = [];

  try {
    const page = await context.newPage();
    page.on('request', (request) => {
      const method = request.method();
      const url = request.url();
      if (/^(POST|PUT|PATCH|DELETE)$/i.test(method) && !url.startsWith(`http://127.0.0.1:${port}`)) externalWrites.push({ method, url });
    });
    await load(page, `http://127.0.0.1:${port}`);

    const expectedCommercialData = fixture().clients.map((client) => ({
      id: client.id,
      name: client.name,
      pipeline: client.pipeline,
      temperature: client.temperature,
      nextAction: client.nextAction,
      nextFollowUp: client.nextFollowUp,
      assignedToId: client.assignedToId,
    }));

    const details = page.locator('#crm .mvp-lead-more-filters');
    const summary = details.locator(':scope > summary');
    assert.equal(await details.getAttribute('open'), null, 'Desktop inicia con filtros secundarios cerrados.');
    const initialControls = await assertSummaryMatchesControls(page);
    console.log(`PRE_B1_4_3A_INITIAL_DESKTOP_CONTROLS=${JSON.stringify(initialControls)}`);
    if (initialControls.count > 0) await clearSecondaryFilters(page);

    await summary.click();
    await waitForDetailsOpen(page, true);
    await page.locator('#mvp-lead-order').selectOption('name');
    await page.waitForFunction(() => {
      const order = document.querySelector<HTMLSelectElement>('#mvp-lead-order');
      const summaryLabel = document.querySelector('#crm .mvp-lead-more-filters > summary span');
      return order?.value === 'name' && summaryLabel?.textContent?.trim() === 'Filtros';
    });
    assert.equal((await filterSummary(page)).open, true, 'Cambiar un control no cierra un panel abierto manualmente.');

    await page.locator('#mvp-lead-stage-filter').selectOption('Calificado');
    await page.waitForFunction(() => document.querySelector('#crm .mvp-lead-more-filters > summary span')?.textContent?.trim() === 'Filtros (1)');
    assert.equal((await filterSummary(page)).open, true, 'El rerender de etapa conserva apertura manual dentro del ciclo.');
    assert.deepEqual(await visibleLeadNames(page), ['Carla Calificada', 'Zoe Calificada'], 'Main filtra Calificado y conserva orden alfabético solicitado.');
    await assertSummaryMatchesControls(page);

    await page.locator('[data-pc-apply-filters]').click();
    await waitForDetailsOpen(page, false);
    assert.equal((await filterSummary(page)).label, 'Filtros (1)', 'Aplicar cierra y conserva N exacto.');

    const collapsed = await visibleStages(page);
    for (const stage of ['Todas', 'Nuevo', 'Contactado', 'Visita coordinada', 'Calificado']) {
      assert.ok(collapsed.includes(stage), `Pipeline compacto debe conservar ${stage}.`);
    }
    assert.ok(collapsed.length <= 5, `Pipeline desktop compacto no debe exponer todas las etapas: ${JSON.stringify(collapsed)}`);
    const pipeline = page.locator('#crm [data-pc-toggle-stages]');
    assert.equal((await pipeline.textContent())?.trim(), 'Ver todas las etapas');
    assert.equal(await pipeline.getAttribute('aria-expanded'), 'false');
    const collapsedScroll = await page.locator('#crm .mvp-stage-counters').evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
    assert.ok(collapsedScroll.scrollWidth <= collapsedScroll.clientWidth + 1, `Pipeline compacto sin scrollbar horizontal: ${JSON.stringify(collapsedScroll)}`);

    await pipeline.click();
    await page.waitForFunction(() => document.querySelector('#crm [data-pc-toggle-stages]')?.getAttribute('aria-expanded') === 'true');
    assert.equal((await pipeline.textContent())?.trim(), 'Ver menos etapas');
    assert.equal((await visibleStages(page)).length, 9, 'Ver todas las etapas expande las nueve etapas.');

    const stableLabel = (await filterSummary(page)).label;
    await page.evaluate(() => {
      for (let index = 0; index < 12; index += 1) document.dispatchEvent(new CustomEvent('trv-render'));
    });
    await page.waitForTimeout(220);
    assert.equal((await filterSummary(page)).open, false, '12 rerenders no autoabren filtros desktop.');
    assert.equal((await filterSummary(page)).label, stableLabel, '12 rerenders no derivan N.');
    assert.equal(await page.locator('#crm [data-pc-toggle-stages]').getAttribute('aria-expanded'), 'true', '12 rerenders no invierten pipeline expandido.');
    assert.equal(await page.locator('#crm [data-pc-toggle-stages]').count(), 1, 'No duplica toggle de pipeline.');
    assert.equal(await page.locator('#crm .mvp-lead-more-filters > summary').count(), 1, 'No duplica summary de filtros.');
    assert.equal(await page.locator('#crm [data-pc-apply-filters]').count(), 1, 'No duplica Aplicar filtros.');
    assert.equal(await page.locator('#crm [data-pc-clear-filters]').count(), 1, 'No duplica Limpiar filtros.');

    await pipeline.click();
    await page.waitForFunction(() => document.querySelector('#crm [data-pc-toggle-stages]')?.getAttribute('aria-expanded') === 'false');
    assert.ok((await visibleStages(page)).includes('Calificado'), 'Etapa secundaria seleccionada permanece visible al colapsar.');

    await clearSecondaryFilters(page);
    assert.equal(await page.locator('#mvp-lead-stage-filter').inputValue(), 'Todas');
    assert.equal(await page.locator('#mvp-lead-order').inputValue(), 'recent');

    await summary.click();
    await waitForDetailsOpen(page, true);
    await page.locator('#mvp-lead-order').evaluate((select) => { (select as HTMLSelectElement).value = 'name'; });
    await page.locator('#mvp-lead-stage-filter').selectOption('Calificado');
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('#mvp-lead-order')?.value === 'name');
    assert.equal(await page.locator('#mvp-lead-order').inputValue(), 'name', 'DOM real autorizado domina el modelo viejo al rerender de etapa.');
    assert.equal(await page.locator('#mvp-lead-stage-filter').inputValue(), 'Calificado');
    assert.deepEqual(await visibleLeadNames(page), ['Carla Calificada', 'Zoe Calificada'], 'El rerender conserva conjunto y orden comercial del DOM real.');
    assert.equal((await assertSummaryMatchesControls(page)).count, 1, 'N se deriva sólo de filtros comerciales reales tras el rerender.');

    assert.deepEqual(await currentCommercialData(page), expectedCommercialData, 'Filtrar no modifica etapa, temperatura, follow-up ni datos comerciales persistidos.');
    assert.deepEqual(externalWrites, [], `Los tests no producen escrituras externas reales: ${JSON.stringify(externalWrites)}`);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('PRE-B1.4.3A móvil <=520: preserva matriz PR142, CTA, filtros, pipeline, prioridades, bottom nav y overflow', { timeout: 180_000 }, async () => {
  const port = 62480 + Math.floor(Math.random() * 40);
  const server = await startServer(port);
  const browser = await launchChromium();
  const context = await createContext(browser, 390, 844, true);
  const externalWrites: Array<{ method: string; url: string }> = [];

  try {
    const page = await context.newPage();
    page.on('request', (request) => {
      const method = request.method();
      const url = request.url();
      if (/^(POST|PUT|PATCH|DELETE)$/i.test(method) && !url.startsWith(`http://127.0.0.1:${port}`)) externalWrites.push({ method, url });
    });
    await load(page, `http://127.0.0.1:${port}`);

    for (const width of MOBILE_MATRIX) {
      await page.setViewportSize({ width, height: width <= 360 ? 800 : 844 });
      await page.waitForTimeout(120);
      assert.equal(await noDocumentOverflow(page), true, `PR142 sin overflow documental @${width}.`);
      assert.equal((await filterSummary(page)).open, false, `Filtros móviles cerrados por defecto @${width}.`);
      assert.equal((await page.locator('#crm .mvp-zero-primary').first().textContent())?.trim(), 'WhatsApp', `CTA WhatsApp @${width}.`);
      assert.equal(await page.locator('#crm [data-pc-attention]').count(), 4, `Cuatro prioridades @${width}.`);
      assert.equal(await page.locator('#crm [data-pc-toggle-stages]').isVisible(), true, `Toggle pipeline móvil @${width}.`);
      assert.deepEqual(await visibleStages(page), ['Todas', 'Nuevo', 'Contactado', 'Visita coordinada'], `Pipeline principal compacto PR142 @${width}.`);
      const bottomLabels = await page.locator('.mobile-bottom-nav [data-mobile-module] .nav-label').allTextContents();
      assert.deepEqual(bottomLabels.map((value) => value.trim()), ['Leads', 'Chats', 'Agenda', 'Propiedades', 'Equipo'], `Bottom nav aprobado @${width}.`);
      assert.match(await page.locator('#crm [data-toggle="client-form"]').evaluate((button) => button.parentElement?.className ?? ''), /mvp-page-heading/, `No heredar placement desktop @${width}.`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const summary = page.locator('#crm .mvp-lead-more-filters > summary');
    await summary.click();
    await waitForDetailsOpen(page, true);
    await summary.click();
    await waitForDetailsOpen(page, false);

    const pipeline = page.locator('#crm [data-pc-toggle-stages]');
    await pipeline.click();
    await page.waitForFunction(() => document.querySelector('#crm [data-pc-toggle-stages]')?.getAttribute('aria-expanded') === 'true');
    assert.equal((await visibleStages(page)).length, 9, 'Pipeline móvil expandido muestra nueve etapas.');
    await pipeline.click();
    await page.waitForFunction(() => document.querySelector('#crm [data-pc-toggle-stages]')?.getAttribute('aria-expanded') === 'false');
    assert.deepEqual(await visibleStages(page), ['Todas', 'Nuevo', 'Contactado', 'Visita coordinada']);
    assert.deepEqual(externalWrites, [], `Matriz móvil no produce escrituras externas: ${JSON.stringify(externalWrites)}`);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('PRE-B1.4.3A franjas 521/720/900/901 y desktop-mobile-desktop fijan la semántica efectiva actual', { timeout: 180_000 }, async () => {
  const port = 62520 + Math.floor(Math.random() * 40);
  const server = await startServer(port);
  const browser = await launchChromium();
  const context = await createContext(browser, 1366, 768, false);

  try {
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);

    const snapshots: Array<Record<string, unknown>> = [];
    for (const width of RISK_MATRIX) {
      await page.setViewportSize({ width, height: 820 });
      await page.waitForTimeout(220);
      const snapshot = await page.evaluate(() => {
        const details = document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters');
        const toggle = document.querySelector<HTMLElement>('#crm [data-pc-toggle-stages]');
        const visible = (element: HTMLElement): boolean => !element.hidden && getComputedStyle(element).display !== 'none' && element.getClientRects().length > 0;
        const stageButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#crm .mvp-stage-counter'));
        return {
          width: innerWidth,
          detailsOpen: details?.open ?? false,
          toggleVisible: toggle ? visible(toggle) : false,
          toggleText: toggle?.textContent?.trim() ?? '',
          expanded: document.querySelector<HTMLElement>('#crm .pc-stage-summary')?.dataset.expanded ?? '',
          visibleStages: stageButtons.filter(visible).map((button) => button.dataset.stageQuick ?? ''),
          visibleSecondary: stageButtons.filter((button) => button.hasAttribute('data-pc-secondary-stage') && visible(button)).map((button) => button.dataset.stageQuick ?? ''),
        };
      });
      snapshots.push(snapshot);
      assert.equal(await noDocumentOverflow(page), true, `Sin overflow documental @${width}.`);
    }

    const byWidth = new Map(snapshots.map((snapshot) => [Number(snapshot.width), snapshot]));
    assert.deepEqual(byWidth.get(521), {
      width: 521,
      detailsOpen: false,
      toggleVisible: true,
      toggleText: 'Ver todas las etapas',
      expanded: 'false',
      visibleStages: ['Todas', 'Nuevo', 'Contactado', 'Visita coordinada', 'Calificado', 'Negociación', 'Reservado', 'Ganado', 'Perdido'],
      visibleSecondary: ['Calificado', 'Negociación', 'Reservado', 'Ganado', 'Perdido'],
    }, '521px: ownership <=720 cierra filtros; cascada histórica deja secundarias visibles.');
    assert.deepEqual(byWidth.get(720), {
      width: 720,
      detailsOpen: false,
      toggleVisible: true,
      toggleText: 'Ver todas las etapas',
      expanded: 'false',
      visibleStages: ['Todas', 'Nuevo', 'Contactado', 'Visita coordinada', 'Calificado', 'Negociación', 'Reservado', 'Ganado', 'Perdido'],
      visibleSecondary: ['Calificado', 'Negociación', 'Reservado', 'Ganado', 'Perdido'],
    }, '720px conserva la semántica <=720 efectiva.');
    assert.deepEqual(byWidth.get(900), {
      width: 900,
      detailsOpen: true,
      toggleVisible: false,
      toggleText: 'Ver todas las etapas',
      expanded: 'false',
      visibleStages: ['Todas', 'Nuevo', 'Contactado', 'Calificado', 'Visita coordinada', 'Negociación', 'Reservado', 'Ganado', 'Perdido'],
      visibleSecondary: ['Calificado', 'Negociación', 'Reservado', 'Ganado', 'Perdido'],
    }, '900px documenta la franja intermedia: filtros forzados abiertos y toggle oculto.');
    assert.deepEqual(byWidth.get(901), {
      width: 901,
      detailsOpen: false,
      toggleVisible: true,
      toggleText: 'Ver todas las etapas',
      expanded: 'false',
      visibleStages: ['Todas', 'Nuevo', 'Contactado', 'Visita coordinada'],
      visibleSecondary: [],
    }, '901px entra al ownership desktop PR143: filtros cerrados y pipeline compacto.');
    console.log(`PRE_B1_4_3A_RISK_MATRIX=${JSON.stringify(snapshots)}`);

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(220);
    const initialDesktopControls = await secondaryControls(page);
    if (initialDesktopControls.count > 0) await clearSecondaryFilters(page);
    const summary = page.locator('#crm .mvp-lead-more-filters > summary');
    await summary.click();
    await waitForDetailsOpen(page, true);
    await page.locator('#mvp-lead-stage-filter').selectOption('Calificado');
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter')?.value === 'Calificado');
    const openAfterRiskStageChange = (await filterSummary(page)).open;
    console.log(`PRE_B1_4_3A_OPEN_AFTER_RISK_STAGE_CHANGE=${openAfterRiskStageChange}`);
    assert.equal((await assertSummaryMatchesControls(page)).count, 1, 'La etapa activa produce N=1 después de limpiar el resto.');
    assert.ok((await visibleStages(page)).includes('Calificado'));
    if ((await filterSummary(page)).open) {
      await summary.click();
      await waitForDetailsOpen(page, false);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(240);
    assert.equal((await filterSummary(page)).open, false, 'Desktop→mobile no autoabre filtros activos.');
    assert.equal(await page.locator('#mvp-lead-stage-filter').inputValue(), 'Calificado');
    assert.ok((await visibleStages(page)).includes('Calificado'), 'Mobile conserva visible la secundaria seleccionada.');
    assert.equal(await noDocumentOverflow(page), true);

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(240);
    assert.equal((await filterSummary(page)).open, false, 'Mobile→desktop vuelve con disclosure coherente cerrado.');
    assert.equal((await assertSummaryMatchesControls(page)).count, 1);
    assert.equal(await page.locator('#mvp-lead-stage-filter').inputValue(), 'Calificado');
    assert.ok((await visibleStages(page)).includes('Calificado'), 'Desktop recupera la secundaria seleccionada.');
    assert.equal(await page.locator('#crm [data-pc-toggle-stages]').count(), 1);
    assert.equal(await page.locator('#crm .mvp-lead-more-filters > summary').count(), 1);
    assert.equal(await noDocumentOverflow(page), true);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
