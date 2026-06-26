// ================================================================
// timetable-grid.js · Timetable Grid Rendering
// ================================================================
import { canEdit } from "./auth.js";
import { sectionLabel, gradeDisplay } from "./utils.js";
import { getTtCardById } from "./ttcards.js";
import { splitTeacherNames } from "./templates.js";
import {
  getAllClasses,
  getTtCardClassInfos,
  entryHasGrade,
  entryMatchesClass,
} from "./timetable-data.js";

const DAYS = ["월", "화", "수", "목", "금"];
const TT_DRAG_MIME = "application/x-his-timetable-drag";

const ALL_VIEW_MODE_KEY = "his:timetable:allViewMode";
let allSummaryStyleInjected = false;
let groupMergeStyleInjected = false;

function cleanText(v) {
  return String(v ?? "").trim();
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function localUnique(list = []) {
  return [...new Set(list.map(cleanText).filter(Boolean))];
}

function getAllViewMode() {
  const v = localStorage.getItem(ALL_VIEW_MODE_KEY) || "summary";
  if (v === "detail") return "summary";
  return ["summary", "problem"].includes(v) ? v : "summary";
}

function setAllViewMode(v) {
  const mode = ["summary", "problem"].includes(v) ? v : "summary";
  localStorage.setItem(ALL_VIEW_MODE_KEY, mode);
}

function injectAllSummaryStyles() {
  if (allSummaryStyleInjected || document.getElementById("tt-all-summary-style")) return;
  allSummaryStyleInjected = true;
  const style = document.createElement("style");
  style.id = "tt-all-summary-style";
  style.textContent = `
    #ttGrid.tt-all-summary-active{display:flex;flex-direction:column;min-height:0;overflow:hidden!important;background:#f8fafc;}
    .tt-all-view-toolbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid #dbe3ef;background:#f8fafc;box-shadow:0 1px 0 rgba(15,23,42,.04);}
    .tt-all-view-toolbar-title{font-size:11px;font-weight:900;color:#334155;white-space:nowrap;}
    .tt-all-view-mode-btn{height:24px;min-height:24px;padding:0 9px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#475569;font-size:11px;font-weight:900;cursor:pointer;line-height:1;}
    .tt-all-view-mode-btn.active{background:#2563eb;border-color:#2563eb;color:#fff;box-shadow:0 2px 6px rgba(37,99,235,.22);}
    .tt-all-view-help{margin-left:auto;color:#64748b;font-size:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .tt-all-class-table.tt-all-summary-table{flex:1 1 auto;height:auto!important;min-height:0;}
    .tt-all-summary-cell-wrap{height:100%;width:100%;display:flex;align-items:stretch;gap:1px;min-width:0;overflow:hidden;}
    .tt-all-summary-card{position:relative;width:100%;height:100%;min-width:0;border-radius:4px;border:1px solid rgba(15,23,42,.12);border-left:3px solid var(--tt-sum-border,#2563eb);background:var(--tt-sum-bg,#eff6ff);color:var(--tt-sum-text,#1e3a8a);box-sizing:border-box;padding:2px 4px;cursor:pointer;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;overflow:hidden;line-height:1.05;}
    .tt-all-summary-card:hover{filter:brightness(.98);box-shadow:inset 0 0 0 1px rgba(37,99,235,.25);}
    .tt-all-summary-card.tt-all-summary-problem{outline:2px solid #ef4444;outline-offset:-2px;background:#fff1f2!important;color:#9f1239!important;}
    .tt-all-summary-card.tt-all-summary-hidden-normal{opacity:.18;filter:grayscale(.6);}
    .tt-all-summary-top{width:100%;font-size:clamp(7px,.62vw,9px);font-weight:950;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .tt-all-summary-mid{width:100%;margin-top:1px;font-size:clamp(6px,.54vw,8px);font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.92;}
    .tt-all-summary-bottom{width:100%;margin-top:1px;font-size:clamp(5.5px,.50vw,7px);font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.82;}
    .tt-all-summary-card.tt-dragging{opacity:.58;outline:2px dashed rgba(37,99,235,.75);outline-offset:-2px;}
    .tt-all-detail-panel-backdrop{position:fixed;inset:0;z-index:99997;background:rgba(15,23,42,.08);pointer-events:none;}
    .tt-all-detail-panel{position:fixed;top:58px;right:12px;bottom:14px;width:min(430px,calc(100vw - 26px));z-index:99998;border:1px solid #cbd5e1;border-radius:16px;background:#fff;box-shadow:0 22px 55px rgba(15,23,42,.26);display:flex;flex-direction:column;overflow:hidden;pointer-events:auto;}
    .tt-all-detail-panel-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px 12px;border-bottom:1px solid #e2e8f0;background:linear-gradient(180deg,#fff,#f8fafc);}
    .tt-all-detail-panel-title{font-size:16px;font-weight:950;color:#0f172a;line-height:1.25;}
    .tt-all-detail-panel-sub{margin-top:3px;color:#64748b;font-size:11px;font-weight:800;}
    .tt-all-detail-close{width:30px;height:30px;border-radius:999px;border:1px solid #cbd5e1;background:#fff;color:#64748b;font-size:18px;font-weight:900;cursor:pointer;}
    .tt-all-detail-panel-body{padding:14px 16px;overflow:auto;display:flex;flex-direction:column;gap:10px;background:#fff;}
    .tt-all-detail-summary-box{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
    .tt-all-detail-stat{border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;padding:8px 9px;}
    .tt-all-detail-stat b{display:block;font-size:15px;color:#0f172a;line-height:1.1;}
    .tt-all-detail-stat span{display:block;margin-top:2px;font-size:10px;font-weight:800;color:#64748b;}
    .tt-all-detail-item{border:1px solid #e2e8f0;border-left:4px solid var(--tt-sum-border,#2563eb);border-radius:12px;background:#fff;padding:10px 11px;}
    .tt-all-detail-item-title{font-size:13px;font-weight:950;color:#0f172a;line-height:1.25;}
    .tt-all-detail-item-meta{margin-top:5px;color:#475569;font-size:11px;font-weight:750;line-height:1.45;}
    .tt-all-detail-item-actions{display:flex;justify-content:flex-end;margin-top:8px;}
    .tt-all-detail-open-btn{height:26px;padding:0 10px;border:1px solid #bfdbfe;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:900;cursor:pointer;}
    .tt-all-detail-problem-badge{display:inline-flex;margin-left:5px;border-radius:999px;background:#fee2e2;color:#b91c1c;padding:1px 6px;font-size:10px;font-weight:900;vertical-align:middle;}
  `;
  document.head.appendChild(style);
}

function injectGroupMergeStyles() {
  if (groupMergeStyleInjected || document.getElementById("tt-group-merge-style")) return;
  groupMergeStyleInjected = true;
  const style = document.createElement("style");
  style.id = "tt-group-merge-style";
  style.textContent = `
    .tt-cell.tt-group-merged-cell{position:relative;box-shadow:inset 0 0 0 2px rgba(37,99,235,.42);background:linear-gradient(180deg,rgba(239,246,255,.72),rgba(248,250,252,.66));}
    .tt-cell.tt-group-merged-cell .tt-entry-card,
    .tt-cell.tt-group-merged-cell .tt-all-summary-card{height:100%;min-height:100%;}
    .tt-cell.tt-group-merged-cell .tt-cell-card-grid,
    .tt-cell.tt-group-merged-cell .tt-all-summary-cell-wrap{height:100%;}

    /* r148: safe visual rowspan.  Keep the table grid intact and let only
       the first card visually cover the contiguous cells below it. */
    .tt-all-class-table.tt-visual-span-table,
    .tt-all-class-table.tt-visual-span-table tbody,
    .tt-all-class-table.tt-visual-span-table tr{overflow:visible!important;}
    .tt-cell.tt-visual-span-start{overflow:visible!important;position:relative!important;z-index:30!important;}
    .tt-cell.tt-visual-span-cover{position:relative!important;}
    .tt-cell.tt-visual-span-start .tt-all-summary-cell-wrap{overflow:visible!important;position:static!important;}
    .tt-all-summary-card.tt-visual-span-card{
      position:absolute!important;
      left:1px!important;right:1px!important;top:1px!important;
      z-index:45!important;
      width:calc(100% - 2px)!important;
      min-height:0!important;
      border-radius:7px!important;
      box-shadow:0 3px 10px rgba(15,23,42,.18), inset 0 0 0 1px rgba(15,23,42,.10)!important;
      border-width:1px!important;
      border-left-width:4px!important;
    }
    .tt-all-summary-card.tt-visual-span-hidden{visibility:hidden!important;pointer-events:none!important;}
    .tt-cell.tt-visual-span-cover::after{
      content:"";position:absolute;inset:0 1px;z-index:1;pointer-events:none;
      background:rgba(248,250,252,.24);
    }
  `;
  document.head.appendChild(style);
}

function makeAllViewToolbar(wrap) {
  injectAllSummaryStyles();
  wrap.classList.add("tt-all-summary-active");
  const toolbar = document.createElement("div");
  toolbar.className = "tt-all-view-toolbar";
  const title = document.createElement("span");
  title.className = "tt-all-view-toolbar-title";
  title.textContent = "전체보기 표시";
  toolbar.appendChild(title);
  const modes = [
    ["summary", "전체"],
    ["problem", "문제 중심"],
  ];
  const current = getAllViewMode();
  modes.forEach(([value, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tt-all-view-mode-btn" + (value === current ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      setAllViewMode(value);
      if (typeof ctxRenderAll === "function") ctxRenderAll();
      else document.querySelector('.tt-view-btn.active')?.click();
    });
    toolbar.appendChild(btn);
  });
  const help = document.createElement("span");
  help.className = "tt-all-view-help";
  help.textContent = "전체카드를 클릭하면 포함 과목·교사·교실을 확인합니다.";
  toolbar.appendChild(help);
  return toolbar;
}

