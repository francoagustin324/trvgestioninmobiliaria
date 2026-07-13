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

type PatternRule = [RegExp, string];

const commercialPatterns: PatternRule[] = [
  [/(soy|somos) (corredor|corredora|martillero|martillera|asesor inmobiliario|asesora inmobiliaria|agente inmobiliario|agente inmobiliaria|broker inmobiliario|broker inmobiliaria|inmobiliaria|constructor|constructora|desarrollista)/, 'La persona se identificó como profesional o empresa del sector.'],
  [/(soy|somos) (vendedor|vendedora) (inmobiliario|inmobiliaria|de (una )?(inmobiliaria|constructora|desarrollista)|de propiedades|de desarrollos)/, 'La persona se identificó como vendedor del sector inmobiliario.'],
  [/soy de (una )?(inmobiliaria|constructora|desarrollista)/, 'Indicó que pertenece a una empresa del sector.'],
  [/(trabajo|represento) (en|para|a) (una )?(inmobiliaria|constructora|desarrollista)/, 'Indicó que trabaja para una inmobiliaria, constructora o desarrollista.'],
  [/trabajo como (corredor|corredora|martillero|martillera|vendedor inmobiliario|vendedora inmobiliaria)/, 'Indicó un rol profesional inmobiliario.'],
  [/(trabajo en ventas inmobiliarias|soy del equipo comercial)/, 'Indicó que pertenece a un equipo comercial inmobiliario.'],
  [/(te|les) (comparto|paso|envio|mando) (una )?(propiedad|producto|unidad|departamento|depto|casa|disponibilidad)/, 'El mensaje comparte producto inmobiliario en lugar de expresar una búsqueda.'],
  [/(comparto|compartimos) comision/, 'Mencionó colaboración o comisión entre colegas.'],
  [/soy (el )?(propietario|dueno)/, 'Se identificó como propietario.'],
  [/(quiero|necesito) vender (mi|una|un) (casa|departamento|depto|propiedad|terreno)/, 'La intención principal detectada es vender una propiedad.'],
  [/tengo (unidades|propiedades|departamentos|deptos|casas) para ofrecer/, 'Indicó que tiene inventario inmobiliario para ofrecer.'],
  [/(vendo|estoy vendiendo) (departamentos|deptos|casas|unidades|propiedades)( de pozo| disponibles| en)?/, 'Indicó que comercializa productos inmobiliarios.'],
];

const stoppedPatterns: PatternRule[] = [
  [/(no busco mas|ya no busco|no estoy buscando|ya no estoy buscando|ya no seguimos buscando|no buscamos mas|deje de buscar|dejamos de buscar|no sigo buscando|no seguimos buscando)/, 'Indicó explícitamente que dejó de buscar.'],
  [/(no quiero comprar|no queremos comprar|desistimos de comprar|no voy a comprar|no vamos a comprar|no compro|decidi no comprar)/, 'Indicó explícitamente que no continuará con la compra.'],
  [/(no me escribas|no me escriban|no me contacten|no quiero recibir mensajes|sacame de la lista|borrenme|no hace falta que me mandes mas)/, 'Pidió no recibir más mensajes.'],
  [/(por ahora no busco|suspendi la busqueda|pausamos la busqueda|cancele la busqueda|cancelamos la compra|dimos de baja la busqueda|frene la busqueda)/, 'Indicó que la búsqueda fue pausada o cancelada.'],
  [/(no sigas buscando para mi|no necesitamos mas opciones|no quiero seguir viendo propiedades|prefiero no continuar con la busqueda|abandonamos la idea de comprar|gracias pero no buscamos mas|ya no necesito una propiedad|no tengo intencion de comprar)/, 'Indicó que no necesita continuar recibiendo opciones.'],
];

const boughtPatterns: PatternRule[] = [
  [/(ya|finalmente) (compre|compramos|consegui|conseguimos|encontre|encontramos|cerre|cerramos|sene|senamos|reserve|reservamos|adquiri|adquirimos|elegi|elegimos)/, 'Confirmó que la compra o elección ya fue resuelta.'],
  [/compramos (una|un) (casa|departamento|depto|propiedad|terreno)/, 'Confirmó que compró una propiedad.'],
  [/(compre|compramos) (por otro lado|con otra inmobiliaria)/, 'Confirmó que compró por otra vía.'],
  [/(ya resolvi|ya lo resolvimos|ya solucione|ya esta resuelta la compra|cerre con otra inmobiliaria|cerramos con otra inmobiliaria)/, 'Confirmó que la necesidad ya fue resuelta.'],
  [/(ya tengo|ya tenemos) (casa|departamento|depto|propiedad|donde mudarnos)/, 'Confirmó que ya tiene una propiedad o solución habitacional.'],
  [/(encontre|consegui) (una opcion|algo)( por mi cuenta| en otra zona)?/, 'Confirmó que encontró una alternativa.'],
  [/(concretamos la compra|firme por otro (departamento|depto|casa)|ya elegimos y compramos)/, 'Confirmó que la operación ya fue concretada.'],
];

