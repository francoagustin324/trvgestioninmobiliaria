import {
  pullCloudData,
  pushCloudData,
} from './cloud-api-compatible.js';
import type { CrmData } from './models.js';
import {
  replaceData,
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
  markSyncError,
  stableFingerprint,
} from './sync-safety.js';

function dispatchCloudStatus(message: string, kind: 'success' | 'error' | 'working' = 'success'): void {
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', { detail: { message, kind } }));
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

function conflictSummary(result: ReturnType<typeof reconcileCrmSnapshots>): string {
  if (!result.conflictCount) return '';
  const names = result.differences
    .flatMap((item) => item.conflicts)
    .filter(Boolean)
    .slice(0, 8);
  const detail = names.length ? `: ${names.join(', ')}` : '';
  return `\n\nTambién hay ${result.conflictCount} registros existentes con diferencias${detail}. En esos casos se conservará la versión de esta computadora. Los registros exclusivos de la nube también se conservarán.`;
}

function hasAnyDifference(result: ReturnType<typeof reconcileCrmSnapshots>): boolean {
  return Boolean(result.localOnlyCount || result.cloudOnlyCount || result.conflictCount);
}

async function resolveUsingComputerAsConfirmedSource(): Promise<void> {
  const originalLocal = structuredClone(state.crm);
  try {
    dispatchCloudStatus('Revisando diferencias sin modificar tus datos…', 'working');
    const inspected = await inspectCloudWithoutChangingLocalState(originalLocal);
    if (!inspected.cloud || !inspected.remoteVersion) {
      throw new Error('No se encontró una copia válida en la nube. No se modificó ningún dato.');
    }

    const result = reconcileCrmSnapshots(originalLocal, inspected.cloud);
    if (!hasAnyDifference(result)) {
      replaceData(inspected.cloud);
      dispatchCloudStatus('La computadora y la nube ya tienen la misma información.', 'success');
      document.dispatchEvent(new CustomEvent('trv-render'));
      return;
    }

    const confirmation = `${reconciliationMessage(result)}${conflictSummary(result)}\n\nNo se eliminará ningún registro. ¿Usar esta computadora como fuente confirmada y continuar?`;
    if (!window.confirm(confirmation)) {
      dispatchCloudStatus('No se realizó ningún cambio.', 'success');
      return;
    }

    dispatchCloudStatus('Volviendo a comprobar la nube antes de guardar…', 'working');
    const latestInspection = await inspectCloudWithoutChangingLocalState(originalLocal);
    if (!latestInspection.cloud || !latestInspection.remoteVersion) {
      throw new Error('No se pudo volver a comprobar la nube. No se modificó ningún dato.');
    }
    if (stableFingerprint(latestInspection.cloud) !== stableFingerprint(inspected.cloud)) {
      throw new Error('La nube cambió durante la revisión. PropControl frenó la operación para no sobrescribir información.');
    }

    const latestResult = reconcileCrmSnapshots(originalLocal, latestInspection.cloud);
    replaceData(latestResult.merged);
    authorizeConfirmedCloudResolution(latestInspection.remoteVersion);

    dispatchCloudStatus('Guardando la copia unida con protección…', 'working');
    await pushCloudData(state.crm);

    const verified = await pullCloudData(state.crm);
    if (!verified) throw new Error('La nube no devolvió la copia verificada después de guardar.');

    const verification = reconcileCrmSnapshots(state.crm, verified);
    if (verification.localOnlyCount || verification.cloudOnlyCount || verification.conflictCount) {
      throw new Error('La verificación final no coincidió. La copia local unida sigue protegida.');
    }

    replaceData(verified);
    dispatchCloudStatus('Datos unidos y verificados. La computadora y el celular ya pueden mostrar la misma información.', 'success');
    document.dispatchEvent(new CustomEvent('trv-render'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudieron resolver las diferencias.';
    markSyncError(message);
    dispatchCloudStatus(message, 'error');
    document.dispatchEvent(new CustomEvent('trv-render'));
  }
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-account-resolve]')
    : null;
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  void resolveUsingComputerAsConfirmedSource();
}, true);
