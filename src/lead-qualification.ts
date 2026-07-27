import { commercialQualificationState } from './lead-pipeline-essential.js';
import * as essential from './lead-qualification-essential.js';
import type {
  Client,
} from './models.js';
import type {
  QualificationAnalysis,
  QualificationField,
  QualificationSource,
  QualificationSuggestion,
} from './lead-qualification-essential.js';

export * from './lead-qualification-essential.js';

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function completeEvidence(text: string, suggestion: QualificationSuggestion): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return suggestion.evidence;
  if (suggestion.field === 'budget' || suggestion.field === 'creditApprovedAmount') {
    const targetDigits = suggestion.value.replace(/\D/g, '');
    const exact = lines.find((line) => targetDigits.length >= 4 && line.replace(/\D/g, '').includes(targetDigits));
    if (exact) return exact.slice(0, 240);
    const currencyLine = lines.find((line) => /\b(?:USD|ARS|US\$|d[oó]lares?|pesos?)\b/i.test(line) && /\d/.test(line));
    if (currencyLine) return currencyLine.slice(0, 240);
  }
  return suggestion.evidence;
}

function evidenceLine(text: string, matchText: string): string {
  return text.split(/\r?\n/).find((line) => line.includes(matchText))?.trim().slice(0, 240)
    || matchText.slice(0, 240);
}

function creditStatusSuggestion(text: string): QualificationSuggestion | null {
  const patterns: Array<[string, RegExp]> = [
    ['Preaprobado', /\b(?:cr[eé]dito(?: hipotecario)?\s+)?pre-?aprobado\b/i],
    ['Aprobado', /\b(?:cr[eé]dito(?: hipotecario)? aprobado|me aprobaron el cr[eé]dito|ya est[aá] aprobado)\b/i],
    ['En trámite', /\b(?:cr[eé]dito en tr[aá]mite|lo estoy tramitando|present[eé] los papeles|en evaluaci[oó]n bancaria)\b/i],
    ['Todavía no iniciado', /\b(?:todav[ií]a no (?:inici[eé]|tramit[eé])|a[uú]n no (?:inici[eé]|tramit[eé])|no empec[eé] el cr[eé]dito|cr[eé]dito no iniciado)\b/i],
  ];
  for (const [value, pattern] of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    return {
      id: `creditPossible-${value}-${match.index ?? 0}`,
      field: 'creditPossible',
      label: 'Situación del crédito',
      value,
      confidence: 'Alta',
      confidenceScore: 92,
      evidence: evidenceLine(text, match[0]),
    };
  }
  return null;
}

function parseApprovedAmount(raw: string, suffix?: string): number | null {
  const compact = raw.replace(/\s/g, '');
  let amount: number;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(compact)) amount = Number(compact.replace(/\./g, ''));
  else if (/^\d{1,3}(?:,\d{3})+$/.test(compact)) amount = Number(compact.replace(/,/g, ''));
  else amount = Number(compact.replace(',', '.'));
  if (/^(?:mil|k)$/i.test(suffix || '')) amount *= 1000;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function creditApprovedAmountSuggestion(text: string): QualificationSuggestion | null {
  const match = text.match(
    /\b(?:cr[eé]dito(?: hipotecario)? aprobado|me aprobaron(?: el)? cr[eé]dito|monto aprobado)(?:\s+(?:por|de|hasta))?\s*(?:(USD|ARS|US\$)\s*)?(\d{1,7}(?:[.\s]\d{3})*|\d{2,3})\s*(mil|k)?/i,
  );
  if (!match?.[2]) return null;
  const amount = parseApprovedAmount(match[2], match[3]);
  if (!amount) return null;
  const currency = match[1]?.toUpperCase().replace('US$', 'USD');
  const value = `${currency ? `${currency} ` : ''}${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(amount)}`;
  return {
    id: `creditApprovedAmount-${match.index ?? 0}`,
    field: 'creditApprovedAmount',
    label: 'Monto aprobado',
    value,
    confidence: currency ? 'Alta' : 'Media',
    confidenceScore: currency ? 92 : 72,
    evidence: evidenceLine(text, match[0]),
    ambiguous: !currency,
    warning: currency ? undefined : 'Falta confirmar la moneda del monto aprobado.',
  };
}

