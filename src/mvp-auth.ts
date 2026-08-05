import {
  accountIdentityPresentation,
  accountSyncPresentation,
} from './account-menu-presentation.js';
import { PRODUCT_BRAND } from './branding.js';
import {
  getCloudSession,
  pullCloudData,
  pushCloudData,
  signInCloud,
  signOutCloud,
  signUpCloud,
} from './cloud-api-compatible.js';
import { appIcons } from './icons.js';
import type { CrmData } from './models.js';
import { initialData } from './models.js';
import {
  activateStorageForCurrentSession,
  hasLocalBackup,
  replaceData,
  restoreLatestLocalBackup,
  setActiveMemberId,
  state,
} from './store.js';
import {
  authorizeConfirmedCloudResolution,
  reconcileCrmSnapshots,
  reconciliationMessage,
  restoreSyncStateSnapshot,
} from './sync-reconciliation.js';
import {
  getSyncState,
  hasPendingLocalChanges,
  markSyncError,
  stableFingerprint,
  writeLocalSnapshot,
} from './sync-safety.js';
import { canManageTeam } from './team-access.js';
import { escapeHtml } from './utils.js';

const ACCOUNT_PANEL_ID = 'propcontrol-account-panel';
let accountMenuEventsBound = false;

interface AccountMenuCloseOptions {
  restoreFocus?: boolean;
}

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) || '').trim();
}

function activateMember(): void {
  const session = getCloudSession();
  if (!session) return;
  const member = state.crm.teamMembers.find((item) => item.userId === session.userId && item.status !== 'Suspendido');
  if (member) setActiveMemberId(member.id);
}

function emptyOperationalData(crm: CrmData): CrmData {
  return {
    ...structuredClone(crm),
    activityLog: [],
    clients: [],
    properties: [],
    contacts: [],
    reminders: [],
    fichas: [],
    conversations: [],
  };
}

function isUntouchedDemoData(crm: CrmData): boolean {
  return stableFingerprint(crm) === stableFingerprint(initialData);
}

function dispatchCloudStatus(message: string, kind: 'success' | 'error' | 'working' = 'success'): void {
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', { detail: { message, kind } }));
}

function accountMenuRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.mvp-account-menu');
}

function updateAccountMenuState(open: boolean): void {
  document.body.classList.toggle('account-menu-open', open);
}

function setAccountMenuOpen(
  open: boolean,
  options: AccountMenuCloseOptions = {},
): void {
  const root = accountMenuRoot();
  const trigger = root?.querySelector<HTMLButtonElement>('[data-account-toggle]');
  const panel = root?.querySelector<HTMLElement>('.mvp-account-panel');
  const backdrop = root?.querySelector<HTMLElement>('[data-account-backdrop]');
  if (!root || !trigger || !panel || !backdrop) {
    updateAccountMenuState(false);
    return;
  }

  root.classList.toggle('is-open', open);
  trigger.setAttribute('aria-expanded', String(open));
  panel.hidden = !open;
  backdrop.hidden = !open;
  updateAccountMenuState(open);

  if (open) {
    queueMicrotask(() => {
      const firstAction = panel.querySelector<HTMLButtonElement>('.mvp-account-action:not([disabled])');
      (firstAction || panel).focus({ preventScroll: true });
    });
    return;
  }

  if (options.restoreFocus !== false && trigger.isConnected) {
    queueMicrotask(() => trigger.focus({ preventScroll: true }));
  }
}

export function closeAccountMenuPanel(options: AccountMenuCloseOptions = {}): void {
  setAccountMenuOpen(false, options);
}

function bindAccountMenuEvents(): void {
  if (accountMenuEventsBound) return;
  accountMenuEventsBound = true;

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const toggle = target.closest<HTMLElement>('[data-account-toggle]');
    if (toggle) {
      const menu = toggle.closest<HTMLElement>('.mvp-account-menu');
      setAccountMenuOpen(!menu?.classList.contains('is-open'));
      return;
    }
    if (target.closest('[data-account-backdrop]')) {
      closeAccountMenuPanel();
      return;
    }
    const openMenu = document.querySelector<HTMLElement>('.mvp-account-menu.is-open');
    if (openMenu && !target.closest('.mvp-account-menu')) closeAccountMenuPanel();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !document.querySelector('.mvp-account-menu.is-open')) return;
    event.preventDefault();
    closeAccountMenuPanel();
  });

  window.addEventListener('resize', () => {
    updateAccountMenuState(Boolean(document.querySelector('.mvp-account-menu.is-open')));
  });
  window.addEventListener('pagehide', () => updateAccountMenuState(false));
}

