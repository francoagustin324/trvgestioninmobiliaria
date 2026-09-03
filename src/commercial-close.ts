import type {
  Client,
  CommercialStage,
  CommissionMode,
  DealCurrency,
  LostReason,
  Offer,
  Reservation,
  SyncedVisit,
} from './models.js';

type CloseMetadataKey =
  | 'outcome'
  | 'closedAt'
  | 'dealAmount'
  | 'dealCurrency'
  | 'dealPropertyId'
  | 'dealPropertyUid'
  | 'dealPropertyLabel'
  | 'commissionMode'
  | 'commissionPercentage'
  | 'commissionAmount'
  | 'commissionCurrency'
  | 'closeNote'
  | 'lostReason'
  | 'lostReasonDetail';

export const LOST_REASONS: LostReason[] = [
  'Precio',
  'Financiación',
  'No respondió',
  'Postergó decisión',
  'Compró/alquiló otra propiedad',
  'Eligió otra inmobiliaria',
  'No encontramos una propiedad adecuada',
  'Propiedad no disponible',
  'Requisitos no compatibles',
  'Otro',
];

export const REOPEN_STAGES: CommercialStage[] = [
  'Nuevo',
  'Contactado',
  'Calificado',
  'Visita coordinada',
  'Negociación',
  'Reservado',
];

export const CLOSE_METADATA_KEYS: CloseMetadataKey[] = [
  'outcome',
  'closedAt',
  'dealAmount',
  'dealCurrency',
  'dealPropertyId',
  'dealPropertyUid',
  'dealPropertyLabel',
  'commissionMode',
  'commissionPercentage',
  'commissionAmount',
  'commissionCurrency',
  'closeNote',
  'lostReason',
  'lostReasonDetail',
];

export interface CloseValidationResult {
  ok: boolean;
  message?: string;
  field?: string;
}

export interface CommercialMoneyTotals {
  dealAmount: number;
  commissionAmount: number;
}

