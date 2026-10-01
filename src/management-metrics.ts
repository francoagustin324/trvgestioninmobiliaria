import type { TenantScope } from './active-organization.js';
import {
  firstValidCommercialAttentionAt,
  leadCreatedAt,
  validCommercialAttention,
} from './commercial-alert-engine.js';
import { COMMERCIAL_STAGES, commercialStage, localIsoDate } from './lead-pipeline.js';
import type {
  ActivityEntry,
  Client,
  CommercialStage,
  CrmData,
  DealCurrency,
  Property,
  TeamMember,
} from './models.js';
import { roleCanAccessModule } from './team-policy.js';

export type ManagementPeriodKey = 'today' | 'last7' | 'last30' | 'thisMonth';

export interface ManagementDateRange {
  key: ManagementPeriodKey;
  label: string;
  fromDate: string;
  toDate: string;
}

export interface ManagementScorecard {
  leadsReceived: number;
  leadsAttended: number;
  firstResponseMedianMinutes: number | null;
  firstResponseSample: number;
  visitsScheduled: number;
  visitsCompleted: number;
  offers: number;
  reservations: number;
  closures: number;
  conversionPct: number;
  commissions: Record<DealCurrency, number>;
}

export interface ManagementFunnelStep {
  key: 'leads' | 'visits' | 'offers' | 'reservations' | 'closures';
  label: string;
  count: number;
  conversionFromPreviousPct: number | null;
}

export interface ManagementTeamRow {
  memberId: number;
  name: string;
  leads: number;
  attended: number;
  firstResponseMedianMinutes: number | null;
  visits: number;
  offers: number;
  reservations: number;
  closures: number;
  conversionPct: number;
}

export interface ManagementSourceRow {
  source: string;
  leads: number;
  visits: number;
  offers: number;
  reservations: number;
  closures: number;
  conversionPct: number;
}

export interface ManagementPipelineRow {
  stage: CommercialStage;
  count: number;
}

export interface ManagementPropertyReview {
  propertyId: number;
  label: string;
  reasons: string[];
  daysWithoutActivity: number | null;
}

export interface ManagementMetrics {
  organizationId: string;
  period: ManagementDateRange;
  brokerId: number | null;
  scorecard: ManagementScorecard;
  funnel: ManagementFunnelStep[];
  team: ManagementTeamRow[];
  sources: ManagementSourceRow[];
  pipeline: ManagementPipelineRow[];
  propertyReviews: ManagementPropertyReview[];
  dataQuality: {
    firstResponseComplete: boolean;
    firstResponseNote: string | null;
  };
}

export interface BuildManagementMetricsInput {
  crm: CrmData;
  scope: TenantScope;
  period: ManagementPeriodKey;
  brokerId?: number | null;
  now?: Date;
}

const DAY_MS = 86_400_000;

function managementError(code: string): never {
  throw new Error(code);
}

export function resolveManagementMember(crm: CrmData, scope: TenantScope): TeamMember {
  if (crm.organization.id !== scope.organizationId) managementError('MANAGEMENT_TENANT_MISMATCH');
  const sameUser = crm.teamMembers.filter((member) => member.userId === scope.userId);
  const active = sameUser.filter((member) => member.status === 'Activo');
  if (active.length !== 1) {
    if (active.length > 1) managementError('MANAGEMENT_MEMBERSHIP_AMBIGUOUS');
    if (sameUser.some((member) => member.status === 'Suspendido')) managementError('MANAGEMENT_MEMBER_SUSPENDED');
    managementError('MANAGEMENT_MEMBERSHIP_REQUIRED');
  }
  const member = active[0]!;
  if (!roleCanAccessModule(member.role, 'reportes')) managementError('MANAGEMENT_FORBIDDEN');
  return member;
}

function atLocalNoon(value: Date): Date {
  const copy = new Date(value);
  copy.setHours(12, 0, 0, 0);
  return copy;
}

