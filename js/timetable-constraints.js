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

  function renderConstraintsPanel() {
    ensureCompactConstraintStyles();
    const el = $("ttConstraintsContent"); if (!el) return;
    el.innerHTML = "";

    const allTeachers = getAllTimetableTeachers();

    if (!allTeachers.length) {
      el.innerHTML = '<div class="tt-empty">과목카드에 등록된 교사가 없습니다.</div>'; return;
    }

    const hint = document.createElement("div"); hint.className = "tt-con-hint";
    hint.textContent = "자동 배치 전 교사 조건을 설정하세요."; el.appendChild(hint);

    const dayLabels = ["월","화","수","목","금"];
    const periods = ttConfig().periodLabels;
    const rooms = getRooms();

    renderConstraintBulkTools(el, allTeachers, rooms, dayLabels, periods);

    const teacherList = document.createElement("div");
    teacherList.className = "tt-con-teacher-list";
    el.appendChild(teacherList);

    allTeachers.forEach(teacher => {
      const c = ensureConstraint(teacher);

      const block = document.createElement("div"); block.className = "tt-con-teacher-block";

      const hdr = document.createElement("div"); hdr.className = "tt-con-teacher-hdr";
      const nameEl = document.createElement("span"); nameEl.className = "tt-con-name"; nameEl.textContent = teacher;
      const placed = entries().filter(e => splitTeacherNames(e.teacherName).includes(teacher)).length;
      const constraintMap = getConstraintMap();
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

      if (!c._expanded) { teacherList.appendChild(block); return; }

      const body = document.createElement("div"); body.className = "tt-con-body";

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

      if (rooms.length) {
        const rWrap = document.createElement("div");
        rWrap.className = "tt-con-room-row";
        rWrap.style.cssText = "display:grid;gap:6px;margin-top:6px";

        const makeRoomSelect = (value) => {
          const sel = document.createElement("select");
          sel.style.cssText = "padding:3px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:11px;max-width:180px";
          sel.disabled = !canEdit();
          const noR = document.createElement("option"); noR.value = ""; noR.textContent = "없음"; sel.appendChild(noR);
          rooms.forEach(r => {
            const o = document.createElement("option");
            o.value = r.id;
            o.textContent = r.teacherName ? `${r.name} (${r.teacherName})` : r.name;
            if (r.id === value) o.selected = true;
            sel.appendChild(o);
          });
          return sel;
        };

        const homeLine = document.createElement("div");
        homeLine.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center";
        const homeLabel = document.createElement("label");
        homeLabel.textContent = "홈룸/본인 교실";
        homeLabel.style.cssText = "font-size:11px;font-weight:600;color:#6b7280";
        const homeSel = makeRoomSelect(c.homeRoomId);
        homeSel.addEventListener("change", e => {
          if (!canEdit()) return;
          const roomId = e.target.value || null;
          captureTimetableUndo("교사 홈룸 수정");
          c.homeRoomId = roomId;
          if (roomId) setRoomTeacherOwner(roomId, teacher);
          if (c.useHomeRoom) {
            c.assignedRoomId = roomId;
            applyRoomToTeacherEntries(teacher, roomId);
          }
          scheduleSave("timetable");
          scheduleSave("rooms");
          recomputeConflicts();
          renderAll();
        });
        const useHome = document.createElement("label");
        useHome.style.cssText = "display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#374151;font-weight:600";
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
          scheduleSave("timetable");
          scheduleSave("rooms");
          recomputeConflicts();
          renderAll();
        });
        useHome.append(useChk, "본인 교실 사용");
        homeLine.append(homeLabel, homeSel, useHome);

        const assignedLine = document.createElement("div");
        assignedLine.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center";
        const rLabel = document.createElement("label");
        rLabel.textContent = "배정 교실";
        rLabel.style.cssText = "font-size:11px;font-weight:600;color:#6b7280";
        const rSel = makeRoomSelect(c.assignedRoomId);
        rSel.disabled = !canEdit() || !!c.useHomeRoom;
        rSel.addEventListener("change", e => {
          if (!canEdit()) return;
          const roomId = e.target.value || null;
          captureTimetableUndo("교사 배정 교실 수정");
          c.assignedRoomId = roomId;
          c.useHomeRoom = false;
          applyRoomToTeacherEntries(teacher, roomId);
          scheduleSave("timetable");
          recomputeConflicts();
          renderAll();
        });
        const applyBtn = makeBtn("현재 배정에 적용", "secondary-btn compact-btn", () => {
          if (!canEdit()) return;
          captureTimetableUndo("교사 교실 현재 배정에 적용");
          applyRoomToTeacherEntries(teacher, getEffectiveAssignedRoomId(teacher));
          scheduleSave("timetable");
          recomputeConflicts();
          renderAll();
        });
        applyBtn.disabled = !canEdit();
        assignedLine.append(rLabel, rSel, applyBtn);

        rWrap.append(homeLine, assignedLine);
        body.appendChild(rWrap);
      }

      const unavLabel = document.createElement("div"); unavLabel.style.cssText="font-size:11px;font-weight:600;color:#6b7280;margin-top:8px;margin-bottom:4px"; unavLabel.textContent="수업 불가 시간 (클릭하여 토글)";
      body.appendChild(unavLabel);

      const grid = document.createElement("div"); grid.className = "tt-con-grid";
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

      block.appendChild(body); teacherList.appendChild(block);
    });
  }

  return {
    getAllTimetableTeachers,
    getEffectiveAssignedRoomId,
    syncTeacherHomeRoomFromRoom,
    applyRoomToTeacherEntries,
    renderConstraintsPanel,
  };
}
