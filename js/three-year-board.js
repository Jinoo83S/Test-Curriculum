// Three-year cohort view: each column reads and writes the actual annual
// curriculum and template documents for its own academic year.
import { ACTIVE_SCHOOL_YEAR, GRADE_KEYS, CATEGORY_PALETTE, DEFAULT_OPTIONS, getSchoolYearRefs } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { appState, initialLoad } from "./state.js?v=r426";
import { getKnownSchoolYears } from "./school-year.js?v=2026-07-15-room-availability-separation-r355";
import { canEdit } from "./auth.js?v=r424";
import { LOCAL_DEV_MODE } from "./local-dev.js?v=2026-07-15-room-availability-separation-r355";
import { db } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { languageClass, parseCreditValue } from "./utils.js?v=2026-07-15-room-availability-separation-r355";
import { getSemesterTemplateData, isSemesterDataSame } from "./templates.js?v=r425";
import { getDoc, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const cache = new Map();
let renderSerial = 0;
let managerSerial = 0;
let managerSearch = "";
let managerFilter = "all";
let managerVisibleYears = new Set();
const managerDrafts = new Map();
let selectedCardYear = null;
let draggedCard = null;
const text = value => String(value ?? "").trim();
const subjectName = card => text(card?.nameKo || card?.sem1NameKo || card?.sem2NameKo || card?.nameEn || card?.sem1NameEn || card?.sem2NameEn) || "이름 없는 카드";
const yearForGrade = grade => String(Number(ACTIVE_SCHOOL_YEAR) + (Number.parseInt(grade, 10) <= 9 ? Number.parseInt(grade, 10) - 7 : Number.parseInt(grade, 10) - 10));
const el = (tag, className, label) => { const node = document.createElement(tag); if (className) node.className = className; if (label !== undefined) node.textContent = label; return node; };

function emptyYearSource() {
  const options = Object.fromEntries(Object.entries(DEFAULT_OPTIONS).map(([key, values]) => [key, [...values]]));
  const gradeBoards = Object.fromEntries(GRADE_KEYS.map(grade => [grade,
    Array.from({ length: 4 }, () => ({
      id: "row-" + crypto.randomUUID(), category: options.category[0], track: options.track[0],
      group: options.group[0], credits: "", sem1TemplateId: null, sem2TemplateId: null,
    }))
  ]));
  return {
    curriculum: { options, gradeBoards },
    templates: { templates: [], templateGroups: [], units: [] },
  };
}

export function clearThreeYearCache() { cache.clear(); renderSerial++; }

async function readYear(year) {
  if (year === ACTIVE_SCHOOL_YEAR && initialLoad.curriculum && initialLoad.templates) {
    return { exists: true, curriculum: appState.curriculum, templates: appState.templates };
  }
  if (LOCAL_DEV_MODE) return { exists: false, local: true };
  if (cache.has(year)) return cache.get(year);
  const refs = getSchoolYearRefs(year).domains;
  const workspaceMeta = getSchoolYearRefs(year).workspaceMeta;
  const promise = Promise.all([
    getDoc(refs.curriculum), getDoc(refs.templates), workspaceMeta ? getDoc(workspaceMeta) : Promise.resolve(null)
  ]).then(([curriculum, templates, meta]) => {
    const empty = emptyYearSource();
    const exists = curriculum.exists() || !!meta?.exists?.();
    return {
      exists,
      emptyWorkspace: exists && !curriculum.exists(),
      curriculum: curriculum.exists() ? curriculum.data() : empty.curriculum,
      templates: templates.exists() ? templates.data() : empty.templates,
    };
  }).catch(error => { cache.delete(year); throw error; });
  cache.set(year, promise);
  return promise;
}

async function changeYear(year, grade, change) {
  if (!canEdit()) return;
  if (LOCAL_DEV_MODE) {
    alert("3개 학년도의 공동 자료 편집은 온라인 모드에서 이용해 주세요."); return;
  }
  const refs = getSchoolYearRefs(year).domains;
  const workspaceMeta = getSchoolYearRefs(year).workspaceMeta;
  try {
    const updated = await runTransaction(db, async transaction => {
      const [curriculumSnap, templatesSnap, workspaceSnap] = await Promise.all([
        transaction.get(refs.curriculum), transaction.get(refs.templates),
        workspaceMeta ? transaction.get(workspaceMeta) : Promise.resolve(null)
      ]);
      if (!curriculumSnap.exists() && !workspaceSnap?.exists?.()) throw new Error(`${year}학년도 작업공간이 없습니다. 학년도 관리에서 먼저 생성해 주세요.`);
      const empty = emptyYearSource();
      const current = curriculumSnap.exists() ? curriculumSnap.data() || {} : empty.curriculum;
      const currentTemplates = templatesSnap.exists() ? templatesSnap.data() || {} : empty.templates;
      const curriculum = {
        ...current,
        options: Object.fromEntries(Object.entries(current.options || {
          category: ["교과","창체"], track: ["공통","배정","선택"], group: ["선택"]
        }).map(([field, values]) => [field, Array.isArray(values) ? [...values] : []])),
        gradeBoards: { ...(current.gradeBoards || {}) },
      };
      curriculum.gradeBoards[grade] = (current.gradeBoards?.[grade] || []).map(row => ({ ...row }));
      const templates = { ...currentTemplates, templates: [...(currentTemplates.templates || [])] };
      const templatesChanged = change(curriculum, templates);
      transaction.set(refs.curriculum, { ...curriculum, updatedAt: serverTimestamp() });
      if (templatesChanged) transaction.set(refs.templates, { ...templates, updatedAt: serverTimestamp() });
      return { rows: curriculum.gradeBoards[grade], templates: templatesChanged ? templates.templates : null };
    });
    if (year === ACTIVE_SCHOOL_YEAR) {
      appState.curriculum.gradeBoards[grade] = updated.rows;
      if (updated.templates) appState.templates.templates = updated.templates;
    }
    cache.delete(year);
    document.dispatchEvent(new CustomEvent("his:three-year-changed"));
  } catch (error) {
    alert(`저장하지 못했습니다. ${error?.message || error}`);
  }
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

// Use the same board structure and card classes as the annual curriculum.
const editable = () => canEdit() && !LOCAL_DEV_MODE;
const visibleRows = (source, grade) => {
  const rows = source?.curriculum?.gradeBoards?.[grade] || [];
  if (!rows.some(row => row.sem1TemplateId || row.sem2TemplateId)) return rows;
  return rows.filter((row, index) => index >= 4 || row.sem1TemplateId || row.sem2TemplateId ||
    text(row.credits) || row.category !== DEFAULT_OPTIONS.category[0] ||
    row.track !== DEFAULT_OPTIONS.track[0] || row.group !== DEFAULT_OPTIONS.group[0]);
};
const optionsFor = (source, field, current) => {
  const values = source?.curriculum?.options?.[field] || DEFAULT_OPTIONS[field] || [];
  return [...new Set([...values, ...[current].filter(Boolean)])];
};
function orderedTracks(values) {
  const ordered = [];
  const variants = new Map();
  values.forEach((value, index) => {
    const match = text(value).match(/^(공통|배정|선택)\s*(\d+)$/);
    if (match) {
      if (!variants.has(match[1])) variants.set(match[1], []);
      variants.get(match[1]).push({ value, index, number: Number(match[2]) });
    }
  });
  const numbered = new Set([...variants.values()].flatMap(items => items.map(item => item.value)));
  values.forEach(value => {
    if (numbered.has(value)) return;
    ordered.push(value);
    if (variants.has(text(value))) {
      ordered.push(...variants.get(text(value)).sort((a, b) => a.number - b.number || a.index - b.index).map(item => item.value));
      variants.delete(text(value));
    }
  });
  variants.forEach(items => ordered.push(...items.map(item => item.value)));
  return ordered;
}
function summary(source, grade, category) {
  const rows = (source?.curriculum?.gradeBoards?.[grade] || []).filter(row =>
    row.category === category && (row.sem1TemplateId || row.sem2TemplateId));
  if (text(category) === "창체") return {
    totalCourses: rows.length, totalCredits: rows.length,
    totalHours: rows.reduce((total, row) => total + parseCreditValue(row.credits), 0)
  };
  if (text(category) !== "교과") return {
    totalCourses: rows.length, totalCredits: rows.length,
    totalHours: rows.reduce((total, row) => total + parseCreditValue(row.credits), 0)
  };
  const templates = source?.templates?.templates || [];
  const groups = source?.templates?.templateGroups || [];
  const groupId = row => {
    const ids = [...new Set([row.sem1TemplateId, row.sem2TemplateId].filter(Boolean))];
    const gids = [...new Set(ids.map(id => templates.find(card => card.id === id)?.calcGroupId).filter(Boolean))];
    return gids.length === 1 ? gids[0] : null;
  };
  const common = rows.filter(row => text(row.track) === "공통");
  const choices = rows.filter(row => text(row.track) !== "공통");
  const commonGrouped = new Map(), commonUngrouped = [];
  common.forEach(row => {
    const gid = groupId(row);
    if (!gid) commonUngrouped.push(row);
    else { if (!commonGrouped.has(gid)) commonGrouped.set(gid, []); commonGrouped.get(gid).push(row); }
  });
  const trackGroups = new Map();
  choices.forEach(row => {
    const key = text(row.track) || row.id;
    if (!trackGroups.has(key)) trackGroups.set(key, []);
    trackGroups.get(key).push(row);
  });
  const creditFor = (groupRows, gid) => {
    const configured = groups.find(group => group.id === gid)?.creditValue;
    return text(configured) ? parseCreditValue(configured) :
      Math.max(0, ...groupRows.map(row => parseCreditValue(row.credits)));
  };
  const totalCredits = commonUngrouped.reduce((n, row) => n + parseCreditValue(row.credits), 0) +
    [...commonGrouped].reduce((n, [gid, groupRows]) => n + creditFor(groupRows, gid), 0) +
    [...trackGroups.values()].reduce((n, groupRows) => {
      const gids = [...new Set(groupRows.map(groupId).filter(Boolean))];
      return n + creditFor(groupRows, gids.length === 1 ? gids[0] : null);
    }, 0);
  return { totalCourses: commonUngrouped.length + commonGrouped.size + trackGroups.size, totalCredits };
}
function header() {
  const row = el("div", "grade-header-row");
  ["범주", "구분", "교과군", "1학기", "2학기", "시수", ""].forEach(label => {
    row.append(el("div", "header-cell", label));
  });
  return row;
}
function categorySelect(year, grade, row, field, source) {
  const select = el("select", "row-select");
  const values = optionsFor(source, field, row[field]);
  (field === "track" ? orderedTracks(values) : values).forEach(value => {
    const option = el("option", "", value);
    option.value = value; select.append(option);
  });
  select.value = row[field] || "";
  select.disabled = !editable();
  select.setAttribute("aria-label", year + "학년도 " + grade + " " + field);
  if (field === "category") {
    select.classList.add("category-select");
    const index = values.indexOf(row.category);
    const color = CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
    if (index >= 0 && color) { select.style.backgroundColor = color.bg; select.style.color = color.text; }
  }
  select.addEventListener("change", () => {
    const value = select.value;
    void changeYear(year, grade, curriculum => {
      const item = curriculum.gradeBoards[grade].find(current => current.id === row.id);
      if (!item) throw new Error("행이 변경되었습니다. 새로고침해 주세요.");
      item[field] = value;
      if (!curriculum.options[field]?.includes(value)) curriculum.options[field]?.push(value);
      return false;
    });
  });
  return select;
}
function cardCell(year, grade, row, sem, source, cards, grades, sources, merged = false) {
  const id = row[sem + "TemplateId"];
  const cell = el("div", merged ? "drop-cell merged-drop-cell" : id ? "drop-cell" : "drop-cell empty");
  if (merged) cell.style.gridColumn = "4 / 6";
  cell.addEventListener("dragover", event => {
    if (!editable() || draggedCard?.year !== year) return;
    event.preventDefault(); cell.classList.add("dragover");
  });
  cell.addEventListener("dragleave", () => cell.classList.remove("dragover"));
  cell.addEventListener("drop", event => {
    cell.classList.remove("dragover");
    if (!editable() || draggedCard?.year !== year) return;
    event.preventDefault();
    const drag = { ...draggedCard };
    void changeYear(year, grade, curriculum => {
      const destination = curriculum.gradeBoards[grade].find(current => current.id === row.id);
      if (!destination) throw new Error("행이 변경되었습니다. 새로고침해 주세요.");
      if (drag.kind === "placed") {
        const sourceRow = curriculum.gradeBoards[grade].find(current => current.id === drag.rowId);
        if (!sourceRow) throw new Error("이동할 행이 변경되었습니다. 새로고침해 주세요.");
        if (sourceRow.id === destination.id) return false;
        const sourcePair = [sourceRow.sem1TemplateId || null, sourceRow.sem2TemplateId || null];
        const destinationPair = [destination.sem1TemplateId || null, destination.sem2TemplateId || null];
        [destination.sem1TemplateId, destination.sem2TemplateId] = sourcePair;
        [sourceRow.sem1TemplateId, sourceRow.sem2TemplateId] = destinationPair;
      } else {
        destination.sem1TemplateId = drag.id;
        destination.sem2TemplateId = drag.id;
      }
      return false;
    });
  });
  const template = cards.find(card => card.id === id) ||
    (source?.templates?.templates || []).find(card => card.id === id);
  if (!template) return cell;
  const data = getSemesterTemplateData(template, sem);
  const card = el("div", "placed-card " + (merged ? "placed-card-merged " : "") + languageClass(data.language));
  card.title = "끌어서 1·2학기를 함께 이동 · 클릭하여 상세 편집";
  card.draggable = editable();
  card.addEventListener("dragstart", event => {
    draggedCard = { kind: "placed", year, grade, rowId: row.id };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.id);
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    draggedCard = null;
    card.classList.remove("dragging");
  });
  const top = el("div", "placed-top");
  const title = el("div", "placed-title-wrap");
  title.append(el("div", "placed-title-ko", data.nameKo || data.nameEn || "-"),
    el("div", "placed-title-en", data.nameEn || "-"));
  top.append(title);
  if (editable()) {
    const clear = el("button", "clear-cell-btn", "×");
    clear.type = "button"; clear.title = "과목카드 제거";
    clear.addEventListener("click", event => {
      event.stopPropagation();
      void changeYear(year, grade, curriculum => {
        const item = curriculum.gradeBoards[grade].find(current => current.id === row.id);
        if (!item) throw new Error("행이 변경되었습니다. 새로고침해 주세요.");
        item.sem1TemplateId = null;
        item.sem2TemplateId = null;
        return false;
      });
    });
    top.append(clear);
  }
  card.append(top);
  card.addEventListener("click", event => {
    if (!editable() || event.target.closest("button")) return;
    void cardEditor(year, grade, template, grades, sources);
  });
  cell.append(card);
  return cell;
}
function gradeRow(grade, source, row, grades, sources) {
  const year = yearForGrade(grade);
  const result = el("div", "grade-data-row");
  result.dataset.grade = grade; result.dataset.rowId = row.id;
  for (const field of ["category", "track", "group"]) result.append(categorySelect(year, grade, row, field, source));
  const cards = (source?.templates?.templates || []).filter(card =>
    !card.schoolLevel || card.schoolLevel === "공통" ||
    card.schoolLevel === (Number.parseInt(grade, 10) <= 9 ? "중등" : "고등")
  ).slice().sort((a, b) => subjectName(a).localeCompare(subjectName(b), "ko"));
  const card = cards.find(item => item.id === row.sem1TemplateId);
  const merged = !!(row.sem1TemplateId && row.sem1TemplateId === row.sem2TemplateId &&
    card && isSemesterDataSame(card));
  if (merged) result.append(cardCell(year, grade, row, "sem1", source, cards, grades, sources, true));
  else result.append(cardCell(year, grade, row, "sem1", source, cards, grades, sources),
    cardCell(year, grade, row, "sem2", source, cards, grades, sources));
  const credit = el("input", "credit-input");
  credit.type = "text"; credit.value = row.credits ?? ""; credit.placeholder = "0";
  credit.disabled = !editable();
  credit.addEventListener("change", () => {
    const value = credit.value.trim();
    void changeYear(year, grade, curriculum => {
      const item = curriculum.gradeBoards[grade].find(current => current.id === row.id);
      if (!item) throw new Error("행이 변경되었습니다. 새로고침해 주세요.");
      item.credits = value; return false;
    });
  });
  result.append(credit);
  const remove = el("button", "row-delete-btn", "×");
  remove.type = "button"; remove.title = "행 삭제"; remove.disabled = !editable();
  remove.addEventListener("click", () => {
    if (!confirm(year + "학년도 " + grade + " 행을 삭제할까요?")) return;
    void changeYear(year, grade, curriculum => {
      curriculum.gradeBoards[grade] = curriculum.gradeBoards[grade].filter(current => current.id !== row.id);
      return false;
    });
  });
  result.append(remove);
  return result;
}
function spacer() {
  const row = el("div", "grade-data-row spacer-row");
  for (let index = 0; index < 7; index++) row.append(el("div", "spacer-cell"));
  return row;
}
function summaryRow(source, grade, category) {
  const result = summary(source, grade, category);
  const row = el("div", "category-summary-row");
  row.append(el("div", "category-summary-label", category + " 합계"),
    el("div", "category-summary-value", "Total #Courses " + result.totalCourses),
    el("div", "category-summary-value",
      text(category) === "창체" ? "Total #Hours " + (result.totalHours || 0) :
      "Total #Credits " + result.totalCredits));
  return row;
}
function sameCardCandidates(source, original) {
  if (!original) return [];
  const cards = source?.templates?.templates || [];
  const exact = cards.filter(card => card.id === original.id ||
    (original.sharedCardId && card.sharedCardId === original.sharedCardId));
  if (exact.length) return exact;
  const key = value => text(value).toLocaleLowerCase();
  const nameKo = key(original.nameKo), nameEn = key(original.nameEn);
  if (!nameKo && !nameEn) return [];
  return cards.filter(card =>
    key(card.schoolLevel || "공통") === key(original.schoolLevel || "공통") &&
    key(card.nameKo) === nameKo && key(card.nameEn) === nameEn);
}
async function saveCardForYears(entries, original, values, sharedId) {
  if (!editable()) return false;
  const selected = entries.filter(entry => entry.checked);
  if (!selected.length) return false;
  try {
    const refs = selected.map(entry => {
      const yearRefs = getSchoolYearRefs(entry.year);
      return { ...entry, refs: yearRefs.domains, workspaceMeta: yearRefs.workspaceMeta };
    });
    const changed = await runTransaction(db, async transaction => {
      // Read every document before performing the first write (Firestore transaction rule).
      const snapshots = await Promise.all(refs.map(async entry => ({
        entry,
        curriculum: await transaction.get(entry.refs.curriculum),
        templates: await transaction.get(entry.refs.templates),
        workspace: entry.workspaceMeta ? await transaction.get(entry.workspaceMeta) : null,
      })));
      const updates = [];
      for (const { entry, curriculum, templates, workspace } of snapshots) {
        if (!curriculum.exists() && !workspace?.exists?.()) throw new Error(entry.year + "학년도 작업공간이 없습니다.");
        const domain = templates.exists() ? templates.data() || {} : emptyYearSource().templates;
        const cards = [...(domain.templates || [])];
        if (entry.cardId !== "__new__") {
          const index = cards.findIndex(card => card.id === entry.cardId);
          if (index < 0) throw new Error(entry.year + "학년도 카드가 변경되었습니다. 다시 열어 주세요.");
          cards[index] = { ...cards[index], ...values, sharedCardId: sharedId };
        } else {
          const duplicate = cards.some(card =>
            text(card.nameKo) === text(values.nameKo) &&
            text(card.nameEn) === text(values.nameEn) &&
            text(card.schoolLevel) === text(values.schoolLevel));
          if (duplicate) throw new Error(entry.year + "학년도에 같은 과목명이 있습니다. 기존 카드를 선택해 주세요.");
          cards.push({ id: "tpl-" + crypto.randomUUID(), ...values, sharedCardId: sharedId });
        }
        updates.push({ year: entry.year, cards });
        transaction.set(entry.refs.templates, { ...domain, templates: cards, updatedAt: serverTimestamp() });
      }
      return updates;
    });
    changed.forEach(entry => {
      cache.delete(entry.year);
      if (entry.year === ACTIVE_SCHOOL_YEAR && appState.templates) {
        appState.templates.templates = entry.cards;
      }
    });
    document.dispatchEvent(new CustomEvent("his:three-year-changed"));
    return true;
  } catch (error) {
    alert("과목카드를 저장하지 못했습니다. " + (error?.message || error));
    return false;
  }
}
async function cardEditor(year, grade, original = null, grades = [grade], sources = {}) {
  if (!editable()) return;
  const yearList = [...new Set([...getKnownSchoolYears(), ...grades.map(yearForGrade)])]
    .sort((a, b) => Number(a) - Number(b));
  const yearSources = await Promise.all(yearList.map(async academicYear => {
    const cohortGrade = grades.find(item => yearForGrade(item) === academicYear);
    if (cohortGrade && sources[cohortGrade]) return sources[cohortGrade];
    try { return await readYear(academicYear); }
    catch (error) { console.warn("[three-year] card-year lookup failed", academicYear, error); return { exists: false, error: true }; }
  }));
  if (!editable()) return;
  const source = original || {};
  const dialog = el("dialog", "three-year-card-dialog");
  const form = el("form", "three-year-card-form");
  form.method = "dialog";
  form.append(el("h2", "", original ? "과목카드 편집" : "과목카드 추가"));
  const note = el("p", "three-year-card-year-note", "현재 선택: " + year + "학년도 · " + grade);
  form.append(note);
  const yearField = el("fieldset", "three-year-card-years");
  yearField.append(el("legend", "", "적용 및 저장할 학년도"));
  const hint = el("p", "three-year-card-hint", "체크한 학년도에만 저장합니다. 체크 해제해도 기존 카드는 삭제되지 않습니다.");
  yearField.append(hint);
  const yearEntries = [];
  yearList.forEach((academicYear, index) => {
    const item = grades.find(value => yearForGrade(value) === academicYear);
    const yearSource = yearSources[index];
    const candidates = sameCardCandidates(yearSource, original);
    const chosen = academicYear === year ? original : candidates.length === 1 ? candidates[0] : null;
    const row = el("div", "three-year-card-year-row");
    const label = el("label", "three-year-card-year-check");
    const checkbox = el("input"); checkbox.type = "checkbox";
    checkbox.checked = academicYear === year || !!(original && chosen);
    checkbox.disabled = !yearSource?.exists || academicYear === year;
    label.append(checkbox, el("span", "", academicYear + "학년도" + (item ? " · " + item : "")));
    const target = el("select", "three-year-card-year-target");
    const newOption = el("option", "", "새 카드 추가"); newOption.value = "__new__"; target.append(newOption);
    (yearSource?.templates?.templates || []).slice()
      .sort((a, b) => subjectName(a).localeCompare(subjectName(b), "ko"))
      .forEach(card => {
        const option = el("option", "", subjectName(card) + (card.nameEn ? " · " + card.nameEn : ""));
        option.value = card.id; target.append(option);
      });
    target.value = chosen?.id || "__new__";
    target.disabled = !yearSource?.exists || (!checkbox.checked && academicYear !== year);
    checkbox.addEventListener("change", () => { target.disabled = !checkbox.checked; });
    if (academicYear === year && original) target.disabled = true;
    if (academicYear === year && !original) target.disabled = true;
    row.append(label, target);
    if (!yearSource?.exists) row.append(el("span", "three-year-card-year-status", "자료 없음"));
    else if (candidates.length > 1) row.append(el("span", "three-year-card-year-status", "동명 카드 " + candidates.length + "개 · 직접 선택"));
    else if (chosen && academicYear !== year) row.append(el("span", "three-year-card-year-status", "기존 카드 연결"));
    yearField.append(row);
    yearEntries.push({ year: academicYear, checkbox, target, checked: checkbox.checked, cardId: target.value, index });
  });
  form.append(yearField);
  const fields = [
    ["nameKo", "과목명 (한글)"], ["nameEn", "과목명 (영문)"],
    ["teacher", "교사"], ["sem1NameKo", "1학기 과목명 (한글)"],
    ["sem1NameEn", "1학기 과목명 (영문)"], ["sem1Teacher", "1학기 교사"],
    ["sem2NameKo", "2학기 과목명 (한글)"], ["sem2NameEn", "2학기 과목명 (영문)"],
    ["sem2Teacher", "2학기 교사"]
  ];
  const inputs = {};
  fields.forEach(([key, label]) => {
    const wrapper = el("label", "three-year-card-field", label);
    const input = el("input");
    input.value = source[key] || ""; input.name = key;
    wrapper.append(input); form.append(wrapper); inputs[key] = input;
  });
  const levelLabel = el("label", "three-year-card-field", "학교급");
  const level = el("select");
  ["중등", "고등", "공통"].forEach(value => {
    const option = el("option", "", value); option.value = value; level.append(option);
  });
  level.value = source.schoolLevel || (Number.parseInt(grade, 10) <= 9 ? "중등" : "고등");
  levelLabel.append(level); form.append(levelLabel);
  const languageLabel = el("label", "three-year-card-field", "언어");
  const language = el("select");
  ["Both", "Korean", "English"].forEach(value => {
    const option = el("option", "", value); option.value = value; language.append(option);
  });
  language.value = source.language || "Both";
  languageLabel.append(language); form.append(languageLabel);
  const actions = el("div", "three-year-card-actions");
  const cancel = el("button", "secondary-btn", "취소"); cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  const save = el("button", "primary-btn", "저장"); save.type = "submit";
  actions.append(cancel, save); form.append(actions);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const values = Object.fromEntries(fields.map(([key]) => [key, inputs[key].value.trim()]));
    if (!values.nameKo && !values.nameEn && !values.sem1NameKo && !values.sem2NameKo) {
      alert("과목명을 입력해 주세요."); inputs.nameKo.focus(); return;
    }
    const chosenEntries = yearEntries.map(entry => ({
      year: entry.year, checked: entry.checkbox.checked, cardId: entry.target.value
    }));
    const alreadyExists = chosenEntries.filter(entry => entry.checked && entry.cardId !== "__new__");
    const addingExisting = !original && alreadyExists.length > 0;
    if (addingExisting && !confirm("선택한 학년도의 기존 과목카드를 덮어쓸까요?")) return;
    const useSemesterOverrides = !!(values.sem1NameKo || values.sem1NameEn || values.sem1Teacher ||
      values.sem2NameKo || values.sem2NameEn || values.sem2Teacher);
    save.disabled = true;
    const success = await saveCardForYears(chosenEntries, original, {
      ...values, language: language.value, schoolLevel: level.value, useSemesterOverrides
    }, original?.sharedCardId || original?.id || "shared-" + crypto.randomUUID());
    save.disabled = false;
    if (success) dialog.close();
  });
  dialog.append(form);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
