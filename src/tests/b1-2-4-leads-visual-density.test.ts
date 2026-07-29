import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { renderCompactLeadCard } from '../lead-card-compact-ui.js';
import { modules, type Client } from '../models.js';

interface CssRule {
  context: string;
  selector: string;
  declarations: Array<{ property: string; value: string }>;
}

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

function matchingBrace(source: string, opening: number): number {
  let depth = 1;
  for (let index = opening + 1; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error('CSS con llaves desbalanceadas.');
}

function collectCssRules(source: string, context = 'root', rules: CssRule[] = []): CssRule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  let cursor = 0;
  while (cursor < css.length) {
    const opening = css.indexOf('{', cursor);
    if (opening < 0) break;
    const header = css.slice(cursor, opening).trim();
    const closing = matchingBrace(css, opening);
    const body = css.slice(opening + 1, closing);
    if (header.startsWith('@media')) {
      collectCssRules(body, `${context}|${header.replace(/\s+/g, ' ')}`, rules);
    } else if (header && !header.startsWith('@')) {
      const declarations = body
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const separator = entry.indexOf(':');
          return separator < 0
            ? { property: entry, value: '' }
            : { property: entry.slice(0, separator).trim(), value: entry.slice(separator + 1).trim() };
        });
      header.split(',').map((selector) => selector.trim()).filter(Boolean).forEach((selector) => {
        rules.push({ context, selector: selector.replace(/\s+/g, ' '), declarations });
      });
    }
    cursor = closing + 1;
  }
  return rules;
}

function duplicatedCriticalDeclarations(css: string): string[] {
  const critical = new Set([
    'display',
    'gap',
    'row-gap',
    'column-gap',
    'padding',
    'padding-block',
    'padding-inline',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'height',
    'min-height',
    'max-height',
    'width',
    'min-width',
    'max-width',
    'grid-template-columns',
    'grid-template-rows',
    'grid-auto-flow',
    'grid-column',
    'grid-row',
  ]);
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const rule of collectCssRules(css)) {
    for (const declaration of rule.declarations) {
      if (!critical.has(declaration.property)) continue;
      const key = `${rule.context} :: ${rule.selector} :: ${declaration.property}`;
      const previous = seen.get(key);
      if (previous !== undefined) duplicates.push(`${key} (${previous} / ${declaration.value})`);
      else seen.set(key, declaration.value);
    }
  }
  return duplicates;
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

test('B1.2.4 carga una sola hoja de pulido y elimina las hojas superpuestas', () => {
  const index = readFileSync('index.html', 'utf8');
  assert.equal(existsSync('src/lead-list-card-density.css'), false);
  assert.equal(existsSync('src/lead-list-desktop-density.css'), false);
  assert.doesNotMatch(index, /lead-list-card-density\.css/);
  assert.doesNotMatch(index, /lead-list-desktop-density\.css/);
  assert.equal((index.match(/lead-list-polish\.css/g) ?? []).length, 1);
  assert.doesNotMatch(index, /lead-list-polish-ui\.js/);
});

test('la hoja consolidada conserva densidad, contraste y degradados sin important', () => {
  const css = readFileSync('src/lead-list-polish.css', 'utf8');
  assert.match(css, /B1\.2\.4/);
  assert.match(css, /@media \(min-width: 901px\)/);
  assert.match(css, /mvp-lead-filter-primary/);
  assert.match(css, /mvp-lead-new-button/);
  assert.match(css, /mvp-lead-missing-summary/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /:disabled/);
  assert.match(css, /touch-action:\s*pan-x pan-y/);
  assert.match(css, /transition:\s*none/);
  assert.doesNotMatch(css, /!important/);
});

test('la hoja B1.2.4 no redefine propiedades críticas dentro del mismo breakpoint', () => {
  const css = readFileSync('src/lead-list-polish.css', 'utf8');
  assert.deepEqual(duplicatedCriticalDeclarations(css), []);
});

test('el pulido se integra explícitamente al render de Leads sin observación global', () => {
  const polish = readFileSync('src/lead-list-polish-ui.ts', 'utf8');
  const leads = readFileSync('src/mvp-leads-ui.ts', 'utf8');
  assert.doesNotMatch(polish, /MutationObserver/);
  assert.doesNotMatch(polish, /querySelector<HTMLElement>\('#root'\)/);
  assert.doesNotMatch(polish, /addEventListener\('trv-render'/);
  assert.doesNotMatch(polish, /addEventListener\('resize'/);
  assert.match(polish, /matchMedia\(desktopQuery\)/);
  assert.match(polish, /addEventListener\('change', handleDesktopChange\)/);
  assert.match(polish, /WeakSet<HTMLDetailsElement>/);
  assert.match(polish, /WeakSet<HTMLElement>/);
  const insertion = leads.indexOf('container.innerHTML =');
  const integration = leads.indexOf('enhanceLeadList(container, { centerSelectedStage });');
  assert.ok(insertion >= 0 && integration > insertion, 'El pulido debe ejecutarse después de insertar el DOM de Leads.');
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
