from pathlib import Path

path = Path('src/lead-list-compact.css')
text = path.read_text()
rule = """
@media (max-width: 380px) {
  #crm .mvp-lead-quick-actions .mvp-auto-qualify-button {
    width: 100%;
    flex-basis: 100%;
  }
}
"""
if rule.strip() not in text:
    path.write_text(text.rstrip() + '\n' + rule)
