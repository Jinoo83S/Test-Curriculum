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

        // Student conflict — skip if: same concurrent group, or cross-grade co-teaching
        if (sameGroup(a, b) && isConcurrent(a) && isConcurrent(b)) continue; // parallel concurrent classes
        if (sameGroup(a, b) && (isCrossGrade(a) || isCrossGrade(b))) continue; // cross-grade in same group

        // Check grade overlap
        const gradesA = a.gradeKeys?.length ? a.gradeKeys : (a.gradeKey ? [a.gradeKey] : []);
        const gradesB = b.gradeKeys?.length ? b.gradeKeys : (b.gradeKey ? [b.gradeKey] : []);
        const gradeOverlap = gradesA.some(g => gradesB.includes(g));
        if (gradeOverlap) {
          result.get(a.id).add("student");
          result.get(b.id).add("student");
        }
      }
    }
  });
  // ── syncRequired: concurrent group units must share same day/period ──
  const concurrentGroups = new Map(); // groupId → [{entry, slotKey}]
  entries.forEach(e => {
    const grp = e.groupId ? groupMap.get(e.groupId) : null;
    if (!grp?.isConcurrent) return;
    if (!concurrentGroups.has(e.groupId)) concurrentGroups.set(e.groupId, []);
    concurrentGroups.get(e.groupId).push({ e, slot: `${e.day}:${e.period}` });
  });

  concurrentGroups.forEach((items, groupId) => {
    // Group items by their slot
    const slotMap = new Map();
    items.forEach(({ e, slot }) => {
      if (!slotMap.has(slot)) slotMap.set(slot, []);
      slotMap.get(slot).push(e);
    });
    if (slotMap.size <= 1) return; // all in same slot or only one slot → OK

    // Units are spread across different slots: mark all as syncRequired
    items.forEach(({ e }) => result.get(e.id).add("syncRequired"));
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
