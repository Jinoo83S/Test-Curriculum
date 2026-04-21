// ================================================================
// rosters.js · Subject-Student Roster Mutations + View Rendering
// ================================================================
import { GRADE_KEYS } from "./config.js";
import { makeBtn, languageClass } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave } from "./state.js";
import { getClasses, getClassById } from "./students.js";
import { getTemplateById, getTemplateCardTitle, getSemesterTemplateData, getTemplateTeacherSummary } from "./templates.js";

const rDomain = () => appState.rosters;
const rosters = () => rDomain().rosters;

export function getRoster(templateId) { return rosters()[templateId] || []; }

export function addToRoster(templateId, classId, studentId) {
  if (!canEdit()) return;
  if (!rosters()[templateId]) rosters()[templateId] = [];
  const exists = rosters()[templateId].some(e => e.classId === classId && e.studentId === studentId);
  if (!exists) { rosters()[templateId].push({ classId, studentId }); scheduleSave("rosters"); }
}
export function removeFromRoster(templateId, classId, studentId) {
  if (!canEdit()) return;
  if (!rosters()[templateId]) return;
  rosters()[templateId] = rosters()[templateId].filter(e => !(e.classId === classId && e.studentId === studentId));
  scheduleSave("rosters");
}
export function clearRoster(templateId) {
  if (!canEdit()) return;
  if (!confirm("이 과목의 수강 명단을 모두 지울까요?")) return;
  rosters()[templateId] = []; scheduleSave("rosters");
}

// ── State ─────────────────────────────────────────────────────────
let selectedRosterTemplateId = null;
let rosterGradeFilter  = "전체";

// Add student filter state
let filterGrade  = "전체";
let filterClass  = "전체";
let filterGender = "전체";

// ── Helpers ───────────────────────────────────────────────────────
/** Build "과목명-교사명" label with ellipsis */
function buildRosterItemLabel(tpl) {
  const title   = getTemplateCardTitle(tpl);
  const teacher = getTemplateTeacherSummary(tpl);
  return teacher ? `${title} - ${teacher}` : title;
}

/** Get how many students are enrolled */
function enrolledCount(tpl) {
  return getRoster(tpl.id).length;
}

/** Get all templates that are placed in the curriculum */
function getPlacedTemplates(gradeFilter) {
  const templates = appState.templates.templates;
  return templates.filter(tpl => {
    const grades = GRADE_KEYS.filter(grade =>
      (appState.curriculum.gradeBoards[grade] || []).some(r =>
        r.sem1TemplateId === tpl.id || r.sem2TemplateId === tpl.id
      )
    );
    if (gradeFilter !== "전체") return grades.includes(gradeFilter);
    return grades.length > 0;
  }).sort((a, b) => getTemplateCardTitle(a).localeCompare(getTemplateCardTitle(b), "ko"));
}

// ── Main Render ───────────────────────────────────────────────────
export function renderRosterView(container) {
  container.innerHTML = "";
  const layout = document.createElement("div"); layout.className = "roster-layout";

  // ── Left panel ──────────────────────────────────────────────────
  const leftPanel = document.createElement("div"); leftPanel.className = "roster-left";

  const leftHdr = document.createElement("div"); leftHdr.className = "roster-left-header";
  const leftTitle = document.createElement("h3"); leftTitle.textContent = "과목 선택";

  const gradeFilter = document.createElement("select"); gradeFilter.className = "roster-grade-filter";
  ["전체", ...GRADE_KEYS].forEach(g => {
    const opt = document.createElement("option"); opt.value = g; opt.textContent = g === "전체" ? "전체 학년" : g;
    if (g === rosterGradeFilter) opt.selected = true;
    gradeFilter.appendChild(opt);
  });
  gradeFilter.addEventListener("change", e => { rosterGradeFilter = e.target.value; renderRosterView(container); });
  leftHdr.append(leftTitle, gradeFilter); leftPanel.appendChild(leftHdr);

  const tplList = document.createElement("div"); tplList.className = "roster-template-list";
  const filteredTemplates = getPlacedTemplates(rosterGradeFilter);

  if (!filteredTemplates.length) {
    const empty = document.createElement("div"); empty.className = "roster-template-empty";
    empty.textContent = "해당 학년에 배치된 과목이 없습니다."; tplList.appendChild(empty);
  } else {
    filteredTemplates.forEach(tpl => {
      const item = document.createElement("div");
      item.className = "roster-template-item" + (tpl.id === selectedRosterTemplateId ? " active" : "");

      // Fixed-height label with ellipsis: "과목명 - 교사명"
      const label = document.createElement("div"); label.className = "roster-template-label";
      label.textContent = buildRosterItemLabel(tpl);
      label.title = buildRosterItemLabel(tpl);   // full text on hover

      const cnt = document.createElement("div"); cnt.className = "roster-template-count";
      cnt.textContent = `${enrolledCount(tpl)}명`;

      item.append(label, cnt);
      item.addEventListener("click", () => { selectedRosterTemplateId = tpl.id; renderRosterView(container); });
      tplList.appendChild(item);
    });
  }
  leftPanel.appendChild(tplList);

  // ── Right panel ──────────────────────────────────────────────────
  const rightPanel = document.createElement("div"); rightPanel.className = "roster-right";

  if (!selectedRosterTemplateId) {
    const empty = document.createElement("div"); empty.className = "roster-right-empty";
    empty.textContent = "왼쪽에서 과목을 선택하세요";
    rightPanel.appendChild(empty);
  } else {
    renderRosterDetail(rightPanel, container);
  }

  layout.append(leftPanel, rightPanel);
  container.appendChild(layout);
}

