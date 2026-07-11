const status = document.querySelector('#status');
const currentButton = document.querySelector('#import-current');
const openButton = document.querySelector('#open-import');
const urlInput = document.querySelector('#property-url');

function setStatus(kind, message) {
  status.className = kind;
  status.textContent = message;
}

function setBusy(busy) {
  currentButton.disabled = busy;
  openButton.disabled = busy;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.success) {
        reject(new Error(response?.error || 'No se pudo crear la ficha.'));
        return;
      }
      resolve(response);
    });
  });
}

currentButton.addEventListener('click', async () => {
  setBusy(true);
  setStatus('loading', 'Leyendo datos y fotos de la publicación abierta…');
  try {
    await sendMessage({ type: 'TRV_IMPORT_CURRENT' });
    setStatus('success', 'Ficha enviada a TRV.');
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
    setStatus('success', 'Ficha enviada a TRV.');
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : 'No se pudo abrir la publicación.');
    setBusy(false);
  }
});

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  if (tab?.url?.startsWith('http')) urlInput.placeholder = tab.url;
}).catch(() => undefined);
