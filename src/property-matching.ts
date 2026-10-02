import { isTerminalClient } from './lead-pipeline.js';
import type { ActivityEntry, Client, Property } from './models.js';

export type MatchLevel = 'Alta' | 'Buena' | 'Posible';

export const MATCH_DISMISSED_ACTION = 'Match descartado';

function dismissedPropertyRevision(detail: string): number | null {
  const match = detail.match(/(?:^|\n)propertyRevision=(\d+)(?:\n|$)/);
  if (!match?.[1]) return null;
  const revision = Number(match[1]);
  return Number.isFinite(revision) && revision >= 0 ? revision : null;
}

export function matchDismissalActive(
  client: Client,
  property: Property,
  activityLog: readonly ActivityEntry[],
): boolean {
  const dismissal = activityLog
    .filter((entry) => (
      entry.action === MATCH_DISMISSED_ACTION
      && entry.entityType === 'Cliente'
      && entry.entityId === client.id
      && entry.diffusionPropertyId === property.id
    ))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!dismissal) return false;

  if (
    client.qualificationUpdatedAt
    && Number.isFinite(Date.parse(client.qualificationUpdatedAt))
    && Date.parse(client.qualificationUpdatedAt) > Date.parse(dismissal.createdAt)
  ) {
    return false;
  }

  const dismissedRevision = dismissedPropertyRevision(dismissal.detail);
  const currentRevision = Number(property.revision ?? 0);
  if (dismissedRevision !== null && Number.isFinite(currentRevision) && currentRevision > dismissedRevision) {
    return false;
  }

  return true;
}

export interface PropertyMatch {
  client: Client;
  property: Property;
  score: number;
  level: MatchLevel;
  reasons: string[];
  warnings: string[];
}

const availableStatuses = new Set(['activa', 'disponible']);

const typeAliases: Record<string, string[]> = {
  Departamento: ['departamento', 'depto', 'dpto'],
  Casa: ['casa', 'duplex', 'dúplex', 'chalet'],
  Terreno: ['terreno', 'lote'],
  Comercial: ['comercial', 'local', 'oficina'],
};

const featureAliases: Record<string, string[]> = {
  balcón: ['balcon'],
  cochera: ['cochera', 'garage', 'garaje'],
  pileta: ['pileta', 'piscina'],
  patio: ['patio'],
  terraza: ['terraza'],
  vestidor: ['vestidor'],
  seguridad: ['seguridad', 'vigilancia'],
  gas: ['gas natural', 'gas'],
  escritura: ['escritura'],
  crédito: ['apto credito', 'credito hipotecario', 'credito'],
  financiación: ['financiacion', 'cuotas'],
  ascensor: ['ascensor'],
  luminoso: ['luminoso', 'luz natural'],
};

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumericToken(raw: string): number {
  const compact = raw.replace(/\s/g, '');
  if (/^\d{1,3}(?:\.\d{3})+$/.test(compact)) return Number(compact.replace(/\./g, ''));
  if (/^\d{1,3}(?:,\d{3})+$/.test(compact)) return Number(compact.replace(/,/g, ''));
  return Number(compact.replace(',', '.'));
}

export function parseUsdBudget(value: string | undefined): number | null {
  const raw = String(value ?? '').toLowerCase();
  if (!raw.trim()) return null;
  const matches = [...raw.matchAll(/(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|mil)?/g)];
  const normalized = normalizeText(raw);
  const currencyContext = /\b(?:usd|us|u s|dolar|dolares)\b/.test(normalized);
  const amounts = matches
    .map((match) => {
      const number = parseNumericToken(match[1] ?? '');
      if (!Number.isFinite(number) || number <= 0) return 0;
      const suffix = match[2] ?? '';
      if (suffix === 'k' || suffix === 'mil') return number * 1000;
      if (currencyContext && number >= 10 && number < 1000) return number * 1000;
      return number;
    })
    .filter((amount) => amount > 0);
  return amounts.length ? Math.max(...amounts) : null;
}

function requestedType(text: string): string | null {
  const normalized = normalizeText(text);
  for (const [type, aliases] of Object.entries(typeAliases)) {
    if (aliases.some((alias) => normalized.includes(normalizeText(alias)))) return type;
  }
  return null;
}

function canonicalPropertyType(property: Property): string | null {
  const normalized = normalizeText(`${property.type} ${property.title}`);
  for (const [type, aliases] of Object.entries(typeAliases)) {
    if (normalizeText(property.type) === normalizeText(type) || aliases.some((alias) => normalized.includes(normalizeText(alias)))) return type;
  }
  return null;
}

const numberWords: Record<string, number> = { uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };

