import type {
  Client,
  CommercialContact,
  ConversationAudit,
  ConversationMessage,
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
  engine: 'Reglas de seguridad' | 'Comprensión por conceptos';
}

interface PhraseGroup {
  phrases: readonly string[];
  reason: string;
}

const commercialGroups: PhraseGroup[] = [
  {
    phrases: [
      'soy corredor', 'soy corredora', 'soy martillero', 'soy martillera',
      'soy asesor inmobiliario', 'soy asesora inmobiliaria', 'soy agente inmobiliario',
      'soy agente inmobiliaria', 'soy broker inmobiliario', 'soy broker inmobiliaria',
      'soy constructor', 'soy constructora', 'soy desarrollista',
    ],
    reason: 'La persona se identificó como profesional del sector inmobiliario.',
  },
  {
    phrases: [
      'soy vendedor inmobiliario', 'soy vendedora inmobiliaria',
      'soy vendedor de una constructora', 'soy vendedora de una constructora',
      'soy vendedor de la constructora', 'soy vendedora de la constructora',
      'soy vendedor de una inmobiliaria', 'soy vendedora de una inmobiliaria',
      'trabajo como vendedor inmobiliario', 'trabajo como vendedora inmobiliaria',
      'trabajo en ventas inmobiliarias', 'soy del equipo comercial',
    ],
    reason: 'La persona se identificó como vendedor del sector inmobiliario.',
  },
  {
    phrases: [
      'soy de una inmobiliaria', 'soy de una constructora', 'soy de una desarrollista',
      'trabajo en una inmobiliaria', 'trabajo para una inmobiliaria',
      'trabajo en una constructora', 'trabajo para una constructora',
      'trabajo en una desarrollista', 'trabajo para una desarrollista',
      'represento a una inmobiliaria', 'represento a una constructora', 'represento a una desarrollista',
      'trabajo como corredor', 'trabajo como corredora', 'trabajo como martillero', 'trabajo como martillera',
    ],
    reason: 'Indicó que trabaja para una empresa inmobiliaria.',
  },
  {
    phrases: ['comparto comision', 'compartimos comision'],
    reason: 'Mencionó colaboración o comisión entre colegas.',
  },
  {
    phrases: ['soy propietario', 'soy el propietario', 'soy dueno', 'soy el dueno'],
    reason: 'Se identificó como propietario.',
  },
  {
    phrases: [
      'tengo unidades para ofrecer', 'tengo propiedades para ofrecer',
      'tengo departamentos para ofrecer', 'tengo deptos para ofrecer',
      'vendo departamentos de pozo', 'vendo deptos de pozo',
      'vendo unidades', 'vendo propiedades', 'estoy vendiendo departamentos',
    ],
    reason: 'Indicó que comercializa productos inmobiliarios.',
  },
];

const stoppedGroups: PhraseGroup[] = [{
  phrases: [
    'no busco mas', 'ya no busco', 'no estoy buscando', 'ya no estoy buscando',
    'ya no seguimos buscando', 'no buscamos mas', 'deje de buscar', 'dejamos de buscar',
    'no sigo buscando', 'no seguimos buscando', 'no quiero comprar', 'no queremos comprar',
    'desistimos de comprar', 'no voy a comprar', 'no vamos a comprar', 'no compro',
    'decidi no comprar', 'no me escribas', 'no me escriban', 'no me contacten',
    'no quiero recibir mensajes', 'sacame de la lista', 'borrenme',
    'no hace falta que me mandes mas', 'por ahora no busco', 'suspendi la busqueda',
    'pausamos la busqueda', 'cancele la busqueda', 'cancelamos la compra',
    'dimos de baja la busqueda', 'frene la busqueda', 'no sigas buscando para mi',
    'no necesitamos mas opciones', 'no quiero seguir viendo propiedades',
    'prefiero no continuar con la busqueda', 'abandonamos la idea de comprar',
    'gracias pero no buscamos mas', 'ya no necesito una propiedad',
    'no tengo intencion de comprar',
  ],
  reason: 'Indicó explícitamente que dejó de buscar o pidió no recibir más contactos.',
}];

