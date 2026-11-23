// Curriculum-board entry point for the same workspace integrity rules used in school-year management.
// Checks are read-only. Issues link to the relevant board row or card editor.
import { ACTIVE_SCHOOL_YEAR, LEGACY_SCHOOL_YEAR, getSchoolYearRefs, GRADE_GROUPS } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getCurriculumMode } from "./curriculum-mode.js?v=r401";
import { LOCAL_DEV_MODE } from "./local-dev.js?v=2026-07-15-room-availability-separation-r355";
import { validateWorkspaceSnapshot } from "./school-year-integrity.js?v=2026-07-15-room-availability-separation-r355";
import { getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DOMAIN_NAMES = ["curriculum","templates","classes","teachers","rosters","rooms","timetable"];
const COLLECTION_NAMES = ["classes","rosters","timetableEntries","ttcards"];
const PLAN_CODES = new Set(["duplicate-template-id","duplicate-curriculum-row-id",
  "curriculum-template-missing","templates-empty","templates-empty-draft"]);
const el = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
};
async function readSnapshot(year) {
  if (LOCAL_DEV_MODE) {
    const key = year === LEGACY_SCHOOL_YEAR ? "his_local_dev_state_v1" : "his_local_dev_state_v1_" + year;
    const saved = localStorage.getItem(key);
    const parsed = saved ? JSON.parse(saved) : {};
    const data = parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed;
    return { year, domains: Object.fromEntries(DOMAIN_NAMES.map(name => [name, data?.[name] || {}])),
      workspaceMeta: { createMode: parsed.createMode || "local" } };
  }
  const refs = getSchoolYearRefs(year);
  const [documents, collections, meta] = await Promise.all([
    Promise.all(DOMAIN_NAMES.map(async name => {
      const doc = await getDoc(refs.domains[name]);
      return [name, doc.exists() ? doc.data() || {} : {}];
    })),
    Promise.all(COLLECTION_NAMES.map(async name => {
      const collection = await getDocs(refs.collections[name]);
      return [name, collection.docs.map(doc => ({ id: doc.id, data: doc.data() || {} }))];
    })),
    refs.workspaceMeta ? getDoc(refs.workspaceMeta) : Promise.resolve(null),
  ]);
  return { year, domains: Object.fromEntries(documents),
    ...Object.fromEntries(collections), workspaceMeta: meta?.exists() ? meta.data() || {} : {} };
}
export function setupCurriculumIntegrityUi({ boardUi, navigateToManager } = {}) {
  const button = document.getElementById("curriculumIntegrityBtn");
  const panel = document.getElementById("curriculumIntegrityPanel");
  if (!button || !panel) return;
  let checking = false;
  let run = 0;
  const focusRow = (grade, rowId) => {
    const tab = Number.parseInt(grade,10) <= 9 ? "tab7to9" : "tab10to12";
    boardUi?.setActiveTab?.(tab);
    if (boardUi?.getActiveTab?.() === tab) boardUi?.renderBoardTab?.();
    let attempts = 0;
    const seek = () => {
      const row = [...document.querySelectorAll("#gradeBoard .grade-data-row")].find(item =>
        item.dataset.grade === grade && item.dataset.rowId === rowId);
      if (row) {
        row.scrollIntoView({ behavior:"smooth", block:"center" });
        row.classList.add("curriculum-audit-highlight");
        setTimeout(() => row.classList.remove("curriculum-audit-highlight"), 3500);
      } else if (++attempts < 30) setTimeout(seek, 120);
    };
    seek();
  };
  const renderIssues = (year, report, plan) => {
    const cohortGrade = (GRADE_GROUPS[boardUi?.getActiveTab?.() || "tab7to9"] || [])
      .find(grade => String(Number(ACTIVE_SCHOOL_YEAR) + (Number.parseInt(grade,10) <= 9
        ? Number.parseInt(grade,10) - 7 : Number.parseInt(grade,10) - 10)) === year);
    const inScope = item => PLAN_CODES.has(item.code) && (!item.grade || item.grade === cohortGrade);
    const errors = plan ? report.errors.filter(inScope) : report.errors;
    const warnings = plan ? report.warnings.filter(inScope) : report.warnings;
    const section = el("section", "curriculum-audit-year");
    section.append(el("h3", "", year + "학년도 · " +
      (errors.length ? "오류 " + errors.length + "건" : "커리큘럼 오류 없음") +
      " · 경고 " + warnings.length + "건"));
    if (!errors.length && !warnings.length) {
      section.append(el("p", "three-year-empty", "검사 범위에서 참조 오류가 발견되지 않았습니다."));
    }
    const list = el("ol", "curriculum-audit-issues");
    for (const [kind, items] of [["오류", errors], ["경고", warnings]]) {
      for (const issue of items) {
        const item = el("li", kind === "오류" ? "audit-error" : "audit-warning");
        item.append(el("span", "", kind + " · " + issue.message));
        const grade = issue.grade, rowId = issue.rowId;
        const inTab = !plan || (GRADE_GROUPS[boardUi?.getActiveTab?.() || "tab7to9"] || [])
          .some(g => g === grade && String(Number(ACTIVE_SCHOOL_YEAR) +
            (Number.parseInt(g,10) <= 9 ? Number.parseInt(g,10) - 7 : Number.parseInt(g,10) - 10)) === year);
        if (grade && rowId && inTab) {
          const fix = el("button", "secondary-btn", "보드 행으로 이동");
          fix.type = "button"; fix.addEventListener("click", () => focusRow(grade,rowId)); item.append(fix);
        } else if (issue.templateId || issue.code === "duplicate-template-id") {
          const fix = el("button", "secondary-btn", "과목카드 편집");
          fix.type = "button"; fix.addEventListener("click", () => navigateToManager?.()); item.append(fix);
        }
        list.append(item);
      }
    }
    section.append(list);
    if (!plan && (errors.length || warnings.length)) {
      const link = el("a", "secondary-btn curriculum-audit-year-link", "학년도 관리에서 전체 결과 보기");
      link.href = "school-years.html"; section.append(link);
    }
    return section;
  };
  async function check() {
    if (checking) return;
    checking = true; button.disabled = true;
    const serial = ++run;
    const plan = getCurriculumMode() === "threeYear";
    const grades = GRADE_GROUPS[boardUi?.getActiveTab?.() || "tab7to9"] || [];
    const years = plan ? [...new Set(grades.map(grade => String(Number(ACTIVE_SCHOOL_YEAR) +
      (Number.parseInt(grade,10) <= 9 ? Number.parseInt(grade,10) - 7 : Number.parseInt(grade,10) - 10))))]
      : [ACTIVE_SCHOOL_YEAR];
    panel.hidden = false;
    panel.replaceChildren(el("p", "three-year-empty", "정합성 검사 중입니다. 학년도별 자료를 읽고 있습니다…"));
    try {
      const results = await Promise.all(years.map(async year => {
        const snapshot = await readSnapshot(year);
        return { year, report:validateWorkspaceSnapshot(snapshot, {
          year, allowEmpty:snapshot.workspaceMeta?.createMode === "empty"
        }) };
      }));
      if (serial !== run) return;
      panel.replaceChildren(el("h2", "", plan ? "3개년 커리큘럼·과목카드 검사" : "학년도 전체 정합성 검사"));
      panel.append(el("p", "curriculum-audit-description", plan ?
        "선택한 3개 학년도의 커리큘럼 행과 과목카드 참조를 검사합니다. 명단·시간표 오류는 이 화면에 표시하지 않습니다." :
        "학년도 관리와 같은 정합성 검사입니다. 보드 행과 과목카드 문제는 아래에서 바로 이동해 수정할 수 있습니다."));
      results.forEach(({ year, report }) => panel.append(renderIssues(year,report,plan)));
      panel.append(el("p", "curriculum-audit-description", "검사 시각: " + new Date().toLocaleString("ko-KR")));
    } catch (error) {
      panel.replaceChildren(el("p", "audit-error", "검사 실패 · " + (error?.message || error)));
    } finally {
      checking = false; button.disabled = false;
    }
  }
  button.addEventListener("click", () => { void check(); });
  document.getElementById("curriculumModeSelect")?.addEventListener("change", () => {
    ++run; panel.hidden = true;
  });
  for (const id of ["tab7to9Btn","tab10to12Btn"]) {
    document.getElementById(id)?.addEventListener("click", () => { ++run; panel.hidden = true; });
  }
}
