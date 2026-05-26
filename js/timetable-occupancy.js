// ================================================================
// timetable-occupancy.js · Canonical timetable audience/occupancy
// ================================================================
// 이 파일의 목적:
// - 자동배치, 충돌검사, 상세보기, 로그가 모두 같은 기준으로 수업 점유 범위를 판단하게 합니다.
// - 시간표 사전작업에서 Firebase에 저장된 카드 데이터(classKeys/studentKeys/teacherNames)를 최우선으로 사용합니다.
// - 기존 데이터 호환을 위해 entry.audienceClassKeys, gradeKey/sectionIdx fallback도 유지합니다.

const clean = v => String(v ?? "").trim();
export const uniqueStrings = list => [...new Set((list || []).map(clean).filter(Boolean))];

export function normalizeGradeForClassKey(gradeKey) {
  return clean(gradeKey).replace(/학년/g, "").trim();
}

export function normalizeSectionForClassKey(section) {
  const compact = clean(section).replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
  if (!compact) return "";
  const m = compact.match(/^\d{1,2}(.+)$/);
  return m ? m[1] : compact;
}

export function makeClassKey(gradeKey, section) {
  const grade = normalizeGradeForClassKey(gradeKey);
  const sec = normalizeSectionForClassKey(section);
  return grade && sec ? `${grade}:${sec}` : "";
}

export function normalizeClassKey(value, fallbackGradeKey = "") {
  const raw = clean(value);
  if (!raw) return "";

  // Already canonical: 7:A, 10:B
  if (raw.includes(":")) {
    const [g, s] = raw.split(":");
    return makeClassKey(g, s);
  }

  // Display label: 7A, 8B, 10A, 8학년 A
  const compact = raw.replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
  const m = compact.match(/^(\d{1,2})(.+)$/);
  if (m) return makeClassKey(m[1], m[2]);

  return fallbackGradeKey ? makeClassKey(fallbackGradeKey, compact) : "";
}

export function formatClassLabelFromKey(key) {
  const normalized = normalizeClassKey(key);
  if (!normalized) return "";
  const [grade, section] = normalized.split(":");
  return `${grade}${section}`;
}

export function sectionLabel(index) {
  return String.fromCharCode(65 + Math.max(0, Number.isInteger(index) ? index : (parseInt(index, 10) || 0)));
}

export function ttCardIdsFromPlacement(x = {}) {
  return uniqueStrings([...(x.ttcardIds || []), x.ttcardId]);
}

export function teacherNamesFromValue(value) {
  if (Array.isArray(value)) return uniqueStrings(value.flatMap(teacherNamesFromValue));
  return clean(value).split(/[,，·]/).map(s => s.trim()).filter(Boolean);
}

export function getCardOccupancy(card = {}) {
  const classKeys = new Set();
  const classLabels = new Set();
  const studentKeys = new Set();
  const teacherNames = new Set();
  const ttcardIds = new Set();

  if (card?.id) ttcardIds.add(card.id);

  (card.classKeys || []).forEach(k => {
    const key = normalizeClassKey(k, card.gradeKey);
    if (key) {
      classKeys.add(key);
      classLabels.add(formatClassLabelFromKey(key));
    }
  });

  (card.classLabels || []).forEach(label => {
    const key = normalizeClassKey(label, card.gradeKey);
    if (key) {
      classKeys.add(key);
      classLabels.add(formatClassLabelFromKey(key));
    }
  });

  (card.studentKeys || []).forEach(k => { if (clean(k)) studentKeys.add(clean(k)); });
  teacherNamesFromValue(card.teacherNames || card.teachers || card.teacherName).forEach(t => teacherNames.add(t));

  // Legacy fallback: no stored audience → one grade/section card.
  if (!classKeys.size && card.gradeKey) {
    const key = makeClassKey(card.gradeKey, sectionLabel(card.sectionIdx ?? 0));
    if (key) {
      classKeys.add(key);
      classLabels.add(formatClassLabelFromKey(key));
    }
  }

  return { classKeys, classLabels, studentKeys, teacherNames, ttcardIds };
}

function mergeInto(target, source) {
  (source.classKeys || new Set()).forEach(v => target.classKeys.add(v));
  (source.classLabels || new Set()).forEach(v => target.classLabels.add(v));
  (source.studentKeys || new Set()).forEach(v => target.studentKeys.add(v));
  (source.teacherNames || new Set()).forEach(v => target.teacherNames.add(v));
  (source.ttcardIds || new Set()).forEach(v => target.ttcardIds.add(v));
  return target;
}

