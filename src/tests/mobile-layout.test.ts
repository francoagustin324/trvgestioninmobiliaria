import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('el menú móvil queda fuera del flujo y no deja una zona vacía arriba', () => {
  const css = readFileSync('src/mobile-layout-fix.css', 'utf8');
  for (const marker of [
    '@media (max-width: 980px)',
    '.mvp-sidebar',
    'position: fixed;',
    'height: 100dvh;',
    'transform: translateX(-108%);',
    'body.mobile-nav-open .mvp-sidebar',
    'transform: translateX(0);',
  ]) assert.ok(css.includes(marker), marker);
});

test('la corrección móvil se carga después de los estilos del escritorio y usa caché versionada', () => {
  const html = readFileSync('index.html', 'utf8');
  const polish = html.indexOf('/src/mvp-polish.css');
  const mobileFix = html.indexOf('/src/mobile-layout-fix.css?v=');
  assert.ok(polish >= 0);
  assert.ok(mobileFix > polish);
  assert.match(html, /mobile-layout-fix\.css\?v=[0-9-]+/);
});
