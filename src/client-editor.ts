import { applyCommercialStage, normalizeCommercialStage } from './lead-pipeline.js';
import { Client, Temperature } from './models.js';
import { normalizePhone } from './phone-normalizer.js';

const temperatures: Temperature[] = ['Caliente', 'Tibio', 'Frío'];

function clean(values: Record<string, string>, key: string): string {
  return (values[key] ?? '').trim();
}

function valueOrCurrent(values: Record<string, string>, key: keyof Client, current?: Client): string {
  const supplied = values[String(key)];
  if (supplied !== undefined) return supplied.trim();
  const existing = current?.[key];
  return typeof existing === 'string' ? existing : '';
}

function temperatureValue(value: string): Temperature {
  return temperatures.includes(value as Temperature) ? value as Temperature : 'Tibio';
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function clientFromFormValues(id: number, values: Record<string, string>, current?: Client | null): Client {
  const client: Client = {
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
    assignedToId: current?.assignedToId,
    createdById: current?.createdById,
  };
  return applyCommercialStage(client, client.pipeline);
}

export function upsertClient(clients: Client[], client: Client): Client[] {
  const index = clients.findIndex((item) => item.id === client.id);
  if (index === -1) return [...clients, client];
  const updated = [...clients];
  updated[index] = client;
  return updated;
}
