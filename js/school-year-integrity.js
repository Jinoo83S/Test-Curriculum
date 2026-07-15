// ================================================================
// school-year-integrity.js · Academic-year workspace validation
// ================================================================
// Pure validation logic. It does not read Firestore directly and can be
// exercised with exported diagnostics or local-development snapshots.

export const SCHOOL_YEAR_INTEGRITY_BUILD = "2026-07-14-school-year-isolation-r351";
export const INTEGRITY_SCHEMA_VERSION = 1;

const COPY_COUNT_KEYS = [
  "curriculumRows", "templates", "classes", "students", "teachers", "rooms",
  "rosterSubjects", "rosterEntries", "timetableEntries", "ttcards",
  "ttcardGroups", "periodCount"
];
const MAX_ISSUES = 300;

const clean = value => String(value ?? "").trim();
const asArray = value => Array.isArray(value) ? value : [];
const asObject = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};

function docData(value) {
  if (!value || typeof value !== "object") return {};
  if (value.data && typeof value.data === "object") return { id: clean(value.id || value.data.id), ...value.data };
  return value;
}

function collectionData(value) {
  return asArray(value).map(docData);
}

function domainData(snapshot, name) {
  const domains = asObject(snapshot?.domains);
  return asObject(domains[name]);
}

function uniqueStrings(values) {
  return [...new Set(asArray(values).map(clean).filter(Boolean))];
}

function roomRefs(value) {
  const obj = asObject(value);
  const refs = [obj.roomId, obj.fixedRoomId, obj.defaultFixedRoomId];
  ["roomIds", "manualRoomIds", "fixedRoomIds", "requiredRoomIds", "solverFixedRoomIds"].forEach(key => {
    refs.push(...asArray(obj[key]));
  });
  Object.values(asObject(obj.roomAssignmentsByTtCardId)).forEach(id => refs.push(id));
  return uniqueStrings(refs);
}

function cardRefs(value) {
  const obj = asObject(value);
  return uniqueStrings([obj.ttcardId, ...asArray(obj.ttcardIds)]);
}

function templateRefs(value) {
  const obj = asObject(value);
  return uniqueStrings([obj.templateId, ...asArray(obj.templateIds)]);
}

function classKeysForClass(item) {
  const grade = clean(item?.grade).match(/\d+/)?.[0] || "";
  const name = clean(item?.name).replace(/\s+/g, "").toUpperCase();
  return uniqueStrings([
    item?.classKey,
    grade && name ? `${grade}:${name}` : "",
    grade && name ? `${grade}${name}` : "",
  ]);
}

function splitTeacherNames(value) {
  return clean(value).split(/[,，;；/]+/).map(clean).filter(Boolean);
}

