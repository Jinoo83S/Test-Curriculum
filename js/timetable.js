// ================================================================
// timetable.js · Timetable Page — Main Module
// ================================================================
import { auth, GRADE_KEYS, CATEGORY_PALETTE } from "./config.js";
import { login, logout, onAuth, canEdit } from "./auth.js";
import { appState, subscribeAll, unsubscribeAll, setOnUpdate, scheduleSave, saveNow,
         normalizeTimetableEntry, normalizeTimetableConstraint } from "./state.js";
import { getTemplateById, getTemplateCardTitle, getSemesterTemplateData,
         splitTeacherNames, getTemplateAppliedGrades } from "./templates.js";
import { uid, clean, makeBtn, escapeHtml, sectionLabel, gradeDisplay } from "./utils.js";
import { getTtCards, getTtCardById, makeTtcId } from "./ttcards.js";
import { getTeachers } from "./teachers.js";
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
  else if (currentView === "all")     renderAllGradesGrid(wrap);
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
          slotEntries.forEach(entry => td.appendChild(buildEntryCard(entry, { compact: true })));
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
  // ttcard-based unit
  if (e.unitId) {
    const grp  = (appState.templates.templateGroups || []).find(g => g.id === e.groupId);
    const unit = grp?.units.find(u => u.id === e.unitId);
    if (unit) {
      const ttcards = getTtCards();
      const cards   = (unit.ttcardIds || []).map(id => ttcards.find(c => c.id === id)).filter(Boolean);
      if (cards.length) {
        return cards.map(c => {
          const tpl = getTemplateById(c.templateId);
          const base = tpl ? getTemplateCardTitle(tpl) : "?";
          const cc = Math.max(1, parseInt(appState.rosters?.rosterMeta?.[c.templateId]?.classCount) || 1);
          return cc > 1 ? `${base} ${sectionLabel(c.sectionIdx)}` : base;
        }).join(" / ");
      }
      return getUnitDisplayTitle(unit);
    }
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
  const title        = entryTitle(entry);
  const teachers     = entryTeachers(entry);
  const displayGrades = entryGradeKeys(entry);

  const conflicts  = new Set([...(conflictMap.get(entry.id) || []), ...(constraintMap.get(entry.id) || [])]);
  const hasConflict = conflicts.size > 0;

  const card = document.createElement("div");
  card.className = "tt-entry-card" + (hasConflict ? " tt-entry-conflict" : "") + (compact ? " tt-compact" : "");
  card.style.position = "relative";
  if (hasConflict) card.title = getConflictLabel(conflicts);

  const firstGrade = displayGrades[0] || currentGrade;
  const gradeColor = getGradeColor(firstGrade);
  card.style.background = gradeColor.bg;
  card.style.color      = gradeColor.text;
  card.style.borderLeft = `4px solid ${gradeColor.border}`;

  // ── Row 1: title + pin ──────────────────────────────────────────
  const row1 = document.createElement("div"); row1.className = "tt-entry-row1";

  const titleEl = document.createElement("div"); titleEl.className = "tt-entry-title"; titleEl.textContent = title;
  row1.appendChild(titleEl);

  const pinBtn = document.createElement("button"); pinBtn.type = "button"; pinBtn.className = "tt-entry-pin";
  pinBtn.textContent = entry.pinned ? "📌" : "📍"; pinBtn.title = entry.pinned ? "고정 해제" : "고정";
  pinBtn.disabled = !canEdit();
  pinBtn.addEventListener("click", () => {
    if (!canEdit()) return;
    const e = entries().find(x => x.id === entry.id); if (!e) return;
    e.pinned = !e.pinned; scheduleSave("timetable"); renderAll();
  });
  row1.appendChild(pinBtn);
  card.appendChild(row1);
  if (entry.pinned) card.classList.add("tt-entry-pinned");

  // ── Row 2: teacher + grade chips ───────────────────────────────
  const row2 = document.createElement("div"); row2.className = "tt-entry-row2";

  const teacherEl = document.createElement("div"); teacherEl.className = "tt-entry-teacher";
  teacherEl.textContent = teachers.join(", ") || "";
  row2.appendChild(teacherEl);

  if (showGrade && displayGrades.length) {
    const chipWrap = document.createElement("div"); chipWrap.className = "tt-entry-grade-chips";
    displayGrades.forEach(g => {
      const chip = document.createElement("span"); chip.className = "tt-entry-grade";
      chip.textContent = gradeDisplay(g);
      chip.style.cssText = `background:${getGradeColor(g).border};color:white;font-size:8px;padding:0 4px;border-radius:3px;font-weight:700`;
      chipWrap.appendChild(chip);
    });
    row2.appendChild(chipWrap);
  }
  card.appendChild(row2);

  // Click to show detail popup
  card.addEventListener("click", ev => {
    if (ev.target.closest("button") || ev.target.closest("select")) return;
    showEntryDetail(entry);
  });

  // Drag to move
  card.draggable = canEdit() && !entry.pinned;
  card.addEventListener("dragstart", ev => {
    if (!canEdit() || entry.pinned || ev.target.closest("select,button")) { ev.preventDefault(); return; }
    dragData = { kind: "entry", entryId: entry.id };
    card.classList.add("tt-dragging");
  });
  card.addEventListener("dragend", () => { dragData = null; card.classList.remove("tt-dragging"); });

  return card;
}

