import { commercialQualificationState } from './lead-pipeline.js';
import type { Client } from './models.js';
import { escapeHtml } from './utils.js';

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function value(client: Client | null, key: keyof Client): string {
  const current = client?.[key];
  if (typeof current === 'number') return escapeHtml(String(current));
  return escapeHtml(typeof current === 'string' ? current : '');
}

function selected(current: string | undefined, expected: string): string {
  return current === expected ? ' selected' : '';
}

function compactOptions(values: string[], current: string | undefined, emptyLabel = 'Sin definir'): string {
  return [
    `<option value=""${current ? '' : ' selected'}>${emptyLabel}</option>`,
    ...values.map((option) => `<option value="${escapeHtml(option)}"${selected(current, option)}>${escapeHtml(option)}</option>`),
  ].join('');
}

function summaryValue(text: string | undefined, fallback = 'No confirmado'): string {
  return escapeHtml(text?.trim() || fallback);
}

function explicitCurrency(client: Client): string {
  if (client.currency?.trim()) return client.currency.trim();
  const match = client.budget?.match(/\b(?:USD|ARS|EUR|US\$)\b/i);
  return match?.[0]?.toUpperCase().replace('US$', 'USD') || '';
}

function creditSummary(client: Client): string {
  const status = client.creditPossible?.trim()
    || (client.paymentMethod === 'Contado' ? 'No necesita' : 'No confirmado');
  return client.creditApprovedAmount?.trim()
    ? `${status} · ${client.creditApprovedAmount.trim()}`
    : status;
}

function timeframeSummary(client: Client): string {
  const parts = [client.purchaseTimeframe?.trim(), client.urgency?.trim()].filter(Boolean);
  return [...new Set(parts)].join(' · ') || 'No confirmado';
}

function updatedAt(client: Client): string {
  if (!client.qualificationUpdatedAt) return '';
  const date = new Date(client.qualificationUpdatedAt);
  if (Number.isNaN(date.getTime())) return '';
  return `<small class="mvp-qualification-updated">Actualizado ${escapeHtml(dateFormatter.format(date))}</small>`;
}

export function renderLeadSecondaryMeta(client: Client): string {
  const values = [
    client.propertyType ? `Tipo: ${client.propertyType}` : '',
    client.bedrooms ? `${client.bedrooms} dormitorios` : '',
    client.garage === 'Sí' ? 'Cochera' : '',
    client.patio === 'Sí' ? 'Patio' : '',
    client.pool === 'Sí' ? 'Pileta' : '',
    client.requiresCreditReady === 'Sí' ? 'Requiere apto crédito' : '',
  ].filter(Boolean);
  return values.length
    ? `<div class="mvp-property-meta">${values.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>`
    : '';
}

export function renderLeadCommercialSummary(client: Client): string {
  const qualification = commercialQualificationState(client);
  const budget = client.budget?.trim();
  const currency = explicitCurrency(client);
  const budgetText = budget
    ? (/\b(?:USD|ARS|EUR|US\$|d[oó]lares?|pesos?)\b/i.test(budget) || !currency ? budget : `${currency} ${budget}`)
    : 'No confirmado';
  const showAdditional = typeof window === 'undefined' || !window.matchMedia('(max-width: 520px)').matches;
  return `<div class="mvp-lead-summary mvp-lead-essential-summary">
    <div><span>Presupuesto</span><strong>${escapeHtml(budgetText)}</strong>${budget && !currency ? '<small class="qualification-budget-warning">Moneda sin confirmar</small>' : ''}</div>
    <div><span>Forma de pago</span><strong>${summaryValue(client.paymentMethod)}</strong></div>
    <div><span>Crédito</span><strong>${escapeHtml(creditSummary(client))}</strong></div>
    <div><span>Zona principal</span><strong>${summaryValue(client.zones)}</strong></div>
    <div><span>Plazo / urgencia</span><strong>${escapeHtml(timeframeSummary(client))}</strong></div>
    <div><span>Puede avanzar</span><strong>${summaryValue(client.canMoveForward)}</strong></div>
  </div>
  <details class="mvp-lead-summary-more"${showAdditional ? ' open' : ''}>
    <summary>Ver calificación completa</summary>
    <div class="mvp-lead-summary-secondary">
      <div><span>Finalidad</span><strong>${summaryValue(client.purpose)}</strong></div>
      <div><span>Conoce la zona</span><strong>${summaryValue(client.knowsArea, 'Dato adicional no confirmado')}</strong></div>
    </div>
  </details>
  <div class="mvp-qualification state-${qualification.slug}">
    <div><strong>${escapeHtml(qualification.state)}</strong><small>${escapeHtml(qualification.detail)}</small></div>
    ${updatedAt(client)}
  </div>`;
}

