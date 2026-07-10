const PHONE_REGEX = /(?:\+?\d[\s().-]?){8,}/g;
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_REGEX = /https?:\/\/\S+/gi;
const CONTACT_LABEL_REGEX = /(?:tel(?:éfono)?|whatsapp|wsp|contacto|asesor|inmobiliaria)\s*[:\-]?\s*[^\n|]{0,80}/gi;

export function decodeHtmlEntities(input = ''): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function cleanText(input = ''): string {
  return decodeHtmlEntities(input)
    .replace(EMAIL_REGEX, '')
    .replace(URL_REGEX, '')
    .replace(PHONE_REGEX, '')
    .replace(CONTACT_LABEL_REGEX, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function visibleText(html = ''): string {
  return decodeHtmlEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalPhotoUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch { return null; }
}

export function uniquePhotos(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of urls) {
    const url = canonicalPhotoUrl(candidate);
    if (!url || /(logo|avatar|icon|marker|map|sprite|banner|advert|favicon|tracking|pixel)/i.test(url)) continue;
    const dedupeKey = url.replace(/([?&])(width|height|w|h|quality|q)=\d+/gi, '$1').replace(/[?&]+$/, '');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(url);
    if (result.length === 12) break;
  }
  return result;
}
