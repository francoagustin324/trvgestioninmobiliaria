import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

export const PRODUCTION_ENVIRONMENT = 'joyful-success / production';
export const ROOT_MARKER = /<title>\s*PropControl\s*\|\s*CRM inmobiliario\s*<\/title>/i;
export const BROWSER_MARKER = 'main.public-auth-shell #public-auth-form';
export const MAX_REQUEST_ATTEMPTS = 2;
export const REQUEST_TIMEOUT_MS = 3_000;
export const RETRY_DELAY_MS = 200;

const ARTIFACT_DIR = resolve('artifacts', 'post-deploy-smoke');
const LOG_PATH = resolve(ARTIFACT_DIR, 'smoke.log');
const SCREENSHOT_PATH = resolve(ARTIFACT_DIR, 'production-smoke.png');
const JAVASCRIPT_MIME = /^(?:text|application)\/(?:javascript|ecmascript|x-javascript)(?:;|$)/i;
const CSS_MIME = /^text\/css(?:;|$)/i;

function noop() {}

export function normalizeBaseUrl(value, { allowHttp = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('PRODUCTION_BASE_URL no está configurada.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('PRODUCTION_BASE_URL no es una URL válida.'); }
  if (url.username || url.password) throw new Error('PRODUCTION_BASE_URL no puede contener credenciales.');
  if (url.search || url.hash) throw new Error('PRODUCTION_BASE_URL no puede contener querystring ni fragmento.');
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new Error('PRODUCTION_BASE_URL debe usar HTTPS.');
  }
  url.pathname = url.pathname.replace(/\/+$/g, '') || '/';
  return url;
}

export function publicBaseUrl(value) {
  const url = new URL(value.href);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.href;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function shortError(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function fetchWithRetry(url, {
  fetchImpl = fetch,
  log = noop,
  label = 'request',
  maxAttempts = MAX_REQUEST_ATTEMPTS,
  timeoutMs = REQUEST_TIMEOUT_MS,
  retryDelayMs = RETRY_DELAY_MS,
} = {}) {
  let lastNetworkError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'PropControl-PostDeploy-Smoke/1.0' },
      });
      if (response.status >= 500 && attempt < maxAttempts) {
        log(`RETRY ${label}: HTTP ${response.status}; intento ${attempt + 1}/${maxAttempts}`);
        await sleep(retryDelayMs);
        continue;
      }
      return response;
    } catch (error) {
      lastNetworkError = error;
      if (attempt >= maxAttempts) break;
      log(`RETRY ${label}: error de red; intento ${attempt + 1}/${maxAttempts}`);
      await sleep(retryDelayMs);
    }
  }
  throw new Error(`${label} FAIL: error de red tras ${maxAttempts} intentos (${shortError(lastNetworkError)}).`);
}

function requireStatus(response, label) {
  if (response.status !== 200) throw new Error(`${label} FAIL: HTTP ${response.status}; se esperaba 200.`);
}

function contentType(response) {
  return String(response.headers.get('content-type') || '').trim().toLowerCase();
}

export async function checkHealth(baseUrl, options = {}) {
  const log = options.log || noop;
  const url = new URL('/health', baseUrl);
  const response = await fetchWithRetry(url, { ...options, log, label: '/health' });
  requireStatus(response, '/health');
  const mime = contentType(response);
  if (!/(?:application\/json|\+json)(?:;|$)/i.test(mime)) {
    throw new Error(`/health FAIL: Content-Type ${mime || '(vacío)'}; se esperaba JSON.`);
  }
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error('/health FAIL: JSON inválido.'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('/health FAIL: el payload JSON debe ser un objeto.');
  }
  if (payload.ok !== true) throw new Error('/health FAIL: ok debe ser true.');
  const flags = ['cloudConfigured', 'invitationsConfigured', 'leadQualificationAiConfigured']
    .filter((key) => typeof payload[key] === 'boolean')
    .map((key) => `${key}=${payload[key]}`)
    .join(', ');
  log(`PASS /health: HTTP 200, JSON válido, ok=true${flags ? ` (${flags})` : ''}`);
  return payload;
}

