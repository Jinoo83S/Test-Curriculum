// ================================================================
// timetable-export.js · Timetable print/export tools
// ================================================================

const DAYS = ["월", "화", "수", "목", "금"];

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
  return clean(gradeKey).replace(/학년/g, "").trim();
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

function toArrayFromSet(value) {
  if (!value) return [];
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return value;
  return [];
}

function buildStudentList(appState = {}) {
  const classes = appState.classes?.classes || [];
  return classes.flatMap(cls => (cls.students || []).map(stu => {
    const gradeKey = cls.grade;
    const section = cls.name;
    return {
      key: `${cls.id}:${stu.id}`,
      studentId: stu.id,
      classId: cls.id,
      name: stu.name,
      gradeKey,
      section,
      sectionIdx: Math.max(0, String(section || "A").toUpperCase().charCodeAt(0) - 65),
      label: `${stu.name} (${classLabel({ gradeKey, section })})`,
      classKey: makeClassKey({ gradeKey, section })
    };
  })).sort((a, b) => {
    const g = Number(normalizeGradeNumber(a.gradeKey)) - Number(normalizeGradeNumber(b.gradeKey));
    if (g) return g;
    const s = String(a.section).localeCompare(String(b.section), "ko", { numeric: true });
    if (s) return s;
    return String(a.name).localeCompare(String(b.name), "ko");
  });
}

function getPeriodLabels(ttConfig) {
  const labels = ttConfig?.()?.periodLabels || [];
  const count = Math.max(1, labels.length || 7);
  return Array.from({ length: count }, (_, i) => labels[i] || `${i + 1}교시`);
}

function roomDisplayName(entry, rooms = []) {
  if (!entry?.roomId) return "교실 없음";
  return rooms.find(r => r.id === entry.roomId)?.name || entry.roomId;
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

function downloadBlob(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildExportContext(deps = {}) {
  const rooms = deps.getRooms?.() || [];
  const periods = getPeriodLabels(deps.ttConfig);
  const entries = deps.entries?.() || [];
  const appState = deps.appState || {};

  const entryClassLabels = entry => {
    const audience = deps.audienceForPlacement?.(entry);
    const labels = toArrayFromSet(audience?.classLabels).filter(Boolean);
    if (labels.length) return labels;
    const grades = deps.entryGradeKeys?.(entry) || (entry.gradeKey ? [entry.gradeKey] : []);
    const sec = sectionLabel(entry.sectionIdx ?? 0);
    return grades.map(g => `${normalizeGradeNumber(g)}${sec}`).filter(Boolean);
  };

  const entrySummary = (entry, mode = "normal") => {
    const title = deps.entryTitle?.(entry) || entry.subject || entry.title || "-";
    const teacher = clean(entry.teacherName || (entry.teacherNames || []).join(", "));
    const room = roomDisplayName(entry, rooms);
    const classes = entryClassLabels(entry).join(", ");
    if (mode === "teacher") return [title, classes, room].filter(Boolean).join(" / ");
    if (mode === "class") return [title, teacher, room].filter(Boolean).join(" / ");
    if (mode === "room") return [title, teacher, classes].filter(Boolean).join(" / ");
    if (mode === "student") return [title, teacher, room].filter(Boolean).join(" / ");
    return [title, teacher, classes, room].filter(Boolean).join(" / ");
  };

  const teacherMatches = (entry, teacher) => (deps.splitTeacherNames?.(entry.teacherName || "") || [])
    .map(clean).includes(clean(teacher));

  const classMatches = (entry, cls) => {
    if (typeof deps.entryMatchesClass === "function" && deps.entryMatchesClass(entry, cls)) return true;
    const key = makeClassKey(cls);
    if (!key) return false;
    const audience = deps.audienceForPlacement?.(entry);
    return toArrayFromSet(audience?.classKeys).includes(key);
  };

  const studentMatches = (entry, student) => {
    // 시간표 단계에서는 학생 개인 key를 사용하지 않고 학급/반 점유만 기준으로 출력합니다.
    const audience = deps.audienceForPlacement?.(entry);
    const classKeys = toArrayFromSet(audience?.classKeys);
    if (classKeys.length && student.classKey) return classKeys.includes(student.classKey);
    return classMatches(entry, student);
  };

  const getGridEntries = (day, period, filterFn) => entries
    .filter(e => e.day === day && e.period === period && filterFn(e))
    .sort((a, b) => String(deps.entryTitle?.(a) || "").localeCompare(String(deps.entryTitle?.(b) || ""), "ko"));

  return { rooms, periods, entries, appState, entrySummary, teacherMatches, classMatches, studentMatches, getGridEntries };
}

function buildEntities(type, scope, selectedKey, deps, ctx) {
  const selected = clean(selectedKey);
  if (type === "teacher") {
    const teachers = (deps.getAllTimetableTeachers?.() || [])
      .map(clean).filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "ko"));
    const list = (scope === "all" ? teachers : teachers.filter(t => t === selected));
    return list.map(t => ({ type, key: t, label: t, mode: "teacher", filterFn: e => ctx.teacherMatches(e, t) }));
  }
  if (type === "class") {
    const classes = (deps.getAllClasses?.() || [])
      .map(cls => ({ ...cls, label: classLabel(cls), key: makeClassKey(cls) }))
      .filter(cls => cls.key)
      .sort((a, b) => a.label.localeCompare(b.label, "ko", { numeric: true }));
    const list = (scope === "all" ? classes : classes.filter(c => c.key === selected));
    return list.map(cls => ({ type, key: cls.key, label: cls.label, mode: "class", filterFn: e => ctx.classMatches(e, cls) }));
  }
  if (type === "room") {
    const room = (ctx.rooms || []).find(r => r.id === selected);
    return room ? [{ type, key: room.id, label: room.name || room.id, mode: "room", filterFn: e => e.roomId === room.id }] : [];
  }
  if (type === "student") {
    const student = buildStudentList(deps.appState).find(s => s.key === selected);
    return student ? [{ type, key: student.key, label: student.label, mode: "student", filterFn: e => ctx.studentMatches(e, student) }] : [];
  }
  return [];
}

