// ================================================================
// timetable-detail.js · Detail modals and context menu
// ================================================================
import { appState, scheduleSave } from "./state.js";
import { canEdit } from "./auth.js";
import { getRooms } from "./rooms.js";
import { sectionLabel, gradeDisplay, clean, escapeHtml } from "./utils.js";
import {
  entryTitle, entryTeachers, entryGradeKeys, getTtCardClassLabels, getUnitDisplayTitle,
  describeTtCard
} from "./timetable-data.js";
import { getTtCardById } from "./ttcards.js";

let detailModalSeq = 0;
let detailModalTopZ = 10000;
const HOME_ROOM_ROOM_SELECT_VALUE = "__homeroom__";
const DETAIL_MODAL_OFFSET_STEP = 22;
const DETAIL_MODAL_OFFSET_CYCLE = 5;
const DETAIL_MODAL_MARGIN = 12;

function getOpenDetailModalPositionIndex() {
  return document.querySelectorAll(".tt-entry-detail-floating-modal").length % DETAIL_MODAL_OFFSET_CYCLE;
}

function getInitialModalPosition(maxWidth = 440) {
  const safeWidth = Math.min(Number(maxWidth) || 440, Math.max(280, window.innerWidth - DETAIL_MODAL_MARGIN * 2));
  const idx = getOpenDetailModalPositionIndex();
  const baseLeft = Math.round((window.innerWidth - safeWidth) / 2);
  const baseTop = Math.max(DETAIL_MODAL_MARGIN, Math.round(window.innerHeight * 0.08));
  return {
    left: Math.max(DETAIL_MODAL_MARGIN, baseLeft + idx * DETAIL_MODAL_OFFSET_STEP),
    top: Math.max(DETAIL_MODAL_MARGIN, baseTop + idx * DETAIL_MODAL_OFFSET_STEP),
  };
}

function bringModalToFront(modal) {
  if (!modal) return;
  modal.style.zIndex = String(++detailModalTopZ);
}

function clampModalPosition(modal) {
  if (!modal) return;
  const rect = modal.getBoundingClientRect();
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
  const left = Math.min(Math.max(parseFloat(modal.style.left) || margin, margin), maxLeft);
  const top = Math.min(Math.max(parseFloat(modal.style.top) || margin, margin), maxTop);
  modal.style.left = `${left}px`;
  modal.style.top = `${top}px`;
}

function makeModal({ maxWidth = 440, minWidth = 300, title = "배치 상세" } = {}) {
  const seq = detailModalSeq++;
  const modal = document.createElement("div");
  modal.id = `tt-entry-detail-modal-${Date.now()}-${seq}`;
  modal.className = "tt-entry-detail-floating-modal tt-entry-detail-side-panel";
  const panelWidth = Math.max(Number(minWidth) || 300, Math.min(Number(maxWidth) || 440, 520));
  modal.style.cssText = [
    "position:fixed",
    "right:12px",
    "left:auto",
    "top:calc(var(--tt-detail-panel-top, 88px))",
    "bottom:calc(var(--tt-bottom-active-height, 0px) + 12px)",
    `width:min(${panelWidth}px,calc(100vw - 24px))`,
    "max-width:calc(100vw - 24px)",
    "z-index:" + (++detailModalTopZ),
    "background:transparent",
    "pointer-events:auto"
  ].join(";");

  const box = document.createElement("div");
  box.className = "tt-detail-side-box";
  box.style.cssText = [
    "background:white",
    "border:1px solid #dbe4f0",
    "border-radius:12px",
    "padding:0 20px 18px",
    `min-width:min(${minWidth}px,calc(100vw - 24px))`,
    "width:100%",
    "height:100%",
    "max-height:100%",
    "overflow-y:auto",
    "box-shadow:0 18px 55px rgba(15,23,42,.28)",
    "font-size:13px",
    "position:relative",
    "scrollbar-gutter:stable",
    "box-sizing:border-box"
  ].join(";");

  const dragHandle = document.createElement("div");
  dragHandle.className = "tt-detail-drag-handle tt-detail-side-header";
  dragHandle.style.cssText = [
    "position:sticky",
    "left:0",
    "right:0",
    "top:0",
    "height:38px",
    "display:flex",
    "align-items:center",
    "gap:8px",
    "margin:0 -20px 14px",
    "padding:0 48px 0 14px",
    "border-bottom:1px solid #dbe4f0",
    "border-radius:12px 12px 0 0",
    "background:linear-gradient(180deg,#f8fbff,#eef5ff)",
    "color:#0f172a",
    "font-size:12px",
    "font-weight:900",
    "cursor:default",
    "user-select:none",
    "box-sizing:border-box",
    "z-index:30",
    "box-shadow:0 2px 8px rgba(15,23,42,.06)"
  ].join(";");

  const titleText = document.createElement("span");
  titleText.className = "tt-detail-title-text";
  titleText.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;";
  titleText.textContent = title;
  titleText.title = title;
  dragHandle.appendChild(titleText);

  const realCloseBtn = document.createElement("button");
  realCloseBtn.type = "button";
  realCloseBtn.className = "tt-detail-close-btn tt-detail-close-fixed";
  realCloseBtn.style.cssText = [
    "position:absolute",
    "top:5px",
    "right:8px",
    "width:29px",
    "height:29px",
    "border:1px solid #dbe4f0",
    "border-radius:999px",
    "background:#ffffff",
    "font-size:18px",
    "font-weight:900",
    "cursor:pointer",
    "color:#64748b",
    "line-height:1",
    "z-index:35",
    "box-shadow:0 2px 8px rgba(15,23,42,.08)"
  ].join(";");
  realCloseBtn.textContent = "×";
  dragHandle.appendChild(realCloseBtn);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tt-detail-close-sentinel";
  closeBtn.style.cssText = "display:none!important";
  closeBtn.textContent = "×";

  const setTitle = value => {
    const text = clean(value) || "배치 상세";
    titleText.textContent = text;
    titleText.title = text;
  };

  let resizeHandler = null;
  function closeModal() {
    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }
    modal.remove();
    if (!document.querySelector(".tt-entry-detail-side-panel")) document.body.classList.remove("tt-detail-panel-open");
  }
  realCloseBtn.onclick = closeModal;
  closeBtn.onclick = closeModal;

  modal.addEventListener("pointerdown", () => bringModalToFront(modal));
  resizeHandler = () => {};
  window.addEventListener("resize", resizeHandler, { passive: true });

  box.append(dragHandle);
  modal.appendChild(box);
  document.body.classList.add("tt-detail-panel-open");
  return { modal, box, closeBtn, setTitle };
}

const ROOM_RULE_LABELS = {
  auto: "자동 추천",
  fixed: "지정 교실 고정",
  homeroom: "홈룸 우선",
  teacher: "교사 교실 우선",
  none: "교실 사용 안 함",
};

function normalizeRoomRule(rule) {
  const r = clean(rule) || "auto";
  return ROOM_RULE_LABELS[r] ? r : "auto";
}

function makeRoomRuleSelect(value = "auto") {
  const sel = document.createElement("select");
  sel.style.cssText = "width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px";
  Object.entries(ROOM_RULE_LABELS).forEach(([v, l]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = l;
    if (v === normalizeRoomRule(value)) o.selected = true;
    sel.appendChild(o);
  });
  return sel;
}

function makeRoomSelect(value = "", { includeNone = true, includeHomeroom = false } = {}) {
  const sel = document.createElement("select");
  sel.style.cssText = "width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px";
  if (includeNone) {
    const no = document.createElement("option");
    no.value = "";
    no.textContent = "교실 없음";
    if (!value) no.selected = true;
    sel.appendChild(no);
  }
  if (includeHomeroom) {
    const home = document.createElement("option");
    home.value = HOME_ROOM_ROOM_SELECT_VALUE;
    home.textContent = "각 학반 홈룸으로 배정";
    home.title = "그룹/창체 카드의 모든 대상 학반을 각 학반 홈룸으로 나누어 배정합니다.";
    sel.appendChild(home);
  }
  getRooms().forEach(r => {
    const o = document.createElement("option");
    o.value = r.id;
    o.textContent = r.name;
    if (r.id === value) o.selected = true;
    sel.appendChild(o);
  });
  return sel;
}

