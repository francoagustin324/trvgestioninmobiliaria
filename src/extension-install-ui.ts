import { PRODUCT_BRAND } from './branding.js';

export function renderExtensionInstallHelp(): void {
  const importer = document.querySelector<HTMLElement>('.importer-box');
  if (!importer || importer.querySelector('.extension-install-card')) return;

  const card = document.createElement('aside');
  card.className = 'extension-install-card';

  const content = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = `Extensión gratuita de ${PRODUCT_BRAND.name}`;
  const description = document.createElement('p');
  description.textContent = `Importá datos y fotos desde una publicación abierta en Chrome directamente a ${PRODUCT_BRAND.name}. Revisá la información antes de guardarla.`;
  content.append(title, description);

  const link = document.createElement('a');
  link.href = '/extension/ordenbroker-fichas-chrome.zip';
  link.download = 'ordenbroker-fichas-chrome.zip';
  link.textContent = `Descargar extensión ${PRODUCT_BRAND.name}`;

  card.append(content, link);
  importer.append(card);
}
