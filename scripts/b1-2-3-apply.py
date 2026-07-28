from pathlib import Path


def replace_between(text: str, start: str, end: str, replacement: str) -> str:
    left = text.find(start)
    if left < 0:
        raise SystemExit(f'No se encontró inicio: {start}')
    right = text.find(end, left)
    if right < 0:
        raise SystemExit(f'No se encontró fin: {end}')
    return text[:left] + replacement + text[right:]


ui_path = Path('src/mvp-leads-ui.ts')
ui = ui_path.read_text()
ui = ui.replace(
    "  filterLeads,\n  isTerminalClient,\n  localIsoDate,\n  stageCounters,\n  type LeadFilters,",
    "  completeClientFollowUp,\n  filterLeads,\n  isTerminalClient,\n  localIsoDate,\n  reprogramClientFollowUp,\n  stageCounters,\n  type LeadFilters,",
    1,
)
ui = ui.replace(
    "import type { ActivityEntry, Client, CommercialStage, Temperature } from './models.js';",
    "import type { ActivityEntry, Client, CommercialStage, Temperature } from './models.js';\nimport {\n  leadCompactPayment,\n  leadCompactTimeframe,\n  leadFollowUpPresentation,\n  leadPrimaryAlert,\n  sortLeadsForDailyWork,\n  type LeadOrder,\n} from './lead-daily-priority.js';",
    1,
)
old_filters = """let filters: LeadFilters = {
  search: '',
  stage: 'Todas',
  temperature: 'Todas',
  overdueOnly: false,
  missingNextActionOnly: false,
};"""
new_filters = """interface LeadUiFilters extends LeadFilters {
  assigneeId: number | 'Todos';
  order: LeadOrder;
}

let filters: LeadUiFilters = {
  search: '',
  stage: 'Todas',
  temperature: 'Todas',
  overdueOnly: false,
  missingNextActionOnly: false,
  assigneeId: 'Todos',
  order: 'Prioridad',
};
let expandedLeadId: number | null = null;"""
if old_filters not in ui:
    raise SystemExit('No se encontró el estado de filtros.')
ui = ui.replace(old_filters, new_filters, 1)
ui = ui.replace(
    "function leadRows(): Client[] {\n  return filterLeads(visibleClients(), filters);\n}",
    """function leadRows(): Client[] {
  const filtered = filterLeads(visibleClients(), filters)
    .filter((client) => filters.assigneeId === 'Todos' || client.assignedToId === filters.assigneeId);
  return sortLeadsForDailyWork(filtered, filters.order);
}""",
    1,
)

