import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const smokeModuleUrl = new URL('../../scripts/verify-production-smoke.mjs', import.meta.url).href;
const smoke: any = await import(smokeModuleUrl);
const workflowPath = join(process.cwd(), '.github', 'workflows', 'post-deploy-smoke.yml');

function send(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { 'Content-Type': contentType });
  response.end(body);
}

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (baseUrl: URL) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo obtener el puerto del fixture smoke.');
  try {
    await run(new URL(`http://127.0.0.1:${address.port}/`));
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
}

function rootHtml(extra = ''): string {
  return `<!doctype html><html><head><title>PropControl | CRM inmobiliario</title>${extra}</head><body><div id="root"></div></body></html>`;
}

function directAssetsHtml(css = '/assets/app.css?v=css-1', js = '/assets/app.js?v=js-1'): string {
  return rootHtml(`<link rel="stylesheet" href="${css}"><script type="module" src="${js}"></script>`);
}

function chromeExecutable(): string | undefined {
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(existsSync);
}

async function expectReject(task: Promise<unknown>, expected: RegExp): Promise<void> {
  await assert.rejects(task, expected);
}

test('1. /health 200 + JSON + ok=true => PASS', async () => {
  await withServer((request, response) => {
    if (request.url === '/health') return send(response, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, cloudConfigured: true }));
    send(response, 404, 'text/plain', 'not found');
  }, async (baseUrl) => {
    const payload = await smoke.checkHealth(baseUrl, { maxAttempts: 1 });
    assert.equal(payload.ok, true);
  });
});

test('2. /health no 200 => FAIL preciso', async () => {
  await withServer((_request, response) => send(response, 404, 'application/json', JSON.stringify({ ok: false })), async (baseUrl) => {
    await expectReject(smoke.checkHealth(baseUrl, { maxAttempts: 1 }), /\/health FAIL: HTTP 404; se esperaba 200/);
  });
});

test('3. /health JSON inválido => FAIL', async () => {
  await withServer((_request, response) => send(response, 200, 'application/json', '{no-json'), async (baseUrl) => {
    await expectReject(smoke.checkHealth(baseUrl, { maxAttempts: 1 }), /\/health FAIL: JSON inválido/);
  });
});

test('4. /health ok=false => FAIL', async () => {
  await withServer((_request, response) => send(response, 200, 'application/json', JSON.stringify({ ok: false })), async (baseUrl) => {
    await expectReject(smoke.checkHealth(baseUrl, { maxAttempts: 1 }), /\/health FAIL: ok debe ser true/);
  });
});

test('5. raíz 200 + HTML/marcador válido => PASS', async () => {
  await withServer((_request, response) => send(response, 200, 'text/html; charset=utf-8', rootHtml()), async (baseUrl) => {
    const html = await smoke.checkRoot(baseUrl, { maxAttempts: 1 });
    assert.match(html, /PropControl \| CRM inmobiliario/);
  });
});

test('6. raíz vacía o sin marcador => FAIL', async (t) => {
  await t.test('vacía', async () => {
    await withServer((_request, response) => send(response, 200, 'text/html', ''), async (baseUrl) => {
      await expectReject(smoke.checkRoot(baseUrl, { maxAttempts: 1 }), /\/ FAIL: HTML vacío/);
    });
  });
  await t.test('sin marcador', async () => {
    await withServer((_request, response) => send(response, 200, 'text/html', '<!doctype html><html><title>Otro</title></html>'), async (baseUrl) => {
      await expectReject(smoke.checkRoot(baseUrl, { maxAttempts: 1 }), /falta el marcador estable de PropControl/);
    });
  });
});

test('7. asset directo correcto => PASS', async () => {
  await withServer((request, response) => {
    if (request.url === '/assets/app.css?v=css-1') return send(response, 200, 'text/css; charset=utf-8', 'body{display:block}');
    if (request.url === '/assets/app.js?v=js-1') return send(response, 200, 'text/javascript; charset=utf-8', 'console.log("ok")');
    send(response, 404, 'text/plain', 'not found');
  }, async (baseUrl) => {
    const assets = await smoke.checkDirectAssets(directAssetsHtml(), baseUrl, { maxAttempts: 1 });
    assert.equal(assets.length, 2);
  });
});

