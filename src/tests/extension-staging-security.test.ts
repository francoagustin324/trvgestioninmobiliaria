import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const directory = 'extension/trv-fichas-chrome';
const destinationSource = readFileSync(directory + '/staging-destination.js', 'utf8');
const backgroundSource = readFileSync(directory + '/background.js', 'utf8');

type Destination = Readonly<{
  storageKey: string;
  parse: (value: unknown) => string | null;
}>;

function loadDestination(): Destination {
  const sandbox: Record<string, unknown> = { URL };
  sandbox.globalThis = sandbox;
  runInNewContext(destinationSource, sandbox);
  return sandbox.ordenbrokerStagingDestination as Destination;
}

function backgroundHarness(savedOrigin: string | null, permitted = true) {
  const requests: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
  const openedTabs: string[] = [];
  const extractedTabs: number[] = [];
  let hostPermission = permitted;

  const chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: savedOrigin }),
      },
    },
    permissions: {
      contains: async () => hostPermission,
    },
    tabs: {
      get: async () => ({
        status: 'complete',
        url: 'https://www.zonaprop.com.ar/propiedades/departamento-sintetico.html',
      }),
      create: async (options: { url: string }) => {
        openedTabs.push(options.url);
        return { id: 70 + openedTabs.length };
      },
      query: async () => [{ id: 10 }],
      onUpdated: {
        addListener: () => undefined,
        removeListener: () => undefined,
      },
    },
    scripting: {
      executeScript: async (options: { target: { tabId: number } }) => {
        extractedTabs.push(options.target.tabId);
        return [{
          result: {
            sourceUrl: 'https://www.zonaprop.com.ar/propiedades/departamento-sintetico.html',
            data: {
              title: 'Departamento sintético para QA',
              price: 'USD 100000',
              zone: 'Centro',
              photoUrls: ['https://images.example.test/property.jpg'],
            },
          },
        }];
      },
    },
    runtime: { onMessage: { addListener: () => undefined } },
  };

  const sandbox: Record<string, unknown> = {
    URL,
    setTimeout,
    clearTimeout,
    chrome,
    importScripts: () => undefined,
    fetch: async (input: string, init?: RequestInit) => {
      requests.push({ url: String(input), redirect: init?.redirect });
      return { ok: true, json: async () => ({ success: true, token: 'synthetic-token' }) };
    },
  };
  sandbox.globalThis = sandbox;
  runInNewContext(destinationSource + '\n' + backgroundSource
    + '\n;globalThis.__qa = { createFichaFromTab, openAndCreate };', sandbox);
  const operations = sandbox.__qa as {
    createFichaFromTab: (tabId: number) => Promise<{ success: boolean }>;
    openAndCreate: (url: string) => Promise<{ success: boolean }>;
  };
  return {
    operations,
    requests,
    openedTabs,
    extractedTabs,
    setPermission: (value: boolean) => { hostPermission = value; },
  };
}

test('extensión OrdenBroker sólo admite un origen HTTPS explícito de staging, nunca producción', () => {
  const destination = loadDestination();
  assert.equal(destination.storageKey, 'ordenbroker-extension-staging-origin-v1');
  assert.equal(destination.parse('https://ordenbroker-staging.onrender.com/'), 'https://ordenbroker-staging.onrender.com');
  assert.equal(destination.parse('https://staging.ordenbroker.com.ar/'), 'https://staging.ordenbroker.com.ar');
  for (const forbidden of [
    null,
    '',
    'https://trvgestioninmobiliaria-production.up.railway.app',
    'https://production.ordenbroker.com.ar',
    'https://ordenbroker-staging.onrender.com.evil.test',
    'http://ordenbroker-staging.onrender.com',
    'https://ordenbroker-staging.onrender.com/otra-ruta',
    'https://ordenbroker-staging.onrender.com/#extension-import=token',
    'https://usuario:clave@ordenbroker-staging.onrender.com',
  ]) {
    assert.equal(destination.parse(forbidden), null, String(forbidden));
  }
});

test('sin staging configurado, con producción configurada o sin permiso no se abre ni se envía ninguna importación', async () => {
  for (const origin of [
    null,
    'https://trvgestioninmobiliaria-production.up.railway.app',
    'https://production.ordenbroker.com.ar',
  ]) {
    const harness = backgroundHarness(origin);
    await assert.rejects(harness.operations.createFichaFromTab(10), /Configurá primero la URL HTTPS de OrdenBroker staging/);
    await assert.rejects(
      harness.operations.openAndCreate('https://www.zonaprop.com.ar/propiedades/departamento-sintetico.html'),
      /Configurá primero la URL HTTPS de OrdenBroker staging/,
    );
    assert.deepEqual(harness.requests, []);
    assert.deepEqual(harness.openedTabs, []);
    assert.deepEqual(harness.extractedTabs, []);
  }
  const denied = backgroundHarness('https://ordenbroker-staging.onrender.com', false);
  await assert.rejects(denied.operations.createFichaFromTab(10), /Autorizá el destino OrdenBroker staging/);
  assert.deepEqual(denied.requests, []);
  assert.deepEqual(denied.openedTabs, []);
  assert.deepEqual(denied.extractedTabs, []);
});

test('con staging autorizado el único POST y la ficha abren staging; redirecciones HTTP están prohibidas', async () => {
  const harness = backgroundHarness('https://ordenbroker-staging.onrender.com');
  assert.equal((await harness.operations.createFichaFromTab(10)).success, true);
  assert.deepEqual(harness.requests, [{
    url: 'https://ordenbroker-staging.onrender.com/api/extension-import',
    redirect: 'error',
  }]);
  assert.deepEqual(harness.openedTabs, [
    'https://ordenbroker-staging.onrender.com/#extension-import=synthetic-token',
  ]);
  assert.deepEqual(harness.extractedTabs, [10]);
  assert.equal(harness.requests.some((request) => request.url.includes('production')), false);
  assert.equal(harness.openedTabs.some((url) => url.includes('production')), false);

  harness.setPermission(false);
  await assert.rejects(harness.operations.createFichaFromTab(10), /Autorizá el destino OrdenBroker staging/);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.openedTabs.length, 1);
});
