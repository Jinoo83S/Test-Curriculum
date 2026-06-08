// ================================================================
// timetable-conflicts.js · Pure Conflict Detection
// ================================================================
import { splitTeacherNames } from "./templates.js";
import {
  getEntryOccupancy,
  setsIntersect as occSetsIntersect,
  audiencesConflict as occAudiencesConflict
} from "./timetable-occupancy.js";

/**
 * Returns Map<entryId, Set<"teacher"|"room"|"student"|"syncRequired">>
 *
 * getAudience(entry) is optional and can return:
 * { classKeys:Set<string> }.
 * When provided, class conflicts are checked by class audience overlap. Student keys are intentionally ignored;
 * student-level splits are handled during prework and concurrent group setup.
 */
export function detectConflicts(entries, templateGroups = [], templates = [], getAudience = null, options = {}) {
  const result = new Map();
  entries.forEach(e => result.set(e.id, new Set()));

  // Build lookup maps using new structure
  const tplGroupMap = new Map(templates.map(t => [t.id, t.calcGroupId || null]));
  const groupMap    = new Map(templateGroups.map(g => [g.id, g]));

  const getGroupForEntry = e => e.groupId ? groupMap.get(e.groupId) : (e.templateId ? groupMap.get(tplGroupMap.get(e.templateId)) : null);
  const sameUnit  = (a, b) => a.unitId && b.unitId && a.unitId === b.unitId;
  const sameGroup = (a, b) => {
    const gA = a.groupId || tplGroupMap.get(a.templateId);
    const gB = b.groupId || tplGroupMap.get(b.templateId);
    return gA && gA === gB;
  };
  const isConcurrent = e => { const g = getGroupForEntry(e); return g?.isConcurrent ?? (g?.groupType === "concurrent"); };
  const isCrossGrade = e => { const g = getGroupForEntry(e); return g?.isCrossGrade ?? (g?.groupType === "cross-grade"); };

  const unique = list => [...new Set((list || []).filter(Boolean))];
  const entryCardIds = e => unique([...(e.ttcardIds || []), e.ttcardId]);
  const normalizeGradeForClassKey = gradeKey => String(gradeKey ?? "").replace(/학년/g, "").trim();
  const sectionLabel = i => String.fromCharCode(65 + Math.max(0, Number.isInteger(i) ? i : (parseInt(i, 10) || 0)));
  const normalizeSectionForClassKey = section => {
    const compact = String(section ?? "").replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
    if (!compact) return "";
    const m = compact.match(/^\d{1,2}(.+)$/);
    return m ? m[1] : compact;
  };
  const makeClassKey = (gradeKey, section) => {
    const g = normalizeGradeForClassKey(gradeKey);
    const s = normalizeSectionForClassKey(section);
    return g && s ? `${g}:${s}` : "";
  };
  const fallbackAudience = e => getEntryOccupancy(e);
  const normalizeAudience = raw => ({
    studentKeys: new Set(),
    classKeys: raw?.classKeys instanceof Set ? raw.classKeys : new Set(raw?.classKeys || [])
  });
  const audienceFor = e => {
    if (typeof getAudience === "function") {
      try {
        const resolved = normalizeAudience(getAudience(e));
        if (resolved.classKeys.size) return resolved;
      } catch (err) {
        console.warn("Audience resolver failed:", err);
      }
    }
    return fallbackAudience(e);
  };
  const intersects = occSetsIntersect;
  const audienceGrades = (audience, entry) => {
    const out = new Set((entry?.gradeKeys?.length ? entry.gradeKeys : (entry?.gradeKey ? [entry.gradeKey] : []))
      .map(normalizeGradeForClassKey)
      .filter(Boolean));
    (audience?.classKeys || new Set()).forEach(key => {
      const grade = normalizeGradeForClassKey(String(key).split(":")[0]);
      if (grade) out.add(grade);
    });
    return out;
  };
  const audiencesOverlap = (a, b, entryA, entryB) => occAudiencesConflict(a, b);
  const normalizeGradeSet = set => new Set([...(set || [])].map(normalizeGradeForClassKey).filter(Boolean));
  const protectedGradesFor = entry => {
    if (typeof options.getProtectedGrades !== "function") return new Set();
    try { return normalizeGradeSet(options.getProtectedGrades(entry)); }
    catch (err) { console.warn("Protected grade resolver failed:", err); return new Set(); }
  };

  const rooms = Array.isArray(options.rooms) ? options.rooms : [];
  const roomMap = new Map(rooms.filter(r => r?.id).map(r => [r.id, r]));
  const isRoomUnavailable = (roomId, day, period) => {
    if (!roomId) return false;
    const room = roomMap.get(roomId);
    const slots = Array.isArray(room?.unavailableSlots) ? room.unavailableSlots : [];
    const d = Number(day);
    const p = Number(period);
    return slots.some(slot => Number(slot?.day) === d && Number(slot?.period) === p);
  };

  const compoundRefsFor = entry => {
    if (typeof options.getCompoundPartRefs !== "function") return [];
    try {
      return (options.getCompoundPartRefs(entry) || [])
        .filter(ref => ref && ref.key && ref.partId);
    } catch (err) {
      console.warn("Compound subject resolver failed:", err);
      return [];
    }
  };
  const hasInternalCompoundConflict = entry => {
    const seen = new Map();
    for (const ref of compoundRefsFor(entry)) {
      const prev = seen.get(ref.key);
      if (prev && (prev.partId !== ref.partId || prev.cardId !== ref.cardId)) return true;
      seen.set(ref.key, ref);
    }
    return false;
  };
  const hasCompoundSiblingConflict = (a, b) => {
    const refsA = compoundRefsFor(a);
    const refsB = compoundRefsFor(b);
    if (!refsA.length || !refsB.length) return false;
    return refsA.some(ra => refsB.some(rb =>
      ra.key === rb.key && (ra.partId !== rb.partId || ra.cardId !== rb.cardId)
    ));
  };

  // Room is required for scheduled lessons unless explicitly set to no-room.
  // Treat missing room as a first-class conflict so it appears in cards, detail popups and logs.
  entries.forEach(e => {
    const rule = String(e.roomRule || "auto").trim();
    if (!e.roomId && rule !== "none") result.get(e.id)?.add("roomMissing");
    if (e.roomId && isRoomUnavailable(e.roomId, e.day, e.period)) result.get(e.id)?.add("roomUnavailable");
    // 같은 대표 복합과목의 서로 다른 구성 카드가 하나의 aggregate entry 안에 같이 있으면
    // 실제로는 같은 학생이 같은 시간에 두 수업을 듣는 상태이므로 학생 충돌로 표시합니다.
    if (hasInternalCompoundConflict(e)) result.get(e.id)?.add("student");
  });

  const bySlot = new Map();
  entries.forEach(e => {
    const k = `${e.day}:${e.period}`;
    if (!bySlot.has(k)) bySlot.set(k, []);
    bySlot.get(k).push(e);
  });

  bySlot.forEach(slotEntries => {
    for (let i = 0; i < slotEntries.length; i++) {
      for (let j = i + 1; j < slotEntries.length; j++) {
        const a = slotEntries[i], b = slotEntries[j];

        // Same unit → intentionally co-located, skip all conflict checks
        if (sameUnit(a, b)) continue;

        // Same concurrent group → intentionally same-time parallel/level-split lessons.
        // It may share the same time, but it must still obey teacher/room conflicts.
        // Only same unit is treated as a truly co-located single lesson.
        const sameConcurrentGroup = sameGroup(a, b) && isConcurrent(a) && isConcurrent(b);

        // 복합 과목 구성 카드끼리는 같은 그룹에 속해 있어도 동시에 배치하면 안 됩니다.
        // 예: 선택5의 미적분(2) / 심화물리(2)는 같은 학생이 나누어 듣는 수업입니다.
        if (hasCompoundSiblingConflict(a, b)) {
          result.get(a.id).add("student");
          result.get(b.id).add("student");
        }

        // Teacher conflict (always applies — teachers can't be in two places)
        if (a.teacherName && b.teacherName) {
          const ta = splitTeacherNames(a.teacherName);
          const tb = splitTeacherNames(b.teacherName);
          if (ta.some(t => tb.includes(t))) {
            result.get(a.id).add("teacher");
            result.get(b.id).add("teacher");
          }
        }

        // Room conflict (cross-grade same unit shares room intentionally)
        if (a.roomId && b.roomId && a.roomId === b.roomId) {
          if (!sameUnit(a, b)) {
            result.get(a.id).add("room");
            result.get(b.id).add("room");
          }
        }

        // Class conflict — same concurrent group means intentional parallel/level-split lessons.
        // Student-level conflicts are not checked during timetable placement.
        const audienceA = audienceFor(a);
        const audienceB = audienceFor(b);
        if (sameConcurrentGroup) continue;

        // Class conflict — skip if cross-grade co-teaching in the same group
        if (sameGroup(a, b) && (isCrossGrade(a) || isCrossGrade(b))) continue; // cross-grade in same group

        // Class conflict: compare class audience overlap, not student IDs.
        const protectedA = protectedGradesFor(a);
        const protectedB = protectedGradesFor(b);
        const actualAudienceOverlap = audiencesOverlap(audienceA, audienceB, a, b);

        // Fallback only when a protected whole-grade entry has no concrete class audience.
        // This preserves protection for very old entries while avoiding false positives
        // when classKeys are available.
        const protectedFallbackOverlap =
          (protectedA.size && !audienceA.classKeys.size && intersects(protectedA, audienceGrades(audienceB, b))) ||
          (protectedB.size && !audienceB.classKeys.size && intersects(protectedB, audienceGrades(audienceA, a)));

        if (actualAudienceOverlap || protectedFallbackOverlap) {
          result.get(a.id).add("student");
          result.get(b.id).add("student");
        }
      }
    }
  });
  // ── syncRequired: concurrent group members must be together per occurrence ──
  // 여러 시수 수업은 1시수, 2시수, 3시수처럼 각 시수별로 별도 슬롯에 배정될 수 있습니다.
  // 따라서 같은 그룹이 여러 시간대에 있다고 해서 모두 오류로 보지 않습니다.
  // 각 시간대마다 해당 그룹의 카드 구성이 완성되어 있는지만 확인합니다.
  const concurrentGroups = new Map(); // groupId → [{entry, slotKey}]
  entries.forEach(e => {
    const grp = e.groupId ? groupMap.get(e.groupId) : null;
    const isConcurrentGroup = !!(grp?.isConcurrent || grp?.groupType === "concurrent");
    if (!isConcurrentGroup) return;
    if (!concurrentGroups.has(e.groupId)) concurrentGroups.set(e.groupId, []);
    concurrentGroups.get(e.groupId).push({ e, slot: `${e.day}:${e.period}` });
  });

  concurrentGroups.forEach((items, groupId) => {
    const group = groupMap.get(groupId);
    const expectedCardIds = unique([
      ...(group?.poolCardIds || []),
      ...((group?.units || []).flatMap(u => u.ttcardIds || []))
    ]);

    const slotMap = new Map();
    items.forEach(({ e, slot }) => {
      if (!slotMap.has(slot)) slotMap.set(slot, []);
      slotMap.get(slot).push(e);
    });

    if (expectedCardIds.length) {
      const plainExpectedIds = [];
      const compoundExpectedKeys = new Map(); // compoundKey → Set<cardId alternatives>
      expectedCardIds.forEach(id => {
        const refs = compoundRefsFor({ ttcardId: id });
        if (!refs.length) {
          plainExpectedIds.push(id);
          return;
        }
        refs.forEach(ref => {
          if (!compoundExpectedKeys.has(ref.key)) compoundExpectedKeys.set(ref.key, new Set());
          compoundExpectedKeys.get(ref.key).add(id);
        });
      });

      slotMap.forEach(slotEntries => {
        const covered = new Set(slotEntries.flatMap(entryCardIds));
        const plainComplete = plainExpectedIds.every(id => covered.has(id));
        const compoundComplete = [...compoundExpectedKeys.values()].every(ids => [...ids].some(id => covered.has(id)));
        const isComplete = plainComplete && compoundComplete;
        if (!isComplete) slotEntries.forEach(e => result.get(e.id).add("syncRequired"));
      });
      return;
    }

    // Legacy fallback: if there is no card-level group data, keep the older conservative behavior.
    if (slotMap.size > 1) items.forEach(({ e }) => result.get(e.id).add("syncRequired"));
  });

  return result;
}

