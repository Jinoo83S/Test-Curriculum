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

  function renderConstraintBulkTools(container, teachers, rooms, dayLabels, periods) {
    const box = document.createElement("div");
    box.className = "tt-con-bulk-box";
    box.style.cssText = "display:grid;gap:8px;margin:8px 0 10px;padding:10px;border:1px solid #dbe2ef;border-radius:10px;background:#f8fbff";

    const title = document.createElement("div");
    title.style.cssText = "font-size:12px;font-weight:800;color:#1e3a5f";
    title.textContent = "전체 일괄 편집";
    box.appendChild(title);

    const row1 = document.createElement("div");
    row1.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center";
    const maxDay = document.createElement("input"); maxDay.type = "number"; maxDay.min = "1"; maxDay.max = "12"; maxDay.value = "6"; maxDay.style.cssText = "width:56px;padding:4px 6px;border:1px solid #d1d5db;border-radius:5px";
    const maxCon = document.createElement("input"); maxCon.type = "number"; maxCon.min = "1"; maxCon.max = "12"; maxCon.value = "3"; maxCon.style.cssText = maxDay.style.cssText;
    const applyNums = makeBtn("전체 적용", "primary-btn compact-btn", () => {
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
    row1.append("하루 최대", maxDay, "최대 연속", maxCon, applyNums);

    const expandBtn = makeBtn("전체 펼치기", "secondary-btn compact-btn", () => {
      teachers.forEach(t => { ensureConstraint(t)._expanded = true; });
      renderConstraintsPanel();
    });
    const collapseBtn = makeBtn("전체 접기", "secondary-btn compact-btn", () => {
      teachers.forEach(t => { ensureConstraint(t)._expanded = false; });
      renderConstraintsPanel();
    });
    row1.append(expandBtn, collapseBtn);
    box.appendChild(row1);

    const row2 = document.createElement("div");
    row2.style.cssText = row1.style.cssText;
    const daySel = document.createElement("select"); daySel.style.cssText = "padding:4px 6px;border:1px solid #d1d5db;border-radius:5px";
    dayLabels.forEach((d, i) => { const o = document.createElement("option"); o.value = i; o.textContent = d; daySel.appendChild(o); });
    const perSel = document.createElement("select"); perSel.style.cssText = daySel.style.cssText;
    periods.forEach((p, i) => { const o = document.createElement("option"); o.value = i; o.textContent = p || `${i+1}교시`; perSel.appendChild(o); });
    const setUnav = makeBtn("전체 불가", "secondary-btn compact-btn", () => {
      if (!canEdit()) return;
      captureTimetableUndo("전체 수업 불가 시간 추가");
      const day = parseInt(daySel.value), period = parseInt(perSel.value);
      teachers.forEach(t => {
        const c = ensureConstraint(t);
        const slots = c.unavailableSlots || (c.unavailableSlots = []);
        if (!slots.some(s => s.day === day && s.period === period)) slots.push({ day, period });
      });
      scheduleSave("timetable"); recomputeConflicts(); renderAll();
    });
    const clearUnav = makeBtn("전체 가능", "secondary-btn compact-btn", () => {
      if (!canEdit()) return;
      captureTimetableUndo("전체 수업 불가 시간 해제");
      const day = parseInt(daySel.value), period = parseInt(perSel.value);
      teachers.forEach(t => {
        const c = ensureConstraint(t);
        c.unavailableSlots = (c.unavailableSlots || []).filter(s => !(s.day === day && s.period === period));
      });
      scheduleSave("timetable"); recomputeConflicts(); renderAll();
    });
    setUnav.disabled = clearUnav.disabled = !canEdit();
    row2.append("선택 시간", daySel, perSel, setUnav, clearUnav);
    box.appendChild(row2);

    const row3 = document.createElement("div");
    row3.style.cssText = row1.style.cssText;
    const ownBtn = makeBtn("본인 교실 일괄 적용", "primary-btn compact-btn", () => {
      if (!canEdit()) return;
      captureTimetableUndo("본인 교실 일괄 적용");
      teachers.forEach(t => {
        const c = ensureConstraint(t);
        const roomId = c.homeRoomId;
        if (roomId) {
          c.useHomeRoom = true;
          c.assignedRoomId = roomId;
          applyRoomToTeacherEntries(t, roomId);
          setRoomTeacherOwner(roomId, t);
        }
      });
      scheduleSave("timetable"); scheduleSave("rooms"); recomputeConflicts(); renderAll();
    });
    ownBtn.disabled = !canEdit();
    row3.append(ownBtn);
    if (!rooms.length) {
      const note = document.createElement("span"); note.style.cssText = "font-size:11px;color:#64748b"; note.textContent = "교실을 먼저 등록하면 홈룸/본인 교실을 사용할 수 있습니다."; row3.appendChild(note);
    }
    box.appendChild(row3);

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

      if (!c._expanded) { el.appendChild(block); return; }

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

      block.appendChild(body); el.appendChild(block);
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
