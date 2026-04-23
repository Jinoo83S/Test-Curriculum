// ================================================================
// results.js · Curriculum Result Tables
// ================================================================
import { GRADE_KEYS } from "./config.js";
import { clean, escapeHtml } from "./utils.js";
import { appState } from "./state.js";
import { getTemplateById, getTemplateCardTitle, getSemesterTemplateData, getTemplateTeacherSummary, splitTeacherNames } from "./templates.js";
import { getRosterMeta, getClassCount } from "./rosters.js";

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
      const merged = t1id && t2id && t1id === t2id;
      const s1 = t1 ? getSemesterTemplateData(t1, "sem1") : null;
      const s2 = t2 ? getSemesterTemplateData(t2, "sem2") : null;

      // Subject display
      let nameKo, nameEn, teacher, language;
      if (merged || (!t2id)) {
        nameKo   = clean(s1.nameKo)  || clean(s1.nameEn);
        nameEn   = clean(s1.nameEn)  || clean(s1.nameKo);
        teacher  = clean(s1.teacher);
        language = t1.language;
      } else if (!t1id) {
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
      const mainTplId = t1id || t2id;
      const classCount = getClassCount(mainTplId);
      const credits    = parseFloat(clean(row.credits)) || 0;
      const total      = classCount > 0 ? classCount * credits : 0;

      rows.push({
        grade, category: row.category, track: row.track, group: row.group,
        nameKo, nameEn, language, teacher, credits, classCount, total,
        isSplit: !merged && t1id && t2id
      });
    });
  });
  return rows;
}

// ── Render ────────────────────────────────────────────────────────
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

  // ── Table 1: Full curriculum ──────────────────────────────────
  const t1Wrap = document.createElement("div"); t1Wrap.className = "results-table-section";
  const t1Title = document.createElement("h3"); t1Title.className = "results-table-title"; t1Title.textContent = "표 1 · 전체 커리큘럼";
  t1Wrap.appendChild(t1Title);

  const t1 = buildTable1(rows);
  t1Wrap.appendChild(t1);
  container.appendChild(t1Wrap);

  // ── Table 2: Per-teacher ──────────────────────────────────────
  const t2Wrap = document.createElement("div"); t2Wrap.className = "results-table-section";
  const t2Title = document.createElement("h3"); t2Title.className = "results-table-title"; t2Title.textContent = "표 2 · 교사별 담당 현황";
  t2Wrap.appendChild(t2Title);

  const t2 = buildTable2(rows);
  t2Wrap.appendChild(t2);
  container.appendChild(t2Wrap);
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

function buildTable2(rows) {
  // Group rows by teacher
  const byTeacher = {};
  rows.forEach(r => {
    const rawNames = r.teacher
      ? r.teacher.split("/").flatMap(seg => splitTeacherNames(seg.replace(/^(1학기:|2학기:|Sem\d:)\s*/i, "")))
      : [];
    const teacherKeys = rawNames.length ? [...new Set(rawNames)] : ["(미배정)"];
    teacherKeys.forEach(teacher => {
      if (!byTeacher[teacher]) byTeacher[teacher] = [];
      byTeacher[teacher].push(r);
    });
  });

  const wrap = document.createElement("div"); wrap.className = "results-scroll";
  const table = document.createElement("table"); table.className = "results-table";
  table.innerHTML = `<thead><tr>
    <th>교사</th>
    <th>학년</th>
    <th>범주</th>
    <th colspan="2">과목명</th>
    <th>학급별<br>시수</th>
    <th>학급 수</th>
    <th>교사 담당<br>총 시수</th>
  </tr>
  <tr><th></th><th></th><th></th><th>한글</th><th>English</th><th></th><th></th><th></th></tr></thead>`;
  const tbody = document.createElement("tbody");

  Object.keys(byTeacher).sort((a, b) => a.localeCompare(b, "ko")).forEach(teacher => {
    const tRows = byTeacher[teacher];
    const teacherTotal = tRows.reduce((s, r) => s + (r.total || 0), 0);

    tRows.forEach((r, idx) => {
      const tr = document.createElement("tr");
      if (idx === 0) {
        const teacherTd = document.createElement("td"); teacherTd.className = "results-teacher-name-cell";
        teacherTd.rowSpan = tRows.length; teacherTd.innerHTML = `${escapeHtml(teacher)}<br><span class="results-teacher-total">총 ${teacherTotal}시수</span>`;
        tr.appendChild(teacherTd);
      }
      tr.innerHTML += `
        <td class="results-grade-cell-sm">${escapeHtml(r.grade)}</td>
        <td class="results-category">${escapeHtml(r.category)}</td>
        <td class="results-name-ko">${escapeHtml(r.nameKo)}${r.isSplit ? ' <span class="results-split-badge">학기분리</span>' : ""}</td>
        <td class="results-name-en">${escapeHtml(r.nameEn)}</td>
        <td class="results-num">${r.credits || "-"}</td>
        <td class="results-num">${r.classCount > 0 ? r.classCount : "-"}</td>
        <td class="results-num results-total-cell">${r.total > 0 ? r.total : "-"}</td>`;
      tbody.appendChild(tr);
    });

    // Separator row
    const sep = document.createElement("tr"); sep.className = "results-teacher-sep"; tbody.appendChild(sep);
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

  // Sheet 2: teacher view
  const byT = {};
  rows.forEach(r => {
    const rawNames2 = r.teacher
      ? r.teacher.split("/").flatMap(seg => splitTeacherNames(seg.replace(/^(1학기:|2학기:|Sem\d:)\s*/i, "")))
      : [];
    const tk = rawNames2.length ? [...new Set(rawNames2)] : ["(미배정)"];
    tk.forEach(t => { if (!byT[t]) byT[t] = []; byT[t].push(r); });
  });
  const s2data = [["교사","학년","범주","과목(한글)","과목(영어)","학급별시수","학급수","담당총시수","교사합계시수"]];
  Object.keys(byT).sort((a,b) => a.localeCompare(b,"ko")).forEach(teacher => {
    const tRows = byT[teacher]; const total = tRows.reduce((s,r) => s+(r.total||0),0);
    tRows.forEach((r,i) => s2data.push([i===0?teacher:"", r.grade, r.category, r.nameKo, r.nameEn, r.credits, r.classCount||"", r.total||"", i===0?total:""]));
  });
  const ws2 = XLSX.utils.aoa_to_sheet(s2data);
  ws2["!cols"] = [14,8,6,20,24,8,6,8,10].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws2, "교사별 현황");

  XLSX.writeFile(wb, "HIS_CurriculumResults.xlsx");
}
