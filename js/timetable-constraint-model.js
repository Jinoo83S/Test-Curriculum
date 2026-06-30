// ================================================================
// timetable-constraint-model.js · Operational data detection model · r191
// ---------------------------------------------------------------
// 선생님이 정의한 4축 데이터 모델을 한 곳에서 감지합니다.
// 1) 시간표과목카드: 교사 / 교실 / 배정가능시간
// 2) 각반: 과목 / 수업가능시간 / 홈룸 / 홈룸교사
// 3) 교실: 담당교사 / 수업가능시간 / 수용인원 / 홈룸
// 4) 교사: 과목 / 교실 / 수업가능시간
// ================================================================

const clean = v => String(v ?? "").trim();
const asArray = v => Array.isArray(v) ? v : [];
const unique = list => [...new Set(asArray(list).map(clean).filter(Boolean))];
const ROOM_UNAVAILABLE_PREFIX = "__room_unavailable__:";
const CLASS_UNAVAILABLE_PREFIX = "__class_unavailable__:";
const SLOT_FIELDS_ALLOWED = ["allowedSlots", "availableSlots", "possibleSlots", "assignableSlots", "배정가능시간", "수업가능시간"];
const SLOT_FIELDS_UNAVAILABLE = ["unavailableSlots", "blockedSlots", "disabledSlots", "불가시간", "수업불가시간"];
const DAY_MIN = 0;
const DAY_MAX = 4;
const PERIOD_MIN = 0;
const PERIOD_MAX = 11;

