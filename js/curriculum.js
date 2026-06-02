// ================================================================
// curriculum.js · Curriculum Board Mutations + Rendering
// ================================================================
import { GRADE_KEYS, GRADE_GROUPS, SEMESTER_LABELS, CATEGORY_PALETTE, DEFAULT_OPTIONS, DEFAULT_COL_WIDTHS } from "./config.js";
import { uid, clean, uniqueOrdered, parseCreditValue, makeBtn, languageClass } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave, ensureConsistency, createRow, normalizeRow, loadColWidths, saveColWidths, currentDrag, setCurrentDrag, normalizeTemplate } from "./state.js";

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
import { getTemplateById, getSemesterTemplateData, isSemesterDataSame, getTemplateGroupById, getTemplateCardTitle, getTemplateAppliedGrades } from "./templates.js";

// ── Row Mutations ─────────────────────────────────────────────────
/**
 * 창체 행의 credits 입력값은 "시간 수"로 사용합니다.
 * 교육과정 총 시수 계산에서는 창체를 과목당 1로 계산하고,
 * 창체 합계 행에서만 credits 입력값을 Total #Hours로 합산합니다.
 */
function enforceChanCheCredit(row) {
  // no-op: 입력값을 1로 덮어쓰지 않습니다.
}

export function updateRowField(grade, rowId, field, value) {
  if (!canEdit()) return;
  const row = getRowById(grade, rowId); if (!row) return;
  row[field] = value;
  enforceChanCheCredit(row);
  scheduleSave("curriculum");
  _onCurriculumChange();
}

export function addRow(grade) {
  if (!canEdit()) return;
  const rows = curriculum().gradeBoards[grade] || [];
  const last = rows[rows.length - 1] || {};
  const newRow = createRow(opts(), { category:last.category, track:last.track, group:last.group, credits:last.credits });
  enforceChanCheCredit(newRow);
  rows.push(newRow);
  scheduleSave("curriculum");
  _onCurriculumChange();
}

/** 이전 버전 호환용: 창체 credits 값은 실제 시간 수이므로 더 이상 일괄 1로 변경하지 않습니다. */
export function fixChanCheCredits() {
  return 0;
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
  enforceChanCheCredit(newRow);
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
  _onCurriculumChange();
}

// ── Options Mutations ─────────────────────────────────────────────
export function addOption(type, value) {
  if (!canEdit()) return;
  const v = clean(value); if (!v) return;
  if (opts()[type].includes(v)) { alert("이미 있는 옵션입니다."); return; }
  opts()[type].push(v); ensureConsistency("curriculum"); scheduleSave("curriculum"); _onCurriculumChange();
}

export function removeOption(type, value) {
  if (!canEdit()) return;
  if (opts()[type].length <= 1) { alert("최소 1개의 옵션은 남겨두어야 합니다."); return; }
  if (!confirm(`"${value}" 옵션을 삭제할까요?`)) return;
  opts()[type] = opts()[type].filter(v => v !== value); ensureConsistency("curriculum"); scheduleSave("curriculum"); _onCurriculumChange();
}

export function moveOption(type, index, dir) {
  if (!canEdit()) return;
  const arr = opts()[type]; const ni = index + dir;
  if (ni < 0 || ni >= arr.length) return;
  [arr[index], arr[ni]] = [arr[ni], arr[index]]; scheduleSave("curriculum"); _onCurriculumChange();
}

// ── Drag & Drop Mutations ─────────────────────────────────────────
/** When a template is dropped onto an empty row cell, infer category/track/group from other grades */
function autoFillRowFromTemplate(grade, rowId, templateId) {
  const row = getRowById(grade, rowId); if (!row) return;
  // Already has a template — don't overwrite category
  const alreadyFilled = row.sem1TemplateId || row.sem2TemplateId;
  if (alreadyFilled) return;
  // Look for same template in other grades
  let seed = null;
  GRADE_KEYS.forEach(g => {
    if (seed) return;
    const existing = (curriculum().gradeBoards[g] || []).find(r =>
      (r.sem1TemplateId === templateId || r.sem2TemplateId === templateId) && r.id !== rowId
    );
    if (existing) seed = { category: existing.category, track: existing.track, group: existing.group, credits: existing.credits };
  });
  if (!seed) return;
  if (seed.category) row.category = seed.category;
  if (seed.track)    row.track    = seed.track;
  if (seed.group)    row.group    = seed.group;
  if (seed.credits)  row.credits  = seed.credits;
  enforceChanCheCredit(row);
}

