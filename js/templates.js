// ================================================================
// templates.js · Template/Group Mutations + All Template Rendering
// ================================================================
import { GRADE_KEYS, SEMESTER_LABELS } from "./config.js";
import { uid, clean, uniqueOrdered, makeBtn, languageClass, escapeHtml, cloneJson } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave, ensureConsistency, normalizeTemplate, normalizeTemplateGroup, currentDrag, setCurrentDrag } from "./state.js";

const tDomain   = () => appState.templates;
const templates = () => tDomain().templates;
const groups    = () => tDomain().templateGroups;

// ── Template lookups (exported for curriculum.js) ──────────────────
export function getTemplateById(id)         { return templates().find(t => t.id === id) || null; }
export function getTemplateGroupById(id, src) { return ((src || tDomain()).templateGroups || []).find(g => g.id === id) || null; }

export function getTemplateCardTitle(item) {
  if (!item) return "-";
  return clean(item.nameKo)||clean(item.sem1NameKo)||clean(item.nameEn)||clean(item.sem1NameEn)||"-";
}

export function getSemesterTemplateData(tplOrId, semKey) {
  const item = typeof tplOrId === "string" ? getTemplateById(tplOrId) : tplOrId;
  if (!item) return { nameKo:"", nameEn:"", teacher:"", language:"Both" };
  const p = semKey === "sem2" ? "sem2" : "sem1";
  return {
    nameKo:   clean(item[`${p}NameKo`])  || clean(item.nameKo)  || clean(item.nameEn),
    nameEn:   clean(item[`${p}NameEn`])  || clean(item.nameEn)  || clean(item.nameKo),
    teacher:  clean(item[`${p}Teacher`]) || clean(item.teacher),
    language: item.language || "Both"
  };
}

export function isSemesterDataSame(item) {
  if (!item) return false;
  if (!item.useSemesterOverrides) return true;
  const s1 = getSemesterTemplateData(item, "sem1");
  const s2 = getSemesterTemplateData(item, "sem2");
  return s1.nameKo === s2.nameKo && s1.nameEn === s2.nameEn && s1.teacher === s2.teacher;
}

export function getTemplateTeacherSummary(item) {
  return uniqueOrdered([getSemesterTemplateData(item, "sem1").teacher, getSemesterTemplateData(item, "sem2").teacher].filter(Boolean)).join(" · ");
}

function getCommonTeacherCandidate(item) {
  if (clean(item.teacher)) return clean(item.teacher);
  const t1 = clean(item.sem1Teacher), t2 = clean(item.sem2Teacher);
  return t1 && t1 === t2 ? t1 : "";
}

export function getTemplateAppliedGrades(templateId) {
  return GRADE_KEYS.filter(grade => (appState.curriculum.gradeBoards[grade] || []).some(r => r.sem1TemplateId === templateId || r.sem2TemplateId === templateId)).map(g => g.replace("학년",""));
}

// ── Template Mutations ────────────────────────────────────────────
export function deleteTemplate(templateId) {
  if (!canEdit()) return;
  const item = getTemplateById(templateId); if (!item) return;
  if (!confirm(`"${getTemplateCardTitle(item)}" 카드를 삭제할까요?`)) return;
  tDomain().templates = templates().filter(t => t.id !== templateId);
  // Clear from curriculum
  GRADE_KEYS.forEach(grade => { (appState.curriculum.gradeBoards[grade] || []).forEach(row => { if (row.sem1TemplateId === templateId) row.sem1TemplateId = null; if (row.sem2TemplateId === templateId) row.sem2TemplateId = null; }); });
  scheduleSave("templates"); scheduleSave("curriculum");
}

export function copyTemplate(templateId) {
  if (!canEdit()) return null;
  const src = getTemplateById(templateId); if (!src) return null;
  const copy = normalizeTemplate({
    ...cloneJson(src),
    id: uid("tpl"),
    nameKo:    src.nameKo    ? src.nameKo    + " (복사)" : "",
    nameEn:    src.nameEn    ? src.nameEn    + " (copy)" : "",
    sem1NameKo: src.sem1NameKo ? src.sem1NameKo + " (복사)" : "",
    sem1NameEn: src.sem1NameEn ? src.sem1NameEn + " (copy)" : "",
    sem2NameKo: src.sem2NameKo ? src.sem2NameKo + " (복사)" : "",
    sem2NameEn: src.sem2NameEn ? src.sem2NameEn + " (copy)" : "",
  });
  templates().push(copy);
  scheduleSave("templates");
  return copy;
}

