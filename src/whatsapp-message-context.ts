import type { Client, ConversationMessage, WhatsAppConversation } from './models.js';

export interface ContextualWhatsAppMessage {
  message: string;
  question: string;
  contextNote: string;
  blocked: boolean;
  reason: string;
  source: 'conversation' | 'fallback';
}

function plain(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function inboundText(message: ConversationMessage): string {
  if (message.direction !== 'inbound' || message.sender !== 'Cliente') return '';
  return [message.text, message.transcript].filter(Boolean).join(' ').trim();
}

export function visibleInboundConversationText(conversation?: WhatsAppConversation | null): string {
  if (!conversation) return '';
  return conversation.messages.map(inboundText).filter(Boolean).join(' \n ');
}

function includesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function confirmedBudget(client: Client, inbound: string): boolean {
  if (client.budget?.trim()) return true;
  return /(?:usd|u\$s|us\$|dolares?|ars|pesos?|eur|€|\$)\s*[\d.,]+|[\d.,]+\s*(?:usd|dolares?|millones?|mil)/i.test(inbound);
}

function confirmedPayment(client: Client, inbound: string): boolean {
  if (client.paymentMethod?.trim() || client.needsFinancing?.trim()) return true;
  return includesAny(inbound, [
    /\bcontado\b/,
    /\bcredito(?: hipotecario)?\b/,
    /\bfinanci(?:ar|acion|ado)\b/,
    /\bentrega\b.*\bcuotas?\b/,
    /\bcuotas?\b/,
  ]);
}

function confirmedTimeframe(client: Client, inbound: string): boolean {
  if (client.purchaseTimeframe?.trim() || client.urgency?.trim()) return true;
  return includesAny(inbound, [
    /\b(?:este|el proximo) mes\b/,
    /\b(?:en|dentro de)\s+\d+\s+(?:dias?|semanas?|meses?)\b/,
    /\b(?:ya|urgente|cuanto antes|sin apuro|mas adelante|este ano|el ano que viene)\b/,
  ]);
}

function waitingForSale(client: Client, inbound: string, conversation?: WhatsAppConversation | null): boolean {
  if (conversation?.audit?.status === 'Esperando vender') return true;
  return includesAny(`${plain(client.canMoveForward)} ${plain(client.objections)} ${inbound}`, [
    /(?:tengo|debo|necesito|primero).*vender/,
    /(?:cuando|hasta que).*venda/,
    /dependo de la venta/,
    /esperando vender/,
  ]);
}

function requestedVisit(inbound: string): boolean {
  return includesAny(inbound, [
    /\b(?:quiero|quisiera|podemos|puedo|me gustaria)\b.{0,30}\b(?:visitar|ver|conocer)\b/,
    /\bcoordinar\b.{0,20}\bvisita\b/,
    /\bcuando (?:puedo|podemos) verla\b/,
  ]);
}

function boughtOrStopped(inbound: string, conversation?: WhatsAppConversation | null): string {
  const status = conversation?.audit?.status;
  if (status === 'Ya compró') return 'El historial indica que el cliente ya compró.';
  if (status === 'No busca más') return 'El historial indica que el cliente ya no está buscando.';
  if (conversation?.audit?.decision === 'No contactar') return 'El historial indica que no corresponde volver a contactar.';
  if (includesAny(inbound, [/\bya compre\b/, /\bya compramos\b/, /\bconsegui(?:mos)? (?:casa|departamento|propiedad)\b/])) {
    return 'El cliente informó que ya compró.';
  }
  if (includesAny(inbound, [/\bno busco mas\b/, /\bdeje de buscar\b/, /\bya no (?:estoy )?buscando\b/])) {
    return 'El cliente informó que ya no está buscando.';
  }
  return '';
}

function doNotContact(inbound: string): string {
  if (!includesAny(inbound, [
    /\bno me (?:escribas|contactes|mandes mensajes)\b/,
    /\bno contactar\b/,
    /\bno quiero recibir mensajes\b/,
    /\bdame de baja\b/,
    /\bborra mi numero\b/,
  ])) return '';
  return 'El cliente pidió no recibir más mensajes.';
}

function contradiction(inbound: string, conversation?: WhatsAppConversation | null): boolean {
  if (conversation?.audit?.status === 'Revisar manualmente' || conversation?.audit?.decision === 'Revisión manual') return true;
  const positive = includesAny(inbound, [/\bsigo buscando\b/, /\btodavia busco\b/, /\bquiero avanzar\b/]);
  const negative = Boolean(boughtOrStopped(inbound, conversation) || doNotContact(inbound));
  return positive && negative;
}

function contextReference(client: Client, hasConversation: boolean): string {
  const interest = client.interest?.trim();
  if (hasConversation && interest) return `Retomo lo que hablamos sobre ${interest}.`;
  if (hasConversation) return 'Retomo nuestra conversación inmobiliaria.';
  if (interest) return `Te escribo por tu consulta sobre ${interest}.`;
  return 'Te escribo por tu consulta inmobiliaria.';
}

function nextQuestion(client: Client, inbound: string, conversation?: WhatsAppConversation | null): string {
  if (waitingForSale(client, inbound, conversation)) return '¿Cómo viene el avance de la propiedad que necesitás vender antes de seguir?';
  if (!confirmedBudget(client, inbound)) return '¿Qué presupuesto tenés previsto para la compra?';
  if (!confirmedPayment(client, inbound)) return '¿Pensás comprar de contado, con crédito o necesitás financiación?';
  if (!confirmedTimeframe(client, inbound)) return '¿Para cuándo necesitás avanzar con la compra?';
  if (requestedVisit(inbound)) return '¿Qué día y franja horaria te resultan posibles para coordinar la visita?';
  if (client.nextAction?.trim()) return `¿Avanzamos con ${client.nextAction.trim().toLocaleLowerCase('es-AR')}?`;
  return '¿Cuál es el próximo dato que necesitás para poder avanzar?';
}

export function buildContextualWhatsAppMessage(input: {
  client: Client;
  responsibleFirstName: string;
  agency: string;
  conversation?: WhatsAppConversation | null;
}): ContextualWhatsAppMessage {
  const inboundOriginal = visibleInboundConversationText(input.conversation);
  const inbound = plain(inboundOriginal);
  const hasConversation = Boolean(inboundOriginal.trim());
  const stopReason = doNotContact(inbound) || boughtOrStopped(inbound, input.conversation);
  const reviewReason = contradiction(inbound, input.conversation)
    ? 'El historial contiene información contradictoria o requiere revisión humana.'
    : '';
  const blockedReason = stopReason || reviewReason;
  if (blockedReason) {
    return {
      message: '',
      question: '',
      contextNote: hasConversation
        ? 'Se analizaron únicamente mensajes entrantes del cliente cargados en PropControl.'
        : 'No hay historial de conversación cargado en PropControl.',
      blocked: true,
      reason: blockedReason,
      source: hasConversation ? 'conversation' : 'fallback',
    };
  }

  const greeting = input.client.name.trim() ? `Hola ${input.client.name.trim()}` : 'Hola';
  const reference = contextReference(input.client, hasConversation);
  const question = nextQuestion(input.client, inbound, input.conversation);
  return {
    message: `${greeting}, soy ${input.responsibleFirstName} de ${input.agency}. ${reference} ${question}`,
    question,
    contextNote: hasConversation
      ? 'Sugerencia basada únicamente en mensajes entrantes del cliente cargados en PropControl y en los datos confirmados del lead.'
      : 'No hay historial de conversación cargado. Se usa un mensaje genérico seguro y editable.',
    blocked: false,
    reason: '',
    source: hasConversation ? 'conversation' : 'fallback',
  };
}
