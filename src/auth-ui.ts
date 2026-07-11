import {
  getCloudSession,
  pullCloudData,
  pushCloudData,
  signInCloud,
  signOutCloud,
  signUpCloud,
} from './cloud-api.js';
import { replaceData, state } from './store.js';
import { escapeHtml } from './utils.js';

let authMode: 'login' | 'signup' = 'login';
let eventsBound = false;

type Notice = (message: string) => void;
type Rerender = () => void;

export function authShellHtml(): string {
  return `<div class="auth-modal" id="auth-modal" hidden>
    <div class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button type="button" class="auth-close" data-auth-close aria-label="Cerrar">×</button>
      <span class="eyebrow">Cuenta PropControl</span>
      <h2 id="auth-title">Ingresar</h2>
      <p class="auth-copy">Usá la misma cuenta en tu computadora y celular.</p>
      <div class="auth-tabs">
        <button type="button" data-auth-mode="login" class="active">Ingresar</button>
        <button type="button" data-auth-mode="signup">Crear cuenta</button>
      </div>
      <form id="cloud-login-form" class="auth-form">
        <label>Correo electrónico<input name="email" type="email" autocomplete="email" required></label>
        <label>Contraseña<input name="password" type="password" autocomplete="current-password" minlength="8" required></label>
        <button type="submit">Ingresar y sincronizar</button>
      </form>
      <form id="cloud-signup-form" class="auth-form" hidden>
        <label>Nombre de la inmobiliaria<input name="companyName" value="TRV Gestión Inmobiliaria" required></label>
        <label>Correo electrónico<input name="email" type="email" autocomplete="email" required></label>
        <label>Contraseña<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
        <small>Usá al menos 8 caracteres. No compartas esta contraseña.</small>
        <button type="submit">Crear cuenta</button>
      </form>
      <div class="auth-message" id="auth-message" role="status"></div>
    </div>
  </div>`;
}

export function renderCloudAccount(): void {
  const container = document.querySelector<HTMLElement>('#cloud-account');
  if (!container) return;
  const session = getCloudSession();
  container.innerHTML = session
    ? `<div class="cloud-account signed-in"><span><b>☁ Guardado online</b><small>${escapeHtml(session.email)}</small></span><button type="button" data-cloud-sync>Sincronizar</button><button type="button" class="quiet-button" data-auth-logout>Salir</button></div>`
    : '<button type="button" class="cloud-login-button" data-auth-open>Ingresar / crear cuenta</button>';
}

function setAuthMode(mode: 'login' | 'signup'): void {
  authMode = mode;
  const loginForm = document.querySelector<HTMLFormElement>('#cloud-login-form');
  const signupForm = document.querySelector<HTMLFormElement>('#cloud-signup-form');
  if (loginForm) loginForm.hidden = mode !== 'login';
  if (signupForm) signupForm.hidden = mode !== 'signup';
  document.querySelector<HTMLElement>('#auth-title')!.textContent = mode === 'login' ? 'Ingresar' : 'Crear cuenta';
  document.querySelectorAll<HTMLButtonElement>('[data-auth-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.authMode === mode);
  });
  const message = document.querySelector<HTMLElement>('#auth-message');
  if (message) message.textContent = '';
}

function openAuth(): void {
  const modal = document.querySelector<HTMLElement>('#auth-modal');
  if (!modal) return;
  modal.hidden = false;
  setAuthMode(authMode);
  window.setTimeout(() => modal.querySelector<HTMLInputElement>('input')?.focus(), 0);
}

function closeAuth(): void {
  const modal = document.querySelector<HTMLElement>('#auth-modal');
  if (modal) modal.hidden = true;
}

function setAuthMessage(message: string, error = false): void {
  const element = document.querySelector<HTMLElement>('#auth-message');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', error);
}

function formText(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) || '').trim();
}

async function syncAfterLogin(notice: Notice, rerender: Rerender): Promise<void> {
  const cloudData = await pullCloudData();
  if (cloudData) {
    replaceData(cloudData);
    notice('Datos cargados desde Supabase.');
  } else {
    await pushCloudData(state.crm);
    notice('Cuenta conectada. Tus datos actuales ya están guardados online.');
  }
  renderCloudAccount();
  rerender();
}

export async function initializeCloudSession(notice: Notice, rerender: Rerender): Promise<void> {
  renderCloudAccount();
  if (!getCloudSession()) return;
  try {
    const cloudData = await pullCloudData();
    if (cloudData) {
      replaceData(cloudData);
      rerender();
    }
  } catch (error) {
    notice(error instanceof Error ? error.message : 'No se pudo recuperar la sesión online.');
    renderCloudAccount();
  }
}

export function bindAuthUi(notice: Notice, rerender: Rerender): void {
  if (eventsBound) return;
  eventsBound = true;

  document.addEventListener('propcontrol-cloud-status', (event) => {
    const detail = (event as CustomEvent<{ message?: string }>).detail;
    if (detail?.message) notice(detail.message);
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-auth-open]')) { openAuth(); return; }
    if (target.closest('[data-auth-close]')) { closeAuth(); return; }
    const modeButton = target.closest<HTMLButtonElement>('[data-auth-mode]');
    if (modeButton?.dataset.authMode === 'login' || modeButton?.dataset.authMode === 'signup') {
      setAuthMode(modeButton.dataset.authMode);
      return;
    }
    if (target.closest('[data-auth-logout]')) {
      signOutCloud();
      renderCloudAccount();
      return;
    }
    if (target.closest('[data-cloud-sync]')) {
      notice('Sincronizando…');
      void pushCloudData(state.crm)
        .then(() => notice('Datos guardados online.'))
        .catch((error) => notice(error instanceof Error ? error.message : 'No se pudo sincronizar.'));
    }
    if (target.id === 'auth-modal') closeAuth();
  });

  document.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement;
    if (form.id !== 'cloud-login-form' && form.id !== 'cloud-signup-form') return;
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;
    setAuthMessage('Procesando…');

    const task = form.id === 'cloud-login-form'
      ? signInCloud(formText(form, 'email'), formText(form, 'password')).then(async () => {
          await syncAfterLogin(notice, rerender);
          closeAuth();
        })
      : signUpCloud(formText(form, 'email'), formText(form, 'password'), formText(form, 'companyName')).then(async (result) => {
          if (result.session) {
            await syncAfterLogin(notice, rerender);
            closeAuth();
          } else {
            setAuthMessage(result.message);
            setAuthMode('login');
          }
        });

    void task.catch((error) => {
      const message = error instanceof Error ? error.message : 'No se pudo completar la operación.';
      setAuthMessage(message, true);
    }).finally(() => {
      if (submit) submit.disabled = false;
    });
  });
}
