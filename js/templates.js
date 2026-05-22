// ================================================================
// templates.js · Template/Group Mutations + All Template Rendering
// ================================================================
import { GRADE_KEYS, SEMESTER_LABELS } from "./config.js";
import { uid, clean, uniqueOrdered, makeBtn, languageClass, escapeHtml, cloneJson } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave, saveNow, ensureConsistency, normalizeTemplate, normalizeTemplateGroup, currentDrag, setCurrentDrag } from "./state.js";

const tDomain   = () => appState.templates;
const templates = () => tDomain().templates;
const groups    = () => tDomain().templateGroups;

// Keep template rendering independent from rosters.js at startup.
// This reads the already-loaded appState directly and prevents the initial
// curriculum page from pulling roster/student modules just to show a badge.
function getClassCount(templateId) {
  const meta = appState.rosters?.rosterMeta?.[templateId];
  return Math.max(0, parseInt(meta?.classCount, 10) || 0);
}

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

/** Split a teacher field string into individual names */
export function splitTeacherNames(str) {
  return clean(str).split(/[,，]/).map(s => s.trim()).filter(Boolean);
}

/** Return deduplicated list of all teacher names on this template */
export function getTemplateTeacherNames(item) {
  const all = [
    getSemesterTemplateData(item, "sem1").teacher,
    getSemesterTemplateData(item, "sem2").teacher,
  ].flatMap(splitTeacherNames);
  return uniqueOrdered(all);
}

export function getTemplateTeacherSummary(item) {
  return getTemplateTeacherNames(item).join(" · ");
}

function getCommonTeacherCandidate(item) {
  if (clean(item.teacher)) return clean(item.teacher);
  const t1 = clean(item.sem1Teacher), t2 = clean(item.sem2Teacher);
  return t1 && t1 === t2 ? t1 : "";
}

export function getTemplateAppliedGrades(templateId) {
  return GRADE_KEYS.filter(grade => (appState.curriculum.gradeBoards[grade] || []).some(r => r.sem1TemplateId === templateId || r.sem2TemplateId === templateId)).map(g => g.replace("학년",""));
}

export function getTemplateCredits(templateId) {
  for (const grade of GRADE_KEYS) {
    const row = (appState.curriculum.gradeBoards[grade] || []).find(r => r.sem1TemplateId === templateId || r.sem2TemplateId === templateId);
    if (row && row.credits != null && row.credits !== "") return row.credits;
  }
  return null;
}

const MIDDLE_GRADES = ["7학년","8학년","9학년"];
const HIGH_GRADES   = ["10학년","11학년","12학년"];

/** Derive 중등/고등/공통 from where a template is placed in the curriculum board */
export function deriveSchoolLevelFromCurriculum(templateId) {
  const boards = appState.curriculum.gradeBoards;
  const inMid  = MIDDLE_GRADES.some(g => (boards[g]||[]).some(r => r.sem1TemplateId === templateId || r.sem2TemplateId === templateId));
  const inHigh = HIGH_GRADES.some(g =>   (boards[g]||[]).some(r => r.sem1TemplateId === templateId || r.sem2TemplateId === templateId));
  if (inMid && inHigh) return "공통";
  if (inMid)  return "중등";
  if (inHigh) return "고등";
  return null; // unplaced — keep stored value
}

/** Auto-sync schoolLevel for all templates from curriculum placement. Saves only when changed. */
export function syncSchoolLevels() {
  let changed = false;
  templates().forEach(t => {
    const derived = deriveSchoolLevelFromCurriculum(t.id);
    if (derived && t.schoolLevel !== derived) { t.schoolLevel = derived; changed = true; }
  });
  if (changed) scheduleSave("templates");
}

/** Return list of subject titles where this teacher name appears in any template */
export function getSubjectsForTeacher(teacherName) {
  const name = clean(teacherName);
  if (!name) return [];
  const seen = new Set();
  const result = [];
  templates().forEach(t => {
    const allNames = [t.teacher, t.sem1Teacher, t.sem2Teacher]
      .flatMap(splitTeacherNames);
    if (allNames.includes(name)) {
      const title = getTemplateCardTitle(t);
      if (title && !seen.has(title)) { seen.add(title); result.push(title); }
    }
  });
  return result;
}

// ── Template Mutations ────────────────────────────────────────────
export function deleteTemplate(templateId) {
  if (!canEdit()) return;
  const item = getTemplateById(templateId); if (!item) return;
  if (!confirm(`"${getTemplateCardTitle(item)}" 카드를 삭제할까요?\n\n커리큘럼, 수강명단, 시간표 카드, 시간표 배치에서도 제거됩니다.`)) return;

  // 삭제 전에 연결된 시간표 카드 ID를 먼저 확보해야 합니다.
  // ttcards를 먼저 지운 뒤 find()로 찾으면 그룹의 poolCardIds/unit.ttcardIds에 죽은 ID가 남습니다.
  const deletedTtcardIds = new Set(
    (appState.timetable?.ttcards || [])
      .filter(c => c.templateId === templateId)
      .map(c => c.id)
  );

  // 1. templates
  tDomain().templates = templates().filter(t => t.id !== templateId);

  // 2. curriculum boards
  GRADE_KEYS.forEach(grade => {
    (appState.curriculum.gradeBoards[grade] || []).forEach(row => {
      if (row.sem1TemplateId === templateId) row.sem1TemplateId = null;
      if (row.sem2TemplateId === templateId) row.sem2TemplateId = null;
    });
  });

  // 3. rosters
  if (appState.rosters) {
    delete appState.rosters.rosters?.[templateId];
    delete appState.rosters.rosterMeta?.[templateId];
  }

  // 4. timetable cards + entries
  if (appState.timetable) {
    appState.timetable.ttcards = (appState.timetable.ttcards || [])
      .filter(c => c.templateId !== templateId);

    appState.timetable.entries = (appState.timetable.entries || []).filter(e =>
      e.templateId !== templateId &&
      !(e.templateIds || []).includes(templateId) &&
      !deletedTtcardIds.has(e.ttcardId) &&
      !(e.ttcardIds || []).some(id => deletedTtcardIds.has(id))
    );
  }

  // 5. templateGroups pool + units
  (appState.templates.templateGroups || []).forEach(g => {
    g.poolCardIds = (g.poolCardIds || [])
      .filter(id => !deletedTtcardIds.has(id));

    (g.units || []).forEach(u => {
      u.templateIds = (u.templateIds || [])
        .filter(id => id !== templateId);

      u.ttcardIds = (u.ttcardIds || [])
        .filter(id => !deletedTtcardIds.has(id));
    });

    // 빈 unit은 남겨두면 화면에서 빈 묶음수업으로 보일 수 있어 정리합니다.
    g.units = (g.units || []).filter(u =>
      (u.templateIds || []).length > 0 || (u.ttcardIds || []).length > 0
    );
  });

  scheduleSave("templates"); scheduleSave("curriculum");
  scheduleSave("rosters"); scheduleSave("timetable");
}

