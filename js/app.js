// ================================================================
// app.js · Main Entry: Auth + Bootstrap
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
import { createAppRenderOrchestrator } from "./app-render-orchestrator.js";
import { setupStudentManagementUi } from "./app-students-ui.js";
import { setupAppBoardUi } from "./app-board-ui.js";
import { setupAppTemplatesUi } from "./app-templates-ui.js";

// ── Curriculum imports ────────────────────────────────────────────
const curriculumApi = await import(versioned("./curriculum.js"));
const { buildTabBoard, exportXLSX } = curriculumApi;

// ── Lazy-loaded view modules ──────────────────────────────────────
const moduleLoader = createAppModuleLoader();
const loadStudents     = () => moduleLoader.load("students");
const loadTeachers     = () => moduleLoader.load("teachers");
const loadRosters      = () => moduleLoader.load("rosters");
const loadResults      = () => moduleLoader.load("results");
const loadTtCards      = () => moduleLoader.load("ttcards");
const loadSubjectSetup = () => moduleLoader.load("subjectSetup");
const loadRooms        = () => moduleLoader.load("rooms");

// ================================================================
// BOOTSTRAP STATE
// ================================================================
const INITIAL_VIEW = document.body?.dataset.initialView || "board";
let renderer = null;
let templateUi = null;
let navigationUi = null;

const studentUi = setupStudentManagementUi({
  loadStudents,
  getActiveView: () => renderer?.getActiveView?.() || INITIAL_VIEW,
});

const boardUi = setupAppBoardUi({
  buildTabBoard,
  exportXLSX,
  renderSidebar: () => renderer?.renderSidebar?.(),
  renderApp: () => renderer?.render?.(),
});

renderer = createAppRenderOrchestrator({
  initialView: INITIAL_VIEW,
  appState,
  canEdit,
  domainsForView,
  waitForDomainsLoaded,
  syncDomainSubscriptionsForView,
  syncNavigation: (view, section) => navigationUi?.syncNavigation?.(view, section),
  boardUi,
  studentUi,
  loadTeachers,
  loadRosters,
  loadResults,
  loadTtCards,
  loadSubjectSetup,
  loadRooms,
  getTemplateUi: () => templateUi,
});

navigationUi = setupAppNavigationUi({
  initialView: renderer.getActiveView(),
  initialSection: document.body?.dataset.section,
  getCurrentView: () => renderer.getActiveView(),
  navigateTo: view => renderer.navigateTo(view),
  resetBeforeBoard: () => templateUi?.resetTemplateForm(),
});

templateUi = setupAppTemplatesUi({
  ensureDomains,
  invalidateTabs: () => boardUi.invalidateTabs(),
  renderApp: () => renderer.render(),
  renderBoardTab: () => boardUi.renderBoardTab(),
  renderResultsPanel: () => renderer.renderResultsPanel(),
  renderTeacherPanel: () => renderer.renderTeacherPanel(),
  renderGroupManagerView: () => renderer.renderGroupManagerView(),
  getActiveView: () => renderer.getActiveView(),
  navigateToBoard: () => void renderer.navigateTo("board"),
  curriculumApi,
});

// ================================================================
// GLOBAL UI SETUP
// ================================================================
setupAppSidebarUi();

let _renderTimer = null;
const _pendingRenderDomains = new Set();
setOnUpdate(domain => {
  _pendingRenderDomains.add(domain || "__all__");
  clearTimeout(_renderTimer);
  _renderTimer = setTimeout(() => {
    const domains = new Set(_pendingRenderDomains);
    _pendingRenderDomains.clear();
    renderer.render(domains);
  }, 50);
});

setupSaveStatusUi({
  onLocalDataChanged: () => {
    boardUi.invalidateTabs();
    renderer.render("all");
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
      resetDomainSubscriptions();
      syncDomainSubscriptionsForView(renderer.getActiveView() || "board");
    }
  } else {
    stopAllDomainSubscriptions();
    boardUi.invalidateTabs();
    renderer.render();
  }
});

// ── Initial render ────────────────────────────────────────────────
renderer.setView(renderer.getActiveView());
navigationUi?.syncNavigation(renderer.getActiveView(), VIEW_TO_SECTION[renderer.getActiveView()]);
renderer.render();
