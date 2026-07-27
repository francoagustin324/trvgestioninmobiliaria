import {
  applyCommercialStage,
  commercialQualificationState,
  localIsoDate,
  normalizeCommercialStage,
} from './lead-pipeline.js';
import type {
  ActivityEntry,
  Client,
  CommercialStage,
  ConversationMessage,
  Temperature,
  WhatsAppConversation,
} from './models.js';

export type QualificationSource = 'conversation' | 'whatsapp_text' | 'notes_transcript';
export type QualificationConfidence = 'Alta' | 'Media' | 'Baja';
export type QualificationField =
  | 'name'
  | 'phone'
  | 'zones'
  | 'propertyType'
  | 'operation'
  | 'bedrooms'
  | 'budget'
  | 'currency'
  | 'paymentMethod'
  | 'needsFinancing'
  | 'creditPossible'
  | 'creditApprovedAmount'
  | 'purpose'
  | 'purchaseTimeframe'
  | 'knowsArea'
  | 'canMoveForward'
  | 'interest'
  | 'objections'
  | 'urgency'
  | 'garage'
  | 'patio'
  | 'pool'
  | 'requiresCreditReady'
  | 'features'
  | 'preferences'
  | 'nextAction'
  | 'nextFollowUp'
  | 'pipeline'
  | 'temperature';

export interface QualificationSuggestion {
  id: string;
  field: QualificationField;
  label: string;
  value: string;
  confidence: QualificationConfidence;
  confidenceScore: number;
  evidence: string;
  ambiguous?: boolean;
  warning?: string;
  terminalConfirmationRequired?: boolean;
}

export interface QualificationAnalysis {
  source: QualificationSource;
  suggestions: QualificationSuggestion[];
  missingQuestions: string[];
  visitWarning: string | null;
  visitMissingFields: string[];
  deterministic: true;
  intelligentUsed: boolean;
  providerAvailable: boolean;
  analyzedAt: string;
}

export interface ReviewedQualificationSuggestion extends QualificationSuggestion {
  accepted: boolean;
  editedValue?: string;
  allowConfirmedOverwrite?: boolean;
}

export interface QualificationApplicationResult {
  client: Client;
  appliedFields: QualificationField[];
  alreadyConfirmedFields: QualificationField[];
  rejectedFields: QualificationField[];
  blockedFields: QualificationField[];
  reviewRequiredFields: QualificationField[];
}

const FIELD_LABELS: Record<QualificationField, string> = {
  name: 'Nombre',
  phone: 'Teléfono',
  zones: 'Zona o barrios principales',
  propertyType: 'Tipo de propiedad',
  operation: 'Operación',
  bedrooms: 'Dormitorios',
  budget: 'Presupuesto',
  currency: 'Moneda',
  paymentMethod: 'Forma de pago',
  needsFinancing: 'Necesita financiación',
  creditPossible: 'Situación del crédito',
  creditApprovedAmount: 'Monto aprobado',
  purpose: 'Finalidad',
  purchaseTimeframe: 'Plazo o urgencia',
  knowsArea: 'Conoce la zona',
  canMoveForward: 'Posibilidad actual de avanzar',
  interest: 'Propiedad de interés',
  objections: 'Objeciones o condicionantes',
  urgency: 'Urgencia',
  garage: 'Cochera',
  patio: 'Patio',
  pool: 'Pileta',
  requiresCreditReady: 'Apto crédito requerido',
  features: 'Características',
  preferences: 'Preferencias',
  nextAction: 'Próxima acción',
  nextFollowUp: 'Fecha mencionada',
  pipeline: 'Etapa comercial sugerida',
  temperature: 'Temperatura sugerida',
};

const TARGET_FIELDS: Partial<Record<QualificationField, keyof Client>> = {
  name: 'name',
  phone: 'phone',
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
  pipeline: 'pipeline',
  temperature: 'temperature',
};

const zoneNames = [
  'General Paz', 'Cofico', 'Nueva Córdoba', 'Docta', 'Manantiales', 'Valle Escondido',
  'Villa Allende', 'Alta Córdoba', 'Juniors', 'Argüello', 'Nuevo Urca', 'Urca',
  'Chateau', 'Balcones del Chateau', 'Recta Martinolli', 'Cerro de las Rosas',
  'Alto Verde', 'Centro', 'Güemes', 'Alberdi', 'San Vicente',
];

const propertyTypes: Array<[string, RegExp]> = [
  ['Departamento', /\b(?:departamento|depto|dpto)\b/i],
  ['Dúplex', /\bd[uú]plex\b/i],
  ['Casa', /\b(?:casa|chalet)\b/i],
  ['Terreno', /\b(?:terreno|lote)\b/i],
  ['Local', /\blocal\b/i],
  ['Oficina', /\boficina\b/i],
];

