// ================================================================
// timetable-autoassign.js · Auto Assignment Engine
// ================================================================
// This module keeps the auto-placement algorithm separate from the
// timetable page renderer. Dependencies are injected from timetable.js
// so the engine can still use the current app state, UI callbacks, and
// shared occupancy logic without creating circular imports.

export function createAutoAssignAll(deps) {
  const {
    GRADE_KEYS, canEdit, appState, scheduleSave, normalizeTimetableEntry,
    uid, sectionLabel, gradeDisplay, splitTeacherNames,
    getTemplateById, getTemplateCardTitle, getTtCardById,
    describeTtCard, makePlacementFromGroupItem, getSubjectsForGrade,
    entries, ttDomain, ttConfig, constraints,
    buildSchedulableItems, getEffectiveAssignedRoomId, applyDefaultRoomToEntryData,
    audienceForPlacement, audiencesConflict, ttCardIdsFromPlacement, protectedSlotConflict,
    shuffle, captureTimetableUndo, addTimetableLog, setLastAutoAssignReport,
    getConflictCounts, recomputeConflicts, renderAll, $
  } = deps;

  const ttGroups = () => appState.timetable?.ttcardGroups || [];

  const groupContainsCardId = (group, cardId, { includeExcluded = false } = {}) => {
    if (!group || !cardId) return false;
    if (!includeExcluded && (group.excludedCardIds || []).includes(cardId)) return false;
    if ((group.poolCardIds || []).includes(cardId)) return true;
    return (group.units || []).some(unit => (unit.ttcardIds || []).includes(cardId));
  };

  function groupIdsForCardId(cardId, options = {}) {
    if (!cardId) return [];
    return ttGroups()
      .filter(g => groupContainsCardId(g, cardId, options))
      .map(g => g.id);
  }

  function groupIdsForPlacement(x) {
    const ids = new Set();
    if (x?.groupId) ids.add(x.groupId);
    ttCardIdsFromPlacement(x).forEach(cardId => {
      groupIdsForCardId(cardId).forEach(groupId => ids.add(groupId));
    });

    // Legacy fallback only: older entries may not have ttcardId/ttcardIds.
    // Do not use this for normal current entries because templateId can be reused
    // across grades/cards and would make excluded cards look grouped again.
    if (!ids.size && x?.templateId) {
      (appState.timetable?.ttcards || [])
        .filter(c => c.templateId === x.templateId && (!x.gradeKey || c.gradeKey === x.gradeKey) && ((x.sectionIdx ?? null) == null || (c.sectionIdx ?? 0) === (x.sectionIdx ?? 0)))
        .forEach(c => groupIdsForCardId(c.id).forEach(groupId => ids.add(groupId)));
    }
    return [...ids];
  }

  function sameActiveGroup(a, b) {
    const aIds = new Set(groupIdsForPlacement(a));
    if (!aIds.size) return false;
    return groupIdsForPlacement(b).some(id => aIds.has(id));
  }

  /** Check if a placement item/entry belongs to a concurrent group */
  function isConcurrentItem(x) {
    return groupIdsForPlacement(x).some(groupId => {
      const grp = ttGroups().find(g => g.id === groupId);
      return grp && (grp.groupType === "concurrent" || !!grp.isConcurrent);
    });
  }

  function checkPlacementValid(item, slot, placed, options = {}) {
    const { respectSoftLimits = true, respectUnavailable = true, respectAssignedRoom = true } = options;
    const existing = [...entries(), ...placed];
    const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
    const teachers  = splitTeacherNames(item.teacherName).filter(Boolean);

    // 0. Pinned whole-grade activities such as chapel/창체 protect their slot first.
    if (protectedSlotConflict?.(item, slot.day, slot.period, { placed })) return false;

    // 0-1. If a card was explicitly removed from an auto group, do not let the
    // auto-assigner place it in that group's same-time slot by coincidence.
    if (slotEnts.some(e => hasAutoGroupExclusionSlotConflict(item, e))) return false;

    // 1. Teacher conflict. Same concurrent group is an intentional same-time bundle
    //    (for example Korean + Korean A split by roster), so internal teacher/student/room
    //    conflicts inside that group must not block placement.
    for (const e of slotEnts) {
      const sameGrp = sameActiveGroup(item, e);
      const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);
      if (conc) continue;

      const et = splitTeacherNames(e.teacherName).filter(Boolean);
      if (teachers.some(t => et.includes(t))) {
        if (item.unitId && e.unitId && item.unitId === e.unitId) continue;
        return false;
      }
    }

    // 2. Exact duplicate: same timetable card already exists in the slot.
    const itemCardIds = new Set(ttCardIdsFromPlacement(item));
    if (itemCardIds.size && slotEnts.some(e => ttCardIdsFromPlacement(e).some(id => itemCardIds.has(id)))) return false;
    if (!itemCardIds.size && slotEnts.some(e => e.templateId === item.templateId && e.gradeKey === item.gradeKey && e.sectionIdx === item.sectionIdx)) return false;

    // 3. Student conflict. Prefer roster-level student comparison; fall back to homeroom coverage.
    const itemAudience = audienceForPlacement(item);
    for (const e of slotEnts) {
      // Same unit → co-located intentionally
      if (item.unitId && e.unitId && item.unitId === e.unitId) continue;

      const sameGrp = sameActiveGroup(item, e);
      const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);
      const eAudience = audienceForPlacement(e);
      const conflict = audiencesConflict(itemAudience, eAudience);

      // Concurrent groups may share the same homeroom only when rosters prove students differ.
      if (conc) {
        if (itemAudience.studentKeys.size && eAudience.studentKeys.size && conflict) return false;
        continue;
      }
      if (conflict) return false;
    }

    // 4. Teacher max per day + unavailable slots
    const dayEnts = existing.filter(e => e.day === slot.day);
    for (const teacher of teachers) {
      const c = constraints()[teacher];
      // Unavailable slot check
      if (respectUnavailable && c?.unavailableSlots?.some(s => s.day === slot.day && s.period === slot.period)) return false;
      const count = dayEnts.filter(e => splitTeacherNames(e.teacherName).includes(teacher)).length;
      const max = Number(c?.maxPerDay) || 0;
      if (respectSoftLimits && max > 0 && count >= max) return false;
    }

    // 5. Teacher max consecutive
    for (const teacher of teachers) {
      const dayPeriods = dayEnts.filter(e => splitTeacherNames(e.teacherName).includes(teacher)).map(e => e.period);
      const all = [...dayPeriods, slot.period].sort((a,b) => a-b);
      let maxC = 1, cur = 1;
      for (let i = 1; i < all.length; i++) {
        cur = all[i] === all[i-1]+1 ? cur+1 : 1;
        maxC = Math.max(maxC, cur);
      }
      const maxConsecutive = Number(constraints()[teacher]?.maxConsecutive) || 0;
      if (respectSoftLimits && maxConsecutive > 0 && maxC > maxConsecutive) return false;
    }
    // 6. Room conflict: 실제 배정될 교실 기준으로 중복을 막습니다.
    // 같은 시간대의 서로 다른 과목은 각각 교실을 가져야 하며,
    // 같은 동시배정 그룹인 경우에만 의도적 공유를 허용합니다.
    const candidateRoomId = applyDefaultRoomToEntryData({ ...item, ...slot })?.roomId || null;
    if (respectAssignedRoom && candidateRoomId) {
      const roomBusy = slotEnts.some(e => {
        if (e.roomId !== candidateRoomId) return false;
        const sameGrp = sameActiveGroup(item, e);
        return !(sameGrp && isConcurrentItem(item) && isConcurrentItem(e));
      });
      if (roomBusy) return false;
    }

    // 7. 교사 담당교실도 추가 안전장치로 확인합니다.
    for (const teacher of teachers) {
      const roomId = getEffectiveAssignedRoomId(teacher);
      if (respectAssignedRoom && roomId) {
        const roomBusy = existing.some(e => {
          if (!(e.day===slot.day && e.period===slot.period && e.roomId===roomId)) return false;
          const sameGrp = sameActiveGroup(item, e);
          return !(sameGrp && isConcurrentItem(item) && isConcurrentItem(e));
        });
        if (roomBusy) return false;
      }
    }
    return true;
  }
  function autoItemKey(item) {
    if (item.ttcardId) return `ttc:${item.ttcardId}`;
    return `tpl:${item.templateId || ""}:${item.gradeKey || ""}:${item.sectionIdx ?? 0}`;
  }

  function entryMatchesAutoItem(entry, item) {
    if (item.ttcardId) {
      return entry.ttcardId === item.ttcardId || (entry.ttcardIds || []).includes(item.ttcardId);
    }
    const templateMatch = entry.templateId === item.templateId || (entry.templateIds || []).includes(item.templateId);
    const gradeMatch = entry.gradeKey === item.gradeKey || (entry.gradeKeys || []).includes(item.gradeKey);
    const sectionMatch = (entry.sectionIdx ?? 0) === (item.sectionIdx ?? 0);
    return templateMatch && gradeMatch && sectionMatch;
  }

  function getAutoItemName(item) {
    if (item.ttcardId) {
      const card = getTtCardById(item.ttcardId);
      if (card) return describeTtCard(card).title;
    }
    const base = getTemplateCardTitle(getTemplateById(item.templateId)) || "?";
    return item.gradeKey ? `${base} ${gradeDisplay(item.gradeKey)}${sectionLabel(item.sectionIdx ?? 0)}` : base;
  }

  function getAutoItemDifficulty(item) {
    const audience = audienceForPlacement(item);
    const teacherCount = splitTeacherNames(item.teacherName).filter(Boolean).length;
    return teacherCount * 20 + audience.studentKeys.size + audience.classKeys.size * 5;
  }

  function scoreAutoSlot(item, slot, placed) {
    const existing = [...entries(), ...placed];
    const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
    const exclusionPenalty = slotEnts.some(e => hasAutoGroupExclusionSlotConflict(item, e)) ? 100000 : 0;
    const teachers = splitTeacherNames(item.teacherName).filter(Boolean);
    const dayEnts = existing.filter(e => e.day === slot.day);
    const teacherLoad = teachers.reduce((sum, t) => sum + dayEnts.filter(e => splitTeacherNames(e.teacherName).includes(t)).length, 0);
    const audience = audienceForPlacement(item);
    const classLoad = dayEnts.reduce((sum, e) => sum + (audiencesConflict(audience, audienceForPlacement(e)) ? 1 : 0), 0);
    const samePeriodLoad = existing.filter(e => e.period === slot.period).length;
    return exclusionPenalty + slotEnts.length * 100 + teacherLoad * 8 + classLoad * 6 + samePeriodLoad * 0.15 + Math.random();
  }

  function findBestAutoSlot(item, baseSlots, placed, checkOptions) {
    const candidates = [];
    for (const slot of shuffle([...baseSlots])) {
      if (checkPlacementValid(item, slot, placed, checkOptions)) {
        candidates.push({ slot, score: scoreAutoSlot(item, slot, placed) });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0]?.slot || null;
  }

  function makeAutoEntry(item, slot) {
    if (!item || !slot) return null;
    return normalizeTimetableEntry({
      id: uid("ent"),
      ...applyDefaultRoomToEntryData({ ...item, ...slot })
    });
  }

  function exactDuplicateInSlot(item, slot, placed = []) {
    const itemCardIds = new Set(ttCardIdsFromPlacement(item));
    const slotEnts = [...entries(), ...placed].filter(e => e.day === slot.day && e.period === slot.period);
    if (itemCardIds.size) {
      return slotEnts.some(e => ttCardIdsFromPlacement(e).some(id => itemCardIds.has(id)));
    }
    return slotEnts.some(e =>
      e.templateId === item.templateId &&
      e.gradeKey === item.gradeKey &&
      (e.sectionIdx ?? 0) === (item.sectionIdx ?? 0)
    );
  }

  function forcedSlotScore(item, slot, placed = []) {
    // 마지막 보정 단계용 점수입니다.
    // 원칙적으로 충돌 없는 슬롯을 찾고, 불가피할 때만 최소 충돌 슬롯에 배치합니다.
    // 단, 고정 채플/창체 등 보호 슬롯 침범과 동일 카드 동일 시간 중복은 끝까지 막습니다.
    if (protectedSlotConflict?.(item, slot.day, slot.period, { placed })) return Infinity;
    if (exactDuplicateInSlot(item, slot, placed)) return Infinity;

    const existing = [...entries(), ...placed];
    const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
    if (slotEnts.some(e => hasAutoGroupExclusionSlotConflict(item, e))) return Infinity;
    const dayEnts = existing.filter(e => e.day === slot.day);
    const teachers = splitTeacherNames(item.teacherName).filter(Boolean);
    const itemAudience = audienceForPlacement(item);
    const candidateRoomId = applyDefaultRoomToEntryData({ ...item, ...slot })?.roomId || null;
    let score = slotEnts.length * 10 + existing.filter(e => e.period === slot.period).length * 0.25;

    if (candidateRoomId && slotEnts.some(e => e.roomId === candidateRoomId)) score += 900;

    for (const e of slotEnts) {
      const sameUnit = item.unitId && e.unitId && item.unitId === e.unitId;
      if (sameUnit) continue;

      const sameGrp = sameActiveGroup(item, e);
      const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);
      if (conc) continue;

      const et = splitTeacherNames(e.teacherName).filter(Boolean);
      if (teachers.some(t => et.includes(t))) score += 1000;

      const conflict = audiencesConflict(itemAudience, audienceForPlacement(e));
      if (conflict) score += 800;
      if (e.roomId) {
        const assignedRooms = teachers.map(getEffectiveAssignedRoomId).filter(Boolean);
        if (assignedRooms.includes(e.roomId)) score += 250;
      }
    }

    for (const teacher of teachers) {
      const c = constraints()[teacher];
      if (c?.unavailableSlots?.some(s => s.day === slot.day && s.period === slot.period)) score += 500;
      const dayLoad = dayEnts.filter(e => splitTeacherNames(e.teacherName).includes(teacher)).length;
      const max = Number(c?.maxPerDay) || 0;
      if (max > 0 && dayLoad >= max) score += 150 + (dayLoad - max + 1) * 30;

      const dayPeriods = dayEnts
        .filter(e => splitTeacherNames(e.teacherName).includes(teacher))
        .map(e => e.period);
      const all = [...dayPeriods, slot.period].sort((a,b) => a-b);
      let maxC = 1, cur = 1;
      for (let i = 1; i < all.length; i++) {
        cur = all[i] === all[i-1]+1 ? cur+1 : 1;
        maxC = Math.max(maxC, cur);
      }
      const maxConsecutive = Number(c?.maxConsecutive) || 0;
      if (maxConsecutive > 0 && maxC > maxConsecutive) score += 120 + (maxC - maxConsecutive) * 30;

      const roomId = getEffectiveAssignedRoomId(teacher);
      if (roomId) {
        const roomBusy = slotEnts.some(e => e.roomId === roomId);
        if (roomBusy) score += 250;
      }
    }

    return score + Math.random();
  }

  function findLeastBadSlot(item, baseSlots, placed = []) {
    const candidates = [];
    for (const slot of shuffle([...baseSlots])) {
      const score = forcedSlotScore(item, slot, placed);
      if (Number.isFinite(score)) candidates.push({ slot, score });
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0]?.slot || null;
  }

  function makeFailedPlacement(name, item, meta = {}) {
    return { name: name || getAutoItemName(item), item, ...meta };
  }

  function getGroupAutoCardIds(group, unitItems = []) {
    const excluded = new Set(group?.excludedCardIds || []);
    return new Set([
      ...(group?.poolCardIds || []),
      ...((group?.units || []).flatMap(u => u.ttcardIds || [])),
      ...(unitItems || []).flatMap(u => (u.ttcards || []).map(c => c.id)),
    ].filter(id => id && !excluded.has(id)));
  }

  function getExcludedGroupIdsForCard(cardId) {
    if (!cardId) return [];
    return ttGroups()
      .filter(group => (group.excludedCardIds || []).includes(cardId))
      .map(group => group.id);
  }

  function hasAutoGroupExclusionSlotConflict(item, existingEntry) {
    if (!item || !existingEntry) return false;

    const itemCardIds = ttCardIdsFromPlacement(item).filter(Boolean);
    const entryCardIds = ttCardIdsFromPlacement(existingEntry).filter(Boolean);

    // Case A. We are placing an auto group. A card explicitly removed from this
    // group must not be placed in the same slot by coincidence.
    if (item.groupId && entryCardIds.some(cardId => getExcludedGroupIdsForCard(cardId).includes(item.groupId))) {
      return true;
    }

    // Case B. We are placing a standalone card. If that card was explicitly
    // excluded from an auto group, it must stay away from that group's slots.
    if (existingEntry.groupId && itemCardIds.some(cardId => getExcludedGroupIdsForCard(cardId).includes(existingEntry.groupId))) {
      return true;
    }

    return false;
  }

  function countPinnedGroupSlots(group, unitItems, pinnedEntries) {
    const cardIds = getGroupAutoCardIds(group, unitItems);
    const slots = new Set();
    pinnedEntries.forEach(e => {
      const cardMatch = (e.ttcardId && cardIds.has(e.ttcardId)) || (e.ttcardIds || []).some(id => cardIds.has(id));
      const unitMatch = (unitItems || []).some(u => u.unit?.id && e.unitId === u.unit.id);
      if (e.groupId === group.id || cardMatch || unitMatch) slots.add(`${e.day}:${e.period}`);
    });
    return slots.size;
  }

  function buildGroupAutoEntryDataList(group, groupItem, slot) {
    const cards = groupItem?.ttcards || [];
    if (!cards.length) return [];

    const dataList = [];
    const usedCardIds = new Set();

    // “묶음수업”으로 지정된 unit은 하나의 entry로 유지합니다.
    // unit 밖의 그룹 카드는 같은 시간대 병렬 과목으로 보고 카드별 entry를 만들어
    // 각 과목이 교사 담당교실/홈룸 기준으로 별도 교실을 갖게 합니다.
    (group.units || []).forEach(unit => {
      const unitCards = (unit.ttcardIds || [])
        .map(id => cards.find(card => card.id === id))
        .filter(Boolean);
      if (!unitCards.length) return;
      unitCards.forEach(card => usedCardIds.add(card.id));
      const data = makePlacementFromGroupItem(group, { ...groupItem, unit, ttcards: unitCards });
      if (data) dataList.push(data);
    });

    cards
      .filter(card => !usedCardIds.has(card.id))
      .forEach(card => {
        const data = makePlacementFromGroupItem(group, { ...groupItem, unit: null, ttcards: [card] });
        if (data) dataList.push(data);
      });

    if (!dataList.length) {
      const data = makePlacementFromGroupItem(group, groupItem);
      if (data) dataList.push(data);
    }

    return dataList.map(data => ({ ...data, ...slot }));
  }

  function placeAutoGroupSlot(group, activeItems, slot, placed) {
    const entryDataList = (activeItems || []).flatMap(groupItem => buildGroupAutoEntryDataList(group, groupItem, slot));
    const newEntries = entryDataList
      .map(data => normalizeTimetableEntry({ id: uid("ent"), ...applyDefaultRoomToEntryData(data) }))
      .filter(e => e.templateId);
    if (!newEntries.length) return false;
    placed.push(...newEntries);
    return true;
  }

  const waitForBrowser = () => new Promise(resolve => setTimeout(resolve, 0));
  let autoAssignRunning = false;
  function createAutoAssignProgressDialog(totalTarget = 0, onCancel = null) {
    const old = document.getElementById("ttAutoAssignProgressOverlay");
    if (old) old.remove();

    let cancelled = false;
    const overlay = document.createElement("div");
    overlay.id = "ttAutoAssignProgressOverlay";
    overlay.className = "tt-auto-progress-overlay";
    // Inline fallback: GitHub Pages/cache 문제로 CSS가 늦게 적용되어도 반드시 팝업 중앙에 뜨게 합니다.
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.56);backdrop-filter:blur(3px);padding:24px;box-sizing:border-box;";
    overlay.innerHTML = `
      <div class="tt-auto-progress-card" role="dialog" aria-modal="true" aria-live="polite" tabindex="-1">
        <div class="tt-auto-progress-head">
          <div>
            <div class="tt-auto-progress-title">자동배치 진행 중</div>
            <div class="tt-auto-progress-subtitle">조건을 비교하며 시간표를 구성하고 있습니다.</div>
          </div>
          <span class="tt-auto-progress-badge">RUNNING</span>
        </div>
        <div class="tt-auto-progress-step">준비 중...</div>
        <div class="tt-auto-progress-detail">자동배치 데이터를 준비하고 있습니다.</div>
        <div class="tt-auto-progress-bar-wrap"><div class="tt-auto-progress-bar"></div></div>
        <div class="tt-auto-progress-percent">0%</div>
        <div class="tt-auto-progress-stats">
          <span>전체 <b data-k="total">${totalTarget}</b></span>
          <span>현재 배치 <b data-k="placed">0</b></span>
          <span>최선 배치 <b data-k="best">0</b></span>
          <span>미배치 후보 <b data-k="failed">0</b></span>
        </div>
        <div class="tt-auto-progress-current">현재 카드: -</div>
        <div class="tt-auto-progress-log"></div>
        <div class="tt-auto-progress-actions">
          <button type="button" class="tt-auto-progress-cancel">취소</button>
          <button type="button" class="tt-auto-progress-close" disabled>닫기</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.classList.add("tt-auto-progress-open");

    const stepEl = overlay.querySelector(".tt-auto-progress-step");
    const detailEl = overlay.querySelector(".tt-auto-progress-detail");
    const barEl = overlay.querySelector(".tt-auto-progress-bar");
    const percentEl = overlay.querySelector(".tt-auto-progress-percent");
    const badgeEl = overlay.querySelector(".tt-auto-progress-badge");
    const titleEl = overlay.querySelector(".tt-auto-progress-title");
    const subtitleEl = overlay.querySelector(".tt-auto-progress-subtitle");
    const currentEl = overlay.querySelector(".tt-auto-progress-current");
    const closeBtn = overlay.querySelector(".tt-auto-progress-close");
    const cancelBtn = overlay.querySelector(".tt-auto-progress-cancel");
    const logEl = overlay.querySelector(".tt-auto-progress-log");
    const cardEl = overlay.querySelector(".tt-auto-progress-card");

    // Strong inline styling: the dialog must stay readable even if an older
    // cached style.css is still being served by GitHub Pages.
    if (cardEl) {
      cardEl.style.cssText = "width:min(560px,calc(100vw - 32px));max-height:min(720px,calc(100vh - 40px));overflow:auto;background:#fff;border:1px solid #dbe4f0;border-radius:22px;box-shadow:0 32px 100px rgba(15,23,42,.38);padding:0;outline:none;color:#172033;font-family:inherit;";
      const head = overlay.querySelector(".tt-auto-progress-head");
      if (head) head.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:22px 24px 16px;border-bottom:1px solid #eef2f7;background:linear-gradient(135deg,#f8fbff,#eef6ff);";
      const bodyEls = [".tt-auto-progress-step",".tt-auto-progress-detail",".tt-auto-progress-bar-wrap",".tt-auto-progress-percent",".tt-auto-progress-stats",".tt-auto-progress-current",".tt-auto-progress-log",".tt-auto-progress-actions"];
      bodyEls.forEach(sel => { const el = overlay.querySelector(sel); if (el) el.classList.add("tt-auto-progress-body-item"); });
      const step = overlay.querySelector(".tt-auto-progress-step");
      if (step) step.style.cssText = "margin:18px 24px 6px;font-size:15px;font-weight:900;color:#173b68;";
      const detail = overlay.querySelector(".tt-auto-progress-detail");
      if (detail) detail.style.cssText = "margin:0 24px 14px;min-height:28px;font-size:13px;line-height:1.55;color:#475569;";
      const barWrap = overlay.querySelector(".tt-auto-progress-bar-wrap");
      if (barWrap) barWrap.style.cssText = "margin:0 24px;height:12px;border-radius:999px;overflow:hidden;background:#e5eaf2;border:1px solid #d9e2ec;";
      if (barEl) barEl.style.cssText = "width:0%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#2563eb,#7c3aed);transition:width .16s ease;";
      if (percentEl) percentEl.style.cssText = "margin:6px 24px 0;text-align:right;font-size:12px;font-weight:900;color:#334155;";
      const stats = overlay.querySelector(".tt-auto-progress-stats");
      if (stats) stats.style.cssText = "display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:14px 24px 0;";
      overlay.querySelectorAll(".tt-auto-progress-stats span").forEach(el => el.style.cssText = "background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:8px 9px;font-size:12px;color:#64748b;");
      overlay.querySelectorAll(".tt-auto-progress-stats b").forEach(el => el.style.cssText = "display:block;margin-top:2px;color:#0f172a;font-size:15px;");
      if (currentEl) currentEl.style.cssText = "margin:12px 24px 0;padding:9px 11px;border-radius:12px;background:#eff6ff;color:#1e40af;font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      if (logEl) logEl.style.cssText = "margin:12px 24px 0;padding:10px 12px;border-radius:12px;background:#f8fafc;border:1px dashed #cbd5e1;font-size:12px;line-height:1.55;color:#64748b;max-height:110px;overflow:auto;";
      const actions = overlay.querySelector(".tt-auto-progress-actions");
      if (actions) actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin:16px 24px 22px;";
      if (cancelBtn) cancelBtn.style.cssText = "border:0;border-radius:10px;color:#fff;font-weight:900;padding:9px 16px;cursor:pointer;background:#dc2626;";
      if (closeBtn) closeBtn.style.cssText = "border:0;border-radius:10px;color:#fff;font-weight:900;padding:9px 16px;cursor:pointer;background:#173b68;";
    }

    const stat = (key, value) => {
      const el = overlay.querySelector(`[data-k="${key}"]`);
      if (el && value !== undefined && value !== null) el.textContent = String(value);
    };
    const logs = [];
    const esc = v => String(v ?? "").replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]));
    const setPercent = (value) => {
      const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
      barEl.style.width = `${pct}%`;
      percentEl.textContent = `${pct}%`;
    };
    const removeOverlay = () => {
      overlay.remove();
      document.body.classList.remove("tt-auto-progress-open");
    };
    closeBtn.addEventListener("click", removeOverlay);
    cancelBtn.addEventListener("click", () => {
      if (cancelled) return;
      cancelled = true;
      cancelBtn.disabled = true;
      cancelBtn.textContent = "취소 요청됨";
      badgeEl.textContent = "CANCEL";
      stepEl.textContent = "취소 요청";
      detailEl.textContent = "현재 계산 단계를 정리한 뒤 자동배치를 중단합니다.";
      if (typeof onCancel === "function") onCancel();
    });
    overlay.addEventListener("keydown", e => {
      if (e.key === "Escape" && !closeBtn.disabled) removeOverlay();
    });
    setTimeout(() => cardEl?.focus(), 0);

    return {
      isCancelled() { return cancelled; },
      async update(data = {}) {
        if (data.title) titleEl.textContent = data.title;
        if (data.subtitle) subtitleEl.textContent = data.subtitle;
        if (data.step) stepEl.textContent = data.step;
        if (data.detail) detailEl.textContent = data.detail;
        if (data.currentCard !== undefined) currentEl.textContent = `현재 카드: ${data.currentCard || "-"}`;
        if (data.percent !== undefined) setPercent(data.percent);
        stat("total", data.total);
        stat("placed", data.placed);
        stat("best", data.best);
        stat("failed", data.failed);
        if (data.log) {
          logs.unshift(data.log);
          while (logs.length > 6) logs.pop();
          logEl.innerHTML = logs.map(line => `<div>• ${esc(line)}</div>`).join("");
        }
        await waitForBrowser();
      },
      async complete(data = {}) {
        overlay.classList.add(data.partial ? "is-partial" : "is-complete");
        cancelBtn.disabled = true;
        cancelBtn.style.display = "none";
        badgeEl.textContent = data.partial ? "PARTIAL" : "DONE";
        titleEl.textContent = data.title || (data.partial ? "자동배치 부분 완료" : "자동배치 완료");
        subtitleEl.textContent = data.subtitle || "결과를 확인해 주세요.";
        stepEl.textContent = data.step || "완료";
        detailEl.innerHTML = data.detailHtml || esc(data.detail || "자동배치가 완료되었습니다.");
        setPercent(100);
        if (data.placed !== undefined) stat("placed", data.placed);
        if (data.best !== undefined) stat("best", data.best);
        if (data.failed !== undefined) stat("failed", data.failed);
        if (data.currentCard !== undefined) currentEl.textContent = `현재 카드: ${data.currentCard || "-"}`;
        closeBtn.disabled = false;
        closeBtn.focus();
        await waitForBrowser();
      },
      async cancel(message = "사용자 요청으로 자동배치를 취소했습니다.") {
        overlay.classList.add("is-cancelled");
        cancelBtn.disabled = true;
        cancelBtn.style.display = "none";
        badgeEl.textContent = "CANCELLED";
        titleEl.textContent = "자동배치 취소됨";
        subtitleEl.textContent = "시간표에는 변경 사항을 반영하지 않았습니다.";
        stepEl.textContent = "취소 완료";
        detailEl.textContent = message;
        closeBtn.disabled = false;
        closeBtn.focus();
        await waitForBrowser();
      },
      async error(message) {
        overlay.classList.add("is-error");
        cancelBtn.disabled = true;
        cancelBtn.style.display = "none";
        badgeEl.textContent = "ERROR";
        titleEl.textContent = "자동배치 오류";
        subtitleEl.textContent = "진행 중 오류가 발생했습니다.";
        stepEl.textContent = "오류";
        detailEl.textContent = message || "자동배치 중 오류가 발생했습니다.";
        closeBtn.disabled = false;
        await waitForBrowser();
      },
      close() { removeOverlay(); }
    };
  }


  function setAutoAssignBusy(isBusy) {
    const btn = $("ttAutoAssignBtn");
    if (!btn) return;
    btn.disabled = isBusy;
    btn.textContent = isBusy ? "⏳ 자동 배치 중..." : "🎲 자동 배치";
  }

  function getActiveGradesFromScheduleItems(standalone = [], groupBlocks = []) {
    const gradeSet = new Set();
    const addGrade = (g) => {
      if (g && GRADE_KEYS.includes(g)) gradeSet.add(g);
    };

    standalone.forEach(item => {
      addGrade(item.gradeKey);
      (item.gradeKeys || []).forEach(addGrade);
    });

    groupBlocks.forEach(({ unitItems }) => {
      (unitItems || []).forEach(unitItem => {
        (unitItem.gradeKeys || []).forEach(addGrade);
        (unitItem.ttcards || []).forEach(card => {
          addGrade(card.gradeKey);
          (card.gradeKeys || []).forEach(addGrade);
        });
      });
    });

    return GRADE_KEYS.filter(g => gradeSet.has(g));
  }

  async function autoAssignAll() {
    if (!canEdit()) return;
    if (autoAssignRunning) { alert("자동 배치가 이미 진행 중입니다."); return; }

    // 커리큘럼/템플릿 실시간 의존성을 끊었기 때문에, 자동배치 대상도
    // appState.curriculum.gradeBoards가 아니라 시간표 사전작업에서 생성된
    // timetable.ttcards / timetable.ttcardGroups 스냅샷 기준으로 판단합니다.
    const { standalone, groupBlocks } = buildSchedulableItems();
    const activeGrades = getActiveGradesFromScheduleItems(standalone, groupBlocks);
    const groupTargetSlots = groupBlocks.reduce((sum, { group, unitItems }) => {
      const credits = (unitItems || []).map(u => Math.max(0, Number(u?.credits) || 0));
      const isConcurrent = group?.isConcurrent || group?.groupType === "concurrent";
      return sum + (isConcurrent ? Math.max(0, ...credits) : credits.reduce((a, b) => a + b, 0));
    }, 0);
    const autoTargetSlots = standalone.length + groupTargetSlots;
    const autoItemCount = autoTargetSlots;

    if (!autoItemCount || !activeGrades.length) {
      alert("시간표 사전작업에서 생성된 과목 카드가 없습니다.\n먼저 시간표 사전작업에서 카드를 생성하거나, 로컬 모드 전환 시 온라인 데이터를 복사해 주세요.");
      return;
    }

    if (!confirm(`전체 학년 시간표를 자동 배치합니다.\n대상: ${activeGrades.map(gradeDisplay).join(", ")}\n\n기존 시간표가 모두 초기화됩니다. 계속할까요?`)) return;

    autoAssignRunning = true;
    setAutoAssignBusy(true);
    await waitForBrowser();

    const autoStartedAt = Date.now();
    let autoAssignCancelled = false;
    const progress = createAutoAssignProgressDialog(autoTargetSlots, () => { autoAssignCancelled = true; });
    let lastProgressAt = 0;
    const updateProgress = async (data = {}, force = false) => {
      const now = Date.now();
      if (autoAssignCancelled || progress?.isCancelled?.()) throw new Error("__AUTO_ASSIGN_CANCELLED__");
      if (!force && now - lastProgressAt < 120) return;
      lastProgressAt = now;
      await progress.update({ total: autoTargetSlots, ...data });
    };

    try {
    await updateProgress({
      percent: 2,
      step: "초기화",
      detail: "기존 배치와 고정 수업을 확인하고 있습니다.",
      currentCard: "-",
      placed: 0,
      best: 0,
      failed: 0,
      log: `대상 학년: ${activeGrades.map(gradeDisplay).join(", ")}`
    }, true);
    captureTimetableUndo("자동 배정");
    addTimetableLog("auto", "자동 배치 시작", `대상 학년: ${activeGrades.map(gradeDisplay).join(", ")}`);

    // Preserve pinned entries only
    const pinnedEntries = entries().filter(e => e.pinned);
    ttDomain().entries = [...pinnedEntries];
    await updateProgress({
      percent: 6,
      step: "고정 수업 보호",
      detail: `고정된 수업 ${pinnedEntries.length}개를 유지하고 나머지 자동배치 대상을 준비합니다.`,
      placed: 0,
      best: 0,
      failed: 0
    }, true);
    const pc = ttConfig().periodCount;
    const baseSlots = [];
    for (let day = 0; day < 5; day++) {
      for (let period = 0; period < pc; period++) baseSlots.push({ day, period });
    }

    await updateProgress({
      percent: 10,
      step: "배치 대상 분석",
      detail: `일반 카드 ${standalone.length}개, 그룹 ${groupBlocks.length}개를 분석했습니다.`,
      log: "그룹 수업은 동시배정 단위로 계산합니다."
    }, true);

    const requiredByKey = new Map();
    const itemByKey = new Map();
    standalone.forEach(item => {
      const key = autoItemKey(item);
      requiredByKey.set(key, (requiredByKey.get(key) || 0) + 1);
      if (!itemByKey.has(key)) itemByKey.set(key, item);
    });

    const pinnedByKey = new Map();
    itemByKey.forEach((item, key) => {
      pinnedByKey.set(key, pinnedEntries.filter(e => entryMatchesAutoItem(e, item)).length);
    });

    const stages = [
      { name:"strict", label:"교사 제약 포함", attempts:30, options:{ respectSoftLimits:true,  respectUnavailable:true,  respectAssignedRoom:true  } },
      { name:"relaxedSoft", label:"일일/연속 제한 완화", attempts:24, options:{ respectSoftLimits:false, respectUnavailable:true,  respectAssignedRoom:true  } },
      { name:"relaxedRoom", label:"교실 규칙 유지 · 추가 탐색", attempts:16, options:{ respectSoftLimits:false, respectUnavailable:true,  respectAssignedRoom:true  } },
      { name:"relaxedUnavailable", label:"교사 불가시간 완화 · 교실 규칙 유지", attempts:10, options:{ respectSoftLimits:false, respectUnavailable:false, respectAssignedRoom:true  } },
    ];

    let bestPlaced = [], bestFailed = [], bestScore = -1, bestStage = stages[0];
    let autoOps = 0;
    const yieldAutoAssign = async (data = null, force = false) => {
      if (autoAssignCancelled || progress?.isCancelled?.()) throw new Error("__AUTO_ASSIGN_CANCELLED__");
      autoOps++;
      if (data) await updateProgress(data, force);
      else if (autoOps % 20 === 0) await waitForBrowser();
      if (autoAssignCancelled || progress?.isCancelled?.()) throw new Error("__AUTO_ASSIGN_CANCELLED__");
    };

    for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
      const stage = stages[stageIndex];
      for (let attempt = 0; attempt < stage.attempts; attempt++) {
        const stagePercent = 12 + Math.min(68, ((stageIndex / stages.length) * 68) + ((attempt / Math.max(1, stage.attempts)) * (68 / stages.length)));
        await updateProgress({
          percent: stagePercent,
          step: `자동배치 탐색 · ${stage.label}`,
          detail: `시도 ${attempt + 1} / ${stage.attempts} · 현재까지 최선 ${Math.max(0, bestScore)}개 배치`,
          placed: 0,
          best: Math.max(0, bestScore),
          failed: bestFailed.length,
          currentCard: "-",
          log: attempt === 0 ? `${stage.label} 단계 시작` : null
        }, true);
        const placed = [], failed = [];

        // ── Place concurrent groups first: one independent occurrence per 시수 ──
        const orderedGroups = shuffle([...groupBlocks]).sort((a, b) => {
          const ac = Math.max(...a.unitItems.map(u => u.credits));
          const bc = Math.max(...b.unitItems.map(u => u.credits));
          return bc - ac;
        });

        for (const { group, unitItems } of orderedGroups) {
          if (!(group.isConcurrent || group.groupType === "concurrent")) continue;
          const maxCredits = Math.max(0, ...(unitItems || []).map(u => Math.max(0, Number(u.credits) || 0)));
          const alreadyPinned = countPinnedGroupSlots(group, unitItems, pinnedEntries);
          const needSlots = Math.max(0, maxCredits - alreadyPinned);

          for (let slot_i = 0; slot_i < needSlots; slot_i++) {
            await yieldAutoAssign({
              percent: stagePercent,
              step: `그룹 수업 배치 · ${stage.label}`,
              detail: `${group.name || "그룹"} ${slot_i + 1} / ${needSlots}회차를 배치하고 있습니다.`,
              placed: placed.length,
              best: Math.max(0, bestScore),
              failed: failed.length,
              currentCard: group.name || "그룹 수업"
            });
            const activeItems = unitItems.filter(u => slot_i < u.credits);
            if (!activeItems.length) continue;
            const probeItem = makePlacementFromGroupItem(group, activeItems[0]);
            const foundSlot = probeItem ? findBestAutoSlot(probeItem, baseSlots, placed, stage.options) : null;
            if (foundSlot && placeAutoGroupSlot(group, activeItems, foundSlot, placed)) {
              continue;
            }
            activeItems.forEach(groupItem => {
              const item = makePlacementFromGroupItem(group, groupItem);
              failed.push(makeFailedPlacement(`${group.name} - ${groupItem.name || "그룹 카드"}`, item, { groupId: group.id }));
            });
          }
        }

        // ── Place non-concurrent groups independently (legacy safety) ─────────
        for (const { group, unitItems } of orderedGroups) {
          if (group.isConcurrent || group.groupType === "concurrent") continue;
          for (const groupItem of unitItems) {
            const pinnedSlots = countPinnedGroupSlots(group, [groupItem], pinnedEntries);
            const needSlots = Math.max(0, groupItem.credits - pinnedSlots);
            for (let i = 0; i < needSlots; i++) {
              await yieldAutoAssign({
                percent: stagePercent,
                step: `그룹 카드 배치 · ${stage.label}`,
                detail: `${group.name || "그룹"} - ${groupItem.name || "그룹 카드"} 배치 중`,
                placed: placed.length,
                best: Math.max(0, bestScore),
                failed: failed.length,
                currentCard: `${group.name || "그룹"} - ${groupItem.name || "그룹 카드"}`
              });
              const item = makePlacementFromGroupItem(group, groupItem);
              const slot = item ? findBestAutoSlot(item, baseSlots, placed, stage.options) : null;
              if (slot) {
                const entry = makeAutoEntry(item, slot);
                if (entry) placed.push(entry);
              } else {
                failed.push(makeFailedPlacement(`${group.name} - ${groupItem.name || "그룹 카드"}`, item, { groupId: group.id }));
              }
            }
          }
        }

        // ── Place standalone cards: required count minus already pinned count ──
        const placedByKey = new Map();
        const orderedKeys = shuffle([...requiredByKey.keys()]).sort((a, b) => {
          return getAutoItemDifficulty(itemByKey.get(b)) - getAutoItemDifficulty(itemByKey.get(a));
        });

        for (const key of orderedKeys) {
          const item = itemByKey.get(key);
          const required = requiredByKey.get(key) || 0;
          const pinned = pinnedByKey.get(key) || 0;
          while (pinned + (placedByKey.get(key) || 0) < required) {
            await yieldAutoAssign({
              percent: stagePercent,
              step: `일반 카드 배치 · ${stage.label}`,
              detail: `${getAutoItemName(item)} 배치 위치를 찾고 있습니다.`,
              placed: placed.length,
              best: Math.max(0, bestScore),
              failed: failed.length,
              currentCard: getAutoItemName(item)
            });
            const slot = findBestAutoSlot(item, baseSlots, placed, stage.options);
            if (!slot) {
              // 같은 카드가 2시수 이상 필요한데 첫 미배치 시점에서 1개만 failed에 넣고
              // break하면, 마지막 보정 단계가 1시수만 복구하고 나머지는 계속 하단에 남습니다.
              // 현재 남은 필요 시수만큼 failed를 기록해 final repair가 전부 처리하게 합니다.
              const already = pinned + (placedByKey.get(key) || 0);
              const remaining = Math.max(1, required - already);
              for (let miss = 0; miss < remaining; miss++) {
                failed.push(makeFailedPlacement(getAutoItemName(item), item, { occurrence: already + miss + 1, required }));
              }
              break;
            }
            const entry = makeAutoEntry(item, slot);
            if (entry) placed.push(entry);
            placedByKey.set(key, (placedByKey.get(key) || 0) + 1);
          }
        }

        if (placed.length > bestScore || (placed.length === bestScore && failed.length < bestFailed.length)) {
          bestScore  = placed.length;
          bestPlaced = placed;
          bestFailed = failed;
          bestStage  = stage;
          await updateProgress({
            percent: stagePercent,
            step: `최선 결과 갱신 · ${stage.label}`,
            detail: `현재 최선: ${bestPlaced.length}개 배치, 미배치 후보 ${bestFailed.length}개`,
            placed: placed.length,
            best: bestPlaced.length,
            failed: bestFailed.length,
            log: `최선 결과 갱신: ${bestPlaced.length}개 배치`
          }, true);
        }
        if (!failed.length) break;
      }
      if (!bestFailed.length) break;
    }

    // ── Final repair pass ─────────────────────────────────────────
    // Greedy 자동배치가 끝까지 못 넣은 카드는 그냥 남기지 않고,
    // 보호 슬롯과 동일 카드 중복만 피하면서 최소 충돌 슬롯에 배치합니다.
    // 이후 recomputeConflicts()가 교사/학생/교실 충돌을 색상과 상세 내역으로 표시합니다.
    await updateProgress({
      percent: 84,
      step: "미배치 보정 준비",
      detail: `미배치 후보 ${bestFailed.length}개를 최소 충돌 위치에 보정 배치합니다.`,
      placed: bestPlaced.length,
      best: bestPlaced.length,
      failed: bestFailed.length,
      currentCard: "-",
      log: bestFailed.length ? "보정 배치 단계 시작" : "보정 배치 대상 없음"
    }, true);

    const forcedPlaced = [];
    const stillFailed = [];
    for (const failedItem of bestFailed) {
      const item = failedItem.item;
      if (!item) {
        stillFailed.push(failedItem);
        continue;
      }
      const slot = findLeastBadSlot(item, baseSlots, bestPlaced);
      const entry = slot ? makeAutoEntry(item, slot) : null;
      if (entry) {
        entry.autoForced = true;
        bestPlaced.push(entry);
        forcedPlaced.push(failedItem);
      } else {
        stillFailed.push(failedItem);
      }
      await yieldAutoAssign({
        percent: 86 + Math.min(9, forcedPlaced.length + stillFailed.length),
        step: "미배치 보정 중",
        detail: `${failedItem.name || "카드"} 보정 배치 결과를 반영하고 있습니다.`,
        placed: bestPlaced.length,
        best: bestPlaced.length,
        failed: stillFailed.length,
        currentCard: failedItem.name || "보정 대상"
      }, true);
    }
    bestFailed = stillFailed;

    await updateProgress({
      percent: 96,
      step: "결과 반영",
      detail: "배치 결과를 시간표에 반영하고 충돌을 재계산합니다.",
      placed: bestPlaced.length,
      best: bestPlaced.length,
      failed: bestFailed.length,
      currentCard: "-"
    }, true);

    if (autoAssignCancelled || progress?.isCancelled?.()) throw new Error("__AUTO_ASSIGN_CANCELLED__");

    bestPlaced.forEach(e => entries().push(e));
    scheduleSave("timetable");
    recomputeConflicts();

    const names = [...new Set(bestFailed.map(f => f.name))];
    const conflictSummary = getConflictCounts();
    const report = {
      ts: Date.now(),
      activeGrades: activeGrades.map(gradeDisplay).join(", "),
      stageName: bestStage.name,
      stageLabel: bestStage.label,
      totalTarget: autoTargetSlots,
      pinnedCount: pinnedEntries.length,
      placedCount: bestPlaced.length,
      forcedCount: forcedPlaced.length,
      failedCount: names.length,
      failedNames: names,
      forcedNames: [...new Set(forcedPlaced.map(f => f.name))],
      durationMs: Date.now() - autoStartedAt,
      conflictTotal: conflictSummary.totalAffected,
      conflictCounts: conflictSummary.counts
    };
    setLastAutoAssignReport(report);
    addTimetableLog(
      "auto",
      names.length ? "자동 배치 부분 완료" : "자동 배치 완료",
      `정상 배치 ${bestPlaced.length - forcedPlaced.length}개, 보정 배치 ${forcedPlaced.length}개, 미배치 ${names.length}개, 충돌 ${conflictSummary.totalAffected}건 · 방식: ${bestStage.label}`
    );
    renderAll();

    const detailLines = [
      `<b>정상 배치</b> ${bestPlaced.length - forcedPlaced.length}개`,
      `<b>보정 배치</b> ${forcedPlaced.length}개`,
      `<b>미배치</b> ${names.length}개`,
      `<b>충돌 표시 대상</b> ${conflictSummary.totalAffected}건`,
      `<b>적용 방식</b> ${bestStage.label}`,
      `<b>소요 시간</b> ${Math.round((Date.now() - autoStartedAt) / 1000)}초`
    ];
    if (forcedPlaced.length) {
      detailLines.push(`⚠️ ${forcedPlaced.length}개는 미배치 방지를 위해 최소 충돌 위치에 보정 배치했습니다. 충돌 색상과 상세창을 확인해 주세요.`);
    }
    if (names.length) {
      const failedList = names.slice(0, 12)
        .map(name => `<li>${String(name).replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]))}</li>`)
        .join("");
      const moreFailed = names.length > 12 ? `<li>외 ${names.length - 12}개</li>` : "";
      detailLines.push(`<div class="tt-auto-progress-failed"><b>남은 카드</b><ul>${failedList}${moreFailed}</ul></div>`);
      detailLines.push(`남은 카드는 고정 채플/창체 보호 슬롯 또는 동일 카드 동일 시간 중복 때문에 배치할 수 없었습니다.`);
    }
    detailLines.push(`자세한 결과는 하단 <b>로그</b> 탭에서 확인할 수 있습니다.`);

    await progress.complete({
      partial: !!names.length,
      title: names.length ? "자동배치 부분 완료" : "자동배치 완료",
      subtitle: names.length ? "일부 카드는 직접 확인이 필요합니다." : "모든 대상 슬롯을 배치했습니다.",
      step: names.length ? "부분 완료" : "완료",
      detailHtml: detailLines.map(line => `<div>${line}</div>`).join(""),
      placed: bestPlaced.length,
      best: bestPlaced.length,
      failed: names.length,
      currentCard: "-"
    });
    } catch (err) {
      if (err?.message === "__AUTO_ASSIGN_CANCELLED__") {
        addTimetableLog("auto", "자동 배치 취소", "사용자 요청으로 자동배치를 중단했습니다. 시간표에는 변경 사항을 반영하지 않았습니다.");
        if (progress) await progress.cancel("사용자 요청으로 자동배치를 중단했습니다. 시간표에는 변경 사항을 반영하지 않았습니다.");
      } else {
        console.error("Auto assign failed:", err);
        addTimetableLog("error", "자동 배치 오류", err?.message || String(err));
        if (progress) {
          await progress.error(`자동 배치 중 오류가 발생했습니다. ${err?.message || String(err)} 하단 [로그] 탭과 콘솔 로그를 확인해 주세요.`);
        } else {
          alert("자동 배치 중 오류가 발생했습니다. 하단 [로그] 탭과 콘솔 로그를 확인해 주세요.");
        }
      }
    } finally {
      autoAssignRunning = false;
      setAutoAssignBusy(false);
    }
  }


  return autoAssignAll;
}