function appendSelectField(box, labelText, control, { hint = "" } = {}) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin:8px 0";
  const label = document.createElement("label");
  label.style.cssText = "display:block;margin-bottom:3px;font-size:11px;color:#6b7280;font-weight:700";
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(control);
  if (hint) {
    const h = document.createElement("div");
    h.style.cssText = "margin-top:3px;font-size:10px;color:#64748b;line-height:1.35";
    h.textContent = hint;
    wrap.appendChild(h);
  }
  box.appendChild(wrap);
  return wrap;
}

function getRoomRuleHint(rule, roomId = "") {
  const r = normalizeRoomRule(rule);
  if (r === "fixed") return roomId ? `항상 ${getRooms().find(x => x.id === roomId)?.name || roomId} 교실을 사용합니다.` : "지정 교실을 선택해야 합니다.";
  if (r === "homeroom") return "대상 학급의 홈룸 교실을 우선 추천합니다.";
  if (r === "teacher") return "담당 교사의 전용/담당 교실을 우선 추천합니다.";
  if (r === "none") return "이 수업은 교실을 배정하지 않습니다.";
  return "지정 교실, 홈룸, 교사 교실 순서로 자동 추천합니다.";
}

function roomNameForId(roomId = "") {
  const id = clean(roomId);
  if (!id) return "";
  return getRooms().find(x => x.id === id)?.name || id;
}

function makeTinyButton(label, onClick, { primary = false } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.style.cssText = [
    "padding:5px 8px",
    `border:1px solid ${primary ? "#2563eb" : "#cbd5e1"}`,
    "border-radius:6px",
    `background:${primary ? "#2563eb" : "#fff"}`,
    `color:${primary ? "white" : "#334155"}`,
    "font-size:11px",
    "font-weight:900",
    "cursor:pointer",
    "white-space:nowrap"
  ].join(";");
  btn.textContent = label;
  btn.onclick = onClick;
  return btn;
}

function cardRoomSummaryText(card = {}) {
  const rule = normalizeRoomRule(card.roomRule);
  if (rule === "fixed") return `고정: ${roomNameForId(card.fixedRoomId) || "교실 미지정"}`;
  return ROOM_RULE_LABELS[rule] || ROOM_RULE_LABELS.auto;
}
function splitTeacherNamesLocal(value = "") {
  return String(value || "")
    .split(/[,，·/]+/)
    .map(x => clean(x))
    .filter(Boolean);
}



function getCardsCommonRoomRule(cards = []) {
  const valid = (cards || []).filter(Boolean);
  if (!valid.length) return { rule: "auto", fixedRoomId: "", mixed: false };
  const rules = [...new Set(valid.map(card => normalizeRoomRule(card.roomRule)))];
  const fixedIds = [...new Set(valid.map(card => clean(card.fixedRoomId)).filter(Boolean))];
  return {
    rule: rules.length === 1 ? rules[0] : "auto",
    fixedRoomId: fixedIds.length === 1 ? fixedIds[0] : "",
    mixed: rules.length > 1 || fixedIds.length > 1
  };
}

function targetRoomSummaryText(cards = []) {
  const valid = (cards || []).filter(Boolean);
  if (!valid.length) return ROOM_RULE_LABELS.auto;
  const common = getCardsCommonRoomRule(valid);
  if (common.mixed) return "혼합 규칙";
  return cardRoomSummaryText(valid[0]);
}

function buildRoomRuleTargets(items = [], groupId = "") {
  const validItems = (items || []).filter(x => x.card?.id);
  const byCardId = new Map(validItems.map(x => [x.card.id, x]));
  const targets = [];
  const used = new Set();
  const group = (appState.timetable?.ttcardGroups || []).find(g => g.id === groupId);

  (group?.units || []).forEach((unit, idx) => {
    const ids = [...new Set((unit.ttcardIds || []).filter(id => byCardId.has(id)) )];
    if (!ids.length) return;
    ids.forEach(id => used.add(id));
    const unitItems = ids.map(id => byCardId.get(id)).filter(Boolean);
    const names = unitItems.map(x => x.item.title || x.item.subject || x.card.label || x.card.subject || "-");
    const teachers = [...new Set(unitItems.flatMap(x => x.item.teachers?.length ? x.item.teachers : (x.card.teachers || splitTeacherNamesLocal(x.card.teacherName || ""))).filter(Boolean))];
    const classLabels = compactInlineLabels(unitItems.flatMap(x => {
      if (x.item.classLabels?.length) return x.item.classLabels;
      if (x.card.classLabels?.length) return x.card.classLabels;
      return [x.item.sectionLabel || sectionLabel(x.item.sectionIdx ?? x.card.sectionIdx ?? 0)];
    }));
    targets.push({
      kind: "unit",
      ids,
      cards: unitItems.map(x => x.card),
      title: names.join(" / ") || unit.name || `수업 묶음 ${idx + 1}`,
      sub: `${classLabels || "-"} · ${teachers.join(", ") || "교사 없음"}`
    });
  });

  validItems.forEach(({ item, card }) => {
    if (used.has(card.id)) return;
    const cls = formatClassLabelList(
      item.gradeKey || card.gradeKey,
      item.classLabels?.length ? item.classLabels : (card.classLabels?.length ? card.classLabels : [item.sectionLabel || sectionLabel(item.sectionIdx ?? card.sectionIdx ?? 0)])
    );
    targets.push({
      kind: "card",
      ids: [card.id],
      cards: [card],
      title: item.title || item.subject || card.label || card.subject || "-",
      sub: `${cls} · ${(item.teachers || card.teachers || []).join(", ") || card.teacherName || "교사 없음"}`
    });
  });

  return targets;
}

function compactInlineLabels(labels = []) {
  const cleaned = [...new Set((labels || []).map(clean).filter(Boolean))];
  return cleaned.join(", ");
}

