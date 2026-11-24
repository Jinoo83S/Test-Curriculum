import { getCurriculumSemesterTitles } from "./curriculum-academic-summary.js?v=r442";

const isEligible = row => row.category === "교과" && row.track === "공통" &&
  Boolean(row.sem1TemplateId || row.sem2TemplateId);
const groupFields = ["academicGroupId", "academicGroupName", "academicGroupCredits"];

export function clearAcademicGroup(row) {
  for (const field of groupFields) delete row[field];
}

export function moveAcademicGroups(source, destination, sameGrade) {
  if (!sameGrade) {
    clearAcademicGroup(source);
    clearAcademicGroup(destination);
    return;
  }
  for (const field of groupFields) {
    const first = source[field];
    const second = destination[field];
    if (second && isEligible(source)) source[field] = second; else delete source[field];
    if (first && isEligible(destination)) destination[field] = first; else delete destination[field];
  }
}

export function updateAcademicGroup(rows, { id, name, credits, rowIds }) {
  const members = new Set(rowIds);
  const selected = rows.filter(row => members.has(row.id));
  if (selected.length !== members.size ||
      selected.some(row => !isEligible(row) || (row.academicGroupId && row.academicGroupId !== id))) {
    throw new Error("선택한 과목 행이 변경됐습니다. 보드를 다시 열어 확인해 주세요.");
  }
  for (const row of rows) {
    if (members.has(row.id)) {
      row.academicGroupId = id;
      row.academicGroupName = name;
      row.academicGroupCredits = credits;
    } else if (row.academicGroupId === id) {
      clearAcademicGroup(row);
    }
  }
}

export function openAcademicGroups(targets, initialIndex = 0) {
  if (!targets.length) return;
  const dialog = document.createElement("dialog");
  dialog.className = "academic-groups-dialog";
  const form = document.createElement("form");
  const heading = document.createElement("h2");
  heading.textContent = "과목 묶음";
  const gradeSelect = document.createElement("select");
  gradeSelect.append(...targets.map(({ label }, index) => new Option(label, String(index))));
  gradeSelect.selectedIndex = Math.max(0, initialIndex);
  const currentTarget = () => targets[gradeSelect.selectedIndex];
  let groups;
  const select = document.createElement("select");
  select.setAttribute("aria-label", "편집할 과목 묶음");
  const name = document.createElement("input");
  name.type = "text"; name.name = "groupName"; name.placeholder = "예: 공통 체육"; name.required = true;
  const credits = document.createElement("input");
  credits.type = "number"; credits.name = "groupCredits"; credits.min = "0"; credits.step = "any";
  credits.placeholder = "비우면 구성 과목 중 가장 큰 값";
  const labelInput = (title, input) => {
    const wrapper = document.createElement("label");
    wrapper.append(document.createTextNode(title + " "), input);
    return wrapper;
  };
  const hint = document.createElement("p");
  hint.textContent = "같이 묶을 공통 교과를 두 개 이상 고르세요. 해당 학년의 합계에 한 과목으로 반영됩니다.";
  const list = document.createElement("div");
  list.className = "academic-groups-courses";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const actions = document.createElement("div");
  actions.className = "academic-groups-actions";
  const saveButton = document.createElement("button");
  saveButton.type = "submit"; saveButton.className = "primary-btn"; saveButton.textContent = "묶음 저장";
  const remove = document.createElement("button");
  remove.type = "button"; remove.className = "secondary-btn"; remove.textContent = "묶음 해제";
  const close = document.createElement("button");
  close.type = "button"; close.className = "secondary-btn"; close.textContent = "닫기";
  actions.append(remove, close, saveButton);
  const render = () => {
    const { rows, getTemplate } = currentTarget();
    const id = select.value;
    const group = groups.get(id);
    name.value = group?.academicGroupName || "";
    credits.value = group?.academicGroupCredits || "";
    remove.hidden = !id;
    status.textContent = "";
    list.replaceChildren(...rows.filter(isEligible).map(row => {
      const check = document.createElement("input");
      check.type = "checkbox"; check.name = "courses"; check.value = row.id;
      check.checked = Boolean(id) && row.academicGroupId === id;
      check.disabled = Boolean(row.academicGroupId && row.academicGroupId !== id);
      const titles = [...new Set(["sem1", "sem2"].map(term => {
        const templateId = row[term + "TemplateId"];
        return templateId ? getCurriculumSemesterTitles(getTemplate(templateId), term)?.name : "";
      }).filter(Boolean))];
      const label = document.createElement("label");
      label.append(check, document.createTextNode(`${titles.join(" / ") || "과목명 없음"} · ${row.credits || "0"}이수단위${check.disabled ? ` · ${row.academicGroupName || "다른 묶음"}` : ""}`));
      return label;
    }));
  };
  const renderGrade = () => {
    groups = new Map(currentTarget().rows.filter(row => row.academicGroupId)
      .map(row => [row.academicGroupId, row]));
    select.replaceChildren(new Option("새 묶음", ""), ...[...groups].map(([id, row]) =>
      new Option(row.academicGroupName || "과목 묶음", id)));
    render();
  };
  const persist = async change => {
    const { save } = currentTarget();
    gradeSelect.disabled = select.disabled = saveButton.disabled = remove.disabled = close.disabled = true;
    try {
      if (await save(change) !== false) dialog.close();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      gradeSelect.disabled = select.disabled = saveButton.disabled = remove.disabled = close.disabled = false;
    }
  };
  gradeSelect.addEventListener("change", renderGrade);
  select.addEventListener("change", render);
  close.addEventListener("click", () => dialog.close());
  remove.addEventListener("click", () => void persist({ id: select.value, rowIds: [] }));
  form.addEventListener("submit", event => {
    event.preventDefault();
    const rowIds = new FormData(form).getAll("courses");
    if (!name.value.trim() || rowIds.length < 2) {
      status.textContent = "묶음 이름을 입력하고 공통 교과를 두 개 이상 선택해 주세요.";
      return;
    }
    void persist({ id: select.value || crypto.randomUUID(), name: name.value.trim(), credits: credits.value, rowIds });
  });
  form.append(heading, labelInput("학년", gradeSelect), select, labelInput("묶음 이름", name),
    labelInput("묶음 이수단위", credits), hint, list, status, actions);
  dialog.append(form);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  renderGrade();
  dialog.showModal();
}
