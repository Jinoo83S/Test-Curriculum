// ================================================================
// timetable.js · Timetable Page — Main Module
// ================================================================
import { GRADE_KEYS } from "./config.js";
import { login, logout, onAuth, canEdit } from "./auth.js";
import { appState, subscribeDomains, unsubscribeAll, setOnUpdate, scheduleSave, saveNow,
         normalizeTimetableEntry, migrateFromLegacy, TIMETABLE_CORE_DOMAINS, TIMETABLE_OPTIONAL_DOMAINS } from "./state.js";
import { getTemplateById, getTemplateCardTitle, splitTeacherNames } from "./templates.js";
import { uid, clean, makeBtn, sectionLabel, gradeDisplay, escapeHtml, isProtectedWholeGradeLabel } from "./utils.js";
import { getTtCards, getTtCardById, refreshTtCardData } from "./ttcards.js";
import { getRooms, renderRoomsView, updateRoom } from "./rooms.js";
import { detectConflicts, detectConstraintViolations, getConflictLabel } from "./timetable-conflicts.js";
import {
  ttCardIdsFromPlacement as occTtCardIdsFromPlacement,
  getEntryOccupancy,
  setsIntersect as occSetsIntersect,
  audiencesConflict as occAudiencesConflict,
  audienceGradeSet as occAudienceGradeSet
} from "./timetable-occupancy.js";
import {
  getSubjectsForGrade, getCreditsForTemplate, getCategoryColor, getAssignedCount,
  getCategoryForTemplate, getTrackForTemplate, getGroupNameForTemplate,
  getTeachersForTemplate, getSectionCount, getCreditsForTtCard, getTeachersForTtCard,
  getGroupCards, getTtCardClassLabels, describeTtCard, buildEntryDataFromTtCards,
  makePlacementFromGroupItem, entryMatchesClass, getUnitForTemplate, getUnitDisplayTitle,
  getUnitGradeKeys, getUnitTeachers, getAllClasses, entryGradeKeys, entryTemplateIds,
  entryHasGrade, entryTitle, entryTeachers
} from "./timetable-data.js";
import { createAutoAssignAll } from "./timetable-autoassign.js";
import { renderTimetableGrid } from "./timetable-grid.js";
import { createTimetableDetailHandlers } from "./timetable-detail.js";
import { createTimetableConstraintsHandlers } from "./timetable-constraints.js";
import { createTimetableLogHandlers } from "./timetable-log.js";
import { createTimetableSidebarHandlers } from "./timetable-sidebar.js";
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
let currentTeacher = "";
let currentRoom    = "";
let dragData       = null;
let conflictMap    = new Map();
let constraintMap  = new Map();

// ── Split module APIs ───────────────────────────────────────────
let constraintsPanelApi = null;
let addTimetableLog = () => {};
let setLastAutoAssignReport = () => {};
let getConflictCounts = () => ({ counts: {}, totalAffected: 0 });
let renderLogPanel = () => {};

function subscribeOptionalTimetableDomains() {
  // 하단바의 교실 관리/교사 조건은 시간표 본문 데이터와 함께 동작합니다.
  // rooms만 단독 구독하면 초기 로딩 타이밍에 따라 교실 수정이 저장되지 않는 경우가 있어
  // 시간표 핵심 도메인과 optional 도메인을 함께 유지합니다.
  subscribeDomains([...new Set([...TIMETABLE_CORE_DOMAINS, ...TIMETABLE_OPTIONAL_DOMAINS])]);
}

function isVisible(el) {
  return !!el && !el.classList.contains("hidden");
}

