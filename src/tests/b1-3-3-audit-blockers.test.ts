import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isHumanIdentityName, resolveHumanIdentity } from '../human-identity.js';
import { followUpDateForChoice, followUpPreview } from '../whatsapp-followup-selection.js';

const organizationName = 'TRV Gestión Inmobiliaria';
const organizationId = 'trvgestioninmobiliaria';

const blockedNames = [
  'PropControl',
  'Info',
  'Contacto',
  'Noreply',
  'Marketing',
  'Comercial',
  'TRV Gestión',
  'TRV Gestión Inmobiliaria',
  'trv-gestion',
  'trvgestioninmobiliaria',
  '',
  '   ',
  'usuario123',
  '18f8a728-0ef4-4b84-9a76-34a843de6cd7',
];

const blockedEmails = [
  'propcontrol@dominio.com',
  'info@dominio.com',
  'contacto@dominio.com',
  'noreply@dominio.com',
  'marketing@dominio.com',
  'comercial@dominio.com',
];

test('B1.3.3 auditoría bloquea nombres técnicos, empresariales y departamentales', () => {
  for (const value of blockedNames) {
    assert.equal(
      isHumanIdentityName(value, organizationName, organizationId),
      false,
      `La identidad debía bloquearse: ${JSON.stringify(value)}`,
    );
  }
});

test('B1.3.3 auditoría nunca deriva una firma de WhatsApp desde el correo', () => {
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

test('B1.3.3 auditoría mantiene compatibilidad de presentación fuera de WhatsApp', () => {
  const result = resolveHumanIdentity({
    member: { name: 'usuario', email: 'franco.solis@dominio.com' },
    profileName: '',
  });
  assert.equal(result.valid, true);
  assert.equal(result.source, 'email');
  assert.equal(result.fullName, 'Franco Solis');
});

test('B1.3.3 auditoría utiliza el nombre humano explícito de Franco', () => {
  const result = resolveHumanIdentity({
    member: { name: 'trvgestioninmobiliaria', email: 'propcontrol@dominio.com' },
    profileName: 'Franco Agustín',
    profileEmail: 'info@dominio.com',
    organizationName,
    organizationId,
    allowEmailFallback: false,
  });
  assert.equal(result.valid, true);
  assert.equal(result.source, 'profile');
  assert.equal(result.firstName, 'Franco');
  assert.equal(result.fullName, 'Franco Agustín');
});

test('B1.3.3 auditoría conserva nombres humanos explícitos de otros corredores', () => {
  for (const name of ['Carla Pereyra', 'Ana Gómez', 'Martín López']) {
    const result = resolveHumanIdentity({
      member: { name, email: 'cuenta@dominio.com' },
      profileName: '',
      organizationName,
      organizationId,
      allowEmailFallback: false,
    });
    assert.equal(result.valid, true, name);
    assert.equal(result.source, 'member');
    assert.equal(result.fullName, name);
  }
});

test('B1.3.3 auditoría aplica fail-closed cuando falta nombre humano explícito', () => {
  const result = resolveHumanIdentity({
    member: { name: 'PropControl', email: 'franco.agustin@dominio.com' },
    profileName: 'Marketing',
    profileEmail: 'franco.agustin@dominio.com',
    organizationName,
    organizationId,
    allowEmailFallback: false,
  });
  assert.equal(result.valid, false);
  assert.equal(result.source, 'none');
  assert.match(result.reason, /nombre real de una persona/i);
  assert.match(result.reason, /no se usan correos/i);
});

test('B1.3.3 auditoría calcula todos los presets con fecha local estable', () => {
  const beforeMidnight = new Date(2026, 7, 2, 23, 59, 30);
  assert.equal(followUpDateForChoice('1', '', beforeMidnight), '2026-08-03');
  assert.equal(followUpDateForChoice('3', '', beforeMidnight), '2026-08-05');
  assert.equal(followUpDateForChoice('7', '', beforeMidnight), '2026-08-09');
  assert.equal(followUpDateForChoice('14', '', beforeMidnight), '2026-08-16');
  assert.equal(followUpDateForChoice('30', '', beforeMidnight), '2026-09-01');
  assert.equal(followUpDateForChoice('custom', '2026-08-21', beforeMidnight), '2026-08-21');
  assert.equal(followUpDateForChoice('none', '2026-08-21', beforeMidnight), '');
});

test('B1.3.3 auditoría demuestra por qué no debe recalcularse al cruzar medianoche', () => {
  const beforeMidnight = new Date(2026, 7, 2, 23, 59, 30);
  const afterMidnight = new Date(2026, 7, 3, 0, 0, 30);
  const selectedBefore = followUpDateForChoice('7', '', beforeMidnight);
  const recalculatedAfter = followUpDateForChoice('7', '', afterMidnight);
  assert.equal(selectedBefore, '2026-08-09');
  assert.equal(recalculatedAfter, '2026-08-10');
  assert.notEqual(selectedBefore, recalculatedAfter);
  assert.match(followUpPreview(selectedBefore), /09 de agosto de 2026/i);
});

test('B1.3.3 auditoría guarda selected-date sin volver a derivar presets', () => {
  const source = readFileSync('src/whatsapp-contact-ui.ts', 'utf8');
  const start = source.indexOf('function saveFollowUp');
  const end = source.indexOf('function statusPresentation');
  assert.ok(start >= 0 && end > start);
  const saveFunction = source.slice(start, end);
  assert.doesNotMatch(saveFunction, /updateFollowUpSelection\s*\(/);
  assert.match(saveFunction, /data\.get\('selected-date'\)/);
  assert.match(saveFunction, /scheduleWhatsAppFollowUp\(client\.id, attemptId, activityId, date\)/);
});
