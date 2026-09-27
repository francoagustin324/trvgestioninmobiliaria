import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer as createPortProbe } from 'node:net';
import test from 'node:test';
import { chromium, type BrowserContext } from 'playwright';
import { initialData } from '../models.js';

const userId = 'b128-backdrop-owner';
const storageKey = `trv-crm-basico:user:${userId}`;
const sessionKey = 'propcontrol-cloud-session-v1';
const syncKey = `${storageKey}:sync`;
const H5_AUTH_GENERATION = 'b128-h5-auth-generation';

interface BackdropTestWindow extends Window {
  __b128BackgroundClicks?: number;
}

function crmFixture() {
  const crm = structuredClone(initialData);
  crm.organization = {
    id: 'trvgestioninmobiliaria',
    name: 'TRV Gestión Inmobiliaria',
    seatLimit: null,
    planLabel: 'Validación B1.2.8',
  };
  crm.teamMembers = [{
    id: 1,
    userId,
    name: 'Franco Solís',
    email: 'franco.solis@example.test',
    phone: '5493515110069',
    role: 'Dueño',
    status: 'Activo',
    createdAt: '2026-07-01T12:00:00.000Z',
  }];
  crm.settings = {
    ...crm.settings,
    profileName: 'trvgestioninmobiliaria',
    profileEmail: 'franco.solis@example.test',
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

type ServerOutput = { stdout: string; stderr: string };

async function availablePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createPortProbe();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('B1.2.8 no pudo obtener un puerto efímero.'));
        return;
      }
      const port = address.port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function serverDiagnostic(server: ChildProcess, output: ServerOutput): string {
  const stdout = output.stdout.slice(-4000);
  const stderr = output.stderr.slice(-4000);
  return [
    `exitCode=${server.exitCode === null ? 'running' : server.exitCode}`,
    `signal=${server.signalCode ?? 'none'}`,
    `stdout=${JSON.stringify(stdout)}`,
    `stderr=${JSON.stringify(stderr)}`,
  ].join(' ');
}

async function waitForServer(
  url: string,
  server: ChildProcess,
  output: ServerOutput,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Servidor B1.2.8 terminó antes del health check: ${serverDiagnostic(server, output)}`);
    }
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Servidor B1.2.8 no disponible: ${String(lastError ?? 'sin respuesta')} ${serverDiagnostic(server, output)}`,
  );
}

async function startServer(): Promise<{ server: ChildProcess; url: string }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const port = await availablePort();
    const url = `http://127.0.0.1:${port}`;
    const output: ServerOutput = { stdout: '', stderr: '' };
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
    server.stdout?.setEncoding('utf8');
    server.stderr?.setEncoding('utf8');
    server.stdout?.on('data', (chunk: string) => { output.stdout += chunk; });
    server.stderr?.on('data', (chunk: string) => { output.stderr += chunk; });

    try {
      await waitForServer(url, server, output);
      return { server, url };
    } catch (error) {
      const diagnostic = serverDiagnostic(server, output);
      const portCollision = /EADDRINUSE/i.test(output.stderr) || /EADDRINUSE/i.test(output.stdout);
      if (server.exitCode === null) await stopServer(server);
      if (portCollision && attempt === 0) continue;
      throw new Error(`${error instanceof Error ? error.message : String(error)} ${diagnostic}`);
    }
  }
  throw new Error('Servidor B1.2.8 no pudo iniciar luego de descartar una colisión de puerto.');
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


function h5SyntheticJson(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  };
}

async function h5InstallSyntheticAuthority(
  context: BrowserContext,
  origin: string,
  organizationId: string,
  member: { id: number; userId?: string; name: string; email?: string; phone?: string; role?: string },
): Promise<void> {
  let syntheticRecords: unknown[] = [];
  await context.route('**/api/cloud-config', async (route) => {
    await route.fulfill(h5SyntheticJson({ configured: true, url: origin, publishableKey: 'h5-pilot-publishable-key' }));
  });
  await context.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        },
        body: '',
      });
      return;
    }
    if (url.pathname.endsWith('/rest/v1/rpc/activate_my_organization_memberships')) {
      await route.fulfill(h5SyntheticJson({}));
      return;
    }
    if (url.pathname.endsWith('/rest/v1/organization_members')) {
      await route.fulfill(h5SyntheticJson([{
        organization_id: organizationId,
        member_id: member.id,
        user_id: member.userId,
        role: member.role === 'Administrador' ? 'admin' : member.role === 'Corredor' ? 'agent' : 'owner',
        status: 'active',
        display_name: member.name,
        email: member.email || null,
        phone: member.phone || null,
        created_at: '2026-08-01T12:00:00.000Z',
        last_active_at: '2026-09-16T12:00:00.000Z',
      }]));
      return;
    }
    if (url.pathname.endsWith('/rest/v1/rpc/visit_transaction_authority_active_v2')) {
      await route.fulfill(h5SyntheticJson(false));
      return;
    }
    if (url.pathname.endsWith('/rest/v1/propcontrol_records')) {
      if (request.method() === 'GET') {
        await route.fulfill(h5SyntheticJson(syntheticRecords));
        return;
      }
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        syntheticRecords = Array.isArray(body) ? structuredClone(body) : [structuredClone(body)];
        await route.fulfill(h5SyntheticJson(syntheticRecords, 201));
        return;
      }
      if (request.method() === 'DELETE') {
        syntheticRecords = [];
        await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
        return;
      }
    }
    if (url.pathname.endsWith('/rest/v1/fichas')) {
      await route.fulfill(h5SyntheticJson([]));
      return;
    }
    await route.fulfill(h5SyntheticJson({ error: 'UNEXPECTED_H5_SYNTHETIC_ENDPOINT', path: url.pathname }, 500));
  });
}

