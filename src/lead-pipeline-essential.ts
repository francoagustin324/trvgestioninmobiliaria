import { commercialCloseActivityDetail } from './commercial-close.js';
import type { ActivityEntry, Client, CommercialStage, Temperature } from './models.js';

export const COMMERCIAL_STAGES: CommercialStage[] = [
  'Nuevo',
  'Contactado',
  'Calificado',
  'Visita coordinada',
  'Negociación',
  'Reservado',
  'Ganado',
  'Perdido',
];

export type CommercialQualificationState =
  | 'Información inicial'
  | 'Falta presupuesto'
  | 'Falta forma de pago'
  | 'Falta confirmar capacidad de avance'
  | 'Calificado'
  | 'No listo todavía';

export interface LeadFilters {
  search: string;
  stage: CommercialStage | 'Todas';
  temperature: Temperature | 'Todas';
  overdueOnly: boolean;
  missingNextActionOnly: boolean;
}

export interface QualificationProgress {
  completed: number;
  total: number;
  missing: string[];
}

export interface CommercialQualificationSummary extends QualificationProgress {
  state: CommercialQualificationState;
  slug: string;
  detail: string;
}

const TERMINAL_STAGES = new Set<CommercialStage>(['Ganado', 'Perdido']);
const STYLE_ID = 'propcontrol-lead-pipeline-styles';

function installStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = '/src/lead-pipeline.css?v=20260727-2';
  document.head.append(link);
}

installStyles();

function normalizedText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function present(value: unknown): boolean {
  return Boolean(String(value ?? '').trim());
}

function budgetHasCurrency(client: Client): boolean {
  return present(client.currency)
    || /\b(?:USD|ARS|EUR|US\$|d[oó]lares?|pesos?)\b/i.test(client.budget || '');
}

function paymentUsesMortgageCredit(client: Client): boolean {
  return normalizedText(client.paymentMethod).includes('credito hipotecario')
    || normalizedText(client.canMoveForward).includes('depende del credito');
}

function progressedCreditStatus(client: Client): boolean {
  const status = normalizedText(client.creditPossible);
  if (!paymentUsesMortgageCredit(client)) return true;
  return ['en tramite', 'preaprobado', 'aprobado'].includes(status);
}

function reasonableAdvance(client: Client): boolean {
  const value = normalizedText(client.canMoveForward);
  if (value === 'si') return true;
  if (value === 'depende del credito') return progressedCreditStatus(client);
  return false;
}

