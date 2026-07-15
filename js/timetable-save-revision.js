 // ================================================================
// timetable-save-revision.js · Atomic timetable save planning
// ================================================================

export const TIMETABLE_REVISION_SCHEMA_VERSION = 1;
export const FIRESTORE_BATCH_WRITE_LIMIT = 500;
// One timetable save reserves one write for timetableMeta and one for the
// immutable save-revision manifest. The remaining writes are entry/card sets
// and deletes. If this limit is exceeded, the save is rejected before any
// Firestore write starts so the current operating timetable cannot be left in
// a half-written state.
export const TIMETABLE_ATOMIC_DATA_OP_LIMIT = FIRESTORE_BATCH_WRITE_LIMIT - 2;

export const TIMETABLE_REVISION_HISTORY_SLOTS = 30;

export function getTimetableRevisionHistorySlot(revisionId, slotCount = TIMETABLE_REVISION_HISTORY_SLOTS) {
  const count = Math.max(1, Math.min(100, Number.parseInt(slotCount, 10) || TIMETABLE_REVISION_HISTORY_SLOTS));
  const text = String(revisionId || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % count;
}

function safeIdPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function createTimetableSaveRevisionId({ now = new Date(), random = Math.random() } = {}) {
  const iso = now instanceof Date && !Number.isNaN(now.getTime())
    ? now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 17)
    : new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
  const suffix = safeIdPart(Math.floor(Math.max(0, Math.min(0.999999999, Number(random) || 0)) * 0xFFFFFF).toString(36).padStart(5, "0"));
  return `ttrev-${iso}-${suffix || "00000"}`;
}

export function buildCollectionRevisionPlan({
  baseline,
  items = [],
  toDocData = item => item,
  fingerprint = value => JSON.stringify(value),
  rewriteAll = false,
} = {}) {
  const previous = baseline instanceof Map ? baseline : new Map();
  const current = new Map();
  const sets = [];
  const deletes = [];

  for (const item of Array.isArray(items) ? items : []) {
    const id = String(item?.id || "").trim();
    if (!id) continue;
    const data = toDocData(item);
    const hash = fingerprint(data);
    current.set(id, hash);
    if (rewriteAll || previous.get(id) !== hash) sets.push({ id, data, hash });
  }

  previous.forEach((_, id) => {
    if (!current.has(id)) deletes.push({ id: String(id) });
  });

  return {
    current,
    sets,
    deletes,
    setCount: sets.length,
    deleteCount: deletes.length,
    opCount: sets.length + deletes.length,
  };
}

export function summarizeTimetableRevisionPlan({ entryPlan, cardPlan, metaChanged = false } = {}) {
  const entrySets = Number(entryPlan?.setCount || 0);
  const entryDeletes = Number(entryPlan?.deleteCount || 0);
  const cardSets = Number(cardPlan?.setCount || 0);
  const cardDeletes = Number(cardPlan?.deleteCount || 0);
  const dataOps = entrySets + entryDeletes + cardSets + cardDeletes;
  const hasChanges = dataOps > 0 || metaChanged === true;
  const totalWrites = hasChanges ? dataOps + 2 : 0;
  return {
    hasChanges,
    dataOps,
    totalWrites,
    entrySets,
    entryDeletes,
    cardSets,
    cardDeletes,
    metaChanged: metaChanged === true,
  };
}

export function assertAtomicTimetableRevisionCapacity(summary = {}) {
  const dataOps = Number(summary.dataOps || 0);
  const totalWrites = Number(summary.totalWrites || 0);
  if (dataOps <= TIMETABLE_ATOMIC_DATA_OP_LIMIT && totalWrites <= FIRESTORE_BATCH_WRITE_LIMIT) return summary;

  const error = new Error(
    `시간표 변경량이 원자적 저장 한도(${TIMETABLE_ATOMIC_DATA_OP_LIMIT}건)를 초과하여 저장하지 않았습니다. ` +
    `현재 변경 ${dataOps}건(배치 설정 ${Number(summary.entrySets || 0)}, 배치 삭제 ${Number(summary.entryDeletes || 0)}, ` +
    `카드 설정 ${Number(summary.cardSets || 0)}, 카드 삭제 ${Number(summary.cardDeletes || 0)})입니다. ` +
    `현재 운영본을 부분 저장으로 손상시키지 않기 위해 모든 Firestore 쓰기를 시작 전에 차단했습니다.`
  );
  error.code = "timetable-atomic-write-limit";
  error.summary = { ...summary };
  throw error;
}
