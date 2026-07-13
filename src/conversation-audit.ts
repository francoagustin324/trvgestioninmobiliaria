import type {
  Client,
  CommercialContact,
  ConversationAudit,
  ConversationMode,
  ConversationStatus,
  FollowUpDecision,
  Reminder,
  WhatsAppConversation,
} from './models.js';
import { phoneIdentity } from './phone-normalizer.js';

interface IntentSignal {
  status: ConversationStatus;
  confidence: number;
  reason: string;
}

const commercialPatterns: Array<[RegExp, string]> = [
  [/\b(soy|somos) (corredor|corredora|martillero|martillera|asesor inmobiliario|asesora inmobiliaria|inmobiliaria|constructor|constructora|desarrollista|vendedor|vendedora)\b/, 'La persona se identificó como profesional o empresa del sector.'],
  [/\b(trabajo|represento) (en|para) (una )?(inmobiliaria|constructora|desarrollista)\b/, 'Indicó que trabaja para una inmobiliaria, constructora o desarrollista.'],
  [/\b(trabajo en ventas|soy del equipo comercial)\b/, 'Indicó que pertenece a un equipo de ventas.'],
  [/\b(te|les) (comparto|paso|envio) (una )?(propiedad|producto|unidad|departamento|casa|disponibilidad)\b/, 'El mensaje comparte producto inmobiliario en lugar de expresar una búsqueda.'],
  [/\b(comparto|compartimos) comision\b/, 'Mencionó colaboración o comisión entre colegas.'],
  [/\bsoy propietario\b/, 'Se identificó como propietario.'],
  [/\b(quiero|necesito) vender (mi|una) (casa|departamento|depto|propiedad|terreno)\b/, 'La intención principal detectada es vender una propiedad.'],
];

const stoppedPatterns: Array<[RegExp, string]> = [
  [/\b(no busco mas|ya no busco|no estoy buscando|ya no estoy buscando|ya no seguimos buscando|deje de buscar|dejamos de buscar)\b/, 'Indicó explícitamente que dejó de buscar.'],
  [/\b(no quiero comprar|no queremos comprar|desistimos de comprar)\b/, 'Indicó explícitamente que no continuará con la compra.'],
  [/\b(no me escribas|no me escriban|no me contacten|no quiero recibir mensajes|sacame de la lista|borrenme)\b/, 'Pidió no recibir más mensajes.'],
  [/\b(por ahora no busco|suspendi la busqueda|pausamos la busqueda)\b/, 'Indicó que la búsqueda está suspendida.'],
];

const boughtPatterns: Array<[RegExp, string]> = [
  [/\b(ya compre|ya compramos|compramos una|ya conseguimos|ya consegui|ya encontramos|ya encontre)\b/, 'Confirmó que ya compró o encontró una propiedad.'],
  [/\b(ya resolvi|ya lo resolvimos|cerre con otra inmobiliaria|cerramos con otra inmobiliaria)\b/, 'Confirmó que la necesidad ya fue resuelta por otra vía.'],
];

const waitingSalePatterns: Array<[RegExp, string]> = [
  [/\b(todavia no vendi|todavia no vendimos|aun no vendi|aun no vendimos|no pude vender|no pudimos vender|todavia no pude vender)\b/, 'Todavía necesita vender antes de avanzar.'],
  [/\b(dependo de vender|dependemos de vender|primero tengo que vender|primero tenemos que vender|antes tengo que vender|hasta que no venda|cuando venda)\b/, 'La compra depende de una venta previa.'],
  [/\b(estoy esperando vender|seguimos esperando vender)\b/, 'Está esperando concretar una venta antes de retomar.'],
];

const activeSearchPatterns: Array<[RegExp, string]> = [
  [/\b(sigo buscando|seguimos buscando|sigo en la busqueda|seguimos en la busqueda|todavia busco|todavia estamos buscando|continuo buscando|continuamos buscando)\b/, 'Confirmó explícitamente que continúa buscando.'],
  [/\b(mandame opciones|mandame mas opciones|enviame opciones|avisame si aparece|quiero seguir viendo)\b/, 'Pidió recibir nuevas opciones.'],
  [/\b(estoy buscando|estamos buscando|quiero comprar|queremos comprar|me interesa ver opciones)\b/, 'Expresó una intención activa de compra.'],
];

