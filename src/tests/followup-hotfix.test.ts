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
  canonicalFollowUpPayload,
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

test('el submit consume la fecha canónica congelada y no recalcula al cambiar el reloj', () => {
  const beforeMidnight = new Date('2026-08-05T23:59:30-03:00');
  const afterMidnight = new Date('2026-08-06T00:01:00-03:00');
  const frozenDate = followUpDateForChoice('1', '', beforeMidnight);
  assert.equal(frozenDate, '2026-08-06');
  assert.equal(followUpDateForChoice('1', '', afterMidnight), '2026-08-07');

  assert.equal(canonicalFollowUpPayload({
    checkedChoice: '1',
    selectedChoice: '1',
    selectedDate: frozenDate,
    hiddenDate: frozenDate,
    previewDate: frozenDate,
    previewText: followUpPreview(frozenDate),
    customDate: '2026-08-19',
  }), '2026-08-06');

  assert.throws(() => canonicalFollowUpPayload({
    checkedChoice: '1',
    selectedChoice: '1',
    selectedDate: frozenDate,
    hiddenDate: '2026-08-07',
    previewDate: frozenDate,
    previewText: followUpPreview(frozenDate),
    customDate: '2026-08-19',
  }), /fecha visible cambió/i);
});

test('el guardado tiene un único handler y verifica/rollbackea sólo el tenant capturado sin Reminder paralelo', () => {
  const ui = readFileSync('src/followup-save-ui.ts', 'utf8');
  const persistence = readFileSync('src/followup-persistence.ts', 'utf8');
  const saveStart = ui.indexOf('function saveFollowUp');
  const saveEnd = ui.indexOf('function install', saveStart);
  const saveBody = ui.slice(saveStart, saveEnd);
  const rollbackStart = persistence.indexOf('function rollback(');
  const rollbackEnd = persistence.indexOf('function verifiedClient', rollbackStart);
  const rollbackBody = persistence.slice(rollbackStart, rollbackEnd);
  const persistStart = persistence.indexOf('export function persistFollowUpSelection');
  const persistBody = persistence.slice(persistStart);

  assert.ok(ui.includes("document.addEventListener('submit'"));
  assert.ok(ui.includes('event.stopImmediatePropagation()'));
  assert.ok(ui.includes('savingForms.has(form)'));
  assert.ok(saveBody.includes('readCanonicalSelection(form)'));
  assert.ok(!saveBody.includes('synchronizeSelection(form)'));
  assert.ok(ui.includes('persistFollowUpSelection'));
  assert.ok(!ui.includes('window.open('));

  assert.ok(persistence.includes('saveData('));
  assert.ok(persistence.includes('scheduleWhatsAppFollowUp('));
  assert.ok(persistence.includes('requireCurrentTenantScope()'));
  assert.ok(persistence.includes('captureTenantRuntimeLease(scope)'));
  assert.ok(persistence.includes('assertTenantRuntimeLeaseCurrent(runtimeLease)'));
  assert.ok(persistence.includes('assertTenantCrmScope(scope, state.crm)'));
  assert.ok(persistence.includes('readTenantSnapshot(scope)'));
  assert.ok(persistence.includes('writeTenantSnapshot(scope, previous'));
  assert.ok(!persistence.includes('readLocalSnapshot'));
  assert.ok(!persistence.includes('writeLocalSnapshot'));

  assert.ok(rollbackBody.includes('scope: TenantScope'));
  assert.ok(rollbackBody.includes('runtimeLease: TenantRuntimeLease'));
  assert.ok(rollbackBody.includes('if (!tenantRuntimeLeaseIsCurrent(runtimeLease)) return;'));
  assert.ok(rollbackBody.includes('assertTenantRuntimeLeaseCurrent(runtimeLease)'));
  assert.ok(rollbackBody.includes('assertTenantCrmScope(scope, previous)'));
  assert.ok(rollbackBody.includes('writeTenantSnapshot(scope, previous'));
  assert.ok(!rollbackBody.includes('requireCurrentTenantScope()'), 'rollback nunca puede retargetearse al tenant visible actual');

  assert.ok(persistBody.includes('const scope = requireCurrentTenantScope();'));
  assert.ok(persistBody.includes('const runtimeLease = captureTenantRuntimeLease(scope);'));
  assert.ok(persistBody.includes('assertTenantRuntimeLeaseCurrent(runtimeLease);'));
  assert.ok(persistBody.includes('rollback(previous, scope, runtimeLease);'));
  assert.ok(!persistence.includes('state.crm.reminders'));
});
