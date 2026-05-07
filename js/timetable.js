// ================================================================
// timetable.js · Timetable Page — Main Module
// ================================================================
import { auth, GRADE_KEYS, CATEGORY_PALETTE } from "./config.js";
import { login, logout, onAuth, canEdit } from "./auth.js";
import { appState, subscribeAll, unsubscribeAll, setOnUpdate, scheduleSave, saveNow,
         normalizeTimetableEntry, normalizeTimetableConstraint } from "./state.js";
import { getTemplateById, getTemplateCardTitle, getSemesterTemplateData,
         splitTeacherNames, getTemplateAppliedGrades } from "./templates.js";
import { getTeachers } from "./teachers.js";
import { getRooms, renderRoomsView } from "./rooms.js";
import { detectConflicts, detectConstraintViolations, getConflictLabel } from "./timetable-conflicts.js";
import { uid, clean, makeBtn, escapeHtml } from "./utils.js";

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
let cardColumnCount = 2; // 카드 열 수 (1~4, 사용자 설정)

// ── DOM refs ──────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const ttGrid       = () => $("ttGrid");
const ttPanel      = () => $("ttPanel");
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
  // Collect all templates that are in units
  const templateIdsInUnits = new Set(
    (appState.templates.templateGroups || []).flatMap(g => g.units.flatMap(u => u.templateIds))
  );

  const standalone = []; // individual templates not in any unit
  const groupBlocks = []; // [{group, units:[{unit, credits, gradeKeys}]}]

  // Process groups
  (appState.templates.templateGroups || []).forEach(grp => {
    if (!grp.units.length) return;
    const unitItems = [];
    grp.units.forEach(unit => {
      const gradeKeys = getUnitGradeKeys(unit);
      // Credits = max credits across all templates in unit
      const credits = Math.max(1, ...unit.templateIds.map(id => {
        return Math.max(...gradeKeys.map(g => getCreditsForTemplate(g, id)).filter(c => c > 0), 0);
      }).filter(c => c > 0));
      const teachers = getUnitTeachers(unit);
      if (gradeKeys.length && credits > 0) {
        unitItems.push({ unit, gradeKeys, credits, teachers: teachers[0] || "" });
      }
    });
    if (unitItems.length) groupBlocks.push({ group: grp, unitItems });
  });

  // Process standalone templates (in curriculum but not in any unit)
  GRADE_KEYS.forEach(gradeKey => {
    getSubjectsForGrade(gradeKey).forEach(tpl => {
      if (templateIdsInUnits.has(tpl.id)) return; // handled by units
      const credits  = getCreditsForTemplate(gradeKey, tpl.id);
      const sections = getSectionCount(tpl.id);
      const teacher  = getTeachersForTemplate(tpl.id)[0] || "";
      for (let sec = 0; sec < sections; sec++) {
        for (let i = 0; i < credits; i++) {
          standalone.push({ kind:"standalone", templateId: tpl.id, sectionIdx: sec, gradeKey, teacherName: teacher });
        }
      }
    });
  });

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
  const lunchAfter = ttConfig().lunchAfterPeriod;
  const showLunch  = ttConfig().showLunch;

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
    if (showLunch && period === lunchAfter + 1) {
      const lr = document.createElement("tr"); lr.className = "tt-lunch-row";
      const lp = document.createElement("td"); lp.className = "tt-period-label tt-lunch-label"; lp.textContent = "🍱"; lr.appendChild(lp);
      days.forEach(() => { const td = document.createElement("td"); td.className = "tt-lunch-cell"; td.textContent = "점심시간"; lr.appendChild(td); });
      tbody.appendChild(lr);
    }
    const tr = document.createElement("tr");
    const pTd = document.createElement("td"); pTd.className = "tt-period-label";
    const pInp = document.createElement("input"); pInp.type = "text"; pInp.value = label; pInp.disabled = !canEdit();
    pInp.addEventListener("change", e => updatePeriodLabel(period, e.target.value));
    pTd.appendChild(pInp); tr.appendChild(pTd);

    days.forEach((_, day) => {
      const td = document.createElement("td"); td.className = "tt-cell";
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
        cg.style.setProperty("--tt-card-cols", String(cardColumnCount));
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
  const lunchAfter = ttConfig().lunchAfterPeriod;
  const showLunch  = ttConfig().showLunch;

  periods.forEach((label, period) => {
    // Insert lunch row AFTER lunchAfterPeriod
    if (showLunch && period === lunchAfter + 1) {
      const lunchTr = document.createElement("tr"); lunchTr.className = "tt-lunch-row";
      const lunchTd = document.createElement("td"); lunchTd.className = "tt-period-label tt-lunch-label"; lunchTd.textContent = "🍱"; lunchTr.appendChild(lunchTd);
      days.forEach(() => {
        const td = document.createElement("td"); td.className = "tt-lunch-cell"; td.textContent = "점심시간"; lunchTr.appendChild(td);
      });
      tbody.appendChild(lunchTr);
    }

    const tr = document.createElement("tr");
    const pTd = document.createElement("td"); pTd.className = "tt-period-label";
    const pInp = document.createElement("input"); pInp.type = "text"; pInp.value = label; pInp.disabled = !canEdit();
    pInp.addEventListener("change", e => { updatePeriodLabel(period, e.target.value); });
    pTd.appendChild(pInp); tr.appendChild(pTd);

    days.forEach((_, day) => {
      const td = document.createElement("td"); td.className = "tt-cell";
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
        cg.style.setProperty("--tt-card-cols", String(cardColumnCount));
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
  if (e.unitId) {
    const grp = (appState.templates.templateGroups || []).find(g => g.id === e.groupId);
    const unit = grp?.units.find(u => u.id === e.unitId);
    if (unit) return getUnitDisplayTitle(unit);
  }
  return getTemplateCardTitle(getTemplateById(e.templateId)) || "?";
}
function entryTeachers(e) {
  if (e.unitId) {
    const grp = (appState.templates.templateGroups || []).find(g => g.id === e.groupId);
    const unit = grp?.units.find(u => u.id === e.unitId);
    if (unit) return getUnitTeachers(unit);
  }
  return getTeachersForTemplate(e.templateId);
}

// ── Entry card ────────────────────────────────────────────────────
function buildEntryCard(entry, opts = {}) {
  const { compact = false, showGrade = false } = opts;
  const title       = entryTitle(entry);
  const teachers    = entryTeachers(entry);
  const displayGrades = entryGradeKeys(entry);
  const rooms       = getRooms();

  const conflicts = new Set([...(conflictMap.get(entry.id) || []), ...(constraintMap.get(entry.id) || [])]);
  const hasConflict = conflicts.size > 0;

  const card = document.createElement("div");
  card.className = "tt-entry-card" + (hasConflict ? " tt-entry-conflict" : "") + (compact ? " tt-compact" : "");
  if (hasConflict) card.title = getConflictLabel(conflicts);

  const firstGrade = displayGrades[0] || currentGrade;
  const gradeColor = getGradeColor(firstGrade);
  card.style.background   = gradeColor.bg;
  card.style.color        = gradeColor.text;
  card.style.borderLeft   = `4px solid ${gradeColor.border}`;

  // × button (absolute top-right)
  const removeBtn = makeBtn("×", "tt-entry-remove", () => { removeEntry(entry.id); recomputeConflicts(); renderAll(); });
  removeBtn.disabled = !canEdit();
  card.appendChild(removeBtn);

  // Pin button (📌/📍 toggle, always enabled)
  const pinBtn = document.createElement("button"); pinBtn.type = "button"; pinBtn.className = "tt-entry-pin";
  pinBtn.textContent = entry.pinned ? "📌" : "📍"; pinBtn.title = entry.pinned ? "고정 해제" : "고정";
  pinBtn.addEventListener("click", () => {
    const e = entries().find(x => x.id === entry.id); if (!e) return;
    e.pinned = !e.pinned; scheduleSave("timetable"); renderAll();
  });
  card.appendChild(pinBtn);
  if (entry.pinned) card.classList.add("tt-entry-pinned");

  // Grade chips (absolute, left of × button)
  if (showGrade && displayGrades.length) {
    card.classList.add("tt-entry-has-grade");
    displayGrades.slice().reverse().forEach((g, ri) => {
      const gc = document.createElement("span"); gc.className = "tt-entry-grade";
      gc.textContent = g;
      gc.style.cssText = `background:${getGradeColor(g).border};color:white;right:${17 + ri * 30}px`;
      card.appendChild(gc);
    });
  }

  const titleEl = document.createElement("div"); titleEl.className = "tt-entry-title"; titleEl.textContent = title;

  const teacherRow = document.createElement("div"); teacherRow.className = "tt-entry-row";
  const teacherSel = document.createElement("select"); teacherSel.className = "tt-entry-select"; teacherSel.disabled = !canEdit();
  const noT = document.createElement("option"); noT.value = ""; noT.textContent = "교사"; teacherSel.appendChild(noT);
  teachers.forEach(t => { const o = document.createElement("option"); o.value = t; o.textContent = t; if (t === entry.teacherName) o.selected = true; teacherSel.appendChild(o); });
  if (entry.teacherName && !teachers.includes(entry.teacherName)) {
    const o = document.createElement("option"); o.value = entry.teacherName; o.textContent = entry.teacherName; o.selected = true; teacherSel.appendChild(o);
  }
  teacherSel.addEventListener("change", e => { updateEntry(entry.id, "teacherName", e.target.value); recomputeConflicts(); renderAll(); });
  teacherRow.appendChild(teacherSel);

  if (!compact) {
    const roomSel = document.createElement("select"); roomSel.className = "tt-entry-select"; roomSel.disabled = !canEdit();
    const noR = document.createElement("option"); noR.value = ""; noR.textContent = "교실"; roomSel.appendChild(noR);
    rooms.forEach(r => { const o = document.createElement("option"); o.value = r.id; o.textContent = r.name; if (r.id === entry.roomId) o.selected = true; roomSel.appendChild(o); });
    roomSel.addEventListener("change", e => { updateEntry(entry.id, "roomId", e.target.value || null); recomputeConflicts(); renderAll(); });
    teacherRow.appendChild(roomSel);
  }

  card.append(titleEl, teacherRow);

  // Drag to move (entry kind)
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

  // 1. 기존 카드 이동
  if (data.kind === "entry" && data.entryId) {
    moveEntry(data.entryId, day, period);
    recomputeConflicts(); renderAll(); return;
  }

  // 2. 과목카드 배치 (unit-aware)
  const templateId    = data.templateId;
  const sectionIdx    = data.sectionIdx || 0;
  const resolvedGrade = data.gradeKey || currentGrade;

  // Check if this template is part of a unit
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
function renderSubjectPanel() {
  const hdrEl = $("ttPanelHeader");
  const panel  = $("ttPanel");
  if (!panel) return;
  panel.innerHTML = "";

  if (hdrEl) {
    hdrEl.innerHTML = "";
    const row = document.createElement("div"); row.className = "tt-panel-header";
    const title = document.createElement("div"); title.className = "tt-panel-title"; title.textContent = "과목 카드";
    const gradeLabel = document.createElement("div"); gradeLabel.className = "tt-panel-grade"; gradeLabel.textContent = currentGrade;
    row.append(title, gradeLabel); hdrEl.appendChild(row);
  }

  // Grade selector for non-grade views
  if (currentView !== "grade") {
    const guide = document.createElement("div"); guide.style.cssText = "font-size:10px;color:#6b7280;padding:4px 2px 2px";
    guide.textContent = "배치할 학년:"; panel.appendChild(guide);
    const gSel = document.createElement("select"); gSel.className = "tt-sc-grade-sel";
    GRADE_KEYS.forEach(g => { const o = document.createElement("option"); o.value = g; o.textContent = g; if (g === currentGrade) o.selected = true; gSel.appendChild(o); });
    gSel.addEventListener("change", e => { currentGrade = e.target.value; renderAll(); });
    panel.appendChild(gSel);
  }

  const gradeColor = getGradeColor(currentGrade);

  // Collect templates in this grade
  const subjectsForGrade = getSubjectsForGrade(currentGrade);
  if (!subjectsForGrade.length) {
    panel.appendChild(Object.assign(document.createElement("div"), { className:"tt-empty", textContent:"이 학년에 배치된 과목이 없습니다." })); return;
  }

  // Separate: templates in a unit vs standalone
  const seenTemplateIds = new Set();
  const seenUnitIds     = new Set();
  const availableCards  = [], doneCards = [];

  subjectsForGrade.forEach(tpl => {
    const unitInfo = getUnitForTemplate(tpl.id);

    if (unitInfo) {
      // Template belongs to a unit → show as unit card (once per unit)
      const { group, unit } = unitInfo;
      if (seenUnitIds.has(unit.id)) return;
      seenUnitIds.add(unit.id);
      unit.templateIds.forEach(id => seenTemplateIds.add(id));

      const gradeKeys = getUnitGradeKeys(unit);
      const teachers  = getUnitTeachers(unit);
      const credits   = Math.max(1, ...unit.templateIds.map(id =>
        Math.max(...gradeKeys.map(g => getCreditsForTemplate(g, id)).filter(c=>c>0), 0)
      ).filter(c=>c>0));
      const assigned = entries().filter(e => e.unitId === unit.id).length;
      const isDone   = credits > 0 && assigned >= credits;

      const card = document.createElement("div"); card.className = "tt-subject-card" + (isDone ? " tt-subject-done" : "");
      card.style.borderLeftColor = isDone ? "#22c55e" : gradeColor.border;
      card.style.background = isDone ? "#f0fdf4" : gradeColor.bg + "dd";
      card.draggable = canEdit() && !isDone;

      const topRow = document.createElement("div"); topRow.className = "tt-sc-top";
      const name = document.createElement("div"); name.className = "tt-sc-name";
      name.textContent = getUnitDisplayTitle(unit);

      const badge = document.createElement("span"); badge.className = "tt-sc-badge";
      badge.textContent = `${assigned}/${credits}`;
      badge.style.background = isDone ? "#dcfce7" : assigned > 0 ? "#fef9c3" : "#f1f5f9";
      badge.style.color = isDone ? "#166534" : "#374151";
      topRow.append(name, badge);

      const botRow = document.createElement("div"); botRow.className = "tt-sc-bot";
      botRow.textContent = teachers.join(", ") || "-";
      // Show grade chips for cross-grade units
      if (gradeKeys.length > 1) {
        const gc = document.createElement("span"); gc.className = "tt-sc-sec"; gc.textContent = gradeKeys.join("·"); botRow.appendChild(gc);
      }
      card.append(topRow, botRow);

      if (!isDone) {
        card.addEventListener("dragstart", () => {
          dragData = { kind:"subject", templateId: unit.templateIds[0], unitId: unit.id, groupId: group.id, sectionIdx:0, gradeKey: gradeKeys[0] || currentGrade };
          card.classList.add("tt-dragging");
        });
        card.addEventListener("dragend", () => { dragData = null; card.classList.remove("tt-dragging"); });
      }
      (isDone ? doneCards : availableCards).push(card);

    } else {
      // Standalone template (not in any unit)
      if (seenTemplateIds.has(tpl.id)) return;
      seenTemplateIds.add(tpl.id);

      const credits  = getCreditsForTemplate(currentGrade, tpl.id);
      const sections = getSectionCount(tpl.id);
      const teachers = getTeachersForTemplate(tpl.id);

      for (let sec = 0; sec < Math.max(1, sections); sec++) {
        const assigned = entries().filter(e => entryTemplateIds(e).includes(tpl.id) && entryHasGrade(e, currentGrade) && e.sectionIdx === sec).length;
        const isDone   = credits > 0 && assigned >= credits;

        const card = document.createElement("div"); card.className = "tt-subject-card" + (isDone ? " tt-subject-done" : "");
        card.style.borderLeftColor = isDone ? "#22c55e" : gradeColor.border;
        card.style.background = isDone ? "#f0fdf4" : gradeColor.bg + "dd";
        card.draggable = canEdit() && !isDone;

        const topRow = document.createElement("div"); topRow.className = "tt-sc-top";
        const name = document.createElement("div"); name.className = "tt-sc-name"; name.textContent = getTemplateCardTitle(tpl);
        const badge = document.createElement("span"); badge.className = "tt-sc-badge";
        badge.textContent = `${assigned}/${credits}`;
        badge.style.background = isDone ? "#dcfce7" : assigned > 0 ? "#fef9c3" : "#f1f5f9";
        badge.style.color = isDone ? "#166534" : "#374151";
        topRow.append(name, badge);

        const botRow = document.createElement("div"); botRow.className = "tt-sc-bot";
        botRow.textContent = teachers.join(", ") || "-";
        if (sections > 1) { const sb = document.createElement("span"); sb.className = "tt-sc-sec"; sb.textContent = `${sec+1}분반`; botRow.appendChild(sb); }
        card.append(topRow, botRow);

        if (!isDone) {
          card.addEventListener("dragstart", () => { dragData = { kind:"subject", templateId: tpl.id, sectionIdx:sec, gradeKey: currentGrade }; card.classList.add("tt-dragging"); });
          card.addEventListener("dragend", () => { dragData = null; card.classList.remove("tt-dragging"); });
        }
        (isDone ? doneCards : availableCards).push(card);
      }
    }
  });

  // Render: available first, done last
  if (availableCards.length) {
    const t = document.createElement("div"); t.className = "tt-panel-section-title"; t.textContent = `배치 필요 (${availableCards.length})`; panel.appendChild(t);
    availableCards.forEach(c => panel.appendChild(c));
  }
  if (doneCards.length) {
    const t = document.createElement("div"); t.className = "tt-panel-section-title tt-panel-section-done"; t.textContent = `배치 완료 (${doneCards.length})`; panel.appendChild(t);
    doneCards.forEach(c => panel.appendChild(c));
  }
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
  hdrRow.textContent = "자동 배치 전 제약 조건을 설정하세요."; el.appendChild(hdrRow);

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
    GRADE_KEYS.forEach(g => { const o = document.createElement("option"); o.value = g; o.textContent = g; if (g === currentGrade) o.selected = true; gradeEl.appendChild(o); });
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
  gradeEl?.classList.toggle("hidden", currentView !== "grade");
  teacherEl?.classList.toggle("hidden", currentView !== "teacher");
  roomEl?.classList.toggle("hidden", currentView !== "room");
  // In all-grades view, hide the subject panel (it's grade-specific)
  const panelEl = document.querySelector(".tt-panel");
  // Panel always visible — grade selector shown for non-grade views
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
    const conc = sameGrp && isConcurrentTpl(item.templateId) && isConcurrentTpl(e.templateId);
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

  ttDomain().entries = [];

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
      if (!group.isConcurrent) continue; // non-concurrent groups: place units independently
      // Find slots needed (max credits across units)
      const maxCredits = Math.max(...unitItems.map(u => u.credits));

      for (let slot_i = 0; slot_i < maxCredits; slot_i++) {
        // Find a slot valid for ALL units in this group simultaneously
        let foundSlot = null;
        for (const slot of shuffle([...baseSlots])) {
          const hypo = [];
          let valid = true;
          for (const { unit, gradeKeys, teachers } of unitItems) {
            const item = {
              kind: "unit", unitId: unit.id, groupId: group.id,
              templateIds: unit.templateIds, gradeKeys,
              templateId: unit.templateIds[0], gradeKey: gradeKeys[0],
              teacherName: teachers, sectionIdx: 0
            };
            if (!checkPlacementValid(item, slot, [...placed, ...hypo])) { valid = false; break; }
            hypo.push({ ...item, ...slot });
          }
          if (valid) { foundSlot = slot; break; }
        }
        if (foundSlot) {
          unitItems.forEach(({ unit, gradeKeys, teachers }) => {
            placed.push(normalizeTimetableEntry({
              id: uid("ent"), ...foundSlot,
              unitId: unit.id, groupId: group.id,
              templateIds: unit.templateIds, gradeKeys,
              templateId: unit.templateIds[0], gradeKey: gradeKeys[0],
              teacherName: teachers, sectionIdx: 0
            }));
          });
        } else {
          unitItems.forEach(({ unit, gradeKeys, teachers }) => {
            failed.push({ unitId: unit.id, name: getUnitDisplayTitle(unit) });
          });
        }
      }
    }

    // ── Place non-concurrent units independently ─────────────────
    for (const { group, unitItems } of groupBlocks) {
      if (group.isConcurrent) continue;
      for (const { unit, gradeKeys, teachers, credits } of unitItems) {
        for (let i = 0; i < credits; i++) {
          const item = {
            kind: "unit", unitId: unit.id, groupId: group.id,
            templateIds: unit.templateIds, gradeKeys,
            templateId: unit.templateIds[0], gradeKey: gradeKeys[0],
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
  const pcInp   = $("ttPeriodCountInput");
  const lunchChk= $("ttShowLunchInput");
  const lunchSel= $("ttLunchAfterSelect");
  const colSel  = $("ttCardColumnSelect");
  if (pcInp)    pcInp.value   = String(ttConfig().periodCount);
  if (lunchChk) lunchChk.checked = !!ttConfig().showLunch;
  if (lunchSel) {
    lunchSel.innerHTML = "";
    ttConfig().periodLabels.forEach((l, i) => {
      const o = document.createElement("option"); o.value = i; o.textContent = `${l} 후`;
      if (i === ttConfig().lunchAfterPeriod) o.selected = true;
      lunchSel.appendChild(o);
    });
  }
  if (colSel) colSel.value = String(cardColumnCount);
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
        const tpl = getTemplateById(e.templateId); const room = getRooms().find(r => r.id === e.roomId);
        teacherRows.push([teacher, dayLabels[e.day], ttConfig().periodLabels[e.period] || e.period + 1, tpl ? getTemplateCardTitle(tpl) : "?", e.gradeKey, room?.name || ""]);
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
    keepFn = () => false;
  } else if (currentView === "grade") {
    label = `${currentGrade} 시간표`;
    keepFn = e => e.gradeKey !== currentGrade;
  } else if (currentView === "teacher") {
    if (!currentTeacher) { alert("교사를 선택하세요."); return; }
    label = `${currentTeacher} 교사 배정`;
    keepFn = e => !splitTeacherNames(e.teacherName).includes(currentTeacher);
  } else if (currentView === "room") {
    if (!currentRoom) { alert("교실을 선택하세요."); return; }
    const roomName = getRooms().find(r => r.id === currentRoom)?.name || currentRoom;
    label = `${roomName} 교실 배정`;
    keepFn = e => e.roomId !== currentRoom;
  }
  if (!keepFn) return;
  if (!confirm(`"${label}"을 초기화할까요?
되돌릴 수 없습니다.`)) return;
  ttDomain().entries = entries().filter(keepFn);
  scheduleSave("timetable"); recomputeConflicts(); renderAll();
});
$("ttAutoAssignBtn")?.addEventListener("click", () => autoAssignAll());


// Expose schedule control callbacks to inline HTML script
window._ttApplyPeriod    = () => { setPeriodCount(parseInt($("ttPeriodCountInput")?.value)||8); renderAll(); };
window._ttSetLunch       = (_, show) => { setLunchConfig(undefined, show); renderAll(); };
window._ttSetLunchAfter  = (idx) => { setLunchConfig(idx, undefined); renderAll(); };
window._ttSetCardCols    = (n) => { cardColumnCount = n; renderAll(); };

renderAll();
