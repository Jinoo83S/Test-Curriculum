// ================================================================
// data-cleanup.js · Firestore/Local data diagnosis & cleanup helpers
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
    const timer = setInterval(() => {
      const done = list.every(d => initialLoad[d]);
      const timedOut = Date.now() - started > timeoutMs;
      if (done || timedOut) {
        clearInterval(timer);
        resolve(done);
      }
    }, 80);
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
  return [
    clean(card.gradeKey),
    subjectKey,
    clean(card.category),
    clean(card.track),
    clean(card.group),
    String(parseCreditValue(card.credits) || 0)
  ].join("|");
}

function getEntryCardIds(entry = {}) {
  return [...(entry.ttcardIds || []), entry.ttcardId].filter(Boolean);
}

function cardReferenceCounts() {
  const counts = new Map();
  (appState.timetable?.entries || []).forEach(entry => {
    getEntryCardIds(entry).forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
  });
  (appState.timetable?.ttcardGroups || []).forEach(group => {
    (group.poolCardIds || []).forEach(id => counts.set(id, (counts.get(id) || 0) + 0.1));
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
  // 정밀 계산은 화면의 시수 진단에서 수행합니다. 여기서는 정리 전/후 대략적인 검증용으로
  // 학급 라벨과 전체학년 카드 기준의 필요 시수를 간단히 산출합니다.
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

export function previewDataCleanup() {
  const duplicateCards = findDuplicateWholeGradeCards();
  const roomMigrations = findRoomHomeRoomMigrations();
  const removeIds = new Set(duplicateCards.map(x => x.removeId));
  const afterCards = (appState.timetable?.ttcards || []).filter(c => !removeIds.has(c.id));
  return {
    duplicateCards,
    roomMigrations,
    beforeCreditSnapshot: buildClassCreditSnapshot(appState.timetable?.ttcards || []),
    afterCreditSnapshot: buildClassCreditSnapshot(afterCards),
    totals: {
      duplicateCardCount: duplicateCards.length,
      roomMigrationCount: roomMigrations.length,
    }
  };
}

function replaceCardIdList(list = [], idMap = new Map()) {
  const out = [];
  (list || []).forEach(id => {
    const next = idMap.get(id) || id;
    if (next && !out.includes(next)) out.push(next);
  });
  return out;
}

function cleanupEntries(entries = [], idMap = new Map(), removeIds = new Set()) {
  const out = [];
  const seen = new Set();
  entries.forEach(entry => {
    const next = { ...entry };
    if (next.ttcardId) next.ttcardId = idMap.get(next.ttcardId) || next.ttcardId;
    if (Array.isArray(next.ttcardIds)) next.ttcardIds = replaceCardIdList(next.ttcardIds, idMap);
    if (next.templateId && removeIds.has(next.ttcardId)) return;
    const ids = getEntryCardIds(next);
    if (ids.length && ids.every(id => removeIds.has(id))) return;
    const key = [next.day, next.period, next.groupId || "", next.unitId || "", ids.sort().join(","), next.templateId || "", next.gradeKey || "", next.sectionIdx ?? ""].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(next);
  });
  return out;
}

function cleanupGroups(groups = [], idMap = new Map()) {
  return (groups || []).map(group => {
    const next = { ...group };
    next.poolCardIds = replaceCardIdList(group.poolCardIds || [], idMap);
    next.units = (group.units || []).map(unit => ({
      ...unit,
      ttcardIds: replaceCardIdList(unit.ttcardIds || [], idMap)
    })).filter(unit => (unit.ttcardIds || []).length || (unit.templateIds || []).length || clean(unit.name));
    return next;
  });
}

function applyDuplicateCardCleanup(preview) {
  const duplicateCards = preview?.duplicateCards || [];
  if (!duplicateCards.length) return false;
  const idMap = new Map(duplicateCards.map(x => [x.removeId, x.keepId]));
  const removeIds = new Set(duplicateCards.map(x => x.removeId));
  appState.timetable.ttcards = (appState.timetable.ttcards || []).filter(card => !removeIds.has(card.id));
  appState.timetable.ttcardGroups = cleanupGroups(appState.timetable.ttcardGroups || [], idMap);
  appState.timetable.entries = cleanupEntries(appState.timetable.entries || [], idMap, removeIds);
  return true;
}

function applyRoomHomeRoomMigration(preview) {
  const migrations = preview?.roomMigrations || [];
  if (!migrations.length) return false;
  const byRoom = new Map(migrations.map(m => [m.roomId, m]));
  const usedHomeRooms = new Set();
  appState.rooms.rooms = (appState.rooms.rooms || []).map(room => {
    const mig = byRoom.get(room.id);
    if (!mig) return room;
    usedHomeRooms.add(mig.homeRoomClassId);
    return {
      ...room,
      homeRoomClassId: mig.homeRoomClassId,
      teacherName: mig.newTeacherName,
      note: mig.newNote
    };
  }).map(room => {
    // 동일 홈룸이 여러 교실에 지정되는 것을 방지합니다.
    const homeId = clean(room.homeRoomClassId);
    if (!homeId) return room;
    if (!usedHomeRooms.has(homeId)) return room;
    usedHomeRooms.delete(homeId);
    return room;
  });
  return true;
}

export async function applyDataCleanup(preview = previewDataCleanup()) {
  if (!canEdit()) throw new Error("로그인/편집 권한이 필요합니다.");
  const changed = { timetable: false, rooms: false };
  changed.timetable = applyDuplicateCardCleanup(preview);
  changed.rooms = applyRoomHomeRoomMigration(preview);
  const saves = [];
  if (changed.timetable) saves.push(saveNow("timetable", { force: true }));
  if (changed.rooms) saves.push(saveNow("rooms", { force: true }));
  await Promise.all(saves);
  return { changed, preview: previewDataCleanup() };
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

function renderPreviewBody(body, preview) {
  body.innerHTML = "";
  const summary = el("div", "cleanup-summary");
  summary.innerHTML = `
    <div><b>중복 시간표 카드</b> ${preview.totals.duplicateCardCount}개</div>
    <div><b>교실 홈룸 마이그레이션</b> ${preview.totals.roomMigrationCount}건</div>
  `;
  body.appendChild(summary);

  const creditBox = el("div", "cleanup-section");
  creditBox.innerHTML = `<h4>학급별 필요 시수 예상</h4><p><b>정리 전</b> ${creditSnapshotText(preview.beforeCreditSnapshot)}</p><p><b>정리 후</b> ${creditSnapshotText(preview.afterCreditSnapshot)}</p>`;
  body.appendChild(creditBox);

  const dupBox = el("div", "cleanup-section");
  dupBox.innerHTML = `<h4>삭제/병합 예정 중복 카드</h4>`;
  if (preview.duplicateCards.length) {
    const list = el("ul", "cleanup-list");
    preview.duplicateCards.forEach(item => {
      const li = el("li", "", `${item.gradeKey} · ${item.title} · ${item.removeId} → ${item.keepId}`);
      list.appendChild(li);
    });
    dupBox.appendChild(list);
  } else {
    dupBox.appendChild(el("p", "muted", "중복 전체학년 카드가 없습니다."));
  }
  body.appendChild(dupBox);

  const roomBox = el("div", "cleanup-section");
  roomBox.innerHTML = `<h4>홈룸 마이그레이션 예정</h4>`;
  if (preview.roomMigrations.length) {
    const list = el("ul", "cleanup-list");
    preview.roomMigrations.forEach(item => {
      const li = el("li", "", `${item.roomName}: ${item.homeRoomLabel} 홈룸 지정, 담당 교사 ${item.newTeacherName || "-"}`);
      list.appendChild(li);
    });
    roomBox.appendChild(list);
  } else {
    roomBox.appendChild(el("p", "muted", "마이그레이션할 교실 홈룸 데이터가 없습니다."));
  }
  body.appendChild(roomBox);
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

  const overlay = el("div", "cleanup-modal-backdrop");
  const modal = el("div", "cleanup-modal");
  const header = el("div", "cleanup-modal-header");
  header.innerHTML = `
    <div class="cleanup-title-block">
      <span class="cleanup-kicker">데이터 안전 정리</span>
      <h3>DB 진단/정리</h3>
      <p>기존 Firestore 데이터를 삭제하지 않고, 중복 카드와 홈룸 데이터를 보정합니다.</p>
    </div>`;
  const closeBtn = el("button", "cleanup-icon-close", "×");
  closeBtn.type = "button";
  closeBtn.title = "닫기";
  closeBtn.setAttribute("aria-label", "DB 진단/정리 닫기");
  closeBtn.addEventListener("click", () => overlay.remove());
  header.appendChild(closeBtn);

  const body = el("div", "cleanup-modal-body", "진단 중…");
  const footer = el("div", "cleanup-modal-footer");
  const refreshBtn = el("button", "cleanup-refresh-btn", "↻ 다시 진단");
  refreshBtn.type = "button";
  const applyBtn = el("button", "cleanup-apply-btn", "정리 실행");
  applyBtn.type = "button";
  const closeFooterBtn = el("button", "cleanup-cancel-btn", "닫기");
  closeFooterBtn.type = "button";
  closeFooterBtn.addEventListener("click", () => overlay.remove());
  footer.append(closeFooterBtn, refreshBtn, applyBtn);
  modal.append(header, body, footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let preview = previewDataCleanup();
  renderPreviewBody(body, preview);

  refreshBtn.addEventListener("click", () => {
    preview = previewDataCleanup();
    renderPreviewBody(body, preview);
  });

  applyBtn.addEventListener("click", async () => {
    if (!preview.totals.duplicateCardCount && !preview.totals.roomMigrationCount) {
      alert("정리할 항목이 없습니다.");
      return;
    }
    if (!confirm("표시된 항목을 정리하고 저장할까요? 실행 전 Firestore 진단 JSON을 보관해 두는 것을 권장합니다.")) return;
    applyBtn.disabled = true;
    refreshBtn.disabled = true;
    applyBtn.textContent = "정리 중…";
    try {
      const result = await applyDataCleanup(preview);
      preview = result.preview;
      renderPreviewBody(body, preview);
      alert("DB 정리가 완료되었습니다. 화면을 새로고침한 뒤 자동배치를 다시 확인해 주세요.");
    } catch (e) {
      console.error(e);
      alert("DB 정리에 실패했습니다: " + (e?.message || e));
    } finally {
      applyBtn.disabled = false;
      refreshBtn.disabled = false;
      applyBtn.textContent = "정리 실행";
    }
  });
}
