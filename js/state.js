// ================================================================
// state.js · Shared Application State + Firestore Sync
// ================================================================
import { refs, db, GRADE_KEYS, DEFAULT_OPTIONS, DEFAULT_ROW_COUNT, colWidthsKey, DEFAULT_COL_WIDTHS } from "./config.js";
import { uid, clean, uniqueOrdered, parseCreditValue } from "./utils.js";
import { canEdit } from "./auth.js";
import {
  setDoc, onSnapshot, serverTimestamp, getDoc, getDocs, writeBatch, collection, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Phase 3 split Firestore paths ────────────────────────────────
// Large, frequently changing domains are stored as collections instead of
// one huge document. Public appState shape stays the same for the UI modules.
export const SPLIT_COLLECTION_DOMAINS = new Set(["classes", "rosters", "timetable"]);

const splitRefs = {
  classes: collection(db, "boards", "_split", "classes"),
  rosters: collection(db, "boards", "_split", "rosters"),
  timetableEntries: collection(db, "boards", "_split", "timetableEntries"),
  ttcards: collection(db, "boards", "_split", "ttcards"),
  timetableMeta: doc(db, "boards", "_split", "timetableMeta", "main"),
};


// ── Drag state (shared between board & group manager) ─────────────
export let currentDrag = null;
export const setCurrentDrag = (v) => { currentDrag = v; };

// ── Load flags: never save before initial load ────────────────────
export const initialLoad = {
  curriculum: false, templates: false,
  classes: false, teachers: false, rosters: false,
  rooms: false, timetable: false
};

// ── Per-domain save timers ────────────────────────────────────────
const saveTimers = {};
const dirtyDomains = new Set();
const SAVE_DELAY_MS = 3000;

let _onSaveStatus = null;
export const setOnSaveStatus = (cb) => { _onSaveStatus = cb; };

export function scheduleSave(domain) {
  if (!canEdit() || !initialLoad[domain]) return;
  dirtyDomains.add(domain);
  _onSaveStatus?.("saving");
  clearTimeout(saveTimers[domain]);
  saveTimers[domain] = setTimeout(() => saveNow(domain), SAVE_DELAY_MS);
}

export async function saveNow(domain) {
  if (!canEdit() || !initialLoad[domain]) return;
  clearTimeout(saveTimers[domain]);
  delete saveTimers[domain];
  try {
    if (SPLIT_COLLECTION_DOMAINS.has(domain) && !splitUnavailableDomains.has(domain)) {
      await saveSplitDomain(domain);
    } else {
      // Ordinary domains, or split domains temporarily running in legacy fallback mode.
      await setDoc(refs[domain], { ...appState[domain], updatedAt: serverTimestamp() });
    }
    dirtyDomains.delete(domain);
    _onSaveStatus?.("saved");
  } catch (e) {
    console.error(`Save failed [${domain}]:`, e);
    _onSaveStatus?.("error", e);
  }
}

export async function flushPendingSaves() {
  const domains = [...dirtyDomains];
  await Promise.all(domains.map(d => saveNow(d)));
}

// ================================================================
// DATA NORMALIZATION
// ================================================================

// ── Curriculum ────────────────────────────────────────────────────
export function normalizeOptions(raw = {}) {
  return {
    category: Array.isArray(raw.category) && raw.category.length
      ? uniqueOrdered(raw.category.map(clean)) : [...DEFAULT_OPTIONS.category],
    track: Array.isArray(raw.track) && raw.track.length
      ? uniqueOrdered(raw.track.map(clean)) : [...DEFAULT_OPTIONS.track],
    group: Array.isArray(raw.group) && raw.group.length
      ? uniqueOrdered(raw.group.map(clean)) : [...DEFAULT_OPTIONS.group],
  };
}

export function normalizeRow(row = {}, opts = DEFAULT_OPTIONS) {
  const safeC = opts.category.includes(row.category) ? row.category : (clean(row.category) || opts.category[0] || "");
  const safeT = opts.track.includes(row.track)       ? row.track    : (clean(row.track)    || opts.track[0]    || "");
  const safeG = opts.group.includes(row.group)       ? row.group    : (clean(row.group)    || opts.group[0]    || "");
  const legId = row.templateId ?? row.sem1 ?? row.sem2 ?? null;
  const s1id  = row.sem1TemplateId !== undefined ? (row.sem1TemplateId ?? null) : legId;
  const s2id  = row.sem2TemplateId !== undefined ? (row.sem2TemplateId ?? null) : legId;
  return { id: row.id || uid("row"), category: safeC, track: safeT, group: safeG, credits: clean(row.credits), sem1TemplateId: s1id, sem2TemplateId: s2id };
}

export function createRow(opts = DEFAULT_OPTIONS, seed = {}) {
  return {
    id: uid("row"),
    category: clean(seed.category) || opts.category[0] || "",
    track:    clean(seed.track)    || opts.track[0]    || "",
    group:    clean(seed.group)    || opts.group[0]    || "",
    credits:  clean(seed.credits),
    sem1TemplateId: null, sem2TemplateId: null
  };
}

function normalizeCurriculumDomain(raw = {}) {
  const opts = normalizeOptions(raw.options || {});
  const gradeBoards = {};
  GRADE_KEYS.forEach(grade => {
    const rows = Array.isArray(raw.gradeBoards?.[grade]) ? raw.gradeBoards[grade] : [];
    gradeBoards[grade] = rows.length
      ? rows.map(r => normalizeRow(r, opts))
      : Array.from({ length: DEFAULT_ROW_COUNT }, () => createRow(opts));
  });
  return { options: opts, gradeBoards };
}

// ── Templates ─────────────────────────────────────────────────────
function normalizeUnit(u = {}) {
  return {
    id: u.id || uid("unit"),
    name: clean(u.name),
    templateIds: Array.isArray(u.templateIds) ? u.templateIds.filter(Boolean) : [],
    ttcardIds:   Array.isArray(u.ttcardIds)   ? u.ttcardIds.filter(Boolean)   : [],
  };
}

export function normalizeTemplateGroup(item = {}) {
  const isConcurrent = item.isConcurrent !== false;
  const isCrossGrade = !!item.isCrossGrade;
  return {
    id: item.id || uid("grp"),
    name: clean(item.name),
    isConcurrent,
    isCrossGrade,
    units: Array.isArray(item.units) ? item.units.map(normalizeUnit) : [],
    poolCardIds: Array.isArray(item.poolCardIds) ? item.poolCardIds.filter(Boolean) : [],
    groupType: isConcurrent ? "concurrent" : (isCrossGrade ? "cross-grade" : "off"),
    linkedGroupId: clean(item.linkedGroupId) || null
  };
}

export function normalizeTemplate(item = {}) {
  const language = ["Korean","English","Both"].includes(item.language) ? item.language : "Both";
  const s1ko=clean(item.sem1NameKo), s1en=clean(item.sem1NameEn), s1te=clean(item.sem1Teacher);
  const s2ko=clean(item.sem2NameKo), s2en=clean(item.sem2NameEn), s2te=clean(item.sem2Teacher);
  const useSemesterOverrides = Boolean(item.useSemesterOverrides || s1ko || s1en || s1te || s2ko || s2en || s2te);
  return {
    id: item.id || uid("tpl"), language, useSemesterOverrides,
    nameKo: clean(item.nameKo), nameEn: clean(item.nameEn), teacher: clean(item.teacher),
    sem1NameKo:s1ko, sem1NameEn:s1en, sem1Teacher:s1te,
    sem2NameKo:s2ko, sem2NameEn:s2en, sem2Teacher:s2te,
    calcGroupId: clean(item.calcGroupId) || null,
    schoolLevel: ["중등","고등","공통"].includes(item.schoolLevel) ? item.schoolLevel : "공통"
  };
}

function normalizeTemplatesDomain(raw = {}) {
  return {
    templates:      Array.isArray(raw.templates)      ? raw.templates.map(normalizeTemplate)      : [],
    templateGroups: Array.isArray(raw.templateGroups) ? raw.templateGroups.map(normalizeTemplateGroup).filter(g => g.name) : []
  };
}

// ── Classes ───────────────────────────────────────────────────────
export function normalizeStudent(s = {}) {
  return { id: s.id || uid("stu"), name: clean(s.name), gender: clean(s.gender), birth: clean(s.birth), extra: clean(s.extra) };
}

export function normalizeClass(c = {}) {
  return { id: c.id || uid("cls"), grade: GRADE_KEYS.includes(c.grade) ? c.grade : "7학년", name: clean(c.name) || "새 반", students: Array.isArray(c.students) ? c.students.map(normalizeStudent) : [] };
}

function normalizeClassesDomain(raw = {}) {
  return { classes: Array.isArray(raw.classes) ? raw.classes.map(normalizeClass) : [] };
}

// ── Teachers ──────────────────────────────────────────────────────
export function normalizeTeacher(t = {}) {
  return { id: t.id || uid("tch"), name: clean(t.name), subjects: Array.isArray(t.subjects) ? t.subjects.map(clean).filter(Boolean) : [], email: clean(t.email), note: clean(t.note) };
}

function normalizeTeachersDomain(raw = {}) {
  return { teachers: Array.isArray(raw.teachers) ? raw.teachers.map(normalizeTeacher) : [] };
}

// ── Rosters ───────────────────────────────────────────────────────
// rosters[templateId] = [{ classId, studentId }]
function normalizeRostersDomain(raw = {}) {
  const rosters = {};
  if (raw.rosters && typeof raw.rosters === "object") {
    Object.entries(raw.rosters).forEach(([tid, entries]) => {
      if (Array.isArray(entries)) {
        rosters[tid] = entries.filter(e => e && e.classId && e.studentId).map(e => ({
          classId: String(e.classId), studentId: String(e.studentId),
          sectionIdx: Number.isInteger(e.sectionIdx) ? e.sectionIdx : 0
        }));
      }
    });
  }
  // rosterMeta[templateId] = { classCount: "" }
  const rosterMeta = {};
  if (raw.rosterMeta && typeof raw.rosterMeta === "object") {
    Object.entries(raw.rosterMeta).forEach(([tid, meta]) => {
      rosterMeta[tid] = { classCount: clean(meta?.classCount) };
    });
  }
  return { rosters, rosterMeta };
}

// ── Rooms ──────────────────────────────────────────────────────────
export const ROOM_TYPES = ["일반", "특별", "체육관", "음악실", "과학실", "기타"];
export function normalizeRoom(r = {}) {
  return {
    id: r.id || uid("room"),
    name: clean(r.name) || "새 교실",
    capacity: Number.isFinite(parseInt(r.capacity)) ? parseInt(r.capacity) : 0,
    type: ROOM_TYPES.includes(r.type) ? r.type : "일반",
    grade: GRADE_KEYS.includes(r.grade) ? r.grade : "",
    note: clean(r.note)
  };
}
function normalizeRoomsDomain(raw = {}) {
  return { rooms: Array.isArray(raw.rooms) ? raw.rooms.map(normalizeRoom) : [] };
}

// ── Timetable ──────────────────────────────────────────────────────
export function normalizeTimetableEntry(e = {}) {
  const templateId = clean(e.templateId) || (Array.isArray(e.templateIds) && e.templateIds[0]) || null;
  const gradeKey   = clean(e.gradeKey)   || (Array.isArray(e.gradeKeys)   && e.gradeKeys[0])   || null;
  return {
    id:          e.id || uid("ent"),
    day:         (Number.isInteger(e.day)    && e.day >= 0    && e.day <= 4)    ? e.day    : 0,
    period:      (Number.isInteger(e.period) && e.period >= 0 && e.period <= 11) ? e.period : 0,
    // Legacy single-template fields (always populated for compat)
    templateId,
    gradeKey,
    sectionIdx:  Number.isInteger(e.sectionIdx) ? e.sectionIdx : 0,
    // Unit fields (new - null for standalone entries)
    unitId:      clean(e.unitId)  || null,
    groupId:     clean(e.groupId) || null,
    // ttcard fields
    ttcardId:    clean(e.ttcardId)  || null,
    ttcardIds:   Array.isArray(e.ttcardIds) ? e.ttcardIds.filter(Boolean) : [],
    // Arrays: for units with multiple templates/grades (cross-grade co-teaching)
    templateIds: Array.isArray(e.templateIds) ? e.templateIds.filter(Boolean) : (templateId ? [templateId] : []),
    gradeKeys:   Array.isArray(e.gradeKeys)   ? e.gradeKeys.filter(Boolean)   : (gradeKey   ? [gradeKey]   : []),
    teacherName: clean(e.teacherName),
    audienceClassKeys: Array.isArray(e.audienceClassKeys) ? e.audienceClassKeys.map(clean).filter(Boolean) : [],
    audienceStudentKeys: Array.isArray(e.audienceStudentKeys) ? e.audienceStudentKeys.map(clean).filter(Boolean) : [],
    roomId:      clean(e.roomId) || null,
    pinned:      !!e.pinned,
  };
}
export function normalizeTtCard(item = {}) {
  const arr = v => Array.isArray(v) ? v.map(clean).filter(Boolean) : [];
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  return {
    id:         item.id || uid("ttc"),
    templateId: clean(item.templateId),
    gradeKey:   clean(item.gradeKey),
    sectionIdx: parseInt(item.sectionIdx, 10) || 0,
    label:      clean(item.label),

    // Generated snapshot data.
    // 시간표 화면은 이 값을 우선 사용하고, 매번 수강명단/반 정보를 재추론하지 않습니다.
    subject:     clean(item.subject),
    subjectEn:   clean(item.subjectEn),
    teacherName: clean(item.teacherName),
    teachers:    arr(item.teachers),
    credits:     num(item.credits),
    category:    clean(item.category),
    track:       clean(item.track),
    group:       clean(item.group),
    classKeys:   arr(item.classKeys),     // internal: "9:A"
    classLabels: arr(item.classLabels),   // display: "9A"
    studentKeys: arr(item.studentKeys),   // internal: "classId:studentId"
    isWholeGrade: !!item.isWholeGrade,
    generatedAt: clean(item.generatedAt),
    manualEdited: !!item.manualEdited,
  };
}
export function normalizeTimetableConstraint(c = {}) {
  return {
    maxPerDay:      (Number.isInteger(c.maxPerDay)      && c.maxPerDay > 0)      ? c.maxPerDay      : 6,
    maxConsecutive: (Number.isInteger(c.maxConsecutive) && c.maxConsecutive > 0) ? c.maxConsecutive : 3,
    unavailableSlots: Array.isArray(c.unavailableSlots)
      ? c.unavailableSlots.filter(s => Number.isInteger(s.day) && Number.isInteger(s.period))
      : [],
    assignedRoomId: clean(c.assignedRoomId) || null
  };
}
function normalizeTimetableDomain(raw = {}) {
  const pc = Math.max(1, Math.min(12, parseInt(raw.config?.periodCount) || 8));
  const pl = Array.isArray(raw.config?.periodLabels) && raw.config.periodLabels.length === pc
    ? raw.config.periodLabels.map(clean)
    : Array.from({ length: pc }, (_, i) => `${i}교시`);  // starts from 0교시
  const constraints = {};
  if (raw.teacherConstraints && typeof raw.teacherConstraints === "object") {
    Object.entries(raw.teacherConstraints).forEach(([k, v]) => {
      constraints[k] = normalizeTimetableConstraint(v);
    });
  }
  return {
    config: {
      periodCount: pc,
      periodLabels: pl,
      showLunch: !!raw.config?.showLunch,
      lunchAfterPeriod: Number.isInteger(raw.config?.lunchAfterPeriod)
        ? raw.config.lunchAfterPeriod
        : null
    },
    entries: Array.isArray(raw.entries)
      ? raw.entries.map(normalizeTimetableEntry).filter(e => e.templateId)
      : [],
    ttcards: Array.isArray(raw.ttcards) ? raw.ttcards.map(normalizeTtCard) : [],
    teacherConstraints: constraints
  };
}

// ================================================================
// APPLICATION STATE
// ================================================================
export const appState = {
  curriculum: normalizeCurriculumDomain({}),
  templates:  normalizeTemplatesDomain({}),
  classes:    normalizeClassesDomain({}),
  teachers:   normalizeTeachersDomain({}),
  rosters:    normalizeRostersDomain({}),
  rooms:      normalizeRoomsDomain({}),
  timetable:  normalizeTimetableDomain({}),
};

// Ensure consistency (re-normalize in place)
export function ensureConsistency(domain) {
  if (domain === "curriculum") appState.curriculum = normalizeCurriculumDomain(appState.curriculum);
  if (domain === "templates")  appState.templates  = normalizeTemplatesDomain(appState.templates);
  if (domain === "classes")    appState.classes    = normalizeClassesDomain(appState.classes);
  if (domain === "teachers")   appState.teachers   = normalizeTeachersDomain(appState.teachers);
  if (domain === "rosters")    appState.rosters    = normalizeRostersDomain(appState.rosters);
  if (domain === "rooms")      appState.rooms      = normalizeRoomsDomain(appState.rooms);
  if (domain === "timetable")  appState.timetable  = normalizeTimetableDomain(appState.timetable);
}

// ================================================================
// FIRESTORE SUBSCRIPTIONS
// ================================================================
// Render callback — set by app.js / timetable.js
let _onUpdate = () => {};
export function setOnUpdate(fn) { _onUpdate = fn; }

// ── Batched initial render ────────────────────────────────────────
// 구독 중인 도메인이 모두 로드되면 한 번만 render 호출
let _subscribedDomains = new Set();
let _pendingInitialRender = false;

function _checkAllLoaded() {
  if (!_pendingInitialRender) return;
  const allLoaded = [..._subscribedDomains].every(d => initialLoad[d]);
  if (allLoaded) {
    _pendingInitialRender = false;
    _onUpdate("all"); // 전체 로드 완료 — 1회 render
  }
}

function fireUpdate(domain) {
  if (_pendingInitialRender) {
    // 아직 초기 로딩 중 — 배치 처리
    _checkAllLoaded();
  } else {
    // 초기 로딩 완료 후 실시간 업데이트
    _onUpdate(domain);
  }
}

export function setSubscribedDomains(domains) {
  _subscribedDomains = new Set(domains);
  _pendingInitialRender = true;
}

function withoutFirestoreMeta(obj = {}) {
  const { updatedAt, createdAt, ...rest } = obj || {};
  return rest;
}

function sameDomainData(a, b) {
  // 빠른 참조 동일성 먼저
  if (a === b) return true;
  if (!a || !b) return false;
  // 타입별 빠른 비교 (깊은 JSON.stringify 대신)
  try {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    // 배열 포함 도메인은 길이만 비교 (세부값 변경은 실시간 업데이트에서 처리)
    for (const k of ka) {
      const va = a[k], vb = b[k];
      if (Array.isArray(va) && Array.isArray(vb)) { if (va.length !== vb.length) return false; }
      else if (va !== vb) return false;
    }
    return true;
  } catch (_) { return false; }
}

function applyNormalizedDomain(domain, normalized) {
  if (domain === "classes") {
    const prev = appState.classes.classes || [];
    if (normalized.classes.length === 0 && prev.length > 0) normalized.classes = prev;
  }

  if (initialLoad[domain] && sameDomainData(appState[domain], normalized)) {
    initialLoad[domain] = true;
    return;
  }
  appState[domain] = normalized;
  initialLoad[domain] = true;
  fireUpdate(domain);
}

async function commitWriteOps(ops) {
  const CHUNK_SIZE = 450; // Firestore batch limit is 500 writes
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    ops.slice(i, i + CHUNK_SIZE).forEach(op => {
      if (op.type === "set") batch.set(op.ref, op.data, op.options || undefined);
      if (op.type === "delete") batch.delete(op.ref);
    });
    await batch.commit();
  }
}

