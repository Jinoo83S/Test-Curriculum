// ================================================================
// curriculum.js · Curriculum Board Mutations + Rendering
// ================================================================
import { GRADE_KEYS, GRADE_GROUPS, SEMESTER_LABELS, CATEGORY_PALETTE, DEFAULT_OPTIONS, DEFAULT_COL_WIDTHS } from "./config.js";
import { uid, clean, uniqueOrdered, parseCreditValue, makeBtn, languageClass } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave, ensureConsistency, createRow, normalizeRow, loadColWidths, saveColWidths, currentDrag, setCurrentDrag } from "./state.js";

// ── Helpers ───────────────────────────────────────────────────────
const curriculum = () => appState.curriculum;
const opts       = () => curriculum().options;

// Callback for sidebar re-render after board mutations
let _onCurriculumChange = () => {};
export const setOnCurriculumChange = (fn) => { _onCurriculumChange = fn; };

export function getRowById(grade, rowId) {
  return (curriculum().gradeBoards[grade] || []).find(r => r.id === rowId) || null;
}

export function getCategoryColor(category) {
  const idx = opts().category.indexOf(category);
  return idx < 0 ? { bg:"#f3f4f6", text:"#374151" } : CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length];
}

// ── Template lookup (reads from templates domain) ─────────────────
import { getTemplateById, getSemesterTemplateData, isSemesterDataSame, getTemplateGroupById } from "./templates.js";

// ── Row Mutations ─────────────────────────────────────────────────
export function updateRowField(grade, rowId, field, value) {
  if (!canEdit()) return;
  const row = getRowById(grade, rowId); if (!row) return;
  row[field] = value; scheduleSave("curriculum");
}

export function addRow(grade) {
  if (!canEdit()) return;
  const rows = curriculum().gradeBoards[grade] || [];
  const last = rows[rows.length - 1] || {};
  rows.push(createRow(opts(), { category:last.category, track:last.track, group:last.group, credits:last.credits }));
  scheduleSave("curriculum");
}

export function addRowWithTemplate(grade, templateId) {
  if (!canEdit() || !templateId) return null;
  const rows = curriculum().gradeBoards[grade] || [];

  // Infer category/track/group from other grades that already use this template
  let seed = {};
  GRADE_KEYS.forEach(g => {
    const existing = (curriculum().gradeBoards[g] || []).find(r =>
      r.sem1TemplateId === templateId || r.sem2TemplateId === templateId
    );
    if (existing && !seed.category) seed = { category: existing.category, track: existing.track, group: existing.group, credits: existing.credits };
  });
  // Fallback: copy from last row of this grade
  if (!seed.category && rows.length) {
    const last = rows[rows.length - 1];
    seed = { category: last.category, track: last.track, group: last.group, credits: last.credits };
  }

  const newRow = createRow(opts(), seed);
  newRow.sem1TemplateId = templateId;
  newRow.sem2TemplateId = templateId;
  rows.push(newRow);
  curriculum().gradeBoards[grade] = rows;
  scheduleSave("curriculum");
  _onCurriculumChange();
  return newRow;
}

export function deleteRow(grade, rowId) {
  if (!canEdit()) return;
  if (!confirm("이 행을 삭제할까요?")) return;
  curriculum().gradeBoards[grade] = curriculum().gradeBoards[grade].filter(r => r.id !== rowId);
  if (!curriculum().gradeBoards[grade].length) curriculum().gradeBoards[grade].push(createRow(opts()));
  scheduleSave("curriculum");
}

// ── Options Mutations ─────────────────────────────────────────────
export function addOption(type, value) {
  if (!canEdit()) return;
  const v = clean(value); if (!v) return;
  if (opts()[type].includes(v)) { alert("이미 있는 옵션입니다."); return; }
  opts()[type].push(v); ensureConsistency("curriculum"); scheduleSave("curriculum");
}

export function removeOption(type, value) {
  if (!canEdit()) return;
  if (opts()[type].length <= 1) { alert("최소 1개의 옵션은 남겨두어야 합니다."); return; }
  if (!confirm(`"${value}" 옵션을 삭제할까요?`)) return;
  opts()[type] = opts()[type].filter(v => v !== value); ensureConsistency("curriculum"); scheduleSave("curriculum");
}

