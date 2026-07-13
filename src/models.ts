import { AGENCY_BRAND } from './branding.js';

export const STORAGE_KEY = 'trv-crm-basico';
export const WHATSAPP_NUMBER = AGENCY_BRAND.whatsapp;
export const FICHA_LEGAL = AGENCY_BRAND.publicLegal;
export const LOGO_PATH = AGENCY_BRAND.logo;

export type Temperature = 'Caliente' | 'Tibio' | 'Frío';
export type ModuleId = 'inicio' | 'crm' | 'propiedades' | 'red' | 'fichas' | 'whatsapp' | 'agenda' | 'reportes' | 'configuracion';
export type FichaMode = 'manual' | 'property' | 'external';
export type PhotoEnhancement = 'none' | 'soft';
export type ConversationMode = 'IA supervisada' | 'Humano' | 'Pausada';
export type MessageSender = 'Cliente' | 'IA' | 'Humano';
export type MessageKind = 'text' | 'audio';
export type TranscriptionStatus = 'No requerida' | 'Pendiente' | 'Transcripto' | 'Error';
export type CommercialContactType = 'Colega / Inmobiliaria' | 'Constructor / Desarrollista' | 'Propietario';
export type ConversationStatus = 'Sigue buscando' | 'Esperando vender' | 'Ya compró' | 'No busca más' | 'Contacto comercial' | 'Revisar manualmente';
export type FollowUpDecision = 'Seguimiento supervisado' | 'Pausar' | 'No contactar' | 'Revisión manual';
export type AuditSource = 'Automático' | 'Manual';
export type AuditEngine = 'Reglas de seguridad' | 'Comprensión por conceptos' | 'Manual';

export interface Client {
  id: number; name: string; phone: string; email?: string; interest: string; status: string;
  temperature: Temperature; pipeline: string; lastContact?: string; nextFollowUp?: string;
  budget?: string; paymentMethod?: string; purchaseTimeframe?: string; purpose?: string;
  knowsArea?: string; canMoveForward?: string; objections?: string; notes?: string;
}

export interface CommercialContact {
  id: number;
  type: CommercialContactType;
  name: string;
  company?: string;
  phone: string;
  email?: string;
  zones?: string;
  tags?: string;
  notes?: string;
  lastContact?: string;
  createdAt: string;
}

export interface Property {
  id: number; title: string; address: string; type: string; operation: string;
  price: number; owner: string; status: string; bedrooms?: number; bathrooms?: number;
  paymentMethod?: string; features?: string; notes?: string;
  sourceContactId?: number; sharedAt?: string; sourceLink?: string;
}

export interface Reminder {
  id: number; date: string; title: string; related: string; priority: string;
}

export interface ConversationMessage {
  id: number;
  direction: 'inbound' | 'outbound';
  sender: MessageSender;
  text: string;
  createdAt: string;
  detectedData?: string[];
  kind?: MessageKind;
  mediaId?: string;
  mimeType?: string;
  durationSeconds?: number;
  transcript?: string;
  transcriptionStatus?: TranscriptionStatus;
}

export interface ConversationAudit {
  status: ConversationStatus;
  decision: FollowUpDecision;
  confidence: number;
  reasons: string[];
  auditedAt: string;
  source: AuditSource;
  engine?: AuditEngine;
}

export interface WhatsAppConversation {
  id: number;
  clientId: number;
  phone: string;
  mode: ConversationMode;
  unread: number;
  lastActivity: string;
  messages: ConversationMessage[];
  audit?: ConversationAudit;
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

export interface CrmData {
  clients: Client[];
  properties: Property[];
  contacts: CommercialContact[];
  reminders: Reminder[];
  fichas: Ficha[];
  conversations: WhatsAppConversation[];
}

export const modules: Array<[ModuleId, string]> = [
  ['inicio', 'Inicio'], ['crm', 'CRM / Leads'], ['propiedades', 'Propiedades'], ['red', 'Red comercial'],
  ['fichas', 'Fichas TRV'], ['whatsapp', 'WhatsApp + IA'], ['agenda', 'Agenda / Seguimiento'],
  ['reportes', 'Reportes'], ['configuracion', 'Configuración'],
];

export const initialData: CrmData = {
  clients: [{
    id: 1, name: 'Lucía Martín', phone: '351 555-0101', email: 'lucia@email.com',
    interest: 'Departamento de 2 dormitorios en Nueva Córdoba', status: 'Lead', temperature: 'Caliente',
    pipeline: 'Visita posible', lastContact: '2026-07-06', nextFollowUp: '2026-07-09', budget: 'USD 90.000',
    paymentMethod: 'Contado', purchaseTimeframe: '0-3 meses', purpose: 'Vivir', knowsArea: 'Sí',
    canMoveForward: 'Sí', objections: 'Busca balcón y buena luz natural', notes: 'Revisar opciones antes de coordinar visita.',
  }],
  contacts: [{
    id: 1,
    type: 'Colega / Inmobiliaria',
    name: 'Martín Suárez',
    company: 'Inmobiliaria Centro',
    phone: '5493515550198',
    email: '',
    zones: 'General Paz, Cofico',
    tags: 'Departamentos, comparte comisión',
    notes: 'Contacto de ejemplo para organizar productos compartidos.',
    lastContact: '2026-07-11',
    createdAt: '2026-07-11T15:00:00.000Z',
  }],
  properties: [{
    id: 1, title: 'Departamento en General Paz', address: 'General Paz, Córdoba', type: 'Departamento',
    operation: 'Venta', price: 85000, owner: 'Propietario', status: 'Activa', bedrooms: 2, bathrooms: 1,
    paymentMethod: 'Contado', features: 'Balcón, buena luz natural', notes: '',
    sourceContactId: 1, sharedAt: '2026-07-11', sourceLink: '',
  }],
  reminders: [{ id: 1, date: '2026-07-13', title: 'Llamar a Lucía', related: 'Búsqueda Nueva Córdoba', priority: 'Alta' }],
  fichas: [],
  conversations: [{
    id: 1,
    clientId: 1,
    phone: '351 555-0101',
    mode: 'IA supervisada',
    unread: 1,
    lastActivity: '2026-07-13T12:15:00.000Z',
    messages: [{
      id: 1,
      direction: 'inbound',
      sender: 'Cliente',
      text: 'Hola, ¿se puede ver el departamento?',
      createdAt: '2026-07-13T12:15:00.000Z',
      kind: 'text',
      transcriptionStatus: 'No requerida',
    }],
  }],
};