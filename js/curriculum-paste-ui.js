import { ACTIVE_SCHOOL_YEAR, GRADE_GROUPS } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getCurriculumMode } from "./curriculum-mode.js?v=r401";
import { canEdit } from "./auth.js?v=r424";
import { appState, initialLoad, createRow, normalizeTemplate, saveCurriculumPaste } from "./state.js?v=r426";
import { LOCAL_DEV_MODE } from "./local-dev.js?v=2026-07-15-room-availability-separation-r355";
import { getSemesterTemplateData } from "./templates.js?v=r425";
import { synchronizeTeacherIdentityReferences } from "./teacher-identity.js?v=2026-07-15-room-availability-separation-r355";
import { buildBackupFilename, downloadJsonBackup } from "./destructive-operation-guard.js?v=2026-07-15-room-availability-separation-r355";
import { analyzeCurriculumPaste, planCurriculumPaste, curriculumPasteTemplate, replaceImportedTeachers } from "./curriculum-paste.js?v=r426";

const dialog = document.getElementById("curriculumPasteDialog");
const input = document.getElementById("curriculumPasteSource");
const status = document.getElementById("curriculumPasteStatus");
const preview = document.getElementById("curriculumPastePreview");
const apply = document.getElementById("curriculumPasteApply");
const analyze = document.getElementById("curriculumPasteAnalyze");
const close = document.getElementById("curriculumPasteClose");
const updateTeachers = document.getElementById("curriculumPasteUpdateTeachers");
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
    const reportCount = reportCountFor(row);
    const values = [row.grade, row.category, row.track, row.group, row.language,
      ...row.semesters.map(display), row.credits, row.classCountSource && row.classCountSource !== row.classCount ? `${row.classCount} (원본 ${row.classCountSource})` : row.classCount || "—", row.teacherLoadHours || "—", reportCount ? `${reportCount}개` : "—",
      row.status === "추가" ? (row.templateId ? "행 추가 · 기존 카드 연결" : "행 추가 · 새 카드 연결")
        : row.existingIds ? (updateTeachers.checked && row.teacherChanges.some(Boolean) ? "기존 행 · 설정 보완 및 담당 교사 변경" : "기존 행 · 입력된 설정만 보완") : row.status];
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
      item.textContent = [line ? "행 제외" : "적용 차단", line && `붙여넣기 ${line}줄`, grade, message].filter(Boolean).join(" · ");
      list.append(item);
    }
    preview.append(list);
  }
  if (rows.length) preview.append(table);
}

const reportCountFor = row => (row.semesterReporting || [row.reporting]).reduce((count, report) => count + Object.keys(report || {}).length, 0);

function analyzeInput() {
  resetPreview();
  try {
    const { entries, errors, warnings } = analyzeCurriculumPaste(input.value, grades);
    const rows = planRows(entries, snapshot());
    const additions = rows.filter(row => row.status === "추가");
    const newCards = new Set(additions.filter(row => !row.templateId).map(row => row.newCardKey)).size;
    const applicable = rows.filter(row => row.status === "추가" || row.existingIds);
    const classCountRows = applicable.filter(row => row.classCount !== "");
    const teacherLoadRows = applicable.filter(row => row.teacherLoadHours !== "");
    const reportingRows = applicable.filter(row => reportCountFor(row));
    const teacherRows = updateTeachers.checked ? applicable.filter(row => row.teacherChanges?.some(Boolean)) : [];
    const excluded = errors.filter(error => error.line).length;
    const blocking = errors.length - excluded;
    renderPreview(rows, errors, warnings);
    setStatus(`추가 ${additions.length}행 · 새 과목 카드 ${newCards}개 · 기존 행 ${applicable.length - additions.length}행 · 반 수 ${classCountRows.length}건 · 교사시수 ${teacherLoadRows.length}건 · 성적표 ${reportingRows.length}건 · 교사 변경 ${teacherRows.length}행 · 제외 ${rows.length - applicable.length + excluded}행 · 경고 ${warnings.length}건 · 적용 차단 ${blocking}건`);
    if (blocking || !(additions.length || classCountRows.length || teacherLoadRows.length || reportingRows.length || teacherRows.length)) return;
    plan = { entries, rows, additions, newCards, warnings, excluded, classCountRows, teacherLoadRows, reportingRows, teacherRows };
    apply.disabled = false;
  } catch (error) {
    setStatus(error.message);
  }
}

