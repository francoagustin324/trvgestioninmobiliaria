import { PRODUCT_BRAND } from './branding.js';
import {
  getCloudSession,
  pullCloudData,
  pushCloudData,
  signInCloud,
  signOutCloud,
  signUpCloud,
} from './cloud-api-compatible.js';
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
  syncStatusLabel,
  writeLocalSnapshot,
} from './sync-safety.js';
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

export function renderAccountMenu(): void {
  const container = document.querySelector<HTMLElement>('#cloud-account');
  if (!container) return;
  const session = getCloudSession();
  const member = session ? state.crm.teamMembers.find((item) => item.userId === session.userId) : null;
  if (!session) { container.innerHTML = ''; return; }
  const accountName = member?.name || state.crm.organization.name || 'Cuenta PropControl';
  const accountDetail = member?.role || session.email;
  const syncState = getSyncState();
  const syncLabel = syncStatusLabel(syncState);
  const differencePending = isDifferenceError(syncState.lastError);
  const syncButton = differencePending
    ? '<button type="button" data-account-resolve>Revisar y unir datos</button>'
    : '<button type="button" data-account-sync>Sincronizar de forma segura</button>';
  const restoreButton = hasLocalBackup()
    ? '<button type="button" data-account-restore>Recuperar copia anterior</button>'
    : '';
  container.innerHTML = `<details class="mvp-account-menu">
    <summary aria-label="Abrir menú de cuenta"><span class="mvp-account-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" role="img"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span></summary>
    <div><header><b>${escapeHtml(accountName)}</b><small>${escapeHtml(accountDetail)}</small><small title="${escapeHtml(syncState.lastError || '')}">${escapeHtml(syncLabel)}</small></header>${syncButton}${restoreButton}<button type="button" data-account-logout>Cerrar sesión</button></div>
  </details>`;
  container.querySelector<HTMLElement>('[data-account-sync]')?.addEventListener('click', () => void synchronizeNow());
  container.querySelector<HTMLElement>('[data-account-resolve]')?.addEventListener('click', () => void resolveSyncDifferences());
  container.querySelector<HTMLElement>('[data-account-restore]')?.addEventListener('click', () => {
    if (!window.confirm('Se recuperará la copia local anterior y quedará pendiente de sincronización. ¿Continuar?')) return;
    if (!restoreLatestLocalBackup()) return;
    dispatchCloudStatus('Copia anterior recuperada. PropControl la guardará sin sobrescribir cambios más nuevos.', 'success');
    document.dispatchEvent(new CustomEvent('trv-render'));
  });
  container.querySelector<HTMLElement>('[data-account-logout]')?.addEventListener('click', () => { signOutCloud(); location.assign('/login'); });
}
