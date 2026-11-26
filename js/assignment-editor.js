import { ACTIVE_SCHOOL_YEAR, GRADE_KEYS } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { canEdit } from "./auth.js?v=r424";
import { appState, saveCurriculumPaste } from "./state.js?v=r426";
import { ensureDomains } from "./app-domains.js?v=r432";
import { getCurriculumMode } from "./curriculum-mode.js?v=r401";
import { assignmentRows, planAssignments, teacherTotals, rowFields, termFields, terms } from "./assignment-editor-model.js?v=1";

const labels = {
  category: "범주", track: "구분", group: "교과군", credits: "학급별 시수",
  nameKo: "국문 과목명", nameEn: "영문 과목명", teacher: "담당교사", language: "수업 언어",
  classCount: "학급수", teacherLoadHours: "교사시수"
};
const columns = [...rowFields, ...terms.flatMap(term => termFields.map(field => term + "." + field))];
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
  const dialog = document.getElementById("assignmentEditor");
  const close = dialog.querySelector("[data-close]");
  const filter = dialog.querySelector("[data-grade]");
  const search = dialog.querySelector("[data-search]");
  const summary = dialog.querySelector("[data-summary]");
  const previewButton = dialog.querySelector("[data-preview]");
  const save = dialog.querySelector("[data-save]");
  const message = dialog.querySelector("[role=status]");
  const grid = dialog.querySelector("[data-grid]");
  const output = dialog.querySelector("[data-output]");
  const drafts = new Map();
  let before, teachers, rows, preview, saving = false;
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

  function fieldValue(entry, field) {
    return drafts.get(entry.key)?.[field] ?? valueFor(entry, field);
  }

  function edit(entry, field, value, control) {
    const changes = drafts.get(entry.key) || {};
    if (value.trim() === valueFor(entry, field).trim()) delete changes[field];
    else changes[field] = value;
    if (Object.keys(changes).length) drafts.set(entry.key, changes);
    else drafts.delete(entry.key);
    control?.classList.toggle("assignment-changed", Object.hasOwn(changes, field));
  }

  function editable(entry, field) {
    const [term, name] = field.split(".");
    return !name || (entry[term] && !(name === "teacher" && entry[term].compound));
  }

  function draw() {
    const needle = search.value.trim().toLocaleLowerCase();
    const visible = rows.filter(entry => (!filter.value || entry.grade === filter.value) && (!needle ||
      [courseName(entry), ...terms.flatMap(term => [entry[term]?.nameKo, entry[term]?.nameEn, fieldValue(entry, term + ".teacher")])]
        .join(" ").toLocaleLowerCase().includes(needle)));
    const header = ["학년", "과목", ...columns.map(titleFor), ...terms.flatMap((_, i) =>
      [`${i + 1}학기 과목시수`, `${i + 1}학기 명단 인원`, `${i + 1}학기 과목카드 ID`])];
    const node = table(header, []);
    for (const [index, entry] of visible.entries()) {
      const tr = node.tBodies[0].insertRow();
      tr.insertCell().textContent = entry.grade;
      tr.insertCell().textContent = courseName(entry);
      for (const [col, field] of columns.entries()) {
        const td = tr.insertCell();
        if (!editable(entry, field)) {
          td.textContent = valueFor(entry, field) || "—";
          continue;
        }
        const control = make("input");
        control.value = fieldValue(entry, field);
        control.dataset.cell = index + ":" + col;
        control.setAttribute("aria-label", entry.grade + " " + courseName(entry) + " " + titleFor(field));
        if (drafts.get(entry.key)?.[field] !== undefined) control.classList.add("assignment-changed");
        control.addEventListener("input", () => {
          edit(entry, field, control.value, control);
          invalidate();
        });
        td.append(control);
      }
      for (const term of terms) {
        const subject = entry[term];
        for (const value of [subject?.workload.total, subject?.students, subject?.id]) tr.insertCell().textContent = text(value);
      }
    }
    node.addEventListener("paste", event => {
      const first = event.target.dataset.cell;
      const plain = event.clipboardData?.getData("text/plain");
      if (!first || !plain || !/[\t\r\n]/.test(plain.replace(/\r?\n$/, ""))) return;
      event.preventDefault();
      const [startRow, startCol] = first.split(":").map(Number);
      const values = plain.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map(line => line.split("\t"));
      if (values.some((line, i) => !visible[startRow + i] || line.some((_, j) =>
        !columns[startCol + j] || !editable(visible[startRow + i], columns[startCol + j])))) {
        message.textContent = "붙여넣기 범위에 편집할 수 없는 셀이 있습니다. 범위를 줄여 다시 시도해 주세요.";
        return;
      }
      values.forEach((line, i) => line.forEach((value, j) => {
        const row = startRow + i, col = startCol + j;
        const control = node.querySelector('[data-cell="' + row + ":" + col + '"]');
        control.value = value;
        edit(visible[row], columns[col], value, control);
      }));
      invalidate();
    });
    grid.replaceChildren(node);
  }

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
      rows = assignmentRows(before, teachers);
      drafts.clear();
      filter.value = search.value = "";
      dialog.querySelector("[data-year]").textContent = ACTIVE_SCHOOL_YEAR + "학년도 · 연간 커리큘럼";
      invalidate();
      draw();
      dialog.showModal();
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

  open.addEventListener("click", start);
  filter.addEventListener("change", draw);
  search.addEventListener("input", draw);
  close.addEventListener("click", () => {
    if (!saving && (!drafts.size || confirm("저장하지 않은 변경을 취소할까요?"))) dialog.close();
  });
  dialog.addEventListener("cancel", event => {
    if (saving || (drafts.size && !confirm("저장하지 않은 변경을 취소할까요?"))) event.preventDefault();
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
    grid.inert = true;
    try {
      if (JSON.stringify(teachers) !== JSON.stringify(appState.teachers)) throw new Error("교사 데이터가 변경되었습니다. 화면을 다시 열어 주세요.");
      await saveCurriculumPaste(before, preview.after, { includeRosters: preview.includeRosters });
      before = snapshot();
      rows = assignmentRows(before, teachers);
      drafts.clear();
      invalidate();
      draw();
      message.textContent = "수업배정을 저장했습니다.";
    } catch (error) {
      message.textContent = error.message;
      save.disabled = false;
    } finally {
      saving = close.disabled = previewButton.disabled = grid.inert = false;
    }
  });
}