function appendCardRoomRuleEditor(box, detailItems, ctx, modal, groupId = "") {
  const items = (detailItems || [])
    .map(item => ({ item, card: getTtCardById(item.ttcardId || item.id) }))
    .filter(x => x.card?.id);
  const cardIds = [...new Set(items.map(x => x.card.id))];
  if (!cardIds.length || !canEdit()) return;

  const first = items[0]?.card;
  const sameRule = cardIds.every(id => normalizeRoomRule(getTtCardById(id)?.roomRule) === normalizeRoomRule(first?.roomRule));
  const sameRoom = cardIds.every(id => clean(getTtCardById(id)?.fixedRoomId) === clean(first?.fixedRoomId));

  const section = document.createElement("div");
  section.style.cssText = "margin:12px 0 10px;padding:10px;border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc";

  const h = document.createElement("div");
  h.style.cssText = "font-size:12px;font-weight:900;color:#334155;margin-bottom:5px";
  h.textContent = groupId ? "이 시간 구성 과목별 교실 배정" : "교실 배정 규칙";
  section.appendChild(h);

  const intro = document.createElement("div");
  intro.style.cssText = "font-size:10px;color:#64748b;line-height:1.45;margin-bottom:8px";
  intro.textContent = groupId
    ? "이 시간대에 실제로 함께 열리는 구성 과목만 표시합니다. 복합 과목의 다른 파트는 다른 시간대에 표시됩니다."
    : "이 과목카드가 자동배치될 때 사용할 교실 규칙입니다.";
  section.appendChild(intro);

  const targets = buildRoomRuleTargets(items, groupId);

  // 그룹/다중 카드용: 수업 묶음 또는 구성 카드별 개별 교실 규칙 편집
  if (targets.length > 1) {
    const listTitle = document.createElement("div");
    listTitle.style.cssText = "margin:8px 0 6px;font-size:11px;font-weight:900;color:#1e293b";
    listTitle.textContent = targets.some(t => t.kind === "unit") ? "구성 묶음별 교실 지정" : "구성 과목별 교실 지정";
    section.appendChild(listTitle);

    const list = document.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:6px;max-height:340px;overflow:auto;overscroll-behavior:contain;padding-right:2px";

    targets.forEach(target => {
      const row = document.createElement("div");
      row.style.cssText = "padding:8px;border:1px solid #e5e7eb;border-radius:8px;background:white";

      const top = document.createElement("div");
      top.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px";

      const main = document.createElement("div");
      main.style.cssText = "min-width:0;flex:1";
      const name = document.createElement("div");
      name.style.cssText = "font-size:12px;font-weight:900;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      name.textContent = target.title || "-";
      name.title = name.textContent;

      const sub = document.createElement("div");
      sub.style.cssText = "font-size:10px;color:#64748b;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      sub.textContent = target.sub || "-";
      sub.title = sub.textContent;
      main.append(name, sub);

      const summary = document.createElement("span");
      summary.style.cssText = "font-size:10px;font-weight:900;color:#334155;background:#e2e8f0;border-radius:999px;padding:2px 7px;white-space:nowrap";
      summary.textContent = targetRoomSummaryText(target.cards);
      top.append(main, summary);
      row.appendChild(top);

      const controls = document.createElement("div");
      controls.style.cssText = "display:grid;grid-template-columns:minmax(110px,1fr) minmax(110px,1fr) auto;gap:6px;align-items:end";

      const common = getCardsCommonRoomRule(target.cards);
      const ruleBox = document.createElement("div");
      const ruleLabel = document.createElement("label");
      ruleLabel.style.cssText = "display:block;margin-bottom:3px;font-size:10px;color:#6b7280;font-weight:800";
      ruleLabel.textContent = "배정 방식";
      const ruleSel = makeRoomRuleSelect(common.rule || "auto");
      ruleSel.style.fontSize = "11px";
      ruleBox.append(ruleLabel, ruleSel);

      const roomBox = document.createElement("div");
      const roomLabel = document.createElement("label");
      roomLabel.style.cssText = "display:block;margin-bottom:3px;font-size:10px;color:#6b7280;font-weight:800";
      roomLabel.textContent = "지정 교실";
      const roomSel = makeRoomSelect(common.fixedRoomId || "");
      roomSel.style.fontSize = "11px";
      roomBox.append(roomLabel, roomSel);

      const saveBtn = makeTinyButton("저장", () => {
        if (normalizeRoomRule(ruleSel.value) === "fixed" && !roomSel.value) {
          alert("지정 교실 고정은 교실을 선택해야 합니다.");
          return;
        }
        const ok = ctx.setTtCardRoomPreference?.(target.ids, ruleSel.value, roomSel.value);
        if (ok) {
          const refreshedCards = target.ids.map(id => getTtCardById(id)).filter(Boolean);
          summary.textContent = targetRoomSummaryText(refreshedCards);
          ctx.renderAll?.();
        }
      }, { primary: true });

      const refreshRow = () => {
        roomBox.style.display = normalizeRoomRule(ruleSel.value) === "fixed" ? "block" : "none";
        saveBtn.title = getRoomRuleHint(ruleSel.value, roomSel.value);
      };
      ruleSel.addEventListener("change", refreshRow);
      roomSel.addEventListener("change", refreshRow);
      refreshRow();

      controls.append(ruleBox, roomBox, saveBtn);
      row.appendChild(controls);
      list.appendChild(row);
    });
    section.appendChild(list);
  }

  // 전체 적용은 유지하되, 다중 카드에서는 보조 기능으로 아래쪽에 둡니다.
  const bulk = document.createElement("div");
  bulk.style.cssText = targets.length > 1
    ? "margin-top:10px;padding-top:9px;border-top:1px dashed #cbd5e1"
    : "";

  const bulkTitle = document.createElement("div");
  bulkTitle.style.cssText = "font-size:11px;font-weight:900;color:#334155;margin-bottom:6px";
  bulkTitle.textContent = targets.length > 1 ? "전체 구성 과목에 한 번에 적용" : "교실 규칙 지정";
  bulk.appendChild(bulkTitle);

  const ruleSel = makeRoomRuleSelect(sameRule ? first?.roomRule : "auto");
  ruleSel.disabled = !canEdit();
  const roomSel = makeRoomSelect(sameRoom ? first?.fixedRoomId : "");
  roomSel.disabled = !canEdit();

  const hint = document.createElement("div");
  hint.style.cssText = "font-size:10px;color:#64748b;line-height:1.35;margin-top:5px";
  const refreshHint = () => {
    roomSel.parentElement.style.display = normalizeRoomRule(ruleSel.value) === "fixed" ? "block" : "none";
    hint.textContent = getRoomRuleHint(ruleSel.value, roomSel.value);
  };

  const ruleWrap = document.createElement("div");
  ruleWrap.style.marginBottom = "6px";
  const ruleLabel = document.createElement("label");
  ruleLabel.style.cssText = "display:block;margin-bottom:3px;font-size:11px;color:#6b7280;font-weight:700";
  ruleLabel.textContent = "배정 방식";
  ruleWrap.append(ruleLabel, ruleSel);
  bulk.appendChild(ruleWrap);

  const roomWrap = document.createElement("div");
  roomWrap.style.marginBottom = "6px";
  const roomLabel = document.createElement("label");
  roomLabel.style.cssText = "display:block;margin-bottom:3px;font-size:11px;color:#6b7280;font-weight:700";
  roomLabel.textContent = "지정 교실";
  roomWrap.append(roomLabel, roomSel);
  bulk.appendChild(roomWrap);

  const apply = document.createElement("button");
  apply.type = "button";
  apply.style.cssText = "width:100%;padding:6px;border:1px solid #2563eb;border-radius:6px;background:#2563eb;color:white;font-size:12px;font-weight:800;cursor:pointer";
  apply.textContent = targets.length > 1 ? "전체 구성 과목에 적용" : "교실 규칙 저장";
  apply.onclick = () => {
    if (normalizeRoomRule(ruleSel.value) === "fixed" && !roomSel.value) {
      alert("지정 교실 고정은 교실을 선택해야 합니다.");
      return;
    }
    const ok = ctx.setTtCardRoomPreference?.(cardIds, ruleSel.value, roomSel.value);
    if (ok) {
      ctx.renderAll?.();
      modal.remove();
    }
  };
  ruleSel.addEventListener("change", refreshHint);
  roomSel.addEventListener("change", refreshHint);
  refreshHint();
  bulk.append(hint, apply);
  section.appendChild(bulk);

  box.appendChild(section);
}

function formatClassLabel(gradeKey, sectionText) {
  const grade = gradeDisplay(gradeKey);
  const section = String(sectionText ?? "").trim();
  if (!section) return grade || "-";
  const compact = section.replace(/\s+/g, "").replace(/학년/g, "");
  if (/^\d{1,2}[A-Za-z가-힣0-9]/.test(compact)) return compact;
  return `${grade}${section}`;
}

function formatClassLabelList(gradeKey, labels = []) {
  const rawLabels = (Array.isArray(labels) ? labels : [labels])
    .flatMap(label => String(label ?? "")
      .split(/[,，·\/]+/)
      .map(x => x.trim())
      .filter(Boolean));
  const normalized = rawLabels.length ? rawLabels : [""];
  return [...new Set(normalized.map(label => formatClassLabel(gradeKey, label)))].join(", ") || "-";
}


function getTimetableGroupById(groupId = "") {
  if (!groupId) return null;
  return (appState.timetable?.ttcardGroups || []).find(g => g.id === groupId) || null;
}

