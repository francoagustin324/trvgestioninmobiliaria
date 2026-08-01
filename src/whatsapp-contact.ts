import type { ActivityEntry, Client } from './models.js';
import { commercialStage, localIsoDate } from './lead-pipeline.js';
import { saveData, state } from './store.js';
import { activeMember, addActivity, memberName, visibleClients } from './team-access.js';

export const CONTACT_ATTEMPT_TTL_MS = 30 * 60_000;
const ATTEMPT_STORAGE_PREFIX = 'propcontrol-whatsapp-contact-attempt-v1';
const ATTEMPT_MARKER = 'Intento:';
const FOLLOW_UP_MARKER = 'Seguimiento WhatsApp:';

export interface WhatsAppPhoneResult {
  valid: boolean;
  normalized: string;
  display: string;
  reason: string;
  kind: 'argentina' | 'international' | 'invalid' | 'ambiguous';
}

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

export interface FollowUpSuggestion {
  date: string;
  days: number | null;
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

function invalid(reason: string, kind: 'invalid' | 'ambiguous' = 'invalid'): WhatsAppPhoneResult {
  return { valid: false, normalized: '', display: '', reason, kind };
}

function argentinaNationalNumber(digitsValue: string): string | null {
  let digits = digitsValue;
  if (digits.startsWith('54')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('9')) digits = digits.slice(1);
  if (digits.startsWith('0')) digits = digits.slice(1);

  for (let areaLength = 2; areaLength <= 4; areaLength += 1) {
    if (digits.length === 12 && digits.slice(areaLength, areaLength + 2) === '15') {
      digits = `${digits.slice(0, areaLength)}${digits.slice(areaLength + 2)}`;
      break;
    }
  }
  return digits.length === 10 ? digits : null;
}

export function normalizeWhatsAppPhone(value: string): WhatsAppPhoneResult {
  const raw = value.trim();
  if (!raw) return invalid('Ingresá un número de WhatsApp.');
  if (/[^0-9+\s().-]/.test(raw)) return invalid('El número contiene caracteres que no corresponden a un teléfono.');

  const explicitInternational = raw.startsWith('+') || raw.startsWith('00');
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits) return invalid('Ingresá un número de WhatsApp.');

  const looksArgentine = digits.startsWith('54')
    || (!explicitInternational && (digits.startsWith('0') || digits.length === 10 || digits.includes('15')));
  if (looksArgentine) {
    const national = argentinaNationalNumber(digits);
    if (!national) {
      const incomplete = digits.length < 10;
      return invalid(
        incomplete
          ? 'El número está incompleto. Incluí el código de área sin inventarlo.'
          : 'El formato argentino es ambiguo. Revisá código de área, 0 y 15.',
        incomplete ? 'invalid' : 'ambiguous',
      );
    }
    return {
      valid: true,
      normalized: `549${national}`,
      display: `+54 9 ${national}`,
      reason: '',
      kind: 'argentina',
    };
  }

  if (!explicitInternational) {
    if (digits.length < 8) return invalid('El número está incompleto. Incluí código de área y país cuando corresponda.');
    return invalid('No se puede confirmar el país. Agregá + o 00 antes del código internacional.', 'ambiguous');
  }
  if (digits.startsWith('0') || digits.length < 8 || digits.length > 15) {
    return invalid('El número internacional no tiene una longitud válida.');
  }
  return {
    valid: true,
    normalized: digits,
    display: `+${digits}`,
    reason: '',
    kind: 'international',
  };
}

function naturalIdentity(responsible: string, agency: string): string {
  if (responsible && agency) return `soy ${responsible} de ${agency}`;
  if (responsible) return `soy ${responsible}`;
  if (agency) return `te escribo desde ${agency}`;
  return 'te escribo desde la inmobiliaria';
}

export function suggestedWhatsAppMessage(
  client: Pick<Client, 'name' | 'interest'>,
  responsible: string,
  agency: string,
): string {
  const greeting = client.name.trim() ? `Hola ${client.name.trim()}` : 'Hola';
  const identity = naturalIdentity(responsible.trim(), agency.trim());
  const interest = client.interest.trim();
  if (interest) {
    return `${greeting}, ${identity}. Te escribo por tu consulta sobre ${interest}. ¿Seguís buscando una propiedad con estas características?`;
  }
  return `${greeting}, ${identity}. Te escribo por tu consulta inmobiliaria. ¿Seguís buscando una propiedad?`;
}

export function whatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

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

export function addLocalDaysIso(days: number, now = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 12, 0, 0, 0);
  return localIsoDate(date);
}

function mediumTerm(client: Client): boolean {
  const value = `${client.purchaseTimeframe || ''} ${client.urgency || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /mediano|3\s*[-a]\s*6|6\s*[-a]\s*12|varios meses/.test(value);
}

export function suggestedFollowUp(
  client: Client,
  hasOpenConversation: boolean,
  now = new Date(),
): FollowUpSuggestion {
  if (/^\d{4}-\d{2}-\d{2}$/.test(client.nextFollowUp || '')) {
    return { date: client.nextFollowUp!, days: null, reason: 'Se conserva la fecha pactada existente.' };
  }
  if (client.temperature === 'Frío') {
    return { date: addLocalDaysIso(30, now), days: 30, reason: 'Lead frío: seguimiento sugerido en 30 días.' };
  }
  if (mediumTerm(client)) {
    return { date: addLocalDaysIso(14, now), days: 14, reason: 'Compra a mediano plazo: seguimiento sugerido en 14 días.' };
  }
  if (hasOpenConversation) {
    return { date: addLocalDaysIso(3, now), days: 3, reason: 'Conversación abierta: seguimiento sugerido en 3 días.' };
  }
  if (commercialStage(client) === 'Nuevo' || !client.lastContact) {
    return { date: addLocalDaysIso(1, now), days: 1, reason: 'Lead nuevo o no contactado: seguimiento sugerido para mañana.' };
  }
  return { date: addLocalDaysIso(3, now), days: 3, reason: 'Lead activo: seguimiento sugerido en 3 días.' };
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
