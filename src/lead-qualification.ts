import { applyCommercialStage, commercialStage, localIsoDate, normalizeCommercialStage } from './lead-pipeline.js';
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
  | 'purpose'
  | 'purchaseTimeframe'
  | 'knowsArea'
  | 'canMoveForward'
  | 'interest'
  | 'objections'
  | 'urgency'
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
  rejectedFields: QualificationField[];
  blockedFields: QualificationField[];
}

const FIELD_LABELS: Record<QualificationField, string> = {
  name: 'Nombre',
  phone: 'Teléfono',
  zones: 'Zona o zonas',
  propertyType: 'Tipo de propiedad',
  operation: 'Operación',
  bedrooms: 'Dormitorios',
  budget: 'Presupuesto',
  currency: 'Moneda',
  paymentMethod: 'Forma de pago',
  needsFinancing: 'Necesita financiación',
  creditPossible: 'Posibilidad de crédito',
  purpose: 'Finalidad',
  purchaseTimeframe: 'Plazo de compra',
  knowsArea: 'Conoce la zona',
  canMoveForward: 'Capacidad para avanzar',
  interest: 'Propiedad de interés',
  objections: 'Objeciones o condicionantes',
  urgency: 'Urgencia',
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
  purpose: 'purpose',
  purchaseTimeframe: 'purchaseTimeframe',
  knowsArea: 'knowsArea',
  canMoveForward: 'canMoveForward',
  interest: 'interest',
  objections: 'objections',
  urgency: 'urgency',
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
  ['Dúplex', /\bduplex\b/i],
  ['Casa', /\b(?:casa|chalet)\b/i],
  ['Terreno', /\b(?:terreno|lote)\b/i],
  ['Local', /\blocal\b/i],
  ['Oficina', /\boficina\b/i],
];

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compactEvidence(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function sentenceEvidence(text: string, matchIndex: number): string {
  const start = Math.max(0, text.lastIndexOf('\n', matchIndex), text.lastIndexOf('.', matchIndex) + 1);
  const after = text.slice(matchIndex);
  const candidates = [after.indexOf('\n'), after.indexOf('.'), after.indexOf('?'), after.indexOf('!')]
    .filter((value) => value >= 0);
  const end = candidates.length ? matchIndex + Math.min(...candidates) + 1 : Math.min(text.length, matchIndex + 220);
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

  const delivery = text.match(/\bentrega(?:\s+de)?\s+(?:(USD|ARS|US\$)\s*)?(\d{1,7}(?:[.\s]\d{3})*|\d{2,3})\s*(mil|k)?[^\n.]{0,50}\b(?:cuotas?|financi)/i);
  if (delivery) {
    const localCurrency = delivery[1]?.toUpperCase().replace('US$', 'USD') || currency?.value;
    const amount = parseAmountToken(delivery[2] ?? '', Boolean(delivery[3]) || Boolean(localCurrency && Number(delivery[2]) < 1000));
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

  const availableAndFinance = text.match(/\b(?:tengo|dispongo de|cuento con)\s+(\d{2,7}(?:[.,]\d{3})?)\s*(mil|k)?[^\n.]{0,55}\b(?:financiar|financiacion|financiación|cuotas?|resto)/i);
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

  const single = text.match(/(?:(USD|ARS|US\$)\s*)?(\d{1,7}(?:[.\s]\d{3})+|\d{2,7})\s*(mil|k)?\s*(?:d[oó]lares?|pesos?)?/i);
  if (!results.length && single) {
    const localCurrency = single[1]?.toUpperCase().replace('US$', 'USD')
      || (/d[oó]lares?/i.test(single[0]) ? 'USD' : /pesos?/i.test(single[0]) ? 'ARS' : currency?.value);
    const raw = single[2] ?? '';
    const compact = raw.replace(/[.\s]/g, '');
    const bareLargeNumber = !localCurrency && !single[3] && /^\d{7,}$/.test(compact);
    const amount = parseAmountToken(raw, Boolean(single[3]) || Boolean(localCurrency && Number(raw) >= 10 && Number(raw) < 1000));
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
  const match = text.match(/\b(?:me llamo|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/);
  if (!match?.[1]) return null;
  return suggestion('name', match[1], 'Alta', sentenceEvidence(text, match.index ?? 0));
}

function extractPhone(text: string): QualificationSuggestion | null {
  const match = text.match(/(?:\+?54\s*9?\s*)?(?:\(?\d{2,4}\)?[\s-]*)?\d{3,4}[\s-]*\d{4}/);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return suggestion('phone', digits, 'Alta', sentenceEvidence(text, match.index ?? 0));
}

function extractZones(text: string): QualificationSuggestion | null {
  const normalizedText = normalize(text);
  const found = zoneNames.filter((zone) => normalizedText.includes(normalize(zone)));
  const explicit = [...text.matchAll(/\b(?:zona|barrio|por)\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ.-]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ.-]+){0,2})/g)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value) && !/^(que|donde|el|la)$/i.test(value));
  const zones = [...new Set([...found, ...explicit])].slice(0, 4);
  if (!zones.length) return null;
  const firstIndex = Math.max(0, Math.min(...zones.map((zone) => normalizedText.indexOf(normalize(zone))).filter((value) => value >= 0)));
  return suggestion('zones', zones.join(', '), zones.some((zone) => zoneNames.includes(zone)) ? 'Alta' : 'Media', sentenceEvidence(text, firstIndex));
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
  if (buy) return suggestion('operation', 'Compra', 'Media', sentenceEvidence(text, buy.index ?? 0));
  return null;
}