function sidebarCard(year, grade, source, card, grades, sources) {
  const element = el("div", "template-card compact-card " + languageClass(card.language));
  element.draggable = editable();
  element.addEventListener("dragstart", event => {
    draggedCard = { kind: "template", year, id: card.id };
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", card.id);
    element.classList.add("dragging");
  });
  element.addEventListener("dragend", () => {
    draggedCard = null; element.classList.remove("dragging");
  });
  const main = el("div", "template-main template-main-one-line");
  const title = el("div", "template-name-ko", subjectName(card)); title.title = title.textContent;
  const badges = el("div", "template-applied-grades template-applied-grades-inline");
  const assigned = GRADE_KEYS.filter(item => (source.curriculum?.gradeBoards?.[item] || []).some(row =>
    row.sem1TemplateId === card.id || row.sem2TemplateId === card.id));
  (assigned.length ? assigned : ["미배정"]).forEach(item => {
    const badge = el("span", "grade-chip" + (item === "미배정" ? " grade-chip-none" : ""), item.replace("학년", ""));
    badges.append(badge);
  });
  const actions = el("div", "template-actions compact-actions");
  const edit = el("button", "edit-btn", "수정"); edit.type = "button"; edit.disabled = !editable();
  edit.addEventListener("click", event => { event.stopPropagation(); cardEditor(year, grade, card, grades, sources); });
  const copy = el("button", "copy-btn", "복사"); copy.type = "button"; copy.disabled = !editable();
  copy.addEventListener("click", event => {
    event.stopPropagation();
    void changeYear(year, grade, (_curriculum, templates) => {
      const current = templates.templates.find(item => item.id === card.id);
      if (!current) throw new Error("과목카드가 변경되었습니다. 새로고침해 주세요.");
      const { sharedCardId, ...copy } = current;
      templates.templates.push({ ...copy, id: "tpl-" + crypto.randomUUID(), nameKo: subjectName(current) + " (복사)" });
      return true;
    });
  });
  actions.append(edit, copy); main.append(title, badges, actions);
  const preview = el("div", "template-semester-preview template-semester-detail");
  ["sem1", "sem2"].forEach((sem, index) => {
    const info = getSemesterTemplateData(card, sem);
    const row = el("div", "semester-preview-item semester-preview-row");
    const label = el("div", "semester-preview-label", (index + 1) + "학기");
    const line = el("div", "semester-preview-line");
    line.append(el("div", "semester-preview-name semester-preview-ko", info.nameKo || "-"),
      el("div", "semester-preview-en", info.nameEn || ""),
      el("div", "semester-preview-teacher", info.teacher || "-"));
    row.append(label, line); preview.append(row);
  });
  element.append(main, preview);
  element.addEventListener("click", event => {
    if (event.target.closest("button")) return;
    element.classList.toggle("expanded");
  });
  return element;
}
function renderThreeYearSidebar(grades, sources) {
  const sidebar = document.getElementById("appSidebar");
  if (!sidebar) return;
  let panel = document.getElementById("threeYearCardSidebar");
  if (!panel) {
    panel = el("section", "panel three-year-sidebar-panel");
    panel.id = "threeYearCardSidebar";
    sidebar.prepend(panel);
  }
  const availableYears = grades.map(yearForGrade);
  if (!availableYears.includes(selectedCardYear)) selectedCardYear = availableYears[0];
  const grade = grades.find(value => yearForGrade(value) === selectedCardYear);
  const source = sources[grade];
  panel.replaceChildren();
  const heading = el("div", "section-heading-row subject-card-heading-row");
  heading.append(el("h2", "", "과목 카드"));
  const controls = el("div", "sidebar-btn-group");
  const add = el("button", "secondary-btn sidebar-add-template-btn", "+ 추가");
  add.type = "button"; add.disabled = !editable() || !source?.exists;
  add.addEventListener("click", () => cardEditor(selectedCardYear, grade, null, grades, sources));
  controls.append(add); heading.append(controls); panel.append(heading);
  const yearPicker = el("select", "school-level-select three-year-card-year");
  grades.forEach(item => {
    const option = el("option", "", yearForGrade(item) + "학년도 · " + item);
    option.value = yearForGrade(item); yearPicker.append(option);
  });
  yearPicker.value = selectedCardYear;
  yearPicker.setAttribute("aria-label", "과목카드 학년도 선택");
  yearPicker.addEventListener("change", () => {
    selectedCardYear = yearPicker.value;
    renderThreeYearSidebar(grades, sources);
  });
  const bar = el("div", "school-level-bar"); bar.append(yearPicker); panel.append(bar);
  const list = el("div", "template-list three-year-card-list");
  if (!source?.exists) {
    list.append(el("p", "three-year-empty", "이 학년도의 과목카드를 불러올 수 없습니다."));
  } else {
    const cards = (source.templates?.templates || []).filter(card =>
      !card.schoolLevel || card.schoolLevel === "공통" ||
      card.schoolLevel === (Number.parseInt(grade, 10) <= 9 ? "중등" : "고등"))
      .slice().sort((a, b) => subjectName(a).localeCompare(subjectName(b), "ko"));
    cards.forEach(card => list.append(sidebarCard(selectedCardYear, grade, source, card, grades, sources)));
    if (!cards.length) list.append(el("p", "three-year-empty", "과목카드가 없습니다. + 추가로 만들 수 있습니다."));
  }
  panel.append(list, el("p", "three-year-card-hint", "카드를 같은 학년도 열의 학기 칸이나 하단에 끌어다 놓으세요."));
}
function column(grade, source) {
  const year = yearForGrade(grade);
  const col = el("section", "grade-column");
  const categories = [...new Set([...(source?.curriculum?.options?.category || DEFAULT_OPTIONS.category),
    ...(source?.curriculum?.gradeBoards?.[grade] || []).map(row => row.category).filter(Boolean)])];
  const total = categories.reduce((result, category) => {
    const categoryTotal = summary(source, grade, category);
    result.totalCourses += categoryTotal.totalCourses;
    result.totalCredits += categoryTotal.totalCredits;
    return result;
  }, { totalCourses: 0, totalCredits: 0 });
  const title = el("div", "grade-title");
  const top = el("div", "grade-title-top");
  const totals = el("div", "grade-title-totals");
  totals.append(el("span", "grade-title-badge", "Total #Courses " + total.totalCourses),
    el("span", "grade-title-badge", "Total #Credits " + total.totalCredits));
  top.append(el("span", "grade-title-name", grade + " · " + year + "학년도"), totals);
  title.append(top); col.append(title, header());
  return col;
}
export async function renderThreeYearBoard(container, grades) {
  const serial = ++renderSerial;
  container.classList.remove("three-year-board");
  container.replaceChildren(el("p", "three-year-empty", "3개 학년도 커리큘럼을 불러오는 중입니다…"));
  const results = await Promise.all(grades.map(async grade => {
    try { return await readYear(yearForGrade(grade)); }
    catch (error) { console.warn("[three-year] annual read failed", grade, error); return { exists: false, error: true }; }
  }));
  if (serial !== renderSerial || !container.isConnected) return;
  const sources = Object.fromEntries(grades.map((grade, index) => [grade, results[index]]));
  const columns = Object.fromEntries(grades.map(grade => [grade, column(grade, sources[grade])]));
  const categories = [...new Set(grades.flatMap(grade => [
    ...(sources[grade]?.curriculum?.options?.category || DEFAULT_OPTIONS.category),
    ...visibleRows(sources[grade], grade).map(row => row.category).filter(Boolean)
  ]))];
  categories.forEach(category => {
    const tracks = orderedTracks([...new Set(grades.flatMap(grade => [
      ...(sources[grade]?.curriculum?.options?.track || DEFAULT_OPTIONS.track),
      ...visibleRows(sources[grade], grade).filter(row => row.category === category)
        .map(row => row.track).filter(Boolean)
    ]))]);
    tracks.forEach(track => {
      const rowsByGrade = Object.fromEntries(grades.map(grade => [
        grade, visibleRows(sources[grade], grade).filter(row => row.category === category && row.track === track)
      ]));
      const count = Math.max(0, ...grades.map(grade => rowsByGrade[grade].length));
      if (!count) return;
      grades.forEach(grade => columns[grade].append(el("div", "track-group-divider", track || "구분 없음")));
      for (let index = 0; index < count; index++) grades.forEach(grade =>
        columns[grade].append(rowsByGrade[grade][index] ?
          gradeRow(grade, sources[grade], rowsByGrade[grade][index], grades, sources) : spacer()));
    });
    if (grades.some(grade => visibleRows(sources[grade], grade).some(row => row.category === category))) {
      grades.forEach(grade => columns[grade].append(summaryRow(sources[grade], grade, category)));
    }
  });
  grades.forEach(grade => {
    const source = sources[grade], footer = el("div", "grade-footer");
    if (source?.exists) {
      const add = addRowButton(yearForGrade(grade), grade);
      add.className = "add-row-btn";
      add.textContent = grade + " 행 추가";
      footer.append(add, addCardButton(yearForGrade(grade), grade));
      footer.addEventListener("dragover", event => {
        if (!editable() || draggedCard?.kind !== "template" || draggedCard?.year !== yearForGrade(grade)) return;
        event.preventDefault(); footer.classList.add("three-year-drop-ready");
      });
      footer.addEventListener("dragleave", () => footer.classList.remove("three-year-drop-ready"));
      footer.addEventListener("drop", event => {
        footer.classList.remove("three-year-drop-ready");
        if (!editable() || draggedCard?.kind !== "template" || draggedCard?.year !== yearForGrade(grade)) return;
        event.preventDefault();
        const templateId = draggedCard.id;
        void changeYear(yearForGrade(grade), grade, curriculum => {
          curriculum.gradeBoards[grade].push({
            id: "row-" + crypto.randomUUID(), category: "교과", track: "공통", group: "선택",
            credits: "", sem1TemplateId: templateId, sem2TemplateId: templateId
          });
          return false;
        });
      });
    } else {
      footer.append(el("span", "three-year-empty", source?.local ?
        "다른 학년도 자료는 온라인 모드에서 확인할 수 있습니다." :
        source?.error ? "학년도 자료를 불러오지 못했습니다." : "이 학년도 자료가 아직 없습니다."));
    }
    columns[grade].append(footer);
  });
  container.replaceChildren(...grades.map(grade => columns[grade]));
  renderThreeYearSidebar(grades, sources);
}

