// ================================================================
// timetable-conflicts.js · Pure Conflict Detection
// r190: strict conflict audit + card/class time-availability violations.
// ================================================================
import { splitTeacherNames } from "./templates.js";
import {
  getEntryOccupancy,
  setsIntersect as occSetsIntersect,
  audiencesConflict as occAudiencesConflict
} from "./timetable-occupancy.js";

/**
 * Returns Map<entryId, Set<"teacher"|"room"|"roomMissing"|"roomUnavailable"|"student"|"syncRequired">>
 *
 * r188 principle:
 * - 교사 충돌은 어떤 그룹/묶음 안에서도 숨기지 않습니다.
 * - 교실 충돌은 같은 unit/group/concurrent 안에서도 숨기지 않습니다.
 * - 학급 충돌도 concurrent/cross-grade 라는 이유만으로 자동 면제하지 않습니다.
 * - 선택/분반 수업을 허용하려면 실제 학생/로스터 분리가 되어 있어야 하며,
 *   단순히 같은 그룹이라는 이유로 충돌을 속이지 않습니다.
 */
export function detectConflicts(entries, templateGroups = [], templates = [], getAudience = null, options = {}) {
  const safeEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const result = new Map();
  safeEntries.forEach(e => result.set(e.id, new Set()));

  const unique = list => [...new Set((list || []).filter(Boolean))];
  const entryCardIds = e => unique([...(e?.ttcardIds || []), e?.ttcardId].filter(Boolean));

  const __getHard = (options && typeof options.getHardTeachers === "function") ? options.getHardTeachers : null;
  const bindingTeachersForEntry = e => {
    if (__getHard) {
      try {
        const r = __getHard(e);
        if (Array.isArray(r)) return unique(r.map(x => String(x || "").trim()).filter(Boolean));
      } catch (_) {}
    }
    return unique(splitTeacherNames(e?.teacherName || ""));
  };

  const tplGroupMap = new Map((templates || []).map(t => [t.id, t.calcGroupId || null]));
  const groupMap = new Map((templateGroups || []).map(g => [g.id, g]));
  const groupIdForEntry = e => e?.groupId || (e?.templateId ? tplGroupMap.get(e.templateId) : null) || null;
  const sameGroup = (a, b) => {
    const gA = groupIdForEntry(a);
    const gB = groupIdForEntry(b);
    return !!(gA && gB && gA === gB);
  };

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

  const normalizeAudience = raw => ({
    studentKeys: raw?.studentKeys instanceof Set ? raw.studentKeys : new Set(raw?.studentKeys || []),
    classKeys: raw?.classKeys instanceof Set ? raw.classKeys : new Set(raw?.classKeys || [])
  });
  const fallbackAudience = e => getEntryOccupancy(e);
  const audienceFor = e => {
    if (typeof getAudience === "function") {
      try {
        const resolved = normalizeAudience(getAudience(e));
        if (resolved.classKeys.size || resolved.studentKeys.size) return resolved;
      } catch (err) {
        console.warn("Audience resolver failed:", err);
      }
    }
    return normalizeAudience(fallbackAudience(e));
  };
  const intersects = occSetsIntersect;
  const audiencesOverlap = (a, b) => occAudiencesConflict(a, b);
  const normalizeGradeSet = set => new Set([...(set || [])].map(normalizeGradeForClassKey).filter(Boolean));
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
  const roomIdsForEntry = entry => {
    if (typeof options.getRoomIdsForEntry === "function") {
      try {
        const ids = options.getRoomIdsForEntry(entry) || [];
        return unique(ids.map(x => String(x || "").trim()).filter(Boolean));
      } catch (err) {
        console.warn("Room resolver failed:", err);
      }
    }
    return entry?.roomId ? [entry.roomId] : [];
  };
  const entryNeedsRoom = entry => {
    if (typeof options.entryNeedsRoom === "function") {
      try { return !!options.entryNeedsRoom(entry); }
      catch (err) { console.warn("Room requirement resolver failed:", err); }
    }
    const rule = String(entry?.roomRule || "auto").trim();
    return rule !== "none";
  };
  const entryHasRoomMissing = entry => {
    if (typeof options.entryHasRoomMissing === "function") {
      try { return !!options.entryHasRoomMissing(entry); }
      catch (err) { console.warn("Room missing resolver failed:", err); }
    }
    return !roomIdsForEntry(entry).length && entryNeedsRoom(entry);
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

  safeEntries.forEach(e => {
    const set = result.get(e.id);
    const roomIds = roomIdsForEntry(e);
    if (entryHasRoomMissing(e)) set?.add("roomMissing");
    if (roomIds.some(roomId => isRoomUnavailable(roomId, e.day, e.period))) set?.add("roomUnavailable");
    if (hasInternalCompoundConflict(e)) set?.add("student");
  });

  const bySlot = new Map();
  safeEntries.forEach(e => {
    const k = `${e.day}:${e.period}`;
    if (!bySlot.has(k)) bySlot.set(k, []);
    bySlot.get(k).push(e);
  });

  bySlot.forEach(slotEntries => {
    for (let i = 0; i < slotEntries.length; i += 1) {
      for (let j = i + 1; j < slotEntries.length; j += 1) {
        const a = slotEntries[i];
        const b = slotEntries[j];
        const setA = result.get(a.id);
        const setB = result.get(b.id);

        // r188: 같은 unit/group/concurrent/cross-grade라도 실제 교사 중복은 무조건 충돌입니다.
        const teachersA = bindingTeachersForEntry(a);
        const teachersB = bindingTeachersForEntry(b);
        if (teachersA.length && teachersB.length && teachersA.some(t => teachersB.includes(t))) {
          setA?.add("teacher");
          setB?.add("teacher");
        }

        // r188: 같은 unit/group 안의 공간 공유도 자동 면제하지 않습니다.
        const roomsA = roomIdsForEntry(a);
        const roomsB = roomIdsForEntry(b);
        if (roomsA.length && roomsB.length && roomsA.some(roomId => roomsB.includes(roomId))) {
          setA?.add("room");
          setB?.add("room");
        }

        if (hasCompoundSiblingConflict(a, b)) {
          setA?.add("student");
          setB?.add("student");
        }

        // r188: 같은 concurrent/cross-grade 그룹이라는 이유만으로 학급 충돌을 생략하지 않습니다.
        const audienceA = audienceFor(a);
        const audienceB = audienceFor(b);
        const protectedA = protectedGradesFor(a);
        const protectedB = protectedGradesFor(b);
        const actualAudienceOverlap = audiencesOverlap(audienceA, audienceB);
        const protectedFallbackOverlap =
          (protectedA.size && !audienceA.classKeys.size && intersects(protectedA, audienceGrades(audienceB, b))) ||
          (protectedB.size && !audienceB.classKeys.size && intersects(protectedB, audienceGrades(audienceA, a)));

        if (actualAudienceOverlap || protectedFallbackOverlap) {
          setA?.add("student");
          setB?.add("student");
        }
      }
    }
  });

  // syncRequired: concurrent group members must be together per occurrence.
  const concurrentGroups = new Map();
  safeEntries.forEach(e => {
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
      const compoundExpectedKeys = new Map();
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
        if (!(plainComplete && compoundComplete)) {
          slotEntries.forEach(e => result.get(e.id)?.add("syncRequired"));
        }
      });
      return;
    }

    if (slotMap.size > 1) items.forEach(({ e }) => result.get(e.id)?.add("syncRequired"));
  });

  return result;
}

