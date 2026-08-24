import { visitReadiness } from './lead-qualification.js';
import {
  applyCommercialStage,
  commercialStage,
  COMMERCIAL_STAGES,
  isTerminalClient,
  localIsoDate,
} from './lead-pipeline.js';
import { isStrictLocalDate } from './lead-create-schedule.js';
import type {
  ActivityEntry,
  Client,
  Property,
  TeamRole,
  Visit,
  VisitInterest,
  VisitStatus,
} from './models.js';
import { assignmentVisible } from './team-policy.js';

export interface VisitActor {
  id: number;
  role: TeamRole;
}

export interface CoordinateVisitInput {
  visits: Visit[];
  client: Client;
  property: Property;
  actor: VisitActor;
  localDate: string;
  localTime: string;
  now?: Date;
}

export interface CoordinateVisitResult {
  client: Client;
  visit: Visit;
  activity: Omit<ActivityEntry, 'id' | 'actorId' | 'createdAt'>;
}

export interface RegisterVisitResultInput {
  visit: Visit;
  client: Client;
  property?: Property;
  actor: VisitActor;
  status: VisitStatus;
  interest?: VisitInterest;
  objection?: string;
  nextAction?: string;
  nextFollowUp?: string;
  now?: Date;
}

export interface RegisterVisitResultResult {
  client: Client;
  visit: Visit;
  activity: Omit<ActivityEntry, 'id' | 'actorId' | 'createdAt'>;
}

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RESULT_STATUSES = new Set<VisitStatus>(['Realizada', 'Cancelada', 'No asistió']);
const VISIT_INTERESTS = new Set<VisitInterest>(['Alto', 'Medio', 'Bajo']);
const VISIT_STAGE_INDEX = COMMERCIAL_STAGES.indexOf('Visita coordinada');

function activity(
  action: string,
  clientId: number,
  detail: string,
): Omit<ActivityEntry, 'id' | 'actorId' | 'createdAt'> {
  return { action, entityType: 'Cliente', entityId: clientId, detail };
}

