import { canManageTeam } from './team-access.js';

const RECOVERY_GUIDANCE = 'Usar solo si faltan datos o soporte lo recomienda.';
let observerInstalled = false;
let organizationQueued = false;

/**
 * Ajusta la jerarquía del menú sin modificar sincronización ni recuperación:
 * - oculta la acción manual cuando la nube ya está al día;
 * - mueve el mismo botón de recuperación, con su handler existente, a Configuración;
 * - elimina la acción del DOM para usuarios sin permiso.
 */
export function organizeAccountMenuProductActions(): void {
  const menu = document.querySelector<HTMLElement>('.mvp-account-menu');
  if (!menu) return;

  if (menu.querySelector('.mvp-account-sync.state-saved')) {
    menu.querySelector<HTMLElement>('[data-account-sync]')?.remove();
  }

  const restore = menu.querySelector<HTMLButtonElement>('[data-account-restore]');
  if (!restore) return;

  const recoveryTarget = document.querySelector<HTMLElement>('[data-settings-recovery-action]');
  if (!canManageTeam() || !recoveryTarget) {
    restore.remove();
    return;
  }

  restore.className = 'quiet-button';
  restore.innerHTML = 'Recuperar copia anterior';
  restore.setAttribute('aria-describedby', 'propcontrol-recovery-guidance');
  recoveryTarget.replaceChildren(restore);
}

function queueOrganization(): void {
  if (organizationQueued) return;
  organizationQueued = true;
  queueMicrotask(() => {
    organizationQueued = false;
    organizeAccountMenuProductActions();
  });
}

function mutationTouchesAccountMenu(mutation: MutationRecord): boolean {
  const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  if (target?.closest('#cloud-account')) return true;
  return [...mutation.addedNodes].some((node) => {
    if (!(node instanceof Element)) return false;
    return node.id === 'cloud-account'
      || node.matches('.mvp-account-menu')
      || Boolean(node.querySelector('#cloud-account, .mvp-account-menu'));
  });
}

/**
 * El menú se vuelve a renderizar desde varios flujos existentes. Este observador
 * mantiene la jerarquía de producto después de cualquier reemplazo tardío del
 * contenedor, sin agregar handlers ni ejecutar acciones técnicas.
 */
export function installAccountMenuProductObserver(): void {
  if (observerInstalled || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  observerInstalled = true;
  const observer = new MutationObserver((mutations) => {
    if (mutations.some(mutationTouchesAccountMenu)) queueOrganization();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

export function recoveryGuidance(): string {
  return RECOVERY_GUIDANCE;
}

installAccountMenuProductObserver();
