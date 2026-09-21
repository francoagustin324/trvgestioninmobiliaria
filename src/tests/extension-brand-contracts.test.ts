import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const extensionDir = 'extension/trv-fichas-chrome';
const manifest = JSON.parse(readFileSync(`${extensionDir}/manifest.json`, 'utf8')) as {
  manifest_version: number;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  optional_host_permissions: string[];
  host_permissions: string[];
  action: {
    default_title: string;
    default_popup: string;
    default_icon: Record<string, string>;
  };
  icons: Record<string, string>;
};
const popupHtml = readFileSync(`${extensionDir}/popup.html`, 'utf8');
const popupCss = readFileSync(`${extensionDir}/popup.css`, 'utf8');
const popupJs = readFileSync(`${extensionDir}/popup.js`, 'utf8');
const background = readFileSync(`${extensionDir}/background.js`, 'utf8');
const extractor = readFileSync(`${extensionDir}/extractor.js`, 'utf8');
const installer = readFileSync(`${extensionDir}/INSTALAR.txt`, 'utf8');
const installUi = readFileSync('src/extension-install-ui.ts', 'utf8');
const importUi = readFileSync('src/extension-import-ui.ts', 'utf8');
const mvpMain = readFileSync('src/mvp-main.ts', 'utf8');
const mvpProperties = readFileSync('src/mvp-properties-ui.ts', 'utf8');
const mvpAuth = readFileSync('src/mvp-auth.ts', 'utf8');
const builder = readFileSync('scripts/build-extension-zip.mjs', 'utf8');

