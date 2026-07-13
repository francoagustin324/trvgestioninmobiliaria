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

function normalizedEmail(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export function reconcileCrmAssignments(crm: CrmData, context: CloudMembershipContext): CrmData {
  const validMemberIds = new Set(context.members.map((member) => member.id));
  const legacyToCloud = new Map<number, number>();

  crm.teamMembers.forEach((legacyMember) => {
    const email = normalizedEmail(legacyMember.email);
    const match = context.members.find((member) => (
      Boolean(legacyMember.userId && member.userId === legacyMember.userId)
      || Boolean(email && normalizedEmail(member.email) === email)
    ));
    if (match) legacyToCloud.set(legacyMember.id, match.id);
    else if (legacyMember.role === context.currentRole) legacyToCloud.set(legacyMember.id, context.currentMemberId);
  });

  const memberId = (value: number | undefined): number => {
    if (value !== undefined && validMemberIds.has(value)) return value;
    if (value !== undefined && legacyToCloud.has(value)) return legacyToCloud.get(value)!;
    return context.currentMemberId;
  };
  const assigned = <T extends { assignedToId?: number; createdById?: number }>(item: T): T => ({
    ...item,
    assignedToId: memberId(item.assignedToId),
    createdById: memberId(item.createdById),
  });

  return {
    ...crm,
    organization: { ...crm.organization, id: context.organizationId },
    teamMembers: context.members,
    clients: crm.clients.map(assigned),
    properties: crm.properties.map(assigned),
    contacts: crm.contacts.map(assigned),
    reminders: crm.reminders.map(assigned),
    fichas: crm.fichas.map(assigned),
    conversations: crm.conversations.map(assigned),
    activityLog: crm.activityLog.map((item) => ({ ...item, actorId: memberId(item.actorId) })),
  };
}

function assignedId(value: { assignedToId?: number; createdById?: number }, fallback: number): number {
  return Number(value.assignedToId ?? value.createdById ?? fallback);
}

export function organizationScopedEntityKey(organizationId: string, entityKey: string | number): string {
  return `${organizationId}:${String(entityKey)}`;
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
    entity_key: organizationScopedEntityKey(organizationId, entityKey),
    assigned_member_id: assignedMemberId,
    payload,
    created_by: userId,
  };
}

function visibleToCurrentMember<T extends { assignedToId?: number }>(
  items: T[],
  context: Pick<CloudMembershipContext, 'currentMemberId' | 'currentRole'>,
): T[] {
  if (context.currentRole !== 'Corredor') return items;
  return items.filter((item) => item.assignedToId === context.currentMemberId);
}

export function crmToCloudRecords(
  crm: CrmData,
  context: CloudMembershipContext,
  userId: string,
): CloudRecordRow[] {
  const reconciled = reconcileCrmAssignments(crm, context);
  const org = context.organizationId;
  const member = context.currentMemberId;
  const elevated = context.currentRole !== 'Corredor';
  return [
    ...(elevated ? [row(org, 'organization', 'settings', null, reconciled.organization, userId)] : []),
    ...visibleToCurrentMember(reconciled.clients, context).map((item) => row(org, 'client', item.id, assignedId(item, member), item, userId)),
    ...visibleToCurrentMember(reconciled.properties, context).map((item) => row(org, 'property', item.id, assignedId(item, member), item, userId)),
    ...visibleToCurrentMember(reconciled.contacts, context).map((item) => row(org, 'commercial_contact', item.id, assignedId(item, member), item, userId)),
    ...visibleToCurrentMember(reconciled.reminders, context).map((item) => row(org, 'reminder', item.id, assignedId(item, member), item, userId)),
    ...visibleToCurrentMember(reconciled.fichas, context).map((item) => row(org, 'ficha', item.id, assignedId(item, member), item, userId)),
    ...visibleToCurrentMember(reconciled.conversations, context).map((item) => row(org, 'conversation', item.id, assignedId(item, member), item, userId)),
    ...reconciled.activityLog
      .filter((item) => elevated || item.actorId === member)
      .map((item) => row(org, 'activity', item.id, Number(item.actorId || member), item, userId)),
  ];
}

function recordsOf<T>(rows: CloudRecordRow[], entityType: CloudEntityType): T[] {
  return rows
    .filter((item) => item.entity_type === entityType && item.payload && typeof item.payload === 'object')
    .map((item) => item.payload as T)
    .sort((left, right) => Number((left as { id?: number }).id ?? 0) - Number((right as { id?: number }).id ?? 0));
}

function organizationFromRows(rows: CloudRecordRow[], fallback: OrganizationSettings, organizationId: string): OrganizationSettings {
  const expectedKey = organizationScopedEntityKey(organizationId, 'settings');
  const payload = rows.find((item) => item.entity_type === 'organization' && item.entity_key === expectedKey)?.payload;
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
  if (canUseFallback) return reconcileCrmAssignments(fallback, context);
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
