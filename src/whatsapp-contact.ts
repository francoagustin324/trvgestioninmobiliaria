import type { ActivityEntry, Client } from './models.js';
import { saveData, state } from './store.js';
import { activeMember, addActivity, memberName, visibleClients } from './team-access.js';
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
  openedAt?: string;
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

export function createPendingWhatsAppAttempt(
  client: Client,
  phone: string,
  message: string,
  now = new Date(),
): PendingWhatsAppAttempt {
  return {
    id: uniqueAttemptId(now),
    clientId: client.id,
    actorId: activeMember().id,
    message,
    phone,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CONTACT_ATTEMPT_TTL_MS).toISOString(),
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

function activityAttemptId(entry: ActivityEntry): string {
  const markerIndex = entry.detail.lastIndexOf(`${ATTEMPT_MARKER} `);
  return markerIndex < 0 ? '' : entry.detail.slice(markerIndex + ATTEMPT_MARKER.length + 1).split(/\s|\n/)[0] || '';
}

export function recordedActivityForAttempt(attemptId: string): ActivityEntry | null {
  return state.crm.activityLog.find((entry) => activityAttemptId(entry) === attemptId) ?? null;
}

export function loadPendingWhatsAppAttempt(now = new Date()): PendingWhatsAppAttempt | null {
  const key = attemptStorageKey();
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const attempt = JSON.parse(raw) as PendingWhatsAppAttempt;
    const valid = Boolean(
      attempt.id
      && attempt.actorId === state.activeMemberId
      && attempt.clientId
      && attempt.phone
      && attempt.message
      && Date.parse(attempt.expiresAt) > now.getTime(),
    );
    if (!valid || recordedActivityForAttempt(attempt.id)) {
      localStorage.removeItem(key);
      return null;
    }
    return attempt;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function visibleClient(clientId: number): Client | null {
  return visibleClients().find((client) => client.id === clientId) ?? null;
}

export function registerWhatsAppContact(
  attempt: PendingWhatsAppAttempt,
  now = new Date(),
): { activity: ActivityEntry; duplicate: boolean; client: Client } | null {
  if (attempt.actorId !== activeMember().id || Date.parse(attempt.expiresAt) <= now.getTime()) return null;
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
      `Responsable: ${memberName(attempt.actorId)}`,
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
  attemptId: string,
  activityId: number,
  date: string,
): { client: Client; duplicate: boolean } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const client = visibleClient(clientId) as ContactFollowUpClient | null;
  if (!client || !recordedActivityForAttempt(attemptId)) return null;
  const duplicate = client.whatsappFollowUpAttemptId === attemptId
    && client.nextFollowUp === date
    && client.nextAction === 'Volver a contactar por WhatsApp';
  if (duplicate) return { client, duplicate: true };

  client.nextFollowUp = date;
  client.nextAction = 'Volver a contactar por WhatsApp';
  client.whatsappFollowUpAttemptId = attemptId;
  client.whatsappFollowUpActivityId = activityId;
  client.whatsappFollowUpChannel = 'WhatsApp';

  if (!state.crm.activityLog.some((entry) => entry.detail.includes(`${FOLLOW_UP_MARKER} ${attemptId}`))) {
    addActivity({
      action: 'Seguimiento por WhatsApp programado',
      entityType: 'Cliente',
      entityId: client.id,
      detail: `Volver a contactar por WhatsApp · ${date}\n${FOLLOW_UP_MARKER} ${attemptId}`,
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
    responsible: last ? memberName(last.actorId) : '',
    nextFollowUp: next,
    followUpState,
  };
}
