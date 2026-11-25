import { ACTIVE_SCHOOL_YEAR, GRADE_KEYS } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { uid } from "./utils.js?v=2026-07-15-room-availability-separation-r355";
import { canEdit } from "./auth.js?v=r424";
import { appState, initialLoad, scheduleSave, saveNow } from "./state.js?v=r426";
import { getTemplateById, getSemesterTemplateData } from "./templates.js?v=r425";
import { JOINT_LESSON_TERMS, jointLessonHours, jointLessonRowKey, normalizeJointLessons } from "./joint-lessons.js?v=r451";

function make(tag, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function currentCourses() {
  const courses = new Map();
  for (const grade of GRADE_KEYS) {
    for (const row of appState.curriculum.gradeBoards[grade] || []) {
      const { id: rowId, sem1TemplateId = "", sem2TemplateId = "" } = row;
      const titles = JOINT_LESSON_TERMS.map(term => {
        const card = getTemplateById(row[term + "TemplateId"]);
        if (!card) return "";
        const subject = getSemesterTemplateData(card, term);
        return [subject.nameKo || subject.nameEn, subject.teacher].filter(Boolean).join(" · ");
      });
      if (!titles.some(Boolean)) continue;
      const label = `${grade} · ${titles[0] === titles[1] ? titles[0] : titles.map(title => title || "—").join(" / ")}`;
      courses.set(jointLessonRowKey(grade, rowId), {
        member: { grade, rowId, sem1TemplateId: sem1TemplateId || "", sem2TemplateId: sem2TemplateId || "" }, label,
      });
    }
  }
  return courses;
}

export function openJointLessonSettings() {
  if (!canEdit() || !initialLoad.curriculum || !initialLoad.templates) return;
  const dialog = make("dialog");
  dialog.className = "joint-lesson-dialog";
  dialog.setAttribute("aria-labelledby", "jointLessonTitle");
  const title = make("h2", `${ACTIVE_SCHOOL_YEAR}학년도 합동수업 묶음 관리`);
  title.id = "jointLessonTitle";
  const form = make("form");
  const field = (label, input) => {
    const wrap = make("label");
    wrap.append(make("span", label), input);
    return wrap;
  };
  const groupSelect = make("select");
  const name = make("input");
  name.required = true;
  name.maxLength = 100;
  const hours = Object.fromEntries(JOINT_LESSON_TERMS.map(term => {
    const input = make("input");
    input.type = "number";
    input.step = "any";
    input.min = "0";
    return [term, input];
  }));
  const inputs = make("div");
  inputs.className = "joint-lesson-fields";
  inputs.append(field("묶음 이름", name), field("1학기 교사시수", hours.sem1), field("2학기 교사시수", hours.sem2));

  const search = make("input");
  search.type = "search";
  search.placeholder = "학년·과목·교사 검색";
  const list = make("div");
  list.className = "joint-lesson-courses";
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "참여 학년과 과목");
  const selection = make("p");
  selection.setAttribute("aria-live", "polite");
  const status = make("p");
  status.setAttribute("role", "status");
  const actions = make("div");
  actions.className = "joint-lesson-actions";
  const remove = make("button", "묶음 해제");
  remove.type = "button";
  remove.className = "secondary-btn";
  const close = make("button", "닫기");
  close.type = "button";
  close.className = "secondary-btn";
  const save = make("button", "저장");
  save.type = "submit";
  save.className = "primary-btn";
  actions.append(remove, close, save);
  form.append(field("편집할 묶음", groupSelect), inputs,
    make("p", "함께 듣는 과목을 선택하고 실제 주간 교사시수를 입력하세요. 시수가 빈 학기는 개별 과목으로 계산합니다."),
    field("참여 학년·과목", search), selection, list, status, actions);
  dialog.append(title, form);

  let selected = new Set(), courses, original, saving = false;
  const updateSelection = () => { selection.textContent = `선택 ${selected.size}개`; };
  function renderCourses() {
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    list.replaceChildren();
    for (const [key, { label }] of courses) {
      if (!terms.every(term => label.toLowerCase().includes(term))) continue;
      const checkbox = make("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(key);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(key);
        else selected.delete(key);
        updateSelection();
      });
      const option = make("label");
      option.append(checkbox, make("span", label));
      list.append(option);
    }
    if (!list.children.length) list.append(make("p", "선택할 과목이 없습니다."));
    updateSelection();
  }
  const groups = () => normalizeJointLessons(appState.curriculum.jointLessons);
  function load(id = "") {
    const entries = groups();
    groupSelect.replaceChildren(new Option("새 묶음 만들기", ""), ...entries.map(group => new Option(group.name, group.id)));
    original = entries.find(group => group.id === id);
    groupSelect.value = original?.id || "";
    remove.hidden = !original;
    name.value = original?.name || "";
    for (const term of JOINT_LESSON_TERMS) hours[term].value = original?.hours[term] ?? "";
    courses = currentCourses();
    selected = new Set((original?.members || []).filter(member => {
      const current = courses.get(jointLessonRowKey(member.grade, member.rowId))?.member;
      return current && JOINT_LESSON_TERMS.some(term => member[term + "TemplateId"] &&
        current[term + "TemplateId"] === member[term + "TemplateId"]);
    }).map(member => jointLessonRowKey(member.grade, member.rowId)));
    const missing = (original?.members.length || 0) - selected.size;
    status.textContent = missing ? `보드에서 바뀐 과목 ${missing}개가 있습니다. 참여 과목을 확인해 주세요.` : "";
    search.value = "";
    renderCourses();
  }

  async function persist(next, id) {
    if (saving || !canEdit() || !initialLoad.curriculum) return;
    saving = true;
    const controls = [...form.elements].map(control => [control, control.disabled]);
    controls.forEach(([control]) => { control.disabled = true; });
    status.textContent = "저장 중…";
    appState.curriculum.jointLessons = next;
    scheduleSave("curriculum");
    try {
      const saved = await saveNow("curriculum");
      load(id);
      status.textContent = saved ? "저장했습니다." : "서버에 저장하지 못했습니다. 다시 저장해 주세요.";
    } catch (_) {
      load(id);
      status.textContent = "서버에 저장하지 못했습니다. 다시 저장해 주세요.";
    } finally {
      saving = false;
      controls.forEach(([control, wasDisabled]) => { control.disabled = wasDisabled; });
    }
  }

  function latestGroups() {
    const entries = groups();
    const latest = entries.find(group => group.id === original?.id);
    if (JSON.stringify(latest) !== JSON.stringify(original)) {
      load(original?.id);
      status.textContent = "묶음이 변경되었습니다. 최신 설정을 확인해 주세요.";
      return null;
    }
    return entries;
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    const entries = latestGroups();
    if (!entries) return;
    const latestCourses = currentCourses();
    const keys = [...selected];
    const members = keys.map(key => latestCourses.get(key)?.member);
    const values = Object.fromEntries(JOINT_LESSON_TERMS.map(term => [term, jointLessonHours(hours[term].value)]));
    if (!name.value.trim() || !Object.values(values).some(value => value !== null)
        || JOINT_LESSON_TERMS.some(term => hours[term].value && values[term] === null)) {
      status.textContent = "묶음 이름과 한 학기 이상의 교사시수를 0보다 큰 값으로 입력해 주세요.";
      return;
    }
    if (members.some((member, index) => JSON.stringify(member) !== JSON.stringify(courses.get(keys[index])?.member))) {
      status.textContent = "선택한 과목의 보드 배치가 변경되었습니다. 묶음을 다시 열어 주세요.";
      return;
    }
    const others = entries.filter(group => group.id !== original?.id);
    for (const term of JOINT_LESSON_TERMS.filter(term => values[term] !== null)) {
      const templateField = term + "TemplateId";
      const participating = members.filter(member => member?.[templateField]);
      const termLabel = term === "sem1" ? "1학기" : "2학기";
      if (participating.length < 2) {
        status.textContent = `${termLabel} 참여 과목을 두 개 이상 선택해 주세요.`;
        return;
      }
      const conflict = others.find(group => group.hours[term] !== null && group.members.some(member =>
        participating.some(item => item.grade === member.grade && item.rowId === member.rowId && item[templateField] === member[templateField])));
      if (conflict) {
        status.textContent = `${termLabel}에 이미 ‘${conflict.name}’에 속한 과목이 있습니다.`;
        return;
      }
    }
    const id = original?.id || uid("joint");
    const group = { id, name: name.value.trim(), hours: values, members };
    void persist([...others, group], id);
  });
  remove.addEventListener("click", () => {
    const entries = latestGroups();
    if (entries && original && confirm(`‘${original.name}’ 묶음을 해제할까요?`)) {
      void persist(entries.filter(group => group.id !== original.id), "");
    }
  });
  groupSelect.addEventListener("change", () => load(groupSelect.value));
  search.addEventListener("input", renderCourses);
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  load();
  dialog.showModal();
}
