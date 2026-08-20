import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { webkit, type Browser, type BrowserContext, type Page } from 'playwright';
import { initialData, type CrmData, type TeamMember } from '../models.js';

const USER_ID = 'hotfix-leads-ux-r2-owner';
const ORG_ID = 'hotfix-leads-ux-r2-org';
const STORAGE_KEY = `trv-crm-basico:user:${USER_ID}`;
const PORT = 62753;
const HIDDEN_SEARCH = '__r2_lead_oculto__';
const HIDDEN_MESSAGE = 'Este lead está oculto por los filtros actuales. Ajustá o limpiá los filtros para verlo sin perder tu selección.';

interface ScrollCall {
  clientId: string;
  behavior: string;
  block: string;
  inline: string;
}

interface TargetMetrics {
  count: number;
  heights: number[];
  widths: number[];
  minHeight: number;
  minWidth: number;
}

interface StageContrastMetric {
  labelColor: string;
  counterColor: string;
  backgroundColor: string;
  effectiveBackground: string;
  labelRatio: number;
  counterRatio: number;
  stage: string;
  centered: boolean;
  brown: boolean;
}

interface HorizontalMetrics {
  viewport: number;
  document: number;
  body: number;
  queue: { x: number; width: number } | null;
  stageCounters: { x: number; width: number } | null;
  buttons: Array<{ x: number; width: number }>;
  content: { x: number; width: number } | null;
}

function teamMember(id: number, userId: string, name: string, role: 'Dueño' | 'Corredor'): TeamMember {
  return {
    id,
    userId,
    name,
    email: `${userId}@propcontrol.test`,
    role,
    status: 'Activo',
    createdAt: '2026-08-20T12:00:00.000Z',
  };
}

function fixture(): CrmData {
  const crm = structuredClone(initialData);
  const owner = teamMember(1, USER_ID, 'Franco R2', 'Dueño');
  const broker = teamMember(2, 'hotfix-leads-ux-r2-broker', 'Corredor R2', 'Corredor');
  crm.organization = { id: ORG_ID, name: 'TRV Gestión Inmobiliaria', seatLimit: null, planLabel: 'Hotfix Leads UX R2' };
  crm.teamMembers = [owner, broker];
  crm.activityLog = [];
  crm.clients = [
    {
      id: 501,
      name: 'Lead R2 Prioritario',
      phone: '+54 9 351 500-0501',
      email: 'prioritario@propcontrol.test',
      interest: 'Dúplex en Docta',
      budget: 'USD 120000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Caliente',
      pipeline: 'Contactado',
      nextAction: 'Contactar por seguimiento vencido',
      nextFollowUp: '2020-01-01',
      assignedToId: 1,
      createdById: 1,
    },
    {
      id: 502,
      name: 'Lead R2 Dos',
      phone: '+54 9 351 500-0502',
      email: 'dos@propcontrol.test',
      interest: 'Departamento en General Paz',
      budget: 'USD 90000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Tibio',
      pipeline: 'Nuevo',
      assignedToId: 2,
      createdById: 1,
    },
    {
      id: 503,
      name: 'Lead R2 Tres',
      phone: '+54 9 351 500-0503',
      email: 'tres@propcontrol.test',
      interest: 'Casa en Urca',
      budget: 'USD 180000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Frío',
      pipeline: 'Nuevo',
      assignedToId: 2,
      createdById: 1,
    },
    {
      id: 504,
      name: 'Lead R2 Cuatro',
      phone: '+54 9 351 500-0504',
      email: 'cuatro@propcontrol.test',
      interest: 'Terreno en Docta',
      budget: 'USD 60000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Tibio',
      pipeline: 'Contactado',
      nextAction: 'Enviar alternativas',
      nextFollowUp: '2030-01-10',
      assignedToId: 1,
      createdById: 1,
    },
    {
      id: 505,
      name: 'Lead R2 Cinco',
      phone: '+54 9 351 500-0505',
      email: 'cinco@propcontrol.test',
      interest: 'Departamento en Centro',
      budget: 'USD 55000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Tibio',
      pipeline: 'Contactado',
      nextAction: 'Confirmar visita',
      nextFollowUp: '2030-01-11',
      assignedToId: 1,
      createdById: 1,
    },
    {
      id: 506,
      name: 'Lead R2 Seis',
      phone: '+54 9 351 500-0506',
      email: 'seis@propcontrol.test',
      interest: 'Dúplex en Manantiales',
      budget: 'USD 145000',
      currency: 'USD',
      status: 'Lead',
      temperature: 'Caliente',
      pipeline: 'Calificado',
      nextAction: 'Presentar propuesta',
      nextFollowUp: '2030-01-12',
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
    profileName: owner.name,
    profileEmail: owner.email,
    agencyName: 'TRV Gestión Inmobiliaria',
  };
  return crm;
}

async function startServer(): Promise<ChildProcess> {
  const server = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
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

  await new Promise<void>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    server.stdout?.setEncoding('utf8');
    server.stderr?.setEncoding('utf8');
    server.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.includes('PropControl listo en')) resolve();
    });
    server.stderr?.on('data', (chunk: string) => { stderr += chunk; });
    server.once('error', reject);
    server.once('exit', (code, signal) => {
      if (!stdout.includes('PropControl listo en')) {
        reject(new Error(`Servidor R2 finalizó antes de estar listo: code=${code} signal=${signal} stderr=${stderr}`));
      }
    });
  });

  return server;
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  await exited;
}

