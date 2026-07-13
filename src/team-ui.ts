import type { AssignmentEntity, TeamMember, TeamRole } from './models.js';
import {
  getCloudSession,
  inviteTeamMember,
  updateTeamMemberAccess,
} from './cloud-api.js';
import { saveData, state } from './store.js';
import {
  activeMember,
  activeSeatCount,
  addActivity,
  canManageTeam,
  hasSeatAvailable,
  memberName,
  workload,
} from './team-access.js';
import { escapeHtml, field, formValues } from './utils.js';

const roles: TeamRole[] = ['Dueño', 'Administrador', 'Corredor'];

function roleDescription(role: TeamRole): string {
  if (role === 'Dueño') return 'Control total, configuración, equipo y toda la operación.';
  if (role === 'Administrador') return 'Organiza usuarios y asignaciones. No puede modificar al dueño.';
  return 'Solo recibe desde Supabase los registros que tiene asignados.';
}

function seatLabel(): string {
  const limit = state.crm.organization.seatLimit;
  return limit === null ? `${activeSeatCount()} usuarios · piloto sin límite` : `${activeSeatCount()} de ${limit} usuarios`;
}

function memberStatusClass(member: TeamMember): string {
  return member.status.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function cloudTeamReady(): boolean {
  return Boolean(getCloudSession());
}

function memberOptions(selectedId: number | undefined): string {
  return state.crm.teamMembers
    .filter((member) => member.status !== 'Suspendido')
    .map((member) => `<option value="${member.id}"${member.id === selectedId ? ' selected' : ''}>${escapeHtml(member.name)} · ${escapeHtml(member.role)}</option>`)
    .join('');
}

function memberCard(member: TeamMember): string {
  const load = workload(member.id);
  const current = activeMember();
  const manageable = cloudTeamReady()
    && canManageTeam()
    && member.role !== 'Dueño'
    && (current.role === 'Dueño' || member.role === 'Corredor');
  const roleOptions = roles.filter((role) => role !== 'Dueño');
  return `<article class="team-member-card ${memberStatusClass(member)}">
    <div class="team-member-heading">
      <div class="team-avatar" aria-hidden="true">${escapeHtml(member.name.slice(0, 2).toUpperCase())}</div>
      <div><h3>${escapeHtml(member.name)}</h3><p>${escapeHtml(member.email || 'Correo pendiente')}</p></div>
      <span class="team-status">${escapeHtml(member.status)}</span>
    </div>
    <label>Rol
      <select data-team-role="${member.id}"${manageable ? '' : ' disabled'}>${(member.role === 'Dueño' ? ['Dueño'] : roleOptions).map((role) => `<option${role === member.role ? ' selected' : ''}>${role}</option>`).join('')}</select>
    </label>
    <p class="role-description">${escapeHtml(roleDescription(member.role))}</p>
    <div class="team-workload">
      <span><b>${load.clients}</b> clientes</span><span><b>${load.properties}</b> propiedades</span>
      <span><b>${load.conversations}</b> conversaciones</span><span><b>${load.tasks}</b> tareas</span>
      <span><b>${load.unread}</b> sin leer</span>
    </div>
    ${manageable ? `<button type="button" class="secondary" data-team-status="${member.id}">${member.status === 'Suspendido' ? 'Reactivar acceso' : 'Suspender acceso'}</button>` : ''}
  </article>`;
}

interface AssignmentRow {
  type: AssignmentEntity;
  id: number;
  title: string;
  detail: string;
  assignedToId?: number;
}

function assignmentRows(): AssignmentRow[] {
  return [
    ...state.crm.clients.map((item) => ({ type: 'Cliente' as const, id: item.id, title: item.name, detail: item.interest, assignedToId: item.assignedToId })),
    ...state.crm.properties.map((item) => ({ type: 'Propiedad' as const, id: item.id, title: item.title, detail: item.address, assignedToId: item.assignedToId })),
    ...state.crm.conversations.map((item) => {
      const client = state.crm.clients.find((candidate) => candidate.id === item.clientId);
      return { type: 'Conversación' as const, id: item.id, title: client?.name ?? item.phone, detail: `${item.unread} mensajes sin leer`, assignedToId: item.assignedToId };
    }),
    ...state.crm.reminders.map((item) => ({ type: 'Tarea' as const, id: item.id, title: item.title, detail: `${item.date} · ${item.related}`, assignedToId: item.assignedToId })),
  ];
}

function assignmentTableHtml(): string {
  const rows = assignmentRows();
  if (!rows.length) return '<p class="empty-state">Todavía no hay registros para asignar.</p>';
  return `<div class="assignment-table">${rows.map((row) => `<article>
    <span class="assignment-type">${escapeHtml(row.type)}</span>
    <div><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.detail)}</small></div>
    <label>Responsable<select data-assignment-type="${row.type}" data-assignment-id="${row.id}"${canManageTeam() && cloudTeamReady() ? '' : ' disabled'}>${memberOptions(row.assignedToId)}</select></label>
  </article>`).join('')}</div>`;
}

