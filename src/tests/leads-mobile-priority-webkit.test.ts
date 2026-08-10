import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import test from 'node:test';
import { chromium, webkit, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';
import { prioritizeActionableMobileAttention } from '../leads-mobile-priority-ux.js';

const USER_ID = 'priority-webkit-owner';
const ORG_ID = 'priority-webkit-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const WEBKIT_CAPTURE_DIR = 'artifacts/leads-mobile-webkit-validation';
const PRIORITY_MODULE_URL = '/dist/leads-mobile-priority-ux.js?v=20260809-1';

function owner(): TeamMember {
  return {
    id: 1,
    userId: USER_ID,
    name: 'Franco Solis',
    email: 'franco@propcontrol.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-09T12:00:00.000Z',
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Priority/WebKit validation' };
  crm.teamMembers = [owner()];
  crm.activityLog = [];
  crm.clients = [{
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
  }];
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
      userId: 'priority-webkit-owner',
      email: 'franco@propcontrol.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(crm));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-08-09T18:00:00.000Z',
      lastCloudSavedAt: '2026-08-09T18:00:00.000Z',
      lastCloudVersion: '2026-08-09T18:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
    localStorage.setItem(identityStorageKey, JSON.stringify({
      version: 1,
      organizationId: 'priority-webkit-org',
      memberId: 1,
      actorKey: 'cloud:priority-webkit-owner',
      humanName: 'Franco Solis',
      confirmedAt: '2026-08-09T18:00:00.000Z',
    }));
  }, { crm: fixture(), identityStorageKey: identityKey, storageKey: STORAGE_KEY });
}

async function chromiumAndroidContext(browser: Browser, width: number): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    screen: { width, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; moto g54 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
  });
  await seedContext(context);
  return context;
}

async function webkitContext(browser: Browser, width: number): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    screen: { width, height: 844 },
    hasTouch: true,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
  });
  await seedContext(context);
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.pc-attention-section', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.mvp-lead-card[data-client-id="1"] .mvp-zero-primary', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => {
    const visible = Array.from(document.querySelectorAll<HTMLElement>('#crm [data-pc-attention]'))
      .filter((node) => getComputedStyle(node).display !== 'none');
    return visible.length === 1 && visible[0]?.dataset.pcAttention === 'new-uncontacted';
  });
}

async function setPriorityCounts(page: Page, counts: Record<string, number>): Promise<void> {
  await page.evaluate(async ({ moduleUrl, values }) => {
    document.querySelectorAll<HTMLButtonElement>('#crm [data-pc-attention]').forEach((button) => {
      const count = button.querySelector<HTMLElement>('b');
      const id = button.dataset.pcAttention ?? '';
      if (count && Object.prototype.hasOwnProperty.call(values, id)) count.textContent = String(values[id]);
    });
    const module = await import(moduleUrl);
    module.applyMobilePriorityOrder(document);
  }, { moduleUrl: PRIORITY_MODULE_URL, values: counts });
}

function visiblePrioritySnapshotScript() {
  const grid = document.querySelector<HTMLElement>('#crm .pc-attention-grid');
  const heading = document.querySelector<HTMLElement>('#crm [data-pc-attention-section] .pc-section-heading > div > span');
  if (!grid) throw new Error('Prioridades móviles ausentes.');
  return {
    viewport: innerWidth,
    gridLeft: grid.getBoundingClientRect().left,
    gridRight: grid.getBoundingClientRect().right,
    gridScrollLeft: grid.scrollLeft,
    gridScrollWidth: grid.scrollWidth,
    gridClientWidth: grid.clientWidth,
    heading: heading?.textContent?.trim() ?? '',
    clear: grid.querySelector<HTMLElement>('[data-pc-attention-clear]')?.textContent?.trim() ?? '',
    visible: Array.from(grid.querySelectorAll<HTMLButtonElement>('[data-pc-attention]'))
      .filter((button) => getComputedStyle(button).display !== 'none')
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          id: button.dataset.pcAttention ?? '',
          count: Number(button.querySelector('b')?.textContent ?? '0'),
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        };
      }),
  };
}

test('prioridades móviles representan 1, varias y ninguna prioridad accionable sin hardcodear la fixture', () => {
  const one = prioritizeActionableMobileAttention([
    { id: 'overdue' as const, count: 0 },
    { id: 'missing-action' as const, count: 0 },
    { id: 'new-uncontacted' as const, count: 1 },
    { id: 'today' as const, count: 0 },
  ]);
  assert.deepEqual(one, [{ id: 'new-uncontacted', count: 1 }]);

  const several = prioritizeActionableMobileAttention([
    { id: 'missing-action' as const, count: 4 },
    { id: 'new-uncontacted' as const, count: 2 },
    { id: 'today' as const, count: 3 },
    { id: 'overdue' as const, count: 1 },
  ]);
  assert.deepEqual(several.map((item) => item.id), ['overdue', 'today', 'new-uncontacted', 'missing-action']);

  const none = prioritizeActionableMobileAttention([
    { id: 'overdue' as const, count: 0 },
    { id: 'missing-action' as const, count: 0 },
    { id: 'new-uncontacted' as const, count: 0 },
    { id: 'today' as const, count: 0 },
  ]);
  assert.deepEqual(none, []);
});

