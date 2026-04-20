// ================================================================
// SECTION 1 · Firebase Imports & Initialization
// ================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBwUERcfAYMiqewOsp9zsY6_CnHef-nfK0",
  authDomain: "his-curriculum-8e737.firebaseapp.com",
  projectId: "his-curriculum-8e737",
  storageBucket: "his-curriculum-8e737.firebasestorage.app",
  messagingSenderId: "1091130688532",
  appId: "1:1091130688532:web:79622f9da3591ab2d3d301",
};

const fbApp  = initializeApp(firebaseConfig);
const auth   = getAuth(fbApp);
const db     = getFirestore(fbApp);
const provider  = new GoogleAuthProvider();
const boardRef  = doc(db, "boards", "main");

// ================================================================
// SECTION 2 · DOM References
// ================================================================
const authStatus       = document.getElementById("authStatus");
const loginBtn         = document.getElementById("loginBtn");
const logoutBtn        = document.getElementById("logoutBtn");
const resetBoardBtn    = document.getElementById("resetBoardBtn");
const loginOverlay     = document.getElementById("loginOverlay");
const exportXlsxBtn    = document.getElementById("exportXlsxBtn");

const templateNameKo   = document.getElementById("templateNameKo");
const templateNameEn   = document.getElementById("templateNameEn");
const templateTeacher  = document.getElementById("templateTeacher");
const templateLanguage = document.getElementById("templateLanguage");
const templateSubmitBtn = document.getElementById("templateSubmitBtn");
const templateCancelBtn = document.getElementById("templateCancelBtn");
const templateList     = document.getElementById("templateList");

const templateSeparateSemesters = document.getElementById("templateSeparateSemesters");
const semesterTemplateFields    = document.getElementById("semesterTemplateFields");
const templateSem1NameKo  = document.getElementById("templateSem1NameKo");
const templateSem1NameEn  = document.getElementById("templateSem1NameEn");
const templateSem1Teacher = document.getElementById("templateSem1Teacher");
const templateSem2NameKo  = document.getElementById("templateSem2NameKo");
const templateSem2NameEn  = document.getElementById("templateSem2NameEn");
const templateSem2Teacher = document.getElementById("templateSem2Teacher");

const categoryOptionList   = document.getElementById("categoryOptionList");
const trackOptionList      = document.getElementById("trackOptionList");
const groupOptionList      = document.getElementById("groupOptionList");
const categoryOptionInput  = document.getElementById("categoryOptionInput");
const trackOptionInput     = document.getElementById("trackOptionInput");
const groupOptionInput     = document.getElementById("groupOptionInput");
const addCategoryOptionBtn = document.getElementById("addCategoryOptionBtn");
const addTrackOptionBtn    = document.getElementById("addTrackOptionBtn");
const addGroupOptionBtn    = document.getElementById("addGroupOptionBtn");

const tab7to9Btn   = document.getElementById("tab7to9Btn");
const tab10to12Btn = document.getElementById("tab10to12Btn");
const gradeBoard   = document.getElementById("gradeBoard");
const boardView = document.getElementById("boardView");
const templateManagerView = document.getElementById("templateManagerView");
const openTemplateManagerBtn = document.getElementById("openTemplateManagerBtn");
const templateManagerBackBtn = document.getElementById("templateManagerBackBtn");
const templateManagerSearchInput = document.getElementById("templateManagerSearchInput");
const templateManagerLanguageFilter = document.getElementById("templateManagerLanguageFilter");
const templateManagerSplitFilter = document.getElementById("templateManagerSplitFilter");
const templateManagerSortSelect = document.getElementById("templateManagerSortSelect");
const templateManagerCount = document.getElementById("templateManagerCount");
const templateManagerTableWrap = document.getElementById("templateManagerTableWrap");
const templateManagerAddRowBtn = document.getElementById("templateManagerAddRowBtn");
const templateManagerSaveBtn = document.getElementById("templateManagerSaveBtn");
const templateManagerDiscardBtn = document.getElementById("templateManagerDiscardBtn");
const templateGroupTableWrap = document.getElementById("templateGroupTableWrap");
const addTemplateGroupBtn = document.getElementById("addTemplateGroupBtn");
const templateManagerSaveStatus = document.getElementById("templateManagerSaveStatus");

// ================================================================
// SECTION 3 · Constants
// ================================================================
const GRADE_KEYS = ["7학년", "8학년", "9학년", "10학년", "11학년", "12학년"];
const GRADE_GROUPS = {
  tab7to9:   ["7학년", "8학년", "9학년"],
  tab10to12: ["10학년", "11학년", "12학년"]
};
const DEFAULT_OPTIONS = {
  category: ["교과", "창체"],
  track:    ["공통", "배정", "선택"],
  group:    ["선택", "국어", "영어", "수학", "사회", "과학", "정보", "예술", "체육", "자율활동", "동아리", "채플", "기타"]
};
const DEFAULT_ROW_COUNT = 4;
const SEMESTER_LABELS  = { sem1: "1학기", sem2: "2학기" };
const CATEGORY_PALETTE = [
  { bg: "#dbeafe", text: "#1e3a8a" },
  { bg: "#dcfce7", text: "#166534" },
  { bg: "#fef3c7", text: "#92400e" },
  { bg: "#fce7f3", text: "#9d174d" },
  { bg: "#ede9fe", text: "#5b21b6" },
  { bg: "#cffafe", text: "#155e75" }
];
const DEFAULT_COL_WIDTHS = ["52px", "52px", "58px", "1fr", "1fr", "40px", "24px"];
const colWidthsKey = (grade) => `his_cw_${grade}`;

// ================================================================
// SECTION 4 · Utility Functions
// ================================================================
function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function clean(value) {
  return String(value ?? "").trim();
}

