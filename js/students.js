// ================================================================
// students.js · Class/Student Mutations + Student View Rendering
// ================================================================
import { GRADE_KEYS } from "./config.js";
import { uid, clean, makeBtn } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave, normalizeClass, normalizeStudent } from "./state.js";

const clsDomain = () => appState.classes;
export const getClasses   = () => clsDomain().classes;
export const getClassById = id => getClasses().find(c => c.id === id) || null;

// ── Mutations ─────────────────────────────────────────────────────
export function addNewClass() {
  if (!canEdit()) return null;
  const cls = normalizeClass({ grade:"7학년", name:`새 반 ${getClasses().length + 1}` });
  getClasses().push(cls);
  scheduleSave("classes");
  return cls;
}

export function deleteClass(classId) {
  if (!canEdit()) return;
  const cls = getClassById(classId); if (!cls) return;
  if (!confirm(`"${cls.grade} ${cls.name}" 반을 삭제할까요?`)) return;
  clsDomain().classes = getClasses().filter(c => c.id !== classId);
  // Cascade: remove all roster entries for this class
  const rosters = appState.rosters?.rosters;
  if (rosters) Object.keys(rosters).forEach(tid => {
    rosters[tid] = rosters[tid].filter(e => e.classId !== classId);
  });
  scheduleSave("classes");
  scheduleSave("rosters");
  return true;
}

export function updateClass(classId, field, value) {
  if (!canEdit()) return;
  const cls = getClassById(classId); if (!cls) return;
  cls[field] = value; scheduleSave("classes");
}

export function addStudentToClass(classId, studentData = {}) {
  if (!canEdit()) return null;
  const cls = getClassById(classId); if (!cls) return null;
  const s = normalizeStudent(studentData);
  cls.students.push(s); scheduleSave("classes");
  return s;
}

export function updateStudent(classId, studentId, field, value) {
  if (!canEdit()) return;
  const cls = getClassById(classId); if (!cls) return;
  const s = cls.students.find(s => s.id === studentId); if (!s) return;
  s[field] = value; scheduleSave("classes");
}

export function deleteStudent(classId, studentId) {
  if (!canEdit()) return;
  const cls = getClassById(classId); if (!cls) return;
  cls.students = cls.students.filter(s => s.id !== studentId);
  // Cascade: remove from all rosters
  const rosters = appState.rosters?.rosters;
  if (rosters) Object.keys(rosters).forEach(tid => {
    rosters[tid] = rosters[tid].filter(e => !(e.classId === classId && e.studentId === studentId));
  });
  scheduleSave("classes");
  scheduleSave("rosters");
}

// ── Excel Paste Parser ────────────────────────────────────────────
export function parseExcelPaste(raw) {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const students = [];
  for (const line of lines) {
    let cols = line.split(/\t/).map(c => c.trim());
    if (cols.length === 1) cols = line.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
    if (!cols.length || !cols[0]) continue;
    const firstLower = cols[0].toLowerCase().replace(/\s/g, "");
    if (["이름","name","학생","성명","student"].includes(firstLower)) continue;
    let nameIdx = 0;
    if (/^\d+$/.test(cols[0]) && cols.length > 1) nameIdx = 1;
    students.push(normalizeStudent({ name:cols[nameIdx]||"", gender:cols[nameIdx+1]||"", birth:cols[nameIdx+2]||"", extra:cols.slice(nameIdx+3).join(" ").trim() }));
  }
  return students;
}

// ── Student View Rendering ────────────────────────────────────────
export function renderClassList(container, selectedClassId, onSelect) {
  container.innerHTML = "";
  const byGrade = {};
  GRADE_KEYS.forEach(g => { byGrade[g] = []; });
  getClasses().forEach(c => { if (byGrade[c.grade]) byGrade[c.grade].push(c); else byGrade["7학년"].push(c); });

  let hasAny = false;
  GRADE_KEYS.forEach(grade => {
    const items = byGrade[grade] || []; if (!items.length) return; hasAny = true;
    const grpHdr = document.createElement("div"); grpHdr.className = "class-grade-header"; grpHdr.textContent = grade; container.appendChild(grpHdr);
    items.forEach(cls => {
      const item = document.createElement("div"); item.className = "class-list-item" + (cls.id === selectedClassId ? " active" : ""); item.dataset.classId = cls.id;
      const nameEl = document.createElement("span"); nameEl.className = "class-item-name"; nameEl.textContent = cls.name;
      const cnt = document.createElement("span"); cnt.className = "class-item-count"; cnt.textContent = `${cls.students.length}명`;
      item.append(nameEl, cnt); item.addEventListener("click", () => onSelect && onSelect(cls.id)); container.appendChild(item);
    });
  });

  if (!hasAny) {
    const empty = document.createElement("div"); empty.className = "class-list-empty"; empty.textContent = "반이 없습니다. '+ 반 추가'를 눌러 시작하세요."; container.appendChild(empty);
  }
}

export function renderStudentTable(tableBody, classId, emptyEl, countEl) {
  const cls = getClassById(classId); if (!cls) return;
  if (countEl) countEl.textContent = cls.students.length;
  tableBody.innerHTML = "";
  if (emptyEl) emptyEl.classList.toggle("hidden", cls.students.length > 0);

  cls.students.forEach((stu, idx) => {
    const tr = document.createElement("tr"); tr.dataset.stuId = stu.id;
    const numTd = document.createElement("td"); numTd.className = "col-num"; numTd.textContent = idx + 1; tr.appendChild(numTd);
    [{ key:"name", ph:"이름" }, { key:"gender", ph:"성별", cls:"col-gender" }, { key:"birth", ph:"생년월일", cls:"col-birth" }, { key:"extra", ph:"기타", cls:"col-extra" }].forEach(f => {
      const td = document.createElement("td"); if (f.cls) td.className = f.cls;
      const inp = document.createElement("input"); inp.type = "text"; inp.value = stu[f.key]; inp.placeholder = f.ph; inp.disabled = !canEdit();
      inp.addEventListener("change", e => { updateStudent(classId, stu.id, f.key, e.target.value); if (f.key === "name" && countEl) countEl.textContent = (getClassById(classId)?.students.length || 0); });
      td.appendChild(inp); tr.appendChild(td);
    });
    const delTd = document.createElement("td"); delTd.className = "col-del";
    const delBtn = makeBtn("×", "stu-del-btn", () => { deleteStudent(classId, stu.id); renderStudentTable(tableBody, classId, emptyEl, countEl); });
    delBtn.disabled = !canEdit(); delTd.appendChild(delBtn); tr.appendChild(delTd);
    tableBody.appendChild(tr);
  });
}

export function exportStudentXlsx(classId) {
  const cls = getClassById(classId); if (!cls) return;
  const wb = XLSX.utils.book_new();
  const rows = [["번호","이름","성별","생년월일","기타"]];
  cls.students.forEach((s, i) => rows.push([i+1, s.name, s.gender, s.birth, s.extra]));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch:6 },{ wch:12 },{ wch:6 },{ wch:14 },{ wch:20 }];
  XLSX.utils.book_append_sheet(wb, ws, `${cls.grade} ${cls.name}`);
  XLSX.writeFile(wb, `HIS_${cls.grade}_${cls.name}_명단.xlsx`);
}