test('Chromium: prioridad accionable queda visible sin swipe y los estados múltiples/cero son compactos', { timeout: 90_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible.');
  const port = 62020 + Math.floor(Math.random() * 80);
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await chromiumAndroidContext(browser, 390);

  try {
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);

    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: width === 320 ? 800 : 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(100);
      const snapshot = await page.evaluate(visiblePrioritySnapshotScript);
      assert.deepEqual(snapshot.visible.map((item) => [item.id, item.count]), [['new-uncontacted', 1]], `prioridad inicial @${width}`);
      assert.equal(snapshot.gridScrollLeft, 0, `no debe requerir swipe inicial @${width}`);
      assert.ok(snapshot.visible[0]!.left >= snapshot.gridLeft - 1 && snapshot.visible[0]!.right <= Math.min(snapshot.gridRight, snapshot.viewport) + 1, `prioridad accionable fuera de vista @${width}: ${JSON.stringify(snapshot)}`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await setPriorityCounts(page, { overdue: 2, today: 1, 'new-uncontacted': 0, 'missing-action': 0 });
    const two = await page.evaluate(visiblePrioritySnapshotScript);
    assert.deepEqual(two.visible.map((item) => item.id), ['overdue', 'today']);
    assert.ok(two.visible.every((item) => item.left >= two.gridLeft - 1 && item.right <= two.gridRight + 1 && item.width >= 44 && item.height >= 44), `dos prioridades deben quedar visibles: ${JSON.stringify(two)}`);

    await setPriorityCounts(page, { overdue: 0, today: 0, 'new-uncontacted': 0, 'missing-action': 0 });
    const zero = await page.evaluate(visiblePrioritySnapshotScript);
    assert.deepEqual(zero.visible, []);
    assert.equal(zero.clear, 'Sin pendientes');

    await page.setViewportSize({ width: 320, height: 800 });
    await setPriorityCounts(page, { overdue: 1, today: 1, 'new-uncontacted': 1, 'missing-action': 1 });
    const overflow = await page.evaluate(visiblePrioritySnapshotScript);
    assert.deepEqual(overflow.visible.map((item) => item.id), ['overdue', 'today', 'new-uncontacted', 'missing-action']);
    assert.ok(overflow.gridScrollWidth > overflow.gridClientWidth + 1, `cuatro prioridades deben desbordar la fila compacta: ${JSON.stringify(overflow)}`);
    assert.match(overflow.heading, /Más →/);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('WebKit automatizado: Leads móvil mantiene prioridad, CTA, pipeline y geometría en 375/390/430', { timeout: 120_000 }, async () => {
  const port = 62120 + Math.floor(Math.random() * 80);
  const server = await startServer(port);
  const browser = await webkit.launch({ headless: true });
  rmSync(WEBKIT_CAPTURE_DIR, { recursive: true, force: true });
  mkdirSync(WEBKIT_CAPTURE_DIR, { recursive: true });

  try {
    for (const width of [375, 390, 430]) {
      const context = await webkitContext(browser, width);
      try {
        const page = await context.newPage();
        await load(page, `http://127.0.0.1:${port}`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(100);

        const snapshot = await page.evaluate(() => {
          const crm = document.querySelector<HTMLElement>('#crm');
          const search = document.querySelector<HTMLInputElement>('#crm #mvp-lead-search');
          const filters = document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters');
          const priorities = document.querySelector<HTMLElement>('#crm .pc-attention-grid');
          const priority = priorities?.querySelector<HTMLButtonElement>('[data-pc-attention="new-uncontacted"]');
          const stageShell = document.querySelector<HTMLElement>('#crm .pc-stage-summary[data-expanded="false"]');
          const actions = document.querySelector<HTMLElement>('#crm .mvp-lead-quick-actions[data-zero-training-actions="true"]');
          const whatsapp = document.querySelector<HTMLElement>('#crm .mvp-zero-primary.mvp-whatsapp-contact-button');
          const heading = document.querySelector<HTMLElement>('#crm .pc-leads-heading');
          const card = document.querySelector<HTMLElement>('#crm .mvp-lead-card[data-client-id="1"]');
          if (!crm || !search || !filters || !priorities || !priority || !stageShell || !actions || !whatsapp || !heading || !card) {
            throw new Error('Faltan elementos para validación WebKit.');
          }

          const crmRect = crm.getBoundingClientRect();
          const searchRect = search.getBoundingClientRect();
          const priorityRect = priority.getBoundingClientRect();
          const headingRect = heading.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          const visiblePriorities = Array.from(priorities.querySelectorAll<HTMLButtonElement>('[data-pc-attention]'))
            .filter((button) => getComputedStyle(button).display !== 'none')
            .map((button) => ({ id: button.dataset.pcAttention ?? '', count: Number(button.querySelector('b')?.textContent ?? '0') }));
          const actionBoxes = Array.from(actions.querySelectorAll<HTMLElement>(':scope > button, :scope > details > summary')).map((node) => {
            const rect = node.getBoundingClientRect();
            return { text: node.textContent?.trim() ?? '', left: rect.left, right: rect.right, width: rect.width, height: rect.height };
          });
          const visibleStages = Array.from(stageShell.querySelectorAll<HTMLElement>('[data-stage-quick]'))
            .filter((node) => getComputedStyle(node).display !== 'none')
            .map((node) => ({ id: node.dataset.stageQuick ?? '', width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, secondary: node.hasAttribute('data-pc-secondary-stage') }));
          return {
            viewport: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            crmWidth: crm.scrollWidth,
            crmClientWidth: crm.clientWidth,
            crmLeft: crmRect.left,
            crmRight: crmRect.right,
            placeholder: search.placeholder,
            searchLeft: searchRect.left,
            searchRight: searchRect.right,
            searchHeight: searchRect.height,
            filtersOpen: filters.open,
            visiblePriorities,
            priorityLeft: priorityRect.left,
            priorityRight: priorityRect.right,
            priorityWidth: priorityRect.width,
            priorityHeight: priorityRect.height,
            priorityScrollLeft: priorities.scrollLeft,
            stageExpanded: stageShell.dataset.expanded,
            visibleStages,
            whatsappText: whatsapp.textContent?.trim() ?? '',
            whatsappBefore: getComputedStyle(whatsapp, '::before').content,
            whatsappAfter: getComputedStyle(whatsapp, '::after').content,
            actionBoxes,
            topRegionHeight: cardRect.top - headingRect.top,
          };
        });

        assert.ok(snapshot.documentWidth <= snapshot.viewport + 1, `WebKit document overflow @${width}: ${JSON.stringify(snapshot)}`);
        assert.ok(snapshot.bodyWidth <= snapshot.viewport + 1, `WebKit body overflow @${width}: ${JSON.stringify(snapshot)}`);
        assert.ok(snapshot.crmWidth <= snapshot.crmClientWidth + 1, `WebKit CRM overflow @${width}: ${JSON.stringify(snapshot)}`);
        assert.ok(snapshot.crmLeft >= -1 && snapshot.crmRight <= snapshot.viewport + 1, `WebKit CRM fuera del viewport @${width}`);
        assert.equal(snapshot.placeholder, 'Buscar por nombre, WhatsApp o interés');
        assert.ok(snapshot.searchLeft >= 0 && snapshot.searchRight <= snapshot.viewport + 1 && snapshot.searchHeight >= 44, `WebKit buscador @${width}: ${JSON.stringify(snapshot)}`);
        assert.equal(snapshot.filtersOpen, false, `WebKit filtros cerrados @${width}`);
        assert.deepEqual(snapshot.visiblePriorities, [{ id: 'new-uncontacted', count: 1 }], `WebKit prioridad accionable @${width}`);
        assert.equal(snapshot.priorityScrollLeft, 0, `WebKit prioridad sin swipe @${width}`);
        assert.ok(snapshot.priorityLeft >= 0 && snapshot.priorityRight <= snapshot.viewport + 1 && snapshot.priorityWidth >= 44 && snapshot.priorityHeight >= 44, `WebKit prioridad visible @${width}`);
        assert.equal(snapshot.stageExpanded, 'false');
        assert.ok(snapshot.visibleStages.length > 0 && snapshot.visibleStages.every((stage) => !stage.secondary && stage.width >= 44 && stage.height >= 44), `WebKit pipeline collapsed @${width}: ${JSON.stringify(snapshot.visibleStages)}`);
        assert.equal(snapshot.whatsappText, 'WhatsApp');
        assert.equal(snapshot.whatsappBefore, 'none');
        assert.equal(snapshot.whatsappAfter, 'none');
        assert.deepEqual(snapshot.actionBoxes.map((box) => box.text), ['WhatsApp', 'Editar', '•••']);
        assert.ok(snapshot.actionBoxes.every((box) => box.left >= 0 && box.right <= snapshot.viewport + 1 && box.width >= 44 && box.height >= 44), `WebKit acciones @${width}: ${JSON.stringify(snapshot.actionBoxes)}`);
        assert.ok(snapshot.topRegionHeight <= 430, `WebKit primer lead demasiado abajo @${width}: ${snapshot.topRegionHeight}`);

        await page.screenshot({ path: `${WEBKIT_CAPTURE_DIR}/webkit-${width}-top-leads.png`, fullPage: false });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