function uniqueOrdered(values) {
  const out = [];
  values.forEach((v) => {
    if (v != null && v !== "" && !out.includes(v)) out.push(v);
  });
  return out;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Tiny helper: create a <button> with one click handler */
function makeBtn(text, className, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  if (className) btn.className = className;
  btn.textContent = text;
  if (onClick) btn.addEventListener("click", onClick);
  return btn;
}

// ================================================================
// SECTION 5 · Data Model: Templates
// ================================================================
function normalizeTemplateGroup(item = {}) {
  return {
    id: item.id || uid("grp"),
    name: clean(item.name),
    creditValue: clean(item.creditValue)
  };
}

function normalizeTemplate(item = {}) {
  const language = ["Korean", "English", "Both"].includes(item.language) ? item.language : "Both";
  const sem1NameKo  = clean(item.sem1NameKo);
  const sem1NameEn  = clean(item.sem1NameEn);
  const sem1Teacher = clean(item.sem1Teacher);
  const sem2NameKo  = clean(item.sem2NameKo);
  const sem2NameEn  = clean(item.sem2NameEn);
  const sem2Teacher = clean(item.sem2Teacher);
  const useSemesterOverrides = Boolean(
    item.useSemesterOverrides || item.separateBySemester || item.splitBySemester ||
    sem1NameKo || sem1NameEn || sem1Teacher || sem2NameKo || sem2NameEn || sem2Teacher
  );
  return {
    id: item.id || uid("tpl"),
    language,
    useSemesterOverrides,
    nameKo:   clean(item.nameKo),
    nameEn:   clean(item.nameEn),
    teacher:  clean(item.teacher),
    sem1NameKo, sem1NameEn, sem1Teacher,
    sem2NameKo, sem2NameEn, sem2Teacher,
    calcGroupId: clean(item.calcGroupId) || null
  };
}

function getSemesterTemplateData(templateOrId, semKey) {
  const item = typeof templateOrId === "string" ? getTemplateById(templateOrId) : templateOrId;
  if (!item) return { nameKo: "", nameEn: "", teacher: "", language: "Both" };
  const prefix = semKey === "sem2" ? "sem2" : "sem1";
  return {
    nameKo:   clean(item[`${prefix}NameKo`])  || clean(item.nameKo)  || clean(item.nameEn),
    nameEn:   clean(item[`${prefix}NameEn`])  || clean(item.nameEn)  || clean(item.nameKo),
    teacher:  clean(item[`${prefix}Teacher`]) || clean(item.teacher),
    language: item.language || "Both"
  };
}

function getTemplateById(templateId) {
  return state.templates.find((t) => t.id === templateId) || null;
}

function getTemplateGroupById(groupId, sourceState = state) {
  return (sourceState.templateGroups || []).find((g) => g.id === groupId) || null;
}

function getTemplateCardTitle(item) {
  if (!item) return "-";
  return (
    clean(item.nameKo) || clean(item.sem1NameKo) || clean(item.sem2NameKo) ||
    clean(item.nameEn) || clean(item.sem1NameEn) || clean(item.sem2NameEn) || "-"
  );
}

function getTemplateTeacherSummary(item) {
  const t1 = getSemesterTemplateData(item, "sem1").teacher;
  const t2 = getSemesterTemplateData(item, "sem2").teacher;
  return uniqueOrdered([t1, t2].filter(Boolean)).join(" · ");
}

function getCommonTeacherCandidate(item) {
  if (clean(item.teacher)) return clean(item.teacher);
  const t1 = clean(item.sem1Teacher);
  const t2 = clean(item.sem2Teacher);
  return t1 && t1 === t2 ? t1 : "";
}

function isSemesterDataSame(item) {
  if (!item) return false;
  if (!item.useSemesterOverrides) return true;
  const s1 = getSemesterTemplateData(item, "sem1");
  const s2 = getSemesterTemplateData(item, "sem2");
  return s1.nameKo === s2.nameKo && s1.nameEn === s2.nameEn && s1.teacher === s2.teacher;
}

function createDefaultTemplates() {
  return [
    normalizeTemplate({ id: uid("tpl"), nameKo: "영어", nameEn: "English Language Arts", teacher: "", language: "English" }),
    normalizeTemplate({ id: uid("tpl"), nameKo: "국어", nameEn: "Korean Language Arts",  teacher: "", language: "Korean" }),
    normalizeTemplate({ id: uid("tpl"), nameKo: "수학", nameEn: "Mathematics",            teacher: "", language: "Both"    }),
    normalizeTemplate({ id: uid("tpl"), nameKo: "과학", nameEn: "Science",                teacher: "", language: "Both"    })
  ];
}

function getTemplateUsageSummary(templateId) {
  const usage = [];

  GRADE_KEYS.forEach((grade) => {
    (state.gradeBoards[grade] || []).forEach((row) => {
      const labels = [];

      if (row.sem1TemplateId === templateId) labels.push("1학기");
      if (row.sem2TemplateId === templateId) labels.push("2학기");

      if (labels.length) {
        usage.push(`${grade} ${labels.join("+")}`);
      }
    });
  });

  return usage;
}

function enableDragScroll(element) {
  if (!element || element.dataset.dragScrollBound === "yes") return;
  element.dataset.dragScrollBound = "yes";

  let isDown = false;
  let startX = 0;
  let startY = 0;
  let scrollLeft = 0;
  let scrollTop = 0;

  element.addEventListener("mousedown", (e) => {
    const target = e.target;
    if (target.closest("input, select, button, textarea, label")) return;

    isDown = true;
    element.classList.add("dragging-scroll");
    startX = e.pageX;
    startY = e.pageY;
    scrollLeft = element.scrollLeft;
    scrollTop = element.scrollTop;
    e.preventDefault();
  });

  window.addEventListener("mouseup", () => {
    isDown = false;
    element.classList.remove("dragging-scroll");
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    const dx = e.pageX - startX;
    const dy = e.pageY - startY;
    element.scrollLeft = scrollLeft - dx;
    element.scrollTop = scrollTop - dy;
  });
}

// ================================================================
// SECTION 6 · Data Model: Rows & Boards
// ================================================================
function createRow(options = DEFAULT_OPTIONS, seed = {}) {
  return {
    id:            uid("row"),
    category:      clean(seed.category) || options.category[0] || "",
    track:         clean(seed.track)    || options.track[0]    || "",
    group:         clean(seed.group)    || options.group[0]    || "",
    credits:       clean(seed.credits),
    sem1TemplateId: null,
    sem2TemplateId: null
  };
}

function normalizeRow(row = {}, options = DEFAULT_OPTIONS) {
  const safeCategory = options.category.includes(row.category)
    ? row.category : (clean(row.category) || options.category[0] || "");
  const safeTrack = options.track.includes(row.track)
    ? row.track : (clean(row.track) || options.track[0] || "");
  const safeGroup = options.group.includes(row.group)
    ? row.group : (clean(row.group) || options.group[0] || "");

  const legacyId = row.templateId ?? row.sem1 ?? row.sem2 ?? null;
  const sem1TemplateId = (row.sem1TemplateId !== undefined) ? (row.sem1TemplateId ?? null) : legacyId;
  const sem2TemplateId = (row.sem2TemplateId !== undefined) ? (row.sem2TemplateId ?? null) : legacyId;

  return {
    id:            row.id || uid("row"),
    category:      safeCategory,
    track:         safeTrack,
    group:         safeGroup,
    credits:       clean(row.credits),
    sem1TemplateId,
    sem2TemplateId
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
      track:    [...DEFAULT_OPTIONS.track],
      group:    [...DEFAULT_OPTIONS.group]
    },
    templates:   createDefaultTemplates(),
    templateGroups: [],
    gradeBoards
  };
}

function normalizeState(raw = {}) {
  const safeOptions = {
    category: Array.isArray(raw.options?.category) && raw.options.category.length
      ? uniqueOrdered(raw.options.category.map(clean)) : [...DEFAULT_OPTIONS.category],
    track: Array.isArray(raw.options?.track) && raw.options.track.length
      ? uniqueOrdered(raw.options.track.map(clean)) : [...DEFAULT_OPTIONS.track],
    group: Array.isArray(raw.options?.group) && raw.options.group.length
      ? uniqueOrdered(raw.options.group.map(clean)) : [...DEFAULT_OPTIONS.group]
  };
  const safeTemplates = Array.isArray(raw.templates) && raw.templates.length
    ? raw.templates.map(normalizeTemplate)
    : createDefaultTemplates();
  const safeTemplateGroups = Array.isArray(raw.templateGroups)
    ? raw.templateGroups.map(normalizeTemplateGroup).filter((group) => group.name)
    : [];
  const gradeBoards = {};
  GRADE_KEYS.forEach((grade) => {
    const rows = Array.isArray(raw.gradeBoards?.[grade]) ? raw.gradeBoards[grade] : [];
    gradeBoards[grade] = rows.length
      ? rows.map((r) => normalizeRow(r, safeOptions))
      : Array.from({ length: DEFAULT_ROW_COUNT }, () => createRow(safeOptions));
  });
  return { options: safeOptions, templates: safeTemplates, templateGroups: safeTemplateGroups, gradeBoards };
}

// ================================================================
// SECTION 7 · Application State
// ================================================================
let state          = createDefaultState();
let unsubscribeBoard = null;
let currentDrag    = null;
let templateEditId = null;
let saveTimer      = null;
let activeTab      = "tab7to9";
let activeMainView = "board";
let templateManagerDraft = null;
let templateManagerDirty = false;

const templateManagerUi = {
  search: "",
  language: "all",
  split: "all",
  sort: "ko-asc"
};

const tabBoardCache = { tab7to9: null, tab10to12: null };
const dirtyTabs     = new Set(["tab7to9", "tab10to12"]);

function invalidateTabs() {
  dirtyTabs.add("tab7to9");
  dirtyTabs.add("tab10to12");
}

function resetTemplateManagerDraft() {
  templateManagerDraft = null;
}

function ensureTemplateManagerDraft() {
  if (!templateManagerDraft) {
    templateManagerDraft = {
      templates: state.templates.map((item) => normalizeTemplate(cloneJson(item))),
      templateGroups: (state.templateGroups || []).map((item) => normalizeTemplateGroup(cloneJson(item)))
    };
  }
  return templateManagerDraft;
}

function openTemplateManager() {
  activeMainView = "manager";
  ensureTemplateManagerDraft();
  setTemplateManagerDirty(false);
  render();
}

function closeTemplateManager() {
  activeMainView = "board";
  resetTemplateManagerDraft();
  setTemplateManagerDirty(false);
  render();
}

function setTemplateManagerDirty(isDirty) {
  templateManagerDirty = isDirty;
  updateTemplateManagerSaveStatus();
}

function updateTemplateManagerSaveStatus(mode = null) {
  if (!templateManagerSaveStatus) return;

  templateManagerSaveStatus.classList.remove("dirty", "saved", "saving");

  if (mode === "saving") {
    templateManagerSaveStatus.textContent = "저장 중...";
    templateManagerSaveStatus.classList.add("saving");
    return;
  }

  if (templateManagerDirty) {
    templateManagerSaveStatus.textContent = "미저장 변경사항";
    templateManagerSaveStatus.classList.add("dirty");
  } else {
    templateManagerSaveStatus.textContent = "저장됨";
    templateManagerSaveStatus.classList.add("saved");
  }
}