async function syncCollection(collRef, items, toDocData) {
  const snap = await getDocs(collRef);
  const existingIds = new Set(snap.docs.map(d => d.id));
  const nextIds = new Set(items.map(item => item.id).filter(Boolean));
  const ops = [];

  items.forEach(item => {
    if (!item.id) return;
    ops.push({
      type: "set",
      ref: doc(collRef, item.id),
      data: { ...toDocData(item), updatedAt: serverTimestamp() },
      options: { merge: false }
    });
  });

  existingIds.forEach(id => {
    if (!nextIds.has(id)) ops.push({ type: "delete", ref: doc(collRef, id) });
  });

  if (ops.length) await commitWriteOps(ops);
}

async function saveSplitDomain(domain) {
  if (domain === "classes") {
    const classes = normalizeClassesDomain(appState.classes).classes;
    await syncCollection(splitRefs.classes, classes, item => item);
    return;
  }

  if (domain === "rosters") {
    const normalized = normalizeRostersDomain(appState.rosters);
    const ids = uniqueOrdered([
      ...Object.keys(normalized.rosters || {}),
      ...Object.keys(normalized.rosterMeta || {})
    ].filter(Boolean));
    const docs = ids.map(id => ({
      id,
      templateId: id,
      entries: normalized.rosters[id] || [],
      meta: normalized.rosterMeta[id] || { classCount: "" }
    }));
    await syncCollection(splitRefs.rosters, docs, item => ({
      templateId: item.templateId,
      entries: item.entries || [],
      meta: item.meta || { classCount: "" }
    }));
    return;
  }

  if (domain === "timetable") {
    const normalized = normalizeTimetableDomain(appState.timetable);
    await syncCollection(splitRefs.timetableEntries, normalized.entries, item => item);
    await syncCollection(splitRefs.ttcards, normalized.ttcards, item => item);
    await setDoc(splitRefs.timetableMeta, {
      config: normalized.config,
      teacherConstraints: normalized.teacherConstraints,
      updatedAt: serverTimestamp()
    }, { merge: false });
  }
}

