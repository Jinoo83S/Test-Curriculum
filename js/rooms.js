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

function getRoomsRenderRoot(container) {
  return container?._roomsRoot || container?.closest?.(".rooms-tools-row")?.parentElement || container;
}

function appendRoomTypeManager(container, onUpdate, options) {
  const wrap = document.createElement("div");
  wrap.className = "room-type-manager his-room-card";

  const head = document.createElement("div");
  head.className = "room-type-manager-head his-room-card-head";
  head.innerHTML = `
    <div class="his-room-card-title-wrap">
      <span class="his-room-card-kicker">교실 유형</span>
      <strong>유형 편집</strong>
      <span>추가·수정한 유형은 교실 목록의 유형 드롭다운에 바로 반영됩니다.</span>
    </div>`;

  const addBtn = makeBtn("+ 유형 추가", "his-ui-btn his-ui-btn-secondary his-ui-btn-compact room-type-add-btn", () => {
    addRoomType();
    onUpdate?.();
    renderRoomsView(getRoomsRenderRoot(container), onUpdate, options);
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
        renderRoomsView(getRoomsRenderRoot(container), onUpdate, options);
      } else {
        e.target.value = type;
      }
    });

    const count = document.createElement("span");
    count.className = "room-type-count";
    const usingCount = getRooms().filter(room => room.type === type).length;
    count.textContent = `${usingCount}개`;

    const delBtn = makeBtn("×", "his-ui-btn his-ui-icon-btn his-ui-btn-danger room-type-del", () => {
      if (deleteRoomType(type)) {
        onUpdate?.();
        renderRoomsView(getRoomsRenderRoot(container), onUpdate, options);
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
  const details = document.createElement("details");
  details.className = "paste-area-wrap rooms-paste-wrap rooms-paste-details his-room-card";

  const summary = document.createElement("summary");
  summary.innerHTML = `<span class="his-room-card-kicker">붙여넣기</span><strong>엑셀 붙여넣기</strong><span class="paste-hint">교실명 · 유형 · 수용인원 · 전용학년 · 홈룸 · 담당 교사 · 메모</span>`;
  details.appendChild(summary);

  const inner = document.createElement("div");
  inner.className = "rooms-paste-inner";
  const label = document.createElement("div");
  label.className = "paste-label";
  label.innerHTML = `<span class="paste-hint">예) 701호\t일반\t24\t7\t7A\t김OO\t홈룸 교실</span>`;
  inner.appendChild(label);

  const textarea = document.createElement("textarea");
  textarea.className = "excel-paste-area";
  textarea.placeholder = "엑셀 데이터를 붙여넣으세요 (Ctrl+V)";
  textarea.disabled = !canEdit();
  inner.appendChild(textarea);

  const pasteActions = document.createElement("div");
  pasteActions.className = "paste-actions";

  const parseBtn = makeBtn("교실 명단 추가", "his-ui-btn his-ui-btn-primary his-ui-btn-compact", () => {
    if (!canEdit()) return;
    const raw = textarea.value.trim();
    if (!raw) { alert("붙여넣기 영역이 비어 있습니다."); return; }
    const parsed = parseRoomPaste(raw);
    if (!parsed.length) { alert("파싱된 교실이 없습니다."); return; }

    parsed.forEach(room => getRooms().push(room));
    scheduleSave("rooms");
    textarea.value = "";
    onUpdate?.();
    renderRoomsView(getRoomsRenderRoot(container), onUpdate, options);
    alert(`${parsed.length}개 교실이 추가되었습니다.`);
  });
  parseBtn.disabled = !canEdit();

  const clearBtn = makeBtn("지우기", "his-ui-btn his-ui-btn-ghost his-ui-btn-compact", () => { textarea.value = ""; });
  pasteActions.append(parseBtn, clearBtn);
  inner.appendChild(pasteActions);
  details.appendChild(inner);
  container.appendChild(details);
}


function roomStatusDayLabels(options = {}) {
  return Array.isArray(options.dayLabels) && options.dayLabels.length
    ? options.dayLabels
    : ["월", "화", "수", "목", "금"];
}

function roomStatusPeriodLabels(options = {}) {
  const fromOptions = Array.isArray(options.periodLabels) ? options.periodLabels : [];
  const cfg = appState.timetable?.config || {};
  const fromConfig = Array.isArray(cfg.periodLabels) ? cfg.periodLabels : [];
  const maxEntryPeriod = Array.isArray(options.entries)
    ? Math.max(-1, ...options.entries.map(e => Number(e?.period)).filter(Number.isInteger))
    : -1;
  const count = Math.max(
    1,
    Number(options.periodCount) || 0,
    Number(cfg.periodCount) || 0,
    fromOptions.length,
    fromConfig.length,
    maxEntryPeriod + 1
  );
  return Array.from({ length: count }, (_, i) => fromOptions[i] || fromConfig[i] || `${i + 1}교시`);
}

function safeEntryTitle(entry = {}, options = {}) {
  if (typeof options.getEntryTitle === "function") {
    try { return clean(options.getEntryTitle(entry)); } catch (_) {}
  }
  return clean(entry.subject || entry.label || entry.name || entry.title || entry.templateName || entry.templateId || "수업");
}

function safeEntryClassSummary(entry = {}, options = {}) {
  if (typeof options.getEntryClassSummary === "function") {
    try { return clean(options.getEntryClassSummary(entry)); } catch (_) {}
  }
  const grades = Array.isArray(entry.gradeKeys) && entry.gradeKeys.length ? entry.gradeKeys : [entry.gradeKey].filter(Boolean);
  return grades.map(g => clean(g).replace("학년", "")).filter(Boolean).join(", ") || "-";
}

function safeEntryTeachers(entry = {}) {
  return clean(entry.teacherName || "");
}

function getRoomNameForStatus(roomId) {
  if (!roomId) return "교실 미배정";
  return getRoomById(roomId)?.name || roomId;
}

function isValidTimetableEntryForRoomStatus(entry = {}) {
  return Number.isInteger(Number(entry.day)) && Number.isInteger(Number(entry.period));
}

function getRoomStatusEntries(options = {}) {
  return (Array.isArray(options.entries) ? options.entries : [])
    .filter(isValidTimetableEntryForRoomStatus)
    .map(e => ({ ...e, day: Number(e.day), period: Number(e.period) }));
}

function countRoomOverlaps(entries = []) {
  const map = new Map();
  entries.filter(e => e.roomId).forEach(e => {
    const key = `${e.roomId}:${e.day}:${e.period}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  });
  return [...map.values()].filter(list => list.length > 1).length;
}

function ensureRoomAssignmentStatusStyles() {
  if (typeof document === "undefined" || document.getElementById("roomAssignmentStatusStyle")) return;
  const style = document.createElement("style");
  style.id = "roomAssignmentStatusStyle";
  style.textContent = `
    .room-assignment-status{margin:12px 0 14px;border:1px solid #dbe4f0;border-radius:18px;background:#fff;box-shadow:0 10px 24px rgba(15,23,42,.06);overflow:hidden;}
    .room-assignment-status-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px;background:linear-gradient(135deg,#f8fbff,#eef6ff);border-bottom:1px solid #e6edf7;}
    .room-assignment-status-title{display:flex;flex-direction:column;gap:3px;min-width:180px;}
    .room-assignment-status-title strong{font-size:15px;font-weight:900;color:#102a43;}
    .room-assignment-status-title span{font-size:12px;color:#64748b;line-height:1.45;}
    .room-assignment-status-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;}
    .room-assignment-status-controls select{height:34px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:0 10px;font-size:13px;font-weight:800;color:#334155;}
    .room-assignment-stats{display:flex;gap:6px;flex-wrap:wrap;padding:10px 16px 0;}
    .room-assignment-stat{display:inline-flex;align-items:center;gap:5px;border:1px solid #e2e8f0;border-radius:999px;background:#f8fafc;padding:5px 9px;font-size:12px;font-weight:800;color:#475569;}
    .room-assignment-stat b{color:#0f172a;}
    .room-assignment-stat.warn{background:#fff7ed;border-color:#fed7aa;color:#9a3412;}
    .room-assignment-status-body{padding:12px 16px 16px;}
    .room-status-grid{display:grid;grid-template-columns:58px repeat(var(--room-status-days), minmax(118px,1fr));gap:4px;min-width:760px;}
    .room-status-scroll{overflow:auto;padding-bottom:4px;}
    .room-status-cell,.room-status-head,.room-status-period{border:1px solid #dbe4f0;border-radius:10px;background:#fff;min-height:58px;padding:7px;box-sizing:border-box;}
    .room-status-head,.room-status-period{min-height:34px;display:flex;align-items:center;justify-content:center;background:#f1f5f9;color:#334155;font-size:12px;font-weight:900;}
    .room-status-corner{min-height:34px;background:#eaf1fb;}
    .room-status-cell{display:flex;flex-direction:column;gap:5px;}
    .room-status-cell.is-empty{align-items:center;justify-content:center;background:#fbfdff;color:#94a3b8;font-size:12px;font-weight:800;}
    .room-status-assignment{display:block;border:1px solid #dbeafe;border-left:4px solid #2563eb;border-radius:8px;background:#eff6ff;padding:5px 6px;min-width:0;}
    .room-status-assignment.overlap{border-color:#fecaca;border-left-color:#dc2626;background:#fff1f2;}
    .room-status-assignment.unassigned{border-color:#fed7aa;border-left-color:#f97316;background:#fff7ed;}
    .room-status-assignment strong{display:block;font-size:11px;font-weight:900;color:#1e3a8a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .room-status-assignment.overlap strong{color:#991b1b;}
    .room-status-assignment.unassigned strong{color:#9a3412;}
    .room-status-assignment span{display:block;margin-top:2px;font-size:10px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .room-status-more{font-size:11px;font-weight:900;color:#475569;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:4px 6px;text-align:center;}
    .room-status-empty-note{border:1px dashed #cbd5e1;border-radius:12px;padding:14px;text-align:center;color:#64748b;background:#f8fafc;font-size:13px;font-weight:800;}
  `;
  document.head.appendChild(style);
}

function appendAssignmentChip(cell, entry, options, context = {}) {
  const chip = document.createElement("div");
  chip.className = "room-status-assignment";
  if (!entry.roomId) chip.classList.add("unassigned");
  if (context.overlap) chip.classList.add("overlap");

  const roomName = context.showRoomName !== false ? getRoomNameForStatus(entry.roomId) : safeEntryTitle(entry, options);
  const title = context.showRoomName !== false ? safeEntryTitle(entry, options) : safeEntryClassSummary(entry, options);
  const teacher = safeEntryTeachers(entry);
  const classText = safeEntryClassSummary(entry, options);

  const strong = document.createElement("strong");
  strong.textContent = roomName;
  const line1 = document.createElement("span");
  line1.textContent = context.showRoomName !== false ? `${title} · ${classText}` : title;
  chip.append(strong, line1);
  if (teacher) {
    const line2 = document.createElement("span");
    line2.textContent = teacher;
    chip.appendChild(line2);
  }
  cell.appendChild(chip);
}

function appendRoomAssignmentStatus(container, options = {}) {
  if (!Array.isArray(options.entries)) return;
  ensureRoomAssignmentStatusStyles();

  const dayLabels = roomStatusDayLabels(options);
  const periodLabels = roomStatusPeriodLabels(options);
  const allEntries = getRoomStatusEntries(options);
  const assignedEntries = allEntries.filter(e => e.roomId);
  const unassignedEntries = allEntries.filter(e => !e.roomId);
  const overlapCount = countRoomOverlaps(allEntries);
  const activeRoomIds = new Set(assignedEntries.map(e => e.roomId).filter(Boolean));

  const section = document.createElement("section");
  section.className = "room-assignment-status";

  const head = document.createElement("div");
  head.className = "room-assignment-status-head";
  const title = document.createElement("div");
  title.className = "room-assignment-status-title";
  title.innerHTML = `<span class="his-room-card-kicker">Timetable</span><strong>요일/시간별 배정 현황</strong><span>교실별 사용 시간, 미배정 수업, 중복 배정을 한눈에 확인합니다.</span>`;

  const controls = document.createElement("div");
  controls.className = "room-assignment-status-controls";
  const roomSelect = document.createElement("select");
  const allOpt = document.createElement("option");
  allOpt.value = "__all__";
  allOpt.textContent = "전체 교실";
  roomSelect.appendChild(allOpt);
  const unassignedOpt = document.createElement("option");
  unassignedOpt.value = "__unassigned__";
  unassignedOpt.textContent = `교실 미배정 ${unassignedEntries.length}`;
  roomSelect.appendChild(unassignedOpt);
  getRooms().forEach(room => {
    const opt = document.createElement("option");
    opt.value = room.id;
    const used = assignedEntries.filter(e => e.roomId === room.id).length;
    opt.textContent = `${room.name || room.id} · ${used}건`;
    roomSelect.appendChild(opt);
  });
  controls.appendChild(roomSelect);
  head.append(title, controls);
  section.appendChild(head);

  const stats = document.createElement("div");
  stats.className = "room-assignment-stats";
  const statItems = [
    ["등록 교실", getRooms().length, ""],
    ["사용 교실", activeRoomIds.size, ""],
    ["교실 배정", assignedEntries.length, ""],
    ["미배정", unassignedEntries.length, unassignedEntries.length ? "warn" : ""],
    ["중복 슬롯", overlapCount, overlapCount ? "warn" : ""],
  ];
  statItems.forEach(([label, value, cls]) => {
    const item = document.createElement("span");
    item.className = `room-assignment-stat ${cls || ""}`.trim();
    item.innerHTML = `${label} <b>${value}</b>`;
    stats.appendChild(item);
  });
  section.appendChild(stats);

  const body = document.createElement("div");
  body.className = "room-assignment-status-body";
  section.appendChild(body);

  const renderBody = () => {
    body.innerHTML = "";
    const selectedRoomId = roomSelect.value;
    const scroll = document.createElement("div");
    scroll.className = "room-status-scroll";
    const grid = document.createElement("div");
    grid.className = "room-status-grid";
    grid.style.setProperty("--room-status-days", String(dayLabels.length));

    const corner = document.createElement("div");
    corner.className = "room-status-head room-status-corner";
    corner.textContent = "교시";
    grid.appendChild(corner);
    dayLabels.forEach(day => {
      const h = document.createElement("div");
      h.className = "room-status-head";
      h.textContent = day;
      grid.appendChild(h);
    });

    const overlapKeyCount = new Map();
    allEntries.filter(e => e.roomId).forEach(e => {
      const key = `${e.roomId}:${e.day}:${e.period}`;
      overlapKeyCount.set(key, (overlapKeyCount.get(key) || 0) + 1);
    });

    periodLabels.forEach((periodLabel, periodIdx) => {
      const p = document.createElement("div");
      p.className = "room-status-period";
      p.textContent = periodLabel || `${periodIdx + 1}교시`;
      grid.appendChild(p);

      dayLabels.forEach((_, dayIdx) => {
        const cell = document.createElement("div");
        cell.className = "room-status-cell";
        let slotEntries = allEntries.filter(e => e.day === dayIdx && e.period === periodIdx);
        if (selectedRoomId === "__unassigned__") slotEntries = slotEntries.filter(e => !e.roomId);
        else if (selectedRoomId !== "__all__") slotEntries = slotEntries.filter(e => e.roomId === selectedRoomId);
        else slotEntries = slotEntries.filter(e => e.roomId);

        if (!slotEntries.length) {
          cell.classList.add("is-empty");
          cell.textContent = selectedRoomId === "__all__" ? "사용 없음" : "비어 있음";
        } else {
          slotEntries.slice(0, 5).forEach(entry => {
            const overlap = !!entry.roomId && (overlapKeyCount.get(`${entry.roomId}:${entry.day}:${entry.period}`) || 0) > 1;
            appendAssignmentChip(cell, entry, options, { overlap, showRoomName: selectedRoomId === "__all__" });
          });
          if (slotEntries.length > 5) {
            const more = document.createElement("div");
            more.className = "room-status-more";
            more.textContent = `외 ${slotEntries.length - 5}건`;
            cell.appendChild(more);
          }
        }
        grid.appendChild(cell);
      });
    });

    if (!allEntries.length) {
      const empty = document.createElement("div");
      empty.className = "room-status-empty-note";
      empty.textContent = "아직 시간표 배정 데이터가 없습니다.";
      body.appendChild(empty);
      return;
    }

    scroll.appendChild(grid);
    body.appendChild(scroll);
  };

  roomSelect.addEventListener("change", renderBody);
  renderBody();
  container.appendChild(section);
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
  container.classList.add("rooms-view-panel");
  const teacherNames = Array.isArray(options.teacherNames) ? options.teacherNames : [];
  const onTeacherRoomChange = typeof options.onTeacherRoomChange === "function" ? options.onTeacherRoomChange : null;

  const hdr = document.createElement("div"); hdr.className = "rooms-header his-room-main-header";
  const titleWrap = document.createElement("div");
  titleWrap.className = "rooms-title-wrap";
  titleWrap.innerHTML = `<span class="his-room-card-kicker">Room</span><h3>교실 관리</h3><p>교실 유형, 홈룸, 담당 교사, 수용인원을 관리합니다.</p>`;
  const actions = document.createElement("div");
  actions.className = "rooms-header-actions";
  const addBtn = makeBtn("+ 교실 추가", "his-ui-btn his-ui-btn-primary his-ui-btn-compact", () => {
    addRoom({ name: `교실 ${getRooms().length + 1}` });
    onUpdate?.(); renderRoomsView(container, onUpdate, options);
  });
  addBtn.disabled = !canEdit();
  const resetBtn = makeBtn("초기화", "his-ui-btn his-ui-btn-danger his-ui-btn-compact", () => {
    if (resetRooms()) {
      onUpdate?.();
      renderRoomsView(container, onUpdate, options);
    }
  });
  resetBtn.disabled = !canEdit();
  actions.append(addBtn, resetBtn);
  hdr.append(titleWrap, actions); container.appendChild(hdr);

  const toolsRow = document.createElement("div");
  toolsRow.className = "rooms-tools-row";
  toolsRow._roomsRoot = container;
  appendRoomTypeManager(toolsRow, onUpdate, options);
  appendRoomPasteArea(toolsRow, onUpdate, options);
  container.appendChild(toolsRow);

  appendRoomAssignmentStatus(container, options);

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
    const delBtn = makeBtn("×", "his-ui-btn his-ui-icon-btn his-ui-btn-danger stu-del-btn", () => { if (deleteRoom(room.id)) { onUpdate?.(); renderRoomsView(container, onUpdate, options); } });
    delBtn.disabled = !canEdit(); delTd.appendChild(delBtn); tr.appendChild(delTd);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody); wrap.appendChild(table); container.appendChild(wrap);
}