const boughtGroups: PhraseGroup[] = [{
  phrases: [
    'ya compre', 'ya compramos', 'compramos una', 'compramos un',
    'ya consegui', 'ya conseguimos', 'ya encontre', 'ya encontramos',
    'ya resolvi', 'ya lo resolvimos', 'cerre con otra inmobiliaria',
    'cerramos con otra inmobiliaria', 'compre por otro lado', 'compramos por otro lado',
    'compre con otra inmobiliaria', 'compramos con otra inmobiliaria',
    'ya cerre', 'ya cerramos', 'ya sene', 'ya senamos', 'ya reserve', 'ya reservamos',
    'ya tengo casa', 'ya tengo departamento', 'ya tengo depto', 'ya tengo propiedad',
    'ya tenemos casa', 'ya tenemos departamento', 'ya tenemos depto', 'ya tenemos propiedad',
    'finalmente compre', 'finalmente compramos', 'finalmente encontre', 'finalmente encontramos',
    'ya solucione', 'ya esta resuelta la compra', 'encontre una opcion',
    'consegui una opcion', 'consegui algo', 'ya adquiri', 'concretamos la compra',
    'firme por otro departamento', 'firme por otro depto', 'firme por otra casa',
    'ya tenemos donde mudarnos', 'ya elegimos y compramos',
  ],
  reason: 'Confirmó que la compra o necesidad ya fue resuelta.',
}];

const waitingSaleGroups: PhraseGroup[] = [{
  phrases: [
    'todavia no vendi', 'todavia no vendimos', 'aun no vendi', 'aun no vendimos',
    'no pude vender', 'no pudimos vender', 'todavia no pude vender',
    'no logre vender', 'no logramos vender', 'mi casa no se vendio',
    'el departamento no se vendio', 'el depto no se vendio', 'la propiedad no se vendio',
    'no se vendio todavia', 'dependo de vender', 'dependemos de vender',
    'dependo de la venta', 'dependemos de la venta', 'primero tengo que vender',
    'primero tenemos que vender', 'primero debo vender', 'primero debemos vender',
    'antes tengo que vender', 'antes tenemos que vender', 'antes debo vender',
    'antes debemos vender', 'hasta que no venda', 'hasta que no vendamos',
    'hasta vender no puedo', 'hasta vender no podemos', 'cuando venda', 'cuando vendamos',
    'si vendo', 'si vendemos', 'estoy esperando vender', 'seguimos esperando vender',
    'estoy vendiendo mi casa', 'estoy vendiendo mi departamento',
    'estamos vendiendo nuestra casa', 'estamos vendiendo antes de comprar',
    'la compra depende de vender', 'necesito vender antes de comprar',
    'necesitamos vender antes de comprar', 'tenemos que vender antes de avanzar',
    'mi propiedad sigue publicada', 'todavia tengo la casa a la venta',
    'todavia tengo el departamento a la venta',
  ],
  reason: 'La compra depende de vender una propiedad previa.',
}];

const activeGroups: PhraseGroup[] = [{
  phrases: [
    'sigo buscando', 'seguimos buscando', 'sigo en la busqueda', 'seguimos en la busqueda',
    'sigo con la busqueda', 'seguimos con la busqueda', 'todavia busco',
    'todavia estamos buscando', 'aun sigo buscando', 'continuo buscando',
    'continuamos buscando', 'continuo con la busqueda', 'continuamos con la busqueda',
    'mandame opciones', 'mandame mas opciones', 'mandame propiedades',
    'pasame opciones', 'pasame departamentos', 'pasame propiedades',
    'enviame opciones', 'compartime opciones', 'mostrame alternativas',
    'avisame si aparece', 'avisame cuando tengas', 'avisenme si sale',
    'quiero seguir viendo', 'queremos seguir viendo', 'me interesa ver opciones',
    'estoy en busqueda activa', 'todavia necesito encontrar',
  ],
  reason: 'Confirmó explícitamente que continúa buscando.',
}];

