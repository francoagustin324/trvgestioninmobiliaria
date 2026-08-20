import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'post-b1-4-2-hotfix-owner';
const ORG_ID = 'post-b1-4-2-hotfix-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const HIDDEN_MESSAGE = 'Este lead está oculto por los filtros actuales. Ajustá o limpiá los filtros para verlo.';

function owner(): TeamMember {
  return {
    id: 1,
    userId: USER_ID,
    name: 'Franco Hotfix',
    email: 'franco.hotfix@propcontrol.test',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-08-19T12:00:00.000Z',
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Hotfix Leads UX' };
  crm.teamMembers = [owner()];
  crm.activityLog = [];
  crm.clients = [
    {
      id: 501,
      name: 'Lead Atención Uno',
      phone: '+54 9 351 500-0501',
      email: 'uno@ejemplo.com',
      interest: 'Dúplex en Docta',
      budget: 'USD 120000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Caliente',
      pipeline: 'Contactado',
      nextAction: 'Hacer seguimiento',
      nextFollowUp: '2020-01-01',
      assignedToId: 1,
      createdById: 1,
    },
    {
      id: 502,
      name: 'Lead Atención Dos',
      phone: '+54 9 351 500-0502',
      email: 'dos@ejemplo.com',
      interest: 'Departamento en General Paz',
      budget: 'USD 90000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Tibio',
      pipeline: 'Nuevo',
      assignedToId: 1,
      createdById: 1,
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
      // retry while local test server starts
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
      userId: 'post-b1-4-2-hotfix-owner',
      email: 'franco.hotfix@propcontrol.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(crm));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-08-19T18:00:00.000Z',
      lastCloudSavedAt: '2026-08-19T18:00:00.000Z',
      lastCloudVersion: '2026-08-19T18:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
    localStorage.setItem(identityStorageKey, JSON.stringify({
      version: 1,
      organizationId: 'post-b1-4-2-hotfix-org',
      memberId: 1,
      actorKey: 'cloud:post-b1-4-2-hotfix-owner',
      humanName: 'Franco Hotfix',
      confirmedAt: '2026-08-19T18:00:00.000Z',
    }));
  }, { crm: fixture(), identityStorageKey: identityKey, storageKey: STORAGE_KEY });
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('#crm .pc-supervised-attention-item[data-attention-client-id]', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('#crm .mvp-stage-counter[data-stage-quick="Todas"]', { state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(250);
}

async function telemetrySnapshot(page: Page): Promise<Array<[string, string | null]>> {
  return page.evaluate(() => {
    const items: Array<[string, string | null]> = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.includes('supervised-recommendation')) items.push([key, localStorage.getItem(key)]);
    }
    return items.sort(([left], [right]) => left.localeCompare(right));
  });
}

async function targetClientId(page: Page): Promise<number> {
  const value = await page.locator('#crm .pc-supervised-attention-item[data-attention-client-id]').first().getAttribute('data-attention-client-id');
  const clientId = Number(value || 0);
  assert.ok(clientId > 0, `clientId inválido: ${value}`);
  return clientId;
}

async function assertOpened(page: Page, clientId: number): Promise<void> {
  await page.waitForFunction((id) => {
    const card = document.querySelector<HTMLElement>(`.mvp-lead-card[data-client-id="${id}"]`);
    const details = card?.querySelector<HTMLDetailsElement>(`details[data-lead-full-sheet="${id}"]`);
    return Boolean(card && details?.open && card.classList.contains('pc-attention-focus-target') && document.activeElement === card);
  }, clientId, { timeout: 5_000 });
}

async function activeStageMetrics(page: Page): Promise<{ display: string; alignItems: string; background: string; centerDelta: number }> {
  return page.locator('#crm .mvp-stage-counter[data-stage-quick="Todas"]').evaluate((element) => {
    const count = element.querySelector<HTMLElement>('b');
    if (!count) throw new Error('Contador de Todos ausente.');
    const buttonRect = element.getBoundingClientRect();
    const countRect = count.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      display: style.display,
      alignItems: style.alignItems,
      background: style.backgroundColor,
      centerDelta: Math.abs((buttonRect.top + buttonRect.height / 2) - (countRect.top + countRect.height / 2)),
    };
  });
}

async function createContext(browser: Browser, viewport: { width: number; height: number }, mobile: boolean): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport,
    screen: viewport,
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    colorScheme: 'dark',
  });
  await seedContext(context);
  return context;
}

