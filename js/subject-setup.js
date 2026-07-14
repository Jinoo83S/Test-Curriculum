// ================================================================
// subject-setup.js · Subject Track Groups + Section Count
// ================================================================
import { GRADE_KEYS } from "./config.js";

const SETUP_LEVELS = {
  middle: { label: "중등", hint: "7–9학년", grades: ["7학년", "8학년", "9학년"] },
  high:   { label: "고등", hint: "10–12학년", grades: ["10학년", "11학년", "12학년"] },
};
let activeSetupLevel = "middle";

function getActiveSetupGrades() {
  return SETUP_LEVELS[activeSetupLevel]?.grades || SETUP_LEVELS.middle.grades;
}

function renderSetupLevelTabs(onChange) {
  const tabs = document.createElement("div");
  tabs.className = "setup-level-tabs";
  Object.entries(SETUP_LEVELS).forEach(([key, info]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "setup-level-tab" + (key === activeSetupLevel ? " active" : "");
    btn.innerHTML = `<strong>${info.label}</strong><span>${info.hint}</span>`;
    btn.addEventListener("click", () => {
      if (activeSetupLevel === key) return;
      activeSetupLevel = key;
      onChange?.();
    });
    tabs.appendChild(btn);
  });
  return tabs;
}
import { makeBtn, gradeDisplay, sectionLabel } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState } from "./state.js?v=2026-07-14-school-year-workspaces-r345";
import { getTemplateById, getTemplateCardTitle, getTemplateTeacherSummary } from "./templates.js";
import { getRosterMeta, setRosterClassCount, getClassCount } from "./rosters.js";

// ── Build rows from curriculum IN BOARD ORDER ─────────────────────
function buildRows(gradeKeys = GRADE_KEYS) {
  const rows = [];
  gradeKeys.forEach(gradeKey => {
    const board = appState.curriculum.gradeBoards[gradeKey] || [];
    const seenTpl = new Set();
    board.forEach(row => {
      [row.sem1TemplateId, row.sem2TemplateId].filter(Boolean).forEach(tplId => {
        if (seenTpl.has(tplId)) return; seenTpl.add(tplId);
        rows.push({
          gradeKey,
          category: row.category || "교과",
          track:    row.track    || "공통",
          tplId,
          credits:  row.credits,
        });
      });
    });
  });
  return rows;
}

// ── Group preserving curriculum order ────────────────────────────
// Returns: { gradeKey → [ { track, category, rows[], order } ] }
function groupByGradeTrack(rows) {
  const result = {};
  rows.forEach(r => {
    if (!result[r.gradeKey]) result[r.gradeKey] = [];
    const gradeGroups = result[r.gradeKey];
    // Find existing group with same track — only if it's the LAST group (preserve order)
    const last = gradeGroups[gradeGroups.length - 1];
    if (last && last.track === r.track && last.category === r.category) {
      last.rows.push(r);
    } else {
      gradeGroups.push({ track: r.track, category: r.category, rows: [r] });
    }
  });
  return result;
}

