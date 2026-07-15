// ================================================================
// app-board-ui.js · Curriculum board tabs / export / reset UI
// ================================================================
import { GRADE_GROUPS, ACTIVE_SCHOOL_YEAR, LEGACY_SCHOOL_YEAR, assertSchoolYearWriteContext, schoolYearDomainPath } from "./config.js?v=2026-07-15-school-year-path-guard-r353";
import { schoolYearLabel } from "./school-year.js?v=2026-07-15-school-year-path-guard-r353";
import { canEdit } from "./auth.js?v=2026-07-15-school-year-path-guard-r353";
import { appState, saveNow } from "./state.js?v=2026-07-15-school-year-path-guard-r353";
import { assertDestructiveTarget, buildBackupFilename, downloadJsonBackup, recordDestructiveOperation } from "./destructive-operation-guard.js?v=2026-07-15-school-year-path-guard-r353";

const DEFAULT_BOARD_OPTIONS = {
  category: ["교과", "창체"],
  track: ["공통", "배정", "선택"],
  group: ["선택", "국어", "영어", "수학", "사회", "과학", "정보", "예술", "체육", "자율활동", "동아리", "채플", "기타"],
};

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

    try {
      assertSchoolYearWriteContext("커리큘럼 보드 초기화");
    } catch (error) {
      alert(error?.message || "학년도 실행 상태가 일치하지 않아 초기화를 차단했습니다.");
      return;
    }

    const targetGrades = [...(GRADE_GROUPS[activeTab] || [])];
    const levelKey = activeTab === "tab7to9" ? "중등" : "고등";
    const levelLabel = activeTab === "tab7to9" ? "중등(7·8·9학년)" : "고등(10·11·12학년)";
    const targetPath = schoolYearDomainPath("curriculum");
    const phrase = ACTIVE_SCHOOL_YEAR === LEGACY_SCHOOL_YEAR
      ? `${ACTIVE_SCHOOL_YEAR}-운영데이터-${levelKey}-보드초기화`
      : `${ACTIVE_SCHOOL_YEAR}-${levelKey}-보드초기화`;

    try {
      assertDestructiveTarget({ year: ACTIVE_SCHOOL_YEAR, expectedPath: targetPath, context: "커리큘럼 보드 초기화" });
    } catch (error) {
      alert(error?.message || "초기화 대상 경로 검증에 실패했습니다.");
      return;
    }

    const impact = ACTIVE_SCHOOL_YEAR === LEGACY_SCHOOL_YEAR ? "2026 운영 데이터 직접 변경" : "없음";
    if (!confirm(`${schoolYearLabel(ACTIVE_SCHOOL_YEAR)} ${levelLabel} 보드만 초기화합니다.

실제 저장 경로: ${targetPath}
2026 운영 경로 영향: ${impact}

다른 학년도와 반대 학년군은 유지됩니다. 계속할까요?`)) return;
    const typed = prompt(`실수 방지를 위해 아래 문구를 정확히 입력하세요.

${phrase}`, "");
    if (typed === null) return;
    if (typed.trim() !== phrase) {
      alert("확인 문구가 일치하지 않아 초기화하지 않았습니다.");
      return;
    }

    const previousCurriculum = structuredClone(appState.curriculum || {});
    const beforeCounts = Object.fromEntries(targetGrades.map(grade => [grade, (previousCurriculum?.gradeBoards?.[grade] || []).length]));
    let backupInfo;
    try {
      const backupFilename = buildBackupFilename({
        year: ACTIVE_SCHOOL_YEAR,
        scope: activeTab === "tab7to9" ? "middle-curriculum" : "high-curriculum",
        operation: "board-reset",
      });
      backupInfo = downloadJsonBackup({
        version: 1,
        mode: "his-before-destructive-operation",
        exportedAt: new Date().toISOString(),
        schoolYear: ACTIVE_SCHOOL_YEAR,
        operation: "curriculum-board-reset",
        scope: levelLabel,
        targetPath,
        targetGrades,
        counts: beforeCounts,
        curriculum: previousCurriculum,
      }, backupFilename);
    } catch (error) {
      await recordDestructiveOperation({
        year: ACTIVE_SCHOOL_YEAR,
        operation: "curriculum-board-reset",
        scope: levelLabel,
        status: "blocked-backup-failed",
        targetPaths: [targetPath],
        counts: beforeCounts,
        message: error?.message || String(error),
      });
      alert(`초기화 전 JSON 백업 생성에 실패하여 작업을 중단했습니다.
${error?.message || error}`);
      return;
    }

    const options = structuredClone(appState.curriculum?.options || DEFAULT_BOARD_OPTIONS);
    const gradeBoards = structuredClone(appState.curriculum?.gradeBoards || {});
    targetGrades.forEach(grade => {
      gradeBoards[grade] = Array.from({ length: 4 }, () => makeEmptyBoardRow(options));
    });

    appState.curriculum = { options, gradeBoards };
    invalidateTabs();
    try {
      const saved = await saveNow("curriculum", { throwOnError: true });
      if (!saved) throw new Error("학년도 저장 안전장치가 저장을 차단했습니다.");
      console.info(`[board-reset] ${schoolYearLabel(ACTIVE_SCHOOL_YEAR)} ${levelLabel} 저장 완료`);
      await recordDestructiveOperation({
        year: ACTIVE_SCHOOL_YEAR,
        operation: "curriculum-board-reset",
        scope: levelLabel,
        status: "success",
        targetPaths: [targetPath],
        counts: beforeCounts,
        backupFilename: backupInfo?.filename,
        backupBytes: backupInfo?.bytes,
      });
      renderApp?.("curriculum");
    } catch (error) {
      await recordDestructiveOperation({
        year: ACTIVE_SCHOOL_YEAR,
        operation: "curriculum-board-reset",
        scope: levelLabel,
        status: "failed",
        targetPaths: [targetPath],
        counts: beforeCounts,
        backupFilename: backupInfo?.filename,
        backupBytes: backupInfo?.bytes,
        message: error?.message || String(error),
      });
      appState.curriculum = previousCurriculum;
      invalidateTabs();
      renderApp?.("curriculum");
      alert(`보드 초기화를 저장하지 못해 화면 상태를 되돌렸습니다.
${error?.message || error}`);
    }
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
