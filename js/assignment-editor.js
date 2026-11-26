import { ACTIVE_SCHOOL_YEAR, GRADE_KEYS } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { canEdit } from "./auth.js?v=r424";
import { appState, saveCurriculumPaste } from "./state.js?v=r426";
import { ensureDomains } from "./app-domains.js?v=r432";
import { getCurriculumMode } from "./curriculum-mode.js?v=r401";
import { readTsv } from "./curriculum-paste.js?v=r450-assignment";
import { assignmentRows, planAssignments, teacherTotals } from "./assignment-editor-model.js?v=1";
import { assignmentHourIssues, renderAssignmentMatrix } from "./assignment-matrix.js?v=7";

const labels = {
  category: "범주", track: "구분", group: "교과군", credits: "학급별 시수",
  nameKo: "국문 과목명", nameEn: "영문 과목명", teacher: "담당교사", language: "수업 언어",
  classCount: "학급수", teacherLoadHours: "교사시수"
};
const titleFor = (field, entry) => {
  if (field === "credits" && entry?.row.category === "창체") return "창체 시간";
  const [term, name] = field.split(".");
  return name ? (term === "sem1" ? "1학기 " : "2학기 ") + labels[name] : labels[field];
};
const valueFor = (entry, field) => {
  const [term, name] = field.split(".");
  return String((name ? entry[term]?.[name] : entry.row[field]) ?? "");
};
const courseName = entry => entry.sem1?.nameKo || entry.sem2?.nameKo || entry.sem1?.nameEn || entry.sem2?.nameEn;
const snapshot = () => structuredClone({ curriculum: appState.curriculum, templates: appState.templates, rosters: appState.rosters });
const text = value => String(value ?? "—");
const domains = ["curriculum", "templates", "teachers", "rosters"];

function make(tag, value) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  return node;
}

function table(headers, rows) {
  const node = make("table");
  node.className = "manager-table";
  const head = node.createTHead().insertRow();
  for (const label of headers) {
    const th = make("th", label);
    th.scope = "col";
    head.append(th);
  }
  const body = node.createTBody();
  for (const values of rows) {
    const tr = body.insertRow();
    for (const value of values) tr.insertCell().textContent = text(value);
  }
  return node;
}