export function assignTemplateGroup(templateId, groupId) {
  if (!canEdit()) return;
  const item = templates().find(t => t.id === templateId); if (!item) return;
  item.calcGroupId = groupId || null; scheduleSave("templates");
}

export function addLiveTemplateGroup() {
  if (!canEdit()) return;
  groups().push(normalizeTemplateGroup({ id:uid("grp"), name:`그룹 ${groups().length+1}`, creditValue:"" }));
  scheduleSave("templates");
}

export function renameLiveTemplateGroup(groupId, newName) {
  if (!canEdit()) return;
  const g = groups().find(g => g.id === groupId); if (!g) return;
  g.name = newName; scheduleSave("templates");
}

export function deleteLiveTemplateGroup(groupId) {
  if (!canEdit()) return;
  if (!confirm("이 그룹을 삭제할까요?")) return;
  tDomain().templateGroups = groups().filter(g => g.id !== groupId);
  templates().forEach(t => { if (t.calcGroupId === groupId) t.calcGroupId = null; });
  scheduleSave("templates");
}

// ── Template Form State ───────────────────────────────────────────
export let templateEditId = null;
export let templateFormSchoolLevel = "공통";
export const setTemplateEditId = v => { templateEditId = v; };
export const setTemplateFormSchoolLevel = v => { templateFormSchoolLevel = v; };

// ── Template Manager Draft ────────────────────────────────────────
let _draft = null;
export function getOrCreateDraft() {
  if (!_draft) _draft = { templates: templates().map(t => normalizeTemplate(cloneJson(t))), templateGroups: groups().map(g => normalizeTemplateGroup(cloneJson(g))) };
  return _draft;
}
export function resetDraft() { _draft = null; }

export async function commitDraft() {
  if (!canEdit()) return;
  const d = getOrCreateDraft();
  const vgids = new Set(d.templateGroups.map(g => g.id));
  d.templates = d.templates.map(t => { const n = normalizeTemplate(t); if (n.calcGroupId && !vgids.has(n.calcGroupId)) n.calcGroupId = null; return n; });
  d.templateGroups = d.templateGroups.map(normalizeTemplateGroup);
  tDomain().templates      = d.templates.map(t => normalizeTemplate(cloneJson(t)));
  tDomain().templateGroups = d.templateGroups.map(g => normalizeTemplateGroup(cloneJson(g)));
  resetDraft(); scheduleSave("templates");
}

// ── Sidebar: Template Cards ───────────────────────────────────────
let _sidebarLevel = "전체";
export const setSidebarLevel = v => { _sidebarLevel = v; };
const levelFilter = t => _sidebarLevel === "전체" || t.schoolLevel === _sidebarLevel || t.schoolLevel === "공통";

function createSemesterPreviewItem(item, semKey) {
  const data = getSemesterTemplateData(item, semKey);
  const wrap = document.createElement("div"); wrap.className = "semester-preview-item";
  const lbl = document.createElement("div"); lbl.className = "semester-preview-label"; lbl.textContent = SEMESTER_LABELS[semKey];
  const nm  = document.createElement("div"); nm.className  = "semester-preview-name";  nm.textContent  = data.nameKo || data.nameEn || "-";
  wrap.append(lbl, nm);
  if (data.nameEn && data.nameEn !== data.nameKo) { const e = document.createElement("div"); e.className = "semester-preview-en"; e.textContent = data.nameEn; wrap.appendChild(e); }
  if (data.teacher) { const te = document.createElement("div"); te.className = "semester-preview-teacher"; te.textContent = data.teacher; wrap.appendChild(te); }
  return wrap;
}

