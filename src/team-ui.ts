import type { AssignmentEntity, TeamMember, TeamRole } from './models.js';
import { saveData, setActiveMemberId, state } from './store.js';
import {
  activeMember,
  activeSeatCount,
  addActivity,
  canManageTeam,
  hasSeatAvailable,
  memberName,
  workload,
} from './team-access.js';
import { escapeHtml, field, formValues, nextId } from './utils.js';

const roles: TeamRole[] = ['Dueño', 'Administrador', 'Corredor'];

function roleDescription(role: TeamRole): string {
  if (role === 'Dueño') return 'Control total, métricas, configuración, equipo y toda la operación.';
  if (role === 'Administrador') return 'Organiza usuarios, asignaciones y operación, sin reemplazar al dueño.';
  return 'Trabaja únicamente los clientes, propiedades, conversaciones y tareas que tenga asignados.';
}

function seatLabel(): string {
  const limit = state.crm.organization.seatLimit;
  return limit === null ? `${activeSeatCount()} usuarios · sin límite durante el piloto` : `${activeSeatCount()} de ${limit} usuarios`;
}

function memberStatusClass(member: TeamMember): string {
  return member.status.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function memberOptions(selectedId: number | undefined): string {
  return state.crm.teamMembers
    .filter((member) => member.status !== 'Suspendido')
    .map((member) => `<option value="${member.id}"${member.id === selectedId ? ' selected' : ''}>${escapeHtml(member.name)} · ${escapeHtml(member.role)}</option>`)
    .join('');
}

function memberCard(member: TeamMember): string {
  const load = workload(member.id);
  const manageable = canManageTeam() && member.role !== 'Dueño';
  return `<article class="team-member-card ${memberStatusClass(member)}">
    <div class="team-member-heading">
      <div class="team-avatar" aria-hidden="true">${escapeHtml(member.name.slice(0, 2).toUpperCase())}</div>
      <div><h3>${escapeHtml(member.name)}</h3><p>${escapeHtml(member.email || 'Sin correo asociado')}</p></div>
      <span class="team-status">${escapeHtml(member.status)}</span>
    </div>
    <label>Rol
      <select data-team-role="${member.id}"${manageable ? '' : ' disabled'}>${roles.map((role) => `<option${role === member.role ? ' selected' : ''}>${role}</option>`).join('')}</select>
    </label>
    <p class="role-description">${escapeHtml(roleDescription(member.role))}</p>
    <div class="team-workload">
      <span><b>${load.clients}</b> clientes</span><span><b>${load.properties}</b> propiedades</span>
      <span><b>${load.conversations}</b> conversaciones</span><span><b>${load.tasks}</b> tareas</span>
      <span><b>${load.unread}</b> sin leer</span>
    </div>
    ${manageable ? `<button type="button" class="secondary" data-team-status="${member.id}">${member.status === 'Suspendido' ? 'Reactivar' : 'Suspender acceso'}</button>` : ''}
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
    <label>Responsable<select data-assignment-type="${row.type}" data-assignment-id="${row.id}"${canManageTeam() ? '' : ' disabled'}>${memberOptions(row.assignedToId)}</select></label>
  </article>`).join('')}</div>`;
}

function activityHtml(): string {
  const entries = state.crm.activityLog.slice(0, 20);
  if (!entries.length) return '<p class="empty-state">Las reasignaciones y cambios del equipo aparecerán acá.</p>';
  return `<div class="activity-list">${entries.map((entry) => `<article><time>${escapeHtml(new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.createdAt)))}</time><div><strong>${escapeHtml(entry.action)}</strong><p>${escapeHtml(entry.detail)}</p><small>Por ${escapeHtml(memberName(entry.actorId))}</small></div></article>`).join('')}</div>`;
}

function teamFormHtml(): string {
  if (!canManageTeam()) return '';
  return `<form id="team-member-form" class="data-form ${state.openForms.member ? '' : 'collapsed'}">
    <div class="form-heading"><div><span class="eyebrow">Nuevo integrante</span><h3>Preparar acceso</h3></div><span>Esto crea el perfil y las asignaciones. El envío real de invitaciones se conectará con Supabase.</span></div>
    <input name="name" placeholder="Nombre y apellido" required>
    <input name="email" type="email" placeholder="Correo de acceso" required>
    <input name="phone" inputmode="tel" placeholder="Teléfono opcional">
    <select name="role">${roles.filter((role) => role !== 'Dueño').map((role) => `<option>${role}</option>`).join('')}</select>
    <button type="submit"${hasSeatAvailable() ? '' : ' disabled'}>${hasSeatAvailable() ? 'Crear perfil pendiente' : 'Cupo completo'}</button>
  </form>`;
}

export function renderTeamAccount(): void {
  const container = document.querySelector<HTMLElement>('#team-account');
  if (!container) return;
  const member = activeMember();
  container.innerHTML = `<label class="team-view-switch"><span>Vista de usuario</span><select data-team-view>${state.crm.teamMembers.filter((item) => item.status !== 'Suspendido').map((item) => `<option value="${item.id}"${item.id === member.id ? ' selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.role)}</option>`).join('')}</select></label>`;
  container.querySelector<HTMLSelectElement>('[data-team-view]')?.addEventListener('change', (event) => {
    setActiveMemberId(Number((event.currentTarget as HTMLSelectElement).value));
    document.dispatchEvent(new CustomEvent('trv-render'));
  });
}

export function renderTeam(container: HTMLElement): void {
  const member = activeMember();
  const limit = state.crm.organization.seatLimit;
  container.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">Organización</span><h2>Equipo y responsabilidades</h2><p class="panel-description">El número de corredores no está fijado: depende del cupo contratado por cada inmobiliaria.</p></div>${canManageTeam() ? '<button type="button" data-toggle-team-member>Agregar integrante</button>' : ''}</div>
    <section class="team-plan-banner"><div><span class="eyebrow">${escapeHtml(state.crm.organization.planLabel)}</span><h3>${escapeHtml(state.crm.organization.name)}</h3><p>${escapeHtml(seatLabel())}</p></div><div class="team-plan-controls"><label>Cupo de prueba<select data-seat-limit${member.role === 'Dueño' ? '' : ' disabled'}><option value="unlimited"${limit === null ? ' selected' : ''}>Sin límite</option>${[3, 6, 10, 20, 50, 100].map((value) => `<option value="${value}"${limit === value ? ' selected' : ''}>${value} usuarios</option>`).join('')}</select></label><small>En el producto comercial este cupo lo definirá el plan contratado.</small></div></section>
    <div class="team-safety-note"><b>Acceso real pendiente</b><p>Los perfiles, roles y asignaciones ya se guardan. La invitación por correo y el aislamiento definitivo de datos se habilitarán con autenticación multiusuario y políticas RLS de Supabase.</p></div>
    ${teamFormHtml()}
    <section><div class="section-heading"><div><span class="eyebrow">Miembros</span><h3>${state.crm.teamMembers.length} perfiles</h3></div><strong>${escapeHtml(seatLabel())}</strong></div><div class="team-grid">${state.crm.teamMembers.map(memberCard).join('')}</div></section>
    <section class="assignment-center"><div class="section-heading"><div><span class="eyebrow">Distribución operativa</span><h3>Centro de asignaciones</h3></div><span>Dueño y administradores pueden reasignar.</span></div>${assignmentTableHtml()}</section>
    <section class="team-activity"><div class="section-heading"><div><span class="eyebrow">Trazabilidad</span><h3>Actividad del equipo</h3></div><span>Últimos 20 cambios</span></div>${activityHtml()}</section>`;

  bindTeam(container);
}

