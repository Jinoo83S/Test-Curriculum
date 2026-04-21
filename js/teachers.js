// ================================================================
// teachers.js · Teacher Mutations + Teacher View Rendering
// ================================================================
import { uid, clean, makeBtn, escapeHtml } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave, normalizeTeacher } from "./state.js";

const tDomain  = () => appState.teachers;
export const getTeachers   = () => tDomain().teachers;
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
  tDomain().teachers = getTeachers().filter(t2 => t2.id !== id); scheduleSave("teachers"); return true;
}

// ── Teacher View Rendering ────────────────────────────────────────
export function renderTeacherView(container) {
  container.innerHTML = "";

  // Header + Add button
  const hdr = document.createElement("div"); hdr.className = "teacher-header";
  const title = document.createElement("h2"); title.textContent = "선생님 명단 관리";
  const addBtn = makeBtn("+ 선생님 추가", "primary-btn", () => {
    if (!canEdit()) return;
    addTeacher({ name:"새 선생님", subjects:[], email:"", note:"" });
    renderTeacherView(container);
  });
  addBtn.disabled = !canEdit();
  const exportBtn = makeBtn("📥 엑셀 내보내기", "secondary-btn", () => exportTeachersXlsx());
  hdr.append(title, addBtn, exportBtn); container.appendChild(hdr);

  // Count
  const cnt = document.createElement("div"); cnt.className = "teacher-count"; cnt.textContent = `총 ${getTeachers().length}명`;
  container.appendChild(cnt);

  // Table
  if (!getTeachers().length) {
    const empty = document.createElement("div"); empty.className = "manager-empty"; empty.textContent = "선생님 명단이 없습니다. '+ 선생님 추가'를 눌러 시작하세요."; container.appendChild(empty); return;
  }

  const wrap = document.createElement("div"); wrap.className = "teacher-table-wrap";
  const table = document.createElement("table"); table.className = "teacher-table";
  table.innerHTML = `<thead><tr><th>이름</th><th>담당 과목</th><th>이메일</th><th>메모</th><th class="col-del">삭제</th></tr></thead>`;
  const tbody = document.createElement("tbody");

  getTeachers().forEach(t => {
    const tr = document.createElement("tr");
    [
      { key:"name",     ph:"이름",     wide:false },
      { key:"subjects", ph:"담당 과목 (쉼표 구분)", wide:true  },
      { key:"email",    ph:"이메일",   wide:false },
      { key:"note",     ph:"메모",     wide:true  }
    ].forEach(f => {
      const td = document.createElement("td");
      const inp = document.createElement("input"); inp.type = "text"; inp.disabled = !canEdit();
      inp.value = f.key === "subjects" ? t.subjects.join(", ") : (t[f.key] || "");
      inp.placeholder = f.ph;
      inp.addEventListener("change", e => {
        const val = f.key === "subjects" ? e.target.value.split(",").map(s => s.trim()).filter(Boolean) : e.target.value;
        updateTeacher(t.id, f.key, val);
      });
      td.appendChild(inp); tr.appendChild(td);
    });

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