export function moveOption(type, index, dir) {
  if (!canEdit()) return;
  const arr = opts()[type]; const ni = index + dir;
  if (ni < 0 || ni >= arr.length) return;
  [arr[index], arr[ni]] = [arr[ni], arr[index]]; scheduleSave("curriculum");
}

// ── Drag & Drop Mutations ─────────────────────────────────────────
export function placeBothSems(templateId, grade, rowId) {
  if (!canEdit()) return;
  const row = getRowById(grade, rowId); if (!row) return;
  row.sem1TemplateId = templateId; row.sem2TemplateId = templateId; scheduleSave("curriculum");
  _onCurriculumChange();
}

export function placeTemplateTo(templateId, grade, rowId, semKey) {
  if (!canEdit()) return;
  const row = getRowById(grade, rowId); if (!row) return;
  const ex = row[`${semKey}TemplateId`];
  if (ex && ex !== templateId) {
    const exT = getTemplateById(ex); const nT = getTemplateById(templateId);
    if (!confirm(`${SEMESTER_LABELS[semKey]}에 이미 "${getTemplateCardTitle(exT)}" 카드가 있습니다.\n"${getTemplateCardTitle(nT)}" 카드로 바꿀까요?`)) return;
  }
  row[`${semKey}TemplateId`] = templateId; scheduleSave("curriculum"); _onCurriculumChange();
}

export function clearRowSem(grade, rowId, semKey) {
  if (!canEdit()) return;
  const row = getRowById(grade, rowId); if (!row) return;
  row[`${semKey}TemplateId`] = null; scheduleSave("curriculum"); _onCurriculumChange();
}

export function clearRowBoth(grade, rowId) {
  if (!canEdit()) return;
  const row = getRowById(grade, rowId); if (!row) return;
  row.sem1TemplateId = null; row.sem2TemplateId = null; scheduleSave("curriculum"); _onCurriculumChange();
}

export function movePlaced(sGrade, sRowId, sSemKey, dGrade, dRowId, dSemKey) {
  if (!canEdit()) return;
  const sRow = getRowById(sGrade, sRowId); const dRow = getRowById(dGrade, dRowId);
  if (!sRow || !dRow) return;
  if (sGrade === dGrade && sRowId === dRowId && sSemKey === dSemKey) return;
  const mv = sRow[`${sSemKey}TemplateId`]; const re = dRow[`${dSemKey}TemplateId`];
  sRow[`${sSemKey}TemplateId`] = re; dRow[`${dSemKey}TemplateId`] = mv; scheduleSave("curriculum"); _onCurriculumChange();
}

function getTemplateCardTitle(item) {
  if (!item) return "-";
  return clean(item.nameKo) || clean(item.sem1NameKo) || clean(item.nameEn) || clean(item.sem1NameEn) || "-";
}

// ── Summary Calculations ──────────────────────────────────────────
function getRepresentativeTrackCredit(rows) { return rows.reduce((mx, r) => Math.max(mx, parseCreditValue(r.credits)), 0); }

function getRowTemplateGroupId(row) {
  const ids = uniqueOrdered([row.sem1TemplateId, row.sem2TemplateId].filter(Boolean));
  const gids = uniqueOrdered(ids.map(id => getTemplateById(id)?.calcGroupId).filter(Boolean));
  return gids.length === 1 ? gids[0] : null;
}

