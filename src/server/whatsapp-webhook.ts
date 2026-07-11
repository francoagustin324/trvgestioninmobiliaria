import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const WHATSAPP_WEBHOOK_PATH = '/api/whatsapp/webhook';

export interface WhatsAppWebhookSummary {
  messageIds: string[];
  statusKeys: string[];
  phoneNumberIds: string[];
}

export interface WhatsAppWebhookEvent {
  duplicate: boolean;
  summary: WhatsAppWebhookSummary;
  payload: Record<string, unknown>;
}

export interface WhatsAppWebhookConfig {
  verifyToken: string;
  appSecret: string;
  deduplicator?: WebhookDeduplicator;
  onEvent?: (event: WhatsAppWebhookEvent) => void | Promise<void>;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

function sendText(response: ServerResponse, status: number, payload: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(payload);
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

export function getWebhookChallenge(requestUrl: string, verifyToken: string): string | null {
  const url = new URL(requestUrl, 'http://localhost');
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  return mode === 'subscribe' && token === verifyToken && challenge ? challenge : null;
}

export function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | string[] | undefined, appSecret: string): boolean {
  const signature = headerValue(signatureHeader).trim();
  if (!appSecret || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;

  const received = Buffer.from(signature.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function readRawBody(request: IncomingMessage, maxBytes = 1_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw new Error('La solicitud es demasiado grande.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function summarizeWhatsAppWebhook(payload: unknown): WhatsAppWebhookSummary {
  const messageIds: string[] = [];
  const statusKeys: string[] = [];
  const phoneNumberIds: string[] = [];
  const root = objectValue(payload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];

  for (const rawEntry of entries) {
    const entry = objectValue(rawEntry);
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const rawChange of changes) {
      const change = objectValue(rawChange);
      const value = objectValue(change?.value);
      const metadata = objectValue(value?.metadata);
      if (typeof metadata?.phone_number_id === 'string') phoneNumberIds.push(metadata.phone_number_id);

      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const rawMessage of messages) {
        const message = objectValue(rawMessage);
        if (typeof message?.id === 'string') messageIds.push(message.id);
      }

      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
      for (const rawStatus of statuses) {
        const status = objectValue(rawStatus);
        if (typeof status?.id === 'string' && typeof status?.status === 'string') {
          statusKeys.push(`${status.id}:${status.status}`);
        }
      }
    }
  }

  return {
    messageIds: unique(messageIds),
    statusKeys: unique(statusKeys),
    phoneNumberIds: unique(phoneNumberIds),
  };
}

export class WebhookDeduplicator {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 24 * 60 * 60_000, private readonly maxEntries = 5_000) {}

  isDuplicate(keys: string[], now = Date.now()): boolean {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }

    const normalized = unique(keys.filter(Boolean));
    const duplicate = normalized.length > 0 && normalized.every((key) => (this.seen.get(key) || 0) > now);
    for (const key of normalized) {
      if ((this.seen.get(key) || 0) <= now) this.seen.set(key, now + this.ttlMs);
    }

    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next().value as string | undefined;
      if (!oldest) break;
      this.seen.delete(oldest);
    }
    return duplicate;
  }
}

export async function handleWhatsAppWebhook(
  request: IncomingMessage,
  response: ServerResponse,
  config: WhatsAppWebhookConfig,
): Promise<boolean> {
  const url = new URL(request.url || '/', 'http://localhost');
  if (url.pathname !== WHATSAPP_WEBHOOK_PATH) return false;

  if (request.method === 'GET') {
    if (!config.verifyToken) {
      sendJson(response, 503, { ok: false, error: 'Webhook de WhatsApp no configurado.' });
      return true;
    }
    const challenge = getWebhookChallenge(request.url || '/', config.verifyToken);
    if (!challenge) {
      sendJson(response, 403, { ok: false, error: 'Verificación rechazada.' });
      return true;
    }
    sendText(response, 200, challenge);
    return true;
  }

  if (request.method === 'POST') {
    if (!config.appSecret) {
      sendJson(response, 503, { ok: false, error: 'Webhook de WhatsApp no configurado.' });
      return true;
    }

    try {
      const rawBody = await readRawBody(request);
      if (!verifyMetaSignature(rawBody, request.headers['x-hub-signature-256'], config.appSecret)) {
        sendJson(response, 401, { ok: false, error: 'Firma inválida.' });
        return true;
      }

      const parsed: unknown = JSON.parse(rawBody.toString('utf8') || '{}');
      const payload = objectValue(parsed);
      if (!payload) {
        sendJson(response, 400, { ok: false, error: 'Payload inválido.' });
        return true;
      }

      const summary = summarizeWhatsAppWebhook(payload);
      const eventKeys = [
        ...summary.messageIds.map((id) => `message:${id}`),
        ...summary.statusKeys.map((key) => `status:${key}`),
      ];
      const duplicate = config.deduplicator?.isDuplicate(eventKeys) || false;
      if (!duplicate || eventKeys.length === 0) await config.onEvent?.({ duplicate, summary, payload });

      sendJson(response, 200, { received: true, duplicate });
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : 'No se pudo procesar el webhook.',
      });
    }
    return true;
  }

  sendJson(response, 405, { ok: false, error: 'Método no permitido.' });
  return true;
}
