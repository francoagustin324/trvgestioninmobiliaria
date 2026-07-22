import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('index.html', 'utf8');

describe('cache bust de navegación móvil', () => {
  it('carga una versión nueva del shell principal después de la navegación inferior', () => {
    expect(html).toContain('/dist/mvp-main.js?v=20260722-95');
    expect(html).not.toContain('/dist/mvp-main.js?v=20260722-44');
  });

  it('mantiene cargado el CSS de navegación inferior', () => {
    expect(html).toContain('/src/mobile-bottom-nav.css?v=20260722-1');
  });
});
