// ================================================================
// timetable-export.js · Timetable print/export tools
// r206: 간략 출력 과목 자동 적용 제거
//  - CA/SA도 체크박스로 선택한 경우에만 간략 출력
//  - 새 학년도에 CA/SA가 없으면 간략 후보에도 강제 추가하지 않음
//  - 교실 개별에서도 선택 과목이 해당 교실 카드와 실제 매칭될 때만 간략 표시
// ================================================================

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const COMMON_BRIEF_SUBJECTS = ["CA", "SA"];
const EXPORT_STYLE_ID = "ttExportDialogR233Style";

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

function normalizeScopeSelection(scope = ["middle", "high"]) {
  if (Array.isArray(scope)) return { bands: scope.length ? scope : ["middle", "high"], classKeys: [] };
  const bands = Array.isArray(scope?.bands) && scope.bands.length ? scope.bands : ["middle", "high"];
  const classKeys = unique((scope?.classKeys || []).map(key => normalizeClassKey(key)).filter(Boolean));
  return { bands, classKeys };
}

function scopeLabel(scope = ["middle", "high"]) {
  const normalized = normalizeScopeSelection(scope);
  if (normalized.classKeys.length) {
    const labels = normalized.classKeys.map(classLabelFromKey).filter(Boolean);
    if (labels.length <= 4) return labels.join(", ");
    return `${labels.slice(0, 4).join(", ")} 외 ${labels.length - 4}개 학반`;
  }
  return bandLabel(normalized.bands);
}

