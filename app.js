import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBwUERcfAYMiqewOsp9zsY6_CnHef-nfK0",
  authDomain: "his-curriculum-8e737.firebaseapp.com",
  projectId: "his-curriculum-8e737",
  storageBucket: "his-curriculum-8e737.firebasestorage.app",
  messagingSenderId: "1091130688532",
  appId: "1:1091130688532:web:79622f9da3591ab2d3d301",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
const boardRef = doc(db, "boards", "main");

const authStatus = document.getElementById("authStatus");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const resetBoardBtn = document.getElementById("resetBoardBtn");
const loginOverlay = document.getElementById("loginOverlay");
const exportXlsxBtn = document.getElementById("exportXlsxBtn");

const templateList = document.getElementById("templateList");
const commonTemplateFields = document.getElementById("commonTemplateFields");
const templateNameKo = document.getElementById("templateNameKo");
const templateNameEn = document.getElementById("templateNameEn");
const templateTeacher = document.getElementById("templateTeacher");
const templateLanguage = document.getElementById("templateLanguage");
const templateSubmitBtn = document.getElementById("templateSubmitBtn");
const templateCancelBtn = document.getElementById("templateCancelBtn");
const templateSeparateSemesters = document.getElementById("templateSeparateSemesters");
const semesterTemplateFields = document.getElementById("semesterTemplateFields");
const templateSem1NameKo = document.getElementById("templateSem1NameKo");
const templateSem1NameEn = document.getElementById("templateSem1NameEn");
const templateSem1Teacher = document.getElementById("templateSem1Teacher");
const templateSem2NameKo = document.getElementById("templateSem2NameKo");
const templateSem2NameEn = document.getElementById("templateSem2NameEn");
const templateSem2Teacher = document.getElementById("templateSem2Teacher");

const categoryOptionList = document.getElementById("categoryOptionList");
const trackOptionList = document.getElementById("trackOptionList");
const groupOptionList = document.getElementById("groupOptionList");
const categoryOptionInput = document.getElementById("categoryOptionInput");
const trackOptionInput = document.getElementById("trackOptionInput");
const groupOptionInput = document.getElementById("groupOptionInput");
const addCategoryOptionBtn = document.getElementById("addCategoryOptionBtn");
const addTrackOptionBtn = document.getElementById("addTrackOptionBtn");
const addGroupOptionBtn = document.getElementById("addGroupOptionBtn");

const tab7to9Btn = document.getElementById("tab7to9Btn");
const tab10to12Btn = document.getElementById("tab10to12Btn");
const gradeBoard = document.getElementById("gradeBoard");

const GRADE_KEYS = ["7학년", "8학년", "9학년", "10학년", "11학년", "12학년"];
const GRADE_GROUPS = {
  tab7to9: ["7학년", "8학년", "9학년"],
  tab10to12: ["10학년", "11학년", "12학년"]
};
const DEFAULT_OPTIONS = {
  category: ["교과", "창체"],
  track: ["공통", "배정1", "배정2", "배정3", "선택1", "선택2", "선택3"],
  group: ["선택", "국어", "영어", "수학", "사회", "과학", "정보", "예술", "체육", "자율활동", "동아리", "채플", "기타"]
};
const DEFAULT_ROW_COUNT = 4;
const SEMESTER_LABELS = { sem1: "1학기", sem2: "2학기" };
const CATEGORY_PALETTE = [
  { bg: "#dbeafe", text: "#1e3a8a" },
  { bg: "#dcfce7", text: "#166534" },
  { bg: "#fef3c7", text: "#92400e" },
  { bg: "#fce7f3", text: "#9d174d" },
  { bg: "#ede9fe", text: "#5b21b6" },
  { bg: "#cffafe", text: "#155e75" }
];

let state = createDefaultState();
let unsubscribeBoard = null;
let currentDrag = null;
let templateEditId = null;
let saveTimer = null;
let activeTab = "tab7to9";

function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function clean(value) {
  return String(value ?? "").trim();
}

function uniqueOrdered(values) {
  const out = [];
  values.forEach((value) => {
    const trimmed = clean(value);
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  });
  return out;
}

