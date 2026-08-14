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
const CONTROL_TARGET = 44;
const CONTROL_EPSILON = 0.01;
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
    return Boolean(details && !details.open && toggle && !toggle.hidden);
  }, undefined, { timeout: 20_000 });
  await page.waitForTimeout(120);
}

async function waitForFilterPanelVisible(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const details = document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters');
    const stage = document.querySelector<HTMLElement>('#mvp-lead-stage-filter');
    const clear = document.querySelector<HTMLElement>('[data-pc-clear-filters]');
    const apply = document.querySelector<HTMLElement>('[data-pc-apply-filters]');
    const visible = (element: HTMLElement | null): boolean => Boolean(element && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden' && element.getClientRects().length > 0);
    return Boolean(details?.open && visible(stage) && visible(clear) && visible(apply));
  }, undefined, { timeout: 5_000 });
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
    const cards = Array.from(document.querySelectorAll<HTMLElement>('#crm .mvp-lead-card'))
      .filter((card) => !card.hidden && getComputedStyle(card).display !== 'none' && card.getClientRects().length > 0);
    if (!crm || cards.length === 0) throw new Error('No se pudo medir el primer Lead visible.');
    const firstTop = Math.min(...cards.map((card) => card.getBoundingClientRect().top));
    return Math.round((firstTop - crm.getBoundingClientRect().top) * 100) / 100;
  });
}

async function activeSecondaryFilterSnapshot(page: Page): Promise<{ count: number; label: string }> {
  return page.evaluate(() => {
    const crm = document.querySelector<HTMLElement>('#crm');
    const label = crm?.querySelector<HTMLElement>('.mvp-lead-more-filters > summary span')?.textContent?.trim() ?? '';
    if (!crm) return { count: 0, label };
    let count = 0;
    const stage = crm.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter')?.value;
    const temperature = crm.querySelector<HTMLSelectElement>('#mvp-lead-temperature-filter')?.value;
    const assignee = crm.querySelector<HTMLSelectElement>('#mvp-lead-assignee-filter')?.value;
    const order = crm.querySelector<HTMLSelectElement>('#mvp-lead-order')?.value;
    if (stage && stage !== 'Todas') count += 1;
    if (temperature && temperature !== 'Todas') count += 1;
    if (assignee && assignee !== 'Todos') count += 1;
    if (order && order !== 'priority') count += 1;
    if (crm.querySelector<HTMLInputElement>('#mvp-lead-overdue-filter')?.checked) count += 1;
    if (crm.querySelector<HTMLInputElement>('#mvp-lead-missing-action-filter')?.checked) count += 1;
    return { count, label };
  });
}

async function visibleStages(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLButtonElement>('#crm .mvp-stage-counter'))
    .filter((button) => getComputedStyle(button).display !== 'none' && button.getClientRects().length > 0)
    .map((button) => button.dataset.stageQuick ?? ''));
}

async function minimumControlHeight(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((element) => element.getBoundingClientRect().height);
}

async function assertControlTarget(page: Page, selector: string, label = selector): Promise<void> {
  const height = await minimumControlHeight(page, selector);
  assert.ok(height >= CONTROL_TARGET - CONTROL_EPSILON, `${label} debe medir al menos 44px nominales; recibió ${height}.`);
}

