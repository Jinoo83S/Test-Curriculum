// ================================================================
// rosters.js · Subject-Student Roster Mutations + View Rendering
// ================================================================
import { GRADE_KEYS } from "./config.js";
import { makeBtn, languageClass } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave } from "./state.js";
import { getClasses, getClassById } from "./students.js";
import { getTemplateById, getTemplateCardTitle, getSemesterTemplateData, getTemplateTeacherSummary, getTemplateAppliedGrades } from "./templates.js";

const rDomain    = () => appState.rosters;
const rosters    = () => rDomain().rosters;
const rosterMeta = () => rDomain().rosterMeta || (rDomain().rosterMeta = {});

export function getRoster(templateId) { return rosters()[templateId] || []; }
export function getRosterSection(templateId, sIdx) { return getRoster(templateId).filter(e => (e.sectionIdx ?? 0) === sIdx); }
export function getRosterMeta(templateId) { return rosterMeta()[templateId] || { classCount: "" }; }
export function getClassCount(templateId) { return Math.max(0, parseInt(getRosterMeta(templateId).classCount, 10) || 0); }
export function setRosterClassCount(templateId, value) {
  if (!canEdit()) return;
  if (!rosterMeta()[templateId]) rosterMeta()[templateId] = {};
  rosterMeta()[templateId].classCount = value;
  scheduleSave("rosters");
}

/** Add or MOVE student to sectionIdx. A student can only be in one section per template. */
export function addToRoster(templateId, classId, studentId, sectionIdx = 0) {
  if (!canEdit()) return;
  if (!rosters()[templateId]) rosters()[templateId] = [];
  const ex = rosters()[templateId].find(e => e.classId === classId && e.studentId === studentId);
  if (ex) { if (ex.sectionIdx === sectionIdx) return; ex.sectionIdx = sectionIdx; }
  else rosters()[templateId].push({ classId, studentId, sectionIdx });
  scheduleSave("rosters");
}
export function removeFromRoster(templateId, classId, studentId) {
  if (!canEdit()) return;
  if (!rosters()[templateId]) return;
  rosters()[templateId] = rosters()[templateId].filter(e => !(e.classId === classId && e.studentId === studentId));
  scheduleSave("rosters");
}
export function clearRoster(templateId, sectionIdx = null) {
  if (!canEdit()) return;
  const label = sectionIdx !== null ? `${sectionIdx + 1}반` : "전체";
  if (!confirm(`이 과목의 ${label} 수강 명단을 모두 지울까요?`)) return;
  if (sectionIdx !== null) rosters()[templateId] = (rosters()[templateId] || []).filter(e => (e.sectionIdx ?? 0) !== sectionIdx);
  else rosters()[templateId] = [];
  scheduleSave("rosters");
}

// ── Module state ──────────────────────────────────────────────────
let selectedRosterTemplateId = null;
let rosterGradeFilter = "전체";
let filterGrade = "전체", filterClass = "전체", filterGender = "전체";
let selectedSection = 0; // 0-based; -1 = "전체" view

// ── Helpers ───────────────────────────────────────────────────────
const buildLabel = tpl => { const t = getTemplateTeacherSummary(tpl); return t ? `${getTemplateCardTitle(tpl)} - ${t}` : getTemplateCardTitle(tpl); };

function getPlacedTemplates(gf) {
  return appState.templates.templates.filter(tpl => {
    const grades = GRADE_KEYS.filter(g => (appState.curriculum.gradeBoards[g] || []).some(r => r.sem1TemplateId === tpl.id || r.sem2TemplateId === tpl.id));
    return gf !== "전체" ? grades.includes(gf) : grades.length > 0;
  }).sort((a, b) => getTemplateCardTitle(a).localeCompare(getTemplateCardTitle(b), "ko"));
}

