// ================================================================
// timetable-persistence-audit.js · CP-SAT Firestore read-back audit
// r375: saved entries/meta are compared with the applied result.
// ================================================================

const asArray = value => Array.isArray(value) ? value : [];
const clean = value => String(value ?? "").trim();
const unique = values => [...new Set(asArray(values).map(clean).filter(Boolean))];

function entryCardIds(entry = {}) {
  return unique([...(entry.ttcardIds || []), entry.ttcardId]);
}

function entryRoomForCard(entry = {}, cardId = "") {
  const assignments = entry.roomAssignmentsByTtCardId && typeof entry.roomAssignmentsByTtCardId === "object"
    ? entry.roomAssignmentsByTtCardId
    : {};
  return clean(assignments[cardId] || entry.roomId || "");
}

export function timetableAssignmentSignatures(entries = []) {
  const signatures = [];
  asArray(entries).forEach(entry => {
    const day = Number(entry?.day);
    const period = Number(entry?.period);
    if (!Number.isInteger(day) || !Number.isInteger(period)) return;
    const cards = entryCardIds(entry);
    if (!cards.length) return;
    cards.forEach(cardId => {
      signatures.push(`${cardId}@${day}:${period}#${entryRoomForCard(entry, cardId)}`);
    });
  });
  return signatures.sort();
}

function multisetDifference(left = [], right = []) {
  const counts = new Map();
  right.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  const missing = [];
  left.forEach(value => {
    const count = counts.get(value) || 0;
    if (count > 0) counts.set(value, count - 1);
    else missing.push(value);
  });
  return missing;
}

export function auditPersistedTimetable({
  expectedEntries = [],
  persistedEntries = [],
  expectedMeta = {},
  persistedMeta = {},
} = {}) {
  const expectedSignatures = timetableAssignmentSignatures(expectedEntries);
  const persistedSignatures = timetableAssignmentSignatures(persistedEntries);
  const missingAssignments = multisetDifference(expectedSignatures, persistedSignatures);
  const extraAssignments = multisetDifference(persistedSignatures, expectedSignatures);
  const expectedCapacityCount = Number(expectedMeta?.cpSatCapacityWarningCount || 0) || 0;
  const persistedCapacityCount = Number(persistedMeta?.cpSatCapacityWarningCount || 0) || 0;
  const expectedSource = clean(expectedMeta?.source);
  const persistedSource = clean(persistedMeta?.source);
  const expectedImported = Number(expectedMeta?.importedEntryCount || expectedEntries.length || 0) || 0;
  const persistedImported = Number(persistedMeta?.importedEntryCount || 0) || 0;
  const entriesMatch = asArray(expectedEntries).length === asArray(persistedEntries).length;
  const assignmentsMatch = missingAssignments.length === 0 && extraAssignments.length === 0;
  const metaSourceMatch = !expectedSource || expectedSource === persistedSource;
  const metaImportedMatch = expectedImported === persistedImported;
  const capacityMatch = expectedCapacityCount === persistedCapacityCount;
  const ok = entriesMatch && assignmentsMatch && metaSourceMatch && metaImportedMatch && capacityMatch;
  return {
    schemaVersion: "r375-firestore-readback-v1",
    ok,
    expectedEntryCount: asArray(expectedEntries).length,
    persistedEntryCount: asArray(persistedEntries).length,
    expectedAssignmentCount: expectedSignatures.length,
    persistedAssignmentCount: persistedSignatures.length,
    missingAssignmentCount: missingAssignments.length,
    extraAssignmentCount: extraAssignments.length,
    missingAssignments: missingAssignments.slice(0, 20),
    extraAssignments: extraAssignments.slice(0, 20),
    expectedSource,
    persistedSource,
    entriesMatch,
    assignmentsMatch,
    metaSourceMatch,
    expectedImportedEntryCount: expectedImported,
    persistedImportedEntryCount: persistedImported,
    metaImportedMatch,
    expectedCapacityWarningCount: expectedCapacityCount,
    persistedCapacityWarningCount: persistedCapacityCount,
    capacityMatch,
    summary: ok
      ? `Firestore 재조회 검증 통과: entries ${asArray(persistedEntries).length}, 카드-시간-교실 ${persistedSignatures.length}/${expectedSignatures.length}`
      : `Firestore 재조회 불일치: entries ${asArray(persistedEntries).length}/${asArray(expectedEntries).length}, 카드-시간-교실 ${persistedSignatures.length}/${expectedSignatures.length}, 누락 ${missingAssignments.length}, 추가 ${extraAssignments.length}`,
  };
}