function buildGridData(entity, ctx) {
  const data = [["교시/요일", ...DAYS]];
  ctx.periods.forEach((label, period) => {
    const row = [label];
    DAYS.forEach((_, day) => {
      const text = ctx.getGridEntries(day, period, entity.filterFn)
        .map(e => ctx.entrySummary(e, entity.mode))
        .join("\n");
      row.push(text);
    });
    data.push(row);
  });
  return data;
}

function exportEntitiesXlsx(entities, deps, ctx) {
  if (!window.XLSX?.utils) {
    alert("엑셀 내보내기 라이브러리를 불러오지 못했습니다.");
    return;
  }
  if (!entities.length) {
    alert("출력할 대상이 없습니다.");
    return;
  }
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const usedSheetNames = new Set();

  entities.forEach(entity => {
    const data = buildGridData(entity, ctx);
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 10 }, ...DAYS.map(() => ({ wch: 32 }))];
    ws["!rows"] = data.map((_, idx) => ({ hpt: idx === 0 ? 22 : 54 }));
    Object.keys(ws).forEach(addr => {
      if (addr[0] === "!") return;
      ws[addr].s = { alignment: { wrapText: true, vertical: "top" } };
    });
    XLSX.utils.book_append_sheet(wb, ws, makeSheetName(entity.label, usedSheetNames));
  });

  const prefix = entities.length === 1 ? entities[0].label : `${entities[0].label}_외_${entities.length - 1}`;
  XLSX.writeFile(wb, `${safeFileName(prefix)}_시간표.xlsx`);
}