const waitingSalePatterns: PatternRule[] = [
  [/(todavia no vendi|todavia no vendimos|aun no vendi|aun no vendimos|no pude vender|no pudimos vender|todavia no pude vender|no logre vender|no logramos vender)/, 'Todavía necesita vender antes de avanzar.'],
  [/(mi|el|la) (casa|departamento|depto|propiedad) no se vendio|no se vendio todavia/, 'La propiedad previa todavía no se vendió.'],
  [/(dependo de vender|dependemos de vender|dependo de la venta|dependemos de la venta)/, 'La compra depende de una venta previa.'],
  [/(primero|antes) (tengo que|tenemos que|debo|debemos|necesito|necesitamos) vender/, 'Necesita vender antes de comprar.'],
  [/(hasta que no venda|hasta que no vendamos|hasta vender no puedo|hasta vender no podemos)/, 'No puede avanzar hasta vender.'],
  [/(cuando venda|cuando vendamos|si vendo|si vendemos)/, 'El avance depende de concretar una venta.'],
  [/(estoy esperando vender|seguimos esperando vender)/, 'Está esperando concretar una venta antes de retomar.'],
  [/(estoy|estamos) vendiendo (mi|nuestra|la|el) (casa|departamento|depto|propiedad)/, 'Está vendiendo una propiedad antes de avanzar.'],
  [/la compra depende de vender|(necesito|necesitamos|tenemos que) vender antes de (comprar|avanzar)/, 'La compra depende de vender primero.'],
  [/mi propiedad sigue publicada|todavia tengo (la|el|mi) (casa|departamento|depto|propiedad) a la venta/, 'La propiedad previa sigue publicada.'],
];

const activeSearchPatterns: PatternRule[] = [
  [/(sigo|seguimos) (buscando|en la busqueda|con la busqueda)/, 'Confirmó explícitamente que continúa buscando.'],
  [/(todavia|aun) (busco|estoy buscando|estamos buscando|sigo buscando|necesito encontrar)/, 'Confirmó que la búsqueda continúa.'],
  [/(continuo|continuamos) (buscando|con la busqueda)/, 'Confirmó que continúa con la búsqueda.'],
  [/(mandame|pasame|enviame|compartime|mostrame) (mas )?(opciones|alternativas|propiedades|departamentos|deptos|casas)/, 'Pidió recibir nuevas opciones.'],
  [/(avisame|avisenme) (si|cuando) (aparece|aparezca|sale|salga|tengas|tengan|haya)( algo)?/, 'Pidió ser avisado cuando aparezca una opción.'],
  [/(quiero|queremos) seguir viendo/, 'Pidió continuar viendo propiedades.'],
  [/(?<!no )(estoy|estamos) buscando/, 'Expresó una búsqueda activa.'],
  [/(?<!no )(quiero|queremos|necesito|necesitamos) comprar/, 'Expresó intención activa de compra.'],
  [/me interesa ver opciones/, 'Pidió evaluar opciones.'],
  [/(busco|buscamos) (un|una|algo|casa|departamento|depto|propiedad|terreno|duplex)/, 'Describió una búsqueda inmobiliaria activa.'],
  [/estoy en busqueda activa/, 'Indicó expresamente que la búsqueda está activa.'],
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

function matchingSignals(normalized: string, patterns: PatternRule[], status: ConversationStatus, confidence: number): IntentSignal[] {
  return patterns
    .filter(([pattern]) => pattern.test(normalized))
    .map(([, reason]) => ({ status, confidence, reason }));
}

function signalFromText(text: string): IntentSignal | null {
  const normalized = normalizeAuditText(text);
  if (!normalized) return null;

  const groups: IntentSignal[][] = [
    matchingSignals(normalized, stoppedPatterns, 'No busca más', 99),
    matchingSignals(normalized, boughtPatterns, 'Ya compró', 98),
    matchingSignals(normalized, waitingSalePatterns, 'Esperando vender', 96),
    matchingSignals(normalized, activeSearchPatterns, 'Sigue buscando', 93),
  ];
  const matchedGroups = groups.filter((group) => group.length > 0);
  if (matchedGroups.length > 1) {
    return {
      status: 'Revisar manualmente',
      confidence: 40,
      reason: 'El mismo mensaje contiene señales comerciales contradictorias; no debe generar una acción automática.',
    };
  }
  return matchedGroups[0]?.[0] ?? null;
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
