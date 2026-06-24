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
import { versioned } from "./version.js?v=2026-06-24-r118-duplicate-fix-r119";
import { openFirestoreUsageDialog } from "./firestore-usage.js";
import { openAppHealthCheckDialog } from "./app-health-check.js";
import { getTemplateById, getTemplateCardTitle, splitTeacherNames } from "./templates.js";
import { uid, clean, makeBtn, sectionLabel, gradeDisplay, escapeHtml, isProtectedWholeGradeLabel } from "./utils.js";
import { getRooms, getRoomById, renderRoomsView, updateRoom, formatHomeRoomClassLabel } from "./rooms.js";
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
import { getGradeColor, CONFLICT_DISPLAY, CONFLICT_PRIORITY, getOrderedConflictTypes, applyConflictVisuals as applyConflictVisualsBase } from "./timetable-ui.js";
import { createTimetableUndoHandlers } from "./timetable-undo.js";
import { createTimetableAuthUi } from "./timetable-auth-ui.js";
import { exportTimetableXlsx } from "./timetable-export.js";


const [
  dataCleanupModule,
  ttCardsModule,
  conflictModule,
  timetableDataModule,
  autoAssignModule,
  gridModule,
  detailModule,
  constraintsModule,
  logModule,
  sidebarModule,
] = await Promise.all([
  import(versioned("./data-cleanup.js")),
  import(versioned("./ttcards.js")),
  import(versioned("./timetable-conflicts.js")),
  import(versioned("./timetable-data.js")),
  import(versioned("./timetable-autoassign.js")),
  import(versioned("./timetable-grid.js")),
  import(versioned("./timetable-detail.js")),
  import(versioned("./timetable-constraints.js")),
  import(versioned("./timetable-log.js")),
  import(versioned("./timetable-sidebar.js")),
]);

const { openDataCleanupDialog } = dataCleanupModule;
const { getTtCards, getTtCardById, refreshTtCardData } = ttCardsModule;
const { detectConflicts, detectConstraintViolations, getConflictLabel } = conflictModule;
const {
  getSubjectsForGrade, getCreditsForTemplate, getCategoryColor, getAssignedCount,
  getCategoryForTemplate, getTrackForTemplate, getGroupNameForTemplate,
  getTeachersForTemplate, getSectionCount, getCreditsForTtCard, getTeachersForTtCard,
  getGroupCards, getTtCardClassLabels, getTtCardClassInfos, classKey, describeTtCard, buildEntryDataFromTtCards,
  makePlacementFromGroupItem, entryMatchesClass, getUnitForTemplate, getUnitDisplayTitle,
  getUnitGradeKeys, getUnitTeachers, getAllClasses, entryGradeKeys, entryTemplateIds,
  entryHasGrade, entryTitle, entryTeachers, calculateClassCreditSummary
} = timetableDataModule;
const { createAutoAssignAll } = autoAssignModule;
const { renderTimetableGrid } = gridModule;
const { createTimetableDetailHandlers } = detailModule;
const { createTimetableConstraintsHandlers } = constraintsModule;
const { createTimetableLogHandlers } = logModule;
const { createTimetableSidebarHandlers } = sidebarModule;

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
let teacherCardsSelectedName = "";
let teacherPickerOutsideHandlerInstalled = false;
let roomPickerOutsideHandlerInstalled = false;
let timetableContextMenuDelegationInstalled = false;
let dragData       = null;
let dragPreviewRaf = 0;
let dragPreviewToken = 0;
const TT_DRAG_MIME = "application/x-his-timetable-drag";
const DRAG_PREVIEW_FRAME_BUDGET_MS = 7;
const DRAG_PREVIEW_MAX_VISIBLE_CELLS = 180;

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

function installTimetableScrollIsolation() {
  if (document.documentElement.dataset.ttScrollIsolationR74 === "1") return;
  document.documentElement.dataset.ttScrollIsolationR74 = "1";

  const normalizeWheelDelta = (ev, axis = "y", baseEl = null) => {
    const raw = axis === "x" ? ev.deltaX : ev.deltaY;
    if (!raw) return 0;
    if (ev.deltaMode === 1) return raw * 32;
    if (ev.deltaMode === 2) return raw * Math.max(1, baseEl?.clientHeight || window.innerHeight || 600);
    return raw;
  };
  const maxTop = el => Math.max(0, (el?.scrollHeight || 0) - (el?.clientHeight || 0));
  const maxLeft = el => Math.max(0, (el?.scrollWidth || 0) - (el?.clientWidth || 0));
  const canScroll = (el, dy, dx = 0) => {
    if (!el) return false;
    const my = maxTop(el);
    const mx = maxLeft(el);
    const yOk = Math.abs(dy) > Math.abs(dx) && my > 1 && ((dy > 0 && el.scrollTop < my - 1) || (dy < 0 && el.scrollTop > 1));
    const xOk = Math.abs(dx) >= Math.abs(dy) && mx > 1 && ((dx > 0 && el.scrollLeft < mx - 1) || (dx < 0 && el.scrollLeft > 1));
    return yOk || xOk;
  };
  const scrollElement = (el, dy, dx = 0) => {
    if (!el) return false;
    const beforeTop = el.scrollTop;
    const beforeLeft = el.scrollLeft;
    if (Math.abs(dx) > Math.abs(dy)) {
      const mx = maxLeft(el);
      el.scrollLeft = Math.max(0, Math.min(mx, beforeLeft + dx));
    } else {
      const my = maxTop(el);
      el.scrollTop = Math.max(0, Math.min(my, beforeTop + dy));
    }
    return el.scrollTop !== beforeTop || el.scrollLeft !== beforeLeft;
  };
  const isScrollableByStyle = el => {
    if (!el || !(el instanceof Element)) return false;
    const cs = window.getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(`${cs.overflowY} ${cs.overflowX} ${cs.overflow}`);
  };
  const findScrollable = (target, boundary, dy, dx = 0, fallback = null) => {
    let el = target instanceof Element ? target : null;
    while (el && el !== document.body && el !== document.documentElement) {
      if (boundary && !boundary.contains(el)) break;
      if (isScrollableByStyle(el) && canScroll(el, dy, dx)) return el;
      el = el.parentElement;
    }
    return fallback && canScroll(fallback, dy, dx) ? fallback : fallback;
  };

  const grid = document.getElementById("ttGrid");
  if (grid) {
    grid.addEventListener("wheel", ev => {
      if (ev.ctrlKey) return;
      const dy = normalizeWheelDelta(ev, "y", grid);
      const dx = normalizeWheelDelta(ev, "x", grid);
      const scroller = findScrollable(ev.target, grid, dy, dx, grid);
      if (scrollElement(scroller, dy, dx)) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    }, { capture: true, passive: false });
  }

  const bottom = document.getElementById("ttBottom");
  if (bottom) {
    bottom.addEventListener("wheel", ev => {
      if (ev.ctrlKey) return;
      if (!(ev.target instanceof Element) || !bottom.contains(ev.target)) return;
      const dy = normalizeWheelDelta(ev, "y", bottom);
      const dx = normalizeWheelDelta(ev, "x", bottom);
      const activeTab = [...bottom.querySelectorAll(".tt-bottom-content > div")]
        .find(el => !el.classList.contains("hidden"));
      const fallback = activeTab || bottom.querySelector(".tt-bottom-content") || bottom.querySelector(".tt-bottom-scroll");
      const scroller = findScrollable(ev.target, bottom, dy, dx, fallback);
      // r74: 실제 내부 스크롤이 움직인 경우에만 이벤트를 소비한다.
      // 로그/표 안에서 스크롤할 때는 연쇄 이동을 막고, 스크롤할 곳이 없을 때는
      // 전체 페이지 스크롤을 허용해 시간표와 하단바를 함께 오가며 볼 수 있게 한다.
      if (scroller && canScroll(scroller, dy, dx) && scrollElement(scroller, dy, dx)) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    }, { capture: true, passive: false });
  }
}

function activateBottomTab(tabName) {
  const normalized = tabName === "conflicts" || tabName === "unplaced" ? "logs" : (tabName || "logs");
  window._ttBottomToggle?.show?.();
  const btn = document.querySelector(`.tt-bottom-tab-btn[data-tab="${normalized}"]`) || document.querySelector('.tt-bottom-tab-btn[data-tab="logs"]');
  btn?.click();
}

let ttSaveStatusEl = null; // 통합 저장 버튼 초기화 여부를 표시하는 내부 sentinel
let ttSaveModeBtn = null;   // 실제 화면에서는 #ttSaveBtn 하나만 사용합니다.
let ttSaveStatusTimer = null;
let lastTtSaveStatus = "mode";

function ttSaveButtonText(autoSave, dirty, status) {
  const count = dirty.length;
  if (status === "saving") return count ? `💾 저장 중(${count})` : "💾 저장 중…";
  if (status === "error") return count ? `💾 저장 실패(${count})` : "💾 저장 실패";
  if ((status === "saved" || status === "skipped") && count === 0) {
    return status === "saved" ? "💾 저장됨" : "💾 변경 없음";
  }
  if (count) return autoSave ? `💾 저장 대기(${count})` : `💾 수동 저장(${count})`;
  return autoSave ? "💾 자동저장 ON" : "💾 자동저장 OFF";
}

function ttSaveButtonTitle(autoSave, dirty, status) {
  const count = dirty.length;
  if (status === "saving") return "변경사항을 저장하는 중입니다.";
  if (status === "error") return count ? "저장에 실패했습니다. 클릭하면 다시 저장을 시도합니다." : "저장에 실패했습니다.";
  if (count) {
    return autoSave
      ? "변경사항이 저장 대기 중입니다. 클릭하면 즉시 저장합니다."
      : "자동저장이 꺼져 있습니다. 클릭하면 변경사항을 수동 저장합니다.";
  }
  return autoSave
    ? "현재 자동저장 중입니다. 클릭하면 자동저장을 끕니다."
    : "자동저장이 꺼져 있습니다. 클릭하면 자동저장을 다시 켭니다.";
}

function updateTtSaveControls() {
  const btn = ttSaveModeBtn || $("ttSaveBtn");
  if (!btn) return;
  const autoSave = isAutoSaveEnabled();
  const dirty = getDirtyDomains();
  btn.textContent = ttSaveButtonText(autoSave, dirty, lastTtSaveStatus);
  btn.title = ttSaveButtonTitle(autoSave, dirty, lastTtSaveStatus);
  btn.disabled = lastTtSaveStatus === "saving";
  btn.classList.add("tt-save-essential");
  btn.classList.toggle("tt-save-autosave-on", autoSave);
  btn.classList.toggle("tt-save-autosave-off", !autoSave);
  btn.classList.toggle("tt-save-pending", dirty.length > 0);
  btn.classList.toggle("tt-save-saving", lastTtSaveStatus === "saving");
  btn.classList.toggle("tt-save-error", lastTtSaveStatus === "error");
}

async function handleTtUnifiedSaveClick() {
  const dirty = getDirtyDomains();
  if (dirty.length || lastTtSaveStatus === "error") {
    lastTtSaveStatus = "saving";
    updateTtSaveControls();
    try {
      await saveNow("timetable");
      await savePendingNow();
    } finally {
      updateTtSaveControls();
    }
    return;
  }
  const next = !isAutoSaveEnabled();
  setAutoSaveEnabled(next);
  lastTtSaveStatus = "mode";
  updateTtSaveControls();
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

    const healthBtn = document.createElement("button");
    healthBtn.type = "button";
    healthBtn.className = "tt-save-mode-btn app-health-check-btn dev-tool-control";
    healthBtn.textContent = "앱 점검";
    healthBtn.title = "현재 앱 상태, 도메인 로드, 시간표 참조, 주요 모듈 접근성을 점검합니다.";
    healthBtn.addEventListener("click", () => openAppHealthCheckDialog());
    parent.insertBefore(healthBtn, parent.firstChild);
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

    const healthBtn = document.createElement("button");
    healthBtn.type = "button";
    healthBtn.className = "tt-save-mode-btn app-health-check-btn dev-tool-control";
    healthBtn.textContent = "앱 점검";
    healthBtn.title = "현재 앱 상태, 도메인 로드, 시간표 참조, 주요 모듈 접근성을 점검합니다.";
    healthBtn.addEventListener("click", () => openAppHealthCheckDialog());

    parent.insertBefore(cleanupBtn, parent.firstChild);
    parent.insertBefore(usageBtn, parent.firstChild);
    parent.insertBefore(healthBtn, parent.firstChild);
    parent.insertBefore(diagBtn, parent.firstChild);
  }

  // 커리큘럼 상단바처럼 저장 상태/수동 저장/자동저장 전환을 #ttSaveBtn 하나로 통합합니다.
  // 별도 "자동저장 OFF" / "저장 대기" 버튼은 만들지 않습니다.
  ttSaveStatusEl = { integrated: true };
  ttSaveModeBtn = $("ttSaveBtn");
  if (ttSaveModeBtn) {
    ttSaveModeBtn.classList.add("tt-save-essential", "tt-unified-save-btn");
    ttSaveModeBtn.type = "button";
  }
  updateTtSaveControls();
}

