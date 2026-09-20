from pathlib import Path

path = Path('js/curriculum.js')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        'function createGradeRow(grade, rowData) {',
        'function createGradeRow(grade, rowData, onUpdate) {',
        'createGradeRow signature'
    ),
    (
        'const db = makeBtn("×", "row-delete-btn", () => deleteRow(grade, rowData.id)); db.disabled = !canEdit(); row.appendChild(db);',
        'const db = makeBtn("×", "row-delete-btn", () => { deleteRow(grade, rowData.id); if (typeof onUpdate === "function") onUpdate(); }); db.disabled = !canEdit(); row.appendChild(db);',
        'delete button onUpdate'
    ),
    (
        'for (let i = 0; i < max; i++) visibleGrades.forEach(g => { const rd = rbg[g][i]; cbg[g].col.appendChild(rd ? createGradeRow(g, rd) : createSpacerRow()); });',
        'for (let i = 0; i < max; i++) visibleGrades.forEach(g => { const rd = rbg[g][i]; cbg[g].col.appendChild(rd ? createGradeRow(g, rd, onUpdate) : createSpacerRow()); });',
        'createGradeRow call with onUpdate'
    ),
    (
        'const addBtn = makeBtn(`${grade} 행 추가`, "add-row-btn", () => addRow(grade));',
        'const addBtn = makeBtn(`${grade} 행 추가`, "add-row-btn", () => { addRow(grade); if (typeof onUpdate === "function") onUpdate(); });',
        'add button onUpdate'
    ),
]

for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, found {count}')
    text = text.replace(old, new, 1)

# r395 safety: addRow/deleteRow should still include immediate local mutation callback.
for needle in [
    'curriculum().gradeBoards[grade] = rows;\n  scheduleSave("curriculum");\n  _onCurriculumChange();',
    'scheduleSave("curriculum");\n  _onCurriculumChange();\n}\n\n// ── Options Mutations'
]:
    if needle not in text:
        raise SystemExit(f'missing r395 callback marker: {needle[:50]}')

path.write_text(text, encoding='utf-8')