async function seedContext(context: BrowserContext): Promise<void> {
  const actorKey = `cloud:${USER_ID}`;
  const identityKey = `propcontrol-whatsapp-human-identity-v1:${encodeURIComponent(ORG_ID)}:1:${encodeURIComponent(actorKey)}`;
  await context.addInitScript(({ crm, identityStorageKey, storageKey }) => {
    localStorage.setItem('propcontrol-cloud-session-v1', JSON.stringify({
      accessToken: 'access-r2',
      refreshToken: 'refresh-r2',
      expiresAt: Date.now() + 3_600_000,
      userId: 'hotfix-leads-ux-r2-owner',
      email: 'hotfix-leads-ux-r2-owner@propcontrol.test',
    }));
    localStorage.setItem(storageKey, JSON.stringify(crm));
    localStorage.setItem(`${storageKey}:sync`, JSON.stringify({
      dirty: false,
      localUpdatedAt: '2026-08-20T15:00:00.000Z',
      lastCloudSavedAt: '2026-08-20T15:00:00.000Z',
      lastCloudVersion: '2026-08-20T15:00:00.000Z',
    }));
    localStorage.setItem('propcontrol-active-team-member-v1', '1');
    localStorage.setItem(identityStorageKey, JSON.stringify({
      version: 1,
      organizationId: 'hotfix-leads-ux-r2-org',
      memberId: 1,
      actorKey: 'cloud:hotfix-leads-ux-r2-owner',
      humanName: 'Franco R2',
      confirmedAt: '2026-08-20T15:00:00.000Z',
    }));

    const scope = window as unknown as { __pcR2ScrollCalls?: ScrollCall[] };
    scope.__pcR2ScrollCalls = [];
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(options?: boolean | ScrollIntoViewOptions): void {
      const element = this as HTMLElement;
      const card = element.closest<HTMLElement>('[data-client-id]');
      const normalized = typeof options === 'object' && options !== null ? options : {};
      scope.__pcR2ScrollCalls?.push({
        clientId: card?.dataset.clientId || '',
        behavior: String(normalized.behavior || ''),
        block: String(normalized.block || ''),
        inline: String(normalized.inline || ''),
      });
      originalScrollIntoView.call(this, options);
    };
  }, { crm: fixture(), identityStorageKey: identityKey, storageKey: STORAGE_KEY });
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

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crm.active', { state: 'visible' });
  await page.waitForSelector('#crm.pc-leads-redesign', { state: 'visible' });
  await page.waitForSelector('#crm .pc-supervised-attention-item[data-attention-client-id]', { state: 'visible' });
  await page.waitForSelector('#crm .mvp-stage-counter[data-stage-quick="Todas"]', { state: 'visible' });
  await page.waitForFunction(() => {
    const todos = document.querySelector<HTMLElement>('#crm .mvp-stage-counter[data-stage-quick="Todas"]');
    if (!todos?.classList.contains('active') || todos.getAttribute('aria-pressed') !== 'true') return false;
    for (let index = 0; index < localStorage.length; index += 1) {
      if (localStorage.key(index)?.includes('supervised-recommendation-lifecycle-v3')) return true;
    }
    return false;
  });
}

