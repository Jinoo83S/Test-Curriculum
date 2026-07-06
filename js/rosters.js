// ================================================================
// rosters.js · Subject-Student Roster Mutations + View Rendering
// ================================================================
import { GRADE_KEYS } from "./config.js";
import { makeBtn, sectionLabel, gradeDisplay, clean } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave } from "./state.js?v=2026-07-06-state-cache-unified-r232";
import { getClasses, getClassById } from "./students.js";
import { getTemplateById, getTemplateCardTitle, getTemplateTeacherSummary } from "./templates.js";

const ROSTER_LEVELS = {
  middle: { label: "중등", hint: "7–9학년", grades: ["7학년", "8학년", "9학년"] },
  high:   { label: "고등", hint: "10–12학년", grades: ["10학년", "11학년", "12학년"] },
};
let rosterSchoolLevel = "middle";
const ROSTER_FILTER_MISSING = "__missing__";

function getActiveRosterGrades() {
  return ROSTER_LEVELS[rosterSchoolLevel]?.grades || ROSTER_LEVELS.middle.grades;
}
function isGradeInActiveLevel(grade) {
  return getActiveRosterGrades().includes(grade);
}
function filterRosterEntriesByActiveLevel(list) {
  const classes = appState.classes?.classes || [];
  return (list || []).filter(entry => {
    const cls = classes.find(c => c.id === entry.classId);
    return cls ? isGradeInActiveLevel(cls.grade) : true;
  });
}
function renderRosterLevelTabs(container) {
  const tabs = document.createElement("div");
  tabs.className = "setup-level-tabs roster-level-tabs";
  Object.entries(ROSTER_LEVELS).forEach(([key, info]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "setup-level-tab" + (key === rosterSchoolLevel ? " active" : "");
    btn.innerHTML = `<strong>${info.label}</strong><span>${info.hint}</span>`;
    btn.addEventListener("click", () => {
      if (rosterSchoolLevel === key) return;
      rosterSchoolLevel = key;
      rosterGradeFilter = "전체";
      filterGrade = "전체";
      filterClass = "전체";
      selectedSection = 0;
      selectedRosterTemplateId = null;
      selectedRosterContextGrade = null;
      renderRosterView(container);
    });
    tabs.appendChild(btn);
  });
  return tabs;
}

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
export function getRosterMeta(templateId) {
  const meta = rosterMeta()[templateId] || {};
  return { classCount: cleanMetaValue(meta.classCount), missingExcluded: !!meta.missingExcluded };
}
function cleanMetaValue(value) { return String(value ?? "").trim(); }
export function getClassCount(templateId) { return Math.max(0, parseInt(getRosterMeta(templateId).classCount, 10) || 0); }
export function isMissingRosterExcluded(templateId) { return !!getRosterMeta(templateId).missingExcluded; }
export function isRosterMissing(templateId) {
  return filterRosterEntriesByActiveLevel(getRoster(templateId)).length <= 0 && !isMissingRosterExcluded(templateId);
}
export function setRosterClassCount(templateId, value) {
  if (!canEdit()) return;
  if (!rosterMeta()[templateId]) rosterMeta()[templateId] = {};
  rosterMeta()[templateId].classCount = value;
  scheduleSave("rosters");
}
export function setMissingRosterExcluded(templateId, excluded) {
  if (!canEdit()) return;
  if (!rosterMeta()[templateId]) rosterMeta()[templateId] = {};
  rosterMeta()[templateId].missingExcluded = !!excluded;
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
export function clearRoster(templateId, sectionIdx = null, gradeKey = null) {
  if (!canEdit()) return;
  const label = [gradeKey ? gradeDisplay(gradeKey) : "", sectionIdx !== null ? sectionLabel(sectionIdx) : "전체"].filter(Boolean).join(" ");
  if (!confirm(`이 과목의 ${label} 수강 명단을 모두 지울까요?`)) return;
  const gradeClassIds = gradeKey ? new Set(getClasses().filter(c => c.grade === gradeKey).map(c => c.id)) : null;
  const shouldRemove = e => {
    if (gradeClassIds && !gradeClassIds.has(e.classId)) return false;
    if (sectionIdx !== null && (e.sectionIdx ?? 0) !== sectionIdx) return false;
    return true;
  };
  rosters()[templateId] = (rosters()[templateId] || []).filter(e => !shouldRemove(e));
  scheduleSave("rosters");
}

// ── Module state ──────────────────────────────────────────────────
let selectedRosterTemplateId = null;
let selectedRosterContextGrade = null; // detail view is scoped to the grade where the subject card was selected
let rosterGradeFilter = "전체";
let filterGrade = "전체", filterClass = "전체", filterGender = "전체";
let selectedSection = 0; // 0-based; -1 = "전체" view

// ── Helpers ───────────────────────────────────────────────────────
const buildLabel = tpl => { const t = getTemplateTeacherSummary(tpl); return t ? `${getTemplateCardTitle(tpl)} - ${t}` : getTemplateCardTitle(tpl); };

function getTrackForTemplate(tplId) {
  for (const grade of getActiveRosterGrades()) {
    const row = (appState.curriculum.gradeBoards[grade] || []).find(r => r.sem1TemplateId === tplId || r.sem2TemplateId === tplId);
    if (row) return row.track || "공통";
  }
  return "공통";
}

function getPlacedTemplates(gf) {
  // Build in curriculum row order: grade → track → position in board
  const seen = new Set();
  const ordered = [];
  getActiveRosterGrades().forEach(grade => {
    if (gf !== "전체" && grade !== gf) return;
    (appState.curriculum.gradeBoards[grade] || []).forEach(row => {
      [row.sem1TemplateId, row.sem2TemplateId].filter(Boolean).forEach(tid => {
        const seenKey = `${grade}::${tid}`;
        if (seen.has(seenKey)) return; seen.add(seenKey);
        const tpl = appState.templates.templates.find(t => t.id === tid);
        if (tpl) ordered.push({ tpl, track: row.track || "공통", gradeKey: grade });
      });
    });
  });
  return ordered;
}

function isGenderSplitTemplate(tpl) {
  const text = [
    tpl?.nameKo, tpl?.nameEn,
    tpl?.sem1NameKo, tpl?.sem1NameEn,
    tpl?.sem2NameKo, tpl?.sem2NameEn,
  ].map(clean).join(" ");
  return /\[(남|여|M|F)\]/i.test(text);
}

function getCurriculumCommonAutoTargets() {
  const targets = [];
  const seen = new Set();
  getActiveRosterGrades().forEach(grade => {
    const gradeClasses = getClasses()
      .filter(c => c.grade === grade)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko"));
    const gradeClassCount = gradeClasses.length;
    if (!gradeClassCount) return;

    (appState.curriculum?.gradeBoards?.[grade] || []).forEach(row => {
      if (clean(row.category) !== "교과") return;
      if (clean(row.track) !== "공통") return;
      [row.sem1TemplateId, row.sem2TemplateId].filter(Boolean).forEach(templateId => {
        const key = `${grade}::${templateId}`;
        if (seen.has(key)) return;
        seen.add(key);
        const tpl = getTemplateById(templateId);
        if (!tpl || isGenderSplitTemplate(tpl)) return;
        const subjectClassCount = getClassCount(templateId);
        if (subjectClassCount !== gradeClassCount) return;
        targets.push({ grade, templateId, tpl, classes: gradeClasses });
      });
    });
  });
  return targets;
}

function applyCommonAutoRosters(container) {
  if (!canEdit()) return;
  const targets = getCurriculumCommonAutoTargets();
  if (!targets.length) {
    alert("자동 구성할 공통 과목이 없습니다.\n조건: 교과/공통, [남]/[여] 제외, 과목 반수 = 학년 반수");
    return;
  }

  const preview = targets.slice(0, 12).map(t => `${gradeDisplay(t.grade)} ${getTemplateCardTitle(t.tpl)} (${t.classes.length}개 반)`).join("\n");
  const more = targets.length > 12 ? `
... 외 ${targets.length - 12}개` : "";
  if (!confirm(`공통 과목 ${targets.length}개를 자동 구성합니다.

${preview}${more}

각 과목의 A/B/C 반에 해당 학급 전체 학생을 추가합니다. 계속할까요?`)) return;

  let subjectCount = 0;
  let entryCount = 0;
  targets.forEach(({ grade, templateId, classes }) => {
    if (!rosters()[templateId]) rosters()[templateId] = [];
    const targetClassIds = new Set(classes.map(c => c.id));
    // 현재 학년의 대상 반은 기존 배정을 지우고 A/B/C 반 기준으로 다시 채웁니다.
    rosters()[templateId] = (rosters()[templateId] || []).filter(e => !targetClassIds.has(e.classId));
    classes.forEach((cls, sectionIdx) => {
      (cls.students || []).forEach(stu => {
        rosters()[templateId].push({ classId: cls.id, studentId: stu.id, sectionIdx });
        entryCount += 1;
      });
    });
    subjectCount += 1;
  });

  scheduleSave("rosters");
  renderRosterView(container);
  alert(`공통 자동구성 완료\n과목 ${subjectCount}개 / 학생 배정 ${entryCount}건`);
}


function getRosterCountForGrade(templateId, gradeKey) {
  return getRoster(templateId, gradeKey).length;
}
function isRosterMissingForGrade(templateId, gradeKey) {
  return getRosterCountForGrade(templateId, gradeKey) <= 0 && !isMissingRosterExcluded(templateId);
}
function getGradeStudents(gradeKey) {
  const students = [];
  getClasses().filter(c => c.grade === gradeKey).forEach(cls => {
    (cls.students || []).forEach(stu => students.push({ ...stu, classId: cls.id }));
  });
  return students;
}
function getGradeStudentIds(gradeKey) {
  return new Set(getGradeStudents(gradeKey).map(stu => stu.id));
}
function getGenderTargetForTemplate(tpl) {
  const text = [
    tpl?.nameKo, tpl?.nameEn,
    tpl?.sem1NameKo, tpl?.sem1NameEn,
    tpl?.sem2NameKo, tpl?.sem2NameEn,
  ].map(clean).join(" ");
  if (/\[(남|M)\]/i.test(text)) return "남";
  if (/\[(여|F)\]/i.test(text)) return "여";
  return "";
}
function getExpectedStudentIdsForTemplateGrade(tpl, gradeKey) {
  const targetGender = getGenderTargetForTemplate(tpl);
  const ids = new Set();
  getGradeStudents(gradeKey).forEach(stu => {
    if (targetGender && clean(stu.gender) !== targetGender) return;
    ids.add(stu.id);
  });
  return ids;
}
function countAssignedExpectedStudents(templateId, gradeKey, expectedIds) {
  const assignedIds = new Set();
  getRoster(templateId, gradeKey).forEach(entry => {
    if (expectedIds.has(entry.studentId)) assignedIds.add(entry.studentId);
  });
  return assignedIds.size;
}
function getRosterCompletionStats(items) {
  const total = items.length;
  const missing = items.filter(({ tpl, gradeKey }) => isRosterMissingForGrade(tpl.id, gradeKey)).length;
  return { total, missing, complete: total > 0 && missing === 0 };
}
function getRosterTrackStudentStats(track, items) {
  const normalizedItems = [];
  const seenItemKeys = new Set();
  (items || []).forEach(({ tpl, gradeKey }) => {
    if (!tpl || !gradeKey) return;
    const key = `${gradeKey}::${tpl.id}`;
    if (seenItemKeys.has(key)) return;
    seenItemKeys.add(key);
    normalizedItems.push({ tpl, gradeKey });
  });

  const gradeKeys = [...new Set(normalizedItems.map(it => it.gradeKey))];
  const isCommonTrack = clean(track) === "공통";
  let expected = 0;
  let assigned = 0;

  if (isCommonTrack) {
    // 공통 과목은 과목별로 해당 학년 학생이 모두 들어갔는지 확인합니다.
    // [남]/[여] 과목은 전체 학년 학생 수가 아니라 해당 성별 학생 수를 기준으로 완료를 판단합니다.
    normalizedItems.forEach(({ tpl, gradeKey }) => {
      if (isMissingRosterExcluded(tpl.id)) return;
      const expectedIds = getExpectedStudentIdsForTemplateGrade(tpl, gradeKey);
      expected += expectedIds.size;
      assigned += countAssignedExpectedStudents(tpl.id, gradeKey, expectedIds);
    });
  } else {
    // 선택/배정 과목은 "해당 구분 안에 실제 배정된 인원 합계"로 완료를 판단합니다.
    // 예: 국어 42명 + 한국어 1명 = 43명이면, 7학년 전체 43명 기준 완료입니다.
    // 주의: 여기서는 고유 학생 수가 아니라 좌측 과목 카드에 표시되는 수강 인원 합계를 사용합니다.
    // 단, `미지정 제외`는 수강명단이 실제로 0명인 과목만 완료 기준에서 제외합니다.
    // 한국어처럼 미지정 제외 상태가 남아 있어도 1명 이상 배정되어 있으면 그 인원은 합산해야 합니다.
    gradeKeys.forEach(gradeKey => {
      const expectedForGrade = getGradeStudents(gradeKey).length;
      expected += expectedForGrade;

      let gradeAssigned = 0;
      normalizedItems
        .filter(item => item.gradeKey === gradeKey)
        .forEach(({ tpl }) => {
          if (!tpl) return;
          const rosterCount = getRosterCountForGrade(tpl.id, gradeKey);
          if (rosterCount <= 0 && isMissingRosterExcluded(tpl.id)) return;
          gradeAssigned += rosterCount;
        });

      assigned += Math.min(gradeAssigned, expectedForGrade);
    });
  }

  const missing = Math.max(0, expected - assigned);
  return { expected, assigned, missing, complete: expected > 0 && missing === 0, isCommonTrack };
}
function makeStatusPill(text, kind) {
  const pill = document.createElement("span");
  pill.className = `roster-list-status roster-list-status-${kind}`;
  pill.textContent = text;
  pill.style.display = "inline-flex";
  pill.style.alignItems = "center";
  pill.style.justifyContent = "center";
  pill.style.borderRadius = "999px";
  pill.style.padding = "2px 7px";
  pill.style.fontSize = "11px";
  pill.style.fontWeight = "800";
  pill.style.lineHeight = "1.2";
  pill.style.whiteSpace = "nowrap";
  if (kind === "ok") {
    pill.style.background = "#dcfce7";
    pill.style.color = "#166534";
  } else if (kind === "warn") {
    pill.style.background = "#ffedd5";
    pill.style.color = "#9a3412";
  } else {
    pill.style.background = "#e0e7ff";
    pill.style.color = "#1e40af";
  }
  return pill;
}
function createRosterGradeHeader(grade, items) {
  const stats = getRosterCompletionStats(items);
  const hdr = document.createElement("div");
  hdr.className = "roster-grade-group-hdr";
  hdr.style.display = "flex";
  hdr.style.alignItems = "center";
  hdr.style.gap = "6px";
  hdr.style.margin = "8px 0 5px";
  hdr.style.padding = "7px 8px";
  hdr.style.borderRadius = "10px";
  hdr.style.background = "#dbeafe";
  hdr.style.border = "1px solid #bfdbfe";
  hdr.style.color = "#1e3a8a";
  hdr.style.fontWeight = "900";
  hdr.style.position = "sticky";
  hdr.style.top = "0";
  hdr.style.zIndex = "2";
  const title = document.createElement("span");
  title.textContent = gradeDisplay(grade);
  title.style.flex = "1";
  hdr.appendChild(title);
  hdr.appendChild(makeStatusPill(`미배정 ${stats.missing}`, stats.missing ? "warn" : "ok"));
  return hdr;
}
function createRosterTrackHeader(track, items) {
  const stats = getRosterTrackStudentStats(track, items);
  const grpHdr = document.createElement("div");
  grpHdr.className = "roster-group-hdr";
  grpHdr.style.display = "flex";
  grpHdr.style.alignItems = "center";
  grpHdr.style.gap = "6px";
  grpHdr.style.padding = "4px 6px";
  grpHdr.style.margin = "4px 0 3px";
  const badge = document.createElement("span");
  badge.className = "roster-track-badge";
  badge.textContent = track;
  grpHdr.appendChild(badge);
  let status;
  if (stats.expected <= 0) {
    status = makeStatusPill("확인 필요", "neutral");
  } else if (stats.complete) {
    status = makeStatusPill("완료", "ok");
  } else {
    status = makeStatusPill(`미완료 ${stats.assigned}/${stats.expected}명`, "warn");
  }
  status.title = stats.isCommonTrack
    ? "공통 구분은 과목별 학생 수 기준입니다. [남]/[여] 과목은 해당 성별 학생 수로 완료를 판단합니다."
    : "선택/배정 구분은 같은 구분 안에 배정된 학생 수 합산 기준입니다.";
  grpHdr.appendChild(status);
  return grpHdr;
}

// ── Main Render ───────────────────────────────────────────────────
export function renderRosterView(container) {
  // Preserve both panel scroll positions across re-renders
  const prevRightScroll = document.getElementById("rosterRightPanel")?.scrollTop ?? 0;
  const prevLeftScroll  = document.getElementById("rosterTplList")?.scrollTop ?? 0;
  container.innerHTML = "";
  if (!getActiveRosterGrades().includes(rosterGradeFilter) && rosterGradeFilter !== "전체" && rosterGradeFilter !== ROSTER_FILTER_MISSING) rosterGradeFilter = "전체";
  const activePairs = new Set(getPlacedTemplates("전체").map(({ tpl, gradeKey }) => `${gradeKey}::${tpl.id}`));
  if (selectedRosterTemplateId && selectedRosterContextGrade && !activePairs.has(`${selectedRosterContextGrade}::${selectedRosterTemplateId}`)) {
    selectedRosterTemplateId = null;
    selectedRosterContextGrade = null;
    selectedSection = 0;
  }
  const hdr = document.createElement("div"); hdr.className = "roster-top-compact";
  const title = document.createElement("h2"); title.textContent = "수강 명단";
  const levelTabs = renderRosterLevelTabs(container);
  const commonAutoBtn = makeBtn("공통 자동구성", "primary-btn compact-btn roster-common-auto-btn", () => applyCommonAutoRosters(container));
  commonAutoBtn.disabled = !canEdit();
  commonAutoBtn.title = "교과/공통 과목 중 [남]/[여] 과목을 제외하고, 과목 반수와 학년 반수가 같은 과목을 A/B/C 반 전체로 자동 구성합니다.";
  hdr.append(title, levelTabs, commonAutoBtn);
  container.appendChild(hdr);
  const layout = document.createElement("div"); layout.className = "roster-layout";

  // Left panel
  const leftPanel = document.createElement("div"); leftPanel.className = "roster-left";
  const leftHdr   = document.createElement("div"); leftHdr.className   = "roster-left-header";
  const leftTitle = document.createElement("h3");  leftTitle.textContent = "과목 선택";
  const gfSel = document.createElement("select"); gfSel.className = "roster-grade-filter";
  const gradeFilterOptions = ["전체", ...getActiveRosterGrades(), ROSTER_FILTER_MISSING];
  gradeFilterOptions.forEach(g => {
    const o = document.createElement("option");
    o.value = g;
    o.textContent = g === "전체"
      ? `${ROSTER_LEVELS[rosterSchoolLevel].label} 전체`
      : g === ROSTER_FILTER_MISSING ? "명단 미지정" : g;
    if (g === rosterGradeFilter) o.selected = true;
    gfSel.appendChild(o);
  });
  gfSel.addEventListener("change", e => { rosterGradeFilter = e.target.value; renderRosterView(container); });
  leftHdr.append(leftTitle, gfSel); leftPanel.appendChild(leftHdr);

  const tplList = document.createElement("div"); tplList.className = "roster-template-list"; tplList.id = "rosterTplList";
  const baseFilterGrade = rosterGradeFilter === ROSTER_FILTER_MISSING ? "전체" : rosterGradeFilter;
  const ftpl = getPlacedTemplates(baseFilterGrade).filter(({ tpl, gradeKey }) => rosterGradeFilter !== ROSTER_FILTER_MISSING || isRosterMissingForGrade(tpl.id, gradeKey));
  if (!ftpl.length) {
    const e = document.createElement("div");
    e.className = "roster-template-empty";
    e.textContent = rosterGradeFilter === ROSTER_FILTER_MISSING
      ? "명단 미지정 과목이 없습니다."
      : `${ROSTER_LEVELS[rosterSchoolLevel].label} 과정에 배치된 과목이 없습니다.`;
    tplList.appendChild(e);
  } else {
    // Group by track (curriculum order preserved within each track)
    const trackGroups = {}; // track → [{ tpl, gradeKey }]
    ftpl.forEach(({ tpl, track, gradeKey }) => {
      if (!trackGroups[track]) trackGroups[track] = [];
      trackGroups[track].push({ tpl, gradeKey });
    });

    const renderItem = (tpl, gradeKey) => {
      const rosterCount = getRosterCountForGrade(tpl.id, gradeKey);
      const missingExcluded = isMissingRosterExcluded(tpl.id);
      const missingRoster = rosterCount <= 0 && !missingExcluded;
      const item = document.createElement("div");
      item.className = "roster-template-item"
        + (tpl.id === selectedRosterTemplateId && gradeKey === selectedRosterContextGrade ? " active" : "")
        + (missingRoster ? " roster-template-missing-roster" : "");
      item.title = missingRoster ? "수강명단이 0명인 과목입니다." : "";
      const lbl = document.createElement("div"); lbl.className = "roster-template-label"; lbl.textContent = buildLabel(tpl); lbl.title = lbl.textContent;
      const metaRow = document.createElement("div"); metaRow.className = "roster-template-meta-row";
      // Grade chip
      const gradeChip = document.createElement("span"); gradeChip.className = "grade-chip grade-chip-sm";
      gradeChip.textContent = gradeDisplay(gradeKey);
      metaRow.appendChild(gradeChip);
      // Student count
      const cnt = document.createElement("div");
      cnt.className = "roster-template-count" + (missingRoster ? " roster-template-count-empty" : "");
      cnt.textContent = `${rosterCount}명`;
      metaRow.appendChild(cnt);
      if (missingRoster) {
        const warn = document.createElement("span");
        warn.className = "roster-missing-roster-badge";
        warn.textContent = "명단 미지정";
        metaRow.appendChild(warn);
      } else if (rosterCount <= 0 && missingExcluded) {
        const badge = document.createElement("span");
        badge.className = "roster-missing-excluded-badge";
        badge.textContent = "미지정 제외";
        metaRow.appendChild(badge);
      }
      // Section badge
      const cc = getClassCount(tpl.id);
      if (cc > 0) {
        const b = document.createElement("span"); b.className = "roster-section-badge";
        b.textContent = `${cc}반`; metaRow.appendChild(b);
      }
      item.append(lbl, metaRow);
      item.addEventListener("click", () => {
        selectedRosterTemplateId = tpl.id;
        selectedRosterContextGrade = gradeKey;
        selectedSection = 0;
        filterGrade = gradeKey; filterClass = "전체";
        renderRosterView(container);
      });
      return item;
    };

    // Render grouped by grade → track when viewing all grades. For a single grade, keep track grouping.
    const shouldGroupByGrade = rosterGradeFilter === "전체" || rosterGradeFilter === ROSTER_FILTER_MISSING;
    if (shouldGroupByGrade) {
      const gradeGroups = {};
      ftpl.forEach(({ tpl, track, gradeKey }) => {
        if (!gradeGroups[gradeKey]) gradeGroups[gradeKey] = {};
        if (!gradeGroups[gradeKey][track]) gradeGroups[gradeKey][track] = [];
        gradeGroups[gradeKey][track].push({ tpl, gradeKey });
      });
      getActiveRosterGrades().forEach(grade => {
        const group = gradeGroups[grade];
        if (!group) return;
        const gradeItems = Object.values(group).flat();
        tplList.appendChild(createRosterGradeHeader(grade, gradeItems));
        Object.entries(group).forEach(([track, items]) => {
          tplList.appendChild(createRosterTrackHeader(track, items));
          items.forEach(({ tpl, gradeKey }) => tplList.appendChild(renderItem(tpl, gradeKey)));
        });
      });
    } else {
      Object.entries(trackGroups).forEach(([track, items]) => {
        tplList.appendChild(createRosterTrackHeader(track, items));
        items.forEach(({ tpl, gradeKey }) => tplList.appendChild(renderItem(tpl, gradeKey)));
      });
    }
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
  const detailGradeKey = selectedRosterContextGrade && isGradeInActiveLevel(selectedRosterContextGrade) ? selectedRosterContextGrade : null;
  const roster = detailGradeKey ? getRoster(selectedRosterTemplateId, detailGradeKey) : filterRosterEntriesByActiveLevel(getRoster(selectedRosterTemplateId));
  const missingExcluded = isMissingRosterExcluded(selectedRosterTemplateId);
  const rosterMissing = roster.length <= 0 && !missingExcluded;
  const cc   = getClassCount(selectedRosterTemplateId);
  const multi = cc > 1;
  if (multi && selectedSection >= cc) selectedSection = 0;
  if (!multi) selectedSection = 0;

  // Header
  if (rosterMissing) panel.classList.add("roster-detail-missing-roster");
  const rhdr = document.createElement("div"); rhdr.className = "roster-right-header";
  const rtitle = document.createElement("div"); rtitle.className = "roster-right-title";
  const rname = document.createElement("h3"); rname.textContent = detailGradeKey ? `${gradeDisplay(detailGradeKey)} · ${buildLabel(tpl)}` : buildLabel(tpl);
  const rcnt  = document.createElement("span");
  rcnt.className = "student-count-badge" + (rosterMissing ? " roster-count-badge-empty" : "");
  rcnt.textContent = roster.length <= 0
    ? (missingExcluded ? "0명 수강 · 미지정 제외" : "0명 수강 · 명단 미지정")
    : `${roster.length}명 수강`;
  rtitle.append(rname, rcnt);
  const ccWrap = document.createElement("div"); ccWrap.className = "roster-class-count-wrap";
  if (cc > 0) {
    const ccBadge = document.createElement("span"); ccBadge.className = "roster-class-count-badge";
    ccBadge.textContent = `${cc}개 반`; ccBadge.title = "과목 설정에서 변경하세요";
    ccWrap.appendChild(ccBadge);
  }
  const clearAll = makeBtn("명단 초기화", "danger-btn compact-btn", () => { clearRoster(selectedRosterTemplateId, null, detailGradeKey); renderRosterView(container); });
  clearAll.disabled = !canEdit();
  const excludeMissingBtn = makeBtn(
    missingExcluded ? "미지정 제외 해제" : "미지정 제외",
    (missingExcluded ? "secondary-btn" : "warning-soft-btn") + " compact-btn roster-missing-exclude-toggle",
    () => { setMissingRosterExcluded(selectedRosterTemplateId, !missingExcluded); renderRosterView(container); }
  );
  excludeMissingBtn.disabled = !canEdit();
  excludeMissingBtn.title = missingExcluded
    ? "다시 명단 미지정 검사 대상에 포함합니다."
    : "0명이어도 명단 미지정 과목으로 표시하지 않습니다.";
  const expBtn = makeBtn("📥 내보내기", "secondary-btn compact-btn", () => exportRosterXlsx(selectedRosterTemplateId));
  rhdr.append(rtitle, ccWrap, clearAll, excludeMissingBtn, expBtn);
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
      const sc = getRosterSection(selectedRosterTemplateId, i, detailGradeKey).length;
      const tab = document.createElement("button"); tab.type = "button";
      tab.className = "roster-section-tab" + (selectedSection === i ? " active" : "");
      tab.textContent = `${sectionLabel(i)} (${sc}명)`;
      const idx = i;
      tab.addEventListener("click", () => { selectedSection = idx; renderRosterView(container); });
      tabsWrap.appendChild(tab);
    }
    if (selectedSection >= 0) {
      const clrSec = makeBtn(`${sectionLabel(selectedSection)} 초기화`, "danger-btn compact-btn", () => { clearRoster(selectedRosterTemplateId, selectedSection, detailGradeKey); renderRosterView(container); });
      clrSec.disabled = !canEdit(); clrSec.style.marginLeft = "auto"; tabsWrap.appendChild(clrSec);
    }
    panel.appendChild(tabsWrap);
  }

  // Enrolled table
  const secTitle = document.createElement("div"); secTitle.className = "roster-section-title";
  secTitle.textContent = multi && selectedSection === -1 ? "전체 수강 학생" : multi ? `${sectionLabel(selectedSection)} 수강 학생` : "수강 학생";
  panel.appendChild(secTitle);
  const displayRoster = multi && selectedSection >= 0 ? getRosterSection(selectedRosterTemplateId, selectedSection, detailGradeKey) : roster;

  const enrolledSlot = document.createElement("div");
  enrolledSlot.className = "roster-enrolled-slot";
  enrolledSlot.style.height = "244px";
  enrolledSlot.style.minHeight = "244px";
  enrolledSlot.style.maxHeight = "244px";
  enrolledSlot.style.overflowY = "auto";
  enrolledSlot.style.overflowX = "hidden";
  enrolledSlot.style.boxSizing = "border-box";

  if (!displayRoster.length) {
    const e = document.createElement("div");
    e.className = "roster-enrolled-empty" + (rosterMissing ? " roster-enrolled-empty-warning" : "");
    e.style.height = "100%";
    e.style.display = "flex";
    e.style.alignItems = "center";
    e.style.justifyContent = "center";
    e.style.boxSizing = "border-box";
    e.textContent = rosterMissing
      ? "수강명단이 0명입니다. 아래 학생 목록에서 수강 학생을 추가해 주세요."
      : missingExcluded ? "이 과목은 명단 미지정 검사에서 제외되어 있습니다." : "아직 수강 학생이 없습니다.";
    enrolledSlot.appendChild(e);
  } else {
    const wrap = document.createElement("div"); wrap.className = "roster-enrolled-wrap";
    wrap.style.maxHeight = "none";
    wrap.style.overflow = "visible";
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
    table.appendChild(tbody); wrap.appendChild(table); enrolledSlot.appendChild(wrap);
  }
  panel.appendChild(enrolledSlot);

  // No add area in "전체" tab
  if (multi && selectedSection === -1) return;

  // Build competing template IDs (same grade + same track, not this template)
  const competingTplIds = new Set();
  const competingGrades = detailGradeKey ? [detailGradeKey] : getActiveRosterGrades();
  competingGrades.forEach(grade => {
    const board = appState.curriculum.gradeBoards[grade] || [];
    const selectedRow = board.find(r => r.sem1TemplateId === selectedRosterTemplateId || r.sem2TemplateId === selectedRosterTemplateId);
    if (!selectedRow || clean(selectedRow.track) === "공통") return;
    board.forEach(row => {
      if (clean(row.track) !== clean(selectedRow.track)) return;
      [row.sem1TemplateId, row.sem2TemplateId].filter(Boolean).forEach(tid => {
        if (tid !== selectedRosterTemplateId) competingTplIds.add(tid);
      });
    });
  });
  // Map: studentId → competing template names (for tooltip + warning)
  const competingMap = new Map(); // studentId → Set<tplName>
  if (competingTplIds.size > 0) {
    competingTplIds.forEach(tid => {
      const tpl = getTemplateById(tid); if (!tpl) return;
      const competingRoster = detailGradeKey ? getRoster(tid, detailGradeKey) : filterRosterEntriesByActiveLevel(getRoster(tid));
      competingRoster.forEach(entry => {
        if (!competingMap.has(entry.studentId)) competingMap.set(entry.studentId, new Set());
        competingMap.get(entry.studentId).add(getTemplateCardTitle(tpl));
      });
    });
  }
  const getCompetingLabel = studentId => [...(competingMap.get(studentId) || [])].join(", ");
  const isAlreadyInCurrentRoster = (classId, studentId) => roster.some(e => e.classId === classId && e.studentId === studentId);
  const getCompetingConflicts = entries => (entries || []).filter(e => competingMap.has(e.studentId) && !isAlreadyInCurrentRoster(e.classId, e.studentId));
  const removeFromCompetingRosters = conflicts => {
    if (!conflicts?.length || competingTplIds.size <= 0) return 0;
    const conflictKeys = new Set(conflicts.map(e => `${e.classId}::${e.studentId}`));
    let removedCount = 0;
    competingTplIds.forEach(tid => {
      const before = rosters()[tid] || [];
      if (!before.length) return;
      const after = before.filter(entry => {
        const shouldRemove = conflictKeys.has(`${entry.classId}::${entry.studentId}`);
        if (shouldRemove) removedCount += 1;
        return !shouldRemove;
      });
      if (after.length !== before.length) rosters()[tid] = after;
    });
    if (removedCount > 0) scheduleSave("rosters");
    return removedCount;
  };
  const confirmCompetingAssignments = (entries, actionLabel = "추가") => {
    const conflicts = getCompetingConflicts(entries);
    if (!conflicts.length) return { ok: true, conflicts: [] };
    const sample = conflicts.slice(0, 12).map(e => {
      const cls = getClassById(e.classId);
      const stu = cls?.students?.find(s => s.id === e.studentId);
      return `- ${cls ? `${gradeDisplay(cls.grade)} ${cls.name}` : ""} ${stu?.name || "(이름없음)"} → ${getCompetingLabel(e.studentId)}`;
    }).join("\n");
    const more = conflicts.length > 12 ? `\n... 외 ${conflicts.length - 12}명` : "";
    const ok = confirm(`이미 같은 구분의 경쟁 과목에 배정된 학생이 ${conflicts.length}명 있습니다.\n\n${sample}${more}\n\n확인을 누르면 기존 경쟁 과목 수강명단에서 제거하고 현재 과목에 ${actionLabel}합니다.`);
    return { ok, conflicts };
  };
  const addEntriesWithCompetitionWarning = (entries, actionLabel = "추가") => {
    if (!canEdit()) return;
    const result = confirmCompetingAssignments(entries, actionLabel);
    if (!result.ok) return;
    removeFromCompetingRosters(result.conflicts);
    entries.forEach(({ classId, studentId }) => addToRoster(selectedRosterTemplateId, classId, studentId, multi ? selectedSection : 0));
    renderRosterView(container);
  };

  // Add area
  const addTitle = document.createElement("div"); addTitle.className = "roster-section-title";
  addTitle.textContent = multi ? `학생 배정 → ${sectionLabel(selectedSection)} (반에서 선택)` : "학생 추가 (반에서 선택)";
  panel.appendChild(addTitle);

  const filterBar = document.createElement("div"); filterBar.className = "roster-filter-bar";
  const gradeSel  = buildFilterSelect("학년", ["전체", ...getActiveRosterGrades()], filterGrade, v => { filterGrade = v; filterClass = "전체"; renderRosterView(container); });
  const classOpts = ["전체", ...getClasses().filter(c => isGradeInActiveLevel(c.grade) && (filterGrade === "전체" || c.grade === filterGrade)).map(c => c.name).filter((v, i, a) => a.indexOf(v) === i)];
  const classSel  = buildFilterSelect("반", classOpts, filterClass, v => { filterClass = v; renderRosterView(container); });
  const genderSel = buildFilterSelect("성별", ["전체","남","여"], filterGender, v => { filterGender = v; renderRosterView(container); });
  const addAllBtn = makeBtn("필터 전체 추가", "primary-btn compact-btn", () => {
    addEntriesWithCompetitionWarning(getFilteredStudentEntries(), "추가");
  });
  addAllBtn.disabled = !canEdit();
  filterBar.append(gradeSel, classSel, genderSel, addAllBtn); panel.appendChild(filterBar);

  const classesArea = document.createElement("div"); classesArea.className = "roster-add-area";
  const filteredClasses = getClasses().filter(c => {
    if (!isGradeInActiveLevel(c.grade)) return false;
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
      const allBtn  = makeBtn("전체 추가", "secondary-btn compact-btn", () => {
        addEntriesWithCompetitionWarning(fstu.map(s => ({ classId: cls.id, studentId: s.id })), "추가");
      });
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
        else if (inCompeting && !inThis) stuBtn.title = `${getCompetingLabel(s.id)} 수강 중`;
        stuBtn.disabled = !canEdit();
        stuBtn.addEventListener("click", () => {
          if (inThis) {
            removeFromRoster(selectedRosterTemplateId, cls.id, s.id);
            renderRosterView(container);
          } else {
            addEntriesWithCompetitionWarning([{ classId: cls.id, studentId: s.id }], "추가");
          }
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
    if (!isGradeInActiveLevel(cls.grade)) return;
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