let ctxRenderAll = null;

function entryCardIds(entry = {}) {
  return localUnique([...(entry.ttcardIds || []), entry.ttcardId]);
}

function cardTitle(card) {
  return cleanText(card?.subject || card?.label || card?.subjectEn || "수업");
}

function entryTitleFallback(entry = {}) {
  const cards = entryCardIds(entry).map(id => getTtCardById(id)).filter(Boolean);
  if (cards.length === 1) return cardTitle(cards[0]);
  if (cards.length > 1) return cards.map(cardTitle).slice(0, 2).join("/") + (cards.length > 2 ? ` 외 ${cards.length - 2}` : "");
  return cleanText(entry.subject || entry.label || entry.title || entry.templateName || "수업");
}

function displayTitleForEntry(entry = {}, ctx = {}) {
  const groupName = cleanText(entry.groupName) || (entry.groupId && typeof ctx.getGroupNameById === "function" ? cleanText(ctx.getGroupNameById(entry.groupId)) : "");
  if (groupName) return groupName;
  const cards = entryCardIds(entry).map(id => getTtCardById(id)).filter(Boolean);
  const groupCardName = cleanText(cards.find(card => cleanText(card.groupName))?.groupName);
  if (groupCardName) return groupCardName;
  return entryTitleFallback(entry);
}


// CP-SAT import entries can store occupied classes as audienceClassKeys such as
// "10:A".  Some legacy UI helpers infer classes from ttcard snapshots only, so
// the grid needs a local, tolerant matcher to keep multi-class/group cards merged
// after import.
function normalizeGridClassKey(value = "", fallbackGradeKey = "") {
  const raw = cleanText(value);
  if (!raw) return "";
  const compact = raw
    .replace(/\s+/g, "")
    .replace(/학년/g, "")
    .replace(/[：]/g, ":")
    .replace(/[\-_/]/g, ":")
    .toUpperCase();

  let m = compact.match(/^(\d{1,2}):?([A-Z]+)$/);
  if (m) return `${m[1]}:${m[2]}`;

  m = compact.match(/^(\d{1,2})([A-Z]+)$/);
  if (m) return `${m[1]}:${m[2]}`;

  const gradeNum = cleanText(fallbackGradeKey).replace(/학년/g, "").match(/\d{1,2}/)?.[0] || "";
  if (gradeNum && /^[A-Z]+$/.test(compact)) return `${gradeNum}:${compact}`;
  return compact;
}

function gridClassKeyForInfo(cls = {}) {
  const grade = cleanText(cls.gradeKey || cls.grade || "");
  const sec = cleanText(cls.section || sectionLabel(cls.sectionIdx ?? 0));
  return normalizeGridClassKey(`${gradeDisplay(grade)}:${sec}`);
}

function explicitClassKeysForEntry(entry = {}) {
  const out = [];
  const add = (value, fallbackGradeKey = "") => {
    const key = normalizeGridClassKey(value, fallbackGradeKey || entry.gradeKey || "");
    if (key) out.push(key);
  };

  safeArray(entry.audienceClassKeys).forEach(v => add(v));
  safeArray(entry.classKeys).forEach(v => add(v));
  safeArray(entry.audienceClassLabels).forEach(v => add(v, entry.gradeKey || safeArray(entry.gradeKeys)[0] || ""));
  safeArray(entry.classLabels).forEach(v => add(v, entry.gradeKey || safeArray(entry.gradeKeys)[0] || ""));

  // CP-SAT component-style exports may keep classKeys under each component.
  safeArray(entry.components).forEach(comp => {
    safeArray(comp?.audienceClassKeys).forEach(v => add(v, comp?.gradeKey || entry.gradeKey || ""));
    safeArray(comp?.classKeys).forEach(v => add(v, comp?.gradeKey || entry.gradeKey || ""));
  });

  return localUnique(out);
}

function entryMatchesClassForGrid(entry = {}, cls = {}) {
  const explicit = explicitClassKeysForEntry(entry);
  if (explicit.length) {
    const target = gridClassKeyForInfo(cls);
    return !!target && explicit.includes(target);
  }
  return entryMatchesClass(entry, cls);
}

function entryTeachers(entry = {}) {
  const direct = Array.isArray(entry.teacherNames) && entry.teacherNames.length ? entry.teacherNames : splitTeacherNames(entry.teacherName || "");
  const cards = entryCardIds(entry).map(id => getTtCardById(id)).filter(Boolean);
  const fromCards = cards.flatMap(c => Array.isArray(c.teachers) && c.teachers.length ? c.teachers : splitTeacherNames(c.teacherName || ""));
  return localUnique([...direct, ...fromCards]);
}

function entryRooms(entry = {}, ctx = {}) {
  // r121: 그룹/묶음 카드는 entry.roomId가 비어 있고
  // roomAssignmentsByTtCardId에 실제 교실이 들어갑니다.
  // 시간표 요약카드는 반드시 effective room ids를 먼저 사용해야 합니다.
  if (typeof ctx.getRoomIdsForEntry === "function") {
    const roomIds = ctx.getRoomIdsForEntry(entry) || [];
    const names = localUnique(roomIds.map(id => ctx.getRoomDisplayName ? ctx.getRoomDisplayName(id) : id).filter(Boolean));
    if (names.length) return names;
  }
  if (typeof ctx.entryRoomSummary === "function") {
    const summary = cleanText(ctx.entryRoomSummary(entry));
    if (summary) return [summary];
  }
  const explicit = entry.roomAssignmentsByTtCardId && typeof entry.roomAssignmentsByTtCardId === "object"
    ? Object.values(entry.roomAssignmentsByTtCardId)
    : [];
  const explicitNames = localUnique(explicit.map(id => ctx.getRoomDisplayName ? ctx.getRoomDisplayName(id) : id).filter(Boolean));
  if (explicitNames.length) return explicitNames;
  const roomId = cleanText(entry.roomId);
  const roomLabel = roomId && ctx.getRoomDisplayName ? ctx.getRoomDisplayName(roomId) : roomId;
  return localUnique([entry.roomName, entry.roomLabel, roomLabel].filter(Boolean));
}

function entryStudents(entry = {}) {
  const cards = entryCardIds(entry).map(id => getTtCardById(id)).filter(Boolean);
  return localUnique(cards.flatMap(c => safeArray(c.studentKeys)));
}

