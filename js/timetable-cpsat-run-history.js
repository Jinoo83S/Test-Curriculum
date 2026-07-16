// ================================================================
// timetable-cpsat-run-history.js · CP-SAT execution timing/history
// ================================================================
// Local-only operational diagnostics. No timetable/student data is stored.

export const CP_SAT_RUN_HISTORY_SCHEMA_VERSION = 1;
export const CP_SAT_RUN_HISTORY_LIMIT = 10;
export const CP_SAT_RUN_HISTORY_STORAGE_KEY = "his_cpsat_run_history_v1";
export const CP_SAT_FIRESTORE_DATA_OP_LIMIT = 498;

const clean = value => String(value ?? "").trim();
const numberOrNull = value => Number.isFinite(Number(value)) ? Number(value) : null;
const clampNonNegative = value => {
  const number = numberOrNull(value);
  return number == null ? null : Math.max(0, number);
};

function storageOrNull(storage) {
  if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") return storage;
  try {
    if (globalThis.localStorage && typeof globalThis.localStorage.getItem === "function") return globalThis.localStorage;
  } catch (_) {}
  return null;
}

function normalizeObject(value) {
  const seen = new WeakSet();
  const walk = input => {
    if (input == null || typeof input !== "object") return input;
    if (input instanceof Date) return input.toISOString();
    if (seen.has(input)) return null;
    seen.add(input);
    if (Array.isArray(input)) return input.map(walk);
    const output = {};
    Object.keys(input)
      .filter(key => key !== "updatedAt" && key !== "createdAt")
      .sort()
      .forEach(key => { output[key] = walk(input[key]); });
    return output;
  };
  return walk(value);
}

export function stableCpSatEntryFingerprint(value) {
  return JSON.stringify(normalizeObject(value));
}

function entryMap(entries = []) {
  const map = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const id = clean(entry?.id);
    if (id) map.set(id, entry);
  }
  return map;
}

export function estimateCpSatSaveOperations({ currentEntries = [], nextEntries = [] } = {}) {
  const current = entryMap(currentEntries);
  const next = entryMap(nextEntries);
  let created = 0;
  let changed = 0;
  let unchanged = 0;
  let deleted = 0;

  next.forEach((entry, id) => {
    if (!current.has(id)) {
      created += 1;
      return;
    }
    const before = stableCpSatEntryFingerprint(current.get(id));
    const after = stableCpSatEntryFingerprint(entry);
    if (before === after) unchanged += 1;
    else changed += 1;
  });
  current.forEach((_, id) => {
    if (!next.has(id)) deleted += 1;
  });

  const dataOps = created + changed + deleted;
  const totalWrites = dataOps > 0 ? dataOps + 2 : 0; // timetable meta + revision snapshot
  return {
    currentCount: current.size,
    nextCount: next.size,
    created,
    changed,
    unchanged,
    deleted,
    dataOps,
    totalWrites,
    dataOpLimit: CP_SAT_FIRESTORE_DATA_OP_LIMIT,
    firestoreBatchLimit: CP_SAT_FIRESTORE_DATA_OP_LIMIT + 2,
    withinLimit: dataOps <= CP_SAT_FIRESTORE_DATA_OP_LIMIT && totalWrites <= CP_SAT_FIRESTORE_DATA_OP_LIMIT + 2,
  };
}

export function formatCpSatDuration(value, { unit = "ms", digits = 0 } = {}) {
  const raw = numberOrNull(value);
  if (raw == null) return "-";
  const ms = unit === "seconds" ? raw * 1000 : raw;
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}분`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(ms >= 10_000 ? 1 : 2)}초`;
  return `${ms.toFixed(Math.max(0, digits))}ms`;
}

export function extractCpSatServerTiming(result = {}) {
  const timing = result?.timing && typeof result.timing === "object" ? result.timing : {};
  const meta = result?.meta && typeof result.meta === "object" ? result.meta : {};
  const twoPhase = meta?.twoPhase && typeof meta.twoPhase === "object" ? meta.twoPhase : {};
  const phase1Seconds = numberOrNull(twoPhase.phase1WallTimeSeconds);
  const phase2Seconds = numberOrNull(twoPhase.phase2WallTimeSeconds);
  const solveMs = clampNonNegative(timing.solveMs)
    ?? clampNonNegative(meta.solverTimingMsCombined)
    ?? ((phase1Seconds || phase2Seconds) ? Math.max(0, (phase1Seconds || 0) + (phase2Seconds || 0)) * 1000 : null);
  const inferredQuickComplete = typeof meta.quickComplete === "boolean"
    ? meta.quickComplete
    : (/quick/i.test(clean(twoPhase.mode)) || clean(twoPhase.phase2Status).toUpperCase() === "SKIPPED");
  return {
    totalMs: clampNonNegative(timing.totalMs) ?? (numberOrNull(result?.elapsedSeconds) != null ? Math.max(0, Number(result.elapsedSeconds)) * 1000 : null),
    privacyNormalizeMs: clampNonNegative(timing.privacyNormalizeMs),
    modelBuildMs: clampNonNegative(timing.modelBuildMs),
    solveMs,
    validationMs: clampNonNegative(timing.validationMs),
    responsePrepareMs: clampNonNegative(timing.responsePrepareMs),
    phase1Ms: phase1Seconds == null ? null : Math.max(0, phase1Seconds) * 1000,
    phase2Ms: phase2Seconds == null ? null : Math.max(0, phase2Seconds) * 1000,
    phase1Status: clean(twoPhase.phase1Status),
    phase2Status: clean(twoPhase.phase2Status),
    mode: clean(twoPhase.mode),
    quickComplete: inferredQuickComplete,
  };
}

