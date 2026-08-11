import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'mobile-real-validation-owner';
const ORG_ID = 'mobile-real-validation-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const VIEWPORTS = [320, 360, 375, 390, 412, 430, 520] as const;
const TOP_CAPTURE_WIDTHS = new Set([320, 390, 430, 520]);
const CAPTURE_DIR = 'artifacts/leads-mobile-real-validation';

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
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Mobile validation' };
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
      userId: 'mobile-real-validation-owner',
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
      organizationId: 'mobile-real-validation-org',
      memberId: 1,
      actorKey: 'cloud:mobile-real-validation-owner',
      humanName: 'Franco Solis',
      confirmedAt: '2026-08-09T18:00:00.000Z',
    }));
  }, { crm: fixture(), identityStorageKey: identityKey, storageKey: STORAGE_KEY });
}

async function mobileContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
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

async function desktopContext(browser: Browser): Promise<BrowserContext> {
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
  return context;
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.pc-leads-heading', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.pc-attention-section', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.mvp-lead-card[data-client-id="1"] .mvp-zero-primary', { state: 'visible', timeout: 20_000 });
}

async function waitForStageSelection(page: Page, stage: string): Promise<void> {
  await page.waitForFunction((requestedStage) => {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('#crm [data-stage-quick]'));
    const button = buttons.find((candidate) => candidate.dataset.stageQuick === requestedStage);
    return Boolean(button && (button.classList.contains('active') || button.getAttribute('aria-pressed') === 'true'));
  }, stage);
}

async function waitForPipelineExpanded(page: Page, expanded: boolean): Promise<void> {
  await page.waitForFunction((expected) => {
    return document.querySelector<HTMLElement>('#crm .pc-stage-summary')?.dataset.expanded === String(expected);
  }, expanded);
}

test('postproducción móvil usa una hoja final nueva y cache-busteada', () => {
  const html = readFileSync('index.html', 'utf8');
  const css = readFileSync('src/leads-mobile-real-validation.css', 'utf8');
  assert.ok(html.includes('/src/leads-mobile-real-validation.css?v=20260809-2'));
  assert.ok(html.indexOf('leads-mobile-real-validation.css') > html.indexOf('leads-zero-training-safety.css'));
  assert.match(css, /mvp-zero-primary::before/);
  assert.match(css, /mvp-zero-primary::after/);
  assert.match(css, /content:\s*none\s*!important/);
  assert.match(css, /@media \(max-width: 520px\)/);
});

