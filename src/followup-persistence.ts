import type { Client, CrmData } from './models.js';
import { saveData, state } from './store.js';
import { readLocalSnapshot, writeLocalSnapshot } from './sync-safety.js';
import { visibleClients } from './team-access.js';
import { isValidCalendarDate } from './followup-calendar.js';
import {
  recordedActivityForAttempt,
  scheduleWhatsAppFollowUp,
} from './whatsapp-contact.js';
import { assertCurrentWhatsAppHumanIdentity } from './whatsapp-human-identity.js';

interface ContactFollowUpClient extends Client {
  whatsappFollowUpAttemptId?: string;
  whatsappFollowUpActivityId?: number;
  whatsappFollowUpChannel?: 'WhatsApp';
}

export interface FollowUpPersistenceInput {
  clientId: number;
  attemptId: string;
  activityId: number;
  date: string | null;
}

export interface FollowUpPersistenceResult {
  client: Client;
  date: string | null;
  duplicate: boolean;
}

function rollback(previous: CrmData): void {
  state.crm = previous;
  try {
    writeLocalSnapshot(previous, {
      markDirty: true,
      reason: 'Reversión de seguimiento no confirmado',
      backup: false,
    });
  } catch {
    // El formulario conserva la selección y muestra el error original.
  }
}

function verifiedClient(clientId: number, date: string | null): Client | null {
  const snapshot = readLocalSnapshot();
  const client = snapshot?.clients.find((item) => item.id === clientId) ?? null;
  if (!client) return null;
  if (date) {
    return client.nextFollowUp === date && client.nextAction === 'Volver a contactar por WhatsApp'
      ? client
      : null;
  }
  return !client.nextFollowUp && !client.nextAction ? client : null;
}

function assertAuthorizedContact(input: FollowUpPersistenceInput): ContactFollowUpClient {
  const authorization = assertCurrentWhatsAppHumanIdentity();
  if (!authorization.valid || !authorization.identity) {
    throw new Error(authorization.reason || 'La identidad activa ya no permite guardar este seguimiento.');
  }
  const activity = recordedActivityForAttempt(input.attemptId);
  if (!activity
    || activity.id !== input.activityId
    || activity.entityType !== 'Cliente'
    || activity.entityId !== input.clientId
    || activity.actorId !== authorization.identity.actorId) {
    throw new Error('El contacto confirmado ya no coincide con este usuario o este lead.');
  }
  const client = visibleClients().find((item) => item.id === input.clientId) as ContactFollowUpClient | undefined;
  if (!client) throw new Error('El lead ya no está disponible para el usuario activo.');
  return client;
}

function clearFollowUp(input: FollowUpPersistenceInput): FollowUpPersistenceResult {
  const client = assertAuthorizedContact(input);
  const duplicate = !client.nextFollowUp && !client.nextAction;
  if (duplicate) return { client, date: null, duplicate: true };

  delete client.nextFollowUp;
  delete client.nextAction;
  delete client.whatsappFollowUpAttemptId;
  delete client.whatsappFollowUpActivityId;
  delete client.whatsappFollowUpChannel;
  saveData(`Seguimiento sin fecha: ${client.name}`);

  const persisted = verifiedClient(client.id, null);
  if (!persisted) throw new Error('El seguimiento no pudo confirmarse en el almacenamiento local.');
  return { client, date: null, duplicate: false };
}

export function persistFollowUpSelection(input: FollowUpPersistenceInput): FollowUpPersistenceResult {
  if (!input.attemptId || !Number.isFinite(input.activityId)) {
    throw new Error('El seguimiento perdió su referencia de contacto. Volvé a abrirlo.');
  }
  if (input.date !== null && !isValidCalendarDate(input.date)) {
    throw new Error('Elegí una fecha de seguimiento válida.');
  }

  const previous = structuredClone(state.crm);
  try {
    if (input.date === null) return clearFollowUp(input);
    const result = scheduleWhatsAppFollowUp(
      input.clientId,
      input.attemptId,
      input.activityId,
      input.date,
    );
    if (!result) throw new Error('No se pudo guardar el seguimiento porque cambió el permiso o la identidad activa.');
    const persisted = verifiedClient(input.clientId, input.date);
    if (!persisted) throw new Error('El seguimiento no pudo confirmarse en el almacenamiento local.');
    return { client: result.client, date: input.date, duplicate: result.duplicate };
  } catch (error) {
    rollback(previous);
    throw error;
  }
}
