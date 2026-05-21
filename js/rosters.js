// ================================================================
// rosters.js · Subject-Student Roster Mutations + View Rendering
// ================================================================
import { GRADE_KEYS } from "./config.js";
import { makeBtn, sectionLabel, gradeDisplay } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave } from "./state.js";
import { getClasses, getClassById } from "./students.js";
import { getTemplateById, getTemplateCardTitle, getTemplateTeacherSummary } from "./templates.js";

const rDomain    = () => appState.rosters;
const rosters    = () => rDomain().rosters;
const rosterMeta = () => rDomain().rosterMeta || (rDomain().rosterMeta = {});

export function getRoster(templateId, gradeKey = null) {
  const all = rosters()[templateId] || [];
  if (!gradeKey) return all;
  // Filter by grade if gradeKey provided (student's class grade)
  const allCls = (appState.classes?.classes || []);
  return all.filter(e => {
    const cls = allCls.find(c => c.id === e.classId);
    return cls ? cls.grade === gradeKey : true;
  });
}
export function getRosterSection(templateId, sIdx, gradeKey = null) {
  return getRoster(templateId, gradeKey).filter(e => (e.sectionIdx ?? 0) === sIdx);
}
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
  const label = sectionIdx !== null ? sectionLabel(sectionIdx) : "전체";
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

function getTrackForTemplate(tplId) {
  for (const grade of GRADE_KEYS) {
    const row = (appState.curriculum.gradeBoards[grade] || []).find(r => r.sem1TemplateId === tplId || r.sem2TemplateId === tplId);
    if (row) return row.track || "공통";
  }
  return "공통";
}

function getPlacedTemplates(gf) {
  // Build in curriculum row order: grade → track → position in board
  const seen = new Set();
  const ordered = [];
  GRADE_KEYS.forEach(grade => {
    if (gf !== "전체" && grade !== gf) return;
    (appState.curriculum.gradeBoards[grade] || []).forEach(row => {
      [row.sem1TemplateId, row.sem2TemplateId].filter(Boolean).forEach(tid => {
        if (seen.has(tid)) return; seen.add(tid);
        const tpl = appState.templates.templates.find(t => t.id === tid);
        if (tpl) ordered.push({ tpl, track: row.track || "공통", gradeKey: grade });
      });
    });
  });
  return ordered;
}

