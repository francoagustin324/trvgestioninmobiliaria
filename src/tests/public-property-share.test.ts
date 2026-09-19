import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { publicFichaHtml } from '../public-ficha.js';
import { createPropertyPublicSlug, loadPublicPropertyFicha, propertyPublicUrl } from '../public-property-share.js';

const share = readFileSync('src/public-property-share.ts', 'utf8');
const main = readFileSync('src/mvp-main.ts', 'utf8');
const server = readFileSync('src/server.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260717113000_public_property_fichas.sql', 'utf8');
const styles = readFileSync('src/styles.css', 'utf8');

function chromeExecutable(): string | undefined {
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(existsSync);
}

test('genera un slug legible, corto y sin datos sensibles', () => {
  const slug = createPropertyPublicSlug('Casa Duarte Quirós');
  assert.match(slug, /^casa-duarte-quiros-[a-z0-9]{7}$/);
  assert.ok(slug.length < 80);
});

test('arma una ruta pública corta bajo el dominio configurado', () => {
  assert.equal(
    propertyPublicUrl('casa-duarte-quiros-a7k3p9x', 'https://fichas.propcontrol.com/'),
    'https://fichas.propcontrol.com/ficha/casa-duarte-quiros-a7k3p9x',
  );
});

test('publica por propiedad, conserva el registro editable y usa snapshot tenant-aware', () => {
  assert.ok(share.includes("on_conflict', 'organization_id,property_key'"));
  assert.ok(share.includes("Prefer: 'resolution=merge-duplicates,return=representation'"));
  assert.ok(share.includes('propertySnapshot.publicSlug'));
  assert.ok(share.includes('payload: propertyToPublicFicha(propertySnapshot, tenantSnapshot)'));
  assert.ok(share.includes('tenantSnapshot.organizationId !== scope.organizationId'));
  assert.ok(share.includes('organization_id: scope.organizationId'));
});

test('la ficha corta conserva identidad tenant también en mobile y print sin depender del runtime autenticado', { timeout: 60_000 }, async () => {
  assert.ok(main.includes("location.pathname.match(/^\\/ficha\\/"));
  assert.ok(main.includes('await loadPublicPropertyFicha'));
  assert.ok(share.includes('/rest/v1/rpc/get_public_property_ficha'));
  assert.ok(migration.includes('grant execute on function public.get_public_property_ficha(text) to anon, authenticated'));

  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Se requiere Chrome/Chromium para validar mobile/print de ficha pública.');
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  try {
    const tenantAHtml = publicFichaHtml({
      tenant: {
        organizationId: 'tenant-a',
        name: 'TRV Gestión Inmobiliaria',
        commercialPhone: '+54 9 351 1111111',
        logoPath: '/tenant-a.svg',
        legalText: 'Legal A',
      },
      title: 'Propiedad A',
      photoUrls: [],
    });
    await page.setContent(`<style>${styles}</style>${tenantAHtml}`);
    assert.equal(((await page.locator('.public-header > div > span').textContent()) ?? '').trim(), 'TRV Gestión Inmobiliaria');
    assert.match(await page.locator('.whatsapp-public').getAttribute('href') ?? '', /5493511111111/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 390), true);
    await page.emulateMedia({ media: 'print' });
    assert.equal(((await page.locator('.public-header > div > span').textContent()) ?? '').trim(), 'TRV Gestión Inmobiliaria');
    assert.equal(await page.locator('.whatsapp-public').evaluate((node) => getComputedStyle(node).display), 'none');

    await page.emulateMedia({ media: 'screen' });
    const tenantBHtml = publicFichaHtml({
      tenant: {
        organizationId: 'tenant-b',
        name: 'Inmobiliaria Norte Test',
        commercialPhone: '+54 9 351 2222222',
        logoPath: '',
        legalText: 'Legal B',
      },
      title: 'Propiedad B',
      photoUrls: [],
    });
    await page.setContent(`<style>${styles}</style>${tenantBHtml}`);
    assert.equal(((await page.locator('.public-header > div > span').textContent()) ?? '').trim(), 'Inmobiliaria Norte Test');
    assert.match(await page.locator('.whatsapp-public').getAttribute('href') ?? '', /5493512222222/);
    assert.equal(await page.locator('.public-tenant-logo-placeholder').count(), 1);
    assert.equal((await page.locator('body').innerText()).includes('TRV Gestión Inmobiliaria'), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 390), true);
    await page.emulateMedia({ media: 'print' });
    assert.equal(((await page.locator('.public-header > div > span').textContent()) ?? '').trim(), 'Inmobiliaria Norte Test');
    assert.equal(await page.locator('.whatsapp-public').evaluate((node) => getComputedStyle(node).display), 'none');
  } finally {
    await context.close();
    await browser.close();
  }
});

test('la tabla pública protege escritura y no expone información interna', () => {
  assert.ok(migration.includes('create table if not exists public.public_property_fichas'));
  assert.ok(migration.includes('payload jsonb not null'));
  assert.ok(migration.includes('alter table public.public_property_fichas enable row level security'));
  assert.ok(migration.includes('member.user_id = auth.uid()'));
  assert.equal(migration.includes('owner'), false);
  assert.equal(migration.includes('notes'), false);
});

test('el servidor admite un dominio exclusivo para fichas PropControl', () => {
  assert.ok(server.includes('PUBLIC_FICHA_URL'));
  assert.ok(server.includes('publicUrl: publicFichaUrl || undefined'));
});

test('un fallo transitorio de red no deja la ficha pegada: el siguiente intento reintenta', async () => {
  const realFetch = globalThis.fetch;
  let configCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/cloud-config')) {
      configCalls += 1;
      if (configCalls === 1) throw new Error('fallo de red transitorio');
      return new Response(
        JSON.stringify({ configured: true, url: 'https://x.supabase.co', publishableKey: 'pk_test' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('get_public_property_ficha')) {
      return new Response(
        JSON.stringify({ title: 'Casa Duarte Quirós', photoUrls: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`URL inesperada: ${url}`);
  }) as typeof fetch;

  try {
    // Primer intento: la config falla → la ficha no carga.
    await assert.rejects(() => loadPublicPropertyFicha('casa-duarte-quiros-a7k3p9x'));
    // Segundo intento: NO queda pegado en el error memorizado → carga bien.
    const ficha = await loadPublicPropertyFicha('casa-duarte-quiros-a7k3p9x');
    assert.equal(ficha?.title, 'Casa Duarte Quirós');
    assert.equal(configCalls, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
