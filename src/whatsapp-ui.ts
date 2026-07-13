import type { Client, ConversationMode, WhatsAppConversation } from './models.js';
import { formatPhone } from './phone-normalizer.js';
import { saveData, state } from './store.js';
import { escapeHtml, formValues, field, nextId } from './utils.js';
import {
  addFollowUpPlan,
  applyQualificationFromMessage,
  appendConversationMessage,
  createConversation,
  lastInboundMessage,
  qualificationLabels,
  qualificationState,
  suggestAssistantReply,
} from './whatsapp-assistant.js';

function selectedConversation(): WhatsAppConversation | null {
  const conversations = state.crm.conversations;
  if (!conversations.length) return null;
  const selected = conversations.find((item) => item.id === state.selectedConversationId) ?? conversations[0]!;
  state.selectedConversationId = selected.id;
  return selected;
}

function clientFor(conversation: WhatsAppConversation): Client | null {
  return state.crm.clients.find((client) => client.id === conversation.clientId) ?? null;
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function conversationListHtml(selectedId: number | null): string {
  if (!state.crm.conversations.length) return '<p class="wa-empty">Todavía no hay conversaciones.</p>';
  return [...state.crm.conversations]
    .sort((left, right) => right.lastActivity.localeCompare(left.lastActivity))
    .map((conversation) => {
      const client = clientFor(conversation);
      const last = conversation.messages.at(-1)?.text ?? 'Sin mensajes';
      return `<button type="button" class="wa-thread ${conversation.id === selectedId ? 'active' : ''}" data-wa-select="${conversation.id}">
        <span><b>${escapeHtml(client?.name ?? formatPhone(conversation.phone))}</b><small>${escapeHtml(conversation.mode)}</small></span>
        <p>${escapeHtml(last)}</p>
        ${conversation.unread ? `<strong>${conversation.unread}</strong>` : ''}
      </button>`;
    }).join('');
}

function messagesHtml(conversation: WhatsAppConversation): string {
  if (!conversation.messages.length) return '<p class="wa-empty">Usá el campo inferior para simular el primer mensaje entrante.</p>';
  return conversation.messages.map((message) => `<article class="wa-message ${message.direction}">
    <span>${escapeHtml(message.sender)} · ${escapeHtml(timeLabel(message.createdAt))}</span>
    <p>${escapeHtml(message.text)}</p>
    ${message.detectedData?.length ? `<small>Detectado: ${message.detectedData.map(escapeHtml).join(' · ')}</small>` : ''}
  </article>`).join('');
}

function createConversationFormHtml(): string {
  const assigned = new Set(state.crm.conversations.map((item) => item.clientId));
  const available = state.crm.clients.filter((client) => !assigned.has(client.id));
  if (!available.length) return '';
  return `<form id="wa-new-conversation" class="wa-new-conversation">
    <select name="clientId" aria-label="Cliente para conversación">${available.map((client) => `<option value="${client.id}">${escapeHtml(client.name)}</option>`).join('')}</select>
    <button type="submit" class="secondary">Crear conversación</button>
  </form>`;
}

function qualificationHtml(client: Client): string {
  const qualification = qualificationState(client);
  const missing = qualification.missing.length
    ? qualification.missing.map((key) => `<span>${escapeHtml(qualificationLabels[key])}</span>`).join('')
    : '<strong>Calificación completa</strong>';
  return `<section class="wa-qualification">
    <div><span class="eyebrow">Calificación</span><b>${qualification.percentage}%</b></div>
    <progress max="100" value="${qualification.percentage}">${qualification.percentage}%</progress>
    <p>${qualification.completed} de ${qualification.total} datos principales completos.</p>
    <div class="wa-missing">${missing}</div>
  </section>`;
}

function emptyModuleHtml(): string {
  return `<div class="panel-heading"><div><span class="eyebrow">WhatsApp + IA</span><h2>Bandeja supervisada</h2></div><span class="wa-status pending">Meta pendiente</span></div>
    <div class="wa-preflight"><b>Modo preparación</b><p>Esta bandeja todavía no envía ni recibe mensajes reales. Permite probar la lógica comercial antes de conectar la coexistencia oficial.</p></div>
    ${createConversationFormHtml() || '<div class="empty-module"><h3>Cargá un cliente en el CRM para crear una conversación.</h3></div>'}`;
}

export function renderWhatsApp(container: HTMLElement): void {
  const conversation = selectedConversation();
  if (!conversation) {
    container.innerHTML = emptyModuleHtml();
    bindWhatsAppUi(container);
    return;
  }
  const client = clientFor(conversation);
  if (!client) {
    state.crm.conversations = state.crm.conversations.filter((item) => item.id !== conversation.id);
    state.selectedConversationId = null;
    saveData();
    renderWhatsApp(container);
    return;
  }

  const suggestion = suggestAssistantReply(client, conversation);
  const lastInbound = lastInboundMessage(conversation);
  container.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">WhatsApp + IA</span><h2>Bandeja supervisada</h2></div><span class="wa-status pending">Coexistencia pendiente</span></div>
    <div class="wa-preflight"><b>Modo de prueba seguro</b><p>Podés validar respuestas, calificación y seguimientos. Nada se envía a WhatsApp hasta conectar Meta.</p></div>
    <div class="wa-layout">
      <aside class="wa-sidebar"><div class="wa-sidebar-head"><b>Conversaciones</b><span>${state.crm.conversations.length}</span></div>${conversationListHtml(conversation.id)}${createConversationFormHtml()}</aside>
      <section class="wa-chat">
        <header><div><h3>${escapeHtml(client.name)}</h3><span>${escapeHtml(formatPhone(client.phone))} · ${escapeHtml(conversation.mode)}</span></div><button type="button" class="secondary" data-edit-client="${client.id}">Abrir cliente</button></header>
        <div class="wa-messages">${messagesHtml(conversation)}</div>
        <form id="wa-incoming-form" class="wa-incoming-form"><textarea name="message" placeholder="Simular mensaje entrante del cliente" required></textarea><button type="submit">Simular entrada</button></form>
      </section>
      <aside class="wa-assistant">
        ${qualificationHtml(client)}
        <section class="wa-suggestion ${suggestion.requiresHumanApproval ? 'needs-human' : ''}">
          <div><span class="eyebrow">Respuesta sugerida</span>${suggestion.requiresHumanApproval ? '<strong>Revisar antes de responder</strong>' : '<strong>Lista para aprobar</strong>'}</div>
          <textarea id="wa-suggested-reply">${escapeHtml(suggestion.text)}</textarea>
          <p>${escapeHtml(suggestion.reason)}</p>
          <div class="wa-actions"><button type="button" data-wa-register-reply>Registrar respuesta aprobada</button><button type="button" class="secondary" data-wa-copy>Copiar</button></div>
        </section>
        <section class="wa-controls"><label>Control de conversación<select data-wa-mode>${(['IA supervisada', 'Humano', 'Pausada'] as ConversationMode[]).map((mode) => `<option${mode === conversation.mode ? ' selected' : ''}>${mode}</option>`).join('')}</select></label><button type="button" class="secondary" data-wa-followup>Crear plan 24 h / 72 h / 7 días</button><small id="wa-feedback">${lastInbound ? 'La IA analiza siempre el último mensaje entrante.' : 'Esperando un mensaje entrante.'}</small></section>
      </aside>
    </div>`;
  bindWhatsAppUi(container);
}

function replaceConversation(updated: WhatsAppConversation): void {
  state.crm.conversations = state.crm.conversations.map((item) => item.id === updated.id ? updated : item);
}

function bindWhatsAppUi(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>('[data-wa-select]').forEach((button) => button.addEventListener('click', () => {
    state.selectedConversationId = Number(button.dataset.waSelect);
    const conversation = state.crm.conversations.find((item) => item.id === state.selectedConversationId);
    if (conversation) replaceConversation({ ...conversation, unread: 0 });
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  }));

  container.querySelector<HTMLFormElement>('#wa-new-conversation')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = formValues(event.currentTarget as HTMLFormElement);
    const client = state.crm.clients.find((item) => item.id === Number(field(values, 'clientId')));
    if (!client) return;
    const now = new Date().toISOString();
    const conversation = createConversation(client, nextId(state.crm.conversations), now);
    state.crm.conversations.push(conversation);
    state.selectedConversationId = conversation.id;
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  });

  container.querySelector<HTMLFormElement>('#wa-incoming-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const conversation = selectedConversation();
    if (!conversation) return;
    const values = formValues(event.currentTarget as HTMLFormElement);
    const message = field(values, 'message').trim();
    const client = clientFor(conversation);
    if (!message || !client) return;
    const extracted = applyQualificationFromMessage(client, message);
    state.crm.clients = state.crm.clients.map((item) => item.id === client.id ? { ...extracted.client, lastContact: new Date().toISOString().slice(0, 10) } : item);
    replaceConversation(appendConversationMessage(conversation, 'inbound', 'Cliente', message, new Date().toISOString(), extracted.detected));
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  });

  container.querySelector<HTMLButtonElement>('[data-wa-register-reply]')?.addEventListener('click', () => {
    const conversation = selectedConversation();
    const text = container.querySelector<HTMLTextAreaElement>('#wa-suggested-reply')?.value.trim();
    if (!conversation || !text) return;
    const sender = conversation.mode === 'Humano' ? 'Humano' : 'IA';
    replaceConversation(appendConversationMessage(conversation, 'outbound', sender, text, new Date().toISOString()));
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  });

  container.querySelector<HTMLButtonElement>('[data-wa-copy]')?.addEventListener('click', async () => {
    const text = container.querySelector<HTMLTextAreaElement>('#wa-suggested-reply')?.value ?? '';
    await navigator.clipboard.writeText(text);
    const feedback = container.querySelector<HTMLElement>('#wa-feedback');
    if (feedback) feedback.textContent = 'Respuesta copiada.';
  });

  container.querySelector<HTMLSelectElement>('[data-wa-mode]')?.addEventListener('change', (event) => {
    const conversation = selectedConversation();
    if (!conversation) return;
    replaceConversation({ ...conversation, mode: (event.currentTarget as HTMLSelectElement).value as ConversationMode });
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  });

  container.querySelector<HTMLButtonElement>('[data-wa-followup]')?.addEventListener('click', () => {
    const conversation = selectedConversation();
    const client = conversation ? clientFor(conversation) : null;
    if (!client) return;
    const plan = addFollowUpPlan(state.crm.reminders, client, new Date().toISOString().slice(0, 10));
    state.crm.reminders = plan.reminders;
    saveData();
    const feedback = container.querySelector<HTMLElement>('#wa-feedback');
    if (feedback) feedback.textContent = plan.added ? `Se crearon ${plan.added} seguimientos en Agenda.` : 'Ese plan ya estaba creado.';
  });
}
