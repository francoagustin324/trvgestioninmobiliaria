import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ui = readFileSync('src/agenda-ui.ts', 'utf8');
const css = readFileSync('src/agenda.css', 'utf8');
const html = readFileSync('index.html', 'utf8');
const followupUi = readFileSync('src/followup-completion-ui.ts', 'utf8');

test('el formulario usa leads visibles y toda escritura/Activity queda ligada al tenant autenticado', () => {
  assert.ok(ui.includes('agendaRelatedOptions(visibleClients())'));
  assert.ok(ui.includes("import { addActivityForAuthenticatedTenant, visibleClients, visibleReminders } from './team-access.js'"));
  assert.ok(ui.includes('const renderScope = requireCurrentTenantScope()'));
  assert.ok(ui.includes('const renderLease = captureTenantRuntimeLease(renderScope)'));
  assert.match(ui, /function agendaWriteMember\(scope:\s*TenantScope,\s*runtimeLease:\s*TenantRuntimeLease\)[\s\S]*assertTenantRuntimeLeaseCurrent\(runtimeLease\)[\s\S]*assertTenantCrmScope\(scope,\s*state\.crm\)[\s\S]*authenticatedTenantMember\(scope\)/);
  assert.ok(ui.includes('assignedToId: existing?.assignedToId ?? agendaWriteMember(renderScope, renderLease).id'));
  assert.ok(ui.includes('createdById: existing?.createdById ?? agendaWriteMember(renderScope, renderLease).id'));
  assert.ok(ui.includes('addActivityForAuthenticatedTenant(renderScope, result.activity)'));
  assert.ok(!ui.includes('addActivity(result.activity)'));
  assert.ok(!ui.includes('actorId: state.activeMemberId'));
  assert.ok(!ui.includes('actorId: activeMember().id'));
  assert.ok(!ui.includes('state.crm.properties'));
  assert.ok(ui.includes('filterAgendaRelatedOptions(options, input.value)'));
  assert.ok(ui.includes('<label for="agenda-related-input">Lead</label>'));
  assert.ok(ui.includes('role="combobox"'));
  assert.ok(ui.includes('role="listbox"'));
  assert.ok(ui.includes('data-related-key'));
  assert.match(followupUi, /data-followup-scheduled-form/);
  assert.match(followupUi, /data-followup-none/);
  assert.match(followupUi, /type="button" class="quiet-button" data-followup-cancel/);
  assert.doesNotMatch(followupUi, /saveData|addActivityForAuthenticatedTenant|localStorage|queueCloudSave/);
});

test('las tarjetas quedan en una sola secuencia vertical y con acciones secundarias agrupadas', () => {
  assert.match(css, /\.agenda-board\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.ok(ui.includes('agenda-position'));
  assert.ok(ui.includes('<summary>Más acciones</summary>'));
  assert.ok(ui.includes('Ordenados por fecha y prioridad.'));
  assert.match(ui, /buildCommercialAgendaItems/);
  assert.match(ui, /data-agenda-source/);
  assert.match(ui, /data-open-agenda-context/);
  assert.match(ui, /openEntityReadOnly\(\{ entityType: 'lead', entityId: clientId \}\)/);
  assert.match(ui, /item\.source === 'visit' \|\| item\.source === 'offer' \|\| item\.source === 'reservation'/);
  assert.doesNotMatch(ui, /data-complete-agenda="visit"|data-complete-agenda="offer"|data-complete-agenda="reservation"/);
  assert.match(css, /agenda-open-context[^}]*min-height:\s*44px/);
});

test('conserva versiones históricas y publica la entrada principal A2.2', () => {
  const compatibilityVersion = html.match(/cloud-compat-bootstrap\.js\?v=([^"']+)/)?.[1];
  const mainVersion = html.match(/mvp-main\.js\?v=([^"']+)/)?.[1];
  const recoveryVersion = html.match(/sync-recovery-bootstrap\.js\?v=([^"']+)/)?.[1];
  const agendaVersion = html.match(/agenda\.css\?v=([^"']+)/)?.[1];
  assert.equal(compatibilityVersion, '20260802-1');
  assert.equal(mainVersion, '20260922-block4-extension-import-1');
  assert.equal(recoveryVersion, '20260802-1');
  assert.equal(agendaVersion, '20260918-trv-daily-use-1');
});
