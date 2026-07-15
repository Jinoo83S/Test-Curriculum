// ================================================================
// app-render-orchestrator.js · View switching + render orchestration
// ================================================================
// app.js가 인증/부트스트랩에 집중할 수 있도록 화면 전환, view 표시,
// 화면별 렌더링, Firestore 업데이트 렌더링을 한 곳에서 관리합니다.

import { VIEW_TO_SECTION } from "./app-navigation-ui.js?v=2026-07-15-teacher-id-migration-r354";

export function createAppRenderOrchestrator(options = {}) {
  const {
    initialView = "board",
    canEdit,
    appState,
    domainsForView,
    waitForDomainsLoaded,
    syncDomainSubscriptionsForView,
    syncNavigation,
    boardUi,
    studentUi,
    loadTeachers,
    loadRosters,
    loadResults,
    loadTtCards,
    loadSubjectSetup,
    loadRooms,
    getTemplateUi,
  } = options;

  let activeView = initialView || "board";

  const views = {
    board:        document.getElementById("boardView"),
    groups:       document.getElementById("groupManagerView"),
    manager:      document.getElementById("templateManagerView"),
    students:     document.getElementById("studentMgmtView"),
    teachers:     document.getElementById("teacherMgmtView"),
    rooms:        document.getElementById("roomMgmtView"),
    rosters:      document.getElementById("rosterMgmtView"),
    results:      document.getElementById("resultsMgmtView"),
    ttcards:      document.getElementById("ttCardsMgmtView"),
    subjectsetup: document.getElementById("subjectSetupView"),
  };

  const content = {
    groupMgrBoard:      document.getElementById("groupManagerBoard"),
    teacherContent:     document.getElementById("teacherContent"),
    roomContent:        document.getElementById("roomContent"),
    rosterContent:      document.getElementById("rosterContent"),
    resultsContent:     document.getElementById("resultsContent"),
    ttCardsContent:     document.getElementById("ttCardsContent"),
    subjectSetupContent:document.getElementById("subjectSetupContent"),
  };

  const templateUi = () => (typeof getTemplateUi === "function" ? getTemplateUi() : null);

  function getActiveView() {
    return activeView;
  }

  function setView(view) {
    activeView = view || "board";
    Object.entries(views).forEach(([key, el]) => {
      el?.classList.toggle("hidden", key !== activeView);
    });
  }

  function renderBoardTab() {
    boardUi?.renderBoardTab?.();
  }

  function renderSidebar() {
    templateUi()?.renderSidebar?.();
  }

  function renderTemplateManagerView() {
    templateUi()?.renderTemplateManagerView?.();
  }

  async function renderTeacherPanel() {
    if (activeView !== "teachers" || !content.teacherContent) return;
    const { renderTeacherView } = await loadTeachers();
    if (activeView === "teachers") renderTeacherView(content.teacherContent);
  }

  async function renderRosterPanel() {
    if (activeView !== "rosters" || !content.rosterContent) return;
    const { renderRosterView } = await loadRosters();
    if (activeView === "rosters") renderRosterView(content.rosterContent);
  }

  async function renderRoomsPanel() {
    if (activeView !== "rooms" || !content.roomContent) return;
    const { renderRoomsView } = await loadRooms();
    const teacherNames = [...new Set((appState?.teachers?.teachers || [])
      .map(t => String(t.name || "").trim())
      .filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
    if (activeView === "rooms") {
      renderRoomsView(content.roomContent, () => void renderRoomsPanel(), { teacherNames });
    }
  }

  async function renderResultsPanel() {
    if (activeView !== "results" || !content.resultsContent) return;
    const { renderResultsView } = await loadResults();
    if (activeView === "results") renderResultsView(content.resultsContent);
  }

  async function renderTtCardsPanel() {
    if (activeView !== "ttcards" || !content.ttCardsContent) return;
    const { renderTtCardsView } = await loadTtCards();
    if (activeView === "ttcards") renderTtCardsView(content.ttCardsContent);
  }

  async function renderSubjectSetupPanel() {
    if (activeView !== "subjectsetup" || !content.subjectSetupContent) return;
    const { renderSubjectSetupView } = await loadSubjectSetup();
    if (activeView === "subjectsetup") renderSubjectSetupView(content.subjectSetupContent);
  }

  async function renderGroupManagerView() {
    if (activeView !== "groups" || !content.groupMgrBoard) return;
    const { renderGroupManagerView: renderGroupMgrFromTtCards } = await loadTtCards();
    if (activeView === "groups") renderGroupMgrFromTtCards(content.groupMgrBoard);
  }

  const VIEW_RENDERERS = {
    board:        () => renderBoardTab(),
    groups:       () => renderGroupManagerView(),
    manager:      () => renderTemplateManagerView(),
    students:     () => studentUi?.renderStudentView?.(),
    teachers:     () => renderTeacherPanel(),
    rooms:        () => renderRoomsPanel(),
    rosters:      () => renderRosterPanel(),
    results:      () => renderResultsPanel(),
    subjectsetup: () => renderSubjectSetupPanel(),
    ttcards:      () => renderTtCardsPanel(),
  };

  const VIEW_NAVIGATION_HOOKS = {
    board: {
      after: () => renderSidebar(),
    },
    manager: {
      before: () => templateUi()?.clearStableOrder?.(),
      after:  () => renderSidebar(),
    },
    students: {
      before: () => studentUi?.resetSelection?.(),
    },
  };

  function runViewNavigationHook(view, phase) {
    const hook = VIEW_NAVIGATION_HOOKS[view]?.[phase];
    if (typeof hook === "function") hook();
  }

  function runViewRenderer(view = activeView, { catchErrors = true } = {}) {
    const renderer = VIEW_RENDERERS[view] || VIEW_RENDERERS.board;
    const result = renderer();
    if (catchErrors && result && typeof result.catch === "function") {
      result.catch(err => console.error(`[render:${view}]`, err));
    }
    return result;
  }

  async function navigateTo(view) {
    setView(view);
    syncDomainSubscriptionsForView?.(view);
    syncNavigation?.(view, VIEW_TO_SECTION[view]);

    // 화면에 필요한 도메인 구독이 붙은 뒤 렌더링합니다.
    const domains = typeof domainsForView === "function" ? domainsForView(view) : [];
    await waitForDomainsLoaded?.(domains, 7000);

    runViewNavigationHook(view, "before");
    await runViewRenderer(view, { catchErrors: false });
    runViewNavigationHook(view, "after");
  }

  function closeToBoard() {
    templateUi()?.resetTemplateForm?.();
    setView("board");
    boardUi?.invalidateTabs?.();
    renderBoardTab();
  }

  function setControlsDisabled(disabled) {
    boardUi?.setDisabled?.(disabled);
    templateUi()?.setDisabled?.(disabled);
    studentUi?.setDisabled?.(disabled);
  }

  function renderTabButtons() {
    boardUi?.renderTabButtons?.();
    syncNavigation?.(activeView, VIEW_TO_SECTION[activeView]);
  }

  // Master render — called on every Firestore update
  function render(domain) {
    setControlsDisabled(!canEdit?.());

    const changedDomains = domain instanceof Set
      ? domain
      : Array.isArray(domain)
        ? new Set(domain)
        : new Set(domain ? [domain] : []);
    const fullRender = !domain || changedDomains.has("__all__") || changedDomains.has("all");
    const changed = d => fullRender || changedDomains.has(d);
    const boardDataChanged = fullRender || changed("curriculum") || changed("templates");

    // Curriculum board uses a DOM cache. If curriculum/templates arrive together
    // with other Firestore snapshots, invalidate before rendering.
    if (boardDataChanged) {
      templateUi()?.syncSchoolLevels?.();
      boardUi?.invalidateTabs?.();
    }

    // Sidebar cards depend on templates and also on curriculum placement chips.
    if (fullRender || changed("curriculum") || changed("templates") || changed("teachers") ||
        activeView === "groups" || activeView === "manager") {
      renderSidebar();
    }

    runViewRenderer(activeView);
    renderTabButtons();
  }

  return {
    getActiveView,
    setView,
    navigateTo,
    closeToBoard,
    render,
    renderSidebar,
    renderBoardTab,
    renderTemplateManagerView,
    renderTeacherPanel,
    renderRosterPanel,
    renderRoomsPanel,
    renderResultsPanel,
    renderTtCardsPanel,
    renderSubjectSetupPanel,
    renderGroupManagerView,
    runViewRenderer,
    setControlsDisabled,
    renderTabButtons,
  };
}