async function targetClientId(page: Page): Promise<number> {
  const value = await page.locator('#crm .pc-supervised-attention-item[data-attention-client-id]').first().getAttribute('data-attention-client-id');
  const clientId = Number(value || 0);
  assert.ok(clientId > 0, `ATENDER AHORA debe exponer un clientId real; recibido ${value}.`);
  assert.equal(clientId, 501, `El fixture R2 debe priorizar al lead 501; recibido ${value}.`);
  return clientId;
}

async function clearScrollEvidence(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as { __pcR2ScrollCalls?: ScrollCall[] };
    scope.__pcR2ScrollCalls = [];
  });
}

async function assertOpened(page: Page, clientId: number): Promise<void> {
  await page.waitForFunction((id) => {
    const card = document.querySelector<HTMLElement>(`.mvp-lead-card[data-client-id="${id}"]`);
    const details = card?.querySelector<HTMLDetailsElement>(`details[data-lead-full-sheet="${id}"]`);
    const summary = details?.querySelector<HTMLElement>(':scope > summary');
    const content = details?.querySelector<HTMLElement>('.mvp-lead-full-content');
    const openSheets = [...document.querySelectorAll<HTMLDetailsElement>('details[data-lead-full-sheet][open]')];
    const scope = window as unknown as { __pcR2ScrollCalls?: ScrollCall[] };
    const scrollObserved = (scope.__pcR2ScrollCalls || []).some((call) => (
      call.clientId === String(id)
      && call.behavior === 'smooth'
      && call.block === 'center'
      && call.inline === 'nearest'
    ));
    const rect = card?.getBoundingClientRect();
    return Boolean(
      card
      && details?.open
      && summary
      && content
      && content.getClientRects().length > 0
      && card.classList.contains('pc-attention-target')
      && document.activeElement === summary
      && summary.getAttribute('aria-expanded') === 'true'
      && openSheets.length === 1
      && openSheets[0] === details
      && scrollObserved
      && rect
      && rect.bottom > 0
      && rect.top < window.innerHeight
    );
  }, clientId);

  const openIds = await page.locator('details[data-lead-full-sheet][open]').evaluateAll((elements) => (
    elements.map((element) => Number((element as HTMLElement).dataset.leadFullSheet || 0))
  ));
  assert.deepEqual(openIds, [clientId], 'Sólo debe abrirse la ficha del clientId activado.');
  assert.equal(
    await page.locator(`.mvp-lead-card[data-client-id="${clientId}"] details[data-lead-full-sheet="${clientId}"] > summary > span`).textContent(),
    'Ocultar ficha',
  );
}

async function closeSheet(page: Page, clientId: number): Promise<void> {
  const details = page.locator(`.mvp-lead-card[data-client-id="${clientId}"] details[data-lead-full-sheet="${clientId}"]`);
  if (await details.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await details.locator(':scope > summary').click();
  }
  await page.waitForFunction((id) => {
    const details = document.querySelector<HTMLDetailsElement>(`details[data-lead-full-sheet="${id}"]`);
    return Boolean(details && !details.open && details.querySelector('summary')?.getAttribute('aria-expanded') === 'false');
  }, clientId);
  await clearScrollEvidence(page);
}

async function crmSnapshot(page: Page): Promise<string> {
  return page.evaluate((storageKey) => localStorage.getItem(storageKey) || '', STORAGE_KEY);
}

async function whatsAppSnapshot(page: Page): Promise<Array<[string, string | null]>> {
  return page.evaluate(() => {
    const entries: Array<[string, string | null]> = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.toLowerCase().includes('whatsapp')) entries.push([key, localStorage.getItem(key)]);
    }
    return entries.sort(([left], [right]) => left.localeCompare(right));
  });
}

async function telemetrySnapshot(page: Page): Promise<{ entries: Array<[string, string | null]>; eventTypes: string[] }> {
  return page.evaluate(() => {
    const entries: Array<[string, string | null]> = [];
    const eventTypes: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (record.eventType === 'RECOMMENDATION_SHOWN' || record.eventType === 'RECOMMENDATION_DECISION') {
        eventTypes.push(String(record.eventType));
      }
      Object.values(record).forEach(walk);
    };
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.includes('supervised-recommendation')) continue;
      const raw = localStorage.getItem(key);
      entries.push([key, raw]);
      if (!raw) continue;
      try { walk(JSON.parse(raw)); } catch { /* conservar evidencia raw */ }
    }
    entries.sort(([left], [right]) => left.localeCompare(right));
    eventTypes.sort();
    return { entries, eventTypes };
  });
}