test(
  'B1.2.8 el backdrop móvil cubre el viewport y bloquea pulsaciones del fondo',
  { timeout: 120_000 },
  async () => {
    const executablePath = chromeExecutable();
    assert.ok(executablePath, 'Chrome/Chromium no disponible para B1.2.8.');
    const { server, url } = await startServer();
    const browser = await chromium.launch({ executablePath, headless: true });

    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
        locale: 'es-AR',
        colorScheme: 'dark',
      });
      const data = crmFixture();
      await h5InstallSyntheticAuthority(context, url, data.organization.id, data.teamMembers[0]!);
      await context.addInitScript(({ data, generation, keys, user }) => {
        localStorage.setItem(keys.session, JSON.stringify({
          accessToken: 'b128-access-token',
          refreshToken: 'b128-refresh-token',
          expiresAt: Date.now() + 3_600_000,
          userId: user,
          email: 'franco.solis@example.test',
          __propcontrolAuthGeneration: generation,
        }));
        localStorage.setItem('propcontrol-cloud-auth-generation-v1', generation);
        localStorage.setItem(keys.storage, JSON.stringify(data));
        localStorage.setItem(keys.sync, JSON.stringify({
          dirty: false,
          localUpdatedAt: '2026-07-29T16:40:00-03:00',
          lastCloudSavedAt: '2026-07-29T14:12:00-03:00',
          lastCloudVersion: '2026-07-29T14:12:00-03:00',
        }));
        localStorage.setItem('propcontrol-active-team-member-v1', '1');
      }, {
        data,
        generation: H5_AUTH_GENERATION,
        keys: { session: sessionKey, storage: storageKey, sync: syncKey },
        user: userId,
      });

      try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-account-toggle]', { state: 'visible', timeout: 20_000 });
        await page.waitForSelector('#crm.active', { state: 'visible', timeout: 20_000 });
        await page.evaluate(() => {
          const target = window as unknown as BackdropTestWindow;
          target.__b128BackgroundClicks = 0;
          document.addEventListener('click', (event) => {
            const element = event.target as Element | null;
            if (!element?.closest('.mvp-account-menu')) {
              target.__b128BackgroundClicks = (target.__b128BackgroundClicks ?? 0) + 1;
            }
          }, true);
        });

        await page.locator('[data-account-toggle]').click();
        await page.locator('.mvp-account-panel').waitFor({ state: 'visible' });

        const geometry = await page.evaluate(() => {
          const backdrop = document.querySelector<HTMLElement>('[data-account-backdrop]');
          const panel = document.querySelector<HTMLElement>('.mvp-account-panel');
          if (!backdrop || !panel) throw new Error('Menú de cuenta incompleto.');
          const backdropRect = backdrop.getBoundingClientRect();
          const panelRect = panel.getBoundingClientRect();
          const point = {
            x: Math.max(8, Math.min(20, panelRect.left - 8)),
            y: Math.min(innerHeight - 20, Math.max(180, panelRect.top + 120)),
          };
          const hit = document.elementFromPoint(point.x, point.y);
          return {
            viewport: { width: innerWidth, height: innerHeight },
            backdrop: {
              left: backdropRect.left,
              top: backdropRect.top,
              right: backdropRect.right,
              bottom: backdropRect.bottom,
            },
            point,
            hitBackdrop: hit === backdrop || backdrop.contains(hit),
          };
        });

        assert.ok(geometry.backdrop.left <= 0.5, JSON.stringify(geometry));
        assert.ok(geometry.backdrop.top <= 0.5, JSON.stringify(geometry));
        assert.ok(geometry.backdrop.right >= geometry.viewport.width - 0.5, JSON.stringify(geometry));
        assert.ok(geometry.backdrop.bottom >= geometry.viewport.height - 0.5, JSON.stringify(geometry));
        assert.equal(geometry.hitBackdrop, true, JSON.stringify(geometry));

        await page.mouse.click(geometry.point.x, geometry.point.y);
        await page.locator('.mvp-account-panel').waitFor({ state: 'hidden' });
        assert.equal(
          await page.evaluate(() => {
            return (window as unknown as BackdropTestWindow).__b128BackgroundClicks ?? 0;
          }),
          0,
          'La pulsación atravesó el backdrop y alcanzó el contenido de fondo.',
        );
        assert.equal(
          await page.evaluate(() => document.body.classList.contains('account-menu-open')),
          false,
        );
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
      await stopServer(server);
    }
  },
);
