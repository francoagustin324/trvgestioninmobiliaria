import type { TeamMember, TeamRole } from './models.js';
import { getCloudSession, inviteTeamMember, updateTeamMemberAccess } from './cloud-api.js';
import { saveData, state } from './store.js';
import { activeMember, canManageTeam } from './team-access.js';
import { escapeHtml, field, formValues } from './utils.js';

function replaceMember(member: TeamMember): void {
  const exists = state.crm.teamMembers.some((item) => item.id === member.id);
  state.crm.teamMembers = exists
    ? state.crm.teamMembers.map((item) => item.id === member.id ? member : item)
    : [...state.crm.teamMembers, member].sort((left, right) => left.id - right.id);
}

function userRow(member: TeamMember): string {
  const current = activeMember();
  const editable = canManageTeam() && member.role !== 'Dueño' && (current.role === 'Dueño' || member.role === 'Corredor');
  return `<article class="mvp-user-row"><div class="mvp-user-avatar">${escapeHtml(member.name.slice(0, 2).toUpperCase())}</div><div class="mvp-user-info"><strong>${escapeHtml(member.name)}</strong><span>${escapeHtml(member.email || 'Correo pendiente')}</span></div><label>Rol<select data-user-role="${member.id}"${editable ? '' : ' disabled'}>${member.role === 'Dueño' ? '<option>Dueño</option>' : `<option${member.role === 'Corredor' ? ' selected' : ''}>Corredor</option><option${member.role === 'Administrador' ? ' selected' : ''}>Administrador</option>`}</select></label><span class="mvp-user-status">${escapeHtml(member.status)}</span>${editable ? `<button type="button" class="secondary" data-user-status="${member.id}">${member.status === 'Suspendido' ? 'Reactivar' : 'Suspender'}</button>` : ''}</article>`;
}

function setFeedback(container: HTMLElement, message: string, error = false): void {
  const element = container.querySelector<HTMLElement>('[data-user-feedback]');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', error);
}

export function renderMvpUsers(container: HTMLElement): void {
  const canManage = canManageTeam();
  const sessionReady = Boolean(getCloudSession());
  container.innerHTML = `<div class="mvp-page-heading"><div><h1>Administración de usuarios</h1><p>Administrá accesos y roles de la inmobiliaria.</p></div>${canManage ? '<button type="button" data-toggle-user-form>Invitar usuario</button>' : ''}</div>${canManage ? `<form id="mvp-user-form" class="mvp-user-form ${state.openForms.member ? '' : 'collapsed'}"><div class="mvp-form-heading"><h2>Invitar usuario</h2><button type="button" class="quiet-button" data-toggle-user-form>Cerrar</button></div><label>Nombre<input name="name" required></label><label>Correo<input name="email" type="email" required></label><label>Rol<select name="role"><option>Corredor</option>${activeMember().role === 'Dueño' ? '<option>Administrador</option>' : ''}</select></label><button type="submit"${sessionReady ? '' : ' disabled'}>${sessionReady ? 'Enviar invitación' : 'Ingresá para invitar'}</button><div data-user-feedback class="auth-message"></div></form>` : ''}<div class="mvp-user-list">${state.crm.teamMembers.map(userRow).join('')}</div>`;

  container.querySelectorAll<HTMLElement>('[data-toggle-user-form]').forEach((button) => button.addEventListener('click', () => {
    state.openForms.member = !state.openForms.member;
    document.dispatchEvent(new CustomEvent('trv-render'));
  }));

  container.querySelector<HTMLFormElement>('#mvp-user-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!canManage || !getCloudSession()) return;
    const form = event.currentTarget as HTMLFormElement;
    const values = formValues(form);
    const email = field(values, 'email').trim().toLowerCase();
    if (state.crm.teamMembers.some((member) => member.email.toLowerCase() === email)) {
      setFeedback(container, 'Ya existe un usuario con ese correo.', true);
      return;
    }
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;
    setFeedback(container, 'Enviando invitación…');
    void inviteTeamMember({ name: field(values, 'name').trim(), email, role: field(values, 'role') as Exclude<TeamRole, 'Dueño'> })
      .then((member) => {
        replaceMember(member);
        state.openForms.member = false;
        saveData();
        document.dispatchEvent(new CustomEvent('trv-render'));
      })
      .catch((error) => {
        setFeedback(container, error instanceof Error ? error.message : 'No se pudo invitar al usuario.', true);
        if (submit) submit.disabled = false;
      });
  });

  container.querySelectorAll<HTMLSelectElement>('[data-user-role]').forEach((select) => select.addEventListener('change', () => {
    const id = Number(select.dataset.userRole);
    const target = state.crm.teamMembers.find((member) => member.id === id);
    if (!target || target.role === 'Dueño') return;
    const previous = target.role;
    select.disabled = true;
    void updateTeamMemberAccess(id, { role: select.value as Exclude<TeamRole, 'Dueño'> })
      .then((updated) => { replaceMember(updated); saveData(); document.dispatchEvent(new CustomEvent('trv-render')); })
      .catch((error) => { select.value = previous; select.disabled = false; window.alert(error instanceof Error ? error.message : 'No se pudo cambiar el rol.'); });
  }));

  container.querySelectorAll<HTMLButtonElement>('[data-user-status]').forEach((button) => button.addEventListener('click', () => {
    const id = Number(button.dataset.userStatus);
    const target = state.crm.teamMembers.find((member) => member.id === id);
    if (!target || target.role === 'Dueño') return;
    button.disabled = true;
    const status = target.status === 'Suspendido' ? 'Activo' : 'Suspendido';
    void updateTeamMemberAccess(id, { status })
      .then((updated) => { replaceMember(updated); saveData(); document.dispatchEvent(new CustomEvent('trv-render')); })
      .catch((error) => { button.disabled = false; window.alert(error instanceof Error ? error.message : 'No se pudo cambiar el acceso.'); });
  }));
}
