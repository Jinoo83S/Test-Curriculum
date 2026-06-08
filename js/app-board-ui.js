// ================================================================
// app-board-ui.js · Curriculum board tabs / export / reset UI
// ================================================================
import { GRADE_GROUPS } from "./config.js";
import { canEdit } from "./auth.js";
import { appState, saveNow } from "./state.js";

const DEFAULT_BOARD_OPTIONS = {
  category: ["교과", "창체"],
  track: ["공통", "배정", "선택"],
  group: ["선택", "국어", "영어", "수학", "사회", "과학", "정보", "예술", "체육", "자율활동", "동아리", "채플", "기타"],
};
const DEFAULT_GRADES = ["7학년", "8학년", "9학년", "10학년", "11학년", "12학년"];

function makeEmptyBoardRow(options) {
  return {
    id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    category: options.category?.[0] || "교과",
    track: options.track?.[0] || "공통",
    group: options.group?.[0] || "선택",
    credits: "",
    sem1TemplateId: null,
    sem2TemplateId: null,
  };
}

export function setupAppBoardUi({
  buildTabBoard,
  exportXLSX,
  renderSidebar,
  renderApp,
} = {}) {
  const gradeBoard = document.getElementById("gradeBoard");
  const resetBoardBtn = document.getElementById("resetBoardBtn");
  const exportXlsxBtn = document.getElementById("exportXlsxBtn");
  const tab7to9Btn = document.getElementById("tab7to9Btn");
  const tab10to12Btn = document.getElementById("tab10to12Btn");

  let activeTab = "tab7to9";
  const tabBoardCache = { tab7to9: null, tab10to12: null };
  const dirtyTabs = new Set(["tab7to9", "tab10to12"]);

  function invalidateTabs() {
    dirtyTabs.add("tab7to9");
    dirtyTabs.add("tab10to12");
  }

  function renderBoardTab() {
    if (!gradeBoard || typeof buildTabBoard !== "function") return;

    const tab = activeTab;
    if (!dirtyTabs.has(tab) && tabBoardCache[tab]) {
      gradeBoard.innerHTML = "";
      tabBoardCache[tab].forEach(el => gradeBoard.appendChild(el));
      return;
    }

    const elements = buildTabBoard(GRADE_GROUPS[tab], () => {
      invalidateTabs();
      renderBoardTab();
      renderSidebar?.();
    });

    gradeBoard.innerHTML = "";
    elements.forEach(el => gradeBoard.appendChild(el));
    tabBoardCache[tab] = elements;
    dirtyTabs.delete(tab);
  }

  function renderTabButtons() {
    tab7to9Btn?.classList.toggle("active", activeTab === "tab7to9");
    tab10to12Btn?.classList.toggle("active", activeTab === "tab10to12");
  }

  function setActiveTab(nextTab) {
    if (!nextTab || activeTab === nextTab) return;
    activeTab = nextTab;
    renderTabButtons();
    renderBoardTab();
  }

  async function resetBoard() {
    if (!canEdit()) return;
    if (!confirm("커리큘럼 보드를 초기화할까요? (과목카드/학생 데이터는 유지됩니다)")) return;

    const options = structuredClone(DEFAULT_BOARD_OPTIONS);
    const gradeBoards = {};
    DEFAULT_GRADES.forEach(grade => {
      gradeBoards[grade] = Array.from({ length: 4 }, () => makeEmptyBoardRow(options));
    });

    appState.curriculum = { options, gradeBoards };
    invalidateTabs();
    await saveNow("curriculum");
    renderApp?.("curriculum");
  }

  function setDisabled(disabled) {
    [resetBoardBtn, exportXlsxBtn].forEach(el => {
      if (el) el.disabled = disabled;
    });
  }

  resetBoardBtn?.addEventListener("click", () => { void resetBoard(); });
  exportXlsxBtn?.addEventListener("click", () => {
    if (typeof exportXLSX === "function") exportXLSX(activeTab);
  });
  tab7to9Btn?.addEventListener("click", () => setActiveTab("tab7to9"));
  tab10to12Btn?.addEventListener("click", () => setActiveTab("tab10to12"));

  renderTabButtons();

  return {
    getActiveTab: () => activeTab,
    setActiveTab,
    invalidateTabs,
    renderBoardTab,
    renderTabButtons,
    setDisabled,
    resetBoard,
  };
}
