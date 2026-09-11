import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './sec-fix-a1-2-c2-test-setup.js';
import type { TenantScope } from '../active-organization.js';
import { signOutCloud } from '../cloud-api.js';
import { initialData, type CrmData } from '../models.js';
import {
  openPropertyFicha,
  publishAndRememberPropertyFicha,
  sharePropertyFicha,
} from '../mvp-properties-ui.js';
import type { PropertyWithFicha } from '../property-ficha.js';
import {
  loadPublicPropertyFicha,
  PUBLIC_PROPERTY_SHARE_RESPONSE_INVALID,
  PUBLIC_PROPERTY_SHARE_RESPONSE_MISMATCH,
  publishPropertyFicha,
} from '../public-property-share.js';
import { replaceDataForTenant, state } from '../store.js';
import {
  captureTenantRuntimeLease,
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
  TENANT_RUNTIME_SESSION_MISMATCH,
} from '../tenant-runtime.js';
import { readTenantSyncState } from '../tenant-storage.js';

const SESSION_KEY = 'propcontrol-cloud-session-v1';
const CLOUD_URL = 'https://tenant-g-public-share.test';
const APP_ORIGIN = 'https://app-g.test';
const USER = 'public-share-user';
const OTHER_USER = 'other-public-share-user';
const ORG_A = '00000000-0000-0000-0000-0000000000a1';
const ORG_B = '00000000-0000-0000-0000-0000000000b1';

const shareSource = readFileSync('src/public-property-share.ts', 'utf8');
const uiSource = readFileSync('src/mvp-properties-ui.ts', 'utf8');

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

type Deferred = Readonly<{ promise: Promise<void>; resolve: () => void }>;
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return Object.freeze({ promise, resolve });
}

function scope(organizationId: string, userId = USER): TenantScope {
  return Object.freeze({ userId, organizationId });
}

function property(id = 101, title = 'Casa segura A'): PropertyWithFicha {
  return {
    id,
    title,
    address: 'Docta, Córdoba',
    type: 'Casa',
    operation: 'Venta',
    price: 130000,
    owner: 'DATO INTERNO PROPIETARIO',
    status: 'Disponible',
    bedrooms: 2,
    bathrooms: 2,
    paymentMethod: 'Contado',
    features: 'Patio y cochera',
    notes: 'NOTA INTERNA PRIVADA',
    description: 'Descripción pública',
    photoUrls: ['https://images.example.test/casa.jpg'],
    assignedToId: 1,
    createdById: 1,
  } as PropertyWithFicha;
}

function crmFor(organizationId: string, item: PropertyWithFicha, name = organizationId): CrmData {
  const crm = structuredClone(initialData);
  crm.organization.id = organizationId;
  crm.organization.name = name;
  crm.teamMembers[0]!.userId = USER;
  crm.teamMembers[0]!.role = 'Dueño';
  crm.teamMembers[0]!.status = 'Activo';
  crm.properties = [structuredClone(item)];
  return crm;
}

function installCustomEventAndDocument(): EventTarget {
  if (typeof globalThis.CustomEvent === 'undefined') {
    Object.defineProperty(globalThis, 'CustomEvent', {
      configurable: true,
      writable: true,
      value: class<T = unknown> extends Event {
        readonly detail: T;
        constructor(type: string, init: CustomEventInit<T> = {}) {
          super(type);
          this.detail = init.detail as T;
        }
      },
    });
  }
  const documentTarget = new EventTarget();
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: documentTarget,
  });
  return documentTarget;
}

function resetEnvironment(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: new MemoryStorage(),
  });
  installCustomEventAndDocument();
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    writable: true,
    value: { origin: APP_ORIGIN, pathname: '/', assign: () => undefined },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {},
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      alert: () => undefined,
      open: () => null,
      requestAnimationFrame: (callback: FrameRequestCallback) => callback(0),
    },
  });
  invalidateTenantRuntimeScope();
  state.crm = structuredClone(initialData);
}

function setSession(userId = USER): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    accessToken: `access-${userId}`,
    refreshToken: `refresh-${userId}`,
    expiresAt: Date.now() + 60 * 60 * 1000,
    userId,
    email: `${userId}@example.test`,
  }));
}

function installRuntime(tenantScope: TenantScope): void {
  installTenantRuntimeScope(tenantScope, tenantScope.userId);
}

