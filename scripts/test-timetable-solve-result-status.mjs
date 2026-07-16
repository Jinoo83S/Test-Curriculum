import assert from "node:assert/strict";
import {
  buildCpSatScopeAudit,
  auditCpSatResult,
  cpSatResultStatusLabel,
} from "../js/timetable-solve-result-status.js";

function state() {
  return {
    data: {
      classes: { classes: [{ id: "class-1", grade: "7학년", name: "A" }] },
      timetable: {
        config: { periodCount: 1 },
        ttcards: [{ id: "card-1", gradeKey: "7학년", sectionIdx: 0, classKeys: ["7:A"] }],
        autoAssignMeta: {
          manualCardExcludedIds: ["manual-card"],
          cpSatEntrySeedPreflight: {
            originalEntryCount: 8,
            keptSeedEntryCount: 2,
            droppedGeneratedEntryCount: 6,
          },
        },
      },
    },
  };
}

const entries = Array.from({ length: 5 }, (_, day) => ({
  id: `entry-${day}`,
  day,
  period: 0,
  ttcardId: "card-1",
  audienceClassKeys: ["7:A"],
}));

const completeApi = {
  status: "CP-SAT-FEASIBLE",
  meta: { engine: "OR-Tools CP-SAT" },
  validation: {
    ok: true,
    summary: "정상",
    counts: {
      shortageCount: 0,
      overageCount: 0,
      teacherConflictCount: 0,
      roomConflictCount: 0,
      classConflictCount: 0,
      studentConflictCount: 0,
      timeViolationCount: 0,
    },
  },
};

const scope = buildCpSatScopeAudit(state());
assert.equal(scope.sourceCardCount, 2);
assert.equal(scope.includedCardCount, 1);
assert.equal(scope.excludedCardCount, 1);
assert.equal(scope.preservedSeedEntryCount, 2);
assert.equal(scope.droppedGeneratedEntryCount, 6);
assert.equal(scope.expectedClassSlotCount, 5);

const complete = auditCpSatResult({ apiResult: completeApi, state: state(), entries });
assert.equal(complete.status, "complete_success");
assert.equal(complete.canApply, true);
assert.equal(complete.actualClassSlotCount, 5);
assert.match(cpSatResultStatusLabel(complete), /완전 성공/);

const mismatch = auditCpSatResult({
  apiResult: completeApi,
  state: state(),
  entries,
  clientPreflight: { blockingCount: 3 },
});
assert.equal(mismatch.status, "diagnostic_mismatch");
assert.equal(mismatch.canApply, true);
assert.match(mismatch.reason, /사전진단/);

const partial = auditCpSatResult({
  apiResult: {
    ...completeApi,
    validation: { ...completeApi.validation, ok: false, summary: "미배치 있음", counts: { ...completeApi.validation.counts, shortageCount: 1 } },
  },
  state: state(),
  entries: entries.slice(0, 4),
});
assert.equal(partial.status, "partial_success");
assert.equal(partial.canApply, false);
assert.equal(partial.coverageComplete, false);

const failed = auditCpSatResult({
  apiResult: {
    ...completeApi,
    validation: { ...completeApi.validation, ok: false, summary: "교사 충돌", counts: { ...completeApi.validation.counts, teacherConflictCount: 1 } },
  },
  state: state(),
  entries,
});
assert.equal(failed.status, "failed");
assert.equal(failed.canApply, false);
assert.equal(failed.hardIssueCount, 1);

console.log("TIMETABLE_SOLVE_RESULT_STATUS_OK");
