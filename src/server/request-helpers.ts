import type { IncomingHttpHeaders } from 'node:http';

// Detrás de un proxy (Railway), request.socket.remoteAddress es la IP del proxy,
// así que TODOS los usuarios compartirían un mismo cupo de rate-limit (o el
// límite se vuelve inefectivo). Usamos la IP real que el proxy reenvía en
// X-Forwarded-For (la primera de la lista), con la del socket como respaldo.
export function clientIp(headers: IncomingHttpHeaders, fallback?: string): string {
  const forwarded = headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = String(raw || '').split(',')[0]?.trim();
  return first || fallback || 'unknown';
}

// Los assets versionados (index.html los pide con ?v=...) pueden cachearse de
// forma agresiva: si cambian, cambia el ?v y el navegador pide la versión nueva.
// El HTML nunca se cachea, para que cada deploy se tome enseguida.
export function staticCacheControl(requestUrl: string, extension: string): string {
  let versioned = false;
  try { versioned = new URL(requestUrl, 'http://localhost').searchParams.has('v'); } catch { versioned = false; }
  return versioned && extension !== '.html'
    ? 'public, max-age=31536000, immutable'
    : 'no-store, no-cache, must-revalidate, max-age=0';
}
