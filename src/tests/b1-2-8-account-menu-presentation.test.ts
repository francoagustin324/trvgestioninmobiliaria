import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  accountIdentityPresentation,
  accountSyncPresentation,
} from '../account-menu-presentation.js';
import type {
  OrganizationSettings,
  Settings,
  TeamMember,
} from '../models.js';

const organization: OrganizationSettings = {
  id: 'trv-gestion-inmobiliaria',
  name: 'TRV Gestión Inmobiliaria',
  seatLimit: null,
  planLabel: 'Piloto',
};

const settings: Settings = {
  profileName: 'Franco Solís',
  profileEmail: 'franco.solis@example.test',
  profilePhone: '',
  avatar: '',
  agencyName: 'TRV Gestión Inmobiliaria',
  agencyWhatsapp: '',
  agencyLegal: '',
  currency: 'USD',
  defaultZone: '',
  shareText: '',
  overdueDays: 3,
};

const owner: TeamMember = {
  id: 1,
  userId: 'owner-user-id',
  name: 'Franco Solís',
  email: 'franco.solis@example.test',
  role: 'Dueño',
  status: 'Activo',
  createdAt: '2026-07-01T12:00:00.000Z',
};

function identity(overrides: Partial<{
  settings: Settings;
  organization: OrganizationSettings;
  authenticatedMember: TeamMember | null;
  activeMember: TeamMember | null;
  email: string;
  userId: string;
}> = {}) {
  return accountIdentityPresentation({
    settings,
    organization,
    authenticatedMember: owner,
    activeMember: owner,
    email: 'franco.solis@example.test',
    userId: 'owner-user-id',
    ...overrides,
  });
}

