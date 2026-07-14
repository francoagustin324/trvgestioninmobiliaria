import type { ConversationMessage, WhatsAppConversation } from './models.js';
import { visibleConversations } from './team-access.js';
import { state } from './store.js';
import { escapeHtml } from './utils.js';
import { renderMessageTemplates } from './message-templates-ui.js';

let activeTab: 'bandeja' | 'plantillas' = 'bandeja';
let conversationSearch = '';

const timeFormatter = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
});

function conversationClient(conversation: WhatsAppConversation) {
  return state.crm.clients.find((client) => client.id === conversation.clientId) ?? null;
}

function lastMessage(conversation: WhatsAppConversation): ConversationMessage | undefined {
  return conversation.messages.at(-1);
}

function messageContent(message: ConversationMessage): string {
  if (message.kind === 'audio') {
    if (message.transcript) return message.transcript;
    if (message.transcriptionStatus === 'Pendiente') return 'Audio pendiente de transcripción';
    return message.text || 'Mensaje de audio';
  }
  return message.text;
}

function filteredConversations(): WhatsAppConversation[] {
  const query = conversationSearch.trim().toLowerCase();
  const conversations = [...visibleConversations()].sort((left, right) => right.lastActivity.localeCompare(left.lastActivity));
  if (!query) return conversations;
  return conversations.filter((conversation) => {
    const client = conversationClient(conversation);
    const latest = lastMessage(conversation);
    return [client?.name, client?.interest, client?.budget, conversation.phone, latest ? messageContent(latest) : '']
      .some((value) => String(value ?? '').toLowerCase().includes(query));
  });
}

function conversationListItem(conversation: WhatsAppConversation): string {
  const client = conversationClient(conversation);
  const latest = lastMessage(conversation);
  const selected = state.selectedConversationId === conversation.id;
  return `<button type="button" class="mvp-conversation-item${selected ? ' active' : ''}" data-select-conversation="${conversation.id}">
    <span class="mvp-conversation-avatar">${escapeHtml((client?.name || conversation.phone).slice(0, 2).toUpperCase())}</span>
    <span class="mvp-conversation-summary">
      <span><b>${escapeHtml(client?.name || conversation.phone)}</b>${conversation.unread ? `<strong>${conversation.unread}</strong>` : ''}</span>
      <small>${escapeHtml(latest ? messageContent(latest) : 'Sin mensajes')}</small>
    </span>
    <time>${escapeHtml(timeFormatter.format(new Date(conversation.lastActivity)))}</time>
  </button>`;
}

function messageBubble(message: ConversationMessage): string {
  const direction = message.direction === 'outbound' ? 'outbound' : 'inbound';
  const audioLabel = message.kind === 'audio' ? '<span class="mvp-message-type">Audio transcripto</span>' : '';
  return `<article class="mvp-message ${direction}">${audioLabel}<p>${escapeHtml(messageContent(message))}</p><time>${escapeHtml(timeFormatter.format(new Date(message.createdAt)))}</time></article>`;
}

function emptyConversation(): string {
  return `<div class="mvp-conversation-empty"><div>💬</div><h2>Seleccioná una conversación</h2><p>Acá vas a ver el historial del lead y sus datos principales.</p></div>`;
}

function conversationDetail(conversation: WhatsAppConversation | null): string {
  if (!conversation) return emptyConversation();
  const client = conversationClient(conversation);
  const digits = conversation.phone.replace(/\D/g, '');
  return `<section class="mvp-conversation-detail">
    <header class="mvp-chat-header">
      <div><h2>${escapeHtml(client?.name || conversation.phone)}</h2><p>${escapeHtml(conversation.phone)}</p></div>
      <a href="https://wa.me/${digits}" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>
    </header>
    <div class="mvp-chat-lead-data">
      <div><span>Interés</span><strong>${escapeHtml(client?.interest || 'Sin información')}</strong></div>
      <div><span>Presupuesto</span><strong>${escapeHtml(client?.budget || 'Sin información')}</strong></div>
    </div>
    <div class="mvp-message-history">${conversation.messages.map(messageBubble).join('') || '<p class="empty-state">Todavía no hay mensajes.</p>'}</div>
    <div class="mvp-compose-disabled">
      <textarea rows="2" placeholder="La respuesta desde PropControl se habilitará al conectar Meta oficialmente." disabled></textarea>
      <button type="button" disabled>Enviar</button>
    </div>
  </section>`;
}

function renderInbox(container: HTMLElement): void {
  const conversations = filteredConversations();
  if (!conversations.some((conversation) => conversation.id === state.selectedConversationId)) {
    state.selectedConversationId = conversations[0]?.id ?? null;
  }
  const selected = conversations.find((conversation) => conversation.id === state.selectedConversationId) ?? null;
  container.innerHTML = `<div class="mvp-conversations-layout">
    <aside class="mvp-conversation-list">
      <label class="mvp-conversation-search"><span>Buscar</span><input type="search" value="${escapeHtml(conversationSearch)}" placeholder="Nombre, WhatsApp o interés" data-conversation-search></label>
      <div class="mvp-conversation-count">${conversations.length} conversaciones</div>
      <div class="mvp-conversation-items">${conversations.map(conversationListItem).join('') || '<p class="empty-state">No hay conversaciones.</p>'}</div>
    </aside>
    ${conversationDetail(selected)}
  </div>`;

  container.querySelector<HTMLInputElement>('[data-conversation-search]')?.addEventListener('input', (event) => {
    conversationSearch = (event.currentTarget as HTMLInputElement).value;
    renderMvpConversations(container.closest<HTMLElement>('#whatsapp') ?? container);
    window.requestAnimationFrame(() => container.querySelector<HTMLInputElement>('[data-conversation-search]')?.focus());
  });
  container.querySelectorAll<HTMLElement>('[data-select-conversation]').forEach((button) => button.addEventListener('click', () => {
    state.selectedConversationId = Number(button.dataset.selectConversation);
    renderMvpConversations(container.closest<HTMLElement>('#whatsapp') ?? container);
  }));
}

export function renderMvpConversations(container: HTMLElement): void {
  container.innerHTML = `<div class="mvp-page-heading"><div><h1>Conversaciones</h1><p>Atendé consultas y revisá las plantillas aprobadas para iniciar contactos.</p></div></div>
    <div class="mvp-conversation-tabs" role="tablist">
      <button type="button" class="${activeTab === 'bandeja' ? 'active' : ''}" data-conversations-tab="bandeja">Bandeja</button>
      <button type="button" class="${activeTab === 'plantillas' ? 'active' : ''}" data-conversations-tab="plantillas">Plantillas de Meta</button>
    </div>
    <div data-conversations-content></div>`;

  const content = container.querySelector<HTMLElement>('[data-conversations-content]');
  if (!content) return;
  if (activeTab === 'plantillas') renderMessageTemplates(content);
  else renderInbox(content);

  container.querySelectorAll<HTMLButtonElement>('[data-conversations-tab]').forEach((button) => button.addEventListener('click', () => {
    activeTab = button.dataset.conversationsTab === 'plantillas' ? 'plantillas' : 'bandeja';
    renderMvpConversations(container);
  }));
}
