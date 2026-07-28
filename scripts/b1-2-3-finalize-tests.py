from pathlib import Path
import runpy

runpy.run_path('scripts/b1-2-3-update-b122-test.py', run_name='__main__')

path = Path('src/tests/b1-2-3-leads-real-app.test.ts')
text = path.read_text().replace(
    "document.querySelectorAll('#crm .mvp-lead-daily-card').length === 3",
    "document.querySelectorAll('#crm .mvp-lead-daily-card').length === 4",
    1,
)
path.write_text(text)
