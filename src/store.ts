import { queueCloudSave } from './cloud-api.js';
import { CrmData, FichaMode, ModuleId, STORAGE_KEY, initialData } from './models.js';

function normalizedData(value: Partial<CrmData>): CrmData {
  return {
    clients: Array.isArray(value.clients) ? value.clients : [],
    properties: Array.isArray(value.properties) ? value.properties : [],
    reminders: Array.isArray(value.reminders) ? value.reminders : [],
    fichas: Array.isArray(value.fichas) ? value.fichas : [],
    conversations: Array.isArray(value.conversations) ? value.conversations : [],
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
  openForms: { client: false, property: false, reminder: false, ficha: false },
};

export function replaceData(data: CrmData, syncCloud = false): void {
  state.crm = normalizedData(data);
  state.editingClientId = null;
  state.selectedConversationId = null;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.crm));
  if (syncCloud) queueCloudSave(state.crm);
}

export function saveData(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.crm));
  queueCloudSave(state.crm);
}
