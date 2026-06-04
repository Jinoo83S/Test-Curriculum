// ================================================================
// ttcards.js · Timetable Card Generation + Group Manager UI
// ================================================================
import { GRADE_KEYS } from "./config.js";
import { uid, clean, makeBtn, languageClass, sectionLabel, gradeDisplay, getEffectiveCredit, isChanCheCategory, isProtectedWholeGradeLabel, parseCreditValue } from "./utils.js";
import { canEdit } from "./auth.js";
import { appState, scheduleSave, normalizeTtCard, normalizeTemplateGroup } from "./state.js";
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
function isWholeGradeRow(row, tpl) {
  return isChanCheCategory(row?.category) || isProtectedWholeGradeLabel(row?.category, row?.track, row?.group, tpl?.nameKo, tpl?.nameEn);
}
function resolveCardAudience({ templateId, gradeKey, sectionIdx }) {
  const rosterEntries = (appState.rosters?.rosters?.[templateId] || [])
    .filter(e => (e.sectionIdx ?? 0) === (sectionIdx ?? 0));
  const classes = appState.classes?.classes || [];
  const classKeys = new Set(), classLabels = new Set(), studentKeys = new Set();

  rosterEntries.forEach(re => {
    const cls = classes.find(c => c.id === re.classId);
    if (!cls || cls.grade !== gradeKey) return;
    const sec = cls.name || sectionLabel(sectionIdx ?? 0);
    const key = classKeyOf(gradeKey, sec);
    const label = classLabelOf(gradeKey, sec);
    if (key) classKeys.add(key);
    if (label) classLabels.add(label);
    studentKeys.add(`${re.classId}:${re.studentId}`);
  });
  if (classKeys.size) return { classKeys:[...classKeys], classLabels:[...classLabels], studentKeys:[...studentKeys] };

  const row = getCurriculumRowForCard(gradeKey, templateId);
  const tpl = getTemplateById(templateId);
  const whole = isWholeGradeRow(row, tpl);
  const gradeClasses = getGradeClasses(gradeKey);
  const targetClasses = whole
    ? gradeClasses
    : [gradeClasses[sectionIdx] || { grade: gradeKey, name: sectionLabel(sectionIdx ?? 0) }];
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
    credits: isCompoundPart ? partCredits : (row ? getEffectiveCredit(row) : (existing?.credits || 0)),
    category: row?.category || existing?.category || "",
    track: row?.track || existing?.track || "",
    group: row?.group || existing?.group || "",
    classKeys: audience.classKeys.length ? audience.classKeys : (existing?.classKeys || []),
    classLabels: audience.classLabels.length ? audience.classLabels : (existing?.classLabels || []),
    studentKeys: audience.studentKeys.length ? audience.studentKeys : (existing?.studentKeys || []),
    isWholeGrade: row ? isWholeGradeRow(row, tpl) : !!existing?.isWholeGrade,
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
    ["label","teacherName","teachers","credits","classKeys","classLabels","studentKeys","isWholeGrade"].forEach(k => {
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
        const cc = Math.max(1, getClassCount(tplId));
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

export function refreshTtCardData() {
  if (!canEdit()) return 0;

  // 기존 방식은 현재 화면에 존재하는 ttcards만 기준으로 재생성했습니다.
  // 그래서 진단 후 갱신 시점에 ttcards가 비어 있거나 일부 참조가 깨져 있으면
  // 빈 배열을 그대로 저장해 모든 시간표 카드가 삭제될 수 있었습니다.
  // 갱신은 항상 커리큘럼 보드를 원본으로 삼고, 기존 카드의 수동 수정값만 병합합니다.
  const before = getTtCards();
  const existing = new Map(before.map(c => [c.id, c]));
  const nextCards = buildAllGeneratedTtCards(existing);

  // 커리큘럼 원본이 있는데도 생성 결과가 0이면 저장하지 않습니다.
  // 잘못된 갱신 버튼 한 번으로 DB의 카드 배열이 빈 값으로 덮이는 것을 막는 안전장치입니다.
  if (!nextCards.length && countTimetableSourceRows() > 0) {
    console.error("[TTCARDS] 카드 갱신 중단: 커리큘럼 원본은 있으나 생성 결과가 0개입니다.");
    return before.length;
  }

  appState.timetable.ttcards = nextCards;
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
  if (["classLabels","classKeys","teachers","studentKeys"].includes(field)) {
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
    ["학생Key", `${Array.isArray(card.studentKeys) ? card.studentKeys.length : 0}개`],
    ["교사", card.teacherName || arrText(card.teachers)],
    ["시수", String(card.credits ?? "")],
    ["복합", card.compoundPartId ? `${(card.compoundPartIndex ?? 0) + 1}/${card.compoundPartCount || "?"} · 전체 ${card.compoundTotalCredits || "?"}시수` : "-"],
    ["전체", card.isWholeGrade ? "전체 학년 점유" : "지정 반만 점유"],
    ["상태", card.manualEdited ? "수동 수정됨" : "원본 기준"],
    ["생성", card.generatedAt ? card.generatedAt.replace("T", " ").slice(0, 16) : ""],
  ], { bg: card.manualEdited ? "#fff7ed" : "#f8fafc", warning: card.manualEdited });
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
  const existing = new Map(getTtCards().map(c => [c.id, c]));
  const cards = buildAllGeneratedTtCards(existing);
  appState.timetable.ttcards = cards;
  scheduleSave("timetable");
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
    alert(`${n}개 시간표 카드 데이터가 생성되었습니다.`);
    renderTtCardsView(container);
  });
  const refreshBtn = makeBtn("🔄 카드 데이터 새로고침", "secondary-btn", () => {
    const n = refreshTtCardData();
    alert(`${n}개 카드 데이터를 갱신했습니다.`);
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
      <th style="width:70px">복원</th>
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
      const resetBtn = makeBtn("원본", "secondary-btn compact-btn", () => {
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
  tchEl.textContent = card.teacherName || (tpl ? getTemplateTeacherSummary(tpl) : "-");
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
  if (ttcards.length > 1) {
    const badge = document.createElement("span"); badge.className = "group-unit-same-badge";
    badge.textContent = "🔗 동일 수업"; badge.title = "이름·학년이 달라도 실제 같은 수업입니다.";
    hdr.appendChild(badge);
  }
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
  if (!ttcards.length) {
    const ph = document.createElement("div"); ph.className = "group-unit-placeholder"; ph.textContent = "여기로 드래그"; cardArea.appendChild(ph);
  }
  wrap.appendChild(cardArea);
  return wrap;
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

  const delBtn = makeBtn("×", "group-col-del-btn group-col-del-x", () => { deleteTtCardGroup(groupId); onStructureChange(); });
  delBtn.disabled = !canEdit(); delBtn.title = "그룹 삭제";
  hdr.append(dragHandle, colBtn, nameInp, delBtn); block.appendChild(hdr);

  const hint = document.createElement("div"); hint.className = "group-concurrent-hint";
  hint.textContent = "이 그룹의 과목들은 같은 시간대에 배정됩니다."; block.appendChild(hint);

  const body = document.createElement("div"); body.className = "group-block-body";
  if (isGroupCollapsed(groupId)) body.style.display = "none";

  const allUnitCardIds = new Set((grpObj.units||[]).flatMap(u => u.ttcardIds||[]));

  const unitsWrap = document.createElement("div"); unitsWrap.className = "group-units-wrap";
  (grpObj.units||[]).forEach(unit => unitsWrap.appendChild(createUnitBlockGM(groupId, unit, onStructureChange)));
  body.appendChild(unitsWrap);

  // ── Pool area: cards in group but not in any unit (always visible for drop) ──
  const poolArea = document.createElement("div"); poolArea.className = "group-pool-area";
  const poolLbl = document.createElement("div"); poolLbl.className = "group-pool-area-label";
  poolLbl.textContent = "그룹 카드 (묶음수업 미배정)";
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
    poolIds.forEach(id => {
      const card = getTtCardById(id); if (!card) return;
      const chip = createTtCardChip(card, {
        showDelete: true,
        onDelete: (c) => {
          if (!canEdit()) return;
          if (!confirm(`"${getTtCardLabel(c)}" 카드를 이 자동 그룹에서 제외할까요?\n카드 자체는 삭제되지 않고 미배정 카드로 이동합니다.`)) return;
          excludeCardFromGroup(groupId, c.id);
          scheduleSave("timetable");
          onStructureChange();
        }
      });
      chip.addEventListener("dragstart", () => { setDrag({ kind:"ttcard", ttcardId: id }); chip.classList.add("dragging"); });
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
  board.appendChild(filterBar);

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
