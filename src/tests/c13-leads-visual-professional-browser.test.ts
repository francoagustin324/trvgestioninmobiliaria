import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import test from 'node:test';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'c13-visual-owner';
const ORG_ID = 'c13-visual-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const ARTIFACT_DIR = 'artifacts/b1-3-3';
const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
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
    createdAt: '2026-08-21T12:00:00.000Z',
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'C13 Visual' };
  crm.teamMembers = [owner()];
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
      temperature: 'Caliente',
      pipeline: 'Contactado',
      assignedToId: 1,
      createdById: 1,
      lastContact: '2026-08-19',
      nextAction: 'Confirmar visita',
      nextFollowUp: '2026-08-20',
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
      temperature: 'Tibio',
      pipeline: 'Nuevo',
      assignedToId: 1,
      createdById: 1,
    },
    {
      id: 3,
      name: 'Sofía Rodríguez',
      phone: '+54 9 351 511-0072',
      email: 'sofia@ejemplo.com',
      interest: 'Casa en zona norte',
      budget: 'USD 150000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Caliente',
      pipeline: 'Visita coordinada',
      assignedToId: 1,
      createdById: 1,
      lastContact: '2026-08-20',
      nextAction: 'Confirmar asistencia',
      nextFollowUp: '2026-08-21',
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
      // retry local server only
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor C13 no disponible.');
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
  await context.addInitScript(({ crm, storageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: 'c13-visual-owner',
      email: 'franco@propcontrol.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(crm));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-08-21T18:00:00.000Z',
      lastCloudSavedAt: '2026-08-21T18:00:00.000Z',
      lastCloudVersion: '2026-08-21T18:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { crm: fixture(), storageKey: STORAGE_KEY });
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.pc-supervised-attention-queue', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('.mvp-lead-card[data-client-id="1"]', { state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(140);
}

async function assertTarget(locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  assert.ok(box, `${label}: sin geometría visible.`);
  assert.ok(box.height >= 43.99, `${label}: target ${box.height}px < 44px.`);
}

async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(metrics.html <= metrics.viewport + 1, `${label}: html overflow ${JSON.stringify(metrics)}`);
  assert.ok(metrics.body <= metrics.viewport + 1, `${label}: body overflow ${JSON.stringify(metrics)}`);
}

async function assertTextNotClipped(locator: Locator, label: string): Promise<void> {
  const metrics = await locator.evaluate((element) => {
    const node = element as HTMLElement;
    const style = getComputedStyle(node);
    return {
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      display: style.display,
      visibility: style.visibility,
      fontSize: Number.parseFloat(style.fontSize || '0'),
    };
  });
  assert.notEqual(metrics.display, 'none', `${label}: display none.`);
  assert.notEqual(metrics.visibility, 'hidden', `${label}: visibility hidden.`);
  assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `${label}: texto cortado horizontalmente ${JSON.stringify(metrics)}`);
  assert.ok(metrics.scrollHeight <= metrics.clientHeight + 1, `${label}: texto cortado verticalmente ${JSON.stringify(metrics)}`);
  assert.ok(metrics.fontSize >= 10, `${label}: tipografía demasiado pequeña ${metrics.fontSize}px.`);
}

async function assertNoOverlap(first: Locator, second: Locator, label: string): Promise<void> {
  const a = await first.boundingBox();
  const b = await second.boundingBox();
  assert.ok(a && b, `${label}: geometría ausente.`);
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  assert.ok(overlapX <= 0 || overlapY <= 0, `${label}: superposición detectada ${JSON.stringify({ a, b })}`);
}

async function inspectViewport(page: Page, url: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await load(page, url);

  const heading = page.locator('.pc-supervised-attention-heading');
  assert.equal((await heading.locator('strong').textContent())?.trim(), 'LEADS PRIORITARIOS');
  const fullCopy = heading.locator('.pc-supervised-attention-copy-full');
  const compactCopy = heading.locator('.pc-supervised-attention-copy-compact');
  if (width <= 720) {
    assert.equal(await compactCopy.isVisible(), true, `${width}: copy compacto visible.`);
    assert.equal((await compactCopy.textContent())?.trim(), 'Contactos para gestionar primero.');
  } else {
    assert.equal(await fullCopy.isVisible(), true, `${width}: copy completo visible.`);
    assert.equal((await fullCopy.textContent())?.trim(), 'Gestioná primero los contactos que requieren acción.');
  }

  const priorityCards = page.locator('.pc-supervised-attention-item');
  assert.equal(await priorityCards.count(), 3, `${width}: se conserva máximo y fixture top-3.`);
  for (let index = 0; index < 3; index += 1) {
    const card = priorityCards.nth(index);
    await assertTarget(card, `${width}: prioridad ${index + 1}`);
    await assertTextNotClipped(card.locator('.pc-supervised-attention-name'), `${width}: nombre prioridad ${index + 1}`);
    await assertTextNotClipped(card.locator('.pc-supervised-attention-reason'), `${width}: motivo prioridad ${index + 1}`);
    await assertTextNotClipped(card.locator('.pc-supervised-attention-action'), `${width}: acción prioridad ${index + 1}`);
  }

  const lead = page.locator('.mvp-lead-card[data-client-id="1"]');
  const scheduled = lead.locator('.mvp-lead-next-action > div > small');
  assert.equal(await scheduled.isVisible(), true, `${width}: fecha de seguimiento visible.`);
  await assertTextNotClipped(scheduled, `${width}: fecha de seguimiento`);

  const fullSheet = lead.locator('.mvp-lead-full-sheet');
  const moreActions = lead.locator('[data-lead-menu-toggle="1"]');
  await assertTarget(moreActions, `${width}: Más acciones`);
  await moreActions.click();
  const viewDetails = lead.locator('[data-open-lead-details="1"]');
  assert.equal(await viewDetails.isVisible(), true, `${width}: Ver detalles visible.`);
  await assertTarget(viewDetails, `${width}: Ver detalles`);
  await viewDetails.click();
  await page.waitForFunction(() => document.querySelector<HTMLDetailsElement>('.mvp-lead-card[data-client-id="1"] .mvp-lead-full-sheet')?.open === true);

  const followMenu = lead.locator('.mvp-lead-followup-menu');
  const followSummary = followMenu.locator(':scope > summary');
  await assertTarget(followSummary, `${width}: menú seguimiento`);
  await followSummary.click();
  const popover = followMenu.locator(':scope > .mvp-lead-followup-popover');
  await popover.waitFor({ state: 'visible' });
  const label = popover.locator('form label');
  assert.match((await label.textContent()) ?? '', /Nueva fecha/);
  await assertTextNotClipped(label, `${width}: Nueva fecha`);
  const dateInput = popover.locator('input[type="date"]');
  const reschedule = popover.locator('form button[type="submit"]');
  assert.equal(await dateInput.inputValue(), '2026-08-20', `${width}: fecha actual preservada en reprogramación.`);
  await assertTarget(dateInput, `${width}: input Nueva fecha`);
  await assertTarget(reschedule, `${width}: Reprogramar`);
  await assertNoOverlap(dateInput, reschedule, `${width}: Nueva fecha/Reprogramar`);

  const edit = fullSheet.locator('[data-edit-client="1"]');
  const remove = fullSheet.locator('[data-delete="clients"][data-id="1"]');
  assert.equal(await edit.isVisible(), true, `${width}: Editar visible.`);
  assert.equal(await remove.isVisible(), true, `${width}: Eliminar visible.`);
  await assertTarget(edit, `${width}: Editar`);
  await assertTarget(remove, `${width}: Eliminar`);
  await assertNoOverlap(edit, remove, `${width}: Editar/Eliminar`);

  await assertNoHorizontalOverflow(page, `${width}x${height}`);
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: `${ARTIFACT_DIR}/c13-after-${width}x${height}.png`, fullPage: true });

  console.log(`C13_VIEWPORT=${JSON.stringify({ width, height, priorityCards: 3, followUpVisible: true, rescheduleTarget: 44, editDeleteTarget: 44, overflow: false })}`);
}

