import type { Client, WhatsAppConversation } from './models.js';
import { state } from './store.js';
import { auditableMessageText } from './conversation-audit.js';
import { requiresHumanHandoff, suggestAssistantReply } from './whatsapp-assistant.js';

const SOUND_KEY = 'propcontrol-intervention-sound-enabled';
let previousAttentionCount: number | null = null;
let audioContext: AudioContext | null = null;

function soundEnabled(): boolean {
  return localStorage.getItem(SOUND_KEY) === 'true';
}

function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_KEY, String(enabled));
}

function clientFor(conversation: WhatsAppConversation): Client | null {
  return state.crm.clients.find((client) => client.id === conversation.clientId) ?? null;
}

function needsHumanAttention(conversation: WhatsAppConversation): boolean {
  if (!conversation.unread) return false;
  const audit = conversation.audit;
  if (audit?.decision === 'Revisión manual') return true;
  if (conversation.mode === 'Humano') return true;
  const lastInbound = [...conversation.messages].reverse().find((message) => message.direction === 'inbound');
  if (!lastInbound) return false;
  const text = auditableMessageText(lastInbound);
  if (requiresHumanHandoff(text)) return true;
  const client = clientFor(conversation);
  return client ? suggestAssistantReply(client, {
    ...conversation,
    messages: conversation.messages.map((message) => message.kind === 'audio' && message.transcript
      ? { ...message, text: message.transcript }
      : message),
  }).requiresHumanApproval : false;
}

export function humanAttentionCount(): number {
  return state.crm.conversations.filter(needsHumanAttention).length;
}

export function playGentleInterventionSound(): void {
  const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;
  audioContext ??= new AudioContextCtor();
  const context = audioContext;
  const start = context.currentTime;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.028, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
  gain.connect(context.destination);

  const first = context.createOscillator();
  first.type = 'sine';
  first.frequency.setValueAtTime(659.25, start);
  first.connect(gain);
  first.start(start);
  first.stop(start + 0.28);

  const second = context.createOscillator();
  second.type = 'sine';
  second.frequency.setValueAtTime(783.99, start + 0.16);
  second.connect(gain);
  second.start(start + 0.16);
  second.stop(start + 0.55);
}

function controlHtml(count: number): string {
  const enabled = soundEnabled();
  return `<div class="intervention-alert" data-intervention-alert>
    <span class="intervention-count" title="Conversaciones que requieren revisión humana">${count}</span>
    <button type="button" class="intervention-toggle" data-intervention-toggle aria-pressed="${enabled}" title="${enabled ? 'Desactivar' : 'Activar'} sonido de intervención">
      <span aria-hidden="true">${enabled ? '♪' : '♩'}</span>
      <span>${enabled ? 'Alertas activas' : 'Activar alertas'}</span>
    </button>
    <button type="button" class="intervention-test" data-intervention-test title="Probar sonido" aria-label="Probar sonido de intervención">Probar</button>
  </div>`;
}

function renderControl(): void {
  const topbar = document.querySelector<HTMLElement>('.topbar');
  if (!topbar) return;
  const count = humanAttentionCount();
  const existing = topbar.querySelector<HTMLElement>('[data-intervention-alert]');
  if (existing) existing.outerHTML = controlHtml(count);
  else topbar.querySelector('#cloud-account')?.insertAdjacentHTML('beforebegin', controlHtml(count));

  topbar.querySelector<HTMLButtonElement>('[data-intervention-toggle]')?.addEventListener('click', () => {
    const next = !soundEnabled();
    setSoundEnabled(next);
    if (next) playGentleInterventionSound();
    renderControl();
  });
  topbar.querySelector<HTMLButtonElement>('[data-intervention-test]')?.addEventListener('click', playGentleInterventionSound);

  if (previousAttentionCount === null) {
    previousAttentionCount = count;
    return;
  }
  if (count > previousAttentionCount && soundEnabled()) playGentleInterventionSound();
  previousAttentionCount = count;
}

function scheduleRender(): void {
  window.requestAnimationFrame(renderControl);
}

document.addEventListener('trv-render', scheduleRender);
window.addEventListener('DOMContentLoaded', scheduleRender);
window.setTimeout(scheduleRender, 0);