function activityHtml(): string {
  const entries = state.crm.activityLog.slice(0, 20);
  if (!entries.length) return '<p class="empty-state">Las reasignaciones y cambios aparecerán acá.</p>';
  return `<div class="activity-list">${entries.map((entry) => `<article><time>${escapeHtml(new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.createdAt)))}</time><div><strong>${escapeHtml(entry.action)}</strong><p>${escapeHtml(entry.detail)}</p><small>Por ${escapeHtml(memberName(entry.actorId))}</small></div></article>`).join('')}</div>`;
}

function teamFormHtml(): string {
  if (!canManageTeam()) return '';
  const ready = cloudTeamReady();
  return `<form id="team-member-form" class="data-form ${state.openForms.member ? '' : 'collapsed'}">
    <div class="form-heading"><div><span class="eyebrow">Nuevo integrante</span><h3>Enviar invitación segura</h3></div><span>${ready ? 'Supabase enviará el correo y asociará el usuario a esta inmobiliaria.' : 'Primero ingresá con la cuenta del dueño o administrador.'}</span></div>
    <input name="name" placeholder="Nombre y apellido" required>
    <input name="email" type="email" placeholder="Correo de acceso" required>
    <input name="phone" inputmode="tel" placeholder="Teléfono opcional">
    <select name="role"><option>Corredor</option>${activeMember().role === 'Dueño' ? '<option>Administrador</option>' : ''}</select>
    <button type="submit"${ready && hasSeatAvailable() ? '' : ' disabled'}>${!ready ? 'Ingresá para invitar' : hasSeatAvailable() ? 'Enviar invitación' : 'Cupo completo'}</button>
    <small data-team-feedback></small>
  </form>`;
}

export function renderTeamAccount(): void {
  const container = document.querySelector<HTMLElement>('#team-account');
  if (!container) return;
  const session = getCloudSession();
  const member = activeMember();
  container.innerHTML = session
    ? `<div class="team-view-switch"><span>Usuario autenticado</span><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.role)}</small></div>`
    : '<div class="team-view-switch"><span>Modo local</span><strong>Sin sesión segura</strong></div>';
}

