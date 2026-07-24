import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  classifyLegacySettingField,
  isLegacySettingFieldCurrentlyConsumed,
  legacySettingFieldEffect,
  legacySettingFields,
  listLegacySettingClassifications,
  resolveOrganizationConfiguration,
  resolveOrganizationName,
  resolvePersonalIdentity,
  type OrganizationConfiguration,
  type OrganizationMembership,
  type UserPreferences,
  type UserProfile,
} from '../configuration-domain.js';
import {
  cloudRecordsToCrm,
  crmToCloudRecords,
  type CloudMembershipContext,
} from '../cloud-records.js';
import {
  initialData,
  type CrmData,
  type Settings,
} from '../models.js';

type ExpectNever<Value extends never> = Value;
type ForbiddenUserProfileFields = ExpectNever<Extract<
  keyof UserProfile,
  'role' | 'status' | 'organizationId' | 'commercialPhone' | 'commercialEmail'
>>;
type ForbiddenOrganizationConfigurationFields = ExpectNever<Extract<
  keyof OrganizationConfiguration,
  'userId' | 'displayName' | 'phone' | 'avatarPath' | 'role' | 'status'
>>;

const noForbiddenProfileFields: ForbiddenUserProfileFields[] = [];
const noForbiddenOrganizationFields: ForbiddenOrganizationConfigurationFields[] = [];

const legacySettings: Settings = {
  profileName: 'Perfil legacy',
  profileEmail: 'legacy@example.com',
  profilePhone: '3510000000',
  avatar: 'data:image/jpeg;base64,legacy',
  agencyName: 'Inmobiliaria legacy',
  agencyWhatsapp: '3511111111',
  agencyLegal: 'Texto legal legacy',
  currency: 'ARS',
  defaultZone: 'General Paz',
  shareText: 'Mensaje legacy',
  overdueDays: 3,
};

const membership: OrganizationMembership = {
  organizationId: 'organization-1',
  userId: 'user-1',
  memberId: 7,
  role: 'Administrador',
  status: 'Activo',
  legacyName: 'Nombre de membresía',
  legacyEmail: 'membership@example.com',
  legacyPhone: '3512222222',
};

const userProfile: UserProfile = {
  userId: 'user-1',
  displayName: 'Nombre de perfil',
  phone: '3513333333',
  avatarPath: 'user-1/avatar.jpg',
};

function cloudContext(): CloudMembershipContext {
  return {
    organizationId: '11111111-1111-4111-8111-111111111111',
    currentMemberId: 1,
    currentRole: 'Dueño',
    members: [{
      id: 1,
      userId: 'user-1',
      name: 'Franco Solís',
      email: 'franco@example.com',
      phone: '3515110069',
      role: 'Dueño',
      status: 'Activo',
      createdAt: '2026-07-13T00:00:00.000Z',
    }],
  };
}

function payloadId(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object' || !('id' in payload)) return null;
  const value = Number(payload.id);
  return Number.isFinite(value) ? value : null;
}

test('clasifica cada campo legacy en el ámbito acordado', () => {
  const expected = {
    profileName: 'user_profile',
    profileEmail: 'legacy_only',
    profilePhone: 'user_profile',
    avatar: 'user_profile',
    agencyName: 'organization',
    agencyWhatsapp: 'organization',
    agencyLegal: 'organization',
    currency: 'organization',
    defaultZone: 'organization',
    shareText: 'organization',
    overdueDays: 'legacy_only',
  };
  assert.deepEqual(
    Object.fromEntries(legacySettingFields.map((field) => [field, classifyLegacySettingField(field).ownership])),
    expected,
  );
});

test('userProfile.displayName tiene prioridad sobre membresía y settings legacy', () => {
  const resolved = resolvePersonalIdentity({
    authIdentity: { userId: 'user-1', email: 'auth@example.com' },
    userProfile,
    membership,
    legacySettings,
  });
  assert.equal(resolved.displayName, 'Nombre de perfil');
  assert.equal(resolved.displayNameSource, 'user_profile');
});

test('la membresía legacy tiene prioridad sobre profileName sin UserProfile', () => {
  const resolved = resolvePersonalIdentity({
    authIdentity: { userId: 'user-1', email: 'auth@example.com' },
    membership,
    legacySettings,
  });
  assert.equal(resolved.displayName, 'Nombre de membresía');
  assert.equal(resolved.displayNameSource, 'membership_legacy');
});

test('el email de autenticación tiene prioridad absoluta sobre profileEmail', () => {
  const resolved = resolvePersonalIdentity({
    authIdentity: { userId: 'user-1', email: 'auth@example.com' },
    membership,
    legacySettings,
  });
  assert.equal(resolved.email, 'auth@example.com');
  assert.equal(resolved.emailSource, 'auth_identity');
});