function renderRosterDetail(panel, container) {
  panel.innerHTML = "";
  const tpl    = getTemplateById(selectedRosterTemplateId); if (!tpl) return;
  const roster = getRoster(selectedRosterTemplateId);

  // ── Right header ──────────────────────────────────────────────
  const rhdr = document.createElement("div"); rhdr.className = "roster-right-header";
  const rtitle = document.createElement("div"); rtitle.className = "roster-right-title";
  const rname  = document.createElement("h3"); rname.textContent = buildRosterItemLabel(tpl);
  const rcnt   = document.createElement("span"); rcnt.className = "student-count-badge";
  rcnt.textContent = `${roster.length}명 수강`;
  rtitle.append(rname, rcnt);
  const clearBtn  = makeBtn("명단 초기화", "danger-btn compact-btn",   () => { clearRoster(selectedRosterTemplateId); renderRosterView(container.parentElement || container); });
  clearBtn.disabled = !canEdit();
  const exportBtn = makeBtn("📥 내보내기", "secondary-btn compact-btn", () => exportRosterXlsx(selectedRosterTemplateId));
  rhdr.append(rtitle, clearBtn, exportBtn);
  panel.appendChild(rhdr);

  // ── Enrolled table ────────────────────────────────────────────
  const enrolledTitle = document.createElement("div"); enrolledTitle.className = "roster-section-title";
  enrolledTitle.textContent = "수강 학생";
  panel.appendChild(enrolledTitle);

  if (!roster.length) {
    const empty = document.createElement("div"); empty.className = "roster-enrolled-empty";
    empty.textContent = "아직 수강 학생이 없습니다."; panel.appendChild(empty);
  } else {
    const enrolledWrap = document.createElement("div"); enrolledWrap.className = "roster-enrolled-wrap";
    const enrolledTable = document.createElement("table"); enrolledTable.className = "roster-table";
    enrolledTable.innerHTML = `<thead><tr><th>번호</th><th>학년</th><th>반</th><th>이름</th><th>성별</th><th>삭제</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    roster.forEach((entry, idx) => {
      const cls = getClassById(entry.classId);
      const stu = cls?.students.find(s => s.id === entry.studentId);
      if (!stu) return;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="col-num">${idx+1}</td><td class="roster-class-name">${cls.grade}</td><td class="roster-class-name">${cls.name}</td><td>${stu.name}</td><td>${stu.gender}</td>`;
      const delTd = document.createElement("td");
      const delBtn = makeBtn("×", "stu-del-btn", () => {
        removeFromRoster(selectedRosterTemplateId, entry.classId, entry.studentId);
        renderRosterView(container.parentElement || container);
      });
      delBtn.disabled = !canEdit(); delTd.appendChild(delBtn); tr.appendChild(delTd);
      tbody.appendChild(tr);
    });
    enrolledTable.appendChild(tbody); enrolledWrap.appendChild(enrolledTable);
    panel.appendChild(enrolledWrap);
  }

  // ── Student add section with filters ─────────────────────────
  const addTitle = document.createElement("div"); addTitle.className = "roster-section-title";
  addTitle.textContent = "학생 추가 (반에서 선택)";
  panel.appendChild(addTitle);

  // ── Filter bar ────────────────────────────────────────────────
  const filterBar = document.createElement("div"); filterBar.className = "roster-filter-bar";

  // Grade filter
  const gradeOpts = ["전체", ...GRADE_KEYS];
  const gradeSel  = buildFilterSelect("학년", gradeOpts, filterGrade, v => { filterGrade = v; filterClass = "전체"; renderRosterView(container.parentElement || container); });

  // Class filter — only show classes of selected grade
  const classOpts = ["전체", ...getClasses()
    .filter(c => filterGrade === "전체" || c.grade === filterGrade)
    .map(c => c.name)
    .filter((v, i, a) => a.indexOf(v) === i)
  ];
  const classSel = buildFilterSelect("반", classOpts, filterClass, v => { filterClass = v; renderRosterView(container.parentElement || container); });

  // Gender filter
  const genderSel = buildFilterSelect("성별", ["전체","남","여"], filterGender, v => { filterGender = v; renderRosterView(container.parentElement || container); });

  // "전체 추가" for all filtered students
  const addAllBtn = makeBtn("필터 전체 추가", "primary-btn compact-btn", () => {
    getFilteredStudentEntries().forEach(({ classId, studentId }) => addToRoster(selectedRosterTemplateId, classId, studentId));
    renderRosterView(container.parentElement || container);
  });
  addAllBtn.disabled = !canEdit();

  filterBar.append(gradeSel, classSel, genderSel, addAllBtn);
  panel.appendChild(filterBar);

  // ── Filtered class cards ──────────────────────────────────────
  const classesArea = document.createElement("div"); classesArea.className = "roster-add-area";

  const filteredClasses = getClasses().filter(c => {
    if (filterGrade !== "전체" && c.grade !== filterGrade) return false;
    if (filterClass !== "전체" && c.name  !== filterClass) return false;
    return c.students.length > 0;
  });

  if (!filteredClasses.length) {
    const noClass = document.createElement("div"); noClass.className = "manager-empty";
    noClass.textContent = "조건에 맞는 반이 없습니다."; classesArea.appendChild(noClass);
  } else {
    filteredClasses.forEach(cls => {
      const filteredStudents = cls.students.filter(s => filterGender === "전체" || s.gender === filterGender);
      if (!filteredStudents.length) return;

      const clsCard = document.createElement("div"); clsCard.className = "roster-class-card";
      const clsHdr  = document.createElement("div"); clsHdr.className  = "roster-class-header";
      const label   = document.createElement("span"); label.className = "roster-class-label";
      label.textContent = `${cls.grade} ${cls.name}`;

      const allBtn = makeBtn("전체 추가", "secondary-btn compact-btn", () => {
        filteredStudents.forEach(s => addToRoster(selectedRosterTemplateId, cls.id, s.id));
        renderRosterView(container.parentElement || container);
      });
      allBtn.disabled = !canEdit();
      clsHdr.append(label, allBtn); clsCard.appendChild(clsHdr);

      const stuList = document.createElement("div"); stuList.className = "roster-stu-list";
      filteredStudents.forEach(s => {
        const enrolled = roster.some(e => e.classId === cls.id && e.studentId === s.id);
        const stuBtn = document.createElement("button"); stuBtn.type = "button";
        stuBtn.className = "roster-stu-chip" + (enrolled ? " enrolled" : "");
        stuBtn.textContent = s.name || "(이름없음)";
        stuBtn.disabled = !canEdit();
        stuBtn.addEventListener("click", () => {
          if (enrolled) removeFromRoster(selectedRosterTemplateId, cls.id, s.id);
          else          addToRoster(selectedRosterTemplateId, cls.id, s.id);
          renderRosterView(container.parentElement || container);
        });
        stuList.appendChild(stuBtn);
      });
      clsCard.appendChild(stuList); classesArea.appendChild(clsCard);
    });
  }
  panel.appendChild(classesArea);
}