/**
 * Returns Map<entryId, Set<"maxPerDay"|"maxConsecutive"|"unavailable"|"cardUnavailable"|"classUnavailable">>
 */
export function detectConstraintViolations(entries, teacherConstraints = {}, options = {}) {
  const safeEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const result = new Map();
  safeEntries.forEach(e => result.set(e.id, new Set()));

  const byTeacherDay = new Map();
  safeEntries.forEach(e => {
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

    if (c.maxPerDay > 0 && sorted.length > c.maxPerDay) {
      sorted.forEach(e => result.get(e.id)?.add("maxPerDay"));
    }

    if (c.maxConsecutive > 0) {
      for (let i = 0; i < sorted.length; i += 1) {
        let streak = 1;
        const streakEntries = [sorted[i]];
        while (i + streak < sorted.length && sorted[i + streak].period === sorted[i].period + streak) {
          streakEntries.push(sorted[i + streak]);
          streak += 1;
        }
        if (streak > c.maxConsecutive) streakEntries.forEach(e => result.get(e.id)?.add("maxConsecutive"));
        i += streak - 1;
      }
    }

    if (Array.isArray(c.unavailableSlots)) {
      sorted.forEach(e => {
        if (c.unavailableSlots.some(s => s.day === e.day && s.period === e.period)) {
          result.get(e.id)?.add("unavailable");
        }
      });
    }
  });

  const slotKey = e => `${Number(e?.day)}:${Number(e?.period)}`;
  const isSlotAllowed = (info, e) => {
    if (!info) return true;
    const key = slotKey(e);
    const allowed = Array.isArray(info.allowedSlots) ? info.allowedSlots.map(s => `${Number(s.day)}:${Number(s.period)}`) : [];
    const unavailable = Array.isArray(info.unavailableSlots) ? info.unavailableSlots.map(s => `${Number(s.day)}:${Number(s.period)}`) : [];
    if (allowed.length && !allowed.includes(key)) return false;
    if (unavailable.includes(key)) return false;
    return true;
  };

  safeEntries.forEach(e => {
    if (typeof options.getCardTimeInfo === "function") {
      const cardIds = typeof options.getEntryCardIds === "function" ? (options.getEntryCardIds(e) || []) : [...(e.ttcardIds || []), e.ttcardId].filter(Boolean);
      if (cardIds.some(id => !isSlotAllowed(options.getCardTimeInfo(id), e))) {
        result.get(e.id)?.add("cardUnavailable");
      }
    }
    if (typeof options.getClassTimeInfo === "function") {
      const classKeys = typeof options.getEntryClassKeys === "function" ? (options.getEntryClassKeys(e) || []) : (e.audienceClassKeys || []);
      if (classKeys.some(key => !isSlotAllowed(options.getClassTimeInfo(key), e))) {
        result.get(e.id)?.add("classUnavailable");
      }
    }
  });
  return result;
}

export function getConflictLabel(set) {
  const labels = [];
  if (set.has("teacher")) labels.push("교사 중복");
  if (set.has("room")) labels.push("교실 중복");
  if (set.has("roomUnavailable")) labels.push("교실 불가시간");
  if (set.has("roomMissing")) labels.push("교실 미배정");
  if (set.has("student")) labels.push("학급 중복");
  if (set.has("maxPerDay")) labels.push("일일 최대 초과");
  if (set.has("maxConsecutive")) labels.push("연속수업 초과");
  if (set.has("unavailable")) labels.push("교사 불가 시간대");
  if (set.has("cardUnavailable")) labels.push("과목카드 배정불가 시간");
  if (set.has("classUnavailable")) labels.push("반 수업불가 시간");
  if (set.has("syncRequired")) labels.push("동시배정 불일치");
  return labels.join(", ");
}
