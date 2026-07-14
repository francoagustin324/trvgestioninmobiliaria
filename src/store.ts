import { queueCloudSave } from './cloud-api.js';
import type {
  ActivityEntry,
  ConversationMessage,
  CrmData,
  FichaMode,
  ModuleId,
  OrganizationSettings,
  TeamMember,
  WhatsAppConversation,
} from './models.js';
import { initialData } from './models.js';
import {
  activateAccountStorage,
  hasLocalBackup as hasStoredLocalBackup,
  readLocalSnapshot,
  restoreLatestBackup,
  writeLocalSnapshot,
} from './sync-safety.js';

const TEAM_VIEW_KEY = 'propcontrol-active-team-member-v1';

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

function normalizedConversation(value: Partial<WhatsAppConversation>, fallbackId: number, fallbackOwnerId: number): WhatsAppConversation {
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
    assignedToId: Number(value.assignedToId ?? fallbackOwnerId),
    createdById: Number(value.createdById ?? fallbackOwnerId),
  };
}

function normalizedOrganization(value: Partial<OrganizationSettings> | undefined): OrganizationSettings {
  return {
    id: String(value?.id || initialData.organization.id),
    name: String(value?.name || initialData.organization.name),
    seatLimit: Number.isFinite(value?.seatLimit) && Number(value?.seatLimit) > 0 ? Number(value?.seatLimit) : null,
    planLabel: String(value?.planLabel || initialData.organization.planLabel),
  };
}

function normalizedTeamMembers(value: unknown): TeamMember[] {
  if (!Array.isArray(value) || !value.length) return structuredClone(initialData.teamMembers);
  const members = value.map((item, index) => {
    const record = item && typeof item === 'object' ? item as Partial<TeamMember> : {};
    const role = record.role === 'Administrador' || record.role === 'Corredor' ? record.role : 'Dueño';
    const status = record.status === 'Pendiente de acceso' || record.status === 'Suspendido' ? record.status : 'Activo';
    return {
      id: Number.isFinite(record.id) ? Number(record.id) : index + 1,
      userId: record.userId ? String(record.userId) : undefined,
      name: String(record.name || `Usuario ${index + 1}`),
      email: String(record.email || ''),
      phone: record.phone ? String(record.phone) : undefined,
      role,
      status,
      createdAt: String(record.createdAt || new Date().toISOString()),
      lastActiveAt: record.lastActiveAt ? String(record.lastActiveAt) : undefined,
    } satisfies TeamMember;
  });
  if (!members.some((member) => member.role === 'Dueño')) members[0] = { ...members[0]!, role: 'Dueño', status: 'Activo' };
  return members;
}

function normalizedActivityLog(value: unknown): ActivityEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ActivityEntry => Boolean(item && typeof item === 'object'))
    .map((item, index) => ({
      id: Number.isFinite(item.id) ? Number(item.id) : index + 1,
      actorId: Number(item.actorId || 1),
      action: String(item.action || 'Actualización'),
      entityType: item.entityType || 'Equipo',
      entityId: Number.isFinite(item.entityId) ? Number(item.entityId) : undefined,
      detail: String(item.detail || ''),
      createdAt: String(item.createdAt || new Date().toISOString()),
    }));
}

