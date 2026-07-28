from pathlib import Path
import re

root = Path('.')

helper = r'''import type { Client, CommercialStage, TeamMember } from './models.js';
import { commercialQualificationState, commercialStage, isTerminalClient, localIsoDate } from './lead-pipeline.js';

export type LeadSort = 'priority' | 'followup' | 'recent' | 'name';

export interface LeadAlert {
  label: string;
  kind: 'danger' | 'warning' | 'info' | 'success' | 'muted';
  rank: number;
}

function dayNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 86_400_000);
}

function todayNumber(today = localIsoDate()): number {
  return dayNumber(today) ?? Math.floor(Date.now() / 86_400_000);
}

export function relativeCommercialDate(value: string | undefined, today = localIsoDate()): string {
  const target = dayNumber(value);
  if (target === null) return 'Sin fecha';
  const delta = target - todayNumber(today);
  if (delta === 0) return 'Hoy';
  if (delta === 1) return 'Mañana';
  if (delta === -1) return 'Vencido ayer';
  if (delta < -1) return `Vencido hace ${Math.abs(delta)} días`;
  if (delta > 1 && delta <= 7) return `En ${delta} días`;
  const [year, month, day] = value!.split('-');
  return `${day}/${month}/${year}`;
}

export function followUpDisplay(client: Client, today = localIsoDate()): { action: string; date: string; pending: boolean } {
  if (isTerminalClient(client)) return { action: '', date: '', pending: false };
  const action = client.nextAction?.trim();
  const date = client.nextFollowUp;
  if (action && date) return { action, date: relativeCommercialDate(date, today), pending: true };
  if (date) return { action: 'Definir acción', date: `${relativeCommercialDate(date, today)} · falta detalle`, pending: true };
  if (action) return { action, date: 'Falta programar fecha', pending: true };
  return { action: 'Sin próxima acción', date: '', pending: false };
}

function stageIs(client: Client, stage: CommercialStage): boolean {
  return commercialStage(client) === stage;
}

export function primaryLeadAlert(client: Client, today = localIsoDate()): LeadAlert {
  const followUp = dayNumber(client.nextFollowUp);
  const now = todayNumber(today);
  const qualification = commercialQualificationState(client).state;
  if (isTerminalClient(client)) {
    return { label: stageIs(client, 'Ganado') ? 'Operación ganada' : 'Operación perdida', kind: 'muted', rank: 90 };
  }
  if (followUp !== null && followUp < now) {
    const days = now - followUp;
    return { label: days === 1 ? 'Seguimiento vencido ayer' : `Seguimiento vencido hace ${days} días`, kind: 'danger', rank: 0 };
  }
  if (stageIs(client, 'Nuevo') && !client.lastContact) return { label: 'Nuevo sin contactar', kind: 'warning', rank: 1 };
  if (stageIs(client, 'Visita coordinada') && followUp === now) return { label: 'Visita hoy', kind: 'info', rank: 2 };
  if (followUp === now) return { label: 'Contactar hoy', kind: 'info', rank: 3 };
  if (stageIs(client, 'Calificado') && (!client.nextAction?.trim() || !client.nextFollowUp)) {
    return { label: 'Calificado sin seguimiento', kind: 'warning', rank: 4 };
  }
  if (qualification === 'Falta presupuesto') return { label: 'Falta presupuesto', kind: 'warning', rank: 5 };
  if (qualification === 'Falta forma de pago') return { label: 'Falta forma de pago', kind: 'warning', rank: 6 };
  if (qualification === 'Falta confirmar capacidad de avance') return { label: 'Falta confirmar capacidad de avance', kind: 'warning', rank: 7 };
  if (qualification === 'No listo todavía') return { label: 'No listo todavía', kind: 'muted', rank: 8 };
  if (!client.nextAction?.trim() || !client.nextFollowUp) return { label: 'Sin próxima acción', kind: 'muted', rank: 9 };
  if (qualification === 'Calificado') return { label: 'Calificado', kind: 'success', rank: 10 };
  return { label: 'Información inicial', kind: 'muted', rank: 11 };
}

function urgentDate(client: Client): number {
  return dayNumber(client.nextFollowUp) ?? Number.MAX_SAFE_INTEGER;
}

function temperatureRank(client: Client): number {
  return client.temperature === 'Caliente' ? 0 : client.temperature === 'Tibio' ? 1 : 2;
}

export function sortLeads(clients: Client[], sort: LeadSort, today = localIsoDate()): Client[] {
  return [...clients].sort((left, right) => {
    if (sort === 'name') return left.name.localeCompare(right.name, 'es');
    if (sort === 'recent') return (right.id || 0) - (left.id || 0);
    if (sort === 'followup') return urgentDate(left) - urgentDate(right) || left.name.localeCompare(right.name, 'es');
    const leftTerminal = isTerminalClient(left) ? 1 : 0;
    const rightTerminal = isTerminalClient(right) ? 1 : 0;
    if (leftTerminal !== rightTerminal) return leftTerminal - rightTerminal;
    const leftAlert = primaryLeadAlert(left, today);
    const rightAlert = primaryLeadAlert(right, today);
    if (leftAlert.rank !== rightAlert.rank) return leftAlert.rank - rightAlert.rank;
    const temperature = temperatureRank(left) - temperatureRank(right);
    if (temperature) return temperature;
    return urgentDate(left) - urgentDate(right) || left.name.localeCompare(right.name, 'es');
  });
}

function readableEmail(email: string | undefined): string {
  if (!email) return '';
  return email.split('@')[0]!.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function readableResponsible(
  client: Client,
  members: TeamMember[],
  profileName?: string,
  profileEmail?: string,
): string {
  const member = members.find((candidate) => candidate.id === client.assignedToId);
  const memberName = member?.name?.trim();
  if (memberName && !/^trv\s*gestion\s*inmobiliaria$/i.test(memberName)) return memberName;
  if (profileName?.trim() && !/^trv\s*gestion\s*inmobiliaria$/i.test(profileName.trim())) return profileName.trim();
  const email = member?.email || profileEmail;
  return readableEmail(email) || 'Sin asignar';
}
'''
(root / 'src/lead-list-priority.ts').write_text(helper)

