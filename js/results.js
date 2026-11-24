// ================================================================
// results.js · Curriculum Result Tables
// ================================================================
import { auth, GRADE_KEYS } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { clean, escapeHtml, getEffectiveCredit } from "./utils.js?v=2026-07-15-room-availability-separation-r355";
import { appState } from "./state.js?v=r426";
import { getTemplateById, getSemesterTemplateData } from "./templates.js?v=r425";
import { getClassCount, getRosterMeta, getTeacherLoadHours } from "./rosters.js?v=r426";
import { buildReadOnlyCurriculumRows, groupTeacherAssignments, renderTeacherAssignmentTable, teacherSemesterTotal } from "./curriculum-read-view.js?v=r433";
import { facultyCourseWorkload } from "./faculty-workload.js?v=r433";

// ── Data builder ─────────────────────────────────────────────────
function buildRows() {
  const rows = [];
  GRADE_KEYS.forEach(grade => {
    (appState.curriculum.gradeBoards[grade] || []).forEach(row => {
      const t1id = row.sem1TemplateId, t2id = row.sem2TemplateId;
      if (!t1id && !t2id) return;
      const t1 = t1id ? getTemplateById(t1id) : null;
      const t2 = t2id ? getTemplateById(t2id) : null;
      const tpl = t1 || t2;
      if (!tpl) return;
      const s1 = t1 ? getSemesterTemplateData(t1, "sem1") : null;
      const s2 = t2 ? getSemesterTemplateData(t2, "sem2") : null;

      // Subject display
      let nameKo, nameEn, teacher, language;
      if (s1 && !s2) {
        nameKo   = clean(s1.nameKo)  || clean(s1.nameEn);
        nameEn   = clean(s1.nameEn)  || clean(s1.nameKo);
        teacher  = clean(s1.teacher);
        language = t1.language;
      } else if (!s1) {
        nameKo   = clean(s2.nameKo)  || clean(s2.nameEn);
        nameEn   = clean(s2.nameEn)  || clean(s2.nameKo);
        teacher  = clean(s2.teacher);
        language = t2.language;
      } else {
        // Split: may be same name or different
        const ko1 = clean(s1.nameKo)||clean(s1.nameEn), ko2 = clean(s2.nameKo)||clean(s2.nameEn);
        const en1 = clean(s1.nameEn)||clean(s1.nameKo), en2 = clean(s2.nameEn)||clean(s2.nameKo);
        const te1 = clean(s1.teacher), te2 = clean(s2.teacher);
        nameKo   = ko1 === ko2 ? ko1 : `1학기: ${ko1} / 2학기: ${ko2}`;
        nameEn   = en1 === en2 ? en1 : `Sem1: ${en1} / Sem2: ${en2}`;
        teacher  = te1 === te2 ? te1 : `1학기: ${te1} / 2학기: ${te2}`;
        language = t1.language === t2.language ? t1.language : `${t1.language}/${t2.language}`;
      }

      // classCount: prefer from the primary template (sem1 if exists, else sem2)
      const mainTplId = t1?.id || t2?.id;
      const classCount = getClassCount(mainTplId);
      const credits    = getEffectiveCredit(row);
      const total      = getTeacherLoadHours(mainTplId, credits);

      rows.push({
        grade, category: row.category, track: row.track, group: row.group,
        nameKo, nameEn, language, teacher, credits, classCount, total,
        isSplit: !!(s1 && s2 && (t1id !== t2id || s1.nameKo !== s2.nameKo || s1.nameEn !== s2.nameEn))
      });
    });
  });
  return rows;
}

// ── Render ────────────────────────────────────────────────────────
let activeResultsTab = "full";
function teacherAssignmentRows() {
  return buildReadOnlyCurriculumRows(appState.curriculum, appState.templates.templates, appState.teachers?.teachers,
    (id, credits) => facultyCourseWorkload(getRosterMeta(id), credits));
}

function teacherResultsPanel() {
  const rows = teacherAssignmentRows();
  const email = clean(auth.currentUser?.email).toLowerCase();
  const self = email && appState.teachers?.teachers?.find(teacher => clean(teacher.email).toLowerCase() === email);
  return renderTeacherAssignmentTable(groupTeacherAssignments(rows, null, self || null), { workload: true });
}

export function renderResultsView(container) {
  container.innerHTML = "";

  const hdr = document.createElement("div"); hdr.className = "results-header";
  const title = document.createElement("h2"); title.textContent = "커리큘럼 결과표";
  const exportBtn = document.createElement("button"); exportBtn.className = "secondary-btn"; exportBtn.type = "button";
  exportBtn.textContent = "📥 엑셀 내보내기";
  exportBtn.addEventListener("click", exportResultsXlsx);
  hdr.append(title, exportBtn);
  container.appendChild(hdr);

  const rows = buildRows();
  if (!rows.length) {
    const e = document.createElement("div"); e.className = "manager-empty"; e.textContent = "커리큘럼에 배치된 과목이 없습니다."; container.appendChild(e); return;
  }

  const tabBar = document.createElement("div");
  tabBar.className = "tab-bar results-tab-bar";
  tabBar.style.marginBottom = "10px";

  const content = document.createElement("div");
  content.className = "results-tab-content";

  const makeTabBtn = (key, label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab-btn" + (activeResultsTab === key ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      activeResultsTab = key;
      [...tabBar.children].forEach(child => child.classList.toggle("active", child.dataset.tab === key));
      renderResultsTabContent(content, rows);
    });
    btn.dataset.tab = key;
    return btn;
  };

  tabBar.append(
    makeTabBtn("full", "전체 커리큘럼"),
    makeTabBtn("teacher", "교사별 담당 현황")
  );
  container.appendChild(tabBar);
  container.appendChild(content);
  renderResultsTabContent(content, rows);
}

