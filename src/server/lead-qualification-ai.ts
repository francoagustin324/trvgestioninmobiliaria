import type { IncomingMessage, ServerResponse } from 'node:http';
import type { QualificationConfidence, QualificationField, QualificationSuggestion } from '../lead-qualification.js';

export interface LeadQualificationAiOptions {
  supabaseUrl: string;
  publishableKey: string;
  endpoint: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

const allowedFields = new Set<QualificationField>([
  'name', 'phone', 'zones', 'propertyType', 'operation', 'bedrooms', 'budget', 'currency',
  'paymentMethod', 'needsFinancing', 'creditPossible', 'creditApprovedAmount', 'purpose',
  'purchaseTimeframe', 'knowsArea', 'canMoveForward', 'interest', 'objections', 'urgency',
  'garage', 'patio', 'pool', 'requiresCreditReady', 'features', 'preferences', 'nextAction',
  'nextFollowUp', 'pipeline', 'temperature',
]);

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage, maxBytes = 60_000): Promise<Record<string, unknown>> {
  const contentType = String(request.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) throw new Error('La solicitud debe enviarse como JSON.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw new Error('El texto supera el límite permitido.');
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('El contenido no es válido.');
  return parsed as Record<string, unknown>;
}

function bearerToken(request: IncomingMessage): string {
  const header = String(request.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function authenticatedUser(token: string, options: LeadQualificationAiOptions): Promise<boolean> {
  if (!token || !options.supabaseUrl || !options.publishableKey) return false;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.supabaseUrl.replace(/\/+$/g, '')}/auth/v1/user`, {
    headers: {
      apikey: options.publishableKey,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  return response.ok;
}

function confidence(value: unknown): QualificationConfidence {
  if (value === 'Alta' || value === 'Media' || value === 'Baja') return value;
  const number = Number(value);
  if (number >= 0.85) return 'Alta';
  if (number >= 0.6) return 'Media';
  return 'Baja';
}

export function sanitizeIntelligentSuggestions(payload: unknown): QualificationSuggestion[] {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const raw = Array.isArray(record.suggestions) ? record.suggestions : [];
  return raw.flatMap<QualificationSuggestion>((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    const field = String(candidate.field || '') as QualificationField;
    const value = String(candidate.value || '').trim().slice(0, 500);
    const evidence = String(candidate.evidence || '').trim().replace(/\s+/g, ' ').slice(0, 220);
    if (!allowedFields.has(field) || !value || !evidence) return [];
    const level = confidence(candidate.confidence);
    return [{
      id: `intelligent-${field}-${index}`,
      field,
      label: String(candidate.label || field).slice(0, 80),
      value,
      confidence: level,
      confidenceScore: level === 'Alta' ? 88 : level === 'Media' ? 68 : 42,
      evidence,
      ambiguous: Boolean(candidate.ambiguous),
      warning: candidate.warning ? String(candidate.warning).slice(0, 220) : undefined,
      terminalConfirmationRequired: field === 'pipeline' && ['Ganado', 'Perdido', 'Reservado'].includes(value),
    }];
  }).slice(0, 20);
}

function providerPrompt(text: string, deterministic: unknown): string {
  return [
    'Analizá una conversación inmobiliaria en español.',
    'Devolvé JSON con {"suggestions":[{"field":"...","value":"...","confidence":"Alta|Media|Baja","evidence":"fragmento exacto","ambiguous":false,"warning":"..."}]}.',
    'No inventes datos ausentes. No asumas moneda.',
    'Priorizá presupuesto, moneda, forma de pago, situación del crédito, zona, finalidad, plazo y capacidad de avance.',
    'Tipo, dormitorios y características son secundarios: extraelos solo cuando aparezcan naturalmente y no los uses para exigir una ficha completa.',
    'No conviertas una consulta inicial en Calificado. Un pedido de visita sin presupuesto ni forma de pago no está calificado.',
    'Visita coordinada requiere confirmación explícita y fecha. Negociación requiere precio, oferta o condiciones.',
    'Ganado, Perdido y Reservado son solo sugerencias que requerirán confirmación humana.',
    `Extracción determinística previa: ${JSON.stringify(deterministic).slice(0, 12_000)}`,
    `Texto: ${text.slice(0, 30_000)}`,
  ].join('\n');
}

async function providerSuggestions(
  text: string,
  deterministic: unknown,
  options: LeadQualificationAiOptions,
): Promise<QualificationSuggestion[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(options.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Sos un extractor de datos inmobiliarios conservador y auditable.' },
        { role: 'user', content: providerPrompt(text, deterministic) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Proveedor de análisis no disponible (${response.status}).`);
  const payload = await response.json() as Record<string, unknown>;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {};
  const message = first.message && typeof first.message === 'object' ? first.message as Record<string, unknown> : {};
  const content = String(message.content || '');
  const parsed: unknown = JSON.parse(content || '{}');
  return sanitizeIntelligentSuggestions(parsed);
}

export function leadQualificationAiConfigured(options: LeadQualificationAiOptions): boolean {
  return Boolean(options.endpoint && options.apiKey && options.model);
}

export async function handleLeadQualificationAi(
  request: IncomingMessage,
  response: ServerResponse,
  options: LeadQualificationAiOptions,
): Promise<boolean> {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  if (pathname !== '/api/lead-qualification/analyze') return false;
  if (request.method !== 'POST') {
    sendJson(response, 405, { available: leadQualificationAiConfigured(options), error: 'Método no permitido.' });
    return true;
  }
  if (!leadQualificationAiConfigured(options)) {
    sendJson(response, 200, { available: false, suggestions: [] });
    return true;
  }
  try {
    const token = bearerToken(request);
    if (!await authenticatedUser(token, options)) {
      sendJson(response, 401, { available: true, error: 'Sesión no válida.' });
      return true;
    }
    const body = await readJson(request);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw new Error('Falta el texto para analizar.');
    const suggestions = await providerSuggestions(text, body.deterministic, options);
    sendJson(response, 200, { available: true, suggestions });
  } catch (error) {
    sendJson(response, 422, {
      available: true,
      suggestions: [],
      error: error instanceof Error ? error.message : 'No se pudo ejecutar el análisis inteligente.',
    });
  }
  return true;
}