async function loadLegacyDomainFallback(domain, normalizeFn, options = {}) {
  try {
    const snap = await getDoc(refs[domain]);
    if (!snap.exists()) return false;
    const normalized = normalizeFn(snap.data());
    const hasData = options.hasData ? options.hasData(normalized) : true;
    if (!hasData) return false;
    applyNormalizedDomain(domain, normalized);
    // One-time forward migration from old one-document storage to split collections.
    // Skip if this domain is already in legacy fallback mode because subcollection access failed.
    if (canEdit() && SPLIT_COLLECTION_DOMAINS.has(domain) && !splitUnavailableDomains.has(domain)) {
      await saveSplitDomain(domain);
    }
    return true;
  } catch (e) {
    console.warn(`Legacy ${domain} fallback skipped.`, e);
    return false;
  }
}

// Snapshot handlers per ordinary one-document domain
function handleSnap(domain, normalizeFn) {
  return async (snap) => {
    if (!snap.exists()) {
      initialLoad[domain] = true;
      await saveNow(domain);
      fireUpdate(domain);
      return;
    }
    applyNormalizedDomain(domain, normalizeFn(snap.data()));
  };
}

const unsubs = {};

// ── Split confirmed flags (localStorage) ─────────────────────────
// _split 컬렉션에 데이터가 확인되면 플래그 저장 → 이후 fallback 시도 생략
const SPLIT_CONFIRMED_KEY = "his_split_confirmed_v1";
function getSplitConfirmed() {
  try { return new Set(JSON.parse(localStorage.getItem(SPLIT_CONFIRMED_KEY) || "[]")); }
  catch (_) { return new Set(); }
}
function markSplitConfirmed(domain) {
  const s = getSplitConfirmed(); s.add(domain);
  try { localStorage.setItem(SPLIT_CONFIRMED_KEY, JSON.stringify([...s])); } catch (_) {}
}
const splitConfirmed = getSplitConfirmed();

