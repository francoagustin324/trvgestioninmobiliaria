import { isLegacySchemaError, pushCloudData } from './cloud-api-compatible.js';
import { state } from './store.js';
import {
  captureTenantRuntimeLease,
  currentTenantScope,
  tenantRuntimeKey,
  tenantRuntimeLeaseIsCurrent,
  tenantScopesEqual,
  type TenantRuntimeLease,
} from './tenant-runtime.js';
import type { TenantScope } from './active-organization.js';

const recoveringTenantKeys = new Set<string>();

type ScopedCloudStatus = {
  scope?: TenantScope;
  runtimeLease?: TenantRuntimeLease;
  message?: string;
  kind?: string;
};

function scopedAsyncEventIsCurrent(detail: ScopedCloudStatus): boolean {
  if (!detail.scope) return true;
  const activeScope = currentTenantScope();
  if (!activeScope || !tenantScopesEqual(activeScope, detail.scope)) return false;
  return !detail.runtimeLease || tenantRuntimeLeaseIsCurrent(detail.runtimeLease);
}

document.addEventListener('propcontrol-cloud-status', (event) => {
  const custom = event as CustomEvent<ScopedCloudStatus>;
  if (!scopedAsyncEventIsCurrent(custom.detail ?? {})) {
    event.stopImmediatePropagation();
    return;
  }

  const message = String(custom.detail?.message || '');
  if (custom.detail?.kind !== 'error' || !isLegacySchemaError(new Error(message))) return;

  const activeScope = currentTenantScope();
  const eventScope = custom.detail?.scope;
  if (!activeScope || !eventScope || !tenantScopesEqual(activeScope, eventScope)) return;

  event.stopImmediatePropagation();
  const retryKey = tenantRuntimeKey(activeScope);
  if (recoveringTenantKeys.has(retryKey)) return;
  recoveringTenantKeys.add(retryKey);
  const retryScope: TenantScope = Object.freeze({ ...activeScope });
  const retryLease = captureTenantRuntimeLease(retryScope);
  const retrySnapshot = structuredClone(state.crm);

  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
    detail: {
      scope: retryScope,
      runtimeLease: retryLease,
      message: 'Adaptando el guardado a la base actual…',
      kind: 'working',
    },
  }));

  void pushCloudData(retryScope, retrySnapshot)
    .then(() => {
      document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
        detail: {
          scope: retryScope,
          runtimeLease: retryLease,
          message: 'Guardado en la nube.',
          kind: 'success',
        },
      }));
    })
    .catch((error) => {
      document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
        detail: {
          scope: retryScope,
          runtimeLease: retryLease,
          message: error instanceof Error ? error.message : 'No se pudo guardar en la nube.',
          kind: 'error',
        },
      }));
    })
    .finally(() => { recoveringTenantKeys.delete(retryKey); });
}, true);

document.addEventListener('propcontrol-cloud-authoritative-snapshot', (event) => {
  const custom = event as CustomEvent<{ scope?: TenantScope; runtimeLease?: TenantRuntimeLease }>;
  const detail = custom.detail;
  if (!detail?.scope || !detail.runtimeLease) {
    event.stopImmediatePropagation();
    return;
  }
  const activeScope = currentTenantScope();
  if (
    !activeScope
    || !tenantScopesEqual(activeScope, detail.scope)
    || !tenantRuntimeLeaseIsCurrent(detail.runtimeLease)
  ) {
    event.stopImmediatePropagation();
  }
}, true);
