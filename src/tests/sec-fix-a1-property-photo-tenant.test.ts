import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import './sec-fix-a1-2-c2-test-setup.js';
import type { TenantScope } from '../active-organization.js';
import { signOutCloud } from '../cloud-api-compatible.js';
import {
  propertyPhotoOperationIsCurrent,
} from '../mvp-properties-ui.js';
import {
  PROPERTY_PHOTO_RESPONSE_ORGANIZATION_MISMATCH,
  uploadPropertyPhoto,
} from '../property-photo-upload.js';
import {
  exactActivePhotoOrganization,
  handlePropertyPhotoStorage,
  PROPERTY_PHOTO_ACTIVE_MEMBERSHIP_REQUIRED,
  propertyPhotoObjectPath,
  type PropertyPhotoMembershipRow,
} from '../server/property-photo-storage.js';
import {
  captureTenantRuntimeLease,
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
  TENANT_RUNTIME_STALE,
} from '../tenant-runtime.js';

const SESSION_KEY = 'propcontrol-cloud-session-v1';
const USER = 'photo-tenant-user';
const ORG_A = '00000000-0000-0000-0000-0000000000a1';
const ORG_B = '00000000-0000-0000-0000-0000000000b1';
const SUPABASE_URL = 'https://photo-tenant.test';
const uiSource = readFileSync('src/mvp-properties-ui.ts', 'utf8');
const serverSource = readFileSync('src/server/property-photo-storage.ts', 'utf8');

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

function scope(organizationId: string): TenantScope {
  return Object.freeze({ userId: USER, organizationId });
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

function installCustomEventAndDocument(): void {
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
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: new EventTarget(),
  });
}

function resetEnvironment(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      requestAnimationFrame: (callback: FrameRequestCallback) => callback(0),
    },
  });
  installCustomEventAndDocument();
  invalidateTenantRuntimeScope();
}

function setSession(): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    accessToken: 'photo-access-token',
    refreshToken: 'photo-refresh-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
    userId: USER,
    email: 'photo@example.test',
  }));
}

function file(): File {
  return new File([Buffer.from('jpeg-photo-content')], 'photo.jpg', { type: 'image/jpeg' });
}

function sourceFunction(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `source boundary missing: ${start}`);
  return source.slice(from, to);
}

function requestFor(organizationId: string, remoteAddress: string): IncomingMessage {
  const body = Buffer.from('photo-body');
  return {
    url: `/api/property-photos?propertyId=77&uploadId=upload-test-01&organizationId=${encodeURIComponent(organizationId)}`,
    method: 'POST',
    headers: {
      authorization: 'Bearer server-access-token',
      'content-type': 'image/jpeg',
    },
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() { yield body; },
  } as unknown as IncomingMessage;
}

function responseCapture(): {
  response: ServerResponse;
  status: () => number;
  payload: () => Record<string, unknown>;
} {
  let responseStatus = 0;
  let responsePayload: Record<string, unknown> = {};
  const response = {
    writeHead(status: number) {
      responseStatus = status;
      return this;
    },
    end(body?: string | Buffer) {
      responsePayload = JSON.parse(String(body ?? '{}')) as Record<string, unknown>;
      return this;
    },
  } as unknown as ServerResponse;
  return {
    response,
    status: () => responseStatus,
    payload: () => responsePayload,
  };
}

function installServerFetch(memberships: PropertyPhotoMembershipRow[]): {
  membershipQueries: string[];
  storageUrls: string[];
} {
  const membershipQueries: string[] = [];
  const storageUrls: string[] = [];
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL): Promise<Response> => {
      const url = fetchUrl(input);
      if (url === `${SUPABASE_URL}/auth/v1/user`) return json({ id: USER, email: 'photo@example.test' });
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/organization_members`)) {
        membershipQueries.push(url);
        const parsed = new URL(url);
        const userId = parsed.searchParams.get('user_id')?.replace(/^eq\./, '');
        const organizationId = parsed.searchParams.get('organization_id')?.replace(/^eq\./, '');
        const status = parsed.searchParams.get('status')?.replace(/^eq\./, '');
        return json(memberships.filter((row) => (
          (!userId || row.user_id === userId)
          && (!organizationId || row.organization_id === organizationId)
          && (!status || row.status === status)
        )));
      }
      if (url.startsWith(`${SUPABASE_URL}/storage/v1/object/property-photos/`)) {
        storageUrls.push(url);
        return json({});
      }
      throw new Error(`PHOTO_SERVER_FETCH_UNEXPECTED:${url}`);
    }) as typeof fetch,
  });
  return { membershipQueries, storageUrls };
}

async function runServerUpload(
  organizationId: string,
  memberships: PropertyPhotoMembershipRow[],
  remoteAddress: string,
): Promise<{
  status: number;
  payload: Record<string, unknown>;
  membershipQueries: string[];
  storageUrls: string[];
}> {
  const harness = installServerFetch(memberships);
  const capture = responseCapture();
  const handled = await handlePropertyPhotoStorage(
    requestFor(organizationId, remoteAddress),
    capture.response,
    { supabaseUrl: SUPABASE_URL, publishableKey: 'publishable-key' },
  );
  assert.equal(handled, true);
  return {
    status: capture.status(),
    payload: capture.payload(),
    ...harness,
  };
}

function installClientFetch(options: {
  responseOrganizationId: string;
  block?: boolean;
}): {
  started: Promise<void>;
  release: () => void;
  requestUrls: string[];
} {
  const started = deferred();
  const release = deferred();
  const requestUrls: string[] = [];
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL): Promise<Response> => {
      const url = fetchUrl(input);
      if (!url.startsWith('/api/property-photos?')) throw new Error(`PHOTO_CLIENT_FETCH_UNEXPECTED:${url}`);
      requestUrls.push(url);
      started.resolve();
      if (options.block) await release.promise;
      return json({
        success: true,
        organizationId: options.responseOrganizationId,
        url: `https://cdn.example.test/${options.responseOrganizationId}/77/photo.jpg`,
      }, 201);
    }) as typeof fetch,
  });
  return { started: started.promise, release: release.resolve, requestUrls };
}

