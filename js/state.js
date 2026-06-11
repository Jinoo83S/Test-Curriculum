// ================================================================
// state.js · Shared Application State + Firestore Sync
// ================================================================
import { refs, db, GRADE_KEYS, DEFAULT_OPTIONS, DEFAULT_ROW_COUNT, colWidthsKey, DEFAULT_COL_WIDTHS } from "./config.js";
import { uid, clean, uniqueOrdered, parseCreditValue } from "./utils.js";
import { canEdit } from "./auth.js";
import { LOCAL_DEV_MODE, readLocalStateStore, writeLocalStateStore, clearLocalStateStore } from "./local-dev.js";
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
// 자동저장 지연 시간은 운영/로컬 개발 환경을 분리합니다.
// 운영에서는 데이터 유실 위험을 줄이기 위해 짧게, 로컬 개발에서는 드래그/입력 테스트 여유를 둡니다.
export const SAVE_DELAY_MS = LOCAL_DEV_MODE ? 10000 : 2000;
export const FAST_SAVE_DELAY_MS = LOCAL_DEV_MODE ? 1500 : 350;
const AUTO_SAVE_KEY = "his_auto_save_v1";


// ── Firestore usage monitor (client-side estimate) ───────────────
// Firebase 콘솔의 실제 프로젝트 사용량을 직접 읽는 기능은 아니며,
// 이 브라우저에서 앱이 수행한 읽기/쓰기/삭제를 보수적으로 기록합니다.
const FIRESTORE_USAGE_KEY = "his_firestore_usage_v1";
const FIRESTORE_USAGE_LIMITS = { reads: 50000, writes: 20000, deletes: 20000 };

function usageDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function defaultUsageDay(day = usageDayKey()) {
  return { day, reads: 0, writes: 0, deletes: 0, logs: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

function readUsageStore() {
  try {
    const raw = localStorage.getItem(FIRESTORE_USAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeUsageStore(store) {
  try { localStorage.setItem(FIRESTORE_USAGE_KEY, JSON.stringify(store || {})); } catch (_) {}
}

function getTodayUsageStore() {
  const day = usageDayKey();
  const store = readUsageStore();
  if (!store.current || store.current.day !== day) {
    if (store.current?.day) {
      store.history = Array.isArray(store.history) ? store.history : [];
      store.history.unshift(store.current);
      store.history = store.history.slice(0, 14);
    }
    store.current = defaultUsageDay(day);
    writeUsageStore(store);
  }
  return store;
}

export function recordFirestoreUsage(type, count = 1, label = "", meta = {}) {
  if (LOCAL_DEV_MODE) return;
  const n = Math.max(0, Number(count) || 0);
  if (!n) return;
  const store = getTodayUsageStore();
  const current = store.current || defaultUsageDay();
  if (type === "read" || type === "reads") current.reads += n;
  else if (type === "write" || type === "writes") current.writes += n;
  else if (type === "delete" || type === "deletes") current.deletes += n;
  else return;
  current.updatedAt = new Date().toISOString();
  current.logs = Array.isArray(current.logs) ? current.logs : [];
  current.logs.push({ at: current.updatedAt, type, count: n, label: clean(label), meta });
  current.logs = current.logs.slice(-80);
  store.current = current;
  writeUsageStore(store);
}

function shouldCountSnapshotForUsage(snap) {
  return !snap?.metadata?.fromCache && !snap?.metadata?.hasPendingWrites;
}

function recordDocSnapshotUsage(label, snap, state = {}) {
  if (!shouldCountSnapshotForUsage(snap)) return;
  const count = snap?.exists?.() ? 1 : 0;
  if (count) recordFirestoreUsage("reads", count, label, { source: state.seen ? "snapshot-update" : "snapshot-initial" });
  state.seen = true;
}

function recordCollectionSnapshotUsage(label, snap, state = {}) {
  if (!shouldCountSnapshotForUsage(snap)) return;
  let count = 0;
  if (!state.seen) {
    count = snap?.size || 0;
  } else {
    try { count = (snap.docChanges?.() || []).length; }
    catch (_) { count = snap?.size || 0; }
  }
  if (count) recordFirestoreUsage("reads", count, label, { source: state.seen ? "snapshot-update" : "snapshot-initial" });
  state.seen = true;
}

function estimateCurrentDomainReadCount(domain) {
  if (domain === "classes") {
    return { domain, count: (appState.classes?.classes || []).length, note: "split/classes 컬렉션" };
  }
  if (domain === "rosters") {
    const ids = uniqueOrdered([
      ...Object.keys(appState.rosters?.rosters || {}),
      ...Object.keys(appState.rosters?.rosterMeta || {})
    ]);
    return { domain, count: ids.length, note: "split/rosters 과목별 문서" };
  }
  if (domain === "timetable") {
    const entries = (appState.timetable?.entries || []).length;
    const cards = (appState.timetable?.ttcards || []).length;
    return { domain, count: entries + cards + 1, note: `entries ${entries} + cards ${cards} + meta 1` };
  }
  return { domain, count: 1, note: `boards/${domain} 단일 문서` };
}

export function getFirestoreUsageStats() {
  const store = getTodayUsageStore();
  const byDomain = [...(_subscribedDomains || [])].map(estimateCurrentDomainReadCount);
  const total = byDomain.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  return {
    limits: { ...FIRESTORE_USAGE_LIMITS },
    current: { ...(store.current || defaultUsageDay()) },
    history: Array.isArray(store.history) ? store.history : [],
    subscribedDomains: [...(_subscribedDomains || [])],
    currentSubscriptionEstimate: { total, byDomain },
    localMode: LOCAL_DEV_MODE,
    dirtyDomains: getDirtyDomains(),
    initialLoad: { ...initialLoad }
  };
}

export function exportFirestoreUsageSnapshot() {
  return {
    version: 1,
    mode: "his-firestore-usage-estimate",
    exportedAt: new Date().toISOString(),
    note: "이 파일은 현재 브라우저에서 앱이 기록한 Firestore 사용량 추정치입니다. Firebase 콘솔의 전체 프로젝트 사용량과 다를 수 있습니다.",
    ...getFirestoreUsageStats()
  };
}

export function resetFirestoreUsageStats() {
  const store = readUsageStore();
  store.current = defaultUsageDay();
  writeUsageStore(store);
  return store.current;
}

// 마지막으로 Firestore에서 읽었거나 Firestore에 저장한 상태의 fingerprint입니다.
// 같은 데이터는 다시 쓰지 않아 quota를 소모하지 않도록 합니다.
const savedDomainFingerprints = {};
const splitDocFingerprints = {
  classes: { classes: new Map() },
  rosters: { rosters: new Map() },
  timetable: { timetableEntries: new Map(), ttcards: new Map(), timetableMeta: null },
};

let _onSaveStatus = null;
export const setOnSaveStatus = (cb) => {
  _onSaveStatus = cb;
  _onSaveStatus?.("mode", { autoSave: isAutoSaveEnabled(), dirtyDomains: getDirtyDomains() });
};

function stableStringify(value) {
  const seen = new WeakSet();
  const normalize = (v) => {
    if (v == null || typeof v !== "object") return v;
    if (v instanceof Date) return v.toISOString();
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.map(normalize);
    const out = {};
    Object.keys(v)
      .filter(k => k !== "updatedAt" && k !== "createdAt")
      .sort()
      .forEach(k => { out[k] = normalize(v[k]); });
    return out;
  };
  return JSON.stringify(normalize(value));
}

function fp(value) { return stableStringify(value); }

function normalizedForDomain(domain) {
  const normalizer = DOMAIN_NORMALIZERS?.[domain];
  return normalizer ? normalizer(appState[domain]) : appState[domain];
}

function markDomainSaved(domain, normalized = normalizedForDomain(domain)) {
  savedDomainFingerprints[domain] = fp(normalized);
  markSplitBaselines(domain, normalized);
}

function domainChanged(domain, normalized = normalizedForDomain(domain)) {
  return savedDomainFingerprints[domain] !== fp(normalized);
}

export function isAutoSaveEnabled() {
  try { return localStorage.getItem(AUTO_SAVE_KEY) !== "off"; }
  catch (_) { return true; }
}

export function setAutoSaveEnabled(enabled) {
  try { localStorage.setItem(AUTO_SAVE_KEY, enabled ? "on" : "off"); } catch (_) {}
  Object.keys(saveTimers).forEach(domain => {
    clearTimeout(saveTimers[domain]);
    delete saveTimers[domain];
  });
  if (enabled) {
    dirtyDomains.forEach(domain => {
      saveTimers[domain] = setTimeout(() => saveNow(domain), 1000);
    });
  }
  _onSaveStatus?.("mode", { autoSave: isAutoSaveEnabled(), dirtyDomains: getDirtyDomains() });
}

export function getDirtyDomains() {
  return [...dirtyDomains];
}

export function scheduleSave(domain, options = {}) {
  if (!canEdit() || !initialLoad[domain]) return;
  dirtyDomains.add(domain);

  if (!isAutoSaveEnabled()) {
    clearTimeout(saveTimers[domain]);
    delete saveTimers[domain];
    _onSaveStatus?.("dirty", { autoSave: false, dirtyDomains: getDirtyDomains() });
    return;
  }

  _onSaveStatus?.("saving", { autoSave: true, dirtyDomains: getDirtyDomains() });
  clearTimeout(saveTimers[domain]);
  const requestedDelay = Number(options?.delayMs);
  const delayMs = options?.immediate ? 0 : (Number.isFinite(requestedDelay) ? Math.max(0, requestedDelay) : SAVE_DELAY_MS);
  saveTimers[domain] = setTimeout(() => saveNow(domain, options?.saveOptions || {}), delayMs);
}

export function scheduleFastSave(domain, options = {}) {
  return scheduleSave(domain, { ...options, delayMs: options.delayMs ?? FAST_SAVE_DELAY_MS });
}

export async function saveNow(domain, options = {}) {
  if (!canEdit() || !initialLoad[domain]) return false;
  clearTimeout(saveTimers[domain]);
  delete saveTimers[domain];

  const normalized = normalizedForDomain(domain);
  if (!options.force && !domainChanged(domain, normalized)) {
    dirtyDomains.delete(domain);
    _onSaveStatus?.("skipped", { domain, dirtyDomains: getDirtyDomains() });
    return true;
  }

  if (LOCAL_DEV_MODE) {
    try {
      saveLocalDomain(domain, normalized);
      markDomainSaved(domain, normalized);
      dirtyDomains.delete(domain);
      _onSaveStatus?.("saved", { domain, local: true, dirtyDomains: getDirtyDomains() });
      console.info(`[Local dev save] ${domain} 저장 완료`);
      return true;
    } catch (e) {
      dirtyDomains.add(domain);
      console.error(`Local save failed [${domain}]:`, e);
      _onSaveStatus?.("error", e);
      if (options.throwOnError) throw e;
      return false;
    }
  }

  try {
    if (SPLIT_COLLECTION_DOMAINS.has(domain) && !splitUnavailableDomains.has(domain)) {
      await saveSplitDomain(domain, { force: !!options.force, normalized });
    } else {
      // Ordinary domains, or split domains temporarily running in legacy fallback mode.
      await setDoc(refs[domain], { ...normalized, updatedAt: serverTimestamp() });
      recordFirestoreUsage("writes", 1, `save: boards/${domain}`, { operation: "setDoc" });
    }
    markDomainSaved(domain, normalized);
    dirtyDomains.delete(domain);
    _onSaveStatus?.("saved", { domain, dirtyDomains: getDirtyDomains() });
    console.info(`[Firestore save] ${domain} 저장 완료`);
    return true;
  } catch (e) {
    dirtyDomains.add(domain);
    console.error(`Save failed [${domain}]:`, e);
    _onSaveStatus?.("error", e);
    if (options.throwOnError) throw e;
    return false;
  }
}

export async function flushPendingSaves(options = {}) {
  const domains = [...dirtyDomains];
  const results = await Promise.all(domains.map(d => saveNow(d, options)));
  const ok = results.every(Boolean);
  if (!ok && options.throwOnError) throw new Error("일부 변경사항 저장에 실패했습니다.");
  return ok;
}

export const savePendingNow = flushPendingSaves;

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
    // 자동 생성 그룹에서 사용자가 제외한 카드입니다.
    // 카드 자체를 삭제하지 않고 그룹 동시배정 대상에서만 제외하기 위해 별도로 보존합니다.
    excludedCardIds: Array.isArray(item.excludedCardIds) ? item.excludedCardIds.filter(Boolean) : [],
    groupType: isConcurrent ? "concurrent" : (isCrossGrade ? "cross-grade" : "off"),
    linkedGroupId: clean(item.linkedGroupId) || null
  };
}

export function normalizeTemplate(item = {}) {
  const language = ["Korean","English","Both"].includes(item.language) ? item.language : "Both";
  const s1ko=clean(item.sem1NameKo), s1en=clean(item.sem1NameEn), s1te=clean(item.sem1Teacher);
  const s2ko=clean(item.sem2NameKo), s2en=clean(item.sem2NameEn), s2te=clean(item.sem2Teacher);
  const useSemesterOverrides = Boolean(item.useSemesterOverrides || s1ko || s1en || s1te || s2ko || s2en || s2te);
  const compoundParts = Array.isArray(item.compoundParts)
    ? item.compoundParts.map((part, idx) => ({
        id: clean(part?.id) || uid("part"),
        nameKo: clean(part?.nameKo),
        nameEn: clean(part?.nameEn),
        teacher: clean(part?.teacher),
        credits: clean(part?.credits) || (idx === 0 ? "" : "")
      })).filter(part => part.nameKo || part.nameEn || part.teacher || part.credits)
    : [];
  const isCompound = !!item.isCompound || compoundParts.length > 0;
  return {
    id: item.id || uid("tpl"), language, useSemesterOverrides,
    nameKo: clean(item.nameKo), nameEn: clean(item.nameEn), teacher: clean(item.teacher),
    sem1NameKo:s1ko, sem1NameEn:s1en, sem1Teacher:s1te,
    sem2NameKo:s2ko, sem2NameEn:s2en, sem2Teacher:s2te,
    calcGroupId: clean(item.calcGroupId) || null,
    schoolLevel: ["중등","고등","공통"].includes(item.schoolLevel) ? item.schoolLevel : "공통",
    // 복합 과목: 하나의 커리큘럼 카드/수강명단을 여러 실제 시간표 카드로 분할 생성합니다.
    // 예: 심화물리(2) 2시수 + 미적분(2) 2시수 = 선택5 1과목 4시수
    isCompound,
    compoundParts
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
      rosterMeta[tid] = { classCount: clean(meta?.classCount), missingExcluded: !!meta?.missingExcluded };
    });
  }
  return { rosters, rosterMeta };
}

// ── Rooms ──────────────────────────────────────────────────────────
// 기본 교실 유형입니다. 실제 화면에서는 rooms.roomTypes에 저장된 값을 우선 사용합니다.
export const ROOM_TYPES = ["일반", "특별", "체육관", "음악실", "과학실", "기타"];

function normalizeRoomTypes(rawTypes, discoveredTypes = []) {
  const hasSavedTypes = Array.isArray(rawTypes);
  const savedTypes = hasSavedTypes ? rawTypes.map(clean).filter(Boolean) : [];
  const baseTypes = hasSavedTypes ? savedTypes : ROOM_TYPES;
  const merged = uniqueOrdered([
    "일반",
    ...baseTypes,
    ...(Array.isArray(discoveredTypes) ? discoveredTypes : []),
  ].map(clean).filter(Boolean));
  return merged.length ? merged : ["일반"];
}

export function normalizeRoom(r = {}) {
  return {
    id: r.id || uid("room"),
    name: clean(r.name) || "새 교실",
    capacity: Number.isFinite(parseInt(r.capacity)) ? parseInt(r.capacity) : 0,
    // 사용자가 교실 유형을 직접 편집할 수 있으므로, 기존 ROOM_TYPES에 없는 값도 보존합니다.
    type: clean(r.type) || "일반",
    grade: GRADE_KEYS.includes(r.grade) ? r.grade : "",
    // 홈룸: 명단에서 설정한 반 ID를 저장합니다. 표시값은 rooms.js에서 7A/8B 형식으로 계산합니다.
    homeRoomClassId: clean(r.homeRoomClassId || r.homeRoomId),
    // 담당/전용 교사 표시용. 시간표 교사 조건의 홈룸/본인 교실과 연동됩니다.
    teacherName: clean(r.teacherName),
    note: clean(r.note)
  };
}
function normalizeRoomsDomain(raw = {}) {
  const rawRooms = Array.isArray(raw.rooms) ? raw.rooms : [];
  const discoveredTypes = rawRooms.map(r => clean(r?.type)).filter(Boolean);
  const roomTypes = normalizeRoomTypes(raw.roomTypes, discoveredTypes);
  const rooms = rawRooms.map(normalizeRoom).map(room => ({
    ...room,
    type: roomTypes.includes(room.type) ? room.type : "일반"
  }));
  return { rooms, roomTypes };
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
    // 배치 시점의 그룹명 스냅샷입니다.
    // 그룹명을 나중에 찾지 못하거나 전체보기 요약에서 track(구분명)이 우선 표시되는 문제를 막기 위해 보존합니다.
    groupName:   clean(e.groupName || e.groupLabel || e.groupTitle),
    // ttcard fields
    ttcardId:    clean(e.ttcardId)  || null,
    ttcardIds:   Array.isArray(e.ttcardIds) ? e.ttcardIds.filter(Boolean) : [],
    // Arrays: for units with multiple templates/grades (cross-grade co-teaching)
    templateIds: Array.isArray(e.templateIds) ? e.templateIds.filter(Boolean) : (templateId ? [templateId] : []),
    gradeKeys:   Array.isArray(e.gradeKeys)   ? e.gradeKeys.filter(Boolean)   : (gradeKey   ? [gradeKey]   : []),
    teacherName: clean(e.teacherName),
    audienceClassKeys: Array.isArray(e.audienceClassKeys) ? e.audienceClassKeys.map(clean).filter(Boolean) : [],
    // 학생 개인 key는 시간표 배치 단계에서 더 이상 사용하지 않습니다.
    // 기존 Firestore 데이터에 남아 있어도 로드 시 비워서 UI/충돌/자동배치에 영향을 주지 않게 합니다.
    audienceStudentKeys: [],
    roomId:      clean(e.roomId) || null,
    roomRule:    clean(e.roomRule) || "auto",
    roomPinned:  !!e.roomPinned,
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
    // 학생 개인 key는 사전작업 단계에서만 의미가 있고 시간표 카드에는 저장하지 않습니다.
    studentKeys: [],
    isWholeGrade: !!item.isWholeGrade,
    roomRule:    clean(item.roomRule) || "auto",
    fixedRoomId: clean(item.fixedRoomId) || null,
    generatedAt: clean(item.generatedAt),
    manualEdited: !!item.manualEdited,
    // 커리큘럼 원본 없이 시간표 편집 화면에서 직접 만든 보정 카드입니다.
    // 카드 새로고침/재생성 시 삭제되지 않도록 별도 표시합니다.
    isManual: !!item.isManual,
    manualCreatedAt: clean(item.manualCreatedAt),
    manualNote: clean(item.manualNote),

    // 복합 과목 카드에서 파생된 실제 배치 카드 정보입니다.
    compoundParentTemplateId: clean(item.compoundParentTemplateId) || null,
    compoundPartId: clean(item.compoundPartId) || null,
    compoundPartIndex: Number.isInteger(item.compoundPartIndex) ? item.compoundPartIndex : null,
    compoundPartCount: Number.isInteger(item.compoundPartCount) ? item.compoundPartCount : 0,
    compoundTotalCredits: num(item.compoundTotalCredits),
  };
}
const TEACHER_WORK_TYPES = new Set(["fulltime", "parttime", "childcare", "restricted", "other"]);
const RESTRICTED_WORK_TYPES = new Set(["parttime", "childcare", "restricted", "other"]);



