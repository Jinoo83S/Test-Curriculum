// ================================================================
// app.js · Main Entry: Auth + Navigation + Events
// ================================================================
import { auth, GRADE_GROUPS } from "./config.js";
import { login, logout, onAuth, canEdit } from "./auth.js";
import { appState, subscribeDomains, unsubscribeDomains, unsubscribeAll, setOnUpdate, scheduleSave, saveNow, migrateFromLegacy, initialLoad, setOnSaveStatus,
         isAutoSaveEnabled, setAutoSaveEnabled, getDirtyDomains, savePendingNow,
         exportLocalSnapshot, importLocalSnapshot, resetLocalSnapshot, exportFirestoreDiagnosticSnapshot } from "./state.js";
import { LOCAL_DEV_MODE } from "./local-dev.js";
import { openDataCleanupDialog } from "./data-cleanup.js";
import { openFirestoreUsageDialog } from "./firestore-usage.js";

// ── Curriculum imports ────────────────────────────────────────────
import { buildTabBoard, renderOptionChips, exportXLSX, addOption, removeOption, setOnCurriculumChange, openTemplateCardPopup } from "./curriculum.js?v=compound_subject_card";

// ── Template imports ──────────────────────────────────────────────
import {
  renderTemplates, renderTemplateManagerTable, handleTableInput, handleTableChange, handleTableDeleteClick,
  addTemplateManagerRow, getOrCreateDraft, resetDraft, commitDraft,
  deleteTemplate, addLiveTemplateGroup,
  templateEditId, templateFormSchoolLevel,
  setTemplateEditId, setTemplateFormSchoolLevel,
  getTemplateById, getSemesterTemplateData,
  getTemplateCardTitle, managerUi,
  setSidebarLevel,
  copyTemplate, setOnTemplateChange, updateTeacherDatalist, syncSchoolLevels,
  clearStableOrder, parseTemplatePaste, addParsedTemplates
} from "./templates.js";
import { normalizeTemplate } from "./state.js";

const APP_MODULE_VERSION = "roster_common_auto_syntax_fix";

// ── Lazy-loaded view modules ──────────────────────────────────────
// Initial curriculum board keeps only curriculum/templates in the startup bundle.
// Other screens are downloaded when the user actually opens that menu.
const lazyModules = {};
function lazyImport(key, path) {
  const versionedPath = path.includes("?") ? `${path}&v=${APP_MODULE_VERSION}` : `${path}?v=${APP_MODULE_VERSION}`;
  return lazyModules[key] || (lazyModules[key] = import(versionedPath));
}
const loadStudents     = () => lazyImport("students", "./students.js");
const loadTeachers     = () => lazyImport("teachers", "./teachers.js");
const loadRosters      = () => lazyImport("rosters", "./rosters.js");
const loadResults      = () => lazyImport("results", "./results.js");
const loadTtCards      = () => lazyImport("ttcards", "./ttcards.js");
const loadSubjectSetup = () => lazyImport("subjectSetup", "./subject-setup.js");
const loadRooms        = () => lazyImport("rooms", "./rooms.js?v=rooms_fullpage_restore");

// ── DOM: Topbar ───────────────────────────────────────────────────
const authStatusEl     = document.getElementById("authStatus");
const loginBtn         = document.getElementById("loginBtn");
const logoutBtn        = document.getElementById("logoutBtn"); // legacy placeholder: previous pages may still contain it.
let currentAuthUser = null;
const resetBoardBtn    = document.getElementById("resetBoardBtn");
const exportXlsxBtn    = document.getElementById("exportXlsxBtn");

// ── DOM: Sidebar ──────────────────────────────────────────────────
const templateListEl        = document.getElementById("templateList");
const sidebarTemplateAddBtn = document.getElementById("sidebarTemplateAddBtn");
const sidebarLevelFilter    = document.getElementById("sidebarSchoolLevelFilter");
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
const roomMgrView   = document.getElementById("roomMgmtView");
const rosterMgrView = document.getElementById("rosterMgmtView");
const teacherContent= document.getElementById("teacherContent");
const roomContent   = document.getElementById("roomContent");
const rosterContent = document.getElementById("rosterContent");
const resultsMgrView = document.getElementById("resultsMgmtView");
const resultsContent = document.getElementById("resultsContent");
const ttCardsMgrView  = document.getElementById("ttCardsMgmtView");
const ttCardsContent  = document.getElementById("ttCardsContent");
const subjectSetupMgrView = document.getElementById("subjectSetupView");
const subjectSetupContent = document.getElementById("subjectSetupContent");

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

// ── DOM: Board tab buttons ───────────────────────────────────────
// 분리된 페이지(roster/setup/prework/results)에는 이 버튼들이 없으므로
// 반드시 명시적으로 null-safe DOM 참조를 만들어야 합니다.
// 선언이 없으면 해당 페이지에서 ReferenceError가 발생해 하단 서브메뉴 클릭 이벤트가 등록되지 않습니다.
const tab7to9Btn   = document.getElementById("tab7to9Btn");
const tab10to12Btn = document.getElementById("tab10to12Btn");

// ── DOM: Topbar nav buttons ───────────────────────────────────────
const navManagerBtn = document.getElementById("navManagerBtn");
const navButtons = {
  board:        navBoardBtn,
  students:     document.getElementById("navStudentsBtn"),
  teachers:     document.getElementById("navTeachersBtn"),
  rooms:        document.getElementById("navRoomsBtn"),
  subjectsetup: document.getElementById("navSubjectSetupBtn"),
  rosters:      document.getElementById("navRostersBtn"),
  ttcards:      document.getElementById("navTtCardsBtn"),
  groups:       document.getElementById("navGroupsBtn"),
  results:      document.getElementById("navResultsBtn"),
};