async function filterSnapshot(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => ({
    search: document.querySelector<HTMLInputElement>('#mvp-lead-search')?.value || '',
    stage: document.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter')?.value || '',
    temperature: document.querySelector<HTMLSelectElement>('#mvp-lead-temperature-filter')?.value || '',
    assignee: document.querySelector<HTMLSelectElement>('#mvp-lead-assignee-filter')?.value || '',
    order: document.querySelector<HTMLSelectElement>('#mvp-lead-order')?.value || '',
  }));
}

async function todosMetrics(page: Page): Promise<{
  active: boolean;
  display: string;
  alignItems: string;
  justifyContent: string;
  background: string;
  buttonTextDelta: number;
  buttonCountDelta: number;
  textCountDelta: number;
  stage: string;
  order: string;
  orderLabel: string;
}> {
  return page.locator('#crm .mvp-stage-counter[data-stage-quick="Todas"]').evaluate((element) => {
    const count = element.querySelector<HTMLElement>('b');
    const textNode = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === 'Todos');
    if (!count || !textNode) throw new Error('Geometría de Todos incompleta.');
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const buttonRect = element.getBoundingClientRect();
    const textRect = range.getBoundingClientRect();
    const countRect = count.getBoundingClientRect();
    const buttonCenter = buttonRect.top + buttonRect.height / 2;
    const textCenter = textRect.top + textRect.height / 2;
    const countCenter = countRect.top + countRect.height / 2;
    const style = getComputedStyle(element);
    const stage = document.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter');
    const order = document.querySelector<HTMLSelectElement>('#mvp-lead-order');
    return {
      active: element.classList.contains('active') && buttonRect.width > 0 && buttonRect.height > 0,
      display: style.display,
      alignItems: style.alignItems,
      justifyContent: style.justifyContent,
      background: style.backgroundColor,
      buttonTextDelta: Math.abs(buttonCenter - textCenter),
      buttonCountDelta: Math.abs(buttonCenter - countCenter),
      textCountDelta: Math.abs(textCenter - countCenter),
      stage: stage?.value || '',
      order: order?.value || '',
      orderLabel: order?.selectedOptions[0]?.textContent?.trim() || '',
    };
  });
}

function assertTodosMetrics(metrics: Awaited<ReturnType<typeof todosMetrics>>, label: string): void {
  assert.equal(metrics.active, true, `${label}: Todos debe estar activo y visible.`);
  assert.ok(metrics.display === 'flex' || metrics.display === 'inline-flex', `${label}: display inesperado ${metrics.display}.`);
  assert.equal(metrics.alignItems, 'center', `${label}: align-items debe ser center.`);
  assert.equal(metrics.justifyContent, 'center', `${label}: justify-content debe ser center.`);
  assert.match(metrics.background, /62\s*,\s*105\s*,\s*84/, `${label}: debe conservar fondo verde sutil.`);
  assert.doesNotMatch(metrics.background, /110\s*,\s*90\s*,\s*36/, `${label}: no debe volver el fondo marrón anterior.`);
  assert.ok(metrics.buttonTextDelta <= 1.5, `${label}: texto Todos descentrado ${metrics.buttonTextDelta}px.`);
  assert.ok(metrics.buttonCountDelta <= 1.5, `${label}: contador descentrado ${metrics.buttonCountDelta}px.`);
  assert.ok(metrics.textCountDelta <= 1.5, `${label}: texto/contador desalineados ${metrics.textCountDelta}px.`);
  assert.equal(metrics.stage, 'Todas', `${label}: la etapa funcional debe seguir siendo Todas.`);
  assert.equal(metrics.order, 'recent', `${label}: el orden inicial debe seguir siendo recent.`);
  assert.equal(metrics.orderLabel, 'Más recientes', `${label}: la etiqueta histórica debe seguir siendo Más recientes.`);
}

async function targetMetrics(page: Page): Promise<TargetMetrics> {
  return page.locator('#crm button.pc-supervised-attention-item[data-attention-client-id]').evaluateAll((elements) => {
    const rects = elements
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => (element as HTMLElement).getBoundingClientRect());
    const heights = rects.map((rect) => rect.height);
    const widths = rects.map((rect) => rect.width);
    return {
      count: rects.length,
      heights,
      widths,
      minHeight: heights.length ? Math.min(...heights) : 0,
      minWidth: widths.length ? Math.min(...widths) : 0,
    };
  });
}

