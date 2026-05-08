// ================================================================
// ttcards.js · Timetable Card Generation + Group Manager UI
// ================================================================
import { GRADE_KEYS } from "./config.js";
import { uid, clean, makeBtn, languageClass, sectionLabel, gradeDisplay } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave, normalizeTtCard, normalizeTemplateGroup } from "./state.js";
import {
  getTemplateById, getTemplateCardTitle, getTemplateTeacherSummary,
  addLiveTemplateGroup, deleteLiveTemplateGroup, renameLiveTemplateGroup,
  getTemplateCredits,
} from "./templates.js";
import { getClassCount } from "./rosters.js";

// ── Accessors ──────────────────────────────────────────────────────
export const getTtCards    = () => appState.timetable.ttcards || [];
export const getTtCardById = id  => getTtCards().find(c => c.id === id) || null;
const grps = () => appState.templates.templateGroups || [];

// ── TtCard helpers ────────────────────────────────────────────────
export function getTtCardLabel(card) {
  if (card.label) return card.label;
  const tpl = getTemplateById(card.templateId);
  const base = tpl ? getTemplateCardTitle(tpl) : "(삭제된 과목)";
  const cc = getClassCount(card.templateId);
  return cc > 1 ? `${base} ${sectionLabel(card.sectionIdx)}` : base;
}

/** Stable deterministic ID so group references survive regeneration */
export const makeTtcId = (templateId, gradeKey, sectionIdx) =>
  `ttc_${templateId}_${gradeKey}_${sectionIdx}`;

function getTtCardCredits(card) {
  const row = (appState.curriculum.gradeBoards[card.gradeKey] || [])
    .find(r => r.sem1TemplateId === card.templateId || r.sem2TemplateId === card.templateId);
  return row?.credits || null;
}

// ── Generation ────────────────────────────────────────────────────
export function generateTtCards() {
  if (!canEdit()) return 0;
  const existing = new Map(getTtCards().map(c => [c.id, c]));
  const cards = [];
  const seen  = new Set();
  GRADE_KEYS.forEach(gradeKey => {
    const board   = appState.curriculum.gradeBoards[gradeKey] || [];
    const seenTpl = new Set();
    board.forEach(row => {
      [row.sem1TemplateId, row.sem2TemplateId].filter(Boolean).forEach(tplId => {
        if (seenTpl.has(tplId)) return; seenTpl.add(tplId);
        const cc = Math.max(1, getClassCount(tplId));
        for (let i = 0; i < cc; i++) {
          const stableId = makeTtcId(tplId, gradeKey, i);
          if (!seen.has(stableId)) {
            seen.add(stableId);
            // Reuse existing card if present (preserves label overrides)
            cards.push(existing.get(stableId) ||
              normalizeTtCard({ id: stableId, templateId: tplId, gradeKey, sectionIdx: i }));
          }
        }
      });
    });
  });
  appState.timetable.ttcards = cards;
  scheduleSave("timetable");
  return cards.length;
}

