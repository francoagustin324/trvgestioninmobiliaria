export const TENANT_RECOVERY_CUTOVER_REQUIRED = 'TENANT_RECOVERY_CUTOVER_REQUIRED';

function dispatchRecoveryCutoverRequired(): void {
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
    detail: {
      message: `${TENANT_RECOVERY_CUTOVER_REQUIRED}: la resolución de diferencias queda bloqueada hasta completar el cutover tenant de recovery. No se modificó ningún dato.`,
      kind: 'error',
    },
  }));
}

/**
 * C1 fail-closed boundary.
 *
 * The historical recovery algorithm mixes CRM state with user-only sync
 * metadata. A1.2-F owns the complete tenant-aware recovery cutover. Until then
 * this capture listener blocks the older handler before it can read, write,
 * pull or push CRM data.
 */
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-account-resolve]')
    : null;
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  dispatchRecoveryCutoverRequired();
}, true);