function summarizeCategoryRows(category, rows) {
  const active = (rows || []).filter(r => r.sem1TemplateId || r.sem2TemplateId);
  if (clean(category) === "교과") {
    const cRows = active.filter(r => clean(r.track) === "공통");
    const ncRows = active.filter(r => clean(r.track) !== "공통");
    const cgMap = new Map(); const cUng = [];
    cRows.forEach(r => { const gid = getRowTemplateGroupId(r); gid ? (cgMap.has(gid) ? cgMap.get(gid).push(r) : cgMap.set(gid, [r])) : cUng.push(r); });
    const gtMap = new Map(); ncRows.forEach(r => { const k = clean(r.track) || r.id; (gtMap.get(k) || gtMap.set(k, []).get(k)).push(r); });
    const totalCourses = cUng.length + cgMap.size + gtMap.size;
    const cc  = cUng.reduce((s, r) => s + parseCreditValue(r.credits), 0);
    const cgc = Array.from(cgMap.entries()).reduce((s, [gid, grs]) => { const g = getTemplateGroupById(gid); return s + (clean(g?.creditValue) ? parseCreditValue(g.creditValue) : getRepresentativeTrackCredit(grs)); }, 0);
    const gtc = Array.from(gtMap.values()).reduce((s, grs) => { const tgids = uniqueOrdered(grs.map(getRowTemplateGroupId).filter(Boolean)); if (tgids.length === 1) { const g = getTemplateGroupById(tgids[0]); return s + (clean(g?.creditValue) ? parseCreditValue(g.creditValue) : getRepresentativeTrackCredit(grs)); } return s + getRepresentativeTrackCredit(grs); }, 0);
    return { totalCourses, totalCredits: cc + cgc + gtc };
  }
  return { totalCourses: active.length, totalCredits: active.length };
}

function getCategorySummary(grade, category) { return summarizeCategoryRows(category, (curriculum().gradeBoards[grade] || []).filter(r => r.category === category)); }

function getGradeSummary(grade) {
  return opts().category.reduce((acc, cat) => { const s = getCategorySummary(grade, cat); acc.totalCourses += s.totalCourses; acc.totalCredits += s.totalCredits; return acc; }, { totalCourses:0, totalCredits:0 });
}

