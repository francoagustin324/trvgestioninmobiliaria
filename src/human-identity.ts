import type { TeamMember } from './models.js';

export interface HumanIdentityResolution {
  valid: boolean;
  fullName: string;
  firstName: string;
  source: 'member' | 'profile' | 'email' | 'none';
  reason: string;
}

const TECHNICAL_IDENTITIES = new Set([
  'trv',
  'trvgestion',
  'trvgestioninmobiliaria',
  'propcontrol',
  'info',
  'informacion',
  'contacto',
  'noreply',
  'marketing',
  'comercial',
  'usuario',
  'user',
  'admin',
  'administrador',
  'owner',
  'corredor',
  'agente',
  'agent',
  'broker',
  'cuenta',
  'account',
  'inmobiliaria',
  'crm',
  'soporte',
  'support',
  'ventas',
  'sistema',
  'system',
  'gerencia',
  'equipo',
  'atencion',
  'servicio',
  'recepcion',
  'cobranzas',
  'administracion',
  'departamento',
  'area',
]);

const NON_PERSONAL_TOKENS = new Set([
  ...TECHNICAL_IDENTITIES,
  'gestion',
  'clientes',
  'cliente',
  'corporativo',
  'corporativa',
  'oficina',
  'secretaria',
  'operaciones',
]);

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizedTokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

export function normalizeHumanIdentityName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-AR')
    .replace(/(^|[\s'-])\p{L}/gu, (match) => match.toLocaleUpperCase('es-AR'));
}

function isTechnicalIdentity(compact: string): boolean {
  if (TECHNICAL_IDENTITIES.has(compact)) return true;
  return /^(?:usuario|user|admin|administrador|owner|agente|agent|corredor|broker|cuenta|account|crm|soporte|support|sistema|system|propcontrol|info|informacion|contacto|noreply|marketing|comercial|ventas)\d*$/.test(compact);
}

export function isHumanIdentityName(value: string, organizationName = '', organizationId = ''): boolean {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 2 || trimmed.length > 80) return false;
  if (trimmed.includes('@') || /https?:\/\//i.test(trimmed)) return false;
  if (/\d/.test(trimmed) || /^[0-9._-]+$/.test(trimmed)) return false;
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(trimmed)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) return false;
  if (!/\p{L}/u.test(trimmed)) return false;

  const compact = normalized(trimmed);
  const tokens = normalizedTokens(trimmed);
  if (!compact || !tokens.length || tokens.length > 6 || isTechnicalIdentity(compact)) return false;
  if (tokens.some((token) => NON_PERSONAL_TOKENS.has(token) || isTechnicalIdentity(token))) return false;
  if (/^(?:propcontrol|trvgestion|trvgestioninmobiliaria)/.test(compact)) return false;

  const organizationCompact = normalized(organizationName);
  const organizationIdCompact = normalized(organizationId);
  if (compact === organizationCompact || compact === organizationIdCompact) return false;
  if (compact.length >= 3 && organizationCompact && organizationCompact.includes(compact)) return false;
  if (compact.length >= 3 && organizationIdCompact && organizationIdCompact.includes(compact)) return false;
  return true;
}

function fromEmail(email: string, organizationName: string, organizationId: string): string {
  const local = email.trim().toLowerCase().split('@')[0] || '';
  if (!local || /\d/.test(local)) return '';
  const separated = local.replace(/[._-]+/g, ' ').trim();
  const tokens = separated.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.some((token) => isTechnicalIdentity(normalized(token)))) return '';
  if (tokens.length === 1 && tokens[0]!.length > 14) return '';
  const candidate = normalizeHumanIdentityName(tokens.join(' '));
  return isHumanIdentityName(candidate, organizationName, organizationId) ? candidate : '';
}

export function resolveHumanIdentity(input: {
  member?: Pick<TeamMember, 'name' | 'email'> | null;
  profileName?: string;
  profileEmail?: string;
  organizationName?: string;
  organizationId?: string;
  allowEmailFallback?: boolean;
}): HumanIdentityResolution {
  const organizationName = input.organizationName?.trim() || '';
  const organizationId = input.organizationId?.trim() || '';
  const memberName = input.member?.name?.trim() || '';
  const profileName = input.profileName?.trim() || '';

  const candidates: Array<{ value: string; source: 'member' | 'profile' }> = [
    { value: memberName, source: 'member' },
    { value: profileName, source: 'profile' },
  ];
  for (const candidate of candidates) {
    if (!isHumanIdentityName(candidate.value, organizationName, organizationId)) continue;
    const fullName = normalizeHumanIdentityName(candidate.value);
    return {
      valid: true,
      fullName,
      firstName: fullName.split(/\s+/)[0] || fullName,
      source: candidate.source,
      reason: '',
    };
  }

  if (input.allowEmailFallback !== false) {
    const emailName = fromEmail(input.member?.email || '', organizationName, organizationId)
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
  }

  return {
    valid: false,
    fullName: '',
    firstName: '',
    source: 'none',
    reason: 'Nombre para mensajes: configurá “Nombre personal para firmar mensajes” y confirmá que aparecerá ante clientes. No se usan correos, empresas, equipos ni cuentas técnicas.',
  };
}

export function safeOrganizationName(value: string, fallback = 'la inmobiliaria'): string {
  const normalizedValue = value.trim().replace(/\s+/g, ' ');
  return normalizedValue || fallback;
}