/**
 * Returns Map<entryId, Set<"maxPerDay"|"maxConsecutive"|"unavailable">>
 */
export function detectConstraintViolations(entries, teacherConstraints = {}) {
  const result = new Map();
  entries.forEach(e => result.set(e.id, new Set()));

  // Build per-teacher, per-day entry lists
  const byTeacherDay = new Map();
  entries.forEach(e => {
    splitTeacherNames(e.teacherName).filter(Boolean).forEach(teacher => {
      const k = `${teacher}:${e.day}`;
      if (!byTeacherDay.has(k)) byTeacherDay.set(k, []);
      byTeacherDay.get(k).push(e);
    });
  });

  byTeacherDay.forEach((dayEntries, key) => {
    const teacher = key.split(":")[0];
    const c = teacherConstraints[teacher];
    if (!c) return;
    const sorted = [...dayEntries].sort((a, b) => a.period - b.period);

    // Max per day
    if (c.maxPerDay > 0 && sorted.length > c.maxPerDay) {
      sorted.forEach(e => result.get(e.id).add("maxPerDay"));
    }

    // Max consecutive
    if (c.maxConsecutive > 0) {
      for (let i = 0; i < sorted.length; i++) {
        let streak = 1, streak_entries = [sorted[i]];
        while (i + streak < sorted.length && sorted[i + streak].period === sorted[i].period + streak) {
          streak_entries.push(sorted[i + streak]); streak++;
        }
        if (streak > c.maxConsecutive) streak_entries.forEach(e => result.get(e.id).add("maxConsecutive"));
        i += streak - 1;
      }
    }

    // Unavailable slots
    if (Array.isArray(c.unavailableSlots)) {
      const dayNum = parseInt(key.split(":")[1]);
      sorted.forEach(e => {
        if (c.unavailableSlots.some(s => s.day === e.day && s.period === e.period)) {
          result.get(e.id).add("unavailable");
        }
      });
    }
  });
  return result;
}

export function getConflictLabel(set) {
  const labels = [];
  if (set.has("teacher")) labels.push("교사 중복");
  if (set.has("room"))    labels.push("교실 중복");
  if (set.has("roomUnavailable")) labels.push("교실 불가시간");
  if (set.has("roomMissing")) labels.push("교실 미배정");
  if (set.has("student")) labels.push("학급 중복");
  if (set.has("maxPerDay")) labels.push("일일 최대 초과");
  if (set.has("maxConsecutive")) labels.push("연속수업 초과");
  if (set.has("unavailable"))   labels.push("불가 시간대");
  if (set.has("syncRequired"))   labels.push("동시배정 불일치");
  return labels.join(", ");
}