export function placeBothSems(templateId, grade, rowId) {
  if (!canEdit()) return;
  const row = getRowById(grade, rowId); if (!row) return;
  autoFillRowFromTemplate(grade, rowId, templateId);
  row.sem1TemplateId = templateId; row.sem2TemplateId = templateId;
  enforceChanCheCredit(row);
  scheduleSave("curriculum");
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


// ── Summary Calculations ──────────────────────────────────────────
function getRepresentativeTrackCredit(rows) { return rows.reduce((mx, r) => Math.max(mx, parseCreditValue(r.credits)), 0); }

function getRowTemplateGroupId(row) {
  const ids = uniqueOrdered([row.sem1TemplateId, row.sem2TemplateId].filter(Boolean));
  const gids = uniqueOrdered(ids.map(id => getTemplateById(id)?.calcGroupId).filter(Boolean));
  return gids.length === 1 ? gids[0] : null;
}

function summarizeCategoryRows(category, rows) {
  const active = (rows || []).filter(r => r.sem1TemplateId || r.sem2TemplateId);
  if (clean(category) === "창체") {
    const totalHours = active.reduce((s, r) => s + parseCreditValue(r.credits), 0);
    return { totalCourses: active.length, totalCredits: active.length, totalHours };
  }
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
  return { totalCourses: active.length, totalCredits: active.length, totalHours: active.reduce((s, r) => s + parseCreditValue(r.credits), 0) };
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

function createPopupField(label, input) {
  const field = document.createElement("label");
  field.className = "tpl-popup-field";
  const span = document.createElement("span");
  span.textContent = label;
  field.append(span, input);
  return field;
}

function createPopupInput(value = "", disabled = false) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.disabled = disabled;
  return input;
}

function createPopupSelect(value, options, disabled = false) {
  const select = document.createElement("select");
  select.disabled = disabled;
  options.forEach(opt => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (opt === value) o.selected = true;
    select.appendChild(o);
  });
  return select;
}

