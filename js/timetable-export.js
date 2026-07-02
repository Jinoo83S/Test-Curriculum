// ================================================================
// timetable-export.js · Timetable print/export tools
// r191: 출력 시간표 레이아웃 정리 + 카드형 제거
//  - 개별: 이름 검색 없이 전체/중등/고등 범위의 대상별 개별 시간표 출력
//  - 전체표: 선택 범위 전체를 한 시간표 테이블로 출력
//  - 학생 개별: 학생을 하나씩 고르지 않고 학급별로 한 번에 출력
// ================================================================

const DAYS = ["월", "화", "수", "목", "금"];
const EXPORT_STYLE_ID = "ttExportDialogR190Style";

function clean(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeFileName(value) {
  return clean(value || "시간표")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "시간표";
}

function sectionLabel(index) {
  return String.fromCharCode(65 + Math.max(0, Number.isInteger(index) ? index : (parseInt(index, 10) || 0)));
}

function normalizeGradeNumber(gradeKey) {
  const m = clean(gradeKey).replace(/학년/g, "").match(/\d{1,2}/);
  return m ? Number(m[0]) : null;
}

function gradeBandOf(value) {
  const n = typeof value === "number" ? value : normalizeGradeNumber(value);
  if (n >= 7 && n <= 9) return "middle";
  if (n >= 10 && n <= 12) return "high";
  return "other";
}

function bandLabel(bands = []) {
  const set = new Set(bands);
  if (set.has("middle") && set.has("high")) return "전체";
  if (set.has("middle")) return "중등";
  if (set.has("high")) return "고등";
  return "전체";
}

function gradeAllowed(gradeLike, bands = ["middle", "high"]) {
  const b = gradeBandOf(gradeLike);
  if (b === "other") return bands.includes("middle") && bands.includes("high");
  return bands.includes(b);
}

function classLabel(cls = {}) {
  const grade = normalizeGradeNumber(cls.gradeKey || cls.grade || "");
  const section = clean(cls.section || cls.name || sectionLabel(cls.sectionIdx ?? 0)).toUpperCase();
  return grade && section ? `${grade}${section}` : clean(cls.label || "-");
}

function makeClassKey(cls = {}) {
  const grade = normalizeGradeNumber(cls.gradeKey || cls.grade || "");
  const section = clean(cls.section || cls.name || sectionLabel(cls.sectionIdx ?? 0)).replace(/\s+/g, "").toUpperCase();
  return grade && section ? `${grade}:${section}` : "";
}

function normalizeClassKey(value = "", fallbackGradeKey = "") {
  const raw = clean(value).replace(/학년/g, "").replace(/\s+/g, "").toUpperCase();
  if (!raw) return "";
  if (raw.includes(":")) {
    const [g, s] = raw.split(":");
    const n = normalizeGradeNumber(g);
    return n && s ? `${n}:${s}` : "";
  }
  const m = raw.match(/^(\d{1,2})([A-Z가-힣0-9]+)$/);
  if (m) return `${Number(m[1])}:${m[2]}`;
  const fg = normalizeGradeNumber(fallbackGradeKey);
  return fg ? `${fg}:${raw}` : "";
}

function toArrayFromSet(value) {
  if (!value) return [];
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return value;
  return [];
}

function unique(list = []) {
  return [...new Set((list || []).map(clean).filter(Boolean))];
}

function getPeriodLabels(ttConfig) {
  const labels = ttConfig?.()?.periodLabels || [];
  const count = Math.max(1, labels.length || ttConfig?.()?.periodCount || 7);
  return Array.from({ length: count }, (_, i) => labels[i] || `${i + 1}교시`);
}

function ensureStyle() {
  if (document.getElementById(EXPORT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = EXPORT_STYLE_ID;
  style.textContent = `
    .tt-export-modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px}
    .tt-export-modal{width:min(880px,96vw);max-height:92vh;background:#fff;border:1px solid #cbd5e1;border-radius:14px;box-shadow:0 22px 70px rgba(15,23,42,.34);display:flex;flex-direction:column;overflow:hidden;color:#0f172a}
    .tt-export-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:14px 16px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.tt-export-head strong{display:block;font-size:17px}.tt-export-head span{display:block;margin-top:3px;font-size:12px;color:#64748b}.tt-export-close{width:32px;height:32px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;font-size:18px;font-weight:900;cursor:pointer}
    .tt-export-body{display:grid;grid-template-columns:minmax(360px,1fr) 230px;gap:14px;padding:14px 16px;overflow:auto}@media(max-width:760px){.tt-export-body{grid-template-columns:1fr}}
    .tt-export-options{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}.tt-export-options label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:900;color:#475569}.tt-export-options select{height:34px;border:1px solid #cbd5e1;border-radius:8px;padding:4px 8px;font-size:13px;background:#fff}
    .tt-export-info{margin-top:12px;padding:12px;border:1px dashed #bfdbfe;border-radius:10px;background:#eff6ff;color:#1e3a8a;font-size:12px;line-height:1.55}.tt-export-preview{margin-top:10px;padding:10px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;font-size:12px;color:#334155;line-height:1.55;max-height:180px;overflow:auto}
    .tt-export-scope{border:1px solid #dbe4f0;border-radius:12px;background:#f8fafc;padding:12px}.tt-export-scope h4{margin:0 0 10px;font-size:13px}.tt-export-scope label{display:flex;align-items:center;gap:8px;margin:8px 0;padding:8px 9px;border:1px solid #e2e8f0;border-radius:9px;background:#fff;font-size:13px;font-weight:900;color:#1e293b;cursor:pointer}.tt-export-scope input{width:16px;height:16px}.tt-export-scope p{margin:10px 0 0;font-size:11px;color:#64748b;line-height:1.45}
    .tt-export-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #e2e8f0;background:#f8fafc}.tt-export-foot button{height:34px;padding:0 14px;border:1px solid #94a3b8;border-radius:8px;background:#fff;font-weight:900;cursor:pointer}.tt-export-foot .tt-export-run{background:#2563eb;border-color:#2563eb;color:#fff}
  `;
  document.head.appendChild(style);
}

function buildStudentList(appState = {}) {
  const classes = appState.classes?.classes || [];
  return classes.flatMap(cls => (cls.students || []).map(stu => {
    const gradeKey = cls.gradeKey || cls.grade;
    const section = cls.section || cls.name || sectionLabel(cls.sectionIdx ?? 0);
    const label = classLabel({ gradeKey, section, sectionIdx: cls.sectionIdx });
    return {
      type: "student",
      key: `${cls.id}:${stu.id}`,
      studentId: stu.id,
      classId: cls.id,
      name: stu.name || stu.displayName || stu.id,
      gradeKey,
      section,
      sectionIdx: cls.sectionIdx ?? Math.max(0, clean(section).toUpperCase().charCodeAt(0) - 65),
      classLabel: label,
      label: `${stu.name || stu.displayName || stu.id} (${label})`,
      classKey: makeClassKey({ gradeKey, section, sectionIdx: cls.sectionIdx }),
    };
  })).sort((a, b) => {
    const g = (normalizeGradeNumber(a.gradeKey) || 0) - (normalizeGradeNumber(b.gradeKey) || 0);
    if (g) return g;
    const s = String(a.section).localeCompare(String(b.section), "ko", { numeric: true });
    if (s) return s;
    return String(a.name).localeCompare(String(b.name), "ko");
  });
}

function buildRosterStudentTemplateIndex(appState = {}) {
  const out = new Map();
  const add = (studentId, templateId) => {
    const sid = clean(studentId);
    const tid = clean(templateId);
    if (!sid || !tid) return;
    if (!out.has(sid)) out.set(sid, new Set());
    out.get(sid).add(tid);
  };
  const rosters = appState.rosters?.rosters || appState.rosters || {};
  if (Array.isArray(rosters)) {
    rosters.forEach(r => {
      const tid = r.templateId || r.id || r.subjectTemplateId;
      (r.studentIds || r.studentKeys || []).forEach(sid => add(sid, tid));
      (r.students || []).forEach(st => add(st.studentId || st.id, tid));
    });
  } else if (rosters && typeof rosters === "object") {
    Object.entries(rosters).forEach(([templateId, rows]) => {
      if (Array.isArray(rows)) {
        rows.forEach(row => add(row.studentId || row.id || row.studentKey, templateId));
      } else if (rows && typeof rows === "object") {
        (rows.studentIds || rows.studentKeys || []).forEach(sid => add(sid, templateId));
        (rows.students || []).forEach(st => add(st.studentId || st.id, templateId));
      }
    });
  }
  return out;
}

function splitTeacherField(value, deps = {}) {
  if (Array.isArray(value)) return unique(value);
  const raw = clean(value);
  if (!raw) return [];
  if (typeof deps.splitTeacherNames === "function") {
    try {
      const list = deps.splitTeacherNames(raw);
      if (Array.isArray(list) && list.length) return unique(list);
    } catch (_) {}
  }
  return unique(raw.split(/[,，·/\n]+/));
}

function roomNameForId(roomId, rooms = [], deps = {}) {
  const id = clean(roomId);
  if (!id) return "";
  if (typeof deps.getRoomDisplayName === "function") {
    const label = clean(deps.getRoomDisplayName(id));
    if (label && label !== "교실 없음") return label;
  }
  return rooms.find(r => r.id === id)?.name || id;
}

function entryCardIds(entry = {}) {
  return unique([entry?.ttcardId, ...(Array.isArray(entry?.ttcardIds) ? entry.ttcardIds : [])]);
}

function getRoomAssignments(entry = {}, deps = {}) {
  if (typeof deps.getRoomAssignmentsForEntry === "function") {
    try {
      const resolved = deps.getRoomAssignmentsForEntry(entry);
      if (resolved && typeof resolved === "object") return resolved;
    } catch (_) {}
  }
  if (entry?.roomAssignmentsByTtCardId && typeof entry.roomAssignmentsByTtCardId === "object") return entry.roomAssignmentsByTtCardId;
  return {};
}

function roomIdsForEntry(entry, rooms = [], deps = {}) {
  if (typeof deps.getRoomIdsForEntry === "function") {
    try {
      const ids = deps.getRoomIdsForEntry(entry);
      if (Array.isArray(ids) && ids.length) return unique(ids);
    } catch (_) {}
  }
  const ids = [];
  const assignments = getRoomAssignments(entry, deps);
  if (assignments && typeof assignments === "object") ids.push(...Object.values(assignments));
  if (Array.isArray(entry?.roomIds)) ids.push(...entry.roomIds);
  if (entry?.roomId) ids.push(entry.roomId);
  return unique(ids);
}

function roomNamesForEntry(entry, rooms = [], deps = {}) {
  const ids = roomIdsForEntry(entry, rooms, deps);
  if (!ids.length) return "교실 없음";
  return ids.map(id => roomNameForId(id, rooms, deps)).join(", ");
}

function teacherNamesForCard(card = {}, deps = {}) {
  if (!card) return [];
  if (Array.isArray(card.teachers) && card.teachers.length) return unique(card.teachers);
  return splitTeacherField(card.teacherName || card.teacher || "", deps);
}

function buildParallelLessonLines(entry = {}, rooms = [], deps = {}) {
  const title = deps.entryTitle?.(entry) || entry.subject || entry.title || "-";
  const cardIds = entryCardIds(entry);
  const assignments = getRoomAssignments(entry, deps);
  const teacherColumns = [];
  const roomColumns = [];

  if (cardIds.length > 1 && typeof deps.getTtCardById === "function") {
    cardIds.forEach(cardId => {
      const card = deps.getTtCardById(cardId);
      const teachers = teacherNamesForCard(card || {}, deps);
      const roomId = clean(assignments?.[cardId]);
      const room = roomNameForId(roomId, rooms, deps);
      if (teachers.length) {
        teachers.forEach(name => {
          teacherColumns.push(name);
          roomColumns.push(room || "교실 없음");
        });
      } else if (room) {
        roomColumns.push(room);
      }
    });
  }

  if (!teacherColumns.length) {
    teacherColumns.push(...splitTeacherField(entry.teacherName || entry.teacherNames || "", deps));
  }
  if (!roomColumns.length) {
    const roomIds = roomIdsForEntry(entry, rooms, deps);
    roomColumns.push(...roomIds.map(id => roomNameForId(id, rooms, deps)));
  }

  const teachers = unique(teacherColumns);
  const roomSource = roomColumns.map(clean).filter(Boolean);
  const roomsByColumn = [];
  const targetLen = Math.max(teachers.length, roomSource.length);
  for (let i = 0; i < targetLen; i += 1) {
    roomsByColumn.push(roomSource[i] || (roomSource.length === 1 ? roomSource[0] : ""));
  }
  const roomsUnique = unique(roomSource);

  if (teachers.length > 1 || roomSource.length > 1) {
    const teacherLine = teachers.join("\t");
    const roomLine = roomsByColumn.slice(0, Math.max(teachers.length, roomsByColumn.length)).join("\t");
    return [title, teacherLine, roomLine].filter(line => clean(line)).join("\n");
  }
  return [title, teachers[0] || "", roomsUnique[0] || ""].filter(line => clean(line)).join("\n");
}

function buildExportContext(deps = {}) {
  const rooms = deps.getRooms?.() || [];
  const periods = getPeriodLabels(deps.ttConfig);
  const entries = deps.entries?.() || [];
  const appState = deps.appState || {};
  const rosterByStudent = buildRosterStudentTemplateIndex(appState);

  const entryClassLabels = entry => {
    const audience = deps.audienceForPlacement?.(entry);
    const labels = toArrayFromSet(audience?.classLabels).filter(Boolean);
    if (labels.length) return labels;
    const keys = toArrayFromSet(audience?.classKeys).filter(Boolean);
    if (keys.length) return keys.map(k => k.replace(":", ""));
    const directKeys = Array.isArray(entry?.audienceClassKeys) ? entry.audienceClassKeys : [];
    if (directKeys.length) return directKeys.map(k => clean(k).replace(":", ""));
    const grades = deps.entryGradeKeys?.(entry) || (entry.gradeKey ? [entry.gradeKey] : []);
    const sec = sectionLabel(entry.sectionIdx ?? 0);
    return grades.map(g => `${normalizeGradeNumber(g)}${sec}`).filter(Boolean);
  };

  const entryGradeNumbers = entry => unique(entryClassLabels(entry).map(label => {
    const m = clean(label).match(/\d{1,2}/);
    return m ? m[0] : "";
  })).map(Number).filter(Boolean);

  const entryAllowedByBands = (entry, bands) => {
    const nums = entryGradeNumbers(entry);
    if (!nums.length) return bands.includes("middle") && bands.includes("high");
    return nums.some(n => gradeAllowed(n, bands));
  };

  const entryTemplateIds = entry => {
    const ids = [entry?.templateId, ...(entry?.templateIds || [])];
    try { ids.push(...(deps.entryTemplateIds?.(entry) || [])); } catch (_) {}
    const cardIds = unique([entry?.ttcardId, ...(entry?.ttcardIds || [])]);
    cardIds.forEach(id => {
      const card = deps.getTtCardById?.(id);
      if (card?.templateId) ids.push(card.templateId);
    });
    return unique(ids);
  };

  const entrySummary = (entry, mode = "normal") => {
    const title = deps.entryTitle?.(entry) || entry.subject || entry.title || "-";
    const teacher = clean(entry.teacherName || (entry.teacherNames || []).join(", "));
    const room = roomNamesForEntry(entry, rooms, deps);
    const classes = entryClassLabels(entry).join(", ");
    if (mode === "teacher") return [title, classes, room].filter(Boolean).join(" / ");
    if (mode === "class") return buildParallelLessonLines(entry, rooms, deps);
    if (mode === "room") return [title, teacher, classes].filter(Boolean).join(" / ");
    if (mode === "student") return buildParallelLessonLines(entry, rooms, deps);
    return [title, teacher, classes, room].filter(Boolean).join(" / ");
  };

  const teacherMatches = (entry, teacher) => (deps.splitTeacherNames?.(entry.teacherName || "") || [])
    .map(clean).includes(clean(teacher));

  const classMatches = (entry, cls) => {
    if (typeof deps.entryMatchesClass === "function" && deps.entryMatchesClass(entry, cls)) return true;
    const key = makeClassKey(cls);
    if (!key) return false;
    const audience = deps.audienceForPlacement?.(entry);
    return toArrayFromSet(audience?.classKeys).includes(key) || (entry.audienceClassKeys || []).includes(key);
  };

  const roomMatches = (entry, room) => roomIdsForEntry(entry, rooms, deps).includes(room.id);

  const studentMatches = (entry, student) => {
    const tids = entryTemplateIds(entry);
    const rosterSet = rosterByStudent.get(clean(student.studentId));
    if (tids.length && rosterSet && tids.some(t => rosterSet.has(t))) return true;
    const audience = deps.audienceForPlacement?.(entry);
    const classKeys = toArrayFromSet(audience?.classKeys);
    if (classKeys.length && student.classKey) return classKeys.includes(student.classKey);
    return classMatches(entry, student);
  };

  const getGridEntries = (day, period, filterFn) => entries
    .filter(e => e.day === day && e.period === period && filterFn(e))
    .sort((a, b) => String(deps.entryTitle?.(a) || "").localeCompare(String(deps.entryTitle?.(b) || ""), "ko"));

  return { rooms, periods, entries, appState, entrySummary, teacherMatches, classMatches, roomMatches, studentMatches, getGridEntries, entryAllowedByBands };
}

function getBandsFromDialog(backdrop) {
  const all = backdrop.querySelector('[data-scope="all"]')?.checked;
  const middle = backdrop.querySelector('[data-scope="middle"]')?.checked;
  const high = backdrop.querySelector('[data-scope="high"]')?.checked;
  if (all || (!middle && !high) || (middle && high)) return ["middle", "high"];
  return [middle ? "middle" : "", high ? "high" : ""].filter(Boolean);
}

function buildEntities(type, bands, deps, ctx) {
  if (type === "teacher") {
    const teachers = (deps.getAllTimetableTeachers?.() || [])
      .map(clean).filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "ko"));
    return teachers
      .filter(t => ctx.entries.some(e => ctx.teacherMatches(e, t) && ctx.entryAllowedByBands(e, bands)))
      .map(t => ({ type, key: t, label: t, mode: "teacher", groupLabel: "교사", filterFn: e => ctx.teacherMatches(e, t) && ctx.entryAllowedByBands(e, bands) }));
  }
  if (type === "class") {
    const classes = (deps.getAllClasses?.() || [])
      .map(cls => ({ ...cls, label: classLabel(cls), key: makeClassKey(cls), gradeNo: normalizeGradeNumber(cls.gradeKey || cls.grade) }))
      .filter(cls => cls.key && gradeAllowed(cls.gradeNo, bands))
      .sort((a, b) => a.label.localeCompare(b.label, "ko", { numeric: true }));
    return classes.map(cls => ({ type, key: cls.key, label: cls.label, mode: "class", groupLabel: gradeBandOf(cls.gradeNo) === "middle" ? "중등" : "고등", filterFn: e => ctx.classMatches(e, cls) }));
  }
  if (type === "room") {
    return (ctx.rooms || [])
      .filter(room => ctx.entries.some(e => ctx.roomMatches(e, room) && ctx.entryAllowedByBands(e, bands)))
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), "ko", { numeric: true }))
      .map(room => ({ type, key: room.id, label: room.name || room.id, mode: "room", groupLabel: room.type || "교실", filterFn: e => ctx.roomMatches(e, room) && ctx.entryAllowedByBands(e, bands) }));
  }
  if (type === "student") {
    return buildStudentList(deps.appState)
      .filter(s => gradeAllowed(s.gradeKey, bands))
      .map(s => ({ ...s, type, mode: "student", groupLabel: s.classLabel, filterFn: e => ctx.studentMatches(e, s) && ctx.entryAllowedByBands(e, bands) }));
  }
  return [];
}

