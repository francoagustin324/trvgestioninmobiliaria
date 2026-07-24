import type {
  OrganizationSettings,
  Settings,
  TeamMemberStatus,
  TeamRole,
} from './models.js';

export interface UserProfile {
  userId: string;
  displayName: string;
  phone: string;
  avatarPath: string;
}

export interface AuthIdentity {
  userId: string;
  email: string;
}

export interface OrganizationConfiguration {
  organizationId: string;
  commercialPhone: string;
  commercialEmail: string;
  address: string;
  logoPath: string;
  legalText: string;
  defaultCurrency: string;
  defaultZone: string;
  shareText: string;
}

export interface OrganizationMembership {
  organizationId: string;
  userId: string;
  memberId: number;
  role: TeamRole;
  status: TeamMemberStatus;
  legacyName?: string;
  legacyEmail?: string;
  legacyPhone?: string;
}

// Contrato reservado para preferencias personales futuras. No contiene campos
// hasta que una preferencia tenga comportamiento real dentro de PropControl.
export interface UserPreferences {}

export type ConfigurationOwnership =
  | 'user_profile'
  | 'auth_identity'
  | 'organization'
  | 'membership'
  | 'user_preferences'
  | 'legacy_only';

export type LegacySettingField = keyof Settings;
export type LegacyFieldEffect = 'active_legacy' | 'stored_not_consumed' | 'no_effect';

export interface LegacyFieldClassification {
  field: LegacySettingField;
  ownership: ConfigurationOwnership;
  replacementOwnership?: ConfigurationOwnership;
  effect: LegacyFieldEffect;
  note: string;
}

export type PersonalIdentitySource =
  | 'user_profile'
  | 'membership_legacy'
  | 'settings_legacy'
  | 'auth_identity'
  | 'neutral_fallback';

export interface ResolvedPersonalIdentity {
  userId: string;
  displayName: string;
  email: string;
  phone: string;
  avatarPath: string;
  displayNameSource: PersonalIdentitySource;
  emailSource: PersonalIdentitySource;
  phoneSource: PersonalIdentitySource;
  avatarSource: PersonalIdentitySource;
}

export interface ResolvePersonalIdentityInput {
  authIdentity?: AuthIdentity | null;
  userProfile?: UserProfile | null;
  membership?: OrganizationMembership | null;
  legacySettings?: Pick<Settings, 'profileName' | 'profileEmail' | 'profilePhone' | 'avatar'> | null;
  fallbackDisplayName?: string;
}

export type OrganizationNameSource = 'organization' | 'settings_legacy' | 'neutral_fallback';

export interface ResolvedOrganizationName {
  name: string;
  source: OrganizationNameSource;
}

export interface ResolveOrganizationNameInput {
  organization?: Pick<OrganizationSettings, 'name'> | null;
  legacySettings?: Pick<Settings, 'agencyName'> | null;
  fallbackName?: string;
}

export interface ResolveOrganizationConfigurationInput {
  organizationId: string;
  configuration?: Partial<OrganizationConfiguration> | null;
  legacySettings?: Pick<
    Settings,
    'agencyWhatsapp' | 'agencyLegal' | 'currency' | 'defaultZone' | 'shareText'
  > | null;
  defaults?: Partial<Omit<OrganizationConfiguration, 'organizationId'>> | null;
}

export const legacySettingFields: readonly LegacySettingField[] = [
  'profileName',
  'profileEmail',
  'profilePhone',
  'avatar',
  'agencyName',
  'agencyWhatsapp',
  'agencyLegal',
  'currency',
  'defaultZone',
  'shareText',
  'overdueDays',
];

const legacyFieldClassifications: Readonly<Record<LegacySettingField, LegacyFieldClassification>> = {
  profileName: {
    field: 'profileName',
    ownership: 'user_profile',
    effect: 'active_legacy',
    note: 'Nombre personal legacy usado hoy por el menú de cuenta.',
  },
  profileEmail: {
    field: 'profileEmail',
    ownership: 'legacy_only',
    replacementOwnership: 'auth_identity',
    effect: 'stored_not_consumed',
    note: 'Fallback legacy; nunca reemplaza un email válido de autenticación.',
  },
  profilePhone: {
    field: 'profilePhone',
    ownership: 'user_profile',
    effect: 'stored_not_consumed',
    note: 'Teléfono personal legacy sin consumo funcional confirmado fuera de Configuración.',
  },
  avatar: {
    field: 'avatar',
    ownership: 'user_profile',
    effect: 'active_legacy',
    note: 'Data URI legacy usado hoy por el menú de cuenta; el contrato futuro usa avatarPath.',
  },
  agencyName: {
    field: 'agencyName',
    ownership: 'organization',
    effect: 'stored_not_consumed',
    note: 'Fallback legacy; organization.name conserva prioridad como nombre comercial oficial.',
  },
  agencyWhatsapp: {
    field: 'agencyWhatsapp',
    ownership: 'organization',
    effect: 'stored_not_consumed',
    note: 'Dato comercial legacy guardado pero no conectado todavía a fichas públicas.',
  },
  agencyLegal: {
    field: 'agencyLegal',
    ownership: 'organization',
    effect: 'stored_not_consumed',
    note: 'Texto legal legacy guardado pero no conectado todavía a fichas públicas.',
  },
  currency: {
    field: 'currency',
    ownership: 'organization',
    effect: 'stored_not_consumed',
    note: 'Preferencia comercial legacy sin consumo operativo confirmado.',
  },
  defaultZone: {
    field: 'defaultZone',
    ownership: 'organization',
    effect: 'stored_not_consumed',
    note: 'Zona comercial legacy sin consumo operativo confirmado.',
  },
  shareText: {
    field: 'shareText',
    ownership: 'organization',
    effect: 'stored_not_consumed',
    note: 'Texto sugerido legacy sin conexión actual al flujo de compartir fichas.',
  },
  overdueDays: {
    field: 'overdueDays',
    ownership: 'legacy_only',
    effect: 'no_effect',
    note: 'Campo legacy sin efecto: Agenda considera vencida toda fecha anterior a hoy.',
  },
};

