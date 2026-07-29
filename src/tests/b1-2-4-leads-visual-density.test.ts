import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderCompactLeadCard } from '../lead-card-compact-ui.js';
import { modules, type Client } from '../models.js';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 24,
    name: 'Lead de validación visual',
    phone: '5493515550024',
    email: 'lead24@example.test',
    interest: 'Departamento en Córdoba',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
    ...overrides,
  };
}

function card(overrides: Partial<Client> = {}): string {
  return renderCompactLeadCard(client(overrides), {
    expanded: false,
    responsible: 'Franco Solís',
    qualificationPanel: '',
    history: '',
    matches: '',
  });
}

function factsMarkup(html: string): string {
  const start = html.indexOf('<div class="mvp-lead-compact-facts');
  const end = html.indexOf('<div class="mvp-lead-next-action', start);
  assert.ok(start >= 0 && end > start, 'No se encontró la zona compacta de datos comerciales.');
  return html.slice(start, end);
}

test('resume los tres datos comerciales faltantes en un solo bloque', () => {
  const facts = factsMarkup(card());
  assert.match(facts, /Faltan presupuesto, forma de pago y plazo/);
  assert.equal((facts.match(/No confirmado/g) ?? []).length, 0);
  assert.match(facts, /mvp-lead-missing-summary/);
  assert.equal((facts.match(/mvp-lead-fact/g) ?? []).length, 0);
});

test('resume dos faltantes sin ocultar el dato confirmado', () => {
  const facts = factsMarkup(card({ purchaseTimeframe: '0-3 meses' }));
  assert.match(facts, /Faltan presupuesto y forma de pago/);
  assert.match(facts, /Plazo \/ urgencia/);
  assert.match(facts, /0-3 meses/);
  assert.equal((facts.match(/mvp-lead-fact/g) ?? []).length, 1);
});

test('mantiene el bloque correspondiente cuando falta un solo dato', () => {
  const facts = factsMarkup(card({ budget: 'USD 120.000', currency: 'USD', paymentMethod: 'Contado' }));
  assert.match(facts, /Presupuesto/);
  assert.match(facts, /USD 120\.000/);
  assert.match(facts, /Pago \/ crédito/);
  assert.match(facts, /Contado/);
  assert.match(facts, /Plazo \/ urgencia/);
  assert.match(facts, /No confirmado/);
  assert.doesNotMatch(facts, /mvp-lead-missing-summary/);
  assert.equal((facts.match(/mvp-lead-fact/g) ?? []).length, 3);
});

test('muestra normalmente los tres datos cuando están confirmados', () => {
  const facts = factsMarkup(card({
    budget: 'USD 146.000',
    currency: 'USD',
    paymentMethod: 'Financiación',
    purchaseTimeframe: '0-3 meses',
  }));
  assert.equal((facts.match(/mvp-lead-fact/g) ?? []).length, 3);
  assert.doesNotMatch(facts, /Faltan presupuesto/);
  assert.doesNotMatch(facts, /No confirmado/);
});

test('la navegación visible usa exactamente los mismos nombres en escritorio y celular', () => {
  assert.deepEqual(modules, [
    ['crm', 'Leads'],
    ['whatsapp', 'Chats'],
    ['agenda', 'Agenda'],
    ['propiedades', 'Propiedades'],
    ['equipo', 'Equipo'],
    ['configuracion', 'Configuración'],
  ]);
  const main = readFileSync('src/mvp-main.ts', 'utf8');
  assert.match(main, /whatsapp: 'Chats'/);
  assert.match(main, /agenda: 'Agenda'/);
  assert.match(main, /equipo: 'Equipo'/);
});

test('los estilos B1.2.4 fijan densidad, contraste, controles y degradados condicionales', () => {
  const css = [
    'src/lead-pipeline.css',
    'src/lead-list-compact.css',
    'src/lead-list-polish.css',
    'src/lead-list-card-density.css',
  ].map((path) => readFileSync(path, 'utf8')).join('\n');
  assert.match(css, /B1\.2\.4/);
  assert.match(css, /@media \(min-width: 901px\)/);
  assert.match(css, /mvp-lead-filter-primary/);
  assert.match(css, /mvp-lead-new-button/);
  assert.match(css, /mvp-lead-missing-summary/);
  assert.match(css, /data-overflow-right='true'/);
  assert.match(css, /data-overflow-left='true'/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /:disabled/);
});

test('el pulido mantiene intactas las integraciones comerciales existentes', () => {
  const leads = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  assert.match(leads, /filterLeads\(visibleClients\(\), filters\)/);
  assert.match(leads, /sortLeads\(assigned, filters\.order\)/);
  assert.match(leads, /matchPropertiesForClient/);
  assert.match(leads, /renderLeadQualificationPanel/);
  assert.match(leads, /completeClientFollowUp/);
  assert.match(leads, /reprogramClientFollowUp/);
  assert.match(leads, /data-lead-full-sheet/);
});
