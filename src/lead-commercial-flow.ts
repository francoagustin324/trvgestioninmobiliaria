import type { ActivityEntry, Client, Reminder } from './models.js';

export const COMMERCIAL_STAGES = [
  'Nuevo',
  'Calificado',
  'Visita coordinada',
  'Negociación',
  'Reservado',
  'Ganada',
  'Perdida',
] as const;

export type CommercialStage = typeof COMMERCIAL_STAGES[number];

export interface CommercialProgressInput {
  stage: CommercialStage;
  note?: string;
  scheduledDate?: string;
  now?: Date;
}

export interface CommercialProgressResult {
  client: Client;
  activity: Omit<ActivityEntry, 'id' | 'actorId' | 'createdAt'>;
  reminder: Omit<Reminder, 'id' | 'assignedToId' | 'createdById'> | null;
}

const TERMINAL_STAGES = new Set<CommercialStage>(['Ganada', 'Perdida']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STYLE_ID = 'propcontrol-lead-commercial-flow-styles';

function installCommercialFlowStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = '/src/lead-commercial-flow.css?v=20260720-44';
  document.head.append(link);
}

installCommercialFlowStyles();

function normalizedDate(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && ISO_DATE.test(trimmed) ? trimmed : undefined;
}

function defaultDetail(stage: CommercialStage): string {
  if (stage === 'Calificado') return 'El lead quedó calificado para continuar la gestión.';
  if (stage === 'Visita coordinada') return 'Se coordinó una visita con el cliente.';
  if (stage === 'Negociación') return 'La operación ingresó en negociación.';
  if (stage === 'Reservado') return 'La operación quedó reservada.';
  if (stage === 'Ganada') return 'La operación se marcó como ganada.';
  if (stage === 'Perdida') return 'La operación se marcó como perdida.';
  return 'La operación volvió a la etapa inicial.';
}

function reminderTitle(stage: CommercialStage, clientName: string): string {
  if (stage === 'Visita coordinada') return `Visita con ${clientName}`;
  if (stage === 'Negociación' || stage === 'Reservado') return `Seguimiento de negociación con ${clientName}`;
  return `Seguimiento de ${clientName}`;
}

export function isCommercialStage(value: string): value is CommercialStage {
  return COMMERCIAL_STAGES.includes(value as CommercialStage);
}

export function buildCommercialProgress(client: Client, input: CommercialProgressInput): CommercialProgressResult {
  const now = input.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const scheduledDate = normalizedDate(input.scheduledDate);
  const terminal = TERMINAL_STAGES.has(input.stage);
  const note = input.note?.trim();
  const detailParts = [note || defaultDetail(input.stage)];
  if (scheduledDate && !terminal) detailParts.push(`Próxima acción: ${scheduledDate}`);

  const updatedClient: Client = {
    ...client,
    pipeline: input.stage,
    lastContact: today,
    nextFollowUp: terminal ? undefined : scheduledDate ?? client.nextFollowUp,
    status: input.stage === 'Ganada'
      ? 'Operación ganada'
      : input.stage === 'Perdida'
        ? 'Operación perdida'
        : client.status,
  };

  const reminder = scheduledDate && !terminal
    ? {
        date: scheduledDate,
        title: reminderTitle(input.stage, client.name),
        related: client.name,
        priority: input.stage === 'Negociación' || input.stage === 'Reservado' ? 'Alta' : 'Media',
      }
    : null;

  return {
    client: updatedClient,
    activity: {
      action: 'Avance comercial',
      entityType: 'Cliente',
      entityId: client.id,
      detail: `${input.stage} · ${detailParts.join(' · ')}`,
    },
    reminder,
  };
}
