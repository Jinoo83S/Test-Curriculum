from pathlib import Path

path = Path("js/curriculum.js")
text = path.read_text(encoding="utf-8")

old_add = '''export function addRow(grade) {
  if (!canEdit()) return;
  const rows = curriculum().gradeBoards[grade] || [];
  const last = rows[rows.length - 1] || {};
  const newRow = createRow(opts(), { category:last.category, track:last.track, group:last.group, credits:last.credits });
  enforceChanCheCredit(newRow);
  rows.push(newRow);
  scheduleSave("curriculum");
}
'''
new_add = '''export function addRow(grade) {
  if (!canEdit()) return;
  const rows = curriculum().gradeBoards[grade] || [];
  const last = rows[rows.length - 1] || {};
  const newRow = createRow(opts(), { category:last.category, track:last.track, group:last.group, credits:last.credits });
  enforceChanCheCredit(newRow);
  rows.push(newRow);
  curriculum().gradeBoards[grade] = rows;
  scheduleSave("curriculum");
  _onCurriculumChange();
}
'''
old_del = '''export function deleteRow(grade, rowId) {
  if (!canEdit()) return;
  if (!confirm("이 행을 삭제할까요?")) return;
  curriculum().gradeBoards[grade] = curriculum().gradeBoards[grade].filter(r => r.id !== rowId);
  if (!curriculum().gradeBoards[grade].length) curriculum().gradeBoards[grade].push(createRow(opts()));
  scheduleSave("curriculum");
}
'''
new_del = '''export function deleteRow(grade, rowId) {
  if (!canEdit()) return;
  if (!confirm("이 행을 삭제할까요?")) return;
  curriculum().gradeBoards[grade] = curriculum().gradeBoards[grade].filter(r => r.id !== rowId);
  if (!curriculum().gradeBoards[grade].length) curriculum().gradeBoards[grade].push(createRow(opts()));
  scheduleSave("curriculum");
  _onCurriculumChange();
}
'''
for label, old, new in [("addRow", old_add, new_add), ("deleteRow", old_del, new_del)]:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, found {count}")
    text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
print("CURRICULUM_ROW_RENDER_R395_PATCH_OK")
