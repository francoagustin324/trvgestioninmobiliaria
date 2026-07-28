import { renderLeadSecondaryMeta } from './lead-essential-ui.js';
import {
  compactBudget,
  compactPayment,
  compactTimeframe,
  leadFollowUpDisplay,
  leadPrimaryAlert,
  leadUpdatedLabel,
} from './lead-list-priority.js';
import { commercialQualificationState, commercialStage, isTerminalClient } from './lead-pipeline.js';
import type { Client } from './models.js';
import { formatPhone } from './phone-normalizer.js';
import { appIcons } from './icons.js';
import { escapeHtml } from './utils.js';

export interface CompactLeadCardContext {
  expanded: boolean;
  responsible: string;
  qualificationPanel: string;
  history: string;
  matches: string;
}

function text(value: string | undefined, fallback = 'No confirmado'): string {
  return escapeHtml(value?.trim() || fallback);
}

function temperatureIcon(temperature: string): string {
  const slug = temperature === 'Caliente' ? 'cliente-caliente'
    : temperature === 'Frío' ? 'cliente-frio'
      : 'cliente-tibio';
  return `<img class="mvp-temp-icon" src="/src/assets/${slug}.png?v=20260722-45" alt="" title="Cliente ${escapeHtml(temperature.toLowerCase())}">`;
}

function creditDetail(client: Client): string {
  const parts = [client.creditPossible?.trim(), client.creditApprovedAmount?.trim()].filter(Boolean);
  if (!parts.length && client.paymentMethod === 'Contado') return 'No necesita';
  return parts.join(' · ') || 'No confirmado';
}

function quickActions(client: Client): string {
  const digits = client.phone.replace(/\D/g, '');
  return `<div class="mvp-lead-quick-actions" aria-label="Acciones rápidas de ${escapeHtml(client.name)}">
    <a class="mvp-contact-btn wa" href="https://wa.me/${digits}" target="_blank" rel="noopener noreferrer" title="WhatsApp · ${escapeHtml(formatPhone(client.phone))}" aria-label="Enviar WhatsApp">${appIcons.whatsapp}</a>
    <a class="mvp-contact-btn call" href="tel:+${digits}" title="Llamar · ${escapeHtml(formatPhone(client.phone))}" aria-label="Llamar">${appIcons.phone}</a>
    ${client.email ? `<a class="mvp-contact-btn mail" href="mailto:${escapeHtml(client.email)}" title="${escapeHtml(client.email)}" aria-label="Enviar email">${appIcons.mail}</a>` : ''}
    <button type="button" class="secondary mvp-auto-qualify-button" data-auto-qualify-client="${client.id}">Calificar automáticamente</button>
  </div>`;
}

function followUpMenu(client: Client): string {
  if (isTerminalClient(client) || (!client.nextAction?.trim() && !client.nextFollowUp)) return '';
  const currentDate = escapeHtml(client.nextFollowUp || '');
  return `<details class="mvp-lead-followup-menu">
    <summary aria-label="Gestionar seguimiento de ${escapeHtml(client.name)}" title="Gestionar seguimiento">•••</summary>
    <div class="mvp-lead-followup-popover">
      <button type="button" data-complete-client-follow-up="${client.id}">Completar seguimiento</button>
      <form data-reprogram-client-follow-up="${client.id}">
        <label>Nueva fecha<input type="date" name="date" value="${currentDate}" required></label>
        <button type="submit" class="secondary">Reprogramar</button>
      </form>
    </div>
  </details>`;
}

function secondaryText(client: Client): string {
  const blocks = [
    ['Preferencias', client.preferences],
    ['Características', client.features],
    ['Objeciones o condicionantes', client.objections],
    ['Notas internas', client.notes],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));
  if (!blocks.length) return '<p class="mvp-lead-full-empty">No hay información secundaria cargada.</p>';
  return `<div class="mvp-lead-full-notes">${blocks.map(([label, value]) => `<article><span>${label}</span><p>${escapeHtml(value)}</p></article>`).join('')}</div>`;
}