const negativeActiveFragments = [
  'ya no seguimos buscando', 'no seguimos buscando', 'no sigo buscando',
  'no estoy buscando', 'ya no estoy buscando', 'no estamos buscando',
  'no quiero seguir viendo', 'no queremos seguir viendo',
  'no quiero comprar', 'no queremos comprar', 'no necesito comprar', 'no necesitamos comprar',
] as const;

const propertyTerms = [
  'propiedad', 'propiedades', 'casa', 'casas', 'departamento', 'departamentos',
  'depto', 'deptos', 'duplex', 'terreno', 'unidad', 'unidades', 'vivienda',
] as const;
const optionTerms = ['opcion', 'opciones', 'alternativa', 'alternativas', 'algo', 'oportunidad', 'oportunidades'] as const;
const realEstateTerms = [...propertyTerms, 'inmobiliaria', 'inmobiliarias', 'constructora', 'constructor', 'desarrollista', 'desarrollo', 'pozo', 'comision'] as const;

export function normalizeAuditText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesPhrase(normalized: string, phrase: string): boolean {
  return ` ${normalized} `.includes(` ${phrase} `);
}

function removePhrase(normalized: string, phrase: string): string {
  return ` ${normalized} `.replaceAll(` ${phrase} `, ' ').replace(/\s+/g, ' ').trim();
}

function includesAny(normalized: string, terms: readonly string[]): boolean {
  return terms.some((term) => includesPhrase(normalized, term));
}

function includesStem(normalized: string, stems: readonly string[]): boolean {
  const words = normalized.split(' ');
  return words.some((word) => stems.some((stem) => word.startsWith(stem)));
}

function findGroupSignal(
  normalized: string,
  groups: PhraseGroup[],
  status: ConversationStatus,
  confidence: number,
): IntentSignal | null {
  for (const group of groups) {
    if (group.phrases.some((phrase) => includesPhrase(normalized, phrase))) {
      return { status, confidence, reason: group.reason, engine: 'Reglas de seguridad' };
    }
  }
  return null;
}

function commercialSignalFromText(normalized: string): IntentSignal | null {
  const grouped = findGroupSignal(normalized, commercialGroups, 'Contacto comercial', 98);
  if (grouped) return grouped;

  const sharesProduct = /(^| )(te|les) (comparto|paso|envio|mando|acerco) (una |un )?(propiedad|producto|unidad|departamento|depto|casa|disponibilidad)( |$)/.test(normalized);
  const wantsToSell = /(^| )(quiero|necesito) vender (mi|una|un) (casa|departamento|depto|propiedad|terreno)( |$)/.test(normalized);
  if (sharesProduct) {
    return { status: 'Contacto comercial', confidence: 98, reason: 'Compartió producto o disponibilidad inmobiliaria.', engine: 'Reglas de seguridad' };
  }
  if (wantsToSell) {
    return { status: 'Contacto comercial', confidence: 98, reason: 'La intención principal detectada es vender una propiedad.', engine: 'Reglas de seguridad' };
  }

  const firstPersonRole = includesAny(normalized, ['soy', 'somos', 'trabajo', 'represento', 'me dedico', 'manejo']);
  const sectorRole = includesStem(normalized, ['corredor', 'corredora', 'martiller', 'inmobiliar', 'constructor', 'desarroll', 'broker', 'asesor', 'agente']);
  const sellerWithContext = includesStem(normalized, ['vendedor', 'vendedora', 'comercializ']) && includesAny(normalized, realEstateTerms);
  const inventoryContext = includesStem(normalized, ['ofrec', 'compart', 'comercializ']) && includesAny(normalized, realEstateTerms);
  const ownerContext = includesAny(normalized, ['soy titular', 'soy el titular', 'la propiedad es mia', 'es de mi propiedad']);
  if ((firstPersonRole && (sectorRole || sellerWithContext)) || inventoryContext || ownerContext) {
    return {
      status: 'Contacto comercial',
      confidence: 95,
      reason: 'La combinación de rol, actividad e inventario indica una relación comercial inmobiliaria.',
      engine: 'Comprensión por conceptos',
    };
  }
  return null;
}

