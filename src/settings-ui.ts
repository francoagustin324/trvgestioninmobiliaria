import { defaultSettings, type Settings } from './models.js';
import { saveData, state } from './store.js';
import { renderAccountMenu } from './mvp-auth.js';
import { escapeHtml, formValues } from './utils.js';

// Borrador de la foto: null = sin cambios respecto a lo guardado.
let avatarDraft: string | null = null;

function currentSettings(): Settings {
  return { ...defaultSettings, ...state.crm.settings };
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
  const s = currentSettings();
  const currencyOptions = ['USD', 'ARS']
    .map((code) => `<option value="${code}"${s.currency === code ? ' selected' : ''}>${code}</option>`)
    .join('');

  container.innerHTML = `<div class="mvp-page-heading"><div><h1>Configuración</h1><p>Tu perfil, los datos de la inmobiliaria y las preferencias de la app.</p></div></div>
  <form id="mvp-settings-form" class="mvp-settings">
    <section class="mvp-settings-group">
      <header><h2>Perfil</h2><p>Cómo te ve el equipo dentro de PropControl.</p></header>
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
        <label>Email<input name="profileEmail" type="email" value="${escapeHtml(s.profileEmail)}" placeholder="tucorreo@ejemplo.com"></label>
        <label>Teléfono<input name="profilePhone" value="${escapeHtml(s.profilePhone)}" inputmode="tel" placeholder="Ej. 351 555-0000"></label>
      </div>
    </section>

    <section class="mvp-settings-group">
      <header><h2>Tu inmobiliaria</h2><p>Estos datos aparecen en las fichas que compartís con tus clientes.</p></header>
      <div class="mvp-settings-grid">
        <label>Nombre de la inmobiliaria<input name="agencyName" value="${escapeHtml(s.agencyName)}" placeholder="TRV Gestión Inmobiliaria"></label>
        <label>WhatsApp de contacto<input name="agencyWhatsapp" value="${escapeHtml(s.agencyWhatsapp)}" inputmode="tel" placeholder="Ej. 3515110069"></label>
      </div>
      <label>Texto legal al pie de la ficha<textarea name="agencyLegal" rows="2" placeholder="Aclaración legal que aparece en cada ficha.">${escapeHtml(s.agencyLegal)}</textarea></label>
    </section>

    <section class="mvp-settings-group">
      <header><h2>Preferencias</h2><p>Ajustes que cambian cómo trabaja la app.</p></header>
      <div class="mvp-settings-grid">
        <label>Moneda por defecto<select name="currency">${currencyOptions}</select></label>
        <label>Zona por defecto<input name="defaultZone" value="${escapeHtml(s.defaultZone)}" placeholder="Ej. Nueva Córdoba"></label>
        <label>Días para marcar un seguimiento como vencido<input name="overdueDays" type="number" min="1" max="60" value="${escapeHtml(String(s.overdueDays))}"></label>
      </div>
      <label>Mensaje al compartir una ficha por WhatsApp<textarea name="shareText" rows="2" placeholder="Hola, te comparto esta propiedad que puede interesarte:">${escapeHtml(s.shareText)}</textarea><small>Se usa como texto sugerido cuando compartís una ficha.</small></label>
    </section>

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
    const file = avatarInput.files?.[0];
    if (!file) return;
    readAvatarFile(file)
      .then((dataUrl) => { avatarDraft = dataUrl; updateAvatarPreview(container); })
      .catch((error: unknown) => window.alert(error instanceof Error ? error.message : 'No se pudo cargar la imagen.'));
  });

  container.querySelector<HTMLButtonElement>('[data-remove-avatar]')?.addEventListener('click', () => {
    avatarDraft = '';
    if (avatarInput) avatarInput.value = '';
    updateAvatarPreview(container);
  });

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = formValues(form);
    const parsedDays = Number.parseInt(values.overdueDays ?? '', 10);
    state.crm.settings = {
      ...currentSettings(),
      profileName: (values.profileName ?? '').trim(),
      profileEmail: (values.profileEmail ?? '').trim(),
      profilePhone: (values.profilePhone ?? '').trim(),
      avatar: currentAvatar(),
      agencyName: (values.agencyName ?? '').trim(),
      agencyWhatsapp: (values.agencyWhatsapp ?? '').trim(),
      agencyLegal: (values.agencyLegal ?? '').trim(),
      currency: values.currency === 'ARS' ? 'ARS' : 'USD',
      defaultZone: (values.defaultZone ?? '').trim(),
      shareText: (values.shareText ?? '').trim(),
      overdueDays: Number.isFinite(parsedDays) && parsedDays > 0 ? Math.min(parsedDays, 60) : defaultSettings.overdueDays,
    };
    avatarDraft = null;
    saveData('Configuración actualizada');
    renderAccountMenu();
    const saved = form.querySelector<HTMLElement>('[data-saved]');
    if (saved) {
      saved.hidden = false;
      window.setTimeout(() => { saved.hidden = true; }, 2600);
    }
  });
}
