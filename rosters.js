// ================================================================
// rosters.js · Subject-Student Roster Mutations + View Rendering
// ================================================================
import { GRADE_KEYS } from "./config.js";
import { makeBtn, languageClass } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave } from "./state.js";
import { getClasses, getClassById } from "./students.js";
import { getTemplateById, getTemplateCardTitle, getSemesterTemplateData } from "./templates.js";

const rDomain  = () => appState.rosters;
const rosters  = () => rDomain().rosters;

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

// ── Roster View Rendering ─────────────────────────────────────────
let selectedRosterTemplateId = null;
let rosterGradeFilter = "전체";

export function renderRosterView(container) {
  container.innerHTML = "";

  const layout = document.createElement("div"); layout.className = "roster-layout";

  // ── Left: template list ──────────────────────────────────────────
  const leftPanel = document.createElement("div"); leftPanel.className = "roster-left";

  const leftHdr = document.createElement("div"); leftHdr.className = "roster-left-header";
  const leftTitle = document.createElement("h3"); leftTitle.textContent = "과목 선택";

  // Grade filter
  const gradeFilter = document.createElement("select"); gradeFilter.className = "roster-grade-filter";
  ["전체", ...GRADE_KEYS].forEach(g => {
    const opt = document.createElement("option"); opt.value = g; opt.textContent = g === "전체" ? "전체 학년" : g;
    if (g === rosterGradeFilter) opt.selected = true;
    gradeFilter.appendChild(opt);
  });
  gradeFilter.addEventListener("change", e => { rosterGradeFilter = e.target.value; renderRosterView(container); });
  leftHdr.append(leftTitle, gradeFilter); leftPanel.appendChild(leftHdr);

  // Template list
  const tplList = document.createElement("div"); tplList.className = "roster-template-list";
  const templates = appState.templates.templates;
  const filteredTemplates = templates.filter(tpl => {
    if (rosterGradeFilter === "전체") return true;
    const grades = GRADE_KEYS.filter(grade => (appState.curriculum.gradeBoards[grade] || []).some(r => r.sem1TemplateId === tpl.id || r.sem2TemplateId === tpl.id));
    return grades.includes(rosterGradeFilter);
  }).sort((a, b) => getTemplateCardTitle(a).localeCompare(getTemplateCardTitle(b), "ko"));

  if (!filteredTemplates.length) {
    const empty = document.createElement("div"); empty.className = "roster-template-empty"; empty.textContent = "해당 학년에 배치된 과목이 없습니다."; tplList.appendChild(empty);
  } else {
    filteredTemplates.forEach(tpl => {
      const item = document.createElement("div");
      item.className = "roster-template-item" + (tpl.id === selectedRosterTemplateId ? " active" : "");
      const nameEl = document.createElement("div"); nameEl.className = "roster-template-name"; nameEl.textContent = getTemplateCardTitle(tpl);
      const cntEl  = document.createElement("div"); cntEl.className  = "roster-template-count"; cntEl.textContent = `${getRoster(tpl.id).length}명`;
      item.append(nameEl, cntEl);
      item.addEventListener("click", () => { selectedRosterTemplateId = tpl.id; renderRosterView(container); });
      tplList.appendChild(item);
    });
  }
  leftPanel.appendChild(tplList);

  // ── Right: student list for selected template ─────────────────────
  const rightPanel = document.createElement("div"); rightPanel.className = "roster-right";

  if (!selectedRosterTemplateId) {
    const empty = document.createElement("div"); empty.className = "roster-right-empty"; empty.textContent = "왼쪽에서 과목을 선택하세요";
    rightPanel.appendChild(empty);
  } else {
    const tpl = getTemplateById(selectedRosterTemplateId);
    const roster = getRoster(selectedRosterTemplateId);

    // Header
    const rhdr = document.createElement("div"); rhdr.className = "roster-right-header";
    const rtitle = document.createElement("div"); rtitle.className = "roster-right-title";
    const rname = document.createElement("h3"); rname.textContent = tpl ? getTemplateCardTitle(tpl) : "과목";
    const rcnt  = document.createElement("span"); rcnt.className = "student-count-badge"; rcnt.textContent = `${roster.length}명 수강`;
    rtitle.append(rname, rcnt);
    const clearBtn = makeBtn("명단 초기화", "danger-btn compact-btn", () => { clearRoster(selectedRosterTemplateId); renderRosterView(container); });
    clearBtn.disabled = !canEdit();
    const exportBtn = makeBtn("📥 내보내기", "secondary-btn compact-btn", () => exportRosterXlsx(selectedRosterTemplateId));
    rhdr.append(rtitle, clearBtn, exportBtn); rightPanel.appendChild(rhdr);

    // Enrolled student table
    const enrolledTitle = document.createElement("div"); enrolledTitle.className = "roster-section-title"; enrolledTitle.textContent = "수강 학생";
    rightPanel.appendChild(enrolledTitle);

    if (!roster.length) {
      const empty = document.createElement("div"); empty.className = "roster-enrolled-empty"; empty.textContent = "아직 수강 학생이 없습니다."; rightPanel.appendChild(empty);
    } else {
      const enrolledWrap = document.createElement("div"); enrolledWrap.className = "roster-enrolled-wrap";
      const enrolledTable = document.createElement("table"); enrolledTable.className = "roster-table";
      enrolledTable.innerHTML = `<thead><tr><th>번호</th><th>반</th><th>이름</th><th>성별</th><th>삭제</th></tr></thead>`;
      const tbody = document.createElement("tbody");
      roster.forEach((entry, idx) => {
        const cls = getClassById(entry.classId);
        const stu = cls?.students.find(s => s.id === entry.studentId);
        if (!stu) return;
        const tr = document.createElement("tr");
        tr.innerHTML = `<td class="col-num">${idx+1}</td><td class="roster-class-name">${cls.grade} ${cls.name}</td><td>${stu.name}</td><td>${stu.gender}</td>`;
        const delTd = document.createElement("td");
        const delBtn = makeBtn("×", "stu-del-btn", () => { removeFromRoster(selectedRosterTemplateId, entry.classId, entry.studentId); renderRosterView(container); });
        delBtn.disabled = !canEdit(); delTd.appendChild(delBtn); tr.appendChild(delTd);
        tbody.appendChild(tr);
      });
      enrolledTable.appendChild(tbody); enrolledWrap.appendChild(enrolledTable); rightPanel.appendChild(enrolledWrap);
    }

    // Add students from class
    const addTitle = document.createElement("div"); addTitle.className = "roster-section-title"; addTitle.textContent = "학생 추가 (반에서 선택)";
    rightPanel.appendChild(addTitle);

    const classesArea = document.createElement("div"); classesArea.className = "roster-add-area";
    getClasses().forEach(cls => {
      if (!cls.students.length) return;
      const clsCard = document.createElement("div"); clsCard.className = "roster-class-card";
      const clsHdr = document.createElement("div"); clsHdr.className = "roster-class-header";
      clsHdr.innerHTML = `<span class="roster-class-label">${cls.grade} ${cls.name}</span>`;

      // Select all button
      const allBtn = makeBtn("전체 추가", "secondary-btn compact-btn", () => {
        cls.students.forEach(s => addToRoster(selectedRosterTemplateId, cls.id, s.id));
        renderRosterView(container);
      });
      allBtn.disabled = !canEdit();
      clsHdr.appendChild(allBtn); clsCard.appendChild(clsHdr);

      const stuList = document.createElement("div"); stuList.className = "roster-stu-list";
      cls.students.forEach(s => {
        const enrolled = roster.some(e => e.classId === cls.id && e.studentId === s.id);
        const stuBtn = document.createElement("button"); stuBtn.type = "button";
        stuBtn.className = "roster-stu-chip" + (enrolled ? " enrolled" : "");
        stuBtn.textContent = s.name || "(이름없음)";
        stuBtn.disabled = !canEdit();
        stuBtn.addEventListener("click", () => {
          if (enrolled) removeFromRoster(selectedRosterTemplateId, cls.id, s.id);
          else addToRoster(selectedRosterTemplateId, cls.id, s.id);
          renderRosterView(container);
        });
        stuList.appendChild(stuBtn);
      });
      clsCard.appendChild(stuList); classesArea.appendChild(clsCard);
    });

    if (!getClasses().length) {
      const noClass = document.createElement("div"); noClass.className = "manager-empty"; noClass.textContent = "학생 명단을 먼저 등록해 주세요."; classesArea.appendChild(noClass);
    }
    rightPanel.appendChild(classesArea);
  }

  layout.append(leftPanel, rightPanel); container.appendChild(layout);
}

export function exportRosterXlsx(templateId) {
  const tpl = getTemplateById(templateId);
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
  XLSX.utils.book_append_sheet(wb, ws, getTemplateCardTitle(tpl)||"수강명단");
  XLSX.writeFile(wb, `HIS_Roster_${getTemplateCardTitle(tpl)||"과목"}.xlsx`);
}
