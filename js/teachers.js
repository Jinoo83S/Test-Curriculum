// ================================================================
// teachers.js · Teacher Mutations + Teacher View Rendering
// ================================================================
import { uid, clean, makeBtn, escapeHtml } from "./utils.js?v=2026-07-15-room-availability-separation-r355";
import { canEdit, canManageTeachers } from "./auth.js?v=r424";
import { appState, initialLoad, scheduleSave, normalizeTeacher, synchronizeTeacherIdentityState } from "./state.js?v=r426";
import { countTeacherIdentityReferences } from "./teacher-identity.js?v=2026-07-15-room-availability-separation-r355";
import { ACTIVE_SCHOOL_YEAR } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { LOCAL_DEV_MODE } from "./local-dev.js?v=2026-07-15-room-availability-separation-r355";
import { buildTeacherYearRoster } from "./teacher-year-directory.js?v=r433";
import { readSavedTeacherDirectory } from "./school-portal-settings-data.js?v=r431";

const tDomain   = () => appState.teachers;
export const getTeachers    = () => tDomain().teachers;
export const getTeacherById = id => getTeachers().find(t => t.id === id) || null;
let savedDirectory = [];
let directoryRequest;
const rosterRows = () => buildTeacherYearRoster({
  curriculum: appState.curriculum,
  templates: appState.templates?.templates,
  teachers: getTeachers(),
}, savedDirectory).sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true, sensitivity: "base" }));
const teacherNameKey = value => clean(value).normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("ko");
const findTeacherByName = (name, exceptId = "") => {
  const key = teacherNameKey(name);
  return key ? getTeachers().find(t => t.id !== exceptId && teacherNameKey(t.name) === key) || null : null;
};

// ── Mutations ─────────────────────────────────────────────────────
export function addTeacher(data = {}) {
  if (!canEdit()) return null;
  const t = normalizeTeacher({ ...data, id: uid("tch") });
  if (!clean(t.name)) { alert("교사 이름은 비워둘 수 없습니다."); return null; }
  const duplicate = findTeacherByName(t.name);
  if (duplicate) {
    alert(`동일한 교사 이름이 이미 있습니다: ${t.name}\n교사 ID 자동 연결을 위해 이름은 중복될 수 없습니다.`);
    return null;
  }
  getTeachers().push(t); scheduleSave("teachers"); return t;
}
export function updateTeacher(id, field, value) {
  if (!canEdit()) return;
  const t = getTeacherById(id); if (!t) return;
  if (field === "name") {
    const nextName = clean(value);
    if (!nextName) { alert("교사 이름은 비워둘 수 없습니다."); return; }
    const duplicate = findTeacherByName(nextName, id);
    if (duplicate) { alert(`동일한 교사 이름이 이미 있습니다: ${nextName}
교사 ID 자동 연결을 위해 이름은 중복될 수 없습니다.`); return; }
    const previousName = clean(t.name);
    if (previousName && previousName !== nextName) {
      t.aliases = [...new Set([...(Array.isArray(t.aliases) ? t.aliases : []), previousName].map(clean).filter(Boolean))];
    }
    t.name = nextName;
    scheduleSave("teachers");
    synchronizeTeacherIdentityState({ persist:true, reason:`teacher-rename:${id}` });
    return;
  }
  t[field] = value;
  scheduleSave("teachers");
}

