import { applyCommercialCloseFromValues } from './commercial-close.js';
import { applyCommercialStage, normalizeCommercialStage } from './lead-pipeline.js';
import { Client, Temperature } from './models.js';
import { normalizePhone } from './phone-normalizer.js';
import { newSyncRecordMetadata } from './sync-identity.js';

const temperatures: Temperature[] = ['Caliente', 'Tibio', 'Frío'];
const essentialKeys: Array<keyof Client> = [
  'budget',
  'currency',
  'paymentMethod',
  'creditPossible',
  'creditApprovedAmount',
  'zones',
  'purpose',
  'purchaseTimeframe',
  'urgency',
  'canMoveForward',
  'knowsArea',
];

function clean(values: Record<string, string>, key: string): string {
  return (values[key] ?? '').trim();
}

function valueOrCurrent(values: Record<string, string>, key: keyof Client, current?: Client): string {
  const supplied = values[String(key)];
  if (supplied !== undefined) return supplied.trim();
  const existing = current?.[key];
  if (typeof existing === 'number') return String(existing);
  return typeof existing === 'string' ? existing : '';
}

function temperatureValue(value: string): Temperature {
  return temperatures.includes(value as Temperature) ? value as Temperature : 'Tibio';
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalNumber(value: string): number | undefined {
  const number = Number(value.trim());
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function essentialChanged(current: Client | null | undefined, next: Client): boolean {
  if (!current) return essentialKeys.some((key) => String(next[key] ?? '').trim());
  return essentialKeys.some((key) => String(current[key] ?? '').trim() !== String(next[key] ?? '').trim());
}

export function clientFromFormValues(id: number, values: Record<string, string>, current?: Client | null): Client {
  const client: Client = {
    ...(current || newSyncRecordMetadata()),
    id,
    name: clean(values, 'name'),
    phone: normalizePhone(clean(values, 'phone')),
    email: optional(valueOrCurrent(values, 'email', current ?? undefined)),
    interest: clean(values, 'interest'),
    status: valueOrCurrent(values, 'status', current ?? undefined) || 'Lead',
    temperature: temperatureValue(valueOrCurrent(values, 'temperature', current ?? undefined) || 'Tibio'),
    pipeline: normalizeCommercialStage(valueOrCurrent(values, 'pipeline', current ?? undefined) || 'Nuevo'),
    lastContact: optional(valueOrCurrent(values, 'lastContact', current ?? undefined)),
    nextFollowUp: optional(valueOrCurrent(values, 'nextFollowUp', current ?? undefined)),
    nextAction: optional(valueOrCurrent(values, 'nextAction', current ?? undefined)),
    budget: optional(valueOrCurrent(values, 'budget', current ?? undefined)),
    paymentMethod: optional(valueOrCurrent(values, 'paymentMethod', current ?? undefined)),
    purchaseTimeframe: optional(valueOrCurrent(values, 'purchaseTimeframe', current ?? undefined)),
    purpose: optional(valueOrCurrent(values, 'purpose', current ?? undefined)),
    knowsArea: optional(valueOrCurrent(values, 'knowsArea', current ?? undefined)),
    canMoveForward: optional(valueOrCurrent(values, 'canMoveForward', current ?? undefined)),
    objections: optional(valueOrCurrent(values, 'objections', current ?? undefined)),
    notes: optional(valueOrCurrent(values, 'notes', current ?? undefined)),
    zones: optional(valueOrCurrent(values, 'zones', current ?? undefined)),
    propertyType: optional(valueOrCurrent(values, 'propertyType', current ?? undefined)),
    operation: optional(valueOrCurrent(values, 'operation', current ?? undefined)),
    bedrooms: optionalNumber(valueOrCurrent(values, 'bedrooms', current ?? undefined)),
    currency: optional(valueOrCurrent(values, 'currency', current ?? undefined)),
    needsFinancing: optional(valueOrCurrent(values, 'needsFinancing', current ?? undefined)),
    creditPossible: optional(valueOrCurrent(values, 'creditPossible', current ?? undefined)),
    creditApprovedAmount: optional(valueOrCurrent(values, 'creditApprovedAmount', current ?? undefined)),
    urgency: optional(valueOrCurrent(values, 'urgency', current ?? undefined)),
    garage: optional(valueOrCurrent(values, 'garage', current ?? undefined)),
    patio: optional(valueOrCurrent(values, 'patio', current ?? undefined)),
    pool: optional(valueOrCurrent(values, 'pool', current ?? undefined)),
    requiresCreditReady: optional(valueOrCurrent(values, 'requiresCreditReady', current ?? undefined)),
    features: optional(valueOrCurrent(values, 'features', current ?? undefined)),
    preferences: optional(valueOrCurrent(values, 'preferences', current ?? undefined)),
    qualificationUpdatedAt: current?.qualificationUpdatedAt,
    assignedToId: current?.assignedToId,
    createdById: current?.createdById,
  };
  if (essentialChanged(current, client)) client.qualificationUpdatedAt = new Date().toISOString();
  return applyCommercialCloseFromValues(applyCommercialStage(client, client.pipeline), values, current);
}

export function upsertClient(clients: Client[], client: Client): Client[] {
  const index = clients.findIndex((item) => item.id === client.id);
  if (index === -1) return [...clients, client];
  const updated = [...clients];
  updated[index] = client;
  return updated;
}