const splitFallbackAttempted = { classes: false, rosters: false, timetable: false };
const splitUnavailableDomains = new Set();

function domainHasData(domain) {
  if (domain === "classes") return (appState.classes?.classes || []).length > 0;
  if (domain === "rosters") {
    return Object.keys(appState.rosters?.rosters || {}).length > 0 ||
      Object.keys(appState.rosters?.rosterMeta || {}).length > 0;
  }
  if (domain === "timetable") {
    return (appState.timetable?.entries || []).length > 0 ||
      (appState.timetable?.ttcards || []).length > 0 ||
      Object.keys(appState.timetable?.teacherConstraints || {}).length > 0;
  }
  return false;
}

function fallbackToLegacyDocument(domain, normalizeFn, err) {
  if (splitUnavailableDomains.has(domain)) return;
  splitUnavailableDomains.add(domain);
  console.warn(`Split Firestore path unavailable for ${domain}; falling back to boards/${domain}.`, err);

  // Stop split listeners if they were registered.
  if (unsubs[domain]) {
    try { unsubs[domain](); } catch (_) {}
    delete unsubs[domain];
  }

  unsubs[domain] = onSnapshot(
    refs[domain],
    handleSnap(domain, normalizeFn),
    legacyErr => console.error(`${domain} legacy fallback`, legacyErr)
  );
}