export function createTemplateCard(item, { onEdit, onDelete, onCopy }) {
  const card = document.createElement("div");
  card.className = `template-card compact-card ${languageClass(item.language)}`;
  card.draggable = canEdit();
  card.addEventListener("dragstart", () => { setCurrentDrag({ kind:"template", templateId:item.id }); card.classList.add("dragging"); });
  card.addEventListener("dragend",   () => { setCurrentDrag(null); card.classList.remove("dragging"); });

  const main = document.createElement("div"); main.className = "template-main";
  const titleEl = document.createElement("div"); titleEl.className = "template-name-ko"; titleEl.textContent = getTemplateCardTitle(item);
  main.appendChild(titleEl);
  if (item.schoolLevel && item.schoolLevel !== "공통") {
    const dot = document.createElement("span"); dot.className = `school-level-dot level-dot-${item.schoolLevel === "중등" ? "middle" : "high"}`; dot.title = item.schoolLevel; main.appendChild(dot);
  }

  const actions = document.createElement("div"); actions.className = "template-actions compact-actions";
  const editBtn   = makeBtn("수정", "edit-btn",   () => onEdit && onEdit(item.id));
  const copyBtn   = makeBtn("복사", "copy-btn",   () => onCopy && onCopy(item.id));
  const deleteBtn = makeBtn("삭제", "delete-btn", () => onDelete && onDelete(item.id));
  editBtn.disabled = !canEdit(); copyBtn.disabled = !canEdit(); deleteBtn.disabled = !canEdit();
  [editBtn, copyBtn, deleteBtn].forEach(b => b.addEventListener("mousedown", e => e.stopPropagation()));
  const tInfo = document.createElement("span"); tInfo.className = "template-teacher-inline"; tInfo.textContent = getTemplateTeacherSummary(item) || "-";
  actions.append(editBtn, copyBtn, deleteBtn, tInfo);

  // Applied grades display
  const gradesEl = document.createElement("div"); gradesEl.className = "template-applied-grades";
  const appliedGrades = getTemplateAppliedGrades(item.id);
  if (appliedGrades.length) {
    appliedGrades.forEach(g => {
      const chip = document.createElement("span"); chip.className = "grade-chip"; chip.textContent = g + "학년";
      gradesEl.appendChild(chip);
    });
  } else {
    const chip = document.createElement("span"); chip.className = "grade-chip grade-chip-none"; chip.textContent = "미배정";
    gradesEl.appendChild(chip);
  }

  const preview = document.createElement("div"); preview.className = "template-semester-preview";
  if (isSemesterDataSame(item)) { const s = createSemesterPreviewItem(item, "sem1"); s.style.gridColumn = "1 / -1"; preview.appendChild(s); }
  else { preview.append(createSemesterPreviewItem(item, "sem1"), createSemesterPreviewItem(item, "sem2")); }

  card.append(main, actions, gradesEl, preview);
  card.addEventListener("click", e => {
    if (e.target.closest("button")) return;
    const was = card.classList.contains("expanded");
    document.querySelectorAll(".template-card.expanded").forEach(el => el.classList.remove("expanded"));
    if (!was) card.classList.add("expanded");
  });
  return card;
}

export function renderTemplates(container, { onEdit, onDelete, onCopy }) {
  container.innerHTML = "";
  const validGroupIds = new Set(groups().map(g => g.id));

  groups().forEach(group => {
    const members = templates().filter(t => t.calcGroupId === group.id && levelFilter(t)).sort((a,b) => getTemplateCardTitle(a).localeCompare(getTemplateCardTitle(b), "ko"));
    if (!members.length) return;
    const hdr = document.createElement("div"); hdr.className = "template-group-header"; hdr.textContent = group.name;
    container.appendChild(hdr);
    members.forEach(t => container.appendChild(createTemplateCard(t, { onEdit, onDelete, onCopy })));
  });

  const ungrouped = templates().filter(t => (!t.calcGroupId || !validGroupIds.has(t.calcGroupId)) && levelFilter(t)).sort((a,b) => getTemplateCardTitle(a).localeCompare(getTemplateCardTitle(b), "ko"));
  if (ungrouped.length) {
    if (groups().length) { const sep = document.createElement("div"); sep.className = "template-group-header template-group-header-none"; sep.textContent = "그룹 없음"; container.appendChild(sep); }
    ungrouped.forEach(t => container.appendChild(createTemplateCard(t, { onEdit, onDelete, onCopy })));
  }
}