interface TextCandidate {
  value?: string | null;
  source: PersonalIdentitySource;
}

interface SelectedText {
  value: string;
  source: PersonalIdentitySource;
}

function cleanText(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function selectText(candidates: readonly TextCandidate[], fallbackValue = ''): SelectedText {
  for (const candidate of candidates) {
    const value = cleanText(candidate.value);
    if (value) return { value, source: candidate.source };
  }
  return { value: cleanText(fallbackValue), source: 'neutral_fallback' };
}

function emailLocalPart(email: string | null | undefined): string {
  const value = cleanText(email);
  if (!value) return '';
  const localPart = value.split('@')[0];
  return cleanText(localPart);
}

function organizationValue(
  preferred: string | null | undefined,
  legacy: string | null | undefined,
  fallback: string | null | undefined,
  safeDefault = '',
): string {
  return cleanText(preferred)
    || cleanText(legacy)
    || cleanText(fallback)
    || safeDefault;
}

export function classifyLegacySettingField(field: LegacySettingField): LegacyFieldClassification {
  return { ...legacyFieldClassifications[field] };
}

export function listLegacySettingClassifications(): LegacyFieldClassification[] {
  return legacySettingFields.map(classifyLegacySettingField);
}

export function legacySettingFieldEffect(field: LegacySettingField): LegacyFieldEffect {
  return legacyFieldClassifications[field].effect;
}

export function isLegacySettingFieldCurrentlyConsumed(field: LegacySettingField): boolean {
  return legacySettingFieldEffect(field) === 'active_legacy';
}

export function resolvePersonalIdentity(input: ResolvePersonalIdentityInput): ResolvedPersonalIdentity {
  const displayName = selectText([
    { value: input.userProfile?.displayName, source: 'user_profile' },
    { value: input.membership?.legacyName, source: 'membership_legacy' },
    { value: input.legacySettings?.profileName, source: 'settings_legacy' },
    { value: emailLocalPart(input.authIdentity?.email), source: 'auth_identity' },
  ], input.fallbackDisplayName || 'Usuario PropControl');

  const email = selectText([
    { value: input.authIdentity?.email, source: 'auth_identity' },
    { value: input.membership?.legacyEmail, source: 'membership_legacy' },
    { value: input.legacySettings?.profileEmail, source: 'settings_legacy' },
  ]);

  const phone = selectText([
    { value: input.userProfile?.phone, source: 'user_profile' },
    { value: input.membership?.legacyPhone, source: 'membership_legacy' },
    { value: input.legacySettings?.profilePhone, source: 'settings_legacy' },
  ]);

  const avatar = selectText([
    { value: input.userProfile?.avatarPath, source: 'user_profile' },
    { value: input.legacySettings?.avatar, source: 'settings_legacy' },
  ]);

  return {
    userId: cleanText(input.authIdentity?.userId)
      || cleanText(input.userProfile?.userId)
      || cleanText(input.membership?.userId),
    displayName: displayName.value,
    email: email.value,
    phone: phone.value,
    avatarPath: avatar.value,
    displayNameSource: displayName.source,
    emailSource: email.source,
    phoneSource: phone.source,
    avatarSource: avatar.source,
  };
}

export function resolveOrganizationName(input: ResolveOrganizationNameInput): ResolvedOrganizationName {
  const officialName = cleanText(input.organization?.name);
  if (officialName) return { name: officialName, source: 'organization' };

  const legacyName = cleanText(input.legacySettings?.agencyName);
  if (legacyName) return { name: legacyName, source: 'settings_legacy' };

  return {
    name: cleanText(input.fallbackName) || 'Inmobiliaria',
    source: 'neutral_fallback',
  };
}

export function resolveOrganizationConfiguration(
  input: ResolveOrganizationConfigurationInput,
): OrganizationConfiguration {
  return {
    organizationId: cleanText(input.organizationId)
      || cleanText(input.configuration?.organizationId),
    commercialPhone: organizationValue(
      input.configuration?.commercialPhone,
      input.legacySettings?.agencyWhatsapp,
      input.defaults?.commercialPhone,
    ),
    commercialEmail: organizationValue(
      input.configuration?.commercialEmail,
      undefined,
      input.defaults?.commercialEmail,
    ),
    address: organizationValue(
      input.configuration?.address,
      undefined,
      input.defaults?.address,
    ),
    logoPath: organizationValue(
      input.configuration?.logoPath,
      undefined,
      input.defaults?.logoPath,
    ),
    legalText: organizationValue(
      input.configuration?.legalText,
      input.legacySettings?.agencyLegal,
      input.defaults?.legalText,
    ),
    defaultCurrency: organizationValue(
      input.configuration?.defaultCurrency,
      input.legacySettings?.currency,
      input.defaults?.defaultCurrency,
      'USD',
    ),
    defaultZone: organizationValue(
      input.configuration?.defaultZone,
      input.legacySettings?.defaultZone,
      input.defaults?.defaultZone,
    ),
    shareText: organizationValue(
      input.configuration?.shareText,
      input.legacySettings?.shareText,
      input.defaults?.shareText,
    ),
  };
}
