import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatLeadBudget } from '../lead-budget-display.js';
import { renderCompactLeadCard } from '../lead-card-compact-ui.js';
import { localIsoDate } from '../lead-pipeline.js';
import type { Client } from '../models.js';

function isoOffset(days: number): string {
  const date = new Date(`${localIsoDate()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function lead(overrides: Partial<Client> = {}): Client {
  return {
    id: 1,
    name: 'Lucía Martín',
    phone: '5493515550001',
    email: 'lucia@example.test',
    interest: 'Casa de 2 habitaciones en zona centro',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Visita coordinada',
    nextAction: 'Confirmar nueva visita',
    nextFollowUp: isoOffset(-19),
    budget: '168000',
    currency: 'USD',
    paymentMethod: 'Crédito preaprobado',
    purchaseTimeframe: '0-3 meses',
    ...overrides,
  };
}

const context = {
  expanded: false,
  responsible: 'Franco Solís',
  qualificationPanel: '',
  history: '',
  matches: '',
};

test('formatea importes numéricos sin modificar el valor almacenado', () => {
  const usd = lead({ budget: '168000', currency: 'USD' });
  const ars = lead({ budget: '7600000', currency: 'ARS' });
  const unknown = lead({ budget: '168000', currency: undefined });

  assert.equal(formatLeadBudget(usd), 'USD 168.000');
  assert.equal(formatLeadBudget(ars), 'ARS 7.600.000');
  assert.equal(formatLeadBudget(unknown), '168.000 · moneda no confirmada');
  assert.equal(usd.budget, '168000');
  assert.equal(ars.budget, '7600000');
  assert.equal(unknown.budget, '168000');
});

test('preserva moneda incluida en el presupuesto y textos no puramente numéricos', () => {
  assert.equal(formatLeadBudget(lead({ budget: 'USD 168000', currency: undefined })), 'USD 168.000');
  assert.equal(formatLeadBudget(lead({ budget: 'ARS 7600000', currency: undefined })), 'ARS 7.600.000');
  assert.equal(formatLeadBudget(lead({ budget: 'Hasta USD 120.000', currency: 'USD' })), 'Hasta USD 120.000');
  assert.equal(formatLeadBudget(lead({ budget: 'Entre 100 y 120 mil dólares', currency: undefined })), 'Entre 100 y 120 mil dólares');
  assert.equal(formatLeadBudget(lead({ budget: 'A confirmar', currency: 'ARS' })), 'A confirmar');
});

test('el encabezado separa identidad y estados y conserva el detalle completo accesible', () => {
  const html = renderCompactLeadCard(lead(), context);
  assert.match(html, /class="mvp-lead-identity"/);
  assert.match(html, /class="mvp-lead-statuses"/);
  assert.match(html, /<h3>Lucía Martín<\/h3>/);
  assert.match(html, /aria-label="Seguimiento vencido hace 19 días\. Programado para \d{2}\/\d{2}\/\d{4}\."/);
  assert.match(html, /title="Seguimiento vencido hace 19 días\. Programado para \d{2}\/\d{2}\/\d{4}\."/);
  assert.match(html, /data-mobile-label="Vencido · 19 días"/);
  assert.match(html, /class="mvp-lead-alert-text">Vencido · 19 días<\/span>/);
  assert.equal((html.match(/mvp-lead-alert-text/g) ?? []).length, 1);
  assert.doesNotMatch(html, /mvp-lead-alert-full|mvp-lead-alert-compact/);
});

test('los nombres obligatorios se renderizan completos y sin fragmentación artificial en el HTML', () => {
  for (const name of [
    'Lucía Martín',
    'María de los Ángeles Fernández',
    'TRV Gestión Inmobiliaria',
    'Juan Ignacio Rodríguez Martínez',
  ]) {
    const html = renderCompactLeadCard(lead({ name }), context);
    assert.match(html, new RegExp(`<h3>${name}<\\/h3>`));
    assert.doesNotMatch(html, /Martí<[^>]*>n/);
  }
});

test('el CSS móvil usa dos filas estables y prohíbe cortar palabras del nombre', () => {
  const css = readFileSync('src/lead-list-compact.css', 'utf8');
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /grid-template-rows:\s*auto auto/);
  assert.match(css, /grid-template-areas:\s*['"]identity['"]\s*['"]statuses['"]/);
  assert.match(css, /\.mvp-lead-identity/);
  assert.match(css, /\.mvp-lead-statuses/);
  assert.match(css, /word-break:\s*normal/);
  assert.match(css, /overflow-wrap:\s*normal/);
  assert.match(css, /hyphens:\s*none/);
  assert.match(css, /white-space:\s*normal/);
  assert.match(css, /\.mvp-lead-alert::after[^}]*content:\s*attr\(data-mobile-label\)/s);
  assert.doesNotMatch(css, /\.mvp-lead-identity h3[^}]*overflow-wrap:\s*break-word/s);
  assert.doesNotMatch(css, /!important/);
});