export function extractBedrooms(value: string): number | null {
  const normalized = normalizeText(value);
  const numeric = normalized.match(/\b(\d+)\s*(?:dormitorio|dormitorios|dorm|habitacion|habitaciones)\b/);
  if (numeric?.[1]) return Number(numeric[1]);
  for (const [word, number] of Object.entries(numberWords)) {
    if (new RegExp(`\\b${word}\\s+(?:dormitorio|dormitorios|habitacion|habitaciones)\\b`).test(normalized)) return number;
  }
  return null;
}

function propertyZone(property: Property): string {
  const firstSegment = property.address.split(',')[0]?.trim() ?? property.address;
  return normalizeText(firstSegment);
}

function includesAny(text: string, aliases: string[]): boolean {
  return aliases.some((alias) => text.includes(normalizeText(alias)));
}

function requestedFeatures(clientText: string): string[] {
  return Object.entries(featureAliases)
    .filter(([, aliases]) => includesAny(clientText, aliases))
    .map(([label]) => label);
}

function propertyHasFeature(propertyText: string, label: string): boolean {
  return includesAny(propertyText, featureAliases[label] ?? [label]);
}

function requestedPaymentTerms(value: string | undefined): string[] {
  const text = normalizeText(value);
  return ['contado', 'credito', 'financiacion', 'cuotas'].filter((term) => text.includes(term));
}

function matchLevel(score: number): MatchLevel {
  if (score >= 70) return 'Alta';
  if (score >= 50) return 'Buena';
  return 'Posible';
}

function isEligibleProperty(property: Property): boolean {
  const status = normalizeText(property.status);
  const operation = normalizeText(property.operation);
  return availableStatuses.has(status) && operation.includes('venta');
}

function isEligibleClient(client: Client): boolean {
  return !isTerminalClient(client);
}

export function evaluatePropertyMatch(client: Client, property: Property): PropertyMatch | null {
  if (!isEligibleClient(client) || !isEligibleProperty(property)) return null;

  const clientText = normalizeText([
    client.interest,
    client.zones,
    client.propertyType,
    client.operation,
    client.bedrooms ? `${client.bedrooms} dormitorios` : '',
    client.paymentMethod,
    client.needsFinancing,
    client.creditPossible,
    client.creditApprovedAmount,
    client.purchaseTimeframe,
    client.purpose,
    client.knowsArea,
    client.canMoveForward,
    client.objections,
    client.notes,
    client.urgency,
    client.garage,
    client.patio,
    client.pool,
    client.requiresCreditReady,
    client.features,
    client.preferences,
  ].join(' '));
  const propertyText = normalizeText([property.title, property.address, property.features, property.notes].join(' '));
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  const budget = parseUsdBudget([client.currency, client.budget].filter(Boolean).join(' '));
  if (budget) {
    const ratio = property.price / budget;
    if (ratio <= 1) {
      score += 35;
      reasons.push('Dentro del presupuesto');
    } else if (ratio <= 1.1) {
      score += 12;
      warnings.push(`Precio ${Math.ceil((ratio - 1) * 100)}% por encima del presupuesto`);
    } else {
      return null;
    }
  } else {
    warnings.push('Falta confirmar presupuesto');
  }

  const desiredType = requestedType(client.propertyType || clientText);
  const offeredType = canonicalPropertyType(property);
  if (desiredType && offeredType && desiredType !== offeredType) return null;
  if (desiredType && offeredType === desiredType) {
    score += 15;
    reasons.push(`Tipo: ${offeredType}`);
  }

  const zone = propertyZone(property);
  if (zone.length >= 4 && clientText.includes(zone)) {
    score += 25;
    reasons.push(`Zona: ${property.address.split(',')[0]?.trim() ?? property.address}`);
  }

  const desiredBedrooms = client.bedrooms ?? extractBedrooms(clientText);
  const offeredBedrooms = property.bedrooms ?? extractBedrooms(propertyText);
  if (desiredBedrooms && offeredBedrooms) {
    if (offeredBedrooms === desiredBedrooms) {
      score += 15;
      reasons.push(`${offeredBedrooms} dormitorios`);
    } else if (offeredBedrooms > desiredBedrooms) {
      score += 8;
      reasons.push(`${offeredBedrooms} dormitorios, cumple o supera`);
    } else {
      score -= 18;
      warnings.push(`Tiene ${offeredBedrooms} dormitorios y busca ${desiredBedrooms}`);
    }
  }

  const features = requestedFeatures(clientText);
  const matchingFeatures = features.filter((feature) => propertyHasFeature(propertyText, feature));
  if (matchingFeatures.length) {
    score += Math.min(15, matchingFeatures.length * 4);
    reasons.push(`Coinciden: ${matchingFeatures.join(', ')}`);
  }

  const clientPayment = requestedPaymentTerms([
    client.paymentMethod,
    client.needsFinancing,
    client.creditPossible,
    client.creditApprovedAmount,
  ].filter(Boolean).join(' '));
  const propertyPayment = requestedPaymentTerms(property.paymentMethod);
  if (clientPayment.length && propertyPayment.length) {
    const common = clientPayment.filter((term) => propertyPayment.includes(term));
    if (common.length) {
      score += 8;
      reasons.push('Forma de pago compatible');
    } else {
      score -= 5;
      warnings.push('Revisar forma de pago');
    }
  } else if (clientPayment.length && !property.paymentMethod) {
    warnings.push('La propiedad no informa forma de pago');
  }

  if (client.temperature === 'Caliente') score += 3;
  if (client.canMoveForward === 'Sí') score += 2;
  score = Math.max(0, Math.min(100, score));
  if (score < 30) return null;

  return { client, property, score, level: matchLevel(score), reasons, warnings };
}

