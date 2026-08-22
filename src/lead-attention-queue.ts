import { leadCardAttentionPresentation } from './lead-card-attention.js';
import { leadPrimaryAlert, sortLeads, type LeadAlertKind } from './lead-list-priority.js';
import { commercialStage, isTerminalClient, localIsoDate } from './lead-pipeline.js';
import type { Client } from './models.js';
import { escapeHtml } from './utils.js';

export interface LeadAttentionRecommendation {
  clientId: number;
  name: string;
  reason: string;
  alertKind: LeadAlertKind;
  action: string;
  when: string;
  relevantDate: string;
  stage: string;
}

function temporalContext(reason: string, dateLabel: string): string {
  if (!dateLabel) return '';
  const normalizedReason = reason.toLocaleLowerCase('es-AR');
  const normalizedDate = dateLabel.toLocaleLowerCase('es-AR');
  return normalizedReason.includes(normalizedDate) ? '' : dateLabel;
}

export function supervisedAttentionRecommendationForClient(
  client: Client,
  today = localIsoDate(),
): LeadAttentionRecommendation | null {
  if (isTerminalClient(client)) return null;
  const primaryAlert = leadPrimaryAlert(client, today);
  const presentation = leadCardAttentionPresentation(client, today);
  const reason = primaryAlert.label;
  const dateLabel = presentation.dateLabel || presentation.scheduledDateLabel || '';
  return {
    clientId: client.id,
    name: client.name,
    reason,
    alertKind: primaryAlert.kind,
    action: presentation.actionLabel,
    when: temporalContext(reason, dateLabel),
    relevantDate: presentation.scheduledDate,
    stage: commercialStage(client),
  };
}

export function supervisedAttentionQueue(
  clients: Client[],
  today = localIsoDate(),
  limit = 3,
): LeadAttentionRecommendation[] {
  const cappedLimit = Math.min(3, Math.max(0, Math.trunc(limit)));
  const active = clients.filter((client) => !isTerminalClient(client));

  return sortLeads(active, 'priority', today)
    .slice(0, cappedLimit)
    .map((client) => supervisedAttentionRecommendationForClient(client, today))
    .filter((item): item is LeadAttentionRecommendation => Boolean(item));
}

export function renderSupervisedAttentionQueue(clients: Client[], today = localIsoDate()): string {
  const recommendations = supervisedAttentionQueue(clients, today, 3);
  const body = recommendations.length
    ? `<div class="pc-supervised-attention-list">${recommendations.map((recommendation) => `<button type="button" class="pc-supervised-attention-item" data-attention-client-id="${recommendation.clientId}" aria-label="Abrir ficha completa de ${escapeHtml(recommendation.name)}">
      <strong class="pc-supervised-attention-name">${escapeHtml(recommendation.name)}</strong>
      <span class="pc-supervised-attention-reason" title="${escapeHtml(recommendation.reason)}">${escapeHtml(recommendation.reason)}${recommendation.when ? ` <small>· ${escapeHtml(recommendation.when)}</small>` : ''}</span>
      <span class="pc-supervised-attention-action" title="${escapeHtml(recommendation.action)}"><b aria-hidden="true">→</b> ${escapeHtml(recommendation.action)}</span>
    </button>`).join('')}</div>`
    : '<p class="pc-supervised-attention-empty">No hay leads activos para atender ahora.</p>';

  return `<section class="pc-supervised-attention-queue" data-supervised-attention-queue aria-labelledby="pc-supervised-attention-title">
    <header class="pc-supervised-attention-heading">
      <strong id="pc-supervised-attention-title">LEADS PRIORITARIOS</strong>
      <span class="pc-supervised-attention-copy"><span class="pc-supervised-attention-copy-full">Gestioná primero los contactos que requieren acción.</span><span class="pc-supervised-attention-copy-compact">Contactos para gestionar primero.</span></span>
    </header>
    ${body}
    <p class="pc-supervised-attention-status" data-attention-navigation-status role="status" aria-live="polite" hidden></p>
  </section>`;
}