css = r'''.mvp-lead-card.compact-lead-card{display:grid;gap:12px;padding:16px;min-width:0}.compact-lead-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.compact-lead-identity{min-width:0;display:grid;gap:6px}.compact-lead-identity h3{margin:0;overflow-wrap:normal;word-break:normal;hyphens:none}.compact-lead-alert{display:inline-flex;align-items:center;width:max-content;max-width:100%;min-height:28px;padding:4px 9px;border-radius:999px;font-size:.78rem;font-weight:800}.compact-lead-alert.danger{background:rgba(255,77,109,.16);color:#ff9aae}.compact-lead-alert.warning{background:rgba(255,190,74,.16);color:#ffd07d}.compact-lead-alert.info{background:rgba(70,166,255,.16);color:#93caff}.compact-lead-alert.success{background:rgba(52,211,153,.16);color:#82efc3}.compact-lead-alert.muted{background:rgba(148,163,184,.13);color:#cbd5e1}.compact-lead-interest{margin:0;font-size:.95rem;line-height:1.35;overflow-wrap:normal;word-break:normal}.compact-lead-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.compact-lead-facts>div,.compact-followup{display:grid;gap:3px;padding:9px 10px;border:1px solid rgba(148,163,184,.15);border-radius:12px;background:rgba(15,23,42,.24);min-width:0}.compact-lead-facts span,.compact-followup span{font-size:.7rem;color:var(--muted,#94a3b8);text-transform:uppercase;letter-spacing:.04em}.compact-lead-facts strong,.compact-followup strong{font-size:.86rem;line-height:1.3;overflow-wrap:break-word}.compact-followup{grid-template-columns:minmax(0,1fr) auto;align-items:center}.compact-followup-time{text-align:right;color:#dbeafe}.compact-lead-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.compact-lead-actions .mvp-auto-qualify-button{flex:1 1 190px}.compact-lead-secondary{display:flex;gap:8px;margin-left:auto}.compact-lead-toggle{width:100%;min-height:44px}.compact-lead-expanded{display:grid;gap:14px;padding-top:4px;border-top:1px solid rgba(148,163,184,.16)}.compact-lead-expanded[hidden]{display:none}.compact-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.compact-detail-grid>div{padding:9px 10px;border-radius:10px;background:rgba(15,23,42,.22)}.compact-detail-grid span{display:block;font-size:.72rem;color:var(--muted,#94a3b8);margin-bottom:3px}.compact-detail-grid strong,.compact-detail-grid p{margin:0;overflow-wrap:break-word}.compact-followup-menu summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700}.compact-followup-controls{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.compact-followup-controls label{flex:1 1 160px}.compact-followup-controls input{min-height:44px}.mvp-stage-counters{position:relative}.mvp-stage-counters.can-scroll-right{mask-image:linear-gradient(to right,#000 0,#000 calc(100% - 34px),transparent 100%)}.mvp-stage-counters.can-scroll-left{mask-image:linear-gradient(to right,transparent 0,#000 34px,#000 100%)}.mvp-stage-counters.can-scroll-left.can-scroll-right{mask-image:linear-gradient(to right,transparent 0,#000 34px,#000 calc(100% - 34px),transparent 100%)}.mvp-filter-active-summary{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:.78rem;color:var(--muted,#94a3b8)}.mvp-filter-clear{min-height:36px;padding:6px 10px}.mvp-result-order{min-width:150px}@media(max-width:520px){.mvp-lead-card.compact-lead-card{min-height:320px;max-height:none;padding:14px;gap:10px}.compact-lead-head{align-items:flex-start}.compact-lead-facts{grid-template-columns:1fr 1fr}.compact-lead-facts>div:last-child{grid-column:1/-1}.compact-followup{grid-template-columns:1fr}.compact-followup-time{text-align:left}.compact-lead-actions{display:grid;grid-template-columns:44px 44px 44px minmax(0,1fr);width:100%}.compact-lead-actions .mvp-auto-qualify-button{grid-column:1/-1;grid-row:2;width:100%}.compact-lead-secondary{grid-column:1/-1;margin-left:0;justify-content:flex-end}.compact-detail-grid{grid-template-columns:1fr}.compact-lead-expanded .mvp-lead-summary,.compact-lead-expanded .mvp-lead-summary-secondary{grid-template-columns:1fr 1fr}.compact-lead-expanded .mvp-lead-matches,.compact-lead-expanded .mvp-lead-history{margin-top:0}.compact-lead-toggle{font-size:.9rem}.compact-followup-controls{display:grid;grid-template-columns:1fr}.compact-followup-controls>*{width:100%}.mvp-result-order{width:100%}}
'''
(root / 'src/lead-list-compact.css').write_text(css)