export const DOMAIN_NORMALIZERS = {
  curriculum: normalizeCurriculumDomain,
  templates:  normalizeTemplatesDomain,
  classes:    normalizeClassesDomain,
  teachers:   normalizeTeachersDomain,
  rosters:    normalizeRostersDomain,
  rooms:      normalizeRoomsDomain,
  timetable:  normalizeTimetableDomain,
};

export const ALL_DOMAINS = Object.keys(DOMAIN_NORMALIZERS);
export const TIMETABLE_CORE_DOMAINS = ["curriculum", "templates", "classes", "rosters", "timetable"];
export const TIMETABLE_OPTIONAL_DOMAINS = ["rooms"];

export function isDomainSubscribed(domain) {
  return !!unsubs[domain];
}

function subscribeClassesSplit() {
  unsubs.classes = onSnapshot(splitRefs.classes, async snap => {
    if (!snap.empty) markSplitConfirmed("classes");

    // _split 컬렉션 확인됨 → fallback 불필요
    if (snap.empty && !splitConfirmed.has("classes") && !splitFallbackAttempted.classes) {
      splitFallbackAttempted.classes = true;
      const migrated = await loadLegacyDomainFallback("classes", normalizeClassesDomain, {
        hasData: d => (d.classes || []).length > 0
      });
      if (migrated) return;
    }
    if (snap.empty && splitFallbackAttempted.classes && domainHasData("classes")) return;

    const classes = snap.docs.map(d => normalizeClass({ id: d.id, ...withoutFirestoreMeta(d.data()) }));
    applyNormalizedDomain("classes", normalizeClassesDomain({ classes }));
  }, err => fallbackToLegacyDocument("classes", normalizeClassesDomain, err));
}

