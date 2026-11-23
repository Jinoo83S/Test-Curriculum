// Three-year cohort view: each column reads and writes the actual annual
// curriculum and template documents for its own academic year.
import { ACTIVE_SCHOOL_YEAR, GRADE_KEYS, getSchoolYearRefs } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { appState, initialLoad } from "./state.js?v=2026-07-15-room-availability-separation-r355";
import { canEdit } from "./auth.js?v=2026-07-15-room-availability-separation-r355";
import { LOCAL_DEV_MODE } from "./local-dev.js?v=2026-07-15-room-availability-separation-r355";
import { db } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getDoc, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const cache = new Map();
let renderSerial = 0;
const text = value => String(value ?? "").trim();
const subjectName = card => text(card?.nameKo || card?.sem1NameKo || card?.sem2NameKo || card?.nameEn || card?.sem1NameEn || card?.sem2NameEn) || "이름 없는 카드";
const yearForGrade = grade => String(Number(ACTIVE_SCHOOL_YEAR) + (Number.parseInt(grade, 10) <= 9 ? Number.parseInt(grade, 10) - 7 : Number.parseInt(grade, 10) - 10));
const el = (tag, className, label) => { const node = document.createElement(tag); if (className) node.className = className; if (label !== undefined) node.textContent = label; return node; };

export function clearThreeYearCache() { cache.clear(); renderSerial++; }

async function readYear(year) {
  if (year === ACTIVE_SCHOOL_YEAR && initialLoad.curriculum && initialLoad.templates) {
    return { exists: true, curriculum: appState.curriculum, templates: appState.templates };
  }
  if (LOCAL_DEV_MODE) return { exists: false, local: true };
  if (cache.has(year)) return cache.get(year);
  const refs = getSchoolYearRefs(year).domains;
  const promise = Promise.all([getDoc(refs.curriculum), getDoc(refs.templates)]).then(([curriculum, templates]) => ({
    exists: curriculum.exists(),
    curriculum: curriculum.exists() ? curriculum.data() : {},
    templates: templates.exists() ? templates.data() : {},
  })).catch(error => { cache.delete(year); throw error; });
  cache.set(year, promise);
  return promise;
}

async function changeYear(year, grade, change) {
  if (!canEdit()) return;
  if (LOCAL_DEV_MODE) {
    alert("3개 학년도의 공동 자료 편집은 온라인 모드에서 이용해 주세요."); return;
  }
  const refs = getSchoolYearRefs(year).domains;
  try {
    await runTransaction(db, async transaction => {
      const [curriculumSnap, templatesSnap] = await Promise.all([
        transaction.get(refs.curriculum), transaction.get(refs.templates)
      ]);
      if (!curriculumSnap.exists()) throw new Error(`${year}학년도 작업공간이 없습니다. 학년도 관리에서 먼저 생성해 주세요.`);
      const curriculum = structuredClone(curriculumSnap.data() || {});
      const templates = structuredClone(templatesSnap.exists() ? templatesSnap.data() || {} : {});
      curriculum.options ||= { category: ["교과","창체"], track: ["공통","배정","선택"], group: ["선택"] };
      curriculum.gradeBoards ||= {};
      curriculum.gradeBoards[grade] ||= [];
      templates.templates ||= [];
      const templatesChanged = change(curriculum, templates);
      transaction.set(refs.curriculum, { ...curriculum, updatedAt: serverTimestamp() });
      if (templatesChanged) transaction.set(refs.templates, { ...templates, updatedAt: serverTimestamp() });
    });
    cache.delete(year);
    document.dispatchEvent(new CustomEvent("his:three-year-changed"));
  } catch (error) {
    alert(`저장하지 못했습니다. ${error?.message || error}`);
  }
}

function fieldInput(year, grade, row, field) {
  const input = el("input", "three-year-field");
  input.value = text(row[field]);
  input.disabled = !canEdit() || LOCAL_DEV_MODE;
  input.setAttribute("aria-label", `${year}학년도 ${grade} ${field}`);
  input.addEventListener("change", () => {
    const value = input.value.trim();
    void changeYear(year, grade, curriculum => {
      const item = curriculum.gradeBoards[grade].find(current => current.id === row.id);
      if (!item) throw new Error("행이 변경되었습니다. 새로고침해 주세요.");
      item[field] = value;
      if (!curriculum.options[field]?.includes(value)) curriculum.options[field]?.push(value);
      return false;
    });
  });
  return input;
}

function templateSelect(year, grade, row, semester, cards) {
  const select = el("select", "three-year-field");
  const blank = el("option", "", "— 선택 —"); blank.value = ""; select.append(blank);
  const current = row[semester + "TemplateId"];
  for (const card of cards) {
    const option = el("option", "", subjectName(card));
    option.value = card.id;
    select.append(option);
  }
  if (current && !cards.some(card => card.id === current)) {
    const missing = el("option", "", "과목카드 없음"); missing.value = current; select.append(missing);
  }
  select.value = current || "";
  select.disabled = !canEdit() || LOCAL_DEV_MODE;
  select.setAttribute("aria-label", `${year}학년도 ${grade} ${semester === "sem1" ? "1학기" : "2학기"} 과목카드`);
  select.addEventListener("change", () => void changeYear(year, grade, curriculum => {
    const item = curriculum.gradeBoards[grade].find(current => current.id === row.id);
    if (!item) throw new Error("행이 변경되었습니다. 새로고침해 주세요.");
    item[semester + "TemplateId"] = select.value || null;
    return false;
  }));
  return select;
}

