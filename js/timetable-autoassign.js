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

  function isConcurrentTpl(templateId) {
    const tpl = appState.templates.templates?.find(t => t.id === templateId);
    const gid = tpl?.calcGroupId; if (!gid) return false;
    const grp = appState.templates.templateGroups?.find(g => g.id === gid);
    return grp?.groupType === "concurrent";
  }
  /** Check if a placement item/entry belongs to a concurrent group */
  function isConcurrentItem(x) {
    if (x.groupId) {
      const grp = appState.templates.templateGroups?.find(g => g.id === x.groupId);
      if (grp) return grp.groupType === "concurrent" || !!grp.isConcurrent;
    }
    return isConcurrentTpl(x.templateId);
  }
  function sameGroupTpl(tidA, tidB) {
    const tA = appState.templates.templates?.find(t => t.id === tidA);
    const tB = appState.templates.templates?.find(t => t.id === tidB);
    return tA?.calcGroupId && tA.calcGroupId === tB?.calcGroupId;
  }
  function getGroupId(tid) {
    return appState.templates.templates?.find(t => t.id === tid)?.calcGroupId || null;
  }
  function linkedGroups(tidA, tidB) {
    const gA = getGroupId(tidA), gB = getGroupId(tidB);
    if (!gA || !gB || gA === gB) return false;
    const groups = appState.templates.templateGroups || [];
    const grpA = groups.find(g => g.id === gA);
    const grpB = groups.find(g => g.id === gB);
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

  async function autoAssignAll() {
    if (!canEdit()) return;
    if (autoAssignRunning) { alert("자동 배치가 이미 진행 중입니다."); return; }

    const activeGrades = GRADE_KEYS.filter(g => getSubjectsForGrade(g).length > 0);
    if (!activeGrades.length) { alert("커리큘럼에 배치된 과목이 없습니다."); return; }

    if (!confirm(`전체 학년 시간표를 자동 배치합니다.\n대상: ${activeGrades.join(", ")}\n\n기존 시간표가 모두 초기화됩니다. 계속할까요?`)) return;

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

    const { standalone, groupBlocks } = buildSchedulableItems();
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
      { name:"strict", label:"교사 제약 포함", attempts:12, options:{ respectSoftLimits:true,  respectUnavailable:true, respectAssignedRoom:true  } },
      { name:"relaxedSoft", label:"일일/연속 제한 완화", attempts:12, options:{ respectSoftLimits:false, respectUnavailable:true, respectAssignedRoom:true  } },
      { name:"relaxedRoom", label:"교실 자동배정 제한 완화", attempts:8, options:{ respectSoftLimits:false, respectUnavailable:true, respectAssignedRoom:false } },
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
            activeItems.forEach(groupItem => failed.push({ name: `${group.name} - ${groupItem.name || "그룹 카드"}` }));
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
              if (slot) placed.push(normalizeTimetableEntry({ id: uid("ent"), ...applyDefaultRoomToEntryData({ ...item, ...slot }) }));
              else failed.push({ name: `${group.name} - ${groupItem.name || "그룹 카드"}` });
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
              failed.push({ name: getAutoItemName(item) });
              break;
            }
            placed.push(normalizeTimetableEntry({ id: uid("ent"), ...applyDefaultRoomToEntryData({ ...item, ...slot }) }));
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
      failedCount: names.length,
      failedNames: names,
      durationMs: Date.now() - autoStartedAt,
      conflictTotal: conflictSummary.totalAffected,
      conflictCounts: conflictSummary.counts
    };
    setLastAutoAssignReport(report);
    addTimetableLog(
      "auto",
      names.length ? "자동 배치 부분 완료" : "자동 배치 완료",
      `신규 배치 ${bestPlaced.length}개, 미배치 ${names.length}개, 충돌 ${conflictSummary.totalAffected}건 · 방식: ${bestStage.label}`
    );
    renderAll();

    const stageNote = bestStage.name === "strict" ? "" : `\n적용 방식: ${bestStage.label}`;
    if (!names.length) {
      alert(`✅ 전체 ${bestPlaced.length}개 슬롯 배치 완료!${stageNote}\n\n자세한 결과는 하단 [로그] 탭에서 확인할 수 있습니다.`);
    } else {
      alert(`✅ ${bestPlaced.length}개 배치 완료\n⚠️ 미배치 ${names.length}개:\n${names.slice(0,12).join("\n")}${names.length>12?"\n...":""}` +
        `\n\n💡 실제 운영 가능한 시간표라면, 고정된 수업·수업 불가 시간·동일 교사 중복 여부를 먼저 확인해 주세요.${stageNote}\n\n자세한 결과는 하단 [로그] 탭에서 확인할 수 있습니다.`);
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
