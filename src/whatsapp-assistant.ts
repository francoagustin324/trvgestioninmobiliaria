import type { Client, ConversationMessage, Reminder, WhatsAppConversation } from './models.js';
import { parseUsdBudget } from './property-matching.js';

export type QualificationKey = 'interest' | 'purpose' | 'knowsArea' | 'budget' | 'paymentMethod' | 'purchaseTimeframe' | 'canMoveForward';

export interface QualificationState {
  completed: number;
  total: number;
  percentage: number;
  missing: QualificationKey[];
}

export interface AssistantSuggestion {
  text: string;
  reason: string;
  requiresHumanApproval: boolean;
  handoff: boolean;
}

export interface QualificationUpdateResult {
  client: Client;
  detected: string[];
}

const qualificationOrder: QualificationKey[] = ['interest', 'purpose', 'knowsArea', 'budget', 'paymentMethod', 'purchaseTimeframe', 'canMoveForward'];

export const qualificationLabels: Record<QualificationKey, string> = {
  interest: 'Búsqueda / zona',
  purpose: 'Vivir o invertir',
  knowsArea: 'Conoce la zona',
  budget: 'Presupuesto',
  paymentMethod: 'Forma de pago',
  purchaseTimeframe: 'Plazo de compra',
  canMoveForward: 'Puede avanzar',
};

const qualificationQuestions: Record<QualificationKey, string> = {
  interest: '¿Qué tipo de propiedad y en qué zona está buscando?',
  purpose: '¿La busca para vivir o para invertir?',
  knowsArea: '¿Conoce la zona o quiere que le cuente un poco cómo es?',
  budget: '¿Qué presupuesto aproximado tiene pensado?',
  paymentMethod: '¿La compra sería de contado, con crédito o necesita financiación?',
  purchaseTimeframe: '¿En qué plazo le gustaría comprar?',
  canMoveForward: 'Si aparece una opción que encaja, ¿está en condiciones de avanzar?',
};

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCompleted(client: Client, key: QualificationKey): boolean {
  const value = String(client[key] ?? '').trim();
  return value.length > 0;
}

export function qualificationState(client: Client): QualificationState {
  const missing = qualificationOrder.filter((key) => !isCompleted(client, key));
  const completed = qualificationOrder.length - missing.length;
  return { completed, total: qualificationOrder.length, percentage: Math.round((completed / qualificationOrder.length) * 100), missing };
}

export function nextQualificationQuestion(client: Client): string | null {
  const key = qualificationState(client).missing[0];
  return key ? qualificationQuestions[key] : null;
}

export function lastInboundMessage(conversation: WhatsAppConversation): ConversationMessage | null {
  return [...conversation.messages].reverse().find((message) => message.direction === 'inbound') ?? null;
}

export function requiresHumanHandoff(text: string): boolean {
  const normalized = normalize(text);
  return [
    'quiero hacer una oferta', 'hago una oferta', 'reservar', 'reserva', 'sena', 'descuento',
    'negociar', 'hablar con franco', 'llamame', 'llamarme', 'escritura', 'documentacion',
    'problema', 'reclamo', 'abogado', 'firmar',
  ].some((term) => normalized.includes(term));
}

function hasVisitIntent(text: string): boolean {
  const normalized = normalize(text);
  return ['se puede ver', 'puedo ver', 'visita', 'visitar', 'mostrar', 'conocer la propiedad', 'cuando verla'].some((term) => normalized.includes(term));
}

export function suggestAssistantReply(client: Client, conversation: WhatsAppConversation): AssistantSuggestion {
  const inbound = lastInboundMessage(conversation)?.text ?? '';
  const question = nextQualificationQuestion(client);

  if (requiresHumanHandoff(inbound)) {
    return {
      text: 'Perfecto. Este punto lo revisa Franco personalmente para darte una respuesta correcta. Continúa por acá apenas lo tome.',
      reason: 'La consulta contiene negociación, reserva, documentación o pedido explícito de atención humana.',
      requiresHumanApproval: true,
      handoff: true,
    };
  }

  if (hasVisitIntent(inbound) && question) {
    return {
      text: `Sí, antes de coordinar quiero confirmar algo para no hacerte perder tiempo: ${question}`,
      reason: 'Pidió una visita, pero todavía faltan datos de calificación.',
      requiresHumanApproval: true,
      handoff: false,
    };
  }

  if (hasVisitIntent(inbound)) {
    return {
      text: 'Perfecto. Los datos principales coinciden con la búsqueda. Franco revisa la disponibilidad y confirma la visita por este medio.',
      reason: 'La calificación está completa, pero toda visita requiere aprobación humana.',
      requiresHumanApproval: true,
      handoff: true,
    };
  }

  if (question) {
    return {
      text: `Perfecto, gracias por la información. ${question}`,
      reason: `Siguiente dato faltante: ${qualificationLabels[qualificationState(client).missing[0]!]}.`,
      requiresHumanApproval: false,
      handoff: false,
    };
  }

  return {
    text: 'Perfecto, ya tengo los datos principales. Franco revisa las opciones compatibles y continúa por acá.',
    reason: 'La calificación está completa y corresponde revisión comercial.',
    requiresHumanApproval: true,
    handoff: true,
  };
}