// ── Group Manager View ────────────────────────────────────────────
let _groupManagerLevel = "전체";
export const setGroupManagerLevel = v => { _groupManagerLevel = v; };
const gmLevelFilter = t => _groupManagerLevel === "전체" || t.schoolLevel === _groupManagerLevel || t.schoolLevel === "공통";

function createGroupManagerCard(item) {
  const card = document.createElement("div"); card.className = `group-mgr-card ${languageClass(item.language)}`; card.draggable = canEdit();
  card.addEventListener("dragstart", () => { setCurrentDrag({ kind:"template", templateId:item.id }); card.classList.add("dragging"); });
  card.addEventListener("dragend",   () => { setCurrentDrag(null); card.classList.remove("dragging"); });
  const tRow = document.createElement("div"); tRow.className = "group-mgr-card-top";
  const t = document.createElement("div"); t.className = "group-mgr-card-title"; t.textContent = getTemplateCardTitle(item);
  tRow.appendChild(t);
  if (item.schoolLevel && item.schoolLevel !== "공통") { const dot = document.createElement("span"); dot.className = `school-level-dot level-dot-${item.schoolLevel==="중등"?"middle":"high"}`; dot.title = item.schoolLevel; tRow.appendChild(dot); }
  const s = document.createElement("div"); s.className = "group-mgr-card-teacher"; s.textContent = getTemplateTeacherSummary(item);
  card.append(tRow, s); return card;
}

function createGroupCol(colGroupId, colGroupName, onRender) {
  const col = document.createElement("div"); col.className = "group-col"; if (!colGroupId) col.classList.add("group-col-unassigned");
  const hdr = document.createElement("div"); hdr.className = "group-col-header";
  if (colGroupId) {
    const inp = document.createElement("input"); inp.type = "text"; inp.className = "group-col-name-input"; inp.value = colGroupName; inp.disabled = !canEdit();
    inp.addEventListener("change", e => { renameLiveTemplateGroup(colGroupId, e.target.value); onRender && onRender(); });
    hdr.appendChild(inp);

    // Group type selector
    const groupObj = groups().find(g => g.id === colGroupId);
    const typeWrap = document.createElement("div"); typeWrap.className = "group-type-wrap";
    const typeSel  = document.createElement("select"); typeSel.className = "group-type-select"; typeSel.disabled = !canEdit();
    const typeOpts = [
      { value: "concurrent",  label: "⏰ 동시 수업" },
      { value: "cross-grade", label: "🔗 다학년 통합" }
    ];
    typeOpts.forEach(({ value, label }) => {
      const o = document.createElement("option"); o.value = value; o.textContent = label;
      if (groupObj?.groupType === value) o.selected = true;
      typeSel.appendChild(o);
    });
    typeSel.addEventListener("change", e => {
      const g = groups().find(g => g.id === colGroupId); if (!g) return;
      g.groupType = e.target.value; scheduleSave("templates"); onRender && onRender();
    });
    typeWrap.appendChild(typeSel);
    hdr.appendChild(typeWrap);

    const del = makeBtn("삭제", "group-col-del-btn", () => { deleteLiveTemplateGroup(colGroupId); onRender && onRender(); }); del.disabled = !canEdit(); hdr.appendChild(del);
  } else {
    const lbl = document.createElement("span"); lbl.className = "group-col-name-label"; lbl.textContent = "미배정"; hdr.appendChild(lbl);
  }
  col.appendChild(hdr);

  const body = document.createElement("div"); body.className = "group-col-body";
  body.addEventListener("dragover", e => { if (!canEdit()) return; e.preventDefault(); body.classList.add("dragover"); });
  body.addEventListener("dragleave", () => body.classList.remove("dragover"));
  body.addEventListener("drop", e => {
    if (!canEdit()) return; e.preventDefault(); body.classList.remove("dragover");
    const drag = currentDrag; if (!drag || drag.kind !== "template") return;
    assignTemplateGroup(drag.templateId, colGroupId); onRender && onRender();
  });

  const validIds = new Set(groups().map(g => g.id));
  const members = templates().filter(t => gmLevelFilter(t) && (colGroupId ? t.calcGroupId === colGroupId : (!t.calcGroupId || !validIds.has(t.calcGroupId)))).sort((a,b) => getTemplateCardTitle(a).localeCompare(getTemplateCardTitle(b), "ko"));

  if (!members.length) { const ph = document.createElement("div"); ph.className = "group-col-placeholder"; ph.textContent = "카드를 여기로 드래그"; body.appendChild(ph); }
  else members.forEach(item => body.appendChild(createGroupManagerCard(item)));
  col.appendChild(body); return col;
}

