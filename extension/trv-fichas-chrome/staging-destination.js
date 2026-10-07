// Solo se permite un destino HTTPS explícito de OrdenBroker staging.
// No hay URL predeterminada ni compatibilidad automática con producción de TRV.
globalThis.ordenbrokerStagingDestination = Object.freeze({
  storageKey: 'ordenbroker-extension-staging-origin-v1',
  parse(value) {
    try {
      const url = new URL(String(value ?? '').trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return null;
      const host = url.hostname.toLowerCase();
      const allowed = host === 'staging.ordenbroker.com.ar'
        || host === 'staging.ordenbroker.com'
        || /^ordenbroker-staging(?:-[a-z0-9]+)*\.onrender\.com$/.test(host)
        || /^ordenbroker-staging(?:-[a-z0-9]+)*\.up\.railway\.app$/.test(host);
      return allowed ? url.origin : null;
    } catch {
      return null;
    }
  },
});