// ================================================================
// SECTION 8 · Authentication
// ================================================================
function canEdit() {
  return !!auth.currentUser;
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

async function login() {
  try { await signInWithPopup(auth, provider); }
  catch (e) { console.error(e); alert("로그인에 실패했습니다."); }
}

async function logout() {
  try { await signOut(auth); }
  catch (e) { console.error(e); alert("로그아웃에 실패했습니다."); }
}

function subscribeBoard() {
  if (unsubscribeBoard) { unsubscribeBoard(); unsubscribeBoard = null; }
  unsubscribeBoard = onSnapshot(boardRef, async (snap) => {
    if (!snap.exists()) {
      state = createDefaultState();
      resetTemplateManagerDraft();
      invalidateTabs();
      render();
      await saveNow();
      return;
    }
    state = normalizeState(snap.data().state || {});
    resetTemplateManagerDraft();
    invalidateTabs();
    render();
  }, (err) => {
    console.error(err);
    alert("Firestore 데이터를 불러오지 못했습니다.");
  });
}

onAuthStateChanged(auth, (user) => {
  updateAuthUI(user);
  if (user) {
    subscribeBoard();
  } else {
    if (unsubscribeBoard) { unsubscribeBoard(); unsubscribeBoard = null; }
    state = createDefaultState();
    resetTemplateManagerDraft();
    resetTemplateForm();
    invalidateTabs();
    render();
  }
});

// ================================================================
// SECTION 9 · Persistence
// ================================================================
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
  await setDoc(boardRef, { state, updatedAt: serverTimestamp() });
}

// ================================================================
// SECTION 10 · Column Resize with localStorage Persistence
// ================================================================
function loadColWidths(grade) {
  try {
    const stored = localStorage.getItem(colWidthsKey(grade));
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length === DEFAULT_COL_WIDTHS.length) return parsed;
    }
  } catch (_) {}
  return [...DEFAULT_COL_WIDTHS];
}

function saveColWidths(grade, widths) {
  try { localStorage.setItem(colWidthsKey(grade), JSON.stringify(widths)); }
  catch (_) {}
}

function applyColWidths(column, widths) {
  const tpl = widths.join(" ");
  column.querySelectorAll(".grade-header-row, .grade-data-row").forEach((row) => {
    row.style.gridTemplateColumns = tpl;
  });
}

