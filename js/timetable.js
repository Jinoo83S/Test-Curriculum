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
let currentView    = "grade";
let currentGrade   = "7학년";
let currentTeacher = "";
let currentRoom    = "";
let dragData       = null;
let conflictMap    = new Map();
let constraintMap  = new Map();

// ── DOM refs ──────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const ttGrid       = () => $("ttGrid");
const ttPanel      = () => $("ttPanel");
const ttAuthStatus = () => $("ttAuthStatus");
const ttLoginBtn   = () => $("ttLoginBtn");
const ttLogoutBtn  = () => $("ttLogoutBtn");

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
  return entries().filter(e => e.templateId === templateId && e.gradeKey === gradeKey).length;
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
    return entries().filter(e => e.gradeKey === currentGrade && e.day === day && e.period === period);
  });
}

function renderTeacherGrid(wrap) {
  const days = ["월", "화", "수", "목", "금"];
  const periods = ttConfig().periodLabels;
  buildGrid(periods, days, wrap, (day, period) => {
    return entries().filter(e => {
      const names = splitTeacherNames(e.teacherName);
      return names.includes(currentTeacher) && e.day === day && e.period === period;
    });
  });
}

function renderRoomGrid(wrap) {
  const days = ["월", "화", "수", "목", "금"];
  const periods = ttConfig().periodLabels;
  buildGrid(periods, days, wrap, (day, period) => {
    return entries().filter(e => e.roomId === currentRoom && e.day === day && e.period === period);
  });
}

