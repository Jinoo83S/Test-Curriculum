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

const templateNameKo = document.getElementById("templateNameKo");
const templateNameEn = document.getElementById("templateNameEn");
const templateTeacher = document.getElementById("templateTeacher");
const templateLanguage = document.getElementById("templateLanguage");
const templateSubmitBtn = document.getElementById("templateSubmitBtn");
const templateCancelBtn = document.getElementById("templateCancelBtn");
const templateList = document.getElementById("templateList");

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
  track: ["공통", "배정", "선택"],
  group: ["선택", "국어", "영어", "수학", "사회", "과학", "정보", "예술", "체육", "자율활동", "동아리", "채플", "기타"]
};
const DEFAULT_ROW_COUNT = 4;
const SEMESTERS = ["sem1", "sem2"];
const SEMESTER_LABELS = { sem1: "1학기", sem2: "2학기" };
const CATEGORY_PALETTE = [
  { bg: "#dbeafe", text: "#1e3a8a" },
  { bg: "#dcfce7", text: "#166534" },
  { bg: "#fef3c7", text: "#92400e" },
  { bg: "#fce7f3", text: "#9d174d" },
  { bg: "#ede9fe", text: "#5b21b6" },
  { bg: "#cffafe", text: "#155e75" }
];

function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function clean(value) {
  return String(value ?? "").trim();
}

