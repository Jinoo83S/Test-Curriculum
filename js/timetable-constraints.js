// ================================================================
// timetable-constraints.js · Teacher constraints + homeroom UI
// ================================================================
import { normalizeTimetableConstraint } from "./state.js";

export function createTimetableConstraintsHandlers({
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
  renderAll,
  getConstraintMap,
  entryTitle = null,
  getEntryClassSummary = null,
  getRoomDisplayName = null,
  getTtCards = null,
  getTeachersForTtCard = null,
  getCreditsForTtCard = null,
  getTtCardClassLabels = null,
  describeTtCard = null,
  showSidebarCardDetail = null,
  showEntryDetail = null,
  $,
}) {
  function ensureConstraint(teacher) {
    if (!constraints()[teacher]) constraints()[teacher] = normalizeTimetableConstraint({});
    return constraints()[teacher];
  }

  function getAllTimetableTeachers() {
    const fromCards = [...new Set(
      (appState.timetable?.ttcards || []).flatMap(c => [
        ...(Array.isArray(c.teachers) ? c.teachers : []),
        ...splitTeacherNames(c.teacherName)
      ]).filter(Boolean)
    )];
    const fromEntries = [...new Set(entries().flatMap(e => splitTeacherNames(e.teacherName)).filter(Boolean))];
    const fromRooms = [...new Set(getRooms().map(r => clean(r.teacherName)).filter(Boolean))];
    return [...new Set([...fromCards, ...fromEntries, ...fromRooms])].sort((a, b) => a.localeCompare(b, "ko"));
  }

  function getEffectiveAssignedRoomId(teacher) {
    const c = constraints()[teacher];
    if (!c) return null;

    // 기본 교실 규칙은 "교사 담당교실, 없으면 홈룸"입니다.
    // 기존 데이터에 useHomeRoom=true가 남아 있어도 assignedRoomId가 있으면 담당교실을 우선합니다.
    return c.assignedRoomId || c.homeRoomId || null;
  }

  function setRoomTeacherOwner(roomId, teacherName) {
    if (!roomId) return;
    const rooms = getRooms();
    rooms.forEach(room => {
      if (room.id === roomId) room.teacherName = teacherName || "";
      else if (teacherName && room.teacherName === teacherName) room.teacherName = "";
    });
    scheduleSave("rooms");
  }

  function syncTeacherHomeRoomFromRoom(roomId, teacherName) {
    if (!roomId) return;
    Object.entries(constraints()).forEach(([name, c]) => {
      if (name !== teacherName && c?.homeRoomId === roomId) {
        c.homeRoomId = null;
        if (c.useHomeRoom) c.assignedRoomId = null;
        c.useHomeRoom = false;
      }
    });
    if (teacherName) {
      const c = ensureConstraint(teacherName);
      c.homeRoomId = roomId;
      c.useHomeRoom = true;
      c.assignedRoomId = roomId;
    }
    scheduleSave("timetable");
  }

  function applyRoomToTeacherEntries(teacher, roomId) {
    entries().forEach(en => {
      if (splitTeacherNames(en.teacherName).includes(teacher)) en.roomId = roomId || null;
    });
  }

  function updateConstraint(teacher, field, value, { rerender = true } = {}) {
    if (!canEdit()) return;
    const c = ensureConstraint(teacher);
    captureTimetableUndo("교사 제약 수정");
    c[field] = value;
    scheduleSave("timetable");
    if (rerender) {
      recomputeConflicts();
      requestAnimationFrame(() => renderAll());
    }
  }

  function toggleUnavailable(teacher, day, period) {
    if (!canEdit()) return;
    const c = ensureConstraint(teacher);
    captureTimetableUndo("수업 불가 시간 수정");
    const slots = c.unavailableSlots || (c.unavailableSlots = []);
    const idx = slots.findIndex(s => s.day === day && s.period === period);
    if (idx >= 0) slots.splice(idx, 1); else slots.push({ day, period });
    scheduleSave("timetable");
    recomputeConflicts();
    requestAnimationFrame(() => renderAll());
  }

  function syncTeacherRoomAssignmentsFromRooms(teachers = [], rooms = []) {
    const teacherSet = new Set((teachers || []).map(clean).filter(Boolean));
    let changed = 0;
    (rooms || []).forEach(room => {
      const rawTeacher = clean(room.teacherName);
      const noteTeacher = clean(room.note);
      let owner = teacherSet.has(rawTeacher) ? rawTeacher : "";
      // 이전 붙여넣기 데이터에서 teacherName에 7A/8B 같은 홈룸값이 들어가고
      // 실제 교사명이 note에 남아 있는 경우가 있어 note도 보조로 확인합니다.
      if (!owner && teacherSet.has(noteTeacher)) owner = noteTeacher;
      if (!owner) return;
      const c = ensureConstraint(owner);
      const needs = c.homeRoomId !== room.id || c.assignedRoomId !== room.id || !c.useHomeRoom;
      if (needs) {
        c.homeRoomId = room.id;
        c.assignedRoomId = room.id;
        c.useHomeRoom = true;
        if (room.teacherName !== owner) room.teacherName = owner;
        changed += 1;
      }
    });
    return changed;
  }


  function ensureCompactConstraintStyles() {
    if (typeof document === "undefined" || document.getElementById("ttCompactConstraintStyle")) return;
    const style = document.createElement("style");
    style.id = "ttCompactConstraintStyle";
    style.textContent = `
      #ttConstraintsContent{font-size:11px!important;line-height:1.25!important;}
      #ttConstraintsContent .tt-con-hint{margin:2px 6px 5px!important;padding:4px 6px!important;font-size:10.5px!important;line-height:1.2!important;}
      #ttConstraintsContent .tt-con-bulk-box,#ttConstraintsContent .his-bulk-editor{margin:4px 6px 6px!important;padding:6px 8px!important;border-radius:10px!important;box-shadow:0 1px 3px rgba(15,23,42,.04)!important;}
      #ttConstraintsContent .his-bulk-editor-main{gap:6px!important;align-items:center!important;}
      #ttConstraintsContent .his-bulk-editor-title{min-width:130px!important;gap:0!important;margin-right:2px!important;}
      #ttConstraintsContent .his-bulk-editor-title strong{font-size:11.5px!important;line-height:1.15!important;}
      #ttConstraintsContent .his-bulk-editor-title span{font-size:9.5px!important;line-height:1.15!important;}
      #ttConstraintsContent .his-bulk-quick-fields{gap:5px!important;}
      #ttConstraintsContent .his-mini-field{height:24px!important;padding:0 6px!important;gap:4px!important;border-radius:8px!important;font-size:10px!important;}
      #ttConstraintsContent .his-mini-field input{width:40px!important;height:19px!important;padding:1px 4px!important;font-size:10px!important;}
      #ttConstraintsContent .his-bulk-editor-actions{gap:4px!important;}
      #ttConstraintsContent .his-bulk-editor-actions .his-ui-btn,#ttConstraintsContent .his-bulk-time-actions .his-ui-btn{height:23px!important;min-height:0!important;padding:0 7px!important;border-radius:7px!important;font-size:10px!important;line-height:1!important;}
      #ttConstraintsContent .his-bulk-time-details{margin-top:5px!important;border-radius:9px!important;}
      #ttConstraintsContent .his-bulk-time-details>summary{padding:6px 8px!important;gap:5px!important;font-size:10.5px!important;}
      #ttConstraintsContent .his-bulk-time-details>summary em{font-size:9.5px!important;}
      #ttConstraintsContent .his-bulk-time-wrap{padding:0 8px 8px!important;}
      #ttConstraintsContent .his-bulk-time-grid{grid-template-columns:32px repeat(5,28px)!important;gap:3px!important;max-width:none!important;margin-top:4px!important;}
      #ttConstraintsContent .his-bulk-time-head,#ttConstraintsContent .his-bulk-time-period,#ttConstraintsContent .his-bulk-time-corner{height:21px!important;border-radius:6px!important;font-size:9.5px!important;}
      #ttConstraintsContent .his-bulk-time-cell{height:21px!important;border-radius:6px!important;font-size:10px!important;}
      #ttConstraintsContent .his-bulk-time-actions{gap:4px!important;margin-top:6px!important;}
      #ttConstraintsContent .his-bulk-selected-label{height:22px!important;padding:0 6px!important;font-size:9.5px!important;}
      #ttConstraintsContent .tt-con-teacher-list{grid-template-rows:repeat(3,minmax(26px,auto))!important;grid-auto-columns:minmax(190px,225px)!important;gap:5px!important;padding:4px 6px 8px!important;}
      #ttConstraintsContent .tt-con-teacher-block{border-radius:9px!important;box-shadow:none!important;}
      #ttConstraintsContent .tt-con-teacher-hdr{min-height:25px!important;padding:4px 7px!important;gap:5px!important;}
      #ttConstraintsContent .tt-con-name{font-size:10.5px!important;}
      #ttConstraintsContent .tt-con-stat{font-size:9px!important;}
      #ttConstraintsContent .tt-con-tog{font-size:10px!important;padding:0!important;}
      #ttConstraintsContent .tt-con-body{padding:6px 7px 7px!important;}
      #ttConstraintsContent .tt-con-num-row{gap:5px!important;margin:0!important;}
      #ttConstraintsContent .tt-con-num-wrap{font-size:10px!important;}
      #ttConstraintsContent .tt-con-num-wrap input{height:20px!important;width:38px!important;font-size:10px!important;padding:1px 4px!important;}
      #ttConstraintsContent .tt-con-room-row{gap:4px!important;margin-top:4px!important;}
      #ttConstraintsContent .tt-con-room-row label{font-size:10px!important;}
      #ttConstraintsContent .tt-con-room-row select{height:22px!important;max-width:150px!important;font-size:10px!important;padding:2px 5px!important;}
      #ttConstraintsContent .tt-con-room-row .secondary-btn,#ttConstraintsContent .tt-con-room-row .compact-btn{height:22px!important;min-height:0!important;padding:0 6px!important;font-size:9.5px!important;border-radius:6px!important;}
      #ttConstraintsContent .tt-con-grid{min-width:170px!important;}
      #ttConstraintsContent .tt-con-grid-row{grid-template-columns:22px repeat(5,1fr)!important;gap:2px!important;}
      #ttConstraintsContent .tt-con-grid-day,#ttConstraintsContent .tt-con-grid-per,#ttConstraintsContent .tt-con-grid-corner,#ttConstraintsContent .tt-con-grid-cell{height:20px!important;min-height:20px!important;font-size:9px!important;border-radius:5px!important;}
      @media (max-width:760px){#ttConstraintsContent .tt-con-teacher-list{grid-template-rows:repeat(2,minmax(26px,auto))!important;grid-auto-columns:minmax(180px,210px)!important;}}
    `;
    document.head.appendChild(style);
  }

  function getBulkConstraintDefaults(teachers = []) {
    const saved = ttConfig().teacherBulkDefaults || {};
    const toPositiveInt = (value, fallback) => {
      const n = parseInt(value, 10);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    const commonValue = (field, fallback) => {
      const values = (teachers || [])
        .map(t => constraints()[t]?.[field])
        .map(v => parseInt(v, 10))
        .filter(v => Number.isFinite(v) && v > 0);
      if (!values.length) return fallback;
      const counts = new Map();
      values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    };
    return {
      maxPerDay: toPositiveInt(saved.maxPerDay, commonValue("maxPerDay", 6)),
      maxConsecutive: toPositiveInt(saved.maxConsecutive, commonValue("maxConsecutive", 3)),
    };
  }

  function renderConstraintBulkTools(container, teachers, rooms, dayLabels, periods) {
    ensureCompactConstraintStyles();
    const bulkDefaults = getBulkConstraintDefaults(teachers);
    const box = document.createElement("div");
    box.className = "tt-con-bulk-box his-bulk-editor";

    const main = document.createElement("div");
    main.className = "his-bulk-editor-main";

    const title = document.createElement("div");
    title.className = "his-bulk-editor-title";
    title.innerHTML = `<strong>전체 일괄 편집</strong><span>교사 ${teachers.length}명 · 교실 ${rooms.length}개</span>`;
    main.appendChild(title);

    const quickFields = document.createElement("div");
    quickFields.className = "his-bulk-quick-fields";

    const maxDayLabel = document.createElement("label");
    maxDayLabel.className = "his-mini-field";
    maxDayLabel.innerHTML = `<span>하루 최대</span>`;
    const maxDay = document.createElement("input");
    maxDay.type = "number";
    maxDay.min = "1";
    maxDay.max = "12";
    maxDay.value = String(bulkDefaults.maxPerDay);
    maxDayLabel.appendChild(maxDay);

    const maxConLabel = document.createElement("label");
    maxConLabel.className = "his-mini-field";
    maxConLabel.innerHTML = `<span>연속</span>`;
    const maxCon = document.createElement("input");
    maxCon.type = "number";
    maxCon.min = "1";
    maxCon.max = "12";
    maxCon.value = String(bulkDefaults.maxConsecutive);
    maxConLabel.appendChild(maxCon);

    quickFields.append(maxDayLabel, maxConLabel);
    main.appendChild(quickFields);

    const actions = document.createElement("div");
    actions.className = "his-bulk-editor-actions";

    const applyNums = makeBtn("전체 적용", "his-ui-btn his-ui-btn-primary his-ui-btn-compact", () => {
      if (!canEdit()) return;
      captureTimetableUndo("교사 조건 전체 일괄 수정");
      const md = parseInt(maxDay.value) || bulkDefaults.maxPerDay || 6;
      const mc = parseInt(maxCon.value) || bulkDefaults.maxConsecutive || 3;
      teachers.forEach(t => {
        const c = ensureConstraint(t);
        c.maxPerDay = md;
        c.maxConsecutive = mc;
      });
      ttConfig().teacherBulkDefaults = { maxPerDay: md, maxConsecutive: mc };
      scheduleSave("timetable");
      recomputeConflicts();
      renderAll();
    });
    applyNums.disabled = !canEdit();

    const expandBtn = makeBtn("전체 펼치기", "his-ui-btn his-ui-btn-secondary his-ui-btn-compact", () => {
      teachers.forEach(t => { ensureConstraint(t)._expanded = true; });
      renderConstraintsPanel();
    });

    const collapseBtn = makeBtn("전체 접기", "his-ui-btn his-ui-btn-secondary his-ui-btn-compact", () => {
      teachers.forEach(t => { ensureConstraint(t)._expanded = false; });
      renderConstraintsPanel();
    });

    const syncRoomsBtn = makeBtn("교실 데이터 반영", "his-ui-btn his-ui-btn-ghost his-ui-btn-compact", () => {
      if (!canEdit()) return;
      if (!rooms.length) {
        alert("등록된 교실 데이터가 없습니다. 먼저 교실 관리에서 교실과 담당 교사를 입력해 주세요.");
        return;
      }
      captureTimetableUndo("교사 조건에 교실 담당 데이터 반영");
      const changed = syncTeacherRoomAssignmentsFromRooms(teachers, rooms);
      if (changed) {
        scheduleSave("timetable");
        scheduleSave("rooms");
        recomputeConflicts();
        renderAll();
      }
      alert(changed ? `${changed}개 교실 담당 정보를 교사 조건에 반영했습니다.` : "새로 반영할 교실 담당 정보가 없습니다.");
    });
    syncRoomsBtn.disabled = !canEdit() || !rooms.length;
    syncRoomsBtn.title = "명단/교실 관리의 담당 교사 정보를 교사별 본인 교실로 반영합니다.";

    actions.append(applyNums, expandBtn, collapseBtn, syncRoomsBtn);
    main.appendChild(actions);
    box.appendChild(main);

    const details = document.createElement("details");
    details.className = "his-bulk-time-details";

    const summary = document.createElement("summary");
    summary.innerHTML = `<span>선택 시간 일괄 불가/가능</span><em>시간표에서 여러 칸을 선택한 뒤 전체 교사에게 적용</em>`;
    details.appendChild(summary);

    const selected = new Set();
    const keyOf = (d, p) => `${d}:${p}`;
    const parseKey = key => {
      const [day, period] = String(key).split(":").map(v => parseInt(v, 10));
      return { day, period };
    };

    const gridWrap = document.createElement("div");
    gridWrap.className = "his-bulk-time-wrap";

    const grid = document.createElement("div");
    grid.className = "his-bulk-time-grid";

    const selectedLabel = document.createElement("span");
    selectedLabel.className = "his-bulk-selected-label";

    const refreshSelectionLabel = () => {
      selectedLabel.textContent = selected.size ? `선택 ${selected.size}칸` : "선택 없음";
    };

    const renderBulkGrid = () => {
      grid.innerHTML = "";
      const corner = document.createElement("div");
      corner.className = "his-bulk-time-corner";
      grid.appendChild(corner);

      dayLabels.forEach(d => {
        const th = document.createElement("div");
        th.className = "his-bulk-time-head";
        th.textContent = d;
        grid.appendChild(th);
      });

      periods.forEach((label, pIdx) => {
        const periodCell = document.createElement("div");
        periodCell.className = "his-bulk-time-period";
        periodCell.textContent = `${pIdx + 1}`;
        grid.appendChild(periodCell);

        dayLabels.forEach((dayLabel, dIdx) => {
          const btn = document.createElement("button");
          btn.type = "button";
          const key = keyOf(dIdx, pIdx);
          const isSelected = selected.has(key);
          btn.className = "his-bulk-time-cell" + (isSelected ? " is-selected" : "");
          btn.title = `${dayLabel} ${label || `${pIdx + 1}교시`}`;
          btn.textContent = isSelected ? "✓" : "";
          btn.disabled = !canEdit();
          btn.addEventListener("click", () => {
            if (selected.has(key)) selected.delete(key);
            else selected.add(key);
            renderBulkGrid();
            refreshSelectionLabel();
          });
          grid.appendChild(btn);
        });
      });
    };

    const selectAllBtn = makeBtn("전체 선택", "his-ui-btn his-ui-btn-secondary his-ui-btn-compact", () => {
      if (!canEdit()) return;
      selected.clear();
      dayLabels.forEach((_, dIdx) => periods.forEach((__, pIdx) => selected.add(keyOf(dIdx, pIdx))));
      renderBulkGrid();
      refreshSelectionLabel();
    });

    const clearSelectBtn = makeBtn("선택 해제", "his-ui-btn his-ui-btn-ghost his-ui-btn-compact", () => {
      selected.clear();
      renderBulkGrid();
      refreshSelectionLabel();
    });

    const applyAvailability = unavailable => {
      if (!canEdit()) return;
      if (!selected.size) {
        alert("먼저 시간표에서 적용할 칸을 선택해 주세요.");
        return;
      }
      captureTimetableUndo(unavailable ? "전체 수업 불가 시간 추가" : "전체 수업 불가 시간 해제");
      const slotsToApply = [...selected].map(parseKey);
      teachers.forEach(t => {
        const c = ensureConstraint(t);
        const slots = Array.isArray(c.unavailableSlots) ? c.unavailableSlots : [];
        if (unavailable) {
          slotsToApply.forEach(slot => {
            if (!slots.some(s => s.day === slot.day && s.period === slot.period)) {
              slots.push({ day: slot.day, period: slot.period });
            }
          });
          c.unavailableSlots = slots;
        } else {
          c.unavailableSlots = slots.filter(s => !slotsToApply.some(slot => slot.day === s.day && slot.period === s.period));
        }
      });
      scheduleSave("timetable");
      recomputeConflicts();
      renderAll();
    };

    const setUnav = makeBtn("선택 시간 불가", "his-ui-btn his-ui-btn-danger his-ui-btn-compact", () => applyAvailability(true));
    const clearUnav = makeBtn("선택 시간 가능", "his-ui-btn his-ui-btn-secondary his-ui-btn-compact", () => applyAvailability(false));
    [selectAllBtn, clearSelectBtn, setUnav, clearUnav].forEach(btn => { btn.disabled = !canEdit(); });

    const timeActions = document.createElement("div");
    timeActions.className = "his-bulk-time-actions";
    timeActions.append(selectedLabel, selectAllBtn, clearSelectBtn, setUnav, clearUnav);

    refreshSelectionLabel();
    renderBulkGrid();
    gridWrap.append(grid, timeActions);
    details.appendChild(gridWrap);
    box.appendChild(details);

    container.appendChild(box);
  }



  const constraintModalState = {
    isOpen: false,
    teacher: null,
    room: null,
    search: "",
    filter: "all",
    bulkSelected: new Set(),
  };

  function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function ensureTeacherConstraintModalStyles() {
    if (typeof document === "undefined" || document.getElementById("ttTeacherConstraintModalStyle")) return;
    const style = document.createElement("style");
    style.id = "ttTeacherConstraintModalStyle";
    style.textContent = `
      .tt-con-launch-card{margin:10px 14px;padding:14px 16px;border:1px solid #dbe4f0;border-radius:14px;background:linear-gradient(180deg,#fff,#f8fbff);display:flex;align-items:center;justify-content:space-between;gap:16px;box-shadow:0 8px 22px rgba(15,23,42,.06)}
      .tt-con-launch-card h3{margin:0 0 4px;font-size:14px;font-weight:900;color:#0f172a}.tt-con-launch-card p{margin:0;font-size:12px;color:#64748b}.tt-con-launch-stats{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.tt-con-launch-chip{font-size:11px;font-weight:800;border:1px solid #dbe4f0;border-radius:999px;padding:4px 8px;background:#fff;color:#334155}.tt-con-open-btn{height:32px;padding:0 14px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:900;font-size:12px;cursor:pointer;white-space:nowrap}.tt-con-open-btn:disabled{opacity:.45;cursor:not-allowed}
      .ttc-modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.35);z-index:2600;display:flex;align-items:center;justify-content:center;padding:24px}.ttc-modal{width:min(1540px,96vw);height:min(880px,90vh);background:#fff;border:1px solid #dbe4f0;border-radius:18px;box-shadow:0 26px 70px rgba(15,23,42,.28);display:flex;flex-direction:column;overflow:hidden}.ttc-modal-head{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid #e2e8f0;background:#f8fbff}.ttc-modal-title{font-size:16px;font-weight:950;color:#0f172a}.ttc-modal-sub{font-size:11px;color:#64748b;margin-left:8px;font-weight:700}.ttc-close{width:30px;height:30px;border:0;border-radius:9px;background:#eef2f7;color:#64748b;font-size:18px;font-weight:900;cursor:pointer}.ttc-body{flex:1;min-height:0;display:grid;grid-template-columns:260px minmax(520px,1fr) 370px;gap:0}.ttc-left,.ttc-center,.ttc-right{min-height:0;overflow:auto}.ttc-left{border-right:1px solid #e2e8f0;background:#f8fafc;padding:12px}.ttc-center{padding:14px 16px;background:#fff}.ttc-right{border-left:1px solid #e2e8f0;background:#fbfdff;padding:14px}.ttc-search{width:100%;height:32px;border:1px solid #cbd5e1;border-radius:9px;padding:0 10px;font-size:12px;font-weight:700;background:#fff}.ttc-filter-row{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0 10px}.ttc-filter{height:24px;border:1px solid #dbe4f0;border-radius:999px;background:#fff;color:#475569;font-size:10.5px;font-weight:900;padding:0 8px;cursor:pointer}.ttc-filter.active{background:#2563eb;color:#fff;border-color:#2563eb}.ttc-teacher-list{display:flex;flex-direction:column;gap:5px}.ttc-teacher-item{border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:8px 9px;text-align:left;cursor:pointer}.ttc-teacher-item.active{border-color:#2563eb;background:#eff6ff}.ttc-teacher-name{font-size:12px;font-weight:950;color:#0f172a}.ttc-teacher-meta{margin-top:3px;font-size:10.5px;color:#64748b;display:flex;gap:6px;align-items:center}.ttc-warn{color:#b45309;font-weight:900}.ttc-ok{color:#15803d;font-weight:900}.ttc-section-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.ttc-section-title h4{margin:0;font-size:14px;font-weight:950;color:#0f172a}.ttc-section-title span{font-size:11px;color:#64748b;font-weight:800}.ttc-time-grid{display:grid;grid-template-columns:46px repeat(5,1fr);gap:6px}.ttc-time-cell,.ttc-time-head,.ttc-time-period{height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900}.ttc-time-head{background:#173b68;color:#fff}.ttc-time-period{background:#f1f5f9;color:#475569}.ttc-time-cell{border:1px solid #dbe4f0;background:#f8fafc;color:#94a3b8;cursor:pointer}.ttc-time-cell:hover{border-color:#60a5fa;background:#eff6ff}.ttc-time-cell.unavailable{border-color:#ef4444;background:#fee2e2;color:#b91c1c}.ttc-time-cell.busy{box-shadow:inset 0 -3px 0 #93c5fd}.ttc-legend{display:flex;gap:10px;align-items:center;margin-top:10px;font-size:11px;font-weight:800;color:#64748b}.ttc-legend i{display:inline-block;width:12px;height:12px;border-radius:4px;margin-right:4px;vertical-align:-2px}.ttc-form-card{border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:12px;margin-bottom:12px}.ttc-card-list{display:flex;flex-direction:column;gap:7px;max-height:310px;overflow:auto;padding-right:3px}.ttc-assigned-card{border:1px solid #e2e8f0;border-radius:11px;background:#f8fafc;padding:8px 9px}.ttc-assigned-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.ttc-assigned-title{font-size:12px;font-weight:950;color:#0f172a;line-height:1.25}.ttc-assigned-slot{font-size:10px;font-weight:950;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:999px;padding:2px 6px;white-space:nowrap}.ttc-assigned-meta{margin-top:4px;font-size:10.5px;font-weight:750;color:#64748b;line-height:1.35}.ttc-summary-strip{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}.ttc-summary-chip{border:1px solid #dbe4f0;border-radius:999px;background:#fff;padding:4px 8px;font-size:11px;font-weight:900;color:#334155}.ttc-form-card h4{margin:0 0 10px;font-size:13px;font-weight:950;color:#0f172a}.ttc-field{display:flex;flex-direction:column;gap:5px;margin-bottom:9px}.ttc-field label{font-size:11px;font-weight:900;color:#475569}.ttc-field input,.ttc-field select{height:32px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;padding:0 9px;font-size:12px;font-weight:750}.ttc-inline{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ttc-check{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:850;color:#334155;margin:4px 0 10px}.ttc-btn-row{display:flex;gap:6px;flex-wrap:wrap}.ttc-btn{height:30px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#334155;font-size:11.5px;font-weight:900;padding:0 10px;cursor:pointer}.ttc-btn.primary{background:#2563eb;color:#fff;border-color:#2563eb}.ttc-btn.ghost{background:#f8fafc}.ttc-btn.danger{background:#fee2e2;color:#b91c1c;border-color:#fecaca}.ttc-btn:disabled,.ttc-time-cell:disabled{opacity:.45;cursor:not-allowed}.ttc-footer{border-top:1px solid #e2e8f0;background:#f8fafc;padding:10px 14px;display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:start}.ttc-bulk-title{font-size:12px;font-weight:950;color:#0f172a;margin-bottom:5px}.ttc-bulk-grid{display:grid;grid-template-columns:28px repeat(5,28px);gap:3px}.ttc-bulk-grid div,.ttc-bulk-grid button{height:24px;border-radius:6px;font-size:10px;font-weight:900;display:flex;align-items:center;justify-content:center}.ttc-bulk-grid div{background:#e2e8f0;color:#475569}.ttc-bulk-grid button{border:1px solid #cbd5e1;background:#fff;color:#94a3b8;cursor:pointer}.ttc-bulk-grid button.selected{background:#2563eb;color:#fff;border-color:#2563eb}.ttc-bulk-controls{display:flex;gap:8px;flex-wrap:wrap;align-items:end}.ttc-mini-field{display:flex;flex-direction:column;gap:4px}.ttc-mini-field span{font-size:10px;font-weight:900;color:#64748b}.ttc-mini-field input{width:58px;height:28px;border:1px solid #cbd5e1;border-radius:8px;padding:0 7px;font-size:12px;font-weight:850}.ttc-empty{font-size:12px;color:#94a3b8;text-align:center;padding:28px 0}.ttc-assist{font-size:11px;color:#64748b;line-height:1.5;margin-top:6px}
      .ttc-room-unavailable-card{background:#fffdf7;border-color:#fde68a}.ttc-room-unavailable-card .ttc-time-grid{grid-template-columns:38px repeat(5,1fr);gap:4px}.ttc-room-unavailable-card .ttc-time-cell,.ttc-room-unavailable-card .ttc-time-head,.ttc-room-unavailable-card .ttc-time-period{height:32px;font-size:10.5px}.ttc-room-time-title{margin-top:6px;margin-bottom:8px}.ttc-room-time-title h4{font-size:12px}
      @media (max-width:1100px){.ttc-body{grid-template-columns:210px 1fr}.ttc-right{grid-column:1 / -1;border-left:0;border-top:1px solid #e2e8f0}.ttc-modal{height:90vh}.ttc-footer{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function getTeacherStats(teacher) {
    const placed = entries().filter(e => splitTeacherNames(e.teacherName).includes(teacher)).length;
    const roomId = getEffectiveAssignedRoomId(teacher);
    const constraintMap = getConstraintMap();
    const hasViolation = [...constraintMap.entries()].some(([id, s]) => {
      const e = entries().find(x => x.id === id);
      return e && splitTeacherNames(e.teacherName).includes(teacher) && s.size > 0;
    });
    return { placed, roomId, hasViolation };
  }

  function getFilteredConstraintTeachers(allTeachers) {
    const q = clean(constraintModalState.search).toLowerCase();
    return allTeachers.filter(t => {
      if (q && !t.toLowerCase().includes(q)) return false;
      const stat = getTeacherStats(t);
      if (constraintModalState.filter === "noRoom") return !stat.roomId;
      if (constraintModalState.filter === "violation") return stat.hasViolation;
      return true;
    });
  }

  function getTeacherBusySlots(teacher) {
    const set = new Set();
    entries().forEach(e => {
      if (splitTeacherNames(e.teacherName).includes(teacher)) set.add(`${e.day}:${e.period}`);
    });
    return set;
  }

  function commitConstraintChange({ page = false, modal = true } = {}) {
    scheduleSave("timetable");
    recomputeConflicts();
    if (page) renderAll();
    if (modal) requestAnimationFrame(renderTeacherConstraintsModalContent);
  }

  function makeRoomSelect(value, rooms) {
    const sel = document.createElement("select");
    const noR = document.createElement("option");
    noR.value = "";
    noR.textContent = "없음";
    sel.appendChild(noR);
    rooms.forEach(r => {
      const o = document.createElement("option");
      o.value = r.id;
      const owner = clean(r.teacherName || r.note);
      o.textContent = owner ? `${r.name} (${owner})` : r.name;
      if (r.id === value) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }

  function renderTeacherList(container, allTeachers) {
    container.innerHTML = "";

    const search = document.createElement("input");
    search.className = "ttc-search";
    search.placeholder = "교사 검색";
    search.value = constraintModalState.search || "";
    container.appendChild(search);

    const filterRow = document.createElement("div");
    filterRow.className = "ttc-filter-row";
    container.appendChild(filterRow);

    const list = document.createElement("div");
    list.className = "ttc-teacher-list";
    container.appendChild(list);

    const renderFilterButtons = () => {
      filterRow.innerHTML = "";
      [
        ["all", "전체"],
        ["noRoom", "교실 미지정"],
        ["violation", "충돌"],
      ].forEach(([key, label]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ttc-filter" + (constraintModalState.filter === key ? " active" : "");
        btn.textContent = label;
        btn.addEventListener("click", () => {
          constraintModalState.filter = key;
          renderFilterButtons();
          renderTeacherItems();
        });
        filterRow.appendChild(btn);
      });
    };

    const renderTeacherItems = () => {
      list.innerHTML = "";
      const teachers = getFilteredConstraintTeachers(allTeachers);
      teachers.forEach(teacher => {
        const stat = getTeacherStats(teacher);
        const room = getRooms().find(r => r.id === stat.roomId);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ttc-teacher-item" + (constraintModalState.teacher === teacher ? " active" : "");
        btn.innerHTML = `
          <div class="ttc-teacher-name">${escapeText(teacher)}</div>
          <div class="ttc-teacher-meta">
            <span>${stat.placed ? `${stat.placed}시수` : "배정 없음"}</span>
            <span>${room ? escapeText(room.name) : "교실 없음"}</span>
            <span class="${stat.hasViolation ? "ttc-warn" : "ttc-ok"}">${stat.hasViolation ? "충돌" : "정상"}</span>
          </div>`;
        btn.addEventListener("click", () => {
          constraintModalState.teacher = teacher;
          renderTeacherConstraintsModalContent();
        });
        list.appendChild(btn);
      });

      if (!teachers.length) {
        const empty = document.createElement("div");
        empty.className = "ttc-empty";
        empty.textContent = "조건에 맞는 교사가 없습니다.";
        list.appendChild(empty);
      }
    };

    search.addEventListener("input", e => {
      // 검색어 입력 때 전체 팝업을 다시 그리면 input이 매 글자마다 focus를 잃고
      // 한글 IME 조합도 끊깁니다. 왼쪽 교사 목록만 갱신합니다.
      constraintModalState.search = e.target.value || "";
      renderTeacherItems();
      requestAnimationFrame(() => {
        if (document.activeElement !== search && search.isConnected) {
          search.focus({ preventScroll: true });
          const pos = search.value.length;
          try { search.setSelectionRange(pos, pos); } catch {}
        }
      });
    });

    renderFilterButtons();
    renderTeacherItems();
  }

  function renderTeacherTimeGrid(container, teacher, dayLabels, periods) {
    const c = ensureConstraint(teacher);
    const busySlots = getTeacherBusySlots(teacher);
    const unavailable = new Set((c.unavailableSlots || []).map(s => `${s.day}:${s.period}`));

    const title = document.createElement("div");
    title.className = "ttc-section-title";
    title.innerHTML = `<h4>${escapeText(teacher)} 수업 가능 시간</h4><span>클릭하여 가능/불가 전환</span>`;
    container.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "ttc-time-grid";
    const corner = document.createElement("div");
    corner.className = "ttc-time-period";
    corner.textContent = "교시";
    grid.appendChild(corner);
    dayLabels.forEach(d => {
      const h = document.createElement("div");
      h.className = "ttc-time-head";
      h.textContent = d;
      grid.appendChild(h);
    });

    periods.forEach((label, pIdx) => {
      const p = document.createElement("div");
      p.className = "ttc-time-period";
      p.textContent = `${pIdx + 1}`;
      grid.appendChild(p);
      dayLabels.forEach((_, dIdx) => {
        const key = `${dIdx}:${pIdx}`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ttc-time-cell" + (unavailable.has(key) ? " unavailable" : "") + (busySlots.has(key) ? " busy" : "");
        btn.textContent = unavailable.has(key) ? "불가" : (busySlots.has(key) ? "수업" : "가능");
        btn.disabled = !canEdit();
        btn.addEventListener("click", () => {
          if (!canEdit()) return;
          captureTimetableUndo("교사 수업 가능 시간 수정");
          const slots = c.unavailableSlots || (c.unavailableSlots = []);
          const idx = slots.findIndex(s => s.day === dIdx && s.period === pIdx);
          if (idx >= 0) slots.splice(idx, 1);
          else slots.push({ day: dIdx, period: pIdx });
          commitConstraintChange({ page: false, modal: true });
        });
        grid.appendChild(btn);
      });
    });
    container.appendChild(grid);

    const legend = document.createElement("div");
    legend.className = "ttc-legend";
    legend.innerHTML = `<span><i style="background:#f8fafc;border:1px solid #cbd5e1"></i>가능</span><span><i style="background:#fee2e2;border:1px solid #ef4444"></i>불가</span><span><i style="background:#dbeafe"></i>수업 배정 있음</span>`;
    container.appendChild(legend);
  }

  function formatAssignedEntryTitle(entry) {
    if (typeof entryTitle === "function") return entryTitle(entry);
    return clean(entry?.title || entry?.subject || entry?.cardTitle || entry?.groupName || "수업");
  }

  function formatAssignedEntryClass(entry) {
    if (typeof getEntryClassSummary === "function") return getEntryClassSummary(entry);
    return clean(entry?.classSummary || entry?.className || entry?.classLabel || entry?.grade || "");
  }

  function formatAssignedEntryRoom(entry) {
    if (typeof getRoomDisplayName === "function") return getRoomDisplayName(entry?.roomId);
    if (!entry?.roomId) return "교실 없음";
    return getRooms().find(r => r.id === entry.roomId)?.name || entry.roomId;
  }

  function getTeacherAssignedEntries(teacher) {
    return entries()
      .filter(e => splitTeacherNames(e.teacherName).includes(teacher))
      .slice()
      .sort((a, b) => (Number(a.day) - Number(b.day)) || (Number(a.period) - Number(b.period)) || formatAssignedEntryTitle(a).localeCompare(formatAssignedEntryTitle(b), "ko"));
  }

  function getAllTeacherTtCards(teacher) {
    const cards = typeof getTtCards === "function" ? getTtCards() : (appState.timetable?.ttcards || []);
    return cards
      .filter(card => getCardTeacherNames(card).includes(teacher))
      .slice()
      .sort((a, b) => {
        const ga = String(a.gradeKey || "").localeCompare(String(b.gradeKey || ""), "ko", { numeric: true });
        if (ga) return ga;
        return formatTtCardTitle(a).localeCompare(formatTtCardTitle(b), "ko", { numeric: true, sensitivity: "base" });
      });
  }

  function getCardTeacherNames(card) {
    if (typeof getTeachersForTtCard === "function") return (getTeachersForTtCard(card) || []).map(clean).filter(Boolean);
    return [...new Set([...(Array.isArray(card?.teachers) ? card.teachers : []), ...splitTeacherNames(card?.teacherName || "")].map(clean).filter(Boolean))];
  }

  function getPlacementCardIds(entry = {}) {
    return [...new Set([
      ...(Array.isArray(entry.ttcardIds) ? entry.ttcardIds : []),
      entry.ttcardId,
      entry.cardId,
    ].map(clean).filter(Boolean))];
  }

  function getAssignedEntriesForTtCard(card) {
    if (!card?.id) return [];
    return entries()
      .filter(e => getPlacementCardIds(e).includes(card.id))
      .slice()
      .sort((a, b) => (Number(a.day) - Number(b.day)) || (Number(a.period) - Number(b.period)) || formatAssignedEntryTitle(a).localeCompare(formatAssignedEntryTitle(b), "ko"));
  }

  function formatTtCardTitle(card) {
    if (typeof describeTtCard === "function") return describeTtCard(card)?.title || card?.subject || card?.label || "시간표 카드";
    return clean(card?.subject || card?.label || card?.name || "시간표 카드");
  }

  function formatTtCardClasses(card) {
    if (typeof getTtCardClassLabels === "function") {
      const labels = getTtCardClassLabels(card) || [];
      if (labels.length) return labels.join(", ");
    }
    return Array.isArray(card?.classLabels) && card.classLabels.length ? card.classLabels.join(", ") : clean(card?.gradeKey || "");
  }

  function getTtCardCredits(card) {
    if (typeof getCreditsForTtCard === "function") return Number(getCreditsForTtCard(card)) || 0;
    return Number(card?.credits) || 0;
  }

  function openTtCardDetail(card, placed = []) {
    if (typeof showSidebarCardDetail !== "function") return;
    const desc = typeof describeTtCard === "function" ? describeTtCard(card) : { title: formatTtCardTitle(card), card };
    showSidebarCardDetail({
      title: desc.title || formatTtCardTitle(card),
      teachers: getCardTeacherNames(card),
      gradeKeys: [card?.gradeKey].filter(Boolean),
      credits: getTtCardCredits(card),
      assigned: placed.length,
      isDone: getTtCardCredits(card) > 0 && placed.length >= getTtCardCredits(card),
      sectionIdx: card?.sectionIdx,
      groupName: card?.group || "",
      groupId: "",
      detailItems: [desc],
    });
  }

  function renderTeacherAssignedCards(container, teacher, dayLabels, periods) {
    const teacherCards = getAllTeacherTtCards(teacher);
    const teacherEntries = getTeacherAssignedEntries(teacher);
    const card = document.createElement("div");
    card.className = "ttc-form-card ttc-assigned-card-panel";
    card.innerHTML = `<h4>시간표 카드</h4>`;

    const placedByCard = new Map(teacherCards.map(c => [c.id, getAssignedEntriesForTtCard(c)]));
    const assignedCards = teacherCards.filter(c => (placedByCard.get(c.id) || []).length > 0);
    const unassignedCards = teacherCards.filter(c => !(placedByCard.get(c.id) || []).length);
    const slots = new Set(teacherEntries.map(e => `${Number(e.day)}:${Number(e.period)}`));
    const rooms = new Set(teacherEntries.map(e => e.roomId).filter(Boolean));

    const strip = document.createElement("div");
    strip.className = "ttc-summary-strip";
    [
      ["카드", `${teacherCards.length}개`],
      ["배정", `${assignedCards.length}개`],
      ["미배정", `${unassignedCards.length}개`],
      ["시간", `${slots.size}칸`],
      ["교실", rooms.size ? `${rooms.size}개` : "없음"],
    ].forEach(([label, value]) => {
      const chip = document.createElement("span");
      chip.className = "ttc-summary-chip";
      chip.textContent = `${label} ${value}`;
      strip.appendChild(chip);
    });
    card.appendChild(strip);

    const list = document.createElement("div");
    list.className = "ttc-card-list";
    if (!teacherCards.length) {
      const empty = document.createElement("div");
      empty.className = "ttc-empty";
      empty.style.padding = "12px 0";
      empty.textContent = "이 교사에게 연결된 시간표 카드가 없습니다.";
      list.appendChild(empty);
    } else {
      teacherCards.forEach(ttcard => {
        const placed = placedByCard.get(ttcard.id) || [];
        const item = document.createElement("div");
        item.className = "ttc-assigned-card" + (placed.length ? "" : " ttc-unassigned-card");
        item.tabIndex = 0;
        item.title = "클릭하면 시간표 카드 상세를 봅니다.";
        const credits = getTtCardCredits(ttcard);
        const slotsText = placed.length
          ? placed.slice(0, 3).map(entry => `${dayLabels[Number(entry.day)] || "-"} ${Number.isInteger(Number(entry.period)) ? `${Number(entry.period) + 1}교시` : "-"}`).join(", ") + (placed.length > 3 ? ` 외 ${placed.length - 3}` : "")
          : "미배정";
        const roomText = placed.length
          ? [...new Set(placed.map(formatAssignedEntryRoom).filter(Boolean))].slice(0, 2).join(", ") || "교실 없음"
          : (ttcard.roomRule === "fixed" ? "고정 교실" : "교실 자동");
        item.innerHTML = `
          <div class="ttc-assigned-card-head">
            <div class="ttc-assigned-title">${escapeText(formatTtCardTitle(ttcard))}</div>
            <div class="ttc-assigned-slot">${escapeText(slotsText)}</div>
          </div>
          <div class="ttc-assigned-meta">${escapeText(formatTtCardClasses(ttcard) || "반 정보 없음")} · ${escapeText(roomText)} · ${placed.length}/${credits || "-"}시수</div>`;
        const open = () => openTtCardDetail(ttcard, placed);
        item.addEventListener("click", open);
        item.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } });
        list.appendChild(item);
      });
    }
    card.appendChild(list);
    const assist = document.createElement("div");
    assist.className = "ttc-assist";
    assist.textContent = "배정된 카드와 미배정 카드를 함께 보여줍니다. 카드를 클릭하면 상세보기가 열립니다.";
    card.appendChild(assist);
    container.appendChild(card);
  }

  function renderTeacherSettings(container, teacher, rooms) {
    const c = ensureConstraint(teacher);
    const card = document.createElement("div");
    card.className = "ttc-form-card";
    card.innerHTML = `<h4>선택 교사 설정</h4>`;

    const inline = document.createElement("div");
    inline.className = "ttc-inline";
    [
      ["maxPerDay", "하루 최대", 6],
      ["maxConsecutive", "최대 연속", 4],
    ].forEach(([key, label, fallback]) => {
      const field = document.createElement("div");
      field.className = "ttc-field";
      const lab = document.createElement("label");
      lab.textContent = label;
      const inp = document.createElement("input");
      inp.type = "number";
      inp.min = "1";
      inp.max = "12";
      inp.value = c[key] ?? fallback;
      inp.disabled = !canEdit();
      inp.addEventListener("change", e => {
        if (!canEdit()) return;
        captureTimetableUndo("교사 조건 숫자 수정");
        c[key] = parseInt(e.target.value, 10) || fallback;
        commitConstraintChange({ page: false, modal: true });
      });
      field.append(lab, inp);
      inline.appendChild(field);
    });
    card.appendChild(inline);

    const homeField = document.createElement("div");
    homeField.className = "ttc-field";
    const homeLabel = document.createElement("label");
    homeLabel.textContent = "홈룸/본인 교실";
    const homeSel = makeRoomSelect(c.homeRoomId, rooms);
    homeSel.disabled = !canEdit();
    homeSel.addEventListener("change", e => {
      if (!canEdit()) return;
      captureTimetableUndo("교사 홈룸 수정");
      c.homeRoomId = e.target.value || null;
      if (c.homeRoomId) setRoomTeacherOwner(c.homeRoomId, teacher);
      if (c.useHomeRoom) {
        c.assignedRoomId = c.homeRoomId || null;
        applyRoomToTeacherEntries(teacher, c.homeRoomId || null);
      }
      scheduleSave("rooms");
      commitConstraintChange({ page: true, modal: true });
    });
    homeField.append(homeLabel, homeSel);
    card.appendChild(homeField);

    const useHome = document.createElement("label");
    useHome.className = "ttc-check";
    const useChk = document.createElement("input");
    useChk.type = "checkbox";
    useChk.checked = !!c.useHomeRoom;
    useChk.disabled = !canEdit();
    useChk.addEventListener("change", e => {
      if (!canEdit()) return;
      captureTimetableUndo("본인 교실 사용 설정");
      c.useHomeRoom = e.target.checked;
      if (c.useHomeRoom) {
        c.assignedRoomId = c.homeRoomId || null;
        applyRoomToTeacherEntries(teacher, c.homeRoomId || null);
        if (c.homeRoomId) setRoomTeacherOwner(c.homeRoomId, teacher);
      }
      scheduleSave("rooms");
      commitConstraintChange({ page: true, modal: true });
    });
    useHome.append(useChk, "본인 교실 사용");
    card.appendChild(useHome);

    const assignedField = document.createElement("div");
    assignedField.className = "ttc-field";
    const assignedLabel = document.createElement("label");
    assignedLabel.textContent = "배정 교실";
    const assignedSel = makeRoomSelect(c.assignedRoomId, rooms);
    assignedSel.disabled = !canEdit() || !!c.useHomeRoom;
    assignedSel.addEventListener("change", e => {
      if (!canEdit()) return;
      captureTimetableUndo("교사 배정 교실 수정");
      c.assignedRoomId = e.target.value || null;
      c.useHomeRoom = false;
      applyRoomToTeacherEntries(teacher, c.assignedRoomId || null);
      commitConstraintChange({ page: true, modal: true });
    });
    assignedField.append(assignedLabel, assignedSel);
    card.appendChild(assignedField);

    const row = document.createElement("div");
    row.className = "ttc-btn-row";
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "ttc-btn primary";
    applyBtn.textContent = "현재 배정에 교실 적용";
    applyBtn.disabled = !canEdit();
    applyBtn.addEventListener("click", () => {
      if (!canEdit()) return;
      captureTimetableUndo("교사 교실 현재 배정에 적용");
      applyRoomToTeacherEntries(teacher, getEffectiveAssignedRoomId(teacher));
      commitConstraintChange({ page: true, modal: true });
    });
    row.appendChild(applyBtn);
    card.appendChild(row);

    const assist = document.createElement("div");
    assist.className = "ttc-assist";
    assist.textContent = "자동배치 기본 교실은 교사 담당교실을 우선 사용하고, 없으면 홈룸을 사용합니다.";
    card.appendChild(assist);
    container.appendChild(card);
  }

  function renderBulkFooter(container, allTeachers, dayLabels, periods) {
    const defaults = getBulkConstraintDefaults(allTeachers);
    const title = document.createElement("div");
    title.innerHTML = `<div class="ttc-bulk-title">전체 일괄 편집</div><div class="ttc-assist">선택한 시간/숫자 조건을 한 번에 적용합니다.</div>`;
    container.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "ttc-bulk-grid";
    const corner = document.createElement("div");
    corner.textContent = "";
    grid.appendChild(corner);
    dayLabels.forEach(d => { const h = document.createElement("div"); h.textContent = d; grid.appendChild(h); });
    periods.forEach((_, pIdx) => {
      const p = document.createElement("div");
      p.textContent = `${pIdx + 1}`;
      grid.appendChild(p);
      dayLabels.forEach((__, dIdx) => {
        const key = `${dIdx}:${pIdx}`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = constraintModalState.bulkSelected.has(key) ? "selected" : "";
        btn.textContent = constraintModalState.bulkSelected.has(key) ? "✓" : "";
        btn.disabled = !canEdit();
        btn.addEventListener("click", () => {
          if (constraintModalState.bulkSelected.has(key)) constraintModalState.bulkSelected.delete(key);
          else constraintModalState.bulkSelected.add(key);
          renderTeacherConstraintsModalContent();
        });
        grid.appendChild(btn);
      });
    });
    container.appendChild(grid);

    const controls = document.createElement("div");
    controls.className = "ttc-bulk-controls";
    const maxDayWrap = document.createElement("label");
    maxDayWrap.className = "ttc-mini-field";
    maxDayWrap.innerHTML = `<span>하루 최대</span>`;
    const maxDay = document.createElement("input");
    maxDay.type = "number"; maxDay.min = "1"; maxDay.max = "12"; maxDay.value = String(defaults.maxPerDay);
    maxDayWrap.appendChild(maxDay);
    const maxConWrap = document.createElement("label");
    maxConWrap.className = "ttc-mini-field";
    maxConWrap.innerHTML = `<span>최대 연속</span>`;
    const maxCon = document.createElement("input");
    maxCon.type = "number"; maxCon.min = "1"; maxCon.max = "12"; maxCon.value = String(defaults.maxConsecutive);
    maxConWrap.appendChild(maxCon);

    const applyNums = (targetTeachers) => {
      if (!canEdit()) return;
      const md = parseInt(maxDay.value, 10) || defaults.maxPerDay || 6;
      const mc = parseInt(maxCon.value, 10) || defaults.maxConsecutive || 3;
      captureTimetableUndo("교사 조건 일괄 수정");
      targetTeachers.forEach(t => {
        const c = ensureConstraint(t);
        c.maxPerDay = md;
        c.maxConsecutive = mc;
      });
      ttConfig().teacherBulkDefaults = { maxPerDay: md, maxConsecutive: mc };
      commitConstraintChange({ page: false, modal: true });
    };

    const applyAvailability = (targetTeachers, unavailable) => {
      if (!canEdit()) return;
      if (!constraintModalState.bulkSelected.size) {
        alert("먼저 일괄 적용할 시간 칸을 선택해 주세요.");
        return;
      }
      captureTimetableUndo(unavailable ? "교사 불가 시간 일괄 추가" : "교사 불가 시간 일괄 해제");
      const slotsToApply = [...constraintModalState.bulkSelected].map(key => {
        const [day, period] = key.split(":").map(v => parseInt(v, 10));
        return { day, period };
      });
      targetTeachers.forEach(t => {
        const c = ensureConstraint(t);
        const slots = Array.isArray(c.unavailableSlots) ? c.unavailableSlots : [];
        if (unavailable) {
          slotsToApply.forEach(slot => {
            if (!slots.some(s => s.day === slot.day && s.period === slot.period)) slots.push({ day: slot.day, period: slot.period });
          });
          c.unavailableSlots = slots;
        } else {
          c.unavailableSlots = slots.filter(s => !slotsToApply.some(slot => slot.day === s.day && slot.period === s.period));
        }
      });
      commitConstraintChange({ page: false, modal: true });
    };

    const filtered = getFilteredConstraintTeachers(allTeachers);
    const selectedTeacher = constraintModalState.teacher ? [constraintModalState.teacher] : [];
    const addBtn = (text, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `ttc-btn ${cls || ""}`;
      b.textContent = text;
      b.disabled = !canEdit();
      b.addEventListener("click", fn);
      controls.appendChild(b);
    };
    controls.append(maxDayWrap, maxConWrap);
    addBtn("숫자: 선택 교사", "primary", () => applyNums(selectedTeacher));
    addBtn("숫자: 전체", "ghost", () => applyNums(allTeachers));
    addBtn("선택시간 불가: 선택 교사", "danger", () => applyAvailability(selectedTeacher, true));
    addBtn("선택시간 가능: 선택 교사", "ghost", () => applyAvailability(selectedTeacher, false));
    addBtn("선택시간 불가: 현재 목록", "danger", () => applyAvailability(filtered, true));
    addBtn("시간 선택 해제", "ghost", () => { constraintModalState.bulkSelected.clear(); renderTeacherConstraintsModalContent(); });

    const syncBtn = document.createElement("button");
    syncBtn.type = "button";
    syncBtn.className = "ttc-btn ghost";
    syncBtn.textContent = "교실 데이터 반영";
    syncBtn.disabled = !canEdit();
    syncBtn.addEventListener("click", () => {
      if (!canEdit()) return;
      captureTimetableUndo("교사 조건에 교실 담당 데이터 반영");
      const changed = syncTeacherRoomAssignmentsFromRooms(allTeachers, getRooms());
      if (changed) {
        scheduleSave("timetable");
        scheduleSave("rooms");
        recomputeConflicts();
        renderAll();
        renderTeacherConstraintsModalContent();
      }
      alert(changed ? `${changed}개 교실 담당 정보를 반영했습니다.` : "새로 반영할 교실 담당 정보가 없습니다.");
    });
    controls.appendChild(syncBtn);
    container.appendChild(controls);
  }


  function captureConstraintModalScroll(overlay) {
    if (!overlay) return null;
    const pick = sel => {
      const el = overlay.querySelector(sel);
      return el ? { top: el.scrollTop || 0, left: el.scrollLeft || 0 } : { top: 0, left: 0 };
    };
    return {
      left: pick(".ttc-left"),
      center: pick(".ttc-center"),
      right: pick(".ttc-right"),
      footer: pick(".ttc-footer"),
    };
  }

  function restoreConstraintModalScroll(overlay, snap) {
    if (!overlay || !snap) return;
    requestAnimationFrame(() => {
      [
        [".ttc-left", snap.left],
        [".ttc-center", snap.center],
        [".ttc-right", snap.right],
        [".ttc-footer", snap.footer],
      ].forEach(([sel, pos]) => {
        const el = overlay.querySelector(sel);
        if (!el || !pos) return;
        el.scrollTop = pos.top || 0;
        el.scrollLeft = pos.left || 0;
      });
    });
  }

  function getRoomBusySlots(roomId) {
    const set = new Set();
    if (!roomId) return set;
    entries().forEach(e => {
      if (e.roomId === roomId) set.add(`${e.day}:${e.period}`);
    });
    return set;
  }

  function getRoomUnavailableSet(room) {
    return new Set((Array.isArray(room?.unavailableSlots) ? room.unavailableSlots : [])
      .map(s => `${Number(s.day)}:${Number(s.period)}`));
  }

  function ensureSelectedRoom(rooms = []) {
    const roomList = (rooms || []).filter(r => r?.id);
    if (!roomList.length) {
      constraintModalState.room = null;
      return null;
    }
    if (!constraintModalState.room || !roomList.some(r => r.id === constraintModalState.room)) {
      const selectedTeacherRoom = constraintModalState.teacher ? getTeacherStats(constraintModalState.teacher).roomId : null;
      constraintModalState.room = selectedTeacherRoom || roomList[0].id;
    }
    return roomList.find(r => r.id === constraintModalState.room) || roomList[0];
  }

  function renderRoomAvailabilitySettings(container, rooms, dayLabels, periods) {
    const roomList = (rooms || []).filter(r => r?.id);
    const card = document.createElement("div");
    card.className = "ttc-form-card ttc-room-unavailable-card";
    card.innerHTML = `<h4>교실 불가시간</h4>`;

    if (!roomList.length) {
      const empty = document.createElement("div");
      empty.className = "ttc-empty";
      empty.textContent = "등록된 교실이 없습니다.";
      card.appendChild(empty);
      container.appendChild(card);
      return;
    }

    const selectedRoom = ensureSelectedRoom(roomList);
    const field = document.createElement("div");
    field.className = "ttc-field";
    const lab = document.createElement("label");
    lab.textContent = "교실 선택";
    const sel = document.createElement("select");
    roomList.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko", { numeric: true })).forEach(room => {
      const opt = document.createElement("option");
      opt.value = room.id;
      opt.textContent = room.name || room.id;
      if (room.id === selectedRoom?.id) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", e => {
      constraintModalState.room = e.target.value || null;
      renderTeacherConstraintsModalContent();
    });
    field.append(lab, sel);
    card.appendChild(field);

    const room = roomList.find(r => r.id === constraintModalState.room) || selectedRoom;
    const busySlots = getRoomBusySlots(room?.id);
    const unavailable = getRoomUnavailableSet(room);

    const title = document.createElement("div");
    title.className = "ttc-section-title ttc-room-time-title";
    title.innerHTML = `<h4>${escapeText(room?.name || "교실")} 사용 가능 시간</h4><span>클릭하여 가능/불가 전환</span>`;
    card.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "ttc-time-grid ttc-room-time-grid";
    const corner = document.createElement("div");
    corner.className = "ttc-time-period";
    corner.textContent = "교시";
    grid.appendChild(corner);
    dayLabels.forEach(d => {
      const h = document.createElement("div");
      h.className = "ttc-time-head";
      h.textContent = d;
      grid.appendChild(h);
    });

    periods.forEach((label, pIdx) => {
      const p = document.createElement("div");
      p.className = "ttc-time-period";
      p.textContent = `${pIdx + 1}`;
      grid.appendChild(p);
      dayLabels.forEach((_, dIdx) => {
        const key = `${dIdx}:${pIdx}`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ttc-time-cell" + (unavailable.has(key) ? " unavailable" : "") + (busySlots.has(key) ? " busy" : "");
        btn.textContent = unavailable.has(key) ? "불가" : (busySlots.has(key) ? "수업" : "가능");
        btn.title = `${room?.name || "교실"} · ${dayLabels[dIdx]} ${label || `${pIdx + 1}교시`}`;
        btn.disabled = !canEdit();
        btn.addEventListener("click", () => {
          if (!canEdit() || !room) return;
          captureTimetableUndo("교실 사용 불가 시간 수정");
          const slots = Array.isArray(room.unavailableSlots) ? room.unavailableSlots : [];
          const idx = slots.findIndex(s => Number(s.day) === dIdx && Number(s.period) === pIdx);
          if (idx >= 0) slots.splice(idx, 1);
          else slots.push({ day: dIdx, period: pIdx });
          room.unavailableSlots = slots;
          scheduleSave("rooms", { immediate: true });
          recomputeConflicts();
          renderAll();
          renderTeacherConstraintsModalContent();
        });
        grid.appendChild(btn);
      });
    });
    card.appendChild(grid);

    const legend = document.createElement("div");
    legend.className = "ttc-legend";
    legend.innerHTML = `<span><i style="background:#f8fafc;border:1px solid #cbd5e1"></i>가능</span><span><i style="background:#fee2e2;border:1px solid #ef4444"></i>불가</span><span><i style="background:#dbeafe"></i>수업 배정 있음</span>`;
    card.appendChild(legend);

    const assist = document.createElement("div");
    assist.className = "ttc-assist";
    assist.textContent = "교실 불가시간은 자동배치 후보 시간에서 제외되며, 이미 배치된 수업은 충돌로 표시됩니다.";
    card.appendChild(assist);
    container.appendChild(card);
  }

  function renderTeacherConstraintsModalContent() {
    if (!constraintModalState.isOpen) return;
    ensureTeacherConstraintModalStyles();
    let overlay = document.getElementById("ttTeacherConstraintModal");
    const scrollSnap = captureConstraintModalScroll(overlay);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "ttTeacherConstraintModal";
      overlay.className = "ttc-modal-backdrop";
      document.body.appendChild(overlay);
    }

    const allTeachers = getAllTimetableTeachers();
    const rooms = getRooms();
    const dayLabels = ["월", "화", "수", "목", "금"];
    const periods = ttConfig().periodLabels || [];
    if (!constraintModalState.teacher || !allTeachers.includes(constraintModalState.teacher)) {
      constraintModalState.teacher = allTeachers[0] || null;
    }
    ensureSelectedRoom(rooms);

    overlay.innerHTML = `
      <div class="ttc-modal" role="dialog" aria-modal="true" aria-label="교사 조건 관리">
        <div class="ttc-modal-head">
          <div><span class="ttc-modal-title">교사 조건 관리</span><span class="ttc-modal-sub">가능 시간 · 시수 제한 · 담당 교실 · 배정 카드 확인</span></div>
          <button type="button" class="ttc-close" aria-label="닫기">×</button>
        </div>
        <div class="ttc-body"><div class="ttc-left"></div><div class="ttc-center"></div><div class="ttc-right"></div></div>
        <div class="ttc-footer"></div>
      </div>`;

    overlay.querySelector(".ttc-close").addEventListener("click", closeTeacherConstraintsModal);
    const left = overlay.querySelector(".ttc-left");
    const center = overlay.querySelector(".ttc-center");
    const right = overlay.querySelector(".ttc-right");
    const footer = overlay.querySelector(".ttc-footer");

    if (!allTeachers.length) {
      center.innerHTML = `<div class="ttc-empty">과목 카드에 등록된 교사가 없습니다.</div>`;
      return;
    }

    renderTeacherList(left, allTeachers);
    renderTeacherTimeGrid(center, constraintModalState.teacher, dayLabels, periods);
    renderTeacherSettings(right, constraintModalState.teacher, rooms);
    renderTeacherAssignedCards(right, constraintModalState.teacher, dayLabels, periods);
    renderBulkFooter(footer, allTeachers, dayLabels, periods);
    restoreConstraintModalScroll(overlay, scrollSnap);
  }

  function openTeacherConstraintsModal() {
    constraintModalState.isOpen = true;
    if (!constraintModalState.teacher) constraintModalState.teacher = getAllTimetableTeachers()[0] || null;
    renderTeacherConstraintsModalContent();
  }

  function closeTeacherConstraintsModal() {
    constraintModalState.isOpen = false;
    const overlay = document.getElementById("ttTeacherConstraintModal");
    if (overlay) overlay.remove();
  }

  function renderConstraintsPanel() {
    ensureTeacherConstraintModalStyles();
    const el = $("ttConstraintsContent");
    if (!el) return;
    el.innerHTML = "";

    const allTeachers = getAllTimetableTeachers();
    if (!allTeachers.length) {
      el.innerHTML = '<div class="tt-empty">과목카드에 등록된 교사가 없습니다.</div>';
      return;
    }

    const noRoomCount = allTeachers.filter(t => !getTeacherStats(t).roomId).length;
    const violationCount = allTeachers.filter(t => getTeacherStats(t).hasViolation).length;
    const expanded = document.createElement("div");
    expanded.className = "tt-con-launch-card";
    expanded.innerHTML = `
      <div>
        <h3>교사 조건</h3>
        <p>하단바에서는 요약만 표시하고, 편집은 넓은 팝업창에서 진행합니다.</p>
        <div class="tt-con-launch-stats">
          <span class="tt-con-launch-chip">교사 ${allTeachers.length}명</span>
          <span class="tt-con-launch-chip">교실 미지정 ${noRoomCount}명</span>
          <span class="tt-con-launch-chip">충돌 ${violationCount}명</span>
        </div>
      </div>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tt-con-open-btn";
    btn.textContent = "교사 조건 관리 열기";
    btn.addEventListener("click", openTeacherConstraintsModal);
    expanded.appendChild(btn);
    el.appendChild(expanded);
  }

  return {
    getAllTimetableTeachers,
    getEffectiveAssignedRoomId,
    syncTeacherHomeRoomFromRoom,
    applyRoomToTeacherEntries,
    renderConstraintsPanel,
  };
}
