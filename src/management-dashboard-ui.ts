import type { TeamMember } from './models.js';
import {
  buildManagementMetrics,
  type ManagementMetrics,
  type ManagementPeriodKey,
} from './management-metrics.js';
import { state } from './store.js';
import { currentTenantScope } from './tenant-runtime.js';

const STYLE_ID = 'ordenbroker-management-dashboard-style';
const PERIODS: Array<{ key: ManagementPeriodKey; label: string }> = [
  { key: 'today', label: 'Hoy' },
  { key: 'last7', label: '7 días' },
  { key: 'last30', label: '30 días' },
  { key: 'thisMonth', label: 'Este mes' },
];

let selectedPeriod: ManagementPeriodKey = 'last30';
let selectedBrokerId: number | null = null;

function installStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = '/src/management-dashboard.css?v=20261001-2i-1';
  document.head.append(link);
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char] || char));
}

function duration(minutes: number | null): string {
  if (minutes === null) return 'Sin dato';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function number(value: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(value);
}

function metricCard(label: string, value: string, detail = ''): string {
  return `<article class="mg-card"><span>${esc(label)}</span><strong>${esc(value)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</article>`;
}

function maxCount(values: Array<{ count: number }>): number {
  return Math.max(1, ...values.map((value) => value.count));
}

function empty(message: string): string {
  return `<p class="mg-empty">${esc(message)}</p>`;
}

export function managementDashboardMarkup(
  metrics: ManagementMetrics,
  members: readonly TeamMember[],
): string {
  const score = metrics.scorecard;
  const noActivity = score.leadsReceived === 0
    && score.visitsCompleted === 0
    && score.offers === 0
    && score.reservations === 0
    && score.closures === 0;
  const funnelMax = maxCount(metrics.funnel);
  const pipelineMax = maxCount(metrics.pipeline);
  const activeMembers = members.filter((member) => member.status === 'Activo');

  return `<div class="management-dashboard" data-management-dashboard>
    <header class="mg-header">
      <div><span class="eyebrow">Control del negocio</span><h2>Gestión</h2><p>Qué entra, qué avanza, qué se frena y dónde intervenir.</p></div>
      <div class="mg-filters" aria-label="Filtros de gestión">
        <div class="mg-periods" role="group" aria-label="Período">
          ${PERIODS.map((period) => `<button type="button" data-management-period="${period.key}" class="${metrics.period.key === period.key ? 'active' : ''}" aria-pressed="${metrics.period.key === period.key}">${period.label}</button>`).join('')}
        </div>
        <label>Corredor
          <select data-management-broker>
            <option value="">Todos</option>
            ${activeMembers.map((member) => `<option value="${member.id}" ${metrics.brokerId === member.id ? 'selected' : ''}>${esc(member.name)}</option>`).join('')}
          </select>
        </label>
      </div>
    </header>
    ${noActivity ? '<div class="mg-period-empty">Todavía no hay actividad comercial en este período.</div>' : ''}
    <section class="mg-scorecard" aria-label="Indicadores principales">
      ${metricCard('Leads recibidos', number(score.leadsReceived))}
      ${metricCard('Leads atendidos', number(score.leadsAttended))}
      ${metricCard('Primera respuesta', duration(score.firstResponseMedianMinutes), score.firstResponseMedianMinutes === null ? 'Sin evidencia horaria suficiente' : 'Mediana')}
      ${metricCard('Visitas', number(score.visitsCompleted), `${score.visitsScheduled} coordinadas`)}
      ${metricCard('Ofertas', number(score.offers))}
      ${metricCard('Reservas', number(score.reservations))}
      ${metricCard('Cierres', number(score.closures))}
      ${metricCard('Conversión', `${number(score.conversionPct)}%`, 'Cierres / leads recibidos')}
    </section>
    ${metrics.dataQuality.firstResponseNote ? `<p class="mg-quality" role="note">${esc(metrics.dataQuality.firstResponseNote)}</p>` : ''}

    <section class="mg-section">
      <div class="mg-section-head"><div><span class="eyebrow">Embudo</span><h3>Avance comercial</h3></div><small>${esc(metrics.period.label)}</small></div>
      <div class="mg-funnel">
        ${metrics.funnel.map((step) => `<article><div><strong>${esc(step.label)}</strong><span>${number(step.count)}</span></div><div class="mg-bar"><i style="width:${Math.max(3, Math.round(step.count / funnelMax * 100))}%"></i></div>${step.conversionFromPreviousPct === null ? '' : `<small>${number(step.conversionFromPreviousPct)}% desde el paso anterior</small>`}</article>`).join('')}
      </div>
    </section>

    <div class="mg-two-columns">
      <section class="mg-section">
        <div class="mg-section-head"><div><span class="eyebrow">Equipo</span><h3>Actividad por corredor</h3></div></div>
        ${metrics.team.length ? `<div class="mg-table-wrap"><table class="mg-table"><thead><tr><th>Corredor</th><th>Leads</th><th>Atendidos</th><th>Respuesta</th><th>Visitas</th><th>Ofertas</th><th>Reservas</th><th>Cierres</th><th>Conv.</th></tr></thead><tbody>${metrics.team.map((row) => `<tr><th data-label="Corredor">${esc(row.name)}</th><td data-label="Leads">${row.leads}</td><td data-label="Atendidos">${row.attended}</td><td data-label="Respuesta">${duration(row.firstResponseMedianMinutes)}</td><td data-label="Visitas">${row.visits}</td><td data-label="Ofertas">${row.offers}</td><td data-label="Reservas">${row.reservations}</td><td data-label="Cierres">${row.closures}</td><td data-label="Conv.">${number(row.conversionPct)}%</td></tr>`).join('')}</tbody></table></div>` : empty('No hay equipo activo para mostrar.')}
      </section>

      <section class="mg-section">
        <div class="mg-section-head"><div><span class="eyebrow">Origen</span><h3>Qué canal genera negocio</h3></div></div>
        ${metrics.sources.length ? `<div class="mg-table-wrap"><table class="mg-table"><thead><tr><th>Origen</th><th>Leads</th><th>Visitas</th><th>Ofertas</th><th>Reservas</th><th>Cierres</th><th>Conv.</th></tr></thead><tbody>${metrics.sources.map((row) => `<tr><th data-label="Origen">${esc(row.source)}</th><td data-label="Leads">${row.leads}</td><td data-label="Visitas">${row.visits}</td><td data-label="Ofertas">${row.offers}</td><td data-label="Reservas">${row.reservations}</td><td data-label="Cierres">${row.closures}</td><td data-label="Conv.">${number(row.conversionPct)}%</td></tr>`).join('')}</tbody></table></div>` : empty('No hay orígenes con actividad en este período.')}
      </section>
    </div>

    <div class="mg-two-columns">
      <section class="mg-section">
        <div class="mg-section-head"><div><span class="eyebrow">Propiedades</span><h3>Requieren revisión</h3></div></div>
        ${metrics.propertyReviews.length ? `<div class="mg-review-list">${metrics.propertyReviews.map((item) => `<article><strong>${esc(item.label)}</strong><ul>${item.reasons.map((reason) => `<li>${esc(reason)}</li>`).join('')}</ul></article>`).join('')}</div>` : empty('No hay propiedades activas con señales claras de falta de movimiento.')}
      </section>

      <section class="mg-section">
        <div class="mg-section-head"><div><span class="eyebrow">Pipeline actual</span><h3>Distribución comercial</h3></div></div>
        <div class="mg-pipeline">${metrics.pipeline.map((row) => `<article><div><span>${esc(row.stage)}</span><strong>${row.count}</strong></div><div class="mg-bar"><i style="width:${Math.max(2, Math.round(row.count / pipelineMax * 100))}%"></i></div></article>`).join('')}</div>
      </section>
    </div>

    <section class="mg-section mg-money">
      <div class="mg-section-head"><div><span class="eyebrow">Comisiones cerradas</span><h3>Ingresos registrados</h3></div><small>Sin conversión de moneda</small></div>
      <div class="mg-money-grid">
        ${metricCard('USD', `USD ${number(score.commissions.USD)}`)}
        ${metricCard('ARS', `ARS ${number(score.commissions.ARS)}`)}
      </div>
    </section>
  </div>`;
}

function bind(container: HTMLElement): void {
  if (container.dataset.managementBound === 'true') return;
  container.dataset.managementBound = 'true';
  container.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-management-period]');
    if (!button) return;
    const value = button.dataset.managementPeriod as ManagementPeriodKey;
    if (!PERIODS.some((period) => period.key === value)) return;
    selectedPeriod = value;
    renderManagementDashboard(container);
  });
  container.addEventListener('change', (event) => {
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-management-broker]');
    if (!select) return;
    selectedBrokerId = select.value ? Number(select.value) : null;
    renderManagementDashboard(container);
  });
}

export function renderManagementDashboard(container: HTMLElement): void {
  installStyles();
  bind(container);
  const scope = currentTenantScope();
  if (!scope) {
    container.innerHTML = '<div class="mg-access-error">No se pudo verificar el acceso a Gestión.</div>';
    return;
  }
  try {
    const metrics = buildManagementMetrics({
      crm: state.crm,
      scope,
      period: selectedPeriod,
      brokerId: selectedBrokerId,
    });
    container.innerHTML = managementDashboardMarkup(metrics, state.crm.teamMembers);
  } catch {
    container.innerHTML = '<div class="mg-access-error">No tenés acceso a métricas globales de esta inmobiliaria.</div>';
  }
}