test('Chrome Android equivalente: CTA, cabecera y pipeline resisten la matriz móvil real', { timeout: 180_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible.');
  const port = 61900 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await mobileContext(browser);
  rmSync(CAPTURE_DIR, { recursive: true, force: true });
  mkdirSync(CAPTURE_DIR, { recursive: true });

  try {
    const page = await context.newPage();
    await load(page, `http://127.0.0.1:${port}`);

    assert.equal(fixture().clients[0]?.pipeline, 'Nuevo');

    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: width <= 360 ? 800 : 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(80);

      const snapshot = await page.evaluate(() => {
        const button = document.querySelector<HTMLElement>('#crm .mvp-zero-primary.mvp-whatsapp-contact-button');
        const actions = document.querySelector<HTMLElement>('#crm .mvp-lead-quick-actions[data-zero-training-actions="true"]');
        const heading = document.querySelector<HTMLElement>('#crm .pc-leads-heading');
        const card = document.querySelector<HTMLElement>('#crm .mvp-lead-card[data-client-id="1"]');
        const count = document.querySelector<HTMLElement>('#crm #mvp-lead-count');
        const priorities = document.querySelector<HTMLElement>('#crm .pc-attention-grid');
        const stageShell = document.querySelector<HTMLElement>('#crm .pc-stage-summary[data-expanded="false"]');
        const stages = stageShell?.querySelector<HTMLElement>('.mvp-stage-counters');
        const filters = document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters');
        const crm = document.querySelector<HTMLElement>('#crm');
        if (!button || !actions || !heading || !card || !count || !priorities || !stageShell || !stages || !filters || !crm) {
          throw new Error('Faltan elementos de Leads para validar.');
        }

        const buttonStyle = getComputedStyle(button);
        const before = getComputedStyle(button, '::before');
        const after = getComputedStyle(button, '::after');
        const actionBoxes = Array.from(actions.querySelectorAll<HTMLElement>(':scope > button, :scope > details > summary')).map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height,
            clientWidth: node.clientWidth,
            scrollWidth: node.scrollWidth,
            text: node.textContent?.trim() || '',
          };
        });
        const headingRect = heading.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const crmRect = crm.getBoundingClientRect();
        const countRect = count.getBoundingClientRect();
        const prioritiesRect = priorities.getBoundingClientRect();
        const stagesRect = stages.getBoundingClientRect();
        const visibleSecondaryStages = Array.from(stages.querySelectorAll<HTMLElement>('[data-pc-secondary-stage]'))
          .filter((node) => getComputedStyle(node).display !== 'none')
          .map((node) => node.dataset.stageQuick || '');
        const selectedStageNode = stages.querySelector<HTMLElement>('.active, [aria-pressed="true"]');

        return {
          viewport: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          crmWidth: crm.scrollWidth,
          crmClientWidth: crm.clientWidth,
          crmLeft: crmRect.left,
          crmRight: crmRect.right,
          text: button.textContent?.trim() || '',
          before: before.content,
          after: after.content,
          background: buttonStyle.backgroundColor,
          color: buttonStyle.color,
          actionBoxes,
          topRegionHeight: cardRect.top - headingRect.top,
          countHeight: countRect.height,
          prioritiesHeight: prioritiesRect.height,
          stagesHeight: stagesRect.height,
          stagesScrollHeight: stages.scrollHeight,
          stagesClientHeight: stages.clientHeight,
          filtersOpen: filters.open,
          visibleSecondaryStages,
          selectedStage: selectedStageNode?.dataset.stageQuick || '',
          selectedIsSecondary: selectedStageNode?.hasAttribute('data-pc-secondary-stage') ?? false,
        };
      });

      assert.equal(snapshot.text, 'WhatsApp', `texto CTA @${width}`);
      assert.equal(snapshot.before, 'none', `::before CTA @${width}`);
      assert.equal(snapshot.after, 'none', `::after CTA @${width}`);
      assert.equal(snapshot.background, 'rgb(27, 112, 69)', `verde CTA @${width}`);
      assert.equal(snapshot.color, 'rgb(247, 255, 249)', `contraste CTA @${width}`);
      assert.ok(snapshot.documentWidth <= snapshot.viewport + 1, `document overflow @${width}: ${JSON.stringify(snapshot)}`);
      assert.ok(snapshot.bodyWidth <= snapshot.viewport + 1, `body overflow @${width}: ${JSON.stringify(snapshot)}`);
      assert.ok(snapshot.crmWidth <= snapshot.crmClientWidth + 1, `CRM overflow @${width}: ${JSON.stringify(snapshot)}`);
      assert.ok(snapshot.crmLeft >= -1 && snapshot.crmRight <= snapshot.viewport + 1, `CRM fuera del viewport @${width}: ${JSON.stringify(snapshot)}`);
      assert.deepEqual(snapshot.actionBoxes.map((box) => box.text), ['WhatsApp', 'Editar', '•••'], `acciones @${width}`);
      assert.ok(snapshot.actionBoxes.every((box) => box.left >= 0 && box.right <= snapshot.viewport + 1 && box.width >= 44 && box.height >= 44), `geometría acciones @${width}: ${JSON.stringify(snapshot.actionBoxes)}`);
      assert.ok(snapshot.actionBoxes.every((box) => box.scrollWidth <= box.clientWidth + 1), `texto cortado @${width}: ${JSON.stringify(snapshot.actionBoxes)}`);
      assert.equal(snapshot.filtersOpen, false, `filtros cerrados por defecto @${width}`);
      assert.ok(snapshot.countHeight <= 28, `contador demasiado alto @${width}: ${snapshot.countHeight}`);
      assert.ok(snapshot.prioritiesHeight <= 48, `prioridades demasiado altas @${width}: ${snapshot.prioritiesHeight}`);
      assert.ok(snapshot.stagesHeight <= 48, `pipeline colapsado demasiado alto @${width}: ${snapshot.stagesHeight}`);
      assert.ok(snapshot.stagesScrollHeight <= snapshot.stagesClientHeight + 1, `pipeline colapsado envuelve filas @${width}: ${JSON.stringify(snapshot)}`);
      assert.deepEqual(snapshot.visibleSecondaryStages, [], `pipeline principal no debe mostrar etapas secundarias @${width}`);
      assert.ok(snapshot.selectedStage.length > 0, `debe existir una etapa principal seleccionada @${width}`);
      assert.equal(snapshot.selectedIsSecondary, false, `la carga inicial no debe seleccionar una etapa secundaria @${width}`);
      assert.ok(snapshot.topRegionHeight <= 430, `primer lead demasiado abajo @${width}: ${snapshot.topRegionHeight}`);

      if (TOP_CAPTURE_WIDTHS.has(width)) {
        await page.screenshot({ path: `${CAPTURE_DIR}/mobile-${width}-top-leads.png`, fullPage: false });
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#crm .mvp-lead-card[data-client-id="1"]').screenshot({
      path: `${CAPTURE_DIR}/mobile-390-first-lead-cta.png`,
    });
    await page.locator('#crm .pc-stage-summary[data-expanded="false"]').screenshot({
      path: `${CAPTURE_DIR}/mobile-390-pipeline-collapsed.png`,
    });

    const toggle = page.locator('#crm [data-pc-toggle-stages]');
    await toggle.click();
    await waitForPipelineExpanded(page, true);

    const expandedSnapshot = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('#crm .pc-stage-summary[data-expanded="true"]');
      const counters = shell?.querySelector<HTMLElement>('.mvp-stage-counters');
      if (!shell || !counters) throw new Error('Pipeline expandido ausente.');
      const secondary = Array.from(counters.querySelectorAll<HTMLElement>('[data-pc-secondary-stage]'));
      const visibleSecondary = secondary.filter((node) => getComputedStyle(node).display !== 'none');
      const targetBoxes = Array.from(counters.querySelectorAll<HTMLElement>('[data-stage-quick]'))
        .filter((node) => getComputedStyle(node).display !== 'none')
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        });
      return {
        totalSecondary: secondary.length,
        visibleSecondary: visibleSecondary.length,
        countersClientWidth: counters.clientWidth,
        countersScrollWidth: counters.scrollWidth,
        documentWidth: document.documentElement.scrollWidth,
        viewport: innerWidth,
        targetBoxes,
      };
    });
    assert.ok(expandedSnapshot.totalSecondary > 0, 'el DOM debe marcar etapas secundarias canónicas');
    assert.equal(expandedSnapshot.visibleSecondary, expandedSnapshot.totalSecondary, 'expandido debe mostrar todas las etapas secundarias');
    assert.ok(expandedSnapshot.targetBoxes.every((box) => box.width >= 44 && box.height >= 44), `targets pipeline expandido: ${JSON.stringify(expandedSnapshot.targetBoxes)}`);
    assert.ok(expandedSnapshot.countersScrollWidth <= expandedSnapshot.countersClientWidth + 1, `pipeline expandido con overflow horizontal: ${JSON.stringify(expandedSnapshot)}`);
    assert.ok(expandedSnapshot.documentWidth <= expandedSnapshot.viewport + 1, `document overflow con pipeline expandido: ${JSON.stringify(expandedSnapshot)}`);
    await page.locator('#crm .pc-stage-summary[data-expanded="true"]').screenshot({
      path: `${CAPTURE_DIR}/mobile-390-pipeline-expanded.png`,
    });

    const canonicalSecondary = page.locator('#crm [data-pc-secondary-stage]').first();
    const secondaryStage = await canonicalSecondary.getAttribute('data-stage-quick');
    assert.ok(secondaryStage, 'la etapa secundaria canónica debe declarar data-stage-quick');
    await canonicalSecondary.click();
    await waitForStageSelection(page, secondaryStage);
    await toggle.click();
    await waitForPipelineExpanded(page, false);

    const selectedSecondaryCollapsed = await page.evaluate(() => {
      const stages = document.querySelector<HTMLElement>('#crm .pc-stage-summary[data-expanded="false"] .mvp-stage-counters');
      if (!stages) throw new Error('Pipeline colapsado ausente tras seleccionar secundario.');
      return Array.from(stages.querySelectorAll<HTMLElement>('[data-pc-secondary-stage]'))
        .filter((node) => getComputedStyle(node).display !== 'none')
        .map((node) => ({
          stage: node.dataset.stageQuick || '',
          selected: node.classList.contains('active') || node.getAttribute('aria-pressed') === 'true',
        }));
    });
    assert.deepEqual(selectedSecondaryCollapsed, [{ stage: secondaryStage, selected: true }], 'colapsado debe conservar sólo la etapa secundaria seleccionada');

    const desktop = await desktopContext(browser);
    try {
      const desktopPage = await desktop.newPage();
      await load(desktopPage, `http://127.0.0.1:${port}`);
      const desktopWidth = await desktopPage.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      assert.ok(desktopWidth.document <= desktopWidth.viewport + 1, `desktop document overflow: ${JSON.stringify(desktopWidth)}`);
      assert.ok(desktopWidth.body <= desktopWidth.viewport + 1, `desktop body overflow: ${JSON.stringify(desktopWidth)}`);
      await desktopPage.screenshot({ path: `${CAPTURE_DIR}/desktop-control.png`, fullPage: false });
    } finally {
      await desktop.close();
    }
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});