function prepareUiTenant(tenantScope: TenantScope, item: PropertyWithFicha, name = tenantScope.organizationId): PropertyWithFicha {
  installRuntime(tenantScope);
  assert.equal(replaceDataForTenant(tenantScope, crmFor(tenantScope.organizationId, item, name), false), true);
  return state.crm.properties[0] as PropertyWithFicha;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

type PublishBody = {
  organization_id: string;
  property_key: string;
  slug: string;
  payload: Record<string, unknown>;
  published: boolean;
  created_by: string;
  updated_at: string;
};

type HarnessOptions = {
  blockPost?: boolean;
  responseRows?: (body: PublishBody) => unknown;
  publicFicha?: unknown;
};

function installFetchHarness(options: HarnessOptions = {}): {
  postStarted: Promise<void>;
  releasePost: () => void;
  bodies: PublishBody[];
  postUrls: string[];
  membershipRequests: string[];
} {
  const postStarted = deferred();
  const releasePost = deferred();
  const bodies: PublishBody[] = [];
  const postUrls: string[] = [];
  const membershipRequests: string[] = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
      const url = fetchUrl(input);
      if (url === '/api/cloud-config') {
        return json({ configured: true, url: CLOUD_URL, publishableKey: 'public-key', publicUrl: APP_ORIGIN });
      }
      if (url.includes('/rest/v1/organization_members')) {
        membershipRequests.push(url);
        return json([{ organization_id: ORG_B }, { organization_id: ORG_A }]);
      }
      if (url.startsWith(`${CLOUD_URL}/rest/v1/public_property_fichas`)) {
        const body = JSON.parse(String(init.body || '{}')) as PublishBody;
        bodies.push(body);
        postUrls.push(url);
        postStarted.resolve();
        if (options.blockPost) await releasePost.promise;
        const rows = options.responseRows
          ? options.responseRows(body)
          : [{ organization_id: body.organization_id, property_key: body.property_key, slug: body.slug }];
        return json(rows);
      }
      if (url.startsWith(`${CLOUD_URL}/rest/v1/rpc/get_public_property_ficha`)) {
        return json(options.publicFicha ?? { title: 'Ficha pública anónima', photoUrls: [] });
      }
      throw new Error(`G_FETCH_UNEXPECTED:${url}`);
    }) as typeof fetch,
  });

  return {
    postStarted: postStarted.promise,
    releasePost: releasePost.resolve,
    bodies,
    postUrls,
    membershipRequests,
  };
}

function button(label: string): HTMLButtonElement {
  return { textContent: label, disabled: false } as unknown as HTMLButtonElement;
}

function sourceFunction(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `source boundary missing: ${start}`);
  return source.slice(from, to);
}

test('G1 multi-org A+B con runtime A publica exclusivamente organization_id A', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installRuntime(a);
  const harness = installFetchHarness();
  const result = await publishPropertyFicha(property(), a, captureTenantRuntimeLease(a));
  assert.equal(harness.bodies.length, 1);
  assert.equal(harness.bodies[0]!.organization_id, ORG_A);
  assert.equal(harness.membershipRequests.length, 0);
  assert.match(result.url, /\/ficha\//);
});

test('G2 runtime B publica organization_id B', async () => {
  resetEnvironment();
  setSession();
  const b = scope(ORG_B);
  installRuntime(b);
  const harness = installFetchHarness();
  await publishPropertyFicha(property(102, 'Casa B'), b, captureTenantRuntimeLease(b));
  assert.equal(harness.bodies[0]!.organization_id, ORG_B);
});

test('G3 publish no descubre tenant con limit=1, rows[0] ni organization_members', () => {
  const body = sourceFunction(shareSource, 'export async function publishPropertyFicha', 'function validPublicFicha');
  assert.doesNotMatch(body, /organization_members/);
  assert.doesNotMatch(body, /limit['"\s,)]*1/);
  assert.doesNotMatch(body, /rows\s*\[\s*0\s*\]/);
  assert.doesNotMatch(shareSource, /async function organizationId\(/);
});

test('G4 session.userId distinto de scope.userId falla cerrado', async () => {
  resetEnvironment();
  setSession(OTHER_USER);
  const a = scope(ORG_A);
  installRuntime(a);
  const harness = installFetchHarness();
  await assert.rejects(
    publishPropertyFicha(property(), a, captureTenantRuntimeLease(a)),
    new RegExp(TENANT_RUNTIME_SESSION_MISMATCH),
  );
  assert.equal(harness.bodies.length, 0);
});

test('G5 payload created_by usa exactamente session.userId capturado', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installRuntime(a);
  const harness = installFetchHarness();
  await publishPropertyFicha(property(), a, captureTenantRuntimeLease(a));
  assert.equal(harness.bodies[0]!.created_by, USER);
});

test('G6 property_key es exactamente String(property.id)', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installRuntime(a);
  const harness = installFetchHarness();
  await publishPropertyFicha(property(987), a, captureTenantRuntimeLease(a));
  assert.equal(harness.bodies[0]!.property_key, '987');
});

test('G7 representación exacta org/key/slug válida retorna éxito', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installRuntime(a);
  installFetchHarness();
  const result = await publishPropertyFicha(property(), a, captureTenantRuntimeLease(a));
  assert.match(result.slug, /^[a-z0-9][a-z0-9-]{4,79}$/);
  assert.equal(result.url, `${APP_ORIGIN}/ficha/${encodeURIComponent(result.slug)}`);
});

