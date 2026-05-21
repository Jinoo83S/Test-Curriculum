// ================================================================
// timetable.js · Timetable Page — Main Module
// ================================================================
import { GRADE_KEYS, CATEGORY_PALETTE } from "./config.js";
import { login, logout, onAuth, canEdit } from "./auth.js";
import { appState, subscribeAll, unsubscribeAll, setOnUpdate, scheduleSave, saveNow,
         normalizeTimetableEntry, normalizeTimetableConstraint, migrateFromLegacy } from "./state.js";
import { getTemplateById, getTemplateCardTitle, splitTeacherNames } from "./templates.js";
import { uid, makeBtn, sectionLabel, gradeDisplay } from "./utils.js";
import { getTtCards, getTtCardById } from "./ttcards.js";
import { getRooms, renderRoomsView } from "./rooms.js";
import { detectConflicts, detectConstraintViolations, getConflictLabel } from "./timetable-conflicts.js";

// ── Accessors ─────────────────────────────────────────────────────
const ttDomain  = () => appState.timetable;
const entries   = () => ttDomain().entries;
const ttConfig  = () => ttDomain().config;
const constraints = () => ttDomain().teacherConstraints;

// ── Module state ──────────────────────────────────────────────────
let currentView    = "all";
let currentGrade   = "7학년";
let currentTeacher = "";
let currentRoom    = "";
let dragData       = null;
let conflictMap    = new Map();
let constraintMap  = new Map();

// ── DOM refs ──────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const ttGrid       = () => $("ttGrid");
const ttAuthStatus = () => $("ttAuthStatus");
const ttLoginBtn   = () => $("ttLoginBtn");
const ttLogoutBtn  = () => $("ttLogoutBtn");


// ── Grade colors ──────────────────────────────────────────────────
const GRADE_COLORS = {
  "7학년":  { bg:"#dbeafe", text:"#1d4ed8", border:"#3b82f6" },
  "8학년":  { bg:"#dcfce7", text:"#166534", border:"#22c55e" },
  "9학년":  { bg:"#fef3c7", text:"#92400e", border:"#f59e0b" },
  "10학년": { bg:"#fce7f3", text:"#be185d", border:"#ec4899" },
  "11학년": { bg:"#ede9fe", text:"#6d28d9", border:"#8b5cf6" },
  "12학년": { bg:"#e0f2fe", text:"#0369a1", border:"#0ea5e9" }
};
function getGradeColor(gradeKey) {
  return GRADE_COLORS[gradeKey] || { bg:"#f1f5f9", text:"#374151", border:"#94a3b8" };
}

// ── Entry CRUD ────────────────────────────────────────────────────
function addEntry(data) {
  if (!canEdit()) return null;
  const e = normalizeTimetableEntry({ id: uid("ent"), ...data });
  if (!e.templateId) return null;
  entries().push(e); scheduleSave("timetable"); return e;
}
function removeEntry(id) {
  if (!canEdit()) return;
  ttDomain().entries = entries().filter(e => e.id !== id);
  scheduleSave("timetable");
}
function updateEntry(id, field, value) {
  if (!canEdit()) return;
  const e = entries().find(e => e.id === id); if (!e) return;
  e[field] = value; scheduleSave("timetable");
}
function updateConstraint(teacher, field, value) {
  if (!canEdit()) return;
  if (!constraints()[teacher]) constraints()[teacher] = normalizeTimetableConstraint({});
  constraints()[teacher][field] = value; scheduleSave("timetable");
}
function toggleUnavailable(teacher, day, period) {
  if (!canEdit()) return;
  if (!constraints()[teacher]) constraints()[teacher] = normalizeTimetableConstraint({});
  const slots = constraints()[teacher].unavailableSlots;
  const idx = slots.findIndex(s => s.day === day && s.period === period);
  if (idx >= 0) slots.splice(idx, 1); else slots.push({ day, period });
  scheduleSave("timetable");
}
function updatePeriodLabel(idx, value) {
  if (!canEdit()) return;
  ttConfig().periodLabels[idx] = value; scheduleSave("timetable");
}
function setPeriodCount(n) {
  if (!canEdit()) return;
  const count = Math.max(1, Math.min(12, n));
  const labels = Array.from({ length: count }, (_, i) => ttConfig().periodLabels[i] || `${i}교시`);
  ttConfig().periodCount = count; ttConfig().periodLabels = labels;
  scheduleSave("timetable");
}
function setLunchConfig(afterPeriod, show) {
  if (!canEdit()) return;
  if (afterPeriod !== undefined) ttConfig().lunchAfterPeriod = afterPeriod;
  if (show !== undefined) ttConfig().showLunch = show;
  scheduleSave("timetable");
}

// ── Data helpers ──────────────────────────────────────────────────
function getSubjectsForGrade(gradeKey) {
  const board = appState.curriculum.gradeBoards[gradeKey] || [];
  const seen = new Set();
  return board.flatMap(row => {
    const ids = [row.sem1TemplateId, row.sem2TemplateId].filter(Boolean);
    return ids.filter(id => !seen.has(id) && seen.add(id))
      .map(id => getTemplateById(id)).filter(Boolean);
  });
}
function getCreditsForTemplate(gradeKey, templateId) {
  const row = (appState.curriculum.gradeBoards[gradeKey] || [])
    .find(r => r.sem1TemplateId === templateId || r.sem2TemplateId === templateId);
  return row ? (parseFloat(row.credits) || 0) : 0;
}
function getCategoryForTemplate(gradeKey, templateId) {
  const row = (appState.curriculum.gradeBoards[gradeKey] || [])
    .find(r => r.sem1TemplateId === templateId || r.sem2TemplateId === templateId);
  return row?.category || "";
}
function getCategoryColor(category) {
  const idx = (appState.curriculum.options?.category || []).indexOf(category);
  return idx >= 0 ? CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length] : { bg:"#f1f5f9", text:"#374151" };
}
function getAssignedCount(templateId, gradeKey) {
  return entries().filter(e => entryHasGrade(e, gradeKey) && entryTemplateIds(e).includes(templateId)).length;
}
function getTeachersForTemplate(templateId) {
  const tpl = getTemplateById(templateId); if (!tpl) return [];
  return [...new Set([
    ...splitTeacherNames(tpl.teacher),
    ...splitTeacherNames(tpl.sem1Teacher),
    ...splitTeacherNames(tpl.sem2Teacher)
  ].filter(Boolean))];
}
function getSectionCount(templateId) {
  const meta = appState.rosters?.rosterMeta?.[templateId];
  return Math.max(1, parseInt(meta?.classCount) || 1);
}

// ── Unit helpers ──────────────────────────────────────────────────
/** Find the group and unit that contains this templateId */
function getUnitForTemplate(templateId) {
  for (const grp of (appState.templates.templateGroups || [])) {
    for (const unit of (grp.units || [])) {
      if (unit.templateIds.includes(templateId)) return { group: grp, unit };
    }
  }
  return null;
}

/** Get display title for a unit (comma-joined template names) */
function getUnitDisplayTitle(unit) {
  return unit.templateIds
    .map(id => { const t = getTemplateById(id); return t ? getTemplateCardTitle(t) : "?"; })
    .filter(Boolean).join(" / ") || unit.name || "?";
}

/** Get all grade keys covered by a unit's templates */
function getUnitGradeKeys(unit) {
  const grades = new Set();
  unit.templateIds.forEach(id => {
    GRADE_KEYS.forEach(g => {
      const board = appState.curriculum.gradeBoards[g] || [];
      if (board.some(r => r.sem1TemplateId === id || r.sem2TemplateId === id)) grades.add(g);
    });
  });
  return [...grades];
}

/** Get teachers for a unit (union of all template teachers) */
function getUnitTeachers(unit) {
  return [...new Set(unit.templateIds.flatMap(id => getTeachersForTemplate(id)))];
}

/**
 * Build schedulable items for auto-assign.
 * Returns items where each item = one timetable card slot to fill.
 * Groups with isConcurrent=true are returned as "blocks" (arrays that must share a slot).
 */
function buildSchedulableItems() {
  const ttcards = getTtCards();
  const ttcardMap = new Map(ttcards.map(c => [c.id, c]));

  // Set of ttcard IDs that are in units
  const ttcardIdsInUnits = new Set(
    (appState.templates.templateGroups || []).flatMap(g => g.units.flatMap(u => u.ttcardIds || []))
  );
  // Cards in poolCardIds (in group but not in unit) are treated as standalone with a groupId for concurrent check
  const poolCardGroupMap = new Map(); // ttcardId → groupId
  (appState.templates.templateGroups || []).forEach(g => {
    (g.poolCardIds || []).forEach(id => { if (!ttcardIdsInUnits.has(id)) poolCardGroupMap.set(id, g.id); });
  });
  // Set of templateIds covered by units (for legacy standalone exclusion)
  const templateIdsInUnits = new Set(
    (appState.templates.templateGroups || []).flatMap(g => g.units.flatMap(u => u.templateIds || []))
  );

  const standalone = [];
  const groupBlocks = [];

  // ── Group units (ttcard-based) ────────────────────────────────────
  (appState.templates.templateGroups || []).forEach(grp => {
    if (!grp.units.length) return;
    const unitItems = [];
    grp.units.forEach(unit => {
      const unitTtcards = (unit.ttcardIds || []).map(id => ttcardMap.get(id)).filter(Boolean);
      if (!unitTtcards.length) return;

      const gradeKeys = [...new Set(unitTtcards.map(c => c.gradeKey))];
      const credits = Math.max(1, ...unitTtcards.map(c => {
        const row = (appState.curriculum.gradeBoards[c.gradeKey] || [])
          .find(r => r.sem1TemplateId === c.templateId || r.sem2TemplateId === c.templateId);
        return parseFloat(row?.credits) || 0;
      }).filter(v => v > 0));
      const teachers = [...new Set(unitTtcards.flatMap(c => getTeachersForTemplate(c.templateId)))];

      if (credits > 0) unitItems.push({ unit, gradeKeys, credits, teachers: teachers.join(","),
        ttcards: unitTtcards });
    });
    if (unitItems.length) groupBlocks.push({ group: grp, unitItems });
  });

  // ── Standalone ttcards (not in any unit) ──────────────────────────
  ttcards.forEach(card => {
    if (ttcardIdsInUnits.has(card.id)) return;
    const row = (appState.curriculum.gradeBoards[card.gradeKey] || [])
      .find(r => r.sem1TemplateId === card.templateId || r.sem2TemplateId === card.templateId);
    const credits = parseFloat(row?.credits) || 0;
    if (!credits) return;
    const teacher = getTeachersForTemplate(card.templateId).filter(Boolean).join(",");
    const groupId = poolCardGroupMap.get(card.id) || null;
    for (let i = 0; i < credits; i++) {
      standalone.push({ kind:"standalone", ttcardId: card.id,
        templateId: card.templateId, sectionIdx: card.sectionIdx,
        gradeKey: card.gradeKey, teacherName: teacher,
        groupId // carry groupId for concurrent check
      });
    }
  });

  // ── Legacy fallback: templates not covered by any ttcard or unit ──
  if (!ttcards.length) {
    GRADE_KEYS.forEach(gradeKey => {
      getSubjectsForGrade(gradeKey).forEach(tpl => {
        if (templateIdsInUnits.has(tpl.id)) return;
        const credits  = getCreditsForTemplate(gradeKey, tpl.id);
        const sections = getSectionCount(tpl.id);
        const teacher  = getTeachersForTemplate(tpl.id)[0] || "";
        for (let sec = 0; sec < sections; sec++)
          for (let i = 0; i < credits; i++)
            standalone.push({ kind:"standalone", templateId: tpl.id, sectionIdx: sec, gradeKey, teacherName: teacher });
      });
    });
  }

  return { standalone, groupBlocks };
}

// ── Conflict recompute ────────────────────────────────────────────
function recomputeConflicts() {
  conflictMap   = detectConflicts(entries(), appState.templates.templateGroups, appState.templates.templates);
  constraintMap = detectConstraintViolations(entries(), constraints());
}

