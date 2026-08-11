import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import test from 'node:test';
import { chromium, webkit, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'desktop-zero-training-owner';
const ORG_ID = 'desktop-zero-training-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const BASELINE_DISTANCE = 504.13;
const TARGET_1366_DISTANCE = BASELINE_DISTANCE * 0.8;
const CHROMIUM_ARTIFACT_DIR = 'artifacts/leads-desktop-zero-training';
const WEBKIT_ARTIFACT_DIR = 'artifacts/leads-desktop-zero-training-webkit';
const DESKTOP_VIEWPORTS = [
  { width: 1024, height: 768, screenshot: 'desktop-1024-top-leads.png' },
  { width: 1280, height: 720, screenshot: 'desktop-1280-top-leads.png' },
  { width: 1366, height: 768, screenshot: 'desktop-1366-top-leads.png' },
  { width: 1440, height: 900, screenshot: 'desktop-1440-top-leads.png' },
  { width: 1920, height: 1080, screenshot: 'desktop-1920-top-leads.png' },
] as const;

function owner(): TeamMember {
  return {
    id: 1,
    userId: USER_ID,
    name: 'Franco Solis',
    email: 'franco@propcontrol.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-11T12:00:00.000Z',
  };
}

function secondMember(): TeamMember {
  return {
    id: 2,
    userId: 'desktop-zero-training-member-2',
    name: 'Agente Demo',
    email: 'agente@propcontrol.test',
    phone: '5493515110070',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-11T12:00:00.000Z',
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Desktop PR143' };
  crm.teamMembers = [owner(), secondMember()];
  crm.activityLog = [];
  crm.clients = [
    {
      id: 1,
      name: 'Lucía Martín',
      phone: '+54 9 351 511-0069',
      email: 'lucia@ejemplo.com',
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
      name: 'Martín Pérez',
      phone: '+54 9 351 511-0071',
      email: 'martin@ejemplo.com',
      interest: 'Departamento en General Paz',
      budget: 'USD 90000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Caliente',
      pipeline: 'Contactado',
      assignedToId: 2,
      createdById: 1,
      nextAction: 'Confirmar visita',
      nextFollowUp: '2026-08-11',
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
  throw new Error('Servidor de prueba no disponible.');
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
      userId: 'desktop-zero-training-owner',
      email: 'franco@propcontrol.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(crm));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-08-11T18:00:00.000Z',
      lastCloudSavedAt: '2026-08-11T18:00:00.000Z',
      lastCloudVersion: '2026-08-11T18:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
    localStorage.setItem(identityStorageKey, JSON.stringify({
      version: 1,
      organizationId: 'desktop-zero-training-org',
      memberId: 1,
      actorKey: 'cloud:desktop-zero-training-owner',
      humanName: 'Franco Solis',
      confirmedAt: '2026-08-11T18:00:00.000Z',
    }));
  }, { crm: fixture(), identityStorageKey: identityKey, storageKey: STORAGE_KEY });
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.mvp-lead-card[data-client-id="1"]', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.mvp-zero-primary', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => {
    const details = document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters');
    const toggle = document.querySelector<HTMLButtonElement>('#crm [data-pc-toggle-stages]');
    return Boolean(details && toggle && !toggle.hidden);
  });
  await page.waitForTimeout(120);
}

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    return html.scrollWidth <= html.clientWidth + 1 && body.scrollWidth <= body.clientWidth + 1;
  });
}

async function firstLeadDistance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const crm = document.querySelector<HTMLElement>('#crm');
    const card = document.querySelector<HTMLElement>('#crm .mvp-lead-card[data-client-id="1"]');
    if (!crm || !card) throw new Error('No se pudo medir Leads.');
    return Math.round((card.getBoundingClientRect().top - crm.getBoundingClientRect().top) * 100) / 100;
  });
}

async function visibleStages(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLButtonElement>('#crm .mvp-stage-counter'))
    .filter((button) => getComputedStyle(button).display !== 'none' && button.getClientRects().length > 0)
    .map((button) => button.dataset.stageQuick ?? ''));
}

async function minimumControlHeight(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element) => element.getBoundingClientRect().height);
}

function resetArtifactDirectory(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
}