const TIMETABLE_SAVED_VERSION_LIMIT = 6;
const TIMETABLE_AUTO_AFTER_LIMIT = 4;
const TIMETABLE_AUTO_BEFORE_LIMIT = 1;
const TIMETABLE_MANUAL_LIMIT = 3;
const TIMETABLE_META_DIAGNOSTIC_LIMIT = 12;

function safeJsonClone(value) {
  if (value == null || typeof value !== "object") return value ?? null;
  try { return JSON.parse(JSON.stringify(value)); }
  catch (_) { return null; }
}

function compactAutoAssignMetaForStorage(meta = null) {
  if (!meta || typeof meta !== "object") return null;
  const cloneMetric = value => (value && typeof value === "object") ? safeJsonClone(value) : null;
  const compactDiagnostics = Array.isArray(meta.failedDiagnostics)
    ? meta.failedDiagnostics.slice(0, TIMETABLE_META_DIAGNOSTIC_LIMIT).map(d => ({
        key: clean(d?.key || d?.id || ""),
        name: clean(d?.name || d?.title || ""),
        title: clean(d?.title || ""),
        missing: Number(d?.missing || d?.shortage || d?.missingCount || 0) || 0,
        candidateCount: Number(d?.candidateCount || d?.availableCount || 0) || 0,
        reasonSummary: Array.isArray(d?.reasonSummary) ? d.reasonSummary.slice(0, 6).map(clean) : [],
        suggestions: Array.isArray(d?.suggestions) ? d.suggestions.slice(0, 4).map(clean) : []
      }))
    : [];
  const compactReasonSummary = Array.isArray(meta.failedReasonSummary)
    ? meta.failedReasonSummary.slice(0, TIMETABLE_META_DIAGNOSTIC_LIMIT).map(row => safeJsonClone(row)).filter(Boolean)
    : [];
  return {
    schemaVersion: clean(meta.schemaVersion),
    generatedAt: clean(meta.generatedAt) || clean(meta.at),
    validationSummary: clean(meta.validationSummary),
    ok: meta.ok === true,
    placedEntryCount: Number(meta.placedEntryCount || meta.entryCount || 0) || 0,
    placedBlockCount: Number(meta.placedBlockCount || 0) || 0,
    failedUnitCount: Number(meta.failedUnitCount ?? meta.failedCount ?? meta.finalMetrics?.failedCount ?? 0) || 0,
    failedCount: Number(meta.failedCount ?? meta.failedUnitCount ?? meta.finalMetrics?.failedCount ?? 0) || 0,
    failedOccurrenceCount: Number(meta.failedOccurrenceCount || 0) || 0,
    classIssueCount: Number(meta.classIssueCount ?? meta.classSlotIssueCount ?? meta.finalMetrics?.classSlotIssueCount ?? 0) || 0,
    classSlotIssueCount: Number(meta.classSlotIssueCount ?? meta.classIssueCount ?? meta.finalMetrics?.classSlotIssueCount ?? 0) || 0,
    classShortCount: Number(meta.classShortCount ?? meta.finalMetrics?.classShortCount ?? 0) || 0,
    classOverCount: Number(meta.classOverCount ?? meta.finalMetrics?.classOverCount ?? 0) || 0,
    cardCoverageIssueCount: Number(meta.cardCoverageIssueCount ?? meta.finalMetrics?.cardCoverageIssueCount ?? 0) || 0,
    groupCoverageIssueCount: Number(meta.groupCoverageIssueCount ?? meta.finalMetrics?.groupCoverageIssueCount ?? 0) || 0,
    cardShortageSlots: Number(meta.cardShortageSlots ?? meta.finalMetrics?.cardShortageSlots ?? 0) || 0,
    restrictedTeacherIssueCount: Number(meta.restrictedTeacherIssueCount || 0) || 0,
    protectedIntrusionCount: Number(meta.protectedIntrusionCount || 0) || 0,
    missingRoomCount: Number(meta.missingRoomCount || 0) || 0,
    selectedAcceptedLabel: clean(meta.selectedAcceptedLabel),
    metricSource: clean(meta.metricSource),
    metricCompleteness: clean(meta.metricCompleteness),
    qualityBaselineSource: clean(meta.qualityBaselineSource),
    qualityBaselineSnapshotName: clean(meta.qualityBaselineSnapshotName),
    qualityBaselineValidationSummary: clean(meta.qualityBaselineValidationSummary),
    currentBeforeMetrics: cloneMetric(meta.currentBeforeMetrics),
    baselineMetrics: cloneMetric(meta.baselineMetrics),
    acceptedMetrics: cloneMetric(meta.acceptedMetrics),
    finalMetrics: cloneMetric(meta.finalMetrics),
    qualityGate: cloneMetric(meta.qualityGate),
    rejectedByQualityGate: meta.rejectedByQualityGate === true,
    rejectReason: clean(meta.rejectReason),
    failedDiagnostics: compactDiagnostics,
    failedReasonSummary: compactReasonSummary,
    missingRoomNames: Array.isArray(meta.missingRoomNames) ? meta.missingRoomNames.slice(0, 20).map(clean) : [],
    restrictedTeacherNames: Array.isArray(meta.restrictedTeacherNames) ? meta.restrictedTeacherNames.slice(0, 20).map(clean) : []
  };
}

function savedVersionTime(v = {}) {
  const t = Date.parse(v.updatedAt || v.createdAt || 0);
  return Number.isFinite(t) ? t : 0;
}