export function openTemplateCardPopup(templateId = null, context = {}) {
  const { grade = "", rowData = null, semKey = "", mode = "edit" } = context || {};
  const isNew = !templateId;
  const item = isNew
    ? normalizeTemplate({ id: uid("tpl"), language: "Korean", schoolLevel: "공통" })
    : getTemplateById(templateId);
  if (!item) return;

  document.querySelector(".tpl-popup-backdrop")?.remove();

  const editable = canEdit();
  const backdrop = document.createElement("div");
  backdrop.className = "tpl-popup-backdrop";

  const modal = document.createElement("div");
  modal.className = "tpl-popup-modal";
  backdrop.appendChild(modal);

  const header = document.createElement("div");
  header.className = "tpl-popup-header";
  const titleWrap = document.createElement("div");
  titleWrap.className = "tpl-popup-title-wrap";
  const h3 = document.createElement("h3");
  h3.textContent = isNew ? "새 과목카드 추가" : getTemplateCardTitle(item);
  const sub = document.createElement("p");
  const semLabel = semKey === "merged" ? "1·2학기 동일" : (SEMESTER_LABELS[semKey] || "");
  if (grade || rowData) {
    sub.textContent = `${grade || "-"} · ${rowData?.category || "-"} / ${rowData?.track || "-"} / ${rowData?.group || "-"} · ${semLabel || "과목카드"}`;
  } else {
    const applied = getTemplateAppliedGrades(item.id).join(", ");
    sub.textContent = isNew ? "사이드바에서 새 과목카드를 추가합니다." : `사이드바 과목카드 편집${applied ? ` · 적용 학년 ${applied}` : " · 미배정"}`;
  }
  titleWrap.append(h3, sub);
  const closeBtn = makeBtn("×", "tpl-popup-close", () => backdrop.remove());
  header.append(titleWrap, closeBtn);

  const body = document.createElement("div");
  body.className = "tpl-popup-body";

  const baseSection = document.createElement("div");
  baseSection.className = "tpl-popup-section";
  const baseTitle = document.createElement("div");
  baseTitle.className = "tpl-popup-section-title";
  baseTitle.textContent = editable ? (isNew ? "새 과목카드 정보 입력" : "과목카드 기본 정보 편집") : "과목카드 기본 정보";
  const baseGrid = document.createElement("div");
  baseGrid.className = "tpl-popup-grid";

  const nameKo = createPopupInput(item.nameKo || "", !editable);
  const nameEn = createPopupInput(item.nameEn || "", !editable);
  const teacher = createPopupInput(item.teacher || "", !editable);
  teacher.setAttribute("list", "tpl-teacher-list");
  const language = createPopupSelect(item.language || "Korean", ["Korean", "English", "Both"], !editable);
  const schoolLevel = createPopupSelect(item.schoolLevel || "공통", ["공통", "중등", "고등"], !editable);

  baseGrid.append(
    createPopupField("한글명", nameKo),
    createPopupField("영문명", nameEn),
    createPopupField("교사", teacher),
    createPopupField("언어", language),
    createPopupField("과정", schoolLevel)
  );
  baseSection.append(baseTitle, baseGrid);

  const sepSection = document.createElement("div");
  sepSection.className = "tpl-popup-section";
  const sepTitle = document.createElement("label");
  sepTitle.className = "tpl-popup-section-title tpl-popup-check-title";
  const sepCheck = document.createElement("input");
  sepCheck.type = "checkbox";
  sepCheck.checked = !!item.useSemesterOverrides;
  sepCheck.disabled = !editable;
  const sepText = document.createElement("span");
  sepText.textContent = "학기별 과목명/교사 별도 사용";
  sepTitle.append(sepCheck, sepText);

  const semGrid = document.createElement("div");
  semGrid.className = "tpl-popup-sem-grid" + (sepCheck.checked ? "" : " is-disabled");
  const sem1NameKo = createPopupInput(item.sem1NameKo || "", !editable || !sepCheck.checked);
  const sem1NameEn = createPopupInput(item.sem1NameEn || "", !editable || !sepCheck.checked);
  const sem1Teacher = createPopupInput(item.sem1Teacher || "", !editable || !sepCheck.checked);
  const sem2NameKo = createPopupInput(item.sem2NameKo || "", !editable || !sepCheck.checked);
  const sem2NameEn = createPopupInput(item.sem2NameEn || "", !editable || !sepCheck.checked);
  const sem2Teacher = createPopupInput(item.sem2Teacher || "", !editable || !sepCheck.checked);
  sem1Teacher.setAttribute("list", "tpl-teacher-list");
  sem2Teacher.setAttribute("list", "tpl-teacher-list");

  const refreshSemDisabled = () => {
    const disabled = !editable || !sepCheck.checked;
    semGrid.classList.toggle("is-disabled", !sepCheck.checked);
    [sem1NameKo, sem1NameEn, sem1Teacher, sem2NameKo, sem2NameEn, sem2Teacher].forEach(input => { input.disabled = disabled; });
  };
  sepCheck.addEventListener("change", refreshSemDisabled);

  semGrid.append(
    createPopupField("1학기 한글명", sem1NameKo),
    createPopupField("1학기 영문명", sem1NameEn),
    createPopupField("1학기 교사", sem1Teacher),
    createPopupField("2학기 한글명", sem2NameKo),
    createPopupField("2학기 영문명", sem2NameEn),
    createPopupField("2학기 교사", sem2Teacher)
  );
  sepSection.append(sepTitle, semGrid);

  const rowSection = document.createElement("div");
  rowSection.className = "tpl-popup-section";
  const rowTitle = document.createElement("div");
  rowTitle.className = "tpl-popup-section-title";
  rowTitle.textContent = grade || rowData ? "보드 배치 정보" : "과목카드 적용 정보";
  const rowGrid = document.createElement("div");
  rowGrid.className = "tpl-popup-grid";
  const appliedGrades = getTemplateAppliedGrades(item.id).join(", ") || "미배정";
  const rowFields = grade || rowData
    ? [["학년", grade], ["구분", rowData?.category], ["트랙", rowData?.track], ["그룹", rowData?.group], ["시수/시간", rowData?.credits]]
    : [["적용 학년", appliedGrades], ["카드 ID", item.id], ["상태", isNew ? "신규" : "기존 카드"]];
  rowFields.forEach(([label, value]) => {
    const input = createPopupInput(value || "-", true);
    rowGrid.appendChild(createPopupField(label, input));
  });
  rowSection.append(rowTitle, rowGrid);

  body.append(baseSection, sepSection, rowSection);

  const footer = document.createElement("div");
  footer.className = "tpl-popup-footer";
  const cancelBtn = makeBtn("닫기", "secondary-btn", () => backdrop.remove());
  footer.appendChild(cancelBtn);

  if (editable) {
    const saveBtn = makeBtn("저장", "primary-btn", () => {
      item.nameKo = nameKo.value.trim();
      item.nameEn = nameEn.value.trim();
      item.teacher = teacher.value.trim();
      item.language = language.value;
      item.schoolLevel = schoolLevel.value;
      item.useSemesterOverrides = sepCheck.checked;
      item.sem1NameKo = sem1NameKo.value.trim();
      item.sem1NameEn = sem1NameEn.value.trim();
      item.sem1Teacher = sem1Teacher.value.trim();
      item.sem2NameKo = sem2NameKo.value.trim();
      item.sem2NameEn = sem2NameEn.value.trim();
      item.sem2Teacher = sem2Teacher.value.trim();

      if (!item.nameKo && !item.nameEn && !(item.useSemesterOverrides && (item.sem1NameKo || item.sem1NameEn))) {
        alert("한글명 또는 영문명을 입력해 주세요.");
        return;
      }
      if (isNew) {
        appState.templates.templates.push(item);
      }
      scheduleSave("templates");
      document.dispatchEvent(new CustomEvent("his:template-updated", { detail: { templateId: item.id, isNew } }));
      backdrop.remove();
    });
    footer.appendChild(saveBtn);
  }

  modal.append(header, body, footer);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) backdrop.remove(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { backdrop.remove(); document.removeEventListener("keydown", onEsc); }
  });
  document.body.appendChild(backdrop);
}