test('hotfix UX Leads: ATENDER AHORA abre ficha por click/teclado sin mutar CRM/telemetría y Todos queda centrado', { timeout: 150_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible.');
  const port = 62600 + Math.floor(Math.random() * 150);
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const url = `http://127.0.0.1:${port}`;

  try {
    const desktop = await createContext(browser, { width: 1366, height: 768 }, false);
    const page = await desktop.newPage();
    await load(page, url);

    const stageMetrics = await activeStageMetrics(page);
    assert.equal(stageMetrics.display, 'flex');
    assert.equal(stageMetrics.alignItems, 'center');
    assert.notEqual(stageMetrics.background, 'rgb(110, 90, 36)', 'Todos no debe conservar el fondo amarillo fuerte.');
    assert.ok(stageMetrics.centerDelta <= 1.5, `Contador de Todos descentrado ${stageMetrics.centerDelta}px.`);

    const clientId = await targetClientId(page);
    const queueButton = page.locator(`#crm .pc-supervised-attention-item[data-attention-client-id="${clientId}"]`).first();
    assert.equal(await queueButton.evaluate((element) => element.tagName), 'BUTTON');
    assert.equal(await queueButton.getAttribute('type'), 'button');
    assert.match(await queueButton.getAttribute('aria-label') || '', /Abrir ficha completa/);

    const crmBeforeClick = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    const telemetryBeforeClick = await telemetrySnapshot(page);
    await queueButton.click();
    await assertOpened(page, clientId);
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), crmBeforeClick, 'Abrir ficha desde ATENDER AHORA no debe persistir cambios CRM.');
    assert.deepEqual(await telemetrySnapshot(page), telemetryBeforeClick, 'Abrir ficha no debe crear ni modificar telemetría B1.4.2.');

    await page.evaluate((id) => {
      const card = document.querySelector<HTMLElement>(`.mvp-lead-card[data-client-id="${id}"]`);
      const details = card?.querySelector<HTMLDetailsElement>(`details[data-lead-full-sheet="${id}"]`);
      if (details) details.open = false;
      card?.classList.remove('pc-attention-focus-target');
    }, clientId);
    await queueButton.focus();
    await page.keyboard.press('Enter');
    await assertOpened(page, clientId);

    await page.evaluate((id) => {
      const card = document.querySelector<HTMLElement>(`.mvp-lead-card[data-client-id="${id}"]`);
      const details = card?.querySelector<HTMLDetailsElement>(`details[data-lead-full-sheet="${id}"]`);
      if (details) details.open = false;
    }, clientId);
    const search = page.locator('#mvp-lead-search');
    await search.fill('__lead_oculto_por_filtro__');
    await page.waitForFunction((id) => {
      const card = document.querySelector<HTMLElement>(`.mvp-lead-card[data-client-id="${id}"]`);
      return Boolean(!card || card.hidden || getComputedStyle(card).display === 'none' || card.getClientRects().length === 0);
    }, clientId);
    const filtersBeforeHiddenOpen = await page.evaluate(() => ({
      search: document.querySelector<HTMLInputElement>('#mvp-lead-search')?.value,
      stage: document.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter')?.value,
      temperature: document.querySelector<HTMLSelectElement>('#mvp-lead-temperature-filter')?.value,
      assignee: document.querySelector<HTMLSelectElement>('#mvp-lead-assignee-filter')?.value,
      order: document.querySelector<HTMLSelectElement>('#mvp-lead-order')?.value,
    }));
    await page.locator(`#crm .pc-supervised-attention-item[data-attention-client-id="${clientId}"]`).first().click();
    await page.waitForFunction((message) => document.querySelector('[data-attention-navigation-status]')?.textContent?.trim() === message, HIDDEN_MESSAGE);
    const filtersAfterHiddenOpen = await page.evaluate(() => ({
      search: document.querySelector<HTMLInputElement>('#mvp-lead-search')?.value,
      stage: document.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter')?.value,
      temperature: document.querySelector<HTMLSelectElement>('#mvp-lead-temperature-filter')?.value,
      assignee: document.querySelector<HTMLSelectElement>('#mvp-lead-assignee-filter')?.value,
      order: document.querySelector<HTMLSelectElement>('#mvp-lead-order')?.value,
    }));
    assert.deepEqual(filtersAfterHiddenOpen, filtersBeforeHiddenOpen, 'ATENDER AHORA no debe alterar filtros para revelar un lead oculto.');
    assert.equal(filtersAfterHiddenOpen.order, 'recent');

    await search.fill('');
    await page.locator('#crm .mvp-stage-counter[data-stage-quick="Nuevo"]').click();
    assert.equal(await page.locator('#mvp-lead-stage-filter').inputValue(), 'Nuevo');
    await page.locator('#crm .mvp-stage-counter[data-stage-quick="Todas"]').click();
    assert.equal(await page.locator('#mvp-lead-stage-filter').inputValue(), 'Todas');
    assert.equal(await page.locator('#mvp-lead-order').inputValue(), 'recent');
    await desktop.close();

    const mobile = await createContext(browser, { width: 390, height: 844 }, true);
    const mobilePage = await mobile.newPage();
    await load(mobilePage, url);
    const mobileMetrics = await activeStageMetrics(mobilePage);
    assert.equal(mobileMetrics.display, 'flex');
    assert.equal(mobileMetrics.alignItems, 'center');
    assert.notEqual(mobileMetrics.background, 'rgb(110, 90, 36)');
    assert.ok(mobileMetrics.centerDelta <= 1.5, `Todos mobile descentrado ${mobileMetrics.centerDelta}px.`);
    const mobileButton = mobilePage.locator('#crm .pc-supervised-attention-item[data-attention-client-id]').first();
    assert.ok((await mobileButton.evaluate((element) => element.getBoundingClientRect().height)) >= 44, 'ATENDER AHORA debe conservar target táctil de 44px en mobile.');
    const mobileClientId = await targetClientId(mobilePage);
    await mobileButton.click();
    await assertOpened(mobilePage, mobileClientId);
    const noOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    assert.equal(noOverflow, true, 'El hotfix no debe introducir overflow horizontal mobile.');
    await mobile.close();
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