export function normalizeAuditText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchingSignals(normalized: string, patterns: Array<[RegExp, string]>, status: ConversationStatus, confidence: number): IntentSignal[] {
  return patterns
    .filter(([pattern]) => pattern.test(normalized))
    .map(([, reason]) => ({ status, confidence, reason }));
}

function signalFromText(text: string): IntentSignal | null {
  const normalized = normalizeAuditText(text);
  if (!normalized) return null;

  const stopped = matchingSignals(normalized, stoppedPatterns, 'No busca más', 99);
  if (stopped.length) return stopped[0]!;

  const bought = matchingSignals(normalized, boughtPatterns, 'Ya compró', 98);
  if (bought.length) return bought[0]!;

  const waiting = matchingSignals(normalized, waitingSalePatterns, 'Esperando vender', 96);
  const active = matchingSignals(normalized, activeSearchPatterns, 'Sigue buscando', 93);
  if (waiting.length && active.length) {
    return {
      status: 'Revisar manualmente',
      confidence: 45,
      reason: 'El mismo mensaje indica que sigue buscando, pero también que depende de una venta previa.',
    };
  }
  if (waiting.length) return waiting[0]!;
  if (active.length) return active[0]!;
  return null;
}

function commercialSignal(messages: WhatsAppConversation['messages']): IntentSignal | null {
  for (const message of messages.filter((item) => item.direction === 'inbound')) {
    const normalized = normalizeAuditText(message.text);
    const match = commercialPatterns.find(([pattern]) => pattern.test(normalized));
    if (match) return { status: 'Contacto comercial', confidence: 98, reason: match[1] };
  }
  return null;
}

export function decisionForConversationStatus(status: ConversationStatus): FollowUpDecision {
  if (status === 'Sigue buscando') return 'Seguimiento supervisado';
  if (status === 'Esperando vender') return 'Pausar';
  if (status === 'Ya compró' || status === 'No busca más' || status === 'Contacto comercial') return 'No contactar';
  return 'Revisión manual';
}

function knownCommercialContact(phone: string, contacts: CommercialContact[]): CommercialContact | null {
  const identity = phoneIdentity(phone);
  if (!identity) return null;
  return contacts.find((contact) => phoneIdentity(contact.phone) === identity) ?? null;
}

export function auditConversation(
  conversation: WhatsAppConversation,
  client: Client | null,
  contacts: CommercialContact[],
  auditedAt = new Date().toISOString(),
): ConversationAudit {
  const knownContact = knownCommercialContact(conversation.phone, contacts);
  if (knownContact) {
    return {
      status: 'Contacto comercial',
      decision: 'No contactar',
      confidence: 100,
      reasons: [`El teléfono pertenece a ${knownContact.type}: ${knownContact.name}.`],
      auditedAt,
      source: 'Automático',
    };
  }

  const commercial = commercialSignal(conversation.messages);
  if (commercial) {
    return {
      status: commercial.status,
      decision: decisionForConversationStatus(commercial.status),
      confidence: commercial.confidence,
      reasons: [commercial.reason],
      auditedAt,
      source: 'Automático',
    };
  }

  const inbound = conversation.messages.filter((message) => message.direction === 'inbound');
  for (const message of [...inbound].reverse()) {
    const signal = signalFromText(message.text);
    if (!signal) continue;
    const reasons = [signal.reason, 'Se tomó el último estado explícito del cliente dentro del historial disponible.'];
    if (signal.status === 'Sigue buscando' && client?.canMoveForward === 'No') {
      return {
        status: 'Revisar manualmente',
        decision: 'Revisión manual',
        confidence: 70,
        reasons: [...reasons, 'El CRM indica que todavía no puede avanzar; se mantiene pausado hasta revisión.'],
        auditedAt,
        source: 'Automático',
      };
    }
    return {
      status: signal.status,
      decision: decisionForConversationStatus(signal.status),
      confidence: signal.confidence,
      reasons,
      auditedAt,
      source: 'Automático',
    };
  }

  const crmHints = normalizeAuditText([client?.notes, client?.objections, client?.purchaseTimeframe].join(' '));
  const waitingHint = waitingSalePatterns.find(([pattern]) => pattern.test(crmHints));
  if (waitingHint || client?.canMoveForward === 'No') {
    return {
      status: 'Esperando vender',
      decision: 'Pausar',
      confidence: waitingHint ? 82 : 65,
      reasons: [waitingHint?.[1] ?? 'El CRM indica que todavía no puede avanzar.', 'No se habilita contacto automático con información incompleta.'],
      auditedAt,
      source: 'Automático',
    };
  }

  return {
    status: 'Revisar manualmente',
    decision: 'Revisión manual',
    confidence: inbound.length ? 35 : 15,
    reasons: [inbound.length ? 'El historial no contiene una confirmación clara del estado actual.' : 'No hay mensajes entrantes para analizar.', 'Ante la duda, la conversación queda pausada.'],
    auditedAt,
    source: 'Automático',
  };
}