function stableHash(text) {
  let hash = 2166136261;
  const str = String(text || "");
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function duplicateValues(items, keyFn) {
  const counts = new Map();
  items.forEach(item => {
    const key = clean(keyFn(item));
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

function issueCollector() {
  const errors = [];
  const warnings = [];
  const add = (level, code, message, context = {}) => {
    const target = level === "error" ? errors : warnings;
    if (target.length >= MAX_ISSUES) return;
    target.push({ level, code, message, ...context });
  };
  return {
    errors, warnings,
    error(code, message, context) { add("error", code, message, context); },
    warn(code, message, context) { add("warning", code, message, context); },
  };
}

export function normalizeWorkspaceSnapshot(raw = {}) {
  const snapshot = asObject(raw);
  const domains = asObject(snapshot.domains);
  const curriculum = asObject(domains.curriculum || snapshot.curriculum);
  const templates = asObject(domains.templates || snapshot.templates);
  const teachers = asObject(domains.teachers || snapshot.teachers);
  const rooms = asObject(domains.rooms || snapshot.rooms);
  const classesFallback = asObject(domains.classes || snapshot.classesDomain);
  const rostersFallback = asObject(domains.rosters || snapshot.rostersDomain);
  const timetableFallback = asObject(domains.timetable || snapshot.timetableDomain);

  const splitClasses = collectionData(snapshot.classes);
  const splitRosters = collectionData(asArray(snapshot.rosters).length ? snapshot.rosters : snapshot.rosterDocs);
  const splitEntries = collectionData(snapshot.timetableEntries);
  const splitCards = collectionData(snapshot.ttcards);
  const timetableMeta = asObject(snapshot.timetableMeta);

  const classes = splitClasses.length ? splitClasses : asArray(classesFallback.classes).map(docData);
  const rosterDocs = splitRosters.length
    ? splitRosters
    : Object.entries(asObject(rostersFallback.rosters)).map(([templateId, entries]) => ({
        id: templateId,
        templateId,
        entries: asArray(entries),
        meta: asObject(rostersFallback.rosterMeta)[templateId] || {},
      }));
  const entries = splitEntries.length ? splitEntries : asArray(timetableFallback.entries).map(docData);
  const cards = splitCards.length ? splitCards : asArray(timetableFallback.ttcards).map(docData);
  const effectiveMeta = Object.keys(timetableMeta).length ? timetableMeta : timetableFallback;

  return {
    year: clean(snapshot.year || snapshot.workspaceMeta?.year),
    domains: { curriculum, templates, teachers, rooms },
    curriculum,
    templates,
    teachers,
    rooms,
    classes,
    rosterDocs,
    timetableEntries: entries,
    ttcards: cards,
    timetableMeta: effectiveMeta,
    workspaceMeta: asObject(snapshot.workspaceMeta),
  };
}

export function summarizeWorkspaceSnapshot(raw = {}) {
  const snapshot = normalizeWorkspaceSnapshot(raw);
  const gradeBoards = asObject(snapshot.curriculum.gradeBoards);
  const curriculumByGrade = {};
  Object.entries(gradeBoards).forEach(([grade, rows]) => { curriculumByGrade[grade] = asArray(rows).length; });
  const classes = snapshot.classes;
  const rosterDocs = snapshot.rosterDocs;
  const cards = snapshot.ttcards;
  const entries = snapshot.timetableEntries;
  const groups = asArray(snapshot.timetableMeta.ttcardGroups || snapshot.timetableMeta.templateGroups);
  const periodCount = Math.max(0, Number(snapshot.timetableMeta.config?.periodCount || 0) || 0);

  return {
    curriculumByGrade,
    curriculumRows: Object.values(curriculumByGrade).reduce((sum, value) => sum + Number(value || 0), 0),
    templates: asArray(snapshot.templates.templates).length,
    classes: classes.length,
    students: classes.reduce((sum, item) => sum + asArray(item.students).length, 0),
    teachers: asArray(snapshot.teachers.teachers).length,
    rooms: asArray(snapshot.rooms.rooms).length,
    rosterSubjects: rosterDocs.length,
    rosterEntries: rosterDocs.reduce((sum, item) => sum + asArray(item.entries).length, 0),
    timetableEntries: entries.length,
    ttcards: cards.length,
    ttcardGroups: groups.length,
    periodCount,
  };
}

export function compareWorkspaceCounts(sourceCounts = {}, targetCounts = {}, { strict = false } = {}) {
  const differences = [];
  COPY_COUNT_KEYS.forEach(key => {
    const source = Number(sourceCounts[key] || 0);
    const target = Number(targetCounts[key] || 0);
    if (source !== target) differences.push({ key, source, target, delta: target - source, strict });
  });
  const sourceGrades = asObject(sourceCounts.curriculumByGrade);
  const targetGrades = asObject(targetCounts.curriculumByGrade);
  [...new Set([...Object.keys(sourceGrades), ...Object.keys(targetGrades)])].sort().forEach(grade => {
    const source = Number(sourceGrades[grade] || 0);
    const target = Number(targetGrades[grade] || 0);
    if (source !== target) differences.push({ key: `curriculumByGrade.${grade}`, source, target, delta: target - source, strict });
  });
  return differences;
}

export function validateWorkspaceSnapshot(raw = {}, options = {}) {
  const snapshot = normalizeWorkspaceSnapshot(raw);
  const counts = summarizeWorkspaceSnapshot(snapshot);
  const issues = issueCollector();
  const strictCopy = options.strictCopy === true;
  const draftMode = options.allowEmpty === true;

  const templates = asArray(snapshot.templates.templates);
  const templateIds = new Set(templates.map(item => clean(item.id)).filter(Boolean));
  const templateById = new Map(templates.map(item => [clean(item.id), item]).filter(([id]) => id));
  const teacherItems = asArray(snapshot.teachers.teachers);
  const teacherNames = new Set(teacherItems.map(item => clean(item.name)).filter(Boolean));
  const roomItems = asArray(snapshot.rooms.rooms);
  const roomIds = new Set(roomItems.map(item => clean(item.id)).filter(Boolean));
  const classes = snapshot.classes;
  const classIds = new Set(classes.map(item => clean(item.id)).filter(Boolean));
  const classKeySet = new Set();
  const studentByClass = new Map();
  const globalStudentIds = new Set();

  duplicateValues(templates, item => item.id).forEach(id => issues.error("duplicate-template-id", `과목카드 ID가 중복됩니다: ${id}`, { id }));
  duplicateValues(classes, item => item.id).forEach(id => issues.error("duplicate-class-id", `학급 ID가 중복됩니다: ${id}`, { id }));
  duplicateValues(teacherItems, item => item.id).forEach(id => issues.error("duplicate-teacher-id", `교사 ID가 중복됩니다: ${id}`, { id }));
  duplicateValues(teacherItems, item => item.name).forEach(name => issues.warn("duplicate-teacher-name", `교사명이 중복됩니다: ${name}`, { name }));
  duplicateValues(roomItems, item => item.id).forEach(id => issues.error("duplicate-room-id", `교실 ID가 중복됩니다: ${id}`, { id }));
  duplicateValues(roomItems, item => item.name).forEach(name => issues.warn("duplicate-room-name", `교실명이 중복됩니다: ${name}`, { name }));

  classes.forEach(cls => {
    classKeysForClass(cls).forEach(key => classKeySet.add(key));
    const students = asArray(cls.students);
    const studentIds = new Set();
    duplicateValues(students, item => item.id).forEach(id => issues.error("duplicate-student-id-in-class", `${clean(cls.grade)} ${clean(cls.name)} 학급에 학생 ID가 중복됩니다: ${id}`, { classId: clean(cls.id), studentId: id }));
    students.forEach(student => {
      const id = clean(student.id);
      if (!id) {
        issues.error("student-id-missing", `${clean(cls.grade)} ${clean(cls.name)} 학급에 ID가 없는 학생이 있습니다.`, { classId: clean(cls.id) });
        return;
      }
      studentIds.add(id);
      if (globalStudentIds.has(id)) issues.error("duplicate-student-id-global", `학생 ID가 여러 학급에서 중복됩니다: ${id}`, { studentId: id });
      globalStudentIds.add(id);
    });
    studentByClass.set(clean(cls.id), studentIds);
  });

  Object.entries(asObject(snapshot.curriculum.gradeBoards)).forEach(([grade, rows]) => {
    duplicateValues(asArray(rows), item => item.id).forEach(id => issues.error("duplicate-curriculum-row-id", `${grade} 편제 행 ID가 중복됩니다: ${id}`, { grade, id }));
    asArray(rows).forEach(row => {
      ["sem1TemplateId", "sem2TemplateId"].forEach(field => {
        const id = clean(row?.[field]);
        if (id && !templateIds.has(id)) issues.error("curriculum-template-missing", `${grade} 편제의 ${field}가 존재하지 않는 과목카드를 참조합니다: ${id}`, { grade, rowId: clean(row?.id), templateId: id });
      });
    });
  });

  snapshot.rosterDocs.forEach(doc => {
    const templateId = clean(doc.templateId || doc.id);
    if (!templateId) issues.error("roster-template-id-missing", "수강명단 문서에 과목카드 ID가 없습니다.", { rosterId: clean(doc.id) });
    else if (!templateIds.has(templateId)) issues.error("roster-template-missing", `수강명단이 존재하지 않는 과목카드를 참조합니다: ${templateId}`, { templateId });
    const seenRows = new Set();
    asArray(doc.entries).forEach(entry => {
      const classId = clean(entry.classId);
      const studentId = clean(entry.studentId);
      const rowKey = `${classId}|${studentId}|${Number.isInteger(entry.sectionIdx) ? entry.sectionIdx : 0}`;
      if (seenRows.has(rowKey)) issues.error("duplicate-roster-entry", `수강명단에 동일 학생이 중복됩니다: ${templateId} / ${classId} / ${studentId}`, { templateId, classId, studentId });
      seenRows.add(rowKey);
      if (!classIds.has(classId)) {
        issues.error("roster-class-missing", `수강명단이 존재하지 않는 학급을 참조합니다: ${classId}`, { templateId, classId, studentId });
        return;
      }
      if (!studentByClass.get(classId)?.has(studentId)) issues.error("roster-student-missing", `수강명단 학생이 해당 학급에 존재하지 않습니다: ${studentId}`, { templateId, classId, studentId });
    });
  });

  roomItems.forEach(room => {
    const classId = clean(room.homeRoomClassId || room.homeRoomId);
    if (classId && !classIds.has(classId)) issues.error("room-homeroom-class-missing", `교실 ${clean(room.name)}의 홈룸 학급이 존재하지 않습니다: ${classId}`, { roomId: clean(room.id), classId });
    splitTeacherNames(room.teacherName).forEach(name => {
      if (!teacherNames.has(name)) issues.warn("room-teacher-name-missing", `교실 ${clean(room.name)}의 담당교사명이 교사 목록에 없습니다: ${name}`, { roomId: clean(room.id), teacherName: name });
    });
  });

  templates.forEach(template => {
    splitTeacherNames(template.teacher).forEach(name => {
      if (!teacherNames.has(name)) issues.warn("template-teacher-name-missing", `과목카드 ${clean(template.nameKo || template.nameEn || template.id)}의 교사명이 교사 목록에 없습니다: ${name}`, { templateId: clean(template.id), teacherName: name });
    });
  });

  const cards = snapshot.ttcards;
  const cardIds = new Set(cards.map(item => clean(item.id)).filter(Boolean));
  const cardById = new Map(cards.map(item => [clean(item.id), item]).filter(([id]) => id));
  duplicateValues(cards, item => item.id).forEach(id => issues.error("duplicate-ttcard-id", `시간표 카드 ID가 중복됩니다: ${id}`, { id }));

  cards.forEach(card => {
    const cardId = clean(card.id);
    const isManual = card.isManual === true || cardId.startsWith("ttc_manual") || clean(card.templateId).startsWith("manual_");
    const templateId = clean(card.templateId);
    if (!cardId) issues.error("ttcard-id-missing", "ID가 없는 시간표 카드가 있습니다.");
    if (!isManual && templateId && !templateIds.has(templateId)) issues.error("ttcard-template-missing", `시간표 카드가 존재하지 않는 과목카드를 참조합니다: ${templateId}`, { cardId, templateId });
    uniqueStrings(card.classKeys).forEach(key => {
      if (!classKeySet.has(key)) issues.error("ttcard-class-missing", `시간표 카드가 존재하지 않는 학급 키를 참조합니다: ${key}`, { cardId, classKey: key });
    });
    roomRefs(card).forEach(roomId => {
      if (!roomIds.has(roomId)) issues.error("ttcard-room-missing", `시간표 카드가 존재하지 않는 교실을 참조합니다: ${roomId}`, { cardId, roomId });
    });
    const parentId = clean(card.compoundParentTemplateId);
    const partId = clean(card.compoundPartId);
    if (parentId) {
      const parent = templateById.get(parentId);
      if (!parent) issues.error("compound-parent-template-missing", `복합 시간표 카드의 원본 과목카드가 없습니다: ${parentId}`, { cardId, templateId: parentId });
      else if (partId && !asArray(parent.compoundParts).some(part => clean(part.id) === partId)) issues.error("compound-part-missing", `복합 시간표 카드의 세부 과목이 원본에 없습니다: ${partId}`, { cardId, templateId: parentId, partId });
    }
    uniqueStrings([card.teacherName, ...asArray(card.teachers)]).flatMap(splitTeacherNames).forEach(name => {
      if (!teacherNames.has(name) && clean(card.teacherMode) !== "none") issues.warn("ttcard-teacher-name-missing", `시간표 카드 ${clean(card.subject || card.label || cardId)}의 교사명이 교사 목록에 없습니다: ${name}`, { cardId, teacherName: name });
    });
  });

  const groups = asArray(snapshot.timetableMeta.ttcardGroups || snapshot.timetableMeta.templateGroups);
  const groupIds = new Set(groups.map(item => clean(item.id)).filter(Boolean));
  duplicateValues(groups, item => item.id).forEach(id => issues.error("duplicate-ttcard-group-id", `시간표 그룹 ID가 중복됩니다: ${id}`, { id }));
  groups.forEach(group => {
    const groupId = clean(group.id);
    asArray(group.units).forEach(unit => {
      uniqueStrings(unit.templateIds).forEach(templateId => {
        if (!templateIds.has(templateId)) issues.error("group-template-missing", `그룹 ${clean(group.name || groupId)}이 존재하지 않는 과목카드를 참조합니다: ${templateId}`, { groupId, templateId });
      });
      uniqueStrings(unit.ttcardIds).forEach(cardId => {
        if (!cardIds.has(cardId)) issues.error("group-ttcard-missing", `그룹 ${clean(group.name || groupId)}이 존재하지 않는 시간표 카드를 참조합니다: ${cardId}`, { groupId, cardId });
      });
    });
    uniqueStrings([...asArray(group.poolCardIds), ...asArray(group.excludedCardIds)]).forEach(cardId => {
      if (!cardIds.has(cardId)) issues.error("group-pool-card-missing", `그룹 ${clean(group.name || groupId)}의 카드 참조가 존재하지 않습니다: ${cardId}`, { groupId, cardId });
    });
    roomRefs(group).forEach(roomId => {
      if (!roomIds.has(roomId)) issues.error("group-room-missing", `그룹 ${clean(group.name || groupId)}이 존재하지 않는 교실을 참조합니다: ${roomId}`, { groupId, roomId });
    });
    const linked = clean(group.linkedGroupId);
    if (linked && !groupIds.has(linked)) issues.error("linked-group-missing", `그룹 ${clean(group.name || groupId)}의 연결 그룹이 존재하지 않습니다: ${linked}`, { groupId, linkedGroupId: linked });
  });

  const entries = snapshot.timetableEntries;
  duplicateValues(entries, item => item.id).forEach(id => issues.error("duplicate-timetable-entry-id", `시간표 배치 ID가 중복됩니다: ${id}`, { id }));
  const placementCount = new Map();
  entries.forEach(entry => {
    const entryId = clean(entry.id);
    const period = Number(entry.period);
    const day = Number(entry.day);
    if (!Number.isInteger(day) || day < 0 || day > 4) issues.error("entry-day-out-of-range", `시간표 배치의 요일 값이 범위를 벗어났습니다: ${entryId} / ${entry.day}`, { entryId, day: entry.day });
    if (!Number.isInteger(period) || period < 0 || period >= Math.max(1, counts.periodCount)) issues.error("entry-period-out-of-range", `시간표 배치의 교시 값이 범위를 벗어났습니다: ${entryId} / ${entry.period}`, { entryId, period: entry.period, periodCount: counts.periodCount });

    const refs = cardRefs(entry);
    if (!refs.length) issues.error("entry-ttcard-reference-missing", `시간표 배치에 시간표 카드 참조가 없습니다: ${entryId}`, { entryId });
    refs.forEach(cardId => {
      if (!cardIds.has(cardId)) issues.error("entry-ttcard-missing", `시간표 배치가 존재하지 않는 시간표 카드를 참조합니다: ${cardId}`, { entryId, cardId });
      placementCount.set(cardId, (placementCount.get(cardId) || 0) + 1);
    });

    const manualTemplateIds = new Set(refs.map(id => clean(cardById.get(id)?.templateId)).filter(id => id.startsWith("manual_")));
    templateRefs(entry).forEach(templateId => {
      if (!templateIds.has(templateId) && !manualTemplateIds.has(templateId)) issues.error("entry-template-missing", `시간표 배치가 존재하지 않는 과목카드를 참조합니다: ${templateId}`, { entryId, templateId });
    });
    uniqueStrings(entry.audienceClassKeys).forEach(key => {
      if (!classKeySet.has(key)) issues.error("entry-class-missing", `시간표 배치가 존재하지 않는 학급 키를 참조합니다: ${key}`, { entryId, classKey: key });
    });
    roomRefs(entry).forEach(roomId => {
      if (!roomIds.has(roomId)) issues.error("entry-room-missing", `시간표 배치가 존재하지 않는 교실을 참조합니다: ${roomId}`, { entryId, roomId });
    });
    Object.keys(asObject(entry.roomAssignmentsByTtCardId)).forEach(cardId => {
      if (!cardIds.has(cardId)) issues.error("entry-room-map-card-missing", `교실 배정표가 존재하지 않는 시간표 카드를 참조합니다: ${cardId}`, { entryId, cardId });
    });
    const groupId = clean(entry.groupId);
    if (groupId && !groupIds.has(groupId)) issues.error("entry-group-missing", `시간표 배치가 존재하지 않는 그룹을 참조합니다: ${groupId}`, { entryId, groupId });
  });

  cards.forEach(card => {
    const id = clean(card.id);
    if (!id || card.autoAssignExcluded === true || clean(card.manualCardStatus) === "stored") return;
    const required = Math.max(0, Number(card.credits || 0) || 0);
    const placed = placementCount.get(id) || 0;
    if (required !== placed) {
      const message = `시간표 카드 시수와 실제 배치 수가 다릅니다: ${clean(card.subject || card.label || id)} · 시수 ${required}, 배치 ${placed}`;
      if (draftMode) issues.warn("ttcard-credit-placement-mismatch", message, { cardId: id, required, placed });
      else issues.error("ttcard-credit-placement-mismatch", message, { cardId: id, required, placed });
    }
  });

  const emptyWorkspace = !counts.curriculumRows && !counts.templates && !counts.classes
    && !counts.rosterSubjects && !counts.timetableEntries && !counts.ttcards;
  if (draftMode) {
    if (emptyWorkspace) issues.warn("empty-workspace", "의도적으로 생성된 빈 학년도 작업공간입니다. 편집을 시작할 수 있습니다.");
    else {
      if (!counts.templates) issues.warn("templates-empty-draft", "빈 작업공간 초안에 과목카드 데이터가 아직 없습니다.");
      if (!counts.classes) issues.warn("classes-empty-draft", "빈 작업공간 초안에 학급 데이터가 아직 없습니다.");
      if (!counts.rosterSubjects) issues.warn("rosters-empty-draft", "빈 작업공간 초안에 수강명단 데이터가 아직 없습니다.");
      if (!counts.ttcards) issues.warn("ttcards-empty-draft", "빈 작업공간 초안에 시간표 카드 데이터가 아직 없습니다.");
      if (!counts.periodCount) issues.warn("period-count-missing-draft", "빈 작업공간 초안에 시간표 교시 수가 아직 설정되지 않았습니다.");
    }
  } else {
    if (!counts.templates) issues.error("templates-empty", "과목카드 데이터가 비어 있습니다.");
    if (!counts.classes) issues.error("classes-empty", "학급 데이터가 비어 있습니다.");
    if (!counts.rosterSubjects) issues.error("rosters-empty", "수강명단 데이터가 비어 있습니다.");
    if (!counts.ttcards) issues.error("ttcards-empty", "시간표 카드 데이터가 비어 있습니다.");
    if (!counts.periodCount) issues.error("period-count-missing", "시간표 교시 수가 설정되지 않았습니다.");
  }

  let sourceComparison = null;
  if (options.sourceSnapshot) {
    const sourceCounts = summarizeWorkspaceSnapshot(options.sourceSnapshot);
    const differences = compareWorkspaceCounts(sourceCounts, counts, { strict: strictCopy });
    sourceComparison = { strict: strictCopy, sourceCounts, differences, same: differences.length === 0 };
    differences.forEach(diff => {
      const message = `원본과 복제본 수량이 다릅니다: ${diff.key} · 원본 ${diff.source}, 대상 ${diff.target}`;
      if (strictCopy) issues.error("copy-count-mismatch", message, diff);
      else issues.warn("source-count-changed", message, diff);
    });
  }

  const signatureMaterial = [
    JSON.stringify(counts),
    [...templateIds].sort().join("|"),
    [...classIds].sort().join("|"),
    [...globalStudentIds].sort().join("|"),
    [...roomIds].sort().join("|"),
    [...cardIds].sort().join("|"),
    entries.map(item => clean(item.id)).sort().join("|"),
    groups.map(item => clean(item.id)).sort().join("|"),
  ].join("\n");

  return {
    schemaVersion: INTEGRITY_SCHEMA_VERSION,
    build: SCHOOL_YEAR_INTEGRITY_BUILD,
    checkedAt: new Date().toISOString(),
    year: snapshot.year || clean(options.year),
    ok: issues.errors.length === 0,
    counts,
    errorCount: issues.errors.length,
    warningCount: issues.warnings.length,
    errors: issues.errors,
    warnings: issues.warnings,
    sourceComparison,
    signature: `ws:${signatureMaterial.length}:${stableHash(signatureMaterial)}`,
  };
}

export function compactIntegrityReport(report = {}) {
  return {
    schemaVersion: Number(report.schemaVersion || INTEGRITY_SCHEMA_VERSION),
    build: clean(report.build || SCHOOL_YEAR_INTEGRITY_BUILD),
    checkedAt: clean(report.checkedAt || new Date().toISOString()),
    year: clean(report.year),
    ok: report.ok === true,
    counts: asObject(report.counts),
    errorCount: Number(report.errorCount || asArray(report.errors).length) || 0,
    warningCount: Number(report.warningCount || asArray(report.warnings).length) || 0,
    errors: asArray(report.errors).slice(0, 30).map(item => ({ code: clean(item.code), message: clean(item.message) })),
    warnings: asArray(report.warnings).slice(0, 30).map(item => ({ code: clean(item.code), message: clean(item.message) })),
    sourceComparison: report.sourceComparison ? {
      strict: report.sourceComparison.strict === true,
      same: report.sourceComparison.same === true,
      differences: asArray(report.sourceComparison.differences).slice(0, 30),
    } : null,
    signature: clean(report.signature),
  };
}

export function formatIntegritySummary(report = {}) {
  const counts = asObject(report.counts);
  return [
    `결과: ${report.ok === true ? "정상" : "오류"}`,
    `오류 ${Number(report.errorCount || 0)}건 · 경고 ${Number(report.warningCount || 0)}건`,
    `학급 ${Number(counts.classes || 0)} · 학생 ${Number(counts.students || 0)} · 수강명단 ${Number(counts.rosterSubjects || 0)}`,
    `시간표 카드 ${Number(counts.ttcards || 0)} · 그룹 ${Number(counts.ttcardGroups || 0)} · 배치 ${Number(counts.timetableEntries || 0)}`,
  ].join("\n");
}
