import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData } from '../models.js';
import { tenantFingerprint, tenantStorageNamespace } from '../tenant-storage.js';
import { installA35H5R1ModernTenantHarness } from './a35-h5-r1-modern-tenant-harness.js';

const repositoryRoot = process.cwd();
const userId = 'p1-2-a1-browser-user';
const storageKey = `trv-crm-basico:user:${userId}`;
const tenantReadbackKey = tenantStorageNamespace({ userId, organizationId: 'p1-2-a1-browser-org' }).crmKey;

function browserCrm(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: 'p1-2-a1-browser-org',
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Browser test',
  };
  crm.teamMembers = [{
    id: 1,
    userId,
    name: 'Franco Test',
    email: 'franco@example.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-09-01T10:00:00.000Z',
  }];
  crm.clients = [{
    id: 1,
    uid: '11111111-1111-4111-8111-111111111111',
    revision: 0,
    name: 'Cliente Won Browser',
    phone: '5493515550101',
    email: 'won@example.test',
    interest: 'Departamento General Paz',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Negociación',
    nextAction: 'Confirmar propuesta final',
    nextFollowUp: '2026-09-10',
    budget: 'USD 110.000',
    currency: 'USD',
    paymentMethod: 'Contado',
    purchaseTimeframe: '0-3 meses',
    purpose: 'Vivir',
    knowsArea: 'Sí',
    canMoveForward: 'Sí',
    zones: 'General Paz',
    assignedToId: 1,
    createdById: 1,
  }, {
    id: 2,
    uid: '22222222-2222-4222-8222-222222222222',
    revision: 0,
    name: 'Cliente Lost Browser',
    phone: '5493515550102',
    email: 'lost@example.test',
    interest: 'Casa zona norte',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    nextAction: 'Enviar opciones',
    nextFollowUp: '2026-09-11',
    budget: 'ARS 120.000.000',
    currency: 'ARS',
    paymentMethod: 'Contado',
    purchaseTimeframe: '0-3 meses',
    purpose: 'Vivir',
    knowsArea: 'Sí',
    canMoveForward: 'Sí',
    zones: 'Zona norte',
    assignedToId: 1,
    createdById: 1,
  }];
  crm.properties = [{
    id: 7,
    uid: '77777777-7777-4777-8777-777777777777',
    revision: 0,
    title: 'Departamento General Paz',
    address: 'General Paz, Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 100000,
    owner: 'Propietario test',
    status: 'Activa',
    bedrooms: 2,
    assignedToId: 1,
    createdById: 1,
  }];
  crm.offers = [{
    id: 1,
    clientId: 1,
    propertyId: 7,
    origin: 'Cliente',
    amount: 100000,
    currency: 'USD',
    status: 'Aceptada',
    assignedToId: 1,
    createdById: 1,
    createdAt: '2026-09-02T12:00:00.000Z',
    updatedAt: '2026-09-02T12:00:00.000Z',
  }];
  crm.visits = [];
  crm.reservations = [];
  crm.activityLog = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.settings = {
    ...crm.settings,
    profileName: 'Franco Test',
    profileEmail: 'franco@example.test',
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
}

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find(existsSync);
}

