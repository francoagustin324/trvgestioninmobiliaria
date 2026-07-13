import { auditAndProtectConversation } from './conversation-audit.js';
import { saveData, state } from './store.js';

function enhanceIncomingForm(): void {
  const form = document.querySelector<HTMLFormElement>('#wa-incoming-form');
  if (!form || form.dataset.audioSimulation === 'ready') return;
  form.dataset.audioSimulation = 'ready';
  const textarea = form.querySelector<HTMLTextAreaElement>('textarea[name="message"]');
  if (!textarea) return;

  const selector = document.createElement('select');
  selector.name = 'message-kind';
  selector.className = 'audio-simulation-select';
  selector.setAttribute('aria-label', 'Tipo de mensaje simulado');
  selector.innerHTML = '<option value="text">Texto</option><option value="audio">Audio transcripto</option>';
  form.insertBefore(selector, textarea);

  selector.addEventListener('change', () => {
    textarea.placeholder = selector.value === 'audio'
      ? 'Escribí la transcripción exacta del audio recibido'
      : 'Simular mensaje entrante del cliente';
  });

  form.addEventListener('submit', () => {
    if (selector.value !== 'audio') return;
    const conversationId = state.selectedConversationId;
    const transcript = textarea.value.trim();
    const startedAt = Date.now();
    if (!conversationId || !transcript) return;

    window.setTimeout(() => {
      const conversation = state.crm.conversations.find((item) => item.id === conversationId);
      const client = conversation ? state.crm.clients.find((item) => item.id === conversation.clientId) ?? null : null;
      if (!conversation || !client) return;
      const messageIndex = [...conversation.messages].map((message, index) => ({ message, index })).reverse().find(({ message }) =>
        message.direction === 'inbound'
        && Math.abs(new Date(message.createdAt).getTime() - startedAt) < 10000,
      )?.index;
      if (messageIndex === undefined) return;

      const messages = conversation.messages.map((message, index) => index === messageIndex
        ? {
          ...message,
          text: `Audio recibido · ${transcript}`,
          kind: 'audio' as const,
          transcript,
          transcriptionStatus: 'Transcripto' as const,
          mimeType: 'audio/ogg',
        }
        : message);
      const protectedConversation = auditAndProtectConversation({ ...conversation, messages, audit: undefined }, client, state.crm.contacts);
      state.crm.conversations = state.crm.conversations.map((item) => item.id === conversationId ? protectedConversation : item);
      saveData();
      document.dispatchEvent(new CustomEvent('trv-render'));
    }, 0);
  }, true);
}

function scheduleEnhancement(): void {
  window.requestAnimationFrame(enhanceIncomingForm);
}

document.addEventListener('trv-render', scheduleEnhancement);
window.addEventListener('DOMContentLoaded', scheduleEnhancement);
window.setTimeout(scheduleEnhancement, 0);