// ── 2단 네비게이션 ──────────────────────────────────────────────
const SECTION_DEFAULT_VIEW = {
  curriculum: "board",
  roster:     "teachers",
  setup:      "subjectsetup",
  prework:    "ttcards",
  results:    "results",
};
const VIEW_TO_SECTION = {
  board:"curriculum", manager:"curriculum",
  teachers:"roster",  students:"roster", rooms:"roster",
  subjectsetup:"setup", rosters:"setup",
  ttcards:"prework",  groups:"prework",
  results:"results",
};
const INITIAL_VIEW = document.body?.dataset.initialView || "board";
let activeSection = document.body?.dataset.section || VIEW_TO_SECTION[INITIAL_VIEW] || "curriculum";

function activateSection(section) {
  activeSection = section;
  document.querySelectorAll("#topbarMainNav [data-section]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.section === section);
  });
  document.querySelectorAll(".sub-nav-group").forEach(g => {
    g.classList.toggle("hidden", g.dataset.section !== section);
  });
}

function activateSubBtn(view) {
  const idMap = {
    board:"navBoardBtn", manager:"navManagerBtn", teachers:"navTeachersBtn",
    students:"navStudentsBtn", rooms:"navRoomsBtn", subjectsetup:"navSubjectSetupBtn", rosters:"navRostersBtn",
    ttcards:"navTtCardsBtn", groups:"navGroupsBtn", results:"navResultsBtn",
  };
  document.querySelectorAll(".sub-nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.id === idMap[view]);
  });
}

// 1단 메인 섹션 클릭
document.querySelectorAll("#topbarMainNav [data-section]").forEach(mainBtn => {
  if (mainBtn.tagName === "A") return;
  mainBtn.addEventListener("click", () => {
    const section = mainBtn.dataset.section;
    activateSection(section);
    navigateTo(SECTION_DEFAULT_VIEW[section]);
  });
});

// ================================================================
// NAVIGATION STATE
// ================================================================
let activeMainView = INITIAL_VIEW;
let activeTab = "tab7to9";
let selectedClassId = null;


// ── Phase 2: view-scoped Firestore subscriptions ─────────────────
// 화면별로 필요한 Firestore 도메인만 실시간 구독합니다.
// appState에는 마지막으로 읽은 값이 남아 있으므로, 화면 전환 시 필요한 도메인만 다시 붙입니다.
const VIEW_DOMAIN_SETS = {
  board:        ["curriculum", "templates", "teachers"],
  manager:      ["curriculum", "templates", "teachers"],
  teachers:     ["templates", "teachers"],
  students:     ["classes", "rosters"],
  rooms:        ["rooms", "teachers", "classes"],
  subjectsetup: ["curriculum", "templates", "rosters"],
  rosters:      ["curriculum", "templates", "classes", "rosters"],
  ttcards:      ["curriculum", "templates", "classes", "rosters", "timetable"],
  groups:       ["curriculum", "templates", "classes", "rosters", "timetable"],
  results:      ["curriculum", "templates", "rosters"],
};

let activeDomainSubscriptions = new Set();

function domainsForView(view) {
  return VIEW_DOMAIN_SETS[view] || VIEW_DOMAIN_SETS.board;
}

function waitForDomainsLoaded(domains, timeoutMs = 7000) {
  const list = [...new Set(domains || [])];
  if (!list.length || list.every(d => initialLoad[d])) return Promise.resolve(true);
  return new Promise(resolve => {
    const started = Date.now();
    const timer = setInterval(() => {
      const done = list.every(d => initialLoad[d]);
      const timedOut = Date.now() - started > timeoutMs;
      if (done || timedOut) {
        clearInterval(timer);
        resolve(done);
      }
    }, 50);
  });
}

function syncDomainSubscriptionsForView(view) {
  if (!canEdit()) return;
  const desired = new Set(domainsForView(view));
  const toRemove = [...activeDomainSubscriptions].filter(d => !desired.has(d));
  const toAdd = [...desired].filter(d => !activeDomainSubscriptions.has(d));

  if (toRemove.length) {
    unsubscribeDomains(toRemove);
    toRemove.forEach(d => activeDomainSubscriptions.delete(d));
  }
  if (toAdd.length) {
    // subscribeDomains는 이미 구독 중인 도메인은 건너뛰므로 전체 desired를 넘겨도 안전합니다.
    subscribeDomains([...desired]);
    toAdd.forEach(d => activeDomainSubscriptions.add(d));
  }
}

async function ensureDomains(domains) {
  if (!canEdit()) return false;
  const desired = new Set([...activeDomainSubscriptions, ...(domains || [])]);
  const toAdd = [...desired].filter(d => !activeDomainSubscriptions.has(d));
  if (toAdd.length) {
    subscribeDomains([...desired]);
    toAdd.forEach(d => activeDomainSubscriptions.add(d));
  }
  return waitForDomainsLoaded(domains);
}

// Board tab cache
const tabBoardCache = { tab7to9: null, tab10to12: null };
const dirtyTabs     = new Set(["tab7to9","tab10to12"]);
export const invalidateTabs = () => { dirtyTabs.add("tab7to9"); dirtyTabs.add("tab10to12"); };

