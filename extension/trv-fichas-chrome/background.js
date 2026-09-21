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
      reject(new Error('La publicación tardó demasiado en cargar. Abrila manualmente y usá “Importar esta publicación”.'));
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

function suspiciousPropertyTitle(value) {
  const title = String(value || '').trim();
  if (!title) return false;
  if (/^(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}\/?$/i.test(title)) return true;
  return /(?:captcha|access denied|acceso denegado|cloudflare|verification|verificaci[oó]n|verify you are human|verifica que eres humano|just a moment|checking your browser|challenge)/i.test(title);
}

function hasSufficientPropertyData(data) {
  const title = String(data?.title || '').trim();
  if (title && suspiciousPropertyTitle(title)) return false;
  const meaningfulTitle = title.length >= 4;
  const secondarySignals = [
    data?.price,
    data?.zone || data?.approxAddress,
    data?.propertyType,
    data?.operation,
    data?.bedrooms || data?.bathrooms,
    data?.coveredMeters || data?.totalMeters,
    String(data?.description || '').trim().length >= 20 ? data.description : '',
    Array.isArray(data?.photoUrls) && data.photoUrls.length ? 'photos' : '',
  ].filter(Boolean).length;
  return meaningfulTitle ? secondarySignals >= 1 : secondarySignals >= 2;
}

async function extractFromTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !isWebUrl(tab.url)) throw new Error('Abrí una publicación inmobiliaria antes de importarla.');
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: globalThis.trvExtractProperty,
  });
  const extracted = results?.[0]?.result;
  if (!extracted?.sourceUrl || !extracted?.data) throw new Error('No se pudieron leer los datos de esta página.');
  const data = extracted.data;
  if (!hasSufficientPropertyData(data)) {
    throw new Error('No encontramos información inmobiliaria suficiente en esta página. Puede ser una pantalla de acceso o verificación. Abrí una publicación inmobiliaria completa y volvé a intentar.');
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
  if (!response.ok || !payload.success || !payload.token) throw new Error(payload.error || 'OrdenBroker no pudo recibir la publicación.');
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
    const messageText = error instanceof Error ? error.message : 'No se pudo importar la propiedad.';
    sendResponse({ success: false, error: messageText });
    if (message?.type === 'TRV_OPEN_AND_IMPORT') {
      await chrome.tabs.create({ url: `${APP_URL}/#extension-error=${encodeURIComponent(messageText)}` });
    }
  });
  return true;
});