function splitNames(v = "") {
  if (Array.isArray(v)) return unique(v.flatMap(splitNames));
  return String(v || "").split(/[,，·/+&]|\s+and\s+/i).map(clean).filter(Boolean);
}
function gradeNumber(gradeKey = "") {
  const m = String(gradeKey || "").match(/\d{1,2}/);
  return m ? String(Number(m[0])) : "";
}
function classKeyOf(cls = {}) {
  const g = gradeNumber(cls.grade);
  const s = clean(cls.name).toUpperCase();
  return g && s ? `${g}:${s}` : "";
}
function classLabelOf(cls = {}) {
  const g = gradeNumber(cls.grade);
  const s = clean(cls.name).toUpperCase();
  return g && s ? `${g}${s}` : "";
}
function normalizeClassKey(v = "", fallbackGrade = "") {
  const text = clean(v).replace(/학년/g, "").replace(/\s+/g, "").toUpperCase();
  if (!text) return "";
  if (text.includes(":")) {
    const [g, s] = text.split(":");
    const gn = gradeNumber(g || fallbackGrade);
    return gn && s ? `${gn}:${s}` : "";
  }
  const m = text.match(/^(\d{1,2})([A-Z])$/);
  if (m) return `${Number(m[1])}:${m[2]}`;
  const fg = gradeNumber(fallbackGrade);
  return fg && /^[A-Z]$/.test(text) ? `${fg}:${text}` : "";
}
function classLabelFromKey(key = "") {
  const [g, s] = String(key || "").split(":");
  return g && s ? `${Number(g)}${String(s).toUpperCase()}` : clean(key);
}
function normalizeSlot(slot) {
  if (!slot || typeof slot !== "object") return null;
  const day = Number(slot.day ?? slot.d ?? slot.weekday);
  const period = Number(slot.period ?? slot.p ?? slot.hour);
  if (!Number.isInteger(day) || day < DAY_MIN || day > DAY_MAX) return null;
  if (!Number.isInteger(period) || period < PERIOD_MIN || period > PERIOD_MAX) return null;
  return { day, period };
}
function normalizeSlots(list = []) {
  const seen = new Set();
  return asArray(list).map(normalizeSlot).filter(Boolean).filter(s => {
    const key = `${s.day}:${s.period}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.day - b.day || a.period - b.period);
}
function slotsFromFields(obj = {}, fields = []) {
  const out = [];
  fields.forEach(field => out.push(...normalizeSlots(obj?.[field] || [])));
  return normalizeSlots(out);
}
function slotKey(slot = {}) { return `${slot.day}:${slot.period}`; }
function slotCount(slots = []) { return normalizeSlots(slots).length; }
function findTemplate(state, templateId) {
  return asArray(state?.templates?.templates).find(t => clean(t.id) === clean(templateId)) || null;
}
function curriculumRowsForCard(state, card = {}) {
  const rows = [];
  const board = state?.curriculum?.gradeBoards?.[card.gradeKey] || [];
  asArray(board).forEach(row => {
    const semesters = [];
    if (clean(row.sem1TemplateId) === clean(card.templateId)) semesters.push("sem1");
    if (clean(row.sem2TemplateId) === clean(card.templateId)) semesters.push("sem2");
    if (semesters.length) rows.push({ row, semesters });
  });
  return rows;
}
function titleOfTemplate(tpl = {}) { return clean(tpl.nameKo) || clean(tpl.nameEn) || clean(tpl.id); }
function titleOfCard(card = {}, tpl = null) { return clean(card.subject) || clean(card.label) || titleOfTemplate(tpl || {}) || clean(card.id); }
function buildClassIndexes(state = {}) {
  const classes = asArray(state?.classes?.classes);
  const byId = new Map();
  const byKey = new Map();
  const byLabel = new Map();
  classes.forEach(cls => {
    const key = classKeyOf(cls);
    const label = classLabelOf(cls);
    if (cls.id) byId.set(cls.id, cls);
    if (key) byKey.set(key, cls);
    if (label) byLabel.set(label, cls);
  });
  return { classes, byId, byKey, byLabel };
}
function buildRoomIndexes(state = {}) {
  const rooms = asArray(state?.rooms?.rooms);
  const byId = new Map();
  const byTeacher = new Map();
  const homeByClassId = new Map();
  rooms.forEach(room => {
    if (room.id) byId.set(room.id, room);
    if (clean(room.teacherName)) byTeacher.set(clean(room.teacherName), room);
    if (clean(room.homeRoomClassId)) homeByClassId.set(clean(room.homeRoomClassId), room);
  });
  return { rooms, byId, byTeacher, homeByClassId };
}
function buildTeacherIndexes(state = {}) {
  const teachers = asArray(state?.teachers?.teachers);
  const byName = new Map();
  const homeroomByLabel = new Map();
  teachers.forEach(t => {
    if (clean(t.name)) byName.set(clean(t.name), t);
    const label = clean(t.note).replace(/\s+/g, "").toUpperCase();
    if (/^\d{1,2}[A-Z]$/.test(label)) homeroomByLabel.set(label, t);
  });
  return { teachers, byName, homeroomByLabel };
}
function teacherConstraint(state, name = "") {
  return state?.timetable?.teacherConstraints?.[clean(name)] || null;
}
function roomUnavailableSlots(state, roomId = "") {
  const key = ROOM_UNAVAILABLE_PREFIX + clean(roomId);
  return normalizeSlots(state?.timetable?.teacherConstraints?.[key]?.unavailableSlots || []);
}
function classUnavailableSlots(state, classId = "", classKey = "", label = "") {
  const tc = state?.timetable?.teacherConstraints || {};
  const candidates = [
    CLASS_UNAVAILABLE_PREFIX + clean(classId),
    CLASS_UNAVAILABLE_PREFIX + clean(classKey),
    CLASS_UNAVAILABLE_PREFIX + clean(label),
  ].filter(Boolean);
  const out = [];
  candidates.forEach(key => out.push(...normalizeSlots(tc?.[key]?.unavailableSlots || [])));
  return normalizeSlots(out);
}
function objectTimeSlots(obj = {}) {
  return {
    allowed: slotsFromFields(obj, SLOT_FIELDS_ALLOWED),
    unavailable: slotsFromFields(obj, SLOT_FIELDS_UNAVAILABLE),
  };
}
function cardTimeSlots(state, card = {}, tpl = null, sourceRows = []) {
  const sources = [card, tpl, ...sourceRows.map(x => x.row)].filter(Boolean);
  const allowed = [];
  const unavailable = [];
  sources.forEach(src => {
    const s = objectTimeSlots(src);
    allowed.push(...s.allowed);
    unavailable.push(...s.unavailable);
  });
  return { allowed: normalizeSlots(allowed), unavailable: normalizeSlots(unavailable) };
}
function classTimeSlots(state, cls = {}) {
  const key = classKeyOf(cls);
  const label = classLabelOf(cls);
  const direct = objectTimeSlots(cls);
  const unavailable = normalizeSlots([
    ...direct.unavailable,
    ...classUnavailableSlots(state, cls.id, key, label),
  ]);
  return { allowed: direct.allowed, unavailable };
}
function teacherSubjectsFromTemplates(state, teacherName = "") {
  const target = clean(teacherName);
  if (!target) return [];
  const subjects = [];
  asArray(state?.templates?.templates).forEach(tpl => {
    const names = splitNames([tpl.teacher, tpl.sem1Teacher, tpl.sem2Teacher].filter(Boolean).join(","));
    if (names.includes(target)) subjects.push(titleOfTemplate(tpl));
    asArray(tpl.compoundParts).forEach(part => {
      if (splitNames(part.teacher).includes(target)) subjects.push(clean(part.nameKo) || clean(part.nameEn) || titleOfTemplate(tpl));
    });
  });
  return unique(subjects);
}
function teacherSubjectsFromCards(state, teacherName = "") {
  const target = clean(teacherName);
  if (!target) return [];
  return unique(asArray(state?.timetable?.ttcards).filter(card => splitNames([card.teacherName, ...(card.teachers || [])].join(",")).includes(target)).map(card => card.subject || card.label));
}
function subjectsForClass(state, cls = {}) {
  const key = classKeyOf(cls);
  const label = classLabelOf(cls);
  const byCard = asArray(state?.timetable?.ttcards).filter(card => {
    const keys = asArray(card.classKeys).map(k => normalizeClassKey(k, card.gradeKey)).filter(Boolean);
    const labels = asArray(card.classLabels).map(v => clean(v).replace(/\s+/g, "").toUpperCase());
    return keys.includes(key) || labels.includes(label);
  }).map(card => card.subject || card.label);
  const byCurriculum = asArray(state?.curriculum?.gradeBoards?.[cls.grade]).map(row => {
    const tid = row.sem1TemplateId || row.sem2TemplateId;
    const tpl = findTemplate(state, tid);
    return tpl ? titleOfTemplate(tpl) : "";
  });
  return unique([...byCard, ...byCurriculum]);
}
function classLabelsForCard(card = {}) {
  return unique([
    ...asArray(card.classLabels).map(v => clean(v).replace(/\s+/g, "").toUpperCase()),
    ...asArray(card.classKeys).map(k => classLabelFromKey(normalizeClassKey(k, card.gradeKey))),
  ]);
}
function roomForTeacher(state, teacherName = "") {
  const name = clean(teacherName);
  const cfg = teacherConstraint(state, name);
  const rid = clean(cfg?.assignedRoomId || cfg?.homeRoomId);
  const roomIdx = buildRoomIndexes(state);
  if (rid && roomIdx.byId.has(rid)) return roomIdx.byId.get(rid);
  return roomIdx.byTeacher.get(name) || null;
}
function homeRoomForCard(state, card = {}) {
  const { byLabel } = buildClassIndexes(state);
  const { homeByClassId } = buildRoomIndexes(state);
  const rooms = [];
  classLabelsForCard(card).forEach(label => {
    const cls = byLabel.get(label);
    const room = cls ? homeByClassId.get(cls.id) : null;
    if (room) rooms.push(room);
  });
  const ids = unique(rooms.map(r => r.id));
  return ids.length === 1 ? rooms.find(r => r.id === ids[0]) : null;
}
function resolvedRoomsForCard(state, card = {}) {
  const roomIdx = buildRoomIndexes(state);
  const rule = clean(card.roomRule) || "teacher";
  if (rule === "none") return [];
  if (rule === "fixed") return clean(card.fixedRoomId) && roomIdx.byId.has(clean(card.fixedRoomId)) ? [roomIdx.byId.get(clean(card.fixedRoomId))] : [];
  if (rule === "homeroom") return homeRoomForCard(state, card) ? [homeRoomForCard(state, card)] : [];
  const rooms = [];
  splitNames([card.teacherName, ...(card.teachers || [])].join(",")).forEach(t => {
    const room = roomForTeacher(state, t);
    if (room) rooms.push(room);
  });
  const ids = unique(rooms.map(r => r.id));
  return ids.map(id => rooms.find(r => r.id === id)).filter(Boolean);
}
function buildCardConstraint(state, card = {}) {
  const tpl = findTemplate(state, card.templateId);
  const sourceRows = curriculumRowsForCard(state, card);
  const rooms = resolvedRoomsForCard(state, card);
  const times = cardTimeSlots(state, card, tpl, sourceRows);
  const teacherNames = unique(splitNames([card.teacherName, ...(card.teachers || [])].join(",")));
  const isManual = !!card.isManual || /^ttc_manual_/i.test(clean(card.id)) || /^manual_/i.test(clean(card.templateId));
  const sourceStatus = isManual ? "manual" : (!tpl ? "missing-template" : !sourceRows.length ? "missing-curriculum-row" : "ok");
  return {
    id: clean(card.id),
    title: titleOfCard(card, tpl),
    templateId: clean(card.templateId),
    gradeKey: clean(card.gradeKey),
    sectionIdx: card.sectionIdx ?? 0,
    classLabels: classLabelsForCard(card),
    teachers: teacherNames,
    roomRule: clean(card.roomRule) || "teacher",
    fixedRoomId: clean(card.fixedRoomId),
    resolvedRoomIds: rooms.map(r => r.id),
    resolvedRoomNames: rooms.map(r => r.name || r.id),
    time: {
      allowedSlots: times.allowed,
      unavailableSlots: times.unavailable,
      configured: !!(times.allowed.length || times.unavailable.length),
    },
    curriculumSource: {
      status: sourceStatus,
      rowIds: sourceRows.map(x => clean(x.row?.id)).filter(Boolean),
      semesters: unique(sourceRows.flatMap(x => x.semesters)),
      templateFound: !!tpl,
      compoundPartId: clean(card.compoundPartId),
      compoundParentTemplateId: clean(card.compoundParentTemplateId),
    },
  };
}
function buildClassConstraint(state, cls = {}) {
  const classIdx = buildClassIndexes(state);
  const roomIdx = buildRoomIndexes(state);
  const teacherIdx = buildTeacherIndexes(state);
  const label = classLabelOf(cls);
  const key = classKeyOf(cls);
  const homeRoom = roomIdx.homeByClassId.get(cls.id) || null;
  const homeTeacherFromNote = teacherIdx.homeroomByLabel.get(label) || null;
  const homeTeacherName = clean(homeTeacherFromNote?.name) || clean(homeRoom?.teacherName);
  const time = classTimeSlots(state, cls);
  return {
    id: clean(cls.id),
    grade: clean(cls.grade),
    name: clean(cls.name),
    key,
    label,
    studentCount: asArray(cls.students).length,
    subjects: subjectsForClass(state, cls),
    homeRoomId: clean(homeRoom?.id),
    homeRoomName: clean(homeRoom?.name),
    homeRoomTeacher: homeTeacherName,
    time: { allowedSlots: time.allowed, unavailableSlots: time.unavailable, configured: !!(time.allowed.length || time.unavailable.length) },
  };
}
function buildRoomConstraint(state, room = {}) {
  const classIdx = buildClassIndexes(state);
  const homeCls = classIdx.byId.get(room.homeRoomClassId) || null;
  const direct = objectTimeSlots(room);
  const unavailable = normalizeSlots([...direct.unavailable, ...roomUnavailableSlots(state, room.id)]);
  return {
    id: clean(room.id),
    name: clean(room.name),
    type: clean(room.type),
    teacherName: clean(room.teacherName),
    homeRoomClassId: clean(room.homeRoomClassId),
    homeRoomLabel: homeCls ? classLabelOf(homeCls) : "",
    capacity: Number(room.capacity) || 0,
    time: { allowedSlots: direct.allowed, unavailableSlots: unavailable, configured: !!(direct.allowed.length || unavailable.length) },
  };
}
function buildTeacherConstraint(state, teacher = {}) {
  const name = clean(teacher.name);
  const cfg = teacherConstraint(state, name) || {};
  const room = roomForTeacher(state, name);
  const directSubjects = unique(teacher.subjects || []);
  const inferredSubjects = unique([...teacherSubjectsFromTemplates(state, name), ...teacherSubjectsFromCards(state, name)]);
  return {
    id: clean(teacher.id),
    name,
    subjects: directSubjects,
    inferredSubjects,
    roomId: clean(cfg.assignedRoomId || cfg.homeRoomId || room?.id),
    roomName: clean(room?.name),
    homeroomLabel: clean(teacher.note),
    maxPerDay: Number(cfg.maxPerDay) || 0,
    maxConsecutive: Number(cfg.maxConsecutive) || 0,
    maxPerWeek: Number(cfg.maxPerWeek) || 0,
    time: { unavailableSlots: normalizeSlots(cfg.unavailableSlots || []), configured: !!normalizeSlots(cfg.unavailableSlots || []).length },
  };
}
function pushIssue(issues, level, code, message, data = {}) { issues.push({ level, code, message, ...data }); }
function buildIssues(model) {
  const issues = [];
  model.cards.forEach(card => {
    if (!["ok", "manual"].includes(card.curriculumSource.status)) pushIssue(issues, "hard", `card-${card.curriculumSource.status}`, `${card.title}: 커리큘럼→템플릿→카드 원본 연결 확인 필요`, { cardId: card.id });
    if (!card.teachers.length && card.roomRule !== "none") pushIssue(issues, "hard", "card-missing-teacher", `${card.title}: 교사가 없습니다.`, { cardId: card.id });
    if (card.roomRule === "fixed" && !card.fixedRoomId) pushIssue(issues, "hard", "card-fixed-room-missing", `${card.title}: 고정교실 규칙인데 교실이 없습니다.`, { cardId: card.id });
    if (card.roomRule !== "none" && !card.resolvedRoomIds.length) pushIssue(issues, "warn", "card-room-unresolved", `${card.title}: 교실 규칙을 실제 교실로 해석하지 못했습니다.`, { cardId: card.id });
  });
  model.classes.forEach(cls => {
    if (!cls.subjects.length) pushIssue(issues, "hard", "class-no-subject", `${cls.label}: 연결 과목이 감지되지 않습니다.`, { classId: cls.id });
    if (!cls.homeRoomId) pushIssue(issues, "hard", "class-no-homeroom", `${cls.label}: 홈룸 교실이 없습니다.`, { classId: cls.id });
    if (!cls.homeRoomTeacher) pushIssue(issues, "warn", "class-no-homeroom-teacher", `${cls.label}: 홈룸교사 추론값이 없습니다.`, { classId: cls.id });
  });
  model.rooms.forEach(room => {
    if (room.capacity <= 0 && room.name) pushIssue(issues, "hard", "room-invalid-capacity", `${room.name}: 수용인원이 0 이하입니다.`, { roomId: room.id });
  });
  model.teachers.forEach(t => {
    if (!t.subjects.length && t.inferredSubjects.length) pushIssue(issues, "info", "teacher-subjects-inferred", `${t.name}: teachers.subjects는 비어 있으나 카드/템플릿에서 과목을 추론했습니다.`, { teacherId: t.id });
    if (!t.subjects.length && !t.inferredSubjects.length) pushIssue(issues, "warn", "teacher-no-subject", `${t.name}: 담당 과목을 감지하지 못했습니다.`, { teacherId: t.id });
  });
  return issues;
}

export function buildOperationalConstraintModel(state = {}) {
  const cards = asArray(state?.timetable?.ttcards).map(card => buildCardConstraint(state, card));
  const classes = asArray(state?.classes?.classes).map(cls => buildClassConstraint(state, cls));
  const rooms = asArray(state?.rooms?.rooms).map(room => buildRoomConstraint(state, room));
  const teachers = asArray(state?.teachers?.teachers).map(t => buildTeacherConstraint(state, t));
  const model = { schemaVersion: "r191-operational-constraint-model", generatedAt: new Date().toISOString(), cards, classes, rooms, teachers };
  const issues = buildIssues(model);
  const hardCount = issues.filter(x => x.level === "hard").length;
  const warnCount = issues.filter(x => x.level === "warn").length;
  model.summary = {
    cardCount: cards.length,
    cardSourceOkCount: cards.filter(c => c.curriculumSource.status === "ok" || c.curriculumSource.status === "manual").length,
    cardTimeConfiguredCount: cards.filter(c => c.time.configured).length,
    cardTimeMissingCount: cards.filter(c => !c.time.configured).length,
    classCount: classes.length,
    classSubjectOkCount: classes.filter(c => c.subjects.length).length,
    classHomeRoomOkCount: classes.filter(c => c.homeRoomId).length,
    classHomeRoomTeacherOkCount: classes.filter(c => c.homeRoomTeacher).length,
    classTimeConfiguredCount: classes.filter(c => c.time.configured).length,
    roomCount: rooms.length,
    roomUnavailableConfiguredCount: rooms.filter(r => r.time.configured).length,
    roomCapacityOkCount: rooms.filter(r => r.capacity > 0).length,
    teacherCount: teachers.length,
    teacherDirectSubjectCount: teachers.filter(t => t.subjects.length).length,
    teacherInferredSubjectCount: teachers.filter(t => t.inferredSubjects.length).length,
    teacherRoomCount: teachers.filter(t => t.roomId).length,
    teacherUnavailableConfiguredCount: teachers.filter(t => t.time.configured).length,
    hardIssueCount: hardCount,
    warnIssueCount: warnCount,
    infoIssueCount: issues.filter(x => x.level === "info").length,
  };
  model.issues = issues;
  return model;
}

export function buildSolverConstraintSummary(state = {}) {
  const model = buildOperationalConstraintModel(state);
  return {
    schemaVersion: model.schemaVersion,
    generatedAt: model.generatedAt,
    summary: model.summary,
    issues: model.issues.slice(0, 120),
  };
}
