// ================================================================
// teachers.js · Teacher Mutations + Teacher View Rendering
// ================================================================
import { uid, clean, makeBtn, escapeHtml } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave, normalizeTeacher } from "./state.js";
import { getSubjectsForTeacher } from "./templates.js";

const tDomain   = () => appState.teachers;
export const getTeachers    = () => tDomain().teachers;
export const getTeacherById = id => getTeachers().find(t => t.id === id) || null;

// ── Mutations ─────────────────────────────────────────────────────
export function addTeacher(data = {}) {
  if (!canEdit()) return null;
  const t = normalizeTeacher({ ...data, id: uid("tch") });
  getTeachers().push(t); scheduleSave("teachers"); return t;
}
export function updateTeacher(id, field, value) {
  if (!canEdit()) return;
  const t = getTeacherById(id); if (!t) return;
  t[field] = value; scheduleSave("teachers");
}
export function deleteTeacher(id) {
  if (!canEdit()) return;
  const t = getTeacherById(id); if (!t) return;
  if (!confirm(`"${t.name}" 선생님을 삭제할까요?`)) return;
  tDomain().teachers = getTeachers().filter(t2 => t2.id !== id);
  scheduleSave("teachers"); return true;
}

// ── Excel Paste Parser ────────────────────────────────────────────
export function parseTeacherPaste(raw) {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const teachers = [];
  for (const line of lines) {
    let cols = line.split(/\t/).map(c => c.trim());
    if (cols.length === 1) cols = line.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
    if (!cols.length || !cols[0]) continue;
    const firstLower = cols[0].toLowerCase().replace(/\s/g, "");
    if (["이름","name","선생님","교사","성명","teacher"].includes(firstLower)) continue;
    // Columns: 이름, [이메일], [메모] — subjects auto-derived from templates
    teachers.push(normalizeTeacher({
      name:  cols[0] || "",
      email: cols[1] || "",
      note:  cols.slice(2).join(" ").trim()
    }));
  }
  return teachers;
}

// ── Teacher View Rendering ────────────────────────────────────────
export function renderTeacherView(container) {
  container.innerHTML = "";

  // ── Header ──────────────────────────────────────────────────────
  const hdr = document.createElement("div"); hdr.className = "teacher-header";
  const title = document.createElement("h2"); title.textContent = "선생님 명단 관리";
  const btnWrap = document.createElement("div"); btnWrap.className = "teacher-header-btns";
  const addBtn = makeBtn("+ 선생님 추가", "primary-btn", () => {
    if (!canEdit()) return;
    addTeacher({ name:"새 선생님" });
    renderTeacherView(container);
  });
  addBtn.disabled = !canEdit();
  const exportBtn = makeBtn("📥 엑셀 내보내기", "secondary-btn", exportTeachersXlsx);
  btnWrap.append(addBtn, exportBtn);
  hdr.append(title, btnWrap);
  container.appendChild(hdr);

  // ── Count ────────────────────────────────────────────────────────
  const cnt = document.createElement("div"); cnt.className = "teacher-count";
  cnt.textContent = `총 ${getTeachers().length}명`;
  container.appendChild(cnt);

  // ── Paste area ───────────────────────────────────────────────────
  const pasteWrap = document.createElement("div"); pasteWrap.className = "paste-area-wrap";
  pasteWrap.innerHTML = `
    <div class="paste-label">
      📋 엑셀에서 복사 후 아래 영역에 붙여넣기
      <span class="paste-hint">열 구성: <strong>이름</strong> [이메일] [메모] — 담당과목은 과목카드에서 자동 연동</span>
    </div>`;
  const textarea = document.createElement("textarea");
  textarea.className = "excel-paste-area"; textarea.placeholder = "엑셀 데이터를 붙여넣으세요 (Ctrl+V)\n예) 김선생\tkimteacher@his.sc.kr\t메모";
  pasteWrap.appendChild(textarea);
  const pasteActions = document.createElement("div"); pasteActions.className = "paste-actions";
  const parseBtn  = makeBtn("명단 추가", "primary-btn", () => {
    const raw = textarea.value.trim();
    if (!raw) { alert("붙여넣기 영역이 비어 있습니다."); return; }
    const parsed = parseTeacherPaste(raw);
    if (!parsed.length) { alert("파싱된 선생님이 없습니다."); return; }
    parsed.forEach(t => getTeachers().push(t));
    scheduleSave("teachers"); textarea.value = "";
    renderTeacherView(container);
    alert(`${parsed.length}명이 추가되었습니다.`);
  });
  parseBtn.disabled = !canEdit();
  const clearBtn  = makeBtn("지우기", "secondary-btn", () => { textarea.value = ""; });
  pasteActions.append(parseBtn, clearBtn);
  pasteWrap.appendChild(pasteActions);
  container.appendChild(pasteWrap);

  // ── Table ────────────────────────────────────────────────────────
  if (!getTeachers().length) {
    const empty = document.createElement("div"); empty.className = "manager-empty";
    empty.textContent = "선생님 명단이 없습니다."; container.appendChild(empty); return;
  }

  const wrap = document.createElement("div"); wrap.className = "teacher-table-wrap";
  const table = document.createElement("table"); table.className = "teacher-table";
  table.innerHTML = `<thead><tr>
    <th style="width:140px">이름</th>
    <th style="width:200px">이메일</th>
    <th>메모</th>
    <th>담당 과목 <span class="paste-hint">(과목카드에서 자동 연동)</span></th>
    <th class="col-del" style="width:40px">삭제</th>
  </tr></thead>`;
  const tbody = document.createElement("tbody");

  getTeachers().forEach(t => {
    const tr = document.createElement("tr");
    [
      { key:"name",  ph:"이름",  type:"text"  },
      { key:"email", ph:"이메일", type:"email" },
      { key:"note",  ph:"메모",  type:"text"  }
    ].forEach(f => {
      const td = document.createElement("td");
      const inp = document.createElement("input"); inp.type = f.type; inp.disabled = !canEdit();
      inp.value = t[f.key] || "";
      inp.placeholder = f.ph;
      inp.addEventListener("change", e => updateTeacher(t.id, f.key, e.target.value));
      td.appendChild(inp); tr.appendChild(td);
    });

    // Auto-derived subjects (read-only)
    const subTd = document.createElement("td"); subTd.className = "teacher-subjects-cell";
    const derivedSubjects = getSubjectsForTeacher(t.name);
    if (derivedSubjects.length) {
      derivedSubjects.forEach(s => {
        const chip = document.createElement("span"); chip.className = "teacher-subject-chip"; chip.textContent = s;
        subTd.appendChild(chip);
      });
    } else {
      subTd.innerHTML = '<span class="teacher-subjects-empty">과목카드에서 자동 연동</span>';
    }
    tr.appendChild(subTd);

    const delTd = document.createElement("td"); delTd.className = "col-del";
    const delBtn = makeBtn("×", "stu-del-btn", () => { if (deleteTeacher(t.id)) renderTeacherView(container); });
    delBtn.disabled = !canEdit(); delTd.appendChild(delBtn); tr.appendChild(delTd);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody); wrap.appendChild(table); container.appendChild(wrap);
}

export function exportTeachersXlsx() {
  const wb = XLSX.utils.book_new();
  const rows = [["이름","담당 과목","이메일","메모"]];
  getTeachers().forEach(t => rows.push([t.name, t.subjects.join(", "), t.email, t.note]));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch:12 },{ wch:30 },{ wch:24 },{ wch:30 }];
  XLSX.utils.book_append_sheet(wb, ws, "선생님 명단");
  XLSX.writeFile(wb, "HIS_Teachers.xlsx");
}