function assertTargetMetrics(metrics: TargetMetrics, label: string): void {
  assert.equal(metrics.count, 3, `${label}: el fixture debe mostrar exactamente 3 recomendaciones.`);
  metrics.heights.forEach((height, index) => assert.ok(height >= 44, `${label}: target ${index + 1} mide ${height}px de alto.`));
  metrics.widths.forEach((width, index) => assert.ok(width >= 44, `${label}: target ${index + 1} mide ${width}px de ancho.`));
}

async function stageContrastMetric(page: Page): Promise<StageContrastMetric> {
  return page.locator('#crm .mvp-stage-counter[data-stage-quick="Todas"]').evaluate((chip) => {
    type Rgba = { r: number; g: number; b: number; a: number };
    const parse = (value: string): Rgba => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      const captured = match?.[1];
      if (!captured) throw new Error(`Color no interpretable: ${value}`);
      const parts = captured.split(/[ ,/]+/).filter(Boolean).map(Number);
      const [r = 0, g = 0, b = 0, alpha = 1] = parts;
      return { r, g, b, a: alpha };
    };
    const blend = (top: Rgba, bottom: Rgba): Rgba => {
      const a = top.a + bottom.a * (1 - top.a);
      if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: ((top.r * top.a) + (bottom.r * bottom.a * (1 - top.a))) / a,
        g: ((top.g * top.a) + (bottom.g * bottom.a * (1 - top.a))) / a,
        b: ((top.b * top.a) + (bottom.b * bottom.a * (1 - top.a))) / a,
        a,
      };
    };
    const effectiveBackground = (element: Element): Rgba => {
      const chain: Element[] = [];
      for (let current: Element | null = element; current; current = current.parentElement) chain.push(current);
      let result: Rgba = { r: 255, g: 255, b: 255, a: 1 };
      for (const current of chain.reverse()) result = blend(parse(getComputedStyle(current).backgroundColor), result);
      return result;
    };
    const channel = (value: number): number => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (color: Rgba): number => (
      0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
    );
    const ratio = (foreground: Rgba, background: Rgba): number => {
      const lighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      return (lighter + 0.05) / (darker + 0.05);
    };
    const serialize = (color: Rgba): string => `rgba(${color.r.toFixed(2)}, ${color.g.toFixed(2)}, ${color.b.toFixed(2)}, ${color.a.toFixed(3)})`;
    const background = effectiveBackground(chip);
    const labelStyle = getComputedStyle(chip);
    const counter = chip.querySelector<HTMLElement>('b');
    if (!counter) throw new Error('Todos no tiene contador.');
    const label = blend(parse(labelStyle.color), background);
    const numeric = blend(parse(getComputedStyle(counter).color), background);

    const textNode = [...chip.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === 'Todos');
    if (!textNode) throw new Error('Todos no tiene nodo de texto.');
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const chipRect = chip.getBoundingClientRect();
    const textRect = range.getBoundingClientRect();
    const counterRect = counter.getBoundingClientRect();
    const center = chipRect.top + chipRect.height / 2;
    const centered = Math.abs(center - (textRect.top + textRect.height / 2)) <= 1.5
      && Math.abs(center - (counterRect.top + counterRect.height / 2)) <= 1.5;
    const rawBackground = labelStyle.backgroundColor;
    return {
      labelColor: labelStyle.color,
      counterColor: getComputedStyle(counter).color,
      backgroundColor: rawBackground,
      effectiveBackground: serialize(background),
      labelRatio: ratio(label, background),
      counterRatio: ratio(numeric, background),
      stage: document.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter')?.value || '',
      centered,
      brown: /110\s*,\s*90\s*,\s*36/.test(rawBackground),
    };
  });
}

function assertContrast(metric: StageContrastMetric, label: string): void {
  assert.ok(metric.labelRatio >= 4.5, `${label}: contraste label ${metric.labelRatio.toFixed(2)} < 4.5.`);
  assert.ok(metric.counterRatio >= 4.5, `${label}: contraste contador ${metric.counterRatio.toFixed(2)} < 4.5.`);
  assert.equal(metric.brown, false, `${label}: no debe reaparecer rgb(110,90,36).`);
  assert.equal(metric.centered, true, `${label}: Todos debe seguir centrado.`);
  assert.equal(metric.stage, 'Todas', `${label}: stage debe seguir siendo Todas.`);
}

