import type { ActivityEntry, Client } from './models.js';
import { saveData, state } from './store.js';
import { addActivity, visibleClients } from './team-access.js';
import {
  assertCurrentWhatsAppHumanIdentity,
  type WhatsAppHumanIdentitySnapshot,
} from './whatsapp-human-identity.js';
import { localIsoDate } from './whatsapp-contact-core.js';

export {
  addLocalDaysIso,
  normalizeWhatsAppPhone,
  suggestedFollowUp,
  suggestedWhatsAppMessage,
  whatsappUrl,
} from './whatsapp-contact-core.js';
export type { FollowUpSuggestion, WhatsAppPhoneResult } from './whatsapp-contact-core.js';

export const CONTACT_ATTEMPT_TTL_MS = 30 * 60_000;
const ATTEMPT_STORAGE_PREFIX = 'propcontrol-whatsapp-contact-attempt-v1';
const ATTEMPT_MARKER = 'Intento:';
const FOLLOW_UP_MARKER = 'Seguimiento WhatsApp:';

export interface PendingWhatsAppAttempt {
  id: string;
  clientId: number;
  actorId: number;
  message: string;
  phone: string;
  createdAt: string;
  expiresAt: string;
  identity: WhatsAppHumanIdentitySnapshot;
  openedAt?: string;
}

export interface PendingWhatsAppAttemptLoadResult {
  attempt: PendingWhatsAppAttempt | null;
  invalidated: boolean;
  reason: string;
}

export interface WhatsAppContactSummary {
  lastContactAt: string;
  responsible: string;
  nextFollowUp: string;
  followUpState: 'today' | 'upcoming' | 'overdue' | 'none';
}

type ContactFollowUpClient = Client & {
  whatsappFollowUpAttemptId?: string;
  whatsappFollowUpActivityId?: number;
  whatsappFollowUpChannel?: 'WhatsApp';
};

function attemptStorageKey(actorId = state.activeMemberId): string {
  return `${ATTEMPT_STORAGE_PREFIX}:${state.crm.organization.id}:${actorId}`;
}

function uniqueAttemptId(now: Date): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 12);
  return `wa-${now.getTime()}-${random}`;
}

function requiredIdentity(identity?: WhatsAppHumanIdentitySnapshot): WhatsAppHumanIdentitySnapshot {
  if (identity) {
    const authorization = assertCurrentWhatsAppHumanIdentity(identity);
    if (authorization.valid && authorization.identity) return authorization.identity;
    throw new Error(authorization.reason || 'La identidad de WhatsApp ya no es válida.');
  }
  const authorization = assertCurrentWhatsAppHumanIdentity();
  if (!authorization.valid || !authorization.identity) {
    throw new Error(authorization.reason || 'Falta una identidad humana confirmada para WhatsApp.');
  }
  return authorization.identity;
}

export function createPendingWhatsAppAttempt(
  client: Client,
  phone: string,
  message: string,
  identityOrNow?: WhatsAppHumanIdentitySnapshot | Date,
  suppliedNow?: Date,
): PendingWhatsAppAttempt {
  const identity = identityOrNow instanceof Date
    ? requiredIdentity()
    : requiredIdentity(identityOrNow);
  const now = identityOrNow instanceof Date ? identityOrNow : suppliedNow ?? new Date();
  return {
    id: uniqueAttemptId(now),
    clientId: client.id,
    actorId: identity.actorId,
    message,
    phone,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CONTACT_ATTEMPT_TTL_MS).toISOString(),
    identity: { ...identity, createdAt: now.toISOString() },
  };
}

export function savePendingWhatsAppAttempt(attempt: PendingWhatsAppAttempt): void {
  localStorage.setItem(attemptStorageKey(attempt.actorId), JSON.stringify(attempt));
}

export function markPendingAttemptOpened(attempt: PendingWhatsAppAttempt, now = new Date()): PendingWhatsAppAttempt {
  const opened = { ...attempt, openedAt: now.toISOString() };
  savePendingWhatsAppAttempt(opened);
  return opened;
}

export function dismissPendingWhatsAppAttempt(attempt?: PendingWhatsAppAttempt): void {
  localStorage.removeItem(attemptStorageKey(attempt?.actorId));
}

export function dismissPendingWhatsAppAttemptForActor(actorId: number): void {
  localStorage.removeItem(attemptStorageKey(actorId));
}

function activityAttemptId(entry: ActivityEntry): string {
  const markerIndex = entry.detail.lastIndexOf(`${ATTEMPT_MARKER} `);
  return markerIndex < 0 ? '' : entry.detail.slice(markerIndex + ATTEMPT_MARKER.length + 1).split(/\s|\n/)[0] || '';
}

function activityResponsible(entry: ActivityEntry): string {
  const line = entry.detail.split('\n').find((item) => item.startsWith('Responsable: '));
  return line?.slice('Responsable: '.length).trim() || '';
}

export function recordedActivityForAttempt(attemptId: string): ActivityEntry | null {
  return state.crm.activityLog.find((entry) => activityAttemptId(entry) === attemptId) ?? null;
}

function validAttemptShape(attempt: Partial<PendingWhatsAppAttempt>, now: Date): attempt is PendingWhatsAppAttempt {
  return Boolean(
    attempt.id
    && attempt.actorId === state.activeMemberId
    && attempt.clientId
    && attempt.phone
    && attempt.message
    && attempt.identity
    && attempt.identity.actorId === attempt.actorId
    && attempt.identity.memberId === attempt.actorId
    && Date.parse(attempt.expiresAt || '') > now.getTime(),
  );
}