function buildPrintHtml(entities, ctx) {
  const now = new Date();
  const sections = entities.map(entity => {
    const rows = ctx.periods.map((label, period) => {
      const tds = DAYS.map((_, day) => {
        const entries = ctx.getGridEntries(day, period, entity.filterFn);
        const html = entries.length
          ? entries.map(e => `<div class="lesson">${escapeHtml(ctx.entrySummary(e, entity.mode)).replace(/\n/g, "<br>")}</div>`).join("")
          : "";
        return `<td>${html}</td>`;
      }).join("");
      return `<tr><th>${escapeHtml(label)}</th>${tds}</tr>`;
    }).join("");
    return `
      <section class="print-section">
        <h1>${escapeHtml(entity.label)} 시간표</h1>
        <table>
          <thead><tr><th>교시/요일</th>${DAYS.map(d => `<th>${d}</th>`).join("")}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>시간표 출력</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 18px; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0f172a; }
  .print-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; padding: 10px 12px; border: 1px solid #dbe4f0; border-radius: 12px; background: #f8fafc; }
  .print-toolbar strong { font-size: 14px; }
  .print-toolbar span { font-size: 12px; color: #64748b; }
  .print-toolbar button { height: 32px; padding: 0 14px; border: 1px solid #1d4ed8; border-radius: 8px; background: #2563eb; color: white; font-weight: 800; cursor: pointer; }
  .print-section { page-break-after: always; margin-bottom: 28px; }
  .print-section:last-child { page-break-after: auto; }
  h1 { margin: 0 0 10px; font-size: 20px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #cbd5e1; padding: 7px; vertical-align: top; word-break: keep-all; overflow-wrap: anywhere; }
  th { background: #173b68; color: white; font-size: 12px; }
  tbody th { width: 72px; background: #eef4ff; color: #173b68; }
  td { height: 86px; font-size: 11px; }
  .lesson { margin: 0 0 5px; padding: 5px 6px; border-left: 3px solid #2563eb; border-radius: 6px; background: #eff6ff; line-height: 1.35; }
  @media print {
    body { margin: 8mm; }
    .print-toolbar { display: none; }
    h1 { font-size: 16px; }
    th, td { padding: 5px; }
    td { height: 74px; font-size: 10px; }
  }
</style>
</head>
<body>
  <div class="print-toolbar">
    <div><strong>시간표 PDF 출력</strong><br><span>${escapeHtml(now.toLocaleString("ko-KR"))} · 인쇄 창에서 “PDF로 저장”을 선택하세요.</span></div>
    <button onclick="window.print()">PDF 저장/인쇄</button>
  </div>
  ${sections}
<script>setTimeout(() => window.focus(), 100);</script>
</body>
</html>`;
}

function exportEntitiesPdf(entities, deps, ctx) {
  if (!entities.length) {
    alert("출력할 대상이 없습니다.");
    return;
  }
  const html = buildPrintHtml(entities, ctx);
  const w = window.open("", "_blank", "width=1200,height=900");
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.focus(); } catch (_) {} }, 150);
    return;
  }
  downloadBlob("시간표_PDF출력.html", html, "text/html;charset=utf-8");
  alert("팝업이 차단되어 HTML 파일로 다운로드했습니다. 파일을 열고 인쇄에서 PDF로 저장해 주세요.");
}

function optionListForType(type, deps, ctx) {
  if (type === "teacher") {
    return (deps.getAllTimetableTeachers?.() || []).map(clean).filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "ko"))
      .map(t => ({ key: t, label: t, meta: "교사" }));
  }
  if (type === "class") {
    return (deps.getAllClasses?.() || [])
      .map(cls => ({ key: makeClassKey(cls), label: classLabel(cls), meta: "학급" }))
      .filter(o => o.key)
      .sort((a, b) => a.label.localeCompare(b.label, "ko", { numeric: true }));
  }
  if (type === "room") {
    return (ctx.rooms || []).map(r => ({ key: r.id, label: r.name || r.id, meta: r.type || "교실" }))
      .filter(o => o.key)
      .sort((a, b) => a.label.localeCompare(b.label, "ko", { numeric: true }));
  }
  if (type === "student") {
    return buildStudentList(deps.appState).map(s => ({ key: s.key, label: s.label, meta: "학생" }));
  }
  return [];
}