function sanitizeTiming(timing = {}) {
  const output = {};
  for (const key of [
    "payloadBuildMs", "preflightMs", "requestStartMs", "pollingMs", "resultAuditMs",
    "clientTotalMs", "applyValidationMs", "applySaveMs", "applyTotalMs",
    "serverTotalMs", "privacyNormalizeMs", "modelBuildMs", "solveMs", "validationMs",
    "responsePrepareMs", "phase1Ms", "phase2Ms",
  ]) {
    const value = clampNonNegative(timing?.[key]);
    if (value != null) output[key] = Math.round(value * 10) / 10;
  }
  return output;
}

function sanitizeSaveEstimate(value = {}) {
  const output = {};
  for (const key of [
    "currentCount", "nextCount", "created", "changed", "unchanged", "deleted",
    "dataOps", "totalWrites", "dataOpLimit", "firestoreBatchLimit",
  ]) {
    const number = numberOrNull(value?.[key]);
    if (number != null) output[key] = Math.max(0, Math.trunc(number));
  }
  output.withinLimit = value?.withinLimit !== false;
  if (numberOrNull(value?.reused) != null) output.reused = Math.max(0, Math.trunc(Number(value.reused)));
  if (numberOrNull(value?.newIds) != null) output.newIds = Math.max(0, Math.trunc(Number(value.newIds)));
  return output;
}

function sanitizeCounts(value = {}) {
  const output = {};
  for (const key of ["cards", "groups", "entries", "resultEntries", "occurrences", "classes", "teachers", "rooms"]) {
    const number = numberOrNull(value?.[key]);
    if (number != null) output[key] = Math.max(0, Math.trunc(number));
  }
  return output;
}

export function sanitizeCpSatRunRecord(record = {}) {
  const startedAt = clean(record.startedAt) || new Date().toISOString();
  const id = clean(record.id) || `cpsat-run-${startedAt.replace(/[^0-9]/g, "").slice(0, 17)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    schemaVersion: CP_SAT_RUN_HISTORY_SCHEMA_VERSION,
    id,
    startedAt,
    finishedAt: clean(record.finishedAt) || null,
    appliedAt: clean(record.appliedAt) || null,
    status: clean(record.status) || "running",
    title: clean(record.title) || "CP-SAT 실행",
    reason: clean(record.reason),
    jobId: clean(record.jobId),
    serverVersion: clean(record.serverVersion),
    quickComplete: record.quickComplete !== false,
    timeLimitSeconds: Math.max(0, Math.trunc(numberOrNull(record.timeLimitSeconds) || 0)),
    workers: Math.max(0, Math.trunc(numberOrNull(record.workers) || 0)),
    timing: sanitizeTiming(record.timing),
    serverTiming: {
      totalMs: clampNonNegative(record?.serverTiming?.totalMs ?? record?.serverTiming?.serverTotalMs),
      privacyNormalizeMs: clampNonNegative(record?.serverTiming?.privacyNormalizeMs),
      modelBuildMs: clampNonNegative(record?.serverTiming?.modelBuildMs),
      solveMs: clampNonNegative(record?.serverTiming?.solveMs),
      validationMs: clampNonNegative(record?.serverTiming?.validationMs),
      responsePrepareMs: clampNonNegative(record?.serverTiming?.responsePrepareMs),
      phase1Ms: clampNonNegative(record?.serverTiming?.phase1Ms),
      phase2Ms: clampNonNegative(record?.serverTiming?.phase2Ms),
      phase1Status: clean(record?.serverTiming?.phase1Status),
      phase2Status: clean(record?.serverTiming?.phase2Status),
      mode: clean(record?.serverTiming?.mode),
      quickComplete: record?.serverTiming?.quickComplete !== false,
    },
    counts: sanitizeCounts(record.counts),
    saveEstimate: sanitizeSaveEstimate(record.saveEstimate),
    applied: record.applied === true,
    saved: record.saved === true,
    error: clean(record.error).slice(0, 600),
  };
}

export function readCpSatRunHistory(storage = null) {
  const target = storageOrNull(storage);
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(CP_SAT_RUN_HISTORY_STORAGE_KEY) || "[]");
    return (Array.isArray(parsed) ? parsed : [])
      .map(sanitizeCpSatRunRecord)
      .sort((a, b) => clean(b.startedAt).localeCompare(clean(a.startedAt)))
      .slice(0, CP_SAT_RUN_HISTORY_LIMIT);
  } catch (_) {
    return [];
  }
}

export function writeCpSatRunHistory(records = [], storage = null) {
  const target = storageOrNull(storage);
  const sanitized = (Array.isArray(records) ? records : [])
    .map(sanitizeCpSatRunRecord)
    .sort((a, b) => clean(b.startedAt).localeCompare(clean(a.startedAt)))
    .slice(0, CP_SAT_RUN_HISTORY_LIMIT);
  if (!target) return sanitized;
  try { target.setItem(CP_SAT_RUN_HISTORY_STORAGE_KEY, JSON.stringify(sanitized)); } catch (_) {}
  return sanitized;
}

export function upsertCpSatRunHistory(record = {}, storage = null) {
  const next = sanitizeCpSatRunRecord(record);
  const list = readCpSatRunHistory(storage).filter(item => item.id !== next.id);
  list.unshift(next);
  return writeCpSatRunHistory(list, storage);
}

export function clearCpSatRunHistory(storage = null) {
  const target = storageOrNull(storage);
  if (!target) return [];
  try { target.removeItem(CP_SAT_RUN_HISTORY_STORAGE_KEY); } catch (_) {}
  return [];
}
