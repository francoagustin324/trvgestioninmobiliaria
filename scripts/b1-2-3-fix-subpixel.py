from pathlib import Path

path = Path('src/lead-pipeline.css')
text = path.read_text()
text = text.replace(
    '.mvp-compact-action,.mvp-lead-toggle,.mvp-clear-lead-filters { min-height:44px; }',
    '.mvp-compact-action { min-height:45px; }\n.mvp-lead-toggle,.mvp-clear-lead-filters { min-height:44px; }',
    1,
)
path.write_text(text)
