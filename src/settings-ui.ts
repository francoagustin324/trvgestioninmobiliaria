import { recoveryGuidance } from './account-menu-product.js';
import { resolveTenantCommercialIdentity } from './configuration-domain.js';
import { defaultSettings, type Settings } from './models.js';
import { saveData, state } from './store.js';
import { canAccessSettings, canUseRecovery } from './team-access.js';
import { renderAccountMenu } from './mvp-auth.js';
import { escapeHtml, formValues } from './utils.js';

// Borrador de la foto: null = sin cambios respecto a lo guardado.
let avatarDraft: string | null = null;

function currentSettings(): Settings {
  return { ...defaultSettings, ...state.crm.settings };
}

function currentCommercialIdentity() {
  return resolveTenantCommercialIdentity({
    organization: state.crm.organization,
  });
}

function currentAvatar(): string {
  return avatarDraft !== null ? avatarDraft : currentSettings().avatar;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '·';
  return (parts[0]![0]! + (parts[1]?.[0] ?? '')).toUpperCase();
}

function avatarInner(): string {
  const avatar = currentAvatar();
  const name = (document.querySelector<HTMLInputElement>('#mvp-settings-form [name="profileName"]')?.value
    || currentSettings().profileName || 'Perfil');
  return avatar
    ? `<img src="${escapeHtml(avatar)}" alt="Foto de perfil">`
    : `<span>${escapeHtml(initialsOf(name))}</span>`;
}

// Reduce la foto a un cuadrado máximo de 256px y la guarda como data URI liviano.
function readAvatarFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onerror = () => reject(new Error('El archivo no es una imagen válida.'));
      img.onload = () => {
        const max = 256;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function updateAvatarPreview(container: HTMLElement): void {
  const preview = container.querySelector<HTMLElement>('#mvp-avatar-preview');
  const remove = container.querySelector<HTMLButtonElement>('[data-remove-avatar]');
  if (preview) preview.innerHTML = avatarInner();
  if (remove) remove.hidden = !currentAvatar();
}

export function renderSettings(container: HTMLElement): void {
  if (!canAccessSettings()) {
    avatarDraft = null;
    container.replaceChildren();
    return;
  }

  const s = currentSettings();
  const commercial = currentCommercialIdentity();
  const recoverySection = canUseRecovery()
    ? `<section class="mvp-settings-group" data-settings-security-recovery>
      <header><h2>Seguridad y recuperación</h2><p>Herramientas de contingencia para proteger la información de la inmobiliaria.</p></header>
      <div class="mvp-settings-avatar">
        <div class="mvp-avatar-actions">
          <strong>Recuperar copia anterior</strong>
          <small id="propcontrol-recovery-guidance">${escapeHtml(recoveryGuidance())} Nunca se ejecuta automáticamente.</small>
          <div data-settings-recovery-action></div>
        </div>
      </div>
    </section>`
    : '';

  container.innerHTML = `<div class="mvp-page-heading"><div><h1>Configuración</h1><p>Actualizá tu nombre de perfil y los datos de contacto que aparecen en las fichas públicas.</p></div></div>
  <form id="mvp-settings-form" class="mvp-settings">
    <section class="mvp-settings-group">
      <header><h2>Perfil</h2><p>El nombre se muestra en tu menú de cuenta. El correo de acceso no se modifica acá.</p></header>
      <div class="mvp-settings-avatar">
        <div class="mvp-avatar-preview" id="mvp-avatar-preview">${avatarInner()}</div>
        <div class="mvp-avatar-actions">
          <label class="mvp-file-btn">Cambiar foto<input type="file" accept="image/*" data-avatar-input hidden></label>
          <button type="button" class="quiet-button" data-remove-avatar${currentAvatar() ? '' : ' hidden'}>Quitar foto</button>
          <small>JPG o PNG. Se recorta a un tamaño chico para cargar rápido.</small>
        </div>
      </div>
      <div class="mvp-settings-grid">
        <label>Nombre<input name="profileName" value="${escapeHtml(s.profileName)}" placeholder="Tu nombre"></label>
      </div>
    </section>

    <section class="mvp-settings-group">
      <header><h2>Tu inmobiliaria</h2><p>Estos datos aparecen en las fichas que compartís con tus clientes.</p></header>
      <div class="mvp-settings-grid">
        <label>Nombre de la inmobiliaria<input name="agencyName" value="${escapeHtml(commercial.name)}" placeholder="Ej. Inmobiliaria Norte" readonly></label>
        <label>WhatsApp de contacto<input name="agencyWhatsapp" value="${escapeHtml(commercial.commercialPhone)}" inputmode="tel" placeholder="Ej. +54 9 351 555-0000"></label>
        <label>Logo público (URL o ruta)<input name="agencyLogoPath" value="${escapeHtml(commercial.logoPath)}" placeholder="Ej. https://.../logo.png"></label>
      </div>
      <label>Texto legal al pie de la ficha<textarea name="agencyLegal" rows="2" placeholder="Aclaración legal que aparece en cada ficha.">${escapeHtml(commercial.legalText)}</textarea></label>
    </section>

    ${recoverySection}

    <div class="mvp-settings-actions">
      <span class="mvp-settings-saved" data-saved hidden>Cambios guardados ✓</span>
      <button type="submit">Guardar cambios</button>
    </div>
  </form>`;

  const form = container.querySelector<HTMLFormElement>('#mvp-settings-form');
  const avatarInput = container.querySelector<HTMLInputElement>('[data-avatar-input]');
  const nameInput = container.querySelector<HTMLInputElement>('[name="profileName"]');

  nameInput?.addEventListener('input', () => { if (!currentAvatar()) updateAvatarPreview(container); });

  avatarInput?.addEventListener('change', () => {
    if (!canAccessSettings()) return;
    const file = avatarInput.files?.[0];
    if (!file) return;
    readAvatarFile(file)
      .then((dataUrl) => {
        if (!canAccessSettings()) return;
        avatarDraft = dataUrl;
        updateAvatarPreview(container);
      })
      .catch((error: unknown) => window.alert(error instanceof Error ? error.message : 'No se pudo cargar la imagen.'));
  });

  container.querySelector<HTMLButtonElement>('[data-remove-avatar]')?.addEventListener('click', () => {
    if (!canAccessSettings()) return;
    avatarDraft = '';
    if (avatarInput) avatarInput.value = '';
    updateAvatarPreview(container);
  });

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!canAccessSettings()) {
      avatarDraft = null;
      container.replaceChildren();
      return;
    }
    const values = formValues(form);
    const agencyName = currentCommercialIdentity().name;
    const agencyWhatsapp = (values.agencyWhatsapp ?? '').trim();
    const agencyLogoPath = (values.agencyLogoPath ?? '').trim();
    const agencyLegal = (values.agencyLegal ?? '').trim();
    state.crm.organization = {
      ...state.crm.organization,
      name: state.crm.organization.name.trim(),
      commercialPhone: agencyWhatsapp,
      logoPath: agencyLogoPath,
      legalText: agencyLegal,
    };
    state.crm.settings = {
      ...currentSettings(),
      profileName: (values.profileName ?? '').trim(),
      avatar: currentAvatar(),
      agencyName,
      agencyWhatsapp,
      agencyLegal,
    };
    avatarDraft = null;
    saveData('Configuración actualizada');
    renderAccountMenu();
    document.dispatchEvent(new CustomEvent('propcontrol-account-menu-rendered'));
    const saved = form.querySelector<HTMLElement>('[data-saved]');
    if (saved) {
      saved.hidden = false;
      window.setTimeout(() => { saved.hidden = true; }, 2600);
    }
  });
}
