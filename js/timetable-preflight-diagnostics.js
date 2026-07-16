// ================================================================
// timetable-preflight-diagnostics.js · Fast client-side preflight
// ---------------------------------------------------------------
// Pure, side-effect-free structural checks shared by the built-in
// auto-assigner and the CP-SAT bridge. The scan is intentionally O(n)
// plus a small cards × weekly-slots pass (normally 35 slots per card).
// ================================================================

const asArray = value => Array.isArray(value) ? value : [];
const clean = value => String(value ?? "").trim();
const unique = values => [...new Set(asArray(values).map(clean).filter(Boolean))];
const clock = () => globalThis.performance?.now?.() ?? Date.now();
const CLASS_UNAVAILABLE_PREFIX = "__class_unavailable__:";

function rootState(input = {}) {
  return input?.data || input?.normalized || input || {};
}

function splitNames(value = "") {
  if (Array.isArray(value)) return unique(value.flatMap(splitNames));
  return String(value || "")
    .split(/[,，·/+&]|\s+and\s+/i)
    .map(clean)
    .filter(Boolean);
}

function normalizeClassKey(value = "", fallbackGrade = "") {
  const raw = clean(value).replace(/학년/g, "").replace(/\s+/g, "").toUpperCase();
  if (!raw) return "";
  if (raw.includes(":")) {
    const [grade, section] = raw.split(":");
    const gradeNo = Number(String(grade || fallbackGrade).replace(/[^0-9]/g, ""));
    return gradeNo && section ? `${gradeNo}:${section}` : "";
  }
  const match = raw.match(/^(\d{1,2})([A-Z0-9]+)$/);
  if (match) return `${Number(match[1])}:${match[2]}`;
  const fallbackNo = Number(String(fallbackGrade || "").replace(/[^0-9]/g, ""));
  return fallbackNo && raw ? `${fallbackNo}:${raw}` : "";
}

function classKeyForRecord(cls = {}) {
  return normalizeClassKey(`${clean(cls.grade)}${clean(cls.name)}`);
}

function classLabelFromKey(key = "") {
  const [grade, section] = clean(key).split(":");
  return grade && section ? `${Number(grade)}${section}` : clean(key);
}

function normalizeSlot(slot, periodCount = 7) {
  if (!slot || typeof slot !== "object") return null;
  const day = Number(slot.day ?? slot.d ?? slot.weekday);
  const period = Number(slot.period ?? slot.p ?? slot.hour);
  if (!Number.isInteger(day) || day < 0 || day > 4) return null;
  if (!Number.isInteger(period) || period < 0 || period >= periodCount) return null;
  return { day, period };
}

