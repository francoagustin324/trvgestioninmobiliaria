const phoneRegex = /(?:\+?\d[\s().-]?){8,}/g;
const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const urlRegex = /https?:\/\/\S+/gi;

export function cleanText(input = ''): string {
  return input.replace(emailRegex, '').replace(urlRegex, '').replace(phoneRegex, '').replace(/\s{2,}/g, ' ').trim();
}

export function normalizeWhitespace(input = ''): string {
  return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function uniquePhotos(urls: string[]): string[] {
  const seen = new Set<string>();
  return urls
    .filter((url) => /^https?:\/\//i.test(url) && !url.startsWith('data:'))
    .filter((url) => !/(logo|avatar|icon|marker|map|sprite|banner|ads?)/i.test(url))
    .map((url) => url.replace(/\?.*$/, ''))
    .filter((url) => (seen.has(url) ? false : (seen.add(url), true)))
    .slice(0, 12);
}