async function horizontalMetrics(page: Page, clientId?: number): Promise<HorizontalMetrics> {
  return page.evaluate((id) => {
    const rect = (element: Element | null): { x: number; width: number } | null => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, width: box.width };
    };
    const buttons = [...document.querySelectorAll<HTMLElement>('button.pc-supervised-attention-item[data-attention-client-id]')]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => rect(element))
      .filter((item): item is { x: number; width: number } => Boolean(item));
    const content = id
      ? rect(document.querySelector(`.mvp-lead-card[data-client-id="${id}"] .mvp-lead-full-content`))
      : null;
    return {
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      queue: rect(document.querySelector('.pc-supervised-attention-queue')),
      stageCounters: rect(document.querySelector('.mvp-stage-counters')),
      buttons,
      content,
    };
  }, clientId || 0);
}

function assertHorizontal(metrics: HorizontalMetrics, label: string, contentExpected: boolean): void {
  assert.ok(metrics.document <= metrics.viewport + 1, `${label}: overflow document ${metrics.document - metrics.viewport}px.`);
  assert.ok(metrics.body <= metrics.viewport + 1, `${label}: overflow body ${metrics.body - metrics.viewport}px.`);
  for (const [name, item] of [['queue', metrics.queue], ['stageCounters', metrics.stageCounters]] as const) {
    assert.ok(item, `${label}: ${name} debe tener geometría.`);
    assert.ok(item.x >= -1, `${label}: ${name} sale por izquierda x=${item.x}.`);
    assert.ok(item.x + item.width <= metrics.viewport + 1, `${label}: ${name} sale por derecha ${item.x + item.width}px.`);
  }
  metrics.buttons.forEach((item, index) => {
    assert.ok(item.x >= -1, `${label}: button ${index + 1} sale por izquierda.`);
    assert.ok(item.x + item.width <= metrics.viewport + 1, `${label}: button ${index + 1} sale por derecha.`);
  });
  if (contentExpected) {
    assert.ok(metrics.content, `${label}: ficha abierta debe tener geometría.`);
    assert.ok(metrics.content.x >= -1, `${label}: ficha sale por izquierda.`);
    assert.ok(metrics.content.x + metrics.content.width <= metrics.viewport + 1, `${label}: ficha sale por derecha.`);
  }
}

