import { PRODUCT_BRAND } from './branding.js';
import {
  consumeInvitationSessionFromUrl,
  hasPendingInvitationSession,
  isInvitationCallback,
  setInvitationPassword,
} from './invitation-auth.js';
import { escapeHtml } from './utils.js';

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) || '').trim();
}

export function isInvitationPage(): boolean {
  const pathname = location.pathname.replace(/\/+$/g, '');
  return pathname === '/aceptar-invitacion' || isInvitationCallback();
}

function invitationShell(content: string): string {
  return `<main class="public-auth-shell">
    <section class="public-auth-brand">
      <img src="${PRODUCT_BRAND.logo}" alt="${PRODUCT_BRAND.name}">
      <div><span>CRM inmobiliario</span><h1>Activá tu acceso a PropControl.</h1><p>Tu cuenta quedará vinculada únicamente a la inmobiliaria que te invitó.</p></div>
    </section>
    <section class="public-auth-panel">
      <div class="public-auth-card">${content}</div>
    </section>
  </main>`;
}

function renderInvitationError(root: HTMLElement, message: string): void {
  root.innerHTML = invitationShell(`<h2>No se pudo abrir la invitación</h2><p>${escapeHtml(message)}</p><a class="button-link" href="/login">Volver a ingresar</a>`);
}

export async function renderInvitationAuth(root: HTMLElement): Promise<void> {
  root.innerHTML = invitationShell('<h2>Verificando invitación…</h2><p>Un momento.</p>');
  try {
    await consumeInvitationSessionFromUrl();
  } catch (error) {
    renderInvitationError(root, error instanceof Error ? error.message : 'La invitación no es válida.');
    return;
  }

  if (!hasPendingInvitationSession()) {
    renderInvitationError(root, 'La invitación no contiene una sesión válida. Pedí una nueva invitación.');
    return;
  }

  root.innerHTML = invitationShell(`<h2>Crear contraseña</h2>
    <p>Definí tu contraseña para activar el acceso.</p>
    <form id="invitation-password-form">
      <label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <label>Repetir contraseña<input name="confirmation" type="password" autocomplete="new-password" minlength="8" required></label>
      <button type="submit">Activar mi acceso</button>
      <div class="auth-message" data-invitation-message role="status"></div>
    </form>`);

  root.querySelector<HTMLFormElement>('#invitation-password-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const password = formValue(form, 'password');
    const confirmation = formValue(form, 'confirmation');
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const message = form.querySelector<HTMLElement>('[data-invitation-message]');
    if (password !== confirmation) {
      if (message) { message.textContent = 'Las contraseñas no coinciden.'; message.classList.add('error'); }
      return;
    }
    if (button) button.disabled = true;
    if (message) { message.textContent = 'Activando acceso…'; message.classList.remove('error'); }
    void setInvitationPassword(password)
      .then(() => {
        if (message) message.textContent = 'Acceso activado. Ingresando…';
        location.assign('/');
      })
      .catch((error) => {
        if (message) {
          message.textContent = error instanceof Error ? error.message : 'No se pudo activar el acceso.';
          message.classList.add('error');
        }
        if (button) button.disabled = false;
      });
  });
}