function parseCredit(value) {
  const num = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function createDefaultTemplates() {
  return [
    normalizeTemplate({ id: uid("tpl"), nameKo: "영어", nameEn: "English", teacher: "", language: "English" }),
    normalizeTemplate({ id: uid("tpl"), nameKo: "국어", nameEn: "Korean Language Arts", teacher: "", language: "Korean" }),
    normalizeTemplate({ id: uid("tpl"), nameKo: "수학", nameEn: "Mathematics", teacher: "", language: "Both" }),
    normalizeTemplate({ id: uid("tpl"), nameKo: "과학", nameEn: "Science", teacher: "", language: "Both" })
  ];
}

function createRow(options = DEFAULT_OPTIONS, seed = {}) {
  return {
    id: uid("row"),
    category: clean(seed.category) || options.category[0] || "",
    track: clean(seed.track) || options.track[0] || "",
    group: clean(seed.group) || options.group[0] || "",
    credits: clean(seed.credits),
    templateId: seed.templateId ?? null
  };
}

function createDefaultState() {
  const gradeBoards = {};
  GRADE_KEYS.forEach((grade) => {
    gradeBoards[grade] = Array.from({ length: DEFAULT_ROW_COUNT }, () => createRow(DEFAULT_OPTIONS));
  });
  return {
    options: {
      category: [...DEFAULT_OPTIONS.category],
      track: [...DEFAULT_OPTIONS.track],
      group: [...DEFAULT_OPTIONS.group]
    },
    templates: createDefaultTemplates(),
    gradeBoards
  };
}

function normalizeTemplate(item = {}) {
  const language = ["Korean", "English", "Both"].includes(item.language) ? item.language : "Both";
  const sem1NameKo = clean(item.sem1NameKo);
  const sem1NameEn = clean(item.sem1NameEn);
  const sem1Teacher = clean(item.sem1Teacher);
  const sem2NameKo = clean(item.sem2NameKo);
  const sem2NameEn = clean(item.sem2NameEn);
  const sem2Teacher = clean(item.sem2Teacher);
  const useSemesterOverrides = Boolean(
    item.useSemesterOverrides || item.separateBySemester ||
    sem1NameKo || sem1NameEn || sem1Teacher || sem2NameKo || sem2NameEn || sem2Teacher
  );

  return {
    id: item.id || uid("tpl"),
    language,
    useSemesterOverrides,
    nameKo: clean(item.nameKo),
    nameEn: clean(item.nameEn),
    teacher: clean(item.teacher),
    sem1NameKo,
    sem1NameEn,
    sem1Teacher,
    sem2NameKo,
    sem2NameEn,
    sem2Teacher
  };
}

function normalizeRow(row = {}, options = DEFAULT_OPTIONS) {
  const templateId = row.templateId ?? row.sem1 ?? row.sem2 ?? null;
  const category = options.category.includes(row.category) ? row.category : (clean(row.category) || options.category[0] || "");
  const track = options.track.includes(row.track) ? row.track : (clean(row.track) || options.track[0] || "");
  const group = options.group.includes(row.group) ? row.group : (clean(row.group) || options.group[0] || "");

  return {
    id: row.id || uid("row"),
    category,
    track,
    group,
    credits: clean(row.credits),
    templateId
  };
}

function normalizeState(raw = {}) {
  const safeOptions = {
    category: Array.isArray(raw.options?.category) && raw.options.category.length ? uniqueOrdered(raw.options.category) : [...DEFAULT_OPTIONS.category],
    track: Array.isArray(raw.options?.track) && raw.options.track.length ? uniqueOrdered(raw.options.track) : [...DEFAULT_OPTIONS.track],
    group: Array.isArray(raw.options?.group) && raw.options.group.length ? uniqueOrdered(raw.options.group) : [...DEFAULT_OPTIONS.group]
  };

  const safeTemplates = Array.isArray(raw.templates) && raw.templates.length
    ? raw.templates.map(normalizeTemplate)
    : createDefaultTemplates();

  const gradeBoards = {};
  GRADE_KEYS.forEach((grade) => {
    const rows = Array.isArray(raw.gradeBoards?.[grade]) ? raw.gradeBoards[grade] : [];
    gradeBoards[grade] = rows.length
      ? rows.map((row) => normalizeRow(row, safeOptions))
      : Array.from({ length: DEFAULT_ROW_COUNT }, () => createRow(safeOptions));
  });

  return { options: safeOptions, templates: safeTemplates, gradeBoards };
}

function ensureStateConsistency() {
  state = normalizeState(state);
}

function canEdit() {
  return !!auth.currentUser;
}

function getTemplateById(templateId) {
  return state.templates.find((item) => item.id === templateId) || null;
}

function getSemesterTemplateData(templateOrId, semKey) {
  const item = typeof templateOrId === "string" ? getTemplateById(templateOrId) : templateOrId;
  if (!item) return { nameKo: "", nameEn: "", teacher: "", language: "Both" };
  if (!item.useSemesterOverrides) {
    return {
      nameKo: item.nameKo,
      nameEn: item.nameEn,
      teacher: item.teacher,
      language: item.language
    };
  }
  const prefix = semKey === "sem2" ? "sem2" : "sem1";
  return {
    nameKo: item[`${prefix}NameKo`] || item.nameKo,
    nameEn: item[`${prefix}NameEn`] || item.nameEn,
    teacher: item[`${prefix}Teacher`] || item.teacher,
    language: item.language
  };
}

function isSameSemesterDisplay(templateOrId) {
  const item = typeof templateOrId === "string" ? getTemplateById(templateOrId) : templateOrId;
  if (!item) return false;
  const sem1 = getSemesterTemplateData(item, "sem1");
  const sem2 = getSemesterTemplateData(item, "sem2");
  return sem1.nameKo === sem2.nameKo && sem1.nameEn === sem2.nameEn && sem1.teacher === sem2.teacher;
}

function getTemplateCardTitle(item) {
  const sem1 = getSemesterTemplateData(item, "sem1");
  return sem1.nameKo || sem1.nameEn || item.nameKo || item.nameEn || "-";
}

function getTeacherSummary(item) {
  const sem1 = getSemesterTemplateData(item, "sem1");
  const sem2 = getSemesterTemplateData(item, "sem2");
  if (isSameSemesterDisplay(item)) return sem1.teacher || item.teacher || "-";
  return `1학기 ${sem1.teacher || "-"} · 2학기 ${sem2.teacher || "-"}`;
}

function getDisplayNameLines(templateId, semKey) {
  const semesterData = getSemesterTemplateData(templateId, semKey);
  return {
    ko: semesterData.nameKo || "-",
    en: semesterData.nameEn || ""
  };
}

function toggleSemesterMode({ shouldClone = false } = {}) {
  const separate = templateSeparateSemesters.checked;
  commonTemplateFields.classList.toggle("hidden", separate);
  semesterTemplateFields.classList.toggle("hidden", !separate);

  if (separate && shouldClone) {
    const commonKo = clean(templateNameKo.value);
    const commonEn = clean(templateNameEn.value);
    const commonTeacher = clean(templateTeacher.value);

    if (!clean(templateSem1NameKo.value)) templateSem1NameKo.value = commonKo;
    if (!clean(templateSem1NameEn.value)) templateSem1NameEn.value = commonEn;
    if (!clean(templateSem1Teacher.value)) templateSem1Teacher.value = commonTeacher;
    if (!clean(templateSem2NameKo.value)) templateSem2NameKo.value = commonKo;
    if (!clean(templateSem2NameEn.value)) templateSem2NameEn.value = commonEn;
    if (!clean(templateSem2Teacher.value)) templateSem2Teacher.value = commonTeacher;
  }
}

function resetTemplateForm() {
  templateEditId = null;
  templateNameKo.value = "";
  templateNameEn.value = "";
  templateTeacher.value = "";
  templateSem1NameKo.value = "";
  templateSem1NameEn.value = "";
  templateSem1Teacher.value = "";
  templateSem2NameKo.value = "";
  templateSem2NameEn.value = "";
  templateSem2Teacher.value = "";
  templateSeparateSemesters.checked = false;
  templateLanguage.value = "Korean";
  templateSubmitBtn.textContent = "카드 추가";
  templateCancelBtn.classList.add("hidden");
  toggleSemesterMode();
}

function updateAuthUI(user) {
  if (user) {
    authStatus.textContent = `${user.displayName || user.email || "사용자"} 로그인됨`;
    loginBtn.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
    loginOverlay.classList.add("hidden");
  } else {
    authStatus.textContent = "로그인이 필요합니다";
    loginBtn.classList.remove("hidden");
    logoutBtn.classList.add("hidden");
    loginOverlay.classList.remove("hidden");
  }
}

function setControlsDisabled(disabled) {
  [
    templateNameKo, templateNameEn, templateTeacher, templateLanguage,
    templateSubmitBtn, templateCancelBtn, templateSeparateSemesters,
    templateSem1NameKo, templateSem1NameEn, templateSem1Teacher,
    templateSem2NameKo, templateSem2NameEn, templateSem2Teacher,
    categoryOptionInput, trackOptionInput, groupOptionInput,
    addCategoryOptionBtn, addTrackOptionBtn, addGroupOptionBtn, resetBoardBtn
  ].forEach((el) => {
    if (el) el.disabled = disabled;
  });
}

function scheduleSave() {
  if (!canEdit()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

async function saveNow() {
  if (!canEdit()) return;
  ensureStateConsistency();
  await setDoc(boardRef, { state, updatedAt: serverTimestamp() });
}

function addOption(type, value) {
  if (!canEdit()) return;
  const trimmed = clean(value);
  if (!trimmed) return;
  if (state.options[type].includes(trimmed)) {
    alert("이미 있는 옵션입니다.");
    return;
  }
  state.options[type].push(trimmed);
  ensureStateConsistency();
  render();
  scheduleSave();
}

function removeOption(type, value) {
  if (!canEdit()) return;
  if (state.options[type].length <= 1) {
    alert("최소 1개의 옵션은 남겨두어야 합니다.");
    return;
  }
  const ok = confirm(`"${value}" 옵션을 삭제할까요?`);
  if (!ok) return;
  state.options[type] = state.options[type].filter((item) => item !== value);
  ensureStateConsistency();
  render();
  scheduleSave();
}

function moveOption(type, index, direction) {
  if (!canEdit()) return;
  const arr = state.options[type];
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= arr.length) return;
  [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
  render();
  scheduleSave();
}

function renderOptionChips(container, type) {
  container.innerHTML = "";
  state.options[type].forEach((value, index) => {
    const chip = document.createElement("div");
    chip.className = "option-chip";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "order-btn";
    upBtn.textContent = "↑";
    upBtn.disabled = !canEdit() || index === 0;
    upBtn.addEventListener("click", () => moveOption(type, index, -1));

    const text = document.createElement("span");
    text.textContent = value;

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "order-btn";
    downBtn.textContent = "↓";
    downBtn.disabled = !canEdit() || index === state.options[type].length - 1;
    downBtn.addEventListener("click", () => moveOption(type, index, 1));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "×";
    delBtn.disabled = !canEdit();
    delBtn.addEventListener("click", () => removeOption(type, value));

    chip.append(upBtn, text, downBtn, delBtn);
    container.appendChild(chip);
  });
}

function submitTemplate() {
  if (!canEdit()) return;

  const useSemesterOverrides = templateSeparateSemesters.checked;
  const data = normalizeTemplate({
    id: templateEditId || uid("tpl"),
    language: templateLanguage.value,
    useSemesterOverrides,
    nameKo: templateNameKo.value,
    nameEn: templateNameEn.value,
    teacher: templateTeacher.value,
    sem1NameKo: templateSem1NameKo.value,
    sem1NameEn: templateSem1NameEn.value,
    sem1Teacher: templateSem1Teacher.value,
    sem2NameKo: templateSem2NameKo.value,
    sem2NameEn: templateSem2NameEn.value,
    sem2Teacher: templateSem2Teacher.value
  });

  if (useSemesterOverrides) {
    const sem1 = getSemesterTemplateData(data, "sem1");
    const sem2 = getSemesterTemplateData(data, "sem2");
    if (!(sem1.nameKo || sem1.nameEn || sem2.nameKo || sem2.nameEn)) {
      alert("1학기 또는 2학기 과목명을 입력해 주세요.");
      return;
    }
  } else if (!(data.nameKo || data.nameEn)) {
    alert("한글 이름 또는 영어 이름을 입력해 주세요.");
    return;
  }

  if (templateEditId) {
    state.templates = state.templates.map((item) => item.id === templateEditId ? data : item);
  } else {
    state.templates.push(data);
  }

  resetTemplateForm();
  render();
  scheduleSave();
}

function editTemplate(templateId) {
  if (!canEdit()) return;
  const item = getTemplateById(templateId);
  if (!item) return;

  templateEditId = templateId;
  templateNameKo.value = item.nameKo;
  templateNameEn.value = item.nameEn;
  templateTeacher.value = item.teacher;
  templateSem1NameKo.value = item.sem1NameKo;
  templateSem1NameEn.value = item.sem1NameEn;
  templateSem1Teacher.value = item.sem1Teacher;
  templateSem2NameKo.value = item.sem2NameKo;
  templateSem2NameEn.value = item.sem2NameEn;
  templateSem2Teacher.value = item.sem2Teacher;
  templateSeparateSemesters.checked = item.useSemesterOverrides;
  templateLanguage.value = item.language;
  templateSubmitBtn.textContent = "카드 수정 저장";
  templateCancelBtn.classList.remove("hidden");
  toggleSemesterMode();
}

function deleteTemplate(templateId) {
  if (!canEdit()) return;
  const item = getTemplateById(templateId);
  if (!item) return;
  const ok = confirm(`"${getTemplateCardTitle(item)}" 카드를 삭제할까요?`);
  if (!ok) return;

  state.templates = state.templates.filter((tpl) => tpl.id !== templateId);
  GRADE_KEYS.forEach((grade) => {
    state.gradeBoards[grade].forEach((row) => {
      if (row.templateId === templateId) row.templateId = null;
    });
  });

  if (templateEditId === templateId) resetTemplateForm();
  render();
  scheduleSave();
}

function languageClass(language) {
  return `lang-${String(language || "both").toLowerCase()}`;
}

function createTemplatePreviewCard(label, semesterData) {
  const box = document.createElement("div");
  box.className = "template-preview-card";

  const lbl = document.createElement("div");
  lbl.className = "template-preview-label";
  lbl.textContent = label;

  const ko = document.createElement("div");
  ko.className = "template-preview-title-ko";
  ko.textContent = semesterData.nameKo || "-";

  const en = document.createElement("div");
  en.className = "template-preview-title-en";
  en.textContent = semesterData.nameEn || "-";

  const teacher = document.createElement("div");
  teacher.className = "template-preview-teacher";
  teacher.textContent = semesterData.teacher || "-";

  box.append(lbl, ko, en, teacher);
  return box;
}

function createTemplateCard(item) {
  const card = document.createElement("div");
  card.className = `template-card ${languageClass(item.language)}`;
  card.draggable = canEdit();

  card.addEventListener("dragstart", () => {
    currentDrag = { kind: "template", templateId: item.id };
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    currentDrag = null;
    card.classList.remove("dragging");
  });

  const main = document.createElement("div");
  main.className = "template-main";
  const title = document.createElement("div");
  title.className = "template-name-ko";
  title.textContent = getTemplateCardTitle(item);
  main.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "template-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "edit-btn";
  editBtn.textContent = "수정";
  editBtn.disabled = !canEdit();
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    editTemplate(item.id);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "삭제";
  deleteBtn.disabled = !canEdit();
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteTemplate(item.id);
  });

  const teacherInfo = document.createElement("span");
  teacherInfo.className = "template-teacher-inline";
  teacherInfo.textContent = getTeacherSummary(item);

  actions.append(editBtn, deleteBtn, teacherInfo);

  const preview = document.createElement("div");
  preview.className = "template-semester-preview";
  const sem1 = getSemesterTemplateData(item, "sem1");
  const sem2 = getSemesterTemplateData(item, "sem2");
  if (isSameSemesterDisplay(item)) {
    preview.appendChild(createTemplatePreviewCard("공통", sem1));
  } else {
    preview.appendChild(createTemplatePreviewCard("1학기", sem1));
    preview.appendChild(createTemplatePreviewCard("2학기", sem2));
  }

  card.append(main, actions, preview);

  card.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    const wasExpanded = card.classList.contains("expanded");
    document.querySelectorAll(".template-card.expanded").forEach((el) => el.classList.remove("expanded"));
    if (!wasExpanded) card.classList.add("expanded");
  });

  return card;
}