function activeSignal(normalized: string): IntentSignal | null {
  const cleaned = negativeActiveFragments.reduce((text, phrase) => removePhrase(text, phrase), normalized);
  const grouped = findGroupSignal(cleaned, activeGroups, 'Sigue buscando', 93);
  if (grouped) return grouped;

  if (includesPhrase(cleaned, 'estoy buscando') || includesPhrase(cleaned, 'estamos buscando')) {
    return { status: 'Sigue buscando', confidence: 93, reason: 'Expresó una búsqueda activa.', engine: 'Reglas de seguridad' };
  }
  if (['quiero comprar', 'queremos comprar', 'necesito comprar', 'necesitamos comprar'].some((phrase) => includesPhrase(cleaned, phrase))) {
    return { status: 'Sigue buscando', confidence: 93, reason: 'Expresó intención activa de compra.', engine: 'Reglas de seguridad' };
  }
  if (/(^| )(busco|buscamos) (un|una|algo|casa|departamento|depto|propiedad|terreno|duplex)( |$)/.test(cleaned)) {
    return { status: 'Sigue buscando', confidence: 93, reason: 'Describió una búsqueda inmobiliaria activa.', engine: 'Reglas de seguridad' };
  }

  const continuity = includesStem(cleaned, ['segu', 'continu', 'retom', 'and']) || includesAny(cleaned, ['todavia', 'aun']);
  const searchAction = includesStem(cleaned, ['busc', 'encontr', 'ver', 'visit']) || includesAny(cleaned, ['en la busqueda', 'con la busqueda']);
  const requestAction = includesStem(cleaned, ['manda', 'pasa', 'envia', 'mostra', 'comparti', 'avisa'])
    && includesAny(cleaned, [...propertyTerms, ...optionTerms]);
  const saleDependencyContext = includesStem(cleaned, ['vend', 'venta'])
    && includesAny(cleaned, [
      'antes', 'primero', 'hasta', 'dependo', 'dependemos', 'depende', 'esperando',
      'a la espera', 'cuando venda', 'cuando vendamos', 'si vendo', 'si vendemos',
      'atada a la venta', 'sujeta a la venta',
    ]);
  const purchaseIntent = !saleDependencyContext
    && includesStem(cleaned, ['compr', 'invert', 'mudar'])
    && includesAny(cleaned, [...propertyTerms, ...optionTerms, 'para vivir', 'para invertir']);
  if ((continuity && searchAction) || requestAction || purchaseIntent) {
    return {
      status: 'Sigue buscando',
      confidence: 91,
      reason: 'La combinación de continuidad, búsqueda y pedido de opciones indica interés activo.',
      engine: 'Comprensión por conceptos',
    };
  }
  return null;
}

function stoppedConceptSignal(normalized: string): IntentSignal | null {
  const stopAction = includesStem(normalized, ['abandon', 'cancel', 'paus', 'fren', 'desist', 'dej'])
    || includesAny(normalized, ['dar de baja', 'dimos de baja', 'cerrar la busqueda', 'cerramos la busqueda']);
  const searchContext = includesStem(normalized, ['busc', 'compr', 'continu', 'avanz'])
    || includesAny(normalized, [...optionTerms, 'mensajes', 'contactos']);
  const noContact = includesAny(normalized, ['no me mandes', 'no me envies', 'no me contacten', 'no me escribas', 'prefiero que no']);
  if ((stopAction && searchContext) || noContact) {
    return {
      status: 'No busca más',
      confidence: 96,
      reason: 'La intención combina una acción de cierre o pausa con la búsqueda o el contacto comercial.',
      engine: 'Comprensión por conceptos',
    };
  }
  return null;
}

