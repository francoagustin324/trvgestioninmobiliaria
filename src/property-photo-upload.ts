import { getCloudMembershipContext, getCloudSession } from './cloud-api.js';

export const MAX_PROPERTY_PHOTOS = 8;
export const MAX_SOURCE_PHOTO_BYTES = 20_000_000;
export const MAX_COMPRESSED_PHOTO_BYTES = 1_700_000;
export const MAX_PHOTO_DIMENSION = 1600;

interface UploadResponse {
  success?: boolean;
  url?: string;
  error?: string;
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

async function uploadResponse(response: Response): Promise<UploadResponse> {
  const text = await response.text();
  let payload: UploadResponse = {};
  try { payload = text ? JSON.parse(text) as UploadResponse : {}; } catch { payload = { error: text }; }
  if (!response.ok || !payload.success || !payload.url) {
    throw new Error(payload.error || 'No se pudo guardar la foto en la nube.');
  }
  return payload;
}

export async function uploadPropertyPhoto(file: File, propertyId: number): Promise<string> {
  const compressed = await compressPropertyPhoto(file);
  await getCloudMembershipContext();
  const session = getCloudSession();
  if (!session?.accessToken) throw new Error('La sesión venció. Volvé a ingresar.');

  const payload = await uploadResponse(await fetch('/api/property-photos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({
      propertyId,
      dataUrl: await blobToDataUrl(compressed),
    }),
  }));
  return payload.url!;
}
