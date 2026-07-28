from pathlib import Path

path = Path('src/tests/b1-2-2-mobile-leads-real-app.test.ts')
text = path.read_text()
old = """        const buttons = [...card.querySelectorAll<HTMLElement>('button, a.mvp-contact-btn')].map((control) => {
          const controlRect = control.getBoundingClientRect();"""
new = """        const buttons = [...card.querySelectorAll<HTMLElement>('button, a.mvp-contact-btn')]
          .filter((control) => control.getClientRects().length > 0)
          .map((control) => {
          const controlRect = control.getBoundingClientRect();"""
if new not in text:
    if old not in text:
        raise SystemExit('No se encontró la colección de controles B1.2.2.')
    path.write_text(text.replace(old, new, 1))