function boughtConceptSignal(normalized: string): IntentSignal | null {
  const resolutionMarker = includesAny(normalized, [
    'ya', 'finalmente', 'por otro lado', 'por nuestra cuenta', 'otra inmobiliaria',
    'otra propiedad', 'otra unidad', 'tema resuelto', 'necesidad resuelta',
  ]);
  const resolvedAction = includesStem(normalized, ['compr', 'consegu', 'encontr', 'reserv', 'sen', 'firm', 'cerr', 'adquir', 'resolv', 'solucion', 'eleg']);
  const propertyContext = includesAny(normalized, [...propertyTerms, ...optionTerms, 'donde vivir', 'donde mudarnos', 'operacion', 'compra']);
  if (resolutionMarker && resolvedAction && propertyContext) {
    return {
      status: 'Ya compró',
      confidence: 96,
      reason: 'La conversación combina una resolución reciente con una compra, reserva o elección inmobiliaria.',
      engine: 'Comprensión por conceptos',
    };
  }
  return null;
}

function waitingSaleConceptSignal(normalized: string): IntentSignal | null {
  const saleContext = includesStem(normalized, ['vend', 'venta', 'publicad']);
  const dependency = includesAny(normalized, [
    'antes', 'primero', 'hasta', 'dependo', 'dependemos', 'a la espera', 'esperando',
    'cuando venda', 'si vendo', 'atada a la venta', 'sujeta a la venta', 'todavia no', 'aun no',
  ]);
  const purchaseContext = includesStem(normalized, ['compr', 'avanz', 'retom', 'mudar'])
    || includesAny(normalized, ['la busqueda', 'la operacion']);
  if (saleContext && dependency && purchaseContext) {
    return {
      status: 'Esperando vender',
      confidence: 94,
      reason: 'La intención de compra o avance está condicionada a concretar una venta previa.',
      engine: 'Comprensión por conceptos',
    };
  }
  return null;
}

function signalFromText(text: string): IntentSignal | null {
  const normalized = normalizeAuditText(text);
  if (!normalized) return null;

  const exactSignals = [
    findGroupSignal(normalized, stoppedGroups, 'No busca más', 99),
    findGroupSignal(normalized, boughtGroups, 'Ya compró', 98),
    findGroupSignal(normalized, waitingSaleGroups, 'Esperando vender', 96),
    activeSignal(normalized),
  ].filter((signal): signal is IntentSignal => Boolean(signal));

  const exactStatuses = new Set(exactSignals.map((signal) => signal.status));
  if (exactStatuses.size > 1) {
    return {
      status: 'Revisar manualmente',
      confidence: 40,
      reason: 'El mismo mensaje contiene señales contradictorias; no debe generar una acción automática.',
      engine: 'Reglas de seguridad',
    };
  }
  if (exactSignals.length) return exactSignals[0]!;

  const conceptSignals = [
    stoppedConceptSignal(normalized),
    boughtConceptSignal(normalized),
    waitingSaleConceptSignal(normalized),
    activeSignal(normalized),
  ].filter((signal): signal is IntentSignal => Boolean(signal));
  const conceptStatuses = new Set(conceptSignals.map((signal) => signal.status));
  if (conceptStatuses.size > 1) {
    return {
      status: 'Revisar manualmente',
      confidence: 45,
      reason: 'La comprensión por conceptos encontró intenciones incompatibles; requiere revisión humana.',
      engine: 'Comprensión por conceptos',
    };
  }
  return conceptSignals[0] ?? null;
}

export function auditableMessageText(message: ConversationMessage): string {
  const transcript = String(message.transcript ?? '').trim();
  if (message.kind === 'audio' && transcript) return transcript;
  return String(message.text ?? '').trim();
}