test('multi-org A+B trabajando en B almacena bajo B, no bajo la primera membership A', async () => {
  const result = await runServerUpload(ORG_B, [
    { organization_id: ORG_A, user_id: USER, status: 'active' },
    { organization_id: ORG_B, user_id: USER, status: 'active' },
  ], 'photo-b');
  assert.equal(result.status, 201);
  assert.equal(result.payload.organizationId, ORG_B);
  assert.match(String(result.payload.url), new RegExp(`/property-photos/${ORG_B}/77/`));
  assert.equal(result.storageUrls.length, 1);
  assert.match(decodeURIComponent(result.storageUrls[0]!), new RegExp(`/property-photos/${ORG_B}/77/`));
  assert.match(result.membershipQueries[0]!, new RegExp(`organization_id=eq\\.${ORG_B}`));
  assert.match(result.membershipQueries[0]!, /status=eq\.active/);
  assert.doesNotMatch(result.membershipQueries[0]!, /limit=1/);
});

test('multi-org A+B trabajando en A almacena bajo A', async () => {
  const result = await runServerUpload(ORG_A, [
    { organization_id: ORG_B, user_id: USER, status: 'active' },
    { organization_id: ORG_A, user_id: USER, status: 'active' },
  ], 'photo-a');
  assert.equal(result.status, 201);
  assert.equal(result.payload.organizationId, ORG_A);
  assert.match(String(result.payload.url), new RegExp(`/property-photos/${ORG_A}/77/`));
  assert.match(decodeURIComponent(result.storageUrls[0]!), new RegExp(`/property-photos/${ORG_A}/77/`));
});

test('membership inexistente rechaza y no toca Storage', async () => {
  const result = await runServerUpload(ORG_B, [
    { organization_id: ORG_A, user_id: USER, status: 'active' },
  ], 'photo-missing');
  assert.equal(result.status, 403);
  assert.equal(result.storageUrls.length, 0);
  assert.match(String(result.payload.error), new RegExp(PROPERTY_PHOTO_ACTIVE_MEMBERSHIP_REQUIRED));
});

test('membership invited o suspended no adquiere autoridad de fotos', async () => {
  assert.throws(
    () => exactActivePhotoOrganization([{ organization_id: ORG_B, user_id: USER, status: 'invited' }], USER, ORG_B),
    new RegExp(PROPERTY_PHOTO_ACTIVE_MEMBERSHIP_REQUIRED),
  );
  assert.throws(
    () => exactActivePhotoOrganization([{ organization_id: ORG_B, user_id: USER, status: 'suspended' }], USER, ORG_B),
    new RegExp(PROPERTY_PHOTO_ACTIVE_MEMBERSHIP_REQUIRED),
  );
  const invited = await runServerUpload(ORG_B, [
    { organization_id: ORG_B, user_id: USER, status: 'invited' },
  ], 'photo-invited');
  const suspended = await runServerUpload(ORG_B, [
    { organization_id: ORG_B, user_id: USER, status: 'suspended' },
  ], 'photo-suspended');
  assert.equal(invited.status, 403);
  assert.equal(suspended.status, 403);
  assert.equal(invited.storageUrls.length, 0);
  assert.equal(suspended.storageUrls.length, 0);
});

test('path usa el organizationId validado sin normalizarlo hacia otro tenant', () => {
  assert.match(propertyPhotoObjectPath(ORG_B, 77, 'jpg', 'upload-test-01'), new RegExp(`^${ORG_B}/77/`));
  assert.throws(() => propertyPhotoObjectPath(' org-b ', 77, 'jpg', 'upload-test-01'));
});

