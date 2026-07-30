import { canUseRecovery } from './team-access.js';

const RECOVERY_GUIDANCE = 'Usar solo si faltan datos o soporte lo recomienda.';
let observerInstalled = false;
let recoveryGuardInstalled = false;

function removeUnauthorizedRecoveryControls(): void {
  if (canUseRecovery()) return;
  document.querySelectorAll<HTMLElement>('[data-account-restore], [data-settings-security-recovery]')
    .forEach((element) => element.remove());
}

/**
 * Ajusta la jerarquía del menú sin modificar sincronización ni recuperación:
 * - oculta la acción manual cuando la nube ya está al día;
 * - mueve el mismo botón de recuperación, con su handler existente, a Configuración;
 * - elimina la acción y la sección del DOM para usuarios sin permiso.
 */
export function organizeAccountMenuProductActions(): void {
  removeUnauthorizedRecoveryControls();

  const menu = document.querySelector<HTMLElement>('.mvp-account-menu');
  if (!menu) return;

  if (menu.querySelector('.mvp-account-sync.state-saved')) {
    menu.querySelector<HTMLElement>('[data-account-sync]')?.remove();
  }

  const restore = menu.querySelector<HTMLButtonElement>('[data-account-restore]');
  if (!restore) return;

  const recoveryTarget = document.querySelector<HTMLElement>('[data-settings-recovery-action]');
  if (!canUseRecovery() || !recoveryTarget) {
    restore.remove();
    return;
  }

  restore.className = 'quiet-button';
  restore.innerHTML = 'Recuperar copia anterior';
  restore.setAttribute('aria-describedby', 'propcontrol-recovery-guidance');
  recoveryTarget.replaceChildren(restore);
}

function mutationTouchesAdministrativeUi(mutation: MutationRecord): boolean {
  const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  if (target?.closest('#cloud-account, #configuracion, #equipo')) return true;
  return [...mutation.addedNodes].some((node) => {
    if (!(node instanceof Element)) return false;
    return node.id === 'cloud-account'
      || node.id === 'configuracion'
      || node.id === 'equipo'
      || node.matches('.mvp-account-menu, [data-settings-security-recovery]')
      || Boolean(node.querySelector('#cloud-account, #configuracion, #equipo, .mvp-account-menu, [data-settings-security-recovery]'));
  });
}

function installRecoveryExecutionGuard(): void {
  if (recoveryGuardInstalled || typeof document === 'undefined') return;
  recoveryGuardInstalled = true;
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-account-restore]')
      : null;
    if (!target || canUseRecovery()) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    target.remove();
    removeUnauthorizedRecoveryControls();
  }, true);
}

/**
 * El menú y Configuración se vuelven a renderizar desde varios flujos existentes.
 * Este observador mantiene la presentación autorizada después de cualquier reemplazo
 * tardío del contenedor, sin agregar handlers técnicos ni ejecutar recuperación.
 */
export function installAccountMenuProductObserver(): void {
  if (observerInstalled || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  observerInstalled = true;
  const observer = new MutationObserver((mutations) => {
    if (mutations.some(mutationTouchesAdministrativeUi)) organizeAccountMenuProductActions();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

export function recoveryGuidance(): string {
  return RECOVERY_GUIDANCE;
}

installRecoveryExecutionGuard();
installAccountMenuProductObserver();
