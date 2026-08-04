import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('hotfix desktop B1.3.3 permanece consolidado, versionado y aislado de la lógica', () => {
  const index = readFileSync('index.html', 'utf8');
  const css = readFileSync('src/b1-3-3-mobile-postproduction-hotfix.css', 'utf8');
  const leadLogic = readFileSync('src/lead-create-reliability.ts', 'utf8');
  const whatsappLogic = readFileSync('src/whatsapp-contact.ts', 'utf8');

  assert.match(index, /b1-3-3-mobile-postproduction-hotfix\.css\?v=20260804-1/);
  assert.doesNotMatch(index, /b1-3-3-desktop-modal-centering-hotfix\.css/);
  assert.equal(existsSync('src/b1-3-3-desktop-modal-centering-hotfix.css'), false);
  assert.match(css, /@media \(min-width: 721px\)/);
  assert.match(css, /top:\s*50%/);
  assert.match(css, /left:\s*50%/);
  assert.match(css, /transform:\s*translate\(-50%, -50%\)/);
  assert.match(css, /width:\s*min\(920px, calc\(100vw - 64px\)\)/);
  assert.match(css, /max-height:\s*min\(680px, calc\(100dvh - 40px\)\)/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /\[data-cancel-client-edit\][\s\S]*display:\s*none !important/);
  assert.match(leadLogic, /findDuplicateClient/);
  assert.match(leadLogic, /Abrir lead existente/);
  assert.match(whatsappLogic, /assertCurrentWhatsAppHumanIdentity/);
  assert.match(whatsappLogic, /fingerprint/);
});

test('hotfix desktop B1.3.3 exige una única matriz visual estable y sin servidor paralelo', () => {
  const responsiveTest = readFileSync('src/tests/b1-3-3-mobile-postproduction-hotfix.test.ts', 'utf8');

  assert.match(responsiveTest, /createServer as createNetServer/);
  assert.match(responsiveTest, /findFreePort/);
  assert.doesNotMatch(responsiveTest, /const port = 4376/);
  assert.match(responsiveTest, /62900/);
  assert.match(responsiveTest, /62979/);
  assert.match(responsiveTest, /await stopServer\(server\)/);
  assert.match(responsiveTest, /width: 1366, height: 768/);
  assert.match(responsiveTest, /width: 1280, height: 720/);
  assert.match(responsiveTest, /width: 390, height: 844/);
  assert.match(responsiveTest, /Math\.abs\(geometry\.centerX - geometry\.viewportCenterX\) <= 1/);
  assert.match(responsiveTest, /Math\.abs\(geometry\.centerY - geometry\.viewportCenterY\) <= 1/);
  assert.match(responsiveTest, /22-hotfix-modal-centrado-1366x768\.png/);
  assert.match(responsiveTest, /23-hotfix-modal-centrado-1280x720\.png/);
  assert.match(responsiveTest, /24-hotfix-mobile-sin-regresion-390x844\.png/);
  assert.match(responsiveTest, /25-hotfix-mobile-identidad-unica-390x844\.png/);
});