export async function checkRoot(baseUrl, options = {}) {
  const log = options.log || noop;
  const url = new URL('/', baseUrl);
  const response = await fetchWithRetry(url, { ...options, log, label: '/' });
  requireStatus(response, '/');
  const mime = contentType(response);
  if (!/^text\/html(?:;|$)/i.test(mime)) {
    throw new Error(`/ FAIL: Content-Type ${mime || '(vacío)'}; se esperaba HTML.`);
  }
  const html = await response.text();
  if (!html.trim()) throw new Error('/ FAIL: HTML vacío.');
  if (!ROOT_MARKER.test(html)) throw new Error('/ FAIL: falta el marcador estable de PropControl en el HTML.');
  log('PASS /: HTTP 200, HTML real y marcador PropControl presentes.');
  return html;
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] || '';
}

function sameOriginAsset(raw, baseUrl) {
  const value = String(raw || '').trim();
  if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('javascript:')) return null;
  let resolved;
  try { resolved = new URL(value, baseUrl); } catch { return null; }
  if (!['http:', 'https:'].includes(resolved.protocol) || resolved.origin !== baseUrl.origin) return null;
  return resolved;
}

export function discoverDirectAssets(html, baseUrl) {
  const assets = [];
  const seen = new Set();
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const raw = attribute(match[0], 'src');
    const url = sameOriginAsset(raw, baseUrl);
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    assets.push({ kind: 'js', raw, url });
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = attribute(tag, 'rel').toLowerCase().split(/\s+/g);
    if (!rel.includes('stylesheet')) continue;
    const raw = attribute(tag, 'href');
    const url = sameOriginAsset(raw, baseUrl);
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    assets.push({ kind: 'css', raw, url });
  }
  return assets;
}

function looksLikeHtml(mime, body) {
  return /^text\/html(?:;|$)/i.test(mime) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(body);
}

function assetLabel(asset) {
  return `${asset.url.pathname}${asset.url.search}`;
}

export async function checkDirectAsset(asset, options = {}) {
  const log = options.log || noop;
  const label = assetLabel(asset);
  const response = await fetchWithRetry(asset.url, { ...options, log, label: `asset ${label}` });
  requireStatus(response, `asset ${label}`);
  const mime = contentType(response);
  const body = await response.text();
  if (!body.length) throw new Error(`asset ${label} FAIL: cuerpo vacío.`);
  if (looksLikeHtml(mime, body)) {
    throw new Error(`asset ${label} FAIL: HTML fallback con HTTP 200 (MIME ${mime || '(vacío)'}).`);
  }
  if (asset.kind === 'css' && !CSS_MIME.test(mime)) {
    throw new Error(`asset ${label} FAIL: MIME ${mime || '(vacío)'}; se esperaba text/css.`);
  }
  if (asset.kind === 'js' && !JAVASCRIPT_MIME.test(mime)) {
    throw new Error(`asset ${label} FAIL: MIME ${mime || '(vacío)'}; se esperaba JavaScript.`);
  }
  log(`PASS asset ${label}: HTTP 200, MIME ${mime}, ${body.length} bytes.`);
}

export async function checkDirectAssets(html, baseUrl, options = {}) {
  const log = options.log || noop;
  const assets = discoverDirectAssets(html, baseUrl);
  if (!assets.length) throw new Error('assets FAIL: no se descubrieron scripts ni stylesheets locales directos en el HTML real.');
  for (const asset of assets) await checkDirectAsset(asset, { ...options, log });
  log(`PASS assets directos: ${assets.length} verificados desde el HTML real.`);
  return assets;
}

