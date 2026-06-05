// ================================================================
// timetable.js · Timetable Page — Main Module
// ================================================================
import { GRADE_KEYS } from "./config.js";
import { login, logout, onAuth, canEdit } from "./auth.js";
import { appState, subscribeDomains, unsubscribeAll, setOnUpdate, scheduleSave, saveNow,
         normalizeTimetableEntry, migrateFromLegacy, TIMETABLE_CORE_DOMAINS, TIMETABLE_OPTIONAL_DOMAINS,
         setOnSaveStatus, isAutoSaveEnabled, setAutoSaveEnabled, getDirtyDomains, savePendingNow,
         exportLocalSnapshot, importLocalSnapshot, resetLocalSnapshot, exportFirestoreDiagnosticSnapshot } from "./state.js";
import { LOCAL_DEV_MODE } from "./local-dev.js";
import { openDataCleanupDialog } from "./data-cleanup.js";
import { openFirestoreUsageDialog } from "./firestore-usage.js";
import { getTemplateById, getTemplateCardTitle, splitTeacherNames } from "./templates.js";
import { uid, clean, makeBtn, sectionLabel, gradeDisplay, escapeHtml, isProtectedWholeGradeLabel } from "./utils.js";
import { getTtCards, getTtCardById, refreshTtCardData } from "./ttcards.js?v=manual_card_r1";
import { getRooms, getRoomById, renderRoomsView, updateRoom, formatHomeRoomClassLabel } from "./rooms.js";
import { detectConflicts, detectConstraintViolations, getConflictLabel } from "./timetable-conflicts.js?v=compound_subject_slot_guard";
import {
  ttCardIdsFromPlacement as occTtCardIdsFromPlacement,
  getEntryOccupancy,
  setsIntersect as occSetsIntersect,
  audiencesConflict as occAudiencesConflict,
  audienceGradeSet as occAudienceGradeSet,
  conflictDetailBetween as occConflictDetailBetween,
  formatClassLabelFromKey as occFormatClassLabelFromKey,
  normalizeClassKey as occNormalizeClassKey
} from "./timetable-occupancy.js";
import {
  getSubjectsForGrade, getCreditsForTemplate, getCategoryColor, getAssignedCount,
  getCategoryForTemplate, getTrackForTemplate, getGroupNameForTemplate,
  getTeachersForTemplate, getSectionCount, getCreditsForTtCard, getTeachersForTtCard,
  getGroupCards, getTtCardClassLabels, describeTtCard, buildEntryDataFromTtCards,
  makePlacementFromGroupItem, entryMatchesClass, getUnitForTemplate, getUnitDisplayTitle,
  getUnitGradeKeys, getUnitTeachers, getAllClasses, entryGradeKeys, entryTemplateIds,
  entryHasGrade, entryTitle, entryTeachers, calculateClassCreditSummary
} from "./timetable-data.js?v=credit_diag_dedupe_r1";
import { createAutoAssignAll } from "./timetable-autoassign.js?v=auto_options_r1";
import { renderTimetableGrid } from "./timetable-grid.js?v=group_name_r1";
import { createTimetableDetailHandlers } from "./timetable-detail.js?v=context_menu_top";
import { createTimetableConstraintsHandlers } from "./timetable-constraints.js";
import { createTimetableLogHandlers } from "./timetable-log.js?v=auto_options_r1";
import { createTimetableSidebarHandlers } from "./timetable-sidebar.js?v=auto_options_r1";
import { getGradeColor, CONFLICT_DISPLAY, CONFLICT_PRIORITY, getOrderedConflictTypes, applyConflictVisuals as applyConflictVisualsBase } from "./timetable-ui.js";
import { createTimetableUndoHandlers } from "./timetable-undo.js";
import { createTimetableAuthUi } from "./timetable-auth-ui.js";
import { exportTimetableXlsx } from "./timetable-export.js";

// ── Accessors ─────────────────────────────────────────────────────
const ttDomain  = () => appState.timetable;
const entries   = () => ttDomain().entries;
const ttConfig  = () => ttDomain().config;
const constraints = () => ttDomain().teacherConstraints;

// ── Module state ──────────────────────────────────────────────────
let currentView    = "all";
let currentGrade   = "7학년";
// 교사별 보기에서는 여러 교사를 쉼표로 묶어 저장합니다. (예: "김예리,박예지")
let currentTeacher = "";
let currentRoom    = "";
let teacherPickerOutsideHandlerInstalled = false;
let roomPickerOutsideHandlerInstalled = false;
let dragData       = null;
const TT_DRAG_MIME = "application/x-his-timetable-drag";

// 시간표 카드 갱신/불러오기는 curriculum + templates + rosters 원본이 모두 필요합니다.
// state.js의 TIMETABLE_CORE_DOMAINS가 가볍게 유지되어 있어도, 시간표 페이지에서는
// 원본 도메인을 함께 구독해야 삭제된 카드가 원본 기준으로 재생성됩니다.
const TIMETABLE_REBUILD_DOMAINS = ["curriculum", "templates", "teachers", "classes", "rosters", "rooms", "timetable"];
const TIMETABLE_PAGE_DOMAINS = [...new Set([
  ...TIMETABLE_CORE_DOMAINS,
  ...TIMETABLE_OPTIONAL_DOMAINS,
  ...TIMETABLE_REBUILD_DOMAINS,
])];
function subscribeTimetablePageDomains() {
  subscribeDomains(TIMETABLE_PAGE_DOMAINS);
}

function writeDragDataToEvent(ev, data, effect = "move") {
  if (!ev?.dataTransfer || !data) return;
  ev.dataTransfer.effectAllowed = effect;
  const payload = JSON.stringify(data);
  ev.dataTransfer.setData(TT_DRAG_MIME, payload);
  ev.dataTransfer.setData("text/plain", payload);
}

function readDragDataFromEvent(ev) {
  const dt = ev?.dataTransfer;
  if (!dt) return null;
  for (const type of [TT_DRAG_MIME, "text/plain"]) {
    try {
      const raw = dt.getData(type);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.kind) return parsed;
    } catch (_) {
      // Ignore non-JSON values inserted by browser/extensions.
    }
  }
  return null;
}

let conflictMap    = new Map();
let constraintMap  = new Map();

// ── Split module APIs ───────────────────────────────────────────
let constraintsPanelApi = null;
let addTimetableLog = () => {};
let setLastAutoAssignReport = () => {};
let getConflictCounts = () => ({ counts: {}, totalAffected: 0 });
let renderLogPanel = () => {};

function subscribeOptionalTimetableDomains() {
  // 하단바/과목카드/진단/갱신은 시간표 원본 도메인 전체가 필요합니다.
  // 특히 curriculum이 구독되지 않으면 카드 갱신이 0개로 끝납니다.
  subscribeTimetablePageDomains();
}

function isVisible(el) {
  return !!el && !el.classList.contains("hidden");
}

function activateBottomTab(tabName) {
  window._ttBottomToggle?.show?.();
  const btn = document.querySelector(`.tt-bottom-tab-btn[data-tab="${tabName}"]`);
  btn?.click();
}

let ttSaveStatusEl = null;
let ttSaveModeBtn = null;
let ttSavePendingBtn = null;
let ttSaveStatusTimer = null;