test('profileEmail funciona únicamente como último fallback legacy', () => {
  const resolved = resolvePersonalIdentity({
    authIdentity: { userId: 'user-1', email: '   ' },
    membership: { ...membership, legacyEmail: '   ' },
    legacySettings,
  });
  assert.equal(resolved.email, 'legacy@example.com');
  assert.equal(resolved.emailSource, 'settings_legacy');
  assert.equal(classifyLegacySettingField('profileEmail').replacementOwnership, 'auth_identity');
});

test('organization.name tiene prioridad sobre agencyName', () => {
  const resolved = resolveOrganizationName({
    organization: { name: 'Nombre oficial' },
    legacySettings,
  });
  assert.deepEqual(resolved, { name: 'Nombre oficial', source: 'organization' });
});

test('agencyName funciona como fallback legacy', () => {
  const resolved = resolveOrganizationName({
    organization: { name: '   ' },
    legacySettings,
  });
  assert.deepEqual(resolved, { name: 'Inmobiliaria legacy', source: 'settings_legacy' });
});

test('overdueDays queda marcado como legacy sin efecto actual', () => {
  assert.equal(classifyLegacySettingField('overdueDays').ownership, 'legacy_only');
  assert.equal(legacySettingFieldEffect('overdueDays'), 'no_effect');
  assert.equal(isLegacySettingFieldCurrentlyConsumed('overdueDays'), false);
});

test('las resoluciones no mutan los objetos recibidos', () => {
  const profileBefore = structuredClone(userProfile);
  const membershipBefore = structuredClone(membership);
  const settingsBefore = structuredClone(legacySettings);
  resolvePersonalIdentity({
    authIdentity: { userId: 'user-1', email: 'auth@example.com' },
    userProfile,
    membership,
    legacySettings,
  });
  resolveOrganizationConfiguration({
    organizationId: 'organization-1',
    legacySettings,
  });
  assert.deepEqual(userProfile, profileBefore);
  assert.deepEqual(membership, membershipBefore);
  assert.deepEqual(legacySettings, settingsBefore);
});

test('las funciones puras son determinísticas', () => {
  const input = {
    authIdentity: { userId: 'user-1', email: 'auth@example.com' },
    userProfile,
    membership,
    legacySettings,
  };
  assert.deepEqual(resolvePersonalIdentity(input), resolvePersonalIdentity(input));
  assert.deepEqual(
    resolveOrganizationConfiguration({ organizationId: 'organization-1', legacySettings }),
    resolveOrganizationConfiguration({ organizationId: 'organization-1', legacySettings }),
  );
  assert.deepEqual(listLegacySettingClassifications(), listLegacySettingClassifications());
});

test('los valores vacíos o con espacios no desplazan una fuente válida', () => {
  const resolved = resolvePersonalIdentity({
    authIdentity: { userId: 'user-1', email: 'auth@example.com' },
    userProfile: { ...userProfile, displayName: '   ', phone: '   ', avatarPath: '   ' },
    membership,
    legacySettings,
  });
  assert.equal(resolved.displayName, 'Nombre de membresía');
  assert.equal(resolved.phone, '3512222222');
  assert.equal(resolved.avatarPath, 'data:image/jpeg;base64,legacy');
});

test('UserProfile no admite rol, estado, organización ni datos comerciales', () => {
  assert.deepEqual(noForbiddenProfileFields, []);
  assert.deepEqual(Object.keys(userProfile).sort(), ['avatarPath', 'displayName', 'phone', 'userId']);
});

test('OrganizationConfiguration no admite identidad personal ni permisos', () => {
  const configuration = resolveOrganizationConfiguration({ organizationId: 'organization-1' });
  assert.deepEqual(noForbiddenOrganizationFields, []);
  assert.deepEqual(Object.keys(configuration).sort(), [
    'address',
    'commercialEmail',
    'commercialPhone',
    'defaultCurrency',
    'defaultZone',
    'legalText',
    'logoPath',
    'organizationId',
    'shareText',
  ]);
});

test('CrmData actual conserva exactamente su forma superior y settings legacy', () => {
  const crm: CrmData = structuredClone(initialData);
  assert.deepEqual(Object.keys(crm).sort(), [
    'activityLog',
    'clients',
    'contacts',
    'conversations',
    'fichas',
    'organization',
    'properties',
    'reminders',
    'settings',
    'teamMembers',
  ]);
  assert.deepEqual(Object.keys(crm.settings).sort(), [...legacySettingFields].sort());
});

