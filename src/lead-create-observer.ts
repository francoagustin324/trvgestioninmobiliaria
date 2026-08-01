import { enhanceLeadForm } from './lead-create-reliability.js';

let enhancementQueued = false;

function scheduleEnhancement(): void {
  if (enhancementQueued) return;
  enhancementQueued = true;
  queueMicrotask(() => {
    enhancementQueued = false;
    enhanceLeadForm();
  });
}

function hasUnenhancedOpenForm(): boolean {
  return Boolean(document.querySelector(
    '#mvp-lead-form:not(.collapsed):not([data-b131-enhanced="true"])',
  ));
}

function installLeadFormObserver(): void {
  const appRoot = document.querySelector('#root') ?? document.documentElement;
  const observer = new MutationObserver(() => {
    if (hasUnenhancedOpenForm()) scheduleEnhancement();
  });
  observer.observe(appRoot, { childList: true, subtree: true });

  document.addEventListener('trv-render', scheduleEnhancement);
  document.addEventListener('propcontrol-cloud-status', scheduleEnhancement);
  window.addEventListener('pageshow', scheduleEnhancement);
  scheduleEnhancement();
}

installLeadFormObserver();