function groupKeyForEntry(entry = {}) {
  if (entry.groupId) return `group:${entry.groupId}`;
  const cards = entryCardIds(entry).map(id => getTtCardById(id)).filter(Boolean);
  const first = cards[0];
  const track = cleanText(first?.track || entry.track);
  if (cards.length > 1 && track) return `track:${entry.gradeKey || first?.gradeKey || ""}:${track}`;
  return `entry:${entry.id}`;
}

function buildEntryGroups(slotEntries = [], ctx = {}) {
  const map = new Map();
  slotEntries.forEach(entry => {
    const key = groupKeyForEntry(entry);
    if (!map.has(key)) map.set(key, { key, entries: [], cards: [] });
    const group = map.get(key);
    group.entries.push(entry);
    entryCardIds(entry).forEach(id => {
      const card = getTtCardById(id);
      if (card && !group.cards.some(c => c.id === card.id)) group.cards.push(card);
    });
  });
  return [...map.values()].map(group => summarizeEntryGroup(group, ctx));
}

function summarizeEntryGroup(group, ctx = {}) {
  const firstEntry = group.entries[0] || {};
  const firstCard = group.cards[0] || null;
  const tracks = localUnique(group.cards.map(c => c.track).concat(group.entries.map(e => e.track)));
  const categories = localUnique(group.cards.map(c => c.category).concat(group.entries.map(e => e.category)));
  const teachers = localUnique(group.entries.flatMap(entryTeachers));
  const rooms = localUnique(group.entries.flatMap(entry => entryRooms(entry, ctx)));
  const studentKeys = localUnique(group.cards.flatMap(c => safeArray(c.studentKeys)).concat(group.entries.flatMap(e => safeArray(e.studentKeys))));
  const conflictCount = group.entries.filter(e => ctx.getEntryConflictSet?.(e)?.size).length;
  const gradeKey = firstEntry.gradeKey || firstCard?.gradeKey || "";
  const gradeColor = ctx.getGradeColor?.(gradeKey) || { bg: "#eff6ff", text: "#1e3a8a", border: "#2563eb" };

  const groupDisplayName = cleanText(firstEntry.groupName) || (firstEntry.groupId && typeof ctx.getGroupNameById === "function" ? cleanText(ctx.getGroupNameById(firstEntry.groupId)) : "") || cleanText(firstCard?.groupName);
  let title = groupDisplayName || tracks.find(t => t && t !== "공통") || tracks[0] || categories[0] || displayTitleForEntry(firstEntry, ctx);
  const subjectTitles = localUnique(group.cards.map(cardTitle));
  const isSingleSubject = group.entries.length === 1 && group.cards.length <= 1;
  if (!groupDisplayName && isSingleSubject) title = subjectTitles[0] || title;

  return {
    ...group,
    title,
    subjectTitles,
    teachers,
    rooms,
    studentCount: studentKeys.length,
    conflictCount,
    gradeColor,
  };
}

function getSummaryDragData(summary = {}) {
  const movable = (summary.entries || []).filter(e => e && !e.pinned);
  if (!movable.length) return null;
  const first = movable[0];

  // 단일 배치이거나 같은 시간의 같은 그룹/unit으로 묶인 요약 카드만 안전하게 이동합니다.
  const isGrouped = !!(first.groupId || first.unitId);
  const canMoveTogether = movable.length === 1 || (isGrouped && movable.every(e =>
    e.day === first.day &&
    e.period === first.period &&
    ((first.groupId && e.groupId === first.groupId) || (first.unitId && e.unitId === first.unitId))
  ));
  if (!canMoveTogether) return null;

  return {
    kind: "entry",
    entryId: first.id,
    teacherName: first.teacherName || "",
    gradeKey: first.gradeKey || "",
    sectionIdx: first.sectionIdx ?? 0,
  };
}

function writeSummaryDragData(ev, data) {
  if (!ev?.dataTransfer || !data) return;
  const payload = JSON.stringify(data);
  ev.dataTransfer.effectAllowed = "move";
  ev.dataTransfer.setData(TT_DRAG_MIME, payload);
  ev.dataTransfer.setData("text/plain", payload);
}

function makeSummaryCard(summary, ctx = {}, mode = "summary") {
  const card = document.createElement("div");
  card.className = "tt-all-summary-card" + (summary.conflictCount ? " tt-all-summary-problem" : "");
  card.dataset.groupKey = cleanText(summary.key || "");
  card.style.setProperty("--tt-sum-bg", summary.gradeColor.bg || "#eff6ff");
  card.style.setProperty("--tt-sum-text", summary.gradeColor.text || "#1e3a8a");
  card.style.setProperty("--tt-sum-border", summary.gradeColor.border || "#2563eb");
  const subjectText = summary.title || displayTitleForEntry(summary.entries?.[0] || {}, ctx);
  const teacherText = (summary.teachers && summary.teachers.length)
    ? summary.teachers.join(", ")
    : "교사 없음";
  const roomText = (summary.rooms && summary.rooms.length)
    ? summary.rooms.join(", ")
    : "교실 미배정";

  const top = document.createElement("div");
  top.className = "tt-all-summary-top";
  top.textContent = subjectText;
  top.title = subjectText;

  const mid = document.createElement("div");
  mid.className = "tt-all-summary-mid";
  mid.textContent = teacherText;
  mid.title = teacherText;

  const bottom = document.createElement("div");
  bottom.className = "tt-all-summary-bottom";
  bottom.textContent = roomText;
  bottom.title = roomText;

  card.append(top, mid, bottom);
  const contextEntry = summary.entries?.[0];
  if (contextEntry?.id) {
    card.dataset.entryId = contextEntry.id;
    card.dataset.ttEntryId = contextEntry.id;
  }
  if (summary.conflictCount) card.title = `문제 ${summary.conflictCount}건 · ${subjectText}`;
  else card.title = [subjectText, teacherText, roomText].filter(Boolean).join(" · ");

  const dragData = getSummaryDragData(summary);
  if (dragData && canEdit()) {
    card.draggable = true;
    card.addEventListener("dragstart", ev => {
      const data = getSummaryDragData(summary);
      if (!data) { ev.preventDefault(); return; }
      writeSummaryDragData(ev, data);
      if (typeof ctx.setDragData === "function") ctx.setDragData(data);
      card.classList.add("tt-dragging");
    });
    card.addEventListener("dragend", () => {
      if (typeof ctx.setDragData === "function") ctx.setDragData(null);
      card.classList.remove("tt-dragging");
    });
  }

  card.addEventListener("click", ev => {
    ev.stopPropagation();
    openAllSummaryDetailPanel(summary, ctx);
  });
  return card;
}