function renderTemplates() {
  templateList.innerHTML = "";
  const sortedTemplates = [...state.templates].sort((a, b) => getTemplateCardTitle(a).localeCompare(getTemplateCardTitle(b), "ko"));
  sortedTemplates.forEach((item) => templateList.appendChild(createTemplateCard(item)));
}

function getRowById(grade, rowId) {
  return state.gradeBoards[grade]?.find((row) => row.id === rowId) || null;
}

function updateRowField(grade, rowId, field, value) {
  if (!canEdit()) return;
  const row = getRowById(grade, rowId);
  if (!row) return;
  row[field] = value;
  ensureStateConsistency();
  render();
  scheduleSave();
}

function clearCell(grade, rowId) {
  if (!canEdit()) return;
  const row = getRowById(grade, rowId);
  if (!row) return;
  row.templateId = null;
  render();
  scheduleSave();
}

function addRow(grade) {
  if (!canEdit()) return;
  const rows = state.gradeBoards[grade] || [];
  const lastRow = rows[rows.length - 1] || createRow(state.options);
  rows.push(createRow(state.options, {
    category: lastRow.category,
    track: lastRow.track,
    group: lastRow.group,
    credits: lastRow.credits
  }));
  render();
  scheduleSave();
}

function deleteRow(grade, rowId) {
  if (!canEdit()) return;
  const ok = confirm("이 행을 삭제할까요?");
  if (!ok) return;
  state.gradeBoards[grade] = (state.gradeBoards[grade] || []).filter((row) => row.id !== rowId);
  if (state.gradeBoards[grade].length === 0) {
    state.gradeBoards[grade].push(createRow(state.options));
  }
  render();
  scheduleSave();
}

