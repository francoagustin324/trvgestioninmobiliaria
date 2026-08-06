import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  addCalendarDays,
  calendarDateInTimeZone,
  formatCalendarDateEsAr,
  isValidCalendarDate,
} from '../followup-calendar.js';
import {
  followUpDateForChoice,
  followUpPreview,
} from '../followup-selection.js';

const fixedNow = new Date('2026-08-05T18:46:00-03:00');

const presets = [
  ['1', '2026-08-06', 'jueves, 6 de agosto de 2026'],
  ['3', '2026-08-08', 'sábado, 8 de agosto de 2026'],
  ['7', '2026-08-12', 'miércoles, 12 de agosto de 2026'],
  ['14', '2026-08-19', 'miércoles, 19 de agosto de 2026'],
  ['30', '2026-09-04', 'viernes, 4 de septiembre de 2026'],
] as const;

test('hotfix calcula los cinco presets desde el calendario de Córdoba', () => {
  assert.equal(calendarDateInTimeZone(fixedNow), '2026-08-05');
  assert.equal(calendarDateInTimeZone(new Date('2026-08-06T02:30:00.000Z')), '2026-08-05');
  for (const [choice, expected] of presets) {
    assert.equal(followUpDateForChoice(choice, '', fixedNow), expected, choice);
  }
  assert.notEqual(followUpDateForChoice('1', '', fixedNow), '2026-08-12');
  assert.equal(followUpDateForChoice('2', '', fixedNow), '');
});

test('hotfix muestra exactamente la fecha que entrega como payload', () => {
  for (const [choice, expected, label] of presets) {
    const payload = followUpDateForChoice(choice, '', fixedNow);
    assert.equal(payload, expected);
    assert.equal(formatCalendarDateEsAr(payload), label);
    assert.equal(followUpPreview(payload), `Se programará para: ${label}`);
  }
});

test('un preset reemplaza la fecha pactada anterior y custom conserva solo una fecha válida', () => {
  const previous = '2026-08-12';
  assert.equal(followUpDateForChoice('custom', previous, fixedNow), previous);
  assert.equal(followUpDateForChoice('1', previous, fixedNow), '2026-08-06');
  assert.equal(followUpDateForChoice('7', previous, fixedNow), '2026-08-12');
  assert.equal(followUpDateForChoice('custom', '2026-02-30', fixedNow), '');
  assert.equal(followUpDateForChoice('none', previous, fixedNow), '');
  assert.equal(followUpPreview(''), 'No se programará un próximo seguimiento.');
});

test('la aritmética calendario no depende de parsear YYYY-MM-DD como UTC', () => {
  assert.equal(addCalendarDays('2026-08-05', 30), '2026-09-04');
  assert.equal(addCalendarDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addCalendarDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addCalendarDays('2026-01-01', -1), '2025-12-31');
  assert.equal(isValidCalendarDate('2026-08-06'), true);
  assert.equal(isValidCalendarDate('2026-13-06'), false);
});

test('el guardado tiene un único handler, bloqueo doble y verificación local sin Reminder paralelo', () => {
  const ui = readFileSync('src/followup-save-ui.ts', 'utf8');
  const persistence = readFileSync('src/followup-persistence.ts', 'utf8');
  assert.ok(ui.includes("document.addEventListener('submit'"));
  assert.ok(ui.includes('event.stopImmediatePropagation()'));
  assert.ok(ui.includes('savingForms.has(form)'));
  assert.ok(ui.includes('persistFollowUpSelection'));
  assert.ok(!ui.includes('window.open('));
  assert.ok(persistence.includes('saveData('));
  assert.ok(persistence.includes('readLocalSnapshot()'));
  assert.ok(persistence.includes('scheduleWhatsAppFollowUp('));
  assert.ok(!persistence.includes('state.crm.reminders'));
});