// ── Drop handler ──────────────────────────────────────────────────
function moveEntry(entryId, day, period) {
  if (!canEdit()) return;
  const e = entries().find(x => x.id === entryId); if (!e || e.pinned) return; // pinned = cannot move
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

  // 3. Single ttcard drop
  if (data.ttcardId) {
    const card = getTtCardById(data.ttcardId);
    if (card) {
      const tpl = getTemplateById(card.templateId);
      const teacherName = tpl ? splitTeacherNames([tpl.teacher, tpl.sem1Teacher, tpl.sem2Teacher].join(",")).filter(Boolean).join(",") : "";
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
function showEntryDetail(entry) {
  const existing = document.getElementById("tt-entry-detail-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div"); modal.id = "tt-entry-detail-modal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center";

  const box = document.createElement("div");
  box.style.cssText = "background:white;border-radius:10px;padding:18px 20px;min-width:280px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,.25);font-size:13px;position:relative";

  const gradeKeys = entryGradeKeys(entry);
  const firstGrade = gradeKeys[0] || currentGrade;
  const gc = getGradeColor(firstGrade);
  box.style.borderTop = `4px solid ${gc.border}`;

  const titleEl = document.createElement("div");
  titleEl.style.cssText = "font-weight:700;font-size:15px;margin-bottom:12px;color:#1e3a5f";
  titleEl.textContent = entryTitle(entry);
  box.appendChild(titleEl);

  // Grade chips
  if (gradeKeys.length) {
    const row = document.createElement("div"); row.style.cssText="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px";
    gradeKeys.forEach(g => { const chip = document.createElement("span"); chip.style.cssText=`font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:${getGradeColor(g).border};color:white`; chip.textContent=gradeDisplay(g); row.appendChild(chip); });
    box.appendChild(row);
  }

  // Teacher selector
  const teachers = entryTeachers(entry);
  const tLabel = document.createElement("label"); tLabel.style.cssText="display:block;margin-bottom:6px;font-size:11px;color:#6b7280;font-weight:600"; tLabel.textContent = "교사";
  const tSel = document.createElement("select"); tSel.style.cssText="width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-bottom:10px"; tSel.disabled = !canEdit();
  const noT = document.createElement("option"); noT.value=""; noT.textContent="교사 선택 (없음)"; tSel.appendChild(noT);
  const allTeachers = [...new Set([...teachers, ...(entry.teacherName ? [entry.teacherName] : [])])];
  allTeachers.forEach(t => { const o = document.createElement("option"); o.value=t; o.textContent=t; if(t===entry.teacherName) o.selected=true; tSel.appendChild(o); });
  tSel.addEventListener("change", e => { updateEntry(entry.id, "teacherName", e.target.value); recomputeConflicts(); renderAll(); });
  box.append(tLabel, tSel);

  // Room selector
  const rooms = getRooms();
  if (rooms.length) {
    const rLabel = document.createElement("label"); rLabel.style.cssText="display:block;margin-bottom:6px;font-size:11px;color:#6b7280;font-weight:600"; rLabel.textContent = "교실";
    const rSel = document.createElement("select"); rSel.style.cssText="width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-bottom:12px"; rSel.disabled = !canEdit();
    const noR = document.createElement("option"); noR.value=""; noR.textContent="교실 선택 (없음)"; rSel.appendChild(noR);
    rooms.forEach(r => { const o = document.createElement("option"); o.value=r.id; o.textContent=r.name; if(r.id===entry.roomId) o.selected=true; rSel.appendChild(o); });
    rSel.addEventListener("change", e => { updateEntry(entry.id, "roomId", e.target.value||null); recomputeConflicts(); renderAll(); });
    box.append(rLabel, rSel);
  }

  // Delete button
  if (canEdit()) {
    const delBtn = document.createElement("button"); delBtn.style.cssText="width:100%;padding:6px;border:1px solid #fca5a5;border-radius:5px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:12px;font-weight:600";
    delBtn.textContent = "🗑 이 수업 삭제"; delBtn.onclick = () => { removeEntry(entry.id); recomputeConflicts(); renderAll(); modal.remove(); };
    box.appendChild(delBtn);
  }

  // Close
  const closeBtn = document.createElement("button"); closeBtn.style.cssText="position:absolute;top:10px;right:12px;border:none;background:transparent;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1"; closeBtn.textContent="×"; closeBtn.onclick = () => modal.remove();
  box.appendChild(closeBtn);
  modal.appendChild(box);
  modal.addEventListener("click", e => { if(e.target===modal) modal.remove(); });
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

function renderSubjectPanelTtCards(panel, ttcards) {
  const availableCards = [], doneCards = [];
  const seenUnitIds = new Set();

  // Build unit→ttcards map from groups
  const unitCardMap = new Map(); // unitId → {group, unit, ttcards}
  const cardToUnit  = new Map(); // ttcardId → unitId
  (appState.templates.templateGroups || []).forEach(grp => {
    (grp.units || []).forEach(unit => {
      const uCards = (unit.ttcardIds || []).map(id => ttcards.find(c => c.id === id)).filter(Boolean);
      if (uCards.length) {
        unitCardMap.set(unit.id, { group: grp, unit, uCards });
        uCards.forEach(c => cardToUnit.set(c.id, unit.id));
      }
    });
  });

  // Render unit cards first
  unitCardMap.forEach(({ group, unit, uCards }) => {
    if (seenUnitIds.has(unit.id)) return; seenUnitIds.add(unit.id);
    const gradeKeys = [...new Set(uCards.map(c => c.gradeKey))];
    const gradeColor = getGradeColor(gradeKeys[0] || "7학년");
    const teachers = [...new Set(uCards.flatMap(c => {
      const tpl = getTemplateById(c.templateId); return tpl ? getTeachersForTemplate(c.templateId) : [];
    }))];
    const credits = Math.max(1, ...uCards.map(c => {
      const row = (appState.curriculum.gradeBoards[c.gradeKey] || [])
        .find(r => r.sem1TemplateId === c.templateId || r.sem2TemplateId === c.templateId);
      return parseFloat(row?.credits) || 0;
    }).filter(v => v > 0));
    const assigned = entries().filter(e => e.unitId === unit.id).length;
    const isDone = credits > 0 && assigned >= credits;

    const card = buildSidebarCard({
      title: uCards.map(c => {
        const tpl = getTemplateById(c.templateId);
        const base = tpl ? getTemplateCardTitle(tpl) : "?";
        const cc = appState.rosters?.rosterMeta?.[c.templateId];
        const sectCount = Math.max(1, parseInt(cc?.classCount) || 1);
        return sectCount > 1 ? `${base} ${sectionLabel(c.sectionIdx)}` : base;
      }).join(" / "),
      teachers, gradeKeys, credits, assigned, isDone, gradeColor,
    });
    if (!isDone) {
      card.addEventListener("dragstart", () => {
        dragData = { kind:"subject", templateId: uCards[0].templateId, unitId: unit.id, groupId: group.id,
          sectionIdx: uCards[0].sectionIdx, gradeKey: gradeKeys[0] || "7학년" };
        card.classList.add("tt-dragging");
      });
      card.addEventListener("dragend", () => { dragData = null; card.classList.remove("tt-dragging"); });
    }
    (isDone ? doneCards : availableCards).push(card);
  });

  // Standalone ttcards (not in any unit)
  ttcards.forEach(c => {
    if (cardToUnit.has(c.id)) return;
    const tpl = getTemplateById(c.templateId); if (!tpl) return;
    const gradeColor = getGradeColor(c.gradeKey);
    const credits = (() => {
      const row = (appState.curriculum.gradeBoards[c.gradeKey] || [])
        .find(r => r.sem1TemplateId === c.templateId || r.sem2TemplateId === c.templateId);
      return parseFloat(row?.credits) || 0;
    })();
    const cc = Math.max(1, parseInt(appState.rosters?.rosterMeta?.[c.templateId]?.classCount) || 1);
    const assigned = entries().filter(e =>
      entryTemplateIds(e).includes(c.templateId) && entryHasGrade(e, c.gradeKey) && (e.sectionIdx ?? 0) === c.sectionIdx
    ).length;
    const isDone = credits > 0 && assigned >= credits;
    const base   = getTemplateCardTitle(tpl);
    const label  = cc > 1 ? `${base} ${sectionLabel(c.sectionIdx)}` : base;
    const card   = buildSidebarCard({
      title: label, teachers: getTeachersForTemplate(c.templateId),
      gradeKeys: [c.gradeKey], credits, assigned, isDone, gradeColor,
    });
    if (!isDone) {
      card.addEventListener("dragstart", () => {
        dragData = { kind:"subject", ttcardId: c.id, templateId: c.templateId, sectionIdx: c.sectionIdx, gradeKey: c.gradeKey };
        card.classList.add("tt-dragging");
      });
      card.addEventListener("dragend", () => { dragData = null; card.classList.remove("tt-dragging"); });
    }
    (isDone ? doneCards : availableCards).push(card);
  });

  finalizeSidebarPanel(panel, availableCards, doneCards, "시간표 카드가 없습니다.");
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
        card.addEventListener("click", () => showUnitDetail(unit, group, gradeKeys));
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

function buildSidebarCard({ title, teachers, gradeKeys, credits, assigned, isDone, gradeColor }) {
  const card = document.createElement("div");
  card.className = "tt-subject-card" + (isDone ? " tt-subject-done" : "");
  card.style.borderLeftColor = isDone ? "#22c55e" : gradeColor.border;
  card.style.background = isDone ? "#f0fdf4" : gradeColor.bg + "dd";
  card.draggable = canEdit() && !isDone;
  const topRow = document.createElement("div"); topRow.className = "tt-sc-top";
  const nameEl = document.createElement("div"); nameEl.className = "tt-sc-name"; nameEl.textContent = title;
  const badge  = document.createElement("span"); badge.className = "tt-sc-badge";
  badge.textContent = `${assigned}/${credits}`;
  badge.style.background = isDone ? "#dcfce7" : assigned > 0 ? "#fef9c3" : "#f1f5f9";
  badge.style.color = isDone ? "#166534" : "#374151";
  topRow.append(nameEl, badge);
  const botRow = document.createElement("div"); botRow.className = "tt-sc-bot";
  botRow.textContent = teachers.join(", ") || "-";
  const chipRow = document.createElement("div"); chipRow.style.cssText = "display:flex;gap:2px;flex-wrap:wrap;margin-top:2px";
  gradeKeys.forEach(g => {
    const chip = document.createElement("span");
    chip.style.cssText = `font-size:9px;font-weight:700;padding:1px 4px;border-radius:999px;background:${getGradeColor(g).border};color:white;white-space:nowrap`;
    chip.textContent = gradeDisplay(g); chipRow.appendChild(chip);
  });
  card.append(topRow, botRow, chipRow);
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

  // Show ALL teachers from templates (so constraints can be set before auto-assign)
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

  const hdrRow = document.createElement("div"); hdrRow.className = "tt-con-hint";
  hdrRow.textContent = "자동 배치 전 교사 조건을 설정하세요."; el.appendChild(hdrRow);

  const table = document.createElement("table"); table.className = "tt-constraint-table";
  table.innerHTML = `<thead><tr>
    <th>교사</th>
    <th>하루 최대 수업 <span class="tt-con-default">(기본: 6)</span></th>
    <th>최대 연속 수업 <span class="tt-con-default">(기본: 3)</span></th>
    <th>현재 배치</th>
    <th>충돌</th>
  </tr></thead>`;
  const tbody = document.createElement("tbody");

  allTeachers.forEach(teacher => {
    const c = constraints()[teacher] || { maxPerDay: 6, maxConsecutive: 3 };
    const placed = entries().filter(e => splitTeacherNames(e.teacherName).includes(teacher));
    const total = placed.length;
    const hasViolation = [...constraintMap.entries()].some(([id, s]) => {
      const e = entries().find(e => e.id === id);
      return e && splitTeacherNames(e.teacherName).includes(teacher) && s.size > 0;
    });
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td"); nameTd.className = "tt-con-name"; nameTd.textContent = teacher; tr.appendChild(nameTd);

    [
      { key: "maxPerDay",      default: 6,  min: 1, max: 12 },
      { key: "maxConsecutive", default: 3,  min: 1, max: 12 }
    ].forEach(f => {
      const td = document.createElement("td");
      const inp = document.createElement("input"); inp.type = "number"; inp.min = f.min; inp.max = f.max;
      inp.value = c[f.key] ?? f.default; inp.disabled = !canEdit();
      inp.addEventListener("change", e => updateConstraint(teacher, f.key, parseInt(e.target.value) || f.default));
      td.appendChild(inp); tr.appendChild(td);
    });

    const totalTd = document.createElement("td"); totalTd.className = "tt-con-total";
    totalTd.textContent = total ? `${total}시수` : "-"; tr.appendChild(totalTd);

    const conflTd = document.createElement("td"); conflTd.className = "tt-con-total";
    conflTd.textContent = hasViolation ? "⚠️" : total ? "✅" : "";
    conflTd.title = hasViolation ? "제약 위반 있음" : ""; tr.appendChild(conflTd);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody); el.appendChild(table);
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

  // 1. Teacher conflict (always applies)
  for (const e of slotEnts) {
    const et = splitTeacherNames(e.teacherName).filter(Boolean);
    if (teachers.some(t => et.includes(t))) return false;
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
    if (maxC > (constraints()[teacher]?.maxConsecutive || 3)) return false;
  }
  return true;
}

// ── Auto-assign ALL grades simultaneously (unit-aware) ────────────
export function autoAssignAll() {
  if (!canEdit()) return;

  const activeGrades = GRADE_KEYS.filter(g => getSubjectsForGrade(g).length > 0);
  if (!activeGrades.length) { alert("커리큘럼에 배치된 과목이 없습니다."); return; }

  if (!confirm(`전체 학년 시간표를 자동 배치합니다.\n대상: ${activeGrades.join(", ")}\n\n기존 시간표가 모두 초기화됩니다. 계속할까요?`)) return;

  // Preserve pinned entries
  const pinnedEntries = entries().filter(e => e.pinned);
  ttDomain().entries = [...pinnedEntries];

  const { standalone, groupBlocks } = buildSchedulableItems();

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
  if (user) { subscribeAll(); }
  else       { unsubscribeAll(); renderAll(); }
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
