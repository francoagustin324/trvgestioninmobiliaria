import type { Client } from './models.js';

function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '');
}

function stripInternationalDialingPrefix(value: string): string {
  return value.startsWith('00') ? value.slice(2) : value;
}

function removeArgentinaMobileMarker(value: string): string {
  if (value.length !== 12) return value;
  for (let areaLength = 2; areaLength <= 4; areaLength += 1) {
    if (value.slice(areaLength, areaLength + 2) === '15') {
      const withoutMarker = `${value.slice(0, areaLength)}${value.slice(areaLength + 2)}`;
      if (withoutMarker.length === 10) return withoutMarker;
    }
  }
  return value;
}

export function argentinaNationalNumber(value: string): string | null {
  let digits = stripInternationalDialingPrefix(digitsOnly(value));
  if (!digits) return null;

  if (digits.startsWith('549')) digits = digits.slice(3);
  else if (digits.startsWith('54')) {
    digits = digits.slice(2);
    if (digits.startsWith('9')) digits = digits.slice(1);
  }

  if (digits.startsWith('0')) digits = digits.slice(1);
  digits = removeArgentinaMobileMarker(digits);

  return digits.length === 10 ? digits : null;
}

export function normalizePhone(value: string): string {
  const digits = stripInternationalDialingPrefix(digitsOnly(value));
  const national = argentinaNationalNumber(value);
  return national ? `549${national}` : digits;
}

export function phoneIdentity(value: string): string {
  const national = argentinaNationalNumber(value);
  return national ?? stripInternationalDialingPrefix(digitsOnly(value));
}

export function isPlausiblePhone(value: string): boolean {
  const identity = phoneIdentity(value);
  return identity.length >= 8 && identity.length <= 15;
}

export function formatPhone(value: string): string {
  const national = argentinaNationalNumber(value);
  return national ? `+54 9 ${national}` : value.trim();
}

export function findDuplicateClient(clients: Client[], phone: string, excludeId: number | null = null): Client | null {
  const identity = phoneIdentity(phone);
  if (!identity || !isPlausiblePhone(phone)) return null;
  return clients.find((client) => client.id !== excludeId && phoneIdentity(client.phone) === identity) ?? null;
}
