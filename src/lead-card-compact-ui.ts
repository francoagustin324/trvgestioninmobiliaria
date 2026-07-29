import { leadCardAttentionPresentation, type LeadCardAttentionPresentation } from './lead-card-attention.js';
import { formatLeadBudget } from './lead-budget-display.js';
import { renderLeadSecondaryMeta } from './lead-essential-ui.js';
import {
  compactPayment,
  compactTimeframe,
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

interface LeadFact {
  key: 'budget' | 'payment' | 'timeframe';
  label: string;
  missingLabel: string;
  value: string;
  missing: boolean;
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

function fullSheet(
  client: Client,
  context: CompactLeadCardContext,
  attention: LeadCardAttentionPresentation,
): string {
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
        <div><span>Seguimiento programado</span><strong>${escapeHtml(attention.scheduledDateLabel || 'Sin fecha programada')}</strong></div>
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

function commercialFacts(client: Client): LeadFact[] {
  return [
    {
      key: 'budget',
      label: 'Presupuesto',
      missingLabel: 'presupuesto',
      value: formatLeadBudget(client),
      missing: !client.budget?.trim(),
    },
    {
      key: 'payment',
      label: 'Pago / crédito',
      missingLabel: 'forma de pago',
      value: compactPayment(client),
      missing: !client.paymentMethod?.trim(),
    },
    {
      key: 'timeframe',
      label: 'Plazo / urgencia',
      missingLabel: 'plazo',
      value: compactTimeframe(client),
      missing: !client.purchaseTimeframe?.trim() && !client.urgency?.trim(),
    },
  ];
}

function joinedMissingLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} y ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`;
}

function renderCommercialFacts(client: Client): string {
  const facts = commercialFacts(client);
  const missing = facts.filter((fact) => fact.missing);
  const shownFacts = missing.length >= 2 ? facts.filter((fact) => !fact.missing) : facts;
  const summary = missing.length >= 2
    ? `<div class="mvp-lead-missing-summary" role="note"><strong>Faltan ${escapeHtml(joinedMissingLabels(missing.map((fact) => fact.missingLabel)))}</strong><span>Confirmalos para completar la calificación comercial.</span></div>`
    : '';
  const blocks = shownFacts.map((fact) => `<div class="mvp-lead-fact" data-lead-fact="${fact.key}"><span>${fact.label}</span><strong>${escapeHtml(fact.value)}</strong></div>`).join('');
  return `<div class="mvp-lead-compact-facts${missing.length >= 2 ? ' has-missing-summary' : ''}">${summary}${blocks}</div>`;
}

export function renderCompactLeadCard(client: Client, context: CompactLeadCardContext): string {
  const stage = commercialStage(client);
  const terminal = isTerminalClient(client);
  const attention = leadCardAttentionPresentation(client);
  const alertLabel = escapeHtml(attention.alertLabel);
  const alertFullLabel = escapeHtml(attention.alertFullLabel);
  const alert = attention.showAlert
    ? `<div class="mvp-lead-alert tone-${attention.alertTone}" data-lead-alert-rank="${attention.alertRank}" data-lead-alert-kind="${attention.alertKind}" data-mobile-label="${alertLabel}" aria-label="${alertFullLabel}" title="${alertFullLabel}"><span class="mvp-lead-alert-text">${alertLabel}</span></div>`
    : '<div class="mvp-lead-alert" data-lead-alert-kind="none" hidden aria-hidden="true"></div>';
  const nextAction = attention.showAction
    ? `<div class="mvp-lead-next-action state-${attention.followUpState}" data-lead-attention-kind="${attention.alertKind}" aria-label="${escapeHtml(attention.actionTitle)}" title="${escapeHtml(attention.actionTitle)}">
        <div><span>Próxima acción</span><strong>${escapeHtml(attention.actionLabel)}</strong>${attention.showDate ? `<small>${escapeHtml(attention.dateLabel)}</small>` : ''}</div>
        ${followUpMenu(client)}
      </div>`
    : '';
  return `<article class="mvp-lead-card mvp-lead-card-with-matches mvp-lead-compact-card${terminal ? ' terminal' : ''}" data-client-id="${client.id}">
    <header class="mvp-lead-compact-header">
      <div class="mvp-lead-identity">${temperatureIcon(client.temperature)}<h3>${escapeHtml(client.name)}</h3></div>
      <div class="mvp-lead-statuses"><span class="mvp-stage-badge${terminal ? ' terminal' : ''}">${escapeHtml(stage)}</span>${alert}</div>
    </header>
    <p class="mvp-lead-interest">${client.interest ? escapeHtml(client.interest) : 'Sin búsqueda definida'}</p>
    ${renderCommercialFacts(client)}
    ${nextAction}
    ${quickActions(client)}
    ${context.qualificationPanel}
    ${fullSheet(client, context, attention)}
  </article>`;
}
