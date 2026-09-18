import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('index.html', 'utf8');
const ui = readFileSync('src/agenda-ui.ts', 'utf8');
const agendaLogic = readFileSync('src/agenda.ts', 'utf8');
const css = readFileSync('src/mobile-agenda-polish.css', 'utf8');
const shellCss = readFileSync('src/mobile-bottom-nav.css', 'utf8');
const packageJsonText = readFileSync('package.json', 'utf8');
const packageJson = packageJsonText.toLowerCase();

test('carga el pulido móvil de Agenda después de las capas existentes', () => {
  assert.ok(html.includes('/src/mobile-agenda-polish.css?v=20260723-1'));
  assert.ok(html.indexOf('mobile-agenda-polish.css') > html.indexOf('agenda.css'));
  assert.ok(html.indexOf('mobile-agenda-polish.css') > html.indexOf('mobile-bottom-nav.css'));
  assert.ok(html.indexOf('mobile-agenda-polish.css') > html.indexOf('mobile-conversations-polish.css'));
});

test('conserva título, introducción y acción Nuevo seguimiento', () => {
  assert.ok(ui.includes('<h2>Seguimientos</h2>'));
  assert.ok(ui.includes('Resolvé primero los vencidos'));
  assert.ok(ui.includes('data-toggle="reminder-form">Nuevo seguimiento</button>'));
  assert.ok(css.includes('#agenda .panel-heading'));
  assert.ok(css.includes('min-height: 46px'));
});