function updateTtSaveControls() {
  if (ttSaveModeBtn) {
    ttSaveModeBtn.textContent = isAutoSaveEnabled() ? "자동저장 ON" : "자동저장 OFF";
    ttSaveModeBtn.title = isAutoSaveEnabled()
      ? "클릭하면 개발용 수동 저장 모드로 전환됩니다."
      : "클릭하면 자동 저장을 다시 켭니다.";
  }
  if (ttSavePendingBtn) {
    const dirty = getDirtyDomains();
    ttSavePendingBtn.hidden = dirty.length === 0;
    ttSavePendingBtn.textContent = dirty.length ? `저장 대기(${dirty.length})` : "저장 대기";
  }
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickJsonFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(String(reader.result || "{}"))); }
        catch (e) { reject(e); }
      };
      reader.onerror = () => reject(reader.error || new Error("파일을 읽지 못했습니다."));
      reader.readAsText(file);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function setupTtSaveQuotaControls() {
  const parent = document.querySelector(".tt-topbar-right");
  if (!parent || ttSaveStatusEl) return;

  if (LOCAL_DEV_MODE) {
    const devMenu = document.createElement("details");
    devMenu.className = "tt-local-dev-menu local-dev-menu";
    devMenu.title = "Firebase를 읽거나 쓰지 않고 localStorage만 사용합니다.";

    const summary = document.createElement("summary");
    summary.textContent = "LOCAL DEV";
    devMenu.appendChild(summary);

    const panel = document.createElement("div");
    panel.className = "local-dev-menu-panel";

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "tt-save-mode-btn local-dev-action";
    exportBtn.textContent = "로컬 내보내기";
    exportBtn.addEventListener("click", () => {
      downloadJsonFile(`his-local-dev-${new Date().toISOString().slice(0,10)}.json`, exportLocalSnapshot());
      devMenu.open = false;
    });

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "tt-save-mode-btn local-dev-action";
    importBtn.textContent = "로컬 가져오기";
    importBtn.addEventListener("click", async () => {
      try {
        const json = await pickJsonFile();
        if (!json) return;
        importLocalSnapshot(json);
        renderAll();
        devMenu.open = false;
        alert("로컬 데이터를 가져왔습니다.");
      } catch (e) {
        console.error(e);
        alert("JSON 가져오기에 실패했습니다: " + (e?.message || e));
      }
    });

    const resetLocalBtn = document.createElement("button");
    resetLocalBtn.type = "button";
    resetLocalBtn.className = "tt-save-mode-btn local-dev-action";
    resetLocalBtn.textContent = "로컬 초기화";
    resetLocalBtn.addEventListener("click", () => {
      if (!confirm("브라우저에 저장된 로컬 개발 데이터를 초기화할까요? Firebase 데이터에는 영향이 없습니다.")) return;
      resetLocalSnapshot();
      renderAll();
      devMenu.open = false;
    });

    panel.append(exportBtn, importBtn, resetLocalBtn);
    devMenu.appendChild(panel);
    parent.insertBefore(devMenu, parent.firstChild);
  } else {
    const diagBtn = document.createElement("button");
    diagBtn.type = "button";
    diagBtn.className = "tt-save-mode-btn firestore-diagnostic-btn dev-tool-control";
    diagBtn.textContent = "Firestore 진단";
    diagBtn.title = "현재 Firestore 저장 데이터를 JSON으로 내보냅니다. 읽기 quota를 사용합니다.";
    diagBtn.addEventListener("click", async () => {
      if (!canEdit()) {
        alert("온라인 모드에서 로그인 후 실행할 수 있습니다.");
        return;
      }
      if (!confirm("Firestore 저장 데이터를 진단용 JSON으로 내보낼까요?\n읽기 quota가 일부 사용됩니다.")) return;
      const prevText = diagBtn.textContent;
      diagBtn.disabled = true;
      diagBtn.textContent = "진단 중…";
      try {
        const snapshot = await exportFirestoreDiagnosticSnapshot();
        downloadJsonFile(`his-firestore-diagnostic-${new Date().toISOString().slice(0,10)}.json`, snapshot);
      } catch (e) {
        console.error(e);
        alert("Firestore 진단 내보내기에 실패했습니다: " + (e?.message || e));
      } finally {
        diagBtn.disabled = false;
        diagBtn.textContent = prevText;
      }
    });
    const cleanupBtn = document.createElement("button");
    cleanupBtn.type = "button";
    cleanupBtn.className = "tt-save-mode-btn data-cleanup-btn dev-tool-control";
    cleanupBtn.textContent = "DB 정리";
    cleanupBtn.title = "중복 시간표 카드와 교실 홈룸 데이터를 미리보기 후 정리합니다.";
    cleanupBtn.addEventListener("click", () => openDataCleanupDialog());

    const usageBtn = document.createElement("button");
    usageBtn.type = "button";
    usageBtn.className = "tt-save-mode-btn firestore-usage-btn dev-tool-control";
    usageBtn.textContent = "사용량";
    usageBtn.title = "이 브라우저에서 발생한 Firestore 읽기/쓰기/삭제 추정치를 확인합니다.";
    usageBtn.addEventListener("click", () => openFirestoreUsageDialog());

    parent.insertBefore(cleanupBtn, parent.firstChild);
    parent.insertBefore(usageBtn, parent.firstChild);
    parent.insertBefore(diagBtn, parent.firstChild);
  }

  ttSaveStatusEl = document.createElement("span");
  ttSaveStatusEl.className = "tt-save-status";
  ttSaveStatusEl.style.fontSize = "12px";
  ttSaveStatusEl.style.fontWeight = "800";
  ttSaveStatusEl.style.color = "#64748b";

  ttSaveModeBtn = document.createElement("button");
  ttSaveModeBtn.type = "button";
  ttSaveModeBtn.className = "tt-save-mode-btn dev-tool-control";
  ttSaveModeBtn.addEventListener("click", async () => {
    const next = !isAutoSaveEnabled();
    setAutoSaveEnabled(next);
    updateTtSaveControls();
    if (next && getDirtyDomains().length) await savePendingNow();
  });

  ttSavePendingBtn = document.createElement("button");
  ttSavePendingBtn.type = "button";
  ttSavePendingBtn.className = "tt-save-btn dev-tool-control";
  ttSavePendingBtn.addEventListener("click", async () => {
    await savePendingNow();
    updateTtSaveControls();
  });

  const saveBtn = $("ttSaveBtn");
  parent.insertBefore(ttSaveStatusEl, saveBtn || null);
  parent.insertBefore(ttSaveModeBtn, saveBtn || null);
  parent.insertBefore(ttSavePendingBtn, saveBtn || null);
  updateTtSaveControls();
}

function setupTtSaveStatusHandler() {
  setOnSaveStatus((status, detail) => {
    if (!ttSaveStatusEl) return;
    clearTimeout(ttSaveStatusTimer);
    updateTtSaveControls();

    if (status === "saving") {
      ttSaveStatusEl.textContent = "저장 대기 중…";
      ttSaveStatusEl.style.color = "#ca8a04";
    } else if (status === "dirty") {
      const count = detail?.dirtyDomains?.length || getDirtyDomains().length;
      ttSaveStatusEl.textContent = `변경 ${count}개 대기`;
      ttSaveStatusEl.style.color = "#ca8a04";
    } else if (status === "saved") {
      ttSaveStatusEl.textContent = "저장됨";
      ttSaveStatusEl.style.color = "#15803d";
      ttSaveStatusTimer = setTimeout(() => { ttSaveStatusEl.textContent = isAutoSaveEnabled() ? "" : "수동 저장 모드"; updateTtSaveControls(); }, 2500);
    } else if (status === "skipped") {
      ttSaveStatusEl.textContent = "변경 없음";
      ttSaveStatusEl.style.color = "#15803d";
      ttSaveStatusTimer = setTimeout(() => { ttSaveStatusEl.textContent = isAutoSaveEnabled() ? "" : "수동 저장 모드"; updateTtSaveControls(); }, 1500);
    } else if (status === "mode") {
      ttSaveStatusEl.textContent = isAutoSaveEnabled() ? "" : "수동 저장 모드";
      ttSaveStatusEl.style.color = "#64748b";
    } else {
      ttSaveStatusEl.textContent = "저장 실패";
      ttSaveStatusEl.style.color = "#dc2626";
    }
  });
}

// ── Undo stack is implemented in timetable-undo.js ──────────────
let captureTimetableUndo = () => {};
let undoLastTimetableEdit = () => {};

// ── DOM refs ──────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const ttGrid       = () => $("ttGrid");
const ttAuthStatus = () => $("ttAuthStatus");
const ttLoginBtn   = () => $("ttLoginBtn");
const ttLogoutBtn  = () => $("ttLogoutBtn");

const undoHandlers = createTimetableUndoHandlers({
  canEdit,
  getSnapshot: () => ({
    entries: ttDomain().entries || [],
    config: ttDomain().config || {},
    teacherConstraints: ttDomain().teacherConstraints || {},
  }),
  restoreSnapshot: snapshot => {
    ttDomain().entries = snapshot.entries || [];
    ttDomain().config = snapshot.config || ttDomain().config || {};
    ttDomain().teacherConstraints = snapshot.teacherConstraints || {};
  },
  scheduleSave,
  recomputeConflicts,
  renderAll: () => renderAll(),
  addTimetableLog: (...args) => addTimetableLog(...args),
  getFeedbackElement: () => $("ttConflictBar"),
});
captureTimetableUndo = undoHandlers.captureTimetableUndo;
undoLastTimetableEdit = undoHandlers.undoLastTimetableEdit;
undoHandlers.installUndoShortcut();

// ── Conflict display helpers ───────────────────────────────────
function applyConflictVisuals(card, conflictTypes, conflicts) {
  applyConflictVisualsBase(card, conflictTypes, conflicts, getConflictLabel);
}


function getEntryConflictSet(entry) {
  return new Set([...(conflictMap.get(entry.id) || []), ...(constraintMap.get(entry.id) || [])]);
}

function getRoomDisplayName(roomId) {
  if (!roomId) return "교실 없음";
  return getRooms().find(r => r.id === roomId)?.name || roomId;
}

function getEffectiveAssignedRoomId(teacher) {
  return constraintsPanelApi?.getEffectiveAssignedRoomId(teacher) || null;
}

function getAllTimetableTeachers() {
  return constraintsPanelApi?.getAllTimetableTeachers() || [];
}

function getSelectedTeacherNames() {
  return splitTeacherNames(currentTeacher).filter(Boolean);
}

function setSelectedTeacherNames(names = []) {
  currentTeacher = [...new Set((names || []).map(clean).filter(Boolean))].join(",");
}

function entryHasAnySelectedTeacher(entry, selectedTeachers = getSelectedTeacherNames()) {
  if (!selectedTeachers.length) return false;
  const names = Array.isArray(entry?.teacherNames) && entry.teacherNames.length
    ? entry.teacherNames
    : splitTeacherNames(entry?.teacherName || "");
  return names.some(t => selectedTeachers.includes(t));
}

function getTeacherSelectorOptions() {
  return [...new Set([
    ...getAllTimetableTeachers(),
    ...entries().flatMap(e => splitTeacherNames(e.teacherName)).filter(Boolean),
  ].map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
}

function getRoomSelectorOptions() {
  return getRooms()
    .map(r => ({ id: r.id, name: r.name || r.id }))
    .filter(r => r.id)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "ko", { numeric: true }));
}

function getSelectedRoomIds() {
  return String(currentRoom || "").split(",").map(clean).filter(Boolean);
}

function setSelectedRoomIds(ids = []) {
  currentRoom = [...new Set((ids || []).map(clean).filter(Boolean))].join(",");
}

function getFirstSelectedRoomId() {
  return getSelectedRoomIds()[0] || "";
}

