import { getCloudSession } from './cloud-api.js';

interface InvitationResponse {
  success?: boolean;
  inviteLink?: string;
  linkType?: 'invite' | 'recovery';
  error?: string;
}

function feedback(form: HTMLFormElement, message: string, error = false): void {
  const element = form.querySelector<HTMLElement>('[data-user-feedback]');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', error);
}

async function responsePayload(response: Response): Promise<InvitationResponse> {
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text }; }
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as InvitationResponse
    : {};
  if (!response.ok) throw new Error(record.error || `No se pudo crear el enlace (${response.status}).`);
  return record;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const temporary = document.createElement('textarea');
  temporary.value = value;
  temporary.setAttribute('readonly', '');
  temporary.style.position = 'fixed';
  temporary.style.opacity = '0';
  document.body.append(temporary);
  temporary.select();
  const copied = document.execCommand('copy');
  temporary.remove();
  if (!copied) throw new Error('No se pudo copiar automáticamente. Seleccioná el enlace y copialo.');
}

function showInvitationLink(link: string, email: string, linkType: 'invite' | 'recovery' = 'invite'): void {
  document.querySelector('#invitation-link-dialog')?.remove();
  const existingUser = linkType === 'recovery';
  const modal = document.createElement('div');
  modal.id = 'invitation-link-dialog';
  modal.className = 'auth-modal';
  modal.innerHTML = `<div class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="invitation-link-title">
    <span class="eyebrow">${existingUser ? 'Enlace renovado' : 'Invitación creada'}</span>
    <h2 id="invitation-link-title">Compartí este enlace</h2>
    <p class="auth-copy">Enviáselo únicamente a <strong data-invitation-email></strong>. ${existingUser ? 'El usuario ya estaba registrado y podrá crear o restablecer su contraseña.' : 'El invitado podrá crear su contraseña y entrar como usuario de tu inmobiliaria.'}</p>
    <label>Enlace seguro<input data-invitation-link type="text" readonly></label>
    <div class="auth-message" data-invitation-copy-status role="status">Usalo cuanto antes y no lo publiques.</div>
    <button type="button" data-copy-invitation-link>Copiar enlace</button>
    <button type="button" class="quiet-button" data-close-invitation-link>Cerrar y actualizar</button>
  </div>`;
  const input = modal.querySelector<HTMLInputElement>('[data-invitation-link]');
  const emailElement = modal.querySelector<HTMLElement>('[data-invitation-email]');
  const status = modal.querySelector<HTMLElement>('[data-invitation-copy-status]');
  if (input) input.value = link;
  if (emailElement) emailElement.textContent = email;
  modal.querySelector<HTMLButtonElement>('[data-copy-invitation-link]')?.addEventListener('click', () => {
    void copyText(link)
      .then(() => { if (status) status.textContent = 'Enlace copiado. Ya podés enviarlo por WhatsApp.'; })
      .catch((error) => {
        if (input) { input.focus(); input.select(); }
        if (status) { status.textContent = error instanceof Error ? error.message : 'Copiá el enlace manualmente.'; status.classList.add('error'); }
      });
  });
  modal.querySelector<HTMLButtonElement>('[data-close-invitation-link]')?.addEventListener('click', () => location.reload());
  modal.addEventListener('click', (event) => { if (event.target === modal) location.reload(); });
  document.body.append(modal);
  input?.focus();
  input?.select();
}

async function createInvitation(form: HTMLFormElement): Promise<void> {
  const session = getCloudSession();
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!session) {
    feedback(form, 'La sesión venció. Volvé a ingresar.', true);
    return;
  }

  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  const email = String(data.get('email') || '').trim().toLowerCase();
  const role = String(data.get('role') || 'Corredor');
  if (!name || !email) {
    feedback(form, 'Completá nombre y correo.', true);
    return;
  }

  if (submit) submit.disabled = true;
  feedback(form, 'Creando enlace seguro…');
  try {
    const payload = await responsePayload(await fetch('/api/team/invitations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, email, role }),
    }));
    if (!payload.success || !payload.inviteLink) throw new Error(payload.error || 'El servidor no devolvió el enlace de acceso.');
    feedback(form, payload.linkType === 'recovery' ? 'Enlace renovado. Copialo para enviarlo.' : 'Invitación creada. Copiá el enlace para enviarlo.');
    showInvitationLink(payload.inviteLink, email, payload.linkType);
  } catch (error) {
    feedback(form, error instanceof Error ? error.message : 'No se pudo crear el enlace.', true);
    if (submit) submit.disabled = false;
  }
}

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (form.id !== 'mvp-user-form') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void createInvitation(form);
}, true);
