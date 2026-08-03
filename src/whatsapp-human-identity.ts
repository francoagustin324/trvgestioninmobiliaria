import { getCloudSession } from './cloud-api.js';
import { isHumanIdentityName, normalizeHumanIdentityName, safeOrganizationName } from './human-identity.js';
import type { TeamMember } from './models.js';
import { state } from './store.js';

export const WHATSAPP_IDENTITY_STORAGE_PREFIX = 'propcontrol-whatsapp-human-identity-v1';
export const WHATSAPP_IDENTITY_CHANGED_EVENT = 'propcontrol-whatsapp-identity-changed';
const CONFIG_VERSION = 1;

interface WhatsAppHumanIdentityConfig {
  version: 1;
  organizationId: string;
  memberId: number;
  actorKey: string;
  humanName: string;
  confirmedAt: string;
}

export interface WhatsAppHumanIdentitySnapshot {
  actorId: number;
  memberId: number;
  memberUserId: string;
  actorKey: string;
  fullName: string;
  firstName: string;
  memberDisplayName: string;
  organization: string;
  organizationId: string;
  identityId: string;
  confirmedAt: string;
  fingerprint: string;
  createdAt: string;
}

export interface WhatsAppHumanIdentityAuthorization {
  valid: boolean;
  identity: WhatsAppHumanIdentitySnapshot | null;
  reason: string;
  changed: boolean;
}

