import { ACTIVE_SCHOOL_YEAR, GRADE_GROUPS } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getCurriculumMode } from "./curriculum-mode.js?v=r401";
import { canEdit } from "./auth.js?v=r424";
import { appState, initialLoad, createRow, normalizeTemplate, saveCurriculumPaste, scheduleSave, saveNow } from "./state.js?v=r424";
import { LOCAL_DEV_MODE } from "./local-dev.js?v=2026-07-15-room-availability-separation-r355";
import { getSemesterTemplateData } from "./templates.js?v=2026-07-15-room-availability-separation-r355";
import { synchronizeTeacherIdentityReferences } from "./teacher-identity.js?v=2026-07-15-room-availability-separation-r355";
import { buildBackupFilename, downloadJsonBackup } from "./destructive-operation-guard.js?v=2026-07-15-room-availability-separation-r355";
import { analyzeCurriculumPaste, planCurriculumPaste, curriculumPasteTemplate } from "./curriculum-paste.js?v=r425";

const dialog = document.getElementById("curriculumPasteDialog");
const input = document.getElementById("curriculumPasteSource");
const status = document.getElementById("curriculumPasteStatus");
const preview = document.getElementById("curriculumPastePreview");
const apply = document.getElementById("curriculumPasteApply");
const analyze = document.getElementById("curriculumPasteAnalyze");
const close = document.getElementById("curriculumPasteClose");
let grades, target, plan, saving = false;

function snapshot() {
  return structuredClone({ curriculum: appState.curriculum, templates: appState.templates, rosters: appState.rosters });
}

function planRows(entries, before) {
  return planCurriculumPaste(entries, before.curriculum, before.templates.templates,
    (template, index) => getSemesterTemplateData(template, index === 0 ? "sem1" : "sem2"));
}

function setStatus(message) {
  status.textContent = message;
}

function resetPreview() {
  plan = null;
  apply.disabled = true;
  preview.replaceChildren();
}