async function waitForServer(baseUrl: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Servidor P1.2-A1 no disponible: ${String(lastError ?? 'sin respuesta')}`);
}

async function startServer(port: number): Promise<ChildProcess> {
  const server = spawn(process.execPath, ['dist/server.js'], {
    cwd: repositoryRoot,
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

async function createContext(browser: Browser, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport, locale: 'es-AR' });
  const data = browserCrm();
  await installA35H5R1ModernTenantHarness(context, data, userId);
  await context.addInitScript(({ crm, accountUserId, accountStorageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'p1-2-a1-browser-token',
      refreshToken: 'p1-2-a1-browser-refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: accountUserId,
      email: 'franco@example.test',
    }));
    localStorage.setItem(accountStorageKey, JSON.stringify(crm));
    localStorage.setItem(`${accountStorageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-09-03T12:00:00.000Z',
      lastCloudSavedAt: '2026-09-03T12:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { crm: data, accountUserId: userId, accountStorageKey: storageKey });
  return context;
}

async function installAuthoritativeSnapshotProbe(context: BrowserContext): Promise<void> {
  await context.addInitScript(({ accountStorageKey }) => {
    type SnapshotProbe = {
      count: number;
      localBefore?: unknown;
      authoritative?: unknown;
    };
    type ProbeWindow = Window & {
      __a35R14SnapshotProbe?: SnapshotProbe;
      __a35R14OriginalCard?: Element | null;
      __a35R14OriginalDetails?: Element | null;
    };

    const probeWindow = window as ProbeWindow;
    probeWindow.__a35R14SnapshotProbe = { count: 0 };
    document.addEventListener('propcontrol-cloud-authoritative-snapshot', (event) => {
      const detail = (event as CustomEvent<{ crm?: unknown }>).detail;
      const raw = localStorage.getItem(accountStorageKey);
      const previous = probeWindow.__a35R14SnapshotProbe?.count ?? 0;
      probeWindow.__a35R14SnapshotProbe = {
        count: previous + 1,
        localBefore: raw ? JSON.parse(raw) : null,
        authoritative: detail?.crm ?? null,
      };
    }, true);
  }, { accountStorageKey: tenantReadbackKey });
}

function fingerprintSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function openApp(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-card[data-client-id="1"]', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => Boolean(document.querySelector('#crm [data-commercial-close-summary]')));
}

async function openEditForm(page: Page, clientId: number): Promise<void> {
  const editButton = page.locator(`.mvp-lead-card[data-client-id="${clientId}"] .mvp-lead-quick-actions[data-zero-training-actions="true"] [data-edit-client="${clientId}"]`);
  await editButton.waitFor({ state: 'visible' });
  await editButton.click();
  await page.waitForSelector('#mvp-lead-form:not(.collapsed)', { state: 'visible' });
}

async function waitForStableInteractiveNode(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(async (target) => {
    const isInteractive = (node: Element | null): node is HTMLElement => {
      if (!(node instanceof HTMLElement) || !node.isConnected) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const disabled = node instanceof HTMLButtonElement && node.disabled;
      return !disabled
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '1') > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const first = document.querySelector(target);
    if (!isInteractive(first)) return false;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const second = document.querySelector(target);
    if (second !== first || !isInteractive(second)) return false;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const third = document.querySelector(target);
    return third === first && isInteractive(third);
  }, selector);
}

async function openLeadDetails(page: Page, clientId: number): Promise<void> {
  const cardSelector = `.mvp-lead-card[data-client-id="${clientId}"]`;
  const sheetSelector = `${cardSelector} [data-lead-full-sheet="${clientId}"]`;
  if ((await page.locator(sheetSelector).getAttribute('open')) !== null) return;

  const actionsSelector = `${cardSelector} .mvp-lead-quick-actions[data-zero-training-actions="true"]`;
  await waitForStableInteractiveNode(page, actionsSelector);

  const summarySelector = `${actionsSelector} .mvp-lead-actions-menu > summary`;
  await page.locator(summarySelector).click();

  const detailsSelector = `${actionsSelector} .mvp-lead-actions-menu[open] [data-open-lead-details="${clientId}"]`;
  await waitForStableInteractiveNode(page, detailsSelector);
  await page.locator(detailsSelector).click();
  await page.waitForFunction((id) => document.querySelector(`[data-lead-full-sheet="${id}"]`)?.hasAttribute('open'), clientId);
}

async function localCrm(page: Page): Promise<CrmData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}') as CrmData, tenantReadbackKey);
}

async function assertDialogContained(page: Page): Promise<void> {
  const metrics = await page.locator('dialog[data-commercial-close-dialog][open]').evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const buttons = [...dialog.querySelectorAll<HTMLElement>('button')].map((button) => button.getBoundingClientRect().height);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: window.innerWidth,
      height: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      minButtonHeight: Math.min(...buttons),
    };
  });
  assert.ok(metrics.left >= -1 && metrics.right <= metrics.width + 1, JSON.stringify(metrics));
  assert.ok(metrics.top >= -1 && metrics.bottom <= metrics.height + 1, JSON.stringify(metrics));
  assert.ok(metrics.documentWidth <= metrics.width + 1, JSON.stringify(metrics));
  assert.ok(metrics.minButtonHeight >= 43.5, JSON.stringify(metrics));
}

