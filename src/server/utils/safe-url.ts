import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'sid', 'tracking_id', 'position', 'type', 'search_layout',
  'polycard_client', 'be_origin', 'n_src', 'n_pills', 'n_pg', 'n_pos', 'n_search_id',
]);

function privateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a = 0, b = 0] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function privateIpv6(ip: string): boolean {
  const value = ip.toLowerCase().split('%')[0] ?? '';
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('ff')) return true;
  if (value.startsWith('2001:db8:')) return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped?.[1] ? privateIpv4(mapped[1]) : false;
}

export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return privateIpv4(ip);
  if (version === 6) return privateIpv6(ip);
  return true;
}

export function cleanPublicUrl(url: URL): URL {
  const cleaned = new URL(url.toString());
  cleaned.hash = '';
  for (const key of [...cleaned.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.has(key.toLowerCase())) cleaned.searchParams.delete(key);
  }
  return cleaned;
}

export async function validateSafeUrl(input: string, cleanTracking = true): Promise<URL> {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('El enlace no es válido.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Solo se aceptan enlaces http o https.');
  if (url.username || url.password) throw new Error('El enlace no puede incluir credenciales.');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('El puerto del enlace no está permitido.');
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) throw new Error('No se permite localhost.');
  if (isIP(host) && isPrivateIp(host)) throw new Error('No se permiten direcciones privadas.');
  const records = await lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) throw new Error('La dirección no es pública o segura.');
  return cleanTracking ? cleanPublicUrl(url) : url;
}

export interface SafeTextResponse {
  finalUrl: URL;
  text: string;
  contentType: string;
}

export async function safeFetchText(input: URL, maxBytes = 3_000_000): Promise<SafeTextResponse> {
  let current = input;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    current = await validateSafeUrl(current.toString(), false);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; TRVPropertyImporter/1.0)',
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8',
        },
      });
    } finally {
      clearTimeout(timeout);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('La publicación respondió con una redirección inválida.');
      current = await validateSafeUrl(new URL(location, current).toString(), false);
      continue;
    }
    if (!response.ok) throw new Error(`El portal respondió con estado ${response.status}.`);
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/json|text\/plain|application\/xhtml\+xml/i.test(contentType)) throw new Error('El tipo de contenido no es compatible.');
    const reader = response.body?.getReader();
    if (!reader) return { finalUrl: current, text: await response.text(), contentType };
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (!result.value) continue;
      size += result.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('La publicación es demasiado grande para importarla.');
      }
      chunks.push(result.value);
    }
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    return { finalUrl: current, text: new TextDecoder().decode(merged), contentType };
  }
  throw new Error('La publicación realizó demasiadas redirecciones.');
}