test('respuesta de otra organización no se adopta', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installTenantRuntimeScope(a, USER);
  const harness = installClientFetch({ responseOrganizationId: ORG_B });
  await assert.rejects(
    uploadPropertyPhoto(file(), 77, a, captureTenantRuntimeLease(a)),
    new RegExp(PROPERTY_PHOTO_RESPONSE_ORGANIZATION_MISMATCH),
  );
  assert.match(harness.requestUrls[0]!, new RegExp(`organizationId=${ORG_A}`));
});

test('A→B durante upload pendiente invalida A antes de adoptar el resultado', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  const b = scope(ORG_B);
  installTenantRuntimeScope(a, USER);
  const leaseA = captureTenantRuntimeLease(a);
  const harness = installClientFetch({ responseOrganizationId: ORG_A, block: true });
  const pending = uploadPropertyPhoto(file(), 77, a, leaseA);
  await harness.started;
  installTenantRuntimeScope(b, USER);
  assert.equal(propertyPhotoOperationIsCurrent(a, leaseA, true), false);
  harness.release();
  await assert.rejects(pending, new RegExp(TENANT_RUNTIME_STALE));
});

test('A→B→A mantiene A1 stale por generación aunque vuelva el mismo scope', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  const b = scope(ORG_B);
  installTenantRuntimeScope(a, USER);
  const leaseA1 = captureTenantRuntimeLease(a);
  const harness = installClientFetch({ responseOrganizationId: ORG_A, block: true });
  const pending = uploadPropertyPhoto(file(), 77, a, leaseA1);
  await harness.started;
  installTenantRuntimeScope(b, USER);
  installTenantRuntimeScope(a, USER);
  assert.equal(propertyPhotoOperationIsCurrent(a, leaseA1, true), false);
  harness.release();
  await assert.rejects(pending, new RegExp(TENANT_RUNTIME_STALE));
});

test('logout durante upload invalida la completion vieja y no habilita adopción UI', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installTenantRuntimeScope(a, USER);
  const leaseA = captureTenantRuntimeLease(a);
  const harness = installClientFetch({ responseOrganizationId: ORG_A, block: true });
  const pending = uploadPropertyPhoto(file(), 77, a, leaseA);
  await harness.started;
  signOutCloud();
  assert.equal(propertyPhotoOperationIsCurrent(a, leaseA, true), false);
  harness.release();
  await assert.rejects(pending, new RegExp(TENANT_RUNTIME_STALE));
});

test('handlePhotoSelection captura scope+lease antes del await y guarda URL sólo tras revalidar', () => {
  const body = sourceFunction(uiSource, 'async function handlePhotoSelection', 'function bindPhotoManager');
  const captureScope = body.indexOf('const scope = requireCurrentTenantScope()');
  const captureLease = body.indexOf('const runtimeLease = captureTenantRuntimeLease(scope)');
  const upload = body.indexOf('await uploadPropertyPhoto(file, propertyId, scope, runtimeLease)');
  const guardAfterUpload = body.indexOf('if (!propertyPhotoOperationIsCurrent(scope, runtimeLease, form.isConnected)) return;', upload);
  const adopt = body.indexOf('urls.push(uploadedUrl)', upload);
  assert.ok(captureScope >= 0 && captureScope < upload);
  assert.ok(captureLease >= 0 && captureLease < upload);
  assert.ok(guardAfterUpload > upload && guardAfterUpload < adopt);
  assert.ok(body.includes('if (!propertyPhotoOperationIsCurrent(scope, runtimeLease, form.isConnected)) return;'));
  assert.ok(body.includes('setPhotoUploading(form, false, finalMessage, scope, runtimeLease)'));
});

test('flujo normal de una sola organización conserva upload exitoso', async () => {
  resetEnvironment();
  setSession();
  const a = scope(ORG_A);
  installTenantRuntimeScope(a, USER);
  const harness = installClientFetch({ responseOrganizationId: ORG_A });
  const url = await uploadPropertyPhoto(file(), 77, a, captureTenantRuntimeLease(a));
  assert.equal(url, `https://cdn.example.test/${ORG_A}/77/photo.jpg`);
  assert.match(harness.requestUrls[0]!, new RegExp(`organizationId=${ORG_A}`));
});

test('server source no contiene selección por primera membership en el flujo de fotos', () => {
  assert.doesNotMatch(serverSource, /searchParams\.set\(['"]limit['"],\s*['"]1['"]\)/);
  assert.doesNotMatch(serverSource, /rows\s*\[\s*0\s*\]\?\.organization_id/);
  assert.match(serverSource, /organization_id', `eq\.\$\{organizationId\}`/);
  assert.match(serverSource, /status', 'eq\.active'/);
});
