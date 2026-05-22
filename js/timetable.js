// ================================================================
// timetable.js · Timetable Page — Main Module
// ================================================================
import { GRADE_KEYS, CATEGORY_PALETTE } from "./config.js";
import { login, logout, onAuth, canEdit } from "./auth.js";
import { appState, subscribeDomains, unsubscribeAll, setOnUpdate, scheduleSave, saveNow,
         normalizeTimetableEntry, normalizeTimetableConstraint, migrateFromLegacy, TIMETABLE_CORE_DOMAINS, TIMETABLE_OPTIONAL_DOMAINS } from "./state.js";
import { getTemplateById, getTemplateCardTitle, splitTeacherNames } from "./templates.js";
import { uid, clean, makeBtn, sectionLabel, gradeDisplay, escapeHtml } from "./utils.js";
import { getTtCards, getTtCardById, refreshTtCardData } from "./ttcards.js";
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

// ── Bottom log panel state ───────────────────────────────────────
const TT_LOG_KEY = "his_tt_logs_v1";
const TT_AUTO_REPORT_KEY = "his_tt_auto_report_v1";
const LOG_LIMIT = 80;

function loadJsonLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) { return fallback; }
}

let timetableLogs = loadJsonLocal(TT_LOG_KEY, []);
let lastAutoAssignReport = loadJsonLocal(TT_AUTO_REPORT_KEY, null);

function persistLogState() {
  try {
    localStorage.setItem(TT_LOG_KEY, JSON.stringify(timetableLogs.slice(0, LOG_LIMIT)));
    if (lastAutoAssignReport) localStorage.setItem(TT_AUTO_REPORT_KEY, JSON.stringify(lastAutoAssignReport));
    else localStorage.removeItem(TT_AUTO_REPORT_KEY);
  } catch (_) {}
}

function addTimetableLog(kind, title, message = "", detail = {}) {
  timetableLogs.unshift({ id: uid("log"), ts: Date.now(), kind, title, message, detail });
  if (timetableLogs.length > LOG_LIMIT) timetableLogs = timetableLogs.slice(0, LOG_LIMIT);
  persistLogState();
  if (isVisible($("ttLogsContent"))) renderLogPanel();
}

function setLastAutoAssignReport(report) {
  lastAutoAssignReport = report;
  persistLogState();
}

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

// ── Undo stack: Ctrl+Z restores the previous timetable edit ──────
const UNDO_LIMIT = 50;
let undoStack = [];
let undoCaptureLocked = false;
let undoApplying = false;

function cloneForUndo(v) {
  try { return structuredClone(v); }
  catch (_) { return JSON.parse(JSON.stringify(v ?? null)); }
}

function getUndoSnapshot() {
  return cloneForUndo({
    entries: ttDomain().entries || [],
    config: ttDomain().config || {},
    teacherConstraints: ttDomain().teacherConstraints || {},
  });
}

function sameUndoSnapshot(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch (_) { return false; }
}

function captureTimetableUndo(label = "시간표 편집") {
  if (!canEdit() || undoApplying || undoCaptureLocked) return;
  const snapshot = getUndoSnapshot();
  const last = undoStack[undoStack.length - 1];
  if (!last || !sameUndoSnapshot(last.data, snapshot)) {
    undoStack.push({ label, data: snapshot });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }
  undoCaptureLocked = true;
  queueMicrotask(() => { undoCaptureLocked = false; });
}

function restoreTimetableSnapshot(snapshot) {
  const restored = cloneForUndo(snapshot);
  ttDomain().entries = restored.entries || [];
  ttDomain().config = restored.config || ttDomain().config || {};
  ttDomain().teacherConstraints = restored.teacherConstraints || {};
}

function undoLastTimetableEdit() {
  if (!canEdit()) return;
  const snapshot = undoStack.pop();
  if (!snapshot) {
    const bar = $("ttConflictBar");
    if (bar) {
      const prev = bar.textContent;
      bar.textContent = "되돌릴 작업이 없습니다.";
      setTimeout(() => { if (bar.textContent === "되돌릴 작업이 없습니다.") bar.textContent = prev; }, 1200);
    }
    return;
  }
  undoApplying = true;
  restoreTimetableSnapshot(snapshot.data);
  undoApplying = false;
  scheduleSave("timetable");
  recomputeConflicts();
  renderAll();
  addTimetableLog("undo", "되돌리기", `${snapshot.label || "직전 작업"} 상태로 되돌렸습니다.`);
}

function shouldIgnoreUndoShortcut(target) {
  if (!target) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

document.addEventListener("keydown", e => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey || e.altKey) return;
  if (shouldIgnoreUndoShortcut(e.target)) return;
  e.preventDefault();
  undoLastTimetableEdit();
});

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


// ── Conflict display colors / labels ─────────────────────────────
const CONFLICT_DISPLAY = {
  teacher:        { label:"교사", short:"교", color:"#dc2626" },
  room:           { label:"교실", short:"실", color:"#ea580c" },
  student:        { label:"학생", short:"학", color:"#7c3aed" },
  syncRequired:   { label:"동시배정", short:"동", color:"#2563eb" },
  unavailable:    { label:"불가시간", short:"불", color:"#475569" },
  maxConsecutive: { label:"연속초과", short:"연", color:"#ca8a04" },
  maxPerDay:      { label:"일일초과", short:"일", color:"#ca8a04" },
};
const CONFLICT_PRIORITY = ["teacher", "room", "student", "syncRequired", "unavailable", "maxConsecutive", "maxPerDay"];
function getOrderedConflictTypes(conflicts) {
  return CONFLICT_PRIORITY.filter(type => conflicts.has(type));
}
function applyConflictVisuals(card, conflictTypes, conflicts) {
  if (!conflictTypes.length) return;
  const primary = conflictTypes[0];
  card.style.setProperty("--tt-conflict-color", CONFLICT_DISPLAY[primary]?.color || "#dc2626");
  conflictTypes.forEach(type => card.classList.add(`tt-conflict-${type}`));
  card.dataset.conflictTypes = conflictTypes.join(",");
  card.title = getConflictLabel(conflicts);

  const markers = document.createElement("div");
  markers.className = "tt-conflict-markers";
  conflictTypes.forEach(type => {
    const meta = CONFLICT_DISPLAY[type];
    if (!meta) return;
    const dot = document.createElement("span");
    dot.className = "tt-conflict-dot";
    dot.dataset.type = type;
    dot.textContent = meta.short;
    dot.title = meta.label;
    markers.appendChild(dot);
  });
  card.appendChild(markers);
}


function getEntryConflictSet(entry) {
  return new Set([...(conflictMap.get(entry.id) || []), ...(constraintMap.get(entry.id) || [])]);
}