export function renderGroupManager(board, onRender) {
  board.innerHTML = "";
  const filterBar = document.createElement("div"); filterBar.className = "group-level-filter-bar";
  ["전체","중등","고등"].forEach(level => {
    const btn = makeBtn(level === "전체" ? "전체" : level === "중등" ? "📘 중등" : "📗 고등", "group-level-btn" + (_groupManagerLevel === level ? " active" : ""), () => { _groupManagerLevel = level; renderGroupManager(board, onRender); });
    filterBar.appendChild(btn);
  });
  board.appendChild(filterBar);
  const wrap = document.createElement("div"); wrap.className = "group-col-wrap";
  wrap.appendChild(createGroupCol(null, "미배정", onRender));
  groups().forEach(g => wrap.appendChild(createGroupCol(g.id, g.name, onRender)));
  board.appendChild(wrap);
}

// ── Template Manager Table View ───────────────────────────────────
export const managerUi = { search:"", language:"all", split:"all", sort:"ko-asc", level:"전체" };

export function getFilteredTemplates(draft) {
  const src = draft || { templates: templates(), templateGroups: groups() };
  const srch = clean(managerUi.search).toLowerCase();
  const filtered = src.templates.filter(item => {
    if (managerUi.language !== "all" && item.language !== managerUi.language) return false;
    if (managerUi.split  === "split" && !item.useSemesterOverrides) return false;
    if (managerUi.split  === "same"  &&  item.useSemesterOverrides) return false;
    if (managerUi.level  !== "전체"  &&  item.schoolLevel !== managerUi.level) return false;
    if (srch) { const h = [item.nameKo,item.nameEn,item.teacher,item.sem1NameKo,item.sem1NameEn,item.sem1Teacher,item.sem2NameKo,item.sem2NameEn,item.sem2Teacher].join(" ").toLowerCase(); if (!h.includes(srch)) return false; }
    return true;
  });
  const sv = (item, k) => clean(k === "en" ? (item.nameEn||item.sem1NameEn||item.nameKo) : (item.nameKo||item.sem1NameKo||item.nameEn));
  filtered.sort((a,b) => {
    switch (managerUi.sort) {
      case "ko-desc": return sv(b,"ko").localeCompare(sv(a,"ko"),"ko");
      case "en-asc":  return sv(a,"en").localeCompare(sv(b,"en"),"en");
      case "language": return `${a.language}-${sv(a,"ko")}`.localeCompare(`${b.language}-${sv(b,"ko")}`,"ko");
      case "group": { const ga = getTemplateGroupById(a.calcGroupId, src)?.name||""; const gb = getTemplateGroupById(b.calcGroupId, src)?.name||""; return `${ga}-${sv(a,"ko")}`.localeCompare(`${gb}-${sv(b,"ko")}`,"ko"); }
      default: return sv(a,"ko").localeCompare(sv(b,"ko"),"ko");
    }
  });
  return filtered;
}

