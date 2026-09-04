const P1_3_OWNED_SELECTOR = [
  '[data-lead-source-summary]',
  '[data-reactivation-section]',
  '[data-lead-source-fields]',
  '.pc-source-filter-field',
  '[data-lead-source-meta]',
  '[data-lead-source-full]',
  '#mvp-lead-count',
].join(',');

let normalizationFrame = 0;
let contactBridgeBound = false;

function belongsToP13Ui(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest(P1_3_OWNED_SELECTOR));
}

function shouldForwardMutation(record: MutationRecord): boolean {
  if (belongsToP13Ui(record.target)) return false;
  if (record.type !== 'childList') return true;
  const changedNodes = [...record.addedNodes, ...record.removedNodes];
  return changedNodes.length === 0 || !changedNodes.every(belongsToP13Ui);
}

function normalizeLeadSourceIntegration(): void {
  const container = document.querySelector<HTMLElement>('#crm.active');
  if (!container) return;

  const form = container.querySelector<HTMLFormElement>('#mvp-lead-form:not(.collapsed)');
  const source = form?.elements.namedItem('leadSource');
  if (form && source instanceof HTMLSelectElement && !form.dataset.b131Editing && !source.value) {
    // Un alta manual nace como captación propia; el usuario puede cambiar el origen antes de guardar.
    source.value = 'Captación propia';
  }

  const results = container.querySelector<HTMLElement>('#mvp-lead-results');
  const summary = container.querySelector<HTMLElement>('[data-lead-source-summary]');
  const reactivation = container.querySelector<HTMLElement>('[data-reactivation-section]');
  if (results && summary && results.nextElementSibling !== summary) {
    results.insertAdjacentElement('afterend', summary);
  }
  const reactivationAnchor = summary ?? results;
  if (reactivationAnchor && reactivation && reactivationAnchor.nextElementSibling !== reactivation) {
    reactivationAnchor.insertAdjacentElement('afterend', reactivation);
  }

  reactivation?.querySelectorAll<HTMLButtonElement>('[data-contact-whatsapp]').forEach((button) => {
    const clientId = button.dataset.contactWhatsapp;
    if (!clientId) return;
    button.dataset.reactivationContactWhatsapp = clientId;
    delete button.dataset.contactWhatsapp;
  });

  const sourceFilter = container.querySelector<HTMLSelectElement>('#pc-lead-source-filter');
  const count = container.querySelector<HTMLElement>('#mvp-lead-count');
  if (sourceFilter?.value === 'Todas' && count) {
    const match = count.textContent?.trim().match(/^(\d+) de \1 leads$/);
    if (match) count.textContent = `${match[1]} leads`;
  }
}

function scheduleNormalization(): void {
  if (normalizationFrame || typeof requestAnimationFrame === 'undefined') return;
  normalizationFrame = requestAnimationFrame(() => {
    normalizationFrame = 0;
    normalizeLeadSourceIntegration();
  });
}

function bindContactBridge(): void {
  if (contactBridgeBound) return;
  contactBridgeBound = true;
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>('[data-reactivation-contact-whatsapp]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const clientId = button.dataset.reactivationContactWhatsapp;
    if (!clientId) return;
    const canonical = document.querySelector<HTMLButtonElement>(
      `#crm.active .mvp-lead-card[data-client-id="${clientId}"] [data-contact-whatsapp="${clientId}"]`,
    );
    canonical?.click();
  });
}

async function bootstrapLeadSourceEngagement(): Promise<void> {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') {
    await import('./lead-source-reactivation-ui.js');
    return;
  }

  bindContactBridge();
  document.addEventListener('trv-render', scheduleNormalization);
  document.addEventListener('DOMContentLoaded', scheduleNormalization, { once: true });
  window.addEventListener('pageshow', scheduleNormalization);

  const NativeMutationObserver = window.MutationObserver;
  const FilteringMutationObserver = function (callback: MutationCallback): MutationObserver {
    return new NativeMutationObserver((records, observer) => {
      normalizeLeadSourceIntegration();
      const relevant = records.filter(shouldForwardMutation);
      if (relevant.length > 0) callback(relevant, observer);
    });
  } as unknown as typeof MutationObserver;
  FilteringMutationObserver.prototype = NativeMutationObserver.prototype;

  Object.defineProperty(window, 'MutationObserver', {
    configurable: true,
    writable: true,
    value: FilteringMutationObserver,
  });

  try {
    await import('./lead-source-reactivation-ui.js');
  } finally {
    Object.defineProperty(window, 'MutationObserver', {
      configurable: true,
      writable: true,
      value: NativeMutationObserver,
    });
  }

  normalizeLeadSourceIntegration();
  scheduleNormalization();
}

void bootstrapLeadSourceEngagement();
