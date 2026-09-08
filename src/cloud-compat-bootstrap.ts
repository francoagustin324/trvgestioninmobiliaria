import { isLegacySchemaError, pushCloudData } from './cloud-api-compatible.js';
import { state } from './store.js';
import { currentTenantScope, tenantScopesEqual } from './tenant-runtime.js';
import type { TenantScope } from './active-organization.js';

let recovering = false;

document.addEventListener('propcontrol-cloud-status', (event) => {
  const custom = event as CustomEvent<{ scope?: TenantScope; message?: string; kind?: string }>;
  const message = String(custom.detail?.message || '');
  if (custom.detail?.kind !== 'error' || !isLegacySchemaError(new Error(message))) return;

  const activeScope = currentTenantScope();
  const eventScope = custom.detail?.scope;
  if (!activeScope || !eventScope || !tenantScopesEqual(activeScope, eventScope)) return;

  event.stopImmediatePropagation();
  if (recovering) return;
  recovering = true;
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
    detail: { scope: activeScope, message: 'Adaptando el guardado a la base actual…', kind: 'working' },
  }));

  void pushCloudData(activeScope, state.crm)
    .then(() => {
      document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
        detail: { scope: activeScope, message: 'Guardado en la nube.', kind: 'success' },
      }));
    })
    .catch((error) => {
      document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
        detail: {
          scope: activeScope,
          message: error instanceof Error ? error.message : 'No se pudo guardar en la nube.',
          kind: 'error',
        },
      }));
    })
    .finally(() => { recovering = false; });
}, true);