path = root / 'index.html'
text = path.read_text()
link = '  <link rel="stylesheet" href="/src/lead-list-compact.css?v=20260728-1">\n'
if 'lead-list-compact.css' not in text:
    marker = '  <link rel="stylesheet" href="/src/mobile-leads-polish.css'
    index = text.find(marker)
    if index < 0: raise SystemExit('No se encontró mobile-leads-polish.css en index.html')
    text = text[:index] + link + text[index:]
path.write_text(text)

path = root / 'src/mvp-leads-ui.ts'
text = path.read_text()
text = text.replace("  filterLeads,\n  isTerminalClient,", "  filterLeads,\n  completeClientFollowUp,\n  isTerminalClient,\n  reprogramClientFollowUp,")
text = text.replace("import type { ActivityEntry, Client, CommercialStage, Temperature } from './models.js';", "import type { ActivityEntry, Client, CommercialStage, Temperature } from './models.js';\nimport { followUpDisplay, primaryLeadAlert, readableResponsible, relativeCommercialDate, sortLeads, type LeadSort } from './lead-list-priority.js';")
text = text.replace("let filters: LeadFilters = {", "type ExtendedLeadFilters = LeadFilters & { assignedTo: number | 'Todos'; order: LeadSort };\n\nlet expandedClientId: number | null = null;\n\nlet filters: ExtendedLeadFilters = {")
text = text.replace("  missingNextActionOnly: false,\n};", "  missingNextActionOnly: false,\n  assignedTo: 'Todos',\n  order: 'priority',\n};", 1)
text = re.sub(r"function leadRows\(\): Client\[\] \{.*?\n\}", """function leadRows(): Client[] {
  const filtered = filterLeads(visibleClients(), filters)
    .filter((client) => filters.assignedTo === 'Todos' || client.assignedToId === filters.assignedTo);
  return sortLeads(filtered, filters.order);
}""", text, count=1, flags=re.S)

