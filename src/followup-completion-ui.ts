import type { Client } from './models.js';
import { localIsoDate, type FollowUpCompletionDecision } from './lead-pipeline.js';
import { escapeHtml } from './utils.js';

const DIALOG_SELECTOR = '[data-followup-completion-dialog]';

function removeDialog(dialog: HTMLDialogElement): void {
  if (dialog.open && typeof dialog.close === 'function') dialog.close();
  dialog.remove();
}

export function requestFollowUpCompletion(
  client: Client,
  onConfirm: (decision: FollowUpCompletionDecision) => void,
): void {
  document.querySelector<HTMLDialogElement>(DIALOG_SELECTOR)?.remove();

  const today = localIsoDate();
  const dialog = document.createElement('dialog');
  dialog.className = 'pc-commercial-close-dialog';
  dialog.dataset.followupCompletionDialog = String(client.id);
  dialog.innerHTML = `<div class="pc-close-modal-form">
    <header>
      <div><small>Seguimiento</small><h3>Completar gestión de ${escapeHtml(client.name)}</h3></div>
      <button type="button" class="quiet-button" data-followup-cancel aria-label="Cancelar">×</button>
    </header>
    <p>Elegí qué pasa después. No se guardará nada hasta confirmar una opción.</p>
    <form data-followup-scheduled-form>
      <div class="pc-close-grid">
        <label class="pc-close-wide">Próximo compromiso
          <input name="nextAction" value="" placeholder="Ej. Llamar para confirmar visita" required>
        </label>
        <label>Fecha
          <input name="nextFollowUp" type="date" min="${today}" value="${today}" required>
        </label>
      </div>
      <p class="form-error" data-followup-error hidden></p>
      <footer>
        <button type="submit">Programar próximo compromiso</button>
      </footer>
    </form>
    <footer>
      <button type="button" class="secondary" data-followup-none>Sin seguimiento por ahora</button>
      <button type="button" class="quiet-button" data-followup-cancel>Cancelar</button>
    </footer>
  </div>`;

  const cancel = (): void => removeDialog(dialog);
  dialog.querySelectorAll<HTMLButtonElement>('[data-followup-cancel]').forEach((button) => {
    button.addEventListener('click', cancel);
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    cancel();
  });

  dialog.querySelector<HTMLButtonElement>('[data-followup-none]')?.addEventListener('click', () => {
    onConfirm({ kind: 'none' });
    removeDialog(dialog);
  });

  dialog.querySelector<HTMLFormElement>('[data-followup-scheduled-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const nextAction = String(data.get('nextAction') || '').trim();
    const nextFollowUp = String(data.get('nextFollowUp') || '').trim();
    const error = form.querySelector<HTMLElement>('[data-followup-error]');
    const invalid = !nextAction || !/^\d{4}-\d{2}-\d{2}$/.test(nextFollowUp) || nextFollowUp < today;
    if (invalid) {
      if (error) {
        error.textContent = !nextAction
          ? 'Indicá el próximo compromiso.'
          : 'Elegí una fecha de hoy en adelante.';
        error.hidden = false;
      }
      return;
    }
    onConfirm({ kind: 'scheduled', nextAction, nextFollowUp });
    removeDialog(dialog);
  });

  document.body.append(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  window.requestAnimationFrame(() => {
    dialog.querySelector<HTMLInputElement>('input[name="nextAction"]')?.focus();
  });
}