test('G8 response organization B bajo scope A falla cerrado', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installRuntime(a);
  installFetchHarness({ responseRows: (body) => [{ organization_id: ORG_B, property_key: body.property_key, slug: body.slug }] });
  await assert.rejects(
    publishPropertyFicha(property(), a, captureTenantRuntimeLease(a)),
    new RegExp(PUBLIC_PROPERTY_SHARE_RESPONSE_MISMATCH),
  );
});

test('G9 response property_key incorrecta falla cerrado', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installRuntime(a);
  installFetchHarness({ responseRows: (body) => [{ organization_id: ORG_A, property_key: 'otra', slug: body.slug }] });
  await assert.rejects(
    publishPropertyFicha(property(), a, captureTenantRuntimeLease(a)),
    new RegExp(PUBLIC_PROPERTY_SHARE_RESPONSE_MISMATCH),
  );
});

test('G10 respuesta ambigua cero o múltiples filas falla cerrado', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installRuntime(a);
  installFetchHarness({ responseRows: () => [] });
  await assert.rejects(
    publishPropertyFicha(property(), a, captureTenantRuntimeLease(a)),
    new RegExp(PUBLIC_PROPERTY_SHARE_RESPONSE_INVALID),
  );

  const harness = installFetchHarness({
    responseRows: (body) => [
      { organization_id: ORG_A, property_key: body.property_key, slug: body.slug },
      { organization_id: ORG_A, property_key: body.property_key, slug: `${body.slug}-otra` },
    ],
  });
  await assert.rejects(
    publishPropertyFicha(property(103), a, captureTenantRuntimeLease(a)),
    new RegExp(PUBLIC_PROPERTY_SHARE_RESPONSE_INVALID),
  );
  assert.equal(harness.bodies.length, 1);
});

test('G11 A→B publish pendiente conserva request A y completion no afecta runtime B', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  const b = scope(ORG_B);
  const propertyA = prepareUiTenant(a, property(), 'A');
  const harness = installFetchHarness({ blockPost: true });
  let shared = 0;
  let copied = 0;
  let alerted = 0;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      share: async () => { shared += 1; },
      clipboard: { writeText: async () => { copied += 1; } },
    },
  });
  (window as unknown as { alert: () => void }).alert = () => { alerted += 1; };

  const pending = sharePropertyFicha(propertyA, button('Compartir ficha'));
  await harness.postStarted;
  const propertyB = prepareUiTenant(b, property(202, 'B current'), 'B');
  const bBefore = structuredClone(state.crm);
  const bSyncBefore = readTenantSyncState(b);
  harness.releasePost();
  await pending;

  assert.equal(harness.bodies[0]!.organization_id, ORG_A);
  assert.deepEqual(state.crm, bBefore);
  assert.deepEqual(readTenantSyncState(b), bSyncBefore);
  assert.equal(propertyB.publicSlug, undefined);
  assert.equal(shared, 0);
  assert.equal(copied, 0);
  assert.equal(alerted, 0);
});

test('G12 A→B→A mantiene A1 stale aunque vuelva el mismo scope', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  const b = scope(ORG_B);
  const propertyA1 = prepareUiTenant(a, property(301, 'A1'), 'A1');
  const harness = installFetchHarness({ blockPost: true });
  let shared = 0;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { share: async () => { shared += 1; } },
  });
  const pending = sharePropertyFicha(propertyA1, button('Compartir ficha'));
  await harness.postStarted;
  prepareUiTenant(b, property(302, 'B'), 'B');
  const propertyA2 = prepareUiTenant(a, property(301, 'A2'), 'A2');
  harness.releasePost();
  await pending;
  assert.equal(state.crm.organization.name, 'A2');
  assert.equal(propertyA2.publicSlug, undefined);
  assert.equal(shared, 0);
});

