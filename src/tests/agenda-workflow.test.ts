import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const agendaUi = readFileSync('src/agenda-ui.ts', 'utf8');
const agendaCss = readFileSync('src/agenda.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

test('Seguimientos permite editar, completar, reprogramar y reabrir', () => {
  assert.ok(agendaUi.includes('data-edit-reminder'));
  assert.ok(agendaUi.includes('data-complete-agenda'));
  assert.ok(agendaUi.includes('data-reprogram-source'));
  assert.ok(agendaUi.includes('data-reopen-reminder'));
  assert.ok(agendaUi.includes("saveAndRender('Seguimiento editado')") || agendaUi.includes("existing ? 'Seguimiento editado'"));
});

test('los seguimientos vencidos muestran antigüedad y los activos se ordenan', () => {
  assert.ok(agendaUi.includes('Vencido hace'));
  assert.ok(agendaUi.includes('seguimientos activos en orden de atención'));
  assert.ok(agendaUi.includes('Ordenados por fecha y prioridad.'));
  assert.ok(agendaUi.includes("renderAgendaSection('overdue'"));
  assert.ok(agendaUi.includes("renderAgendaSection('today'"));
  assert.ok(agendaUi.includes("renderAgendaSection('upcoming'"));
});

test('el diseño contempla computadora y celular', () => {
  assert.ok(agendaCss.includes('.agenda-card-actions'));
  assert.ok(agendaCss.includes('.agenda-reprogram'));
  assert.ok(agendaCss.includes('.agenda-completed'));
  assert.ok(agendaCss.includes('@media (max-width: 720px)'));
});

test('la publicación renueva agenda y los módulos JavaScript coordinados', () => {
  const agendaVersion = html.match(/agenda\.css\?v=([^"']+)/)?.[1];
  const compatibilityVersion = html.match(/cloud-compat-bootstrap\.js\?v=([^"']+)/)?.[1];
  const mainVersion = html.match(/mvp-main\.js\?v=([^"']+)/)?.[1];
  const recoveryVersion = html.match(/sync-recovery-bootstrap\.js\?v=([^"']+)/)?.[1];
  assert.ok(agendaVersion);
  assert.equal(mainVersion, compatibilityVersion);
  assert.equal(recoveryVersion, compatibilityVersion);
  assert.equal(agendaVersion, mainVersion);
});
