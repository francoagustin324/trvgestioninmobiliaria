import { renderMvpProperties } from './mvp-properties-ui.js';
import { renderPropertyOpportunities } from './property-opportunities-ui.js';

let activeView: 'inventory' | 'opportunities' = 'inventory';

export function renderMvpPropertiesWorkspace(container: HTMLElement): void {
  if (activeView === 'opportunities') {
    renderPropertyOpportunities(container, () => {
      activeView = 'inventory';
      renderMvpPropertiesWorkspace(container);
    });
    return;
  }

  renderMvpProperties(container);
  const heading = container.querySelector<HTMLElement>('.mvp-page-heading');
  const newPropertyButton = heading?.querySelector<HTMLButtonElement>('[data-toggle="property-form"]');
  if (!heading || !newPropertyButton || heading.querySelector('[data-open-property-opportunities]')) return;

  const opportunitiesButton = document.createElement('button');
  opportunitiesButton.type = 'button';
  opportunitiesButton.className = 'secondary';
  opportunitiesButton.dataset.openPropertyOpportunities = '';
  opportunitiesButton.textContent = 'Oportunidades';
  opportunitiesButton.addEventListener('click', () => {
    activeView = 'opportunities';
    renderMvpPropertiesWorkspace(container);
  });
  heading.insertBefore(opportunitiesButton, newPropertyButton);
}