// ── Column Resize ──────────────────────────────────────────────────
export function initColResize(col, headerRow, grade) {
  const widths = loadColWidths(grade);
  applyColWidths(col, widths);
  headerRow.querySelectorAll(".col-resize-handle").forEach((h, i) => {
    let sx, sw;
    h.addEventListener("mousedown", e => {
      e.preventDefault(); sx = e.clientX; sw = h.parentElement.getBoundingClientRect().width;
      h.classList.add("resizing");
      const onMove = ev => { widths[i] = `${Math.max(36, sw + ev.clientX - sx)}px`; applyColWidths(col, widths); };
      const onUp   = ()  => { h.classList.remove("resizing"); saveColWidths(grade, widths); document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
      document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
    });
  });
}

function applyColWidths(col, widths) {
  const tpl = widths.join(" ");
  col.querySelectorAll(".grade-header-row,.grade-data-row").forEach(r => { r.style.gridTemplateColumns = tpl; });
}

// ── Board Rendering ───────────────────────────────────────────────
function createSelect(options, cur, onChange) {
  const sel = document.createElement("select"); sel.className = "row-select"; sel.disabled = !canEdit();
  options.forEach(v => { const o = document.createElement("option"); o.value = v; o.textContent = v; if (v === cur) o.selected = true; sel.appendChild(o); });
  sel.addEventListener("change", e => onChange(e.target.value));
  return sel;
}

function buildExpandedMeta(s1, s2) {
  const meta = document.createElement("div"); meta.className = "placed-meta placed-meta-hidden";
  const s1d = s1 ? getSemesterTemplateData(s1, "sem1") : null;
  const s2d = s2 ? getSemesterTemplateData(s2, "sem2") : null;
  uniqueOrdered([s1d?.teacher, s2d?.teacher].filter(Boolean)).forEach(t => {
    const c = document.createElement("span"); c.className = "meta-chip"; c.textContent = t; meta.appendChild(c);
  });
  return meta;
}

function attachExpandClick(card, meta) {
  card.addEventListener("click", e => {
    if (e.target.closest("button")) return;
    if (!meta.children.length) return;
    const exp = card.classList.toggle("placed-expanded");
    meta.classList.toggle("placed-meta-hidden", !exp);
    document.querySelectorAll(".placed-card.placed-expanded").forEach(o => { if (o !== card) { o.classList.remove("placed-expanded"); o.querySelector(".placed-meta")?.classList.add("placed-meta-hidden"); } });
  });
}

function createPlacedCard(templateId, grade, rowData, semKey) {
  const item = getTemplateById(templateId); if (!item) return document.createTextNode("");
  const sd = getSemesterTemplateData(item, semKey);
  const card = document.createElement("div"); card.className = `placed-card ${languageClass(sd.language)}`; card.draggable = canEdit();
  card.addEventListener("dragstart", () => { setCurrentDrag({ kind:"placed", sourceGrade:grade, sourceRowId:rowData.id, sourceSemKey:semKey, templateId }); card.classList.add("dragging"); });
  card.addEventListener("dragend",   () => { setCurrentDrag(null); card.classList.remove("dragging"); });
  const top = document.createElement("div"); top.className = "placed-top";
  const tw = document.createElement("div"); tw.className = "placed-title-wrap";
  const ko = document.createElement("div"); ko.className = "placed-title-ko"; ko.textContent = sd.nameKo || sd.nameEn || "-";
  const en = document.createElement("div"); en.className = "placed-title-en"; en.textContent = sd.nameEn || "-";
  tw.append(ko, en); top.appendChild(tw);
  if (canEdit()) {
    const cb = makeBtn("×", "clear-cell-btn", e => { e.stopPropagation(); clearRowSem(grade, rowData.id, semKey); });
    cb.addEventListener("mousedown", e => e.stopPropagation()); top.appendChild(cb);
  }
  const oth = semKey === "sem1" ? rowData.sem2TemplateId : rowData.sem1TemplateId;
  const othItem = oth ? getTemplateById(oth) : null;
  const meta = buildExpandedMeta(semKey === "sem1" ? item : othItem, semKey === "sem2" ? item : othItem);
  card.append(top, meta); attachExpandClick(card, meta); return card;
}

function createMergedPlacedCard(templateId, grade, rowData) {
  const item = getTemplateById(templateId); if (!item) return document.createTextNode("");
  const sd = getSemesterTemplateData(item, "sem1");
  const card = document.createElement("div"); card.className = `placed-card placed-card-merged ${languageClass(sd.language)}`; card.draggable = canEdit();
  card.addEventListener("dragstart", () => { setCurrentDrag({ kind:"placed", sourceGrade:grade, sourceRowId:rowData.id, sourceSemKey:"merged", templateId }); card.classList.add("dragging"); });
  card.addEventListener("dragend",   () => { setCurrentDrag(null); card.classList.remove("dragging"); });
  const top = document.createElement("div"); top.className = "placed-top";
  const tw = document.createElement("div"); tw.className = "placed-title-wrap";
  const ko = document.createElement("div"); ko.className = "placed-title-ko"; ko.textContent = sd.nameKo || sd.nameEn || "-";
  const en = document.createElement("div"); en.className = "placed-title-en"; en.textContent = sd.nameEn || "-";
  tw.append(ko, en); top.appendChild(tw);
  if (canEdit()) {
    const cb = makeBtn("×", "clear-cell-btn", e => { e.stopPropagation(); clearRowBoth(grade, rowData.id); });
    cb.addEventListener("mousedown", e => e.stopPropagation()); top.appendChild(cb);
  }
  const meta = buildExpandedMeta(item, item); card.append(top, meta); attachExpandClick(card, meta); return card;
}

function createDropCell(grade, rowData, semKey, templateId) {
  const cell = document.createElement("div"); cell.className = templateId ? "drop-cell" : "drop-cell empty";
  if (templateId) cell.appendChild(createPlacedCard(templateId, grade, rowData, semKey));
  cell.addEventListener("dragover", e => { if (!canEdit()) return; e.preventDefault(); cell.classList.add("dragover"); });
  cell.addEventListener("dragleave", () => cell.classList.remove("dragover"));
  cell.addEventListener("drop", e => {
    if (!canEdit()) return; e.preventDefault(); cell.classList.remove("dragover");
    const drag = currentDrag; if (!drag) return;
    if (drag.kind === "template") { placeBothSems(drag.templateId, grade, rowData.id); return; }
    if (drag.kind === "placed") {
      if (drag.sourceSemKey === "merged") {
        const mv = drag.templateId; const dRow = getRowById(grade, rowData.id); const sRow = getRowById(drag.sourceGrade, drag.sourceRowId);
        if (dRow) { const rep = dRow[`${semKey}TemplateId`]; dRow[`${semKey}TemplateId`] = mv; if (sRow && !(drag.sourceGrade === grade && drag.sourceRowId === rowData.id)) { sRow.sem1TemplateId = rep; sRow.sem2TemplateId = rep; } scheduleSave("curriculum"); _onCurriculumChange(); }
      } else { movePlaced(drag.sourceGrade, drag.sourceRowId, drag.sourceSemKey, grade, rowData.id, semKey); }
    }
  });
  return cell;
}

function createMergedDropCell(grade, rowData, templateId) {
  const cell = document.createElement("div"); cell.className = "drop-cell merged-drop-cell"; cell.style.gridColumn = "4 / 6";
  cell.appendChild(createMergedPlacedCard(templateId, grade, rowData));
  cell.addEventListener("dragover", e => { if (!canEdit()) return; e.preventDefault(); cell.classList.add("dragover"); });
  cell.addEventListener("dragleave", () => cell.classList.remove("dragover"));
  cell.addEventListener("drop", e => {
    if (!canEdit()) return; e.preventDefault(); cell.classList.remove("dragover");
    const drag = currentDrag; if (!drag) return;
    if (drag.kind === "template") { placeBothSems(drag.templateId, grade, rowData.id); return; }
    if (drag.kind === "placed") {
      const mv = drag.templateId; const dRow = getRowById(grade, rowData.id); const sRow = getRowById(drag.sourceGrade, drag.sourceRowId); if (!dRow) return;
      if (drag.sourceSemKey === "merged") { if (sRow && !(drag.sourceGrade === grade && drag.sourceRowId === rowData.id)) { const od = dRow.sem1TemplateId; dRow.sem1TemplateId = mv; dRow.sem2TemplateId = mv; sRow.sem1TemplateId = od; sRow.sem2TemplateId = od; scheduleSave("curriculum"); } }
      else { dRow.sem1TemplateId = mv; dRow.sem2TemplateId = mv; if (sRow) sRow[`${drag.sourceSemKey}TemplateId`] = null; scheduleSave("curriculum"); }
    }
  });
  return cell;
}

function shouldRenderMerged(r) { return !!(r?.sem1TemplateId && r?.sem2TemplateId && r.sem1TemplateId === r.sem2TemplateId && isSemesterDataSame(getTemplateById(r.sem1TemplateId))); }

function createGradeRow(grade, rowData) {
  const row = document.createElement("div"); row.className = "grade-data-row";
  const cat = createSelect(opts().category, rowData.category, v => { updateRowField(grade, rowData.id, "category", v); });
  const catColor = getCategoryColor(rowData.category); cat.classList.add("category-select"); cat.style.backgroundColor = catColor.bg; cat.style.color = catColor.text;
  row.appendChild(cat);
  row.appendChild(createSelect(opts().track, rowData.track,    v => updateRowField(grade, rowData.id, "track",    v)));
  row.appendChild(createSelect(opts().group, rowData.group,    v => updateRowField(grade, rowData.id, "group",    v)));
  if (shouldRenderMerged(rowData)) { row.appendChild(createMergedDropCell(grade, rowData, rowData.sem1TemplateId)); }
  else { row.appendChild(createDropCell(grade, rowData, "sem1", rowData.sem1TemplateId)); row.appendChild(createDropCell(grade, rowData, "sem2", rowData.sem2TemplateId)); }
  const ci = document.createElement("input"); ci.className = "credit-input"; ci.type = "text"; ci.value = rowData.credits; ci.placeholder = "0"; ci.disabled = !canEdit();
  ci.addEventListener("change", e => updateRowField(grade, rowData.id, "credits", e.target.value)); row.appendChild(ci);
  const db = makeBtn("×", "row-delete-btn", () => deleteRow(grade, rowData.id)); db.disabled = !canEdit(); row.appendChild(db);
  return row;
}

function createSpacerRow() {
  const r = document.createElement("div"); r.className = "grade-data-row spacer-row";
  for (let i = 0; i < 7; i++) { const c = document.createElement("div"); c.className = "spacer-cell"; r.appendChild(c); }
  return r;
}

function createGradeHeader() {
  const r = document.createElement("div"); r.className = "grade-header-row";
  ["범주","구분","교과군","1학기","2학기","시수",""].forEach((lbl, i) => {
    const c = document.createElement("div"); c.className = "header-cell"; c.textContent = lbl;
    if (i < 6) { const h = document.createElement("div"); h.className = "col-resize-handle"; c.appendChild(h); }
    r.appendChild(c);
  });
  return r;
}

function createCategorySummaryRow(grade, category) {
  const s = getCategorySummary(grade, category);
  const row = document.createElement("div"); row.className = "category-summary-row";
  const lbl = document.createElement("div"); lbl.className = "category-summary-label"; lbl.textContent = `${category} 합계`;
  const crs = document.createElement("div"); crs.className = "category-summary-value"; crs.textContent = `Total #Courses ${s.totalCourses}`;
  const crd = document.createElement("div"); crd.className = "category-summary-value"; crd.textContent = `Total #Credits ${s.totalCredits}`;
  row.append(lbl, crs, crd); return row;
}

function getOrderedCategories(grades) {
  const cats = [...opts().category];
  grades.forEach(g => (curriculum().gradeBoards[g] || []).forEach(r => { if (r.category && !cats.includes(r.category)) cats.push(r.category); }));
  return cats;
}

function getOrderedTracks(grades, category) {
  const tracks = [...opts().track];
  grades.forEach(g => (curriculum().gradeBoards[g] || []).filter(r => r.category === category).forEach(r => { if (r.track && !tracks.includes(r.track)) tracks.push(r.track); }));
  return tracks;
}

export function buildTabBoard(visibleGrades, onUpdate) {
  const columns = [];
  visibleGrades.forEach(grade => {
    const col = document.createElement("section"); col.className = "grade-column";
    const gs = getGradeSummary(grade);
    const titleEl = document.createElement("div"); titleEl.className = "grade-title";
    titleEl.innerHTML = `<div class="grade-title-top"><span class="grade-title-name">${grade}</span><div class="grade-title-totals"><span class="grade-title-badge">Total #Courses ${gs.totalCourses}</span><span class="grade-title-badge">Total #Credits ${gs.totalCredits}</span></div></div><div class="grade-subtitle">Category / Semester / Credits</div>`;
    col.appendChild(titleEl);
    const hr = createGradeHeader(); col.appendChild(hr);
    columns.push({ grade, col, hr });
  });

  const cats = getOrderedCategories(visibleGrades);
  const cbg = Object.fromEntries(columns.map(c => [c.grade, c]));

  cats.forEach(cat => {
    const hasAny = visibleGrades.some(g => (curriculum().gradeBoards[g] || []).some(r => r.category === cat)); if (!hasAny) return;
    getOrderedTracks(visibleGrades, cat).forEach(track => {
      const rbg = {}; let max = 0;
      visibleGrades.forEach(g => { const rs = (curriculum().gradeBoards[g] || []).filter(r => r.category === cat && r.track === track); rbg[g] = rs; max = Math.max(max, rs.length); });
      if (!max) return;
      visibleGrades.forEach(g => { const d = document.createElement("div"); d.className = "track-group-divider"; d.textContent = track || "구분 없음"; cbg[g].col.appendChild(d); });
      for (let i = 0; i < max; i++) visibleGrades.forEach(g => { const rd = rbg[g][i]; cbg[g].col.appendChild(rd ? createGradeRow(g, rd) : createSpacerRow()); });
    });
    visibleGrades.forEach(g => cbg[g].col.appendChild(createCategorySummaryRow(g, cat)));
  });

  columns.forEach(({ grade, col, hr }) => {
    const footer = document.createElement("div"); footer.className = "grade-footer";
    const addBtn = makeBtn(`${grade} 행 추가`, "add-row-btn", () => addRow(grade));
    addBtn.disabled = !canEdit(); footer.appendChild(addBtn);

    // Drop zone for dragging template card → auto-creates new row
    const dropZone = document.createElement("div"); dropZone.className = "grade-footer-dropzone";
    dropZone.textContent = "여기에 과목 드롭 → 새 행 추가";
    dropZone.addEventListener("dragover", e => { if (!canEdit()) return; e.preventDefault(); dropZone.classList.add("dropzone-active"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dropzone-active"));
    dropZone.addEventListener("drop", e => {
      e.preventDefault(); dropZone.classList.remove("dropzone-active");
      const drag = currentDrag; if (!drag || drag.kind !== "template") return;
      addRowWithTemplate(grade, drag.templateId);
      onUpdate?.();
    });
    footer.appendChild(dropZone);
    col.appendChild(footer);
    initColResize(col, hr, grade);
  });

  return columns.map(c => c.col);
}

// ── Options Chips Rendering ───────────────────────────────────────
export function renderOptionChips(container, type) {
  container.innerHTML = "";
  const items = opts()[type];

  items.forEach((value, index) => {
    const chip = document.createElement("div");
    chip.className = "option-chip";
    chip.draggable = canEdit();
    chip.dataset.index = index;

    // Drag handle
    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.title = "드래그하여 순서 변경";

    const txt = document.createElement("span");
    txt.textContent = value;

    const del = makeBtn("×", "", () => { removeOption(type, value); });
    del.disabled = !canEdit();

    chip.append(handle, txt, del);

    // Drag events
    chip.addEventListener("dragstart", e => {
      if (!canEdit()) { e.preventDefault(); return; }
      chip.classList.add("chip-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    });
    chip.addEventListener("dragend", () => chip.classList.remove("chip-dragging"));
    chip.addEventListener("dragover", e => { if (!canEdit()) return; e.preventDefault(); chip.classList.add("chip-dragover"); });
    chip.addEventListener("dragleave", () => chip.classList.remove("chip-dragover"));
    chip.addEventListener("drop", e => {
      e.preventDefault(); chip.classList.remove("chip-dragover");
      const fromIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
      const toIdx   = parseInt(chip.dataset.index, 10);
      if (isNaN(fromIdx) || fromIdx === toIdx) return;
      const arr = opts()[type];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      scheduleSave("curriculum");
      renderOptionChips(container, type); // re-render with new order
    });

    container.appendChild(chip);
  });
}

// ── Excel Export ──────────────────────────────────────────────────
export function exportXLSX(activeTab) {
  const grades = GRADE_GROUPS[activeTab];
  const wb = XLSX.utils.book_new();
  const rows = [["학년","범주","구분","교과군","1학기(한글)","1학기(영어)","1학기(교사)","2학기(한글)","2학기(영어)","2학기(교사)","시수"]];
  grades.forEach(grade => {
    (curriculum().gradeBoards[grade] || []).forEach(row => {
      const t1 = row.sem1TemplateId ? getTemplateById(row.sem1TemplateId) : null;
      const t2 = row.sem2TemplateId ? getTemplateById(row.sem2TemplateId) : null;
      const s1 = t1 ? getSemesterTemplateData(t1, "sem1") : { nameKo:"", nameEn:"", teacher:"" };
      const s2 = t2 ? getSemesterTemplateData(t2, "sem2") : { nameKo:"", nameEn:"", teacher:"" };
      rows.push([grade, row.category, row.track, row.group, s1.nameKo||"", s1.nameEn||"", s1.teacher||"", s2.nameKo||"", s2.nameEn||"", s2.teacher||"", row.credits||""]);
    });
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [10,8,10,12,18,22,14,18,22,14,6].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, activeTab === "tab7to9" ? "7-9학년" : "10-12학년");
  XLSX.writeFile(wb, "HIS_Curriculum.xlsx");
}
