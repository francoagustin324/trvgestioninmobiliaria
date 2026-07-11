export function renderExtensionInstallHelp(): void {
  const importer = document.querySelector<HTMLElement>('.importer-box');
  if (!importer || importer.querySelector('.extension-install-card')) return;

  const card = document.createElement('aside');
  card.className = 'extension-install-card';

  const content = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = 'Extensión gratuita para portales bloqueados';
  const description = document.createElement('p');
  description.textContent = 'Abrí la publicación en Chrome, esperá que carguen las fotos y tocá “Crear ficha con esta página”. Es la opción más confiable para Zonaprop, MercadoLibre, Tokko y otros portales.';
  content.append(title, description);

  const link = document.createElement('a');
  link.href = '/extension/trv-fichas-chrome.zip';
  link.download = 'trv-fichas-chrome.zip';
  link.textContent = 'Descargar extensión TRV';

  card.append(content, link);
  importer.append(card);
}
