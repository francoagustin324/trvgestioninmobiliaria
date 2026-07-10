export function qs<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`No se encontró ${selector}`);
  return element;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] ?? character));
}

export function hasValue(value: unknown): boolean { return String(value ?? '').trim().length > 0; }

export function safePhotoUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

export function nextId(items: Array<{ id: number }>): number { return Math.max(0, ...items.map((item) => item.id)) + 1; }

export function formValues(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
}

export function field(values: Record<string, string>, key: string): string { return values[key] ?? ''; }

export function setNotice(message: string): void {
  const node = document.querySelector<HTMLElement>('#notice');
  if (!node) return;
  node.textContent = message; node.hidden = false;
  window.setTimeout(() => { node.hidden = true; }, 2400);
}

export function copyText(text: string): void {
  void navigator.clipboard.writeText(text).then(() => setNotice('Copiado correctamente.')).catch(() => setNotice('No se pudo copiar.'));
}
