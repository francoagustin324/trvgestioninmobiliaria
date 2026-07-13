import type { Client, Temperature } from './models.js';
import { phoneIdentity } from './phone-normalizer.js';

export type FollowUpFilter = 'Todos' | 'Vencidos' | 'Hoy' | 'Próximos' | 'Sin fecha';
export type ClientSort = 'Seguimiento urgente' | 'Último contacto' | 'Nombre A-Z' | 'Temperatura';

export interface ClientListFilters {
  query: string;
  temperature: 'Todas' | Temperature;
  pipeline: string;
  followUp: FollowUpFilter;
  sort: ClientSort;
}

const temperatureOrder: Record<Temperature, number> = { Caliente: 0, Tibio: 1, Frío: 2 };
const terminalPipelines = new Set(['Cerrado', 'Perdido']);

export function defaultClientListFilters(): ClientListFilters {
  return {
    query: '',
    temperature: 'Todas',
    pipeline: 'Todas',
    followUp: 'Todos',
    sort: 'Seguimiento urgente',
  };
}

function normalizedText(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function searchableText(client: Client): string {
  return normalizedText([
    client.name,
    client.phone,
    phoneIdentity(client.phone),
    client.email,
    client.interest,
    client.status,
    client.temperature,
    client.pipeline,
    client.budget,
    client.paymentMethod,
    client.purchaseTimeframe,
    client.purpose,
    client.objections,
    client.notes,
  ].join(' '));
}

function matchesFollowUp(client: Client, filter: FollowUpFilter, today: string): boolean {
  if (filter === 'Todos') return true;
  const date = client.nextFollowUp?.trim() ?? '';
  if (filter === 'Sin fecha') return !date;
  if (!date) return false;
  if (filter === 'Vencidos') return date < today;
  if (filter === 'Hoy') return date === today;
  return date > today;
}

function followUpRank(client: Client, today: string): number {
  if (terminalPipelines.has(client.pipeline)) return 5;
  const date = client.nextFollowUp?.trim() ?? '';
  if (!date) return 4;
  if (date < today) return 0;
  if (date === today) return 1;
  return 2;
}

function compareOptionalDate(left: string | undefined, right: string | undefined, direction: 'asc' | 'desc'): number {
  const a = left?.trim() ?? '';
  const b = right?.trim() ?? '';
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
}

export function filterAndSortClients(clients: Client[], filters: ClientListFilters, today: string): Client[] {
  const query = normalizedText(filters.query);
  return clients
    .filter((client) => !query || searchableText(client).includes(query))
    .filter((client) => filters.temperature === 'Todas' || client.temperature === filters.temperature)
    .filter((client) => filters.pipeline === 'Todas' || client.pipeline === filters.pipeline)
    .filter((client) => matchesFollowUp(client, filters.followUp, today))
    .map((client, index) => ({ client, index }))
    .sort((left, right) => {
      const a = left.client;
      const b = right.client;
      let result = 0;
      if (filters.sort === 'Nombre A-Z') result = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      if (filters.sort === 'Temperatura') result = temperatureOrder[a.temperature] - temperatureOrder[b.temperature];
      if (filters.sort === 'Último contacto') result = compareOptionalDate(a.lastContact, b.lastContact, 'desc');
      if (filters.sort === 'Seguimiento urgente') {
        result = followUpRank(a, today) - followUpRank(b, today)
          || compareOptionalDate(a.nextFollowUp, b.nextFollowUp, 'asc')
          || temperatureOrder[a.temperature] - temperatureOrder[b.temperature];
      }
      return result || left.index - right.index;
    })
    .map(({ client }) => client);
}
