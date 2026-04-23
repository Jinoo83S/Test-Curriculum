// ================================================================
// timetable-conflicts.js · Pure Conflict Detection
// ================================================================
import { splitTeacherNames } from "./templates.js";

/**
 * Returns Map<entryId, Set<"teacher"|"room"|"student">>
 */
export function detectConflicts(entries, templateGroups = [], templates = []) {
  const result = new Map();
  entries.forEach(e => result.set(e.id, new Set()));

  // Pre-build lookup: templateId → calcGroupId
  const tplGroupMap = new Map(templates.map(t => [t.id, t.calcGroupId || null]));
  const groupTypeMap = new Map(templateGroups.map(g => [g.id, g.groupType]));

  const isConcurrent = tid => {
    const gid = tplGroupMap.get(tid);
    return gid ? groupTypeMap.get(gid) === "concurrent" : false;
  };
  const isCrossGrade = tid => {
    const gid = tplGroupMap.get(tid);
    return gid ? groupTypeMap.get(gid) === "cross-grade" : false;
  };
  const sameGroup = (tidA, tidB) => {
    const g = tplGroupMap.get(tidA);
    return g && g === tplGroupMap.get(tidB);
  };

  // Group by slot
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

        // Teacher conflict — always applies
        if (a.teacherName && b.teacherName) {
          const ta = splitTeacherNames(a.teacherName);
          const tb = splitTeacherNames(b.teacherName);
          if (ta.some(t => tb.includes(t))) {
            result.get(a.id).add("teacher");
            result.get(b.id).add("teacher");
          }
        }

        // Room conflict — always applies
        if (a.roomId && b.roomId && a.roomId === b.roomId) {
          result.get(a.id).add("room");
          result.get(b.id).add("room");
        }

        // Student conflict
        // cross-grade same group → intentionally together, no conflict
        if (isCrossGrade(a.templateId) && isCrossGrade(b.templateId) && sameGroup(a.templateId, b.templateId)) continue;
        // Same grade + concurrent same group → intentionally parallel, no conflict
        if (a.gradeKey === b.gradeKey && isConcurrent(a.templateId) && isConcurrent(b.templateId) && sameGroup(a.templateId, b.templateId)) continue;
        // Same grade → student conflict
        if (a.gradeKey && b.gradeKey && a.gradeKey === b.gradeKey) {
          result.get(a.id).add("student");
          result.get(b.id).add("student");
        }
      }
    }
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
  if (set.has("unavailable")) labels.push("불가 시간대");
  return labels.join(", ");
}
