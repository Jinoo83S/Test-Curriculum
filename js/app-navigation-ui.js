// ================================================================
// app-navigation-ui.js · Top / sub navigation wiring
// ================================================================

export const SECTION_DEFAULT_VIEW = {
  curriculum: "board",
  roster:     "teachers",
  setup:      "subjectsetup",
  prework:    "ttcards",
  results:    "results",
};

export const VIEW_TO_SECTION = {
  board: "curriculum",
  manager: "curriculum",
  teachers: "roster",
  students: "roster",
  rooms: "roster",
  subjectsetup: "setup",
  rosters: "setup",
  ttcards: "prework",
  groups: "prework",
  results: "results",
};

const SUB_NAV_ID_BY_VIEW = {
  board: "navBoardBtn",
  manager: "navManagerBtn",
  teachers: "navTeachersBtn",
  students: "navStudentsBtn",
  rooms: "navRoomsBtn",
  subjectsetup: "navSubjectSetupBtn",
  rosters: "navRostersBtn",
  ttcards: "navTtCardsBtn",
  groups: "navGroupsBtn",
  results: "navResultsBtn",
};

function byId(id) {
  return id ? document.getElementById(id) : null;
}

function bindOnce(el, eventName, handler, key) {
  if (!el) return;
  const flag = `navBound_${key || eventName}`;
  if (el.dataset?.[flag]) return;
  el.addEventListener(eventName, handler);
  if (el.dataset) el.dataset[flag] = "1";
}

export function setupAppNavigationUi({
  initialView = "board",
  initialSection = "",
  getCurrentView = () => initialView,
  navigateTo = () => {},
  resetBeforeBoard = () => {},
} = {}) {
  let activeSection = initialSection || VIEW_TO_SECTION[initialView] || "curriculum";

  function activateSection(section) {
    activeSection = section || activeSection || "curriculum";

    document.querySelectorAll("#topbarMainNav [data-section]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.section === activeSection);
    });

    document.querySelectorAll(".sub-nav-group").forEach(group => {
      group.classList.toggle("hidden", group.dataset.section !== activeSection);
    });
  }

  function activateSubBtn(view) {
    const activeId = SUB_NAV_ID_BY_VIEW[view];
    document.querySelectorAll(".sub-nav-btn").forEach(btn => {
      btn.classList.toggle("active", Boolean(activeId) && btn.id === activeId);
    });
  }

  function syncNavigation(view = getCurrentView(), section = VIEW_TO_SECTION[view] || activeSection) {
    activateSection(section);
    activateSubBtn(view);
  }

  function go(view) {
    if (!view) return;
    void navigateTo(view);
  }

  function setupMainSectionButtons() {
    document.querySelectorAll("#topbarMainNav [data-section]").forEach(btn => {
      if (btn.tagName === "A") return;
      bindOnce(btn, "click", () => {
        const section = btn.dataset.section;
        activeSection = section || activeSection;
        syncNavigation(getCurrentView(), activeSection);
        go(SECTION_DEFAULT_VIEW[activeSection]);
      }, `main_${btn.dataset.section || "unknown"}`);
    });
  }

  function setupSubNavButtons() {
    bindOnce(byId("navBoardBtn"), "click", () => {
      resetBeforeBoard();
      go("board");
    }, "board");

    bindOnce(byId("navManagerBtn"), "click", () => {
      go(getCurrentView() === "manager" ? "board" : "manager");
    }, "manager");

    const simpleViews = [
      "students", "teachers", "rooms", "rosters", "subjectsetup",
      "results", "ttcards", "groups",
    ];

    simpleViews.forEach(view => {
      bindOnce(byId(SUB_NAV_ID_BY_VIEW[view]), "click", () => go(view), view);
    });
  }

  setupMainSectionButtons();
  setupSubNavButtons();
  syncNavigation(initialView, activeSection);

  return {
    activateSection,
    activateSubBtn,
    syncNavigation,
    getActiveSection: () => activeSection,
  };
}
