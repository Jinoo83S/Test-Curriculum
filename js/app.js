// ================================================================
// app.js · Main Entry: Auth + Navigation + Events
// ================================================================
import { auth, GRADE_GROUPS } from "./config.js";
import { login, logout, onAuth, canEdit } from "./auth.js";
import { appState, subscribeAll, unsubscribeAll, setOnUpdate, scheduleSave, saveNow, migrateFromLegacy, initialLoad } from "./state.js";

// ── Curriculum imports ────────────────────────────────────────────
import { buildTabBoard, renderOptionChips, exportXLSX, addOption, removeOption, setOnCurriculumChange } from "./curriculum.js";

// ── Template imports ──────────────────────────────────────────────
import {
  renderTemplates, renderGroupManager, renderTemplateManagerTable, handleTableInput, handleTableChange, handleTableDeleteClick,
  addTemplateManagerRow, getOrCreateDraft, resetDraft, commitDraft,
  deleteTemplate, addLiveTemplateGroup,
  templateEditId, templateFormSchoolLevel,
  setTemplateEditId, setTemplateFormSchoolLevel,
  getTemplateById, getSemesterTemplateData,
  getTemplateCardTitle, managerUi,
  setSidebarLevel, setGroupManagerLevel,
  copyTemplate, setOnTemplateChange, updateTeacherDatalist, syncSchoolLevels,
  clearStableOrder, parseTemplatePaste, addParsedTemplates
} from "./templates.js";
import { normalizeTemplate } from "./state.js";

// ── Student imports ───────────────────────────────────────────────
import { renderClassList, renderStudentTable, parseExcelPaste, exportStudentXlsx, addNewClass, deleteClass, updateClass, addStudentToClass, getClassById } from "./students.js";

// ── Teacher imports ───────────────────────────────────────────────
import { renderTeacherView } from "./teachers.js";

// ── Roster imports ────────────────────────────────────────────────
import { renderRosterView } from "./rosters.js";

// ── Results imports ───────────────────────────────────────────────
import { renderResultsView } from "./results.js";

// ── DOM: Topbar ───────────────────────────────────────────────────
const authStatusEl     = document.getElementById("authStatus");
const loginBtn         = document.getElementById("loginBtn");
const logoutBtn        = document.getElementById("logoutBtn");
const resetBoardBtn    = document.getElementById("resetBoardBtn");
const exportXlsxBtn    = document.getElementById("exportXlsxBtn");

// ── DOM: Sidebar ──────────────────────────────────────────────────
const templateListEl        = document.getElementById("templateList");
const sidebarLevelFilter    = document.getElementById("sidebarSchoolLevelFilter");
const openGroupManagerBtn   = document.getElementById("openGroupManagerBtn");
const openTemplateManagerBtn= document.getElementById("openTemplateManagerBtn");
const categoryOptionList    = document.getElementById("categoryOptionList");
const trackOptionList       = document.getElementById("trackOptionList");
const groupOptionList       = document.getElementById("groupOptionList");
const categoryOptionInput   = document.getElementById("categoryOptionInput");
const trackOptionInput      = document.getElementById("trackOptionInput");
const groupOptionInput      = document.getElementById("groupOptionInput");
const addCategoryOptionBtn  = document.getElementById("addCategoryOptionBtn");
const addTrackOptionBtn     = document.getElementById("addTrackOptionBtn");
const addGroupOptionBtn     = document.getElementById("addGroupOptionBtn");

// ── DOM: Template Form ────────────────────────────────────────────
const templateNameKo    = document.getElementById("templateNameKo");
const templateNameEn    = document.getElementById("templateNameEn");
const templateTeacher   = document.getElementById("templateTeacher");
const templateLanguage  = document.getElementById("templateLanguage");
const templateSubmitBtn = document.getElementById("templateSubmitBtn");
const templateCancelBtn = document.getElementById("templateCancelBtn");
const templateSepCheck  = document.getElementById("templateSeparateSemesters");
const semesterFields    = document.getElementById("semesterTemplateFields");
const sem1NameKo  = document.getElementById("templateSem1NameKo");
const sem1NameEn  = document.getElementById("templateSem1NameEn");
const sem1Teacher = document.getElementById("templateSem1Teacher");
const sem2NameKo  = document.getElementById("templateSem2NameKo");
const sem2NameEn  = document.getElementById("templateSem2NameEn");
const sem2Teacher = document.getElementById("templateSem2Teacher");
const levelPicker = document.getElementById("templateSchoolLevelPicker");