export interface CommercialCloseSummary {
  wonCount: number;
  lostCount: number;
  byCurrency: Partial<Record<DealCurrency, CommercialMoneyTotals>>;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function normalized(value: unknown): string {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function terminalOutcome(client: Client): 'won' | 'lost' | null {
  if (client.outcome === 'won' || client.outcome === 'lost') return client.outcome;
  const stage = normalized(client.pipeline);
  if (['ganado', 'ganada', 'operacion ganada', 'cerrado', 'cerrada'].includes(stage)) return 'won';
  if (['perdido', 'perdida', 'operacion perdida'].includes(stage)) return 'lost';
  return null;
}

function finitePositive(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const normalizedValue = text(value).replace(',', '.');
  if (!normalizedValue) return null;
  const number = Number(normalizedValue);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  const number = Number(text(value));
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function currency(value: unknown): DealCurrency | undefined {
  return value === 'USD' || value === 'ARS' ? value : undefined;
}

function commissionMode(value: unknown): CommissionMode | undefined {
  return value === 'percentage' || value === 'fixed' ? value : undefined;
}

function lostReason(value: unknown): LostReason | undefined {
  return LOST_REASONS.includes(value as LostReason) ? value as LostReason : undefined;
}

function validIsoDate(value: unknown): boolean {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const date = new Date(`${raw}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw;
}

function roundedMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function preserveCommercialCloseMetadata(client: Client, source: Client): Client {
  const next = { ...client };
  const target = next as unknown as Record<string, unknown>;
  CLOSE_METADATA_KEYS.forEach((key) => {
    const value = source[key];
    if (value !== undefined) target[key] = value;
  });
  return next;
}

export function localTodayIso(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calculateCommissionAmount(dealAmount: number, percentage: number): number {
  if (!Number.isFinite(dealAmount) || dealAmount <= 0 || !Number.isFinite(percentage) || percentage <= 0) return 0;
  return roundedMoney(dealAmount * percentage / 100);
}

export function validateWonCloseValues(values: Record<string, string>): CloseValidationResult {
  if (!validIsoDate(values.closedAt)) {
    return { ok: false, field: 'closedAt', message: 'Ingresá una fecha de cierre válida.' };
  }
  const dealAmount = finitePositive(values.dealAmount);
  if (dealAmount === null) {
    return { ok: false, field: 'dealAmount', message: 'Ingresá un precio final mayor a cero.' };
  }
  const dealCurrency = currency(values.dealCurrency);
  if (!dealCurrency) {
    return { ok: false, field: 'dealCurrency', message: 'Elegí la moneda de la operación.' };
  }
  const mode = commissionMode(values.commissionMode);
  if (!mode) {
    return { ok: false, field: 'commissionMode', message: 'Elegí cómo se calcula la comisión.' };
  }
  const amount = finitePositive(values.commissionAmount);
  if (mode === 'percentage') {
    const percentage = finitePositive(values.commissionPercentage);
    if (percentage === null || percentage > 100) {
      return { ok: false, field: 'commissionPercentage', message: 'Ingresá un porcentaje de comisión válido entre 0 y 100.' };
    }
    const expected = calculateCommissionAmount(dealAmount, percentage);
    if (amount === null || Math.abs(amount - expected) > 0.01) {
      return { ok: false, field: 'commissionAmount', message: 'La comisión calculada no coincide con el porcentaje cargado.' };
    }
  } else if (amount === null) {
    return { ok: false, field: 'commissionAmount', message: 'Ingresá el monto esperado de comisión.' };
  }
  return { ok: true };
}

export function validateLostCloseValues(values: Record<string, string>): CloseValidationResult {
  if (!validIsoDate(values.closedAt)) {
    return { ok: false, field: 'closedAt', message: 'Ingresá una fecha de cierre válida.' };
  }
  const reason = lostReason(values.lostReason);
  if (!reason) {
    return { ok: false, field: 'lostReason', message: 'Elegí el motivo de pérdida.' };
  }
  if (reason === 'Otro' && !text(values.lostReasonDetail)) {
    return { ok: false, field: 'lostReasonDetail', message: 'Detallá el motivo cuando elegís “Otro”.' };
  }
  return { ok: true };
}

export function hasStructuredClose(client: Client): boolean {
  if (client.outcome === 'won') {
    return Boolean(
      validIsoDate(client.closedAt)
      && finitePositive(client.dealAmount) !== null
      && currency(client.dealCurrency)
      && commissionMode(client.commissionMode)
      && finitePositive(client.commissionAmount) !== null
      && currency(client.commissionCurrency),
    );
  }
  if (client.outcome === 'lost') {
    return Boolean(validIsoDate(client.closedAt) && lostReason(client.lostReason));
  }
  return false;
}

export function clearCommercialCloseMetadata(client: Client): Client {
  const next = { ...client };
  CLOSE_METADATA_KEYS.forEach((key) => { delete next[key]; });
  return next;
}

export function closeWonClient(client: Client, values: Record<string, string>): Client {
  const validation = validateWonCloseValues(values);
  if (!validation.ok) throw new Error(validation.message || 'Cierre ganado inválido.');
  const dealAmount = finitePositive(values.dealAmount)!;
  const dealCurrency = currency(values.dealCurrency)!;
  const mode = commissionMode(values.commissionMode)!;
  const percentage = mode === 'percentage' ? finitePositive(values.commissionPercentage)! : undefined;
  const commissionAmount = mode === 'percentage'
    ? calculateCommissionAmount(dealAmount, percentage!)
    : finitePositive(values.commissionAmount)!;
  const next = clearCommercialCloseMetadata(client);
  return {
    ...next,
    pipeline: 'Ganado',
    status: 'Operación ganada',
    nextAction: undefined,
    nextFollowUp: undefined,
    outcome: 'won',
    closedAt: text(values.closedAt),
    dealAmount,
    dealCurrency,
    dealPropertyId: optionalPositiveInteger(values.dealPropertyId),
    dealPropertyUid: text(values.dealPropertyUid) || undefined,
    dealPropertyLabel: text(values.dealPropertyLabel) || undefined,
    commissionMode: mode,
    commissionPercentage: percentage,
    commissionAmount,
    commissionCurrency: dealCurrency,
    closeNote: text(values.closeNote) || undefined,
  };
}

export function closeLostClient(client: Client, values: Record<string, string>): Client {
  const validation = validateLostCloseValues(values);
  if (!validation.ok) throw new Error(validation.message || 'Cierre perdido inválido.');
  const next = clearCommercialCloseMetadata(client);
  return {
    ...next,
    pipeline: 'Perdido',
    status: 'Operación perdida',
    nextAction: undefined,
    nextFollowUp: undefined,
    outcome: 'lost',
    closedAt: text(values.closedAt),
    lostReason: lostReason(values.lostReason),
    lostReasonDetail: text(values.lostReasonDetail) || undefined,
    closeNote: text(values.closeNote) || undefined,
  };
}

export function reopenCommercialClient(client: Client, targetStage: CommercialStage): Client {
  if (!REOPEN_STAGES.includes(targetStage)) throw new Error('La etapa de reapertura debe ser una etapa activa.');
  const next = clearCommercialCloseMetadata(client);
  return {
    ...next,
    pipeline: targetStage,
    status: 'Lead',
    nextAction: undefined,
    nextFollowUp: undefined,
  };
}

export function applyCommercialCloseFromValues(
  client: Client,
  values: Record<string, string>,
  previous?: Client | null,
): Client {
  if (client.pipeline === 'Ganado') {
    const submitted = values.closedAt !== undefined
      || values.dealAmount !== undefined
      || values.commissionAmount !== undefined;
    if (submitted) return closeWonClient(client, values);
    if (previous && terminalOutcome(previous) === 'won') return preserveCommercialCloseMetadata(client, previous);
    return client;
  }
  if (client.pipeline === 'Perdido') {
    const submitted = values.closedAt !== undefined || values.lostReason !== undefined;
    if (submitted) return closeLostClient(client, values);
    if (previous && terminalOutcome(previous) === 'lost') return preserveCommercialCloseMetadata(client, previous);
    return client;
  }
  return clearCommercialCloseMetadata(client);
}

export function commercialCloseActivityDetail(client: Client): string {
  if (client.outcome === 'won' && hasStructuredClose(client)) {
    const property = client.dealPropertyLabel?.trim()
      || (client.dealPropertyId ? `Propiedad #${client.dealPropertyId}` : 'Sin propiedad vinculada');
    const note = client.closeNote?.trim() ? ` · ${client.closeNote.trim()}` : '';
    return `${property} · ${formatCommercialMoney(client.dealAmount!, client.dealCurrency!)} · Comisión ${formatCommercialMoney(client.commissionAmount!, client.commissionCurrency!)}${note}`;
  }
  if (client.outcome === 'lost' && hasStructuredClose(client)) {
    const detail = client.lostReasonDetail?.trim() ? ` · ${client.lostReasonDetail.trim()}` : '';
    const note = client.closeNote?.trim() ? ` · ${client.closeNote.trim()}` : '';
    return `${client.lostReason}${detail}${note}`;
  }
  return `${client.name} · cierre histórico sin metadata estructurada.`;
}

export function commercialCloseSummary(clients: Client[]): CommercialCloseSummary {
  const summary: CommercialCloseSummary = { wonCount: 0, lostCount: 0, byCurrency: {} };
  clients.forEach((client) => {
    const outcome = terminalOutcome(client);
    if (outcome === 'won') summary.wonCount += 1;
    if (outcome === 'lost') summary.lostCount += 1;
    if (client.outcome !== 'won') return;
    const currencyValue = currency(client.dealCurrency);
    const amount = finitePositive(client.dealAmount);
    const commission = finitePositive(client.commissionAmount);
    if (!currencyValue || amount === null || commission === null) return;
    const current = summary.byCurrency[currencyValue] ?? { dealAmount: 0, commissionAmount: 0 };
    current.dealAmount = roundedMoney(current.dealAmount + amount);
    current.commissionAmount = roundedMoney(current.commissionAmount + commission);
    summary.byCurrency[currencyValue] = current;
  });
  return summary;
}

export function formatCommercialMoney(amount: number, dealCurrency: DealCurrency): string {
  const formatter = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${dealCurrency} ${formatter.format(amount)}`;
}

function uniquePropertyCandidates(values: Array<number | undefined>, allowed: Set<number>): number[] {
  return [...new Set(values.filter((value): value is number => Boolean(value && allowed.has(value))))];
}

export function suggestedClosePropertyId(
  clientId: number,
  offers: Offer[],
  reservations: Reservation[],
  visits: SyncedVisit[],
  allowedPropertyIds: number[],
): number | undefined {
  const allowed = new Set(allowedPropertyIds);
  const reservationCandidates = uniquePropertyCandidates(
    reservations
      .filter((item) => item.clientId === clientId && ['Activa', 'Concretada'].includes(item.status))
      .map((item) => item.propertyId),
    allowed,
  );
  if (reservationCandidates.length === 1) return reservationCandidates[0];
  if (reservationCandidates.length > 1) return undefined;

  const offerCandidates = uniquePropertyCandidates(
    offers
      .filter((item) => item.clientId === clientId && item.status === 'Aceptada')
      .map((item) => item.propertyId),
    allowed,
  );
  if (offerCandidates.length === 1) return offerCandidates[0];
  if (offerCandidates.length > 1) return undefined;

  const visitCandidates = uniquePropertyCandidates(
    visits
      .filter((item) => item.clientId === clientId && ['Coordinada', 'Realizada'].includes(item.status))
      .map((item) => item.propertyId),
    allowed,
  );
  return visitCandidates.length === 1 ? visitCandidates[0] : undefined;
}
