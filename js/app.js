// ================================================================
// app.js · Main Entry: Auth + Navigation + Events
// ================================================================
import { onAuth, canEdit } from "./auth.js";
import { setupAuthUi, setAuthCheckingUI, updateAuthUI } from "./app-auth-ui.js";
import { setupSaveStatusUi } from "./save-status-ui.js";
import { setupAppSidebarUi } from "./app-sidebar-ui.js";
import { setupAppNavigationUi, VIEW_TO_SECTION } from "./app-navigation-ui.js";
import { domainsForView, ensureDomains, resetDomainSubscriptions, stopAllDomainSubscriptions, syncDomainSubscriptionsForView, waitForDomainsLoaded } from "./app-domains.js";
import { appState, setOnUpdate, migrateFromLegacy } from "./state.js";
import { versioned } from "./version.js";
import { createAppModuleLoader } from "./app-module-loader.js";
import { setupStudentManagementUi } from "./app-students-ui.js";
import { setupAppBoardUi } from "./app-board-ui.js";

// ── Template/sidebar UI ─────────────────────────────────────────
import { setupAppTemplatesUi } from "./app-templates-ui.js";

// ── Curriculum imports ────────────────────────────────────────────
const curriculumApi = await import(versioned("./curriculum.js"));
const { buildTabBoard, exportXLSX } = curriculumApi;


// ── Lazy-loaded view modules ──────────────────────────────────────
// 지연 로딩 모듈 관리는 app-module-loader.js에서 담당합니다.
// app.js는 화면별로 필요한 모듈을 요청만 합니다.
const moduleLoader = createAppModuleLoader();
const loadStudents     = () => moduleLoader.load("students");
const loadTeachers     = () => moduleLoader.load("teachers");
const loadRosters      = () => moduleLoader.load("rosters");
const loadResults      = () => moduleLoader.load("results");
const loadTtCards      = () => moduleLoader.load("ttcards");
const loadSubjectSetup = () => moduleLoader.load("subjectSetup");
const loadRooms        = () => moduleLoader.load("rooms");

const studentUi = setupStudentManagementUi({
  loadStudents,
  getActiveView: () => activeMainView,
});

const boardUi = setupAppBoardUi({
  buildTabBoard,
  exportXLSX,
  renderSidebar: () => renderSidebar(),
  renderApp: () => render(),
});

// ── DOM: Main views ───────────────────────────────────────────────

const boardView     = document.getElementById("boardView");
const groupMgrView  = document.getElementById("groupManagerView");
const groupMgrBoard = document.getElementById("groupManagerBoard");
const tplMgrView    = document.getElementById("templateManagerView");
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

// ── Navigation UI is initialized through app-navigation-ui.js ─────────
// ================================================================
// NAVIGATION STATE
// ================================================================
const INITIAL_VIEW = document.body?.dataset.initialView || "board";
let activeMainView = INITIAL_VIEW;
let templateUi = null;
const navigationUi = setupAppNavigationUi({
  initialView: activeMainView,
  initialSection: document.body?.dataset.section,
  getCurrentView: () => activeMainView,
  navigateTo: view => navigateTo(view),
  resetBeforeBoard: () => templateUi?.resetTemplateForm(),
});


// ── View-scoped Firestore subscriptions are handled in app-domains.js ───────
// ── View switching ─────────────────────────────────────────────────
async function navigateTo(view) {
  setView(view);
  syncDomainSubscriptionsForView(view);
  navigationUi?.syncNavigation(view, VIEW_TO_SECTION[view]);

  // 화면 분리 후에는 현재 화면에 필요한 도메인이 아직 로드되지 않은 상태에서
  // 먼저 렌더링되어 빈 화면처럼 보일 수 있습니다. 필요한 구독이 붙은 뒤 한 번 더 렌더링합니다.
  await waitForDomainsLoaded(domainsForView(view), 7000);

  runViewNavigationHook(view, "before");
  await runViewRenderer(view, { catchErrors: false });
  runViewNavigationHook(view, "after");
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
  templateUi?.resetTemplateForm();
  setView("board");
  boardUi.invalidateTabs();
  templateUi?.renderSidebar();
  boardUi.renderBoardTab();
}

// ================================================================
// RENDER
// ================================================================
function renderBoardTab() { boardUi.renderBoardTab(); }