// ── DOM: Main views ───────────────────────────────────────────────
const navBoardBtn = document.getElementById("navBoardBtn");
const gradeBoard    = document.getElementById("gradeBoard");
const boardView     = document.getElementById("boardView");
const groupMgrView  = document.getElementById("groupManagerView");
const groupMgrBoard = document.getElementById("groupManagerBoard");
const groupMgrAddBtn= document.getElementById("groupManagerAddGroupBtn");
const groupMgrBackBtn=document.getElementById("groupManagerBackBtn");
const tplMgrView    = document.getElementById("templateManagerView");
const tplMgrBackBtn = document.getElementById("templateManagerBackBtn");
const tplMgrAddBtn  = document.getElementById("templateManagerAddRowBtn");
const tplMgrSaveBtn = document.getElementById("templateManagerSaveBtn");
const tplMgrDiscBtn = document.getElementById("templateManagerDiscardBtn");
const tplMgrTableWrap = document.getElementById("templateManagerTableWrap");
const tplMgrCount   = document.getElementById("templateManagerCount");
const tplMgrSearch  = document.getElementById("templateManagerSearchInput");
const tplMgrLang    = document.getElementById("templateManagerLanguageFilter");
const tplMgrSplit   = document.getElementById("templateManagerSplitFilter");
const tplMgrSort    = document.getElementById("templateManagerSortSelect");
const tplMgrLevel   = document.getElementById("templateManagerLevelFilter");
const tplMgrSortBtn = document.getElementById("templateManagerSortBtn");
const studentMgrView= document.getElementById("studentMgmtView");
const teacherMgrView= document.getElementById("teacherMgmtView");
const rosterMgrView = document.getElementById("rosterMgmtView");
const teacherContent= document.getElementById("teacherContent");
const rosterContent = document.getElementById("rosterContent");
const resultsMgrView = document.getElementById("resultsMgmtView");
const resultsContent = document.getElementById("resultsContent");

// ── DOM: Student management sub-elements ──────────────────────────
const classListEl       = document.getElementById("classList");
const addClassBtn       = document.getElementById("addClassBtn");
const classNameInput    = document.getElementById("classNameInput");
const classGradeSelect  = document.getElementById("classGradeSelect");
const deleteClassBtn    = document.getElementById("deleteClassBtn");
const studentCountEl    = document.getElementById("studentCount");
const studentMainEmpty  = document.getElementById("studentMainEmpty");
const studentMainContent= document.getElementById("studentMainContent");
const excelPasteArea    = document.getElementById("excelPasteArea");
const parsePasteBtn     = document.getElementById("parsePasteBtn");
const clearPasteBtn     = document.getElementById("clearPasteBtn");
const studentTableBody  = document.getElementById("studentTableBody");
const studentTableEmpty = document.getElementById("studentTableEmpty");
const addStudentRowBtn  = document.getElementById("addStudentRowBtn");
const exportStudentBtn  = document.getElementById("exportStudentXlsxBtn");

// ── DOM: Topbar nav buttons ───────────────────────────────────────
const navButtons = {
  board: navBoardBtn,
  students: document.getElementById("navStudentsBtn"),
  teachers: document.getElementById("navTeachersBtn"),
  rosters:  document.getElementById("navRostersBtn"),
  results:  document.getElementById("navResultsBtn"),
};

// ================================================================
// NAVIGATION STATE
// ================================================================
let activeMainView = "board";
let activeTab = "tab7to9";
let selectedClassId = null;

// Board tab cache
const tabBoardCache = { tab7to9: null, tab10to12: null };
const dirtyTabs     = new Set(["tab7to9","tab10to12"]);
export const invalidateTabs = () => { dirtyTabs.add("tab7to9"); dirtyTabs.add("tab10to12"); };

// ── View switching ─────────────────────────────────────────────────
function setView(view) {
  activeMainView = view;
  const allViews = { board:boardView, groups:groupMgrView, manager:tplMgrView, students:studentMgrView, teachers:teacherMgrView, rosters:rosterMgrView, results:resultsMgrView };
  Object.entries(allViews).forEach(([k, el]) => el?.classList.toggle("hidden", k !== view));
  // Update nav button states
  Object.values(navButtons).forEach(btn => btn?.classList.remove("active"));
  if (view === "board") {
    navBoardBtn?.classList.add("active");
  } else {
    navButtons[view]?.classList.add("active");
  }
  openGroupManagerBtn.textContent    = view === "groups"  ? "보드 보기" : "그룹 관리";
  openTemplateManagerBtn.textContent = view === "manager" ? "보드 보기" : "표 편집";
}