function setupTtSaveStatusHandler() {
  setOnSaveStatus((status, detail) => {
    clearTimeout(ttSaveStatusTimer);

    if (status === "saving" || status === "dirty" || status === "saved" || status === "skipped" || status === "mode") {
      lastTtSaveStatus = status;
      updateTtSaveControls();
      if (status === "saved" || status === "skipped") {
        ttSaveStatusTimer = setTimeout(() => {
          lastTtSaveStatus = "mode";
          updateTtSaveControls();
        }, status === "saved" ? 1800 : 1200);
      }
      return;
    }

    lastTtSaveStatus = "error";
    updateTtSaveControls();
    console.warn("Timetable save status error", detail);
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

const ROOM_UNAVAILABLE_PREFIX = "__room_unavailable__:";

function roomUnavailableConstraintKey(roomId) {
  return ROOM_UNAVAILABLE_PREFIX + clean(roomId);
}

function normalizeRoomUnavailableSlots(slots = []) {
  const seen = new Set();
  return (Array.isArray(slots) ? slots : [])
    .map(s => ({ day: Number(s?.day), period: Number(s?.period) }))
    .filter(s => Number.isInteger(s.day) && s.day >= 0 && s.day <= 4 && Number.isInteger(s.period) && s.period >= 0 && s.period <= 11)
    .filter(s => {
      const key = `${s.day}:${s.period}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    })
    .sort((a, b) => a.day - b.day || a.period - b.period);
}

function getRoomUnavailableSlots(roomId) {
  const key = roomUnavailableConstraintKey(roomId);
  return normalizeRoomUnavailableSlots(constraints()?.[key]?.unavailableSlots || []);
}

function setRoomUnavailableSlots(roomId, slots) {
  if (!canEdit() || !roomId) return false;
  const key = roomUnavailableConstraintKey(roomId);
  const next = normalizeRoomUnavailableSlots(slots);
  const domain = constraints();
  if (!next.length) delete domain[key];
  else {
    domain[key] = {
      ...(domain[key] || {}),
      unavailableSlots: next,
      workType: "fulltime",
      maxPerDay: 99,
      maxConsecutive: 99,
      maxPerWeek: 0,
      constraintNote: "교실 불가시간 저장용",
    };
  }
  scheduleSave("timetable");
  return true;
}

function getEffectiveRoomsForTimetable() {
  return getRooms().map(room => ({
    ...room,
    unavailableSlots: getRoomUnavailableSlots(room.id)
  }));
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

function ensureTeacherCardsBottomTab() {
  const tab = document.querySelector(".tt-bottom-tab");
  const content = document.querySelector(".tt-bottom-content");
  if (!tab || !content) return;
  if (!document.querySelector('.tt-bottom-tab-btn[data-tab="teacherCards"]')) {
    const btn = document.createElement("button");
    btn.className = "tt-bottom-tab-btn";
    btn.dataset.tab = "teacherCards";
    btn.type = "button";
    btn.textContent = "👨‍🏫 교사별 카드";
    const constraintsBtn = tab.querySelector('.tt-bottom-tab-btn[data-tab="constraints"]');
    constraintsBtn?.after(btn) || tab.appendChild(btn);
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tt-bottom-tab-btn").forEach(b => b.classList.toggle("active", b === btn));
      const tabMap = { subjects:"ttSubjectsContent", constraints:"ttConstraintsContent", teacherCards:"ttTeacherCardsContent", rooms:"ttRoomsContent", logs:"ttLogsContent" };
      Object.entries(tabMap).forEach(([key, id]) => $(id)?.classList.toggle("hidden", key !== "teacherCards"));
      subscribeOptionalTimetableDomains();
      setTimeout(() => renderAll(), 0);
    });
  }
  if (!$("ttTeacherCardsContent")) {
    const div = document.createElement("div");
    div.id = "ttTeacherCardsContent";
    div.className = "hidden";
    const rooms = $("ttRoomsContent");
    if (rooms) content.insertBefore(div, rooms);
    else content.appendChild(div);
  }
}

function getTeacherNamesForCard(card) {
  return [...new Set([
    ...getTeachersForTtCard(card),
    ...splitTeacherNames(card?.teacherName || "")
  ].map(clean).filter(Boolean))];
}

function getGroupInfoForTeacherCard(cardId) {
  if (!cardId) return { groupName: "", unitName: "" };
  for (const group of (appState.timetable?.ttcardGroups || [])) {
    const inPool = (group.poolCardIds || []).includes(cardId) || (group.excludedCardIds || []).includes(cardId);
    const unit = (group.units || []).find(u => (u.ttcardIds || []).includes(cardId));
    if (inPool || unit) {
      return {
        groupName: group.name || "그룹",
        unitName: unit ? getUnitDisplayTitle(unit) : ""
      };
    }
  }
  return { groupName: "", unitName: "" };
}

function getPlacedOccurrencesForTeacherCard(card) {
  if (!card?.id) return [];
  const cardClassKeys = new Set(getTtCardClassInfos(card).map(info => classKey(info)).filter(Boolean));
  const slotSeen = new Set();
  const placed = [];
  entries().forEach(entry => {
    const ids = ttCardIdsFromPlacement(entry);
    let matched = ids.includes(card.id);
    if (!matched && card.templateId && entryTemplateIds(entry).includes(card.templateId) && entryHasGrade(entry, card.gradeKey)) {
      const entryKeys = Array.isArray(entry.audienceClassKeys) ? entry.audienceClassKeys.map(clean).filter(Boolean) : [];
      matched = !entryKeys.length || entryKeys.some(key => cardClassKeys.has(key));
    }
    if (!matched) return;
    const key = `${entry.day}:${entry.period}`;
    if (slotSeen.has(key)) return;
    slotSeen.add(key);
    placed.push(entry);
  });
  return placed.sort((a, b) => a.day - b.day || a.period - b.period);
}

function renderTeacherCardsPanel() {
  ensureTeacherCardsBottomTab();
  const panel = $("ttTeacherCardsContent");
  if (!panel) return;
  const allCards = appState.timetable?.ttcards || [];
  const teacherNames = [...new Set([
    ...getAllTimetableTeachers(),
    ...allCards.flatMap(getTeacherNamesForCard),
    ...entries().flatMap(entryTeachers)
  ].map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  if (!teacherCardsSelectedName || !teacherNames.includes(teacherCardsSelectedName)) {
    teacherCardsSelectedName = teacherNames[0] || "";
  }

  panel.innerHTML = "";
  panel.className = panel.className.replace(/\bhidden\b/g, "").trim();
  panel.classList.add("tt-teacher-card-panel");

  const wrap = document.createElement("div");
  wrap.className = "tt-teacher-card-wrap";

  const left = document.createElement("aside");
  left.className = "tt-teacher-card-left";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "교사 검색";
  search.className = "tt-teacher-card-search";
  const list = document.createElement("div");
  list.className = "tt-teacher-card-list";
  left.append(search, list);

  const right = document.createElement("section");
  right.className = "tt-teacher-card-right";

  const renderTeacherList = () => {
    const q = clean(search.value).toLocaleLowerCase("ko");
    list.innerHTML = "";
    teacherNames
      .filter(name => !q || name.toLocaleLowerCase("ko").includes(q))
      .forEach(name => {
        const teacherCards = allCards.filter(card => getTeacherNamesForCard(card).includes(name));
        const teacherEntries = entries().filter(entry => entryTeachers(entry).includes(name));
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tt-teacher-card-teacher" + (name === teacherCardsSelectedName ? " active" : "");
        btn.innerHTML = `<strong>${escapeHtml(name)}</strong><span>${teacherCards.length}카드 · ${teacherEntries.length}배치</span>`;
        btn.addEventListener("click", () => {
          teacherCardsSelectedName = name;
          renderTeacherList();
          renderTeacherDetail();
        });
        list.appendChild(btn);
      });
  };

  const renderTeacherDetail = () => {
    const teacher = teacherCardsSelectedName;
    const teacherCards = allCards
      .filter(card => getTeacherNamesForCard(card).includes(teacher))
      .sort((a, b) => {
        const ga = GRADE_KEYS.indexOf(a.gradeKey) - GRADE_KEYS.indexOf(b.gradeKey);
        if (ga) return ga;
        const ta = describeTtCard(a).title;
        const tb = describeTtCard(b).title;
        return ta.localeCompare(tb, "ko", { numeric:true, sensitivity:"base" });
      });
    const teacherEntries = entries()
      .filter(entry => entryTeachers(entry).includes(teacher))
      .sort((a, b) => a.day - b.day || a.period - b.period || entryTitle(a).localeCompare(entryTitle(b), "ko"));
    const totalCredits = teacherCards.reduce((sum, card) => sum + (Number(getCreditsForTtCard(card)) || 0), 0);
    const placedSlots = new Set(teacherEntries.map(e => `${e.day}:${e.period}`)).size;
    const dayLabels = ["월", "화", "수", "목", "금"];
    const periodLabels = ttConfig().periodLabels || [];

    right.innerHTML = "";
    const head = document.createElement("div");
    head.className = "tt-teacher-card-head";
    head.innerHTML = `<div><strong>${escapeHtml(teacher || "교사 없음")}</strong><span>생성 카드 ${teacherCards.length}개 · 기준 시수 ${totalCredits} · 현재 배치 ${placedSlots}칸</span></div>`;
    right.appendChild(head);

    const body = document.createElement("div");
    body.className = "tt-teacher-card-body";

    const cardSection = document.createElement("div");
    cardSection.className = "tt-teacher-card-section";
    cardSection.innerHTML = `<h4>시간표 카드</h4>`;
    const cardList = document.createElement("div");
    cardList.className = "tt-teacher-card-cardlist";

    if (!teacherCards.length) {
      const empty = document.createElement("div");
      empty.className = "tt-teacher-card-empty";
      empty.textContent = "이 교사에게 연결된 시간표 카드가 없습니다.";
      cardList.appendChild(empty);
    } else {
      teacherCards.forEach(card => {
        const desc = describeTtCard(card);
        const groupInfo = getGroupInfoForTeacherCard(card.id);
        const placed = getPlacedOccurrencesForTeacherCard(card);
        const credits = Number(getCreditsForTtCard(card)) || 0;
        const resolvedRoomId = resolveRoomForTtCard(card, {
          ttcardId: card.id,
          ttcardIds: [card.id],
          templateId: card.templateId,
          gradeKey: card.gradeKey,
          sectionIdx: card.sectionIdx ?? 0,
          teacherName: getTeacherNamesForCard(card).join(",")
        });
        const roomLabel = resolvedRoomId ? getRoomDisplayName(resolvedRoomId) : "교실 미배정";
        const row = document.createElement("div");
        row.className = "tt-teacher-card-row" + (placed.length >= credits && credits > 0 ? " done" : "");
        const classLabels = getTtCardClassLabels(card).length ? getTtCardClassLabels(card).join(", ") : getEntryClassSummary({ ttcardIds:[card.id], gradeKey:card.gradeKey });
        row.innerHTML = `
          <div class="tt-teacher-card-main">
            <strong>${escapeHtml(desc.title)}</strong>
            <span>${escapeHtml(classLabels || "반 정보 없음")} · ${escapeHtml(groupInfo.groupName || "그룹 없음")}${groupInfo.unitName ? " · " + escapeHtml(groupInfo.unitName) : ""}</span>
            <em>${escapeHtml(roomLabel)}</em>
          </div>
          <div class="tt-teacher-card-count"><b>${placed.length}</b>/<span>${credits || "-"}</span></div>`;
        row.type = "button";
        row.tabIndex = 0;
        row.title = "클릭하면 시간표 카드 상세를 봅니다.";
        const openCardDetail = () => showSidebarCardDetail({
          title: desc.title,
          teachers: getTeacherNamesForCard(card),
          gradeKeys: [card.gradeKey].filter(Boolean),
          credits,
          assigned: placed.length,
          isDone: credits > 0 && placed.length >= credits,
          sectionIdx: card.sectionIdx,
          groupName: groupInfo.groupName || "",
          groupId: (appState.timetable?.ttcardGroups || []).find(g => (g.poolCardIds || []).includes(card.id) || (g.excludedCardIds || []).includes(card.id) || (g.units || []).some(u => (u.ttcardIds || []).includes(card.id)))?.id || "",
          detailItems: [desc],
        });
        row.addEventListener("click", openCardDetail);
        row.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openCardDetail(); } });
        cardList.appendChild(row);
      });
    }
    cardSection.appendChild(cardList);

    const entrySection = document.createElement("div");
    entrySection.className = "tt-teacher-card-section";
    entrySection.innerHTML = `<h4>현재 배정</h4>`;
    const entryList = document.createElement("div");
    entryList.className = "tt-teacher-card-entrylist";
    if (!teacherEntries.length) {
      const empty = document.createElement("div");
      empty.className = "tt-teacher-card-empty";
      empty.textContent = "현재 시간표에 배정된 수업이 없습니다.";
      entryList.appendChild(empty);
    } else {
      teacherEntries.forEach(entry => {
        const row = document.createElement("div");
        row.className = "tt-teacher-card-entry";
        row.innerHTML = `<b>${escapeHtml(dayLabels[entry.day] || "?")} ${escapeHtml(periodLabels[entry.period] || `${entry.period + 1}교시`)}</b><span>${escapeHtml(entryTitle(entry))}</span><em>${escapeHtml(getEntryClassSummary(entry))} · ${escapeHtml(entryRoomSummary(entry) || "교실 없음")}</em>`;
        row.tabIndex = 0;
        row.title = "클릭하면 배치 상세를 봅니다.";
        row.addEventListener("click", () => showEntryDetail(entry));
        row.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); showEntryDetail(entry); } });
        entryList.appendChild(row);
      });
    }
    entrySection.appendChild(entryList);

    body.append(cardSection, entrySection);
    right.appendChild(body);
  };

  search.addEventListener("input", renderTeacherList);
  wrap.append(left, right);
  panel.appendChild(wrap);
  renderTeacherList();
  renderTeacherDetail();
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

function getAudienceClassKeysForPlacementData(data = {}) {
  const direct = (Array.isArray(data.audienceClassKeys) ? data.audienceClassKeys : [])
    .map(clean)
    .filter(Boolean);
  if (direct.length) return [...new Set(direct)];

  const cardKeys = ttCardIdsFromPlacement(data)
    .map(id => getTtCardById(id))
    .filter(Boolean)
    .flatMap(card => getTtCardClassInfos(card).map(info => classKey(info)).filter(Boolean));
  if (cardKeys.length) return [...new Set(cardKeys)];

  const gradeKey = data.gradeKey || (Array.isArray(data.gradeKeys) ? data.gradeKeys[0] : "");
  if (!gradeKey) return [];
  return [classKey({ gradeKey, sectionIdx: data.sectionIdx ?? 0, section: sectionLabel(data.sectionIdx ?? 0) })].filter(Boolean);
}

function classInfoFromAudienceClassKey(key = "") {
  const [gradeNo, rawSection] = String(key || "").split(":");
  const gradeNum = Number(gradeNo);
  const section = clean(rawSection).toUpperCase();
  const gradeKey = Number.isFinite(gradeNum) && gradeNum > 0 ? `${gradeNum}학년` : "";
  const cls = (appState.classes?.classes || []).find(c =>
    c.grade === gradeKey && clean(c.name).toUpperCase() === section
  );
  return {
    gradeKey,
    section,
    sectionIdx: cls ? (cls.sectionIdx ?? 0) : Math.max(0, section.charCodeAt(0) - 65),
    classId: cls?.id || ""
  };
}

function getHomeRoomIdForClassKey(key = "") {
  const classId = classIdForAudienceClassKey(key);
  if (!classId) return null;
  return getRooms().find(r => r.homeRoomClassId === classId)?.id || null;
}

function getHomeRoomIdForPlacementData(data = {}) {
  const classKeys = getAudienceClassKeysForPlacementData(data);
  const roomIds = [...new Set(classKeys.map(getHomeRoomIdForClassKey).filter(Boolean))];
  return roomIds.length === 1 ? roomIds[0] : null;
}

function getRoomRuleApplyBlockEntries(entry = {}) {
  if (!entry?.id) return [];
  if (entry.groupId || entry.unitId) {
    return entries().filter(e =>
      e.day === entry.day &&
      e.period === entry.period &&
      ((entry.groupId && e.groupId === entry.groupId) || (entry.unitId && e.unitId === entry.unitId))
    );
  }
  return [entry];
}

function buildClassScopedEntry(entry, classKeyValue, roomId) {
  const info = classInfoFromAudienceClassKey(classKeyValue);
  return normalizeTimetableEntry({
    ...entry,
    id: uid("ent"),
    gradeKey: info.gradeKey || entry.gradeKey,
    gradeKeys: info.gradeKey ? [info.gradeKey] : (entry.gradeKeys || [entry.gradeKey].filter(Boolean)),
    sectionIdx: Number.isInteger(info.sectionIdx) ? info.sectionIdx : (entry.sectionIdx ?? 0),
    audienceClassKeys: [classKeyValue],
    roomRule: "homeroom",
    roomId: roomId || null,
    roomPinned: false,
  });
}

function applyHomeroomRuleToEntryBlock(entry) {
  const block = getRoomRuleApplyBlockEntries(entry);
  if (!block.length) return false;

  const originalEntries = entries();
  const replaceMap = new Map();
  block.forEach(e => {
    const classKeys = getAudienceClassKeysForPlacementData(e);
    if (classKeys.length <= 1) {
      const oneKey = classKeys[0];
      const homeRoomId = oneKey ? getHomeRoomIdForClassKey(oneKey) : null;
      e.roomRule = "homeroom";
      e.roomPinned = false;
      e.roomId = homeRoomId || null;
      const ids = ttCardIdsFromPlacement(e);
      if (ids.length && homeRoomId) {
        e.roomAssignmentsByTtCardId = Object.fromEntries(ids.map(id => [id, homeRoomId]));
      }
      return;
    }
    replaceMap.set(e.id, classKeys.map(key => buildClassScopedEntry(e, key, getHomeRoomIdForClassKey(key))));
  });

  if (replaceMap.size) {
    const next = [];
    originalEntries.forEach(e => {
      if (replaceMap.has(e.id)) next.push(...replaceMap.get(e.id));
      else next.push(e);
    });
    ttDomain().entries = next;
  }
  scheduleSave("timetable");
  return true;
}

function getCardPreferenceForPlacementData(data = {}) {
  const ids = [...(data.ttcardIds || []), data.ttcardId].filter(Boolean);
  const cards = ids.map(id => getTtCardById(id)).filter(Boolean);
  if (!cards.length) return { rule: "auto", fixedRoomId: null };
  const rules = [...new Set(cards.map(c => normalizeRoomRuleValue(c.roomRule || "auto")))];
  const fixedIds = [...new Set(cards.map(c => clean(c.fixedRoomId)).filter(Boolean))];
  if (rules.length === 1) return { rule: rules[0] || "auto", fixedRoomId: fixedIds.length === 1 ? fixedIds[0] : null };
  if (fixedIds.length === 1 && rules.every(r => r === "auto" || r === "fixed")) return { rule: "fixed", fixedRoomId: fixedIds[0] };
  return { rule: "auto", fixedRoomId: null };
}

function normalizeRoomRuleValue(rule = "auto") {
  const r = clean(rule) || "auto";
  return ["auto", "fixed", "homeroom", "teacher", "none"].includes(r) ? r : "auto";
}

function effectiveRuleForPlacementData(data = {}, forcedRule = null) {
  const preference = getCardPreferenceForPlacementData(data);
  if (forcedRule != null) return normalizeRoomRuleValue(forcedRule);
  // r118: 과목카드에 사용자가 저장한 지정교실/홈룸/교실없음 규칙은
  // 오래된 entry.roomRule 값보다 우선합니다. 특히 HR 수동카드가 홈룸 고정인데
  // 배치 entry에 과거 교사교실 값이 남아 있으면 화면과 교실 판정이 틀어집니다.
  if (preference.rule && preference.rule !== "auto") return normalizeRoomRuleValue(preference.rule);
  return normalizeRoomRuleValue(data.roomRule || preference.rule || "auto");
}

function resolveRoomForPlacementData(data = {}, forcedRule = null) {
  const preference = getCardPreferenceForPlacementData(data);
  const rule = effectiveRuleForPlacementData(data, forcedRule);
  const fixedRoomId = clean(preference.fixedRoomId || data.fixedRoomId || (rule === "fixed" ? data.roomId : ""));
  if (rule === "none") return null;
  if (rule === "fixed") return fixedRoomId || null;
  if (rule === "homeroom") return getHomeRoomIdForPlacementData(data);
  if (rule === "teacher") {
    const teacherRoomId = getDefaultRoomForTeacherNames(splitTeacherNames(data.teacherName || ""));
    // r115: 교사 배정교실 고정은 사용자 지정교실/홈룸보다 아래 단계입니다.
    // 이미 지정교실/고정교실이 있으면 절대 교사 배정교실로 덮어쓰지 않습니다.
    return fixedRoomId || teacherRoomId || null;
  }

  // auto 기본 교실 규칙:
  // 1) 사용자 지정교실/카드 고정교실
  // 2) 교사 배정교실 고정
  // 3) 둘 다 없으면 교실 미배정 유지
  const teacherRoomId = getDefaultRoomForTeacherNames(splitTeacherNames(data.teacherName || ""));
  return fixedRoomId || teacherRoomId || null;
}

function getDefaultRoomForPlacementData(data = {}) {
  return resolveRoomForPlacementData(data);
}

function roomRuleForCard(card = {}) {
  return clean(card.roomRule || "auto") || "auto";
}

function roomRequiredForCard(card = {}) {
  return roomRuleForCard(card) !== "none";
}

function resolveRoomForTtCard(card = {}, fallbackEntry = {}) {
  if (!card?.id) return null;
  const rule = roomRuleForCard(card);
  if (rule === "none") return null;
  const teacherName = (Array.isArray(card.teachers) && card.teachers.length)
    ? card.teachers.join(",")
    : (card.teacherName || (getTeachersForTtCard(card) || []).join(","));
  const data = {
    ...fallbackEntry,
    ttcardId: card.id,
    ttcardIds: [card.id],
    templateId: card.templateId || fallbackEntry.templateId,
    templateIds: [card.templateId || fallbackEntry.templateId].filter(Boolean),
    gradeKey: card.gradeKey || fallbackEntry.gradeKey,
    gradeKeys: [card.gradeKey || fallbackEntry.gradeKey].filter(Boolean),
    sectionIdx: card.sectionIdx ?? fallbackEntry.sectionIdx ?? 0,
    classKeys: Array.isArray(card.classKeys) ? card.classKeys : [],
    classLabels: Array.isArray(card.classLabels) ? card.classLabels : [],
    audienceClassKeys: Array.isArray(fallbackEntry.audienceClassKeys) ? fallbackEntry.audienceClassKeys : [],
    teacherName,
    roomRule: rule,
    fixedRoomId: clean(card.fixedRoomId || "")
  };
  return resolveRoomForPlacementData(data, rule);
}

function roomAssignmentsForEntry(entry = {}) {
  const explicit = entry.roomAssignmentsByTtCardId && typeof entry.roomAssignmentsByTtCardId === "object"
    ? entry.roomAssignmentsByTtCardId
    : {};
  const out = {};
  const ids = ttCardIdsFromPlacement(entry);
  if (!ids.length) {
    const fallbackRoom = resolveRoomForPlacementData(entry);
    if (fallbackRoom) out.__entry = fallbackRoom;
    return out;
  }
  ids.forEach(id => {
    const explicitRoom = clean(explicit[id]);
    if (explicitRoom) { out[id] = explicitRoom; return; }
    const card = getTtCardById(id);
    let roomId = resolveRoomForTtCard(card, entry);
    // r118: 단일 수동카드에서 카드 규칙/entry 규칙이 서로 어긋나 있어도
    // entry 자체의 홈룸/지정교실 계산값을 마지막으로 확인합니다.
    if (!roomId && ids.length === 1) roomId = resolveRoomForPlacementData({ ...entry, ttcardId: id, ttcardIds: [id] });
    if (roomId) out[id] = roomId;
  });
  return out;
}

function isGroupedRoomEntry(entry = {}) {
  const cardIds = ttCardIdsFromPlacement(entry);
  return !!entry.groupId || cardIds.length > 1;
}

function effectiveRoomIdsForEntry(entry = {}) {
  const ids = Object.values(roomAssignmentsForEntry(entry)).map(clean).filter(Boolean);
  // 그룹카드는 entry.roomId 하나로 교실을 대표하면 안 됩니다.
  // 시간표에서는 카드 1개로 움직이지만, 실제 교실은 구성 과목별 roomAssignmentsByTtCardId만 신뢰합니다.
  if (!isGroupedRoomEntry(entry) && entry.roomId) ids.push(clean(entry.roomId));
  return [...new Set(ids.filter(Boolean))];
}

function entryNeedsAnyRoom(entry = {}) {
  const cardIds = ttCardIdsFromPlacement(entry);
  if (cardIds.length) {
    return cardIds.some(id => roomRequiredForCard(getTtCardById(id) || {}));
  }
  return clean(entry.roomRule || "auto") !== "none";
}

function entryHasMissingRoomAssignment(entry = {}) {
  const cardIds = ttCardIdsFromPlacement(entry);
  const effectiveRooms = effectiveRoomIdsForEntry(entry);
  if (!cardIds.length) return entryNeedsAnyRoom(entry) && !effectiveRooms.length;

  // r115: 단일 카드/수동카드는 entry.roomId 또는 홈룸 계산값이 있으면 미배정이 아닙니다.
  // 이전 판정은 roomAssignmentsByTtCardId만 보아 홈룸/지정교실이 화면에서 미배정으로 보였습니다.
  if (cardIds.length === 1 && effectiveRooms.length) return false;

  const assignments = roomAssignmentsForEntry(entry);
  return cardIds.some(id => {
    const card = getTtCardById(id);
    if (!roomRequiredForCard(card || {})) return false;
    return !clean(assignments[id]);
  });
}

function applyCardRoomAssignmentsToEntryData(data = {}) {
  const ids = ttCardIdsFromPlacement(data);
  if (!ids.length) return data;
  const assignments = {};
  ids.forEach(id => {
    const roomId = resolveRoomForTtCard(getTtCardById(id), data);
    if (roomId) assignments[id] = roomId;
  });
  data.roomAssignmentsByTtCardId = assignments;
  const rooms = [...new Set(Object.values(assignments).map(clean).filter(Boolean))];
  if (isGroupedRoomEntry(data)) {
    data.roomId = null;
    data.roomPinned = false;
  } else if (rooms.length === 1) data.roomId = rooms[0];
  else if (rooms.length > 1) data.roomId = null;
  return data;
}

function refreshEntryRoomAssignmentsFromCards(cardIds = []) {
  const target = new Set((cardIds || []).map(clean).filter(Boolean));
  if (!target.size) return;
  entries().forEach(entry => {
    const ids = ttCardIdsFromPlacement(entry);
    if (!ids.some(id => target.has(id))) return;
    const assignments = {};
    ids.forEach(id => {
      const roomId = resolveRoomForTtCard(getTtCardById(id), entry);
      if (roomId) assignments[id] = roomId;
    });
    entry.roomAssignmentsByTtCardId = assignments;
    const rooms = [...new Set(Object.values(assignments).map(clean).filter(Boolean))];
    if (isGroupedRoomEntry(entry)) {
      entry.roomId = null;
      entry.roomPinned = false;
    } else if (rooms.length === 1) entry.roomId = rooms[0];
    else if (rooms.length > 1) entry.roomId = null;
    else if (!entry.roomPinned) entry.roomId = null;
  });
}

function entryRoomSummary(entry = {}) {
  const roomIds = effectiveRoomIdsForEntry(entry);
  const names = roomIds.map(getRoomDisplayName).filter(Boolean);
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  return `${names.length}개 교실`;
}

function applyDefaultRoomToEntryData(data = {}) {
  if (data.roomPinned && data.roomId && !isGroupedRoomEntry(data)) return data;
  const preference = getCardPreferenceForPlacementData(data);
  data.roomRule = effectiveRuleForPlacementData(data);
  if (isGroupedRoomEntry(data)) {
    data.roomId = null;
    data.roomPinned = false;
    return applyCardRoomAssignmentsToEntryData(data);
  }
  const roomId = resolveRoomForPlacementData(data);
  data.roomId = roomId || null;
  return applyCardRoomAssignmentsToEntryData(data);
}

function setTtCardRoomPreference(cardIds = [], rule = "auto", roomId = null, options = {}) {
  if (!canEdit()) return false;
  const ids = [...new Set((cardIds || []).filter(Boolean))];
  if (!ids.length) return false;
  captureTimetableUndo("과목카드 교실 설정");
  const normalizedRule = clean(rule) || "auto";
  const preserveFixedRooms = !!options.preserveFixedRooms;
  (appState.timetable.ttcards || []).forEach(card => {
    if (!ids.includes(card.id)) return;
    const currentRule = clean(card.roomRule || "auto") || "auto";
    const hasUserFixedRoom = currentRule === "fixed" && clean(card.fixedRoomId);
    const hasExplicitRoomRule = hasUserFixedRoom || currentRule === "homeroom" || currentRule === "none";
    // r115/r120: 전체 일괄 적용/교사 배정교실 고정 적용은 사용자가 명시한 지정교실/홈룸/교실없음을 건드리지 않습니다.
    // 단, 사용자가 카드 1개에서 같은 규칙을 다시 저장하거나 직접 바꾸는 경우는 반드시 반영/재계산합니다.
    if (preserveFixedRooms && normalizedRule !== currentRule && normalizedRule !== "fixed" && hasExplicitRoomRule) return;
    card.roomRule = normalizedRule;
    card.fixedRoomId = normalizedRule === "fixed" ? (clean(roomId) || null) : null;
    card.manualEdited = true;
    card.editedAt = new Date().toISOString();
  });
  refreshEntryRoomAssignmentsFromCards(ids);
  scheduleSave("timetable");
  try { recomputeConflicts(); } catch (_) {}
  return true;
}

function applyRoomRuleToEntry(entryId, rule = "auto", roomId = null) {
  if (!canEdit()) return false;
  const e = entries().find(x => x.id === entryId);
  if (!e) return false;
  if (isGroupedRoomEntry(e)) {
    alert("그룹카드는 상단 교실 1개가 아니라 구성 과목별 교실을 지정해야 합니다.");
    return false;
  }
  captureTimetableUndo("수업 교실 설정");
  const normalizedRule = clean(rule) || "auto";

  const entryCardIds = ttCardIdsFromPlacement(e);
  const persistRuleToCards = () => {
    if (!entryCardIds.length) return;
    (appState.timetable.ttcards || []).forEach(card => {
      if (!entryCardIds.includes(card.id)) return;
      card.roomRule = normalizedRule;
      card.fixedRoomId = normalizedRule === "fixed" ? (clean(roomId) || null) : null;
      card.manualEdited = true;
    });
  };

  // 여러 학반을 한 번에 덮는 그룹/창체 카드는 entry 하나에 교실 하나만 담을 수 없으므로,
  // 홈룸 적용 시 학반별 entry로 자동 분할해 각 학반의 홈룸을 배정합니다.
  if (normalizedRule === "homeroom") {
    persistRuleToCards();
    const ok = applyHomeroomRuleToEntryBlock(e);
    refreshEntryRoomAssignmentsFromCards(entryCardIds);
    return ok;
  }

  persistRuleToCards();
  e.roomRule = normalizedRule;
  e.roomPinned = e.roomRule === "fixed";
  if (e.roomRule === "fixed") e.roomId = clean(roomId) || e.roomId || null;
  else e.roomId = resolveRoomForPlacementData(e, e.roomRule);
  if (entryCardIds.length) applyCardRoomAssignmentsToEntryData(e);
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

  // 시간표 배치 단계에서는 학생 ID가 아니라 학급/반 점유를 기준으로 충돌을 설명합니다.
  const classLabels = localUniqueStrings((detail.classKeys || []).map(occFormatClassLabelFromKey).filter(Boolean));
  if (classLabels.length) return `겹치는 학급: ${classLabels.join(", ")}`;

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

  return "학급 겹침 없음 — 충돌 판정 데이터를 재확인하세요";
}

function getRelatedConflictEntries(entry, type) {
  const sameSlot = entries().filter(e => e.id !== entry.id && e.day === entry.day && e.period === entry.period);
  if (type === "teacher") {
    return sameSlot
      .map(e => ({ entry: e, detail: entrySharesTeacher(entry, e).join(", ") }))
      .filter(x => x.detail);
  }
  if (type === "room") {
    const rooms = effectiveRoomIdsForEntry(entry);
    if (!rooms.length) return [];
    return sameSlot
      .map(e => {
        const shared = effectiveRoomIdsForEntry(e).filter(id => rooms.includes(id));
        return shared.length ? { entry: e, detail: shared.map(getRoomDisplayName).join(", ") } : null;
      })
      .filter(Boolean);
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
  if (type === "roomMissing") return "이 수업 또는 그룹 구성 과목 중 교실이 배정되지 않은 항목이 있습니다. 상세보기에서 구성 과목별 교실을 지정해 주세요.";
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
    desc.textContent = "현재 선택한 수업에는 교사, 교실, 학급, 제약 조건 충돌이 없습니다.";
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
function getSameSlotCardIds(entry = {}) {
  return [...new Set([...(entry.ttcardIds || []), entry.ttcardId].map(clean).filter(Boolean))];
}

function hasSameCardInSameSlot(candidate = {}) {
  const ids = new Set(getSameSlotCardIds(candidate));
  if (!ids.size || !Number.isInteger(candidate.day) || !Number.isInteger(candidate.period)) return false;

  // 같은 과목카드는 시수만큼 서로 다른 슬롯에 여러 번 배치될 수 있습니다.
  // 단, 같은 요일·교시에 같은 카드가 중복 생성되는 것은 데이터 오류이므로 막습니다.
  return entries().some(entry => {
    if (!entry || entry.id === candidate.id) return false;
    if (entry.day !== candidate.day || entry.period !== candidate.period) return false;
    return getSameSlotCardIds(entry).some(id => ids.has(id));
  });
}

function addEntry(data) {
  if (!canEdit()) return null;
  const e = normalizeTimetableEntry({ id: uid("ent"), ...applyDefaultRoomToEntryData(data) });
  if (!e.templateId) return null;

  if (hasSameCardInSameSlot(e)) {
    alert("이미 같은 시간에 배치된 카드입니다. 기존 카드를 이동하거나 삭제한 뒤 다시 배치해 주세요.");
    return null;
  }

  // 수동 드래그 배치는 충돌이 있어도 먼저 허용합니다.
  // 이후 recomputeConflicts()에서 교사/교실/학급/동시배정/제약 충돌을 색상 배지로 표시합니다.
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
function compoundOptionKeyForGroupCard(card) {
  if (!card?.compoundParentTemplateId) return "";
  const classKey = (card.classKeys || []).map(clean).filter(Boolean).sort().join(",");
  const classLabel = (card.classLabels || []).map(clean).filter(Boolean).sort().join(",");
  return [
    "compound",
    card.compoundParentTemplateId,
    card.gradeKey || "",
    card.sectionIdx ?? 0,
    classKey || classLabel || ""
  ].join("::");
}

function sortCompoundGroupCards(cards = []) {
  return [...(cards || [])].filter(Boolean).sort((a, b) => {
    const ai = Number.isInteger(a.compoundPartIndex) ? a.compoundPartIndex : 999;
    const bi = Number.isInteger(b.compoundPartIndex) ? b.compoundPartIndex : 999;
    if (ai !== bi) return ai - bi;
    return String(a.subject || a.id || "").localeCompare(String(b.subject || b.id || ""), "ko", { numeric: true });
  });
}

function groupCreditForCards(cards = []) {
  const optionCredits = [];
  const compoundBuckets = new Map();
  (cards || []).filter(Boolean).forEach(card => {
    const key = compoundOptionKeyForGroupCard(card);
    if (!key) {
      const credits = Number(getCreditsForTtCard(card)) || 0;
      if (credits > 0) optionCredits.push(credits);
      return;
    }
    if (!compoundBuckets.has(key)) compoundBuckets.set(key, []);
    compoundBuckets.get(key).push(card);
  });
  compoundBuckets.forEach(bucket => {
    const total = bucket.reduce((sum, card) => sum + (Number(getCreditsForTtCard(card)) || 0), 0);
    if (total > 0) optionCredits.push(total);
  });
  return Math.max(1, ...optionCredits.filter(v => v > 0));
}

function selectGroupCardsForOccurrence(cards = [], occurrenceIndex = 0) {
  const normalCards = [];
  const compoundBuckets = new Map();
  const occ = Math.max(0, Number(occurrenceIndex) || 0);
  (cards || []).filter(Boolean).forEach(card => {
    const key = compoundOptionKeyForGroupCard(card);
    if (!key) {
      if (occ < Math.max(0, Number(getCreditsForTtCard(card)) || 0)) normalCards.push(card);
      return;
    }
    if (!compoundBuckets.has(key)) compoundBuckets.set(key, []);
    compoundBuckets.get(key).push(card);
  });

  const selectedCompoundCards = [];
  compoundBuckets.forEach(bucket => {
    const ordered = sortCompoundGroupCards(bucket)
      .map(card => ({ card, credits: Math.max(0, Number(getCreditsForTtCard(card)) || 0) }))
      .filter(row => row.credits > 0);
    const total = ordered.reduce((sum, row) => sum + row.credits, 0);
    if (!total) return;
    let cursor = occ % total;
    for (const row of ordered) {
      if (cursor < row.credits) {
        selectedCompoundCards.push(row.card);
        return;
      }
      cursor -= row.credits;
    }
  });
  return [...normalCards, ...selectedCompoundCards];
}

function nextManualGroupOccurrenceIndex(groupId, groupCredit = 1) {
  const total = Math.max(1, Number(groupCredit) || 1);
  const placedCount = (entries() || []).filter(entry => entry?.groupId === groupId).length;
  return placedCount % total;
}

function placeGroupAt(groupId, day, period) {
  const grp = (appState.timetable.ttcardGroups || []).find(g => g.id === groupId);
  if (!grp) return false;

  // 그룹카드는 화면에서 하나의 카드로 보이지만, 복합 과목은 한 회차에 모든 파트를 동시에 넣으면 안 됩니다.
  // 예: 미적분(2)+심화물리(2)는 1~2회차 미적분, 3~4회차 심화물리처럼 순차 점유합니다.
  const allCards = getGroupCards(grp);
  const groupCredit = groupCreditForCards(allCards);
  const occurrenceIndex = nextManualGroupOccurrenceIndex(grp.id, groupCredit);
  const cards = selectGroupCardsForOccurrence(allCards, occurrenceIndex);
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

    const credits = groupCreditForCards(groupCards);
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
// ── r49: 교사 역할(주교사/공동교사) 해석 — 엔진과 동일 스키마(teacherRoleOverrides) ──
// 자동배정 엔진(timetable-autoassign.js)이 읽는 것과 같은 override를 읽어, 충돌 패널도
// 동일하게 "공동교사는 시간 점유에서 제외"합니다. override가 없으면 전원 점유(기존과 동일).
const TT_NONEX_KEYS = ["nonExclusiveTeachers","nonExclusiveTeacherNames","supportTeachers","supportTeacherNames","coTeachers","coTeacherNames","assistantTeachers","assistantTeacherNames","displayOnlyTeachers","displayOnlyTeacherNames"];
const TT_HARD_KEYS  = ["hardTeachers","hardTeacherNames","primaryTeachers","primaryTeacherNames","requiredTeachers","requiredTeacherNames","exclusiveTeachers","exclusiveTeacherNames","collisionTeachers","collisionTeacherNames"];
function ttRoleSources() {
  return [
    ttDomain()?.teacherRoleOverrides,
    ttDomain()?.teacherRoles,
    globalThis.HIS_TEACHER_ROLE_OVERRIDES,
    { nonExclusiveTeachers: globalThis.HIS_NON_EXCLUSIVE_TEACHERS, hardTeachers: globalThis.HIS_HARD_TEACHERS }
  ].filter(s => s && typeof s === "object");
}
function ttNormNames(v) {
  const raw = Array.isArray(v) ? v : [v];
  return [...new Set(raw.flatMap(x => splitTeacherNames(x || "")).map(s => String(s).trim()).filter(Boolean))];
}
function ttRoleLookupKeys(e = {}) {
  const ks = new Set();
  [e.subject, e.teacherName, e.templateId, e.id, e.ttcardId, e.name, e.title].forEach(v => {
    const s = String(v || "").trim(); if (s) ks.add(s);
  });
  // 엔트리에는 subject가 없으므로(카드에만 있음) 엔진과 동일하게 카드에서 subject/templateId를 끌어옵니다.
  const cardIds = [...new Set([...(e.ttcardIds || []), e.ttcardId].filter(Boolean))];
  cardIds.forEach(id => {
    ks.add(String(id));
    const card = getTtCardById(id);
    [card?.subject, card?.templateId, card?.name, card?.title].forEach(v => {
      const s = String(v || "").trim(); if (s) ks.add(s);
    });
  });
  return [...ks];
}
function ttCollectRole(e, mode) {
  const keys = ttRoleLookupKeys(e);
  const directKeys = mode === "hard" ? TT_HARD_KEYS : TT_NONEX_KEYS;
  const out = [];
  for (const src of ttRoleSources()) {
    directKeys.forEach(k => { if (src[k]) out.push(...ttNormNames(src[k])); });               // 전역 배열
    for (const dk of directKeys) {                                                              // bucket[과목]
      const bucket = src[dk];
      if (bucket && typeof bucket === "object" && !Array.isArray(bucket)) {
        keys.forEach(k => { if (bucket[k]) out.push(...ttNormNames(bucket[k])); });
      }
    }
    keys.forEach(k => {                                                                         // src[과목].nonExclusiveTeachers
      const item = src[k];
      if (item && typeof item === "object" && !Array.isArray(item)) {
        directKeys.forEach(dk => { if (item[dk]) out.push(...ttNormNames(item[dk])); });
      }
    });
  }
  return [...new Set(out)];
}
function resolveHardTeachersForEntry(e = {}) {
  const all = splitTeacherNames(e.teacherName || "").map(s => String(s).trim()).filter(Boolean);
  const explicitHard = ttCollectRole(e, "hard");
  if (explicitHard.length) return explicitHard.filter(t => all.includes(t) || !all.length);
  const soft = new Set(ttCollectRole(e, "nonExclusive"));
  if (!soft.size) return all;
  const hard = all.filter(t => !soft.has(t));
  return hard.length ? hard : all; // zero-out 방지
}

// 콘솔 헬퍼: 과목 단위로 공동교사(비점유) 선언 → 즉시 충돌 재계산·저장. UI 없이 안전 적용.
globalThis.HIS_setTeacherRole = function (subject, coTeacherNames) {
  try {
    const dom = ttDomain();
    const map = dom.teacherRoleOverrides || (dom.teacherRoleOverrides = {});
    const key = String(subject || "").trim();
    if (!key) { console.warn("subject(과목명)가 비어 있습니다."); return map; }
    if (coTeacherNames == null) {
      delete map[key];
      console.log("교사 역할 해제:", key);
    } else {
      const list = (Array.isArray(coTeacherNames) ? coTeacherNames : [coTeacherNames]).map(s => String(s).trim()).filter(Boolean);
      map[key] = { nonExclusiveTeachers: list };
      console.log("공동교사(시간 비점유) 지정:", key, "→", list);
    }
    try { recomputeConflicts(); } catch (_) {}
    try { renderAll(); } catch (_) {}
    try { scheduleSave(); } catch (_) { try { saveNow(); } catch (__) {} }
    return JSON.parse(JSON.stringify(map));
  } catch (e) { console.error("HIS_setTeacherRole 실패:", e); }
};
globalThis.HIS_showTeacherRoles = function () {
  const map = ttDomain()?.teacherRoleOverrides || {};
  console.log(JSON.parse(JSON.stringify(map)));
  return map;
};
globalThis.HIS_listMultiTeacherCards = function () {
  const seen = new Map();
  (appState.timetable?.ttcards || []).forEach(c => {
    const tn = String(c?.teacherName || "").trim();
    if (tn && splitTeacherNames(tn).length > 1 && !seen.has(c.subject + "|" + tn)) {
      seen.set(c.subject + "|" + tn, { 과목: c.subject || "", 교사: splitTeacherNames(tn).join(", ") });
    }
  });
  const rows = [...seen.values()];
  console.table(rows);
  console.log("지정 예: HIS_setTeacherRole('" + (rows[0]?.과목 || "과목명") + "', ['공동교사1','공동교사2'])");
  return rows;
};

function recomputeConflicts() {
  conflictMap   = detectConflicts(
    entries(),
    appState.timetable.ttcardGroups,
    [],
    audienceForPlacement,
    {
      getProtectedGrades: protectedGradesForEntry,
      getCompoundPartRefs: compoundPartRefsForPlacement,
      rooms: getEffectiveRoomsForTimetable(),
      getHardTeachers: resolveHardTeachersForEntry,
      getRoomIdsForEntry: effectiveRoomIdsForEntry,
      entryNeedsRoom: entryNeedsAnyRoom,
      entryHasRoomMissing: entryHasMissingRoomAssignment
    }
  );
  constraintMap = detectConstraintViolations(entries(), constraints());
}

// ── Grid rendering ────────────────────────────────────────────────
const ENTRY_CONTEXT_SELECTOR = [
  ".tt-entry-card[data-entry-id]",
  ".tt-all-summary-card[data-entry-id]",
  "[data-tt-entry-id]",
  "[data-entry-id]"
].join(",");

function isEventInsideTimetableGrid(ev) {
  const grid = ttGrid();
  if (!grid) return false;
  const target = ev.target && ev.target.nodeType === 1
    ? ev.target
    : ev.target?.parentElement || null;
  if (target && grid.contains(target)) return true;
  if (Number.isFinite(ev.clientX) && Number.isFinite(ev.clientY)) {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (el && grid.contains(el)) return true;
  }
  return false;
}

function getContextMenuEntryCardFromEvent(ev) {
  const grid = ttGrid();
  if (!grid) return null;

  const findIn = node => {
    if (!node || node.nodeType !== 1) return null;
    if (node.matches?.(ENTRY_CONTEXT_SELECTOR) && grid.contains(node)) return node;
    const card = node.closest?.(ENTRY_CONTEXT_SELECTOR);
    return card && grid.contains(card) ? card : null;
  };

  const directTarget = ev.target && ev.target.nodeType === 1
    ? ev.target
    : ev.target?.parentElement || null;
  const directCard = findIn(directTarget);
  if (directCard) return directCard;

  const path = typeof ev.composedPath === "function" ? ev.composedPath() : [];
  for (const node of path) {
    const card = findIn(node);
    if (card) return card;
  }

  if (Number.isFinite(ev.clientX) && Number.isFinite(ev.clientY)) {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const card = findIn(el);
    if (card) return card;
  }
  return null;
}

function getEntryIdFromContextMenuNode(node) {
  if (!node) return "";
  return clean(node.dataset?.entryId || node.dataset?.ttEntryId || "");
}

let lastEntryContextMenuAt = 0;
let lastEntryContextMenuKey = "";
function openEntryContextMenuFromDomEvent(ev, source = "contextmenu") {
  if (source !== "contextmenu" && ev.button !== 2) return false;

  // 시간표 영역 안의 우클릭은 먼저 브라우저 기본 메뉴를 막습니다.
  // 기존 방식은 카드 식별에 실패하면 preventDefault가 실행되지 않아
  // Windows/Chrome 기본 우클릭 메뉴가 떠버렸습니다.
  const insideGrid = isEventInsideTimetableGrid(ev);
  if (!insideGrid) return false;
  ev.preventDefault?.();
  ev.stopPropagation?.();
  ev.stopImmediatePropagation?.();

  const card = getContextMenuEntryCardFromEvent(ev);
  if (!card) return true;

  const entryId = getEntryIdFromContextMenuNode(card);
  const entry = entries().find(e => e.id === entryId);
  if (!entry) return true;

  const now = Date.now();
  const key = `${entry.id}|${Math.round(ev.clientX)}|${Math.round(ev.clientY)}`;
  if (lastEntryContextMenuKey === key && now - lastEntryContextMenuAt < 450) {
    return true;
  }
  lastEntryContextMenuAt = now;
  lastEntryContextMenuKey = key;

  showEntryContextMenu(entry, ev.clientX, ev.clientY);
  return true;
}

function ensureTimetableContextMenuDelegation() {
  if (timetableContextMenuDelegationInstalled) return;
  timetableContextMenuDelegationInstalled = true;

  // document/window 양쪽 캡처에 설치합니다.
  // 일부 레이아웃에서는 #ttGrid가 다시 렌더링되거나 요약 카드가 들어오면서
  // 카드 자체 리스너가 붙지 않는 경우가 있어 전역 캡처가 가장 안전합니다.
  const handler = ev => openEntryContextMenuFromDomEvent(ev, "contextmenu");
  const downHandler = ev => openEntryContextMenuFromDomEvent(ev, "mousedown");
  window.addEventListener("contextmenu", handler, true);
  document.addEventListener("contextmenu", handler, true);
  window.addEventListener("mousedown", downHandler, true);
  document.addEventListener("mousedown", downHandler, true);
}

function renderGrid() {
  ensureTimetableContextMenuDelegation();
  renderTimetableGrid({
    wrap: ttGrid(),
    currentView,
    currentGrade,
    currentTeacher,
    currentRoom,
    periods: ttConfig().periodLabels,
    entries: entries(),
    getDragData: () => dragData,
    setDragData: value => { dragData = value; if (value) applyDragHighlight(value); else clearDragHighlight(); },
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
    const hasStoredAudience = (Array.isArray(card.classKeys) && card.classKeys.length)
      || (Array.isArray(card.classLabels) && card.classLabels.length);
    const whole = !!card.isWholeGrade || (!hasStoredAudience && isProtectedWholeGradeLabel(
      card.subject, card.subjectEn, card.label, card.category, card.track, card.group, card.nameKo, card.nameEn
    ));
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

    // 채플/창체/전체학년 수업은 학년·반 범위가 겹치면 막습니다.
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

const MANUAL_BLOCKING_CONFLICTS = new Set(["teacher", "room", "roomUnavailable", "student"]);

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
      {
        getProtectedGrades: protectedGradesForEntry,
        getCompoundPartRefs: compoundPartRefsForPlacement,
        rooms: getEffectiveRoomsForTimetable(),
        getHardTeachers: resolveHardTeachersForEntry,
        getRoomIdsForEntry: effectiveRoomIdsForEntry,
        entryNeedsRoom: entryNeedsAnyRoom,
        entryHasRoomMissing: entryHasMissingRoomAssignment
      }
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

  const scopedClassKeys = Array.isArray(entry?.audienceClassKeys) ? entry.audienceClassKeys.map(clean).filter(Boolean) : [];
  if (scopedClassKeys.length) {
    scopedClassKeys.forEach(key => {
      const info = classInfoFromAudienceClassKey(key);
      addLabel(info.gradeKey, info.section);
    });
    if (parts.length) return parts.join(", ");
  }

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


// ── Fixed lesson manager ────────────────────────────────────────
// 자동배치 전에 채플/자율활동/동아리처럼 반드시 특정 시간에 있어야 하는
// 수업을 "고정"해 두면, 자동배치 초기화/탐색/후처리 단계가 해당 슬롯을 침범하지 않습니다.
const FIXED_DAY_LABELS = ["월", "화", "수", "목", "금"];

function fixedSlotLabel(entry = {}) {
  const day = FIXED_DAY_LABELS[entry.day] ?? "?";
  const period = ttConfig().periodLabels?.[entry.period] || `${Number(entry.period || 0) + 1}교시`;
  return `${day} ${period}`;
}

function entryPinBlockKey(entry = {}) {
  const day = Number.isInteger(entry.day) ? entry.day : "?";
  const period = Number.isInteger(entry.period) ? entry.period : "?";
  if (entry.groupId) return `group:${entry.groupId}:${day}:${period}`;
  if (entry.unitId) return `unit:${entry.unitId}:${day}:${period}`;
  return `entry:${entry.id}`;
}

function getEntryPinBlockEntries(entry = {}) {
  const key = entryPinBlockKey(entry);
  if (!entry?.id) return [];
  if (key.startsWith("entry:")) return entries().filter(e => e.id === entry.id);
  if (entry.groupId) return entries().filter(e => e.groupId === entry.groupId && e.day === entry.day && e.period === entry.period);
  if (entry.unitId) return entries().filter(e => e.unitId === entry.unitId && e.day === entry.day && e.period === entry.period);
  return entries().filter(e => e.id === entry.id);
}

function setEntryPinBlockPinned(entry, value = true, { rerender = true, label = "수업 고정 변경" } = {}) {
  if (!canEdit() || !entry) return 0;
  const block = getEntryPinBlockEntries(entry);
  if (!block.length) return 0;
  const next = !!value;
  if (block.every(e => !!e.pinned === next)) return 0;
  captureTimetableUndo(label);
  block.forEach(e => { e.pinned = next; });
  scheduleSave("timetable");
  recomputeConflicts();
  if (rerender) renderAll();
  return block.length;
}

function toggleEntryPinnedBlock(entry) {
  const block = getEntryPinBlockEntries(entry);
  const allPinned = block.length && block.every(e => e.pinned);
  return setEntryPinBlockPinned(entry, !allPinned, { label: allPinned ? "수업 고정 해제" : "수업 고정" });
}

function getFixedBlockTitle(block = []) {
  const first = block[0] || {};
  const groupName = clean(first.groupName || ((appState.timetable?.ttcardGroups || []).find(g => g.id === first.groupId)?.name));
  const title = groupName || entryTitle(first) || "수업";
  const classes = [...new Set(block.map(e => getEntryClassSummary(e)).filter(Boolean))].join(" / ");
  return { title, classes };
}

function getPlacedEntryBlocks() {
  const map = new Map();
  entries()
    .filter(e => Number.isInteger(e.day) && Number.isInteger(e.period))
    .forEach(e => {
      const key = entryPinBlockKey(e);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    });
  return [...map.values()].sort((a, b) => {
    const ea = a[0] || {}, eb = b[0] || {};
    return (ea.day - eb.day) || (ea.period - eb.period) || getFixedBlockTitle(a).title.localeCompare(getFixedBlockTitle(b).title, "ko", { numeric: true });
  });
}

function setPinnedForBlocks(blocks = [], value = true, label = "고정 수업 일괄 변경") {
  if (!canEdit()) return;
  const targets = (blocks || []).flat().filter(Boolean);
  if (!targets.length) return;
  const next = !!value;
  if (targets.every(e => !!e.pinned === next)) return;
  captureTimetableUndo(label);
  targets.forEach(e => { e.pinned = next; });
  scheduleSave("timetable");
  recomputeConflicts();
  renderAll();
}

// ── Saved timetable versions ─────────────────────────────────────
const savedSchedules = () => {
  const domain = ttDomain();
  if (!Array.isArray(domain.savedSchedules)) domain.savedSchedules = [];
  return domain.savedSchedules;
};

function cloneTimetableEntries(list = entries()) {
  return (list || []).map(e => normalizeTimetableEntry(JSON.parse(JSON.stringify(e || {}))));
}

function formatVersionDate(iso) {
  const d = new Date(iso || Date.now());
  if (Number.isNaN(d.getTime())) return "날짜 없음";
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultSavedScheduleName() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `배치 ${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getEntryIdentityKey(entry = {}) {
  const cardIds = [...(entry.ttcardIds || []), entry.ttcardId].map(clean).filter(Boolean).sort();
  if (cardIds.length) return `cards:${cardIds.join("|")}`;
  const tpl = [...(entry.templateIds || []), entry.templateId].map(clean).filter(Boolean).sort().join("|");
  const grades = [...(entry.gradeKeys || []), entry.gradeKey].map(clean).filter(Boolean).sort().join("|");
  return ["entry", entry.groupId || "", entry.unitId || "", tpl, grades, entry.sectionIdx ?? 0, clean(entry.teacherName)].join(":");
}

function getEntryPlacementKey(entry = {}) {
  return `${entry.day}:${entry.period}:${getEntryIdentityKey(entry)}`;
}

function buildSavedScheduleStats(list = entries()) {
  const src = list || [];
  const identitySet = new Set();
  const placementSet = new Set();
  const slotBlocks = new Set();
  const classSlotCounts = new Map();
  let pinned = 0;
  let roomAssigned = 0;

  src.forEach(entry => {
    if (!entry) return;
    identitySet.add(getEntryIdentityKey(entry));
    placementSet.add(getEntryPlacementKey(entry));
    const blockKey = entry.groupId
      ? `group:${entry.groupId}:${entry.day}:${entry.period}`
      : `entry:${getEntryIdentityKey(entry)}:${entry.day}:${entry.period}`;
    slotBlocks.add(blockKey);
    if (entry.pinned) pinned += 1;
    if (effectiveRoomIdsForEntry(entry).length) roomAssigned += 1;
    try {
      const occ = getEntryOccupancy(entry, {
        getTtCardById,
        templateGroups: appState.timetable?.ttcardGroups || []
      });
      const labels = [...(occ.classLabels || new Set())].filter(Boolean);
      labels.forEach(label => classSlotCounts.set(label, (classSlotCounts.get(label) || 0) + 1));
    } catch (_) {}
  });

  const classSummary = [...classSlotCounts.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko", { numeric: true }));
  return {
    entryCount: src.length,
    blockCount: slotBlocks.size,
    pinned,
    roomAssigned,
    identitySet,
    placementSet,
    classSummary,
  };
}

function compareSavedScheduleToCurrent(version) {
  const current = buildSavedScheduleStats(entries());
  const saved = buildSavedScheduleStats(version?.entries || []);
  let samePlacement = 0;
  saved.placementSet.forEach(k => { if (current.placementSet.has(k)) samePlacement += 1; });

  let sameIdentity = 0;
  saved.identitySet.forEach(k => { if (current.identitySet.has(k)) sameIdentity += 1; });

  const added = Math.max(0, current.identitySet.size - sameIdentity);
  const removed = Math.max(0, saved.identitySet.size - sameIdentity);
  const moved = Math.max(0, sameIdentity - samePlacement);
  return { current, saved, samePlacement, sameIdentity, added, removed, moved };
}

function buildVersionCompareHtml(version) {
  const c = compareSavedScheduleToCurrent(version);
  const classText = c.saved.classSummary.slice(0, 18).map(([label, count]) => `${label} ${count}`).join(" · ") || "학급 점유 없음";
  return `<div class="tt-version-compare">
    <h4>현재 배치와 비교: ${escapeHtml(version?.name || "저장 배치")}</h4>
    <div>저장본: 배치 ${c.saved.entryCount}개 / 수업블록 ${c.saved.blockCount}개 / 교실지정 ${c.saved.roomAssigned}개 / 고정 ${c.saved.pinned}개</div>
    <div>현재본: 배치 ${c.current.entryCount}개 / 수업블록 ${c.current.blockCount}개 / 교실지정 ${c.current.roomAssigned}개 / 고정 ${c.current.pinned}개</div>
    <div>같은 위치 ${c.samePlacement}개 · 위치 변경 가능 ${c.moved}개 · 현재에만 있음 ${c.added}개 · 저장본에만 있음 ${c.removed}개</div>
    <div style="margin-top:6px;color:#64748b">저장본 학급별 점유 참고: ${escapeHtml(classText)}</div>
  </div>`;
}

function saveCurrentScheduleVersion(name = "") {
  if (!canEdit()) return;
  const version = {
    id: uid("ttv"),
    name: clean(name) || defaultSavedScheduleName(),
    note: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    periodCount: ttConfig().periodCount,
    entryCount: entries().length,
    entries: cloneTimetableEntries(entries()),
  };
  savedSchedules().unshift(version);
  ttDomain().savedSchedules = savedSchedules().slice(0, 30);
  void saveNow("timetable", { force: true });
  renderAll();
  return version;
}

function loadSavedScheduleVersion(versionId) {
  if (!canEdit()) return;
  const version = savedSchedules().find(v => v.id === versionId);
  if (!version) return;
  const msg = `저장된 배치 "${version.name}"을 불러올까요?\n\n현재 시간표 배치는 저장본의 배치로 교체됩니다.\n카드/그룹/교사조건은 그대로 유지됩니다.`;
  if (!confirm(msg)) return;
  captureTimetableUndo(`저장 배치 불러오기: ${version.name}`);
  ttDomain().entries = cloneTimetableEntries(version.entries || []);
  if (version.periodCount && version.periodCount !== ttConfig().periodCount) {
    const applyPeriod = confirm(`저장본은 ${version.periodCount}교시 기준입니다. 현재 교시 설정도 ${version.periodCount}교시로 바꿀까요?`);
    if (applyPeriod) setPeriodCount(version.periodCount);
  }
  void saveNow("timetable", { force: true });
  recomputeConflicts();
  renderAll();
}

function renameSavedScheduleVersion(versionId) {
  if (!canEdit()) return;
  const version = savedSchedules().find(v => v.id === versionId);
  if (!version) return;
  const next = prompt("저장 배치 이름을 입력하세요.", version.name || "");
  if (next == null) return;
  version.name = clean(next) || version.name;
  version.updatedAt = new Date().toISOString();
  void saveNow("timetable", { force: true });
  openScheduleVersionManager();
}

function duplicateSavedScheduleVersion(versionId) {
  if (!canEdit()) return;
  const version = savedSchedules().find(v => v.id === versionId);
  if (!version) return;
  const copy = {
    ...JSON.parse(JSON.stringify(version)),
    id: uid("ttv"),
    name: `${version.name || "저장 배치"} 복사본`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    entries: cloneTimetableEntries(version.entries || []),
  };
  savedSchedules().unshift(copy);
  void saveNow("timetable", { force: true });
  openScheduleVersionManager();
}

function deleteSavedScheduleVersion(versionId) {
  if (!canEdit()) return;
  const version = savedSchedules().find(v => v.id === versionId);
  if (!version) return;
  if (!confirm(`저장 배치 "${version.name}"을 삭제할까요? 현재 시간표에는 영향을 주지 않습니다.`)) return;
  ttDomain().savedSchedules = savedSchedules().filter(v => v.id !== versionId);
  void saveNow("timetable", { force: true });
  openScheduleVersionManager();
}

function exportSavedScheduleVersion(versionId) {
  const version = savedSchedules().find(v => v.id === versionId);
  if (!version) return;
  const payload = {
    version: 1,
    mode: "his-timetable-saved-schedule",
    exportedAt: new Date().toISOString(),
    schedule: version,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(version.name || "timetable-schedule").replace(/[\\/:*?"<>|]+/g, "_")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function importSavedScheduleVersion(file) {
  if (!canEdit() || !file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const raw = parsed.schedule || parsed;
      const imported = {
        id: uid("ttv"),
        name: clean(raw.name) || `가져온 배치 ${formatVersionDate(new Date().toISOString())}`,
        note: clean(raw.note),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        periodCount: Math.max(1, Math.min(12, parseInt(raw.periodCount) || ttConfig().periodCount)),
        entries: Array.isArray(raw.entries) ? raw.entries.map(normalizeTimetableEntry).filter(e => e.templateId) : [],
      };
      imported.entryCount = imported.entries.length;
      if (!imported.entries.length) throw new Error("entries가 없습니다.");
      savedSchedules().unshift(imported);
      void saveNow("timetable", { force: true });
      openScheduleVersionManager();
    } catch (e) {
      alert(`배치 파일을 불러올 수 없습니다.\n${e?.message || e}`);
    }
  };
  reader.readAsText(file);
}

function openScheduleVersionManager() {
  const old = document.getElementById("ttScheduleVersionsOverlay");
  old?.remove();
  const versions = savedSchedules();
  const currentStats = buildSavedScheduleStats(entries());
  const overlay = document.createElement("div");
  overlay.id = "ttScheduleVersionsOverlay";
  overlay.className = "tt-version-overlay";
  overlay.innerHTML = `
    <div class="tt-version-modal" role="dialog" aria-modal="true" aria-labelledby="ttScheduleVersionsTitle">
      <div class="tt-version-head">
        <div>
          <p class="tt-version-kicker">배치 버전 관리</p>
          <h3 id="ttScheduleVersionsTitle">저장된 시간표 배치</h3>
          <p>커리큘럼 카드나 교사 조건은 그대로 두고, 시간표에 배치된 entries만 버전별로 저장하고 불러옵니다.</p>
        </div>
        <button type="button" class="tt-version-close" aria-label="닫기">×</button>
      </div>
      <div class="tt-version-body">
        <div class="tt-version-summary">
          <span>현재 배치 <b>${currentStats.entryCount}</b>개</span>
          <span>현재 수업블록 <b>${currentStats.blockCount}</b>개</span>
          <span>저장본 <b>${versions.length}</b>개</span>
        </div>
        <div class="tt-version-savebox">
          <input id="ttVersionNameInput" type="text" value="${escapeHtml(defaultSavedScheduleName())}" aria-label="저장할 배치 이름">
          <button type="button" data-action="save-current">현재 배치 저장</button>
        </div>
        <div class="tt-version-actions">
          <button type="button" class="secondary" data-action="export-current">현재 배치 JSON 내보내기</button>
          <button type="button" class="secondary" data-action="import-json">JSON 가져오기</button>
          <input id="ttVersionImportFile" type="file" accept="application/json,.json" hidden>
        </div>
        <div id="ttVersionCompareBox"></div>
        <div class="tt-version-list">
          ${versions.length ? versions.map(v => {
            const stats = buildSavedScheduleStats(v.entries || []);
            return `<div class="tt-version-row" data-id="${escapeHtml(v.id)}">
              <div>
                <div class="tt-version-row-title">${escapeHtml(v.name || "저장 배치")}</div>
                <div class="tt-version-row-meta">
                  <span>${escapeHtml(formatVersionDate(v.createdAt))}</span>
                  <span>배치 ${stats.entryCount}개</span>
                  <span>블록 ${stats.blockCount}개</span>
                  <span>교실 ${stats.roomAssigned}개</span>
                  <span>고정 ${stats.pinned}개</span>
                </div>
              </div>
              <div class="tt-version-row-buttons">
                <button type="button" data-action="load" data-id="${escapeHtml(v.id)}">불러오기</button>
                <button type="button" class="secondary" data-action="compare" data-id="${escapeHtml(v.id)}">비교</button>
                <button type="button" class="secondary" data-action="rename" data-id="${escapeHtml(v.id)}">이름</button>
                <button type="button" class="secondary" data-action="duplicate" data-id="${escapeHtml(v.id)}">복사</button>
                <button type="button" class="secondary" data-action="export" data-id="${escapeHtml(v.id)}">내보내기</button>
                <button type="button" class="danger" data-action="delete" data-id="${escapeHtml(v.id)}">삭제</button>
              </div>
            </div>`;
          }).join("") : `<div class="tt-version-empty">아직 저장된 배치가 없습니다. 현재 시간표를 배치한 뒤 “현재 배치 저장”을 눌러 주세요.</div>`}
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".tt-version-close")?.addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-action="save-current"]')?.addEventListener("click", () => {
    const name = overlay.querySelector("#ttVersionNameInput")?.value || "";
    saveCurrentScheduleVersion(name);
    openScheduleVersionManager();
  });
  overlay.querySelector('[data-action="export-current"]')?.addEventListener("click", () => {
    const temp = { id: uid("ttv"), name: clean(overlay.querySelector("#ttVersionNameInput")?.value) || defaultSavedScheduleName(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), periodCount: ttConfig().periodCount, entries: cloneTimetableEntries(entries()) };
    temp.entryCount = temp.entries.length;
    savedSchedules().unshift(temp);
    exportSavedScheduleVersion(temp.id);
    ttDomain().savedSchedules = savedSchedules().filter(v => v.id !== temp.id);
  });
  overlay.querySelector('[data-action="import-json"]')?.addEventListener("click", () => overlay.querySelector("#ttVersionImportFile")?.click());
  overlay.querySelector("#ttVersionImportFile")?.addEventListener("change", e => importSavedScheduleVersion(e.target.files?.[0]));
  overlay.querySelectorAll("[data-action][data-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === "load") { close(); loadSavedScheduleVersion(id); }
      else if (action === "compare") {
        const version = savedSchedules().find(v => v.id === id);
        const box = overlay.querySelector("#ttVersionCompareBox");
        if (box && version) box.innerHTML = buildVersionCompareHtml(version);
      } else if (action === "rename") renameSavedScheduleVersion(id);
      else if (action === "duplicate") duplicateSavedScheduleVersion(id);
      else if (action === "export") exportSavedScheduleVersion(id);
      else if (action === "delete") deleteSavedScheduleVersion(id);
    });
  });
}

function openFixedLessonManager() {
  const old = document.getElementById("ttFixedLessonsOverlay");
  old?.remove();

  const blocks = getPlacedEntryBlocks();
  const pinnedBlocks = blocks.filter(block => block.some(e => e.pinned));
  const autoFixedRe = /(채플|자율|동아리|진로|성품|리더십|선교적|Chapel|Activity|Club|Vision|Leadership)/i;

  const overlay = document.createElement("div");
  overlay.id = "ttFixedLessonsOverlay";
  overlay.className = "tt-fixed-overlay";
  overlay.innerHTML = `
    <div class="tt-fixed-modal" role="dialog" aria-modal="true" aria-labelledby="ttFixedLessonsTitle">
      <div class="tt-fixed-head">
        <div>
          <p class="tt-fixed-kicker">자동배치 사전 설정</p>
          <h3 id="ttFixedLessonsTitle">고정 수업 관리</h3>
          <p>특정 시간에 반드시 유지할 수업을 고정하면 자동배치가 해당 수업과 시간대를 보호합니다.</p>
        </div>
        <button type="button" class="tt-fixed-close" aria-label="닫기">×</button>
      </div>
      <div class="tt-fixed-summary">
        <span>배치된 수업 묶음 <b>${blocks.length}</b>개</span>
        <span>고정됨 <b>${pinnedBlocks.length}</b>개</span>
        <span>고정 수업은 초기화·자동배치·후처리에서 보호</span>
      </div>
      <div class="tt-fixed-actions">
        <button type="button" data-action="pin-activities">채플·자율·동아리 자동 고정</button>
        <button type="button" data-action="pin-all">현재 배치 모두 고정</button>
        <button type="button" data-action="unpin-all">고정 모두 해제</button>
      </div>
      <div class="tt-fixed-list">
        ${blocks.length ? blocks.map((block, idx) => {
          const first = block[0] || {};
          const { title, classes } = getFixedBlockTitle(block);
          const allPinned = block.every(e => e.pinned);
          const somePinned = block.some(e => e.pinned);
          const teachers = [...new Set(block.flatMap(e => splitTeacherNames(e.teacherName || "")))].filter(Boolean).join(", ");
          const roomNames = [...new Set(block.map(e => e.roomId ? getRoomDisplayName(e.roomId) : "").filter(Boolean))].join(", ");
          const type = first.groupId ? "그룹" : first.unitId ? "묶음" : "개별";
          return `<div class="tt-fixed-row ${allPinned ? "is-pinned" : somePinned ? "is-partial" : ""}" data-idx="${idx}">
            <div class="tt-fixed-row-main">
              <div class="tt-fixed-row-title"><span>${escapeHtml(title)}</span><em>${escapeHtml(type)}</em></div>
              <div class="tt-fixed-row-meta">
                <span>${escapeHtml(fixedSlotLabel(first))}</span>
                <span>${escapeHtml(classes || "대상 반 없음")}</span>
                ${teachers ? `<span>${escapeHtml(teachers)}</span>` : ""}
                ${roomNames ? `<span>${escapeHtml(roomNames)}</span>` : ""}
                <span>${block.length}개 카드</span>
              </div>
            </div>
            <button type="button" class="tt-fixed-toggle" data-idx="${idx}">${allPinned ? "고정 해제" : somePinned ? "부분 고정 → 전체 고정" : "고정"}</button>
          </div>`;
        }).join("") : `<div class="tt-fixed-empty">아직 시간표에 배치된 수업이 없습니다. 먼저 하단 과목카드를 시간표에 올려 주세요.</div>`}
      </div>
      <div class="tt-fixed-foot">
        <button type="button" class="tt-fixed-close2">닫기</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector(".tt-fixed-close")?.addEventListener("click", close);
  overlay.querySelector(".tt-fixed-close2")?.addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

  overlay.querySelectorAll(".tt-fixed-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const block = blocks[Number(btn.dataset.idx)] || [];
      if (!block.length) return;
      const allPinned = block.every(e => e.pinned);
      setPinnedForBlocks([block], !allPinned, allPinned ? "고정 수업 해제" : "고정 수업 지정");
      close();
      openFixedLessonManager();
    });
  });

  overlay.querySelector('[data-action="pin-activities"]')?.addEventListener("click", () => {
    const targets = blocks.filter(block => {
      const { title } = getFixedBlockTitle(block);
      const text = [title, ...block.map(e => entryTitle(e)), ...block.map(e => e.groupName || "")].join(" ");
      return autoFixedRe.test(text);
    });
    if (!targets.length) { alert("자동으로 찾을 수 있는 채플·자율·동아리 계열 수업이 없습니다."); return; }
    setPinnedForBlocks(targets, true, "채플·자율·동아리 고정");
    close();
    openFixedLessonManager();
  });

  overlay.querySelector('[data-action="pin-all"]')?.addEventListener("click", () => {
    if (!blocks.length) return;
    if (!confirm("현재 배치된 모든 수업을 고정할까요? 자동배치가 거의 모든 기존 배치를 유지하게 됩니다.")) return;
    setPinnedForBlocks(blocks, true, "현재 배치 전체 고정");
    close();
    openFixedLessonManager();
  });

  overlay.querySelector('[data-action="unpin-all"]')?.addEventListener("click", () => {
    if (!pinnedBlocks.length) return;
    if (!confirm("모든 고정 표시를 해제할까요?")) return;
    setPinnedForBlocks(blocks, false, "고정 수업 전체 해제");
    close();
    openFixedLessonManager();
  });
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
  getEntryPinBlockEntries,
  toggleEntryPinnedBlock,
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
  const roomSummary = entryRoomSummary(entry);
  if (roomSummary) {
    const roomBadge = document.createElement("div");
    roomBadge.className = "tt-entry-room2";
    roomBadge.textContent = roomSummary;
    const roomNames = effectiveRoomIdsForEntry(entry).map(getRoomDisplayName).join(", ");
    roomBadge.title = `교실: ${roomNames || roomSummary}`;
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

  card.dataset.entryId = entry.id;

  // Right-click → context menu. Keep this direct listener, but route it through
  // the same robust opener used by the document-level fallback.
  card.addEventListener("contextmenu", ev => {
    openEntryContextMenuFromDomEvent(ev, "contextmenu");
  });
  card.addEventListener("mousedown", ev => {
    openEntryContextMenuFromDomEvent(ev, "mousedown");
  });

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
function entryMoveUnitKeyForDrag(entry = {}) {
  const raw = [
    entry.autoBlockKey,
    entry.autoScheduleUnitKey,
    entry.groupMoveKey,
    entry.unitKey,
  ].map(v => String(v || "").trim()).find(Boolean);
  if (raw) return raw;
  if (entry.groupId && entry.unitId) return `group-unit:${entry.groupId}:${entry.unitId}`;
  if (entry.groupId) return `group:${entry.groupId}`;
  if (entry.unitId) return `unit:${entry.unitId}`;
  return "";
}

function moveEntry(entryId, day, period) {
  if (!canEdit()) return;
  const e = entries().find(x => x.id === entryId); if (!e || e.pinned) return;
  if (e.day === day && e.period === period) return;

  const fromDay = e.day;
  const fromPeriod = e.period;
  const moveKey = entryMoveUnitKeyForDrag(e);
  const linkedEntries = moveKey
    ? entries().filter(x => x.day === fromDay && x.period === fromPeriod && entryMoveUnitKeyForDrag(x) === moveKey)
    : [e];
  if (!linkedEntries.length || linkedEntries.some(x => x.pinned)) return;

  // 그룹카드는 시각적으로도 계산상으로도 하나의 큰 카드처럼 움직입니다.
  // 같은 시간대의 동일 group/unit/autoBlockKey 엔트리는 일부만 이동하지 않고 함께 이동합니다.
  captureTimetableUndo(linkedEntries.length > 1 ? "그룹카드 이동" : "수업 이동");
  linkedEntries.forEach(item => { item.day = day; item.period = period; });
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
  setDragData: value => { dragData = value; if (value) applyDragHighlight(value); else clearDragHighlight(); },
  scheduleSave,
  saveNow,
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
  entryTitle,
  getEntryClassSummary,
  getRoomDisplayName,
  entryRoomSummary,
  effectiveRoomIdsForEntry,
  entryHasMissingRoomAssignment,
  getTtCards,
  getTtCardById,
  getTeachersForTtCard,
  getCreditsForTtCard,
  getTtCardClassLabels,
  describeTtCard,
  showSidebarCardDetail,
  showEntryDetail,
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
  GRADE_KEYS, canEdit, appState, scheduleSave, saveNow, normalizeTimetableEntry,
  uid, sectionLabel, gradeDisplay, splitTeacherNames,
  getTemplateById, getTemplateCardTitle, getTtCardById,
  describeTtCard, makePlacementFromGroupItem, getSubjectsForGrade, getCreditsForTtCard,
  getTeachersForTtCard,
  entries, ttDomain, ttConfig, constraints,
  buildSchedulableItems, getEffectiveAssignedRoomId, applyDefaultRoomToEntryData,
  audienceForPlacement, audiencesConflict, ttCardIdsFromPlacement, protectedSlotConflict,
  shuffle, captureTimetableUndo, addTimetableLog, setLastAutoAssignReport,
  getConflictCounts, recomputeConflicts, renderAll, $
});

// ── Room unavailable slots manager ───────────────────────────────
function slotKey(day, period) {
  return `${day}:${period}`;
}

function renderRoomUnavailableManager(container) {
  if (!container || container.querySelector("#ttRoomUnavailableManager")) return;
  const rooms = getRooms();
  const section = document.createElement("section");
  section.id = "ttRoomUnavailableManager";
  section.style.cssText = "margin-top:8px;border:1px solid #dbe4f0;border-radius:12px;background:#fff;box-shadow:0 4px 12px rgba(15,23,42,.045);overflow:hidden;";

  const head = document.createElement("div");
  head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#f8fafc;border-bottom:1px solid #e6edf7;";
  const title = document.createElement("div");
  title.innerHTML = `<strong style="display:block;font-size:13px;color:#102a43">교실 불가시간</strong><span style="display:block;margin-top:1px;font-size:10px;color:#64748b">교사 조건의 불가능 시간처럼, 교실도 특정 요일·교시를 막습니다.</span>`;
  const roomSelect = document.createElement("select");
  roomSelect.style.cssText = "height:28px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:0 8px;font-size:11px;font-weight:800;color:#334155;";
  if (!rooms.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "등록된 교실 없음";
    roomSelect.appendChild(opt);
  } else {
    const last = localStorage.getItem("his:tt:roomUnavailable:selected") || "";
    rooms.forEach(room => {
      const opt = document.createElement("option");
      opt.value = room.id;
      opt.textContent = room.name || room.id;
      if (room.id === last) opt.selected = true;
      roomSelect.appendChild(opt);
    });
  }
  head.append(title, roomSelect);
  section.appendChild(head);

  const body = document.createElement("div");
  body.style.cssText = "padding:8px 10px 10px;overflow:auto;";
  section.appendChild(body);

  const renderGrid = () => {
    body.innerHTML = "";
    const roomId = roomSelect.value;
    if (roomId) localStorage.setItem("his:tt:roomUnavailable:selected", roomId);
    if (!roomId) {
      body.textContent = "교실을 먼저 등록해 주세요.";
      body.style.color = "#64748b";
      body.style.fontSize = "11px";
      return;
    }
    const active = new Set(getRoomUnavailableSlots(roomId).map(s => slotKey(s.day, s.period)));
    const dayLabels = ["월", "화", "수", "목", "금"];
    const periodLabels = ttConfig().periodLabels || [];
    const grid = document.createElement("div");
    grid.style.cssText = `display:grid;grid-template-columns:42px repeat(${dayLabels.length},minmax(54px,1fr));gap:3px;min-width:360px;`;
    const corner = document.createElement("div");
    corner.textContent = "교시";
    corner.style.cssText = "display:flex;align-items:center;justify-content:center;height:24px;border-radius:7px;background:#eaf1fb;font-size:10px;font-weight:900;color:#334155;";
    grid.appendChild(corner);
    dayLabels.forEach(d => {
      const h = document.createElement("div");
      h.textContent = d;
      h.style.cssText = "display:flex;align-items:center;justify-content:center;height:24px;border-radius:7px;background:#f1f5f9;font-size:10px;font-weight:900;color:#334155;";
      grid.appendChild(h);
    });
    periodLabels.forEach((label, period) => {
      const p = document.createElement("div");
      p.textContent = label || `${period + 1}교시`;
      p.style.cssText = "display:flex;align-items:center;justify-content:center;min-height:28px;border-radius:7px;background:#f8fafc;border:1px solid #e2e8f0;font-size:10px;font-weight:900;color:#475569;";
      grid.appendChild(p);
      dayLabels.forEach((_, day) => {
        const btn = document.createElement("button");
        btn.type = "button";
        const key = slotKey(day, period);
        const on = active.has(key);
        btn.textContent = on ? "불가" : "가능";
        btn.disabled = !canEdit();
        btn.style.cssText = [
          "min-height:28px;border-radius:7px;font-size:10px;font-weight:900;cursor:pointer",
          on ? "border:1px solid #ef4444;background:#fee2e2;color:#991b1b" : "border:1px solid #bbf7d0;background:#f0fdf4;color:#166534",
          !canEdit() ? "opacity:.65;cursor:not-allowed" : ""
        ].join(";");
        btn.addEventListener("click", () => {
          if (!canEdit()) return;
          captureTimetableUndo("교실 불가시간 변경");
          const next = getRoomUnavailableSlots(roomId).filter(s => slotKey(s.day, s.period) !== key);
          if (!on) next.push({ day, period });
          setRoomUnavailableSlots(roomId, next);
          recomputeConflicts();
          // 기존에는 저장은 되었지만 현재 팝업의 표시는 renderAll()의 보호 로직 때문에
          // 즉시 갱신되지 않았습니다. 교실 불가시간 표만 먼저 다시 그린 뒤 전체 화면을 동기화합니다.
          renderGrid();
          renderAll();
        });
        grid.appendChild(btn);
      });
    });
    body.appendChild(grid);
  };
  roomSelect.addEventListener("change", renderGrid);
  renderGrid();
  container.appendChild(section);
}

// ── Schedule controls (toolbar) ───────────────────────────────────
function renderScheduleControls() {
  const pcInp = $("ttPeriodCountInput");
  if (pcInp) pcInp.value = String(ttConfig().periodCount);
}

function renderAll() {
  ensureTeacherCardsBottomTab();
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

  const teacherCardsEl = $("ttTeacherCardsContent");
  if (isVisible(teacherCardsEl)) {
    subscribeOptionalTimetableDomains();
    renderTeacherCardsPanel();
  }

  const roomsEl = $("ttRoomsContent");
  if (isVisible(roomsEl)) {
    subscribeOptionalTimetableDomains();
    renderRoomsView(roomsEl, renderAll, {
      timetableMode: true,
      hideSetupTools: true,
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
      },
      renderRoomUnavailableManager: target => renderRoomUnavailableManager(target)
    });
  }

  const logsEl = $("ttLogsContent");
  if (isVisible(logsEl)) renderLogPanel();
}

/** Called on dragstart: highlight relevant cells / sidebar cards */
function getDragTeacherNames(data = {}) {
  if (!data) return [];
  if (data.kind === "entry" && data.entryId) {
    const entry = entries().find(e => e.id === data.entryId);
    return entry ? splitTeacherNames(entry.teacherName || "") : [];
  }
  if (data.kind === "group" && data.groupId) {
    const grp = (appState.timetable.ttcardGroups || []).find(g => g.id === data.groupId);
    return grp ? getGroupCards(grp).flatMap(getTeachersForTtCard).filter(Boolean) : [];
  }
  if (data.unitId) {
    const grp = (appState.timetable.ttcardGroups || []).find(g => g.id === data.groupId);
    const unit = grp?.units?.find(u => u.id === data.unitId);
    const cards = (unit?.ttcardIds || []).map(id => getTtCardById(id)).filter(Boolean);
    return cards.length ? cards.flatMap(getTeachersForTtCard).filter(Boolean) : splitTeacherNames(data.teacherName || "");
  }
  if (data.ttcardId) {
    const card = getTtCardById(data.ttcardId);
    return card ? getTeachersForTtCard(card).filter(Boolean) : [];
  }
  if (data.templateId) return splitTeacherNames(data.teacherName || getTeachersForTemplate(data.templateId)[0] || "");
  return splitTeacherNames(data.teacherName || "");
}

function buildDragPreviewCandidates(data = {}, day, period, patch = {}) {
  if (!data) return { candidates: [], excludeIds: [] };
  const patched = { ...data, ...patch };
  const sectionIdx = patched.sectionIdx ?? 0;

  if (patched.kind === "entry" && patched.entryId) {
    const entry = entries().find(e => e.id === patched.entryId);
    if (!entry) return { candidates: [], excludeIds: [] };
    const siblings = (entry.groupId || entry.unitId) ? entries().filter(x =>
      x.id !== entry.id &&
      ((entry.groupId && x.groupId === entry.groupId) || (entry.unitId && x.unitId === entry.unitId)) &&
      x.day === entry.day && x.period === entry.period
    ) : [];
    const moving = [entry, ...siblings];
    return {
      candidates: moving.map(e => normalizeTimetableEntry({ ...e, day, period })),
      excludeIds: moving.map(e => e.id),
    };
  }

  if (patched.kind === "group" && patched.groupId) {
    const grp = (appState.timetable.ttcardGroups || []).find(g => g.id === patched.groupId);
    const cards = grp ? getGroupCards(grp) : [];
    const candidate = cards.length ? buildEntryDataFromTtCards(cards, { day, period, groupId: grp.id, groupName: grp.name || "" }) : null;
    return { candidates: candidate ? [candidate] : [], excludeIds: [] };
  }

  if (patched.unitId) {
    const grp = (appState.timetable.ttcardGroups || []).find(g => g.id === patched.groupId);
    const unit = grp?.units?.find(u => u.id === patched.unitId);
    const cards = (unit?.ttcardIds || []).map(id => getTtCardById(id)).filter(Boolean);
    const candidate = cards.length ? buildEntryDataFromTtCards(cards, { day, period, groupId: grp.id, unitId: unit.id, groupName: grp.name || "" }) : null;
    return { candidates: candidate ? [candidate] : [], excludeIds: [] };
  }

  if (patched.ttcardId) {
    const card = getTtCardById(patched.ttcardId);
    const candidate = card ? buildEntryDataFromTtCards([card], { day, period, groupId: patched.groupId || null, groupName: patched.groupName || "" }) : null;
    return { candidates: candidate ? [candidate] : [], excludeIds: [] };
  }

  if (patched.templateId) {
    const resolvedGrade = patched.gradeKey || currentGrade;
    const unitInfo = getUnitForTemplate(patched.templateId);
    if (unitInfo) {
      const { group, unit } = unitInfo;
      const gradeKeys = getUnitGradeKeys(unit);
      const teachers = getUnitTeachers(unit).join(",");
      return {
        candidates: [normalizeTimetableEntry({
          id: "__drag_preview_unit",
          day, period, sectionIdx,
          unitId: unit.id,
          groupId: group.id,
          templateIds: unit.templateIds,
          gradeKeys,
          templateId: unit.templateIds[0] || patched.templateId,
          gradeKey: gradeKeys[0] || resolvedGrade,
          teacherName: teachers,
          roomId: null,
        })],
        excludeIds: [],
      };
    }
    return {
      candidates: [normalizeTimetableEntry({
        id: "__drag_preview_subject",
        day, period,
        templateId: patched.templateId,
        sectionIdx,
        teacherName: patched.teacherName || getTeachersForTemplate(patched.templateId)[0] || "",
        roomId: null,
        gradeKey: resolvedGrade,
      })],
      excludeIds: [],
    };
  }

  return { candidates: [], excludeIds: [] };
}

function previewClassForBlock(block) {
  if (!block) return "tt-drag-preview-ok";
  if (block.kind === "protected") return "tt-drag-preview-student";
  const types = new Set(block.conflictTypes || []);
  if (types.has("teacher")) return "tt-drag-preview-teacher";
  if (types.has("room") || types.has("roomUnavailable")) return "tt-drag-preview-room";
  if (types.has("student")) return "tt-drag-preview-student";
  return "tt-drag-preview-student";
}

function clearDragPreviewClasses() {
  document.querySelectorAll([
    ".tt-drag-preview-ok",
    ".tt-drag-preview-student",
    ".tt-drag-preview-teacher",
    ".tt-drag-preview-room",
    ".tt-drag-preview-row-student",
    ".tt-drag-preview-row-teacher",
    ".tt-drag-preview-row-room",
    ".tt-drag-preview-slot-student",
    ".tt-drag-preview-slot-teacher",
    ".tt-drag-preview-slot-room",
  ].join(",")).forEach(el => {
    el.classList.remove(
      "tt-drag-preview-ok",
      "tt-drag-preview-student",
      "tt-drag-preview-teacher",
      "tt-drag-preview-room",
      "tt-drag-preview-row-student",
      "tt-drag-preview-row-teacher",
      "tt-drag-preview-row-room",
      "tt-drag-preview-slot-student",
      "tt-drag-preview-slot-teacher",
      "tt-drag-preview-slot-room",
    );
  });
}

function cancelDragPreviewWork() {
  dragPreviewToken += 1;
  if (dragPreviewRaf) {
    cancelAnimationFrame(dragPreviewRaf);
    dragPreviewRaf = 0;
  }
}

function isElementInViewport(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return false;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  return rect.bottom >= 0 && rect.top <= vh && rect.right >= 0 && rect.left <= vw;
}

function getDragTargetGradeKeys(data = {}) {
  const grades = new Set();
  const add = g => { if (g) grades.add(String(g)); };
  add(data?.gradeKey);

  const addCard = card => {
    if (!card) return;
    add(card.gradeKey);
    (card.gradeKeys || []).forEach(add);
    (card.classLabels || []).forEach(label => {
      const m = String(label || "").match(/\d{1,2}/);
      if (m) add(`${Number(m[0])}학년`);
    });
    (card.classKeys || []).forEach(key => {
      const g = String(key || "").split(":")[0];
      if (g) add(`${Number(g)}학년`);
    });
  };

  (data?.ttcardIds || []).forEach(id => addCard(getTtCardById(id)));
  if (data?.ttcardId) addCard(getTtCardById(data.ttcardId));
  if (data?.groupId) {
    const grp = (appState.timetable?.ttcardGroups || []).find(g => g.id === data.groupId);
    getGroupCards(grp).forEach(addCard);
  }
  return grades;
}

function getDragPreviewCells(data = {}) {
  const all = [...document.querySelectorAll(".tt-cell[data-day][data-period]")];
  const visible = all.filter(isElementInViewport);
  const source = visible.length ? visible : all.slice(0, DRAG_PREVIEW_MAX_VISIBLE_CELLS);

  // 하단 과목카드 드래그 때 전체보기의 모든 셀을 한 번에 검사하면 브라우저가 멈출 수 있습니다.
  // 현재 보이는 셀 위주로, 그리고 명확히 다른 학년 행은 가능한 줄여서 검사합니다.
  const targetGrades = getDragTargetGradeKeys(data);
  const filtered = targetGrades.size
    ? source.filter(cell => !cell.dataset.gradeKey || targetGrades.has(cell.dataset.gradeKey))
    : source;

  return filtered.slice(0, DRAG_PREVIEW_MAX_VISIBLE_CELLS);
}

function isRoomUnavailableForDragPreview(roomId, day, period) {
  if (!roomId) return false;
  return getRoomUnavailableSlots(roomId).some(s => s.day === day && s.period === period);
}

function entryHasUnavailableRoomForDragPreview(entry = {}, day, period) {
  return effectiveRoomIdsForEntry(entry).some(roomId => isRoomUnavailableForDragPreview(roomId, day, period));
}

function getSlotEntriesForPreview(day, period, excludeIds = new Set()) {
  return entries().filter(e => e && e.day === day && e.period === period && !excludeIds.has(e.id));
}

function getDragPreviewBlockLight(candidates, options = {}) {
  const candidateList = (Array.isArray(candidates) ? candidates : [candidates])
    .filter(Boolean)
    .map((candidate, idx) => normalizeTimetableEntry({
      ...candidate,
      id: candidate.id || `__drag_preview_${idx}`
    }));

  if (!candidateList.length) return null;

  const excludeIds = new Set(options.excludeIds || []);

  for (const candidate of candidateList) {
    const slotEntries = getSlotEntriesForPreview(candidate.day, candidate.period, excludeIds);
    const candidateAudience = audienceForPlacement(candidate);
    const candidateGrades = audienceCanonicalGradeSet(candidateAudience);
    const candidateProtectedGrades = protectedGradesForEntry(candidate);
    const candidateTeachers = new Set(splitTeacherNames(candidate.teacherName || ""));

    if (isRoomUnavailableForDragPreview(candidate.roomId, candidate.day, candidate.period)) {
      return { kind: "conflict", candidate, conflictTypes: ["roomUnavailable"] };
    }

    for (const fixed of slotEntries) {
      const fixedAudience = audienceForPlacement(fixed);
      const fixedProtectedGrades = protectedGradesForEntry(fixed);
      const fixedGrades = audienceCanonicalGradeSet(fixedAudience);

      if (candidateProtectedGrades.size || fixedProtectedGrades.size) {
        if (audiencesConflict(candidateAudience, fixedAudience)) {
          return { kind: "protected", block: { entry: fixed, reason: "audience" }, candidate };
        }
        if (fixedProtectedGrades.size && setsIntersect(candidateGrades, fixedProtectedGrades)) {
          return { kind: "protected", block: { entry: fixed, reason: "protected-fixed-grade" }, candidate };
        }
        if (candidateProtectedGrades.size && setsIntersect(candidateProtectedGrades, fixedGrades)) {
          return { kind: "protected", block: { entry: fixed, reason: "protected-candidate-grade" }, candidate };
        }
      }

      if (audiencesConflict(candidateAudience, fixedAudience)) {
        return { kind: "conflict", candidate, conflictTypes: ["student"] };
      }

      const fixedTeachers = splitTeacherNames(fixed.teacherName || "");
      if (candidateTeachers.size && fixedTeachers.some(t => candidateTeachers.has(t))) {
        return { kind: "conflict", candidate, conflictTypes: ["teacher"] };
      }

      const candidateRooms = effectiveRoomIdsForEntry(candidate);
      const fixedRooms = effectiveRoomIdsForEntry(fixed);
      if (candidateRooms.some(roomId => fixedRooms.includes(roomId))) {
        return { kind: "conflict", candidate, conflictTypes: ["room"] };
      }
    }
  }

  return null;
}

function markDragPreviewCell(cell, data) {
  const day = parseInt(cell.dataset.day, 10);
  const period = parseInt(cell.dataset.period, 10);
  if (!Number.isFinite(day) || !Number.isFinite(period)) return;

  const patch = {};
  if (cell.dataset.gradeKey) patch.gradeKey = cell.dataset.gradeKey;
  if (cell.dataset.sectionIdx !== undefined) patch.sectionIdx = parseInt(cell.dataset.sectionIdx, 10) || 0;

  const { candidates, excludeIds } = buildDragPreviewCandidates(data, day, period, patch);
  if (!candidates.length) return;

  const block = getDragPreviewBlockLight(candidates, { excludeIds });
  const cls = previewClassForBlock(block);
  cell.classList.add(cls);

  if (cls !== "tt-drag-preview-ok") {
    const suffix = cls.includes("teacher") ? "teacher" : cls.includes("room") ? "room" : "student";
    cell.closest("tr")?.querySelector(".tt-all-row-hdr,.tt-period-label,.tt-section-sub-hdr")?.classList.add(`tt-drag-preview-row-${suffix}`);
    document.querySelectorAll(`.tt-period-sub-hdr[data-day="${day}"][data-period="${period}"]`).forEach(h => h.classList.add(`tt-drag-preview-slot-${suffix}`));
  }
}

function applySlotDragPreview(data) {
  cancelDragPreviewWork();
  clearDragPreviewClasses();

  const cells = getDragPreviewCells(data);
  if (!cells.length) return;

  const token = ++dragPreviewToken;
  let index = 0;

  const run = () => {
    if (token !== dragPreviewToken) return;

    const deadline = performance.now() + DRAG_PREVIEW_FRAME_BUDGET_MS;
    while (index < cells.length && performance.now() < deadline) {
      markDragPreviewCell(cells[index], data);
      index += 1;
    }

    if (index < cells.length) {
      dragPreviewRaf = requestAnimationFrame(run);
    } else {
      dragPreviewRaf = 0;
    }
  };

  dragPreviewRaf = requestAnimationFrame(run);
}

/** Called on dragstart: highlight relevant cells / sidebar cards */
function applyDragHighlight(data) {
  if (!data) return;
  const teacherNames = [...new Set(getDragTeacherNames(data))];
  const gradeKey = data.gradeKey;

  document.querySelectorAll(".tt-entry-card").forEach(c => c.classList.remove("tt-drag-teacher-busy"));
  if (teacherNames.length) {
    entries().forEach(e => {
      if (teacherNames.some(t => splitTeacherNames(e.teacherName || "").includes(t))) {
        document.querySelectorAll(`.tt-entry-card[data-entry-id="${e.id}"]`).forEach(c => c.classList.add("tt-drag-teacher-busy"));
      }
    });
  }

  document.querySelectorAll(".tt-all-row-hdr").forEach(hdr => {
    const match = gradeKey && hdr.closest("tr")?.dataset.gradeKey === gradeKey;
    hdr.closest("tr")?.classList.toggle("tt-drag-grade-highlight", !!match);
  });

  applySlotDragPreview(data);
}

function clearDragHighlight() {
  cancelDragPreviewWork();
  document.querySelectorAll(".tt-drag-teacher-busy,.tt-drag-grade-highlight").forEach(el => {
    el.classList.remove("tt-drag-teacher-busy","tt-drag-grade-highlight");
  });
  clearDragPreviewClasses();
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
    const normalizedTab = tab === "conflicts" || tab === "unplaced" ? "logs" : tab;
    const tabMap = { subjects:"ttSubjectsContent", constraints:"ttConstraintsContent", teacherCards:"ttTeacherCardsContent", rooms:"ttRoomsContent", logs:"ttLogsContent" };
    Object.entries(tabMap).forEach(([key, id]) => $(id)?.classList.toggle("hidden", key !== normalizedTab));
    if (normalizedTab === "constraints" || normalizedTab === "teacherCards" || normalizedTab === "rooms") subscribeOptionalTimetableDomains();
    if (normalizedTab === "logs") window._ttBottomToggle?.show?.();
    // hidden 클래스가 먼저 바뀐 뒤 렌더링해야 isVisible()이 정확히 동작합니다.
    setTimeout(() => renderAll(), 0);
  });
});

$("ttLoginBtn")?.addEventListener("click", login);
$("ttLogoutBtn")?.addEventListener("click", logout);
$("ttExportBtn")?.addEventListener("click", exportXlsx);
$("ttSaveBtn")?.addEventListener("click", handleTtUnifiedSaveClick);
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
  void saveNow("timetable", { force: true }); recomputeConflicts(); renderAll();
});
$("ttFixedLessonsBtn")?.addEventListener("click", () => openFixedLessonManager());
$("ttAutoPrecheckBtn")?.addEventListener("click", () => autoAssignAll.openPrecheck?.());
$("ttAutoAssignBtn")?.addEventListener("click", () => autoAssignAll());
$("ttScheduleVersionsBtn")?.addEventListener("click", () => openScheduleVersionManager());


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
installTimetableScrollIsolation();
renderAll();
