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

const TERMINAL_STAGES = new Set<CommercialStage>(['Ganado', 'Perdido']);
const STYLE_ID = 'propcontrol-lead-pipeline-styles';

function installStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = '/src/lead-pipeline.css?v=20260727-1';
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

const qualificationFields: Array<{ key: keyof Client; label: string }> = [
  { key: 'interest', label: 'interés' },
  { key: 'budget', label: 'presupuesto' },
  { key: 'paymentMethod', label: 'forma de pago' },
  { key: 'purchaseTimeframe', label: 'plazo' },
  { key: 'purpose', label: 'finalidad' },
  { key: 'knowsArea', label: 'conocimiento de zona' },
  { key: 'canMoveForward', label: 'capacidad de avance' },
  { key: 'objections', label: 'condicionantes' },
];

export function qualificationProgress(client: Client): QualificationProgress {
  const missing = qualificationFields
    .filter(({ key }) => !String(client[key] ?? '').trim())
    .map(({ label }) => label);
  return {
    completed: qualificationFields.length - missing.length,
    total: qualificationFields.length,
    missing,
  };
}

export function clientSearchText(client: Client): string {
  return normalizedText([
    client.name,
    client.phone,
    client.email,
    client.interest,
    client.budget,
    client.paymentMethod,
    client.purchaseTimeframe,
    client.purpose,
    client.knowsArea,
    client.canMoveForward,
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
    if (filters.missingNextActionOnly && client.nextAction?.trim() && client.nextFollowUp) return false;
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
  if (!previous) {
    entries.push(activity('Lead creado', next, `${next.name} · ${stage}`));
  } else if (commercialStage(previous) !== stage) {
    entries.push(activity('Cambio de etapa', next, `${commercialStage(previous)} → ${stage}`));
  }

  if (stage === 'Ganado' && (!previous || commercialStage(previous) !== stage)) {
    entries.push(activity('Operación ganada', next, `${next.name} quedó registrado como ganado.`));
  }
  if (stage === 'Perdido' && (!previous || commercialStage(previous) !== stage)) {
    entries.push(activity('Operación perdida', next, `${next.name} quedó registrado como perdido.`));
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
