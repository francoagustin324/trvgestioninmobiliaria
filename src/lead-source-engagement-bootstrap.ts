const P1_3_OWNED_SELECTOR = [
  '[data-lead-source-summary]',
  '[data-reactivation-section]',
  '[data-lead-source-fields]',
  '.pc-source-filter-field',
  '[data-lead-source-meta]',
  '[data-lead-source-full]',
  '#mvp-lead-count',
].join(',');

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

async function bootstrapLeadSourceEngagement(): Promise<void> {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') {
    await import('./lead-source-reactivation-ui.js');
    return;
  }

  const NativeMutationObserver = window.MutationObserver;
  const FilteringMutationObserver = function (callback: MutationCallback): MutationObserver {
    return new NativeMutationObserver((records, observer) => {
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
}

void bootstrapLeadSourceEngagement();
