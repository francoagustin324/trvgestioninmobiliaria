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

export function clientFromFormValues(id: number, values: Record<string, string>, current?: Client | null): Client {
  return {
    id,
    name: clean(values, 'name'),
    phone: normalizePhone(clean(values, 'phone')),
    email: valueOrCurrent(values, 'email', current ?? undefined),
    interest: clean(values, 'interest'),
    status: valueOrCurrent(values, 'status', current ?? undefined) || 'Lead',
    temperature: temperatureValue(valueOrCurrent(values, 'temperature', current ?? undefined) || 'Tibio'),
    pipeline: valueOrCurrent(values, 'pipeline', current ?? undefined) || 'Nuevo',
    lastContact: valueOrCurrent(values, 'lastContact', current ?? undefined),
    nextFollowUp: valueOrCurrent(values, 'nextFollowUp', current ?? undefined),
    budget: clean(values, 'budget'),
    paymentMethod: valueOrCurrent(values, 'paymentMethod', current ?? undefined),
    purchaseTimeframe: valueOrCurrent(values, 'purchaseTimeframe', current ?? undefined),
    purpose: valueOrCurrent(values, 'purpose', current ?? undefined),
    knowsArea: valueOrCurrent(values, 'knowsArea', current ?? undefined),
    canMoveForward: valueOrCurrent(values, 'canMoveForward', current ?? undefined),
    objections: valueOrCurrent(values, 'objections', current ?? undefined),
    notes: valueOrCurrent(values, 'notes', current ?? undefined),
    assignedToId: current?.assignedToId,
    createdById: current?.createdById,
  };
}

export function upsertClient(clients: Client[], client: Client): Client[] {
  const index = clients.findIndex((item) => item.id === client.id);
  if (index === -1) return [...clients, client];
  const updated = [...clients];
  updated[index] = client;
  return updated;
}