export function renderEssentialQualificationFields(editing: Client | null): string {
  return `<details class="lead-form-more lead-form-essential" open>
    <summary>Calificación comercial esencial</summary>
    <div class="lead-form-more-grid">
      <label>Presupuesto o rango<input name="budget" value="${value(editing, 'budget')}" placeholder="Ej. USD 120.000 o entre 110 y 130"></label>
      <label>Moneda<input name="currency" value="${value(editing, 'currency')}" placeholder="Ej. USD o ARS"></label>
      <label>Forma de pago<select name="paymentMethod">${compactOptions(['Contado', 'Crédito hipotecario', 'Financiación', 'Combinación'], editing?.paymentMethod)}</select></label>
      <label>Situación del crédito<select name="creditPossible">${compactOptions(['No necesita', 'Todavía no iniciado', 'En trámite', 'Preaprobado', 'Aprobado'], editing?.creditPossible)}</select></label>
      <label>Monto aprobado<input name="creditApprovedAmount" value="${value(editing, 'creditApprovedAmount')}" placeholder="Solo si ya fue informado"></label>
      <label>Zona o barrios principales<input name="zones" value="${value(editing, 'zones')}" placeholder="Ej. Manantiales, Docta"></label>
      <label>Finalidad<select name="purpose">${compactOptions(['Vivir', 'Invertir', 'Otra'], editing?.purpose)}</select></label>
      <label>Plazo o urgencia<select name="purchaseTimeframe">${compactOptions(['Inmediato', '0-3 meses', '3-6 meses', 'Más adelante', 'Sin apuro'], editing?.purchaseTimeframe)}</select></label>
      <label>Posibilidad actual de avanzar<select name="canMoveForward">${compactOptions(['Sí', 'Depende de vender', 'Depende del crédito', 'Todavía no', 'No confirmado'], editing?.canMoveForward)}</select></label>
      <label>¿Conoce la zona?<select name="knowsArea">${compactOptions(['Sí', 'Parcialmente', 'No'], editing?.knowsArea, 'Dato adicional no confirmado')}</select></label>
    </div>
  </details>`;
}

export function renderSecondaryQualificationFields(editing: Client | null): string {
  return `<details class="lead-form-more lead-form-secondary">
    <summary>Preferencias y datos opcionales</summary>
    <div class="lead-form-more-grid">
      <label>Tipo de propiedad<input name="propertyType" value="${value(editing, 'propertyType')}" placeholder="Ej. Dúplex, departamento"></label>
      <label>Dormitorios<input name="bedrooms" type="number" min="1" inputmode="numeric" value="${value(editing, 'bedrooms')}"></label>
      <label>Operación<select name="operation">${compactOptions(['Compra', 'Alquiler'], editing?.operation)}</select></label>
      <label>Cochera<select name="garage">${compactOptions(['Sí', 'No', 'Preferible'], editing?.garage)}</select></label>
      <label>Patio<select name="patio">${compactOptions(['Sí', 'No', 'Preferible'], editing?.patio)}</select></label>
      <label>Pileta<select name="pool">${compactOptions(['Sí', 'No', 'Preferible'], editing?.pool)}</select></label>
      <label>¿Requiere propiedad apto crédito?<select name="requiresCreditReady">${compactOptions(['Sí', 'No'], editing?.requiresCreditReady)}</select></label>
      <label class="lead-form-wide">Características<textarea name="features" placeholder="Solo lo que apareció naturalmente en la conversación">${value(editing, 'features')}</textarea></label>
      <label class="lead-form-wide">Preferencias<textarea name="preferences" placeholder="Preferencias flexibles del comprador">${value(editing, 'preferences')}</textarea></label>
      <label class="lead-form-wide">Objeciones o condicionantes<textarea name="objections" placeholder="Ej. Depende de vender, escritura o condición específica">${value(editing, 'objections')}</textarea></label>
      <label class="lead-form-wide">Notas internas<textarea name="notes" placeholder="Información comercial útil para el equipo">${value(editing, 'notes')}</textarea></label>
    </div>
  </details>`;
}
