// ================================================================
// ttcards.js · Timetable Card Generation + Group Manager UI
// ================================================================
import { GRADE_KEYS } from "./config.js";
import { uid, clean, makeBtn, languageClass, sectionLabel, gradeDisplay, getEffectiveCredit, isChanCheCategory, isProtectedWholeGradeLabel, parseCreditValue, escapeHtml } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave, saveNow, normalizeTtCard, normalizeTemplateGroup } from "./state.js?v=2026-07-14-school-year-login-hotfix-r346";
import {
  getTemplateById, getTemplateCardTitle, getTemplateTeacherSummary, splitTeacherNames,
} from "./templates.js";
import { getClassCount } from "./rosters.js";

const TTCARD_TEACHER_MODES = new Set(["homeroom", "representative", "none"]);
const TTCARD_TEACHER_MODE_LABELS = {
  homeroom: "담임 배정",
  representative: "대표 교사 배정",
  none: "교사 없음 허용",
};
function normalizeTeacherOptionMode(mode) {
  const v = clean(mode);
  return TTCARD_TEACHER_MODES.has(v) ? v : "none";
}
function getTtCardTeacherOptions() {
  const raw = appState.timetable?.ttcardTeacherOptions || {};
  return {
    mode: normalizeTeacherOptionMode(raw.mode),
    representativeTeacher: clean(raw.representativeTeacher),
  };
}
function setTtCardTeacherOptions(patch = {}) {
  if (!appState.timetable) appState.timetable = {};
  appState.timetable.ttcardTeacherOptions = {
    ...getTtCardTeacherOptions(),
    ...patch,
  };
  appState.timetable.ttcardTeacherOptions.mode = normalizeTeacherOptionMode(appState.timetable.ttcardTeacherOptions.mode);
  appState.timetable.ttcardTeacherOptions.representativeTeacher = clean(appState.timetable.ttcardTeacherOptions.representativeTeacher);
  scheduleSave("timetable");
}
function normalizeClassLabel(label) {
  return clean(label).replace(/\s+/g, "").toUpperCase();
}
function uniqueNames(list = []) {
  const seen = new Set();
  return (list || []).map(clean).filter(Boolean).filter(name => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function getAllTeacherNames() {
  const fromTeacherTable = (appState.teachers?.teachers || []).map(t => t.name);
  const fromTemplates = (appState.templates?.templates || [])
    .flatMap(tpl => [
      ...splitTeacherNames(tpl.teacher),
      ...splitTeacherNames(tpl.sem1Teacher),
      ...splitTeacherNames(tpl.sem2Teacher),
    ]);
  return uniqueNames([...fromTeacherTable, ...fromTemplates]).sort((a, b) => a.localeCompare(b, "ko"));
}

function getGroupDefaultRooms() {
  return (appState.rooms?.rooms || [])
    .filter(room => clean(room.id) && clean(room.name))
    .slice()
    .sort((a, b) => clean(a.name).localeCompare(clean(b.name), "ko", { numeric: true }));
}
function roomNameByIdForGroup(roomId = "") {
  const id = clean(roomId);
  if (!id) return "";
  return getGroupDefaultRooms().find(room => room.id === id)?.name || id;
}
const GROUP_DEFAULT_ROOM_RULES = new Set(["", "fixed"]);
function normalizeGroupDefaultRoomRule(rule = "") {
  const v = clean(rule);
  return GROUP_DEFAULT_ROOM_RULES.has(v) ? v : "";
}
function cloneSlotList(slots = []) {
  const seen = new Set();
  const out = [];
  (Array.isArray(slots) ? slots : []).forEach(slot => {
    const day = parseInt(slot?.day, 10);
    const period = parseInt(slot?.period, 10);
    if (!Number.isInteger(day) || !Number.isInteger(period)) return;
    const key = `${day}:${period}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ day, period });
  });
  return out.sort((a, b) => (a.day - b.day) || (a.period - b.period));
}
function slotKey(slot) { return `${Number(slot?.day)}:${Number(slot?.period)}`; }
function slotListHas(slots = [], day, period) {
  const key = `${day}:${period}`;
  return cloneSlotList(slots).some(slot => slotKey(slot) === key);
}
function toggleSlotInGroupAllowed(group, day, period) {
  if (!group) return;
  const slots = cloneSlotList(group.allowedSlots || []);
  const key = `${day}:${period}`;
  const idx = slots.findIndex(slot => slotKey(slot) === key);
  if (idx >= 0) slots.splice(idx, 1);
  else slots.push({ day, period });
  group.allowedSlots = cloneSlotList(slots);
}
function groupDefaultSummary(group = {}) {
  const parts = [];
  const roomId = clean(group.defaultFixedRoomId || group.fixedRoomId || "");
  if (roomId) parts.push(`예외교실 ${roomNameByIdForGroup(roomId) || "미지정"}`);
  const slotCount = cloneSlotList(group.allowedSlots || []).length;
  if (slotCount) parts.push(`가능시간 ${slotCount}칸`);
  return parts.join(" · ");
}

function applyGroupDefaultsToCards(group) {
  if (!group) return 0;
  const rule = normalizeGroupDefaultRoomRule(group.defaultRoomRule || group.roomRule || "");
  const fixedRoomId = clean(group.defaultFixedRoomId || group.fixedRoomId || "") || null;
  const allowedSlots = cloneSlotList(group.allowedSlots || []);
  const unavailableSlots = cloneSlotList(group.unavailableSlots || []);
  const cards = getGroupActiveCards(group);
  let changed = 0;
  cards.forEach(card => {
    if (!card) return;
    if (rule === "fixed") {
      card.roomRule = "fixed";
      card.fixedRoomId = fixedRoomId;
      changed += 1;
    }
    card.allowedSlots = cloneSlotList(allowedSlots);
    card.unavailableSlots = cloneSlotList(unavailableSlots);
    card.manualEdited = true;
    changed += 1;
  });
  return changed;
}

function getUnitTeacherSet(cards = []) {
  return new Set((cards || []).map(getUnitCardTeacherLabel).map(clean).filter(Boolean));
}

function isValidBundleUnit(cards = []) {
  const teachers = getUnitTeacherSet(cards);
  return teachers.size <= 1;
}

function getHomeroomTeachersForClassLabels(classLabels = []) {
  const labels = new Set((classLabels || []).map(normalizeClassLabel).filter(Boolean));
  if (!labels.size) return [];
  return uniqueNames((appState.teachers?.teachers || [])
    .filter(t => labels.has(normalizeClassLabel(t.note)))
    .map(t => t.name));
}
function resolveGeneratedTeachers({ templateTeacherName = "", classLabels = [] } = {}) {
  const templateTeachers = splitTeacherNames(templateTeacherName);
  if (templateTeachers.length) {
    return { teacherName: templateTeachers.join(", "), teachers: templateTeachers, source: "template" };
  }

  const opts = getTtCardTeacherOptions();
  if (opts.mode === "homeroom") {
    const homeroomTeachers = getHomeroomTeachersForClassLabels(classLabels);
    if (homeroomTeachers.length) {
      return { teacherName: homeroomTeachers.join(", "), teachers: homeroomTeachers, source: "homeroom" };
    }
  }
  if (opts.mode === "representative" && opts.representativeTeacher) {
    return { teacherName: opts.representativeTeacher, teachers: [opts.representativeTeacher], source: "representative" };
  }
  return { teacherName: "", teachers: [], source: "none" };
}
function normalizeCompoundParts(tpl) {
  if (!tpl || !tpl.isCompound || !Array.isArray(tpl.compoundParts)) return [];
  return tpl.compoundParts
    .map((part, idx) => ({
      id: clean(part?.id) || `part${idx + 1}`,
      nameKo: clean(part?.nameKo),
      nameEn: clean(part?.nameEn),
      teacher: clean(part?.teacher),
      credits: parseFloat(part?.credits) || 0,
      index: idx
    }))
    .filter(part => part.nameKo || part.nameEn || part.teacher || part.credits > 0);
}
function isCompoundTemplate(tpl) {
  return normalizeCompoundParts(tpl).length > 0;
}
function getCompoundPartTitle(part, fallbackTitle = "") {
  return clean(part?.nameKo) || clean(part?.nameEn) || fallbackTitle || "복합 과목";
}
function getCompoundPartTeacherInfo(part) {
  const names = splitTeacherNames(part?.teacher);
  return { teacherName: names.join(", "), teachers: names, source: "compound" };
}

function shouldSkipTimetableCardRow(row) {
  if (!row) return true;
  // 창체 입력값이 0인 항목은 커리큘럼 결과표에는 남기되, 시간표 카드에서는 제외합니다.
  if (isChanCheCategory(row.category) && parseCreditValue(row.credits) <= 0) return true;
  return false;
}

function getSectionLabelFromRoster(card) {
  const rosterEntries = (appState.rosters?.rosters?.[card.templateId] || [])
    .filter(e => (e.sectionIdx ?? 0) === card.sectionIdx);
  if (!rosterEntries.length) {
    return getClassCount(card.templateId) > 1 ? sectionLabel(card.sectionIdx) : null;
  }
  const allClasses = appState.classes?.classes || [];
  const classNames = [...new Set(rosterEntries.map(e => {
    const cls = allClasses.find(c => c.id === e.classId);
    return cls?.name || null;
  }).filter(Boolean))];
  if (classNames.length === 0) return sectionLabel(card.sectionIdx);
  if (classNames.length === 1) return classNames[0]; // "A" or "B"
  return classNames.join(", "); // one course section can contain students from A,B together
}
export const getTtCards    = () => appState.timetable.ttcards || [];
export const getTtCardById = id  => getTtCards().find(c => c.id === id) || null;
function isManualTtCard(card) {
  return !!card?.isManual || /^ttc_manual_/i.test(clean(card?.id)) || /^manual_/i.test(clean(card?.templateId));
}
function getManualTtCards(cards = getTtCards()) {
  return (cards || []).filter(isManualTtCard);
}
function mergeGeneratedAndManualCards(generated = [], previous = getTtCards()) {
  const generatedIds = new Set((generated || []).map(c => c.id));
  const manual = getManualTtCards(previous).filter(c => c?.id && !generatedIds.has(c.id));
  return [...generated, ...manual];
}

function pruneObsoleteGeneratedTtCardRefs(nextCards = [], previousCards = []) {
  const validIds = new Set((nextCards || []).map(c => c?.id).filter(Boolean));
  const obsoleteIds = new Set((previousCards || [])
    .filter(c => c?.id && !validIds.has(c.id) && !isManualTtCard(c))
    .map(c => c.id));
  if (!obsoleteIds.size) return 0;

  const keepValid = id => !!id && validIds.has(id) && !obsoleteIds.has(id);
  let changed = 0;

  (appState.timetable.ttcardGroups || []).forEach(group => {
    const beforePool = (group.poolCardIds || []).length;
    const beforeEx = (group.excludedCardIds || []).length;
    group.poolCardIds = (group.poolCardIds || []).filter(keepValid);
    group.excludedCardIds = (group.excludedCardIds || []).filter(keepValid);
    if (beforePool !== group.poolCardIds.length || beforeEx !== group.excludedCardIds.length) changed += 1;

    (group.units || []).forEach(unit => {
      const before = (unit.ttcardIds || []).length;
      unit.ttcardIds = (unit.ttcardIds || []).filter(keepValid);
      if (before !== unit.ttcardIds.length) changed += 1;
    });
    group.units = (group.units || []).filter(unit =>
      (unit.ttcardIds || []).length || (unit.templateIds || []).length || clean(unit.name)
    );
  });

  const entries = appState.timetable.entries || [];
  const nextEntries = [];
  entries.forEach(entry => {
    const next = { ...entry };
    const originalIds = [...(next.ttcardIds || []), next.ttcardId].filter(Boolean);

    if (next.ttcardId && obsoleteIds.has(next.ttcardId)) {
      next.ttcardId = null;
      changed += 1;
    }
    if (Array.isArray(next.ttcardIds)) {
      const filtered = next.ttcardIds.filter(keepValid);
      if (filtered.length !== next.ttcardIds.length) changed += 1;
      next.ttcardIds = filtered;
    }

    const hadOnlyObsoleteCardRefs = originalIds.length > 0 && !next.ttcardId && !(next.ttcardIds || []).length;
    if (hadOnlyObsoleteCardRefs) {
      changed += 1;
      return;
    }
    nextEntries.push(next);
  });
  if (nextEntries.length !== entries.length) changed += 1;
  appState.timetable.entries = nextEntries;

  return changed;
}
const grps = () => appState.timetable.ttcardGroups || [];
function ensureTtCardGroups() {
  if (!Array.isArray(appState.timetable.ttcardGroups)) appState.timetable.ttcardGroups = [];
  return appState.timetable.ttcardGroups;
}
function renameTtCardGroup(groupId, newName) {
  const g = grps().find(g => g.id === groupId);
  if (!g) return;
  g.name = clean(newName) || g.name;
  scheduleSave("timetable");
}
function deleteTtCardGroup(groupId) {
  appState.timetable.ttcardGroups = grps().filter(g => g.id !== groupId);
  scheduleSave("timetable");
}


// ── Persisted card data helpers ─────────────────────────────────
const classKeyOf = (gradeKey, section) => {
  const grade = gradeDisplay(gradeKey || "").trim();
  const sec = String(section || "").replace(/\s+/g, "").replace(/학년/g, "").replace(/^\d{1,2}/, "").toUpperCase();
  return grade && sec ? `${grade}:${sec}` : "";
};
const classLabelOf = (gradeKey, section) => {
  const grade = gradeDisplay(gradeKey || "").trim();
  const sec = String(section || "").replace(/\s+/g, "").replace(/학년/g, "").replace(/^\d{1,2}/, "").toUpperCase();
  return grade && sec ? `${grade}${sec}` : "";
};
function getGradeClasses(gradeKey) {
  const list = (appState.classes?.classes || [])
    .filter(c => c.grade === gradeKey)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko"));
  return list.length ? list : [{ id:"", grade: gradeKey, name: sectionLabel(0), students: [] }];
}
function getCurriculumRowForCard(gradeKey, templateId) {
  return (appState.curriculum?.gradeBoards?.[gradeKey] || [])
    .find(r => r.sem1TemplateId === templateId || r.sem2TemplateId === templateId) || null;
}
function getRosterSectionClassMap(templateId, gradeKey) {
  const out = new Map();
  const classes = appState.classes?.classes || [];
  const classById = new Map(classes.map(cls => [cls.id, cls]));
  (appState.rosters?.rosters?.[templateId] || []).forEach(re => {
    const cls = classById.get(re.classId);
    if (!cls || cls.grade !== gradeKey) return;
    const sectionIdx = Number.isInteger(re.sectionIdx) ? re.sectionIdx : (parseInt(re.sectionIdx, 10) || 0);
    if (!out.has(sectionIdx)) out.set(sectionIdx, new Set());
    const key = classKeyOf(gradeKey, cls.name || sectionLabel(sectionIdx));
    if (key) out.get(sectionIdx).add(key);
  });
  return out;
}

function rosterSectionCoversWholeGrade(templateId, gradeKey, sectionIdx = 0) {
  const sectionMap = getRosterSectionClassMap(templateId, gradeKey);
  const sectionClasses = sectionMap.get(sectionIdx) || new Set();
  if (!sectionClasses.size) return false;
  const gradeClassKeys = getGradeClasses(gradeKey)
    .map((cls, idx) => classKeyOf(gradeKey, cls.name || sectionLabel(idx)))
    .filter(Boolean);
  return gradeClassKeys.length > 1
    && sectionClasses.size >= gradeClassKeys.length
    && gradeClassKeys.every(key => sectionClasses.has(key));
}

function isWholeGradeRow(row, tpl, gradeKey = "", sectionIdx = 0) {
  if (!row || !tpl) return false;

  // 수강명단이 있으면 이름/분류가 아니라 실제 sectionIdx/classId 구조가 우선입니다.
  // - 한 section에 해당 학년 모든 반이 들어 있으면 전체학년 카드
  // - section 0/1/2가 각각 A/B/C처럼 나뉘어 있으면 반별 카드
  const rosterSections = getRosterSectionClassMap(tpl.id, gradeKey);
  if (gradeKey && rosterSections.size) {
    if (rosterSections.size !== 1) return false;
    const onlySectionIdx = [...rosterSections.keys()][0];
    return rosterSectionCoversWholeGrade(tpl.id, gradeKey, onlySectionIdx);
  }

  // 수강명단이 아직 없을 때만 명시적인 전체학년 표현을 보조 기준으로 사용합니다.
  return isProtectedWholeGradeLabel(row?.category, row?.track, row?.group, tpl?.nameKo, tpl?.nameEn);
}

function getGeneratedSectionCountForRow(templateId, gradeKey, row, tpl) {
  const rosterSections = getRosterSectionClassMap(templateId, gradeKey);
  if (rosterSections.size) {
    const firstSectionIdx = [...rosterSections.keys()].sort((a, b) => a - b)[0] ?? 0;
    if (rosterSections.size === 1 && rosterSectionCoversWholeGrade(templateId, gradeKey, firstSectionIdx)) return 1;
    const maxSectionIdx = Math.max(...rosterSections.keys());
    return Math.max(1, maxSectionIdx + 1, rosterSections.size);
  }
  return isWholeGradeRow(row, tpl, gradeKey, 0) ? 1 : Math.max(1, getClassCount(templateId));
}
function resolveCardAudience({ templateId, gradeKey, sectionIdx }) {
  const classes = appState.classes?.classes || [];
  const classKeys = new Set(), classLabels = new Set();
  const row = getCurriculumRowForCard(gradeKey, templateId);
  const tpl = getTemplateById(templateId);
  const whole = isWholeGradeRow(row, tpl, gradeKey, sectionIdx);
  const gradeClasses = getGradeClasses(gradeKey);

  // 수강명단 구조상 한 section이 해당 학년 전체 반을 덮는 경우에만
  // 학년 전체 반을 대상에 넣습니다. 분류명이 창체/자율/진로/동아리라는 이유만으로
  // 반별 수업을 통합하지 않습니다.
  if (whole) {
    gradeClasses.forEach(cls => {
      const sec = cls.name || sectionLabel(sectionIdx ?? 0);
      const key = classKeyOf(gradeKey, sec);
      const label = classLabelOf(gradeKey, sec);
      if (key) classKeys.add(key);
      if (label) classLabels.add(label);
    });
    return { classKeys:[...classKeys], classLabels:[...classLabels], studentKeys:[] };
  }

  const rosterEntries = (appState.rosters?.rosters?.[templateId] || [])
    .filter(e => (e.sectionIdx ?? 0) === (sectionIdx ?? 0));

  rosterEntries.forEach(re => {
    const cls = classes.find(c => c.id === re.classId);
    if (!cls || cls.grade !== gradeKey) return;
    const sec = cls.name || sectionLabel(sectionIdx ?? 0);
    const key = classKeyOf(gradeKey, sec);
    const label = classLabelOf(gradeKey, sec);
    if (key) classKeys.add(key);
    if (label) classLabels.add(label);
  });
  if (classKeys.size) return { classKeys:[...classKeys], classLabels:[...classLabels], studentKeys:[] };

  const targetClasses = [gradeClasses[sectionIdx] || { grade: gradeKey, name: sectionLabel(sectionIdx ?? 0) }];
  targetClasses.forEach(cls => {
    const sec = cls.name || sectionLabel(sectionIdx ?? 0);
    const key = classKeyOf(gradeKey, sec);
    const label = classLabelOf(gradeKey, sec);
    if (key) classKeys.add(key);
    if (label) classLabels.add(label);
  });
  return { classKeys:[...classKeys], classLabels:[...classLabels], studentKeys:[] };
}
function buildPersistedTtCard({ id, templateId, gradeKey, sectionIdx, existing = null, compoundPart = null, compoundPartIndex = null, compoundPartCount = 0, compoundTotalCredits = 0 }) {
  const tpl = getTemplateById(templateId);
  const row = getCurriculumRowForCard(gradeKey, templateId);
  const audience = resolveCardAudience({ templateId, gradeKey, sectionIdx });
  const baseTitle = tpl ? getTemplateCardTitle(tpl) : (existing?.subject || "(삭제된 과목)");
  const isCompoundPart = !!compoundPart;
  const partTeacherInfo = isCompoundPart ? getCompoundPartTeacherInfo(compoundPart) : null;
  const teacherInfo = isCompoundPart
    ? partTeacherInfo
    : resolveGeneratedTeachers({
        templateTeacherName: tpl ? getTemplateTeacherSummary(tpl) : (existing?.teacherName || ""),
        classLabels: audience.classLabels.length ? audience.classLabels : (existing?.classLabels || []),
      });
  const partCredits = isCompoundPart ? (parseFloat(compoundPart.credits) || 0) : null;
  const generated = normalizeTtCard({
    id, templateId, gradeKey, sectionIdx,
    label: existing?.label || "",
    subject: isCompoundPart ? getCompoundPartTitle(compoundPart, baseTitle) : baseTitle,
    subjectEn: isCompoundPart ? (clean(compoundPart.nameEn) || clean(compoundPart.nameKo) || existing?.subjectEn || "") : (tpl?.nameEn || existing?.subjectEn || ""),
    teacherName: teacherInfo.teacherName,
    teachers: teacherInfo.teachers,
    teacherMode: clean(existing?.teacherMode) || (teacherInfo.source === "none" ? "none" : ""),
    credits: isCompoundPart ? partCredits : (row ? getEffectiveCredit(row) : (existing?.credits || 0)),
    category: row?.category || existing?.category || "",
    track: row?.track || existing?.track || "",
    group: row?.group || existing?.group || "",
    classKeys: audience.classKeys.length ? audience.classKeys : (existing?.classKeys || []),
    classLabels: audience.classLabels.length ? audience.classLabels : (existing?.classLabels || []),
    // 학생 key는 시간표 카드에 저장하지 않습니다. 학급/반 점유는 classKeys만 사용합니다.
    studentKeys: [],
    isWholeGrade: row ? isWholeGradeRow(row, tpl, gradeKey, sectionIdx) : !!existing?.isWholeGrade,
    roomRule: existing?.roomRule || "teacher",
    fixedRoomId: existing?.fixedRoomId || null,
    allowedSlots: cloneSlotList(existing?.allowedSlots || existing?.availableSlots || []),
    unavailableSlots: cloneSlotList(existing?.unavailableSlots || []),
    generatedAt: new Date().toISOString(),
    manualEdited: !!existing?.manualEdited,
    compoundParentTemplateId: isCompoundPart ? templateId : null,
    compoundPartId: isCompoundPart ? compoundPart.id : null,
    compoundPartIndex: isCompoundPart ? compoundPartIndex : null,
    compoundPartCount: isCompoundPart ? compoundPartCount : 0,
    compoundTotalCredits: isCompoundPart ? compoundTotalCredits : 0,
  });
  if (existing?.manualEdited) {
    // 수동 수정값은 생성 데이터보다 우선합니다.
    // 단, 창체 시수는 시간표 적용 기준상 항상 1로 유지합니다.
    // 복합 과목의 시수는 구성 과목 시수를 우선합니다.
    ["label","teacherName","teachers","teacherMode","credits","classKeys","classLabels","isWholeGrade","roomRule","fixedRoomId","allowedSlots","unavailableSlots"].forEach(k => {
      if (k === "credits" && (isChanCheCategory(generated.category) || isCompoundPart)) return;
      if (existing[k] !== undefined) generated[k] = existing[k];
    });
  }
  return generated;
}

function buildGeneratedCardsForTemplate({ templateId, gradeKey, sectionIdx, existing = new Map() }) {
  const tpl = getTemplateById(templateId);
  const parts = normalizeCompoundParts(tpl);
  if (!parts.length) {
    const id = makeTtcId(templateId, gradeKey, sectionIdx);
    return [buildPersistedTtCard({ id, templateId, gradeKey, sectionIdx, existing: existing.get(id) || null })];
  }
  const total = parts.reduce((sum, part) => sum + (parseFloat(part.credits) || 0), 0);
  return parts.map((part, idx) => {
    const id = makeTtcId(templateId, gradeKey, sectionIdx, part.id || `part${idx + 1}`);
    return buildPersistedTtCard({
      id, templateId, gradeKey, sectionIdx, existing: existing.get(id) || null,
      compoundPart: part, compoundPartIndex: idx, compoundPartCount: parts.length, compoundTotalCredits: total
    });
  });
}

function buildAllGeneratedTtCards(existing = new Map()) {
  const cards = [];
  const seen = new Set();
  GRADE_KEYS.forEach(gradeKey => {
    const board = appState.curriculum?.gradeBoards?.[gradeKey] || [];
    const seenTpl = new Set();
    board.forEach(row => {
      if (shouldSkipTimetableCardRow(row)) return;
      [row.sem1TemplateId, row.sem2TemplateId].filter(Boolean).forEach(tplId => {
        if (seenTpl.has(tplId)) return;
        seenTpl.add(tplId);

        const tpl = getTemplateById(tplId);
        // 카드 개수는 커리큘럼 원본 + 수강명단 sectionIdx 구조에서만 결정합니다.
        // 분류명이 창체/자율/진로/동아리라는 이유만으로 반별 수업을 통합하지 않습니다.
        const cc = getGeneratedSectionCountForRow(tplId, gradeKey, row, tpl);

        for (let i = 0; i < cc; i++) {
          const built = buildGeneratedCardsForTemplate({ templateId: tplId, gradeKey, sectionIdx: i, existing });
          built.forEach(card => {
            if (seen.has(card.id)) return;
            seen.add(card.id);
            cards.push(card);
          });
        }
      });
    });
  });
  return cards;
}

function countTimetableSourceRows() {
  let count = 0;
  GRADE_KEYS.forEach(gradeKey => {
    const board = appState.curriculum?.gradeBoards?.[gradeKey] || [];
    board.forEach(row => {
      if (shouldSkipTimetableCardRow(row)) return;
      if (row.sem1TemplateId || row.sem2TemplateId) count += 1;
    });
  });
  return count;
}

function isTtCardSourceReady() {
  const gradeBoards = appState.curriculum?.gradeBoards;
  const hasCurriculum = !!gradeBoards && GRADE_KEYS.some(g => Array.isArray(gradeBoards[g]) && gradeBoards[g].length > 0);
  const hasTemplates = Array.isArray(appState.templates?.templates) && appState.templates.templates.length > 0;
  const hasClasses = Array.isArray(appState.classes?.classes) && appState.classes.classes.length > 0;
  const hasRosters = !!appState.rosters?.rosters && typeof appState.rosters.rosters === "object";
  return hasCurriculum && hasTemplates && hasClasses && hasRosters;
}

function guardGeneratedCards(cards, previousCount = 0, action = "refresh") {
  const sourceRows = countTimetableSourceRows();
  if (!isTtCardSourceReady()) {
    console.warn(`[TTCARDS] ${action} 중단: curriculum/templates/classes/rosters 원본 데이터가 아직 로딩되지 않았습니다.`);
    return { ok: false, code: "source-not-ready", count: previousCount };
  }
  if (!cards.length && sourceRows > 0) {
    console.error(`[TTCARDS] ${action} 중단: 커리큘럼 원본 ${sourceRows}행이 있으나 생성 결과가 0개입니다.`);
    return { ok: false, code: "empty-generated", count: previousCount };
  }
  return { ok: true, code: "ok", count: cards.length };
}


const CARD_GENERATION_META_VERSION = "2026-06-16-card-reference-migration-r56";
const CARD_GENERATION_ISSUE_LIMIT = 80;

function normalizeStoredClassKey(key, fallbackGradeKey = "") {
  const raw = clean(key).replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
  if (!raw) return "";
  if (raw.includes(":")) {
    const [g, sec] = raw.split(":");
    const grade = clean(g || fallbackGradeKey).replace(/학년/g, "");
    const section = clean(sec).replace(/^\d{1,2}/, "").toUpperCase();
    return grade && section ? `${grade}:${section}` : "";
  }
  const m = raw.match(/^(\d{1,2})(.+)$/);
  if (m) return `${m[1]}:${m[2]}`;
  const fg = gradeDisplay(fallbackGradeKey || "").trim();
  return fg && raw ? `${fg}:${raw}` : "";
}

function normalizeStoredClassLabel(label, fallbackGradeKey = "") {
  const raw = clean(label).replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
  if (!raw) return "";
  const m = raw.match(/^(\d{1,2})(.+)$/);
  if (m) return `${m[1]}${m[2]}`;
  const fg = gradeDisplay(fallbackGradeKey || "").trim();
  return fg && raw ? `${fg}${raw}` : raw;
}

function classLabelFromKey(key, fallbackGradeKey = "") {
  const normalized = normalizeStoredClassKey(key, fallbackGradeKey);
  const [g, sec] = normalized.split(":");
  return g && sec ? `${g}${sec}` : "";
}

function classKeyFromLabel(label, fallbackGradeKey = "") {
  const normalized = normalizeStoredClassLabel(label, fallbackGradeKey);
  const m = normalized.match(/^(\d{1,2})(.+)$/);
  if (m) return `${m[1]}:${m[2]}`;
  return normalizeStoredClassKey(normalized, fallbackGradeKey);
}

function normalizeClassPairs({ classKeys = [], classLabels = [], fallbackGradeKey = "" } = {}) {
  const pairMap = new Map();
  (classKeys || []).forEach(k => {
    const key = normalizeStoredClassKey(k, fallbackGradeKey);
    if (!key) return;
    pairMap.set(key, classLabelFromKey(key, fallbackGradeKey));
  });
  (classLabels || []).forEach(l => {
    const label = normalizeStoredClassLabel(l, fallbackGradeKey);
    if (!label) return;
    const key = classKeyFromLabel(label, fallbackGradeKey);
    if (!key) return;
    pairMap.set(key, label);
  });
  return {
    classKeys: [...pairMap.keys()],
    classLabels: [...pairMap.values()],
  };
}

function sameArrayValues(a = [], b = []) {
  const aa = (a || []).map(clean).filter(Boolean).sort();
  const bb = (b || []).map(clean).filter(Boolean).sort();
  return aa.length === bb.length && aa.every((v, i) => v === bb[i]);
}

function pushCardGenerationIssue(meta, level, type, message, extra = {}) {
  const entry = { level, type, message, ...extra };
  if (level === "error") meta.errorCount += 1;
  else meta.warningCount += 1;
  if ((extra.repaired || level === "repair") && level !== "error") meta.repairCount += 1;
  if (meta.issues.length < CARD_GENERATION_ISSUE_LIMIT) meta.issues.push(entry);
}

function repairTtCardIntegrity(card, meta, { action = "refresh" } = {}) {
  if (!card) return null;
  const tpl = getTemplateById(card.templateId);
  const row = getCurriculumRowForCard(card.gradeKey, card.templateId);
  const expectedWhole = row ? isWholeGradeRow(row, tpl, card.gradeKey, card.sectionIdx ?? 0) : false;
  const manual = isManualTtCard(card) || !!card.isManual;
  const beforeKeys = [...(card.classKeys || [])];
  const beforeLabels = [...(card.classLabels || [])];
  const beforeWhole = !!card.isWholeGrade;

  // 1) classKeys/classLabels는 항상 한 쌍으로 맞춥니다. studentKeys는 시간표 기준에서 제거합니다.
  const normalizedPair = normalizeClassPairs({
    classKeys: card.classKeys || [],
    classLabels: card.classLabels || [],
    fallbackGradeKey: card.gradeKey,
  });
  card.classKeys = normalizedPair.classKeys;
  card.classLabels = normalizedPair.classLabels;
  card.studentKeys = [];

  // 2) 생성 카드인데 대상 반이 비었거나 원본과 불일치하는 경우, 생성 규칙에서 다시 계산합니다.
  const expectedAudience = (card.templateId && card.gradeKey)
    ? resolveCardAudience({ templateId: card.templateId, gradeKey: card.gradeKey, sectionIdx: card.sectionIdx ?? 0 })
    : { classKeys: [], classLabels: [] };
  const shouldFollowGeneratedAudience = !manual && !card.manualEdited;
  if (expectedWhole && expectedAudience.classKeys.length) {
    if (!sameArrayValues(card.classKeys, expectedAudience.classKeys)) {
      card.classKeys = [...expectedAudience.classKeys];
      card.classLabels = [...expectedAudience.classLabels];
      pushCardGenerationIssue(meta, "warning", "whole-grade-audience-repaired", `${getTtCardLabel(card)}: 전체학년 카드 대상 반을 현재 학급 목록으로 보정했습니다.`, { cardId: card.id, repaired: true });
    }
    card.isWholeGrade = true;
  } else if (shouldFollowGeneratedAudience && expectedAudience.classKeys.length && !sameArrayValues(card.classKeys, expectedAudience.classKeys)) {
    card.classKeys = [...expectedAudience.classKeys];
    card.classLabels = [...expectedAudience.classLabels];
    pushCardGenerationIssue(meta, "warning", "generated-audience-repaired", `${getTtCardLabel(card)}: 생성 카드 대상 반을 원본 수강명단/분반 기준으로 보정했습니다.`, { cardId: card.id, repaired: true });
  } else if (!card.classKeys.length && expectedAudience.classKeys.length) {
    card.classKeys = [...expectedAudience.classKeys];
    card.classLabels = [...expectedAudience.classLabels];
    pushCardGenerationIssue(meta, "warning", "missing-audience-repaired", `${getTtCardLabel(card)}: 비어 있던 대상 반을 원본 기준으로 보정했습니다.`, { cardId: card.id, repaired: true });
  }

  // 3) 수동 수정/수동 생성 카드에 남은 isWholeGrade 잔여값을 정리합니다.
  //    예: classKeys는 12:A 하나뿐인데 isWholeGrade=true인 오래된 HR/수동 카드.
  if (!expectedWhole && card.isWholeGrade && (shouldFollowGeneratedAudience || (card.classKeys || []).length <= 1)) {
    card.isWholeGrade = false;
    pushCardGenerationIssue(meta, "warning", "stale-whole-grade-flag-repaired", `${getTtCardLabel(card)}: 원본 수강명단 기준 반별 카드이므로 전체학년 플래그를 해제했습니다.`, { cardId: card.id, repaired: true });
  }

  // 4) 교사 문자열과 배열을 동기화합니다. 다중교사는 splitTeacherNames 기준입니다.
  const teacherNames = uniqueNames([
    ...splitTeacherNames(card.teacherName),
    ...((Array.isArray(card.teachers) ? card.teachers : []).flatMap(t => splitTeacherNames(t))),
  ]);
  if (teacherNames.length) {
    const joined = teacherNames.join(", ");
    if (!sameArrayValues(card.teachers || [], teacherNames) || clean(card.teacherName) !== joined) {
      card.teachers = teacherNames;
      card.teacherName = joined;
      pushCardGenerationIssue(meta, "warning", "teacher-snapshot-repaired", `${getTtCardLabel(card)}: 교사 스냅샷을 배열/문자열 기준으로 동기화했습니다.`, { cardId: card.id, repaired: true });
    }
  } else {
    card.teachers = [];
    card.teacherName = "";
  }

  // 5) 필수 참조와 시수 기본값을 검증합니다.
  if (!manual && card.templateId && !tpl) {
    pushCardGenerationIssue(meta, "error", "missing-template", `${getTtCardLabel(card)}: 과목 템플릿을 찾을 수 없습니다.`, { cardId: card.id, templateId: card.templateId });
  }
  if (!card.gradeKey) {
    pushCardGenerationIssue(meta, "error", "missing-grade", `${getTtCardLabel(card)}: gradeKey가 비어 있습니다.`, { cardId: card.id });
  }
  if (!(card.classKeys || []).length) {
    pushCardGenerationIssue(meta, "error", "missing-class-keys", `${getTtCardLabel(card)}: 대상 classKeys가 비어 있습니다.`, { cardId: card.id });
  }
  if ((card.classKeys || []).length !== (card.classLabels || []).length) {
    const fixed = normalizeClassPairs({ classKeys: card.classKeys, classLabels: card.classLabels, fallbackGradeKey: card.gradeKey });
    card.classKeys = fixed.classKeys;
    card.classLabels = fixed.classLabels;
    pushCardGenerationIssue(meta, "warning", "class-key-label-mismatch-repaired", `${getTtCardLabel(card)}: classKeys/classLabels 개수 불일치를 보정했습니다.`, { cardId: card.id, repaired: true });
  }
  const n = parseFloat(card.credits);
  if (!Number.isFinite(n) || n < 0) {
    card.credits = 0;
    pushCardGenerationIssue(meta, "warning", "invalid-credits-repaired", `${getTtCardLabel(card)}: 잘못된 시수 값을 0으로 보정했습니다.`, { cardId: card.id, repaired: true });
  }

  if (!sameArrayValues(beforeKeys, card.classKeys) || !sameArrayValues(beforeLabels, card.classLabels) || beforeWhole !== !!card.isWholeGrade) {
    meta.repairedCardIds.add(card.id);
  }
  return card;
}


function cardPartSignature(card) {
  return clean(card?.compoundPartId) || "";
}

function cardClassKeySet(card, fallbackGradeKey = "") {
  return new Set((card?.classKeys || [])
    .map(k => normalizeStoredClassKey(k, fallbackGradeKey || card?.gradeKey))
    .filter(Boolean));
}

function currentCardsForSameSource(card, cards = []) {
  const partSig = cardPartSignature(card);
  return (cards || []).filter(c =>
    c?.templateId === card?.templateId &&
    c?.gradeKey === card?.gradeKey &&
    cardPartSignature(c) === partSig
  );
}

function isLegacyWholeGradeReferenceCandidate(card) {
  if (!card?.templateId || !card?.gradeKey) return false;
  const tpl = getTemplateById(card.templateId);
  const row = getCurriculumRowForCard(card.gradeKey, card.templateId);
  if (!tpl || !row) return false;
  const keys = cardClassKeySet(card, card.gradeKey);
  if (keys.size <= 1) return false;
  // r55 이전에는 창체/자율/진로/동아리 명칭만으로 전체학년 카드가 만들어졌습니다.
  // 그런 카드 ID가 r55 이후 반별 section 0 카드 ID와 충돌할 수 있으므로,
  // 기존 참조를 현재 반별 카드 전체로 확장합니다.
  return isProtectedWholeGradeLabel(row?.category, row?.track, row?.group, tpl?.nameKo, tpl?.nameEn);
}

function findCurrentCardsCoveredByLegacyCard(oldCard, currentCards = []) {
  const oldKeys = cardClassKeySet(oldCard, oldCard?.gradeKey);
  if (!oldKeys.size) return [];
  return currentCardsForSameSource(oldCard, currentCards).filter(card => {
    const nowKeys = cardClassKeySet(card, card?.gradeKey);
    if (!nowKeys.size) return false;
    return [...nowKeys].some(key => oldKeys.has(key));
  });
}

function buildCardReferenceMigrationMap(currentCards = [], previousCards = []) {
  const currentById = new Map((currentCards || []).filter(c => c?.id).map(c => [c.id, c]));
  const map = new Map();

  (previousCards || []).forEach(oldCard => {
    if (!oldCard?.id) return;
    const currentSameId = currentById.get(oldCard.id);
    if (!isLegacyWholeGradeReferenceCandidate(oldCard)) {
      if (!currentSameId) {
        const fallback = findCurrentCardsCoveredByLegacyCard(oldCard, currentCards);
        if (fallback.length) map.set(oldCard.id, fallback.map(c => c.id));
      }
      return;
    }

    const expanded = findCurrentCardsCoveredByLegacyCard(oldCard, currentCards);
    if (expanded.length > 1) {
      map.set(oldCard.id, expanded.map(c => c.id));
    } else if (!currentSameId && expanded.length === 1) {
      map.set(oldCard.id, [expanded[0].id]);
    }
  });

  return map;
}

function uniqueValidCardRefs(list = [], validIds = new Set()) {
  const seen = new Set();
  const out = [];
  (list || []).forEach(id => {
    const v = clean(id);
    if (!v || seen.has(v) || (validIds.size && !validIds.has(v))) return;
    seen.add(v);
    out.push(v);
  });
  return out;
}

function migrateCardRefList(list = [], migrationMap = new Map(), validIds = new Set()) {
  const expanded = [];
  let changed = false;
  (list || []).forEach(id => {
    const v = clean(id);
    if (!v) return;
    const replacement = migrationMap.get(v);
    if (replacement && replacement.length) {
      expanded.push(...replacement);
      if (replacement.length !== 1 || replacement[0] !== v) changed = true;
    } else {
      expanded.push(v);
    }
  });
  const normalized = uniqueValidCardRefs(expanded, validIds);
  if (normalized.length !== (list || []).length || normalized.some((id, idx) => id !== (list || [])[idx])) changed = true;
  return { list: normalized, changed };
}

function migrateTimetableCardReferencesForRegeneration(cards = [], previousCards = [], meta) {
  const migrationMap = buildCardReferenceMigrationMap(cards, previousCards);
  if (!migrationMap.size) return 0;
  const validIds = new Set((cards || []).map(c => c?.id).filter(Boolean));
  let changed = 0;

  (appState.timetable.ttcardGroups || []).forEach(group => {
    const pool = migrateCardRefList(group.poolCardIds || [], migrationMap, validIds);
    if (pool.changed) {
      group.poolCardIds = pool.list;
      meta.repairedGroupIds.add(group.id || group.name || "group");
      changed += 1;
    }
    const excluded = migrateCardRefList(group.excludedCardIds || [], migrationMap, validIds);
    if (excluded.changed) {
      group.excludedCardIds = excluded.list;
      meta.repairedGroupIds.add(group.id || group.name || "group");
      changed += 1;
    }
    (group.units || []).forEach(unit => {
      const migrated = migrateCardRefList(unit.ttcardIds || [], migrationMap, validIds);
      if (migrated.changed) {
        unit.ttcardIds = migrated.list;
        meta.repairedGroupIds.add(group.id || group.name || "group");
        changed += 1;
      }
    });
  });

  (appState.timetable.entries || []).forEach(entry => {
    const ids = [...(entry.ttcardIds || []), entry.ttcardId].filter(Boolean);
    if (!ids.length) return;
    const migrated = migrateCardRefList(ids, migrationMap, validIds);
    if (migrated.changed) {
      entry.ttcardIds = migrated.list;
      entry.ttcardId = null;
      changed += 1;
    }
  });

  if (changed) {
    pushCardGenerationIssue(meta, "warning", "legacy-whole-grade-card-refs-migrated",
      `이전 전체학년 카드 참조를 현재 반별 카드 참조로 이관했습니다.`, { repaired: true, changedCount: changed });
  }
  return changed;
}

function classKeyForClassId(classId) {
  const cls = (appState.classes?.classes || []).find(c => c.id === classId);
  if (!cls) return "";
  return classKeyOf(cls.grade, cls.name);
}

function classKeyForRoomId(roomId) {
  const room = (appState.rooms?.rooms || []).find(r => r.id === roomId);
  return room?.homeRoomClassId ? classKeyForClassId(room.homeRoomClassId) : "";
}

function inferEntryClassKeys(entry) {
  const fromRoom = classKeyForRoomId(entry?.roomId);
  if (fromRoom) return [fromRoom];
  return (entry?.audienceClassKeys || []).map(k => normalizeStoredClassKey(k, entry?.gradeKey)).filter(Boolean);
}


function collectEntriesForGroupReferenceRecovery() {
  // 자동 복구는 현재 시간표에 실제 배치되어 있는 entry만 사용합니다.
  // 과거 savedSchedules/bestSnapshot은 오래된 자동배치 결과일 수 있으므로
  // 사용자 지정 그룹을 임의로 재구성하는 근거로 쓰지 않습니다.
  return (appState.timetable?.entries || []).filter(entry => entry && clean(entry.groupId));
}


function restoreEmptyGroupPoolFromPlacedEntries(cards = [], meta) {
  const validIds = new Set((cards || []).map(c => c?.id).filter(Boolean));
  const byGroup = new Map();
  collectEntriesForGroupReferenceRecovery().forEach(entry => {
    const gid = clean(entry?.groupId);
    if (!gid) return;
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid).push(entry);
  });

  let restoredCount = 0;
  (appState.timetable.ttcardGroups || []).forEach(group => {
    const hasPool = (group.poolCardIds || []).some(id => validIds.has(id));
    const hasUnitRefs = (group.units || []).some(unit => (unit.ttcardIds || []).some(id => validIds.has(id)));
    if (hasPool || hasUnitRefs) return;

    const relatedEntries = byGroup.get(group.id) || [];
    if (!relatedEntries.length) return;

    const templateIds = new Set();
    const classKeys = new Set();
    relatedEntries.forEach(entry => {
      (entry.templateIds || []).forEach(id => id && templateIds.add(id));
      (entry.ttcardIds || []).forEach(id => {
        const card = cards.find(c => c.id === id);
        if (card?.templateId) templateIds.add(card.templateId);
      });
      inferEntryClassKeys(entry).forEach(k => k && classKeys.add(k));
    });
    if (!templateIds.size) return;

    const restored = cards.filter(card => {
      if (!templateIds.has(card.templateId)) return false;
      if (!classKeys.size) return true;
      const keys = cardClassKeySet(card, card.gradeKey);
      return [...keys].some(key => classKeys.has(key));
    }).map(card => card.id);

    const unique = uniqueValidCardRefs(restored, validIds);
    if (!unique.length) return;

    group.poolCardIds = unique;
    meta.repairedGroupIds.add(group.id || group.name || "group");
    restoredCount += 1;
  });

  if (restoredCount) {
    pushCardGenerationIssue(meta, "warning", "empty-group-pool-restored-from-entries",
      `배치된 그룹 entry를 기준으로 비어 있던 그룹카드 참조를 복구했습니다.`, { repaired: true, groupCount: restoredCount });
  }
  return restoredCount;
}

function expandLegacySplitRefsWithinGroupScope(cards = [], meta) {
  const validIds = new Set((cards || []).map(c => c?.id).filter(Boolean));
  const cardById = new Map((cards || []).filter(c => c?.id).map(c => [c.id, c]));
  let changed = 0;

  const expandList = (list = [], scopeKeys = new Set()) => {
    const out = [];
    let localChanged = false;
    (list || []).forEach(id => {
      const card = cardById.get(id);
      if (!card) return;
      const tpl = getTemplateById(card.templateId);
      const row = getCurriculumRowForCard(card.gradeKey, card.templateId);
      const shouldConsider = tpl && row && isProtectedWholeGradeLabel(row?.category, row?.track, row?.group, tpl?.nameKo, tpl?.nameEn);
      const siblings = shouldConsider
        ? currentCardsForSameSource(card, cards).filter(sib => {
            const keys = cardClassKeySet(sib, sib.gradeKey);
            return !scopeKeys.size || [...keys].some(key => scopeKeys.has(key));
          })
        : [];
      if (siblings.length > 1 && (card.classKeys || []).length <= 1) {
        out.push(...siblings.map(s => s.id));
        localChanged = true;
      } else {
        out.push(id);
      }
    });
    const normalized = uniqueValidCardRefs(out, validIds);
    return { list: normalized, changed: localChanged || normalized.length !== (list || []).length };
  };

  (appState.timetable.ttcardGroups || []).forEach(group => {
    const scopeKeys = new Set();
    (group.poolCardIds || []).forEach(id => {
      const card = cardById.get(id);
      cardClassKeySet(card, card?.gradeKey).forEach(k => scopeKeys.add(k));
    });
    (group.units || []).forEach(unit => (unit.ttcardIds || []).forEach(id => {
      const card = cardById.get(id);
      cardClassKeySet(card, card?.gradeKey).forEach(k => scopeKeys.add(k));
    }));

    const pool = expandList(group.poolCardIds || [], scopeKeys);
    if (pool.changed) {
      group.poolCardIds = pool.list;
      meta.repairedGroupIds.add(group.id || group.name || "group");
      changed += 1;
    }
    const excluded = expandList(group.excludedCardIds || [], scopeKeys);
    if (excluded.changed) {
      group.excludedCardIds = excluded.list;
      meta.repairedGroupIds.add(group.id || group.name || "group");
      changed += 1;
    }
    (group.units || []).forEach(unit => {
      const unitRefs = expandList(unit.ttcardIds || [], scopeKeys);
      if (unitRefs.changed) {
        unit.ttcardIds = unitRefs.list;
        meta.repairedGroupIds.add(group.id || group.name || "group");
        changed += 1;
      }
    });
  });

  if (changed) {
    pushCardGenerationIssue(meta, "warning", "legacy-split-group-refs-expanded",
      `반별로 분리된 창체/진로/동아리 계열 카드 참조를 같은 그룹 범위 안에서 확장했습니다.`, { repaired: true, changedCount: changed });
  }
  return changed;
}


function repairTtCardGroupReferences(cards, meta) {
  const validIds = new Set((cards || []).map(c => c?.id).filter(Boolean));
  const uniqueRefs = list => {
    const seen = new Set();
    const kept = [];
    (list || []).forEach(id => {
      const v = clean(id);
      if (!v || seen.has(v)) return;
      seen.add(v);
      if (validIds.has(v)) kept.push(v);
      else pushCardGenerationIssue(meta, "warning", "invalid-group-card-ref-removed", `그룹 참조에서 존재하지 않는 카드 ID를 제거했습니다: ${v}`, { cardId: v, repaired: true });
    });
    return kept;
  };

  (appState.timetable.ttcardGroups || []).forEach(group => {
    const beforePool = (group.poolCardIds || []).length;
    const beforeEx = (group.excludedCardIds || []).length;
    group.poolCardIds = uniqueRefs(group.poolCardIds || []);
    group.excludedCardIds = uniqueRefs(group.excludedCardIds || []);
    if (beforePool !== group.poolCardIds.length || beforeEx !== group.excludedCardIds.length) {
      meta.repairedGroupIds.add(group.id || group.name || "group");
    }
    (group.units || []).forEach(unit => {
      const before = (unit.ttcardIds || []).length;
      unit.ttcardIds = uniqueRefs(unit.ttcardIds || []);
      if (before !== unit.ttcardIds.length) meta.repairedGroupIds.add(group.id || group.name || "group");
    });
  });
}

function repairTimetableEntryAudienceFromCards(cards, meta) {
  const cardMap = new Map((cards || []).filter(c => c?.id).map(c => [c.id, c]));
  const entries = appState.timetable.entries || [];
  entries.forEach(entry => {
    const ids = [...(entry.ttcardIds || []), entry.ttcardId].filter(Boolean);
    if (!ids.length) return;
    const related = ids.map(id => cardMap.get(id)).filter(Boolean);
    if (!related.length) return;
    const classKeys = [...new Set(related.flatMap(card => card.classKeys || []).map(k => normalizeStoredClassKey(k, entry.gradeKey)).filter(Boolean))];
    if (classKeys.length && !sameArrayValues(entry.audienceClassKeys || [], classKeys)) {
      entry.audienceClassKeys = classKeys;
      meta.repairedEntryCount += 1;
      pushCardGenerationIssue(meta, "warning", "entry-audience-repaired", `배치 entry의 audienceClassKeys를 카드 기준으로 보정했습니다.`, { entryId: entry.id, repaired: true });
    }
    const teachers = uniqueNames(related.flatMap(card => [card.teacherName, ...(card.teachers || [])].flatMap(t => splitTeacherNames(t))));
    const joined = teachers.join(", ");
    if (clean(entry.teacherName) !== joined) {
      entry.teacherName = joined;
      meta.repairedEntryCount += 1;
      pushCardGenerationIssue(meta, "warning", "entry-teacher-repaired", `배치 entry의 teacherName을 카드 기준으로 보정했습니다.`, { entryId: entry.id, repaired: true });
    }
  });
}

function validateAndRepairTtCardGeneration(cards = [], { action = "refresh", previous = [] } = {}) {
  const meta = {
    schemaVersion: CARD_GENERATION_META_VERSION,
    action,
    checkedAt: new Date().toISOString(),
    cardCount: cards.length,
    generatedCardCount: (cards || []).filter(c => !isManualTtCard(c)).length,
    manualCardCount: (cards || []).filter(isManualTtCard).length,
    warningCount: 0,
    errorCount: 0,
    repairCount: 0,
    repairedEntryCount: 0,
    repairedCardIds: new Set(),
    repairedGroupIds: new Set(),
    issues: [],
  };

  const seenIds = new Set();
  const repairedCards = (cards || []).map(card => {
    if (!card?.id) {
      pushCardGenerationIssue(meta, "error", "missing-card-id", "ID가 없는 시간표 카드가 있습니다.", {});
      return card;
    }
    if (seenIds.has(card.id)) {
      pushCardGenerationIssue(meta, "error", "duplicate-card-id", `중복 시간표 카드 ID가 있습니다: ${card.id}`, { cardId: card.id });
    }
    seenIds.add(card.id);
    return repairTtCardIntegrity(card, meta, { action });
  }).filter(Boolean);

  migrateTimetableCardReferencesForRegeneration(repairedCards, previous, meta);
  restoreEmptyGroupPoolFromPlacedEntries(repairedCards, meta);
  expandLegacySplitRefsWithinGroupScope(repairedCards, meta);
  repairTtCardGroupReferences(repairedCards, meta);
  repairTimetableEntryAudienceFromCards(repairedCards, meta);

  const serializableMeta = {
    ...meta,
    repairedCardIds: [...meta.repairedCardIds],
    repairedGroupIds: [...meta.repairedGroupIds],
    issueLimit: CARD_GENERATION_ISSUE_LIMIT,
    truncated: meta.issues.length >= CARD_GENERATION_ISSUE_LIMIT,
  };
  appState.timetable.cardGenerationMeta = serializableMeta;
  console.info(`[TTCARDS] 생성검증 ${action}: cards=${serializableMeta.cardCount}, repairs=${serializableMeta.repairCount}, warnings=${serializableMeta.warningCount}, errors=${serializableMeta.errorCount}`);
  return { cards: repairedCards, meta: serializableMeta };
}

function cardGenerationMetaAlertSuffix() {
  const meta = appState.timetable?.cardGenerationMeta;
  if (!meta) return "";
  const parts = [];
  if (meta.repairCount) parts.push(`보정 ${meta.repairCount}건`);
  if (meta.warningCount) parts.push(`경고 ${meta.warningCount}건`);
  if (meta.errorCount) parts.push(`오류 ${meta.errorCount}건`);
  if (!parts.length) return "\n\n생성검증: 정상";
  if (!meta.errorCount) {
    return `\n\n생성검증: 자동 정리 ${meta.repairCount || meta.warningCount}건 · 오류 없음\n자세한 내용은 내보낸 JSON의 data.timetable.cardGenerationMeta에서 확인할 수 있습니다.`;
  }
  return `\n\n생성검증: ${parts.join(" · ")}\n자세한 내용은 내보낸 JSON의 data.timetable.cardGenerationMeta에서 확인할 수 있습니다.`;
}

export function refreshTtCardData() {
  if (!canEdit()) return 0;

  // 갱신은 항상 커리큘럼 보드 + 과목카드 + 수강명단 원본을 기준으로 재생성합니다.
  // 원본 도메인이 아직 로딩되지 않은 상태에서는 절대 빈 배열을 저장하지 않습니다.
  const before = getTtCards();
  const existing = new Map(before.map(c => [c.id, c]));
  const generatedCards = buildAllGeneratedTtCards(existing);
  const mergedCards = mergeGeneratedAndManualCards(generatedCards, before);
  const guard = guardGeneratedCards(generatedCards, before.length, "refresh");
  if (!guard.ok) return guard.code === "source-not-ready" ? -1 : before.length;

  const { cards: nextCards } = validateAndRepairTtCardGeneration(mergedCards, { action: "refresh", previous: before });
  appState.timetable.ttcards = nextCards;
  pruneObsoleteGeneratedTtCardRefs(nextCards, before);
  scheduleSave("timetable");
  return nextCards.length;
}
export function clearTtCards() {
  if (!canEdit()) return 0;
  const ids = new Set(getTtCards().map(c => c.id));
  appState.timetable.ttcards = [];
  (appState.timetable.ttcardGroups || []).forEach(g => {
    g.poolCardIds = (g.poolCardIds || []).filter(id => !ids.has(id));
    (g.units || []).forEach(u => { u.ttcardIds = (u.ttcardIds || []).filter(id => !ids.has(id)); });
  });
  scheduleSave("timetable");
  return ids.size;
}
function updateTtCardField(cardId, field, value) {
  if (!canEdit()) return;
  const card = getTtCardById(cardId); if (!card) return;
  if (field === "studentKeys") {
    card.studentKeys = [];
  } else if (["classLabels","classKeys","teachers"].includes(field)) {
    card[field] = String(value || "").split(/[,，\n]+/).map(x => x.trim()).filter(Boolean);
  } else if (field === "credits") {
    card[field] = isChanCheCategory(card.category) ? 1 : (parseFloat(value) || 0);
  } else if (field === "isWholeGrade") {
    card[field] = !!value;
  } else {
    card[field] = value;
  }
  card.manualEdited = true;
  scheduleSave("timetable");
}


function arrText(v) {
  return Array.isArray(v) ? v.filter(Boolean).join(", ") : clean(v);
}

function shortId(id) {
  const v = clean(id);
  return v.length > 18 ? `${v.slice(0, 18)}…` : v;
}

function getTtCardSourceSnapshot(card) {
  if (isManualTtCard(card)) {
    return {
      templateId: card?.templateId || card?.id || "",
      title: "수동 생성 카드",
      nameEn: card?.subjectEn || "",
      teacher: card?.teacherName || arrText(card?.teachers),
      language: "",
      schoolLevel: "",
      semesterMode: "수동",
      gradeSection: `${gradeDisplay(card?.gradeKey)}${arrText(card?.classLabels) ? ` · ${arrText(card?.classLabels)}` : ""}`,
      classCount: Array.isArray(card?.classLabels) ? card.classLabels.length : 0,
      category: card?.category || "교과",
      track: card?.track || "수동",
      group: card?.group || "수동",
      credits: clean(card?.credits),
      compoundSummary: "",
    };
  }
  const tpl = getTemplateById(card?.templateId);
  const row = getCurriculumRowForCard(card?.gradeKey, card?.templateId);
  const classCount = getClassCount(card?.templateId);
  const semesterMode = tpl?.useSemesterOverrides
    ? `학기분리 · 1학기 ${clean(tpl.sem1NameKo) || clean(tpl.nameKo) || "-"} / 2학기 ${clean(tpl.sem2NameKo) || clean(tpl.nameKo) || "-"}`
    : "통합";
  const compoundSummary = isCompoundTemplate(tpl)
    ? normalizeCompoundParts(tpl).map(p => `${getCompoundPartTitle(p)} ${p.credits || 0}시수`).join(" + ")
    : "";
  return {
    templateId: card?.templateId || "",
    title: tpl ? getTemplateCardTitle(tpl) : "(삭제된 과목카드)",
    nameEn: tpl?.nameEn || "",
    teacher: tpl ? getTemplateTeacherSummary(tpl) : "",
    language: tpl?.language || "",
    schoolLevel: tpl?.schoolLevel || "",
    semesterMode,
    gradeSection: `${gradeDisplay(card?.gradeKey)}${sectionLabel(card?.sectionIdx ?? 0)}`,
    classCount: classCount || 1,
    category: row?.category || "",
    track: row?.track || "",
    group: row?.group || "",
    credits: clean(row?.credits),
    compoundSummary,
  };
}

function makeInfoLine(label, value, opts = {}) {
  const row = document.createElement("div");
  row.style.cssText = "display:grid;grid-template-columns:58px 1fr;gap:6px;align-items:start;font-size:11px;line-height:1.35;margin:2px 0";
  const l = document.createElement("span");
  l.textContent = label;
  l.style.cssText = "font-weight:800;color:#64748b;white-space:nowrap";
  const v = document.createElement("span");
  v.textContent = clean(value) || "-";
  v.style.cssText = opts.mono
    ? "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#334155;word-break:break-all"
    : "color:#1f2937;word-break:keep-all;overflow-wrap:anywhere";
  row.append(l, v);
  return row;
}

function makeInfoBox(title, lines, options = {}) {
  const box = document.createElement("div");
  box.className = "ttc-info-box";
  if (options.bg) box.style.setProperty("--ttc-info-bg", options.bg);
  const h = document.createElement("div");
  h.className = "ttc-info-title";
  h.textContent = title;
  box.appendChild(h);
  lines.forEach(line => box.appendChild(makeInfoLine(line[0], line[1], line[2] || {})));
  return box;
}

function makeCollapsibleInfoBox(title, summaryText, lines, options = {}) {
  const details = document.createElement("details");
  details.className = "ttc-info-details" + (options.warning ? " ttc-info-warning" : "");
  if (options.bg) details.style.setProperty("--ttc-info-bg", options.bg);
  const summary = document.createElement("summary");
  const main = document.createElement("span");
  main.className = "ttc-info-summary-title";
  main.textContent = title;
  const sub = document.createElement("span");
  sub.className = "ttc-info-summary-text";
  sub.textContent = summaryText || "클릭해서 상세 보기";
  summary.append(main, sub);
  details.appendChild(summary);
  const body = document.createElement("div");
  body.className = "ttc-info-detail-body";
  lines.forEach(line => body.appendChild(makeInfoLine(line[0], line[1], line[2] || {})));
  details.appendChild(body);
  return details;
}

function createSourceCardBox(card) {
  const src = getTtCardSourceSnapshot(card);
  const summary = [src.title, src.gradeSection, src.teacher].filter(Boolean).join(" · ");
  return makeCollapsibleInfoBox("원본", summary, [
    ["과목", src.title],
    ["영문", src.nameEn],
    ["교사", src.teacher],
    ["언어", src.language],
    ["학기", src.semesterMode],
    ["복합", src.compoundSummary || "-"],
    ["기준반", src.gradeSection],
    ["반수", `${src.classCount}반`],
    ["분류", [src.category, src.track, src.group].filter(Boolean).join(" / ")],
    ["시수", src.credits],
    ["ID", shortId(src.templateId), { mono:true }],
  ], { bg:"#f8fbff" });
}

function createGeneratedCardBox(card) {
  const target = arrText(card.classLabels);
  const summary = [card.subject || card.label || "-", target || "대상 없음", card.teacherName || arrText(card.teachers)].filter(Boolean).join(" · ");
  return makeCollapsibleInfoBox("카드 데이터", summary, [
    ["제목", card.subject || card.label || ""],
    ["대상", target],
    ["반Key", arrText(card.classKeys), { mono:true }],
    ["교사", card.teacherName || arrText(card.teachers)],
    ["시수", String(card.credits ?? "")],
    ["복합", card.compoundPartId ? `${(card.compoundPartIndex ?? 0) + 1}/${card.compoundPartCount || "?"} · 전체 ${card.compoundTotalCredits || "?"}시수` : "-"],
    ["전체", card.isWholeGrade ? "전체 학년 점유" : "지정 반만 점유"],
    ["상태", isManualTtCard(card) ? "수동 생성됨" : (card.manualEdited ? "수동 수정됨" : "원본 기준")],
    ["생성", card.generatedAt ? card.generatedAt.replace("T", " ").slice(0, 16) : ""],
  ], { bg: (card.manualEdited || isManualTtCard(card)) ? "#fff7ed" : "#f8fafc", warning: card.manualEdited || isManualTtCard(card) });
}

// ── TtCard helpers ────────────────────────────────────────────────
export function getTtCardLabel(card) {
  if (!card) return "-";
  if (card.label) return card.label;
  const base = card.subject || (getTemplateById(card.templateId) ? getTemplateCardTitle(getTemplateById(card.templateId)) : "(삭제된 과목)");
  const cls = Array.isArray(card.classLabels) && card.classLabels.length ? card.classLabels.join(", ") : "";
  return cls ? `${base} ${cls}` : base;
}

/** Stable deterministic ID so group references survive regeneration */
export const makeTtcId = (templateId, gradeKey, sectionIdx, partId = "") =>
  partId ? `ttc_${templateId}_${gradeKey}_${sectionIdx}_part_${partId}` : `ttc_${templateId}_${gradeKey}_${sectionIdx}`;

function getTtCardCredits(card) {
  const row = (appState.curriculum.gradeBoards[card.gradeKey] || [])
    .find(r => r.sem1TemplateId === card.templateId || r.sem2TemplateId === card.templateId);
  return row?.credits || null;
}

// ── Generation ────────────────────────────────────────────────────
export function generateTtCards() {
  if (!canEdit()) return 0;
  const before = getTtCards();
  const existing = new Map(before.map(c => [c.id, c]));
  const generated = buildAllGeneratedTtCards(existing);
  const mergedCards = mergeGeneratedAndManualCards(generated, before);
  const guard = guardGeneratedCards(generated, before.length, "generate");
  if (!guard.ok) return guard.code === "source-not-ready" ? -1 : before.length;
  const { cards } = validateAndRepairTtCardGeneration(mergedCards, { action: "generate", previous: before });
  appState.timetable.ttcards = cards;
  pruneObsoleteGeneratedTtCardRefs(cards, before);
  void saveNow("timetable", { force: true });
  return cards.length;
}

// ── TtCards Management View ───────────────────────────────────────
export function renderTtCardsView(container) {
  container.innerHTML = "";

  const hdr = document.createElement("div"); hdr.className = "ttc-page-header";
  const left = document.createElement("div");
  const title = document.createElement("h2"); title.textContent = "시간표 카드";
  const sub = document.createElement("p"); sub.className = "manager-subtitle";
  sub.textContent = "커리큘럼 과목과 수강명단 반 수를 바탕으로 시간표용 카드를 생성합니다.";
  left.append(title, sub);

  const btnWrap = document.createElement("div"); btnWrap.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end";
  const genBtn = makeBtn("🃏 카드 생성 / 재생성", "primary-btn", () => {
    if (!canEdit()) return;
    if (getTtCards().length > 0 && !confirm("현재 카드 데이터를 기준으로 다시 생성합니다.\n수동 수정된 값은 유지됩니다. 계속할까요?")) return;
    const n = generateTtCards();
    if (n < 0) {
      alert("시간표 카드 원본 데이터가 아직 로딩되지 않았습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    alert(`${n}개 시간표 카드 데이터가 생성되었습니다.${cardGenerationMetaAlertSuffix()}`);
    renderTtCardsView(container);
  });
  const refreshBtn = makeBtn("🔄 카드 데이터 새로고침", "secondary-btn", () => {
    const n = refreshTtCardData();
    if (n < 0) {
      alert("시간표 카드 원본 데이터가 아직 로딩되지 않았습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    alert(`${n}개 카드 데이터를 갱신했습니다.${cardGenerationMetaAlertSuffix()}`);
    renderTtCardsView(container);
  });
  const clearBtn = makeBtn("🧹 카드 초기화", "danger-btn", () => {
    if (!confirm("시간표 카드를 모두 초기화하고 그룹 연결에서도 제거할까요?")) return;
    const n = clearTtCards();
    alert(`${n}개 카드가 초기화되었습니다.`);
    renderTtCardsView(container);
  });
  [genBtn, refreshBtn, clearBtn].forEach(b => b.disabled = !canEdit());
  btnWrap.append(genBtn, refreshBtn, clearBtn);
  hdr.append(left, btnWrap);
  container.appendChild(hdr);
  container.appendChild(renderTtCardTeacherOptionsPanel(container));

function renderTtCardTeacherOptionsPanel(container) {
  const opts = getTtCardTeacherOptions();
  const panel = document.createElement("div");
  panel.className = "ttc-generation-options";
  panel.style.cssText = [
    "margin:8px 0 12px",
    "padding:10px 12px",
    "border:1px solid #dbe4f0",
    "border-radius:12px",
    "background:#f8fbff",
    "display:grid",
    "grid-template-columns:minmax(160px,220px) minmax(180px,260px) 1fr",
    "gap:10px",
    "align-items:end"
  ].join(";");

  const modeWrap = document.createElement("label");
  modeWrap.style.cssText = "display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:900;color:#334155";
  const modeLabel = document.createElement("span");
  modeLabel.textContent = "교사 없는 카드 처리";
  const modeSel = document.createElement("select");
  modeSel.style.cssText = "height:30px;border:1px solid #cbd5e1;border-radius:8px;padding:0 8px;background:#fff;font-weight:800";
  ["homeroom", "representative", "none"].forEach(mode => {
    const o = document.createElement("option");
    o.value = mode;
    o.textContent = TTCARD_TEACHER_MODE_LABELS[mode];
    if (mode === opts.mode) o.selected = true;
    modeSel.appendChild(o);
  });
  modeWrap.append(modeLabel, modeSel);

  const repWrap = document.createElement("label");
  repWrap.style.cssText = "display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:900;color:#334155";
  const repLabel = document.createElement("span");
  repLabel.textContent = "대표 교사";
  const repSel = document.createElement("select");
  repSel.style.cssText = "height:30px;border:1px solid #cbd5e1;border-radius:8px;padding:0 8px;background:#fff;font-weight:800";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "선택 안 함";
  repSel.appendChild(empty);
  getAllTeacherNames().forEach(name => {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    if (name === opts.representativeTeacher) o.selected = true;
    repSel.appendChild(o);
  });
  repWrap.append(repLabel, repSel);

  const hint = document.createElement("div");
  hint.style.cssText = "font-size:11px;line-height:1.45;color:#64748b;font-weight:750";
  const refreshHint = () => {
    repSel.disabled = modeSel.value !== "representative";
    hint.textContent = modeSel.value === "homeroom"
      ? "템플릿 담당교사가 비어 있으면 대상 반 표시(예: 7A, 8B)와 교사 관리의 담임 메모를 매칭해 자동 배정합니다."
      : modeSel.value === "representative"
        ? "템플릿 담당교사가 비어 있으면 선택한 대표 교사 1명으로 카드가 생성됩니다."
        : "템플릿 담당교사가 비어 있어도 카드의 담당 교사를 비워 둡니다.";
  };
  refreshHint();
  modeSel.addEventListener("change", () => {
    setTtCardTeacherOptions({ mode: modeSel.value });
    refreshHint();
  });
  repSel.addEventListener("change", () => {
    setTtCardTeacherOptions({ representativeTeacher: repSel.value });
  });

  panel.append(modeWrap, repWrap, hint);
  return panel;
}

  const cards = getTtCards();
  if (!cards.length) {
    const e = document.createElement("div"); e.className = "manager-empty";
    e.textContent = "생성된 카드가 없습니다. 커리큘럼에서 과목을 배치하고 수강명단에서 반 수를 설정한 후 '카드 생성' 버튼을 눌러주세요.";
    container.appendChild(e); return;
  }

  // Stats
  const stats = document.createElement("div"); stats.className = "ttc-stats";
  stats.innerHTML = `총 <strong>${cards.length}</strong>개 시간표 카드`;
  container.appendChild(stats);

  // Group by grade
  const byGrade = {};
  GRADE_KEYS.forEach(g => { byGrade[g] = []; });
  cards.forEach(c => { if (byGrade[c.gradeKey]) byGrade[c.gradeKey].push(c); });

  GRADE_KEYS.forEach(gradeKey => {
    const gc = byGrade[gradeKey];
    if (!gc.length) return;
    const section = document.createElement("div"); section.className = "ttc-grade-section";
    const ghdr = document.createElement("div"); ghdr.className = "ttc-grade-hdr";
    ghdr.textContent = `${gradeDisplay(gradeKey)}학년  (${gc.length}개)`;
    section.appendChild(ghdr);

    const table = document.createElement("table"); table.className = "ttc-table";
    table.style.minWidth = "1280px";
    table.innerHTML = `<thead><tr>
      <th style="width:260px">커리큘럼 과목카드 원본</th>
      <th style="width:300px">저장된 시간표 카드 데이터</th>
      <th style="width:170px">카드명 수정</th>
      <th style="width:160px">대상 학년반 수정</th>
      <th style="width:150px">담당 교사 수정</th>
      <th style="width:80px">시수</th>
      <th style="width:100px">그룹</th>
      <th style="width:70px">복원/삭제</th>
    </tr></thead>`;
    const tbody = document.createElement("tbody");
    gc.forEach(card => {
      const grp = grps().find(g =>
        (g.units||[]).some(u => (u.ttcardIds||[]).includes(card.id)) ||
        (g.poolCardIds||[]).includes(card.id)
      );
      const tr = document.createElement("tr");
      tr.style.verticalAlign = "top";

      const sourceBox = createSourceCardBox(card);
      const generatedBox = createGeneratedCardBox(card);

      const labelInp = document.createElement("input"); labelInp.value = card.label || card.subject || ""; labelInp.disabled = !canEdit();
      labelInp.addEventListener("change", e => updateTtCardField(card.id, "label", e.target.value));
      const classInp = document.createElement("input"); classInp.type = "text"; classInp.value = (card.classLabels || []).join(", "); classInp.disabled = !canEdit();
      classInp.title = "예: 9A, 9B"; classInp.addEventListener("change", e => {
        const labels = e.target.value.split(/[,，\n]+/).map(x => x.trim()).filter(Boolean);
        updateTtCardField(card.id, "classLabels", labels.join(","));
        const keys = labels.map(l => { const m = l.match(/^(\d{1,2})(.+)$/); return m ? `${m[1]}:${m[2].toUpperCase()}` : l; });
        updateTtCardField(card.id, "classKeys", keys.join(","));
        renderTtCardsView(container);
      });
      const teacherInp = document.createElement("input"); teacherInp.type = "text"; teacherInp.value = card.teacherName || ""; teacherInp.disabled = !canEdit();
      teacherInp.addEventListener("change", e => { updateTtCardField(card.id, "teacherName", e.target.value); updateTtCardField(card.id, "teachers", e.target.value); renderTtCardsView(container); });
      const creditInp = document.createElement("input"); creditInp.type="number"; creditInp.min="0"; creditInp.step="0.5"; creditInp.value = card.credits || 0; creditInp.disabled = !canEdit();
      creditInp.addEventListener("change", e => { updateTtCardField(card.id, "credits", e.target.value); renderTtCardsView(container); });
      const resetBtn = makeBtn(isManualTtCard(card) ? "삭제" : "원본", isManualTtCard(card) ? "danger-btn compact-btn" : "secondary-btn compact-btn", () => {
        if (isManualTtCard(card)) {
          deleteCard(card);
          renderTtCardsView(container);
          return;
        }
        const fresh = buildPersistedTtCard({ id:card.id, templateId:card.templateId, gradeKey:card.gradeKey, sectionIdx:card.sectionIdx ?? 0, existing:null });
        Object.assign(card, fresh, { manualEdited:false }); scheduleSave("timetable"); renderTtCardsView(container);
      });
      resetBtn.disabled = !canEdit();

      [labelInp, classInp, teacherInp, creditInp].forEach(inp => {
        inp.style.cssText = "width:100%;padding:5px 7px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;line-height:1.35;background:white";
      });
      creditInp.style.textAlign = "center";
      [labelInp, classInp, teacherInp, creditInp, resetBtn].forEach(el => { if (el.addEventListener) el.addEventListener("click", e => e.stopPropagation()); });

      const groupSpan = document.createElement("span");
      groupSpan.className = grp ? "ttc-group-chip" : "ttc-unassigned-chip";
      groupSpan.textContent = grp ? grp.name : "미배정";

      const tds = [sourceBox, generatedBox, labelInp, classInp, teacherInp, creditInp, groupSpan, resetBtn]
        .map(x => { const td=document.createElement("td"); td.style.verticalAlign = "top"; td.appendChild(x); return td; });
      tr.append(...tds);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody); section.appendChild(table);
    container.appendChild(section);
  });
}

// ── Group Manager (moved here from templates.js) ──────────────────
let _groupManagerLevel = "전체";
let _groupReviewVisible = false;
let _groupReviewOpenClassKey = null;
let _currentDrag = null;

function setDrag(d) { _currentDrag = d; }

function gmLevelFilter(card) {
  if (_groupManagerLevel === "전체") return true;
  const tpl = getTemplateById(card.templateId);
  if (!tpl) return false;
  if (_groupManagerLevel === "중등") return ["7학년","8학년","9학년"].includes(card.gradeKey);
  if (_groupManagerLevel === "고등") return ["10학년","11학년","12학년"].includes(card.gradeKey);
  return true;
}

function formatGmCreditValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10).replace(/\.0$/, "");
}

function getGmCardCredit(card) {
  if (!card) return 0;
  // 시간표 카드에 저장된 스냅샷을 우선 사용합니다.
  // 창체는 시간표상 1시수 카드로 배치되므로 표시도 1로 통일합니다.
  if (isChanCheCategory(card.category)) return 1;
  const stored = parseCreditValue(card.credits);
  if (stored > 0) return stored;
  const row = (appState.curriculum?.gradeBoards?.[card.gradeKey] || [])
    .find(r => r.sem1TemplateId === card.templateId || r.sem2TemplateId === card.templateId);
  return getEffectiveCredit(row);
}

function getGroupActiveCardIds(group) {
  if (!group) return [];
  const excluded = new Set(group.excludedCardIds || []);
  const ids = [];
  const add = id => {
    if (!id || excluded.has(id) || ids.includes(id)) return;
    ids.push(id);
  };
  (group.units || []).forEach(unit => (unit.ttcardIds || []).forEach(add));
  (group.poolCardIds || []).forEach(add);
  return ids;
}

function getGroupActiveCards(group) {
  return getGroupActiveCardIds(group)
    .map(id => getTtCardById(id))
    .filter(Boolean);
}

function getCompoundOptionKey(card) {
  if (!card?.compoundParentTemplateId) return "";
  const classKey = (card.classKeys || []).map(clean).filter(Boolean).sort().join(",");
  const classLabel = (card.classLabels || []).map(clean).filter(Boolean).sort().join(",");
  return [
    "compound",
    card.compoundParentTemplateId,
    card.gradeKey || "",
    card.sectionIdx ?? 0,
    classKey || classLabel || ""
  ].join("::");
}

function sortCompoundPartCards(cards = []) {
  return [...(cards || [])].filter(Boolean).sort((a, b) => {
    const ai = Number.isInteger(a.compoundPartIndex) ? a.compoundPartIndex : 999;
    const bi = Number.isInteger(b.compoundPartIndex) ? b.compoundPartIndex : 999;
    if (ai !== bi) return ai - bi;
    return getTtCardLabel(a).localeCompare(getTtCardLabel(b), "ko", { numeric: true });
  });
}

function makeGroupReviewOptions(cards = []) {
  const options = [];
  const compoundBuckets = new Map();
  (cards || []).filter(Boolean).forEach(card => {
    const cKey = getCompoundOptionKey(card);
    if (!cKey) {
      options.push({
        kind: "card",
        key: `card:${card.id}`,
        cards: [card],
        title: getReviewCardDisplay(card).subject,
        credits: getGmCardCredit(card),
      });
      return;
    }
    if (!compoundBuckets.has(cKey)) compoundBuckets.set(cKey, []);
    compoundBuckets.get(cKey).push(card);
  });

  compoundBuckets.forEach(bucket => {
    const ordered = sortCompoundPartCards(bucket);
    const parentTpl = getTemplateById(ordered[0]?.compoundParentTemplateId || ordered[0]?.templateId);
    const title = ordered.map(card => getReviewCardDisplay(card).subject).filter(Boolean).join("+")
      || (parentTpl ? getTemplateCardTitle(parentTpl) : "복합 과목");
    options.push({
      kind: "compound",
      key: getCompoundOptionKey(ordered[0]),
      cards: ordered,
      title,
      credits: ordered.reduce((sum, card) => sum + getGmCardCredit(card), 0),
    });
  });

  return options.sort((a, b) => a.title.localeCompare(b.title, "ko", { numeric: true }));
}

function getGroupCreditLabel(group) {
  const credits = [...new Set(makeGroupReviewOptions(getGroupActiveCards(group))
    .map(option => option.credits)
    .filter(v => Number.isFinite(v) && v > 0)
    .map(formatGmCreditValue))]
    .sort((a, b) => Number(a) - Number(b));
  if (!credits.length) return "-";
  return credits.join(", ");
}

function getGroupedCardIdSet(groups = grps()) {
  const set = new Set();
  (groups || []).forEach(group => {
    getGroupActiveCardIds(group).forEach(id => set.add(id));
  });
  return set;
}

function getGradeKeysForGroupReview() {
  if (_groupManagerLevel === "중등") return ["7학년", "8학년", "9학년"];
  if (_groupManagerLevel === "고등") return ["10학년", "11학년", "12학년"];
  return [...GRADE_KEYS];
}

function getReviewClassRows() {
  const gradeOrder = new Map(GRADE_KEYS.map((g, idx) => [g, idx]));
  return (appState.classes?.classes || [])
    .filter(cls => getGradeKeysForGroupReview().includes(cls.grade))
    .map(cls => {
      const gradeKey = cls.grade;
      const className = clean(cls.name);
      const classKey = normalizeStoredClassKey(`${gradeDisplay(gradeKey)}:${className}`, gradeKey);
      const classLabel = `${gradeDisplay(gradeKey)}${className}`;
      return { gradeKey, className, classKey, classLabel, classId: cls.id };
    })
    .filter(row => row.classKey)
    .sort((a, b) => {
      const ga = gradeOrder.get(a.gradeKey) ?? 999;
      const gb = gradeOrder.get(b.gradeKey) ?? 999;
      if (ga !== gb) return ga - gb;
      return String(a.className).localeCompare(String(b.className), "ko", { numeric: true });
    });
}

function getCardReviewClassKeys(card) {
  const pair = normalizeClassPairs({
    classKeys: card?.classKeys || [],
    classLabels: card?.classLabels || [],
    fallbackGradeKey: card?.gradeKey || "",
  });
  return new Set(pair.classKeys || []);
}

function cardTargetsReviewClass(card, classKey) {
  if (!card || !classKey) return false;
  return getCardReviewClassKeys(card).has(classKey);
}

function getCardGroupReviewInfo(cardId) {
  const out = [];
  (grps() || []).forEach(group => {
    if (!group || !cardId || (group.excludedCardIds || []).includes(cardId)) return;
    let matched = false;
    (group.units || []).forEach((unit, idx) => {
      if ((unit.ttcardIds || []).includes(cardId)) {
        matched = true;
        const unitName = clean(unit.name) || `묶음수업 ${idx + 1}`;
        out.push({ id: group.id, name: clean(group.name) || "이름 없는 그룹", unitName, inUnit: true });
      }
    });
    if ((group.poolCardIds || []).includes(cardId)) {
      matched = true;
      out.push({ id: group.id, name: clean(group.name) || "이름 없는 그룹", unitName: "그룹 카드", inUnit: false });
    }
    // 일부 오래된 그룹 데이터는 poolCardIds 없이 unit에만 들어갈 수 있으므로 matched만으로 판단합니다.
  });
  const seen = new Set();
  return out.filter(info => {
    const key = `${info.id}::${info.unitName}::${info.inUnit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getCardGroupReviewLabel(cardId) {
  const info = getCardGroupReviewInfo(cardId);
  if (!info.length) return "그룹 없음";
  return info.map(g => g.inUnit ? `${g.name} · ${g.unitName}` : g.name).join(", ");
}

function getReviewCardDisplay(card) {
  const subject = clean(card?.subject) || clean(card?.label) || getTtCardLabel(card);
  const teacher = clean(card?.teacherName) || clean(card?.teachers) || "-";
  const target = (card?.classLabels || []).map(clean).filter(Boolean).join(", ") || "-";
  return { subject, teacher, target };
}

function getGroupReviewCardsForClass(group, classKey) {
  return getGroupActiveCards(group)
    .filter(card => cardTargetsReviewClass(card, classKey))
    .sort((a, b) => getTtCardLabel(a).localeCompare(getTtCardLabel(b), "ko", { numeric: true }));
}

function getGroupReviewCreditInfo(group, classKey) {
  const cards = getGroupReviewCardsForClass(group, classKey);
  const options = makeGroupReviewOptions(cards);
  const numericCredits = options
    .map(option => option.credits)
    .filter(v => Number.isFinite(v) && v > 0);
  const uniqueCredits = [...new Set(numericCredits.map(formatGmCreditValue))]
    .sort((a, b) => Number(a) - Number(b));
  const countedCredit = numericCredits.length ? Math.max(...numericCredits) : 0;
  return {
    cards,
    options,
    countedCredit,
    creditLabel: uniqueCredits.length ? uniqueCredits.join(", ") : "-",
    mixed: uniqueCredits.length > 1,
  };
}

function buildClassCreditReviewRows() {
  const allCards = getTtCards().filter(c => gmLevelFilter(c));
  const allGroups = (grps() || []).filter(Boolean);
  const groupedCardIds = getGroupedCardIdSet(allGroups);

  return getReviewClassRows().map(cls => {
    const individualCards = allCards
      .filter(card => !groupedCardIds.has(card.id))
      .filter(card => cardTargetsReviewClass(card, cls.classKey))
      .sort((a, b) => getTtCardLabel(a).localeCompare(getTtCardLabel(b), "ko", { numeric: true }));

    const groupRows = allGroups
      .map(group => {
        const creditInfo = getGroupReviewCreditInfo(group, cls.classKey);
        if (!creditInfo.cards.length) return null;
        const cardTitles = creditInfo.cards.map(card => getReviewCardDisplay(card).subject);
        const teachers = [...new Set(creditInfo.cards
          .map(card => getReviewCardDisplay(card).teacher)
          .filter(v => v && v !== "-"))]
          .sort((a, b) => a.localeCompare(b, "ko"));
        return {
          id: group.id,
          name: clean(group.name) || clean(group.groupName) || "이름 없는 그룹",
          ...creditInfo,
          cardTitles,
          teachers,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));

    const individualCredit = individualCards.reduce((sum, card) => sum + getGmCardCredit(card), 0);
    const groupCredit = groupRows.reduce((sum, group) => sum + group.countedCredit, 0);
    const totalCredits = individualCredit + groupCredit;

    return {
      ...cls,
      individualCards,
      individualCardCount: individualCards.length,
      individualCredit,
      groupRows,
      groupCount: groupRows.length,
      groupCredit,
      totalCredits,
    };
  });
}

function createClassReviewDetail(row) {
  const wrap = document.createElement("div");
  wrap.className = "group-review-detail";

  if (!row.individualCards.length && !row.groupRows.length) {
    wrap.textContent = "이 반에 연결된 시간표 카드가 없습니다.";
    return wrap;
  }

  const table = document.createElement("table");
  table.className = "group-review-detail-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>구분</th>
        <th>이름</th>
        <th>계산 시수</th>
        <th>교사</th>
        <th>대상/구성</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement("tbody");

  if (row.groupRows.length) {
    row.groupRows.forEach(group => {
      const tr = document.createElement("tr");
      const mixedNote = group.mixed ? ` <span class="group-review-mixed">카드시수 ${escapeHtml(group.creditLabel)}</span>` : "";
      const cardsHtml = (group.options || []).map(option => {
        if (option.kind === "compound" && option.cards.length > 1) {
          const target = [...new Set(option.cards.flatMap(card => card.classLabels || []).map(clean).filter(Boolean))].join(", ") || "-";
          const parts = option.cards.map(card => {
            const info = getReviewCardDisplay(card);
            return `<div class="group-review-compound-part"><span>${escapeHtml(info.subject)}</span><em>${escapeHtml(info.teacher)}</em><b>${escapeHtml(formatGmCreditValue(getGmCardCredit(card)))}시수</b></div>`;
          }).join("");
          return `<div class="group-review-detail-card group-review-detail-compound"><strong>${escapeHtml(option.title)}</strong><span>${escapeHtml(formatGmCreditValue(option.credits))}시수 · ${escapeHtml(target)}</span><div class="group-review-compound-parts">${parts}</div></div>`;
        }
        const card = option.cards[0];
        const info = getReviewCardDisplay(card);
        return `<div class="group-review-detail-card"><strong>${escapeHtml(info.subject)}</strong><span>${escapeHtml(info.target)}</span></div>`;
      }).join("");
      tr.innerHTML = `
        <td><span class="group-review-kind group-review-kind-group">그룹</span></td>
        <td><strong>${escapeHtml(group.name)}</strong>${mixedNote}</td>
        <td>${escapeHtml(formatGmCreditValue(group.countedCredit))}</td>
        <td>${escapeHtml(group.teachers.join(", ") || "-")}</td>
        <td>${cardsHtml}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  if (row.individualCards.length) {
    row.individualCards.forEach(card => {
      const tr = document.createElement("tr");
      const info = getReviewCardDisplay(card);
      tr.innerHTML = `
        <td><span class="group-review-kind group-review-kind-card">카드</span></td>
        <td><strong>${escapeHtml(info.subject)}</strong></td>
        <td>${escapeHtml(formatGmCreditValue(getGmCardCredit(card)))}</td>
        <td>${escapeHtml(info.teacher)}</td>
        <td>${escapeHtml(info.target)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function createGroupReviewPanel(onStructureChange = () => {}) {
  const panel = document.createElement("div");
  panel.className = "group-review-panel";

  const title = document.createElement("div");
  title.className = "group-review-title";
  title.textContent = "반별 시수 검토";
  const desc = document.createElement("div");
  desc.className = "group-review-desc";
  desc.textContent = "그룹에 들어간 카드는 개별 카드에서 제외하고, 그룹은 반별로 한 번만 계산합니다.";
  panel.append(title, desc);

  const table = document.createElement("table");
  table.className = "group-review-table group-review-class-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>반</th>
        <th>카드</th>
        <th>그룹</th>
        <th>총 시수</th>
        <th>상세</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement("tbody");
  buildClassCreditReviewRows().forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(row.classLabel)}</strong></td>
      <td>${row.individualCardCount}개 <strong>${escapeHtml(formatGmCreditValue(row.individualCredit))}시수</strong></td>
      <td>${row.groupCount}개 <strong>${escapeHtml(formatGmCreditValue(row.groupCredit))}시수</strong></td>
      <td><strong>${escapeHtml(formatGmCreditValue(row.totalCredits))}시수</strong></td>
      <td></td>
    `;
    const btnCell = tr.lastElementChild;
    const detailBtn = makeBtn(_groupReviewOpenClassKey === row.classKey ? "닫기" : "상세보기", "group-review-detail-btn", () => {
      _groupReviewOpenClassKey = _groupReviewOpenClassKey === row.classKey ? null : row.classKey;
      onStructureChange();
    });
    btnCell.appendChild(detailBtn);
    tbody.appendChild(tr);

    if (_groupReviewOpenClassKey === row.classKey) {
      const detailTr = document.createElement("tr");
      detailTr.className = "group-review-detail-row";
      const td = document.createElement("td");
      td.colSpan = 5;
      td.appendChild(createClassReviewDetail(row));
      detailTr.appendChild(td);
      tbody.appendChild(detailTr);
    }
  });
  table.appendChild(tbody);
  panel.appendChild(table);
  return panel;
}

function createTtCardChip(card, opts = {}) {
  const { onDelete, showDelete = false } = opts;
  const tpl  = getTemplateById(card.templateId);
  const lang = tpl?.language || "Both";
  const chip = document.createElement("div"); chip.className = `gm-card ${languageClass(lang)}`;
  chip.draggable = canEdit();
  chip.dataset.ttcardId = card.id;

  // Row 1: subject | grade chip | section badge
  const r1 = document.createElement("div"); r1.className = "gm-card-r1";
  const subjectEl = document.createElement("div"); subjectEl.className = "gm-card-subject";
  subjectEl.textContent = card.subject || getTemplateCardTitle(tpl || { nameKo: "(삭제됨)" });
  const gradeChip = document.createElement("span"); gradeChip.className = "gm-card-grade";
  gradeChip.textContent = gradeDisplay(card.gradeKey);
  const secLbl = (card.classLabels || []).join(", ") || getSectionLabelFromRoster(card);
  if (secLbl) { const sb = document.createElement("span"); sb.className = "gm-card-sec"; sb.textContent = secLbl; r1.append(subjectEl, gradeChip, sb); }
  else { r1.append(subjectEl, gradeChip); }

  // Row 2: teacher | delete button
  const r2 = document.createElement("div"); r2.className = "gm-card-r2";
  const tchEl = document.createElement("div"); tchEl.className = "gm-card-teacher";
  tchEl.textContent = clean(card.teacherMode) === "none"
    ? "교사 없음 허용"
    : (card.teacherName || (tpl ? getTemplateTeacherSummary(tpl) : "-"));
  r2.appendChild(tchEl);
  if (showDelete && canEdit() && onDelete) {
    const del = document.createElement("button"); del.type = "button"; del.className = "gm-card-del"; del.textContent = "×";
    del.title = "카드 삭제"; del.onclick = (e) => { e.stopPropagation(); onDelete(card); };
    r2.appendChild(del);
  }
  chip.append(r1, r2);

  chip.addEventListener("dragstart", () => { setDrag({ kind:"ttcard", ttcardId: card.id }); chip.classList.add("dragging"); });
  chip.addEventListener("dragend",   () => { setDrag(null); chip.classList.remove("dragging"); });
  return chip;
}

function createCompoundOptionChip(option, opts = {}) {
  const { onDeleteAll, showDelete = false } = opts;
  const cards = sortCompoundPartCards(option?.cards || []);
  const first = cards[0] || {};
  const chip = document.createElement("div");
  chip.className = "gm-card gm-card-compound lang-both";
  chip.draggable = false;
  chip.dataset.compoundOptionKey = option?.key || "";

  const r1 = document.createElement("div"); r1.className = "gm-card-r1";
  const subjectEl = document.createElement("div"); subjectEl.className = "gm-card-subject";
  subjectEl.textContent = option?.title || "복합 과목";
  const gradeChip = document.createElement("span"); gradeChip.className = "gm-card-grade";
  gradeChip.textContent = gradeDisplay(first.gradeKey);
  const secLbl = [...new Set(cards.flatMap(card => card.classLabels || []).map(clean).filter(Boolean))].join(", ") || getSectionLabelFromRoster(first);
  if (secLbl) { const sb = document.createElement("span"); sb.className = "gm-card-sec"; sb.textContent = secLbl; r1.append(subjectEl, gradeChip, sb); }
  else { r1.append(subjectEl, gradeChip); }

  const r2 = document.createElement("div"); r2.className = "gm-card-r2";
  const tchEl = document.createElement("div"); tchEl.className = "gm-card-teacher";
  tchEl.textContent = `${formatGmCreditValue(option?.credits || 0)}시수 · 복합 ${cards.length}파트`;
  r2.appendChild(tchEl);
  if (showDelete && canEdit() && onDeleteAll) {
    const del = document.createElement("button"); del.type = "button"; del.className = "gm-card-del"; del.textContent = "×";
    del.title = "복합 과목 전체를 이 그룹에서 제외";
    del.onclick = (e) => { e.stopPropagation(); onDeleteAll(cards); };
    r2.appendChild(del);
  }

  const parts = document.createElement("div"); parts.className = "gm-card-compound-parts";
  cards.forEach(card => {
    const info = getReviewCardDisplay(card);
    const part = document.createElement("div"); part.className = "gm-card-compound-part";
    part.innerHTML = `<span>${escapeHtml(info.subject)}</span><em>${escapeHtml(info.teacher)}</em><b>${escapeHtml(formatGmCreditValue(getGmCardCredit(card)))}시수</b>`;
    parts.appendChild(part);
  });

  chip.append(r1, r2, parts);
  return chip;
}

function ensureGroupExcludedIds(group) {
  if (!group) return [];
  if (!Array.isArray(group.excludedCardIds)) group.excludedCardIds = [];
  return group.excludedCardIds;
}

function excludeCardFromGroup(groupId, cardId) {
  const group = grps().find(g => g.id === groupId);
  if (!group || !cardId) return;
  group.poolCardIds = (group.poolCardIds || []).filter(id => id !== cardId);
  (group.units || []).forEach(u => { u.ttcardIds = (u.ttcardIds || []).filter(id => id !== cardId); });
  const ex = ensureGroupExcludedIds(group);
  if (!ex.includes(cardId)) ex.push(cardId);
}

function unexcludeCardFromGroup(group, cardId) {
  if (!group || !cardId) return;
  group.excludedCardIds = (group.excludedCardIds || []).filter(id => id !== cardId);
}


function getUnitCardClassesLabel(card) {
  const labels = (card?.classLabels || []).map(clean).filter(Boolean);
  if (labels.length) return labels.join(", ");
  return getSectionLabelFromRoster(card) || gradeDisplay(card?.gradeKey || "");
}

function getUnitCardSubjectLabel(card) {
  return clean(card?.subject) || clean(card?.label) || getTtCardLabel(card);
}

function getUnitCardTeacherLabel(card) {
  const tpl = getTemplateById(card?.templateId);
  if (clean(card?.teacherMode) === "none") return "교사 없음 허용";
  return clean(card?.teacherName) || (tpl ? clean(getTemplateTeacherSummary(tpl)) : "") || "-";
}

function getUnitSharedCreditLabel(cards = []) {
  const credits = [...new Set((cards || [])
    .map(card => getGmCardCredit(card))
    .filter(v => Number.isFinite(v) && v > 0)
    .map(formatGmCreditValue))];
  return credits.length === 1 ? `${credits[0]}시수` : (credits.length ? `${credits.join(", ")}시수` : "");
}

function summarizeUnitSubjects(cards = []) {
  const subjects = [...new Set((cards || []).map(getUnitCardSubjectLabel).map(clean).filter(Boolean))];
  if (!subjects.length) return "동일 수업";
  if (subjects.length === 1) return subjects[0];
  if (subjects.length <= 3) return subjects.join(" / ");
  return `${subjects.slice(0, 3).join(" / ")} 외 ${subjects.length - 3}`;
}

function groupUnitCardsByTeacher(cards = []) {
  const map = new Map();
  (cards || []).filter(Boolean).forEach(card => {
    const teacher = getUnitCardTeacherLabel(card);
    if (!map.has(teacher)) map.set(teacher, []);
    map.get(teacher).push(card);
  });
  return [...map.entries()].map(([teacher, teacherCards]) => ({
    teacher,
    cards: teacherCards.sort((a, b) => getTtCardLabel(a).localeCompare(getTtCardLabel(b), "ko", { numeric: true })),
  })).sort((a, b) => a.teacher.localeCompare(b.teacher, "ko", { numeric: true }));
}

function createUnitCompactView(groupId, unit, cards, onStructureChange) {
  const compact = document.createElement("div");
  compact.className = "group-unit-compact group-unit-single-card";

  const teacherGroups = groupUnitCardsByTeacher(cards);
  const isSingleTeacher = teacherGroups.length <= 1;
  const subjects = summarizeUnitSubjects(cards);
  const teacher = isSingleTeacher ? (teacherGroups[0]?.teacher || "교사 미지정") : `교사 ${teacherGroups.length}명`;
  const credit = getUnitSharedCreditLabel(cards);

  const head = document.createElement("div");
  head.className = "group-unit-compact-head";
  const title = document.createElement("div");
  title.className = "group-unit-compact-title";
  title.textContent = subjects;
  const meta = document.createElement("div");
  meta.className = "group-unit-compact-meta";
  meta.textContent = [teacher, credit].filter(Boolean).join(" · ");
  head.append(title, meta);
  compact.appendChild(head);

  if (!isSingleTeacher) {
    const warn = document.createElement("div");
    warn.className = "group-unit-warning compact";
    warn.textContent = "교사 확인";
    compact.appendChild(warn);
  }

  const chips = document.createElement("div");
  chips.className = "group-unit-classchips";
  cards.forEach(card => {
    const chip = document.createElement("span");
    chip.className = "group-unit-classchip";
    chip.draggable = canEdit();
    chip.dataset.ttcardId = card.id;
    chip.title = `${getUnitCardSubjectLabel(card)} · ${getUnitCardTeacherLabel(card)} · ${getUnitCardClassesLabel(card)}`;
    chip.addEventListener("dragstart", () => { setDrag({ kind:"ttcard", ttcardId: card.id }); chip.classList.add("dragging"); });
    chip.addEventListener("dragend", () => { setDrag(null); chip.classList.remove("dragging"); });

    const cls = document.createElement("b");
    cls.textContent = getUnitCardClassesLabel(card);
    chip.appendChild(cls);
    if (canEdit()) {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "group-unit-chip-remove";
      rm.textContent = "×";
      rm.title = "묶음에서 제외";
      rm.addEventListener("click", (e) => {
        e.stopPropagation();
        excludeCardFromGroup(groupId, card.id);
        scheduleSave("timetable");
        onStructureChange();
      });
      chip.appendChild(rm);
    }
    chips.appendChild(chip);
  });
  compact.appendChild(chips);

  return compact;
}

function deleteCard(card) {
  if (!confirm(`"${getTtCardLabel(card)}" 카드를 삭제할까요?`)) return;
  grps().forEach(g => {
    g.poolCardIds = (g.poolCardIds||[]).filter(id => id !== card.id);
    (g.units||[]).forEach(u => { u.ttcardIds = (u.ttcardIds||[]).filter(id => id !== card.id); });
  });
  appState.timetable.ttcards = (appState.timetable.ttcards||[]).filter(c => c.id !== card.id);
  appState.timetable.entries = (appState.timetable.entries||[]).filter(e => e.ttcardId !== card.id && !(e.ttcardIds||[]).includes(card.id));
  scheduleSave("timetable"); scheduleSave("timetable");
}

function createUnitBlockGM(groupId, unit, onStructureChange) {
  const wrap = document.createElement("div"); wrap.className = "group-unit-block";

  const hdr = document.createElement("div"); hdr.className = "group-unit-hdr";
  const label = document.createElement("span"); label.className = "group-unit-label"; label.textContent = "묶음수업";
  hdr.appendChild(label);
  const ttcards = (unit.ttcardIds || []).map(id => getTtCardById(id)).filter(Boolean);
  const spacer = document.createElement("span"); spacer.style.flex = "1"; hdr.appendChild(spacer);
  const delBtn = makeBtn("×", "group-unit-del-btn", () => {
    if (!canEdit()) return;
    const g = grps().find(g => g.id === groupId); if (!g) return;
    g.units = g.units.filter(u => u.id !== unit.id);
    scheduleSave("timetable"); onStructureChange();
  }); delBtn.disabled = !canEdit();
  hdr.appendChild(delBtn); wrap.appendChild(hdr);

  const cardArea = document.createElement("div"); cardArea.className = "group-unit-cards";
  setupDropZone(cardArea, (dragData) => {
    if (dragData.kind !== "ttcard") return;
    const cardId = dragData.ttcardId;
    // Remove from ALL units AND poolCardIds across all groups
    grps().forEach(g => {
      g.units.forEach(u => { u.ttcardIds = (u.ttcardIds||[]).filter(id => id !== cardId); });
      g.poolCardIds = (g.poolCardIds||[]).filter(id => id !== cardId);
    });
    unexcludeCardFromGroup(grps().find(g => g.id === groupId), cardId);
    if (!unit.ttcardIds) unit.ttcardIds = [];
    if (!unit.ttcardIds.includes(cardId)) unit.ttcardIds.push(cardId);
    scheduleSave("timetable"); onStructureChange();
  });

  if (ttcards.length > 1) {
    cardArea.appendChild(createUnitCompactView(groupId, unit, ttcards, onStructureChange));
  } else {
    ttcards.forEach(card => {
      const c = createTtCardChip(card, {
        showDelete: false,
        onDelete: () => {}
      });
      const rx = makeBtn("↩", "gm-card-remove", () => {
        if (!canEdit()) return;
        excludeCardFromGroup(groupId, card.id);
        scheduleSave("timetable"); onStructureChange();
      }); rx.title = "이 자동 그룹에서 제외"; rx.disabled = !canEdit(); rx.className = "gm-card-remove";
      c.appendChild(rx);
      cardArea.appendChild(c);
    });
  }
  if (!ttcards.length) {
    const ph = document.createElement("div"); ph.className = "group-unit-placeholder"; ph.textContent = "여기로 드래그"; cardArea.appendChild(ph);
  }
  wrap.appendChild(cardArea);

  return wrap;
}

function createGroupDefaultsPanel(group, onStructureChange) {
  const details = document.createElement("details");
  details.className = "group-defaults-panel compact";
  if (groupDefaultSummary(group)) details.open = true;

  const summary = document.createElement("summary");
  const text = groupDefaultSummary(group);
  summary.textContent = text ? `그룹 시간/예외교실 · ${text}` : "그룹 시간/예외교실";
  details.appendChild(summary);

  const roomRow = document.createElement("div");
  roomRow.className = "group-defaults-row compact";

  const roomSel = document.createElement("select");
  roomSel.className = "group-defaults-select";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = getGroupDefaultRooms().length ? "예외교실 없음" : "교실 목록 로딩/없음";
  roomSel.appendChild(blank);
  getGroupDefaultRooms().forEach(room => {
    const opt = document.createElement("option");
    opt.value = room.id;
    opt.textContent = `${room.name}${room.capacity ? ` (${room.capacity})` : ""}`;
    roomSel.appendChild(opt);
  });
  roomSel.value = clean(group.defaultFixedRoomId || group.fixedRoomId || "");
  roomSel.disabled = !canEdit();
  roomSel.addEventListener("change", () => {
    if (!canEdit()) return;
    group.defaultFixedRoomId = clean(roomSel.value) || null;
    group.defaultRoomRule = group.defaultFixedRoomId ? "fixed" : "";
    scheduleSave("timetable");
    onStructureChange();
  });
  roomRow.appendChild(roomSel);
  details.appendChild(roomRow);

  const grid = document.createElement("div");
  grid.className = "group-defaults-slot-grid compact";
  const periodCount = Math.max(1, parseInt(appState.timetable?.config?.periodCount, 10) || 7);
  const days = ["월", "화", "수", "목", "금"];
  days.forEach((dayLabel, dayIdx) => {
    const dayCell = document.createElement("div");
    dayCell.className = "group-defaults-day-label";
    dayCell.textContent = dayLabel;
    grid.appendChild(dayCell);
    for (let p = 1; p <= periodCount; p += 1) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "group-defaults-slot-btn" + (slotListHas(group.allowedSlots || [], dayIdx, p) ? " active" : "");
      btn.textContent = String(p);
      btn.disabled = !canEdit();
      btn.title = `${dayLabel} ${p}교시`;
      btn.addEventListener("click", () => {
        if (!canEdit()) return;
        toggleSlotInGroupAllowed(group, dayIdx, p);
        scheduleSave("timetable");
        onStructureChange();
      });
      grid.appendChild(btn);
    }
  });
  details.appendChild(grid);

  const actions = document.createElement("div");
  actions.className = "group-defaults-actions compact";
  const clearBtn = makeBtn("초기화", "group-defaults-mini-btn", () => {
    if (!canEdit()) return;
    group.allowedSlots = [];
    group.defaultRoomRule = "";
    group.defaultFixedRoomId = null;
    scheduleSave("timetable");
    onStructureChange();
  });
  clearBtn.disabled = !canEdit();
  actions.appendChild(clearBtn);
  details.appendChild(actions);

  return details;
}

function createGroupBlockGM(groupId, onStructureChange) {
  const grpObj = grps().find(g => g.id === groupId); if (!grpObj) return document.createElement("div");
  grpObj.isConcurrent = true; grpObj.groupType = "concurrent";
  if (!Object.prototype.hasOwnProperty.call(grpObj, "_collapsed")) { /* collapsed state managed by _collapsedMap */ }
  const block = document.createElement("div"); block.className = "group-block";
  block.dataset.groupId = groupId;

  // Drop target for group reorder (receives drop from other blocks' handle)
  block.addEventListener("dragover", e => {
    if (e.dataTransfer.types.includes("application/group-id")) {
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      block.classList.add("group-block-drop-target");
    }
  });
  block.addEventListener("dragleave", e => {
    if (!block.contains(e.relatedTarget)) block.classList.remove("group-block-drop-target");
  });
  block.addEventListener("drop", e => {
    if (!e.dataTransfer.types.includes("application/group-id")) return;
    e.preventDefault(); block.classList.remove("group-block-drop-target");
    const srcId = e.dataTransfer.getData("application/group-id");
    const destId = groupId;
    if (!srcId || srcId === destId) return;
    const arr = ensureTtCardGroups();
    const si = arr.findIndex(g => g.id === srcId);
    const di = arr.findIndex(g => g.id === destId);
    if (si < 0 || di < 0) return;
    const [moved] = arr.splice(si, 1);
    arr.splice(di, 0, moved);
    scheduleSave("timetable"); onStructureChange();
  });

  const hdr = document.createElement("div"); hdr.className = "group-block-hdr";

  // Drag handle — only this triggers group reorder drag
  const dragHandle = document.createElement("span"); dragHandle.className = "group-drag-handle";
  dragHandle.textContent = "⠿"; dragHandle.title = "드래그하여 순서 변경";
  if (canEdit()) {
    dragHandle.draggable = true;
    dragHandle.addEventListener("dragstart", e => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/group-id", groupId);
      block.classList.add("group-block-dragging");
      e.stopPropagation();
    });
    dragHandle.addEventListener("dragend", () => block.classList.remove("group-block-dragging"));
  }

  const colBtn = document.createElement("button"); colBtn.type = "button"; colBtn.className = "group-collapse-btn";
  colBtn.textContent = isGroupCollapsed(groupId) ? "▶" : "▼";

  const nameInp = document.createElement("input"); nameInp.type = "text"; nameInp.className = "group-block-name";
  nameInp.value = grpObj.name; nameInp.placeholder = "그룹 이름"; nameInp.disabled = !canEdit();
  nameInp.addEventListener("change", e => { renameTtCardGroup(groupId, e.target.value); });

  const creditBadge = document.createElement("span");
  creditBadge.className = "group-credit-badge";
  creditBadge.textContent = getGroupCreditLabel(grpObj);
  creditBadge.title = "이 그룹에 포함된 시간표 카드의 시수";

  const delBtn = makeBtn("×", "group-col-del-btn group-col-del-x", () => { deleteTtCardGroup(groupId); onStructureChange(); });
  delBtn.disabled = !canEdit(); delBtn.title = "그룹 삭제";
  hdr.append(dragHandle, colBtn, nameInp, creditBadge, delBtn); block.appendChild(hdr);

  const hint = document.createElement("div"); hint.className = "group-concurrent-hint";
  hint.textContent = ""; hint.style.display = "none";

  const body = document.createElement("div"); body.className = "group-block-body";
  if (isGroupCollapsed(groupId)) body.style.display = "none";

  body.appendChild(createGroupDefaultsPanel(grpObj, onStructureChange));

  const allUnitCardIds = new Set((grpObj.units||[]).flatMap(u => u.ttcardIds||[]));

  const unitsWrap = document.createElement("div"); unitsWrap.className = "group-units-wrap";
  (grpObj.units||[]).forEach(unit => unitsWrap.appendChild(createUnitBlockGM(groupId, unit, onStructureChange)));
  body.appendChild(unitsWrap);

  // ── Pool area: cards in group but not in any unit (always visible for drop) ──
  const poolArea = document.createElement("div"); poolArea.className = "group-pool-area";
  const poolLbl = document.createElement("div"); poolLbl.className = "group-pool-area-label";
  poolLbl.textContent = "그룹카드";
  poolArea.appendChild(poolLbl);
  const poolCards = document.createElement("div"); poolCards.className = "group-pool-cards";
  setupDropZone(poolCards, drag => {
    if (drag.kind !== "ttcard") return;
    grps().forEach(g => {
      g.units.forEach(u => { u.ttcardIds = (u.ttcardIds||[]).filter(id => id !== drag.ttcardId); });
      if (g.id !== groupId) g.poolCardIds = (g.poolCardIds||[]).filter(id => id !== drag.ttcardId);
    });
    unexcludeCardFromGroup(grpObj, drag.ttcardId);
    if (!grpObj.poolCardIds) grpObj.poolCardIds = [];
    if (!grpObj.poolCardIds.includes(drag.ttcardId)) grpObj.poolCardIds.push(drag.ttcardId);
    scheduleSave("timetable"); onStructureChange();
  });
  const unitCardIds = new Set((grpObj.units||[]).flatMap(u => u.ttcardIds||[]));
  const excludedIds = new Set(grpObj.excludedCardIds || []);
  const poolIds = (grpObj.poolCardIds||[]).filter(id => !unitCardIds.has(id) && !excludedIds.has(id));
  if (poolIds.length === 0) {
    const ph = document.createElement("div"); ph.className = "group-pool-empty-hint";
    ph.textContent = "미배정 카드를 여기로 드래그"; poolCards.appendChild(ph);
  } else {
    const poolOptions = makeGroupReviewOptions(poolIds.map(id => getTtCardById(id)).filter(Boolean));
    poolOptions.forEach(option => {
      if (option.kind === "compound" && option.cards.length > 1) {
        const chip = createCompoundOptionChip(option, {
          showDelete: true,
          onDeleteAll: (cards) => {
            if (!canEdit()) return;
            const title = option.title || "복합 과목";
            if (!confirm(`"${title}" 복합 과목을 이 자동 그룹에서 제외할까요?
구성 카드 ${cards.length}개가 함께 미배정 카드로 이동합니다.`)) return;
            cards.forEach(card => excludeCardFromGroup(groupId, card.id));
            scheduleSave("timetable");
            onStructureChange();
          }
        });
        poolCards.appendChild(chip);
        return;
      }

      const card = option.cards[0];
      if (!card) return;
      const chip = createTtCardChip(card, {
        showDelete: true,
        onDelete: (c) => {
          if (!canEdit()) return;
          if (!confirm(`"${getTtCardLabel(c)}" 카드를 이 자동 그룹에서 제외할까요?
카드 자체는 삭제되지 않고 미배정 카드로 이동합니다.`)) return;
          excludeCardFromGroup(groupId, c.id);
          scheduleSave("timetable");
          onStructureChange();
        }
      });
      chip.addEventListener("dragstart", () => { setDrag({ kind:"ttcard", ttcardId: card.id }); chip.classList.add("dragging"); });
      chip.addEventListener("dragend", () => { setDrag(null); chip.classList.remove("dragging"); });
      poolCards.appendChild(chip);
    });
  }
  poolArea.appendChild(poolCards); body.appendChild(poolArea);

  const addUnitBtn = makeBtn("+ 묶음수업 추가", "group-add-unit-btn", () => {
    if (!canEdit()) return;
    if (!grpObj.units) grpObj.units = [];
    grpObj.units.push({ id: uid("unit"), name: "", templateIds: [], ttcardIds: [] });
    scheduleSave("timetable"); onStructureChange();
  }); addUnitBtn.disabled = !canEdit();
  body.appendChild(addUnitBtn);
  block.appendChild(body);

  colBtn.addEventListener("click", () => {
    const next = !isGroupCollapsed(groupId);
    setGroupCollapsed(groupId, next);
    body.style.display = next ? "none" : "";
    colBtn.textContent = next ? "▶" : "▼";
  });
  return block;
}

function setupDropZone(el, onDrop) {
  el.addEventListener("dragover",  e => { if (!canEdit()) return; e.preventDefault(); el.classList.add("dragover"); });
  el.addEventListener("dragleave", () => el.classList.remove("dragover"));
  el.addEventListener("drop",      e => {
    if (!canEdit()) return; e.preventDefault(); el.classList.remove("dragover");
    if (_currentDrag) onDrop(_currentDrag);
  });
}

// ── Group collapsed state (UI-only, not saved to Firebase) ────────
const _collapsedMap = new Map(); // groupId → boolean

function isGroupCollapsed(id) { return _collapsedMap.get(id) ?? false; }
function setGroupCollapsed(id, val) { _collapsedMap.set(id, val); }

export function renderGroupManagerView(container) {
  const rightScroll = container.querySelector(".group-right-col")?.scrollTop || 0;
  const leftScroll  = container.querySelector(".group-unassigned-pool")?.scrollTop || 0;
  container.innerHTML = "";
  buildGroupManagerDOM(container, rightScroll, leftScroll);
}

function buildGroupManagerDOM(board, savedRightScroll = 0, savedLeftScroll = 0) {
  const onStructureChange = () => {
    const rS = board.querySelector(".group-right-col")?.scrollTop || 0;
    const lS = board.querySelector(".group-unassigned-pool")?.scrollTop || 0;
    board.innerHTML = "";
    buildGroupManagerDOM(board, rS, lS);
  };

  // Filter bar
  const filterBar = document.createElement("div"); filterBar.className = "group-level-filter-bar";
  ["전체","중등","고등"].forEach(level => {
    const btn = makeBtn(
      level === "중등" ? "📘 중등" : level === "고등" ? "📗 고등" : "전체",
      "group-level-btn" + (_groupManagerLevel === level ? " active" : ""),
      () => { _groupManagerLevel = level; renderGroupManagerView(board); }
    );
    filterBar.appendChild(btn);
  });

  // Auto-gen button
  const autoGenBtn = makeBtn("✨ 자동 생성", "group-auto-gen-btn", () => {
    if (!canEdit()) return;
    const cards = getTtCards().filter(c => gmLevelFilter(c));
    if (!cards.length) { alert("시간표 카드가 없습니다.\n먼저 '시간표 카드' 탭에서 카드를 생성하세요."); return; }

    // Group by: 학년 + 구분(row.track).
    // 사용자가 원하는 자동 생성 기준은 "학년-구분"이며, 교과군(row.group)은 그룹 분리 조건에 넣지 않습니다.
    const trackMap = {};
    GRADE_KEYS.forEach(gradeKey => {
      const rows = appState.curriculum?.gradeBoards?.[gradeKey] || [];
      rows.forEach(row => {
        if (row.category !== "교과") return;
        const trackName = clean(row.track);
        if (!trackName || trackName === "공통") return;
        const groupKey = `${gradeKey}::${trackName}`;
        if (!trackMap[groupKey]) trackMap[groupKey] = {
          name: `${gradeDisplay(gradeKey)}-${trackName}`, cardIds: new Set()
        };
        [row.sem1TemplateId, row.sem2TemplateId].filter(Boolean).forEach(tplId => {
          cards.filter(c => c.templateId === tplId && c.gradeKey === gradeKey)
            .forEach(c => trackMap[groupKey].cardIds.add(c.id));
        });
      });
    });

    const validGroups = Object.values(trackMap).filter(v => v.cardIds.size >= 2);
    if (!validGroups.length) { alert("자동 생성할 그룹이 없습니다.\n배정/선택 과목이 있는지 확인하세요."); return; }

    const existing = grps();
    const existingNames = new Set(existing.map(g => g.name));
    const newGroups = validGroups.filter(({ name }) => !existingNames.has(name));

    if (!newGroups.length) { alert("이미 동일한 그룹이 모두 존재합니다."); return; }
    if (!confirm(`${newGroups.length}개 그룹을 자동 생성합니다. 계속할까요?`)) return;

    newGroups.forEach(({ name, cardIds }) => {
      const grpId = uid("grp");
      // Cards go into the group pool (unassigned to units) — user creates 묶음수업 manually
      ensureTtCardGroups().push(normalizeTemplateGroup({
        id: grpId, name, isConcurrent: true, groupType: "concurrent",
        defaultRoomRule: "", defaultFixedRoomId: null, allowedSlots: [], unavailableSlots: [],
        units: [], poolCardIds: [...cardIds]  // pool: cards in group but not yet in any unit
      }));
    });
    scheduleSave("timetable"); onStructureChange();
    alert(`${newGroups.length}개 그룹이 생성되었습니다.`);
  });
  autoGenBtn.disabled = !canEdit();
  filterBar.appendChild(autoGenBtn);

  const resetAllBtn = makeBtn("🔄 전체 초기화", "group-reset-all-btn", () => {
    if (!canEdit()) return;
    if (!confirm("그룹을 전체 초기화합니다.\n모든 그룹과 묶음수업이 삭제되고 카드는 미배정 상태로 돌아갑니다.\n계속할까요?")) return;
    appState.timetable.ttcardGroups = [];
    scheduleSave("timetable"); onStructureChange();
  }); resetAllBtn.disabled = !canEdit();
  filterBar.appendChild(resetAllBtn);

  const reviewBtn = makeBtn(_groupReviewVisible ? "검토 닫기" : "검토", "group-review-btn" + (_groupReviewVisible ? " active" : ""), () => {
    _groupReviewVisible = !_groupReviewVisible;
    onStructureChange();
  });
  filterBar.appendChild(reviewBtn);

  board.appendChild(filterBar);
  if (_groupReviewVisible) board.appendChild(createGroupReviewPanel(onStructureChange));

  const layout = document.createElement("div"); layout.className = "group-manager-layout";

  // ── Left: unassigned TtCards ────────────────────────────────────
  const leftCol = document.createElement("div"); leftCol.className = "group-left-col";
  const leftHdr = document.createElement("div"); leftHdr.className = "group-section-hdr";
  leftHdr.appendChild(Object.assign(document.createElement("span"), { className:"group-pool-main-label", textContent:"미배정 카드" }));
  leftCol.appendChild(leftHdr);

  const allAssignedIds = new Set([
    ...grps().flatMap(g => (g.units||[]).flatMap(u => u.ttcardIds||[]).filter(id => !(g.excludedCardIds||[]).includes(id))),
    ...grps().flatMap(g => (g.poolCardIds||[]).filter(id => !(g.excludedCardIds||[]).includes(id)))
  ]);
  const unassigned = getTtCards().filter(c => gmLevelFilter(c) && !allAssignedIds.has(c.id))
    .sort((a, b) => getTtCardLabel(a).localeCompare(getTtCardLabel(b), "ko"));

  const unPool = document.createElement("div"); unPool.className = "group-unassigned-pool group-unassigned-horiz";
  setupDropZone(unPool, drag => {
    if (drag.kind !== "ttcard") return;
    // Remove from all units AND poolCardIds
    grps().forEach(g => {
      const had = (g.poolCardIds||[]).includes(drag.ttcardId) || (g.units||[]).some(u => (u.ttcardIds||[]).includes(drag.ttcardId));
      g.units.forEach(u => { u.ttcardIds = (u.ttcardIds||[]).filter(id => id !== drag.ttcardId); });
      g.poolCardIds = (g.poolCardIds||[]).filter(id => id !== drag.ttcardId);
      if (had) {
        const ex = ensureGroupExcludedIds(g);
        if (!ex.includes(drag.ttcardId)) ex.push(drag.ttcardId);
      }
    });
    scheduleSave("timetable"); onStructureChange();
  });

  if (unassigned.length) {
    unassigned.forEach(c => {
      const wrap = document.createElement("div"); wrap.className = "group-unassigned-card-wrap";
      const chip = createTtCardChip(c, {
        showDelete: true,
        onDelete: (card) => { deleteCard(card); onStructureChange(); }
      });
      wrap.appendChild(chip); unPool.appendChild(wrap);
    });
  } else {
    const ph = document.createElement("div"); ph.className = "group-col-placeholder"; ph.textContent = "모든 카드가 배정됨"; unPool.appendChild(ph);
  }
  leftCol.appendChild(unPool); layout.appendChild(leftCol);

  // ── Right: Groups ───────────────────────────────────────────────
  const rightWrap = document.createElement("div"); rightWrap.className = "group-right-col-wrap";
  const rightHdr  = document.createElement("div"); rightHdr.className = "group-right-col-hdr";
  rightHdr.appendChild(Object.assign(document.createElement("span"), { className:"group-pool-main-label", textContent:"그룹 목록" }));

  const addGroupBtn = makeBtn("+ 그룹 추가", "group-add-btn", () => {
    if (!canEdit()) return;
    const existingNames = new Set(grps().map(g => clean(g.name)));
    let n = grps().length + 1;
    let name = `그룹 ${n}`;
    while (existingNames.has(name)) name = `그룹 ${++n}`;
    ensureTtCardGroups().push(normalizeTemplateGroup({
      id: uid("grp"),
      name,
      isConcurrent: true,
      groupType: "concurrent",
      defaultRoomRule: "",
      defaultFixedRoomId: null,
      allowedSlots: [],
      unavailableSlots: [],
      units: [],
      poolCardIds: []
    }));
    scheduleSave("timetable");
    onStructureChange();
  });
  addGroupBtn.disabled = !canEdit();

  const filteredGroups = grps().filter(g => {
    const unitCards = (g.units||[]).flatMap(u => (u.ttcardIds||[]).map(id => getTtCardById(id)).filter(Boolean));
    const poolCards = (g.poolCardIds||[]).map(id => getTtCardById(id)).filter(Boolean);
    const allCards  = [...unitCards, ...poolCards];
    if (!allCards.length) return true;
    return allCards.some(c => gmLevelFilter(c));
  });

  const togWrap = document.createElement("div"); togWrap.style.cssText = "display:flex;gap:4px;margin-left:auto";
  const allCollapsed = filteredGroups.length > 0 && filteredGroups.every(g => isGroupCollapsed(g.id));
  const togBtn = makeBtn(allCollapsed ? "▼ 전체 펼치기" : "▶ 전체 접기", "group-expand-btn", () => {
    const collapse = !allCollapsed;
    grps().forEach(g => setGroupCollapsed(g.id, collapse));
    onStructureChange();
  });
  togWrap.append(addGroupBtn, togBtn); rightHdr.style.display = "flex"; rightHdr.style.alignItems = "center";
  rightHdr.appendChild(togWrap);

  const rightCol = document.createElement("div"); rightCol.className = "group-right-col";
  if (filteredGroups.length) {
    filteredGroups.forEach(g => rightCol.appendChild(createGroupBlockGM(g.id, onStructureChange)));
  } else {
    rightCol.innerHTML = '<div class="group-col-placeholder">그룹이 없습니다. 오른쪽 상단 "그룹 추가"를 누르세요.</div>';
  }

  rightWrap.append(rightHdr, rightCol); layout.appendChild(rightWrap);
  board.appendChild(layout);
  requestAnimationFrame(() => {
    const rc = board.querySelector(".group-right-col");
    const lc = board.querySelector(".group-unassigned-pool");
    if (rc && savedRightScroll) rc.scrollTop = savedRightScroll;
    if (lc && savedLeftScroll)  lc.scrollTop = savedLeftScroll;
  });
}
