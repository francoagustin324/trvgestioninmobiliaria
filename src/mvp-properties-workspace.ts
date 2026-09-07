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

  renderMvpProperties(container, {
    onOpenOpportunities: () => {
      activeView = 'opportunities';
      renderMvpPropertiesWorkspace(container);
    },
  });
}
