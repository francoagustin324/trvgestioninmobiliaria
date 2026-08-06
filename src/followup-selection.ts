import {
  addCalendarDays,
  calendarDateInTimeZone,
  formatCalendarDateEsAr,
  isValidCalendarDate,
} from './followup-calendar.js';

const RELATIVE_DAYS = new Set([1, 3, 7, 14, 30]);
const SUPPORTED_CHOICES = new Set(['none', 'custom', '1', '3', '7', '14', '30']);

export interface CanonicalFollowUpState {
  checkedChoice: string;
  selectedChoice: string;
  selectedDate: string;
  hiddenDate: string;
  previewDate: string;
  previewText: string;
  customDate: string;
}

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

export function canonicalFollowUpPayload(state: CanonicalFollowUpState): string | null {
  const choice = state.checkedChoice;
  if (!choice || !SUPPORTED_CHOICES.has(choice)) {
    throw new Error('Elegí cuándo querés realizar el próximo seguimiento.');
  }
  if (state.selectedChoice !== choice) {
    throw new Error('La opción seleccionada cambió antes de guardar. Volvé a elegirla.');
  }

  if (choice === 'none') {
    if (state.selectedDate || state.hiddenDate || state.previewDate) {
      throw new Error('La fecha visible cambió antes de guardar. Volvé a elegir el seguimiento.');
    }
    if (state.previewText !== followUpPreview('')) {
      throw new Error('La vista previa cambió antes de guardar. Volvé a elegir el seguimiento.');
    }
    return null;
  }

  const date = state.selectedDate;
  if (!isValidCalendarDate(date)) {
    throw new Error(choice === 'custom'
      ? 'Elegí una fecha personalizada válida.'
      : 'La fecha seleccionada ya no es válida. Volvé a elegir el seguimiento.');
  }
  if (state.hiddenDate !== date || state.previewDate !== date) {
    throw new Error('La fecha visible cambió antes de guardar. Volvé a elegir el seguimiento.');
  }
  if (state.previewText !== followUpPreview(date)) {
    throw new Error('La vista previa cambió antes de guardar. Volvé a elegir el seguimiento.');
  }
  if (choice === 'custom' && state.customDate !== date) {
    throw new Error('La fecha personalizada cambió antes de guardar. Volvé a elegirla.');
  }
  return date;
}