function extractSavedVersionMetricEvidence(v = {}) {
  const m = v.autoAssignMeta || {};
  const text = [v.note, m.validationSummary, m.qualityBaselineValidationSummary].map(x => String(x || "")).join(" / ");
  const n = x => Number.isFinite(Number(x)) ? Number(x) : 0;
  const pick = (...values) => {
    for (const value of values) if (Number.isFinite(Number(value))) return Number(value);
    return 0;
  };
  const matchNum = regex => Number((text.match(regex) || [0, ""])[1]) || 0;
  const hasMetaObject = !!(m && typeof m === "object" && Object.keys(m).length);
  const hasFinalMetrics = !!(m.finalMetrics && typeof m.finalMetrics === "object");
  const hasClassEvidence = hasFinalMetrics || Object.prototype.hasOwnProperty.call(m, "classSlotIssueCount") || Object.prototype.hasOwnProperty.call(m, "classIssueCount") || /학급\s*시수\s*\d+개/.test(text) || /검증\s*통과/.test(text);
  const hasCardEvidence = hasFinalMetrics || Object.prototype.hasOwnProperty.call(m, "cardCoverageIssueCount") || Object.prototype.hasOwnProperty.call(m, "cardShortageSlots") || /카드\s*시수\s*\d+개/.test(text);
  const hasGroupEvidence = hasFinalMetrics || Object.prototype.hasOwnProperty.call(m, "groupCoverageIssueCount") || /그룹\/개별\s*\d+개/.test(text);
  const hasFailedEvidence = hasFinalMetrics || Object.prototype.hasOwnProperty.call(m, "failedCount") || Object.prototype.hasOwnProperty.call(m, "failedUnitCount") || /미배치\s*\d+개/.test(text);
  const cardCoverageIssueCount = pick(m.cardCoverageIssueCount, m.finalMetrics?.cardCoverageIssueCount, matchNum(/카드\s*시수\s*(\d+)개/));
  const groupCoverageIssueCount = pick(m.groupCoverageIssueCount, m.finalMetrics?.groupCoverageIssueCount, matchNum(/그룹\/개별\s*(\d+)개/));
  const classSlotIssueCount = pick(m.classSlotIssueCount, m.classIssueCount, m.finalMetrics?.classSlotIssueCount, matchNum(/학급\s*시수\s*(\d+)개/));
  const failedCount = pick(m.failedCount, m.failedUnitCount, m.finalMetrics?.failedCount, matchNum(/미배치\s*(\d+)개/));
  const cardShortageSlots = pick(m.cardShortageSlots, m.finalMetrics?.cardShortageSlots, cardCoverageIssueCount ? cardCoverageIssueCount : 0);
  return {
    complete: !!(hasMetaObject && hasClassEvidence && hasCardEvidence && hasGroupEvidence && hasFailedEvidence),
    classSlotIssueCount,
    cardCoverageIssueCount,
    groupCoverageIssueCount,
    failedCount,
    cardShortageSlots,
    restrictedTeacherIssueCount: pick(m.restrictedTeacherIssueCount, m.finalMetrics?.restrictedTeacherIssueCount),
    missingRoomCount: pick(m.missingRoomCount, m.finalMetrics?.missingRoomCount),
    protectedIntrusionCount: pick(m.protectedIntrusionCount, m.finalMetrics?.protectedIntrusionCount)
  };
}

function hasCompleteSavedVersionMetrics(v = {}) {
  return extractSavedVersionMetricEvidence(v).complete;
}

function savedVersionQualityScore(v = {}) {
  const evidence = extractSavedVersionMetricEvidence(v);
  const n = x => Number.isFinite(Number(x)) ? Number(x) : 0;
  const incompletePenalty = evidence.complete ? 0 : 900000000;
  return incompletePenalty
    + evidence.cardShortageSlots * 100000
    + evidence.cardCoverageIssueCount * 30000
    + evidence.groupCoverageIssueCount * 12000
    + evidence.classSlotIssueCount * 4000
    + evidence.failedCount * 1000
    + evidence.restrictedTeacherIssueCount * 250
    + evidence.missingRoomCount * 500
    + evidence.protectedIntrusionCount * 500
    - n(v.entryCount) / 1000;
}

function isAutoTimetableVersion(v = {}) {
  const name = clean(v.name);
  return v.autoSnapshot === true || clean(v.source) === "autoassign" || clean(v.source) === "autoassign-best" || name.startsWith("자동배치 ");
}

function isBeforeAutoTimetableVersion(v = {}) {
  const name = clean(v.name);
  return clean(v.snapshotKind) === "before" || name.startsWith("자동배치 전");
}

function pruneSavedTimetableVersions(list = []) {
  const normalized = Array.isArray(list) ? list.filter(v => v && Array.isArray(v.entries) && v.entries.length) : [];
  if (normalized.length <= TIMETABLE_SAVED_VERSION_LIMIT) return normalized.map(v => ({ ...v, autoAssignMeta: compactAutoAssignMetaForStorage(v.autoAssignMeta) }));

  const byId = new Map();
  const add = v => {
    if (!v || byId.has(v.id)) return;
    byId.set(v.id, { ...v, autoAssignMeta: compactAutoAssignMetaForStorage(v.autoAssignMeta) });
  };

  const auto = normalized.filter(isAutoTimetableVersion);
  const autoAfter = auto.filter(v => !isBeforeAutoTimetableVersion(v));
  const autoBefore = auto.filter(isBeforeAutoTimetableVersion);
  const manual = normalized.filter(v => !isAutoTimetableVersion(v));

  autoAfter.slice().filter(hasCompleteSavedVersionMetrics).sort((a, b) => savedVersionQualityScore(a) - savedVersionQualityScore(b))[0] && add(autoAfter.slice().filter(hasCompleteSavedVersionMetrics).sort((a, b) => savedVersionQualityScore(a) - savedVersionQualityScore(b))[0]);
  autoAfter.slice().sort((a, b) => savedVersionTime(b) - savedVersionTime(a)).slice(0, TIMETABLE_AUTO_AFTER_LIMIT).forEach(add);
  autoBefore.slice().sort((a, b) => savedVersionTime(b) - savedVersionTime(a)).slice(0, TIMETABLE_AUTO_BEFORE_LIMIT).forEach(add);
  manual.slice().sort((a, b) => savedVersionTime(b) - savedVersionTime(a)).slice(0, TIMETABLE_MANUAL_LIMIT).forEach(add);

  if (byId.size < TIMETABLE_SAVED_VERSION_LIMIT) {
    normalized.slice().sort((a, b) => savedVersionTime(b) - savedVersionTime(a)).forEach(v => {
      if (byId.size < TIMETABLE_SAVED_VERSION_LIMIT) add(v);
    });
  }

  return [...byId.values()]
    .sort((a, b) => savedVersionTime(b) - savedVersionTime(a))
    .slice(0, TIMETABLE_SAVED_VERSION_LIMIT);
}

function normalizeSavedTimetableVersion(item = {}) {
  const entries = Array.isArray(item.entries)
    ? item.entries.map(normalizeTimetableEntry).filter(e => e.templateId)
    : [];
  const createdAt = clean(item.createdAt) || new Date().toISOString();
  return {
    id: clean(item.id) || uid("ttv"),
    name: clean(item.name) || "저장된 배치",
    note: clean(item.note),
    createdAt,
    updatedAt: clean(item.updatedAt) || createdAt,
    periodCount: Math.max(1, Math.min(12, parseInt(item.periodCount) || 7)),
    entryCount: Number.isInteger(item.entryCount) ? item.entryCount : entries.length,
    autoSnapshot: !!item.autoSnapshot,
    snapshotKind: clean(item.snapshotKind),
    source: clean(item.source),
    autoAssignMeta: compactAutoAssignMetaForStorage(item.autoAssignMeta),
    cardGenerationMeta: item.cardGenerationMeta && typeof item.cardGenerationMeta === "object" ? JSON.parse(JSON.stringify(item.cardGenerationMeta)) : null,
    entries,
  };
}

function normalizeBestAutoAssignSnapshot(item = {}) {
  if (!item || !Array.isArray(item.entries) || !item.entries.length) return null;
  if (!hasCompleteSavedVersionMetrics(item)) return null;
  const normalized = normalizeSavedTimetableVersion({
    ...item,
    autoSnapshot: true,
    snapshotKind: item.snapshotKind || "result",
    source: item.source || "autoassign-best",
    name: item.name || "자동배치 최고 결과"
  });
  return normalized.entries.length ? { ...normalized, bestSnapshot: true, source: "autoassign-best" } : null;
}

function findBestAutoAssignSnapshotFromSaved(list = []) {
  const candidates = Array.isArray(list)
    ? list.filter(v => v && !isBeforeAutoTimetableVersion(v) && isAutoTimetableVersion(v) && Array.isArray(v.entries) && v.entries.length && hasCompleteSavedVersionMetrics(v))
    : [];
  if (!candidates.length) return null;
  const best = candidates.slice().sort((a, b) => savedVersionQualityScore(a) - savedVersionQualityScore(b))[0];
  return normalizeBestAutoAssignSnapshot(best);
}