type PropertyMatchTemplate = Omit<PropertyMatch, 'client'>;

const MATCH_PROFILE_CACHE_LIMIT = 96;
const propertyMatchCache = new WeakMap<Property[], Map<string, PropertyMatchTemplate[]>>();

export function propertyMatchCriteriaKey(client: Client): string {
  return normalizeText([
    client.status,
    client.pipeline,
    client.temperature,
    client.interest,
    client.zones,
    client.propertyType,
    client.operation,
    client.bedrooms,
    client.currency,
    client.budget,
    client.paymentMethod,
    client.needsFinancing,
    client.creditPossible,
    client.creditApprovedAmount,
    client.purchaseTimeframe,
    client.purpose,
    client.knowsArea,
    client.canMoveForward,
    client.objections,
    client.notes,
    client.urgency,
    client.garage,
    client.patio,
    client.pool,
    client.requiresCreditReady,
    client.features,
    client.preferences,
  ].filter((value) => value !== undefined && value !== null).join('|'));
}

interface RelevantPropertyIndex {
  eligible: Property[];
  byType: Map<string, Property[]>;
  byTypeZone: Map<string, Property[]>;
  byTypeBedrooms: Map<string, Property[]>;
}

const RELEVANT_MATCH_CANDIDATE_LIMIT = 36;
const relevantPropertyIndexCache = new WeakMap<Property[], RelevantPropertyIndex>();

function candidateTypeKey(property: Property): string {
  return canonicalPropertyType(property) ?? 'unknown';
}

function relevantPropertyIndex(properties: Property[]): RelevantPropertyIndex {
  const cached = relevantPropertyIndexCache.get(properties);
  if (cached) return cached;
  const eligible = properties.filter(isEligibleProperty);
  const byType = new Map<string, Property[]>();
  const byTypeZone = new Map<string, Property[]>();
  const byTypeBedrooms = new Map<string, Property[]>();
  const append = (map: Map<string, Property[]>, key: string, property: Property): void => {
    const bucket = map.get(key) ?? [];
    bucket.push(property);
    map.set(key, bucket);
  };
  for (const property of eligible) {
    const type = candidateTypeKey(property);
    append(byType, type, property);
    const zone = propertyZone(property);
    if (zone) append(byTypeZone, `${type}|${zone}`, property);
    const bedrooms = property.bedrooms ?? extractBedrooms(normalizeText([property.title, property.features, property.notes].join(' ')));
    if (bedrooms) append(byTypeBedrooms, `${type}|${bedrooms}`, property);
  }
  for (const buckets of [byType, byTypeZone, byTypeBedrooms]) {
    for (const bucket of buckets.values()) bucket.sort((left, right) => left.price - right.price || left.id - right.id);
  }
  const index = { eligible, byType, byTypeZone, byTypeBedrooms };
  relevantPropertyIndexCache.set(properties, index);
  return index;
}

function requestedZones(client: Client, index: RelevantPropertyIndex, type: string | null): string[] {
  const direct = String(client.zones ?? '')
    .split(/[,;|/]+/)
    .map((value) => normalizeText(value))
    .filter((value) => value.length >= 3);
  if (direct.length) return [...new Set(direct)];
  const text = normalizeText([client.interest, client.preferences, client.notes].join(' '));
  if (!text) return [];
  const prefix = `${type ?? 'unknown'}|`;
  const zones = new Set<string>();
  for (const key of index.byTypeZone.keys()) {
    if (type && !key.startsWith(prefix)) continue;
    const zone = key.slice(key.indexOf('|') + 1);
    if (zone.length >= 3 && text.includes(zone)) zones.add(zone);
    if (zones.size >= 4) break;
  }
  return [...zones];
}

function addCandidate(
  target: Map<string, Property>,
  property: Property,
): void {
  if (target.size >= RELEVANT_MATCH_CANDIDATE_LIMIT) return;
  const identity = String(property.uid ?? property.id);
  if (!target.has(identity)) target.set(identity, property);
}

