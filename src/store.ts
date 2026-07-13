import { queueCloudSave } from './cloud-api.js';
import type { ConversationMessage, CrmData, FichaMode, ModuleId, WhatsAppConversation } from './models.js';
import { STORAGE_KEY, initialData } from './models.js';

function normalizedMessage(value: Partial<ConversationMessage>, fallbackId: number): ConversationMessage {
  const kind = value.kind === 'audio' ? 'audio' : 'text';
  const transcriptionStatus = kind === 'audio'
    ? value.transcriptionStatus ?? (value.transcript ? 'Transcripto' : 'Pendiente')
    : 'No requerida';
  return {
    id: Number.isFinite(value.id) ? Number(value.id) : fallbackId,
    direction: value.direction === 'outbound' ? 'outbound' : 'inbound',
    sender: value.sender === 'IA' || value.sender === 'Humano' ? value.sender : 'Cliente',
    text: String(value.text ?? ''),
    createdAt: String(value.createdAt ?? new Date().toISOString()),
    detectedData: Array.isArray(value.detectedData) ? value.detectedData.map(String) : [],
    kind,
    mediaId: value.mediaId ? String(value.mediaId) : undefined,
    mimeType: value.mimeType ? String(value.mimeType) : undefined,
    durationSeconds: Number.isFinite(value.durationSeconds) ? Number(value.durationSeconds) : undefined,
    transcript: value.transcript ? String(value.transcript) : undefined,
    transcriptionStatus,
  };
}

function normalizedConversation(value: Partial<WhatsAppConversation>, fallbackId: number): WhatsAppConversation {
  const messages = Array.isArray(value.messages)
    ? value.messages.map((message, index) => normalizedMessage(message, index + 1))
    : [];
  return {
    id: Number.isFinite(value.id) ? Number(value.id) : fallbackId,
    clientId: Number(value.clientId ?? 0),
    phone: String(value.phone ?? ''),
    mode: value.mode === 'Humano' || value.mode === 'Pausada' ? value.mode : 'IA supervisada',
    unread: Number.isFinite(value.unread) ? Number(value.unread) : 0,
    lastActivity: String(value.lastActivity ?? messages.at(-1)?.createdAt ?? new Date().toISOString()),
    messages,
    audit: value.audit,
  };
}

function normalizedData(value: Partial<CrmData>): CrmData {
  return {
    clients: Array.isArray(value.clients) ? value.clients : [],
    properties: Array.isArray(value.properties) ? value.properties : [],
    contacts: Array.isArray(value.contacts) ? value.contacts : [],
    reminders: Array.isArray(value.reminders) ? value.reminders : [],
    fichas: Array.isArray(value.fichas) ? value.fichas : [],
    conversations: Array.isArray(value.conversations)
      ? value.conversations.map((conversation, index) => normalizedConversation(conversation, index + 1))
      : [],
  };
}

function loadData(): CrmData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(initialData);
    return normalizedData(JSON.parse(raw) as Partial<CrmData>);
  } catch { return structuredClone(initialData); }
}

export const state = {
  crm: loadData(),
  activeModule: 'inicio' as ModuleId,
  fichaMode: 'property' as FichaMode,
  selectedFichaId: null as number | null,
  editingFichaId: null as number | null,
  editingClientId: null as number | null,
  selectedConversationId: null as number | null,
  selectedContactId: null as number | null,
  editingContactId: null as number | null,
  openForms: { client: false, property: false, contact: false, reminder: false, ficha: false },
};

export function replaceData(data: CrmData, syncCloud = false): void {
  state.crm = normalizedData(data);
  state.editingClientId = null;
  state.selectedConversationId = null;
  state.selectedContactId = null;
  state.editingContactId = null;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.crm));
  if (syncCloud) queueCloudSave(state.crm);
}

export function saveData(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.crm));
  queueCloudSave(state.crm);
}