const agentLabels = new Set([
  'franco', 'trv', 'trv gestion inmobiliaria', 'propcontrol', 'asesor', 'asesora',
  'corredor', 'corredora', 'agente', 'vendedor', 'vendedora', 'inmobiliaria', 'yo',
]);

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compactEvidence(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function sentenceEvidence(text: string, matchIndex: number): string {
  const start = Math.max(0, text.lastIndexOf('\n', matchIndex), text.lastIndexOf('.', matchIndex) + 1);
  const after = text.slice(matchIndex);
  const candidates = [after.indexOf('\n'), after.indexOf('.'), after.indexOf('?'), after.indexOf('!')]
    .filter((value) => value >= 0);
  const end = candidates.length ? matchIndex + Math.min(...candidates) + 1 : Math.min(text.length, matchIndex + 240);
  return compactEvidence(text.slice(start, end));
}

function suggestion(
  field: QualificationField,
  value: string,
  confidence: QualificationConfidence,
  evidence: string,
  options: Pick<QualificationSuggestion, 'ambiguous' | 'warning' | 'terminalConfirmationRequired'> = {},
): QualificationSuggestion {
  const confidenceScore = confidence === 'Alta' ? 92 : confidence === 'Media' ? 72 : 45;
  return {
    id: `${field}-${Math.abs(hash(`${field}:${value}:${evidence}`))}`,
    field,
    label: FIELD_LABELS[field],
    value: value.trim(),
    confidence,
    confidenceScore,
    evidence: compactEvidence(evidence),
    ...options,
  };
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  return result;
}

function addUnique(target: QualificationSuggestion[], candidate: QualificationSuggestion | null): void {
  if (!candidate?.value) return;
  const existing = target.find((item) => item.field === candidate.field);
  if (!existing || candidate.confidenceScore > existing.confidenceScore) {
    if (existing) target.splice(target.indexOf(existing), 1);
    target.push(candidate);
  }
}

function uniqueFields(values: QualificationField[]): QualificationField[] {
  return [...new Set(values)];
}

export function qualificationInputText(client: Client, rawText: string): string {
  const text = String(rawText ?? '').trim();
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const parsed = lines.map((line) => {
    const match = line.match(/^\s*([^:\n]{1,40}):\s*(.+)$/);
    return match ? { label: match[1]!.trim(), message: match[2]!.trim() } : { label: '', message: line.trim() };
  });
  const labels = [...new Set(parsed.map((item) => normalize(item.label)).filter(Boolean))];
  if (labels.length < 2) return text;

  const clientName = normalize(client.name);
  const clientFirstName = clientName.split(' ')[0] || '';
  const matchingClientLabels = labels.filter((label) => (
    Boolean(clientName && (label === clientName || clientName.startsWith(`${label} `)))
    || Boolean(clientFirstName && label === clientFirstName)
  ));
  const knownAgentLabels = labels.filter((label) => agentLabels.has(label));
  const allowed = matchingClientLabels.length
    ? new Set(matchingClientLabels)
    : knownAgentLabels.length
      ? new Set(labels.filter((label) => !agentLabels.has(label)))
      : null;
  if (!allowed?.size) return text;

  const kept: string[] = [];
  let keepContinuation = false;
  parsed.forEach((item) => {
    if (item.label) {
      keepContinuation = allowed.has(normalize(item.label));
      if (keepContinuation && item.message) kept.push(item.message);
    } else if (keepContinuation && item.message) kept.push(item.message);
  });
  return kept.join('\n').trim() || text;
}

function explicitCurrency(text: string): { value: string; evidence: string } | null {
  const usd = text.match(/(?:\bUSD\b|US\$|U\$S|d[oó]lares?)/i);
  if (usd) return { value: 'USD', evidence: sentenceEvidence(text, usd.index ?? 0) };
  const ars = text.match(/(?:\bARS\b|pesos? argentinos?|moneda nacional)/i);
  if (ars) return { value: 'ARS', evidence: sentenceEvidence(text, ars.index ?? 0) };
  return null;
}

function parseAmountToken(raw: string, explicitThousands: boolean): number | null {
  const compact = raw.replace(/\s/g, '');
  let value: number;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(compact)) value = Number(compact.replace(/\./g, ''));
  else if (/^\d{1,3}(?:,\d{3})+$/.test(compact)) value = Number(compact.replace(/,/g, ''));
  else value = Number(compact.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  return explicitThousands ? value * 1000 : value;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value);
}