function localTime(value: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

test('B1.2.8 prioriza profileName humano y presenta inmobiliaria y rol', () => {
  const presentation = identity();
  assert.equal(presentation.name, 'Franco Solís');
  assert.equal(presentation.organizationName, 'TRV Gestión Inmobiliaria');
  assert.equal(presentation.role, 'Dueño');
  assert.equal(presentation.detail, 'TRV Gestión Inmobiliaria · Dueño');
  assert.equal(presentation.usedTechnicalFallback, false);
});

test('B1.2.8 evita usar trvgestioninmobiliaria como identidad principal cuando existe un miembro humano', () => {
  const presentation = identity({
    settings: { ...settings, profileName: 'trvgestioninmobiliaria' },
  });
  assert.equal(presentation.name, 'Franco Solís');
  assert.notEqual(presentation.name, 'trvgestioninmobiliaria');
});

test('B1.2.8 usa el miembro autenticado antes que el miembro activo de otra vista', () => {
  const authenticatedMember = { ...owner, name: 'María Corredora', role: 'Corredor' as const };
  const activeMember = { ...owner, id: 2, name: 'Administrador Visible', role: 'Administrador' as const };
  const presentation = identity({
    settings: { ...settings, profileName: '' },
    authenticatedMember,
    activeMember,
  });
  assert.equal(presentation.name, 'María Corredora');
  assert.equal(presentation.role, 'Corredor');
});

test('B1.2.8 deriva un nombre legible del email antes de recurrir al identificador técnico', () => {
  const presentation = identity({
    settings: { ...settings, profileName: '' },
    authenticatedMember: null,
    activeMember: null,
    email: 'juan.ignacio-rodriguez@example.test',
    userId: 'technical-user-123',
  });
  assert.equal(presentation.name, 'Juan Ignacio Rodriguez');
  assert.equal(presentation.usedTechnicalFallback, false);
});

test('B1.2.8 usa el identificador técnico únicamente como último recurso', () => {
  const presentation = identity({
    settings: { ...settings, profileName: '' },
    organization: {
      ...organization,
      id: 'trvgestioninmobiliaria',
      name: 'trvgestioninmobiliaria',
    },
    authenticatedMember: null,
    activeMember: null,
    email: '',
    userId: 'technical-user-123',
  });
  assert.equal(presentation.name, 'technical-user-123');
  assert.equal(presentation.usedTechnicalFallback, true);
});

test('B1.2.8 usa agencyName cuando el nombre de organización es un identificador técnico', () => {
  const presentation = identity({
    organization: {
      ...organization,
      id: 'trvgestioninmobiliaria',
      name: 'trvgestioninmobiliaria',
    },
    settings: {
      ...settings,
      agencyName: 'TRV Gestión Inmobiliaria',
    },
  });
  assert.equal(presentation.organizationName, 'TRV Gestión Inmobiliaria');
  assert.equal(presentation.detail, 'TRV Gestión Inmobiliaria · Dueño');
});

test('B1.2.8 presenta nube al día con el timestamp real existente', () => {
  const savedAt = '2026-07-29T14:12:00-03:00';
  const now = new Date('2026-07-29T18:00:00-03:00');
  const presentation = accountSyncPresentation({
    dirty: false,
    lastCloudSavedAt: savedAt,
  }, now);
  assert.equal(presentation.kind, 'saved');
  assert.equal(presentation.label, 'Nube al día');
  assert.equal(presentation.detail, `Guardada hoy, ${localTime(savedAt)}`);
  assert.match(presentation.fullLabel, /^Nube guardada/);
});

test('B1.2.8 conserva cambios pendientes y su timestamp sin sincronizar automáticamente', () => {
  const updatedAt = '2026-07-29T16:40:00-03:00';
  const now = new Date('2026-07-29T18:00:00-03:00');
  const presentation = accountSyncPresentation({
    dirty: true,
    localUpdatedAt: updatedAt,
    lastCloudSavedAt: '2026-07-29T14:12:00-03:00',
  }, now);
  assert.equal(presentation.kind, 'pending');
  assert.equal(presentation.label, 'Cambios pendientes');
  assert.equal(presentation.detail, `Actualizados hoy, ${localTime(updatedAt)}`);
});

test('B1.2.8 conserva el error real de sincronización', () => {
  const presentation = accountSyncPresentation({
    dirty: true,
    lastError: 'La nube cambió durante la revisión.',
  });
  assert.equal(presentation.kind, 'error');
  assert.equal(presentation.label, 'Error de sincronización');
  assert.equal(presentation.detail, 'La nube cambió durante la revisión.');
  assert.equal(
    presentation.fullLabel,
    'Error de sincronización. La nube cambió durante la revisión.',
  );
});

test('B1.2.8 conserva el estado pendiente original cuando todavía no existe guardado en nube', () => {
  const presentation = accountSyncPresentation({ dirty: false });
  assert.deepEqual(presentation, {
    kind: 'idle',
    label: 'Sincronización pendiente',
    detail: '',
    fullLabel: 'Sincronización pendiente',
  });
});

test('B1.2.8 invalida assets y define la jerarquía contextual sin alterar handlers técnicos', () => {
  const index = readFileSync('index.html', 'utf8');
  const auth = readFileSync('src/mvp-auth.ts', 'utf8');
  const main = readFileSync('src/mvp-main.ts', 'utf8');
  const settingsUi = readFileSync('src/settings-ui.ts', 'utf8');
  const accountProduct = readFileSync('src/account-menu-product.ts', 'utf8');
  const css = readFileSync('src/mvp.css', 'utf8');
  const cacheHelper = readFileSync('src/server/request-helpers.ts', 'utf8');

  assert.match(index, /\/src\/mvp\.css\?v=20260801-4/);
  assert.doesNotMatch(index, /\/src\/mvp\.css\?v=20260717-41/);
  assert.match(index, /\/dist\/mvp-main\.js\?v=20260801-4/);
  assert.doesNotMatch(index, /\/dist\/mvp-main\.js\?v=20260723-104/);
  assert.match(cacheHelper, /max-age=31536000, immutable/);

  assert.match(auth, /sync\.kind === 'saved'/);
  assert.match(auth, /aria-label="Sincronizar de forma segura"/);
  assert.match(auth, /data-settings-recovery-action/);
  assert.match(auth, /aria-label="Recuperar copia anterior"/);
  assert.match(auth, /Se recuperará la copia local anterior y quedará pendiente de sincronización/);
  assert.match(auth, /let accountMenuEventsBound = false/);
  assert.match(main, /data-account-settings/);
  assert.match(settingsUi, /Seguridad y recuperación/);
  assert.match(accountProduct, /solo si faltan datos o soporte lo recomienda/i);
  assert.match(settingsUi, /Nunca se ejecuta automáticamente/);
  assert.match(css, /min-height:48px/);
  assert.match(css, /width:calc\(100vw - 24px\)/);
});