function affordableEnd(bucket: Property[], budget: number | null): number {
  if (!budget) return bucket.length;
  const ceiling = budget * 1.1;
  let low = 0;
  let high = bucket.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((bucket[mid]?.price ?? Number.POSITIVE_INFINITY) <= ceiling) low = mid + 1;
    else high = mid;
  }
  return low;
}

function addCommercialBucket(
  target: Map<string, Property>,
  bucket: Property[],
  budget: number | null,
  maxAdd: number,
): void {
  if (!bucket.length || maxAdd <= 0 || target.size >= RELEVANT_MATCH_CANDIDATE_LIMIT) return;
  const end = affordableEnd(bucket, budget);
  if (end <= 0) return;
  const before = target.size;
  const half = Math.max(1, Math.floor(maxAdd / 2));

  for (let index = 0; index < Math.min(end, half) && target.size - before < maxAdd; index += 1) {
    addCandidate(target, bucket[index]!);
  }
  for (let index = end - 1; index >= 0 && target.size - before < maxAdd; index -= 1) {
    addCandidate(target, bucket[index]!);
  }
}

export function relevantPropertyCandidatesForClient(
  client: Client,
  properties: Property[],
): Property[] {
  if (!isEligibleClient(client)) return [];
  const index = relevantPropertyIndex(properties);
  const clientText = normalizeText([
    client.interest,
    client.zones,
    client.propertyType,
    client.operation,
    client.preferences,
    client.notes,
  ].join(' '));
  const desiredType = requestedType(client.propertyType || clientText);
  const typeKey = desiredType ?? null;
  const typeBucket = typeKey ? (index.byType.get(typeKey) ?? []) : index.eligible;
  const selected = new Map<string, Property>();
  const budget = parseUsdBudget([client.currency, client.budget].filter(Boolean).join(' '));

  for (const zone of requestedZones(client, index, typeKey)) {
    const bucket = typeKey
      ? index.byTypeZone.get(`${typeKey}|${zone}`) ?? []
      : index.eligible.filter((property) => propertyZone(property) === zone).sort((left, right) => left.price - right.price || left.id - right.id);
    addCommercialBucket(selected, bucket, budget, 12);
  }

  const desiredBedrooms = client.bedrooms ?? extractBedrooms(clientText);
  if (desiredBedrooms && typeKey) {
    for (const bedrooms of [desiredBedrooms, desiredBedrooms + 1, desiredBedrooms + 2]) {
      addCommercialBucket(
        selected,
        index.byTypeBedrooms.get(`${typeKey}|${bedrooms}`) ?? [],
        budget,
        8,
      );
    }
  }

  addCommercialBucket(
    selected,
    typeBucket,
    budget,
    RELEVANT_MATCH_CANDIDATE_LIMIT - selected.size,
  );
  return [...selected.values()];
}

export function matchRelevantPropertiesForClient(
  client: Client,
  properties: Property[],
): PropertyMatch[] {
  return relevantPropertyCandidatesForClient(client, properties)
    .map((property) => evaluatePropertyMatch(client, property))
    .filter((match): match is PropertyMatch => match !== null)
    .sort((left, right) => right.score - left.score || left.property.price - right.property.price);
}

function templatesForClient(client: Client, properties: Property[]): PropertyMatchTemplate[] {
  let cache = propertyMatchCache.get(properties);
  if (!cache) {
    cache = new Map();
    propertyMatchCache.set(properties, cache);
  }
  const criteriaKey = propertyMatchCriteriaKey(client);
  const cached = cache.get(criteriaKey);
  if (cached) return cached;

  const matches = properties
    .map((property) => evaluatePropertyMatch(client, property))
    .filter((match): match is PropertyMatch => match !== null)
    .sort((left, right) => right.score - left.score || left.property.price - right.property.price)
    .map(({ property, score, level, reasons, warnings }) => ({
      property,
      score,
      level,
      reasons: reasons.slice(),
      warnings: warnings.slice(),
    }));

  if (cache.size >= MATCH_PROFILE_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(criteriaKey, matches);
  return matches;
}

export function matchPropertiesForClient(client: Client, properties: Property[]): PropertyMatch[] {
  return templatesForClient(client, properties).map((match) => ({
    client,
    property: match.property,
    score: match.score,
    level: match.level,
    reasons: match.reasons.slice(),
    warnings: match.warnings.slice(),
  }));
}

export function matchClientsForProperty(property: Property, clients: Client[]): PropertyMatch[] {
  return clients
    .map((client) => evaluatePropertyMatch(client, property))
    .filter((match): match is PropertyMatch => match !== null)
    .sort((left, right) => right.score - left.score || left.client.name.localeCompare(right.client.name, 'es'));
}
