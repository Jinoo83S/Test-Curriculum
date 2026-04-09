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

const templateNameKo = document.getElementById("templateNameKo");
const templateNameEn = document.getElementById("templateNameEn");
const templateTeacher = document.getElementById("templateTeacher");
const templateLanguage = document.getElementById("templateLanguage");
const templateSubmitBtn = document.getElementById("templateSubmitBtn");
const templateCancelBtn = document.getElementById("templateCancelBtn");
const templateList = document.getElementById("templateList");

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
  group: ["국어", "영어", "수학", "사회", "과학", "정보", "예술", "체육", "성경", "창체", "기타"]
};

function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createDefaultTemplates() {
  return [
    { id: uid("tpl"), nameKo: "영어", nameEn: "English", teacher: "", language: "English" },
    { id: uid("tpl"), nameKo: "국어", nameEn: "Korean Language Arts", teacher: "", language: "Korean" },
    { id: uid("tpl"), nameKo: "수학", nameEn: "Mathematics", teacher: "", language: "Both" },
    { id: uid("tpl"), nameKo: "과학", nameEn: "Science", teacher: "", language: "Both" }
  ];
}

function createRow(options = DEFAULT_OPTIONS) {
  return {
    id: uid("row"),
    category: options.category[0] || "",
    track: options.track[0] || "",
    group: options.group[0] || "",
    credits: "",
    sem1: null,
    sem2: null
  };
}