test('8. asset directo 404/5xx => FAIL', async (t) => {
  await t.test('404', async () => {
    await withServer((_request, response) => send(response, 404, 'text/plain', 'missing'), async (baseUrl) => {
      const html = rootHtml('<script type="module" src="/missing.js?v=1"></script>');
      await expectReject(smoke.checkDirectAssets(html, baseUrl, { maxAttempts: 1 }), /asset \/missing\.js\?v=1 FAIL: HTTP 404/);
    });
  });
  await t.test('5xx', async () => {
    await withServer((_request, response) => send(response, 503, 'text/plain', 'down'), async (baseUrl) => {
      const html = rootHtml('<script type="module" src="/down.js?v=1"></script>');
      await expectReject(smoke.checkDirectAssets(html, baseUrl, { maxAttempts: 1 }), /asset \/down\.js\?v=1 FAIL: HTTP 503/);
    });
  });
});

test('9. asset inexistente que recibe index.html 200 => FAIL', async () => {
  await withServer((_request, response) => send(response, 200, 'text/html; charset=utf-8', rootHtml()), async (baseUrl) => {
    const html = rootHtml('<script type="module" src="/ghost.js?v=1"></script>');
    await expectReject(smoke.checkDirectAssets(html, baseUrl, { maxAttempts: 1 }), /HTML fallback con HTTP 200/);
  });
});

test('10. CSS con MIME incorrecto => FAIL', async () => {
  await withServer((_request, response) => send(response, 200, 'application/octet-stream', 'body{}'), async (baseUrl) => {
    const html = rootHtml('<link rel="stylesheet" href="/app.css?v=1">');
    await expectReject(smoke.checkDirectAssets(html, baseUrl, { maxAttempts: 1 }), /se esperaba text\/css/);
  });
});

test('11. JS con MIME incorrecto => FAIL', async () => {
  await withServer((_request, response) => send(response, 200, 'application/octet-stream', 'console.log(1)'), async (baseUrl) => {
    const html = rootHtml('<script type="module" src="/app.js?v=1"></script>');
    await expectReject(smoke.checkDirectAssets(html, baseUrl, { maxAttempts: 1 }), /se esperaba JavaScript/);
  });
});

test('12. conserva ?v= al solicitar assets', async () => {
  const requested: string[] = [];
  await withServer((request, response) => {
    requested.push(request.url || '');
    send(response, 200, 'text/javascript', 'export const ok=true');
  }, async (baseUrl) => {
    const html = rootHtml('<script type="module" src="/chunk.js?v=20260813-7"></script>');
    await smoke.checkDirectAssets(html, baseUrl, { maxAttempts: 1 });
    assert.deepEqual(requested, ['/chunk.js?v=20260813-7']);
  });
});

test('13. descubre assets automáticamente, no por lista hardcodeada', () => {
  const baseUrl = new URL('https://propcontrol.example/');
  const html = rootHtml([
    '<link href="/random-layout-927.css?v=x" rel="stylesheet">',
    '<script src="./runtime-unexpected-481.js?v=y" type="module"></script>',
    '<script src="https://cdn.example/external.js"></script>',
  ].join(''));
  const assets = smoke.discoverDirectAssets(html, baseUrl);
  assert.deepEqual(assets.map((asset: any) => `${asset.kind}:${asset.url.pathname}${asset.url.search}`), [
    'js:/runtime-unexpected-481.js?v=y',
    'css:/random-layout-927.css?v=x',
  ]);
});