card = r'''function expandedDetails(client: Client): string {
  const updated = client.qualificationUpdatedAt ? new Date(client.qualificationUpdatedAt) : null;
  const updatedText = updated && !Number.isNaN(updated.getTime()) ? activityFormatter.format(updated) : 'Sin fecha registrada';
  const responsible = readableResponsible(client, state.crm.teamMembers, state.crm.settings.profileName, state.crm.settings.profileEmail);
  const optional = [
    ['Zona', client.zones], ['Finalidad', client.purpose], ['Puede avanzar', client.canMoveForward],
    ['Conoce la zona', client.knowsArea], ['Crédito', client.creditPossible], ['Monto aprobado', client.creditApprovedAmount],
    ['Preferencias', client.preferences], ['Características', client.features], ['Objeciones', client.objections], ['Notas', client.notes],
  ].filter(([, item]) => String(item || '').trim());
  return `<div class="compact-lead-expanded" data-lead-expanded="${client.id}"${expandedClientId === client.id ? '' : ' hidden'}>
    ${renderLeadSecondaryMeta(client)}
    <div class="compact-detail-grid">${optional.map(([label, item]) => `<div><span>${escapeHtml(String(label))}</span><strong>${escapeHtml(String(item))}</strong></div>`).join('') || '<p>Sin información adicional cargada.</p>'}<div><span>Responsable</span><strong>${escapeHtml(responsible)}</strong></div><div><span>Última actualización</span><strong>${escapeHtml(updatedText)}</strong></div></div>
    ${renderLeadCommercialSummary(client)}
    ${historyBlock(client)}
    ${matchesForLead(client)}
    <p class="mvp-match-empty">Evolución futura: las propiedades compatibles podrán marcarse como Enviar, Ya enviada, Le interesó, No le interesó o Quiere visita sin improvisar persistencia en esta fase.</p>
  </div>`;
}

function card(client: Client): string {
  const digits = client.phone.replace(/\D/g, '');
  const stage = commercialStage(client);
  const terminal = isTerminalClient(client);
  const alert = primaryLeadAlert(client);
  const followUp = followUpDisplay(client);
  const payment = client.creditPossible?.trim() && client.paymentMethod?.includes('Crédito')
    ? `${client.paymentMethod} · ${client.creditPossible}` : client.paymentMethod?.trim() || client.creditPossible?.trim() || 'No confirmado';
  const urgency = [client.purchaseTimeframe, client.urgency].filter(Boolean).join(' · ') || 'No confirmado';
  return `<article class="mvp-lead-card compact-lead-card${terminal ? ' terminal' : ''}" data-client-id="${client.id}">
    <div class="compact-lead-head"><div class="compact-lead-identity"><div class="mvp-lead-title-line">${tempIcon(client.temperature)}<h3>${escapeHtml(client.name)}</h3></div><span class="mvp-stage-badge${terminal ? ' terminal' : ''}">${escapeHtml(stage)}</span></div><span class="compact-lead-alert ${alert.kind}">${escapeHtml(alert.label)}</span></div>
    <p class="compact-lead-interest">${client.interest ? escapeHtml(client.interest) : 'Sin búsqueda definida'}</p>
    <div class="compact-lead-facts"><div><span>Presupuesto</span><strong>${summaryValue(client.budget, 'No confirmado')}</strong></div><div><span>Pago / crédito</span><strong>${escapeHtml(payment)}</strong></div><div><span>Plazo / urgencia</span><strong>${escapeHtml(urgency)}</strong></div></div>
    ${terminal ? '' : `<div class="compact-followup"><div><span>Próxima acción</span><strong>${escapeHtml(followUp.action)}</strong></div><strong class="compact-followup-time">${escapeHtml(followUp.date)}</strong></div>`}
    <div class="compact-lead-actions"><a class="mvp-contact-btn wa" href="https://wa.me/${digits}" target="_blank" rel="noopener noreferrer" title="WhatsApp · ${escapeHtml(formatPhone(client.phone))}" aria-label="Enviar WhatsApp">${appIcons.whatsapp}</a><a class="mvp-contact-btn call" href="tel:+${digits}" title="Llamar · ${escapeHtml(formatPhone(client.phone))}" aria-label="Llamar">${appIcons.phone}</a>${client.email ? `<a class="mvp-contact-btn mail" href="mailto:${escapeHtml(client.email)}" title="${escapeHtml(client.email)}" aria-label="Enviar email">${appIcons.mail}</a>` : '<span class="mvp-contact-btn mail" data-disabled aria-label="Sin email cargado">' + appIcons.mail + '</span>'}<button type="button" class="secondary mvp-auto-qualify-button" data-auto-qualify-client="${client.id}">Calificar automáticamente</button><div class="compact-lead-secondary"><button type="button" class="secondary mvp-icon-btn" data-edit-client="${client.id}" title="Editar" aria-label="Editar ${escapeHtml(client.name)}">${appIcons.edit}</button><button type="button" class="delete mvp-icon-btn" data-delete="clients" data-id="${client.id}" title="Eliminar" aria-label="Eliminar ${escapeHtml(client.name)}">×</button></div></div>
    ${!terminal && followUp.pending ? `<details class="compact-followup-menu"><summary>Gestionar seguimiento</summary><div class="compact-followup-controls"><button type="button" class="secondary" data-complete-followup="${client.id}">Completar seguimiento</button><label>Nueva fecha<input type="date" data-reprogram-date="${client.id}" value="${escapeHtml(client.nextFollowUp || '')}"></label><button type="button" class="secondary" data-reprogram-followup="${client.id}">Reprogramar</button></div></details>` : ''}
    <button type="button" class="secondary compact-lead-toggle" data-toggle-lead-details="${client.id}">${expandedClientId === client.id ? 'Ocultar ficha' : 'Ver ficha completa'}</button>
    ${expandedDetails(client)}
    ${renderLeadQualificationPanel(client)}
  </article>`;
}'''
text = re.sub(r"function card\(client: Client\): string \{.*?\n\}", card, text, count=1, flags=re.S)

