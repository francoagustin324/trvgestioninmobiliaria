importScripts('extractor.js');

const APP_URL = 'https://trvgestioninmobiliaria-production.up.railway.app';

function isWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function waitForComplete(tabId, timeoutMs = 45000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === 'complete') return current;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('La publicación tardó demasiado en cargar. Abrila manualmente y usá “Crear ficha con esta página”.'));
    }, timeoutMs);
    const listener = (updatedId, changeInfo, tab) => {
      if (updatedId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function extractFromTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !isWebUrl(tab.url)) throw new Error('Abrí una publicación inmobiliaria antes de crear la ficha.');
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: globalThis.trvExtractProperty,
  });
  const extracted = results?.[0]?.result;
  if (!extracted?.sourceUrl || !extracted?.data) throw new Error('No se pudieron leer los datos de esta página.');
  const data = extracted.data;
  const useful = [data.title, data.price, data.zone, data.description, data.bedrooms, data.totalMeters].filter(Boolean).length;
  if (!data.title && !data.photoUrls?.length && useful < 2) {
    throw new Error('No encontramos datos suficientes. Esperá a que cargue la publicación completa y volvé a tocar la extensión.');
  }
  return extracted;
}

async function sendToTrv(extracted) {
  const response = await fetch(`${APP_URL}/api/extension-import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-TRV-Extension': '1',
    },
    body: JSON.stringify(extracted),
  });
  const payload = await response.json();
  if (!response.ok || !payload.success || !payload.token) throw new Error(payload.error || 'TRV no pudo recibir la publicación.');
  return payload.token;
}

async function createFichaFromTab(tabId) {
  const extracted = await extractFromTab(tabId);
  const token = await sendToTrv(extracted);
  await chrome.tabs.create({ url: `${APP_URL}/#extension-import=${encodeURIComponent(token)}` });
  return { success: true };
}

async function openAndCreate(url) {
  if (!isWebUrl(url)) throw new Error('Pegá un enlace válido que empiece con http:// o https://.');
  const tab = await chrome.tabs.create({ url, active: true });
  if (!tab.id) throw new Error('Chrome no pudo abrir la publicación.');
  await waitForComplete(tab.id);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return createFichaFromTab(tab.id);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    if (message?.type === 'TRV_IMPORT_CURRENT') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No encontramos una pestaña activa.');
      return createFichaFromTab(tab.id);
    }
    if (message?.type === 'TRV_OPEN_AND_IMPORT') return openAndCreate(String(message.url || ''));
    throw new Error('Acción desconocida.');
  };

  run().then(sendResponse).catch(async (error) => {
    const messageText = error instanceof Error ? error.message : 'No se pudo crear la ficha.';
    sendResponse({ success: false, error: messageText });
    if (message?.type === 'TRV_OPEN_AND_IMPORT') {
      await chrome.tabs.create({ url: `${APP_URL}/#extension-error=${encodeURIComponent(messageText)}` });
    }
  });
  return true;
});
