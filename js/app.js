// ================================================================
// app.js · Main Entry / Bootstrap
// ================================================================
// 이 파일은 앱 전체 초기화만 담당합니다.
// 화면별 UI, 도메인 구독, 지연 로딩, 렌더링은 전용 모듈로 분리되어 있습니다.

import { onAuth, canEdit } from "./auth.js";
import { setupAuthUi, setAuthCheckingUI, updateAuthUI } from "./app-auth-ui.js";
import { setupSaveStatusUi } from "./save-status-ui.js";
import { setupAppSidebarUi } from "./app-sidebar-ui.js";
import { setupAppNavigationUi, VIEW_TO_SECTION } from "./app-navigation-ui.js";
import { domainsForView, ensureDomains, resetDomainSubscriptions, stopAllDomainSubscriptions, syncDomainSubscriptionsForView, waitForDomainsLoaded } from "./app-domains.js";
import { appState, setOnUpdate, migrateFromLegacy } from "./state.js";
import { versioned } from "./version.js?v=2026-07-06-condition-popup-multiroom-persist-r225";
import { createAppModuleLoader } from "./app-module-loader.js";
import { createAppRenderOrchestrator } from "./app-render-orchestrator.js";
import { setupStudentManagementUi } from "./app-students-ui.js";
import { setupAppBoardUi } from "./app-board-ui.js";
import { setupAppTemplatesUi } from "./app-templates-ui.js";

const DEFAULT_VIEW = "board";
const FIRESTORE_RENDER_DEBOUNCE_MS = 50;

function resolveInitialView() {
  return document.body?.dataset.initialView || DEFAULT_VIEW;
}

function createLazyLoaders() {
  const moduleLoader = createAppModuleLoader();
  return {
    students:     () => moduleLoader.load("students"),
    teachers:     () => moduleLoader.load("teachers"),
    rosters:      () => moduleLoader.load("rosters"),
    results:      () => moduleLoader.load("results"),
    ttCards:      () => moduleLoader.load("ttcards"),
    subjectSetup: () => moduleLoader.load("subjectSetup"),
    rooms:        () => moduleLoader.load("rooms"),
  };
}

function setupFirestoreRenderDebounce(renderer) {
  let renderTimer = null;
  const pendingDomains = new Set();

  setOnUpdate(domain => {
    pendingDomains.add(domain || "__all__");
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      const domains = new Set(pendingDomains);
      pendingDomains.clear();
      renderer.render(domains);
    }, FIRESTORE_RENDER_DEBOUNCE_MS);
  });
}

function setupLocalDataChangeHandler({ boardUi, renderer }) {
  setupSaveStatusUi({
    onLocalDataChanged: () => {
      boardUi.invalidateTabs();
      renderer.render("all");
    },
  });
}

function setupAuthStateHandler({ boardUi, renderer }) {
  setupAuthUi();
  setAuthCheckingUI();

  onAuth(async user => {
    updateAuthUI(user);

    if (!user) {
      stopAllDomainSubscriptions();
      boardUi.invalidateTabs();
      renderer.render();
      return;
    }

    try {
      await migrateFromLegacy();
    } catch (error) {
      console.warn("Migration skipped; continuing normal load.", error);
    } finally {
      resetDomainSubscriptions();
      syncDomainSubscriptionsForView(renderer.getActiveView() || DEFAULT_VIEW);
    }
  });
}

async function createCurriculumApi() {
  return import(versioned("./curriculum.js"));
}

async function bootstrap() {
  const initialView = resolveInitialView();
  const curriculumApi = await createCurriculumApi();
  const { buildTabBoard, exportXLSX } = curriculumApi;
  const loaders = createLazyLoaders();

  let renderer = null;
  let templateUi = null;
  let navigationUi = null;

  const studentUi = setupStudentManagementUi({
    loadStudents: loaders.students,
    getActiveView: () => renderer?.getActiveView?.() || initialView,
  });

  const boardUi = setupAppBoardUi({
    buildTabBoard,
    exportXLSX,
    renderSidebar: () => renderer?.renderSidebar?.(),
    renderApp: () => renderer?.render?.(),
  });

  renderer = createAppRenderOrchestrator({
    initialView,
    appState,
    canEdit,
    domainsForView,
    waitForDomainsLoaded,
    syncDomainSubscriptionsForView,
    syncNavigation: (view, section) => navigationUi?.syncNavigation?.(view, section),
    boardUi,
    studentUi,
    loadTeachers: loaders.teachers,
    loadRosters: loaders.rosters,
    loadResults: loaders.results,
    loadTtCards: loaders.ttCards,
    loadSubjectSetup: loaders.subjectSetup,
    loadRooms: loaders.rooms,
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
    navigateToBoard: () => void renderer.navigateTo(DEFAULT_VIEW),
    curriculumApi,
  });

  setupAppSidebarUi();
  setupFirestoreRenderDebounce(renderer);
  setupLocalDataChangeHandler({ boardUi, renderer });
  setupAuthStateHandler({ boardUi, renderer });

  renderer.setView(renderer.getActiveView());
  navigationUi.syncNavigation(renderer.getActiveView(), VIEW_TO_SECTION[renderer.getActiveView()]);
  renderer.render();
}

bootstrap().catch(error => {
  console.error("[app bootstrap]", error);
  alert(`앱을 초기화하는 중 오류가 발생했습니다.\n${error?.message || error}`);
});