test('crmToCloudRecords conserva exactamente el resumen de serialización actual', () => {
  const context = cloudContext();
  const crm = structuredClone(initialData);
  crm.organization.id = context.organizationId;
  crm.teamMembers = structuredClone(context.members);
  const records = crmToCloudRecords(crm, context, 'user-1');
  assert.deepEqual(records.map((record) => ({
    type: record.entity_type,
    key: record.entity_key,
    assignee: record.assigned_member_id,
    payloadId: payloadId(record.payload),
    createdBy: record.created_by,
  })), [
    { type: 'organization', key: `${context.organizationId}:settings`, assignee: null, payloadId: null, createdBy: 'user-1' },
    { type: 'client', key: `${context.organizationId}:1`, assignee: 1, payloadId: 1, createdBy: 'user-1' },
    { type: 'property', key: `${context.organizationId}:1`, assignee: 1, payloadId: 1, createdBy: 'user-1' },
    { type: 'commercial_contact', key: `${context.organizationId}:1`, assignee: 1, payloadId: 1, createdBy: 'user-1' },
    { type: 'reminder', key: `${context.organizationId}:1`, assignee: 1, payloadId: 1, createdBy: 'user-1' },
    { type: 'conversation', key: `${context.organizationId}:1`, assignee: 1, payloadId: 1, createdBy: 'user-1' },
  ]);
  assert.equal(records.some((record) => record.payload === crm.settings), false);
});

test('cloudRecordsToCrm conserva settings desde el fallback actual', () => {
  const context = cloudContext();
  const cloudCrm = structuredClone(initialData);
  cloudCrm.organization.id = context.organizationId;
  cloudCrm.teamMembers = structuredClone(context.members);
  cloudCrm.settings.profileName = 'No debe viajar en registros modernos';
  const fallback = structuredClone(initialData);
  fallback.settings.profileName = 'Settings locales actuales';
  const result = cloudRecordsToCrm(crmToCloudRecords(cloudCrm, context, 'user-1'), context, fallback);
  assert.equal(result.settings.profileName, 'Settings locales actuales');
  assert.deepEqual(result.settings, fallback.settings);
});

test('la configuración organizacional nueva tiene prioridad sobre legacy y defaults', () => {
  const result = resolveOrganizationConfiguration({
    organizationId: 'organization-1',
    configuration: {
      organizationId: 'organization-1',
      commercialPhone: '3519999999',
      legalText: 'Texto nuevo',
      defaultCurrency: 'EUR',
      defaultZone: 'Nueva Córdoba',
      shareText: 'Mensaje nuevo',
    },
    legacySettings,
    defaults: {
      commercialPhone: '3510000000',
      legalText: 'Texto default',
      defaultCurrency: 'USD',
      defaultZone: 'Centro',
      shareText: 'Mensaje default',
    },
  });
  assert.equal(result.commercialPhone, '3519999999');
  assert.equal(result.legalText, 'Texto nuevo');
  assert.equal(result.defaultCurrency, 'EUR');
  assert.equal(result.defaultZone, 'Nueva Córdoba');
  assert.equal(result.shareText, 'Mensaje nuevo');
});

test('la configuración organizacional usa legacy antes de defaults seguros', () => {
  const result = resolveOrganizationConfiguration({
    organizationId: 'organization-1',
    configuration: { commercialPhone: '   ', defaultCurrency: '   ' },
    legacySettings,
    defaults: { commercialPhone: '3510000000', defaultCurrency: 'USD' },
  });
  assert.equal(result.commercialPhone, '3511111111');
  assert.equal(result.legalText, 'Texto legal legacy');
  assert.equal(result.defaultCurrency, 'ARS');
  assert.equal(result.defaultZone, 'General Paz');
  assert.equal(result.shareText, 'Mensaje legacy');
});

test('UserPreferences permanece vacío y no inventa funcionalidad personal', () => {
  const preferences: UserPreferences = {};
  assert.deepEqual(Object.keys(preferences), []);
});

test('el módulo de dominio no depende de red, DOM, LocalStorage ni Supabase', () => {
  const source = readFileSync('src/configuration-domain.ts', 'utf8');
  for (const forbidden of ['fetch(', 'document.', 'window.', 'localStorage', 'sessionStorage', 'supabase']) {
    assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

test('package.json conserva exactamente las dependencias actuales sin React ni Tailwind', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  assert.deepEqual(dependencies, {
    playwright: '1.61.0',
    '@types/node': '^22.15.0',
    typescript: '5.8.3',
  });
  assert.equal('react' in dependencies, false);
  assert.equal('tailwindcss' in dependencies, false);
});
