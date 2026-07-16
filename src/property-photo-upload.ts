import { getCloudSession } from './cloud-api.js';

export const MAX_PROPERTY_PHOTOS = 8;
export const MAX_SOURCE_PHOTO_BYTES = 20_000_000;
export const MAX_COMPRESSED_PHOTO_BYTES = 1_700_000;
export const MAX_PHOTO_DIMENSION = 1600;
const PHOTO_BUCKET = 'property-photos';

interface UploadResponse {
  success?: boolean;
  url?: string;
  error?: string;
  message?: string;
  msg?: string;
  code?: string;
}

interface CloudConfigResponse {
  configured?: boolean;
  url?: string;
  publishableKey?: string;
  photoStorageConfigured?: boolean;
}

interface MembershipRow {
  organization_id?: string;
}

export type PropertyPhotoUploadErrorCode =
  | 'SESSION_REQUIRED'
  | 'STORAGE_NOT_READY'
  | 'STORAGE_FORBIDDEN'
  | 'NETWORK_ERROR'
  | 'UPLOAD_FAILED';

export class PropertyPhotoUploadError extends Error {
  constructor(
    message: string,
    readonly code: PropertyPhotoUploadErrorCode,
    readonly stopBatch = false,
  ) {
    super(message);
    this.name = 'PropertyPhotoUploadError';
  }
}

let suppressedFatalUntil = 0;

export function shouldStopPropertyPhotoBatch(error: unknown): boolean {
  return error instanceof PropertyPhotoUploadError && error.stopBatch;
}

function imageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`No se pudo leer ${file.name}. Probá con una foto JPG, PNG o WEBP.`));
    };
    image.src = objectUrl;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('No se pudo comprimir la foto.'));
      else resolve(blob);
    }, 'image/jpeg', quality);
  });
}

function drawScaled(image: HTMLImageElement, maxDimension: number): HTMLCanvasElement {
  const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('El navegador no pudo preparar la foto.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function validatePropertyPhoto(file: File): void {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} no es una imagen.`);
  if (file.size <= 0) throw new Error(`${file.name} está vacía.`);
  if (file.size > MAX_SOURCE_PHOTO_BYTES) throw new Error(`${file.name} supera los 20 MB.`);
}

export async function compressPropertyPhoto(file: File): Promise<Blob> {
  validatePropertyPhoto(file);
  const image = await imageFromFile(file);
  let canvas = drawScaled(image, MAX_PHOTO_DIMENSION);
  let blob = await canvasBlob(canvas, 0.82);
  if (blob.size > MAX_COMPRESSED_PHOTO_BYTES) blob = await canvasBlob(canvas, 0.7);
  if (blob.size > MAX_COMPRESSED_PHOTO_BYTES) {
    canvas = drawScaled(image, 1280);
    blob = await canvasBlob(canvas, 0.68);
  }
  if (blob.size > MAX_COMPRESSED_PHOTO_BYTES) {
    throw new Error(`${file.name} no pudo reducirse lo suficiente.`);
  }
  return blob;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('No se pudo preparar la foto.'));
    reader.onerror = () => reject(new Error('No se pudo leer la foto comprimida.'));
    reader.readAsDataURL(blob);
  });
}

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text };
  }
}

function responseRecord(payload: unknown): UploadResponse {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as UploadResponse
    : {};
}

function responseError(payload: unknown, fallback: string): string {
  const record = responseRecord(payload);
  return [record.error, record.message, record.msg]
    .find((value) => typeof value === 'string' && value.trim()) || fallback;
}

async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    try {
      return await fetch(input, init);
    } catch {
      throw new PropertyPhotoUploadError(
        'No hubo conexión para cargar la foto. Revisá internet y volvé a intentar.',
        'NETWORK_ERROR',
      );
    }
  }
}

