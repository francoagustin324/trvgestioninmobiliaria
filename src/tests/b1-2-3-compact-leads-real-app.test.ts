import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { localIsoDate } from '../lead-pipeline.js';
import { initialData, type Client, type CrmData } from '../models.js';

const repositoryRoot = process.cwd();
const artifactDirectory = join(repositoryRoot, 'artifacts', 'b1-2-3-compact-leads');
const screenshotViewports = new Set(['390x844', '720x1024', '1366x768']);
const viewports = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 430, height: 932 },
  { width: 720, height: 1024 },
  { width: 1366, height: 768 },
];
const mobileUserAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240705.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

function isoOffset(days: number): string {
  const today = new Date(`${localIsoDate()}T12:00:00Z`);
  today.setUTCDate(today.getUTCDate() + days);
  return today.toISOString().slice(0, 10);
}

function lead(id: number, overrides: Partial<Client>): Client {
  return {
    id,
    name: `Lead ${id}`,
    phone: `549351555${String(id).padStart(4, '0')}`,
    email: `lead${id}@example.test`,
    interest: 'Departamento en Córdoba',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    assignedToId: id % 2 === 0 ? 2 : 1,
    createdById: 1,
    ...overrides,
  };
}

function visualCrm(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: 'compact-visual-org', name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Validación visual' };
  crm.teamMembers = [{
    id: 1,
    userId: 'compact-owner',
    name: 'trvgestioninmobiliaria',
    email: 'franco.solis@example.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-07-01T12:00:00.000Z',
  }, {
    id: 2,
    userId: 'compact-agent',
    name: 'María Corredora',
    email: 'maria@example.test',
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-07-01T12:00:00.000Z',
  }];
  crm.clients = [
    lead(1, {
      name: 'Lucía Martín',
      interest: 'Casa de 2 habitaciones en zona centro',
      temperature: 'Caliente',
      pipeline: 'Visita coordinada',
      lastContact: isoOffset(-12),
      nextFollowUp: isoOffset(-5),
      nextAction: 'Confirmar condiciones principales y horario de visita',
      budget: 'USD 105.000',
      currency: 'USD',
      paymentMethod: 'Combinación',
      creditPossible: 'En trámite',
      zones: 'Centro, General Paz',
      purpose: 'Vivir',
      purchaseTimeframe: '0-3 meses',
      urgency: 'Alta',
      canMoveForward: 'Depende del crédito',
      knowsArea: 'Sí',
      propertyType: 'Casa',
      bedrooms: 2,
      garage: 'Sí',
      patio: 'Sí',
      preferences: 'Buena iluminación y acceso rápido al centro',
      features: 'Patio y cochera',
      objections: 'Necesita financiar una parte',
      notes: 'Revisar capacidad antes de confirmar la visita.',
      qualificationUpdatedAt: new Date().toISOString(),
    }),
    lead(2, {
      name: 'Nuevo casi vacío',
      phone: '5493515550102',
      email: undefined,
      interest: 'Consulta inicial',
      pipeline: 'Nuevo',
      lastContact: undefined,
      budget: undefined,
      paymentMethod: undefined,
      canMoveForward: undefined,
    }),
    lead(3, {
      name: 'María de los Ángeles Fernández',
      interest: 'Departamento de dos dormitorios en Nueva Córdoba apto crédito',
      temperature: 'Caliente',
      pipeline: 'Contactado',
      budget: 'USD 120.000',
      currency: 'USD',
      paymentMethod: 'Crédito hipotecario',
      creditPossible: 'Aprobado',
      creditApprovedAmount: 'USD 80.000',
      zones: 'Nueva Córdoba, Manantiales',
      purpose: 'Vivir',
      purchaseTimeframe: '0-3 meses',
      canMoveForward: 'Sí',
      knowsArea: 'Sí',
    }),
    lead(4, {
      name: 'Seguimiento muy vencido',
      nextAction: 'Llamar para confirmar decisión',
      nextFollowUp: isoOffset(-19),
      budget: 'USD 90.000',
      currency: 'USD',
      paymentMethod: 'Contado',
      canMoveForward: 'Sí',
    }),
    lead(5, {
      name: 'Visita de hoy',
      pipeline: 'Visita coordinada',
      temperature: 'Caliente',
      nextAction: 'Visita hoy a las 17:30',
      nextFollowUp: isoOffset(0),
      budget: 'USD 140.000',
      currency: 'USD',
      paymentMethod: 'Contado',
      zones: 'Docta',
      purpose: 'Vivir',
      purchaseTimeframe: 'Inmediato',
      canMoveForward: 'Sí',
    }),
    lead(6, {
      name: 'Calificado sin próxima acción',
      pipeline: 'Calificado',
      temperature: 'Caliente',
      budget: 'USD 110.000',
      currency: 'USD',
      paymentMethod: 'Financiación',
      zones: 'Manantiales',
      purpose: 'Invertir',
      purchaseTimeframe: '3-6 meses',
      canMoveForward: 'Sí',
    }),
    lead(7, {
      name: 'Operación ganada',
      pipeline: 'Ganado',
      status: 'Operación ganada',
      temperature: 'Caliente',
      nextAction: undefined,
      nextFollowUp: undefined,
    }),
    lead(8, {
      name: 'Operación perdida',
      pipeline: 'Perdido',
      status: 'Operación perdida',
      temperature: 'Frío',
      nextAction: undefined,
      nextFollowUp: undefined,
    }),
  ];
  crm.properties = [{
    id: 1,
    title: 'Casa de 2 habitaciones en zona centro',
    address: 'Centro, Córdoba',
    type: 'Casa',
    operation: 'Venta',
    price: 103000,
    owner: 'Propietario de prueba',
    status: 'Activa',
    bedrooms: 2,
    bathrooms: 2,
    paymentMethod: 'Contado y financiación',
    features: 'Patio, cochera y buena iluminación',
    assignedToId: 1,
    createdById: 1,
  }, {
    id: 2,
    title: 'Departamento apto crédito en Nueva Córdoba',
    address: 'Nueva Córdoba, Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 119000,
    owner: 'Propietario de prueba',
    status: 'Activa',
    bedrooms: 2,
    bathrooms: 1,
    paymentMethod: 'Apto crédito',
    features: 'Balcón y escritura',
    assignedToId: 1,
    createdById: 1,
  }];
  crm.activityLog = [{
    id: 1,
    actorId: 1,
    action: 'Cambio de etapa',
    entityType: 'Cliente',
    entityId: 1,
    detail: 'El Lead pasó a Visita coordinada.',
    createdAt: new Date().toISOString(),
  }];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.settings = { ...crm.settings, profileName: 'Franco Solís', profileEmail: 'franco.solis@example.test', agencyName: 'TRV Gestión Inmobiliaria' };
  return crm;
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('No se pudo reservar un puerto local para la prueba visual.'));
        return;
      }
      const port = address.port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
}

