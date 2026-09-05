import { isTerminalClient } from './lead-pipeline.js';
import type { Client, Property } from './models.js';
import { matchClientsForProperty, type PropertyMatch } from './property-matching.js';

export type OpportunityCompatibilityFilter = 'all' | 'high';
export type OpportunityFollowUpFilter = 'all' | 'with' | 'without';
export type OpportunityStatusFilter = 'active' | 'all';

export interface OpportunityFilters {
  search: string;
  compatibility: OpportunityCompatibilityFilter;
  followUp: OpportunityFollowUpFilter;
  status: OpportunityStatusFilter;
}

export interface PropertyOpportunity {
  match: PropertyMatch;
  hasFollowUp: boolean;
}

export const DEFAULT_OPPORTUNITY_FILTERS: OpportunityFilters = {
  search: '',
  compatibility: 'all',
  followUp: 'all',
  status: 'active',
};

function normalizedText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function propertyMatchingDataIssues(property: Property): string[] {
  const issues: string[] = [];
  if (!String(property.type ?? '').trim()) issues.push('tipo de propiedad');
  if (!String(property.address ?? '').trim()) issues.push('ubicación');
  if (!Number.isFinite(property.price) || property.price <= 0) issues.push('precio');
  return issues;
}

/**
 * P1.4-A1 consumes the canonical matching engine exactly once per property evaluation.
 * It never recalculates, rescales or reorders compatibility scores.
 */
export function buildPropertyOpportunities(property: Property, clients: Client[]): PropertyOpportunity[] {
  return matchClientsForProperty(property, clients).map((match) => ({
    match,
    hasFollowUp: Boolean(String(match.client.nextFollowUp ?? '').trim()),
  }));
}

export function filterPropertyOpportunities(
  opportunities: PropertyOpportunity[],
  filters: OpportunityFilters,
): PropertyOpportunity[] {
  const query = normalizedText(filters.search);
  return opportunities.filter(({ match, hasFollowUp }) => {
    if (filters.compatibility === 'high' && match.level !== 'Alta') return false;
    if (filters.followUp === 'with' && !hasFollowUp) return false;
    if (filters.followUp === 'without' && hasFollowUp) return false;
    if (!query) return true;
    return normalizedText([
      match.client.name,
      match.client.phone,
      match.client.interest,
      match.client.budget,
      match.client.pipeline,
      match.client.nextAction,
      match.client.nextFollowUp,
      ...match.reasons,
      ...match.warnings,
    ].filter(Boolean).join(' ')).includes(query);
  });
}

export function terminalClientsForOpportunities(clients: Client[]): Client[] {
  return clients
    .filter(isTerminalClient)
    .sort((left, right) => left.name.localeCompare(right.name, 'es'));
}
