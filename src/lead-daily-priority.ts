import type { Client } from './models.js';
import { commercialQualificationState, commercialStage, isTerminalClient, localIsoDate } from './lead-pipeline.js';

export type LeadOrder = 'Prioridad' | 'Seguimiento' | 'Más recientes' | 'Nombre';

export interface LeadPrimaryAlert {
  kind: 'danger' | 'warning' | 'today' | 'success' | 'neutral';
  label: string;
  rank: number;
}

export interface LeadFollowUpPresentation {
  action: string;
  date: string;
  combined: string;
  overdue: boolean;
  today: boolean;
}

function normalized(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function dateFromIso(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year!, month! - 1, day!);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayNumber(value: Date): number {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000;
}

export function daysFromToday(value: string | undefined, today = localIsoDate()): number | null {
  const target = dateFromIso(value);
  const reference = dateFromIso(today);
  if (!target || !reference) return null;
  return dayNumber(target) - dayNumber(reference);
}

function farDate(value: string): string {
  const date = dateFromIso(value);
  return date ? new Intl.DateTimeFormat('es-AR').format(date) : value;
}

export function relativeLeadDate(value: string | undefined, today = localIsoDate()): string {
  if (!value) return 'Sin fecha';
  const delta = daysFromToday(value, today);
  if (delta === null) return value;
  if (delta === 0) return 'Hoy';
  if (delta === 1) return 'Mañana';
  if (delta === -1) return 'Vencido ayer';
  if (delta < -1) return `Vencido hace ${Math.abs(delta)} días`;
  if (delta <= 7) return `En ${delta} días`;
  return farDate(value);
}

export function leadFollowUpPresentation(client: Client, today = localIsoDate()): LeadFollowUpPresentation | null {
  if (isTerminalClient(client)) return null;
  const action = client.nextAction?.trim() || '';
  const dateValue = client.nextFollowUp?.trim() || '';
  const delta = daysFromToday(dateValue || undefined, today);
  const relative = dateValue ? relativeLeadDate(dateValue, today) : '';
  if (dateValue && !action) {
    const status = delta !== null && delta < 0 ? 'fecha vencida' : relative.toLowerCase();
    return { action: 'Definir acción', date: relative, combined: `Definir acción · ${status}`, overdue: Boolean(delta !== null && delta < 0), today: delta === 0 };
  }
  if (action && !dateValue) {
    return { action, date: 'Falta programar fecha', combined: `${action} · Falta programar fecha`, overdue: false, today: false };
  }
  if (!action && !dateValue) {
    return { action: 'Sin próxima acción', date: '', combined: 'Sin próxima acción', overdue: false, today: false };
  }
  return { action, date: relative, combined: `${action} · ${relative}`, overdue: Boolean(delta !== null && delta < 0), today: delta === 0 };
}

function visitMention(client: Client): boolean {
  return commercialStage(client) === 'Visita coordinada' || /\bvisita|mostrar|recorrer\b/i.test(client.nextAction || '');
}

function visitTime(client: Client): string {
  const match = client.nextAction?.match(/\b(?:a\s+las\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/i);
  return match ? ` a las ${match[1]!.padStart(2, '0')}:${match[2]}` : '';
}

export function leadPrimaryAlert(client: Client, today = localIsoDate()): LeadPrimaryAlert {
  if (isTerminalClient(client)) return { kind: 'neutral', label: commercialStage(client), rank: 99 };
  const followUp = leadFollowUpPresentation(client, today);
  const delta = daysFromToday(client.nextFollowUp, today);
  const stage = commercialStage(client);
  if (followUp?.overdue) return { kind: 'danger', label: relativeLeadDate(client.nextFollowUp, today).replace('Vencido ', 'Seguimiento vencido '), rank: 0 };
  if (stage === 'Nuevo' && !client.lastContact) return { kind: 'warning', label: 'Nuevo sin contactar', rank: 1 };
  if (delta === 0 && visitMention(client)) return { kind: 'today', label: `Visita hoy${visitTime(client)}`, rank: 2 };
  if (delta === 0) return { kind: 'today', label: 'Contactar hoy', rank: 3 };
  if (stage === 'Calificado' && (!client.nextAction?.trim() || !client.nextFollowUp)) return { kind: 'warning', label: 'Calificado sin seguimiento', rank: 4 };
  const qualification = commercialQualificationState(client);
  if (qualification.state === 'Falta presupuesto') return { kind: 'warning', label: 'Falta presupuesto', rank: 5 };
  if (qualification.state === 'Falta forma de pago') return { kind: 'warning', label: 'Falta forma de pago', rank: 6 };
  if (/credito hipotecario/i.test(client.paymentMethod || '') && !client.creditPossible?.trim()) return { kind: 'warning', label: 'Falta confirmar crédito', rank: 7 };
  if (qualification.state === 'Falta confirmar capacidad de avance') return { kind: 'warning', label: 'Falta confirmar capacidad de avance', rank: 8 };
  if (qualification.state === 'No listo todavía') return { kind: 'neutral', label: 'No listo todavía', rank: 9 };
  if (!client.nextAction?.trim() || !client.nextFollowUp) return { kind: 'neutral', label: 'Sin próxima acción', rank: 10 };
  if (qualification.state === 'Calificado') return { kind: 'success', label: 'Calificado', rank: 11 };
  return { kind: 'neutral', label: qualification.state, rank: 12 };
}

function priorityGroup(client: Client, today: string): number {
  if (isTerminalClient(client)) return 90;
  const alert = leadPrimaryAlert(client, today);
  if (alert.rank <= 3) return alert.rank;
  const delta = daysFromToday(client.nextFollowUp, today);
  if (commercialStage(client) === 'Visita coordinada' && delta !== null && delta > 0) return 4;
  if (commercialStage(client) === 'Calificado' && (!client.nextAction?.trim() || !client.nextFollowUp)) return 5;
  if (client.temperature === 'Caliente') return 6;
  if (client.temperature === 'Tibio') return 7;
  return 8;
}

function urgentDate(client: Client): number {
  const date = dateFromIso(client.nextFollowUp);
  return date?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function recentDate(client: Client): number {
  const candidates = [client.qualificationUpdatedAt, client.lastContact, client.nextFollowUp]
    .map((value) => value ? new Date(value).getTime() : Number.NaN)
    .filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : 0;
}

export function sortLeadsForDailyWork(clients: Client[], order: LeadOrder = 'Prioridad', today = localIsoDate()): Client[] {
  return [...clients].sort((left, right) => {
    const terminalDifference = Number(isTerminalClient(left)) - Number(isTerminalClient(right));
    if (terminalDifference !== 0) return terminalDifference;
    if (order === 'Nombre') return left.name.localeCompare(right.name, 'es');
    if (order === 'Más recientes') return recentDate(right) - recentDate(left) || left.name.localeCompare(right.name, 'es');
    if (order === 'Seguimiento') return urgentDate(left) - urgentDate(right) || left.name.localeCompare(right.name, 'es');
    const groupDifference = priorityGroup(left, today) - priorityGroup(right, today);
    return groupDifference || urgentDate(left) - urgentDate(right) || left.name.localeCompare(right.name, 'es');
  });
}

export function leadCompactPayment(client: Client): string {
  const payment = client.paymentMethod?.trim() || 'Forma de pago sin confirmar';
  const credit = client.creditPossible?.trim();
  return credit && /cr[eé]dito/i.test(payment) ? `${payment} · ${credit}` : payment;
}

export function leadCompactTimeframe(client: Client): string {
  return [client.purchaseTimeframe?.trim(), client.urgency?.trim()].filter(Boolean).join(' · ') || 'Plazo sin confirmar';
}
