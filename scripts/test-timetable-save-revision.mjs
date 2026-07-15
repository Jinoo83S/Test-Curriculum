import assert from "node:assert/strict";
import {
  FIRESTORE_BATCH_WRITE_LIMIT,
  TIMETABLE_ATOMIC_DATA_OP_LIMIT,
  createTimetableSaveRevisionId,
  getTimetableRevisionHistorySlot,
  buildCollectionRevisionPlan,
  summarizeTimetableRevisionPlan,
  assertAtomicTimetableRevisionCapacity,
} from "../js/timetable-save-revision.js";

const fp = value => JSON.stringify(value);

const baseline = new Map([
  ["e1", fp({ id: "e1", value: 1 })],
  ["e2", fp({ id: "e2", value: 2 })],
]);
const plan = buildCollectionRevisionPlan({
  baseline,
  items: [
    { id: "e1", value: 1 },
    { id: "e2", value: 20 },
    { id: "e3", value: 3 },
  ],
  fingerprint: fp,
});
assert.equal(plan.setCount, 2);
assert.equal(plan.deleteCount, 0);
assert.deepEqual(plan.sets.map(v => v.id).sort(), ["e2", "e3"]);

const deletePlan = buildCollectionRevisionPlan({
  baseline,
  items: [{ id: "e1", value: 1 }],
  fingerprint: fp,
});
assert.equal(deletePlan.setCount, 0);
assert.deepEqual(deletePlan.deletes.map(v => v.id), ["e2"]);

const summary = summarizeTimetableRevisionPlan({
  entryPlan: plan,
  cardPlan: deletePlan,
  metaChanged: true,
});
assert.equal(summary.dataOps, 3);
assert.equal(summary.totalWrites, 5);
assert.doesNotThrow(() => assertAtomicTimetableRevisionCapacity(summary));

const overLimit = {
  ...summary,
  dataOps: TIMETABLE_ATOMIC_DATA_OP_LIMIT + 1,
  totalWrites: FIRESTORE_BATCH_WRITE_LIMIT + 1,
};
assert.throws(
  () => assertAtomicTimetableRevisionCapacity(overLimit),
  error => error?.code === "timetable-atomic-write-limit"
);

// Current HIS operating scale: replacing all 368 placements or all 237 cards
// separately remains atomic. Replacing both in one save is deliberately blocked.
assert.doesNotThrow(() => assertAtomicTimetableRevisionCapacity({
  dataOps: 368,
  totalWrites: 370,
  entrySets: 368,
  entryDeletes: 0,
  cardSets: 0,
  cardDeletes: 0,
}));
assert.doesNotThrow(() => assertAtomicTimetableRevisionCapacity({
  dataOps: 237,
  totalWrites: 239,
  entrySets: 0,
  entryDeletes: 0,
  cardSets: 237,
  cardDeletes: 0,
}));
assert.throws(() => assertAtomicTimetableRevisionCapacity({
  dataOps: 605,
  totalWrites: 607,
  entrySets: 368,
  entryDeletes: 0,
  cardSets: 237,
  cardDeletes: 0,
}), error => error?.code === "timetable-atomic-write-limit");

const id = createTimetableSaveRevisionId({
  now: new Date("2026-07-15T02:40:12.345Z"),
  random: 0.5,
});
assert.match(id, /^ttrev-20260715024012345-[a-z0-9]{5}$/);
assert.ok(getTimetableRevisionHistorySlot(id) >= 0 && getTimetableRevisionHistorySlot(id) < 30);
assert.equal(getTimetableRevisionHistorySlot(id), getTimetableRevisionHistorySlot(id));

const sequentialId = createTimetableSaveRevisionId({
  now: new Date("2026-07-15T02:40:12.345Z"),
  random: 0.5,
  slot: 7,
});
assert.match(sequentialId, /^ttrev-20260715024012345-[a-z0-9]{5}-s07$/);
assert.equal(getTimetableRevisionHistorySlot(sequentialId), 7);

console.log("TIMETABLE_SAVE_REVISION_TEST_OK");
