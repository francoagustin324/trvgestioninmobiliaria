import { CrmData, FichaMode, ModuleId, STORAGE_KEY, initialData } from './models.js';

function loadData(): CrmData {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<CrmData>;
    return {
      clients: Array.isArray(parsed.clients) ? parsed.clients : initialData.clients,
      properties: Array.isArray(parsed.properties) ? parsed.properties : initialData.properties,
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : initialData.reminders,
      fichas: Array.isArray(parsed.fichas) ? parsed.fichas : [],
    };
  } catch { return structuredClone(initialData); }
}

export const state = {
  crm: loadData(),
  activeModule: 'inicio' as ModuleId,
  fichaMode: 'property' as FichaMode,
  selectedFichaId: null as number | null,
  editingFichaId: null as number | null,
  openForms: { client: false, property: false, reminder: false, ficha: false },
};

export function saveData(): void { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.crm)); }