test('C13 browser real: jerarquía visual y contratos funcionales en desktop/mobile', { timeout: 180_000 }, async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Chrome/Chromium no disponible para C13.');
  const port = 62350 + Math.floor(Math.random() * 100);
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
    for (const viewport of VIEWPORTS) await inspectViewport(page, url, viewport.width, viewport.height);

    await page.setViewportSize({ width: 1366, height: 768 });
    await load(page, url);
    const beforeCrm = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    const stageBefore = await page.locator('#mvp-lead-stage-filter').inputValue();
    const firstPriority = page.locator('.pc-supervised-attention-item').first();
    const targetId = await firstPriority.getAttribute('data-attention-client-id');
    assert.ok(targetId, 'Prioridad sin clientId.');
    await firstPriority.click();
    await page.waitForFunction((id) => document.querySelector<HTMLDetailsElement>(`.mvp-lead-card[data-client-id="${id}"] .mvp-lead-full-sheet`)?.open === true, targetId);
    const afterCrm = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    const stageAfter = await page.locator('#mvp-lead-stage-filter').inputValue();
    assert.equal(afterCrm, beforeCrm, 'Abrir desde Leads prioritarios no debe mutar CRM persistido.');
    assert.equal(stageAfter, stageBefore, 'Abrir desde Leads prioritarios no debe limpiar filtros.');
    console.log(`C13_NAVIGATION=${JSON.stringify({ targetId, crmMutation: false, stageBefore, stageAfter })}`);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});