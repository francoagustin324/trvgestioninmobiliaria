import assert from 'node:assert/strict';
import test from 'node:test';
import { isStrictLocalDate, resolveLeadSchedule } from '../lead-create-schedule.js';

test('B1.3.1 acepta únicamente fechas locales reales', () => {
  assert.equal(isStrictLocalDate('2026-08-01'), true);
  assert.equal(isStrictLocalDate('2026-02-29'), false);
  assert.equal(isStrictLocalDate('2024-02-29'), true);
  assert.equal(isStrictLocalDate('2026-13-01'), false);
  assert.equal(isStrictLocalDate('2026-08-32'), false);
  assert.equal(isStrictLocalDate('01/08/2026'), false);
});

test('B1.3.1 conserva exactamente la acción y fecha manuales', () => {
  assert.deepEqual(resolveLeadSchedule({
    nextAction: 'Confirmar visita',
    nextFollowUp: '2026-08-01',
    phone: '03515110069',
    today: '2026-08-01',
  }), {
    nextAction: 'Confirmar visita',
    nextFollowUp: '2026-08-01',
    actionSuggested: false,
    dateSuggested: false,
  });
});

test('Bloque 2A no inventa seguimiento cuando acción y fecha faltan', () => {
  assert.deepEqual(resolveLeadSchedule({
    phone: '03515110069',
    today: '2026-08-01',
  }), {
    nextAction: '',
    nextFollowUp: '',
    actionSuggested: false,
    dateSuggested: false,
  });
});

test('Bloque 2A exige acción y fecha juntas si el usuario inicia un seguimiento', () => {
  const result = resolveLeadSchedule({
    nextAction: 'Enviar opciones',
    phone: '03515110069',
    today: '2026-08-01',
  });
  assert.equal(result.nextAction, 'Enviar opciones');
  assert.equal(result.nextFollowUp, '');
  assert.equal(result.error, 'Completá la próxima acción y su fecha, o dejá ambos campos vacíos.');
  assert.equal(result.actionSuggested, false);
  assert.equal(result.dateSuggested, false);
});

test('Bloque 2A no inventa acción aunque exista teléfono si sólo se cargó una fecha', () => {
  const result = resolveLeadSchedule({
    nextFollowUp: '2026-08-04',
    phone: '+54 9 351 511-0069',
    today: '2026-08-01',
  });
  assert.equal(result.nextAction, '');
  assert.equal(result.nextFollowUp, '2026-08-04');
  assert.equal(result.error, 'Completá la próxima acción y su fecha, o dejá ambos campos vacíos.');
  assert.equal(result.actionSuggested, false);
  assert.equal(result.dateSuggested, false);
});

test('B1.3.1 rechaza fechas pasadas o inválidas sin reemplazarlas', () => {
  const past = resolveLeadSchedule({
    nextAction: 'Confirmar visita',
    nextFollowUp: '2026-07-31',
    phone: '03515110069',
    today: '2026-08-01',
  });
  assert.equal(past.error, 'La fecha de seguimiento no puede estar en el pasado.');
  assert.equal(past.nextFollowUp, '2026-07-31');

  const invalid = resolveLeadSchedule({
    nextAction: 'Confirmar visita',
    nextFollowUp: '2026-02-30',
    phone: '03515110069',
    today: '2026-08-01',
  });
  assert.equal(invalid.error, 'Ingresá una fecha de seguimiento válida.');
  assert.equal(invalid.nextFollowUp, '2026-02-30');
});

test('B1.3.1 conserva una fecha manual como cadena local sin conversión UTC', () => {
  const localToday = '2026-08-01';
  const result = resolveLeadSchedule({
    nextAction: 'Llamar',
    nextFollowUp: localToday,
    phone: '03515110069',
    today: localToday,
  });
  assert.equal(result.nextFollowUp, localToday);
  assert.equal(result.nextFollowUp.includes('T'), false);
  assert.equal(result.nextFollowUp.endsWith('Z'), false);
});