test('G13 logout durante publish pendiente deja completion sin slug, share, copy ni alert tardío', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  const propertyA = prepareUiTenant(a, property(401, 'A logout'), 'A');
  const harness = installFetchHarness({ blockPost: true });
  let shared = 0;
  let copied = 0;
  let alerted = 0;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      share: async () => { shared += 1; },
      clipboard: { writeText: async () => { copied += 1; } },
    },
  });
  (window as unknown as { alert: () => void }).alert = () => { alerted += 1; };
  const pending = sharePropertyFicha(propertyA, button('Compartir ficha'));
  await harness.postStarted;
  signOutCloud();
  harness.releasePost();
  await pending;
  assert.equal(propertyA.publicSlug, undefined);
  assert.equal(shared, 0);
  assert.equal(copied, 0);
  assert.equal(alerted, 0);
});

test('G14 share completion stale no invoca navigator.share ni clipboard', () => {
  const body = sourceFunction(uiSource, 'export async function sharePropertyFicha', 'export async function openPropertyFicha');
  assert.match(body, /await publishAndRememberPropertyFicha\(property, scope, runtimeLease\)/);
  assert.match(body, /assertPropertyShareOperationCurrent\(scope, runtimeLease\)/);
  assert.match(body, /if \(!propertyShareOperationIsCurrent\(scope, runtimeLease\)\) return;/);
});

test('G15 open A→B pendiente no navega completion vieja', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  const b = scope(ORG_B);
  const propertyA = prepareUiTenant(a, property(501, 'A open'), 'A');
  const harness = installFetchHarness({ blockPost: true });
  let replaced = 0;
  let assigned = 0;
  let alerted = 0;
  const preview = {
    location: { replace: () => { replaced += 1; } },
    close: () => undefined,
  };
  (window as unknown as { open: () => unknown; alert: () => void }).open = () => preview;
  (window as unknown as { alert: () => void }).alert = () => { alerted += 1; };
  (location as unknown as { assign: () => void }).assign = () => { assigned += 1; };

  const pending = openPropertyFicha(propertyA, button('Ver ficha'));
  await harness.postStarted;
  prepareUiTenant(b, property(502, 'B open'), 'B');
  harness.releasePost();
  await pending;
  assert.equal(replaced, 0);
  assert.equal(assigned, 0);
  assert.equal(alerted, 0);
});

test('G16 publicSlug stale no se modifica', () => {
  const body = sourceFunction(uiSource, 'export function rememberPublishedFicha', 'export async function publishAndRememberPropertyFicha');
  assert.match(body, /assertPropertyShareTarget\(property, scope, runtimeLease\)/);
  assert.match(body, /current\.publicSlug = slug/);
  assert.match(body, /assertPropertyShareOperationCurrent\(scope, runtimeLease\)/);
});

test('G17 stale no puede alcanzar saveData en rememberPublishedFicha', () => {
  const body = sourceFunction(uiSource, 'export function rememberPublishedFicha', 'export async function publishAndRememberPropertyFicha');
  const guard = body.indexOf('assertPropertyShareTarget(property, scope, runtimeLease)');
  const save = body.indexOf('saveData(reason)');
  assert.ok(guard >= 0 && save > guard);
});

test('G18 auto-update publicado usa el mismo helper y A→B no muta B', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  const b = scope(ORG_B);
  const publishedA = property(601, 'A update');
  publishedA.publicSlug = 'a-update-1234567';
  const propertyA = prepareUiTenant(a, publishedA, 'A');
  const leaseA = captureTenantRuntimeLease(a);
  const harness = installFetchHarness({ blockPost: true });
  const pending = publishAndRememberPropertyFicha(propertyA, a, leaseA, 'Ficha pública actualizada', true);
  await harness.postStarted;
  const propertyB = prepareUiTenant(b, property(602, 'B update'), 'B');
  const bBefore = structuredClone(state.crm);
  const bSyncBefore = readTenantSyncState(b);
  harness.releasePost();
  await assert.rejects(pending, /TENANT_RUNTIME_STALE/);
  assert.deepEqual(state.crm, bBefore);
  assert.deepEqual(readTenantSyncState(b), bSyncBefore);
  assert.equal(propertyB.publicSlug, undefined);

  const submitBlock = sourceFunction(uiSource, "if (property.publicSlug) {", 'state.editingPropertyId = null');
  assert.match(submitBlock, /publishAndRememberPropertyFicha\(/);
  assert.match(submitBlock, /'Ficha pública actualizada'/);
  assert.match(submitBlock, /runtimeLease/);
});