const CLIENT_FIELDS: Partial<Record<QualificationField, keyof Client>> = {
  zones: 'zones',
  propertyType: 'propertyType',
  operation: 'operation',
  bedrooms: 'bedrooms',
  budget: 'budget',
  currency: 'currency',
  paymentMethod: 'paymentMethod',
  needsFinancing: 'needsFinancing',
  creditPossible: 'creditPossible',
  creditApprovedAmount: 'creditApprovedAmount',
  purpose: 'purpose',
  purchaseTimeframe: 'purchaseTimeframe',
  knowsArea: 'knowsArea',
  canMoveForward: 'canMoveForward',
  interest: 'interest',
  objections: 'objections',
  urgency: 'urgency',
  garage: 'garage',
  patio: 'patio',
  pool: 'pool',
  requiresCreditReady: 'requiresCreditReady',
  features: 'features',
  preferences: 'preferences',
  nextAction: 'nextAction',
  nextFollowUp: 'nextFollowUp',
  temperature: 'temperature',
};

function candidateClient(client: Client, suggestions: QualificationSuggestion[]): Client {
  const candidate: Client = { ...client };
  suggestions.filter((item) => !item.ambiguous).forEach((item) => {
    const target = CLIENT_FIELDS[item.field];
    if (!target) return;
    if (target === 'bedrooms') candidate.bedrooms = Number(item.value) || undefined;
    else (candidate as unknown as Record<string, unknown>)[target] = item.value;
  });
  return candidate;
}

function reconcilePipeline(client: Client, suggestions: QualificationSuggestion[]): QualificationSuggestion[] {
  const pipeline = suggestions.find((item) => item.field === 'pipeline');
  if (!pipeline || pipeline.value !== 'Contactado') return suggestions;
  if (commercialQualificationState(candidateClient(client, suggestions)).state !== 'Calificado') return suggestions;
  return suggestions.map((item) => item.field === 'pipeline'
    ? {
      ...item,
      value: 'Calificado',
      confidence: 'Alta',
      confidenceScore: 92,
      evidence: 'Hay presupuesto, forma de pago, zona, finalidad, plazo y capacidad razonable de avanzar.',
    }
    : item);
}

export function analyzeLeadQualification(
  client: Client,
  text: string,
  source: QualificationSource,
  now = new Date(),
): QualificationAnalysis {
  const filteredText = essential.qualificationInputText(client, String(text ?? '')).slice(0, 40_000);
  const base = essential.analyzeLeadQualification(client, filteredText, source, now);
  let suggestions = base.suggestions.map((item) => ({
    ...item,
    evidence: completeEvidence(filteredText, item),
  }));
  if (!suggestions.some((item) => item.field === 'creditPossible')) {
    const creditStatus = creditStatusSuggestion(filteredText);
    if (creditStatus) suggestions.push(creditStatus);
  }
  if (!suggestions.some((item) => item.field === 'creditApprovedAmount')) {
    const approvedAmount = creditApprovedAmountSuggestion(filteredText);
    if (approvedAmount) suggestions.push(approvedAmount);
  }
  suggestions = reconcilePipeline(client, suggestions);
  const missingQuestions = essential.missingQualificationQuestions(client, suggestions);
  const readiness = essential.visitReadiness(client, suggestions);
  return {
    ...base,
    suggestions,
    missingQuestions,
    visitWarning: readiness.warning,
    visitMissingFields: readiness.missing,
  };
}

export function qualificationValuesEqual(left: string, right: string): boolean {
  return normalized(left) === normalized(right);
}