export function normalizeTimetableConstraint(c = {}) {
  const workType = TEACHER_WORK_TYPES.has(clean(c.workType)) ? clean(c.workType) : "fulltime";
  const maxPerWeek = Number.isInteger(c.maxPerWeek) && c.maxPerWeek > 0 ? c.maxPerWeek : 0;
  return {
    maxPerDay:      (Number.isInteger(c.maxPerDay)      && c.maxPerDay > 0)      ? c.maxPerDay      : 6,
    maxConsecutive: (Number.isInteger(c.maxConsecutive) && c.maxConsecutive > 0) ? c.maxConsecutive : 3,
    // 주 최대 시수는 시간강사/육아단축 등 제한 근무 교사의 자동배치 우선순위와 충돌 진단에 사용합니다.
    // 0은 제한 없음입니다.
    maxPerWeek,
    unavailableSlots: Array.isArray(c.unavailableSlots)
      ? c.unavailableSlots.filter(s => Number.isInteger(s.day) && Number.isInteger(s.period))
      : [],
    // 근무 유형: fulltime | parttime | childcare | restricted | other
    workType,
    // 과거/외부 데이터 호환용 플래그입니다. 실제 판단은 workType을 우선 사용합니다.
    isRestrictedWork: c.isRestrictedWork === true || RESTRICTED_WORK_TYPES.has(workType),
    constraintNote: clean(c.constraintNote),
    // assignedRoomId: 실제 자동배정 시 우선 배정할 교실
    assignedRoomId: clean(c.assignedRoomId) || null,
    // homeRoomId/useHomeRoom: 교사 조건 화면의 홈룸/본인 교실 기능
    homeRoomId: clean(c.homeRoomId) || null,
    useHomeRoom: !!c.useHomeRoom,
  };
}
function normalizePeriodLabels(rawLabels, periodCount) {
  if (!Array.isArray(rawLabels) || rawLabels.length !== periodCount) {
    return Array.from({ length: periodCount }, (_, i) => `${i + 1}교시`);
  }

  const labels = rawLabels.map(clean);
  const looksLikeOldZeroBasedDefault = labels.every((label, i) => label === `${i}교시`);
  if (looksLikeOldZeroBasedDefault) {
    return labels.map((_, i) => `${i + 1}교시`);
  }

  return labels.map((label, i) => label || `${i + 1}교시`);
}

function normalizeTtCardTeacherOptions(raw = {}) {
  const allowedModes = new Set(["homeroom", "representative", "none"]);
  const mode = allowedModes.has(clean(raw.mode)) ? clean(raw.mode) : "none";
  return {
    mode,
    representativeTeacher: clean(raw.representativeTeacher)
  };
}