export function localIsoDate(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeCommercialStage(value: string | undefined): CommercialStage {
  const normalized = normalizedText(value);
  if (normalized === 'contactado') return 'Contactado';
  if (normalized === 'calificado') return 'Calificado';
  if (normalized.includes('visita')) return 'Visita coordinada';
  if (normalized === 'negociacion') return 'Negociación';
  if (normalized.includes('reserv')) return 'Reservado';
  if (['ganado', 'ganada', 'operacion ganada', 'cerrado', 'cerrada'].includes(normalized)) return 'Ganado';
  if (['perdido', 'perdida', 'operacion perdida'].includes(normalized)) return 'Perdido';
  return 'Nuevo';
}

export function commercialStage(client: Client): CommercialStage {
  return normalizeCommercialStage(client.pipeline);
}

export function isTerminalStage(stage: string | undefined): boolean {
  return TERMINAL_STAGES.has(normalizeCommercialStage(stage));
}

export function isTerminalClient(client: Client): boolean {
  return isTerminalStage(client.pipeline)
    || ['operación ganada', 'operacion ganada', 'operación perdida', 'operacion perdida', 'cerrado']
      .includes(normalizedText(client.status));
}

export function applyCommercialStage(client: Client, requestedStage: string | undefined): Client {
  const stage = normalizeCommercialStage(requestedStage);
  const terminal = TERMINAL_STAGES.has(stage);
  return {
    ...client,
    pipeline: stage,
    status: stage === 'Ganado'
      ? 'Operación ganada'
      : stage === 'Perdido'
        ? 'Operación perdida'
        : 'Lead',
    nextFollowUp: terminal ? undefined : client.nextFollowUp,
    nextAction: terminal ? undefined : client.nextAction,
  };
}

const essentialQualificationFields: Array<{ label: string; complete: (client: Client) => boolean }> = [
  { label: 'presupuesto', complete: (client) => present(client.budget) },
  { label: 'moneda', complete: budgetHasCurrency },
  { label: 'forma de pago', complete: (client) => present(client.paymentMethod) },
  { label: 'situación del crédito', complete: (client) => !paymentUsesMortgageCredit(client) || present(client.creditPossible) },
  { label: 'zona', complete: (client) => present(client.zones) },
  { label: 'finalidad', complete: (client) => present(client.purpose) },
  { label: 'plazo o urgencia', complete: (client) => present(client.purchaseTimeframe) || present(client.urgency) },
  { label: 'capacidad de avance', complete: (client) => present(client.canMoveForward) && normalizedText(client.canMoveForward) !== 'no confirmado' },
];

export function qualificationProgress(client: Client): QualificationProgress {
  const missing = essentialQualificationFields
    .filter(({ complete }) => !complete(client))
    .map(({ label }) => label);
  return {
    completed: essentialQualificationFields.length - missing.length,
    total: essentialQualificationFields.length,
    missing,
  };
}

export function commercialQualificationState(client: Client): CommercialQualificationSummary {
  const progress = qualificationProgress(client);
  const advance = normalizedText(client.canMoveForward);
  const creditStatus = normalizedText(client.creditPossible);
  let state: CommercialQualificationState;
  let detail: string;

  if (advance === 'todavia no' || advance === 'depende de vender' || (paymentUsesMortgageCredit(client) && creditStatus === 'todavia no iniciado')) {
    state = 'No listo todavía';
    detail = 'Conviene mantener seguimiento sin forzar una visita.';
  } else if (!present(client.budget) || !budgetHasCurrency(client)) {
    state = 'Falta presupuesto';
    detail = 'Confirmá un rango aproximado y su moneda.';
  } else if (!present(client.paymentMethod)) {
    state = 'Falta forma de pago';
    detail = 'Definí si compra de contado, con crédito o financiación.';
  } else if (!present(client.canMoveForward) || advance === 'no confirmado') {
    state = 'Falta confirmar capacidad de avance';
    detail = 'Falta saber si hoy podría avanzar ante una opción adecuada.';
  } else if (
    present(client.zones)
    && present(client.purpose)
    && (present(client.purchaseTimeframe) || present(client.urgency))
    && reasonableAdvance(client)
    && progressedCreditStatus(client)
  ) {
    state = 'Calificado';
    detail = 'Tiene señales comerciales suficientes para avanzar.';
  } else {
    state = 'Información inicial';
    detail = 'Completá solo los datos que definen si existe una oportunidad real.';
  }

  return {
    ...progress,
    state,
    slug: normalizedText(state).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    detail,
  };
}

export function clientSearchText(client: Client): string {
  return normalizedText([
    client.name,
    client.phone,
    client.email,
    client.interest,
    client.budget,
    client.currency,
    client.paymentMethod,
    client.creditPossible,
    client.creditApprovedAmount,
    client.purchaseTimeframe,
    client.purpose,
    client.zones,
    client.knowsArea,
    client.canMoveForward,
    client.propertyType,
    client.bedrooms,
    client.garage,
    client.patio,
    client.pool,
    client.requiresCreditReady,
    client.features,
    client.preferences,
    client.objections,
    client.notes,
    client.nextAction,
    commercialStage(client),
  ].filter(Boolean).join(' '));
}

export function filterLeads(clients: Client[], filters: LeadFilters, today = localIsoDate()): Client[] {
  const query = normalizedText(filters.search);
  return clients.filter((client) => {
    const stage = commercialStage(client);
    if (filters.stage !== 'Todas' && stage !== filters.stage) return false;
    if (filters.temperature !== 'Todas' && client.temperature !== filters.temperature) return false;
    if (filters.overdueOnly && (!client.nextFollowUp || client.nextFollowUp >= today || isTerminalClient(client))) return false;
    if (filters.missingNextActionOnly && (isTerminalClient(client) || (client.nextAction?.trim() && client.nextFollowUp))) return false;
    return !query || clientSearchText(client).includes(query);
  });
}

export function stageCounters(clients: Client[]): Record<CommercialStage, number> {
  return COMMERCIAL_STAGES.reduce<Record<CommercialStage, number>>((result, stage) => {
    result[stage] = clients.filter((client) => commercialStage(client) === stage).length;
    return result;
  }, {
    Nuevo: 0,
    Contactado: 0,
    Calificado: 0,
    'Visita coordinada': 0,
    Negociación: 0,
    Reservado: 0,
    Ganado: 0,
    Perdido: 0,
  });
}

function activity(action: string, client: Client, detail: string): Omit<ActivityEntry, 'id' | 'actorId' | 'createdAt'> {
  return { action, entityType: 'Cliente', entityId: client.id, detail };
}

export function activitiesForClientSave(previous: Client | null, next: Client): Array<Omit<ActivityEntry, 'id' | 'actorId' | 'createdAt'>> {
  const entries: Array<Omit<ActivityEntry, 'id' | 'actorId' | 'createdAt'>> = [];
  const stage = commercialStage(next);
  const previousStage = previous ? commercialStage(previous) : null;

  if (!previous) {
    entries.push(activity('Lead creado', next, `${next.name} · ${stage}`));
  }

  if (previousStage !== stage) {
    if (previous && isTerminalClient(previous) && !isTerminalClient(next)) {
      entries.push(activity('Operación reabierta', next, `${next.name} · ${previousStage} → ${stage}`));
    } else if (stage === 'Ganado') {
      entries.push(activity('Operación ganada', next, commercialCloseActivityDetail(next)));
    } else if (stage === 'Perdido') {
      entries.push(activity('Operación perdida', next, commercialCloseActivityDetail(next)));
    } else if (previous) {
      entries.push(activity('Cambio de etapa', next, `${previousStage} → ${stage}`));
    }
  }

  if (!isTerminalClient(next) && next.nextFollowUp) {
    if (!previous?.nextFollowUp) {
      entries.push(activity('Próxima acción programada', next, `${next.nextAction || 'Seguimiento'} · ${next.nextFollowUp}`));
    } else if (previous.nextFollowUp !== next.nextFollowUp) {
      entries.push(activity('Seguimiento reprogramado', next, `${next.nextAction || previous.nextAction || 'Seguimiento'} · ${previous.nextFollowUp} → ${next.nextFollowUp}`));
    } else if ((previous.nextAction || '') !== (next.nextAction || '')) {
      entries.push(activity('Próxima acción actualizada', next, `${next.nextAction || 'Sin detalle'} · ${next.nextFollowUp}`));
    }
  }
  return entries;
}

export function completeClientFollowUp(client: Client, now = new Date()): {
  client: Client;
  activity: Omit<ActivityEntry, 'id' | 'actorId' | 'createdAt'>;
} {
  const completedAction = client.nextAction?.trim() || 'Seguimiento comercial';
  return {
    client: {
      ...client,
      lastContact: localIsoDate(now),
      nextFollowUp: undefined,
      nextAction: undefined,
    },
    activity: activity('Seguimiento completado', client, completedAction),
  };
}

export function reprogramClientFollowUp(client: Client, date: string): {
  client: Client;
  activity: Omit<ActivityEntry, 'id' | 'actorId' | 'createdAt'>;
} {
  return {
    client: { ...client, nextFollowUp: date },
    activity: activity(
      'Seguimiento reprogramado',
      client,
      `${client.nextAction?.trim() || 'Seguimiento'} · ${client.nextFollowUp || 'Sin fecha'} → ${date}`,
    ),
  };
}
