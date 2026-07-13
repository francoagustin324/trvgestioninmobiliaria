import type { Client, Property } from './models.js';
import { matchClientsForProperty, matchPropertiesForClient, type PropertyMatch } from './property-matching.js';
import { escapeHtml } from './utils.js';

const usdFormatter = new Intl.NumberFormat('es-AR');

function scoreClass(match: PropertyMatch): string {
  return match.level.toLowerCase();
}

function reasonsHtml(match: PropertyMatch): string {
  const reasons = match.reasons.length
    ? `<div class="match-reasons">${match.reasons.map((reason) => `<span>✓ ${escapeHtml(reason)}</span>`).join('')}</div>`
    : '';
  const warnings = match.warnings.length
    ? `<div class="match-warnings">${match.warnings.map((warning) => `<span>⚠ ${escapeHtml(warning)}</span>`).join('')}</div>`
    : '';
  return `${reasons}${warnings}`;
}

function propertyMatchRow(match: PropertyMatch): string {
  const property = match.property;
  const rooms = property.bedrooms ? ` · ${property.bedrooms} dorm.` : '';
  return `<article class="match-row">
    <div class="match-row-main">
      <div class="match-row-title"><strong>${escapeHtml(property.title)}</strong><span class="match-score ${scoreClass(match)}">${match.score}% · ${match.level}</span></div>
      <p>${escapeHtml(property.address)} · ${escapeHtml(property.type)}${rooms}</p>
      <b>USD ${usdFormatter.format(property.price)}</b>
      ${reasonsHtml(match)}
    </div>
  </article>`;
}

function clientMatchRow(match: PropertyMatch): string {
  const client = match.client;
  return `<article class="match-row">
    <div class="match-row-main">
      <div class="match-row-title"><strong>${escapeHtml(client.name)}</strong><span class="match-score ${scoreClass(match)}">${match.score}% · ${match.level}</span></div>
      <p>${escapeHtml(client.interest)} · ${escapeHtml(client.budget || 'Presupuesto sin confirmar')}</p>
      ${reasonsHtml(match)}
    </div>
    <button type="button" class="secondary" data-edit-client="${client.id}">Abrir cliente</button>
  </article>`;
}

export function clientPropertyMatchesHtml(client: Client, properties: Property[]): string {
  const matches = matchPropertiesForClient(client, properties);
  const visible = matches.slice(0, 3);
  const content = visible.length
    ? visible.map(propertyMatchRow).join('')
    : '<p class="match-empty">No hay propiedades suficientemente compatibles. Revisá presupuesto, zona y detalles del inventario.</p>';
  return `<details class="commercial-matches ${visible.length ? 'has-matches' : 'no-matches'}">
    <summary><span>Propiedades sugeridas</span><strong>${matches.length}</strong></summary>
    <div class="match-body"><p class="match-disclaimer">Sugerencias para revisión humana. PropControl no envía mensajes ni agenda visitas automáticamente.</p>${content}${matches.length > visible.length ? `<small>Se muestran las 3 coincidencias con mayor puntaje de ${matches.length}.</small>` : ''}</div>
  </details>`;
}

export function propertyClientMatchesHtml(property: Property, clients: Client[]): string {
  const matches = matchClientsForProperty(property, clients);
  const visible = matches.slice(0, 5);
  const content = visible.length
    ? visible.map(clientMatchRow).join('')
    : '<p class="match-empty">No hay compradores compatibles con los datos actuales.</p>';
  return `<details class="commercial-matches property-matches ${visible.length ? 'has-matches' : 'no-matches'}">
    <summary><span>Compradores compatibles</span><strong>${matches.length}</strong></summary>
    <div class="match-body"><p class="match-disclaimer">Revisá la calificación antes de contactar o coordinar una visita.</p>${content}${matches.length > visible.length ? `<small>Se muestran los 5 compradores con mayor puntaje de ${matches.length}.</small>` : ''}</div>
  </details>`;
}
