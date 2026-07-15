import assert from "node:assert/strict";
import {
  TIMETABLE_REVISION_MAX_PAYLOAD_BYTES,
  buildTimetableSnapshotEnvelope,
  encodeTimetableRevisionSnapshot,
  decodeTimetableRevisionSnapshot,
  validateTimetableRevisionSnapshotEnvelope,
  isRestorableTimetableRevision,
} from "../js/timetable-save-revision.js";

const timetable = {
  config: { periodCount: 7 },
  entries: Array.from({ length: 368 }, (_, index) => ({
    id: `entry-${index}`,
    day: index % 5,
    period: index % 7,
    ttcardId: `card-${index % 237}`,
    teacherName: `Teacher ${index % 33}`,
    roomId: `room-${index % 29}`,
    gradeKey: `${7 + (index % 6)}학년`,
  })),
  ttcards: Array.from({ length: 237 }, (_, index) => ({
    id: `card-${index}`,
    nameKo: `과목 ${index}`,
    nameEn: `Subject ${index}`,
    teacherName: `Teacher ${index % 33}`,
    classKeys: [`${7 + (index % 6)}A`],
  })),
  ttcardGroups: Array.from({ length: 34 }, (_, index) => ({ id: `group-${index}`, name: `그룹 ${index}` })),
  teacherConstraints: {},
  savedSchedules: [],
};

const envelope = buildTimetableSnapshotEnvelope({ schoolYear: "2027", timetable, createdAt: "2026-07-15T03:00:00.000Z" });
assert.equal(envelope.schoolYear, "2027");
assert.equal(envelope.timetable.entries.length, 368);

const snapshot = await encodeTimetableRevisionSnapshot({ schoolYear: "2027", timetable, createdAt: "2026-07-15T03:00:00.000Z" });
assert.equal(snapshot.encoding, "gzip-base64");
assert.ok(snapshot.payloadBytes > 0 && snapshot.payloadBytes < TIMETABLE_REVISION_MAX_PAYLOAD_BYTES);
assert.deepEqual(snapshot.counts, { entries: 368, cards: 237, groups: 34 });
assert.equal(isRestorableTimetableRevision({ snapshot }), true);
assert.equal(isRestorableTimetableRevision({ snapshot: {} }), false);

const decoded = await decodeTimetableRevisionSnapshot({ snapshot });
assert.equal(decoded.schoolYear, "2027");
assert.equal(decoded.timetable.entries.length, 368);
assert.equal(decoded.timetable.ttcards.length, 237);
assert.equal(decoded.timetable.ttcardGroups.length, 34);
assert.doesNotThrow(() => validateTimetableRevisionSnapshotEnvelope(decoded, { schoolYear: "2027" }));
assert.throws(
  () => validateTimetableRevisionSnapshotEnvelope(decoded, { schoolYear: "2026" }),
  error => error?.code === "timetable-revision-school-year-mismatch"
);

await assert.rejects(
  () => decodeTimetableRevisionSnapshot({ snapshot: { ...snapshot, checksum: "00000000" } }),
  error => error?.code === "timetable-revision-snapshot-corrupt"
);

console.log("TIMETABLE_REVISION_HISTORY_TEST_OK");