test('P1.2-A1 browser: Won desktop, replay visual seguro y reapertura persistente', { timeout: 120_000 }, async (t) => {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chromium para P1.2-A1.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }
  const port = 4317;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  const context = await createContext(browser, { width: 1366, height: 768 });
  const page = await context.newPage();
  try {
    await openApp(page, `http://127.0.0.1:${port}`);
    await openLeadDetails(page, 1);
    const wonAction = page.locator('.mvp-lead-card[data-client-id="1"] [data-close-operation-stage="Ganado"]');
    assert.ok((await wonAction.boundingBox())?.height! >= 43.5);
    await wonAction.click();
    await page.waitForSelector('#mvp-lead-form:not(.collapsed)');
    await page.waitForSelector('dialog[data-commercial-close-dialog][open] [data-commercial-close-modal-form="won"]');
    await assertDialogContained(page);

    assert.equal(await page.locator('dialog [name="dealPropertyId"]').inputValue(), '7');
    await page.locator('dialog [name="dealAmount"]').fill('100000');
    await page.locator('dialog [name="dealCurrency"]').selectOption('USD');
    await page.locator('dialog [name="commissionPercentage"]').fill('3');
    await page.waitForFunction(() => (document.querySelector<HTMLInputElement>('dialog [name="commissionAmount"]')?.value || '') === '3000');
    assert.match(await page.locator('dialog [data-commission-calculated]').textContent() || '', /USD 3\.000/);
    await page.locator('dialog [name="closeNote"]').fill('Cierre browser desktop');
    await page.locator('dialog [data-commercial-close-confirm="Ganado"]').click();

    await page.waitForSelector('.mvp-lead-card[data-client-id="1"].terminal', { state: 'visible' });
    let crm = await localCrm(page);
    let client = crm.clients.find((item) => item.id === 1)!;
    assert.equal(client.outcome, 'won');
    assert.equal(client.dealAmount, 100000);
    assert.equal(client.commissionAmount, 3000);
    assert.equal(client.dealPropertyId, 7);
    assert.equal(client.dealPropertyLabel, 'Departamento General Paz');
    assert.equal(client.nextAction, undefined);
    assert.equal(client.nextFollowUp, undefined);
    assert.equal(crm.activityLog.filter((entry) => entry.entityId === 1 && entry.action === 'Operación ganada').length, 1);

    const card = page.locator('.mvp-lead-card[data-client-id="1"]');
    await openLeadDetails(page, 1);
    await page.waitForSelector('.mvp-lead-card[data-client-id="1"] [data-commercial-close-card].won');
    assert.match(await card.locator('[data-commercial-close-card]').textContent() || '', /USD 100\.000/);
    assert.match(await card.locator('[data-commercial-close-card]').textContent() || '', /USD 3\.000/);

    await card.locator('[data-reopen-operation="1"]').click();
    const reopenButtonSelector = 'dialog[data-commercial-close-dialog][open] [data-commercial-close-modal-form="reopen"] [data-commercial-reopen-confirm]';
    await waitForStableInteractiveNode(page, reopenButtonSelector);
    await page.locator('dialog[data-commercial-close-dialog][open] [name="reopenStage"]').selectOption('Negociación');
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('dialog[data-commercial-close-dialog][open] [name="reopenStage"]')?.value === 'Negociación');
    await waitForStableInteractiveNode(page, reopenButtonSelector);
    await page.locator(reopenButtonSelector).click();
    await page.waitForFunction(() => document.querySelector('.mvp-lead-card[data-client-id="1"] .mvp-stage-badge')?.textContent?.trim() === 'Negociación');

    crm = await localCrm(page);
    client = crm.clients.find((item) => item.id === 1)!;
    assert.equal(client.pipeline, 'Negociación');
    assert.equal(client.outcome, undefined);
    assert.equal(client.closedAt, undefined);
    assert.equal(client.dealAmount, undefined);
    assert.equal(client.commissionAmount, undefined);
    assert.equal(crm.activityLog.filter((entry) => entry.entityId === 1 && entry.action === 'Operación ganada').length, 1);
    assert.equal(crm.activityLog.filter((entry) => entry.entityId === 1 && entry.action === 'Operación reabierta').length, 1);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});

