import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  handlePropertyPhotoStorage,
  parsePropertyPhotoDataUrl,
  propertyPhotoObjectPath,
  publicPropertyPhotoUrl,
} from '../server/property-photo-storage.js';

const SUPABASE_URL = 'https://photo-tenant-test.supabase.co';
const USER_ID = 'user-photo-storage-test';
const OTHER_USER_ID = 'other-user-photo-storage-test';
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
let requestSequence = 1;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function uploadRequest(organizationId: string): IncomingMessage {
  const request = Readable.from([Buffer.from('foto-binaria')]) as unknown as IncomingMessage;
  Object.assign(request, {
    method: 'POST',
    url: `/api/property-photos?propertyId=27&uploadId=photo-safe-123&organizationId=${encodeURIComponent(organizationId)}`,
    headers: {
      authorization: 'Bearer photo-access-token',
      'content-type': 'image/jpeg',
    },
    socket: { remoteAddress: `127.0.0.${requestSequence++}` },
  });
  return request;
}

function responseHarness(): {
  response: ServerResponse;
  result: { status: number; payload: Record<string, unknown> };
} {
  const result = { status: 0, payload: {} as Record<string, unknown> };
  const response = {
    writeHead(status: number) {
      result.status = status;
      return this;
    },
    end(body?: string | Buffer) {
      const text = body === undefined ? '' : String(body);
      result.payload = text ? JSON.parse(text) as Record<string, unknown> : {};
      return this;
    },
  } as unknown as ServerResponse;
  return { response, result };
}