// ── Grid rendering ────────────────────────────────────────────────
function renderGrid() {
  const wrap = ttGrid(); if (!wrap) return;
  wrap.innerHTML = "";
  if (currentView === "grade")   renderGradeGrid(wrap);
  else if (currentView === "all")     renderAllClassesGrid(wrap);
  else if (currentView === "teacher") renderTeacherGrid(wrap);
  else if (currentView === "room")    renderRoomGrid(wrap);
  else if (currentView === "class")   renderClassGrid(wrap);
}

/** 학년-반별 뷰: 선택 학년의 반(sectionIdx)별 시간표 */
function renderClassGrid(wrap) {
  const days    = ["월","화","수","목","금"];
  const periods = ttConfig().periodLabels;

  // Collect sections for currentGrade
  const gradeSections = [...new Set(
    entries().filter(e => entryHasGrade(e, currentGrade)).map(e => e.sectionIdx ?? 0)
  )].sort((a, b) => a - b);
  if (!gradeSections.length) gradeSections.push(0);

  const table = document.createElement("table"); table.className = "tt-table tt-class-table";
  const thead  = document.createElement("thead"); const hr = document.createElement("tr");
  const corner = document.createElement("th"); corner.className = "tt-corner";
  corner.innerHTML = `<div class="tt-corner-label">교시</div>`;
  hr.appendChild(corner);

  // Header: one column per (day × section) → grouped by day
  days.forEach(d => {
    const th = document.createElement("th");
    th.className = "tt-day-header";
    th.colSpan = gradeSections.length;
    th.textContent = d;
    hr.appendChild(th);
  });
  thead.appendChild(hr);

  // Sub-header: section labels
  const hr2 = document.createElement("tr");
  hr2.appendChild(document.createElement("th")); // spacer
  days.forEach(() => {
    gradeSections.forEach(sec => {
      const th = document.createElement("th"); th.className = "tt-section-sub-hdr";
      th.textContent = sectionLabel(sec); hr2.appendChild(th);
    });
  });
  thead.appendChild(hr2);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  periods.forEach((label, period) => {
    const tr = document.createElement("tr");
    const pTd = document.createElement("td"); pTd.className = "tt-period-label";
    const pInp = document.createElement("input"); pInp.type = "text"; pInp.value = label; pInp.disabled = !canEdit();
    pInp.addEventListener("change", e => updatePeriodLabel(period, e.target.value));
    pTd.appendChild(pInp); tr.appendChild(pTd);

    days.forEach((_, day) => {
      gradeSections.forEach(sec => {
        const td = document.createElement("td"); td.className = "tt-cell";
        td.setAttribute("data-day", day);
        td.addEventListener("dragover", e => { if (!canEdit()) return; e.preventDefault(); td.classList.add("tt-dragover"); });
        td.addEventListener("dragleave", () => td.classList.remove("tt-dragover"));
        td.addEventListener("drop", e => {
          e.preventDefault(); td.classList.remove("tt-dragover");
          if (!dragData || !canEdit()) return;
          handleDrop({ ...dragData, sectionIdx: sec }, day, period);
        });
        const slotEntries = entries().filter(e =>
          entryHasGrade(e, currentGrade) && (e.sectionIdx ?? 0) === sec && e.day === day && e.period === period
        );
        if (slotEntries.length) {
          slotEntries.forEach(entry => {
            const c = buildEntryCard(entry, { compact: true });
            c.style.cssText += ";flex-shrink:0;width:100%";
            td.appendChild(c);
          });
        } else {
          const ph = document.createElement("div"); ph.className = "tt-cell-ph"; td.appendChild(ph);
        }
        tr.appendChild(td);
      });
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody); wrap.appendChild(table);
}

function renderGradeGrid(wrap) {
  const days = ["월", "화", "수", "목", "금"];
  const periods = ttConfig().periodLabels;
  buildGrid(periods, days, wrap, (day, period) => {
    return entries().filter(e => entryHasGrade(e, currentGrade) && e.day === day && e.period === period);
  });
}

function renderTeacherGrid(wrap) {
  const days = ["월", "화", "수", "목", "금"];
  const periods = ttConfig().periodLabels;
  buildGrid(periods, days, wrap, (day, period) =>
    entries().filter(e => splitTeacherNames(e.teacherName).includes(currentTeacher) && e.day === day && e.period === period),
    { showGrade: true, compact: true }
  );
}

function renderRoomGrid(wrap) {
  const days = ["월", "화", "수", "목", "금"];
  const periods = ttConfig().periodLabels;
  buildGrid(periods, days, wrap, (day, period) => {
    return entries().filter(e => e.roomId === currentRoom && e.day === day && e.period === period);
  }, { showGrade: true, compact: true });
}

// ── Helper: get all classes from student roster ──────────────────
function getAllClasses() {
  const classSet = new Map();
  const raw = appState.classes?.classes || [];
  // From student classes (source of truth)
  GRADE_KEYS.forEach(gradeKey => {
    raw.filter(c => c.grade === gradeKey && c.students.length > 0)
       .sort((a, b) => a.name.localeCompare(b.name))
       .forEach((cls, idx) => {
         const key = `${gradeKey}_${idx}`;
         if (!classSet.has(key)) classSet.set(key, {gradeKey, sectionIdx: idx, section: cls.name});
       });
  });
  // Fallback: derive from ttcards if no student data
  if (!classSet.size) {
    getTtCards().forEach(c => {
      const key = `${c.gradeKey}_${c.sectionIdx}`;
      if (!classSet.has(key)) classSet.set(key, {gradeKey: c.gradeKey, sectionIdx: c.sectionIdx, section: sectionLabel(c.sectionIdx)});
    });
  }
  return [...classSet.values()].sort((a, b) => {
    const gi = GRADE_KEYS.indexOf(a.gradeKey) - GRADE_KEYS.indexOf(b.gradeKey);
    return gi !== 0 ? gi : a.sectionIdx - b.sectionIdx;
  });
}

/** Full timetable: rows = classes (7A,7B,...), columns = days × periods (like aScTimetables) */
function renderAllClassesGrid(wrap) {
  const dayLabels = ["월","화","수","목","금"];
  const periods   = ttConfig().periodLabels;
  const classes   = getAllClasses();
  if (!classes.length) {
    wrap.appendChild(Object.assign(document.createElement("div"), {
      className:"tt-empty", textContent:"시간표 카드를 생성하거나 학생 명단에서 반을 추가하세요."
    }));
    return;
  }

  const numDays = dayLabels.length;
  const numPer  = periods.length;
  const DAYS    = Array.from({length: numDays}, (_, i) => i);

  const table = document.createElement("table"); table.className = "tt-table tt-all-class-table";
  const thead = document.createElement("thead");

  // Row 1: day headers
  const hr1 = document.createElement("tr");
  const corner = document.createElement("th"); corner.className = "tt-all-corner"; corner.rowSpan = 2;
  corner.innerHTML = `<span class="tt-corner-label">반</span>`;
  hr1.appendChild(corner);
  DAYS.forEach(d => {
    const th = document.createElement("th"); th.className = "tt-day-header"; th.colSpan = numPer;
    th.textContent = dayLabels[d]; hr1.appendChild(th);
  });
  thead.appendChild(hr1);

  // Row 2: period sub-headers
  const hr2 = document.createElement("tr");
  DAYS.forEach(() => {
    periods.forEach((lbl, p) => {
      const th = document.createElement("th"); th.className = "tt-period-sub-hdr";
      const inp = document.createElement("input"); inp.type = "text"; inp.value = lbl;
      inp.style.cssText = "width:24px;font-size:9px;border:none;background:transparent;text-align:center;padding:0";
      inp.disabled = true; // period labels edited in grade view
      th.appendChild(inp); hr2.appendChild(th);
    });
  });
  thead.appendChild(hr2);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  let prevGrade = null;
  classes.forEach(cls => {
    const tr = document.createElement("tr");
    if (cls.gradeKey !== prevGrade) { tr.className = "tt-all-grade-boundary"; prevGrade = cls.gradeKey; }

    // Row header: "7A", "8B" etc.
    const rowHdr = document.createElement("td"); rowHdr.className = "tt-all-row-hdr";
    const gc = getGradeColor(cls.gradeKey);
    rowHdr.style.cssText = `background:${gc.bg};color:${gc.text};border-left:3px solid ${gc.border}`;
    rowHdr.innerHTML = `<b>${gradeDisplay(cls.gradeKey)}</b><span>${cls.section}</span>`;
    tr.appendChild(rowHdr);

    DAYS.forEach(day => {
      periods.forEach((_, period) => {
        const td = document.createElement("td"); td.className = "tt-cell tt-all-cell"; td.setAttribute("data-day", day);
        td.addEventListener("dragover", e => { if (!canEdit()) return; e.preventDefault(); td.classList.add("tt-dragover"); });
        td.addEventListener("dragleave", () => td.classList.remove("tt-dragover"));
        td.addEventListener("drop", e => {
          e.preventDefault(); td.classList.remove("tt-dragover");
          if (!dragData || !canEdit()) return;
          handleDrop({ ...dragData, sectionIdx: cls.sectionIdx, gradeKey: cls.gradeKey }, day, period);
        });

        const slotEntries = entries().filter(e => {
          if (e.day !== day || e.period !== period) return false;
          const eGrades = e.gradeKeys?.length ? e.gradeKeys : [e.gradeKey].filter(Boolean);
          if (!eGrades.includes(cls.gradeKey)) return false;
          // Multi-grade entry (chapel, MS group) → show in every row of matching grade
          if (eGrades.length > 1 || e.groupId) return true;
          const eSec = e.sectionIdx ?? 0;
          if (eSec === cls.sectionIdx) return true;
          // Check roster membership for M-cards
          const tplId = e.templateId || e.templateIds?.[0];
          if (!tplId) return false;
          const allRosterEntries = (appState.rosters?.rosters?.[tplId] || []).filter(re => (re.sectionIdx??0) === eSec);
          const allCls = appState.classes?.classes || [];
          return allRosterEntries.some(re => {
            const clsObj = allCls.find(c => c.id === re.classId);
            return clsObj && clsObj.grade === cls.gradeKey && clsObj.name === cls.section;
          });
        });

        if (slotEntries.length) slotEntries.forEach(entry => td.appendChild(buildEntryCard(entry, { compact: true })));
        else { const ph = document.createElement("div"); ph.className = "tt-cell-ph"; td.appendChild(ph); }
        tr.appendChild(td);
      });
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}

function renderAllGradesGrid(wrap) {
  /* Rows = periods, Cols = 5 days, each cell = ALL grades stacked */
  const days = ["월","화","수","목","금"];
  const periods = ttConfig().periodLabels;
  const table = document.createElement("table");
  table.className = "tt-table";

  /* Header */
  const thead = document.createElement("thead"); const hr = document.createElement("tr");
  const corner = document.createElement("th"); corner.className = "tt-corner";
  corner.innerHTML = `<div class="tt-corner-label">교시</div>`;
  hr.appendChild(corner);
  days.forEach(d => { const th = document.createElement("th"); th.className = "tt-day-header"; th.textContent = d; hr.appendChild(th); });
  thead.appendChild(hr); table.appendChild(thead);

  const tbody = document.createElement("tbody");
  periods.forEach((label, period) => {
    const tr = document.createElement("tr");
    const pTd = document.createElement("td"); pTd.className = "tt-period-label";
    const pInp = document.createElement("input"); pInp.type = "text"; pInp.value = label; pInp.disabled = !canEdit();
    pInp.addEventListener("change", e => updatePeriodLabel(period, e.target.value));
    pTd.appendChild(pInp); tr.appendChild(pTd);

    days.forEach((_, day) => {
      const td = document.createElement("td"); td.className = "tt-cell"; td.setAttribute("data-day", day);
      td.addEventListener("dragover", e => { if (!canEdit()) return; e.preventDefault(); td.classList.add("tt-dragover"); });
      td.addEventListener("dragleave", () => td.classList.remove("tt-dragover"));
      td.addEventListener("drop", e => {
        e.preventDefault(); td.classList.remove("tt-dragover");
        if (!dragData || !canEdit()) return; handleDrop(dragData, day, period);
      });
      const slotEntries = entries().filter(e => e.day === day && e.period === period);
      if (!slotEntries.length) {
        const ph = document.createElement("div"); ph.className = "tt-cell-ph"; td.appendChild(ph);
      } else {
        const cg = document.createElement("div"); cg.className = "tt-cell-card-grid";
        // Single row: all cards fit in one row, auto-shrink
        cg.style.setProperty("--tt-auto-cols", String(slotEntries.length || 1));
        slotEntries.forEach(entry => cg.appendChild(buildEntryCard(entry, { showGrade: true, compact: true })));
        td.appendChild(cg);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody); wrap.appendChild(table);


}

function buildGrid(periods, days, wrap, getEntries, cardOpts = {}) {
  const table = document.createElement("table"); table.className = "tt-table";
  const thead = document.createElement("thead"); const hrow = document.createElement("tr");
  const corner = document.createElement("th"); corner.className = "tt-corner";
  corner.innerHTML = `<div class="tt-corner-label">교시</div>`;
  hrow.appendChild(corner);
  days.forEach(d => { const th = document.createElement("th"); th.className = "tt-day-header"; th.textContent = d; hrow.appendChild(th); });
  thead.appendChild(hrow); table.appendChild(thead);

  const tbody = document.createElement("tbody");
  periods.forEach((label, period) => {
    const tr = document.createElement("tr");
    const pTd = document.createElement("td"); pTd.className = "tt-period-label";
    const pInp = document.createElement("input"); pInp.type = "text"; pInp.value = label; pInp.disabled = !canEdit();
    pInp.addEventListener("change", e => { updatePeriodLabel(period, e.target.value); });
    pTd.appendChild(pInp); tr.appendChild(pTd);

    days.forEach((_, day) => {
      const td = document.createElement("td"); td.className = "tt-cell"; td.setAttribute("data-day", day);
      const slotEntries = getEntries(day, period);
      td.addEventListener("dragover", e => { if (!canEdit()) return; e.preventDefault(); td.classList.add("tt-dragover"); });
      td.addEventListener("dragleave", () => td.classList.remove("tt-dragover"));
      td.addEventListener("drop", e => {
        e.preventDefault(); td.classList.remove("tt-dragover");
        if (!dragData || !canEdit()) return;
        handleDrop(dragData, day, period);
      });
      if (!slotEntries.length) {
        const ph = document.createElement("div"); ph.className = "tt-cell-ph"; td.appendChild(ph);
      } else {
        const cg = document.createElement("div"); cg.className = "tt-cell-card-grid";
        // Single row: all cards fit in one row, auto-shrink
        cg.style.setProperty("--tt-auto-cols", String(slotEntries.length || 1));
        slotEntries.forEach(entry => cg.appendChild(buildEntryCard(entry, { ...cardOpts, compact: true })));
        td.appendChild(cg);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody); wrap.appendChild(table);

  return table;
}

// ── Common entry helpers ──────────────────────────────────────────
function entryGradeKeys(e) {
  return e.gradeKeys?.length ? e.gradeKeys : (e.gradeKey ? [e.gradeKey] : []);
}
function entryTemplateIds(e) {
  return e.templateIds?.length ? e.templateIds : (e.templateId ? [e.templateId] : []);
}
function entryHasGrade(e, grade) {
  return entryGradeKeys(e).includes(grade);
}
function entryTitle(e) {
  // Group entry → show group name
  if (e.groupId) {
    const grp = (appState.templates.templateGroups || []).find(g => g.id === e.groupId);
    if (grp?.name) return grp.name;
  }
  // ttcard standalone
  if (e.ttcardId) {
    const card = getTtCardById(e.ttcardId);
    if (card) {
      const tpl = getTemplateById(card.templateId);
      const base = tpl ? getTemplateCardTitle(tpl) : "?";
      const cc = Math.max(1, parseInt(appState.rosters?.rosterMeta?.[card.templateId]?.classCount) || 1);
      return cc > 1 ? `${base} ${sectionLabel(card.sectionIdx)}` : base;
    }
  }
  return getTemplateCardTitle(getTemplateById(e.templateId)) || "?";
}
function entryTeachers(e) {
  // Always prefer stored teacherName (most accurate)
  if (e.teacherName) return splitTeacherNames(e.teacherName).filter(Boolean);
  // Unit entry → derive from ttcardIds (new) or templateIds (legacy)
  if (e.unitId) {
    const grp  = (appState.templates.templateGroups || []).find(g => g.id === e.groupId);
    const unit = grp?.units.find(u => u.id === e.unitId);
    if (unit) {
      if (unit.ttcardIds?.length) {
        const ttcards = getTtCards();
        return [...new Set(unit.ttcardIds.flatMap(id => {
          const card = ttcards.find(c => c.id === id);
          return card ? getTeachersForTemplate(card.templateId) : [];
        }))];
      }
      if (unit.templateIds?.length) return getUnitTeachers(unit);
    }
  }
  // ttcard standalone
  if (e.ttcardId) { const card = getTtCardById(e.ttcardId); if (card) return getTeachersForTemplate(card.templateId); }
  return getTeachersForTemplate(e.templateId);
}

// ── Entry card ────────────────────────────────────────────────────
function buildEntryCard(entry, opts = {}) {
  const { compact = false, showGrade = false } = opts;
  const title     = entryTitle(entry);
  const teachers  = entryTeachers(entry);
  const displayGrades = entryGradeKeys(entry);

  const conflicts = new Set([...(conflictMap.get(entry.id) || []), ...(constraintMap.get(entry.id) || [])]);
  const hasConflict = conflicts.size > 0;

  const card = document.createElement("div");
  card.className = "tt-entry-card" + (hasConflict ? " tt-entry-conflict" : "") + (entry.pinned ? " tt-entry-pinned" : "");
  if (hasConflict) card.title = getConflictLabel(conflicts);

  const firstGrade = displayGrades[0] || currentGrade;
  const gradeColor = getGradeColor(firstGrade);
  card.style.background = gradeColor.bg;
  card.style.color      = gradeColor.text;
  card.style.borderLeft = `3px solid ${gradeColor.border}`;

  // Check if multi-entry (group with multiple cards)
  const grpId = entry.groupId;
  const grpEntries = grpId ? entries().filter(e => e.groupId === grpId && e.day === entry.day && e.period === entry.period) : [];
  const isMulti = grpEntries.length > 1;

  if (isMulti) {
    card.style.borderRight = `3px solid ${gradeColor.border}`;
    card.dataset.multi = grpEntries.length;
  }

  // Compact single-line layout: title only (click for details)
  const row = document.createElement("div"); row.className = "tt-entry-row1";
  const titleEl = document.createElement("div"); titleEl.className = "tt-entry-title"; titleEl.textContent = title;
  titleEl.style.cssText = "flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:10px;font-weight:700;line-height:1.2";
  row.appendChild(titleEl);

  if (isMulti) {
    const cnt = document.createElement("span");
    cnt.style.cssText = "font-size:8px;font-weight:700;background:rgba(0,0,0,.15);border-radius:3px;padding:0 3px;flex-shrink:0;line-height:14px";
    cnt.textContent = `×${grpEntries.length}`; row.appendChild(cnt);
  }

  if (entry.pinned) {
    const pin = document.createElement("span"); pin.textContent = "📌";
    pin.style.cssText = "font-size:8px;flex-shrink:0"; row.appendChild(pin);
  }

  card.appendChild(row);

  // Click → detail modal (all info)
  card.addEventListener("click", ev => {
    if (ev.target.closest("button")) return;
    showEntryDetail(entry);
  });

  // Right-click → context menu
  card.addEventListener("contextmenu", ev => {
    ev.preventDefault();
    showEntryContextMenu(entry, ev.clientX, ev.clientY);
  });

  card.dataset.entryId = entry.id;
  card.draggable = canEdit() && !entry.pinned;
  card.addEventListener("dragstart", ev => {
    if (!canEdit() || entry.pinned || ev.target.closest("select,button")) { ev.preventDefault(); return; }
    dragData = { kind: "entry", entryId: entry.id, teacherName: entry.teacherName, gradeKey: entry.gradeKey, sectionIdx: entry.sectionIdx ?? 0 };
    applyDragHighlight(dragData);
    card.classList.add("tt-dragging");
  });
  card.addEventListener("dragend", () => { dragData = null; card.classList.remove("tt-dragging"); clearDragHighlight(); });

  return card;
}

// ── Drop handler ──────────────────────────────────────────────────
function moveEntry(entryId, day, period) {
  if (!canEdit()) return;
  const e = entries().find(x => x.id === entryId); if (!e || e.pinned) return;
  // If entry has groupId or unitId, move ALL sibling entries to same slot
  if (e.groupId || e.unitId) {
    const siblings = entries().filter(x =>
      x.id !== entryId && !x.pinned &&
      ((e.groupId && x.groupId === e.groupId) || (e.unitId && x.unitId === e.unitId)) &&
      x.day === e.day && x.period === e.period
    );
    siblings.forEach(s => { s.day = day; s.period = period; });
  }
  e.day = day; e.period = period;
  scheduleSave("timetable");
}

function handleDrop(data, day, period) {
  if (!data || !canEdit()) return;

  // 1. Move existing entry
  if (data.kind === "entry" && data.entryId) {
    moveEntry(data.entryId, day, period);
    recomputeConflicts(); renderAll(); return;
  }

  const sectionIdx = data.sectionIdx ?? 0;

  // 2. Unit drop (group-based: place ALL ttcards in the unit together)
  if (data.unitId) {
    const grp  = (appState.templates.templateGroups || []).find(g => g.id === data.groupId);
    const unit = grp?.units?.find(u => u.id === data.unitId);
    if (grp && unit) {
      const ttcardIds = unit.ttcardIds || [];
      const ttcards   = ttcardIds.map(id => getTtCardById(id)).filter(Boolean);
      if (ttcards.length) {
        const gradeKeys    = [...new Set(ttcards.map(c => c.gradeKey))];
        const templateIds  = [...new Set(ttcards.map(c => c.templateId))];
        const teacherName  = ttcards.flatMap(c => {
          const tpl = getTemplateById(c.templateId);
          return tpl ? splitTeacherNames([tpl.teacher, tpl.sem1Teacher, tpl.sem2Teacher].join(",")) : [];
        }).filter(Boolean).join(",");
        addEntry({
          day, period, sectionIdx,
          unitId: unit.id, groupId: grp.id,
          ttcardIds, templateIds, gradeKeys,
          templateId: templateIds[0], gradeKey: gradeKeys[0],
          teacherName, roomId: null
        });
        recomputeConflicts(); renderAll(); return;
      }
    }
  }

  // 3. Single ttcard drop (or pool card with groupId)
  if (data.ttcardId) {
    const card = getTtCardById(data.ttcardId);
    if (card) {
      const tpl = getTemplateById(card.templateId);
      const teacherName = tpl ? splitTeacherNames([tpl.teacher, tpl.sem1Teacher, tpl.sem2Teacher].join(",")).filter(Boolean).join(",") : "";
      // If card belongs to a group pool, find all sibling cards in the pool for the same template
      const grpId = data.groupId;
      if (grpId) {
        const grp = (appState.templates.templateGroups||[]).find(g=>g.id===grpId);
        if (grp) {
          const poolCards = (grp.poolCardIds||[]).map(id=>getTtCardById(id)).filter(Boolean);
          const templateCards = poolCards.filter(c=>c.templateId===card.templateId);
          const allCards = templateCards.length > 1 ? templateCards : [card];
          const gradeKeys = [...new Set(allCards.map(c=>c.gradeKey))];
          const ttcardIds = allCards.map(c=>c.id);
          addEntry({ day, period, sectionIdx: card.sectionIdx,
            groupId: grpId, ttcardIds, gradeKeys,
            templateId: card.templateId, gradeKey: gradeKeys[0],
            teacherName, roomId: null, ttcardId: card.id });
          recomputeConflicts(); renderAll(); return;
        }
      }
      addEntry({ day, period, templateId: card.templateId, sectionIdx: card.sectionIdx,
        gradeKey: card.gradeKey, teacherName, roomId: null, ttcardId: card.id });
      recomputeConflicts(); renderAll(); return;
    }
  }

  // 4. Legacy templateId fallback
  const templateId    = data.templateId;
  const resolvedGrade = data.gradeKey || currentGrade;
  if (!templateId) return;
  const unitInfo = getUnitForTemplate(templateId);
  if (unitInfo) {
    const { group, unit } = unitInfo;
    const gradeKeys = getUnitGradeKeys(unit);
    const teachers  = getUnitTeachers(unit).join(",");
    addEntry({
      day, period, sectionIdx,
      unitId: unit.id, groupId: group.id,
      templateIds: unit.templateIds, gradeKeys,
      templateId: unit.templateIds[0] || templateId,
      gradeKey: gradeKeys[0] || resolvedGrade,
      teacherName: teachers, roomId: null
    });
  } else {
    const teacherName = getTeachersForTemplate(templateId)[0] || "";
    addEntry({ day, period, templateId, sectionIdx, teacherName, roomId: null, gradeKey: resolvedGrade });
  }
  recomputeConflicts(); renderAll();
}


// ── Subject panel ─────────────────────────────────────────────────
// ── Subject panel ─────────────────────────────────────────────────
// ── Subject panel ─────────────────────────────────────────────────
// ── Entry detail popup ──────────────────────────────────────────
/** Popup showing card detail: 시수/분반/배정현황 */
function showSidebarCardDetail({ title, teachers, gradeKeys, credits, assigned, isDone, sectionIdx, groupName }) {
  const existing = document.getElementById("tt-entry-detail-modal");
  if (existing) existing.remove();
  const modal = document.createElement("div"); modal.id = "tt-entry-detail-modal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center";
  const box = document.createElement("div");
  box.style.cssText = "background:white;border-radius:10px;padding:18px 20px;min-width:280px;max-width:340px;box-shadow:0 8px 32px rgba(0,0,0,.25);font-size:13px;position:relative";

  const firstGrade = gradeKeys[0] || currentGrade;
  const gc = getGradeColor(firstGrade);
  box.style.borderTop = `4px solid ${gc.border}`;

  const titleEl = document.createElement("div");
  titleEl.style.cssText = "font-weight:700;font-size:15px;margin-bottom:10px;color:#1e3a5f;padding-right:20px";
  titleEl.textContent = title; box.appendChild(titleEl);

  const rows = [
    ["학년",   gradeKeys.map(g => `${gradeDisplay(g)}학년`).join(", ") || "-"],
    ["반",     sectionIdx != null ? sectionLabel(sectionIdx) : "-"],
    ["담당 교사", teachers.join(", ") || "-"],
    ["시수",   String(credits || "-")],
    ["배정 현황", `${assigned} / ${credits} 차시${isDone ? "  ✅ 완료" : ""}`],
    ["그룹",   groupName || "미배정"],
  ];

  rows.forEach(([lbl, val]) => {
    const row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px;margin-bottom:5px;font-size:12px;align-items:baseline";
    const l = document.createElement("span"); l.style.cssText = "color:#6b7280;font-weight:600;width:72px;flex-shrink:0"; l.textContent = lbl;
    const v = document.createElement("span"); v.style.cssText = "color:#1e293b;flex:1"; v.textContent = val;
    row.append(l, v); box.appendChild(row);
  });

  // Progress bar
  if (credits > 0) {
    const pct = Math.min(100, Math.round((assigned / credits) * 100));
    const bar = document.createElement("div"); bar.style.cssText = "margin-top:8px;background:#f1f5f9;border-radius:999px;height:6px;overflow:hidden";
    const fill = document.createElement("div"); fill.style.cssText = `height:100%;border-radius:999px;width:${pct}%;background:${isDone ? "#22c55e" : "#3b82f6"};transition:width .3s`;
    bar.appendChild(fill); box.appendChild(bar);
  }

  const closeBtn = document.createElement("button");
  closeBtn.style.cssText = "position:absolute;top:10px;right:12px;border:none;background:transparent;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1";
  closeBtn.textContent = "×"; closeBtn.onclick = () => modal.remove();
  box.appendChild(closeBtn); modal.appendChild(box);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function showEntryDetailByUnit(unit, group, gradeKeys) {
  // Show unit info in a simple popup (no entry edit - just info)
  const existing = document.getElementById("tt-entry-detail-modal");
  if (existing) existing.remove();
  const modal = document.createElement("div"); modal.id = "tt-entry-detail-modal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center";
  const box = document.createElement("div");
  box.style.cssText = "background:white;border-radius:10px;padding:18px 20px;min-width:260px;max-width:340px;box-shadow:0 8px 32px rgba(0,0,0,.25);font-size:13px;position:relative";
  box.innerHTML = `<div style="font-weight:700;font-size:14px;margin-bottom:8px;color:#1e3a5f">${getUnitDisplayTitle(unit)}</div>
    <div style="font-size:11px;color:#6b7280;margin-bottom:4px">그룹: ${group?.name || "-"}</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap">${gradeKeys.map(g => `<span style="background:${getGradeColor(g).border};color:white;font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px">${gradeDisplay(g)}</span>`).join("")}</div>`;
  const closeBtn = document.createElement("button");
  closeBtn.style.cssText = "position:absolute;top:10px;right:12px;border:none;background:transparent;font-size:18px;cursor:pointer;color:#9ca3af";
  closeBtn.textContent = "×"; closeBtn.onclick = () => modal.remove();
  box.appendChild(closeBtn); modal.appendChild(box);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function showEntryContextMenu(entry, x, y) {
  document.getElementById("tt-context-menu")?.remove();
  const menu = document.createElement("div"); menu.id = "tt-context-menu";
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:white;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.15);z-index:9998;min-width:180px;overflow:hidden;font-size:12px`;

  function menuItem(label, action, opts = {}) {
    const btn = document.createElement("div");
    btn.style.cssText = `padding:8px 14px;cursor:${opts.disabled?'default':'pointer'};color:${opts.danger?'#dc2626':opts.disabled?'#9ca3af':'#1e293b'};display:flex;align-items:center;gap:8px`;
    btn.innerHTML = label;
    if (!opts.disabled) {
      btn.onmouseenter = () => { btn.style.background = "#f8fafc"; };
      btn.onmouseleave = () => { btn.style.background = ""; };
      btn.onclick = () => { menu.remove(); action?.(); };
    }
    return btn;
  }
  function sep() { const hr=document.createElement("div"); hr.style.cssText="height:1px;background:#f1f5f9;margin:2px 0"; return hr; }

  // ① 수업 정보
  menu.appendChild(menuItem("📋 수업 정보 편집", () => showEntryDetail(entry)));
  // ② 과목 배정 현황 (시수별 요일/교시)
  menu.appendChild(menuItem("📅 배정 현황 보기", () => showSubjectAssignmentHistory(entry)));
  // ③ 하단 카드 하이라이트
  menu.appendChild(menuItem("🔍 하단 카드에서 찾기", () => highlightSidebarCard(entry)));
  menu.appendChild(sep());
  // ④ 고정
  menu.appendChild(menuItem(entry.pinned ? "📌 고정 해제" : "📍 이 시간에 고정", () => {
    const e = entries().find(x=>x.id===entry.id); if(e){ e.pinned=!e.pinned; scheduleSave("timetable"); renderAll(); }
  }));
  menu.appendChild(sep());
  // ⑤ 삭제
  menu.appendChild(menuItem("🗑 이 수업 삭제", () => { removeEntry(entry.id); recomputeConflicts(); renderAll(); }, { danger: true }));

  setTimeout(() => {
    document.addEventListener("click", () => menu.remove(), { once: true });
    document.addEventListener("contextmenu", () => menu.remove(), { once: true });
  }, 10);

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
}

/** Show assignment history: each placed slot for this subject */
function showSubjectAssignmentHistory(entry) {
  const existing = document.getElementById("tt-entry-detail-modal"); if (existing) existing.remove();
  const modal = document.createElement("div"); modal.id = "tt-entry-detail-modal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center";

  const box = document.createElement("div");
  box.style.cssText = "background:white;border-radius:10px;padding:18px 20px;min-width:300px;max-width:440px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.25);font-size:13px;position:relative";

  const gradeKeys = entryGradeKeys(entry);
  const gc = getGradeColor(gradeKeys[0]||currentGrade);
  box.style.borderTop = `4px solid ${gc.border}`;

  const titleEl = document.createElement("div");
  titleEl.style.cssText = "font-weight:700;font-size:15px;margin-bottom:12px;color:#1e3a5f;padding-right:24px";
  titleEl.textContent = `${entryTitle(entry)} — 배정 현황`; box.appendChild(titleEl);

  // Find all entries for same template / group
  const tplId = entry.templateId || entry.templateIds?.[0];
  const grpId = entry.groupId;
  const related = entries().filter(e => {
    if (grpId && e.groupId === grpId) return true;
    if (tplId && (e.templateId===tplId || e.templateIds?.includes(tplId))) return true;
    return false;
  }).sort((a,b) => a.day-b.day || a.period-b.period);

  const dayLabels = ["월","화","수","목","금"];
  const periods = ttConfig().periodLabels;

  if (!related.length) {
    box.appendChild(Object.assign(document.createElement("div"), { textContent:"배정된 시수가 없습니다.", style:"color:#9ca3af;font-size:12px" }));
  } else {
    const list = document.createElement("div"); list.style.cssText = "display:flex;flex-direction:column;gap:4px";
    related.forEach((e, i) => {
      const row = document.createElement("div");
      row.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;background:${e.id===entry.id?gc.bg+'99':'#f8fafc'};border:1px solid ${e.id===entry.id?gc.border:'#e2e8f0'};cursor:pointer`;
      const idxEl = document.createElement("span"); idxEl.style.cssText="font-size:10px;color:#6b7280;width:18px;text-align:center;font-weight:700"; idxEl.textContent=i+1;
      const slotEl = document.createElement("span"); slotEl.style.cssText="font-weight:700;color:#1e293b"; slotEl.textContent=`${dayLabels[e.day]} ${i+1}교시`;
      const secEl = document.createElement("span"); secEl.style.cssText="font-size:10px;color:#6b7280;flex:1"; secEl.textContent=gradeKeys.length?gradeKeys.map(g=>`${gradeDisplay(g)}`).join(","):"";
      const pinEl = document.createElement("span"); if(e.pinned) { pinEl.textContent="📌"; pinEl.style.fontSize="10px"; }
      row.append(idxEl, slotEl, secEl, pinEl);
      row.onclick = () => { modal.remove(); showEntryDetail(e); };
      list.appendChild(row);
    });
    box.appendChild(list);

    // Credits summary
    const tplCredits = (() => {
      const g = gradeKeys[0]||currentGrade;
      const row = (appState.curriculum.gradeBoards[g]||[]).find(r=>r.sem1TemplateId===tplId||r.sem2TemplateId===tplId);
      return row?.credits ?? "?";
    })();
    const sumEl = document.createElement("div"); sumEl.style.cssText="margin-top:10px;font-size:11px;color:#6b7280;text-align:right";
    sumEl.textContent = `${related.length} / ${tplCredits} 시수 배정됨`; box.appendChild(sumEl);
  }

  const closeBtn = document.createElement("button"); closeBtn.style.cssText="position:absolute;top:10px;right:12px;border:none;background:transparent;font-size:18px;cursor:pointer;color:#9ca3af"; closeBtn.textContent="×"; closeBtn.onclick=()=>modal.remove();
  box.appendChild(closeBtn); modal.appendChild(box);
  modal.addEventListener("click", e=>{if(e.target===modal)modal.remove();});
  document.body.appendChild(modal);
}

/** Highlight the matching sidebar card */
function highlightSidebarCard(entry) {
  const tplId = entry.templateId || entry.templateIds?.[0];
  const grpId = entry.groupId;
  // Remove existing highlights
  document.querySelectorAll(".tt-sc-highlighted").forEach(el => el.classList.remove("tt-sc-highlighted"));
  // Find and highlight
  document.querySelectorAll(".tt-subject-card").forEach(card => {
    const cardTitle = card.querySelector(".tt-sc-name")?.textContent || "";
    const grpMatch = grpId && card.dataset.groupId === grpId;
    const tplMatch = tplId && card.dataset.templateId === tplId;
    if (grpMatch || tplMatch) {
      card.classList.add("tt-sc-highlighted");
      card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  });
  // Clear after 3 seconds
  setTimeout(() => document.querySelectorAll(".tt-sc-highlighted").forEach(el => el.classList.remove("tt-sc-highlighted")), 3000);
}

function showEntryDetail(entry) {
  const existing = document.getElementById("tt-entry-detail-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div"); modal.id = "tt-entry-detail-modal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center";

  const box = document.createElement("div");
  box.style.cssText = "background:white;border-radius:10px;padding:18px 20px;min-width:300px;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,.25);font-size:13px;position:relative;max-height:90vh;overflow-y:auto";

  const gradeKeys = entryGradeKeys(entry);
  const gc = getGradeColor(gradeKeys[0] || currentGrade);
  box.style.borderTop = `4px solid ${gc.border}`;

  // Header: title
  const titleEl = document.createElement("div");
  titleEl.style.cssText = "font-weight:700;font-size:15px;margin-bottom:8px;color:#1e3a5f;padding-right:24px";
  titleEl.textContent = entryTitle(entry); box.appendChild(titleEl);

  function makeRow(label, value) {
    const r = document.createElement("div"); r.style.cssText = "display:flex;align-items:baseline;gap:8px;margin-bottom:6px;font-size:12px";
    const l = document.createElement("span"); l.style.cssText = "color:#6b7280;font-weight:600;width:70px;flex-shrink:0"; l.textContent = label;
    const v = document.createElement("span"); v.style.cssText = "color:#1e293b;flex:1"; v.textContent = value;
    r.append(l, v); box.appendChild(r); return r;
  }

  // 2. 학년/반
  const sectionStr = entry.sectionIdx !== undefined ? sectionLabel(entry.sectionIdx) : "-";
  makeRow("학년/반", gradeKeys.map(g => `${gradeDisplay(g)}학년 ${sectionStr}`).join(", ") || "-");

  // 3. 담당 교사
  const teachers = entryTeachers(entry);
  const tLabel = document.createElement("label"); tLabel.style.cssText="display:block;margin-bottom:3px;font-size:11px;color:#6b7280;font-weight:600"; tLabel.textContent="담당 교사";
  const tSel = document.createElement("select"); tSel.style.cssText="width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-bottom:8px"; tSel.disabled=!canEdit();
  [{ v:"", l:"교사 없음" }, ...teachers.map(t=>({v:t,l:t}))].forEach(({ v, l }) => {
    const o = document.createElement("option"); o.value=v; o.textContent=l; if(v===entry.teacherName) o.selected=true; tSel.appendChild(o);
  });
  tSel.addEventListener("change", e => { updateEntry(entry.id,"teacherName",e.target.value||null); recomputeConflicts(); renderAll(); });
  box.append(tLabel, tSel);

  // 4. 시수/배정 현황
  const tplId = entry.templateId || entry.templateIds?.[0];
  if (tplId) {
    const credits = (() => {
      const row = (appState.curriculum.gradeBoards[gradeKeys[0] || currentGrade]||[]).find(r=>r.sem1TemplateId===tplId||r.sem2TemplateId===tplId);
      return row?.credits ?? "-";
    })();
    const assigned = entries().filter(e => (e.templateId===tplId||e.templateIds?.includes(tplId)) && e.gradeKey===(gradeKeys[0]||currentGrade)).length;
    makeRow("시수/배정", `${assigned} / ${credits} 차시`);
  }

  // 5. 그룹
  if (entry.groupId) {
    const grp = (appState.templates.templateGroups||[]).find(g=>g.id===entry.groupId);
    makeRow("그룹", grp?.name || entry.groupId);
  }

  // 6. 교실 (editable)
  const rooms = getRooms();
  const rLabel = document.createElement("label"); rLabel.style.cssText="display:block;margin-bottom:3px;font-size:11px;color:#6b7280;font-weight:600"; rLabel.textContent="교실";
  const rSel = document.createElement("select"); rSel.style.cssText="width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-bottom:8px"; rSel.disabled=!canEdit();
  const noR = document.createElement("option"); noR.value=""; noR.textContent="교실 없음"; rSel.appendChild(noR);
  rooms.forEach(r=>{const o=document.createElement("option");o.value=r.id;o.textContent=r.name;if(r.id===entry.roomId)o.selected=true;rSel.appendChild(o);});
  rSel.addEventListener("change", e=>{updateEntry(entry.id,"roomId",e.target.value||null);recomputeConflicts();renderAll();});
  box.append(rLabel, rSel);

  // 7. 요일/교시 (editable) + 고정
  const dayLabels = ["월","화","수","목","금"];
  const periods = ttConfig().periodLabels;
  const dtRow = document.createElement("div"); dtRow.style.cssText="display:flex;gap:6px;margin-bottom:8px";
  const dayLabel = document.createElement("label"); dayLabel.style.cssText="font-size:11px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px"; dayLabel.textContent="요일";
  const daySel = document.createElement("select"); daySel.style.cssText="padding:5px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;flex:1"; daySel.disabled=!canEdit();
  dayLabels.forEach((l,i)=>{const o=document.createElement("option");o.value=i;o.textContent=l;if(i===entry.day)o.selected=true;daySel.appendChild(o);});
  const perLabel = document.createElement("label"); perLabel.style.cssText="font-size:11px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px"; perLabel.textContent="교시";
  const perSel = document.createElement("select"); perSel.style.cssText="padding:5px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;flex:1"; perSel.disabled=!canEdit();
  periods.forEach((l,i)=>{const o=document.createElement("option");o.value=i;o.textContent=`${i+1}교시`;if(i===entry.period)o.selected=true;perSel.appendChild(o);});
  const dayWrap = document.createElement("div"); dayWrap.style.flex="1"; dayWrap.append(dayLabel, daySel);
  const perWrap = document.createElement("div"); perWrap.style.flex="1"; perWrap.append(perLabel, perSel);

  const applySlot = () => {
    const d=parseInt(daySel.value), p=parseInt(perSel.value);
    moveEntry(entry.id, d, p); recomputeConflicts(); renderAll();
  };
  daySel.addEventListener("change", applySlot); perSel.addEventListener("change", applySlot);
  dtRow.append(dayWrap, perWrap); box.appendChild(dtRow);

  // Pin toggle
  if (canEdit()) {
    const pinBtn = document.createElement("button");
    pinBtn.style.cssText="width:100%;padding:5px;border:1px solid #d1d5db;border-radius:5px;background:#f8fafc;font-size:12px;cursor:pointer;margin-bottom:8px;font-weight:600";
    pinBtn.textContent = entry.pinned ? "📌 고정 해제" : "📍 이 시간에 고정";
    pinBtn.onclick = () => {
      const e = entries().find(x=>x.id===entry.id); if(!e) return;
      e.pinned = !e.pinned; scheduleSave("timetable"); renderAll(); modal.remove();
    };
    box.appendChild(pinBtn);
  }

  // Delete
  if (canEdit()) {
    const delBtn = document.createElement("button"); delBtn.style.cssText="width:100%;padding:6px;border:1px solid #fca5a5;border-radius:5px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:12px;font-weight:600";
    delBtn.textContent="🗑 이 수업 삭제"; delBtn.onclick=()=>{removeEntry(entry.id);recomputeConflicts();renderAll();modal.remove();};
    box.appendChild(delBtn);
  }

  const closeBtn = document.createElement("button"); closeBtn.style.cssText="position:absolute;top:10px;right:12px;border:none;background:transparent;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1"; closeBtn.textContent="×"; closeBtn.onclick=()=>modal.remove();
  box.appendChild(closeBtn); modal.appendChild(box);
  modal.addEventListener("click", e=>{if(e.target===modal)modal.remove();});
  document.body.appendChild(modal);
}

function renderSubjectPanel() {
  const panel = $("ttSubjectsContent"); if (!panel) return;
  panel.innerHTML = "";

  const ttcards = appState.timetable?.ttcards || [];

  // ── TtCard-based panel (new flow) ─────────────────────────────
  if (ttcards.length > 0) {
    renderSubjectPanelTtCards(panel, ttcards); return;
  }

  // ── Legacy template-based panel (fallback) ────────────────────
  renderSubjectPanelLegacy(panel);
}

function renderSubjectPanelTtCards(panel, allTtcards) {
  const availableCards = [], doneCards = [];
  const ttcardMap = new Map(allTtcards.map(c => [c.id, c]));
  const seenIds = new Set();
  const grpList = appState.templates.templateGroups || [];

  // ── Groups: one card per group ──────────────────────────────
  grpList.forEach(grp => {
    const allIds = [...(grp.poolCardIds||[]), ...(grp.units||[]).flatMap(u => u.ttcardIds||[])];
    const grpCards = allIds.map(id => ttcardMap.get(id)).filter(Boolean);
    grpCards.forEach(c => seenIds.add(c.id));
    if (!grpCards.length) return;

    const gradeKeys = [...new Set(grpCards.map(c => c.gradeKey))];
    const credits = Math.max(1, ...grpCards.map(c => {
      const row = (appState.curriculum.gradeBoards[c.gradeKey]||[])
        .find(r => r.sem1TemplateId===c.templateId||r.sem2TemplateId===c.templateId);
      return parseFloat(row?.credits)||0;
    }).filter(v=>v>0));
    const teachers = [...new Set(grpCards.flatMap(c => getTeachersForTemplate(c.templateId)))];
    const assigned = entries().filter(e => e.groupId === grp.id || grpCards.some(c => e.ttcardId===c.id)).length;
    const isDone = credits > 0 && assigned >= credits;
    const gradeColor = getGradeColor(gradeKeys[0]||"7학년");
    const cardNames = grpCards.map(c => {
      const tpl = getTemplateById(c.templateId);
      const base = tpl ? getTemplateCardTitle(tpl) : "?";
      const cc = Math.max(1, parseInt(appState.rosters?.rosterMeta?.[c.templateId]?.classCount)||1);
      return cc > 1 ? `${base} ${sectionLabel(c.sectionIdx)}` : base;
    });
    const title = `[${grp.name}] ${cardNames.join(" · ")}`;
    const card = buildSidebarCard({ title, teachers, gradeKeys, credits, assigned, isDone, gradeColor, groupName: grp.name });
    card.dataset.groupId = grp.id;
    card.style.outline = "1.5px solid " + gradeColor.border;
    if (!isDone) {
      card.addEventListener("dragstart", () => {
        const firstUnit = (grp.units||[])[0];
        const firstCard = grpCards[0];
        dragData = firstUnit
          ? { kind:"subject", unitId: firstUnit.id, groupId: grp.id,
              ttcardIds: grpCards.map(c=>c.id), templateId: firstCard?.templateId, gradeKey: gradeKeys[0] }
          : { kind:"subject", ttcardId: firstCard?.id, groupId: grp.id,
              templateId: firstCard?.templateId, gradeKey: gradeKeys[0] };
        card.classList.add("tt-dragging");
      });
      card.addEventListener("dragend", () => { dragData = null; card.classList.remove("tt-dragging"); });
    }
    (isDone ? doneCards : availableCards).push(card);
  });

  // ── Standalone ttcards (not in any group) ────────────────────
  allTtcards.forEach(c => {
    if (seenIds.has(c.id)) return;
    const tpl = getTemplateById(c.templateId); if (!tpl) return;
    const gradeColor = getGradeColor(c.gradeKey);
    const credits = (() => {
      const row = (appState.curriculum.gradeBoards[c.gradeKey]||[])
        .find(r => r.sem1TemplateId===c.templateId||r.sem2TemplateId===c.templateId);
      return parseFloat(row?.credits)||0;
    })();
    const cc = Math.max(1, parseInt(appState.rosters?.rosterMeta?.[c.templateId]?.classCount)||1);
    const assigned = entries().filter(e =>
      entryTemplateIds(e).includes(c.templateId)&&entryHasGrade(e,c.gradeKey)&&(e.sectionIdx??0)===c.sectionIdx
    ).length;
    const isDone = credits > 0 && assigned >= credits;
    const label = cc > 1 ? `${getTemplateCardTitle(tpl)} ${sectionLabel(c.sectionIdx)}` : getTemplateCardTitle(tpl);
    const card = buildSidebarCard({ title: label, teachers: getTeachersForTemplate(c.templateId),
      gradeKeys: [c.gradeKey], credits, assigned, isDone, gradeColor, sectionIdx: c.sectionIdx });
    card.dataset.templateId = c.templateId;
    if (!isDone) {
      card.addEventListener("dragstart", () => {
        dragData = { kind:"subject", ttcardId: c.id, templateId: c.templateId, sectionIdx: c.sectionIdx, gradeKey: c.gradeKey };
        card.classList.add("tt-dragging");
      });
      card.addEventListener("dragend", () => { dragData = null; card.classList.remove("tt-dragging"); });
    }
    (isDone ? doneCards : availableCards).push(card);
  });

  finalizeSidebarPanel(panel, availableCards, doneCards, "시간표 카드가 없습니다. '시간표 카드' 탭에서 카드를 생성하세요.");
}


function renderSubjectPanelLegacy(panel) {
  const availableCards = [], doneCards = [];
  const seenUnitIds = new Set(), seenStandalone = new Set();

  GRADE_KEYS.forEach(gradeKey => {
    getSubjectsForGrade(gradeKey).forEach(tpl => {
      const unitInfo = getUnitForTemplate(tpl.id);
      if (unitInfo) {
        const { group, unit } = unitInfo;
        if (seenUnitIds.has(unit.id)) return; seenUnitIds.add(unit.id);
        unit.templateIds.forEach(id => seenUnitIds.add("tpl:" + id));
        const gradeKeys  = getUnitGradeKeys(unit);
        const teachers   = getUnitTeachers(unit);
        const credits    = Math.max(1, ...unit.templateIds.map(id =>
          Math.max(...gradeKeys.map(g => getCreditsForTemplate(g, id)).filter(c => c > 0), 0)
        ).filter(c => c > 0));
        const assigned = entries().filter(e => e.unitId === unit.id).length;
        const isDone   = credits > 0 && assigned >= credits;
        const card = buildSidebarCard({
          title: getUnitDisplayTitle(unit), teachers, gradeKeys, credits, assigned, isDone, gradeColor: getGradeColor(gradeKeys[0] || gradeKey)
        });
        card.addEventListener("click", () => showEntryDetailByUnit(unit, group, gradeKeys));
        if (!isDone) {
          card.addEventListener("dragstart", () => { dragData = { kind:"subject", templateId:unit.templateIds[0], unitId:unit.id, groupId:group.id, sectionIdx:0, gradeKey: gradeKeys[0] || gradeKey }; card.classList.add("tt-dragging"); });
          card.addEventListener("dragend",   () => { dragData = null; card.classList.remove("tt-dragging"); });
        }
        (isDone ? doneCards : availableCards).push(card);
      } else {
        if (seenUnitIds.has("tpl:" + tpl.id)) return;
        const credits = getCreditsForTemplate(gradeKey, tpl.id);
        const sections = getSectionCount(tpl.id), teachers = getTeachersForTemplate(tpl.id);
        for (let sec = 0; sec < Math.max(1, sections); sec++) {
          const key = `${tpl.id}:${gradeKey}:${sec}`; if (seenStandalone.has(key)) continue; seenStandalone.add(key);
          const assigned = entries().filter(e => entryTemplateIds(e).includes(tpl.id) && entryHasGrade(e, gradeKey) && e.sectionIdx === sec).length;
          const isDone = credits > 0 && assigned >= credits;
          const gradeColor = getGradeColor(gradeKey);
          const title = sections > 1 ? `${getTemplateCardTitle(tpl)} ${sectionLabel(sec)}` : getTemplateCardTitle(tpl);
          const card = buildSidebarCard({ title, teachers, gradeKeys:[gradeKey], credits, assigned, isDone, gradeColor });
          if (!isDone) {
            card.addEventListener("dragstart", () => { dragData = { kind:"subject", templateId:tpl.id, sectionIdx:sec, gradeKey }; card.classList.add("tt-dragging"); });
            card.addEventListener("dragend",   () => { dragData = null; card.classList.remove("tt-dragging"); });
          }
          (isDone ? doneCards : availableCards).push(card);
        }
      }
    });
  });
  finalizeSidebarPanel(panel, availableCards, doneCards, "커리큘럼에 배치된 과목이 없습니다.");
}

function buildSidebarCard({ title, teachers, gradeKeys, credits, assigned, isDone, gradeColor, sectionIdx, groupName }) {
  const card = document.createElement("div");
  card.className = "tt-subject-card tt-sc-compact" + (isDone ? " tt-subject-done" : "");
  card.style.borderLeftColor = isDone ? "#22c55e" : gradeColor.border;
  card.style.background = isDone ? "#f0fdf4" : gradeColor.bg + "dd";
  card.draggable = canEdit() && !isDone;

  // Row 1: group name (for groups) or subject title | assigned/credits
  const row1 = document.createElement("div"); row1.className = "tt-sc-row1";
  const displayTitle = groupName || title;
  const nameEl = document.createElement("div"); nameEl.className = "tt-sc-name"; nameEl.textContent = displayTitle;
  nameEl.title = displayTitle;
  const badge  = document.createElement("span"); badge.className = "tt-sc-badge";
  badge.textContent = `${assigned}/${credits}`;
  badge.style.background = isDone ? "#dcfce7" : assigned > 0 ? "#fef9c3" : "#f1f5f9";
  badge.style.color = isDone ? "#166534" : "#374151";
  row1.append(nameEl, badge);

  // Row 2: unique teachers | grade chips (right)
  const row2 = document.createElement("div"); row2.className = "tt-sc-row2";
  const uniqueTeachers = [...new Set(teachers)];
  const tchEl = document.createElement("div"); tchEl.className = "tt-sc-teacher";
  tchEl.textContent = uniqueTeachers.join(", ") || "-";
  tchEl.title = uniqueTeachers.join(", ");
  const chipWrap = document.createElement("div"); chipWrap.className = "tt-sc-grade-chips";
  gradeKeys.forEach(g => {
    const chip = document.createElement("span");
    chip.style.cssText = `font-size:8px;font-weight:700;padding:0 4px;line-height:14px;border-radius:999px;background:${getGradeColor(g).border};color:white;white-space:nowrap`;
    chip.textContent = gradeDisplay(g); chipWrap.appendChild(chip);
  });
  row2.append(tchEl, chipWrap);
  card.append(row1, row2);

  card.addEventListener("click", ev => {
    if (ev.defaultPrevented) return;
    showSidebarCardDetail({ title, teachers: uniqueTeachers, gradeKeys, credits, assigned, isDone, sectionIdx, groupName });
  });

  return card;
}

function finalizeSidebarPanel(panel, available, done, emptyMsg) {
  if (!available.length && !done.length) {
    panel.appendChild(Object.assign(document.createElement("div"), { className:"tt-empty", textContent: emptyMsg })); return;
  }
  const wrapper = document.createElement("div"); wrapper.className = "tt-sc-cards";
  if (available.length) {
    panel.appendChild(Object.assign(document.createElement("div"), { className:"tt-panel-section-title", textContent:`배치 필요 (${available.length})` }));
    available.forEach(c => wrapper.appendChild(c));
  }
  if (done.length) {
    wrapper.appendChild(Object.assign(document.createElement("div"), { className:"tt-panel-section-title tt-panel-section-done", textContent:`배치 완료 (${done.length})` }));
    done.forEach(c => wrapper.appendChild(c));
  }
  panel.appendChild(wrapper);
}

// ── Constraints panel ─────────────────────────────────────────────
function renderConstraintsPanel() {
  const el = $("ttConstraintsContent"); if (!el) return;
  el.innerHTML = "";

  const fromTemplates = [...new Set(
    (appState.templates.templates || []).flatMap(t =>
      splitTeacherNames([t.teacher, t.sem1Teacher, t.sem2Teacher].join(","))
    ).filter(Boolean)
  )];
  const fromEntries = [...new Set(entries().flatMap(e => splitTeacherNames(e.teacherName)).filter(Boolean))];
  const allTeachers = [...new Set([...fromTemplates, ...fromEntries])].sort((a, b) => a.localeCompare(b, "ko"));

  if (!allTeachers.length) {
    el.innerHTML = '<div class="tt-empty">과목카드에 등록된 교사가 없습니다.</div>'; return;
  }

  const hint = document.createElement("div"); hint.className = "tt-con-hint";
  hint.textContent = "자동 배치 전 교사 조건을 설정하세요."; el.appendChild(hint);

  const dayLabels = ["월","화","수","목","금"];
  const periods = ttConfig().periodLabels;
  const rooms = getRooms();

  allTeachers.forEach(teacher => {
    if (!constraints()[teacher]) constraints()[teacher] = {};
    const c = constraints()[teacher];

    const block = document.createElement("div"); block.className = "tt-con-teacher-block";

    // ── Header row: teacher name + expand toggle ──────────────────
    const hdr = document.createElement("div"); hdr.className = "tt-con-teacher-hdr";
    const nameEl = document.createElement("span"); nameEl.className = "tt-con-name"; nameEl.textContent = teacher;
    const placed = entries().filter(e => splitTeacherNames(e.teacherName).includes(teacher)).length;
    const hasViolation = [...constraintMap.entries()].some(([id, s]) => {
      const e = entries().find(x=>x.id===id);
      return e && splitTeacherNames(e.teacherName).includes(teacher) && s.size>0;
    });
    const statEl = document.createElement("span"); statEl.className = "tt-con-stat";
    statEl.textContent = placed ? `${placed}시수 ${hasViolation?"⚠️":"✅"}` : "-";
    const togBtn = document.createElement("button"); togBtn.type = "button"; togBtn.className = "tt-con-tog";
    togBtn.textContent = c._expanded ? "▲" : "▼";
    togBtn.onclick = () => { c._expanded = !c._expanded; renderConstraintsPanel(); };
    hdr.append(nameEl, statEl, togBtn); block.appendChild(hdr);

    if (!c._expanded) { el.appendChild(block); return; }

    // ── Body ──────────────────────────────────────────────────────
    const body = document.createElement("div"); body.className = "tt-con-body";

    // Row: 하루 최대 + 최대 연속
    const numRow = document.createElement("div"); numRow.className = "tt-con-num-row";
    [
      { key: "maxPerDay",      label: "하루 최대", def: 6,  min:1, max:12 },
      { key: "maxConsecutive", label: "최대 연속", def: 4,  min:1, max:12 },
    ].forEach(f => {
      const wrap = document.createElement("label"); wrap.className = "tt-con-num-wrap";
      wrap.textContent = f.label + " ";
      const inp = document.createElement("input"); inp.type="number"; inp.min=f.min; inp.max=f.max;
      inp.value = c[f.key] ?? f.def; inp.disabled = !canEdit(); inp.style.width="44px";
      inp.addEventListener("change", e => updateConstraint(teacher, f.key, parseInt(e.target.value)||f.def));
      wrap.appendChild(inp); numRow.appendChild(wrap);
    });
    body.appendChild(numRow);

    // ── Assigned room ─────────────────────────────────────────────
    if (rooms.length) {
      const rRow = document.createElement("div"); rRow.className = "tt-con-room-row";
      const rLabel = document.createElement("label"); rLabel.textContent = "배정 교실"; rLabel.style.cssText="font-size:11px;font-weight:600;color:#6b7280;margin-right:6px";
      const rSel = document.createElement("select"); rSel.style.cssText="padding:3px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:11px"; rSel.disabled = !canEdit();
      const noR = document.createElement("option"); noR.value=""; noR.textContent="없음"; rSel.appendChild(noR);
      rooms.forEach(r => {
        const o = document.createElement("option"); o.value=r.id; o.textContent=r.name;
        if(r.id===c.assignedRoomId) o.selected=true; rSel.appendChild(o);
      });
      rSel.addEventListener("change", e => {
        updateConstraint(teacher, "assignedRoomId", e.target.value||null);
        // Apply room to all entries of this teacher
        if (canEdit()) {
          entries().forEach(en => {
            if (splitTeacherNames(en.teacherName).includes(teacher)) {
              updateEntry(en.id, "roomId", e.target.value||null);
            }
          });
          scheduleSave("timetable"); renderAll();
        }
      });
      rRow.append(rLabel, rSel); body.appendChild(rRow);
    }

    // ── Unavailable slots grid ────────────────────────────────────
    const unavLabel = document.createElement("div"); unavLabel.style.cssText="font-size:11px;font-weight:600;color:#6b7280;margin-top:8px;margin-bottom:4px"; unavLabel.textContent="수업 불가 시간 (클릭하여 토글)";
    body.appendChild(unavLabel);

    const grid = document.createElement("div"); grid.className = "tt-con-grid";
    // Header row
    const hdrRowEl = document.createElement("div"); hdrRowEl.className = "tt-con-grid-row";
    hdrRowEl.appendChild(Object.assign(document.createElement("div"), { className:"tt-con-grid-corner" }));
    dayLabels.forEach(d => {
      const th = document.createElement("div"); th.className = "tt-con-grid-day"; th.textContent = d; hdrRowEl.appendChild(th);
    });
    grid.appendChild(hdrRowEl);

    const unavSlots = c.unavailableSlots || [];
    periods.forEach((label, p) => {
      const rowEl = document.createElement("div"); rowEl.className = "tt-con-grid-row";
      const perLabel = document.createElement("div"); perLabel.className = "tt-con-grid-per"; perLabel.textContent = `${p+1}`; rowEl.appendChild(perLabel);
      dayLabels.forEach((_, d) => {
        const cell = document.createElement("div");
        const isUnavail = unavSlots.some(s => s.day===d && s.period===p);
        cell.className = "tt-con-grid-cell" + (isUnavail ? " tt-con-unavail" : "");
        cell.title = isUnavail ? "불가" : "가능";
        if (canEdit()) {
          cell.style.cursor = "pointer";
          cell.onclick = () => {
            const existing = c.unavailableSlots || [];
            const idx = existing.findIndex(s=>s.day===d&&s.period===p);
            if (idx>=0) existing.splice(idx,1);
            else existing.push({ day:d, period:p });
            updateConstraint(teacher, "unavailableSlots", existing);
          };
        }
        rowEl.appendChild(cell);
      });
      grid.appendChild(rowEl);
    });
    body.appendChild(grid);

    block.appendChild(body); el.appendChild(block);
  });
}

// ── View selectors ────────────────────────────────────────────────
function renderViewSelectors() {
  // Grade selector
  const gradeEl = $("ttGradeSelect"); const teacherEl = $("ttTeacherSelect"); const roomEl = $("ttRoomSelect");
  if (gradeEl) {
    gradeEl.innerHTML = "";
    GRADE_KEYS.forEach(g => { const o = document.createElement("option"); o.value = g; o.textContent = `${gradeDisplay(g)}학년`; if (g === currentGrade) o.selected = true; gradeEl.appendChild(o); });
    gradeEl.onchange = e => { currentGrade = e.target.value; renderAll(); };
  }
  // Teacher selector
  if (teacherEl) {
    teacherEl.innerHTML = "";
    const allTeachers = [...new Set(entries().flatMap(e => splitTeacherNames(e.teacherName)).filter(Boolean))].sort((a,b) => a.localeCompare(b,"ko"));
    if (!currentTeacher && allTeachers.length) currentTeacher = allTeachers[0];
    allTeachers.forEach(t => { const o = document.createElement("option"); o.value = t; o.textContent = t; if (t === currentTeacher) o.selected = true; teacherEl.appendChild(o); });
    teacherEl.onchange = e => { currentTeacher = e.target.value; renderAll(); };
  }
  // Room selector
  if (roomEl) {
    roomEl.innerHTML = "";
    const rooms = getRooms();
    if (!currentRoom && rooms.length) currentRoom = rooms[0].id;
    rooms.forEach(r => { const o = document.createElement("option"); o.value = r.id; o.textContent = r.name; if (r.id === currentRoom) o.selected = true; roomEl.appendChild(o); });
    roomEl.onchange = e => { currentRoom = e.target.value; renderAll(); };
  }
  // Show/hide
  gradeEl?.classList.toggle("hidden", currentView !== "grade" && currentView !== "class");
  teacherEl?.classList.toggle("hidden", currentView !== "teacher");
  roomEl?.classList.toggle("hidden", currentView !== "room");
  // In all-grades view, hide the subject panel (it's grade-specific)
  const panelEl = document.querySelector(".tt-panel");
}

// ── Conflict summary bar ──────────────────────────────────────────
function renderConflictBar() {
  const bar = $("ttConflictBar"); if (!bar) return;
  const totalConflicts = [...conflictMap.values(), ...constraintMap.values()].filter(s => s.size > 0).length;
  bar.textContent = totalConflicts > 0 ? `⚠️ 충돌 ${totalConflicts}건 발견` : "✅ 충돌 없음";
  bar.className = "tt-conflict-bar " + (totalConflicts > 0 ? "tt-conflict-bar-warn" : "tt-conflict-bar-ok");
}

// ── Auto-assign ───────────────────────────────────────────────────
const shuffle = arr => { const a = [...arr]; for (let i = a.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };

function isConcurrentTpl(templateId) {
  const tpl = appState.templates.templates?.find(t => t.id === templateId);
  const gid = tpl?.calcGroupId; if (!gid) return false;
  const grp = appState.templates.templateGroups?.find(g => g.id === gid);
  return grp?.groupType === "concurrent";
}
/** Check if a placement item/entry belongs to a concurrent group */
function isConcurrentItem(x) {
  if (x.groupId) {
    const grp = appState.templates.templateGroups?.find(g => g.id === x.groupId);
    if (grp) return grp.groupType === "concurrent" || !!grp.isConcurrent;
  }
  return isConcurrentTpl(x.templateId);
}
function sameGroupTpl(tidA, tidB) {
  const tA = appState.templates.templates?.find(t => t.id === tidA);
  const tB = appState.templates.templates?.find(t => t.id === tidB);
  return tA?.calcGroupId && tA.calcGroupId === tB?.calcGroupId;
}
function getGroupId(tid) {
  return appState.templates.templates?.find(t => t.id === tid)?.calcGroupId || null;
}
function linkedGroups(tidA, tidB) {
  const gA = getGroupId(tidA), gB = getGroupId(tidB);
  if (!gA || !gB || gA === gB) return false;
  const groups = appState.templates.templateGroups || [];
  const grpA = groups.find(g => g.id === gA);
  const grpB = groups.find(g => g.id === gB);
  return grpA?.linkedGroupId === gB || grpB?.linkedGroupId === gA;
}

function checkPlacementValid(item, slot, placed) {
  const existing = [...entries(), ...placed];
  const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
  const teachers  = splitTeacherNames(item.teacherName).filter(Boolean);

  // 1. Teacher conflict (always applies — teacher cannot be in two places)
  for (const e of slotEnts) {
    const et = splitTeacherNames(e.teacherName).filter(Boolean);
    if (teachers.some(t => et.includes(t))) {
      // Exception: same unit (co-teaching) — but NOT just same group
      if (item.unitId && e.unitId && item.unitId === e.unitId) continue;
      return false;
    }
  }

  // 2. Exact duplicate (same template+grade+section in same slot)
  if (slotEnts.some(e => e.templateId === item.templateId && e.gradeKey === item.gradeKey && e.sectionIdx === item.sectionIdx)) return false;

  // 3. Student conflict (grade overlap, same slot)
  const itemGrades = item.gradeKeys?.length ? item.gradeKeys : (item.gradeKey ? [item.gradeKey] : []);
  const sameGrade = slotEnts.filter(e => entryGradeKeys(e).some(g => itemGrades.includes(g)));
  for (const e of sameGrade) {
    // Same unit → co-located intentionally
    if (item.unitId && e.unitId && item.unitId === e.unitId) continue;
    // Same concurrent group → parallel classes
    const sameGrp = (item.groupId && e.groupId && item.groupId === e.groupId) ||
                    (sameGroupTpl(item.templateId, e.templateId));
    const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);
    if (!conc) return false;
  }

  // 4. Teacher max per day + unavailable slots
  const dayEnts = existing.filter(e => e.day === slot.day);
  for (const teacher of teachers) {
    const c = constraints()[teacher];
    // Unavailable slot check
    if (c?.unavailableSlots?.some(s => s.day === slot.day && s.period === slot.period)) return false;
    const count = dayEnts.filter(e => splitTeacherNames(e.teacherName).includes(teacher)).length;
    const max = c?.maxPerDay || 6;
    if (count >= max) return false;
  }

  // 5. Teacher max consecutive
  for (const teacher of teachers) {
    const dayPeriods = dayEnts.filter(e => splitTeacherNames(e.teacherName).includes(teacher)).map(e => e.period);
    const all = [...dayPeriods, slot.period].sort((a,b) => a-b);
    let maxC = 1, cur = 1;
    for (let i = 1; i < all.length; i++) {
      cur = all[i] === all[i-1]+1 ? cur+1 : 1;
      maxC = Math.max(maxC, cur);
    }
    if (maxC > (constraints()[teacher]?.maxConsecutive || 4)) return false;
  }
  // 6. Room conflict: if teacher has assigned room, apply; if room already occupied, skip
  for (const teacher of teachers) {
    const c = constraints()[teacher];
    if (c?.assignedRoomId) {
      // Check if assigned room is already occupied at this slot
      const roomBusy = existing.some(e => e.day===slot.day && e.period===slot.period && e.roomId===c.assignedRoomId);
      if (roomBusy) return false;
    }
  }
  return true;
}
export function autoAssignAll() {
  if (!canEdit()) return;

  const activeGrades = GRADE_KEYS.filter(g => getSubjectsForGrade(g).length > 0);
  if (!activeGrades.length) { alert("커리큘럼에 배치된 과목이 없습니다."); return; }

  if (!confirm(`전체 학년 시간표를 자동 배치합니다.\n대상: ${activeGrades.join(", ")}\n\n기존 시간표가 모두 초기화됩니다. 계속할까요?`)) return;

  // Preserve ALL pinned entries AND entries that are already satisfactorily placed
  const pinnedEntries = entries().filter(e => e.pinned);
  ttDomain().entries = [...pinnedEntries];

  const { standalone, groupBlocks } = buildSchedulableItems();

  // Count already-pinned credits per template+grade+section
  function pinnedCount(templateId, gradeKey, sectionIdx) {
    return pinnedEntries.filter(e =>
      (e.templateId===templateId || e.templateIds?.includes(templateId)) &&
      (e.gradeKey===gradeKey || e.gradeKeys?.includes(gradeKey)) &&
      (e.sectionIdx??0)===(sectionIdx??0)
    ).length;
  }

  const pc = ttConfig().periodCount;
  const baseSlots = [];
  for (let day = 0; day < 5; day++)
    for (let period = 0; period < pc; period++)
      baseSlots.push({ day, period });

  const MAX_ATTEMPTS = 8;
  let bestPlaced = [], bestFailed = [], bestScore = -1;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const placed = [], failed = [];

    // ── Place concurrent groups first (most constrained) ─────────
    for (const { group, unitItems } of groupBlocks) {
      if (!group.isConcurrent) continue;
      const maxCredits = Math.max(...unitItems.map(u => u.credits));

      for (let slot_i = 0; slot_i < maxCredits; slot_i++) {
        const activeUnitItems = unitItems.filter(u => slot_i < u.credits);
        if (!activeUnitItems.length) continue;
        // Skip if already pinned for this slot index
        const anyPinned = activeUnitItems.some(({ unit }) =>
          pinnedEntries.some(e => e.unitId === unit.id)
        );
        if (anyPinned) continue;
        let foundSlot = null;
        for (const slot of shuffle([...baseSlots])) {
          const hypo = [];
          let valid = true;
          for (const { unit, gradeKeys, teachers, ttcards: unitCards } of activeUnitItems) {
            const templateIds = [...new Set((unitCards||[]).map(c => c.templateId))];
            const item = {
              kind: "unit", unitId: unit.id, groupId: group.id,
              ttcardIds: (unitCards||[]).map(c => c.id),
              templateIds, gradeKeys,
              templateId: templateIds[0] || null, gradeKey: gradeKeys[0],
              teacherName: teachers, sectionIdx: 0
            };
            if (!checkPlacementValid(item, slot, [...placed, ...hypo])) { valid = false; break; }
            hypo.push({ ...item, ...slot });
          }
          if (valid) { foundSlot = slot; break; }
        }
        if (foundSlot) {
          activeUnitItems.forEach(({ unit, gradeKeys, teachers, ttcards: unitCards }) => {
            const templateIds = [...new Set((unitCards||[]).map(c => c.templateId))];
            placed.push(normalizeTimetableEntry({
              id: uid("ent"), ...foundSlot,
              unitId: unit.id, groupId: group.id,
              ttcardIds: (unitCards||[]).map(c => c.id),
              templateIds, gradeKeys,
              templateId: templateIds[0] || null, gradeKey: gradeKeys[0],
              teacherName: teachers, sectionIdx: 0
            }));
          });
        } else {
          activeUnitItems.forEach(({ unit }) => {
            failed.push({ unitId: unit.id, name: getUnitDisplayTitle(unit) });
          });
        }
      }
    }

    // ── Place non-concurrent units independently ─────────────────
    for (const { group, unitItems } of groupBlocks) {
      if (group.isConcurrent) continue;
      for (const { unit, gradeKeys, teachers, credits, ttcards: unitCards } of unitItems) {
        const templateIds = [...new Set((unitCards||[]).map(c => c.templateId))];
        for (let i = 0; i < credits; i++) {
          const item = {
            kind: "unit", unitId: unit.id, groupId: group.id,
            ttcardIds: (unitCards||[]).map(c => c.id),
            templateIds, gradeKeys,
            templateId: templateIds[0] || null, gradeKey: gradeKeys[0],
            teacherName: teachers, sectionIdx: 0
          };
          let found = false;
          for (const slot of shuffle([...baseSlots])) {
            if (checkPlacementValid(item, slot, placed)) {
              placed.push(normalizeTimetableEntry({ id: uid("ent"), ...item, ...slot }));
              found = true; break;
            }
          }
          if (!found) failed.push({ unitId: unit.id, name: getUnitDisplayTitle(unit) });
        }
      }
    }

    // ── Place standalone templates ────────────────────────────────
    for (const item of shuffle([...standalone])) {
      // Skip credits already covered by pinned entries
      const alreadyPinned = pinnedCount(item.templateId, item.gradeKey, item.sectionIdx);
      const needCredits = Math.max(0, 1 - alreadyPinned); // standalone = 1 per item
      if (needCredits <= 0) continue;
      let found = false;
      for (const slot of shuffle([...baseSlots])) {
        if (checkPlacementValid(item, slot, placed)) {
          placed.push(normalizeTimetableEntry({ id: uid("ent"), ...item, ...slot }));
          found = true; break;
        }
      }
      if (!found) failed.push({ name: getTemplateCardTitle(getTemplateById(item.templateId)) || "?" });
    }

    if (placed.length > bestScore) {
      bestScore  = placed.length;
      bestPlaced = placed;
      bestFailed = failed;
    }
    if (!bestFailed.length) break;
  }

  // Commit
  bestPlaced.forEach(e => entries().push(e));
  scheduleSave("timetable");
  recomputeConflicts(); renderAll();

  if (!bestFailed.length) {
    alert(`✅ 전체 ${bestPlaced.length}개 슬롯 배치 완료!`);
  } else {
    const names = [...new Set(bestFailed.map(f => f.name))];
    alert(`✅ ${bestPlaced.length}개 배치 완료\n⚠️ 미배치 ${names.length}개:\n${names.slice(0,12).join("\n")}${names.length>12?"\n...":""}` +
      `\n\n💡 교사 제약 완화 또는 직접 배치로 보완하세요.`);
  }
}
// ── Schedule controls (toolbar) ───────────────────────────────────
function renderScheduleControls() {
  const pcInp = $("ttPeriodCountInput");
  if (pcInp) pcInp.value = String(ttConfig().periodCount);
}

function renderAll() {
  recomputeConflicts();
  renderViewSelectors();
  renderScheduleControls();
  renderSubjectPanel();
  renderGrid();
  renderConstraintsPanel();
  renderConflictBar();
  const el = $("ttRoomsContent");
  if (el) renderRoomsView(el, renderAll);
}

/** Called on dragstart: highlight relevant cells / sidebar cards */
function applyDragHighlight(data) {
  if (!data || data.kind !== "subject") return;
  const teacherNames = splitTeacherNames(data.teacherName || "").filter(Boolean);
  const gradeKey = data.gradeKey;
  const sectionIdx = data.sectionIdx ?? 0;

  // Highlight existing entries that share teacher (teacher busy indicator)
  document.querySelectorAll(".tt-entry-card").forEach(c => c.classList.remove("tt-drag-teacher-busy"));
  if (teacherNames.length) {
    entries().forEach(e => {
      if (teacherNames.some(t => splitTeacherNames(e.teacherName||"").includes(t))) {
        document.querySelectorAll(`.tt-entry-card[data-entry-id="${e.id}"]`).forEach(c => c.classList.add("tt-drag-teacher-busy"));
      }
    });
  }
  // Highlight grade rows in all-classes view
  document.querySelectorAll(".tt-all-row-hdr").forEach(hdr => {
    const match = gradeKey && hdr.closest("tr")?.dataset.gradeKey === gradeKey;
    hdr.closest("tr")?.classList.toggle("tt-drag-grade-highlight", !!match);
  });
}

function clearDragHighlight() {
  document.querySelectorAll(".tt-drag-teacher-busy,.tt-drag-grade-highlight").forEach(el => {
    el.classList.remove("tt-drag-teacher-busy","tt-drag-grade-highlight");
  });
}

// ── Auth UI ───────────────────────────────────────────────────────
function updateAuthUI(user) {
  const statusEl = ttAuthStatus(); const loginEl = ttLoginBtn(); const logoutEl = ttLogoutBtn();
  if (user) {
    if (statusEl) statusEl.textContent = user.displayName || user.email || "로그인됨";
    loginEl?.classList.add("hidden"); logoutEl?.classList.remove("hidden");
  } else {
    if (statusEl) statusEl.textContent = "로그인 필요";
    loginEl?.classList.remove("hidden"); logoutEl?.classList.add("hidden");
  }
}

// ── Excel Export ──────────────────────────────────────────────────
function exportXlsx() {
  const wb = XLSX.utils.book_new();
  const days = ["월","화","수","목","금"];
  const periods = ttConfig().periodLabels;

  GRADE_KEYS.forEach(grade => {
    const data = [["교시/요일", ...days]];
    periods.forEach((label, period) => {
      const row = [label];
      days.forEach((_, day) => {
        const cell = entries()
          .filter(e => entryHasGrade(e, grade) && e.day === day && e.period === period)
          .map(e => {
            const tpl = getTemplateById(e.templateId);
            const name = entryTitle(e);
            const room = getRooms().find(r => r.id === e.roomId);
            return [name, e.teacherName, room?.name].filter(Boolean).join("/");
          }).join("|");
        row.push(cell);
      });
      data.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 8 }, ...days.map(() => ({ wch: 20 }))];
    XLSX.utils.book_append_sheet(wb, ws, grade);
  });

  // Teacher summary sheet
  const teacherRows = [["교사", "요일", "교시", "과목", "학년", "교실"]];
  const allTeachers = [...new Set(entries().flatMap(e => splitTeacherNames(e.teacherName)).filter(Boolean))].sort((a,b) => a.localeCompare(b,"ko"));
  const dayLabels = ["월","화","수","목","금"];
  allTeachers.forEach(teacher => {
    entries().filter(e => splitTeacherNames(e.teacherName).includes(teacher))
      .sort((a, b) => a.day !== b.day ? a.day - b.day : a.period - b.period)
      .forEach(e => {
        const room = getRooms().find(r => r.id === e.roomId);
        teacherRows.push([teacher, dayLabels[e.day], ttConfig().periodLabels[e.period] || e.period + 1,
          entryTitle(e), entryGradeKeys(e).map(gradeDisplay).join(", "), room?.name || ""]);
      });
  });
  const wsT = XLSX.utils.aoa_to_sheet(teacherRows);
  wsT["!cols"] = [14,6,8,20,8,14].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsT, "교사별");

  XLSX.writeFile(wb, "HIS_Timetable.xlsx");
}

// ── Bootstrap ─────────────────────────────────────────────────────
setOnUpdate(domain => {
  if (["curriculum","templates","classes","teachers","rosters","rooms","timetable"].includes(domain)) renderAll();
});

onAuth(async (user) => {
  updateAuthUI(user);
  if (user) {
    await migrateFromLegacy();  // 마이그레이션 먼저 — 빈 문서 생성 방지
    subscribeAll();
  } else {
    unsubscribeAll(); renderAll();
  }
});

// View buttons
document.querySelectorAll(".tt-view-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tt-view-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentView = btn.dataset.view; renderAll();
  });
});

$("ttLoginBtn")?.addEventListener("click", login);
$("ttLogoutBtn")?.addEventListener("click", logout);
$("ttExportBtn")?.addEventListener("click", exportXlsx);
$("ttSaveBtn")?.addEventListener("click", async () => { await saveNow("timetable"); alert("저장되었습니다."); });
$("ttClearGradeBtn")?.addEventListener("click", () => {
  if (!canEdit()) return;
  let label, keepFn;
  if (currentView === "all") {
    label = "전체 시간표";
    keepFn = e => !!e.pinned; // preserve pinned even in full clear
  } else if (currentView === "grade") {
    label = `${currentGrade} 시간표`;
    keepFn = e => e.pinned || !entryHasGrade(e, currentGrade);
  } else if (currentView === "teacher") {
    if (!currentTeacher) { alert("교사를 선택하세요."); return; }
    label = `${currentTeacher} 교사 배정`;
    keepFn = e => e.pinned || !splitTeacherNames(e.teacherName).includes(currentTeacher);
  } else if (currentView === "room") {
    if (!currentRoom) { alert("교실을 선택하세요."); return; }
    const roomName = getRooms().find(r => r.id === currentRoom)?.name || currentRoom;
    label = `${roomName} 교실 배정`;
    keepFn = e => e.pinned || e.roomId !== currentRoom;
  }
  if (!keepFn) return;
  if (!confirm(`"${label}"을 초기화할까요?
되돌릴 수 없습니다.`)) return;
  ttDomain().entries = entries().filter(keepFn);
  scheduleSave("timetable"); recomputeConflicts(); renderAll();
});
$("ttAutoAssignBtn")?.addEventListener("click", () => autoAssignAll());


// Expose schedule control callbacks to inline HTML script
window._ttApplyPeriod = () => { setPeriodCount(parseInt($("ttPeriodCountInput")?.value)||8); renderAll(); };

  // Drop on bottom bar = delete entry
  const bottomBar = $("ttBottom");
  if (bottomBar) {
    bottomBar.addEventListener("dragover", e => {
      if (dragData?.kind === "entry") { e.preventDefault(); bottomBar.style.outline = "3px dashed #ef4444"; }
    });
    bottomBar.addEventListener("dragleave", () => { bottomBar.style.outline = ""; });
    bottomBar.addEventListener("drop", e => {
      e.preventDefault(); bottomBar.style.outline = "";
      if (dragData?.kind === "entry" && canEdit()) {
        removeEntry(dragData.entryId); dragData = null; recomputeConflicts(); renderAll();
      }
    });
  }
renderAll();