function closeToBoard() { resetDraft(); setView("board"); renderSidebar(); }

// ================================================================
// RENDER
// ================================================================
function renderBoardTab() {
  const tab = activeTab;
  if (!dirtyTabs.has(tab) && tabBoardCache[tab]) { gradeBoard.innerHTML = ""; tabBoardCache[tab].forEach(el => gradeBoard.appendChild(el)); return; }
  const els = buildTabBoard(GRADE_GROUPS[tab], () => { invalidateTabs(); renderBoardTab(); renderSidebar(); });
  gradeBoard.innerHTML = ""; els.forEach(el => gradeBoard.appendChild(el)); tabBoardCache[tab] = els; dirtyTabs.delete(tab);
}

function renderSidebar() {
  // Keep sidebar teacher inputs linked to datalist
  [templateTeacher, sem1Teacher, sem2Teacher].forEach(el => { if (el) el.setAttribute("list", "tpl-teacher-list"); });
  updateTeacherDatalist();
  renderTemplates(templateListEl, {
    onEdit: (id) => fillTemplateForm(id),
    onDelete: (id) => { deleteTemplate(id); invalidateTabs(); renderSidebar(); renderBoardTab(); },
    onCopy: (id) => { copyTemplate(id); invalidateTabs(); renderSidebar(); renderBoardTab(); }
  });
  renderOptionChips(categoryOptionList, "category");
  renderOptionChips(trackOptionList, "track");
  renderOptionChips(groupOptionList, "group");
}

function renderTemplateManagerView() {
  renderTemplateManagerTable(tplMgrTableWrap, tplMgrCount);
}

function renderGroupManagerView() {
  renderGroupManager(groupMgrBoard, () => { renderGroupManagerView(); renderSidebar(); });
}

function renderStudentView() {
  renderClassList(classListEl, selectedClassId, (classId) => {
    selectedClassId = classId;
    const cls = getClassById(classId);
    if (cls) {
      studentMainEmpty?.classList.add("hidden"); studentMainContent?.classList.remove("hidden");
      if (classNameInput)  classNameInput.value   = cls.name;
      if (classGradeSelect) classGradeSelect.value = cls.grade;
    }
    renderStudentTableView();
    renderClassList(classListEl, selectedClassId, arguments.callee);
  });
}

function renderStudentTableView() {
  if (!selectedClassId) return;
  renderStudentTable(studentTableBody, selectedClassId, studentTableEmpty, studentCountEl);
}

// Master render — called on every Firestore update
function render(domain) {
  setControlsDisabled(!canEdit());
  if (domain === "curriculum" || domain === "templates") {
    syncSchoolLevels(); // keep schoolLevel in sync with board placement
    invalidateTabs();
    if (activeMainView === "board") renderBoardTab();
    if (activeMainView === "groups" || activeMainView === "manager" || !domain) renderSidebar();
  }
  if (!domain || domain === "templates") renderSidebar();
  if (activeMainView === "board") renderBoardTab();
  if (activeMainView === "groups") renderGroupManagerView();
  if (activeMainView === "manager") renderTemplateManagerView();
  if (activeMainView === "students") renderStudentView();
  if (activeMainView === "teachers" && teacherContent) renderTeacherView(teacherContent);
  if (activeMainView === "rosters"  && rosterContent)  renderRosterView(rosterContent);
  if (activeMainView === "results"  && resultsContent) renderResultsView(resultsContent);
  renderTabBtns();
}

function renderTabBtns() {
  tab7to9Btn?.classList.toggle("active", activeTab === "tab7to9");
  tab10to12Btn?.classList.toggle("active", activeTab === "tab10to12");
  navBoardBtn?.classList.toggle("active", activeMainView === "board");
}

