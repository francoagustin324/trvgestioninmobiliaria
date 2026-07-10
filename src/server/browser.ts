import { chromium, type Browser, type Route } from 'playwright';
import { validateSafeUrl } from './utils/safe-url.js';

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

async function handleRoute(route: Route): Promise<void> {
  const request = route.request();
  if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
    await route.abort();
    return;
  }
  try {
    await validateSafeUrl(request.url(), false);
    await route.continue();
  } catch {
    await route.abort();
  }
}

export async function fetchRenderedHtml(url: URL): Promise<{ html: string; finalUrl: URL }> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
      locale: 'es-AR',
      viewport: { width: 1365, height: 900 },
    });
    const page = await context.newPage();
    await page.route('**/*', handleRoute);
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 18_000 });
    await page.waitForTimeout(1_500);
    const finalUrl = await validateSafeUrl(page.url(), false);
    const html = await page.content();
    if (html.length > 4_000_000) throw new Error('La página renderizada es demasiado grande.');
    return { html, finalUrl };
  } finally {
    await browser?.close();
  }
}