function compact(value: string, max = 96): string {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function assertAccessible(actor: VisitActor, assignedToId: number | undefined, label: string): void {
  if (!assignmentVisible(actor.role, actor.id, assignedToId)) {
    throw new Error(`No tenés permiso para gestionar ${label}.`);
  }
}

export function visitPropertyLabel(property: Property): string {
  return compact(property.title?.trim() || property.address?.trim() || `Propiedad ${property.id}`, 70);
}

export function visitNextAction(property: Property): string {
  return compact(`Visita · ${visitPropertyLabel(property)}`, 88);
}

export function localVisitIso(localDate: string, localTime: string): string {
  const date = localDate.trim();
  const time = localTime.trim();
  if (!isStrictLocalDate(date)) throw new Error('Ingresá una fecha de visita válida.');
  const timeMatch = LOCAL_TIME_PATTERN.exec(time);
  if (!timeMatch) throw new Error('Ingresá una hora de visita válida.');

  const [year, month, day] = date.split('-').map(Number);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const local = new Date(year!, month! - 1, day!, hour, minute, 0, 0);
  if (
    local.getFullYear() !== year
    || local.getMonth() !== month! - 1
    || local.getDate() !== day
    || local.getHours() !== hour
    || local.getMinutes() !== minute
  ) {
    throw new Error('La fecha y hora de visita no son válidas.');
  }
  return local.toISOString();
}

export function localVisitParts(scheduledAt: string): { date: string; time: string } {
  const value = new Date(scheduledAt);
  if (Number.isNaN(value.getTime())) return { date: '', time: '' };
  return {
    date: localIsoDate(value),
    time: `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`,
  };
}

export function nextVisitId(visits: Visit[]): number {
  return Math.max(0, ...visits.map((visit) => Number.isFinite(visit.id) ? visit.id : 0)) + 1;
}

function advanceClientForVisit(client: Client): Client {
  const currentStage = commercialStage(client);
  const currentIndex = COMMERCIAL_STAGES.indexOf(currentStage);
  if (currentIndex >= 0 && currentIndex < VISIT_STAGE_INDEX) {
    return applyCommercialStage(client, 'Visita coordinada');
  }
  return { ...client };
}

export function coordinateVisit(input: CoordinateVisitInput): CoordinateVisitResult {
  if (isTerminalClient(input.client)) {
    throw new Error('Un lead ganado o perdido no puede coordinar una visita nueva.');
  }
  assertAccessible(input.actor, input.client.assignedToId, 'este lead');
  assertAccessible(input.actor, input.property.assignedToId, 'esta propiedad');

  const readiness = visitReadiness(input.client, []);
  if (readiness.warning) {
    const blocker = readiness.missing[0] || 'la calificación comercial';
    throw new Error(`No conviene coordinar todavía. Falta confirmar ${blocker}.`);
  }

  const now = input.now ?? new Date();
  const scheduledAt = localVisitIso(input.localDate, input.localTime);
  if (Date.parse(scheduledAt) < now.getTime()) {
    throw new Error('La visita no puede quedar programada en el pasado.');
  }

  const assignedToId = input.client.assignedToId ?? input.actor.id;
  if (input.visits.some((visit) => (
    visit.clientId === input.client.id
    && visit.propertyId === input.property.id
    && visit.scheduledAt === scheduledAt
    && visit.status === 'Coordinada'
  ))) {
    throw new Error('Esta visita ya está coordinada.');
  }

  const timestamp = now.toISOString();
  const client = {
    ...advanceClientForVisit(input.client),
    nextAction: visitNextAction(input.property),
    nextFollowUp: input.localDate.trim(),
  };
  const visit: Visit = {
    id: nextVisitId(input.visits),
    clientId: input.client.id,
    propertyId: input.property.id,
    scheduledAt,
    status: 'Coordinada',
    interest: undefined,
    objection: undefined,
    assignedToId,
    createdById: input.actor.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    client,
    visit,
    activity: activity(
      'Visita coordinada',
      input.client.id,
      `${visitPropertyLabel(input.property)} · ${input.localDate.trim()} ${input.localTime.trim()}`,
    ),
  };
}

function outcomeAction(status: VisitStatus): string {
  if (status === 'Realizada') return 'Visita realizada';
  if (status === 'Cancelada') return 'Visita cancelada';
  return 'Cliente no asistió';
}

export function registerVisitResult(input: RegisterVisitResultInput): RegisterVisitResultResult {
  if (input.visit.status !== 'Coordinada') throw new Error('Esta visita ya tiene un resultado registrado.');
  if (!RESULT_STATUSES.has(input.status)) throw new Error('Seleccioná un resultado válido para la visita.');
  if (input.visit.clientId !== input.client.id) throw new Error('La visita no corresponde a este lead.');
  if (input.property && input.property.id !== input.visit.propertyId) {
    throw new Error('La propiedad no corresponde a esta visita.');
  }
  assertAccessible(input.actor, input.visit.assignedToId, 'esta visita');
  assertAccessible(input.actor, input.client.assignedToId, 'este lead');

  const interest = input.status === 'Realizada' ? input.interest : undefined;
  if (input.status === 'Realizada' && (!interest || !VISIT_INTERESTS.has(interest))) {
    throw new Error('Registrá el nivel de interés de la visita realizada.');
  }

  const now = input.now ?? new Date();
  const terminal = isTerminalClient(input.client);
  const nextAction = input.nextAction?.trim() || '';
  const nextFollowUp = input.nextFollowUp?.trim() || '';
  if (!terminal) {
    if (!nextAction) throw new Error('Definí la próxima acción comercial.');
    if (!isStrictLocalDate(nextFollowUp)) throw new Error('Definí una próxima fecha válida.');
    if (nextFollowUp < localIsoDate(now)) throw new Error('La próxima fecha no puede estar en el pasado.');
  }

  const objection = input.objection?.trim() || undefined;
  const visit: Visit = {
    ...input.visit,
    status: input.status,
    interest,
    objection,
    updatedAt: now.toISOString(),
  };
  const client: Client = terminal
    ? { ...input.client }
    : { ...input.client, nextAction, nextFollowUp };
  const parts = localVisitParts(input.visit.scheduledAt);
  const property = input.property ? visitPropertyLabel(input.property) : 'Propiedad no disponible';
  const interestDetail = interest ? ` · Interés ${interest}` : '';
  const objectionDetail = objection ? ` · ${compact(objection, 100)}` : '';

  return {
    client,
    visit,
    activity: activity(
      outcomeAction(input.status),
      input.client.id,
      `${property} · ${parts.date || input.visit.scheduledAt}${parts.time ? ` ${parts.time}` : ''} · ${input.status}${interestDetail}${objectionDetail}`,
    ),
  };
}

function scheduledMs(visit: Visit): number {
  const value = Date.parse(visit.scheduledAt);
  return Number.isFinite(value) ? value : 0;
}

export function visitsForClient(visits: Visit[], clientId: number, now = new Date()): Visit[] {
  const nowMs = now.getTime();
  return visits
    .filter((visit) => visit.clientId === clientId)
    .slice()
    .sort((left, right) => {
      const leftMs = scheduledMs(left);
      const rightMs = scheduledMs(right);
      const leftUpcoming = left.status === 'Coordinada' && leftMs >= nowMs;
      const rightUpcoming = right.status === 'Coordinada' && rightMs >= nowMs;
      if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
      if (leftUpcoming && rightUpcoming && leftMs !== rightMs) return leftMs - rightMs;
      if (leftMs !== rightMs) return rightMs - leftMs;
      return right.id - left.id;
    });
}