function normalizeTimetableDomain(raw = {}) {
  const pc = Math.max(1, Math.min(12, parseInt(raw.config?.periodCount) || 8));
  const pl = normalizePeriodLabels(raw.config?.periodLabels, pc);
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
    // 시간표 전용 묶음수업/그룹 스냅샷입니다.
    // 예전 데이터 호환을 위해 raw.templateGroups도 한 번 수용합니다.
    ttcardGroups: Array.isArray(raw.ttcardGroups)
      ? raw.ttcardGroups.map(normalizeTemplateGroup).filter(g => g.name)
      : (Array.isArray(raw.templateGroups) ? raw.templateGroups.map(normalizeTemplateGroup).filter(g => g.name) : []),
    // 배치된 시간표만 별도 저장한 버전 목록입니다. 카드/커리큘럼은 제외하고 entries만 보관합니다.
    savedSchedules: Array.isArray(raw.savedSchedules)
      ? pruneSavedTimetableVersions(raw.savedSchedules.map(normalizeSavedTimetableVersion).filter(v => v.entries.length))
      : [],
    bestAutoAssignSnapshot: normalizeBestAutoAssignSnapshot(raw.bestAutoAssignSnapshot) || findBestAutoAssignSnapshotFromSaved(Array.isArray(raw.savedSchedules) ? raw.savedSchedules.map(normalizeSavedTimetableVersion).filter(v => v.entries.length) : []),
    teacherConstraints: constraints,
    // 시간표 카드 생성/자동배치 점검 메타입니다. 로컬 JSON과 Firestore meta 문서에 보존합니다.
    cardGenerationMeta: raw.cardGenerationMeta && typeof raw.cardGenerationMeta === "object" ? JSON.parse(JSON.stringify(raw.cardGenerationMeta)) : null,
    autoAssignMeta: compactAutoAssignMetaForStorage(raw.autoAssignMeta),
    // 시간표 카드 생성 시 담당교사가 비어 있는 과목 처리 기준입니다.
    // homeroom: 대상 반 담임 배정 / representative: 지정 대표 교사 배정 / none: 교사 없음 허용
    ttcardTeacherOptions: normalizeTtCardTeacherOptions(raw.ttcardTeacherOptions || raw.cardTeacherOptions || {})
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

// ================================================================
// LOCAL DEVELOPMENT STORAGE
// ================================================================
function getLocalStoredDomain(domain) {
  const store = readLocalStateStore();
  const data = store?.data && typeof store.data === "object" ? store.data : store;
  return data?.[domain] || {};
}

function saveLocalDomain(domain, normalized = normalizedForDomain(domain)) {
  const store = readLocalStateStore();
  const next = store?.data && typeof store.data === "object"
    ? { ...store, data: { ...store.data } }
    : { version: 1, data: { ...(store || {}) } };
  next.version = next.version || 1;
  next.updatedAt = new Date().toISOString();
  const safeNormalized = domain === "timetable" ? normalizeTimetableDomain(normalized) : normalized;
  next.data[domain] = safeNormalized;
  if (writeLocalStateStore(next)) return;

  // localStorage는 브라우저별 용량 제한이 작습니다. 자동배치 보관본이 많이 쌓인 경우
  // 저장 실패와 UI 잠김처럼 보이는 현상이 생기므로, 시간표 도메인은 한 번 더 압축 저장을 시도합니다.
  if (domain === "timetable") {
    const retry = { ...next, data: { ...next.data } };
    const compact = normalizeTimetableDomain({ ...safeNormalized, savedSchedules: pruneSavedTimetableVersions((safeNormalized.savedSchedules || []).slice(0, 3)) });
    retry.data[domain] = compact;
    if (writeLocalStateStore(retry)) return;
  }
  throw new Error("localStorage 저장 실패: 브라우저 저장공간 한도를 초과했을 수 있습니다. 오래된 자동배치 보관본을 정리한 뒤 다시 시도해 주세요.");
}

function subscribeLocalDomains(domainList = ALL_DOMAINS) {
  const unique = [...new Set(domainList || [])].filter(d => DOMAIN_NORMALIZERS[d]);
  setSubscribedDomains(unique);
  unique.forEach(domain => {
    const normalized = DOMAIN_NORMALIZERS[domain](getLocalStoredDomain(domain));
    applyNormalizedDomain(domain, normalized);
  });
  if (!unique.length) queueMicrotask(() => fireUpdate("all"));
}

export function exportLocalSnapshot() {
  const store = readLocalStateStore();
  const storedData = store?.data && typeof store.data === "object" ? store.data : (store || {});
  const data = {};
  ALL_DOMAINS.forEach(domain => {
    // 현재 화면에서 아직 로드하지 않은 도메인은 appState의 기본 빈값으로 덮지 않고,
    // localStorage에 저장된 값을 그대로 보존해 내보냅니다.
    data[domain] = initialLoad[domain]
      ? normalizedForDomain(domain)
      : DOMAIN_NORMALIZERS[domain](storedData[domain] || {});
  });
  return {
    version: 1,
    mode: "his-local-dev",
    exportedAt: new Date().toISOString(),
    data
  };
}

export function importLocalSnapshot(payload) {
  const source = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  if (!source || typeof source !== "object") throw new Error("가져올 JSON 데이터가 올바르지 않습니다.");

  const data = {};
  ALL_DOMAINS.forEach(domain => {
    data[domain] = DOMAIN_NORMALIZERS[domain](source[domain] || {});
    appState[domain] = data[domain];
    markDomainSaved(domain, data[domain]);
    initialLoad[domain] = true;
  });
  writeLocalStateStore({ version: 1, mode: "his-local-dev", importedAt: new Date().toISOString(), data });
  dirtyDomains.clear();
  Object.keys(saveTimers).forEach(domain => { clearTimeout(saveTimers[domain]); delete saveTimers[domain]; });
  fireUpdate("all");
}


export function seedLocalSnapshotFromRuntime() {
  const store = readLocalStateStore();
  const storedData = store?.data && typeof store.data === "object" ? store.data : (store || {});
  const data = { ...(storedData || {}) };
  const seededDomains = [];

  ALL_DOMAINS.forEach(domain => {
    if (initialLoad[domain]) {
      data[domain] = normalizedForDomain(domain);
      seededDomains.push(domain);
    } else if (data[domain]) {
      data[domain] = DOMAIN_NORMALIZERS[domain](data[domain] || {});
    }
  });

  writeLocalStateStore({
    version: 1,
    mode: "his-local-dev",
    seededAt: new Date().toISOString(),
    seededDomains,
    data
  });
  return seededDomains;
}

export function resetLocalSnapshot() {
  clearLocalStateStore();
  ALL_DOMAINS.forEach(domain => {
    const normalized = DOMAIN_NORMALIZERS[domain]({});
    appState[domain] = normalized;
    markDomainSaved(domain, normalized);
    initialLoad[domain] = true;
  });
  dirtyDomains.clear();
  Object.keys(saveTimers).forEach(domain => { clearTimeout(saveTimers[domain]); delete saveTimers[domain]; });
  fireUpdate("all");
}


function jsonSafeClone(value) {
  const seen = new WeakSet();
  const convert = (v) => {
    if (v == null || typeof v !== "object") return v;
    if (typeof v.toDate === "function") {
      try { return v.toDate().toISOString(); } catch (_) {}
    }
    if (typeof v.toMillis === "function") {
      try { return new Date(v.toMillis()).toISOString(); } catch (_) {}
    }
    if (v instanceof Date) return v.toISOString();
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(convert);
    const out = {};
    Object.keys(v).sort().forEach(k => { out[k] = convert(v[k]); });
    return out;
  };
  return convert(value);
}

async function readDiagnosticDoc(label, ref) {
  try {
    const snap = await getDoc(ref);
    recordFirestoreUsage("reads", 1, label, { operation: "getDoc" });
    return {
      label,
      ok: true,
      exists: snap.exists(),
      data: snap.exists() ? jsonSafeClone(withoutFirestoreMeta(snap.data())) : null,
      error: null
    };
  } catch (e) {
    return { label, ok: false, exists: false, data: null, error: e?.message || String(e) };
  }
}

async function readDiagnosticCollection(label, collRef) {
  try {
    const snap = await getDocs(collRef);
    recordFirestoreUsage("reads", Math.max(1, snap.size || 0), label, { operation: "getDocs" });
    return {
      label,
      ok: true,
      count: snap.size,
      docs: snap.docs.map(d => ({ id: d.id, data: jsonSafeClone(withoutFirestoreMeta(d.data())) })),
      error: null
    };
  } catch (e) {
    return { label, ok: false, count: 0, docs: [], error: e?.message || String(e) };
  }
}

function buildNormalizedDiagnostic(raw) {
  const boards = raw?.boards || {};
  const split = raw?.split || {};
  const splitClassDocs = split.classes?.docs || [];
  const splitRosterDocs = split.rosters?.docs || [];
  const splitEntryDocs = split.timetableEntries?.docs || [];
  const splitTtCardDocs = split.ttcards?.docs || [];
  const splitMetaDoc = split.timetableMeta;

  const rostersRaw = { rosters: {}, rosterMeta: {} };
  splitRosterDocs.forEach(d => {
    const data = d.data || {};
    const templateId = clean(data.templateId) || d.id;
    rostersRaw.rosters[templateId] = Array.isArray(data.entries) ? data.entries : [];
    rostersRaw.rosterMeta[templateId] = data.meta || { classCount: "", missingExcluded: false };
  });

  const timetableRaw = {
    config: splitMetaDoc?.data?.config || {},
    teacherConstraints: splitMetaDoc?.data?.teacherConstraints || {},
    ttcardGroups: splitMetaDoc?.data?.ttcardGroups || splitMetaDoc?.data?.templateGroups || [],
    savedSchedules: splitMetaDoc?.data?.savedSchedules || [],
    cardGenerationMeta: splitMetaDoc?.data?.cardGenerationMeta || null,
    autoAssignMeta: splitMetaDoc?.data?.autoAssignMeta || null,
    bestAutoAssignSnapshot: splitMetaDoc?.data?.bestAutoAssignSnapshot || null,
    entries: splitEntryDocs.map(d => ({ id: d.id, ...(d.data || {}) })),
    ttcards: splitTtCardDocs.map(d => ({ id: d.id, ...(d.data || {}) })),
  };

  const normalized = {
    curriculum: normalizeCurriculumDomain(boards.curriculum?.data || {}),
    templates: normalizeTemplatesDomain(boards.templates?.data || {}),
    teachers: normalizeTeachersDomain(boards.teachers?.data || {}),
    rooms: normalizeRoomsDomain(boards.rooms?.data || {}),
    classes: splitClassDocs.length
      ? normalizeClassesDomain({ classes: splitClassDocs.map(d => ({ id: d.id, ...(d.data || {}) })) })
      : normalizeClassesDomain(boards.classesLegacy?.data || {}),
    rosters: splitRosterDocs.length
      ? normalizeRostersDomain(rostersRaw)
      : normalizeRostersDomain(boards.rostersLegacy?.data || {}),
    timetable: (splitEntryDocs.length || splitTtCardDocs.length || splitMetaDoc?.exists)
      ? normalizeTimetableDomain(timetableRaw)
      : normalizeTimetableDomain(boards.timetableLegacy?.data || {}),
  };
  return normalized;
}

function summarizeDiagnostic(normalized) {
  const classes = normalized.classes?.classes || [];
  const students = classes.reduce((sum, c) => sum + (Array.isArray(c.students) ? c.students.length : 0), 0);
  const rosters = normalized.rosters?.rosters || {};
  const rosterMeta = normalized.rosters?.rosterMeta || {};
  const rosterIds = uniqueOrdered([...Object.keys(rosters), ...Object.keys(rosterMeta)]);
  const zeroRosterIds = rosterIds.filter(id => (rosters[id] || []).length <= 0 && !rosterMeta[id]?.missingExcluded);
  return {
    curriculumGrades: Object.fromEntries(GRADE_KEYS.map(g => [g, (normalized.curriculum?.gradeBoards?.[g] || []).length])),
    templateCount: (normalized.templates?.templates || []).length,
    legacyTemplateGroupCount: (normalized.templates?.templateGroups || []).length,
    classCount: classes.length,
    studentCount: students,
    teacherCount: (normalized.teachers?.teachers || []).length,
    roomCount: (normalized.rooms?.rooms || []).length,
    roomTypeCount: (normalized.rooms?.roomTypes || []).length,
    rosterSubjectCount: rosterIds.length,
    zeroRosterSubjectCount: zeroRosterIds.length,
    zeroRosterSubjectIds: zeroRosterIds,
    timetableEntryCount: (normalized.timetable?.entries || []).length,
    ttcardCount: (normalized.timetable?.ttcards || []).length,
    ttcardGroupCount: (normalized.timetable?.ttcardGroups || []).length,
    timetablePeriodCount: normalized.timetable?.config?.periodCount || null,
  };
}

export async function exportFirestoreDiagnosticSnapshot() {
  if (LOCAL_DEV_MODE) {
    throw new Error("로컬 모드에서는 Firestore 진단 내보내기를 실행할 수 없습니다. 온라인 모드로 전환한 뒤 실행해 주세요.");
  }

  const [
    curriculumDoc, templatesDoc, classesLegacyDoc, teachersDoc,
    rostersLegacyDoc, roomsDoc, timetableLegacyDoc, legacyDoc,
    classesSplit, rostersSplit, timetableEntriesSplit, ttcardsSplit, timetableMetaDoc
  ] = await Promise.all([
    readDiagnosticDoc("boards/curriculum", refs.curriculum),
    readDiagnosticDoc("boards/templates", refs.templates),
    readDiagnosticDoc("boards/classes", refs.classes),
    readDiagnosticDoc("boards/teachers", refs.teachers),
    readDiagnosticDoc("boards/rosters", refs.rosters),
    readDiagnosticDoc("boards/rooms", refs.rooms),
    readDiagnosticDoc("boards/timetable", refs.timetable),
    readDiagnosticDoc("boards/main", refs.legacy),
    readDiagnosticCollection("boards/_split/classes", splitRefs.classes),
    readDiagnosticCollection("boards/_split/rosters", splitRefs.rosters),
    readDiagnosticCollection("boards/_split/timetableEntries", splitRefs.timetableEntries),
    readDiagnosticCollection("boards/_split/ttcards", splitRefs.ttcards),
    readDiagnosticDoc("boards/_split/timetableMeta/main", splitRefs.timetableMeta),
  ]);

  const raw = {
    boards: {
      curriculum: curriculumDoc,
      templates: templatesDoc,
      classesLegacy: classesLegacyDoc,
      teachers: teachersDoc,
      rostersLegacy: rostersLegacyDoc,
      rooms: roomsDoc,
      timetableLegacy: timetableLegacyDoc,
      legacy: legacyDoc,
    },
    split: {
      classes: classesSplit,
      rosters: rostersSplit,
      timetableEntries: timetableEntriesSplit,
      ttcards: ttcardsSplit,
      timetableMeta: timetableMetaDoc,
    }
  };

  const normalized = buildNormalizedDiagnostic(raw);
  return {
    version: 1,
    mode: "his-firestore-diagnostic",
    exportedAt: new Date().toISOString(),
    projectId: "his-curriculum-8e737",
    source: "Firestore direct read",
    note: "학생 이름 등 운영 데이터가 포함될 수 있습니다. 외부 공유 전 개인정보 범위를 확인해 주세요.",
    summary: summarizeDiagnostic(normalized),
    localRuntime: {
      dirtyDomains: getDirtyDomains(),
      initialLoad: { ...initialLoad },
      autoSave: isAutoSaveEnabled(),
      subscribedDomains: [..._subscribedDomains]
    },
    normalized,
    raw
  };
}

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
  // Firestore 실시간 업데이트에서 배열 길이만 비교하면,
  // 개수는 같고 내용만 바뀐 수정이 화면에 반영되지 않을 수 있습니다.
  // 도메인 문서의 updatedAt/createdAt 같은 메타값은 무시하되,
  // 배열과 중첩 객체의 실제 값은 끝까지 비교합니다.
  const seen = new WeakMap();
  const eq = (x, y) => {
    if (x === y) return true;
    if (x == null || y == null) return x === y;
    if (typeof x !== typeof y) return false;
    if (typeof x !== "object") return Object.is(x, y);

    if (seen.get(x) === y) return true;
    seen.set(x, y);

    if (Array.isArray(x) || Array.isArray(y)) {
      if (!Array.isArray(x) || !Array.isArray(y)) return false;
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) {
        if (!eq(x[i], y[i])) return false;
      }
      return true;
    }

    const skip = new Set(["updatedAt", "createdAt"]);
    const kx = Object.keys(x).filter(k => !skip.has(k)).sort();
    const ky = Object.keys(y).filter(k => !skip.has(k)).sort();
    if (kx.length !== ky.length) return false;
    for (let i = 0; i < kx.length; i++) {
      if (kx[i] !== ky[i]) return false;
      if (!eq(x[kx[i]], y[ky[i]])) return false;
    }
    return true;
  };
  try { return eq(a, b); }
  catch (_) { return false; }
}