async function saveManagerDrafts(year, grade) {
  const changes = managerDrafts.get(year);
  if (!editable() || !changes?.size) return false;
  const refs = getSchoolYearRefs(year).domains;
  const workspaceMeta = getSchoolYearRefs(year).workspaceMeta;
  try {
    const updated = await runTransaction(db, async transaction => {
      const [curriculum, templates, workspace] = await Promise.all([
        transaction.get(refs.curriculum), transaction.get(refs.templates),
        workspaceMeta ? transaction.get(workspaceMeta) : Promise.resolve(null)
      ]);
      if (!curriculum.exists() && !workspace?.exists?.()) throw new Error(year + "학년도 작업공간이 없습니다.");
      const domain = templates.exists() ? templates.data() || {} : emptyYearSource().templates;
      const cards = (domain.templates || []).map(card => ({ ...card }));
      for (const [id, patch] of changes) {
        const card = cards.find(item => item.id === id);
        if (!card) throw new Error("카드가 변경되었습니다. 다시 확인해 주세요: " + id);
        Object.assign(card, patch);
        if (!text(card.nameKo) && !text(card.nameEn) &&
            !text(card.sem1NameKo) && !text(card.sem2NameKo)) {
          throw new Error("과목명을 비워 둘 수 없습니다: " + id);
        }
      }
      transaction.set(refs.templates, { ...domain, templates: cards, updatedAt: serverTimestamp() });
      return cards;
    });
    if (year === ACTIVE_SCHOOL_YEAR && appState.templates) appState.templates.templates = updated;
    cache.delete(year);
    managerDrafts.delete(year);
    document.dispatchEvent(new CustomEvent("his:three-year-changed"));
    return true;
  } catch (error) {
    alert("과목카드를 저장하지 못했습니다. " + (error?.message || error));
    return false;
  }
}
function managerCard(grade, source, card, grades, sources, onDraft) {
  const year = yearForGrade(grade);
  const item = el("details", "three-year-manager-card " + languageClass(card.language));
  const draft = managerDrafts.get(year)?.get(card.id) || {};
  const cardInput = (field, label) => {
    const wrapper = el("label", "three-year-manager-card-field");
    wrapper.append(el("span", "", label));
    const input = el("input", "three-year-manager-input");
    input.value = draft[field] ?? card[field] ?? "";
    input.placeholder = label;
    input.disabled = !editable();
    input.setAttribute("aria-label", year + "학년도 " + subjectName(card) + " " + label);
    input.addEventListener("input", () => {
      let drafts = managerDrafts.get(year);
      if (!drafts) { drafts = new Map(); managerDrafts.set(year, drafts); }
      const patch = { ...(drafts.get(card.id) || {}) };
      if (input.value.trim() === text(card[field])) delete patch[field];
      else patch[field] = input.value.trim();
      if (Object.keys(patch).length) drafts.set(card.id, patch);
      else drafts.delete(card.id);
      if (!drafts.size) managerDrafts.delete(year);
      onDraft?.();
    });
    wrapper.append(input); return wrapper;
  };
  const heading = el("summary", "three-year-manager-card-heading");
  heading.append(el("strong", "", subjectName(card)));
  const applied = GRADE_KEYS.filter(item => (source.curriculum?.gradeBoards?.[item] || []).some(entry =>
    entry.sem1TemplateId === card.id || entry.sem2TemplateId === card.id));
  const badges = el("div", "three-year-manager-card-badges");
  (applied.length ? applied : ["미배정"]).forEach(value =>
    badges.append(el("span", "grade-chip" + (value === "미배정" ? " grade-chip-none" : ""), value.replace("학년", ""))));
  heading.append(badges);
  const fields = el("div", "three-year-manager-card-fields");
  fields.append(cardInput("nameKo", "한글 과목명"), cardInput("nameEn", "영문 과목명"), cardInput("teacher", "교사"));
  const actions = el("div", "three-year-manager-card-actions");
  const edit = el("button", "secondary-btn", "상세 편집");
  edit.type = "button"; edit.disabled = !editable();
  edit.addEventListener("click", () => {
    if (managerDrafts.get(year)?.has(card.id)) {
      alert("이 카드의 변경사항을 먼저 저장한 후 상세 편집을 열어 주세요."); return;
    }
    void cardEditor(year, grade, card, grades, sources);
  });
  actions.append(edit);
  item.append(heading, fields, actions);
  return item;
}
function managerGroup(grade, source, cards, label, grades, sources, onDraft) {
  const wrap = el("section", "three-year-manager-group");
  wrap.append(el("h4", "", label + " · " + cards.length + "개"));
  if (!cards.length) { wrap.append(el("p", "three-year-empty", "표시할 카드가 없습니다.")); return wrap; }
  const grid = el("div", "three-year-manager-card-grid");
  cards.forEach(card => grid.append(managerCard(grade, source, card, grades, sources, onDraft)));
  wrap.append(grid);
  return wrap;
}
export async function renderThreeYearCardManager(container, grades, onTabChange) {
  if (!container) return;
  const serial = ++managerSerial;
  container.replaceChildren(el("p", "three-year-empty", "학년도별 과목카드를 불러오는 중입니다…"));
  const results = await Promise.all(grades.map(async grade => {
    try { return await readYear(yearForGrade(grade)); }
    catch (error) { console.warn("[three-year] card manager read failed", grade, error); return { exists: false, error: true }; }
  }));
  if (serial !== managerSerial || !container.isConnected) return;
  const sources = Object.fromEntries(grades.map((grade, index) => [grade, results[index]]));
  const availableYears = grades.map(yearForGrade);
  managerVisibleYears = new Set([...managerVisibleYears].filter(year => availableYears.includes(year)));
  if (!managerVisibleYears.size) availableYears.forEach(year => managerVisibleYears.add(year));
  const toolbar = el("div", "three-year-manager-toolbar");
  const yearPicker = el("fieldset", "three-year-manager-year-picker");
  yearPicker.append(el("legend", "", "표시·편집할 학년도"));
  availableYears.forEach((year, index) => {
    const grade = grades[index];
    const label = el("label", "three-year-manager-year-option");
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.checked = managerVisibleYears.has(year);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) managerVisibleYears.add(year);
      else managerVisibleYears.delete(year);
      if (!managerVisibleYears.size) {
        managerVisibleYears.add(year);
        checkbox.checked = true;
        return;
      }
      refresh();
    });
    label.append(checkbox, el("span", "", year + "학년도"));
    yearPicker.append(label);
  });
  const search = el("input", "tpl-search-input");
  search.type = "search"; search.placeholder = "과목명 · 교사 검색"; search.value = managerSearch;
  search.setAttribute("aria-label", "3개년 과목카드 검색");
  const filter = el("select");
  [["all","전체 카드"], ["assigned","전체 학년 배정"], ["unassigned","전체 학년 미배정"]].forEach(([value,label]) => {
    const option = el("option", "", label); option.value = value; filter.append(option);
  });
  filter.value = managerFilter;
  const status = el("span", "three-year-manager-status");
  toolbar.append(yearPicker, search, filter, status);
  const columns = el("div", "three-year-manager-columns");
  function refresh() {
    columns.replaceChildren();
    const visibleGrades = grades.filter(grade => managerVisibleYears.has(yearForGrade(grade)));
    columns.style.setProperty("--three-year-visible-columns", String(Math.max(1, visibleGrades.length)));
    let total = 0;
    visibleGrades.forEach(grade => {
      const year = yearForGrade(grade);
      const source = sources[grade];
      const column = el("section", "three-year-manager-column");
      const heading = el("div", "three-year-manager-heading");
      heading.append(el("h3", "", year + "학년도 · 전체 과목카드"));
      const save = el("button", "primary-btn");
      const syncSave = () => {
        const count = managerDrafts.get(year)?.size || 0;
        save.textContent = count ? "이 학년도 저장 (" + count + ")" : "이 학년도 저장";
        save.disabled = !editable() || !count;
      };
      syncSave();
      save.type = "button";
      save.addEventListener("click", async () => {
        save.disabled = true;
        const inputs = [...column.querySelectorAll(".three-year-manager-input")];
        inputs.forEach(input => { input.disabled = true; });
        const success = await saveManagerDrafts(year, grade);
        if (!success) inputs.forEach(input => { input.disabled = !editable(); });
        syncSave();
      });
      if (source?.exists) {
        const add = el("button", "secondary-btn", "+ 과목카드");
        add.type = "button"; add.disabled = !editable();
        add.addEventListener("click", () => { void cardEditor(year, grade, null, grades, sources); });
        heading.append(add, save);
      }
      column.append(heading);
      if (!source?.exists) {
        column.append(el("p", "three-year-empty", source?.local ?
          "다른 학년도는 온라인 모드에서 확인할 수 있습니다." : "학년도 자료를 불러올 수 없습니다."));
        columns.append(column); return;
      }
      const query = managerSearch.trim().toLocaleLowerCase();
      const cards = (source.templates?.templates || [])
        .filter(card => !query || [card.nameKo,card.nameEn,card.sem1NameKo,card.sem2NameKo,
          card.teacher,card.sem1Teacher,card.sem2Teacher].some(value =>
          text(value).toLocaleLowerCase().includes(query)))
        .sort((a,b) => subjectName(a).localeCompare(subjectName(b),"ko"));
      const allRows = GRADE_KEYS.flatMap(item => source.curriculum?.gradeBoards?.[item] || []);
      const assigned = cards.filter(card => allRows.some(row =>
        row.sem1TemplateId === card.id || row.sem2TemplateId === card.id));
      const assignedIds = new Set(assigned.map(card => card.id));
      const unassigned = cards.filter(card => !assignedIds.has(card.id));
      const groups = new Map();
      assigned.forEach(card => {
        const tracks = orderedTracks([...new Set(allRows.filter(row =>
          row.sem1TemplateId === card.id || row.sem2TemplateId === card.id)
          .map(row => text(row.track) || "구분 없음"))]);
        const track = tracks.length ? tracks.join(" / ") : "구분 없음";
        if (!groups.has(track)) groups.set(track, []);
        groups.get(track).push(card);
      });
      const visibleIds = new Set();
      if (managerFilter !== "unassigned") {
        orderedTracks([...groups.keys()]).forEach(track => {
          const groupCards = groups.get(track) || [];
          groupCards.forEach(card => visibleIds.add(card.id));
          column.append(managerGroup(grade, source, groupCards, "구분 · " + track, grades, sources, syncSave));
        });
      }
      if (managerFilter !== "assigned") {
        unassigned.forEach(card => visibleIds.add(card.id));
        column.append(managerGroup(grade, source, unassigned, "전체 학년 미배정", grades, sources, syncSave));
      }
      total += visibleIds.size;
      columns.append(column);
    });
    status.textContent = "학년도 " + visibleGrades.length + "개 · 과목카드 " + total + "개";
  }
  search.addEventListener("input", () => { managerSearch = search.value; refresh(); });
  filter.addEventListener("change", () => { managerFilter = filter.value; refresh(); });
  container.replaceChildren(toolbar, columns);
  refresh();
}
