// ================================================================
// timetable-autoassign.js · Auto Assignment Engine
// ================================================================
// This module keeps the auto-placement algorithm separate from the
// timetable page renderer. Dependencies are injected from timetable.js
// so the engine can still use the current app state, UI callbacks, and
// shared occupancy logic without creating circular imports.

export function createAutoAssignAll(deps) {
  const {
    GRADE_KEYS, canEdit, appState, scheduleSave, saveNow, normalizeTimetableEntry,
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

  async function persistTimetableNow() {
    if (typeof saveNow === "function") {
      await saveNow("timetable", { force: true });
      return;
    }
    scheduleSave("timetable", { immediate: true, saveOptions: { force: true } });
  }

  // 자동배치 전/후 배치를 자동으로 보관해 비교와 복구가 쉽도록 합니다.
  // 커리큘럼/카드/교사조건은 저장하지 않고, 배치 entries만 savedSchedules에 넣습니다.
  function formatAutoSnapshotTime(date = new Date()) {
    const pad = n => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function normalizeSnapshotEntries(list = []) {
    return (list || []).map(entry => {
      const cloned = cloneAutoAssignData(entry || {});
      return typeof normalizeTimetableEntry === "function"
        ? normalizeTimetableEntry(cloned)
        : cloned;
    }).filter(entry => entry && (entry.templateId || entry.ttcardId || (entry.ttcardIds || []).length));
  }

  function saveAutoAssignScheduleSnapshot(kind, sourceEntries = [], meta = {}) {
    const snapshotEntries = normalizeSnapshotEntries(sourceEntries);
    if (!snapshotEntries.length) return null;

    const domain = ttDomain();
    if (!Array.isArray(domain.savedSchedules)) domain.savedSchedules = [];

    const now = new Date();
    const modeLabel = meta.modeText || (meta.options?.placementMode === "keep" ? "현재 배치 유지" : "초기화 후 배치");
    const grades = (meta.activeGrades || []).map(g => typeof gradeDisplay === "function" ? gradeDisplay(g) : g).filter(Boolean).join(", ");
    const label = kind === "before" ? "자동배치 전" : "자동배치 결과";
    const version = {
      id: uid(`ttv_auto_${kind}`),
      name: `${label} ${formatAutoSnapshotTime(now)}`,
      note: [
        "자동 생성된 배치 보관본입니다.",
        grades ? `대상: ${grades}` : "",
        modeLabel ? `방식: ${modeLabel}` : "",
        meta.validationSummary ? `검증: ${meta.validationSummary}` : ""
      ].filter(Boolean).join(" / "),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      periodCount: Math.max(1, Number(ttConfig()?.periodCount || 7)),
      entryCount: snapshotEntries.length,
      autoSnapshot: true,
      snapshotKind: kind,
      source: "autoassign",
      entries: snapshotEntries,
    };

    // 자동 스냅샷이 너무 많이 쌓이지 않도록 최근 12개만 유지하고, 전체 보관본은 30개로 제한합니다.
    const existing = domain.savedSchedules || [];
    const autoSnapshots = existing.filter(v => v?.autoSnapshot === true);
    const keepAutoIds = new Set(autoSnapshots.slice(0, 11).map(v => v.id));
    domain.savedSchedules = [version, ...existing.filter(v => v?.autoSnapshot !== true || keepAutoIds.has(v.id))].slice(0, 30);
    return version;
  }

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

  // ── Auto-assign scoring preferences ────────────────────────────
  // 자동배치 품질 기준은 학교 운영 상황에 따라 달라지므로, 옵션 팝업에서
  // 필요한 항목만 중요도를 조절할 수 있도록 숫자 가중치로 통일합니다.
  const DEFAULT_SCORE_WEIGHTS = Object.freeze({
    teacherGap: 2,          // 교사 공강 최소화
    sameSubjectDay: 2,      // 같은 과목 하루 반복 회피
    teacherConsecutive: 2,  // 교사 연속수업 부담
    classConsecutive: 1     // 학급 연속수업 부담
  });

  const SCORE_PRESETS = Object.freeze({
    balanced:        { teacherGap:2, sameSubjectDay:2, teacherConsecutive:2, classConsecutive:1 },
    teacherFriendly: { teacherGap:3, sameSubjectDay:1, teacherConsecutive:3, classConsecutive:1 },
    studentFriendly: { teacherGap:1, sameSubjectDay:3, teacherConsecutive:1, classConsecutive:3 }
  });

  function clampWeight(value, fallback = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(3, Math.round(n)));
  }

  function normalizeScoreWeights(weights = {}) {
    const src = { ...DEFAULT_SCORE_WEIGHTS, ...(weights || {}) };
    return {
      teacherGap: clampWeight(src.teacherGap, DEFAULT_SCORE_WEIGHTS.teacherGap),
      sameSubjectDay: clampWeight(src.sameSubjectDay, DEFAULT_SCORE_WEIGHTS.sameSubjectDay),
      teacherConsecutive: clampWeight(src.teacherConsecutive, DEFAULT_SCORE_WEIGHTS.teacherConsecutive),
      classConsecutive: clampWeight(src.classConsecutive, DEFAULT_SCORE_WEIGHTS.classConsecutive),
    };
  }

  function scoreOptionsFromAssignOptions(options = {}) {
    return normalizeScoreWeights(options.scoringWeights || options.scoreWeights || DEFAULT_SCORE_WEIGHTS);
  }

  function describeScoreWeights(weights = {}) {
    const w = normalizeScoreWeights(weights);
    const label = n => ["끔", "낮음", "보통", "높음"][clampWeight(n, 0)] || "보통";
    return `교사공강 ${label(w.teacherGap)} · 과목몰림 ${label(w.sameSubjectDay)} · 교사연속 ${label(w.teacherConsecutive)} · 학급연속 ${label(w.classConsecutive)}`;
  }


  function cloneAutoAssignData(value) {
    try { return structuredClone(value); }
    catch (_) {
      try { return JSON.parse(JSON.stringify(value ?? null)); }
      catch (e) { return Array.isArray(value) ? [...value] : value; }
    }
  }

  const safeAutoHtml = value => String(value ?? "").replace(/[<>&"]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[ch]));


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

  function teacherGapCountAfterAdding(teacher, existing = [], day, period) {
    const periods = getTeacherDayPeriods(teacher, existing, day);
    if (!periods.includes(period)) periods.push(period);
    const unique = [...new Set(periods)].sort((a, b) => a - b);
    if (unique.length <= 1) return 0;
    const span = unique[unique.length - 1] - unique[0] + 1;
    return Math.max(0, span - unique.length);
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


  function isTeacherUnavailable(teacher, day, period) {
    const name = String(teacher || "").trim();
    if (!name) return false;
    const c = constraints()?.[name] || {};
    const slots = Array.isArray(c.unavailableSlots) ? c.unavailableSlots : [];
    const d = Number(day);
    const p = Number(period);
    return slots.some(slot => Number(slot?.day) === d && Number(slot?.period) === p);
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

  function getRoomByIdLocal(roomId) {
    if (!roomId) return null;
    return (appState.rooms?.rooms || []).find(r => r.id === roomId) || null;
  }

  function isRoomUnavailable(roomId, day, period) {
    const room = getRoomByIdLocal(roomId);
    const slots = Array.isArray(room?.unavailableSlots) ? room.unavailableSlots : [];
    const d = Number(day);
    const p = Number(period);
    return slots.some(slot => Number(slot?.day) === d && Number(slot?.period) === p);
  }

  function roomUnavailableInSlot(candidate = {}, slot = {}) {
    const roomId = candidate.roomId;
    if (!roomId) return false;
    return isRoomUnavailable(roomId, slot.day, slot.period);
  }


  // ── Fixed/protected slot helpers ───────────────────────────────
  // 자동배치에서는 entries()에 남겨 둔 항목이 곧 보호 대상입니다.
  // 고정 수업·현재 배치 유지 모드·선택 학년 밖 수업·수동 카드가 여기에 들어갑니다.
  // 일반 충돌 검사보다 앞에서 보호 슬롯을 강하게 제외해야, 채플/자율/동아리처럼
  // 학생명단이 비어 있거나 교사가 없는 수업도 다른 수업 후보 시간으로 잡히지 않습니다.
  function protectedEntriesInSlot(day, period) {
    return entries().filter(e => e && e.day === day && e.period === period);
  }

  function setOverlaps(a = new Set(), b = new Set()) {
    for (const v of a || []) if ((b || new Set()).has(v)) return true;
    return false;
  }

  function teacherNamesForPlacement(x = {}) {
    return [...new Set([
      ...splitTeacherNames(x.teacherName || ""),
      ...(Array.isArray(x.teachers) ? x.teachers : []),
      ...getTeacherNamesFromCards((ttCardIdsFromPlacement(x) || []).map(id => getTtCardById(id)).filter(Boolean))
    ].map(t => String(t || "").trim()).filter(Boolean))];
  }

  function slotLabelForProtected(day, period) {
    return formatSlotLabel({ day, period });
  }

  function strongProtectedSlotConflict(candidate = {}, slot = {}, placed = []) {
    if (!Number.isInteger(slot.day) || !Number.isInteger(slot.period)) return null;
    const fixedEntries = protectedEntriesInSlot(slot.day, slot.period);
    if (!fixedEntries.length) return null;

    const candidateWithSlot = { ...candidate, ...slot };
    const candidateAudience = audienceForPlacement(candidateWithSlot);
    const candidateTeachers = teacherNamesForPlacement(candidateWithSlot);
    const candidateTeacherSet = new Set(candidateTeachers);
    const candidateRoomData = applyAutoRoomToEntryData(candidateWithSlot, slot, placed);

    const protectedBlock = protectedSlotConflict?.(candidateWithSlot, slot.day, slot.period, { placed });
    if (protectedBlock?.entry) {
      return {
        code: "protectedWholeGrade",
        label: "고정 전체수업 시간",
        detail: `${slotLabelForProtected(slot.day, slot.period)} · ${getAutoItemName(protectedBlock.entry)}`,
        entry: protectedBlock.entry
      };
    }

    for (const fixed of fixedEntries) {
      if (!fixed || (candidateWithSlot.id && fixed.id === candidateWithSlot.id)) continue;
      if (sameUnitPlacement(candidateWithSlot, fixed)) continue;

      const fixedAudience = audienceForPlacement(fixed);
      if (audiencesConflict(candidateAudience, fixedAudience)) {
        return {
          code: "protectedAudience",
          label: "고정 수업 학급 충돌",
          detail: `${slotLabelForProtected(slot.day, slot.period)} · ${getAutoItemName(fixed)}`,
          entry: fixed
        };
      }

      const fixedTeachers = teacherNamesForPlacement(fixed);
      if (candidateTeacherSet.size && fixedTeachers.some(t => candidateTeacherSet.has(t))) {
        return {
          code: "protectedTeacher",
          label: "고정 수업 교사 충돌",
          detail: `${slotLabelForProtected(slot.day, slot.period)} · ${fixedTeachers.filter(t => candidateTeacherSet.has(t)).join(", ")}`,
          entry: fixed
        };
      }

      const fixedRoomIds = new Set([fixed.roomId, ...(fixed.roomIds || [])].filter(Boolean));
      if (candidateRoomData.roomId && fixedRoomIds.has(candidateRoomData.roomId)) {
        const roomName = (appState.rooms?.rooms || []).find(r => r.id === candidateRoomData.roomId)?.name || candidateRoomData.roomId;
        return {
          code: "protectedRoom",
          label: "고정 수업 교실 충돌",
          detail: `${slotLabelForProtected(slot.day, slot.period)} · ${roomName}`,
          entry: fixed
        };
      }
    }
    return null;
  }

  function protectedSlotSummary(protectedEntries = []) {
    const slots = new Set();
    let pinned = 0;
    let manual = 0;
    (protectedEntries || []).forEach(e => {
      if (Number.isInteger(e.day) && Number.isInteger(e.period)) slots.add(`${e.day}:${e.period}`);
      if (e.pinned) pinned += 1;
      if (entryUsesManualCard(e)) manual += 1;
    });
    return { slots: slots.size, pinned, manual, total: protectedEntries.length };
  }



  // ── Auto-assign verification report helpers ────────────────────
  // 자동배치 전/후 검증은 "카드 개수"가 아니라 실제 시간표의 학급별 점유 슬롯을 기준으로 봅니다.
  function normalizeGradeNumber(value = "") {
    const m = String(value || "").match(/\d{1,2}/);
    return m ? String(Number(m[0])) : "";
  }

  function normalizeClassSection(value = "", fallbackIdx = 0) {
    const raw = String(value || "").trim();
    if (raw) return raw.replace(/\s+/g, "").replace(/학년/g, "").replace(/^\d{1,2}/, "").toUpperCase();
    return sectionLabel(fallbackIdx);
  }

  function makeClassKeyForReport(gradeKey, section, sectionIdx = 0) {
    const grade = normalizeGradeNumber(gradeKey);
    const sec = normalizeClassSection(section, sectionIdx);
    return grade && sec ? `${grade}:${sec}` : "";
  }

  function formatClassKeyForReport(key = "") {
    const [grade, section] = String(key || "").split(":");
    return grade && section ? `${grade}${section}` : (key || "?");
  }

  function getReportClassRows(scopeGrades = []) {
    const scope = new Set((scopeGrades || []).map(g => String(g || "").trim()).filter(Boolean));
    return (appState.classes?.classes || [])
      .map((cls, idx) => {
        const gradeKey = cls.grade || cls.gradeKey || "";
        const section = cls.name || cls.section || sectionLabel(cls.sectionIdx ?? idx);
        const key = makeClassKeyForReport(gradeKey, section, cls.sectionIdx ?? idx);
        return { key, label: formatClassKeyForReport(key), gradeKey, section };
      })
      .filter(row => row.key && (!scope.size || scope.has(row.gradeKey)))
      .sort((a, b) => {
        const ga = Number(normalizeGradeNumber(a.gradeKey)) || 0;
        const gb = Number(normalizeGradeNumber(b.gradeKey)) || 0;
        if (ga !== gb) return ga - gb;
        return String(a.section || "").localeCompare(String(b.section || ""), "ko", { numeric: true });
      });
  }

  function classKeysFromAudienceForReport(entry = {}) {
    const audience = audienceForPlacement(entry);
    return [...(audience?.classKeys || new Set())]
      .map(k => {
        const raw = String(k || "").trim();
        if (!raw) return "";
        if (raw.includes(":")) {
          const [g, s] = raw.split(":");
          return makeClassKeyForReport(g, s);
        }
        const m = raw.replace(/\s+/g, "").replace(/학년/g, "").match(/^(\d{1,2})(.+)$/);
        return m ? makeClassKeyForReport(m[1], m[2]) : raw;
      })
      .filter(Boolean);
  }

  function buildClassSlotValidation(allEntries = [], scopeGrades = []) {
    const targetPerClass = Math.max(0, (parseInt(ttConfig().periodCount, 10) || 7) * 5);
    const classRows = getReportClassRows(scopeGrades);
    const slotMap = new Map(classRows.map(row => [row.key, new Set()]));
    const contributionMap = new Map(classRows.map(row => [row.key, []]));

    (allEntries || []).forEach(entry => {
      if (!Number.isInteger(entry?.day) || !Number.isInteger(entry?.period)) return;
      const slotKey = `${entry.day}:${entry.period}`;
      classKeysFromAudienceForReport(entry).forEach(key => {
        if (!slotMap.has(key)) return;
        const slots = slotMap.get(key);
        const before = slots.size;
        slots.add(slotKey);
        if (slots.size !== before) {
          const list = contributionMap.get(key) || [];
          if (list.length < 8) list.push(`${formatSlotLabel(entry)} · ${getAutoItemName(entry)}`);
          contributionMap.set(key, list);
        }
      });
    });

    const rows = classRows.map(row => {
      const count = slotMap.get(row.key)?.size || 0;
      const diff = count - targetPerClass;
      return {
        ...row,
        count,
        target: targetPerClass,
        diff,
        status: diff === 0 ? "ok" : (diff < 0 ? "short" : "over"),
        samples: contributionMap.get(row.key) || []
      };
    });
    const issues = rows.filter(row => row.diff !== 0);
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const targetTotal = rows.length * targetPerClass;
    return {
      targetPerClass,
      targetTotal,
      total,
      diff: total - targetTotal,
      ok: issues.length === 0,
      issueCount: issues.length,
      rows,
      issues,
      summary: issues.length
        ? `${rows.length}개 학급 중 ${issues.length}개 학급 시수 불일치 · 현재 ${total}/${targetTotal}시수`
        : `${rows.length}개 학급 모두 ${targetPerClass}시수 충족 · 현재 ${total}/${targetTotal}시수`
    };
  }

  function teacherUnavailableSetForReport(teacher) {
    const c = constraints()?.[teacher] || {};
    return new Set((Array.isArray(c.unavailableSlots) ? c.unavailableSlots : [])
      .map(slot => `${slot.day}:${slot.period}`));
  }

  function teacherSlotsForReport(teacher, allEntries = []) {
    const slots = new Set();
    const byDay = new Map();
    const unavailable = teacherUnavailableSetForReport(teacher);
    const unavailableHits = [];
    (allEntries || []).forEach(entry => {
      if (!Number.isInteger(entry?.day) || !Number.isInteger(entry?.period)) return;
      if (!teacherEntryHasTeacher(entry, teacher)) return;
      const key = `${entry.day}:${entry.period}`;
      slots.add(key);
      if (!byDay.has(entry.day)) byDay.set(entry.day, new Set());
      byDay.get(entry.day).add(entry.period);
      if (unavailable.has(key) && unavailableHits.length < 5) {
        unavailableHits.push(`${formatSlotLabel(entry)} · ${getAutoItemName(entry)}`);
      }
    });
    return { slots, byDay, unavailableHits };
  }

  function maxConsecutiveFromPeriods(periods = []) {
    const list = [...periods].map(Number).filter(Number.isInteger).sort((a, b) => a - b);
    let max = list.length ? 1 : 0;
    let cur = list.length ? 1 : 0;
    for (let i = 1; i < list.length; i++) {
      cur = list[i] === list[i - 1] + 1 ? cur + 1 : 1;
      max = Math.max(max, cur);
    }
    return max;
  }

  function buildRestrictedTeacherValidation(allEntries = []) {
    const teacherNames = Object.keys(constraints() || {}).filter(isRestrictedTeacher).sort((a, b) => a.localeCompare(b, "ko"));
    const rows = teacherNames.map(teacher => {
      const c = constraints()?.[teacher] || {};
      const { slots, byDay, unavailableHits } = teacherSlotsForReport(teacher, allEntries);
      const maxPerWeek = Number(c.maxPerWeek) || 0;
      const maxPerDay = Number(c.maxPerDay) || 0;
      const maxConsecutive = Number(c.maxConsecutive) || 0;
      const dayLoads = [...byDay.entries()].map(([day, set]) => ({ day, count: set.size, maxConsecutive: maxConsecutiveFromPeriods(set) }));
      const dayOver = maxPerDay > 0 ? dayLoads.filter(d => d.count > maxPerDay) : [];
      const consecutiveOver = maxConsecutive > 0 ? dayLoads.filter(d => d.maxConsecutive > maxConsecutive) : [];
      const weekOver = maxPerWeek > 0 && slots.size > maxPerWeek;
      const issueParts = [];
      if (unavailableHits.length) issueParts.push(`불가시간 ${unavailableHits.length}건`);
      if (weekOver) issueParts.push(`주 최대 ${slots.size}/${maxPerWeek}`);
      if (dayOver.length) issueParts.push(`하루 최대 초과 ${dayOver.length}일`);
      if (consecutiveOver.length) issueParts.push(`연속수업 초과 ${consecutiveOver.length}일`);
      return {
        teacher,
        workType: c.workType || "restricted",
        total: slots.size,
        maxPerWeek,
        maxPerDay,
        maxConsecutive,
        dayLoads,
        unavailableHits,
        issueParts,
        ok: issueParts.length === 0
      };
    });
    const issues = rows.filter(row => !row.ok);
    return {
      totalTeachers: rows.length,
      issueCount: issues.length,
      rows,
      issues,
      ok: issues.length === 0,
      summary: rows.length
        ? (issues.length ? `제약교사 ${rows.length}명 중 ${issues.length}명 조건 확인 필요` : `제약교사 ${rows.length}명 조건 충족`)
        : "등록된 제약교사가 없습니다."
    };
  }

  function buildProtectedIntrusionValidation(allEntries = [], protectedEntries = []) {
    const protectedIds = new Set((protectedEntries || []).map(e => e.id).filter(Boolean));
    if (!protectedIds.size) return { total: 0, samples: [], ok: true, summary: "보호 수업 없음" };
    const protectedBySlot = new Map();
    (protectedEntries || []).forEach(e => {
      if (!Number.isInteger(e?.day) || !Number.isInteger(e?.period)) return;
      const key = `${e.day}:${e.period}`;
      if (!protectedBySlot.has(key)) protectedBySlot.set(key, []);
      protectedBySlot.get(key).push(e);
    });
    const samples = [];
    (allEntries || []).forEach(entry => {
      if (!entry?.id || protectedIds.has(entry.id)) return;
      if (!Number.isInteger(entry.day) || !Number.isInteger(entry.period)) return;
      const fixedList = protectedBySlot.get(`${entry.day}:${entry.period}`) || [];
      if (!fixedList.length) return;
      const entryAudience = audienceForPlacement(entry);
      const entryTeachers = new Set(teacherNamesForPlacement(entry));
      const entryRoom = entry.roomId || "";
      for (const fixed of fixedList) {
        if (sameUnitPlacement(entry, fixed)) continue;
        const fixedAudience = audienceForPlacement(fixed);
        const fixedTeachers = teacherNamesForPlacement(fixed);
        const fixedRooms = new Set([fixed.roomId, ...(fixed.roomIds || [])].filter(Boolean));
        const hitAudience = audiencesConflict(entryAudience, fixedAudience);
        const hitTeacher = fixedTeachers.some(t => entryTeachers.has(t));
        const hitRoom = entryRoom && fixedRooms.has(entryRoom);
        if (hitAudience || hitTeacher || hitRoom) {
          if (samples.length < 8) samples.push(`${formatSlotLabel(entry)} · ${getAutoItemName(entry)} ↔ ${getAutoItemName(fixed)}`);
          break;
        }
      }
    });
    return {
      total: samples.length,
      samples,
      ok: samples.length === 0,
      summary: samples.length ? `고정/보호 수업 침범 후보 ${samples.length}건` : "고정/보호 수업 침범 없음"
    };
  }

  function buildScheduleVerificationReport(allEntries = [], options = {}) {
    const classSlots = buildClassSlotValidation(allEntries, options.scopeGrades || []);
    const restrictedTeachers = buildRestrictedTeacherValidation(allEntries);
    const protectedIntrusions = buildProtectedIntrusionValidation(allEntries, options.protectedEntries || []);
    const failedCount = Array.isArray(options.failedNames) ? options.failedNames.length : 0;
    const missingRooms = (allEntries || []).filter(e => !e.roomId && String(e.roomRule || "auto").trim() !== "none");
    const ok = classSlots.ok && restrictedTeachers.ok && protectedIntrusions.ok && failedCount === 0 && missingRooms.length === 0;
    const issueParts = [];
    if (!classSlots.ok) issueParts.push(`학급 시수 ${classSlots.issueCount}개`);
    if (!restrictedTeachers.ok) issueParts.push(`제약교사 ${restrictedTeachers.issueCount}명`);
    if (!protectedIntrusions.ok) issueParts.push(`고정침범 ${protectedIntrusions.total}건`);
    if (missingRooms.length) issueParts.push(`교실미배정 ${missingRooms.length}개`);
    if (failedCount) issueParts.push(`미배치 ${failedCount}개`);
    return {
      ts: Date.now(),
      ok,
      summary: ok ? "검증 통과" : `검증 필요: ${issueParts.join(" · ")}`,
      classSlots,
      restrictedTeachers,
      protectedIntrusions,
      missingRoomCount: missingRooms.length,
      missingRoomNames: [...new Set(missingRooms.map(e => getAutoItemName(e)))].slice(0, 20),
      failedCount,
      failedNames: options.failedNames || [],
      failedDiagnostics: options.failedDiagnostics || []
    };
  }


  function summarizeAutoAssignOutcome({ placedEntries = [], failedItems = [], forcedEntries = [], protectedEntries = [], missingRoomEntries = [] } = {}) {
    const normalize = value => String(value ?? "").trim();
    const placedCardIds = new Set();
    const placedBlocks = new Map();
    const groupBlocks = new Map();
    const standaloneBlocks = new Map();
    const forcedIds = new Set((forcedEntries || []).map(e => e?.id).filter(Boolean));

    const blockKeyForEntry = entry => {
      if (!entry) return "";
      if (entry.groupId) return `group:${entry.groupId}:${entry.day}:${entry.period}`;
      const ids = ttCardIdsFromPlacement(entry).filter(Boolean).sort().join(",");
      if (ids) return `cards:${ids}:${entry.day}:${entry.period}`;
      const tpl = (entry.templateIds || [entry.templateId]).filter(Boolean).sort().join(",");
      return `entry:${tpl || entry.id || getAutoItemName(entry)}:${entry.day}:${entry.period}`;
    };

    const labelForEntry = entry => {
      if (!entry) return "-";
      if (entry.groupId) {
        const groupName = ttGroups().find(g => g.id === entry.groupId)?.name || entry.groupName || entry.label || "그룹 수업";
        return groupName;
      }
      return getAutoItemName(entry);
    };

    (placedEntries || []).forEach(entry => {
      ttCardIdsFromPlacement(entry).forEach(id => id && placedCardIds.add(id));
      const key = blockKeyForEntry(entry);
      if (!key) return;
      if (!placedBlocks.has(key)) {
        const block = {
          key,
          name: labelForEntry(entry),
          groupId: entry.groupId || "",
          day: entry.day,
          period: entry.period,
          entries: 0,
          cardIds: new Set(),
          forced: false,
          missingRoom: false
        };
        placedBlocks.set(key, block);
        if (entry.groupId) groupBlocks.set(key, block);
        else standaloneBlocks.set(key, block);
      }
      const block = placedBlocks.get(key);
      block.entries += 1;
      block.forced = block.forced || forcedIds.has(entry.id);
      block.missingRoom = block.missingRoom || (!entry.roomId && String(entry.roomRule || "auto").trim() !== "none");
      ttCardIdsFromPlacement(entry).forEach(id => id && block.cardIds.add(id));
    });

    const failedUnitMap = new Map();
    (failedItems || []).forEach(fail => {
      const item = fail?.item || {};
      const ids = ttCardIdsFromPlacement(item).filter(Boolean).sort();
      const key = fail?.groupId
        ? `group:${fail.groupId}:${normalize(fail.name || getAutoItemName(item))}`
        : (ids.length ? `cards:${ids.join(",")}` : `name:${normalize(fail?.name || getAutoItemName(item))}`);
      if (!failedUnitMap.has(key)) {
        failedUnitMap.set(key, {
          key,
          name: fail?.name || getAutoItemName(item),
          groupId: fail?.groupId || item.groupId || "",
          occurrences: 0,
          cardIds: new Set(),
          teachers: new Set(),
          restrictedTeachers: new Set()
        });
      }
      const row = failedUnitMap.get(key);
      row.occurrences += 1;
      ids.forEach(id => row.cardIds.add(id));
      getTeachersForAutoItem(item).forEach(t => row.teachers.add(t));
      (item.restrictedTeachers || getRestrictedTeachersForAutoItem(item)).forEach(t => row.restrictedTeachers.add(t));
    });

    const failedUnits = [...failedUnitMap.values()].map(row => ({
      ...row,
      cardIds: [...row.cardIds],
      teachers: [...row.teachers],
      restrictedTeachers: [...row.restrictedTeachers]
    })).sort((a, b) => b.occurrences - a.occurrences || String(a.name).localeCompare(String(b.name), "ko"));

    const missingRoomBlockCount = [...placedBlocks.values()].filter(b => b.missingRoom).length;
    const forcedBlockCount = [...placedBlocks.values()].filter(b => b.forced).length;
    const protectedBlockKeys = new Set((protectedEntries || []).map(blockKeyForEntry).filter(Boolean));

    return {
      placedEntryCount: placedEntries.length,
      placedBlockCount: placedBlocks.size,
      placedCardCount: placedCardIds.size,
      placedGroupBlockCount: groupBlocks.size,
      placedStandaloneBlockCount: standaloneBlocks.size,
      protectedEntryCount: protectedEntries.length,
      protectedBlockCount: protectedBlockKeys.size,
      forcedEntryCount: forcedEntries.length,
      forcedBlockCount,
      missingRoomEntryCount: missingRoomEntries.length,
      missingRoomBlockCount,
      failedOccurrenceCount: failedItems.length,
      failedUnitCount: failedUnits.length,
      failedUnits,
      topFailedUnits: failedUnits.slice(0, 12).map(row => ({
        name: row.name,
        occurrences: row.occurrences,
        cardCount: row.cardIds.length,
        teachers: row.teachers,
        restrictedTeachers: row.restrictedTeachers
      }))
    };
  }

  function buildAutoAssignOutcomeHtml(outcome = {}) {
    const failedUnits = Array.isArray(outcome.topFailedUnits) ? outcome.topFailedUnits : [];
    const failedHtml = failedUnits.length
      ? `<ul class="tt-auto-outcome-list">${failedUnits.map(row => {
          const teacherText = row.teachers?.length ? ` · ${escapeReportHtml(row.teachers.join(", "))}` : "";
          const restricted = row.restrictedTeachers?.length ? ` <span class="tt-auto-outcome-badge warn">제약교사</span>` : "";
          return `<li><b>${escapeReportHtml(row.name)}</b><span>${Number(row.occurrences || 0)}회차 · 카드 ${Number(row.cardCount || 0)}개${teacherText}</span>${restricted}</li>`;
        }).join("")}</ul>`
      : `<div class="tt-auto-compare-ok">미배치 수업 유닛이 없습니다.</div>`;

    return `<div class="tt-auto-progress-failed tt-auto-outcome-box">`
      + `<b>자동배치 결과 분석</b>`
      + `<div class="tt-auto-outcome-grid">`
      + `<span><em>신규 배치</em><strong>${Number(outcome.placedEntryCount || 0)}</strong><small>entry</small></span>`
      + `<span><em>수업 블록</em><strong>${Number(outcome.placedBlockCount || 0)}</strong><small>unit</small></span>`
      + `<span><em>그룹 블록</em><strong>${Number(outcome.placedGroupBlockCount || 0)}</strong><small>unit</small></span>`
      + `<span><em>일반 블록</em><strong>${Number(outcome.placedStandaloneBlockCount || 0)}</strong><small>unit</small></span>`
      + `<span><em>배치 카드</em><strong>${Number(outcome.placedCardCount || 0)}</strong><small>card</small></span>`
      + `<span class="${outcome.failedUnitCount ? "warn" : "ok"}"><em>미배치 유닛</em><strong>${Number(outcome.failedUnitCount || 0)}</strong><small>${Number(outcome.failedOccurrenceCount || 0)}회차</small></span>`
      + `</div>`
      + `<div class="tt-auto-outcome-note">카드 수가 아니라 같은 시간에 함께 움직이는 <b>수업 블록/유닛</b> 기준으로 자동배치 결과를 해석합니다.</div>`
      + (outcome.forcedEntryCount ? `<div class="tt-auto-outcome-note warn">보정 배치 ${Number(outcome.forcedEntryCount || 0)}개 entry / ${Number(outcome.forcedBlockCount || 0)}개 블록이 있습니다. 충돌 표시를 확인해 주세요.</div>` : "")
      + (outcome.missingRoomEntryCount ? `<div class="tt-auto-outcome-note warn">교실 미배정 ${Number(outcome.missingRoomEntryCount || 0)}개 entry / ${Number(outcome.missingRoomBlockCount || 0)}개 블록이 있습니다.</div>` : "")
      + `<div class="tt-auto-outcome-failed"><b>남은 수업 유닛</b>${failedHtml}</div>`
      + `</div>`;
  }

  function escapeReportHtml(value = "") {
    return String(value ?? "").replace(/[<>&"']/g, ch => ({
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "\"": "&quot;",
      "'": "&#39;"
    }[ch] || ch));
  }

  function makeDeltaText(before, after, suffix = "") {
    const b = Number(before) || 0;
    const a = Number(after) || 0;
    const d = a - b;
    if (d === 0) return `<span class="tt-auto-compare-same">변화 없음</span>`;
    const sign = d > 0 ? "+" : "";
    const cls = d > 0 ? "tt-auto-compare-up" : "tt-auto-compare-down";
    return `<span class="${cls}">${sign}${d}${suffix}</span>`;
  }

  function compareMetricRow(label, before, after, suffix = "") {
    return `<tr>`
      + `<th>${escapeReportHtml(label)}</th>`
      + `<td>${escapeReportHtml(before)}${suffix}</td>`
      + `<td>${escapeReportHtml(after)}${suffix}</td>`
      + `<td>${makeDeltaText(before, after, suffix)}</td>`
      + `</tr>`;
  }

  function buildAutoAssignComparisonHtml(preReport = {}, postReport = {}) {
    // 11단계에서 결과 비교표 호출부가 먼저 들어가고, 함수 정의가 누락되어
    // ReferenceError가 발생했습니다. 비교표는 UI 보조 기능이므로 항상 안전하게
    // HTML을 반환하도록 방어적으로 작성합니다.
    try {
      const preClass = preReport.classSlots || {};
      const postClass = postReport.classSlots || {};
      const preRestricted = preReport.restrictedTeachers || {};
      const postRestricted = postReport.restrictedTeachers || {};
      const preProtected = preReport.protectedIntrusions || {};
      const postProtected = postReport.protectedIntrusions || {};
      const rows = [
        compareMetricRow("학급 시수 합계", preClass.total ?? 0, postClass.total ?? 0, "시수"),
        compareMetricRow("시수 불일치 학급", preClass.issueCount ?? 0, postClass.issueCount ?? 0, "개"),
        compareMetricRow("제약교사 위반", preRestricted.issueCount ?? 0, postRestricted.issueCount ?? 0, "명"),
        compareMetricRow("고정/보호 침범", preProtected.total ?? 0, postProtected.total ?? 0, "건"),
        compareMetricRow("교실 미배정", preReport.missingRoomCount ?? 0, postReport.missingRoomCount ?? 0, "개"),
        compareMetricRow("미배치 카드", preReport.failedCount ?? 0, postReport.failedCount ?? 0, "개")
      ].join("");

      const classIssues = (postClass.issues || []).slice(0, 8);
      const issueList = classIssues.length
        ? `<ul>${classIssues.map(row => `<li>${escapeReportHtml(formatClassKeyForReport(row.key))}: ${escapeReportHtml(row.count)}/${escapeReportHtml(row.target)}시수 (${row.diff < 0 ? `${Math.abs(row.diff)} 부족` : `${row.diff} 초과`})</li>`).join("")}${(postClass.issues || []).length > 8 ? `<li>외 ${(postClass.issues || []).length - 8}개 학급</li>` : ""}</ul>`
        : `<div class="tt-auto-compare-ok">학급별 기준 시수를 모두 충족했습니다.</div>`;

      return `<div class="tt-auto-progress-failed tt-auto-compare-box">`
        + `<b>자동배치 전/후 비교</b>`
        + `<table class="tt-auto-compare-table"><thead><tr><th>항목</th><th>이전</th><th>이후</th><th>변화</th></tr></thead><tbody>${rows}</tbody></table>`
        + `<div class="tt-auto-compare-summary"><b>이후 상태</b>: ${escapeReportHtml(postReport.summary || "-")}</div>`
        + issueList
        + `</div>`;
    } catch (err) {
      console.warn("Failed to build auto assign comparison html:", err);
      return `<div class="tt-auto-progress-failed"><b>자동배치 전/후 비교</b><br>비교표 생성 중 오류가 있었지만 자동배치 결과는 반영되었습니다.</div>`;
    }
  }


  function getRoomCapacity(room = {}) {
    const n = Number(room.capacity);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function getAudienceSizeForRoom(data = {}) {
    // 학생 개인 key는 시간표 배치 단계에서 사용하지 않습니다.
    // 교실 후보 정렬에서도 학생 수 기반 보정보다 교사 담당교실/홈룸/고정교실 규칙을 우선합니다.
    return 0;
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

    // 기본 추천 교실이 있고 해당 시간에 비어 있으며 사용 가능 시간이면 그대로 사용합니다.
    if (entryData.roomId && !roomUnavailableInSlot(entryData, slot) && !roomConflictsInSlot(entryData, slot, placed)) return entryData;

    // 기본 추천 교실이 없거나 이미 사용 중이면, 해당 시간에 비어 있는 교실을 자동 보조 배정합니다.
    for (const room of sortRoomCandidatesFor(entryData)) {
      if (!room.id || room.id === entryData.roomId) continue;
      const test = { ...entryData, roomId: room.id };
      if (!roomUnavailableInSlot(test, slot) && !roomConflictsInSlot(test, slot, placed)) return test;
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

    const strongProtected = strongProtectedSlotConflict(item, slot, placed);
    if (strongProtected) {
      addReason(reasons, strongProtected.code || "protectedSlot", strongProtected.label || "고정/보호 수업 시간", strongProtected.detail || `${formatSlotLabel(slot)} 보호 슬롯`);
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
      // 같은 동시배정 그룹은 사전작업에서 한 수업묶음으로 확정한 병렬 수업입니다.
      // 학생 개인 단위 비교는 여기서 하지 않고, 같은 그룹이 아닌 경우에만 학급 중복을 막습니다.
      if (conc) continue;
      const eAudience = audienceForPlacement(e);
      const conflict = audiencesConflict(itemAudience, eAudience);
      if (conflict) addReason(reasons, "studentConflict", "학급 시간 충돌", `${formatSlotLabel(slot)} · ${getAutoItemName(e)}`);
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
    if (respectAssignedRoom && roomUnavailableInSlot(candidateRoomData, slot)) {
      const roomName = getRoomByIdLocal(candidateRoomData.roomId)?.name || candidateRoomData.roomId || "교실";
      addReason(reasons, "roomUnavailable", "교실 불가시간", `${formatSlotLabel(slot)} · ${roomName}`);
    }
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

  function reasonCodesFromResult(result) {
    return new Set((result?.reasons || []).map(r => r.code || r.label).filter(Boolean));
  }

  function countSlotsIfIgnoringReasons(item, baseSlots = [], placed = [], options = {}, ignoredCodes = []) {
    const ignore = new Set(ignoredCodes || []);
    let count = 0;
    for (const slot of baseSlots) {
      const result = analyzePlacementSlot(item, slot, placed, options);
      if (result.valid) {
        count += 1;
        continue;
      }
      const codes = reasonCodesFromResult(result);
      if (codes.size && [...codes].every(code => ignore.has(code))) count += 1;
    }
    return count;
  }

  function buildRelaxationSuggestions(diag = {}, item, baseSlots = [], placed = [], options = {}) {
    if (!item) return [];
    const topReasonCodes = new Set((diag.topReasons || []).map(r => r.code || r.label).filter(Boolean));
    const teacherNames = getTeachersForAutoItem(item);
    const restrictedTeachers = getRestrictedTeachersForAutoItem(item);
    const teacherText = restrictedTeachers.length ? restrictedTeachers.join(', ') : teacherNames.join(', ');
    const currentValid = Number(diag.validSlots || 0);

    const candidates = [
      {
        codes: ['teacherUnavailable'],
        title: '교사 불가시간 일부 조정',
        detail: `${teacherText || '담당 교사'}의 불가시간 중 실제로 열 수 있는 1~2칸을 가능 시간으로 바꾸면 배치 여지가 생길 수 있습니다.`,
        priority: 1
      },
      {
        codes: ['teacherWeekLimit'],
        title: '교사 주 최대시수 상향',
        detail: `${teacherText || '담당 교사'}의 주 최대시수를 1~2시수 높이거나 해당 수업을 다른 교사에게 분산하는 방안입니다.`,
        priority: 1
      },
      {
        codes: ['teacherDayLimit'],
        title: '교사 하루 최대시수 완화',
        detail: `${teacherText || '담당 교사'}의 특정 요일 하루 최대시수를 1시수 늘리거나 다른 요일로 고정 수업을 이동해 보세요.`,
        priority: 1
      },
      {
        codes: ['teacherConsecutive'],
        title: '교사 연속수업 제한 완화',
        detail: `${teacherText || '담당 교사'}의 최대 연속수업 제한을 1교시 완화하거나 앞뒤 수업 중 하나를 다른 시간으로 이동하는 방안입니다.`,
        priority: 1
      },
      {
        codes: ['roomConflict', 'teacherRoomBusy'],
        title: '교실 조건 완화',
        detail: '고정 교실을 해제하거나 대체 교실을 추가하면 배치 가능한 시간이 늘어날 수 있습니다.',
        priority: 2
      },
      {
        codes: ['protectedSlot'],
        title: '고정/보호 수업 일부 해제',
        detail: '해당 학급·교사·교실을 막고 있는 고정 수업 1개를 이동하거나 잠금 해제 후 다시 자동배치해 보세요.',
        priority: 3
      },
      {
        codes: ['studentConflict'],
        title: '학급 충돌 수업 이동',
        detail: '같은 반이 이미 점유한 시간 때문에 막힌 경우입니다. 해당 시간대의 기존 수업을 먼저 이동하면 해결될 수 있습니다.',
        priority: 3
      },
      {
        codes: ['groupExclusion'],
        title: '그룹 제외 카드 설정 확인',
        detail: '자동 그룹에서 제외된 카드가 같은 시간에 배치되며 충돌합니다. 그룹 포함/제외 설정을 다시 확인해 주세요.',
        priority: 2
      },
      {
        codes: ['compoundSibling', 'compoundInternal'],
        title: '복합과목 파트 배치 방식 조정',
        detail: '복합과목의 파트가 같은 시간에 겹치지 않도록 파트별 고정 시간을 나누거나 수동 배치 후 고정해 주세요.',
        priority: 2
      },
      {
        codes: ['duplicate'],
        title: '중복 카드 정리',
        detail: '같은 카드가 이미 같은 시간에 배치되어 있습니다. 카드 데이터 갱신 또는 중복 배치 삭제 후 다시 시도해 주세요.',
        priority: 1
      },
      {
        codes: ['teacherUnavailable', 'teacherWeekLimit', 'teacherDayLimit', 'teacherConsecutive'],
        title: '교사 제약 조건 전체 재검토',
        detail: `${teacherText || '담당 교사'}의 가능시간·주 최대·하루 최대·연속수업 제한을 함께 조정해야 할 가능성이 큽니다.`,
        priority: 4
      },
      {
        codes: ['protectedSlot', 'studentConflict'],
        title: '고정 수업과 학급 충돌 함께 조정',
        detail: '고정된 채플·자율·동아리 또는 기존 수업이 학급 슬롯을 막고 있습니다. 고정 수업 1개를 옮긴 뒤 미배치만 자동배치해 보세요.',
        priority: 5
      }
    ];

    const suggestions = [];
    for (const cand of candidates) {
      if (!cand.codes.some(code => topReasonCodes.has(code))) continue;
      const availableAfter = countSlotsIfIgnoringReasons(item, baseSlots, placed, options, cand.codes);
      if (availableAfter <= currentValid) continue;
      suggestions.push({
        ...cand,
        availableAfter,
        gain: availableAfter - currentValid,
        summary: `${cand.title}: ${availableAfter}칸 가능`
      });
    }

    if (!suggestions.length && currentValid > 0) {
      suggestions.push({
        codes: ['searchOrder'],
        title: '배치 강도 상향',
        detail: '가능한 후보 시간이 남아 있습니다. 자동배치 옵션에서 정교한 배치 또는 현재 배치 유지 + 미배치만 배치를 다시 실행해 보세요.',
        availableAfter: currentValid,
        gain: 0,
        priority: 9,
        summary: `배치 강도 상향: 후보 ${currentValid}칸`
      });
    }

    if (!suggestions.length) {
      suggestions.push({
        codes: ['manualReview'],
        title: '수동 고정 후 재시도',
        detail: '단일 조건 완화만으로는 후보 시간이 열리지 않습니다. 관련 교사/학급의 수업 1~2개를 수동 이동·고정한 뒤 미배치만 자동배치해 주세요.',
        availableAfter: 0,
        gain: 0,
        priority: 10,
        summary: '수동 고정 후 재시도'
      });
    }

    return suggestions
      .sort((a, b) => a.priority - b.priority || b.gain - a.gain || b.availableAfter - a.availableAfter)
      .slice(0, 3);
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
    const diag = {
      name,
      groupName: failedItem?.groupId ? (ttGroups().find(g => g.id === failedItem.groupId)?.name || "") : "",
      teachers,
      restrictedTeachers,
      validSlots,
      totalSlots: baseSlots.length,
      topReasons,
      summary: `가능 ${validSlots}/${baseSlots.length}칸 · ${reasonText}`
    };
    diag.suggestions = buildRelaxationSuggestions(diag, item, baseSlots, placed, options);
    diag.suggestionSummary = (diag.suggestions || []).map(s => s.summary || s.title).join(' / ');
    return diag;
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
      const mergedSuggestions = new Map((acc.suggestions || []).map(s => [s.title, s]));
      (diag.suggestions || []).forEach(sug => {
        if (!mergedSuggestions.has(sug.title)) mergedSuggestions.set(sug.title, sug);
        else {
          const cur = mergedSuggestions.get(sug.title);
          cur.availableAfter = Math.max(Number(cur.availableAfter || 0), Number(sug.availableAfter || 0));
          cur.gain = Math.max(Number(cur.gain || 0), Number(sug.gain || 0));
          cur.summary = `${cur.title}: ${cur.availableAfter}칸 가능`;
        }
      });
      acc.suggestions = [...mergedSuggestions.values()]
        .sort((a, b) => Number(a.priority || 9) - Number(b.priority || 9) || Number(b.gain || 0) - Number(a.gain || 0) || Number(b.availableAfter || 0) - Number(a.availableAfter || 0))
        .slice(0, 3);
      acc.suggestionSummary = (acc.suggestions || []).map(s => s.summary || s.title).join(' / ');
    });
    return [...byName.values()].sort((a, b) => a.validSlots - b.validSlots || b.occurrences - a.occurrences || String(a.name).localeCompare(String(b.name), "ko"));
  }

  function diagnosticsToHtml(diagnostics = [], limit = 8) {
    if (!diagnostics.length) return "";
    const esc = s => String(s ?? "").replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]));
    return `<div class="tt-auto-progress-failed"><b>미배치 원인 후보와 완화 제안</b><ul>${diagnostics.slice(0, limit).map(d => {
      const reason = d.topReasons?.[0];
      const sample = reason?.samples?.[0] ? ` · 예: ${reason.samples[0]}` : "";
      const teacher = d.restrictedTeachers?.length ? ` · 제약교사: ${d.restrictedTeachers.join(", ")}` : "";
      const suggestionHtml = Array.isArray(d.suggestions) && d.suggestions.length
        ? `<div class="tt-auto-relax-suggestions"><b>풀어볼 조건</b><ol>${d.suggestions.slice(0, 3).map(s => `<li><span>${esc(s.title)}</span><em>${esc(s.detail)}${Number(s.availableAfter || 0) ? ` · 완화 시 ${Number(s.availableAfter || 0)}칸 가능` : ""}</em></li>`).join("")}</ol></div>`
        : "";
      return `<li>${esc(d.name)}${d.occurrences > 1 ? ` ×${d.occurrences}` : ""} — ${esc(d.summary)}${esc(teacher)}${esc(sample)}${suggestionHtml}</li>`;
    }).join("")}${diagnostics.length > limit ? `<li>외 ${diagnostics.length - limit}개</li>` : ""}</ul></div>`;
  }

  function checkPlacementValid(item, slot, placed, options = {}) {
    const { respectSoftLimits = true, respectUnavailable = true, respectAssignedRoom = true } = options;
    const existing = [...entries(), ...placed];
    const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
    const teachers  = splitTeacherNames(item.teacherName).filter(Boolean);

    // 0. Pinned/fixed/protected entries protect their slot first.
    // entries() contains protected entries during auto assignment.
    // This stronger check blocks not only whole-grade activities but also manually fixed
    // class/teacher/room slots before we spend time scoring candidates.
    if (strongProtectedSlotConflict(item, slot, placed)) return false;

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

    // 3. Class conflict.
    // 학생 개인 단위는 사전작업/그룹묶음에서 처리합니다.
    // 자동배치에서는 같은 동시배정 그룹이 아닌 한, 같은 학급이 같은 시간에 두 과목을 갖지 않도록 막습니다.
    const itemAudience = audienceForPlacement(item);
    for (const e of slotEnts) {
      // Same unit → co-located intentionally
      if (item.unitId && e.unitId && item.unitId === e.unitId) continue;

      const sameGrp = sameActiveGroup(item, e);
      const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);
      if (conc) continue;

      const eAudience = audienceForPlacement(e);
      const conflict = audiencesConflict(itemAudience, eAudience);
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
    if (respectAssignedRoom && roomUnavailableInSlot(candidateRoomData, slot)) return false;
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

  function normalizeSubjectTextForScoring(x = {}) {
    const parts = [
      x.subject, x.name, x.title, x.nameKo, x.nameEn, x.groupName,
      x.templateId ? getTemplateCardTitle(getTemplateById(x.templateId)) : ""
    ];
    ttCardIdsFromPlacement(x).forEach(id => {
      const card = getTtCardById(id);
      if (card) parts.push(card.subject, card.name, card.title, card.nameKo, card.nameEn, describeTtCard(card).title);
    });
    return parts.map(v => String(v || "")).join(" ").toLowerCase();
  }

  function isMajorSubjectForScoring(x = {}) {
    const text = normalizeSubjectTextForScoring(x);
    return /국어|한국어|korean|영어|english|수학|math|algebra|calculus|geometry|statistics|과학|science|physics|chemistry|biology|사회|history|social/.test(text);
  }

  function getAutoItemDifficulty(item) {
    const audience = audienceForPlacement(item);
    const teacherCount = splitTeacherNames(item.teacherName).filter(Boolean).length;
    return teacherCount * 20 + audience.classKeys.size * 8;
  }

  function scoreAutoSlot(item, slot, placed, checkOptions = {}) {
    const existing = [...entries(), ...placed];
    const weights = normalizeScoreWeights(checkOptions.scoringWeights);
    const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
    const exclusionPenalty = slotEnts.some(e => hasAutoGroupExclusionSlotConflict(item, e)) ? 100000 : 0;
    const teachers = splitTeacherNames(item.teacherName).filter(Boolean);
    const dayEnts = existing.filter(e => e.day === slot.day);
    const teacherLoad = teachers.reduce((sum, t) => sum + getTeacherDayLoad(t, existing, slot.day), 0);
    const teacherLimitLoad = teachers.reduce((sum, t) => sum + teacherLimitPenalty(t, slot, existing), 0);
    const audience = audienceForPlacement(item);
    const classKeys = [...(audience.classKeys || [])];
    const classLoad = dayEnts.reduce((sum, e) => sum + (audiencesConflict(audience, audienceForPlacement(e)) ? 1 : 0), 0);
    const samePeriodLoad = existing.filter(e => e.period === slot.period).length;

    let preferencePenalty = 0;


    const itemSubject = entrySubjectKeyForScoring(item);
    for (const cls of classKeys) {
      const sameSubjectToday = dayEnts.some(e =>
        entryClassKeysForScoring(e).includes(cls) && entrySubjectKeyForScoring(e) === itemSubject
      );
      if (sameSubjectToday) preferencePenalty += 26 * weights.sameSubjectDay;

      const dayPeriods = dayEnts
        .filter(e => entryClassKeysForScoring(e).includes(cls))
        .map(e => e.period);
      const nextMax = maxConsecutiveFromPeriods([...dayPeriods, slot.period]);
      if (nextMax >= 5) preferencePenalty += (nextMax - 4) * 12 * weights.classConsecutive;
    }

    for (const teacher of teachers) {
      const gaps = teacherGapCountAfterAdding(teacher, existing, slot.day, slot.period);
      preferencePenalty += gaps * 4 * weights.teacherGap;
      const nextMax = maxConsecutiveAfterAdding(teacher, existing, slot.day, slot.period);
      if (nextMax >= 4) preferencePenalty += (nextMax - 3) * 12 * weights.teacherConsecutive;
    }

    return exclusionPenalty + slotEnts.length * 100 + teacherLoad * 8 + teacherLimitLoad + classLoad * 6 + preferencePenalty + samePeriodLoad * 0.15 + Math.random();
  }

  function selectCandidateWithExploration(candidates = [], checkOptions = {}) {
    if (!candidates.length) return null;
    const sorted = [...candidates].sort((a, b) => a.score - b.score);
    const randomness = Math.max(0, Number(checkOptions.slotRandomness || 0));
    const topCandidateCount = Math.max(1, Math.min(12, Number(checkOptions.topCandidateCount || 1)));
    if (!randomness || topCandidateCount <= 1) return sorted[0];

    const bestScore = sorted[0].score;
    const tolerance = Math.max(4, randomness * 14);
    const pool = sorted
      .filter(c => c.score <= bestScore + tolerance)
      .slice(0, topCandidateCount);
    if (pool.length <= 1) return sorted[0];

    // 좋은 후보를 더 자주 고르되, 같은 점수대의 다른 후보도 일부 시도합니다.
    const index = Math.min(pool.length - 1, Math.floor(Math.pow(Math.random(), 1.8) * pool.length));
    return pool[index] || pool[0];
  }

  function findBestAutoSlot(item, baseSlots, placed, checkOptions) {
    const candidates = [];
    for (const slot of shuffle([...baseSlots])) {
      if (checkPlacementValid(item, slot, placed, checkOptions)) {
        candidates.push({ slot, score: scoreAutoSlot(item, slot, placed, checkOptions) });
      }
    }
    return selectCandidateWithExploration(candidates, checkOptions)?.slot || null;
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

  function forcedSlotScore(item, slot, placed = [], options = {}) {
    // 마지막 보정 단계용 점수입니다.
    // 원칙적으로 충돌 없는 슬롯을 찾고, 불가피할 때만 최소 충돌 슬롯에 배치합니다.
    // 단, 고정/보호 슬롯 침범과 동일 카드 동일 시간 중복은 끝까지 막습니다.
    if (strongProtectedSlotConflict(item, slot, placed)) return Infinity;
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
    if (roomUnavailableInSlot(candidateRoomData, slot)) return Infinity;
    if (roomConflictsInSlot(candidateRoomData, slot, placed)) return Infinity;

    const weights = normalizeScoreWeights(options.scoringWeights);
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
      // 보정 배치에서도 같은 학급 중복은 만들지 않습니다.
      // 단, 같은 동시배정 그룹은 사전작업에서 병렬 수업으로 확정된 묶음이므로 허용합니다.
      if (conflict && !conc) return Infinity;
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

  function findLeastBadSlot(item, baseSlots, placed = [], options = {}) {
    const candidates = [];
    for (const slot of shuffle([...baseSlots])) {
      const score = forcedSlotScore(item, slot, placed, options);
      if (Number.isFinite(score)) candidates.push({ slot, score });
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0]?.slot || null;
  }

  // ── Post-placement improvement helpers ─────────────────────────
  // 자동배치가 일단 성공한 뒤, 충돌을 만들지 않는 범위에서
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

  function scoreScheduleQuality(movable = [], options = {}) {
    const all = [...entries(), ...(movable || [])];
    const weights = scoreOptionsFromAssignOptions(options);
    let score = 0;

    const classDaySubject = new Map();
    const classDayPeriods = new Map();
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

      });

      getTeacherNamesForScoring(entry).forEach(teacher => {
        const key = `${teacher}:${entry.day}`;
        if (!teacherDayPeriods.has(key)) teacherDayPeriods.set(key, []);
        teacherDayPeriods.get(key).push(period);
      });
    });

    classDaySubject.forEach(count => {
      if (count > 1) score += (count - 1) * 28 * weights.sameSubjectDay;
    });

    classDayPeriods.forEach(periods => {
      const unique = [...new Set(periods)].sort((a, b) => a - b);
      const maxC = maxConsecutiveFromPeriods(unique);
      if (maxC >= 5) score += (maxC - 4) * 12 * weights.classConsecutive;
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

      score += gaps * 5 * weights.teacherGap;
      if (unique.length >= 6) score += (unique.length - 5) * 8 * weights.teacherGap;
      if (limitC > 0 && maxC > limitC) score += (maxC - limitC) * 40 * weights.teacherConsecutive;
      else if (maxC >= 4) score += (maxC - 3) * 14 * weights.teacherConsecutive;
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

  function blockKeyForEntry(entry, index = 0) {
    return entry.groupId
      ? `group:${entry.groupId}:${entry.day}:${entry.period}`
      : (entry.unitId ? `unit:${entry.unitId}:${entry.day}:${entry.period}` : `entry:${entry.id || index}`);
  }

  function getBlockingBlocksForSlot(item, slot, placed = []) {
    const slotEnts = placed.filter(e => e.day === slot.day && e.period === slot.period);
    if (!slotEnts.length) return [];
    const teachers = new Set(splitTeacherNames(item.teacherName || '').filter(Boolean));
    const itemAudience = audienceForPlacement(item);
    const candidateRoomData = applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed);
    const blockedKeys = new Set();

    slotEnts.forEach((e, index) => {
      if (sameUnitPlacement(item, e)) return;
      const sameGrp = sameActiveGroup(item, e);
      const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);
      if (conc) return;

      const eTeachers = splitTeacherNames(e.teacherName || '').filter(Boolean);
      const teacherHit = eTeachers.some(t => teachers.has(t));
      const classHit = audiencesConflict(itemAudience, audienceForPlacement(e));
      const roomHit = !!(candidateRoomData.roomId && e.roomId && candidateRoomData.roomId === e.roomId);
      if (teacherHit || classHit || roomHit) blockedKeys.add(blockKeyForEntry(e, index));
    });

    if (!blockedKeys.size) return [];
    return getMovableBlocks(placed).filter(block => blockedKeys.has(block.key));
  }

  async function repairFailedItemsBySingleMove(failedItems = [], baseSlots = [], placed = [], options = {}, progressUpdater = null) {
    const current = [...placed];
    const remaining = [];
    const repaired = [];
    const orderedSlots = [...baseSlots].sort((a, b) => a.period - b.period || a.day - b.day);
    const maxFailedToTry = options.runAttempts === 'deep' ? 80 : (options.runAttempts === 'fast' ? 24 : 48);
    const maxBlockersPerSlot = options.runAttempts === 'deep' ? 8 : 5;
    const maxMoveSlotsPerBlock = options.runAttempts === 'deep' ? orderedSlots.length : Math.min(18, orderedSlots.length);
    let attempts = 0;

    for (let idx = 0; idx < failedItems.length; idx++) {
      const failedItem = failedItems[idx];
      const item = failedItem?.item;
      if (!item || idx >= maxFailedToTry) {
        remaining.push(failedItem);
        continue;
      }

      let done = false;

      // 이전 복구로 새 빈칸이 생긴 경우 바로 배치합니다.
      const directSlot = findBestAutoSlot(item, orderedSlots, current, options);
      if (directSlot) {
        const entry = makeAutoEntry(item, directSlot, current);
        if (entry) {
          current.push(entry);
          repaired.push({ ...failedItem, repairMode: 'direct-after-repair' });
          done = true;
        }
      }

      for (const targetSlot of orderedSlots) {
        if (done) break;
        const blockers = getBlockingBlocksForSlot(item, targetSlot, current).slice(0, maxBlockersPerSlot);
        if (!blockers.length) continue;

        for (const block of blockers) {
          if (done) break;
          const blockIds = new Set(block.entries.map(e => e.id));
          const withoutBlock = current.filter(e => !blockIds.has(e.id));
          const moveSlots = shuffle([...orderedSlots]).slice(0, maxMoveSlotsPerBlock);

          for (const moveSlot of moveSlots) {
            attempts++;
            if (moveSlot.day === targetSlot.day && moveSlot.period === targetSlot.period) continue;
            const moved = makeMovedBlockEntries(block, moveSlot, withoutBlock);
            if (!moved) continue;
            const baseWithMoved = [...withoutBlock, ...moved];
            if (!checkPlacementValid(item, targetSlot, baseWithMoved, options)) continue;
            const entry = makeAutoEntry(item, targetSlot, baseWithMoved);
            if (!entry) continue;
            current.length = 0;
            current.push(...baseWithMoved, entry);
            repaired.push({ ...failedItem, repairMode: 'single-move', movedBlock: block.key });
            done = true;
            break;
          }
        }

        if (progressUpdater && attempts && attempts % 60 === 0) {
          await progressUpdater({
            percent: 83,
            step: '미배치 복구 탐색',
            detail: `기존 수업 1개 이동으로 미배치 수업을 넣을 수 있는지 확인 중입니다. 복구 ${repaired.length}건`,
            placed: current.length,
            failed: Math.max(0, failedItems.length - repaired.length),
            currentCard: failedItem.name || getAutoItemName(item)
          });
        }
      }

      if (!done) remaining.push(failedItem);
    }

    // 시도 한도를 넘겨 건너뛴 항목이 있다면 그대로 남깁니다.
    if (failedItems.length > maxFailedToTry) {
      // 이미 loop에서 remaining에 넣습니다. 중복 방지를 위해 추가 작업 없음.
    }

    return { placed: current, repaired, remaining, attempts };
  }

  async function improveAutoPlacement(placed = [], baseSlots = [], options = {}, progressUpdater = null) {
    const current = [...placed];
    const limit = options.runAttempts === "deep" ? 360 : (options.runAttempts === "fast" ? 90 : 190);
    let attempts = 0;
    let improved = 0;
    let bestScore = scoreScheduleQuality(current, options);

    const orderedSlots = [...baseSlots].sort((a, b) => {
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
          const candScore = scoreScheduleQuality(candidate, options);
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
            detail: `설정한 점수 기준으로 후보를 검토하고 있습니다. 개선 ${improved}건`,
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

  function placeAutoGroupSlot(group, activeItems, slot, placed, checkOptions = {}) {
    // Current group manager stores a visible group as one aggregate item.
    // 다만 같은 수업 묶음(unit)이 아닌 여러 과목은 과목별 entry로 분리해
    // 각 과목이 자신의 교사 담당교실/홈룸을 따로 받을 수 있게 합니다.
    const groupItem = activeItems[0];
    if (!groupItem) return false;

    const batches = getGroupRoomBatches(group, groupItem.ttcards || []);
    const pending = [];
    for (const cards of batches.length ? batches : [groupItem.ttcards || []]) {
      const item = makePlacementFromGroupItem(group, { ...groupItem, ttcards: cards });
      if (!item) continue;
      const checkedItem = annotateRestrictedAutoItem(item);
      // probe 검사를 통과했더라도 실제 저장 entry가 과목별로 분리되면서
      // 고정 수업/교실/교사 충돌이 생길 수 있으므로, 저장 직전에 한 번 더 검사합니다.
      if (!checkPlacementValid(checkedItem, slot, [...placed, ...pending], checkOptions)) return false;
      pending.push(normalizeTimetableEntry({
        id: uid("ent"),
        ...applyAutoRoomToEntryData({ ...checkedItem, ...slot }, slot, [...placed, ...pending])
      }));
    }
    if (!pending.length) return false;
    placed.push(...pending);
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
        actions?.querySelectorAll?.('[data-auto-extra-action="1"]')?.forEach(btn => btn.remove());
        const extraActions = Array.isArray(data.actions) ? data.actions : [];
        extraActions.forEach(action => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.dataset.autoExtraAction = "1";
          btn.className = `tt-auto-progress-extra-action ${action.className || ""}`.trim();
          btn.textContent = action.label || "실행";
          btn.style.cssText = action.danger
            ? "border:0;border-radius:10px;color:#fff;font-weight:900;padding:9px 16px;cursor:pointer;background:#b91c1c;"
            : "border:0;border-radius:10px;color:#fff;font-weight:900;padding:9px 16px;cursor:pointer;background:#2563eb;";
          btn.addEventListener("click", async () => {
            try {
              if (typeof action.onClick === "function") await action.onClick({ overlay, button: btn, close: removeOverlay });
            } catch (e) {
              console.error("Auto assign action failed:", e);
              alert(e?.message || String(e));
            }
          });
          actions?.insertBefore(btn, closeBtn);
        });
        closeBtn.textContent = data.closeLabel || "닫기";
        closeBtn.disabled = false;
        (extraActions[0] ? actions?.querySelector('[data-auto-extra-action="1"]') : closeBtn)?.focus?.();
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
    runAttempts: "balanced",    // fast | balanced | deep
    scoringProfile: "balanced",
    scoringWeights: { ...DEFAULT_SCORE_WEIGHTS }
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
    if (value === "deep") return [60, 40, 18];
    return [36, 26, 12];
  }

  function explorationOptionsForAttempt(mode, attempt = 0, stageIndex = 0) {
    const value = String(mode || "balanced");
    const base = value === "deep" ? 6 : (value === "fast" ? 2 : 4);
    const warmup = attempt === 0 ? 0 : 1;
    const jitter = (attempt % Math.max(2, base)) + stageIndex;
    const slotRandomness = warmup ? Math.min(7, 1 + jitter) : 0;
    const topCandidateCount = warmup ? Math.min(10, 2 + base + (attempt % 3)) : 1;
    return { slotRandomness, topCandidateCount };
  }

  function compareAutoRunResults(a = {}, b = {}) {
    // 반환값이 음수이면 a가 더 좋습니다.
    const aFailed = Number(a.failedCount ?? 999999);
    const bFailed = Number(b.failedCount ?? 999999);
    if (aFailed !== bFailed) return aFailed - bFailed;
    const aPlaced = Number(a.placedCount ?? 0);
    const bPlaced = Number(b.placedCount ?? 0);
    if (aPlaced !== bPlaced) return bPlaced - aPlaced;
    const aQuality = Number(a.qualityScore ?? Infinity);
    const bQuality = Number(b.qualityScore ?? Infinity);
    if (aQuality !== bQuality) return aQuality - bQuality;
    const aForced = Number(a.forcedCount ?? 0);
    const bForced = Number(b.forcedCount ?? 0);
    return aForced - bForced;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[<>&"]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[ch]));
  }

  function openAutoAssignOptionsDialog(activeGrades = [], defaultOptions = {}) {
    const grades = activeGrades.length ? activeGrades : GRADE_KEYS;
    const defaults = { ...AUTO_ASSIGN_DEFAULT_OPTIONS, ...defaultOptions };
    if (!SCORE_PRESETS[defaults.scoringProfile] && defaults.scoringProfile !== "custom") defaults.scoringProfile = "balanced";
    const defaultWeights = normalizeScoreWeights(defaults.scoringWeights || SCORE_PRESETS[defaults.scoringProfile] || DEFAULT_SCORE_WEIGHTS);
    const weightLabel = v => ["끔", "낮음", "보통", "높음"][clampWeight(v, 0)] || "보통";
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
            <section class="tt-auto-option-section tt-auto-score-section">
              <div class="tt-auto-option-title-row">
                <h4>점수 기준</h4>
                <select id="ttAutoScorePreset" class="tt-auto-select tt-auto-score-preset">
                  <option value="balanced" ${defaults.scoringProfile === "balanced" ? "selected" : ""}>균형</option>
                  <option value="teacherFriendly" ${defaults.scoringProfile === "teacherFriendly" ? "selected" : ""}>교사 부담 최소화</option>
                  <option value="studentFriendly" ${defaults.scoringProfile === "studentFriendly" ? "selected" : ""}>학생 몰림 최소화</option>
                  <option value="custom" ${defaults.scoringProfile === "custom" ? "selected" : ""}>직접 설정</option>
                </select>
              </div>
              <div class="tt-auto-weight-grid">
                ${[
                  ["teacherGap", "교사 공강 최소화", "교사의 하루 수업 간 빈 시간을 줄입니다."],
                  ["sameSubjectDay", "같은 과목 몰림 회피", "한 반에 같은 과목이 하루에 반복되는 것을 줄입니다."],
                  ["teacherConsecutive", "교사 연속수업 완화", "교사의 긴 연속수업을 줄입니다."],
                  ["classConsecutive", "학급 연속수업 완화", "한 반의 긴 연속수업 부담을 줄입니다."],
                ].map(([key, label, help]) => `
                  <label class="tt-auto-weight-row" data-weight-key="${key}">
                    <span><b>${label}</b><em>${help}</em></span>
                    <input type="range" min="0" max="3" step="1" value="${defaultWeights[key]}" data-weight="${key}">
                    <strong data-weight-label="${key}">${weightLabel(defaultWeights[key])}</strong>
                  </label>`).join("")}
              </div>
              <p class="tt-auto-option-help">점수 기준은 절대 조건이 아니라 자동배치가 여러 후보 중 더 나은 시간을 고르는 기준입니다.</p>
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

      const setWeightInputs = (weights, profile = "custom") => {
        const normalized = normalizeScoreWeights(weights);
        Object.entries(normalized).forEach(([key, value]) => {
          const input = overlay.querySelector(`[data-weight="${key}"]`);
          const label = overlay.querySelector(`[data-weight-label="${key}"]`);
          if (input) input.value = String(value);
          if (label) label.textContent = weightLabel(value);
        });
        const preset = overlay.querySelector("#ttAutoScorePreset");
        if (preset) preset.value = profile;
      };

      overlay.querySelector("#ttAutoScorePreset")?.addEventListener("change", e => {
        const profile = e.target.value || "balanced";
        if (profile !== "custom" && SCORE_PRESETS[profile]) setWeightInputs(SCORE_PRESETS[profile], profile);
      });
      overlay.querySelectorAll('[data-weight]').forEach(input => {
        input.addEventListener("input", () => {
          const key = input.dataset.weight;
          const label = overlay.querySelector(`[data-weight-label="${key}"]`);
          if (label) label.textContent = weightLabel(input.value);
          const preset = overlay.querySelector("#ttAutoScorePreset");
          if (preset) preset.value = "custom";
        });
      });

      overlay.querySelector('.tt-auto-options-start')?.addEventListener("click", () => {
        const selectedGrades = [...overlay.querySelectorAll('.tt-auto-grade-chip input[type="checkbox"]:checked')].map(cb => cb.value);
        if (!selectedGrades.length) {
          alert("자동 배치할 학년을 하나 이상 선택해 주세요.");
          return;
        }
        const placementMode = overlay.querySelector('input[name="ttAutoPlacementMode"]:checked')?.value || "reset";
        const scoringWeights = normalizeScoreWeights(Object.fromEntries(
          [...overlay.querySelectorAll('[data-weight]')].map(input => [input.dataset.weight, input.value])
        ));
        close({
          placementMode,
          selectedGrades,
          keepPinned: overlay.querySelector("#ttAutoKeepPinned")?.checked !== false,
          keepManual: overlay.querySelector("#ttAutoKeepManual")?.checked !== false,
          runAttempts: overlay.querySelector("#ttAutoRunAttempts")?.value || "balanced",
          scoringProfile: overlay.querySelector("#ttAutoScorePreset")?.value || "balanced",
          scoringWeights
        });
      });
    });
  }



  // ── Auto-assign precheck report ────────────────────────────────
  // 자동배치 전 데이터 상태를 먼저 보여 줍니다. 자동배치 실패 대부분은
  // 알고리즘보다 카드/그룹/보호 슬롯/제약교사 데이터에서 시작되므로,
  // 실행 전에 점검 결과를 확인할 수 있게 합니다.
  function addPrecheckItem(report, section, status, title, detail = "", meta = {}) {
    report.items.push({ section, status, title, detail, meta });
    report.counts[status] = (report.counts[status] || 0) + 1;
  }

  function statusRankForPrecheck(status) {
    return status === "error" ? 3 : status === "warn" ? 2 : status === "ok" ? 1 : 0;
  }

  function precheckEsc(value = "") {
    return String(value ?? "").replace(/[<>&"']/g, ch => ({
      "<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;", "'":"&#39;"
    }[ch] || ch));
  }

  function countPrecheckBy(items = [], keyFn = () => "") {
    const map = new Map();
    (items || []).forEach(item => {
      const key = keyFn(item);
      if (!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }

  function collectCardIdsFromGroupForPrecheck(group = {}) {
    const ids = [];
    ids.push(...(group.poolCardIds || []));
    ids.push(...(group.excludedCardIds || []));
    ids.push(...(group.cardIds || []));
    (group.units || []).forEach(unit => {
      ids.push(...(unit.ttcardIds || []));
      ids.push(...(unit.cardIds || []));
      ids.push(...(unit.poolCardIds || []));
    });
    return [...new Set(ids.filter(Boolean))];
  }

  function cardTextForPrecheck(card = {}) {
    const tpl = card.templateId ? getTemplateById(card.templateId) : null;
    return [
      card.subject, card.name, card.title, card.nameKo, card.nameEn,
      card.groupName, card.track, card.category,
      tpl?.nameKo, tpl?.nameEn, tpl?.sem1NameKo, tpl?.sem1NameEn
    ].map(v => String(v || "")).join(" ");
  }

  function isWholeGradeLikeCard(card = {}) {
    const text = cardTextForPrecheck(card);
    if (card.isWholeGrade || card.wholeGrade || card.isGradeWide) return true;
    if (Array.isArray(card.classKeys) && card.classKeys.length >= 2) return true;
    if (Array.isArray(card.classLabels) && card.classLabels.length >= 2) return true;
    return /(자율활동|동아리활동|채플|종교|진로와\s*소명|성품과\s*공동체|선교적\s*생활|섬김의\s*리더십|변혁적\s*리더십|중학교\s*특성화|Self[-\s]*regulated|Club\s*Activity|Chapel|Vision|Vocation|Leadership|Missional)/i.test(text);
  }

  function cardKeyForPrecheck(card = {}) {
    return [card.gradeKey || "", card.templateId || "", card.sectionIdx ?? card.sectionIndex ?? ""].join("::");
  }

  function gradeTemplateKeyForPrecheck(card = {}) {
    return [card.gradeKey || "", card.templateId || ""].join("::");
  }

  function getPlacedCardIdsForPrecheck(existingEntries = []) {
    const set = new Set();
    (existingEntries || []).forEach(entry => {
      ttCardIdsFromPlacement(entry).forEach(id => { if (id) set.add(id); });
    });
    return set;
  }

  function summarizeAutoTargetsForPrecheck(standalone = [], groupBlocks = []) {
    const groupSlots = groupBlocks.reduce((sum, { group, unitItems }) => {
      const credits = (unitItems || []).map(u => Math.max(0, Number(u?.credits) || 0));
      const isConcurrent = group?.isConcurrent || group?.groupType === "concurrent";
      return sum + (isConcurrent ? Math.max(0, ...credits) : credits.reduce((a, b) => a + b, 0));
    }, 0);
    return { standaloneSlots: standalone.length, groupSlots, totalSlots: standalone.length + groupSlots };
  }

  function buildRestrictedTeacherTargetsForPrecheck(standalone = [], groupBlocks = []) {
    const map = new Map();
    const add = (teacher, count, sample) => {
      if (!teacher || !isRestrictedTeacher(teacher)) return;
      if (!map.has(teacher)) map.set(teacher, { teacher, target: 0, samples: [] });
      const row = map.get(teacher);
      row.target += count;
      if (sample && row.samples.length < 5) row.samples.push(sample);
    };

    standalone.forEach(item => {
      const name = getAutoItemName(item);
      getTeachersForAutoItem(item).forEach(t => add(t, 1, name));
    });

    groupBlocks.forEach(block => {
      const { group, unitItems } = block || {};
      const credits = (unitItems || []).map(u => Math.max(0, Number(u?.credits) || 0));
      const isConcurrent = group?.isConcurrent || group?.groupType === "concurrent";
      const groupSlotCount = Math.max(1, isConcurrent ? Math.max(0, ...credits) : credits.reduce((a, b) => a + b, 0));
      const sample = group?.name || group?.groupName || "그룹 수업";
      getTeachersForAutoItem(block).forEach(t => add(t, groupSlotCount, sample));
      (unitItems || []).forEach(unit => getTeachersForAutoItem(unit).forEach(t => add(t, Math.max(1, Number(unit?.credits) || 1), sample)));
    });

    return [...map.values()];
  }

  function countAvailableSlotsForRestrictedTeacher(teacher, protectedEntries = []) {
    const periodCount = Math.max(1, Number(ttConfig()?.periodCount || 7));
    let available = 0;
    const c = constraints()?.[teacher] || {};
    for (let day = 0; day < 5; day++) {
      for (let period = 0; period < periodCount; period++) {
        if (isTeacherUnavailable(teacher, day, period)) continue;
        const state = getTeacherLimitState(teacher, { day, period }, protectedEntries);
        if (state.maxPerWeek > 0 && state.weekLoad >= state.maxPerWeek) continue;
        if (state.maxPerDay > 0 && state.dayLoad >= state.maxPerDay) continue;
        if (state.maxConsecutive > 0 && state.nextConsecutive > state.maxConsecutive) continue;
        // 이 함수는 교사 개인의 가능 시간만 계산합니다. 학급/교실 충돌은 실제 자동배치에서 재검사합니다.
        available += 1;
      }
    }
    return { available, constraint: c };
  }

  function getActiveCardsForGrades(cards = [], activeGrades = []) {
    const set = new Set((activeGrades || []).filter(Boolean));
    if (!set.size) return cards;
    return (cards || []).filter(card => set.has(card.gradeKey) || (card.gradeKeys || []).some(g => set.has(g)));
  }

  function buildAutoAssignPrecheckReport(context = {}) {
    const {
      standalone = [],
      groupBlocks = [],
      activeGrades = [],
      options = {},
      protectedEntries = [],
      availableGrades = [],
    } = context;
    const report = {
      version: 1,
      mode: "his-autoassign-precheck",
      createdAt: new Date().toISOString(),
      scopeGrades: activeGrades,
      counts: { ok: 0, warn: 0, error: 0, info: 0 },
      items: []
    };

    const cards = ttDomain().ttcards || [];
    const groups = ttGroups();
    const existingEntries = entries();
    const activeCards = getActiveCardsForGrades(cards, activeGrades.length ? activeGrades : availableGrades);
    const cardIds = new Set(cards.map(c => c.id).filter(Boolean));
    const placedCardIds = getPlacedCardIdsForPrecheck(existingEntries);
    const targetSummary = summarizeAutoTargetsForPrecheck(standalone, groupBlocks);
    const protectedSummary = protectedSlotSummary(protectedEntries);

    addPrecheckItem(report, "대상 요약", cards.length ? "ok" : "error", "시간표 카드", `${cards.length}개 · 선택 학년: ${(activeGrades.length ? activeGrades : availableGrades).map(gradeDisplay).join(", ") || "없음"}`);
    addPrecheckItem(report, "대상 요약", targetSummary.totalSlots ? "ok" : "error", "자동배치 대상", `개별 ${targetSummary.standaloneSlots}시수 · 그룹 ${targetSummary.groupSlots}시수 · 합계 ${targetSummary.totalSlots}시수`);
    addPrecheckItem(report, "보호 슬롯", protectedSummary.total ? "info" : "ok", "기존 보호 배치", `엔트리 ${protectedSummary.total}개 · 슬롯 ${protectedSummary.slots}칸 · 고정 ${protectedSummary.pinned}개 · 수동 ${protectedSummary.manual}개`);

    const missingGroupRefs = [];
    const emptyGroups = [];
    groups.forEach(group => {
      const refs = collectCardIdsFromGroupForPrecheck(group);
      if (!refs.length) emptyGroups.push(group.name || group.groupName || group.id || "이름 없는 그룹");
      refs.forEach(id => { if (!cardIds.has(id)) missingGroupRefs.push(`${group.name || group.groupName || group.id} → ${id}`); });
    });
    addPrecheckItem(report, "그룹 점검", missingGroupRefs.length ? "error" : "ok", "그룹 카드 참조", missingGroupRefs.length ? `${missingGroupRefs.length}개 깨짐: ${missingGroupRefs.slice(0, 8).join(", ")}${missingGroupRefs.length > 8 ? " …" : ""}` : "정상");
    addPrecheckItem(report, "그룹 점검", emptyGroups.length ? "warn" : "ok", "빈 그룹", emptyGroups.length ? `${emptyGroups.length}개: ${emptyGroups.slice(0, 8).join(", ")}${emptyGroups.length > 8 ? " …" : ""}` : "없음");

    const duplicateIds = [...countPrecheckBy(cards, c => c.id).entries()].filter(([, n]) => n > 1);
    const duplicateExactKeys = [...countPrecheckBy(activeCards, cardKeyForPrecheck).entries()].filter(([key, n]) => key && !key.endsWith("::") && n > 1);
    addPrecheckItem(report, "카드 중복", duplicateIds.length ? "error" : "ok", "중복 카드 ID", duplicateIds.length ? `${duplicateIds.length}개 ID가 중복됩니다.` : "없음");
    addPrecheckItem(report, "카드 중복", duplicateExactKeys.length ? "warn" : "ok", "같은 학년/템플릿/섹션 중복", duplicateExactKeys.length ? `${duplicateExactKeys.length}종 발견 · 카드 갱신/DB 정리 확인 필요` : "없음");

    const wholeDuplicates = [...countPrecheckBy(activeCards.filter(isWholeGradeLikeCard), gradeTemplateKeyForPrecheck).entries()]
      .filter(([key, n]) => key && !key.endsWith("::") && n > 1);
    addPrecheckItem(report, "전체학년 카드", wholeDuplicates.length ? "warn" : "ok", "전체학년/창체 중복 생성", wholeDuplicates.length ? `${wholeDuplicates.length}종 발견 · 자율활동/동아리/채플이 중복 배치될 수 있습니다.` : "중복 없음");

    const groupRefSet = new Set(groups.flatMap(collectCardIdsFromGroupForPrecheck));
    const siblingIssues = [];
    groups.forEach(group => {
      const refs = collectCardIdsFromGroupForPrecheck(group);
      refs.forEach(id => {
        const card = cards.find(c => c.id === id);
        if (!card) return;
        const siblings = cards.filter(c => c.id !== id && c.gradeKey === card.gradeKey && c.templateId === card.templateId && !groupRefSet.has(c.id));
        if (siblings.length) siblingIssues.push(`${group.name || group.groupName || group.id}: ${card.gradeKey || "?"} ${describeTtCard(card).title} 외 ${siblings.length}개`);
      });
    });
    addPrecheckItem(report, "그룹 점검", siblingIssues.length ? "warn" : "ok", "그룹 대표카드와 중복 카드 불일치", siblingIssues.length ? `${siblingIssues.length}건 · ${siblingIssues.slice(0, 6).join(" / ")}${siblingIssues.length > 6 ? " …" : ""}` : "없음");

    const manualCards = activeCards.filter(c => c.isManual || String(c.id || "").startsWith("ttc_manual"));
    const placedManualCards = manualCards.filter(c => placedCardIds.has(c.id));
    addPrecheckItem(report, "수동 카드", manualCards.length ? "info" : "ok", "수동 카드 보존", manualCards.length ? `수동 카드 ${manualCards.length}개 · 현재 배치 ${placedManualCards.length}개 · 보호 ${options.keepManual !== false ? "ON" : "OFF"}` : "수동 카드 없음");
    if (manualCards.length && options.keepManual === false) {
      addPrecheckItem(report, "수동 카드", "warn", "수동 카드 보호 꺼짐", "자동배치 초기화 범위에 배치된 수동 카드가 포함될 수 있습니다.");
    }

    const fixedRoomNoRoom = activeCards.filter(card => String(card.roomRule || "").trim() === "fixed" && !card.roomId && !card.fixedRoomId);
    const anyNoRoom = activeCards.filter(card => String(card.roomRule || "auto").trim() !== "none" && !card.roomId && !card.fixedRoomId);
    addPrecheckItem(report, "교실 점검", fixedRoomNoRoom.length ? "error" : "ok", "고정 교실 규칙 미지정", fixedRoomNoRoom.length ? `${fixedRoomNoRoom.length}개 카드가 고정 교실 규칙이지만 교실이 없습니다.` : "없음");
    addPrecheckItem(report, "교실 점검", anyNoRoom.length ? "info" : "ok", "교실 자동 배정 대상", anyNoRoom.length ? `${anyNoRoom.length}개 카드는 담당교실/홈룸/일반교실 자동 배정 대상입니다.` : "모든 카드에 교실 또는 제외 규칙 있음");

    const restrictedTargets = buildRestrictedTeacherTargetsForPrecheck(standalone, groupBlocks);
    if (!restrictedTargets.length) {
      addPrecheckItem(report, "제약교사", "ok", "제약근무 교사 수업", "선택 범위에 제약근무 교사 수업이 없습니다.");
    } else {
      const shortageRows = [];
      restrictedTargets.forEach(row => {
        const slotInfo = countAvailableSlotsForRestrictedTeacher(row.teacher, protectedEntries);
        if (slotInfo.available < row.target) shortageRows.push(`${row.teacher}: 필요 ${row.target} / 가능 ${slotInfo.available}`);
      });
      addPrecheckItem(report, "제약교사", shortageRows.length ? "warn" : "ok", "제약교사 가능시간", shortageRows.length ? `${shortageRows.length}명 부족 가능성 · ${shortageRows.slice(0, 8).join(" / ")}${shortageRows.length > 8 ? " …" : ""}` : `${restrictedTargets.length}명 확인 · 개인 가능시간은 충분해 보입니다.`);
    }

    const invalidSlots = existingEntries.filter(e => !Number.isInteger(e.day) || e.day < 0 || e.day > 4 || !Number.isInteger(e.period) || e.period < 0 || e.period >= Number(ttConfig()?.periodCount || 7));
    addPrecheckItem(report, "기존 배치", invalidSlots.length ? "error" : "ok", "요일/교시 범위", invalidSlots.length ? `${invalidSlots.length}개 엔트리가 현재 교시 범위를 벗어납니다.` : "정상");

    const postTargetClassHint = buildScheduleVerificationReport(existingEntries, { scopeGrades: activeGrades, protectedEntries });
    const classIssues = postTargetClassHint.classSlots?.issues || [];
    addPrecheckItem(report, "현재 배치 참고", "info", "현재 학급별 점유", classIssues.length ? `${classIssues.length}개 학급이 현재 기준시수와 다릅니다. 자동배치 전 상태이므로 참고용입니다.` : "현재 배치 기준으로 모든 학급이 기준시수와 일치합니다.");

    report.overall = report.counts.error ? "error" : report.counts.warn ? "warn" : "ok";
    return report;
  }

  function buildAutoAssignPrecheckHtml(report = {}, { allowProceed = true } = {}) {
    const bySection = new Map();
    (report.items || []).forEach(item => {
      if (!bySection.has(item.section)) bySection.set(item.section, []);
      bySection.get(item.section).push(item);
    });
    const statusText = { ok: "정상", warn: "주의", error: "오류", info: "정보" };
    const overall = report.overall || (report.counts?.error ? "error" : report.counts?.warn ? "warn" : "ok");
    const sections = [...bySection.entries()].map(([section, items]) => {
      const maxStatus = items.reduce((acc, item) => statusRankForPrecheck(item.status) > statusRankForPrecheck(acc) ? item.status : acc, "info");
      return `<section class="tt-precheck-section"><h3><span class="tt-precheck-dot ${maxStatus}"></span>${precheckEsc(section)}</h3>${items.map(item => `
        <div class="tt-precheck-item ${item.status}">
          <div class="tt-precheck-item-head"><span class="tt-precheck-badge ${item.status}">${statusText[item.status] || item.status}</span><b>${precheckEsc(item.title)}</b></div>
          ${item.detail ? `<div class="tt-precheck-detail">${precheckEsc(item.detail)}</div>` : ""}
        </div>`).join("")}</section>`;
    }).join("");

    return `
      <style>
        .tt-precheck-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;}
        .tt-precheck-dialog{width:min(980px,calc(100vw - 32px));max-height:calc(100vh - 48px);background:#fff;border-radius:18px;box-shadow:0 28px 90px rgba(15,23,42,.34);overflow:hidden;display:flex;flex-direction:column;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
        .tt-precheck-header{padding:18px 22px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:16px;align-items:flex-start;background:linear-gradient(135deg,#f8fafc,#eef6ff);}
        .tt-precheck-header h2{margin:0;font-size:20px;color:#0f172a}.tt-precheck-header p{margin:6px 0 0;color:#64748b;font-size:13px;line-height:1.45}
        .tt-precheck-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;padding:16px 22px 0;}
        .tt-precheck-card{border:1px solid #e2e8f0;border-radius:14px;padding:12px;background:#fff}.tt-precheck-card strong{display:block;font-size:22px;line-height:1;color:#0f172a}.tt-precheck-card span{display:block;margin-top:6px;color:#64748b;font-size:12px;font-weight:800}.tt-precheck-card.overall.ok{background:#f0fdf4;border-color:#bbf7d0}.tt-precheck-card.overall.warn{background:#fffbeb;border-color:#fde68a}.tt-precheck-card.overall.error{background:#fef2f2;border-color:#fecaca}
        .tt-precheck-body{overflow:auto;padding:4px 22px 22px}.tt-precheck-section{border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;margin-top:12px;background:#fff}.tt-precheck-section h3{margin:0;padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a;display:flex;gap:8px;align-items:center}.tt-precheck-dot{width:10px;height:10px;border-radius:999px;background:#64748b}.tt-precheck-dot.ok{background:#16a34a}.tt-precheck-dot.warn{background:#f59e0b}.tt-precheck-dot.error{background:#dc2626}.tt-precheck-dot.info{background:#64748b}
        .tt-precheck-item{padding:11px 14px;border-bottom:1px solid #f1f5f9}.tt-precheck-item:last-child{border-bottom:0}.tt-precheck-item-head{display:flex;gap:8px;align-items:center;font-size:13px;color:#0f172a}.tt-precheck-badge{font-size:11px;border-radius:999px;padding:3px 7px;color:white;background:#64748b;min-width:36px;text-align:center}.tt-precheck-badge.ok{background:#16a34a}.tt-precheck-badge.warn{background:#f59e0b}.tt-precheck-badge.error{background:#dc2626}.tt-precheck-badge.info{background:#64748b}.tt-precheck-detail{margin-top:5px;color:#475569;font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word;}
        .tt-precheck-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.tt-precheck-btn{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:10px;padding:8px 12px;font-weight:800;cursor:pointer}.tt-precheck-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}.tt-precheck-btn.danger{background:#dc2626;border-color:#dc2626;color:#fff}
        @media(max-width:780px){.tt-precheck-header{flex-direction:column}.tt-precheck-actions{justify-content:flex-start}.tt-precheck-summary{grid-template-columns:repeat(2,minmax(0,1fr));}}
      </style>
      <div class="tt-precheck-dialog" role="dialog" aria-modal="true" aria-label="자동배치 사전 점검">
        <div class="tt-precheck-header"><div><h2>🩺 자동배치 사전 점검</h2><p>${precheckEsc(new Date(report.createdAt).toLocaleString())} 기준 · ${overall === "ok" ? "자동배치를 시작해도 좋은 상태입니다." : overall === "warn" ? "주의 항목을 확인한 뒤 진행하세요." : "오류 항목을 먼저 수정하는 것이 안전합니다."}</p></div><div class="tt-precheck-actions"><button type="button" class="tt-precheck-btn" data-precheck-export>JSON 내보내기</button><button type="button" class="tt-precheck-btn" data-precheck-close>닫기</button>${allowProceed ? `<button type="button" class="tt-precheck-btn ${overall === "error" ? "danger" : "primary"}" data-precheck-proceed>${overall === "ok" ? "자동배치 시작" : "확인 후 계속"}</button>` : ""}</div></div>
        <div class="tt-precheck-summary"><div class="tt-precheck-card overall ${overall}"><strong>${overall === "ok" ? "OK" : overall === "warn" ? "주의" : "오류"}</strong><span>종합 상태</span></div><div class="tt-precheck-card"><strong>${report.counts?.error || 0}</strong><span>오류</span></div><div class="tt-precheck-card"><strong>${report.counts?.warn || 0}</strong><span>주의</span></div><div class="tt-precheck-card"><strong>${report.counts?.ok || 0}</strong><span>정상</span></div><div class="tt-precheck-card"><strong>${report.counts?.info || 0}</strong><span>정보</span></div></div>
        <div class="tt-precheck-body">${sections}</div>
      </div>`;
  }

  function downloadPrecheckJson(report) {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `his-autoassign-precheck-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openAutoAssignPrecheckDialog(report, { allowProceed = true } = {}) {
    return new Promise(resolve => {
      const old = document.querySelector(".tt-precheck-overlay");
      if (old) old.remove();
      const overlay = document.createElement("div");
      overlay.className = "tt-precheck-overlay";
      overlay.innerHTML = buildAutoAssignPrecheckHtml(report, { allowProceed });
      document.body.appendChild(overlay);
      const close = value => { overlay.remove(); resolve(value); };
      overlay.querySelector("[data-precheck-close]")?.addEventListener("click", () => close(false));
      overlay.querySelector("[data-precheck-proceed]")?.addEventListener("click", () => close(true));
      overlay.querySelector("[data-precheck-export]")?.addEventListener("click", () => downloadPrecheckJson(report));
      overlay.addEventListener("click", ev => { if (ev.target === overlay) close(false); });
    });
  }

  async function openAutoAssignPrecheckOnly() {
    const rawItems = buildSchedulableItems();
    let standalone = (rawItems.standalone || []).map(annotateRestrictedAutoItem);
    let groupBlocks = (rawItems.groupBlocks || []).map(annotateRestrictedGroupBlock);
    const availableGrades = getActiveGradesFromScheduleItems(standalone, groupBlocks);
    if (!availableGrades.length || (!standalone.length && !groupBlocks.length)) {
      alert("시간표 사전작업에서 생성된 과목 카드가 없습니다.");
      return;
    }
    const options = { ...AUTO_ASSIGN_DEFAULT_OPTIONS, selectedGrades: availableGrades };
    ({ standalone, groupBlocks } = filterAutoTargetsByGrades(standalone, groupBlocks, options.selectedGrades));
    const protectedEntries = computeProtectedEntries(entries(), options);
    const activeGrades = getActiveGradesFromScheduleItems(standalone, groupBlocks);
    const report = buildAutoAssignPrecheckReport({ standalone, groupBlocks, activeGrades, availableGrades, options, protectedEntries });
    await openAutoAssignPrecheckDialog(report, { allowProceed: false });
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
    options.scoringWeights = scoreOptionsFromAssignOptions(options);

    ({ standalone, groupBlocks } = filterAutoTargetsByGrades(standalone, groupBlocks, options.selectedGrades));
    const activeGrades = getActiveGradesFromScheduleItems(standalone, groupBlocks);
    const protectedEntries = computeProtectedEntries(entries(), options);
    const protectedSummary = protectedSlotSummary(protectedEntries);
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

    const precheckReport = buildAutoAssignPrecheckReport({
      standalone,
      groupBlocks,
      activeGrades,
      availableGrades,
      options,
      protectedEntries
    });
    const precheckProceed = await openAutoAssignPrecheckDialog(precheckReport, { allowProceed: true });
    if (!precheckProceed) return;

    const modeText = options.placementMode === "keep" ? "현재 배치 유지 + 미배치만 배치" : "선택 범위 초기화 후 배치";
    const confirmText = [
      `자동 배치를 시작합니다.`,
      `대상: ${activeGrades.map(gradeDisplay).join(", ")}`,
      `방식: ${modeText}`,
      options.placementMode === "reset" ? `초기화 대상 배치: ${willClearCount}개` : `보호되는 기존 배치: ${protectedEntries.length}개`,
      `고정/보호 슬롯: ${protectedSummary.slots}칸`,
      `잠금 카드 유지: ${options.keepPinned !== false ? "예" : "아니오"}`,
      `수동 카드 유지: ${options.keepManual !== false ? "예" : "아니오"}`,
      `점수 기준: ${describeScoreWeights(options.scoringWeights)}`,
      "",
      "계속할까요?"
    ].join("\n");
    if (!confirm(confirmText)) return;

    autoAssignRunning = true;
    setAutoAssignBusy(true);
    await waitForBrowser();

    const autoStartedAt = Date.now();
    const rollbackEntriesSnapshot = cloneAutoAssignData(entries());
    const beforeAutoSnapshot = saveAutoAssignScheduleSnapshot("before", rollbackEntriesSnapshot, { activeGrades, modeText, options });
    if (beforeAutoSnapshot) {
      addTimetableLog("auto", "자동배치 전 배치 보관", `${beforeAutoSnapshot.name}으로 현재 배치를 저장했습니다.`);
      await persistTimetableNow();
    }
    let rollbackConsumed = false;
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
    const preValidation = buildScheduleVerificationReport(entries(), { scopeGrades: activeGrades });

    // Preserve entries according to the selected auto-assign options.
    // - reset: selected range is cleared, but locked/manual/out-of-range entries can be protected.
    // - keep: all current entries stay as protected entries and only missing cards are added.
    const pinnedEntries = [...protectedEntries];
    ttDomain().entries = [...protectedEntries];
    await updateProgress({
      percent: 6,
      step: options.placementMode === "keep" ? "기존 배치 유지" : "보호 수업 유지",
      detail: options.placementMode === "keep"
        ? `기존 배치 ${protectedEntries.length}개를 유지하고 미배치 대상만 준비합니다. 보호 슬롯 ${protectedSummary.slots}칸을 후보에서 제외합니다.`
        : `보호된 배치 ${protectedEntries.length}개를 유지하고 ${willClearCount}개 배치를 초기화했습니다. 보호 슬롯 ${protectedSummary.slots}칸을 후보에서 제외합니다.`,
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
      detail: `일반 카드 ${standalone.length}개, 그룹 ${groupBlocks.length}개를 분석했습니다. 여러 초기 배치 후보를 만든 뒤 가장 좋은 결과를 선택합니다. 제약근무 교사 대상: 일반 ${restrictedStandaloneCount}개, 그룹 ${restrictedGroupCount}개.`,
      log: restrictedTeacherNames.length
        ? `고정/보호 슬롯 ${protectedSummary.slots}칸 제외 · 고정 수업 다음 우선 배치: ${restrictedTeacherNames.join(", ")} · ${describeScoreWeights(options.scoringWeights)}`
        : `고정/보호 슬롯 ${protectedSummary.slots}칸 제외 · 그룹 수업은 동시배정 단위로 계산합니다. · ${describeScoreWeights(options.scoringWeights)}`
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
      { name:"strict", label:"교사 제약 포함", attempts:attemptPlan[0], options:{ respectSoftLimits:true,  respectUnavailable:true,  respectAssignedRoom:true,  scoringWeights: options.scoringWeights } },
      { name:"relaxedSoft", label:"일일/연속 제한 완화", attempts:attemptPlan[1], options:{ respectSoftLimits:false, respectUnavailable:true,  respectAssignedRoom:true,  scoringWeights: options.scoringWeights } },
      { name:"relaxedUnavailable", label:"불가시간 완화 · 교실 유지", attempts:attemptPlan[2], options:{ respectSoftLimits:false, respectUnavailable:false, respectAssignedRoom:true,  scoringWeights: options.scoringWeights } },
    ];

    let bestPlaced = [], bestFailed = [], bestScore = -1, bestStage = stages[0];
    let bestQualityScore = Infinity;
    let bestAttemptInfo = { stageLabel: stages[0]?.label || "", attempt: 0, totalAttempts: 0, exploration: "기본" };
    let exploredInitialRuns = 0;
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
          detail: `초기배치 후보 ${attempt + 1} / ${stage.attempts} · 현재까지 최선 ${Math.max(0, bestScore)}개 배치 · ${attempt === 0 ? "최저점 우선" : "랜덤 후보 탐색"}`,
          placed: 0,
          best: Math.max(0, bestScore),
          failed: bestFailed.length,
          currentCard: "-",
          log: attempt === 0 ? `${stage.label} 단계 시작` : null
        }, true);
        const placed = [], failed = [];
        exploredInitialRuns++;
        const exploration = explorationOptionsForAttempt(options.runAttempts, attempt, stageIndex);
        const stageAttemptOptions = { ...stage.options, ...exploration, attemptIndex: attempt, stageIndex };

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
            if (checkPlacementValid(item, slot, placed, stageAttemptOptions)) count += 1;
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
              const foundSlot = probe ? findBestAutoSlot(probe, baseSlots, placed, stageAttemptOptions) : null;
              if (foundSlot && placeAutoGroupSlot(group, activeItems, foundSlot, placed, stageAttemptOptions)) {
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
                const slot = checkedItem ? findBestAutoSlot(checkedItem, baseSlots, placed, stageAttemptOptions) : null;
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
              const slot = findBestAutoSlot(item, baseSlots, placed, stageAttemptOptions);
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

        const qualityScore = Math.round(scoreScheduleQuality(placed, { ...options, scoringWeights: stageAttemptOptions.scoringWeights }) * 10) / 10;
        const currentRun = {
          placedCount: placed.length,
          failedCount: failed.length,
          qualityScore,
          forcedCount: 0
        };
        const bestRun = {
          placedCount: bestPlaced.length,
          failedCount: bestFailed.length,
          qualityScore: bestQualityScore,
          forcedCount: 0
        };
        if (bestScore < 0 || compareAutoRunResults(currentRun, bestRun) < 0) {
          bestScore  = placed.length;
          bestPlaced = placed;
          bestFailed = failed;
          bestStage  = { ...stage, options: stageAttemptOptions };
          bestQualityScore = qualityScore;
          bestAttemptInfo = {
            stageLabel: stage.label,
            attempt: attempt + 1,
            totalAttempts: stage.attempts,
            exploration: stageAttemptOptions.slotRandomness ? `상위 ${stageAttemptOptions.topCandidateCount}개 후보 탐색` : "최저점 후보 우선",
            qualityScore
          };
          await updateProgress({
            percent: stagePercent,
            step: `최선 초기배치 갱신 · ${stage.label}`,
            detail: `현재 최선: ${bestPlaced.length}개 배치, 미배치 후보 ${bestFailed.length}개, 품질점수 ${qualityScore}`,
            placed: placed.length,
            best: bestPlaced.length,
            failed: bestFailed.length,
            log: `최선 초기배치 갱신: ${bestPlaced.length}개 배치 · 미배치 ${bestFailed.length}개 · 품질 ${qualityScore}`
          }, true);
        }
        // 완전 배치 후보가 나와도 같은 단계의 남은 초기 후보를 계속 비교해 품질이 더 좋은 배치를 찾습니다.
        // 단, 빠른 배치는 최소 3회 이후 완전 배치가 나오면 시간을 절약합니다.
        if (!failed.length && String(options.runAttempts || "balanced") === "fast" && attempt >= 2) break;
      }
      if (!bestFailed.length) break;
    }

    // ── Repair pass ───────────────────────────────────────────────
    // Greedy 자동배치가 막힌 경우, 기존 자동배치 수업 1개를 다른 칸으로 옮겨
    // 미배치 수업을 넣을 수 있는지 먼저 탐색합니다.
    let swapRepaired = [];
    if (bestFailed.length) {
      await updateProgress({
        percent: 82,
        step: "미배치 복구 탐색",
        detail: `미배치 후보 ${bestFailed.length}개를 기존 수업 이동/교환 방식으로 먼저 복구합니다.`,
        placed: bestPlaced.length,
        best: bestPlaced.length,
        failed: bestFailed.length,
        currentCard: "-",
        log: "Repair/Swap 1차 복구 단계 시작"
      }, true);
      const repair = await repairFailedItemsBySingleMove(bestFailed, baseSlots, bestPlaced, bestStage?.options || options, updateProgress);
      bestPlaced = repair.placed;
      bestFailed = repair.remaining;
      swapRepaired = repair.repaired || [];
      await updateProgress({
        percent: 84,
        step: "미배치 복구 완료",
        detail: `이동/교환으로 ${swapRepaired.length}개를 복구했습니다. 남은 후보 ${bestFailed.length}개`,
        placed: bestPlaced.length,
        best: bestPlaced.length,
        failed: bestFailed.length,
        currentCard: "-",
        log: `Repair/Swap 복구 ${swapRepaired.length}건`
      }, true);
    }

    // ── Final repair pass ─────────────────────────────────────────
    // 그래도 못 넣은 카드는 최소 충돌 보정 배치를 시도합니다.
    // 단, 보호 슬롯·동일 카드 중복·교사 중복·학급 중복·교실 중복은 만들지 않습니다.
    // 배치 가능한 안전 슬롯이 없으면 무리하게 겹쳐 넣지 않고 미배치로 남깁니다.
    await updateProgress({
      percent: 85,
      step: "미배치 보정 준비",
      detail: `남은 미배치 후보 ${bestFailed.length}개를 최소 충돌 위치에 보정 배치합니다.`,
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
      const slot = findLeastBadSlot(item, baseSlots, bestPlaced, options);
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
      detail: `배치된 수업을 안전하게 재배치해 설정한 점수 기준을 개선합니다. (${describeScoreWeights(options.scoringWeights)})`,
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

    const names = [...new Set(bestFailed.map(f => f.name))];
    const finalEntriesForValidation = [...protectedEntries, ...bestPlaced];
    const postValidation = buildScheduleVerificationReport(finalEntriesForValidation, {
      scopeGrades: activeGrades,
      protectedEntries,
      failedNames: names,
      failedDiagnostics
    });

    bestPlaced.forEach(e => entries().push(e));
    const afterAutoSnapshot = saveAutoAssignScheduleSnapshot("result", entries(), {
      activeGrades,
      modeText,
      options,
      validationSummary: postValidation.summary || (postValidation.ok ? "통과" : "확인 필요")
    });
    await persistTimetableNow();
    recomputeConflicts();

    const missingRoomEntries = bestPlaced.filter(e => !e.roomId && String(e.roomRule || "auto").trim() !== "none");
    const missingRoomNames = [...new Set(missingRoomEntries.map(e => getAutoItemName(e)))];
    const outcomeAnalysis = summarizeAutoAssignOutcome({
      placedEntries: bestPlaced,
      failedItems: bestFailed,
      forcedEntries: forcedPlaced,
      protectedEntries,
      missingRoomEntries
    });
    const conflictSummary = getConflictCounts();
    const report = {
      ts: Date.now(),
      activeGrades: activeGrades.map(gradeDisplay).join(", "),
      stageName: bestStage.name,
      stageLabel: bestStage.label,
      totalTarget: autoTargetSlots,
      pinnedCount: pinnedEntries.filter(e => e.pinned).length,
      protectedCount: protectedEntries.length,
      protectedSlotCount: protectedSummary.slots,
      protectedManualCount: protectedSummary.manual,
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
      scoringProfile: options.scoringProfile || "balanced",
      scoringWeights: options.scoringWeights,
      scoringSummary: describeScoreWeights(options.scoringWeights),
      initialRunCount: exploredInitialRuns,
      initialBestQualityScore: bestQualityScore,
      initialBestAttemptInfo: bestAttemptInfo,
      failedCount: names.length,
      failedNames: names,
      failedDiagnostics,
      failedReasonSummary: failedDiagnostics.slice(0, 8).map(d => `${d.name}: ${d.summary}${d.suggestionSummary ? ` / 제안: ${d.suggestionSummary}` : ""}`),
      outcomeAnalysis,
      placedBlockCount: outcomeAnalysis.placedBlockCount,
      placedGroupBlockCount: outcomeAnalysis.placedGroupBlockCount,
      placedStandaloneBlockCount: outcomeAnalysis.placedStandaloneBlockCount,
      placedCardCount: outcomeAnalysis.placedCardCount,
      failedUnitCount: outcomeAnalysis.failedUnitCount,
      failedOccurrenceCount: outcomeAnalysis.failedOccurrenceCount,
      topFailedUnits: outcomeAnalysis.topFailedUnits,
      forcedNames: [...new Set(forcedPlaced.map(f => f.name))],
      durationMs: Date.now() - autoStartedAt,
      conflictTotal: conflictSummary.totalAffected,
      conflictCounts: conflictSummary.counts,
      preValidation,
      postValidation,
      comparisonSummary: `${preValidation.summary || "이전 상태"} → ${postValidation.summary || "결과 상태"}`,
      validationSummary: postValidation.summary,
      validationOk: postValidation.ok,
      classSlotIssueCount: postValidation.classSlots?.issueCount || 0,
      restrictedTeacherIssueCount: postValidation.restrictedTeachers?.issueCount || 0,
      protectedIntrusionCount: postValidation.protectedIntrusions?.total || 0,
      missingRoomCount: missingRoomEntries.length,
      missingRoomNames,
      restrictedTeacherCount: restrictedTeacherNames.length,
      restrictedTeacherNames,
      restrictedStandaloneCount,
      restrictedGroupCount,
      beforeSnapshotName: beforeAutoSnapshot?.name || "",
      afterSnapshotName: afterAutoSnapshot?.name || ""
    };
    setLastAutoAssignReport(report);
    addTimetableLog(
      "auto",
      names.length ? "자동 배치 부분 완료" : "자동 배치 완료",
      `정상 배치 ${bestPlaced.length - forcedPlaced.length}개, 이동/교환 복구 ${swapRepaired.length}개, 보정 배치 ${forcedPlaced.length}개, 후처리 개선 ${improvement.improvedCount}건, 미배치 ${names.length}개, 교실 미배정 ${missingRoomEntries.length}개, 충돌 ${conflictSummary.totalAffected}건 · ${modeText} · 초기후보 ${exploredInitialRuns}회 · 탐색: ${bestStage.label}`
    );
    addTimetableLog(
      outcomeAnalysis.failedUnitCount ? "warn" : "auto",
      "자동배치 결과 분석",
      `수업 블록 ${outcomeAnalysis.placedBlockCount}개(그룹 ${outcomeAnalysis.placedGroupBlockCount}, 일반 ${outcomeAnalysis.placedStandaloneBlockCount}) · 배치 카드 ${outcomeAnalysis.placedCardCount}개 · 미배치 유닛 ${outcomeAnalysis.failedUnitCount}개 / ${outcomeAnalysis.failedOccurrenceCount}회차`
    );
    if (afterAutoSnapshot) {
      addTimetableLog("auto", "자동배치 결과 배치 보관", `${afterAutoSnapshot.name}으로 결과 배치를 저장했습니다. [배치 보관]에서 비교/복구할 수 있습니다.`);
    }
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
      `<b>이동/교환 복구</b> ${swapRepaired.length}개`,
      `<b>보정 배치</b> ${forcedPlaced.length}개`,
      `<b>후처리 개선</b> ${improvement.improvedCount}건`,
      `<b>미배치</b> ${names.length}개`,
      `<b>교실 미배정</b> ${missingRoomEntries.length}개`,
      `<b>충돌 표시 대상</b> ${conflictSummary.totalAffected}건`,
      `<b>검증 결과</b> ${postValidation.ok ? "통과" : postValidation.summary}`,
      `<b>학급 시수</b> ${postValidation.classSlots?.total ?? "-"}/${postValidation.classSlots?.targetTotal ?? "-"}시수`,
      `<b>배치 방식</b> ${modeText}`,
      beforeAutoSnapshot ? `<b>자동 보관</b> 전: ${safeAutoHtml(beforeAutoSnapshot.name)} / 결과: ${safeAutoHtml(afterAutoSnapshot?.name || "저장 실패")}` : null,
      `<b>탐색 방식</b> ${bestStage.label}`,
      `<b>초기배치 후보</b> ${exploredInitialRuns}회 중 ${bestAttemptInfo.stageLabel} ${bestAttemptInfo.attempt}/${bestAttemptInfo.totalAttempts} 선택 · ${bestAttemptInfo.exploration} · 품질 ${bestAttemptInfo.qualityScore ?? "-"}`,
      `<b>보호된 기존 배치</b> ${protectedEntries.length}개`,
      `<b>고정/보호 슬롯 제외</b> ${protectedSummary.slots}칸`,
      restrictedTeacherNames.length ? `<b>제약교사 우선 배치</b> ${restrictedTeacherNames.join(", ")} · 일반 ${restrictedStandaloneCount}개 / 그룹 ${restrictedGroupCount}개` : null,
      `<b>소요 시간</b> ${Math.round((Date.now() - autoStartedAt) / 1000)}초`
    ];
    detailLines.push(buildAutoAssignComparisonHtml(preValidation, postValidation));
    detailLines.push(buildAutoAssignOutcomeHtml(outcomeAnalysis));
    if (!postValidation.ok) {
      const issueRows = postValidation.classSlots?.issues || [];
      const classList = issueRows.slice(0, 10)
        .map(row => `<li>${formatClassKeyForReport(row.key)}: ${row.count}/${row.target}시수 (${row.diff < 0 ? Math.abs(row.diff) + " 부족" : row.diff + " 초과"})</li>`)
        .join("");
      const moreClass = issueRows.length > 10 ? `<li>외 ${issueRows.length - 10}개 학급</li>` : "";
      const restrictedList = (postValidation.restrictedTeachers?.issues || []).slice(0, 8)
        .map(row => `<li>${row.teacher}: ${row.issueParts.join(", ")}</li>`)
        .join("");
      const protectedList = (postValidation.protectedIntrusions?.samples || []).slice(0, 6)
        .map(text => `<li>${String(text).replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]))}</li>`)
        .join("");
      detailLines.push(`<div class="tt-auto-progress-failed"><b>검증 리포트</b><ul>${classList}${moreClass}${restrictedList}${protectedList}</ul></div>`);
    }
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
      detailLines.push(`남은 카드는 원인 후보와 함께 표시된 <b>풀어볼 조건</b>부터 조정해 주세요. 교사 제약, 고정 수업, 교실 조건 중 최소 변경으로 열리는 후보 시간을 우선 제안합니다.`);
    }
    detailLines.push(`자세한 결과는 하단 <b>로그</b> 탭에서 확인할 수 있습니다.`);

    await progress.complete({
      partial: !!names.length || !postValidation.ok,
      title: names.length || !postValidation.ok ? "자동배치 확인 필요" : "자동배치 완료",
      subtitle: names.length ? "일부 카드는 직접 확인이 필요합니다." : (!postValidation.ok ? "배치는 완료되었지만 검증 항목 확인이 필요합니다." : "모든 대상 슬롯을 배치했고 검증을 통과했습니다."),
      step: names.length || !postValidation.ok ? "확인 필요" : "완료",
      detailHtml: detailLines.filter(Boolean).map(line => `<div>${line}</div>`).join(""),
      placed: bestPlaced.length,
      best: bestPlaced.length,
      failed: names.length,
      currentCard: "-",
      closeLabel: "적용하고 닫기",
      actions: [{
        label: "되돌리기",
        danger: true,
        onClick: async ({ close, button }) => {
          if (rollbackConsumed) return;
          if (!confirm("이번 자동배치 결과를 되돌리고, 자동배치 전 시간표로 복원할까요?")) return;
          rollbackConsumed = true;
          if (button) { button.disabled = true; button.textContent = "되돌리는 중..."; }
          ttDomain().entries = cloneAutoAssignData(rollbackEntriesSnapshot) || [];
          await persistTimetableNow();
          recomputeConflicts();
          renderAll();
          addTimetableLog("undo", "자동배치 결과 되돌리기", "자동배치 전 시간표 상태로 복원했습니다.");
          setLastAutoAssignReport({ ...report, rolledBack: true, rolledBackAt: Date.now() });
          close?.();
        }
      }]
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


  autoAssignAll.openPrecheck = openAutoAssignPrecheckOnly;
  return autoAssignAll;
}
