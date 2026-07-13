import type { Client, Property } from './models.js';

export type MatchLevel = 'Alta' | 'Buena' | 'Posible';

export interface PropertyMatch {
  client: Client;
  property: Property;
  score: number;
  level: MatchLevel;
  reasons: string[];
  warnings: string[];
}

const terminalPipelines = new Set(['cerrado', 'perdido']);
const availableStatuses = new Set(['activa', 'disponible']);

const typeAliases: Record<string, string[]> = {
  Departamento: ['departamento', 'depto', 'dpto'],
  Casa: ['casa', 'duplex', 'duplex', 'chalet'],
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
  const currencyContext = /usd|u\$s|us\$|dolar/.test(normalizeText(raw));
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
  return !terminalPipelines.has(normalizeText(client.pipeline)) && normalizeText(client.status) !== 'cerrado';
}

export function evaluatePropertyMatch(client: Client, property: Property): PropertyMatch | null {
  if (!isEligibleClient(client) || !isEligibleProperty(property)) return null;

  const clientText = normalizeText([client.interest, client.objections, client.notes].join(' '));
  const propertyText = normalizeText([property.title, property.address, property.features, property.notes].join(' '));
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  const budget = parseUsdBudget(client.budget);
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

  const desiredType = requestedType(clientText);
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

  const desiredBedrooms = extractBedrooms(clientText);
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

  const clientPayment = requestedPaymentTerms(client.paymentMethod);
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

export function matchPropertiesForClient(client: Client, properties: Property[]): PropertyMatch[] {
  return properties
    .map((property) => evaluatePropertyMatch(client, property))
    .filter((match): match is PropertyMatch => match !== null)
    .sort((left, right) => right.score - left.score || left.property.price - right.property.price);
}

export function matchClientsForProperty(property: Property, clients: Client[]): PropertyMatch[] {
  return clients
    .map((client) => evaluatePropertyMatch(client, property))
    .filter((match): match is PropertyMatch => match !== null)
    .sort((left, right) => right.score - left.score || left.client.name.localeCompare(right.client.name, 'es'));
}