function classAllowedByScope(cls = {}, scope = ["middle", "high"]) {
  const normalized = normalizeScopeSelection(scope);
  const key = makeClassKey(cls);
  if (normalized.classKeys.length) return !!key && normalized.classKeys.includes(key);
  return gradeAllowed(cls.gradeNo ?? cls.gradeKey ?? cls.grade, normalized.bands);
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

function normalizeSpecialSubjectCode(value = "") {
  const raw = clean(value).normalize("NFKC");
  if (!raw) return "";
  // 사용자가 직접 고르는 대표 출력 대상이므로 CA/SA에 한정하지 않습니다.
  // 공백·구두점 차이를 줄여 같은 교과/그룹명을 안정적으로 매칭합니다.
  return raw.replace(/[\s\-_·,，/()\[\]]+/g, "").toUpperCase();
}

function normalizeSpecialSubjectSelection(values = []) {
  return unique((values || []).map(normalizeSpecialSubjectCode).filter(Boolean));
}

function commonBriefSubjectCodes() {
  return COMMON_BRIEF_SUBJECTS.map(normalizeSpecialSubjectCode).filter(Boolean);
}

function effectiveBriefSubjectCodes(values = []) {
  // 자동 간략 출력은 하지 않습니다.
  // CA/SA도 사용자가 체크한 경우에만 간략 출력됩니다.
  return normalizeSpecialSubjectSelection(values);
}

function specialSubjectLabel(values = []) {
  const codes = normalizeSpecialSubjectSelection(values);
  return codes.length ? `간략 ${codes.join("/")}` : "간략 없음";
}

function getSpecialSubjectsFromDialog(backdrop) {
  return normalizeSpecialSubjectSelection([...backdrop.querySelectorAll("[data-special-subject]:checked")].map(el => el.dataset.specialSubject || ""));
}

function periodDisplayLabel(label, index) {
  const raw = clean(label);
  const m = raw.match(/\d{1,2}/);
  if (m) return String(Number(m[0]));
  return raw || String(index + 1);
}

function getPeriodLabels(ttConfig) {
  const labels = ttConfig?.()?.periodLabels || [];
  const count = Math.max(1, labels.length || ttConfig?.()?.periodCount || 7);
  return Array.from({ length: count }, (_, i) => periodDisplayLabel(labels[i] || `${i + 1}`, i));
}


const PRINT_FIELD_DEFS = [
  { key: "subject", label: "과목", defaultPos: "mc", defaultBold: true },
  { key: "english", label: "영문명", defaultPos: "bc", defaultBold: false },
  { key: "teacher", label: "교사", defaultPos: "bl", defaultBold: false },
  { key: "room", label: "교실", defaultPos: "br", defaultBold: true },
  { key: "class", label: "반", defaultPos: "tl", defaultBold: false },
  { key: "period", label: "수업시간대", defaultPos: "tr", defaultBold: false },
];
const PRINT_POSITIONS = [
  ["tl", "↖ 위 왼쪽"], ["tc", "↑ 위 중앙"], ["tr", "↗ 위 오른쪽"],
  ["ml", "← 가운데 왼쪽"], ["mc", "● 가운데"], ["mr", "→ 가운데 오른쪽"],
  ["bl", "↙ 아래 왼쪽"], ["bc", "↓ 아래 중앙"], ["br", "↘ 아래 오른쪽"],
];

function defaultPrintFieldSettings() {
  return Object.fromEntries(PRINT_FIELD_DEFS.map(def => [def.key, {
    enabled: def.key !== "period",
    bold: !!def.defaultBold,
    pos: def.defaultPos,
  }]));
}

function normalizePrintSettings(raw = {}) {
  const defaults = {
    renderMode: "cards",
    cellLayout: "auto",
    applyMode: "card",
    fontScale: "normal",
    fields: defaultPrintFieldSettings(),
  };
  const fields = defaultPrintFieldSettings();
  Object.entries(raw?.fields || {}).forEach(([key, value]) => {
    if (!fields[key]) return;
    fields[key] = {
      ...fields[key],
      enabled: value?.enabled !== false,
      bold: !!value?.bold,
      pos: PRINT_POSITIONS.some(([pos]) => pos === value?.pos) ? value.pos : fields[key].pos,
    };
  });
  return {
    ...defaults,
    ...raw,
    renderMode: ["cards", "legacy"].includes(raw?.renderMode) ? raw.renderMode : defaults.renderMode,
    cellLayout: ["auto", "vertical", "columns", "grid"].includes(raw?.cellLayout) ? raw.cellLayout : defaults.cellLayout,
    applyMode: ["card", "cell"].includes(raw?.applyMode) ? raw.applyMode : defaults.applyMode,
    fontScale: ["small", "normal", "large"].includes(raw?.fontScale) ? raw.fontScale : defaults.fontScale,
    fields,
  };
}

function printSettingsSummary(settings = {}) {
  const s = normalizePrintSettings(settings);
  if (s.renderMode === "legacy") return "기존 줄 출력";
  const visible = PRINT_FIELD_DEFS.filter(def => s.fields[def.key]?.enabled).map(def => def.label).join("/") || "표시 항목 없음";
  const layout = s.cellLayout === "auto" ? "자동분할" : s.cellLayout === "grid" ? "2×2" : s.cellLayout === "columns" ? "가로" : "세로";
  return `${layout} · ${visible}`;
}

function applyPrintPreset(backdrop, preset = "basic") {
  const settings = normalizePrintSettings();
  if (preset === "simple") {
    Object.values(settings.fields).forEach(field => { field.enabled = false; field.bold = false; });
    settings.fields.subject.enabled = true;
    settings.fields.subject.bold = true;
    settings.fields.subject.pos = "mc";
    settings.fields.room.enabled = true;
    settings.fields.room.bold = false;
    settings.fields.room.pos = "bc";
    settings.fields.english.enabled = false;
  } else if (preset === "detail") {
    Object.values(settings.fields).forEach(field => { field.enabled = true; });
    settings.fields.subject.bold = true;
    settings.fields.room.bold = true;
    settings.fields.class.pos = "tl";
    settings.fields.period.pos = "tr";
    settings.fields.teacher.pos = "bl";
    settings.fields.room.pos = "br";
    settings.fields.english.pos = "bc";
  } else {
    settings.fields.subject.enabled = true;
    settings.fields.english.enabled = true;
    settings.fields.teacher.enabled = true;
    settings.fields.room.enabled = true;
    settings.fields.class.enabled = false;
    settings.fields.period.enabled = false;
  }
  backdrop.querySelector('[data-print-render-mode]').value = settings.renderMode;
  backdrop.querySelector('[data-print-cell-layout]').value = settings.cellLayout;
  backdrop.querySelector('[data-print-apply-mode]').value = settings.applyMode;
  backdrop.querySelector('[data-print-font-scale]').value = settings.fontScale;
  PRINT_FIELD_DEFS.forEach(def => {
    const enabled = backdrop.querySelector(`[data-print-field-enabled="${def.key}"]`);
    const bold = backdrop.querySelector(`[data-print-field-bold="${def.key}"]`);
    const pos = backdrop.querySelector(`[data-print-field-pos="${def.key}"]`);
    if (enabled) enabled.checked = !!settings.fields[def.key].enabled;
    if (bold) bold.checked = !!settings.fields[def.key].bold;
    if (pos) pos.value = settings.fields[def.key].pos;
  });
}

function getPrintSettingsFromDialog(backdrop) {
  const fields = {};
  PRINT_FIELD_DEFS.forEach(def => {
    fields[def.key] = {
      enabled: !!backdrop.querySelector(`[data-print-field-enabled="${def.key}"]`)?.checked,
      bold: !!backdrop.querySelector(`[data-print-field-bold="${def.key}"]`)?.checked,
      pos: clean(backdrop.querySelector(`[data-print-field-pos="${def.key}"]`)?.value) || def.defaultPos,
    };
  });
  return normalizePrintSettings({
    renderMode: clean(backdrop.querySelector('[data-print-render-mode]')?.value) || "cards",
    cellLayout: clean(backdrop.querySelector('[data-print-cell-layout]')?.value) || "auto",
    applyMode: clean(backdrop.querySelector('[data-print-apply-mode]')?.value) || "card",
    fontScale: clean(backdrop.querySelector('[data-print-font-scale]')?.value) || "normal",
    fields,
  });
}

function ensureStyle() {
  if (document.getElementById(EXPORT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = EXPORT_STYLE_ID;
  style.textContent = `
    .tt-export-modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px}
    .tt-export-modal{width:min(880px,96vw);max-height:92vh;background:#fff;border:1px solid #cbd5e1;border-radius:14px;box-shadow:0 22px 70px rgba(15,23,42,.34);display:flex;flex-direction:column;overflow:hidden;color:#0f172a}
    .tt-export-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:14px 16px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.tt-export-head strong{display:block;font-size:17px}.tt-export-head span{display:block;margin-top:3px;font-size:12px;color:#64748b}.tt-export-close{width:32px;height:32px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;font-size:18px;font-weight:900;cursor:pointer}
    .tt-export-body{display:grid;grid-template-columns:minmax(360px,1fr) 230px;gap:14px;padding:14px 16px 8px;overflow:auto}@media(max-width:760px){.tt-export-body{grid-template-columns:1fr}}
    .tt-export-options{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}.tt-export-options label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:900;color:#475569}.tt-export-options select{height:34px;border:1px solid #cbd5e1;border-radius:8px;padding:4px 8px;font-size:13px;background:#fff}
    .tt-export-info{margin-top:12px;padding:12px;border:1px dashed #bfdbfe;border-radius:10px;background:#eff6ff;color:#1e3a8a;font-size:12px;line-height:1.55}.tt-export-preview{margin-top:10px;padding:10px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;font-size:12px;color:#334155;line-height:1.55;max-height:180px;overflow:auto}
    .tt-export-scope{border:1px solid #dbe4f0;border-radius:12px;background:#f8fafc;padding:12px}.tt-export-scope h4{margin:0 0 10px;font-size:13px}.tt-export-scope label{display:flex;align-items:center;gap:8px;margin:8px 0;padding:8px 9px;border:1px solid #e2e8f0;border-radius:9px;background:#fff;font-size:13px;font-weight:900;color:#1e293b;cursor:pointer}.tt-export-scope input{width:16px;height:16px}.tt-export-class-scopes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:10px;padding-top:10px;border-top:1px dashed #cbd5e1}.tt-export-class-scopes label{justify-content:center;margin:0;padding:7px 5px;font-size:12px;font-weight:400}.tt-export-class-scopes.is-disabled{opacity:.42;pointer-events:none}.tt-export-scope p{margin:10px 0 0;font-size:11px;color:#64748b;line-height:1.45}.tt-export-special-scopes{padding:0 16px 12px}.tt-export-special-panel{border:1px solid #dbe4f0;border-radius:12px;background:#f8fafc;padding:11px}.tt-export-special-panel .tt-export-special-title{display:block;margin-bottom:7px;font-size:12px;font-weight:400;color:#334155}.tt-export-special-list{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;max-height:138px;overflow:auto;padding-right:2px}.tt-export-special-scopes label{display:flex;align-items:center;gap:7px;margin:0;padding:7px 8px;border:1px solid #e2e8f0;border-radius:9px;background:#fff;font-size:12px;font-weight:400;color:#1e293b;cursor:pointer}.tt-export-special-scopes input{width:16px;height:16px}.tt-export-special-scopes p{margin:8px 0 0;font-size:11px;color:#64748b;line-height:1.45}@media(max-width:760px){.tt-export-special-list{grid-template-columns:1fr 1fr}}
    .tt-export-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #e2e8f0;background:#f8fafc}.tt-export-foot button{height:34px;padding:0 14px;border:1px solid #94a3b8;border-radius:8px;background:#fff;font-weight:900;cursor:pointer}.tt-export-foot .tt-export-run{background:#2563eb;border-color:#2563eb;color:#fff}
    .tt-print-settings{margin-top:12px;border:1px solid #dbe4f0;border-radius:12px;background:#fff;overflow:hidden}.tt-print-settings-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0}.tt-print-settings-head strong{font-size:13px}.tt-print-presets{display:flex;gap:5px;flex-wrap:wrap}.tt-print-presets button{height:26px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;padding:0 9px;font-size:11px;font-weight:800;cursor:pointer}.tt-print-settings-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:10px 12px;border-bottom:1px dashed #e2e8f0}.tt-print-settings-grid label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:900;color:#475569}.tt-print-settings-grid select{height:30px;border:1px solid #cbd5e1;border-radius:8px;padding:3px 7px;background:#fff;font-size:12px}.tt-print-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;padding:10px 12px}.tt-print-field{display:grid;grid-template-columns:auto 1fr auto 118px;align-items:center;gap:7px;border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc;padding:6px 7px;font-size:12px}.tt-print-field input{width:15px;height:15px}.tt-print-field b{font-size:12px;color:#0f172a}.tt-print-field .bold-label{display:flex;align-items:center;gap:4px;font-size:11px;color:#64748b;font-weight:700}.tt-print-field select{height:28px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;font-size:11px;padding:2px 5px}.tt-print-hint{padding:0 12px 10px;font-size:11px;color:#64748b;line-height:1.45}.tt-print-settings.is-hidden{display:none}@media(max-width:900px){.tt-print-settings-grid{grid-template-columns:1fr 1fr}.tt-print-fields{grid-template-columns:1fr}.tt-print-field{grid-template-columns:auto 1fr auto 112px}}
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

function buildRosterStudentCourseIndex(appState = {}) {
  const byStudent = new Map();
  const templateByStudent = new Map();

  const add = (studentId, templateId, row = {}) => {
    const sid = clean(studentId);
    const tid = clean(templateId);
    if (!sid || !tid) return;

    const record = {
      templateId: tid,
      classId: clean(row.classId || row.classKey || row.class || ""),
      sectionIdx: Number.isFinite(Number(row.sectionIdx)) ? Number(row.sectionIdx) : null,
      raw: row,
    };

    if (!byStudent.has(sid)) byStudent.set(sid, []);
    byStudent.get(sid).push(record);

    if (!templateByStudent.has(sid)) templateByStudent.set(sid, new Set());
    templateByStudent.get(sid).add(tid);
  };

  const visitTemplateRows = (templateId, rows) => {
    const tid = clean(templateId);
    if (!tid || !rows) return;

    if (Array.isArray(rows)) {
      rows.forEach(row => {
        if (row && typeof row === "object") add(row.studentId || row.id || row.studentKey, tid, row);
        else add(row, tid, {});
      });
      return;
    }

    if (rows instanceof Set) {
      rows.forEach(sid => add(sid, tid, {}));
      return;
    }

    if (rows instanceof Map) {
      rows.forEach((value, key) => {
        if (value && typeof value === "object") add(value.studentId || value.id || key, tid, value);
        else add(key || value, tid, {});
      });
      return;
    }

    if (rows && typeof rows === "object") {
      (rows.studentIds || rows.studentKeys || []).forEach(sid => add(sid, tid, {}));
      (rows.students || []).forEach(st => add(st.studentId || st.id, tid, st));
      (rows.entries || rows.rows || []).forEach(row => add(row?.studentId || row?.id || row?.studentKey, tid, row));
    }
  };

  const rosters = appState.rosters?.rosters || appState.rosters || {};
  if (Array.isArray(rosters)) {
    rosters.forEach(r => {
      const tid = r?.templateId || r?.id || r?.subjectTemplateId;
      visitTemplateRows(tid, r?.entries || r?.rows || r);
    });
  } else if (rosters instanceof Map) {
    rosters.forEach((rows, templateId) => visitTemplateRows(templateId, rows));
  } else if (rosters && typeof rosters === "object") {
    Object.entries(rosters).forEach(([templateId, rows]) => visitTemplateRows(templateId, rows));
  }

  return { byStudent, templateByStudent };
}

function buildRosterStudentTemplateIndex(appState = {}) {
  return buildRosterStudentCourseIndex(appState).templateByStudent;
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


function getClassList(deps = {}) {
  try {
    const direct = deps.getAllClasses?.();
    if (Array.isArray(direct) && direct.length) return direct;
  } catch (_) {}
  return deps.appState?.classes?.classes || [];
}

function classFromIdOrKey(value = "", deps = {}) {
  const raw = clean(value);
  if (!raw) return null;
  const classes = getClassList(deps);
  const byId = classes.find(cls => clean(cls.id) === raw);
  if (byId) return byId;
  const key = normalizeClassKey(raw);
  if (!key) return null;
  return classes.find(cls => makeClassKey(cls) === key) || null;
}

function classLabelFromIdOrKey(value = "", deps = {}) {
  const cls = classFromIdOrKey(value, deps);
  if (cls) return classLabel(cls);
  return classLabelFromKey(value) || clean(value);
}

function roomIdentityValues(room = {}) {
  return unique([
    room?.id,
    room?.name,
    room?.short,
    room?.label,
    room?.roomId,
  ].map(clean).filter(Boolean));
}

function roomRefMatchesRoom(value = "", room = {}) {
  const raw = clean(value);
  if (!raw) return false;
  const ids = roomIdentityValues(room);
  if (ids.includes(raw)) return true;
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  return ids.some(id => id.replace(/\s+/g, "").toUpperCase() === compact);
}

function classHomeRoomRefs(cls = {}) {
  const refs = [];
  [
    cls.homeRoomId,
    cls.homeRoomRoomId,
    cls.homeroomRoomId,
    cls.homeroomId,
    cls.homeRoom,
    cls.homeroom,
    cls.classroomId,
    cls.classRoomId,
    cls.roomId,
    cls.defaultRoomId,
    cls.mainRoomId,
  ].forEach(value => refs.push(value));
  if (Array.isArray(cls.classroomIds)) refs.push(...cls.classroomIds);
  if (Array.isArray(cls.roomIds)) refs.push(...cls.roomIds);
  if (typeof cls.classroomIds === "string") refs.push(...cls.classroomIds.split(/[;,\s]+/));
  if (typeof cls.roomIds === "string") refs.push(...cls.roomIds.split(/[;,\s]+/));
  return unique(refs.map(clean).filter(Boolean));
}

function homeRoomLabelForRoom(room = {}, deps = {}) {
  const direct = classLabelFromIdOrKey(room?.homeRoomClassId || room?.homeRoomId || room?.homeroomClassId || "", deps);
  if (/^\d{1,2}[A-Z]$/.test(direct)) return direct;

  const textLabel = clean(room?.homeRoomLabel || room?.homeroomLabel || room?.homeClassLabel || room?.classLabel);
  if (/^\d{1,2}[A-Z]$/.test(textLabel)) return textLabel;

  const classes = getClassList(deps);
  const matched = classes.find(cls => classHomeRoomRefs(cls).some(ref => roomRefMatchesRoom(ref, room)));
  if (matched) {
    const label = classLabel(matched);
    if (/^\d{1,2}[A-Z]$/.test(label)) return label;
  }
  return "";
}

function roomLabelForExport(room = {}, deps = {}) {
  return clean(room?.name || room?.short || room?.id) || "교실";
}

function roomSubtitleForExport(room = {}, deps = {}) {
  const home = homeRoomLabelForRoom(room, deps);
  return home ? `Homeroom: ${home}` : "";
}

function normalizedRoomRuleForExport(value = "") {
  const rule = clean(value || "teacher");
  if (["teacher", "fixed", "homeroom", "autoRoom", "none"].includes(rule)) return rule;
  if (rule === "auto") return "teacher";
  return "teacher";
}

function homeRoomIdForClassKeyExport(classKey = "", rooms = [], deps = {}) {
  const cls = classFromIdOrKey(classKey, deps);
  if (!cls?.id) return "";
  return clean((rooms || []).find(room => clean(room.homeRoomClassId || room.homeRoomId) === clean(cls.id))?.id);
}

function homeRoomIdsForCardExport(card = {}, entry = {}, rooms = [], deps = {}) {
  const candidates = [];
  classKeysForCard(card).forEach(key => candidates.push(key));
  if (!candidates.length && Array.isArray(entry?.audienceClassKeys)) candidates.push(...entry.audienceClassKeys);
  return unique(candidates.map(key => homeRoomIdForClassKeyExport(key, rooms, deps)).filter(Boolean));
}

function roomIdForCardExport(cardId = "", card = {}, entry = {}, rooms = [], deps = {}) {
  const assignments = getRoomAssignments(entry, deps);
  const assigned = clean(assignments?.[cardId]);
  if (assigned) return assigned;
  const fixed = clean(card?.fixedRoomId || card?.roomId || "");
  if (fixed) return fixed;
  const rule = normalizedRoomRuleForExport(card?.roomRule || entry?.roomRule || "teacher");
  if (rule === "homeroom") {
    const ids = homeRoomIdsForCardExport(card, entry, rooms, deps);
    if (ids.length === 1) return ids[0];
  }
  const ids = roomIdsForEntry(entry, rooms, deps);
  if (ids.length === 1) return ids[0];
  return "";
}

function cardRoomMatchesExport(cardId = "", card = {}, entry = {}, room = {}, rooms = [], deps = {}) {
  const target = clean(room?.id);
  if (!target) return false;
  const cardRoomId = roomIdForCardExport(cardId, card, entry, rooms, deps);
  if (cardRoomId && cardRoomId === target) return true;
  if (homeRoomIdsForCardExport(card, entry, rooms, deps).includes(target)) return true;
  // 그룹 배치의 다른 카드가 이 교실을 쓰고 있다는 이유만으로
  // 현재 카드를 이 교실에 속한 것으로 보지 않습니다.
  // 카드별 assignment/fixed/homeroom 해석으로 매칭된 카드만 교실 개별 출력에 포함합니다.
  return false;
}

function roomScopedCardsForEntry(entry = {}, room = {}, rooms = [], deps = {}) {
  const ids = entryCardIds(entry);
  if (!ids.length || typeof deps.getTtCardById !== "function") return [];
  return ids.map(cardId => ({ cardId, card: deps.getTtCardById(cardId) }))
    .filter(item => item.card && cardRoomMatchesExport(item.cardId, item.card, entry, room, rooms, deps));
}

function teacherNamesForCard(card = {}, deps = {}) {
  if (!card) return [];
  if (Array.isArray(card.teachers) && card.teachers.length) return unique(card.teachers);
  return splitTeacherField(card.teacherName || card.teacher || "", deps);
}

function stripGeneratedSectionSuffix(title = "") {
  const raw = clean(title);
  if (!raw) return "";
  // 시간표카드 생성 시 반/분반 표시용으로 붙는 A, B, C suffix는 출력 과목명에서는 제거합니다.
  // 예: "기독교 연구 A" → "기독교 연구", "선교적 리더십 A, B, C" → "선교적 리더십"
  return raw
    .replace(/\s+[A-Z](?:\s*[,·/]\s*[A-Z])+\s*$/u, "")
    .replace(/\s+[A-Z]\s*$/u, "")
    .trim() || raw;
}

function getTemplateList(deps = {}) {
  return deps.appState?.templates?.templates || [];
}

function templateById(templateId = "", deps = {}) {
  const id = clean(templateId);
  if (!id) return null;
  return getTemplateList(deps).find(tpl => clean(tpl.id) === id) || null;
}

function titleParts(ko = "", en = "") {
  const koText = stripGeneratedSectionSuffix(ko);
  const enText = stripGeneratedSectionSuffix(en);
  return { ko: koText || enText, en: enText && enText !== koText ? enText : "" };
}

function templateTitlePartsForExport(tpl = null) {
  if (!tpl) return titleParts("", "");
  const ko = clean(tpl.nameKo) || clean(tpl.sem1NameKo) || clean(tpl.sem2NameKo);
  const en = clean(tpl.nameEn) || clean(tpl.sem1NameEn) || clean(tpl.sem2NameEn);
  return titleParts(ko, en);
}

function templateTitleForExport(tpl = null) {
  const parts = templateTitlePartsForExport(tpl);
  return parts.ko || parts.en || "";
}

function compoundPartTitlePartsForExport(card = {}, deps = {}) {
  const partId = clean(card?.compoundPartId);
  if (!partId) return titleParts("", "");
  const parentId = clean(card.compoundParentTemplateId || card.templateId);
  const tpl = templateById(parentId, deps);
  const parts = Array.isArray(tpl?.compoundParts) ? tpl.compoundParts : [];
  const part = parts.find((item, idx) => clean(item?.id || `part${idx + 1}`) === partId);
  return titleParts(clean(part?.nameKo), clean(part?.nameEn));
}

function compoundPartTitleForExport(card = {}, deps = {}) {
  const parts = compoundPartTitlePartsForExport(card, deps);
  return parts.ko || parts.en || "";
}

function curriculumTitlePartsForCard(card = {}, deps = {}) {
  if (!card) return titleParts("", "");
  const partTitle = compoundPartTitlePartsForExport(card, deps);
  if (partTitle.ko || partTitle.en) return partTitle;
  const tpl = templateById(card.templateId, deps);
  return templateTitlePartsForExport(tpl);
}

function curriculumTitleForCard(card = {}, deps = {}) {
  const parts = curriculumTitlePartsForCard(card, deps);
  return parts.ko || parts.en || "";
}

function cardTitlePartsForExport(card = {}, deps = {}) {
  if (!card) return titleParts("", "");
  const fromCurriculum = curriculumTitlePartsForCard(card, deps);
  if (fromCurriculum.ko || fromCurriculum.en) return fromCurriculum;
  const ko = clean(card.subject || card.label || card.subjectKo || card.nameKo || card.title);
  const en = clean(card.subjectEn || card.nameEn);
  const rawParts = titleParts(ko, en);
  if (rawParts.ko || rawParts.en) return rawParts;
  if (typeof deps.getTtCardTitle === "function") {
    try { return titleParts(deps.getTtCardTitle(card), ""); } catch (_) {}
  }
  return titleParts("", "");
}

function cardTitleForExport(card = {}, deps = {}) {
  const parts = cardTitlePartsForExport(card, deps);
  return parts.ko || parts.en || "";
}

function entryTitlePartsForExport(entry = {}, deps = {}) {
  const cardIds = entryCardIds(entry);
  if (cardIds.length && typeof deps.getTtCardById === "function") {
    const partsList = cardIds.map(id => cardTitlePartsForExport(deps.getTtCardById(id), deps)).filter(p => p.ko || p.en);
    const koTitles = unique(partsList.map(p => p.ko || p.en).filter(Boolean));
    const enTitles = unique(partsList.map(p => p.en).filter(Boolean));
    if (koTitles.length === 1) return titleParts(koTitles[0], enTitles.length === 1 ? enTitles[0] : "");
    if (koTitles.length > 1) return titleParts(koTitles.join(" / "), enTitles.join(" / "));
  }
  const templateIds = unique([entry?.templateId, ...(Array.isArray(entry?.templateIds) ? entry.templateIds : [])]);
  const partsList = templateIds.map(id => templateTitlePartsForExport(templateById(id, deps))).filter(p => p.ko || p.en);
  const koTitles = unique(partsList.map(p => p.ko || p.en).filter(Boolean));
  const enTitles = unique(partsList.map(p => p.en).filter(Boolean));
  if (koTitles.length === 1) return titleParts(koTitles[0], enTitles.length === 1 ? enTitles[0] : "");
  if (koTitles.length > 1) return titleParts(koTitles.join(" / "), enTitles.join(" / "));
  const fallback = deps.entryTitle?.(entry) || entry.subject || entry.title || "-";
  return titleParts(fallback, "");
}

function entryTitleForExport(entry = {}, deps = {}) {
  const parts = entryTitlePartsForExport(entry, deps);
  return parts.ko || parts.en || "-";
}

function pushRepresentativeCandidate(list, label = "", kind = "subject", priority = 50) {
  const text = clean(label);
  const key = normalizeSpecialSubjectCode(text);
  if (!text || !key) return;
  if (list.some(item => item.key === key)) return;
  list.push({ key, label: text, kind, priority });
}

function representativeSubjectCandidatesForCard(card = {}, deps = {}) {
  const out = [];
  if (!card) return out;
  const parts = cardTitlePartsForExport(card, deps);
  pushRepresentativeCandidate(out, parts.ko || parts.en, "card", 30);
  pushRepresentativeCandidate(out, parts.en, "card-en", 70);
  [card.subject, card.label, card.subjectKo, card.subjectEn, card.nameKo, card.nameEn, card.title, card.short]
    .forEach(value => pushRepresentativeCandidate(out, value, "card-raw", 80));
  return out;
}

function representativeSubjectCandidatesForEntry(entry = {}, deps = {}) {
  const out = [];
  pushRepresentativeCandidate(out, entry.groupName, "group", 5);
  pushRepresentativeCandidate(out, entry.groupLabel, "group", 8);
  [entry.subject, entry.subjectKo, entry.subjectEn, entry.title, entry.label, entry.name, entry.short]
    .forEach(value => pushRepresentativeCandidate(out, value, "entry", 20));
  const parts = entryTitlePartsForExport(entry, deps);
  pushRepresentativeCandidate(out, parts.ko || parts.en, "entry-title", 30);
  pushRepresentativeCandidate(out, parts.en, "entry-title-en", 70);
  const cardIds = entryCardIds(entry);
  if (cardIds.length && typeof deps.getTtCardById === "function") {
    cardIds.forEach(id => representativeSubjectCandidatesForCard(deps.getTtCardById(id), deps)
      .forEach(item => pushRepresentativeCandidate(out, item.label, item.kind, item.priority + 10)));
  }
  const templateIds = unique([entry?.templateId, ...(Array.isArray(entry?.templateIds) ? entry.templateIds : [])]);
  templateIds.forEach(id => {
    const tplParts = templateTitlePartsForExport(templateById(id, deps));
    pushRepresentativeCandidate(out, tplParts.ko || tplParts.en, "template", 60);
    pushRepresentativeCandidate(out, tplParts.en, "template-en", 90);
  });
  return out.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label, "ko", { numeric: true }));
}

function specialSubjectCodeForCard(card = {}, deps = {}) {
  return representativeSubjectCandidatesForCard(card, deps)[0]?.key || "";
}

function specialSubjectCodesForEntry(entry = {}, deps = {}) {
  return unique(representativeSubjectCandidatesForEntry(entry, deps).map(item => item.key).filter(Boolean));
}

function specialSubjectCodeForEntry(entry = {}, deps = {}) {
  return specialSubjectCodesForEntry(entry, deps)[0] || "";
}

function selectedRepresentativeCandidate(entry = {}, deps = {}, selectedCodes = []) {
  const candidates = representativeSubjectCandidatesForEntry(entry, deps);
  if (!candidates.length) return null;
  const briefCodes = effectiveBriefSubjectCodes(selectedCodes || []);
  return candidates.find(item => briefCodes.includes(item.key)) || null;
}

function shouldUseRepresentativeOutput(entry = {}, deps = {}, selectedCodes = []) {
  return !!selectedRepresentativeCandidate(entry, deps, selectedCodes);
}

function representativeLessonLines(entry = {}, mode = "normal", scope = {}, rooms = [], deps = {}, selectedCodes = []) {
  let candidate = selectedRepresentativeCandidate(entry, deps, selectedCodes);
  if (!candidate) return "";
  if (mode === "room") {
    const room = (rooms || []).find(r => clean(r.id) === clean(scope.key || scope.roomId || scope.id)) || scope;
    const matchingCards = roomScopedCardsForEntry(entry, room, rooms, deps);
    if (!matchingCards.length) return "";

    const briefCodes = effectiveBriefSubjectCodes(selectedCodes || []);
    const scopedCandidates = [];
    matchingCards.forEach(({ card }) => representativeSubjectCandidatesForCard(card, deps)
      .forEach(item => pushRepresentativeCandidate(scopedCandidates, item.label, item.kind, item.priority)));
    const scopedCandidate = scopedCandidates.find(item => briefCodes.includes(item.key));

    // 카드 자체가 선택 과목과 일치하면 그 과목명으로 간략 표시합니다.
    // entry/group 이름만 대표값으로 존재하는 경우에는,
    // 이 교실에 실제 매칭 카드가 있을 때만 group 대표값을 허용합니다.
    if (scopedCandidate) {
      candidate = scopedCandidate;
    } else if (!String(candidate.kind || "").includes("group")) {
      return "";
    }

    const label = candidate.label;
    const home = homeRoomLabelForRoom(room, deps);
    if (home) return `${label}
${home} Homeroom`;
    const classes = unique(matchingCards.flatMap(({ card }) => classLabelsForCard(card)));
    if (classes.length) return `${label}
${classes.join(", ")}`;
    return label;
  }
  return candidate.label;
}

function buildSpecialSubjectOptions(deps = {}, ctx = {}) {
  const optionMap = new Map();
  const add = (label = "", priority = 50) => {
    const text = clean(label);
    const key = normalizeSpecialSubjectCode(text);
    if (!text || !key) return;
    const old = optionMap.get(key);
    if (!old || priority < old.priority) optionMap.set(key, { key, label: text, priority });
  };
  (ctx.entries || []).forEach(entry => representativeSubjectCandidatesForEntry(entry, deps).forEach(item => {
    // 여러 과목명이 "/"로 길게 합쳐진 후보는 체크 목록을 오염시킵니다.
    // 사용자는 실제 과목/그룹 단위로 골라야 하므로 카드·템플릿별 후보를 남기고 병합 후보는 제외합니다.
    const slashCount = (clean(item.label).match(/\//g) || []).length;
    if ((item.kind || "").includes("entry-title") && slashCount >= 1) return;
    if (slashCount >= 2) return;
    add(item.label, item.priority);
  }));
  return [...optionMap.values()].sort((a, b) => {
    const ad = commonBriefSubjectCodes().includes(a.key) ? -100 : a.priority;
    const bd = commonBriefSubjectCodes().includes(b.key) ? -100 : b.priority;
    return ad - bd || a.label.localeCompare(b.label, "ko", { numeric: true });
  });
}

function titleLinesForParts(partsList = []) {
  const list = partsList.filter(p => p && (p.ko || p.en));
  if (!list.length) return ["-"];
  const koLine = list.map(p => p.ko || p.en || "-").join("	");
  const enLine = list.map(p => p.en || "").join("	");
  return enLine.split("	").some(clean) ? [koLine, enLine] : [koLine];
}

function singleTitleLinesForEntry(entry = {}, deps = {}) {
  return titleLinesForParts([entryTitlePartsForExport(entry, deps)]);
}

function classKeyForSection(gradeKey, sectionIdx = 0) {
  const grade = normalizeGradeNumber(gradeKey);
  const section = sectionLabel(sectionIdx).toUpperCase();
  return grade && section ? `${grade}:${section}` : "";
}

function classKeysForCard(card = {}) {
  if (!card) return [];
  const keys = [];
  if (Array.isArray(card.classKeys) && card.classKeys.length) {
    card.classKeys.forEach(key => keys.push(normalizeClassKey(key, card.gradeKey)));
  }
  if (Array.isArray(card.classLabels) && card.classLabels.length) {
    card.classLabels.forEach(label => keys.push(normalizeClassKey(label, card.gradeKey)));
  }
  if (!keys.length) keys.push(classKeyForSection(card.gradeKey, card.sectionIdx ?? 0));
  return unique(keys);
}

function classLabelFromKey(key = "") {
  const normalized = normalizeClassKey(key);
  if (!normalized) return "";
  const [grade, section] = normalized.split(":");
  return grade && section ? `${grade}${section}` : normalized.replace(":", "");
}

function classLabelsForCard(card = {}) {
  return unique(classKeysForCard(card).map(classLabelFromKey).filter(Boolean));
}

function scopeClassKey(scope = {}) {
  if (!scope) return "";
  return normalizeClassKey(scope.classKey || scope.key || "", scope.gradeKey || scope.grade || "");
}

function cardMatchesScopeClass(card = {}, targetClassKey = "") {
  const target = clean(targetClassKey);
  if (!card || !target) return false;
  return classKeysForCard(card).includes(target);
}

function scopedCardIdsForEntry(entry = {}, scope = {}, deps = {}) {
  const ids = entryCardIds(entry);
  const targetClassKey = scopeClassKey(scope);
  if (!ids.length || !targetClassKey || typeof deps.getTtCardById !== "function") return ids;

  const matched = ids.filter(id => cardMatchesScopeClass(deps.getTtCardById(id), targetClassKey));
  if (matched.length) return matched;

  const narrowed = Array.isArray(entry?.audienceClassKeys)
    ? entry.audienceClassKeys.map(key => normalizeClassKey(key)).filter(Boolean)
    : [];
  if (narrowed.length && narrowed.includes(targetClassKey) && ids.length === 1) return ids;
  return ids;
}

function studentRosterRows(student = {}, ctx = {}) {
  const sid = clean(student.studentId || student.id || student.studentKey || student.key);
  if (!sid || !ctx.rosterRowsByStudent?.get) return [];
  return ctx.rosterRowsByStudent.get(sid) || [];
}

function studentTemplateSet(student = {}, ctx = {}) {
  const sets = [];
  const sid = clean(student.studentId || student.id || student.studentKey || student.key);
  if (sid && ctx.rosterByStudent?.get) sets.push(ctx.rosterByStudent.get(sid));
  if (Array.isArray(student.templateIds)) sets.push(new Set(student.templateIds.map(clean).filter(Boolean)));
  const out = new Set();
  sets.forEach(set => {
    if (!set) return;
    if (set instanceof Set) set.forEach(id => { const tid = clean(id); if (tid) out.add(tid); });
    else if (Array.isArray(set)) set.forEach(id => { const tid = clean(id); if (tid) out.add(tid); });
  });
  studentRosterRows(student, ctx).forEach(row => {
    const tid = clean(row.templateId);
    if (tid) out.add(tid);
  });
  return out;
}

function studentKeyCandidates(student = {}) {
  return unique([
    student.studentId,
    student.id,
    student.studentKey,
    student.key,
    student.name,
    student.label,
  ].filter(Boolean));
}

function cardGradeMatchesStudent(card = {}, student = {}) {
  const cardGrade = normalizeGradeNumber(card.gradeKey || card.grade || "");
  const studentGrade = normalizeGradeNumber(student.gradeKey || student.grade || "");
  return !cardGrade || !studentGrade || cardGrade === studentGrade;
}

function cardClassMatchesStudent(card = {}, student = {}) {
  const studentClassKey = scopeClassKey(student);
  const cardClassKeys = classKeysForCard(card);
  if (studentClassKey && cardClassKeys.includes(studentClassKey)) return true;
  if (card.isWholeGrade && cardGradeMatchesStudent(card, student)) return true;
  return !cardClassKeys.length && cardGradeMatchesStudent(card, student);
}

function rosterRowMatchesCard(row = {}, card = {}, student = {}) {
  if (!row || !card) return false;
  const tplIds = unique([card.templateId, card.compoundParentTemplateId].filter(Boolean));
  if (!tplIds.includes(clean(row.templateId))) return false;

  if (row.classId && student.classId && clean(row.classId) !== clean(student.classId)) return false;

  // 수강명단의 sectionIdx는 같은 템플릿이 여러 반/분반 카드로 생성될 때 학생 본인 반을 가르는 핵심 값입니다.
  if (row.sectionIdx !== null && row.sectionIdx !== undefined && Number.isFinite(Number(card.sectionIdx))) {
    const rowSection = Number(row.sectionIdx);
    const cardSection = Number(card.sectionIdx);
    if (rowSection !== cardSection && !card.isWholeGrade) return false;
  }

  return cardClassMatchesStudent(card, student);
}

function cardMatchesStudentRoster(card = {}, student = {}, ctx = {}) {
  if (!card) return false;
  const keys = studentKeyCandidates(student);
  const cardStudentKeys = unique([...(card.studentKeys || []), ...(card.studentIds || [])]);
  if (cardStudentKeys.length && keys.some(key => cardStudentKeys.map(clean).includes(clean(key)))) return true;

  const rosterRows = studentRosterRows(student, ctx);
  if (rosterRows.length && rosterRows.some(row => rosterRowMatchesCard(row, card, student))) return true;

  const rosterSet = studentTemplateSet(student, ctx);
  const tplIds = unique([card.templateId, card.compoundParentTemplateId].filter(Boolean));
  if (rosterSet.size && tplIds.some(id => rosterSet.has(clean(id)))) {
    return cardClassMatchesStudent(card, student);
  }
  return false;
}

function studentScopedCardIdsForEntry(entry = {}, student = {}, deps = {}, ctx = {}) {
  const ids = entryCardIds(entry);
  const rosterSet = studentTemplateSet(student, ctx);
  const keys = studentKeyCandidates(student);
  const directAudience = unique([...(entry.audienceStudentKeys || []), ...(entry.studentKeys || []), ...(entry.studentIds || [])]);
  if (directAudience.length && keys.some(key => directAudience.map(clean).includes(clean(key)))) return ids;

  if (ids.length && typeof deps.getTtCardById === "function") {
    const matched = ids.filter(id => cardMatchesStudentRoster(deps.getTtCardById(id), student, ctx));
    if (matched.length) return matched;
  }

  const templateIds = unique([entry?.templateId, ...(Array.isArray(entry?.templateIds) ? entry.templateIds : [])].filter(Boolean));
  if (rosterSet.size && templateIds.length && templateIds.some(id => rosterSet.has(clean(id)))) {
    if (ids.length) return ids;
    return ["__entry__"];
  }

  return [];
}

function buildScopedCardLessonLines(entry = {}, rooms = [], deps = {}, scope = {}) {
  const allIds = entryCardIds(entry);
  const targetClassKey = scopeClassKey(scope);
  if (!targetClassKey || allIds.length <= 1 || typeof deps.getTtCardById !== "function") return "";

  const scopedIds = scopedCardIdsForEntry(entry, scope, deps);
  if (!scopedIds.length || scopedIds.length === allIds.length) return "";

  const assignments = getRoomAssignments(entry, deps);
  const titlePartsColumns = [];
  const teacherColumns = [];
  const roomColumns = [];

  scopedIds.forEach(cardId => {
    const card = deps.getTtCardById(cardId);
    if (!card) return;
    const parts = cardTitlePartsForExport(card, deps);
    titlePartsColumns.push((parts.ko || parts.en) ? parts : entryTitlePartsForExport({ ...entry, ttcardId: cardId, ttcardIds: [cardId] }, deps));
    const teachers = teacherNamesForCard(card, deps).join(" / ");
    const roomId = clean(assignments?.[cardId] || card.fixedRoomId || card.roomId || "");
    const room = roomNameForId(roomId, rooms, deps);
    teacherColumns.push(teachers);
    roomColumns.push(room || "");
  });

  if (!titlePartsColumns.length) return "";
  const lines = titleLinesForParts(titlePartsColumns);
  if (teacherColumns.some(clean)) lines.push(teacherColumns.join("	"));
  if (roomColumns.some(clean)) lines.push(roomColumns.join("	"));
  return lines.filter(line => clean(line)).join("\n");
}

function buildParallelLessonLines(entry = {}, rooms = [], deps = {}, scope = {}) {
  const scopedCardLines = buildScopedCardLessonLines(entry, rooms, deps, scope);
  if (scopedCardLines) return scopedCardLines;

  const cardIds = entryCardIds(entry);
  const assignments = getRoomAssignments(entry, deps);
  const titlePartsColumns = [];
  const teacherColumns = [];
  const roomColumns = [];

  if (cardIds.length > 1 && typeof deps.getTtCardById === "function") {
    cardIds.forEach(cardId => {
      const card = deps.getTtCardById(cardId);
      const titleParts = cardTitlePartsForExport(card || {}, deps);
      if (titleParts.ko || titleParts.en) titlePartsColumns.push(titleParts);
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

  const titleLines = titlePartsColumns.length > 1
    ? titleLinesForParts(titlePartsColumns)
    : singleTitleLinesForEntry(entry, deps);

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

  if (teachers.length > 1 || roomSource.length > 1 || titlePartsColumns.length > 1) {
    const teacherLine = teachers.join("	");
    const roomLine = roomsByColumn.slice(0, Math.max(teachers.length, roomsByColumn.length)).join("	");
    return [...titleLines, teacherLine, roomLine].filter(line => clean(line)).join("\n");
  }
  return [...titleLines, teachers[0] || "", roomsUnique[0] || ""].filter(line => clean(line)).join("\n");
}

function studentScopedLessonLines(entry = {}, rooms = [], deps = {}, scope = {}, ctx = {}) {
  const matchedIds = studentScopedCardIdsForEntry(entry, scope, deps, ctx);
  if (!matchedIds.length) return "";

  if (matchedIds.length === 1 && matchedIds[0] === "__entry__") {
    return buildParallelLessonLines(entry, rooms, deps, scope);
  }

  const assignments = getRoomAssignments(entry, deps);
  const titlePartsColumns = [];
  const teacherColumns = [];
  const roomColumns = [];

  matchedIds.forEach(cardId => {
    const card = deps.getTtCardById?.(cardId);
    if (!card) return;
    const parts = cardTitlePartsForExport(card, deps);
    titlePartsColumns.push((parts.ko || parts.en) ? parts : entryTitlePartsForExport({ ...entry, ttcardId: cardId, ttcardIds: [cardId] }, deps));
    teacherColumns.push(teacherNamesForCard(card, deps).join(" / "));
    const roomId = clean(assignments?.[cardId] || roomIdForCardExport(cardId, card, entry, rooms, deps));
    roomColumns.push(roomId ? roomNameForId(roomId, rooms, deps) : "");
  });

  if (!titlePartsColumns.length) return "";
  const lines = titleLinesForParts(titlePartsColumns);
  if (teacherColumns.some(clean)) lines.push(teacherColumns.join("	"));
  if (roomColumns.some(clean)) lines.push(roomColumns.join("	"));
  return lines.filter(line => clean(line)).join("\n");
}

function cardMatchesTeacher(card = {}, teacher = "", deps = {}) {
  const target = clean(teacher);
  if (!target || !card) return false;
  return teacherNamesForCard(card, deps).map(clean).includes(target);
}

function teacherRoomForCard(cardId = "", card = {}, entry = {}, rooms = [], deps = {}) {
  const roomId = roomIdForCardExport(cardId, card, entry, rooms, deps);
  return roomId ? roomNameForId(roomId, rooms, deps) : "";
}

function teacherScopedLessonLines(entry = {}, rooms = [], deps = {}, scope = {}) {
  const teacher = clean(scope.key || scope.label || scope.teacher || "");
  if (!teacher) return "";
  const cardIds = entryCardIds(entry);
  const matching = [];

  if (cardIds.length && typeof deps.getTtCardById === "function") {
    cardIds.forEach(cardId => {
      const card = deps.getTtCardById(cardId);
      if (!cardMatchesTeacher(card, teacher, deps)) return;
      const titleParts = cardTitlePartsForExport(card, deps);
      const room = teacherRoomForCard(cardId, card, entry, rooms, deps);
      const classes = classLabelsForCard(card);
      matching.push({ titleParts, room, classes });
    });
  }

  if (!matching.length) {
    const entryTeachers = splitTeacherField(entry.teacherName || entry.teacherNames || "", deps).map(clean);
    if (!entryTeachers.includes(teacher)) return "";
    matching.push({
      titleParts: entryTitlePartsForExport(entry, deps),
      room: roomNamesForEntry(entry, rooms, deps),
      classes: [],
    });
  }

  const classColumns = matching.map(item => {
    if (item.classes?.length) return item.classes.join("/");
    const labels = [];
    try {
      const audience = deps.audienceForPlacement?.(entry);
      labels.push(...toArrayFromSet(audience?.classLabels).filter(Boolean));
    } catch (_) {}
    if (!labels.length && Array.isArray(entry?.audienceClassKeys)) {
      labels.push(...entry.audienceClassKeys.map(classLabelFromKey).filter(Boolean));
    }
    return unique(labels).join("/");
  });
  const roomColumns = matching.map(item => item.room || "교실 없음");
  const primaryColumns = matching.map((item, idx) => unique([roomColumns[idx], classColumns[idx]]).join(" · "));
  const koColumns = matching.map(item => item.titleParts?.ko || item.titleParts?.en || "-");
  const enColumns = matching.map(item => item.titleParts?.en || "");

  const lines = [];
  if (primaryColumns.some(clean)) lines.push(primaryColumns.join("	"));
  if (koColumns.some(clean)) lines.push(koColumns.join("	"));
  if (enColumns.some(clean)) lines.push(enColumns.join("	"));
  return lines.filter(line => clean(line)).join("\n");
}

function roomScopedLessonLines(entry = {}, rooms = [], deps = {}, scope = {}) {
  const room = (rooms || []).find(r => clean(r.id) === clean(scope.key || scope.roomId || scope.id)) || scope;
  const targetRoomId = clean(room?.id || scope.key || "");
  if (!targetRoomId) return "";

  const matchingCards = roomScopedCardsForEntry(entry, room, rooms, deps);
  const matching = [];

  if (matchingCards.length) {
    matchingCards.forEach(({ cardId, card }) => {
      const titleParts = cardTitlePartsForExport(card, deps);
      const teachers = teacherNamesForCard(card, deps).join(" / ");
      const classes = classLabelsForCard(card);
      matching.push({ titleParts, teachers, classes });
    });
  }

  if (!matching.length) {
    // 여러 카드가 묶인 그룹 수업에서 카드별 교실 매칭이 실패했을 때
    // entry 전체 제목을 교실 개별 시간표에 뿌리면 다른 교실 과목까지 섞입니다.
    // 그래서 그룹 entry는 정확히 매칭된 카드가 없으면 표시하지 않습니다.
    if (entryCardIds(entry).length > 1) return "";
    const ids = roomIdsForEntry(entry, rooms, deps);
    if (!ids.includes(targetRoomId)) return "";
    matching.push({
      titleParts: entryTitlePartsForExport(entry, deps),
      teachers: clean(entry.teacherName || (entry.teacherNames || []).join(", ")),
      classes: [],
    });
  }

  const homeLabel = homeRoomLabelForRoom(room, deps);
  const classColumns = matching.map(item => {
    let labels = unique(item.classes || []);
    if (!labels.length) {
      try {
        const audience = deps.audienceForPlacement?.(entry);
        labels = unique(toArrayFromSet(audience?.classLabels).filter(Boolean));
      } catch (_) {}
    }
    if (!labels.length && Array.isArray(entry?.audienceClassKeys)) {
      labels = unique(entry.audienceClassKeys.map(classLabelFromKey).filter(Boolean));
    }
    const label = labels.join("/");
    return label && homeLabel && labels.includes(homeLabel) ? `${label} · Homeroom` : label;
  });
  const teacherColumns = matching.map(item => item.teachers || "교사 없음");
  const primaryColumns = matching.map((item, idx) => unique([classColumns[idx], teacherColumns[idx]]).join(" · "));
  const koColumns = matching.map(item => item.titleParts?.ko || item.titleParts?.en || "-");
  const enColumns = matching.map(item => item.titleParts?.en || "");

  const lines = [];
  if (primaryColumns.some(clean)) lines.push(primaryColumns.join("\t"));
  if (koColumns.some(clean)) lines.push(koColumns.join("\t"));
  if (enColumns.some(clean)) lines.push(enColumns.join("\t"));
  return lines.filter(line => clean(line)).join("\n");
}


function lessonItemFromCard(cardId = "", card = {}, entry = {}, rooms = [], deps = {}, overrides = {}) {
  const parts = cardTitlePartsForExport(card || {}, deps);
  const fallback = entryTitlePartsForExport({ ...entry, ttcardId: cardId, ttcardIds: [cardId] }, deps);
  const titleParts = (parts.ko || parts.en) ? parts : fallback;
  const roomId = clean(overrides.roomId || roomIdForCardExport(cardId, card, entry, rooms, deps));
  const room = roomId ? roomNameForId(roomId, rooms, deps) : "";
  const classes = unique([...(overrides.classes || []), ...classLabelsForCard(card || {})]).filter(Boolean);
  return {
    subject: titleParts.ko || titleParts.en || "-",
    english: titleParts.en || "",
    teacher: clean(overrides.teacher || teacherNamesForCard(card || {}, deps).join(" / ")),
    room,
    class: classes.join(", "),
    period: clean(overrides.period || ""),
  };
}

function lessonItemFromEntry(entry = {}, rooms = [], deps = {}, overrides = {}) {
  const parts = entryTitlePartsForExport(entry, deps);
  let classes = [];
  try {
    const audience = deps.audienceForPlacement?.(entry);
    classes = toArrayFromSet(audience?.classLabels).filter(Boolean);
  } catch (_) {}
  if (!classes.length && Array.isArray(entry?.audienceClassKeys)) {
    classes = entry.audienceClassKeys.map(classLabelFromKey).filter(Boolean);
  }
  return {
    subject: parts.ko || parts.en || clean(entry.subject || entry.title || "-"),
    english: parts.en || "",
    teacher: clean(overrides.teacher || entry.teacherName || (entry.teacherNames || []).join(" / ")),
    room: clean(overrides.room || roomNamesForEntry(entry, rooms, deps)),
    class: clean(overrides.class || unique(classes).join(", ")),
    period: clean(overrides.period || ""),
  };
}

function entryLessonItemsForExport(entry = {}, mode = "normal", scope = {}, rooms = [], deps = {}, rosterCtx = {}, selectedSpecialSubjects = [], periodLabel = "") {
  const period = clean(periodLabel);
  if (mode !== "teacher" && shouldUseRepresentativeOutput(entry, deps, selectedSpecialSubjects)) {
    const represented = representativeLessonLines(entry, mode, scope, rooms, deps, selectedSpecialSubjects);
    if (represented) {
      const lines = String(represented).split(/\n/).map(clean).filter(Boolean);
      return [{ subject: lines[0] || represented, english: "", teacher: "", room: lines.slice(1).join(" · "), class: "", period }];
    }
  }

  if (mode === "class") {
    const ids = scopedCardIdsForEntry(entry, scope, deps);
    if (ids.length && typeof deps.getTtCardById === "function") {
      const items = ids.map(cardId => lessonItemFromCard(cardId, deps.getTtCardById(cardId), entry, rooms, deps, { period }))
        .filter(item => clean(item.subject));
      if (items.length) return items;
    }
    return [lessonItemFromEntry(entry, rooms, deps, { period })];
  }

  if (mode === "teacher") {
    const teacher = clean(scope.key || scope.label || scope.teacher || "");
    const cardIds = entryCardIds(entry);
    const items = [];
    if (teacher && cardIds.length && typeof deps.getTtCardById === "function") {
      cardIds.forEach(cardId => {
        const card = deps.getTtCardById(cardId);
        if (!cardMatchesTeacher(card, teacher, deps)) return;
        const item = lessonItemFromCard(cardId, card, entry, rooms, deps, { period });
        const room = teacherRoomForCard(cardId, card, entry, rooms, deps);
        if (room) item.room = room;
        if (!item.class) item.class = classLabelsForCard(card).join(", ");
        items.push(item);
      });
    }
    if (items.length) return items;
    const directTeachers = splitTeacherField(entry.teacherName || entry.teacherNames || "", deps).map(clean);
    if (!teacher || directTeachers.includes(teacher)) return [lessonItemFromEntry(entry, rooms, deps, { period })];
    return [];
  }

  if (mode === "room") {
    const room = (rooms || []).find(r => clean(r.id) === clean(scope.key || scope.roomId || scope.id)) || scope;
    const matching = roomScopedCardsForEntry(entry, room, rooms, deps);
    if (matching.length) {
      return matching.map(({ cardId, card }) => lessonItemFromCard(cardId, card, entry, rooms, deps, { period }))
        .filter(item => clean(item.subject));
    }
    if (entryCardIds(entry).length > 1) return [];
    const targetRoomId = clean(room?.id || scope.key || "");
    if (targetRoomId && !roomIdsForEntry(entry, rooms, deps).includes(targetRoomId)) return [];
    return [lessonItemFromEntry(entry, rooms, deps, { period })];
  }

  if (mode === "student") {
    const ids = studentScopedCardIdsForEntry(entry, scope, deps, rosterCtx);
    if (!ids.length) return [];
    if (ids.length === 1 && ids[0] === "__entry__") return [lessonItemFromEntry(entry, rooms, deps, { period })];
    const items = ids.map(cardId => lessonItemFromCard(cardId, deps.getTtCardById?.(cardId), entry, rooms, deps, { period }))
      .filter(item => clean(item.subject));
    if (items.length) return items;
    return [lessonItemFromEntry(entry, rooms, deps, { period })];
  }

  return [lessonItemFromEntry(entry, rooms, deps, { period })];
}

function buildExportContext(deps = {}) {
  const rooms = (() => {
    try {
      const direct = deps.getRooms?.();
      if (Array.isArray(direct) && direct.length) return direct;
    } catch (_) {}
    return deps.appState?.rooms?.rooms || [];
  })();
  const periods = getPeriodLabels(deps.ttConfig);
  const entries = deps.entries?.() || [];
  const appState = deps.appState || {};
  const rosterCourseIndex = buildRosterStudentCourseIndex(appState);
  const rosterCtx = {
    rosterByStudent: rosterCourseIndex.templateByStudent,
    rosterRowsByStudent: rosterCourseIndex.byStudent,
  };

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

  const entryClassKeys = entry => {
    const keys = [];
    const audience = deps.audienceForPlacement?.(entry);
    keys.push(...toArrayFromSet(audience?.classKeys).map(key => normalizeClassKey(key)));
    if (Array.isArray(entry?.audienceClassKeys)) keys.push(...entry.audienceClassKeys.map(key => normalizeClassKey(key)));
    entryClassLabels(entry).forEach(label => keys.push(normalizeClassKey(label)));
    return unique(keys.filter(Boolean));
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

  const entryAllowedByScope = (entry, scope) => {
    const normalized = normalizeScopeSelection(scope);
    if (normalized.classKeys.length) {
      const keys = entryClassKeys(entry);
      return keys.length ? keys.some(key => normalized.classKeys.includes(key)) : false;
    }
    return entryAllowedByBands(entry, normalized.bands);
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

  const entryAllowedBySpecial = (entry, specialSubjects = []) => {
    const codes = normalizeSpecialSubjectSelection(specialSubjects);
    if (!codes.length) return true;
    const entryCodes = specialSubjectCodesForEntry(entry, deps);
    return entryCodes.some(code => codes.includes(code));
  };

  const entrySummary = (entry, mode = "normal", scope = {}) => {
    const selectedSpecialSubjects = normalizeSpecialSubjectSelection(scope?.specialSubjects || []);
    if (mode !== "teacher" && shouldUseRepresentativeOutput(entry, deps, selectedSpecialSubjects)) {
      const represented = representativeLessonLines(entry, mode, scope, rooms, deps, selectedSpecialSubjects);
      if (represented) return represented;
    }
    const titleLines = singleTitleLinesForEntry(entry, deps);
    const teacher = clean(entry.teacherName || (entry.teacherNames || []).join(", "));
    const room = roomNamesForEntry(entry, rooms, deps);
    const classes = entryClassLabels(entry).join(", ");
    if (mode === "teacher") return teacherScopedLessonLines(entry, rooms, deps, scope) || [room, classes, ...titleLines].filter(Boolean).join("\n");
    if (mode === "class") return buildParallelLessonLines(entry, rooms, deps, scope);
    if (mode === "room") return roomScopedLessonLines(entry, rooms, deps, scope);
    if (mode === "student") return studentScopedLessonLines(entry, rooms, deps, scope, rosterCtx) || buildParallelLessonLines(entry, rooms, deps, scope);
    return [...titleLines, teacher, classes, room].filter(Boolean).join("\n");
  };

  const entryItems = (entry, mode = "normal", scope = {}, periodLabel = "") => {
    const selectedSpecialSubjects = normalizeSpecialSubjectSelection(scope?.specialSubjects || []);
    return entryLessonItemsForExport(entry, mode, scope, rooms, deps, rosterCtx, selectedSpecialSubjects, periodLabel);
  };

  const teacherMatches = (entry, teacher) => {
    const target = clean(teacher);
    if (!target) return false;
    const directTeachers = splitTeacherField(entry.teacherName || entry.teacherNames || "", deps).map(clean);
    if (directTeachers.includes(target)) return true;
    const cardIds = entryCardIds(entry);
    if (cardIds.length && typeof deps.getTtCardById === "function") {
      return cardIds.some(id => cardMatchesTeacher(deps.getTtCardById(id), target, deps));
    }
    return false;
  };

  const classMatches = (entry, cls) => {
    if (typeof deps.entryMatchesClass === "function" && deps.entryMatchesClass(entry, cls)) return true;
    const key = makeClassKey(cls);
    if (!key) return false;
    const audience = deps.audienceForPlacement?.(entry);
    return toArrayFromSet(audience?.classKeys).includes(key) || (entry.audienceClassKeys || []).includes(key);
  };

  const roomMatches = (entry, room) => {
    const target = clean(room?.id);
    if (!target) return false;
    if (roomIdsForEntry(entry, rooms, deps).includes(target)) return true;
    return roomScopedCardsForEntry(entry, room, rooms, deps).length > 0;
  };

  const studentMatches = (entry, student) => {
    const matchedCardIds = studentScopedCardIdsForEntry(entry, student, deps, rosterCtx);
    if (matchedCardIds.length) return true;

    const rosterSet = studentTemplateSet(student, rosterCtx);
    const tids = entryTemplateIds(entry);
    if (tids.length && rosterSet.size && tids.some(t => rosterSet.has(clean(t)))) return true;

    const audience = deps.audienceForPlacement?.(entry);
    const classKeys = toArrayFromSet(audience?.classKeys).map(normalizeClassKey).filter(Boolean);
    const studentClassKey = scopeClassKey(student);
    if (classKeys.length && studentClassKey && classKeys.includes(studentClassKey)) {
      // 학생별 수강명단이 있으면 수강명단/카드 매칭이 통과한 수업만 표시합니다.
      // 수동 HR처럼 template/card가 없는 entry만 학급 기준 fallback으로 살립니다.
      const entryTemplates = entryTemplateIds(entry);
      const hasStudentRoster = rosterSet.size > 0;
      const hasTemplateOrCard = entryTemplates.length > 0 || entryCardIds(entry).length > 0;
      return !hasStudentRoster || !hasTemplateOrCard;
    }
    return !rosterSet.size && classMatches(entry, student);
  };

  const getGridEntries = (day, period, filterFn) => entries
    .filter(e => e.day === day && e.period === period && filterFn(e))
    .sort((a, b) => String(entryTitleForExport(a, deps) || "").localeCompare(String(entryTitleForExport(b, deps) || ""), "ko"));

  return { rooms, periods, entries, appState, entrySummary, entryItems, teacherMatches, classMatches, roomMatches, studentMatches, getGridEntries, entryAllowedByBands, entryAllowedByScope, entryAllowedBySpecial };
}

function getScopeFromDialog(backdrop) {
  const classKeys = [...backdrop.querySelectorAll('[data-scope-class]:checked')]
    .map(el => normalizeClassKey(el.dataset.scopeClass || ""))
    .filter(Boolean);
  if (classKeys.length) return { bands: ["middle", "high"], classKeys: unique(classKeys) };

  const all = backdrop.querySelector('[data-scope="all"]')?.checked;
  const middle = backdrop.querySelector('[data-scope="middle"]')?.checked;
  const high = backdrop.querySelector('[data-scope="high"]')?.checked;
  const bands = (all || (!middle && !high) || (middle && high))
    ? ["middle", "high"]
    : [middle ? "middle" : "", high ? "high" : ""].filter(Boolean);
  return { bands, classKeys: [] };
}

function getBandsFromDialog(backdrop) {
  return normalizeScopeSelection(getScopeFromDialog(backdrop)).bands;
}

function buildClassScopeOptions(deps = {}) {
  return (deps.getAllClasses?.() || deps.appState?.classes?.classes || [])
    .map(cls => ({ ...cls, key: makeClassKey(cls), label: classLabel(cls), gradeNo: normalizeGradeNumber(cls.gradeKey || cls.grade) }))
    .filter(cls => cls.key && cls.gradeNo >= 7 && cls.gradeNo <= 12)
    .sort((a, b) => a.label.localeCompare(b.label, "ko", { numeric: true }));
}

function buildEntities(type, scope, deps, ctx, filters = {}) {
  const normalizedScope = normalizeScopeSelection(scope);
  const specialSubjects = normalizeSpecialSubjectSelection(filters.specialSubjects || []);
  if (type === "teacher") {
    const teachers = (deps.getAllTimetableTeachers?.() || [])
      .map(clean).filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "ko"));
    return teachers
      .filter(t => ctx.entries.some(e => ctx.teacherMatches(e, t) && ctx.entryAllowedByBands(e, normalizedScope.bands)))
      .map(t => ({ type, key: t, label: t, mode: "teacher", groupLabel: "교사", specialSubjects, filterFn: e => ctx.teacherMatches(e, t) && ctx.entryAllowedByBands(e, normalizedScope.bands) }));
  }
  if (type === "class") {
    const classes = (deps.getAllClasses?.() || [])
      .map(cls => ({ ...cls, label: classLabel(cls), key: makeClassKey(cls), gradeNo: normalizeGradeNumber(cls.gradeKey || cls.grade) }))
      .filter(cls => cls.key && classAllowedByScope(cls, normalizedScope))
      .sort((a, b) => a.label.localeCompare(b.label, "ko", { numeric: true }));
    return classes
      .filter(cls => ctx.entries.some(e => ctx.classMatches(e, cls)))
      .map(cls => ({ type, key: cls.key, label: cls.label, mode: "class", specialSubjects, groupLabel: gradeBandOf(cls.gradeNo) === "middle" ? "중등" : "고등", filterFn: e => ctx.classMatches(e, cls) }));
  }
  if (type === "room") {
    return (ctx.rooms || [])
      .filter(room => clean(room.id || room.name))
      .filter(room => {
        const scheduled = ctx.entries.some(e => ctx.roomMatches(e, room) && ctx.entryAllowedByScope(e, normalizedScope));
        if (scheduled) return true;
        const home = homeRoomLabelForRoom(room, deps);
        const grade = normalizeGradeNumber(home);
        return !!home && classAllowedByScope({ gradeKey: grade, section: clean(home).replace(/\d{1,2}/, "") }, normalizedScope);
      })
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), "ko", { numeric: true }))
      .map(room => {
        const roomLabel = roomLabelForExport(room, deps);
        const homeLabel = homeRoomLabelForRoom(room, deps);
        return {
          type,
          key: room.id || room.name,
          label: homeLabel ? `${roomLabel} (${homeLabel})` : roomLabel,
          subtitle: "",
          mode: "room",
          specialSubjects,
          groupLabel: room.type || "교실",
          filterFn: e => ctx.roomMatches(e, room) && ctx.entryAllowedByScope(e, normalizedScope)
        };
      });
  }
  if (type === "student") {
    return buildStudentList(deps.appState)
      .filter(s => classAllowedByScope({ gradeKey: s.gradeKey, section: s.section, sectionIdx: s.sectionIdx }, normalizedScope))
      .filter(s => ctx.entries.some(e => ctx.studentMatches(e, s) && ctx.entryAllowedByScope(e, normalizedScope)))
      .map(s => ({ ...s, type, mode: "student", specialSubjects, groupLabel: s.classLabel, filterFn: e => ctx.studentMatches(e, s) && ctx.entryAllowedByScope(e, normalizedScope) }));
  }
  return [];
}

function buildGridData(entity, ctx) {
  const data = [["", ...DAYS]];
  ctx.periods.forEach((label, period) => {
    const row = [label];
    DAYS.forEach((_, day) => {
      const text = ctx.getGridEntries(day, period, entity.filterFn)
        .map(e => ctx.entrySummary(e, entity.mode, entity))
        .join("\n\n");
      row.push(text);
    });
    data.push(row);
  });
  return data;
}

function buildCombinedGridData(entities, ctx) {
  const data = [["대상", "", ...DAYS]];
  entities.forEach(entity => {
    ctx.periods.forEach((label, period) => {
      const row = [entity.label, label];
      DAYS.forEach((_, day) => {
        row.push(ctx.getGridEntries(day, period, entity.filterFn).map(e => ctx.entrySummary(e, entity.mode, entity)).join("\n\n"));
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
  return Math.max(fallback, Math.min(132, 13 * maxLines + 10));
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
      cell.s = { ...(cell.s || {}), alignment: { ...(cell.s?.alignment || {}), wrapText: true, shrinkToFit: true, horizontal: "center", vertical: "center" } };
    }
  }
}

function exportXlsx(entities, deps, ctx, { layout, type, scope, bands, specialSubjects }) {
  const activeScope = scope || bands || ["middle", "high"];
  specialSubjects = normalizeSpecialSubjectSelection(specialSubjects || []);
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
    ws["!rows"] = data.map((row, idx) => ({ hpt: idx === 0 ? 22 : 54 }));
    XLSX.utils.book_append_sheet(wb, ws, makeSheetName(`${scopeLabel(activeScope)}_${specialSubjectLabel(specialSubjects)}_전체표`, used));
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
        data.push([entityTimetableTitle(student, "student")]);
        data.push(...buildGridData(student, ctx));
      });
      const ws = XLSX.utils.aoa_to_sheet(data);
      applyWorksheetWrap(ws, XLSX);
      ws["!cols"] = [{ wch: 6 }, ...DAYS.map(() => ({ wch: 38 }))];
      ws["!rows"] = data.map((row) => ({ hpt: row.length === 1 ? 22 : 54 }));
      XLSX.utils.book_append_sheet(wb, ws, makeSheetName(className, used));
    });
  } else {
    entities.forEach(entity => {
      const data = buildGridData(entity, ctx);
      const ws = XLSX.utils.aoa_to_sheet(data);
      applyWorksheetWrap(ws, XLSX);
      ws["!cols"] = [{ wch: 6 }, ...DAYS.map(() => ({ wch: 38 }))];
      ws["!rows"] = data.map((row, idx) => ({ hpt: idx === 0 ? 22 : 54 }));
      XLSX.utils.book_append_sheet(wb, ws, makeSheetName(entity.label, used));
    });
  }

  const filename = `${type === "teacher" ? "교사" : type === "class" ? "학급" : type === "room" ? "교실" : "학생"}_${scopeLabel(activeScope)}_${specialSubjectLabel(specialSubjects)}_${layout === "combined" ? "전체표" : "개별"}_시간표.xlsx`;
  XLSX.writeFile(wb, safeFileName(filename));
}

function looksLikeEnglishSubjectLine(line = "") {
  const raw = clean(line);
  if (!raw) return false;
  if (!/[A-Za-z]/.test(raw) || /[가-힣]/.test(raw)) return false;
  const cells = raw.split("	").map(clean).filter(Boolean);
  const codeLike = value => {
    const v = clean(value);
    return /^\d{1,2}[A-Z]$/i.test(v) ||
      /^[A-Z]{1,4}\d{2,4}(?:[-_][A-Za-z0-9]+)?$/i.test(v) ||
      /^M?H\d{2,4}$/i.test(v) || /^V?H\d{2,4}$/i.test(v) || /^T?H\d{2,4}$/i.test(v) ||
      /^HR\d*$/i.test(v);
  };
  // 교실 코드(MH501, VH304), 학반 코드(8A), HR 등은 영어 과목명이 아니므로 작게 처리하지 않습니다.
  if (cells.length && cells.every(codeLike)) return false;
  return true;
}

function lessonDensityClass(lines = []) {
  const totalLength = lines.join(" ").replace(/\s+/g, " ").length;
  const lineCount = lines.length;
  if (lineCount >= 10 || totalLength >= 210) return " lesson-micro";
  if (lineCount >= 8 || totalLength >= 165) return " lesson-compact";
  if (lineCount >= 6 || totalLength >= 115) return " lesson-dense";
  return "";
}

function entityTimetableTitle(entity = {}, type = "") {
  if (type === "student") {
    const name = clean(entity.name || entity.studentName || entity.label).replace(/\s*\([^)]*\)\s*$/u, "");
    return `${[entity.classLabel, name].map(clean).filter(Boolean).join(" ")} Timetable`;
  }
  return `${clean(entity.label) || "Timetable"} Timetable`;
}

function lessonHtml(text) {
  if (!text) return "";
  const lines = String(text).replace(/\r/g, "").split(/\n/).filter(line => clean(line));
  const hasParallel = lines.some(line => line.includes("\t"));
  const body = lines.map((line, idx) => {
    const rawParts = line.split("\t").map(clean);
    const isParallel = rawParts.length > 1;
    const englishLine = idx > 0 && looksLikeEnglishSubjectLine(line);
    if (isParallel) {
      const extra = idx === 0 ? " lesson-parallel-title" : englishLine ? " lesson-parallel-en" : "";
      return `<div class="lesson-parallel${extra}">${rawParts.map(part => `<span>${escapeHtml(part || " ")}</span>`).join("")}</div>`;
    }
    const cls = idx === 0 ? "lesson-title" : englishLine ? "lesson-subtitle" : "lesson-line";
    return `<div class="${cls}">${escapeHtml(clean(line))}</div>`;
  }).join("");
  return `<div class="lesson${hasParallel ? " lesson-has-parallel" : ""}${lessonDensityClass(lines)}" data-fit="1">${body}</div>`;
}

function printFieldValue(item = {}, key = "") {
  if (key === "subject") return clean(item.subject);
  if (key === "english") return clean(item.english);
  if (key === "teacher") return clean(item.teacher);
  if (key === "room") return clean(item.room);
  if (key === "class") return clean(item.class);
  if (key === "period") return clean(item.period);
  return "";
}

function lessonCardHtml(item = {}, settings = {}) {
  const normalized = normalizePrintSettings(settings);
  const buckets = Object.fromEntries(PRINT_POSITIONS.map(([pos]) => [pos, []]));
  PRINT_FIELD_DEFS.forEach(def => {
    const field = normalized.fields[def.key];
    if (!field?.enabled) return;
    const value = printFieldValue(item, def.key);
    if (!value) return;
    const cls = ["lesson-card-field", `field-${def.key}`, field.bold ? "is-bold" : ""].filter(Boolean).join(" ");
    const label = def.key === "period" ? `<span class="field-caption">${escapeHtml(def.label)}</span>` : "";
    buckets[field.pos || def.defaultPos]?.push(`<span class="${cls}">${label}${escapeHtml(value)}</span>`);
  });
  const positions = PRINT_POSITIONS.map(([pos]) => {
    const html = buckets[pos]?.join("") || "";
    return html ? `<div class="lesson-pos lesson-pos-${pos}">${html}</div>` : "";
  }).join("");
  const fallback = escapeHtml(clean(item.subject || item.english || item.teacher || item.room || "-"));
  return `<div class="lesson-card-mini">${positions || `<div class="lesson-pos lesson-pos-mc"><span class="lesson-card-field is-bold">${fallback}</span></div>`}</div>`;
}

function lessonCardsHtml(items = [], settings = {}) {
  const normalized = normalizePrintSettings(settings);
  const realItems = (items || []).filter(item => item && Object.values(item).some(clean));
  if (!realItems.length) return "";
  const countClass = `count-${Math.min(4, realItems.length)}`;
  const layoutClass = normalized.cellLayout === "auto"
    ? (realItems.length >= 3 ? "layout-grid" : realItems.length === 2 ? "layout-columns" : "layout-single")
    : `layout-${normalized.cellLayout}`;
  return `<div class="lesson-card-grid ${countClass} ${layoutClass} font-${normalized.fontScale}" data-fit="1">${realItems.map(item => lessonCardHtml(item, normalized)).join("")}</div>`;
}

function cellHtmlForPrint(entries = [], ctx = {}, entity = {}, periodLabel = "", printSettings = {}) {
  const settings = normalizePrintSettings(printSettings);
  if (settings.renderMode === "legacy") {
    return entries.map(e => lessonHtml(ctx.entrySummary(e, entity.mode, entity))).join("");
  }
  const itemGroups = entries.map(e => {
    const items = ctx.entryItems?.(e, entity.mode, entity, periodLabel) || [];
    return items.length ? items : [lessonItemFromEntry(e, ctx.rooms, {}, { period: periodLabel })];
  }).filter(group => group.length);
  if (!itemGroups.length) return "";
  if (settings.applyMode === "cell") {
    return lessonCardsHtml(itemGroups.flat(), settings);
  }
  return itemGroups.map(group => lessonCardsHtml(group, settings)).join("");
}

function buildIndividualSections(entities, ctx, type, printSettings = {}) {
  let lastGroup = "";
  return entities.map(entity => {
    const groupHeader = type === "student" && entity.groupLabel !== lastGroup
      ? `<h2 class="class-break">${escapeHtml(entity.groupLabel)} Student Timetable</h2>`
      : "";
    lastGroup = entity.groupLabel;
    const rows = ctx.periods.map((label, period) => {
      const tds = DAYS.map((_, day) => {
        const cellEntries = ctx.getGridEntries(day, period, entity.filterFn);
        const html = cellHtmlForPrint(cellEntries, ctx, entity, label, printSettings);
        return `<td${html ? "" : " class='empty'"}>${html}</td>`;
      }).join("");
      return `<tr><th class="period-head">${escapeHtml(label)}</th>${tds}</tr>`;
    }).join("");
    const colgroup = `<colgroup><col class="period-col">${DAYS.map(() => `<col>`).join("")}</colgroup>`;
    const subtitle = entity.subtitle ? `<div class="section-meta">${escapeHtml(entity.subtitle)}</div>` : "";
    return `${groupHeader}<section class="print-section"><h1>${escapeHtml(entityTimetableTitle(entity, type))}</h1>${subtitle}<table>${colgroup}<thead><tr><th class="corner-head"></th>${DAYS.map(d => `<th>${d}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join("\n");
}

function buildCombinedSection(entities, ctx, title, printSettings = {}) {
  const rows = entities.map(entity => {
    return ctx.periods.map((label, period) => {
      const tds = DAYS.map((_, day) => {
        const cellEntries = ctx.getGridEntries(day, period, entity.filterFn);
        const html = cellHtmlForPrint(cellEntries, ctx, entity, label, printSettings);
        return `<td${html ? "" : " class='empty'"}>${html}</td>`;
      }).join("");
      return `<tr><th class="entity">${escapeHtml(entity.label)}</th><th class="period-head">${escapeHtml(label)}</th>${tds}</tr>`;
    }).join("");
  }).join("\n");
  const colgroup = `<colgroup><col class="entity-col"><col class="period-col">${DAYS.map(() => `<col>`).join("")}</colgroup>`;
  return `<section class="print-section combined"><h1>${escapeHtml(title)}</h1><table>${colgroup}<thead><tr><th>대상</th><th></th>${DAYS.map(d => `<th>${d}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></section>`;
}


function buildClassOverviewCombinedSection(entities, ctx, title, printSettings = {}) {
  const dayHeader = DAYS.map(day => `<th class="day-head" colspan="${ctx.periods.length}">${escapeHtml(day)}</th>`).join("");
  const periodHeader = DAYS.map(() => ctx.periods.map(label => `<th class="period-head">${escapeHtml(label)}</th>`).join("")).join("");
  const colgroup = `<colgroup><col class="class-col">${DAYS.map(() => ctx.periods.map(() => `<col class="lesson-col">`).join("")).join("")}</colgroup>`;
  const rows = entities.map(entity => {
    const cells = DAYS.map((_, day) => ctx.periods.map((label, period) => {
      const cellEntries = ctx.getGridEntries(day, period, entity.filterFn);
      const html = cellHtmlForPrint(cellEntries, ctx, entity, label, printSettings);
      return `<td${html ? "" : " class='empty'"}>${html}</td>`;
    }).join("")).join("");
    return `<tr><th class="class-name">${escapeHtml(entity.label)}</th>${cells}</tr>`;
  }).join("\n");
  return `<section class="print-section class-overview"><h1>${escapeHtml(title)}</h1><table>${colgroup}<thead><tr><th class="corner" rowspan="2">Class</th>${dayHeader}</tr><tr>${periodHeader}</tr></thead><tbody>${rows}</tbody></table></section>`;
}

function buildPrintHtml(entities, ctx, { layout, type, scope, bands, specialSubjects, printSettings }) {
  const activeScope = scope || bands || ["middle", "high"];
  specialSubjects = normalizeSpecialSubjectSelection(specialSubjects || []);
  printSettings = normalizePrintSettings(printSettings || {});
  const now = new Date();
  const titleType = type === "teacher" ? "교사" : type === "class" ? "학급" : type === "room" ? "교실" : "학생";
  const specialLabelText = specialSubjects?.length ? ` ${specialSubjectLabel(specialSubjects)}` : "";
  const title = `${titleType} ${scopeLabel(activeScope)}${specialLabelText} ${layout === "combined" ? "전체표" : "개별"} Timetable`;
  const sections = layout === "combined"
    ? (type === "class" ? buildClassOverviewCombinedSection(entities, ctx, title, printSettings) : buildCombinedSection(entities, ctx, title, printSettings))
    : buildIndividualSections(entities, ctx, type, printSettings);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page{size:A4 landscape;margin:5mm}*{box-sizing:border-box}html,body{background:#fff}body{margin:12px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827}.print-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px;padding:8px 10px;border:1px solid #d1d5db;border-radius:10px;background:#f9fafb}.print-toolbar strong{font-size:14px}.print-toolbar span{font-size:12px;color:#6b7280}.print-toolbar button{height:32px;padding:0 14px;border:1px solid #1d4ed8;border-radius:8px;background:#2563eb;color:#fff;font-weight:800;cursor:pointer}.print-section{page-break-after:always;margin-bottom:20px}.print-section:last-child{page-break-after:auto}.class-break{page-break-before:always;margin:0 0 6px;padding:5px 8px;border:1px solid #d1d5db;background:#fff;color:#111827;font-size:15px;text-align:center}h1{margin:0 0 3px;font-size:20px;text-align:center;line-height:1.12}.section-meta{margin:-1px 0 5px;text-align:center;font-size:11px;font-weight:800;color:#374151}table{width:100%;border-collapse:collapse;table-layout:fixed;border:2px solid #374151}col.period-col{width:30px}col.entity-col{width:82px}th,td{border:1px solid #9ca3af;padding:2px;text-align:center;vertical-align:middle;word-break:keep-all;overflow-wrap:anywhere}th{background:#f3f4f6;color:#111827;font-size:12px;font-weight:800}tbody tr{height:80px}tbody th.period-head{background:#f9fafb;color:#111827;font-size:12px;font-weight:900}.combined tbody th.entity{background:#f3f4f6;color:#111827;font-size:11px;font-weight:900}.class-overview table{border:2px solid #111827}.class-overview .class-col{width:48px}.class-overview .lesson-col{width:auto}.class-overview th.day-head{font-size:12px;background:#fff;border-left:2px solid #374151;border-right:2px solid #374151}.class-overview thead tr:nth-child(2) th{font-size:9px;padding:1px;background:#f9fafb}.class-overview th.class-name{font-size:13px;background:#fff;border-right:2px solid #374151}.class-overview td{height:62px;padding:1px;font-size:6.5px;line-height:1.02}.class-overview td:nth-child(8n+2){border-left:2px solid #374151}.class-overview .lesson+.lesson{margin-top:1px;padding-top:1px}.class-overview .lesson-title,.class-overview .lesson-parallel-title span{font-size:1.05em;font-weight:900}.class-overview .lesson-subtitle,.class-overview .lesson-parallel-en{display:none}.class-overview .lesson-line,.class-overview .lesson-parallel span{font-size:.9em}.class-overview .lesson-micro,.class-overview .lesson-compact,.class-overview .lesson-dense{font-size:1em}td{height:80px;font-size:10px;line-height:1.12;overflow:hidden}.empty{background:#fff}.lesson{width:100%;margin:0;padding:0;background:transparent;border:0;border-radius:0;line-height:1.12;text-align:center}.lesson+.lesson{margin-top:2px;padding-top:2px;border-top:1px dotted #cbd5e1}.lesson-title{font-weight:900;font-size:1.08em;margin:0;text-align:center}.lesson-subtitle{margin:0;text-align:center;color:#4b5563;font-size:.82em;line-height:1.05}.lesson-line{margin:0;text-align:center;color:#374151;font-size:.92em}.lesson-parallel{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:0;margin-top:0;align-items:stretch}.lesson-parallel span{display:block;text-align:center;min-width:0;overflow-wrap:anywhere;color:#374151;padding:0 2px}.lesson-parallel span+span{border-left:1px dashed #cbd5e1}.lesson-parallel-title span{font-weight:900;color:#111827;font-size:1.08em}.lesson-parallel-en span{color:#4b5563;font-size:.82em;line-height:1.05}.lesson-dense{font-size:.96em}.lesson-compact{font-size:.9em}.lesson-micro{font-size:.84em}.lesson-card-grid{width:100%;height:100%;display:grid;gap:1.5px}.lesson-card-grid+.lesson-card-grid{margin-top:2px}.lesson-card-grid.layout-single{grid-template-columns:1fr}.lesson-card-grid.layout-columns{grid-template-columns:repeat(2,minmax(0,1fr))}.lesson-card-grid.layout-vertical{grid-template-columns:1fr}.lesson-card-grid.layout-grid{grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:minmax(0,1fr)}.lesson-card-mini{position:relative;min-height:0;height:100%;border:1px solid #cbd5e1;border-radius:3px;background:#fff;overflow:hidden;padding:1px}.lesson-pos{position:absolute;display:flex;flex-direction:column;gap:0;max-width:100%;line-height:1.05}.lesson-pos-tl{top:1px;left:2px;text-align:left;align-items:flex-start}.lesson-pos-tc{top:1px;left:50%;transform:translateX(-50%);text-align:center;align-items:center}.lesson-pos-tr{top:1px;right:2px;text-align:right;align-items:flex-end}.lesson-pos-ml{top:50%;left:2px;transform:translateY(-50%);text-align:left;align-items:flex-start}.lesson-pos-mc{top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;align-items:center;width:96%}.lesson-pos-mr{top:50%;right:2px;transform:translateY(-50%);text-align:right;align-items:flex-end}.lesson-pos-bl{bottom:1px;left:2px;text-align:left;align-items:flex-start}.lesson-pos-bc{bottom:1px;left:50%;transform:translateX(-50%);text-align:center;align-items:center;width:96%}.lesson-pos-br{bottom:1px;right:2px;text-align:right;align-items:flex-end}.lesson-card-field{display:block;white-space:normal;overflow-wrap:anywhere;color:#334155;font-size:.82em}.lesson-card-field.is-bold{font-weight:900;color:#111827}.field-subject{font-size:1.08em}.field-english{font-size:.72em;color:#64748b}.field-room{font-size:.78em}.field-class,.field-period{font-size:.72em;color:#475569}.field-caption{display:none}.font-small .lesson-card-field{font-size:.74em}.font-small .field-subject{font-size:.98em}.font-large .lesson-card-field{font-size:.9em}.font-large .field-subject{font-size:1.16em}.class-overview .lesson-card-grid{gap:.5px}.class-overview .lesson-card-mini{border-width:.6px;border-radius:1px}.class-overview .lesson-card-field{font-size:.65em}.class-overview .field-subject{font-size:.82em}.class-overview .field-english{display:none}@media print{body{margin:0}.print-toolbar{display:none}.print-section{margin:0;page-break-after:always}.print-section:last-child{page-break-after:auto}h1{font-size:16px;margin-bottom:1mm}.section-meta{font-size:9.5px;margin:-.5mm 0 1mm}table{border-width:1.6px}th,td{padding:1.2px 2px}th{font-size:11px}tbody tr{height:25.2mm}td{height:25.2mm;font-size:9.3px}.lesson-title{font-size:1.08em}.lesson-subtitle{font-size:.8em}.lesson-line,.lesson-parallel span{font-size:.92em}.lesson-parallel-title span{font-size:1.08em}.lesson-parallel-en span{font-size:.8em}.combined th,.combined td{font-size:8.2px}.combined tbody tr,.combined td{height:18.5mm}.class-overview h1{font-size:15px;margin-bottom:1.5mm}.class-overview th.day-head{font-size:10px;padding:.8px}.class-overview thead tr:nth-child(2) th{font-size:7.2px;padding:.5px}.class-overview th.class-name{font-size:11px}.class-overview td{height:15.2mm;font-size:5.4px;padding:.7px;line-height:1.0}.class-overview .lesson-line,.class-overview .lesson-parallel span{font-size:.88em}.lesson-card-grid{gap:1px}.lesson-card-mini{border-width:.7px}.combined .lesson-card-field{font-size:.72em}.combined .field-subject{font-size:.9em}.class-overview .lesson-card-field{font-size:.54em}.class-overview .field-subject{font-size:.72em}col.period-col{width:25px}col.entity-col{width:72px}}
  </style></head><body><div class="print-toolbar"><div><strong>${escapeHtml(title)}</strong><br><span>${escapeHtml(now.toLocaleString("ko-KR"))} · 인쇄 창에서 “PDF로 저장”을 선택하세요.</span></div><button onclick="fitAllTimetableCells();window.print()">PDF 저장/인쇄</button></div>${sections}<script>
function fitAllTimetableCells(){
  document.querySelectorAll("td:not(.empty)").forEach(td=>{
    let size=parseFloat(getComputedStyle(td).fontSize)||9;
    const min=6.7;
    for(let i=0;i<14 && size>min;i+=1){
      if(td.scrollHeight<=td.clientHeight+1 && td.scrollWidth<=td.clientWidth+1) break;
      size-=0.25;
      td.style.fontSize=size+"px";
    }
  });
}
window.addEventListener("load",()=>{fitAllTimetableCells();setTimeout(fitAllTimetableCells,120);setTimeout(()=>window.focus(),100);});
window.addEventListener("beforeprint",fitAllTimetableCells);
</script></body></html>`;
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
          <section class="tt-print-settings" data-role="print-settings">
            <div class="tt-print-settings-head">
              <strong>PDF 출력 카드 설정</strong>
              <div class="tt-print-presets">
                <button type="button" data-print-preset="simple">간단</button>
                <button type="button" data-print-preset="basic">기본</button>
                <button type="button" data-print-preset="detail">상세</button>
              </div>
            </div>
            <div class="tt-print-settings-grid">
              <label><span>출력 스타일</span><select data-print-render-mode><option value="cards">카드 위치 설정</option><option value="legacy">기존 줄 출력</option></select></label>
              <label><span>한 셀 다중과목</span><select data-print-cell-layout><option value="auto">자동: 1/2/4분할</option><option value="grid">2×2 고정</option><option value="columns">가로 분할</option><option value="vertical">세로 분할</option></select></label>
              <label><span>적용 범위</span><select data-print-apply-mode><option value="card">카드별 적용</option><option value="cell">셀 전체 적용</option></select></label>
              <label><span>글자 크기</span><select data-print-font-scale><option value="small">작게</option><option value="normal">기본</option><option value="large">크게</option></select></label>
            </div>
            <div class="tt-print-fields">
              ${PRINT_FIELD_DEFS.map(def => `<div class="tt-print-field">
                <input type="checkbox" data-print-field-enabled="${escapeHtml(def.key)}" ${def.key === "period" ? "" : "checked"}>
                <b>${escapeHtml(def.label)}</b>
                <label class="bold-label"><input type="checkbox" data-print-field-bold="${escapeHtml(def.key)}" ${def.defaultBold ? "checked" : ""}>굵게</label>
                <select data-print-field-pos="${escapeHtml(def.key)}">${PRINT_POSITIONS.map(([pos,label]) => `<option value="${escapeHtml(pos)}" ${pos === def.defaultPos ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>
              </div>`).join("")}
            </div>
            <div class="tt-print-hint">적용 범위가 <b>카드별 적용</b>이면 한 셀에 1~4개 과목이 있어도 각 과목 카드마다 과목·교사·교실 위치 설정을 따로 적용합니다. <b>셀 전체 적용</b>은 한 셀 안의 모든 과목을 한 묶음으로 나누어 표시합니다.</div>
          </section>
        </div>
        <aside class="tt-export-scope">
          <h4>출력 범위</h4>
          <label><input type="checkbox" data-scope="all" checked> 전체</label>
          <label><input type="checkbox" data-scope="middle"> 중등 7–9학년</label>
          <label><input type="checkbox" data-scope="high"> 고등 10–12학년</label>
          <div class="tt-export-class-scopes" data-role="class-scopes"></div>
        </aside>
      </div>
      <div class="tt-export-special-scopes" data-role="special-scopes">
        <div class="tt-export-special-panel">
          <span class="tt-export-special-title">간략 출력 과목 선택</span>
          <div class="tt-export-special-list" data-role="special-list"></div>
          <p>전체 시간표는 그대로 출력하고, 여기서 체크한 과목/그룹만 셀 안에서 세부 과목·교사·교실 나열 없이 간략 표시합니다. CA/SA도 체크한 경우에만 간략 표시됩니다.</p>
        </div>
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
  const printSettingsPanel = backdrop.querySelector('[data-role="print-settings"]');
  const printSettingInputs = () => [...backdrop.querySelectorAll('[data-print-render-mode],[data-print-cell-layout],[data-print-apply-mode],[data-print-font-scale],[data-print-field-enabled],[data-print-field-bold],[data-print-field-pos]')];
  const allEl = backdrop.querySelector('[data-scope="all"]');
  const middleEl = backdrop.querySelector('[data-scope="middle"]');
  const highEl = backdrop.querySelector('[data-scope="high"]');
  const classScopeBox = backdrop.querySelector('[data-role="class-scopes"]');
  const classScopeItems = buildClassScopeOptions(deps);
  if (classScopeBox) {
    classScopeBox.innerHTML = classScopeItems.map(cls => `
      <label title="${escapeHtml(cls.label)}"><input type="checkbox" data-scope-class="${escapeHtml(cls.key)}"> ${escapeHtml(cls.label)}</label>
    `).join("");
  }
  const classScopeInputs = () => [...backdrop.querySelectorAll('[data-scope-class]')];
  const specialListEl = backdrop.querySelector('[data-role="special-list"]');
  const renderSpecialSubjectOptions = () => {
    const options = buildSpecialSubjectOptions(deps, ctx);
    specialListEl.innerHTML = options.map(opt => {
      return `<label><input type="checkbox" data-special-subject="${escapeHtml(opt.label)}"> ${escapeHtml(opt.label)}</label>`;
    }).join("") || `<div style="font-size:12px;color:#64748b;line-height:1.4">현재 시간표에서 선택할 교과/그룹을 찾지 못했습니다.</div>`;
  };
  renderSpecialSubjectOptions();

  const specialInputs = () => [...backdrop.querySelectorAll('[data-special-subject]')];
  const specialSubjectSelection = () => getSpecialSubjectsFromDialog(backdrop);

  function syncScope(changed) {
    const isClassScope = changed?.hasAttribute?.("data-scope-class");
    if (changed === allEl && allEl.checked) {
      middleEl.checked = false;
      highEl.checked = false;
      classScopeInputs().forEach(el => { el.checked = false; });
    }
    if ((changed === middleEl || changed === highEl) && (middleEl.checked || highEl.checked)) {
      allEl.checked = false;
      classScopeInputs().forEach(el => { el.checked = false; });
    }
    if (isClassScope && changed.checked) {
      allEl.checked = false;
      middleEl.checked = false;
      highEl.checked = false;
    }
    const hasClassScope = classScopeInputs().some(el => el.checked);
    if (!allEl.checked && !middleEl.checked && !highEl.checked && !hasClassScope) allEl.checked = true;
  }

  function visibleScopeForType() {
    const scope = getScopeFromDialog(backdrop);
    if (typeEl.value === "teacher") return { bands: normalizeScopeSelection(scope).bands, classKeys: [] };
    return scope;
  }

  function updateScopeAvailability() {
    if (!classScopeBox) return;
    const disabled = typeEl.value === "teacher";
    classScopeBox.classList.toggle("is-disabled", disabled);
    classScopeInputs().forEach(el => { el.disabled = disabled; });
  }

  function updatePrintSettingsVisibility() {
    printSettingsPanel?.classList.toggle("is-hidden", formatEl.value !== "pdf");
  }

  function currentEntities() {
    return buildEntities(typeEl.value, visibleScopeForType(), deps, ctx, { specialSubjects: specialSubjectSelection() });
  }

  function refresh() {
    updateScopeAvailability();
    updatePrintSettingsVisibility();
    const scope = visibleScopeForType();
    const entities = currentEntities();
    const specialSubjects = specialSubjectSelection();
    const printSettings = getPrintSettingsFromDialog(backdrop);
    const typeName = typeEl.value === "teacher" ? "교사" : typeEl.value === "class" ? "학급" : typeEl.value === "room" ? "교실" : "학생";
    const layoutName = layoutEl.value === "combined" ? "전체표" : "개별";
    const studentNote = typeEl.value === "student" && layoutEl.value === "individual" ? " 학생은 이름을 하나씩 고르지 않고 학급별로 묶어 한 번에 출력합니다." : "";
    const teacherNote = typeEl.value === "teacher" ? " 교사 출력에는 학반별 체크 범위를 적용하지 않습니다." : "";
    const formatNote = formatEl.value === "pdf" ? ` · PDF ${printSettingsSummary(printSettings)}` : "";
    infoEl.textContent = `${typeName} · ${scopeLabel(scope)} · ${layoutName} · ${specialSubjectLabel(specialSubjects)}${formatNote} 표시입니다.${studentNote}${teacherNote}`;
    const previewItems = entities.slice(0, 18).map(e => e.label).join(" · ");
    previewEl.innerHTML = `<b>출력 대상 ${entities.length}개</b><br>${escapeHtml(previewItems || "대상 없음")}${entities.length > 18 ? ` · 외 ${entities.length - 18}개` : ""}`;
  }

  [typeEl, layoutEl, formatEl].forEach(el => el.addEventListener("change", refresh));
  [allEl, middleEl, highEl, ...classScopeInputs()].forEach(el => el.addEventListener("change", () => { syncScope(el); refresh(); }));
  specialInputs().forEach(el => el.addEventListener("change", refresh));
  printSettingInputs().forEach(el => el.addEventListener("change", refresh));
  backdrop.querySelectorAll('[data-print-preset]').forEach(btn => btn.addEventListener("click", () => { applyPrintPreset(backdrop, btn.dataset.printPreset || "basic"); refresh(); }));
  backdrop.querySelector(".tt-export-run")?.addEventListener("click", () => {
    const scope = visibleScopeForType();
    const specialSubjects = specialSubjectSelection();
    const entities = buildEntities(typeEl.value, scope, deps, ctx, { specialSubjects });
    const printSettings = getPrintSettingsFromDialog(backdrop);
    const options = { layout: layoutEl.value, type: typeEl.value, scope, specialSubjects, printSettings };
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
