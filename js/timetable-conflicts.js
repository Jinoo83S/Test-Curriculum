// ================================================================
// timetable-conflicts.js · Pure Conflict Detection
// ================================================================
import { splitTeacherNames } from "./templates.js";

/**
 * Returns Map<entryId, Set<"teacher"|"room"|"student"|"syncRequired">>
 *
 * getOccupancy(entry) is the single source of truth shared with timetable auto-assignment.
 * It should return any of these fields: { studentKeys, classKeys, teacherNames, roomIds, cardIds }.
 */
export function detectConflicts(entries, templateGroups = [], templates = [], getOccupancy = null) {
  const result = new Map();
  entries.forEach(e => result.set(e.id, new Set()));

  const tplGroupMap = new Map(templates.map(t => [t.id, t.calcGroupId || null]));
  const groupMap    = new Map(templateGroups.map(g => [g.id, g]));

  const unique = list => [...new Set((list || []).filter(Boolean))];
  const entryCardIds = e => unique([...(e.ttcardIds || []), e.ttcardId]);
  const toSet = v => v instanceof Set ? new Set(v) : new Set(Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []));
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

  const fallbackOccupancy = e => {
    const grades = e.gradeKeys?.length ? e.gradeKeys : (e.gradeKey ? [e.gradeKey] : []);
    const sec = sectionLabel(e.sectionIdx ?? 0);
    return {
      studentKeys: new Set(e.audienceStudentKeys || []),
      classKeys: new Set((e.audienceClassKeys?.length ? e.audienceClassKeys : grades.map(g => makeClassKey(g, sec))).filter(Boolean)),
      teacherNames: new Set(splitTeacherNames(e.teacherName || "").filter(Boolean)),
      roomIds: new Set(e.roomId ? [e.roomId] : []),
      cardIds: new Set(entryCardIds(e)),
    };
  };

  const normalizeOccupancy = (raw, entry) => {
    const fb = fallbackOccupancy(entry);
    const teacherRaw = raw?.teacherNames ?? raw?.teachers ?? splitTeacherNames(raw?.teacherName || entry?.teacherName || "");
    return {
      studentKeys: toSet(raw?.studentKeys ?? raw?.audienceStudentKeys ?? fb.studentKeys),
      classKeys: toSet(raw?.classKeys ?? raw?.audienceClassKeys ?? fb.classKeys),
      teacherNames: toSet(teacherRaw).size ? toSet(teacherRaw) : fb.teacherNames,
      roomIds: toSet(raw?.roomIds ?? (raw?.roomId ? [raw.roomId] : null)).size ? toSet(raw?.roomIds ?? (raw?.roomId ? [raw.roomId] : null)) : fb.roomIds,
      cardIds: toSet(raw?.cardIds ?? entryCardIds(entry)),
    };
  };

  const occupancyFor = e => {
    if (typeof getOccupancy === "function") {
      try { return normalizeOccupancy(getOccupancy(e), e); }
      catch (err) { console.warn("Occupancy resolver failed:", err); }
    }
    return fallbackOccupancy(e);
  };

  const intersects = (a, b) => { for (const v of a) if (b.has(v)) return true; return false; };
  const intersection = (a, b) => { const out = []; for (const v of a) if (b.has(v)) out.push(v); return out; };
  const occupancyGrades = occ => {
    const out = new Set();
    (occ?.classKeys || new Set()).forEach(key => {
      const grade = normalizeGradeForClassKey(String(key).split(":")[0]);
      if (grade) out.add(grade);
    });
    return out;
  };
  const studentOverlap = (a, b) => {
    if (a.studentKeys.size && b.studentKeys.size) return intersects(a.studentKeys, b.studentKeys);
    const gradesA = occupancyGrades(a);
    const gradesB = occupancyGrades(b);
    if (gradesA.size && gradesB.size && !intersects(gradesA, gradesB)) return false;
    return intersects(a.classKeys, b.classKeys);
  };

  const getGroupForEntry = e => e.groupId ? groupMap.get(e.groupId) : (e.templateId ? groupMap.get(tplGroupMap.get(e.templateId)) : null);
  const sameUnit  = (a, b) => a.unitId && b.unitId && a.unitId === b.unitId;

  const bySlot = new Map();
  entries.forEach(e => {
    const k = `${e.day}:${e.period}`;
    if (!bySlot.has(k)) bySlot.set(k, []);
    bySlot.get(k).push(e);
  });

  bySlot.forEach(slotEntries => {
    const occById = new Map(slotEntries.map(e => [e.id, occupancyFor(e)]));
    for (let i = 0; i < slotEntries.length; i++) {
      for (let j = i + 1; j < slotEntries.length; j++) {
        const a = slotEntries[i], b = slotEntries[j];
        if (sameUnit(a, b)) continue;
        const oa = occById.get(a.id), ob = occById.get(b.id);

        // Teacher conflict: always based on the same teacherNames set used by auto-assignment.
        if (intersection(oa.teacherNames, ob.teacherNames).length) {
          result.get(a.id).add("teacher");
          result.get(b.id).add("teacher");
        }

        // Room conflict: includes manually assigned room and teacher home/assigned room when resolver provides it.
        if (intersection(oa.roomIds, ob.roomIds).length) {
          result.get(a.id).add("room");
          result.get(b.id).add("room");
        }

        // Student/class conflict: no special same-group shortcut. If two concurrent cards really have
        // different studentKeys they are allowed; if studentKeys are missing, same classKeys conflict.
        if (studentOverlap(oa, ob)) {
          result.get(a.id).add("student");
          result.get(b.id).add("student");
        }
      }
    }
  });

  // ── syncRequired: concurrent group members must be together per occurrence ──
  const concurrentGroups = new Map();
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
      slotMap.forEach(slotEntries => {
        const covered = new Set(slotEntries.flatMap(e => [...(occupancyFor(e).cardIds || new Set())]));
        const isComplete = expectedCardIds.every(id => covered.has(id));
        if (!isComplete) slotEntries.forEach(e => result.get(e.id).add("syncRequired"));
      });
      return;
    }

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
  if (set.has("student")) labels.push("학생 중복");
  if (set.has("maxPerDay")) labels.push("일일 최대 초과");
  if (set.has("maxConsecutive")) labels.push("연속수업 초과");
  if (set.has("unavailable"))   labels.push("불가 시간대");
  if (set.has("syncRequired"))   labels.push("동시배정 불일치");
  return labels.join(", ");
}
