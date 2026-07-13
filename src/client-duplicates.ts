import type { Client, Temperature } from './models.js';
import { isPlausiblePhone, normalizePhone, phoneIdentity } from './phone-normalizer.js';

export interface DuplicateClientGroup {
  identity: string;
  clients: Client[];
}

export interface ClientMergeResult {
  clients: Client[];
  mergedClient: Client;
  removedIds: number[];
}

interface ClientMergeBackup {
  createdAt: string;
  clients: Client[];
}

const CLIENT_MERGE_BACKUP_KEY = 'propcontrol-client-merge-backup-v1';
const temperatureOrder: Record<Temperature, number> = { Frío: 0, Tibio: 1, Caliente: 2 };

const fillableKeys: Array<keyof Client> = [
  'email',
  'interest',
  'status',
  'pipeline',
  'budget',
  'paymentMethod',
  'purchaseTimeframe',
  'purpose',
  'knowsArea',
  'canMoveForward',
  'objections',
];

const auditLabels: Array<[keyof Client, string]> = [
  ['email', 'Email'],
  ['interest', 'Búsqueda'],
  ['status', 'Estado'],
  ['temperature', 'Temperatura'],
  ['pipeline', 'Etapa'],
  ['lastContact', 'Último contacto'],
  ['nextFollowUp', 'Próximo seguimiento'],
  ['budget', 'Presupuesto'],
  ['paymentMethod', 'Forma de pago'],
  ['purchaseTimeframe', 'Plazo de compra'],
  ['purpose', 'Motivo'],
  ['knowsArea', 'Conoce la zona'],
  ['canMoveForward', 'Puede avanzar'],
  ['objections', 'Objeciones'],
  ['notes', 'Observaciones'],
];

function textValue(value: unknown): string {
  return String(value ?? '').trim();
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = textValue(value);
    const identity = cleaned.toLocaleLowerCase('es');
    if (!cleaned || seen.has(identity)) continue;
    seen.add(identity);
    result.push(cleaned);
  }
  return result;
}

function latestDate(values: Array<string | undefined>): string | undefined {
  return uniqueNonEmpty(values).sort((a, b) => b.localeCompare(a))[0];
}

function earliestDate(values: Array<string | undefined>): string | undefined {
  return uniqueNonEmpty(values).sort((a, b) => a.localeCompare(b))[0];
}

function hottestTemperature(clients: Client[]): Temperature {
  return [...clients].sort((a, b) => temperatureOrder[b.temperature] - temperatureOrder[a.temperature])[0]?.temperature ?? 'Tibio';
}

function auditEntry(client: Client): string {
  const details = auditLabels
    .map(([key, label]) => {
      const value = textValue(client[key]);
      return value ? `${label}: ${value}` : '';
    })
    .filter(Boolean)
    .join(' | ');
  const heading = `[Registro fusionado: ${textValue(client.name) || 'Sin nombre'} · ${textValue(client.phone) || 'Sin teléfono'}]`;
  return details ? `${heading}\n${details}` : heading;
}

export function clientCompletenessScore(client: Client): number {
  const fields: Array<keyof Client> = [
    'name', 'phone', 'email', 'interest', 'status', 'temperature', 'pipeline', 'lastContact',
    'nextFollowUp', 'budget', 'paymentMethod', 'purchaseTimeframe', 'purpose', 'knowsArea',
    'canMoveForward', 'objections', 'notes',
  ];
  return fields.reduce((score, key) => score + (textValue(client[key]) ? 1 : 0), 0);
}

export function findHistoricalDuplicateGroups(clients: Client[]): DuplicateClientGroup[] {
  const groups = new Map<string, Client[]>();
  for (const client of clients) {
    if (!isPlausiblePhone(client.phone)) continue;
    const identity = phoneIdentity(client.phone);
    if (!identity) continue;
    const group = groups.get(identity) ?? [];
    group.push(client);
    groups.set(identity, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([identity, group]) => ({ identity, clients: [...group] }))
    .sort((a, b) => b.clients.length - a.clients.length || a.identity.localeCompare(b.identity));
}

export function recommendedPrimaryClient(group: DuplicateClientGroup): Client {
  return [...group.clients].sort((a, b) => {
    return clientCompletenessScore(b) - clientCompletenessScore(a)
      || textValue(b.lastContact).localeCompare(textValue(a.lastContact))
      || a.id - b.id;
  })[0] as Client;
}

export function mergeDuplicateClients(clients: Client[], primaryId: number): ClientMergeResult {
  const primary = clients.find((client) => client.id === primaryId);
  if (!primary) throw new Error('No se encontró el cliente principal.');

  const identity = phoneIdentity(primary.phone);
  const group = clients.filter((client) => isPlausiblePhone(client.phone) && phoneIdentity(client.phone) === identity);
  if (!identity || group.length < 2) throw new Error('El cliente seleccionado ya no tiene duplicados.');

  const duplicates = group.filter((client) => client.id !== primaryId);
  const sources = [...duplicates].sort((a, b) => clientCompletenessScore(b) - clientCompletenessScore(a));
  const merged: Client = { ...primary, phone: normalizePhone(primary.phone) };
  const writable = merged as unknown as Record<string, string | number | undefined>;

  for (const key of fillableKeys) {
    if (textValue(merged[key])) continue;
    const replacement = sources.map((client) => textValue(client[key])).find(Boolean);
    if (replacement) writable[key] = replacement;
  }

  merged.temperature = hottestTemperature(group);
  merged.lastContact = latestDate(group.map((client) => client.lastContact));
  merged.nextFollowUp = earliestDate(group.map((client) => client.nextFollowUp));
  merged.objections = uniqueNonEmpty(group.map((client) => client.objections)).join(' · ') || undefined;
  merged.notes = uniqueNonEmpty([
    primary.notes,
    ...duplicates.map(auditEntry),
  ]).join('\n\n') || undefined;

  const removedIds = duplicates.map((client) => client.id);
  const result = clients
    .filter((client) => !removedIds.includes(client.id))
    .map((client) => client.id === primaryId ? merged : client);

  return { clients: result, mergedClient: merged, removedIds };
}

export function saveClientMergeBackup(clients: Client[]): void {
  const backup: ClientMergeBackup = { createdAt: new Date().toISOString(), clients: structuredClone(clients) };
  localStorage.setItem(CLIENT_MERGE_BACKUP_KEY, JSON.stringify(backup));
}

export function hasClientMergeBackup(): boolean {
  try {
    const backup = JSON.parse(localStorage.getItem(CLIENT_MERGE_BACKUP_KEY) ?? '') as Partial<ClientMergeBackup>;
    return Array.isArray(backup.clients) && Boolean(backup.createdAt);
  } catch {
    return false;
  }
}

export function restoreClientMergeBackup(): Client[] | null {
  try {
    const backup = JSON.parse(localStorage.getItem(CLIENT_MERGE_BACKUP_KEY) ?? '') as Partial<ClientMergeBackup>;
    if (!Array.isArray(backup.clients)) return null;
    localStorage.removeItem(CLIENT_MERGE_BACKUP_KEY);
    return backup.clients as Client[];
  } catch {
    return null;
  }
}
