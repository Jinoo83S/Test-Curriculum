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
  const labels = Array.from({ length: count }, (_, i) => ttConfig().periodLabels[i] || `${i+1}교시`);
  ttConfig().periodCount = count; ttConfig().periodLabels = labels;
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

function buildGrid(periods, days, wrap, getEntries) {
  const table = document.createElement("table"); table.className = "tt-table";
  const thead = document.createElement("thead"); const hrow = document.createElement("tr");
  const corner = document.createElement("th"); corner.className = "tt-corner";
  corner.innerHTML = `<span class="tt-period-count-wrap">
    교시 수: <input type="number" id="ttPeriodCountInp" min="1" max="12" value="${ttConfig().periodCount}" style="width:44px">
    <button id="ttApplyPeriods" type="button">적용</button>
  </span>`;
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

  // Wire period count
  setTimeout(() => {
    const inp = $("ttPeriodCountInp"); const btn = $("ttApplyPeriods");
    btn?.addEventListener("click", () => { setPeriodCount(parseInt(inp?.value) || 7); renderAll(); });
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
  const panel = ttPanel(); if (!panel) return;
  panel.innerHTML = "";

  const hdr = document.createElement("div"); hdr.className = "tt-panel-header";
  const title = document.createElement("div"); title.className = "tt-panel-title"; title.textContent = "과목 카드";
  const gradeLabel = document.createElement("div"); gradeLabel.className = "tt-panel-grade"; gradeLabel.textContent = currentView === "grade" ? currentGrade : "";
  hdr.append(title, gradeLabel); panel.appendChild(hdr);

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

  const allTeachers = [...new Set(entries().flatMap(e => splitTeacherNames(e.teacherName)).filter(Boolean))];
  if (!allTeachers.length) {
    el.innerHTML = '<div class="tt-empty">시간표에 배치된 교사가 없습니다.</div>'; return;
  }

  const table = document.createElement("table"); table.className = "tt-constraint-table";
  table.innerHTML = `<thead><tr><th>교사</th><th>하루 최대 수업</th><th>최대 연속 수업</th><th>총 시수</th></tr></thead>`;
  const tbody = document.createElement("tbody");

  allTeachers.sort((a, b) => a.localeCompare(b, "ko")).forEach(teacher => {
    const c = constraints()[teacher] || { maxPerDay: 6, maxConsecutive: 3, unavailableSlots: [] };
    const total = entries().filter(e => splitTeacherNames(e.teacherName).includes(teacher)).length;
    const tr = document.createElement("tr");

    // Teacher name
    const nameTd = document.createElement("td"); nameTd.className = "tt-con-name"; nameTd.textContent = teacher; tr.appendChild(nameTd);
    // Max per day
    const mpdTd = document.createElement("td");
    const mpdInp = document.createElement("input"); mpdInp.type = "number"; mpdInp.min = "1"; mpdInp.max = "12"; mpdInp.value = c.maxPerDay; mpdInp.disabled = !canEdit();
    mpdInp.addEventListener("change", e => { updateConstraint(teacher, "maxPerDay", parseInt(e.target.value) || 6); });
    mpdTd.appendChild(mpdInp); tr.appendChild(mpdTd);
    // Max consecutive
    const mcTd = document.createElement("td");
    const mcInp = document.createElement("input"); mcInp.type = "number"; mcInp.min = "1"; mcInp.max = "12"; mcInp.value = c.maxConsecutive; mcInp.disabled = !canEdit();
    mcInp.addEventListener("change", e => { updateConstraint(teacher, "maxConsecutive", parseInt(e.target.value) || 3); });
    mcTd.appendChild(mcInp); tr.appendChild(mcTd);
    // Total
    const totalTd = document.createElement("td"); totalTd.className = "tt-con-total";
    const constraintViol = constraintMap.get ? [...constraintMap.entries()].filter(([id, s]) => { const e = entries().find(e => e.id === id); return e && splitTeacherNames(e.teacherName).includes(teacher) && s.size > 0; }) : [];
    totalTd.textContent = total + (constraintViol.length ? ` ⚠️` : "");
    tr.appendChild(totalTd);
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
}

// ── Conflict summary bar ──────────────────────────────────────────
function renderConflictBar() {
  const bar = $("ttConflictBar"); if (!bar) return;
  const totalConflicts = [...conflictMap.values(), ...constraintMap.values()].filter(s => s.size > 0).length;
  bar.textContent = totalConflicts > 0 ? `⚠️ 충돌 ${totalConflicts}건 발견` : "✅ 충돌 없음";
  bar.className = "tt-conflict-bar " + (totalConflicts > 0 ? "tt-conflict-bar-warn" : "tt-conflict-bar-ok");
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

renderAll();
