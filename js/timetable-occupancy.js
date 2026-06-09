// ================================================================
// timetable-occupancy.js · Canonical timetable audience/occupancy
// ================================================================
// 이 파일의 목적:
// - 자동배치, 충돌검사, 상세보기, 로그가 모두 같은 기준으로 수업 점유 범위를 판단하게 합니다.
// - 시간표 사전작업에서 Firebase에 저장된 카드 데이터(classKeys/teacherNames)를 최우선으로 사용합니다.
// - 학생 개인 단위 충돌은 사전작업(학생배정, 그룹묶음)에서 이미 해결하므로 시간표 배치 단계에서는 studentKeys를 사용하지 않습니다.
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

function isStrictWholeGradeText(...values) {
  const text = values.map(clean).filter(Boolean).join(" ");
  if (!text) return false;
  // CA/SA 단독 표기는 교과군일 수 있으므로 여기서는 전체학년 보호 키워드로 보지 않습니다.
  return /(창체|채플|chapel|ms\s*채플|자율|동아리|전체|전학년|whole\s*grade|all\s*grade)/i.test(text);
}

function classKeyGrades(classKeys = new Set()) {
  const out = new Set();
  (classKeys || new Set()).forEach(key => {
    const g = normalizeGradeForClassKey(String(key).split(":")[0]);
    if (g) out.add(g);
  });
  return out;
}

function collapseStaleWholeGradeCardAudience(card = {}, occupancy) {
  // 2026-06-09 기준: 시간표 카드는 studentKeys를 사용하지 않고 classKeys/classLabels가
  // 실제 수업 점유 범위의 기준입니다. 선택과목 그룹(예: 11선택4, 12선택5)은 한 카드가
  // 여러 학반을 의도적으로 막아야 하므로, 여러 classKeys를 sectionIdx 한 반으로 접으면
  // 공통/선택 과목이 같은 시간에 중복 배치되는 심각한 오류가 생깁니다.
  // 따라서 카드에 저장된 classKeys/classLabels를 그대로 신뢰합니다.
  return occupancy;
}

export function getCardOccupancy(card = {}) {
  const classKeys = new Set();
  const classLabels = new Set();
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

  // studentKeys는 배치 점유/충돌 판정에 사용하지 않습니다.
  teacherNamesFromValue(card.teacherNames || card.teachers || card.teacherName).forEach(t => teacherNames.add(t));

  // Legacy fallback: no stored audience → one grade/section card.
  if (!classKeys.size && card.gradeKey) {
    const key = makeClassKey(card.gradeKey, sectionLabel(card.sectionIdx ?? 0));
    if (key) {
      classKeys.add(key);
      classLabels.add(formatClassLabelFromKey(key));
    }
  }

  return collapseStaleWholeGradeCardAudience(card, { classKeys, classLabels, teacherNames, ttcardIds });
}

function mergeInto(target, source) {
  (source.classKeys || new Set()).forEach(v => target.classKeys.add(v));
  (source.classLabels || new Set()).forEach(v => target.classLabels.add(v));
  (source.teacherNames || new Set()).forEach(v => target.teacherNames.add(v));
  (source.ttcardIds || new Set()).forEach(v => target.ttcardIds.add(v));
  return target;
}

function emptyOccupancy() {
  return {
    classKeys: new Set(),
    classLabels: new Set(),
    studentKeys: new Set(), // legacy shape only; collision logic intentionally ignores it.
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

  const directCardIds = ttCardIdsFromPlacement(entry);

  // 1. Card-level data is the source of truth.
  // 기존 entry.audienceClassKeys에는 과거 CA/SA 오판으로 9:A+9:B처럼
  // 넓게 저장된 값이 남아 있을 수 있습니다. 카드 데이터가 존재하면
  // stale snapshot을 합치지 않고 카드 기준으로 점유 범위를 다시 계산합니다.
  let cardAudienceFound = false;
  directCardIds.forEach(id => {
    const card = getTtCardById(id);
    if (card) {
      cardAudienceFound = true;
      mergeInto(out, getCardOccupancy(card));
    } else {
      out.ttcardIds.add(id);
    }
  });

  // 2. Entry snapshot audience saved at placement time.
  // 카드가 없거나 카드에 학급 정보가 없을 때만 호환용으로 사용합니다.
  if (!cardAudienceFound || !out.classKeys.size) {
    (entry.audienceClassKeys || []).forEach(k => {
      const key = normalizeClassKey(k, entry.gradeKey);
      if (key) {
        out.classKeys.add(key);
        out.classLabels.add(formatClassLabelFromKey(key));
      }
    });
    // entry.audienceStudentKeys는 legacy 데이터 호환을 위해 읽지 않습니다.
  }

  // 3. Legacy fallback for old group entries only.
  // Important: a normal grouped card entry can have entry.groupId while still representing
  // only one class/card (for example 9A and 9B cards in the same group).
  // If we always merge every card in the group, each entry becomes 9A+9B and different
  // sections are incorrectly marked as a class conflict.
  // Therefore we load group-wide cards only when the entry has no concrete card/audience
  // snapshot at all.
  if (entry.groupId && !directCardIds.length && !out.classKeys.size) {
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
  const classA = a.classKeys || new Set();
  const classB = b.classKeys || new Set();

  // HIS 시간표 편성 기준:
  // 학생 개인 단위 충돌은 사전작업(학생배정, 수강명단, 동시배정 그룹)에서 이미 해결합니다.
  // 시간표 배치 단계에서는 같은 학급/반이 같은 요일·교시에 두 과목을 듣는지만 봅니다.
  // 따라서 studentKeys는 충돌 판정에 사용하지 않습니다.
  if (classA.size && classB.size) return setsIntersect(classA, classB);

  // classKeys가 없는 매우 오래된 데이터는 학년 범위가 명확히 다를 때만 안전하게 비충돌 처리합니다.
  const gradesA = audienceGradeSet(a);
  const gradesB = audienceGradeSet(b);
  if (gradesA.size && gradesB.size && !setsIntersect(gradesA, gradesB)) return false;

  // 반 정보가 없으면 학생키로 억지 판단하지 않습니다.
  return false;
}

export function conflictDetailBetween(a = {}, b = {}) {
  return {
    classKeys: setIntersection(a.classKeys, b.classKeys),
    studentKeys: [],
    teacherNames: setIntersection(a.teacherNames, b.teacherNames),
    roomIds: setIntersection(a.roomIds, b.roomIds),
  };
}