function subscribeRostersSplit() {
  unsubs.rosters = onSnapshot(splitRefs.rosters, async snap => {
    if (!snap.empty) markSplitConfirmed("rosters");

    if (snap.empty && !splitConfirmed.has("rosters") && !splitFallbackAttempted.rosters) {
      splitFallbackAttempted.rosters = true;
      const migrated = await loadLegacyDomainFallback("rosters", normalizeRostersDomain, {
        hasData: d => Object.keys(d.rosters || {}).length > 0 || Object.keys(d.rosterMeta || {}).length > 0
      });
      if (migrated) return;
    }
    if (snap.empty && splitFallbackAttempted.rosters && domainHasData("rosters")) return;

    const raw = { rosters: {}, rosterMeta: {} };
    snap.docs.forEach(d => {
      const data = withoutFirestoreMeta(d.data());
      const templateId = clean(data.templateId) || d.id;
      raw.rosters[templateId] = Array.isArray(data.entries) ? data.entries : [];
      raw.rosterMeta[templateId] = data.meta || { classCount: "" };
    });
    applyNormalizedDomain("rosters", normalizeRostersDomain(raw));
  }, err => fallbackToLegacyDocument("rosters", normalizeRostersDomain, err));
}

const timetableSplitCache = {
  entries: null,
  ttcards: null,
  meta: null,
  metaExists: false,
};