function movePlacedCard(sourceGrade, sourceRowId, targetGrade, targetRowId) {
  if (!canEdit()) return;
  const sourceRow = getRowById(sourceGrade, sourceRowId);
  const targetRow = getRowById(targetGrade, targetRowId);
  if (!sourceRow || !targetRow) return;
  if (sourceRow.id === targetRow.id && sourceGrade === targetGrade) return;

  const temp = sourceRow.templateId;
  sourceRow.templateId = targetRow.templateId;
  targetRow.templateId = temp;
  render();
  scheduleSave();
}

function placeTemplateToRow(templateId, targetGrade, targetRowId) {
  if (!canEdit()) return;
  const row = getRowById(targetGrade, targetRowId);
  if (!row) return;
  if (row.templateId && row.templateId !== templateId) {
    const currentTemplate = getTemplateById(row.templateId);
    const ok = confirm(`현재 "${getTemplateCardTitle(currentTemplate || {})}" 카드가 있습니다. 교체할까요?`);
    if (!ok) return;
  }
  row.templateId = templateId;
  render();
  scheduleSave();
}

function createSelect(options, currentValue, onChange) {
  const select = document.createElement("select");
  select.className = "row-select";
  select.disabled = !canEdit();

  options.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    if (value === currentValue) option.selected = true;
    select.appendChild(option);
  });

  select.addEventListener("change", (e) => onChange(e.target.value));
  return select;
}