// ── Main Render ───────────────────────────────────────────────────
export function renderRosterView(container) {
  container.innerHTML = "";
  const layout = document.createElement("div"); layout.className = "roster-layout";

  // Left panel
  const leftPanel = document.createElement("div"); leftPanel.className = "roster-left";
  const leftHdr   = document.createElement("div"); leftHdr.className   = "roster-left-header";
  const leftTitle = document.createElement("h3");  leftTitle.textContent = "과목 선택";
  const gfSel = document.createElement("select"); gfSel.className = "roster-grade-filter";
  ["전체", ...GRADE_KEYS].forEach(g => { const o = document.createElement("option"); o.value = g; o.textContent = g === "전체" ? "전체 학년" : g; if (g === rosterGradeFilter) o.selected = true; gfSel.appendChild(o); });
  gfSel.addEventListener("change", e => { rosterGradeFilter = e.target.value; renderRosterView(container); });
  leftHdr.append(leftTitle, gfSel); leftPanel.appendChild(leftHdr);

  const tplList = document.createElement("div"); tplList.className = "roster-template-list";
  const ftpl = getPlacedTemplates(rosterGradeFilter);
  if (!ftpl.length) {
    const e = document.createElement("div"); e.className = "roster-template-empty"; e.textContent = "해당 학년에 배치된 과목이 없습니다."; tplList.appendChild(e);
  } else {
    ftpl.forEach(tpl => {
      const item = document.createElement("div");
      item.className = "roster-template-item" + (tpl.id === selectedRosterTemplateId ? " active" : "");
      const lbl = document.createElement("div"); lbl.className = "roster-template-label"; lbl.textContent = buildLabel(tpl); lbl.title = lbl.textContent;
      const grades = document.createElement("div"); grades.className = "roster-template-grades";
      const ag = getTemplateAppliedGrades(tpl.id);
      (ag.length ? ag.map(g => g + "학년") : ["미배정"]).forEach(g => { const c = document.createElement("span"); c.className = "grade-chip grade-chip-sm" + (ag.length ? "" : " grade-chip-none"); c.textContent = g; grades.appendChild(c); });
      const metaRow = document.createElement("div"); metaRow.className = "roster-template-meta-row";
      const cnt = document.createElement("div"); cnt.className = "roster-template-count"; cnt.textContent = `${getRoster(tpl.id).length}명`;
      metaRow.appendChild(cnt);
      const cc = getClassCount(tpl.id);
      if (cc > 0) { const b = document.createElement("span"); b.className = "roster-section-badge"; b.textContent = `${cc}반`; metaRow.appendChild(b); }
      item.append(lbl, grades, metaRow);
      item.addEventListener("click", () => { selectedRosterTemplateId = tpl.id; selectedSection = 0; renderRosterView(container); });
      tplList.appendChild(item);
    });
  }
  leftPanel.appendChild(tplList);

  const rightPanel = document.createElement("div"); rightPanel.className = "roster-right";
  if (!selectedRosterTemplateId) {
    const e = document.createElement("div"); e.className = "roster-right-empty"; e.textContent = "왼쪽에서 과목을 선택하세요"; rightPanel.appendChild(e);
  } else { renderRosterDetail(rightPanel, container); }

  layout.append(leftPanel, rightPanel);
  container.appendChild(layout);
}

