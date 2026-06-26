// ================================================================
// data-cleanup.js · Firestore/Local data diagnosis & cleanup helpers · r178
// ================================================================
import { appState, subscribeDomains, initialLoad, saveNow } from "./state.js";
import { canEdit } from "./auth.js";
import { clean, isChanCheCategory, isProtectedWholeGradeLabel, parseCreditValue } from "./utils.js";

const CLEANUP_DOMAINS = ["classes", "templates", "rooms", "rosters", "timetable"];

function waitForDomainsLoaded(domains = CLEANUP_DOMAINS, timeoutMs = 8000) {
  const list = [...new Set(domains || [])];
  if (!list.length || list.every(d => initialLoad[d])) return Promise.resolve(true);
  return new Promise(resolve => {
    const started = Date.now();
    const tick = () => {
      const done = list.every(d => initialLoad[d]);
      const timedOut = Date.now() - started > timeoutMs;
      if (done || timedOut) return resolve(done);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export async function ensureCleanupDomainsLoaded() {
  subscribeDomains(CLEANUP_DOMAINS);
  return waitForDomainsLoaded(CLEANUP_DOMAINS);
}

function gradeNumber(gradeKey = "") {
  const m = String(gradeKey || "").match(/\d{1,2}/);
  return m ? String(Number(m[0])) : "";
}

function classLabelForClass(cls = {}) {
  const g = gradeNumber(cls.grade);
  const s = clean(cls.name).toUpperCase();
  return g && s ? `${g}${s}` : "";
}

function normalizeClassLabel(v = "") {
  const text = clean(v).replace(/\s+/g, "").toUpperCase();
  const m = text.match(/^(\d{1,2})([A-Z])$/);
  return m ? `${Number(m[1])}${m[2]}` : "";
}

function classIdByLabelMap() {
  const map = new Map();
  (appState.classes?.classes || []).forEach(cls => {
    const label = classLabelForClass(cls);
    if (label) map.set(label, cls.id);
  });
  return map;
}

function titleOfCard(card = {}) {
  return clean(card.subject) || clean(card.nameKo) || clean(card.label) || clean(card.subjectEn) || clean(card.nameEn) || clean(card.templateId) || "이름 없음";
}

function extractCompoundPartIdFromCard(card = {}) {
  const direct = clean(card.partId || card.compoundPartId || card.sourcePartId || card.templatePartId);
  if (direct) return direct;
  const id = clean(card.id);
  const m = id.match(/_part_(.+)$/);
  return m ? clean(m[1]) : "";
}

function isWholeGradeLikeCard(card = {}) {
  const labelText = [
    card.subject, card.subjectEn, card.label, card.nameKo, card.nameEn,
    card.category, card.track, card.group
  ].map(clean).filter(Boolean).join(" ");
  return !!card.gradeKey && (
    !!card.isWholeGrade ||
    isChanCheCategory(card.category) ||
    isProtectedWholeGradeLabel(labelText)
  );
}

function duplicateKeyForWholeCard(card = {}) {
  if (!isWholeGradeLikeCard(card)) return "";
  const subjectKey = clean(card.templateId) || clean(card.subject) || clean(card.label);
  if (!subjectKey || !card.gradeKey) return "";
  // r178: 복합/묶음 과목 파트 카드는 같은 templateId·gradeKey·sectionIdx를 공유해도
  // 서로 다른 실제 수업입니다. partId를 key에 포함하지 않으면
  // “심화물리(2) → 미적분(2)”처럼 잘못된 안전 정리 대상으로 잡힙니다.
  const partKey = extractCompoundPartIdFromCard(card);
  return [
    clean(card.gradeKey),
    subjectKey,
    partKey ? `part:${partKey}` : "whole",
    clean(card.category),
    clean(card.track),
    clean(card.group),
    String(parseCreditValue(card.credits) || 0)
  ].join("|");
}

function getEntryCardIds(entry = {}) {
  return [...(entry.ttcardIds || []), entry.ttcardId].filter(Boolean);
}

function getCardIdsFromGroup(group = {}) {
  const ids = [];
  (group.poolCardIds || []).forEach(id => ids.push(id));
  (group.excludedCardIds || []).forEach(id => ids.push(id));
  (group.units || []).forEach(unit => (unit.ttcardIds || []).forEach(id => ids.push(id)));
  return ids.filter(Boolean);
}

function getCardMap() {
  return new Map((appState.timetable?.ttcards || []).map(card => [card.id, card]));
}

function cardReferenceCounts() {
  const counts = new Map();
  (appState.timetable?.entries || []).forEach(entry => {
    getEntryCardIds(entry).forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
  });
  (appState.timetable?.ttcardGroups || []).forEach(group => {
    (group.poolCardIds || []).forEach(id => counts.set(id, (counts.get(id) || 0) + 0.1));
    (group.excludedCardIds || []).forEach(id => counts.set(id, (counts.get(id) || 0) + 0.05));
    (group.units || []).forEach(unit => {
      (unit.ttcardIds || []).forEach(id => counts.set(id, (counts.get(id) || 0) + 0.1));
    });
  });
  return counts;
}

function chooseDuplicateKeep(cards = [], refCounts = new Map()) {
  return [...cards].sort((a, b) => {
    const ar = refCounts.get(a.id) || 0;
    const br = refCounts.get(b.id) || 0;
    if (br !== ar) return br - ar;
    const as = Number.isInteger(a.sectionIdx) ? a.sectionIdx : 999;
    const bs = Number.isInteger(b.sectionIdx) ? b.sectionIdx : 999;
    if (as !== bs) return as - bs;
    return String(a.id).localeCompare(String(b.id));
  })[0] || null;
}

function findDuplicateWholeGradeCards() {
  const cards = appState.timetable?.ttcards || [];
  const buckets = new Map();
  cards.forEach(card => {
    const key = duplicateKeyForWholeCard(card);
    if (!key) return;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(card);
  });

  const refCounts = cardReferenceCounts();
  const duplicates = [];
  buckets.forEach((bucket, key) => {
    if (bucket.length <= 1) return;
    const keep = chooseDuplicateKeep(bucket, refCounts);
    bucket.forEach(card => {
      if (!keep || card.id === keep.id) return;
      duplicates.push({
        key,
        removeId: card.id,
        keepId: keep.id,
        gradeKey: card.gradeKey,
        title: titleOfCard(card),
        removeSectionIdx: Number.isInteger(card.sectionIdx) ? card.sectionIdx : null,
        keepSectionIdx: Number.isInteger(keep.sectionIdx) ? keep.sectionIdx : null,
        reason: "전체학년/창체 성격 카드 중복"
      });
    });
  });
  return duplicates;
}

function findBrokenCardReferences() {
  const cardIds = new Set((appState.timetable?.ttcards || []).map(card => card.id));
  const brokenEntries = [];
  const brokenGroups = [];

  (appState.timetable?.entries || []).forEach((entry, index) => {
    const ids = getEntryCardIds(entry);
    const missing = ids.filter(id => !cardIds.has(id));
    if (missing.length) {
      brokenEntries.push({
        index,
        entryId: entry.id || "",
        day: entry.day,
        period: entry.period,
        title: clean(entry.subject) || clean(entry.label) || clean(entry.groupName) || "배치 엔트리",
        missing
      });
    }
  });

  (appState.timetable?.ttcardGroups || []).forEach((group, groupIndex) => {
    const missingPool = (group.poolCardIds || []).filter(id => !cardIds.has(id));
    const missingExcluded = (group.excludedCardIds || []).filter(id => !cardIds.has(id));
    const missingUnits = [];
    (group.units || []).forEach((unit, unitIndex) => {
      const missing = (unit.ttcardIds || []).filter(id => !cardIds.has(id));
      if (missing.length) missingUnits.push({ unitIndex, unitName: clean(unit.name) || `unit ${unitIndex + 1}`, missing });
    });
    const count = missingPool.length + missingExcluded.length + missingUnits.reduce((sum, u) => sum + u.missing.length, 0);
    if (count) {
      brokenGroups.push({
        groupIndex,
        groupId: group.id || "",
        groupName: clean(group.name) || clean(group.groupName) || `그룹 ${groupIndex + 1}`,
        missingPool,
        missingExcluded,
        missingUnits,
        count
      });
    }
  });
  return { brokenEntries, brokenGroups };
}

function findEmptyGroups() {
  return (appState.timetable?.ttcardGroups || [])
    .map((group, index) => ({
      index,
      groupId: group.id || "",
      groupName: clean(group.name) || clean(group.groupName) || `그룹 ${index + 1}`,
      cardCount: getCardIdsFromGroup(group).length,
      unitCount: (group.units || []).filter(unit => (unit.ttcardIds || []).length || (unit.templateIds || []).length || clean(unit.name)).length,
    }))
    .filter(item => !item.cardCount && !item.unitCount);
}

function entryDuplicateKey(entry = {}) {
  const ids = getEntryCardIds(entry).sort().join(",");
  return [
    entry.day ?? "",
    entry.period ?? "",
    entry.groupId || "",
    entry.unitId || "",
    ids,
    entry.ttcardId || "",
    entry.templateId || "",
    entry.gradeKey || "",
    entry.sectionIdx ?? "",
    clean(entry.subject) || clean(entry.label) || "",
    clean(entry.roomId) || clean(entry.roomName) || ""
  ].join("|");
}

function findDuplicateEntries() {
  const seen = new Map();
  const duplicates = [];
  (appState.timetable?.entries || []).forEach((entry, index) => {
    const key = entryDuplicateKey(entry);
    if (seen.has(key)) {
      duplicates.push({
        index,
        firstIndex: seen.get(key),
        entryId: entry.id || "",
        title: clean(entry.subject) || clean(entry.label) || clean(entry.groupName) || "배치 엔트리",
        day: entry.day,
        period: entry.period
      });
      return;
    }
    seen.set(key, index);
  });
  return duplicates;
}

function findRoomHomeRoomMigrations() {
  const classMap = classIdByLabelMap();
  const rooms = appState.rooms?.rooms || [];
  const migrations = [];
  rooms.forEach(room => {
    if (clean(room.homeRoomClassId)) return;
    const label = normalizeClassLabel(room.teacherName);
    if (!label) return;
    const classId = classMap.get(label);
    if (!classId) return;
    migrations.push({
      roomId: room.id,
      roomName: room.name,
      homeRoomLabel: label,
      homeRoomClassId: classId,
      oldTeacherName: room.teacherName,
      newTeacherName: clean(room.note),
      oldNote: room.note,
      newNote: "",
      reason: "teacherName에 들어간 학급값을 홈룸으로 이동"
    });
  });
  return migrations;
}

function buildClassCreditSnapshot(ttcards = appState.timetable?.ttcards || []) {
  // 정밀 계산은 시간표 시수 진단에서 수행합니다. 여기서는 정리 전/후 참고값만 산출합니다.
  const classes = appState.classes?.classes || [];
  const classLabelsByGrade = new Map();
  classes.forEach(cls => {
    const g = clean(cls.grade);
    const label = classLabelForClass(cls);
    if (!g || !label) return;
    if (!classLabelsByGrade.has(g)) classLabelsByGrade.set(g, []);
    classLabelsByGrade.get(g).push(label);
  });
  const out = new Map();
  const add = (label, credit) => {
    if (!label) return;
    out.set(label, (out.get(label) || 0) + (Number(credit) || 0));
  };
  ttcards.forEach(card => {
    const credit = parseCreditValue(card.credits) || 0;
    if (!credit) return;
    if (isWholeGradeLikeCard(card) && card.gradeKey) {
      (classLabelsByGrade.get(card.gradeKey) || []).forEach(label => add(label, credit));
      return;
    }
    const labels = [];
    if (Array.isArray(card.classLabels)) labels.push(...card.classLabels.map(normalizeClassLabel).filter(Boolean));
    if (!labels.length && Array.isArray(card.classKeys)) {
      card.classKeys.forEach(key => {
        const m = String(key || "").match(/(\d{1,2})[^A-Z0-9]*([A-Z])/i);
        if (m) labels.push(`${Number(m[1])}${String(m[2]).toUpperCase()}`);
      });
    }
    if (!labels.length && card.gradeKey) {
      const sec = Number.isInteger(card.sectionIdx) ? String.fromCharCode(65 + Math.max(0, card.sectionIdx)) : "A";
      labels.push(`${gradeNumber(card.gradeKey)}${sec}`);
    }
    [...new Set(labels)].forEach(label => add(label, credit));
  });
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko", { numeric: true })).map(([label, credits]) => ({ label, credits }));
}

function normalizeEntryClassKey(v = "") {
  const text = clean(v).replace(/학년/g, "").replace(/\s+/g, "").toUpperCase();
  const m = text.match(/^(\d{1,2})[:\-_/ ]?([A-Z])$/);
  return m ? `${Number(m[1])}${m[2]}` : "";
}

function buildActualEntrySlotSnapshot(entries = appState.timetable?.entries || []) {
  const slotsByClass = new Map();
  const add = (label, slot) => {
    if (!label || !slot) return;
    if (!slotsByClass.has(label)) slotsByClass.set(label, new Set());
    slotsByClass.get(label).add(slot);
  };
  (entries || []).forEach(entry => {
    const slot = `${entry.day}:${entry.period}`;
    if (!Number.isInteger(entry.day) || !Number.isInteger(entry.period)) return;
    const keys = Array.isArray(entry.audienceClassKeys) ? entry.audienceClassKeys : [];
    keys.map(normalizeEntryClassKey).filter(Boolean).forEach(label => add(label, slot));
  });
  return [...slotsByClass.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "ko", { numeric: true }))
    .map(([label, set]) => ({ label, credits: set.size }));
}

function buildCleanupPlan() {
  const duplicateCards = findDuplicateWholeGradeCards();
  const brokenRefs = findBrokenCardReferences();
  const emptyGroups = findEmptyGroups();
  const duplicateEntries = findDuplicateEntries();
  const roomMigrations = findRoomHomeRoomMigrations();
  const removeIds = new Set(duplicateCards.map(x => x.removeId));
  const afterCards = (appState.timetable?.ttcards || []).filter(c => !removeIds.has(c.id));
  const safeCount = duplicateCards.length + brokenRefs.brokenEntries.length + brokenRefs.brokenGroups.reduce((sum, g) => sum + g.count, 0) + emptyGroups.length;
  const cautionCount = duplicateEntries.length + roomMigrations.length;
  return {
    duplicateCards,
    brokenRefs,
    emptyGroups,
    duplicateEntries,
    roomMigrations,
    dangerous: [
      { title: "모든 시간표 카드 재생성", description: "현재 배치와 그룹 참조에 영향이 있을 수 있으므로 DB 정리 팝업에서는 실행하지 않습니다." },
      { title: "시간표 배치 전체 초기화", description: "시간표 편집 화면의 전용 초기화 기능에서만 실행하는 것이 안전합니다." },
    ],
    beforeCreditSnapshot: buildClassCreditSnapshot(appState.timetable?.ttcards || []),
    afterCreditSnapshot: buildClassCreditSnapshot(afterCards),
    actualEntrySnapshot: buildActualEntrySlotSnapshot(appState.timetable?.entries || []),
    totals: {
      safeCount,
      cautionCount,
      dangerousCount: 2,
      duplicateCardCount: duplicateCards.length,
      brokenEntryCount: brokenRefs.brokenEntries.length,
      brokenGroupRefCount: brokenRefs.brokenGroups.reduce((sum, g) => sum + g.count, 0),
      emptyGroupCount: emptyGroups.length,
      duplicateEntryCount: duplicateEntries.length,
      roomMigrationCount: roomMigrations.length,
    }
  };
}

export function previewDataCleanup() {
  return buildCleanupPlan();
}

function replaceCardIdList(list = [], idMap = new Map(), validIds = null) {
  const out = [];
  (list || []).forEach(id => {
    const next = idMap.get(id) || id;
    if (!next) return;
    if (validIds && !validIds.has(next)) return;
    if (!out.includes(next)) out.push(next);
  });
  return out;
}

function cleanupEntries(entries = [], idMap = new Map(), removeIds = new Set(), options = {}) {
  const validIds = options.validIds || null;
  const dedupe = !!options.dedupe;
  const out = [];
  const seen = new Set();
  entries.forEach(entry => {
    const next = { ...entry };
    const hadCardRefs = getEntryCardIds(next).length > 0;
    if (next.ttcardId) {
      const mapped = idMap.get(next.ttcardId) || next.ttcardId;
      next.ttcardId = validIds && !validIds.has(mapped) ? "" : mapped;
    }
    if (Array.isArray(next.ttcardIds)) next.ttcardIds = replaceCardIdList(next.ttcardIds || [], idMap, validIds);
    if (next.ttcardId && removeIds.has(next.ttcardId)) next.ttcardId = idMap.get(next.ttcardId) || "";
    if (Array.isArray(next.ttcardIds)) next.ttcardIds = next.ttcardIds.filter(id => !removeIds.has(id) || idMap.has(id));

    const ids = getEntryCardIds(next).filter(id => !validIds || validIds.has(id));
    if (hadCardRefs && !ids.length) return;
    if (Array.isArray(next.ttcardIds)) next.ttcardIds = next.ttcardIds.filter(Boolean);
    if (!next.ttcardId) delete next.ttcardId;

    if (dedupe) {
      const key = entryDuplicateKey(next);
      if (seen.has(key)) return;
      seen.add(key);
    }
    out.push(next);
  });
  return out;
}

function cleanupGroups(groups = [], idMap = new Map(), options = {}) {
  const validIds = options.validIds || null;
  const removeEmptyGroups = !!options.removeEmptyGroups;
  const out = [];
  (groups || []).forEach(group => {
    const next = { ...group };
    next.poolCardIds = replaceCardIdList(group.poolCardIds || [], idMap, validIds);
    next.excludedCardIds = replaceCardIdList(group.excludedCardIds || [], idMap, validIds);
    next.units = (group.units || []).map(unit => ({
      ...unit,
      ttcardIds: replaceCardIdList(unit.ttcardIds || [], idMap, validIds)
    })).filter(unit => (unit.ttcardIds || []).length || (unit.templateIds || []).length || clean(unit.name));
    const hasContent = (next.poolCardIds || []).length || (next.excludedCardIds || []).length || (next.units || []).length || clean(next.name) || clean(next.groupName);
    const hasCards = getCardIdsFromGroup(next).length > 0 || (next.units || []).some(unit => (unit.templateIds || []).length);
    if (removeEmptyGroups && hasContent && !hasCards && !(next.units || []).length) return;
    out.push(next);
  });
  return out;
}

function applySafeCleanup(preview) {
  const duplicateCards = preview?.duplicateCards || [];
  const idMap = new Map(duplicateCards.map(x => [x.removeId, x.keepId]));
  const removeIds = new Set(duplicateCards.map(x => x.removeId));
  const beforeCards = appState.timetable?.ttcards || [];
  const nextCards = beforeCards.filter(card => !removeIds.has(card.id));
  const validIds = new Set(nextCards.map(card => card.id));
  let changed = false;

  if (nextCards.length !== beforeCards.length) changed = true;
  appState.timetable.ttcards = nextCards;

  const beforeGroupJson = JSON.stringify(appState.timetable.ttcardGroups || []);
  appState.timetable.ttcardGroups = cleanupGroups(appState.timetable.ttcardGroups || [], idMap, { validIds, removeEmptyGroups: true });
  if (JSON.stringify(appState.timetable.ttcardGroups || []) !== beforeGroupJson) changed = true;

  const beforeEntryJson = JSON.stringify(appState.timetable.entries || []);
  appState.timetable.entries = cleanupEntries(appState.timetable.entries || [], idMap, removeIds, { validIds, dedupe: false });
  if (JSON.stringify(appState.timetable.entries || []) !== beforeEntryJson) changed = true;

  return changed;
}

function applyCautionCleanup(preview) {
  let changed = false;
  const validIds = new Set((appState.timetable?.ttcards || []).map(card => card.id));

  const beforeEntryJson = JSON.stringify(appState.timetable.entries || []);
  appState.timetable.entries = cleanupEntries(appState.timetable.entries || [], new Map(), new Set(), { validIds, dedupe: true });
  if (JSON.stringify(appState.timetable.entries || []) !== beforeEntryJson) changed = true;

  const beforeGroupJson = JSON.stringify(appState.timetable.ttcardGroups || []);
  appState.timetable.ttcardGroups = cleanupGroups(appState.timetable.ttcardGroups || [], new Map(), { validIds, removeEmptyGroups: true });
  if (JSON.stringify(appState.timetable.ttcardGroups || []) !== beforeGroupJson) changed = true;

  if (applyRoomHomeRoomMigration(preview)) changed = true;
  return changed;
}

function applyRoomHomeRoomMigration(preview) {
  const migrations = preview?.roomMigrations || [];
  if (!migrations.length) return false;
  const byRoom = new Map(migrations.map(m => [m.roomId, m]));
  const claimedHomeRooms = new Set();
  let changed = false;
  appState.rooms.rooms = (appState.rooms.rooms || []).map(room => {
    const mig = byRoom.get(room.id);
    if (!mig) return room;
    if (claimedHomeRooms.has(mig.homeRoomClassId)) return room;
    claimedHomeRooms.add(mig.homeRoomClassId);
    changed = true;
    return {
      ...room,
      homeRoomClassId: mig.homeRoomClassId,
      teacherName: mig.newTeacherName,
      note: mig.newNote
    };
  });
  return changed;
}

export async function applyDataCleanup(preview = previewDataCleanup(), mode = "safe") {
  if (!canEdit()) throw new Error("로그인/편집 권한이 필요합니다.");
  const changed = { timetable: false, rooms: false };
  changed.timetable = applySafeCleanup(preview);
  if (mode === "caution") {
    const beforeRooms = JSON.stringify(appState.rooms?.rooms || []);
    const cautionChanged = applyCautionCleanup(preview);
    changed.timetable = changed.timetable || cautionChanged;
    changed.rooms = JSON.stringify(appState.rooms?.rooms || []) !== beforeRooms;
  }
  const saves = [];
  if (changed.timetable) saves.push(saveNow("timetable", { force: true }));
  if (changed.rooms) saves.push(saveNow("rooms", { force: true }));
  await Promise.all(saves);
  return { changed, mode, preview: previewDataCleanup() };
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function creditSnapshotText(rows = []) {
  if (!rows.length) return "표시할 시수 데이터가 없습니다.";
  return rows.map(r => `${r.label} ${r.credits}`).join("  ");
}

function countLine(label, count, okText = "없음") {
  const strong = count ? `color:#b45309;font-weight:900;` : `color:#15803d;font-weight:900;`;
  return `<div style="display:flex;justify-content:space-between;gap:12px;"><span>${label}</span><b style="${strong}">${count ? `${count}건` : okText}</b></div>`;
}

function renderList(box, items, formatter, emptyText) {
  if (!items.length) {
    box.appendChild(el("p", "muted", emptyText));
    return;
  }
  const list = el("ul", "cleanup-list");
  items.slice(0, 120).forEach(item => list.appendChild(el("li", "", formatter(item))));
  if (items.length > 120) list.appendChild(el("li", "", `외 ${items.length - 120}건...`));
  box.appendChild(list);
}

function renderPreviewBody(body, preview) {
  body.innerHTML = "";
  const summary = el("div", "cleanup-summary");
  summary.innerHTML = `
    <div><b>안전 정리</b> ${preview.totals.safeCount}건</div>
    <div><b>주의 정리</b> ${preview.totals.cautionCount}건</div>
    <div><b>위험 정리</b> 별도 화면에서만 실행</div>
  `;
  body.appendChild(summary);

  const modeGuide = el("div", "cleanup-section");
  modeGuide.innerHTML = `
    <h4>정리 단계 구분</h4>
    <p style="margin:0;color:#64748b;font-size:12px;line-height:1.55;">
      <b>안전 정리</b>는 깨진 카드 참조, 빈 그룹, 전체학년/창체 중복 카드처럼 명백한 정리 대상만 처리합니다.<br>
      <b>주의 정리</b>는 중복 배치 엔트리 정리와 교실 홈룸 마이그레이션까지 포함합니다.<br>
      <b>위험 정리</b>인 전체 카드 재생성/시간표 초기화는 이 팝업에서 실행하지 않습니다.
    </p>
    <div style="display:grid;gap:5px;margin-top:10px;font-size:13px;">
      ${countLine("전체학년/창체 중복 카드", preview.totals.duplicateCardCount)}
      ${countLine("깨진 배치 엔트리 참조", preview.totals.brokenEntryCount)}
      ${countLine("깨진 그룹 카드 참조", preview.totals.brokenGroupRefCount)}
      ${countLine("빈 그룹", preview.totals.emptyGroupCount)}
      ${countLine("중복 배치 엔트리", preview.totals.duplicateEntryCount)}
      ${countLine("교실 홈룸 마이그레이션", preview.totals.roomMigrationCount)}
    </div>
  `;
  body.appendChild(modeGuide);

  const creditBox = el("div", "cleanup-section");
  creditBox.innerHTML = `
    <h4>학급별 시수 참고</h4>
    <p style="margin:0 0 6px;color:#64748b;font-size:12px;line-height:1.55;">
      <b>실제 시간표 점유</b>는 현재 배치된 entry의 학급 슬롯만 계산합니다.
      <b>카드 원시 합계</b>는 선택군/분반 후보를 모두 더한 참고값이므로 35시수 판단 기준으로 사용하지 않습니다.
    </p>
    <p><b>실제 시간표 점유</b> ${creditSnapshotText(preview.actualEntrySnapshot)}</p>
    <p><b>카드 원시 합계 · 정리 전</b> ${creditSnapshotText(preview.beforeCreditSnapshot)}</p>
    <p><b>카드 원시 합계 · 정리 후</b> ${creditSnapshotText(preview.afterCreditSnapshot)}</p>`;
  body.appendChild(creditBox);

  const safeBox = el("div", "cleanup-section");
  safeBox.innerHTML = `<h4>안전 정리 대상</h4>`;
  renderList(safeBox, preview.duplicateCards, item => `${item.gradeKey} · ${item.title} · ${item.removeId} → ${item.keepId}`, "중복 전체학년 카드가 없습니다.");
  renderList(safeBox, preview.brokenRefs.brokenEntries, item => `${item.title} ${item.day ?? "-"}요일 ${item.period ?? "-"}교시 · 누락 ${item.missing.join(", ")}`, "깨진 배치 엔트리 참조가 없습니다.");
  renderList(safeBox, preview.brokenRefs.brokenGroups, item => `${item.groupName} · 누락 카드 ${item.count}개`, "깨진 그룹 카드 참조가 없습니다.");
  renderList(safeBox, preview.emptyGroups, item => `${item.groupName} · ${item.groupId || "id 없음"}`, "빈 그룹이 없습니다.");
  body.appendChild(safeBox);

  const cautionBox = el("div", "cleanup-section");
  cautionBox.innerHTML = `<h4>주의 정리 대상</h4>`;
  renderList(cautionBox, preview.duplicateEntries, item => `${item.title} · ${item.day ?? "-"}요일 ${item.period ?? "-"}교시 · #${item.index}`, "중복 배치 엔트리가 없습니다.");
  renderList(cautionBox, preview.roomMigrations, item => `${item.roomName}: ${item.homeRoomLabel} 홈룸 지정, 담당 교사 ${item.newTeacherName || "-"}`, "마이그레이션할 교실 홈룸 데이터가 없습니다.");
  body.appendChild(cautionBox);

  const dangerBox = el("div", "cleanup-section");
  dangerBox.innerHTML = `<h4>위험 정리 · 이 팝업에서 실행하지 않음</h4>`;
  renderList(dangerBox, preview.dangerous, item => `${item.title}: ${item.description}`, "위험 정리 항목이 없습니다.");
  body.appendChild(dangerBox);
}

function applyInlineStyles(node, styles = {}) {
  if (!node) return node;
  Object.assign(node.style, styles);
  return node;
}

function makeUiButton(label, variant = "secondary", extraClass = "") {
  const btn = el("button", `his-ui-btn his-ui-btn-${variant} ${extraClass}`.trim(), label);
  btn.type = "button";
  const base = {
    appearance: "none",
    WebkitAppearance: "none",
    border: "0",
    borderRadius: "12px",
    minHeight: "36px",
    padding: "8px 14px",
    fontSize: "13px",
    fontWeight: "900",
    letterSpacing: "-0.01em",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    whiteSpace: "nowrap",
    lineHeight: "1",
    boxShadow: "0 1px 2px rgba(15,23,42,.08)",
  };
  const variants = {
    primary: { background: "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "#fff" },
    secondary: { background: "#eef5ff", color: "#1d4ed8", border: "1px solid #bfdbfe" },
    ghost: { background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" },
    danger: { background: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca" },
    warn: { background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa" },
  };
  applyInlineStyles(btn, { ...base, ...(variants[variant] || variants.secondary) });
  return btn;
}

function setButtonBusy(btn, busy, label) {
  if (!btn) return;
  btn.disabled = !!busy;
  btn.textContent = label;
  btn.style.opacity = busy ? ".62" : "";
  btn.style.cursor = busy ? "default" : "pointer";
}

export async function openDataCleanupDialog() {
  if (!canEdit()) {
    alert("로그인/편집 권한이 필요합니다.");
    return;
  }
  const loaded = await ensureCleanupDomainsLoaded();
  if (!loaded) {
    alert("정리 대상 데이터를 모두 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    return;
  }

  const overlay = el("div", "cleanup-modal-backdrop his-ui-modal-backdrop");
  applyInlineStyles(overlay, {
    position: "fixed",
    inset: "0",
    zIndex: "10000",
    background: "rgba(15,23,42,.54)",
    backdropFilter: "blur(5px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "28px",
  });

  const modal = el("div", "cleanup-modal his-ui-modal");
  applyInlineStyles(modal, {
    width: "min(940px, calc(100vw - 56px))",
    maxHeight: "min(88vh, 860px)",
    overflow: "hidden",
    background: "#fff",
    borderRadius: "24px",
    boxShadow: "0 30px 80px rgba(15,23,42,.32)",
    border: "1px solid rgba(226,232,240,.96)",
    display: "grid",
    gridTemplateRows: "auto minmax(0,1fr) auto",
  });

  const header = el("div", "cleanup-modal-header his-ui-modal-header");
  applyInlineStyles(header, {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "16px",
    padding: "20px 22px 16px",
    background: "linear-gradient(180deg,#f8fbff,#ffffff)",
    borderBottom: "1px solid #e2e8f0",
  });

  const titleBlock = el("div", "cleanup-title-block");
  titleBlock.innerHTML = `
    <span class="cleanup-kicker his-ui-kicker" style="display:inline-flex;align-items:center;margin-bottom:6px;padding:4px 9px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:900;">데이터 단계별 정리</span>
    <h3 style="margin:0 0 5px;font-size:21px;font-weight:900;letter-spacing:-.03em;color:#0f172a;">DB 진단/정리</h3>
    <p style="margin:0;color:#64748b;font-size:13px;line-height:1.45;">안전 정리와 주의 정리를 분리해, 의도적 그룹/묶음 수업을 최대한 보호합니다.</p>
  `;

  const closeBtn = makeUiButton("×", "ghost", "cleanup-icon-close his-ui-icon-btn");
  closeBtn.title = "닫기";
  closeBtn.setAttribute("aria-label", "DB 진단/정리 닫기");
  applyInlineStyles(closeBtn, {
    width: "36px",
    minWidth: "36px",
    height: "36px",
    minHeight: "36px",
    padding: "0",
    borderRadius: "14px",
    fontSize: "20px",
    boxShadow: "none",
  });
  closeBtn.addEventListener("click", () => overlay.remove());
  header.append(titleBlock, closeBtn);

  const body = el("div", "cleanup-modal-body his-ui-modal-body");
  body.textContent = "진단 중…";
  applyInlineStyles(body, {
    padding: "18px 20px",
    overflow: "auto",
    background: "#f8fafc",
    display: "grid",
    gap: "14px",
  });

  const footer = el("div", "cleanup-modal-footer his-ui-modal-footer");
  applyInlineStyles(footer, {
    display: "flex",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: "9px",
    padding: "14px 20px",
    borderTop: "1px solid #e2e8f0",
    background: "#fff",
  });

  const closeFooterBtn = makeUiButton("닫기", "ghost", "cleanup-cancel-btn");
  const refreshBtn = makeUiButton("↻ 다시 진단", "secondary", "cleanup-refresh-btn");
  const safeBtn = makeUiButton("안전 정리 실행", "primary", "cleanup-safe-btn");
  const cautionBtn = makeUiButton("주의 정리 실행", "warn", "cleanup-caution-btn");
  closeFooterBtn.addEventListener("click", () => overlay.remove());
  footer.append(closeFooterBtn, refreshBtn, safeBtn, cautionBtn);

  modal.append(header, body, footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let preview = previewDataCleanup();
  renderPreviewBody(body, preview);

  const refresh = () => {
    preview = previewDataCleanup();
    renderPreviewBody(body, preview);
  };

  refreshBtn.addEventListener("click", refresh);

  async function runCleanup(mode) {
    const isCaution = mode === "caution";
    const count = isCaution ? (preview.totals.safeCount + preview.totals.cautionCount) : preview.totals.safeCount;
    if (!count) {
      alert("정리할 항목이 없습니다.");
      return;
    }
    const message = isCaution
      ? "주의 정리는 안전 정리에 더해 중복 배치 엔트리와 교실 홈룸 마이그레이션까지 처리합니다. 실행할까요?"
      : "안전 정리는 깨진 참조, 빈 그룹, 전체학년/창체 중복 카드만 정리합니다. 실행할까요?";
    if (!confirm(message)) return;
    setButtonBusy(safeBtn, true, "정리 중…");
    setButtonBusy(cautionBtn, true, "정리 중…");
    setButtonBusy(refreshBtn, true, "↻ 다시 진단");
    try {
      const result = await applyDataCleanup(preview, mode);
      preview = result.preview;
      renderPreviewBody(body, preview);
      alert(isCaution ? "주의 정리가 완료되었습니다." : "안전 정리가 완료되었습니다.");
    } catch (e) {
      console.error(e);
      alert("DB 정리에 실패했습니다: " + (e?.message || e));
    } finally {
      setButtonBusy(safeBtn, false, "안전 정리 실행");
      setButtonBusy(cautionBtn, false, "주의 정리 실행");
      setButtonBusy(refreshBtn, false, "↻ 다시 진단");
    }
  }

  safeBtn.addEventListener("click", () => runCleanup("safe"));
  cautionBtn.addEventListener("click", () => runCleanup("caution"));
}
