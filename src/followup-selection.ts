import {
  addCalendarDays,
  calendarDateInTimeZone,
  formatCalendarDateEsAr,
  isValidCalendarDate,
} from './followup-calendar.js';

const RELATIVE_DAYS = new Set([1, 3, 7, 14, 30]);

export function followUpDateForChoice(
  choice: string,
  customDate: string,
  now = new Date(),
): string {
  if (choice === 'none') return '';
  if (choice === 'custom') return isValidCalendarDate(customDate) ? customDate : '';
  const days = Number(choice);
  if (!Number.isInteger(days) || !RELATIVE_DAYS.has(days)) return '';
  return addCalendarDays(calendarDateInTimeZone(now), days);
}

export function localDateLabel(value: string): string {
  return formatCalendarDateEsAr(value);
}

export function followUpPreview(value: string): string {
  return value ? `Se programará para: ${localDateLabel(value)}` : 'No se programará un próximo seguimiento.';
}