function createMetaChip(text) {
  const chip = document.createElement("span");
  chip.className = "meta-chip";
  chip.textContent = text;
  return chip;
}

function createPlacedCard(templateId, grade, rowId, semKey, { merged = false } = {}) {
  const item = getTemplateById(templateId);
  if (!item) return document.createTextNode("");

  const card = document.createElement("div");
  card.className = `placed-card ${languageClass(item.language)}${merged ? " merged-card" : ""}`;
  card.draggable = canEdit();

  card.addEventListener("dragstart", () => {
    currentDrag = { kind: "placed", sourceGrade: grade, sourceRowId: rowId, templateId };
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    currentDrag = null;
    card.classList.remove("dragging");
  });

  const top = document.createElement("div");
  top.className = "placed-top";
  const titleWrap = document.createElement("div");
  titleWrap.className = "placed-title-wrap";
  const names = getDisplayNameLines(templateId, semKey);

  const ko = document.createElement("div");
  ko.className = "placed-title-ko";
  ko.textContent = names.ko;
  const en = document.createElement("div");
  en.className = "placed-title-en";
  en.textContent = names.en || "";
  titleWrap.append(ko, en);
  top.appendChild(titleWrap);

  if (canEdit()) {
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "clear-cell-btn";
    clearBtn.textContent = "×";
    clearBtn.title = "행의 과목 제거";
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearCell(grade, rowId);
    });
    clearBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    top.appendChild(clearBtn);
  }

  const meta = document.createElement("div");
  meta.className = "placed-meta placed-meta-hidden";
  const teacher = getSemesterTemplateData(templateId, semKey).teacher;
  if (teacher) meta.appendChild(createMetaChip(teacher));

  card.append(top, meta);
  card.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    const isExpanded = card.classList.toggle("placed-expanded");
    meta.classList.toggle("placed-meta-hidden", !isExpanded);
    document.querySelectorAll(".placed-card.placed-expanded").forEach((other) => {
      if (other !== card) {
        other.classList.remove("placed-expanded");
        other.querySelector(".placed-meta")?.classList.add("placed-meta-hidden");
      }
    });
  });

  return card;
}

