import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

const CANDIDATE = '7bb3bdadbe34717cdc8f4d9a6646f8a0b47db1cc';
const USER_A = 'a34-user-a';
const ORG_X = '00000000-0000-0000-0000-00000000a344';
const SECRET = 'A34-SENSITIVE-TENANT-X';
const ITERATIONS = 10;
const OBSERVATION_MS = 10_000;

const root = process.cwd();
const importDist = async (file) => import(pathToFileURL(join(root, 'dist', file)).href);
const { CLOUD_AUTH_GENERATION_KEY, CLOUD_SESSION_KEY } = await importDist('auth-session-generation.js');
const { initialData } = await importDist('models.js');
const { tenantStorageNamespace } = await importDist('tenant-storage.js');

function chromeExecutable() {
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(existsSync);
}

function membership(userId = USER_A, status = 'active', role = 'agent') {
  return {
    organization_id: ORG_X,
    member_id: 344,
    user_id: userId,
    role,
    status,
    display_name: 'A34 User',
    email: `${userId}@example.test`,
    phone: null,
    created_at: '2026-09-13T12:00:00.000Z',
    last_active_at: '2026-09-13T12:00:00.000Z',
  };
}

function sensitiveCrm() {
  const crm = structuredClone(initialData);
  crm.organization.id = ORG_X;
  crm.organization.name = SECRET;
  crm.teamMembers = [{
    id: 344,
    userId: USER_A,
    name: 'Sensitive User',
    email: 'a34-user-a@example.test',
    role: 'Corredor',
    status: 'Activo',
    createdAt: '2026-09-13T12:00:00.000Z',
  }];
  crm.clients = [{
    id: 9344,
    name: SECRET,
    phone: '3515559344',
    interest: 'Compra',
    status: 'Activo',
    temperature: 'Caliente',
    pipeline: 'Nuevo',
    assignedToId: 344,
    createdById: 344,
  }];
  crm.properties = [];
  crm.visits = [];
  crm.offers = [];
  crm.reservations = [];
  crm.contacts = [];
  crm.reminders = [];
  crm.fichas = [];
  crm.conversations = [];
  crm.activityLog = [];
  return crm;
}

async function waitForServer(url) {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`A3.4 server unavailable: ${String(lastError ?? 'no response')}`);
}

