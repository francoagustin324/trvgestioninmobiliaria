import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type Client, type CrmData } from '../models.js';

const repositoryRoot = process.cwd();
const userId = 'p1-4-a1-diagnostic-user';
const storageKey = `trv-crm-basico:user:${userId}`;

function opportunityClient(id: number, name: string, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name,
    phone: `54935155501${String(id).padStart(2, '0')}`,
    interest: 'Departamento General Paz 2 dormitorios con balcón y cochera',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Calificado',
    budget: 'USD 120.000',
    propertyType: 'Departamento',
    zones: 'General Paz',
    bedrooms: 2,
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

function diagnosticCrm(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: 'p1-4-a1-diagnostic-org',
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Diagnostic test',
  };
  crm.teamMembers = [{
    id: 99,
    userId: 'p1-4-a1-owner',
    name: 'Dueño Test',
    email: 'owner@example.test',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-09-01T09:00:00.000Z',
  }, {
    id: 1,
    userId,
    name: 'Corredor Uno',
    email: 'corredor1@example.test',
    phone: '5493515110001',
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-09-01T10:00:00.000Z',
  }, {
    id: 2,
    userId: 'other-browser-user',
    name: 'Corredor Dos',
    email: 'corredor2@example.test',
    phone: '5493515110002',
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-09-01T10:00:00.000Z',
  }];
  crm.clients = [
    opportunityClient(1, 'Ana Alta', {
      temperature: 'Caliente',
      features: 'balcón cochera',
      paymentMethod: 'Contado',
      canMoveForward: 'Sí',
      nextAction: 'Llamar por esta propiedad',
      nextFollowUp: '2026-09-08',
    }),
    opportunityClient(2, 'Bruno Buena', {
      zones: '',
      features: '',
      paymentMethod: '',
      pipeline: 'Contactado',
      nextAction: 'Revisar disponibilidad',
    }),
    opportunityClient(3, 'Carla Posible', {
      budget: '',
      bedrooms: undefined,
      features: '',
      paymentMethod: '',
      pipeline: 'Nuevo',
    }),
    opportunityClient(4, 'Dario Ganado', {
      status: 'Operación ganada',
      pipeline: 'Ganado',
      temperature: 'Caliente',
    }),
    opportunityClient(5, 'Cliente Oculto Otro Corredor', {
      temperature: 'Caliente',
      budget: 'USD 200.000',
      features: 'balcón cochera',
      paymentMethod: 'Contado',
      assignedToId: 2,
      createdById: 2,
    }),
  ];
  crm.activityLog = [{
    id: 1,
    actorId: 1,
    action: 'Llamada registrada',
    entityType: 'Cliente',
    entityId: 1,
    detail: 'Conversación de calificación',
    createdAt: '2026-09-04T14:00:00.000Z',
  }];
  crm.properties = [{
    id: 1,
    title: 'Departamento General Paz',
    address: 'General Paz, Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 100000,
    owner: 'Propietario Test',
    status: 'Activa',
    bedrooms: 2,
    features: 'Balcón y cochera',
    paymentMethod: 'Contado',
    assignedToId: 1,
    createdById: 1,
  }, {
    id: 2,
    title: 'Propiedad Oculta Otro Corredor',
    address: 'General Paz, Córdoba',
    type: 'Departamento',
    operation: 'Venta',
    price: 90000,
    owner: 'Propietario oculto',
    status: 'Activa',
    assignedToId: 2,
    createdById: 2,
  }];
  crm.visits = [];
  crm.offers = [];
  crm.reservations = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.settings = {
    ...crm.settings,
    profileName: 'Corredor Uno',
    profileEmail: 'corredor1@example.test',
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
  throw new Error(`Servidor diagnóstico P1.4-A1 no disponible: ${String(lastError ?? 'sin respuesta')}`);
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

async function createContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-AR' });
  const data = diagnosticCrm();
  await context.addInitScript(({ crm, accountUserId, accountStorageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'p1-4-a1-diagnostic-token',
      refreshToken: 'p1-4-a1-diagnostic-refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: accountUserId,
      email: 'corredor1@example.test',
    }));
    localStorage.setItem(accountStorageKey, JSON.stringify(crm));
    localStorage.setItem(`${accountStorageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: new Date().toISOString(),
      lastCloudSavedAt: new Date().toISOString(),
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { crm: data, accountUserId: userId, accountStorageKey: storageKey });
  return context;
}

async function openSelectionState(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-card', { state: 'visible', timeout: 20_000 });
  await page.locator('.premium-sidebar [data-module="propiedades"]').click();
  await page.waitForSelector('#propiedades.active [data-open-property-opportunities]', { state: 'visible', timeout: 20_000 });
  await page.locator('#propiedades [data-open-property-opportunities]').click();
  await page.waitForSelector('#propiedades.active [data-property-opportunities]', { state: 'visible', timeout: 20_000 });
  await page.locator('#propiedades [data-opportunity-property]').selectOption('1');
  await page.waitForSelector('#propiedades [data-opportunity-client="1"]', { state: 'visible', timeout: 10_000 });

  await page.locator('#propiedades [data-opportunity-compatibility]').selectOption('high');
  await page.locator('#propiedades [data-opportunity-compatibility]').selectOption('all');
  await page.locator('#propiedades [data-opportunity-followup]').selectOption('with');
  assert.deepEqual(await page.locator('#propiedades .opportunity-client-name').allTextContents(), ['Ana Alta']);
  await page.locator('#propiedades [data-opportunity-followup]').selectOption('all');
}

test('P1.4-A1 diagnóstico selector desktop antes de check', { timeout: 120_000 }, async (t) => {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chromium para diagnóstico P1.4-A1.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }

  const server = await startServer(4333);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  const context = await createContext(browser);
  const page = await context.newPage();
  try {
    await openSelectionState(page, 'http://127.0.0.1:4333');
    const target = page.locator('#propiedades [data-opportunity-select="1"]');
    assert.equal(await target.count(), 1);

    const diagnostics = await target.evaluate((element) => {
      const snapshots: Array<Record<string, unknown>> = [];
      let current: Element | null = element;

      for (let depth = 0; current && depth < 9; depth += 1, current = current.parentElement) {
        const rect = current.getBoundingClientRect();
        const style = getComputedStyle(current);
        snapshots.push({
          depth,
          tag: current.tagName,
          id: current.id,
          className: current.getAttribute('class') ?? '',
          hidden: current instanceof HTMLElement ? current.hidden : null,
          ariaHidden: current.getAttribute('aria-hidden'),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
          },
          offsetWidth: current instanceof HTMLElement ? current.offsetWidth : null,
          offsetHeight: current instanceof HTMLElement ? current.offsetHeight : null,
          offsetParent: current instanceof HTMLElement
            ? (current.offsetParent as HTMLElement | null)?.tagName ?? null
            : null,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          position: style.position,
          width: style.width,
          height: style.height,
          overflow: style.overflow,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          pointerEvents: style.pointerEvents,
          clipPath: style.clipPath,
          transform: style.transform,
          zIndex: style.zIndex,
        });
      }

      const input = element as HTMLInputElement;
      const rect = input.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const atCenter = document.elementFromPoint(centerX, centerY);

      return {
        checked: input.checked,
        disabled: input.disabled,
        clientRects: input.getClientRects().length,
        viewport: { width: innerWidth, height: innerHeight },
        documentSize: {
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        },
        center: { x: centerX, y: centerY },
        elementFromPoint: atCenter ? {
          tag: atCenter.tagName,
          id: atCenter.id,
          className: atCenter.getAttribute('class') ?? '',
          dataOpportunitySelect: atCenter.getAttribute('data-opportunity-select'),
        } : null,
        snapshots,
      };
    });

    console.log(`P1.4_SELECTION_DIAGNOSTICS ${JSON.stringify(diagnostics)}`);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await stopServer(server);
  }
});