function createDropCell(grade, rowId, semKey, templateId, { merged = false } = {}) {
  const cell = document.createElement("div");
  cell.className = templateId ? "drop-cell" : "drop-cell empty";
  if (merged) cell.classList.add("merged-semesters");

  if (templateId) cell.appendChild(createPlacedCard(templateId, grade, rowId, semKey, { merged }));

  cell.addEventListener("dragover", (e) => {
    if (!canEdit()) return;
    e.preventDefault();
    cell.classList.add("dragover");
  });
  cell.addEventListener("dragleave", () => cell.classList.remove("dragover"));
  cell.addEventListener("drop", (e) => {
    if (!canEdit()) return;
    e.preventDefault();
    cell.classList.remove("dragover");
    if (!currentDrag) return;

    if (currentDrag.kind === "template") {
      placeTemplateToRow(currentDrag.templateId, grade, rowId);
      return;
    }
    if (currentDrag.kind === "placed") {
      movePlacedCard(currentDrag.sourceGrade, currentDrag.sourceRowId, grade, rowId);
    }
  });

  return cell;
}

const colResizeState = new WeakMap();

function applyColWidths(column, widths) {
  const tpl = widths.join(" ");
  column.querySelectorAll(".grade-header-row, .grade-data-row, .grade-summary-row").forEach((row) => {
    row.style.gridTemplateColumns = tpl;
  });
}

