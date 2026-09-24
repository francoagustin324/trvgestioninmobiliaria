import type { Client } from './models.js';

export function normalizeLeadEmail(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

export function findDuplicateClientByEmail(
  clients: Client[],
  email: string,
  excludeId: number | null = null,
): Client | null {
  const identity = normalizeLeadEmail(email);
  if (!identity) return null;
  return clients.find((client) => (
    client.id !== excludeId
    && normalizeLeadEmail(client.email || '') === identity
  )) ?? null;
}
