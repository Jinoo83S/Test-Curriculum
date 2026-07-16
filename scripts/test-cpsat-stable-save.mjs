 import assert from "node:assert/strict";
import { reconcileCpSatEntryIds } from "../js/cp-sat-webapp-import.js";
import { buildCollectionRevisionPlan, summarizeTimetableRevisionPlan, assertAtomicTimetableRevisionCapacity } from "../js/timetable-save-revision.js";

const current = [];
const solved = [];
for (let i = 0; i < 365; i += 1) {
  const cardId = `card-${String(i).padStart(3, "0")}`;
  current.push({ id: `old-${i}`, ttcardId: cardId, templateId: `tpl-${i}`, gradeKey: "10학년", day: i % 5, period: i % 7 });
  solved.push({ id: `server-new-${i}`, ttcardId: cardId, templateId: `tpl-${i}`, gradeKey: "10학년", day: (i + 1) % 5, period: (i + 2) % 7 });
}
const reconciled = reconcileCpSatEntryIds(solved, current);
assert.equal(reconciled.reused, 365);
assert.equal(reconciled.created, 0);
assert.equal(new Set(reconciled.entries.map(entry => entry.id)).size, 365);
assert.ok(reconciled.entries.every(entry => entry.id.startsWith("old-")));

const baseline = new Map(current.map(entry => [entry.id, JSON.stringify(entry)]));
const entryPlan = buildCollectionRevisionPlan({ baseline, items: reconciled.entries });
const cardPlan = buildCollectionRevisionPlan({ baseline: new Map(), items: [] });
const summary = summarizeTimetableRevisionPlan({ entryPlan, cardPlan, metaChanged: true });
assert.equal(summary.entryDeletes, 0);
assert.equal(summary.entrySets, 365);
assert.equal(summary.dataOps, 365);
assert.doesNotThrow(() => assertAtomicTimetableRevisionCapacity(summary));

const first = reconcileCpSatEntryIds([{ ttcardId: "new-card", day: 0, period: 0 }], []);
const second = reconcileCpSatEntryIds([{ ttcardId: "new-card", day: 4, period: 6 }], first.entries);
assert.equal(first.created, 1);
assert.equal(second.reused, 1);
assert.equal(second.entries[0].id, first.entries[0].id);

console.log("TIMETABLE_CPSAT_STABLE_SAVE_OK");
