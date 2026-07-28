import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { initialData, type CrmData } from '../models.js';

const repositoryRoot = process.cwd();
const artifactDirectory = join(repositoryRoot, 'artifacts', 'b1-2-2-mobile-leads');
const screenshotWidths = new Set([360, 390, 430, 720, 1366]);
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

function visualCrm(): CrmData {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: 'mobile-visual-org',
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Validación visual',
  };
  crm.teamMembers = [{
    id: 1,
    userId: 'mobile-visual-user',
    name: 'Franco Solís',
    email: 'franco@example.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-07-01T12:00:00.000Z',
  }];
  crm.clients = [{
    id: 1,
    name: 'Lucía Martín',
    phone: '5493515550101',
    email: 'lucia@example.test',
    interest: 'Casa de 2 habitaciones en zona centro',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Visita coordinada',
    lastContact: '2026-07-27',
    nextFollowUp: '2026-07-30',
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
    operation: 'Compra',
    bedrooms: 2,
    garage: 'Sí',
    patio: 'Sí',
    preferences: 'Buena iluminación y acceso rápido al centro',
    qualificationUpdatedAt: '2026-07-28T12:30:00.000Z',
    assignedToId: 1,
    createdById: 1,
  }, {
    id: 2,
    name: 'María de los Ángeles Fernández',
    phone: '5493515550102',
    email: 'maria@example.test',
    interest: 'Departamento de dos dormitorios en Nueva Córdoba apto crédito',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Calificado',
    lastContact: '2026-07-28',
    nextFollowUp: '2026-07-31',
    nextAction: 'Enviar opciones de dúplex y confirmar disponibilidad',
    budget: 'USD 120.000',
    currency: 'USD',
    paymentMethod: 'Crédito hipotecario',
    creditPossible: 'Aprobado',
    creditApprovedAmount: 'USD 80.000',
    zones: 'Manantiales, Docta',
    purpose: 'Vivir',
    purchaseTimeframe: '0-3 meses',
    urgency: 'Media',
    canMoveForward: 'Sí',
    knowsArea: 'Sí',
    propertyType: 'Dúplex',
    operation: 'Compra',
    bedrooms: 2,
    requiresCreditReady: 'Sí',
    qualificationUpdatedAt: '2026-07-28T13:00:00.000Z',
    assignedToId: 1,
    createdById: 1,
  }];
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
    features: 'Patio, cochera, buena iluminación',
    assignedToId: 1,
    createdById: 1,
  }, {
    id: 2,
    title: 'Dúplex en Manantiales apto crédito',
    address: 'Manantiales, Córdoba',
    type: 'Dúplex',
    operation: 'Venta',
    price: 118000,
    owner: 'Desarrollista de prueba',
    status: 'Activa',
    bedrooms: 2,
    bathrooms: 2,
    paymentMethod: 'Apto crédito',
    features: 'Cochera, patio y escritura',
    assignedToId: 1,
    createdById: 1,
  }];
  crm.activityLog = [{
    id: 1,
    actorId: 1,
    action: 'Cambio de etapa',
    entityType: 'Cliente',
    entityId: 2,
    detail: 'El Lead pasó a Calificado después de confirmar crédito y presupuesto.',
    createdAt: '2026-07-28T13:05:00.000Z',
  }, {
    id: 2,
    actorId: 1,
    action: 'Próxima acción programada',
    entityType: 'Cliente',
    entityId: 2,
    detail: 'Enviar opciones compatibles y confirmar disponibilidad.',
    createdAt: '2026-07-28T13:10:00.000Z',
  }];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.settings = {
    ...crm.settings,
    profileName: 'Franco Solís',
    profileEmail: 'franco@example.test',
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
}

function chromeExecutable(): string | undefined {
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find(existsSync);
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
      accessToken: 'visual-access-token',
      refreshToken: 'visual-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      userId,
      email: 'franco@example.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(data));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-07-28T13:00:00.000Z',
      lastCloudSavedAt: '2026-07-28T13:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
  }, { data: crm, userId: 'mobile-visual-user' });
  return context;
}

async function waitForLeads(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active .mvp-lead-card', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('#crm .mvp-lead-card').length === 2);
}