function buildFilterSelect(label, options, currentValue, onChange) {
  const wrap = document.createElement("div"); wrap.className = "roster-filter-item";
  const lbl  = document.createElement("span"); lbl.className = "roster-filter-label"; lbl.textContent = label;
  const sel  = document.createElement("select"); sel.className = "roster-grade-filter";
  options.forEach(opt => {
    const o = document.createElement("option"); o.value = opt;
    o.textContent = opt; if (opt === currentValue) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener("change", e => onChange(e.target.value));
  wrap.append(lbl, sel); return wrap;
}

function getFilteredStudentEntries() {
  const entries = [];
  getClasses().forEach(cls => {
    if (filterGrade !== "전체" && cls.grade !== filterGrade) return;
    if (filterClass !== "전체" && cls.name  !== filterClass) return;
    cls.students.forEach(s => {
      if (filterGender !== "전체" && s.gender !== filterGender) return;
      entries.push({ classId: cls.id, studentId: s.id });
    });
  });
  return entries;
}

export function exportRosterXlsx(templateId) {
  const tpl    = getTemplateById(templateId);
  const roster = getRoster(templateId);
  const wb = XLSX.utils.book_new();
  const rows = [["번호","학년","반","이름","성별","생년월일"]];
  roster.forEach((entry, idx) => {
    const cls = getClassById(entry.classId);
    const stu = cls?.students.find(s => s.id === entry.studentId);
    if (!stu) return;
    rows.push([idx+1, cls.grade, cls.name, stu.name, stu.gender, stu.birth]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch:6 },{ wch:8 },{ wch:10 },{ wch:12 },{ wch:6 },{ wch:14 }];
  XLSX.utils.book_append_sheet(wb, ws, getTemplateCardTitle(tpl) || "수강명단");
  XLSX.writeFile(wb, `HIS_Roster_${getTemplateCardTitle(tpl) || "과목"}.xlsx`);
}