interface CurrentIdentityContext {
  member: TeamMember;
  actorKey: string;
  memberUserId: string;
  organizationId: string;
  organization: string;
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

export function whatsappIdentityStorageKey(
  organizationId: string,
  memberId: number,
  actorKey: string,
): string {
  return `${WHATSAPP_IDENTITY_STORAGE_PREFIX}:${encodeURIComponent(organizationId)}:${memberId}:${encodeURIComponent(actorKey)}`;
}

function currentContext(): { context: CurrentIdentityContext | null; reason: string } {
  const member = state.crm.teamMembers.find((item) => item.id === state.activeMemberId);
  if (!member || member.status !== 'Activo') {
    return { context: null, reason: 'El miembro activo no está disponible para firmar mensajes.' };
  }

  const session = getCloudSession();
  if (session && !member.userId) {
    return { context: null, reason: 'No se pudo asociar la sesión actual con un miembro verificable.' };
  }
  if (session && member.userId !== session.userId) {
    return { context: null, reason: 'El usuario autenticado no coincide con el miembro activo.' };
  }

  const memberUserId = member.userId || '';
  const actorKey = session
    ? `cloud:${session.userId}`
    : `local:${memberUserId || member.id}`;
  return {
    context: {
      member,
      actorKey,
      memberUserId,
      organizationId: state.crm.organization.id.trim(),
      organization: safeOrganizationName(
        state.crm.settings.agencyName.trim() || state.crm.organization.name.trim(),
      ),
    },
    reason: '',
  };
}

function readConfig(context: CurrentIdentityContext): WhatsAppHumanIdentityConfig | null {
  try {
    const raw = localStorage.getItem(whatsappIdentityStorageKey(
      context.organizationId,
      context.member.id,
      context.actorKey,
    ));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<WhatsAppHumanIdentityConfig>;
    if (
      value.version !== CONFIG_VERSION
      || value.organizationId !== context.organizationId
      || value.memberId !== context.member.id
      || value.actorKey !== context.actorKey
      || typeof value.humanName !== 'string'
      || typeof value.confirmedAt !== 'string'
      || !Number.isFinite(Date.parse(value.confirmedAt))
    ) return null;
    return value as WhatsAppHumanIdentityConfig;
  } catch {
    return null;
  }
}

function snapshot(context: CurrentIdentityContext, config: WhatsAppHumanIdentityConfig): WhatsAppHumanIdentitySnapshot {
  const fullName = normalizeHumanIdentityName(config.humanName);
  const identityId = [
    context.organizationId,
    context.member.id,
    context.actorKey,
    config.confirmedAt,
  ].join('|');
  const fingerprint = hash([
    CONFIG_VERSION,
    context.organizationId,
    context.organization,
    context.member.id,
    context.memberUserId,
    context.actorKey,
    context.member.name.trim(),
    fullName,
    config.confirmedAt,
  ].join('|'));
  return {
    actorId: context.member.id,
    memberId: context.member.id,
    memberUserId: context.memberUserId,
    actorKey: context.actorKey,
    fullName,
    firstName: fullName.split(/\s+/)[0] || fullName,
    memberDisplayName: context.member.name.trim(),
    organization: context.organization,
    organizationId: context.organizationId,
    identityId,
    confirmedAt: config.confirmedAt,
    fingerprint,
    createdAt: new Date().toISOString(),
  };
}

export function sameWhatsAppHumanIdentity(
  expected: WhatsAppHumanIdentitySnapshot,
  current: WhatsAppHumanIdentitySnapshot,
): boolean {
  return expected.actorId === current.actorId
    && expected.memberId === current.memberId
    && expected.memberUserId === current.memberUserId
    && expected.actorKey === current.actorKey
    && expected.organizationId === current.organizationId
    && expected.organization === current.organization
    && expected.identityId === current.identityId
    && expected.fingerprint === current.fingerprint
    && expected.fullName === current.fullName;
}

export function assertCurrentWhatsAppHumanIdentity(
  expected?: WhatsAppHumanIdentitySnapshot | null,
): WhatsAppHumanIdentityAuthorization {
  const resolved = currentContext();
  if (!resolved.context) {
    return { valid: false, identity: null, reason: resolved.reason, changed: Boolean(expected) };
  }
  const config = readConfig(resolved.context);
  if (!config) {
    return {
      valid: false,
      identity: null,
      reason: 'Configurá “Nombre personal para firmar mensajes” y confirmá que este nombre aparecerá en los mensajes enviados a clientes.',
      changed: Boolean(expected),
    };
  }
  if (!isHumanIdentityName(config.humanName, resolved.context.organization, resolved.context.organizationId)) {
    return {
      valid: false,
      identity: null,
      reason: 'La identidad configurada ya no es válida como nombre personal. Volvé a configurarla.',
      changed: Boolean(expected),
    };
  }
  const current = snapshot(resolved.context, config);
  if (expected && !sameWhatsAppHumanIdentity(expected, current)) {
    return {
      valid: false,
      identity: current,
      reason: 'Tu identidad o usuario activo cambió. Volvé a preparar el mensaje.',
      changed: true,
    };
  }
  return { valid: true, identity: current, reason: '', changed: false };
}

export function configureCurrentWhatsAppHumanIdentity(input: {
  humanName: string;
  confirmed: boolean;
  now?: Date;
}): WhatsAppHumanIdentityAuthorization {
  const resolved = currentContext();
  if (!resolved.context) {
    return { valid: false, identity: null, reason: resolved.reason, changed: false };
  }
  if (!input.confirmed) {
    return {
      valid: false,
      identity: null,
      reason: 'Confirmá que este nombre aparecerá en los mensajes enviados a clientes.',
      changed: false,
    };
  }
  const humanName = normalizeHumanIdentityName(input.humanName);
  if (!isHumanIdentityName(humanName, resolved.context.organization, resolved.context.organizationId)) {
    return {
      valid: false,
      identity: null,
      reason: 'Ingresá únicamente el nombre personal real. No uses empresas, equipos, áreas, cargos, correos ni identificadores.',
      changed: false,
    };
  }
  const config: WhatsAppHumanIdentityConfig = {
    version: CONFIG_VERSION,
    organizationId: resolved.context.organizationId,
    memberId: resolved.context.member.id,
    actorKey: resolved.context.actorKey,
    humanName,
    confirmedAt: (input.now ?? new Date()).toISOString(),
  };
  localStorage.setItem(
    whatsappIdentityStorageKey(config.organizationId, config.memberId, config.actorKey),
    JSON.stringify(config),
  );
  const identity = snapshot(resolved.context, config);
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent(WHATSAPP_IDENTITY_CHANGED_EVENT, {
      detail: { fingerprint: identity.fingerprint, memberId: identity.memberId },
    }));
  }
  return { valid: true, identity, reason: '', changed: true };
}

export function clearCurrentWhatsAppHumanIdentity(): void {
  const resolved = currentContext();
  if (!resolved.context) return;
  localStorage.removeItem(whatsappIdentityStorageKey(
    resolved.context.organizationId,
    resolved.context.member.id,
    resolved.context.actorKey,
  ));
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent(WHATSAPP_IDENTITY_CHANGED_EVENT));
  }
}
