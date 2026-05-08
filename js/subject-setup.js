// ================================================================
// subject-setup.js · Subject Track Groups + Section Count
// ================================================================
import { GRADE_KEYS } from "./config.js";
import { makeBtn, gradeDisplay, sectionLabel } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState } from "./state.js";
import { getTemplateById, getTemplateCardTitle, getTemplateTeacherSummary } from "./templates.js";
import { getRosterMeta, setRosterClassCount, getClassCount } from "./rosters.js";

// ── Build rows from curriculum ─────────────────────────────────────
function buildRows() {
  // Returns flat array of { gradeKey, track, group, tplId, credits }
  const rows = [];
  GRADE_KEYS.forEach(gradeKey => {
    const board = appState.curriculum.gradeBoards[gradeKey] || [];
    const seenTpl = new Set();
    board.forEach(row => {
      [row.sem1TemplateId, row.sem2TemplateId].filter(Boolean).forEach(tplId => {
        if (seenTpl.has(tplId)) return; seenTpl.add(tplId);
        rows.push({ gradeKey, track: row.track || "공통", group: row.group || "기타", tplId, credits: row.credits });
      });
    });
  });
  return rows;
}

// ── Render ────────────────────────────────────────────────────────
export function renderSubjectSetupView(container) {
  container.innerHTML = "";

  const hdr = document.createElement("div"); hdr.className = "ss-header";
  const title = document.createElement("h2"); title.textContent = "과목 설정";
  const sub = document.createElement("p"); sub.className = "manager-subtitle";
  sub.textContent = "수강명단 작성 전, 각 과목의 반 수를 설정하세요. 설정된 반 수는 수강명단에 자동 반영됩니다.";
  hdr.append(title, sub); container.appendChild(hdr);

  const rows = buildRows();
  if (!rows.length) {
    const e = document.createElement("div"); e.className = "manager-empty";
    e.textContent = "커리큘럼에 과목이 없습니다. 먼저 커리큘럼 보드에서 과목을 배치하세요.";
    container.appendChild(e); return;
  }

  const tableWrap = document.createElement("div"); tableWrap.className = "ss-table-wrap";
  const table     = document.createElement("table"); table.className = "ss-table";

  // ── Header ───────────────────────────────────────────────────────
  table.innerHTML = `<thead><tr>
    <th class="ss-th-grade">학년</th>
    <th class="ss-th-track">구분</th>
    <th class="ss-th-subject">과목명</th>
    <th class="ss-th-teacher">교사</th>
    <th class="ss-th-credits">시수</th>
    <th class="ss-th-count">반 수</th>
    <th class="ss-th-preview">반</th>
  </tr></thead>`;

  const tbody = document.createElement("tbody");

  // Group rows by grade, then track+group — for rowspan calculation
  const byGrade = {};
  rows.forEach(r => {
    const key = `${r.track}::${r.group || "기타"}`;
    if (!byGrade[r.gradeKey]) byGrade[r.gradeKey] = {};
    if (!byGrade[r.gradeKey][key]) byGrade[r.gradeKey][key] = [];
    byGrade[r.gradeKey][key].push(r);
  });

  GRADE_KEYS.forEach(gradeKey => {
    const tracks = byGrade[gradeKey]; if (!tracks) return;
    // Calculate TOTAL rendered rows (including subtotal rows) for grade-cell rowspan
    const totalGradeSpan = Object.keys(tracks).reduce((sum, key) => {
      const tRows = tracks[key];
      const isChoice = tRows[0]?.track !== "공통" && tRows.length > 1;
      return sum + tRows.filter(r => !!getTemplateById(r.tplId)).length + (isChoice ? 1 : 0);
    }, 0);

    let gradeRendered = false;

    Object.keys(tracks).sort((a, b) => {
      const trackA = tracks[a][0]?.track || "", trackB = tracks[b][0]?.track || "";
      const order = t => t === "공통" ? 0 : 1;
      return order(trackA) - order(trackB) || a.localeCompare(b, "ko");
    }).forEach(key => {
      const trackRows = tracks[key];
      const trackLabel = `${trackRows[0]?.track || "공통"}`;
      const groupLabel = trackRows[0]?.group || "기타";
      let trackRendered = false;

      trackRows.forEach((r, ri) => {
        const tpl = getTemplateById(r.tplId); if (!tpl) return;
        const cc  = getClassCount(r.tplId);
        const tr  = document.createElement("tr");
        const isChoice = trackRows[0]?.track !== "공통" && trackRows.length > 1;
        if (isChoice) tr.className = "ss-row-choice";

        // Grade cell (rowspan = all rendered rows in this grade including subtotals)
        if (!gradeRendered) {
          const td = document.createElement("td"); td.className = "ss-td-grade";
          td.rowSpan = totalGradeSpan; td.textContent = `${gradeDisplay(gradeKey)}`;
          tr.appendChild(td); gradeRendered = true;
        }

        // Track cell (rowspan = rows with same track+group)
        if (!trackRendered) {
          const td = document.createElement("td"); td.className = "ss-td-track";
          td.rowSpan = trackRows.length;
          const badge = document.createElement("span");
          badge.className = "ss-track-badge " + (isChoice ? "ss-badge-choice" : "ss-badge-common");
          badge.textContent = `${trackLabel} / ${groupLabel}`;
          if (isChoice) { const hint = document.createElement("div"); hint.className = "ss-choice-hint"; hint.textContent = "택1"; td.appendChild(hint); }
          td.appendChild(badge);
          tr.appendChild(td); trackRendered = true;
        }

        // Subject
        const tdName = document.createElement("td"); tdName.className = "ss-td-name";
        tdName.textContent = getTemplateCardTitle(tpl); tr.appendChild(tdName);

        // Teacher
        const tdTch = document.createElement("td"); tdTch.className = "ss-td-teacher";
        tdTch.textContent = getTemplateTeacherSummary(tpl) || "-"; tr.appendChild(tdTch);

        // Credits
        const tdCr = document.createElement("td"); tdCr.className = "ss-td-credits";
        tdCr.textContent = r.credits != null && r.credits !== "" ? r.credits : "-"; tr.appendChild(tdCr);

        // Section count input
        const tdCnt = document.createElement("td"); tdCnt.className = "ss-td-count";
        const inp = document.createElement("input"); inp.type = "number"; inp.min = "0"; inp.max = "20";
        inp.className = "ss-count-input"; inp.disabled = !canEdit();
        inp.value = getRosterMeta(r.tplId).classCount || "";
        inp.placeholder = "0";
        const preview = document.createElement("td"); preview.className = "ss-td-preview";

        inp.addEventListener("change", e => {
          const v = parseInt(e.target.value) || 0;
          setRosterClassCount(r.tplId, v || "");
          renderPreview(preview, r.tplId);
        });
        tdCnt.appendChild(inp); tr.appendChild(tdCnt);

        // Section preview chips
        renderPreview(preview, r.tplId);
        tr.appendChild(preview);

        tbody.appendChild(tr);
      });

      // Track subtotal row (choice groups only)
      if (trackRows.length > 1 && trackRows[0]?.track !== "공통") {
        const totalRow = document.createElement("tr"); totalRow.className = "ss-track-total";
        const totalTd = document.createElement("td"); totalTd.colSpan = 7;
        const total = trackRows.reduce((s, r) => s + getClassCount(r.tplId), 0);
        totalTd.innerHTML = `<span class="ss-total-label">↑ ${trackLabel} / ${groupLabel} 선택군 합계</span><span class="ss-total-val">${total}반</span>`;
        totalRow.appendChild(totalTd); tbody.appendChild(totalRow);
      }
    });

    // Grade separator
    const sepRow = document.createElement("tr"); sepRow.className = "ss-grade-sep";
    const sepTd = document.createElement("td"); sepTd.colSpan = 7; sepRow.appendChild(sepTd);
    tbody.appendChild(sepRow);
  });

  table.appendChild(tbody); tableWrap.appendChild(table);
  container.appendChild(tableWrap);
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