function formatUsd(value: number): string {
  return `USD ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value)}`;
}

export function applyQualificationFromMessage(client: Client, message: string): QualificationUpdateResult {
  const normalized = normalize(message);
  const updated = { ...client };
  const detected: string[] = [];

  if (/\b(vivir|vivienda propia|para mi)\b/.test(normalized)) {
    updated.purpose = 'Vivir';
    detected.push('Motivo: vivir');
  } else if (/\b(invertir|inversion|renta)\b/.test(normalized)) {
    updated.purpose = 'Invertir';
    detected.push('Motivo: invertir');
  }

  if (/\b(no conozco|nunca fui|no conozco la zona)\b/.test(normalized)) {
    updated.knowsArea = 'No';
    detected.push('No conoce la zona');
  } else if (/\b(conozco|ya fui|vivo en la zona)\b/.test(normalized)) {
    updated.knowsArea = 'Sí';
    detected.push('Conoce la zona');
  }

  if (/(usd|u\$s|us\$|dolar|presupuesto|\bmil\b|\bk\b)/.test(normalized)) {
    const budget = parseUsdBudget(message);
    if (budget && budget >= 1000) {
      updated.budget = formatUsd(budget);
      detected.push(`Presupuesto: ${updated.budget}`);
    }
  }

  if (/\b(contado|efectivo)\b/.test(normalized)) {
    updated.paymentMethod = 'Contado';
    detected.push('Forma de pago: contado');
  } else if (/\b(credito|hipotecario)\b/.test(normalized)) {
    updated.paymentMethod = 'Crédito';
    detected.push('Forma de pago: crédito');
  } else if (/\b(financiacion|cuotas)\b/.test(normalized)) {
    updated.paymentMethod = 'Financiación';
    detected.push('Forma de pago: financiación');
  }

  if (/\b(ahora|inmediato|este mes|ya mismo)\b/.test(normalized)) {
    updated.purchaseTimeframe = '0-1 mes';
    detected.push('Plazo: inmediato');
  } else if (/\b(1 a 3 meses|uno a tres meses|3 meses|tres meses)\b/.test(normalized)) {
    updated.purchaseTimeframe = '1-3 meses';
    detected.push('Plazo: 1-3 meses');
  } else if (/\b(mas adelante|sin apuro|este ano)\b/.test(normalized)) {
    updated.purchaseTimeframe = 'Más adelante';
    detected.push('Plazo: más adelante');
  }

  if (/\b(estoy listo|puedo avanzar|tengo el dinero|puedo comprar)\b/.test(normalized)) {
    updated.canMoveForward = 'Sí';
    detected.push('Puede avanzar');
  } else if (/\b(no puedo avanzar|todavia no|dependo de vender|primero tengo que vender)\b/.test(normalized)) {
    updated.canMoveForward = 'No';
    detected.push('No puede avanzar todavía');
  }

  return { client: updated, detected };
}

export function appendConversationMessage(
  conversation: WhatsAppConversation,
  direction: 'inbound' | 'outbound',
  sender: ConversationMessage['sender'],
  text: string,
  createdAt: string,
  detectedData: string[] = [],
): WhatsAppConversation {
  const nextId = Math.max(0, ...conversation.messages.map((message) => message.id)) + 1;
  return {
    ...conversation,
    unread: direction === 'inbound' ? conversation.unread + 1 : 0,
    lastActivity: createdAt,
    messages: [...conversation.messages, { id: nextId, direction, sender, text: text.trim(), createdAt, detectedData }],
  };
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function followUpPlan(client: Client, baseDate: string): Array<Omit<Reminder, 'id'>> {
  const priority = client.temperature === 'Caliente' ? 'Alta' : client.temperature === 'Tibio' ? 'Media' : 'Baja';
  const related = `${client.name} · WhatsApp · ${client.interest}`;
  return [
    { date: addDays(baseDate, 1), title: 'Seguimiento WhatsApp 24 h', related, priority },
    { date: addDays(baseDate, 3), title: 'Seguimiento WhatsApp 72 h', related, priority },
    { date: addDays(baseDate, 7), title: 'Seguimiento WhatsApp 7 días', related, priority },
  ];
}

export function addFollowUpPlan(existing: Reminder[], client: Client, baseDate: string): { reminders: Reminder[]; added: number } {
  const additions = followUpPlan(client, baseDate).filter((candidate) => !existing.some((reminder) =>
    reminder.date === candidate.date && reminder.title === candidate.title && reminder.related === candidate.related,
  ));
  let nextId = Math.max(0, ...existing.map((reminder) => reminder.id)) + 1;
  return {
    reminders: [...existing, ...additions.map((reminder) => ({ ...reminder, id: nextId++ }))],
    added: additions.length,
  };
}

export function createConversation(client: Client, id: number, createdAt: string): WhatsAppConversation {
  return { id, clientId: client.id, phone: client.phone, mode: 'IA supervisada', unread: 0, lastActivity: createdAt, messages: [] };
}