card_block = r'''function summaryValue(valueText: string | undefined, fallback = 'Sin definir'): string {
  return escapeHtml(valueText?.trim() || fallback);
}

function formattedLeadDate(valueText: string | undefined): string {
  if (!valueText) return 'Sin fecha';
  const date = new Date(`${valueText}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? valueText : dateFormatter.format(date);
}

function qualificationUpdated(client: Client): string {
  if (!client.qualificationUpdatedAt) return 'Sin actualización registrada';
  const date = new Date(client.qualificationUpdatedAt);
  return Number.isNaN(date.getTime()) ? client.qualificationUpdatedAt : activityFormatter.format(date);
}

function detailValue(label: string, valueText: string | number | undefined, fallback = 'No confirmado'): string {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(valueText ?? '').trim() || fallback)}</strong></div>`;
}

function fullProfile(client: Client): string {
  const credit = [client.creditPossible?.trim(), client.creditApprovedAmount?.trim()].filter(Boolean).join(' · ') || 'No confirmado';
  return `<section class="mvp-lead-full-profile" data-full-profile="${client.id}">
    <div class="mvp-lead-full-grid">
      ${detailValue('Zona', client.zones)}
      ${detailValue('Finalidad', client.purpose)}
      ${detailValue('Puede avanzar', client.canMoveForward)}
      ${detailValue('Conoce la zona', client.knowsArea, 'Dato adicional no confirmado')}
      ${detailValue('Crédito', credit)}
      ${detailValue('Responsable', memberName(client.assignedToId), 'Sin asignar')}
      ${detailValue('Preferencias', client.preferences)}
      ${detailValue('Características', client.features)}
      ${detailValue('Objeciones', client.objections)}
      ${detailValue('Notas', client.notes)}
      ${detailValue('Actualización', qualificationUpdated(client))}
    </div>
    ${renderLeadSecondaryMeta(client)}
    ${renderLeadCommercialSummary(client)}
    ${historyBlock(client)}
    ${matchesForLead(client)}
    <aside class="mvp-buyer-evolution-note"><strong>Próxima fase</strong><span>Las propiedades compatibles podrán registrar Enviar al cliente, Ya enviada, Le interesó, No le interesó y Quiere visita sin improvisar estados en este PR.</span></aside>
  </section>`;
}

function compactBudget(client: Client): string {
  const budget = client.budget?.trim() || 'Sin presupuesto';
  if (!client.currency?.trim() || /\b(?:USD|ARS|EUR|US\$|d[oó]lares?|pesos?)\b/i.test(budget)) return budget;
  return `${client.currency.trim()} ${budget}`;
}

function quickFollowUpActions(client: Client): string {
  if (isTerminalClient(client)) return '';
  if (!client.nextAction?.trim() && !client.nextFollowUp) return '';
  return `<div class="mvp-lead-followup-actions">
    ${client.nextAction?.trim() && client.nextFollowUp ? `<button type="button" class="secondary mvp-compact-action" data-complete-followup="${client.id}">Completar</button>` : ''}
    <button type="button" class="secondary mvp-compact-action" data-reprogram-followup="${client.id}">Reprogramar</button>
  </div>`;
}

function card(client: Client): string {
  const digits = client.phone.replace(/\D/g, '');
  const stage = commercialStage(client);
  const terminal = isTerminalClient(client);
  const alert = leadPrimaryAlert(client);
  const followUp = leadFollowUpPresentation(client);
  const expanded = expandedLeadId === client.id;
  return `<article class="mvp-lead-card mvp-lead-card-with-matches mvp-lead-daily-card${terminal ? ' terminal' : ''}${expanded ? ' expanded' : ''}" data-lead-card="${client.id}">
    <div class="mvp-lead-compact-head">
      <div class="mvp-lead-title-line">${tempIcon(client.temperature)}<h3>${escapeHtml(client.name)}</h3><span class="mvp-stage-badge${terminal ? ' terminal' : ''}">${escapeHtml(stage)}</span></div>
      <span class="mvp-lead-alert ${alert.kind}">${escapeHtml(alert.label)}</span>
    </div>
    <p class="mvp-lead-interest">${client.interest ? escapeHtml(client.interest) : 'Sin interés definido'}</p>
    <div class="mvp-lead-compact-grid">
      <div><span>Presupuesto</span><strong>${escapeHtml(compactBudget(client))}</strong></div>
      <div><span>Pago / crédito</span><strong>${escapeHtml(leadCompactPayment(client))}</strong></div>
      <div><span>Plazo / urgencia</span><strong>${escapeHtml(leadCompactTimeframe(client))}</strong></div>
    </div>
    ${followUp ? `<div class="mvp-lead-next${followUp.overdue ? ' overdue' : ''}"><span>Próxima acción</span><strong>${escapeHtml(followUp.action)}</strong>${followUp.date ? `<small>${escapeHtml(followUp.date)}</small>` : ''}</div>` : ''}
    <div class="mvp-lead-quick-row">
      <div class="mvp-lead-contact"><a class="mvp-contact-btn wa" href="https://wa.me/${digits}" target="_blank" rel="noopener noreferrer" title="WhatsApp · ${escapeHtml(formatPhone(client.phone))}" aria-label="Enviar WhatsApp">${appIcons.whatsapp}</a><a class="mvp-contact-btn call" href="tel:+${digits}" title="Llamar · ${escapeHtml(formatPhone(client.phone))}" aria-label="Llamar">${appIcons.phone}</a>${client.email ? `<a class="mvp-contact-btn mail" href="mailto:${escapeHtml(client.email)}" title="${escapeHtml(client.email)}" aria-label="Enviar email">${appIcons.mail}</a>` : ''}</div>
      <button type="button" class="secondary mvp-auto-qualify-button" data-auto-qualify-client="${client.id}">Calificar automáticamente</button>
    </div>
    ${quickFollowUpActions(client)}
    <div class="mvp-lead-disclosure-row">
      <button type="button" class="secondary mvp-lead-toggle" data-toggle-lead-full="${client.id}" aria-expanded="${expanded}">${expanded ? 'Ocultar ficha' : 'Ver ficha completa'}</button>
      <details class="mvp-lead-card-menu"><summary aria-label="Más acciones">•••</summary><div><button type="button" class="secondary mvp-icon-btn" data-edit-client="${client.id}" aria-controls="mvp-lead-form" title="Editar" aria-label="Editar ${escapeHtml(client.name)}">${appIcons.edit}</button><button type="button" class="delete mvp-icon-btn" data-delete="clients" data-id="${client.id}" title="Eliminar" aria-label="Eliminar ${escapeHtml(client.name)}">×</button></div></details>
    </div>
    ${expanded ? fullProfile(client) : ''}
    ${renderLeadQualificationPanel(client)}
  </article>`;
}

'''
ui = replace_between(ui, 'function summaryValue(', 'function focusLeadForm', card_block + 'function focusLeadForm')