export function openTimetableExportDialog(deps = {}) {
  const existing = document.querySelector(".tt-export-modal-backdrop");
  if (existing) existing.remove();

  const ctx = buildExportContext(deps);
  const backdrop = document.createElement("div");
  backdrop.className = "tt-export-modal-backdrop";
  backdrop.innerHTML = `
    <div class="tt-export-modal" role="dialog" aria-modal="true" aria-label="시간표 출력">
      <div class="tt-export-head">
        <div><strong>시간표 출력</strong><span>PDF 또는 엑셀로 시간표를 출력합니다.</span></div>
        <button type="button" class="tt-export-close">×</button>
      </div>
      <div class="tt-export-body">
        <div class="tt-export-options">
          <label><span>대상</span><select data-role="type">
            <option value="teacher">교사</option>
            <option value="class">학급</option>
            <option value="room">교실</option>
            <option value="student">학생</option>
          </select></label>
          <label><span>범위</span><select data-role="scope">
            <option value="single">개별</option>
            <option value="all">전체</option>
          </select></label>
          <label><span>형식</span><select data-role="format">
            <option value="pdf">PDF</option>
            <option value="xlsx">엑셀</option>
          </select></label>
        </div>
        <div class="tt-export-picker">
          <input data-role="search" type="search" placeholder="이름, 학급, 교실 검색">
          <select data-role="item" size="12"></select>
          <p data-role="hint"></p>
        </div>
      </div>
      <div class="tt-export-foot">
        <button type="button" class="tt-export-cancel">닫기</button>
        <button type="button" class="tt-export-run">출력</button>
      </div>
    </div>`;

  const close = () => backdrop.remove();
  backdrop.querySelector(".tt-export-close")?.addEventListener("click", close);
  backdrop.querySelector(".tt-export-cancel")?.addEventListener("click", close);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (!document.body.contains(backdrop)) { document.removeEventListener("keydown", onEsc); return; }
    if (e.key === "Escape") close();
  });

  const typeEl = backdrop.querySelector('[data-role="type"]');
  const scopeEl = backdrop.querySelector('[data-role="scope"]');
  const formatEl = backdrop.querySelector('[data-role="format"]');
  const searchEl = backdrop.querySelector('[data-role="search"]');
  const itemEl = backdrop.querySelector('[data-role="item"]');
  const hintEl = backdrop.querySelector('[data-role="hint"]');

  let currentOptions = [];

  const refreshOptions = () => {
    const type = typeEl.value;
    if (type === "room" || type === "student") {
      scopeEl.value = "single";
      scopeEl.disabled = true;
    } else {
      scopeEl.disabled = false;
    }
    const scope = scopeEl.value;
    const query = clean(searchEl.value).toLowerCase();
    currentOptions = optionListForType(type, deps, ctx);
    const filtered = currentOptions.filter(o => !query || `${o.label} ${o.meta}`.toLowerCase().includes(query));
    itemEl.innerHTML = "";
    filtered.forEach((o, idx) => {
      const opt = document.createElement("option");
      opt.value = o.key;
      opt.textContent = o.meta ? `${o.label} · ${o.meta}` : o.label;
      if (idx === 0) opt.selected = true;
      itemEl.appendChild(opt);
    });
    itemEl.disabled = scope === "all";
    searchEl.disabled = scope === "all";
    hintEl.textContent = scope === "all"
      ? `${type === "teacher" ? "교사" : "학급"} 전체를 각각 별도 페이지/시트로 출력합니다.`
      : `${filtered.length}개 항목 중 1개를 선택합니다.`;
  };

  [typeEl, scopeEl, formatEl].forEach(el => el.addEventListener("change", refreshOptions));
  searchEl.addEventListener("input", refreshOptions);
  refreshOptions();

  backdrop.querySelector(".tt-export-run")?.addEventListener("click", () => {
    const type = typeEl.value;
    const scope = scopeEl.value;
    const selectedKey = itemEl.value;
    const entities = buildEntities(type, scope, selectedKey, deps, ctx);
    if (!entities.length) {
      alert("출력할 대상을 선택하세요.");
      return;
    }
    if (formatEl.value === "xlsx") exportEntitiesXlsx(entities, deps, ctx);
    else exportEntitiesPdf(entities, deps, ctx);
  });

  document.body.appendChild(backdrop);
  setTimeout(() => typeEl.focus(), 0);
}

// Backward compatibility for older calls.
export function exportTimetableXlsx(deps = {}) {
  const ctx = buildExportContext(deps);
  const entities = buildEntities("class", "all", "", deps, ctx);
  exportEntitiesXlsx(entities, deps, ctx);
}