function bindTeam(container: HTMLElement): void {
  container.querySelector<HTMLElement>('[data-toggle-team-member]')?.addEventListener('click', () => {
    state.openForms.member = !state.openForms.member;
    document.dispatchEvent(new CustomEvent('trv-render'));
  });

  container.querySelector<HTMLFormElement>('#team-member-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!canManageTeam() || !hasSeatAvailable()) return;
    const values = formValues(event.currentTarget as HTMLFormElement);
    const email = field(values, 'email').trim().toLowerCase();
    if (state.crm.teamMembers.some((member) => member.email.toLowerCase() === email)) {
      window.alert('Ya existe un integrante con ese correo.');
      return;
    }
    const newMember: TeamMember = {
      id: nextId(state.crm.teamMembers),
      name: field(values, 'name').trim(),
      email,
      phone: field(values, 'phone').trim() || undefined,
      role: field(values, 'role') as TeamRole,
      status: 'Pendiente de acceso',
      createdAt: new Date().toISOString(),
    };
    state.crm.teamMembers.push(newMember);
    addActivity({ action: 'Perfil preparado', entityType: 'Equipo', entityId: newMember.id, detail: `${newMember.name} fue agregado como ${newMember.role}.` });
    state.openForms.member = false;
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  });

  container.querySelectorAll<HTMLSelectElement>('[data-team-role]').forEach((select) => select.addEventListener('change', () => {
    if (!canManageTeam()) return;
    const memberId = Number(select.dataset.teamRole);
    const target = state.crm.teamMembers.find((member) => member.id === memberId);
    if (!target || target.role === 'Dueño') return;
    target.role = select.value as TeamRole;
    addActivity({ action: 'Rol actualizado', entityType: 'Equipo', entityId: target.id, detail: `${target.name} ahora es ${target.role}.` });
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  }));

  container.querySelectorAll<HTMLButtonElement>('[data-team-status]').forEach((button) => button.addEventListener('click', () => {
    if (!canManageTeam()) return;
    const target = state.crm.teamMembers.find((member) => member.id === Number(button.dataset.teamStatus));
    if (!target || target.role === 'Dueño') return;
    target.status = target.status === 'Suspendido' ? 'Activo' : 'Suspendido';
    addActivity({ action: 'Estado de acceso', entityType: 'Equipo', entityId: target.id, detail: `${target.name}: ${target.status}.` });
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  }));

  container.querySelector<HTMLSelectElement>('[data-seat-limit]')?.addEventListener('change', (event) => {
    if (activeMember().role !== 'Dueño') return;
    const value = (event.currentTarget as HTMLSelectElement).value;
    const nextLimit = value === 'unlimited' ? null : Number(value);
    if (nextLimit !== null && nextLimit < activeSeatCount()) {
      window.alert('No podés fijar un cupo menor que la cantidad actual de usuarios.');
      document.dispatchEvent(new CustomEvent('trv-render'));
      return;
    }
    state.crm.organization.seatLimit = nextLimit;
    state.crm.organization.planLabel = nextLimit === null ? 'Piloto sin límite' : `Plan de ${nextLimit} usuarios`;
    addActivity({ action: 'Cupo actualizado', entityType: 'Equipo', detail: `Nuevo cupo: ${nextLimit ?? 'sin límite'}.` });
    saveData();
    document.dispatchEvent(new CustomEvent('trv-render'));
  });

  container.querySelectorAll<HTMLSelectElement>('[data-assignment-type]').forEach((select) => select.addEventListener('change', () => {
    if (!canManageTeam()) return;
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