function contrastRatio(foreground: number[], background: number[]): number {
  const luminance = (rgb: number[]) => {
    const values = rgb.slice(0, 3).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * values[0]! + 0.7152 * values[1]! + 0.0722 * values[2]!;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}


function paethPredictor(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function inspectPng(filePath: string): { width: number; height: number; uniqueColors: number; channelRange: number } {
  const buffer = readFileSync(filePath);
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${filePath} no es PNG válido.`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const compressed: Buffer[] = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.ok(dataEnd + 4 <= buffer.length, `Chunk PNG truncado en ${filePath}.`);
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? -1;
    } else if (type === 'IDAT') {
      compressed.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  assert.ok(width > 0 && height > 0 && compressed.length > 0, `PNG incompleto: ${filePath}.`);
  assert.equal(bitDepth, 8, `Profundidad PNG inesperada en ${filePath}.`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  assert.ok(channels > 0, `Tipo de color PNG no soportado en ${filePath}: ${colorType}.`);
  const rowBytes = width * channels;
  const raw = inflateSync(Buffer.concat(compressed));
  assert.equal(raw.length, height * (rowBytes + 1), `Datos PNG inesperados en ${filePath}.`);
  const previous = Buffer.alloc(rowBytes);
  const current = Buffer.alloc(rowBytes);
  const unique = new Set<string>();
  const stride = Math.max(1, Math.floor((width * height) / 5_000));
  let minimum = 255;
  let maximum = 0;
  let cursor = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[cursor] ?? 0;
    cursor += 1;
    for (let index = 0; index < rowBytes; index += 1) {
      const source = raw[cursor] ?? 0;
      cursor += 1;
      const left = index >= channels ? current[index - channels] ?? 0 : 0;
      const up = previous[index] ?? 0;
      const upperLeft = index >= channels ? previous[index - channels] ?? 0 : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paethPredictor(left, up, upperLeft)
                : -1;
      assert.notEqual(predictor, -1, `Filtro PNG no soportado en ${filePath}: ${filter}.`);
      current[index] = (source + predictor) & 255;
    }
    for (let column = 0; column < width; column += 1) {
      const pixelNumber = row * width + column;
      if (pixelNumber % stride !== 0) continue;
      const pixelOffset = column * channels;
      const red = current[pixelOffset] ?? 0;
      const green = channels === 1 ? red : current[pixelOffset + 1] ?? 0;
      const blue = channels === 1 ? red : current[pixelOffset + 2] ?? 0;
      unique.add(`${red},${green},${blue}`);
      minimum = Math.min(minimum, red, green, blue);
      maximum = Math.max(maximum, red, green, blue);
    }
    current.copy(previous);
  }
  return { width, height, uniqueColors: unique.size, channelRange: maximum - minimum };
}

function assertScreenshotArtifacts(): void {
  const expected = [
    'leads-360x800.png',
    'leads-panel-360x800.png',
    'leads-390x844.png',
    'leads-panel-390x844.png',
    'leads-430x932.png',
    'leads-panel-430x932.png',
    'leads-720x1024.png',
    'leads-panel-720x1024.png',
    'leads-1366x768.png',
    'leads-panel-1366x768.png',
  ].sort();
  const actual = readdirSync(artifactDirectory).filter((name) => name.endsWith('.png')).sort();
  assert.deepEqual(actual, expected, `Capturas B1.2.2 inesperadas: ${JSON.stringify(actual)}`);
  for (const fileName of actual) {
    const filePath = join(artifactDirectory, fileName);
    assert.ok(statSync(filePath).size > 10_000, `Captura vacía o demasiado pequeña: ${fileName}.`);
    const match = fileName.match(/^(?:leads|leads-panel)-(\d+)x(\d+)\.png$/);
    assert.ok(match, `Nombre de captura inválido: ${fileName}.`);
    const expectedWidth = Number(match[1]);
    const expectedHeight = Number(match[2]);
    const metrics = inspectPng(filePath);
    assert.equal(metrics.width, expectedWidth, `Ancho incorrecto en ${fileName}.`);
    assert.equal(metrics.height, expectedHeight, `Alto incorrecto en ${fileName}.`);
    assert.ok(metrics.uniqueColors >= 16 && metrics.channelRange >= 30,
      `Captura posiblemente en blanco: ${fileName} (${JSON.stringify(metrics)}).`);
  }
}

async function assertControlReachable(control: Locator, label: string, width: number, requireFocus = false): Promise<void> {
  await control.evaluate(async (element) => {
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  const metrics = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const navigation = document.querySelector<HTMLElement>('.mobile-bottom-nav');
    const navigationVisible = navigation && getComputedStyle(navigation).display !== 'none';
    const navigationRect = navigationVisible ? navigation.getBoundingClientRect() : null;
    const visibleBottom = Math.min(window.innerHeight, navigationRect?.top ?? window.innerHeight);
    return {
      active: document.activeElement === element,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      visibleBottom,
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });
  if (requireFocus) assert.equal(metrics.active, true, `${label} perdió el foco en ${width}px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.top >= 0 && metrics.bottom <= metrics.visibleBottom - 8,
    `${label} queda tapado en ${width}px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.left >= 0 && metrics.right <= metrics.viewportWidth + 1,
    `${label} queda fuera horizontalmente en ${width}px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.documentScrollWidth <= metrics.viewportWidth + 1,
    `${label} provoca scroll horizontal en ${width}px.`);
}

async function assertBaseLayout(page: Page, viewport: { width: number; height: number }): Promise<void> {
  const metrics = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-card')];
    const titleRows = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-title-line h3')];
    const interestRows = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-main-copy > p')];
    const lineMetrics = (element: HTMLElement) => {
      const node = element.firstChild;
      const range = document.createRange();
      if (node) range.selectNodeContents(element);
      const lineRects = node ? [...range.getClientRects()].map((rect) => rect.width) : [];
      const style = getComputedStyle(element);
      return {
        width: element.getBoundingClientRect().width,
        lineRects,
        wordBreak: style.wordBreak,
        overflowWrap: style.overflowWrap,
        hyphens: style.hyphens,
        words: element.textContent?.trim().split(/\s+/).filter(Boolean).length || 0,
      };
    };
    return {
      viewport: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      cards: cards.map((card) => {
        const rect = card.getBoundingClientRect();
        const buttons = [...card.querySelectorAll<HTMLElement>('button, a.mvp-contact-btn')].map((control) => {
          const controlRect = control.getBoundingClientRect();
          return {
            text: control.textContent?.trim() || control.getAttribute('aria-label') || '',
            left: controlRect.left,
            right: controlRect.right,
            top: controlRect.top,
            bottom: controlRect.bottom,
            width: controlRect.width,
            height: controlRect.height,
            scrollWidth: control.scrollWidth,
            clientWidth: control.clientWidth,
          };
        });
        return { left: rect.left, right: rect.right, width: rect.width, buttons };
      }),
      titles: titleRows.map(lineMetrics),
      interests: interestRows.map(lineMetrics),
      autoButtons: [...document.querySelectorAll<HTMLButtonElement>('#crm .mvp-auto-qualify-button')].map((button) => ({
        text: button.textContent?.trim(),
        scrollWidth: button.scrollWidth,
        clientWidth: button.clientWidth,
        height: button.getBoundingClientRect().height,
      })),
      counter: (() => {
        const container = document.querySelector<HTMLElement>('#crm .mvp-stage-counters');
        const first = container?.querySelector<HTMLElement>('.mvp-stage-counter');
        const containerRect = container?.getBoundingClientRect();
        const firstRect = first?.getBoundingClientRect();
        return {
          scrollLeft: container?.scrollLeft || 0,
          width: containerRect?.width || 0,
          firstLeft: firstRect?.left || 0,
          containerLeft: containerRect?.left || 0,
        };
      })(),
      cssOrder: [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((link) => new URL(link.href).pathname),
    };
  });

  assert.ok(metrics.documentScrollWidth <= metrics.viewport + 1, `El documento desborda en ${viewport.width}px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.bodyScrollWidth <= metrics.viewport + 1, `El body desborda en ${viewport.width}px.`);
  assert.equal(metrics.cards.length, 2);
  for (const card of metrics.cards) {
    assert.ok(card.left >= -1, `Tarjeta fuera por izquierda en ${viewport.width}px.`);
    assert.ok(card.right <= metrics.viewport + 1, `Tarjeta fuera por derecha en ${viewport.width}px.`);
    assert.ok(card.width <= metrics.viewport + 1, `Tarjeta demasiado ancha en ${viewport.width}px.`);
    for (const button of card.buttons) {
      assert.ok(button.left >= card.left - 1 && button.right <= card.right + 1, `Control fuera de tarjeta en ${viewport.width}px: ${button.text}`);
      assert.ok(button.height >= 43.5, `Control menor a 44px en ${viewport.width}px: ${button.text} (${button.height})`);
    }
  }
  for (const item of [...metrics.titles, ...metrics.interests]) {
    assert.equal(item.wordBreak, 'normal');
    assert.notEqual(item.overflowWrap, 'anywhere');
    assert.notEqual(item.hyphens, 'auto');
    assert.ok(item.width >= 64, `Bloque de texto colapsado en ${viewport.width}px: ${JSON.stringify(item)}`);
    assert.ok(item.lineRects.length <= item.words + 1, `Texto partido carácter por carácter en ${viewport.width}px: ${JSON.stringify(item)}`);
    assert.ok(item.lineRects.every((width) => width >= 22), `Línea ilegible en ${viewport.width}px: ${JSON.stringify(item)}`);
  }
  for (const button of metrics.autoButtons) {
    assert.equal(button.text, 'Calificar automáticamente');
    assert.ok(button.scrollWidth <= button.clientWidth + 1, `Texto truncado en botón automático a ${viewport.width}px.`);
    assert.ok(button.height >= 43.5);
  }
  assert.ok(metrics.counter.scrollLeft >= 0 && metrics.counter.scrollLeft <= 1, `Desplazamiento inicial inesperado en ${viewport.width}px: ${metrics.counter.scrollLeft}`);
  assert.ok(metrics.counter.firstLeft >= metrics.counter.containerLeft - 1, `Primer contador cortado en ${viewport.width}px.`);
  const pipelineIndex = metrics.cssOrder.indexOf('/src/lead-pipeline.css');
  const qualificationIndex = metrics.cssOrder.indexOf('/src/lead-qualification.css');
  const mobileLeadsIndex = metrics.cssOrder.indexOf('/src/mobile-leads-polish.css');
  assert.ok(pipelineIndex >= 0 && qualificationIndex > pipelineIndex && mobileLeadsIndex > qualificationIndex,
    `Orden CSS incorrecto: ${metrics.cssOrder.join(' -> ')}`);
}

async function assertFilterContrast(page: Page, width: number): Promise<void> {
  if (width > 720) return;
  if (width <= 520) await page.locator('#crm .mvp-lead-more-filters').evaluate((details: HTMLDetailsElement) => { details.open = true; });
  const colors = await page.evaluate(() => {
    const parse = (value: string): number[] => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    return [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-search-field input, #crm .mvp-lead-filter-grid select')].map((element) => {
      const style = getComputedStyle(element);
      return { foreground: parse(style.color), background: parse(style.backgroundColor), element: element.tagName };
    });
  });
  assert.ok(colors.length >= 3);
  for (const item of colors) {
    assert.ok(item.foreground.length === 3 && item.background.length === 3);
    assert.ok(contrastRatio(item.foreground, item.background) >= 4.5,
      `Contraste insuficiente en ${width}px: ${JSON.stringify(item)}`);
  }
}

async function openAndAnalyzePanel(page: Page, width: number): Promise<void> {
  await page.locator('#crm .mvp-lead-card').first().locator('[data-auto-qualify-client]').click();
  const panel = page.locator('#crm .lead-qualification-panel').first();
  await panel.waitFor({ state: 'visible' });
  const textarea = panel.locator('[data-qualification-text]');
  await textarea.fill([
    'Lucía: Busco una casa en Centro o General Paz.',
    'Lucía: Manejo USD 105.000, tengo una parte y financiaría el resto.',
    'Lucía: Es para vivir, conozco la zona y puedo avanzar en tres meses.',
  ].join('\n'));
  await panel.locator('[data-analyze-qualification]').click();
  await panel.locator('[data-apply-qualification]').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('#crm .lead-qualification-suggestion').length >= 4);

  const panelMetrics = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const textareaElement = element.querySelector<HTMLTextAreaElement>('[data-qualification-text]');
    const suggestions = [...element.querySelectorAll<HTMLElement>('.lead-qualification-suggestion')];
    return {
      viewport: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      left: rect.left,
      right: rect.right,
      textareaWidth: textareaElement?.getBoundingClientRect().width || 0,
      textareaParentWidth: textareaElement?.parentElement?.getBoundingClientRect().width || 0,
      suggestionOverflow: suggestions.some((suggestion) => suggestion.scrollWidth > suggestion.clientWidth + 1),
      suggestionCount: suggestions.length,
    };
  });
  assert.ok(panelMetrics.documentScrollWidth <= panelMetrics.viewport + 1, `Panel desborda documento en ${width}px.`);
  assert.ok(panelMetrics.left >= -1 && panelMetrics.right <= panelMetrics.viewport + 1, `Panel fuera del viewport en ${width}px.`);
  assert.ok(panelMetrics.textareaWidth <= panelMetrics.textareaParentWidth + 1, `Textarea desbordado en ${width}px.`);
  assert.equal(panelMetrics.suggestionOverflow, false, `Sugerencia desbordada en ${width}px.`);
  assert.ok(panelMetrics.suggestionCount >= 4);

const close = panel.locator('[data-close-qualification]');
const copy = panel.locator('[data-copy-next-question]');
const apply = panel.locator('[data-apply-qualification]');
assert.equal(await close.count(), 1);
assert.equal(await copy.count(), 1);
assert.equal(await apply.count(), 1);
await assertControlReachable(close, 'Cerrar panel', width);
await assertControlReachable(copy, 'Copiar próxima pregunta', width);
await assertControlReachable(apply, 'Aplicar calificación', width);

const focusTarget = panel.locator('[data-suggestion-value]:not([disabled]), [data-qualification-text]').last();
assert.ok(await focusTarget.count(), `No existe un campo editable para validar foco en ${width}px.`);
await focusTarget.focus();
await assertControlReachable(focusTarget, 'Campo enfocado', width, true);
}

async function assertBottomNavigationClearance(page: Page, width: number): Promise<void> {
  if (width > 720) return;
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(100);
  const result = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-card')];
    const last = cards.at(-1);
    const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');
    const lastRect = last?.getBoundingClientRect();
    const navRect = nav?.getBoundingClientRect();
    return {
      lastBottom: lastRect?.bottom ?? Infinity,
      navTop: navRect?.top ?? -Infinity,
      paddingBottom: parseFloat(getComputedStyle(document.querySelector<HTMLElement>('.mvp-content')!).paddingBottom),
      navHeight: navRect?.height ?? 0,
    };
  });
  assert.ok(result.paddingBottom > result.navHeight + 30, `Padding inferior insuficiente en ${width}px: ${JSON.stringify(result)}`);
  assert.ok(result.lastBottom <= result.navTop - 8, `La navegación tapa la última tarjeta en ${width}px: ${JSON.stringify(result)}`);
}

async function captureLeadsScreenshot(page: Page, viewport: { width: number; height: number }): Promise<void> {
  if (!screenshotWidths.has(viewport.width)) return;
  mkdirSync(artifactDirectory, { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({
    path: join(artifactDirectory, `leads-${viewport.width}x${viewport.height}.png`),
    fullPage: false,
    scale: 'css',
  });
}

async function capturePanelScreenshot(page: Page, viewport: { width: number; height: number }): Promise<void> {
  if (!screenshotWidths.has(viewport.width)) return;
  const panel = page.locator('#crm .lead-qualification-panel').first();
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(artifactDirectory, `leads-panel-${viewport.width}x${viewport.height}.png`),
    fullPage: false,
    scale: 'css',
  });
}

test('B1.2.2 valida Leads con DOM real, CSS real y navegación real en todos los anchos', { timeout: 240_000 }, async (t) => {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.GITHUB_ACTIONS === 'true') assert.fail('GitHub Actions no expone Chrome para validar B1.2.2.');
    t.skip('No hay Chrome/Chromium local.');
    return;
  }

  const index = readFileSync('index.html', 'utf8');
  assert.ok(index.indexOf('/src/lead-pipeline.css') < index.indexOf('/src/lead-qualification.css'));
  assert.ok(index.indexOf('/src/lead-qualification.css') < index.indexOf('/src/mobile-leads-polish.css'));

  rmSync(artifactDirectory, { recursive: true, force: true });
  mkdirSync(artifactDirectory, { recursive: true });
  const port = 43_000 + Math.floor(Math.random() * 2_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });

  try {
    for (const viewport of viewports) {
      const context = await createContext(browser, viewport);
      const page = await context.newPage();
      try {
        await waitForLeads(page, baseUrl);
        if (viewport.width === 360 || viewport.width === 412) {
          assert.ok(await page.evaluate(() => navigator.maxTouchPoints > 0));
          assert.match(await page.evaluate(() => navigator.userAgent), /Android|Mobile/i);
        }
        await assertBaseLayout(page, viewport);
        await assertFilterContrast(page, viewport.width);
        await page.locator('#crm .mvp-lead-matches').first().evaluate((details: HTMLDetailsElement) => { details.open = true; });
        const history = page.locator('#crm .mvp-lead-history').last();
        if (await history.count()) await history.evaluate((details: HTMLDetailsElement) => { details.open = true; });
        await captureLeadsScreenshot(page, viewport);
        await openAndAnalyzePanel(page, viewport.width);
        await capturePanelScreenshot(page, viewport);
        await assertBottomNavigationClearance(page, viewport.width);
      } finally {
        await page.close();
        await context.close();
      }
    }
    assertScreenshotArtifacts();
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