function renderSidebar() { templateUi?.renderSidebar(); }

function renderTemplateManagerView() { templateUi?.renderTemplateManagerView(); }

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

// View renderer map — 화면별 렌더러를 한 곳에서 관리합니다.
// 새 화면이 추가될 때 render()/navigateTo()의 if-chain을 수정하지 않고
// 여기만 확장하면 됩니다.
const VIEW_RENDERERS = {
  board:        () => renderBoardTab(),
  groups:       () => renderGroupManagerView(),
  manager:      () => renderTemplateManagerView(),
  students:     () => studentUi.renderStudentView(),
  teachers:     () => renderTeacherPanel(),
  rooms:        () => renderRoomsPanel(),
  rosters:      () => renderRosterPanel(),
  results:      () => renderResultsPanel(),
  subjectsetup: () => renderSubjectSetupPanel(),
  ttcards:      () => renderTtCardsPanel(),
};

// 화면 진입 시에만 필요한 부수 작업입니다.
// Firestore 업데이트 렌더링에서는 실행하지 않아 기존 상태가 유지됩니다.
const VIEW_NAVIGATION_HOOKS = {
  board: {
    after: () => renderSidebar(),
  },
  manager: {
    before: () => templateUi?.clearStableOrder(),
    after:  () => renderSidebar(),
  },
  students: {
    before: () => studentUi.resetSelection(),
  },
};

function runViewNavigationHook(view, phase) {
  const hook = VIEW_NAVIGATION_HOOKS[view]?.[phase];
  if (typeof hook === "function") hook();
}

function runViewRenderer(view = activeMainView, { catchErrors = true } = {}) {
  const renderer = VIEW_RENDERERS[view] || VIEW_RENDERERS.board;
  const result = renderer();
  if (catchErrors && result && typeof result.catch === "function") {
    result.catch(err => console.error(`[render:${view}]`, err));
  }
  return result;
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
    templateUi?.syncSchoolLevels();
    boardUi.invalidateTabs();
  }

  // Sidebar cards depend on templates and also on curriculum placement chips.
  // Render it whenever those domains changed, or when the current view needs it.
  if (fullRender || changed("curriculum") || changed("templates") || changed("teachers") ||
      activeMainView === "groups" || activeMainView === "manager") {
    renderSidebar();
  }

  runViewRenderer(activeMainView);
  renderTabBtns();
}

function renderTabBtns() {
  boardUi.renderTabButtons();
  navigationUi?.syncNavigation(activeMainView, VIEW_TO_SECTION[activeMainView]);
}

// ================================================================
// CONTROLS DISABLE/ENABLE
// ================================================================
function setControlsDisabled(disabled) {
  boardUi.setDisabled(disabled);
  templateUi?.setDisabled(disabled);
  studentUi?.setDisabled(disabled);
}

// ================================================================
// BOOTSTRAP
// ================================================================
setupAppSidebarUi();

templateUi = setupAppTemplatesUi({
  ensureDomains,
  invalidateTabs: () => boardUi.invalidateTabs(),
  renderApp: () => render(),
  renderBoardTab: () => boardUi.renderBoardTab(),
  renderResultsPanel,
  renderTeacherPanel,
  renderGroupManagerView,
  getActiveView: () => activeMainView,
  navigateToBoard: () => void navigateTo("board"),
  curriculumApi,
});

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
setupSaveStatusUi({
  onLocalDataChanged: () => {
    boardUi.invalidateTabs();
    render("all");
  }
});


setupAuthUi();
setAuthCheckingUI();

onAuth(async (user) => {
  updateAuthUI(user);
  if (user) {
    try {
      await migrateFromLegacy();
    } catch (e) {
      console.warn("Migration skipped; continuing normal load.", e);
    } finally {
      // 첫 화면에는 현재 메뉴에 필요한 도메인만 구독합니다.
      resetDomainSubscriptions();
      syncDomainSubscriptionsForView(activeMainView || "board");
    }
  } else {
    stopAllDomainSubscriptions();
    boardUi.invalidateTabs();
    render();
  }
});

// ================================================================
// EVENT LISTENERS
// ================================================================

// ── Initial render ────────────────────────────────────────────────
setView(activeMainView);
navigationUi?.syncNavigation(activeMainView, VIEW_TO_SECTION[activeMainView]);
render();