// ================================================================
// CONTROLS DISABLE/ENABLE
// ================================================================
function setControlsDisabled(disabled) {
  [templateNameKo, templateNameEn, templateTeacher, templateLanguage,
   templateSubmitBtn, templateCancelBtn, templateSepCheck,
   sem1NameKo, sem1NameEn, sem1Teacher, sem2NameKo, sem2NameEn, sem2Teacher,
   categoryOptionInput, trackOptionInput, groupOptionInput,
   addCategoryOptionBtn, addTrackOptionBtn, addGroupOptionBtn,
   resetBoardBtn, exportXlsxBtn, openGroupManagerBtn, openTemplateManagerBtn,
   groupMgrBackBtn, groupMgrAddBtn,
   tplMgrBackBtn, tplMgrAddBtn, tplMgrSaveBtn, tplMgrDiscBtn,
   tplMgrSearch, tplMgrLang, tplMgrSplit, tplMgrSort, tplMgrSortBtn, tplMgrLevel,
   addClassBtn, deleteClassBtn, classNameInput, classGradeSelect,
   parsePasteBtn, clearPasteBtn, addStudentRowBtn, exportStudentBtn
  ].forEach(el => { if (el) el.disabled = disabled; });
}

// ================================================================
// TEMPLATE FORM
// ================================================================
function setLevelPickerActive(level) {
  setTemplateFormSchoolLevel(level);
  levelPicker?.querySelectorAll(".level-btn").forEach(b => b.classList.toggle("active", b.dataset.level === level));
}

function toggleSemesterMode() { semesterFields?.classList.toggle("hidden", !templateSepCheck?.checked); }

function resetTemplateForm() {
  setTemplateEditId(null);
  [templateNameKo, templateNameEn, templateTeacher, sem1NameKo, sem1NameEn, sem1Teacher, sem2NameKo, sem2NameEn, sem2Teacher].forEach(el => { if (el) el.value = ""; });
  if (templateLanguage)  templateLanguage.value  = "Korean";
  if (templateSepCheck)  templateSepCheck.checked = false;
  if (templateSubmitBtn) templateSubmitBtn.textContent = "카드 추가";
  templateCancelBtn?.classList.add("hidden");
  setLevelPickerActive("공통"); toggleSemesterMode();
}

function fillTemplateForm(id) {
  const item = getTemplateById(id); if (!item) return;
  setTemplateEditId(id);
  if (templateNameKo)  templateNameKo.value  = item.nameKo || getSemesterTemplateData(item, "sem1").nameKo;
  if (templateNameEn)  templateNameEn.value  = item.nameEn || getSemesterTemplateData(item, "sem1").nameEn;
  if (templateTeacher) templateTeacher.value = item.teacher || (item.sem1Teacher === item.sem2Teacher ? item.sem1Teacher : "");
  if (templateLanguage)  templateLanguage.value  = item.language;
  if (templateSepCheck)  templateSepCheck.checked = item.useSemesterOverrides;
  if (sem1NameKo)  sem1NameKo.value  = getSemesterTemplateData(item, "sem1").nameKo;
  if (sem1NameEn)  sem1NameEn.value  = getSemesterTemplateData(item, "sem1").nameEn;
  if (sem1Teacher) sem1Teacher.value = getSemesterTemplateData(item, "sem1").teacher;
  if (sem2NameKo)  sem2NameKo.value  = getSemesterTemplateData(item, "sem2").nameKo;
  if (sem2NameEn)  sem2NameEn.value  = getSemesterTemplateData(item, "sem2").nameEn;
  if (sem2Teacher) sem2Teacher.value = getSemesterTemplateData(item, "sem2").teacher;
  if (templateSubmitBtn) templateSubmitBtn.textContent = "카드 수정 저장";
  templateCancelBtn?.classList.remove("hidden");
  setLevelPickerActive(item.schoolLevel || "공통"); toggleSemesterMode();
}