test('P1.2-A1 browser: Lost mobile exige detalle Otro y no deja seguimiento viejo', { timeout: 120_000 }, async (t) => {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chromium para P1.2-A1 mobile.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }
  const port = 4318;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  const context = await createContext(browser, { width: 390, height: 844 });
  await installAuthoritativeSnapshotProbe(context);
  const page = await context.newPage();
  try {
    await openApp(page, `http://127.0.0.1:${port}`);
    await openLeadDetails(page, 2);
    const lostAction = page.locator('.mvp-lead-card[data-client-id="2"] [data-close-operation-stage="Perdido"]');
    const lostGeometry = await lostAction.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return {
        height: rect.height,
        left: rect.left,
        right: rect.right,
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    assert.ok(lostGeometry.height >= 43.5, JSON.stringify(lostGeometry));
    assert.ok(lostGeometry.left >= -1 && lostGeometry.right <= lostGeometry.viewport + 1, JSON.stringify(lostGeometry));
    assert.ok(lostGeometry.documentWidth <= lostGeometry.viewport + 1, JSON.stringify(lostGeometry));
    await lostAction.click();
    await page.waitForSelector('#mvp-lead-form:not(.collapsed)');
    await page.waitForSelector('dialog[data-commercial-close-dialog][open] [data-commercial-close-modal-form="lost"]');
    await assertDialogContained(page);

    await page.locator('dialog [name="lostReason"]').selectOption('Otro');
    await page.locator('dialog [data-commercial-close-confirm="Perdido"]').click();
    await page.waitForSelector('dialog[data-commercial-close-dialog][open] [data-commercial-close-error]:not([hidden])');
    assert.match(await page.locator('dialog [data-commercial-close-error]').textContent() || '', /Detallá el motivo/);

    await page.locator('dialog [name="lostReasonDetail"]').fill('El cliente cambió el alcance de la búsqueda');
    await page.locator('dialog [name="closeNote"]').fill('Cierre browser mobile');

    // Simula una capa visual que resincroniza el select mientras el modal sigue
    // abierto. La confirmación explícita Perdido debe volver a fijar la etapa
    // canónica antes del submit y no depender de ese estado intermedio.
    await page.locator('#mvp-lead-form select[name="pipeline"]').evaluate((node) => {
      (node as HTMLSelectElement).value = 'Contactado';
    });
    assert.equal(await page.locator('#mvp-lead-form select[name="pipeline"]').inputValue(), 'Contactado');

    await page.locator('dialog [data-commercial-close-confirm="Perdido"]').click();
    await page.waitForSelector('.mvp-lead-card[data-client-id="2"].terminal', { state: 'visible' });

    const crm = await localCrm(page);
    const client = crm.clients.find((item) => item.id === 2)!;
    assert.equal(client.pipeline, 'Perdido');
    assert.equal(client.outcome, 'lost');
    assert.equal(client.lostReason, 'Otro');
    assert.equal(client.lostReasonDetail, 'El cliente cambió el alcance de la búsqueda');
    assert.equal(client.nextAction, undefined);
    assert.equal(client.nextFollowUp, undefined);
    assert.equal(client.dealAmount, undefined);
    assert.equal(client.commissionAmount, undefined);
    assert.equal(crm.activityLog.filter((entry) => entry.entityId === 2 && entry.action === 'Operación perdida').length, 1);

    const cardSelector = '.mvp-lead-card[data-client-id="2"]';
    const actionsSelector = `${cardSelector} .mvp-lead-quick-actions[data-zero-training-actions="true"]`;
    const menuSelector = `${actionsSelector} .mvp-lead-actions-menu`;
    const detailsSelector = `${menuSelector}[open] [data-open-lead-details="2"]`;
    const card = page.locator(cardSelector);

    const authoritativeSnapshotsBeforeMenu = await page.evaluate(() => (
      (window as Window & { __a35R14SnapshotProbe?: { count: number } }).__a35R14SnapshotProbe?.count ?? 0
    ));
    assert.equal(authoritativeSnapshotsBeforeMenu, 0, 'TAP 836 debe abrir el menú antes del authoritative self-ACK.');

    await waitForStableInteractiveNode(page, actionsSelector);
    await page.locator(`${menuSelector} > summary`).click();
    await page.waitForFunction((selector) => document.querySelector(selector)?.hasAttribute('open'), menuSelector);
    await page.evaluate(({ currentCardSelector, currentDetailsSelector }) => {
      const probeWindow = window as Window & {
        __a35R14OriginalCard?: Element | null;
        __a35R14OriginalDetails?: Element | null;
      };
      probeWindow.__a35R14OriginalCard = document.querySelector(currentCardSelector);
      probeWindow.__a35R14OriginalDetails = document.querySelector(currentDetailsSelector);
    }, { currentCardSelector: cardSelector, currentDetailsSelector: detailsSelector });

    await page.waitForFunction(() => (
      ((window as Window & { __a35R14SnapshotProbe?: { count: number } }).__a35R14SnapshotProbe?.count ?? 0) >= 1
    ));

    const continuity = await page.evaluate(({ currentCardSelector, currentMenuSelector, currentDetailsSelector }) => {
      type ProbeWindow = Window & {
        __a35R14SnapshotProbe?: { count: number; localBefore?: unknown; authoritative?: unknown };
        __a35R14OriginalCard?: Element | null;
        __a35R14OriginalDetails?: Element | null;
      };
      const probeWindow = window as ProbeWindow;
      const currentCard = document.querySelector(currentCardSelector);
      const currentMenu = document.querySelector(currentMenuSelector);
      const currentDetails = document.querySelector(currentDetailsSelector);
      return {
        count: probeWindow.__a35R14SnapshotProbe?.count ?? 0,
        localBefore: probeWindow.__a35R14SnapshotProbe?.localBefore ?? null,
        authoritative: probeWindow.__a35R14SnapshotProbe?.authoritative ?? null,
        sameCard: currentCard === probeWindow.__a35R14OriginalCard,
        sameDetails: currentDetails === probeWindow.__a35R14OriginalDetails,
        menuOpen: currentMenu?.hasAttribute('open') ?? false,
        detailsConnected: currentDetails?.isConnected ?? false,
      };
    }, {
      currentCardSelector: cardSelector,
      currentMenuSelector: menuSelector,
      currentDetailsSelector: detailsSelector,
    });

    assert.equal(continuity.count, 1);
    assert.ok(continuity.localBefore);
    assert.ok(continuity.authoritative);
    const beforeFingerprint = tenantFingerprint(continuity.localBefore);
    const authoritativeFingerprint = tenantFingerprint(continuity.authoritative);
    assert.equal(beforeFingerprint, authoritativeFingerprint, 'El authoritative snapshot de TAP 836 debe ser un self-ACK semánticamente equivalente.');
    console.log(`R14_TAP836_CRM_BEFORE_SNAPSHOT_FINGERPRINT_SHA256=${fingerprintSha256(beforeFingerprint)}`);
    console.log(`R14_TAP836_CRM_AUTHORITATIVE_FINGERPRINT_SHA256=${fingerprintSha256(authoritativeFingerprint)}`);
    assert.equal(continuity.sameCard, true, 'El self-ACK equivalente no debe reemplazar la card activa.');
    assert.equal(continuity.sameDetails, true, 'El self-ACK equivalente no debe reemplazar Ver detalles.');
    assert.equal(continuity.menuOpen, true, 'El menú abierto debe sobrevivir al self-ACK equivalente.');
    assert.equal(continuity.detailsConnected, true, 'Ver detalles debe seguir conectado después del self-ACK equivalente.');

    await page.locator(detailsSelector).click();
    await page.waitForFunction(() => document.querySelector('[data-lead-full-sheet="2"]')?.hasAttribute('open'));
    await page.waitForSelector('.mvp-lead-card[data-client-id="2"] [data-commercial-close-card].lost');
    assert.match(await card.locator('[data-commercial-close-card]').textContent() || '', /El cliente cambió el alcance/);
    const width = await card.evaluate((element) => ({ card: element.getBoundingClientRect().width, viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(width.card <= width.viewport + 1, JSON.stringify(width));
    assert.ok(width.document <= width.viewport + 1, JSON.stringify(width));
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});