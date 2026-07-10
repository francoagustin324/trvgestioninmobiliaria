export const STORAGE_KEY = 'trv-crm-basico';
export const WHATSAPP_NUMBER = '5493515110069';
export const FICHA_LEGAL = 'Propiedad sujeta a disponibilidad y confirmación de condiciones al momento de la consulta.';
export const LOGO_PATH = '/src/assets/trv-logo.svg';

export type Temperature = 'Caliente' | 'Tibio' | 'Frío';
export type ModuleId = 'inicio' | 'crm' | 'propiedades' | 'fichas' | 'whatsapp' | 'agenda' | 'reportes' | 'configuracion';
export type FichaMode = 'manual' | 'property' | 'external';
export type PhotoEnhancement = 'none' | 'soft';

export interface Client {
  id: number; name: string; phone: string; email?: string; interest: string; status: string;
  temperature: Temperature; pipeline: string; lastContact?: string; nextFollowUp?: string;
  budget?: string; paymentMethod?: string; purchaseTimeframe?: string; purpose?: string;
  knowsArea?: string; canMoveForward?: string; objections?: string; notes?: string;
}

export interface Property {
  id: number; title: string; address: string; type: string; operation: string;
  price: number; owner: string; status: string;
}

export interface Reminder {
  id: number; date: string; title: string; related: string; priority: string;
}

export interface FichaPublica {
  title: string; propertyType?: string; operation?: string; zone?: string; approxAddress?: string;
  price?: string; expenses?: string; bedrooms?: string; bathrooms?: string; garage?: string;
  coveredMeters?: string; totalMeters?: string; age?: string; status?: string; amenities?: string;
  description?: string; deed?: string; creditReady?: string; paymentMethod?: string; photoUrls: string[];
  photoEnhancement?: PhotoEnhancement;
}

export interface Ficha extends FichaPublica {
  id: number; mode: FichaMode; sourcePropertyId?: number; internalOriginalLink?: string;
  source?: string; internalNotes?: string; createdAt: string;
}

export interface CrmData { clients: Client[]; properties: Property[]; reminders: Reminder[]; fichas: Ficha[]; }

export const modules: Array<[ModuleId, string]> = [
  ['inicio', 'Inicio'], ['crm', 'CRM / Leads'], ['propiedades', 'Propiedades'], ['fichas', 'Fichas TRV'],
  ['whatsapp', 'WhatsApp + IA'], ['agenda', 'Agenda / Seguimiento'], ['reportes', 'Reportes'], ['configuracion', 'Configuración'],
];

export const initialData: CrmData = {
  clients: [{
    id: 1, name: 'Lucía Martín', phone: '351 555-0101', email: 'lucia@email.com',
    interest: 'Departamento de 2 dormitorios en Nueva Córdoba', status: 'Lead', temperature: 'Caliente',
    pipeline: 'Visita posible', lastContact: '2026-07-06', nextFollowUp: '2026-07-09', budget: 'USD 90.000',
    paymentMethod: 'Contado', purchaseTimeframe: '0-3 meses', purpose: 'Vivir', knowsArea: 'Sí',
    canMoveForward: 'Sí', objections: 'Busca balcón y buena luz natural', notes: 'Revisar opciones antes de coordinar visita.',
  }],
  properties: [{ id: 1, title: 'Departamento en General Paz', address: 'General Paz, Córdoba', type: 'Departamento', operation: 'Venta', price: 85000, owner: 'Propietario', status: 'Activa' }],
  reminders: [{ id: 1, date: '2026-07-13', title: 'Llamar a Lucía', related: 'Búsqueda Nueva Córdoba', priority: 'Alta' }],
  fichas: [],
};
