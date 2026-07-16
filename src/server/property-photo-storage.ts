import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const BUCKET = 'property-photos';
const MAX_UPLOAD_BYTES = 1_800_000;
const requestWindows = new Map<string, { count: number; resetAt: number }>();

interface PropertyPhotoStorageOptions {
  supabaseUrl: string;
  publishableKey: string;
  secretKey?: string;
}

interface MembershipRow {
  organization_id?: string;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

function rateLimited(request: IncomingMessage): boolean {
  const key = request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || current.resetAt <= now) {
    requestWindows.set(key, { count: 1, resetAt: now + 10 * 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 50;
}

async function readJson(request: IncomingMessage, maxBytes = 2_600_000): Promise<Record<string, unknown>> {
  const contentType = String(request.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) throw new Error('La foto debe enviarse como JSON.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw new Error('La foto es demasiado grande.');
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('La foto enviada no es válida.');
  return parsed as Record<string, unknown>;
}

async function parseResponse(response: Response): Promise<Record<string, unknown> | unknown[]> {
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) {
    const record = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    const message = [record.message, record.error, record.msg]
      .find((value) => typeof value === 'string' && value.trim());
    throw new Error(typeof message === 'string' ? message : `Supabase respondió ${response.status}.`);
  }
  return payload && typeof payload === 'object'
    ? payload as Record<string, unknown> | unknown[]
    : {};
}

function bearerToken(request: IncomingMessage): string {
  const authorization = String(request.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new Error('La sesión venció. Volvé a ingresar.');
  return match[1];
}

function authenticatedHeaders(options: PropertyPhotoStorageOptions, accessToken: string): Record<string, string> {
  return {
    apikey: options.publishableKey,
    Authorization: `Bearer ${accessToken}`,
  };
}

async function authenticatedOrganization(
  request: IncomingMessage,
  options: PropertyPhotoStorageOptions,
): Promise<{ organizationId: string; accessToken: string }> {
  const accessToken = bearerToken(request);
  const authHeaders = authenticatedHeaders(options, accessToken);
  const authResponse = await fetch(`${options.supabaseUrl}/auth/v1/user`, {
    headers: authHeaders,
  });
  const user = await parseResponse(authResponse) as Record<string, unknown>;
  const userId = typeof user.id === 'string' ? user.id : '';
  if (!userId) throw new Error('La sesión no identifica un usuario válido.');

  const query = new URL(`${options.supabaseUrl}/rest/v1/organization_members`);
  query.searchParams.set('select', 'organization_id');
  query.searchParams.set('user_id', `eq.${userId}`);
  query.searchParams.set('limit', '1');
  const rows = await parseResponse(await fetch(query, {
    headers: {
      ...authHeaders,
      Accept: 'application/json',
    },
  })) as MembershipRow[];
  const membership = rows[0];
  if (!membership?.organization_id) throw new Error('La cuenta no pertenece a una inmobiliaria.');
  return { organizationId: membership.organization_id, accessToken };
}

export function parsePropertyPhotoDataUrl(value: unknown): { mimeType: string; bytes: Buffer; extension: string } {
  const match = String(value || '').match(/^data:(image\/(?:jpeg|webp|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!match?.[1] || !match[2]) throw new Error('El formato de la foto no está permitido.');
  const mimeType = match[1];
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error('La foto preparada supera el límite permitido.');
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return { mimeType, bytes, extension };
}

function encodedPath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

export function propertyPhotoObjectPath(organizationId: string, propertyId: unknown, extension: string): string {
  const safeOrganization = organizationId.replace(/[^a-zA-Z0-9_-]/g, '');
  const numericPropertyId = Number(propertyId);
  const propertySegment = Number.isInteger(numericPropertyId) && numericPropertyId > 0 ? String(numericPropertyId) : 'draft';
  return `${safeOrganization}/${propertySegment}/${Date.now()}-${randomUUID()}.${extension}`;
}

export function publicPropertyPhotoUrl(supabaseUrl: string, objectPath: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${encodedPath(objectPath)}`;
}

async function uploadPhoto(
  request: IncomingMessage,
  response: ServerResponse,
  options: PropertyPhotoStorageOptions,
): Promise<void> {
  const { organizationId, accessToken } = await authenticatedOrganization(request, options);
  const body = await readJson(request);
  const photo = parsePropertyPhotoDataUrl(body.dataUrl);
  const objectPath = propertyPhotoObjectPath(organizationId, body.propertyId, photo.extension);
  const uploadResponse = await fetch(`${options.supabaseUrl}/storage/v1/object/${BUCKET}/${encodedPath(objectPath)}`, {
    method: 'POST',
    headers: {
      ...authenticatedHeaders(options, accessToken),
      'Content-Type': photo.mimeType,
      'x-upsert': 'false',
      'Cache-Control': '31536000',
    },
    body: photo.bytes,
  });
  await parseResponse(uploadResponse);

  sendJson(response, 201, {
    success: true,
    url: publicPropertyPhotoUrl(options.supabaseUrl, objectPath),
  });
}

export async function handlePropertyPhotoStorage(
  request: IncomingMessage,
  response: ServerResponse,
  options: PropertyPhotoStorageOptions,
): Promise<boolean> {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  if (pathname !== '/api/property-photos' || request.method !== 'POST') return false;

  if (!options.supabaseUrl || !options.publishableKey) {
    sendJson(response, 503, { success: false, error: 'El almacenamiento de fotos todavía no está configurado.' });
    return true;
  }
  if (rateLimited(request)) {
    sendJson(response, 429, { success: false, error: 'Se cargaron demasiadas fotos. Esperá unos minutos.' });
    return true;
  }

  try {
    await uploadPhoto(request, response, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo cargar la foto.';
    const status = /sesión|usuario válido|pertenece/i.test(message) ? 403 : 400;
    sendJson(response, status, { success: false, error: message });
  }
  return true;
}
