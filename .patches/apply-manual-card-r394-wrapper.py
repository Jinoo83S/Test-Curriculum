from pathlib import Path
import runpy

try:
    runpy.run_path('.patches/apply-manual-card-r394.py', run_name='__main__')
except SystemExit as exc:
    message = str(exc)
    expected = 'html cache marker: expected 1 occurrence, found 3'
    if message != expected:
        raise

p = Path('timetable.html')
text = p.read_text(encoding='utf-8')
old = '2026-08-12-card-detail-editor-occurrence-rooms-r393'
new = '2026-08-12-manual-card-clone-delete-r394'
count = text.count(old)
if count != 3:
    raise SystemExit(f'html cache marker wrapper: expected 3 occurrences, found {count}')
p.write_text(text.replace(old, new), encoding='utf-8')
print('MANUAL_CARD_R394_APPLY_OK')