function initColResize(column, headerRow, grade) {
  const widths = loadColWidths(grade);
  applyColWidths(column, widths);

  headerRow.querySelectorAll(".col-resize-handle").forEach((handle, i) => {
    let startX, startW;
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = handle.parentElement.getBoundingClientRect().width;
      handle.classList.add("resizing");

      const onMove = (ev) => {
        widths[i] = `${Math.max(36, startW + ev.clientX - startX)}px`;
        applyColWidths(column, widths);
      };
      const onUp = () => {
        handle.classList.remove("resizing");
        saveColWidths(grade, widths);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

// ================================================================
// SECTION 11 · State Mutations — Options
// ================================================================
function addOption(type, value) {
  if (!canEdit()) return;
  const trimmed = clean(value);
  if (!trimmed) return;
  if (state.options[type].includes(trimmed)) { alert("이미 있는 옵션입니다."); return; }
  state.options[type].push(trimmed);
  ensureStateConsistency();
  invalidateTabs();
  render();
  scheduleSave();
}

function removeOption(type, value) {
  if (!canEdit()) return;
  if (state.options[type].length <= 1) { alert("최소 1개의 옵션은 남겨두어야 합니다."); return; }
  if (!confirm(`"${value}" 옵션을 삭제할까요?`)) return;
  state.options[type] = state.options[type].filter((v) => v !== value);
  ensureStateConsistency();
  invalidateTabs();
  render();
  scheduleSave();
}

function moveOption(type, index, direction) {
  if (!canEdit()) return;
  const arr = state.options[type];
  const newIdx = index + direction;
  if (newIdx < 0 || newIdx >= arr.length) return;
  [arr[index], arr[newIdx]] = [arr[newIdx], arr[index]];
  invalidateTabs();
  render();
  scheduleSave();
}

// ================================================================
// SECTION 12 · State Mutations — Rows
// ================================================================
function getRowById(grade, rowId) {
  return (state.gradeBoards[grade] || []).find((r) => r.id === rowId) || null;
}

function updateRowField(grade, rowId, field, value) {
  if (!canEdit()) return;
  const row = getRowById(grade, rowId);
  if (!row) return;
  row[field] = value;
  ensureStateConsistency();
  invalidateTabs();
  render();
  scheduleSave();
}

function addRow(grade) {
  if (!canEdit()) return;
  const rows = state.gradeBoards[grade] || [];
  const lastRow = rows[rows.length - 1] || {};
  state.gradeBoards[grade].push(createRow(state.options, {
    category: lastRow.category,
    track:    lastRow.track,
    group:    lastRow.group,
    credits:  lastRow.credits
  }));
  invalidateTabs();
  render();
  scheduleSave();
}

function deleteRow(grade, rowId) {
  if (!canEdit()) return;
  if (!confirm("이 행을 삭제할까요?")) return;
  state.gradeBoards[grade] = state.gradeBoards[grade].filter((r) => r.id !== rowId);
  if (!state.gradeBoards[grade].length) {
    state.gradeBoards[grade].push(createRow(state.options));
  }
  invalidateTabs();
  render();
  scheduleSave();
}

// ================================================================
// SECTION 13 · State Mutations — Drag & Drop
// ================================================================
function placeTemplateTo(templateId, grade, rowId, semKey) {
  if (!canEdit()) return;
  const row = getRowById(grade, rowId);
  if (!row) return;
  const existing = row[`${semKey}TemplateId`];
  if (existing && existing !== templateId) {
    const existTpl  = getTemplateById(existing);
    const newTpl    = getTemplateById(templateId);
    const semLabel  = SEMESTER_LABELS[semKey];
    if (!confirm(
      `${semLabel}에 이미 "${getTemplateCardTitle(existTpl)}" 카드가 있습니다.\n` +
      `"${getTemplateCardTitle(newTpl)}" 카드로 바꿀까요?`
    )) return;
  }
  row[`${semKey}TemplateId`] = templateId;
  invalidateTabs();
  render();
  scheduleSave();
}

function placeBothSems(templateId, grade, rowId) {
  if (!canEdit()) return;
  const row = getRowById(grade, rowId);
  if (!row) return;
  row.sem1TemplateId = templateId;
  row.sem2TemplateId = templateId;
  invalidateTabs();
  render();
  scheduleSave();
}

function clearRowSem(grade, rowId, semKey) {
  if (!canEdit()) return;
  const row = getRowById(grade, rowId);
  if (!row) return;
  row[`${semKey}TemplateId`] = null;
  invalidateTabs();
  render();
  scheduleSave();
}

function clearRowBoth(grade, rowId) {
  if (!canEdit()) return;
  const row = getRowById(grade, rowId);
  if (!row) return;
  row.sem1TemplateId = null;
  row.sem2TemplateId = null;
  invalidateTabs();
  render();
  scheduleSave();
}

function movePlaced(srcGrade, srcRowId, srcSemKey, dstGrade, dstRowId, dstSemKey) {
  if (!canEdit()) return;
  const srcRow = getRowById(srcGrade, srcRowId);
  const dstRow = getRowById(dstGrade, dstRowId);
  if (!srcRow || !dstRow) return;
  if (srcGrade === dstGrade && srcRowId === dstRowId && srcSemKey === dstSemKey) return;

  const movingId   = srcRow[`${srcSemKey}TemplateId`];
  const replacedId = dstRow[`${dstSemKey}TemplateId`];
  srcRow[`${srcSemKey}TemplateId`] = replacedId;
  dstRow[`${dstSemKey}TemplateId`] = movingId;
  invalidateTabs();
  render();
  scheduleSave();
}

// ================================================================
// SECTION 14 · Template Form Logic
// ================================================================
function populateSemesterFieldsFromCommon(force = false) {
  const ko = clean(templateNameKo.value);
  const en = clean(templateNameEn.value);
  const te = clean(templateTeacher.value);
  [
    [templateSem1NameKo, ko], [templateSem1NameEn, en], [templateSem1Teacher, te],
    [templateSem2NameKo, ko], [templateSem2NameEn, en], [templateSem2Teacher, te]
  ].forEach(([inp, val]) => { if (force || !clean(inp.value)) inp.value = val; });
}

function toggleSemesterMode() {
  semesterTemplateFields.classList.toggle("hidden", !templateSeparateSemesters.checked);
}

function resetTemplateForm() {
  templateEditId = null;
  templateNameKo.value = "";
  templateNameEn.value = "";
  templateTeacher.value = "";
  templateLanguage.value = "Korean";
  templateSeparateSemesters.checked = false;
  [templateSem1NameKo, templateSem1NameEn, templateSem1Teacher,
   templateSem2NameKo, templateSem2NameEn, templateSem2Teacher].forEach((i) => { i.value = ""; });
  templateSubmitBtn.textContent = "카드 추가";
  templateCancelBtn.classList.add("hidden");
  toggleSemesterMode();
}

function submitTemplate() {
  if (!canEdit()) return;
  const useSemesterOverrides = templateSeparateSemesters.checked;
  const data = normalizeTemplate({
    id: templateEditId || uid("tpl"),
    language: templateLanguage.value,
    useSemesterOverrides,
    nameKo:   templateNameKo.value,
    nameEn:   templateNameEn.value,
    teacher:  templateTeacher.value,
    sem1NameKo: templateSem1NameKo.value, sem1NameEn: templateSem1NameEn.value, sem1Teacher: templateSem1Teacher.value,
    sem2NameKo: templateSem2NameKo.value, sem2NameEn: templateSem2NameEn.value, sem2Teacher: templateSem2Teacher.value
  });
  const hasCommon   = clean(data.nameKo) || clean(data.nameEn);
  const hasSemester = clean(data.sem1NameKo) || clean(data.sem1NameEn) || clean(data.sem2NameKo) || clean(data.sem2NameEn);
  if (!hasCommon && !(useSemesterOverrides && hasSemester)) {
    alert("한글 이름 또는 영어 이름을 입력해 주세요.");
    return;
  }
  if (templateEditId) {
    const prev = getTemplateById(templateEditId);
    if (prev?.calcGroupId) data.calcGroupId = prev.calcGroupId;
    state.templates = state.templates.map((t) => (t.id === templateEditId ? data : t));
  } else {
    state.templates.push(data);
  }
  resetTemplateManagerDraft();
  resetTemplateForm();
  invalidateTabs();
  render();
  scheduleSave();
}

function editTemplate(templateId) {
  if (!canEdit()) return;
  const item = getTemplateById(templateId);
  if (!item) return;
  templateEditId = templateId;
  templateNameKo.value    = clean(item.nameKo) || clean(getSemesterTemplateData(item, "sem1").nameKo);
  templateNameEn.value    = clean(item.nameEn) || clean(getSemesterTemplateData(item, "sem1").nameEn);
  templateTeacher.value   = getCommonTeacherCandidate(item);
  templateLanguage.value  = item.language;
  templateSeparateSemesters.checked = item.useSemesterOverrides;
  templateSem1NameKo.value  = getSemesterTemplateData(item, "sem1").nameKo;
  templateSem1NameEn.value  = getSemesterTemplateData(item, "sem1").nameEn;
  templateSem1Teacher.value = getSemesterTemplateData(item, "sem1").teacher;
  templateSem2NameKo.value  = getSemesterTemplateData(item, "sem2").nameKo;
  templateSem2NameEn.value  = getSemesterTemplateData(item, "sem2").nameEn;
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
  state.templates = state.templates.filter((t) => t.id !== templateId);
  GRADE_KEYS.forEach((grade) => {
    state.gradeBoards[grade].forEach((row) => {
      if (row.sem1TemplateId === templateId) row.sem1TemplateId = null;
      if (row.sem2TemplateId === templateId) row.sem2TemplateId = null;
    });
  });
  if (templateEditId === templateId) resetTemplateForm();
  resetTemplateManagerDraft();
  invalidateTabs();
  render();
  scheduleSave();
}

// ================================================================
// SECTION 15 · UI Helpers
// ================================================================
function setControlsDisabled(disabled) {
  [
    templateNameKo, templateNameEn, templateTeacher, templateLanguage,
    templateSubmitBtn, templateCancelBtn, templateSeparateSemesters,
    templateSem1NameKo, templateSem1NameEn, templateSem1Teacher,
    templateSem2NameKo, templateSem2NameEn, templateSem2Teacher,
    categoryOptionInput, trackOptionInput, groupOptionInput,
    addCategoryOptionBtn, addTrackOptionBtn, addGroupOptionBtn,
    resetBoardBtn, exportXlsxBtn,
    openTemplateManagerBtn, templateManagerBackBtn, templateManagerAddRowBtn,
    templateManagerSaveBtn, templateManagerDiscardBtn, addTemplateGroupBtn,
    templateManagerSearchInput, templateManagerLanguageFilter,
    templateManagerSplitFilter, templateManagerSortSelect
  ].forEach((el) => { if (el) el.disabled = disabled; });
}

function languageClass(language) {
  return `lang-${String(language || "both").toLowerCase()}`;
}

function getCategoryColor(category) {
  const index = state.options.category.indexOf(category);
  if (index < 0) return { bg: "#f3f4f6", text: "#374151" };
  return CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
}

// ================================================================
// SECTION 16 · Sidebar Rendering
// ================================================================
function createSemesterPreviewItem(item, semKey) {
  const data = getSemesterTemplateData(item, semKey);
  const wrap = document.createElement("div");
  wrap.className = "semester-preview-item";

  const labelEl = document.createElement("div");
  labelEl.className = "semester-preview-label";
  labelEl.textContent = SEMESTER_LABELS[semKey];

  const nameEl = document.createElement("div");
  nameEl.className = "semester-preview-name";
  nameEl.textContent = data.nameKo || data.nameEn || "-";

  wrap.append(labelEl, nameEl);

  if (data.nameEn && data.nameEn !== data.nameKo) {
    const en = document.createElement("div");
    en.className = "semester-preview-en";
    en.textContent = data.nameEn;
    wrap.appendChild(en);
  }
  if (data.teacher) {
    const te = document.createElement("div");
    te.className = "semester-preview-teacher";
    te.textContent = data.teacher;
    wrap.appendChild(te);
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
  const editBtn   = makeBtn("수정", "edit-btn",   () => editTemplate(item.id));
  const deleteBtn = makeBtn("삭제", "delete-btn", () => deleteTemplate(item.id));
  editBtn.disabled   = !canEdit();
  deleteBtn.disabled = !canEdit();
  [editBtn, deleteBtn].forEach((b) => b.addEventListener("mousedown", (e) => e.stopPropagation()));
  const teacherInfo = document.createElement("span");
  teacherInfo.className = "template-teacher-inline";
  teacherInfo.textContent = getTemplateTeacherSummary(item) || "-";
  actions.append(editBtn, deleteBtn, teacherInfo);

  const preview = document.createElement("div");
  preview.className = "template-semester-preview";
  if (isSemesterDataSame(item)) {
    const single = createSemesterPreviewItem(item, "sem1");
    single.style.gridColumn = "1 / -1";
    preview.appendChild(single);
  } else {
    preview.append(
      createSemesterPreviewItem(item, "sem1"),
      createSemesterPreviewItem(item, "sem2")
    );
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
  const sorted = [...state.templates].sort((a, b) =>
    getTemplateCardTitle(a).localeCompare(getTemplateCardTitle(b), "ko")
  );
  sorted.forEach((item) => templateList.appendChild(createTemplateCard(item)));
}

function renderOptionChips(container, type) {
  container.innerHTML = "";
  state.options[type].forEach((value, index) => {
    const chip   = document.createElement("div");
    chip.className = "option-chip";
    const upBtn  = makeBtn("↑", "order-btn", () => moveOption(type, index, -1));
    const downBtn= makeBtn("↓", "order-btn", () => moveOption(type, index, 1));
    const delBtn = makeBtn("×", "", () => removeOption(type, value));
    upBtn.disabled   = !canEdit() || index === 0;
    downBtn.disabled = !canEdit() || index === state.options[type].length - 1;
    delBtn.disabled  = !canEdit();
    const text = document.createElement("span");
    text.textContent = value;
    chip.append(upBtn, text, downBtn, delBtn);
    container.appendChild(chip);
  });
}

// ================================================================
// SECTION 17 · Board: Placed Cards
// ================================================================
function buildExpandedMeta(sem1Item, sem2Item) {
  const meta = document.createElement("div");
  meta.className = "placed-meta placed-meta-hidden";

  const s1 = sem1Item ? getSemesterTemplateData(sem1Item, "sem1") : null;
  const s2 = sem2Item ? getSemesterTemplateData(sem2Item, "sem2") : null;

  const chips = [];
  if (s1 && s1.teacher) chips.push(s1.teacher);
  if (s2 && s2.teacher) chips.push(s2.teacher);

  uniqueOrdered(chips).forEach((teacher) => {
    meta.appendChild(buildMetaChip(teacher));
  });

  return meta;
}

function buildMetaChip(text) {
  const chip = document.createElement("span");
  chip.className = "meta-chip";
  chip.textContent = text;
  return chip;
}

function attachExpandClick(card, meta) {
  card.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    if (!meta.children.length) return;
    const isExpanded = card.classList.toggle("placed-expanded");
    meta.classList.toggle("placed-meta-hidden", !isExpanded);
    document.querySelectorAll(".placed-card.placed-expanded").forEach((other) => {
      if (other !== card) {
        other.classList.remove("placed-expanded");
        other.querySelector(".placed-meta")?.classList.add("placed-meta-hidden");
      }
    });
  });
}

function createPlacedCard(templateId, grade, rowData, semKey) {
  const item = getTemplateById(templateId);
  if (!item) return document.createTextNode("");
  const semData = getSemesterTemplateData(item, semKey);

  const card = document.createElement("div");
  card.className = `placed-card ${languageClass(semData.language)}`;
  card.draggable = canEdit();

  card.addEventListener("dragstart", () => {
    currentDrag = { kind: "placed", sourceGrade: grade, sourceRowId: rowData.id, sourceSemKey: semKey, templateId };
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
  ko.textContent = semData.nameKo || semData.nameEn || "-";
  const en = document.createElement("div");
  en.className = "placed-title-en";
  en.textContent = semData.nameEn || "-";
  titleWrap.append(ko, en);
  top.appendChild(titleWrap);

  if (canEdit()) {
    const clearBtn = makeBtn("×", "clear-cell-btn", (e) => {
      e.stopPropagation();
      clearRowSem(grade, rowData.id, semKey);
    });
    clearBtn.title = "과목 제거";
    clearBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    top.appendChild(clearBtn);
  }

  const otherSemKey      = semKey === "sem1" ? "sem2" : "sem1";
  const otherTemplateId  = semKey === "sem1" ? rowData.sem2TemplateId : rowData.sem1TemplateId;
  const otherItem        = otherTemplateId ? getTemplateById(otherTemplateId) : null;
  const sem1Item = semKey === "sem1" ? item : otherItem;
  const sem2Item = semKey === "sem2" ? item : otherItem;
  const meta = buildExpandedMeta(sem1Item, sem2Item);

  card.append(top, meta);
  attachExpandClick(card, meta);
  return card;
}

function createMergedPlacedCard(templateId, grade, rowData) {
  const item = getTemplateById(templateId);
  if (!item) return document.createTextNode("");
  const sem1Data = getSemesterTemplateData(item, "sem1");

  const card = document.createElement("div");
  card.className = `placed-card placed-card-merged ${languageClass(sem1Data.language)}`;
  card.draggable = canEdit();

  card.addEventListener("dragstart", () => {
    currentDrag = { kind: "placed", sourceGrade: grade, sourceRowId: rowData.id, sourceSemKey: "merged", templateId };
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
  ko.textContent = sem1Data.nameKo || sem1Data.nameEn || "-";

  const en = document.createElement("div");
  en.className = "placed-title-en";
  en.textContent = sem1Data.nameEn || "-";

  titleWrap.append(ko, en);
  top.appendChild(titleWrap);

  if (canEdit()) {
    const clearBtn = makeBtn("×", "clear-cell-btn", (e) => {
      e.stopPropagation();
      clearRowBoth(grade, rowData.id);
    });
    clearBtn.title = "과목 제거";
    clearBtn.addEventListener("mousedown", (e) => e.stopPropagation());

    top.appendChild(clearBtn);
  }

  const meta = buildExpandedMeta(item, item);

  card.append(top, meta);
  attachExpandClick(card, meta);
  return card;
}

// ================================================================
// SECTION 18 · Board: Drop Cells
// ================================================================
function createDropCell(grade, rowData, semKey, templateId) {
  const cell = document.createElement("div");
  cell.className = templateId ? "drop-cell" : "drop-cell empty";
  if (templateId) cell.appendChild(createPlacedCard(templateId, grade, rowData, semKey));

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
      placeBothSems(currentDrag.templateId, grade, rowData.id);
      return;
    }

    if (currentDrag.kind === "placed") {
      if (currentDrag.sourceSemKey === "merged") {
        const movingId = currentDrag.templateId;
        const dstRow   = getRowById(grade, rowData.id);
        const srcRow   = getRowById(currentDrag.sourceGrade, currentDrag.sourceRowId);
        if (dstRow) {
          const replaced = dstRow[`${semKey}TemplateId`];
          dstRow[`${semKey}TemplateId`] = movingId;
          if (srcRow && !(currentDrag.sourceGrade === grade && currentDrag.sourceRowId === rowData.id)) {
            srcRow.sem1TemplateId = replaced;
            srcRow.sem2TemplateId = replaced;
          }
          invalidateTabs(); render(); scheduleSave();
        }
      } else {
        movePlaced(currentDrag.sourceGrade, currentDrag.sourceRowId, currentDrag.sourceSemKey, grade, rowData.id, semKey);
      }
    }
  });
  return cell;
}

function createMergedDropCell(grade, rowData, templateId) {
  const cell = document.createElement("div");
  cell.className = "drop-cell merged-drop-cell";
  cell.style.gridColumn = "4 / 6";
  cell.appendChild(createMergedPlacedCard(templateId, grade, rowData));

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
      placeBothSems(currentDrag.templateId, grade, rowData.id);
      return;
    }

    if (currentDrag.kind === "placed") {
      const movingId = currentDrag.templateId;
      const dstRow   = getRowById(grade, rowData.id);
      const srcRow   = getRowById(currentDrag.sourceGrade, currentDrag.sourceRowId);
      if (!dstRow) return;

      if (currentDrag.sourceSemKey === "merged") {
        if (srcRow && !(currentDrag.sourceGrade === grade && currentDrag.sourceRowId === rowData.id)) {
          const oldDst = dstRow.sem1TemplateId;
          dstRow.sem1TemplateId = movingId;
          dstRow.sem2TemplateId = movingId;
          srcRow.sem1TemplateId = oldDst;
          srcRow.sem2TemplateId = oldDst;
          invalidateTabs(); render(); scheduleSave();
        }
      } else {
        dstRow.sem1TemplateId = movingId;
        dstRow.sem2TemplateId = movingId;
        if (srcRow) srcRow[`${currentDrag.sourceSemKey}TemplateId`] = null;
        invalidateTabs(); render(); scheduleSave();
      }
    }
  });
  return cell;
}

// ================================================================
// SECTION 19 · Board: Rows, Headers, Summary
// ================================================================
function createSelect(options, currentValue, onChange) {
  const select = document.createElement("select");
  select.className = "row-select";
  select.disabled = !canEdit();
  options.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    if (value === currentValue) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("change", (e) => onChange(e.target.value));
  return select;
}

function styleCategorySelect(select, category) {
  const color = getCategoryColor(category);
  select.classList.add("category-select");
  select.style.backgroundColor = color.bg;
  select.style.color = color.text;
}

function shouldRenderMergedRow(rowData) {
  if (!rowData?.sem1TemplateId || !rowData?.sem2TemplateId) return false;
  if (rowData.sem1TemplateId !== rowData.sem2TemplateId) return false;
  const item = getTemplateById(rowData.sem1TemplateId);
  return isSemesterDataSame(item);
}

function createGradeRow(grade, rowData) {
  const row = document.createElement("div");
  row.className = "grade-data-row";

  const catSelect = createSelect(state.options.category, rowData.category,
    (v) => updateRowField(grade, rowData.id, "category", v));
  styleCategorySelect(catSelect, rowData.category);
  row.appendChild(catSelect);
  row.appendChild(createSelect(state.options.track, rowData.track,
    (v) => updateRowField(grade, rowData.id, "track", v)));
  row.appendChild(createSelect(state.options.group, rowData.group,
    (v) => updateRowField(grade, rowData.id, "group", v)));

  const { sem1TemplateId, sem2TemplateId } = rowData;
  const isMerged = shouldRenderMergedRow(rowData);

  if (isMerged) {
    row.appendChild(createMergedDropCell(grade, rowData, sem1TemplateId));
  } else {
    row.appendChild(createDropCell(grade, rowData, "sem1", sem1TemplateId));
    row.appendChild(createDropCell(grade, rowData, "sem2", sem2TemplateId));
  }

  const creditInput = document.createElement("input");
  creditInput.className = "credit-input";
  creditInput.type = "text";
  creditInput.value = rowData.credits;
  creditInput.placeholder = "0";
  creditInput.disabled = !canEdit();
  creditInput.addEventListener("change", (e) => updateRowField(grade, rowData.id, "credits", e.target.value));
  row.appendChild(creditInput);

  const delBtn = makeBtn("×", "row-delete-btn", () => deleteRow(grade, rowData.id));
  delBtn.disabled = !canEdit();
  row.appendChild(delBtn);

  return row;
}

function createSpacerGradeRow() {
  const row = document.createElement("div");
  row.className = "grade-data-row spacer-row";
  for (let i = 0; i < 7; i++) {
    const cell = document.createElement("div");
    cell.className = "spacer-cell";
    row.appendChild(cell);
  }
  return row;
}

function createTrackGroupDivider(track) {
  const div = document.createElement("div");
  div.className = "track-group-divider";
  div.textContent = track || "구분 없음";
  return div;
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
  const cats = [...state.options.category];
  grades.forEach((grade) => {
    (state.gradeBoards[grade] || []).forEach((row) => {
      if (row.category && !cats.includes(row.category)) cats.push(row.category);
    });
  });
  return cats;
}

function getOrderedTracksForCategory(grades, category) {
  const tracks = [...state.options.track];
  grades.forEach((grade) => {
    (state.gradeBoards[grade] || [])
      .filter((r) => r.category === category)
      .forEach((r) => { if (r.track && !tracks.includes(r.track)) tracks.push(r.track); });
  });
  return tracks;
}

function hasPlacedTemplate(row) {
  return !!(row?.sem1TemplateId || row?.sem2TemplateId);
}

function parseCreditValue(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function getRepresentativeTrackCredit(rows) {
  return rows.reduce((max, row) => Math.max(max, parseCreditValue(row.credits)), 0);
}

function getRowTemplateGroupId(row) {
  const semIds = uniqueOrdered([row.sem1TemplateId, row.sem2TemplateId].filter(Boolean));
  const groupIds = uniqueOrdered(
    semIds.map((id) => getTemplateById(id)?.calcGroupId).filter(Boolean)
  );
  return groupIds.length === 1 ? groupIds[0] : null;
}

function summarizeCategoryRows(category, rows) {
  const activeRows = (rows || []).filter(hasPlacedTemplate);

  if (clean(category) === "교과") {
    const commonRows = activeRows.filter((row) => clean(row.track) === "공통");
    const nonCommonRows = activeRows.filter((row) => clean(row.track) !== "공통");

    const commonGroupMap = new Map();
    const commonUngrouped = [];
    commonRows.forEach((row) => {
      const groupId = getRowTemplateGroupId(row);
      if (groupId) {
        if (!commonGroupMap.has(groupId)) commonGroupMap.set(groupId, []);
        commonGroupMap.get(groupId).push(row);
      } else {
        commonUngrouped.push(row);
      }
    });

    const groupedByTrack = new Map();
    nonCommonRows.forEach((row) => {
      const key = clean(row.track) || row.id;
      if (!groupedByTrack.has(key)) groupedByTrack.set(key, []);
      groupedByTrack.get(key).push(row);
    });

    const totalCourses =
      commonUngrouped.length + commonGroupMap.size + groupedByTrack.size;

    const commonCredits = commonUngrouped.reduce((sum, row) => sum + parseCreditValue(row.credits), 0);
    const commonGroupedCredits = Array.from(commonGroupMap.entries()).reduce((sum, [groupId, groupRows]) => {
      const group = getTemplateGroupById(groupId);
      const representative = clean(group?.creditValue) ? parseCreditValue(group.creditValue) : getRepresentativeTrackCredit(groupRows);
      return sum + representative;
    }, 0);

    const groupedTrackCredits = Array.from(groupedByTrack.values()).reduce((sum, groupRows) => {
      const templateGroupIds = uniqueOrdered(groupRows.map(getRowTemplateGroupId).filter(Boolean));
      if (templateGroupIds.length === 1) {
        const group = getTemplateGroupById(templateGroupIds[0]);
        const representative = clean(group?.creditValue) ? parseCreditValue(group.creditValue) : getRepresentativeTrackCredit(groupRows);
        return sum + representative;
      }
      return sum + getRepresentativeTrackCredit(groupRows);
    }, 0);

    return {
      totalCourses,
      totalCredits: commonCredits + commonGroupedCredits + groupedTrackCredits
    };
  }

  return {
    totalCourses: activeRows.length,
    totalCredits: activeRows.length
  };
}

function getCategorySummary(grade, category) {
  const rows = (state.gradeBoards[grade] || []).filter((row) => row.category === category);
  return summarizeCategoryRows(category, rows);
}

function getGradeSummary(grade) {
  const categories = [...state.options.category];
  return categories.reduce(
    (acc, category) => {
      const summary = getCategorySummary(grade, category);
      acc.totalCourses += summary.totalCourses;
      acc.totalCredits += summary.totalCredits;
      return acc;
    },
    { totalCourses: 0, totalCredits: 0 }
  );
}

function createCategorySummaryRow(grade, category) {
  const summary = getCategorySummary(grade, category);

  const row = document.createElement("div");
  row.className = "category-summary-row";

  const label = document.createElement("div");
  label.className = "category-summary-label";
  label.textContent = `${category} 합계`;

  const courses = document.createElement("div");
  courses.className = "category-summary-value";
  courses.textContent = `Total #Courses ${summary.totalCourses}`;

  const credits = document.createElement("div");
  credits.className = "category-summary-value";
  credits.textContent = `Total #Credits ${summary.totalCredits}`;

  row.append(label, courses, credits);
  return row;
}

// ================================================================
// SECTION 20 · Board: Build & Render with Tab Cache
// ================================================================
function buildTabBoard(visibleGrades) {
  const columns = [];

  visibleGrades.forEach((grade) => {
    const column = document.createElement("section");
    column.className = "grade-column";

    const gradeSummary = getGradeSummary(grade);
    const titleEl = document.createElement("div");
    titleEl.className = "grade-title";
    titleEl.innerHTML = `
      <div class="grade-title-top">
        <span class="grade-title-name">${grade}</span>
        <div class="grade-title-totals">
          <span class="grade-title-badge">Total #Courses ${gradeSummary.totalCourses}</span>
          <span class="grade-title-badge">Total #Credits ${gradeSummary.totalCredits}</span>
        </div>
      </div>
      <div class="grade-subtitle">Category / Semester / Credits</div>
    `;
    column.appendChild(titleEl);

    const headerRow = createGradeHeader(column);
    column.appendChild(headerRow);

    columns.push({ grade, column, headerRow });
  });

  const categories = getOrderedCategoriesForGrades(visibleGrades);
  const colByGrade = Object.fromEntries(columns.map((c) => [c.grade, c]));

  categories.forEach((category) => {
    const hasAny = visibleGrades.some((g) =>
      (state.gradeBoards[g] || []).some((r) => r.category === category)
    );
    if (!hasAny) return;

    const tracks = getOrderedTracksForCategory(visibleGrades, category);
    tracks.forEach((track) => {
      const rowsByGrade = {};
      let maxRows = 0;
      visibleGrades.forEach((grade) => {
        const rs = (state.gradeBoards[grade] || []).filter((r) =>
          r.category === category && r.track === track
        );
        rowsByGrade[grade] = rs;
        maxRows = Math.max(maxRows, rs.length);
      });
      if (!maxRows) return;

      visibleGrades.forEach((grade) => {
        colByGrade[grade].column.appendChild(createTrackGroupDivider(track));
      });

      for (let i = 0; i < maxRows; i++) {
        visibleGrades.forEach((grade) => {
          const rowData = rowsByGrade[grade][i];
          colByGrade[grade].column.appendChild(
            rowData ? createGradeRow(grade, rowData) : createSpacerGradeRow()
          );
        });
      }
    });

    visibleGrades.forEach((grade) => {
      colByGrade[grade].column.appendChild(createCategorySummaryRow(grade, category));
    });
  });

  columns.forEach(({ grade, column, headerRow }) => {
    const footer = document.createElement("div");
    footer.className = "grade-footer";
    const addBtn = makeBtn(`${grade} 행 추가`, "add-row-btn", () => addRow(grade));
    addBtn.disabled = !canEdit();
    footer.appendChild(addBtn);
    column.appendChild(footer);
    initColResize(column, headerRow, grade);
  });

  return columns.map((c) => c.column);
}

function getTemplateManagerFilteredRows() {
  const draft = ensureTemplateManagerDraft();
  const search = clean(templateManagerUi.search).toLowerCase();
  const filtered = draft.templates.filter((item) => {
    if (templateManagerUi.language !== "all" && item.language !== templateManagerUi.language) return false;
    if (templateManagerUi.split === "split" && !item.useSemesterOverrides) return false;
    if (templateManagerUi.split === "same" && item.useSemesterOverrides) return false;
    if (search) {
      const haystack = [
        item.nameKo, item.nameEn, item.teacher,
        item.sem1NameKo, item.sem1NameEn, item.sem1Teacher,
        item.sem2NameKo, item.sem2NameEn, item.sem2Teacher
      ].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const getSortValue = (item, key) => clean(key === "en" ? (item.nameEn || item.sem1NameEn || item.nameKo) : (item.nameKo || item.sem1NameKo || item.nameEn));
  filtered.sort((a, b) => {
    switch (templateManagerUi.sort) {
      case "ko-desc":
        return getSortValue(b, "ko").localeCompare(getSortValue(a, "ko"), "ko");
      case "en-asc":
        return getSortValue(a, "en").localeCompare(getSortValue(b, "en"), "en");
      case "language":
        return `${a.language}-${getSortValue(a, "ko")}`.localeCompare(`${b.language}-${getSortValue(b, "ko")}`, "ko");
      case "group": {
        const ga = getTemplateGroupById(a.calcGroupId, draft)?.name || "";
        const gb = getTemplateGroupById(b.calcGroupId, draft)?.name || "";
        return `${ga}-${getSortValue(a, "ko")}`.localeCompare(`${gb}-${getSortValue(b, "ko")}`, "ko");
      }
      case "ko-asc":
      default:
        return getSortValue(a, "ko").localeCompare(getSortValue(b, "ko"), "ko");
    }
  });

  return filtered;
}

function renderTemplateManagerTable() {
  const draft = ensureTemplateManagerDraft();
  const rows = getTemplateManagerFilteredRows();
  templateManagerCount.textContent = `${rows.length} / ${draft.templates.length}개 표시`;

  if (!rows.length) {
    templateManagerTableWrap.innerHTML = '<div class="manager-empty">검색 조건에 맞는 과목카드가 없습니다.</div>';
    return;
  }

  const buildGroupOptions = (selectedId) => ['<option value="">없음</option>']
    .concat(draft.templateGroups.map((group) => `<option value="${escapeHtml(group.id)}" ${selectedId === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`))
    .join('');

  const bodyRows = rows.map((item) => {
    const usage = getTemplateUsageSummary(item.id);
    const usageHtml = usage.length
      ? usage.map((label) => `<span class="usage-chip">${escapeHtml(label)}</span>`).join("")
      : `<span class="manager-note-chip">미사용</span>`;

    return `
      <tr data-template-id="${item.id}">
        <td class="col-delete"><button type="button" class="row-delete-btn-inline" data-action="delete-template">삭제</button></td>
        <td class="col-usage"><div class="usage-cell">${usageHtml}</div></td>
        <td><input type="text" data-field="nameKo" value="${escapeHtml(item.nameKo)}" /></td>
        <td><input type="text" data-field="nameEn" value="${escapeHtml(item.nameEn)}" /></td>
        <td><input type="text" data-field="teacher" value="${escapeHtml(item.teacher)}" /></td>
        <td class="col-language">
          <select data-field="language">
            ${['Korean','English','Both'].map((language) => `<option value="${language}" ${item.language === language ? 'selected' : ''}>${language}</option>`).join('')}
          </select>
        </td>
        <td class="col-group">
          <select data-field="calcGroupId">
            ${buildGroupOptions(item.calcGroupId || "")}
          </select>
        </td>
        <td class="col-toggle toggle-cell"><input type="checkbox" data-field="useSemesterOverrides" ${item.useSemesterOverrides ? 'checked' : ''} /></td>
        <td><input type="text" data-field="sem1NameKo" value="${escapeHtml(item.sem1NameKo)}" /></td>
        <td><input type="text" data-field="sem1NameEn" value="${escapeHtml(item.sem1NameEn)}" /></td>
        <td><input type="text" data-field="sem1Teacher" value="${escapeHtml(item.sem1Teacher)}" /></td>
        <td><input type="text" data-field="sem2NameKo" value="${escapeHtml(item.sem2NameKo)}" /></td>
        <td><input type="text" data-field="sem2NameEn" value="${escapeHtml(item.sem2NameEn)}" /></td>
        <td><input type="text" data-field="sem2Teacher" value="${escapeHtml(item.sem2Teacher)}" /></td>
      </tr>
    `;
  }).join('');

  templateManagerTableWrap.innerHTML = `
    <table class="manager-table">
      <thead>
        <tr>
          <th class="col-delete">삭제</th>
          <th class="col-usage">적용 학년/학기</th>
          <th>한글 이름</th>
          <th>영어 이름</th>
          <th>공통 교사</th>
          <th class="col-language">언어</th>
          <th class="col-group">계산 그룹</th>
          <th class="col-toggle">학기 분리</th>
          <th>1학기 한글</th>
          <th>1학기 영어</th>
          <th>1학기 교사</th>
          <th>2학기 한글</th>
          <th>2학기 영어</th>
          <th>2학기 교사</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
  setTemplateManagerDirty(true);
}

function renderTemplateGroupTable() {
  const draft = ensureTemplateManagerDraft();
  if (!draft.templateGroups.length) {
    templateGroupTableWrap.innerHTML = '<div class="manager-empty">아직 계산 그룹이 없습니다.</div>';
    return;
  }

  const bodyRows = draft.templateGroups.map((group) => {
    const memberCount = draft.templates.filter((item) => item.calcGroupId === group.id).length;
    return `
      <tr data-group-id="${group.id}">
        <td><input type="text" data-field="name" value="${escapeHtml(group.name)}" /></td>
        <td class="col-credit"><input type="text" data-field="creditValue" value="${escapeHtml(group.creditValue)}" placeholder="대표 시수" /></td>
        <td><span class="manager-note-chip">연결 ${memberCount}개</span></td>
        <td class="col-delete"><button type="button" class="row-delete-btn-inline" data-action="delete-group">삭제</button></td>
      </tr>
    `;
  }).join('');

  templateGroupTableWrap.innerHTML = `
    <table class="manager-table groups-table">
      <thead>
        <tr>
          <th>그룹명</th>
          <th class="col-credit">대표 시수</th>
          <th>연결 카드 수</th>
          <th class="col-delete">삭제</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
  enableDragScroll(templateGroupTableWrap);
}

function renderTemplateManager() {
  ensureTemplateManagerDraft();
  renderTemplateManagerTable();
  renderTemplateGroupTable();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addTemplateManagerRow() {
  if (!canEdit()) return;
  const draft = ensureTemplateManagerDraft();
  draft.templates.unshift(normalizeTemplate({ id: uid("tpl"), language: "Both" }));
  renderTemplateManager();
  setTemplateManagerDirty(true);
}

function addTemplateGroupDraft() {
  if (!canEdit()) return;
  const draft = ensureTemplateManagerDraft();
  draft.templateGroups.push(normalizeTemplateGroup({ id: uid("grp"), name: `그룹 ${draft.templateGroups.length + 1}`, creditValue: "" }));
  renderTemplateManager();
  setTemplateManagerDirty(true);
}

function saveTemplateManagerDraftLocally() {
  const draft = ensureTemplateManagerDraft();
  const validGroupIds = new Set(draft.templateGroups.map((group) => group.id));
  draft.templates = draft.templates.map((item) => {
    const normalized = normalizeTemplate(item);
    if (normalized.calcGroupId && !validGroupIds.has(normalized.calcGroupId)) normalized.calcGroupId = null;
    return normalized;
  });
  draft.templateGroups = draft.templateGroups.map(normalizeTemplateGroup);
}

async function commitTemplateManagerDraft() {
  if (!canEdit()) return;
  updateTemplateManagerSaveStatus("saving");
  saveTemplateManagerDraftLocally();
  state.templates = ensureTemplateManagerDraft().templates.map((item) => normalizeTemplate(cloneJson(item)));
  state.templateGroups = ensureTemplateManagerDraft().templateGroups.map((item) => normalizeTemplateGroup(cloneJson(item)));
  if (templateEditId) {
    const edited = getTemplateById(templateEditId);
    if (edited) editTemplate(templateEditId);
    else resetTemplateForm();
  }
  invalidateTabs();
  render();
  await saveNow();
  setTemplateManagerDirty(false);
}

function renderTabs() {
  tab7to9Btn.classList.toggle("active", activeTab === "tab7to9");
  tab10to12Btn.classList.toggle("active", activeTab === "tab10to12");
}

function renderGradeBoard() {
  const tab = activeTab;

  if (!dirtyTabs.has(tab) && tabBoardCache[tab]) {
    gradeBoard.innerHTML = "";
    tabBoardCache[tab].forEach((el) => gradeBoard.appendChild(el));
    return;
  }

  const columnEls = buildTabBoard(GRADE_GROUPS[tab]);
  gradeBoard.innerHTML = "";
  columnEls.forEach((el) => gradeBoard.appendChild(el));
  tabBoardCache[tab] = columnEls;
  dirtyTabs.delete(tab);
}

function render() {
  ensureStateConsistency();
  renderTemplates();
  renderOptionChips(categoryOptionList, "category");
  renderOptionChips(trackOptionList, "track");
  renderOptionChips(groupOptionList, "group");
  renderTabs();
  renderGradeBoard();
  boardView.classList.toggle("hidden", activeMainView !== "board");
  templateManagerView.classList.toggle("hidden", activeMainView !== "manager");
  openTemplateManagerBtn.textContent = activeMainView === "manager" ? "보드 보기" : "표 편집";
  if (activeMainView === "manager") renderTemplateManager();
  setControlsDisabled(!canEdit());
  toggleSemesterMode();
}

// ================================================================
// SECTION 21 · Excel Export
// ================================================================
function exportXLSX() {
  const wb    = XLSX.utils.book_new();
  const grades= GRADE_GROUPS[activeTab];
  const rows  = [[
    "학년", "범주", "구분", "교과군",
    "1학기(한글)", "1학기(영어)", "1학기(교사)",
    "2학기(한글)", "2학기(영어)", "2학기(교사)", "시수"
  ]];

  grades.forEach((grade) => {
    (state.gradeBoards[grade] || []).forEach((row) => {
      const tpl1 = row.sem1TemplateId ? getTemplateById(row.sem1TemplateId) : null;
      const tpl2 = row.sem2TemplateId ? getTemplateById(row.sem2TemplateId) : null;
      const s1   = tpl1 ? getSemesterTemplateData(tpl1, "sem1") : { nameKo: "", nameEn: "", teacher: "" };
      const s2   = tpl2 ? getSemesterTemplateData(tpl2, "sem2") : { nameKo: "", nameEn: "", teacher: "" };
      rows.push([
        grade, row.category, row.track, row.group,
        s1.nameKo || "", s1.nameEn || "", s1.teacher || "",
        s2.nameKo || "", s2.nameEn || "", s2.teacher || "",
        row.credits || ""
      ]);
    });
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [10, 8, 10, 12, 18, 22, 14, 18, 22, 14, 6].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, activeTab === "tab7to9" ? "7-9학년" : "10-12학년");
  XLSX.writeFile(wb, "HIS_Curriculum.xlsx");
}

// ================================================================
// SECTION 22 · Event Listeners
// ================================================================
loginBtn.addEventListener("click", login);
logoutBtn.addEventListener("click", logout);
exportXlsxBtn.addEventListener("click", exportXLSX);

resetBoardBtn.addEventListener("click", async () => {
  if (!canEdit()) return;
  if (!confirm("공용 보드를 기본 상태로 초기화할까요?")) return;
  state = createDefaultState();
  resetTemplateManagerDraft();
  resetTemplateForm();
  invalidateTabs();
  render();
  await saveNow();
});

tab7to9Btn.addEventListener("click", () => {
  if (activeTab === "tab7to9") return;
  activeTab = "tab7to9";
  renderTabs();
  renderGradeBoard();
});

tab10to12Btn.addEventListener("click", () => {
  if (activeTab === "tab10to12") return;
  activeTab = "tab10to12";
  renderTabs();
  renderGradeBoard();
});

templateSubmitBtn.addEventListener("click", submitTemplate);
templateCancelBtn.addEventListener("click", resetTemplateForm);

templateSeparateSemesters.addEventListener("change", () => {
  if (templateSeparateSemesters.checked) {
    const hasData = [
      templateSem1NameKo, templateSem1NameEn, templateSem1Teacher,
      templateSem2NameKo, templateSem2NameEn, templateSem2Teacher
    ].some((inp) => clean(inp.value));
    if (!hasData) populateSemesterFieldsFromCommon(true);
  }
  toggleSemesterMode();
});

[templateNameKo, templateNameEn, templateTeacher].forEach((inp) => {
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") submitTemplate(); });
});

[templateSem1NameKo, templateSem1NameEn, templateSem1Teacher,
 templateSem2NameKo, templateSem2NameEn, templateSem2Teacher].forEach((inp) => {
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") submitTemplate(); });
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

[
  [categoryOptionInput, addCategoryOptionBtn],
  [trackOptionInput,    addTrackOptionBtn],
  [groupOptionInput,    addGroupOptionBtn]
].forEach(([inp, btn]) => {
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });
});

openTemplateManagerBtn.addEventListener("click", () => {
  if (activeMainView === "manager") {
    closeTemplateManager();
  } else {
    openTemplateManager();
  }
});

templateManagerBackBtn.addEventListener("click", closeTemplateManager);
templateManagerAddRowBtn.addEventListener("click", addTemplateManagerRow);
templateManagerDiscardBtn.addEventListener("click", () => {
  if (!canEdit()) return;
  if (!confirm("과목카드 편집 화면의 변경 내용을 취소할까요?")) return;
  resetTemplateManagerDraft();
  setTemplateManagerDirty(false);
  renderTemplateManager();
});
templateManagerSaveBtn.addEventListener("click", commitTemplateManagerDraft);
addTemplateGroupBtn.addEventListener("click", addTemplateGroupDraft);

templateManagerSearchInput.addEventListener("input", (e) => {
  templateManagerUi.search = e.target.value;
  renderTemplateManager();
});
templateManagerLanguageFilter.addEventListener("change", (e) => {
  templateManagerUi.language = e.target.value;
  renderTemplateManager();
});
templateManagerSplitFilter.addEventListener("change", (e) => {
  templateManagerUi.split = e.target.value;
  renderTemplateManager();
});
templateManagerSortSelect.addEventListener("change", (e) => {
  templateManagerUi.sort = e.target.value;
  renderTemplateManager();
});

templateManagerTableWrap.addEventListener("input", (e) => {
  const row = e.target.closest("tr[data-template-id]");
  if (!row) return;
  const draft = ensureTemplateManagerDraft();
  const item = draft.templates.find((template) => template.id === row.dataset.templateId);
  if (!item) return;
  const field = e.target.dataset.field;
  if (!field) return;
  item[field] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  setTemplateManagerDirty(true);
});

templateManagerTableWrap.addEventListener("change", (e) => {
  const row = e.target.closest("tr[data-template-id]");
  if (!row) return;
  const draft = ensureTemplateManagerDraft();
  const item = draft.templates.find((template) => template.id === row.dataset.templateId);
  if (!item) return;
  const field = e.target.dataset.field;
  if (!field) return;
  item[field] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  if (["language", "calcGroupId", "useSemesterOverrides"].includes(field)) {
    renderTemplateManager();
  }
  setTemplateManagerDirty(true);
});

templateManagerTableWrap.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='delete-template']");
  if (!btn) return;
  if (!canEdit()) return;
  const row = btn.closest("tr[data-template-id]");
  if (!row) return;
  const draft = ensureTemplateManagerDraft();
  const target = draft.templates.find((template) => template.id === row.dataset.templateId);
  if (!target) return;
  if (!confirm(`"${getTemplateCardTitle(target)}" 카드를 삭제할까요?`)) return;
  draft.templates = draft.templates.filter((template) => template.id !== target.id);
  renderTemplateManager();
});

templateGroupTableWrap.addEventListener("input", (e) => {
  const row = e.target.closest("tr[data-group-id]");
  if (!row) return;
  const draft = ensureTemplateManagerDraft();
  const group = draft.templateGroups.find((item) => item.id === row.dataset.groupId);
  if (!group) return;
  const field = e.target.dataset.field;
  if (!field) return;
  group[field] = e.target.value;
});

templateGroupTableWrap.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='delete-group']");
  if (!btn) return;
  if (!canEdit()) return;
  const row = btn.closest("tr[data-group-id]");
  if (!row) return;
  const draft = ensureTemplateManagerDraft();
  const group = draft.templateGroups.find((item) => item.id === row.dataset.groupId);
  if (!group) return;
  if (!confirm(`"${group.name}" 계산 그룹을 삭제할까요?`)) return;
  draft.templateGroups = draft.templateGroups.filter((item) => item.id !== group.id);
  draft.templates.forEach((template) => {
    if (template.calcGroupId === group.id) template.calcGroupId = null;
  });
  renderTemplateManager();
});

// ================================================================
// SECTION 23 · Initialize
// ================================================================
render();
updateTemplateManagerSaveStatus();
enableDragScroll(templateManagerTableWrap);