import { leadCardAttentionPresentation } from './lead-card-attention.js';
import { leadPrimaryAlert, sortLeads } from './lead-list-priority.js';
import { commercialStage, isTerminalClient, localIsoDate } from './lead-pipeline.js';
import type { Client } from './models.js';
import { escapeHtml } from './utils.js';

export interface LeadAttentionRecommendation {
  clientId: number;
  name: string;
  reason: string;
  action: string;
  when: string;
  stage: string;
}

function temporalContext(reason: string, dateLabel: string): string {
  if (!dateLabel) return '';
  const normalizedReason = reason.toLocaleLowerCase('es-AR');
  const normalizedDate = dateLabel.toLocaleLowerCase('es-AR');
  return normalizedReason.includes(normalizedDate) ? '' : dateLabel;
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
    .map((client) => {
      const primaryAlert = leadPrimaryAlert(client, today);
      const presentation = leadCardAttentionPresentation(client, today);
      const reason = primaryAlert.label;
      const dateLabel = presentation.dateLabel || presentation.scheduledDateLabel || '';
      return {
        clientId: client.id,
        name: client.name,
        reason,
        action: presentation.actionLabel,
        when: temporalContext(reason, dateLabel),
        stage: commercialStage(client),
      };
    });
}

export function renderSupervisedAttentionQueue(clients: Client[], today = localIsoDate()): string {
  const recommendations = supervisedAttentionQueue(clients, today, 3);
  const body = recommendations.length
    ? `<div class="pc-supervised-attention-list">${recommendations.map((recommendation) => `<article class="pc-supervised-attention-item" data-attention-client-id="${recommendation.clientId}" aria-label="Atender a ${escapeHtml(recommendation.name)}">
      <strong class="pc-supervised-attention-name">${escapeHtml(recommendation.name)}</strong>
      <span class="pc-supervised-attention-reason" title="${escapeHtml(recommendation.reason)}">${escapeHtml(recommendation.reason)}${recommendation.when ? ` <small>· ${escapeHtml(recommendation.when)}</small>` : ''}</span>
      <span class="pc-supervised-attention-action" title="${escapeHtml(recommendation.action)}"><b aria-hidden="true">→</b> ${escapeHtml(recommendation.action)}</span>
    </article>`).join('')}</div>`
    : '<p class="pc-supervised-attention-empty">No hay leads activos para atender ahora.</p>';

  return `<section class="pc-supervised-attention-queue" data-supervised-attention-queue aria-labelledby="pc-supervised-attention-title">
    <header class="pc-supervised-attention-heading">
      <strong id="pc-supervised-attention-title">ATENDER AHORA</strong>
      <span>Prioridad global de tus leads visibles</span>
    </header>
    ${body}
  </section>`;
}
