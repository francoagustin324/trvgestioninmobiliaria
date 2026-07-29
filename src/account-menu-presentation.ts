import type { OrganizationSettings, Settings, TeamMember } from './models.js';
import { syncStatusLabel, type SyncState } from './sync-safety.js';

export interface AccountIdentityInput {
  settings: Settings;
  organization: OrganizationSettings;
  authenticatedMember?: TeamMember | null;
  activeMember?: TeamMember | null;
  email: string;
  userId: string;
}

export interface AccountIdentityPresentation {
  name: string;
  organizationName: string;
  role: string;
  detail: string;
  usedTechnicalFallback: boolean;
}

export type AccountSyncKind = 'saved' | 'pending' | 'error' | 'idle';

export interface AccountSyncPresentation {
  kind: AccountSyncKind;
  label: string;
  detail: string;
  fullLabel: string;
}

function compactIdentifier(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizedText(value: string | undefined): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isPresentableName(value: string, technicalIdentifiers: string[]): boolean {
  const candidate = normalizedText(value);
  if (!candidate || !/\p{L}/u.test(candidate)) return false;
  const compact = compactIdentifier(candidate);
  if (!compact) return false;
  return !technicalIdentifiers.some((identifier) => compactIdentifier(identifier) === compact);
}

function titleWord(value: string): string {
  const lower = value.toLocaleLowerCase('es-AR');
  return lower.replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase('es-AR'));
}

function readableEmailName(email: string, technicalIdentifiers: string[]): string {
  const localPart = normalizedText(email).split('@')[0] || '';
  const words = localPart.split(/[\s._-]+/g).filter(Boolean);
  if (!words.length) return '';
  const candidate = words.map(titleWord).join(' ');
  return isPresentableName(candidate, technicalIdentifiers) ? candidate : '';
}

function organizationDisplayName(settings: Settings, organization: OrganizationSettings): string {
  const organizationName = normalizedText(organization.name);
  const agencyName = normalizedText(settings.agencyName);
  const organizationLooksTechnical = organizationName
    && compactIdentifier(organizationName) === compactIdentifier(organization.id);
  if (organizationLooksTechnical && agencyName) return agencyName;
  return organizationName || agencyName || normalizedText(organization.id) || 'PropControl';
}

export function accountIdentityPresentation(input: AccountIdentityInput): AccountIdentityPresentation {
  const member = input.authenticatedMember || input.activeMember || null;
  const technicalIdentifiers = [
    input.organization.id,
    input.organization.name,
    input.userId,
  ].filter(Boolean);
  const profileName = normalizedText(input.settings.profileName);
  const memberName = normalizedText(member?.name);
  const emailName = readableEmailName(input.email, technicalIdentifiers);
  const technicalFallback = profileName
    || memberName
    || normalizedText(input.email).split('@')[0]
    || normalizedText(input.userId)
    || normalizedText(input.organization.id)
    || 'Cuenta PropControl';
  const name = isPresentableName(profileName, technicalIdentifiers)
    ? profileName
    : isPresentableName(memberName, technicalIdentifiers)
      ? memberName
      : emailName || technicalFallback;
  const organizationName = organizationDisplayName(input.settings, input.organization);
  const role = normalizedText(member?.role);

  return {
    name,
    organizationName,
    role,
    detail: [organizationName, role].filter(Boolean).join(' · '),
    usedTechnicalFallback: name === technicalFallback && !emailName,
  };
}

function sameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formattedMoment(value: string | undefined, now: Date): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const time = new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  if (sameLocalDay(date, now)) return `hoy, ${time}`;
  const day = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
  return `${day}, ${time}`;
}

export function accountSyncPresentation(
  state: SyncState,
  now = new Date(),
): AccountSyncPresentation {
  const existingLabel = syncStatusLabel(state);
  if (state.lastError) {
    return {
      kind: 'error',
      label: existingLabel,
      detail: state.lastError,
      fullLabel: `${existingLabel}. ${state.lastError}`,
    };
  }
  if (state.dirty) {
    const moment = formattedMoment(state.localUpdatedAt, now);
    return {
      kind: 'pending',
      label: existingLabel,
      detail: moment ? `Actualizados ${moment}` : '',
      fullLabel: existingLabel,
    };
  }
  if (state.lastCloudSavedAt) {
    const moment = formattedMoment(state.lastCloudSavedAt, now);
    return {
      kind: 'saved',
      label: 'Nube al día',
      detail: moment ? `Guardada ${moment}` : existingLabel,
      fullLabel: existingLabel,
    };
  }
  return {
    kind: 'idle',
    label: existingLabel,
    detail: '',
    fullLabel: existingLabel,
  };
}