// ── Render ────────────────────────────────────────────────────────
export function renderSubjectSetupView(container) {
  container.innerHTML = "";

  const hdr = document.createElement("div"); hdr.className = "ss-header ss-compact-header";
  const titleWrap = document.createElement("div"); titleWrap.className = "ss-title-wrap";
  const title = document.createElement("h2"); title.textContent = "과목 설정";
  titleWrap.appendChild(title);
  const tabs = renderSetupLevelTabs(() => renderSubjectSetupView(container));
  hdr.append(titleWrap, tabs); container.appendChild(hdr);

  const activeGrades = getActiveSetupGrades();
  const rows = buildRows(activeGrades);
  if (!rows.length) {
    const e = document.createElement("div"); e.className = "manager-empty";
    e.textContent = `${SETUP_LEVELS[activeSetupLevel].label} 과정에 배치된 과목이 없습니다. 먼저 커리큘럼 보드에서 과목을 배치하세요.`;
    container.appendChild(e); return;
  }

  const tableWrap = document.createElement("div"); tableWrap.className = "ss-table-wrap";
  const table = document.createElement("table"); table.className = "ss-table";

  // ── Header: 학년 | 범주 | 구분 | 과목명 | 교사 | 시수 | 반 수 | 반 ─────
  table.innerHTML = `<thead><tr>
    <th class="ss-th-grade">학년</th>
    <th class="ss-th-cat">범주</th>
    <th class="ss-th-track">구분</th>
    <th class="ss-th-subject">과목명</th>
    <th class="ss-th-teacher">교사</th>
    <th class="ss-th-credits">시수</th>
    <th class="ss-th-count">반 수</th>
    <th class="ss-th-preview">반</th>
  </tr></thead>`;

  const tbody = document.createElement("tbody");
  const COL_COUNT = 8;
  const grouped = groupByGradeTrack(rows);

  activeGrades.forEach(gradeKey => {
    const gradeGroups = grouped[gradeKey]; if (!gradeGroups) return;

    // Calculate total rowspan for grade cell (valid rows + subtotal rows)
    const totalGradeSpan = gradeGroups.reduce((sum, grp) => {
      const valid = grp.rows.filter(r => !!getTemplateById(r.tplId)).length;
      const isChoice = grp.track !== "공통" && valid > 1;
      return sum + valid + (isChoice ? 1 : 0);
    }, 0);
    if (!totalGradeSpan) return;

    let gradeRendered = false;

    gradeGroups.forEach(grp => {
      const validRows = grp.rows.filter(r => !!getTemplateById(r.tplId));
      if (!validRows.length) return;

      const isChoice = grp.track !== "공통" && validRows.length > 1;
      let trackRendered = false, catRendered = false;

      validRows.forEach(r => {
        const tpl = getTemplateById(r.tplId);
        const tr  = document.createElement("tr");
        if (isChoice) tr.className = "ss-row-choice";
        updateMissingClassCountState(tr, null, r.tplId);

        // Grade cell
        if (!gradeRendered) {
          const td = document.createElement("td"); td.className = "ss-td-grade";
          td.rowSpan = totalGradeSpan; td.textContent = gradeDisplay(gradeKey);
          tr.appendChild(td); gradeRendered = true;
        }

        // 범주 cell
        if (!catRendered) {
          const td = document.createElement("td"); td.className = "ss-td-cat";
          td.rowSpan = validRows.length;
          const badge = document.createElement("span");
          badge.className = "ss-cat-badge " + (grp.category === "창체" ? "ss-cat-changjae" : "ss-cat-gwa");
          badge.textContent = grp.category || "교과";
          td.appendChild(badge); tr.appendChild(td); catRendered = true;
        }

        // 구분 cell (track only, no 교과군)
        if (!trackRendered) {
          const td = document.createElement("td"); td.className = "ss-td-track";
          td.rowSpan = validRows.length;
          const badge = document.createElement("span");
          badge.className = "ss-track-badge " + (isChoice ? "ss-badge-choice" : "ss-badge-common");
          badge.textContent = grp.track;
          if (isChoice) { const hint = document.createElement("div"); hint.className = "ss-choice-hint"; hint.textContent = "택1"; td.appendChild(hint); }
          td.appendChild(badge); tr.appendChild(td); trackRendered = true;
        }

        // 과목명
        const tdName = document.createElement("td"); tdName.className = "ss-td-name";
        tdName.textContent = getTemplateCardTitle(tpl); tr.appendChild(tdName);

        // 교사
        const tdTch = document.createElement("td"); tdTch.className = "ss-td-teacher";
        tdTch.textContent = getTemplateTeacherSummary(tpl) || "-"; tr.appendChild(tdTch);

        // 시수
        const tdCr = document.createElement("td"); tdCr.className = "ss-td-credits";
        tdCr.textContent = r.credits != null && r.credits !== "" ? r.credits : "-"; tr.appendChild(tdCr);

        // 반 수 input
        const tdCnt = document.createElement("td"); tdCnt.className = "ss-td-count";
        const inp = document.createElement("input"); inp.type = "number"; inp.min = "0"; inp.max = "20";
        inp.className = "ss-count-input"; inp.disabled = !canEdit();
        inp.value = getRosterMeta(r.tplId).classCount || ""; inp.placeholder = "0";
        const preview = document.createElement("td"); preview.className = "ss-td-preview";
        inp.addEventListener("change", e => {
          const v = parseInt(e.target.value) || 0;
          setRosterClassCount(r.tplId, v || "");
          renderPreview(preview, r.tplId);
          updateMissingClassCountState(tr, tdCnt, r.tplId);
        });
        tdCnt.appendChild(inp);
        updateMissingClassCountState(tr, tdCnt, r.tplId);
        tr.appendChild(tdCnt);

        // 반 preview
        renderPreview(preview, r.tplId);
        tr.appendChild(preview);

        tbody.appendChild(tr);
      });

      // 선택군 합계 row
      if (isChoice) {
        const totalRow = document.createElement("tr"); totalRow.className = "ss-track-total";
        const totalTd = document.createElement("td"); totalTd.colSpan = COL_COUNT;
        const total = validRows.reduce((s, r) => s + getClassCount(r.tplId), 0);
        totalTd.innerHTML = `<span class="ss-total-label">↑ ${grp.track} 선택군 합계</span><span class="ss-total-val">${total}반</span>`;
        totalRow.appendChild(totalTd); tbody.appendChild(totalRow);
      }
    });

    // Grade separator
    const sepRow = document.createElement("tr"); sepRow.className = "ss-grade-sep";
    const sepTd = document.createElement("td"); sepTd.colSpan = COL_COUNT; sepRow.appendChild(sepTd);
    tbody.appendChild(sepRow);
  });

  table.appendChild(tbody); tableWrap.appendChild(table);
  container.appendChild(tableWrap);
}

function updateMissingClassCountState(rowEl, countCell, tplId) {
  const missing = getClassCount(tplId) <= 0;
  if (rowEl) {
    rowEl.classList.toggle("ss-row-missing-classcount", missing);
    rowEl.title = missing ? "반 수가 지정되지 않은 과목입니다." : "";
  }
  if (!countCell) return;
  countCell.querySelectorAll(".ss-missing-count-badge").forEach(el => el.remove());
  if (missing) {
    const badge = document.createElement("div");
    badge.className = "ss-missing-count-badge";
    badge.textContent = "반수 미지정";
    countCell.appendChild(badge);
  }
}

function renderPreview(el, tplId) {
  el.innerHTML = "";
  const cc = getClassCount(tplId);
  for (let i = 0; i < Math.min(cc, 8); i++) {
    const chip = document.createElement("span"); chip.className = "ss-sec-chip";
    chip.textContent = sectionLabel(i); el.appendChild(chip);
  }
  if (cc > 8) {
    const more = document.createElement("span"); more.className = "ss-sec-chip ss-sec-more";
    more.textContent = `+${cc - 8}`; el.appendChild(more);
  }
}