bind_block = r'''function bindLeadCardActions(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>('[data-toggle-lead-full]').forEach((button) => {
    button.addEventListener('click', () => {
      const clientId = Number(button.dataset.toggleLeadFull);
      if (!clientId || !visibleClients().some((client) => client.id === clientId)) return;
      expandedLeadId = expandedLeadId === clientId ? null : clientId;
      renderMvpLeads(container);
      if (expandedLeadId) window.requestAnimationFrame(() => container.querySelector(`[data-lead-card="${expandedLeadId}"]`)?.scrollIntoView({ block: 'nearest' }));
    });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-complete-followup]').forEach((button) => {
    button.addEventListener('click', () => {
      const clientId = Number(button.dataset.completeFollowup);
      const client = visibleClients().find((item) => item.id === clientId);
      if (!client) return;
      const completed = completeClientFollowUp(client);
      state.crm.clients = upsertClient(state.crm.clients, completed.client);
      addActivity(completed.activity);
      saveData(`Seguimiento completado: ${client.name}`);
      renderMvpLeads(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-reprogram-followup]').forEach((button) => {
    button.addEventListener('click', () => {
      const clientId = Number(button.dataset.reprogramFollowup);
      const client = visibleClients().find((item) => item.id === clientId);
      if (!client) return;
      const date = window.prompt('Nueva fecha de seguimiento (AAAA-MM-DD)', client.nextFollowUp || localIsoDate());
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const reprogrammed = reprogramClientFollowUp(client, date);
      state.crm.clients = upsertClient(state.crm.clients, reprogrammed.client);
      addActivity(reprogrammed.activity);
      saveData(`Seguimiento reprogramado: ${client.name}`);
      renderMvpLeads(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-edit-client]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const clientId = Number(button.dataset.editClient);
      if (!clientId || !visibleClients().some((client) => client.id === clientId)) return;
      state.editingClientId = clientId;
      state.openForms.client = true;
      renderMvpLeads(container);
      focusLeadForm(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-auto-qualify-client]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const clientId = Number(button.dataset.autoQualifyClient);
      if (!clientId || !visibleClients().some((client) => client.id === clientId)) return;
      requestLeadQualification(clientId);
    });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-open-match-property]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const propertyId = Number(button.dataset.openMatchProperty);
      if (!propertyId || !visibleProperties().some((property) => property.id === propertyId)) return;
      state.activeModule = 'propiedades';
      state.editingPropertyId = propertyId;
      state.openForms.property = true;
      document.dispatchEvent(new CustomEvent('trv-render'));
      window.requestAnimationFrame(() => document.querySelector('#mvp-property-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
  });
  visibleClients().forEach((client) => bindLeadQualificationPanel(container, client, () => renderMvpLeads(container)));
}

function updateLeadResults(container: HTMLElement): void {
  const leads = leadRows();
  if (expandedLeadId && !leads.some((client) => client.id === expandedLeadId)) expandedLeadId = null;
  const results = container.querySelector<HTMLElement>('#mvp-lead-results');
  const count = container.querySelector<HTMLElement>('#mvp-lead-count');
  if (results) results.innerHTML = leads.map(card).join('') || '<p class="empty-state">No hay leads para mostrar con estos filtros.</p>';
  if (count) count.textContent = `${leads.length} de ${visibleClients().length} leads`;
  bindLeadCardActions(container);
}

'''
ui = replace_between(ui, 'function bindLeadCardActions(', 'function stageOptions', bind_block + 'function stageOptions')