function fullSheet(client: Client, context: CompactLeadCardContext): string {
  const qualification = commercialQualificationState(client);
  return `<details class="mvp-lead-full-sheet" data-lead-full-sheet="${client.id}"${context.expanded ? ' open' : ''}>
    <summary aria-expanded="${context.expanded ? 'true' : 'false'}"><span>${context.expanded ? 'Ocultar ficha' : 'Ver ficha completa'}</span><small>Datos secundarios, historial y propiedades</small></summary>
    <div class="mvp-lead-full-content">
      <div class="mvp-lead-full-grid">
        <div><span>Zona</span><strong>${text(client.zones)}</strong></div>
        <div><span>Finalidad</span><strong>${text(client.purpose)}</strong></div>
        <div><span>Puede avanzar</span><strong>${text(client.canMoveForward)}</strong></div>
        <div><span>Conoce la zona</span><strong>${text(client.knowsArea, 'Dato adicional no confirmado')}</strong></div>
        <div><span>Crédito</span><strong>${escapeHtml(creditDetail(client))}</strong></div>
        <div><span>Responsable</span><strong>${escapeHtml(context.responsible)}</strong></div>
        <div><span>Estado comercial</span><strong>${escapeHtml(qualification.state)}</strong></div>
        <div><span>Última actualización</span><strong>${escapeHtml(leadUpdatedLabel(client))}</strong></div>
      </div>
      ${renderLeadSecondaryMeta(client)}
      ${secondaryText(client)}
      ${context.history}
      ${context.matches}
      <div class="mvp-lead-full-actions">
        <button type="button" class="secondary" data-edit-client="${client.id}">${appIcons.edit}<span>Editar</span></button>
        <button type="button" class="delete" data-delete="clients" data-id="${client.id}">Eliminar</button>
      </div>
    </div>
  </details>`;
}

export function renderCompactLeadCard(client: Client, context: CompactLeadCardContext): string {
  const stage = commercialStage(client);
  const terminal = isTerminalClient(client);
  const alert = leadPrimaryAlert(client);
  const followUp = leadFollowUpDisplay(client);
  return `<article class="mvp-lead-card mvp-lead-card-with-matches mvp-lead-compact-card${terminal ? ' terminal' : ''}" data-client-id="${client.id}">
    <header class="mvp-lead-compact-header">
      <div class="mvp-lead-title-line">${temperatureIcon(client.temperature)}<h3>${escapeHtml(client.name)}</h3><span class="mvp-stage-badge${terminal ? ' terminal' : ''}">${escapeHtml(stage)}</span></div>
      <div class="mvp-lead-alert tone-${alert.tone}" data-lead-alert-rank="${alert.rank}">${escapeHtml(alert.label)}</div>
    </header>
    <p class="mvp-lead-interest">${client.interest ? escapeHtml(client.interest) : 'Sin búsqueda definida'}</p>
    <div class="mvp-lead-compact-facts">
      <div><span>Presupuesto</span><strong>${escapeHtml(compactBudget(client))}</strong></div>
      <div><span>Pago / crédito</span><strong>${escapeHtml(compactPayment(client))}</strong></div>
      <div><span>Plazo / urgencia</span><strong>${escapeHtml(compactTimeframe(client))}</strong></div>
    </div>
    <div class="mvp-lead-next-action state-${followUp.state}">
      <div><span>Próxima acción</span><strong>${escapeHtml(followUp.action)}</strong>${followUp.dateLabel ? `<small>${escapeHtml(followUp.dateLabel)}</small>` : ''}</div>
      ${followUpMenu(client)}
    </div>
    ${quickActions(client)}
    ${context.qualificationPanel}
    ${fullSheet(client, context)}
  </article>`;
}
