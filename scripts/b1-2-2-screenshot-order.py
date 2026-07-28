from pathlib import Path

path = Path('src/tests/b1-2-2-mobile-leads-real-app.test.ts')
text = path.read_text()

old_capture = '''async function captureScreenshots(page: Page, viewport: { width: number; height: number }): Promise<void> {
  if (!screenshotWidths.has(viewport.width)) return;
  mkdirSync(artifactDirectory, { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({
    path: join(artifactDirectory, `leads-${viewport.width}x${viewport.height}.png`),
    fullPage: false,
    scale: 'css',
  });
  const panel = page.locator('#crm .lead-qualification-panel').first();
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(artifactDirectory, `leads-panel-${viewport.width}x${viewport.height}.png`),
    fullPage: false,
    scale: 'css',
  });
}'''

new_capture = '''async function captureLeadsScreenshot(page: Page, viewport: { width: number; height: number }): Promise<void> {
  if (!screenshotWidths.has(viewport.width)) return;
  mkdirSync(artifactDirectory, { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({
    path: join(artifactDirectory, `leads-${viewport.width}x${viewport.height}.png`),
    fullPage: false,
    scale: 'css',
  });
}

async function capturePanelScreenshot(page: Page, viewport: { width: number; height: number }): Promise<void> {
  if (!screenshotWidths.has(viewport.width)) return;
  const panel = page.locator('#crm .lead-qualification-panel').first();
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(artifactDirectory, `leads-panel-${viewport.width}x${viewport.height}.png`),
    fullPage: false,
    scale: 'css',
  });
}'''

if old_capture in text:
    text = text.replace(old_capture, new_capture, 1)
elif 'async function captureLeadsScreenshot' not in text or 'async function capturePanelScreenshot' not in text:
    raise SystemExit('No se encontró la función de capturas esperada.')

old_order = '''        await openAndAnalyzePanel(page, viewport.width);
        await captureScreenshots(page, viewport);
        await assertBottomNavigationClearance(page, viewport.width);'''
new_order = '''        await captureLeadsScreenshot(page, viewport);
        await openAndAnalyzePanel(page, viewport.width);
        await capturePanelScreenshot(page, viewport);
        await assertBottomNavigationClearance(page, viewport.width);'''

if old_order in text:
    text = text.replace(old_order, new_order, 1)
elif '        await captureLeadsScreenshot(page, viewport);' not in text or '        await capturePanelScreenshot(page, viewport);' not in text:
    raise SystemExit('No se encontró el orden de capturas esperado.')

path.write_text(text)