filter_block = r'''function availableAssignees(): Array<{ id: number; name: string }> {
  const visibleIds = new Set(visibleClients().map((client) => client.assignedToId).filter((id): id is number => Boolean(id)));
  return state.crm.teamMembers
    .filter((member) => member.status === 'Activo' && visibleIds.has(member.id))
    .map((member) => ({ id: member.id, name: memberName(member.id) }));
}

function activeSecondaryFilters(): string[] {
  const active: string[] = [];
  if (filters.stage !== 'Todas') active.push(`Etapa: ${filters.stage}`);
  if (filters.temperature !== 'Todas') active.push(`Temperatura: ${filters.temperature}`);
  if (filters.overdueOnly) active.push('Vencidos');
  if (filters.missingNextActionOnly) active.push('Sin próxima acción');
  if (filters.assigneeId !== 'Todos') active.push(`Responsable: ${memberName(filters.assigneeId)}`);
  if (filters.order !== 'Prioridad') active.push(`Orden: ${filters.order}`);
  return active;
}

function filterPanel(): string {
  const visible = visibleClients();
  const counters = stageCounters(visible);
  const active = activeSecondaryFilters();
  const assignees = availableAssignees();
  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 520px)').matches;
  const open = !mobile || active.length > 0;
  return `<div class="mvp-lead-filter-panel">
    <div class="mvp-lead-filter-primary">
      <label class="mvp-lead-search-field"><span>Buscar</span><input id="mvp-lead-search" type="search" value="${escapeHtml(filters.search)}" placeholder="Nombre, WhatsApp o interés"></label>
      <strong id="mvp-lead-count">${leadRows().length} de ${visible.length} leads</strong>
    </div>
    <details class="mvp-lead-more-filters"${open ? ' open' : ''}>
      <summary><span>Más filtros${active.length ? ` · ${active.length}` : ''}</span><small>${escapeHtml(active.length ? active.join(' · ') : 'Etapa, temperatura, responsable y orden')}</small></summary>
      <div class="mvp-lead-filter-grid">
        <label><span>Etapa</span><select id="mvp-lead-stage-filter"><option value="Todas">Todas</option>${COMMERCIAL_STAGES.map((stage) => `<option value="${stage}"${selected(filters.stage, stage)}>${stage}</option>`).join('')}</select></label>
        <label><span>Temperatura</span><select id="mvp-lead-temperature-filter"><option value="Todas">Todas</option>${(['Caliente', 'Tibio', 'Frío'] as Temperature[]).map((temperature) => `<option value="${temperature}"${selected(filters.temperature, temperature)}>${temperature}</option>`).join('')}</select></label>
        ${assignees.length > 1 ? `<label><span>Responsable</span><select id="mvp-lead-assignee-filter"><option value="Todos">Todos</option>${assignees.map((member) => `<option value="${member.id}"${filters.assigneeId === member.id ? ' selected' : ''}>${escapeHtml(member.name)}</option>`).join('')}</select></label>` : ''}
        <label><span>Ordenar por</span><select id="mvp-lead-order"><option value="Prioridad"${selected(filters.order, 'Prioridad')}>Prioridad</option><option value="Seguimiento"${selected(filters.order, 'Seguimiento')}>Seguimiento</option><option value="Más recientes"${selected(filters.order, 'Más recientes')}>Más recientes</option><option value="Nombre"${selected(filters.order, 'Nombre')}>Nombre</option></select></label>
      </div>
      <div class="mvp-lead-filter-toggles"><label><input id="mvp-lead-overdue-filter" type="checkbox"${filters.overdueOnly ? ' checked' : ''}>Seguimientos vencidos</label><label><input id="mvp-lead-missing-action-filter" type="checkbox"${filters.missingNextActionOnly ? ' checked' : ''}>Sin próxima acción</label>${active.length ? '<button type="button" class="secondary mvp-clear-lead-filters" data-clear-lead-filters>Limpiar</button>' : ''}</div>
    </details>
    <div class="mvp-stage-counters-shell" data-pipeline-shell><div class="mvp-stage-counters" aria-label="Contadores por etapa"><button type="button" class="mvp-stage-counter${filters.stage === 'Todas' ? ' active' : ''}" data-stage-quick="Todas">Todos <b>${visible.length}</b></button>${COMMERCIAL_STAGES.map((stage) => `<button type="button" class="mvp-stage-counter${filters.stage === stage ? ' active' : ''}" data-stage-quick="${stage}">${stage} <b>${counters[stage]}</b></button>`).join('')}</div></div>
  </div>`;
}

function bindPipelineScroll(container: HTMLElement): void {
  const shell = container.querySelector<HTMLElement>('[data-pipeline-shell]');
  const pipeline = shell?.querySelector<HTMLElement>('.mvp-stage-counters');
  if (!shell || !pipeline) return;
  const update = (): void => {
    shell.classList.toggle('has-left', pipeline.scrollLeft > 2);
    shell.classList.toggle('has-right', pipeline.scrollLeft + pipeline.clientWidth < pipeline.scrollWidth - 2);
  };
  pipeline.addEventListener('scroll', update, { passive: true });
  const selectedChip = pipeline.querySelector<HTMLElement>('.mvp-stage-counter.active');
  selectedChip?.scrollIntoView({ block: 'nearest', inline: 'center' });
  window.requestAnimationFrame(update);
}

function bindFilters(container: HTMLElement): void {
  container.querySelector<HTMLInputElement>('#mvp-lead-search')?.addEventListener('input', (event) => {
    filters.search = (event.currentTarget as HTMLInputElement).value;
    updateLeadResults(container);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-stage-filter')?.addEventListener('change', (event) => {
    filters.stage = (event.currentTarget as HTMLSelectElement).value as LeadFilters['stage'];
    renderMvpLeads(container);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-temperature-filter')?.addEventListener('change', (event) => {
    filters.temperature = (event.currentTarget as HTMLSelectElement).value as LeadFilters['temperature'];
    updateLeadResults(container);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-assignee-filter')?.addEventListener('change', (event) => {
    const current = (event.currentTarget as HTMLSelectElement).value;
    filters.assigneeId = current === 'Todos' ? 'Todos' : Number(current);
    updateLeadResults(container);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-order')?.addEventListener('change', (event) => {
    filters.order = (event.currentTarget as HTMLSelectElement).value as LeadOrder;
    updateLeadResults(container);
  });
  container.querySelector<HTMLInputElement>('#mvp-lead-overdue-filter')?.addEventListener('change', (event) => {
    filters.overdueOnly = (event.currentTarget as HTMLInputElement).checked;
    updateLeadResults(container);
  });
  container.querySelector<HTMLInputElement>('#mvp-lead-missing-action-filter')?.addEventListener('change', (event) => {
    filters.missingNextActionOnly = (event.currentTarget as HTMLInputElement).checked;
    updateLeadResults(container);
  });
  container.querySelector<HTMLElement>('[data-clear-lead-filters]')?.addEventListener('click', () => {
    filters = { search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false, assigneeId: 'Todos', order: 'Prioridad' };
    renderMvpLeads(container);
  });
  container.querySelectorAll<HTMLButtonElement>('[data-stage-quick]').forEach((button) => {
    button.addEventListener('click', () => {
      filters.stage = button.dataset.stageQuick as LeadFilters['stage'];
      renderMvpLeads(container);
    });
  });
  bindPipelineScroll(container);
}

'''
ui = replace_between(ui, 'function activeSecondaryFilters(', 'export function renderMvpLeads', filter_block + 'export function renderMvpLeads')
ui = ui.replace(
    "export function resetLeadFiltersForTests(): void {\n  filters = { search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false };\n}",
    """export function resetLeadFiltersForTests(): void {
  filters = { search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false, assigneeId: 'Todos', order: 'Prioridad' };
  expandedLeadId = null;
}""",
    1,
)
ui_path.write_text(ui)