function openAllSummaryDetailPanel(summary, ctx = {}) {
  document.querySelectorAll(".tt-all-detail-panel-backdrop,.tt-all-detail-panel").forEach(el => el.remove());
  const backdrop = document.createElement("div");
  backdrop.className = "tt-all-detail-panel-backdrop";
  const panel = document.createElement("aside");
  panel.className = "tt-all-detail-panel";
  const close = () => { backdrop.remove(); panel.remove(); };
  // 배경 클릭으로 닫히지 않도록 유지합니다. 닫기는 X 버튼에서만 수행합니다.

  const header = document.createElement("div");
  header.className = "tt-all-detail-panel-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("div");
  title.className = "tt-all-detail-panel-title";
  title.textContent = summary.title || displayTitleForEntry(summary.entries?.[0] || {}, ctx);
  const sub = document.createElement("div");
  sub.className = "tt-all-detail-panel-sub";
  sub.textContent = `${summary.entries.length}개 배치 · ${summary.cards.length || summary.entries.length}개 카드`;
  if (summary.conflictCount) {
    const badge = document.createElement("span");
    badge.className = "tt-all-detail-problem-badge";
    badge.textContent = `문제 ${summary.conflictCount}`;
    sub.appendChild(badge);
  }
  titleWrap.append(title, sub);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tt-all-detail-close";
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", close);
  header.append(titleWrap, closeBtn);
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "tt-all-detail-panel-body";
  const stats = document.createElement("div");
  stats.className = "tt-all-detail-summary-box";
  const statData = [
    [summary.subjectTitles.length || summary.cards.length || summary.entries.length, "과목/카드"],
    [summary.studentCount || "-", "학생"],
    [summary.rooms.length || "-", "교실"],
  ];
  statData.forEach(([n, label]) => {
    const item = document.createElement("div");
    item.className = "tt-all-detail-stat";
    item.innerHTML = `<b>${n}</b><span>${label}</span>`;
    stats.appendChild(item);
  });
  body.appendChild(stats);

  const entryToCards = new Map();
  summary.entries.forEach(entry => {
    entryToCards.set(entry, entryCardIds(entry).map(id => getTtCardById(id)).filter(Boolean));
  });

  summary.entries.forEach((entry, idx) => {
    const item = document.createElement("div");
    item.className = "tt-all-detail-item";
    item.style.setProperty("--tt-sum-border", summary.gradeColor.border || "#2563eb");
    const cards = entryToCards.get(entry) || [];
    const names = localUnique(cards.map(cardTitle));
    const itemTitle = document.createElement("div");
    itemTitle.className = "tt-all-detail-item-title";
    itemTitle.textContent = displayTitleForEntry(entry, ctx);
    const conflictSet = ctx.getEntryConflictSet?.(entry) || new Set();
    if (conflictSet.size) {
      const badge = document.createElement("span");
      badge.className = "tt-all-detail-problem-badge";
      badge.textContent = `문제 ${conflictSet.size}`;
      itemTitle.appendChild(badge);
    }
    const meta = document.createElement("div");
    meta.className = "tt-all-detail-item-meta";
    const teachers = entryTeachers(entry).join(", ") || "교사 없음";
    const rooms = entryRooms(entry, ctx).join(", ") || "교실 미배정";
    const students = localUnique(cards.flatMap(c => safeArray(c.studentKeys))).length;
    const classes = localUnique(cards.flatMap(c => safeArray(c.classLabels))).join(", ");
    meta.textContent = [teachers, rooms, students ? `${students}명` : "", classes].filter(Boolean).join(" · ");
    item.append(itemTitle, meta);
    if (ctx.showEntryDetail) {
      const actions = document.createElement("div");
      actions.className = "tt-all-detail-item-actions";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tt-all-detail-open-btn";
      btn.textContent = "배치 상세 열기";
      btn.addEventListener("click", () => ctx.showEntryDetail(entry));
      actions.appendChild(btn);
      item.appendChild(actions);
    }
    body.appendChild(item);
  });

  panel.appendChild(body);
  document.body.append(backdrop, panel);
}