async function waitForServer(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`El servidor visual no quedó disponible: ${String(lastError ?? 'sin respuesta')}`);
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
  const mobile = viewport.width <= 430;
  const touch = viewport.width <= 720;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 3 : touch ? 2 : 1,
    hasTouch: touch,
    isMobile: mobile,
    userAgent: mobile ? mobileUserAgent : undefined,
    locale: 'es-AR',
    colorScheme: 'dark',
  });
  const crm = visualCrm();
  await context.addInitScript(({ data, userId }) => {
    const sessionKey = 'propcontrol-cloud-session-v1';
    const storageKey = `trv-crm-basico:user:${userId}`;
    localStorage.setItem(sessionKey, JSON.stringify({
      accessToken: 'compact-access-token',
      refreshToken: 'compact-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      userId,
      email: 'franco.solis@example.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(data));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({ dirty: false, localUpdatedAt: new Date().toISOString(), lastCloudSavedAt: new Date().toISOString() }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { data: crm, userId: 'compact-owner' });
  return context;
}

async function waitForLeads(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-compact-card', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-compact-card').length === 8);
}

async function assertClosedLayout(page: Page, viewport: { width: number; height: number }): Promise<number[]> {
  const metrics = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')];
    const controls = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card button, #crm .mvp-lead-compact-card a.mvp-contact-btn, #crm .mvp-lead-full-sheet > summary, #crm .mvp-lead-followup-menu > summary')]
      .filter((control) => control.getClientRects().length > 0);
    const hiddenFullContents = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-full-content')].map((element) => element.getClientRects().length === 0);
    const shell = document.querySelector<HTMLElement>('#crm [data-stage-shell]');
    const counters = shell?.querySelector<HTMLElement>('.mvp-stage-counters');
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      heights: cards.map((card) => card.getBoundingClientRect().height),
      cardsInside: cards.every((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= window.innerWidth + 1;
      }),
      oneAlert: cards.every((card) => card.querySelectorAll('.mvp-lead-alert').length === 1),
      closedSheets: document.querySelectorAll('#crm .mvp-lead-full-sheet[open]').length,
      hiddenFullContents,
      controls: controls.map((control) => {
        const rect = control.getBoundingClientRect();
        return { label: control.textContent?.trim() || control.getAttribute('aria-label') || '', width: rect.width, height: rect.height };
      }),
      stageInternalOverflow: Boolean(counters && counters.scrollWidth >= counters.clientWidth),
      shellWidth: shell?.getBoundingClientRect().width || 0,
      counterWidth: counters?.getBoundingClientRect().width || 0,
      names: cards.map((card) => card.querySelector('h3')?.textContent?.trim()),
      responsibleTextVisibleClosed: cards.some((card) => {
        const content = card.querySelector<HTMLElement>('.mvp-lead-full-content');
        return Boolean(content && content.getClientRects().length > 0 && content.textContent?.includes('trvgestioninmobiliaria'));
      }),
    };
  });
  assert.ok(metrics.documentWidth <= metrics.viewport + 1, `Documento con scroll horizontal en ${viewport.width}px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.bodyWidth <= metrics.viewport + 1);
  assert.equal(metrics.cardsInside, true);
  assert.equal(metrics.oneAlert, true);
  assert.equal(metrics.closedSheets, 0);
  assert.ok(metrics.hiddenFullContents.every(Boolean));
  assert.equal(metrics.responsibleTextVisibleClosed, false);
  assert.ok(metrics.names.includes('Lucía Martín'));
  assert.ok(metrics.names.includes('María de los Ángeles Fernández'));
  assert.ok(metrics.controls.every((control) => control.width >= 43.5 && control.height >= 43.5), `Control táctil menor a 44px en ${viewport.width}px: ${JSON.stringify(metrics.controls)}`);
  assert.ok(metrics.stageInternalOverflow);
  assert.ok(metrics.counterWidth <= metrics.shellWidth + 1);
  if (viewport.width === 390) {
    const fullLeadHeight = metrics.heights[0] || 0;
    assert.ok(fullLeadHeight >= 230 && fullLeadHeight <= 450, `Tarjeta simplificada fuera de 230-450px: ${fullLeadHeight}`);
    console.log(`B1.2.3 altura tarjeta cerrada 390: ${fullLeadHeight.toFixed(2)}px`);
  }
  return metrics.heights;
}

async function assertR5MobileMetrics(page: Page, viewport: { width: number; height: number }): Promise<void> {
  if (![320, 390, 430].includes(viewport.width)) return;
  const metrics = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>('#crm .pc-leads-heading');
    const card = document.querySelector<HTMLElement>('#crm .mvp-lead-compact-card');
    const targets = [...document.querySelectorAll<HTMLElement>('#crm .pc-supervised-attention-item[data-attention-client-id]')]
      .filter((element) => element.getClientRects().length > 0);
    if (!heading || !card || targets.length === 0) throw new Error('Faltan elementos R5 para medir geometría mobile.');
    const headingRect = heading.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const targetRects = targets.map((target) => target.getBoundingClientRect());
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      topRegionHeight: cardRect.top - headingRect.top,
      targetCount: targetRects.length,
      targetMinHeight: Math.min(...targetRects.map((rect) => rect.height)),
      targetMinWidth: Math.min(...targetRects.map((rect) => rect.width)),
    };
  });
  console.log(`R5_BROWSER ${viewport.width}x${viewport.height} ${JSON.stringify(metrics)}`);
  assert.ok(metrics.targetMinHeight >= 43.5 && metrics.targetMinWidth >= 43.5, `Target ATENDER AHORA menor a 44px @${viewport.width}: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.documentWidth <= metrics.viewport + 1, `Document overflow R5 @${viewport.width}: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.bodyWidth <= metrics.viewport + 1, `Body overflow R5 @${viewport.width}: ${JSON.stringify(metrics)}`);
}

async function openZeroTrainingDetails(card: ReturnType<Page['locator']>): Promise<void> {
  const sheet = card.locator('.mvp-lead-full-sheet');
  if (await sheet.getAttribute('open') !== null) return;
  await card.locator('.mvp-lead-actions-menu > summary').click();
  await card.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  await sheet.waitFor({ state: 'visible' });
}

async function assertSingleExpandedAndPersistent(page: Page): Promise<void> {
  const firstCard = page.locator('#crm .mvp-lead-compact-card').nth(0);
  await openZeroTrainingDetails(firstCard);
  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 1);
  const secondCard = page.locator('#crm .mvp-lead-compact-card').nth(1);
  await openZeroTrainingDetails(secondCard);
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-full-sheet[open]').length === 1);
  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 1);
  const selectedClient = await page.locator('#crm .mvp-lead-full-sheet[open]').getAttribute('data-lead-full-sheet');
  const filterDetails = page.locator('#crm .mvp-lead-more-filters');
  const filterSummary = filterDetails.locator(':scope > summary');
  if ((await filterDetails.getAttribute('open')) === null) await filterSummary.click();
  await page.waitForFunction(() => document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters')?.open === true);
  assert.equal(await filterSummary.getAttribute('aria-expanded'), 'true');
  const order = page.locator('#mvp-lead-order');
  await order.selectOption('name');
  assert.equal(await order.inputValue(), 'name');
  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').count(), 1);
  assert.equal(await page.locator('#crm .mvp-lead-full-sheet[open]').getAttribute('data-lead-full-sheet'), selectedClient);
  await order.selectOption('priority');
  assert.equal(await order.inputValue(), 'priority');
  if ((await filterDetails.getAttribute('open')) !== null) await filterSummary.click();
  await page.waitForFunction(() => document.querySelector<HTMLDetailsElement>('#crm .mvp-lead-more-filters')?.open === false);
  assert.equal(await filterSummary.getAttribute('aria-expanded'), 'false');
}

async function assertHumanVisibleSummary(page: Page, width: number): Promise<void> {
  const summary = page.locator('#crm .mvp-lead-full-sheet[open] > summary');
  await summary.waitFor({ state: 'visible' });
  const measure = async () => summary.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const target = document.elementFromPoint(x, y);
    const topbar = document.querySelector<HTMLElement>('.app-topbar');
    const topbarRect = topbar && getComputedStyle(topbar).display !== 'none' ? topbar.getBoundingClientRect() : null;
    const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const maxScrollY = Math.max(0, scrollHeight - window.innerHeight);
    return {
      valid: target === element || element.contains(target),
      x,
      y,
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      topbarBottom: topbarRect?.bottom ?? 0,
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
      scrollHeight,
      maxScrollY,
      targetTag: target?.tagName || '',
      targetClass: target instanceof HTMLElement ? target.className : '',
    };
  });
  const before = await measure();
  const clearance = 12;
  const safeTop = before.topbarBottom + clearance + before.height / 2;
  const safeBottom = before.viewportHeight - clearance - before.height / 2;
  assert.ok(safeTop <= safeBottom, `No existe zona segura vertical para el summary @${width}: ${JSON.stringify({ before, safeTop, safeBottom })}`);
  const targetY = (safeTop + safeBottom) / 2;
  const deltaY = before.y - targetY;
  const desiredScrollY = Math.min(before.maxScrollY, Math.max(0, before.scrollY + deltaY));
  await page.evaluate((top) => {
    window.scrollTo({ top, behavior: 'instant' });
  }, desiredScrollY);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const after = await measure();
  console.log(`R8_VIEWPORT ${width} ${JSON.stringify({ before, safeTop, safeBottom, targetY, deltaY, desiredScrollY, after })}`);
  assert.ok(after.top >= after.topbarBottom + clearance, `El summary no quedó completo debajo de app-topbar + clearance @${width}: ${JSON.stringify(after)}`);
  assert.ok(after.bottom <= after.viewportHeight - clearance, `El summary no quedó completo dentro del límite inferior seguro @${width}: ${JSON.stringify(after)}`);
  assert.ok(after.y >= 0 && after.y <= after.viewportHeight, `El centro accionable quedó fuera del viewport @${width}: ${JSON.stringify(after)}`);
  assert.equal(after.valid, true, `El summary de ficha está interceptado antes del click real @${width}: ${JSON.stringify(after)}`);
}

async function assertPipelineSelection(page: Page): Promise<void> {
  const chip = page.locator('#crm [data-stage-quick="Calificado"]');
  const toggle = page.locator('#crm [data-pc-toggle-stages]');
  const expandedForSecondary = !(await chip.isVisible());
  if (expandedForSecondary) {
    assert.equal(await toggle.isVisible(), true, 'El pipeline colapsado debe permitir expandir etapas secundarias.');
    await toggle.click();
    await page.waitForFunction(() => document.querySelector<HTMLElement>('#crm .pc-stage-summary')?.dataset.expanded === 'true');
  }
  await chip.click();
  await page.waitForTimeout(100);
  const geometry = await page.evaluate(() => {
    const selected = document.querySelector<HTMLElement>('#crm .mvp-stage-counter.active');
    const container = document.querySelector<HTMLElement>('#crm .mvp-stage-counters');
    const selectedRect = selected?.getBoundingClientRect();
    const containerRect = container?.getBoundingClientRect();
    return {
      selectedLeft: selectedRect?.left || 0,
      selectedRight: selectedRect?.right || 0,
      containerLeft: containerRect?.left || 0,
      containerRight: containerRect?.right || 0,
      documentWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });
  assert.ok(geometry.selectedLeft >= geometry.containerLeft - 2 && geometry.selectedRight <= geometry.containerRight + 2, JSON.stringify(geometry));
  assert.ok(geometry.documentWidth <= geometry.viewport + 1);
  await page.locator('#crm [data-stage-quick="Todas"]').click();
  if (expandedForSecondary) {
    await toggle.click();
    await page.waitForFunction(() => document.querySelector<HTMLElement>('#crm .pc-stage-summary')?.dataset.expanded === 'false');
  }
}

async function assertFollowUpActions(page: Page): Promise<void> {
  const overdueCard = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'Seguimiento muy vencido' });
  assert.equal(await overdueCard.locator('.mvp-lead-alert').isVisible(), false, 'La alerta heredada no compite en el primer nivel de FASE 1.');
  assert.match(await overdueCard.locator('.mvp-lead-next-action').innerText(), /Llamar para confirmar decisión[\s\S]*Vencido hace 19 días/i);
  await openZeroTrainingDetails(overdueCard);
  await overdueCard.locator('.mvp-lead-followup-menu > summary').click();
  const form = overdueCard.locator('[data-reprogram-client-follow-up]');
  await form.locator('input[name="date"]').fill(isoOffset(3));
  await form.locator('button[type="submit"]').click();
  await page.waitForTimeout(100);
  const updatedCard = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'Seguimiento muy vencido' });
  assert.match(await updatedCard.locator('.mvp-lead-next-action').innerText(), /En 3 días/);
  await openZeroTrainingDetails(updatedCard);
  await updatedCard.locator('.mvp-lead-followup-menu > summary').click();
  const completeButton = updatedCard.locator('[data-complete-client-follow-up]');
  const hitTarget = await completeButton.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const target = document.elementFromPoint(x, y) as HTMLElement | null;
    const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');
    const navRect = nav?.getBoundingClientRect();
    return {
      valid: target === button || button.contains(target),
      button: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      point: { x, y },
      targetTag: target?.tagName || '',
      targetClass: target?.className || '',
      targetText: target?.textContent?.trim().slice(0, 80) || '',
      nav: navRect ? { left: navRect.left, top: navRect.top, right: navRect.right, bottom: navRect.bottom } : null,
      menuZ: getComputedStyle(button.closest<HTMLElement>('.mvp-lead-followup-menu')!).zIndex,
      popoverZ: getComputedStyle(button.closest<HTMLElement>('.mvp-lead-followup-popover')!).zIndex,
    };
  });
  assert.equal(hitTarget.valid, true, `El botón Completar seguimiento está cubierto: ${JSON.stringify(hitTarget)}`);
  await completeButton.click();
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')];
    const card = cards.find((item) => item.textContent?.includes('Seguimiento muy vencido'));
    return card?.querySelector('.mvp-lead-next-action')?.textContent?.includes('Definir próximo paso') === true;
  });
  const completedCard = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'Seguimiento muy vencido' });
  assert.match(await completedCard.locator('.mvp-lead-next-action').innerText(), /Definir próximo paso/);
  assert.equal(await completedCard.locator('.mvp-lead-alert').isVisible(), false);
}

async function assertAutomaticPanel(page: Page, width: number): Promise<void> {
  const card = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'Nuevo casi vacío' });
  await card.locator('.mvp-lead-actions-menu > summary').click();
  await card.getByRole('button', { name: 'Completar datos con IA', exact: true }).click();
  const panel = page.locator('#crm .lead-qualification-panel');
  await panel.waitFor({ state: 'visible' });
  const textarea = panel.locator('[data-qualification-text]');
  await textarea.fill('Busco en Manantiales. Presupuesto USD 120.000, contado, para vivir y puedo avanzar este mes.');
  await panel.locator('[data-analyze-qualification]').click();
  await panel.locator('[data-apply-qualification]').waitFor({ state: 'visible' });
  const controls = [
    panel.locator('[data-close-qualification]'),
    panel.locator('[data-copy-next-question]'),
    panel.locator('[data-apply-qualification]'),
  ];
  for (const control of controls) {
    if (await control.count()) {
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      assert.ok(box && box.width >= 43.5 && box.height >= 43.5, `Control del panel menor a 44px en ${width}px.`);
    }
  }
  const focusTarget = panel.locator('[data-suggestion-value]:not([disabled]), [data-qualification-text]').last();
  await focusTarget.focus();
  await page.waitForTimeout(550);
  const geometry = await focusTarget.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');
    const navVisible = nav && getComputedStyle(nav).display !== 'none';
    const navRect = navVisible ? nav.getBoundingClientRect() : null;
    return {
      active: document.activeElement === element,
      top: rect.top,
      bottom: rect.bottom,
      visibleBottom: Math.min(window.innerHeight, navRect?.top ?? window.innerHeight),
      documentWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });
  assert.equal(geometry.active, true);
  assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.visibleBottom - 8, JSON.stringify(geometry));
  assert.ok(geometry.documentWidth <= geometry.viewport + 1);
}

async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(artifactDirectory, name), fullPage: false, scale: 'css' });
}

function verifyArtifacts(): void {
  const expected = [
    'leads-compact-390x844.png',
    'leads-expanded-390x844.png',
    'leads-panel-390x844.png',
    'leads-compact-720x1024.png',
    'leads-expanded-720x1024.png',
    'leads-compact-1366x768.png',
    'leads-expanded-1366x768.png',
  ].sort();
  const actual = readdirSync(artifactDirectory).filter((name) => name.endsWith('.png')).sort();
  assert.deepEqual(actual, expected);
  for (const name of actual) {
    const path = join(artifactDirectory, name);
    const buffer = readFileSync(path);
    assert.ok(statSync(path).size > 10_000, `${name} parece vacío.`);
    assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const match = name.match(/-(\d+)x(\d+)\.png$/);
    assert.ok(match);
    assert.equal(buffer.readUInt32BE(16), Number(match[1]));
    assert.equal(buffer.readUInt32BE(20), Number(match[2]));
  }
}

test('B1.2.3 valida lista compacta, prioridad y disclosure con la aplicación real', { timeout: 300_000 }, async (t) => {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chrome para validar B1.2.3.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }

  const index = readFileSync('index.html', 'utf8');
  assert.ok(index.indexOf('/src/mobile-leads-polish.css') < index.indexOf('/src/lead-list-compact.css'));
  rmSync(artifactDirectory, { recursive: true, force: true });
  mkdirSync(artifactDirectory, { recursive: true });
  const port = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });

  try {
    for (const viewport of viewports) {
      const context = await createContext(browser, viewport);
      const page = await context.newPage();
      const key = `${viewport.width}x${viewport.height}`;
      try {
        await waitForLeads(page, baseUrl);
        if (viewport.width === 360 || viewport.width === 412) {
          assert.ok(await page.evaluate(() => navigator.maxTouchPoints > 0));
          assert.match(await page.evaluate(() => navigator.userAgent), /Android|Mobile/i);
        }
        await assertClosedLayout(page, viewport);
        await assertR5MobileMetrics(page, viewport);
        await assertPipelineSelection(page);
        if (screenshotViewports.has(key)) {
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
          await capture(page, `leads-compact-${key}.png`);
          await assertSingleExpandedAndPersistent(page);
          const open = page.locator('#crm .mvp-lead-full-sheet[open]');
          await open.scrollIntoViewIfNeeded();
          await capture(page, `leads-expanded-${key}.png`);
        }
        if (viewport.width === 320 || viewport.width === 390) {
          if (viewport.width === 320) await assertSingleExpandedAndPersistent(page);
          const filterDetails = page.locator('#crm .mvp-lead-more-filters');
          assert.equal(await filterDetails.getAttribute('open'), null, 'Más filtros debe estar cerrado antes de accionar la ficha.');
          const orderBefore = await page.locator('#mvp-lead-order').inputValue();
          const searchBefore = await page.locator('#mvp-lead-search').inputValue();
          await assertHumanVisibleSummary(page, viewport.width);
          const summary = page.locator('#crm .mvp-lead-full-sheet[open] > summary');
          await summary.click();
          await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-full-sheet[open]').length === 0);
          assert.equal(await page.locator('#mvp-lead-order').inputValue(), orderBefore, `El click de ficha alteró orden @${viewport.width}.`);
          assert.equal(await page.locator('#mvp-lead-search').inputValue(), searchBefore, `El click de ficha alteró búsqueda @${viewport.width}.`);
          assert.equal(await filterDetails.getAttribute('open'), null, `El click de ficha reabrió Más filtros @${viewport.width}.`);
          if (viewport.width === 390) {
            await assertFollowUpActions(page);
            await assertAutomaticPanel(page, viewport.width);
            const panel = page.locator('#crm .lead-qualification-panel');
            await panel.scrollIntoViewIfNeeded();
            await capture(page, `leads-panel-${key}.png`);
          }
        }
      } finally {
        await page.close();
        await context.close();
      }
    }
    verifyArtifacts();
  } finally {
    await browser.close();
    await stopServer(server);
  }
});