function renderPreview(rows, errors, warnings) {
  const table = document.createElement("table");
  table.className = "manager-table";
  const header = table.createTHead().insertRow();
  for (const title of ["학년", "범주", "구분", "교과군", "언어", "1학기", "2학기", "학점/시간", "반 수", "교사시수", "성적표 항목", "처리"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = title;
    header.append(cell);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const display = subject => subject ? [subject.nameKo, subject.nameEn, subject.teacher].filter(Boolean).join(" / ") : "—";
    const reportCount = Object.keys(row.reporting || {}).length;
    const values = [row.grade, row.category, row.track, row.group, row.language,
      ...row.semesters.map(display), row.credits, row.classCountSource && row.classCountSource !== row.classCount ? `${row.classCount} (원본 ${row.classCountSource})` : row.classCount || "—", row.teacherLoadHours || "자동", reportCount ? `${reportCount}개 반영` : "—",
      row.status === "추가" ? (row.templateId ? "행 추가 · 기존 카드 연결" : "행 추가 · 새 카드 연결") : row.status];
    const tr = body.insertRow();
    for (const value of values) tr.insertCell().textContent = value;
  }
  if (errors.length || warnings.length) {
    const list = document.createElement("ul");
    for (const { line, grade, message } of warnings) {
      const item = document.createElement("li");
      item.className = "curriculum-paste-warning";
      item.textContent = ["경고", line && `붙여넣기 ${line}줄`, grade, message].filter(Boolean).join(" · ");
      list.append(item);
    }
    for (const { line, grade, message } of errors) {
      const item = document.createElement("li");
      item.className = "curriculum-paste-error";
      item.textContent = ["적용 차단", line && `붙여넣기 ${line}줄`, grade, message].filter(Boolean).join(" · ");
      list.append(item);
    }
    preview.append(list);
  }
  if (rows.length) preview.append(table);
}

function analyzeInput() {
  resetPreview();
  try {
    const { entries, errors, warnings } = analyzeCurriculumPaste(input.value, grades);
    const rows = planRows(entries, snapshot());
    const additions = rows.filter(row => row.status === "추가");
    const newCards = new Set(additions.filter(row => !row.templateId).map(row => row.newCardKey)).size;
    const classCountRows = rows.filter(row => /^\d+$/.test(String(row.classCount || "").trim()));
    const teacherLoadRows = rows.filter(row => /^\d+(?:\.\d+)?$/.test(String(row.teacherLoadHours || "").trim()));
    const reportingRows = rows.filter(row => row.semesterReporting?.some(value => value && Object.keys(value).length) || row.reporting && Object.keys(row.reporting).length);
    renderPreview(rows, errors, warnings);
    setStatus(`추가 ${additions.length}행 · 새 과목 카드 ${newCards}개 · 반 수 반영 ${classCountRows.length}건 · 교사시수 ${teacherLoadRows.length}건 · 성적표 항목 ${reportingRows.length}건 · 중복 제외 ${rows.length - additions.length}행 · 경고 ${warnings.length}건 · 적용 차단 ${errors.length}건`);
    if (errors.length || (!additions.length && !classCountRows.length && !teacherLoadRows.length && !reportingRows.length)) return;
    plan = { entries, rows, additions, newCards, warnings, classCountRows, teacherLoadRows, reportingRows };
    apply.disabled = false;
  } catch (error) {
    setStatus(error.message);
  }
}

function createUpdatedDomains(before, rows, plannedRows = rows) {
  const after = structuredClone(before);
  const { options, gradeBoards } = after.curriculum;
  // Remove the four starter rows from grades receiving imported subjects.
  // Existing course rows and blank rows added later are left intact.
  for (const grade of new Set(rows.map(entry => entry.grade))) {
    gradeBoards[grade] = gradeBoards[grade].filter((row, index) => index >= 4 ||
      row.sem1TemplateId || row.sem2TemplateId || String(row.credits || "").trim() ||
      row.category !== "교과" || row.track !== "공통" || row.group !== "선택");
  }
  const newCards = new Map();
  for (const entry of rows) {
    let id = entry.templateId || newCards.get(entry.newCardKey)?.id;
    if (!id) {
      const template = normalizeTemplate(curriculumPasteTemplate(entry));
      newCards.set(entry.newCardKey, template);
      id = template.id;
    }
    const linkedTemplate = newCards.get(entry.newCardKey) || after.templates.templates.find(template => template.id === id);
    if (linkedTemplate && entry.reporting && Object.keys(entry.reporting).length) {
      linkedTemplate.reportingRequirements = { ...(linkedTemplate.reportingRequirements || {}), ...entry.reporting };
      linkedTemplate.sem1ReportingRequirements = { ...(linkedTemplate.sem1ReportingRequirements || {}), ...(entry.semesterReporting?.[0] || entry.reporting) };
      linkedTemplate.sem2ReportingRequirements = { ...(linkedTemplate.sem2ReportingRequirements || {}), ...(entry.semesterReporting?.[1] || entry.reporting) };
    }
    for (const field of ["category", "track", "group"]) {
      if (!options[field].includes(entry[field])) options[field].push(entry[field]);
    }
    const row = createRow(options, entry);
    row.sem1TemplateId = entry.semesters[0] ? id : null;
    row.sem2TemplateId = entry.semesters[1] ? id : null;
    gradeBoards[entry.grade].push(row);
  }
  const created = [...newCards.values()];
  synchronizeTeacherIdentityReferences({ teachers: structuredClone(appState.teachers), templates: { templates: created } });
  after.templates.templates.push(...created);
  for (const entry of plannedRows) {
    const id = entry.templateId || newCards.get(entry.newCardKey)?.id;
    const template = after.templates.templates.find(item => item.id === id);
    if (template) {
      const imported = curriculumPasteTemplate(entry);
      template.nameKo = imported.nameKo;
      template.nameEn = imported.nameEn;
      template.teacher = imported.teacher;
      template.language = imported.language;
      template.schoolLevel = imported.schoolLevel;
      template.useSemesterOverrides = !!imported.useSemesterOverrides;
      for (const field of ["sem1NameKo", "sem1NameEn", "sem1Teacher", "sem2NameKo", "sem2NameEn", "sem2Teacher"]) {
        template[field] = imported.useSemesterOverrides ? String(imported[field] || "") : "";
      }
      template.reportingRequirements = { ...(entry.reporting || {}) };
      template.sem1ReportingRequirements = { ...(entry.semesterReporting?.[0] || entry.reporting || {}) };
      template.sem2ReportingRequirements = { ...(entry.semesterReporting?.[1] || entry.reporting || {}) };
    }
  }
  synchronizeTeacherIdentityReferences({ teachers: structuredClone(appState.teachers), templates: after.templates });
  after.rosters ||= { rosters: {}, rosterMeta: {} };
  after.rosters.rosters ||= {};
  after.rosters.rosterMeta ||= {};
  const classCountAssignments = new Map();
  for (const entry of plannedRows) {
    const value = String(entry.classCount || "").trim();
    const teacherLoadHours = String(entry.teacherLoadHours || "").trim();
    const id = entry.templateId || newCards.get(entry.newCardKey)?.id;
    if (!id || !/^\d+$/.test(value)) continue;
    classCountAssignments.set(id, { classCount: value, teacherLoadHours });
  }
  classCountAssignments.forEach((value, id) => {
    after.rosters.rosterMeta[id] = { ...(after.rosters.rosterMeta[id] || {}), classCount: value.classCount, ...(value.teacherLoadHours ? { teacherLoadHours: value.teacherLoadHours } : {}) };
  });
  return { after, classCountAssignments };
}

async function applyPreview() {
  if (saving || !plan || !canEdit()) return;
  const before = snapshot();
  const currentRows = planRows(plan.entries, before);
  if (JSON.stringify(currentRows) !== JSON.stringify(plan.rows)) {
    analyzeInput();
    setStatus("기존 데이터가 변경되었습니다. 갱신된 미리보기를 확인해 주세요.");
    return;
  }
  const { additions, newCards, warnings, classCountRows, teacherLoadRows, reportingRows } = plan;
  if (classCountRows.length && !initialLoad.rosters) {
    setStatus("과목 설정 데이터를 불러온 후 다시 적용해 주세요.");
    return;
  }
  const warningNote = warnings.length ? `\n경고 ${warnings.length}건은 안내된 값으로 저장됩니다.` : "";
  if (!confirm(`${target}에 ${additions.length}행과 새 과목 카드 ${newCards}개를 추가하고, 반 수 ${classCountRows.length}건·교사시수 ${teacherLoadRows.length}건·성적표 항목 ${reportingRows.length}건을 반영할까요?${warningNote}\n적용 전에 JSON 백업을 다운로드합니다.`)) return;
  saving = true;
  for (const control of [apply, close, analyze, input]) control.disabled = true;
  setStatus("백업 및 저장 중입니다.");
  try {
    const { after, classCountAssignments } = createUpdatedDomains(before, additions, plan.rows);
    const scope = grades === GRADE_GROUPS.tab7to9 ? "middle-curriculum" : "high-curriculum";
    const filename = buildBackupFilename({ year: ACTIVE_SCHOOL_YEAR, scope, operation: "curriculum-paste" });
    downloadJsonBackup({
      version: 1, operation: "curriculum-paste", exportedAt: new Date().toISOString(),
      schoolYear: ACTIVE_SCHOOL_YEAR, grades, data: before,
    }, filename);
    await saveCurriculumPaste(before, after);
    if (classCountAssignments.size) {
      appState.rosters = after.rosters;
      scheduleSave("rosters", { saveOptions: { force: true, throwOnError: true } });
      await saveNow("rosters", { force: true, throwOnError: true });
    }
    resetPreview();
    setStatus(`${additions.length}행과 새 과목 카드 ${newCards}개를 저장하고, 반 수 ${classCountAssignments.size}건·교사시수 ${teacherLoadRows.length}건·성적표 항목 ${reportingRows.length}건을 반영했습니다.`);
  } catch (error) {
    setStatus(`저장 실패 · ${error.message}`);
  } finally {
    saving = false;
    for (const control of [close, analyze, input]) control.disabled = false;
    apply.disabled = !plan;
  }
}

export function openCurriculumPaste() {
  if (getCurriculumMode() === "threeYear") return;
  if (!canEdit() || !initialLoad.curriculum || !initialLoad.templates) {
    alert("편집 권한을 확인하고 커리큘럼과 과목 카드가 로드된 후 다시 시도해 주세요.");
    return;
  }
  grades = document.getElementById("tab10to12Btn").classList.contains("active") ? GRADE_GROUPS.tab10to12 : GRADE_GROUPS.tab7to9;
  target = `${ACTIVE_SCHOOL_YEAR}학년도 ${grades.join(" · ")} (${LOCAL_DEV_MODE ? "로컬" : "온라인"})`;
  document.getElementById("curriculumPasteTarget").textContent = target;
  setStatus("");
  resetPreview();
  dialog.showModal();
}

input.addEventListener("input", () => { resetPreview(); setStatus(""); });
analyze.addEventListener("click", analyzeInput);
apply.addEventListener("click", () => { void applyPreview(); });
close.addEventListener("click", () => dialog.close());
dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
