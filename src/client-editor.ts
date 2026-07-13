import { Client, Temperature } from './models.js';

const temperatures: Temperature[] = ['Caliente', 'Tibio', 'Frío'];

function clean(values: Record<string, string>, key: string): string {
  return (values[key] ?? '').trim();
}

function temperatureValue(value: string): Temperature {
  return temperatures.includes(value as Temperature) ? value as Temperature : 'Tibio';
}

export function clientFromFormValues(id: number, values: Record<string, string>): Client {
  return {
    id,
    name: clean(values, 'name'),
    phone: clean(values, 'phone'),
    email: clean(values, 'email'),
    interest: clean(values, 'interest'),
    status: clean(values, 'status'),
    temperature: temperatureValue(clean(values, 'temperature')),
    pipeline: clean(values, 'pipeline'),
    lastContact: clean(values, 'lastContact'),
    nextFollowUp: clean(values, 'nextFollowUp'),
    budget: clean(values, 'budget'),
    paymentMethod: clean(values, 'paymentMethod'),
    purchaseTimeframe: clean(values, 'purchaseTimeframe'),
    purpose: clean(values, 'purpose'),
    knowsArea: clean(values, 'knowsArea'),
    canMoveForward: clean(values, 'canMoveForward'),
    objections: clean(values, 'objections'),
    notes: clean(values, 'notes'),
  };
}

export function upsertClient(clients: Client[], client: Client): Client[] {
  const index = clients.findIndex((item) => item.id === client.id);
  if (index === -1) return [...clients, client];
  const updated = [...clients];
  updated[index] = client;
  return updated;
}
