import assert from "node:assert/strict";
import {
  CP_SAT_RUN_HISTORY_LIMIT,
  CP_SAT_RUN_HISTORY_STORAGE_KEY,
  estimateCpSatSaveOperations,
  extractCpSatServerTiming,
  readCpSatRunHistory,
  upsertCpSatRunHistory,
  clearCpSatRunHistory,
} from "../js/timetable-cpsat-run-history.js";

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

const currentEntries = [
  { id: "e1", day: 0, period: 0, ttcardId: "c1", createdAt: "old" },
  { id: "e2", day: 0, period: 1, ttcardId: "c2" },
  { id: "e3", day: 0, period: 2, ttcardId: "c3" },
];
const nextEntries = [
  { id: "e1", day: 0, period: 0, ttcardId: "c1", createdAt: "new" },
  { id: "e2", day: 1, period: 1, ttcardId: "c2" },
  { id: "e4", day: 2, period: 2, ttcardId: "c4" },
];
const estimate = estimateCpSatSaveOperations({ currentEntries, nextEntries });
assert.deepEqual(
  { created: estimate.created, changed: estimate.changed, unchanged: estimate.unchanged, deleted: estimate.deleted, dataOps: estimate.dataOps, totalWrites: estimate.totalWrites },
  { created: 1, changed: 1, unchanged: 1, deleted: 1, dataOps: 3, totalWrites: 5 },
);
assert.equal(estimate.withinLimit, true);

const serverTiming = extractCpSatServerTiming({
  elapsedSeconds: 3.25,
  timing: {
    privacyNormalizeMs: 8.2,
    modelBuildMs: 12.3,
    solveMs: 3010.4,
    validationMs: 6.4,
    responsePrepareMs: 3.1,
    totalMs: 3250,
  },
  meta: {
    quickComplete: true,
    twoPhase: {
      phase1Status: "CP-SAT-FEASIBLE",
      phase1WallTimeSeconds: 3.01,
      phase2Status: "SKIPPED",
      phase2WallTimeSeconds: 0,
      mode: "quick-complete-first-feasible",
    },
  },
});
assert.equal(serverTiming.totalMs, 3250);
assert.equal(serverTiming.modelBuildMs, 12.3);
assert.equal(serverTiming.phase1Ms, 3010);
assert.equal(serverTiming.phase2Ms, 0);
assert.equal(serverTiming.quickComplete, true);

const storage = new MemoryStorage();
for (let i = 0; i < CP_SAT_RUN_HISTORY_LIMIT + 3; i += 1) {
  upsertCpSatRunHistory({
    id: `run-${i}`,
    startedAt: new Date(Date.UTC(2026, 6, 16, 0, i)).toISOString(),
    status: i % 2 ? "complete" : "failed",
    title: `run ${i}`,
    entries: [{ studentName: "MUST_NOT_PERSIST" }],
    studentObjects: [{ name: "MUST_NOT_PERSIST" }],
    timing: { clientTotalMs: i * 10 },
    counts: { cards: 237, resultEntries: 368 },
    saveEstimate: { dataOps: 369, dataOpLimit: 498, withinLimit: true },
  }, storage);
}
const history = readCpSatRunHistory(storage);
assert.equal(history.length, CP_SAT_RUN_HISTORY_LIMIT);
assert.equal(history[0].id, `run-${CP_SAT_RUN_HISTORY_LIMIT + 2}`);
const raw = storage.getItem(CP_SAT_RUN_HISTORY_STORAGE_KEY) || "";
assert.doesNotMatch(raw, /MUST_NOT_PERSIST|studentName|studentObjects|entries/);

clearCpSatRunHistory(storage);
assert.deepEqual(readCpSatRunHistory(storage), []);

console.log("CPSAT_RUN_HISTORY_TEST_OK");
