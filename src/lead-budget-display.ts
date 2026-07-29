import type { Client } from './models.js';

const integerFormatter = new Intl.NumberFormat('es-ES', {
  maximumFractionDigits: 0,
  useGrouping: true,
});

const currencyToken = String.raw`(?:USD|ARS|EUR|US\$|d[oó]lares?|pesos?)`;
const currencyPrefix = new RegExp(`^(${currencyToken})\\s+(.+)$`, 'i');
const currencySuffix = new RegExp(`^(.+?)\\s+(${currencyToken})$`, 'i');

function formattedInteger(value: string): string | null {
  const compact = value.trim().replace(/\s+/g, '');
  const digits = /^\d+$/.test(compact)
    ? compact
    : /^\d{1,3}(?:[.,]\d{3})+$/.test(compact)
      ? compact.replace(/[.,]/g, '')
      : '';
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isSafeInteger(amount) ? integerFormatter.format(amount) : null;
}

export function formatLeadBudget(client: Pick<Client, 'budget' | 'currency'>): string {
  const budget = client.budget?.trim();
  if (!budget) return 'No confirmado';

  const prefixed = budget.match(currencyPrefix);
  if (prefixed) {
    const amount = formattedInteger(prefixed[2] ?? '');
    return amount ? `${prefixed[1]} ${amount}` : budget;
  }

  const suffixed = budget.match(currencySuffix);
  if (suffixed) {
    const amount = formattedInteger(suffixed[1] ?? '');
    return amount ? `${amount} ${suffixed[2]}` : budget;
  }

  const amount = formattedInteger(budget);
  if (!amount) return budget;
  const currency = client.currency?.trim();
  return currency ? `${currency} ${amount}` : `${amount} · moneda no confirmada`;
}