test('14. retry transitorio sólo reintenta red/5xx y puede recuperar', async () => {
  let calls = 0;
  await withServer((_request, response) => {
    calls += 1;
    if (calls === 1) return send(response, 503, 'application/json', JSON.stringify({ ok: false }));
    send(response, 200, 'application/json', JSON.stringify({ ok: true }));
  }, async (baseUrl) => {
    await smoke.checkHealth(baseUrl, { maxAttempts: 2, retryDelayMs: 1, timeoutMs: 1_000 });
    assert.equal(calls, 2);
  });
});

test('15. retry agotado => FAIL sin transformar el 5xx en PASS', async () => {
  let calls = 0;
  await withServer((_request, response) => {
    calls += 1;
    send(response, 503, 'application/json', JSON.stringify({ ok: false }));
  }, async (baseUrl) => {
    await expectReject(
      smoke.checkHealth(baseUrl, { maxAttempts: 2, retryDelayMs: 1, timeoutMs: 1_000 }),
      /\/health FAIL: HTTP 503/,
    );
    assert.equal(calls, 2);
  });
});

test('16. workflow: production + success ejecuta smoke real', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /github\.event\.deployment_status\.state == 'success'/);
  assert.match(workflow, /github\.event\.deployment\.environment == 'joyful-success \/ production'/);
});

test('17. workflow: otro environment no ejecuta', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /github\.event\.deployment\.environment == 'joyful-success \/ production'/);
  assert.doesNotMatch(workflow, /environment\s*!=/);
});

test('18. workflow: deployment no-success no ejecuta', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /github\.event\.deployment_status\.state == 'success'/);
  assert.doesNotMatch(workflow, /in_progress\s*==|failure\s*==|inactive\s*==/);
});

test('19. workflow_dispatch está disponible para diagnóstico manual', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /deployment_status:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
});

test('20. workflow usa vars.PRODUCTION_BASE_URL y nunca environment_url', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /PRODUCTION_BASE_URL: \$\{\{ vars\.PRODUCTION_BASE_URL \}\}/);
  assert.doesNotMatch(workflow, /environment_url/);
  assert.match(workflow, /name: post-deploy-smoke-diagnostics/);
  assert.match(workflow, /if: always\(\)/);
});

test('21. browser smoke detecta pageerror', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'propcontrol-smoke-browser-error-'));
  try {
    await withServer((_request, response) => send(response, 200, 'text/html', `<!doctype html><html><body><main class="public-auth-shell"><form id="public-auth-form"><button>Ingresar</button></form></main><script>throw new Error('boom-smoke')</script></body></html>`), async (baseUrl) => {
      await expectReject(smoke.runBrowserSmoke(baseUrl, {
        executablePath: chromeExecutable(),
        screenshotPath: join(directory, 'pageerror.png'),
        navigationTimeoutMs: 10_000,
        markerTimeoutMs: 5_000,
      }), /browser FAIL: pageerror detectado: boom-smoke/);
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('22. browser smoke exige marcador estable del shell/auth actual', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'propcontrol-smoke-browser-marker-'));
  try {
    await t.test('marcador actual presente => PASS', async () => {
      await withServer((_request, response) => send(response, 200, 'text/html', '<!doctype html><html><body><main class="public-auth-shell"><form id="public-auth-form"><button>Ingresar</button></form></main></body></html>'), async (baseUrl) => {
        await smoke.runBrowserSmoke(baseUrl, {
          executablePath: chromeExecutable(),
          screenshotPath: join(directory, 'pass.png'),
          navigationTimeoutMs: 10_000,
          markerTimeoutMs: 5_000,
        });
      });
    });
    await t.test('marcador ausente => FAIL', async () => {
      await withServer((_request, response) => send(response, 200, 'text/html', '<!doctype html><html><body><main>sin auth gate</main></body></html>'), async (baseUrl) => {
        await expectReject(smoke.runBrowserSmoke(baseUrl, {
          executablePath: chromeExecutable(),
          screenshotPath: join(directory, 'fail.png'),
          navigationTimeoutMs: 10_000,
          markerTimeoutMs: 250,
        }), /browser FAIL:/);
      });
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