function uniqueOrdered(values) {
  const out = [];
  values.forEach((value) => {
    if (value != null && value !== "" && !out.includes(value)) out.push(value);
  });
  return out;
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

function normalizeTemplate(item = {}) {
  const language = ["Korean", "English", "Both"].includes(item.language) ? item.language : "Both";
  const sem1NameKo = clean(item.sem1NameKo);
  const sem1NameEn = clean(item.sem1NameEn);
  const sem1Teacher = clean(item.sem1Teacher);
  const sem2NameKo = clean(item.sem2NameKo);
  const sem2NameEn = clean(item.sem2NameEn);
  const sem2Teacher = clean(item.sem2Teacher);
  const useSemesterOverrides = Boolean(
    item.useSemesterOverrides || item.separateBySemester || item.splitBySemester ||
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
  const safeCategory = options.category.includes(row.category) ? row.category : (clean(row.category) || options.category[0] || "");
  const safeTrack = options.track.includes(row.track) ? row.track : (clean(row.track) || options.track[0] || "");
  const safeGroup = options.group.includes(row.group) ? row.group : (clean(row.group) || options.group[0] || "");
  const templateId = row.templateId ?? row.sem1 ?? row.sem2 ?? null;

  return {
    id: row.id || uid("row"),
    category: safeCategory,
    track: safeTrack,
    group: safeGroup,
    credits: clean(row.credits),
    templateId
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

function normalizeState(raw = {}) {
  const safeOptions = {
    category: Array.isArray(raw.options?.category) && raw.options.category.length ? uniqueOrdered(raw.options.category.map(clean)) : [...DEFAULT_OPTIONS.category],
    track: Array.isArray(raw.options?.track) && raw.options.track.length ? uniqueOrdered(raw.options.track.map(clean)) : [...DEFAULT_OPTIONS.track],
    group: Array.isArray(raw.options?.group) && raw.options.group.length ? uniqueOrdered(raw.options.group.map(clean)) : [...DEFAULT_OPTIONS.group]
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

let state = createDefaultState();
let unsubscribeBoard = null;
let currentDrag = null;
let templateEditId = null;
let saveTimer = null;
let activeTab = "tab7to9";

function ensureStateConsistency() {
  state = normalizeState(state);
}

function canEdit() {
  return !!auth.currentUser;
}

function getTemplateById(templateId) {
  return state.templates.find((item) => item.id === templateId) || null;
}

function getTemplateCardTitle(item) {
  return clean(item.nameKo) || clean(item.sem1NameKo) || clean(item.sem2NameKo) || clean(item.nameEn) || clean(item.sem1NameEn) || clean(item.sem2NameEn) || "-";
}

function getSemesterTemplateData(templateOrId, semKey) {
  const item = typeof templateOrId === "string" ? getTemplateById(templateOrId) : templateOrId;
  if (!item) {
    return { nameKo: "", nameEn: "", teacher: "", language: "Both" };
  }

  const prefix = semKey === "sem2" ? "sem2" : "sem1";
  return {
    nameKo: clean(item[`${prefix}NameKo`]) || clean(item.nameKo) || clean(item.nameEn),
    nameEn: clean(item[`${prefix}NameEn`]) || clean(item.nameEn) || clean(item.nameKo),
    teacher: clean(item[`${prefix}Teacher`]) || clean(item.teacher),
    language: item.language || "Both"
  };
}

function getTemplateTeacherSummary(item) {
  const sem1Teacher = getSemesterTemplateData(item, "sem1").teacher;
  const sem2Teacher = getSemesterTemplateData(item, "sem2").teacher;
  const teachers = uniqueOrdered([sem1Teacher, sem2Teacher].filter(Boolean));
  return teachers.join(" · ");
}

function getCommonTeacherCandidate(item) {
  if (clean(item.teacher)) return clean(item.teacher);
  const sem1Teacher = clean(item.sem1Teacher);
  const sem2Teacher = clean(item.sem2Teacher);
  return sem1Teacher && sem1Teacher === sem2Teacher ? sem1Teacher : "";
}

function populateSemesterFieldsFromCommon(force = false) {
  const commonNameKo = clean(templateNameKo.value);
  const commonNameEn = clean(templateNameEn.value);
  const commonTeacher = clean(templateTeacher.value);
  const mappings = [
    [templateSem1NameKo, commonNameKo],
    [templateSem1NameEn, commonNameEn],
    [templateSem1Teacher, commonTeacher],
    [templateSem2NameKo, commonNameKo],
    [templateSem2NameEn, commonNameEn],
    [templateSem2Teacher, commonTeacher]
  ];
  mappings.forEach(([input, value]) => {
    if (force || !clean(input.value)) input.value = value;
  });
}

function toggleSemesterMode() {
  semesterTemplateFields.classList.toggle("hidden", !templateSeparateSemesters.checked);
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
    templateNameKo,
    templateNameEn,
    templateTeacher,
    templateLanguage,
    templateSubmitBtn,
    templateCancelBtn,
    templateSeparateSemesters,
    templateSem1NameKo,
    templateSem1NameEn,
    templateSem1Teacher,
    templateSem2NameKo,
    templateSem2NameEn,
    templateSem2Teacher,
    categoryOptionInput,
    trackOptionInput,
    groupOptionInput,
    addCategoryOptionBtn,
    addTrackOptionBtn,
    addGroupOptionBtn,
    resetBoardBtn,
    exportXlsxBtn
  ].forEach((el) => {
    if (el) el.disabled = disabled;
  });
}

function resetTemplateForm() {
  templateEditId = null;
  templateNameKo.value = "";
  templateNameEn.value = "";
  templateTeacher.value = "";
  templateLanguage.value = "Korean";
  templateSeparateSemesters.checked = false;
  templateSem1NameKo.value = "";
  templateSem1NameEn.value = "";
  templateSem1Teacher.value = "";
  templateSem2NameKo.value = "";
  templateSem2NameEn.value = "";
  templateSem2Teacher.value = "";
  templateSubmitBtn.textContent = "카드 추가";
  templateCancelBtn.classList.add("hidden");
  toggleSemesterMode();
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
  if (!confirm(`"${value}" 옵션을 삭제할까요?`)) return;
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

  const hasCommonTitle = clean(data.nameKo) || clean(data.nameEn);
  const hasSemesterTitle = clean(data.sem1NameKo) || clean(data.sem1NameEn) || clean(data.sem2NameKo) || clean(data.sem2NameEn);
  if (!hasCommonTitle && !(useSemesterOverrides && hasSemesterTitle)) {
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
  templateNameKo.value = clean(item.nameKo) || clean(getSemesterTemplateData(item, "sem1").nameKo);
  templateNameEn.value = clean(item.nameEn) || clean(getSemesterTemplateData(item, "sem1").nameEn);
  templateTeacher.value = getCommonTeacherCandidate(item);
  templateLanguage.value = item.language;
  templateSeparateSemesters.checked = item.useSemesterOverrides;
  templateSem1NameKo.value = getSemesterTemplateData(item, "sem1").nameKo;
  templateSem1NameEn.value = getSemesterTemplateData(item, "sem1").nameEn;
  templateSem1Teacher.value = getSemesterTemplateData(item, "sem1").teacher;
  templateSem2NameKo.value = getSemesterTemplateData(item, "sem2").nameKo;
  templateSem2NameEn.value = getSemesterTemplateData(item, "sem2").nameEn;
  templateSem2Teacher.value = getSemesterTemplateData(item, "sem2").teacher;
  templateSubmitBtn.textContent = "카드 수정 저장";
  templateCancelBtn.classList.remove("hidden");
  toggleSemesterMode();
}

function deleteTemplate(templateId) {
  if (!canEdit()) return;
  const item = getTemplateById(templateId);
  if (!item) return;
  if (!confirm(`"${getTemplateCardTitle(item)}" 카드를 삭제할까요?`)) return;

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

function createMetaChip(text) {
  const chip = document.createElement("span");
  chip.className = "meta-chip";
  chip.textContent = text;
  return chip;
}

function languageClass(language) {
  return `lang-${String(language || "both").toLowerCase()}`;
}

function createSemesterPreviewItem(item, semKey) {
  const data = getSemesterTemplateData(item, semKey);
  const wrap = document.createElement("div");
  wrap.className = "semester-preview-item";

  const label = document.createElement("div");
  label.className = "semester-preview-label";
  label.textContent = SEMESTER_LABELS[semKey];

  const name = document.createElement("div");
  name.className = "semester-preview-name";
  name.textContent = data.nameKo || data.nameEn || "-";

  wrap.append(label, name);

  if (data.nameEn && data.nameEn !== data.nameKo) {
    const en = document.createElement("div");
    en.className = "semester-preview-en";
    en.textContent = data.nameEn;
    wrap.appendChild(en);
  }

  if (data.teacher) {
    const teacher = document.createElement("div");
    teacher.className = "semester-preview-teacher";
    teacher.textContent = data.teacher;
    wrap.appendChild(teacher);
  }

  return wrap;
}

function createTemplateCard(item) {
  const card = document.createElement("div");
  card.className = `template-card compact-card ${languageClass(item.language)}`;
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
  actions.className = "template-actions compact-actions";

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

  const teacherSummary = getTemplateTeacherSummary(item);
  const teacherInfo = document.createElement("span");
  teacherInfo.className = "template-teacher-inline";
  teacherInfo.textContent = teacherSummary || "-";

  [editBtn, deleteBtn].forEach((btn) => btn.addEventListener("mousedown", (e) => e.stopPropagation()));
  actions.append(editBtn, deleteBtn, teacherInfo);

  const preview = document.createElement("div");
  preview.className = "template-semester-preview";
  preview.append(
    createSemesterPreviewItem(item, "sem1"),
    createSemesterPreviewItem(item, "sem2")
  );

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
  return state.gradeBoards[grade].find((row) => row.id === rowId) || null;
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

function clearRowTemplate(grade, rowId) {
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
  const lastRow = rows[rows.length - 1] || {};
  state.gradeBoards[grade].push(createRow(state.options, {
    category: lastRow.category,
    track: lastRow.track,
    group: lastRow.group
  }));
  render();
  scheduleSave();
}

function deleteRow(grade, rowId) {
  if (!canEdit()) return;
  if (!confirm("이 행을 삭제할까요?")) return;
  state.gradeBoards[grade] = state.gradeBoards[grade].filter((row) => row.id !== rowId);
  if (!state.gradeBoards[grade].length) {
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
  if (sourceGrade === targetGrade && sourceRowId === targetRowId) return;

  const movingTemplateId = sourceRow.templateId;
  const replacedTemplateId = targetRow.templateId || null;
  sourceRow.templateId = replacedTemplateId;
  targetRow.templateId = movingTemplateId;
  render();
  scheduleSave();
}

function placeTemplateToRow(templateId, targetGrade, targetRowId) {
  if (!canEdit()) return;
  const targetRow = getRowById(targetGrade, targetRowId);
  if (!targetRow) return;

  const existingTemplateId = targetRow.templateId;
  if (existingTemplateId && existingTemplateId !== templateId) {
    const existingTemplate = getTemplateById(existingTemplateId);
    const movingTemplate = getTemplateById(templateId);
    const ok = confirm(
      `이미 "${getTemplateCardTitle(existingTemplate)}" 카드가 있습니다.\n` +
      `"${getTemplateCardTitle(movingTemplate)}" 카드로 바꿀까요?\n(1·2학기 모두 함께 변경됩니다)`
    );
    if (!ok) return;
  }

  targetRow.templateId = templateId;
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

function createPlacedCard(templateId, grade, rowId, semKey) {
  const item = getTemplateById(templateId);
  if (!item) return document.createTextNode("");
  const semesterData = getSemesterTemplateData(item, semKey);

  const card = document.createElement("div");
  card.className = `placed-card ${languageClass(semesterData.language)}`;
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

  const ko = document.createElement("div");
  ko.className = "placed-title-ko";
  ko.textContent = semesterData.nameKo || semesterData.nameEn || "-";

  const en = document.createElement("div");
  en.className = "placed-title-en";
  en.textContent = semesterData.nameEn || "-";

  titleWrap.append(ko, en);
  top.appendChild(titleWrap);

  if (canEdit()) {
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "clear-cell-btn";
    clearBtn.textContent = "×";
    clearBtn.title = "1·2학기 모두 제거";
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearRowTemplate(grade, rowId);
    });
    clearBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    top.appendChild(clearBtn);
  }

  const meta = document.createElement("div");
  meta.className = "placed-meta placed-meta-hidden";
  if (semesterData.teacher) meta.appendChild(createMetaChip(semesterData.teacher));

  card.append(top, meta);
  card.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    if (!semesterData.teacher) return;
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

function createDropCell(grade, rowId, semKey, templateId) {
  const cell = document.createElement("div");
  cell.className = templateId ? "drop-cell" : "drop-cell empty";

  if (templateId) cell.appendChild(createPlacedCard(templateId, grade, rowId, semKey));

  cell.addEventListener("dragover", (e) => {
    if (!canEdit()) return;
    e.preventDefault();
    cell.classList.add("dragover");
  });

  cell.addEventListener("dragleave", () => {
    cell.classList.remove("dragover");
  });

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

function createGradeRow(grade, rowData) {
  const row = document.createElement("div");
  row.className = "grade-data-row";

  const categorySelect = createSelect(state.options.category, rowData.category, (value) => updateRowField(grade, rowData.id, "category", value));
  styleCategorySelect(categorySelect, rowData.category);
  row.appendChild(categorySelect);
  row.appendChild(createSelect(state.options.track, rowData.track, (value) => updateRowField(grade, rowData.id, "track", value)));
  row.appendChild(createSelect(state.options.group, rowData.group, (value) => updateRowField(grade, rowData.id, "group", value)));
  row.appendChild(createDropCell(grade, rowData.id, "sem1", rowData.templateId));
  row.appendChild(createDropCell(grade, rowData.id, "sem2", rowData.templateId));

  const creditInput = document.createElement("input");
  creditInput.className = "credit-input";
  creditInput.type = "text";
  creditInput.value = rowData.credits;
  creditInput.placeholder = "0";
  creditInput.disabled = !canEdit();
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

function createTrackGroupDivider(track) {
  const divider = document.createElement("div");
  divider.className = "track-group-divider";
  divider.textContent = track || "구분 없음";
  return divider;
}

const colResizeState = new WeakMap();

function applyColWidths(column, widths) {
  const tpl = widths.join(" ");
  column.querySelectorAll(".grade-header-row, .grade-data-row").forEach((row) => {
    row.style.gridTemplateColumns = tpl;
  });
}

function initColResize(column, headerRow) {
  const defaultWidths = ["52px", "52px", "58px", "1fr", "1fr", "40px", "24px"];
  const widths = [...defaultWidths];
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
        const delta = ev.clientX - startX;
        const newW = Math.max(36, startW + delta);
        widths[i] = `${newW}px`;
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

function createGradeHeader(column) {
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

function getOrderedCategoriesForGrades(grades) {
  const categories = [...state.options.category];
  grades.forEach((grade) => {
    (state.gradeBoards[grade] || []).forEach((row) => {
      if (row.category && !categories.includes(row.category)) categories.push(row.category);
    });
  });
  return categories;
}

function getOrderedTracksForCategory(grades, category) {
  const tracks = [...state.options.track];
  grades.forEach((grade) => {
    (state.gradeBoards[grade] || [])
      .filter((row) => row.category === category)
      .forEach((row) => {
        if (row.track && !tracks.includes(row.track)) tracks.push(row.track);
      });
  });
  return tracks;
}

function getGradeSummaryRows(grade) {
  const rows = state.gradeBoards[grade] || [];
  return state.options.category.map((category) => {
    const matchedRows = rows.filter((row) => row.category === category && row.templateId);
    const totalCourses = matchedRows.length;
    const totalCredits = matchedRows.reduce((sum, row) => {
      const value = Number(String(row.credits).replace(/[^0-9.-]/g, ""));
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    return { category, totalCourses, totalCredits };
  });
}

function createSummarySection(grade) {
  const wrap = document.createElement("div");
  wrap.className = "summary-wrap";

  const title = document.createElement("div");
  title.className = "summary-title";
  title.textContent = "총과목수 / 이수단위";
  wrap.appendChild(title);

  getGradeSummaryRows(grade).forEach((summary) => {
    const row = document.createElement("div");
    row.className = "grade-summary-row";

    const label = document.createElement("div");
    label.className = "summary-cell summary-label";
    label.textContent = summary.category;

    const courses = document.createElement("div");
    courses.className = "summary-cell";
    courses.textContent = `Total #Courses ${summary.totalCourses}`;

    const credits = document.createElement("div");
    credits.className = "summary-cell";
    credits.textContent = `Total #Credits ${summary.totalCredits}`;

    row.append(label, courses, credits);
    wrap.appendChild(row);
  });

  return wrap;
}

function renderGradeBoard() {
  gradeBoard.innerHTML = "";
  const visibleGrades = GRADE_GROUPS[activeTab];
  const columnsByGrade = {};

  visibleGrades.forEach((grade) => {
    const column = document.createElement("section");
    column.className = "grade-column";

    const title = document.createElement("div");
    title.className = "grade-title";
    title.innerHTML = `${grade}<div class="grade-subtitle">Category / Semester / Credits</div>`;
    column.appendChild(title);

    const headerRow = createGradeHeader(column);
    column.appendChild(headerRow);
    columnsByGrade[grade] = { column, headerRow };
    gradeBoard.appendChild(column);
  });

  const categories = getOrderedCategoriesForGrades(visibleGrades);
  categories.forEach((category) => {
    const hasAnyRowsInCategory = visibleGrades.some((grade) => (state.gradeBoards[grade] || []).some((row) => row.category === category));
    if (!hasAnyRowsInCategory) return;

    const tracks = getOrderedTracksForCategory(visibleGrades, category);
    tracks.forEach((track) => {
      const rowsByGrade = {};
      let maxRows = 0;
      visibleGrades.forEach((grade) => {
        const rows = (state.gradeBoards[grade] || []).filter((row) => row.category === category && row.track === track);
        rowsByGrade[grade] = rows;
        maxRows = Math.max(maxRows, rows.length);
      });
      if (!maxRows) return;

      visibleGrades.forEach((grade) => {
        columnsByGrade[grade].column.appendChild(createTrackGroupDivider(track));
      });

      for (let i = 0; i < maxRows; i += 1) {
        visibleGrades.forEach((grade) => {
          const rowData = rowsByGrade[grade][i];
          columnsByGrade[grade].column.appendChild(rowData ? createGradeRow(grade, rowData) : createSpacerGradeRow());
        });
      }
    });
  });

  visibleGrades.forEach((grade) => {
    const column = columnsByGrade[grade].column;

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
    column.appendChild(createSummarySection(grade));

    initColResize(column, columnsByGrade[grade].headerRow);
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
  toggleSemesterMode();
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

function exportXLSX() {
  const wb = XLSX.utils.book_new();
  const grades = GRADE_GROUPS[activeTab];
  const rows = [[
    "학년", "범주", "구분", "교과군",
    "1학기(한글)", "1학기(영어)", "1학기(교사)",
    "2학기(한글)", "2학기(영어)", "2학기(교사)",
    "시수"
  ]];

  grades.forEach((grade) => {
    (state.gradeBoards[grade] || []).forEach((row) => {
      const tpl = getTemplateById(row.templateId);
      const sem1 = tpl ? getSemesterTemplateData(tpl, "sem1") : { nameKo: "", nameEn: "", teacher: "" };
      const sem2 = tpl ? getSemesterTemplateData(tpl, "sem2") : { nameKo: "", nameEn: "", teacher: "" };
      rows.push([
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
        row.credits || ""
      ]);
    });
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [10, 8, 10, 12, 18, 22, 14, 18, 22, 14, 6].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, activeTab === "tab7to9" ? "7-9학년" : "10-12학년");
  XLSX.writeFile(wb, "HIS_Curriculum.xlsx");
}

loginBtn.addEventListener("click", login);
logoutBtn.addEventListener("click", logout);
exportXlsxBtn.addEventListener("click", exportXLSX);

tab7to9Btn.addEventListener("click", () => {
  activeTab = "tab7to9";
  render();
});

tab10to12Btn.addEventListener("click", () => {
  activeTab = "tab10to12";
  render();
});

templateSubmitBtn.addEventListener("click", submitTemplate);
templateCancelBtn.addEventListener("click", resetTemplateForm);

templateSeparateSemesters.addEventListener("change", () => {
  if (templateSeparateSemesters.checked) {
    const hasAnySemesterData = [
      templateSem1NameKo,
      templateSem1NameEn,
      templateSem1Teacher,
      templateSem2NameKo,
      templateSem2NameEn,
      templateSem2Teacher
    ].some((input) => clean(input.value));
    if (!hasAnySemesterData) populateSemesterFieldsFromCommon(true);
  }
  toggleSemesterMode();
});

[templateNameKo, templateNameEn, templateTeacher].forEach((input) => {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitTemplate();
  });
});

[templateSem1NameKo, templateSem1NameEn, templateSem1Teacher, templateSem2NameKo, templateSem2NameEn, templateSem2Teacher].forEach((input) => {
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
  if (!confirm("공용 보드를 기본 상태로 초기화할까요?")) return;
  state = createDefaultState();
  resetTemplateForm();
  render();
  await saveNow();
});

render();