function createDefaultState() {
  const gradeBoards = {};
  GRADE_KEYS.forEach((grade) => {
    gradeBoards[grade] = [createRow(), createRow(), createRow(), createRow()];
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

let state = createDefaultState();
let unsubscribeBoard = null;
let currentDrag = null;
let templateEditId = null;
let saveTimer = null;
let activeTab = "tab7to9";

function normalizeTemplate(item = {}) {
  return {
    id: item.id || uid("tpl"),
    nameKo: (item.nameKo || "").trim(),
    nameEn: (item.nameEn || "").trim(),
    teacher: (item.teacher || "").trim(),
    language: ["Korean", "English", "Both"].includes(item.language) ? item.language : "Both"
  };
}

function normalizeRow(row = {}, options = DEFAULT_OPTIONS) {
  const safeCategory = options.category.includes(row.category) ? row.category : (options.category[0] || "");
  const safeTrack = options.track.includes(row.track) ? row.track : (options.track[0] || "");
  const safeGroup = options.group.includes(row.group) ? row.group : (options.group[0] || "");

  return {
    id: row.id || uid("row"),
    category: safeCategory,
    track: safeTrack,
    group: safeGroup,
    credits: row.credits ?? "",
    sem1: row.sem1 ?? null,
    sem2: row.sem2 ?? null
  };
}

function normalizeState(raw = {}) {
  const safeOptions = {
    category: Array.isArray(raw.options?.category) && raw.options.category.length
      ? [...raw.options.category]
      : [...DEFAULT_OPTIONS.category],
    track: Array.isArray(raw.options?.track) && raw.options.track.length
      ? [...raw.options.track]
      : [...DEFAULT_OPTIONS.track],
    group: Array.isArray(raw.options?.group) && raw.options.group.length
      ? [...raw.options.group]
      : [...DEFAULT_OPTIONS.group]
  };

  const safeTemplates = Array.isArray(raw.templates) && raw.templates.length
    ? raw.templates.map(normalizeTemplate)
    : createDefaultTemplates();

  const safeBoards = {};
  GRADE_KEYS.forEach((grade) => {
    const rows = Array.isArray(raw.gradeBoards?.[grade]) ? raw.gradeBoards[grade] : [];
    safeBoards[grade] = rows.length
      ? rows.map((row) => normalizeRow(row, safeOptions))
      : [createRow(safeOptions), createRow(safeOptions), createRow(safeOptions)];
  });

  return {
    options: safeOptions,
    templates: safeTemplates,
    gradeBoards: safeBoards
  };
}

function languageClass(language) {
  return `lang-${String(language || "both").toLowerCase()}`;
}

function canEdit() {
  return !!auth.currentUser;
}

function getTemplateById(templateId) {
  return state.templates.find((item) => item.id === templateId) || null;
}

function ensureStateConsistency() {
  state = normalizeState(state);
}

function scheduleSave() {
  if (!canEdit()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

async function saveNow() {
  if (!canEdit()) return;
  ensureStateConsistency();
  await setDoc(boardRef, {
    state,
    updatedAt: serverTimestamp()
  });
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
    categoryOptionInput,
    trackOptionInput,
    groupOptionInput,
    addCategoryOptionBtn,
    addTrackOptionBtn,
    addGroupOptionBtn,
    resetBoardBtn
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
  templateSubmitBtn.textContent = "카드 추가";
  templateCancelBtn.classList.add("hidden");
}

function addOption(type, value) {
  if (!canEdit()) return;
  const trimmed = value.trim();
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

function renderOptionChips(container, type) {
  container.innerHTML = "";
  state.options[type].forEach((value) => {
    const chip = document.createElement("div");
    chip.className = "option-chip";

    const text = document.createElement("span");
    text.textContent = value;
    chip.appendChild(text);

    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "×";
    del.disabled = !canEdit();
    del.addEventListener("click", () => removeOption(type, value));
    chip.appendChild(del);

    container.appendChild(chip);
  });
}

function submitTemplate() {
  if (!canEdit()) return;

  const data = normalizeTemplate({
    id: templateEditId || uid("tpl"),
    nameKo: templateNameKo.value,
    nameEn: templateNameEn.value,
    teacher: templateTeacher.value,
    language: templateLanguage.value
  });

  if (!data.nameKo && !data.nameEn) {
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
  templateLanguage.value = item.language;
  templateSubmitBtn.textContent = "카드 수정 저장";
  templateCancelBtn.classList.remove("hidden");
}

function deleteTemplate(templateId) {
  if (!canEdit()) return;
  const item = getTemplateById(templateId);
  if (!item) return;

  const ok = confirm(`"${item.nameKo || item.nameEn}" 카드를 삭제할까요?`);
  if (!ok) return;

  state.templates = state.templates.filter((tpl) => tpl.id !== templateId);

  GRADE_KEYS.forEach((grade) => {
    state.gradeBoards[grade].forEach((row) => {
      if (row.sem1 === templateId) row.sem1 = null;
      if (row.sem2 === templateId) row.sem2 = null;
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

  const ko = document.createElement("div");
  ko.className = "template-name-ko";
  ko.textContent = item.nameKo || item.nameEn || "-";
  main.appendChild(ko);

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

  [editBtn, deleteBtn].forEach((btn) =>
    btn.addEventListener("mousedown", (e) => e.stopPropagation())
  );

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  card.appendChild(main);
  card.appendChild(actions);

  card.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;

    const wasExpanded = card.classList.contains("expanded");

    document.querySelectorAll(".template-card.expanded").forEach((el) => {
      el.classList.remove("expanded");
    });

    if (!wasExpanded) {
      card.classList.add("expanded");
    }
  });

  return card;
}

function renderTemplates() {
  templateList.innerHTML = "";

  const sortedTemplates = [...state.templates].sort((a, b) => {
    const aKey = (a.nameKo || a.nameEn || "").trim();
    const bKey = (b.nameKo || b.nameEn || "").trim();
    return aKey.localeCompare(bKey, "ko");
  });

  sortedTemplates.forEach((item) => {
    templateList.appendChild(createTemplateCard(item));
  });
}

function updateRowField(grade, rowId, field, value) {
  if (!canEdit()) return;
  const row = state.gradeBoards[grade].find((item) => item.id === rowId);
  if (!row) return;
  row[field] = value;
  ensureStateConsistency();
  render();
  scheduleSave();
}

function clearCell(grade, rowId, semKey) {
  if (!canEdit()) return;
  const row = state.gradeBoards[grade].find((item) => item.id === rowId);
  if (!row) return;
  row[semKey] = null;
  render();
  scheduleSave();
}

function addRow(grade) {
  if (!canEdit()) return;
  state.gradeBoards[grade].push(createRow(state.options));
  render();
  scheduleSave();
}

function deleteRow(grade, rowId) {
  if (!canEdit()) return;
  const ok = confirm("이 행을 삭제할까요?");
  if (!ok) return;
  state.gradeBoards[grade] = state.gradeBoards[grade].filter((row) => row.id !== rowId);
  if (state.gradeBoards[grade].length === 0) {
    state.gradeBoards[grade].push(createRow(state.options));
  }
  render();
  scheduleSave();
}

function movePlacedCard(sourceGrade, sourceRowId, sourceSemKey, targetGrade, targetRowId, targetSemKey) {
  if (!canEdit()) return;
  const sourceRow = state.gradeBoards[sourceGrade].find((row) => row.id === sourceRowId);
  const targetRow = state.gradeBoards[targetGrade].find((row) => row.id === targetRowId);
  if (!sourceRow || !targetRow) return;
  const movingTemplateId = sourceRow[sourceSemKey];
  sourceRow[sourceSemKey] = null;
  targetRow[targetSemKey] = movingTemplateId;
  render();
  scheduleSave();
}

function placeTemplateToCell(templateId, targetGrade, targetRowId, targetSemKey) {
  if (!canEdit()) return;
  const targetRow = state.gradeBoards[targetGrade].find((row) => row.id === targetRowId);
  if (!targetRow) return;
  targetRow[targetSemKey] = templateId;
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

function createPlacedCard(templateId, grade, rowId, semKey) {
  const item = getTemplateById(templateId);
  if (!item) return document.createTextNode("");

  const card = document.createElement("div");
  card.className = `placed-card ${languageClass(item.language)}`;
  card.draggable = canEdit();

  card.addEventListener("dragstart", () => {
    currentDrag = {
      kind: "placed",
      sourceGrade: grade,
      sourceRowId: rowId,
      sourceSemKey: semKey,
      templateId
    };
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
  ko.textContent = item.nameKo || "-";

  const en = document.createElement("div");
  en.className = "placed-title-en";
  en.textContent = item.nameEn || "-";

  titleWrap.appendChild(ko);
  titleWrap.appendChild(en);
  top.appendChild(titleWrap);

  if (canEdit()) {
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "clear-cell-btn";
    clearBtn.textContent = "×";
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearCell(grade, rowId, semKey);
    });
    clearBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    top.appendChild(clearBtn);
  }

  const meta = document.createElement("div");
  meta.className = "placed-meta";
  meta.appendChild(createMetaChip(item.language));
  if (item.teacher) meta.appendChild(createMetaChip(item.teacher));

  card.appendChild(top);
  card.appendChild(meta);
  return card;
}

function createDropCell(grade, rowId, semKey, templateId) {
  const cell = document.createElement("div");
  cell.className = templateId ? "drop-cell" : "drop-cell empty";

  if (templateId) {
    cell.appendChild(createPlacedCard(templateId, grade, rowId, semKey));
  }

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
      placeTemplateToCell(currentDrag.templateId, grade, rowId, semKey);
      return;
    }

    if (currentDrag.kind === "placed") {
      movePlacedCard(
        currentDrag.sourceGrade,
        currentDrag.sourceRowId,
        currentDrag.sourceSemKey,
        grade,
        rowId,
        semKey
      );
    }
  });

  return cell;
}

// Column resize state per grade column
const colResizeState = new WeakMap();

function applyColWidths(column, widths) {
  const tpl = widths.join(" ");
  column.querySelectorAll(".grade-header-row, .grade-data-row, .grade-summary-row").forEach((row) => {
    row.style.gridTemplateColumns = tpl;
  });
}

function initColResize(column, headerRow) {
  const DEFAULT_WIDTHS = ["52px", "52px", "58px", "1fr", "1fr", "40px", "24px"];
  const widths = [...DEFAULT_WIDTHS];
  colResizeState.set(column, widths);

  headerRow.querySelectorAll(".col-resize-handle").forEach((handle, i) => {
    let startX, startW;

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const headerCell = handle.parentElement;
      startX = e.clientX;
      startW = headerCell.getBoundingClientRect().width;
      handle.classList.add("resizing");

      function onMove(e) {
        const delta = e.clientX - startX;
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

    // Add resize handle to all except last column
    if (i < 6) {
      const handle = document.createElement("div");
      handle.className = "col-resize-handle";
      cell.appendChild(handle);
    }

    row.appendChild(cell);
  });
  return row;
}

function createGradeRow(grade, rowData) {
  const row = document.createElement("div");
  row.className = "grade-data-row";

  row.appendChild(createSelect(state.options.category, rowData.category, (value) => updateRowField(grade, rowData.id, "category", value)));
  row.appendChild(createSelect(state.options.track, rowData.track, (value) => updateRowField(grade, rowData.id, "track", value)));
  row.appendChild(createSelect(state.options.group, rowData.group, (value) => updateRowField(grade, rowData.id, "group", value)));
  row.appendChild(createDropCell(grade, rowData.id, "sem1", rowData.sem1));
  row.appendChild(createDropCell(grade, rowData.id, "sem2", rowData.sem2));

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

/* 그룹 헤더 함수 */
function createTrackGroupDivider(track) {
  const divider = document.createElement("div");
  divider.className = "track-group-divider";
  divider.textContent = track || "구분 없음";
  return divider;
}


function getGradeSummaryRows(grade) {
  const rows = state.gradeBoards[grade] || [];
  return state.options.category.map((category) => {
    const matchedRows = rows.filter((row) => row.category === category && (row.sem1 || row.sem2));
    const totalCourses = matchedRows.length;
    const totalCredits = matchedRows.reduce((sum, row) => {
      const value = Number(String(row.credits).replace(/[^0-9.-]/g, ""));
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);

    return {
      category,
      totalCourses,
      totalCredits
    };
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
    label.className = "summary-cell summary-label summary-category";
    label.textContent = summary.category;
    row.appendChild(label);

    const courseCell = document.createElement("div");
    courseCell.className = "summary-cell";
    courseCell.textContent = `Total #Courses ${summary.totalCourses}`;
    row.appendChild(courseCell);

    const creditCell = document.createElement("div");
    creditCell.className = "summary-cell";
    creditCell.textContent = `Total #Credits ${summary.totalCredits}`;
    row.appendChild(creditCell);

    const spacer1 = document.createElement("div");
    spacer1.className = "summary-spacer";
    row.appendChild(spacer1);

    const spacer2 = document.createElement("div");
    spacer2.className = "summary-spacer";
    row.appendChild(spacer2);

    wrap.appendChild(row);
  });

  return wrap;
}

function renderGradeBoard() {
  gradeBoard.innerHTML = "";
  const visibleGrades = GRADE_GROUPS[activeTab];

  visibleGrades.forEach((grade) => {
    const column = document.createElement("section");
    column.className = "grade-column";

    const title = document.createElement("div");
    title.className = "grade-title";
    title.innerHTML = `${grade}<div class="grade-subtitle">Category / Semester / Credits</div>`;

    column.appendChild(title);
    const headerRow = createGradeHeader(column);
    column.appendChild(headerRow);

  /* 이렇게 하면 두번째 범주 값이 바뀔 때만 구분선/그룹 제목이 생깁니다. */
  let previousTrack = null;

  state.gradeBoards[grade].forEach((rowData, index) => {
    const currentTrack = rowData.track || "";

    if (index === 0 || currentTrack !== previousTrack) {
      column.appendChild(createTrackGroupDivider(currentTrack));
    }

    column.appendChild(createGradeRow(grade, rowData));
    previousTrack = currentTrack;
  });

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

    gradeBoard.appendChild(column);
    initColResize(column, headerRow);
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
    if (e.key === "Enter") {
      if (input === categoryOptionInput) addCategoryOptionBtn.click();
      if (input === trackOptionInput) addTrackOptionBtn.click();
      if (input === groupOptionInput) addGroupOptionBtn.click();
    }
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

function exportCSV() {
  const grades = GRADE_GROUPS[activeTab];
  const rows = [["학년", "범주", "구분", "교과군", "1학기(한글)", "1학기(영어)", "2학기(한글)", "2학기(영어)", "시수"]];

  grades.forEach((grade) => {
    state.gradeBoards[grade].forEach((row) => {
      const sem1 = getTemplateById(row.sem1);
      const sem2 = getTemplateById(row.sem2);
      rows.push([
        grade,
        row.category,
        row.track,
        row.group,
        sem1?.nameKo || "",
        sem1?.nameEn || "",
        sem2?.nameKo || "",
        sem2?.nameEn || "",
        row.credits
      ]);
    });
  });

  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }); // BOM for Korean
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `HIS_Curriculum_${activeTab}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("exportCsvBtn").addEventListener("click", exportCSV);

function exportXLSX() {
  const wb = XLSX.utils.book_new();
  const grades = GRADE_GROUPS[activeTab];

  const wsData = [["학년", "범주", "구분", "교과군", "1학기(한글)", "1학기(영어)", "2학기(한글)", "2학기(영어)", "시수"]];

  grades.forEach((grade) => {
    state.gradeBoards[grade].forEach((row) => {
      const sem1 = getTemplateById(row.sem1);
      const sem2 = getTemplateById(row.sem2);
      wsData.push([
        grade, row.category, row.track, row.group,
        sem1?.nameKo || "", sem1?.nameEn || "",
        sem2?.nameKo || "", sem2?.nameEn || "",
        row.credits
      ]);
    });
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = [10, 8, 8, 12, 18, 22, 18, 22, 6].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, activeTab === "tab7to9" ? "7-9학년" : "10-12학년");
  XLSX.writeFile(wb, `HIS_Curriculum.xlsx`);
}

document.getElementById("exportXlsxBtn").addEventListener("click", exportXLSX);