team_path = Path('src/team-access.ts')
team = team_path.read_text().replace("if (!memberId) return 'Sin responsable';", "if (!memberId) return 'Sin asignar';", 1).replace("if (!member) return 'Usuario inactivo';", "if (!member) return 'Sin asignar';", 1)
team_path.write_text(team)

base_css = Path('src/lead-pipeline.css')
base = base_css.read_text()
marker = '/* B1.2.3 — Leads compactos y priorizados */'
if marker not in base:
    base += r'''

/* B1.2.3 — Leads compactos y priorizados */
.mvp-stage-counters-shell { position:relative; min-width:0; overflow:hidden; }
.mvp-stage-counters-shell::before,.mvp-stage-counters-shell::after { content:''; position:absolute; z-index:2; top:0; bottom:0; width:24px; pointer-events:none; opacity:0; transition:opacity .18s ease; }
.mvp-stage-counters-shell::before { left:0; background:linear-gradient(90deg,#fff,rgba(255,255,255,0)); }
.mvp-stage-counters-shell::after { right:0; background:linear-gradient(270deg,#fff,rgba(255,255,255,0)); }
.mvp-stage-counters-shell.has-left::before,.mvp-stage-counters-shell.has-right::after { opacity:1; }
.mvp-lead-daily-card { align-content:start; }
.mvp-lead-compact-head { display:grid; gap:8px; min-width:0; }
.mvp-lead-alert { display:inline-flex; width:max-content; max-width:100%; min-height:28px; align-items:center; padding:5px 9px; border-radius:999px; font-size:.7rem; font-weight:900; line-height:1.2; }
.mvp-lead-alert.danger { color:#8b2434; background:#fde9ed; }
.mvp-lead-alert.warning { color:#7a4f12; background:#fff0d7; }
.mvp-lead-alert.today { color:#174f71; background:#e3f2fb; }
.mvp-lead-alert.success { color:#246049; background:#e3f3eb; }
.mvp-lead-alert.neutral { color:#53636b; background:#edf2f4; }
.mvp-lead-interest { margin:0; color:#536c78; line-height:1.38; word-break:normal; overflow-wrap:break-word; }
.mvp-lead-compact-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.mvp-lead-compact-grid > div,.mvp-lead-next { min-width:0; padding:10px; border:1px solid #e0e8eb; border-radius:11px; background:#f9fbfc; }
.mvp-lead-compact-grid span,.mvp-lead-next > span,.mvp-lead-full-grid span { display:block; margin-bottom:4px; color:#71828b; font-size:.62rem; font-weight:900; letter-spacing:.04em; text-transform:uppercase; }
.mvp-lead-compact-grid strong,.mvp-lead-next strong,.mvp-lead-full-grid strong { display:block; min-width:0; color:#294754; font-size:.78rem; line-height:1.3; word-break:normal; overflow-wrap:break-word; }
.mvp-lead-next { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:3px 10px; border-left:4px solid #4b7b67; }
.mvp-lead-next > span { grid-column:1/-1; }
.mvp-lead-next small { color:#667b86; font-size:.72rem; font-weight:800; white-space:nowrap; }
.mvp-lead-next.overdue { border-left-color:#b94b5b; background:#fff7f8; }
.mvp-lead-quick-row,.mvp-lead-disclosure-row,.mvp-lead-followup-actions { display:flex; align-items:center; justify-content:space-between; gap:9px; min-width:0; }
.mvp-lead-quick-row .mvp-lead-contact { margin:0; }
.mvp-lead-quick-row .mvp-auto-qualify-button { min-height:44px; }
.mvp-lead-followup-actions { justify-content:flex-start; }
.mvp-compact-action,.mvp-lead-toggle,.mvp-clear-lead-filters { min-height:44px; }
.mvp-lead-toggle { flex:1 1 auto; }
.mvp-lead-card-menu { position:relative; flex:0 0 auto; }
.mvp-lead-card-menu > summary { display:grid; width:44px; height:44px; place-items:center; border:1px solid #d8e3e8; border-radius:12px; color:#425d6b; background:#f8fafb; cursor:pointer; list-style:none; font-weight:900; }
.mvp-lead-card-menu > summary::-webkit-details-marker { display:none; }
.mvp-lead-card-menu > div { position:absolute; z-index:5; right:0; bottom:50px; display:flex; gap:7px; padding:7px; border:1px solid #d8e3e8; border-radius:13px; background:#fff; box-shadow:0 14px 34px rgba(20,44,54,.18); }
.mvp-lead-full-profile { display:grid; gap:11px; min-width:0; padding-top:12px; border-top:1px solid #dfe8eb; }
.mvp-lead-full-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.mvp-lead-full-grid > div { min-width:0; padding:10px; border:1px solid #e0e8eb; border-radius:10px; background:#f9fbfc; }
.mvp-buyer-evolution-note { display:grid; gap:4px; padding:10px 12px; border:1px dashed #b9c9cf; border-radius:11px; color:#5c707b; background:#f8fafb; font-size:.7rem; }
.mvp-buyer-evolution-note strong { color:#345360; }
.mvp-lead-filter-toggles .mvp-clear-lead-filters { margin-left:auto; }
@media(max-width:900px){.mvp-lead-full-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
'''
    base_css.write_text(base)

