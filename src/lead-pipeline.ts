import './commercial-close-ui.js';
import type { Client } from './models.js';
import type { QualificationProgress } from './lead-pipeline-essential.js';

export * from './lead-pipeline-essential.js';

const legacyQualificationFields: Array<{ label: string; value: (client: Client) => unknown }> = [
  { label: 'interés', value: (client) => client.interest },
  { label: 'presupuesto', value: (client) => client.budget },
  { label: 'forma de pago', value: (client) => client.paymentMethod },
  { label: 'plazo', value: (client) => client.purchaseTimeframe },
  { label: 'finalidad', value: (client) => client.purpose },
  { label: 'conocimiento de zona', value: (client) => client.knowsArea },
  { label: 'capacidad de avance', value: (client) => client.canMoveForward },
  { label: 'condicionantes', value: (client) => client.objections },
];

export function qualificationProgress(client: Client): QualificationProgress {
  const missing = legacyQualificationFields
    .filter(({ value }) => !String(value(client) ?? '').trim())
    .map(({ label }) => label);
  return {
    completed: legacyQualificationFields.length - missing.length,
    total: legacyQualificationFields.length,
    missing,
  };
}