async function applyTimetableSplitIfReady() {
  if (!timetableSplitCache.entries || !timetableSplitCache.ttcards || timetableSplitCache.meta === null) return;

  const hasSplitData =
    timetableSplitCache.entries.length > 0 ||
    timetableSplitCache.ttcards.length > 0 ||
    timetableSplitCache.metaExists;

  if (hasSplitData) markSplitConfirmed("timetable");

  if (!hasSplitData && !splitConfirmed.has("timetable") && !splitFallbackAttempted.timetable) {
    splitFallbackAttempted.timetable = true;
    const migrated = await loadLegacyDomainFallback("timetable", normalizeTimetableDomain, {
      hasData: d => (d.entries || []).length > 0 || (d.ttcards || []).length > 0 || Object.keys(d.teacherConstraints || {}).length > 0
    });
    if (migrated) return;
  }

  if (!hasSplitData && (splitFallbackAttempted.timetable || splitConfirmed.has("timetable")) && domainHasData("timetable")) return;

  const raw = {
    config: timetableSplitCache.meta?.config || {},
    teacherConstraints: timetableSplitCache.meta?.teacherConstraints || {},
    entries: timetableSplitCache.entries,
    ttcards: timetableSplitCache.ttcards,
  };
  applyNormalizedDomain("timetable", normalizeTimetableDomain(raw));
}

function subscribeTimetableSplit() {
  const onSplitError = err => fallbackToLegacyDocument("timetable", normalizeTimetableDomain, err);

  const unsubEntries = onSnapshot(splitRefs.timetableEntries, snap => {
    timetableSplitCache.entries = snap.docs.map(d => normalizeTimetableEntry({ id: d.id, ...withoutFirestoreMeta(d.data()) }));
    applyTimetableSplitIfReady();
  }, onSplitError);

  const unsubCards = onSnapshot(splitRefs.ttcards, snap => {
    timetableSplitCache.ttcards = snap.docs.map(d => normalizeTtCard({ id: d.id, ...withoutFirestoreMeta(d.data()) }));
    applyTimetableSplitIfReady();
  }, onSplitError);

  const unsubMeta = onSnapshot(splitRefs.timetableMeta, snap => {
    timetableSplitCache.metaExists = snap.exists();
    timetableSplitCache.meta = snap.exists() ? withoutFirestoreMeta(snap.data()) : {};
    applyTimetableSplitIfReady();
  }, onSplitError);

  unsubs.timetable = () => { unsubEntries(); unsubCards(); unsubMeta(); };
}

