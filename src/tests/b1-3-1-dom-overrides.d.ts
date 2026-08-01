export {};

declare global {
  interface ParentNode {
    querySelector(selectors: '[data-save-lead]'): HTMLElement | null;
  }
}