function buildGridData(entity, ctx) {
  const data = [["교시", ...DAYS]];
  ctx.periods.forEach((label, period) => {
    const row = [label];
    DAYS.forEach((_, day) => {
      const text = ctx.getGridEntries(day, period, entity.filterFn)
        .map(e => ctx.entrySummary(e, entity.mode))
        .join("\n\n");
      row.push(text);
    });
    data.push(row);
  });
  return data;
}

function buildCombinedGridData(entities, ctx) {
  const data = [["대상", "교시", ...DAYS]];
  entities.forEach(entity => {
    ctx.periods.forEach((label, period) => {
      const row = [entity.label, label];
      DAYS.forEach((_, day) => {
        row.push(ctx.getGridEntries(day, period, entity.filterFn).map(e => ctx.entrySummary(e, entity.mode)).join("\n\n"));
      });
      data.push(row);
    });
  });
  return data;
}

function makeSheetName(raw, used) {
  const base = clean(raw).replace(/[\\/?*\[\]:]/g, " ").slice(0, 31).trim() || "Sheet";
  let name = base;
  let n = 2;
  while (used.has(name)) {
    const suffix = ` ${n++}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name);
  return name;
}

function estimateRowHeight(row = [], fallback = 54) {
  const maxLines = Math.max(1, ...row.map(cell => String(cell ?? "").split(/\n/).length));
  if (maxLines <= 1) return fallback;
  return Math.max(fallback, Math.min(150, 17 * maxLines + 12));
}

function applyWorksheetWrap(ws, XLSX) {
  if (!ws || !ws["!ref"] || !XLSX?.utils?.decode_range || !XLSX?.utils?.encode_cell) return;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell || typeof cell.v !== "string") continue;
      if (!cell.v.includes("\n") && !cell.v.includes("\t")) continue;
      cell.s = { ...(cell.s || {}), alignment: { ...(cell.s?.alignment || {}), wrapText: true, vertical: "top" } };
    }
  }
}

function exportXlsx(entities, deps, ctx, { layout, type, bands }) {
  if (!window.XLSX?.utils) {
    alert("엑셀 내보내기 라이브러리를 불러오지 못했습니다.");
    return;
  }
  if (!entities.length) {
    alert("출력 대상이 없습니다. 오른쪽 범위 체크를 확인하세요.");
    return;
  }
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const used = new Set();

  if (layout === "combined") {
    const data = buildCombinedGridData(entities, ctx);
    const ws = XLSX.utils.aoa_to_sheet(data);
    applyWorksheetWrap(ws, XLSX);
    ws["!cols"] = [{ wch: 16 }, { wch: 6 }, ...DAYS.map(() => ({ wch: 38 }))];
    ws["!rows"] = data.map((row, idx) => ({ hpt: idx === 0 ? 22 : estimateRowHeight(row, 54) }));
    XLSX.utils.book_append_sheet(wb, ws, makeSheetName(`${bandLabel(bands)}_전체표`, used));
  } else if (type === "student") {
    const byClass = new Map();
    entities.forEach(e => {
      const key = e.classLabel || "학생";
      if (!byClass.has(key)) byClass.set(key, []);
      byClass.get(key).push(e);
    });
    byClass.forEach((students, className) => {
      const data = [];
      students.forEach((student, idx) => {
        if (idx) data.push([]);
        data.push([`${student.label} 시간표`]);
        data.push(...buildGridData(student, ctx));
      });
      const ws = XLSX.utils.aoa_to_sheet(data);
      applyWorksheetWrap(ws, XLSX);
      ws["!cols"] = [{ wch: 6 }, ...DAYS.map(() => ({ wch: 38 }))];
      ws["!rows"] = data.map((row, idx) => ({ hpt: row.length === 1 ? 22 : estimateRowHeight(row, 54) }));
      XLSX.utils.book_append_sheet(wb, ws, makeSheetName(className, used));
    });
  } else {
    entities.forEach(entity => {
      const data = buildGridData(entity, ctx);
      const ws = XLSX.utils.aoa_to_sheet(data);
      applyWorksheetWrap(ws, XLSX);
      ws["!cols"] = [{ wch: 6 }, ...DAYS.map(() => ({ wch: 38 }))];
      ws["!rows"] = data.map((row, idx) => ({ hpt: idx === 0 ? 22 : estimateRowHeight(row, 54) }));
      XLSX.utils.book_append_sheet(wb, ws, makeSheetName(entity.label, used));
    });
  }

  const filename = `${type === "teacher" ? "교사" : type === "class" ? "학급" : type === "room" ? "교실" : "학생"}_${bandLabel(bands)}_${layout === "combined" ? "전체표" : "개별"}_시간표.xlsx`;
  XLSX.writeFile(wb, safeFileName(filename));
}

function lessonHtml(text) {
  if (!text) return "";
  const lines = String(text).split(/\n/);
  const body = lines.map((line, idx) => {
    const parts = line.split("\t").map(clean).filter(Boolean);
    if (parts.length > 1) {
      return `<div class="lesson-parallel">${parts.map(part => `<span>${escapeHtml(part)}</span>`).join("")}</div>`;
    }
    const cls = idx === 0 ? "lesson-title" : "lesson-line";
    return `<div class="${cls}">${escapeHtml(line)}</div>`;
  }).join("");
  return `<div class="lesson">${body}</div>`;
}

function buildIndividualSections(entities, ctx, type) {
  let lastGroup = "";
  return entities.map(entity => {
    const groupHeader = type === "student" && entity.groupLabel !== lastGroup
      ? `<h2 class="class-break">${escapeHtml(entity.groupLabel)} 학생 개별 시간표</h2>`
      : "";
    lastGroup = entity.groupLabel;
    const rows = ctx.periods.map((label, period) => {
      const tds = DAYS.map((_, day) => {
        const html = ctx.getGridEntries(day, period, entity.filterFn)
          .map(e => lessonHtml(ctx.entrySummary(e, entity.mode))).join("");
        return `<td${html ? "" : " class='empty'"}>${html}</td>`;
      }).join("");
      return `<tr><th class="period-head">${escapeHtml(label)}</th>${tds}</tr>`;
    }).join("");
    const colgroup = `<colgroup><col class="period-col">${DAYS.map(() => `<col>`).join("")}</colgroup>`;
    return `${groupHeader}<section class="print-section"><h1>${escapeHtml(entity.label)} 시간표</h1><table>${colgroup}<thead><tr><th class="corner-head">교시</th>${DAYS.map(d => `<th>${d}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join("\n");
}

function buildCombinedSection(entities, ctx, title) {
  const rows = entities.map(entity => {
    return ctx.periods.map((label, period) => {
      const tds = DAYS.map((_, day) => {
        const html = ctx.getGridEntries(day, period, entity.filterFn)
          .map(e => lessonHtml(ctx.entrySummary(e, entity.mode))).join("");
        return `<td${html ? "" : " class='empty'"}>${html}</td>`;
      }).join("");
      return `<tr><th class="entity">${escapeHtml(entity.label)}</th><th class="period-head">${escapeHtml(label)}</th>${tds}</tr>`;
    }).join("");
  }).join("\n");
  const colgroup = `<colgroup><col class="entity-col"><col class="period-col">${DAYS.map(() => `<col>`).join("")}</colgroup>`;
  return `<section class="print-section combined"><h1>${escapeHtml(title)}</h1><table>${colgroup}<thead><tr><th>대상</th><th>교시</th>${DAYS.map(d => `<th>${d}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></section>`;
}

function buildPrintHtml(entities, ctx, { layout, type, bands }) {
  const now = new Date();
  const titleType = type === "teacher" ? "교사" : type === "class" ? "학급" : type === "room" ? "교실" : "학생";
  const title = `${titleType} ${bandLabel(bands)} ${layout === "combined" ? "전체표" : "개별"} 시간표`;
  const sections = layout === "combined" ? buildCombinedSection(entities, ctx, title) : buildIndividualSections(entities, ctx, type);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page{size:A4 landscape;margin:7mm}*{box-sizing:border-box}html,body{background:#fff}body{margin:18px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827}.print-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;background:#f9fafb}.print-toolbar strong{font-size:14px}.print-toolbar span{font-size:12px;color:#6b7280}.print-toolbar button{height:32px;padding:0 14px;border:1px solid #1d4ed8;border-radius:8px;background:#2563eb;color:#fff;font-weight:800;cursor:pointer}.print-section{page-break-after:always;margin-bottom:28px}.print-section:last-child{page-break-after:auto}.class-break{page-break-before:always;margin:0 0 8px;padding:6px 8px;border:1px solid #d1d5db;background:#fff;color:#111827;font-size:15px;text-align:center}h1{margin:0 0 8px;font-size:20px;text-align:center;line-height:1.2}table{width:100%;border-collapse:collapse;table-layout:fixed;border:2px solid #374151}col.period-col{width:46px}col.entity-col{width:86px}th,td{border:1px solid #9ca3af;padding:4px;text-align:center;vertical-align:middle;word-break:keep-all;overflow-wrap:anywhere}th{background:#f3f4f6;color:#111827;font-size:12px;font-weight:800}tbody th.period-head{background:#f9fafb;color:#111827;font-size:12px;font-weight:900}.combined tbody th.entity{background:#f3f4f6;color:#111827;font-size:11px;font-weight:900}td{height:78px;font-size:10px;line-height:1.28}.empty{background:#fff}.lesson{margin:0;padding:0;background:transparent;border:0;border-radius:0;line-height:1.28;text-align:center}.lesson+.lesson{margin-top:3px;padding-top:3px;border-top:1px dotted #d1d5db}.lesson-title{font-weight:900;font-size:1.12em;margin:0 0 2px;text-align:center}.lesson-line{margin:1px 0 0;text-align:center;color:#374151}.lesson-parallel{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:2px;margin-top:1px;align-items:center}.lesson-parallel span{display:block;text-align:center;min-width:0;overflow-wrap:anywhere;color:#374151}@media print{body{margin:0}.print-toolbar{display:none}.print-section{margin:0;page-break-after:always}.print-section:last-child{page-break-after:auto}h1{font-size:16px;margin-bottom:5px}th,td{padding:3px}td{height:25mm;font-size:8.5px}.lesson-title{font-size:1.12em}.lesson-line,.lesson-parallel span{font-size:.86em}.combined th,.combined td{font-size:8px}.combined td{height:18mm}col.period-col{width:38px}col.entity-col{width:76px}}
  </style></head><body><div class="print-toolbar"><div><strong>${escapeHtml(title)}</strong><br><span>${escapeHtml(now.toLocaleString("ko-KR"))} · 인쇄 창에서 “PDF로 저장”을 선택하세요.</span></div><button onclick="window.print()">PDF 저장/인쇄</button></div>${sections}<script>setTimeout(()=>window.focus(),100);</script></body></html>`;
}

function exportPdf(entities, deps, ctx, options) {
  if (!entities.length) {
    alert("출력 대상이 없습니다. 오른쪽 범위 체크를 확인하세요.");
    return;
  }
  const html = buildPrintHtml(entities, ctx, options);
  const w = window.open("", "_blank", "width=1200,height=900");
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.focus(); } catch (_) {} }, 150);
    return;
  }
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "시간표_PDF출력.html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  alert("팝업이 차단되어 HTML 파일로 다운로드했습니다. 파일을 열고 인쇄에서 PDF로 저장해 주세요.");
}

export function openTimetableExportDialog(deps = {}) {
  ensureStyle();
  document.querySelector(".tt-export-modal-backdrop")?.remove();
  const ctx = buildExportContext(deps);
  const backdrop = document.createElement("div");
  backdrop.className = "tt-export-modal-backdrop";
  backdrop.innerHTML = `
    <div class="tt-export-modal" role="dialog" aria-modal="true" aria-label="시간표 출력">
      <div class="tt-export-head"><div><strong>시간표 출력</strong><span>개별 출력 또는 전체표 출력 방식을 선택합니다.</span></div><button type="button" class="tt-export-close">×</button></div>
      <div class="tt-export-body">
        <div>
          <div class="tt-export-options">
            <label><span>대상</span><select data-role="type"><option value="class">학급</option><option value="teacher">교사</option><option value="room">교실</option><option value="student">학생</option></select></label>
            <label><span>출력 방식</span><select data-role="layout"><option value="individual">개별</option><option value="combined">전체표</option></select></label>
            <label><span>형식</span><select data-role="format"><option value="pdf">PDF</option><option value="xlsx">엑셀</option></select></label>
          </div>
          <div class="tt-export-info" data-role="info"></div>
          <div class="tt-export-preview" data-role="preview"></div>
        </div>
        <aside class="tt-export-scope">
          <h4>출력 범위</h4>
          <label><input type="checkbox" data-scope="all" checked> 전체</label>
          <label><input type="checkbox" data-scope="middle"> 중등 7–9학년</label>
          <label><input type="checkbox" data-scope="high"> 고등 10–12학년</label>
          <p>개별은 선택 범위의 대상별 시간표를 한 번에 만듭니다. 전체표는 선택 범위의 모든 대상을 하나의 시간표 테이블 안에 모읍니다.</p>
        </aside>
      </div>
      <div class="tt-export-foot"><button type="button" class="tt-export-cancel">닫기</button><button type="button" class="tt-export-run">출력</button></div>
    </div>`;

  const close = () => backdrop.remove();
  backdrop.querySelector(".tt-export-close")?.addEventListener("click", close);
  backdrop.querySelector(".tt-export-cancel")?.addEventListener("click", close);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) close(); });

  const typeEl = backdrop.querySelector('[data-role="type"]');
  const layoutEl = backdrop.querySelector('[data-role="layout"]');
  const formatEl = backdrop.querySelector('[data-role="format"]');
  const infoEl = backdrop.querySelector('[data-role="info"]');
  const previewEl = backdrop.querySelector('[data-role="preview"]');
  const allEl = backdrop.querySelector('[data-scope="all"]');
  const middleEl = backdrop.querySelector('[data-scope="middle"]');
  const highEl = backdrop.querySelector('[data-scope="high"]');

  function syncScope(changed) {
    if (changed === allEl && allEl.checked) { middleEl.checked = false; highEl.checked = false; }
    if ((changed === middleEl || changed === highEl) && (middleEl.checked || highEl.checked)) allEl.checked = false;
    if (!allEl.checked && !middleEl.checked && !highEl.checked) allEl.checked = true;
  }

  function currentEntities() {
    return buildEntities(typeEl.value, getBandsFromDialog(backdrop), deps, ctx);
  }

  function refresh() {
    const bands = getBandsFromDialog(backdrop);
    const entities = currentEntities();
    const typeName = typeEl.value === "teacher" ? "교사" : typeEl.value === "class" ? "학급" : typeEl.value === "room" ? "교실" : "학생";
    const layoutName = layoutEl.value === "combined" ? "전체표" : "개별";
    const studentNote = typeEl.value === "student" && layoutEl.value === "individual" ? " 학생은 이름을 하나씩 고르지 않고 학급별로 묶어 한 번에 출력합니다." : "";
    infoEl.textContent = `${typeName} · ${bandLabel(bands)} · ${layoutName} 출력입니다.${studentNote}`;
    const previewItems = entities.slice(0, 18).map(e => e.label).join(" · ");
    previewEl.innerHTML = `<b>출력 대상 ${entities.length}개</b><br>${escapeHtml(previewItems || "대상 없음")}${entities.length > 18 ? ` · 외 ${entities.length - 18}개` : ""}`;
  }

  [typeEl, layoutEl, formatEl].forEach(el => el.addEventListener("change", refresh));
  [allEl, middleEl, highEl].forEach(el => el.addEventListener("change", () => { syncScope(el); refresh(); }));
  backdrop.querySelector(".tt-export-run")?.addEventListener("click", () => {
    const bands = getBandsFromDialog(backdrop);
    const entities = buildEntities(typeEl.value, bands, deps, ctx);
    const options = { layout: layoutEl.value, type: typeEl.value, bands };
    if (!entities.length) {
      alert("출력 대상이 없습니다. 전체/중등/고등 범위를 확인하세요.");
      return;
    }
    if (formatEl.value === "xlsx") exportXlsx(entities, deps, ctx, options);
    else exportPdf(entities, deps, ctx, options);
  });

  document.body.appendChild(backdrop);
  refresh();
  setTimeout(() => typeEl.focus(), 0);
}

// Backward compatibility for older calls.
export function exportTimetableXlsx(deps = {}) {
  const ctx = buildExportContext(deps);
  const bands = ["middle", "high"];
  const entities = buildEntities("class", bands, deps, ctx);
  exportXlsx(entities, deps, ctx, { layout: "individual", type: "class", bands });
}