function initColResize(column, headerRow) {
  const widths = ["52px", "52px", "58px", "1fr", "1fr", "40px", "24px"];
  colResizeState.set(column, widths);

  headerRow.querySelectorAll(".col-resize-handle").forEach((handle, i) => {
    let startX;
    let startW;
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const headerCell = handle.parentElement;
      startX = e.clientX;
      startW = headerCell.getBoundingClientRect().width;
      handle.classList.add("resizing");

      function onMove(ev) {
        widths[i] = `${Math.max(36, startW + (ev.clientX - startX))}px`;
        applyColWidths(column, widths);
      }
      function onUp() {
        handle.classList.remove("resizing");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

function createSpacerGradeRow() {
  const row = document.createElement("div");
  row.className = "grade-data-row spacer-row";
  for (let i = 0; i < 7; i += 1) {
    const cell = document.createElement("div");
    cell.className = "spacer-cell";
    row.appendChild(cell);
  }
  return row;
}

function getVisibleCategoryOrder(visibleGrades) {
  const categories = visibleGrades.flatMap((grade) => (state.gradeBoards[grade] || []).map((row) => row.category).filter(Boolean));
  const unknown = categories.filter((value, index) => !state.options.category.includes(value) && categories.indexOf(value) === index);
  return [...state.options.category.filter((value) => categories.includes(value)), ...unknown];
}

function getVisibleTrackOrder(visibleGrades, category) {
  const tracks = visibleGrades.flatMap((grade) =>
    (state.gradeBoards[grade] || [])
      .filter((row) => row.category === category)
      .map((row) => row.track)
      .filter(Boolean)
  );
  const unknown = tracks.filter((value, index) => !state.options.track.includes(value) && tracks.indexOf(value) === index);
  return [...state.options.track.filter((value) => tracks.includes(value)), ...unknown];
}

function getRowsForCategoryTrack(grade, category, track) {
  return (state.gradeBoards[grade] || []).filter((row) => {
    if (row.category !== category) return false;
    if (category === "창체") return true;
    return row.track === track;
  });
}

function getCategorySummary(grade, category) {
  const rows = (state.gradeBoards[grade] || []).filter((row) => row.category === category && row.templateId);
  return {
    category,
    totalCourses: rows.length,
    totalCredits: rows.reduce((sum, row) => sum + parseCredit(row.credits), 0)
  };
}

function getGradeTotalUnits(grade) {
  const subject = getCategorySummary(grade, "교과");
  const activity = getCategorySummary(grade, "창체");
  return subject.totalCredits + activity.totalCourses;
}

function createGradeHeader() {
  const row = document.createElement("div");
  row.className = "grade-header-row";
  ["범주", "구분", "교과군", "1학기", "2학기", "시수", ""].forEach((label, i) => {
    const cell = document.createElement("div");
    cell.className = "header-cell";
    cell.textContent = label;
    if (i < 6) {
      const handle = document.createElement("div");
      handle.className = "col-resize-handle";
      cell.appendChild(handle);
    }
    row.appendChild(cell);
  });
  return row;
}

function getCategoryColor(category) {
  const index = state.options.category.indexOf(category);
  if (index < 0) return { bg: "#f3f4f6", text: "#374151" };
  return CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
}

function styleCategorySelect(select, category) {
  const color = getCategoryColor(category);
  select.classList.add("category-select");
  select.style.backgroundColor = color.bg;
  select.style.color = color.text;
}

function createGradeRow(grade, rowData) {
  const row = document.createElement("div");
  row.className = "grade-data-row";

  const categorySelect = createSelect(state.options.category, rowData.category, (value) => updateRowField(grade, rowData.id, "category", value));
  styleCategorySelect(categorySelect, rowData.category);
  row.appendChild(categorySelect);
  row.appendChild(createSelect(state.options.track, rowData.track, (value) => updateRowField(grade, rowData.id, "track", value)));
  row.appendChild(createSelect(state.options.group, rowData.group, (value) => updateRowField(grade, rowData.id, "group", value)));

  const template = getTemplateById(rowData.templateId);
  if (template && isSameSemesterDisplay(template)) {
    row.appendChild(createDropCell(grade, rowData.id, "sem1", rowData.templateId, { merged: true }));
  } else {
    row.appendChild(createDropCell(grade, rowData.id, "sem1", rowData.templateId));
    row.appendChild(createDropCell(grade, rowData.id, "sem2", rowData.templateId));
  }

  const creditInput = document.createElement("input");
  creditInput.className = "credit-input";
  creditInput.type = "text";
  creditInput.value = rowData.credits;
  creditInput.disabled = !canEdit();
  creditInput.placeholder = "0";
  creditInput.addEventListener("change", (e) => updateRowField(grade, rowData.id, "credits", e.target.value));
  row.appendChild(creditInput);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "row-delete-btn";
  deleteBtn.textContent = "×";
  deleteBtn.disabled = !canEdit();
  deleteBtn.addEventListener("click", () => deleteRow(grade, rowData.id));
  row.appendChild(deleteBtn);

  return row;
}

function createCategorySectionDivider(category) {
  const divider = document.createElement("div");
  divider.className = `category-section-divider category-${category}`;
  divider.textContent = category;
  return divider;
}

function createTrackGroupDivider(track) {
  const divider = document.createElement("div");
  divider.className = "track-group-divider";
  divider.textContent = track || "구분 없음";
  return divider;
}

function createCategorySummarySection(grade, category) {
  const wrap = document.createElement("div");
  wrap.className = `summary-wrap category-summary category-${category}`;

  const title = document.createElement("div");
  title.className = "summary-title";
  title.textContent = `${category} 총과목수 / 이수단위`;
  wrap.appendChild(title);

  const summary = getCategorySummary(grade, category);
  const row = document.createElement("div");
  row.className = "grade-summary-row";

  const label = document.createElement("div");
  label.className = "summary-cell summary-label";
  label.style.gridColumn = "1 / 4";
  label.textContent = category;

  const course = document.createElement("div");
  course.className = "summary-cell";
  course.style.gridColumn = "4 / 6";
  course.textContent = `Total #Courses ${summary.totalCourses}`;

  const credits = document.createElement("div");
  credits.className = "summary-cell";
  credits.style.gridColumn = "6 / 7";
  credits.textContent = `Total #Credits ${summary.totalCredits}`;

  const spacer = document.createElement("div");
  spacer.className = "summary-cell summary-spacer";
  spacer.style.gridColumn = "7 / 8";

  row.append(label, course, credits, spacer);
  wrap.appendChild(row);
  return wrap;
}

function renderGradeBoard() {
  gradeBoard.innerHTML = "";
  const visibleGrades = GRADE_GROUPS[activeTab];
  const categories = getVisibleCategoryOrder(visibleGrades);
  const columnMap = new Map();

  visibleGrades.forEach((grade) => {
    const column = document.createElement("section");
    column.className = "grade-column";

    const title = document.createElement("div");
    title.className = "grade-title";
    title.innerHTML = `
      <div class="grade-title-main">
        <div class="grade-title-label">${grade}</div>
        <div class="grade-subtitle">Category / Semester / Credits</div>
      </div>
      <div class="grade-title-total">총이수단위 ${getGradeTotalUnits(grade)}</div>
    `;

    column.appendChild(title);
    const headerRow = createGradeHeader();
    column.appendChild(headerRow);
    gradeBoard.appendChild(column);
    initColResize(column, headerRow);
    columnMap.set(grade, column);
  });

  categories.forEach((category) => {
    visibleGrades.forEach((grade) => {
      columnMap.get(grade).appendChild(createCategorySectionDivider(category));
    });

    if (category === "창체") {
      const rowsByGrade = {};
      let maxRows = 0;
      visibleGrades.forEach((grade) => {
        const rows = getRowsForCategoryTrack(grade, category, null);
        rowsByGrade[grade] = rows;
        maxRows = Math.max(maxRows, rows.length);
      });
      for (let i = 0; i < maxRows; i += 1) {
        visibleGrades.forEach((grade) => {
          const rowData = rowsByGrade[grade][i];
          columnMap.get(grade).appendChild(rowData ? createGradeRow(grade, rowData) : createSpacerGradeRow());
        });
      }
    } else {
      const tracks = getVisibleTrackOrder(visibleGrades, category);
      tracks.forEach((track) => {
        const rowsByGrade = {};
        let maxRows = 0;
        visibleGrades.forEach((grade) => {
          const rows = getRowsForCategoryTrack(grade, category, track);
          rowsByGrade[grade] = rows;
          maxRows = Math.max(maxRows, rows.length);
        });
        if (maxRows === 0) return;
        visibleGrades.forEach((grade) => {
          columnMap.get(grade).appendChild(createTrackGroupDivider(track));
        });
        for (let i = 0; i < maxRows; i += 1) {
          visibleGrades.forEach((grade) => {
            const rowData = rowsByGrade[grade][i];
            columnMap.get(grade).appendChild(rowData ? createGradeRow(grade, rowData) : createSpacerGradeRow());
          });
        }
      });
    }

    visibleGrades.forEach((grade) => {
      columnMap.get(grade).appendChild(createCategorySummarySection(grade, category));
    });
  });

  visibleGrades.forEach((grade) => {
    const column = columnMap.get(grade);
    const footer = document.createElement("div");
    footer.className = "grade-footer";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "add-row-btn";
    addBtn.textContent = `${grade} 행 추가`;
    addBtn.disabled = !canEdit();
    addBtn.addEventListener("click", () => addRow(grade));
    footer.appendChild(addBtn);
    column.appendChild(footer);
  });
}

function renderTabs() {
  tab7to9Btn.classList.toggle("active", activeTab === "tab7to9");
  tab10to12Btn.classList.toggle("active", activeTab === "tab10to12");
}

function render() {
  ensureStateConsistency();
  renderTemplates();
  renderOptionChips(categoryOptionList, "category");
  renderOptionChips(trackOptionList, "track");
  renderOptionChips(groupOptionList, "group");
  renderTabs();
  renderGradeBoard();
  setControlsDisabled(!canEdit());
}

async function login() {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error(error);
    alert("로그인에 실패했습니다.");
  }
}

async function logout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);
    alert("로그아웃에 실패했습니다.");
  }
}