function addRowButton(year, grade) {
  const button = el("button", "secondary-btn", "행 추가");
  button.type = "button"; button.disabled = !canEdit() || LOCAL_DEV_MODE;
  button.addEventListener("click", () => void changeYear(year, grade, curriculum => {
    curriculum.gradeBoards[grade].push({
      id: "plan-row-" + crypto.randomUUID(), category: "교과", track: "공통", group: "선택",
      credits: "", sem1TemplateId: null, sem2TemplateId: null,
    });
    return false;
  }));
  return button;
}

function addCardButton(year, grade) {
  const button = el("button", "secondary-btn", "새 과목카드와 행");
  button.type = "button"; button.disabled = !canEdit() || LOCAL_DEV_MODE;
  button.addEventListener("click", () => {
    const nameKo = prompt(`${year}학년도 ${grade} 새 과목카드의 한글 이름을 입력하세요.`, "");
    if (!text(nameKo)) return;
    const nameEn = prompt("영문 이름(없으면 빈칸)", "") ?? "";
    const group = prompt("교과군(예: 국어, 수학, 사회)", "선택");
    if (group === null) return;
    void changeYear(year, grade, (curriculum, templates) => {
      const id = "tpl-" + crypto.randomUUID();
      templates.templates.push({
        id, nameKo: text(nameKo), nameEn: text(nameEn), teacher: "", language: "Both",
        schoolLevel: Number.parseInt(grade, 10) <= 9 ? "중등" : "고등",
      });
      const value = text(group) || "선택";
      if (!curriculum.options.group.includes(value)) curriculum.options.group.push(value);
      curriculum.gradeBoards[grade].push({
        id: "row-" + crypto.randomUUID(), category: "교과", track: "공통", group: value,
        credits: "", sem1TemplateId: id, sem2TemplateId: id,
      });
      return true;
    });
  });
  return button;
}

function column(grade, source) {
  const year = yearForGrade(grade);
  const section = el("section", "three-year-column");
  section.append(el("h3", "three-year-heading", `${year}학년도 · ${grade}`));
  if (!source?.exists) {
    const message = el("p", "three-year-empty", source?.local
      ? "다른 학년도 자료는 온라인 모드에서 확인할 수 있습니다."
      : "이 학년도 자료가 아직 없습니다.");
    section.append(message);
    return section;
  }
  const cards = (source.templates?.templates || []).filter(card =>
    !card.schoolLevel || card.schoolLevel === "공통" ||
    card.schoolLevel === (Number.parseInt(grade, 10) <= 9 ? "중등" : "고등")
  ).slice().sort((a, b) => subjectName(a).localeCompare(subjectName(b), "ko"));
  const rows = (source.curriculum?.gradeBoards?.[grade] || [])
    .filter(row => row.sem1TemplateId || row.sem2TemplateId || row.id?.startsWith("plan-row-") ||
      text(row.credits) || (text(row.group) && text(row.group) !== "선택"));
  if (!rows.length) section.append(el("p", "three-year-empty", "등록된 과목이 없습니다. 아래에서 행이나 과목카드를 추가할 수 있습니다."));
  for (const row of rows) {
    const item = el("div", "three-year-row");
    for (const field of ["category", "track", "group"]) item.append(fieldInput(year, grade, row, field));
    item.append(templateSelect(year, grade, row, "sem1", cards));
    item.append(templateSelect(year, grade, row, "sem2", cards));
    item.append(fieldInput(year, grade, row, "credits"));
    const remove = el("button", "secondary-btn three-year-delete", "×");
    remove.type = "button"; remove.disabled = !canEdit() || LOCAL_DEV_MODE; remove.title = "행 삭제";
    remove.addEventListener("click", () => {
      if (!confirm(`${year}학년도 ${grade} 행을 삭제할까요?`)) return;
      void changeYear(year, grade, curriculum => {
        curriculum.gradeBoards[grade] = curriculum.gradeBoards[grade].filter(current => current.id !== row.id);
        return false;
      });
    });
    item.append(remove); section.append(item);
  }
  const actions = el("div", "three-year-actions");
  actions.append(addRowButton(year, grade), addCardButton(year, grade));
  section.append(actions);
  return section;
}

export async function renderThreeYearBoard(container, grades) {
  const serial = ++renderSerial;
  container.classList.add("three-year-board");
  container.replaceChildren(el("p", "three-year-empty", "3개 학년도 커리큘럼을 불러오는 중입니다…"));
  const results = await Promise.all(grades.map(async grade => {
    try { return await readYear(yearForGrade(grade)); }
    catch (error) { console.warn("[three-year] annual read failed", grade, error); return { exists:false, error:true }; }
  }));
  if (serial !== renderSerial || !container.isConnected) return;
  container.replaceChildren();
  grades.forEach((grade, index) => container.append(column(grade, results[index])));
}