function hasUnsavedLocalChanges(domain) {
  if (LOCAL_DEV_MODE) return false;
  if (!initialLoad[domain]) return false;
  if (!dirtyDomains.has(domain)) return false;
  // dirtyDomains can contain a domain even when the current data eventually
  // became identical to the saved baseline. Only protect truly changed data.
  return domainChanged(domain);
}

function shouldDeferRemoteApply(domain, normalized) {
  if (!hasUnsavedLocalChanges(domain)) return false;
  if (sameDomainData(appState[domain], normalized)) return false;
  return true;
}

function applyNormalizedDomain(domain, normalized) {
  if (domain === "classes") {
    const prev = appState.classes.classes || [];
    if (normalized.classes.length === 0 && prev.length > 0) normalized.classes = prev;
  }

  // 온라인 모드에서 드래그/편집 직후 자동저장 대기 중일 때,
  // Firestore 실시간 구독이 아직 저장 전의 원격 데이터를 다시 밀어 넣으면
  // 화면상 카드가 원래 자리로 튕겨 보입니다.
  // 사용자의 로컬 변경이 저장 대기 중이면 원격 스냅샷 적용을 잠시 보류합니다.
  // 저장이 완료되면 markDomainSaved + dirty 해제로 다시 원격 스냅샷을 정상 반영합니다.
  if (shouldDeferRemoteApply(domain, normalized)) {
    console.info(`[Firestore remote update deferred] ${domain}: unsaved local changes are pending.`);
    _onSaveStatus?.("dirty", { autoSave: isAutoSaveEnabled(), dirtyDomains: getDirtyDomains(), deferredRemote: domain });
    initialLoad[domain] = true;
    return;
  }

  if (initialLoad[domain] && sameDomainData(appState[domain], normalized)) {
    markDomainSaved(domain, normalized);
    initialLoad[domain] = true;
    return;
  }
  appState[domain] = normalized;
  markDomainSaved(domain, normalized);
  initialLoad[domain] = true;
  fireUpdate(domain);
}

function mapFromItems(items, toDocData) {
  const m = new Map();
  (items || []).forEach(item => {
    if (!item?.id) return;
    m.set(item.id, fp(toDocData(item)));
  });
  return m;
}

function markSplitBaselines(domain, normalized = normalizedForDomain(domain)) {
  if (domain === "classes") {
    splitDocFingerprints.classes.classes = mapFromItems(
      normalizeClassesDomain(normalized).classes,
      item => item
    );
    return;
  }

  if (domain === "rosters") {
    const n = normalizeRostersDomain(normalized);
    const ids = uniqueOrdered([
      ...Object.keys(n.rosters || {}),
      ...Object.keys(n.rosterMeta || {})
    ].filter(Boolean));
    const docs = ids.map(id => ({
      id,
      templateId: id,
      entries: n.rosters[id] || [],
      meta: n.rosterMeta[id] || { classCount: "", missingExcluded: false }
    }));
    splitDocFingerprints.rosters.rosters = mapFromItems(docs, item => ({
      templateId: item.templateId,
      entries: item.entries || [],
      meta: item.meta || { classCount: "", missingExcluded: false }
    }));
    return;
  }

  if (domain === "timetable") {
    const n = normalizeTimetableDomain(normalized);
    splitDocFingerprints.timetable.timetableEntries = mapFromItems(n.entries, item => item);
    splitDocFingerprints.timetable.ttcards = mapFromItems(n.ttcards, item => item);
    splitDocFingerprints.timetable.timetableMeta = fp({
      config: n.config,
      teacherConstraints: n.teacherConstraints,
      ttcardGroups: n.ttcardGroups || [],
      savedSchedules: n.savedSchedules || [],
      cardGenerationMeta: n.cardGenerationMeta || null,
      autoAssignMeta: n.autoAssignMeta || null,
      bestAutoAssignSnapshot: n.bestAutoAssignSnapshot || null
    });
  }
}

async function commitChangedCollection(collKey, collRef, items, toDocData, options = {}) {
  const baseline = splitDocFingerprints[collKey.domain]?.[collKey.name] || new Map();
  const current = new Map();
  const ops = [];

  (items || []).forEach(item => {
    if (!item?.id) return;
    const data = toDocData(item);
    const hash = fp(data);
    current.set(item.id, hash);
    if (options.force || baseline.get(item.id) !== hash) {
      ops.push({
        type: "set",
        ref: doc(collRef, item.id),
        data: { ...data, updatedAt: serverTimestamp() },
        options: { merge: false }
      });
    }
  });

  baseline.forEach((_, id) => {
    if (!current.has(id)) ops.push({ type: "delete", ref: doc(collRef, id) });
  });

  if (ops.length) await commitWriteOps(ops);
  splitDocFingerprints[collKey.domain][collKey.name] = current;
  return ops.length;
}

async function commitChangedDoc(baselinePath, ref, data, options = {}) {
  const hash = fp(data);
  const current = baselinePath.reduce((obj, key) => obj?.[key], splitDocFingerprints);
  if (!options.force && current === hash) return 0;
  await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: false });
  recordFirestoreUsage("writes", 1, `save: ${baselinePath.join("/")}`, { operation: "setDoc" });
  if (baselinePath.length === 2) splitDocFingerprints[baselinePath[0]][baselinePath[1]] = hash;
  return 1;
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
    const slice = ops.slice(i, i + CHUNK_SIZE);
    const writes = slice.filter(op => op.type === "set").length;
    const deletes = slice.filter(op => op.type === "delete").length;
    if (writes) recordFirestoreUsage("writes", writes, "batch set", { operation: "writeBatch" });
    if (deletes) recordFirestoreUsage("deletes", deletes, "batch delete", { operation: "writeBatch" });
  }
}

