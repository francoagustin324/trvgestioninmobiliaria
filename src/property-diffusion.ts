import type { TenantScope } from './active-organization.js';
import { queueCloudSave } from './cloud-api-compatible.js';
import type {
  ActivityEntry,
  Client,
  CrmData,
  Property,
  PropertyDiffusionActivityMetadata,
  PropertyDiffusionChannel,
  PublicTenantIdentity,
} from './models.js';
import { propertyShareText, type PropertyWithFicha } from './property-ficha.js';
import { authenticatedTenantMember, saveData, state } from './store.js';
import { assignmentVisible } from './team-policy.js';
import { assertTenantCrmScope, readTenantSnapshot, writeTenantSnapshot } from './tenant-storage.js';
import {
  assertTenantRuntimeLeaseCurrent,
  tenantRuntimeLeaseIsCurrent,
  tenantScopesEqual,
  type TenantRuntimeLease,
} from './tenant-runtime.js';
import { addActivityForAuthenticatedTenant } from './team-access.js';
import { normalizeWhatsAppPhone, whatsappUrl } from './whatsapp-contact-core.js';

export type { PropertyDiffusionChannel } from './models.js';

export interface PropertyDiffusionWriteContext {
  scope: TenantScope;
  runtimeLease: TenantRuntimeLease;
  propertyId: number;
  clientId: number;
  channel: PropertyDiffusionChannel;
}

export interface PropertyDiffusionSnapshot {
  attemptId: string;
  status: 'ENVIADO' | 'RESPONDIO';
  channel: PropertyDiffusionChannel;
  sentAt: string;
  respondedAt?: string;
  sentEntry: ActivityEntry;
  responseEntry?: ActivityEntry;
}

export interface PropertyDiffusionContact {
  whatsappUrl: string | null;
  whatsappDisplay: string;
  whatsappReason: string;
  emailUrl: string | null;
  email: string;
}

const priceFormatter = new Intl.NumberFormat('es-AR');

function metadataOf(entry: ActivityEntry): PropertyDiffusionActivityMetadata | null {
  const value = entry.metadata;
  if (!value || value.kind !== 'property_diffusion') return null;
  if (!Number.isFinite(value.propertyId) || !Number.isFinite(value.clientId)) return null;
  if (!value.attemptId || !value.sentAt) return null;
  if (value.channel !== 'WhatsApp' && value.channel !== 'Email') return null;
  if (value.event !== 'sent' && value.event !== 'responded') return null;
  return value;
}

function samePair(metadata: PropertyDiffusionActivityMetadata, property: Property, client: Client): boolean {
  const propertyMatches = property.uid && metadata.propertyUid
    ? property.uid === metadata.propertyUid
    : metadata.propertyId === property.id;
  const clientMatches = client.uid && metadata.clientUid
    ? client.uid === metadata.clientUid
    : metadata.clientId === client.id;
  return propertyMatches && clientMatches;
}