export function renderTeam(container: HTMLElement): void {
  const limit = state.crm.organization.seatLimit;
  container.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">Organización</span><h2>Equipo y responsabilidades</h2><p class="panel-description">Cada integrante usa su propia sesión. Los corredores reciben únicamente los registros autorizados por RLS.</p></div>${canManageTeam() ? '<button type="button" data-toggle-team-member>Invitar integrante</button>' : ''}</div>
    <section class="team-plan-banner"><div><span class="eyebrow">${escapeHtml(state.crm.organization.planLabel)}</span><h3>${escapeHtml(state.crm.organization.name)}</h3><p>${escapeHtml(seatLabel())}</p></div><div class="team-plan-controls"><label>Cupo contratado<input value="${limit === null ? 'Sin límite durante el piloto' : `${limit} usuarios`}" readonly></label><small>El cupo será administrado por el plan comercial, no desde el navegador.</small></div></section>
    <div class="team-safety-note"><b>${cloudTeamReady() ? 'Sesión individual activa' : 'Acceso online requerido'}</b><p>${cloudTeamReady() ? 'Las invitaciones y cambios de acceso pasan por el servidor. Supabase RLS controla qué filas puede leer o modificar cada persona.' : 'Ingresá para administrar invitaciones y permisos reales.'}</p></div>
    ${teamFormHtml()}
    <section><div class="section-heading"><div><span class="eyebrow">Miembros</span><h3>${state.crm.teamMembers.length} integrantes</h3></div><strong>${escapeHtml(seatLabel())}</strong></div><div class="team-grid">${state.crm.teamMembers.map(memberCard).join('')}</div></section>
    <section class="assignment-center"><div class="section-heading"><div><span class="eyebrow">Distribución operativa</span><h3>Centro de asignaciones</h3></div><span>Las reasignaciones se validan nuevamente al guardar en Supabase.</span></div>${assignmentTableHtml()}</section>
    <section class="team-activity"><div class="section-heading"><div><span class="eyebrow">Trazabilidad</span><h3>Actividad del equipo</h3></div><span>Últimos 20 cambios</span></div>${activityHtml()}</section>`;
  bindTeam(container);
}

function replaceMember(member: TeamMember): void {
  const existing = state.crm.teamMembers.some((item) => item.id === member.id);
  state.crm.teamMembers = existing
    ? state.crm.teamMembers.map((item) => item.id === member.id ? member : item)
    : [...state.crm.teamMembers, member].sort((left, right) => left.id - right.id);
}

function feedback(container: HTMLElement, message: string, error = false): void {
  const element = container.querySelector<HTMLElement>('[data-team-feedback]');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', error);
}

function bindTeam(container: HTMLElement): void {
  container.querySelector<HTMLElement>('[data-toggle-team-member]')?.addEventListener('click', () => {
    state.openForms.member = !state.openForms.member;
    document.dispatchEvent(new CustomEvent('trv-render'));
  });

  container.querySelector<HTMLFormElement>('#team-member-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!canManageTeam() || !hasSeatAvailable() || !getCloudSession()) return;
    const form = event.currentTarget as HTMLFormElement;
    const values = formValues(form);
    const email = field(values, 'email').trim().toLowerCase();
    if (state.crm.teamMembers.some((member) => member.email.toLowerCase() === email)) {
      feedback(container, 'Ya existe un integrante con ese correo.', true);
      return;
    }
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;
    feedback(container, 'Enviando invitación…');
    void inviteTeamMember({
      name: field(values, 'name').trim(),
      email,
      phone: field(values, 'phone').trim() || undefined,
      role: field(values, 'role') as Exclude<TeamRole, 'Dueño'>,
    }).then((member) => {
      replaceMember(member);
      addActivity({ action: 'Invitación enviada', entityType: 'Equipo', entityId: member.id, detail: `${member.name} fue invitado como ${member.role}.` });
      state.openForms.member = false;
      saveData();
      document.dispatchEvent(new CustomEvent('trv-render'));
    }).catch((error) => {
      feedback(container, error instanceof Error ? error.message : 'No se pudo enviar la invitación.', true);
      if (submit) submit.disabled = false;
    });
  });

  container.querySelectorAll<HTMLSelectElement>('[data-team-role]').forEach((select) => select.addEventListener('change', () => {
    if (!canManageTeam() || !getCloudSession()) return;
    const memberId = Number(select.dataset.teamRole);
    const target = state.crm.teamMembers.find((member) => member.id === memberId);
    if (!target || target.role === 'Dueño') return;
    const previousRole = target.role;
    select.disabled = true;
    void updateTeamMemberAccess(memberId, { role: select.value as Exclude<TeamRole, 'Dueño'> })
      .then((updated) => {
        replaceMember(updated);
        addActivity({ action: 'Rol actualizado', entityType: 'Equipo', entityId: updated.id, detail: `${updated.name} ahora es ${updated.role}.` });
        saveData();
        document.dispatchEvent(new CustomEvent('trv-render'));
      })
      .catch((error) => {
        select.value = previousRole;
        select.disabled = false;
        window.alert(error instanceof Error ? error.message : 'No se pudo cambiar el rol.');
      });
  }));

  container.querySelectorAll<HTMLButtonElement>('[data-team-status]').forEach((button) => button.addEventListener('click', () => {
    if (!canManageTeam() || !getCloudSession()) return;
    const target = state.crm.teamMembers.find((member) => member.id === Number(button.dataset.teamStatus));
    if (!target || target.role === 'Dueño') return;
    button.disabled = true;
    const status = target.status === 'Suspendido' ? 'Activo' : 'Suspendido';
    void updateTeamMemberAccess(target.id, { status })
      .then((updated) => {
        replaceMember(updated);
        addActivity({ action: 'Estado de acceso', entityType: 'Equipo', entityId: updated.id, detail: `${updated.name}: ${updated.status}.` });
        saveData();
        document.dispatchEvent(new CustomEvent('trv-render'));
      })
      .catch((error) => {
        button.disabled = false;
        window.alert(error instanceof Error ? error.message : 'No se pudo cambiar el acceso.');
      });
  }));

  container.querySelectorAll<HTMLSelectElement>('[data-assignment-type]').forEach((select) => select.addEventListener('change', () => {
    if (!canManageTeam() || !getCloudSession()) return;
    const type = select.dataset.assignmentType as AssignmentEntity;
    const id = Number(select.dataset.assignmentId);
    const assignedToId = Number(select.value);
    const collections = {
      Cliente: state.crm.clients,
      Propiedad: state.crm.properties,
      Conversación: state.crm.conversations,
      Tarea: state.crm.reminders,
    };
    const item = collections[type].find((candidate) => candidate.id === id);
    if (!item) return;
    item.assignedToId = assignedToId;
    addActivity({ action: 'Responsable reasignado', entityType: type, entityId: id, detail: `${type} #${id} fue asignado a ${memberName(assignedToId)}.` });
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  }));
}