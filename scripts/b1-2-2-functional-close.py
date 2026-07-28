from pathlib import Path
import re
from textwrap import dedent

path = Path('src/tests/b1-2-2-mobile-leads-real-app.test.ts')
text = path.read_text()

text = text.replace(
    "import { existsSync, mkdirSync, readFileSync } from 'node:fs';",
    "import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';",
    1,
)
text = text.replace(
    "import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';",
    "import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';",
    1,
)
if "import { inflateSync } from 'node:zlib';" not in text:
    marker = "import test from 'node:test';"
    if marker not in text:
        raise SystemExit('No se encontró el import de node:test.')
    text = text.replace(marker, marker + "\nimport { inflateSync } from 'node:zlib';", 1)

helper_marker = "async function assertBaseLayout(page: Page, viewport: { width: number; height: number }): Promise<void> {"
helper = dedent(r'''
function paethPredictor(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function inspectPng(filePath: string): { width: number; height: number; uniqueColors: number; channelRange: number } {
  const buffer = readFileSync(filePath);
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${filePath} no es PNG válido.`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const compressed: Buffer[] = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.ok(dataEnd + 4 <= buffer.length, `Chunk PNG truncado en ${filePath}.`);
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? -1;
    } else if (type === 'IDAT') {
      compressed.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  assert.ok(width > 0 && height > 0 && compressed.length > 0, `PNG incompleto: ${filePath}.`);
  assert.equal(bitDepth, 8, `Profundidad PNG inesperada en ${filePath}.`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  assert.ok(channels > 0, `Tipo de color PNG no soportado en ${filePath}: ${colorType}.`);
  const rowBytes = width * channels;
  const raw = inflateSync(Buffer.concat(compressed));
  assert.equal(raw.length, height * (rowBytes + 1), `Datos PNG inesperados en ${filePath}.`);
  const previous = Buffer.alloc(rowBytes);
  const current = Buffer.alloc(rowBytes);
  const unique = new Set<string>();
  const stride = Math.max(1, Math.floor((width * height) / 5_000));
  let minimum = 255;
  let maximum = 0;
  let cursor = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[cursor] ?? 0;
    cursor += 1;
    for (let index = 0; index < rowBytes; index += 1) {
      const source = raw[cursor] ?? 0;
      cursor += 1;
      const left = index >= channels ? current[index - channels] ?? 0 : 0;
      const up = previous[index] ?? 0;
      const upperLeft = index >= channels ? previous[index - channels] ?? 0 : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paethPredictor(left, up, upperLeft)
                : -1;
      assert.notEqual(predictor, -1, `Filtro PNG no soportado en ${filePath}: ${filter}.`);
      current[index] = (source + predictor) & 255;
    }
    for (let column = 0; column < width; column += 1) {
      const pixelNumber = row * width + column;
      if (pixelNumber % stride !== 0) continue;
      const pixelOffset = column * channels;
      const red = current[pixelOffset] ?? 0;
      const green = channels === 1 ? red : current[pixelOffset + 1] ?? 0;
      const blue = channels === 1 ? red : current[pixelOffset + 2] ?? 0;
      unique.add(`${red},${green},${blue}`);
      minimum = Math.min(minimum, red, green, blue);
      maximum = Math.max(maximum, red, green, blue);
    }
    current.copy(previous);
  }
  return { width, height, uniqueColors: unique.size, channelRange: maximum - minimum };
}

function assertScreenshotArtifacts(): void {
  const expected = [
    'leads-360x800.png',
    'leads-panel-360x800.png',
    'leads-390x844.png',
    'leads-panel-390x844.png',
    'leads-430x932.png',
    'leads-panel-430x932.png',
    'leads-720x1024.png',
    'leads-panel-720x1024.png',
    'leads-1366x768.png',
    'leads-panel-1366x768.png',
  ].sort();
  const actual = readdirSync(artifactDirectory).filter((name) => name.endsWith('.png')).sort();
  assert.deepEqual(actual, expected, `Capturas B1.2.2 inesperadas: ${JSON.stringify(actual)}`);
  for (const fileName of actual) {
    const filePath = join(artifactDirectory, fileName);
    assert.ok(statSync(filePath).size > 10_000, `Captura vacía o demasiado pequeña: ${fileName}.`);
    const match = fileName.match(/^(?:leads|leads-panel)-(\d+)x(\d+)\.png$/);
    assert.ok(match, `Nombre de captura inválido: ${fileName}.`);
    const expectedWidth = Number(match[1]);
    const expectedHeight = Number(match[2]);
    const metrics = inspectPng(filePath);
    assert.equal(metrics.width, expectedWidth, `Ancho incorrecto en ${fileName}.`);
    assert.equal(metrics.height, expectedHeight, `Alto incorrecto en ${fileName}.`);
    assert.ok(metrics.uniqueColors >= 16 && metrics.channelRange >= 30,
      `Captura posiblemente en blanco: ${fileName} (${JSON.stringify(metrics)}).`);
  }
}

async function assertControlReachable(control: Locator, label: string, width: number, requireFocus = false): Promise<void> {
  await control.evaluate(async (element) => {
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  const metrics = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const navigation = document.querySelector<HTMLElement>('.mobile-bottom-nav');
    const navigationVisible = navigation && getComputedStyle(navigation).display !== 'none';
    const navigationRect = navigationVisible ? navigation.getBoundingClientRect() : null;
    const visibleBottom = Math.min(window.innerHeight, navigationRect?.top ?? window.innerHeight);
    return {
      active: document.activeElement === element,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      visibleBottom,
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });
  if (requireFocus) assert.equal(metrics.active, true, `${label} perdió el foco en ${width}px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.top >= 0 && metrics.bottom <= metrics.visibleBottom - 8,
    `${label} queda tapado en ${width}px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.left >= 0 && metrics.right <= metrics.viewportWidth + 1,
    `${label} queda fuera horizontalmente en ${width}px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.documentScrollWidth <= metrics.viewportWidth + 1,
    `${label} provoca scroll horizontal en ${width}px.`);
}

''')
if 'function inspectPng(filePath: string)' not in text:
    if helper_marker not in text:
        raise SystemExit('No se encontró el punto de inserción de helpers.')
    text = text.replace(helper_marker, helper + helper_marker, 1)

