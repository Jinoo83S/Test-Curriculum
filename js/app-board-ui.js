// ================================================================
// app-board-ui.js · Curriculum board tabs / export / reset UI
// ================================================================
import { GRADE_GROUPS, ACTIVE_SCHOOL_YEAR, LEGACY_SCHOOL_YEAR, assertSchoolYearWriteContext, schoolYearDomainPath } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { schoolYearLabel } from "./school-year.js?v=2026-07-15-room-availability-separation-r355";
import { canEdit } from "./auth.js?v=2026-07-15-room-availability-separation-r355";
import { appState, saveNow } from "./state.js?v=2026-07-15-room-availability-separation-r355";
import { assertDestructiveTarget, buildBackupFilename, downloadJsonBackup, recordDestructiveOperation } from "./destructive-operation-guard.js?v=2026-07-15-room-availability-separation-r355";


function parseSheetCells(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === "\t") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("따옴표가 닫히지 않은 행이 있습니다. 시트 범위를 다시 복사해 주세요.");
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function parseCurriculumSheet(text) {
  const rows = parseSheetCells(text);
  const header = rows.shift() || [];
  const clean = value => String(value ?? "").trim();
  if (clean(header[0]) !== "학년\nGrade" || clean(header[5]) !== "NEIS 과목명 1"
      || clean(header[11]) !== "학급별 시수\n#Credits") {
    throw new Error("구글시트 커리큘럼 원자료의 열 구성이 다릅니다. 학년 열부터 열 제목을 포함해 복사해 주세요.");
  }
  const items = []; const invalid = [];
  rows.forEach((cells, index) => {
    if (!cells.some(value => clean(value))) return;
    const grade = clean(cells[0]);
    if (!/^(7|8|9|10|11|12)$/.test(grade)) { invalid.push(index + 2); return; }
    const nameKo = clean(cells[5]), nameEn = clean(cells[6]);
    const sem2NameKo = clean(cells[7]) || nameKo, sem2NameEn = clean(cells[8]) || nameEn;
    const credits = clean(cells[11]);
    if (!nameKo || !credits || !/^\d+(?:\.\d+)?$/.test(credits)) { invalid.push(index + 2); return; }
    const teachers1 = cells.slice(16, 19).map(clean).filter(Boolean).join(", ");
    const teachers2 = cells.slice(19, 22).map(clean).filter(Boolean).join(", ");
    const category = clean(cells[1]).startsWith("창의적 체험활동") ? "창체" : "교과";
    items.push({
      grade: grade + "학년", category, track: clean(cells[3]) || "공통",
      group: clean(cells[4]) || "선택", nameKo, nameEn, sem2NameKo, sem2NameEn,
      language: clean(cells[9]), credits, teachers1, teachers2,
    });
  });
  if (invalid.length) throw new Error("필수 값 또는 학년·시수가 올바르지 않은 원자료 행: " + invalid.slice(0, 12).join(", "));
  if (!items.length) throw new Error("가져올 과목 행이 없습니다.");
  return items;
}