function extractBedrooms(text: string): QualificationSuggestion | null {
  const match = text.match(/\b(\d+)\s*(?:dormitorios?|dorm\.?|habitaciones?)\b/i);
  if (match?.[1]) return suggestion('bedrooms', match[1], 'Alta', sentenceEvidence(text, match.index ?? 0));
  const words: Record<string, string> = { uno: '1', un: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5' };
  const word = text.match(/\b(uno|un|dos|tres|cuatro|cinco)\s+(?:dormitorios?|habitaciones?)\b/i);
  if (word?.[1]) return suggestion('bedrooms', words[normalize(word[1])] ?? word[1], 'Alta', sentenceEvidence(text, word.index ?? 0));
  return null;
}

function paymentSuggestions(text: string): QualificationSuggestion[] {
  const results: QualificationSuggestion[] = [];
  const cash = text.match(/\b(?:de contado|al contado|contado)\b/i);
  const credit = text.match(/\b(?:credito hipotecario|crédito hipotecario|credito bancario|crédito bancario|preaprobado)\b/i);
  const financing = text.match(/\b(?:financiacion|financiación|financiar|cuotas?)\b/i);
  if (cash && !credit && !financing) addUnique(results, suggestion('paymentMethod', 'Contado', 'Alta', sentenceEvidence(text, cash.index ?? 0)));
  if (credit) {
    addUnique(results, suggestion('paymentMethod', 'Crédito hipotecario', 'Alta', sentenceEvidence(text, credit.index ?? 0)));
    addUnique(results, suggestion('creditPossible', /preaprobado|aprobado/i.test(credit[0]) ? 'Sí, preaprobado' : 'A confirmar', /preaprobado|aprobado/i.test(credit[0]) ? 'Alta' : 'Media', sentenceEvidence(text, credit.index ?? 0)));
  }
  if (financing) {
    addUnique(results, suggestion('needsFinancing', 'Sí', 'Alta', sentenceEvidence(text, financing.index ?? 0)));
    addUnique(results, suggestion('paymentMethod', cash || credit ? 'Mixto' : 'Financiación', 'Alta', sentenceEvidence(text, financing.index ?? 0)));
  }
  const noCredit = text.match(/\b(?:no califico para credito|no me dan credito|sin posibilidad de credito)\b/i);
  if (noCredit) addUnique(results, suggestion('creditPossible', 'No', 'Alta', sentenceEvidence(text, noCredit.index ?? 0)));
  const creditReady = text.match(/\b(?:apto credito|apto crédito|tengo credito|tengo crédito)\b/i);
  if (creditReady) addUnique(results, suggestion('creditPossible', 'Sí', 'Alta', sentenceEvidence(text, creditReady.index ?? 0)));
  return results;
}

function purposeSuggestion(text: string): QualificationSuggestion | null {
  const living = text.match(/\b(?:para vivir|vivienda propia|mudarnos?|vivir yo|vivir con)\b/i);
  if (living) return suggestion('purpose', 'Vivir', 'Alta', sentenceEvidence(text, living.index ?? 0));
  const invest = text.match(/\b(?:para invertir|inversion|inversión|renta|alquilarlo|rentabilidad)\b/i);
  if (invest) return suggestion('purpose', 'Invertir', 'Alta', sentenceEvidence(text, invest.index ?? 0));
  const other = text.match(/\b(?:para un familiar|para mi hijo|para mi hija|uso profesional)\b/i);
  if (other) return suggestion('purpose', 'Otra', 'Media', sentenceEvidence(text, other.index ?? 0));
  return null;
}

function timeframeSuggestion(text: string): QualificationSuggestion | null {
  const immediate = text.match(/\b(?:esta semana|este mes|cuanto antes|lo antes posible|urgente|ya mismo)\b/i);
  if (immediate) return suggestion('purchaseTimeframe', '0-30 días', 'Media', sentenceEvidence(text, immediate.index ?? 0));
  const months = text.match(/\b(?:en|dentro de)\s+(\d+)\s+meses?\b/i);
  if (months?.[1]) {
    const count = Number(months[1]);
    const value = count <= 3 ? '1-3 meses' : count <= 6 ? '3-6 meses' : count <= 12 ? '6-12 meses' : 'Más de 12 meses';
    return suggestion('purchaseTimeframe', value, 'Alta', sentenceEvidence(text, months.index ?? 0));
  }
  const quarter = text.match(/\b(?:en los proximos tres meses|en los próximos tres meses|este trimestre)\b/i);
  if (quarter) return suggestion('purchaseTimeframe', '1-3 meses', 'Alta', sentenceEvidence(text, quarter.index ?? 0));
  const year = text.match(/\b(?:este año|a fin de año|para fin de año)\b/i);
  if (year) return suggestion('purchaseTimeframe', '6-12 meses', 'Media', sentenceEvidence(text, year.index ?? 0));
  return null;
}

function knowsAreaSuggestion(text: string): QualificationSuggestion | null {
  const no = text.match(/\b(?:no conozco (?:la )?zona|nunca fui|no ubico (?:la )?zona)\b/i);
  if (no) return suggestion('knowsArea', 'No', 'Alta', sentenceEvidence(text, no.index ?? 0));
  const partial = text.match(/\b(?:conozco un poco|conozco parcialmente|pase por la zona|pasé por la zona)\b/i);
  if (partial) return suggestion('knowsArea', 'Parcialmente', 'Alta', sentenceEvidence(text, partial.index ?? 0));
  const yes = text.match(/\b(?:conozco (?:bien )?(?:la )?zona|vivo en la zona|trabajo en la zona|ya fui)\b/i);
  if (yes) return suggestion('knowsArea', 'Sí', 'Alta', sentenceEvidence(text, yes.index ?? 0));
  return null;
}

function advancementSuggestion(text: string): QualificationSuggestion | null {
  const sell = text.match(/\b(?:dependo de vender|primero tengo que vender|cuando venda|necesito vender antes)\b/i);
  if (sell) return suggestion('canMoveForward', 'Depende de vender', 'Alta', sentenceEvidence(text, sell.index ?? 0));
  const credit = text.match(/\b(?:dependo del credito|dependo del crédito|si me aprueban el credito|si me aprueban el crédito)\b/i);
  if (credit) return suggestion('canMoveForward', 'Depende de crédito', 'Alta', sentenceEvidence(text, credit.index ?? 0));
  const no = text.match(/\b(?:todavia no puedo avanzar|todavía no puedo avanzar|no tengo el dinero|no estoy listo para comprar)\b/i);
  if (no) return suggestion('canMoveForward', 'Todavía no', 'Alta', sentenceEvidence(text, no.index ?? 0));
  const yes = text.match(/\b(?:puedo avanzar|estoy listo para avanzar|tengo los fondos|tengo el dinero|podemos reservar)\b/i);
  if (yes) return suggestion('canMoveForward', 'Sí', 'Alta', sentenceEvidence(text, yes.index ?? 0));
  return null;
}

function objectionSuggestion(text: string): QualificationSuggestion | null {
  const patterns = [
    /(?:pero|aunque)\s+([^\n.!?]{8,150})/i,
    /\b(?:necesito|necesitamos|dependo de|condicion es|condición es)\s+([^\n.!?]{8,150})/i,
    /\b(?:sin expensas|con escritura|apto credito|apto crédito|acepta mascotas|con cochera)\b[^\n.!?]*/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return suggestion('objections', compactEvidence(match[0]), 'Media', sentenceEvidence(text, match.index ?? 0));
  }
  return null;
}

function urgencySuggestion(text: string): QualificationSuggestion | null {
  const high = text.match(/\b(?:urgente|cuanto antes|lo antes posible|esta semana|ya mismo)\b/i);
  if (high) return suggestion('urgency', 'Alta', 'Alta', sentenceEvidence(text, high.index ?? 0));
  const low = text.match(/\b(?:sin apuro|no tengo apuro|solo averiguando|más adelante|mas adelante)\b/i);
  if (low) return suggestion('urgency', 'Baja', 'Alta', sentenceEvidence(text, low.index ?? 0));
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
  const parts = [operation === 'Alquiler' ? 'Alquiler de' : '', type || 'Propiedad', bedrooms ? `de ${bedrooms} dormitorios` : '', zones ? `en ${zones}` : '']
    .filter(Boolean);
  const evidence = suggestions.find((item) => ['propertyType', 'zones', 'bedrooms'].includes(item.field))?.evidence || compactEvidence(text);
  return suggestion('interest', parts.join(' '), type && zones ? 'Alta' : 'Media', evidence);
}

function stageSuggestion(text: string, suggestions: QualificationSuggestion[]): QualificationSuggestion {
  const normalized = normalize(text);
  const terminalWon = /\b(?:operacion cerrada|operación cerrada|ya compre|ya compré|firma realizada)\b/.test(normalized);
  const terminalLost = /\b(?:no busco mas|no busco más|compre por otro lado|compré por otro lado|desisti|desistí)\b/.test(normalized);
  const reserved = /\b(?:reserve|reservé|seña pagada|sena pagada|quedo reservado|quedó reservado)\b/.test(normalized);
  const negotiation = /\b(?:oferta|contraoferta|negociar|negociacion|negociación|bajar el precio|condiciones de pago)\b/.test(normalized);
  const visitConfirmed = /\b(?:visita confirmada|nos vemos|quedamos para ver|visita coordinada)\b/.test(normalized)
    && suggestions.some((item) => item.field === 'nextFollowUp');
  const required = ['budget', 'currency', 'paymentMethod', 'purpose', 'purchaseTimeframe', 'zones', 'canMoveForward'];
  const qualified = required.filter((field) => suggestions.some((item) => item.field === field && !item.ambiguous)).length >= 5;
  let stage: CommercialStage = 'Contactado';
  let reason = 'Existe una consulta o intercambio comercial, pero todavía requiere confirmación.';
  let terminalConfirmationRequired = false;
  if (terminalWon) {
    stage = 'Ganado'; reason = 'El texto contiene una confirmación explícita de cierre.'; terminalConfirmationRequired = true;
  } else if (terminalLost) {
    stage = 'Perdido'; reason = 'El texto contiene una confirmación explícita de cierre negativo.'; terminalConfirmationRequired = true;
  } else if (reserved) {
    stage = 'Reservado'; reason = 'Se detectó una reserva o seña explícita.'; terminalConfirmationRequired = true;
  } else if (negotiation) {
    stage = 'Negociación'; reason = 'Se conversa sobre oferta, precio o condiciones.';
  } else if (visitConfirmed) {
    stage = 'Visita coordinada'; reason = 'La visita está explícitamente confirmada y tiene fecha.';
  } else if (qualified) {
    stage = 'Calificado'; reason = 'Hay suficientes datos comerciales confirmables para una calificación inicial.';
  }
  return suggestion('pipeline', stage, terminalConfirmationRequired ? 'Media' : 'Alta', reason, { terminalConfirmationRequired });
}

function temperatureSuggestion(text: string, suggestions: QualificationSuggestion[]): QualificationSuggestion {
  const urgency = suggestions.find((item) => item.field === 'urgency')?.value;
  const canMove = suggestions.find((item) => item.field === 'canMoveForward')?.value;
  const hasBudget = suggestions.some((item) => item.field === 'budget' && !item.ambiguous);
  const hasPayment = suggestions.some((item) => item.field === 'paymentMethod');
  let temperature: Temperature = 'Tibio';
  let reason = 'Hay interés observable, pero todavía faltan señales suficientes para clasificarlo como caliente.';
  if (canMove === 'Todavía no' || canMove === 'Depende de vender') {
    temperature = 'Frío';
    reason = `La capacidad de avance detectada es: ${canMove}.`;
  } else if (urgency === 'Alta' && canMove === 'Sí' && hasBudget && hasPayment) {
    temperature = 'Caliente';
    reason = 'Urgencia, presupuesto, forma de pago y capacidad de avance aparecen en el texto.';
  }
  return suggestion('temperature', temperature, 'Media', reason);
}

function currentOrSuggested(client: Client, suggestions: QualificationSuggestion[], field: QualificationField): string {
  const target = TARGET_FIELDS[field];
  const current = target ? client[target] : undefined;
  if (typeof current === 'number') return String(current);
  if (typeof current === 'string' && current.trim()) return current.trim();
  return suggestions.find((item) => item.field === field && !item.ambiguous)?.value || '';
}

export function missingQualificationQuestions(client: Client, suggestions: QualificationSuggestion[]): string[] {
  const questions: string[] = [];
  const budget = currentOrSuggested(client, suggestions, 'budget');
  const currency = currentOrSuggested(client, suggestions, 'currency');
  if (!budget || !currency) questions.push('¿Qué presupuesto manejás y en qué moneda?');
  if (!currentOrSuggested(client, suggestions, 'paymentMethod')) questions.push('¿La compra sería de contado, con crédito o necesitás financiación?');
  if (!currentOrSuggested(client, suggestions, 'purpose')) questions.push('¿La propiedad sería para vivir, invertir o para otra finalidad?');
  if (!currentOrSuggested(client, suggestions, 'purchaseTimeframe')) questions.push('¿En qué plazo estimás realizar la compra?');
  if (!currentOrSuggested(client, suggestions, 'zones')) questions.push('¿Qué zona o zonas priorizás?');
  if (!currentOrSuggested(client, suggestions, 'propertyType') || !currentOrSuggested(client, suggestions, 'bedrooms')) questions.push('¿Qué tipo de propiedad buscás y cuántos dormitorios necesitás?');
  if (!currentOrSuggested(client, suggestions, 'canMoveForward')) questions.push('¿Hoy podrías avanzar económicamente si aparece una opción adecuada?');
  if (!currentOrSuggested(client, suggestions, 'knowsArea')) questions.push('¿Conocés la ubicación y sus alrededores?');
  return questions.slice(0, 3);
}

export function visitReadiness(client: Client, suggestions: QualificationSuggestion[]): { warning: string | null; missing: string[] } {
  const checks: Array<[QualificationField, string]> = [
    ['budget', 'presupuesto o rango'],
    ['currency', 'moneda'],
    ['paymentMethod', 'forma de pago'],
    ['knowsArea', 'conocimiento mínimo de la zona'],
    ['canMoveForward', 'posibilidad real de avanzar'],
    ['objections', 'aceptación de las condiciones principales'],
  ];
  const missing = checks
    .filter(([field]) => !currentOrSuggested(client, suggestions, field))
    .map(([, label]) => label);
  return {
    warning: missing.length ? 'Faltan datos para considerar este Lead calificado para visita.' : null,
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
  const safeText = String(text ?? '').trim().slice(0, 40_000);
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
  addUnique(suggestions, objectionSuggestion(safeText));
  addUnique(suggestions, urgencySuggestion(safeText));
  addUnique(suggestions, nextActionSuggestion(safeText));
  addUnique(suggestions, dateSuggestion(safeText, now));
  addUnique(suggestions, buildInterest(suggestions, safeText));
  addUnique(suggestions, stageSuggestion(safeText, suggestions));
  addUnique(suggestions, temperatureSuggestion(safeText, suggestions));
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

export function suggestionBlockedByConfirmedValue(client: Client, suggestionItem: QualificationSuggestion): boolean {
  const current = confirmedValue(client, suggestionItem.field);
  if (!current || equivalent(current, suggestionItem.value)) return false;
  return suggestionItem.confidence !== 'Alta' || Boolean(suggestionItem.ambiguous);
}

export function applyQualificationReview(
  client: Client,
  reviewed: ReviewedQualificationSuggestion[],
  confirmTerminal = false,
): QualificationApplicationResult {
  let next: Client = { ...client };
  const appliedFields: QualificationField[] = [];
  const rejectedFields: QualificationField[] = [];
  const blockedFields: QualificationField[] = [];

  for (const item of reviewed) {
    if (!item.accepted) {
      rejectedFields.push(item.field);
      continue;
    }
    const target = TARGET_FIELDS[item.field];
    const value = String(item.editedValue ?? item.value).trim();
    if (!target || !value) {
      rejectedFields.push(item.field);
      continue;
    }
    if (item.field === 'pipeline') {
      const stage = normalizeCommercialStage(value);
      if ((stage === 'Ganado' || stage === 'Perdido' || stage === 'Reservado') && !confirmTerminal) {
        blockedFields.push(item.field);
        continue;
      }
    }
    if (suggestionBlockedByConfirmedValue(next, { ...item, value }) && !item.allowConfirmedOverwrite) {
      blockedFields.push(item.field);
      continue;
    }
    if (target === 'bedrooms') (next as Client & { bedrooms?: number }).bedrooms = Number(value) || undefined;
    else (next as unknown as Record<string, unknown>)[target] = value;
    if (!appliedFields.includes(item.field)) appliedFields.push(item.field);
  }

  if (appliedFields.includes('pipeline')) next = applyCommercialStage(next, String(next.pipeline));
  else next = applyCommercialStage(next, commercialStage(next));
  return { client: next, appliedFields, rejectedFields, blockedFields };
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
    `${sourceLabel(analysis.source)} · ${analysis.suggestions.length} sugerencias · ${analysis.missingQuestions.length} preguntas faltantes.`,
  )];
  if (result) {
    if (result.appliedFields.length) entries.push(activity('Sugerencias aplicadas', clientId, result.appliedFields.map((field) => FIELD_LABELS[field]).join(', ')));
    const discarded = [...new Set([...result.rejectedFields, ...result.blockedFields])];
    if (discarded.length) entries.push(activity('Campos descartados', clientId, discarded.map((field) => FIELD_LABELS[field]).join(', ')));
  }
  if (analysis.missingQuestions.length) entries.push(activity('Preguntas faltantes generadas', clientId, `${analysis.missingQuestions.length} preguntas concretas preparadas.`));
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