bind_insert = r'''  container.querySelectorAll<HTMLButtonElement>('[data-toggle-lead-details]').forEach((button) => {
    button.addEventListener('click', () => {
      const clientId = Number(button.dataset.toggleLeadDetails);
      expandedClientId = expandedClientId === clientId ? null : clientId;
      renderMvpLeads(container);
      if (expandedClientId) window.requestAnimationFrame(() => container.querySelector(`[data-client-id="${expandedClientId}"]`)?.scrollIntoView({ block: 'nearest' }));
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
      const input = container.querySelector<HTMLInputElement>(`[data-reprogram-date="${clientId}"]`);
      if (!client || !input?.value) return;
      const reprogrammed = reprogramClientFollowUp(client, input.value);
      state.crm.clients = upsertClient(state.crm.clients, reprogrammed.client);
      addActivity(reprogrammed.activity);
      saveData(`Seguimiento reprogramado: ${client.name}`);
      renderMvpLeads(container);
    });
  });
'''
text = text.replace("function bindLeadCardActions(container: HTMLElement): void {\n", "function bindLeadCardActions(container: HTMLElement): void {\n" + bind_insert, 1)

text = text.replace("  if (filters.missingNextActionOnly) active.push('Sin próxima acción');", "  if (filters.missingNextActionOnly) active.push('Sin próxima acción');\n  if (filters.assignedTo !== 'Todos') active.push(`Responsable: ${readableResponsible({ assignedToId: filters.assignedTo } as Client, state.crm.teamMembers, state.crm.settings.profileName, state.crm.settings.profileEmail)}`);\n  if (filters.order !== 'priority') active.push(`Orden: ${filters.order}`);")

