// ================================================================
// rooms.js · Room CRUD + View Rendering
// ================================================================
import { uid, clean, makeBtn } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave, normalizeRoom, ROOM_TYPES } from "./state.js";
import { GRADE_KEYS } from "./config.js";

const rDomain = () => appState.rooms;
export const getRooms    = () => rDomain().rooms;
export const getRoomById = id => getRooms().find(r => r.id === id) || null;
export { ROOM_TYPES };

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

export function renderRoomsView(container, onUpdate) {
  container.innerHTML = "";

  const hdr = document.createElement("div"); hdr.className = "rooms-header";
  const title = document.createElement("h3"); title.textContent = "교실 관리";
  const addBtn = makeBtn("+ 교실 추가", "primary-btn compact-btn", () => {
    addRoom({ name: `교실 ${getRooms().length + 1}` });
    onUpdate?.(); renderRoomsView(container, onUpdate);
  });
  addBtn.disabled = !canEdit();
  hdr.append(title, addBtn); container.appendChild(hdr);

  if (!getRooms().length) {
    const e = document.createElement("div"); e.className = "tt-empty";
    e.textContent = "등록된 교실이 없습니다. 위 버튼으로 추가하세요."; container.appendChild(e); return;
  }

  const wrap = document.createElement("div"); wrap.className = "rooms-table-wrap";
  const table = document.createElement("table"); table.className = "rooms-table";
  table.innerHTML = `<thead><tr>
    <th>이름</th><th>유형</th><th>수용인원</th><th>전용학년</th><th>메모</th><th>삭제</th>
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
        ROOM_TYPES.forEach(t => { const o = document.createElement("option"); o.value = t; o.textContent = t; if (t === room.type) o.selected = true; sel.appendChild(o); });
        sel.addEventListener("change", e => updateRoom(room.id, "type", e.target.value));
        td.appendChild(sel);
      } else {
        const inp = document.createElement("input"); inp.type = f.type; inp.value = f.val; inp.placeholder = f.ph || ""; inp.disabled = !canEdit();
        if (f.min !== undefined) inp.min = f.min;
        inp.addEventListener("change", e => updateRoom(room.id, f.key, f.type === "number" ? (parseInt(e.target.value) || 0) : e.target.value));
        td.appendChild(inp);
      }
      tr.appendChild(td);
    });
    // Grade select
    const gradeTd = document.createElement("td");
    const gradeSel = document.createElement("select"); gradeSel.disabled = !canEdit();
    [{ v:"", l:"공용" }, ...GRADE_KEYS.map(g => ({ v:g, l:g }))].forEach(({ v, l }) => {
      const o = document.createElement("option"); o.value = v; o.textContent = l; if (v === room.grade) o.selected = true; gradeSel.appendChild(o);
    });
    gradeSel.addEventListener("change", e => updateRoom(room.id, "grade", e.target.value));
    gradeTd.appendChild(gradeSel); tr.appendChild(gradeTd);
    // Note
    const noteTd = document.createElement("td");
    const noteInp = document.createElement("input"); noteInp.type = "text"; noteInp.value = room.note || ""; noteInp.disabled = !canEdit();
    noteInp.addEventListener("change", e => updateRoom(room.id, "note", e.target.value));
    noteTd.appendChild(noteInp); tr.appendChild(noteTd);
    // Delete
    const delTd = document.createElement("td"); delTd.className = "col-del";
    const delBtn = makeBtn("×", "stu-del-btn", () => { if (deleteRoom(room.id)) { onUpdate?.(); renderRoomsView(container, onUpdate); } });
    delBtn.disabled = !canEdit(); delTd.appendChild(delBtn); tr.appendChild(delTd);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody); wrap.appendChild(table); container.appendChild(wrap);
}
