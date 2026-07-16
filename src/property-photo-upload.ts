import { getCloudSession } from './cloud-api.js';

export const MAX_PROPERTY_PHOTOS = 8;
export const MAX_SOURCE_PHOTO_BYTES = 20_000_000;
export const MAX_COMPRESSED_PHOTO_BYTES = 1_700_000;
export const MAX_PHOTO_DIMENSION = 1600;

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

let blockedFatalUntil = 0;
let blockedFatalCode: PropertyPhotoUploadErrorCode = 'UPLOAD_FAILED';

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
        'No se pudo conectar con PropControl para cargar la foto.',
        'NETWORK_ERROR',
      );
    }
  }
}

function uploadIdentifier(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function serverStorageUpload(photo: PreparedPropertyPhoto, propertyId: number, accessToken: string): Promise<string> {
  const query = new URLSearchParams({
    propertyId: String(propertyId),
    uploadId: uploadIdentifier(),
  });
  const response = await fetchWithRetry(`/api/property-photos?${query.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': photo.mimeType,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
    body: photo.blob,
  });
  const payload = await responsePayload(response);
  const record = responseRecord(payload);
  if (response.ok && record.success && record.url) return record.url;
  if (response.status === 401) {
    throw new PropertyPhotoUploadError(
      responseError(payload, 'La sesión venció. Volvé a ingresar.'),
      'SESSION_REQUIRED',
      true,
    );
  }
  if (response.status === 403 || /row-level security|policy|permiso|seguridad/i.test(responseError(payload, ''))) {
    throw new PropertyPhotoUploadError(
      responseError(payload, 'La política de seguridad de fotos todavía no está actualizada.'),
      'STORAGE_FORBIDDEN',
      true,
    );
  }
  if (response.status === 404 || response.status === 503 || /bucket|almacenamiento|storage/i.test(responseError(payload, ''))) {
    throw new PropertyPhotoUploadError(
      responseError(payload, 'El almacenamiento de fotos todavía no está activado.'),
      'STORAGE_NOT_READY',
      true,
    );
  }
  throw new PropertyPhotoUploadError(responseError(payload, 'No se pudo guardar la foto.'), 'UPLOAD_FAILED');
}

function rememberFatalUpload(error: unknown): never {
  if (error instanceof PropertyPhotoUploadError && error.stopBatch) {
    const now = Date.now();
    if (now < blockedFatalUntil) {
      throw new PropertyPhotoUploadError('', blockedFatalCode, true);
    }
    blockedFatalUntil = now + 60_000;
    blockedFatalCode = error.code;
  }
  throw error;
}

export async function uploadPropertyPhoto(file: File, propertyId: number): Promise<string> {
  try {
    if (Date.now() < blockedFatalUntil) {
      throw new PropertyPhotoUploadError('', blockedFatalCode, true);
    }
    const session = getCloudSession();
    if (!session?.accessToken) {
      throw new PropertyPhotoUploadError('La sesión venció. Volvé a ingresar.', 'SESSION_REQUIRED', true);
    }
    const photo = await preparePropertyPhoto(file);
    return await serverStorageUpload(photo, propertyId, session.accessToken);
  } catch (error) {
    rememberFatalUpload(error);
  }
}
