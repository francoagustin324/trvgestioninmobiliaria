import type { Client, CommercialStage, TeamMember } from './models.js';
import { commercialQualificationState, commercialStage, isTerminalClient, localIsoDate } from './lead-pipeline.js';

export type LeadSort = 'priority' | 'followup' | 'recent' | 'name';

export interface LeadAlert {
  label: string;
  kind: 'danger' | 'warning' | 'info' | 'success' | 'muted';
  rank: number;
}

function dayNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 86_400_000);
}

function todayNumber(today = localIsoDate()): number {
  return dayNumber(today) ?? Math.floor(Date.now() / 86_400_000);
}

export function relativeCommercialDate(value: string | undefined, today = localIsoDate()): string {
  const target = dayNumber(value);
  if (target === null) return 'Sin fecha';
  const delta = target - todayNumber(today);
  if (delta === 0) return 'Hoy';
  if (delta === 1) return 'Mañana';
  if (delta === -1) return 'Vencido ayer';
  if (delta < -1) return `Vencido hace ${Math.abs(delta)} días`;
  if (delta > 1 && delta <= 7) return `En ${delta} días`;
  const [year, month, day] = value!.split('-');
  return `${day}/${month}/${year}`;
}

export function followUpDisplay(client: Client, today = localIsoDate()): { action: string; date: string; pending: boolean } {
  if (isTerminalClient(client)) return { action: '', date: '', pending: false };
  const action = client.nextAction?.trim();
  const date = client.nextFollowUp;
  if (action && date) return { action, date: relativeCommercialDate(date, today), pending: true };
  if (date) return { action: 'Definir acción', date: `${relativeCommercialDate(date, today)} · falta detalle`, pending: true };
  if (action) return { action, date: 'Falta programar fecha', pending: true };
  return { action: 'Sin próxima acción', date: '', pending: false };
}

function stageIs(client: Client, stage: CommercialStage): boolean {
  return commercialStage(client) === stage;
}

export function primaryLeadAlert(client: Client, today = localIsoDate()): LeadAlert {
  const followUp = dayNumber(client.nextFollowUp);
  const now = todayNumber(today);
  const qualification = commercialQualificationState(client).state;
  if (isTerminalClient(client)) {
    return { label: stageIs(client, 'Ganado') ? 'Operación ganada' : 'Operación perdida', kind: 'muted', rank: 90 };
  }
  if (followUp !== null && followUp < now) {
    const days = now - followUp;
    return { label: days === 1 ? 'Seguimiento vencido ayer' : `Seguimiento vencido hace ${days} días`, kind: 'danger', rank: 0 };
  }
  if (stageIs(client, 'Nuevo') && !client.lastContact) return { label: 'Nuevo sin contactar', kind: 'warning', rank: 1 };
  if (stageIs(client, 'Visita coordinada') && followUp === now) return { label: 'Visita hoy', kind: 'info', rank: 2 };
  if (followUp === now) return { label: 'Contactar hoy', kind: 'info', rank: 3 };
  if (stageIs(client, 'Calificado') && (!client.nextAction?.trim() || !client.nextFollowUp)) {
    return { label: 'Calificado sin seguimiento', kind: 'warning', rank: 4 };
  }
  if (qualification === 'Falta presupuesto') return { label: 'Falta presupuesto', kind: 'warning', rank: 5 };
  if (qualification === 'Falta forma de pago') return { label: 'Falta forma de pago', kind: 'warning', rank: 6 };
  if (qualification === 'Falta confirmar capacidad de avance') return { label: 'Falta confirmar capacidad de avance', kind: 'warning', rank: 7 };
  if (qualification === 'No listo todavía') return { label: 'No listo todavía', kind: 'muted', rank: 8 };
  if (!client.nextAction?.trim() || !client.nextFollowUp) return { label: 'Sin próxima acción', kind: 'muted', rank: 9 };
  if (qualification === 'Calificado') return { label: 'Calificado', kind: 'success', rank: 10 };
  return { label: 'Información inicial', kind: 'muted', rank: 11 };
}

function urgentDate(client: Client): number {
  return dayNumber(client.nextFollowUp) ?? Number.MAX_SAFE_INTEGER;
}

function temperatureRank(client: Client): number {
  return client.temperature === 'Caliente' ? 0 : client.temperature === 'Tibio' ? 1 : 2;
}

export function sortLeads(clients: Client[], sort: LeadSort, today = localIsoDate()): Client[] {
  return [...clients].sort((left, right) => {
    if (sort === 'name') return left.name.localeCompare(right.name, 'es');
    if (sort === 'recent') return (right.id || 0) - (left.id || 0);
    if (sort === 'followup') return urgentDate(left) - urgentDate(right) || left.name.localeCompare(right.name, 'es');
    const leftTerminal = isTerminalClient(left) ? 1 : 0;
    const rightTerminal = isTerminalClient(right) ? 1 : 0;
    if (leftTerminal !== rightTerminal) return leftTerminal - rightTerminal;
    const leftAlert = primaryLeadAlert(left, today);
    const rightAlert = primaryLeadAlert(right, today);
    if (leftAlert.rank !== rightAlert.rank) return leftAlert.rank - rightAlert.rank;
    const temperature = temperatureRank(left) - temperatureRank(right);
    if (temperature) return temperature;
    return urgentDate(left) - urgentDate(right) || left.name.localeCompare(right.name, 'es');
  });
}

function readableEmail(email: string | undefined): string {
  if (!email) return '';
  return email.split('@')[0]!.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function readableResponsible(
  client: Client,
  members: TeamMember[],
  profileName?: string,
  profileEmail?: string,
): string {
  const member = members.find((candidate) => candidate.id === client.assignedToId);
  const memberName = member?.name?.trim();
  if (memberName && !/^trv\s*gestion\s*inmobiliaria$/i.test(memberName)) return memberName;
  if (profileName?.trim() && !/^trv\s*gestion\s*inmobiliaria$/i.test(profileName.trim())) return profileName.trim();
  const email = member?.email || profileEmail;
  return readableEmail(email) || 'Sin asignar';
}
