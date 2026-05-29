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
  const wrap = ctx.wrap;
  if (!wrap) return;
  wrap.innerHTML = "";

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
  wrap.style.setProperty("--tt-class-col-count", String(DAYS.length * gradeSections.length));
  wrap.style.setProperty("--tt-class-row-count", String(Math.max(1, periods.length)));

  const rowHeaderWidth = 28;
  const rowHeight = `calc((100% - var(--tt-class-header-height, 44px)) / ${Math.max(1, periods.length)})`;
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
  hr2.appendChild(document.createElement("th"));
  DAYS.forEach(() => {
    gradeSections.forEach(sec => {
      const th = document.createElement("th");
      th.className = "tt-section-sub-hdr";
      th.textContent = sectionLabel(sec);
      th.style.cssText = "font-size:clamp(7px,0.65vw,9px);padding:1px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      hr2.appendChild(th);
    });
  });
  thead.appendChild(hr2);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.style.height = "calc(100% - var(--tt-class-header-height, 44px))";
  periods.forEach((label, period) => {
    const tr = document.createElement("tr");
    tr.style.height = rowHeight;
    tr.style.minHeight = rowHeight;
    tr.style.maxHeight = rowHeight;
    const periodCell = makePeriodLabelCell(label, period, ctx.updatePeriodLabel);
    periodCell.style.cssText += `;width:${rowHeaderWidth}px;min-width:${rowHeaderWidth}px;max-width:${rowHeaderWidth}px;height:${rowHeight};min-height:${rowHeight};max-height:${rowHeight}`;
    tr.appendChild(periodCell);

    DAYS.forEach((_, day) => {
      gradeSections.forEach(sec => {
        const td = document.createElement("td");
        td.className = "tt-cell tt-percent-grid-cell";
        td.setAttribute("data-day", day);
        td.style.cssText = `padding:0 1px;vertical-align:top;overflow:hidden;height:${rowHeight};min-height:${rowHeight};max-height:${rowHeight};min-width:0;position:relative`;
        attachDropHandlers(td, day, period, ctx, dragData => ({ ...dragData, sectionIdx: sec }));

        const clsInfo = gradeClassInfos.find(c => (c.sectionIdx ?? 0) === sec) || {
          gradeKey: currentGrade,
          sectionIdx: sec,
          section: sectionLabel(sec),
        };
        const slotEntries = entries.filter(e => e.day === day && e.period === period && entryMatchesClass(e, clsInfo));
        if (slotEntries.length) {
          slotEntries.forEach(entry => {
            const c = ctx.buildEntryCard(entry, { compact: true });
            c.style.cssText += ";flex-shrink:0;width:100%";
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

  classes.forEach(cls => {
    const tr = document.createElement("tr");
    tr.style.height = rowHeight;
    tr.style.minHeight = rowHeight;
    tr.style.maxHeight = rowHeight;
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
        const td = document.createElement("td");
        const isDayStart = period === 0;
        const isDayEnd = period === periods.length - 1;
        td.className = "tt-cell tt-all-cell tt-teacher-class-cell" + (isDayStart ? " day-start" : "") + (isDayEnd ? " day-end" : "");
        td.setAttribute("data-day", day);
        td.style.cssText = `padding:0 1px;vertical-align:top;overflow:hidden;height:${rowHeight};min-height:${rowHeight};max-height:${rowHeight};position:relative`;
        attachDropHandlers(td, day, period, ctx, dragData => ({ ...dragData, sectionIdx: cls.sectionIdx, gradeKey: cls.gradeKey }));

        const slotEntries = ctx.entries.filter(e => {
          const names = Array.isArray(e.teacherNames) && e.teacherNames.length
            ? e.teacherNames
            : splitTeacherNames(e.teacherName);
          return names.some(t => selectedTeacherSet.has(t)) && e.day === day && e.period === period && entryMatchesClass(e, cls);
        });

        if (slotEntries.length) {
          const cg = document.createElement("div");
          cg.className = "tt-cell-card-grid";
          cg.style.height = "100%";
          cg.style.setProperty("--tt-auto-cols", String(slotEntries.length || 1));
          slotEntries.forEach(entry => cg.appendChild(ctx.buildEntryCard(entry, { compact: true })));
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
  const periods = ctx.periods;
  const rooms = typeof ctx.getRooms === "function" ? ctx.getRooms() : [];
  const selectedRoomIds = String(ctx.currentRoom || "").split(",").map(v => v.trim()).filter(Boolean);
  const selectedRoomSet = new Set(selectedRoomIds);
  const selectedRooms = selectedRoomIds.map(id => rooms.find(r => r.id === id)).filter(Boolean);
  const primaryRoomId = selectedRoomIds[0] || "";
  const classes = getAllClasses();
  if (!classes.length) {
    wrap.appendChild(Object.assign(document.createElement("div"), {
      className: "tt-empty",
      textContent: "시간표 카드를 생성하거나 학생 명단에서 반을 추가하세요.",
    }));
    return;
  }

  if (!selectedRoomIds.length) {
    wrap.appendChild(Object.assign(document.createElement("div"), {
      className: "tt-empty",
      textContent: "교실을 한 개 이상 선택하세요.",
    }));
    return;
  }

  const selectedSummary = document.createElement("div");
  selectedSummary.className = "tt-teacher-selected-summary tt-room-selected-summary";
  selectedSummary.textContent = selectedRooms.length === 1
    ? `${selectedRooms[0].name || selectedRooms[0].id} 교실 시간표`
    : `선택 교실 ${selectedRoomIds.length}개: ${selectedRoomIds.map(id => rooms.find(r => r.id === id)?.name || id).join(", ")}`;
  selectedSummary.style.cssText = "font-size:11px;font-weight:800;color:#334155;margin:0 0 4px;padding:3px 6px;border:1px solid #dbe4f0;border-radius:8px;background:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  wrap.appendChild(selectedSummary);

  const numDays = DAYS.length;
  const numPer = periods.length;
  const dayIndexes = Array.from({ length: numDays }, (_, i) => i);

  const table = document.createElement("table");
  table.className = "tt-table tt-all-class-table tt-room-class-table";
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

  classes.forEach(cls => {
    const tr = document.createElement("tr");
    tr.style.height = rowHeight;
    tr.style.minHeight = rowHeight;
    tr.style.maxHeight = rowHeight;
    tr.dataset.gradeKey = cls.gradeKey;
    tr.dataset.sectionIdx = String(cls.sectionIdx);
    if (cls.gradeKey !== prevGrade) {
      tr.className = "tt-all-grade-boundary";
      prevGrade = cls.gradeKey;
    }

    const rowHdr = document.createElement("td");
    rowHdr.className = "tt-all-row-hdr tt-room-class-row-hdr";
    const gc = ctx.getGradeColor(cls.gradeKey);
    rowHdr.style.cssText = `background:${gc.bg};color:${gc.text};border-left:2px solid ${gc.border};overflow:hidden;font-size:clamp(6px,0.6vw,8px);width:28px;min-width:28px;max-width:28px`;
    rowHdr.innerHTML = `<b style="display:block;font-size:clamp(7px,0.7vw,9px);line-height:1.05">${gradeDisplay(cls.gradeKey)}</b><span style="font-size:clamp(6px,0.6vw,8px);line-height:1.05">${cls.section}</span>`;
    tr.appendChild(rowHdr);

    dayIndexes.forEach(day => {
      periods.forEach((_, period) => {
        const td = document.createElement("td");
        const isDayStart = period === 0;
        const isDayEnd = period === periods.length - 1;
        td.className = "tt-cell tt-all-cell tt-room-class-cell" + (isDayStart ? " day-start" : "") + (isDayEnd ? " day-end" : "");
        td.setAttribute("data-day", day);
        td.style.cssText = `padding:0 1px;vertical-align:top;overflow:hidden;height:${rowHeight};min-height:${rowHeight};max-height:${rowHeight};position:relative`;
        attachDropHandlers(td, day, period, ctx, dragData => ({
          ...dragData,
          sectionIdx: cls.sectionIdx,
          gradeKey: cls.gradeKey,
          roomId: primaryRoomId,
          fixedRoomId: primaryRoomId,
          roomRule: "fixed",
          roomPinned: true,
        }));

        const slotEntries = ctx.entries.filter(e => selectedRoomSet.has(e.roomId) && e.day === day && e.period === period && entryMatchesClass(e, cls));

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

  const numDays = DAYS.length;
  const numPer = periods.length;
  const dayIndexes = Array.from({ length: numDays }, (_, i) => i);

  const table = document.createElement("table");
  table.className = "tt-table tt-all-class-table";
  table.style.cssText = "table-layout:fixed;width:100%;height:100%;min-width:0;border-collapse:separate;border-spacing:0";

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
  classes.forEach(cls => {
    const tr = document.createElement("tr");
    tr.style.height = rowHeight;
    tr.style.minHeight = rowHeight;
    tr.style.maxHeight = rowHeight;
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
        td.setAttribute("data-day", day);
        td.style.cssText = `padding:0 1px;vertical-align:top;overflow:hidden;height:${rowHeight};min-height:${rowHeight};max-height:${rowHeight};position:relative`;
        attachDropHandlers(td, day, period, ctx, dragData => ({ ...dragData, sectionIdx: cls.sectionIdx, gradeKey: cls.gradeKey }));

        const slotEntries = ctx.entries.filter(e => e.day === day && e.period === period && entryMatchesClass(e, cls));
        if (slotEntries.length) {
          const cg = document.createElement("div");
          cg.className = "tt-cell-card-grid";
          cg.style.height = "100%";
          cg.style.setProperty("--tt-auto-cols", String(slotEntries.length || 1));
          slotEntries.forEach(entry => cg.appendChild(ctx.buildEntryCard(entry, { compact: true })));
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

function buildGrid(periods, days, wrap, getEntries, ctx, cardOpts = {}) {
  const table = document.createElement("table");
  table.className = "tt-table tt-grade-percent-table";
  table.style.cssText = "table-layout:fixed;width:100%;height:100%;min-width:0;border-collapse:separate;border-spacing:0";

  const rowHeaderWidth = 28;
  const rowHeight = `calc((100% - var(--tt-grade-header-height, 24px)) / ${Math.max(1, periods.length)})`;
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
  tbody.style.height = "calc(100% - var(--tt-grade-header-height, 24px))";
  periods.forEach((label, period) => {
    const tr = document.createElement("tr");
    tr.style.height = rowHeight;
    tr.style.minHeight = rowHeight;
    tr.style.maxHeight = rowHeight;
    const periodCell = makePeriodLabelCell(label, period, ctx.updatePeriodLabel);
    periodCell.style.cssText += `;width:${rowHeaderWidth}px;min-width:${rowHeaderWidth}px;max-width:${rowHeaderWidth}px;height:${rowHeight};min-height:${rowHeight};max-height:${rowHeight}`;
    tr.appendChild(periodCell);

    days.forEach((_, day) => {
      const td = document.createElement("td");
      td.className = "tt-cell tt-grade-percent-cell";
      td.setAttribute("data-day", day);
      td.style.cssText = `padding:0 1px;vertical-align:top;overflow:hidden;height:${rowHeight};min-height:${rowHeight};max-height:${rowHeight};min-width:0;position:relative`;
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
