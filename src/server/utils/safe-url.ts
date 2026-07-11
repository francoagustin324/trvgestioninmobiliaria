import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

function isPrivateIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith('169.254.') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  return false;
}

export async function validateSafeUrl(input: string): Promise<URL> {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Solo se aceptan URLs http o https.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('No se permite localhost.');
  if (isIP(host) && isPrivateIp(host)) throw new Error('No se permiten IP privadas.');
  const records = await lookup(host, { all: true, verbatim: true });
  if (records.some((record) => isPrivateIp(record.address))) throw new Error('La URL resuelve a una red privada.');
  url.search = '';
  return url;
}

export async function safeFetchText(input: URL, maxBytes = 2_000_000): Promise<{ finalUrl: URL; text: string; contentType: string }> {
  let current = input;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(current, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'TRVImporter/1.0' } });
    clearTimeout(timeout);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirección inválida.');
      current = await validateSafeUrl(new URL(location, current).toString());
      continue;
    }
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/json|text\/plain/i.test(contentType)) throw new Error('Content-Type no permitido.');
    const reader = response.body?.getReader();
    if (!reader) return { finalUrl: current, text: await response.text(), contentType };
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error('La respuesta excede el tamaño máximo permitido.');
      chunks.push(value);
    }
    return { finalUrl: current, text: new TextDecoder().decode(Buffer.concat(chunks)), contentType };
  }
  throw new Error('Demasiadas redirecciones.');
}
