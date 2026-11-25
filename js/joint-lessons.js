export const JOINT_LESSON_TERMS = ["sem1", "sem2"];

const clean = value => String(value ?? "").trim();
export const jointLessonRowKey = (grade, rowId) => JSON.stringify([grade, rowId]);

export function jointLessonHours(value) {
  const raw = clean(value);
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const hours = Number(raw);
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

export function normalizeJointLessons(raw) {
  if (!Array.isArray(raw)) return [];
  const groups = new Map();
  for (const group of raw) {
    const id = clean(group?.id), name = clean(group?.name);
    if (!id || !name || groups.has(id)) continue;
    const hours = Object.fromEntries(JOINT_LESSON_TERMS.map(term => [term, jointLessonHours(group.hours?.[term])]));
    const members = new Map();
    for (const member of Array.isArray(group.members) ? group.members : []) {
      const grade = clean(member?.grade), rowId = clean(member?.rowId);
      const sem1TemplateId = clean(member?.sem1TemplateId), sem2TemplateId = clean(member?.sem2TemplateId);
      if (grade && rowId && (sem1TemplateId || sem2TemplateId)) {
        members.set(jointLessonRowKey(grade, rowId), { grade, rowId, sem1TemplateId, sem2TemplateId });
      }
    }
    if (members.size >= 2 && Object.values(hours).some(hours => hours !== null)) {
      groups.set(id, { id, name, hours, members: [...members.values()] });
    }
  }
  return [...groups.values()];
}

export function indexJointLessons(curriculum, cards) {
  const board = new Map(Object.entries(curriculum?.gradeBoards || {}).flatMap(([grade, rows]) =>
    (rows || []).map(row => [jointLessonRowKey(grade, row.id), row])));
  const byTerm = { sem1: new Map(), sem2: new Map() };
  for (const group of normalizeJointLessons(curriculum?.jointLessons)) {
    for (const term of JOINT_LESSON_TERMS) {
      if (group.hours[term] === null) continue;
      const field = term + "TemplateId";
      const index = byTerm[term];
      const members = group.members.filter(member => {
        const key = jointLessonRowKey(member.grade, member.rowId);
        const id = member[field];
        return id && board.get(key)?.[field] === id && cards.has(id);
      });
      if (members.length < 2 || members.some(member => index.has(jointLessonRowKey(member.grade, member.rowId)))) continue;
      const grades = [...new Set(members.map(member => member.grade))].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
      const joint = { id: group.id, name: group.name, hours: group.hours[term], grades };
      for (const member of members) index.set(jointLessonRowKey(member.grade, member.rowId), joint);
    }
  }
  return byTerm;
}

export function moveJointLessonMembers(groups, grade, first, second) {
  // The cards have already swapped. Keep the group with the original course.
  const destinations = new Map([[first.id, second], [second.id, first]]);
  for (const group of groups || []) {
    for (const member of group.members || []) {
      const destination = member.grade === grade && destinations.get(member.rowId);
      if (destination && JOINT_LESSON_TERMS.some(term => {
        const field = term + "TemplateId";
        return member[field] && member[field] === destination[field];
      })) member.rowId = destination.id;
    }
  }
}