async function syncCollection(collRef, items, toDocData) {
  const snap = await getDocs(collRef);
  recordFirestoreUsage("reads", Math.max(1, snap.size || 0), "syncCollection existing docs", { operation: "getDocs" });
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

async function saveSplitDomain(domain, options = {}) {
  if (domain === "classes") {
    const classes = normalizeClassesDomain(options.normalized || appState.classes).classes;
    const writes = await commitChangedCollection(
      { domain: "classes", name: "classes" },
      splitRefs.classes,
      classes,
      item => item,
      options
    );
    console.info(`[Firestore save] classes split writes: ${writes}`);
    return;
  }

  if (domain === "rosters") {
    const normalized = normalizeRostersDomain(options.normalized || appState.rosters);
    const ids = uniqueOrdered([
      ...Object.keys(normalized.rosters || {}),
      ...Object.keys(normalized.rosterMeta || {})
    ].filter(Boolean));
    const docs = ids.map(id => ({
      id,
      templateId: id,
      entries: normalized.rosters[id] || [],
      meta: normalized.rosterMeta[id] || { classCount: "", missingExcluded: false }
    }));
    const writes = await commitChangedCollection(
      { domain: "rosters", name: "rosters" },
      splitRefs.rosters,
      docs,
      item => ({
        templateId: item.templateId,
        entries: item.entries || [],
        meta: item.meta || { classCount: "", missingExcluded: false }
      }),
      options
    );
    console.info(`[Firestore save] rosters split writes: ${writes}`);
    return;
  }

  if (domain === "timetable") {
    const normalized = normalizeTimetableDomain(options.normalized || appState.timetable);
    const entryWrites = await commitChangedCollection(
      { domain: "timetable", name: "timetableEntries" },
      splitRefs.timetableEntries,
      normalized.entries,
      item => item,
      options
    );
    const cardWrites = await commitChangedCollection(
      { domain: "timetable", name: "ttcards" },
      splitRefs.ttcards,
      normalized.ttcards,
      item => item,
      options
    );
    const metaWrites = await commitChangedDoc(
      ["timetable", "timetableMeta"],
      splitRefs.timetableMeta,
      {
        config: normalized.config,
        teacherConstraints: normalized.teacherConstraints,
        ttcardGroups: normalized.ttcardGroups || [],
        savedSchedules: normalized.savedSchedules || [],
        cardGenerationMeta: normalized.cardGenerationMeta || null,
        autoAssignMeta: normalized.autoAssignMeta || null,
        bestAutoAssignSnapshot: normalized.bestAutoAssignSnapshot || null
      },
      options
    );
    console.info(`[Firestore save] timetable split writes: entries ${entryWrites}, cards ${cardWrites}, meta ${metaWrites}`);
  }
}

async function loadLegacyDomainFallback(domain, normalizeFn, options = {}) {
  try {
    const snap = await getDoc(refs[domain]);
    recordFirestoreUsage("reads", 1, `legacy fallback: boards/${domain}`, { operation: "getDoc" });
    if (!snap.exists()) return false;
    const normalized = normalizeFn(snap.data());
    const hasData = options.hasData ? options.hasData(normalized) : true;
    if (!hasData) return false;
    applyNormalizedDomain(domain, normalized);
    // One-time forward migration from old one-document storage to split collections.
    // Skip if this domain is already in legacy fallback mode because subcollection access failed.
    if (canEdit() && SPLIT_COLLECTION_DOMAINS.has(domain) && !splitUnavailableDomains.has(domain)) {
      await saveSplitDomain(domain, { force: true, normalized });
    }
    return true;
  } catch (e) {
    console.warn(`Legacy ${domain} fallback skipped.`, e);
    return false;
  }
}

// Snapshot handlers per ordinary one-document domain
function handleSnap(domain, normalizeFn) {
  const usageState = { seen: false };
  return async (snap) => {
    recordDocSnapshotUsage(`listen: boards/${domain}`, snap, usageState);
    if (!snap.exists()) {
      const normalized = normalizeFn({});
      appState[domain] = normalized;
      markDomainSaved(domain, normalized);
      initialLoad[domain] = true;
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
      (appState.timetable?.ttcardGroups || []).length > 0 ||
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
// 시간표 편집 화면은 커리큘럼/템플릿 원본을 실시간 구독하지 않습니다.
// 시간표는 appState.timetable.ttcards 및 appState.timetable.ttcardGroups에 저장된 스냅샷 기준으로 동작합니다.
export const TIMETABLE_CORE_DOMAINS = ["classes", "rosters", "timetable"];
export const TIMETABLE_OPTIONAL_DOMAINS = ["rooms"];

export function isDomainSubscribed(domain) {
  return !!unsubs[domain];
}

function subscribeClassesSplit() {
  const usageState = { seen: false };
  unsubs.classes = onSnapshot(splitRefs.classes, async snap => {
    recordCollectionSnapshotUsage("listen: split/classes", snap, usageState);
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
  const usageState = { seen: false };
  unsubs.rosters = onSnapshot(splitRefs.rosters, async snap => {
    recordCollectionSnapshotUsage("listen: split/rosters", snap, usageState);
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
      raw.rosterMeta[templateId] = data.meta || { classCount: "", missingExcluded: false };
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

let legacyTemplateGroupMigrationAttempted = false;
async function loadLegacyTemplateGroupsForTimetable() {
  if (legacyTemplateGroupMigrationAttempted) return [];
  legacyTemplateGroupMigrationAttempted = true;
  try {
    const snap = await getDoc(refs.templates);
    if (!snap.exists()) return [];
    const rawGroups = snap.data()?.templateGroups;
    return Array.isArray(rawGroups)
      ? rawGroups.map(normalizeTemplateGroup).filter(g => g.name)
      : [];
  } catch (e) {
    console.warn("Legacy templateGroups migration skipped.", e);
    return [];
  }
}

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
      hasData: d => (d.entries || []).length > 0 || (d.ttcards || []).length > 0 || (d.ttcardGroups || []).length > 0 || (d.savedSchedules || []).length > 0 || Object.keys(d.teacherConstraints || {}).length > 0
    });
    if (migrated) return;
  }

  if (!hasSplitData && (splitFallbackAttempted.timetable || splitConfirmed.has("timetable")) && domainHasData("timetable")) return;

  const raw = {
    config: timetableSplitCache.meta?.config || {},
    teacherConstraints: timetableSplitCache.meta?.teacherConstraints || {},
    ttcardGroups: timetableSplitCache.meta?.ttcardGroups || timetableSplitCache.meta?.templateGroups || [],
    savedSchedules: timetableSplitCache.meta?.savedSchedules || [],
    cardGenerationMeta: timetableSplitCache.meta?.cardGenerationMeta || null,
    autoAssignMeta: timetableSplitCache.meta?.autoAssignMeta || null,
    bestAutoAssignSnapshot: timetableSplitCache.meta?.bestAutoAssignSnapshot || null,
    entries: timetableSplitCache.entries,
    ttcards: timetableSplitCache.ttcards,
  };

  // 기존 운영 데이터는 그룹 정보가 templates.templateGroups에만 있을 수 있습니다.
  // 시간표 화면에서는 templates를 실시간 구독하지 않으므로, 최초 1회만 읽어 timetable.ttcardGroups로 이관합니다.
  if (!raw.ttcardGroups.length) {
    const currentGroups = appState.timetable?.ttcardGroups || [];
    if (currentGroups.length) {
      raw.ttcardGroups = currentGroups;
    } else {
      const legacyGroups = await loadLegacyTemplateGroupsForTimetable();
      if (legacyGroups.length) raw.ttcardGroups = legacyGroups;
    }
  }

  applyNormalizedDomain("timetable", normalizeTimetableDomain(raw));

  // 편집 권한이 있으면 이관한 그룹을 새 위치에 저장해 다음부터는 templates를 읽지 않습니다.
  if (canEdit() && raw.ttcardGroups.length && !(timetableSplitCache.meta?.ttcardGroups || []).length) {
    try { await saveSplitDomain("timetable", { force: true }); } catch (e) { console.warn("Timetable group migration save skipped.", e); }
  }
}

function subscribeTimetableSplit() {
  const onSplitError = err => fallbackToLegacyDocument("timetable", normalizeTimetableDomain, err);
  const entriesUsage = { seen: false };
  const cardsUsage = { seen: false };
  const metaUsage = { seen: false };

  const unsubEntries = onSnapshot(splitRefs.timetableEntries, snap => {
    recordCollectionSnapshotUsage("listen: split/timetableEntries", snap, entriesUsage);
    timetableSplitCache.entries = snap.docs.map(d => normalizeTimetableEntry({ id: d.id, ...withoutFirestoreMeta(d.data()) }));
    applyTimetableSplitIfReady();
  }, onSplitError);

  const unsubCards = onSnapshot(splitRefs.ttcards, snap => {
    recordCollectionSnapshotUsage("listen: split/ttcards", snap, cardsUsage);
    timetableSplitCache.ttcards = snap.docs.map(d => normalizeTtCard({ id: d.id, ...withoutFirestoreMeta(d.data()) }));
    applyTimetableSplitIfReady();
  }, onSplitError);

  const unsubMeta = onSnapshot(splitRefs.timetableMeta, snap => {
    recordDocSnapshotUsage("listen: split/timetableMeta", snap, metaUsage);
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
  if (LOCAL_DEV_MODE) {
    subscribeLocalDomains(domainList);
    return;
  }

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
  if (LOCAL_DEV_MODE) return;
  // ① localStorage 캐시 — 이미 완료된 경우 Firestore 왕복 없이 즉시 반환
  const MIGRATE_KEY = "his_migrated_v2";
  if (localStorage.getItem(MIGRATE_KEY) === "done") return;

  let legacySnap = null;
  try {
    legacySnap = await getDoc(refs.legacy);
    recordFirestoreUsage("reads", 1, "legacy migration: boards/main", { operation: "getDoc" });
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
      try { const snap = await getDoc(refs[domain]); recordFirestoreUsage("reads", 1, `migration check: boards/${domain}`, { operation: "getDoc" }); return snap; }
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
    recordFirestoreUsage("writes", missingTargets.length, "legacy migration writes", { operation: "setDoc" });
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