async function startServer(port) {
  const server = spawn(process.execPath, ['dist/server.js'], {
    cwd: root,
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

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise((resolve) => {
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

function roundMs(value) {
  return value == null ? null : Math.round(value * 10) / 10;
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function targetNetworkUrl(raw) {
  try {
    const url = new URL(raw);
    return url.pathname === '/api/cloud-config' || url.pathname.endsWith('/rest/v1/organization_members');
  } catch {
    return false;
  }
}

function sanitizeFactory(browserSession) {
  const redactions = [
    [SECRET, '[REDACTED_SECRET]'],
    [browserSession.accessToken, '[REDACTED_ACCESS_TOKEN]'],
    [browserSession.refreshToken, '[REDACTED_REFRESH_TOKEN]'],
    [browserSession.__propcontrolAuthGeneration, '[REDACTED_GENERATION]'],
    ['a34-browser-key', '[REDACTED_PUBLISHABLE_KEY]'],
    ['a34-user-a@example.test', '[REDACTED_FIXTURE_EMAIL]'],
    ['3515559344', '[REDACTED_FIXTURE_PHONE]'],
    ['Sensitive User', '[REDACTED_FIXTURE_NAME]'],
  ];
  return (value) => {
    let text = String(value ?? '');
    for (const [needle, replacement] of redactions) text = text.split(needle).join(replacement);
    return text;
  };
}

async function runIteration(iteration, executablePath) {
  const port = 63900 + iteration;
  const origin = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 820 } });
  const crm = sensitiveCrm();
  const namespace = tenantStorageNamespace({ userId: USER_A, organizationId: ORG_X });
  const generation = 'a34-browser-generation-g1';
  const browserSession = {
    accessToken: 'a34-browser-access-g1',
    refreshToken: 'a34-browser-refresh-g1',
    expiresAt: Date.now() + 3_600_000,
    userId: USER_A,
    email: 'a34-user-a@example.test',
    __propcontrolAuthGeneration: generation,
  };
  const sanitize = sanitizeFactory(browserSession);
  const events = [];
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const network = [];
  const navigationStarted = performance.now();
  let domContentLoadedAtMs = null;
  let safeErrorAtMs = null;
  let premiumShellAtMs = null;
  let secretAtMs = null;
  let page;

  const noteSeen = (kind, atMs) => {
    if (kind === 'safe' && safeErrorAtMs == null) safeErrorAtMs = atMs;
    if (kind === 'premium' && premiumShellAtMs == null) premiumShellAtMs = atMs;
    if (kind === 'secret' && secretAtMs == null) secretAtMs = atMs;
  };

  try {
    await context.exposeBinding('__a34ReportEvent', (_source, event) => {
      const atMs = performance.now() - navigationStarted;
      events.push({ ...event, nodeAtMs: roundMs(atMs) });
      noteSeen(event.kind, atMs);
    });

    await context.addInitScript(({ sessionKey, generationKey, generationValue, storedSession, crmKey, storedCrm, secret }) => {
      localStorage.setItem(sessionKey, JSON.stringify(storedSession));
      localStorage.setItem(generationKey, generationValue);
      localStorage.setItem(crmKey, JSON.stringify(storedCrm));

      const tracker = {
        dclPerfMs: null,
        safePerfMs: null,
        premiumPerfMs: null,
        secretPerfMs: null,
      };
      Object.defineProperty(window, '__A34_R11_TRACKER__', { value: tracker, configurable: true });

      const report = (kind) => {
        try {
          void window.__a34ReportEvent({ kind, perfMs: performance.now(), url: location.href });
        } catch {
          // Validation observer must never influence product runtime.
        }
      };
      const scan = () => {
        const now = performance.now();
        const body = document.body;
        if (tracker.safePerfMs == null && document.querySelector('[data-bootstrap-error]')) {
          tracker.safePerfMs = now;
          report('safe');
        }
        if (tracker.premiumPerfMs == null && document.querySelector('.premium-shell')) {
          tracker.premiumPerfMs = now;
          report('premium');
        }
        if (tracker.secretPerfMs == null && body?.innerText?.includes(secret)) {
          tracker.secretPerfMs = now;
          report('secret');
        }
      };
      document.addEventListener('DOMContentLoaded', () => {
        tracker.dclPerfMs = performance.now();
        report('dcl');
        scan();
        if (document.documentElement) {
          new MutationObserver(scan).observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
          });
        }
      }, { once: true });
    }, {
      sessionKey: CLOUD_SESSION_KEY,
      generationKey: CLOUD_AUTH_GENERATION_KEY,
      generationValue: generation,
      storedSession: browserSession,
      crmKey: namespace.crmKey,
      storedCrm: crm,
      secret: SECRET,
    });

    page = await context.newPage();
    page.on('domcontentloaded', () => {
      if (domContentLoadedAtMs == null) domContentLoadedAtMs = performance.now() - navigationStarted;
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push({ atMs: roundMs(performance.now() - navigationStarted), text: sanitize(message.text()) });
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push({ atMs: roundMs(performance.now() - navigationStarted), message: sanitize(error?.stack ?? error?.message ?? error) });
    });
    page.on('requestfailed', (request) => {
      failedRequests.push({
        atMs: roundMs(performance.now() - navigationStarted),
        method: request.method(),
        url: sanitize(request.url()),
        failure: sanitize(request.failure()?.errorText ?? 'unknown'),
      });
    });
    page.on('request', (request) => {
      if (!targetNetworkUrl(request.url())) return;
      network.push({
        kind: 'request',
        atMs: roundMs(performance.now() - navigationStarted),
        method: request.method(),
        url: sanitize(request.url()),
      });
    });
    page.on('response', async (response) => {
      if (!targetNetworkUrl(response.url())) return;
      let body = '<unavailable>';
      try {
        body = sanitize(await response.text());
      } catch (error) {
        body = `<response-read-error:${sanitize(error?.message ?? error)}>`;
      }
      network.push({
        kind: 'response',
        atMs: roundMs(performance.now() - navigationStarted),
        status: response.status(),
        url: sanitize(response.url()),
        body,
      });
    });

    await page.route('**/api/cloud-config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ configured: true, url: origin, publishableKey: 'a34-browser-key' }),
      });
    });
    await page.route('**/rest/v1/organization_members*', async (route) => {
      const url = new URL(route.request().url());
      const rows = url.searchParams.has('user_id')
        ? [membership(USER_A, 'active', 'agent')]
        : [membership(USER_A, 'suspended', 'agent')];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    });

    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    if (domContentLoadedAtMs == null) domContentLoadedAtMs = performance.now() - navigationStarted;

    await page.waitForFunction(() => {
      const tracker = window.__A34_R11_TRACKER__;
      return tracker?.dclPerfMs != null && performance.now() - tracker.dclPerfMs >= 300;
    }, null, { timeout: 2_000, polling: 10 });

    const stateAt300 = await page.evaluate((secret) => {
      const tracker = window.__A34_R11_TRACKER__;
      return {
        safeErrorCount: document.querySelectorAll('[data-bootstrap-error]').length,
        premiumShellCount: document.querySelectorAll('.premium-shell').length,
        secretSeen: Boolean(tracker?.secretPerfMs != null || document.body?.innerText?.includes(secret)),
        safeSeen: Boolean(tracker?.safePerfMs != null),
        premiumSeen: Boolean(tracker?.premiumPerfMs != null),
        browserElapsedAfterDclMs: tracker?.dclPerfMs == null ? null : performance.now() - tracker.dclPerfMs,
      };
    }, SECRET);

    const remaining = Math.max(0, OBSERVATION_MS - (performance.now() - navigationStarted - domContentLoadedAtMs));
    const pollUntil = performance.now() + remaining;
    while (performance.now() < pollUntil) {
      const observed = await page.evaluate((secret) => ({
        safe: document.querySelectorAll('[data-bootstrap-error]').length > 0,
        premium: document.querySelectorAll('.premium-shell').length > 0,
        secret: Boolean(document.body?.innerText?.includes(secret)),
      }), SECRET);
      const atMs = performance.now() - navigationStarted;
      if (observed.safe) noteSeen('safe', atMs);
      if (observed.premium) noteSeen('premium', atMs);
      if (observed.secret) noteSeen('secret', atMs);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const finalState = await page.evaluate((secret) => ({
      safeErrorCount: document.querySelectorAll('[data-bootstrap-error]').length,
      premiumShellCount: document.querySelectorAll('.premium-shell').length,
      secretPresent: Boolean(document.body?.innerText?.includes(secret)),
      html: document.documentElement?.outerHTML ?? '',
      bodyText: document.body?.innerText ?? '',
    }), SECRET);
    const finalUrl = page.url();

    if (finalState.premiumShellCount > 0) noteSeen('premium', performance.now() - navigationStarted);
    if (finalState.secretPresent) noteSeen('secret', performance.now() - navigationStarted);
    if (finalState.safeErrorCount > 0) noteSeen('safe', performance.now() - navigationStarted);

    const unsafe = premiumShellAtMs != null || secretAtMs != null;
    const safe = safeErrorAtMs != null && !unsafe;
    const outcome = unsafe ? 'UNSAFE' : safe ? 'SAFE' : 'UNKNOWN';
    const safeAfterDclMs = safeErrorAtMs == null || domContentLoadedAtMs == null
      ? null
      : safeErrorAtMs - domContentLoadedAtMs;
    const premiumAfterDclMs = premiumShellAtMs == null || domContentLoadedAtMs == null
      ? null
      : premiumShellAtMs - domContentLoadedAtMs;
    const secretAfterDclMs = secretAtMs == null || domContentLoadedAtMs == null
      ? null
      : secretAtMs - domContentLoadedAtMs;

    const result = {
      iteration,
      outcome,
      domContentLoadedAtMs: roundMs(domContentLoadedAtMs),
      safeErrorAtMs: roundMs(safeErrorAtMs),
      safeErrorAfterDclMs: roundMs(safeAfterDclMs),
      premiumShellAtMs: roundMs(premiumShellAtMs),
      premiumShellAfterDclMs: roundMs(premiumAfterDclMs),
      secretAtMs: roundMs(secretAtMs),
      secretAfterDclMs: roundMs(secretAfterDclMs),
      stateAt300Ms: {
        ...stateAt300,
        browserElapsedAfterDclMs: roundMs(stateAt300.browserElapsedAfterDclMs),
      },
      premiumShellSeen: premiumShellAtMs != null,
      secretSeen: secretAtMs != null,
      finalUrl,
      finalSafeErrorCount: finalState.safeErrorCount,
      finalPremiumShellCount: finalState.premiumShellCount,
      finalSecretPresent: finalState.secretPresent,
      consoleErrors,
      pageErrors,
      failedRequests,
      network,
      observerEvents: events,
      finalHtmlSanitized: sanitize(finalState.html),
      finalBodyTextSanitized: sanitize(finalState.bodyText),
    };

    console.log(`ITERATION=${iteration}`);
    console.log(`OUTCOME=${outcome}`);
    console.log(`DOMCONTENTLOADED_AT_MS=${result.domContentLoadedAtMs ?? 'none'}`);
    console.log(`SAFE_ERROR_AT_MS=${result.safeErrorAtMs ?? 'none'}`);
    console.log(`SAFE_ERROR_AFTER_DCL_MS=${result.safeErrorAfterDclMs ?? 'none'}`);
    console.log(`PREMIUM_SHELL_AT_MS=${result.premiumShellAtMs ?? 'none'}`);
    console.log(`SECRET_AT_MS=${result.secretAtMs ?? 'none'}`);
    console.log(`PREMIUM_SHELL_SEEN=${result.premiumShellSeen ? 'yes' : 'no'}`);
    console.log(`SECRET_SEEN=${result.secretSeen ? 'yes' : 'no'}`);
    console.log(`FINAL_URL=${result.finalUrl}`);
    console.log(`STATE_AT_300MS=${JSON.stringify(result.stateAt300Ms)}`);
    console.log(`PAGE_CONSOLE_ERRORS=${JSON.stringify(consoleErrors)}`);
    console.log(`PAGE_ERRORS=${JSON.stringify(pageErrors)}`);
    console.log(`FAILED_REQUESTS=${JSON.stringify(failedRequests)}`);
    console.log(`NETWORK_TRACE=${JSON.stringify(network)}`);
    console.log(`ROOT_HTML_FINAL_SANITIZED=${JSON.stringify(result.finalHtmlSanitized)}`);
    console.log(`BODY_TEXT_FINAL_SANITIZED=${JSON.stringify(result.finalBodyTextSanitized)}`);
    console.log(`ITERATION_RESULT_JSON=${JSON.stringify(result)}`);
    return result;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await stopServer(server).catch(() => {});
  }
}

