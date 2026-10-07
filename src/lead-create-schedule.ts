export interface LeadScheduleInput {
  nextAction?: string;
  nextFollowUp?: string;
  phone?: string;
  today: string;
}

export interface LeadScheduleResolution {
  nextAction: string;
  nextFollowUp: string;
  actionSuggested: boolean;
  dateSuggested: boolean;
  error?: string;
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isStrictLocalDate(value: string): boolean {
  const match = LOCAL_DATE_PATTERN.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}

export function resolveLeadSchedule(input: LeadScheduleInput): LeadScheduleResolution {
  const manualAction = input.nextAction?.trim() || '';
  const manualDate = input.nextFollowUp?.trim() || '';
  const today = input.today.trim();

  if (!isStrictLocalDate(today)) {
    return {
      nextAction: manualAction,
      nextFollowUp: manualDate,
      actionSuggested: false,
      dateSuggested: false,
      error: 'No se pudo determinar la fecha local actual.',
    };
  }

  if (manualDate && !isStrictLocalDate(manualDate)) {
    return {
      nextAction: manualAction,
      nextFollowUp: manualDate,
      actionSuggested: false,
      dateSuggested: false,
      error: 'Ingresá una fecha de seguimiento válida.',
    };
  }

  if (manualDate && manualDate < today) {
    return {
      nextAction: manualAction,
      nextFollowUp: manualDate,
      actionSuggested: false,
      dateSuggested: false,
      error: 'La fecha de seguimiento no puede estar en el pasado.',
    };
  }

  if (Boolean(manualAction) !== Boolean(manualDate)) {
    return {
      nextAction: manualAction,
      nextFollowUp: manualDate,
      actionSuggested: false,
      dateSuggested: false,
      error: 'Completá la próxima acción y su fecha, o dejá ambos campos vacíos.',
    };
  }

  return {
    nextAction: manualAction,
    nextFollowUp: manualDate,
    actionSuggested: false,
    dateSuggested: false,
  };
}
