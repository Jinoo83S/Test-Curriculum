// ================================================================
// timetable-save-revision.js · Atomic timetable save + snapshots
// ================================================================

export const TIMETABLE_REVISION_SCHEMA_VERSION = 2;
export const TIMETABLE_SNAPSHOT_SCHEMA_VERSION = 1;
export const FIRESTORE_BATCH_WRITE_LIMIT = 500;
// One timetable save reserves one write for timetableMeta and one for the
// revision document. The revision document contains a compressed full
// timetable snapshot, so no extra Firestore document is required.
export const TIMETABLE_ATOMIC_DATA_OP_LIMIT = FIRESTORE_BATCH_WRITE_LIMIT - 2;
export const TIMETABLE_REVISION_HISTORY_SLOTS = 30;
// Firestore documents have a 1 MiB hard limit. Keep the base64 payload far
// below that ceiling to leave room for manifest fields and indexes.
export const TIMETABLE_REVISION_MAX_PAYLOAD_BYTES = 820_000;

export function getTimetableRevisionHistorySlot(revisionId, slotCount = TIMETABLE_REVISION_HISTORY_SLOTS) {
  const count = Math.max(1, Math.min(100, Number.parseInt(slotCount, 10) || TIMETABLE_REVISION_HISTORY_SLOTS));
  const text = String(revisionId || "");
  const explicit = text.match(/-s(\d{2})$/i);
  if (explicit) return Number.parseInt(explicit[1], 10) % count;
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

export function createTimetableSaveRevisionId({ now = new Date(), random = Math.random(), slot = null } = {}) {
  const iso = now instanceof Date && !Number.isNaN(now.getTime())
    ? now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 17)
    : new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
  const suffix = safeIdPart(Math.floor(Math.max(0, Math.min(0.999999999, Number(random) || 0)) * 0xFFFFFF).toString(36).padStart(5, "0"));
  const slotNumber = slot !== null && slot !== undefined && slot !== "" && Number.isInteger(Number(slot))
    ? Math.max(0, Number(slot)) % TIMETABLE_REVISION_HISTORY_SLOTS
    : null;
  const slotSuffix = slotNumber == null ? "" : `-s${String(slotNumber).padStart(2, "0")}`;
  return `ttrev-${iso}-${suffix || "00000"}${slotSuffix}`;
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

function bytesToBase64(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < source.length; i += chunkSize) {
    binary += String.fromCharCode(...source.subarray(i, i + chunkSize));
  }
  if (typeof btoa === "function") return btoa(binary);
  if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
  throw new Error("Base64 인코더를 사용할 수 없습니다.");
}

function base64ToBytes(text) {
  const value = String(text || "");
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
  throw new Error("Base64 디코더를 사용할 수 없습니다.");
}

function fnv1aHex(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source[i];
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

async function transformBytes(bytes, mode) {
  const StreamCtor = mode === "compress" ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (typeof StreamCtor !== "function") {
    const error = new Error(
      mode === "compress"
        ? "이 브라우저는 시간표 복구용 압축 저장을 지원하지 않습니다. Chrome/Edge 최신 버전에서 다시 시도해 주세요."
        : "이 브라우저는 시간표 복구본 압축 해제를 지원하지 않습니다. Chrome/Edge 최신 버전에서 다시 시도해 주세요."
    );
    error.code = "timetable-snapshot-compression-unsupported";
    throw error;
  }
  const stream = new StreamCtor("gzip");
  const outputPromise = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await outputPromise);
}

export function buildTimetableSnapshotEnvelope({ schoolYear, timetable, createdAt = new Date().toISOString() } = {}) {
  return {
    schemaVersion: TIMETABLE_SNAPSHOT_SCHEMA_VERSION,
    schoolYear: String(schoolYear || "").trim(),
    createdAt: String(createdAt || new Date().toISOString()),
    timetable: timetable && typeof timetable === "object" ? timetable : {},
  };
}