export function loadPendingWhatsAppAttemptResult(now = new Date()): PendingWhatsAppAttemptLoadResult {
  const key = attemptStorageKey();
  const raw = localStorage.getItem(key);
  if (!raw) return { attempt: null, invalidated: false, reason: '' };
  try {
    const attempt = JSON.parse(raw) as Partial<PendingWhatsAppAttempt>;
    if (!validAttemptShape(attempt, now) || recordedActivityForAttempt(attempt.id)) {
      localStorage.removeItem(key);
      return { attempt: null, invalidated: true, reason: 'El intento pendiente ya no es válido o venció.' };
    }
    const authorization = assertCurrentWhatsAppHumanIdentity(attempt.identity);
    if (!authorization.valid) {
      localStorage.removeItem(key);
      return {
        attempt: null,
        invalidated: true,
        reason: authorization.reason || 'El intento quedó invalidado por un cambio de identidad o usuario.',
      };
    }
    return { attempt, invalidated: false, reason: '' };
  } catch {
    localStorage.removeItem(key);
    return { attempt: null, invalidated: true, reason: 'El intento pendiente estaba dañado y fue eliminado.' };
  }
}

export function loadPendingWhatsAppAttempt(now = new Date()): PendingWhatsAppAttempt | null {
  return loadPendingWhatsAppAttemptResult(now).attempt;
}

function visibleClient(clientId: number): Client | null {
  return visibleClients().find((client) => client.id === clientId) ?? null;
}

export function registerWhatsAppContact(
  attempt: PendingWhatsAppAttempt,
  now = new Date(),
): { activity: ActivityEntry; duplicate: boolean; client: Client } | null {
  const authorization = assertCurrentWhatsAppHumanIdentity(attempt.identity);
  if (!authorization.valid || !authorization.identity) return null;
  if (attempt.actorId !== authorization.identity.actorId || Date.parse(attempt.expiresAt) <= now.getTime()) return null;
  const client = visibleClient(attempt.clientId);
  if (!client) return null;
  const existing = recordedActivityForAttempt(attempt.id);
  if (existing) return { activity: existing, duplicate: true, client };

  const activityId = Math.max(0, ...state.crm.activityLog.map((entry) => entry.id)) + 1;
  addActivity({
    action: 'Contacto por WhatsApp',
    entityType: 'Cliente',
    entityId: client.id,
    detail: [
      'Canal: WhatsApp',
      `Número: ${attempt.phone}`,
      `Mensaje: ${attempt.message}`,
      'Origen: contacto asistido',
      `Responsable: ${attempt.identity.fullName}`,
      `Identidad: ${attempt.identity.identityId}`,
      `Fingerprint: ${attempt.identity.fingerprint}`,
      `${ATTEMPT_MARKER} ${attempt.id}`,
    ].join('\n'),
  });
  client.lastContact = localIsoDate(now);
  saveData(`Contacto por WhatsApp registrado: ${client.name}`);
  dismissPendingWhatsAppAttempt(attempt);
  return {
    activity: state.crm.activityLog.find((entry) => entry.id === activityId)!,
    duplicate: false,
    client,
  };
}

export function scheduleWhatsAppFollowUp(
  clientId: number,
  attempt: PendingWhatsAppAttempt,
  activityId: number,
  date: string,
): { client: Client; duplicate: boolean } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const authorization = assertCurrentWhatsAppHumanIdentity(attempt.identity);
  if (!authorization.valid || !authorization.identity) return null;
  if (attempt.actorId !== authorization.identity.actorId) return null;
  const client = visibleClient(clientId) as ContactFollowUpClient | null;
  if (!client || !recordedActivityForAttempt(attempt.id)) return null;
  const duplicate = client.whatsappFollowUpAttemptId === attempt.id
    && client.nextFollowUp === date
    && client.nextAction === 'Volver a contactar por WhatsApp';
  if (duplicate) return { client, duplicate: true };

  client.nextFollowUp = date;
  client.nextAction = 'Volver a contactar por WhatsApp';
  client.whatsappFollowUpAttemptId = attempt.id;
  client.whatsappFollowUpActivityId = activityId;
  client.whatsappFollowUpChannel = 'WhatsApp';

  if (!state.crm.activityLog.some((entry) => entry.detail.includes(`${FOLLOW_UP_MARKER} ${attempt.id}`))) {
    addActivity({
      action: 'Seguimiento por WhatsApp programado',
      entityType: 'Cliente',
      entityId: client.id,
      detail: `Volver a contactar por WhatsApp · ${date}\n${FOLLOW_UP_MARKER} ${attempt.id}`,
    });
  }
  saveData(`Seguimiento por WhatsApp programado: ${client.name}`);
  return { client, duplicate: false };
}

export function whatsappContactSummary(client: Client, now = new Date()): WhatsAppContactSummary {
  const last = state.crm.activityLog
    .filter((entry) => entry.entityType === 'Cliente' && entry.entityId === client.id && entry.action === 'Contacto por WhatsApp')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const today = localIsoDate(now);
  const next = client.nextFollowUp || '';
  const followUpState = !next ? 'none' : next < today ? 'overdue' : next === today ? 'today' : 'upcoming';
  return {
    lastContactAt: last?.createdAt || '',
    responsible: last ? activityResponsible(last) : '',
    nextFollowUp: next,
    followUpState,
  };
}