panel = r'''function filterPanel(): string {
  const visible = visibleClients();
  const counters = stageCounters(visible);
  const active = activeSecondaryFilters();
  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 520px)').matches;
  const open = !mobile || active.length > 0;
  const members = state.crm.teamMembers.filter((member) => member.status === 'Activo');
  return `<div class="mvp-lead-filter-panel">
    <div class="mvp-lead-filter-primary"><label class="mvp-lead-search-field"><span>Buscar</span><input id="mvp-lead-search" type="search" value="${escapeHtml(filters.search)}" placeholder="Nombre, WhatsApp o interés"></label><strong id="mvp-lead-count">${leadRows().length} de ${visible.length} leads</strong></div>
    ${active.length ? `<div class="mvp-filter-active-summary"><b>${active.length} filtros activos</b><span>${escapeHtml(active.join(' · '))}</span><button type="button" class="secondary mvp-filter-clear" data-clear-lead-filters>Limpiar</button></div>` : ''}
    <details class="mvp-lead-more-filters"${open ? ' open' : ''}><summary><span>Más filtros</span><small>${escapeHtml(active.length ? active.join(' · ') : 'Etapa, temperatura, responsable y orden')}</small></summary><div class="mvp-lead-filter-grid">
      <label><span>Etapa</span><select id="mvp-lead-stage-filter"><option value="Todas">Todas</option>${COMMERCIAL_STAGES.map((stage) => `<option value="${stage}"${selected(filters.stage, stage)}>${stage}</option>`).join('')}</select></label>
      <label><span>Temperatura</span><select id="mvp-lead-temperature-filter"><option value="Todas">Todas</option>${(['Caliente', 'Tibio', 'Frío'] as Temperature[]).map((temperature) => `<option value="${temperature}"${selected(filters.temperature, temperature)}>${temperature}</option>`).join('')}</select></label>
      ${members.length > 1 ? `<label><span>Responsable</span><select id="mvp-lead-assigned-filter"><option value="Todos">Todos</option>${members.map((member) => `<option value="${member.id}"${filters.assignedTo === member.id ? ' selected' : ''}>${escapeHtml(member.name || member.email)}</option>`).join('')}</select></label>` : ''}
      <label><span>Ordenar por</span><select id="mvp-lead-order" class="mvp-result-order"><option value="priority"${selected(filters.order, 'priority')}>Prioridad</option><option value="followup"${selected(filters.order, 'followup')}>Seguimiento</option><option value="recent"${selected(filters.order, 'recent')}>Más recientes</option><option value="name"${selected(filters.order, 'name')}>Nombre</option></select></label>
    </div><div class="mvp-lead-filter-toggles"><label><input id="mvp-lead-overdue-filter" type="checkbox"${filters.overdueOnly ? ' checked' : ''}>Seguimientos vencidos</label><label><input id="mvp-lead-missing-action-filter" type="checkbox"${filters.missingNextActionOnly ? ' checked' : ''}>Sin próxima acción completa</label></div></details>
    <div class="mvp-stage-counters" aria-label="Contadores por etapa"><button type="button" class="mvp-stage-counter${filters.stage === 'Todas' ? ' active' : ''}" data-stage-quick="Todas">Todos <b>${visible.length}</b></button>${COMMERCIAL_STAGES.map((stage) => `<button type="button" class="mvp-stage-counter${filters.stage === stage ? ' active' : ''}" data-stage-quick="${stage}">${stage} <b>${counters[stage]}</b></button>`).join('')}</div>
  </div>`;
}'''
text = re.sub(r"function filterPanel\(\): string \{.*?\n\}", panel, text, count=1, flags=re.S)