function renderResultsTabContent(container, rows) {
  container.innerHTML = "";

  if (activeResultsTab === "teacher") {
    const t2Wrap = document.createElement("div"); t2Wrap.className = "results-table-section";
    const t2Title = document.createElement("h3"); t2Title.className = "results-table-title"; t2Title.textContent = "교사별 담당 현황";
    t2Wrap.appendChild(t2Title);
    t2Wrap.appendChild(teacherResultsPanel());
    container.appendChild(t2Wrap);
    return;
  }

  const t1Wrap = document.createElement("div"); t1Wrap.className = "results-table-section";
  const t1Title = document.createElement("h3"); t1Title.className = "results-table-title"; t1Title.textContent = "전체 커리큘럼";
  t1Wrap.appendChild(t1Title);
  t1Wrap.appendChild(buildTable1(rows));
  container.appendChild(t1Wrap);
}

function buildTable1(rows) {
  const wrap = document.createElement("div"); wrap.className = "results-scroll";
  const table = document.createElement("table"); table.className = "results-table";
  table.innerHTML = `<thead><tr>
    <th rowspan="2">학년</th>
    <th rowspan="2">범주</th>
    <th rowspan="2">구분</th>
    <th rowspan="2">교과군</th>
    <th colspan="2">과목명</th>
    <th rowspan="2">언어</th>
    <th rowspan="2">담당 교사</th>
    <th rowspan="2">학급별<br>시수</th>
    <th rowspan="2">학급 수</th>
    <th rowspan="2">과목<br>총시수</th>
  </tr>
  <tr><th>한글</th><th>English</th></tr></thead>`;
  const tbody = document.createElement("tbody");

  const gradeGroups = {};
  rows.forEach(r => { gradeGroups[r.grade] = (gradeGroups[r.grade] || 0) + 1; });
  let prevGrade = null;

  function mkTd(cls, html, extra = {}) {
    const td = document.createElement("td");
    if (cls) td.className = cls;
    td.innerHTML = html;
    if (extra.rowSpan) td.rowSpan = extra.rowSpan;
    return td;
  }

  rows.forEach(r => {
    const tr = document.createElement("tr");
    if (r.grade !== prevGrade) {
      const td = document.createElement("td"); td.className = "results-grade-cell";
      td.rowSpan = gradeGroups[r.grade]; td.textContent = r.grade;
      tr.appendChild(td); prevGrade = r.grade;
    }
    const totalClass = r.total > 0 ? "results-total-cell" : "";
    const nameSuffix = r.isSplit ? ' <span class="results-split-badge">학기분리</span>' : "";
    [
      mkTd("results-category", escapeHtml(r.category)),
      mkTd("", escapeHtml(r.track)),
      mkTd("", escapeHtml(r.group)),
      mkTd("results-name-ko", escapeHtml(r.nameKo) + nameSuffix),
      mkTd("results-name-en", escapeHtml(r.nameEn)),
      mkTd("results-lang", escapeHtml(r.language)),
      mkTd("results-teacher", escapeHtml(r.teacher)),
      mkTd("results-num", String(r.credits || "-")),
      mkTd("results-num", r.classCount > 0 ? String(r.classCount) : "-"),
      mkTd("results-num " + totalClass, r.total > 0 ? String(r.total) : "-"),
    ].forEach(td => tr.appendChild(td));
    tbody.appendChild(tr);
  });

  table.appendChild(tbody); wrap.appendChild(table); return wrap;
}


// ── Excel Export ──────────────────────────────────────────────────
export function exportResultsXlsx() {
  const rows = buildRows();
  const wb = XLSX.utils.book_new();

  // Sheet 1
  const s1data = [["학년","범주","구분","교과군","과목(한글)","과목(영어)","언어","교사","학급별시수","학급수","과목총시수"]];
  rows.forEach(r => s1data.push([r.grade, r.category, r.track, r.group, r.nameKo, r.nameEn, r.language, r.teacher, r.credits, r.classCount || "", r.total || ""]));
  const ws1 = XLSX.utils.aoa_to_sheet(s1data);
  ws1["!cols"] = [8,6,6,8,20,24,8,14,8,6,8].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws1, "전체 커리큘럼");

  // Keep both semesters on the same row for each teacher's assignment.
  const assignments = teacherAssignmentRows();
  const s2data = [["교사","학년","범주","1학기 과목명","2학기 과목명","학급별시수","1학기 학급수","2학기 학급수","1학기 과목별 시수","2학기 과목별 시수","1학기 교사 합계","2학기 교사 합계"]];
  const subjectLabel = subject => subject ? [...new Set([subject.name, subject.english].filter(Boolean))].join(" / ") : "";
  for (const teacher of groupTeacherAssignments(assignments, null)) {
    const totals = ["sem1", "sem2"].map(term => teacherSemesterTotal(teacher, term) ?? "");
    teacher.rows.forEach(({ grade, category, credits, sem1, sem2 }, index) => {
      s2data.push([teacher.name || "미배정", grade, category, subjectLabel(sem1), subjectLabel(sem2), credits,
        sem1?.classCount ?? "", sem2?.classCount ?? "", sem1?.total ?? "", sem2?.total ?? "",
        ...(index === 0 ? totals : ["", ""])]);
    });
  }
  const ws2 = XLSX.utils.aoa_to_sheet(s2data);
  ws2["!cols"] = [14,8,8,34,34,12,12,12,15,15,15,15].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws2, "교사별 현황");

  XLSX.writeFile(wb, "HIS_CurriculumResults.xlsx");
}