function uniqueIds(ids = []) {
  const seen = new Set();
  return (ids || [])
    .map(clean)
    .filter(Boolean)
    .filter(id => !seen.has(id) && seen.add(id));
}

function getGroupUnitCardIds(group = {}) {
  return uniqueIds((group.units || []).flatMap(unit => unit.ttcardIds || []));
}

function getGroupAllCardIds(group = {}) {
  if (!group) return [];
  const excluded = new Set(uniqueIds(group.excludedCardIds || []));
  const ids = uniqueIds([
    ...(group.units || []).flatMap(unit => unit.ttcardIds || []),
    ...(group.poolCardIds || []),
    ...(group.ttcardIds || []),
    ...(group.cardIds || []),
  ]);
  return ids.filter(id => !excluded.has(id));
}

function describeCardId(cardId = "") {
  const card = getTtCardById(cardId);
  return card ? describeTtCard(card) : null;
}

function getGroupDetailCards(entry) {
  if (!entry) return [];
  const group = getTimetableGroupById(entry.groupId);
  if (group) {
    return getGroupAllCardIds(group).map(describeCardId).filter(Boolean);
  }

  const directIds = uniqueIds([entry.ttcardId, ...(entry.ttcardIds || [])]);
  return directIds.map(describeCardId).filter(Boolean);
}

function getEntryActiveDetailCards(entry) {
  if (!entry) return [];
  const directIds = uniqueIds([entry.ttcardId, ...(entry.ttcardIds || [])]);
  return directIds.map(describeCardId).filter(Boolean);
}

function describeInactiveGroupCards(entry) {
  if (!entry?.groupId) return [];
  const all = getGroupDetailCards(entry);
  const active = new Set(getEntryActiveDetailCards(entry).map(item => item.ttcardId || item.id).filter(Boolean));
  return all.filter(item => !active.has(item.ttcardId || item.id));
}

function getGroupDetailSections(group = null, allItems = []) {
  if (!group) {
    return [{ kind: "cards", title: "구성 과목", items: allItems || [] }].filter(s => s.items.length);
  }

  const byId = new Map((allItems || []).map(item => [item.ttcardId || item.id, item]));
  const used = new Set();
  const sections = [];

  (group.units || []).forEach((unit, idx) => {
    const ids = uniqueIds(unit.ttcardIds || []).filter(id => byId.has(id));
    if (!ids.length) return;
    ids.forEach(id => used.add(id));
    const title = clean(unit.name) || `묶음수업 ${idx + 1}`;
    sections.push({
      kind: "unit",
      title,
      items: ids.map(id => byId.get(id)).filter(Boolean),
    });
  });

  const poolIds = uniqueIds(group.poolCardIds || []).filter(id => byId.has(id) && !used.has(id));
  if (poolIds.length) {
    sections.push({
      kind: "pool",
      title: "그룹 카드 (묶음수업 미배정)",
      items: poolIds.map(id => byId.get(id)).filter(Boolean),
    });
  }

  const remaining = (allItems || []).filter(item => !used.has(item.ttcardId || item.id) && !poolIds.includes(item.ttcardId || item.id));
  if (remaining.length) {
    sections.push({ kind: "cards", title: "그룹 구성 과목", items: remaining });
  }

  return sections.filter(s => s.items.length);
}

function getAssignedCountForCardId(cardId = "", entriesFn = null) {
  if (!cardId || typeof entriesFn !== "function") return null;
  return (entriesFn() || []).filter(e => e?.ttcardId === cardId || (e?.ttcardIds || []).includes(cardId)).length;
}

function withAssignedCounts(items = [], entriesFn = null) {
  return (items || []).map(item => ({
    ...item,
    assignedCount: getAssignedCountForCardId(item.ttcardId || item.id, entriesFn),
  }));
}

function getDetailItemsClassSummary(items = []) {
  const labels = [];
  (items || []).forEach(item => {
    if (item.classLabels?.length) {
      item.classLabels.forEach(label => labels.push(formatClassLabel(item.gradeKey, label)));
    } else {
      labels.push(formatClassLabel(item.gradeKey, item.sectionLabel || sectionLabel(item.sectionIdx ?? 0)));
    }
  });
  return compactInlineLabels(labels) || "-";
}

function appendGroupDetailSection(box, detailItems, { title = "구성 과목", group = null, entriesFn = null } = {}) {
  if (!detailItems?.length) return;

  const items = withAssignedCounts(detailItems, entriesFn);
  const sections = getGroupDetailSections(group, items);
  const totalCount = items.length;

  const section = document.createElement("div");
  section.style.cssText = "margin:10px 0 10px;padding:10px;border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:7px";
  const h = document.createElement("div");
  h.style.cssText = "font-size:12px;font-weight:800;color:#334155";
  h.textContent = title;
  const count = document.createElement("span");
  count.style.cssText = "font-size:10px;font-weight:800;color:#166534;background:#dcfce7;border-radius:999px;padding:2px 7px";
  count.textContent = `${totalCount}개`;
  header.append(h, count);
  section.appendChild(header);

  const list = document.createElement("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:8px";

  function appendItemRow(parent, item) {
    const row = document.createElement("div");
    row.style.cssText = "display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;padding:7px 8px;border:1px solid #e5e7eb;border-radius:8px;background:white";

    const main = document.createElement("div");
    main.style.cssText = "min-width:0";
    const name = document.createElement("div");
    name.style.cssText = "font-size:12px;font-weight:800;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    name.textContent = item.title || item.subject || "-";
    name.title = name.textContent;

    const sub = document.createElement("div");
    sub.style.cssText = "font-size:10px;color:#64748b;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    const cls = formatClassLabelList(
      item.gradeKey,
      item.classLabels?.length ? item.classLabels : [item.sectionLabel || sectionLabel(item.sectionIdx ?? 0)]
    );
    sub.textContent = `${cls} · ${(item.teachers || []).join(", ") || "교사 없음"}`;
    sub.title = sub.textContent;
    main.append(name, sub);

    const credit = document.createElement("span");
    credit.style.cssText = "font-size:10px;font-weight:800;color:#334155;background:#e2e8f0;border-radius:999px;padding:2px 7px;white-space:nowrap";
    const assignedText = item.assignedCount == null ? "" : `${item.assignedCount} / `;
    credit.textContent = `${assignedText}${item.credits || "-"}시수`;

    row.append(main, credit);
    parent.appendChild(row);
  }

  sections.forEach(sec => {
    const groupBox = document.createElement("div");
    groupBox.style.cssText = "border:1px dashed #cbd5e1;border-radius:9px;background:#ffffff99;padding:8px;display:flex;flex-direction:column;gap:5px";

    const secHeader = document.createElement("div");
    secHeader.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:2px";
    const secTitle = document.createElement("div");
    secTitle.style.cssText = "font-size:11px;font-weight:900;color:#1e293b";
    secTitle.textContent = sec.title || "구성";
    const secBadge = document.createElement("span");
    secBadge.style.cssText = "font-size:9px;font-weight:900;border-radius:999px;padding:1px 6px;background:#dbeafe;color:#1d4ed8";
    secBadge.textContent = sec.kind === "unit" ? "동일 수업" : "개별 카드";
    secHeader.append(secTitle, secBadge);
    groupBox.appendChild(secHeader);

    sec.items.forEach(item => appendItemRow(groupBox, item));
    list.appendChild(groupBox);
  });

  section.appendChild(list);
  box.appendChild(section);
}