export function copyTemplate(templateId) {
  if (!canEdit()) return null;
  const src = getTemplateById(templateId); if (!src) return null;
  const copy = normalizeTemplate({
    ...cloneJson(src),
    id: uid("tpl"),
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

// ── Template Manager Draft (now live-state passthrough) ───────────
// Changes go directly to appState; no separate draft copy needed.
let _onTemplateChange = () => {};
export const setOnTemplateChange = (fn) => { _onTemplateChange = fn; };

export function getOrCreateDraft() {
  // Return reference to live state — edits are immediately reflected everywhere
  return { templates: tDomain().templates, templateGroups: tDomain().templateGroups };
}
export function resetDraft() { /* no-op: live-state editing, nothing to discard */ }

export async function commitDraft() {
  if (!canEdit()) return;
  await saveNow("templates");  // 즉시 저장 (창 닫아도 누락 없음)
}

// ── Sidebar: Template Cards ───────────────────────────────────────
let _sidebarLevel = "전체";
export const setSidebarLevel = v => { _sidebarLevel = v; };
const levelFilter = t => _sidebarLevel === "전체" || t.schoolLevel === _sidebarLevel || t.schoolLevel === "공통";

function createSemesterPreviewItem(item, semKey, labelOverride = null) {
  const data = getSemesterTemplateData(item, semKey);
  const wrap = document.createElement("div");
  wrap.className = "semester-preview-item semester-preview-row";

  const lbl = document.createElement("div");
  lbl.className = "semester-preview-label";
  lbl.textContent = labelOverride || SEMESTER_LABELS[semKey];

  const line = document.createElement("div");
  line.className = "semester-preview-line";

  const ko = document.createElement("div");
  ko.className = "semester-preview-name semester-preview-ko";
  ko.textContent = data.nameKo || data.nameEn || "-";
  ko.title = ko.textContent;

  const en = document.createElement("div");
  en.className = "semester-preview-en";
  en.textContent = data.nameEn && data.nameEn !== data.nameKo ? data.nameEn : "";
  en.title = en.textContent;

  const te = document.createElement("div");
  te.className = "semester-preview-teacher";
  te.textContent = data.teacher || "-";
  te.title = te.textContent;

  line.append(ko, en, te);
  wrap.append(lbl, line);
  return wrap;
}

export function createTemplateCard(item, { onEdit, onDelete, onCopy }) {
  const card = document.createElement("div");
  card.className = `template-card compact-card ${languageClass(item.language)}`;
  card.draggable = canEdit();
  card.addEventListener("dragstart", () => { setCurrentDrag({ kind:"template", templateId:item.id }); card.classList.add("dragging"); });
  card.addEventListener("dragend",   () => { setCurrentDrag(null); card.classList.remove("dragging"); });

  const main = document.createElement("div"); main.className = "template-main template-main-one-line";
  const titleEl = document.createElement("div");
  titleEl.className = "template-name-ko";
  titleEl.textContent = getTemplateCardTitle(item);
  titleEl.title = getTemplateCardTitle(item);
  main.appendChild(titleEl);

  const actions = document.createElement("div"); actions.className = "template-actions compact-actions";
  const editBtn   = makeBtn("수정", "edit-btn",   () => onEdit && onEdit(item.id));
  const copyBtn   = makeBtn("복사", "copy-btn",   () => onCopy && onCopy(item.id));
  const deleteBtn = makeBtn("삭제", "delete-btn", () => onDelete && onDelete(item.id));
  editBtn.disabled = !canEdit(); copyBtn.disabled = !canEdit(); deleteBtn.disabled = !canEdit();
  [editBtn, copyBtn, deleteBtn].forEach(b => b.addEventListener("mousedown", e => e.stopPropagation()));
  const tInfo = document.createElement("span"); tInfo.className = "template-teacher-inline"; tInfo.textContent = getTemplateTeacherSummary(item) || "-";
  actions.append(editBtn, copyBtn, deleteBtn);

  // Applied grades display — compact one-line badge on the right side of the card
  const gradesEl = document.createElement("div");
  gradesEl.className = "template-applied-grades template-applied-grades-inline";
  const appliedGrades = getTemplateAppliedGrades(item.id);
  if (appliedGrades.length) {
    appliedGrades.forEach(g => {
      const chip = document.createElement("span");
      chip.className = "grade-chip";
      chip.textContent = g.replace("학년", "");
      chip.title = `${g.replace("학년", "")}학년`;
      gradesEl.appendChild(chip);
    });
  } else {
    const chip = document.createElement("span");
    chip.className = "grade-chip grade-chip-none";
    chip.textContent = "미배정";
    gradesEl.appendChild(chip);
  }
  main.append(gradesEl, actions);

  const preview = document.createElement("div");
  preview.className = "template-semester-preview template-semester-detail";
  // 상세보기는 항상 헤더 1행 + 학기 세부 2행 구조로 고정합니다.
  preview.append(
    createSemesterPreviewItem(item, "sem1"),
    createSemesterPreviewItem(item, "sem2")
  );

  card.append(main, preview);
  card.addEventListener("click", e => {
    if (e.target.closest("button")) return;
    const was = card.classList.contains("expanded");
    document.querySelectorAll(".template-card.expanded").forEach(el => el.classList.remove("expanded"));
    if (!was) card.classList.add("expanded");
  });
  return card;
}

const isAssigned = t => getTemplateAppliedGrades(t.id).length > 0;
const sortByAssign = list => {
  const koSort = (a, b) => getTemplateCardTitle(a).localeCompare(getTemplateCardTitle(b), "ko");
  const unassigned = list.filter(t => !isAssigned(t)).sort(koSort);
  const assigned   = list.filter(t =>  isAssigned(t)).sort(koSort);
  return { unassigned, assigned };
};

function appendSection(container, items, callbacks) {
  items.forEach(t => container.appendChild(createTemplateCard(t, callbacks)));
}

function appendSectionDivided(container, list, callbacks, showDivider) {
  const { unassigned, assigned } = sortByAssign(list);

  if (unassigned.length) {
    if (showDivider) {
      const d = document.createElement("div"); d.className = "template-assign-divider unassigned-divider";
      d.textContent = `⬜ 미배정 (${unassigned.length})`; container.appendChild(d);
    }
    appendSection(container, unassigned, callbacks);
  }
  if (assigned.length) {
    if (showDivider) {
      const d = document.createElement("div"); d.className = "template-assign-divider assigned-divider";
      d.textContent = `✅ 배정됨 (${assigned.length})`; container.appendChild(d);
    }
    appendSection(container, assigned, callbacks);
  }
}

export function renderTemplates(container, { onEdit, onDelete, onCopy }) {
  syncSchoolLevels();
  container.innerHTML = "";
  const validGroupIds = new Set(groups().map(g => g.id));
  const callbacks = { onEdit, onDelete, onCopy };

  // ── 그룹 없음 먼저 (상단) ──────────────────────────────────────
  const ungrouped = templates().filter(t => (!t.calcGroupId || !validGroupIds.has(t.calcGroupId)) && levelFilter(t));
  if (ungrouped.length) {
    if (groups().length) {
      const sep = document.createElement("div"); sep.className = "template-group-header template-group-header-none"; sep.textContent = "그룹 없음"; container.appendChild(sep);
    }
    appendSectionDivided(container, ungrouped, callbacks, true);
  }

  // ── 이름 있는 그룹 (하단) ────────────────────────────────────
  groups().forEach(group => {
    const members = templates().filter(t => t.calcGroupId === group.id && levelFilter(t));
    if (!members.length) return;
    const hdr = document.createElement("div"); hdr.className = "template-group-header"; hdr.textContent = group.name;
    container.appendChild(hdr);
    appendSectionDivided(container, members, callbacks, members.length > 1);
  });
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
  const credits = getTemplateCredits(item.id);
  if (credits != null) { const cb = document.createElement("span"); cb.className = "group-mgr-card-credits"; cb.textContent = credits; tRow.appendChild(cb); }
  const cc = getClassCount(item.id);
  if (cc > 0) { const ccb = document.createElement("span"); ccb.className = "group-mgr-card-classcount"; ccb.textContent = cc === 1 ? sectionLabel(0) : "M"; ccb.title = `${cc}개 반`; tRow.appendChild(ccb); }
  if (item.schoolLevel && item.schoolLevel !== "공통") { const dot = document.createElement("span"); dot.className = `school-level-dot level-dot-${item.schoolLevel==="중등"?"middle":"high"}`; dot.title = item.schoolLevel; tRow.appendChild(dot); }
  // Bottom row: teacher name (left) + grade chips (right)
  const botRow = document.createElement("div"); botRow.style.cssText="display:flex;justify-content:space-between;align-items:center;margin-top:2px;gap:3px";
  const s = document.createElement("div"); s.className = "group-mgr-card-teacher"; s.style.cssText="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:#6b7280";
  s.textContent = getTemplateTeacherSummary(item);
  const chipsWrap = document.createElement("div"); chipsWrap.style.cssText="display:flex;gap:1px;flex-wrap:nowrap;flex-shrink:0";
  const appliedGrades = getTemplateAppliedGrades(item.id);
  if (appliedGrades.length) {
    appliedGrades.forEach(g => { const chip = document.createElement("span"); chip.className = "grade-chip grade-chip-sm"; chip.textContent = g.replace("학년",""); chipsWrap.appendChild(chip); });
  } else {
    const chip = document.createElement("span"); chip.className = "grade-chip grade-chip-sm grade-chip-none"; chip.textContent = "-"; chipsWrap.appendChild(chip);
  }
  botRow.append(s, chipsWrap);
  card.append(tRow, botRow); return card;
}

// ── Scroll snapshot helpers ──────────────────────────────────────
function snapScroll(board) {
  return [".main-panel","#groupManagerBoard",".group-right-col",".group-left-col"]
    .map(sel => { const el = board?.closest("*")?.ownerDocument?.querySelector(sel) ?? document.querySelector(sel); return el ? { sel, top: el.scrollTop } : null; })
    .filter(Boolean);
}
function restoreScroll(snap) {
  requestAnimationFrame(() => snap.forEach(({ sel, top }) => { const el = document.querySelector(sel); if (el) el.scrollTop = top; }));
}

// ── Unit block within a group ─────────────────────────────────────
function createUnitBlock(groupId, unit, onStructureChange) {
  const wrap = document.createElement("div"); wrap.className = "group-unit-block";

  // ── Header: "묶음수업" label + (동일수업 badge) + × button ──
  const hdr = document.createElement("div"); hdr.className = "group-unit-hdr";
  const unitLabel = document.createElement("span"); unitLabel.className = "group-unit-label"; unitLabel.textContent = "묶음수업";
  hdr.appendChild(unitLabel);
  if (unit.templateIds.length > 1) {
    const sameBadge = document.createElement("span"); sameBadge.className = "group-unit-same-badge";
    sameBadge.textContent = "🔗 동일 수업"; sameBadge.title = "이름·학년이 달라도 실제 같은 수업으로 처리됩니다.";
    hdr.appendChild(sameBadge);
  }
  const spacer = document.createElement("span"); spacer.style.flex = "1"; hdr.appendChild(spacer);
  const delUnitBtn = makeBtn("×", "group-unit-del-btn", () => {
    if (!canEdit()) return;
    const g = groups().find(g => g.id === groupId); if (!g) return;
    g.units = g.units.filter(u => u.id !== unit.id);
    scheduleSave("templates"); onStructureChange();
  }); delUnitBtn.disabled = !canEdit();
  hdr.appendChild(delUnitBtn); wrap.appendChild(hdr);

  const cardArea = document.createElement("div"); cardArea.className = "group-unit-cards";
  cardArea.addEventListener("dragover", e => { if (!canEdit()) return; e.preventDefault(); cardArea.classList.add("dragover"); });
  cardArea.addEventListener("dragleave", () => cardArea.classList.remove("dragover"));
  cardArea.addEventListener("drop", e => {
    if (!canEdit()) return; e.preventDefault(); cardArea.classList.remove("dragover");
    const drag = currentDrag; if (!drag || drag.kind !== "template") return;
    const tplId = drag.templateId;
    groups().forEach(g => g.units.forEach(u => { u.templateIds = u.templateIds.filter(id => id !== tplId); }));
    assignTemplateGroup(tplId, groupId);
    if (!unit.templateIds.includes(tplId)) unit.templateIds.push(tplId);
    scheduleSave("templates"); onStructureChange();
  });

  const unitTpls = unit.templateIds.map(id => templates().find(t => t.id === id)).filter(Boolean);
  if (unitTpls.length) {
    unitTpls.forEach(tpl => {
      const c = createGroupManagerCard(tpl);
      const rx = makeBtn("↩", "group-unit-card-remove", () => {
        unit.templateIds = unit.templateIds.filter(id => id !== tpl.id);
        scheduleSave("templates"); onStructureChange();
      }); rx.title = "수업묶음에서 제거"; rx.disabled = !canEdit(); c.appendChild(rx);
      cardArea.appendChild(c);
    });
  } else {
    const ph = document.createElement("div"); ph.className = "group-unit-placeholder"; ph.textContent = "여기로 드래그"; cardArea.appendChild(ph);
  }
  wrap.appendChild(cardArea);
  return wrap;
}

// ── Group block ───────────────────────────────────────────────────
function createGroupBlock(groupId, onStructureChange) {
  const grpObj = groups().find(g => g.id === groupId); if (!grpObj) return document.createElement("div");
  const block = document.createElement("div"); block.className = "group-block";

  if (grpObj._collapsed === undefined) grpObj._collapsed = false;
  // Groups are always same-time (concurrent) — no checkbox needed
  grpObj.isConcurrent = true; grpObj.groupType = "concurrent";

  const hdr = document.createElement("div"); hdr.className = "group-block-hdr";

  const collapseBtn = document.createElement("button");
  collapseBtn.type = "button"; collapseBtn.className = "group-collapse-btn";
  collapseBtn.textContent = grpObj._collapsed ? "▶" : "▼";
  collapseBtn.title = grpObj._collapsed ? "펼치기" : "접기";

  const nameInp = document.createElement("input"); nameInp.type = "text"; nameInp.className = "group-block-name";
  nameInp.value = grpObj.name; nameInp.placeholder = "그룹 이름"; nameInp.disabled = !canEdit();
  nameInp.addEventListener("change", e => { renameLiveTemplateGroup(groupId, e.target.value); });

  const delBtn = makeBtn("삭제", "group-col-del-btn", () => { deleteLiveTemplateGroup(groupId); onStructureChange(); });
  delBtn.disabled = !canEdit();
  const hdrSpacer = document.createElement("span"); hdrSpacer.style.flex = "1";
  hdr.append(collapseBtn, nameInp, hdrSpacer, delBtn); block.appendChild(hdr);

  // Concurrent hint
  const hint = document.createElement("div"); hint.className = "group-concurrent-hint";
  hint.textContent = "이 그룹의 과목들은 같은 시간대에 배정됩니다.";
  block.appendChild(hint);

  // ── Body (collapsible) ──
  const body = document.createElement("div"); body.className = "group-block-body";
  if (grpObj._collapsed) body.style.display = "none";

  // Templates in group but not in any unit
  const allUnitTplIds = new Set(grpObj.units.flatMap(u => u.templateIds));
  const groupedNoUnit = templates().filter(t => gmLevelFilter(t) && t.calcGroupId === groupId && !allUnitTplIds.has(t.id));
  if (groupedNoUnit.length) {
    const poolDiv = document.createElement("div"); poolDiv.className = "group-ungrouped-pool";
    const poolLbl = document.createElement("div"); poolLbl.className = "group-pool-label"; poolLbl.textContent = "같은 시간에 배정되는 과목들";
    const poolCards = document.createElement("div"); poolCards.className = "group-pool-cards";
    poolCards.addEventListener("dragover", e => { if (!canEdit()) return; e.preventDefault(); poolCards.classList.add("dragover"); });
    poolCards.addEventListener("dragleave", () => poolCards.classList.remove("dragover"));
    poolCards.addEventListener("drop", e => {
      if (!canEdit()) return; e.preventDefault(); poolCards.classList.remove("dragover");
      const drag = currentDrag; if (!drag || drag.kind !== "template") return;
      grpObj.units.forEach(u => { u.templateIds = u.templateIds.filter(id => id !== drag.templateId); });
      assignTemplateGroup(drag.templateId, groupId);
      scheduleSave("templates"); onStructureChange();
    });
    groupedNoUnit.forEach(tpl => poolCards.appendChild(createGroupManagerCard(tpl)));
    poolDiv.append(poolLbl, poolCards); body.appendChild(poolDiv);
  }

  const unitsWrap = document.createElement("div"); unitsWrap.className = "group-units-wrap";
  grpObj.units.forEach(unit => unitsWrap.appendChild(createUnitBlock(groupId, unit, onStructureChange)));
  body.appendChild(unitsWrap);

  const addUnitBtn = makeBtn("+ 수업묶음 추가", "group-add-unit-btn", () => {
    if (!canEdit()) return;
    grpObj.units.push({ id: uid("unit"), name: "", templateIds: [] });
    scheduleSave("templates"); onStructureChange();
  }); addUnitBtn.disabled = !canEdit();
  body.appendChild(addUnitBtn);
  block.appendChild(body);

  // Collapse toggle wiring
  collapseBtn.addEventListener("click", () => {
    grpObj._collapsed = !grpObj._collapsed;
    body.style.display = grpObj._collapsed ? "none" : "";
    collapseBtn.textContent = grpObj._collapsed ? "▶" : "▼";
    collapseBtn.title = grpObj._collapsed ? "펼치기" : "접기";
  });

  return block;
}

export function renderGroupManager(board, onRender) {
  const snap = snapScroll(board);
  board.innerHTML = "";

  function fullRender() {
    const snapInner = snapScroll(board);
    board.innerHTML = "";
    _buildGroupManagerDOM(board, fullRender, onRender);
    restoreScroll(snapInner);
    // Sync sidebar immediately after structural change
    onRender?.();
  }

  _buildGroupManagerDOM(board, fullRender, onRender);
  restoreScroll(snap);
}

function _buildGroupManagerDOM(board, onStructureChange, onRender) {
  const filterBar = document.createElement("div"); filterBar.className = "group-level-filter-bar";
  ["전체","중등","고등"].forEach(level => {
    const btn = makeBtn(
      level === "전체" ? "전체" : level === "중등" ? "📘 중등" : "📗 고등",
      "group-level-btn" + (_groupManagerLevel === level ? " active" : ""),
      () => { _groupManagerLevel = level; const snap = snapScroll(board); board.innerHTML = ""; _buildGroupManagerDOM(board, onStructureChange, onRender); restoreScroll(snap); }
    );
    filterBar.appendChild(btn);
  });

  // ── 자동 생성 버튼 ──────────────────────────────────────────────
  const autoGenBtn = makeBtn("✨ 자동 생성", "group-auto-gen-btn", () => {
    if (!canEdit()) return;
    const GRADE_KEYS_LOCAL = ["7학년","8학년","9학년","10학년","11학년","12학년"];
    const trackMap = {};
    GRADE_KEYS_LOCAL.forEach(gradeKey => {
      const rows = appState.curriculum?.gradeBoards?.[gradeKey] || [];
      rows.forEach(row => {
        if (row.category !== "교과") return;   // 창체 등 비교과 제외
        if (!row.track || row.track === "공통") return;
        const groupKey = `${row.track}::${gradeKey}`;
        if (!trackMap[groupKey]) trackMap[groupKey] = { name: `${row.track} / ${gradeKey}`, tplIds: new Set() };
        [row.sem1TemplateId, row.sem2TemplateId].filter(Boolean).forEach(tid => trackMap[groupKey].tplIds.add(tid));
      });
    });
    const validGroups = Object.values(trackMap).filter(v => v.tplIds.size >= 2);
    if (!validGroups.length) { alert("자동 생성할 그룹이 없습니다.\n커리큘럼에 배정/선택 과목이 있는지 확인하세요."); return; }

    // Dedup: skip groups where same name already exists OR same tplIds
    const existing = groups();
    const existingNames = new Set(existing.map(g => g.name));
    const existingTplSets = existing.map(g => new Set(g.units.flatMap(u => u.templateIds)));
    const newGroups = validGroups.filter(({ name, tplIds }) => {
      if (existingNames.has(name)) return false;
      const tplArr = [...tplIds].sort().join(",");
      return !existingTplSets.some(s => [...s].sort().join(",") === tplArr);
    });

    if (!newGroups.length) { alert("이미 동일한 그룹이 모두 존재합니다."); return; }
    if (!confirm(`${newGroups.length}개 그룹을 자동 생성합니다. 계속할까요?`)) return;

    newGroups.forEach(({ name, tplIds }) => {
      const grpId = uid("grp");
      // Each template gets its own unit (같은 시간대 배정, not 묶음수업)
      const units = [...tplIds].map(tid => ({ id: uid("unit"), name: "", templateIds: [tid], sections: {} }));
      tplIds.forEach(tid => assignTemplateGroup(tid, grpId));
      groups().push(normalizeTemplateGroup({ id: grpId, name, isConcurrent: true, groupType: "concurrent", units }));
    });
    scheduleSave("templates"); onStructureChange();
    alert(`${newGroups.length}개 그룹이 생성되었습니다.`);
  });
  autoGenBtn.disabled = !canEdit();
  filterBar.appendChild(autoGenBtn);

  board.appendChild(filterBar);

  const layout = document.createElement("div"); layout.className = "group-manager-layout";

  // Left: unassigned
  const leftCol = document.createElement("div"); leftCol.className = "group-left-col";
  const leftHdr = document.createElement("div"); leftHdr.className = "group-section-hdr";
  leftHdr.appendChild(Object.assign(document.createElement("span"), { className:"group-pool-main-label", textContent:"미배정 과목" }));
  leftCol.appendChild(leftHdr);

  const validIds = new Set(groups().map(g => g.id));
  const unassigned = templates().filter(t => gmLevelFilter(t) && (!t.calcGroupId || !validIds.has(t.calcGroupId)))
    .sort((a,b) => getTemplateCardTitle(a).localeCompare(getTemplateCardTitle(b), "ko"));

  const unPool = document.createElement("div"); unPool.className = "group-unassigned-pool group-unassigned-horiz";
  unPool.addEventListener("dragover", e => { if (!canEdit()) return; e.preventDefault(); unPool.classList.add("dragover"); });
  unPool.addEventListener("dragleave", () => unPool.classList.remove("dragover"));
  unPool.addEventListener("drop", e => {
    if (!canEdit()) return; e.preventDefault(); unPool.classList.remove("dragover");
    const drag = currentDrag; if (!drag || drag.kind !== "template") return;
    groups().forEach(g => g.units.forEach(u => { u.templateIds = u.templateIds.filter(id => id !== drag.templateId); }));
    assignTemplateGroup(drag.templateId, null);
    scheduleSave("templates"); onStructureChange();
  });
  if (unassigned.length) unassigned.forEach(t => {
    const wrap = document.createElement("div"); wrap.className = "group-unassigned-card-wrap";
    wrap.appendChild(createGroupManagerCard(t));
    if (canEdit()) {
      const splitBtn = makeBtn("반 분리", "group-split-btn", () => {
        const label = prompt(`"${getTemplateCardTitle(t)}" 과목을 몇 개 반으로 분리할까요? (예: 2 → A,B / 3 → A,B,C)`, "2");
        const n = parseInt(label); if (!n || n < 2 || n > 8) { alert("2~8 사이의 숫자를 입력하세요."); return; }
        const suffixes = ["A","B","C","D","E","F","G","H"].slice(0, n);
        // Rename original to A
        t.nameKo    = (t.nameKo    || "") ? `${t.nameKo} ${suffixes[0]}`    : "";
        t.nameEn    = (t.nameEn    || "") ? `${t.nameEn} ${suffixes[0]}`    : "";
        // Clone for B, C, ...
        suffixes.slice(1).forEach(sfx => {
          const clone = normalizeTemplate({ ...cloneJson(t), id: uid("tpl"),
            nameKo: t.nameKo.replace(/ [A-H]$/, ` ${sfx}`),
            nameEn: t.nameEn.replace(/ [A-H]$/, ` ${sfx}`),
            calcGroupId: null
          });
          templates().push(clone);
        });
        scheduleSave("templates"); onStructureChange();
      });
      wrap.appendChild(splitBtn);
    }
    unPool.appendChild(wrap);
  });
  else { const ph = document.createElement("div"); ph.className = "group-col-placeholder"; ph.textContent = "모든 과목이 배정됨"; unPool.appendChild(ph); }
  leftCol.appendChild(unPool); layout.appendChild(leftCol);

  // Right: group cards
  const rightWrap = document.createElement("div"); rightWrap.className = "group-right-col-wrap";
  const rightHdr = document.createElement("div"); rightHdr.className = "group-right-col-hdr";
  rightHdr.appendChild(Object.assign(document.createElement("span"), { className:"group-pool-main-label", textContent:"그룹 목록" }));

  // ── 전체 펼치기 / 접기 ──
  const expandAll  = makeBtn("▼ 전체 펼치기", "group-expand-btn", () => { groups().forEach(g => { g._collapsed = false; }); onStructureChange(); });
  const collapseAll= makeBtn("▶ 전체 접기",   "group-expand-btn", () => { groups().forEach(g => { g._collapsed = true;  }); onStructureChange(); });
  const togWrap = document.createElement("div"); togWrap.style.cssText="display:flex;gap:4px;margin-left:auto";
  togWrap.append(expandAll, collapseAll); rightHdr.appendChild(togWrap);
  rightHdr.style.display = "flex"; rightHdr.style.alignItems = "center";
  rightWrap.appendChild(rightHdr);

  const rightCol = document.createElement("div"); rightCol.className = "group-right-col";
  let _dragGroupId = null;

  groups().forEach(g => {
    const block = createGroupBlock(g.id, onStructureChange);
    block.setAttribute("data-group-id", g.id);

    // Drag handle for reordering
    const dragHandle = document.createElement("div"); dragHandle.className = "group-drag-handle";
    dragHandle.title = "드래그해서 순서 변경"; dragHandle.textContent = "⠿";
    dragHandle.style.cssText = "cursor:grab;font-size:14px;color:#9ca3af;padding:0 4px;flex-shrink:0;align-self:center;user-select:none";
    dragHandle.setAttribute("draggable", "true");

    dragHandle.addEventListener("dragstart", e => {
      e.stopPropagation();
      _dragGroupId = g.id;
      block.style.opacity = "0.5";
      e.dataTransfer.effectAllowed = "move";
    });
    dragHandle.addEventListener("dragend", () => { block.style.opacity = ""; _dragGroupId = null; });

    block.addEventListener("dragover", e => {
      if (!_dragGroupId || _dragGroupId === g.id) return;
      e.preventDefault(); e.stopPropagation();
      block.style.outline = "2px dashed #2563eb";
    });
    block.addEventListener("dragleave", () => { block.style.outline = ""; });
    block.addEventListener("drop", e => {
      if (!_dragGroupId || _dragGroupId === g.id) return;
      e.preventDefault(); e.stopPropagation(); block.style.outline = "";
      const grps = groups();
      const fromIdx = grps.findIndex(x => x.id === _dragGroupId);
      const toIdx   = grps.findIndex(x => x.id === g.id);
      if (fromIdx >= 0 && toIdx >= 0) {
        const [moved] = grps.splice(fromIdx, 1);
        grps.splice(toIdx, 0, moved);
        scheduleSave("templates"); onStructureChange();
      }
    });

    // Prepend drag handle to block header
    const hdr = block.querySelector(".group-block-hdr");
    if (hdr) hdr.insertBefore(dragHandle, hdr.firstChild);

    rightCol.appendChild(block);
  });
  if (!groups().length) {
    rightCol.appendChild(Object.assign(document.createElement("div"), { className:"group-col-placeholder", textContent:"'그룹 추가'를 눌러 시작하세요.", style:"padding:20px" }));
  }
  rightWrap.appendChild(rightCol); layout.appendChild(rightWrap);
  board.appendChild(layout);

  // Also trigger external onRender for sidebar sync (but don't re-render group manager)
  // This is called only when structure actually changes, not for simple edits
}


// ── Teacher datalist (shared by table + sidebar form) ────────────
export function updateTeacherDatalist() {
  let dl = document.getElementById("tpl-teacher-list");
  if (!dl) { dl = document.createElement("datalist"); dl.id = "tpl-teacher-list"; document.body.appendChild(dl); }
  const names = (appState.teachers?.teachers || [])
    .map(t => clean(t.name)).filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ko"));
  dl.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">`).join("");
}

/** Parse TSV pasted from Excel into template objects */
export function parseTemplatePaste(raw) {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const result = [];
  for (const line of lines) {
    // Try tab split first, fall back to 2+ spaces
    let cols = line.split(/\t/).map(c => c.trim());
    if (cols.length < 2) cols = line.split(/\s{2,}/).map(c => c.trim()).filter((_, i, a) => i === 0 || a[i]);
    if (!cols[0]) continue;
    // Skip header rows only (exact header keywords)
    const firstLower = cols[0].toLowerCase().replace(/\s/g,"");
    if (["한글이름","이름","nameko","subject","과목","subjectname"].includes(firstLower)) continue;

    const nameKo   = cols[0] || "";
    const nameEn   = cols[1] || "";
    const teacher  = cols[2] || "";
    const rawLang  = cols[3] || "";
    const rawLevel = cols[4] || "";
    const language    = ["Korean","English","Both"].includes(rawLang)  ? rawLang  : "Both";
    const schoolLevel = ["중등","고등","공통"].includes(rawLevel) ? rawLevel : "공통";

    const s1ko = cols[5] || ""; const s1en = cols[6] || ""; const s1te = cols[7] || "";
    const s2ko = cols[8] || ""; const s2en = cols[9] || ""; const s2te = cols[10] || "";
    const hasSplit = s1ko || s1en || s1te || s2ko || s2en || s2te;

    result.push(normalizeTemplate({
      id: uid("tpl"), nameKo, nameEn, teacher, language, schoolLevel,
      useSemesterOverrides: !!hasSplit,
      sem1NameKo:  hasSplit ? (s1ko || nameKo)  : "",
      sem1NameEn:  hasSplit ? (s1en || nameEn)  : "",
      sem1Teacher: hasSplit ? (s1te || teacher) : "",
      sem2NameKo:  hasSplit ? (s2ko || nameKo)  : "",
      sem2NameEn:  hasSplit ? (s2en || nameEn)  : "",
      sem2Teacher: hasSplit ? (s2te || teacher) : "",
    }));
  }
  return result;
}

export function addParsedTemplates(items) {
  if (!canEdit()) return 0;
  items.forEach(t => tDomain().templates.push(t));
  clearStableOrder();
  scheduleSave("templates");
  _onTemplateChange();
  return items.length;
}

// ── Template Manager Table View ───────────────────────────────────
export const managerUi = { search:"", language:"all", split:"all", sort:"ko-asc", level:"전체", stableIds: null };

/** Call before re-rendering when filter/sort should be re-applied */
export function clearStableOrder() { managerUi.stableIds = null; }

export function getFilteredTemplates() {
  const srch = clean(managerUi.search).toLowerCase();
  const filtered = templates().filter(item => {
    if (managerUi.language !== "all" && item.language !== managerUi.language) return false;
    if (managerUi.split  === "split" && !item.useSemesterOverrides) return false;
    if (managerUi.split  === "same"  &&  item.useSemesterOverrides) return false;
    if (managerUi.level !== "전체") {
      const derived = deriveSchoolLevelFromCurriculum(item.id);
      const level = derived || item.schoolLevel || "공통";
      if (!(level === managerUi.level || level === "공통")) return false;
    }
    if (srch) { const h = [item.nameKo,item.nameEn,item.teacher,item.sem1NameKo,item.sem1NameEn,item.sem1Teacher,item.sem2NameKo,item.sem2NameEn,item.sem2Teacher].join(" ").toLowerCase(); if (!h.includes(srch)) return false; }
    return true;
  });

  if (managerUi.stableIds !== null) {
    // Maintain current display order — don't re-sort during edits
    const orderMap = new Map(managerUi.stableIds.map((id, i) => [id, i]));
    filtered.sort((a, b) => (orderMap.has(a.id) ? orderMap.get(a.id) : 99999) - (orderMap.has(b.id) ? orderMap.get(b.id) : 99999));
  } else {
    // Apply sort and lock in this order
    const sv = (item, k) => clean(k === "en" ? (item.nameEn||item.sem1NameEn||item.nameKo) : (item.nameKo||item.sem1NameKo||item.nameEn));
    filtered.sort((a,b) => {
      switch (managerUi.sort) {
        case "ko-desc": return sv(b,"ko").localeCompare(sv(a,"ko"),"ko");
        case "en-asc":  return sv(a,"en").localeCompare(sv(b,"en"),"en");
        case "language": return `${a.language}-${sv(a,"ko")}`.localeCompare(`${b.language}-${sv(b,"ko")}`,"ko");
        case "group": { const ga = getTemplateGroupById(a.calcGroupId)?.name||""; const gb = getTemplateGroupById(b.calcGroupId)?.name||""; return `${ga}-${sv(a,"ko")}`.localeCompare(`${gb}-${sv(b,"ko")}`,"ko"); }
        default: return sv(a,"ko").localeCompare(sv(b,"ko"),"ko");
      }
    });
    managerUi.stableIds = filtered.map(t => t.id); // lock order until next explicit sort
  }
  return filtered;
}

export function renderTemplateManagerTable(wrap, countEl) {
  syncSchoolLevels();
  updateTeacherDatalist();
  const rows = getFilteredTemplates();
  if (countEl) countEl.textContent = `${rows.length} / ${tDomain().templates.length}개 표시`;
  if (!rows.length) { wrap.innerHTML = '<div class="manager-empty">검색 조건에 맞는 과목카드가 없습니다.</div>'; return; }

  const buildGroupOpts = selId => ['<option value="">없음</option>'].concat(groups().map(g => `<option value="${escapeHtml(g.id)}" ${selId===g.id?"selected":""}>${escapeHtml(g.name)}</option>`)).join("");
  const tInput = (field, val) =>
    `<div class="teacher-multi-wrap" data-field-wrap="${field}">
      <input type="text" list="tpl-teacher-list" data-field="${field}" value="${escapeHtml(val)}"
        placeholder="교사명 (여러 명: 쉼표 구분)" class="teacher-multi-input" />
      <div class="teacher-chips-preview">${
        splitTeacherNames(val).map(n =>
          `<span class="teacher-name-chip">${escapeHtml(n)}</span>`
        ).join("")
      }</div>
    </div>`;

  const bodyRows = rows.map(item => {
    const grades = getTemplateAppliedGrades(item.id);
    const derivedLevel = deriveSchoolLevelFromCurriculum(item.id);
    const effectiveLevel = derivedLevel || item.schoolLevel || "공통";
    const gradeChips = grades.length ? grades.map(g => `<span class="usage-chip">${g}</span>`).join("") : '<span style="color:#9ca3af;font-size:10px">-</span>';
    const levelDerivedMark = derivedLevel ? ' title="커리큘럼 배치에서 자동 연동"' : ' title="수동 설정"';
    return `<tr data-template-id="${item.id}">
      <td class="col-delete"><button type="button" class="row-delete-btn-inline" data-action="delete-template">삭제</button></td>
      <td class="col-usage usage-cell">${gradeChips}</td>
      <td class="col-schoollevel"><select data-field="schoolLevel"${levelDerivedMark} class="${derivedLevel ? "level-select-derived" : ""}">${["중등","고등","공통"].map(l=>`<option value="${l}" ${effectiveLevel===l?"selected":""}>${l}</option>`).join("")}</select></td>
      <td><input type="text" data-field="nameKo" value="${escapeHtml(item.nameKo)}" /></td>
      <td><input type="text" data-field="nameEn" value="${escapeHtml(item.nameEn)}" /></td>
      <td>${tInput("teacher", item.teacher)}</td>
      <td class="col-language"><select data-field="language">${["Korean","English","Both"].map(l=>`<option value="${l}" ${item.language===l?"selected":""}>${l}</option>`).join("")}</select></td>
      <td class="col-group"><select data-field="calcGroupId">${buildGroupOpts(item.calcGroupId||"")}</select></td>
      <td class="col-toggle toggle-cell"><input type="checkbox" data-field="useSemesterOverrides" ${item.useSemesterOverrides?"checked":""} /></td>
      <td><input type="text" data-field="sem1NameKo" value="${escapeHtml(item.sem1NameKo)}" /></td>
      <td><input type="text" data-field="sem1NameEn" value="${escapeHtml(item.sem1NameEn)}" /></td>
      <td>${tInput("sem1Teacher", item.sem1Teacher)}</td>
      <td><input type="text" data-field="sem2NameKo" value="${escapeHtml(item.sem2NameKo)}" /></td>
      <td><input type="text" data-field="sem2NameEn" value="${escapeHtml(item.sem2NameEn)}" /></td>
      <td>${tInput("sem2Teacher", item.sem2Teacher)}</td>
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
  const item = tDomain().templates.find(t => t.id === row.dataset.templateId); if (!item) return;
  const f = e.target.dataset.field; if (!f) return;
  item[f] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  // Refresh teacher chip preview
  if (["teacher","sem1Teacher","sem2Teacher"].includes(f)) {
    const wrap = e.target.closest(".teacher-multi-wrap");
    const preview = wrap?.querySelector(".teacher-chips-preview");
    if (preview) preview.innerHTML = splitTeacherNames(e.target.value).map(n => `<span class="teacher-name-chip">${escapeHtml(n)}</span>`).join("");
  }
}

export function handleTableChange(e, rerender) {
  const row = e.target.closest("tr[data-template-id]"); if (!row) return;
  const item = tDomain().templates.find(t => t.id === row.dataset.templateId); if (!item) return;
  const f = e.target.dataset.field; if (!f) return;
  const newVal = e.target.type === "checkbox" ? e.target.checked : e.target.value;

  // Req 3: when enabling semester split, auto-fill semester fields from base fields
  if (f === "useSemesterOverrides" && newVal === true) {
    if (!item.sem1NameKo)  item.sem1NameKo  = item.nameKo  || "";
    if (!item.sem1NameEn)  item.sem1NameEn  = item.nameEn  || "";
    if (!item.sem1Teacher) item.sem1Teacher = item.teacher || "";
    if (!item.sem2NameKo)  item.sem2NameKo  = item.nameKo  || "";
    if (!item.sem2NameEn)  item.sem2NameEn  = item.nameEn  || "";
    if (!item.sem2Teacher) item.sem2Teacher = item.teacher || "";
  }

  item[f] = newVal;
  scheduleSave("templates");
  _onTemplateChange(); // Req 2: sync sidebar
  if (["language","calcGroupId","useSemesterOverrides","schoolLevel"].includes(f)) rerender && rerender();
}

export function handleTableDeleteClick(e, rerender) {
  const btn = e.target.closest("button[data-action='delete-template']"); if (!btn) return;
  if (!canEdit()) return;
  const row = btn.closest("tr[data-template-id]"); if (!row) return;
  const tgt = tDomain().templates.find(t => t.id === row.dataset.templateId); if (!tgt) return;
  // Use common deleteTemplate (cleans curriculum, rosters, ttcards, entries, groups)
  deleteTemplate(tgt.id);
  _onTemplateChange();
  rerender && rerender();
}

export function addTemplateManagerRow() {
  if (!canEdit()) return;
  tDomain().templates.unshift(normalizeTemplate({ id:uid("tpl"), language:"Both" }));
  scheduleSave("templates");
  _onTemplateChange();
}