function emptyOccupancy() {
  return {
    classKeys: new Set(),
    classLabels: new Set(),
    studentKeys: new Set(),
    teacherNames: new Set(),
    roomIds: new Set(),
    ttcardIds: new Set(),
  };
}

export function getGroupCardIds(group = {}) {
  return uniqueStrings([
    ...(group.poolCardIds || []),
    ...((group.units || []).flatMap(u => u.ttcardIds || [])),
  ]);
}

export function getEntryOccupancy(entry = {}, ctx = {}) {
  const out = emptyOccupancy();
  const getTtCardById = ctx.getTtCardById || (() => null);
  const getGroupById = ctx.getGroupById || ((id) => (ctx.templateGroups || []).find(g => g.id === id));

  // 1. Entry snapshot audience saved at placement time.
  (entry.audienceClassKeys || []).forEach(k => {
    const key = normalizeClassKey(k, entry.gradeKey);
    if (key) {
      out.classKeys.add(key);
      out.classLabels.add(formatClassLabelFromKey(key));
    }
  });
  (entry.audienceStudentKeys || []).forEach(k => { if (clean(k)) out.studentKeys.add(clean(k)); });

  // 2. Card-level data is the source of truth.
  const directCardIds = ttCardIdsFromPlacement(entry);
  directCardIds.forEach(id => {
    const card = getTtCardById(id);
    if (card) mergeInto(out, getCardOccupancy(card));
    else out.ttcardIds.add(id);
  });

  // 3. Important fallback for old fixed group entries:
  // If entry has groupId but old entry.ttcardIds is empty/incomplete, load current group cards.
  if (entry.groupId) {
    const group = getGroupById(entry.groupId);
    getGroupCardIds(group).forEach(id => {
      if (out.ttcardIds.has(id)) return;
      const card = getTtCardById(id);
      if (card) mergeInto(out, getCardOccupancy(card));
      else out.ttcardIds.add(id);
    });
  }

  // 4. Legacy fallback if no card/audience information exists.
  if (!out.classKeys.size) {
    const grades = entry.gradeKeys?.length ? entry.gradeKeys : (entry.gradeKey ? [entry.gradeKey] : []);
    grades.forEach(grade => {
      const key = makeClassKey(grade, sectionLabel(entry.sectionIdx ?? 0));
      if (key) {
        out.classKeys.add(key);
        out.classLabels.add(formatClassLabelFromKey(key));
      }
    });
  }

  teacherNamesFromValue(entry.teacherNames || entry.teacherName).forEach(t => out.teacherNames.add(t));
  uniqueStrings([entry.roomId, ...(entry.roomIds || [])]).forEach(r => out.roomIds.add(r));

  return out;
}

export function setsIntersect(a = new Set(), b = new Set()) {
  for (const v of a) if (b.has(v)) return true;
  return false;
}

export function setIntersection(a = new Set(), b = new Set()) {
  const out = [];
  for (const v of a) if (b.has(v)) out.push(v);
  return out;
}

export function audienceGradeSet(occupancy = {}) {
  const out = new Set();
  (occupancy.classKeys || new Set()).forEach(key => {
    const grade = normalizeGradeForClassKey(String(key).split(":")[0]);
    if (grade) out.add(grade);
  });
  return out;
}

export function audiencesConflict(a = {}, b = {}) {
  // Actual student overlap wins when both sides have student data.
  if (a.studentKeys?.size && b.studentKeys?.size) return setsIntersect(a.studentKeys, b.studentKeys);

  // Different grades should never conflict merely because both are A section.
  const gradesA = audienceGradeSet(a);
  const gradesB = audienceGradeSet(b);
  if (gradesA.size && gradesB.size && !setsIntersect(gradesA, gradesB)) return false;

  return setsIntersect(a.classKeys || new Set(), b.classKeys || new Set());
}

export function conflictDetailBetween(a = {}, b = {}) {
  return {
    classKeys: setIntersection(a.classKeys, b.classKeys),
    studentKeys: setIntersection(a.studentKeys, b.studentKeys),
    teacherNames: setIntersection(a.teacherNames, b.teacherNames),
    roomIds: setIntersection(a.roomIds, b.roomIds),
  };
}
