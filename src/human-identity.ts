import type { TeamMember } from './models.js';

export interface HumanIdentityResolution {
  valid: boolean;
  fullName: string;
  firstName: string;
  source: 'member' | 'profile' | 'email' | 'none';
  reason: string;
}

const TECHNICAL_IDENTITIES = new Set([
  'trvgestioninmobiliaria',
  'usuario',
  'user',
  'admin',
  'administrador',
  'owner',
  'corredor',
  'agente',
  'cuenta',
  'account',
  'inmobiliaria',
]);

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function titleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-AR')
    .replace(/(^|[\s'-])\p{L}/gu, (match) => match.toLocaleUpperCase('es-AR'));
}

export function isHumanIdentityName(value: string, organizationName = '', organizationId = ''): boolean {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 2 || trimmed.length > 80) return false;
  if (trimmed.includes('@') || /https?:\/\//i.test(trimmed)) return false;
  if (/^[0-9._-]+$/.test(trimmed)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) return false;
  if (!/\p{L}/u.test(trimmed)) return false;

  const compact = normalized(trimmed);
  if (!compact || TECHNICAL_IDENTITIES.has(compact)) return false;
  if (/^(usuario|user|admin|agente|corredor|cuenta|account)\d+$/.test(compact)) return false;
  if (compact === normalized(organizationName) || compact === normalized(organizationId)) return false;
  return true;
}

function fromEmail(email: string, organizationName: string, organizationId: string): string {
  const local = email.trim().toLowerCase().split('@')[0] || '';
  if (!local) return '';
  const separated = local.replace(/[._-]+/g, ' ').trim();
  const tokens = separated.split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && tokens[0]!.length > 14) return '';
  const candidate = titleCase(tokens.join(' '));
  return isHumanIdentityName(candidate, organizationName, organizationId) ? candidate : '';
}

export function resolveHumanIdentity(input: {
  member?: Pick<TeamMember, 'name' | 'email'> | null;
  profileName?: string;
  profileEmail?: string;
  organizationName?: string;
  organizationId?: string;
}): HumanIdentityResolution {
  const organizationName = input.organizationName?.trim() || '';
  const organizationId = input.organizationId?.trim() || '';
  const memberName = input.member?.name?.trim() || '';
  const profileName = input.profileName?.trim() || '';

  const candidates: Array<{ value: string; source: HumanIdentityResolution['source'] }> = [
    { value: memberName, source: 'member' },
    { value: profileName, source: 'profile' },
  ];
  for (const candidate of candidates) {
    if (!isHumanIdentityName(candidate.value, organizationName, organizationId)) continue;
    const fullName = titleCase(candidate.value);
    return {
      valid: true,
      fullName,
      firstName: fullName.split(/\s+/)[0] || fullName,
      source: candidate.source,
      reason: '',
    };
  }

  const emailName = fromEmail(input.member?.email || input.profileEmail || '', organizationName, organizationId)
    || fromEmail(input.profileEmail || '', organizationName, organizationId);
  if (emailName) {
    return {
      valid: true,
      fullName: emailName,
      firstName: emailName.split(/\s+/)[0] || emailName,
      source: 'email',
      reason: '',
    };
  }

  return {
    valid: false,
    fullName: '',
    firstName: '',
    source: 'none',
    reason: 'Configurá “Nombre para mensajes” con un nombre humano antes de contactar por WhatsApp.',
  };
}

export function safeOrganizationName(value: string, fallback = 'la inmobiliaria'): string {
  const normalizedValue = value.trim().replace(/\s+/g, ' ');
  return normalizedValue || fallback;
}
