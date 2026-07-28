from pathlib import Path

path = Path('src/tests/b1-2-2-mobile-leads-real-app.test.ts')
text = path.read_text()
old = """        await assertBaseLayout(page, viewport);
        await assertFilterContrast(page, viewport.width);
        await page.locator('#crm .mvp-lead-matches').first().evaluate((details: HTMLDetailsElement) => { details.open = true; });
        const history = page.locator('#crm .mvp-lead-history').last();
        if (await history.count()) await history.evaluate((details: HTMLDetailsElement) => { details.open = true; });
        await captureLeadsScreenshot(page, viewport);
        await openAndAnalyzePanel(page, viewport.width);"""
new = """        await assertBaseLayout(page, viewport);
        await assertFilterContrast(page, viewport.width);
        await captureLeadsScreenshot(page, viewport);
        await page.locator('#crm [data-toggle-lead-full]').first().click();
        await page.waitForSelector('#crm .mvp-lead-full-profile', { state: 'visible' });
        await page.locator('#crm .mvp-lead-matches').first().evaluate((details: HTMLDetailsElement) => { details.open = true; });
        const history = page.locator('#crm .mvp-lead-history').last();
        if (await history.count()) await history.evaluate((details: HTMLDetailsElement) => { details.open = true; });
        await openAndAnalyzePanel(page, viewport.width);"""
if old not in text:
    raise SystemExit('No se encontró la secuencia B1.2.2 esperada.')
path.write_text(text.replace(old, new, 1))
