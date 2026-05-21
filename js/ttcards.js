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

function getSectionLabelFromRoster(card) {
  const rosterEntries = (appState.rosters?.rosters?.[card.templateId] || [])
    .filter(e => (e.sectionIdx ?? 0) === card.sectionIdx);
  if (!rosterEntries.length) {
    return getClassCount(card.templateId) > 1 ? sectionLabel(card.sectionIdx) : null;
  }
  const allClasses = appState.classes?.classes || [];
  const classNames = [...new Set(rosterEntries.map(e => {
    const cls = allClasses.find(c => c.id === e.classId);
    return cls?.name || null;
  }).filter(Boolean))];
  if (classNames.length === 0) return sectionLabel(card.sectionIdx);
  if (classNames.length === 1) return classNames[0]; // "A" or "B"
  return classNames.join(", "); // one course section can contain students from A,B together
}
export const getTtCards    = () => appState.timetable.ttcards || [];
export const getTtCardById = id  => getTtCards().find(c => c.id === id) || null;
const grps = () => appState.templates.templateGroups || [];

// ── TtCard helpers ────────────────────────────────────────────────
export function getTtCardLabel(card) {
  if (card.label) return card.label;
  const tpl = getTemplateById(card.templateId);
  const base = tpl ? getTemplateCardTitle(tpl) : "(삭제된 과목)";
  const cc = getClassCount(card.templateId);
  const secLabel = getSectionLabelFromRoster(card);
  return (cc > 1 || (secLabel && secLabel.includes(","))) ? `${base} ${secLabel || sectionLabel(card.sectionIdx)}` : base;
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
      const grp = grps().find(g =>
        (g.units||[]).some(u => (u.ttcardIds||[]).includes(card.id)) ||
        (g.poolCardIds||[]).includes(card.id)
      );
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

function createTtCardChip(card, opts = {}) {
  const { onDelete, showDelete = false } = opts;
  const tpl  = getTemplateById(card.templateId);
  const lang = tpl?.language || "Both";
  const chip = document.createElement("div"); chip.className = `gm-card ${languageClass(lang)}`;
  chip.draggable = canEdit();
  chip.dataset.ttcardId = card.id;

  // Row 1: subject | grade chip | section badge
  const r1 = document.createElement("div"); r1.className = "gm-card-r1";
  const subjectEl = document.createElement("div"); subjectEl.className = "gm-card-subject";
  subjectEl.textContent = getTemplateCardTitle(tpl || { nameKo: "(삭제됨)" });
  const gradeChip = document.createElement("span"); gradeChip.className = "gm-card-grade";
  gradeChip.textContent = gradeDisplay(card.gradeKey);
  const secLbl = getSectionLabelFromRoster(card);
  if (secLbl) { const sb = document.createElement("span"); sb.className = "gm-card-sec"; sb.textContent = secLbl; r1.append(subjectEl, gradeChip, sb); }
  else { r1.append(subjectEl, gradeChip); }

  // Row 2: teacher | delete button
  const r2 = document.createElement("div"); r2.className = "gm-card-r2";
  const tchEl = document.createElement("div"); tchEl.className = "gm-card-teacher";
  tchEl.textContent = tpl ? getTemplateTeacherSummary(tpl) : "-";
  r2.appendChild(tchEl);
  if (showDelete && canEdit() && onDelete) {
    const del = document.createElement("button"); del.type = "button"; del.className = "gm-card-del"; del.textContent = "×";
    del.title = "카드 삭제"; del.onclick = (e) => { e.stopPropagation(); onDelete(card); };
    r2.appendChild(del);
  }
  chip.append(r1, r2);

  chip.addEventListener("dragstart", () => { setDrag({ kind:"ttcard", ttcardId: card.id }); chip.classList.add("dragging"); });
  chip.addEventListener("dragend",   () => { setDrag(null); chip.classList.remove("dragging"); });
  return chip;
}

function deleteCard(card) {
  if (!confirm(`"${getTtCardLabel(card)}" 카드를 삭제할까요?`)) return;
  grps().forEach(g => {
    g.poolCardIds = (g.poolCardIds||[]).filter(id => id !== card.id);
    (g.units||[]).forEach(u => { u.ttcardIds = (u.ttcardIds||[]).filter(id => id !== card.id); });
  });
  appState.timetable.ttcards = (appState.timetable.ttcards||[]).filter(c => c.id !== card.id);
  appState.timetable.entries = (appState.timetable.entries||[]).filter(e => e.ttcardId !== card.id && !(e.ttcardIds||[]).includes(card.id));
  scheduleSave("templates"); scheduleSave("timetable");
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
    // Remove from ALL units AND poolCardIds across all groups
    grps().forEach(g => {
      g.units.forEach(u => { u.ttcardIds = (u.ttcardIds||[]).filter(id => id !== cardId); });
      g.poolCardIds = (g.poolCardIds||[]).filter(id => id !== cardId);
    });
    if (!unit.ttcardIds) unit.ttcardIds = [];
    if (!unit.ttcardIds.includes(cardId)) unit.ttcardIds.push(cardId);
    scheduleSave("templates"); scheduleSave("timetable"); onStructureChange();
  });

  ttcards.forEach(card => {
    const c = createTtCardChip(card, {
      showDelete: false,
      onDelete: () => {}
    });
    const rx = makeBtn("↩", "gm-card-remove", () => {
      unit.ttcardIds = unit.ttcardIds.filter(id => id !== card.id);
      scheduleSave("templates"); onStructureChange();
    }); rx.title = "묶음에서 제거"; rx.disabled = !canEdit(); rx.className = "gm-card-remove";
    c.appendChild(rx);
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
  if (!Object.prototype.hasOwnProperty.call(grpObj, "_collapsed")) { /* collapsed state managed by _collapsedMap */ }
  const block = document.createElement("div"); block.className = "group-block";
  block.dataset.groupId = groupId;

  // Drop target for group reorder (receives drop from other blocks' handle)
  block.addEventListener("dragover", e => {
    if (e.dataTransfer.types.includes("application/group-id")) {
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      block.classList.add("group-block-drop-target");
    }
  });
  block.addEventListener("dragleave", e => {
    if (!block.contains(e.relatedTarget)) block.classList.remove("group-block-drop-target");
  });
  block.addEventListener("drop", e => {
    if (!e.dataTransfer.types.includes("application/group-id")) return;
    e.preventDefault(); block.classList.remove("group-block-drop-target");
    const srcId = e.dataTransfer.getData("application/group-id");
    const destId = groupId;
    if (!srcId || srcId === destId) return;
    const arr = appState.templates.templateGroups;
    const si = arr.findIndex(g => g.id === srcId);
    const di = arr.findIndex(g => g.id === destId);
    if (si < 0 || di < 0) return;
    const [moved] = arr.splice(si, 1);
    arr.splice(di, 0, moved);
    scheduleSave("templates"); onStructureChange();
  });

  const hdr = document.createElement("div"); hdr.className = "group-block-hdr";

  // Drag handle — only this triggers group reorder drag
  const dragHandle = document.createElement("span"); dragHandle.className = "group-drag-handle";
  dragHandle.textContent = "⠿"; dragHandle.title = "드래그하여 순서 변경";
  if (canEdit()) {
    dragHandle.draggable = true;
    dragHandle.addEventListener("dragstart", e => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/group-id", groupId);
      block.classList.add("group-block-dragging");
      e.stopPropagation();
    });
    dragHandle.addEventListener("dragend", () => block.classList.remove("group-block-dragging"));
  }

  const colBtn = document.createElement("button"); colBtn.type = "button"; colBtn.className = "group-collapse-btn";
  colBtn.textContent = isGroupCollapsed(groupId) ? "▶" : "▼";

  const nameInp = document.createElement("input"); nameInp.type = "text"; nameInp.className = "group-block-name";
  nameInp.value = grpObj.name; nameInp.placeholder = "그룹 이름"; nameInp.disabled = !canEdit();
  nameInp.addEventListener("change", e => { renameLiveTemplateGroup(groupId, e.target.value); });

  const delBtn = makeBtn("×", "group-col-del-btn group-col-del-x", () => { deleteLiveTemplateGroup(groupId); onStructureChange(); });
  delBtn.disabled = !canEdit(); delBtn.title = "그룹 삭제";
  hdr.append(dragHandle, colBtn, nameInp, delBtn); block.appendChild(hdr);

  const hint = document.createElement("div"); hint.className = "group-concurrent-hint";
  hint.textContent = "이 그룹의 과목들은 같은 시간대에 배정됩니다."; block.appendChild(hint);

  const body = document.createElement("div"); body.className = "group-block-body";
  if (isGroupCollapsed(groupId)) body.style.display = "none";

  const allUnitCardIds = new Set((grpObj.units||[]).flatMap(u => u.ttcardIds||[]));

  const unitsWrap = document.createElement("div"); unitsWrap.className = "group-units-wrap";
  (grpObj.units||[]).forEach(unit => unitsWrap.appendChild(createUnitBlockGM(groupId, unit, onStructureChange)));
  body.appendChild(unitsWrap);

  // ── Pool area: cards in group but not in any unit (always visible for drop) ──
  const poolArea = document.createElement("div"); poolArea.className = "group-pool-area";
  const poolLbl = document.createElement("div"); poolLbl.className = "group-pool-area-label";
  poolLbl.textContent = "그룹 카드 (묶음수업 미배정)";
  poolArea.appendChild(poolLbl);
  const poolCards = document.createElement("div"); poolCards.className = "group-pool-cards";
  setupDropZone(poolCards, drag => {
    if (drag.kind !== "ttcard") return;
    grps().forEach(g => {
      g.units.forEach(u => { u.ttcardIds = (u.ttcardIds||[]).filter(id => id !== drag.ttcardId); });
      if (g.id !== groupId) g.poolCardIds = (g.poolCardIds||[]).filter(id => id !== drag.ttcardId);
    });
    if (!grpObj.poolCardIds) grpObj.poolCardIds = [];
    if (!grpObj.poolCardIds.includes(drag.ttcardId)) grpObj.poolCardIds.push(drag.ttcardId);
    scheduleSave("templates"); onStructureChange();
  });
  const unitCardIds = new Set((grpObj.units||[]).flatMap(u => u.ttcardIds||[]));
  const poolIds = (grpObj.poolCardIds||[]).filter(id => !unitCardIds.has(id));
  if (poolIds.length === 0) {
    const ph = document.createElement("div"); ph.className = "group-pool-empty-hint";
    ph.textContent = "미배정 카드를 여기로 드래그"; poolCards.appendChild(ph);
  } else {
    poolIds.forEach(id => {
      const card = getTtCardById(id); if (!card) return;
      const chip = createTtCardChip(card, {
        showDelete: true,
        onDelete: (c) => { deleteCard(c); onStructureChange(); }
      });
      chip.addEventListener("dragstart", () => { setDrag({ kind:"ttcard", ttcardId: id }); chip.classList.add("dragging"); });
      chip.addEventListener("dragend", () => { setDrag(null); chip.classList.remove("dragging"); });
      poolCards.appendChild(chip);
    });
  }
  poolArea.appendChild(poolCards); body.appendChild(poolArea);

  const addUnitBtn = makeBtn("+ 묶음수업 추가", "group-add-unit-btn", () => {
    if (!canEdit()) return;
    if (!grpObj.units) grpObj.units = [];
    grpObj.units.push({ id: uid("unit"), name: "", templateIds: [], ttcardIds: [] });
    scheduleSave("templates"); onStructureChange();
  }); addUnitBtn.disabled = !canEdit();
  body.appendChild(addUnitBtn);
  block.appendChild(body);

  colBtn.addEventListener("click", () => {
    const next = !isGroupCollapsed(groupId);
    setGroupCollapsed(groupId, next);
    body.style.display = next ? "none" : "";
    colBtn.textContent = next ? "▶" : "▼";
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

// ── Group collapsed state (UI-only, not saved to Firebase) ────────
const _collapsedMap = new Map(); // groupId → boolean

function isGroupCollapsed(id) { return _collapsedMap.get(id) ?? false; }
function setGroupCollapsed(id, val) { _collapsedMap.set(id, val); }

export function renderGroupManagerView(container) {
  const rightScroll = container.querySelector(".group-right-col")?.scrollTop || 0;
  const leftScroll  = container.querySelector(".group-unassigned-pool")?.scrollTop || 0;
  container.innerHTML = "";
  buildGroupManagerDOM(container, rightScroll, leftScroll);
}

function buildGroupManagerDOM(board, savedRightScroll = 0, savedLeftScroll = 0) {
  const onStructureChange = () => {
    const rS = board.querySelector(".group-right-col")?.scrollTop || 0;
    const lS = board.querySelector(".group-unassigned-pool")?.scrollTop || 0;
    board.innerHTML = "";
    buildGroupManagerDOM(board, rS, lS);
  };

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

  // Auto-gen button
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
        const groupKey = `${row.track}::${gradeKey}`;
        if (!trackMap[groupKey]) trackMap[groupKey] = {
          name: `${gradeDisplay(gradeKey)}-${row.track}`, cardIds: new Set()
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

  const resetAllBtn = makeBtn("🔄 전체 초기화", "group-reset-all-btn", () => {
    if (!canEdit()) return;
    if (!confirm("그룹을 전체 초기화합니다.\n모든 그룹과 묶음수업이 삭제되고 카드는 미배정 상태로 돌아갑니다.\n계속할까요?")) return;
    appState.templates.templateGroups = [];
    scheduleSave("templates"); onStructureChange();
  }); resetAllBtn.disabled = !canEdit();
  filterBar.appendChild(resetAllBtn);
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
      const chip = createTtCardChip(c, {
        showDelete: true,
        onDelete: (card) => { deleteCard(card); onStructureChange(); }
      });
      wrap.appendChild(chip); unPool.appendChild(wrap);
    });
  } else {
    const ph = document.createElement("div"); ph.className = "group-col-placeholder"; ph.textContent = "모든 카드가 배정됨"; unPool.appendChild(ph);
  }
  leftCol.appendChild(unPool); layout.appendChild(leftCol);

  // ── Right: Groups ───────────────────────────────────────────────
  const rightWrap = document.createElement("div"); rightWrap.className = "group-right-col-wrap";
  const rightHdr  = document.createElement("div"); rightHdr.className = "group-right-col-hdr";
  rightHdr.appendChild(Object.assign(document.createElement("span"), { className:"group-pool-main-label", textContent:"그룹 목록" }));

  const filteredGroups = grps().filter(g => {
    const unitCards = (g.units||[]).flatMap(u => (u.ttcardIds||[]).map(id => getTtCardById(id)).filter(Boolean));
    const poolCards = (g.poolCardIds||[]).map(id => getTtCardById(id)).filter(Boolean);
    const allCards  = [...unitCards, ...poolCards];
    if (!allCards.length) return true;
    return allCards.some(c => gmLevelFilter(c));
  });

  const togWrap = document.createElement("div"); togWrap.style.cssText = "display:flex;gap:4px;margin-left:auto";
  const allCollapsed = filteredGroups.length > 0 && filteredGroups.every(g => isGroupCollapsed(g.id));
  const togBtn = makeBtn(allCollapsed ? "▼ 전체 펼치기" : "▶ 전체 접기", "group-expand-btn", () => {
    const collapse = !allCollapsed;
    grps().forEach(g => setGroupCollapsed(g.id, collapse));
    onStructureChange();
  });
  togWrap.append(togBtn); rightHdr.style.display = "flex"; rightHdr.style.alignItems = "center";
  rightHdr.appendChild(togWrap);

  const rightCol = document.createElement("div"); rightCol.className = "group-right-col";
  if (filteredGroups.length) {
    filteredGroups.forEach(g => rightCol.appendChild(createGroupBlockGM(g.id, onStructureChange)));
  } else {
    rightCol.innerHTML = '<div class="group-col-placeholder">그룹이 없습니다. 오른쪽 상단 "그룹 추가"를 누르세요.</div>';
  }

  rightWrap.append(rightHdr, rightCol); layout.appendChild(rightWrap);
  board.appendChild(layout);
  requestAnimationFrame(() => {
    const rc = board.querySelector(".group-right-col");
    const lc = board.querySelector(".group-unassigned-pool");
    if (rc && savedRightScroll) rc.scrollTop = savedRightScroll;
    if (lc && savedLeftScroll)  lc.scrollTop = savedLeftScroll;
  });
}
