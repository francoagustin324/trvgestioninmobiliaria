const PHOTO_STATUS_SELECTOR = '[data-property-photo-status]';

export function normalizePropertyPhotoStatus(message: string): string {
  const withoutNetworkNoise = message
    .replace(/(?:Failed to fetch\s*)+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withoutNetworkNoise) return '';

  const prefixMatch = withoutNetworkNoise.match(/^\d+ fotos listas\./i);
  const prefix = prefixMatch?.[0] ?? '';
  const remainder = prefix ? withoutNetworkNoise.slice(prefix.length).trim() : withoutNetworkNoise;
  const sentences = remainder
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    const key = sentence.toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(sentence);
  }
  return [prefix, ...unique].filter(Boolean).join(' ').trim();
}

function cleanPhotoStatus(status: HTMLElement): void {
  const normalized = normalizePropertyPhotoStatus(status.textContent ?? '');
  if (normalized && normalized !== status.textContent) status.textContent = normalized;
}

export function installPropertyPhotoUxGuard(): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const element = mutation.target instanceof HTMLElement
        ? mutation.target.closest<HTMLElement>(PHOTO_STATUS_SELECTOR)
        : mutation.target.parentElement?.closest<HTMLElement>(PHOTO_STATUS_SELECTOR);
      if (element) cleanPhotoStatus(element);
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.matches(PHOTO_STATUS_SELECTOR)) cleanPhotoStatus(node);
        node.querySelectorAll<HTMLElement>(PHOTO_STATUS_SELECTOR).forEach(cleanPhotoStatus);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.querySelectorAll<HTMLElement>(PHOTO_STATUS_SELECTOR).forEach(cleanPhotoStatus);
}