async function cloudConfig(): Promise<Required<Pick<CloudConfigResponse, 'url' | 'publishableKey'>> & Pick<CloudConfigResponse, 'photoStorageConfigured'>> {
  let response: Response;
  try {
    response = await fetch('/api/cloud-config', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    throw new PropertyPhotoUploadError(
      'No se pudo verificar el almacenamiento de fotos.',
      'NETWORK_ERROR',
      true,
    );
  }
  const payload = await responsePayload(response) as CloudConfigResponse;
  if (!response.ok || !payload.configured || !payload.url || !payload.publishableKey) {
    throw new PropertyPhotoUploadError(
      'El almacenamiento de fotos todavía no está activado.',
      'STORAGE_NOT_READY',
      true,
    );
  }
  return {
    url: payload.url.replace(/\/+$/g, ''),
    publishableKey: payload.publishableKey,
    photoStorageConfigured: Boolean(payload.photoStorageConfigured),
  };
}

async function organizationId(
  config: Required<Pick<CloudConfigResponse, 'url' | 'publishableKey'>>,
  accessToken: string,
  userId: string,
): Promise<string> {
  const query = new URL(`${config.url}/rest/v1/organization_members`);
  query.searchParams.set('select', 'organization_id');
  query.searchParams.set('user_id', `eq.${userId}`);
  query.searchParams.set('limit', '1');
  const response = await fetchWithRetry(query, {
    headers: {
      apikey: config.publishableKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  const payload = await responsePayload(response);
  if (response.status === 401) {
    throw new PropertyPhotoUploadError('La sesión venció. Volvé a ingresar.', 'SESSION_REQUIRED', true);
  }
  if (!response.ok || !Array.isArray(payload)) {
    throw new PropertyPhotoUploadError(
      responseError(payload, 'No se pudo verificar la inmobiliaria.'),
      'UPLOAD_FAILED',
      true,
    );
  }
  const membership = (payload as MembershipRow[])[0];
  if (!membership?.organization_id) {
    throw new PropertyPhotoUploadError(
      'La cuenta no tiene una inmobiliaria asociada.',
      'STORAGE_FORBIDDEN',
      true,
    );
  }
  return membership.organization_id;
}

function randomSegment(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function objectPath(organization: string, propertyId: number): string {
  const safeOrganization = organization.replace(/[^a-zA-Z0-9_-]/g, '');
  const safePropertyId = Number.isInteger(propertyId) && propertyId > 0 ? propertyId : 'draft';
  return `${safeOrganization}/${safePropertyId}/${Date.now()}-${randomSegment()}.jpg`;
}

function encodedPath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function directStorageUpload(
  compressed: Blob,
  propertyId: number,
  accessToken: string,
  userId: string,
): Promise<string> {
  const config = await cloudConfig();
  const organization = await organizationId(config, accessToken, userId);
  const path = objectPath(organization, propertyId);
  const response = await fetchWithRetry(
    `${config.url}/storage/v1/object/${PHOTO_BUCKET}/${encodedPath(path)}`,
    {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'image/jpeg',
        'Cache-Control': '31536000',
        'x-upsert': 'false',
      },
      body: compressed,
    },
  );
  const payload = await responsePayload(response);
  if (response.ok) {
    return `${config.url}/storage/v1/object/public/${PHOTO_BUCKET}/${encodedPath(path)}`;
  }
  if (response.status === 401) {
    throw new PropertyPhotoUploadError('La sesión venció. Volvé a ingresar.', 'SESSION_REQUIRED', true);
  }
  const message = responseError(payload, 'No se pudo guardar la foto.');
  if (response.status === 404 || /bucket|not found|does not exist/i.test(message)) {
    throw new PropertyPhotoUploadError(
      'El almacenamiento de fotos todavía no está activado en Supabase.',
      'STORAGE_NOT_READY',
      true,
    );
  }
  if (response.status === 403 || /policy|permission|unauthorized|row-level security/i.test(message)) {
    throw new PropertyPhotoUploadError(
      'Falta habilitar el permiso seguro para cargar fotos.',
      'STORAGE_FORBIDDEN',
      true,
    );
  }
  throw new PropertyPhotoUploadError(message, 'UPLOAD_FAILED');
}

async function serverStorageUpload(compressed: Blob, propertyId: number, accessToken: string): Promise<string> {
  const response = await fetchWithRetry('/api/property-photos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      propertyId,
      dataUrl: await blobToDataUrl(compressed),
    }),
  });
  const payload = await responsePayload(response);
  const record = responseRecord(payload);
  if (response.ok && record.success && record.url) return record.url;
  if (response.status === 401 || response.status === 403) {
    throw new PropertyPhotoUploadError(
      responseError(payload, 'La sesión venció. Volvé a ingresar.'),
      'SESSION_REQUIRED',
      true,
    );
  }
  if (response.status === 503 || /todavía no está configurado/i.test(responseError(payload, ''))) {
    throw new PropertyPhotoUploadError(
      'El almacenamiento de fotos todavía no está activado.',
      'STORAGE_NOT_READY',
      true,
    );
  }
  throw new PropertyPhotoUploadError(responseError(payload, 'No se pudo guardar la foto.'), 'UPLOAD_FAILED');
}

function suppressRepeatedFatal(error: unknown): never {
  if (error instanceof PropertyPhotoUploadError && error.stopBatch) {
    const now = Date.now();
    if (now < suppressedFatalUntil) {
      throw new PropertyPhotoUploadError('', error.code, true);
    }
    suppressedFatalUntil = now + 4000;
  }
  throw error;
}

export async function uploadPropertyPhoto(file: File, propertyId: number): Promise<string> {
  try {
    const session = getCloudSession();
    if (!session?.accessToken || !session.userId) {
      throw new PropertyPhotoUploadError('La sesión venció. Volvé a ingresar.', 'SESSION_REQUIRED', true);
    }
    const compressed = await compressPropertyPhoto(file);
    const config = await cloudConfig();

    if (config.photoStorageConfigured) {
      try {
        return await serverStorageUpload(compressed, propertyId, session.accessToken);
      } catch (error) {
        if (!(error instanceof PropertyPhotoUploadError) || error.code !== 'STORAGE_NOT_READY') throw error;
      }
    }

    return await directStorageUpload(compressed, propertyId, session.accessToken, session.userId);
  } catch (error) {
    suppressRepeatedFatal(error);
  }
}