function ensureTeacherPickerElement(teacherEl) {
  if (!teacherEl) return null;
  let picker = $("ttTeacherPicker");
  if (!picker) {
    picker = document.createElement("div");
    picker.id = "ttTeacherPicker";
    picker.className = "tt-teacher-picker hidden";
    teacherEl.insertAdjacentElement("afterend", picker);
  }

  if (!teacherPickerOutsideHandlerInstalled) {
    teacherPickerOutsideHandlerInstalled = true;
    document.addEventListener("pointerdown", e => {
      const el = $("ttTeacherPicker");
      if (!el || el.classList.contains("hidden")) return;
      if (!el.contains(e.target)) el.classList.remove("is-open");
    });
  }
  return picker;
}

function renderTeacherMultiPicker(picker, allTeachers = [], selectedTeachers = []) {
  if (!picker) return;
  picker.innerHTML = "";

  const selected = selectedTeachers.filter(t => allTeachers.includes(t));
  const selectedSet = new Set(selected);
  const label = selected.length
    ? `교사 ${selected.length}명`
    : "교사 선택";
  const namesText = selected.length ? selected.join(", ") : "선택된 교사가 없습니다";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "tt-teacher-picker-trigger";
  trigger.innerHTML = `
    <span class="tt-teacher-picker-label">${escapeHtml(label)}</span>
    <span class="tt-teacher-picker-names">${escapeHtml(namesText)}</span>
    <span class="tt-teacher-picker-caret">⌄</span>`;

  const panel = document.createElement("div");
  panel.className = "tt-teacher-picker-panel";

  const head = document.createElement("div");
  head.className = "tt-teacher-picker-head";
  head.innerHTML = `<strong>교사 선택</strong><span>${allTeachers.length}명</span>`;

  const search = document.createElement("input");
  search.type = "search";
  search.className = "tt-teacher-picker-search";
  search.placeholder = "교사 검색";

  const list = document.createElement("div");
  list.className = "tt-teacher-picker-list";
  allTeachers.forEach(name => {
    const row = document.createElement("label");
    row.className = "tt-teacher-picker-row";
    row.dataset.teacherName = name.toLowerCase();

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = name;
    cb.checked = selectedSet.has(name);

    const text = document.createElement("span");
    text.textContent = name;
    row.append(cb, text);
    list.appendChild(row);
  });

  const actions = document.createElement("div");
  actions.className = "tt-teacher-picker-actions";
  const allBtn = makeBtn("전체", "tt-teacher-picker-mini", () => {
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
  });
  const clearBtn = makeBtn("해제", "tt-teacher-picker-mini", () => {
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  });
  const cancelBtn = makeBtn("닫기", "tt-teacher-picker-mini", () => picker.classList.remove("is-open"));
  const applyBtn = makeBtn("적용", "tt-teacher-picker-apply", () => {
    const picked = [...list.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
    if (!picked.length) {
      alert("교사를 한 명 이상 선택해 주세요.");
      return;
    }
    setSelectedTeacherNames(picked);
    picker.classList.remove("is-open");
    renderAll();
  });
  actions.append(allBtn, clearBtn, cancelBtn, applyBtn);

  search.addEventListener("input", () => {
    const q = clean(search.value).toLowerCase();
    list.querySelectorAll(".tt-teacher-picker-row").forEach(row => {
      row.hidden = q && !row.dataset.teacherName.includes(q);
    });
  });

  trigger.addEventListener("pointerdown", e => e.stopPropagation());
  trigger.addEventListener("click", e => {
    e.preventDefault();
    picker.classList.toggle("is-open");
    if (picker.classList.contains("is-open")) setTimeout(() => search.focus(), 0);
  });
  panel.addEventListener("pointerdown", e => e.stopPropagation());

  panel.append(head, search, list, actions);
  picker.append(trigger, panel);
}

function ensureRoomPickerElement(roomEl) {
  if (!roomEl) return null;
  let picker = $("ttRoomPicker");
  if (!picker) {
    picker = document.createElement("div");
    picker.id = "ttRoomPicker";
    picker.className = "tt-teacher-picker tt-room-picker hidden";
    roomEl.insertAdjacentElement("afterend", picker);
  }

  if (!roomPickerOutsideHandlerInstalled) {
    roomPickerOutsideHandlerInstalled = true;
    document.addEventListener("pointerdown", e => {
      const el = $("ttRoomPicker");
      if (!el || el.classList.contains("hidden")) return;
      if (!el.contains(e.target)) el.classList.remove("is-open");
    });
  }
  return picker;
}

function renderRoomMultiPicker(picker, rooms = [], selectedRoomIds = []) {
  if (!picker) return;
  picker.innerHTML = "";

  const validIds = new Set(rooms.map(r => r.id));
  const selected = selectedRoomIds.filter(id => validIds.has(id));
  const selectedSet = new Set(selected);
  const roomNameById = new Map(rooms.map(r => [r.id, r.name || r.id]));
  const label = selected.length ? `교실 ${selected.length}개` : "교실 선택";
  const namesText = selected.length
    ? selected.map(id => roomNameById.get(id) || id).join(", ")
    : "선택된 교실이 없습니다";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "tt-teacher-picker-trigger tt-room-picker-trigger";
  trigger.innerHTML = `
    <span class="tt-teacher-picker-label">${escapeHtml(label)}</span>
    <span class="tt-teacher-picker-names">${escapeHtml(namesText)}</span>
    <span class="tt-teacher-picker-caret">⌄</span>`;

  const panel = document.createElement("div");
  panel.className = "tt-teacher-picker-panel tt-room-picker-panel";

  const head = document.createElement("div");
  head.className = "tt-teacher-picker-head";
  head.innerHTML = `<strong>교실 선택</strong><span>${rooms.length}개</span>`;

  const search = document.createElement("input");
  search.type = "search";
  search.className = "tt-teacher-picker-search";
  search.placeholder = "교실 검색";

  const list = document.createElement("div");
  list.className = "tt-teacher-picker-list tt-room-picker-list";
  rooms.forEach(room => {
    const row = document.createElement("label");
    row.className = "tt-teacher-picker-row tt-room-picker-row";
    row.dataset.roomName = String(room.name || room.id).toLowerCase();

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = room.id;
    cb.checked = selectedSet.has(room.id);

    const text = document.createElement("span");
    text.textContent = room.name || room.id;
    row.append(cb, text);
    list.appendChild(row);
  });

  const actions = document.createElement("div");
  actions.className = "tt-teacher-picker-actions";
  const allBtn = makeBtn("전체", "tt-teacher-picker-mini", () => {
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
  });
  const clearBtn = makeBtn("해제", "tt-teacher-picker-mini", () => {
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  });
  const cancelBtn = makeBtn("닫기", "tt-teacher-picker-mini", () => picker.classList.remove("is-open"));
  const applyBtn = makeBtn("적용", "tt-teacher-picker-apply", () => {
    const picked = [...list.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
    if (!picked.length) {
      alert("교실을 한 개 이상 선택해 주세요.");
      return;
    }
    setSelectedRoomIds(picked);
    picker.classList.remove("is-open");
    renderAll();
  });
  actions.append(allBtn, clearBtn, cancelBtn, applyBtn);

  search.addEventListener("input", () => {
    const q = clean(search.value).toLowerCase();
    list.querySelectorAll(".tt-room-picker-row").forEach(row => {
      row.hidden = q && !row.dataset.roomName.includes(q);
    });
  });

  trigger.addEventListener("pointerdown", e => e.stopPropagation());
  trigger.addEventListener("click", e => {
    e.preventDefault();
    picker.classList.toggle("is-open");
    if (picker.classList.contains("is-open")) setTimeout(() => search.focus(), 0);
  });
  panel.addEventListener("pointerdown", e => e.stopPropagation());

  panel.append(head, search, list, actions);
  picker.append(trigger, panel);
}

function renderConstraintsPanel() {
  return constraintsPanelApi?.renderConstraintsPanel();
}

function syncTeacherHomeRoomFromRoom(roomId, teacherName) {
  return constraintsPanelApi?.syncTeacherHomeRoomFromRoom(roomId, teacherName);
}

function getDefaultRoomForTeacherNames(teacherNames = []) {
  const names = (teacherNames || []).map(clean).filter(Boolean);
  const fromConstraints = [...new Set(names.map(getEffectiveAssignedRoomId).filter(Boolean))];
  if (fromConstraints.length === 1) return fromConstraints[0];
  if (fromConstraints.length > 1) return null;
  const fromRooms = [...new Set(getRooms()
    .filter(r => names.includes(clean(r.teacherName)))
    .map(r => r.id)
    .filter(Boolean))];
  return fromRooms.length === 1 ? fromRooms[0] : null;
}

function classIdForAudienceClassKey(classKey = "") {
  const [gradeNo, section] = String(classKey || "").split(":");
  if (!gradeNo || !section) return "";
  const grade = `${Number(gradeNo)}학년`;
  const sec = clean(section).toUpperCase();
  const cls = (appState.classes?.classes || []).find(c =>
    c.grade === grade && clean(c.name).toUpperCase() === sec
  );
  return cls?.id || "";
}

function getHomeRoomIdForPlacementData(data = {}) {
  const classKeys = Array.isArray(data.audienceClassKeys) ? data.audienceClassKeys : [];
  const classIds = classKeys.map(classIdForAudienceClassKey).filter(Boolean);
  if (!classIds.length) return null;
  const rooms = getRooms().filter(r => r.homeRoomClassId && classIds.includes(r.homeRoomClassId));
  const roomIds = [...new Set(rooms.map(r => r.id))];
  return roomIds.length === 1 ? roomIds[0] : null;
}

function getCardPreferenceForPlacementData(data = {}) {
  const ids = [...(data.ttcardIds || []), data.ttcardId].filter(Boolean);
  const cards = ids.map(id => getTtCardById(id)).filter(Boolean);
  if (!cards.length) return { rule: "auto", fixedRoomId: null };
  const rules = [...new Set(cards.map(c => clean(c.roomRule) || "auto"))];
  const fixedIds = [...new Set(cards.map(c => clean(c.fixedRoomId)).filter(Boolean))];
  if (rules.length === 1) return { rule: rules[0] || "auto", fixedRoomId: fixedIds.length === 1 ? fixedIds[0] : null };
  if (fixedIds.length === 1 && rules.every(r => r === "auto" || r === "fixed")) return { rule: "fixed", fixedRoomId: fixedIds[0] };
  return { rule: "auto", fixedRoomId: null };
}

function resolveRoomForPlacementData(data = {}, forcedRule = null) {
  const preference = getCardPreferenceForPlacementData(data);
  const rule = clean(forcedRule || data.roomRule || preference.rule || "auto");
  const fixedRoomId = clean(data.fixedRoomId || preference.fixedRoomId);
  if (rule === "none") return null;
  if (rule === "fixed") return fixedRoomId || null;
  if (rule === "homeroom") return getHomeRoomIdForPlacementData(data);
  if (rule === "teacher") return getDefaultRoomForTeacherNames(splitTeacherNames(data.teacherName || ""));

  // auto 기본 교실 규칙:
  // 1) 카드/수업에 명시된 고정교실
  // 2) 교사 담당교실
  // 3) 해당 학급 홈룸
  // 교사 담당교실이 없는 경우에만 홈룸으로 내려갑니다.
  const teacherRoomId = getDefaultRoomForTeacherNames(splitTeacherNames(data.teacherName || ""));
  return fixedRoomId || teacherRoomId || getHomeRoomIdForPlacementData(data) || null;
}

function getDefaultRoomForPlacementData(data = {}) {
  return resolveRoomForPlacementData(data);
}

function applyDefaultRoomToEntryData(data = {}) {
  if (data.roomPinned && data.roomId) return data;
  const roomId = resolveRoomForPlacementData(data);
  data.roomRule = clean(data.roomRule || getCardPreferenceForPlacementData(data).rule || "auto");
  data.roomId = roomId || null;
  return data;
}

function setTtCardRoomPreference(cardIds = [], rule = "auto", roomId = null) {
  if (!canEdit()) return false;
  const ids = [...new Set((cardIds || []).filter(Boolean))];
  if (!ids.length) return false;
  captureTimetableUndo("과목카드 교실 설정");
  const normalizedRule = clean(rule) || "auto";
  (appState.timetable.ttcards || []).forEach(card => {
    if (!ids.includes(card.id)) return;
    card.roomRule = normalizedRule;
    card.fixedRoomId = normalizedRule === "fixed" ? (clean(roomId) || null) : null;
    card.manualEdited = true;
  });
  scheduleSave("timetable");
  return true;
}

function applyRoomRuleToEntry(entryId, rule = "auto", roomId = null) {
  if (!canEdit()) return false;
  const e = entries().find(x => x.id === entryId);
  if (!e) return false;
  captureTimetableUndo("수업 교실 설정");
  e.roomRule = clean(rule) || "auto";
  e.roomPinned = e.roomRule === "fixed";
  if (e.roomRule === "fixed") e.roomId = clean(roomId) || e.roomId || null;
  else e.roomId = resolveRoomForPlacementData(e, e.roomRule);
  scheduleSave("timetable");
  return true;
}

function getSlotLabel(day, period) {
  const dayLabels = ["월", "화", "수", "목", "금"];
  const pLabel = ttConfig().periodLabels?.[period] || `${period + 1}교시`;
  return `${dayLabels[day] ?? "?"} ${pLabel}`;
}

function formatClassLabel(gradeKey, sectionText) {
  const grade = gradeDisplay(gradeKey);
  const section = String(sectionText ?? "").trim();
  if (!section) return grade || "-";
  // 이미 7A, 10B처럼 학년 숫자가 붙어 있으면 그대로 쓰되 '학년'만 제거합니다.
  const compact = section.replace(/\s+/g, "").replace(/학년/g, "");
  if (/^\d{1,2}[A-Za-z가-힣0-9]/.test(compact)) return compact;
  return `${grade}${section}`;
}

function localUniqueStrings(list = []) {
  return [...new Set((list || []).map(clean).filter(Boolean))];
}

function formatClassLabelList(gradeKey, labels = []) {
  const rawLabels = (Array.isArray(labels) ? labels : [labels])
    .flatMap(label => String(label ?? "")
      .split(/[,，·\/]+/)
      .map(x => x.trim())
      .filter(Boolean));
  const normalized = rawLabels.length ? rawLabels : [""];
  return localUniqueStrings(normalized.map(label => formatClassLabel(gradeKey, label))).join(", ") || "-";
}

function entrySharesTeacher(a, b) {
  const aTeachers = entryTeachers(a).filter(Boolean);
  const bTeachers = entryTeachers(b).filter(Boolean);
  return aTeachers.filter(t => bTeachers.includes(t));
}

function formatGradeSetForDetail(set = new Set()) {
  return [...(set || new Set())].map(g => gradeDisplay(g)).filter(Boolean).join(", ");
}

function setIntersectionValues(a = new Set(), b = new Set()) {
  const out = [];
  for (const v of a || new Set()) if ((b || new Set()).has(v)) out.push(v);
  return out;
}

function getStudentConflictDetail(entry, other) {
  const audience = audienceForPlacement(entry);
  const otherAudience = audienceForPlacement(other);
  const detail = occConflictDetailBetween(audience, otherAudience);

  // 세부 수강명단이 양쪽 모두 있는 경우에는 학급명보다 실제 학생 교집합을 먼저 보여줍니다.
  // 같은 8A 안에서도 한국어/국어 A처럼 학생이 분리되어 있으면 충돌이 아니며,
  // 실제로 겹칠 때만 학생 수가 표시됩니다.
  if (audience.studentKeys?.size && otherAudience.studentKeys?.size && detail.studentKeys?.length) {
    return `겹치는 학생: ${detail.studentKeys.length}명`;
  }

  const classLabels = localUniqueStrings((detail.classKeys || []).map(occFormatClassLabelFromKey).filter(Boolean));
  if (classLabels.length) return `겹치는 학급: ${classLabels.join(", ")}`;

  if (detail.studentKeys?.length) return `겹치는 학생: ${detail.studentKeys.length}명`;

  const protectedA = protectedGradesForEntry(entry);
  const protectedB = protectedGradesForEntry(other);
  const otherGrades = audienceCanonicalGradeSet(otherAudience);
  const thisGrades = audienceCanonicalGradeSet(audience);
  const protectedReasons = [];
  const byA = setIntersectionValues(protectedA, otherGrades);
  const byB = setIntersectionValues(protectedB, thisGrades);
  if (byA.length) protectedReasons.push(`${entryTitle(entry)} 전체학년 보호: ${formatGradeSetForDetail(new Set(byA))}`);
  if (byB.length) protectedReasons.push(`${entryTitle(other)} 전체학년 보호: ${formatGradeSetForDetail(new Set(byB))}`);
  if (protectedReasons.length) return protectedReasons.join(" / ");

  return "학급·학생명단 겹침 없음 — 충돌 판정 데이터를 재확인하세요";
}

function getRelatedConflictEntries(entry, type) {
  const sameSlot = entries().filter(e => e.id !== entry.id && e.day === entry.day && e.period === entry.period);
  if (type === "teacher") {
    return sameSlot
      .map(e => ({ entry: e, detail: entrySharesTeacher(entry, e).join(", ") }))
      .filter(x => x.detail);
  }
  if (type === "room") {
    if (!entry.roomId) return [];
    return sameSlot
      .filter(e => e.roomId && e.roomId === entry.roomId)
      .map(e => ({ entry: e, detail: getRoomDisplayName(entry.roomId) }));
  }
  if (type === "student") {
    return sameSlot
      .filter(e => (conflictMap.get(e.id) || new Set()).has("student"))
      .map(e => ({ entry: e, detail: getStudentConflictDetail(entry, e) }))
      .filter(x => x.detail);
  }
  if (type === "syncRequired" && entry.groupId) {
    return entries()
      .filter(e => e.id !== entry.id && e.groupId === entry.groupId)
      .map(e => ({ entry: e, detail: getSlotLabel(e.day, e.period) }));
  }
  return [];
}

function getConstraintConflictMessage(type, entry) {
  const teachers = entryTeachers(entry).join(", ") || "담당 교사";
  if (type === "roomMissing") return "이 수업에는 교실이 배정되지 않았습니다. 상세보기 또는 우클릭 메뉴에서 교실을 지정해 주세요.";
  if (type === "unavailable") return `${teachers} 선생님의 수업 불가 시간으로 설정되어 있습니다.`;
  if (type === "maxConsecutive") return `${teachers} 선생님의 연속 수업 제한을 초과했습니다.`;
  if (type === "maxPerDay") return `${teachers} 선생님의 일일 수업 수 제한을 초과했습니다.`;
  if (type === "maxPerWeek") return `${teachers} 선생님의 주간 수업 수 제한을 초과했습니다.`;
  return "시간표 제약 조건을 확인해야 합니다.";
}

function renderEntryConflictDetailSection(box, entry) {
  const conflicts = getEntryConflictSet(entry);
  const conflictTypes = getOrderedConflictTypes(conflicts);

  const section = document.createElement("div");
  section.style.cssText = "margin:10px 0 10px;padding:10px;border-radius:9px;border:1px solid #e2e8f0;background:#f8fafc";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px";
  const title = document.createElement("div");
  title.style.cssText = "font-size:12px;font-weight:800;color:#334155";
  title.textContent = "충돌 내역";
  header.appendChild(title);

  if (!conflictTypes.length) {
    const ok = document.createElement("span");
    ok.style.cssText = "display:inline-flex;align-items:center;border-radius:999px;background:#dcfce7;color:#166534;font-size:10px;font-weight:800;padding:2px 7px";
    ok.textContent = "충돌 없음";
    header.appendChild(ok);
    section.appendChild(header);
    const desc = document.createElement("div");
    desc.style.cssText = "font-size:11px;color:#64748b;line-height:1.45";
    desc.textContent = "현재 선택한 수업에는 교사, 교실, 학생, 제약 조건 충돌이 없습니다.";
    section.appendChild(desc);
    box.appendChild(section);
    return;
  }

  const chipWrap = document.createElement("div");
  chipWrap.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end";
  conflictTypes.forEach(type => {
    const meta = CONFLICT_DISPLAY[type];
    if (!meta) return;
    const chip = document.createElement("span");
    chip.style.cssText = `display:inline-flex;align-items:center;border-radius:999px;background:${meta.color};color:white;font-size:10px;font-weight:900;padding:2px 7px;white-space:nowrap`;
    chip.textContent = meta.label;
    chipWrap.appendChild(chip);
  });
  header.appendChild(chipWrap);
  section.appendChild(header);

  const list = document.createElement("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:6px";

  conflictTypes.forEach(type => {
    const meta = CONFLICT_DISPLAY[type];
    if (!meta) return;
    const item = document.createElement("div");
    item.style.cssText = `border-left:4px solid ${meta.color};background:white;border-radius:7px;padding:7px 8px;box-shadow:0 0 0 1px #e2e8f0 inset`;

    const top = document.createElement("div");
    top.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px";
    const badge = document.createElement("span");
    badge.style.cssText = `display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;border-radius:4px;background:${meta.color};color:white;font-size:10px;font-weight:900`;
    badge.textContent = meta.short;
    const label = document.createElement("span");
    label.style.cssText = "font-size:12px;font-weight:800;color:#1e293b";
    label.textContent = meta.label;
    top.append(badge, label);
    item.appendChild(top);

    const related = getRelatedConflictEntries(entry, type);
    const body = document.createElement("div");
    body.style.cssText = "font-size:11px;color:#475569;line-height:1.45";

    if (["teacher", "room", "student", "syncRequired"].includes(type)) {
      if (related.length) {
        const ul = document.createElement("ul");
        ul.style.cssText = "margin:0;padding-left:16px";
        related.slice(0, 6).forEach(({ entry: other, detail }) => {
          const li = document.createElement("li");
          li.textContent = `${entryTitle(other)} · ${getEntryClassSummary(other)} · ${getSlotLabel(other.day, other.period)}${detail ? ` (${detail})` : ""}`;
          ul.appendChild(li);
        });
        if (related.length > 6) {
          const li = document.createElement("li");
          li.textContent = `외 ${related.length - 6}건 더 있음`;
          ul.appendChild(li);
        }
        body.appendChild(ul);
      } else if (type === "syncRequired") {
        body.textContent = "동시배정 그룹의 구성 카드가 같은 요일·교시에 배치되어야 합니다.";
      } else {
        body.textContent = `${meta.label} 충돌이 감지되었습니다. 같은 시간대의 배정 정보를 확인해 주세요.`;
      }
    } else {
      body.textContent = getConstraintConflictMessage(type, entry);
    }

    item.appendChild(body);
    list.appendChild(item);
  });

  section.appendChild(list);
  box.appendChild(section);
}

// ── Entry CRUD ────────────────────────────────────────────────────
function addEntry(data) {
  if (!canEdit()) return null;
  const e = normalizeTimetableEntry({ id: uid("ent"), ...applyDefaultRoomToEntryData(data) });
  if (!e.templateId) return null;

  // 수동 드래그 배치는 충돌이 있어도 먼저 허용합니다.
  // 이후 recomputeConflicts()에서 교사/교실/학생/동시배정/제약 충돌을 색상 배지로 표시합니다.
  // 자동배치는 기존처럼 배치 가능 여부를 사전에 검사합니다.
  captureTimetableUndo("수업 추가");
  entries().push(e); scheduleSave("timetable"); return e;
}
function removeEntry(id) {
  if (!canEdit()) return;
  captureTimetableUndo("수업 삭제");
  ttDomain().entries = entries().filter(e => e.id !== id);
  scheduleSave("timetable");
}
function updateEntry(id, field, value) {
  if (!canEdit()) return;
  const e = entries().find(e => e.id === id); if (!e) return;
  if (e[field] === value) return;
  captureTimetableUndo("수업 수정");
  e[field] = value; scheduleSave("timetable");
}
function updatePeriodLabel(idx, value) {
  if (!canEdit()) return;
  if (ttConfig().periodLabels[idx] === value) return;
  captureTimetableUndo("교시명 수정");
  ttConfig().periodLabels[idx] = value; scheduleSave("timetable");
}
function setPeriodCount(n) {
  if (!canEdit()) return;
  const count = Math.max(1, Math.min(12, n));
  if (ttConfig().periodCount === count) return;
  captureTimetableUndo("교시 수 수정");
  const labels = Array.from({ length: count }, (_, i) => ttConfig().periodLabels[i] || `${i + 1}교시`);
  ttConfig().periodCount = count; ttConfig().periodLabels = labels;
  scheduleSave("timetable");
}
function setLunchConfig(afterPeriod, show) {
  if (!canEdit()) return;
  captureTimetableUndo("점심시간 설정 수정");
  if (afterPeriod !== undefined) ttConfig().lunchAfterPeriod = afterPeriod;
  if (show !== undefined) ttConfig().showLunch = show;
  scheduleSave("timetable");
}

// ── Data helpers ──────────────────────────────────────────────────
function placeGroupAt(groupId, day, period) {
  const grp = (appState.timetable.ttcardGroups || []).find(g => g.id === groupId);
  if (!grp) return false;

  // 그룹카드는 화면에서 하나의 카드로 보이므로, 배치도 하나의 aggregate entry로 저장합니다.
  // 이렇게 해야 7AB/8AB/9AB 같은 그룹에서 특정 반(예: 8B)이 누락되지 않고
  // 상세정보·전체반 시간표·자동배치가 같은 기준(ttcardIds 전체)을 보게 됩니다.
  const cards = getGroupCards(grp);
  const data = buildEntryDataFromTtCards(cards, { day, period, groupId: grp.id, groupName: grp.name || "" });
  if (!data) return false;
  return !!addEntry(data);
}

// ── Unit helpers ──────────────────────────────────────────────────
/** Find the group and unit that contains this templateId */
function buildSchedulableItems() {
  const ttcards = getTtCards();
  const ttcardMap = new Map(ttcards.map(c => [c.id, c]));

  const standalone = [];
  const groupBlocks = [];
  const groupedCardIds = new Set();

  // ── Group blocks: one visible group card = one schedulable aggregate item ──
  (appState.timetable.ttcardGroups || []).forEach(group => {
    const groupCards = getGroupCards(group);
    if (!groupCards.length) return;
    groupCards.forEach(c => groupedCardIds.add(c.id));

    const credits = Math.max(1, ...groupCards.map(getCreditsForTtCard).filter(v => v > 0));
    const teachers = [...new Set(groupCards.flatMap(getTeachersForTtCard).filter(Boolean))].join(",");
    groupBlocks.push({
      group,
      unitItems: [{
        kind: "group",
        unit: null,
        ttcards: groupCards,
        credits,
        teachers,
        name: group.name || "그룹 카드"
      }]
    });
  });

  // Set of templateIds covered by legacy template-based units
  const templateIdsInUnits = new Set(
    (appState.timetable.ttcardGroups || []).flatMap(g => (g.units || []).flatMap(u => u.templateIds || []))
  );

  // ── Standalone ttcards (not in any group pool/unit) ──────────────
  ttcards.forEach(card => {
    if (groupedCardIds.has(card.id)) return;
    const credits = getCreditsForTtCard(card);
    if (!credits) return;
    const teacher = getTeachersForTtCard(card).filter(Boolean).join(",");
    for (let i = 0; i < credits; i++) {
      standalone.push({ kind: "standalone", ttcardId: card.id, ttcardIds: [card.id],
        templateId: card.templateId, templateIds: [card.templateId], sectionIdx: card.sectionIdx,
        gradeKey: card.gradeKey, gradeKeys: [card.gradeKey], teacherName: teacher,
        groupId: null
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
  conflictMap   = detectConflicts(
    entries(),
    appState.timetable.ttcardGroups,
    [],
    audienceForPlacement,
    {
      getProtectedGrades: protectedGradesForEntry,
      getCompoundPartRefs: compoundPartRefsForPlacement
    }
  );
  constraintMap = detectConstraintViolations(entries(), constraints());
}

// ── Grid rendering ────────────────────────────────────────────────
function renderGrid() {
  renderTimetableGrid({
    wrap: ttGrid(),
    currentView,
    currentGrade,
    currentTeacher,
    currentRoom,
    periods: ttConfig().periodLabels,
    entries: entries(),
    getDragData: () => dragData,
    setDragData: value => { dragData = value; },
    handleDrop,
    updatePeriodLabel,
    buildEntryCard,
    getGradeColor,
    showEntryDetail,
    showEntryContextMenu,
    getEntryConflictSet,
    getRoomDisplayName,
    renderAll: () => renderAll(),
    getGroupNameById: id => (appState.timetable.ttcardGroups || []).find(g => g.id === id)?.name || "",
  });
}

// ── Common entry helpers ──────────────────────────────────────────
function ttCardIdsFromPlacement(x = {}) {
  return occTtCardIdsFromPlacement(x);
}

function compoundPartRefsForPlacement(x = {}) {
  const refs = [];
  ttCardIdsFromPlacement(x).forEach(cardId => {
    const card = getTtCardById(cardId);
    if (!card?.compoundParentTemplateId || !card?.compoundPartId) return;
    refs.push({
      key: `${card.gradeKey || ""}::${card.sectionIdx ?? 0}::${card.compoundParentTemplateId}`,
      partId: card.compoundPartId,
      cardId: card.id
    });
  });
  if (!refs.length && x.compoundParentTemplateId && x.compoundPartId) {
    refs.push({
      key: `${x.gradeKey || ""}::${x.sectionIdx ?? 0}::${x.compoundParentTemplateId}`,
      partId: x.compoundPartId,
      cardId: x.ttcardId || ""
    });
  }
  return refs;
}

function audienceForPlacement(x = {}) {
  const audience = getEntryOccupancy(x, {
    getTtCardById,
    templateGroups: appState.timetable?.ttcardGroups || []
  });

  // 전체학년/채플/창체 카드의 오래된 저장값에 특정 반(A)만 남아 있으면
  // 자동배치가 해당 수업을 한 반 수업으로 오해합니다.
  // timetable-data의 현재 학급 기준 classLabels를 다시 합쳐 자동배치/충돌 기준을 보정합니다.
  ttCardIdsFromPlacement(x).forEach(id => {
    const card = getTtCardById(id);
    if (!card) return;
    const whole = !!card.isWholeGrade || isProtectedWholeGradeLabel(
      card.subject, card.subjectEn, card.label, card.category, card.track, card.group, card.nameKo, card.nameEn
    );
    if (!whole) return;
    getTtCardClassLabels(card).forEach(label => {
      const key = occNormalizeClassKey(label, card.gradeKey);
      if (key) {
        audience.classKeys.add(key);
        audience.classLabels.add(occFormatClassLabelFromKey(key));
      }
    });
  });

  return audience;
}

function setsIntersect(a, b) {
  return occSetsIntersect(a, b);
}

function audienceGradeSet(a = {}) {
  return occAudienceGradeSet(a);
}

function audiencesConflict(a, b) {
  return occAudiencesConflict(a, b);
}

function getEntryProtectionText(entry = {}) {
  const parts = [entry.label, entry.subject, entry.category, entry.track, entry.group, entry.teacherName];

  if (entry.groupId) {
    const grp = (appState.timetable?.ttcardGroups || []).find(g => g.id === entry.groupId);
    parts.push(grp?.name);
  }

  ttCardIdsFromPlacement(entry).forEach(id => {
    const card = getTtCardById(id);
    if (!card) return;
    parts.push(card.label, card.subject, card.subjectEn, card.category, card.track, card.group);
  });

  entryTemplateIds(entry).forEach(templateId => {
    const tpl = getTemplateById(templateId);
    parts.push(getTemplateCardTitle(tpl), tpl?.nameKo, tpl?.nameEn);
    (entryGradeKeys(entry).length ? entryGradeKeys(entry) : [entry.gradeKey]).filter(Boolean).forEach(gradeKey => {
      parts.push(getCategoryForTemplate(gradeKey, templateId));
      parts.push(getTrackForTemplate(gradeKey, templateId));
      parts.push(getGroupNameForTemplate(gradeKey, templateId));
    });
  });

  return parts.map(clean).filter(Boolean).join(" ");
}

function isProtectedPinnedEntry(entry = {}) {
  return !!entry.pinned && isProtectedWholeGradeLabel(getEntryProtectionText(entry));
}

function extractGradeKeysFromProtectionText(text = "") {
  const compact = clean(text);
  const found = new Set();
  GRADE_KEYS.forEach(g => {
    const n = gradeDisplay(g);
    const re = new RegExp(`(^|[^0-9])${n}\\s*(학년|grade|G)?(?=$|[^0-9])`, "i");
    if (re.test(compact)) found.add(g);
  });
  if (/(중등|middle|MS|junior)/i.test(compact)) ["7학년", "8학년", "9학년"].forEach(g => found.add(g));
  if (/(고등|high|HS|senior)/i.test(compact)) ["10학년", "11학년", "12학년"].forEach(g => found.add(g));
  return found;
}

function canonicalGradeKey(value) {
  const raw = clean(value);
  if (!raw) return "";
  return GRADE_KEYS.find(g => gradeDisplay(g) === gradeDisplay(raw)) || raw;
}

function audienceCanonicalGradeSet(audience = {}) {
  const out = new Set();
  audienceGradeSet(audience).forEach(g => {
    const key = canonicalGradeKey(g);
    if (key) out.add(key);
  });
  return out;
}

function protectedGradesForEntry(entry = {}) {
  const text = getEntryProtectionText(entry);
  if (!isProtectedWholeGradeLabel(text)) return new Set();

  const grades = new Set();
  audienceCanonicalGradeSet(audienceForPlacement(entry)).forEach(g => grades.add(g));
  entryGradeKeys(entry).forEach(g => {
    const key = canonicalGradeKey(g);
    if (key) grades.add(key);
  });
  extractGradeKeysFromProtectionText(text).forEach(g => {
    const key = canonicalGradeKey(g);
    if (key) grades.add(key);
  });
  return grades;
}

function isProtectedBlockingEntry(entry = {}) {
  return protectedGradesForEntry(entry).size > 0;
}

function protectedSlotConflict(candidate = {}, day = candidate.day, period = candidate.period, options = {}) {
  const excludeIds = new Set(options.excludeIds || []);
  const existing = [...entries(), ...(options.placed || [])];
  const slotEntries = existing.filter(e => e && e.day === day && e.period === period && !excludeIds.has(e.id));
  if (!slotEntries.length) return null;

  const candidateWithSlot = { ...candidate, day, period };
  const candidateAudience = audienceForPlacement(candidateWithSlot);
  const candidateGrades = audienceCanonicalGradeSet(candidateAudience);
  const candidateProtectedGrades = protectedGradesForEntry(candidateWithSlot);

  for (const fixed of slotEntries) {
    const fixedProtectedGrades = protectedGradesForEntry(fixed);
    if (!candidateProtectedGrades.size && !fixedProtectedGrades.size) continue;

    const fixedAudience = audienceForPlacement(fixed);
    const fixedGrades = audienceCanonicalGradeSet(fixedAudience);

    // 채플/창체/전체학년 수업은 학생명단 키가 불완전해도 학년·반 범위가 겹치면 막습니다.
    if (audiencesConflict(candidateAudience, fixedAudience)) {
      return { entry: fixed, reason: "audience" };
    }
    if (fixedProtectedGrades.size && setsIntersect(candidateGrades, fixedProtectedGrades)) {
      return { entry: fixed, reason: "protected-fixed-grade" };
    }
    if (candidateProtectedGrades.size && setsIntersect(candidateProtectedGrades, fixedGrades)) {
      return { entry: fixed, reason: "protected-candidate-grade" };
    }
  }
  return null;
}

function alertProtectedSlot(block) {
  const name = block?.entry ? entryTitle(block.entry) : "고정 수업";
  alert(`이 시간에는 고정된 전체학년 수업(${name})이 있어 다른 과목을 배치할 수 없습니다.`);
}

const MANUAL_BLOCKING_CONFLICTS = new Set(["teacher", "room", "student"]);

function getManualPlacementBlock(candidates, options = {}) {
  const candidateList = (Array.isArray(candidates) ? candidates : [candidates])
    .filter(Boolean)
    .map((candidate, idx) => normalizeTimetableEntry({
      ...candidate,
      id: candidate.id || `__manual_candidate_${idx}`
    }));

  if (!candidateList.length) return null;

  const excludeIds = new Set(options.excludeIds || []);
  for (const candidate of candidateList) {
    const protectedBlock = protectedSlotConflict(candidate, candidate.day, candidate.period, { excludeIds });
    if (protectedBlock) return { kind: "protected", block: protectedBlock, candidate };
  }

  const baseEntries = entries().filter(e => !excludeIds.has(e.id));
  for (const candidate of candidateList) {
    const conflictResult = detectConflicts(
      [...baseEntries, candidate],
      appState.timetable.ttcardGroups,
      [],
      audienceForPlacement,
      { getProtectedGrades: protectedGradesForEntry }
    );
    const blockingTypes = [...(conflictResult.get(candidate.id) || [])]
      .filter(type => MANUAL_BLOCKING_CONFLICTS.has(type));
    if (blockingTypes.length) {
      return { kind: "conflict", candidate, conflictTypes: blockingTypes };
    }
  }

  return null;
}

function alertManualPlacementBlock(block) {
  if (!block) return;
  if (block.kind === "protected") {
    alertProtectedSlot(block.block);
    return;
  }
  const label = getConflictLabel(new Set(block.conflictTypes || [])) || "충돌";
  const title = block.candidate ? entryTitle(block.candidate) : "수업";
  alert(`배치할 수 없습니다.\n${title} 수업이 같은 시간대의 기존 수업과 충돌합니다.\n충돌 유형: ${label}`);
}

function getEntryClassSummary(entry) {
  const cardIds = ttCardIdsFromPlacement(entry);
  const parts = [];
  const seen = new Set();

  const addLabel = (gradeKey, label) => {
    const txt = formatClassLabel(gradeKey, label);
    if (txt && !seen.has(txt)) { seen.add(txt); parts.push(txt); }
  };

  if (cardIds.length) {
    cardIds.forEach(id => {
      const card = getTtCardById(id);
      if (!card) return;
      const labels = getTtCardClassLabels(card);
      const targets = labels.length ? labels : [sectionLabel(card.sectionIdx ?? 0)];
      targets.forEach(label => addLabel(card.gradeKey, label));
    });
  }

  if (parts.length) return parts.join(", ");
  entryGradeKeys(entry).forEach(g => addLabel(g, sectionLabel(entry.sectionIdx ?? 0)));
  return parts.join(", ") || "-";
}


const ttDetailHandlers = createTimetableDetailHandlers({
  entries,
  ttConfig,
  currentGrade: () => currentGrade,
  getGradeColor,
  getEntryClassSummary,
  renderEntryConflictDetailSection,
  removeEntry,
  updateEntry,
  moveEntry,
  recomputeConflicts,
  renderAll: () => renderAll(),
  captureTimetableUndo: (...args) => captureTimetableUndo(...args),
  resolveRoomForPlacementData,
  getHomeRoomIdForPlacementData,
  getDefaultRoomForTeacherNames,
  setTtCardRoomPreference,
  applyRoomRuleToEntry,
  getRoomDisplayName,
});

const {
  showSidebarCardDetail,
  showEntryDetailByUnit,
  showEntryContextMenu,
  showSubjectAssignmentHistory,
  highlightSidebarCard,
  showEntryDetail,
} = ttDetailHandlers;

function buildEntryCard(entry, opts = {}) {
  const { compact = false, showGrade = false } = opts;
  const title     = entryTitle(entry);
  const teachers  = entryTeachers(entry);
  const displayGrades = entryGradeKeys(entry);

  const conflicts = new Set([...(conflictMap.get(entry.id) || []), ...(constraintMap.get(entry.id) || [])]);
  const conflictTypes = getOrderedConflictTypes(conflicts);
  const hasConflict = conflictTypes.length > 0;

  const card = document.createElement("div");
  card.className = "tt-entry-card" + (hasConflict ? " tt-entry-conflict" : "") + (entry.pinned ? " tt-entry-pinned" : "");

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

  // 카드 레이아웃: 1행 과목명+핀, 2행 교사, 3행 교실
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.style.justifyContent = "center";
  card.style.textAlign = "center";
  card.style.padding = compact ? "2px 4px" : "4px 6px";

  const row1 = document.createElement("div");
  row1.className = "tt-entry-row1 tt-entry-subject-row";
  row1.style.cssText = "position:relative;display:flex;align-items:flex-start;justify-content:center;width:100%;min-height:0;padding-right:14px;box-sizing:border-box;";

  const titleEl = document.createElement("div");
  titleEl.className = "tt-entry-title";
  titleEl.textContent = title;
  titleEl.style.cssText = "width:100%;min-width:0;text-align:center;font-weight:900;font-size:clamp(8px,0.72vw,11px);line-height:1.08;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;";
  row1.appendChild(titleEl);

  if (isMulti) {
    const cnt = document.createElement("span");
    cnt.className = "tt-entry-multi-cnt";
    cnt.textContent = `×${grpEntries.length}`;
    cnt.style.cssText = "position:absolute;right:13px;top:0;font-size:clamp(6px,0.55vw,8px);font-weight:900;line-height:1;opacity:.85;";
    row1.appendChild(cnt);
  }

  if (entry.pinned) {
    const pin = document.createElement("span");
    pin.className = "tt-entry-pin2";
    pin.textContent = "📌";
    pin.title = "고정된 수업";
    pin.style.cssText = "position:absolute;right:0;top:-1px;font-size:clamp(8px,0.7vw,11px);line-height:1;";
    row1.appendChild(pin);
  }

  const row2 = document.createElement("div");
  row2.className = "tt-entry-row2 tt-entry-teacher-row";
  row2.style.cssText = "display:block;width:100%;min-width:0;margin-top:1px;text-align:center;line-height:1.05;";
  const teacherEl = document.createElement("div");
  teacherEl.className = "tt-entry-teacher2";
  teacherEl.textContent = [...new Set(teachers)].slice(0, 2).join(", ") || "";
  teacherEl.title = [...new Set(teachers)].join(", ");
  teacherEl.style.cssText = "width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:clamp(6.5px,0.58vw,8.5px);font-weight:800;line-height:1.05;opacity:.82;";
  row2.appendChild(teacherEl);

  const row3 = document.createElement("div");
  row3.className = "tt-entry-room-row";
  row3.style.cssText = "display:block;width:100%;min-width:0;margin-top:1px;text-align:center;line-height:1.05;";
  if (entry.roomId) {
    const roomBadge = document.createElement("div");
    roomBadge.className = "tt-entry-room2";
    roomBadge.textContent = getRoomDisplayName(entry.roomId);
    roomBadge.title = `교실: ${getRoomDisplayName(entry.roomId)}`;
    roomBadge.style.cssText = "display:block;width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:clamp(6px,0.54vw,8px);font-weight:900;line-height:1.05;opacity:.92;";
    row3.appendChild(roomBadge);
  }

  card.append(row1, row2, row3);
  if (hasConflict) applyConflictVisuals(card, conflictTypes, conflicts);

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
    writeDragDataToEvent(ev, dragData, "move");
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
  if (e.day === day && e.period === period) return;
  // If entry has groupId or unitId, move ALL sibling entries to same slot
  const siblings = (e.groupId || e.unitId) ? entries().filter(x =>
    x.id !== entryId && !x.pinned &&
    ((e.groupId && x.groupId === e.groupId) || (e.unitId && x.unitId === e.unitId)) &&
    x.day === e.day && x.period === e.period
  ) : [];

  // 수업 이동도 충돌이 있어도 허용하고, 이동 후 충돌 표시로 확인하게 합니다.
  captureTimetableUndo("수업 이동");
  siblings.forEach(s => { s.day = day; s.period = period; });
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

  // 2. Whole group drop: place all 구성 카드 in the same slot while preserving each card's grade/section.
  if (data.kind === "group" && data.groupId) {
    if (placeGroupAt(data.groupId, day, period)) {
      recomputeConflicts(); renderAll();
    }
    return;
  }

  // 3. Unit drop (묶음수업): place all ttcards in the unit together.
  if (data.unitId) {
    const grp  = (appState.timetable.ttcardGroups || []).find(g => g.id === data.groupId);
    const unit = grp?.units?.find(u => u.id === data.unitId);
    if (grp && unit) {
      const ttcards = (unit.ttcardIds || []).map(id => getTtCardById(id)).filter(Boolean);
      const entryData = buildEntryDataFromTtCards(ttcards, { day, period, groupId: grp.id, unitId: unit.id, groupName: grp.name || "" });
      if (entryData) {
        addEntry(entryData);
        recomputeConflicts(); renderAll(); return;
      }
    }
  }

  // 4. Single ttcard drop.
  if (data.ttcardId) {
    const card = getTtCardById(data.ttcardId);
    if (card) {
      const entryData = buildEntryDataFromTtCards([card], { day, period, groupId: data.groupId || null, groupName: data.groupName || "" });
      if (entryData) {
        addEntry(entryData);
        recomputeConflicts(); renderAll(); return;
      }
    }
  }

  // 5. Legacy templateId fallback
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
const ttSidebarHandlers = createTimetableSidebarHandlers({
  GRADE_KEYS, appState, entries, $, makeBtn, canEdit, clean,
  getTemplateById, getTemplateCardTitle,
  getTtCards, getTtCardById, refreshTtCardData,
  getGroupCards, getCreditsForTtCard, getTeachersForTtCard, getTtCardClassLabels, describeTtCard, calculateClassCreditSummary,
  getSubjectsForGrade, getUnitForTemplate, getUnitDisplayTitle, getUnitGradeKeys, getUnitTeachers,
  getCreditsForTemplate, getTeachersForTemplate, getSectionCount, entryTemplateIds, entryHasGrade,
  getGradeColor, gradeDisplay, sectionLabel,
  showSidebarCardDetail, showEntryDetailByUnit,
  renderAll: () => renderAll(),
  setDragData: value => { dragData = value; },
  scheduleSave,
});

function renderSubjectPanel() {
  return ttSidebarHandlers.renderSubjectPanel();
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
  // Teacher selector: use a compact custom multi-select picker instead of a native multi-select box.
  let teacherPicker = null;
  if (teacherEl) {
    teacherEl.innerHTML = "";
    teacherEl.multiple = true;
    teacherEl.classList.add("hidden");
    teacherPicker = ensureTeacherPickerElement(teacherEl);

    const allTeachers = getTeacherSelectorOptions();
    let selectedTeachers = getSelectedTeacherNames().filter(t => allTeachers.includes(t));
    if (!selectedTeachers.length && allTeachers.length) selectedTeachers = [allTeachers[0]];
    setSelectedTeacherNames(selectedTeachers);

    allTeachers.forEach(t => {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      if (selectedTeachers.includes(t)) o.selected = true;
      teacherEl.appendChild(o);
    });
    renderTeacherMultiPicker(teacherPicker, allTeachers, selectedTeachers);
  }
  // Room selector: use the same compact custom multi-select picker as teacher view.
  let roomPicker = null;
  if (roomEl) {
    roomEl.innerHTML = "";
    const rooms = getRooms();
    const validRoomIds = new Set(rooms.map(r => r.id));
    let selectedRoomIds = getSelectedRoomIds().filter(id => validRoomIds.has(id));
    if (!selectedRoomIds.length && rooms.length) selectedRoomIds = [rooms[0].id];
    setSelectedRoomIds(selectedRoomIds);
    rooms.forEach(r => {
      const o = document.createElement("option");
      o.value = r.id;
      o.textContent = r.name;
      if (selectedRoomIds.includes(r.id)) o.selected = true;
      roomEl.appendChild(o);
    });
    roomEl.onchange = e => { setSelectedRoomIds([e.target.value]); renderAll(); };
    roomEl.classList.add("hidden");
    roomPicker = ensureRoomPickerElement(roomEl);
    renderRoomMultiPicker(roomPicker, getRoomSelectorOptions(), getSelectedRoomIds());
  }
  // Show/hide
  gradeEl?.classList.toggle("hidden", currentView !== "grade" && currentView !== "class");
  teacherEl?.classList.add("hidden");
  $("ttTeacherPicker")?.classList.toggle("hidden", currentView !== "teacher");
  roomEl?.classList.add("hidden");
  roomPicker?.classList.toggle("hidden", currentView !== "room");
  // In all-grades view, hide the subject panel (it's grade-specific)
  const panelEl = document.querySelector(".tt-panel");
}

// ── Conflict summary bar ──────────────────────────────────────────
function renderConflictBar() {
  const bar = $("ttConflictBar"); if (!bar) return;
  const { counts, totalAffected } = getConflictCounts();
  bar.className = "tt-conflict-bar " + (totalAffected > 0 ? "tt-conflict-bar-warn" : "tt-conflict-bar-ok");
  bar.style.cursor = "pointer";
  bar.title = "클릭하면 하단 로그 탭에서 상세 충돌 내역을 볼 수 있습니다.";
  bar.onclick = () => activateBottomTab("logs");

  if (totalAffected <= 0) {
    bar.textContent = "✅ 충돌 없음";
    return;
  }

  const chips = CONFLICT_PRIORITY
    .filter(type => counts[type] > 0)
    .map(type => `<span class="tt-conflict-chip" data-type="${type}">${CONFLICT_DISPLAY[type].label} ${counts[type]}</span>`)
    .join("");
  bar.innerHTML = `<span class="tt-conflict-summary-label">⚠️ 충돌 ${totalAffected}건</span>${chips}`;
}


constraintsPanelApi = createTimetableConstraintsHandlers({
  appState,
  entries,
  constraints,
  ttConfig,
  getRooms,
  clean,
  splitTeacherNames,
  makeBtn,
  canEdit,
  scheduleSave,
  captureTimetableUndo,
  recomputeConflicts,
  renderAll: () => renderAll(),
  getConstraintMap: () => constraintMap,
  $
});

({ addTimetableLog, setLastAutoAssignReport, getConflictCounts, renderLogPanel } = createTimetableLogHandlers({
  entries,
  ttConfig,
  uid,
  escapeHtml,
  $,
  getEntryConflictSet,
  getOrderedConflictTypes,
  CONFLICT_DISPLAY,
  CONFLICT_PRIORITY,
  getRelatedConflictEntries,
  entryTitle,
  getEntryClassSummary,
  getConstraintConflictMessage,
  entryTeachers,
  getRoomDisplayName,
  getConflictLabel,
  recomputeConflicts
}));


// ── Auto-assign ───────────────────────────────────────────────────
const shuffle = arr => { const a = [...arr]; for (let i = a.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };

export const autoAssignAll = createAutoAssignAll({
  GRADE_KEYS, canEdit, appState, scheduleSave, normalizeTimetableEntry,
  uid, sectionLabel, gradeDisplay, splitTeacherNames,
  getTemplateById, getTemplateCardTitle, getTtCardById,
  describeTtCard, makePlacementFromGroupItem, getSubjectsForGrade, getCreditsForTtCard,
  entries, ttDomain, ttConfig, constraints,
  buildSchedulableItems, getEffectiveAssignedRoomId, applyDefaultRoomToEntryData,
  audienceForPlacement, audiencesConflict, ttCardIdsFromPlacement, protectedSlotConflict,
  shuffle, captureTimetableUndo, addTimetableLog, setLastAutoAssignReport,
  getConflictCounts, recomputeConflicts, renderAll, $
});

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

  const constraintsEl = $("ttConstraintsContent");
  if (isVisible(constraintsEl)) {
    subscribeOptionalTimetableDomains();
    renderConstraintsPanel();
  }

  renderConflictBar();

  const roomsEl = $("ttRoomsContent");
  if (isVisible(roomsEl)) {
    subscribeOptionalTimetableDomains();
    renderRoomsView(roomsEl, renderAll, {
      teacherNames: getAllTimetableTeachers(),
      entries: entries(),
      periodLabels: ttConfig().periodLabels,
      periodCount: ttConfig().periodCount,
      dayLabels: ["월", "화", "수", "목", "금"],
      getEntryTitle: entryTitle,
      getEntryClassSummary,
      onTeacherRoomChange: (roomId, teacherName) => {
        captureTimetableUndo("교실 담당 교사 수정");
        syncTeacherHomeRoomFromRoom(roomId, teacherName);
        recomputeConflicts();
      }
    });
  }

  const logsEl = $("ttLogsContent");
  if (isVisible(logsEl)) renderLogPanel();
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
const authUi = createTimetableAuthUi({
  statusEl: ttAuthStatus,
  loginBtn: ttLoginBtn,
  logoutBtn: ttLogoutBtn,
});
const setAuthCheckingUI = authUi.setAuthCheckingUI;
const updateAuthUI = authUi.updateAuthUI;

// ── Excel Export ──────────────────────────────────────────────────
function exportXlsx() {
  exportTimetableXlsx({
    GRADE_KEYS,
    entries,
    ttConfig,
    splitTeacherNames,
    entryHasGrade,
    entryTitle,
    entryGradeKeys,
    gradeDisplay,
    getRooms,
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────
let _renderAllTimer = null;
function requestRenderAll() {
  clearTimeout(_renderAllTimer);
  _renderAllTimer = setTimeout(() => renderAll(), 50);
}
setOnUpdate(domain => {
  const knownDomains = ["templates","classes","teachers","rosters","rooms","timetable","all"];
  if (knownDomains.includes(domain)) requestRenderAll();
});

setupTtSaveQuotaControls();
setupTtSaveStatusHandler();
setAuthCheckingUI();

onAuth(async (user) => {
  updateAuthUI(user);
  if (user) {
    try {
      await migrateFromLegacy();  // 마이그레이션 먼저 — 빈 문서 생성 방지
    } catch (e) {
      console.warn("Migration skipped; continuing timetable load.", e);
    } finally {
      // 시간표 하단바의 교실 관리와 카드 재생성을 위해 원본 도메인 전체를 구독합니다.
      subscribeTimetablePageDomains();
    }
  } else {
    unsubscribeAll(); renderAll();
  }
});

// View buttons
document.querySelectorAll(".tt-view-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tt-view-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentView = btn.dataset.view;
    if (currentView === "room") subscribeOptionalTimetableDomains();
    renderAll();
  });
});

// Lazy-load optional data only when the related bottom tab is opened.
document.querySelectorAll(".tt-bottom-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tt-bottom-tab-btn").forEach(b => b.classList.toggle("active", b === btn));
    const tabMap = { subjects:"ttSubjectsContent", constraints:"ttConstraintsContent", rooms:"ttRoomsContent", logs:"ttLogsContent" };
    Object.entries(tabMap).forEach(([key, id]) => $(id)?.classList.toggle("hidden", key !== tab));
    if (tab === "constraints" || tab === "rooms") subscribeOptionalTimetableDomains();
    if (tab === "logs") window._ttBottomToggle?.show?.();
    // hidden 클래스가 먼저 바뀐 뒤 렌더링해야 isVisible()이 정확히 동작합니다.
    setTimeout(() => renderAll(), 0);
  });
});

$("ttLoginBtn")?.addEventListener("click", login);
$("ttLogoutBtn")?.addEventListener("click", logout);
$("ttExportBtn")?.addEventListener("click", exportXlsx);
$("ttSaveBtn")?.addEventListener("click", async () => { await saveNow("timetable"); await savePendingNow(); alert("저장되었습니다."); });
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
    const selectedTeachers = getSelectedTeacherNames();
    if (!selectedTeachers.length) { alert("교사를 선택하세요."); return; }
    label = selectedTeachers.length === 1 ? `${selectedTeachers[0]} 교사 배정` : `${selectedTeachers.length}명 교사 배정`;
    keepFn = e => e.pinned || !entryHasAnySelectedTeacher(e, selectedTeachers);
  } else if (currentView === "room") {
    const roomIds = getSelectedRoomIds();
    if (!roomIds.length) { alert("교실을 선택하세요."); return; }
    const roomNames = roomIds.map(id => getRooms().find(r => r.id === id)?.name || id);
    label = roomIds.length === 1 ? `${roomNames[0]} 교실 배정` : `선택 교실 ${roomIds.length}개 배정`;
    const roomIdSet = new Set(roomIds);
    keepFn = e => e.pinned || !roomIdSet.has(e.roomId);
  }
  if (!keepFn) return;
  if (!confirm(`"${label}"을 초기화할까요?
Ctrl+Z로 직전 상태를 되돌릴 수 있습니다.`)) return;
  captureTimetableUndo("시간표 초기화");
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
      const current = dragData || readDragDataFromEvent(e);
      if (current?.kind === "entry") { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; bottomBar.style.outline = "3px dashed #ef4444"; }
    });
    bottomBar.addEventListener("dragleave", () => { bottomBar.style.outline = ""; });
    bottomBar.addEventListener("drop", e => {
      e.preventDefault(); e.stopPropagation(); bottomBar.style.outline = "";
      const current = dragData || readDragDataFromEvent(e);
      if (current?.kind === "entry" && canEdit()) {
        removeEntry(current.entryId); dragData = null; recomputeConflicts(); renderAll();
      }
    });
  }
renderAll();