function budgetSuggestions(text: string): QualificationSuggestion[] {
  const results: QualificationSuggestion[] = [];
  const currency = explicitCurrency(text);
  const currencyPrefix = currency ? `${currency.value} ` : '';
  const range = text.match(/\bentre\s+(\d{2,7}(?:[.,]\d{3})?)\s*(mil|k)?\s+(?:y|a)\s+(\d{2,7}(?:[.,]\d{3})?)\s*(mil|k)?/i);
  if (range) {
    const lowerRaw = range[1] ?? '';
    const upperRaw = range[3] ?? '';
    const lowerPlain = Number(lowerRaw.replace(/[.,]/g, ''));
    const upperPlain = Number(upperRaw.replace(/[.,]/g, ''));
    const implicitThousands = !range[2] && !range[4] && lowerPlain >= 10 && lowerPlain < 1000 && upperPlain >= 10 && upperPlain < 1000;
    const lower = parseAmountToken(lowerRaw, Boolean(range[2]) || implicitThousands);
    const upper = parseAmountToken(upperRaw, Boolean(range[4]) || implicitThousands);
    if (lower && upper) {
      const evidence = sentenceEvidence(text, range.index ?? 0);
      results.push(suggestion(
        'budget',
        `${currencyPrefix}${formatInteger(Math.min(lower, upper))}–${formatInteger(Math.max(lower, upper))}`,
        currency ? 'Alta' : 'Media',
        evidence,
        currency ? {} : { ambiguous: true, warning: 'Falta confirmar la moneda del rango.' },
      ));
    }
  }

  const delivery = text.match(/\bentrega(?:\s+de)?\s+(?:(USD|ARS|US\$)\s*)?(\d{1,7}(?:[.\s]\d{3})*|\d{2,3})\s*(mil|k)?[^\n.]{0,60}\b(?:cuotas?|financi)/i);
  if (delivery) {
    const localCurrency = delivery[1]?.toUpperCase().replace('US$', 'USD') || currency?.value;
    const raw = delivery[2] ?? '';
    const amount = parseAmountToken(raw, Boolean(delivery[3]) || Boolean(localCurrency && !/[.\s,]/.test(raw) && Number(raw) < 1000));
    if (amount) {
      const evidence = sentenceEvidence(text, delivery.index ?? 0);
      results.push(suggestion(
        'budget',
        `Entrega ${localCurrency ? `${localCurrency} ` : ''}${formatInteger(amount)} + cuotas`,
        localCurrency ? 'Alta' : 'Media',
        evidence,
        localCurrency ? {} : { ambiguous: true, warning: 'Falta confirmar la moneda de la entrega.' },
      ));
    }
  }

  const availableAndFinance = text.match(/\b(?:tengo|dispongo de|cuento con)\s+(\d{2,7}(?:[.,]\d{3})?)\s*(mil|k)?[^\n.]{0,70}\b(?:financiar|financiacion|financiación|cuotas?|resto)/i);
  if (availableAndFinance) {
    const raw = availableAndFinance[1] ?? '';
    const numeric = Number(raw.replace(/[.,]/g, ''));
    const implicitThousands = !availableAndFinance[2] && numeric >= 10 && numeric < 1000;
    const amount = parseAmountToken(raw, Boolean(availableAndFinance[2]) || implicitThousands);
    if (amount) {
      const evidence = sentenceEvidence(text, availableAndFinance.index ?? 0);
      results.push(suggestion(
        'budget',
        `${currencyPrefix}${formatInteger(amount)} disponibles + resto financiado`,
        currency ? 'Media' : 'Baja',
        evidence,
        currency ? {} : { ambiguous: true, warning: 'Confirmar moneda y alcance del monto disponible.' },
      ));
    }
  }

  const budgetText = text.replace(
    /(?:\+?54\s*9?\s*)?(?:\(?\d{2,4}\)?[\s-]*)?\d{3,4}[\s-]*\d{4}/g,
    (phone) => phone.replace(/\D/g, '').length >= 10 ? ' '.repeat(phone.length) : phone,
  );
  const single = budgetText.match(/(?:(USD|ARS|US\$)\s*)?(\d{1,7}(?:[.\s]\d{3})+|\d{2,7})\s*(mil|k)?\s*(?:d[oó]lares?|pesos?)?/i);
  if (!results.length && single) {
    const localCurrency = single[1]?.toUpperCase().replace('US$', 'USD')
      || (/d[oó]lares?/i.test(single[0]) ? 'USD' : /pesos?/i.test(single[0]) ? 'ARS' : currency?.value);
    const raw = single[2] ?? '';
    const compact = raw.replace(/[.\s]/g, '');
    const bareLargeNumber = !localCurrency && !single[3] && /^\d{7,}$/.test(compact);
    const amount = parseAmountToken(raw, Boolean(single[3]) || Boolean(localCurrency && !/[.\s,]/.test(raw) && Number(raw) >= 10 && Number(raw) < 1000));
    if (amount && amount >= 1000) {
      const evidence = sentenceEvidence(text, single.index ?? 0);
      results.push(suggestion(
        'budget',
        `${localCurrency ? `${localCurrency} ` : ''}${formatInteger(amount)}`,
        localCurrency && !bareLargeNumber ? 'Alta' : 'Baja',
        evidence,
        localCurrency && !bareLargeNumber ? {} : {
          ambiguous: true,
          warning: bareLargeNumber
            ? 'El importe no informa moneda ni contexto suficiente; requiere confirmación.'
            : 'Falta confirmar la moneda.',
        },
      ));
    }
  }
  if (currency) results.push(suggestion('currency', currency.value, 'Alta', currency.evidence));
  return results;
}

function extractName(text: string): QualificationSuggestion | null {
  const match = text.match(/\b(?:me llamo|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/i);
  return match?.[1] ? suggestion('name', match[1], 'Alta', sentenceEvidence(text, match.index ?? 0)) : null;
}

function extractPhone(text: string): QualificationSuggestion | null {
  const match = text.match(/(?:\+?54\s*9?\s*)?(?:\(?\d{2,4}\)?[\s-]*)?\d{3,4}[\s-]*\d{4}/);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15
    ? suggestion('phone', digits, 'Alta', sentenceEvidence(text, match.index ?? 0))
    : null;
}

function extractZones(text: string): QualificationSuggestion | null {
  const normalizedText = normalize(text);
  const found = zoneNames.filter((zone) => normalizedText.includes(normalize(zone)));
  const explicit = [...text.matchAll(/\b(?:zona|barrio|por)\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ.-]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ.-]+){0,2})/gi)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => typeof value === 'string' && !/^(que|donde|el|la)$/i.test(value));
  const zones = [...new Set([...found, ...explicit])].slice(0, 4);
  if (!zones.length) return null;
  const indexes = zones.map((zone) => normalizedText.indexOf(normalize(zone))).filter((value) => value >= 0);
  return suggestion('zones', zones.join(', '), zones.some((zone) => zoneNames.includes(zone)) ? 'Alta' : 'Media', sentenceEvidence(text, Math.min(...indexes, 0)));
}

function extractPropertyType(text: string): QualificationSuggestion | null {
  for (const [value, pattern] of propertyTypes) {
    const match = text.match(pattern);
    if (match) return suggestion('propertyType', value, 'Alta', sentenceEvidence(text, match.index ?? 0));
  }
  return null;
}

function extractOperation(text: string): QualificationSuggestion | null {
  const rent = text.match(/\b(?:alquilar|alquiler|rentar)\b/i);
  if (rent) return suggestion('operation', 'Alquiler', 'Alta', sentenceEvidence(text, rent.index ?? 0));
  const buy = text.match(/\b(?:comprar|compra|busco|buscando|adquirir)\b/i);
  return buy ? suggestion('operation', 'Compra', 'Media', sentenceEvidence(text, buy.index ?? 0)) : null;
}