function activateBottomTab(tabName) {
  window._ttBottomToggle?.show?.();
  const btn = document.querySelector(`.tt-bottom-tab-btn[data-tab="${tabName}"]`);
  btn?.click();
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

function renderConstraintsPanel() {
  return constraintsPanelApi?.renderConstraintsPanel();
}

function syncTeacherHomeRoomFromRoom(roomId, teacherName) {
  return constraintsPanelApi?.syncTeacherHomeRoomFromRoom(roomId, teacherName);
}

function getDefaultRoomForTeacherNames(teacherNames = []) {
  const rooms = [...new Set((teacherNames || []).map(getEffectiveAssignedRoomId).filter(Boolean))];
  return rooms.length === 1 ? rooms[0] : null;
}

function getDefaultRoomForPlacementData(data = {}) {
  const names = splitTeacherNames(data.teacherName || "").filter(Boolean);
  return getDefaultRoomForTeacherNames(names);
}

function applyDefaultRoomToEntryData(data = {}) {
  if (!data.roomId) {
    const roomId = getDefaultRoomForPlacementData(data);
    if (roomId) data.roomId = roomId;
  }
  return data;
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

function formatClassLabelList(gradeKey, labels = []) {
  const rawLabels = (Array.isArray(labels) ? labels : [labels])
    .flatMap(label => String(label ?? "")
      .split(/[,，·\/]+/)
      .map(x => x.trim())
      .filter(Boolean));
  const normalized = rawLabels.length ? rawLabels : [""];
  return uniqueStrings(normalized.map(label => formatClassLabel(gradeKey, label))).join(", ") || "-";
}

function entrySharesTeacher(a, b) {
  const aTeachers = entryTeachers(a).filter(Boolean);
  const bTeachers = entryTeachers(b).filter(Boolean);
  return aTeachers.filter(t => bTeachers.includes(t));
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
    const audience = audienceForPlacement(entry);
    return sameSlot
      .filter(e => audiencesConflict(audience, audienceForPlacement(e)))
      .filter(e => (conflictMap.get(e.id) || new Set()).has("student"))
      .map(e => ({ entry: e, detail: getEntryClassSummary(e) }));
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
  if (type === "unavailable") return `${teachers} 선생님의 수업 불가 시간으로 설정되어 있습니다.`;
  if (type === "maxConsecutive") return `${teachers} 선생님의 연속 수업 제한을 초과했습니다.`;
  if (type === "maxPerDay") return `${teachers} 선생님의 일일 수업 수 제한을 초과했습니다.`;
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
  const block = getManualPlacementBlock(e);
  if (block) { alertManualPlacementBlock(block); return null; }
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
  const grp = (appState.templates.templateGroups || []).find(g => g.id === groupId);
  if (!grp) return false;

  // 그룹카드는 화면에서 하나의 카드로 보이므로, 배치도 하나의 aggregate entry로 저장합니다.
  // 이렇게 해야 7AB/8AB/9AB 같은 그룹에서 특정 반(예: 8B)이 누락되지 않고
  // 상세정보·전체반 시간표·자동배치가 같은 기준(ttcardIds 전체)을 보게 됩니다.
  const cards = getGroupCards(grp);
  const data = buildEntryDataFromTtCards(cards, { day, period, groupId: grp.id });
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
  (appState.templates.templateGroups || []).forEach(group => {
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
    (appState.templates.templateGroups || []).flatMap(g => (g.units || []).flatMap(u => u.templateIds || []))
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
    appState.templates.templateGroups,
    appState.templates.templates,
    audienceForPlacement
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
    handleDrop,
    updatePeriodLabel,
    buildEntryCard,
    getGradeColor,
  });
}

// ── Common entry helpers ──────────────────────────────────────────
function ttCardIdsFromPlacement(x = {}) {
  return occTtCardIdsFromPlacement(x);
}

function audienceForPlacement(x = {}) {
  return getEntryOccupancy(x, {
    getTtCardById,
    templateGroups: appState.templates?.templateGroups || []
  });
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
    const grp = (appState.templates?.templateGroups || []).find(g => g.id === entry.groupId);
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

function protectedGradesForEntry(entry = {}) {
  const grades = new Set();
  audienceGradeSet(audienceForPlacement(entry)).forEach(g => {
    const key = GRADE_KEYS.find(x => gradeDisplay(x) === gradeDisplay(g)) || g;
    if (key) grades.add(key);
  });
  entryGradeKeys(entry).forEach(g => grades.add(g));
  extractGradeKeysFromProtectionText(getEntryProtectionText(entry)).forEach(g => grades.add(g));
  return grades;
}

function protectedSlotConflict(candidate = {}, day = candidate.day, period = candidate.period, options = {}) {
  const excludeIds = new Set(options.excludeIds || []);
  const existing = [...entries(), ...(options.placed || [])];
  const slotEntries = existing.filter(e => e && e.day === day && e.period === period && !excludeIds.has(e.id));
  if (!slotEntries.length) return null;

  const candidateAudience = audienceForPlacement({ ...candidate, day, period });
  const candidateGrades = audienceGradeSet(candidateAudience);

  for (const fixed of slotEntries) {
    if (!isProtectedPinnedEntry(fixed)) continue;
    const fixedAudience = audienceForPlacement(fixed);
    if (audiencesConflict(candidateAudience, fixedAudience)) {
      return { entry: fixed, reason: "audience" };
    }
    const fixedGrades = protectedGradesForEntry(fixed);
    if (setsIntersect(candidateGrades, fixedGrades)) {
      return { entry: fixed, reason: "grade" };
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
      appState.templates.templateGroups,
      appState.templates.templates,
      audienceForPlacement
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

  // Row1: 과목명 + 멀티카드 카운터
  const row1 = document.createElement("div"); row1.className = "tt-entry-row1";
  const titleEl = document.createElement("div"); titleEl.className = "tt-entry-title"; titleEl.textContent = title;
  row1.appendChild(titleEl);
  if (isMulti) {
    const cnt = document.createElement("span"); cnt.className = "tt-entry-multi-cnt";
    cnt.textContent = `×${grpEntries.length}`; row1.appendChild(cnt);
  }

  // Row2: 교사명 + 고정 핀
  const row2 = document.createElement("div"); row2.className = "tt-entry-row2";
  const teacherEl = document.createElement("div"); teacherEl.className = "tt-entry-teacher2";
  teacherEl.textContent = [...new Set(teachers)].slice(0, 2).join(", ") || "";
  row2.appendChild(teacherEl);
  if (entry.pinned) {
    const pin = document.createElement("span"); pin.className = "tt-entry-pin2"; pin.textContent = "📌";
    row2.appendChild(pin);
  }

  card.append(row1, row2);
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
  const moving = [e, ...siblings].map(item => ({ ...item, day, period }));
  const excludeIds = [e.id, ...siblings.map(s => s.id)];
  const block = getManualPlacementBlock(moving, { excludeIds });
  if (block) { alertManualPlacementBlock(block); return; }
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
    const grp  = (appState.templates.templateGroups || []).find(g => g.id === data.groupId);
    const unit = grp?.units?.find(u => u.id === data.unitId);
    if (grp && unit) {
      const ttcards = (unit.ttcardIds || []).map(id => getTtCardById(id)).filter(Boolean);
      const entryData = buildEntryDataFromTtCards(ttcards, { day, period, groupId: grp.id, unitId: unit.id });
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
      const entryData = buildEntryDataFromTtCards([card], { day, period, groupId: data.groupId || null });
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
  getGroupCards, getCreditsForTtCard, getTeachersForTtCard, describeTtCard,
  getSubjectsForGrade, getUnitForTemplate, getUnitDisplayTitle, getUnitGradeKeys, getUnitTeachers,
  getCreditsForTemplate, getTeachersForTemplate, getSectionCount, entryTemplateIds, entryHasGrade,
  getGradeColor, gradeDisplay, sectionLabel,
  showSidebarCardDetail, showEntryDetailByUnit,
  renderAll: () => renderAll(),
  setDragData: value => { dragData = value; },
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
  describeTtCard, makePlacementFromGroupItem, getSubjectsForGrade,
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
  const knownDomains = ["curriculum","templates","classes","teachers","rosters","rooms","timetable","all"];
  if (knownDomains.includes(domain)) requestRenderAll();
});

setAuthCheckingUI();

onAuth(async (user) => {
  updateAuthUI(user);
  if (user) {
    try {
      await migrateFromLegacy();  // 마이그레이션 먼저 — 빈 문서 생성 방지
    } catch (e) {
      console.warn("Migration skipped; continuing timetable load.", e);
    } finally {
      // 시간표 하단바의 교실 관리가 즉시 수정·저장될 수 있도록 rooms도 함께 구독합니다.
      subscribeDomains([...new Set([...TIMETABLE_CORE_DOMAINS, ...TIMETABLE_OPTIONAL_DOMAINS])]);
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