function appendAllSlotContents(td, slotEntries, ctx, mode) {
  if (!slotEntries.length) {
    const ph = document.createElement("div");
    ph.className = "tt-cell-ph";
    td.appendChild(ph);
    return;
  }

  if (mode === "detail") {
    const cg = document.createElement("div");
    cg.className = "tt-cell-card-grid";
    cg.style.height = "100%";
    cg.style.setProperty("--tt-auto-cols", String(slotEntries.length || 1));
    slotEntries.forEach(entry => cg.appendChild(ctx.buildEntryCard(entry, { compact: true })));
    td.appendChild(cg);
    return;
  }

  const groups = buildEntryGroups(slotEntries, ctx);
  const visibleGroups = mode === "problem" ? groups.filter(g => g.conflictCount) : groups;
  if (!visibleGroups.length) {
    const ph = document.createElement("div");
    ph.className = "tt-cell-ph";
    td.appendChild(ph);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "tt-all-summary-cell-wrap";
  wrap.style.setProperty("--tt-auto-cols", String(visibleGroups.length || 1));
  visibleGroups.forEach(g => wrap.appendChild(makeSummaryCard(g, ctx, mode)));
  td.appendChild(wrap);
}



function spanCellKey(day, period, index) {
  return `${day}:${period}:${index}`;
}

function contiguousRuns(indexes = []) {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  const runs = [];
  let current = [];
  sorted.forEach(idx => {
    if (!current.length || idx === current[current.length - 1] + 1) current.push(idx);
    else { runs.push(current); current = [idx]; }
  });
  if (current.length) runs.push(current);
  return runs;
}

function isSpanCandidateEntry(entry = {}, matchedCount = 0) {
  if (matchedCount <= 1) return false;
  const ids = entryCardIds(entry);
  const classLabels = safeArray(entry.classLabels).concat(safeArray(entry.audienceClassLabels));
  const classKeys = safeArray(entry.classKeys).concat(safeArray(entry.audienceClassKeys));
  return !!entry.groupId || !!entry.unitId || ids.length > 1 || classLabels.length > 1 || classKeys.length > 1;
}

function buildAxisSpanMap({ axisItems = [], entries = [], days = [], periods = [], ctx = {}, mode = "summary", matchEntry }) {
  const starts = new Map();
  const skips = new Set();
  if (!axisItems.length || typeof matchEntry !== "function") return { starts, skips };

  days.forEach(day => {
    periods.forEach((_, period) => {
      const slotEntries = entries.filter(e => e.day === day && e.period === period);
      const grouped = new Map();
      slotEntries.forEach(entry => {
        const matched = [];
        axisItems.forEach((item, idx) => {
          if (matchEntry(entry, item, idx)) matched.push(idx);
        });
        if (!isSpanCandidateEntry(entry, matched.length)) return;
        const key = groupKeyForEntry(entry);
        if (!grouped.has(key)) grouped.set(key, { key, entries: [], indices: new Set() });
        const group = grouped.get(key);
        if (!group.entries.some(e => e.id === entry.id)) group.entries.push(entry);
        matched.forEach(idx => group.indices.add(idx));
      });

      grouped.forEach(group => {
        const conflictCount = group.entries.filter(e => ctx.getEntryConflictSet?.(e)?.size).length;
        if (mode === "problem" && !conflictCount) return;
        contiguousRuns([...group.indices]).forEach(run => {
          if (run.length <= 1) return;
          const start = spanCellKey(day, period, run[0]);
          if (starts.has(start)) return;
          starts.set(start, {
            key: group.key,
            span: run.length,
            entries: group.entries,
            indices: run,
          });
          run.slice(1).forEach(idx => skips.add(spanCellKey(day, period, idx)));
        });
      });
    });
  });
  return { starts, skips };
}

function makePeriodLabelCell(label, period, updatePeriodLabel) {
  const pTd = document.createElement("td");
  pTd.className = "tt-period-label";
  const pInp = document.createElement("input");
  pInp.type = "text";
  pInp.value = label;
  pInp.disabled = !canEdit();
  pInp.addEventListener("change", e => updatePeriodLabel(period, e.target.value));
  pTd.appendChild(pInp);
  return pTd;
}

function attachDropHandlers(td, day, period, ctx, patchDragData = null) {
  td.dataset.day = String(day);
  td.dataset.period = String(period);
  td.addEventListener("dragover", e => {
    if (!canEdit()) return;
    e.preventDefault();
    td.classList.add("tt-dragover");
  });
  td.addEventListener("dragleave", () => td.classList.remove("tt-dragover"));
  td.addEventListener("drop", e => {
    e.preventDefault();
    td.classList.remove("tt-dragover");
    const dragData = ctx.getDragData?.();
    if (!dragData || !canEdit()) return;
    const finalDragData = patchDragData ? patchDragData(dragData) : dragData;
    ctx.handleDrop(finalDragData, day, period);
  });
}

function appendSlotContents(td, slotEntries, ctx, cardOpts = {}) {
  if (!slotEntries.length) {
    const ph = document.createElement("div");
    ph.className = "tt-cell-ph";
    td.appendChild(ph);
    return;
  }

  const cg = document.createElement("div");
  cg.className = "tt-cell-card-grid";
  cg.style.setProperty("--tt-auto-cols", String(slotEntries.length || 1));
  slotEntries.forEach(entry => cg.appendChild(ctx.buildEntryCard(entry, { ...cardOpts, compact: true })));
  td.appendChild(cg);
}

export function renderTimetableGrid(ctx) {
  injectGroupMergeStyles();
  const wrap = ctx.wrap;
  if (!wrap) return;
  ctxRenderAll = ctx.renderAll || null;
  wrap.innerHTML = "";
  wrap.classList.remove("tt-all-summary-active");
  wrap.style.display = "";
  wrap.style.flexDirection = "";
  wrap.style.overflow = "";

  if (ctx.currentView === "grade") renderGradeGrid(wrap, ctx);
  else if (ctx.currentView === "all") renderAllClassesGrid(wrap, ctx);
  else if (ctx.currentView === "teacher") renderTeacherGrid(wrap, ctx);
  else if (ctx.currentView === "room") renderRoomGrid(wrap, ctx);
  else if (ctx.currentView === "class") renderClassGrid(wrap, ctx);
}

/** 학년-반별 뷰: 선택 학년의 반(sectionIdx)별 시간표 */
function renderClassGrid(wrap, ctx) {
  const periods = ctx.periods;
  const entries = ctx.entries;
  const currentGrade = ctx.currentGrade;

  const gradeClassInfos = getAllClasses().filter(c => c.gradeKey === currentGrade);
  const sectionSet = new Set(gradeClassInfos.map(c => c.sectionIdx ?? 0));
  if (!sectionSet.size) {
    entries.forEach(e => {
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

  const table = document.createElement("table");
  table.className = "tt-table tt-class-table tt-percent-grid-table";
  table.style.cssText = "table-layout:fixed;width:100%;height:100%;min-width:0;border-collapse:separate;border-spacing:0";
  table.style.setProperty("--tt-period-row-count", String(Math.max(1, periods.length)));
  wrap.style.setProperty("--tt-class-col-count", String(DAYS.length * gradeSections.length));
  wrap.style.setProperty("--tt-class-row-count", String(Math.max(1, periods.length)));

  const rowHeaderWidth = 28;
  const classHeaderHeightPx = 36;
  const rowHeight = `calc((100% - ${classHeaderHeightPx}px) / ${Math.max(1, periods.length)})`;
  const colgroup = document.createElement("colgroup");
  const hdrCol = document.createElement("col");
  hdrCol.style.width = `${rowHeaderWidth}px`;
  colgroup.appendChild(hdrCol);
  const cellWidth = `calc((100% - ${rowHeaderWidth}px) / ${DAYS.length * gradeSections.length})`;
  for (let i = 0; i < DAYS.length * gradeSections.length; i++) {
    const col = document.createElement("col");
    col.style.width = cellWidth;
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  hr.style.height = "22px";
  const corner = document.createElement("th");
  corner.className = "tt-corner";
  corner.style.cssText = `width:${rowHeaderWidth}px;min-width:${rowHeaderWidth}px;max-width:${rowHeaderWidth}px`;
  corner.innerHTML = `<div class="tt-corner-label">교시</div>`;
  hr.appendChild(corner);

  DAYS.forEach(d => {
    const th = document.createElement("th");
    th.className = "tt-day-header";
    th.colSpan = gradeSections.length;
    th.textContent = d;
    th.style.cssText = "font-size:clamp(8px,0.8vw,12px);padding:2px;border-left:3px solid #64748b;border-right:4px solid #334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    hr.appendChild(th);
  });
  thead.appendChild(hr);

  const hr2 = document.createElement("tr");
  hr2.style.height = "14px";
  hr2.appendChild(document.createElement("th"));
  DAYS.forEach(() => {
    gradeSections.forEach(sec => {
      const th = document.createElement("th");
      th.className = "tt-section-sub-hdr";
      th.dataset.gradeKey = currentGrade;
      th.dataset.sectionIdx = String(sec);
      th.textContent = sectionLabel(sec);
      th.style.cssText = "font-size:clamp(7px,0.65vw,9px);padding:1px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      hr2.appendChild(th);
    });
  });
  thead.appendChild(hr2);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.style.height = `calc(100% - ${classHeaderHeightPx}px)`;
  const classAxis = gradeSections.map(sec => gradeClassInfos.find(c => (c.sectionIdx ?? 0) === sec) || {
    gradeKey: currentGrade,
    sectionIdx: sec,
    section: sectionLabel(sec),
  });
  const horizontalSpans = buildAxisSpanMap({
    axisItems: classAxis,
    entries,
    days: DAYS.map((_, i) => i),
    periods,
    ctx,
    mode: "summary",
    matchEntry: (entry, clsInfo) => entryMatchesClassForGrid(entry, clsInfo),
  });
  periods.forEach((label, period) => {
    const tr = document.createElement("tr");
    tr.style.height = rowHeight;
    const periodCell = makePeriodLabelCell(label, period, ctx.updatePeriodLabel);
    periodCell.style.cssText += `;width:${rowHeaderWidth}px;min-width:${rowHeaderWidth}px;max-width:${rowHeaderWidth}px;height:${rowHeight}`;
    tr.appendChild(periodCell);

    DAYS.forEach((_, day) => {
      gradeSections.forEach((sec, secPos) => {
        const spanKey = spanCellKey(day, period, secPos);
        if (horizontalSpans.skips.has(spanKey)) return;
        const span = horizontalSpans.starts.get(spanKey);
        const td = document.createElement("td");
        td.className = "tt-cell tt-percent-grid-cell" + (span ? " tt-group-merged-cell" : "");
        if (span) td.colSpan = span.span;
        td.dataset.gradeKey = currentGrade;
        td.dataset.sectionIdx = String(sec);
        td.setAttribute("data-day", day);
        td.style.cssText = `padding:0 1px;vertical-align:top;overflow:hidden;height:${rowHeight};min-width:0;position:relative`;
        attachDropHandlers(td, day, period, ctx, dragData => ({ ...dragData, sectionIdx: sec }));

        const clsInfo = classAxis[secPos] || {
          gradeKey: currentGrade,
          sectionIdx: sec,
          section: sectionLabel(sec),
        };
        const slotEntries = span
          ? span.entries
          : entries.filter(e => e.day === day && e.period === period && entryMatchesClassForGrid(e, clsInfo));
        if (slotEntries.length) {
          const renderEntries = span ? [slotEntries[0]] : slotEntries;
          renderEntries.forEach(entry => {
            const c = ctx.buildEntryCard(entry, { compact: true });
            c.style.cssText += ";flex-shrink:0;width:100%;height:100%";
            td.appendChild(c);
          });
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

function renderGradeGrid(wrap, ctx) {
  buildGrid(ctx.periods, DAYS, wrap, (day, period) => {
    return ctx.entries.filter(e => entryHasGrade(e, ctx.currentGrade) && e.day === day && e.period === period);
  }, ctx);
}

function renderTeacherGrid(wrap, ctx) {
  const periods = ctx.periods;
  const selectedTeachers = splitTeacherNames(ctx.currentTeacher || "");
  const selectedTeacherSet = new Set(selectedTeachers);
  const classes = getAllClasses();
  if (!classes.length) {
    wrap.appendChild(Object.assign(document.createElement("div"), {
      className: "tt-empty",
      textContent: "시간표 카드를 생성하거나 학생 명단에서 반을 추가하세요.",
    }));
    return;
  }

  if (!selectedTeachers.length) {
    wrap.appendChild(Object.assign(document.createElement("div"), {
      className: "tt-empty",
      textContent: "교사를 한 명 이상 선택하세요.",
    }));
    return;
  }

  const selectedSummary = document.createElement("div");
  selectedSummary.className = "tt-teacher-selected-summary";
  selectedSummary.textContent = selectedTeachers.length === 1
    ? `${selectedTeachers[0]} 교사 시간표`
    : `선택 교사 ${selectedTeachers.length}명: ${selectedTeachers.join(", ")}`;
  selectedSummary.style.cssText = "font-size:11px;font-weight:800;color:#334155;margin:0 0 4px;padding:3px 6px;border:1px solid #dbe4f0;border-radius:8px;background:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  wrap.appendChild(selectedSummary);

  const numDays = DAYS.length;
  const numPer = periods.length;
  const dayIndexes = Array.from({ length: numDays }, (_, i) => i);

  const table = document.createElement("table");
  table.className = "tt-table tt-all-class-table tt-teacher-class-table";
  table.style.cssText = "table-layout:fixed;width:100%;height:calc(100% - 24px);min-width:0;border-collapse:separate;border-spacing:0";

  const rowCount = Math.max(1, classes.length);
  wrap.style.setProperty("--num-rows", String(rowCount));
  const rowHeight = `calc((100% - var(--tt-all-header-height, 30px)) / ${rowCount})`;
  wrap.style.setProperty("--tt-all-row-height", rowHeight);

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
  const hr1 = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "tt-all-corner";
  corner.rowSpan = 2;
  corner.innerHTML = `<span style="font-size:clamp(7px,0.7vw,10px)">반</span>`;
  hr1.appendChild(corner);

  dayIndexes.forEach(d => {
    const th = document.createElement("th");
    th.className = "tt-day-header";
    th.colSpan = numPer;
    th.textContent = DAYS[d];
    th.style.cssText = "font-size:clamp(8px,0.8vw,12px);padding:2px;border-left:3px solid #64748b;border-right:4px solid #334155";
    hr1.appendChild(th);
  });
  thead.appendChild(hr1);

  const hr2 = document.createElement("tr");
  dayIndexes.forEach(day => {
    periods.forEach((lbl, p) => {
      const isDayStart = p === 0;
      const isDayEnd = p === periods.length - 1;
      const th = document.createElement("th");
      th.className = "tt-period-sub-hdr" + (isDayStart ? " day-start" : "") + (isDayEnd ? " day-end" : "");
      th.dataset.day = String(day);
      th.dataset.period = String(p);
      th.textContent = lbl;
      th.style.cssText = "font-size:clamp(7px,0.65vw,9px);padding:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      hr2.appendChild(th);
    });
  });
  thead.appendChild(hr2);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.style.height = "calc(100% - var(--tt-all-header-height, 30px))";
  let prevGrade = null;

  const teacherEntryMatchesSelection = entry => {
    const names = Array.isArray(entry.teacherNames) && entry.teacherNames.length
      ? entry.teacherNames
      : splitTeacherNames(entry.teacherName);
    return names.some(t => selectedTeacherSet.has(t));
  };
  const teacherEntriesForSpans = ctx.entries.filter(teacherEntryMatchesSelection);
  const verticalSpans = buildAxisSpanMap({
    axisItems: classes,
    entries: teacherEntriesForSpans,
    days: dayIndexes,
    periods,
    ctx,
    mode: "summary",
    matchEntry: (entry, cls) => entryMatchesClassForGrid(entry, cls),
  });

  classes.forEach((cls, classPos) => {
    const tr = document.createElement("tr");
    tr.style.height = rowHeight;
    tr.dataset.gradeKey = cls.gradeKey;
    tr.dataset.sectionIdx = String(cls.sectionIdx);
    if (cls.gradeKey !== prevGrade) {
      tr.className = "tt-all-grade-boundary";
      prevGrade = cls.gradeKey;
    }

    const rowHdr = document.createElement("td");
    rowHdr.className = "tt-all-row-hdr tt-teacher-class-row-hdr";
    const gc = ctx.getGradeColor(cls.gradeKey);
    rowHdr.style.cssText = `background:${gc.bg};color:${gc.text};border-left:2px solid ${gc.border};overflow:hidden;font-size:clamp(6px,0.6vw,8px);width:28px;min-width:28px;max-width:28px`;
    rowHdr.innerHTML = `<b style="display:block;font-size:clamp(7px,0.7vw,9px);line-height:1.05">${gradeDisplay(cls.gradeKey)}</b><span style="font-size:clamp(6px,0.6vw,8px);line-height:1.05">${cls.section}</span>`;
    tr.appendChild(rowHdr);

    dayIndexes.forEach(day => {
      periods.forEach((_, period) => {
        const spanKey = spanCellKey(day, period, classPos);
        if (verticalSpans.skips.has(spanKey)) return;
        const span = verticalSpans.starts.get(spanKey);
        const td = document.createElement("td");
        const isDayStart = period === 0;
        const isDayEnd = period === periods.length - 1;
        td.className = "tt-cell tt-all-cell tt-teacher-class-cell" + (isDayStart ? " day-start" : "") + (isDayEnd ? " day-end" : "") + (span ? " tt-group-merged-cell" : "");
        if (span) td.rowSpan = span.span;
        td.dataset.gradeKey = cls.gradeKey;
        td.dataset.sectionIdx = String(cls.sectionIdx);
        td.dataset.allRowIndex = String(classPos);
        td.setAttribute("data-day", day);
        td.dataset.period = String(period);
        td.style.cssText = `padding:0 1px;vertical-align:top;overflow:hidden;height:${rowHeight};position:relative`;
        attachDropHandlers(td, day, period, ctx, dragData => ({ ...dragData, sectionIdx: cls.sectionIdx, gradeKey: cls.gradeKey }));

        const slotEntries = span
          ? span.entries
          : ctx.entries.filter(e => teacherEntryMatchesSelection(e) && e.day === day && e.period === period && entryMatchesClassForGrid(e, cls));

        if (slotEntries.length) {
          const cg = document.createElement("div");
          cg.className = "tt-cell-card-grid";
          cg.style.height = "100%";
          const renderEntries = span ? [slotEntries[0]] : slotEntries;
          cg.style.setProperty("--tt-auto-cols", String(renderEntries.length || 1));
          renderEntries.forEach(entry => cg.appendChild(ctx.buildEntryCard(entry, { compact: true })));
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

function renderRoomGrid(wrap, ctx) {
  const periods = ctx.periods || [];
  const rooms = typeof ctx.getRooms === "function" ? ctx.getRooms() : [];
  const selectedRoomIds = String(ctx.currentRoom || "").split(",").map(v => v.trim()).filter(Boolean);
  const selectedRooms = selectedRoomIds.map(id => rooms.find(r => r.id === id) || { id, name: ctx.getRoomDisplayName?.(id) || id }).filter(Boolean);

  if (!selectedRoomIds.length) {
    wrap.appendChild(Object.assign(document.createElement("div"), {
      className: "tt-empty",
      textContent: "교실을 한 개 이상 선택하세요.",
    }));
    return;
  }

  injectGroupMergeStyles();
  const selectedSummary = document.createElement("div");
  selectedSummary.className = "tt-teacher-selected-summary tt-room-selected-summary";
  selectedSummary.textContent = selectedRooms.length === 1
    ? `${selectedRooms[0].name || selectedRooms[0].id} 교실 시간표`
    : `선택 교실 ${selectedRooms.length}개: ${selectedRooms.map(r => r.name || r.id).join(", ")}`;
  selectedSummary.style.cssText = "font-size:11px;font-weight:800;color:#334155;margin:0 0 4px;padding:3px 6px;border:1px solid #dbe4f0;border-radius:8px;background:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  wrap.appendChild(selectedSummary);

  const dayIndexes = Array.from({ length: DAYS.length }, (_, i) => i);
  const table = document.createElement("table");
  table.className = "tt-table tt-all-class-table tt-room-table-r177";
  table.style.cssText = "table-layout:fixed;width:100%;height:calc(100% - 24px);min-width:0;border-collapse:separate;border-spacing:0";

  const rowCount = Math.max(1, selectedRooms.length);
  wrap.style.setProperty("--num-rows", String(rowCount));
  const rowHeight = `calc((100% - var(--tt-all-header-height, 30px)) / ${rowCount})`;
  wrap.style.setProperty("--tt-all-row-height", rowHeight);

  const colgroup = document.createElement("colgroup");
  const rowHeaderWidth = 74;
  const hdrCol = document.createElement("col");
  hdrCol.style.width = `${rowHeaderWidth}px`;
  colgroup.appendChild(hdrCol);
  const cellWidth = `calc((100% - ${rowHeaderWidth}px) / ${dayIndexes.length * periods.length})`;
  for (let i = 0; i < dayIndexes.length * periods.length; i++) {
    const col = document.createElement("col");
    col.style.width = cellWidth;
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);

  const thead = document.createElement("thead");
  const hr1 = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "tt-all-corner tt-room-corner-r177";
  corner.rowSpan = 2;
  corner.innerHTML = `<span style="font-size:clamp(7px,0.7vw,10px)">교실</span>`;
  hr1.appendChild(corner);

  dayIndexes.forEach(d => {
    const th = document.createElement("th");
    th.className = "tt-day-header";
    th.colSpan = periods.length;
    th.textContent = DAYS[d];
    th.style.cssText = "font-size:clamp(8px,0.8vw,12px);padding:2px;border-left:3px solid #64748b;border-right:4px solid #334155";
    hr1.appendChild(th);
  });
  thead.appendChild(hr1);

  const hr2 = document.createElement("tr");
  dayIndexes.forEach(day => {
    periods.forEach((lbl, p) => {
      const th = document.createElement("th");
      th.className = "tt-period-sub-hdr" + (p === 0 ? " day-start" : "") + (p === periods.length - 1 ? " day-end" : "");
      th.dataset.day = String(day);
      th.dataset.period = String(p);
      th.textContent = lbl;
      th.style.cssText = "font-size:clamp(7px,0.65vw,9px);padding:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      hr2.appendChild(th);
    });
  });
  thead.appendChild(hr2);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.style.height = "calc(100% - var(--tt-all-header-height, 30px))";

  const getEntryRoomIds = entry => typeof ctx.getRoomIdsForEntry === "function"
    ? (ctx.getRoomIdsForEntry(entry) || []).map(cleanText).filter(Boolean)
    : [entry.roomId].map(cleanText).filter(Boolean);

  const entryUsesRoom = (entry, roomId) => getEntryRoomIds(entry).includes(roomId);

  const scopedEntryForRoom = (entry, roomId) => {
    const assignments = entry.roomAssignmentsByTtCardId && typeof entry.roomAssignmentsByTtCardId === "object"
      ? entry.roomAssignmentsByTtCardId
      : null;
    if (!assignments) return { ...entry, roomId, roomIds: [roomId] };
    const selectedAssignments = {};
    Object.entries(assignments).forEach(([cardId, assignedRoomId]) => {
      if (cleanText(assignedRoomId) === roomId) selectedAssignments[cardId] = assignedRoomId;
    });
    const selectedCardIds = Object.keys(selectedAssignments);
    if (!selectedCardIds.length) return { ...entry, roomId, roomIds: [roomId] };

    const scoped = {
      ...entry,
      ttcardIds: selectedCardIds,
      ttcardId: selectedCardIds[0] || entry.ttcardId,
      roomId,
      roomIds: [roomId],
      roomAssignmentsByTtCardId: selectedAssignments,
      __roomScopedOriginalEntryId: entry.id,
    };
    return scoped;
  };

  selectedRooms.forEach(room => {
    const roomId = room.id;
    const tr = document.createElement("tr");
    tr.style.height = rowHeight;
    tr.dataset.roomId = roomId;

    const rowHdr = document.createElement("td");
    rowHdr.className = "tt-all-row-hdr tt-room-row-hdr-r177";
    rowHdr.style.cssText = "background:#f8fafc;color:#0f172a;border-left:2px solid #0ea5e9;border-right:2px solid #94a3b8;overflow:hidden;font-size:clamp(8px,0.65vw,10px);width:74px;min-width:74px;max-width:74px;padding:2px 3px;white-space:normal;line-height:1.08";
    rowHdr.innerHTML = `<b style="display:block;font-size:clamp(9px,0.75vw,11px);line-height:1.05;overflow:hidden;text-overflow:ellipsis">${room.name || room.id}</b><span style="display:block;font-size:clamp(6px,0.55vw,8px);color:#64748b;line-height:1.05">${room.type || ""}</span>`;
    tr.appendChild(rowHdr);

    dayIndexes.forEach(day => {
      periods.forEach((_, period) => {
        const td = document.createElement("td");
        const isDayStart = period === 0;
        const isDayEnd = period === periods.length - 1;
        td.className = "tt-cell tt-all-cell tt-room-cell-r177" + (isDayStart ? " day-start" : "") + (isDayEnd ? " day-end" : "");
        td.dataset.roomId = roomId;
        td.setAttribute("data-day", day);
        td.dataset.period = String(period);
        td.style.cssText = `padding:0 1px;vertical-align:top;overflow:hidden;height:${rowHeight};position:relative`;
        attachDropHandlers(td, day, period, ctx, dragData => ({
          ...dragData,
          roomId,
          fixedRoomId: roomId,
          roomRule: "fixed",
          roomPinned: true,
        }));

        const slotEntries = ctx.entries
          .filter(e => e.day === day && e.period === period && entryUsesRoom(e, roomId))
          .map(e => scopedEntryForRoom(e, roomId));

        if (slotEntries.length) {
          const cg = document.createElement("div");
          cg.className = "tt-cell-card-grid";
          cg.style.height = "100%";
          cg.style.setProperty("--tt-auto-cols", String(slotEntries.length || 1));
          slotEntries.forEach(entry => cg.appendChild(ctx.buildEntryCard(entry, { compact: true, showGrade: true })));
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

function renderAllClassesGrid(wrap, ctx) {
  const periods = ctx.periods;
  const classes = getAllClasses();
  if (!classes.length) {
    wrap.appendChild(Object.assign(document.createElement("div"), {
      className: "tt-empty",
      textContent: "시간표 카드를 생성하거나 학생 명단에서 반을 추가하세요.",
    }));
    return;
  }

  const mode = getAllViewMode();
  wrap.appendChild(makeAllViewToolbar(wrap));

  const numDays = DAYS.length;
  const numPer = periods.length;
  const dayIndexes = Array.from({ length: numDays }, (_, i) => i);

  const table = document.createElement("table");
  table.className = "tt-table tt-all-class-table tt-all-summary-table";
  table.style.cssText = "table-layout:fixed;width:100%;height:calc(100% - 35px);min-width:0;border-collapse:separate;border-spacing:0";

  const rowCount = Math.max(1, classes.length);
  wrap.style.setProperty("--num-rows", String(rowCount));
  const rowHeight = `calc((100% - var(--tt-all-header-height, 30px)) / ${rowCount})`;
  wrap.style.setProperty("--tt-all-row-height", rowHeight);

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
  const hr1 = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "tt-all-corner";
  corner.rowSpan = 2;
  corner.innerHTML = `<span style="font-size:clamp(7px,0.7vw,10px)">반</span>`;
  hr1.appendChild(corner);
  dayIndexes.forEach(d => {
    const th = document.createElement("th");
    th.className = "tt-day-header";
    th.colSpan = numPer;
    th.textContent = DAYS[d];
    th.style.cssText = "font-size:clamp(8px,0.8vw,12px);padding:2px;border-left:3px solid #64748b;border-right:4px solid #334155";
    hr1.appendChild(th);
  });
  thead.appendChild(hr1);

  const hr2 = document.createElement("tr");
  dayIndexes.forEach(day => {
    periods.forEach((lbl, p) => {
      const isDayStart = p === 0;
      const isDayEnd = p === periods.length - 1;
      const th = document.createElement("th");
      th.className = "tt-period-sub-hdr" + (isDayStart ? " day-start" : "") + (isDayEnd ? " day-end" : "");
      th.dataset.day = String(day);
      th.dataset.period = String(p);
      th.textContent = lbl;
      th.style.cssText = "font-size:clamp(7px,0.65vw,9px);padding:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      hr2.appendChild(th);
    });
  });
  thead.appendChild(hr2);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.style.height = "calc(100% - var(--tt-all-header-height, 30px))";
  let prevGrade = null;
  classes.forEach((cls, classPos) => {
    const tr = document.createElement("tr");
    tr.style.height = rowHeight;
    tr.dataset.gradeKey = cls.gradeKey;
    tr.dataset.sectionIdx = String(cls.sectionIdx);
    if (cls.gradeKey !== prevGrade) {
      tr.className = "tt-all-grade-boundary";
      prevGrade = cls.gradeKey;
    }

    const rowHdr = document.createElement("td");
    rowHdr.className = "tt-all-row-hdr";
    const gc = ctx.getGradeColor(cls.gradeKey);
    rowHdr.style.cssText = `background:${gc.bg};color:${gc.text};border-left:2px solid ${gc.border};overflow:hidden;font-size:clamp(6px,0.6vw,8px);width:28px;min-width:28px;max-width:28px`;
    rowHdr.innerHTML = `<b style="display:block;font-size:clamp(7px,0.7vw,9px);line-height:1.05">${gradeDisplay(cls.gradeKey)}</b><span style="font-size:clamp(6px,0.6vw,8px);line-height:1.05">${cls.section}</span>`;
    tr.appendChild(rowHdr);

    dayIndexes.forEach(day => {
      periods.forEach((_, period) => {
        const td = document.createElement("td");
        const isDayStart = period === 0;
        const isDayEnd = period === periods.length - 1;
        td.className = "tt-cell tt-all-cell" + (isDayStart ? " day-start" : "") + (isDayEnd ? " day-end" : "");
        td.dataset.gradeKey = cls.gradeKey;
        td.dataset.sectionIdx = String(cls.sectionIdx);
        td.dataset.allRowIndex = String(classPos);
        td.setAttribute("data-day", day);
        td.dataset.period = String(period);
        td.style.cssText = `padding:0 1px;vertical-align:top;overflow:hidden;height:${rowHeight};position:relative`;
        attachDropHandlers(td, day, period, ctx, dragData => ({ ...dragData, sectionIdx: cls.sectionIdx, gradeKey: cls.gradeKey }));

        const slotEntries = ctx.entries.filter(e => e.day === day && e.period === period && entryMatchesClassForGrid(e, cls));
        appendAllSlotContents(td, slotEntries, ctx, mode);
        tr.appendChild(td);
      });
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  requestAnimationFrame(() => applyAllClassVisualSpans(table));
}

function cardMergeSignature(card) {
  if (!card) return "";
  const explicit = cleanText(card.dataset.groupKey || "");
  if (explicit && !explicit.startsWith("entry:")) return explicit;
  // Same CP-SAT entry shown in several audience class cells should still merge.
  const entryId = cleanText(card.dataset.entryId || card.dataset.ttEntryId || "");
  if (entryId) return `entry:${entryId}`;
  return explicit;
}

function onlyMergeableCardInCell(td) {
  if (!td) return null;
  const cards = [...td.querySelectorAll(":scope .tt-all-summary-card")].filter(card => {
    if (card.classList.contains("tt-visual-span-hidden")) return false;
    return cardMergeSignature(card);
  });
  // If a cell contains two different visible cards, do not overlay it.
  // This prevents 선택/분반 cells from being covered incorrectly.
  return cards.length === 1 ? cards[0] : null;
}

function resetAllClassVisualSpans(table) {
  table?.classList.remove("tt-visual-span-table");
  table?.querySelectorAll(".tt-visual-span-start,.tt-visual-span-cover").forEach(el => {
    el.classList.remove("tt-visual-span-start", "tt-visual-span-cover");
  });
  table?.querySelectorAll(".tt-visual-span-card").forEach(card => {
    card.classList.remove("tt-visual-span-card");
    card.style.height = "";
  });
  table?.querySelectorAll(".tt-visual-span-hidden").forEach(card => {
    card.classList.remove("tt-visual-span-hidden");
  });
}

function applyAllClassVisualSpans(table) {
  if (!table || !table.isConnected) return;
  resetAllClassVisualSpans(table);
  const cells = [...table.querySelectorAll("td.tt-all-cell")];
  if (!cells.length) return;
  const bySlot = new Map();
  cells.forEach(td => {
    const day = td.getAttribute("data-day") ?? td.dataset.day ?? "";
    const period = td.dataset.period ?? "";
    const row = Number(td.dataset.allRowIndex ?? -1);
    if (day === "" || period === "" || row < 0) return;
    const key = `${day}:${period}`;
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key).push({ td, row });
  });

  let applied = 0;
  bySlot.forEach(items => {
    items.sort((a,b) => a.row - b.row);
    let i = 0;
    while (i < items.length) {
      const firstCard = onlyMergeableCardInCell(items[i].td);
      const sig = cardMergeSignature(firstCard);
      if (!sig) { i += 1; continue; }
      let j = i + 1;
      while (j < items.length && items[j].row === items[j - 1].row + 1) {
        const nextCard = onlyMergeableCardInCell(items[j].td);
        if (cardMergeSignature(nextCard) !== sig) break;
        j += 1;
      }
      const run = items.slice(i, j);
      if (run.length > 1) {
        const startTd = run[0].td;
        const endTd = run[run.length - 1].td;
        const card = onlyMergeableCardInCell(startTd);
        const startRect = startTd.getBoundingClientRect();
        const endRect = endTd.getBoundingClientRect();
        const height = Math.max(startRect.height, endRect.bottom - startRect.top - 2);
        startTd.classList.add("tt-visual-span-start");
        card.classList.add("tt-visual-span-card");
        card.style.height = `${Math.floor(height)}px`;
        run.slice(1).forEach(({td}) => {
          td.classList.add("tt-visual-span-cover");
          const hidden = onlyMergeableCardInCell(td);
          if (hidden) hidden.classList.add("tt-visual-span-hidden");
        });
        applied += 1;
      }
      i = Math.max(j, i + 1);
    }
  });
  if (applied) table.classList.add("tt-visual-span-table");
}

function buildGrid(periods, days, wrap, getEntries, ctx, cardOpts = {}) {
  const table = document.createElement("table");
  table.className = "tt-table tt-grade-percent-table";
  table.style.cssText = "table-layout:fixed;width:100%;height:100%;min-width:0;border-collapse:separate;border-spacing:0";
  table.style.setProperty("--tt-period-row-count", String(Math.max(1, periods.length)));

  const rowHeaderWidth = 28;
  const gradeHeaderHeightPx = 24;
  const rowHeight = `calc((100% - ${gradeHeaderHeightPx}px) / ${Math.max(1, periods.length)})`;
  wrap.style.setProperty("--tt-grade-row-count", String(Math.max(1, periods.length)));
  const colgroup = document.createElement("colgroup");
  const hdrCol = document.createElement("col");
  hdrCol.style.width = `${rowHeaderWidth}px`;
  colgroup.appendChild(hdrCol);
  const cellWidth = `calc((100% - ${rowHeaderWidth}px) / ${Math.max(1, days.length)})`;
  days.forEach(() => {
    const col = document.createElement("col");
    col.style.width = cellWidth;
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);

  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  hrow.style.height = `${gradeHeaderHeightPx}px`;
  const corner = document.createElement("th");
  corner.className = "tt-corner";
  corner.style.cssText = `width:${rowHeaderWidth}px;min-width:${rowHeaderWidth}px;max-width:${rowHeaderWidth}px`;
  corner.innerHTML = `<div class="tt-corner-label">교시</div>`;
  hrow.appendChild(corner);
  days.forEach(d => {
    const th = document.createElement("th");
    th.className = "tt-day-header";
    th.textContent = d;
    th.style.cssText = "font-size:clamp(8px,0.8vw,12px);padding:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.style.height = `calc(100% - ${gradeHeaderHeightPx}px)`;
  periods.forEach((label, period) => {
    const tr = document.createElement("tr");
    tr.style.height = rowHeight;
    const periodCell = makePeriodLabelCell(label, period, ctx.updatePeriodLabel);
    periodCell.style.cssText += `;width:${rowHeaderWidth}px;min-width:${rowHeaderWidth}px;max-width:${rowHeaderWidth}px;height:${rowHeight}`;
    tr.appendChild(periodCell);

    days.forEach((_, day) => {
      const td = document.createElement("td");
      td.className = "tt-cell tt-grade-percent-cell";
      if (ctx.currentGrade) td.dataset.gradeKey = ctx.currentGrade;
      td.setAttribute("data-day", day);
      td.style.cssText = `padding:0 1px;vertical-align:top;overflow:hidden;height:${rowHeight};min-width:0;position:relative`;
      const slotEntries = getEntries(day, period);
      attachDropHandlers(td, day, period, ctx);
      appendSlotContents(td, slotEntries, ctx, { ...cardOpts, compact: true });
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return table;
}
