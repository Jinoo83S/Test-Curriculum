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
  const groupContainsCardId = (group, cardId) => {
    if (!group || !cardId) return false;
    if ((group.poolCardIds || []).includes(cardId)) return true;
    return (group.units || []).some(unit => (unit.ttcardIds || []).includes(cardId));
  };
  function groupIdsForTemplate(templateId) {
    if (!templateId) return [];
    const cardIds = (appState.timetable?.ttcards || [])
      .filter(c => c.templateId === templateId)
      .map(c => c.id);
    return ttGroups()
      .filter(g => cardIds.some(id => groupContainsCardId(g, id)))
      .map(g => g.id);
  }
  function isConcurrentTpl(templateId) {
    const ids = groupIdsForTemplate(templateId);
    return ttGroups().some(g => ids.includes(g.id) && (g.groupType === "concurrent" || !!g.isConcurrent));
  }
  /** Check if a placement item/entry belongs to a concurrent group */
  function isConcurrentItem(x) {
    if (x.groupId) {
      const grp = ttGroups().find(g => g.id === x.groupId);
      if (grp) return grp.groupType === "concurrent" || !!grp.isConcurrent;
    }
    return isConcurrentTpl(x.templateId);
  }
  function sameGroupTpl(tidA, tidB) {
    const a = new Set(groupIdsForTemplate(tidA));
    return groupIdsForTemplate(tidB).some(id => a.has(id));
  }
  function getGroupId(tid) {
    return groupIdsForTemplate(tid)[0] || null;
  }
  function linkedGroups(tidA, tidB) {
    const gA = getGroupId(tidA), gB = getGroupId(tidB);
    if (!gA || !gB || gA === gB) return false;
    const grpA = ttGroups().find(g => g.id === gA);
    const grpB = ttGroups().find(g => g.id === gB);
    return grpA?.linkedGroupId === gB || grpB?.linkedGroupId === gA;
  }

  function checkPlacementValid(item, slot, placed, options = {}) {
    const { respectSoftLimits = true, respectUnavailable = true, respectAssignedRoom = true } = options;
    const existing = [...entries(), ...placed];
    const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
    const teachers  = splitTeacherNames(item.teacherName).filter(Boolean);

    // 0. Pinned whole-grade activities such as chapel/창체 protect their slot first.
    if (protectedSlotConflict?.(item, slot.day, slot.period, { placed })) return false;

    // 1. Teacher conflict (always applies — teacher cannot be in two places)
    for (const e of slotEnts) {
      const et = splitTeacherNames(e.teacherName).filter(Boolean);
      if (teachers.some(t => et.includes(t))) {
        // Exception: same unit (co-teaching) — but NOT just same group
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

      const sameGrp = (item.groupId && e.groupId && item.groupId === e.groupId) ||
                      (sameGroupTpl(item.templateId, e.templateId));
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
    // 6. Room conflict: if teacher has assigned/home room, apply; if room already occupied, skip
    for (const teacher of teachers) {
      const roomId = getEffectiveAssignedRoomId(teacher);
      if (respectAssignedRoom && roomId) {
        const roomBusy = existing.some(e => e.day===slot.day && e.period===slot.period && e.roomId===roomId);
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
    const teachers = splitTeacherNames(item.teacherName).filter(Boolean);
    const dayEnts = existing.filter(e => e.day === slot.day);
    const teacherLoad = teachers.reduce((sum, t) => sum + dayEnts.filter(e => splitTeacherNames(e.teacherName).includes(t)).length, 0);
    const audience = audienceForPlacement(item);
    const classLoad = dayEnts.reduce((sum, e) => sum + (audiencesConflict(audience, audienceForPlacement(e)) ? 1 : 0), 0);
    const samePeriodLoad = existing.filter(e => e.period === slot.period).length;
    return slotEnts.length * 100 + teacherLoad * 8 + classLoad * 6 + samePeriodLoad * 0.15 + Math.random();
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
    const dayEnts = existing.filter(e => e.day === slot.day);
    const teachers = splitTeacherNames(item.teacherName).filter(Boolean);
    const itemAudience = audienceForPlacement(item);
    let score = slotEnts.length * 10 + existing.filter(e => e.period === slot.period).length * 0.25;

    for (const e of slotEnts) {
      const sameUnit = item.unitId && e.unitId && item.unitId === e.unitId;
      if (sameUnit) continue;

      const et = splitTeacherNames(e.teacherName).filter(Boolean);
      if (teachers.some(t => et.includes(t))) score += 1000;

      const sameGrp = (item.groupId && e.groupId && item.groupId === e.groupId) || sameGroupTpl(item.templateId, e.templateId);
      const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);
      const conflict = audiencesConflict(itemAudience, audienceForPlacement(e));
      if (conflict && !conc) score += 800;
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
    return new Set([
      ...(group?.poolCardIds || []),
      ...((group?.units || []).flatMap(u => u.ttcardIds || [])),
      ...(unitItems || []).flatMap(u => (u.ttcards || []).map(c => c.id)),
    ].filter(Boolean));
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

  function placeAutoGroupSlot(group, activeItems, slot, placed) {
    // Current group manager stores a visible group as one aggregate item.
    // Keep one aggregate entry per 시수 so each occurrence is handled independently.
    const groupItem = activeItems[0];
    const item = groupItem ? makePlacementFromGroupItem(group, groupItem) : null;
    if (!item) return false;
    placed.push(normalizeTimetableEntry({ id: uid("ent"), ...applyDefaultRoomToEntryData({ ...item, ...slot }) }));
    return true;
  }

  const waitForBrowser = () => new Promise(resolve => setTimeout(resolve, 0));
  let autoAssignRunning = false;

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
    const autoItemCount = standalone.length + groupBlocks.reduce((sum, { unitItems }) => {
      return sum + (unitItems || []).reduce((unitSum, item) => unitSum + Math.max(1, Number(item.credits) || 0), 0);
    }, 0);

    if (!autoItemCount || !activeGrades.length) {
      alert("시간표 사전작업에서 생성된 과목 카드가 없습니다.\n먼저 시간표 사전작업에서 카드를 생성하거나, 로컬 모드 전환 시 온라인 데이터를 복사해 주세요.");
      return;
    }

    if (!confirm(`전체 학년 시간표를 자동 배치합니다.\n대상: ${activeGrades.map(gradeDisplay).join(", ")}\n\n기존 시간표가 모두 초기화됩니다. 계속할까요?`)) return;

    autoAssignRunning = true;
    setAutoAssignBusy(true);
    await waitForBrowser();

    const autoStartedAt = Date.now();

    try {
    captureTimetableUndo("자동 배정");
    addTimetableLog("auto", "자동 배치 시작", `대상 학년: ${activeGrades.map(gradeDisplay).join(", ")}`);

    // Preserve pinned entries only
    const pinnedEntries = entries().filter(e => e.pinned);
    ttDomain().entries = [...pinnedEntries];
    const pc = ttConfig().periodCount;
    const baseSlots = [];
    for (let day = 0; day < 5; day++) {
      for (let period = 0; period < pc; period++) baseSlots.push({ day, period });
    }

    const groupTargetSlots = groupBlocks.reduce((sum, { group, unitItems }) => {
      const credits = unitItems.map(u => u.credits || 0);
      return sum + (group.isConcurrent ? Math.max(0, ...credits) : credits.reduce((a, b) => a + b, 0));
    }, 0);
    const autoTargetSlots = standalone.length + groupTargetSlots;

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
      { name:"relaxedRoom", label:"교실 자동배정 제한 완화", attempts:16, options:{ respectSoftLimits:false, respectUnavailable:true,  respectAssignedRoom:false } },
      { name:"relaxedUnavailable", label:"교사 불가시간까지 완화", attempts:10, options:{ respectSoftLimits:false, respectUnavailable:false, respectAssignedRoom:false } },
    ];

    let bestPlaced = [], bestFailed = [], bestScore = -1, bestStage = stages[0];
    let autoOps = 0;
    const yieldAutoAssign = async () => {
      autoOps++;
      if (autoOps % 20 === 0) await waitForBrowser();
    };

    for (const stage of stages) {
      for (let attempt = 0; attempt < stage.attempts; attempt++) {
        await waitForBrowser();
        const placed = [], failed = [];

        // ── Place concurrent groups first: one independent occurrence per 시수 ──
        const orderedGroups = shuffle([...groupBlocks]).sort((a, b) => {
          const ac = Math.max(...a.unitItems.map(u => u.credits));
          const bc = Math.max(...b.unitItems.map(u => u.credits));
          return bc - ac;
        });

        for (const { group, unitItems } of orderedGroups) {
          if (!group.isConcurrent) continue;
          const maxCredits = Math.max(...unitItems.map(u => u.credits));
          const alreadyPinned = countPinnedGroupSlots(group, unitItems, pinnedEntries);
          const needSlots = Math.max(0, maxCredits - alreadyPinned);

          for (let slot_i = 0; slot_i < needSlots; slot_i++) {
            await yieldAutoAssign();
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
          if (group.isConcurrent) continue;
          for (const groupItem of unitItems) {
            const pinnedSlots = countPinnedGroupSlots(group, [groupItem], pinnedEntries);
            const needSlots = Math.max(0, groupItem.credits - pinnedSlots);
            for (let i = 0; i < needSlots; i++) {
              await yieldAutoAssign();
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
            await yieldAutoAssign();
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
        }
        if (!failed.length) break;
      }
      if (!bestFailed.length) break;
    }

    // ── Final repair pass ─────────────────────────────────────────
    // Greedy 자동배치가 끝까지 못 넣은 카드는 그냥 남기지 않고,
    // 보호 슬롯과 동일 카드 중복만 피하면서 최소 충돌 슬롯에 배치합니다.
    // 이후 recomputeConflicts()가 교사/학생/교실 충돌을 색상과 상세 내역으로 표시합니다.
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
      await yieldAutoAssign();
    }
    bestFailed = stillFailed;

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

    const stageNote = bestStage.name === "strict" ? "" : `
적용 방식: ${bestStage.label}`;
    const forcedNote = forcedPlaced.length
      ? `
⚠️ ${forcedPlaced.length}개는 미배치 방지를 위해 최소 충돌 위치에 보정 배치했습니다. 충돌 색상과 상세창을 확인해 주세요.`
      : "";
    if (!names.length) {
      alert(`✅ 전체 ${bestPlaced.length}개 슬롯 배치 완료!${stageNote}${forcedNote}

자세한 결과는 하단 [로그] 탭에서 확인할 수 있습니다.`);
    } else {
      const failedList = names.slice(0, 12).join("\n");
      const moreFailed = names.length > 12 ? "\n..." : "";
      alert(`✅ ${bestPlaced.length}개 배치 완료${forcedNote}
⚠️ 그래도 미배치 ${names.length}개:
${failedList}${moreFailed}

💡 남은 카드는 고정 채플/창체 보호 슬롯 또는 동일 카드 동일 시간 중복 때문에 배치할 수 없었습니다.${stageNote}

자세한 결과는 하단 [로그] 탭에서 확인할 수 있습니다.`);
    }
    } catch (err) {
      console.error("Auto assign failed:", err);
      addTimetableLog("error", "자동 배치 오류", err?.message || String(err));
      alert("자동 배치 중 오류가 발생했습니다. 하단 [로그] 탭과 콘솔 로그를 확인해 주세요.");
    } finally {
      autoAssignRunning = false;
      setAutoAssignBusy(false);
    }
  }


  return autoAssignAll;
}
