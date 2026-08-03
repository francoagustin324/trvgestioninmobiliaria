import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isHumanIdentityName, resolveHumanIdentity } from '../human-identity.js';
import { followUpDateForChoice, followUpPreview } from '../whatsapp-followup-selection.js';

const organizationName = 'TRV Gestión Inmobiliaria';
const organizationId = 'trvgestioninmobiliaria';

const blockedNames = [
  'PropControl',
  'TRV',
  'TRV Inmobiliaria',
  'TRV Gestión',
  'TRV Gestión Inmobiliaria',
  'Gerencia Comercial',
  'Equipo Ventas',
  'Equipo Comercial',
  'Atención al Cliente',
  'Servicio al Cliente',
  'Recepción',
  'Cobranzas',
  'Ventas Córdoba',
  'Administración',
  'Marketing',
  'Comercial',
  'Contacto',
  'Info',
  'Noreply',
  'Soporte',
  'trv-gestion',
  'trvgestioninmobiliaria',
  '',
  '   ',
  'usuario123',
  '18f8a728-0ef4-4b84-9a76-34a843de6cd7',
  'franco.agustin@dominio.com',
];

const blockedEmails = [
  'propcontrol@dominio.com',
  'info@dominio.com',
  'contacto@dominio.com',
  'noreply@dominio.com',
  'marketing@dominio.com',
  'comercial@dominio.com',
];

test('B1.3.3 bloquea identidades técnicas, empresariales, departamentales y buzones', () => {
  for (const value of blockedNames) {
    assert.equal(
      isHumanIdentityName(value, organizationName, organizationId),
      false,
      `La identidad debía bloquearse: ${JSON.stringify(value)}`,
    );
  }
});

test('B1.3.3 conserva únicamente nombres personales explícitos válidos', () => {
  for (const name of ['Franco', 'Franco Agustín', 'Carla Pereyra', 'Ana Gómez', 'Martín López']) {
    assert.equal(isHumanIdentityName(name, organizationName, organizationId), true, name);
  }
});

test('B1.3.3 nunca deriva una firma estricta desde correo', () => {
  for (const email of [...blockedEmails, 'franco.agustin@dominio.com']) {
    const result = resolveHumanIdentity({
      member: { name: '', email },
      profileName: '',
      profileEmail: email,
      organizationName,
      organizationId,
      allowEmailFallback: false,
    });
    assert.equal(result.valid, false, `El correo no debe producir firma: ${email}`);
    assert.equal(result.source, 'none');
    assert.equal(result.fullName, '');
  }
});

test('B1.3.3 mantiene compatibilidad de presentación fuera de WhatsApp', () => {
  const result = resolveHumanIdentity({
    member: { name: 'usuario', email: 'franco.solis@dominio.com' },
    profileName: '',
  });
  assert.equal(result.valid, true);
  assert.equal(result.source, 'email');
  assert.equal(result.fullName, 'Franco Solis');
});

test('B1.3.3 separa WhatsApp de la resolución histórica permisiva', () => {
  const ui = readFileSync('src/whatsapp-contact-ui.ts', 'utf8');
  const identity = readFileSync('src/whatsapp-human-identity.ts', 'utf8');
  assert.doesNotMatch(ui, /resolveHumanIdentity\s*\(/);
  assert.match(ui, /assertCurrentWhatsAppHumanIdentity\s*\(/);
  assert.match(identity, /confirmed:\s*boolean/);
  assert.match(identity, /confirmedAt/);
  assert.match(identity, /fingerprint/);
  assert.match(identity, /actorKey/);
  assert.match(identity, /memberUserId/);
  assert.match(identity, /Este nombre aparecerá|nombre aparecerá/i);
});

test('B1.3.3 revalida identidad en todas las rutas sensibles del panel', () => {
  const source = readFileSync('src/whatsapp-contact-ui.ts', 'utf8');
  for (const functionName of [
    'copyMessage',
    'attemptFromPanel',
    'openChannel',
    'register',
    'renderConfirmation',
    'maybeConfirmReturn',
    'renderFollowUp',
    'saveFollowUp',
  ]) {
    const start = source.indexOf(`function ${functionName}`);
    assert.ok(start >= 0, functionName);
    const next = source.indexOf('\nfunction ', start + 10);
    const body = source.slice(start, next < 0 ? source.length : next);
    assert.match(
      body,
      /assertPanelIdentity\s*\(|assertCurrentWhatsAppHumanIdentity\s*\(|loadPendingWhatsAppAttemptResult\s*\(/,
      functionName,
    );
  }
});

test('B1.3.3 los intentos guardan snapshot y atribuyen desde él sin memberName', () => {
  const source = readFileSync('src/whatsapp-contact.ts', 'utf8');
  assert.match(source, /identity:\s*WhatsAppHumanIdentitySnapshot/);
  assert.match(source, /assertCurrentWhatsAppHumanIdentity\(attempt\.identity\)/);
  assert.match(source, /Responsable: \$\{attempt\.identity\.fullName\}/);
  assert.match(source, /Fingerprint: \$\{attempt\.identity\.fingerprint\}/);
  assert.doesNotMatch(source, /memberName\s*\(/);
});

test('B1.3.3 calcula todos los presets con fecha local estable', () => {
  const beforeMidnight = new Date(2026, 7, 2, 23, 59, 30);
  assert.equal(followUpDateForChoice('1', '', beforeMidnight), '2026-08-03');
  assert.equal(followUpDateForChoice('3', '', beforeMidnight), '2026-08-05');
  assert.equal(followUpDateForChoice('7', '', beforeMidnight), '2026-08-09');
  assert.equal(followUpDateForChoice('14', '', beforeMidnight), '2026-08-16');
  assert.equal(followUpDateForChoice('30', '', beforeMidnight), '2026-09-01');
  assert.equal(followUpDateForChoice('custom', '2026-08-21', beforeMidnight), '2026-08-21');
  assert.equal(followUpDateForChoice('none', '2026-08-21', beforeMidnight), '');
});

test('B1.3.3 demuestra por qué no debe recalcularse al cruzar medianoche', () => {
  const beforeMidnight = new Date(2026, 7, 2, 23, 59, 30);
  const afterMidnight = new Date(2026, 7, 3, 0, 0, 30);
  const selectedBefore = followUpDateForChoice('7', '', beforeMidnight);
  const recalculatedAfter = followUpDateForChoice('7', '', afterMidnight);
  assert.equal(selectedBefore, '2026-08-09');
  assert.equal(recalculatedAfter, '2026-08-10');
  assert.notEqual(selectedBefore, recalculatedAfter);
  assert.match(followUpPreview(selectedBefore), /09 de agosto de 2026/i);
});

test('B1.3.3 guarda selected-date sin volver a derivar presets', () => {
  const source = readFileSync('src/whatsapp-contact-ui.ts', 'utf8');
  const start = source.indexOf('function saveFollowUp');
  const end = source.indexOf('function statusPresentation');
  assert.ok(start >= 0 && end > start);
  const saveFunction = source.slice(start, end);
  assert.doesNotMatch(saveFunction, /updateFollowUpSelection\s*\(/);
  assert.match(saveFunction, /data\.get\('selected-date'\)/);
  assert.match(saveFunction, /scheduleWhatsAppFollowUp\(client\.id, attempt, activityId, date\)/);
});