function extractBedrooms(text: string): QualificationSuggestion | null {
  const numeric = text.match(/\b(\d+)\s*(?:dormitorios?|dorm\.?|habitaciones?)\b/i);
  if (numeric?.[1]) return suggestion('bedrooms', numeric[1], 'Alta', sentenceEvidence(text, numeric.index ?? 0));
  const words: Record<string, string> = { uno: '1', un: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5' };
  const word = text.match(/\b(uno|un|dos|tres|cuatro|cinco)\s+(?:dormitorios?|habitaciones?)\b/i);
  return word?.[1] ? suggestion('bedrooms', words[normalize(word[1])] ?? word[1], 'Alta', sentenceEvidence(text, word.index ?? 0)) : null;
}

function paymentSuggestions(text: string): QualificationSuggestion[] {
  const results: QualificationSuggestion[] = [];
  const cash = text.match(/\b(?:de contado|al contado|contado)\b/i);
  const mortgage = text.match(/\b(?:cr[eé]dito hipotecario|cr[eé]dito bancario|tengo cr[eé]dito|usar[ií]a cr[eé]dito)\b/i);
  const financing = text.match(/\b(?:financiacion|financiación|financiar|cuotas?|financiar el resto)\b/i);
  const combination = text.match(/\b(?:tengo una parte|pongo una parte|parte en efectivo|entrega y|financiar el resto|combinaci[oó]n)\b/i);

  if (cash && !mortgage && !financing) addUnique(results, suggestion('paymentMethod', 'Contado', 'Alta', sentenceEvidence(text, cash.index ?? 0)));
  else if (mortgage && (cash || financing || combination)) addUnique(results, suggestion('paymentMethod', 'Combinación', 'Alta', sentenceEvidence(text, mortgage.index ?? 0)));
  else if (mortgage) addUnique(results, suggestion('paymentMethod', 'Crédito hipotecario', 'Alta', sentenceEvidence(text, mortgage.index ?? 0)));
  else if (financing && (cash || combination)) addUnique(results, suggestion('paymentMethod', 'Combinación', 'Alta', sentenceEvidence(text, financing.index ?? 0)));
  else if (financing) addUnique(results, suggestion('paymentMethod', 'Financiación', 'Alta', sentenceEvidence(text, financing.index ?? 0)));

  if (financing) addUnique(results, suggestion('needsFinancing', 'Sí', 'Alta', sentenceEvidence(text, financing.index ?? 0)));

  const noNeed = text.match(/\b(?:no necesito cr[eé]dito|sin cr[eé]dito|pago de contado)\b/i);
  const notStarted = text.match(/\b(?:todav[ií]a no (?:inici[eé]|tramit[eé])|a[uú]n no (?:inici[eé]|tramit[eé])|no empec[eé] el cr[eé]dito|cr[eé]dito no iniciado)\b/i);
  const inProcess = text.match(/\b(?:cr[eé]dito en tr[aá]mite|lo estoy tramitando|present[eé] los papeles|en evaluaci[oó]n bancaria)\b/i);
  const preapproved = text.match(/\b(?:preaprobado|pre-aprobado)\b/i);
  const approved = text.match(/\b(?:cr[eé]dito aprobado|me aprobaron el cr[eé]dito|ya est[aá] aprobado)\b/i);
  if (preapproved) addUnique(results, suggestion('creditPossible', 'Preaprobado', 'Alta', sentenceEvidence(text, preapproved.index ?? 0)));
  else if (approved) addUnique(results, suggestion('creditPossible', 'Aprobado', 'Alta', sentenceEvidence(text, approved.index ?? 0)));
  else if (inProcess) addUnique(results, suggestion('creditPossible', 'En trámite', 'Alta', sentenceEvidence(text, inProcess.index ?? 0)));
  else if (notStarted) addUnique(results, suggestion('creditPossible', 'Todavía no iniciado', 'Alta', sentenceEvidence(text, notStarted.index ?? 0)));
  else if (noNeed || (cash && !mortgage && !financing)) addUnique(results, suggestion('creditPossible', 'No necesita', 'Alta', sentenceEvidence(text, (noNeed ?? cash)?.index ?? 0)));

  const approvedAmount = text.match(/\b(?:monto aprobado|cr[eé]dito aprobado|me aprobaron)(?:\s+(?:por|de|hasta))?\s*(?:(USD|ARS|US\$)\s*)?(\d{1,7}(?:[.\s]\d{3})*|\d{2,3})\s*(mil|k)?/i);
  if (approvedAmount) {
    const localCurrency = approvedAmount[1]?.toUpperCase().replace('US$', 'USD') || explicitCurrency(text)?.value;
    const raw = approvedAmount[2] ?? '';
    const amount = parseAmountToken(raw, Boolean(approvedAmount[3]) || Boolean(localCurrency && !/[.\s,]/.test(raw) && Number(raw) < 1000));
    if (amount) addUnique(results, suggestion(
      'creditApprovedAmount',
      `${localCurrency ? `${localCurrency} ` : ''}${formatInteger(amount)}`,
      localCurrency ? 'Alta' : 'Media',
      sentenceEvidence(text, approvedAmount.index ?? 0),
      localCurrency ? {} : { ambiguous: true, warning: 'Falta confirmar la moneda del monto aprobado.' },
    ));
  }
  return results;
}

function purposeSuggestion(text: string): QualificationSuggestion | null {
  const living = text.match(/\b(?:para vivir|vivienda propia|mudarnos?|vivir yo|vivir con)\b/i);
  if (living) return suggestion('purpose', 'Vivir', 'Alta', sentenceEvidence(text, living.index ?? 0));
  const invest = text.match(/\b(?:para invertir|inversion|inversión|renta|alquilarlo|rentabilidad)\b/i);
  if (invest) return suggestion('purpose', 'Invertir', 'Alta', sentenceEvidence(text, invest.index ?? 0));
  const other = text.match(/\b(?:para un familiar|para mi hijo|para mi hija|uso profesional|otra finalidad)\b/i);
  return other ? suggestion('purpose', 'Otra', 'Media', sentenceEvidence(text, other.index ?? 0)) : null;
}

function timeframeSuggestion(text: string): QualificationSuggestion | null {
  const noRush = text.match(/\b(?:sin apuro|no tengo apuro|solo averiguando)\b/i);
  if (noRush) return suggestion('purchaseTimeframe', 'Sin apuro', 'Alta', sentenceEvidence(text, noRush.index ?? 0));
  const immediate = text.match(/\b(?:esta semana|cuanto antes|lo antes posible|urgente|ya mismo|inmediato)\b/i);
  if (immediate) return suggestion('purchaseTimeframe', 'Inmediato', 'Alta', sentenceEvidence(text, immediate.index ?? 0));
  const short = text.match(/\b(?:este mes|en los pr[oó]ximos tres meses|este trimestre|dentro de [123] meses?|en [123] meses?)\b/i);
  if (short) return suggestion('purchaseTimeframe', '0-3 meses', 'Alta', sentenceEvidence(text, short.index ?? 0));
  const medium = text.match(/\b(?:entre tres y seis meses|3\s*(?:a|y|-)\s*6 meses|dentro de [456] meses?|en [456] meses?)\b/i);
  if (medium) return suggestion('purchaseTimeframe', '3-6 meses', 'Alta', sentenceEvidence(text, medium.index ?? 0));
  const later = text.match(/\b(?:m[aá]s adelante|el a[nñ]o que viene|a fin de a[nñ]o|para fin de a[nñ]o|despu[eé]s de seis meses)\b/i);
  return later ? suggestion('purchaseTimeframe', 'Más adelante', 'Media', sentenceEvidence(text, later.index ?? 0)) : null;
}

function knowsAreaSuggestion(text: string): QualificationSuggestion | null {
  const no = text.match(/\b(?:no conozco (?:la )?zona|nunca fui|no ubico (?:la )?zona)\b/i);
  if (no) return suggestion('knowsArea', 'No', 'Alta', sentenceEvidence(text, no.index ?? 0));
  const partial = text.match(/\b(?:conozco un poco|conozco parcialmente|pas[eé] por la zona)\b/i);
  if (partial) return suggestion('knowsArea', 'Parcialmente', 'Alta', sentenceEvidence(text, partial.index ?? 0));
  const yes = text.match(/\b(?:conozco (?:bien )?(?:la )?zona|vivo en la zona|trabajo en la zona|ya fui)\b/i);
  return yes ? suggestion('knowsArea', 'Sí', 'Alta', sentenceEvidence(text, yes.index ?? 0)) : null;
}

function advancementSuggestion(text: string): QualificationSuggestion | null {
  const sell = text.match(/\b(?:dependo de vender|primero tengo que vender|cuando venda|necesito vender antes)\b/i);
  if (sell) return suggestion('canMoveForward', 'Depende de vender', 'Alta', sentenceEvidence(text, sell.index ?? 0));
  const credit = text.match(/\b(?:dependo del cr[eé]dito|si me aprueban el cr[eé]dito|cuando salga el cr[eé]dito)\b/i);
  if (credit) return suggestion('canMoveForward', 'Depende del crédito', 'Alta', sentenceEvidence(text, credit.index ?? 0));
  const no = text.match(/\b(?:todav[ií]a no puedo avanzar|no tengo el dinero|no estoy listo para comprar)\b/i);
  if (no) return suggestion('canMoveForward', 'Todavía no', 'Alta', sentenceEvidence(text, no.index ?? 0));
  const yes = text.match(/\b(?:puedo avanzar|podr[ií]a avanzar|estoy listo para avanzar|tengo los fondos|tengo el dinero|podemos reservar)\b/i);
  return yes ? suggestion('canMoveForward', 'Sí', 'Alta', sentenceEvidence(text, yes.index ?? 0)) : null;
}

function urgencySuggestion(text: string): QualificationSuggestion | null {
  const high = text.match(/\b(?:urgente|cuanto antes|lo antes posible|esta semana|este mes|ya mismo|inmediato)\b/i);
  if (high) return suggestion('urgency', 'Alta', 'Alta', sentenceEvidence(text, high.index ?? 0));
  const low = text.match(/\b(?:sin apuro|no tengo apuro|solo averiguando|m[aá]s adelante)\b/i);
  return low ? suggestion('urgency', 'Baja', 'Alta', sentenceEvidence(text, low.index ?? 0)) : null;
}

function secondarySuggestions(text: string): QualificationSuggestion[] {
  const results: QualificationSuggestion[] = [];
  const garage = text.match(/\b(?:con|necesito|quiero|que tenga)\s+(?:una?\s+)?(?:cochera|garage|garaje)\b/i);
  const patio = text.match(/\b(?:con|necesito|quiero|que tenga)\s+(?:un\s+)?patio\b/i);
  const pool = text.match(/\b(?:con|necesito|quiero|que tenga)\s+(?:una?\s+)?(?:pileta|piscina)\b/i);
  const creditReady = text.match(/\b(?:necesito que sea |busco |debe ser )?apto cr[eé]dito\b/i);
  if (garage) addUnique(results, suggestion('garage', 'Sí', 'Alta', sentenceEvidence(text, garage.index ?? 0)));
  if (patio) addUnique(results, suggestion('patio', 'Sí', 'Alta', sentenceEvidence(text, patio.index ?? 0)));
  if (pool) addUnique(results, suggestion('pool', 'Sí', 'Alta', sentenceEvidence(text, pool.index ?? 0)));
  if (creditReady) addUnique(results, suggestion('requiresCreditReady', 'Sí', 'Alta', sentenceEvidence(text, creditReady.index ?? 0)));
  const preferences = text.match(/\b(?:prefiero|me gustar[ií]a|idealmente)\s+([^\n.!?]{5,160})/i);
  if (preferences?.[1]) addUnique(results, suggestion('preferences', compactEvidence(preferences[1]), 'Media', sentenceEvidence(text, preferences.index ?? 0)));
  const features = text.match(/\b(?:que tenga|con)\s+([^\n.!?]{5,160})/i);
  if (features?.[1]) addUnique(results, suggestion('features', compactEvidence(features[1]), 'Media', sentenceEvidence(text, features.index ?? 0)));
  return results;
}

function objectionSuggestion(text: string): QualificationSuggestion | null {
  const patterns = [
    /(?:pero|aunque)\s+([^\n.!?]{8,150})/i,
    /\b(?:dependo de|la condici[oó]n es)\s+([^\n.!?]{8,150})/i,
    /\b(?:sin expensas|con escritura|acepta mascotas)\b[^\n.!?]*/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return suggestion('objections', compactEvidence(match[0]), 'Media', sentenceEvidence(text, match.index ?? 0));
  }
  return null;
}

function nextActionSuggestion(text: string): QualificationSuggestion | null {
  const actions: Array<[string, RegExp]> = [
    ['Coordinar una visita', /\b(?:quiero ver|podemos ver|se puede ver|coordinar (?:una )?visita|agendar (?:una )?visita)\b/i],
    ['Enviar fotos y planos', /\b(?:mandame|enviame|pasame|compartime)\s+(?:las? )?(?:fotos|planos|informacion|información)\b/i],
    ['Llamar al cliente', /\b(?:llamame|podemos hablar|me llamas|me llamás)\b/i],
    ['Revisar una propuesta', /\b(?:te hago una oferta|mi oferta|propuesta|podemos negociar)\b/i],
    ['Confirmar financiación', /\b(?:consultar financiacion|confirmar cuotas|ver financiacion|ver financiación)\b/i],
  ];
  for (const [value, pattern] of actions) {
    const match = text.match(pattern);
    if (match) return suggestion('nextAction', value, 'Media', sentenceEvidence(text, match.index ?? 0));
  }
  return null;
}

function dateSuggestion(text: string, now: Date): QualificationSuggestion | null {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso?.[0]) return suggestion('nextFollowUp', iso[0], 'Alta', sentenceEvidence(text, iso.index ?? 0));
  const slash = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slash?.[1] && slash[2]) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    let year = slash[3] ? Number(slash[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return suggestion('nextFollowUp', `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, 'Alta', sentenceEvidence(text, slash.index ?? 0));
    }
  }
  const relative = text.match(/\b(?:mañana|manana)\b/i);
  if (relative) {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    return suggestion('nextFollowUp', localIsoDate(next), 'Media', sentenceEvidence(text, relative.index ?? 0));
  }
  return null;
}

function buildInterest(suggestions: QualificationSuggestion[], text: string): QualificationSuggestion | null {
  const type = suggestions.find((item) => item.field === 'propertyType')?.value;
  const bedrooms = suggestions.find((item) => item.field === 'bedrooms')?.value;
  const zones = suggestions.find((item) => item.field === 'zones')?.value;
  const operation = suggestions.find((item) => item.field === 'operation')?.value;
  if (!type && !zones) return null;
  const parts = [
    operation === 'Alquiler' ? 'Alquiler de' : '',
    type || 'Propiedad',
    bedrooms ? `de ${bedrooms} dormitorios` : '',
    zones ? `en ${zones}` : '',
  ].filter(Boolean);
  const evidence = suggestions.find((item) => ['propertyType', 'zones', 'bedrooms'].includes(item.field))?.evidence || compactEvidence(text);
  return suggestion('interest', parts.join(' '), type && zones ? 'Alta' : 'Media', evidence);
}

function currentOrSuggested(client: Client, suggestions: QualificationSuggestion[], field: QualificationField): string {
  const target = TARGET_FIELDS[field];
  const current = target ? client[target] : undefined;
  if (typeof current === 'number') return String(current);
  if (typeof current === 'string' && current.trim()) return current.trim();
  return suggestions.find((item) => item.field === field && !item.ambiguous)?.value || '';
}

function candidateWithSuggestions(client: Client, suggestions: QualificationSuggestion[]): Client {
  const candidate: Client = { ...client };
  suggestions.filter((item) => !item.ambiguous).forEach((item) => {
    const target = TARGET_FIELDS[item.field];
    if (!target) return;
    if (target === 'bedrooms') candidate.bedrooms = Number(item.value) || undefined;
    else (candidate as unknown as Record<string, unknown>)[target] = item.value;
  });
  return candidate;
}

function stageSuggestion(client: Client, text: string, suggestions: QualificationSuggestion[]): QualificationSuggestion {
  const normalized = normalize(text);
  const terminalWon = /\b(?:operacion cerrada|ya compre|firma realizada)\b/.test(normalized);
  const terminalLost = /\b(?:no busco mas|compre por otro lado|desisti)\b/.test(normalized);
  const reserved = /\b(?:reserve|sena pagada|quedo reservado)\b/.test(normalized);
  const negotiation = /\b(?:oferta|contraoferta|negociar|negociacion|bajar el precio|condiciones de pago)\b/.test(normalized);
  const visitConfirmed = /\b(?:visita confirmada|nos vemos|quedamos para ver|visita coordinada)\b/.test(normalized)
    && suggestions.some((item) => item.field === 'nextFollowUp');
  const qualified = commercialQualificationState(candidateWithSuggestions(client, suggestions)).state === 'Calificado';
  let stage: CommercialStage = 'Contactado';
  let reason = 'Existe una consulta comercial, pero todavía falta confirmar información esencial.';
  let terminalConfirmationRequired = false;
  if (terminalWon) {
    stage = 'Ganado'; reason = 'El texto contiene una confirmación explícita de cierre.'; terminalConfirmationRequired = true;
  } else if (terminalLost) {
    stage = 'Perdido'; reason = 'El texto contiene una confirmación explícita de cierre negativo.'; terminalConfirmationRequired = true;
  } else if (reserved) {
    stage = 'Reservado'; reason = 'Se detectó una reserva o seña explícita.'; terminalConfirmationRequired = true;
  } else if (negotiation) {
    stage = 'Negociación'; reason = 'Se conversa realmente sobre precio, oferta o condiciones.';
  } else if (visitConfirmed) {
    stage = 'Visita coordinada'; reason = 'La visita está explícitamente confirmada y tiene fecha.';
  } else if (qualified) {
    stage = 'Calificado'; reason = 'Hay presupuesto, forma de pago, zona, finalidad, plazo y capacidad razonable de avanzar.';
  }
  return suggestion('pipeline', stage, terminalConfirmationRequired ? 'Media' : 'Alta', reason, { terminalConfirmationRequired });
}

function temperatureSuggestion(client: Client, suggestions: QualificationSuggestion[]): QualificationSuggestion {
  const candidate = candidateWithSuggestions(client, suggestions);
  const urgency = normalize(candidate.urgency || candidate.purchaseTimeframe);
  const canMove = normalize(candidate.canMoveForward);
  const hasBudget = Boolean(candidate.budget && (candidate.currency || /\b(?:usd|ars|dolares|pesos)\b/i.test(candidate.budget)));
  const hasPayment = Boolean(candidate.paymentMethod);
  let temperature: Temperature = 'Tibio';
  let reason = 'Hay interés observable, pero todavía faltan señales suficientes para considerarlo caliente.';
  if (canMove === 'todavia no' || canMove === 'depende de vender') {
    temperature = 'Frío';
    reason = `La capacidad de avance detectada es: ${candidate.canMoveForward}.`;
  } else if ((urgency === 'alta' || urgency === 'inmediato' || urgency === '0-3 meses') && canMove === 'si' && hasBudget && hasPayment) {
    temperature = 'Caliente';
    reason = 'Urgencia, presupuesto, forma de pago y capacidad de avance aparecen en el texto.';
  }
  return suggestion('temperature', temperature, 'Media', reason);
}

function paymentUsesMortgageCredit(value: string): boolean {
  return normalize(value).includes('credito hipotecario');
}

export function missingQualificationQuestions(client: Client, suggestions: QualificationSuggestion[]): string[] {
  const budget = currentOrSuggested(client, suggestions, 'budget');
  const currency = currentOrSuggested(client, suggestions, 'currency')
    || (/\b(?:USD|d[oó]lares?)\b/i.test(budget) ? 'USD' : /\b(?:ARS|pesos?)\b/i.test(budget) ? 'ARS' : '');
  if (!budget) return ['¿Qué presupuesto aproximado manejás?'];
  if (!currency) return ['¿Ese presupuesto es en dólares o pesos?'];
  const payment = currentOrSuggested(client, suggestions, 'paymentMethod');
  if (!payment) return ['¿La compra sería de contado, con crédito o necesitás financiación?'];
  const creditStatus = currentOrSuggested(client, suggestions, 'creditPossible');
  if (paymentUsesMortgageCredit(payment) && !creditStatus) return ['¿El crédito ya está aprobado o todavía está en trámite?'];
  const needsFinancing = normalize(currentOrSuggested(client, suggestions, 'needsFinancing')) === 'si'
    || /financiacion|combinacion/.test(normalize(payment));
  const approvedAmount = currentOrSuggested(client, suggestions, 'creditApprovedAmount');
  if (needsFinancing && !approvedAmount && !/entrega|disponibles/.test(normalize(budget))) {
    return ['¿Qué monto podrías entregar y cuánto necesitarías financiar?'];
  }
  const canMove = currentOrSuggested(client, suggestions, 'canMoveForward');
  if (!canMove || normalize(canMove) === 'no confirmado') return ['¿Hoy podrías avanzar si aparece una opción adecuada?'];
  if (!currentOrSuggested(client, suggestions, 'purchaseTimeframe') && !currentOrSuggested(client, suggestions, 'urgency')) {
    return ['¿Buscás comprar pronto o no tenés apuro?'];
  }
  if (!currentOrSuggested(client, suggestions, 'zones')) return ['¿Qué zona o barrios priorizás hoy?'];
  if (!currentOrSuggested(client, suggestions, 'purpose')) return ['¿La propiedad sería para vivir, invertir o para otra finalidad?'];
  if (!currentOrSuggested(client, suggestions, 'knowsArea')) return ['¿Conocés la zona o querés que te cuente cómo es?'];
  return [];
}

export function visitReadiness(client: Client, suggestions: QualificationSuggestion[]): { warning: string | null; missing: string[] } {
  const candidate = candidateWithSuggestions(client, suggestions);
  const missing: string[] = [];
  if (!candidate.budget) missing.push('presupuesto');
  if (!candidate.currency && !/\b(?:USD|ARS|d[oó]lares?|pesos?)\b/i.test(candidate.budget || '')) missing.push('moneda');
  if (!candidate.paymentMethod) missing.push('forma de pago');
  if (paymentUsesMortgageCredit(candidate.paymentMethod || '') && !candidate.creditPossible) missing.push('situación del crédito');
  if (!candidate.canMoveForward || normalize(candidate.canMoveForward) === 'no confirmado') missing.push('capacidad de avance');
  if (!candidate.knowsArea || normalize(candidate.knowsArea) === 'no') missing.push('aceptación de la zona');
  return {
    warning: missing.length ? 'Conviene confirmar presupuesto y forma de pago antes de coordinar.' : null,
    missing,
  };
}

export function conversationQualificationText(conversation: WhatsAppConversation): string {
  return conversation.messages
    .filter((message) => message.direction === 'inbound')
    .map((message) => qualificationMessageText(message))
    .filter(Boolean)
    .join('\n');
}

export function qualificationMessageText(message: ConversationMessage): string {
  if (message.kind === 'audio' && message.transcript?.trim()) return message.transcript.trim();
  return String(message.text ?? '').trim();
}

export function analyzeLeadQualification(
  client: Client,
  text: string,
  source: QualificationSource,
  now = new Date(),
): QualificationAnalysis {
  const safeText = qualificationInputText(client, String(text ?? '')).slice(0, 40_000);
  const suggestions: QualificationSuggestion[] = [];
  addUnique(suggestions, extractName(safeText));
  addUnique(suggestions, extractPhone(safeText));
  addUnique(suggestions, extractZones(safeText));
  addUnique(suggestions, extractPropertyType(safeText));
  addUnique(suggestions, extractOperation(safeText));
  addUnique(suggestions, extractBedrooms(safeText));
  budgetSuggestions(safeText).forEach((item) => addUnique(suggestions, item));
  paymentSuggestions(safeText).forEach((item) => addUnique(suggestions, item));
  addUnique(suggestions, purposeSuggestion(safeText));
  addUnique(suggestions, timeframeSuggestion(safeText));
  addUnique(suggestions, knowsAreaSuggestion(safeText));
  addUnique(suggestions, advancementSuggestion(safeText));
  addUnique(suggestions, urgencySuggestion(safeText));
  secondarySuggestions(safeText).forEach((item) => addUnique(suggestions, item));
  addUnique(suggestions, objectionSuggestion(safeText));
  addUnique(suggestions, nextActionSuggestion(safeText));
  addUnique(suggestions, dateSuggestion(safeText, now));
  addUnique(suggestions, buildInterest(suggestions, safeText));
  addUnique(suggestions, stageSuggestion(client, safeText, suggestions));
  addUnique(suggestions, temperatureSuggestion(client, suggestions));
  const readiness = visitReadiness(client, suggestions);
  return {
    source,
    suggestions,
    missingQuestions: missingQualificationQuestions(client, suggestions),
    visitWarning: readiness.warning,
    visitMissingFields: readiness.missing,
    deterministic: true,
    intelligentUsed: false,
    providerAvailable: false,
    analyzedAt: now.toISOString(),
  };
}

function equivalent(left: unknown, right: unknown): boolean {
  return normalize(left) === normalize(right);
}

export function confirmedValue(client: Client, field: QualificationField): string {
  const target = TARGET_FIELDS[field];
  if (!target) return '';
  const value = client[target];
  return typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
}

export function suggestionBlockedByConfirmedValue(client: Client, item: QualificationSuggestion): boolean {
  if (item.field === 'pipeline' || item.field === 'temperature') return false;
  const current = confirmedValue(client, item.field);
  if (!current || equivalent(current, item.value)) return false;
  return item.confidence !== 'Alta' || Boolean(item.ambiguous);
}

export function applyQualificationReview(
  client: Client,
  reviewed: ReviewedQualificationSuggestion[],
  confirmTerminal = false,
  now = new Date(),
): QualificationApplicationResult {
  let next: Client = { ...client };
  const appliedFields: QualificationField[] = [];
  const alreadyConfirmedFields: QualificationField[] = [];
  const rejectedFields: QualificationField[] = [];
  const blockedFields: QualificationField[] = [];
  const reviewRequiredFields: QualificationField[] = [];

  for (const item of reviewed) {
    if (!item.accepted) {
      rejectedFields.push(item.field);
      if (item.ambiguous) reviewRequiredFields.push(item.field);
      continue;
    }
    const target = TARGET_FIELDS[item.field];
    const value = String(item.editedValue ?? item.value).trim();
    if (!target || !value) {
      rejectedFields.push(item.field);
      continue;
    }
    const current = confirmedValue(next, item.field);
    if (current && equivalent(current, value)) {
      alreadyConfirmedFields.push(item.field);
      continue;
    }
    if (item.field === 'pipeline') {
      const stage = normalizeCommercialStage(value);
      if ((stage === 'Ganado' || stage === 'Perdido' || stage === 'Reservado') && !confirmTerminal) {
        blockedFields.push(item.field);
        reviewRequiredFields.push(item.field);
        continue;
      }
    }
    if (suggestionBlockedByConfirmedValue(next, { ...item, value }) && !item.allowConfirmedOverwrite) {
      blockedFields.push(item.field);
      reviewRequiredFields.push(item.field);
      continue;
    }
    if (target === 'bedrooms') next.bedrooms = Number(value) || undefined;
    else (next as unknown as Record<string, unknown>)[target] = value;
    appliedFields.push(item.field);
  }

  if (appliedFields.includes('pipeline')) next = applyCommercialStage(next, String(next.pipeline));
  if (appliedFields.length) next.qualificationUpdatedAt = now.toISOString();
  return {
    client: next,
    appliedFields: uniqueFields(appliedFields),
    alreadyConfirmedFields: uniqueFields(alreadyConfirmedFields),
    rejectedFields: uniqueFields(rejectedFields),
    blockedFields: uniqueFields(blockedFields),
    reviewRequiredFields: uniqueFields(reviewRequiredFields),
  };
}

function activity(action: string, clientId: number, detail: string): Omit<ActivityEntry, 'id' | 'actorId' | 'createdAt'> {
  return { action, entityType: 'Cliente', entityId: clientId, detail };
}

export function qualificationActivities(
  clientId: number,
  analysis: QualificationAnalysis,
  result?: QualificationApplicationResult,
): Array<Omit<ActivityEntry, 'id' | 'actorId' | 'createdAt'>> {
  const entries = [activity(
    'Calificación analizada',
    clientId,
    `${sourceLabel(analysis.source)} · ${analysis.suggestions.length} sugerencias · ${analysis.missingQuestions.length ? '1 próxima pregunta' : 'sin preguntas prioritarias'}.`,
  )];
  if (result) {
    if (result.appliedFields.length) entries.push(activity('Sugerencias aplicadas', clientId, result.appliedFields.map((field) => FIELD_LABELS[field]).join(', ')));
    const discarded = uniqueFields([...result.rejectedFields, ...result.blockedFields]);
    if (discarded.length) entries.push(activity('Campos descartados', clientId, discarded.map((field) => FIELD_LABELS[field]).join(', ')));
  }
  if (!result && analysis.missingQuestions.length) entries.push(activity('Próxima pregunta generada', clientId, 'Se preparó una pregunta comercial prioritaria.'));
  return entries;
}

export function sourceLabel(source: QualificationSource): string {
  if (source === 'conversation') return 'Conversación asociada';
  if (source === 'whatsapp_text') return 'Texto de WhatsApp pegado';
  return 'Notas o transcripción pegada';
}

export function qualificationFieldLabel(field: QualificationField): string {
  return FIELD_LABELS[field];
}
