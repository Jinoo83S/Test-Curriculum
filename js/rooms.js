// ================================================================
// rooms.js · Room CRUD + View Rendering
// ================================================================
import { uid, clean, makeBtn } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave, normalizeRoom, ROOM_TYPES } from "./state.js";
import { GRADE_KEYS } from "./config.js";

const rDomain = () => appState.rooms;
export const getRooms    = () => rDomain().rooms;
export const getRoomTypes = () => {
  const domain = rDomain();
  const savedTypes = Array.isArray(domain.roomTypes)
    ? domain.roomTypes.map(clean).filter(Boolean)
    : [];
  const baseTypes = savedTypes.length ? savedTypes : ["일반", ...ROOM_TYPES];
  const roomUsedTypes = getRooms().map(room => clean(room.type)).filter(Boolean);
  const merged = [...new Set(["일반", ...baseTypes, ...roomUsedTypes])];
  if (JSON.stringify(domain.roomTypes || []) !== JSON.stringify(merged)) {
    domain.roomTypes = merged;
  }
  return merged;
};
export const getRoomById = id => getRooms().find(r => r.id === id) || null;
export { ROOM_TYPES };

function gradeSortIndex(grade) {
  const idx = GRADE_KEYS.indexOf(grade);
  return idx >= 0 ? idx : 999;
}

function compactClassName(name) {
  return clean(name).replace(/\s+/g, "").replace(/학년/g, "").replace(/반$/g, "");
}

export function formatHomeRoomClassLabel(cls) {
  if (!cls) return "";
  const gradeNo = clean(cls.grade).replace("학년", "");
  const name = compactClassName(cls.name);
  if (!gradeNo && !name) return "";
  if (name && gradeNo && name.startsWith(gradeNo)) return name;
  return `${gradeNo}${name}`;
}

function getHomeRoomClassOptions() {
  const classes = Array.isArray(appState.classes?.classes) ? appState.classes.classes : [];
  return classes
    .slice()
    .sort((a, b) => {
      const gi = gradeSortIndex(a.grade) - gradeSortIndex(b.grade);
      if (gi) return gi;
      return formatHomeRoomClassLabel(a).localeCompare(formatHomeRoomClassLabel(b), "ko", { numeric: true });
    })
    .map(cls => ({
      id: cls.id,
      label: formatHomeRoomClassLabel(cls),
      grade: cls.grade,
      className: cls.name,
    }))
    .filter(opt => opt.id && opt.label);
}

function getHomeRoomLabelByClassId(classId) {
  const opt = getHomeRoomClassOptions().find(o => o.id === classId);
  return opt?.label || "";
}

function normalizeHomeRoomLabel(value) {
  return clean(value)
    .replace(/\s+/g, "")
    .replace(/학년/g, "")
    .replace(/반$/g, "")
    .toUpperCase();
}

function findClassIdByHomeRoomLabel(value) {
  const key = normalizeHomeRoomLabel(value);
  if (!key) return "";
  const opt = getHomeRoomClassOptions().find(o => normalizeHomeRoomLabel(o.label) === key);
  return opt?.id || "";
}

export function setRoomHomeRoomClass(roomId, classId) {
  if (!canEdit()) return false;
  const room = getRoomById(roomId);
  if (!room) return false;
  const normalizedClassId = clean(classId);

  // 한 학급의 홈룸은 하나의 교실에만 연결되도록 중복 연결을 정리합니다.
  if (normalizedClassId) {
    getRooms().forEach(other => {
      if (other.id !== roomId && other.homeRoomClassId === normalizedClassId) {
        other.homeRoomClassId = "";
      }
    });
  }

  room.homeRoomClassId = normalizedClassId;
  scheduleSave("rooms");
  return true;
}

function makeUniqueRoomTypeName(base = "새 유형") {
  const existing = new Set(getRoomTypes());
  let name = clean(base) || "새 유형";
  if (!existing.has(name)) return name;
  let i = 2;
  while (existing.has(`${name} ${i}`)) i += 1;
  return `${name} ${i}`;
}