function submitTemplateForm() {
  if (!canEdit()) return;
  const useSep = templateSepCheck?.checked;
  const editId = templateEditId;
  const newId  = editId || `tpl-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
  const data = normalizeTemplate({
    id: newId,
    language: templateLanguage?.value || "Korean",
    useSemesterOverrides: useSep,
    nameKo: templateNameKo?.value || "", nameEn: templateNameEn?.value || "", teacher: templateTeacher?.value || "",
    sem1NameKo: sem1NameKo?.value || "", sem1NameEn: sem1NameEn?.value || "", sem1Teacher: sem1Teacher?.value || "",
    sem2NameKo: sem2NameKo?.value || "", sem2NameEn: sem2NameEn?.value || "", sem2Teacher: sem2Teacher?.value || "",
    schoolLevel: templateFormSchoolLevel
  });
  if (!data.nameKo && !data.nameEn && !(useSep && (data.sem1NameKo || data.sem1NameEn))) {
    alert("한글 이름 또는 영어 이름을 입력해 주세요."); return;
  }
  const prev = getTemplateById(data.id);
  if (prev) data.calcGroupId = prev.calcGroupId || null;
  const tpls = appState.templates.templates;
  const idx = tpls.findIndex(t => t.id === data.id);
  if (idx >= 0) tpls[idx] = data; else tpls.push(data);
  resetDraft(); resetTemplateForm(); scheduleSave("templates"); invalidateTabs(); render();
}

// ================================================================
// AUTH
// ================================================================
function updateAuthUI(user) {
  if (user) {
    authStatusEl && (authStatusEl.textContent = `${user.displayName || user.email || "사용자"} 로그인됨`);
    loginBtn?.classList.add("hidden"); logoutBtn?.classList.remove("hidden");
    document.getElementById("loginOverlay")?.classList.add("hidden");
  } else {
    authStatusEl && (authStatusEl.textContent = "로그인이 필요합니다");
    loginBtn?.classList.remove("hidden"); logoutBtn?.classList.add("hidden");
    document.getElementById("loginOverlay")?.classList.remove("hidden");
  }
}

// ================================================================
// BOOTSTRAP
// ================================================================
setOnUpdate(domain => render(domain));

// Req 2: when table edits happen, sync sidebar + board immediately
setOnTemplateChange(() => {
  updateTeacherDatalist();
  invalidateTabs();
  renderSidebar();
  if (activeMainView === "board")    renderBoardTab();
  if (activeMainView === "manager")  renderTemplateManagerView();
  if (activeMainView === "teachers" && teacherContent) renderTeacherView(teacherContent);
});

// Req 4: sidebar grade chips update on board drag-drop
setOnCurriculumChange(() => {
  renderSidebar();
});

onAuth(async (user) => {
  updateAuthUI(user);
  if (user) {
    await migrateFromLegacy();   // one-time migration from boards/main
    subscribeAll();
  } else {
    unsubscribeAll();
    render();
  }
});

// ================================================================
// EVENT LISTENERS
// ================================================================

// ── Auth ──────────────────────────────────────────────────────────
loginBtn?.addEventListener("click", login);
logoutBtn?.addEventListener("click", logout);
exportXlsxBtn?.addEventListener("click", () => exportXLSX(activeTab));

resetBoardBtn?.addEventListener("click", async () => {
  if (!canEdit()) return;
  if (!confirm("커리큘럼 보드를 초기화할까요? (과목카드/학생 데이터는 유지됩니다)")) return;
  const opts = { category:["교과","창체"], track:["공통","배정","선택"], group:["선택","국어","영어","수학","사회","과학","정보","예술","체육","자율활동","동아리","채플","기타"] };
  const gradeBoards = {};
  const GK = ["7학년","8학년","9학년","10학년","11학년","12학년"];
  GK.forEach(g => { gradeBoards[g] = Array.from({ length:4 }, () => ({ id:`row-${Date.now()}-${Math.random().toString(36).slice(2,9)}`, category:opts.category[0], track:opts.track[0], group:opts.group[0], credits:"", sem1TemplateId:null, sem2TemplateId:null })); });
  appState.curriculum = { options:opts, gradeBoards };
  invalidateTabs(); await saveNow("curriculum"); render();
});

// ── Tabs ──────────────────────────────────────────────────────────
tab7to9Btn?.addEventListener("click",   () => { if (activeTab === "tab7to9")   return; activeTab = "tab7to9";   renderTabBtns(); renderBoardTab(); });
tab10to12Btn?.addEventListener("click", () => { if (activeTab === "tab10to12") return; activeTab = "tab10to12"; renderTabBtns(); renderBoardTab(); });

// ── Nav buttons ───────────────────────────────────────────────────
navButtons.board?.addEventListener("click", () => { resetDraft(); setView("board"); renderBoardTab(); renderSidebar(); });

navButtons.students?.addEventListener("click", () => {
  setView("students"); selectedClassId = null;
  studentMainEmpty?.classList.remove("hidden"); studentMainContent?.classList.add("hidden");
  renderStudentView();
});

navButtons.teachers?.addEventListener("click", () => {
  setView("teachers"); if (teacherContent) renderTeacherView(teacherContent);
});

navButtons.rosters?.addEventListener("click", () => {
  setView("rosters"); if (rosterContent) renderRosterView(rosterContent);
});

navButtons.results?.addEventListener("click", () => {
  setView("results"); if (resultsContent) renderResultsView(resultsContent);
});

// ── Sidebar view toggles ──────────────────────────────────────────
openGroupManagerBtn?.addEventListener("click", () => { activeMainView === "groups" ? closeToBoard() : (setView("groups"), renderGroupManagerView()); });
openTemplateManagerBtn?.addEventListener("click", () => { activeMainView === "manager" ? closeToBoard() : (clearStableOrder(), setView("manager"), renderTemplateManagerView()); });
groupMgrBackBtn?.addEventListener("click", closeToBoard);
tplMgrBackBtn?.addEventListener("click", closeToBoard);
groupMgrAddBtn?.addEventListener("click", () => { addLiveTemplateGroup(); renderGroupManagerView(); renderSidebar(); });

// ── Sidebar level filter ──────────────────────────────────────────
sidebarLevelFilter?.addEventListener("change", e => { setSidebarLevel(e.target.value); renderSidebar(); });

// ── Template form ─────────────────────────────────────────────────
templateSubmitBtn?.addEventListener("click", submitTemplateForm);
templateCancelBtn?.addEventListener("click", resetTemplateForm);
templateSepCheck?.addEventListener("change", () => {
  if (templateSepCheck.checked && [sem1NameKo, sem1NameEn, sem1Teacher, sem2NameKo, sem2NameEn, sem2Teacher].every(el => !el?.value)) {
    const ko = templateNameKo?.value, en = templateNameEn?.value, te = templateTeacher?.value;
    [sem1NameKo, sem2NameKo].forEach(el => { if (el && !el.value) el.value = ko; });
    [sem1NameEn, sem2NameEn].forEach(el => { if (el && !el.value) el.value = en; });
    [sem1Teacher, sem2Teacher].forEach(el => { if (el && !el.value) el.value = te; });
  }
  toggleSemesterMode();
});
levelPicker?.addEventListener("click", e => { const btn = e.target.closest(".level-btn"); if (btn) setLevelPickerActive(btn.dataset.level); });
[templateNameKo, templateNameEn, templateTeacher, sem1NameKo, sem1NameEn, sem1Teacher, sem2NameKo, sem2NameEn, sem2Teacher].forEach(el => el?.addEventListener("keydown", e => { if (e.key === "Enter") submitTemplateForm(); }));

// ── Options ───────────────────────────────────────────────────────
addCategoryOptionBtn?.addEventListener("click", () => { addOption("category", categoryOptionInput?.value); if (categoryOptionInput) categoryOptionInput.value = ""; invalidateTabs(); render(); });
addTrackOptionBtn?.addEventListener("click",    () => { addOption("track",    trackOptionInput?.value);    if (trackOptionInput)    trackOptionInput.value    = ""; invalidateTabs(); render(); });
addGroupOptionBtn?.addEventListener("click",    () => { addOption("group",    groupOptionInput?.value);    if (groupOptionInput)    groupOptionInput.value    = ""; invalidateTabs(); render(); });
[[categoryOptionInput, addCategoryOptionBtn],[trackOptionInput, addTrackOptionBtn],[groupOptionInput, addGroupOptionBtn]].forEach(([inp, btn]) => inp?.addEventListener("keydown", e => { if (e.key === "Enter") btn?.click(); }));

// ── Template manager ──────────────────────────────────────────────
tplMgrAddBtn?.addEventListener("click", () => { addTemplateManagerRow(); renderTemplateManagerView(); });
tplMgrDiscBtn?.addEventListener("click", () => { if (!canEdit()) return; renderTemplateManagerView(); renderSidebar(); });
tplMgrSaveBtn?.addEventListener("click", async () => { await commitDraft(); invalidateTabs(); render(); });
tplMgrSearch?.addEventListener("input", e => { managerUi.search = e.target.value; clearStableOrder(); renderTemplateManagerView(); });
tplMgrLang?.addEventListener("change",  e => { managerUi.language = e.target.value; clearStableOrder(); renderTemplateManagerView(); });
tplMgrSplit?.addEventListener("change", e => { managerUi.split = e.target.value; clearStableOrder(); renderTemplateManagerView(); });
tplMgrSort?.addEventListener("change",  e => { managerUi.sort = e.target.value; /* apply only on button click */ });
tplMgrLevel?.addEventListener("change", e => { managerUi.level = e.target.value; clearStableOrder(); renderTemplateManagerView(); });
tplMgrSortBtn?.addEventListener("click", () => { clearStableOrder(); renderTemplateManagerView(); });
tplMgrTableWrap?.addEventListener("input",  e => handleTableInput(e));
tplMgrTableWrap?.addEventListener("change", e => handleTableChange(e, renderTemplateManagerView));
tplMgrTableWrap?.addEventListener("click",  e => handleTableDeleteClick(e, renderTemplateManagerView));

// ── Template manager paste ────────────────────────────────────────
const tplPasteArea    = document.getElementById("tplPasteArea");
const tplPasteBtn     = document.getElementById("tplPasteBtn");
const tplPasteClearBtn= document.getElementById("tplPasteClearBtn");

tplPasteBtn?.addEventListener("click", () => {
  if (!canEdit()) return;
  const raw = tplPasteArea?.value.trim();
  if (!raw) { alert("붙여넣기 영역이 비어 있습니다."); return; }
  const parsed = parseTemplatePaste(raw);
  if (!parsed.length) { alert("파싱된 과목카드가 없습니다.\n첫 번째 열에 한글 이름이 있는지 확인하세요."); return; }
  const added = addParsedTemplates(parsed);
  if (tplPasteArea) tplPasteArea.value = "";
  document.getElementById("tplMgrPasteDetails")?.removeAttribute("open");
  renderTemplateManagerView();
  renderSidebar();
  alert(`${added}개 과목카드가 추가되었습니다.`);
});
tplPasteClearBtn?.addEventListener("click", () => { if (tplPasteArea) tplPasteArea.value = ""; });

// ── Student management ────────────────────────────────────────────
addClassBtn?.addEventListener("click", () => {
  const cls = addNewClass(); if (!cls) return;
  selectedClassId = cls.id;
  studentMainEmpty?.classList.add("hidden"); studentMainContent?.classList.remove("hidden");
  if (classNameInput) classNameInput.value = cls.name;
  if (classGradeSelect) classGradeSelect.value = cls.grade;
  renderStudentView(); renderStudentTableView();
  setTimeout(() => { classNameInput?.focus(); classNameInput?.select(); }, 50);
});

deleteClassBtn?.addEventListener("click", () => {
  if (deleteClass(selectedClassId)) { selectedClassId = null; studentMainEmpty?.classList.remove("hidden"); studentMainContent?.classList.add("hidden"); renderStudentView(); }
});

classNameInput?.addEventListener("change", e => { updateClass(selectedClassId, "name", e.target.value); renderStudentView(); });
classGradeSelect?.addEventListener("change", e => { updateClass(selectedClassId, "grade", e.target.value); renderStudentView(); });

parsePasteBtn?.addEventListener("click", () => {
  const raw = excelPasteArea?.value.trim();
  if (!raw) { alert("붙여넣기 영역이 비어 있습니다."); return; }
  const cls = getClassById(selectedClassId); if (!cls) { alert("반을 먼저 선택해 주세요."); return; }
  const parsed = parseExcelPaste(raw);
  if (!parsed.length) { alert("파싱된 학생이 없습니다.\n엑셀에서 이름이 포함된 셀을 복사해 붙여넣기 해주세요."); return; }
  parsed.forEach(s => { cls.students.push(s); }); scheduleSave("classes");
  if (excelPasteArea) excelPasteArea.value = "";
  renderStudentTableView(); renderStudentView();
  alert(`${parsed.length}명이 추가되었습니다.`);
});

clearPasteBtn?.addEventListener("click", () => { if (excelPasteArea) excelPasteArea.value = ""; });

addStudentRowBtn?.addEventListener("click", () => {
  const s = addStudentToClass(selectedClassId); if (!s) return;
  renderStudentTableView(); renderStudentView();
  setTimeout(() => {
    const rows = studentTableBody?.querySelectorAll("tr");
    const last = rows?.[rows.length - 1];
    last?.scrollIntoView({ behavior:"smooth", block:"nearest" }); last?.querySelector("input")?.focus();
  }, 50);
});

exportStudentBtn?.addEventListener("click", () => exportStudentXlsx(selectedClassId));

// ── Initial render ────────────────────────────────────────────────
setView("board");
render();