function attachExpandClick(card, meta, context = {}) {
  card.addEventListener("click", e => {
    if (e.target.closest("button")) return;
    if (context.templateId) {
      openTemplateCardPopup(context.templateId, { grade: context.grade, rowData: context.rowData, semKey: context.semKey });
      return;
    }
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
  card.append(top, meta); attachExpandClick(card, meta, { templateId, grade, rowData, semKey }); return card;
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
  const meta = buildExpandedMeta(item, item); card.append(top, meta); attachExpandClick(card, meta, { templateId, grade, rowData, semKey: "merged" }); return card;
}

function createDropCell(grade, rowData, semKey, templateId) {
  const cell = document.createElement("div"); cell.className = templateId ? "drop-cell" : "drop-cell empty";
  if (templateId) cell.appendChild(createPlacedCard(templateId, grade, rowData, semKey));
  cell.addEventListener("dragover", e => { if (!canEdit()) return; e.preventDefault(); cell.classList.add("dragover"); });
  cell.addEventListener("dragleave", () => cell.classList.remove("dragover"));
  cell.addEventListener("drop", e => {
    if (!canEdit()) return; e.preventDefault(); cell.classList.remove("dragover");
    const drag = currentDrag; if (!drag) return;
    if (drag.kind === "template") {
      if (!templateId) autoFillRowFromTemplate(grade, rowData.id, drag.templateId);
      placeBothSems(drag.templateId, grade, rowData.id); return;
    }
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
      if (drag.sourceSemKey === "merged") { if (sRow && !(drag.sourceGrade === grade && drag.sourceRowId === rowData.id)) { const od = dRow.sem1TemplateId; dRow.sem1TemplateId = mv; dRow.sem2TemplateId = mv; sRow.sem1TemplateId = od; sRow.sem2TemplateId = od; scheduleSave("curriculum"); _onCurriculumChange(); } }
      else { dRow.sem1TemplateId = mv; dRow.sem2TemplateId = mv; if (sRow) sRow[`${drag.sourceSemKey}TemplateId`] = null; scheduleSave("curriculum"); _onCurriculumChange(); }
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
  const crd = document.createElement("div"); crd.className = "category-summary-value";
  crd.textContent = clean(category) === "창체" ? `Total #Hours ${s.totalHours || 0}` : `Total #Credits ${s.totalCredits}`;
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
    titleEl.innerHTML = `<div class="grade-title-top"><span class="grade-title-name">${grade}</span><div class="grade-title-totals"><span class="grade-title-badge">Total #Courses ${gs.totalCourses}</span><span class="grade-title-badge">Total #Credits ${gs.totalCredits}</span></div></div>`;
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
      _onCurriculumChange();
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