export async function encodeTimetableRevisionSnapshot(input = {}) {
  const envelope = buildTimetableSnapshotEnvelope(input);
  const jsonBytes = new TextEncoder().encode(JSON.stringify(envelope));
  const compressed = await transformBytes(jsonBytes, "compress");
  const payload = bytesToBase64(compressed);
  const payloadBytes = new TextEncoder().encode(payload).byteLength;
  if (payloadBytes > TIMETABLE_REVISION_MAX_PAYLOAD_BYTES) {
    const error = new Error(
      `시간표 복구본이 안전 저장 한도(${TIMETABLE_REVISION_MAX_PAYLOAD_BYTES.toLocaleString()} bytes)를 초과했습니다. ` +
      `현재 압축 payload는 ${payloadBytes.toLocaleString()} bytes입니다.`
    );
    error.code = "timetable-snapshot-too-large";
    error.payloadBytes = payloadBytes;
    throw error;
  }
  const timetable = envelope.timetable || {};
  return {
    schemaVersion: TIMETABLE_SNAPSHOT_SCHEMA_VERSION,
    encoding: "gzip-base64",
    payload,
    payloadBytes,
    compressedBytes: compressed.byteLength,
    jsonBytes: jsonBytes.byteLength,
    checksum: fnv1aHex(jsonBytes),
    counts: {
      entries: Array.isArray(timetable.entries) ? timetable.entries.length : 0,
      cards: Array.isArray(timetable.ttcards) ? timetable.ttcards.length : 0,
      groups: Array.isArray(timetable.ttcardGroups) ? timetable.ttcardGroups.length : 0,
    },
  };
}

export async function decodeTimetableRevisionSnapshot(record = {}) {
  const snapshot = record?.snapshot && typeof record.snapshot === "object" ? record.snapshot : record;
  if (snapshot?.encoding !== "gzip-base64" || !snapshot?.payload) {
    const error = new Error("이 저장 기록에는 복구 가능한 시간표 스냅샷이 없습니다.");
    error.code = "timetable-revision-snapshot-missing";
    throw error;
  }
  const compressed = base64ToBytes(snapshot.payload);
  const jsonBytes = await transformBytes(compressed, "decompress");
  if (snapshot.checksum && fnv1aHex(jsonBytes) !== snapshot.checksum) {
    const error = new Error("시간표 복구본 체크섬이 일치하지 않습니다. 손상된 기록은 복구할 수 없습니다.");
    error.code = "timetable-revision-snapshot-corrupt";
    throw error;
  }
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch (cause) {
    const error = new Error("시간표 복구본 JSON을 해석할 수 없습니다.");
    error.code = "timetable-revision-snapshot-invalid-json";
    error.cause = cause;
    throw error;
  }
  return validateTimetableRevisionSnapshotEnvelope(envelope);
}

export function validateTimetableRevisionSnapshotEnvelope(envelope = {}, { schoolYear = "" } = {}) {
  if (!envelope || typeof envelope !== "object" || !envelope.timetable || typeof envelope.timetable !== "object") {
    const error = new Error("시간표 복구본 구조가 올바르지 않습니다.");
    error.code = "timetable-revision-snapshot-invalid";
    throw error;
  }
  const expectedYear = String(schoolYear || "").trim();
  const actualYear = String(envelope.schoolYear || "").trim();
  if (expectedYear && actualYear !== expectedYear) {
    const error = new Error(`다른 학년도의 복구본입니다. 현재 ${expectedYear}학년도 / 복구본 ${actualYear || "미상"}학년도`);
    error.code = "timetable-revision-school-year-mismatch";
    throw error;
  }
  const entries = envelope.timetable.entries;
  const cards = envelope.timetable.ttcards;
  if (!Array.isArray(entries) || !Array.isArray(cards)) {
    const error = new Error("시간표 복구본에 배치 또는 카드 배열이 없습니다.");
    error.code = "timetable-revision-snapshot-invalid";
    throw error;
  }
  return envelope;
}

export function isRestorableTimetableRevision(record = {}) {
  return !!(record?.snapshot?.encoding === "gzip-base64" && record?.snapshot?.payload);
}
