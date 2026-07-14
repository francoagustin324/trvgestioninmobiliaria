import { isLegacySchemaError, pushCloudData } from './cloud-api-compatible.js';
import { state } from './store.js';

let recovering = false;

document.addEventListener('propcontrol-cloud-status', (event) => {
  const custom = event as CustomEvent<{ message?: string; kind?: string }>;
  const message = String(custom.detail?.message || '');
  if (custom.detail?.kind !== 'error' || !isLegacySchemaError(new Error(message))) return;

  event.stopImmediatePropagation();
  if (recovering) return;
  recovering = true;
  document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
    detail: { message: 'Adaptando el guardado a la base actual…', kind: 'working' },
  }));

  void pushCloudData(state.crm)
    .then(() => {
      document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
        detail: { message: 'Guardado en la nube.', kind: 'success' },
      }));
    })
    .catch((error) => {
      document.dispatchEvent(new CustomEvent('propcontrol-cloud-status', {
        detail: {
          message: error instanceof Error ? error.message : 'No se pudo guardar en la nube.',
          kind: 'error',
        },
      }));
    })
    .finally(() => { recovering = false; });
}, true);