function saveTeacherContact(row, savedId, field, value) {
  if (!canEdit() || !initialLoad.teachers) throw new Error("교사 명단을 불러온 후 다시 시도해 주세요.");
  const current = savedId ? getTeacherById(savedId) : null;
  if (savedId && !current) throw new Error("교사 명단이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
  const next = clean(value);
  const email = clean(field === "email" ? next : current?.email ?? row.email).toLowerCase();
  if (field === "email" && current && ["admin", "curriculum"].includes(current.accessRole) && !canManageTeachers()) {
    throw new Error("편집 권한이 있는 계정의 이메일은 관리자가 변경할 수 있습니다.");
  }
  if ((!current || field === "email") && email && getTeachers().some(teacher =>
    teacher.id !== current?.id && clean(teacher.email).toLowerCase() === email)) {
    throw new Error("이 이메일을 사용하는 교사가 현재 학년도에 이미 등록되어 있습니다.");
  }
  if (current) {
    current[field] = field === "email" ? email : next;
    scheduleSave("teachers");
    return current;
  }
  if (findTeacherByName(row.name)) throw new Error("교사 명단이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
  const teacher = normalizeTeacher({
    id: row.id && !getTeacherById(row.id) ? row.id : uid("tch"),
    name: row.name, aliases: row.aliases, email,
    note: field === "note" ? next : row.note,
    accessRole: "basic", portalDisabled: true,
  });
  getTeachers().push(teacher);
  scheduleSave("teachers");
  return teacher;
}
export function deleteTeacher(id) {
  if (!canEdit()) return;
  const t = getTeacherById(id); if (!t) return;
  const refs = countTeacherIdentityReferences(appState, t.id, t.name);
  if (refs.total > 0) {
    alert([
      `"${t.name}" 선생님은 다른 데이터에서 사용 중이므로 삭제할 수 없습니다.`,
      "",
      `과목카드 ${refs.templates}개`,
      `복합과목 구성 ${refs.compoundParts}개`,
      `교실 ${refs.rooms}개`,
      `시간표 카드 ${refs.timetableCards}개`,
      `현재 배치 ${refs.timetableEntries}개`,
      `보관 배치 ${refs.savedEntries}개`,
      `교사 조건 ${refs.constraints}개`,
      "",
      "연결된 과목·교실·시간표에서 다른 교사를 먼저 지정한 뒤 삭제해 주세요."
    ].join("\n"));
    return false;
  }
  if (!confirm(`"${t.name}" 선생님을 삭제할까요?
교사 ID: ${t.id}`)) return false;
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
  const displayedTeachers = rosterRows();
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
  const automaticCount = displayedTeachers.filter(teacher => teacher.automatic).length;
  cnt.textContent = `총 ${displayedTeachers.length}명 · 담당 과목에서 자동 표시 ${automaticCount}명`;
  container.appendChild(cnt);
  if (automaticCount && canEdit() && !LOCAL_DEV_MODE && !directoryRequest) {
    directoryRequest = readSavedTeacherDirectory(ACTIVE_SCHOOL_YEAR).then(result => {
      savedDirectory = result;
      if (container.isConnected && container.contains(cnt) && !container.contains(document.activeElement)) {
        renderTeacherView(container);
      }
    }).catch(error => console.warn("[teachers] saved directory unavailable", error));
  }

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
    const existingNames = new Set(getTeachers().map(t => teacherNameKey(t.name)).filter(Boolean));
    const accepted = [];
    const duplicates = [];
    parsed.forEach(t => {
      const key = teacherNameKey(t.name);
      if (!key || existingNames.has(key)) { duplicates.push(t.name || "이름 없음"); return; }
      existingNames.add(key);
      accepted.push(t);
    });
    if (accepted.length) {
      getTeachers().push(...accepted);
      scheduleSave("teachers");
    }
    textarea.value = "";
    renderTeacherView(container);
    alert([
      `${accepted.length}명이 추가되었습니다.`,
      duplicates.length ? `중복 이름 ${duplicates.length}명은 제외했습니다: ${duplicates.join(", ")}` : ""
    ].filter(Boolean).join("\n"));
  });
  parseBtn.disabled = !canEdit();
  const clearBtn  = makeBtn("지우기", "secondary-btn", () => { textarea.value = ""; });
  pasteActions.append(parseBtn, clearBtn);
  pasteWrap.appendChild(pasteActions);
  container.appendChild(pasteWrap);

  // ── Table ────────────────────────────────────────────────────────
  if (!displayedTeachers.length) {
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

  displayedTeachers.forEach(t => {
    const tr = document.createElement("tr");
    let savedId = t.automatic ? "" : t.id;
    [
      { key:"name",  ph:"이름",  type:"text"  },
      { key:"email", ph:"이메일", type:"email" },
      { key:"note",  ph:"메모",  type:"text"  }
    ].forEach(f => {
      const td = document.createElement("td");
      const inp = document.createElement("input"); inp.type = f.type;
      inp.disabled = !canEdit() || (f.key === "name" && t.automatic) ||
        (f.key === "email" && ["admin", "curriculum"].includes(t.accessRole) && !canManageTeachers());
      inp.value = t[f.key] || "";
      inp.placeholder = f.ph;
      inp.addEventListener("change", () => {
        if (f.key === "name") {
          updateTeacher(t.id, f.key, inp.value);
          renderTeacherView(container);
          return;
        }
        if (!inp.reportValidity()) return;
        try {
          const teacher = saveTeacherContact(t, savedId, f.key, inp.value);
          savedId = teacher.id;
          inp.value = teacher[f.key] || "";
          if (t.automatic) delTd.textContent = "등록";
        } catch (error) {
          alert(error.message);
          inp.value = getTeacherById(savedId)?.[f.key] ?? t[f.key] ?? "";
        }
      });
      td.appendChild(inp); tr.appendChild(td);
    });

    // Auto-derived subjects (read-only)
    const subTd = document.createElement("td"); subTd.className = "teacher-subjects-cell";
    const derivedSubjects = t.subjects;
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
    if (t.automatic) {
      delTd.textContent = "자동";
      delTd.title = "커리큘럼의 담당 교사에서 가져온 항목입니다.";
    } else {
      const delBtn = makeBtn("×", "stu-del-btn", () => { if (deleteTeacher(t.id)) renderTeacherView(container); });
      delBtn.disabled = !canEdit(); delTd.appendChild(delBtn);
    }
    tr.appendChild(delTd);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody); wrap.appendChild(table); container.appendChild(wrap);
}

export function exportTeachersXlsx() {
  const wb = XLSX.utils.book_new();
  const rows = [["교사 ID","이름","담당 과목","이메일","메모"]];
  rosterRows().forEach(t => rows.push([t.id, t.name, t.subjects.join(", "), t.email, t.note]));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch:28 },{ wch:16 },{ wch:30 },{ wch:24 },{ wch:30 }];
  XLSX.utils.book_append_sheet(wb, ws, "선생님 명단");
  XLSX.writeFile(wb, "HIS_Teachers.xlsx");
}
