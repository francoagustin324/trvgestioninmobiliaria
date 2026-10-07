import { clearReadEntityNavigation, currentReadEntityTarget } from './entity-read-navigation.js';
import { renderMvpProperties } from './mvp-properties-ui.js';
import { renderPropertyOpportunities } from './property-opportunities-ui.js';

let activeView: 'inventory' | 'opportunities' = 'inventory';

export function renderMvpPropertiesWorkspace(container: HTMLElement): void {
  if (currentReadEntityTarget()?.entityType === 'property') activeView = 'inventory';
  if (activeView === 'opportunities') {
    renderPropertyOpportunities(container, () => {
      activeView = 'inventory';
      renderMvpPropertiesWorkspace(container);
    });
    return;
  }

  renderMvpProperties(container, {
    onOpenOpportunities: () => {
      clearReadEntityNavigation();
      activeView = 'opportunities';
      renderMvpPropertiesWorkspace(container);
    },
  });
}
