import type { ActivityEntry, Client, DealCurrency } from './models.js';

export const LEAD_SOURCES = [
  'Meta Ads',
  'Instagram orgánico',
  'Facebook orgánico',
  'WhatsApp',
  'Zonaprop',
  'Mercado Libre',
  'Referido',
  'Cliente anterior',
  'Cartel',
  'Colega / inmobiliaria',
  'Web',
  'Llamada',
  'Captación propia',
  'Otro',
] as const;

export type LeadSource = typeof LEAD_SOURCES[number];
export type LeadSourceFilter = LeadSource | 'Origen no informado' | 'Todas';

export interface LeadSourceSummaryRow {
  source: LeadSource | 'Origen no informado';
  leads: number;
  won: number;
  lost: number;
  closedValueByCurrency: Partial<Record<DealCurrency, number>>;
  commissionByCurrency: Partial<Record<DealCurrency, number>>;
}

declare module './models.js' {
  interface Client {
    leadSource?: LeadSource;
    leadSourceDetail?: string;
    leadCampaign?: string;
    reactivationSnoozedUntil?: string;
  }
}

function hasOwn(values: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(values, key);
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  const compact = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  return compact.slice(0, maxLength);
}

export function isLeadSource(value: unknown): value is LeadSource {
  return LEAD_SOURCES.includes(String(value ?? '') as LeadSource);
}

export function validateLeadSourceSelection(
  values: Record<string, string>,
  current?: Client | null,
): { ok: true } | { ok: false; field: 'leadSource' | 'leadSourceDetail'; message: string } {
  const rawSource = hasOwn(values, 'leadSource') ? values.leadSource?.trim() || '' : current?.leadSource || '';
  if (!rawSource) {
    if (current) return { ok: true };
    return { ok: false, field: 'leadSource', message: 'Elegí el origen comercial del lead.' };
  }
  if (!isLeadSource(rawSource)) {
    return { ok: false, field: 'leadSource', message: 'Elegí un origen válido.' };
  }
  const detail = hasOwn(values, 'leadSourceDetail')
    ? cleanText(values.leadSourceDetail, 120)
    : cleanText(current?.leadSourceDetail, 120);
  if (rawSource === 'Otro' && !detail) {
    return { ok: false, field: 'leadSourceDetail', message: 'Detallá el origen cuando elegís Otro.' };
  }
  return { ok: true };
}

export function applyLeadSourceMetadata(
  client: Client,
  values: Record<string, string>,
  current?: Client | null,
): Client {
  const explicitSource = hasOwn(values, 'leadSource');
  const rawSource = explicitSource ? values.leadSource?.trim() || '' : current?.leadSource || '';
  if (explicitSource && rawSource && !isLeadSource(rawSource)) throw new Error('Origen de lead inválido.');
  if (explicitSource && !current && !rawSource) throw new Error('El origen del lead es obligatorio.');

  const leadSource = isLeadSource(rawSource) ? rawSource : undefined;
  const leadSourceDetail = hasOwn(values, 'leadSourceDetail')
    ? cleanText(values.leadSourceDetail, 120)
    : cleanText(current?.leadSourceDetail, 120);
  const leadCampaign = hasOwn(values, 'leadCampaign')
    ? cleanText(values.leadCampaign, 100)
    : cleanText(current?.leadCampaign, 100);

  if (explicitSource && leadSource === 'Otro' && !leadSourceDetail) {
    throw new Error('El detalle del origen es obligatorio cuando elegís Otro.');
  }

  return {
    ...client,
    leadSource,
    leadSourceDetail,
    leadCampaign,
  };
}

export function leadSourceDisplay(client: Pick<Client, 'leadSource' | 'leadSourceDetail' | 'leadCampaign'>): string {
  if (!client.leadSource) return 'Origen no informado';
  const context = cleanText(client.leadCampaign, 100) || cleanText(client.leadSourceDetail, 120);
  return context ? `${client.leadSource} · ${context}` : client.leadSource;
}

export function leadSourceSignature(client: Pick<Client, 'leadSource' | 'leadSourceDetail' | 'leadCampaign'>): string {
  return [client.leadSource || '', cleanText(client.leadSourceDetail, 120) || '', cleanText(client.leadCampaign, 100) || ''].join('|');
}

export function leadSourceChangeActivity(
  previous: Client | null,
  next: Client,
): Omit<ActivityEntry, 'id' | 'actorId' | 'createdAt'> | null {
  if (!previous || leadSourceSignature(previous) === leadSourceSignature(next)) return null;
  return {
    action: 'Origen del lead actualizado',
    entityType: 'Cliente',
    entityId: next.id,
    entityUid: next.uid,
    detail: `${leadSourceDisplay(previous)} → ${leadSourceDisplay(next)}`,
  };
}

export function leadSourceMatchesFilter(client: Client, filter: LeadSourceFilter): boolean {
  if (filter === 'Todas') return true;
  if (filter === 'Origen no informado') return !client.leadSource;
  return client.leadSource === filter;
}

function normalized(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function outcomeKind(client: Client): 'won' | 'lost' | 'active' {
  if (client.outcome === 'won') return 'won';
  if (client.outcome === 'lost') return 'lost';
  const stage = normalized(client.pipeline);
  if (stage.includes('ganad') || stage === 'cerrado' || stage === 'cerrada') return 'won';
  if (stage.includes('perdid')) return 'lost';
  return 'active';
}

function addCurrency(
  bucket: Partial<Record<DealCurrency, number>>,
  currency: DealCurrency | undefined,
  amount: number | undefined,
): void {
  if (!currency || !Number.isFinite(amount) || Number(amount) <= 0) return;
  bucket[currency] = (bucket[currency] || 0) + Number(amount);
}

export function leadSourceSummary(clients: Client[]): LeadSourceSummaryRow[] {
  const rows = new Map<LeadSource | 'Origen no informado', LeadSourceSummaryRow>();
  for (const client of clients) {
    const source = client.leadSource || 'Origen no informado';
    const row = rows.get(source) || {
      source,
      leads: 0,
      won: 0,
      lost: 0,
      closedValueByCurrency: {},
      commissionByCurrency: {},
    };
    row.leads += 1;
    const outcome = outcomeKind(client);
    if (outcome === 'won') {
      row.won += 1;
      addCurrency(row.closedValueByCurrency, client.dealCurrency, client.dealAmount);
      addCurrency(row.commissionByCurrency, client.commissionCurrency, client.commissionAmount);
    } else if (outcome === 'lost') {
      row.lost += 1;
    }
    rows.set(source, row);
  }

  const order = new Map<string, number>(LEAD_SOURCES.map((source, index) => [source, index]));
  return [...rows.values()].sort((left, right) => {
    const leftOrder = left.source === 'Origen no informado' ? LEAD_SOURCES.length : order.get(left.source) ?? LEAD_SOURCES.length + 1;
    const rightOrder = right.source === 'Origen no informado' ? LEAD_SOURCES.length : order.get(right.source) ?? LEAD_SOURCES.length + 1;
    return leftOrder - rightOrder;
  });
}
