from pathlib import Path

css_path = Path('src/lead-pipeline.css')
css = css_path.read_text()
rule = '.mvp-lead-card-menu .mvp-icon-btn { width:44px; min-width:44px; height:44px; min-height:44px; }'
if rule not in css:
    css += '\n' + rule + '\n'
css_path.write_text(css)

test_path = Path('src/tests/mobile-leads-polish.test.ts')
text = test_path.read_text()
text = text.replace("assert.ok(leads.includes('class=\"mvp-lead-primary-action\"'));", "assert.ok(leads.includes('class=\"mvp-lead-quick-row\"'));", 1)
text = text.replace("assert.ok(leads.includes('class=\"mvp-lead-actions mvp-lead-secondary-actions\"'));", "assert.ok(leads.includes('class=\"mvp-lead-card-menu\"'));\n  assert.ok(leads.includes('class=\"secondary mvp-lead-toggle\"'));", 1)
test_path.write_text(text)
