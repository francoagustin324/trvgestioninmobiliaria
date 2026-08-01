let enhancementQueued = false;
let enhancerPromise: Promise<typeof import('./lead-create-reliability.js')> | null = null;

function loadEnhancer(): Promise<typeof import('./lead-create-reliability.js')> {
  enhancerPromise ??= import('./lead-create-reliability.js');
  return enhancerPromise;
}

function reportBootstrapError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  document.documentElement.dataset.b131BootstrapError = message;
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
      reportBootstrapError(error);
    }
  });
}

function opensOrRefreshesLeadForm(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest('[data-toggle="client-form"], [data-edit-client]'));
}

function installLeadFormBootstrap(): void {
  document.documentElement.dataset.b131Bootstrap = 'ready';

  document.addEventListener('click', (event) => {
    if (opensOrRefreshesLeadForm(event.target)) scheduleEnhancement();
  }, true);
  document.addEventListener('trv-render', scheduleEnhancement);
  document.addEventListener('propcontrol-cloud-status', scheduleEnhancement);
  window.addEventListener('pageshow', scheduleEnhancement);
  scheduleEnhancement();
}

installLeadFormBootstrap();
