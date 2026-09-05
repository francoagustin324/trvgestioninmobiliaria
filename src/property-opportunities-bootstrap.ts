import { renderMvpPropertiesWorkspace } from './mvp-properties-workspace.js';

let scheduledFrame = 0;

function syncPropertyOpportunitiesWorkspace(): void {
  scheduledFrame = 0;
  const container = document.querySelector<HTMLElement>('#propiedades');
  if (!container) return;
  renderMvpPropertiesWorkspace(container);
}

function schedulePropertyOpportunitiesWorkspace(): void {
  if (scheduledFrame) return;
  if (typeof requestAnimationFrame === 'undefined') {
    syncPropertyOpportunitiesWorkspace();
    return;
  }
  scheduledFrame = requestAnimationFrame(syncPropertyOpportunitiesWorkspace);
}

function bindPropertyOpportunitiesBootstrap(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const module = target.closest<HTMLElement>('[data-module]')?.dataset.module;
    if (module === 'propiedades') schedulePropertyOpportunitiesWorkspace();
  });
  document.addEventListener('trv-render', schedulePropertyOpportunitiesWorkspace);
  document.addEventListener('DOMContentLoaded', schedulePropertyOpportunitiesWorkspace, { once: true });
  window.addEventListener('pageshow', schedulePropertyOpportunitiesWorkspace);
  schedulePropertyOpportunitiesWorkspace();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  bindPropertyOpportunitiesBootstrap();
}