async function assertDesktopNewLeadPlacement(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>('#crm .pc-leads-heading');
    const button = document.querySelector<HTMLElement>('#crm [data-toggle="client-form"]');
    if (!heading || !button) throw new Error('Cabecera o Nuevo lead ausente.');
    const headingRect = heading.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      parent: button.parentElement?.className ?? '',
      headingTop: headingRect.top,
      headingBottom: headingRect.bottom,
      headingRight: headingRect.right,
      buttonTop: buttonRect.top,
      buttonBottom: buttonRect.bottom,
      buttonRight: buttonRect.right,
    };
  });
  assert.match(result.parent, /mvp-lead-filter-primary/, 'Se conserva el contrato DOM histórico desktop.');
  assert.ok(result.buttonTop >= result.headingTop - 3, JSON.stringify(result));
  assert.ok(result.buttonBottom <= result.headingBottom + 3, JSON.stringify(result));
  assert.ok(Math.abs(result.headingRight - result.buttonRight) <= 3, JSON.stringify(result));
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
    const newLead = page.locator('#crm [data-toggle="client-form"]').first();
    assert.equal(await newLead.isVisible(), true, 'Nuevo lead debe estar visible en cabecera desktop.');
    await assertControlTarget(page, '#crm [data-toggle="client-form"]', 'Nuevo lead');
    await assertDesktopNewLeadPlacement(page);

    const search = page.locator('#mvp-lead-search');
    assert.equal(await search.isVisible(), true, 'Buscador siempre visible.');
    assert.equal(await search.getAttribute('placeholder'), 'Buscar por nombre, WhatsApp o interés');

    const details = page.locator('#crm .mvp-lead-more-filters');
    assert.equal(await details.getAttribute('open'), null, 'Filtros secundarios cerrados por defecto en desktop.');
    const filterSummary = details.locator(':scope > summary');
    const initialFilters = await activeSecondaryFilterSnapshot(page);
    assert.equal(initialFilters.label, initialFilters.count > 0 ? `Filtros (${initialFilters.count})` : 'Filtros', `El resumen cerrado debe reflejar exactamente los filtros activos: ${JSON.stringify(initialFilters)}`);
    console.log(`PR143_INITIAL_FILTERS=${JSON.stringify(initialFilters)}`);
    await assertControlTarget(page, '#crm .mvp-lead-more-filters > summary', 'Summary Filtros');

    await filterSummary.click();
    await waitForFilterPanelVisible(page);
    for (const selector of ['#mvp-lead-stage-filter', '#mvp-lead-temperature-filter', '#mvp-lead-assignee-filter', '#mvp-lead-order']) {
      const control = page.locator(selector);
      assert.equal(await control.isVisible(), true, `${selector} debe estar accesible.`);
      await assertControlTarget(page, selector);
    }
    assert.equal(await page.locator('[data-pc-clear-filters]').isVisible(), true, 'Limpiar debe estar visible al abrir Filtros.');
    assert.equal(await page.locator('[data-pc-apply-filters]').isVisible(), true, 'Aplicar filtros debe estar visible al abrir Filtros.');
    await assertControlTarget(page, '[data-pc-clear-filters]', 'Limpiar filtros');
    await assertControlTarget(page, '[data-pc-apply-filters]', 'Aplicar filtros');

    await page.locator('#mvp-lead-stage-filter').selectOption('Calificado');
    await page.waitForFunction(() => document.querySelector('#crm .mvp-lead-more-filters > summary span')?.textContent?.includes('Filtros ('));
    assert.equal(await page.locator('#crm .mvp-lead-more-filters').getAttribute('open'), '', 'Un panel abierto explícitamente debe seguir operativo mientras se edita.');
    const editedFilters = await activeSecondaryFilterSnapshot(page);
    assert.equal(editedFilters.label, `Filtros (${editedFilters.count})`);
    assert.ok(editedFilters.count >= 1);
    await page.locator('[data-pc-apply-filters]').click();
    await page.waitForFunction(() => document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters')?.open === false);
    assert.equal(await page.locator('#mvp-lead-stage-filter').inputValue(), 'Calificado', 'Aplicar no pierde el filtro activo.');
    const appliedFilters = await activeSecondaryFilterSnapshot(page);
    assert.equal(appliedFilters.label, `Filtros (${appliedFilters.count})`);
    assert.ok(appliedFilters.count >= 1);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('trv-render')));
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#crm .mvp-lead-more-filters').getAttribute('open'), null, 'Un rerender con filtros activos no debe autoabrirlos.');
    assert.equal(await page.locator('#mvp-lead-stage-filter').inputValue(), 'Calificado');

    const priorities = page.locator('#crm [data-pc-attention]');
    assert.equal(await priorities.count(), 4, 'Deben conservarse las cuatro prioridades canónicas.');
    const priorityLabels = await priorities.locator('span').allTextContents();
    for (const expected of ['Seguimientos vencidos', 'Seguimientos para hoy', 'Nuevos sin contactar', 'Sin próxima acción']) {
      assert.ok(priorityLabels.includes(expected), `Falta prioridad ${expected}.`);
    }
    const priorityStates = await priorities.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-pc-actionable')));
    assert.ok(priorityStates.every((value) => value === 'true' || value === 'false'));
    for (let index = 0; index < await priorities.count(); index += 1) {
      const height = await priorities.nth(index).evaluate((button) => button.getBoundingClientRect().height);
      assert.ok(height >= CONTROL_TARGET - CONTROL_EPSILON, `Prioridad ${index + 1} menor a 44px: ${height}.`);
    }

    const collapsedWithSecondary = await visibleStages(page);
    for (const expected of ['Todas', 'Nuevo', 'Contactado', 'Visita coordinada', 'Calificado']) {
      assert.ok(collapsedWithSecondary.includes(expected), `La etapa ${expected} debe permanecer visible.`);
    }
    assert.ok(collapsedWithSecondary.length <= 5, 'Pipeline colapsado no debe mostrar todas las etapas.');

    const pipelineToggle = page.locator('#crm [data-pc-toggle-stages]');
    assert.equal(await pipelineToggle.isVisible(), true);
    assert.equal((await pipelineToggle.textContent())?.trim(), 'Ver todas las etapas');
    await assertControlTarget(page, '#crm [data-pc-toggle-stages]', 'Toggle de etapas');
    const collapsedScroll = await page.locator('#crm .mvp-stage-counters').evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
    assert.ok(collapsedScroll.scrollWidth <= collapsedScroll.clientWidth + 1, 'Pipeline colapsado no debe tener scrollbar horizontal.');

    await pipelineToggle.click();
    await page.waitForFunction(() => document.querySelector('#crm [data-pc-toggle-stages]')?.textContent?.includes('Ver menos etapas'));
    const expandedStages = await visibleStages(page);
    assert.equal(expandedStages.length, 9, 'Pipeline expandido debe exponer todas las etapas.');
    assert.equal((await pipelineToggle.textContent())?.trim(), 'Ver menos etapas');

    await filterSummary.click();
    await waitForFilterPanelVisible(page);
    await page.waitForFunction(() => {
      const filterDetails = document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters');
      const stage = document.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter');
      const presentationClear = document.querySelector<HTMLButtonElement>('[data-pc-clear-filters]');
      const coreClear = document.querySelector<HTMLButtonElement>('[data-clear-lead-filters]');
      return Boolean(
        filterDetails?.open
        && stage?.value === 'Calificado'
        && presentationClear?.isConnected
        && coreClear?.isConnected
      );
    });
    await page.locator('[data-pc-clear-filters]').click();
    await page.waitForFunction(() => document.querySelector('#crm .mvp-lead-more-filters > summary span')?.textContent?.trim() === 'Filtros');
    assert.equal(await page.locator('#mvp-lead-stage-filter').inputValue(), 'Todas');
    await page.waitForFunction(() => document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters')?.open === false);

    if ((await pipelineToggle.getAttribute('aria-expanded')) === 'true') await pipelineToggle.click();
    await page.waitForTimeout(100);
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
    assert.ok(whatsappVisual.height >= CONTROL_TARGET - CONTROL_EPSILON, `WhatsApp menor a 44px: ${whatsappVisual.height}.`);
    const edit = page.locator('#crm .mvp-zero-edit').first();
    const menu = page.locator('#crm .mvp-lead-actions-menu > summary').first();
    assert.equal(await edit.isVisible(), true);
    assert.equal(await menu.isVisible(), true);
    assert.ok(await edit.evaluate((button) => button.getBoundingClientRect().height) >= CONTROL_TARGET - CONTROL_EPSILON, 'Editar debe conservar target 44px.');
    assert.ok(await menu.evaluate((button) => button.getBoundingClientRect().height) >= CONTROL_TARGET - CONTROL_EPSILON, 'Menú ••• debe conservar target 44px.');

    for (const viewport of DESKTOP_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(140);
      assert.equal(await noHorizontalOverflow(page), true, `Sin overflow horizontal en ${viewport.width}.`);
      await assertDesktopNewLeadPlacement(page);
      const distance = await firstLeadDistance(page);
      console.log(`PR143_AFTER_${viewport.width}x${viewport.height}=${distance}`);
      if (viewport.width === 1366) {
        assert.ok(distance <= TARGET_1366_DISTANCE + 0.5, `1366 debe reducir al menos 20%: ${distance} <= ${TARGET_1366_DISTANCE}.`);
      }
      if (viewport.width === 1024) {
        const top = await page.locator('#crm .mvp-lead-card:visible').first().evaluate((card) => card.getBoundingClientRect().top);
        assert.ok(top < viewport.height - 80, 'A 1024 debe verse claramente el comienzo del primer lead.');
      }
      await page.screenshot({ path: `${CHROMIUM_ARTIFACT_DIR}/${viewport.screenshot}`, fullPage: false });
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(120);
    await page.locator('#crm .mvp-lead-more-filters > summary').click();
    await waitForFilterPanelVisible(page);
    await page.screenshot({ path: `${CHROMIUM_ARTIFACT_DIR}/desktop-1366-filters-open.png`, fullPage: false });
    await page.locator('#crm .mvp-lead-more-filters > summary').click();
    if ((await pipelineToggle.getAttribute('aria-expanded')) !== 'true') await pipelineToggle.click();
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${CHROMIUM_ARTIFACT_DIR}/desktop-1366-pipeline-expanded.png`, fullPage: false });
    await page.locator('#crm .mvp-lead-card:visible').first().screenshot({ path: `${CHROMIUM_ARTIFACT_DIR}/desktop-1366-first-lead-cta.png` });

    const expandedBeforeRerenders = await pipelineToggle.getAttribute('aria-expanded');
    await page.evaluate(() => {
      for (let index = 0; index < 10; index += 1) document.dispatchEvent(new CustomEvent('trv-render'));
    });
    await page.waitForTimeout(180);
    assert.equal(await page.locator('#crm [data-pc-toggle-stages]').count(), 1, 'Diez rerenders no duplican toggle de pipeline.');
    assert.equal(await page.locator('#crm [data-toggle="client-form"]').count(), 1, 'Diez rerenders no duplican Nuevo lead.');
    await pipelineToggle.click();
    await page.waitForTimeout(100);
    assert.notEqual(await pipelineToggle.getAttribute('aria-expanded'), expandedBeforeRerenders, 'Un click debe producir un solo cambio de estado.');

    if ((await pipelineToggle.getAttribute('aria-expanded')) === 'true') await pipelineToggle.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(220);
    assert.equal(await noHorizontalOverflow(page), true, 'PR143 no debe introducir overflow móvil.');
    assert.equal(await page.locator('#mvp-lead-search').getAttribute('placeholder'), 'Buscar por nombre, WhatsApp o interés');
    assert.equal(await page.locator('#crm .mvp-lead-more-filters').getAttribute('open'), null, 'Filtros móvil aprobado sigue cerrado.');
    assert.equal((await page.locator('#crm .mvp-zero-primary').first().textContent())?.trim(), 'WhatsApp');
    assert.match(await page.locator('#crm [data-toggle="client-form"]').evaluate((button) => button.parentElement?.className ?? ''), /mvp-page-heading/);
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
    await page.waitForTimeout(220);
    assert.equal(await page.locator('#crm [data-toggle="client-form"]').count(), 1, 'Desktop→mobile→desktop conserva DOM sano.');
    assert.match(await page.locator('#crm [data-toggle="client-form"]').evaluate((button) => button.parentElement?.className ?? ''), /mvp-lead-filter-primary/);
    assert.equal(await page.locator('#crm [data-pc-toggle-stages]').count(), 1, 'Desktop→mobile→desktop conserva pipeline único.');
    assert.equal(await noHorizontalOverflow(page), true);
    await assertDesktopNewLeadPlacement(page);
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
      await page.waitForTimeout(160);
      assert.equal(await noHorizontalOverflow(page), true, `WebKit ${viewport.width} sin overflow.`);
      assert.equal(await page.locator('#crm .mvp-lead-more-filters').getAttribute('open'), null);
      assert.equal(await page.locator('#crm [data-pc-toggle-stages]').isVisible(), true);
      assert.deepEqual(await visibleStages(page), ['Todas', 'Nuevo', 'Contactado', 'Visita coordinada']);
      assert.equal((await page.locator('#crm .mvp-zero-primary').first().textContent())?.trim(), 'WhatsApp');
      const distance = await firstLeadDistance(page);
      console.log(`PR143_WEBKIT_AFTER_${viewport.width}x${viewport.height}=${distance}`);
      assert.ok(distance < BASELINE_DISTANCE, `Primer lead debe subir también en WebKit: ${distance} < ${BASELINE_DISTANCE}.`);
      await assertDesktopNewLeadPlacement(page);
      await page.locator('#crm .mvp-lead-more-filters > summary').click();
      await waitForFilterPanelVisible(page);
      assert.equal(await page.locator('#mvp-lead-stage-filter').isVisible(), true, 'Etapa debe estar visible cuando el disclosure está abierto.');
      await assertControlTarget(page, '#mvp-lead-stage-filter', 'Select WebKit');
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
  assert.match(index, /\/dist\/leads-professional-redesign-blocking-fix\.js\?v=20260811-1/);
  assert.doesNotMatch(index, /\/dist\/leads-professional-redesign-blocking-fix\.js\?v=20260805-1/);
  assert.match(index, /\/dist\/leads-professional-redesign\.js\?v=20260811-1/);
  assert.doesNotMatch(index, /\/dist\/leads-professional-redesign\.js\?v=20260805-1/);
  assert.match(index, /\/dist\/mvp-main\.js\?v=20260802-1/);
});