export async function runHttpSmoke(baseUrl, options = {}) {
  await checkHealth(baseUrl, options);
  const html = await checkRoot(baseUrl, options);
  return checkDirectAssets(html, baseUrl, options);
}

function chromiumLaunchOptions(executablePath) {
  return executablePath ? { executablePath, headless: true } : { headless: true };
}

export async function runBrowserSmoke(baseUrl, {
  log = noop,
  screenshotPath = SCREENSHOT_PATH,
  executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  navigationTimeoutMs = 15_000,
  markerTimeoutMs = 10_000,
} = {}) {
  mkdirSync(dirname(screenshotPath), { recursive: true });
  const pageErrors = [];
  let browser;
  let context;
  let page;
  try {
    browser = await chromium.launch(chromiumLaunchOptions(executablePath));
    context = await browser.newContext();
    page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(shortError(error)));
    const response = await page.goto(new URL('/', baseUrl).href, {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeoutMs,
    });
    if (!response || response.status() !== 200) {
      throw new Error(`browser FAIL: navegación inicial HTTP ${response?.status() ?? 'sin respuesta'}.`);
    }
    await page.locator(BROWSER_MARKER).waitFor({ state: 'visible', timeout: markerTimeoutMs });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    if (pageErrors.length) {
      throw new Error(`browser FAIL: pageerror detectado: ${pageErrors.join(' | ')}`);
    }
    log(`PASS browser: Chromium cargó DOM y marcador ${BROWSER_MARKER}; pageerror=0.`);
  } catch (error) {
    if (page) {
      try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch { /* conservar error original */ }
    }
    if (error instanceof Error && /browser FAIL:/.test(error.message)) throw error;
    throw new Error(`browser FAIL: ${shortError(error)}`);
  } finally {
    await context?.close().catch(noop);
    await browser?.close().catch(noop);
  }
}

function createLogger(path) {
  const lines = [];
  const log = (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    lines.push(line);
    console.log(line);
    writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  };
  return log;
}

export async function runProductionSmoke({
  baseUrlValue = process.env.PRODUCTION_BASE_URL,
  eventName = process.env.SMOKE_EVENT || 'manual',
  deploymentSha = process.env.SMOKE_DEPLOYMENT_SHA || process.env.GITHUB_SHA || 'unknown',
  environment = process.env.SMOKE_ENVIRONMENT || 'unknown',
  allowHttp = process.env.ALLOW_INSECURE_HTTP === '1',
  httpOnly = false,
  browserOnly = false,
  executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
} = {}) {
  rmSync(ARTIFACT_DIR, { recursive: true, force: true });
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const log = createLogger(LOG_PATH);
  log(`event=${eventName}`);
  log(`deployment_sha=${deploymentSha}`);
  log(`environment=${environment}`);
  let baseUrl;
  try {
    baseUrl = normalizeBaseUrl(baseUrlValue, { allowHttp });
    log(`base_url=${publicBaseUrl(baseUrl)}`);
    log(`retry_policy=max_attempts=${MAX_REQUEST_ATTEMPTS}, request_timeout_ms=${REQUEST_TIMEOUT_MS}, retry_delay_ms=${RETRY_DELAY_MS}, retry_only=network_or_5xx`);
    if (!browserOnly) await runHttpSmoke(baseUrl, { log });
    if (!httpOnly) await runBrowserSmoke(baseUrl, { log, executablePath });
    log('RESULT=PASS');
    return { ok: true, baseUrl, logPath: LOG_PATH, screenshotPath: SCREENSHOT_PATH };
  } catch (error) {
    log(`RESULT=FAIL reason=${shortError(error)}`);
    throw error;
  }
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isEntrypoint()) {
  const flags = new Set(process.argv.slice(2));
  runProductionSmoke({
    httpOnly: flags.has('--http-only'),
    browserOnly: flags.has('--browser-only'),
  }).catch((error) => {
    console.error(shortError(error));
    process.exitCode = 1;
  });
}
