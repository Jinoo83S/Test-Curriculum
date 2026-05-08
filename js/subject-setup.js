// ================================================================
// subject-setup.js · Subject Selection Groups + Section Count Setup
// ================================================================
// Step before 수강명단:
//   커리큘럼 → [과목 설정] → 수강명단 → 시간표카드 → ...
//
// Groups curriculum rows by (grade + track + 교과군) to show which
// subjects compete for the same students ("selection group").
// Admin sets section count (반 수) per subject here.
// ================================================================
import { GRADE_KEYS } from "./config.js";
import { uid, makeBtn, gradeDisplay, sectionLabel } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState } from "./state.js";
import { getTemplateById, getTemplateCardTitle, getTemplateTeacherSummary, splitTeacherNames } from "./templates.js";
import { getRosterMeta, setRosterClassCount, getClassCount } from "./rosters.js";

// ── Build selection groups from curriculum ────────────────────────
function buildSelectionGroups() {
  // Returns: { gradeKey → [ { track, group, category, rows: [ {tplId, sem} ] } ] }
  const result = {};
  GRADE_KEYS.forEach(gradeKey => {
    const board = appState.curriculum.gradeBoards[gradeKey] || [];
    const groupMap = {}; // key → { track, group, category, tplIds: Set }

    board.forEach(row => {
      const key = `${row.category}::${row.track}::${row.group || "기타"}`;
      if (!groupMap[key]) groupMap[key] = { track: row.track, group: row.group || "기타", category: row.category, tplIds: new Set() };
      if (row.sem1TemplateId) groupMap[key].tplIds.add(row.sem1TemplateId);
      if (row.sem2TemplateId) groupMap[key].tplIds.add(row.sem2TemplateId);
    });

    result[gradeKey] = Object.values(groupMap)
      .filter(g => g.tplIds.size > 0)
      .sort((a, b) => {
        const trackOrder = (t) => t === "공통" ? 0 : t === "배정" ? 1 : 2;
        const to = trackOrder(a.track) - trackOrder(b.track);
        if (to !== 0) return to;
        return a.group.localeCompare(b.group, "ko");
      })
      .map(g => ({ ...g, tplIds: [...g.tplIds] }));
  });
  return result;
}