// ── TtCards Management View ───────────────────────────────────────
export function renderTtCardsView(container) {
  container.innerHTML = "";

  const hdr = document.createElement("div"); hdr.className = "ttc-page-header";
  const left = document.createElement("div");
  const title = document.createElement("h2"); title.textContent = "시간표 카드";
  const sub = document.createElement("p"); sub.className = "manager-subtitle";
  sub.textContent = "커리큘럼 과목과 수강명단 반 수를 바탕으로 시간표용 카드를 생성합니다.";
  left.append(title, sub);

  const genBtn = makeBtn("🃏 카드 생성 / 재생성", "primary-btn", () => {
    if (!canEdit()) return;
    if (getTtCards().length > 0 && !confirm("기존 카드를 모두 삭제하고 재생성합니다.\n(시간표 배치 데이터는 유지됩니다) 계속할까요?")) return;
    const n = generateTtCards();
    alert(`${n}개 시간표 카드가 생성되었습니다.`);
    renderTtCardsView(container);
  });
  genBtn.disabled = !canEdit();
  hdr.append(left, genBtn);
  container.appendChild(hdr);

  const cards = getTtCards();
  if (!cards.length) {
    const e = document.createElement("div"); e.className = "manager-empty";
    e.textContent = "생성된 카드가 없습니다. 커리큘럼에서 과목을 배치하고 수강명단에서 반 수를 설정한 후 '카드 생성' 버튼을 눌러주세요.";
    container.appendChild(e); return;
  }

  // Stats
  const stats = document.createElement("div"); stats.className = "ttc-stats";
  stats.innerHTML = `총 <strong>${cards.length}</strong>개 시간표 카드`;
  container.appendChild(stats);

  // Group by grade
  const byGrade = {};
  GRADE_KEYS.forEach(g => { byGrade[g] = []; });
  cards.forEach(c => { if (byGrade[c.gradeKey]) byGrade[c.gradeKey].push(c); });

  GRADE_KEYS.forEach(gradeKey => {
    const gc = byGrade[gradeKey];
    if (!gc.length) return;
    const section = document.createElement("div"); section.className = "ttc-grade-section";
    const ghdr = document.createElement("div"); ghdr.className = "ttc-grade-hdr";
    ghdr.textContent = `${gradeDisplay(gradeKey)}학년  (${gc.length}개)`;
    section.appendChild(ghdr);

    const table = document.createElement("table"); table.className = "ttc-table";
    table.innerHTML = `<thead><tr><th>과목명</th><th>반</th><th>담당 교사</th><th>시수</th><th>그룹</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    gc.forEach(card => {
      const tpl     = getTemplateById(card.templateId);
      const cc      = getClassCount(card.templateId);
      const credits  = getTtCardCredits(card);
      const grp     = grps().find(g => (g.units||[]).some(u => (u.ttcardIds||[]).includes(card.id)));
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${tpl ? getTemplateCardTitle(tpl) : "(삭제된 과목)"}</td>
        <td>${cc > 1 ? sectionLabel(card.sectionIdx) : "-"}</td>
        <td>${tpl ? getTemplateTeacherSummary(tpl) : ""}</td>
        <td>${credits ?? "-"}</td>
        <td>${grp ? `<span class="ttc-group-chip">${grp.name}</span>` : '<span class="ttc-unassigned-chip">미배정</span>'}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); section.appendChild(table);
    container.appendChild(section);
  });
}

// ── Group Manager (moved here from templates.js) ──────────────────
let _groupManagerLevel = "전체";
let _currentDrag = null;

function setDrag(d) { _currentDrag = d; }

function gmLevelFilter(card) {
  if (_groupManagerLevel === "전체") return true;
  const tpl = getTemplateById(card.templateId);
  if (!tpl) return false;
  if (_groupManagerLevel === "중등") return ["7학년","8학년","9학년"].includes(card.gradeKey);
  if (_groupManagerLevel === "고등") return ["10학년","11학년","12학년"].includes(card.gradeKey);
  return true;
}

function createTtCardChip(card) {
  const tpl     = getTemplateById(card.templateId);
  const cc      = getClassCount(card.templateId);
  const credits = getTtCardCredits(card);
  const lang    = tpl?.language || "Both";
  const chip    = document.createElement("div"); chip.className = `group-mgr-card ${languageClass(lang)}`;
  chip.draggable = canEdit();
  chip.style.cssText = "position:relative";

  // Top row: name + credits + school level dot
  const tRow = document.createElement("div"); tRow.className = "group-mgr-card-top";
  const nameEl = document.createElement("div"); nameEl.className = "group-mgr-card-title";
  nameEl.textContent = getTemplateCardTitle(tpl || { nameKo: "(삭제됨)" });
  tRow.appendChild(nameEl);
  if (credits != null) { const cb = document.createElement("span"); cb.className = "group-mgr-card-credits"; cb.textContent = credits; tRow.appendChild(cb); }
  if (cc > 1) { const sb = document.createElement("span"); sb.className = "group-mgr-card-classcount"; sb.textContent = sectionLabel(card.sectionIdx); tRow.appendChild(sb); }

  // Bottom row: teacher + grade
  const bRow = document.createElement("div"); bRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-top:2px;gap:3px";
  const tch = document.createElement("div"); tch.className = "group-mgr-card-teacher";
  tch.textContent = tpl ? getTemplateTeacherSummary(tpl) : "";
  const gradeChip = document.createElement("span"); gradeChip.className = "grade-chip grade-chip-sm";
  gradeChip.textContent = card.gradeKey.replace("학년","");
  bRow.append(tch, gradeChip);
  chip.append(tRow, bRow);

  chip.addEventListener("dragstart", () => { setDrag({ kind:"ttcard", ttcardId: card.id }); chip.classList.add("dragging"); });
  chip.addEventListener("dragend",   () => { setDrag(null); chip.classList.remove("dragging"); });
  return chip;
}

function createUnitBlockGM(groupId, unit, onStructureChange) {
  const wrap = document.createElement("div"); wrap.className = "group-unit-block";

  const hdr = document.createElement("div"); hdr.className = "group-unit-hdr";
  const label = document.createElement("span"); label.className = "group-unit-label"; label.textContent = "묶음수업";
  hdr.appendChild(label);
  const ttcards = (unit.ttcardIds || []).map(id => getTtCardById(id)).filter(Boolean);
  if (ttcards.length > 1) {
    const badge = document.createElement("span"); badge.className = "group-unit-same-badge";
    badge.textContent = "🔗 동일 수업"; badge.title = "이름·학년이 달라도 실제 같은 수업입니다.";
    hdr.appendChild(badge);
  }
  const spacer = document.createElement("span"); spacer.style.flex = "1"; hdr.appendChild(spacer);
  const delBtn = makeBtn("×", "group-unit-del-btn", () => {
    if (!canEdit()) return;
    const g = grps().find(g => g.id === groupId); if (!g) return;
    g.units = g.units.filter(u => u.id !== unit.id);
    scheduleSave("templates"); onStructureChange();
  }); delBtn.disabled = !canEdit();
  hdr.appendChild(delBtn); wrap.appendChild(hdr);

  const cardArea = document.createElement("div"); cardArea.className = "group-unit-cards";
  setupDropZone(cardArea, (dragData) => {
    if (dragData.kind !== "ttcard") return;
    const cardId = dragData.ttcardId;
    // Remove from other units
    grps().forEach(g => g.units.forEach(u => { u.ttcardIds = (u.ttcardIds||[]).filter(id => id !== cardId); }));
    // Assign to this group
    const gObj = grps().find(g => g.id === groupId);
    if (gObj) { const t = getTtCardById(cardId); if (t) { t.calcGroupId = groupId; } }
    if (!unit.ttcardIds) unit.ttcardIds = [];
    if (!unit.ttcardIds.includes(cardId)) unit.ttcardIds.push(cardId);
    scheduleSave("templates"); scheduleSave("timetable"); onStructureChange();
  });

  ttcards.forEach(card => {
    const c = createTtCardChip(card);
    const rx = makeBtn("↩", "group-unit-card-remove", () => {
      unit.ttcardIds = unit.ttcardIds.filter(id => id !== card.id);
      scheduleSave("templates"); onStructureChange();
    }); rx.title = "묶음에서 제거"; rx.disabled = !canEdit(); c.appendChild(rx);
    cardArea.appendChild(c);
  });
  if (!ttcards.length) {
    const ph = document.createElement("div"); ph.className = "group-unit-placeholder"; ph.textContent = "여기로 드래그"; cardArea.appendChild(ph);
  }
  wrap.appendChild(cardArea);
  return wrap;
}

function createGroupBlockGM(groupId, onStructureChange) {
  const grpObj = grps().find(g => g.id === groupId); if (!grpObj) return document.createElement("div");
  grpObj.isConcurrent = true; grpObj.groupType = "concurrent";
  const block = document.createElement("div"); block.className = "group-block";
  if (grpObj._collapsed === undefined) grpObj._collapsed = false;

  const hdr = document.createElement("div"); hdr.className = "group-block-hdr";
  const colBtn = document.createElement("button"); colBtn.type = "button"; colBtn.className = "group-collapse-btn";
  colBtn.textContent = grpObj._collapsed ? "▶" : "▼";

  const nameInp = document.createElement("input"); nameInp.type = "text"; nameInp.className = "group-block-name";
  nameInp.value = grpObj.name; nameInp.placeholder = "그룹 이름"; nameInp.disabled = !canEdit();
  nameInp.addEventListener("change", e => { renameLiveTemplateGroup(groupId, e.target.value); });

  const sp = document.createElement("span"); sp.style.flex = "1";
  const resetBtn = makeBtn("초기화", "group-reset-btn", () => {
    if (!canEdit()) return;
    if (!confirm(`"${grpObj.name}" 그룹의 모든 묶음수업을 해제하고 카드를 그룹 풀로 되돌릴까요?`)) return;
    // Move all ttcardIds from all units back to poolCardIds
    const allIds = (grpObj.units||[]).flatMap(u => u.ttcardIds||[]);
    grpObj.units = [];
    grpObj.poolCardIds = [...new Set([...(grpObj.poolCardIds||[]), ...allIds])];
    scheduleSave("templates"); onStructureChange();
  }); resetBtn.disabled = !canEdit();
  const delBtn = makeBtn("삭제", "group-col-del-btn", () => { deleteLiveTemplateGroup(groupId); onStructureChange(); });
  delBtn.disabled = !canEdit();
  hdr.append(colBtn, nameInp, sp, resetBtn, delBtn); block.appendChild(hdr);

  const hint = document.createElement("div"); hint.className = "group-concurrent-hint";
  hint.textContent = "이 그룹의 과목들은 같은 시간대에 배정됩니다."; block.appendChild(hint);

  const body = document.createElement("div"); body.className = "group-block-body";
  if (grpObj._collapsed) body.style.display = "none";

  // Cards in group but not in any unit → pool
  const allUnitCardIds = new Set((grpObj.units||[]).flatMap(u => u.ttcardIds||[]));
  const poolCards = getTtCards().filter(c => gmLevelFilter(c) && !allUnitCardIds.has(c.id) &&
    (grps().some(g => g.id === groupId && (g.units||[]).flatMap(u => u.ttcardIds||[]).includes(c.id)) ||
     c.calcGroupId === groupId)
  );
  // Also cards that belong to this group via ttcardIds but not in a unit
  const orphanCards = getTtCards().filter(c => {
    if (allUnitCardIds.has(c.id)) return false;
    // Check if any unit in this group claims this card
    return (grpObj.units||[]).some(u => false); // handled above
  });

  // Pool = cards assigned to group but not to any unit
  const poolCardsV2 = getTtCards().filter(c => {
    if (!gmLevelFilter(c)) return false;
    if (allUnitCardIds.has(c.id)) return false;
    // assigned to this group if: any unit in this group had it (and it was removed to pool)
    // We track group assignment via a separate lookup
    return false; // pool concept is removed — all cards go into units directly
  });

  const unitsWrap = document.createElement("div"); unitsWrap.className = "group-units-wrap";
  (grpObj.units||[]).forEach(unit => unitsWrap.appendChild(createUnitBlockGM(groupId, unit, onStructureChange)));
  body.appendChild(unitsWrap);

  // ── Pool area: cards in group but not in any unit ──────────────
  const unitCardIds = new Set((grpObj.units||[]).flatMap(u => u.ttcardIds||[]));
  const poolIds = (grpObj.poolCardIds||[]).filter(id => !unitCardIds.has(id));
  if (poolIds.length > 0) {
    const poolArea = document.createElement("div"); poolArea.className = "group-pool-area";
    const poolLbl = document.createElement("div"); poolLbl.className = "group-pool-area-label";
    poolLbl.textContent = "그룹 카드 (묶음수업 미배정)";
    poolArea.appendChild(poolLbl);
    const poolCards = document.createElement("div"); poolCards.className = "group-pool-cards";
    setupDropZone(poolCards, drag => {
      if (drag.kind !== "ttcard") return;
      // Remove from other group's units/pools
      grps().forEach(g => {
        g.units.forEach(u => { u.ttcardIds = (u.ttcardIds||[]).filter(id => id !== drag.ttcardId); });
        if (g.id !== groupId) g.poolCardIds = (g.poolCardIds||[]).filter(id => id !== drag.ttcardId);
      });
      if (!grpObj.poolCardIds) grpObj.poolCardIds = [];
      if (!grpObj.poolCardIds.includes(drag.ttcardId)) grpObj.poolCardIds.push(drag.ttcardId);
      scheduleSave("templates"); onStructureChange();
    });
    poolIds.forEach(id => {
      const card = getTtCardById(id); if (!card) return;
      const chip = createTtCardChip(card);
      chip.addEventListener("dragstart", () => { setDrag({ kind:"ttcard", ttcardId: id }); chip.classList.add("dragging"); });
      chip.addEventListener("dragend", () => { setDrag(null); chip.classList.remove("dragging"); });
      poolCards.appendChild(chip);
    });
    poolArea.appendChild(poolCards); body.appendChild(poolArea);
  }

  const addUnitBtn = makeBtn("+ 묶음수업 추가", "group-add-unit-btn", () => {
    if (!canEdit()) return;
    if (!grpObj.units) grpObj.units = [];
    grpObj.units.push({ id: uid("unit"), name: "", templateIds: [], ttcardIds: [] });
    scheduleSave("templates"); onStructureChange();
  }); addUnitBtn.disabled = !canEdit();
  body.appendChild(addUnitBtn);
  block.appendChild(body);

  colBtn.addEventListener("click", () => {
    grpObj._collapsed = !grpObj._collapsed;
    body.style.display = grpObj._collapsed ? "none" : "";
    colBtn.textContent = grpObj._collapsed ? "▶" : "▼";
  });
  return block;
}

function setupDropZone(el, onDrop) {
  el.addEventListener("dragover",  e => { if (!canEdit()) return; e.preventDefault(); el.classList.add("dragover"); });
  el.addEventListener("dragleave", () => el.classList.remove("dragover"));
  el.addEventListener("drop",      e => {
    if (!canEdit()) return; e.preventDefault(); el.classList.remove("dragover");
    if (_currentDrag) onDrop(_currentDrag);
  });
}

export function renderGroupManagerView(container) {
  const snap = [".main-panel","#groupManagerBoard",".group-right-col",".group-left-col"]
    .map(sel => { const el = document.querySelector(sel); return el ? { sel, top: el.scrollTop } : null; }).filter(Boolean);

  container.innerHTML = "";
  buildGroupManagerDOM(container);

  requestAnimationFrame(() => snap.forEach(({ sel, top }) => { const el = document.querySelector(sel); if (el) el.scrollTop = top; }));
}

function buildGroupManagerDOM(board) {
  const onStructureChange = () => renderGroupManagerView(board);

  // Filter bar
  const filterBar = document.createElement("div"); filterBar.className = "group-level-filter-bar";
  ["전체","중등","고등"].forEach(level => {
    const btn = makeBtn(
      level === "중등" ? "📘 중등" : level === "고등" ? "📗 고등" : "전체",
      "group-level-btn" + (_groupManagerLevel === level ? " active" : ""),
      () => { _groupManagerLevel = level; renderGroupManagerView(board); }
    );
    filterBar.appendChild(btn);
  });

  // Auto-gen button (creates groups from ttcards)
  const autoGenBtn = makeBtn("✨ 자동 생성", "group-auto-gen-btn", () => {
    if (!canEdit()) return;
    const cards = getTtCards().filter(c => gmLevelFilter(c));
    if (!cards.length) { alert("시간표 카드가 없습니다.\n먼저 '시간표 카드' 탭에서 카드를 생성하세요."); return; }

    // Group by: curriculum track + 교과군 + gradeKey  (more precise than track+grade only)
    const trackMap = {};
    GRADE_KEYS.forEach(gradeKey => {
      const rows = appState.curriculum?.gradeBoards?.[gradeKey] || [];
      rows.forEach(row => {
        if (row.category !== "교과") return;
        if (!row.track || row.track === "공통") return;
        const subGroup = row.group || "기타";
        const groupKey = `${row.track}::${subGroup}::${gradeKey}`;
        if (!trackMap[groupKey]) trackMap[groupKey] = {
          name: `${row.track} / ${subGroup} / ${gradeDisplay(gradeKey)}`, cardIds: new Set()
        };
        [row.sem1TemplateId, row.sem2TemplateId].filter(Boolean).forEach(tplId => {
          cards.filter(c => c.templateId === tplId && c.gradeKey === gradeKey)
            .forEach(c => trackMap[groupKey].cardIds.add(c.id));
        });
      });
    });

    const validGroups = Object.values(trackMap).filter(v => v.cardIds.size >= 2);
    if (!validGroups.length) { alert("자동 생성할 그룹이 없습니다.\n배정/선택 과목이 있는지 확인하세요."); return; }

    const existing = grps();
    const existingNames = new Set(existing.map(g => g.name));
    const newGroups = validGroups.filter(({ name }) => !existingNames.has(name));

    if (!newGroups.length) { alert("이미 동일한 그룹이 모두 존재합니다."); return; }
    if (!confirm(`${newGroups.length}개 그룹을 자동 생성합니다. 계속할까요?`)) return;

    newGroups.forEach(({ name, cardIds }) => {
      const grpId = uid("grp");
      // Cards go into the group pool (unassigned to units) — user creates 묶음수업 manually
      appState.templates.templateGroups.push(normalizeTemplateGroup({
        id: grpId, name, isConcurrent: true, groupType: "concurrent",
        units: [], poolCardIds: [...cardIds]  // pool: cards in group but not yet in any unit
      }));
    });
    scheduleSave("templates"); onStructureChange();
    alert(`${newGroups.length}개 그룹이 생성되었습니다.`);
  });
  autoGenBtn.disabled = !canEdit();
  filterBar.appendChild(autoGenBtn);
  board.appendChild(filterBar);

  const layout = document.createElement("div"); layout.className = "group-manager-layout";

  // ── Left: unassigned TtCards ────────────────────────────────────
  const leftCol = document.createElement("div"); leftCol.className = "group-left-col";
  const leftHdr = document.createElement("div"); leftHdr.className = "group-section-hdr";
  leftHdr.appendChild(Object.assign(document.createElement("span"), { className:"group-pool-main-label", textContent:"미배정 카드" }));
  leftCol.appendChild(leftHdr);

  const allAssignedIds = new Set([
    ...grps().flatMap(g => (g.units||[]).flatMap(u => u.ttcardIds||[])),
    ...grps().flatMap(g => g.poolCardIds||[])
  ]);
  const unassigned = getTtCards().filter(c => gmLevelFilter(c) && !allAssignedIds.has(c.id))
    .sort((a, b) => getTtCardLabel(a).localeCompare(getTtCardLabel(b), "ko"));

  const unPool = document.createElement("div"); unPool.className = "group-unassigned-pool group-unassigned-horiz";
  setupDropZone(unPool, drag => {
    if (drag.kind !== "ttcard") return;
    // Remove from all units AND poolCardIds
    grps().forEach(g => {
      g.units.forEach(u => { u.ttcardIds = (u.ttcardIds||[]).filter(id => id !== drag.ttcardId); });
      g.poolCardIds = (g.poolCardIds||[]).filter(id => id !== drag.ttcardId);
    });
    scheduleSave("templates"); onStructureChange();
  });

  if (unassigned.length) {
    unassigned.forEach(c => {
      const wrap = document.createElement("div"); wrap.className = "group-unassigned-card-wrap";
      wrap.appendChild(createTtCardChip(c)); unPool.appendChild(wrap);
    });
  } else {
    const ph = document.createElement("div"); ph.className = "group-col-placeholder"; ph.textContent = "모든 카드가 배정됨"; unPool.appendChild(ph);
  }
  leftCol.appendChild(unPool); layout.appendChild(leftCol);

  // ── Right: Groups ───────────────────────────────────────────────
  const rightWrap = document.createElement("div"); rightWrap.className = "group-right-col-wrap";
  const rightHdr  = document.createElement("div"); rightHdr.className = "group-right-col-hdr";
  rightHdr.appendChild(Object.assign(document.createElement("span"), { className:"group-pool-main-label", textContent:"그룹 목록" }));
  const expandAll   = makeBtn("▼ 전체 펼치기", "group-expand-btn", () => { grps().forEach(g => { g._collapsed = false; }); onStructureChange(); });
  const collapseAll = makeBtn("▶ 전체 접기",   "group-expand-btn", () => { grps().forEach(g => { g._collapsed = true;  }); onStructureChange(); });
  const togWrap = document.createElement("div"); togWrap.style.cssText = "display:flex;gap:4px;margin-left:auto";
  togWrap.append(expandAll, collapseAll); rightHdr.style.display = "flex"; rightHdr.style.alignItems = "center";
  rightHdr.appendChild(togWrap);

  const rightCol = document.createElement("div"); rightCol.className = "group-right-col";
  const filteredGroups = grps().filter(g => {
    const cards = (g.units||[]).flatMap(u => (u.ttcardIds||[]).map(id => getTtCardById(id)).filter(Boolean));
    if (!cards.length) return true; // show empty groups
    return cards.some(c => gmLevelFilter(c));
  });
  if (filteredGroups.length) {
    filteredGroups.forEach(g => rightCol.appendChild(createGroupBlockGM(g.id, onStructureChange)));
  } else {
    rightCol.innerHTML = '<div class="group-col-placeholder">그룹이 없습니다. 오른쪽 상단 "그룹 추가"를 누르세요.</div>';
  }

  rightWrap.append(rightHdr, rightCol); layout.appendChild(rightWrap);
  board.appendChild(layout);
}