extra_filters = r'''  container.querySelector<HTMLSelectElement>('#mvp-lead-assigned-filter')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    filters.assignedTo = value === 'Todos' ? 'Todos' : Number(value);
    renderMvpLeads(container);
  });
  container.querySelector<HTMLSelectElement>('#mvp-lead-order')?.addEventListener('change', (event) => {
    filters.order = (event.currentTarget as HTMLSelectElement).value as LeadSort;
    renderMvpLeads(container);
  });
  container.querySelector<HTMLButtonElement>('[data-clear-lead-filters]')?.addEventListener('click', () => {
    filters = { search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false, assignedTo: 'Todos', order: 'priority' };
    renderMvpLeads(container);
  });
  const pipeline = container.querySelector<HTMLElement>('.mvp-stage-counters');
  const updatePipelineEdges = (): void => {
    if (!pipeline) return;
    pipeline.classList.toggle('can-scroll-left', pipeline.scrollLeft > 2);
    pipeline.classList.toggle('can-scroll-right', pipeline.scrollLeft + pipeline.clientWidth < pipeline.scrollWidth - 2);
  };
  pipeline?.addEventListener('scroll', updatePipelineEdges, { passive: true });
  updatePipelineEdges();
'''
text = text.replace("function bindFilters(container: HTMLElement): void {\n", "function bindFilters(container: HTMLElement): void {\n" + extra_filters, 1)
text = text.replace("      renderMvpLeads(container);\n    });\n  });\n}", "      renderMvpLeads(container);\n      window.requestAnimationFrame(() => container.querySelector<HTMLElement>('.mvp-stage-counter.active')?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }));\n    });\n  });\n}", 1)

text = text.replace("  const leads = leadRows();\n  container.innerHTML", "  const leads = leadRows();\n  if (expandedClientId && !leads.some((client) => client.id === expandedClientId)) expandedClientId = null;\n  container.innerHTML", 1)
text = text.replace("filters = { search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false };", "filters = { search: '', stage: 'Todas', temperature: 'Todas', overdueOnly: false, missingNextActionOnly: false, assignedTo: 'Todos', order: 'priority' };\n  expandedClientId = null;")
path.write_text(text)

