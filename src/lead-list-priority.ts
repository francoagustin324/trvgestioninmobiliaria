import { resolveHumanIdentity } from './human-identity.js';
import type { ActivityEntry, Client, TeamMember } from './models.js';
import {
  commercialQualificationState,
  commercialStage,
  isTerminalClient,
  localIsoDate,
} from './lead-pipeline.js';

export type LeadOrder = 'priority' | 'follow-up' | 'recent' | 'name';
export type LeadAlertTone = 'danger' | 'warning' | 'today' | 'ready' | 'neutral' | 'terminal';
export type LeadAlertKind =
  | 'overdue'
  | 'due-today'
  | 'visit-today'
  | 'new-uncontacted'
  | 'qualification-missing'
  | 'no-follow-up'
  | 'no-action'
  | 'ready'
  | 'terminal'
  | 'stage-summary'
  | 'neutral';
export type FollowUpState = 'terminal' | 'overdue' | 'today' | 'upcoming' | 'missing-action' | 'missing-date' | 'empty';

export interface LeadAlert {
  kind: LeadAlertKind;
  label: string;
  tone: LeadAlertTone;
  rank: number;
}

export interface LeadFollowUpDisplay {
  action: string;
  dateLabel: string;
  state: FollowUpState;
}

const DAY_MS = 86_400_000;
const longDateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});
const updatedFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
let activitySource: () => ActivityEntry[] = () => [];

export function setLeadActivitySource(source: () => ActivityEntry[]): void {
  activitySource = source;
}

function normalized(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isoDayNumber(value: string | undefined): number | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / DAY_MS) : null;
}

export function leadDaysFromToday(value: string | undefined, today = localIsoDate()): number | null {
  const target = isoDayNumber(value);
  const reference = isoDayNumber(today);
  return target === null || reference === null ? null : target - reference;
}

function distantDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : longDateFormatter.format(date);
}

export function relativeLeadDate(value: string | undefined, today = localIsoDate()): string {
  if (!value) return 'Sin fecha';
  const days = leadDaysFromToday(value, today);
  if (days === null) return value;
  if (days === -1) return 'Vencido ayer';
  if (days < -1) return `Vencido hace ${Math.abs(days)} días`;
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  if (days > 1 && days <= 7) return `En ${days} días`;
  return distantDate(value);
}

export function leadFollowUpDisplay(client: Client, today = localIsoDate()): LeadFollowUpDisplay {
  if (isTerminalClient(client)) {
    return { action: 'Operación cerrada', dateLabel: '', state: 'terminal' };
  }

  const action = client.nextAction?.trim() || '';
  const date = client.nextFollowUp;
  if (!action && !date) return { action: 'Sin próxima acción', dateLabel: '', state: 'empty' };
  if (action && !date) return { action, dateLabel: 'Falta programar fecha', state: 'missing-date' };
  if (!date) return { action: action || 'Sin próxima acción', dateLabel: '', state: 'empty' };

  const days = leadDaysFromToday(date, today);
  if (!action) {
    const dateContext = days === -1
      ? 'fecha vencida ayer'
      : days !== null && days < -1
        ? `fecha vencida hace ${Math.abs(days)} días`
        : days === 0
          ? 'hoy'
          : relativeLeadDate(date, today).toLowerCase();
    return { action: 'Definir acción', dateLabel: dateContext, state: 'missing-action' };
  }

  return {
    action,
    dateLabel: relativeLeadDate(date, today),
    state: days !== null && days < 0 ? 'overdue' : days === 0 ? 'today' : 'upcoming',
  };
}

function visitTime(client: Client): string {
  const match = client.nextAction?.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return match ? `${match[1]!.padStart(2, '0')}:${match[2]}` : '';
}

function isMortgage(client: Client): boolean {
  return normalized(client.paymentMethod).includes('credito hipotecario')
    || normalized(client.canMoveForward).includes('depende del credito');
}

export function leadPrimaryAlert(client: Client, today = localIsoDate()): LeadAlert {
  const stage = commercialStage(client);
  if (isTerminalClient(client)) return { kind: 'terminal', label: stage, tone: 'terminal', rank: 99 };

  const days = leadDaysFromToday(client.nextFollowUp, today);
  if (days !== null && days < 0) {
    return {
      kind: 'overdue',
      label: days === -1 ? 'Seguimiento vencido ayer' : `Seguimiento vencido hace ${Math.abs(days)} días`,
      tone: 'danger',
      rank: 1,
    };
  }
  if (stage === 'Nuevo' && !client.lastContact) return { kind: 'new-uncontacted', label: 'Nuevo sin contactar', tone: 'warning', rank: 2 };
  if (days === 0 && (stage === 'Visita coordinada' || normalized(client.nextAction).includes('visita'))) {
    const time = visitTime(client);
    return { kind: 'visit-today', label: time ? `Visita hoy a las ${time}` : 'Visita hoy', tone: 'today', rank: 3 };
  }
  if (days === 0) return { kind: 'due-today', label: 'Contactar hoy', tone: 'today', rank: 4 };
  if (stage === 'Calificado' && (!client.nextAction?.trim() || !client.nextFollowUp)) {
    return { kind: 'no-follow-up', label: 'Calificado sin seguimiento', tone: 'warning', rank: 5 };
  }

  const qualification = commercialQualificationState(client);
  if (qualification.state === 'Falta presupuesto') return { kind: 'qualification-missing', label: 'Falta presupuesto', tone: 'warning', rank: 6 };
  if (qualification.state === 'Falta forma de pago') return { kind: 'qualification-missing', label: 'Falta forma de pago', tone: 'warning', rank: 7 };
  if (isMortgage(client) && !client.creditPossible?.trim()) return { kind: 'qualification-missing', label: 'Falta confirmar crédito', tone: 'warning', rank: 7 };
  if (qualification.state === 'Falta confirmar capacidad de avance') {
    return { kind: 'qualification-missing', label: 'Falta confirmar capacidad de avance', tone: 'warning', rank: 8 };
  }
  if (qualification.state === 'No listo todavía') return { kind: 'qualification-missing', label: 'No listo todavía', tone: 'neutral', rank: 9 };
  if (!client.nextAction?.trim() && !client.nextFollowUp) return { kind: 'no-action', label: 'Sin próxima acción', tone: 'neutral', rank: 10 };
  if (qualification.state === 'Calificado' || stage === 'Calificado') return { kind: 'ready', label: 'Calificado', tone: 'ready', rank: 11 };
  if (stage === 'Nuevo') return { kind: 'neutral', label: 'Información inicial', tone: 'neutral', rank: 12 };
  return { kind: 'stage-summary', label: stage, tone: 'neutral', rank: 12 };
}