export function manualConversationAudit(status: ConversationStatus, auditedAt = new Date().toISOString()): ConversationAudit {
  return {
    status,
    decision: decisionForConversationStatus(status),
    confidence: 100,
    reasons: ['Estado confirmado manualmente por un usuario de la inmobiliaria.'],
    auditedAt,
    source: 'Manual',
  };
}

export function safeConversationMode(audit: ConversationAudit, current: ConversationMode): ConversationMode {
  if (current === 'Humano') return 'Humano';
  return audit.status === 'Sigue buscando' && audit.decision === 'Seguimiento supervisado' && audit.confidence >= 90
    ? 'IA supervisada'
    : 'Pausada';
}

export function auditAndProtectConversation(
  conversation: WhatsAppConversation,
  client: Client | null,
  contacts: CommercialContact[],
  auditedAt = new Date().toISOString(),
): WhatsAppConversation {
  if (conversation.audit?.source === 'Manual') {
    return { ...conversation, mode: safeConversationMode(conversation.audit, conversation.mode) };
  }
  const audit = auditConversation(conversation, client, contacts, auditedAt);
  return { ...conversation, audit, mode: safeConversationMode(audit, conversation.mode) };
}

export function auditAllConversations(
  conversations: WhatsAppConversation[],
  clients: Client[],
  contacts: CommercialContact[],
  auditedAt = new Date().toISOString(),
): WhatsAppConversation[] {
  return conversations.map((conversation) => auditAndProtectConversation(
    conversation,
    clients.find((client) => client.id === conversation.clientId) ?? null,
    contacts,
    auditedAt,
  ));
}

export function conversationAuditSummary(conversations: WhatsAppConversation[]): Record<ConversationStatus, number> {
  const summary: Record<ConversationStatus, number> = {
    'Sigue buscando': 0,
    'Esperando vender': 0,
    'Ya compró': 0,
    'No busca más': 0,
    'Contacto comercial': 0,
    'Revisar manualmente': 0,
  };
  conversations.forEach((conversation) => {
    if (conversation.audit) summary[conversation.audit.status] += 1;
  });
  return summary;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addWaitingSaleReminder(existing: Reminder[], client: Client, baseDate: string): { reminders: Reminder[]; added: number } {
  const candidate = {
    date: addDays(baseDate, 30),
    title: 'Revisar si pudo vender',
    related: `${client.name} · WhatsApp · ${client.interest}`,
    priority: 'Media',
  };
  const duplicate = existing.some((reminder) => reminder.date === candidate.date && reminder.title === candidate.title && reminder.related === candidate.related);
  if (duplicate) return { reminders: existing, added: 0 };
  const nextId = Math.max(0, ...existing.map((reminder) => reminder.id)) + 1;
  return { reminders: [...existing, { ...candidate, id: nextId }], added: 1 };
}
