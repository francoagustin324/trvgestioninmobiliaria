import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const uxSource = readFileSync('src/leads-zero-training-phase1.ts', 'utf8');
const uxCss = readFileSync('src/leads-zero-training-phase1.css', 'utf8');
const safetySource = readFileSync('src/leads-zero-training-safety.ts', 'utf8');
const whatsappCore = readFileSync('src/whatsapp-contact.ts', 'utf8');
const cloud = readFileSync('src/cloud-api-compatible.ts', 'utf8');

test('FASE 1 usa lenguaje humano y una jerarquía simple en la tarjeta', () => {
  for (const label of ['Busca:', 'Presupuesto:', 'Próximo paso', 'WhatsApp', 'Editar', 'Ver detalles', 'Completar datos con IA', 'Eliminar']) {
    assert.ok(uxSource.includes(label), `Falta texto visible ${label}`);
  }
  assert.doesNotMatch(uxSource, />Calificar automáticamente</);
  assert.doesNotMatch(uxSource, />Ver ficha completa</);
  assert.doesNotMatch(uxSource, />Elimina</);
  assert.match(uxCss, /grid-template-columns:minmax\(0,1\.35fr\) minmax\(0,1fr\) 48px/);
  assert.match(uxCss, /@media\(max-width:370px\)/);
});

test('FASE 1 nunca presenta registrar y abrir WhatsApp como acciones simultáneas', () => {
  assert.match(uxSource, /data-whatsapp-open/);
  assert.doesNotMatch(uxSource, /data-whatsapp-manual-register/);
  assert.doesNotMatch(uxSource, /Ya lo envié, registrar/);
  assert.match(uxSource, /¿Enviaste el mensaje a/);
  assert.match(uxSource, /data-whatsapp-confirm-sent>Sí/);
  assert.match(uxSource, /data-whatsapp-not-yet>Todavía no/);
});

test('FASE 1 conserva la barrera humana: abrir no registra y Sí usa el registrador existente', () => {
  assert.match(uxSource, /registerWhatsAppContact\(attempt\)/);
  assert.match(uxSource, /scheduleWhatsAppFollowUp\(result\.client\.id, attempt, result\.activity\.id, validDate\)/);
  assert.match(uxSource, /suggestedFollowUp\(result\.client, conversationOpen\)/);
  assert.doesNotMatch(uxSource, /window\.open\(/);
  assert.doesNotMatch(uxSource, /reminders\.push|addReminder|createReminder/);
  const registerStart = whatsappCore.indexOf('export function registerWhatsAppContact');
  const scheduleStart = whatsappCore.indexOf('export function scheduleWhatsAppFollowUp');
  assert.ok(registerStart > 0 && scheduleStart > registerStart);
  assert.match(safetySource, /data-whatsapp-context-note/);
  assert.match(safetySource, /contactBlocked/);
});

test('FASE 1 muestra éxito simple sin debilitar el mensaje interno de verificación cloud', () => {
  assert.match(cloud, /Guardado seguro en la nube\./);
  assert.match(uxSource, /detail\.message === 'Guardado seguro en la nube\.'/);
  assert.match(uxSource, /notice\.textContent = '✓ Guardado'/);
  assert.match(uxSource, /detail\.kind === 'error'/);
});

test('etiquetas de próximo contacto son comprensibles sin capacitación', () => {
  assert.match(uxSource, /if \(days === 1\) return 'Mañana'/);
  assert.match(uxSource, /return `En \$\{days\} días`/);
  assert.match(uxSource, /return localDateLabel\(date\)/);
});

test('selector de cambio guarda el estado canónico y submit no recalcula con reloj nuevo', () => {
  const syncStart = uxSource.indexOf('function synchronizeChangeSelection');
  const saveStart = uxSource.indexOf('function saveChangedFollowUp');
  const saveEnd = uxSource.indexOf('function openLeadDetails');
  const synchronize = uxSource.slice(syncStart, saveStart);
  const save = uxSource.slice(saveStart, saveEnd);
  assert.match(synchronize, /followUpDateForChoice\(/);
  assert.match(synchronize, /selected\.value = date/);
  assert.match(save, /input\[name="selected-date"\]/);
  assert.doesNotMatch(save, /followUpDateForChoice\(/);
  assert.doesNotMatch(save, /new Date\(/);
});