// ── Render ────────────────────────────────────────────────────────
export function renderSubjectSetupView(container) {
  container.innerHTML = "";

  const hdr = document.createElement("div"); hdr.className = "ss-header";
  const left = document.createElement("div");
  const title = document.createElement("h2"); title.textContent = "과목 설정";
  const sub = document.createElement("p"); sub.className = "manager-subtitle";
  sub.textContent = "수강명단 작성 전, 각 과목의 반 수를 설정하세요. 같은 선택군 내 과목들은 학생이 하나만 수강합니다.";
  left.append(title, sub); hdr.appendChild(left);
  container.appendChild(hdr);

  const selGroups = buildSelectionGroups();
  const hasAny = GRADE_KEYS.some(g => selGroups[g]?.length);

  if (!hasAny) {
    const e = document.createElement("div"); e.className = "manager-empty";
    e.textContent = "커리큘럼에 과목이 없습니다. 먼저 커리큘럼 보드에서 과목을 배치하세요.";
    container.appendChild(e); return;
  }

  const scroll = document.createElement("div"); scroll.className = "ss-scroll";

  GRADE_KEYS.forEach(gradeKey => {
    const groups = selGroups[gradeKey];
    if (!groups?.length) return;

    const gradeSection = document.createElement("div"); gradeSection.className = "ss-grade-section";
    const ghdr = document.createElement("div"); ghdr.className = "ss-grade-hdr";
    ghdr.textContent = `${gradeDisplay(gradeKey)}학년`;
    gradeSection.appendChild(ghdr);

    groups.forEach(grp => {
      const isChoice = grp.track !== "공통" && grp.tplIds.length > 1;
      const isFixed  = grp.track === "공통";

      const grpBlock = document.createElement("div");
      grpBlock.className = "ss-group" + (isChoice ? " ss-group-choice" : isFixed ? " ss-group-fixed" : "");

      // Group header
      const grpHdr = document.createElement("div"); grpHdr.className = "ss-group-hdr";
      const grpLabel = document.createElement("span"); grpLabel.className = "ss-group-label";
      grpLabel.textContent = `${grp.track} / ${grp.group}`;
      const typeBadge = document.createElement("span");
      typeBadge.className = "ss-type-badge ss-type-" + (isFixed ? "common" : isChoice ? "choice" : "assign");
      typeBadge.textContent = isFixed ? "공통" : isChoice ? "선택 (택1)" : grp.track;
      grpHdr.append(grpLabel, typeBadge);
      grpBlock.appendChild(grpHdr);

      // Subject rows
      const rows = document.createElement("div"); rows.className = "ss-rows";

      grp.tplIds.forEach(tplId => {
        const tpl = getTemplateById(tplId); if (!tpl) return;
        const cc  = getClassCount(tplId);
        const credits = (() => {
          for (const grade of GRADE_KEYS) {
            const row = (appState.curriculum.gradeBoards[grade] || [])
              .find(r => r.sem1TemplateId === tplId || r.sem2TemplateId === tplId);
            if (row && row.credits != null && row.credits !== "") return row.credits;
          }
          return null;
        })();

        const row = document.createElement("div"); row.className = "ss-row";

        // Subject name + teacher
        const nameCol = document.createElement("div"); nameCol.className = "ss-col-name";
        const nameEl = document.createElement("span"); nameEl.className = "ss-subject-name";
        nameEl.textContent = getTemplateCardTitle(tpl);
        const teachEl = document.createElement("span"); teachEl.className = "ss-teacher";
        teachEl.textContent = getTemplateTeacherSummary(tpl) || "-";
        nameCol.append(nameEl, teachEl);

        // Credits
        const credCol = document.createElement("div"); credCol.className = "ss-col-credits";
        credCol.textContent = credits != null ? `${credits}시수` : "-";

        // Section count input
        const secCol = document.createElement("div"); secCol.className = "ss-col-sections";
        const secLabel = document.createElement("span"); secLabel.className = "ss-sec-label"; secLabel.textContent = "반 수:";
        const secInp = document.createElement("input"); secInp.type = "number"; secInp.min = "0"; secInp.max = "20";
        secInp.className = "ss-sec-input"; secInp.disabled = !canEdit();
        secInp.value = getRosterMeta(tplId).classCount || "";
        secInp.placeholder = "0";
        secInp.addEventListener("change", e => {
          const v = parseInt(e.target.value) || 0;
          setRosterClassCount(tplId, v || "");
          renderSectionPreview(secPreview, tplId);
        });
        secCol.append(secLabel, secInp);

        // Section preview chips (A, B, C...)
        const secPreview = document.createElement("div"); secPreview.className = "ss-sec-preview";
        renderSectionPreview(secPreview, tplId);

        row.append(nameCol, credCol, secCol, secPreview);
        rows.appendChild(row);
      });

      // Total section count for the group
      if (isChoice) {
        const total = grp.tplIds.reduce((s, id) => s + getClassCount(id), 0);
        const totalRow = document.createElement("div"); totalRow.className = "ss-group-total";
        totalRow.innerHTML = `<span>선택군 합계</span><span class="ss-total-value">${total}반</span>`;
        rows.appendChild(totalRow);
      }

      grpBlock.appendChild(rows);
      gradeSection.appendChild(grpBlock);
    });

    scroll.appendChild(gradeSection);
  });

  container.appendChild(scroll);
}

function renderSectionPreview(el, tplId) {
  el.innerHTML = "";
  const cc = getClassCount(tplId);
  for (let i = 0; i < Math.min(cc, 8); i++) {
    const chip = document.createElement("span"); chip.className = "ss-sec-chip";
    chip.textContent = sectionLabel(i);
    el.appendChild(chip);
  }
  if (cc > 8) {
    const more = document.createElement("span"); more.className = "ss-sec-chip ss-sec-more";
    more.textContent = `+${cc - 8}`; el.appendChild(more);
  }
}