export function addRoomType(name = "새 유형") {
  if (!canEdit()) return null;
  const typeName = makeUniqueRoomTypeName(name);
  rDomain().roomTypes = [...getRoomTypes(), typeName];
  scheduleSave("rooms");
  return typeName;
}

export function renameRoomType(oldName, newName) {
  if (!canEdit()) return false;
  const oldType = clean(oldName);
  const nextType = clean(newName);
  if (!oldType || !nextType || oldType === nextType) return false;
  const types = getRoomTypes();
  if (types.includes(nextType)) {
    alert(`이미 등록된 유형입니다: ${nextType}`);
    return false;
  }
  rDomain().roomTypes = types.map(t => t === oldType ? nextType : t);
  getRooms().forEach(room => { if (room.type === oldType) room.type = nextType; });
  scheduleSave("rooms");
  return true;
}

export function deleteRoomType(typeName) {
  if (!canEdit()) return false;
  const type = clean(typeName);
  if (!type || type === "일반") {
    alert('"일반" 유형은 기본값이므로 삭제할 수 없습니다.');
    return false;
  }
  const usingCount = getRooms().filter(room => room.type === type).length;
  const msg = usingCount
    ? `"${type}" 유형을 삭제할까요?\n현재 ${usingCount}개 교실이 이 유형을 사용 중이며, 삭제하면 "일반"으로 변경됩니다.`
    : `"${type}" 유형을 삭제할까요?`;
  if (!confirm(msg)) return false;
  rDomain().roomTypes = getRoomTypes().filter(t => t !== type);
  getRooms().forEach(room => { if (room.type === type) room.type = "일반"; });
  scheduleSave("rooms");
  return true;
}


function normalizeGradeValue(value) {
  const v = clean(value).replace(/\s+/g, "");
  if (!v) return "";
  const direct = GRADE_KEYS.find(g => g === v || g.replace("학년", "") === v);
  if (direct) return direct;
  const m = v.match(/^(7|8|9|10|11|12)(학년|학년전용|전용)?$/);
  return m ? `${m[1]}학년` : "";
}

function normalizeRoomTypeValue(value) {
  const v = clean(value);
  if (!v) return "일반";
  return getRoomTypes().includes(v) ? v : "일반";
}

/**
 * 엑셀 붙여넣기 형식:
 * 이름 | 유형 | 수용인원 | 전용학년 | 홈룸 | 담당 교사 | 메모
 * - 첫 행이 헤더이면 자동 제외합니다.
 * - 유형이 비어 있거나 등록되지 않은 값이면 "일반"으로 처리합니다.
 * - 전용학년은 7, 7학년, 10, 10학년 모두 인식합니다.
 * - 홈룸은 명단에 등록된 반을 7A, 8B 형식으로 인식합니다.
 * - 기존 형식(5번째 열이 담당 교사)도 계속 인식합니다.
 */
