from pathlib import Path

css_path = Path('src/lead-list-compact.css')
css = css_path.read_text()
rule = """#crm .mvp-lead-followup-menu[open] {
  z-index: 130;
}

#crm .mvp-lead-followup-menu[open] > .mvp-lead-followup-popover {
  z-index: 131;
}

"""
marker = "#crm .mvp-lead-followup-menu:not([open]) > .mvp-lead-followup-popover,"
if rule not in css:
    if marker not in css:
        raise SystemExit('No se encontró el marcador CSS del menú de seguimiento.')
    css = css.replace(marker, rule + marker, 1)
    css_path.write_text(css)

test_path = Path('src/tests/b1-2-3-compact-leads-real-app.test.ts')
test = test_path.read_text()
old = """  await page.evaluate(() => {
    document.querySelector('#crm')?.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-complete-client-follow-up]');
      if (button) document.documentElement.dataset.b123CompleteClick = button.dataset.completeClientFollowUp || '';
    }, { once: true });
  });
  await updatedCard.locator('[data-complete-client-follow-up]').click();
  await page.waitForTimeout(400);
  const diagnostic = await page.evaluate(() => {
    const raw = localStorage.getItem('trv-crm-basico:user:compact-owner');
    const data = raw ? JSON.parse(raw) as { clients?: Array<{ id: number; nextAction?: string; nextFollowUp?: string }>; activityLog?: Array<{ action?: string; entityId?: number }> } : null;
    const stored = data?.clients?.find((item) => item.id === 4);
    const liveButton = document.querySelector<HTMLElement>('[data-complete-client-follow-up="4"]');
    return {
      bubbled: document.documentElement.dataset.b123CompleteClick || '',
      buttonConnected: Boolean(liveButton?.isConnected),
      menuOpen: Boolean(liveButton?.closest('details')?.hasAttribute('open')),
      nextAction: stored?.nextAction ?? null,
      nextFollowUp: stored?.nextFollowUp ?? null,
      latestActivity: data?.activityLog?.find((item) => item.entityId === 4)?.action ?? null,
    };
  });
  console.log(`B1.2.3 diagnóstico completar seguimiento: ${JSON.stringify(diagnostic)}`);
  assert.equal(diagnostic.bubbled, '4');
  assert.equal(diagnostic.nextAction, null);
  assert.equal(diagnostic.nextFollowUp, null);
  const completedCard = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'Seguimiento muy vencido' });
  assert.match(await completedCard.locator('.mvp-lead-next-action').innerText(), /Sin próxima acción/);"""
new = """  const completeButton = updatedCard.locator('[data-complete-client-follow-up]');
  const hitTarget = await completeButton.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return target === button || button.contains(target);
  });
  assert.equal(hitTarget, true, 'El botón Completar seguimiento está cubierto por otra capa.');
  await completeButton.click();
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('#crm .mvp-lead-compact-card')];
    const card = cards.find((item) => item.textContent?.includes('Seguimiento muy vencido'));
    return card?.querySelector('.mvp-lead-next-action')?.textContent?.includes('Sin próxima acción') === true;
  });
  const completedCard = page.locator('#crm .mvp-lead-compact-card').filter({ hasText: 'Seguimiento muy vencido' });
  assert.match(await completedCard.locator('.mvp-lead-next-action').innerText(), /Sin próxima acción/);"""
if new not in test:
    if old not in test:
        raise SystemExit('No se encontró el bloque diagnóstico del seguimiento.')
    test_path.write_text(test.replace(old, new, 1))