# Tests for deterministic business presentation rules.
test = r'''import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client, TeamMember } from '../models.js';
import { followUpDisplay, primaryLeadAlert, readableResponsible, relativeCommercialDate, sortLeads } from '../lead-list-priority.js';

const base: Client = { id: 1, name: 'Lead', phone: '3515550000', interest: 'Departamento', status: 'Lead', temperature: 'Tibio', pipeline: 'Contactado', assignedToId: 1 };

test('B1.2.3 calcula fechas comerciales comprensibles', () => {
  assert.equal(relativeCommercialDate('2026-07-28', '2026-07-28'), 'Hoy');
  assert.equal(relativeCommercialDate('2026-07-29', '2026-07-28'), 'Mañana');
  assert.equal(relativeCommercialDate('2026-07-23', '2026-07-28'), 'Vencido hace 5 días');
  assert.equal(relativeCommercialDate('2026-08-20', '2026-07-28'), '20/08/2026');
});

test('B1.2.3 resuelve inconsistencias de próxima acción sin borrar datos', () => {
  assert.deepEqual(followUpDisplay({ ...base, nextFollowUp: '2026-07-20' }, '2026-07-28'), { action: 'Definir acción', date: 'Vencido hace 8 días · falta detalle', pending: true });
  assert.deepEqual(followUpDisplay({ ...base, nextAction: 'Llamar' }, '2026-07-28'), { action: 'Llamar', date: 'Falta programar fecha', pending: true });
  assert.equal(followUpDisplay({ ...base, pipeline: 'Ganado', nextAction: 'No mostrar', nextFollowUp: '2026-07-20' }).pending, false);
});

test('B1.2.3 prioriza una única alerta comercial', () => {
  assert.match(primaryLeadAlert({ ...base, nextFollowUp: '2026-07-09' }, '2026-07-28').label, /vencido hace 19 días/i);
  assert.equal(primaryLeadAlert({ ...base, pipeline: 'Nuevo', lastContact: undefined }, '2026-07-28').label, 'Nuevo sin contactar');
  assert.equal(primaryLeadAlert({ ...base, pipeline: 'Visita coordinada', nextFollowUp: '2026-07-28' }, '2026-07-28').label, 'Visita hoy');
});

test('B1.2.3 ordena terminales al final y vencidos primero', () => {
  const clients = [
    { ...base, id: 1, name: 'Ganado', pipeline: 'Ganado' },
    { ...base, id: 2, name: 'Normal', nextFollowUp: '2026-08-02' },
    { ...base, id: 3, name: 'Vencido', nextFollowUp: '2026-07-20' },
    { ...base, id: 4, name: 'Perdido', pipeline: 'Perdido' },
  ];
  assert.deepEqual(sortLeads(clients, 'priority', '2026-07-28').map((client) => client.name), ['Vencido', 'Normal', 'Ganado', 'Perdido']);
});

test('B1.2.3 resuelve responsable sin identificadores técnicos', () => {
  const members: TeamMember[] = [{ id: 1, userId: 'u1', name: 'trvgestioninmobiliaria', email: 'franco.solis@example.com', role: 'Dueño', status: 'Activo', createdAt: '2026-01-01' }];
  assert.equal(readableResponsible(base, members, 'Franco Solís', 'franco@example.com'), 'Franco Solís');
  assert.equal(readableResponsible({ ...base, assignedToId: 99 }, [], '', 'franco.solis@example.com'), 'Franco Solis');
});
'''
(root / 'src/tests/b1-2-3-lead-list-priority.test.ts').write_text(test)

doc = r'''# B1.2.3 — Leads compactos, priorizados y fáciles de recorrer

## Diagnóstico

La lista posterior a B1.2.2 era responsive, pero mantenía resumen, historial y matching dentro del flujo visual de cada tarjeta. Eso aumentaba la altura y dificultaba recorrer muchos Leads.

## Solución

- Tarjeta compacta con identidad, etapa, alerta única, búsqueda, tres datos comerciales, próxima acción y acciones frecuentes.
- Ficha completa bajo demanda; en móvil solo una permanece abierta.
- Estado visual conservado durante rerenders mientras el Lead siga visible.
- Alerta única y determinística, sin scoring predictivo.
- Fechas comerciales relativas.
- Responsable legible sin modificar asignaciones.
- Orden por prioridad después de permisos y filtros.
- Pipeline horizontal con indicación de contenido oculto y chip seleccionado visible.
- Completar y reprogramar reutilizan las funciones existentes de B1.1.
- Estados futuros de envío de propiedades quedan documentados, no persistidos.

## Exclusiones

No se modifican modelos, persistencia, SQL, Supabase, Railway, autenticación, IA paga ni reglas comerciales de B1.2.1.
'''
(root / 'docs/B1_2_3_COMPACT_PRIORITIZED_LEADS.md').write_text(doc)