mobile_path = Path('src/mobile-leads-polish.css')
mobile = mobile_path.read_text()
if marker not in mobile:
    mobile += r'''

/* B1.2.3 — Leads compactos y priorizados */
@media (max-width:720px) {
  #crm .mvp-stage-counters-shell::before { background:linear-gradient(90deg,rgba(10,31,22,.98),rgba(10,31,22,0)); }
  #crm .mvp-stage-counters-shell::after { background:linear-gradient(270deg,rgba(10,31,22,.98),rgba(10,31,22,0)); }
  #crm .mvp-lead-daily-card:not(.expanded) { min-height:320px; max-height:450px; }
  #crm .mvp-lead-daily-card.expanded { max-height:none; overflow:visible; }
  #crm .mvp-lead-compact-head { gap:7px; }
  #crm .mvp-lead-alert { color:#f5f8f6; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.08); }
  #crm .mvp-lead-alert.danger { color:#ffd7de; background:rgba(185,75,91,.24); }
  #crm .mvp-lead-alert.warning { color:#ffe4b4; background:rgba(199,145,52,.2); }
  #crm .mvp-lead-alert.today { color:#d8efff; background:rgba(54,133,180,.22); }
  #crm .mvp-lead-alert.success { color:#d6f3e4; background:rgba(64,151,113,.22); }
  #crm .mvp-lead-interest { color:#bdcbc3; font-size:.92rem; }
  #crm .mvp-lead-compact-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
  #crm .mvp-lead-compact-grid > div:nth-child(3) { grid-column:1/-1; }
  #crm .mvp-lead-compact-grid > div,#crm .mvp-lead-next,#crm .mvp-lead-full-grid > div { border-color:rgba(255,255,255,.12); background:rgba(255,255,255,.055); }
  #crm .mvp-lead-compact-grid span,#crm .mvp-lead-next > span,#crm .mvp-lead-full-grid span { color:#91a69b; }
  #crm .mvp-lead-compact-grid strong,#crm .mvp-lead-next strong,#crm .mvp-lead-full-grid strong { color:#edf4f0; }
  #crm .mvp-lead-next small { color:#b8c8bf; white-space:normal; text-align:right; }
  #crm .mvp-lead-next.overdue { background:rgba(185,75,91,.12); }
  #crm .mvp-lead-quick-row { align-items:stretch; }
  #crm .mvp-lead-quick-row .mvp-auto-qualify-button { flex:1 1 auto; width:auto; }
  #crm .mvp-lead-followup-actions { flex-wrap:wrap; }
  #crm .mvp-lead-followup-actions .mvp-compact-action { flex:1 1 130px; }
  #crm .mvp-lead-toggle { color:#eaf1ed; border-color:rgba(255,255,255,.14); background:rgba(255,255,255,.055); }
  #crm .mvp-lead-card-menu > summary { color:#eaf1ed; border-color:rgba(255,255,255,.14); background:rgba(255,255,255,.055); }
  #crm .mvp-lead-card-menu > div { border-color:rgba(255,255,255,.14); background:#123126; }
  #crm .mvp-lead-full-profile { border-color:rgba(255,255,255,.12); }
  #crm .mvp-lead-full-grid { grid-template-columns:1fr; }
  #crm .mvp-buyer-evolution-note { color:#b6c6bd; border-color:rgba(255,255,255,.18); background:rgba(255,255,255,.045); }
  #crm .mvp-buyer-evolution-note strong { color:#edf4f0; }
  #crm .mvp-lead-filter-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  #crm .mvp-lead-filter-toggles .mvp-clear-lead-filters { width:100%; margin:0; }
}
@media (max-width:390px) {
  #crm .mvp-lead-daily-card:not(.expanded) { min-height:320px; max-height:450px; }
  #crm .mvp-lead-filter-grid { grid-template-columns:1fr; }
  #crm .mvp-lead-quick-row { flex-wrap:wrap; }
  #crm .mvp-lead-quick-row .mvp-auto-qualify-button { width:100%; }
}
'''
    mobile_path.write_text(mobile)

print('B1.2.3 aplicado')
