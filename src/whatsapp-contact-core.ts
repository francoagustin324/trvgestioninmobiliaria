import { isHumanIdentityName } from './human-identity.js';
import type { Client } from './models.js';

export interface WhatsAppPhoneResult {
  valid: boolean;
  normalized: string;
  display: string;
  reason: string;
  kind: 'argentina' | 'international' | 'invalid' | 'ambiguous';
}

export interface FollowUpSuggestion {
  date: string;
  days: number | null;
  reason: string;
}

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
  return { valid: true, normalized: digits, display: `+${digits}`, reason: '', kind: 'international' };
}

function naturalIdentity(responsible: string, agency: string): string {
  const human = isHumanIdentityName(responsible, agency);
  if (human && agency) return `soy ${responsible} de ${agency}`;
  if (human) return `soy ${responsible}`;
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
  return interest
    ? `${greeting}, ${identity}. Te escribo por tu consulta sobre ${interest}. ¿Seguís buscando una propiedad con estas características?`
    : `${greeting}, ${identity}. Te escribo por tu consulta inmobiliaria. ¿Seguís buscando una propiedad?`;
}

export function whatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function localIsoDate(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addLocalDaysIso(days: number, now = new Date()): string {
  return localIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 12, 0, 0, 0));
}

function mediumTerm(client: Client): boolean {
  const value = `${client.purchaseTimeframe || ''} ${client.urgency || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /mediano|3\s*[-a]\s*6|6\s*[-a]\s*12|varios meses/.test(value);
}

function isNewLead(client: Client): boolean {
  const stage = String(client.pipeline || client.status || '').trim().toLowerCase();
  return stage === 'nuevo' || stage === 'lead';
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
  if (isNewLead(client) || !client.lastContact) {
    return { date: addLocalDaysIso(1, now), days: 1, reason: 'Lead nuevo o no contactado: seguimiento sugerido para mañana.' };
  }
  return { date: addLocalDaysIso(3, now), days: 3, reason: 'Lead activo: seguimiento sugerido en 3 días.' };
}