test('PR143 desktop cero capacitación Chromium + regresión móvil', { timeout: 180_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible.');
  resetArtifactDirectory(CHROMIUM_ARTIFACT_DIR);
  const port = 62200 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    screen: { width: 1366, height: 768 },
    isMobile: false,
    hasTouch: false,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
  });
  await seedContext(context);

  try {
    const page = await context.newPage();
    const url = `http://127.0.0.1:${port}`;
    await load(page, url);

    const heading = page.locator('#crm .pc-leads-heading');
    assert.equal((await heading.locator('h1').textContent())?.trim(), 'Leads');
    assert.equal((await heading.locator('p').textContent())?.trim(), 'Contactá primero a los leads que requieren atención.');
    const newLead = heading.locator('[data-toggle="client-form"]');
    assert.equal(await newLead.isVisible(), true, 'Nuevo lead debe estar visible en cabecera desktop.');
    assert.ok(await minimumControlHeight(page, '#crm .pc-leads-heading [data-toggle="client-form"]') >= 42);

    const search = page.locator('#mvp-lead-search');
    assert.equal(await search.isVisible(), true, 'Buscador siempre visible.');
    assert.equal(await search.getAttribute('placeholder'), 'Buscar por nombre, WhatsApp o interés');

    const details = page.locator('#crm .mvp-lead-more-filters');
    assert.equal(await details.getAttribute('open'), null, 'Filtros secundarios cerrados por defecto en desktop.');
    const filterSummary = details.locator(':scope > summary');
    assert.equal((await filterSummary.locator('span').textContent())?.trim(), 'Filtros');
    assert.ok(await minimumControlHeight(page, '#crm .mvp-lead-more-filters > summary') >= 42);

    await filterSummary.click();
    assert.equal(await details.getAttribute('open'), '', 'Filtros deben abrirse manualmente.');
    for (const selector of ['#mvp-lead-stage-filter', '#mvp-lead-temperature-filter', '#mvp-lead-assignee-filter', '#mvp-lead-order']) {
      const control = page.locator(selector);
      assert.equal(await control.isVisible(), true, `${selector} debe estar accesible.`);
      assert.ok(await minimumControlHeight(page, selector) >= 42, `${selector} debe conservar target usable.`);
    }
    assert.equal(await page.locator('[data-pc-clear-filters]').isVisible(), true);
    assert.equal(await page.locator('[data-pc-apply-filters]').isVisible(), true);

    await page.locator('#mvp-lead-stage-filter').selectOption('Calificado');
    await page.waitForFunction(() => document.querySelector('#crm .mvp-lead-more-filters > summary span')?.textContent?.includes('Filtros (1)'));
    assert.equal(await page.locator('#crm .mvp-lead-more-filters').getAttribute('open'), '', 'Un filtro activo debe quedar identificable.');
    assert.match((await page.locator('#crm .mvp-lead-more-filters > summary span').textContent()) ?? '', /Filtros \([1-9]/);

    const priorities = page.locator('#crm [data-pc-attention]');
    assert.equal(await priorities.count(), 4, 'Deben conservarse las cuatro prioridades canónicas.');
    const priorityLabels = await priorities.locator('span').allTextContents();
    for (const expected of ['Seguimientos vencidos', 'Seguimientos para hoy', 'Nuevos sin contactar', 'Sin próxima acción']) {
      assert.ok(priorityLabels.includes(expected), `Falta prioridad ${expected}.`);
    }
    const priorityStates = await priorities.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-pc-actionable')));
    assert.ok(priorityStates.every((value) => value === 'true' || value === 'false'));

    const collapsedWithSecondary = await visibleStages(page);
    for (const expected of ['Todas', 'Nuevo', 'Contactado', 'Visita coordinada', 'Calificado']) {
      assert.ok(collapsedWithSecondary.includes(expected), `La etapa ${expected} debe permanecer visible.`);
    }
    assert.ok(collapsedWithSecondary.length <= 5, 'Pipeline colapsado no debe mostrar todas las etapas.');

    const pipelineToggle = page.locator('#crm [data-pc-toggle-stages]');
    assert.equal(await pipelineToggle.isVisible(), true);
    assert.equal((await pipelineToggle.textContent())?.trim(), 'Ver todas las etapas');
    assert.ok(await minimumControlHeight(page, '#crm [data-pc-toggle-stages]') >= 42);
    const collapsedScroll = await page.locator('#crm .mvp-stage-counters').evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
    assert.ok(collapsedScroll.scrollWidth <= collapsedScroll.clientWidth + 1, 'Pipeline colapsado no debe tener scrollbar horizontal.');

    await pipelineToggle.click();
    await page.waitForFunction(() => document.querySelector('#crm [data-pc-toggle-stages]')?.textContent?.includes('Ver menos etapas'));
    const expandedStages = await visibleStages(page);
    assert.equal(expandedStages.length, 9, 'Pipeline expandido debe exponer todas las etapas.');
    assert.equal((await pipelineToggle.textContent())?.trim(), 'Ver menos etapas');

    await page.locator('[data-pc-clear-filters]').click();
    await page.waitForFunction(() => document.querySelector('#crm .mvp-lead-more-filters > summary span')?.textContent?.trim() === 'Filtros');
    assert.equal(await page.locator('#mvp-lead-stage-filter').inputValue(), 'Todas');
    assert.equal(await page.locator('#crm .mvp-lead-more-filters').getAttribute('open'), null, 'Limpiar debe devolver disclosure limpio.');

    if ((await pipelineToggle.getAttribute('aria-expanded')) === 'true') await pipelineToggle.click();
    await page.waitForTimeout(80);
    const collapsedStages = await visibleStages(page);
    assert.deepEqual(collapsedStages, ['Todas', 'Nuevo', 'Contactado', 'Visita coordinada']);

    const firstStage = page.locator('#crm .mvp-stage-counter').filter({ hasText: 'Todos' }).first();
    await firstStage.focus();
    await page.keyboard.press('End');
    const focusedAfterEnd = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-stage-quick'));
    assert.equal(focusedAfterEnd, 'Visita coordinada', 'End debe recorrer sólo etapas visibles.');
    await page.keyboard.press('ArrowLeft');
    const focusedAfterLeft = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-stage-quick'));
    assert.equal(focusedAfterLeft, 'Contactado', 'Flecha izquierda debe recorrer sólo etapas visibles.');

    const whatsapp = page.locator('#crm .mvp-zero-primary').first();
    assert.equal((await whatsapp.textContent())?.trim(), 'WhatsApp');
    const whatsappVisual = await whatsapp.evaluate((button) => ({
      background: getComputedStyle(button).backgroundColor,
      before: getComputedStyle(button, '::before').content,
      after: getComputedStyle(button, '::after').content,
      height: button.getBoundingClientRect().height,
    }));
    assert.equal(whatsappVisual.background, 'rgb(27, 112, 69)', 'CTA desktop debe usar verde sobrio aprobado.');
    assert.ok(['none', 'normal', '""'].includes(whatsappVisual.before));
    assert.ok(['none', 'normal', '""'].includes(whatsappVisual.after));
    assert.ok(whatsappVisual.height >= 42);
    assert.equal(await page.locator('#crm .mvp-zero-edit').first().isVisible(), true);
    assert.equal(await page.locator('#crm .mvp-lead-actions-menu > summary').first().isVisible(), true);

    for (const viewport of DESKTOP_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(100);
      assert.equal(await noHorizontalOverflow(page), true, `Sin overflow horizontal en ${viewport.width}.`);
      const distance = await firstLeadDistance(page);
      console.log(`PR143_AFTER_${viewport.width}x${viewport.height}=${distance}`);
      if (viewport.width === 1366) {
        assert.ok(distance <= TARGET_1366_DISTANCE + 0.5, `1366 debe reducir al menos 20%: ${distance} <= ${TARGET_1366_DISTANCE}.`);
      }
      if (viewport.width === 1024) {
        const top = await page.locator('#crm .mvp-lead-card').first().evaluate((card) => card.getBoundingClientRect().top);
        assert.ok(top < viewport.height - 80, 'A 1024 debe verse claramente el comienzo del primer lead.');
      }
      await page.screenshot({ path: `${CHROMIUM_ARTIFACT_DIR}/${viewport.screenshot}`, fullPage: false });
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(100);
    await page.locator('#crm .mvp-lead-more-filters > summary').click();
    await page.screenshot({ path: `${CHROMIUM_ARTIFACT_DIR}/desktop-1366-filters-open.png`, fullPage: false });
    await page.locator('#crm .mvp-lead-more-filters > summary').click();
    if ((await pipelineToggle.getAttribute('aria-expanded')) !== 'true') await pipelineToggle.click();
    await page.waitForTimeout(80);
    await page.screenshot({ path: `${CHROMIUM_ARTIFACT_DIR}/desktop-1366-pipeline-expanded.png`, fullPage: false });
    await page.locator('#crm .mvp-lead-card').first().screenshot({ path: `${CHROMIUM_ARTIFACT_DIR}/desktop-1366-first-lead-cta.png` });

    const expandedBeforeRerenders = await pipelineToggle.getAttribute('aria-expanded');
    await page.evaluate(() => {
      for (let index = 0; index < 10; index += 1) document.dispatchEvent(new CustomEvent('trv-render'));
    });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#crm [data-pc-toggle-stages]').count(), 1, 'Diez rerenders no duplican toggle de pipeline.');
    assert.equal(await page.locator('#crm .pc-leads-heading [data-toggle="client-form"]').count(), 1, 'Diez rerenders no duplican Nuevo lead.');
    await pipelineToggle.click();
    await page.waitForTimeout(80);
    assert.notEqual(await pipelineToggle.getAttribute('aria-expanded'), expandedBeforeRerenders, 'Un click debe producir un solo cambio de estado.');

    if ((await pipelineToggle.getAttribute('aria-expanded')) === 'true') await pipelineToggle.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(180);
    assert.equal(await noHorizontalOverflow(page), true, 'PR143 no debe introducir overflow móvil.');
    assert.equal(await page.locator('#mvp-lead-search').getAttribute('placeholder'), 'Buscar por nombre, WhatsApp o interés');
    assert.equal(await page.locator('#crm .mvp-lead-more-filters').getAttribute('open'), null, 'Filtros móvil aprobado sigue cerrado.');
    assert.equal((await page.locator('#crm .mvp-zero-primary').first().textContent())?.trim(), 'WhatsApp');
    const mobilePseudo = await page.locator('#crm .mvp-zero-primary').first().evaluate((button) => ({
      before: getComputedStyle(button, '::before').content,
      after: getComputedStyle(button, '::after').content,
    }));
    assert.ok(['none', 'normal', '""'].includes(mobilePseudo.before));
    assert.ok(['none', 'normal', '""'].includes(mobilePseudo.after));
    const mobileLabels = await page.locator('.mobile-bottom-nav [data-mobile-module] .nav-label').allTextContents();
    assert.deepEqual(mobileLabels.map((label) => label.trim()), ['Leads', 'Chats', 'Agenda', 'Propiedades', 'Equipo']);
    await page.screenshot({ path: `${CHROMIUM_ARTIFACT_DIR}/mobile-390-regression.png`, fullPage: false });

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(160);
    assert.equal(await page.locator('#crm .pc-leads-heading [data-toggle="client-form"]').count(), 1, 'Desktop→mobile→desktop conserva DOM sano.');
    assert.equal(await page.locator('#crm [data-pc-toggle-stages]').count(), 1, 'Desktop→mobile→desktop conserva pipeline único.');
    assert.equal(await noHorizontalOverflow(page), true);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('PR143 WebKit desktop 1280/1440', { timeout: 120_000 }, async () => {
  resetArtifactDirectory(WEBKIT_ARTIFACT_DIR);
  const port = 62320 + Math.floor(Math.random() * 80);
  const server = await startServer(port);
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    screen: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
  });
  await seedContext(context);

  try {
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);
    for (const viewport of [
      { width: 1280, height: 800, screenshot: 'webkit-desktop-1280.png' },
      { width: 1440, height: 900, screenshot: 'webkit-desktop-1440.png' },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(120);
      assert.equal(await noHorizontalOverflow(page), true, `WebKit ${viewport.width} sin overflow.`);
      assert.equal(await page.locator('#crm .mvp-lead-more-filters').getAttribute('open'), null);
      assert.equal(await page.locator('#crm [data-pc-toggle-stages]').isVisible(), true);
      assert.deepEqual(await visibleStages(page), ['Todas', 'Nuevo', 'Contactado', 'Visita coordinada']);
      assert.equal((await page.locator('#crm .mvp-zero-primary').first().textContent())?.trim(), 'WhatsApp');
      assert.ok(await firstLeadDistance(page) < BASELINE_DISTANCE, 'Primer lead debe subir también en WebKit.');
      await page.locator('#crm .mvp-lead-more-filters > summary').click();
      assert.equal(await page.locator('#mvp-lead-stage-filter').isVisible(), true);
      await page.locator('#crm .mvp-lead-more-filters > summary').click();
      await page.screenshot({ path: `${WEBKIT_ARTIFACT_DIR}/${viewport.screenshot}`, fullPage: false });
    }
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('PR143 cache bust: todo runtime modificado cambia URL servida', () => {
  const index = readFileSync('index.html', 'utf8');
  assert.match(index, /\/src\/leads-desktop-zero-training\.css\?v=20260811-1/);
  assert.match(index, /\/dist\/mvp-main\.js\?v=20260811-1/);
  assert.doesNotMatch(index, /\/dist\/mvp-main\.js\?v=20260802-1/);
});