test('G19 single-org normal publica correctamente sin lookup de membership', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installRuntime(a);
  const harness = installFetchHarness();
  const result = await publishPropertyFicha(property(701, 'Single org'), a, captureTenantRuntimeLease(a));
  assert.equal(harness.bodies.length, 1);
  assert.equal(harness.membershipRequests.length, 0);
  assert.ok(result.slug);
});

test('G20 carga pública anónima por slug sigue funcionando sin sesión', async () => {
  resetEnvironment();
  const harness = installFetchHarness({ publicFicha: { title: 'Pública anon', photoUrls: ['javascript:alert(1)', 'https://safe.example.test/a.jpg'] } });
  const ficha = await loadPublicPropertyFicha('publica-anon-1234567');
  assert.equal(ficha?.title, 'Pública anon');
  assert.deepEqual(ficha?.photoUrls, ['https://safe.example.test/a.jpg']);
  assert.equal(harness.bodies.length, 0);
});

test('G21 shareConfig conserva retry después de fallo transitorio', () => {
  const body = sourceFunction(shareSource, 'async function shareConfig', 'function headers');
  assert.match(body, /configPromise = null/);
  assert.match(body, /throw error/);
});

test('G22 upsert conserva on_conflict organization_id,property_key', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installRuntime(a);
  const harness = installFetchHarness();
  await publishPropertyFicha(property(801), a, captureTenantRuntimeLease(a));
  const url = new URL(harness.postUrls[0]!);
  assert.equal(url.searchParams.get('on_conflict'), 'organization_id,property_key');
});

test('G23 payload público continúa excluyendo owner/notes mediante propertyToPublicFicha(snapshot)', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installRuntime(a);
  const harness = installFetchHarness();
  await publishPropertyFicha(property(901), a, captureTenantRuntimeLease(a));
  const publicPayload = harness.bodies[0]!.payload;
  assert.equal('owner' in publicPayload, false);
  assert.equal('notes' in publicPayload, false);
  assert.match(shareSource, /payload: propertyToPublicFicha\(propertySnapshot\)/);
});

test('G24 evidencia negativa: public-property-share no decide tenant por membership order', () => {
  assert.doesNotMatch(shareSource, /organization_members/);
  assert.doesNotMatch(shareSource, /rows\s*\[\s*0\s*\]/);
  assert.doesNotMatch(shareSource, /query\.searchParams\.set\(['"]limit['"],\s*['"]1['"]\)/);
  assert.doesNotMatch(shareSource, /state\.crm\.organization\.id/);
  assert.match(shareSource, /organization_id: scope\.organizationId/);
});

test('G25 property snapshot se congela antes del primer await del publish', () => {
  const body = sourceFunction(shareSource, 'export async function publishPropertyFicha', 'function validPublicFicha');
  const snapshot = body.indexOf('const propertySnapshot = structuredClone(property)');
  const firstAwait = body.indexOf('await shareConfig()');
  assert.ok(snapshot >= 0 && firstAwait > snapshot);
  assert.match(body, /propertyToPublicFicha\(propertySnapshot\)/);
});

test('G26 response sin identidad suficiente falla cerrado', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installRuntime(a);
  installFetchHarness({ responseRows: (body) => [{ slug: body.slug }] });
  await assert.rejects(
    publishPropertyFicha(property(1001), a, captureTenantRuntimeLease(a)),
    new RegExp(PUBLIC_PROPERTY_SHARE_RESPONSE_MISMATCH),
  );
});

test('G27 logout directo durante writer pendiente invalida la aceptación de respuesta', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installRuntime(a);
  const harness = installFetchHarness({ blockPost: true });
  const pending = publishPropertyFicha(property(1101), a, captureTenantRuntimeLease(a));
  await harness.postStarted;
  signOutCloud();
  harness.releasePost();
  await assert.rejects(pending, /La sesión venció/);
});

test('G28 open/share capturan scope y runtimeLease antes del publish async', () => {
  const shareBody = sourceFunction(uiSource, 'export async function sharePropertyFicha', 'export async function openPropertyFicha');
  const openBody = sourceFunction(uiSource, 'export async function openPropertyFicha', 'function bindPropertyCardActions');
  for (const body of [shareBody, openBody]) {
    const scopeCapture = body.indexOf('const scope = requireCurrentTenantScope()');
    const leaseCapture = body.indexOf('const runtimeLease = captureTenantRuntimeLease(scope)');
    const publish = body.indexOf('await publishAndRememberPropertyFicha');
    assert.ok(scopeCapture >= 0 && leaseCapture > scopeCapture && publish > leaseCapture);
  }
});