function createUpdatedDomains(before, { additions: rows, rows: plannedRows, teacherRows }) {
  const after = structuredClone(before);
  const { options, gradeBoards } = after.curriculum;
  // Remove the four starter rows from grades receiving imported subjects.
  // Existing course rows and blank rows added later are left intact.
  for (const grade of new Set(rows.map(entry => entry.grade))) {
    gradeBoards[grade] = gradeBoards[grade].filter((row, index) => index >= 4 ||
      row.sem1TemplateId || row.sem2TemplateId || String(row.credits || "").trim() ||
      row.category !== "교과" || row.track !== "공통" || row.group !== "선택");
  }
  const cards = new Map(after.templates.templates.map(template => [template.id, template]));
  const createdIds = new Map();
  const changedTeachers = [];
  for (const entry of rows) {
    let id = entry.templateId;
    if (!id) {
      const template = normalizeTemplate(curriculumPasteTemplate(entry));
      id = template.id;
      cards.set(id, template);
      changedTeachers.push(template);
    }
    createdIds.set(entry.newCardKey, id);
    for (const field of ["category", "track", "group"]) {
      if (!options[field].includes(entry[field])) options[field].push(entry[field]);
    }
    const row = createRow(options, entry);
    row.sem1TemplateId = entry.semesters[0] ? id : null;
    row.sem2TemplateId = entry.semesters[1] ? id : null;
    gradeBoards[entry.grade].push(row);
  }
  for (const entry of plannedRows) {
    if (!entry.existingIds) continue;
    for (const id of new Set(entry.existingIds.filter(Boolean))) {
      const template = cards.get(id);
      const reports = entry.semesterReporting || [entry.reporting, entry.reporting];
      const legacy = !Object.keys(template.sem1ReportingRequirements || {}).length && !Object.keys(template.sem2ReportingRequirements || {}).length;
      if (legacy && entry.existingIds.some((slot, i) => slot === id && Object.keys(reports[i] || {}).length)) {
        template.sem1ReportingRequirements = { ...template.reportingRequirements };
        template.sem2ReportingRequirements = { ...template.reportingRequirements };
      }
      entry.existingIds.forEach((slot, i) => {
        if (slot !== id || !Object.keys(reports[i] || {}).length) return;
        const field = `sem${i + 1}ReportingRequirements`;
        template[field] = { ...template[field], ...reports[i] };
      });
      if (teacherRows.includes(entry) && entry.existingIds.some((slot, i) => slot === id && entry.teacherChanges[i])) {
        const names = entry.existingIds.map((slot, i) => {
          const previous = entry.previousSemesters[i];
          return slot === id ? entry.teacherChanges[i] || previous?.teacher || previous?.teacherNames?.join(", ") || "" : "";
        });
        replaceImportedTeachers(template, names);
        changedTeachers.push(template);
      }
    }
  }
  after.templates.templates = [...cards.values()];
  synchronizeTeacherIdentityReferences({ teachers: structuredClone(appState.teachers), templates: { templates: changedTeachers } });
  after.rosters ||= { rosters: {}, rosterMeta: {} };
  after.rosters.rosters ||= {};
  after.rosters.rosterMeta ||= {};
  const classCountAssignments = new Map();
  for (const entry of plannedRows) {
    const value = String(entry.classCount || "").trim();
    const teacherLoadHours = String(entry.teacherLoadHours || "").trim();
    if (!value && !teacherLoadHours) continue;
    const ids = entry.existingIds || [createdIds.get(entry.newCardKey)];
    for (const id of new Set(ids.filter(Boolean))) {
      classCountAssignments.set(id, { ...(value ? { classCount: value } : {}), ...(teacherLoadHours ? { teacherLoadHours } : {}) });
    }
  }
  classCountAssignments.forEach((value, id) => {
    after.rosters.rosterMeta[id] = { ...after.rosters.rosterMeta[id], ...value };
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
  const { additions, newCards, warnings, excluded, classCountRows, teacherLoadRows, reportingRows, teacherRows } = plan;
  if ((classCountRows.length || teacherLoadRows.length) && !initialLoad.rosters) {
    setStatus("과목 설정 데이터를 불러온 후 다시 적용해 주세요.");
    return;
  }
  if (!confirm(`${target}\n추가 ${additions.length}행 · 새 과목 카드 ${newCards}개\n반 수 ${classCountRows.length}행 · 교사시수 ${teacherLoadRows.length}행 · 성적표 ${reportingRows.length}행 · 기존 행 담당 교사 교체 ${teacherRows.length}행\n미리보기에 표시된 경고 ${warnings.length}건 및 적용할 수 없는 행 ${excluded}개를 확인해 주세요.\n적용 전에 JSON 백업을 다운로드합니다.`)) return;
  saving = true;
  for (const control of [apply, close, analyze, input, updateTeachers]) control.disabled = true;
  setStatus("백업 및 저장 중입니다.");
  try {
    const { after, classCountAssignments } = createUpdatedDomains(before, plan);
    const scope = grades === GRADE_GROUPS.tab7to9 ? "middle-curriculum" : "high-curriculum";
    const filename = buildBackupFilename({ year: ACTIVE_SCHOOL_YEAR, scope, operation: "curriculum-paste" });
    downloadJsonBackup({
      version: 1, operation: "curriculum-paste", exportedAt: new Date().toISOString(),
      schoolYear: ACTIVE_SCHOOL_YEAR, grades, data: before,
    }, filename);
    await saveCurriculumPaste(before, after, { includeRosters: classCountAssignments.size > 0 });
    resetPreview();
    setStatus(`적용 완료 · 추가 ${additions.length}행 · 반 수 ${classCountRows.length}행 · 교사시수 ${teacherLoadRows.length}행 · 성적표 ${reportingRows.length}행 · 교사 교체 ${teacherRows.length}행`);
  } catch (error) {
    setStatus(`저장 실패 · ${error.message}`);
  } finally {
    saving = false;
    for (const control of [close, analyze, input, updateTeachers]) control.disabled = false;
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
  updateTeachers.checked = false;
  setStatus("");
  resetPreview();
  dialog.showModal();
}

input.addEventListener("input", () => { resetPreview(); setStatus(""); });
updateTeachers.addEventListener("change", () => { if (input.value.trim()) analyzeInput(); });
analyze.addEventListener("click", analyzeInput);
apply.addEventListener("click", () => { void applyPreview(); });
close.addEventListener("click", () => dialog.close());
dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
