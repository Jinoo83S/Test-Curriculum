import { ACTIVE_SCHOOL_YEAR, GRADE_KEYS } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { canEdit } from "./auth.js?v=r424";
import { appState, saveCurriculumPaste } from "./state.js?v=r426";
import { ensureDomains } from "./app-domains.js?v=r432";
import { getCurriculumMode } from "./curriculum-mode.js?v=r401";
import { readTsv } from "./curriculum-paste.js?v=r450-assignment";
import { assignmentRows, planAssignments, teacherTotals, rowFields, termFields } from "./assignment-editor-model.js?v=1";
import { renderAssignmentMatrix } from "./assignment-matrix.js?v=2";

const labels = {
  category: "범주", track: "구분", group: "교과군", credits: "학급별 시수",
  nameKo: "국문 과목명", nameEn: "영문 과목명", teacher: "담당교사", language: "수업 언어",
  classCount: "학급수", teacherLoadHours: "교사시수"
};
const titleFor = field => {
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
  const output = workspace.querySelector("[data-output]");
  const drafts = new Map();
  let before, teachers, originals, preview, saving = false, redrawPending = false;
  for (const grade of GRADE_KEYS) {
    const option = make("option", grade);
    option.value = grade;
    filter.append(option);
  }

  function invalidate() {
    preview = null;
    save.disabled = true;
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
      term: semester.value, grade: filter.value, query: search.value,
      field: (key, name, placeholder) => {
        const entry = displayed.get(key);
        const draft = drafts.get(key)?.[name];
        const label = entry.grade + " " + courseName(entry) + " " + titleFor(name);
        const control = make("input");
        control.value = draft ?? valueFor(entry, name);
        control.placeholder = placeholder || "—";
        control.className = "assignment-inline-field";
        control.dataset.row = key;
        control.dataset.field = name;
        control.setAttribute("aria-label", label);
        control.title = label;
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
    const fields = [...rowFields, ...termFields.map(field => semester.value + "." + field)];
    const rows = Array.from(matrix.querySelectorAll("tbody tr"));
    const startRow = rows.indexOf(input.closest("tr"));
    const startColumn = fields.indexOf(startField);
    try {
      const changes = new Map();
      for (const [i, { cells }] of readTsv(plain).entries()) {
        for (const [j, value] of cells.entries()) {
          const field = fields[startColumn + j];
          const control = rows[startRow + i]?.querySelector('[data-field="' + field + '"]');
          if (!control) throw new Error("붙여넣기에 편집할 수 없는 셀이 포함되어 있습니다.");
          changes.set(control, value);
        }
      }
      for (const [control, value] of changes) {
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
      workspace.querySelector("[data-year]").textContent = ACTIVE_SCHOOL_YEAR + "학년도 · 연간 커리큘럼";
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

  function showPreview() {
    invalidate();
    if (!drafts.size) {
      message.textContent = "저장할 변경 사항이 없습니다.";
      return;
    }
    try {
      const plan = planAssignments(before, teachers, drafts);
      if (!plan.rows.length) {
        message.textContent = "저장할 변경 사항이 없습니다.";
        return;
      }
      output.append(make("h3", "변경될 커리큘럼 행"), table(["학년", "과목", "항목", "현재", "변경 후"],
        plan.rows.flatMap(({ original, next, fields }) => fields.map(field =>
          [original.grade, courseName(original), titleFor(field), valueFor(original, field), valueFor(next, field)]))));
      output.append(make("h3", "교사별 시수 변화"), workloadTable(teacherTotals(before, teachers), teacherTotals(plan.after, teachers), true));
      message.textContent = `변경 ${plan.rows.length}행 · 연결된 행 포함` +
        (plan.planningRows ? ` · 같은 과목카드를 참조하는 3개년 계획 ${plan.planningRows}행에도 과목카드 변경이 표시됩니다.` : "");
      preview = plan;
      save.disabled = false;
      output.scrollIntoView({ block: "nearest" });
    } catch (error) {
      message.textContent = error.message;
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
    if (preview) {
      showPreview();
      return;
    }
    output.replaceChildren(make("h3", "현재 교사별 배정"), workloadTable(teacherTotals(before, teachers)));
    output.scrollIntoView({ block: "nearest" });
  });
  previewButton.addEventListener("click", showPreview);
  save.addEventListener("click", async () => {
    if (!preview || saving || !canEdit()) return;
    saving = true;
    close.disabled = previewButton.disabled = save.disabled = true;
    matrix.inert = open.disabled = semester.disabled = filter.disabled = search.disabled = true;
    try {
      if (JSON.stringify(teachers) !== JSON.stringify(appState.teachers)) throw new Error("교사 데이터가 변경되었습니다. 화면을 다시 열어 주세요.");
      await saveCurriculumPaste(before, preview.after, { includeRosters: preview.includeRosters });
      before = snapshot();
      originals = new Map(assignmentRows(before, teachers).map(entry => [entry.key, entry]));
      drafts.clear();
      invalidate();
      draw();
      message.textContent = "수업배정을 저장했습니다.";
    } catch (error) {
      message.textContent = error.message;
      save.disabled = false;
    } finally {
      saving = close.disabled = previewButton.disabled = matrix.inert =
        open.disabled = semester.disabled = filter.disabled = search.disabled = false;
    }
  });
}