const executablePath = chromeExecutable();
if (!executablePath) throw new Error('A3.4 characterization requires Chrome/Chromium.');

console.log(`EXACT_CANDIDATE=${CANDIDATE}`);
console.log(`BROWSER_EXECUTABLE=${executablePath}`);
const results = [];
for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
  results.push(await runIteration(iteration, executablePath));
}

const unsafe = results.filter((result) => result.outcome === 'UNSAFE');
const unknown = results.filter((result) => result.outcome === 'UNKNOWN');
const safe = results.filter((result) => result.outcome === 'SAFE');
const safeTimings = safe.map((result) => result.safeErrorAfterDclMs).filter((value) => typeof value === 'number');
const post300 = safeTimings.filter((value) => value > 300);

let classification;
let runtimeSecurity;
let exitCode = 0;
if (unsafe.length > 0) {
  classification = 'B_RUNTIME_SECURITY_FAILURE';
  runtimeSecurity = 'FAIL';
  exitCode = 1;
} else if (unknown.length > 0) {
  classification = 'C_UNRESOLVED';
  runtimeSecurity = 'UNKNOWN';
  exitCode = 1;
} else if (safe.length === ITERATIONS && post300.length > 0) {
  classification = 'A_TEST_HARNESS_TIMING_DRIFT_PROVEN';
  runtimeSecurity = 'PASS';
} else {
  classification = 'C_CAUSALITY_UNRESOLVED_NO_POST_300_EVIDENCE';
  runtimeSecurity = 'PASS';
  exitCode = 1;
}