focus_pattern = re.compile(
    r"  const apply = panel\.locator\('\[data-apply-qualification\]'\);[\s\S]*?"
    r"  assert\.ok\(Number\.parseFloat\(focused\.scrollMarginBottom\) >= 100\);",
)
new_focus = dedent(r'''  const close = panel.locator('[data-close-qualification]');
  const copy = panel.locator('[data-copy-next-question]');
  const apply = panel.locator('[data-apply-qualification]');
  assert.equal(await close.count(), 1);
  assert.equal(await copy.count(), 1);
  assert.equal(await apply.count(), 1);
  await assertControlReachable(close, 'Cerrar panel', width);
  await assertControlReachable(copy, 'Copiar próxima pregunta', width);
  await assertControlReachable(apply, 'Aplicar calificación', width);

  const focusTarget = panel.locator('[data-suggestion-value]:not([disabled]), [data-qualification-text]').last();
  assert.ok(await focusTarget.count(), `No existe un campo editable para validar foco en ${width}px.`);
  await focusTarget.focus();
  await assertControlReachable(focusTarget, 'Campo enfocado', width, true);''')
text, replacements = focus_pattern.subn(new_focus, text, count=1)
if replacements != 1 and "const focusTarget = panel.locator('[data-suggestion-value]:not([disabled]), [data-qualification-text]').last();" not in text:
    raise SystemExit(f'No se reemplazó el bloque de foco; coincidencias: {replacements}.')

port_marker = "  const port = 43_000 + Math.floor(Math.random() * 2_000);"
cleanup = "  rmSync(artifactDirectory, { recursive: true, force: true });\n  mkdirSync(artifactDirectory, { recursive: true });\n"
if cleanup.strip() not in text:
    if port_marker not in text:
        raise SystemExit('No se encontró el punto de limpieza de capturas.')
    text = text.replace(port_marker, cleanup + port_marker, 1)

loop_end = "        await context.close();\n      }\n    }\n  } finally {"
loop_end_with_assert = "        await context.close();\n      }\n    }\n    assertScreenshotArtifacts();\n  } finally {"
if '    assertScreenshotArtifacts();\n  } finally {' not in text:
    if loop_end not in text:
        raise SystemExit('No se encontró el cierre del bucle visual.')
    text = text.replace(loop_end, loop_end_with_assert, 1)

path.write_text(text)
