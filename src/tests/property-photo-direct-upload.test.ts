import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, afterEach } from 'node:test';
import {
  preparePropertyPhoto,
  PropertyPhotoUploadError,
  propertyPhotoMime,
  shouldStopPropertyPhotoBatch,
  uploadPropertyPhoto,
} from '../property-photo-upload.js';
import {
  captureTenantRuntimeLease,
  installTenantRuntimeScope,
  invalidateTenantRuntimeScope,
  TENANT_RUNTIME_STALE,
} from '../tenant-runtime.js';

const upload = readFileSync('src/property-photo-upload.ts', 'utf8');
const ui = readFileSync('src/mvp-properties-ui.ts', 'utf8');
const server = readFileSync('src/server/property-photo-storage.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260720120000_property_photos_by_organization.sql', 'utf8');

const SESSION_KEY = 'propcontrol-cloud-session-v1';
const USER_ID = 'user-photo-tenant-test';
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key: string) { return values.get(key) ?? null; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    removeItem(key: string) { values.delete(key); },
    setItem(key: string, value: string) { values.set(key, value); },
  };
}

const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const localStorageForTests = createMemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageForTests,
});

afterEach(() => {
  invalidateTenantRuntimeScope();
  localStorageForTests.clear();
});

after(() => {
  if (previousLocalStorage) Object.defineProperty(globalThis, 'localStorage', previousLocalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

function storeSession(): void {
  localStorageForTests.setItem(SESSION_KEY, JSON.stringify({
    accessToken: 'photo-access-token',
    refreshToken: 'photo-refresh-token',
    expiresAt: Date.now() + 60_000,
    userId: USER_ID,
    email: 'photo@example.test',
  }));
}

function tenantContext(organizationId: string) {
  storeSession();
  const scope = { userId: USER_ID, organizationId };
  installTenantRuntimeScope(scope, USER_ID);
  return {
    scope,
    runtimeLease: captureTenantRuntimeLease(scope),
  };
}

function photoFile(): File {
  return new File([Buffer.from('contenido-jpg')], 'foto.jpg', { type: 'image/jpeg' });
}

function successResponse(organizationId: string, url = `https://example.test/${organizationId}/27/foto.jpg`): Response {
  return new Response(JSON.stringify({ success: true, url, organizationId }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function withFetch<T>(implementation: typeof fetch, run: () => Promise<T>): Promise<T> {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    return await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test('los errores estructurales detienen el lote', () => {
  assert.equal(shouldStopPropertyPhotoBatch(
    new PropertyPhotoUploadError('Falta Storage', 'STORAGE_NOT_READY', true),
  ), true);
  assert.equal(shouldStopPropertyPhotoBatch(
    new PropertyPhotoUploadError('Falló una foto', 'UPLOAD_FAILED'),
  ), false);
});

test('reconoce JPG de Android aunque el tipo MIME venga vacío', () => {
  assert.equal(propertyPhotoMime({ name: '1000822648.jpg', type: '' }), 'image/jpeg');
  assert.equal(propertyPhotoMime({ name: 'foto.JPEG', type: 'application/octet-stream' }), 'image/jpeg');
  assert.equal(propertyPhotoMime({ name: 'foto.heic', type: 'image/heic' }), null);
});

test('un JPG liviano se prepara sin abrirlo ni recodificarlo', async () => {
  const file = new File([Buffer.from('contenido-jpg')], '1000822648.jpg', { type: '' });
  const prepared = await preparePropertyPhoto(file);
  assert.equal(prepared.mimeType, 'image/jpeg');
  assert.equal(prepared.extension, 'jpg');
  assert.equal(prepared.blob.size, file.size);
});

test('el navegador envía binario con organizationId del tenant capturado', () => {
  assert.ok(upload.includes('/api/property-photos?'));
  assert.ok(upload.includes("'Content-Type': photo.mimeType"));
  assert.ok(upload.includes('body: photo.blob'));
  assert.ok(upload.includes('uploadId: uploadIdentifier()'));
  assert.ok(upload.includes('organizationId: context.scope.organizationId'));
  assert.equal(upload.includes('blobToDataUrl'), false);
  assert.equal(upload.includes('dataUrl: await'), false);
  assert.equal(upload.includes('/storage/v1/object/'), false);
});

test('la UI captura scope + lease una sola vez y valida antes de adoptar la URL', () => {
  assert.ok(ui.includes('const scope = requireCurrentTenantScope();\n  const runtimeLease = captureTenantRuntimeLease(scope);\n  const tenantContext = { scope, runtimeLease };'));
  assert.ok(ui.includes('await uploadPropertyPhoto(file, propertyId, tenantContext)'));
  const uploadIndex = ui.indexOf('const uploadedUrl = await uploadPropertyPhoto(file, propertyId, tenantContext);');
  const guardIndex = ui.indexOf('assertPropertyPhotoOperationCurrent(scope, runtimeLease);', uploadIndex);
  const pushIndex = ui.indexOf('urls.push(uploadedUrl);', uploadIndex);
  assert.ok(uploadIndex >= 0 && guardIndex > uploadIndex && pushIndex > guardIndex);
  assert.ok(ui.includes('if (!propertyPhotoOperationIsCurrent(scope, runtimeLease)) return;'));
  assert.ok(ui.includes('currentPhotoUploadInProgress()'));
});

test('el servidor valida la membership exacta y elimina first-membership authority', () => {
  assert.ok(server.includes('authenticatedPhotoOwner'));
  assert.ok(server.includes("query.searchParams.set('select', 'organization_id,user_id,status')"));
  assert.ok(server.includes("query.searchParams.set('user_id', `eq.${userId}`)"));
  assert.ok(server.includes("query.searchParams.set('organization_id', `eq.${requestedOrganization}`)"));
  assert.equal(server.includes("query.searchParams.set('limit', '1')"), false);
  assert.ok(server.includes("membership.status !== 'active'"));
  assert.ok(server.includes('membershipPayload.length !== 1'));
  assert.ok(server.includes('/auth/v1/user'));
  assert.ok(server.includes('/rest/v1/organization_members'));
  assert.ok(server.includes('/storage/v1/object/'));
  assert.ok(server.includes('Authorization: `Bearer ${accessToken}`'));
  assert.ok(server.includes('organizationId,'));
});

test('la migración aísla las fotos por inmobiliaria', () => {
  assert.ok(migration.includes('property_photos_select_by_org'));
  assert.ok(migration.includes('property_photos_insert_by_org'));
  assert.ok(migration.includes('property_photos_update_by_org'));
  assert.ok(migration.includes('property_photos_delete_by_org'));
  assert.ok(migration.includes('private.can_access_property_photo((storage.foldername(name))[1])'));
  assert.ok(migration.includes('private.is_active_org_member'));
  assert.equal(migration.includes("(storage.foldername(name))[1] = auth.uid()::text"), false);
});

test('DR-01 respuesta con organizationId distinto no se adopta', async () => {
  const context = tenantContext(ORG_A);
  await withFetch((async () => successResponse(ORG_B)) as typeof fetch, async () => {
    await assert.rejects(
      uploadPropertyPhoto(photoFile(), 27, context),
      (error: unknown) => error instanceof PropertyPhotoUploadError && error.code === 'UPLOAD_FAILED',
    );
  });
});

test('DR-01 A→B invalida la completion anterior antes de devolver URL', async () => {
  const context = tenantContext(ORG_A);
  const started = deferred<void>();
  const remote = deferred<Response>();
  await withFetch((async () => {
    started.resolve();
    return remote.promise;
  }) as typeof fetch, async () => {
    const pending = uploadPropertyPhoto(photoFile(), 27, context);
    await started.promise;
    installTenantRuntimeScope({ userId: USER_ID, organizationId: ORG_B }, USER_ID);
    remote.resolve(successResponse(ORG_A));
    await assert.rejects(pending, (error: unknown) => error instanceof Error && error.message === TENANT_RUNTIME_STALE);
  });
});

test('DR-01 A→B→A mantiene inválida la operación A anterior por generación', async () => {
  const context = tenantContext(ORG_A);
  const started = deferred<void>();
  const remote = deferred<Response>();
  await withFetch((async () => {
    started.resolve();
    return remote.promise;
  }) as typeof fetch, async () => {
    const pending = uploadPropertyPhoto(photoFile(), 27, context);
    await started.promise;
    installTenantRuntimeScope({ userId: USER_ID, organizationId: ORG_B }, USER_ID);
    installTenantRuntimeScope({ userId: USER_ID, organizationId: ORG_A }, USER_ID);
    remote.resolve(successResponse(ORG_A));
    await assert.rejects(pending, (error: unknown) => error instanceof Error && error.message === TENANT_RUNTIME_STALE);
  });
});

test('DR-01 logout durante upload impide efectos tardíos', async () => {
  const context = tenantContext(ORG_A);
  const started = deferred<void>();
  const remote = deferred<Response>();
  await withFetch((async () => {
    started.resolve();
    return remote.promise;
  }) as typeof fetch, async () => {
    const pending = uploadPropertyPhoto(photoFile(), 27, context);
    await started.promise;
    localStorageForTests.removeItem(SESSION_KEY);
    remote.resolve(successResponse(ORG_A));
    await assert.rejects(pending, (error: unknown) => error instanceof Error && error.message === TENANT_RUNTIME_STALE);
  });
});

test('DR-01 retry stale no emite un segundo request', async () => {
  const context = tenantContext(ORG_A);
  let requests = 0;
  await withFetch((async () => {
    requests += 1;
    if (requests === 1) {
      installTenantRuntimeScope({ userId: USER_ID, organizationId: ORG_B }, USER_ID);
      throw new Error('network-down');
    }
    return successResponse(ORG_A);
  }) as typeof fetch, async () => {
    await assert.rejects(
      uploadPropertyPhoto(photoFile(), 27, context),
      (error: unknown) => error instanceof Error && error.message === TENANT_RUNTIME_STALE,
    );
  });
  assert.equal(requests, 1);
});

test('DR-01 single-org normal conserva el flujo y envía la organización activa', async () => {
  const context = tenantContext(ORG_A);
  let requestedUrl = '';
  const expectedUrl = `https://example.test/${ORG_A}/27/foto.jpg`;
  await withFetch((async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return successResponse(ORG_A, expectedUrl);
  }) as typeof fetch, async () => {
    assert.equal(await uploadPropertyPhoto(photoFile(), 27, context), expectedUrl);
  });
  const request = new URL(requestedUrl, 'https://propcontrol.test');
  assert.equal(request.searchParams.get('organizationId'), ORG_A);
  assert.equal(request.searchParams.get('propertyId'), '27');
});