// ── View switching ─────────────────────────────────────────────────
async function navigateTo(view) {
  setView(view);
  syncDomainSubscriptionsForView(view);
  const section = VIEW_TO_SECTION[view] || activeSection;
  activateSection(section);
  activateSubBtn(view);

  // 화면 분리 후에는 현재 화면에 필요한 도메인이 아직 로드되지 않은 상태에서
  // 먼저 렌더링되어 빈 화면처럼 보일 수 있습니다. 필요한 구독이 붙은 뒤 한 번 더 렌더링합니다.
  await waitForDomainsLoaded(domainsForView(view), 7000);

  // Render
  if (view === "board") { renderBoardTab(); renderSidebar(); }
  else if (view === "manager") { clearStableOrder(); renderTemplateManagerView(); renderSidebar(); }
  else if (view === "students") { selectedClassId = null; await renderStudentView(); }
  else if (view === "teachers")     await renderTeacherPanel();
  else if (view === "rooms")        await renderRoomsPanel();
  else if (view === "rosters")      await renderRosterPanel();
  else if (view === "subjectsetup") await renderSubjectSetupPanel();
  else if (view === "ttcards")      await renderTtCardsPanel();
  else if (view === "groups")       await renderGroupManagerView();
  else if (view === "results")      await renderResultsPanel();
}

function setView(view) {
  activeMainView = view;
  const allViews = {
    board:        boardView,        groups:  groupMgrView,      manager: tplMgrView,
    students:     studentMgrView,   teachers:teacherMgrView,    rooms: roomMgrView,
    rosters: rosterMgrView,
    results:      resultsMgrView,   ttcards: ttCardsMgrView,    subjectsetup: subjectSetupMgrView,
  };
  Object.entries(allViews).forEach(([k, el]) => el?.classList.toggle("hidden", k !== view));
}

function closeToBoard() {
  resetDraft();
  setView("board");
  invalidateTabs();
  renderSidebar();
  renderBoardTab();
}

// ================================================================
// RENDER
// ================================================================
function renderBoardTab() {
  if (!gradeBoard) return;
  const tab = activeTab;
  if (!dirtyTabs.has(tab) && tabBoardCache[tab]) { gradeBoard.innerHTML = ""; tabBoardCache[tab].forEach(el => gradeBoard.appendChild(el)); return; }
  const els = buildTabBoard(GRADE_GROUPS[tab], () => { invalidateTabs(); renderBoardTab(); renderSidebar(); });
  gradeBoard.innerHTML = ""; els.forEach(el => gradeBoard.appendChild(el)); tabBoardCache[tab] = els; dirtyTabs.delete(tab);
}

function renderSidebar() {
  if (!templateListEl) return;
  // Keep sidebar teacher inputs linked to datalist
  [templateTeacher, sem1Teacher, sem2Teacher].forEach(el => { if (el) el.setAttribute("list", "tpl-teacher-list"); });
  updateTeacherDatalist();
  renderTemplates(templateListEl, {
    onEdit: (id) => openTemplateCardPopup(id),
    // 과목 삭제는 수강명단/시간표 카드/시간표 배치까지 정리해야 하므로
    // 삭제 직전에 관련 도메인을 확실히 불러온 뒤 실행합니다.
    onDelete: async (id) => {
      await ensureDomains(["rosters", "timetable"]);
      deleteTemplate(id);
      invalidateTabs(); renderSidebar(); renderBoardTab();
    },
    onCopy: (id) => { copyTemplate(id); invalidateTabs(); renderSidebar(); renderBoardTab(); }
  });
  renderOptionChips(categoryOptionList, "category");
  renderOptionChips(trackOptionList, "track");
  renderOptionChips(groupOptionList, "group");
}

function renderTemplateManagerView() {
  renderTemplateManagerLevelTabs();
  renderTemplateManagerTable(tplMgrTableWrap, tplMgrCount);
}

function renderTemplateManagerLevelTabs() {
  if (!tplMgrView) return;
  let tabs = document.getElementById("templateManagerLevelTabs");
  if (!tabs) {
    tabs = document.createElement("div");
    tabs.id = "templateManagerLevelTabs";
    tabs.className = "tpl-manager-level-tabs";
  }

  // 과목카드 표 편집의 과정 탭은 제목 오른쪽 여백에 고정합니다.
  // 기존처럼 toolbar 위에 삽입하면 검색/필터 영역과 붙어 보여 위치가 어색했습니다.
  const header  = tplMgrView.querySelector(".manager-header");
  const actions = tplMgrView.querySelector(".manager-actions");
  const toolbar = tplMgrView.querySelector(".manager-toolbar");
  if (header) {
    if (tabs.parentElement !== header) header.insertBefore(tabs, actions || null);
  } else if (tabs.parentElement !== (toolbar?.parentNode || tplMgrView)) {
    (toolbar?.parentNode || tplMgrView).insertBefore(tabs, toolbar || tplMgrView.firstChild);
  }

  const items = [
    { value: "전체", title: "전체" },
    { value: "중등", title: "중등" },
    { value: "고등", title: "고등" },
  ];

  tabs.innerHTML = items.map(item => `
    <button type="button" class="tpl-manager-level-tab ${managerUi.level === item.value ? "active" : ""}" data-level="${item.value}">
      <strong>${item.title}</strong>
    </button>
  `).join("");

  tabs.querySelectorAll("button[data-level]").forEach(btn => {
    btn.addEventListener("click", () => {
      const level = btn.dataset.level || "전체";
      if (managerUi.level === level) return;
      managerUi.level = level;
      if (tplMgrLevel) tplMgrLevel.value = level;
      clearStableOrder();
      renderTemplateManagerView();
    });
  });

  if (tplMgrLevel && tplMgrLevel.value !== managerUi.level) {
    tplMgrLevel.value = managerUi.level;
  }
}