function priorityGroup(client: Client, today: string): number {
  if (isTerminalClient(client)) return 8;
  const stage = commercialStage(client);
  const days = leadDaysFromToday(client.nextFollowUp, today);
  if (days !== null && days < 0) return 0;
  if (stage === 'Nuevo' && !client.lastContact) return 1;
  if (days === 0) return 2;
  if (stage === 'Visita coordinada' && days !== null && days > 0) return 3;
  if (stage === 'Calificado' && (!client.nextAction?.trim() || !client.nextFollowUp)) return 4;
  if (client.temperature === 'Caliente') return 5;
  if (client.temperature === 'Tibio') return 6;
  return 7;
}

function urgencyDate(client: Client): number {
  return isoDayNumber(client.nextFollowUp) ?? Number.MAX_SAFE_INTEGER;
}

function timestamp(value: string | undefined): number {
  if (!value) return Number.NaN;
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`);
  return date.getTime();
}

function clientActivities(client: Client): ActivityEntry[] {
  return activitySource().filter((entry) => entry.entityType === 'Cliente' && entry.entityId === client.id);
}

export function leadRecentTimestamp(client: Client): number {
  const activities = clientActivities(client);
  const created = activities
    .filter((entry) => entry.action === 'Lead creado')
    .map((entry) => timestamp(entry.createdAt))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  if (created !== undefined) return created;

  const commercialActivity = activities
    .filter((entry) => !/seguimiento.*programado|pr[oó]xima acci[oó]n programada/i.test(entry.action))
    .map((entry) => timestamp(entry.createdAt))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  const directValues = [timestamp(client.qualificationUpdatedAt), timestamp(client.lastContact)].filter(Number.isFinite);
  const candidates = [commercialActivity, ...directValues].filter((value): value is number => Number.isFinite(value));
  return candidates.length ? Math.max(...candidates) : client.id;
}

export function sortLeads(clients: Client[], order: LeadOrder = 'priority', today = localIsoDate()): Client[] {
  return clients
    .map((client, index) => ({ client, index }))
    .sort((left, right) => {
      const leftTerminal = isTerminalClient(left.client);
      const rightTerminal = isTerminalClient(right.client);
      if (leftTerminal !== rightTerminal) return leftTerminal ? 1 : -1;

      if (order === 'name') {
        const result = left.client.name.localeCompare(right.client.name, 'es', { sensitivity: 'base' });
        return result || left.index - right.index;
      }
      if (order === 'recent') {
        const result = leadRecentTimestamp(right.client) - leadRecentTimestamp(left.client);
        return result || right.client.id - left.client.id || left.index - right.index;
      }
      if (order === 'follow-up') {
        const result = urgencyDate(left.client) - urgencyDate(right.client);
        return result || right.client.id - left.client.id || left.index - right.index;
      }

      const groupDifference = priorityGroup(left.client, today) - priorityGroup(right.client, today);
      if (groupDifference) return groupDifference;
      const dateDifference = urgencyDate(left.client) - urgencyDate(right.client);
      if (dateDifference) return dateDifference;
      return right.client.id - left.client.id || left.index - right.index;
    })
    .map(({ client }) => client);
}

export function readableLeadAssignee(
  client: Client,
  members: TeamMember[],
  profileName: string,
  profileEmail: string,
): string {
  const member = client.assignedToId ? members.find((item) => item.id === client.assignedToId) : undefined;
  const identity = resolveHumanIdentity({
    member,
    profileName,
    profileEmail,
  });
  return identity.valid ? identity.fullName : 'Sin asignar';
}

export function compactBudget(client: Client): string {
  const budget = client.budget?.trim();
  if (!budget) return 'No confirmado';
  const hasCurrency = /\b(?:USD|ARS|EUR|US\$|d[oó]lares?|pesos?)\b/i.test(budget);
  return hasCurrency || !client.currency?.trim() ? budget : `${client.currency.trim()} ${budget}`;
}

export function compactPayment(client: Client): string {
  const payment = client.paymentMethod?.trim() || 'No confirmado';
  const credit = client.creditPossible?.trim();
  const amount = client.creditApprovedAmount?.trim();
  if (!credit && !amount) return payment;
  return [payment, credit, amount].filter(Boolean).join(' · ');
}

export function compactTimeframe(client: Client): string {
  const values = [client.purchaseTimeframe?.trim(), client.urgency?.trim()].filter(Boolean) as string[];
  return [...new Set(values)].join(' · ') || 'No confirmado';
}

export function leadUpdatedLabel(client: Client): string {
  const value = client.qualificationUpdatedAt || client.lastContact;
  if (!value) return 'Sin actualización registrada';
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : updatedFormatter.format(date);
}