test('HOTFIX UX POST-B1.4.2 R3 — mobile tap, target y contraste accesible exact-SHA', async (t) => {
  const server = await startServer();
  const browser = await webkit.launch({ headless: true });
  const url = `http://127.0.0.1:${PORT}`;

  try {
    await t.test('A desktop: Todos conserva visual neutro, centrado, stage=Todas y contraste >=4.5', async () => {
      const context = await createContext(browser, { width: 1366, height: 768 }, false);
      try {
        const page = await context.newPage();
        await load(page, url);
        assertTodosMetrics(await todosMetrics(page), 'desktop');
        const normal = await stageContrastMetric(page);
        assertContrast(normal, 'desktop normal');
        const todos = page.locator('#crm .mvp-stage-counter[data-stage-quick="Todas"]');
        await todos.hover();
        const hover = await stageContrastMetric(page);
        assertContrast(hover, 'desktop hover');
        console.log(`R3_CONTRAST desktop ${JSON.stringify({ normal, hover })}`);
      } finally {
        await context.close();
      }
    });

    await t.test('B desktop: click real abre clientId exacto, foco/scroll y cero mutación CRM/telemetría', async () => {
      const context = await createContext(browser, { width: 1366, height: 768 }, false);
      try {
        const page = await context.newPage();
        await load(page, url);
        const clientId = await targetClientId(page);
        assert.equal(await page.locator('#crm .pc-supervised-attention-item[data-attention-client-id]').count(), 3, 'ATENDER AHORA debe respetar max3.');
        const queueButton = page.locator(`#crm button.pc-supervised-attention-item[data-attention-client-id="${clientId}"]`).first();
        assert.equal(await queueButton.evaluate((element) => element.tagName), 'BUTTON');
        assert.equal(await queueButton.getAttribute('type'), 'button');
        assert.match(await queueButton.getAttribute('aria-label') || '', /Abrir ficha completa de Lead R2 Prioritario/);

        const crmBefore = await crmSnapshot(page);
        const whatsappBefore = await whatsAppSnapshot(page);
        const telemetryBefore = await telemetrySnapshot(page);
        assert.ok(telemetryBefore.eventTypes.includes('RECOMMENDATION_SHOWN'), 'Debe aislarse SHOWN legítimo del render inicial.');
        assert.equal(telemetryBefore.eventTypes.includes('RECOMMENDATION_DECISION'), false, 'Render inicial no debe contener DECISION.');

        await clearScrollEvidence(page);
        await queueButton.click();
        await assertOpened(page, clientId);

        assert.equal(await crmSnapshot(page), crmBefore, 'Navegar no debe mutar CRM persistido.');
        assert.deepEqual(await whatsAppSnapshot(page), whatsappBefore, 'Navegar no debe mutar estado comercial WhatsApp.');
        assert.deepEqual(await telemetrySnapshot(page), telemetryBefore, 'Navegar no debe mutar lifecycle/outbox ni generar DECISION.');
      } finally {
        await context.close();
      }
    });

    await t.test('C desktop: Enter y Space heredan activación nativa y abren el lead correcto', async () => {
      const context = await createContext(browser, { width: 1366, height: 768 }, false);
      try {
        const page = await context.newPage();
        await load(page, url);
        const clientId = await targetClientId(page);
        const queueButton = page.locator(`#crm button.pc-supervised-attention-item[data-attention-client-id="${clientId}"]`).first();

        await clearScrollEvidence(page);
        await queueButton.focus();
        assert.equal(await queueButton.evaluate((element) => document.activeElement === element), true);
        await page.keyboard.press('Enter');
        await assertOpened(page, clientId);

        await closeSheet(page, clientId);
        await queueButton.focus();
        assert.equal(await queueButton.evaluate((element) => document.activeElement === element), true);
        await page.keyboard.press('Space');
        await assertOpened(page, clientId);
      } finally {
        await context.close();
      }
    });

    await t.test('D desktop: hidden-by-filter conserva filtros, card oculta y aviso accesible', async () => {
      const context = await createContext(browser, { width: 1366, height: 768 }, false);
      try {
        const page = await context.newPage();
        await load(page, url);
        const clientId = await targetClientId(page);
        const filtersBaseline = await filterSnapshot(page);
        assert.deepEqual(filtersBaseline, { search: '', stage: 'Todas', temperature: 'Todas', assignee: 'Todos', order: 'recent' });

        const search = page.locator('#mvp-lead-search');
        assert.equal(await search.isVisible(), true, 'El filtro usado debe ser UI real visible.');
        await search.fill(HIDDEN_SEARCH);
        await page.waitForFunction((id) => !document.querySelector(`#mvp-lead-results .mvp-lead-card[data-client-id="${id}"]`), clientId);

        const filtersBefore = await filterSnapshot(page);
        assert.deepEqual(filtersBefore, { ...filtersBaseline, search: HIDDEN_SEARCH });
        const crmBefore = await crmSnapshot(page);
        const telemetryBefore = await telemetrySnapshot(page);

        await page.locator(`#crm button.pc-supervised-attention-item[data-attention-client-id="${clientId}"]`).first().click();
        await page.waitForFunction((message) => {
          const status = document.querySelector<HTMLElement>('[data-attention-navigation-status]');
          return Boolean(status && !status.hidden && status.textContent?.trim() === message && status.getAttribute('role') === 'status' && status.getAttribute('aria-live') === 'polite');
        }, HIDDEN_MESSAGE);

        assert.deepEqual(await filterSnapshot(page), filtersBefore, 'ATENDER AHORA no debe resetear filtros.');
        assert.equal(await page.locator(`#mvp-lead-results .mvp-lead-card[data-client-id="${clientId}"]`).count(), 0, 'Lead debe seguir oculto.');
        assert.equal(await crmSnapshot(page), crmBefore, 'Lead oculto no debe mutar CRM.');
        assert.deepEqual(await telemetrySnapshot(page), telemetryBefore, 'Lead oculto no debe generar DECISION.');
      } finally {
        await context.close();
      }
    });

    await t.test('E targets: desktop, 390x844 y 320x568 miden >=44px en todas las recomendaciones visibles', async () => {
      const specs = [
        { name: 'desktop', viewport: { width: 1366, height: 768 }, mobile: false },
        { name: '390x844', viewport: { width: 390, height: 844 }, mobile: true },
        { name: '320x568', viewport: { width: 320, height: 568 }, mobile: true },
      ];
      const collected: Array<{ name: string; metrics: TargetMetrics }> = [];
      for (const spec of specs) {
        const context = await createContext(browser, spec.viewport, spec.mobile);
        try {
          const page = await context.newPage();
          await load(page, url);
          collected.push({ name: spec.name, metrics: await targetMetrics(page) });
        } finally {
          await context.close();
        }
      }
      collected.forEach(({ name, metrics }) => {
        console.log(`R3_TARGET ${name} ${JSON.stringify(metrics)}`);
        assertTargetMetrics(metrics, name);
      });
    });

    await t.test('F contraste mobile: 390x844 y 320x568 label/contador >=4.5, centrados y sin marrón', async () => {
      const specs = [
        { name: '390x844', viewport: { width: 390, height: 844 } },
        { name: '320x568', viewport: { width: 320, height: 568 } },
      ];
      const collected: Array<{ name: string; visual: Awaited<ReturnType<typeof todosMetrics>>; contrast: StageContrastMetric }> = [];
      for (const spec of specs) {
        const context = await createContext(browser, spec.viewport, true);
        try {
          const page = await context.newPage();
          await load(page, url);
          collected.push({ name: spec.name, visual: await todosMetrics(page), contrast: await stageContrastMetric(page) });
        } finally {
          await context.close();
        }
      }
      collected.forEach(({ name, visual, contrast }) => {
        assertTodosMetrics(visual, name);
        assertContrast(contrast, name);
        console.log(`R3_CONTRAST ${name} ${JSON.stringify(contrast)}`);
      });
    });

    await t.test('G tap mobile 390x844: tap real abre exactamente la ficha correcta y mantiene foco/estado accesible', async () => {
      const context = await createContext(browser, { width: 390, height: 844 }, true);
      try {
        const page = await context.newPage();
        await load(page, url);
        const clientId = await targetClientId(page);
        const button = page.locator(`#crm button.pc-supervised-attention-item[data-attention-client-id="${clientId}"]`).first();
        await clearScrollEvidence(page);
        await button.tap();
        await assertOpened(page, clientId);
        const content = page.locator(`.mvp-lead-card[data-client-id="${clientId}"] .mvp-lead-full-content`);
        assert.equal(await content.isVisible(), true, 'Ficha mobile debe ser visible.');
        assert.ok((await content.innerText()).trim().length > 0, 'Ficha mobile debe contener información legible.');
      } finally {
        await context.close();
      }
    });

    await t.test('H overflow 390x844: cero overflow antes y después del tap; cola/buttons/stages/ficha dentro de viewport', async () => {
      const context = await createContext(browser, { width: 390, height: 844 }, true);
      try {
        const page = await context.newPage();
        await load(page, url);
        const before = await horizontalMetrics(page);
        console.log(`R3_OVERFLOW 390x844 before ${JSON.stringify(before)}`);
        assertHorizontal(before, '390x844 before', false);

        const clientId = await targetClientId(page);
        await clearScrollEvidence(page);
        await page.locator(`#crm button.pc-supervised-attention-item[data-attention-client-id="${clientId}"]`).first().tap();
        await assertOpened(page, clientId);
        const after = await horizontalMetrics(page, clientId);
        console.log(`R3_OVERFLOW 390x844 after ${JSON.stringify(after)}`);
        assertHorizontal(after, '390x844 after', true);
      } finally {
        await context.close();
      }
    });

    await t.test('I overflow 320x568: cero overflow antes y después del tap; cola/buttons/stages/ficha dentro de viewport', async () => {
      const context = await createContext(browser, { width: 320, height: 568 }, true);
      try {
        const page = await context.newPage();
        await load(page, url);
        const before = await horizontalMetrics(page);
        console.log(`R3_OVERFLOW 320x568 before ${JSON.stringify(before)}`);
        assertHorizontal(before, '320x568 before', false);

        const clientId = await targetClientId(page);
        await clearScrollEvidence(page);
        await page.locator(`#crm button.pc-supervised-attention-item[data-attention-client-id="${clientId}"]`).first().tap();
        await assertOpened(page, clientId);
        const after = await horizontalMetrics(page, clientId);
        console.log(`R3_OVERFLOW 320x568 after ${JSON.stringify(after)}`);
        assertHorizontal(after, '320x568 after', true);
      } finally {
        await context.close();
      }
    });
  } finally {
    await browser.close();
    await stopServer(server);
  }
});