function subscribeBoard() {
  if (unsubscribeBoard) {
    unsubscribeBoard();
    unsubscribeBoard = null;
  }

  unsubscribeBoard = onSnapshot(boardRef, async (snapshot) => {
    if (!snapshot.exists()) {
      state = createDefaultState();
      render();
      await saveNow();
      return;
    }
    state = normalizeState(snapshot.data().state || {});
    render();
  }, (error) => {
    console.error(error);
    alert("Firestore 데이터를 불러오지 못했습니다.");
  });
}

function exportXLSX() {
  const wb = XLSX.utils.book_new();
  const grades = GRADE_GROUPS[activeTab];
  const wsData = [["학년", "범주", "구분", "교과군", "1학기(한글)", "1학기(영어)", "1학기(교사)", "2학기(한글)", "2학기(영어)", "2학기(교사)", "시수"]];

  grades.forEach((grade) => {
    (state.gradeBoards[grade] || []).forEach((row) => {
      const sem1 = getSemesterTemplateData(row.templateId, "sem1");
      const sem2 = getSemesterTemplateData(row.templateId, "sem2");
      wsData.push([
        grade,
        row.category,
        row.track,
        row.group,
        sem1.nameKo || "",
        sem1.nameEn || "",
        sem1.teacher || "",
        sem2.nameKo || "",
        sem2.nameEn || "",
        sem2.teacher || "",
        row.credits
      ]);
    });
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = [10, 8, 10, 12, 18, 22, 12, 18, 22, 12, 8].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, activeTab === "tab7to9" ? "7-9학년" : "10-12학년");
  XLSX.writeFile(wb, "HIS_Curriculum.xlsx");
}

onAuthStateChanged(auth, (user) => {
  updateAuthUI(user);
  if (user) {
    subscribeBoard();
  } else {
    if (unsubscribeBoard) {
      unsubscribeBoard();
      unsubscribeBoard = null;
    }
    state = createDefaultState();
    resetTemplateForm();
    render();
  }
});

loginBtn.addEventListener("click", login);
logoutBtn.addEventListener("click", logout);
exportXlsxBtn?.addEventListener("click", exportXLSX);

tab7to9Btn.addEventListener("click", () => {
  activeTab = "tab7to9";
  render();
});

tab10to12Btn.addEventListener("click", () => {
  activeTab = "tab10to12";
  render();
});

templateSeparateSemesters.addEventListener("change", () => toggleSemesterMode({ shouldClone: templateSeparateSemesters.checked }));
templateSubmitBtn.addEventListener("click", submitTemplate);
templateCancelBtn.addEventListener("click", resetTemplateForm);

[templateNameKo, templateNameEn, templateTeacher].forEach((input) => {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitTemplate();
  });
});

addCategoryOptionBtn.addEventListener("click", () => {
  addOption("category", categoryOptionInput.value);
  categoryOptionInput.value = "";
  categoryOptionInput.focus();
});
addTrackOptionBtn.addEventListener("click", () => {
  addOption("track", trackOptionInput.value);
  trackOptionInput.value = "";
  trackOptionInput.focus();
});
addGroupOptionBtn.addEventListener("click", () => {
  addOption("group", groupOptionInput.value);
  groupOptionInput.value = "";
  groupOptionInput.focus();
});

[categoryOptionInput, trackOptionInput, groupOptionInput].forEach((input) => {
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (input === categoryOptionInput) addCategoryOptionBtn.click();
    if (input === trackOptionInput) addTrackOptionBtn.click();
    if (input === groupOptionInput) addGroupOptionBtn.click();
  });
});

resetBoardBtn.addEventListener("click", async () => {
  if (!canEdit()) return;
  const ok = confirm("공용 보드를 기본 상태로 초기화할까요?");
  if (!ok) return;
  state = createDefaultState();
  resetTemplateForm();
  render();
  await saveNow();
});

render();