// ── Detail ────────────────────────────────────────────────────────
function renderRosterDetail(panel, container) {
  panel.innerHTML = "";
  const tpl  = getTemplateById(selectedRosterTemplateId); if (!tpl) return;
  const roster = getRoster(selectedRosterTemplateId);
  const cc   = getClassCount(selectedRosterTemplateId);
  const multi = cc > 1;
  if (multi && selectedSection >= cc) selectedSection = 0;
  if (!multi) selectedSection = 0;

  // Header
  const rhdr = document.createElement("div"); rhdr.className = "roster-right-header";
  const rtitle = document.createElement("div"); rtitle.className = "roster-right-title";
  const rname = document.createElement("h3"); rname.textContent = buildLabel(tpl);
  const rcnt  = document.createElement("span"); rcnt.className = "student-count-badge"; rcnt.textContent = `${roster.length}명 수강`;
  rtitle.append(rname, rcnt);
  const ccWrap = document.createElement("div"); ccWrap.className = "roster-class-count-wrap";
  const ccLbl  = document.createElement("label"); ccLbl.className = "roster-class-count-label"; ccLbl.textContent = "반 수:";
  const ccInp  = document.createElement("input"); ccInp.type = "number"; ccInp.min = "0"; ccInp.step = "1"; ccInp.className = "roster-class-count-input";
  ccInp.value = getRosterMeta(selectedRosterTemplateId).classCount || ""; ccInp.placeholder = "0"; ccInp.disabled = !canEdit();
  ccInp.addEventListener("change", e => { setRosterClassCount(selectedRosterTemplateId, e.target.value); selectedSection = 0; renderRosterView(container); });
  ccWrap.append(ccLbl, ccInp);
  const clearAll = makeBtn("명단 초기화", "danger-btn compact-btn", () => { clearRoster(selectedRosterTemplateId, null); renderRosterView(container); });
  clearAll.disabled = !canEdit();
  const expBtn = makeBtn("📥 내보내기", "secondary-btn compact-btn", () => exportRosterXlsx(selectedRosterTemplateId));
  rhdr.append(rtitle, ccWrap, clearAll, expBtn);
  panel.appendChild(rhdr);

  // Section tabs
  if (multi) {
    const tabsWrap = document.createElement("div"); tabsWrap.className = "roster-section-tabs";
    const allTab = document.createElement("button"); allTab.type = "button";
    allTab.className = "roster-section-tab" + (selectedSection === -1 ? " active" : "");
    allTab.textContent = `전체 (${roster.length}명)`;
    allTab.addEventListener("click", () => { selectedSection = -1; renderRosterView(container); });
    tabsWrap.appendChild(allTab);
    for (let i = 0; i < cc; i++) {
      const sc = getRosterSection(selectedRosterTemplateId, i).length;
      const tab = document.createElement("button"); tab.type = "button";
      tab.className = "roster-section-tab" + (selectedSection === i ? " active" : "");
      tab.textContent = `${i + 1}반 (${sc}명)`;
      const idx = i;
      tab.addEventListener("click", () => { selectedSection = idx; renderRosterView(container); });
      tabsWrap.appendChild(tab);
    }
    if (selectedSection >= 0) {
      const clrSec = makeBtn(`${selectedSection + 1}반 초기화`, "danger-btn compact-btn", () => { clearRoster(selectedRosterTemplateId, selectedSection); renderRosterView(container); });
      clrSec.disabled = !canEdit(); clrSec.style.marginLeft = "auto"; tabsWrap.appendChild(clrSec);
    }
    panel.appendChild(tabsWrap);
  }

  // Enrolled table
  const secTitle = document.createElement("div"); secTitle.className = "roster-section-title";
  secTitle.textContent = multi && selectedSection === -1 ? "전체 수강 학생" : multi ? `${selectedSection + 1}반 수강 학생` : "수강 학생";
  panel.appendChild(secTitle);
  const displayRoster = multi && selectedSection >= 0 ? getRosterSection(selectedRosterTemplateId, selectedSection) : roster;

  if (!displayRoster.length) {
    const e = document.createElement("div"); e.className = "roster-enrolled-empty"; e.textContent = "아직 수강 학생이 없습니다."; panel.appendChild(e);
  } else {
    const wrap = document.createElement("div"); wrap.className = "roster-enrolled-wrap";
    const table = document.createElement("table"); table.className = "roster-table";
    const showSec = multi && selectedSection === -1;
    table.innerHTML = `<thead><tr><th>번호</th>${showSec ? "<th>반</th>" : ""}<th>학년</th><th>반</th><th>이름</th><th>성별</th><th>삭제</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    displayRoster.forEach((entry, idx) => {
      const cls = getClassById(entry.classId); const stu = cls?.students.find(s => s.id === entry.studentId); if (!stu) return;
      const tr = document.createElement("tr");
      const sc = showSec ? `<td class="roster-class-name">${(entry.sectionIdx ?? 0) + 1}반</td>` : "";
      tr.innerHTML = `<td class="col-num">${idx + 1}</td>${sc}<td class="roster-class-name">${cls.grade}</td><td class="roster-class-name">${cls.name}</td><td>${stu.name}</td><td>${stu.gender}</td>`;
      const delTd = document.createElement("td"); const delBtn = makeBtn("×", "stu-del-btn", () => { removeFromRoster(selectedRosterTemplateId, entry.classId, entry.studentId); renderRosterView(container); });
      delBtn.disabled = !canEdit(); delTd.appendChild(delBtn); tr.appendChild(delTd); tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); panel.appendChild(wrap);
  }

  // No add area in "전체" tab
  if (multi && selectedSection === -1) return;

  // Add area
  const addTitle = document.createElement("div"); addTitle.className = "roster-section-title";
  addTitle.textContent = multi ? `학생 배정 → ${selectedSection + 1}반 (반에서 선택)` : "학생 추가 (반에서 선택)";
  panel.appendChild(addTitle);

  const filterBar = document.createElement("div"); filterBar.className = "roster-filter-bar";
  const gradeSel  = buildFilterSelect("학년", ["전체", ...GRADE_KEYS], filterGrade, v => { filterGrade = v; filterClass = "전체"; renderRosterView(container); });
  const classOpts = ["전체", ...getClasses().filter(c => filterGrade === "전체" || c.grade === filterGrade).map(c => c.name).filter((v, i, a) => a.indexOf(v) === i)];
  const classSel  = buildFilterSelect("반", classOpts, filterClass, v => { filterClass = v; renderRosterView(container); });
  const genderSel = buildFilterSelect("성별", ["전체","남","여"], filterGender, v => { filterGender = v; renderRosterView(container); });
  const addAllBtn = makeBtn("필터 전체 추가", "primary-btn compact-btn", () => {
    getFilteredStudentEntries().forEach(({ classId, studentId }) => addToRoster(selectedRosterTemplateId, classId, studentId, multi ? selectedSection : 0));
    renderRosterView(container);
  });
  addAllBtn.disabled = !canEdit();
  filterBar.append(gradeSel, classSel, genderSel, addAllBtn); panel.appendChild(filterBar);

  const classesArea = document.createElement("div"); classesArea.className = "roster-add-area";
  const filteredClasses = getClasses().filter(c => {
    if (filterGrade !== "전체" && c.grade !== filterGrade) return false;
    if (filterClass !== "전체" && c.name  !== filterClass) return false;
    return c.students.length > 0;
  });
  if (!filteredClasses.length) {
    const nc = document.createElement("div"); nc.className = "manager-empty"; nc.textContent = "조건에 맞는 반이 없습니다."; classesArea.appendChild(nc);
  } else {
    filteredClasses.forEach(cls => {
      const fstu = cls.students.filter(s => filterGender === "전체" || s.gender === filterGender); if (!fstu.length) return;
      const clsCard = document.createElement("div"); clsCard.className = "roster-class-card";
      const clsHdr  = document.createElement("div"); clsHdr.className  = "roster-class-header";
      const label   = document.createElement("span"); label.className = "roster-class-label"; label.textContent = `${cls.grade} ${cls.name}`;
      const allBtn  = makeBtn("전체 추가", "secondary-btn compact-btn", () => { fstu.forEach(s => addToRoster(selectedRosterTemplateId, cls.id, s.id, multi ? selectedSection : 0)); renderRosterView(container); });
      allBtn.disabled = !canEdit(); clsHdr.append(label, allBtn); clsCard.appendChild(clsHdr);
      const stuList = document.createElement("div"); stuList.className = "roster-stu-list";
      fstu.forEach(s => {
        const entry = roster.find(e => e.classId === cls.id && e.studentId === s.id);
        const curSec = entry ? (entry.sectionIdx ?? 0) : null;
        const inThis = entry !== undefined && (!multi || curSec === selectedSection);
        const inOther = entry !== undefined && multi && curSec !== selectedSection;
        const stuBtn = document.createElement("button"); stuBtn.type = "button";
        stuBtn.className = "roster-stu-chip" + (inThis ? " enrolled" : "") + (inOther ? " in-other-section" : "");
        stuBtn.textContent = s.name || "(이름없음)";
        if (inOther) stuBtn.title = `현재 ${curSec + 1}반 → 클릭시 ${selectedSection + 1}반으로 이동`;
        stuBtn.disabled = !canEdit();
        stuBtn.addEventListener("click", () => {
          if (inThis) removeFromRoster(selectedRosterTemplateId, cls.id, s.id);
          else        addToRoster(selectedRosterTemplateId, cls.id, s.id, multi ? selectedSection : 0);
          renderRosterView(container);
        });
        stuList.appendChild(stuBtn);
      });
      clsCard.appendChild(stuList); classesArea.appendChild(clsCard);
    });
  }
  panel.appendChild(classesArea);
}

function buildFilterSelect(label, opts, cur, onChange) {
  const wrap = document.createElement("div"); wrap.className = "roster-filter-item";
  const lbl  = document.createElement("span"); lbl.className = "roster-filter-label"; lbl.textContent = label;
  const sel  = document.createElement("select"); sel.className = "roster-grade-filter";
  opts.forEach(opt => { const o = document.createElement("option"); o.value = opt; o.textContent = opt; if (opt === cur) o.selected = true; sel.appendChild(o); });
  sel.addEventListener("change", e => onChange(e.target.value));
  wrap.append(lbl, sel); return wrap;
}

function getFilteredStudentEntries() {
  const entries = [];
  getClasses().forEach(cls => {
    if (filterGrade !== "전체" && cls.grade !== filterGrade) return;
    if (filterClass !== "전체" && cls.name  !== filterClass) return;
    cls.students.forEach(s => { if (filterGender !== "전체" && s.gender !== filterGender) return; entries.push({ classId: cls.id, studentId: s.id }); });
  });
  return entries;
}

export function exportRosterXlsx(templateId) {
  const tpl = getTemplateById(templateId); const roster = getRoster(templateId); const cc = getClassCount(templateId); const multi = cc > 1;
  const wb = XLSX.utils.book_new();
  if (multi) {
    for (let i = 0; i < cc; i++) {
      const rows = [["번호","학년","반","이름","성별","생년월일"]]; let num = 1;
      roster.filter(e => (e.sectionIdx ?? 0) === i).forEach(entry => { const cls = getClassById(entry.classId); const stu = cls?.students.find(s => s.id === entry.studentId); if (!stu) return; rows.push([num++, cls.grade, cls.name, stu.name, stu.gender, stu.birth]); });
      const ws = XLSX.utils.aoa_to_sheet(rows); ws["!cols"] = [{ wch:6 },{ wch:8 },{ wch:10 },{ wch:12 },{ wch:6 },{ wch:14 }];
      XLSX.utils.book_append_sheet(wb, ws, `${i + 1}반`);
    }
  } else {
    const rows = [["번호","학년","반","이름","성별","생년월일"]];
    roster.forEach((entry, idx) => { const cls = getClassById(entry.classId); const stu = cls?.students.find(s => s.id === entry.studentId); if (!stu) return; rows.push([idx + 1, cls.grade, cls.name, stu.name, stu.gender, stu.birth]); });
    const ws = XLSX.utils.aoa_to_sheet(rows); ws["!cols"] = [{ wch:6 },{ wch:8 },{ wch:10 },{ wch:12 },{ wch:6 },{ wch:14 }];
    XLSX.utils.book_append_sheet(wb, ws, getTemplateCardTitle(tpl) || "수강명단");
  }
  XLSX.writeFile(wb, `HIS_Roster_${getTemplateCardTitle(tpl) || "과목"}.xlsx`);
}
