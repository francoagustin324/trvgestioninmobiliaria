import type {
  ActivityEntry,
  Client,
  CommercialContact,
  CrmData,
  Ficha,
  OrganizationSettings,
  Property,
  Reminder,
  TeamMember,
  TeamMemberStatus,
  TeamRole,
  WhatsAppConversation,
} from './models.js';

export type CloudEntityType = 'organization' | 'client' | 'property' | 'commercial_contact' | 'reminder' | 'ficha' | 'conversation' | 'activity';

export interface CloudRecordRow {
  organization_id: string;
  entity_type: CloudEntityType;
  entity_key: string;
  assigned_member_id: number | null;
  payload: unknown;
  created_by?: string;
  updated_at?: string;
}

export interface CloudMembershipRow {
  organization_id: string;
  member_id: number;
  user_id: string;
  role: string;
  status?: string;
  display_name?: string;
  email?: string;
  phone?: string;
  created_at?: string;
  last_active_at?: string;
}

export interface CloudMembershipContext {
  organizationId: string;
  currentMemberId: number;
  currentRole: TeamRole;
  members: TeamMember[];
}

function normalizedRole(value: unknown): TeamRole {
  const role = String(value ?? '').toLowerCase();
  if (['owner', 'dueño', 'dueno'].includes(role)) return 'Dueño';
  if (['admin', 'administrator', 'administrador'].includes(role)) return 'Administrador';
  return 'Corredor';
}

function normalizedStatus(value: unknown): TeamMemberStatus {
  const status = String(value ?? '').toLowerCase();
  if (status === 'suspended' || status === 'suspendido') return 'Suspendido';
  if (status === 'invited' || status === 'pending' || status === 'pendiente de acceso') return 'Pendiente de acceso';
  return 'Activo';
}

export function membershipContext(rows: CloudMembershipRow[], userId: string): CloudMembershipContext {
  const current = rows.find((row) => row.user_id === userId);
  if (!current?.organization_id || !Number.isFinite(current.member_id)) {
    throw new Error('La cuenta no tiene una membresía válida en la inmobiliaria.');
  }
  const organizationRows = rows.filter((row) => row.organization_id === current.organization_id);
  return {
    organizationId: current.organization_id,
    currentMemberId: Number(current.member_id),
    currentRole: normalizedRole(current.role),
    members: organizationRows.map((row) => ({
      id: Number(row.member_id),
      userId: row.user_id,
      name: String(row.display_name || row.email?.split('@')[0] || `Usuario ${row.member_id}`),
      email: String(row.email || ''),
      phone: row.phone || undefined,
      role: normalizedRole(row.role),
      status: normalizedStatus(row.status),
      createdAt: String(row.created_at || new Date(0).toISOString()),
      lastActiveAt: row.last_active_at || undefined,
    })).sort((left, right) => left.id - right.id),
  };
}

function assignedId(value: { assignedToId?: number; createdById?: number }, fallback: number): number {
  return Number(value.assignedToId ?? value.createdById ?? fallback);
}

function row(
  organizationId: string,
  entityType: CloudEntityType,
  entityKey: string | number,
  assignedMemberId: number | null,
  payload: unknown,
  userId: string,
): CloudRecordRow {
  return {
    organization_id: organizationId,
    entity_type: entityType,
    entity_key: String(entityKey),
    assigned_member_id: assignedMemberId,
    payload,
    created_by: userId,
  };
}

export function crmToCloudRecords(
  crm: CrmData,
  context: Pick<CloudMembershipContext, 'organizationId' | 'currentMemberId'>,
  userId: string,
): CloudRecordRow[] {
  const org = context.organizationId;
  const member = context.currentMemberId;
  return [
    row(org, 'organization', 'settings', null, { ...crm.organization, id: org }, userId),
    ...crm.clients.map((item) => row(org, 'client', item.id, assignedId(item, member), item, userId)),
    ...crm.properties.map((item) => row(org, 'property', item.id, assignedId(item, member), item, userId)),
    ...crm.contacts.map((item) => row(org, 'commercial_contact', item.id, assignedId(item, member), item, userId)),
    ...crm.reminders.map((item) => row(org, 'reminder', item.id, assignedId(item, member), item, userId)),
    ...crm.fichas.map((item) => row(org, 'ficha', item.id, assignedId(item, member), item, userId)),
    ...crm.conversations.map((item) => row(org, 'conversation', item.id, assignedId(item, member), item, userId)),
    ...crm.activityLog.map((item) => row(org, 'activity', item.id, Number(item.actorId || member), item, userId)),
  ];
}

function recordsOf<T>(rows: CloudRecordRow[], entityType: CloudEntityType): T[] {
  return rows
    .filter((item) => item.entity_type === entityType && item.payload && typeof item.payload === 'object')
    .map((item) => item.payload as T)
    .sort((left, right) => Number((left as { id?: number }).id ?? 0) - Number((right as { id?: number }).id ?? 0));
}

function organizationFromRows(rows: CloudRecordRow[], fallback: OrganizationSettings, organizationId: string): OrganizationSettings {
  const payload = rows.find((item) => item.entity_type === 'organization' && item.entity_key === 'settings')?.payload;
  const value = payload && typeof payload === 'object' ? payload as Partial<OrganizationSettings> : {};
  return {
    id: organizationId,
    name: String(value.name || fallback.name),
    seatLimit: Number.isFinite(value.seatLimit) && Number(value.seatLimit) > 0 ? Number(value.seatLimit) : null,
    planLabel: String(value.planLabel || fallback.planLabel),
  };
}

export function cloudRecordsToCrm(
  rows: CloudRecordRow[],
  context: CloudMembershipContext,
  fallback: CrmData,
): CrmData {
  const canUseFallback = context.currentRole !== 'Corredor' && rows.length === 0;
  if (canUseFallback) {
    return {
      ...fallback,
      organization: { ...fallback.organization, id: context.organizationId },
      teamMembers: context.members,
    };
  }
  return {
    organization: organizationFromRows(rows, fallback.organization, context.organizationId),
    teamMembers: context.members,
    activityLog: recordsOf<ActivityEntry>(rows, 'activity'),
    clients: recordsOf<Client>(rows, 'client'),
    properties: recordsOf<Property>(rows, 'property'),
    contacts: recordsOf<CommercialContact>(rows, 'commercial_contact'),
    reminders: recordsOf<Reminder>(rows, 'reminder'),
    fichas: recordsOf<Ficha>(rows, 'ficha'),
    conversations: recordsOf<WhatsAppConversation>(rows, 'conversation'),
  };
}

export function cloudRecordIdentity(record: Pick<CloudRecordRow, 'organization_id' | 'entity_type' | 'entity_key'>): string {
  return `${record.organization_id}:${record.entity_type}:${record.entity_key}`;
}

export function staleCloudRecords(existing: CloudRecordRow[], next: CloudRecordRow[]): CloudRecordRow[] {
  const nextIds = new Set(next.map(cloudRecordIdentity));
  return existing.filter((record) => !nextIds.has(cloudRecordIdentity(record)) && record.entity_type !== 'organization');
}
