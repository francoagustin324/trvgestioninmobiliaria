import { PRODUCT_BRAND } from './branding.js';
import {
  getCloudSession,
  pullCloudData,
  pushCloudData,
  signInCloud,
  signOutCloud,
  signUpCloud,
} from './cloud-api-compatible.js';
import { replaceData, setActiveMemberId, state } from './store.js';
import { escapeHtml } from './utils.js';

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) || '').trim();
}

function activateMember(): void {
  const session = getCloudSession();
  if (!session) return;
  const member = state.crm.teamMembers.find((item) => item.userId === session.userId && item.status !== 'Suspendido');
  if (member) setActiveMemberId(member.id);
}

async function hydrateAfterAuth(): Promise<void> {
  const cloud = await pullCloudData(state.crm);
  if (cloud) replaceData(cloud);
  else {
    await pushCloudData(state.crm);
    const refreshed = await pullCloudData(state.crm);
    if (refreshed) replaceData(refreshed);
  }
  activateMember();
}

export function hasAuthenticatedSession(): boolean {
  return Boolean(getCloudSession());
}

export function isRegisterPage(): boolean {
  return location.pathname.replace(/\/+$/g, '') === '/registro';
}

export function isLoginPage(): boolean {
  return location.pathname.replace(/\/+$/g, '') === '/login';
}

export function renderPublicAuth(root: HTMLElement): void {
  const register = isRegisterPage();
  root.innerHTML = `<main class="public-auth-shell">
    <section class="public-auth-brand">
      <img src="${PRODUCT_BRAND.logo}" alt="${PRODUCT_BRAND.name}">
      <div><span>CRM inmobiliario</span><h1>Ordená cada consulta y cada seguimiento.</h1><p>Una herramienta simple para responder mejor, no perder oportunidades y trabajar en equipo.</p></div>
    </section>
    <section class="public-auth-panel">
      <div class="public-auth-card">
        <div class="public-auth-tabs"><a href="/login" class="${register ? '' : 'active'}">Ingresar</a><a href="/registro" class="${register ? 'active' : ''}">Crear cuenta</a></div>
        <h2>${register ? 'Crear inmobiliaria' : 'Ingresar'}</h2>
        <p>${register ? 'Creá la cuenta principal de la inmobiliaria.' : 'Ingresá con tu correo y contraseña.'}</p>
        <form id="public-auth-form">
          ${register ? '<label>Nombre de la inmobiliaria<input name="companyName" autocomplete="organization" required></label>' : ''}
          <label>Correo electrónico<input name="email" type="email" autocomplete="email" required></label>
          <label>Contraseña<input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="8" required></label>
          <button type="submit">${register ? 'Crear cuenta' : 'Ingresar'}</button>
          <div class="auth-message" data-auth-message role="status"></div>
        </form>
      </div>
    </section>
  </main>`;

  root.querySelector<HTMLFormElement>('#public-auth-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const message = form.querySelector<HTMLElement>('[data-auth-message]');
    if (button) button.disabled = true;
    if (message) { message.textContent = 'Procesando…'; message.classList.remove('error'); }
    const task = register
      ? signUpCloud(formValue(form, 'email'), formValue(form, 'password'), formValue(form, 'companyName')).then(async (result) => {
          if (!result.session) {
            if (message) message.textContent = result.message;
            return;
          }
          await hydrateAfterAuth();
          location.assign('/');
        })
      : signInCloud(formValue(form, 'email'), formValue(form, 'password')).then(async () => {
          await hydrateAfterAuth();
          location.assign('/');
        });
    void task.catch((error) => {
      if (message) {
        message.textContent = error instanceof Error ? error.message : 'No se pudo completar la operación.';
        message.classList.add('error');
      }
    }).finally(() => { if (button) button.disabled = false; });
  });
}

export async function hydrateAuthenticatedSession(): Promise<void> {
  if (!getCloudSession()) return;
  const cloud = await pullCloudData(state.crm);
  if (cloud) replaceData(cloud);
  activateMember();
}

export function renderAccountMenu(): void {
  const container = document.querySelector<HTMLElement>('#cloud-account');
  if (!container) return;
  const session = getCloudSession();
  const member = session ? state.crm.teamMembers.find((item) => item.userId === session.userId) : null;
  if (!session) { container.innerHTML = ''; return; }
  const name = member?.name || session.email;
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
  container.innerHTML = `<details class="mvp-account-menu">
    <summary aria-label="Abrir menú de cuenta"><span class="mvp-account-avatar">${escapeHtml(initials || 'U')}</span></summary>
    <div><header><b>${escapeHtml(name)}</b><small>${escapeHtml(member?.role || session.email)}</small></header><button type="button" data-account-sync>Sincronizar</button><button type="button" data-account-logout>Cerrar sesión</button></div>
  </details>`;
  container.querySelector<HTMLElement>('[data-account-sync]')?.addEventListener('click', () => void pushCloudData(state.crm));
  container.querySelector<HTMLElement>('[data-account-logout]')?.addEventListener('click', () => { signOutCloud(); location.assign('/login'); });
}
