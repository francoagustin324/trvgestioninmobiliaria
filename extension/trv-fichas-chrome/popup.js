const status = document.querySelector('#status');
const currentButton = document.querySelector('#import-current');
const openButton = document.querySelector('#open-import');
const urlInput = document.querySelector('#property-url');
const stagingInput = document.querySelector('#staging-origin');
const saveStagingButton = document.querySelector('#save-staging-origin');
const stagingDestination = globalThis.ordenbrokerStagingDestination;
let stagingOrigin = null;

function setStatus(kind, message) {
  status.className = kind;
  status.textContent = message;
}

function setBusy(busy) {
  currentButton.disabled = busy || !stagingOrigin;
  openButton.disabled = busy || !stagingOrigin;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.success) {
        reject(new Error(response?.error || 'No se pudo importar la propiedad.'));
        return;
      }
      resolve(response);
    });
  });
}

setBusy(false);

stagingInput.addEventListener('input', () => {
  stagingOrigin = null;
  setBusy(false);
});

saveStagingButton.addEventListener('click', async () => {
  stagingOrigin = null;
  setBusy(false);
  const candidate = stagingDestination.parse(stagingInput.value);
  if (!candidate) {
    setStatus('error', 'Ingresá una URL HTTPS válida de OrdenBroker staging. Producción no está permitida.');
    return;
  }
  saveStagingButton.disabled = true;
  try {
    const granted = await chrome.permissions.request({ origins: [candidate + '/*'] });
    if (!granted) throw new Error('Chrome necesita permiso para el destino de prueba.');
    await chrome.storage.local.set({ [stagingDestination.storageKey]: candidate });
    stagingOrigin = candidate;
    stagingInput.value = candidate;
    setStatus('success', 'Destino de prueba guardado: OrdenBroker staging.');
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : 'No se pudo guardar el destino de prueba.');
  } finally {
    saveStagingButton.disabled = false;
    setBusy(false);
  }
});

void chrome.storage.local.get(stagingDestination.storageKey).then(async (saved) => {
  const configured = stagingDestination.parse(saved[stagingDestination.storageKey]);
  if (!configured) {
    setStatus('error', 'Antes de importar, configurá y autorizá la URL de OrdenBroker staging.');
    return;
  }
  stagingInput.value = configured;
  const granted = await chrome.permissions.contains({ origins: [configured + '/*'] });
  if (!granted) {
    setStatus('error', 'Volvé a guardar el destino de prueba para autorizarlo en Chrome.');
    return;
  }
  stagingOrigin = configured;
  setBusy(false);
}).catch(() => {
  setStatus('error', 'No se pudo verificar el destino de prueba. Guardalo nuevamente.');
});

currentButton.addEventListener('click', async () => {
  setBusy(true);
  setStatus('loading', 'Leyendo datos y fotos de la publicación abierta…');
  try {
    await sendMessage({ type: 'TRV_IMPORT_CURRENT' });
    setStatus('success', 'Propiedad enviada a OrdenBroker.');
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : 'No se pudo leer esta página.');
    setBusy(false);
  }
});

openButton.addEventListener('click', async () => {
  const raw = urlInput.value.trim();
  let url;
  try {
    url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    setStatus('error', 'Pegá un enlace válido que empiece con https://.');
    return;
  }

  setBusy(true);
  setStatus('loading', 'Abriendo la publicación y esperando que carguen las fotos…');
  try {
    const granted = await chrome.permissions.request({ origins: [`${url.protocol}//${url.host}/*`] });
    if (!granted) throw new Error('Chrome necesita permiso para leer ese portal.');
    await sendMessage({ type: 'TRV_OPEN_AND_IMPORT', url: url.toString() });
    setStatus('success', 'Propiedad enviada a OrdenBroker.');
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : 'No se pudo abrir la publicación.');
    setBusy(false);
  }
});

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  if (tab?.url?.startsWith('http')) urlInput.placeholder = tab.url;
}).catch(() => undefined);
