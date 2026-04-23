// ================================================================
// state.js · Shared Application State + Firestore Sync
// ================================================================
import { refs, GRADE_KEYS, DEFAULT_OPTIONS, DEFAULT_ROW_COUNT, colWidthsKey, DEFAULT_COL_WIDTHS } from "./config.js";
import { uid, clean, uniqueOrdered, parseCreditValue } from "./utils.js";
import { canEdit } from "./auth.js";
import {
  setDoc, onSnapshot, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Drag state (shared between board & group manager) ─────────────
export let currentDrag = null;
export const setCurrentDrag = (v) => { currentDrag = v; };

// ── Load flags: never save before initial load ────────────────────
export const initialLoad = {
  curriculum: false, templates: false,
  classes: false, teachers: false, rosters: false
};

// ── Per-domain save timers ────────────────────────────────────────
const saveTimers = {};

export function scheduleSave(domain) {
  if (!canEdit() || !initialLoad[domain]) return;
  clearTimeout(saveTimers[domain]);
  saveTimers[domain] = setTimeout(() => saveNow(domain), 300);
}

export async function saveNow(domain) {
  if (!canEdit() || !initialLoad[domain]) return;
  try {
    await setDoc(refs[domain], { ...appState[domain], updatedAt: serverTimestamp() });
  } catch (e) {
    console.error(`Save failed [${domain}]:`, e);
  }
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
export function normalizeTemplateGroup(item = {}) {
  const validTypes = ["concurrent", "cross-grade"];
  return {
    id: item.id || uid("grp"),
    name: clean(item.name),
    creditValue: clean(item.creditValue),
    groupType: validTypes.includes(item.groupType) ? item.groupType : "concurrent"
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

// ================================================================
// APPLICATION STATE
// ================================================================
export const appState = {
  curriculum: normalizeCurriculumDomain({}),
  templates:  normalizeTemplatesDomain({}),
  classes:    normalizeClassesDomain({}),
  teachers:   normalizeTeachersDomain({}),
  rosters:    normalizeRostersDomain({}),
};

// Ensure consistency (re-normalize in place)
export function ensureConsistency(domain) {
  if (domain === "curriculum") appState.curriculum = normalizeCurriculumDomain(appState.curriculum);
  if (domain === "templates")  appState.templates  = normalizeTemplatesDomain(appState.templates);
  if (domain === "classes")    appState.classes    = normalizeClassesDomain(appState.classes);
  if (domain === "teachers")   appState.teachers   = normalizeTeachersDomain(appState.teachers);
  if (domain === "rosters")    appState.rosters    = normalizeRostersDomain(appState.rosters);
}

// ================================================================
// FIRESTORE SUBSCRIPTIONS
// ================================================================
// Render callback — set by app.js
let _onUpdate = () => {};
export function setOnUpdate(fn) { _onUpdate = fn; }

// Snapshot handlers per domain
function handleSnap(domain, normalizeFn) {
  return async (snap) => {
    if (!snap.exists()) {
      // New doc — save default state
      initialLoad[domain] = true;
      await saveNow(domain);
      _onUpdate(domain);
      return;
    }
    const data = snap.data();
    // Preserve in-memory classes if Firestore returns empty (race condition guard)
    if (domain === "classes") {
      const prev = appState.classes.classes || [];
      appState.classes = normalizeFn(data);
      if (appState.classes.classes.length === 0 && prev.length > 0) appState.classes.classes = prev;
    } else {
      appState[domain] = normalizeFn(data);
    }
    initialLoad[domain] = true;
    _onUpdate(domain);
  };
}

const unsubs = {};

export function subscribeAll() {
  const domains = {
    curriculum: normalizeCurriculumDomain,
    templates:  normalizeTemplatesDomain,
    classes:    normalizeClassesDomain,
    teachers:   normalizeTeachersDomain,
    rosters:    normalizeRostersDomain,
  };
  Object.entries(domains).forEach(([domain, fn]) => {
    if (unsubs[domain]) unsubs[domain]();
    unsubs[domain] = onSnapshot(refs[domain], handleSnap(domain, fn), err => console.error(domain, err));
  });
}

export function unsubscribeAll() {
  Object.values(unsubs).forEach(u => u && u());
}

// ================================================================
// DATA MIGRATION: old boards/main → new separate docs
// ================================================================
export async function migrateFromLegacy() {
  // Check if curriculum already exists in new format
  const currSnap = await getDoc(refs.curriculum);
  if (currSnap.exists()) return;  // Already migrated

  // Try to load from legacy boards/main
  const legacySnap = await getDoc(refs.legacy);
  if (!legacySnap.exists()) return;  // No legacy data

  console.log("Migrating legacy data to separate collections...");
  const legacy = legacySnap.data().state || {};

  // Migrate curriculum
  const curriculum = normalizeCurriculumDomain(legacy);
  await setDoc(refs.curriculum, { ...curriculum, updatedAt: serverTimestamp() });

  // Migrate templates
  const templates = normalizeTemplatesDomain(legacy);
  await setDoc(refs.templates, { ...templates, updatedAt: serverTimestamp() });

  // Migrate classes
  const classes = normalizeClassesDomain(legacy);
  await setDoc(refs.classes, { ...classes, updatedAt: serverTimestamp() });

  console.log("Migration complete.");
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
