import type { Client } from './models.js';
import { commercialStage, localIsoDate } from './lead-pipeline.js';
import {
  leadDaysFromToday,
  leadFollowUpDisplay,
  leadPrimaryAlert,
  type FollowUpState,
  type LeadAlertKind,
  type LeadAlertTone,
} from './lead-list-priority.js';

export interface LeadCardAttentionPresentation {
  alertKind: LeadAlertKind;
  alertLabel: string;
  alertFullLabel: string;
  alertTone: LeadAlertTone;
  alertRank: number;
  actionLabel: string;
  dateLabel: string;
  scheduledDate: string;
  scheduledDateLabel: string;
  actionTitle: string;
  showAlert: boolean;
  showAction: boolean;
  showDate: boolean;
  followUpState: FollowUpState;
}

const exactDateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

function exactDate(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : exactDateFormatter.format(date);
}

function visitTime(client: Client): string {
  const match = client.nextAction?.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return match ? `${match[1]!.padStart(2, '0')}:${match[2]}` : '';
}

function compactAlertLabel(kind: LeadAlertKind, fullLabel: string, client: Client, today: string): string {
  if (kind === 'overdue') {
    const days = leadDaysFromToday(client.nextFollowUp, today);
    if (days === -1) return 'Vencido · ayer';
    if (days !== null && days < -1) return `Vencido · ${Math.abs(days)} días`;
    return 'Vencido';
  }
  if (kind === 'due-today') return 'Hoy';
  if (kind === 'visit-today') {
    const time = visitTime(client);
    return time ? `Visita hoy · ${time}` : 'Visita hoy';
  }
  if (kind === 'no-follow-up') return 'Sin seguimiento';
  if (kind === 'qualification-missing' && fullLabel === 'Falta confirmar capacidad de avance') {
    return 'Falta confirmar avance';
  }
  return fullLabel;
}

function isTemporalAlert(kind: LeadAlertKind): boolean {
  return kind === 'overdue' || kind === 'due-today' || kind === 'visit-today';
}

function alertAccessibilityLabel(kind: LeadAlertKind, fullLabel: string, scheduledDateLabel: string): string {
  if (!scheduledDateLabel || !isTemporalAlert(kind)) return fullLabel;
  if (kind === 'visit-today') return `${fullLabel}. Visita programada para ${scheduledDateLabel}.`;
  return `${fullLabel}. Programado para ${scheduledDateLabel}.`;
}

function stripVisitTime(action: string): string {
  const withoutTime = action
    .replace(/\s*(?:a\s+las\s+)?\b(?:[01]?\d|2[0-3]):[0-5]\d\b/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s·\-–—,:;]+$/g, '')
    .trim();
  return withoutTime || 'Confirmar visita';
}

function recommendedAction(client: Client, kind: LeadAlertKind): string {
  const storedAction = client.nextAction?.trim() || '';
  if (storedAction) return kind === 'visit-today' ? stripVisitTime(storedAction) : storedAction;
  if (kind === 'new-uncontacted') return 'Contactar por primera vez';
  if (kind === 'no-follow-up') return client.nextFollowUp ? 'Definir acción' : 'Programar seguimiento';
  if (client.nextFollowUp) return 'Definir acción';
  return 'Definir próxima acción';
}

function sentenceCase(value: string): string {
  return value.replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
}

function alertRepresentsScheduledDate(kind: LeadAlertKind): boolean {
  return kind === 'overdue' || kind === 'due-today' || kind === 'visit-today';
}

function shouldShowAlert(kind: LeadAlertKind, stage: string): boolean {
  if (kind === 'terminal' || kind === 'no-action' || kind === 'stage-summary') return false;
  if (kind === 'ready' && stage === 'Calificado') return false;
  return true;
}

export function leadCardAttentionPresentation(
  client: Client,
  today = localIsoDate(),
): LeadCardAttentionPresentation {
  const alert = leadPrimaryAlert(client, today);
  const followUp = leadFollowUpDisplay(client, today);
  const stage = commercialStage(client);
  const scheduledDate = client.nextFollowUp || '';
  const scheduledDateLabel = exactDate(client.nextFollowUp);
  const dateRepresentedByAlert = alertRepresentsScheduledDate(alert.kind);
  const showAction = alert.kind !== 'terminal';
  const showDate = showAction
    && !dateRepresentedByAlert
    && !(alert.kind === 'no-follow-up' && !client.nextFollowUp)
    && Boolean(followUp.dateLabel);
  const actionLabel = showAction ? recommendedAction(client, alert.kind) : '';
  const dateLabel = showDate ? sentenceCase(followUp.dateLabel) : '';
  const alertLabel = compactAlertLabel(alert.kind, alert.label, client, today);
  const actionTitle = scheduledDateLabel
    ? `Próxima acción: ${actionLabel}. Programada para ${scheduledDateLabel}.`
    : `Próxima acción: ${actionLabel}.`;

  return {
    alertKind: alert.kind,
    alertLabel,
    alertFullLabel: alertAccessibilityLabel(alert.kind, alert.label, scheduledDateLabel),
    alertTone: alert.tone,
    alertRank: alert.rank,
    actionLabel,
    dateLabel,
    scheduledDate,
    scheduledDateLabel,
    actionTitle,
    showAlert: shouldShowAlert(alert.kind, stage),
    showAction,
    showDate,
    followUpState: followUp.state,
  };
}
