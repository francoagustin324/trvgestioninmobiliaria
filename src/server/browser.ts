import { isIP } from 'node:net';
import { chromium, type Browser, type Page, type Route } from 'playwright';
import { isPrivateIp, validateSafeUrl } from './utils/safe-url.js';

const BLOCKED_RESOURCE_TYPES = new Set(['media', 'font']);
const MAX_JSON_PAYLOADS = 20;
const MAX_JSON_BYTES = 1_500_000;

function safeBrowserRequest(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost')) return false;
    if (isIP(host) && isPrivateIp(host)) return false;
    return true;
  } catch {
    return false;
  }
}

async function handleRoute(route: Route): Promise<void> {
  const request = route.request();
  if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
    await route.abort();
    return;
  }
  if (!safeBrowserRequest(request.url())) {
    await route.abort();
    return;
  }
  await route.continue();
}

async function gentlyRevealLazyContent(page: Page): Promise<void> {
  for (let step = 0; step < 5; step += 1) {
    await page.evaluate((position) => window.scrollTo(0, position * Math.max(window.innerHeight, 700)), step + 1);
    await page.waitForTimeout(350);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

export interface RenderedPage {
  html: string;
  finalUrl: URL;
  jsonPayloads: unknown[];
}

export async function fetchRenderedHtml(url: URL): Promise<RenderedPage> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
      locale: 'es-AR',
      viewport: { width: 1440, height: 1100 },
      extraHTTPHeaders: {
        'accept-language': 'es-AR,es;q=0.9,en;q=0.7',
      },
    });
    const page = await context.newPage();
    const jsonPayloads: unknown[] = [];
    const pendingJson: Promise<void>[] = [];

    page.on('response', (response) => {
      if (jsonPayloads.length >= MAX_JSON_PAYLOADS) return;
      const contentType = response.headers()['content-type'] || '';
      const resourceType = response.request().resourceType();
      if (!/application\/json|text\/json/i.test(contentType) || !['xhr', 'fetch', 'document'].includes(resourceType)) return;
      pendingJson.push((async () => {
        try {
          const text = await response.text();
          if (!text || text.length > MAX_JSON_BYTES || jsonPayloads.length >= MAX_JSON_PAYLOADS) return;
          jsonPayloads.push(JSON.parse(text));
        } catch {
          // Respuestas no JSON o ya consumidas: ignorar.
        }
      })());
    });

    await page.route('**/*', handleRoute);
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
    await gentlyRevealLazyContent(page);
    await page.waitForTimeout(1_000);
    await Promise.allSettled(pendingJson);

    const finalUrl = await validateSafeUrl(page.url(), false);
    const html = await page.content();
    if (html.length > 5_000_000) throw new Error('La página renderizada es demasiado grande.');
    return { html, finalUrl, jsonPayloads };
  } finally {
    await browser?.close();
  }
}
