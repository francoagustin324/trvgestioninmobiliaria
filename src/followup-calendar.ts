export const FOLLOW_UP_TIME_ZONE = 'America/Argentina/Cordoba';

interface CalendarParts {
  year: number;
  month: number;
  day: number;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

function leapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return leapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseCalendarDate(value: string): CalendarParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function calendarDate(parts: CalendarParts): string {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function nextCalendarDay(parts: CalendarParts, direction: 1 | -1): CalendarParts {
  let { year, month, day } = parts;
  day += direction;
  if (direction === 1 && day > daysInMonth(year, month)) {
    day = 1;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  if (direction === -1 && day < 1) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    day = daysInMonth(year, month);
  }
  return { year, month, day };
}

function weekday(parts: CalendarParts): number {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4] as const;
  let year = parts.year;
  if (parts.month < 3) year -= 1;
  return (year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400)
    + offsets[parts.month - 1]! + parts.day) % 7;
}

export function isValidCalendarDate(value: string): boolean {
  return Boolean(parseCalendarDate(value));
}

export function calendarDateInTimeZone(
  value = new Date(),
  timeZone = FOLLOW_UP_TIME_ZONE,
): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(value);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const result = calendarDate({ year, month, day });
  if (!isValidCalendarDate(result)) throw new Error('No se pudo determinar la fecha calendario local.');
  return result;
}

export function addCalendarDays(value: string, amount: number): string {
  const parsed = parseCalendarDate(value);
  if (!parsed || !Number.isInteger(amount)) return '';
  let result = parsed;
  const direction: 1 | -1 = amount >= 0 ? 1 : -1;
  for (let remaining = Math.abs(amount); remaining > 0; remaining -= 1) {
    result = nextCalendarDay(result, direction);
  }
  return calendarDate(result);
}

export function formatCalendarDateEsAr(value: string): string {
  const parsed = parseCalendarDate(value);
  if (!parsed) return value;
  return `${WEEKDAYS[weekday(parsed)]}, ${parsed.day} de ${MONTHS[parsed.month - 1]} de ${parsed.year}`;
}