function normalizeSlots(list = [], periodCount = 7) {
  const seen = new Set();
  return asArray(list).map(item => normalizeSlot(item, periodCount)).filter(Boolean).filter(slot => {
    const key = `${slot.day}:${slot.period}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function slotsFromObject(obj = {}, fields = [], periodCount = 7) {
  return normalizeSlots(fields.flatMap(field => asArray(obj?.[field])), periodCount);
}

function slotKey(day, period) {
  return `${Number(day)}:${Number(period)}`;
}

function allWeeklySlots(periodCount = 7) {
  const out = [];
  for (let day = 0; day < 5; day += 1) {
    for (let period = 0; period < periodCount; period += 1) out.push({ day, period });
  }
  return out;
}

function addIssue(report, level, code, title, detail = "", data = {}, { blocking = level === "error" } = {}) {
  const issue = { level, code, title, detail, blocking: !!blocking, ...data };
  report.issues.push(issue);
  report.counts[level] = (report.counts[level] || 0) + 1;
  if (issue.blocking) report.blockingCount += 1;
  return issue;
}

function duplicates(values = []) {
  const counts = new Map();
  values.map(clean).filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1);
}

function teacherNamesForObject(obj = {}) {
  return unique([
    ...splitNames(obj.teacherName),
    ...splitNames(obj.teacher),
    ...splitNames(obj.teachers),
    ...splitNames(obj.teacherNames),
  ]);
}

function teacherIdsForObject(obj = {}) {
  return unique([
    clean(obj.teacherId),
    ...asArray(obj.teacherIds),
  ]);
}

function classKeysForObject(obj = {}) {
  const direct = [
    ...asArray(obj.classKeys),
    ...asArray(obj.audienceClassKeys),
  ].map(value => normalizeClassKey(value, obj.gradeKey)).filter(Boolean);
  const labels = [
    ...asArray(obj.classLabels),
    ...asArray(obj.audienceClassLabels),
  ].map(value => normalizeClassKey(value, obj.gradeKey)).filter(Boolean);
  if (direct.length || labels.length) return unique([...direct, ...labels]);
  const gradeNo = Number(String(obj.gradeKey || "").replace(/[^0-9]/g, ""));
  const section = Number.isInteger(obj.sectionIdx) ? String.fromCharCode(65 + obj.sectionIdx) : "";
  return gradeNo && section ? [`${gradeNo}:${section}`] : [];
}

function roomIdsForObject(obj = {}) {
  const assignmentIds = obj?.roomAssignmentsByTtCardId && typeof obj.roomAssignmentsByTtCardId === "object"
    ? Object.values(obj.roomAssignmentsByTtCardId)
    : [];
  return unique([
    clean(obj.roomId), clean(obj.fixedRoomId), clean(obj.defaultFixedRoomId),
    ...asArray(obj.roomIds), ...asArray(obj.fixedRoomIds), ...asArray(obj.manualRoomIds),
    ...asArray(obj.requiredRoomIds), ...asArray(obj.solverFixedRoomIds), ...assignmentIds,
  ]);
}

function cardIdsForEntry(entry = {}) {
  return unique([clean(entry.ttcardId), ...asArray(entry.ttcardIds)]);
}

function protectedCardCoverage(entries = []) {
  const slotsByCard = new Map();
  asArray(entries).forEach(entry => {
    const key = slotKey(entry.day, entry.period);
    cardIdsForEntry(entry).forEach(cardId => {
      if (!slotsByCard.has(cardId)) slotsByCard.set(cardId, new Set());
      slotsByCard.get(cardId).add(key);
    });
  });
  return new Map([...slotsByCard.entries()].map(([cardId, slots]) => [cardId, slots.size]));
}

function isManualExcluded(card = {}) {
  return card.manualCardStatus === "stored" || card.autoAssignExcluded === true || card.manualAutoAssign === false;
}

function isRoomless(card = {}) {
  return clean(card.roomRule) === "none" || card.roomRequired === false;
}

function resourceOverlap(a = [], b = []) {
  const set = new Set(a);
  return b.some(value => set.has(value));
}

function buildIndexes(state = {}) {
  const teachers = asArray(state?.teachers?.teachers);
  const rooms = asArray(state?.rooms?.rooms);
  const classes = asArray(state?.classes?.classes);
  const cards = asArray(state?.timetable?.ttcards || state?.timetable?.ttCards || state?.timetable?.cards);
  const groups = asArray(state?.timetable?.ttcardGroups || state?.timetable?.groups);

  const teacherById = new Map();
  const teacherByName = new Map();
  teachers.forEach(teacher => {
    if (clean(teacher.id)) teacherById.set(clean(teacher.id), teacher);
    if (clean(teacher.name)) teacherByName.set(clean(teacher.name), teacher);
    asArray(teacher.aliases).map(clean).filter(Boolean).forEach(alias => teacherByName.set(alias, teacher));
  });

  const roomById = new Map();
  const roomsByTeacher = new Map();
  const homeRoomByClassId = new Map();
  rooms.forEach(room => {
    const id = clean(room.id);
    if (id) roomById.set(id, room);
    const teacherName = clean(room.teacherName);
    if (teacherName) {
      if (!roomsByTeacher.has(teacherName)) roomsByTeacher.set(teacherName, []);
      roomsByTeacher.get(teacherName).push(room);
    }
    if (clean(room.homeRoomClassId)) homeRoomByClassId.set(clean(room.homeRoomClassId), room);
  });

  const classById = new Map();
  const classByKey = new Map();
  classes.forEach(cls => {
    if (clean(cls.id)) classById.set(clean(cls.id), cls);
    const key = classKeyForRecord(cls);
    if (key) classByKey.set(key, cls);
  });

  const cardById = new Map(cards.map(card => [clean(card.id), card]).filter(([id]) => id));
  const groupById = new Map(groups.map(group => [clean(group.id), group]).filter(([id]) => id));
  return { teachers, rooms, classes, cards, groups, teacherById, teacherByName, roomById, roomsByTeacher, homeRoomByClassId, classById, classByKey, cardById, groupById };
}

function teacherConstraintFor(state, teacher = null, name = "", id = "") {
  const timetable = state?.timetable || {};
  const byId = timetable.teacherConstraintsById || {};
  const byName = timetable.teacherConstraints || {};
  return byId[clean(id || teacher?.id)] || byName[clean(name || teacher?.name)] || {};
}

function classUnavailableSet(state, cls = {}, key = "", periodCount = 7) {
  const timetable = state?.timetable || {};
  const direct = normalizeSlots([
    ...asArray(cls.unavailableSlots),
    ...asArray(cls.blockedSlots),
  ], periodCount);
  const byKey = timetable.classConstraints || {};
  const constraint = byKey[clean(cls.id)] || byKey[key] || byKey[classLabelFromKey(key)] || {};
  const legacy = timetable.teacherConstraints || {};
  const legacySlots = [
    legacy[CLASS_UNAVAILABLE_PREFIX + clean(cls.id)],
    legacy[CLASS_UNAVAILABLE_PREFIX + key],
    legacy[CLASS_UNAVAILABLE_PREFIX + classLabelFromKey(key)],
  ].flatMap(item => asArray(item?.unavailableSlots));
  return new Set(normalizeSlots([...direct, ...asArray(constraint.unavailableSlots), ...legacySlots], periodCount).map(slot => slotKey(slot.day, slot.period)));
}

function resolveRoomsForCard(state, indexes, card = {}) {
  const explicit = roomIdsForObject(card).filter(id => indexes.roomById.has(id));
  if (explicit.length) return explicit;
  const rule = clean(card.roomRule || "teacher");
  if (rule === "none") return [];
  if (rule === "homeroom") {
    return unique(classKeysForObject(card).map(key => {
      const cls = indexes.classByKey.get(key);
      return cls ? indexes.homeRoomByClassId.get(clean(cls.id))?.id : "";
    }));
  }
  if (rule === "teacher" || !rule || rule === "auto") {
    return unique(teacherNamesForObject(card).flatMap(name => {
      const teacher = indexes.teacherByName.get(name);
      const constraint = teacherConstraintFor(state, teacher, name, teacher?.id);
      const assigned = clean(constraint.assignedRoomId || constraint.homeRoomId);
      if (assigned && indexes.roomById.has(assigned)) return [assigned];
      return asArray(indexes.roomsByTeacher.get(name)).map(room => room.id);
    }));
  }
  return [];
}

function cardCandidateAnalysis(state, indexes, card, options = {}) {
  const periodCount = options.periodCount;
  const weekly = options.weeklySlots;
  const allowedFields = ["allowedSlots", "availableSlots", "possibleSlots", "assignableSlots"];
  const unavailableFields = ["unavailableSlots", "blockedSlots", "disabledSlots"];
  const allowed = slotsFromObject(card, allowedFields, periodCount);
  const unavailable = new Set(slotsFromObject(card, unavailableFields, periodCount).map(slot => slotKey(slot.day, slot.period)));
  const classKeys = classKeysForObject(card);
  const teacherNames = teacherNamesForObject(card);
  const teacherIds = teacherIdsForObject(card);
  const configuredRoomIds = roomIdsForObject(card).filter(id => indexes.roomById.has(id));
  const roomIds = resolveRoomsForCard(state, indexes, card);
  const requiredRoomCount = Math.max(0, Number(card.requiredRoomCount || card.multiRoomCount || card.solverRequiredRoomCount || (isRoomless(card) ? 0 : 1)) || 0);
  const dynamicRoomEligible = requiredRoomCount > 0 && !roomIds.length && options.allowAutoRoomAssignment === true;
  const roomSource = configuredRoomIds.length ? "configured" : roomIds.length ? "teacher-or-homeroom" : dynamicRoomEligible ? "dynamic" : isRoomless(card) ? "none" : "unresolved";
  const protectedEntries = options.protectedEntries;
  const protectedBySlot = options.protectedBySlot || new Map();

  const teacherUnavailable = new Map();
  teacherNames.forEach(name => {
    const teacher = indexes.teacherByName.get(name);
    const constraint = teacherConstraintFor(state, teacher, name, teacher?.id);
    teacherUnavailable.set(name, new Set(normalizeSlots(constraint.unavailableSlots, periodCount).map(slot => slotKey(slot.day, slot.period))));
  });
  teacherIds.forEach(id => {
    const teacher = indexes.teacherById.get(id);
    if (!teacher || teacherUnavailable.has(clean(teacher.name))) return;
    const constraint = teacherConstraintFor(state, teacher, teacher.name, id);
    teacherUnavailable.set(clean(teacher.name) || id, new Set(normalizeSlots(constraint.unavailableSlots, periodCount).map(slot => slotKey(slot.day, slot.period))));
  });

  const classUnavailable = classKeys.map(key => {
    const cls = indexes.classByKey.get(key);
    return classUnavailableSet(state, cls || {}, key, periodCount);
  });
  const roomUnavailable = new Map(roomIds.map(id => {
    const room = indexes.roomById.get(id) || {};
    return [id, new Set(normalizeSlots(room.unavailableSlots, periodCount).map(slot => slotKey(slot.day, slot.period)))];
  }));

  const allowedSet = allowed.length ? new Set(allowed.map(slot => slotKey(slot.day, slot.period))) : null;
  const candidates = [];
  const reasonCounts = new Map();
  const addReason = code => reasonCounts.set(code, (reasonCounts.get(code) || 0) + 1);

  for (const slot of weekly) {
    const key = slotKey(slot.day, slot.period);
    if (allowedSet && !allowedSet.has(key)) { addReason("card-not-allowed"); continue; }
    if (unavailable.has(key)) { addReason("card-unavailable"); continue; }
    if ([...teacherUnavailable.values()].some(set => set.has(key))) { addReason("teacher-unavailable"); continue; }
    if (classUnavailable.some(set => set.has(key))) { addReason("class-unavailable"); continue; }

    if (requiredRoomCount > 0 && roomIds.length) {
      const availableRooms = roomIds.filter(id => !roomUnavailable.get(id)?.has(key));
      if (availableRooms.length < Math.min(requiredRoomCount, roomIds.length)) { addReason("room-unavailable"); continue; }
    }

    let protectedConflict = false;
    for (const entry of (protectedBySlot.get(key) || [])) {
      if (Number(entry.day) !== slot.day || Number(entry.period) !== slot.period) continue;
      const sameGroupConcurrent = clean(entry.groupId) && clean(card.groupId) && clean(entry.groupId) === clean(card.groupId)
        && (indexes.groupById.get(clean(entry.groupId))?.isConcurrent || indexes.groupById.get(clean(entry.groupId))?.groupType === "concurrent");
      if (resourceOverlap(teacherNames, teacherNamesForObject(entry))) { addReason("protected-teacher"); protectedConflict = true; break; }
      if (!sameGroupConcurrent && resourceOverlap(classKeys, classKeysForObject(entry))) { addReason("protected-class"); protectedConflict = true; break; }
      if (resourceOverlap(roomIds, roomIdsForObject(entry))) { addReason("protected-room"); protectedConflict = true; break; }
    }
    if (protectedConflict) continue;
    candidates.push(slot);
  }

  return {
    cardId: clean(card.id),
    title: clean(card.subject || card.label || card.nameKo || card.id),
    credits: Math.max(0, Number(card.credits) || 0),
    remainingCredits: Math.max(0, (Math.max(0, Number(card.credits) || 0)) - Number(options.protectedCoverage?.get(clean(card.id)) || 0)),
    protectedCredits: Number(options.protectedCoverage?.get(clean(card.id)) || 0),
    candidateCount: candidates.length,
    candidateDayCount: new Set(candidates.map(slot => slot.day)).size,
    roomIds,
    configuredRoomIds,
    requiredRoomCount,
    dynamicRoomEligible,
    roomSource,
    classKeys,
    teacherNames,
    reasonCounts: Object.fromEntries(reasonCounts),
  };
}

function checkIdentityAndReferences(report, state, indexes, options) {
  const { teachers, rooms, classes, cards } = indexes;
  const teacherIdDuplicates = duplicates(teachers.map(item => item.id));
  const teacherNameDuplicates = duplicates(teachers.map(item => item.name));
  const roomIdDuplicates = duplicates(rooms.map(item => item.id));
  const classIdDuplicates = duplicates(classes.map(item => item.id));
  const cardIdDuplicates = duplicates(cards.map(item => item.id));

  const missingTeacherIds = teachers.filter(item => !clean(item.id));
  const missingRoomIds = rooms.filter(item => !clean(item.id));
  const missingClassIds = classes.filter(item => !clean(item.id));
  const missingCardIds = cards.filter(item => !clean(item.id));

  if (missingTeacherIds.length) addIssue(report, "error", "teacher-id-missing", "교사 ID 누락", `${missingTeacherIds.length}명의 교사 ID가 없습니다.`, { count: missingTeacherIds.length });
  if (teacherIdDuplicates.length) addIssue(report, "error", "teacher-id-duplicate", "교사 ID 중복", `${teacherIdDuplicates.length}개 ID가 중복됩니다.`, { samples: teacherIdDuplicates.slice(0, 8) });
  if (teacherNameDuplicates.length) addIssue(report, "error", "teacher-name-duplicate", "교사 이름 중복", `${teacherNameDuplicates.length}개 이름이 중복되어 ID 변환이 모호합니다.`, { samples: teacherNameDuplicates.slice(0, 8) });
  if (missingRoomIds.length) addIssue(report, "error", "room-id-missing", "교실 ID 누락", `${missingRoomIds.length}개 교실 ID가 없습니다.`, { count: missingRoomIds.length });
  if (roomIdDuplicates.length) addIssue(report, "error", "room-id-duplicate", "교실 ID 중복", `${roomIdDuplicates.length}개 ID가 중복됩니다.`, { samples: roomIdDuplicates.slice(0, 8) });
  if (missingClassIds.length) addIssue(report, "error", "class-id-missing", "학급 ID 누락", `${missingClassIds.length}개 학급 ID가 없습니다.`, { count: missingClassIds.length });
  if (classIdDuplicates.length) addIssue(report, "error", "class-id-duplicate", "학급 ID 중복", `${classIdDuplicates.length}개 ID가 중복됩니다.`, { samples: classIdDuplicates.slice(0, 8) });
  if (missingCardIds.length) addIssue(report, "error", "card-id-missing", "시간표 카드 ID 누락", `${missingCardIds.length}개 카드 ID가 없습니다.`, { count: missingCardIds.length });
  if (cardIdDuplicates.length) addIssue(report, "error", "card-id-duplicate", "시간표 카드 ID 중복", `${cardIdDuplicates.length}개 ID가 중복됩니다.`, { samples: cardIdDuplicates.slice(0, 8) });

  const unresolvedTeachers = [];
  const unresolvedTeacherIds = [];
  const missingCanonicalTeacherIds = [];
  const unresolvedClasses = [];
  const unresolvedRooms = [];
  const fixedRoomMissing = [];

  cards.filter(card => !isManualExcluded(card) && (!options.scopeSet.size || options.scopeSet.has(clean(card.gradeKey)))).forEach(card => {
    const title = clean(card.subject || card.label || card.id);
    const names = teacherNamesForObject(card);
    const ids = teacherIdsForObject(card);
    names.forEach(name => { if (!indexes.teacherByName.has(name)) unresolvedTeachers.push(`${title}: ${name}`); });
    ids.forEach(id => { if (!indexes.teacherById.has(id)) unresolvedTeacherIds.push(`${title}: ${id}`); });
    if (names.length && !ids.length) missingCanonicalTeacherIds.push(title);
    classKeysForObject(card).forEach(key => { if (!indexes.classByKey.has(key)) unresolvedClasses.push(`${title}: ${key}`); });
    roomIdsForObject(card).forEach(id => { if (!indexes.roomById.has(id)) unresolvedRooms.push(`${title}: ${id}`); });
    if (clean(card.roomRule) === "fixed" && !clean(card.fixedRoomId || card.roomId) && !asArray(card.fixedRoomIds).length) fixedRoomMissing.push(title);
  });

  if (unresolvedTeachers.length) addIssue(report, "error", "card-teacher-unresolved", "카드 교사 미등록", `${unresolvedTeachers.length}건 · ${unresolvedTeachers.slice(0, 8).join(" / ")}${unresolvedTeachers.length > 8 ? " …" : ""}`, { samples: unresolvedTeachers.slice(0, 20) });
  if (unresolvedTeacherIds.length) addIssue(report, "error", "card-teacher-id-unresolved", "카드 교사 ID 불일치", `${unresolvedTeacherIds.length}건 · ${unresolvedTeacherIds.slice(0, 8).join(" / ")}${unresolvedTeacherIds.length > 8 ? " …" : ""}`, { samples: unresolvedTeacherIds.slice(0, 20) });
  if (missingCanonicalTeacherIds.length) addIssue(report, "warn", "card-teacher-id-legacy", "교사 ID 미이관 카드", `${missingCanonicalTeacherIds.length}개 카드가 이름만 가지고 있습니다. 학년도를 열어 자동 이관 저장을 완료하세요.`, { samples: missingCanonicalTeacherIds.slice(0, 20) }, { blocking: false });
  if (unresolvedClasses.length) addIssue(report, "error", "card-class-unresolved", "카드 학급 참조 불일치", `${unresolvedClasses.length}건 · ${unresolvedClasses.slice(0, 8).join(" / ")}${unresolvedClasses.length > 8 ? " …" : ""}`, { samples: unresolvedClasses.slice(0, 20) });
  if (unresolvedRooms.length) addIssue(report, "error", "card-room-unresolved-id", "카드 교실 ID 불일치", `${unresolvedRooms.length}건 · ${unresolvedRooms.slice(0, 8).join(" / ")}${unresolvedRooms.length > 8 ? " …" : ""}`, { samples: unresolvedRooms.slice(0, 20) });
  if (fixedRoomMissing.length) addIssue(report, "error", "card-fixed-room-missing", "지정교실 카드의 교실 누락", `${fixedRoomMissing.length}개 · ${fixedRoomMissing.slice(0, 8).join(" / ")}${fixedRoomMissing.length > 8 ? " …" : ""}`, { samples: fixedRoomMissing.slice(0, 20) });

  if (![missingTeacherIds, teacherIdDuplicates, teacherNameDuplicates, missingRoomIds, roomIdDuplicates, missingClassIds, classIdDuplicates, missingCardIds, cardIdDuplicates, unresolvedTeachers, unresolvedTeacherIds, missingCanonicalTeacherIds, unresolvedClasses, unresolvedRooms, fixedRoomMissing].some(list => list.length)) {
    addIssue(report, "info", "identity-ok", "교사·교실·학급·카드 식별자", "필수 ID와 참조 관계가 정상입니다.", {}, { blocking: false });
  }
}

function checkProtectedEntries(report, state, indexes, protectedEntries, periodCount) {
  const invalid = protectedEntries.filter(entry => {
    const day = Number(entry.day);
    const period = Number(entry.period);
    return !Number.isInteger(day) || day < 0 || day > 4 || !Number.isInteger(period) || period < 0 || period >= periodCount;
  });
  if (invalid.length) addIssue(report, "error", "protected-slot-invalid", "고정 배치 요일·교시 오류", `${invalid.length}개 고정 배치가 현재 시간 범위를 벗어납니다.`, { count: invalid.length });

  const bySlot = new Map();
  protectedEntries.forEach(entry => {
    const key = slotKey(entry.day, entry.period);
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key).push(entry);
  });
  const teacherConflicts = [];
  const roomConflicts = [];
  const classConflicts = [];
  bySlot.forEach((slotEntries, key) => {
    for (let i = 0; i < slotEntries.length; i += 1) {
      for (let j = i + 1; j < slotEntries.length; j += 1) {
        const a = slotEntries[i];
        const b = slotEntries[j];
        const sameGroup = clean(a.groupId) && clean(a.groupId) === clean(b.groupId);
        const group = sameGroup ? indexes.groupById.get(clean(a.groupId)) : null;
        const concurrent = !!(group?.isConcurrent || group?.groupType === "concurrent");
        if (resourceOverlap(teacherNamesForObject(a), teacherNamesForObject(b))) teacherConflicts.push(`${key}: ${clean(a.teacherName)} ↔ ${clean(b.teacherName)}`);
        if (resourceOverlap(roomIdsForObject(a), roomIdsForObject(b))) roomConflicts.push(`${key}: ${roomIdsForObject(a).filter(id => roomIdsForObject(b).includes(id)).join(",")}`);
        if (!concurrent && resourceOverlap(classKeysForObject(a), classKeysForObject(b))) classConflicts.push(`${key}: ${classKeysForObject(a).filter(id => classKeysForObject(b).includes(id)).join(",")}`);
      }
    }
  });
  if (teacherConflicts.length) addIssue(report, "error", "protected-teacher-conflict", "고정 배치 교사 충돌", `${teacherConflicts.length}건 · ${teacherConflicts.slice(0, 6).join(" / ")}${teacherConflicts.length > 6 ? " …" : ""}`, { samples: teacherConflicts.slice(0, 20) });
  if (roomConflicts.length) addIssue(report, "error", "protected-room-conflict", "고정 배치 교실 충돌", `${roomConflicts.length}건 · ${roomConflicts.slice(0, 6).join(" / ")}${roomConflicts.length > 6 ? " …" : ""}`, { samples: roomConflicts.slice(0, 20) });
  if (classConflicts.length) addIssue(report, "error", "protected-class-conflict", "고정 배치 학급 충돌", `${classConflicts.length}건 · ${classConflicts.slice(0, 6).join(" / ")}${classConflicts.length > 6 ? " …" : ""}`, { samples: classConflicts.slice(0, 20) });
  if (!invalid.length && !teacherConflicts.length && !roomConflicts.length && !classConflicts.length) {
    addIssue(report, "info", "protected-ok", "고정 배치 충돌", `${protectedEntries.length}개 고정/보호 배치의 교사·교실·학급 충돌이 없습니다.`, {}, { blocking: false });
  }
}

function checkGroups(report, state, indexes, options) {
  const missingRefs = [];
  const emptyGroups = [];
  const roomCollisions = [];
  const unresolvedRooms = [];
  const repeatedTeachers = [];

  indexes.groups.forEach(group => {
    const name = clean(group.name || group.groupName || group.id) || "이름 없는 그룹";
    const refs = unique([
      ...asArray(group.poolCardIds), ...asArray(group.cardIds),
      ...asArray(group.units).flatMap(unit => [...asArray(unit.ttcardIds), ...asArray(unit.cardIds), ...asArray(unit.poolCardIds)]),
    ]);
    if (!refs.length) emptyGroups.push(name);
    refs.forEach(id => { if (!indexes.cardById.has(id)) missingRefs.push(`${name}: ${id}`); });
    if (!(group.isConcurrent || group.groupType === "concurrent")) return;

    const cards = refs.map(id => indexes.cardById.get(id)).filter(Boolean).filter(card => !isManualExcluded(card));
    const teacherOwners = new Map();
    cards.forEach(card => teacherNamesForObject(card).forEach(teacher => {
      if (!teacherOwners.has(teacher)) teacherOwners.set(teacher, []);
      teacherOwners.get(teacher).push(clean(card.subject || card.label || card.id));
    }));
    teacherOwners.forEach((titles, teacher) => {
      if (titles.length > 1) repeatedTeachers.push(`${name}: ${teacher}(${titles.length}개 카드)`);
    });

    const configuredRooms = cards.flatMap(card => roomIdsForObject(card));
    const duplicateRooms = duplicates(configuredRooms);
    if (duplicateRooms.length) roomCollisions.push(`${name}: ${duplicateRooms.map(([id, count]) => `${id}×${count}`).join(", ")}`);
    if (!options.allowAutoRoomAssignment) {
      cards.filter(card => !isRoomless(card) && !resolveRoomsForCard(state, indexes, card).length)
        .forEach(card => unresolvedRooms.push(`${name}: ${clean(card.subject || card.label || card.id)}`));
    }
  });

  if (missingRefs.length) addIssue(report, "error", "group-card-reference-missing", "묶음수업 카드 참조 오류", `${missingRefs.length}건 · ${missingRefs.slice(0, 8).join(" / ")}${missingRefs.length > 8 ? " …" : ""}`, { samples: missingRefs.slice(0, 20) });
  if (emptyGroups.length) addIssue(report, "warn", "group-empty", "빈 묶음수업", `${emptyGroups.length}개 · ${emptyGroups.slice(0, 8).join(" / ")}${emptyGroups.length > 8 ? " …" : ""}`, { samples: emptyGroups.slice(0, 20) }, { blocking: false });
  if (roomCollisions.length) addIssue(report, "info", "group-shared-room", "묶음수업 공유 교실 구조", `${roomCollisions.length}개 그룹에서 동일 교실을 여러 구성 카드가 공유합니다. 동시수업을 한 공간에서 운영하는 의도된 구조일 수 있습니다. · ${roomCollisions.slice(0, 6).join(" / ")}${roomCollisions.length > 6 ? " …" : ""}`, { samples: roomCollisions.slice(0, 20) }, { blocking: false });
  if (unresolvedRooms.length) addIssue(report, "warn", "group-room-shortage", "묶음수업 교실 수 확인", `${unresolvedRooms.length}개 구성 카드에 고정/교사 교실이 없습니다. · ${unresolvedRooms.slice(0, 6).join(" / ")}${unresolvedRooms.length > 6 ? " …" : ""}`, { samples: unresolvedRooms.slice(0, 20) }, { blocking: false });
  if (repeatedTeachers.length) addIssue(report, "info", "group-shared-teacher", "묶음수업 공유 교사 구조", `${repeatedTeachers.length}개 교사가 같은 동시수업 그룹의 여러 카드에 연결되어 있습니다. 엔진은 이를 하나의 통합 block으로 처리합니다. · ${repeatedTeachers.slice(0, 6).join(" / ")}${repeatedTeachers.length > 6 ? " …" : ""}`, { samples: repeatedTeachers.slice(0, 20) }, { blocking: false });
  if (!missingRefs.length && !unresolvedRooms.length) addIssue(report, "info", "group-ok", "묶음수업 교사·교실 구조", `${indexes.groups.length}개 그룹의 필수 카드·교실 참조가 정상입니다.`, {}, { blocking: false });
}

function checkCardFeasibility(report, state, indexes, options) {
  const groupedCardIds = new Set(indexes.groups.flatMap(group => [
    ...asArray(group.poolCardIds), ...asArray(group.cardIds),
    ...asArray(group.units).flatMap(unit => [...asArray(unit.ttcardIds), ...asArray(unit.cardIds), ...asArray(unit.poolCardIds)]),
  ]));
  const analyses = [];
  indexes.cards.filter(card => !isManualExcluded(card) && (!options.scopeSet.size || options.scopeSet.has(clean(card.gradeKey)))).forEach(card => {
    analyses.push(cardCandidateAnalysis(state, indexes, card, options));
  });
  report.cardCandidates = analyses;

  const zero = analyses.filter(row => row.remainingCredits > 0 && row.candidateCount === 0);
  const shortage = analyses.filter(row => !groupedCardIds.has(row.cardId) && row.remainingCredits > 0 && row.candidateCount > 0 && row.candidateCount < row.remainingCredits);
  const dayShortage = analyses.filter(row => !groupedCardIds.has(row.cardId) && row.remainingCredits > 1 && row.remainingCredits <= 5 && row.candidateDayCount < row.remainingCredits);
  const roomShortage = analyses.filter(row => row.requiredRoomCount > 0 && !row.dynamicRoomEligible && row.roomIds.length < row.requiredRoomCount);

  const rowText = row => `${row.title || row.cardId}: 남은 ${row.remainingCredits || 1} / 후보 ${row.candidateCount}칸(${row.candidateDayCount}일)`;
  if (zero.length) addIssue(report, "error", "card-zero-candidate", "배치 가능시간 0칸", `${zero.length}개 카드 · ${zero.slice(0, 8).map(rowText).join(" / ")}${zero.length > 8 ? " …" : ""}`, { samples: zero.slice(0, 20) });
  if (shortage.length) addIssue(report, "error", "card-candidate-shortage", "필요 시수보다 후보 시간이 적음", `${shortage.length}개 카드 · ${shortage.slice(0, 8).map(rowText).join(" / ")}${shortage.length > 8 ? " …" : ""}`, { samples: shortage.slice(0, 20) });
  if (dayShortage.length) addIssue(report, "error", "card-day-shortage", "하루 중복 금지 시 배치 불가", `${dayShortage.length}개 카드가 주당 시수만큼 서로 다른 요일을 확보하지 못합니다. · ${dayShortage.slice(0, 8).map(row => `${row.title}: ${row.remainingCredits}시수 / ${row.candidateDayCount}일`).join(" / ")}${dayShortage.length > 8 ? " …" : ""}`, { samples: dayShortage.slice(0, 20) });
  if (roomShortage.length) addIssue(report, "warn", "card-room-count-shortage", "필요 교실 수 부족 가능성", `${roomShortage.length}개 카드 · ${roomShortage.slice(0, 8).map(row => `${row.title}: 필요 ${row.requiredRoomCount} / 확인 ${row.roomIds.length}`).join(" / ")}${roomShortage.length > 8 ? " …" : ""}`, { samples: roomShortage.slice(0, 20) }, { blocking: false });
  if (!zero.length && !shortage.length && !dayShortage.length) {
    const min = analyses.length ? Math.min(...analyses.map(row => row.candidateCount)) : 0;
    addIssue(report, "info", "card-candidates-ok", "카드별 배치 가능시간", `${analyses.length}개 카드의 기본 시간 교집합이 존재합니다. 최소 후보 ${min}칸.`, {}, { blocking: false });
  }
}

export function buildTimetablePreflightDiagnostics(inputState = {}, options = {}) {
  const started = clock();
  const phaseTimes = {};
  const mark = (name, phaseStarted) => { phaseTimes[name] = Math.max(0, clock() - phaseStarted); };
  const state = rootState(inputState);
  const timetable = state?.timetable || {};
  const periodCount = Math.max(1, Number(options.periodCount || timetable?.config?.periodCount || 7) || 7);
  const scopeGrades = unique(options.scopeGrades || []);
  const scopeSet = new Set(scopeGrades);
  const protectedEntries = asArray(options.protectedEntries ?? options.entries ?? []);
  const report = {
    schemaVersion: "r367-timetable-preflight-v2",
    generatedAt: new Date().toISOString(),
    scopeGrades,
    counts: { error: 0, warn: 0, info: 0 },
    blockingCount: 0,
    issues: [],
    cardCandidates: [],
    dataCounts: {},
    performance: {},
  };

  let phaseStarted = clock();
  const indexes = buildIndexes(state);
  mark("indexMs", phaseStarted);
  report.dataCounts = {
    teachers: indexes.teachers.length,
    rooms: indexes.rooms.length,
    classes: indexes.classes.length,
    cards: indexes.cards.length,
    groups: indexes.groups.length,
    protectedEntries: protectedEntries.length,
    weeklySlots: 5 * periodCount,
  };

  const protectedBySlot = new Map();
  protectedEntries.forEach(entry => {
    const key = slotKey(entry?.day, entry?.period);
    if (!protectedBySlot.has(key)) protectedBySlot.set(key, []);
    protectedBySlot.get(key).push(entry);
  });
  const normalizedOptions = {
    periodCount,
    weeklySlots: allWeeklySlots(periodCount),
    scopeSet,
    protectedEntries,
    protectedBySlot,
    protectedCoverage: protectedCardCoverage(protectedEntries),
    allowAutoRoomAssignment: options.allowAutoRoomAssignment === true,
  };

  phaseStarted = clock();
  checkIdentityAndReferences(report, state, indexes, normalizedOptions);
  mark("identityMs", phaseStarted);

  phaseStarted = clock();
  checkGroups(report, state, indexes, normalizedOptions);
  mark("groupMs", phaseStarted);

  phaseStarted = clock();
  checkProtectedEntries(report, state, indexes, protectedEntries, periodCount);
  mark("protectedMs", phaseStarted);

  phaseStarted = clock();
  checkCardFeasibility(report, state, indexes, normalizedOptions);
  mark("candidateIntersectionMs", phaseStarted);

  report.overall = report.blockingCount > 0 ? "error" : report.counts.warn > 0 ? "warn" : "ok";
  report.performance = {
    ...phaseTimes,
    totalMs: Math.max(0, clock() - started),
    complexity: `O(records + cards×${5 * periodCount})`,
  };
  return report;
}

export function formatTimetablePreflightSummary(report = {}) {
  const ms = Number(report?.performance?.totalMs || 0);
  return `차단 ${Number(report.blockingCount || 0)} · 오류 ${Number(report.counts?.error || 0)} · 주의 ${Number(report.counts?.warn || 0)} · 진단 ${ms < 1 ? "<1" : ms.toFixed(ms < 10 ? 1 : 0)}ms`;
}

export function blockingTimetablePreflightIssues(report = {}) {
  return asArray(report?.issues).filter(issue => issue?.blocking);
}
