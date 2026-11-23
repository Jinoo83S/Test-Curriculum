// Curriculum and subject-card references only. Later workflow data is outside this check.
// Checks are read-only. Issues link to the relevant board row or card editor.
import { ACTIVE_SCHOOL_YEAR, LEGACY_SCHOOL_YEAR, getSchoolYearRefs, GRADE_GROUPS } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getCurriculumMode } from "./curriculum-mode.js?v=r401";
import { LOCAL_DEV_MODE } from "./local-dev.js?v=2026-07-15-room-availability-separation-r355";
import { validateWorkspaceSnapshot } from "./school-year-integrity.js?v=2026-07-15-room-availability-separation-r355";
import { getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DOMAIN_NAMES = ["curriculum","templates"];
const CURRICULUM_CODES = new Set(["duplicate-template-id","duplicate-curriculum-row-id",
  "curriculum-template-missing"]);
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
    return { year, missing: !data?.curriculum,
      domains: Object.fromEntries(DOMAIN_NAMES.map(name => [name, data?.[name] || {}])),
      workspaceMeta: { createMode: parsed.createMode || "local" } };
  }
  const refs = getSchoolYearRefs(year);
  const documents = await Promise.all(DOMAIN_NAMES.map(async name => {
    const snapshot = await getDoc(refs.domains[name]);
    return [name, snapshot.exists() ? snapshot.data() || {} : {}, snapshot.exists()];
  }));
  return { year, missing: !documents.find(([name]) => name === "curriculum")?.[2],
    domains: Object.fromEntries(documents.map(([name, data]) => [name, data])) };
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
    const inScope = item => CURRICULUM_CODES.has(item.code) &&
      (!plan || !item.grade || item.grade === cohortGrade);
    const errors = report.errors.filter(inScope);
    const warnings = report.warnings.filter(inScope);
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
        return snapshot.missing ? { year, missing:true } : { year,
          report:validateWorkspaceSnapshot(snapshot, { year, allowEmpty:true }) };
      }));
      if (serial !== run) return;
      panel.replaceChildren(el("h2", "", plan ? "3개년 커리큘럼 검사" : "연간 커리큘럼 검사"));
      panel.append(el("p", "curriculum-audit-description", plan ?
        "선택한 3개 학년도의 편제 행과 과목카드 연결만 검사합니다. 학급·명단·시간표는 검사 대상이 아닙니다." :
        "이 학년도의 편제 행과 과목카드 연결만 검사합니다. 학급·명단·시간표는 검사 대상이 아닙니다."));
      results.forEach(({ year, report, missing }) => {
        if (missing) panel.append(el("p", "three-year-empty", year + "학년도 자료가 아직 없습니다."));
        else panel.append(renderIssues(year,report,plan));
      });
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