function commercialSignal(messages: WhatsAppConversation['messages']): IntentSignal | null {
  for (const message of messages.filter((item) => item.direction === 'inbound')) {
    const signal = commercialSignalFromText(normalizeAuditText(auditableMessageText(message)));
    if (signal) return signal;
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
      engine: 'Reglas de seguridad',
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
      engine: commercial.engine,
    };
  }

  const inbound = conversation.messages.filter((message) => message.direction === 'inbound');
  for (const message of [...inbound].reverse()) {
    const signal = signalFromText(auditableMessageText(message));
    if (!signal) continue;
    const mediaReason = message.kind === 'audio'
      ? 'El estado fue interpretado desde la transcripción del audio.'
      : null;
    const reasons = [
      signal.reason,
      mediaReason,
      'Se tomó el último estado explícito del cliente dentro del historial disponible.',
    ].filter((reason): reason is string => Boolean(reason));
    if (signal.status === 'Sigue buscando' && client?.canMoveForward === 'No') {
      return {
        status: 'Revisar manualmente',
        decision: 'Revisión manual',
        confidence: 70,
        reasons: [...reasons, 'El CRM indica que todavía no puede avanzar; se mantiene pausado hasta revisión.'],
        auditedAt,
        source: 'Automático',
        engine: signal.engine,
      };
    }
    return {
      status: signal.status,
      decision: decisionForConversationStatus(signal.status),
      confidence: signal.confidence,
      reasons,
      auditedAt,
      source: 'Automático',
      engine: signal.engine,
    };
  }

  const crmHints = normalizeAuditText([client?.notes, client?.objections, client?.purchaseTimeframe].join(' '));
  const waitingHint = findGroupSignal(crmHints, waitingSaleGroups, 'Esperando vender', 82)
    ?? waitingSaleConceptSignal(crmHints);
  if (waitingHint || client?.canMoveForward === 'No') {
    return {
      status: 'Esperando vender',
      decision: 'Pausar',
      confidence: waitingHint ? Math.min(waitingHint.confidence, 82) : 65,
      reasons: [
        waitingHint?.reason ?? 'El CRM indica que todavía no puede avanzar.',
        'No se habilita contacto automático con información incompleta.',
      ],
      auditedAt,
      source: 'Automático',
      engine: waitingHint?.engine ?? 'Reglas de seguridad',
    };
  }

  const pendingAudio = inbound.some((message) => message.kind === 'audio' && message.transcriptionStatus !== 'Transcripto');
  return {
    status: 'Revisar manualmente',
    decision: 'Revisión manual',
    confidence: pendingAudio ? 10 : inbound.length ? 35 : 15,
    reasons: [
      pendingAudio
        ? 'Existe un audio pendiente de transcripción; no se puede decidir con seguridad.'
        : inbound.length
          ? 'El historial no contiene una confirmación clara del estado actual.'
          : 'No hay mensajes entrantes para analizar.',
      'Ante la duda, la conversación queda pausada.',
    ],
    auditedAt,
    source: 'Automático',
    engine: 'Reglas de seguridad',
  };
}

export function manualConversationAudit(
  status: ConversationStatus,
  auditedAt = new Date().toISOString(),
): ConversationAudit {
  return {
    status,
    decision: decisionForConversationStatus(status),
    confidence: 100,
    reasons: ['Estado confirmado manualmente por un usuario de la inmobiliaria.'],
    auditedAt,
    source: 'Manual',
    engine: 'Manual',
  };
}

export function safeConversationMode(audit: ConversationAudit, current: ConversationMode): ConversationMode {
  if (current === 'Humano') return 'Humano';
  return audit.status === 'Sigue buscando'
    && audit.decision === 'Seguimiento supervisado'
    && audit.confidence >= 90
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

export function conversationAuditSummary(
  conversations: WhatsAppConversation[],
): Record<ConversationStatus, number> {
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

export function addWaitingSaleReminder(
  existing: Reminder[],
  client: Client,
  baseDate: string,
): { reminders: Reminder[]; added: number } {
  const candidate = {
    date: addDays(baseDate, 30),
    title: 'Revisar si pudo vender',
    related: `${client.name} · WhatsApp · ${client.interest}`,
    priority: 'Media',
  };
  const duplicate = existing.some((reminder) =>
    reminder.date === candidate.date
    && reminder.title === candidate.title
    && reminder.related === candidate.related,
  );
  if (duplicate) return { reminders: existing, added: 0 };
  const nextId = Math.max(0, ...existing.map((reminder) => reminder.id)) + 1;
  return { reminders: [...existing, { ...candidate, id: nextId }], added: 1 };
}