export function parseRoomPaste(raw) {
  const lines = String(raw || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rooms = [];
  for (const line of lines) {
    let cols = line.split(/\t/).map(c => c.trim());
    if (cols.length === 1) cols = line.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
    if (!cols.length || !cols[0]) continue;

    const firstLower = cols[0].toLowerCase().replace(/\s/g, "");
    if (["이름","교실","교실명","room","roomname","name"].includes(firstLower)) continue;

    const name = clean(cols[0]);
    if (!name) continue;

    const homeRoomClassId = findClassIdByHomeRoomLabel(cols[4]);
    const teacherColIndex = homeRoomClassId ? 5 : 4;
    const noteColIndex = homeRoomClassId ? 6 : 5;

    rooms.push(normalizeRoom({
      name,
      type: normalizeRoomTypeValue(cols[1]),
      capacity: parseInt(String(cols[2] || "").replace(/[^0-9]/g, ""), 10) || 0,
      grade: normalizeGradeValue(cols[3]),
      homeRoomClassId,
      teacherName: clean(cols[teacherColIndex]),
      note: cols.slice(noteColIndex).join(" ").trim(),
    }));
  }
  return rooms;
}

function appendRoomTypeManager(container, onUpdate, options) {
  const wrap = document.createElement("div");
  wrap.className = "room-type-manager";

  const head = document.createElement("div");
  head.className = "room-type-manager-head";
  head.innerHTML = `
    <div>
      <strong>유형 편집</strong>
      <span>추가·수정한 유형은 아래 교실 목록의 유형 드롭다운에 바로 반영됩니다.</span>
    </div>`;

  const addBtn = makeBtn("+ 유형 추가", "secondary-btn compact-btn", () => {
    addRoomType();
    onUpdate?.();
    renderRoomsView(container, onUpdate, options);
  });
  addBtn.disabled = !canEdit();
  head.appendChild(addBtn);
  wrap.appendChild(head);

  const list = document.createElement("div");
  list.className = "room-type-list";
  getRoomTypes().forEach(type => {
    const item = document.createElement("div");
    item.className = "room-type-item";

    const input = document.createElement("input");
    input.type = "text";
    input.value = type;
    input.disabled = !canEdit() || type === "일반";
    input.title = type === "일반" ? "기본 유형은 이름을 변경하지 않습니다." : "유형 이름 수정";
    input.addEventListener("change", e => {
      const next = clean(e.target.value);
      if (!next) {
        alert("유형 이름은 비워둘 수 없습니다.");
        e.target.value = type;
        return;
      }
      if (renameRoomType(type, next)) {
        onUpdate?.();
        renderRoomsView(container, onUpdate, options);
      } else {
        e.target.value = type;
      }
    });

    const count = document.createElement("span");
    count.className = "room-type-count";
    const usingCount = getRooms().filter(room => room.type === type).length;
    count.textContent = `${usingCount}개`;

    const delBtn = makeBtn("×", "room-type-del", () => {
      if (deleteRoomType(type)) {
        onUpdate?.();
        renderRoomsView(container, onUpdate, options);
      }
    });
    delBtn.disabled = !canEdit() || type === "일반";
    if (type === "일반") delBtn.title = "기본 유형은 삭제할 수 없습니다.";

    item.append(input, count, delBtn);
    list.appendChild(item);
  });
  wrap.appendChild(list);
  container.appendChild(wrap);
}

function appendRoomPasteArea(container, onUpdate, options) {
  const pasteWrap = document.createElement("div");
  pasteWrap.className = "paste-area-wrap rooms-paste-wrap";
  pasteWrap.innerHTML = `
    <div class="paste-label">
      📋 엑셀에서 복사 후 아래 영역에 붙여넣기
      <span class="paste-hint">열 구성: <strong>교실명</strong> [유형] [수용인원] [전용학년] [홈룸] [담당 교사] [메모]</span>
    </div>`;

  const textarea = document.createElement("textarea");
  textarea.className = "excel-paste-area";
  textarea.placeholder = "엑셀 데이터를 붙여넣으세요 (Ctrl+V)\n예) 701호\t일반\t24\t7\t7A\t김OO\t홈룸 교실";
  textarea.disabled = !canEdit();
  pasteWrap.appendChild(textarea);

  const pasteActions = document.createElement("div");
  pasteActions.className = "paste-actions";

  const parseBtn = makeBtn("교실 명단 추가", "primary-btn", () => {
    if (!canEdit()) return;
    const raw = textarea.value.trim();
    if (!raw) { alert("붙여넣기 영역이 비어 있습니다."); return; }
    const parsed = parseRoomPaste(raw);
    if (!parsed.length) { alert("파싱된 교실이 없습니다."); return; }

    parsed.forEach(room => getRooms().push(room));
    scheduleSave("rooms");
    textarea.value = "";
    onUpdate?.();
    renderRoomsView(container, onUpdate, options);
    alert(`${parsed.length}개 교실이 추가되었습니다.`);
  });
  parseBtn.disabled = !canEdit();

  const clearBtn = makeBtn("지우기", "secondary-btn", () => { textarea.value = ""; });
  pasteActions.append(parseBtn, clearBtn);
  pasteWrap.appendChild(pasteActions);
  container.appendChild(pasteWrap);
}

export function addRoom(data = {}) {
  if (!canEdit()) return null;
  const r = normalizeRoom({ ...data, id: uid("room") });
  getRooms().push(r); scheduleSave("rooms"); return r;
}
export function updateRoom(id, field, value) {
  if (!canEdit()) return;
  const r = getRoomById(id); if (!r) return;
  r[field] = value; scheduleSave("rooms");
}
export function deleteRoom(id) {
  if (!canEdit()) return false;
  const r = getRoomById(id); if (!r) return false;
  if (!confirm(`"${r.name}" 교실을 삭제할까요?`)) return false;
  rDomain().rooms = getRooms().filter(r2 => r2.id !== id);
  scheduleSave("rooms"); return true;
}

export function resetRooms() {
  if (!canEdit()) return false;
  const count = getRooms().length;
  const message = count
    ? `등록된 교실 ${count}개를 모두 초기화할까요?\n교실 유형 목록은 유지되고, 교실 목록만 비워집니다.`
    : "등록된 교실이 없습니다. 그래도 교실 목록을 초기화할까요?";
  if (!confirm(message)) return false;
  rDomain().rooms = [];
  scheduleSave("rooms");
  return true;
}

export function renderRoomsView(container, onUpdate, options = {}) {
  container.innerHTML = "";
  const teacherNames = Array.isArray(options.teacherNames) ? options.teacherNames : [];
  const onTeacherRoomChange = typeof options.onTeacherRoomChange === "function" ? options.onTeacherRoomChange : null;

  const hdr = document.createElement("div"); hdr.className = "rooms-header";
  const title = document.createElement("h3"); title.textContent = "교실 관리";
  const actions = document.createElement("div");
  actions.className = "rooms-header-actions";
  const addBtn = makeBtn("+ 교실 추가", "primary-btn compact-btn", () => {
    addRoom({ name: `교실 ${getRooms().length + 1}` });
    onUpdate?.(); renderRoomsView(container, onUpdate, options);
  });
  addBtn.disabled = !canEdit();
  const resetBtn = makeBtn("초기화", "secondary-btn compact-btn danger-lite", () => {
    if (resetRooms()) {
      onUpdate?.();
      renderRoomsView(container, onUpdate, options);
    }
  });
  resetBtn.disabled = !canEdit();
  actions.append(addBtn, resetBtn);
  hdr.append(title, actions); container.appendChild(hdr);

  appendRoomTypeManager(container, onUpdate, options);
  appendRoomPasteArea(container, onUpdate, options);

  if (!getRooms().length) {
    const e = document.createElement("div"); e.className = "tt-empty";
    e.textContent = "등록된 교실이 없습니다. 위 버튼으로 추가하세요."; container.appendChild(e); return;
  }

  if (teacherNames.length) {
    const dl = document.createElement("datalist");
    dl.id = "room-teacher-list";
    teacherNames.forEach(name => { const o = document.createElement("option"); o.value = name; dl.appendChild(o); });
    container.appendChild(dl);
  }

  const wrap = document.createElement("div"); wrap.className = "rooms-table-wrap";
  const table = document.createElement("table"); table.className = "rooms-table";
  table.innerHTML = `<thead><tr>
    <th>이름</th><th>유형</th><th>수용인원</th><th>전용학년</th><th>홈룸</th><th>담당 교사</th><th>메모</th><th>삭제</th>
  </tr></thead>`;
  const tbody = document.createElement("tbody");

  getRooms().forEach(room => {
    const tr = document.createElement("tr");
    const fields = [
      { tag:"input", type:"text",   key:"name",     val: room.name,     ph:"교실 이름" },
      { tag:"select",               key:"type",     options: ROOM_TYPES },
      { tag:"input", type:"number", key:"capacity", val: room.capacity || "", ph:"0", min:"0" },
    ];
    fields.forEach(f => {
      const td = document.createElement("td");
      if (f.tag === "select") {
        const sel = document.createElement("select"); sel.disabled = !canEdit();
        getRoomTypes().forEach(t => { const o = document.createElement("option"); o.value = t; o.textContent = t; if (t === room.type) o.selected = true; sel.appendChild(o); });
        sel.addEventListener("change", e => { updateRoom(room.id, "type", e.target.value); onUpdate?.(); renderRoomsView(container, onUpdate, options); });
        td.appendChild(sel);
      } else {
        const inp = document.createElement("input"); inp.type = f.type; inp.value = f.val; inp.placeholder = f.ph || ""; inp.disabled = !canEdit();
        if (f.min !== undefined) inp.min = f.min;
        inp.addEventListener("change", e => { updateRoom(room.id, f.key, f.type === "number" ? (parseInt(e.target.value) || 0) : e.target.value); onUpdate?.(); renderRoomsView(container, onUpdate, options); });
        td.appendChild(inp);
      }
      tr.appendChild(td);
    });
    // Grade select
    const gradeTd = document.createElement("td");
    const gradeSel = document.createElement("select"); gradeSel.disabled = !canEdit();
    [{ v:"", l:"공용" }, ...GRADE_KEYS.map(g => ({ v:g, l:g.replace("학년", "") }))].forEach(({ v, l }) => {
      const o = document.createElement("option"); o.value = v; o.textContent = l; if (v === room.grade) o.selected = true; gradeSel.appendChild(o);
    });
    gradeSel.addEventListener("change", e => { updateRoom(room.id, "grade", e.target.value); onUpdate?.(); renderRoomsView(container, onUpdate, options); });
    gradeTd.appendChild(gradeSel); tr.appendChild(gradeTd);

    // Homeroom class select
    const homeRoomTd = document.createElement("td");
    const homeRoomSel = document.createElement("select");
    homeRoomSel.disabled = !canEdit();
    const emptyHomeOpt = document.createElement("option");
    emptyHomeOpt.value = "";
    emptyHomeOpt.textContent = "없음";
    if (!room.homeRoomClassId) emptyHomeOpt.selected = true;
    homeRoomSel.appendChild(emptyHomeOpt);

    const homeRoomOptions = getHomeRoomClassOptions();
    homeRoomOptions.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt.id;
      o.textContent = opt.label;
      if (opt.id === room.homeRoomClassId) o.selected = true;
      homeRoomSel.appendChild(o);
    });
    if (room.homeRoomClassId && !getHomeRoomLabelByClassId(room.homeRoomClassId)) {
      const o = document.createElement("option");
      o.value = room.homeRoomClassId;
      o.textContent = "삭제된 반";
      o.selected = true;
      homeRoomSel.appendChild(o);
    }
    homeRoomSel.addEventListener("change", e => {
      setRoomHomeRoomClass(room.id, e.target.value);
      onUpdate?.();
      renderRoomsView(container, onUpdate, options);
    });
    homeRoomTd.appendChild(homeRoomSel);
    tr.appendChild(homeRoomTd);

    // Teacher / room owner
    const teacherTd = document.createElement("td");
    const teacherInput = document.createElement("input");
    teacherInput.type = "text";
    teacherInput.value = room.teacherName || "";
    teacherInput.placeholder = "예: 김OO";
    teacherInput.disabled = !canEdit();
    teacherInput.setAttribute("list", "room-teacher-list");
    teacherInput.addEventListener("change", e => {
      const teacherName = clean(e.target.value);
      updateRoom(room.id, "teacherName", teacherName);
      onTeacherRoomChange?.(room.id, teacherName);
      onUpdate?.();
      renderRoomsView(container, onUpdate, options);
    });
    teacherTd.appendChild(teacherInput);
    tr.appendChild(teacherTd);

    // Note
    const noteTd = document.createElement("td");
    const noteInp = document.createElement("input"); noteInp.type = "text"; noteInp.value = room.note || ""; noteInp.disabled = !canEdit();
    noteInp.addEventListener("change", e => { updateRoom(room.id, "note", e.target.value); onUpdate?.(); renderRoomsView(container, onUpdate, options); });
    noteTd.appendChild(noteInp); tr.appendChild(noteTd);
    // Delete
    const delTd = document.createElement("td"); delTd.className = "col-del";
    const delBtn = makeBtn("×", "stu-del-btn", () => { if (deleteRoom(room.id)) { onUpdate?.(); renderRoomsView(container, onUpdate, options); } });
    delBtn.disabled = !canEdit(); delTd.appendChild(delBtn); tr.appendChild(delTd);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody); wrap.appendChild(table); container.appendChild(wrap);
}
