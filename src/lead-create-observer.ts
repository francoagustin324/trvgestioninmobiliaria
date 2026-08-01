let enhancementQueued = false;
let enhancerPromise: Promise<typeof import('./lead-create-reliability.js')> | null = null;

function loadEnhancer(): Promise<typeof import('./lead-create-reliability.js')> {
  enhancerPromise ??= import('./lead-create-reliability.js');
  return enhancerPromise;
}

function reportObserverError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  document.documentElement.dataset.b131ObserverError = message;
  console.error('B1.3.1 no pudo mejorar el formulario de leads.', error);
}

function scheduleEnhancement(): void {
  if (enhancementQueued) return;
  enhancementQueued = true;
  queueMicrotask(async () => {
    enhancementQueued = false;
    try {
      const { enhanceLeadForm } = await loadEnhancer();
      enhanceLeadForm();
    } catch (error) {
      reportObserverError(error);
    }
  });
}

function hasUnenhancedOpenForm(): boolean {
  return Boolean(document.querySelector(
    '#mvp-lead-form:not(.collapsed):not([data-b131-enhanced="true"])',
  ));
}

function installLeadFormObserver(): void {
  document.documentElement.dataset.b131Observer = 'ready';
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
