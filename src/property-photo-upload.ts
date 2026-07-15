import { getCloudSession } from './cloud-api.js';

export const MAX_PROPERTY_PHOTOS = 8;
export const MAX_SOURCE_PHOTO_BYTES = 20_000_000;
export const MAX_COMPRESSED_PHOTO_BYTES = 1_700_000;
export const MAX_PHOTO_DIMENSION = 1600;
const PHOTO_BUCKET = 'property-photos';

type AllowedPhotoMime = 'image/jpeg' | 'image/png' | 'image/webp';
type AllowedPhotoExtension = 'jpg' | 'png' | 'webp';

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

interface PreparedPropertyPhoto {
  blob: Blob;
  mimeType: AllowedPhotoMime;
  extension: AllowedPhotoExtension;
}

interface DrawablePhoto {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
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

export function propertyPhotoMime(file: Pick<File, 'name' | 'type'>): AllowedPhotoMime | null {
  const declared = String(file.type || '').toLowerCase();
  if (declared === 'image/jpeg' || declared === 'image/jpg') return 'image/jpeg';
  if (declared === 'image/png') return 'image/png';
  if (declared === 'image/webp') return 'image/webp';
  const name = String(file.name || '').toLowerCase();
  if (/\.(jpe?g)$/.test(name)) return 'image/jpeg';
  if (/\.png$/.test(name)) return 'image/png';
  if (/\.webp$/.test(name)) return 'image/webp';
  return null;
}

function photoExtension(mimeType: AllowedPhotoMime): AllowedPhotoExtension {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function imageFromObjectUrl(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('object-url-decode-failed'));
    };
    image.src = objectUrl;
  });
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('data-url-read-failed'));
    reader.onerror = () => reject(new Error('data-url-read-failed'));
    reader.readAsDataURL(file);
  });
}

async function imageFromDataUrl(file: File): Promise<HTMLImageElement> {
  const dataUrl = await fileDataUrl(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('data-url-decode-failed'));
    image.src = dataUrl;
  });
}

async function drawablePhoto(file: File): Promise<DrawablePhoto> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Algunos Android entregan JPG válidos que createImageBitmap no puede abrir.
    }
  }

  try {
    const image = await imageFromObjectUrl(file);
    return { source: image, width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    try {
      const image = await imageFromDataUrl(file);
      return { source: image, width: image.naturalWidth, height: image.naturalHeight };
    } catch {
      throw new Error(
        `No se pudo procesar ${file.name}. Abrila en la galería, guardá una copia y cargá esa copia.`,
      );
    }
  }
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('No se pudo comprimir la foto.'));
      else resolve(blob);
    }, 'image/jpeg', quality);
  });
}

function drawScaled(photo: DrawablePhoto, maxDimension: number): HTMLCanvasElement {
  const ratio = Math.min(1, maxDimension / Math.max(photo.width, photo.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(photo.width * ratio));
  canvas.height = Math.max(1, Math.round(photo.height * ratio));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('El navegador no pudo preparar la foto.');
  context.drawImage(photo.source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function validatePropertyPhoto(file: File): void {
  if (!propertyPhotoMime(file)) throw new Error(`${file.name} no es una foto JPG, PNG o WEBP compatible.`);
  if (file.size <= 0) throw new Error(`${file.name} está vacía.`);
  if (file.size > MAX_SOURCE_PHOTO_BYTES) throw new Error(`${file.name} supera los 20 MB.`);
}

export async function preparePropertyPhoto(file: File): Promise<PreparedPropertyPhoto> {
  validatePropertyPhoto(file);
  const originalMime = propertyPhotoMime(file)!;

  if (file.size <= MAX_COMPRESSED_PHOTO_BYTES) {
    return {
      blob: new Blob([file], { type: originalMime }),
      mimeType: originalMime,
      extension: photoExtension(originalMime),
    };
  }

  const photo = await drawablePhoto(file);
  try {
    let canvas = drawScaled(photo, MAX_PHOTO_DIMENSION);
    let blob = await canvasBlob(canvas, 0.82);
    if (blob.size > MAX_COMPRESSED_PHOTO_BYTES) blob = await canvasBlob(canvas, 0.7);
    if (blob.size > MAX_COMPRESSED_PHOTO_BYTES) {
      canvas = drawScaled(photo, 1280);
      blob = await canvasBlob(canvas, 0.68);
    }
    if (blob.size > MAX_COMPRESSED_PHOTO_BYTES) {
      throw new Error(`${file.name} no pudo reducirse lo suficiente.`);
    }
    return { blob, mimeType: 'image/jpeg', extension: 'jpg' };
  } finally {
    photo.close?.();
  }
}

export async function compressPropertyPhoto(file: File): Promise<Blob> {
  return (await preparePropertyPhoto(file)).blob;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('No se pudo preparar la foto.'));
    reader.onerror = () => reject(new Error('No se pudo leer la foto preparada.'));
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

function objectPath(organization: string, propertyId: number, extension: AllowedPhotoExtension): string {
  const safeOrganization = organization.replace(/[^a-zA-Z0-9_-]/g, '');
  const safePropertyId = Number.isInteger(propertyId) && propertyId > 0 ? propertyId : 'draft';
  return `${safeOrganization}/${safePropertyId}/${Date.now()}-${randomSegment()}.${extension}`;
}

function encodedPath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function directStorageUpload(
  photo: PreparedPropertyPhoto,
  propertyId: number,
  accessToken: string,
  userId: string,
): Promise<string> {
  const config = await cloudConfig();
  const organization = await organizationId(config, accessToken, userId);
  const path = objectPath(organization, propertyId, photo.extension);
  const response = await fetchWithRetry(
    `${config.url}/storage/v1/object/${PHOTO_BUCKET}/${encodedPath(path)}`,
    {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': photo.mimeType,
        'Cache-Control': '31536000',
        'x-upsert': 'false',
      },
      body: photo.blob,
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

async function serverStorageUpload(photo: PreparedPropertyPhoto, propertyId: number, accessToken: string): Promise<string> {
  const response = await fetchWithRetry('/api/property-photos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      propertyId,
      dataUrl: await blobToDataUrl(photo.blob),
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
    const photo = await preparePropertyPhoto(file);
    const config = await cloudConfig();

    if (config.photoStorageConfigured) {
      try {
        return await serverStorageUpload(photo, propertyId, session.accessToken);
      } catch (error) {
        if (!(error instanceof PropertyPhotoUploadError) || error.code !== 'STORAGE_NOT_READY') throw error;
      }
    }

    return await directStorageUpload(photo, propertyId, session.accessToken, session.userId);
  } catch (error) {
    suppressRepeatedFatal(error);
  }
}
