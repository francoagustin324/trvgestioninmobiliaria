// Hotfix de compatibilidad para instalaciones donde organization_members no tiene columna status.
// Intercepta únicamente la consulta mínima usada por la carga directa de fotos.
const originalFetch = window.fetch.bind(window);

window.fetch = async (input, init) => {
  try {
    const requestUrl = typeof input === 'string'
      ? new URL(input, window.location.origin)
      : input instanceof URL
        ? new URL(input.toString())
        : new URL(input.url, window.location.origin);

    if (
      requestUrl.pathname.endsWith('/rest/v1/organization_members')
      && requestUrl.searchParams.get('select') === 'organization_id,status'
    ) {
      requestUrl.searchParams.set('select', 'organization_id');
      const rewrittenInput = typeof input === 'string' || input instanceof URL
        ? requestUrl.toString()
        : new Request(requestUrl.toString(), input);
      return originalFetch(rewrittenInput, init);
    }
  } catch {
    // Si la URL no puede analizarse, conserva el comportamiento original.
  }

  return originalFetch(input, init);
};