export function renderTemplateManagerTable(wrap, countEl) {
  const draft = getOrCreateDraft();
  const rows  = getFilteredTemplates(draft);
  if (countEl) countEl.textContent = `${rows.length} / ${draft.templates.length}개 표시`;
  if (!rows.length) { wrap.innerHTML = '<div class="manager-empty">검색 조건에 맞는 과목카드가 없습니다.</div>'; return; }

  const buildGroupOpts = selId => ['<option value="">없음</option>'].concat(draft.templateGroups.map(g => `<option value="${escapeHtml(g.id)}" ${selId===g.id?"selected":""}>${escapeHtml(g.name)}</option>`)).join("");

  const bodyRows = rows.map(item => {
    const grades = getTemplateAppliedGrades(item.id);
    const gradeChips = grades.length ? grades.map(g => `<span class="usage-chip">${g}</span>`).join("") : '<span style="color:#9ca3af;font-size:10px">-</span>';
    return `<tr data-template-id="${item.id}">
      <td class="col-delete"><button type="button" class="row-delete-btn-inline" data-action="delete-template">삭제</button></td>
      <td class="col-usage usage-cell">${gradeChips}</td>
      <td class="col-schoollevel"><select data-field="schoolLevel">${["중등","고등","공통"].map(l=>`<option value="${l}" ${item.schoolLevel===l?"selected":""}>${l}</option>`).join("")}</select></td>
      <td><input type="text" data-field="nameKo" value="${escapeHtml(item.nameKo)}" /></td>
      <td><input type="text" data-field="nameEn" value="${escapeHtml(item.nameEn)}" /></td>
      <td><input type="text" data-field="teacher" value="${escapeHtml(item.teacher)}" /></td>
      <td class="col-language"><select data-field="language">${["Korean","English","Both"].map(l=>`<option value="${l}" ${item.language===l?"selected":""}>${l}</option>`).join("")}</select></td>
      <td class="col-group"><select data-field="calcGroupId">${buildGroupOpts(item.calcGroupId||"")}</select></td>
      <td class="col-toggle toggle-cell"><input type="checkbox" data-field="useSemesterOverrides" ${item.useSemesterOverrides?"checked":""} /></td>
      <td><input type="text" data-field="sem1NameKo" value="${escapeHtml(item.sem1NameKo)}" /></td>
      <td><input type="text" data-field="sem1NameEn" value="${escapeHtml(item.sem1NameEn)}" /></td>
      <td><input type="text" data-field="sem1Teacher" value="${escapeHtml(item.sem1Teacher)}" /></td>
      <td><input type="text" data-field="sem2NameKo" value="${escapeHtml(item.sem2NameKo)}" /></td>
      <td><input type="text" data-field="sem2NameEn" value="${escapeHtml(item.sem2NameEn)}" /></td>
      <td><input type="text" data-field="sem2Teacher" value="${escapeHtml(item.sem2Teacher)}" /></td>
    </tr>`;
  }).join("");

  wrap.innerHTML = `<table class="manager-table"><thead><tr>
    <th class="col-delete">삭제</th><th class="col-usage">적용 학년</th><th class="col-schoollevel">구분</th>
    <th>한글 이름</th><th>영어 이름</th><th>공통 교사</th>
    <th class="col-language">언어</th><th class="col-group">계산 그룹</th><th class="col-toggle">학기 분리</th>
    <th>1학기 한글</th><th>1학기 영어</th><th>1학기 교사</th>
    <th>2학기 한글</th><th>2학기 영어</th><th>2학기 교사</th>
  </tr></thead><tbody>${bodyRows}</tbody></table>`;
}

export function handleTableInput(e) {
  const row = e.target.closest("tr[data-template-id]"); if (!row) return;
  const d = getOrCreateDraft(); const item = d.templates.find(t => t.id === row.dataset.templateId); if (!item) return;
  const f = e.target.dataset.field; if (!f) return;
  item[f] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
}

export function handleTableChange(e, rerender) {
  const row = e.target.closest("tr[data-template-id]"); if (!row) return;
  const d = getOrCreateDraft(); const item = d.templates.find(t => t.id === row.dataset.templateId); if (!item) return;
  const f = e.target.dataset.field; if (!f) return;
  item[f] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  if (["language","calcGroupId","useSemesterOverrides","schoolLevel"].includes(f)) rerender && rerender();
}

export function handleTableDeleteClick(e, rerender) {
  const btn = e.target.closest("button[data-action='delete-template']"); if (!btn) return;
  if (!canEdit()) return;
  const row = btn.closest("tr[data-template-id]"); if (!row) return;
  const d = getOrCreateDraft(); const tgt = d.templates.find(t => t.id === row.dataset.templateId); if (!tgt) return;
  if (!confirm(`"${getTemplateCardTitle(tgt)}" 카드를 삭제할까요?`)) return;
  d.templates = d.templates.filter(t => t.id !== tgt.id); rerender && rerender();
}

export function addTemplateManagerRow() {
  if (!canEdit()) return;
  const d = getOrCreateDraft(); d.templates.unshift(normalizeTemplate({ id:uid("tpl"), language:"Both" }));
}