const summary = {
  exactCandidate: CANDIDATE,
  iterations: results.length,
  safe: safe.length,
  unsafe: unsafe.length,
  unknown: unknown.length,
  runtimeSecurity,
  classification,
  minSafeErrorMs: safeTimings.length ? roundMs(Math.min(...safeTimings)) : null,
  maxSafeErrorMs: safeTimings.length ? roundMs(Math.max(...safeTimings)) : null,
  medianSafeErrorMs: safeTimings.length ? roundMs(median(safeTimings)) : null,
  post300Count: post300.length,
  candidateUnchangedByDiagnostic: true,
  results,
};

console.log(`R11_RUNTIME_SECURITY=${runtimeSecurity}`);
console.log(`A3_4_R11_CLASSIFICATION=${classification}`);
console.log(`MIN_SAFE_ERROR_MS=${summary.minSafeErrorMs ?? 'none'}`);
console.log(`MAX_SAFE_ERROR_MS=${summary.maxSafeErrorMs ?? 'none'}`);
console.log(`MEDIAN_SAFE_ERROR_MS=${summary.medianSafeErrorMs ?? 'none'}`);
console.log(`SAFE_AFTER_300MS_COUNT=${summary.post300Count}`);
console.log(`FINAL_SUMMARY_JSON=${JSON.stringify(summary)}`);

if (process.env.A34_RESULTS_PATH) {
  await writeFile(process.env.A34_RESULTS_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}
process.exitCode = exitCode;