async function runUpload(options: {
  requestedOrganization: string;
  membershipRows: unknown[];
  authenticatedUserId?: string;
}): Promise<{
  status: number;
  payload: Record<string, unknown>;
  membershipRequests: string[];
  storageRequests: string[];
}> {
  const previousFetch = globalThis.fetch;
  const membershipRequests: string[] = [];
  const storageRequests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `${SUPABASE_URL}/auth/v1/user`) {
      return json({ id: options.authenticatedUserId ?? USER_ID });
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/organization_members`)) {
      membershipRequests.push(url);
      return json(options.membershipRows);
    }
    if (url.startsWith(`${SUPABASE_URL}/storage/v1/object/property-photos/`)) {
      storageRequests.push(url);
      return json({ Key: 'ok' });
    }
    throw new Error(`fetch inesperado: ${url}`);
  }) as typeof fetch;

  try {
    const { response, result } = responseHarness();
    const handled = await handlePropertyPhotoStorage(uploadRequest(options.requestedOrganization), response, {
      supabaseUrl: SUPABASE_URL,
      publishableKey: 'publishable-photo-test-key',
    });
    assert.equal(handled, true);
    return {
      status: result.status,
      payload: result.payload,
      membershipRequests,
      storageRequests,
    };
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test('acepta imágenes permitidas y rechaza formatos inseguros', () => {
  const parsed = parsePropertyPhotoDataUrl('data:image/jpeg;base64,aG9sYQ==');
  assert.equal(parsed.mimeType, 'image/jpeg');
  assert.equal(parsed.extension, 'jpg');
  assert.equal(parsed.bytes.toString('utf8'), 'hola');
  assert.throws(() => parsePropertyPhotoDataUrl('data:text/html;base64,aG9sYQ=='));
  assert.throws(() => parsePropertyPhotoDataUrl('javascript:alert(1)'));
});

test('la ruta queda aislada por inmobiliaria y propiedad', () => {
  const organizationId = '2ce3f73d-0ea3-4be6-a1c5-5a26dc502f53';
  const path = propertyPhotoObjectPath(organizationId, 27, 'jpg', 'foto-segura-123');
  assert.equal(path, `${organizationId}/27/foto-segura-123.jpg`);
  assert.equal(path.includes('..'), false);
});

test('genera una dirección pública del bucket de propiedades', () => {
  const url = publicPropertyPhotoUrl('https://example.supabase.co', 'usuario/27/foto principal.jpg');
  assert.equal(url, 'https://example.supabase.co/storage/v1/object/public/property-photos/usuario/27/foto%20principal.jpg');
});

test('DR-01 ACTIVE A+B trabajando en B guarda exclusivamente bajo B', async () => {
  const result = await runUpload({
    requestedOrganization: ORG_B,
    membershipRows: [{ organization_id: ORG_B, user_id: USER_ID, status: 'active' }],
  });
  assert.equal(result.status, 201);
  assert.equal(result.payload.success, true);
  assert.equal(result.payload.organizationId, ORG_B);
  assert.equal(result.storageRequests.length, 1);
  assert.ok(result.storageRequests[0]!.includes(`/property-photos/${ORG_B}/27/photo-safe-123.jpg`));
  assert.equal(String(result.payload.url).includes(`/${ORG_B}/27/photo-safe-123.jpg`), true);

  assert.equal(result.membershipRequests.length, 1);
  const membershipQuery = new URL(result.membershipRequests[0]!);
  assert.equal(membershipQuery.searchParams.get('select'), 'organization_id,user_id,status');
  assert.equal(membershipQuery.searchParams.get('user_id'), `eq.${USER_ID}`);
  assert.equal(membershipQuery.searchParams.get('organization_id'), `eq.${ORG_B}`);
  assert.equal(membershipQuery.searchParams.has('limit'), false);
});

test('DR-01 ACTIVE A+B trabajando en A guarda exclusivamente bajo A', async () => {
  const result = await runUpload({
    requestedOrganization: ORG_A,
    membershipRows: [{ organization_id: ORG_A, user_id: USER_ID, status: 'active' }],
  });
  assert.equal(result.status, 201);
  assert.equal(result.payload.organizationId, ORG_A);
  assert.equal(result.storageRequests.length, 1);
  assert.ok(result.storageRequests[0]!.includes(`/property-photos/${ORG_A}/27/photo-safe-123.jpg`));
});

test('DR-01 el orden de memberships no decide tenant: múltiples filas fallan cerrado', async () => {
  const result = await runUpload({
    requestedOrganization: ORG_B,
    membershipRows: [
      { organization_id: ORG_A, user_id: USER_ID, status: 'active' },
      { organization_id: ORG_B, user_id: USER_ID, status: 'active' },
    ],
  });
  assert.equal(result.status, 403);
  assert.equal(result.payload.success, false);
  assert.equal(result.storageRequests.length, 0);
});

test('DR-01 membership inexistente rechaza sin tocar Storage', async () => {
  const result = await runUpload({ requestedOrganization: ORG_B, membershipRows: [] });
  assert.equal(result.status, 403);
  assert.equal(result.payload.success, false);
  assert.equal(result.storageRequests.length, 0);
});

test('DR-01 membership invited rechaza sin tocar Storage', async () => {
  const result = await runUpload({
    requestedOrganization: ORG_B,
    membershipRows: [{ organization_id: ORG_B, user_id: USER_ID, status: 'invited' }],
  });
  assert.equal(result.status, 403);
  assert.equal(result.storageRequests.length, 0);
});

test('DR-01 membership suspended rechaza sin tocar Storage', async () => {
  const result = await runUpload({
    requestedOrganization: ORG_B,
    membershipRows: [{ organization_id: ORG_B, user_id: USER_ID, status: 'suspended' }],
  });
  assert.equal(result.status, 403);
  assert.equal(result.storageRequests.length, 0);
});

test('DR-01 status missing o desconocido rechaza sin tocar Storage', async () => {
  for (const row of [
    { organization_id: ORG_B, user_id: USER_ID },
    { organization_id: ORG_B, user_id: USER_ID, status: 'archived' },
  ]) {
    const result = await runUpload({ requestedOrganization: ORG_B, membershipRows: [row] });
    assert.equal(result.status, 403);
    assert.equal(result.storageRequests.length, 0);
  }
});

test('DR-01 membership wrong-org falla cerrado', async () => {
  const result = await runUpload({
    requestedOrganization: ORG_B,
    membershipRows: [{ organization_id: ORG_A, user_id: USER_ID, status: 'active' }],
  });
  assert.equal(result.status, 403);
  assert.equal(result.storageRequests.length, 0);
});

test('DR-01 membership wrong-user falla cerrado', async () => {
  const result = await runUpload({
    requestedOrganization: ORG_B,
    membershipRows: [{ organization_id: ORG_B, user_id: OTHER_USER_ID, status: 'active' }],
  });
  assert.equal(result.status, 403);
  assert.equal(result.storageRequests.length, 0);
});

test('DR-01 single-org normal sigue funcionando', async () => {
  const result = await runUpload({
    requestedOrganization: ORG_A,
    membershipRows: [{ organization_id: ORG_A, user_id: USER_ID, status: 'active' }],
  });
  assert.equal(result.status, 201);
  assert.deepEqual(
    { success: result.payload.success, organizationId: result.payload.organizationId },
    { success: true, organizationId: ORG_A },
  );
  assert.equal(result.storageRequests.length, 1);
});