export function createTimetableDetailHandlers(ctx) {
  const entries = () => ctx.entries();
  const ttConfig = () => ctx.ttConfig();
  const currentGrade = () => ctx.currentGrade();

  function showSidebarCardDetail({ title, teachers, gradeKeys, credits, assigned, isDone, sectionIdx, groupName, groupId = "", detailItems = [] }) {
    const { modal, box, closeBtn, setTitle } = makeModal({ maxWidth: 460, minWidth: 300, title: `배치 상세 · ${title || "과목카드"}` });
    setTitle(`배치 상세 · ${title || "과목카드"}`);

    const firstGrade = gradeKeys[0] || currentGrade();
    const gc = ctx.getGradeColor(firstGrade);
    box.style.borderTop = `4px solid ${gc.border}`;

    const modeEl = document.createElement("div");
    modeEl.style.cssText = "font-size:10px;font-weight:900;color:#2563eb;background:#dbeafe;border-radius:999px;padding:2px 7px;display:inline-block;margin-bottom:6px";
    modeEl.textContent = "과목카드 상세";
    box.appendChild(modeEl);

    const titleEl = document.createElement("div");
    titleEl.style.cssText = "font-weight:700;font-size:15px;margin-bottom:10px;color:#1e3a5f;padding-right:20px";
    titleEl.textContent = title;
    box.appendChild(titleEl);

    const rows = [
      ["학년", gradeKeys.map(g => gradeDisplay(g)).join(", ") || "-"],
      ["반", detailItems.length ? `${detailItems.length}개 구성 카드` : (sectionIdx != null ? formatClassLabel(firstGrade, sectionLabel(sectionIdx)) : "-")],
      ["담당 교사", teachers.join(", ") || "-"],
      ["시수", String(credits || "-")],
      ["배정 현황", `${assigned} / ${credits} 차시${isDone ? "  ✅ 완료" : ""}`],
      ["그룹", groupName || "미배정"],
    ];

    rows.forEach(([lbl, val]) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;margin-bottom:5px;font-size:12px;align-items:baseline";
      const l = document.createElement("span");
      l.style.cssText = "color:#6b7280;font-weight:600;width:72px;flex-shrink:0";
      l.textContent = lbl;
      const v = document.createElement("span");
      v.style.cssText = "color:#1e293b;flex:1";
      v.textContent = val;
      row.append(l, v);
      box.appendChild(row);
    });

    if (detailItems.length) {
      const listTitle = document.createElement("div");
      listTitle.style.cssText = "margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:700;color:#475569";
      listTitle.textContent = "구성 카드";
      box.appendChild(listTitle);

      const list = document.createElement("div");
      list.style.cssText = "display:flex;flex-direction:column;gap:5px";
      detailItems.forEach(item => {
        const row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:1fr auto;gap:6px;padding:7px 9px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc";
        const main = document.createElement("div");
        main.style.cssText = "min-width:0";
        const nm = document.createElement("div");
        nm.style.cssText = "font-weight:700;color:#1e293b;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        nm.textContent = item.title;
        const sub = document.createElement("div");
        sub.style.cssText = "font-size:10px;color:#64748b;margin-top:2px";
        const itemClassLabel = formatClassLabelList(item.gradeKey, item.classLabels?.length ? item.classLabels : [item.sectionLabel || sectionLabel(item.sectionIdx ?? 0)]);
        sub.textContent = `${itemClassLabel} · ${(item.teachers || []).join(", ") || "교사 없음"}`;
        main.append(nm, sub);
        const cr = document.createElement("div");
        cr.style.cssText = "font-size:10px;font-weight:700;color:#334155;align-self:center;background:#e2e8f0;border-radius:999px;padding:2px 7px";
        cr.textContent = `${item.credits || "-"}시수`;
        row.append(main, cr);
        list.appendChild(row);
      });
      box.appendChild(list);
    }

    appendCardRoomRuleEditor(box, detailItems, ctx, modal, groupId);

    if (credits > 0) {
      const pct = Math.min(100, Math.round((assigned / credits) * 100));
      const bar = document.createElement("div");
      bar.style.cssText = "margin-top:10px;background:#f1f5f9;border-radius:999px;height:6px;overflow:hidden";
      const fill = document.createElement("div");
      fill.style.cssText = `height:100%;border-radius:999px;width:${pct}%;background:${isDone ? "#22c55e" : "#3b82f6"};transition:width .3s`;
      bar.appendChild(fill);
      box.appendChild(bar);
    }

    box.appendChild(closeBtn);
    document.body.appendChild(modal);
  }

  function showEntryDetailByUnit(unit, group, gradeKeys) {
    const unitTitle = getUnitDisplayTitle(unit);
    const { modal, box, closeBtn, setTitle } = makeModal({ maxWidth: 340, minWidth: 260, title: `배치 상세 · ${unitTitle}` });
    setTitle(`배치 상세 · ${unitTitle}`);
    box.insertAdjacentHTML("beforeend", `<div style="font-weight:700;font-size:14px;margin-bottom:8px;color:#1e3a5f">${unitTitle}</div>
      <div style="font-size:11px;color:#6b7280;margin-bottom:4px">그룹: ${group?.name || "-"}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${gradeKeys.map(g => `<span style="background:${ctx.getGradeColor(g).border};color:white;font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px">${gradeDisplay(g)}</span>`).join("")}</div>`);
    box.appendChild(closeBtn);
    document.body.appendChild(modal);
  }

  function showEntryContextMenu(entry, x, y) {
    document.getElementById("tt-context-menu")?.remove();
    const menu = document.createElement("div");
    menu.id = "tt-context-menu";
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:white;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.15);z-index:1000000;min-width:180px;overflow:visible;font-size:12px`;

    function menuItem(label, action, opts = {}) {
      const btn = document.createElement("div");
      btn.style.cssText = `padding:8px 14px;cursor:${opts.disabled ? "default" : "pointer"};color:${opts.danger ? "#dc2626" : opts.disabled ? "#9ca3af" : "#1e293b"};display:flex;align-items:center;gap:8px`;
      btn.innerHTML = label;
      if (!opts.disabled) {
        btn.onmouseenter = () => { btn.style.background = "#f8fafc"; };
        btn.onmouseleave = () => { btn.style.background = ""; };
        btn.onclick = () => { menu.remove(); action?.(); };
      }
      return btn;
    }
    function sep() {
      const hr = document.createElement("div");
      hr.style.cssText = "height:1px;background:#f1f5f9;margin:2px 0";
      return hr;
    }

    function applyRoomFromContext(roomId) {
      if (!canEdit()) return;
      const e = entries().find(x => x.id === entry.id);
      if (!e) return;
      if (e.roomId === roomId) return;
      ctx.captureTimetableUndo?.("우클릭 교실 변경");
      e.roomId = roomId || null;
      scheduleSave("timetable");
      ctx.recomputeConflicts?.();
      ctx.renderAll?.();
    }

    function getAvailableRoomsForEntry(entry) {
      const occupied = new Set(entries()
        .filter(e => e.id !== entry.id && e.day === entry.day && e.period === entry.period && e.roomId)
        .map(e => e.roomId));
      const currentRoomId = clean(entry.roomId || "");
      return getRooms()
        .filter(room => room?.id && !occupied.has(room.id) && room.id !== currentRoomId)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko", { numeric: true }));
    }

    function roomChangeMenuItem() {
      const rooms = getAvailableRoomsForEntry(entry);
      const item = document.createElement("div");
      item.style.cssText = "position:relative;padding:8px 14px;cursor:pointer;color:#1e293b;display:flex;align-items:center;gap:8px;white-space:nowrap";
      item.innerHTML = `<span>🏫 교실 변경</span><span style="margin-left:auto;color:#64748b;font-size:11px">▶</span>`;

      const sub = document.createElement("div");
      sub.style.cssText = [
        "position:absolute",
        "left:100%",
        "top:-4px",
        "display:none",
        "min-width:180px",
        "max-height:320px",
        "overflow-y:auto",
        "background:white",
        "border:1px solid #e2e8f0",
        "border-radius:8px",
        "box-shadow:0 8px 24px rgba(15,23,42,.18)",
        "z-index:9999",
        "padding:4px 0"
      ].join(";");

      const header = document.createElement("div");
      header.style.cssText = "padding:6px 10px;font-size:10px;font-weight:900;color:#64748b;border-bottom:1px solid #f1f5f9;background:#f8fafc";
      header.textContent = rooms.length ? "이 시간에 비어있는 교실" : "비어있는 교실 없음";
      sub.appendChild(header);

      if (!rooms.length) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding:8px 10px;color:#9ca3af;font-size:12px";
        empty.textContent = "선택 가능한 교실이 없습니다.";
        sub.appendChild(empty);
      } else {
        rooms.forEach(room => {
          const btn = document.createElement("div");
          btn.style.cssText = "padding:8px 10px;cursor:pointer;color:#1e293b;font-size:12px;display:flex;justify-content:space-between;gap:8px;align-items:center";
          const meta = [room.type, room.capacity ? `${room.capacity}명` : ""].filter(Boolean).join(" · ");
          btn.innerHTML = `<strong style="font-size:12px">${escapeHtml(room.name || room.id)}</strong>${meta ? `<span style="font-size:10px;color:#94a3b8">${escapeHtml(meta)}</span>` : ""}`;
          btn.onmouseenter = () => { btn.style.background = "#eff6ff"; };
          btn.onmouseleave = () => { btn.style.background = ""; };
          btn.onclick = ev => {
            ev.stopPropagation();
            menu.remove();
            applyRoomFromContext(room.id);
          };
          sub.appendChild(btn);
        });
      }

      item.appendChild(sub);
      item.onmouseenter = () => {
        item.style.background = "#f8fafc";
        sub.style.display = "block";
        requestAnimationFrame(() => {
          const r = sub.getBoundingClientRect();
          if (r.right > window.innerWidth) {
            sub.style.left = "auto";
            sub.style.right = "100%";
          }
          if (r.bottom > window.innerHeight) {
            sub.style.top = `${Math.min(0, window.innerHeight - r.bottom - 8)}px`;
          }
        });
      };
      sub.onmouseenter = () => {
        item.style.background = "#f8fafc";
        sub.style.display = "block";
      };
      sub.onmouseleave = () => {
        item.style.background = "";
        sub.style.display = "none";
      };
      item.onmouseleave = ev => {
        const to = ev.relatedTarget;
        if (to && sub.contains(to)) return;
        item.style.background = "";
        sub.style.display = "none";
      };
      return item;
    }

    menu.appendChild(menuItem("📋 수업 정보 편집", () => showEntryDetail(entry)));
    menu.appendChild(roomChangeMenuItem());
    menu.appendChild(menuItem("📅 배정 현황 보기", () => showSubjectAssignmentHistory(entry)));
    menu.appendChild(menuItem("🔍 하단 카드에서 찾기", () => highlightSidebarCard(entry)));
    menu.appendChild(sep());
    const pinBlockEntries = ctx.getEntryPinBlockEntries?.(entry) || [entry];
    const allPinned = pinBlockEntries.length && pinBlockEntries.every(e => e.pinned);
    const pinLabel = pinBlockEntries.length > 1
      ? (allPinned ? `📌 묶음 고정 해제 (${pinBlockEntries.length})` : `📍 이 묶음 시간에 고정 (${pinBlockEntries.length})`)
      : (entry.pinned ? "📌 고정 해제" : "📍 이 시간에 고정");
    menu.appendChild(menuItem(pinLabel, () => {
      if (typeof ctx.toggleEntryPinnedBlock === "function") {
        ctx.toggleEntryPinnedBlock(entry);
        return;
      }
      const e = entries().find(x => x.id === entry.id);
      if (e) {
        ctx.captureTimetableUndo("수업 고정 변경");
        e.pinned = !e.pinned;
        scheduleSave("timetable");
        ctx.renderAll();
      }
    }));
    menu.appendChild(sep());
    menu.appendChild(menuItem("🗑 이 수업 삭제", () => {
      ctx.removeEntry(entry.id);
      ctx.recomputeConflicts();
      ctx.renderAll();
    }, { danger: true }));

    setTimeout(() => {
      document.addEventListener("click", () => menu.remove(), { once: true });
      document.addEventListener("contextmenu", () => menu.remove(), { once: true });
    }, 10);

    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
  }

  function showSubjectAssignmentHistory(entry) {
    const historyTitle = `${entryTitle(entry)} — 배정 현황`;
    const { modal, box, closeBtn, setTitle } = makeModal({ maxWidth: 440, minWidth: 300, title: historyTitle });
    setTitle(historyTitle);
    const gradeKeys = entryGradeKeys(entry);
    const gc = ctx.getGradeColor(gradeKeys[0] || currentGrade());
    box.style.borderTop = `4px solid ${gc.border}`;

    const titleEl = document.createElement("div");
    titleEl.style.cssText = "font-weight:700;font-size:15px;margin-bottom:12px;color:#1e3a5f;padding-right:24px";
    titleEl.textContent = historyTitle;
    box.appendChild(titleEl);

    const tplId = entry.templateId || entry.templateIds?.[0];
    const grpId = entry.groupId;
    const related = entries().filter(e => {
      if (grpId && e.groupId === grpId) return true;
      if (tplId && (e.templateId === tplId || e.templateIds?.includes(tplId))) return true;
      return false;
    }).sort((a, b) => a.day - b.day || a.period - b.period);

    const dayLabels = ["월", "화", "수", "목", "금"];
    const periods = ttConfig().periodLabels || [];

    if (!related.length) {
      box.appendChild(Object.assign(document.createElement("div"), { textContent: "배정된 시수가 없습니다.", style: "color:#9ca3af;font-size:12px" }));
    } else {
      const list = document.createElement("div");
      list.style.cssText = "display:flex;flex-direction:column;gap:4px";
      related.forEach((e, i) => {
        const row = document.createElement("div");
        row.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;background:${e.id === entry.id ? gc.bg + "99" : "#f8fafc"};border:1px solid ${e.id === entry.id ? gc.border : "#e2e8f0"};cursor:pointer`;
        const idxEl = document.createElement("span");
        idxEl.style.cssText = "font-size:10px;color:#6b7280;width:18px;text-align:center;font-weight:700";
        idxEl.textContent = i + 1;
        const slotEl = document.createElement("span");
        slotEl.style.cssText = "font-weight:700;color:#1e293b";
        slotEl.textContent = `${dayLabels[e.day]} ${periods[e.period] || `${e.period + 1}교시`}`;
        const secEl = document.createElement("span");
        secEl.style.cssText = "font-size:10px;color:#6b7280;flex:1";
        secEl.textContent = ctx.getEntryClassSummary(e);
        const pinEl = document.createElement("span");
        if (e.pinned) { pinEl.textContent = "📌"; pinEl.style.fontSize = "10px"; }
        row.append(idxEl, slotEl, secEl, pinEl);
        row.onclick = () => { modal.remove(); showEntryDetail(e); };
        list.appendChild(row);
      });
      box.appendChild(list);

      const tplCredits = (() => {
        const g = gradeKeys[0] || currentGrade();
        const row = (appState.curriculum.gradeBoards[g] || []).find(r => r.sem1TemplateId === tplId || r.sem2TemplateId === tplId);
        return row?.credits ?? "?";
      })();
      const sumEl = document.createElement("div");
      sumEl.style.cssText = "margin-top:10px;font-size:11px;color:#6b7280;text-align:right";
      sumEl.textContent = `${related.length} / ${tplCredits} 시수 배정됨`;
      box.appendChild(sumEl);
    }

    box.appendChild(closeBtn);
    document.body.appendChild(modal);
  }

  function highlightSidebarCard(entry) {
    const tplId = entry.templateId || entry.templateIds?.[0];
    const grpId = entry.groupId;
    document.querySelectorAll(".tt-sc-highlighted").forEach(el => el.classList.remove("tt-sc-highlighted"));
    document.querySelectorAll(".tt-subject-card").forEach(card => {
      const grpMatch = grpId && card.dataset.groupId === grpId;
      const tplMatch = tplId && card.dataset.templateId === tplId;
      if (grpMatch || tplMatch) {
        card.classList.add("tt-sc-highlighted");
        card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      }
    });
    setTimeout(() => document.querySelectorAll(".tt-sc-highlighted").forEach(el => el.classList.remove("tt-sc-highlighted")), 3000);
  }

  function showEntryDetail(entry) {
    const detailTitle = `배치 상세 · ${entryTitle(entry)}`;
    const { modal, box, closeBtn, setTitle } = makeModal({ maxWidth: 400, minWidth: 300, title: detailTitle });
    setTitle(detailTitle);
    const gradeKeys = entryGradeKeys(entry);
    const gc = ctx.getGradeColor(gradeKeys[0] || currentGrade());
    box.style.borderTop = `4px solid ${gc.border}`;

    const modeEl = document.createElement("div");
    modeEl.style.cssText = "font-size:10px;font-weight:900;color:#166534;background:#dcfce7;border-radius:999px;padding:2px 7px;display:inline-block;margin-bottom:6px";
    modeEl.textContent = "배치 상세";
    box.appendChild(modeEl);

    const titleEl = document.createElement("div");
    titleEl.style.cssText = "font-weight:700;font-size:15px;margin-bottom:8px;color:#1e3a5f;padding-right:24px";
    titleEl.textContent = entryTitle(entry);
    box.appendChild(titleEl);

    function makeRow(label, value) {
      const r = document.createElement("div");
      r.style.cssText = "display:flex;align-items:baseline;gap:8px;margin-bottom:6px;font-size:12px";
      const l = document.createElement("span");
      l.style.cssText = "color:#6b7280;font-weight:600;width:70px;flex-shrink:0";
      l.textContent = label;
      const v = document.createElement("span");
      v.style.cssText = "color:#1e293b;flex:1";
      v.textContent = value;
      r.append(l, v);
      box.appendChild(r);
      return r;
    }

    const detailGroup = getTimetableGroupById(entry.groupId);
    const rawGroupDetailCards = entry.groupId ? getGroupDetailCards(entry) : [];
    const groupDetailCards = withAssignedCounts(rawGroupDetailCards, entries);
    const rawActiveDetailCards = entry.groupId ? getEntryActiveDetailCards(entry) : [];
    const activeDetailCards = withAssignedCounts(rawActiveDetailCards, entries);
    const inactiveGroupCards = entry.groupId ? describeInactiveGroupCards(entry) : [];
    const isGroupDetail = !!detailGroup && groupDetailCards.length > 1;
    const detailDisplayTitle = isGroupDetail ? (detailGroup.name || entry.groupName || entryTitle(entry)) : entryTitle(entry);
    if (isGroupDetail) {
      setTitle(`배치 상세 · ${detailDisplayTitle}`);
      titleEl.textContent = detailDisplayTitle;
    }

    makeRow("학년/반", isGroupDetail ? getDetailItemsClassSummary(groupDetailCards) : ctx.getEntryClassSummary(entry));

    const teachers = entryTeachers(entry);
    if (!isGroupDetail) {
      const tLabel = document.createElement("label");
      tLabel.style.cssText = "display:block;margin-bottom:3px;font-size:11px;color:#6b7280;font-weight:600";
      tLabel.textContent = "담당 교사";
      const tSel = document.createElement("select");
      tSel.style.cssText = "width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-bottom:8px";
      tSel.disabled = !canEdit();
      [{ v: "", l: "교사 없음" }, ...teachers.map(t => ({ v: t, l: t }))].forEach(({ v, l }) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = l;
        if (v === entry.teacherName) o.selected = true;
        tSel.appendChild(o);
      });
      tSel.addEventListener("change", e => {
        ctx.updateEntry(entry.id, "teacherName", e.target.value || null);
        ctx.recomputeConflicts();
        ctx.renderAll();
      });
      box.append(tLabel, tSel);
    }

    const tplId = entry.templateId || entry.templateIds?.[0];
    if (entry.groupId) {
      const assignedSlots = new Set(entries()
        .filter(e => e.groupId === entry.groupId)
        .map(e => `${e.day}:${e.period}`)
      ).size;
      makeRow("그룹 배치", `${assignedSlots}개 시간대 · 구성별 시수는 아래 표시`);
    } else if (tplId) {
      const directCardIds = [entry.ttcardId, ...(entry.ttcardIds || [])].filter(Boolean);
      const firstCard = directCardIds.length ? getTtCardById(directCardIds[0]) : null;
      const credits = firstCard?.credits ?? (() => {
        const row = (appState.curriculum.gradeBoards[gradeKeys[0] || currentGrade()] || []).find(r => r.sem1TemplateId === tplId || r.sem2TemplateId === tplId);
        return row?.credits ?? "-";
      })();
      const assigned = directCardIds.length
        ? entries().filter(e => directCardIds.some(id => e.ttcardId === id || (e.ttcardIds || []).includes(id))).length
        : entries().filter(e =>
            (e.templateId === tplId || e.templateIds?.includes(tplId)) &&
            e.gradeKey === (gradeKeys[0] || currentGrade()) &&
            (e.sectionIdx ?? 0) === (entry.sectionIdx ?? 0)
          ).length;
      makeRow("시수/배정", `${assigned} / ${credits} 차시`);
    }

    if (entry.groupId) {
      const grp = detailGroup || (appState.timetable.ttcardGroups || []).find(g => g.id === entry.groupId);
      makeRow("그룹", grp?.name || entry.groupId);
      appendGroupDetailSection(box, groupDetailCards, { title: "전체 그룹 구성", group: grp, entriesFn: entries });
      if (inactiveGroupCards.length && activeDetailCards.length) {
        const activeNotice = document.createElement("div");
        activeNotice.style.cssText = "margin:8px 0 4px;padding:8px 10px;border:1px solid #dbeafe;border-radius:8px;background:#eff6ff;color:#1e3a8a;font-size:10.5px;line-height:1.45";
        activeNotice.textContent = `현재 시간에는 전체 그룹 중 ${activeDetailCards.length}개 카드만 실제로 배치됩니다. 미적분(2)+심화물리(2)처럼 복합 과목은 시간대별로 해당 파트만 교실 배정에 나타납니다.`;
        box.appendChild(activeNotice);
      }
      appendCardRoomRuleEditor(box, activeDetailCards.length ? activeDetailCards : groupDetailCards, ctx, modal, entry.groupId);
    }

    if (!isGroupDetail) {
    const roomSection = document.createElement("div");
    roomSection.style.cssText = "margin:12px 0 10px;padding:10px;border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc";
    const roomTitle = document.createElement("div");
    roomTitle.style.cssText = "font-size:12px;font-weight:800;color:#334155;margin-bottom:6px";
    roomTitle.textContent = "교실 배정";
    roomSection.appendChild(roomTitle);

    const ruleSel = makeRoomRuleSelect(entry.roomPinned ? "fixed" : (entry.roomRule || "auto"));
    ruleSel.disabled = !canEdit();
    const roomSel = makeRoomSelect(entry.roomId || "", { includeHomeroom: true });
    roomSel.disabled = !canEdit();

    const ruleWrap = document.createElement("div");
    ruleWrap.style.marginBottom = "6px";
    const ruleLabel = document.createElement("label");
    ruleLabel.style.cssText = "display:block;margin-bottom:3px;font-size:11px;color:#6b7280;font-weight:700";
    ruleLabel.textContent = "배정 방식";
    ruleWrap.append(ruleLabel, ruleSel);

    const roomWrap = document.createElement("div");
    roomWrap.style.marginBottom = "6px";
    const roomLabel = document.createElement("label");
    roomLabel.style.cssText = "display:block;margin-bottom:3px;font-size:11px;color:#6b7280;font-weight:700";
    roomLabel.textContent = "교실";
    roomWrap.append(roomLabel, roomSel);

    const hint = document.createElement("div");
    hint.style.cssText = "font-size:10px;color:#64748b;line-height:1.35;margin:4px 0 7px";
    const refreshRoomUi = () => {
      const rule = normalizeRoomRule(ruleSel.value);
      if (rule === "homeroom" && roomSel.value !== HOME_ROOM_ROOM_SELECT_VALUE) {
        roomSel.value = HOME_ROOM_ROOM_SELECT_VALUE;
      } else if (rule !== "homeroom" && roomSel.value === HOME_ROOM_ROOM_SELECT_VALUE) {
        roomSel.value = entry.roomId || "";
      }
      roomWrap.style.display = "block";
      hint.textContent = entry.roomPinned
        ? `이 배치 수업은 현재 교실(${ctx.getRoomDisplayName?.(roomSel.value) || roomSel.value || "교실 없음"})에 고정되어 있습니다.`
        : roomSel.value === HOME_ROOM_ROOM_SELECT_VALUE
          ? "대상 학반별 홈룸으로 나누어 배정합니다. 교실 관리에서 각 학급의 홈룸이 지정되어 있어야 합니다."
          : getRoomRuleHint(rule, roomSel.value);
    };

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.style.cssText = "width:100%;padding:6px;border:1px solid #2563eb;border-radius:6px;background:#2563eb;color:white;font-size:12px;font-weight:800;cursor:pointer;margin-bottom:6px";
    applyBtn.textContent = "교실 설정 적용";
    applyBtn.disabled = !canEdit();
    applyBtn.onclick = () => {
      const selectedRoomValue = roomSel.value;
      const selectedRule = selectedRoomValue === HOME_ROOM_ROOM_SELECT_VALUE ? "homeroom" : ruleSel.value;
      if (normalizeRoomRule(selectedRule) === "fixed" && !selectedRoomValue) { alert("고정할 교실을 선택해 주세요."); return; }
      ctx.applyRoomRuleToEntry?.(entry.id, selectedRule, selectedRoomValue === HOME_ROOM_ROOM_SELECT_VALUE ? "" : selectedRoomValue);
      ctx.recomputeConflicts();
      ctx.renderAll();
      modal.remove();
    };

    roomSel.addEventListener("change", () => {
      if (!canEdit()) return;
      if (roomSel.value === HOME_ROOM_ROOM_SELECT_VALUE) {
        ruleSel.value = "homeroom";
        refreshRoomUi();
        return;
      }
      if (normalizeRoomRule(ruleSel.value) === "homeroom") ruleSel.value = "auto";
      // 교실만 바꾼 경우에는 현재 배치 수업에 직접 반영합니다. 고정은 별도 버튼/배정 방식에서 처리합니다.
      ctx.updateEntry(entry.id, "roomId", roomSel.value || null);
      ctx.recomputeConflicts();
      ctx.renderAll();
      refreshRoomUi();
    });
    ruleSel.addEventListener("change", refreshRoomUi);
    refreshRoomUi();

    roomSection.append(ruleWrap, roomWrap, hint, applyBtn);

    if (canEdit()) {
      const roomPinBtn = document.createElement("button");
      roomPinBtn.type = "button";
      roomPinBtn.style.cssText = "width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:6px;background:white;color:#334155;font-size:12px;font-weight:800;cursor:pointer";
      roomPinBtn.textContent = entry.roomPinned ? "🔓 교실 고정 해제" : "📍 이 교실에 고정";
      roomPinBtn.onclick = () => {
        if (roomSel.value === HOME_ROOM_ROOM_SELECT_VALUE) { alert("홈룸 배정은 교실 고정이 아니라 '교실 설정 적용'으로 처리해 주세요."); return; }
        const roomId = roomSel.value || entry.roomId || "";
        if (!entry.roomPinned && !roomId) { alert("고정할 교실을 먼저 선택해 주세요."); return; }
        const e = entries().find(x => x.id === entry.id);
        if (!e) return;
        ctx.captureTimetableUndo("교실 고정 변경");
        e.roomPinned = !e.roomPinned;
        e.roomRule = e.roomPinned ? "fixed" : (ruleSel.value || "auto");
        if (e.roomPinned) e.roomId = roomId;
        scheduleSave("timetable");
        ctx.recomputeConflicts();
        ctx.renderAll();
        modal.remove();
      };
      roomSection.appendChild(roomPinBtn);
    }
    box.appendChild(roomSection);
    }

    ctx.renderEntryConflictDetailSection(box, entry);

    const dayLabels = ["월", "화", "수", "목", "금"];
    const periods = ttConfig().periodLabels || [];
    const dtRow = document.createElement("div");
    dtRow.style.cssText = "display:flex;gap:6px;margin-bottom:8px";
    const dayLabel = document.createElement("label");
    dayLabel.style.cssText = "font-size:11px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px";
    dayLabel.textContent = "요일";
    const daySel = document.createElement("select");
    daySel.style.cssText = "padding:5px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;flex:1";
    daySel.disabled = !canEdit();
    dayLabels.forEach((l, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = l;
      if (i === entry.day) o.selected = true;
      daySel.appendChild(o);
    });
    const perLabel = document.createElement("label");
    perLabel.style.cssText = "font-size:11px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px";
    perLabel.textContent = "교시";
    const perSel = document.createElement("select");
    perSel.style.cssText = "padding:5px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;flex:1";
    perSel.disabled = !canEdit();
    periods.forEach((l, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = `${i + 1}교시`;
      if (i === entry.period) o.selected = true;
      perSel.appendChild(o);
    });
    const dayWrap = document.createElement("div");
    dayWrap.style.flex = "1";
    dayWrap.append(dayLabel, daySel);
    const perWrap = document.createElement("div");
    perWrap.style.flex = "1";
    perWrap.append(perLabel, perSel);

    const applySlot = () => {
      const d = parseInt(daySel.value);
      const p = parseInt(perSel.value);
      ctx.moveEntry(entry.id, d, p);
      ctx.recomputeConflicts();
      ctx.renderAll();
    };
    daySel.addEventListener("change", applySlot);
    perSel.addEventListener("change", applySlot);
    dtRow.append(dayWrap, perWrap);
    box.appendChild(dtRow);

    if (canEdit()) {
      const pinBtn = document.createElement("button");
      pinBtn.style.cssText = "width:100%;padding:5px;border:1px solid #d1d5db;border-radius:5px;background:#f8fafc;font-size:12px;cursor:pointer;margin-bottom:8px;font-weight:600";
      pinBtn.textContent = entry.pinned ? "📌 고정 해제" : "📍 이 시간에 고정";
      pinBtn.onclick = () => {
        const e = entries().find(x => x.id === entry.id);
        if (!e) return;
        ctx.captureTimetableUndo("수업 고정 변경");
        e.pinned = !e.pinned;
        scheduleSave("timetable");
        ctx.renderAll();
        modal.remove();
      };
      box.appendChild(pinBtn);
    }

    if (canEdit()) {
      const delBtn = document.createElement("button");
      delBtn.style.cssText = "width:100%;padding:6px;border:1px solid #fca5a5;border-radius:5px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:12px;font-weight:600";
      delBtn.textContent = "🗑 이 수업 삭제";
      delBtn.onclick = () => {
        ctx.removeEntry(entry.id);
        ctx.recomputeConflicts();
        ctx.renderAll();
        modal.remove();
      };
      box.appendChild(delBtn);
    }

    box.appendChild(closeBtn);
    document.body.appendChild(modal);
  }

  return {
    showSidebarCardDetail,
    showEntryDetailByUnit,
    showEntryContextMenu,
    showSubjectAssignmentHistory,
    highlightSidebarCard,
    showEntryDetail,
  };
}