function getRoomDisplayName(roomId) {
  if (!roomId) return "교실 없음";
  return getRooms().find(r => r.id === roomId)?.name || roomId;
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
  captureTimetableUndo("수업 추가");
  const e = normalizeTimetableEntry({ id: uid("ent"), ...data });
  if (!e.templateId) return null;
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
function updateConstraint(teacher, field, value, { rerender = true } = {}) {
  if (!canEdit()) return;
  if (!constraints()[teacher]) constraints()[teacher] = normalizeTimetableConstraint({});
  captureTimetableUndo("교사 제약 수정");
  constraints()[teacher][field] = value;
  scheduleSave("timetable");
  if (rerender) {
    recomputeConflicts();
    requestAnimationFrame(() => renderAll());
  }
}
function toggleUnavailable(teacher, day, period) {
  if (!canEdit()) return;
  if (!constraints()[teacher]) constraints()[teacher] = normalizeTimetableConstraint({});
  captureTimetableUndo("수업 불가 시간 수정");
  const slots = constraints()[teacher].unavailableSlots || (constraints()[teacher].unavailableSlots = []);
  const idx = slots.findIndex(s => s.day === day && s.period === period);
  if (idx >= 0) slots.splice(idx, 1); else slots.push({ day, period });
  scheduleSave("timetable");
  recomputeConflicts();
  requestAnimationFrame(() => renderAll());
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
  const labels = Array.from({ length: count }, (_, i) => ttConfig().periodLabels[i] || `${i}교시`);
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
function getCurriculumRowForTemplate(gradeKey, templateId) {
  return (appState.curriculum.gradeBoards[gradeKey] || [])
    .find(r => r.sem1TemplateId === templateId || r.sem2TemplateId === templateId) || null;
}
function getCategoryForTemplate(gradeKey, templateId) {
  return getCurriculumRowForTemplate(gradeKey, templateId)?.category || "";
}
function getTrackForTemplate(gradeKey, templateId) {
  return getCurriculumRowForTemplate(gradeKey, templateId)?.track || "";
}
function getGroupNameForTemplate(gradeKey, templateId) {
  return getCurriculumRowForTemplate(gradeKey, templateId)?.group || "";
}
function isWholeGradeTtCard(card) {
  if (!card?.templateId || !card?.gradeKey) return false;
  const tpl = getTemplateById(card.templateId);
  const title = getTemplateCardTitle(tpl) || clean(card.label);
  const category = clean(getCategoryForTemplate(card.gradeKey, card.templateId));
  const groupName = clean(getGroupNameForTemplate(card.gradeKey, card.templateId));
  const track = clean(getTrackForTemplate(card.gradeKey, card.templateId));
  const label = [title, category, groupName, track, card.label].join(" ");

  // 창체/채플/CA/SA/MS채플처럼 실제로 해당 학년 전체가 동시에 듣는 수업만
  // 모든 반을 점유하도록 봅니다.
  if (category === "창체") return true;
  if (/(채플|chapel|CA|SA|자율|동아리)/i.test(label)) return true;
  if (/(전체|전학년|whole|all)/i.test(label)) return true;
  return false;
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

function getCreditsForTtCard(card) {
  if (!card) return 0;
  if (Number.isFinite(parseFloat(card.credits)) && parseFloat(card.credits) > 0) return parseFloat(card.credits);
  const row = (appState.curriculum.gradeBoards[card.gradeKey] || [])
    .find(r => r.sem1TemplateId === card.templateId || r.sem2TemplateId === card.templateId);
  return parseFloat(row?.credits) || 0;
}

function getTeachersForTtCard(card) {
  if (!card) return [];
  if (Array.isArray(card.teachers) && card.teachers.length) return card.teachers;
  if (card.teacherName) return splitTeacherNames(card.teacherName);
  return getTeachersForTemplate(card.templateId);
}

function getGroupCards(group) {
  if (!group) return [];
  const unitIds = new Set((group.units || []).flatMap(u => u.ttcardIds || []));
  const ids = [
    ...(group.poolCardIds || []).filter(id => !unitIds.has(id)),
    ...(group.units || []).flatMap(u => u.ttcardIds || [])
  ];
  const seen = new Set();
  return ids
    .filter(id => id && !seen.has(id) && seen.add(id))
    .map(id => getTtCardById(id))
    .filter(Boolean);
}

function getClassInfoByGradeSection(gradeKey, sectionIdx) {
  return getAllClasses().find(c => c.gradeKey === gradeKey && (c.sectionIdx ?? 0) === (sectionIdx ?? 0)) || null;
}

function getClassInfosByCardLabel(card) {
  const label = clean(card?.label || "");
  if (!label || !card?.gradeKey) return [];
  const gradeClasses = getAllClasses().filter(c => c.gradeKey === card.gradeKey);
  if (gradeClasses.length <= 1) return [];
  const compactLabel = label.replace(/\s+/g, "").toUpperCase();
  const classNames = gradeClasses.map(c => String(c.section || sectionLabel(c.sectionIdx ?? 0)).trim()).filter(Boolean);
  const compactNames = classNames.join("").toUpperCase();

  // 사용자가 카드 라벨을 "8AB", "7A/B", "A,B"처럼 직접 붙인 경우 보완 인식
  // 단일 문자 반명(A/B/C...)은 단어 경계로만 검사하면 "8AB"를 놓치므로 compact 조합도 확인합니다.
  const matchesCompactGroup = compactNames.length >= 2 && compactLabel.includes(compactNames);
  const matched = gradeClasses.filter(c => {
    const name = String(c.section || sectionLabel(c.sectionIdx ?? 0)).trim();
    if (!name) return false;
    const n = name.toUpperCase();
    if (matchesCompactGroup && compactNames.includes(n)) return true;
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Z0-9가-힣])${escaped}([^A-Z0-9가-힣]|$)`, "i").test(label);
  });
  return matched;
}

function normalizeGradeForClassKey(gradeKey) {
  return gradeDisplay(gradeKey || "").trim();
}

function normalizeSectionForClassKey(info = {}) {
  const raw = String(info.section ?? "").trim();
  if (raw) {
    const compact = raw.replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
    // "9A"처럼 학년이 이미 붙은 표기는 뒤의 반명만 남깁니다.
    const m = compact.match(/^\d{1,2}(.+)$/);
    return m ? m[1] : compact;
  }
  return sectionLabel(info.sectionIdx ?? 0).toUpperCase();
}

function classKey(info) {
  if (!info) return "";
  const grade = normalizeGradeForClassKey(info.gradeKey || info.grade);
  const section = normalizeSectionForClassKey(info);
  return grade && section ? `${grade}:${section}` : "";
}

function classKeyFromCard(card) {
  if (!card) return "";
  return classKey({ gradeKey: card.gradeKey, sectionIdx: card.sectionIdx ?? 0 });
}


function classInfoFromStoredLabel(label, fallbackGradeKey = "") {
  const compact = String(label || "").replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
  const m = compact.match(/^(\d{1,2})(.+)$/);
  if (m) return { gradeKey: `${m[1]}학년`, section: m[2], sectionIdx: Math.max(0, m[2].charCodeAt(0) - 65) };
  return { gradeKey: fallbackGradeKey, section: compact, sectionIdx: Math.max(0, compact.charCodeAt(0) - 65) };
}
function classInfoFromStoredKey(key, fallbackGradeKey = "") {
  const [g, sec] = String(key || "").split(":");
  if (!g || !sec) return null;
  return classInfoFromStoredLabel(`${g}${sec}`, fallbackGradeKey);
}
function getRosterEntriesForTtCard(card) {
  if (!card?.templateId) return [];
  return (appState.rosters?.rosters?.[card.templateId] || [])
    .filter(e => (e.sectionIdx ?? 0) === (card.sectionIdx ?? 0));
}

function getTtCardClassInfos(card) {
  if (!card) return [];

  // 1순위: 시간표 사전작업에서 생성·수정되어 Firebase에 저장된 카드 데이터
  const stored = [];
  if (Array.isArray(card.classLabels) && card.classLabels.length) {
    card.classLabels.forEach(label => stored.push(classInfoFromStoredLabel(label, card.gradeKey)));
  } else if (Array.isArray(card.classKeys) && card.classKeys.length) {
    card.classKeys.forEach(key => {
      const info = classInfoFromStoredKey(key, card.gradeKey);
      if (info) stored.push(info);
    });
  }
  if (stored.length) {
    const seen = new Set();
    return stored.filter(info => {
      const key = classKey(info);
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  // 이하 코드는 이전 데이터 호환용 fallback입니다.
  const rosterEntries = getRosterEntriesForTtCard(card);
  const allClasses = appState.classes?.classes || [];
  const classRows = getAllClasses();
  const seen = new Set();
  const infos = [];

  rosterEntries.forEach(re => {
    const clsObj = allClasses.find(c => c.id === re.classId);
    if (!clsObj || clsObj.grade !== card.gradeKey) return;
    const rowInfo = classRows.find(c => c.gradeKey === clsObj.grade && c.section === clsObj.name);
    const info = rowInfo || { gradeKey: clsObj.grade, section: clsObj.name, sectionIdx: card.sectionIdx ?? 0 };
    const key = classKey(info);
    if (key && !seen.has(key)) { seen.add(key); infos.push(info); }
  });

  if (infos.length) return infos;

  const labelInfos = getClassInfosByCardLabel(card);
  if (labelInfos.length) return labelInfos;

  const cc = Math.max(0, parseInt(appState.rosters?.rosterMeta?.[card.templateId]?.classCount) || 0);
  if (cc <= 1 && isWholeGradeTtCard(card)) {
    const allGradeClasses = classRows.filter(c => c.gradeKey === card.gradeKey);
    if (allGradeClasses.length) return allGradeClasses;
  }

  const matched = classRows.filter(c => c.gradeKey === card.gradeKey && (c.sectionIdx ?? 0) === (card.sectionIdx ?? 0));
  if (matched.length) return matched;

  const fallback = getClassInfoByGradeSection(card.gradeKey, card.sectionIdx ?? 0);
  return [fallback || { gradeKey: card.gradeKey, sectionIdx: card.sectionIdx ?? 0, section: sectionLabel(card.sectionIdx ?? 0) }];
}

function getTtCardClassLabels(card) {
  return uniqueStrings(getTtCardClassInfos(card).map(info => info.section || sectionLabel(info.sectionIdx ?? 0)));
}

function ttCardCoversClass(card, cls) {
  if (!card || !cls || card.gradeKey !== cls.gradeKey) return false;
  const infos = getTtCardClassInfos(card);
  return infos.some(info => {
    if (cls.section && info.section) return info.section === cls.section;
    return (info.sectionIdx ?? 0) === (cls.sectionIdx ?? 0);
  });
}

function uniqueStrings(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function describeTtCard(card) {
  const tpl = getTemplateById(card?.templateId);
  const base = card?.subject || (tpl ? getTemplateCardTitle(tpl) : "?");
  const cc = Math.max(1, parseInt(appState.rosters?.rosterMeta?.[card?.templateId]?.classCount) || 1);
  const classLabels = getTtCardClassLabels(card);
  const sec = classLabels.length ? classLabels.join(", ") : sectionLabel(card?.sectionIdx ?? 0);
  const shouldShowSection = cc > 1 || classLabels.length > 1;
  return {
    title: shouldShowSection ? `${base} ${sec}` : base,
    subject: base,
    gradeKey: card?.gradeKey || "",
    sectionIdx: card?.sectionIdx ?? 0,
    sectionLabel: sec,
    classLabels,
    teachers: getTeachersForTtCard(card),
    credits: getCreditsForTtCard(card),
  };
}

function buildEntryDataFromTtCards(cards, { day, period, groupId = null, unitId = null } = {}) {
  const validCards = (cards || []).filter(Boolean);
  if (!validCards.length) return null;
  const first = validCards[0];
  const templateIds = [...new Set(validCards.map(c => c.templateId).filter(Boolean))];
  const gradeKeys = [...new Set(validCards.map(c => c.gradeKey).filter(Boolean))];
  const teacherName = [...new Set(validCards.flatMap(c => getTeachersForTtCard(c)).filter(Boolean))].join(",");
  return {
    day, period,
    sectionIdx: first.sectionIdx ?? 0,
    unitId,
    groupId,
    ttcardId: validCards.length === 1 ? first.id : null,
    ttcardIds: validCards.map(c => c.id),
    templateIds,
    gradeKeys,
    templateId: templateIds[0] || first.templateId,
    gradeKey: gradeKeys[0] || first.gradeKey,
    teacherName,
    audienceClassKeys: [...new Set(validCards.flatMap(c => c.classKeys || []))],
    audienceStudentKeys: [...new Set(validCards.flatMap(c => c.studentKeys || []))],
    roomId: null
  };
}

function makePlacementFromGroupItem(group, groupItem) {
  return buildEntryDataFromTtCards(groupItem.ttcards || [], {
    groupId: group.id,
    unitId: groupItem.unit?.id || null
  });
}

function entryMatchesClass(entry, cls) {
  if (!entry || !cls) return false;
  const cardIds = [...(entry.ttcardIds || []), entry.ttcardId].filter(Boolean);

  if (cardIds.length) {
    // Check if ANY of the ttcards covers this class
    return cardIds.some(id => {
      const card = getTtCardById(id);
      if (!card) return false;
      // Grade must match
      if (card.gradeKey !== cls.gradeKey) return false;
      // Try roster-based class infos
      const infos = getTtCardClassInfos(card);
      if (infos.length) {
        return infos.some(info => {
          if (cls.section && info.section) return info.section === cls.section;
          return (info.sectionIdx ?? 0) === (cls.sectionIdx ?? 0);
        });
      }
      // Fallback: same sectionIdx
      return (card.sectionIdx ?? 0) === (cls.sectionIdx ?? 0);
    });
  }

  // No ttcardIds — gradeKeys + sectionIdx based
  const eGrades = entry.gradeKeys?.length ? entry.gradeKeys : [entry.gradeKey].filter(Boolean);
  if (!eGrades.includes(cls.gradeKey)) return false;
  const eSec = entry.sectionIdx ?? 0;
  if (eSec === cls.sectionIdx) return true;

  const tplId = entry.templateId || entry.templateIds?.[0];
  if (!tplId) return false;
  const allRosterEntries = (appState.rosters?.rosters?.[tplId] || []).filter(re => (re.sectionIdx ?? 0) === eSec);
  const allCls = appState.classes?.classes || [];
  return allRosterEntries.some(re => {
    const clsObj = allCls.find(c => c.id === re.classId);
    return clsObj && clsObj.grade === cls.gradeKey && clsObj.name === cls.section;
  });
}

function placeGroupAt(groupId, day, period) {
  const grp = (appState.templates.templateGroups || []).find(g => g.id === groupId);
  if (!grp) return false;

  // 그룹카드는 화면에서 하나의 카드로 보이므로, 배치도 하나의 aggregate entry로 저장합니다.
  // 이렇게 해야 7AB/8AB/9AB 같은 그룹에서 특정 반(예: 8B)이 누락되지 않고
  // 상세정보·전체반 시간표·자동배치가 같은 기준(ttcardIds 전체)을 보게 됩니다.
  const cards = getGroupCards(grp);
  const data = buildEntryDataFromTtCards(cards, { day, period, groupId: grp.id });
  if (!data) return false;
  addEntry(data);
  return true;
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

  // Collect sections for currentGrade from the student class list first.
  // A timetable card section can contain students from multiple homerooms (예: A,B 함께 수강),
  // so the class view must show every actual homeroom row, not only card.sectionIdx.
  const gradeClassInfos = getAllClasses().filter(c => c.gradeKey === currentGrade);
  const sectionSet = new Set(gradeClassInfos.map(c => c.sectionIdx ?? 0));
  if (!sectionSet.size) {
    entries().forEach(e => {
      if (!entryHasGrade(e, currentGrade)) return;
      const cardIds = [...(e.ttcardIds || []), e.ttcardId].filter(Boolean);
      if (cardIds.length) {
        cardIds.forEach(id => {
          const card = getTtCardById(id);
          if (card?.gradeKey === currentGrade) getTtCardClassInfos(card).forEach(info => sectionSet.add(info.sectionIdx ?? 0));
        });
      } else {
        sectionSet.add(e.sectionIdx ?? 0);
      }
    });
  }
  const gradeSections = [...sectionSet].sort((a, b) => a - b);
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
        const clsInfo = gradeClassInfos.find(c => (c.sectionIdx ?? 0) === sec) || { gradeKey: currentGrade, sectionIdx: sec, section: sectionLabel(sec) };
        const slotEntries = entries().filter(e =>
          e.day === day && e.period === period && entryMatchesClass(e, clsInfo)
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
  const totalCols = numDays * numPer + 1; // +1 for row header
  const DAYS    = Array.from({length: numDays}, (_, i) => i);

  const table = document.createElement("table");
  table.className = "tt-table tt-all-class-table";
  table.style.cssText = "table-layout:fixed;width:100%;height:100%;min-width:0;border-collapse:separate;border-spacing:0";
  // 본문 행 높이는 열 너비와 같은 방식으로 % 기반 계산하고 모든 행에 동일 적용
  const rowCount = Math.max(1, classes.length);
  wrap.style.setProperty("--num-rows", String(rowCount));
  const rowHeight = `calc((100% - var(--tt-all-header-height, 30px)) / ${rowCount})`;
  wrap.style.setProperty("--tt-all-row-height", rowHeight);

  // Inject colgroup for fixed compact class header + equal timetable cells
  const colgroup = document.createElement("colgroup");
  const rowHeaderWidth = 28;
  const hdrCol = document.createElement("col");
  hdrCol.style.width = `${rowHeaderWidth}px`;
  colgroup.appendChild(hdrCol);
  const cellWidth = `calc((100% - ${rowHeaderWidth}px) / ${numDays * numPer})`;
  for (let i = 0; i < numDays * numPer; i++) {
    const col = document.createElement("col");
    col.style.width = cellWidth;
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);

  const thead = document.createElement("thead");

  // Row 1: day headers
  const hr1 = document.createElement("tr");
  const corner = document.createElement("th"); corner.className = "tt-all-corner"; corner.rowSpan = 2;
  corner.innerHTML = `<span style="font-size:clamp(7px,0.7vw,10px)">반</span>`;
  hr1.appendChild(corner);
  DAYS.forEach(d => {
    const th = document.createElement("th"); th.className = "tt-day-header"; th.colSpan = numPer;
    th.textContent = dayLabels[d];
    th.style.cssText = `font-size:clamp(8px,0.8vw,12px);padding:2px;border-left:3px solid #64748b;border-right:4px solid #334155`;
    hr1.appendChild(th);
  });
  thead.appendChild(hr1);

  // Row 2: period sub-headers
  const hr2 = document.createElement("tr");
  DAYS.forEach(day => {
    periods.forEach((lbl, p) => {
      const isDayStart = p === 0;
      const isDayEnd   = p === periods.length - 1;
      const th = document.createElement("th");
      th.className = "tt-period-sub-hdr" + (isDayStart ? " day-start" : "") + (isDayEnd ? " day-end" : "");
      th.dataset.day = String(day);
      th.textContent = lbl;
      th.style.cssText = `font-size:clamp(7px,0.65vw,9px);padding:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;
      hr2.appendChild(th);
    });
  });
  thead.appendChild(hr2);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.style.height = "calc(100% - var(--tt-all-header-height, 30px))";
  let prevGrade = null;
  classes.forEach(cls => {
    const tr = document.createElement("tr");
    tr.style.height = rowHeight;
    tr.style.minHeight = rowHeight;
    tr.style.maxHeight = rowHeight;
    tr.dataset.gradeKey = cls.gradeKey;
    tr.dataset.sectionIdx = String(cls.sectionIdx);
    if (cls.gradeKey !== prevGrade) { tr.className = "tt-all-grade-boundary"; prevGrade = cls.gradeKey; }

    // Row header
    const rowHdr = document.createElement("td"); rowHdr.className = "tt-all-row-hdr";
    const gc = getGradeColor(cls.gradeKey);
    rowHdr.style.cssText = `background:${gc.bg};color:${gc.text};border-left:2px solid ${gc.border};overflow:hidden;font-size:clamp(6px,0.6vw,8px);width:28px;min-width:28px;max-width:28px`;
    rowHdr.innerHTML = `<b style="display:block;font-size:clamp(7px,0.7vw,9px);line-height:1.05">${gradeDisplay(cls.gradeKey)}</b><span style="font-size:clamp(6px,0.6vw,8px);line-height:1.05">${cls.section}</span>`;
    tr.appendChild(rowHdr);

    DAYS.forEach(day => {
      periods.forEach((_, period) => {
        const td = document.createElement("td");
        const isDayStart = period === 0;
        const isDayEnd   = period === periods.length - 1;
        td.className = "tt-cell tt-all-cell" + (isDayStart ? " day-start" : "") + (isDayEnd ? " day-end" : "");
        td.setAttribute("data-day", day);
        td.style.cssText = `padding:0 1px;vertical-align:top;overflow:hidden;height:${rowHeight};min-height:${rowHeight};max-height:${rowHeight};position:relative`;
        td.addEventListener("dragover", e => { if (!canEdit()) return; e.preventDefault(); td.classList.add("tt-dragover"); });
        td.addEventListener("dragleave", () => td.classList.remove("tt-dragover"));
        td.addEventListener("drop", e => {
          e.preventDefault(); td.classList.remove("tt-dragover");
          if (!dragData || !canEdit()) return;
          handleDrop({ ...dragData, sectionIdx: cls.sectionIdx, gradeKey: cls.gradeKey }, day, period);
        });

        const slotEntries = entries().filter(e =>
          e.day === day && e.period === period && entryMatchesClass(e, cls)
        );

        if (slotEntries.length) {
          const cg = document.createElement("div");
          cg.className = "tt-cell-card-grid";
          cg.style.height = "100%";
          cg.style.setProperty("--tt-auto-cols", String(slotEntries.length || 1));
          slotEntries.forEach(entry => cg.appendChild(buildEntryCard(entry, { compact: true })));
          td.appendChild(cg);
        } else {
          const ph = document.createElement("div");
          ph.className = "tt-cell-ph";
          td.appendChild(ph);
        }
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

function ttCardIdsFromPlacement(x = {}) {
  return uniqueStrings([...(x.ttcardIds || []), x.ttcardId]);
}

function audienceForPlacement(x = {}) {
  const studentKeys = new Set();
  const classKeys = new Set();
  const cardIds = ttCardIdsFromPlacement(x);

  const addCardAudience = (card) => {
    if (!card) return;

    // 1순위: 시간표 카드에 저장된 대상 학년반/학생 데이터
    if (Array.isArray(card.classKeys) && card.classKeys.length) {
      card.classKeys.forEach(k => classKeys.add(k));
    }
    if (Array.isArray(card.studentKeys) && card.studentKeys.length) {
      card.studentKeys.forEach(k => studentKeys.add(k));
    }

    // 이전 데이터 호환용 fallback
    if (!card.classKeys?.length) {
      getTtCardClassInfos(card).forEach(info => {
        const key = classKey(info);
        if (key) classKeys.add(key);
      });
    }
    if (!card.studentKeys?.length) {
      getRosterEntriesForTtCard(card).forEach(re => studentKeys.add(`${re.classId}:${re.studentId}`));
    }
  };

  (x.audienceClassKeys || []).forEach(k => classKeys.add(k));
  (x.audienceStudentKeys || []).forEach(k => studentKeys.add(k));

  if (cardIds.length) {
    cardIds.forEach(id => addCardAudience(getTtCardById(id)));
  } else if (x.templateId && x.gradeKey) {
    addCardAudience({ templateId: x.templateId, gradeKey: x.gradeKey, sectionIdx: x.sectionIdx ?? 0 });
  }

  return { studentKeys, classKeys };
}

function setsIntersect(a, b) {
  for (const v of a) if (b.has(v)) return true;
  return false;
}

function audienceGradeSet(a = {}) {
  const out = new Set();
  (a.classKeys || new Set()).forEach(key => {
    const grade = normalizeGradeForClassKey(String(key).split(":")[0]);
    if (grade) out.add(grade);
  });
  return out;
}

function audiencesConflict(a, b) {
  // If both sides have actual roster data, compare students, not homeroom labels.
  // This allows elective groups from the same homeroom to run concurrently when students differ.
  if (a.studentKeys.size && b.studentKeys.size) return setsIntersect(a.studentKeys, b.studentKeys);

  // Different grades can never be a student conflict. This prevents false positives
  // such as 9A being marked as conflicting with 7A merely because both are section A.
  const gradesA = audienceGradeSet(a);
  const gradesB = audienceGradeSet(b);
  if (gradesA.size && gradesB.size && !setsIntersect(gradesA, gradesB)) return false;

  return setsIntersect(a.classKeys, b.classKeys);
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
  captureTimetableUndo("수업 이동");
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
// ── Subject panel ─────────────────────────────────────────────────
// ── Subject panel ─────────────────────────────────────────────────
// ── Entry detail popup ──────────────────────────────────────────
/** Popup showing card detail: 시수/분반/배정현황 */
function showSidebarCardDetail({ title, teachers, gradeKeys, credits, assigned, isDone, sectionIdx, groupName, detailItems = [] }) {
  const existing = document.getElementById("tt-entry-detail-modal");
  if (existing) existing.remove();
  const modal = document.createElement("div"); modal.id = "tt-entry-detail-modal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center";
  const box = document.createElement("div");
  box.style.cssText = "background:white;border-radius:10px;padding:18px 20px;min-width:300px;max-width:460px;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.25);font-size:13px;position:relative";

  const firstGrade = gradeKeys[0] || currentGrade;
  const gc = getGradeColor(firstGrade);
  box.style.borderTop = `4px solid ${gc.border}`;

  const titleEl = document.createElement("div");
  titleEl.style.cssText = "font-weight:700;font-size:15px;margin-bottom:10px;color:#1e3a5f;padding-right:20px";
  titleEl.textContent = title; box.appendChild(titleEl);

  const rows = [
    ["학년",   gradeKeys.map(g => gradeDisplay(g)).join(", ") || "-"],
    ["반",     detailItems.length ? `${detailItems.length}개 구성 카드` : (sectionIdx != null ? formatClassLabel(firstGrade, sectionLabel(sectionIdx)) : "-")],
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

  if (detailItems.length) {
    const listTitle = document.createElement("div");
    listTitle.style.cssText = "margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:700;color:#475569";
    listTitle.textContent = "구성 카드";
    box.appendChild(listTitle);

    const list = document.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:5px";
    detailItems.forEach(item => {
      const row = document.createElement("div");
      row.style.cssText = "display:grid;grid-template-columns:1fr auto;gap:6px;padding:7px 9px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc";
      const main = document.createElement("div");
      main.style.cssText = "min-width:0";
      const nm = document.createElement("div");
      nm.style.cssText = "font-weight:700;color:#1e293b;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      nm.textContent = item.title;
      const sub = document.createElement("div");
      sub.style.cssText = "font-size:10px;color:#64748b;margin-top:2px";
      const itemClassLabel = formatClassLabelList(item.gradeKey, item.classLabels?.length ? item.classLabels : [item.sectionLabel || sectionLabel(item.sectionIdx ?? 0)]);
      sub.textContent = `${itemClassLabel} · ${(item.teachers || []).join(", ") || "교사 없음"}`;
      main.append(nm, sub);
      const cr = document.createElement("div");
      cr.style.cssText = "font-size:10px;font-weight:700;color:#334155;align-self:center;background:#e2e8f0;border-radius:999px;padding:2px 7px";
      cr.textContent = `${item.credits || "-"}시수`;
      row.append(main, cr);
      list.appendChild(row);
    });
    box.appendChild(list);
  }

  if (credits > 0) {
    const pct = Math.min(100, Math.round((assigned / credits) * 100));
    const bar = document.createElement("div"); bar.style.cssText = "margin-top:10px;background:#f1f5f9;border-radius:999px;height:6px;overflow:hidden";
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
    const e = entries().find(x=>x.id===entry.id); if(e){ captureTimetableUndo("수업 고정 변경"); e.pinned=!e.pinned; scheduleSave("timetable"); renderAll(); }
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
      const slotEl = document.createElement("span"); slotEl.style.cssText="font-weight:700;color:#1e293b"; slotEl.textContent=`${dayLabels[e.day]} ${periods[e.period] || `${e.period + 1}교시`}`;
      const secEl = document.createElement("span"); secEl.style.cssText="font-size:10px;color:#6b7280;flex:1"; secEl.textContent = getEntryClassSummary(e);
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

  // 2. 학년/반 — for grouped ttcard entries, show every actual homeroom covered by the roster.
  makeRow("학년/반", getEntryClassSummary(entry));

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

  // 7. 충돌 내역
  renderEntryConflictDetailSection(box, entry);

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
      captureTimetableUndo("수업 고정 변경");
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

  const toolbar = document.createElement("div");
  toolbar.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:6px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc";
  const loadBtn = makeBtn("📥 카드 불러오기", "secondary-btn compact-btn", () => {
    renderSubjectPanel();
    alert(`저장된 시간표 카드 ${getTtCards().length}개를 불러왔습니다.`);
  });
  const refreshBtn = makeBtn("🔄 카드 데이터 갱신", "secondary-btn compact-btn", () => {
    if (!canEdit()) return;
    const n = refreshTtCardData();
    alert(`${n}개 카드 데이터를 갱신했습니다.`);
    renderAll();
  });
  refreshBtn.disabled = !canEdit();
  toolbar.append(loadBtn, refreshBtn);
  panel.appendChild(toolbar);

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
    const grpCards = getGroupCards(grp);
    grpCards.forEach(c => seenIds.add(c.id));
    if (!grpCards.length) return;

    const gradeKeys = [...new Set(grpCards.map(c => c.gradeKey))];
    const credits = Math.max(1, ...grpCards.map(getCreditsForTtCard).filter(v => v > 0));
    const teachers = [...new Set(grpCards.flatMap(c => getTeachersForTtCard(c)).filter(Boolean))];
    const relatedEntries = entries().filter(e =>
      e.groupId === grp.id || grpCards.some(c => e.ttcardId === c.id || (e.ttcardIds || []).includes(c.id))
    );
    const assigned = new Set(relatedEntries.map(e => `${e.day}:${e.period}`)).size;
    const isDone = credits > 0 && assigned >= credits;
    const gradeColor = getGradeColor(gradeKeys[0] || "7학년");
    const detailItems = grpCards.map(describeTtCard);
    const title = `[${grp.name}] ${detailItems.map(i => i.title).join(" · ")}`;
    const card = buildSidebarCard({ title, teachers, gradeKeys, credits, assigned, isDone, gradeColor, groupName: grp.name, detailItems });
    card.dataset.groupId = grp.id;
    card.style.outline = "1.5px solid " + gradeColor.border;
    if (!isDone) {
      card.addEventListener("dragstart", () => {
        dragData = { kind: "group", groupId: grp.id, ttcardIds: grpCards.map(c => c.id), gradeKey: gradeKeys[0] };
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
    const credits = getCreditsForTtCard(c);
    const desc = describeTtCard(c);
    const assigned = entries().filter(e =>
      (e.ttcardId === c.id || (e.ttcardIds || []).includes(c.id)) ||
      (entryTemplateIds(e).includes(c.templateId) && entryHasGrade(e,c.gradeKey) && (e.sectionIdx??0)===c.sectionIdx)
    ).length;
    const isDone = credits > 0 && assigned >= credits;
    const label = desc.title;
    const card = buildSidebarCard({ title: label, teachers: getTeachersForTtCard(c),
      gradeKeys: [c.gradeKey], credits, assigned, isDone, gradeColor, sectionIdx: c.sectionIdx, detailItems: [desc] });
    card.dataset.templateId = c.templateId;
    card.dataset.ttcardId = c.id;
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

function buildSidebarCard({ title, teachers, gradeKeys, credits, assigned, isDone, gradeColor, sectionIdx, groupName, detailItems = [] }) {
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
    showSidebarCardDetail({ title, teachers: uniqueTeachers, gradeKeys, credits, assigned, isDone, sectionIdx, groupName, detailItems });
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
    if (!constraints()[teacher]) constraints()[teacher] = normalizeTimetableConstraint({});
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
        if (!canEdit()) return;
        const roomId = e.target.value || null;
        captureTimetableUndo("교사 배정 교실 수정");
        constraints()[teacher].assignedRoomId = roomId;
        // Apply room to all entries of this teacher without stacking many undo snapshots.
        entries().forEach(en => {
          if (splitTeacherNames(en.teacherName).includes(teacher)) en.roomId = roomId;
        });
        scheduleSave("timetable");
        recomputeConflicts();
        renderAll();
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
          cell.onclick = () => toggleUnavailable(teacher, d, p);
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


function formatLogTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

function getConflictCounts() {
  const counts = Object.fromEntries(CONFLICT_PRIORITY.map(type => [type, 0]));
  const affectedIds = new Set();
  const combined = new Map();
  entries().forEach(e => combined.set(e.id, getEntryConflictSet(e)));
  combined.forEach((set, id) => {
    if (!set || !set.size) return;
    affectedIds.add(id);
    getOrderedConflictTypes(set).forEach(type => { counts[type] = (counts[type] || 0) + 1; });
  });
  return { counts, totalAffected: affectedIds.size };
}

function getConflictDetailRows() {
  const rows = [];
  const dayLabels = ["월", "화", "수", "목", "금"];
  entries()
    .filter(e => getEntryConflictSet(e).size > 0)
    .sort((a, b) => a.day !== b.day ? a.day - b.day : (a.period !== b.period ? a.period - b.period : entryTitle(a).localeCompare(entryTitle(b), "ko")))
    .forEach(entry => {
      const types = getOrderedConflictTypes(getEntryConflictSet(entry));
      types.forEach(type => {
        const meta = CONFLICT_DISPLAY[type];
        if (!meta) return;
        const related = getRelatedConflictEntries(entry, type);
        let detail = "";
        if (["teacher", "room", "student", "syncRequired"].includes(type)) {
          detail = related.length
            ? related.slice(0, 4).map(({ entry: other, detail }) => `${entryTitle(other)} · ${getEntryClassSummary(other)}${detail ? ` (${detail})` : ""}`).join(" / ")
            : getConflictLabel(new Set([type]));
          if (related.length > 4) detail += ` / 외 ${related.length - 4}건`;
        } else {
          detail = getConstraintConflictMessage(type, entry);
        }
        rows.push({
          type,
          label: meta.label,
          color: meta.color,
          slot: `${dayLabels[entry.day] ?? "?"} ${ttConfig().periodLabels?.[entry.period] || `${entry.period + 1}교시`}`,
          title: entryTitle(entry),
          cls: getEntryClassSummary(entry),
          teacher: entryTeachers(entry).join(", ") || "-",
          room: getRoomDisplayName(entry.roomId),
          detail
        });
      });
    });
  return rows;
}

function renderLogPanel() {
  const el = $("ttLogsContent");
  if (!el) return;

  const { counts, totalAffected } = getConflictCounts();
  const conflictRows = getConflictDetailRows();
  const conflictBadges = CONFLICT_PRIORITY
    .filter(type => counts[type] > 0)
    .map(type => `<span class="tt-conflict-chip" data-type="${type}">${escapeHtml(CONFLICT_DISPLAY[type].label)} ${counts[type]}</span>`)
    .join("");

  const auto = lastAutoAssignReport;
  const failedList = auto?.failedNames?.length
    ? `<ul class="tt-log-failed-list">${auto.failedNames.slice(0, 20).map(name => `<li>${escapeHtml(name)}</li>`).join("")}${auto.failedNames.length > 20 ? `<li>외 ${auto.failedNames.length - 20}개</li>` : ""}</ul>`
    : "";

  const logItems = timetableLogs.length
    ? timetableLogs.slice(0, 25).map(log => `
      <div class="tt-log-item">
        <div class="tt-log-item-title"><span>${escapeHtml(log.title)}</span><span class="tt-log-item-time">${formatLogTime(log.ts)}</span></div>
        ${log.message ? `<div class="tt-log-item-msg">${escapeHtml(log.message)}</div>` : ""}
      </div>`).join("")
    : `<div class="tt-log-empty">아직 기록된 로그가 없습니다.</div>`;

  const conflictTable = conflictRows.length
    ? `<div class="tt-log-table-wrap"><table class="tt-log-table">
        <thead><tr><th>유형</th><th>시간</th><th>수업</th><th>반</th><th>교사/교실</th><th>상세</th></tr></thead>
        <tbody>${conflictRows.map(row => `
          <tr>
            <td><span class="tt-log-type-chip" style="background:${row.color}">${escapeHtml(row.label)}</span></td>
            <td>${escapeHtml(row.slot)}</td>
            <td>${escapeHtml(row.title)}</td>
            <td>${escapeHtml(row.cls)}</td>
            <td>${escapeHtml(row.teacher)}<br><span style="color:#64748b">${escapeHtml(row.room)}</span></td>
            <td>${escapeHtml(row.detail)}</td>
          </tr>`).join("")}</tbody>
      </table></div>`
    : `<div class="tt-log-empty">현재 충돌 내역이 없습니다.</div>`;

  el.innerHTML = `
    <div class="tt-log-toolbar">
      <div class="tt-log-title">시간표 로그 · 자동배치 결과 · 충돌 내역</div>
      <div class="tt-log-actions">
        <button type="button" onclick="window._ttRefreshLogs?.()">새로고침</button>
        <button type="button" onclick="window._ttClearLogs?.()">로그 지우기</button>
      </div>
    </div>
    <div class="tt-log-grid">
      <div style="display:flex;flex-direction:column;gap:10px">
        <section class="tt-log-card">
          <div class="tt-log-card-hdr"><span>자동배치 결과</span>${auto ? `<span class="tt-log-item-time">${formatLogTime(auto.ts)}</span>` : ""}</div>
          <div class="tt-log-card-body">
            ${auto ? `
              <dl class="tt-log-kv">
                <dt>대상 학년</dt><dd>${escapeHtml(auto.activeGrades || "-")}</dd>
                <dt>배치 방식</dt><dd>${escapeHtml(auto.stageLabel || "-")}</dd>
                <dt>대상 슬롯</dt><dd>${auto.totalTarget ?? "-"}개</dd>
                <dt>고정 유지</dt><dd>${auto.pinnedCount ?? 0}개</dd>
                <dt>신규 배치</dt><dd>${auto.placedCount ?? 0}개</dd>
                <dt>미배치</dt><dd>${auto.failedCount ?? 0}개</dd>
                <dt>소요 시간</dt><dd>${auto.durationMs != null ? (auto.durationMs / 1000).toFixed(1) + "초" : "-"}</dd>
              </dl>
              <div class="tt-log-badges">
                <span class="tt-log-badge ${auto.failedCount ? "warn" : "ok"}">${auto.failedCount ? "부분 완료" : "전체 완료"}</span>
                ${(auto.conflictTotal || 0) > 0 ? `<span class="tt-log-badge danger">충돌 ${auto.conflictTotal}건</span>` : `<span class="tt-log-badge ok">충돌 없음</span>`}
              </div>
              ${failedList}` : `<div class="tt-log-empty">아직 자동배치 실행 기록이 없습니다.</div>`}
          </div>
        </section>
        <section class="tt-log-card">
          <div class="tt-log-card-hdr"><span>최근 로그</span><span class="tt-log-item-time">최대 ${LOG_LIMIT}개 보관</span></div>
          <div class="tt-log-card-body"><div class="tt-log-list">${logItems}</div></div>
        </section>
      </div>
      <section class="tt-log-card">
        <div class="tt-log-card-hdr">
          <span>현재 충돌 내역</span>
          <span style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">${totalAffected ? `<span class="tt-conflict-summary-label">충돌 ${totalAffected}건</span>${conflictBadges}` : `<span class="tt-log-badge ok">충돌 없음</span>`}</span>
        </div>
        <div class="tt-log-card-body">${conflictTable}</div>
      </section>
    </div>`;
}

window._ttRefreshLogs = () => { recomputeConflicts(); renderLogPanel(); };
window._ttClearLogs = () => {
  if (!confirm("로그 기록을 지울까요? 자동배치 마지막 결과도 함께 지워집니다.")) return;
  timetableLogs = [];
  lastAutoAssignReport = null;
  persistLogState();
  renderLogPanel();
};

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

function checkPlacementValid(item, slot, placed, options = {}) {
  const { respectSoftLimits = true, respectUnavailable = true, respectAssignedRoom = true } = options;
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

  // 2. Exact duplicate: same timetable card already exists in the slot.
  const itemCardIds = new Set(ttCardIdsFromPlacement(item));
  if (itemCardIds.size && slotEnts.some(e => ttCardIdsFromPlacement(e).some(id => itemCardIds.has(id)))) return false;
  if (!itemCardIds.size && slotEnts.some(e => e.templateId === item.templateId && e.gradeKey === item.gradeKey && e.sectionIdx === item.sectionIdx)) return false;

  // 3. Student conflict. Prefer roster-level student comparison; fall back to homeroom coverage.
  const itemAudience = audienceForPlacement(item);
  for (const e of slotEnts) {
    // Same unit → co-located intentionally
    if (item.unitId && e.unitId && item.unitId === e.unitId) continue;

    const sameGrp = (item.groupId && e.groupId && item.groupId === e.groupId) ||
                    (sameGroupTpl(item.templateId, e.templateId));
    const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);
    const eAudience = audienceForPlacement(e);
    const conflict = audiencesConflict(itemAudience, eAudience);

    // Concurrent groups may share the same homeroom only when rosters prove students differ.
    if (conc) {
      if (itemAudience.studentKeys.size && eAudience.studentKeys.size && conflict) return false;
      continue;
    }
    if (conflict) return false;
  }

  // 4. Teacher max per day + unavailable slots
  const dayEnts = existing.filter(e => e.day === slot.day);
  for (const teacher of teachers) {
    const c = constraints()[teacher];
    // Unavailable slot check
    if (respectUnavailable && c?.unavailableSlots?.some(s => s.day === slot.day && s.period === slot.period)) return false;
    const count = dayEnts.filter(e => splitTeacherNames(e.teacherName).includes(teacher)).length;
    const max = Number(c?.maxPerDay) || 0;
    if (respectSoftLimits && max > 0 && count >= max) return false;
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
    const maxConsecutive = Number(constraints()[teacher]?.maxConsecutive) || 0;
    if (respectSoftLimits && maxConsecutive > 0 && maxC > maxConsecutive) return false;
  }
  // 6. Room conflict: if teacher has assigned room, apply; if room already occupied, skip
  for (const teacher of teachers) {
    const c = constraints()[teacher];
    if (respectAssignedRoom && c?.assignedRoomId) {
      // Check if assigned room is already occupied at this slot
      const roomBusy = existing.some(e => e.day===slot.day && e.period===slot.period && e.roomId===c.assignedRoomId);
      if (roomBusy) return false;
    }
  }
  return true;
}
function autoItemKey(item) {
  if (item.ttcardId) return `ttc:${item.ttcardId}`;
  return `tpl:${item.templateId || ""}:${item.gradeKey || ""}:${item.sectionIdx ?? 0}`;
}

function entryMatchesAutoItem(entry, item) {
  if (item.ttcardId) {
    return entry.ttcardId === item.ttcardId || (entry.ttcardIds || []).includes(item.ttcardId);
  }
  const templateMatch = entry.templateId === item.templateId || (entry.templateIds || []).includes(item.templateId);
  const gradeMatch = entry.gradeKey === item.gradeKey || (entry.gradeKeys || []).includes(item.gradeKey);
  const sectionMatch = (entry.sectionIdx ?? 0) === (item.sectionIdx ?? 0);
  return templateMatch && gradeMatch && sectionMatch;
}

function getAutoItemName(item) {
  if (item.ttcardId) {
    const card = getTtCardById(item.ttcardId);
    if (card) return describeTtCard(card).title;
  }
  const base = getTemplateCardTitle(getTemplateById(item.templateId)) || "?";
  return item.gradeKey ? `${base} ${gradeDisplay(item.gradeKey)}${sectionLabel(item.sectionIdx ?? 0)}` : base;
}

function getAutoItemDifficulty(item) {
  const audience = audienceForPlacement(item);
  const teacherCount = splitTeacherNames(item.teacherName).filter(Boolean).length;
  return teacherCount * 20 + audience.studentKeys.size + audience.classKeys.size * 5;
}

function scoreAutoSlot(item, slot, placed) {
  const existing = [...entries(), ...placed];
  const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
  const teachers = splitTeacherNames(item.teacherName).filter(Boolean);
  const dayEnts = existing.filter(e => e.day === slot.day);
  const teacherLoad = teachers.reduce((sum, t) => sum + dayEnts.filter(e => splitTeacherNames(e.teacherName).includes(t)).length, 0);
  const audience = audienceForPlacement(item);
  const classLoad = dayEnts.reduce((sum, e) => sum + (audiencesConflict(audience, audienceForPlacement(e)) ? 1 : 0), 0);
  const samePeriodLoad = existing.filter(e => e.period === slot.period).length;
  return slotEnts.length * 100 + teacherLoad * 8 + classLoad * 6 + samePeriodLoad * 0.15 + Math.random();
}

function findBestAutoSlot(item, baseSlots, placed, checkOptions) {
  const candidates = [];
  for (const slot of shuffle([...baseSlots])) {
    if (checkPlacementValid(item, slot, placed, checkOptions)) {
      candidates.push({ slot, score: scoreAutoSlot(item, slot, placed) });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.slot || null;
}

function getGroupAutoCardIds(group, unitItems = []) {
  return new Set([
    ...(group?.poolCardIds || []),
    ...((group?.units || []).flatMap(u => u.ttcardIds || [])),
    ...(unitItems || []).flatMap(u => (u.ttcards || []).map(c => c.id)),
  ].filter(Boolean));
}

function countPinnedGroupSlots(group, unitItems, pinnedEntries) {
  const cardIds = getGroupAutoCardIds(group, unitItems);
  const slots = new Set();
  pinnedEntries.forEach(e => {
    const cardMatch = (e.ttcardId && cardIds.has(e.ttcardId)) || (e.ttcardIds || []).some(id => cardIds.has(id));
    const unitMatch = (unitItems || []).some(u => u.unit?.id && e.unitId === u.unit.id);
    if (e.groupId === group.id || cardMatch || unitMatch) slots.add(`${e.day}:${e.period}`);
  });
  return slots.size;
}

function placeAutoGroupSlot(group, activeItems, slot, placed) {
  // Current group manager stores a visible group as one aggregate item.
  // Keep one aggregate entry per 시수 so each occurrence is handled independently.
  const groupItem = activeItems[0];
  const item = groupItem ? makePlacementFromGroupItem(group, groupItem) : null;
  if (!item) return false;
  placed.push(normalizeTimetableEntry({ id: uid("ent"), ...item, ...slot }));
  return true;
}

const waitForBrowser = () => new Promise(resolve => setTimeout(resolve, 0));
let autoAssignRunning = false;

function setAutoAssignBusy(isBusy) {
  const btn = $("ttAutoAssignBtn");
  if (!btn) return;
  btn.disabled = isBusy;
  btn.textContent = isBusy ? "⏳ 자동 배치 중..." : "🎲 자동 배치";
}

export async function autoAssignAll() {
  if (!canEdit()) return;
  if (autoAssignRunning) { alert("자동 배치가 이미 진행 중입니다."); return; }

  const activeGrades = GRADE_KEYS.filter(g => getSubjectsForGrade(g).length > 0);
  if (!activeGrades.length) { alert("커리큘럼에 배치된 과목이 없습니다."); return; }

  if (!confirm(`전체 학년 시간표를 자동 배치합니다.\n대상: ${activeGrades.join(", ")}\n\n기존 시간표가 모두 초기화됩니다. 계속할까요?`)) return;

  autoAssignRunning = true;
  setAutoAssignBusy(true);
  await waitForBrowser();

  const autoStartedAt = Date.now();

  try {
  captureTimetableUndo("자동 배정");
  addTimetableLog("auto", "자동 배치 시작", `대상 학년: ${activeGrades.map(gradeDisplay).join(", ")}`);

  // Preserve pinned entries only
  const pinnedEntries = entries().filter(e => e.pinned);
  ttDomain().entries = [...pinnedEntries];

  const { standalone, groupBlocks } = buildSchedulableItems();
  const pc = ttConfig().periodCount;
  const baseSlots = [];
  for (let day = 0; day < 5; day++) {
    for (let period = 0; period < pc; period++) baseSlots.push({ day, period });
  }

  const groupTargetSlots = groupBlocks.reduce((sum, { group, unitItems }) => {
    const credits = unitItems.map(u => u.credits || 0);
    return sum + (group.isConcurrent ? Math.max(0, ...credits) : credits.reduce((a, b) => a + b, 0));
  }, 0);
  const autoTargetSlots = standalone.length + groupTargetSlots;

  const requiredByKey = new Map();
  const itemByKey = new Map();
  standalone.forEach(item => {
    const key = autoItemKey(item);
    requiredByKey.set(key, (requiredByKey.get(key) || 0) + 1);
    if (!itemByKey.has(key)) itemByKey.set(key, item);
  });

  const pinnedByKey = new Map();
  itemByKey.forEach((item, key) => {
    pinnedByKey.set(key, pinnedEntries.filter(e => entryMatchesAutoItem(e, item)).length);
  });

  const stages = [
    { name:"strict", label:"교사 제약 포함", attempts:12, options:{ respectSoftLimits:true,  respectUnavailable:true, respectAssignedRoom:true  } },
    { name:"relaxedSoft", label:"일일/연속 제한 완화", attempts:12, options:{ respectSoftLimits:false, respectUnavailable:true, respectAssignedRoom:true  } },
    { name:"relaxedRoom", label:"교실 자동배정 제한 완화", attempts:8, options:{ respectSoftLimits:false, respectUnavailable:true, respectAssignedRoom:false } },
  ];

  let bestPlaced = [], bestFailed = [], bestScore = -1, bestStage = stages[0];
  let autoOps = 0;
  const yieldAutoAssign = async () => {
    autoOps++;
    if (autoOps % 20 === 0) await waitForBrowser();
  };

  for (const stage of stages) {
    for (let attempt = 0; attempt < stage.attempts; attempt++) {
      await waitForBrowser();
      const placed = [], failed = [];

      // ── Place concurrent groups first: one independent occurrence per 시수 ──
      const orderedGroups = shuffle([...groupBlocks]).sort((a, b) => {
        const ac = Math.max(...a.unitItems.map(u => u.credits));
        const bc = Math.max(...b.unitItems.map(u => u.credits));
        return bc - ac;
      });

      for (const { group, unitItems } of orderedGroups) {
        if (!group.isConcurrent) continue;
        const maxCredits = Math.max(...unitItems.map(u => u.credits));
        const alreadyPinned = countPinnedGroupSlots(group, unitItems, pinnedEntries);
        const needSlots = Math.max(0, maxCredits - alreadyPinned);

        for (let slot_i = 0; slot_i < needSlots; slot_i++) {
          await yieldAutoAssign();
          const activeItems = unitItems.filter(u => slot_i < u.credits);
          if (!activeItems.length) continue;
          const probeItem = makePlacementFromGroupItem(group, activeItems[0]);
          const foundSlot = probeItem ? findBestAutoSlot(probeItem, baseSlots, placed, stage.options) : null;
          if (foundSlot && placeAutoGroupSlot(group, activeItems, foundSlot, placed)) {
            continue;
          }
          activeItems.forEach(groupItem => failed.push({ name: `${group.name} - ${groupItem.name || "그룹 카드"}` }));
        }
      }

      // ── Place non-concurrent groups independently (legacy safety) ─────────
      for (const { group, unitItems } of orderedGroups) {
        if (group.isConcurrent) continue;
        for (const groupItem of unitItems) {
          const pinnedSlots = countPinnedGroupSlots(group, [groupItem], pinnedEntries);
          const needSlots = Math.max(0, groupItem.credits - pinnedSlots);
          for (let i = 0; i < needSlots; i++) {
            await yieldAutoAssign();
            const item = makePlacementFromGroupItem(group, groupItem);
            const slot = item ? findBestAutoSlot(item, baseSlots, placed, stage.options) : null;
            if (slot) placed.push(normalizeTimetableEntry({ id: uid("ent"), ...item, ...slot }));
            else failed.push({ name: `${group.name} - ${groupItem.name || "그룹 카드"}` });
          }
        }
      }

      // ── Place standalone cards: required count minus already pinned count ──
      const placedByKey = new Map();
      const orderedKeys = shuffle([...requiredByKey.keys()]).sort((a, b) => {
        return getAutoItemDifficulty(itemByKey.get(b)) - getAutoItemDifficulty(itemByKey.get(a));
      });

      for (const key of orderedKeys) {
        const item = itemByKey.get(key);
        const required = requiredByKey.get(key) || 0;
        const pinned = pinnedByKey.get(key) || 0;
        while (pinned + (placedByKey.get(key) || 0) < required) {
          await yieldAutoAssign();
          const slot = findBestAutoSlot(item, baseSlots, placed, stage.options);
          if (!slot) {
            failed.push({ name: getAutoItemName(item) });
            break;
          }
          placed.push(normalizeTimetableEntry({ id: uid("ent"), ...item, ...slot }));
          placedByKey.set(key, (placedByKey.get(key) || 0) + 1);
        }
      }

      if (placed.length > bestScore || (placed.length === bestScore && failed.length < bestFailed.length)) {
        bestScore  = placed.length;
        bestPlaced = placed;
        bestFailed = failed;
        bestStage  = stage;
      }
      if (!failed.length) break;
    }
    if (!bestFailed.length) break;
  }

  bestPlaced.forEach(e => entries().push(e));
  scheduleSave("timetable");
  recomputeConflicts();

  const names = [...new Set(bestFailed.map(f => f.name))];
  const conflictSummary = getConflictCounts();
  const report = {
    ts: Date.now(),
    activeGrades: activeGrades.map(gradeDisplay).join(", "),
    stageName: bestStage.name,
    stageLabel: bestStage.label,
    totalTarget: autoTargetSlots,
    pinnedCount: pinnedEntries.length,
    placedCount: bestPlaced.length,
    failedCount: names.length,
    failedNames: names,
    durationMs: Date.now() - autoStartedAt,
    conflictTotal: conflictSummary.totalAffected,
    conflictCounts: conflictSummary.counts
  };
  setLastAutoAssignReport(report);
  addTimetableLog(
    "auto",
    names.length ? "자동 배치 부분 완료" : "자동 배치 완료",
    `신규 배치 ${bestPlaced.length}개, 미배치 ${names.length}개, 충돌 ${conflictSummary.totalAffected}건 · 방식: ${bestStage.label}`
  );
  renderAll();

  const stageNote = bestStage.name === "strict" ? "" : `\n적용 방식: ${bestStage.label}`;
  if (!names.length) {
    alert(`✅ 전체 ${bestPlaced.length}개 슬롯 배치 완료!${stageNote}\n\n자세한 결과는 하단 [로그] 탭에서 확인할 수 있습니다.`);
  } else {
    alert(`✅ ${bestPlaced.length}개 배치 완료\n⚠️ 미배치 ${names.length}개:\n${names.slice(0,12).join("\n")}${names.length>12?"\n...":""}` +
      `\n\n💡 실제 운영 가능한 시간표라면, 고정된 수업·수업 불가 시간·동일 교사 중복 여부를 먼저 확인해 주세요.${stageNote}\n\n자세한 결과는 하단 [로그] 탭에서 확인할 수 있습니다.`);
  }
  } catch (err) {
    console.error("Auto assign failed:", err);
    addTimetableLog("error", "자동 배치 오류", err?.message || String(err));
    alert("자동 배치 중 오류가 발생했습니다. 하단 [로그] 탭과 콘솔 로그를 확인해 주세요.");
  } finally {
    autoAssignRunning = false;
    setAutoAssignBusy(false);
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

  const constraintsEl = $("ttConstraintsContent");
  if (isVisible(constraintsEl)) {
    subscribeOptionalTimetableDomains();
    renderConstraintsPanel();
  }

  renderConflictBar();

  const roomsEl = $("ttRoomsContent");
  if (isVisible(roomsEl)) {
    subscribeOptionalTimetableDomains();
    renderRoomsView(roomsEl, renderAll);
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
let _renderAllTimer = null;
function requestRenderAll() {
  clearTimeout(_renderAllTimer);
  _renderAllTimer = setTimeout(() => renderAll(), 50);
}
setOnUpdate(domain => {
  const knownDomains = ["curriculum","templates","classes","teachers","rosters","rooms","timetable","all"];
  if (knownDomains.includes(domain)) requestRenderAll();
});

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