function normalizedData(value: Partial<CrmData>): CrmData {
  const teamMembers = normalizedTeamMembers(value.teamMembers);
  const ownerId = teamMembers.find((member) => member.role === 'Dueño')?.id ?? teamMembers[0]?.id ?? 1;
  return {
    organization: normalizedOrganization(value.organization),
    teamMembers,
    activityLog: normalizedActivityLog(value.activityLog),
    clients: Array.isArray(value.clients) ? value.clients.map((client) => ({
      ...client,
      assignedToId: Number(client.assignedToId ?? ownerId),
      createdById: Number(client.createdById ?? ownerId),
    })) : [],
    properties: Array.isArray(value.properties) ? value.properties.map((property) => ({
      ...property,
      assignedToId: Number(property.assignedToId ?? ownerId),
      createdById: Number(property.createdById ?? ownerId),
    })) : [],
    contacts: Array.isArray(value.contacts) ? value.contacts.map((contact) => ({
      ...contact,
      assignedToId: Number(contact.assignedToId ?? contact.createdById ?? ownerId),
      createdById: Number(contact.createdById ?? ownerId),
    })) : [],
    reminders: Array.isArray(value.reminders) ? value.reminders.map((reminder) => ({
      ...reminder,
      assignedToId: Number(reminder.assignedToId ?? ownerId),
      createdById: Number(reminder.createdById ?? ownerId),
    })) : [],
    fichas: Array.isArray(value.fichas) ? value.fichas.map((ficha) => ({
      ...ficha,
      assignedToId: Number(ficha.assignedToId ?? ficha.createdById ?? ownerId),
      createdById: Number(ficha.createdById ?? ownerId),
    })) : [],
    conversations: Array.isArray(value.conversations)
      ? value.conversations.map((conversation, index) => normalizedConversation(conversation, index + 1, ownerId))
      : [],
  };
}

function loadData(): CrmData {
  const local = readLocalSnapshot();
  return local ? normalizedData(local) : structuredClone(initialData);
}

function loadActiveMemberId(crm: CrmData): number {
  const stored = Number(localStorage.getItem(TEAM_VIEW_KEY));
  if (crm.teamMembers.some((member) => member.id === stored && member.status !== 'Suspendido')) return stored;
  return crm.teamMembers.find((member) => member.role === 'Dueño' && member.status === 'Activo')?.id
    ?? crm.teamMembers.find((member) => member.status === 'Activo')?.id
    ?? crm.teamMembers[0]?.id
    ?? 1;
}

const loadedCrm = loadData();

export const state = {
  crm: loadedCrm,
  activeMemberId: loadActiveMemberId(loadedCrm),
  activeModule: 'crm' as ModuleId,
  fichaMode: 'property' as FichaMode,
  selectedFichaId: null as number | null,
  editingFichaId: null as number | null,
  editingClientId: null as number | null,
  selectedConversationId: null as number | null,
  selectedContactId: null as number | null,
  editingContactId: null as number | null,
  openForms: { client: false, property: false, contact: false, reminder: false, ficha: false, member: false },
};

function resetTransientState(): void {
  state.activeMemberId = loadActiveMemberId(state.crm);
  state.editingClientId = null;
  state.selectedConversationId = null;
  state.selectedContactId = null;
  state.editingContactId = null;
}

export function activateStorageForCurrentSession(): void {
  activateAccountStorage();
  state.crm = loadData();
  resetTransientState();
}

export function setActiveMemberId(memberId: number): void {
  const member = state.crm.teamMembers.find((item) => item.id === memberId && item.status !== 'Suspendido');
  if (!member) return;
  state.activeMemberId = member.id;
  localStorage.setItem(TEAM_VIEW_KEY, String(member.id));
  state.editingClientId = null;
  state.selectedConversationId = member.role === 'Corredor'
    ? state.crm.conversations.find((conversation) => conversation.assignedToId === member.id)?.id ?? null
    : null;
}

export function replaceData(data: CrmData, syncCloud = false): void {
  state.crm = normalizedData(data);
  resetTransientState();
  writeLocalSnapshot(state.crm, {
    markDirty: syncCloud,
    reason: syncCloud ? 'Restauración local' : 'Carga desde la nube',
  });
  if (syncCloud) queueCloudSave(state.crm);
}

export function saveData(reason = 'Cambio local'): void {
  writeLocalSnapshot(state.crm, { markDirty: true, reason });
  queueCloudSave(state.crm);
}

export function hasLocalBackup(): boolean {
  return hasStoredLocalBackup();
}

export function restoreLatestLocalBackup(): boolean {
  const restored = restoreLatestBackup();
  if (!restored) return false;
  state.crm = normalizedData(restored);
  resetTransientState();
  writeLocalSnapshot(state.crm, { markDirty: true, reason: 'Restauración confirmada', backup: false });
  queueCloudSave(state.crm);
  return true;
}