export function attachAssignmentEditor() {
  const open = document.getElementById("assignmentEditorOpen");
  const workspace = document.getElementById("assignmentEditor");
  const close = workspace.querySelector("[data-close]");
  const filter = workspace.querySelector("[data-grade]");
  const search = workspace.querySelector("[data-search]");
  const summary = workspace.querySelector("[data-summary]");
  const previewButton = workspace.querySelector("[data-preview]");
  const save = workspace.querySelector("[data-save]");
  const message = workspace.querySelector("[role=status]");
  const matrix = workspace.querySelector("[data-matrix]");
  const semester = workspace.querySelector("[data-term]");
  const details = workspace.querySelector("[data-details]");
  const counts = workspace.querySelector("[data-counts]");
  const resetWidths = workspace.querySelector("[data-reset-widths]");
  const widthPreferenceKey = "his-curriculum-assignment-column-widths";
  const columnWidths = new Map();
  try {
    const stored = JSON.parse(localStorage.getItem(widthPreferenceKey) || "{}");
    for (const [id, width] of Object.entries(stored || {})) {
      if (Number.isFinite(width)) columnWidths.set(id, width);
    }
  } catch {
    // The table remains usable when browser storage is unavailable.
  }
  const report = workspace.querySelector("[data-assignment-report]");
  const reportTitle = report.querySelector("h3");
  const reportSave = report.querySelector("[data-report-save]");
  const reportStatus = report.querySelector("[data-report-status]");
  const output = report.querySelector("[data-output]");
  const drafts = new Map();
  let before, teachers, originals, preview, saving = false, redrawPending = false;
  for (const grade of GRADE_KEYS) {
    const option = make("option", grade);
    option.value = grade;
    filter.append(option);
  }

  function invalidate() {
    preview = null;
    save.disabled = reportSave.disabled = true;
    output.replaceChildren();
    message.textContent = drafts.size ? "수정 " + drafts.size + "행 · 변경 사항을 확인한 뒤 저장하세요." : "";
  }

  function edit(key, field, value, control) {
    const entry = originals.get(key);
    const changes = drafts.get(key) || {};
    if (value.trim() === valueFor(entry, field).trim()) delete changes[field];
    else changes[field] = value;
    if (Object.keys(changes).length) drafts.set(key, changes);
    else drafts.delete(key);
    control.classList.toggle("assignment-changed", Object.hasOwn(changes, field));
    redrawPending = true;
    invalidate();
  }

  function draw() {
    if (workspace.hidden || !before) return;
    redrawPending = false;
    const scroll = matrix.querySelector(".assignment-matrix-scroll");
    const left = scroll?.scrollLeft || 0, top = scroll?.scrollTop || 0;
    let shown = before;
    if (drafts.size) {
      try {
        shown = planAssignments(before, teachers, drafts).after;
        if (!preview) message.textContent = "수정 " + drafts.size + "행 · 변경 사항을 확인한 뒤 저장하세요.";
      } catch (error) {
        message.textContent = error.message + " 합계는 저장된 값을 표시합니다.";
      }
    }
    const displayed = new Map(assignmentRows(shown, teachers).map(entry => [entry.key, entry]));
    matrix.replaceChildren(renderAssignmentMatrix(shown, teachers, {
      term: semester.value, grade: filter.value, query: search.value, details: details.checked,
      columnWidths,
      onResize: (id, width) => {
        columnWidths.set(id, width);
        try {
          localStorage.setItem(widthPreferenceKey, JSON.stringify(Object.fromEntries(columnWidths)));
        } catch {
          // Keep the width for the current page even without storage.
        }
      },
      onCounts: (courses, teachers, differences) => {
        counts.textContent = courses + "수업 · " + teachers + "교사" + (differences ? " · 시수 차이 " + differences + "행" : "");
        counts.classList.toggle("assignment-warning-count", differences > 0);
      },
      field: (key, name, placeholder) => {
        const entry = displayed.get(key);
        const draft = drafts.get(key)?.[name];
        const label = entry.grade + " " + courseName(entry) + " " + titleFor(name, entry);
        const control = make("input");
        control.value = draft ?? valueFor(entry, name);
        control.placeholder = placeholder || "—";
        control.className = "assignment-inline-field";
        control.dataset.row = key;
        control.dataset.field = name;
        control.setAttribute("aria-label", label);
        control.title = control.value ? label + " · " + control.value : label;
        if (/credits|classCount|teacherLoadHours/.test(name)) control.inputMode = "decimal";
        if (name.endsWith(".teacherLoadHours")) control.title += " · 동일 과목카드의 담당 교사에게 공통 적용";
        control.classList.toggle("assignment-changed", draft !== undefined);
        control.addEventListener("input", () => edit(key, name, control.value, control));
        control.addEventListener("keydown", event => {
          if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            control.blur();
          }
        });
        return control;
      }
    }));
    const nextScroll = matrix.querySelector(".assignment-matrix-scroll");
    if (nextScroll) {
      nextScroll.scrollLeft = left;
      nextScroll.scrollTop = top;
    }
  }

  matrix.addEventListener("focusout", () => {
    setTimeout(() => {
      if (redrawPending && !preview && !saving && !matrix.contains(document.activeElement)) draw();
    }, 0);
  });

  matrix.addEventListener("paste", event => {
    const input = event.target;
    const startField = input.dataset.field;
    const plain = event.clipboardData?.getData("text/plain");
    if (!startField || !plain || !/[\t\r\n]/.test(plain.replace(/\r?\n$/, ""))) return;
    event.preventDefault();
    const rows = Array.from(matrix.querySelectorAll("tbody tr"));
    const startRow = rows.indexOf(input.closest("tr"));
    const startColumn = input.closest("td, th").cellIndex;
    try {
      const changes = new Map();
      for (const [i, { cells }] of readTsv(plain).entries()) {
        for (const [j, value] of cells.entries()) {
          const control = rows[startRow + i]?.cells[startColumn + j]?.querySelector("[data-field]");
          if (!control) throw new Error("붙여넣기에 편집할 수 없는 셀이 포함되어 있습니다.");
          const key = JSON.stringify([control.dataset.row, control.dataset.field]);
          if (changes.has(key) && changes.get(key).value !== value) {
            throw new Error("같은 과목의 교사시수에는 하나의 값만 입력할 수 있습니다.");
          }
          changes.set(key, { control, value });
        }
      }
      for (const { control, value } of changes.values()) {
        control.value = value;
        edit(control.dataset.row, control.dataset.field, value, control);
      }
    } catch (error) {
      message.textContent = error.message;
    }
  });

  function workloadTable(oldTotals, newTotals = oldTotals, changedOnly = false) {
    const changes = [];
    for (const key of new Set([...oldTotals.keys(), ...newTotals.keys()])) {
      const previous = oldTotals.get(key), next = newTotals.get(key);
      if (changedOnly && previous?.count === next?.count && previous?.hours === next?.hours) continue;
      const { term, name } = next || previous;
      const count = next?.count ?? 0;
      const hours = next ? next.hours ?? "미설정" : 0;
      changes.push([name, term === "sem1" ? "1학기" : "2학기",
        changedOnly ? `${previous?.count ?? 0} → ${count}` : count,
        changedOnly ? `${previous ? previous.hours ?? "미설정" : 0} → ${hours}` : hours]);
    }
    return table(["교사", "학기", "담당 과목 수", "교사시수"], changes);
  }

  async function start() {
    if (!canEdit() || getCurriculumMode() === "threeYear") {
      alert("연간 커리큘럼을 선택하고 편집 권한을 확인해 주세요.");
      return;
    }
    open.disabled = true;
    try {
      if (!(await ensureDomains(domains)) || !canEdit()) throw new Error("커리큘럼과 수강명단을 불러오지 못했습니다.");
      before = snapshot();
      teachers = structuredClone(appState.teachers);
      originals = new Map(assignmentRows(before, teachers).map(entry => [entry.key, entry]));
      drafts.clear();
      filter.value = search.value = "";
      semester.value = "sem1";
      workspace.querySelector("[data-year]").textContent = ACTIVE_SCHOOL_YEAR + "학년도";
      invalidate();
      workspace.hidden = false;
      document.body.classList.add("assignment-workspace-active");
      open.setAttribute("aria-pressed", "true");
      draw();
      workspace.querySelector("h2").focus();
    } catch (error) {
      alert(error.message);
    } finally {
      open.disabled = false;
    }
  }

  function openReport(title, showSave = false) {
    reportTitle.textContent = title;
    reportSave.hidden = !showSave;
    reportStatus.textContent = "";
    output.scrollTop = 0;
    if (!report.open) report.showModal();
  }

  function showHourIssues(data, scope, title) {
    const issues = assignmentHourIssues(data, teachers, scope);
    output.append(make("h4", title + " · " + issues.length + "건"));
    if (issues.length) {
      const issueTable = table(["학년", "과목", "학기", "항목", "확인 사항"], issues);
      issueTable.classList.add("assignment-report-issues");
      output.append(issueTable);
    } else output.append(make("p", "시수 차이 없음"));
  }

  function showPreview() {
    invalidate();
    openReport("변경 확인");
    if (!drafts.size) {
      output.append(make("p", "저장할 변경 사항이 없습니다."));
      showHourIssues(before, { term: semester.value, grade: filter.value }, "선택 학기·학년 시수 확인");
      return;
    }
    try {
      const plan = planAssignments(before, teachers, drafts);
      if (!plan.rows.length) {
        output.append(make("p", "저장할 변경 사항이 없습니다."));
        return;
      }
      output.append(make("h4", "변경될 커리큘럼 행"), table(["학년", "과목", "항목", "현재", "변경 후"],
        plan.rows.flatMap(({ original, next, fields }) => fields.map(field =>
          [original.grade, courseName(original), titleFor(field, next), valueFor(original, field), valueFor(next, field)]))));
      showHourIssues(plan.after, { keys: new Set(plan.rows.map(({ next }) => next.key)) }, "변경 후 시수 확인");
      output.append(make("h4", "교사별 시수 변화"), workloadTable(teacherTotals(before, teachers), teacherTotals(plan.after, teachers), true));
      reportStatus.textContent = "변경 " + plan.rows.length + "행 · 연결된 행 포함" +
        (plan.planningRows ? " · 같은 과목카드를 참조하는 3개년 계획 " + plan.planningRows + "행에도 반영" : "");
      preview = plan;
      save.disabled = reportSave.disabled = reportSave.hidden = false;
      draw();
    } catch (error) {
      reportStatus.textContent = "저장 불가 · " + error.message;
    }
  }

  function leave() {
    if (saving || (drafts.size && !confirm("저장하지 않은 변경을 취소할까요?"))) return false;
    drafts.clear();
    workspace.hidden = true;
    document.body.classList.remove("assignment-workspace-active");
    open.setAttribute("aria-pressed", "false");
    return true;
  }

  open.addEventListener("click", () => {
    if (workspace.hidden) void start();
    else if (leave()) open.focus();
  });
  close.addEventListener("click", () => { if (leave()) open.focus(); });
  semester.addEventListener("change", draw);
  details.addEventListener("change", draw);
  resetWidths.addEventListener("click", () => {
    columnWidths.clear();
    try { localStorage.removeItem(widthPreferenceKey); } catch { /* In-memory widths are already reset. */ }
    draw();
  });
  filter.addEventListener("change", draw);
  search.addEventListener("input", draw);
  for (const id of ["navBoardBtn", "navManagerBtn"]) {
    document.getElementById(id)?.addEventListener("click", event => {
      if (!workspace.hidden && !leave()) event.stopImmediatePropagation();
    }, true);
  }
  document.getElementById("curriculumModeSelect")?.addEventListener("change", event => {
    if (!workspace.hidden && event.target.value === "threeYear" && !leave()) {
      event.target.value = "annual";
      event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("beforeunload", event => {
    if (!workspace.hidden && drafts.size) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  summary.addEventListener("click", () => {
    let current = before, note = "";
    if (drafts.size) {
      try {
        current = planAssignments(before, teachers, drafts).after;
        note = "수정 중인 값 포함";
      } catch (error) {
        note = "저장된 값 기준 · " + error.message;
      }
    }
    output.replaceChildren(workloadTable(teacherTotals(current, teachers)));
    openReport("교사별 요약");
    reportStatus.textContent = note;
  });
  previewButton.addEventListener("click", showPreview);
  report.querySelector("[data-report-close]").addEventListener("click", () => { if (!saving) report.close(); });
  report.addEventListener("cancel", event => { if (saving) event.preventDefault(); });

  async function saveChanges() {
    if (!preview || saving || !canEdit()) return;
    saving = true;
    close.disabled = previewButton.disabled = save.disabled = reportSave.disabled = true;
    matrix.inert = open.disabled = semester.disabled = details.disabled = resetWidths.disabled = filter.disabled = search.disabled = true;
    try {
      if (JSON.stringify(teachers) !== JSON.stringify(appState.teachers)) throw new Error("교사 데이터가 변경되었습니다. 화면을 다시 열어 주세요.");
      await saveCurriculumPaste(before, preview.after, { includeRosters: preview.includeRosters });
      before = snapshot();
      originals = new Map(assignmentRows(before, teachers).map(entry => [entry.key, entry]));
      drafts.clear();
      invalidate();
      draw();
      if (report.open) report.close();
      message.textContent = "수업배정을 저장했습니다.";
    } catch (error) {
      (report.open ? reportStatus : message).textContent = error.message;
      save.disabled = reportSave.disabled = false;
    } finally {
      saving = close.disabled = previewButton.disabled = matrix.inert =
        open.disabled = semester.disabled = details.disabled = resetWidths.disabled = filter.disabled = search.disabled = false;
    }
  }
  save.addEventListener("click", saveChanges);
  reportSave.addEventListener("click", saveChanges);
}