test('conserva los cuatro indicadores y sus cantidades calculadas', () => {
  assert.ok(ui.includes('<span>Vencidos</span><strong>${groups.overdue.length}</strong>'));
  assert.ok(ui.includes('<span>Para hoy</span><strong>${groups.today.length}</strong>'));
  assert.ok(ui.includes('<span>Próximos</span><strong>${groups.upcoming.length}</strong>'));
  assert.ok(ui.includes('<span>Completados</span><strong>${completed.length}</strong>'));
  assert.ok(css.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'));
  assert.ok(css.includes('min-height: 76px'));
});

test('conserva secciones, orden actual, encabezados y cantidades', () => {
  assert.ok(ui.includes("renderAgendaSection('overdue', groups.overdue, today)"));
  assert.ok(ui.includes("renderAgendaSection('today', groups.today, today)"));
  assert.ok(ui.includes("renderAgendaSection('upcoming', groups.upcoming, today)"));
  assert.ok(ui.includes("overdue: { eyebrow: 'Acción inmediata', title: 'Vencidos'"));
  assert.ok(ui.includes("today: { eyebrow: 'Prioridad del día', title: 'Para hoy'"));
  assert.ok(ui.includes("upcoming: { eyebrow: 'Próximas acciones', title: 'Próximos'"));
  assert.ok(ui.includes('<strong>${items.length}</strong>'));
});

test('conserva prioridad, tipo, fecha, atraso y datos visibles de cada tarjeta', () => {
  assert.ok(ui.includes('class="agenda-position"'));
  assert.ok(ui.includes('class="agenda-source"'));
  assert.ok(ui.includes('datetime="${item.date}${item.time ? `T${item.time}` : \'\'}"'));
  assert.ok(ui.includes("${item.time ? ` · ${escapeHtml(item.time)} hs` : ''}</time>"));
  assert.ok(ui.includes('class="agenda-relative-date"'));
  assert.ok(ui.includes('Vencido hace ${Math.abs(days)}'));
  assert.ok(ui.includes('<h3>${escapeHtml(item.title)}</h3>'));
  assert.ok(ui.includes('<p>${escapeHtml(item.detail)}</p>'));
  assert.ok(ui.includes('<small>${escapeHtml(item.secondary)}</small>'));
  assert.ok(css.includes('overflow-wrap: anywhere'));
  assert.ok(css.includes('word-break: break-word'));
});

test('conserva Completar, Más acciones, apertura, edición y reprogramación', () => {
  assert.ok(ui.includes('data-complete-agenda="${item.source}"'));
  assert.ok(ui.includes('<summary>Más acciones</summary>'));
  assert.ok(ui.includes('data-open-agenda-context="${clientId}"'));
  assert.ok(ui.includes("if (item.source === 'visit' || item.source === 'offer' || item.source === 'reservation')"));
  assert.ok(ui.includes('return contextAction(item);'));
  assert.ok(ui.includes('data-edit-reminder="${item.sourceId}"'));
  assert.ok(ui.includes('data-delete="reminders"'));
  assert.ok(ui.includes('data-reprogram-source="${item.source}"'));
  assert.ok(ui.includes('<button type="submit">Guardar fecha</button>'));
  assert.ok(css.includes('min-height: 44px'));
});

test('mantiene cálculos, filtros visibles y orden de Agenda', () => {
  assert.ok(ui.includes('const clients = visibleClients()'));
  assert.ok(ui.includes('const reminders = visibleReminders()'));
  assert.ok(ui.includes('groupAgendaItems(buildCommercialAgendaItems({'));
  assert.ok(ui.includes('visits: state.crm.visits'));
  assert.ok(ui.includes('offers: state.crm.offers'));
  assert.ok(ui.includes('reservations: state.crm.reservations'));
  assert.ok(ui.includes('properties: visibleProperties()'));
  assert.ok(ui.includes('actor'));
  assert.ok(ui.includes('completedReminders(reminders)'));
  assert.ok(ui.includes('groups.overdue.length + groups.today.length + groups.upcoming.length'));
  assert.ok(ui.includes('daysBetweenIsoDates(today, item.date)'));
  assert.ok(agendaLogic.includes('export function buildAgendaItems'));
  assert.ok(agendaLogic.includes('export function groupAgendaItems'));
  assert.equal(css.includes('#crm'), false);
  assert.equal(css.includes('#propiedades'), false);
  assert.equal(css.includes('#whatsapp'), false);
});

test('completar y reprogramar usan las reglas comerciales tenant-aware sin duplicar Reminder', () => {
  assert.ok(ui.includes("querySelectorAll<HTMLButtonElement>('[data-complete-agenda]')"));
  assert.ok(ui.includes('requestFollowUpCompletion(client, (decision) =>'));
  assert.ok(ui.includes('completeClientFollowUpWithDecision(client, decision)'));
  assert.ok(ui.includes('addActivityForAuthenticatedTenant(renderScope, result.activity)'));
  assert.ok(ui.includes('reminder.completedAt = new Date().toISOString()'));
  assert.ok(ui.includes("querySelectorAll<HTMLFormElement>('[data-reprogram-source]')"));
  assert.ok(ui.includes('reprogramClientFollowUp(client, date)'));
  assert.ok(ui.includes('reminder.date = date'));
  assert.ok(ui.includes("saveAndRender('Seguimiento reprogramado', renderScope, renderLease)"));
  assert.ok(ui.includes('authenticatedTenantMember(scope)'));
  assert.ok(ui.includes('assertTenantCrmScope(scope, state.crm)'));
  assert.equal(ui.includes('state.crm.reminders.push'), true);
});

test('respeta navegación, safe area, escritorio y stack técnico', () => {
  assert.ok(css.includes('@media (max-width: 720px)'));
  assert.equal(css.includes('@media (min-width: 721px)'), false);
  assert.ok(css.includes('scroll-margin-bottom: calc(var(--pc-mobile-nav-height, 76px) + 24px + env(safe-area-inset-bottom))'));
  assert.ok(shellCss.includes('--pc-mobile-nav-clearance: calc(var(--pc-mobile-nav-height) + var(--pc-mobile-nav-edge) + 56px + env(safe-area-inset-bottom))'));
  assert.ok(shellCss.includes('padding: 12px 14px var(--pc-mobile-nav-clearance)'));
  assert.ok(shellCss.includes('grid-template-columns: repeat(5, minmax(0, 1fr))'));
  assert.equal(css.includes('.mobile-bottom-nav {'), false);
  assert.equal(css.includes('.mvp-content {'), false);
  assert.equal(packageJson.includes('react'), false);
  assert.equal(packageJson.includes('tailwind'), false);
  const parsed = JSON.parse(packageJsonText) as { dependencies?: Record<string, string> };
  assert.deepEqual(Object.keys(parsed.dependencies ?? {}), ['playwright']);
});
