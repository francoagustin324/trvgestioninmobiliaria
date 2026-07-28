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

test('resume los tres datos comerciales faltantes en un solo bloque', () => {
  const html = card();
  assert.match(html, /Faltan presupuesto, forma de pago y plazo/);
  assert.equal((html.match(/No confirmado/g) ?? []).length, 0);
  assert.match(html, /mvp-lead-missing-summary/);
});

test('resume dos faltantes sin ocultar el dato confirmado', () => {
  const html = card({ purchaseTimeframe: '0-3 meses' });
  assert.match(html, /Faltan presupuesto y forma de pago/);
  assert.match(html, /Plazo \/ urgencia/);
  assert.match(html, /0-3 meses/);
});

test('mantiene el bloque correspondiente cuando falta un solo dato', () => {
  const html = card({ budget: 'USD 120.000', currency: 'USD', paymentMethod: 'Contado' });
  assert.match(html, /Presupuesto/);
  assert.match(html, /USD 120\.000/);
  assert.match(html, /Pago \/ crédito/);
  assert.match(html, /Contado/);
  assert.match(html, /Plazo \/ urgencia/);
  assert.match(html, /No confirmado/);
  assert.doesNotMatch(html, /mvp-lead-missing-summary/);
});

test('muestra normalmente los tres datos cuando están confirmados', () => {
  const html = card({
    budget: 'USD 146.000',
    currency: 'USD',
    paymentMethod: 'Financiación',
    purchaseTimeframe: '0-3 meses',
  });
  assert.equal((html.match(/mvp-lead-fact/g) ?? []).length, 3);
  assert.doesNotMatch(html, /Faltan presupuesto/);
  assert.doesNotMatch(html, /No confirmado/);
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
  const css = readFileSync('src/lead-list-compact.css', 'utf8');
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