function addDays(value: Date, days: number): Date {
  const copy = atLocalNoon(value);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function managementDateRange(period: ManagementPeriodKey, now = new Date()): ManagementDateRange {
  const anchor = atLocalNoon(now);
  const toDate = localIsoDate(anchor);
  if (period === 'today') return { key: period, label: 'Hoy', fromDate: toDate, toDate };
  if (period === 'last7') return { key: period, label: 'Últimos 7 días', fromDate: localIsoDate(addDays(anchor, -6)), toDate };
  if (period === 'last30') return { key: period, label: 'Últimos 30 días', fromDate: localIsoDate(addDays(anchor, -29)), toDate };
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12, 0, 0, 0);
  return { key: period, label: 'Este mes', fromDate: localIsoDate(first), toDate };
}

function localDateOf(value: string | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : localIsoDate(parsed);
}

function inRange(value: string | undefined, range: ManagementDateRange): boolean {
  const date = localDateOf(value);
  return Boolean(date && date >= range.fromDate && date <= range.toDate);
}

function normalized(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function percentage(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const value = ordered.length % 2
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
  return Math.round(value);
}

function activityMap(activityLog: readonly ActivityEntry[]): Map<number, ActivityEntry[]> {
  const result = new Map<number, ActivityEntry[]>();
  for (const entry of activityLog) {
    if (entry.entityType !== 'Cliente' || !Number.isFinite(entry.entityId)) continue;
    const list = result.get(entry.entityId!) ?? [];
    list.push(entry);
    result.set(entry.entityId!, list);
  }
  return result;
}

function won(client: Client): boolean {
  return client.outcome === 'won' || commercialStage(client) === 'Ganado';
}

function closureAt(client: Client, activities: readonly ActivityEntry[]): string | undefined {
  if (client.closedAt) return client.closedAt;
  return activities
    .filter((entry) => entry.action === 'Operación ganada')
    .map((entry) => entry.createdAt)
    .filter(Boolean)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
}

function activeProperty(property: Property): boolean {
  const status = normalized(property.status);
  return status === 'activa' || status === 'activo' || status.includes('disponible');
}

function propertyLabel(property: Property): string {
  return property.title?.trim() || property.address?.trim() || `Propiedad #${property.id}`;
}

function daysSince(value: string | undefined, now: Date): number | null {
  const date = localDateOf(value);
  if (!date) return null;
  const base = new Date(`${date}T12:00:00`);
  const today = new Date(`${localIsoDate(now)}T12:00:00`);
  const delta = Math.floor((today.getTime() - base.getTime()) / DAY_MS);
  return Number.isFinite(delta) ? Math.max(0, delta) : null;
}

interface MutableRow {
  leads: number;
  attended: number;
  response: number[];
  visits: number;
  offers: number;
  reservations: number;
  closures: number;
}

function emptyMutable(): MutableRow {
  return { leads: 0, attended: 0, response: [], visits: 0, offers: 0, reservations: 0, closures: 0 };
}

interface MutableSource {
  leads: number;
  visits: number;
  offers: number;
  reservations: number;
  closures: number;
}

function emptySource(): MutableSource {
  return { leads: 0, visits: 0, offers: 0, reservations: 0, closures: 0 };
}

export function buildManagementMetrics(input: BuildManagementMetricsInput): ManagementMetrics {
  resolveManagementMember(input.crm, input.scope);
  const now = input.now ?? new Date();
  const period = managementDateRange(input.period, now);
  const brokerId = input.brokerId ?? null;
  if (brokerId !== null && !input.crm.teamMembers.some((member) => member.id === brokerId && member.status === 'Activo')) {
    managementError('MANAGEMENT_BROKER_FILTER_INVALID');
  }

  const matchesBroker = (assignedToId: number | undefined): boolean => brokerId === null || assignedToId === brokerId;
  const activitiesByClient = activityMap(input.crm.activityLog);
  const clientsById = new Map(input.crm.clients.map((client) => [client.id, client] as const));
  const selectedClients = input.crm.clients.filter((client) => matchesBroker(client.assignedToId));
  const teamMutable = new Map<number, MutableRow>();
  for (const member of input.crm.teamMembers) {
    if (member.status === 'Activo') teamMutable.set(member.id, emptyMutable());
  }
  const sources = new Map<string, MutableSource>();
  const sourceOf = (client: Client | undefined): string => client?.leadSource || 'Origen no informado';
  const sourceRow = (client: Client | undefined): MutableSource => {
    const source = sourceOf(client);
    const row = sources.get(source) ?? emptySource();
    if (!sources.has(source)) sources.set(source, row);
    return row;
  };

  let leadsReceived = 0;
  let leadsAttended = 0;
  const responseSamples: number[] = [];
  const pipelineCount = new Map<CommercialStage, number>(COMMERCIAL_STAGES.map((stage) => [stage, 0]));

  for (const client of selectedClients) {
    const stage = commercialStage(client);
    pipelineCount.set(stage, (pipelineCount.get(stage) ?? 0) + 1);
    const activities = activitiesByClient.get(client.id) ?? [];
    const createdAt = leadCreatedAt(client, activities);
    if (!inRange(createdAt, period)) continue;

    leadsReceived += 1;
    const team = client.assignedToId ? teamMutable.get(client.assignedToId) : undefined;
    if (team) team.leads += 1;
    sourceRow(client).leads += 1;

    if (validCommercialAttention(client, activities)) {
      leadsAttended += 1;
      if (team) team.attended += 1;
    }
    const responseAt = firstValidCommercialAttentionAt(client, activities);
    if (createdAt && responseAt) {
      const delta = Date.parse(responseAt) - Date.parse(createdAt);
      if (Number.isFinite(delta) && delta >= 0) {
        const minutes = Math.round(delta / 60_000);
        responseSamples.push(minutes);
        if (team) team.response.push(minutes);
      }
    }
  }

  let visitsScheduled = 0;
  let visitsCompleted = 0;
  for (const visit of input.crm.visits) {
    if (!matchesBroker(visit.assignedToId) || !inRange(visit.scheduledAt, period)) continue;
    if (visit.status === 'Coordinada') visitsScheduled += 1;
    if (visit.status === 'Realizada') {
      visitsCompleted += 1;
      const team = teamMutable.get(visit.assignedToId);
      if (team) team.visits += 1;
      sourceRow(clientsById.get(visit.clientId)).visits += 1;
    }
  }

  let offers = 0;
  for (const offer of input.crm.offers) {
    if (!matchesBroker(offer.assignedToId) || !inRange(offer.createdAt, period)) continue;
    offers += 1;
    const team = teamMutable.get(offer.assignedToId);
    if (team) team.offers += 1;
    sourceRow(clientsById.get(offer.clientId)).offers += 1;
  }

  let reservations = 0;
  for (const reservation of input.crm.reservations) {
    if (!matchesBroker(reservation.assignedToId) || !inRange(reservation.createdAt || reservation.reservedAt, period)) continue;
    reservations += 1;
    const team = teamMutable.get(reservation.assignedToId);
    if (team) team.reservations += 1;
    sourceRow(clientsById.get(reservation.clientId)).reservations += 1;
  }

  let closures = 0;
  const commissions: Record<DealCurrency, number> = { USD: 0, ARS: 0 };
  for (const client of selectedClients) {
    if (!won(client)) continue;
    const closedAt = closureAt(client, activitiesByClient.get(client.id) ?? []);
    if (!inRange(closedAt, period)) continue;
    closures += 1;
    const team = client.assignedToId ? teamMutable.get(client.assignedToId) : undefined;
    if (team) team.closures += 1;
    sourceRow(client).closures += 1;
    if (client.commissionCurrency && Number.isFinite(client.commissionAmount) && Number(client.commissionAmount) > 0) {
      commissions[client.commissionCurrency] += Number(client.commissionAmount);
    }
  }

  const team = input.crm.teamMembers
    .filter((member) => member.status === 'Activo' && (brokerId === null || member.id === brokerId))
    .map((member): ManagementTeamRow => {
      const row = teamMutable.get(member.id) ?? emptyMutable();
      return {
        memberId: member.id,
        name: member.name,
        leads: row.leads,
        attended: row.attended,
        firstResponseMedianMinutes: median(row.response),
        visits: row.visits,
        offers: row.offers,
        reservations: row.reservations,
        closures: row.closures,
        conversionPct: percentage(row.closures, row.leads),
      };
    })
    .sort((left, right) => (
      right.closures - left.closures
      || (right.visits + right.offers + right.reservations + right.attended) - (left.visits + left.offers + left.reservations + left.attended)
      || left.name.localeCompare(right.name, 'es-AR')
      || left.memberId - right.memberId
    ));

  const sourceRows = [...sources.entries()]
    .map(([source, row]): ManagementSourceRow => ({
      source,
      ...row,
      conversionPct: percentage(row.closures, row.leads),
    }))
    .sort((left, right) => right.closures - left.closures || right.leads - left.leads || left.source.localeCompare(right.source, 'es-AR'));

  const latestPropertyActivity = new Map<number, string>();
  const visitCount = new Map<number, number>();
  const offerCount = new Map<number, number>();
  const registerPropertyActivity = (propertyId: number, value: string | undefined): void => {
    if (!value) return;
    const current = latestPropertyActivity.get(propertyId);
    if (!current || Date.parse(value) > Date.parse(current)) latestPropertyActivity.set(propertyId, value);
  };
  for (const visit of input.crm.visits) {
    visitCount.set(visit.propertyId, (visitCount.get(visit.propertyId) ?? 0) + 1);
    registerPropertyActivity(visit.propertyId, visit.scheduledAt);
  }
  for (const offer of input.crm.offers) {
    offerCount.set(offer.propertyId, (offerCount.get(offer.propertyId) ?? 0) + 1);
    registerPropertyActivity(offer.propertyId, offer.updatedAt || offer.createdAt);
  }
  for (const reservation of input.crm.reservations) {
    registerPropertyActivity(reservation.propertyId, reservation.updatedAt || reservation.createdAt || reservation.reservedAt);
  }

  const propertyReviews = input.crm.properties
    .filter((property) => activeProperty(property) && matchesBroker(property.assignedToId))
    .map((property): ManagementPropertyReview | null => {
      const visits = visitCount.get(property.id) ?? 0;
      const propertyOffers = offerCount.get(property.id) ?? 0;
      const fallbackCreated = (property as Property & { createdAt?: string }).createdAt || property.sharedAt;
      const latest = latestPropertyActivity.get(property.id) || fallbackCreated;
      const inactivity = daysSince(latest, now);
      const reasons: string[] = [];
      if (visits === 0) reasons.push('Sin visitas registradas');
      if (visits > 0 && propertyOffers === 0) reasons.push('Tiene visitas pero ninguna oferta');
      if (inactivity !== null && inactivity >= 30) reasons.push(`Lleva ${inactivity} días sin actividad comercial`);
      return reasons.length ? {
        propertyId: property.id,
        label: propertyLabel(property),
        reasons,
        daysWithoutActivity: inactivity,
      } : null;
    })
    .filter((row): row is ManagementPropertyReview => Boolean(row))
    .sort((left, right) => (
      (right.daysWithoutActivity ?? -1) - (left.daysWithoutActivity ?? -1)
      || right.reasons.length - left.reasons.length
      || left.label.localeCompare(right.label, 'es-AR')
      || left.propertyId - right.propertyId
    ))
    .slice(0, 5);

  const funnelCounts = [
    ['leads', 'Leads', leadsReceived],
    ['visits', 'Visitas', visitsCompleted],
    ['offers', 'Ofertas', offers],
    ['reservations', 'Reservas', reservations],
    ['closures', 'Cierres', closures],
  ] as const;
  const funnel: ManagementFunnelStep[] = funnelCounts.map(([key, label, count], index) => ({
    key,
    label,
    count,
    conversionFromPreviousPct: index === 0 ? null : percentage(count, funnelCounts[index - 1]![2]),
  }));

  const firstResponseComplete = leadsReceived === 0 || responseSamples.length === leadsReceived;
  return {
    organizationId: input.scope.organizationId,
    period,
    brokerId,
    scorecard: {
      leadsReceived,
      leadsAttended,
      firstResponseMedianMinutes: median(responseSamples),
      firstResponseSample: responseSamples.length,
      visitsScheduled,
      visitsCompleted,
      offers,
      reservations,
      closures,
      conversionPct: percentage(closures, leadsReceived),
      commissions,
    },
    funnel,
    team,
    sources: sourceRows,
    pipeline: COMMERCIAL_STAGES.map((stage) => ({ stage, count: pipelineCount.get(stage) ?? 0 })),
    propertyReviews,
    dataQuality: {
      firstResponseComplete,
      firstResponseNote: firstResponseComplete
        ? null
        : `Primera respuesta calculada con ${responseSamples.length} de ${leadsReceived} leads: faltan timestamps históricos confiables.`,
    },
  };
}