async function renderTeacherPanel() {
  if (activeMainView !== "teachers" || !teacherContent) return;
  const { renderTeacherView } = await loadTeachers();
  if (activeMainView === "teachers") renderTeacherView(teacherContent);
}

async function renderRosterPanel() {
  if (activeMainView !== "rosters" || !rosterContent) return;
  const { renderRosterView } = await loadRosters();
  if (activeMainView === "rosters") renderRosterView(rosterContent);
}

async function renderRoomsPanel() {
  if (activeMainView !== "rooms" || !roomContent) return;
  const { renderRoomsView } = await loadRooms();
  const teacherNames = [...new Set((appState.teachers?.teachers || [])
    .map(t => String(t.name || "").trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  if (activeMainView === "rooms") {
    renderRoomsView(roomContent, () => void renderRoomsPanel(), { teacherNames });
  }
}

async function renderResultsPanel() {
  if (activeMainView !== "results" || !resultsContent) return;
  const { renderResultsView } = await loadResults();
  if (activeMainView === "results") renderResultsView(resultsContent);
}

async function renderTtCardsPanel() {
  if (activeMainView !== "ttcards" || !ttCardsContent) return;
  const { renderTtCardsView } = await loadTtCards();
  if (activeMainView === "ttcards") renderTtCardsView(ttCardsContent);
}

async function renderSubjectSetupPanel() {
  if (activeMainView !== "subjectsetup" || !subjectSetupContent) return;
  const { renderSubjectSetupView } = await loadSubjectSetup();
  if (activeMainView === "subjectsetup") renderSubjectSetupView(subjectSetupContent);
}

async function renderGroupManagerView() {
  if (activeMainView !== "groups" || !groupMgrBoard) return;
  const { renderGroupManagerView: renderGroupMgrFromTtCards } = await loadTtCards();
  if (activeMainView === "groups") renderGroupMgrFromTtCards(groupMgrBoard);
}

async function renderStudentView() {
  if (activeMainView !== "students") return;
  const { renderClassList, getClassById } = await loadStudents();
  if (activeMainView !== "students") return;
  function handleClassSelect(classId) {
    selectedClassId = classId;
    const cls = getClassById(classId);
    if (cls) {
      studentMainEmpty?.classList.add("hidden"); studentMainContent?.classList.remove("hidden");
      if (classNameInput)  classNameInput.value   = cls.name;
      if (classGradeSelect) classGradeSelect.value = cls.grade;
    }
    void renderStudentTableView();
    if (classListEl) renderClassList(classListEl, selectedClassId, handleClassSelect);
  }
  if (classListEl) renderClassList(classListEl, selectedClassId, handleClassSelect);
}

async function renderStudentTableView() {
  if (!selectedClassId || activeMainView !== "students") return;
  const { renderStudentTable } = await loadStudents();
  if (activeMainView === "students") {
    renderStudentTable(studentTableBody, selectedClassId, studentTableEmpty, studentCountEl);
  }
}

// Master render — called on every Firestore update
function render(domain) {
  setControlsDisabled(!canEdit());

  const changedDomains = domain instanceof Set
    ? domain
    : Array.isArray(domain)
      ? new Set(domain)
      : new Set(domain ? [domain] : []);
  const fullRender = !domain || changedDomains.has("__all__") || changedDomains.has("all");
  const changed = d => fullRender || changedDomains.has(d);
  const boardDataChanged = fullRender || changed("curriculum") || changed("templates");

  // Curriculum board uses a DOM cache. If curriculum/templates arrive together with
  // other Firestore snapshots, the old single-domain debounce could keep the initial
  // empty board cache. Always invalidate when either board source changed.
  if (boardDataChanged) {
    syncSchoolLevels();
    invalidateTabs();
  }

  // Sidebar cards depend on templates and also on curriculum placement chips.
  // Render it whenever those domains changed, or when the current view needs it.
  if (fullRender || changed("curriculum") || changed("templates") || changed("teachers") ||
      activeMainView === "groups" || activeMainView === "manager") {
    renderSidebar();
  }

  if (activeMainView === "board") renderBoardTab();
  if (activeMainView === "groups")       void renderGroupManagerView();
  if (activeMainView === "manager")      renderTemplateManagerView();
  if (activeMainView === "students")     void renderStudentView();
  if (activeMainView === "teachers")     void renderTeacherPanel();
  if (activeMainView === "rooms")        void renderRoomsPanel();
  if (activeMainView === "rosters")      void renderRosterPanel();
  if (activeMainView === "results")      void renderResultsPanel();
  if (activeMainView === "subjectsetup") void renderSubjectSetupPanel();
  if (activeMainView === "ttcards")      void renderTtCardsPanel();
  renderTabBtns();
}

function renderTabBtns() {
  tab7to9Btn?.classList.toggle("active", activeTab === "tab7to9");
  tab10to12Btn?.classList.toggle("active", activeTab === "tab10to12");
  activateSection(VIEW_TO_SECTION[activeMainView] || activeSection);
  activateSubBtn(activeMainView);
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
   resetBoardBtn, exportXlsxBtn,
   groupMgrAddBtn,
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
  if (prev) {
    data.calcGroupId = prev.calcGroupId || null;
    data.isCompound = !!prev.isCompound;
    data.compoundParts = Array.isArray(prev.compoundParts) ? prev.compoundParts : [];
  }
  const tpls = appState.templates.templates;
  const idx = tpls.findIndex(t => t.id === data.id);
  if (idx >= 0) tpls[idx] = data; else tpls.push(data);
  resetDraft(); resetTemplateForm(); scheduleSave("templates"); invalidateTabs(); render();
}

// ================================================================
// AUTH
// ================================================================
const AUTH_SESSION_KEY = "his_auth_recent_user_v1";
const AUTH_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
let authResolved = false;

function readRecentAuthSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.ts || Date.now() - data.ts > AUTH_SESSION_MAX_AGE_MS) {
      sessionStorage.removeItem(AUTH_SESSION_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function writeRecentAuthSession(user) {
  try {
    if (!user) {
      sessionStorage.removeItem(AUTH_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
      ts: Date.now(),
      label: user.displayName || user.email || "사용자"
    }));
  } catch {
    // sessionStorage가 막힌 환경에서도 앱은 계속 동작해야 합니다.
  }
}

function setAuthCheckingUI() {
  const recent = readRecentAuthSession();
  currentAuthUser = null;
  if (authStatusEl) authStatusEl.textContent = recent?.label ? `${recent.label} 로그인 확인 중…` : "로그인 확인 중…";
  if (loginBtn) {
    loginBtn.textContent = "로그인 확인 중…";
    loginBtn.disabled = true;
    loginBtn.classList.remove("hidden");
    loginBtn.classList.add("primary-btn");
    loginBtn.classList.remove("secondary-btn");
  }
  // 이전 HTML에 남아 있는 로그아웃 버튼은 항상 숨깁니다. 로그인/로그아웃은 loginBtn 하나만 사용합니다.
  logoutBtn?.classList.add("hidden");
  document.getElementById("loginOverlay")?.classList.add("hidden");
}

function updateAuthUI(user) {
  authResolved = true;
  currentAuthUser = user || null;
  writeRecentAuthSession(user);

  if (loginBtn) {
    loginBtn.disabled = false;
    loginBtn.classList.remove("hidden");
    loginBtn.textContent = user ? "로그아웃" : "Google 로그인";
    loginBtn.title = user ? "현재 계정에서 로그아웃합니다." : "Google 계정으로 로그인합니다.";
    loginBtn.classList.toggle("primary-btn", !user);
    loginBtn.classList.toggle("secondary-btn", !!user);
  }
  logoutBtn?.classList.add("hidden");

  if (user) {
    authStatusEl && (authStatusEl.textContent = `${user.displayName || user.email || "사용자"} 로그인됨`);
    document.getElementById("loginOverlay")?.classList.add("hidden");
  } else {
    authStatusEl && (authStatusEl.textContent = "로그인이 필요합니다");
    document.getElementById("loginOverlay")?.classList.remove("hidden");
  }
}

// ================================================================
// BOOTSTRAP
// ================================================================
// ── Sidebar toggle / resize ──────────────────────────────────────
const sidebarToggleBtn = document.getElementById("appSidebarToggle");
let sidebarFloatingToggleBtn = document.getElementById("appSidebarFloatingToggle");
const sidebarResizer = document.getElementById("appSidebarResizer");
const pageEl = document.querySelector(".page");
const sidebarEl = document.getElementById("appSidebar");

// 사이드바를 접은 뒤에도 다시 펼칠 수 있도록 플로팅 버튼을 자동 생성합니다.
// 분리된 HTML 파일에서 버튼 누락이 있어도 안전하게 동작합니다.
if (!sidebarFloatingToggleBtn && pageEl && sidebarEl) {
  sidebarFloatingToggleBtn = document.createElement("button");
  sidebarFloatingToggleBtn.id = "appSidebarFloatingToggle";
  sidebarFloatingToggleBtn.type = "button";
  sidebarFloatingToggleBtn.className = "sidebar-floating-toggle hidden";
  sidebarFloatingToggleBtn.textContent = "▶";
  sidebarFloatingToggleBtn.title = "사이드바 펼치기";
  document.body.appendChild(sidebarFloatingToggleBtn);
}
let sidebarWidth = parseInt(localStorage.getItem("cur_sbW") || "320", 10);
if (!Number.isFinite(sidebarWidth)) sidebarWidth = 320;
sidebarWidth = Math.max(220, Math.min(520, sidebarWidth));

function applySidebarState(hidden = pageEl?.classList.contains("sidebar-hidden")) {
  if (!pageEl) return;
  pageEl.style.setProperty("--sidebar-width", hidden ? "0px" : `${sidebarWidth}px`);
  pageEl.classList.toggle("sidebar-hidden", !!hidden);
  if (sidebarToggleBtn) {
    sidebarToggleBtn.textContent = hidden ? "▶" : "◀";
    sidebarToggleBtn.title = hidden ? "사이드바 펼치기" : "사이드바 접기";
  }
  if (sidebarFloatingToggleBtn) {
    sidebarFloatingToggleBtn.classList.toggle("hidden", !hidden);
    sidebarFloatingToggleBtn.textContent = "▶";
    sidebarFloatingToggleBtn.title = "사이드바 펼치기";
  }
}

function toggleSidebar() {
  applySidebarState(!pageEl?.classList.contains("sidebar-hidden"));
}

sidebarToggleBtn?.addEventListener("click", toggleSidebar);
sidebarFloatingToggleBtn?.addEventListener("click", toggleSidebar);

sidebarResizer?.addEventListener("mousedown", e => {
  if (!pageEl || pageEl.classList.contains("sidebar-hidden")) return;
  e.preventDefault();
  const x0 = e.clientX;
  const w0 = sidebarEl?.getBoundingClientRect().width || sidebarWidth;
  const onMove = ev => {
    sidebarWidth = Math.max(220, Math.min(520, Math.round(w0 + ev.clientX - x0)));
    pageEl.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
  };
  const onUp = () => {
    localStorage.setItem("cur_sbW", String(sidebarWidth));
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});
applySidebarState(false);

let _renderTimer = null;
const _pendingRenderDomains = new Set();
setOnUpdate(domain => {
  _pendingRenderDomains.add(domain || "__all__");
  clearTimeout(_renderTimer);
  _renderTimer = setTimeout(() => {
    const domains = new Set(_pendingRenderDomains);
    _pendingRenderDomains.clear();
    render(domains);
  }, 50);
});

// ── Save status indicator / quota-saving controls ─────────────────
const saveStatusEl = document.getElementById("saveStatusEl");
let saveStatusTimer = null;
let saveModeBtn = null;

function updateSaveControlButtons() {
  const autoSave = isAutoSaveEnabled();
  const dirty = getDirtyDomains();
  if (!saveModeBtn) return;

  // 자동저장 상태와 수동 저장 상태를 버튼 하나로 통합합니다.
  // 별도의 "수동 저장 모드" 문구나 두 번째 저장 버튼은 만들지 않습니다.
  if (autoSave) {
    saveModeBtn.textContent = dirty.length ? `자동저장 중(${dirty.length})` : "자동저장 ON";
    saveModeBtn.title = dirty.length
      ? "변경사항이 자동저장 대기 중입니다. 클릭하면 즉시 저장합니다."
      : "현재 자동저장 중입니다. 클릭하면 자동저장을 끕니다.";
    saveModeBtn.disabled = false;
  } else {
    saveModeBtn.textContent = dirty.length ? `수동 저장(${dirty.length})` : "자동저장 OFF";
    saveModeBtn.title = dirty.length
      ? "자동저장이 꺼져 있습니다. 클릭하면 변경사항을 수동 저장합니다."
      : "자동저장이 꺼져 있습니다. 클릭하면 자동저장을 다시 켭니다.";
    saveModeBtn.disabled = false;
  }
  saveModeBtn.classList.toggle("save-mode-on", autoSave);
  saveModeBtn.classList.toggle("save-mode-off", !autoSave);
  saveModeBtn.classList.toggle("manual-save-pending", dirty.length > 0);
  saveModeBtn.setAttribute("aria-pressed", autoSave ? "true" : "false");
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickJsonFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(String(reader.result || "{}"))); }
        catch (e) { reject(e); }
      };
      reader.onerror = () => reject(reader.error || new Error("파일을 읽지 못했습니다."));
      reader.readAsText(file);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function setupSaveQuotaControls() {
  const parent = saveStatusEl?.parentElement;
  if (!parent || saveModeBtn) return;

  if (LOCAL_DEV_MODE) {
    const devMenu = document.createElement("details");
    devMenu.className = "local-dev-menu";
    devMenu.title = "Firebase를 읽거나 쓰지 않고 localStorage만 사용합니다.";

    const summary = document.createElement("summary");
    summary.textContent = "LOCAL DEV";
    devMenu.appendChild(summary);

    const panel = document.createElement("div");
    panel.className = "local-dev-menu-panel";

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "secondary-btn local-dev-action";
    exportBtn.textContent = "로컬 내보내기";
    exportBtn.addEventListener("click", () => {
      downloadJsonFile(`his-local-dev-${new Date().toISOString().slice(0,10)}.json`, exportLocalSnapshot());
      devMenu.open = false;
    });

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "secondary-btn local-dev-action";
    importBtn.textContent = "로컬 가져오기";
    importBtn.addEventListener("click", async () => {
      try {
        const json = await pickJsonFile();
        if (!json) return;
        importLocalSnapshot(json);
        invalidateTabs();
        render("all");
        devMenu.open = false;
        alert("로컬 데이터를 가져왔습니다.");
      } catch (e) {
        console.error(e);
        alert("JSON 가져오기에 실패했습니다: " + (e?.message || e));
      }
    });

    const resetLocalBtn = document.createElement("button");
    resetLocalBtn.type = "button";
    resetLocalBtn.className = "secondary-btn local-dev-action";
    resetLocalBtn.textContent = "로컬 초기화";
    resetLocalBtn.addEventListener("click", () => {
      if (!confirm("브라우저에 저장된 로컬 개발 데이터를 초기화할까요? Firebase 데이터에는 영향이 없습니다.")) return;
      resetLocalSnapshot();
      invalidateTabs();
      render("all");
      devMenu.open = false;
    });

    panel.append(exportBtn, importBtn, resetLocalBtn);
    devMenu.appendChild(panel);
    saveStatusEl.insertAdjacentElement("afterend", devMenu);
  } else {
    const diagBtn = document.createElement("button");
    diagBtn.type = "button";
    diagBtn.className = "secondary-btn firestore-diagnostic-btn dev-tool-control";
    diagBtn.style.padding = "6px 10px";
    diagBtn.textContent = "Firestore 진단";
    diagBtn.title = "현재 Firestore 저장 데이터를 JSON으로 내보냅니다. 읽기 quota를 사용합니다.";
    diagBtn.addEventListener("click", async () => {
      if (!canEdit()) {
        alert("온라인 모드에서 로그인 후 실행할 수 있습니다.");
        return;
      }
      if (!confirm("Firestore 저장 데이터를 진단용 JSON으로 내보낼까요?\n읽기 quota가 일부 사용됩니다.")) return;
      const prevText = diagBtn.textContent;
      diagBtn.disabled = true;
      diagBtn.textContent = "진단 내보내는 중…";
      try {
        const snapshot = await exportFirestoreDiagnosticSnapshot();
        downloadJsonFile(`his-firestore-diagnostic-${new Date().toISOString().slice(0,10)}.json`, snapshot);
      } catch (e) {
        console.error(e);
        alert("Firestore 진단 내보내기에 실패했습니다: " + (e?.message || e));
      } finally {
        diagBtn.disabled = false;
        diagBtn.textContent = prevText;
      }
    });
    const cleanupBtn = document.createElement("button");
    cleanupBtn.type = "button";
    cleanupBtn.className = "secondary-btn data-cleanup-btn dev-tool-control";
    cleanupBtn.style.padding = "6px 10px";
    cleanupBtn.textContent = "DB 정리";
    cleanupBtn.title = "중복 시간표 카드와 교실 홈룸 데이터를 미리보기 후 정리합니다.";
    cleanupBtn.addEventListener("click", () => openDataCleanupDialog());

    const usageBtn = document.createElement("button");
    usageBtn.type = "button";
    usageBtn.className = "secondary-btn firestore-usage-btn dev-tool-control";
    usageBtn.style.padding = "6px 10px";
    usageBtn.textContent = "사용량";
    usageBtn.title = "이 브라우저에서 발생한 Firestore 읽기/쓰기/삭제 추정치를 확인합니다.";
    usageBtn.addEventListener("click", () => openFirestoreUsageDialog());

    saveStatusEl.insertAdjacentElement("afterend", cleanupBtn);
    saveStatusEl.insertAdjacentElement("afterend", usageBtn);
    saveStatusEl.insertAdjacentElement("afterend", diagBtn);
  }

  saveModeBtn = document.createElement("button");
  saveModeBtn.type = "button";
  saveModeBtn.className = "secondary-btn save-mode-toggle";
  saveModeBtn.addEventListener("click", async () => {
    const dirty = getDirtyDomains();
    if (dirty.length) {
      await savePendingNow();
      updateSaveControlButtons();
      return;
    }
    const next = !isAutoSaveEnabled();
    setAutoSaveEnabled(next);
    updateSaveControlButtons();
  });

  saveStatusEl.insertAdjacentElement("afterend", saveModeBtn);
  updateSaveControlButtons();
}

setupSaveQuotaControls();

setOnSaveStatus((status, detail) => {
  if (!saveStatusEl) return;
  clearTimeout(saveStatusTimer);
  updateSaveControlButtons();

  if (status === "saving") {
    saveStatusEl.textContent = "💾 저장 대기 중…"; saveStatusEl.className = "save-status saving";
  } else if (status === "dirty") {
    const count = detail?.dirtyDomains?.length || getDirtyDomains().length;
    saveStatusEl.textContent = `✍️ 변경사항 ${count}개 저장 대기`;
    saveStatusEl.className = "save-status saving";
  } else if (status === "saved") {
    saveStatusEl.textContent = "✅ 저장됨"; saveStatusEl.className = "save-status saved";
    saveStatusTimer = setTimeout(() => { saveStatusEl.textContent = ""; saveStatusEl.className = "save-status"; updateSaveControlButtons(); }, 2500);
  } else if (status === "skipped") {
    saveStatusEl.textContent = "✅ 변경 없음"; saveStatusEl.className = "save-status saved";
    saveStatusTimer = setTimeout(() => { saveStatusEl.textContent = ""; saveStatusEl.className = "save-status"; updateSaveControlButtons(); }, 1500);
  } else if (status === "mode") {
    saveStatusEl.textContent = "";
    saveStatusEl.className = "save-status";
  } else {
    saveStatusEl.textContent = "⚠️ 저장 실패 (네트워크 또는 권한 확인)"; saveStatusEl.className = "save-status error";
  }
});


// Board popup template edits: refresh sidebar and current board immediately.
document.addEventListener("his:template-updated", () => {
  updateTeacherDatalist();
  invalidateTabs();
  renderSidebar();
  if (activeMainView === "board") renderBoardTab();
  if (activeMainView === "manager") renderTemplateManagerView();
});

// Req 2: when table edits happen, sync sidebar + board immediately
setOnTemplateChange(() => {
  updateTeacherDatalist();
  invalidateTabs();
  renderSidebar();
  if (activeMainView === "board")    renderBoardTab();
  if (activeMainView === "manager")  renderTemplateManagerView();
  if (activeMainView === "teachers") void renderTeacherPanel();
});

// Req 4: sidebar grade chips update on board drag-drop
setOnCurriculumChange(() => {
  // Curriculum board mutations such as drag/drop, row add/delete, and clear are saved immediately.
  // The board uses DOM cache, so the cache must be invalidated before re-rendering.
  invalidateTabs();
  renderSidebar();
  if (activeMainView === "board") renderBoardTab();
  if (activeMainView === "results") void renderResultsPanel();
});

setAuthCheckingUI();

onAuth(async (user) => {
  updateAuthUI(user);
  if (user) {
    try {
      await migrateFromLegacy();
    } catch (e) {
      console.warn("Migration skipped; continuing normal load.", e);
    } finally {
      // Phase 2: 첫 화면에는 현재 메뉴에 필요한 도메인만 구독합니다.
      activeDomainSubscriptions.clear();
      syncDomainSubscriptionsForView(activeMainView || "board");
    }
  } else {
    unsubscribeAll();
    activeDomainSubscriptions.clear();
    invalidateTabs();
    render();
  }
});

// ================================================================
// EVENT LISTENERS
// ================================================================

// ── Auth ──────────────────────────────────────────────────────────
loginBtn?.addEventListener("click", () => {
  if (currentAuthUser) logout();
  else login();
});
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
// ── Sub-nav 버튼 클릭 ──────────────────────────────────────────────
navBoardBtn?.addEventListener("click",   () => { resetDraft(); void navigateTo("board"); });
navManagerBtn?.addEventListener("click", () => void navigateTo(activeMainView === "manager" ? "board" : "manager"));
navButtons.students?.addEventListener("click",     () => void navigateTo("students"));
navButtons.teachers?.addEventListener("click",     () => void navigateTo("teachers"));
navButtons.rooms?.addEventListener("click",        () => void navigateTo("rooms"));
navButtons.rosters?.addEventListener("click",      () => void navigateTo("rosters"));
navButtons.subjectsetup?.addEventListener("click", () => void navigateTo("subjectsetup"));
navButtons.results?.addEventListener("click",      () => void navigateTo("results"));
navButtons.ttcards?.addEventListener("click",      () => void navigateTo("ttcards"));
navButtons.groups?.addEventListener("click",       () => void navigateTo("groups"));

// ── Sidebar view toggles ──────────────────────────────────────────
tplMgrBackBtn?.addEventListener("click", () => void navigateTo("board"));
groupMgrAddBtn?.addEventListener("click", () => { addLiveTemplateGroup(); renderGroupManagerView(); });

// ── Sidebar level filter ──────────────────────────────────────────
sidebarLevelFilter?.addEventListener("change", e => { setSidebarLevel(e.target.value); renderSidebar(); });
sidebarTemplateAddBtn?.addEventListener("click", () => openTemplateCardPopup(null, { mode: "new" }));

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
tplMgrTableWrap?.addEventListener("click", async e => {
  if (e.target.closest("button[data-action='delete-template']")) {
    await ensureDomains(["rosters", "timetable"]);
  }
  handleTableDeleteClick(e, renderTemplateManagerView);
});

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
addClassBtn?.addEventListener("click", async () => {
  const { addNewClass } = await loadStudents();
  const cls = addNewClass(); if (!cls) return;
  selectedClassId = cls.id;
  studentMainEmpty?.classList.add("hidden"); studentMainContent?.classList.remove("hidden");
  if (classNameInput) classNameInput.value = cls.name;
  if (classGradeSelect) classGradeSelect.value = cls.grade;
  await renderStudentView(); await renderStudentTableView();
  setTimeout(() => { classNameInput?.focus(); classNameInput?.select(); }, 50);
});

deleteClassBtn?.addEventListener("click", async () => {
  const { deleteClass } = await loadStudents();
  if (deleteClass(selectedClassId)) {
    selectedClassId = null;
    studentMainEmpty?.classList.remove("hidden"); studentMainContent?.classList.add("hidden");
    void renderStudentView();
  }
});

classNameInput?.addEventListener("change", async e => {
  const { updateClass } = await loadStudents();
  updateClass(selectedClassId, "name", e.target.value);
  void renderStudentView();
});
classGradeSelect?.addEventListener("change", async e => {
  const { updateClass } = await loadStudents();
  updateClass(selectedClassId, "grade", e.target.value);
  void renderStudentView();
});

parsePasteBtn?.addEventListener("click", async () => {
  const raw = excelPasteArea?.value.trim();
  if (!raw) { alert("붙여넣기 영역이 비어 있습니다."); return; }
  const { getClassById, parseExcelPaste } = await loadStudents();
  const cls = getClassById(selectedClassId); if (!cls) { alert("반을 먼저 선택해 주세요."); return; }
  const parsed = parseExcelPaste(raw);
  if (!parsed.length) { alert("파싱된 학생이 없습니다.\n엑셀에서 이름이 포함된 셀을 복사해 붙여넣기 해주세요."); return; }
  parsed.forEach(s => { cls.students.push(s); }); scheduleSave("classes");
  if (excelPasteArea) excelPasteArea.value = "";
  void renderStudentTableView(); void renderStudentView();
  alert(`${parsed.length}명이 추가되었습니다.`);
});

clearPasteBtn?.addEventListener("click", () => { if (excelPasteArea) excelPasteArea.value = ""; });

addStudentRowBtn?.addEventListener("click", async () => {
  const { addStudentToClass } = await loadStudents();
  const s = addStudentToClass(selectedClassId); if (!s) return;
  await renderStudentTableView(); await renderStudentView();
  setTimeout(() => {
    const rows = studentTableBody?.querySelectorAll("tr");
    const last = rows?.[rows.length - 1];
    last?.scrollIntoView({ behavior:"smooth", block:"nearest" }); last?.querySelector("input")?.focus();
  }, 50);
});

exportStudentBtn?.addEventListener("click", async () => {
  const { exportStudentXlsx } = await loadStudents();
  exportStudentXlsx(selectedClassId);
});

// ── Initial render ────────────────────────────────────────────────
setView(activeMainView);
activateSection(VIEW_TO_SECTION[activeMainView] || activeSection);
activateSubBtn(activeMainView);
render();