/**
 * Subscribe only to the domains needed by the current page.
 * Split domains use collection listeners; other domains keep one-document listeners.
 */
export function subscribeDomains(domainList = ALL_DOMAINS) {
  setSubscribedDomains(domainList); // 배치 렌더링 준비
  domainList.forEach(domain => {
    if (!DOMAIN_NORMALIZERS[domain]) {
      console.warn(`Unknown Firestore domain: ${domain}`);
      return;
    }
    if (unsubs[domain]) return;

    if (splitUnavailableDomains.has(domain)) {
      unsubs[domain] = onSnapshot(
        refs[domain],
        handleSnap(domain, DOMAIN_NORMALIZERS[domain]),
        err => console.error(`${domain} legacy fallback`, err)
      );
      return;
    }

    if (domain === "classes") { subscribeClassesSplit(); return; }
    if (domain === "rosters") { subscribeRostersSplit(); return; }
    if (domain === "timetable") { subscribeTimetableSplit(); return; }

    unsubs[domain] = onSnapshot(
      refs[domain],
      handleSnap(domain, DOMAIN_NORMALIZERS[domain]),
      err => console.error(domain, err)
    );
  });
}

export function subscribeAll() {
  subscribeDomains(ALL_DOMAINS);
}

export function unsubscribeDomains(domainList = Object.keys(unsubs)) {
  domainList.forEach(domain => {
    if (unsubs[domain]) {
      unsubs[domain]();
      delete unsubs[domain];
    }
  });
}

export function unsubscribeAll() {
  unsubscribeDomains(Object.keys(unsubs));
}

// ================================================================
// DATA MIGRATION: old boards/main → new separate docs
// ================================================================
export async function migrateFromLegacy() {
  // ① localStorage 캐시 — 이미 완료된 경우 Firestore 왕복 없이 즉시 반환
  const MIGRATE_KEY = "his_migrated_v2";
  if (localStorage.getItem(MIGRATE_KEY) === "done") return;

  let legacySnap = null;
  try {
    legacySnap = await getDoc(refs.legacy);
  } catch (e) {
    console.warn("Legacy migration skipped; legacy document could not be read.", e);
    localStorage.setItem(MIGRATE_KEY, "done"); // 읽기 실패도 더 이상 시도 안 함
    return;
  }

  if (!legacySnap.exists()) {
    localStorage.setItem(MIGRATE_KEY, "done");
    return;
  }

  const legacy = legacySnap.data().state || {};
  const migrationTargets = [
    ["curriculum", normalizeCurriculumDomain],
    ["templates",  normalizeTemplatesDomain],
    ["classes",    normalizeClassesDomain],
    ["teachers",   normalizeTeachersDomain],
    ["rosters",    normalizeRostersDomain],
    ["rooms",      normalizeRoomsDomain],
    ["timetable",  normalizeTimetableDomain],
  ];

  const snaps = await Promise.all(
    migrationTargets.map(async ([domain]) => {
      try { return await getDoc(refs[domain]); }
      catch (e) { console.warn(`Migration check skipped for ${domain}.`, e); return null; }
    })
  );

  const missingTargets = migrationTargets.filter((_, idx) => snaps[idx] && !snaps[idx].exists());
  if (!missingTargets.length) {
    localStorage.setItem(MIGRATE_KEY, "done");
    return;
  }

  console.log(`Migrating: ${missingTargets.map(([d]) => d).join(", ")}`);
  try {
    await Promise.all(missingTargets.map(([domain, normalizeFn]) =>
      setDoc(refs[domain], { ...normalizeFn(legacy), updatedAt: serverTimestamp() })
    ));
    localStorage.setItem(MIGRATE_KEY, "done");
    console.log("Migration complete.");
  } catch (e) {
    console.warn("Migration partially failed; will retry next session.", e);
    // localStorage 플래그 설정 안 함 → 다음 로그인 시 재시도
  }
}

// ================================================================
// COLUMN WIDTHS (localStorage)
// ================================================================
export function loadColWidths(grade) {
  try {
    const s = localStorage.getItem(colWidthsKey(grade));
    if (s) { const p = JSON.parse(s); if (Array.isArray(p) && p.length === DEFAULT_COL_WIDTHS.length) return p; }
  } catch (_) {}
  return [...DEFAULT_COL_WIDTHS];
}
export function saveColWidths(grade, widths) {
  try { localStorage.setItem(colWidthsKey(grade), JSON.stringify(widths)); } catch (_) {}
}
