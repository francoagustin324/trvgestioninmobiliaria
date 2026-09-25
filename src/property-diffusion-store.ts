import type { TenantScope } from './active-organization.js';
import type {
  ActivityEntry,
  Client,
  Property,
  PropertyDiffusionChannel,
} from './models.js';
import {
  latestPropertyDiffusionSent,
  propertyDiffusionActivityData,
  type ConfirmedPropertyDiffusionStatus,
} from './property-diffusion.js';
import {
  authenticatedTenantMember,
  saveData,
  state,
} from './store.js';
import { addActivityForAuthenticatedTenant } from './team-access.js';
import { assignmentVisible } from './team-policy.js';
import { assertTenantCrmScope, writeTenantSnapshot } from './tenant-storage.js';
import {
  assertTenantRuntimeLeaseCurrent,
  TENANT_RUNTIME_STALE,
  tenantRuntimeLeaseIsCurrent,
  tenantScopesEqual,
  type TenantRuntimeLease,
} from './tenant-runtime.js';

export interface RecordPropertyDiffusionInput {
  scope: TenantScope;
  runtimeLease: TenantRuntimeLease;
  property: Property;
  client: Client;
  channel: PropertyDiffusionChannel;
  status: ConfirmedPropertyDiffusionStatus;
}

type PersistDiffusion = (reason?: string) => void;

function identityMatches(
  current: Pick<Property | Client, 'id' | 'uid'>,
  requested: Pick<Property | Client, 'id' | 'uid'>,
): boolean {
  if (current.id !== requested.id) return false;
  if (current.uid && requested.uid) return current.uid === requested.uid;
  return true;
}

function currentAuthorizedPair(input: RecordPropertyDiffusionInput): { property: Property; client: Client } {
  if (!tenantScopesEqual(input.scope, input.runtimeLease.scope)) throw new Error(TENANT_RUNTIME_STALE);
  assertTenantRuntimeLeaseCurrent(input.runtimeLease);
  assertTenantCrmScope(input.scope, state.crm);
  const member = authenticatedTenantMember(input.scope);
  if (!member) throw new Error('AUTHENTICATED_TENANT_MEMBER_REQUIRED');

  const property = state.crm.properties.find((item) => identityMatches(item, input.property));
  const client = state.crm.clients.find((item) => identityMatches(item, input.client));
  if (!property || !client) throw new Error('PROPERTY_DIFFUSION_TARGET_MISSING');
  if (!assignmentVisible(member.role, member.id, property.assignedToId)) {
    throw new Error('PROPERTY_DIFFUSION_PROPERTY_FORBIDDEN');
  }
  if (!assignmentVisible(member.role, member.id, client.assignedToId)) {
    throw new Error('PROPERTY_DIFFUSION_CLIENT_FORBIDDEN');
  }
  return { property, client };
}

function rollbackDiffusion(
  input: RecordPropertyDiffusionInput,
  previousCrm: typeof state.crm,
): void {
  if (!tenantRuntimeLeaseIsCurrent(input.runtimeLease)) return;
  try {
    assertTenantRuntimeLeaseCurrent(input.runtimeLease);
    assertTenantCrmScope(input.scope, previousCrm);
    state.crm = previousCrm;
    assertTenantCrmScope(input.scope, state.crm);
    writeTenantSnapshot(input.scope, previousCrm, {
      markDirty: true,
      reason: 'Reversión de difusión no persistida',
      backup: false,
    });
  } catch {
    // Fail closed: nunca se restaura sobre otro tenant/runtime.
  }
}

export function recordPropertyDiffusionEvent(
  input: RecordPropertyDiffusionInput,
  persist: PersistDiffusion = saveData,
): ActivityEntry {
  if (input.channel !== 'WhatsApp' && input.channel !== 'Email') {
    throw new Error('PROPERTY_DIFFUSION_CHANNEL_INVALID');
  }
  if (input.status !== 'ENVIADO' && input.status !== 'RESPONDIO') {
    throw new Error('PROPERTY_DIFFUSION_STATUS_INVALID');
  }

  const { property, client } = currentAuthorizedPair(input);
  if (
    input.status === 'RESPONDIO'
    && !latestPropertyDiffusionSent(state.crm.activityLog, property, client)
  ) {
    throw new Error('PROPERTY_DIFFUSION_RESPONSE_WITHOUT_SEND');
  }

  const previousCrm = structuredClone(state.crm);
  try {
    assertTenantRuntimeLeaseCurrent(input.runtimeLease);
    addActivityForAuthenticatedTenant(
      input.scope,
      propertyDiffusionActivityData(property, client, input.channel, input.status),
    );
    assertTenantRuntimeLeaseCurrent(input.runtimeLease);
    assertTenantCrmScope(input.scope, state.crm);
    persist(input.status === 'ENVIADO' ? 'Difusión de propiedad registrada' : 'Respuesta a difusión registrada');
    assertTenantRuntimeLeaseCurrent(input.runtimeLease);
    assertTenantCrmScope(input.scope, state.crm);
  } catch (error) {
    rollbackDiffusion(input, previousCrm);
    throw error;
  }

  const entry = state.crm.activityLog[0];
  if (!entry || entry.activityKind !== 'property-diffusion') {
    rollbackDiffusion(input, previousCrm);
    throw new Error('PROPERTY_DIFFUSION_ACTIVITY_MISSING');
  }
  return entry;
}
