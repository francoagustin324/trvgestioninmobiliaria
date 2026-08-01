import type { ActivityEntry, Client } from '../models.js';
import type { PendingWhatsAppAttempt } from '../whatsapp-contact.js';

export function createPendingWhatsAppAttempt(
  client: Client | undefined,
  phone: string,
  message: string,
  now?: Date,
): PendingWhatsAppAttempt;

export function registerWhatsAppContact(
  attempt: PendingWhatsAppAttempt,
  now?: Date,
): { activity: ActivityEntry; duplicate: boolean; client: Client } | null;

export function scheduleWhatsAppFollowUp(
  clientId: number,
  attemptId: string,
  activityId: number,
  date: string,
): { client: Client; duplicate: boolean } | null;
