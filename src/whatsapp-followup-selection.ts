import { addLocalDaysIso } from './whatsapp-contact-core.js';

export function followUpDateForChoice(
  choice: string,
  customDate: string,
  now = new Date(),
): string {
  if (choice === 'none') return '';
  if (choice === 'custom') return /^\d{4}-\d{2}-\d{2}$/.test(customDate) ? customDate : '';
  const days = Number(choice);
  return Number.isFinite(days) && [1, 3, 7, 14, 30].includes(days)
    ? addLocalDaysIso(days, now)
    : '';
}

export function localDateLabel(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function followUpPreview(value: string): string {
  return value ? `Se programará para: ${localDateLabel(value)}` : 'No se programará un próximo seguimiento.';
}
