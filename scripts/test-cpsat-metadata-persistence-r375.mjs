import fs from "node:fs";
import assert from "node:assert/strict";
import { repairContinuousSpanMetadata } from "../js/cp-sat-webapp-import.js";
import { auditPersistedTimetable, timetableAssignmentSignatures } from "../js/timetable-persistence-audit.js";

const stateSource = fs.readFileSync(new URL("../js/state.js", import.meta.url), "utf8");
const bridgeSource = fs.readFileSync(new URL("../js/cp-sat-webapp-import.js", import.meta.url), "utf8");

assert.match(stateSource, /function compactCpSatAutoAssignMetaForStorage/);
assert.match(stateSource, /cpSatCapacityWarningCount/);
assert.match(stateSource, /cpSatCapacityWarnings/);
assert.match(stateSource, /persistenceReadbackAudit/);
assert.match(stateSource, /export async function verifyPersistedTimetableState/);
assert.match(stateSource, /autoBlockSpanTotal/);
assert.match(stateSource, /autoBlockSpanIndex/);
assert.match(bridgeSource, /현재 시간표 메타 보정/);
assert.match(bridgeSource, /cp-sat-meta-repair/);
assert.match(bridgeSource, /repairContinuousSpanMetadata/);
assert.match(bridgeSource, /verifyPersistedTimetableState/);
assert.match(bridgeSource, /cp-sat-webapp-r375/);
assert.doesNotMatch(bridgeSource, /메타 source: cp-sat-webapp-r374/);

const spanInput = [
  { id: "a", day: 0, period: 1, groupId: "g", durationPeriods: 2, ttcardIds: ["c1"], roomAssignmentsByTtCardId: { c1: "r1" } },
  { id: "b", day: 0, period: 2, groupId: "g", durationPeriods: 2, ttcardIds: ["c1"], roomAssignmentsByTtCardId: { c1: "r1" } },
];
const span = repairContinuousSpanMetadata(spanInput);
assert.equal(span.changedEntryCount, 2);
assert.equal(span.blockCount, 1);
assert.deepEqual(span.entries.map(e => e.autoBlockSpanIndex), [0, 1]);
assert.deepEqual(span.entries.map(e => e.autoBlockSpanTotal), [2, 2]);

const expectedEntries = [
  { id: "e1", day: 0, period: 1, ttcardIds: ["c1", "c2"], roomAssignmentsByTtCardId: { c1: "r1", c2: "r1" } },
  { id: "e2", day: 1, period: 2, ttcardId: "c3", roomId: "r2" },
];
const expectedMeta = {
  source: "cp-sat-webapp-r375",
  importedEntryCount: 2,
  cpSatCapacityWarningCount: 1,
};
const persistedMeta = structuredClone(expectedMeta);
const audit = auditPersistedTimetable({ expectedEntries, persistedEntries: structuredClone(expectedEntries), expectedMeta, persistedMeta });
assert.equal(audit.ok, true, audit.summary);
assert.equal(audit.expectedAssignmentCount, 3);
assert.equal(timetableAssignmentSignatures(expectedEntries).length, 3);

const missingMetaAudit = auditPersistedTimetable({
  expectedEntries,
  persistedEntries: structuredClone(expectedEntries),
  expectedMeta,
  persistedMeta: { source: "", importedEntryCount: 0, cpSatCapacityWarningCount: 0 },
});
assert.equal(missingMetaAudit.ok, false);
assert.equal(missingMetaAudit.assignmentsMatch, true);
assert.equal(missingMetaAudit.metaSourceMatch, false);
assert.equal(missingMetaAudit.capacityMatch, false);

console.log("CPSAT_METADATA_PERSISTENCE_R375_OK", audit.expectedEntryCount, audit.expectedAssignmentCount);