function pngDimensions(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${path} debe ser PNG válido.`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function zipStoreEntries(bytes: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const uncompressedSize = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    assert.equal(method, 0, 'El builder histórico usa entradas ZIP store.');
    assert.equal(compressedSize, uncompressedSize, 'Las entradas store deben conservar tamaño.');
    const nameStart = offset + 30;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const dataStart = nameStart + nameLength + extraLength;
    entries.set(name, bytes.subarray(dataStart, dataStart + uncompressedSize));
    offset = dataStart + compressedSize;
  }
  return entries;
}

test('Bloque 4: extensión visible OrdenBroker conserva paquetes y contratos técnicos históricos', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.2.0');
  assert.match(manifest.name, /OrdenBroker/);
  assert.doesNotMatch(manifest.description, /PropControl/i);
  assert.match(manifest.description, /OrdenBroker/);
  assert.match(manifest.action.default_title, /OrdenBroker/);
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'tabs']);
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
  assert.deepEqual(manifest.host_permissions, ['https://trvgestioninmobiliaria-production.up.railway.app/*']);
  assert.deepEqual(manifest.icons, { '16': 'icon16.png', '48': 'icon48.png', '128': 'icon128.png' });
  assert.deepEqual(manifest.action.default_icon, { '16': 'icon16.png', '48': 'icon48.png', '128': 'icon128.png' });

  assert.match(popupHtml, /OrdenBroker/);
  assert.match(popupHtml, /Importador inmobiliario/);
  assert.match(popupHtml, /IMPORTACIÓN RÁPIDA/);
  assert.match(popupHtml, /Importar esta publicación/);
  assert.match(popupHtml, /Abrir enlace e importar/);
  assert.doesNotMatch(popupHtml, /PropControl/i);
  assert.doesNotMatch(popupHtml, /\bTRV\b/);
  assert.doesNotMatch(popupHtml, />\s*PC\s*</);
  assert.doesNotMatch(popupHtml, /brand-mark">PC/);

  assert.match(popupCss, /--ob-navy:\s*#0F1B35/);
  assert.match(popupCss, /--ob-primary:\s*#0958ED/);
  assert.match(popupCss, /background:\s*var\(--ob-primary\)/);
  assert.match(popupCss, /#status\.success[\s\S]*background:\s*#153A28/);
  assert.match(popupCss, /#status\.error[\s\S]*background:\s*#4A2025/);
  assert.match(popupCss, /:focus-visible/);

  assert.match(popupJs, /TRV_IMPORT_CURRENT/);
  assert.match(popupJs, /TRV_OPEN_AND_IMPORT/);
  assert.match(popupJs, /Propiedad enviada a OrdenBroker\./);
  assert.doesNotMatch(popupJs, /Ficha enviada a TRV/);
  assert.doesNotMatch(popupJs, /PropControl/i);

  assert.match(background, /const APP_URL = 'https:\/\/trvgestioninmobiliaria-production\.up\.railway\.app'/);
  assert.match(background, /'X-TRV-Extension': '1'/);
  assert.match(background, /TRV_IMPORT_CURRENT/);
  assert.match(background, /TRV_OPEN_AND_IMPORT/);
  assert.match(background, /globalThis\.trvExtractProperty/);
  assert.match(background, /\/api\/extension-import/);
  assert.match(background, /#extension-import=/);
  assert.match(background, /#extension-error=/);
  assert.match(background, /OrdenBroker no pudo recibir la publicación\./);
  assert.doesNotMatch(background, /TRV no pudo recibir la publicación/);
  assert.match(extractor, /globalThis\.trvExtractProperty\s*=\s*async function trvExtractProperty/);

  assert.match(installer, /^EXTENSIÓN ORDENBROKER/m);
  assert.match(installer, /ordenbroker-fichas-chrome\.zip/);
  assert.match(installer, /chrome:\/\/extensions/);
  assert.match(installer, /La extensión solamente lee la pestaña cuando el usuario ejecuta una importación\./);
  assert.match(installer, /No monitorea la navegación en segundo plano\./);
  assert.doesNotMatch(installer, /PropControl/i);
  assert.doesNotMatch(installer, /\bTRV\b/);

  assert.match(installUi, /\/extension\/ordenbroker-fichas-chrome\.zip/);
  assert.match(installUi, /link\.download = 'ordenbroker-fichas-chrome\.zip'/);
  assert.doesNotMatch(installUi, /propcontrol-fichas-chrome\.zip/);
  assert.match(importUi, /OrdenBroker/);
  assert.match(importUi, /CustomEvent\('trv-render'\)/);
  assert.match(importUi, /consumeExtensionPropertyImport/);
  assert.match(importUi, /#mvp-property-form/);
  assert.doesNotMatch(importUi, /Fichas TRV/);
  assert.match(mvpMain, /consumeExtensionPropertyImport/);
  assert.match(mvpMain, /state\.activeModule = 'propiedades'/);
  assert.match(mvpMain, /state\.openForms\.property = true/);
  assert.match(mvpProperties, /name="sourceLink"/);
  assert.match(mvpProperties, /data-property-import-status/);
  assert.match(mvpProperties, /fotos importadas/);
  assert.match(mvpAuth, /#extension-import=/);
  assert.match(mvpAuth, /authenticatedDestination/);

  assert.match(builder, /const sourceDir = 'extension\/trv-fichas-chrome'/);
  assert.match(builder, /const archiveRoot = 'ordenbroker-fichas-chrome'/);
  assert.match(builder, /extension\/ordenbroker-fichas-chrome\.zip/);
  assert.match(builder, /extension\/trv-fichas-chrome\.zip/);
  assert.match(builder, /Extensión OrdenBroker generada/);

  for (const [name, size] of [['icon16.png', 16], ['icon48.png', 48], ['icon128.png', 128]] as const) {
    const path = `${extensionDir}/${name}`;
    assert.equal(existsSync(path), true, `${path} debe existir.`);
    assert.deepEqual(pngDimensions(path), { width: size, height: size });
  }

  const officialPath = 'extension/ordenbroker-fichas-chrome.zip';
  const legacyPath = 'extension/trv-fichas-chrome.zip';
  assert.equal(existsSync(officialPath), true, 'Debe existir el ZIP oficial OrdenBroker.');
  assert.equal(existsSync(legacyPath), true, 'Debe preservarse el ZIP legacy.');
  const officialZip = readFileSync(officialPath);
  const legacyZip = readFileSync(legacyPath);
  assert.equal(officialZip.equals(legacyZip), true, 'ZIP oficial y legacy deben empaquetar la misma versión funcional.');

  const entries = zipStoreEntries(officialZip);
  const root = 'ordenbroker-fichas-chrome/';
  const expectedEntries = [
    'INSTALAR.txt',
    'background.js',
    'extractor.js',
    'icon16.png',
    'icon48.png',
    'icon128.png',
    'manifest.json',
    'popup.css',
    'popup.html',
    'popup.js',
  ];
  for (const name of expectedEntries) assert.equal(entries.has(`${root}${name}`), true, `Falta ${root}${name} en ZIP oficial.`);

  const zippedManifestBytes = entries.get(`${root}manifest.json`);
  assert.ok(zippedManifestBytes, 'El ZIP debe contener manifest.json.');
  const zippedManifest = JSON.parse(zippedManifestBytes.toString('utf8'));
  assert.deepEqual(zippedManifest, manifest);
});