async function hydrateAfterAuth(): Promise<void> {
  activateStorageForCurrentSession();

  if (hasPendingLocalChanges()) {
    try {
      await pushCloudData(state.crm);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron sincronizar los cambios locales.';
      markSyncError(message);
      activateMember();
      return;
    }
  }

  const cloud = await pullCloudData(state.crm);
  if (cloud) {
    replaceData(cloud);
  } else {
    const firstData = isUntouchedDemoData(state.crm) ? emptyOperationalData(state.crm) : state.crm;
    if (firstData !== state.crm) replaceData(firstData);
    await pushCloudData(state.crm);
    const refreshed = await pullCloudData(state.crm);
    if (refreshed) replaceData(refreshed);
  }
  activateMember();
}

async function synchronizeNow(): Promise<void> {
  try {
    dispatchCloudStatus('Comprobando datos locales y de la nube…', 'working');
    if (hasPendingLocalChanges()) await pushCloudData(state.crm);
    const cloud = await pullCloudData(state.crm);
    if (cloud) replaceData(cloud);
    dispatchCloudStatus('Sincronización completada sin sobrescrituras.', 'success');
    document.dispatchEvent(new CustomEvent('trv-render'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo sincronizar.';
    markSyncError(message);
    dispatchCloudStatus(message, 'error');
  }
}

async function inspectCloudWithoutChangingLocalState(local: CrmData): Promise<{ cloud: CrmData | null; remoteVersion: string }> {
  const previousSyncState = getSyncState();
  try {
    const cloud = await pullCloudData(local);
    const inspectedState = getSyncState();
    return { cloud, remoteVersion: inspectedState.lastCloudVersion || '' };
  } finally {
    restoreSyncStateSnapshot(previousSyncState);
  }
}

function isDifferenceError(message: string | undefined): boolean {
  const text = String(message || '').toLowerCase();
  return text.includes('datos distintos') || text.includes('cambios más nuevos en la nube');
}

async function resolveSyncDifferences(): Promise<void> {
  const originalLocal = structuredClone(state.crm);
  try {
    dispatchCloudStatus('Revisando diferencias sin modificar tus datos…', 'working');
    const inspected = await inspectCloudWithoutChangingLocalState(originalLocal);
    if (!inspected.cloud || !inspected.remoteVersion) {
      throw new Error('No se encontró una copia válida en la nube. No se modificó ningún dato.');
    }

    const result = reconcileCrmSnapshots(originalLocal, inspected.cloud);
    if (!result.canMergeSafely) {
      const conflictNames = result.differences.flatMap((item) => item.conflicts).slice(0, 5).join(', ');
      throw new Error(`Hay ${result.conflictCount} registros editados de forma diferente en ambos dispositivos${conflictNames ? `: ${conflictNames}` : ''}. PropControl no modificó nada.`);
    }

    const hasDifferences = result.localOnlyCount > 0 || result.cloudOnlyCount > 0;
    if (hasDifferences && !window.confirm(`${reconciliationMessage(result)}\n\n¿Unir ambas copias y continuar?`)) {
      dispatchCloudStatus('No se realizó ningún cambio.', 'success');
      return;
    }

    const latestInspection = await inspectCloudWithoutChangingLocalState(originalLocal);
    if (!latestInspection.cloud || !latestInspection.remoteVersion) {
      throw new Error('No se pudo volver a comprobar la nube. No se modificó ningún dato.');
    }
    if (stableFingerprint(latestInspection.cloud) !== stableFingerprint(inspected.cloud)) {
      throw new Error('La nube cambió durante la revisión. PropControl frenó la operación para no sobrescribir información.');
    }

    const latestResult = reconcileCrmSnapshots(originalLocal, latestInspection.cloud);
    if (!latestResult.canMergeSafely) {
      throw new Error('Aparecieron cambios incompatibles durante la revisión. No se modificó ningún dato.');
    }

    replaceData(latestResult.merged);
    writeLocalSnapshot(state.crm, {
      markDirty: true,
      reason: 'Unión segura antes de sincronizar',
      backup: false,
    });
    authorizeConfirmedCloudResolution(latestInspection.remoteVersion);
    await pushCloudData(state.crm);

    const verified = await pullCloudData(state.crm);
    if (!verified) throw new Error('La nube no devolvió la copia verificada después de guardar.');
    const verification = reconcileCrmSnapshots(state.crm, verified);
    if (verification.localOnlyCount || verification.conflictCount) {
      throw new Error('La verificación final no coincidió. La copia local unida sigue protegida.');
    }
    replaceData(verified);
    activateMember();
    dispatchCloudStatus('Datos unidos y verificados. La computadora y la nube ya tienen la misma información.', 'success');
    document.dispatchEvent(new CustomEvent('trv-render'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudieron resolver las diferencias.';
    markSyncError(message);
    dispatchCloudStatus(message, 'error');
    document.dispatchEvent(new CustomEvent('trv-render'));
  }
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
    <video class="public-auth-bg" autoplay muted loop playsinline preload="auto" poster="/src/assets/fondo-inicio-poster.jpg?v=20260722-1"><source src="/src/assets/fondo-inicio.mp4?v=20260722-2" type="video/mp4"></video>
    <div class="public-auth-overlay" aria-hidden="true"></div>
    <section class="public-auth-brand">
      <div class="public-auth-lockup"><img src="${PRODUCT_BRAND.logo}" alt=""><strong>${PRODUCT_BRAND.name}</strong></div>
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
  await hydrateAfterAuth();
}

function actionMarkup(
  icon: string,
  label: string,
  description: string,
  attributes: string,
  options: { destructive?: boolean; disabled?: boolean } = {},
): string {
  const classes = ['mvp-account-action', options.destructive ? 'is-destructive' : ''].filter(Boolean).join(' ');
  return `<button type="button" class="${classes}" ${attributes}${options.disabled ? ' disabled aria-disabled="true"' : ''}>
    <span class="mvp-account-action-icon" aria-hidden="true">${icon}</span>
    <span class="mvp-account-action-copy"><strong>${escapeHtml(label)}</strong>${description ? `<small>${escapeHtml(description)}</small>` : ''}</span>
  </button>`;
}

export function renderAccountMenu(): void {
  const container = document.querySelector<HTMLElement>('#cloud-account');
  if (!container) return;
  bindAccountMenuEvents();
  closeAccountMenuPanel({ restoreFocus: false });

  const session = getCloudSession();
  if (!session) {
    container.innerHTML = '';
    return;
  }

  const authenticatedMember = state.crm.teamMembers.find(
    (item) => item.userId === session.userId && item.status !== 'Suspendido',
  );
  const activeMember = state.crm.teamMembers.find(
    (item) => item.id === state.activeMemberId && item.status !== 'Suspendido',
  );
  const settings = state.crm.settings;
  const identity = accountIdentityPresentation({
    settings,
    organization: state.crm.organization,
    authenticatedMember,
    activeMember,
    email: session.email,
    userId: session.userId,
  });
  const syncState = getSyncState();
  const sync = accountSyncPresentation(syncState);
  const differencePending = isDifferenceError(syncState.lastError);
  const backupAvailable = hasLocalBackup();
  const avatarGlyph = settings.avatar
    ? `<img src="${escapeHtml(settings.avatar)}" alt="">`
    : '<svg viewBox="0 0 24 24" role="img"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const syncAction = sync.kind === 'saved'
    ? ''
    : differencePending
      ? actionMarkup(
          appIcons.sync,
          'Revisar y unir datos',
          'Resolver diferencias sin sobrescribir',
          'data-account-resolve aria-label="Revisar y unir datos" title="Revisar y unir datos"',
        )
      : actionMarkup(
          appIcons.sync,
          'Sincronizar ahora',
          'Guardar y comprobar la nube',
          'data-account-sync aria-label="Sincronizar de forma segura" title="Sincronizar de forma segura"',
        );
  const restoreAction = actionMarkup(
    appIcons.history,
    'Recuperar copia anterior',
    backupAvailable ? 'Usar la copia local anterior' : 'No hay copias disponibles',
    'data-account-restore aria-label="Recuperar copia anterior" title="Recuperar copia anterior" aria-describedby="propcontrol-recovery-guidance"',
    { disabled: !backupAvailable },
  );
  const logoutAction = actionMarkup(
    appIcons.logout,
    'Cerrar sesión',
    'Salir de esta cuenta',
    'data-account-logout aria-label="Cerrar sesión" title="Cerrar sesión"',
    { destructive: true },
  );
  const identityName = escapeHtml(identity.name);
  const identityDetail = escapeHtml(identity.detail);
  const syncFullLabel = escapeHtml(sync.fullLabel);

  container.innerHTML = `<div class="mvp-account-menu" data-account-menu>
    <button type="button" class="mvp-account-trigger" data-account-toggle aria-controls="${ACCOUNT_PANEL_ID}" aria-expanded="false" aria-haspopup="dialog" aria-label="Abrir menú de cuenta de ${identityName}" title="Abrir menú de cuenta">
      <span class="mvp-account-avatar${settings.avatar ? ' has-photo' : ''}" aria-hidden="true">${avatarGlyph}</span>
    </button>
    <button type="button" class="mvp-account-backdrop" data-account-backdrop aria-label="Cerrar menú de cuenta" tabindex="-1" hidden></button>
    <section class="mvp-account-panel" id="${ACCOUNT_PANEL_ID}" role="dialog" aria-labelledby="propcontrol-account-name" tabindex="-1" hidden>
      <header class="mvp-account-identity">
        <span class="mvp-account-identity-avatar${settings.avatar ? ' has-photo' : ''}" aria-hidden="true">${avatarGlyph}</span>
        <span class="mvp-account-identity-copy">
          <strong id="propcontrol-account-name">${identityName}</strong>
          <small>${identityDetail}</small>
        </span>
      </header>
      <div class="mvp-account-sync state-${sync.kind}" role="status" aria-label="${syncFullLabel}" title="${syncFullLabel}">
        <span class="mvp-account-sync-icon" aria-hidden="true">${appIcons.cloudCheck}</span>
        <span><strong>${escapeHtml(sync.label)}</strong>${sync.detail ? `<small>${escapeHtml(sync.detail)}</small>` : ''}</span>
      </div>
      <div class="mvp-account-actions" aria-label="Acciones de cuenta">
        ${syncAction}
      </div>
      <div class="mvp-account-danger">${logoutAction}</div>
    </section>
  </div>`;

  const recoveryTarget = canManageTeam()
    ? document.querySelector<HTMLElement>('[data-settings-recovery-action]')
    : null;
  if (recoveryTarget) recoveryTarget.innerHTML = restoreAction;

  container.querySelector<HTMLElement>('[data-account-sync]')?.addEventListener('click', () => {
    closeAccountMenuPanel({ restoreFocus: false });
    void synchronizeNow();
  });
  container.querySelector<HTMLElement>('[data-account-resolve]')?.addEventListener('click', () => {
    closeAccountMenuPanel({ restoreFocus: false });
    void resolveSyncDifferences();
  });
  recoveryTarget?.querySelector<HTMLElement>('[data-account-restore]')?.addEventListener('click', () => {
    closeAccountMenuPanel({ restoreFocus: false });
    if (!window.confirm('Se recuperará la copia local anterior y quedará pendiente de sincronización. ¿Continuar?')) return;
    if (!restoreLatestLocalBackup()) return;
    dispatchCloudStatus('Copia anterior recuperada. PropControl la guardará sin sobrescribir cambios más nuevos.', 'success');
    document.dispatchEvent(new CustomEvent('trv-render'));
  });
  container.querySelector<HTMLElement>('[data-account-logout]')?.addEventListener('click', () => {
    closeAccountMenuPanel({ restoreFocus: false });
    signOutCloud();
    location.assign('/login');
  });
}
