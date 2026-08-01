import type { Client } from '../models.js';
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
): { duplicate: boolean } | null;
