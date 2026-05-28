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
    if (c.useHomeRoom && c.homeRoomId) return c.homeRoomId;
    return c.assignedRoomId || null;
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

  function renderConstraintBulkTools(container, teachers, rooms, dayLabels, periods) {
    const box = document.createElement("div");
    box.className = "tt-con-bulk-box tt-ui-card";

    const main = document.createElement("div");
    main.className = "tt-con-bulk-main";

    const title = document.createElement("div");
    title.className = "tt-con-bulk-title";
    title.innerHTML = `<strong>전체 일괄 편집</strong><span>교사 ${teachers.length}명 · 교실 ${rooms.length}개</span>`;
    main.appendChild(title);

    const maxDay = document.createElement("input");
    maxDay.type = "number"; maxDay.min = "1"; maxDay.max = "12"; maxDay.value = "6";
    const maxCon = document.createElement("input");
    maxCon.type = "number"; maxCon.min = "1"; maxCon.max = "12"; maxCon.value = "3";

    const numWrap = document.createElement("div");
    numWrap.className = "tt-con-bulk-fieldset";
    numWrap.append("하루", maxDay, "연속", maxCon);
    main.appendChild(numWrap);

    const applyNums = makeBtn("적용", "primary-btn compact-btn tt-action-btn", () => {
      if (!canEdit()) return;
      captureTimetableUndo("교사 조건 전체 일괄 수정");
      const md = parseInt(maxDay.value) || 6;
      const mc = parseInt(maxCon.value) || 3;
      teachers.forEach(t => {
        const c = ensureConstraint(t);
        c.maxPerDay = md;
        c.maxConsecutive = mc;
      });
      scheduleSave("timetable");
      recomputeConflicts();
      renderAll();
    });
    applyNums.disabled = !canEdit();
    main.appendChild(applyNums);

    const expandBtn = makeBtn("전체 펼치기", "secondary-btn compact-btn tt-action-btn", () => {
      teachers.forEach(t => { ensureConstraint(t)._expanded = true; });
      renderConstraintsPanel();
    });
    const collapseBtn = makeBtn("전체 접기", "secondary-btn compact-btn tt-action-btn", () => {
      teachers.forEach(t => { ensureConstraint(t)._expanded = false; });
      renderConstraintsPanel();
    });
    main.append(expandBtn, collapseBtn);

    const syncRoomsBtn = makeBtn("교실 데이터 반영", "secondary-btn compact-btn tt-action-btn", () => {
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
    main.appendChild(syncRoomsBtn);

    box.appendChild(main);

    const details = document.createElement("details");
    details.className = "tt-con-bulk-more";
    const summary = document.createElement("summary");
    summary.textContent = "선택 시간 일괄 불가/가능";
    details.appendChild(summary);

    const selected = { day: 0, period: 0 };
    const gridWrap = document.createElement("div");
    gridWrap.className = "tt-bulk-time-wrap";
    const grid = document.createElement("div");
    grid.className = "tt-bulk-time-grid";

    const renderBulkGrid = () => {
      grid.innerHTML = "";
      const head = document.createElement("div");
      head.className = "tt-bulk-time-row";
      head.appendChild(Object.assign(document.createElement("div"), { className: "tt-bulk-time-corner" }));
      dayLabels.forEach(d => {
        const th = document.createElement("div");
        th.className = "tt-bulk-time-head";
        th.textContent = d;
        head.appendChild(th);
      });
      grid.appendChild(head);

      periods.forEach((label, p) => {
        const row = document.createElement("div");
        row.className = "tt-bulk-time-row";
        const per = document.createElement("div");
        per.className = "tt-bulk-time-period";
        per.textContent = `${p + 1}`;
        row.appendChild(per);
        dayLabels.forEach((_, d) => {
          const btn = document.createElement("button");
          btn.type = "button";
          const isSelected = selected.day === d && selected.period === p;
          btn.className = "tt-bulk-time-cell" + (isSelected ? " is-selected" : "");
          btn.title = `${dayLabels[d]} ${periods[p] || `${p + 1}교시`}`;
          btn.textContent = isSelected ? "✓" : "";
          btn.disabled = !canEdit();
          btn.addEventListener("click", () => {
            selected.day = d;
            selected.period = p;
            renderBulkGrid();
          });
          row.appendChild(btn);
        });
        grid.appendChild(row);
      });
    };
    renderBulkGrid();

    const actionLine = document.createElement("div");
    actionLine.className = "tt-bulk-time-actions";
    const currentLabel = document.createElement("span");
    currentLabel.className = "tt-bulk-selected-label";
    const updateLabel = () => { currentLabel.textContent = `선택: ${dayLabels[selected.day]} ${periods[selected.period] || `${selected.period + 1}교시`}`; };
    const setUnav = makeBtn("전체 불가", "danger-btn compact-btn tt-action-btn", () => {
      if (!canEdit()) return;
      captureTimetableUndo("전체 수업 불가 시간 추가");
      teachers.forEach(t => {
        const c = ensureConstraint(t);
        const slots = c.unavailableSlots || (c.unavailableSlots = []);
        if (!slots.some(s => s.day === selected.day && s.period === selected.period)) slots.push({ day: selected.day, period: selected.period });
      });
      scheduleSave("timetable"); recomputeConflicts(); renderAll();
    });
    const clearUnav = makeBtn("전체 가능", "secondary-btn compact-btn tt-action-btn", () => {
      if (!canEdit()) return;
      captureTimetableUndo("전체 수업 불가 시간 해제");
      teachers.forEach(t => {
        const c = ensureConstraint(t);
        c.unavailableSlots = (c.unavailableSlots || []).filter(s => !(s.day === selected.day && s.period === selected.period));
      });
      scheduleSave("timetable"); recomputeConflicts(); renderAll();
    });
    setUnav.disabled = clearUnav.disabled = !canEdit();
    updateLabel();
    grid.addEventListener("click", updateLabel);
    actionLine.append(currentLabel, setUnav, clearUnav);
    gridWrap.append(grid, actionLine);
    details.appendChild(gridWrap);
    box.appendChild(details);

    container.appendChild(box);
  }

  function renderConstraintsPanel() {
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