function renderAllGradesGrid(wrap) {
  const days     = ["월","화","수","목","금"];
  const periods  = ttConfig().periodLabels;
  const lunchAfter = ttConfig().lunchAfterPeriod;
  const showLunch  = ttConfig().showLunch;
  const activeGrades = GRADE_KEYS.filter(g => getSubjectsForGrade(g).length > 0);
  if (!activeGrades.length) { wrap.innerHTML = '<div class="tt-empty">커리큘럼에 배치된 과목이 없습니다.</div>'; return; }

  const outerWrap = document.createElement("div"); outerWrap.className = "tt-all-wrap";
  const table = document.createElement("table"); table.className = "tt-all-table";

  // Header rows: row1 = grade headers (colspan 5), row2 = day subheaders
  const thead = document.createElement("thead");
  const row1 = document.createElement("tr");
  // period column header
  const cornerTh = document.createElement("th"); cornerTh.className = "tt-all-period"; cornerTh.rowSpan = 2; row1.appendChild(cornerTh);
  activeGrades.forEach(grade => {
    const th = document.createElement("th"); th.className = "tt-all-th-grade"; th.colSpan = 5;
    th.textContent = grade; row1.appendChild(th);
    // Separator
    const sep = document.createElement("th"); sep.style.width = "4px"; sep.style.background = "#1e3a5f"; sep.rowSpan = 2; row1.appendChild(sep);
  });
  thead.appendChild(row1);
  const row2 = document.createElement("tr");
  activeGrades.forEach(() => {
    days.forEach(d => {
      const th = document.createElement("th"); th.className = "tt-all-th-day"; th.textContent = d; row2.appendChild(th);
    });
    row2.appendChild(document.createElement("th")); // separator spacer
  });
  thead.appendChild(row2);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  const buildCell = (grade, day, period) => {
    const td = document.createElement("td"); td.className = "tt-all-cell";
    const cellEntries = entries().filter(e => e.gradeKey === grade && e.day === day && e.period === period);
    if (!cellEntries.length) { td.innerHTML = '<div style="color:#d1d5db;text-align:center;padding:4px 0;font-size:14px">+</div>'; return td; }
    cellEntries.forEach(entry => {
      const tpl = getTemplateById(entry.templateId); if (!tpl) return;
      const cat = getCategoryForTemplate(grade, entry.templateId);
      const color = getCategoryColor(cat);
      const conflicts = new Set([...(conflictMap.get(entry.id) || []), ...(constraintMap.get(entry.id) || [])]);
      const div = document.createElement("div");
      div.className = "tt-all-entry" + (conflicts.size > 0 ? " tt-all-conflict" : "");
      div.style.background = color.bg; div.style.color = color.text; div.style.borderColor = color.text;
      if (conflicts.size > 0) div.title = getConflictLabel(conflicts);
      const nameEl = document.createElement("div"); nameEl.textContent = getTemplateCardTitle(tpl);
      const teacherEl = document.createElement("div"); teacherEl.className = "tt-all-entry-teacher"; teacherEl.textContent = entry.teacherName || "";
      div.append(nameEl, teacherEl); td.appendChild(div);
    });
    return td;
  };

  periods.forEach((label, period) => {
    // Lunch row before this period
    if (showLunch && period === lunchAfter + 1) {
      const lunchTr = document.createElement("tr"); lunchTr.className = "tt-all-lunch";
      const lTd = document.createElement("td"); lTd.textContent = "🍱"; lTd.style.cssText = "text-align:center;font-size:13px;border:1px solid #fde68a;position:sticky;left:0;z-index:2;background:#fef9c3";
      lunchTr.appendChild(lTd);
      activeGrades.forEach(() => {
        for (let d = 0; d < 5; d++) { const td = document.createElement("td"); td.textContent = "점심시간"; lunchTr.appendChild(td); }
        lunchTr.appendChild(document.createElement("td")); // sep
      });
      tbody.appendChild(lunchTr);
    }

    const tr = document.createElement("tr");
    const periodTd = document.createElement("td"); periodTd.className = "tt-all-period"; periodTd.textContent = label; tr.appendChild(periodTd);
    activeGrades.forEach((grade, gi) => {
      days.forEach((_, day) => tr.appendChild(buildCell(grade, day, period)));
      const sep = document.createElement("td"); sep.style.cssText = "width:4px;background:#f1f5f9;border:none"; tr.appendChild(sep);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  outerWrap.appendChild(table);
  wrap.appendChild(outerWrap);
}

function buildGrid(periods, days, wrap, getEntries) {
  const table = document.createElement("table"); table.className = "tt-table";
  const thead = document.createElement("thead"); const hrow = document.createElement("tr");
  const corner = document.createElement("th"); corner.className = "tt-corner";
  corner.innerHTML = `<div class="tt-corner-inner">
    <div class="tt-period-count-wrap">
      교시 수: <input type="number" id="ttPeriodCountInp" min="1" max="12" value="${ttConfig().periodCount}" style="width:44px">
      <button id="ttApplyPeriods" type="button">적용</button>
    </div>
    <div class="tt-lunch-wrap">
      <label><input type="checkbox" id="ttShowLunch" ${ttConfig().showLunch ? "checked" : ""}> 점심</label>
      <select id="ttLunchAfter" style="font-size:10px;padding:1px 3px">
        ${periods.map((l,i) => `<option value="${i}" ${i === ttConfig().lunchAfterPeriod ? "selected" : ""}>${l} 후</option>`).join("")}
      </select>
    </div>
  </div>`;
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
      slotEntries.forEach(entry => td.appendChild(buildEntryCard(entry)));
      if (!slotEntries.length) { const ph = document.createElement("div"); ph.className = "tt-cell-ph"; td.appendChild(ph); }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody); wrap.appendChild(table);

  // Wire controls
  setTimeout(() => {
    const inp = $("ttPeriodCountInp"); const btn = $("ttApplyPeriods");
    btn?.addEventListener("click", () => { setPeriodCount(parseInt(inp?.value) || 8); renderAll(); });
    const lunchChk = $("ttShowLunch"); const lunchSel = $("ttLunchAfter");
    lunchChk?.addEventListener("change", e => { setLunchConfig(undefined, e.target.checked); renderAll(); });
    lunchSel?.addEventListener("change", e => { setLunchConfig(parseInt(e.target.value), undefined); renderAll(); });
  }, 0);
  return table;
}

function buildEntryCard(entry) {
  const tpl = getTemplateById(entry.templateId);
  const title = tpl ? getTemplateCardTitle(tpl) : "?";
  const teachers = getTeachersForTemplate(entry.templateId);
  const rooms    = getRooms();
  const conflicts = new Set([...(conflictMap.get(entry.id) || []), ...(constraintMap.get(entry.id) || [])]);
  const hasConflict = conflicts.size > 0;

  const card = document.createElement("div");
  card.className = "tt-entry-card" + (hasConflict ? " tt-entry-conflict" : "");
  if (hasConflict) card.title = getConflictLabel(conflicts);

  // Color by category
  const cat = getCategoryForTemplate(entry.gradeKey || currentGrade, entry.templateId);
  const color = getCategoryColor(cat);
  card.style.background = color.bg; card.style.color = color.text; card.style.borderColor = color.text + "33";

  // Title row
  const titleRow = document.createElement("div"); titleRow.className = "tt-entry-title"; titleRow.textContent = title;

  // Teacher select
  const teacherRow = document.createElement("div"); teacherRow.className = "tt-entry-row";
  const teacherSel = document.createElement("select"); teacherSel.className = "tt-entry-select"; teacherSel.disabled = !canEdit();
  const noTeacher = document.createElement("option"); noTeacher.value = ""; noTeacher.textContent = "교사 선택";
  teacherSel.appendChild(noTeacher);
  teachers.forEach(t => { const o = document.createElement("option"); o.value = t; o.textContent = t; if (t === entry.teacherName) o.selected = true; teacherSel.appendChild(o); });
  if (entry.teacherName && !teachers.includes(entry.teacherName)) {
    const o = document.createElement("option"); o.value = entry.teacherName; o.textContent = entry.teacherName; o.selected = true; teacherSel.appendChild(o);
  }
  teacherSel.addEventListener("change", e => { updateEntry(entry.id, "teacherName", e.target.value); recomputeConflicts(); renderAll(); });
  teacherRow.appendChild(teacherSel);

  // Room select
  const roomSel = document.createElement("select"); roomSel.className = "tt-entry-select"; roomSel.disabled = !canEdit();
  const noRoom = document.createElement("option"); noRoom.value = ""; noRoom.textContent = "교실";
  roomSel.appendChild(noRoom);
  rooms.forEach(r => { const o = document.createElement("option"); o.value = r.id; o.textContent = r.name; if (r.id === entry.roomId) o.selected = true; roomSel.appendChild(o); });
  roomSel.addEventListener("change", e => { updateEntry(entry.id, "roomId", e.target.value || null); recomputeConflicts(); renderAll(); });
  teacherRow.appendChild(roomSel);

  // Remove btn
  const removeBtn = makeBtn("×", "tt-entry-remove", () => { removeEntry(entry.id); recomputeConflicts(); renderAll(); });
  removeBtn.disabled = !canEdit();

  card.append(titleRow, teacherRow, removeBtn);
  return card;
}

// ── Drop handler ──────────────────────────────────────────────────
function handleDrop(data, day, period) {
  const { templateId, sectionIdx = 0, gradeKey } = data;
  const resolvedGrade = gradeKey || currentGrade;
  const teachers = getTeachersForTemplate(templateId);
  addEntry({
    day, period,
    templateId, sectionIdx,
    teacherName: teachers[0] || "",
    roomId: null,
    gradeKey: resolvedGrade
  });
  recomputeConflicts(); renderAll();
}

// ── Subject panel ─────────────────────────────────────────────────
function renderSubjectPanel() {
  const hdrEl  = $("ttPanelHeader");
  const panel  = $("ttPanel");
  if (!panel) return;
  panel.innerHTML = "";
  if (hdrEl) {
    hdrEl.innerHTML = "";
    const row = document.createElement("div"); row.className = "tt-panel-header";
    const title = document.createElement("div"); title.className = "tt-panel-title"; title.textContent = "과목 카드";
    const gradeLabel = document.createElement("div"); gradeLabel.className = "tt-panel-grade";
    gradeLabel.textContent = currentView === "grade" ? currentGrade : "";
    row.append(title, gradeLabel); hdrEl.appendChild(row);
  }

  if (currentView !== "grade") {
    const info = document.createElement("div"); info.className = "tt-empty";
    info.textContent = "학년별 보기에서 과목을 배치하세요."; panel.appendChild(info); return;
  }

  const subjects = getSubjectsForGrade(currentGrade);
  if (!subjects.length) {
    const e = document.createElement("div"); e.className = "tt-empty"; e.textContent = "이 학년에 배치된 과목이 없습니다."; panel.appendChild(e); return;
  }

  subjects.forEach(tpl => {
    const credits   = getCreditsForTemplate(currentGrade, tpl.id);
    const assigned  = getAssignedCount(tpl.id, currentGrade);
    const sections  = getSectionCount(tpl.id);
    const cat       = getCategoryForTemplate(currentGrade, tpl.id);
    const color     = getCategoryColor(cat);
    const teachers  = getTeachersForTemplate(tpl.id);

    // Section tabs if multiple sections
    const sectionCount = Math.max(1, sections);
    for (let sec = 0; sec < sectionCount; sec++) {
      const card = document.createElement("div");
      card.className = "tt-subject-card";
      card.style.borderLeftColor = color.text;
      card.style.background = color.bg + "cc";
      card.draggable = canEdit();

      const topRow = document.createElement("div"); topRow.className = "tt-sc-top";
      const name = document.createElement("div"); name.className = "tt-sc-name"; name.textContent = getTemplateCardTitle(tpl);
      const badge = document.createElement("span"); badge.className = "tt-sc-badge";
      const secAssigned = entries().filter(e => e.templateId === tpl.id && e.gradeKey === currentGrade && e.sectionIdx === sec).length;
      badge.textContent = `${secAssigned}/${credits}`;
      badge.style.background = secAssigned >= credits && credits > 0 ? "#dcfce7" : secAssigned > 0 ? "#fef9c3" : "#f1f5f9";
      badge.style.color = secAssigned >= credits && credits > 0 ? "#166534" : "#374151";
      topRow.append(name, badge);

      const botRow = document.createElement("div"); botRow.className = "tt-sc-bot";
      botRow.textContent = teachers.join(", ") || "-";
      if (sectionCount > 1) {
        const secBadge = document.createElement("span"); secBadge.className = "tt-sc-sec"; secBadge.textContent = `${sec + 1}분반`;
        botRow.appendChild(secBadge);
      }
      card.append(topRow, botRow);

      card.addEventListener("dragstart", () => { dragData = { templateId: tpl.id, sectionIdx: sec, gradeKey: currentGrade }; card.classList.add("tt-dragging"); });
      card.addEventListener("dragend", () => { dragData = null; card.classList.remove("tt-dragging"); });
      panel.appendChild(card);
    }
  });
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
  if (panelEl) panelEl.style.display = currentView === "all" ? "none" : "";
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

  // 3. Student conflict (same grade, same slot)
  const sameGrade = slotEnts.filter(e => e.gradeKey === item.gradeKey);
  for (const e of sameGrade) {
    const conc = isConcurrentTpl(item.templateId) && isConcurrentTpl(e.templateId) && sameGroupTpl(item.templateId, e.templateId);
    const linked = linkedGroups(item.templateId, e.templateId);
    if (!conc && !linked) return false;
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

// ── Auto-assign ALL grades simultaneously ─────────────────────────
export function autoAssignAll() {
  if (!canEdit()) return;

  const activeGrades = GRADE_KEYS.filter(g => getSubjectsForGrade(g).length > 0);
  if (!activeGrades.length) { alert("커리큘럼에 배치된 과목이 없습니다."); return; }

  if (!confirm(
    `전체 학년 시간표를 자동 배치합니다.\n대상: ${activeGrades.join(", ")}\n\n` +
    `기존 시간표가 모두 초기화됩니다. 계속할까요?`
  )) return;

  // ── 1. 전체 학년 required 수집 ──────────────────────────────────
  const required = [];
  GRADE_KEYS.forEach(gradeKey => {
    getSubjectsForGrade(gradeKey).forEach(tpl => {
      const credits  = getCreditsForTemplate(gradeKey, tpl.id);
      const sections = getSectionCount(tpl.id);
      const teacher  = getTeachersForTemplate(tpl.id)[0] || "";
      for (let sec = 0; sec < sections; sec++) {
        for (let i = 0; i < credits; i++) {
          required.push({ templateId: tpl.id, sectionIdx: sec, gradeKey, teacherName: teacher });
        }
      }
    });
  });

  if (!required.length) { alert("배치할 과목이 없습니다."); return; }

  // ── 2. 전체 초기화 ───────────────────────────────────────────────
  ttDomain().entries = [];

  // ── 3. 슬롯 풀 ──────────────────────────────────────────────────
  const pc = ttConfig().periodCount;
  const baseSlots = [];
  for (let day = 0; day < 5; day++)
    for (let period = 0; period < pc; period++)
      baseSlots.push({ day, period });

  // ── 4. 교사 부하 계산 → 가장 바쁜 교사 먼저 배치 (CSP 휴리스틱) ──
  const teacherLoad = new Map();
  required.forEach(r => {
    if (r.teacherName) teacherLoad.set(r.teacherName, (teacherLoad.get(r.teacherName) || 0) + 1);
  });
  // 같은 교사가 많은 과목 먼저 배치 → 제약 충돌 최소화
  const sortByConstraint = arr => [...arr].sort((a, b) =>
    (teacherLoad.get(b.teacherName) || 0) - (teacherLoad.get(a.teacherName) || 0)
  );

  // ── 5. 랜덤 그리디 반복 (최대 8회) ─────────────────────────────
  const MAX_ATTEMPTS = 8;
  let bestPlaced = [], bestFailed = [...required];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const groups = appState.templates.templateGroups || [];
    // Build linked group pairs (bidirectional)
    const linkedPairs = new Map(); // groupId → Set of linked groupIds
    groups.forEach(g => {
      if (g.linkedGroupId) {
        if (!linkedPairs.has(g.id)) linkedPairs.set(g.id, new Set());
        if (!linkedPairs.has(g.linkedGroupId)) linkedPairs.set(g.linkedGroupId, new Set());
        linkedPairs.get(g.id).add(g.linkedGroupId);
        linkedPairs.get(g.linkedGroupId).add(g.id);
      }
    });

    // Group required items by their groupId for linked scheduling
    const getGroupId = item => appState.templates.templates?.find(t => t.id === item.templateId)?.calcGroupId || null;

    // Separate linked groups into blocks, others remain independent
    const linkedBlocks = []; // [[items from groupA], [items from groupB]] - must share slots
    const independent = [];
    const processedGroups = new Set();

    // Build blocks of linked groups
    const allGroupIds = [...new Set(required.map(getGroupId).filter(Boolean))];
    allGroupIds.forEach(gid => {
      if (processedGroups.has(gid)) return;
      const linked = linkedPairs.get(gid);
      if (linked && linked.size > 0) {
        const blockGroups = [gid, ...linked];
        blockGroups.forEach(id => processedGroups.add(id));
        const blockItems = blockGroups.map(id => required.filter(item => getGroupId(item) === id));
        linkedBlocks.push(blockItems);
      }
    });
    required.forEach(item => {
      const gid = getGroupId(item);
      if (!gid || !processedGroups.has(gid)) independent.push(item);
    });

    const sortedKeys = [...new Map().keys()]; // unused
    const shuffledIndep = shuffle([...independent]);
    const placed = [], failed = [];

    // Place linked blocks first (most constrained)
    for (const block of linkedBlocks) {
      // block = [[groupA items], [groupB items], ...]
      // Items within each group need same number of slots
      const maxSlots = Math.max(...block.map(g => g.length));
      for (let slotIdx = 0; slotIdx < maxSlots; slotIdx++) {
        // Find a slot that works for ALL groups in this block simultaneously
        let foundSlot = null;
        for (const slot of shuffle([...baseSlots])) {
          let valid = true;
          const hypothetical = [];
          for (const groupItems of block) {
            const item = groupItems[slotIdx];
            if (!item) continue;
            if (!checkPlacementValid(item, slot, [...placed, ...hypothetical])) { valid = false; break; }
            hypothetical.push({ ...item, ...slot });
          }
          if (valid) { foundSlot = slot; break; }
        }
        if (foundSlot) {
          for (const groupItems of block) {
            const item = groupItems[slotIdx];
            if (item) placed.push({ ...item, ...foundSlot });
          }
        } else {
          for (const groupItems of block) {
            const item = groupItems[slotIdx];
            if (item) failed.push(item);
          }
        }
      }
    }

    // Place independent items
    for (const item of shuffledIndep) {
      let found = false;
      for (const slot of shuffle([...baseSlots])) {
        if (checkPlacementValid(item, slot, placed)) {
          placed.push({ ...item, ...slot }); found = true; break;
        }
      }
      if (!found) failed.push(item);
    }

    if (placed.length > bestPlaced.length) {
      bestPlaced = placed;
      bestFailed = failed;
    }
    if (bestFailed.length === 0) break;
  }

  // ── 6. 커밋 ────────────────────────────────────────────────────
  bestPlaced.forEach(e => entries().push(normalizeTimetableEntry({ id: uid("ent"), ...e })));
  scheduleSave("timetable");
  recomputeConflicts(); renderAll();

  // ── 7. 결과 보고 ────────────────────────────────────────────────
  if (bestFailed.length === 0) {
    alert(`✅ 전체 ${bestPlaced.length}개 슬롯 배치 완료!\n대상 학년: ${activeGrades.join(", ")}`);
  } else {
    const failedNames = [...new Set(bestFailed.map(f => {
      const tpl = getTemplateById(f.templateId);
      return `${f.gradeKey} · ${getTemplateCardTitle(tpl) || "?"}` +
        (getSectionCount(f.templateId) > 1 ? ` (${f.sectionIdx + 1}분반)` : "");
    }))];
    alert(
      `✅ ${bestPlaced.length}개 배치 완료\n` +
      `⚠️ 미배치 ${bestFailed.length}슬롯 (${failedNames.length}개 과목):\n` +
      failedNames.slice(0, 12).join("\n") +
      (failedNames.length > 12 ? `\n... 외 ${failedNames.length - 12}개` : "") +
      `\n\n💡 교사 제약 조건 완화 또는 직접 배치로 보완하세요.`
    );
  }
}

// ── Master render ─────────────────────────────────────────────────
function renderAll() {
  recomputeConflicts();
  renderViewSelectors();
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
          .filter(e => e.gradeKey === grade && e.day === day && e.period === period)
          .map(e => {
            const tpl = getTemplateById(e.templateId);
            const name = tpl ? getTemplateCardTitle(tpl) : "?";
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
  if (currentView !== "grade") { alert("학년별 보기에서 실행하세요."); return; }
  if (!confirm(`"${currentGrade}" 시간표를 초기화할까요?`)) return;
  ttDomain().entries = entries().filter(e => e.gradeKey !== currentGrade);
  scheduleSave("timetable"); recomputeConflicts(); renderAll();
});
$("ttAutoAssignBtn")?.addEventListener("click", () => autoAssignAll());

renderAll();