// ── Main Render ───────────────────────────────────────────────────
export function renderRosterView(container) {
  // Preserve both panel scroll positions across re-renders
  const prevRightScroll = document.getElementById("rosterRightPanel")?.scrollTop ?? 0;
  const prevLeftScroll  = document.getElementById("rosterTplList")?.scrollTop ?? 0;
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

  const tplList = document.createElement("div"); tplList.className = "roster-template-list"; tplList.id = "rosterTplList";
  const ftpl = getPlacedTemplates(rosterGradeFilter);
  if (!ftpl.length) {
    const e = document.createElement("div"); e.className = "roster-template-empty"; e.textContent = "해당 학년에 배치된 과목이 없습니다."; tplList.appendChild(e);
  } else {
    // Group by track (curriculum order preserved within each track)
    const trackGroups = {}; // track → [{ tpl, gradeKey }]
    ftpl.forEach(({ tpl, track, gradeKey }) => {
      if (!trackGroups[track]) trackGroups[track] = [];
      trackGroups[track].push({ tpl, gradeKey });
    });

    const renderItem = (tpl, gradeKey) => {
      const item = document.createElement("div");
      item.className = "roster-template-item" + (tpl.id === selectedRosterTemplateId ? " active" : "");
      const lbl = document.createElement("div"); lbl.className = "roster-template-label"; lbl.textContent = buildLabel(tpl); lbl.title = lbl.textContent;
      const metaRow = document.createElement("div"); metaRow.className = "roster-template-meta-row";
      // Grade chip
      const gradeChip = document.createElement("span"); gradeChip.className = "grade-chip grade-chip-sm";
      gradeChip.textContent = gradeDisplay(gradeKey);
      metaRow.appendChild(gradeChip);
      // Student count
      const cnt = document.createElement("div"); cnt.className = "roster-template-count"; cnt.textContent = `${getRoster(tpl.id).length}명`;
      metaRow.appendChild(cnt);
      // Section badge
      const cc = getClassCount(tpl.id);
      if (cc > 0) {
        const b = document.createElement("span"); b.className = "roster-section-badge";
        b.textContent = `${cc}반`; metaRow.appendChild(b);
      }
      item.append(lbl, metaRow);
      item.addEventListener("click", () => {
        selectedRosterTemplateId = tpl.id;
        selectedSection = 0;
        filterGrade = gradeKey; filterClass = "전체";
        renderRosterView(container);
      });
      return item;
    };

    // Render grouped by track
    Object.entries(trackGroups).forEach(([track, items]) => {
      const grpHdr = document.createElement("div"); grpHdr.className = "roster-group-hdr";
      const badge = document.createElement("span"); badge.className = "roster-track-badge";
      badge.textContent = track; grpHdr.appendChild(badge);
      tplList.appendChild(grpHdr);
      items.forEach(({ tpl, gradeKey }) => tplList.appendChild(renderItem(tpl, gradeKey)));
    });
  }
  leftPanel.appendChild(tplList);

  const rightPanel = document.createElement("div"); rightPanel.className = "roster-right"; rightPanel.id = "rosterRightPanel";
  if (!selectedRosterTemplateId) {
    const e = document.createElement("div"); e.className = "roster-right-empty"; e.textContent = "왼쪽에서 과목을 선택하세요"; rightPanel.appendChild(e);
  } else { renderRosterDetail(rightPanel, container); }

  layout.append(leftPanel, rightPanel);
  container.appendChild(layout);
  // Restore scroll positions
  requestAnimationFrame(() => {
    const rp = document.getElementById("rosterRightPanel"); if (rp) rp.scrollTop = prevRightScroll;
    const lp = document.getElementById("rosterTplList");   if (lp) lp.scrollTop = prevLeftScroll;
  });
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
  if (cc > 0) {
    const ccBadge = document.createElement("span"); ccBadge.className = "roster-class-count-badge";
    ccBadge.textContent = `${cc}개 반`; ccBadge.title = "과목 설정에서 변경하세요";
    ccWrap.appendChild(ccBadge);
  }
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
      tab.textContent = `${sectionLabel(i)} (${sc}명)`;
      const idx = i;
      tab.addEventListener("click", () => { selectedSection = idx; renderRosterView(container); });
      tabsWrap.appendChild(tab);
    }
    if (selectedSection >= 0) {
      const clrSec = makeBtn(`${sectionLabel(selectedSection)} 초기화`, "danger-btn compact-btn", () => { clearRoster(selectedRosterTemplateId, selectedSection); renderRosterView(container); });
      clrSec.disabled = !canEdit(); clrSec.style.marginLeft = "auto"; tabsWrap.appendChild(clrSec);
    }
    panel.appendChild(tabsWrap);
  }

  // Enrolled table
  const secTitle = document.createElement("div"); secTitle.className = "roster-section-title";
  secTitle.textContent = multi && selectedSection === -1 ? "전체 수강 학생" : multi ? `${sectionLabel(selectedSection)} 수강 학생` : "수강 학생";
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
      const sc = showSec ? `<td class="roster-class-name">${sectionLabel(entry.sectionIdx ?? 0)}</td>` : "";
      tr.innerHTML = `<td class="col-num">${idx + 1}</td>${sc}<td class="roster-class-name">${cls.grade}</td><td class="roster-class-name">${cls.name}</td><td>${stu.name}</td><td>${stu.gender}</td>`;
      const delTd = document.createElement("td"); const delBtn = makeBtn("×", "stu-del-btn", () => { removeFromRoster(selectedRosterTemplateId, entry.classId, entry.studentId); renderRosterView(container); });
      delBtn.disabled = !canEdit(); delTd.appendChild(delBtn); tr.appendChild(delTd); tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); panel.appendChild(wrap);
  }

  // No add area in "전체" tab
  if (multi && selectedSection === -1) return;

  // Build competing template IDs (same track+grade, not this template)
  const competingTplIds = new Set();
  for (const grade of GRADE_KEYS) {
    const board = appState.curriculum.gradeBoards[grade] || [];
    const selectedRow = board.find(r => r.sem1TemplateId === selectedRosterTemplateId || r.sem2TemplateId === selectedRosterTemplateId);
    if (!selectedRow || selectedRow.track === "공통") continue;
    board.forEach(row => {
      if (row.track !== selectedRow.track) return;
      [row.sem1TemplateId, row.sem2TemplateId].filter(Boolean).forEach(tid => {
        if (tid !== selectedRosterTemplateId) competingTplIds.add(tid);
      });
    });
  }
  // Map: studentId → competing template name (for tooltip)
  const competingMap = new Map(); // studentId → tplName
  if (competingTplIds.size > 0) {
    competingTplIds.forEach(tid => {
      const tpl = getTemplateById(tid); if (!tpl) return;
      const competingRoster = getRoster(tid);
      competingRoster.forEach(entry => {
        if (!competingMap.has(entry.studentId))
          competingMap.set(entry.studentId, getTemplateCardTitle(tpl));
      });
    });
  }

  // Add area
  const addTitle = document.createElement("div"); addTitle.className = "roster-section-title";
  addTitle.textContent = multi ? `학생 배정 → ${sectionLabel(selectedSection)} (반에서 선택)` : "학생 추가 (반에서 선택)";
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
  }).sort((a, b) => {
    const gi = GRADE_KEYS.indexOf(a.grade) - GRADE_KEYS.indexOf(b.grade);
    if (gi !== 0) return gi;
    return a.name.localeCompare(b.name, "ko");
  });
  if (!filteredClasses.length) {
    const nc = document.createElement("div"); nc.className = "manager-empty"; nc.textContent = "조건에 맞는 반이 없습니다."; classesArea.appendChild(nc);
  } else {
    filteredClasses.forEach(cls => {
      const fstu = cls.students.filter(s => filterGender === "전체" || s.gender === filterGender); if (!fstu.length) return;
      const fstu_noCompeting = fstu.filter(s => !competingMap.has(s.id));
      const clsCard = document.createElement("div"); clsCard.className = "roster-class-card";
      const clsHdr  = document.createElement("div"); clsHdr.className  = "roster-class-header";
      const label   = document.createElement("span"); label.className = "roster-class-label"; label.textContent = `${gradeDisplay(cls.grade)} ${cls.name}`;
      const allBtn  = makeBtn("전체 추가", "secondary-btn compact-btn", () => { fstu.forEach(s => addToRoster(selectedRosterTemplateId, cls.id, s.id, multi ? selectedSection : 0)); renderRosterView(container); });
      allBtn.disabled = !canEdit();
      const noCompBtn = makeBtn("경쟁 제외 추가", "roster-nocompete-btn compact-btn", () => {
        fstu_noCompeting.forEach(s => addToRoster(selectedRosterTemplateId, cls.id, s.id, multi ? selectedSection : 0));
        renderRosterView(container);
      });
      noCompBtn.disabled = !canEdit() || competingTplIds.size === 0;
      noCompBtn.title = competingTplIds.size > 0 ? "경쟁 과목 수강 중인 학생 제외하고 추가" : "경쟁 과목 없음";
      clsHdr.append(label, noCompBtn, allBtn); clsCard.appendChild(clsHdr);
      const stuList = document.createElement("div"); stuList.className = "roster-stu-list";
      fstu.forEach(s => {
        const entry = roster.find(e => e.classId === cls.id && e.studentId === s.id);
        const curSec = entry ? (entry.sectionIdx ?? 0) : null;
        const inThis = entry !== undefined && (!multi || curSec === selectedSection);
        const inOther = entry !== undefined && multi && curSec !== selectedSection;
        const stuBtn = document.createElement("button"); stuBtn.type = "button";
        const inCompeting = competingMap.has(s.id);
        stuBtn.className = "roster-stu-chip" + (inThis ? " enrolled" : "") + (inOther ? " in-other-section" : "") + (inCompeting && !inThis ? " in-competing" : "");
        stuBtn.textContent = s.name || "(이름없음)";
        if (inOther) stuBtn.title = `현재 ${sectionLabel(curSec)} → 클릭시 ${sectionLabel(selectedSection)}으로 이동`;
        else if (inCompeting && !inThis) stuBtn.title = `${competingMap.get(s.id)} 수강 중`;
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
      XLSX.utils.book_append_sheet(wb, ws, `${sectionLabel(i)}`);
    }
  } else {
    const rows = [["번호","학년","반","이름","성별","생년월일"]];
    roster.forEach((entry, idx) => { const cls = getClassById(entry.classId); const stu = cls?.students.find(s => s.id === entry.studentId); if (!stu) return; rows.push([idx + 1, cls.grade, cls.name, stu.name, stu.gender, stu.birth]); });
    const ws = XLSX.utils.aoa_to_sheet(rows); ws["!cols"] = [{ wch:6 },{ wch:8 },{ wch:10 },{ wch:12 },{ wch:6 },{ wch:14 }];
    XLSX.utils.book_append_sheet(wb, ws, getTemplateCardTitle(tpl) || "수강명단");
  }
  XLSX.writeFile(wb, `HIS_Roster_${getTemplateCardTitle(tpl) || "과목"}.xlsx`);
}
