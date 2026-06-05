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
    describeTtCard, makePlacementFromGroupItem, getSubjectsForGrade, getCreditsForTtCard,
    entries, ttDomain, ttConfig, constraints,
    buildSchedulableItems, getEffectiveAssignedRoomId, applyDefaultRoomToEntryData,
    audienceForPlacement, audiencesConflict, ttCardIdsFromPlacement, protectedSlotConflict,
    shuffle, captureTimetableUndo, addTimetableLog, setLastAutoAssignReport,
    getConflictCounts, recomputeConflicts, renderAll, $
  } = deps;

  const ttGroups = () => appState.timetable?.ttcardGroups || [];

  // ── Restricted-teacher helpers ─────────────────────────────────
  // 시간강사/육아단축/제한근무 교사는 자동배치에서 고정 수업 다음 우선순위로 다룹니다.
  const RESTRICTED_WORK_TYPES = new Set(["parttime", "childcare", "restricted", "other"]);
  const normalizeWorkType = value => RESTRICTED_WORK_TYPES.has(String(value || "")) ? String(value || "") : (String(value || "") === "fulltime" ? "fulltime" : "fulltime");
  const isRestrictedTeacher = teacher => {
    const name = String(teacher || "").trim();
    if (!name) return false;
    const c = constraints()?.[name];
    if (!c) return false;
    return c.isRestrictedWork === true || RESTRICTED_WORK_TYPES.has(normalizeWorkType(c.workType));
  };
  const getTeacherNamesFromCards = cards => [...new Set((cards || []).flatMap(card => [
    ...(Array.isArray(card?.teachers) ? card.teachers : []),
    ...splitTeacherNames(card?.teacherName || "")
  ]).map(t => String(t || "").trim()).filter(Boolean))];
  const getTeachersForAutoItem = item => {
    const names = [
      ...(Array.isArray(item?.teachers) ? item.teachers : []),
      ...splitTeacherNames(item?.teacherName || item?.teachers || ""),
      ...getTeacherNamesFromCards(item?.ttcards || [])
    ];
    return [...new Set(names.map(t => String(t || "").trim()).filter(Boolean))];
  };
  const getRestrictedTeachersForAutoItem = item => getTeachersForAutoItem(item).filter(isRestrictedTeacher);
  const annotateRestrictedAutoItem = item => {
    const restrictedTeachers = getRestrictedTeachersForAutoItem(item);
    return {
      ...item,
      hasRestrictedTeacher: restrictedTeachers.length > 0,
      restrictedTeachers,
      // 0은 고정/잠금, 1은 제약근무 교사, 2는 일반 자동배치 대상입니다.
      priorityTier: restrictedTeachers.length > 0 ? 1 : 2
    };
  };
  const annotateRestrictedGroupBlock = block => {
    const unitItems = (block?.unitItems || []).map(annotateRestrictedAutoItem);
    const restrictedTeachers = [...new Set(unitItems.flatMap(u => u.restrictedTeachers || []))];
    return {
      ...block,
      unitItems,
      hasRestrictedTeacher: restrictedTeachers.length > 0,
      restrictedTeachers,
      priorityTier: restrictedTeachers.length > 0 ? 1 : 2
    };
  };
  const comparePriority = (a, b) => (Number(a?.priorityTier ?? 2) - Number(b?.priorityTier ?? 2));
  const describeRestrictedTeachers = names => {
    const list = [...new Set((names || []).filter(Boolean))];
    return list.length ? `제약교사: ${list.join(", ")}` : "";
  };


  // ── Teacher constraint load helpers ─────────────────────────────
  // 자동배치 후보 시간 계산에서는 교사 시수를 "entry 수"가 아니라
  // "요일·교시 슬롯 수"로 계산해야 합니다. 같은 동시배정 unit 안에서
  // 여러 entry가 만들어져도 교사는 같은 시간 1시수만 담당한 것으로 봅니다.
  const teacherEntryHasTeacher = (entry, teacher) => {
    const name = String(teacher || "").trim();
    if (!name || !entry) return false;
    const names = [
      ...splitTeacherNames(entry.teacherName || ""),
      ...(Array.isArray(entry.teachers) ? entry.teachers : [])
    ].map(t => String(t || "").trim()).filter(Boolean);
    return names.includes(name);
  };

  const teacherSlotKey = (day, period) => `${day}:${period}`;

  function getTeacherSlotSet(teacher, existing = [], dayFilter = null) {
    const slots = new Set();
    (existing || []).forEach(e => {
      if (!teacherEntryHasTeacher(e, teacher)) return;
      if (dayFilter != null && e.day !== dayFilter) return;
      if (!Number.isInteger(e.day) || !Number.isInteger(e.period)) return;
      slots.add(teacherSlotKey(e.day, e.period));
    });
    return slots;
  }

  function getTeacherWeekLoad(teacher, existing = []) {
    return getTeacherSlotSet(teacher, existing).size;
  }

  function getTeacherDayLoad(teacher, existing = [], day) {
    return getTeacherSlotSet(teacher, existing, day).size;
  }

  function getTeacherDayPeriods(teacher, existing = [], day) {
    return [...getTeacherSlotSet(teacher, existing, day)]
      .map(key => Number(String(key).split(":")[1]))
      .filter(n => Number.isInteger(n))
      .sort((a, b) => a - b);
  }

  function maxConsecutiveAfterAdding(teacher, existing = [], day, period) {
    const periods = getTeacherDayPeriods(teacher, existing, day);
    if (!periods.includes(period)) periods.push(period);
    periods.sort((a, b) => a - b);
    let maxC = periods.length ? 1 : 0;
    let cur = periods.length ? 1 : 0;
    for (let i = 1; i < periods.length; i++) {
      cur = periods[i] === periods[i - 1] + 1 ? cur + 1 : 1;
      maxC = Math.max(maxC, cur);
    }
    return maxC;
  }

  function getTeacherLimitState(teacher, slot, existing = []) {
    const c = constraints()?.[teacher] || {};
    const maxPerDay = Number(c.maxPerDay) || 0;
    const maxConsecutive = Number(c.maxConsecutive) || 0;
    const maxPerWeek = Number(c.maxPerWeek) || 0;
    const dayLoad = getTeacherDayLoad(teacher, existing, slot.day);
    const weekLoad = getTeacherWeekLoad(teacher, existing);
    const nextConsecutive = maxConsecutiveAfterAdding(teacher, existing, slot.day, slot.period);
    return {
      constraint: c,
      maxPerDay,
      maxConsecutive,
      maxPerWeek,
      dayLoad,
      weekLoad,
      nextConsecutive,
      wouldExceedDay: maxPerDay > 0 && dayLoad >= maxPerDay,
      wouldExceedWeek: maxPerWeek > 0 && weekLoad >= maxPerWeek,
      wouldExceedConsecutive: maxConsecutive > 0 && nextConsecutive > maxConsecutive,
    };
  }

  function teacherLimitPenalty(teacher, slot, existing = []) {
    const s = getTeacherLimitState(teacher, slot, existing);
    let penalty = 0;
    if (s.maxPerWeek > 0) penalty += (s.weekLoad / s.maxPerWeek) * 30;
    if (s.maxPerDay > 0) penalty += (s.dayLoad / s.maxPerDay) * 25;
    if (s.maxConsecutive > 0) penalty += Math.max(0, s.nextConsecutive - 1) * 12;
    return penalty;
  }

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

  function compoundRefForCard(card) {
    if (!card || !card.compoundParentTemplateId || !card.compoundPartId) return null;
    const grade = card.gradeKey || "";
    const section = (card.sectionIdx ?? 0);
    return {
      key: `${grade}::${section}::${card.compoundParentTemplateId}`,
      partId: card.compoundPartId,
      cardId: card.id
    };
  }

  function compoundRefsForPlacement(x = {}) {
    const refs = [];
    ttCardIdsFromPlacement(x).forEach(cardId => {
      const ref = compoundRefForCard(getTtCardById(cardId));
      if (ref) refs.push(ref);
    });
    if (!refs.length && x.compoundParentTemplateId && x.compoundPartId) {
      refs.push({
        key: `${x.gradeKey || ""}::${x.sectionIdx ?? 0}::${x.compoundParentTemplateId}`,
        partId: x.compoundPartId,
        cardId: x.ttcardId || ""
      });
    }
    return refs;
  }

  function hasInternalCompoundSiblingConflict(x = {}) {
    const seen = new Map();
    for (const ref of compoundRefsForPlacement(x)) {
      if (!ref?.key) continue;
      const prev = seen.get(ref.key);
      if (prev && (prev.partId !== ref.partId || prev.cardId !== ref.cardId)) return true;
      seen.set(ref.key, ref);
    }
    return false;
  }

  function hasCompoundSiblingConflict(a = {}, b = {}) {
    const refsA = compoundRefsForPlacement(a);
    const refsB = compoundRefsForPlacement(b);
    if (!refsA.length || !refsB.length) return false;
    return refsA.some(ra => refsB.some(rb =>
      ra.key && rb.key && ra.key === rb.key && (ra.partId !== rb.partId || ra.cardId !== rb.cardId)
    ));
  }

  /** Check if a placement item/entry belongs to a concurrent group */
  function isConcurrentItem(x) {
    return groupIdsForPlacement(x).some(groupId => {
      const grp = ttGroups().find(g => g.id === groupId);
      return grp && (grp.groupType === "concurrent" || !!grp.isConcurrent);
    });
  }

  function sameUnitPlacement(a = {}, b = {}) {
    return !!(a.unitId && b.unitId && a.unitId === b.unitId);
  }

  function roomConflictsInSlot(candidate = {}, slot = {}, placed = []) {
    const roomId = candidate.roomId;
    if (!roomId) return false;
    const slotEntries = [...entries(), ...placed].filter(e => e.day === slot.day && e.period === slot.period);
    return slotEntries.some(e => e.roomId === roomId && !sameUnitPlacement(candidate, e));
  }

  function getRoomCapacity(room = {}) {
    const n = Number(room.capacity);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function getAudienceSizeForRoom(data = {}) {
    const direct = Array.isArray(data.audienceStudentKeys) ? data.audienceStudentKeys.length : 0;
    if (direct) return direct;
    const audience = audienceForPlacement?.(data);
    return audience?.studentKeys?.size || 0;
  }

  function sortRoomCandidatesFor(data = {}) {
    const size = getAudienceSizeForRoom(data);
    return [...(appState.rooms?.rooms || [])]
      .filter(room => room?.id)
      .map((room, idx) => ({ room, idx }))
      .sort((a, b) => {
        const ag = a.room.type === "일반" ? 0 : 1;
        const bg = b.room.type === "일반" ? 0 : 1;
        if (ag !== bg) return ag - bg;
        const ac = getRoomCapacity(a.room);
        const bc = getRoomCapacity(b.room);
        const aFit = !size || !ac || ac >= size ? 0 : 1;
        const bFit = !size || !bc || bc >= size ? 0 : 1;
        if (aFit !== bFit) return aFit - bFit;
        if (ac !== bc) return ac - bc;
        return String(a.room.name || "").localeCompare(String(b.room.name || ""), "ko", { numeric: true }) || a.idx - b.idx;
      })
      .map(x => x.room);
  }

  function applyAutoRoomToEntryData(data = {}, slot = data, placed = []) {
    const entryData = applyDefaultRoomToEntryData({ ...data });
    const rule = String(entryData.roomRule || "auto").trim();

    if (rule === "none") return { ...entryData, roomId: null };

    // 고정 교실은 사용자가 지정한 값 그대로 유지합니다.
    if (entryData.roomPinned || rule === "fixed") return entryData;

    // 기본 추천 교실이 있고 해당 시간에 비어 있으면 그대로 사용합니다.
    if (entryData.roomId && !roomConflictsInSlot(entryData, slot, placed)) return entryData;

    // 기본 추천 교실이 없거나 이미 사용 중이면, 해당 시간에 비어 있는 교실을 자동 보조 배정합니다.
    for (const room of sortRoomCandidatesFor(entryData)) {
      if (!room.id || room.id === entryData.roomId) continue;
      const test = { ...entryData, roomId: room.id };
      if (!roomConflictsInSlot(test, slot, placed)) return test;
    }
    return entryData;
  }


  function addReason(reasonMap, code, label, detail = "") {
    if (!reasonMap.has(code)) reasonMap.set(code, { code, label, count: 0, samples: [] });
    const item = reasonMap.get(code);
    item.count += 1;
    if (detail && item.samples.length < 3 && !item.samples.includes(detail)) item.samples.push(detail);
  }

  function formatSlotLabel(slot = {}) {
    const dayLabels = ["월", "화", "수", "목", "금"];
    const periodLabel = ttConfig().periodLabels?.[slot.period] || `${Number(slot.period || 0) + 1}교시`;
    return `${dayLabels[slot.day] ?? "?"} ${periodLabel}`;
  }

  function analyzePlacementSlot(item, slot, placed, options = {}) {
    const { respectSoftLimits = true, respectUnavailable = true, respectAssignedRoom = true } = options;
    const existing = [...entries(), ...placed];
    const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
    const teachers = getTeachersForAutoItem(item);
    const reasons = new Map();

    if (protectedSlotConflict?.(item, slot.day, slot.period, { placed })) {
      addReason(reasons, "protectedSlot", "고정/보호 수업 시간", `${formatSlotLabel(slot)} 보호 슬롯`);
    }

    const exclusion = slotEnts.find(e => hasAutoGroupExclusionSlotConflict(item, e));
    if (exclusion) {
      addReason(reasons, "groupExclusion", "그룹 제외 카드와 같은 시간", `${formatSlotLabel(slot)} · ${getAutoItemName(exclusion)}`);
    }

    if (hasInternalCompoundSiblingConflict(item)) {
      addReason(reasons, "compoundInternal", "복합과목 구성 충돌", "같은 복합과목의 다른 파트가 한 배치 안에 섞임");
    }
    const compoundOther = slotEnts.find(e => hasCompoundSiblingConflict(item, e));
    if (compoundOther) {
      addReason(reasons, "compoundSibling", "복합과목 파트 시간 중복", `${formatSlotLabel(slot)} · ${getAutoItemName(compoundOther)}`);
    }

    const itemCardIds = new Set(ttCardIdsFromPlacement(item));
    const duplicate = itemCardIds.size
      ? slotEnts.find(e => ttCardIdsFromPlacement(e).some(id => itemCardIds.has(id)))
      : slotEnts.find(e => e.templateId === item.templateId && e.gradeKey === item.gradeKey && (e.sectionIdx ?? 0) === (item.sectionIdx ?? 0));
    if (duplicate) {
      addReason(reasons, "duplicate", "동일 카드 중복", `${formatSlotLabel(slot)}에 이미 같은 카드 배치`);
    }

    for (const e of slotEnts) {
      const et = splitTeacherNames(e.teacherName || "").filter(Boolean);
      const overlapTeacher = teachers.find(t => et.includes(t));
      if (overlapTeacher && !(item.unitId && e.unitId && item.unitId === e.unitId)) {
        addReason(reasons, "teacherConflict", "교사 시간 충돌", `${formatSlotLabel(slot)} · ${overlapTeacher} / ${getAutoItemName(e)}`);
      }
    }

    const itemAudience = audienceForPlacement(item);
    for (const e of slotEnts) {
      if (item.unitId && e.unitId && item.unitId === e.unitId) continue;
      const sameGrp = sameActiveGroup(item, e);
      const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);
      const eAudience = audienceForPlacement(e);
      const conflict = audiencesConflict(itemAudience, eAudience);
      if (conc) {
        if (itemAudience.studentKeys.size && eAudience.studentKeys.size && conflict) {
          addReason(reasons, "studentConflict", "학생/반 시간 충돌", `${formatSlotLabel(slot)} · ${getAutoItemName(e)}`);
        }
        continue;
      }
      if (conflict) addReason(reasons, "studentConflict", "학생/반 시간 충돌", `${formatSlotLabel(slot)} · ${getAutoItemName(e)}`);
    }

    for (const teacher of teachers) {
      const c = constraints()?.[teacher] || {};
      const restrictedTeacher = isRestrictedTeacher(teacher);
      const enforceLimits = respectSoftLimits || restrictedTeacher;

      if ((respectUnavailable || restrictedTeacher) && c?.unavailableSlots?.some(s => s.day === slot.day && s.period === slot.period)) {
        addReason(reasons, "teacherUnavailable", "교사 불가시간", `${formatSlotLabel(slot)} · ${teacher}`);
      }

      const limit = getTeacherLimitState(teacher, slot, existing);
      if (enforceLimits && limit.wouldExceedWeek) {
        addReason(reasons, "teacherWeekLimit", "교사 주 최대 시수 초과", `${teacher} · 주 ${limit.weekLoad}/${limit.maxPerWeek}시수 사용 중`);
      }
      if (enforceLimits && limit.wouldExceedDay) {
        addReason(reasons, "teacherDayLimit", "교사 하루 최대 시수 초과", `${formatSlotLabel(slot)} · ${teacher} · 당일 ${limit.dayLoad}/${limit.maxPerDay}시수`);
      }
      if (enforceLimits && limit.wouldExceedConsecutive) {
        addReason(reasons, "teacherConsecutive", "교사 연속수업 제한", `${formatSlotLabel(slot)} · ${teacher} · 연속 ${limit.nextConsecutive}시수`);
      }
    }

    const candidateRoomData = applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed);
    if (respectAssignedRoom && roomConflictsInSlot(candidateRoomData, slot, placed)) {
      const roomName = (appState.rooms?.rooms || []).find(r => r.id === candidateRoomData.roomId)?.name || candidateRoomData.roomId || "교실";
      addReason(reasons, "roomConflict", "교실 시간 충돌", `${formatSlotLabel(slot)} · ${roomName}`);
    }

    for (const teacher of teachers) {
      const roomId = getEffectiveAssignedRoomId(teacher);
      if (respectAssignedRoom && roomId) {
        const roomBusy = existing.some(e => e.day === slot.day && e.period === slot.period && e.roomId === roomId && !sameUnitPlacement(item, e));
        if (roomBusy && candidateRoomData.roomId === roomId) {
          const roomName = (appState.rooms?.rooms || []).find(r => r.id === roomId)?.name || roomId;
          addReason(reasons, "teacherRoomBusy", "교사 담당교실 사용 중", `${formatSlotLabel(slot)} · ${teacher} / ${roomName}`);
        }
      }
    }

    return { valid: reasons.size === 0, reasons: [...reasons.values()] };
  }

  function summarizeFailedPlacement(failedItem, baseSlots = [], placed = [], options = {}) {
    const item = failedItem?.item;
    const name = failedItem?.name || getAutoItemName(item);
    if (!item) {
      return { name, validSlots: 0, totalSlots: baseSlots.length, topReasons: [{ label: "카드 정보 없음", count: 1, samples: [] }], summary: "배치 대상 카드 정보를 찾지 못했습니다." };
    }
    const reasonMap = new Map();
    let validSlots = 0;
    for (const slot of baseSlots) {
      const result = analyzePlacementSlot(item, slot, placed, options);
      if (result.valid) validSlots += 1;
      result.reasons.forEach(r => {
        if (!reasonMap.has(r.code)) reasonMap.set(r.code, { code: r.code, label: r.label, count: 0, samples: [] });
        const dest = reasonMap.get(r.code);
        dest.count += r.count;
        (r.samples || []).forEach(sample => {
          if (sample && dest.samples.length < 3 && !dest.samples.includes(sample)) dest.samples.push(sample);
        });
      });
    }
    const topReasons = [...reasonMap.values()].sort((a, b) => b.count - a.count).slice(0, 5);
    const teachers = getTeachersForAutoItem(item);
    const restrictedTeachers = getRestrictedTeachersForAutoItem(item);
    const reasonText = topReasons.length
      ? topReasons.slice(0, 3).map(r => `${r.label} ${r.count}칸`).join(" · ")
      : (validSlots ? "후보 시간은 있으나 보정 단계에서 다른 카드와 충돌" : "후보 시간 없음");
    return {
      name,
      groupName: failedItem?.groupId ? (ttGroups().find(g => g.id === failedItem.groupId)?.name || "") : "",
      teachers,
      restrictedTeachers,
      validSlots,
      totalSlots: baseSlots.length,
      topReasons,
      summary: `가능 ${validSlots}/${baseSlots.length}칸 · ${reasonText}`
    };
  }

  function buildFailureDiagnostics(failedItems = [], baseSlots = [], placed = [], options = {}) {
    const byName = new Map();
    (failedItems || []).forEach(failedItem => {
      const diag = summarizeFailedPlacement(failedItem, baseSlots, placed, options);
      const key = diag.name || "미확인 카드";
      if (!byName.has(key)) {
        byName.set(key, { ...diag, occurrences: 0 });
      }
      const acc = byName.get(key);
      acc.occurrences += 1;
      // 여러 회차가 같은 이름으로 실패하면 가능한 시간은 가장 보수적으로 낮은 값을 표시합니다.
      acc.validSlots = Math.min(acc.validSlots, diag.validSlots);
      const mergedReasons = new Map((acc.topReasons || []).map(r => [r.code || r.label, { ...r, samples: [...(r.samples || [])] }]));
      (diag.topReasons || []).forEach(r => {
        const k = r.code || r.label;
        if (!mergedReasons.has(k)) mergedReasons.set(k, { ...r, samples: [...(r.samples || [])] });
        else {
          const cur = mergedReasons.get(k);
          cur.count += r.count;
          (r.samples || []).forEach(sample => {
            if (sample && cur.samples.length < 3 && !cur.samples.includes(sample)) cur.samples.push(sample);
          });
        }
      });
      acc.topReasons = [...mergedReasons.values()].sort((a, b) => b.count - a.count).slice(0, 5);
      acc.summary = `가능 ${acc.validSlots}/${acc.totalSlots}칸 · ${acc.topReasons.slice(0, 3).map(r => `${r.label} ${r.count}칸`).join(" · ") || "후보 시간 없음"}`;
    });
    return [...byName.values()].sort((a, b) => a.validSlots - b.validSlots || b.occurrences - a.occurrences || String(a.name).localeCompare(String(b.name), "ko"));
  }

  function diagnosticsToHtml(diagnostics = [], limit = 8) {
    if (!diagnostics.length) return "";
    const esc = s => String(s ?? "").replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]));
    return `<div class="tt-auto-progress-failed"><b>미배치 원인 후보</b><ul>${diagnostics.slice(0, limit).map(d => {
      const reason = d.topReasons?.[0];
      const sample = reason?.samples?.[0] ? ` · 예: ${reason.samples[0]}` : "";
      const teacher = d.restrictedTeachers?.length ? ` · 제약교사: ${d.restrictedTeachers.join(", ")}` : "";
      return `<li>${esc(d.name)}${d.occurrences > 1 ? ` ×${d.occurrences}` : ""} — ${esc(d.summary)}${esc(teacher)}${esc(sample)}</li>`;
    }).join("")}${diagnostics.length > limit ? `<li>외 ${diagnostics.length - limit}개</li>` : ""}</ul></div>`;
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

    // 0-2. 복합 과목 구성 카드(예: 미적분(2)/심화물리(2))는
    // 같은 대표 과목의 서로 다른 구성끼리 같은 시간에 들어가면 안 됩니다.
    if (hasInternalCompoundSiblingConflict(item)) return false;
    if (slotEnts.some(e => hasCompoundSiblingConflict(item, e))) return false;

    // 1. Teacher conflict. Same concurrent group can share the time,
    //    but it cannot make one teacher teach two different entries.
    for (const e of slotEnts) {
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

    // 4. Teacher unavailable / max per week / max per day / max consecutive
    // 시간강사·육아단축 등 제약근무 교사는 완화 단계에서도 이 조건들을 절대 조건으로 봅니다.
    for (const teacher of teachers) {
      const c = constraints()?.[teacher] || {};
      const restrictedTeacher = isRestrictedTeacher(teacher);
      const enforceLimits = respectSoftLimits || restrictedTeacher;

      if ((respectUnavailable || restrictedTeacher) && c?.unavailableSlots?.some(s => s.day === slot.day && s.period === slot.period)) return false;

      const limit = getTeacherLimitState(teacher, slot, existing);
      if (enforceLimits && limit.wouldExceedWeek) return false;
      if (enforceLimits && limit.wouldExceedDay) return false;
      if (enforceLimits && limit.wouldExceedConsecutive) return false;
    }
    // 6. Room conflict: 실제로 배정될 교실 기준으로 검사합니다.
    // 같은 시간대의 다른 과목은 각각 다른 교실을 가져야 합니다.
    // 자동 추천 교실이 이미 사용 중이면 빈 일반교실을 보조 추천합니다.
    const candidateRoomData = applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed);
    if (respectAssignedRoom && roomConflictsInSlot(candidateRoomData, slot, placed)) return false;

    // 7. 교사 담당교실 기준 추가 방어 검사입니다.
    for (const teacher of teachers) {
      const roomId = getEffectiveAssignedRoomId(teacher);
      if (respectAssignedRoom && roomId) {
        const roomBusy = existing.some(e => {
          if (!(e.day===slot.day && e.period===slot.period && e.roomId===roomId)) return false;
          return !sameUnitPlacement(item, e);
        });
        if (roomBusy && candidateRoomData.roomId === roomId) return false;
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
    const teacherLoad = teachers.reduce((sum, t) => sum + getTeacherDayLoad(t, existing, slot.day), 0);
    const teacherLimitLoad = teachers.reduce((sum, t) => sum + teacherLimitPenalty(t, slot, existing), 0);
    const audience = audienceForPlacement(item);
    const classLoad = dayEnts.reduce((sum, e) => sum + (audiencesConflict(audience, audienceForPlacement(e)) ? 1 : 0), 0);
    const samePeriodLoad = existing.filter(e => e.period === slot.period).length;
    return exclusionPenalty + slotEnts.length * 100 + teacherLoad * 8 + teacherLimitLoad + classLoad * 6 + samePeriodLoad * 0.15 + Math.random();
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

  function makeAutoEntry(item, slot, placed = []) {
    if (!item || !slot) return null;
    return normalizeTimetableEntry({
      id: uid("ent"),
      ...applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed)
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
    if (hasInternalCompoundSiblingConflict(item)) return Infinity;
    if (slotEnts.some(e => hasCompoundSiblingConflict(item, e))) return Infinity;
    const dayEnts = existing.filter(e => e.day === slot.day);
    const teachers = splitTeacherNames(item.teacherName).filter(Boolean);
    const itemAudience = audienceForPlacement(item);

    // 마지막 보정 단계에서도 교실 중복은 허용하지 않습니다.
    const candidateRoomData = applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed);
    if (roomConflictsInSlot(candidateRoomData, slot, placed)) return Infinity;

    let score = slotEnts.length * 10 + existing.filter(e => e.period === slot.period).length * 0.25;

    for (const e of slotEnts) {
      const sameUnit = item.unitId && e.unitId && item.unitId === e.unitId;
      if (sameUnit) continue;

      const sameGrp = sameActiveGroup(item, e);
      const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);

      const et = splitTeacherNames(e.teacherName).filter(Boolean);
      if (teachers.some(t => et.includes(t))) return Infinity;

      const eAudience = audienceForPlacement(e);
      const conflict = audiencesConflict(itemAudience, eAudience);
      // 보정 배치에서도 같은 학생의 수업 중복은 절대 만들지 않습니다.
      // 단, 같은 동시배정 그룹 안에서 양쪽 모두 수강명단이 있고 실제 학생이 겹치지 않으면 허용합니다.
      const rosterSplitOk = conc && itemAudience.studentKeys.size && eAudience.studentKeys.size && ![...itemAudience.studentKeys].some(k => eAudience.studentKeys.has(k));
      if (conflict && !rosterSplitOk) return Infinity;
      if (e.roomId) {
        const assignedRooms = teachers.map(getEffectiveAssignedRoomId).filter(Boolean);
        if (assignedRooms.includes(e.roomId)) score += 250;
      }
    }

    for (const teacher of teachers) {
      const c = constraints()?.[teacher] || {};
      const restrictedTeacher = isRestrictedTeacher(teacher);
      // 최종 보정 단계에서도 제약근무 교사의 불가시간·주/일/연속 제한은 침범하지 않습니다.
      if (c?.unavailableSlots?.some(s => s.day === slot.day && s.period === slot.period)) {
        if (restrictedTeacher) return Infinity;
        score += 500;
      }

      const limit = getTeacherLimitState(teacher, slot, existing);
      if (limit.wouldExceedWeek) {
        if (restrictedTeacher) return Infinity;
        score += 220 + (limit.weekLoad - limit.maxPerWeek + 1) * 45;
      }
      if (limit.wouldExceedDay) {
        if (restrictedTeacher) return Infinity;
        score += 150 + (limit.dayLoad - limit.maxPerDay + 1) * 30;
      }
      if (limit.wouldExceedConsecutive) {
        if (restrictedTeacher) return Infinity;
        score += 120 + (limit.nextConsecutive - limit.maxConsecutive) * 30;
      }

      const roomId = getEffectiveAssignedRoomId(teacher);
      if (roomId) {
        const roomBusy = slotEnts.some(e => {
          if (e.roomId !== roomId) return false;
          return !sameUnitPlacement(item, e);
        });
        if (roomBusy && candidateRoomData.roomId === roomId) return Infinity;
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

  // ── Post-placement improvement helpers ─────────────────────────
  // 자동배치가 일단 성공한 뒤, 충돌을 만들지 않는 범위에서 7교시 몰림,
  // 같은 과목 같은 날 반복, 교사 공강/연속수업 부담을 줄입니다.
  function entryClassKeysForScoring(entry = {}) {
    const audience = audienceForPlacement(entry);
    const keys = new Set([...(audience?.classKeys || [])]);
    if (!keys.size) {
      (entry.classIds || []).forEach(id => id && keys.add(id));
      (entry.targetClassIds || []).forEach(id => id && keys.add(id));
      if (entry.classId) keys.add(entry.classId);
      if (entry.gradeKey && Number.isInteger(entry.sectionIdx)) keys.add(`${entry.gradeKey}:${entry.sectionIdx}`);
    }
    return [...keys].filter(Boolean);
  }

  function entrySubjectKeyForScoring(entry = {}) {
    const ids = ttCardIdsFromPlacement(entry);
    if (ids.length) return ids.map(id => {
      const card = getTtCardById(id);
      return card?.templateId || card?.subject || id;
    }).join("+");
    return [entry.templateId || "", entry.compoundParentTemplateId || "", entry.subject || entry.name || entry.title || ""].filter(Boolean).join(":") || getAutoItemName(entry);
  }

  function getTeacherNamesForScoring(entry = {}) {
    return [...new Set([
      ...splitTeacherNames(entry.teacherName || ""),
      ...(Array.isArray(entry.teachers) ? entry.teachers : [])
    ].map(t => String(t || "").trim()).filter(Boolean))];
  }

  function maxConsecutiveFromPeriods(periods = []) {
    const arr = [...new Set(periods)].sort((a, b) => a - b);
    let best = arr.length ? 1 : 0;
    let cur = arr.length ? 1 : 0;
    for (let i = 1; i < arr.length; i++) {
      cur = arr[i] === arr[i - 1] + 1 ? cur + 1 : 1;
      best = Math.max(best, cur);
    }
    return best;
  }

  function scoreScheduleQuality(movable = []) {
    const all = [...entries(), ...(movable || [])];
    let score = 0;

    const classDaySubject = new Map();
    const classDayPeriods = new Map();
    const classLateCount = new Map();
    const teacherDayPeriods = new Map();

    all.forEach(entry => {
      if (!Number.isInteger(entry.day) || !Number.isInteger(entry.period)) return;
      const period = entry.period;
      const classKeys = entryClassKeysForScoring(entry);
      const subjectKey = entrySubjectKeyForScoring(entry);

      classKeys.forEach(cls => {
        const dayKey = `${cls}:${entry.day}`;
        if (!classDayPeriods.has(dayKey)) classDayPeriods.set(dayKey, []);
        classDayPeriods.get(dayKey).push(period);

        const subjectDayKey = `${cls}:${entry.day}:${subjectKey}`;
        classDaySubject.set(subjectDayKey, (classDaySubject.get(subjectDayKey) || 0) + 1);

        if (period >= 6) {
          score += 12;
          classLateCount.set(cls, (classLateCount.get(cls) || 0) + 1);
        } else if (period === 5) {
          score += 3;
        }
      });

      getTeacherNamesForScoring(entry).forEach(teacher => {
        const key = `${teacher}:${entry.day}`;
        if (!teacherDayPeriods.has(key)) teacherDayPeriods.set(key, []);
        teacherDayPeriods.get(key).push(period);
      });
    });

    classDaySubject.forEach(count => {
      if (count > 1) score += (count - 1) * 28;
    });

    classDayPeriods.forEach(periods => {
      const unique = [...new Set(periods)].sort((a, b) => a - b);
      const maxC = maxConsecutiveFromPeriods(unique);
      if (maxC >= 5) score += (maxC - 4) * 12;
    });

    classLateCount.forEach(count => {
      if (count > 4) score += (count - 4) * 5;
    });

    teacherDayPeriods.forEach((periods, key) => {
      const unique = [...new Set(periods)].sort((a, b) => a - b);
      if (!unique.length) return;
      const span = unique[unique.length - 1] - unique[0] + 1;
      const gaps = Math.max(0, span - unique.length);
      const maxC = maxConsecutiveFromPeriods(unique);
      const teacher = String(key).split(":")[0];
      const c = constraints()?.[teacher] || {};
      const limitC = Number(c.maxConsecutive) || 0;

      score += gaps * 5;
      if (unique.length >= 6) score += (unique.length - 5) * 8;
      if (limitC > 0 && maxC > limitC) score += (maxC - limitC) * 40;
      else if (maxC >= 4) score += (maxC - 3) * 14;
    });

    return score;
  }

  function getMovableBlocks(placed = []) {
    const map = new Map();
    (placed || []).forEach((entry, index) => {
      const key = entry.groupId
        ? `group:${entry.groupId}:${entry.day}:${entry.period}`
        : (entry.unitId ? `unit:${entry.unitId}:${entry.day}:${entry.period}` : `entry:${entry.id || index}`);
      if (!map.has(key)) map.set(key, { key, entries: [], indexes: [] });
      map.get(key).entries.push(entry);
      map.get(key).indexes.push(index);
    });
    return [...map.values()].filter(block => block.entries.length && Number.isInteger(block.entries[0].day) && Number.isInteger(block.entries[0].period));
  }

  function makeMovedBlockEntries(block, slot, placedWithoutBlock = []) {
    const moved = [];
    for (const original of block.entries) {
      const candidateData = { ...original, day: slot.day, period: slot.period };
      if (!checkPlacementValid(candidateData, slot, [...placedWithoutBlock, ...moved], {
        respectSoftLimits: true,
        respectUnavailable: true,
        respectAssignedRoom: true
      })) return null;
      const normalized = normalizeTimetableEntry({
        ...original,
        ...applyAutoRoomToEntryData(candidateData, slot, [...placedWithoutBlock, ...moved]),
        id: original.id
      });
      moved.push(normalized);
    }
    return moved;
  }

  async function improveAutoPlacement(placed = [], baseSlots = [], options = {}, progressUpdater = null) {
    const current = [...placed];
    const limit = options.runAttempts === "deep" ? 360 : (options.runAttempts === "fast" ? 90 : 190);
    let attempts = 0;
    let improved = 0;
    let bestScore = scoreScheduleQuality(current);

    const orderedSlots = [...baseSlots].sort((a, b) => {
      // 7교시를 무조건 금지하지는 않지만, 개선 후보에서는 앞쪽 교시를 먼저 검토합니다.
      if (a.period !== b.period) return a.period - b.period;
      return a.day - b.day;
    });

    for (let pass = 0; pass < 3 && attempts < limit; pass++) {
      let passImproved = false;
      const blocks = shuffle(getMovableBlocks(current));
      for (const block of blocks) {
        if (attempts >= limit) break;
        const origin = block.entries[0];
        const originSlotKey = `${origin.day}:${origin.period}`;
        const currentIds = new Set(block.entries.map(e => e.id));
        const baseWithout = current.filter(e => !currentIds.has(e.id));

        for (const slot of orderedSlots) {
          if (attempts >= limit) break;
          if (`${slot.day}:${slot.period}` === originSlotKey) continue;
          attempts++;

          const moved = makeMovedBlockEntries(block, slot, baseWithout);
          if (!moved) continue;
          const candidate = [...baseWithout, ...moved];
          const candScore = scoreScheduleQuality(candidate);
          if (candScore + 0.01 < bestScore) {
            current.length = 0;
            current.push(...candidate);
            bestScore = candScore;
            improved++;
            passImproved = true;
            break;
          }
        }
        if (progressUpdater && attempts % 35 === 0) {
          await progressUpdater({
            percent: 92,
            step: "자동배치 후처리",
            detail: `7교시 몰림, 같은 과목 몰림, 교사 공강을 줄이는 교환 후보를 검토하고 있습니다. 개선 ${improved}건`,
            placed: current.length,
            best: current.length,
            failed: 0,
            currentCard: "후처리"
          }, false);
        }
      }
      if (!passImproved) break;
    }

    return { placed: current, improvedCount: improved, attempts, qualityScore: Math.round(bestScore * 10) / 10 };
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

  function getCompoundKeyForCard(card) {
    const ref = compoundRefForCard(card);
    return ref?.key || "";
  }

  function getCardsForGroupOccurrence(cards = [], occurrenceIndex = 0) {
    const normalCards = [];
    const compoundBuckets = new Map();

    (cards || []).filter(Boolean).forEach(card => {
      const key = getCompoundKeyForCard(card);
      if (!key) {
        if (occurrenceIndex < Math.max(0, Number(getCreditsForTtCard(card)) || 0)) normalCards.push(card);
        return;
      }
      if (!compoundBuckets.has(key)) compoundBuckets.set(key, []);
      compoundBuckets.get(key).push(card);
    });

    const selectedCompoundCards = [];
    compoundBuckets.forEach(bucket => {
      const ordered = [...bucket].sort((a, b) => {
        const ai = Number.isInteger(a.compoundPartIndex) ? a.compoundPartIndex : 999;
        const bi = Number.isInteger(b.compoundPartIndex) ? b.compoundPartIndex : 999;
        if (ai !== bi) return ai - bi;
        return String(a.subject || a.id || "").localeCompare(String(b.subject || b.id || ""), "ko", { numeric: true });
      });
      const ranges = ordered.map(card => ({ card, credits: Math.max(0, Number(getCreditsForTtCard(card)) || 0) }))
        .filter(x => x.credits > 0);
      const total = ranges.reduce((sum, x) => sum + x.credits, 0);
      if (!total) return;
      let cursor = occurrenceIndex % total;
      for (const item of ranges) {
        if (cursor < item.credits) {
          selectedCompoundCards.push(item.card);
          return;
        }
        cursor -= item.credits;
      }
    });

    return [...normalCards, ...selectedCompoundCards];
  }

  function getGroupItemForOccurrence(groupItem = {}, occurrenceIndex = 0) {
    const filteredCards = getCardsForGroupOccurrence(groupItem.ttcards || [], occurrenceIndex);
    return { ...groupItem, ttcards: filteredCards };
  }

  function getGroupRoomBatches(group, cards = []) {
    const validCards = (cards || []).filter(Boolean);
    if (validCards.length <= 1) return validCards.length ? [validCards] : [];

    const units = group?.units || [];
    const usedCardIds = new Set();
    const batches = [];

    units.forEach(unit => {
      const ids = new Set(unit.ttcardIds || []);
      const unitCards = validCards.filter(card => ids.has(card.id));
      if (!unitCards.length) return;
      unitCards.forEach(card => usedCardIds.add(card.id));
      // 같은 수업 묶음(unit)은 하나의 배치로 유지합니다.
      batches.push(unitCards);
    });

    validCards.forEach(card => {
      if (usedCardIds.has(card.id)) return;
      // 같은 수업 묶음이 아닌 병렬 과목은 카드별로 분리합니다.
      batches.push([card]);
    });

    return batches;
  }

  function placeAutoGroupSlot(group, activeItems, slot, placed) {
    // Current group manager stores a visible group as one aggregate item.
    // 다만 같은 수업 묶음(unit)이 아닌 여러 과목은 과목별 entry로 분리해
    // 각 과목이 자신의 교사 담당교실/홈룸을 따로 받을 수 있게 합니다.
    const groupItem = activeItems[0];
    if (!groupItem) return false;

    const batches = getGroupRoomBatches(group, groupItem.ttcards || []);
    if (batches.length > 1) {
      let added = 0;
      batches.forEach(cards => {
        const item = makePlacementFromGroupItem(group, { ...groupItem, ttcards: cards });
        if (!item) return;
        placed.push(normalizeTimetableEntry({
          id: uid("ent"),
          ...applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed)
        }));
        added += 1;
      });
      return added > 0;
    }

    const item = makePlacementFromGroupItem(group, groupItem);
    if (!item) return false;
    placed.push(normalizeTimetableEntry({ id: uid("ent"), ...applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed) }));
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


  // ── Auto assignment option UI/helpers ──────────────────────────
  const AUTO_ASSIGN_DEFAULT_OPTIONS = {
    placementMode: "reset",   // reset | keep
    selectedGrades: [],
    keepPinned: true,
    keepManual: true,
    runAttempts: "balanced"    // fast | balanced | deep
  };

  function gradeSetFromList(list = []) {
    const set = new Set((list || []).filter(g => GRADE_KEYS.includes(g)));
    return set.size ? set : new Set(GRADE_KEYS);
  }

  function gradesForAutoItem(item = {}) {
    const set = new Set();
    const add = g => { if (g && GRADE_KEYS.includes(g)) set.add(g); };
    add(item.gradeKey);
    (item.gradeKeys || []).forEach(add);
    (item.ttcards || []).forEach(card => {
      add(card?.gradeKey);
      (card?.gradeKeys || []).forEach(add);
    });
    (item.ttcardIds || []).forEach(id => {
      const card = getTtCardById(id);
      add(card?.gradeKey);
      (card?.gradeKeys || []).forEach(add);
    });
    if (item.ttcardId) {
      const card = getTtCardById(item.ttcardId);
      add(card?.gradeKey);
      (card?.gradeKeys || []).forEach(add);
    }
    return set;
  }

  function gradesForGroupBlock(block = {}) {
    const set = new Set();
    (block.unitItems || []).forEach(item => gradesForAutoItem(item).forEach(g => set.add(g)));
    return set;
  }

  function intersectsGradeSet(itemGrades, selectedSet) {
    if (!selectedSet || selectedSet.size >= GRADE_KEYS.length) return true;
    for (const g of itemGrades || []) if (selectedSet.has(g)) return true;
    return false;
  }

  function filterAutoTargetsByGrades(standalone = [], groupBlocks = [], selectedGrades = []) {
    const selectedSet = gradeSetFromList(selectedGrades);
    if (selectedSet.size >= GRADE_KEYS.length) return { standalone, groupBlocks };
    return {
      standalone: standalone.filter(item => intersectsGradeSet(gradesForAutoItem(item), selectedSet)),
      // 그룹은 쪼개지 않고 그룹 단위로 유지합니다. 선택 학년이 하나라도 포함되면 전체 그룹을 함께 배치합니다.
      groupBlocks: groupBlocks.filter(block => intersectsGradeSet(gradesForGroupBlock(block), selectedSet))
    };
  }

  function entryGradeSet(entry = {}) {
    const set = new Set();
    const add = g => { if (g && GRADE_KEYS.includes(g)) set.add(g); };
    add(entry.gradeKey);
    (entry.gradeKeys || []).forEach(add);
    ttCardIdsFromPlacement(entry).forEach(id => {
      const card = getTtCardById(id);
      add(card?.gradeKey);
      (card?.gradeKeys || []).forEach(add);
    });
    return set;
  }

  function entryTouchesSelectedGrades(entry, selectedGrades = []) {
    const selectedSet = gradeSetFromList(selectedGrades);
    if (selectedSet.size >= GRADE_KEYS.length) return true;
    return intersectsGradeSet(entryGradeSet(entry), selectedSet);
  }

  function entryUsesManualCard(entry = {}) {
    if (entry.isManual) return true;
    return ttCardIdsFromPlacement(entry).some(id => getTtCardById(id)?.isManual);
  }

  function computeProtectedEntries(existingEntries = [], options = {}) {
    const selectedGrades = options.selectedGrades?.length ? options.selectedGrades : GRADE_KEYS;
    if (options.placementMode === "keep") return [...existingEntries];

    return (existingEntries || []).filter(entry => {
      const touches = entryTouchesSelectedGrades(entry, selectedGrades);
      if (!touches) return true;
      if (options.keepPinned !== false && entry.pinned) return true;
      if (options.keepManual !== false && entryUsesManualCard(entry)) return true;
      return false;
    });
  }

  function attemptsForMode(mode) {
    const value = String(mode || "balanced");
    if (value === "fast") return [18, 12, 6];
    if (value === "deep") return [54, 36, 16];
    return [30, 24, 10];
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[<>&"]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[ch]));
  }

  function openAutoAssignOptionsDialog(activeGrades = [], defaultOptions = {}) {
    const grades = activeGrades.length ? activeGrades : GRADE_KEYS;
    const defaults = { ...AUTO_ASSIGN_DEFAULT_OPTIONS, ...defaultOptions };
    return new Promise(resolve => {
      const old = document.getElementById("ttAutoAssignOptionsOverlay");
      old?.remove();
      const overlay = document.createElement("div");
      overlay.id = "ttAutoAssignOptionsOverlay";
      overlay.className = "tt-auto-options-overlay";
      overlay.innerHTML = `
        <div class="tt-auto-options-modal" role="dialog" aria-modal="true" aria-labelledby="ttAutoAssignOptionsTitle">
          <div class="tt-auto-options-head">
            <div>
              <p class="tt-auto-options-kicker">자동 배치 옵션</p>
              <h3 id="ttAutoAssignOptionsTitle">배치 범위와 보호 대상을 선택하세요</h3>
            </div>
            <button type="button" class="tt-auto-options-close" aria-label="닫기">×</button>
          </div>
          <div class="tt-auto-options-body">
            <section class="tt-auto-option-section">
              <h4>배치 방식</h4>
              <label class="tt-auto-radio-card">
                <input type="radio" name="ttAutoPlacementMode" value="reset" ${defaults.placementMode !== "keep" ? "checked" : ""}>
                <span><b>선택 범위 초기화 후 자동 배치</b><em>선택한 학년에 걸린 기존 배치를 지우고 다시 배치합니다.</em></span>
              </label>
              <label class="tt-auto-radio-card">
                <input type="radio" name="ttAutoPlacementMode" value="keep" ${defaults.placementMode === "keep" ? "checked" : ""}>
                <span><b>현재 배치 유지 + 미배치만 자동 배치</b><em>현재 시간표를 보호하고 부족한 카드만 추가로 찾습니다.</em></span>
              </label>
            </section>
            <section class="tt-auto-option-section">
              <div class="tt-auto-option-title-row">
                <h4>대상 학년</h4>
                <div class="tt-auto-option-mini-actions">
                  <button type="button" data-action="all-grades">전체</button>
                  <button type="button" data-action="clear-grades">해제</button>
                </div>
              </div>
              <div class="tt-auto-grade-grid">
                ${grades.map(g => `<label class="tt-auto-grade-chip"><input type="checkbox" value="${escapeHtml(g)}" ${(!defaults.selectedGrades?.length || defaults.selectedGrades.includes(g)) ? "checked" : ""}><span>${escapeHtml(gradeDisplay(g))}</span></label>`).join("")}
              </div>
              <p class="tt-auto-option-help">여러 학년에 걸친 그룹 수업은 선택 학년이 포함되면 그룹 전체가 함께 배치됩니다.</p>
            </section>
            <section class="tt-auto-option-section">
              <h4>보호 옵션</h4>
              <label class="tt-auto-check-line"><input type="checkbox" id="ttAutoKeepPinned" ${defaults.keepPinned !== false ? "checked" : ""}> <span>잠금/고정 카드 유지</span></label>
              <label class="tt-auto-check-line"><input type="checkbox" id="ttAutoKeepManual" ${defaults.keepManual !== false ? "checked" : ""}> <span>수동 생성 카드의 현재 배치 유지</span></label>
              <p class="tt-auto-option-help">현재 배치 유지 모드에서는 모든 기존 배치가 보호되므로 위 보호 옵션은 자동으로 적용됩니다.</p>
            </section>
            <section class="tt-auto-option-section">
              <h4>배치 강도</h4>
              <select id="ttAutoRunAttempts" class="tt-auto-select">
                <option value="fast" ${defaults.runAttempts === "fast" ? "selected" : ""}>빠른 배치</option>
                <option value="balanced" ${defaults.runAttempts !== "fast" && defaults.runAttempts !== "deep" ? "selected" : ""}>균형 배치</option>
                <option value="deep" ${defaults.runAttempts === "deep" ? "selected" : ""}>정교한 배치</option>
              </select>
            </section>
          </div>
          <div class="tt-auto-options-foot">
            <button type="button" class="tt-auto-options-cancel">취소</button>
            <button type="button" class="tt-auto-options-start">자동 배치 시작</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const close = (value) => { overlay.remove(); resolve(value); };
      overlay.querySelector(".tt-auto-options-close")?.addEventListener("click", () => close(null));
      overlay.querySelector(".tt-auto-options-cancel")?.addEventListener("click", () => close(null));
      overlay.addEventListener("click", e => { if (e.target === overlay) close(null); });
      overlay.querySelector('[data-action="all-grades"]')?.addEventListener("click", () => {
        overlay.querySelectorAll('.tt-auto-grade-chip input[type="checkbox"]').forEach(cb => { cb.checked = true; });
      });
      overlay.querySelector('[data-action="clear-grades"]')?.addEventListener("click", () => {
        overlay.querySelectorAll('.tt-auto-grade-chip input[type="checkbox"]').forEach(cb => { cb.checked = false; });
      });
      overlay.querySelector('.tt-auto-options-start')?.addEventListener("click", () => {
        const selectedGrades = [...overlay.querySelectorAll('.tt-auto-grade-chip input[type="checkbox"]:checked')].map(cb => cb.value);
        if (!selectedGrades.length) {
          alert("자동 배치할 학년을 하나 이상 선택해 주세요.");
          return;
        }
        const placementMode = overlay.querySelector('input[name="ttAutoPlacementMode"]:checked')?.value || "reset";
        close({
          placementMode,
          selectedGrades,
          keepPinned: overlay.querySelector("#ttAutoKeepPinned")?.checked !== false,
          keepManual: overlay.querySelector("#ttAutoKeepManual")?.checked !== false,
          runAttempts: overlay.querySelector("#ttAutoRunAttempts")?.value || "balanced"
        });
      });
    });
  }

  async function autoAssignAll() {
    if (!canEdit()) return;
    if (autoAssignRunning) { alert("자동 배치가 이미 진행 중입니다."); return; }

    // 커리큘럼/템플릿 실시간 의존성을 끊었기 때문에, 자동배치 대상도
    // appState.curriculum.gradeBoards가 아니라 시간표 사전작업에서 생성된
    // timetable.ttcards / timetable.ttcardGroups 스냅샷 기준으로 판단합니다.
    const rawItems = buildSchedulableItems();
    let standalone = (rawItems.standalone || []).map(annotateRestrictedAutoItem);
    let groupBlocks = (rawItems.groupBlocks || []).map(annotateRestrictedGroupBlock);
    const availableGrades = getActiveGradesFromScheduleItems(standalone, groupBlocks);

    if (!availableGrades.length || (!standalone.length && !groupBlocks.length)) {
      alert("시간표 사전작업에서 생성된 과목 카드가 없습니다.\n먼저 시간표 사전작업에서 카드를 생성하거나, 로컬 모드 전환 시 온라인 데이터를 복사해 주세요.");
      return;
    }

    const options = await openAutoAssignOptionsDialog(availableGrades, AUTO_ASSIGN_DEFAULT_OPTIONS);
    if (!options) return;

    ({ standalone, groupBlocks } = filterAutoTargetsByGrades(standalone, groupBlocks, options.selectedGrades));
    const activeGrades = getActiveGradesFromScheduleItems(standalone, groupBlocks);
    const protectedEntries = computeProtectedEntries(entries(), options);
    const willClearCount = Math.max(0, entries().length - protectedEntries.length);
    const restrictedStandaloneCount = standalone.filter(item => item.hasRestrictedTeacher).length;
    const restrictedGroupCount = groupBlocks.filter(block => block.hasRestrictedTeacher).length;
    const restrictedTeacherNames = [...new Set([
      ...standalone.flatMap(item => item.restrictedTeachers || []),
      ...groupBlocks.flatMap(block => block.restrictedTeachers || [])
    ])];
    const groupTargetSlots = groupBlocks.reduce((sum, { group, unitItems }) => {
      const credits = (unitItems || []).map(u => Math.max(0, Number(u?.credits) || 0));
      const isConcurrent = group?.isConcurrent || group?.groupType === "concurrent";
      return sum + (isConcurrent ? Math.max(0, ...credits) : credits.reduce((a, b) => a + b, 0));
    }, 0);
    const autoTargetSlots = standalone.length + groupTargetSlots;
    const autoItemCount = autoTargetSlots;

    if (!autoItemCount || !activeGrades.length) {
      alert("선택한 학년에 자동 배치할 과목 카드가 없습니다.");
      return;
    }

    const modeText = options.placementMode === "keep" ? "현재 배치 유지 + 미배치만 배치" : "선택 범위 초기화 후 배치";
    const confirmText = [
      `자동 배치를 시작합니다.`,
      `대상: ${activeGrades.map(gradeDisplay).join(", ")}`,
      `방식: ${modeText}`,
      options.placementMode === "reset" ? `초기화 대상 배치: ${willClearCount}개` : `보호되는 기존 배치: ${protectedEntries.length}개`,
      `잠금 카드 유지: ${options.keepPinned !== false ? "예" : "아니오"}`,
      `수동 카드 유지: ${options.keepManual !== false ? "예" : "아니오"}`,
      "",
      "계속할까요?"
    ].join("\n");
    if (!confirm(confirmText)) return;

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

    // Preserve entries according to the selected auto-assign options.
    // - reset: selected range is cleared, but locked/manual/out-of-range entries can be protected.
    // - keep: all current entries stay as protected entries and only missing cards are added.
    const pinnedEntries = [...protectedEntries];
    ttDomain().entries = [...protectedEntries];
    await updateProgress({
      percent: 6,
      step: options.placementMode === "keep" ? "기존 배치 유지" : "보호 수업 유지",
      detail: options.placementMode === "keep"
        ? `기존 배치 ${protectedEntries.length}개를 유지하고 미배치 대상만 준비합니다.`
        : `보호된 배치 ${protectedEntries.length}개를 유지하고 ${willClearCount}개 배치를 초기화했습니다.`,
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
      detail: `일반 카드 ${standalone.length}개, 그룹 ${groupBlocks.length}개를 분석했습니다. 제약근무 교사 대상: 일반 ${restrictedStandaloneCount}개, 그룹 ${restrictedGroupCount}개.`,
      log: restrictedTeacherNames.length
        ? `고정 수업 다음 우선 배치: ${restrictedTeacherNames.join(", ")}`
        : "그룹 수업은 동시배정 단위로 계산합니다."
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

    const attemptPlan = attemptsForMode(options.runAttempts);
    const stages = [
      { name:"strict", label:"교사 제약 포함", attempts:attemptPlan[0], options:{ respectSoftLimits:true,  respectUnavailable:true,  respectAssignedRoom:true } },
      { name:"relaxedSoft", label:"일일/연속 제한 완화", attempts:attemptPlan[1], options:{ respectSoftLimits:false, respectUnavailable:true,  respectAssignedRoom:true } },
      { name:"relaxedUnavailable", label:"불가시간 완화 · 교실 유지", attempts:attemptPlan[2], options:{ respectSoftLimits:false, respectUnavailable:false, respectAssignedRoom:true } },
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

        // ── Sort schedulable units by priority ───────────────────────
        // 1) 고정 수업은 위에서 이미 pinnedEntries로 보호
        // 2) 제약근무 교사 포함 수업은 일반 그룹/일반 카드보다 먼저 배치
        // 3) 같은 우선순위 안에서는 "후보 시간이 적은 수업"을 먼저 배치합니다.
        const candidateCountCache = new Map();
        const candidateCountForItem = (item) => {
          if (!item) return 9999;
          const key = `${autoItemKey(item)}::${stage.name}`;
          if (candidateCountCache.has(key)) return candidateCountCache.get(key);
          let count = 0;
          for (const slot of baseSlots) {
            if (checkPlacementValid(item, slot, placed, stage.options)) count += 1;
          }
          candidateCountCache.set(key, count);
          return count;
        };
        const candidateCountForGroupBlock = (block) => {
          const group = block?.group;
          const unitItems = block?.unitItems || [];
          if (!group || !unitItems.length) return 9999;
          const cacheKey = `group:${group.id || group.name || "?"}::${stage.name}`;
          if (candidateCountCache.has(cacheKey)) return candidateCountCache.get(cacheKey);
          let minCount = 9999;
          const maxCredits = Math.max(0, ...unitItems.map(u => Math.max(0, Number(u.credits) || 0)));
          const samples = Math.max(1, Math.min(maxCredits || 1, 5));
          for (let occurrence = 0; occurrence < samples; occurrence++) {
            const activeItems = unitItems
              .filter(u => occurrence < (Number(u.credits) || 0))
              .map(u => getGroupItemForOccurrence(u, occurrence))
              .filter(u => (u.ttcards || []).length);
            if (!activeItems.length) continue;
            const probeCards = activeItems.flatMap(u => u.ttcards || []);
            const probeItem = makePlacementFromGroupItem(group, { ttcards: probeCards });
            const probe = probeItem ? annotateRestrictedAutoItem(probeItem) : null;
            if (!probe) continue;
            minCount = Math.min(minCount, candidateCountForItem(probe));
          }
          candidateCountCache.set(cacheKey, minCount);
          return minCount;
        };

        const orderedGroups = shuffle([...groupBlocks]).sort((a, b) => {
          const ac = Math.max(0, ...a.unitItems.map(u => Math.max(0, Number(u.credits) || 0)));
          const bc = Math.max(0, ...b.unitItems.map(u => Math.max(0, Number(u.credits) || 0)));
          const ap = comparePriority(a, b);
          if (ap !== 0) return ap;
          const art = (b.restrictedTeachers || []).length - (a.restrictedTeachers || []).length;
          if (art !== 0) return art;
          const acand = candidateCountForGroupBlock(a);
          const bcand = candidateCountForGroupBlock(b);
          if (acand !== bcand) return acand - bcand;
          return bc - ac;
        });

        const orderedKeys = shuffle([...requiredByKey.keys()]).sort((a, b) => {
          const ia = itemByKey.get(a);
          const ib = itemByKey.get(b);
          const ap = comparePriority(ia, ib);
          if (ap !== 0) return ap;
          const art = (ib?.restrictedTeachers || []).length - (ia?.restrictedTeachers || []).length;
          if (art !== 0) return art;
          const acand = candidateCountForItem(ia);
          const bcand = candidateCountForItem(ib);
          if (acand !== bcand) return acand - bcand;
          return getAutoItemDifficulty(ib) - getAutoItemDifficulty(ia);
        });
        const restrictedGroupBlocks = orderedGroups.filter(block => block.hasRestrictedTeacher);
        const normalGroupBlocks = orderedGroups.filter(block => !block.hasRestrictedTeacher);
        const restrictedKeys = orderedKeys.filter(key => itemByKey.get(key)?.hasRestrictedTeacher);
        const normalKeys = orderedKeys.filter(key => !itemByKey.get(key)?.hasRestrictedTeacher);
        const placedByKey = new Map();

        const placeGroups = async (blocks, phaseLabel) => {
          // ── Place concurrent groups first: one independent occurrence per 시수 ──
          for (const { group, unitItems, restrictedTeachers = [] } of blocks) {
            if (!(group.isConcurrent || group.groupType === "concurrent")) continue;
            const maxCredits = Math.max(0, ...(unitItems || []).map(u => Math.max(0, Number(u.credits) || 0)));
            const alreadyPinned = countPinnedGroupSlots(group, unitItems, pinnedEntries);
            const needSlots = Math.max(0, maxCredits - alreadyPinned);

            for (let slot_i = 0; slot_i < needSlots; slot_i++) {
              await yieldAutoAssign({
                percent: stagePercent,
                step: `${phaseLabel} · ${stage.label}`,
                detail: `${group.name || "그룹"} ${slot_i + 1} / ${needSlots}회차를 배치하고 있습니다.${restrictedTeachers.length ? ` (${describeRestrictedTeachers(restrictedTeachers)})` : ""}`,
                placed: placed.length,
                best: Math.max(0, bestScore),
                failed: failed.length,
                currentCard: group.name || "그룹 수업"
              });
              const activeItems = unitItems
                .filter(u => slot_i < u.credits)
                .map(u => getGroupItemForOccurrence(u, slot_i))
                .filter(u => (u.ttcards || []).length);
              if (!activeItems.length) continue;
              // 동시배정 그룹은 한 회차에 여러 과목/교사가 함께 움직일 수 있으므로,
              // 첫 카드만으로 후보 시간을 검사하면 제약교사 조건을 놓칠 수 있습니다.
              // 해당 회차의 모든 활성 카드를 합친 probe로 교사·학생·교실 제약을 함께 검사합니다.
              const probeCards = activeItems.flatMap(u => u.ttcards || []);
              const probeItem = makePlacementFromGroupItem(group, { ttcards: probeCards });
              const probe = probeItem ? annotateRestrictedAutoItem(probeItem) : null;
              const foundSlot = probe ? findBestAutoSlot(probe, baseSlots, placed, stage.options) : null;
              if (foundSlot && placeAutoGroupSlot(group, activeItems, foundSlot, placed)) {
                continue;
              }
              activeItems.forEach(groupItem => {
                const item = makePlacementFromGroupItem(group, groupItem);
                failed.push(makeFailedPlacement(`${group.name} - ${groupItem.name || "그룹 카드"}`, item ? annotateRestrictedAutoItem(item) : item, { groupId: group.id }));
              });
            }
          }

          // ── Place non-concurrent groups independently (legacy safety) ─────────
          for (const { group, unitItems, restrictedTeachers = [] } of blocks) {
            if (group.isConcurrent || group.groupType === "concurrent") continue;
            for (const groupItem of unitItems) {
              const pinnedSlots = countPinnedGroupSlots(group, [groupItem], pinnedEntries);
              const needSlots = Math.max(0, groupItem.credits - pinnedSlots);
              for (let i = 0; i < needSlots; i++) {
                await yieldAutoAssign({
                  percent: stagePercent,
                  step: `${phaseLabel} · ${stage.label}`,
                  detail: `${group.name || "그룹"} - ${groupItem.name || "그룹 카드"} 배치 중${restrictedTeachers.length ? ` (${describeRestrictedTeachers(restrictedTeachers)})` : ""}`,
                  placed: placed.length,
                  best: Math.max(0, bestScore),
                  failed: failed.length,
                  currentCard: `${group.name || "그룹"} - ${groupItem.name || "그룹 카드"}`
                });
                const occurrenceGroupItem = getGroupItemForOccurrence(groupItem, i);
                if (!(occurrenceGroupItem.ttcards || []).length) continue;
                const item = makePlacementFromGroupItem(group, occurrenceGroupItem);
                const checkedItem = item ? annotateRestrictedAutoItem(item) : null;
                const slot = checkedItem ? findBestAutoSlot(checkedItem, baseSlots, placed, stage.options) : null;
                if (slot) {
                  const entry = makeAutoEntry(checkedItem, slot, placed);
                  if (entry) placed.push(entry);
                } else {
                  failed.push(makeFailedPlacement(`${group.name} - ${groupItem.name || "그룹 카드"}`, checkedItem, { groupId: group.id }));
                }
              }
            }
          }
        };

        const placeStandaloneKeys = async (keys, phaseLabel) => {
          for (const key of keys) {
            const item = itemByKey.get(key);
            const required = requiredByKey.get(key) || 0;
            const pinned = pinnedByKey.get(key) || 0;
            while (pinned + (placedByKey.get(key) || 0) < required) {
              await yieldAutoAssign({
                percent: stagePercent,
                step: `${phaseLabel} · ${stage.label}`,
                detail: `${getAutoItemName(item)} 배치 위치를 찾고 있습니다.${item?.hasRestrictedTeacher ? ` (${describeRestrictedTeachers(item.restrictedTeachers)})` : ""}`,
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
              const entry = makeAutoEntry(item, slot, placed);
              if (entry) placed.push(entry);
              placedByKey.set(key, (placedByKey.get(key) || 0) + 1);
            }
          }
        };

        // 고정 수업 다음: 제약근무 교사 포함 수업을 먼저 배치합니다.
        await placeGroups(restrictedGroupBlocks, "제약교사 그룹 우선 배치");
        await placeStandaloneKeys(restrictedKeys, "제약교사 일반 카드 우선 배치");
        await placeGroups(normalGroupBlocks, "그룹 수업 배치");
        await placeStandaloneKeys(normalKeys, "일반 카드 배치");

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
    // Greedy 자동배치가 끝까지 못 넣은 카드는 보정 배치를 시도합니다.
    // 단, 보호 슬롯·동일 카드 중복·교사 중복·학생/학급 중복·교실 중복은 만들지 않습니다.
    // 배치 가능한 안전 슬롯이 없으면 무리하게 겹쳐 넣지 않고 미배치로 남깁니다.
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
      const entry = slot ? makeAutoEntry(item, slot, bestPlaced) : null;
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
      percent: 91,
      step: "자동배치 후처리",
      detail: "배치된 수업을 안전하게 재배치해 7교시 몰림, 같은 과목 몰림, 교사 공강을 줄입니다.",
      placed: bestPlaced.length,
      best: bestPlaced.length,
      failed: bestFailed.length,
      currentCard: "후처리",
      log: "자동배치 후처리 단계 시작"
    }, true);

    const improvement = await improveAutoPlacement(bestPlaced, baseSlots, options, updateProgress);
    bestPlaced = improvement.placed;

    const failedDiagnostics = buildFailureDiagnostics(bestFailed, baseSlots, bestPlaced, bestStage?.options || stages[0].options);

    await updateProgress({
      percent: 96,
      step: "결과 반영",
      detail: improvement.improvedCount
        ? `후처리 개선 ${improvement.improvedCount}건을 반영하고 충돌을 재계산합니다.`
        : "배치 결과를 시간표에 반영하고 충돌을 재계산합니다.",
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
    const missingRoomEntries = bestPlaced.filter(e => !e.roomId && String(e.roomRule || "auto").trim() !== "none");
    const missingRoomNames = [...new Set(missingRoomEntries.map(e => getAutoItemName(e)))];
    const conflictSummary = getConflictCounts();
    const report = {
      ts: Date.now(),
      activeGrades: activeGrades.map(gradeDisplay).join(", "),
      stageName: bestStage.name,
      stageLabel: bestStage.label,
      totalTarget: autoTargetSlots,
      pinnedCount: pinnedEntries.filter(e => e.pinned).length,
      protectedCount: protectedEntries.length,
      clearedCount: willClearCount,
      placementMode: options.placementMode,
      placementModeLabel: modeText,
      selectedGrades: activeGrades.map(gradeDisplay).join(", "),
      runAttempts: options.runAttempts,
      keepPinned: options.keepPinned !== false,
      keepManual: options.keepManual !== false,
      placedCount: bestPlaced.length,
      forcedCount: forcedPlaced.length,
      postProcessImprovedCount: improvement.improvedCount,
      postProcessAttempts: improvement.attempts,
      postProcessQualityScore: improvement.qualityScore,
      failedCount: names.length,
      failedNames: names,
      failedDiagnostics,
      failedReasonSummary: failedDiagnostics.slice(0, 8).map(d => `${d.name}: ${d.summary}`),
      forcedNames: [...new Set(forcedPlaced.map(f => f.name))],
      durationMs: Date.now() - autoStartedAt,
      conflictTotal: conflictSummary.totalAffected,
      conflictCounts: conflictSummary.counts,
      missingRoomCount: missingRoomEntries.length,
      missingRoomNames,
      restrictedTeacherCount: restrictedTeacherNames.length,
      restrictedTeacherNames,
      restrictedStandaloneCount,
      restrictedGroupCount
    };
    setLastAutoAssignReport(report);
    addTimetableLog(
      "auto",
      names.length ? "자동 배치 부분 완료" : "자동 배치 완료",
      `정상 배치 ${bestPlaced.length - forcedPlaced.length}개, 보정 배치 ${forcedPlaced.length}개, 후처리 개선 ${improvement.improvedCount}건, 미배치 ${names.length}개, 교실 미배정 ${missingRoomEntries.length}개, 충돌 ${conflictSummary.totalAffected}건 · ${modeText} · 탐색: ${bestStage.label}`
    );
    if (missingRoomEntries.length) {
      addTimetableLog(
        "warn",
        "교실 미배정 수업 확인 필요",
        `${missingRoomNames.slice(0, 12).join(", ")}${missingRoomNames.length > 12 ? ` 외 ${missingRoomNames.length - 12}개` : ""}`
      );
    }
    renderAll();

    const detailLines = [
      `<b>정상 배치</b> ${bestPlaced.length - forcedPlaced.length}개`,
      `<b>보정 배치</b> ${forcedPlaced.length}개`,
      `<b>후처리 개선</b> ${improvement.improvedCount}건`,
      `<b>미배치</b> ${names.length}개`,
      `<b>교실 미배정</b> ${missingRoomEntries.length}개`,
      `<b>충돌 표시 대상</b> ${conflictSummary.totalAffected}건`,
      `<b>배치 방식</b> ${modeText}`,
      `<b>탐색 방식</b> ${bestStage.label}`,
      `<b>보호된 기존 배치</b> ${protectedEntries.length}개`,
      restrictedTeacherNames.length ? `<b>제약교사 우선 배치</b> ${restrictedTeacherNames.join(", ")} · 일반 ${restrictedStandaloneCount}개 / 그룹 ${restrictedGroupCount}개` : null,
      `<b>소요 시간</b> ${Math.round((Date.now() - autoStartedAt) / 1000)}초`
    ];
    if (forcedPlaced.length) {
      detailLines.push(`⚠️ ${forcedPlaced.length}개는 미배치 방지를 위해 최소 충돌 위치에 보정 배치했습니다. 충돌 색상과 상세창을 확인해 주세요.`);
    }
    if (missingRoomEntries.length) {
      const missingList = missingRoomNames.slice(0, 12)
        .map(name => `<li>${String(name).replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]))}</li>`)
        .join("");
      const moreMissing = missingRoomNames.length > 12 ? `<li>외 ${missingRoomNames.length - 12}개</li>` : "";
      detailLines.push(`<div class="tt-auto-progress-failed"><b>교실 미배정</b><ul>${missingList}${moreMissing}</ul></div>`);
    }
    if (names.length) {
      const failedList = names.slice(0, 12)
        .map(name => `<li>${String(name).replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]))}</li>`)
        .join("");
      const moreFailed = names.length > 12 ? `<li>외 ${names.length - 12}개</li>` : "";
      detailLines.push(`<div class="tt-auto-progress-failed"><b>남은 카드</b><ul>${failedList}${moreFailed}</ul></div>`);
      detailLines.push(diagnosticsToHtml(failedDiagnostics, 8));
      detailLines.push(`남은 카드는 아래 원인 후보를 우선 확인해 주세요. 제약교사 조건, 반/학생 충돌, 교실 충돌, 고정 슬롯이 주요 원인일 수 있습니다.`);
    }
    detailLines.push(`자세한 결과는 하단 <b>로그</b> 탭에서 확인할 수 있습니다.`);

    await progress.complete({
      partial: !!names.length,
      title: names.length ? "자동배치 부분 완료" : "자동배치 완료",
      subtitle: names.length ? "일부 카드는 직접 확인이 필요합니다." : "모든 대상 슬롯을 배치했습니다.",
      step: names.length ? "부분 완료" : "완료",
      detailHtml: detailLines.filter(Boolean).map(line => `<div>${line}</div>`).join(""),
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