function createImportedTemplate(item) {
  const split = item.nameKo !== item.sem2NameKo || item.nameEn !== item.sem2NameEn
    || item.teachers1 !== item.teachers2;
  return {
    id: "tpl-import-" + crypto.randomUUID(),
    nameKo: item.nameKo, nameEn: item.nameEn, teacher: item.teachers1,
    language: ["Korean", "English", "Both"].includes(item.language) ? item.language : "Both",
    schoolLevel: Number(item.grade.replace("학년", "")) <= 9 ? "중등" : "고등",
    useSemesterOverrides: split,
    sem1NameKo: split ? item.nameKo : "", sem1NameEn: split ? item.nameEn : "",
    sem1Teacher: split ? item.teachers1 : "",
    sem2NameKo: split ? item.sem2NameKo : "", sem2NameEn: split ? item.sem2NameEn : "",
    sem2Teacher: split ? item.teachers2 : "",
  };
}

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


  const pasteArea = document.getElementById("curriculumRawPasteArea");
  const previewBtn = document.getElementById("curriculumRawPreviewBtn");
  const importBtn = document.getElementById("curriculumRawImportBtn");
  const pastePreview = document.getElementById("curriculumRawPreview");
  const pasteYear = document.getElementById("curriculumRawYear");
  let pendingPaste = null;

  if (pasteYear) pasteYear.textContent = schoolYearLabel(ACTIVE_SCHOOL_YEAR);
  pasteArea?.addEventListener("input", () => {
    pendingPaste = null;
    if (importBtn) importBtn.disabled = true;
    if (pastePreview) pastePreview.textContent = "원자료를 수정했습니다. 다시 미리보기를 눌러 주세요.";
  });
  previewBtn?.addEventListener("click", () => {
    try {
      const items = parseCurriculumSheet(pasteArea?.value || "");
      const counts = Object.fromEntries(GRADE_GROUPS.tab7to9.concat(GRADE_GROUPS.tab10to12)
        .map(grade => [grade, items.filter(item => item.grade === grade).length]).filter(([, count]) => count));
      pendingPaste = { items, text: pasteArea.value };
      if (pastePreview) pastePreview.textContent =
        schoolYearLabel(ACTIVE_SCHOOL_YEAR) + " · " + items.length + "개 과목 · " +
        Object.entries(counts).map(([grade, count]) => grade + " " + count + "개").join(" / ") +
        "\n이 학년의 기존 보드 행만 교체하고, 다른 학년도는 변경하지 않습니다.";
      if (importBtn) importBtn.disabled = !canEdit();
    } catch (error) {
      pendingPaste = null;
      if (importBtn) importBtn.disabled = true;
      if (pastePreview) pastePreview.textContent = error?.message || String(error);
    }
  });
  importBtn?.addEventListener("click", async () => {
    if (!canEdit() || !pendingPaste || pendingPaste.text !== pasteArea?.value) return;
    try { assertSchoolYearWriteContext("커리큘럼 원자료 붙여넣기"); }
    catch (error) { alert(error?.message || String(error)); return; }
    const items = pendingPaste.items;
    const grades = [...new Set(items.map(item => item.grade))];
    const targetPath = schoolYearDomainPath("curriculum");
    const templatePath = schoolYearDomainPath("templates");
    if (!confirm(
      schoolYearLabel(ACTIVE_SCHOOL_YEAR) + "에 " + items.length + "개 과목을 적용합니다.\n" +
      "대상: " + grades.join(", ") + "\n저장 경로: " + targetPath + "\n" +
      "해당 학년의 기존 보드 행은 교체됩니다. 계속할까요?"
    )) return;
    const previousCurriculum = structuredClone(appState.curriculum);
    const previousTemplates = structuredClone(appState.templates);
    try {
      downloadJsonBackup({
        version: 1, mode: "his-before-curriculum-paste", schoolYear: ACTIVE_SCHOOL_YEAR,
        exportedAt: new Date().toISOString(), targetPaths: [targetPath, templatePath],
        curriculum: previousCurriculum, templates: previousTemplates,
      }, buildBackupFilename({ year: ACTIVE_SCHOOL_YEAR, scope: "curriculum", operation: "paste-import" }));
    } catch (error) { alert("기존 데이터 백업에 실패해 적용을 중단했습니다.\n" + (error?.message || error)); return; }

    importBtn.disabled = true;
    try {
      const nextCurriculum = structuredClone(previousCurriculum);
      const nextTemplates = structuredClone(previousTemplates);
      const options = nextCurriculum.options;
      for (const item of items) {
        if (!options.category.includes(item.category)) options.category.push(item.category);
        if (!options.track.includes(item.track)) options.track.push(item.track);
        if (!options.group.includes(item.group)) options.group.push(item.group);
      }
      for (const grade of grades) nextCurriculum.gradeBoards[grade] = [];
      for (const item of items) {
        const template = createImportedTemplate(item);
        nextTemplates.templates.push(template);
        nextCurriculum.gradeBoards[item.grade].push({
          id: "row-import-" + crypto.randomUUID(),
          category: item.category, track: item.track, group: item.group, credits: item.credits,
          sem1TemplateId: template.id, sem2TemplateId: template.id,
        });
      }
      appState.templates = nextTemplates;
      appState.curriculum = nextCurriculum;
      const templateSaved = await saveNow("templates", { throwOnError: true });
      const boardSaved = templateSaved && await saveNow("curriculum", { throwOnError: true });
      if (!boardSaved) throw new Error("서버 저장을 완료하지 못했습니다.");
      pendingPaste = null;
      if (pasteArea) pasteArea.value = "";
      if (pastePreview) pastePreview.textContent = schoolYearLabel(ACTIVE_SCHOOL_YEAR) + " 저장 완료 · " + items.length + "개 과목";
      invalidateTabs();
      renderApp?.("all");
    } catch (error) {
      appState.curriculum = previousCurriculum;
      appState.templates = previousTemplates;
      invalidateTabs();
      renderApp?.("all");
      alert("가져오기를 완료하지 못했습니다. 내려받은 백업 파일을 보관해 주세요.\n" + (error?.message || error));
    } finally { importBtn.disabled = !pendingPaste; }
  });

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