export function propertyDiffusionHistory(
  entries: ActivityEntry[],
  property: Property,
  client: Client,
): ActivityEntry[] {
  return entries
    .filter((entry) => {
      const metadata = metadataOf(entry);
      return Boolean(metadata && samePair(metadata, property, client));
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function latestPropertyDiffusion(
  entries: ActivityEntry[],
  property: Property,
  client: Client,
): PropertyDiffusionSnapshot | null {
  const history = propertyDiffusionHistory(entries, property, client);
  const sentEntry = history.find((entry) => metadataOf(entry)?.event === 'sent');
  if (!sentEntry) return null;
  const sent = metadataOf(sentEntry)!;
  const responseEntry = history.find((entry) => {
    const metadata = metadataOf(entry);
    return metadata?.event === 'responded' && metadata.attemptId === sent.attemptId;
  });
  const response = responseEntry ? metadataOf(responseEntry) : null;
  return {
    attemptId: sent.attemptId,
    status: response ? 'RESPONDIO' : 'ENVIADO',
    channel: sent.channel,
    sentAt: sent.sentAt,
    ...(response?.respondedAt ? { respondedAt: response.respondedAt } : {}),
    sentEntry,
    ...(responseEntry ? { responseEntry } : {}),
  };
}

export function buildPropertyDiffusionMessage(
  property: PropertyWithFicha,
  tenant: PublicTenantIdentity,
  publicUrl: string,
): string {
  const facts: string[] = [];
  if (property.address.trim()) facts.push(property.address.trim());
  const typeOperation = [property.type, property.operation].map((value) => String(value || '').trim()).filter(Boolean).join(' · ');
  if (typeOperation) facts.push(typeOperation);
  if (Number.isFinite(property.price) && property.price > 0) facts.push(`USD ${priceFormatter.format(property.price)}`);
  if (property.bedrooms) facts.push(`${property.bedrooms} ${property.bedrooms === 1 ? 'dormitorio' : 'dormitorios'}`);
  return [propertyShareText(property.title, tenant), facts.join(' · '), publicUrl.trim()]
    .filter(Boolean)
    .join('\n');
}

function validEmail(value: string | undefined): string {
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export function propertyDiffusionContact(client: Client, message: string, propertyTitle: string): PropertyDiffusionContact {
  const phone = normalizeWhatsAppPhone(client.phone || '');
  const email = validEmail(client.email);
  return {
    whatsappUrl: phone.valid ? whatsappUrl(phone.normalized, message) : null,
    whatsappDisplay: phone.valid ? phone.display : '',
    whatsappReason: phone.valid ? '' : phone.reason,
    emailUrl: email
      ? `mailto:${email}?subject=${encodeURIComponent(`Propiedad: ${propertyTitle}`)}&body=${encodeURIComponent(message)}`
      : null,
    email,
  };
}

function assertWriteContext(context: PropertyDiffusionWriteContext): void {
  if (!tenantScopesEqual(context.scope, context.runtimeLease.scope)) throw new Error('TENANT_RUNTIME_STALE');
  assertTenantRuntimeLeaseCurrent(context.runtimeLease);
  assertTenantCrmScope(context.scope, state.crm);
}

function authorizedPair(context: PropertyDiffusionWriteContext): { property: Property; client: Client } {
  assertWriteContext(context);
  const member = authenticatedTenantMember(context.scope);
  if (!member) throw new Error('AUTHENTICATED_TENANT_MEMBER_REQUIRED');
  const property = state.crm.properties.find((item) => item.id === context.propertyId);
  const client = state.crm.clients.find((item) => item.id === context.clientId);
  if (!property || !client) throw new Error('PROPERTY_DIFFUSION_PAIR_NOT_FOUND');
  if (!assignmentVisible(member.role, member.id, property.assignedToId)) throw new Error('PROPERTY_DIFFUSION_PROPERTY_FORBIDDEN');
  if (!assignmentVisible(member.role, member.id, client.assignedToId)) throw new Error('PROPERTY_DIFFUSION_CLIENT_FORBIDDEN');
  return { property, client };
}

function uniqueAttemptId(now: Date): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `property-diffusion-${now.getTime().toString(36)}-${random}`;
}

function rollback(previous: CrmData, context: PropertyDiffusionWriteContext): void {
  if (!tenantRuntimeLeaseIsCurrent(context.runtimeLease)) return;
  assertTenantRuntimeLeaseCurrent(context.runtimeLease);
  assertTenantCrmScope(context.scope, previous);
  state.crm = previous;
  try {
    writeTenantSnapshot(context.scope, previous, {
      markDirty: true,
      reason: 'Reversión de difusión no confirmada',
      backup: false,
    });
    queueCloudSave(context.scope, previous);
  } catch {
    // Se conserva el estado en memoria y el error original para permitir reintento.
  }
}

function persistedActivity(
  scope: TenantScope,
  attemptId: string,
  event: 'sent' | 'responded',
): ActivityEntry | null {
  const snapshot = readTenantSnapshot(scope);
  if (!snapshot) return null;
  assertTenantCrmScope(scope, snapshot);
  return snapshot.activityLog.find((entry) => {
    const metadata = metadataOf(entry);
    return metadata?.attemptId === attemptId && metadata.event === event;
  }) ?? null;
}

export function recordPropertyDiffusionSent(
  context: PropertyDiffusionWriteContext,
  now = new Date(),
): ActivityEntry {
  assertWriteContext(context);
  const previous = structuredClone(state.crm);
  assertTenantCrmScope(context.scope, previous);
  try {
    const { property, client } = authorizedPair(context);
    const attemptId = uniqueAttemptId(now);
    const metadata: PropertyDiffusionActivityMetadata = {
      kind: 'property_diffusion',
      event: 'sent',
      attemptId,
      propertyId: property.id,
      ...(property.uid ? { propertyUid: property.uid } : {}),
      clientId: client.id,
      ...(client.uid ? { clientUid: client.uid } : {}),
      channel: context.channel,
      status: 'ENVIADO',
      sentAt: now.toISOString(),
    };
    addActivityForAuthenticatedTenant(context.scope, {
      operationId: attemptId,
      action: 'Propiedad difundida',
      entityType: 'Cliente',
      entityId: client.id,
      ...(client.uid ? { entityUid: client.uid } : {}),
      detail: `Propiedad: ${property.title}\nCanal: ${context.channel}\nEstado: ENVIADO`,
      metadata,
    });
    const activity = state.crm.activityLog.find((entry) => metadataOf(entry)?.attemptId === attemptId);
    if (!activity) throw new Error('PROPERTY_DIFFUSION_ACTIVITY_MISSING');
    assertWriteContext(context);
    saveData(`Difusión registrada: ${property.title} → ${client.name}`);
    assertWriteContext(context);
    if (!persistedActivity(context.scope, attemptId, 'sent')) {
      throw new Error('La difusión no pudo confirmarse en el almacenamiento local.');
    }
    return activity;
  } catch (error) {
    rollback(previous, context);
    throw error;
  }
}

export function recordPropertyDiffusionResponse(
  context: PropertyDiffusionWriteContext & { attemptId: string },
  now = new Date(),
): ActivityEntry {
  assertWriteContext(context);
  const previous = structuredClone(state.crm);
  assertTenantCrmScope(context.scope, previous);
  try {
    const { property, client } = authorizedPair(context);
    const sentEntry = propertyDiffusionHistory(state.crm.activityLog, property, client)
      .find((entry) => {
        const metadata = metadataOf(entry);
        return metadata?.event === 'sent' && metadata.attemptId === context.attemptId;
      });
    const sent = sentEntry ? metadataOf(sentEntry) : null;
    if (!sent) throw new Error('PROPERTY_DIFFUSION_SENT_EVENT_REQUIRED');
    const existing = propertyDiffusionHistory(state.crm.activityLog, property, client)
      .find((entry) => {
        const metadata = metadataOf(entry);
        return metadata?.event === 'responded' && metadata.attemptId === context.attemptId;
      });
    if (existing) return existing;
    const metadata: PropertyDiffusionActivityMetadata = {
      ...sent,
      event: 'responded',
      status: 'RESPONDIO',
      respondedAt: now.toISOString(),
    };
    addActivityForAuthenticatedTenant(context.scope, {
      operationId: `${context.attemptId}:responded`,
      action: 'Respuesta a propiedad difundida',
      entityType: 'Cliente',
      entityId: client.id,
      ...(client.uid ? { entityUid: client.uid } : {}),
      detail: `Propiedad: ${property.title}\nCanal: ${sent.channel}\nEstado: RESPONDIO`,
      metadata,
    });
    const activity = state.crm.activityLog.find((entry) => {
      const item = metadataOf(entry);
      return item?.event === 'responded' && item.attemptId === context.attemptId;
    });
    if (!activity) throw new Error('PROPERTY_DIFFUSION_RESPONSE_ACTIVITY_MISSING');
    assertWriteContext(context);
    saveData(`Respuesta registrada: ${property.title} → ${client.name}`);
    assertWriteContext(context);
    if (!persistedActivity(context.scope, context.attemptId, 'responded')) {
      throw new Error('La respuesta no pudo confirmarse en el almacenamiento local.');
    }
    return activity;
  } catch (error) {
    rollback(previous, context);
    throw error;
  }
}
