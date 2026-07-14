import assert from "node:assert/strict";
import {
  validateWorkspaceSnapshot,
  summarizeWorkspaceSnapshot,
  compareWorkspaceCounts,
  compactIntegrityReport,
} from "../js/school-year-integrity.js";

function makeSnapshot() {
  return {
    year: "2027",
    domains: {
      curriculum: {
        gradeBoards: {
          "7학년": [{ id:"row-1", sem1TemplateId:"tpl-1", sem2TemplateId:"tpl-1" }]
        }
      },
      templates: {
        templates: [{ id:"tpl-1", nameKo:"국어", teacher:"교사1", compoundParts:[] }]
      },
      teachers: { teachers:[{ id:"t-1", name:"교사1" }] },
      rooms: { rooms:[{ id:"room-1", name:"101", homeRoomClassId:"cls-1", teacherName:"교사1" }] },
    },
    classes: [{ id:"cls-1", data:{ id:"cls-1", grade:"7학년", name:"A", students:[{ id:"stu-1", name:"학생1" }] } }],
    rosters: [{ id:"tpl-1", data:{ templateId:"tpl-1", entries:[{ classId:"cls-1", studentId:"stu-1", sectionIdx:0 }] } }],
    ttcards: [{ id:"card-1", data:{ id:"card-1", templateId:"tpl-1", gradeKey:"7학년", classKeys:["7:A"], credits:1, fixedRoomId:"room-1", teacherName:"교사1" } }],
    timetableEntries: [{ id:"entry-1", data:{ id:"entry-1", day:0, period:0, ttcardId:"card-1", templateId:"tpl-1", audienceClassKeys:["7:A"], roomId:"room-1" } }],
    timetableMeta: { config:{ periodCount:7 }, ttcardGroups:[] },
    workspaceMeta: { year:"2027", sourceYear:"2026", createMode:"copy" },
  };
}

const source = makeSnapshot();
const target = structuredClone(source);
const report = validateWorkspaceSnapshot(target, { year:"2027", sourceSnapshot:source, strictCopy:true });
assert.equal(report.ok, true, JSON.stringify(report.errors));
assert.equal(report.errorCount, 0);
assert.equal(report.counts.classes, 1);
assert.equal(report.counts.students, 1);
assert.equal(report.counts.rosterSubjects, 1);
assert.equal(report.counts.ttcards, 1);
assert.equal(report.counts.timetableEntries, 1);
assert.equal(report.sourceComparison.same, true);
assert.ok(report.signature.startsWith("ws:"));

const missingRoster = structuredClone(target);
missingRoster.rosters[0].data.entries = [];
const mismatch = validateWorkspaceSnapshot(missingRoster, { sourceSnapshot:source, strictCopy:true });
assert.equal(mismatch.ok, false);
assert.ok(mismatch.errors.some(row => row.code === "copy-count-mismatch"));

const orphan = structuredClone(target);
orphan.rosters[0].data.entries[0].studentId = "missing-student";
const orphanReport = validateWorkspaceSnapshot(orphan);
assert.equal(orphanReport.ok, false);
assert.ok(orphanReport.errors.some(row => row.code === "roster-student-missing"));

const missingPlacement = structuredClone(target);
missingPlacement.timetableEntries = [];
const placementReport = validateWorkspaceSnapshot(missingPlacement);
assert.equal(placementReport.ok, false);
assert.ok(placementReport.errors.some(row => row.code === "ttcard-credit-placement-mismatch"));

const empty = validateWorkspaceSnapshot({ year:"2028", domains:{}, workspaceMeta:{ createMode:"empty" } }, { allowEmpty:true });
assert.equal(empty.ok, true);
assert.ok(empty.warnings.some(row => row.code === "empty-workspace"));


const partialDraft = structuredClone(target);
partialDraft.workspaceMeta = { createMode:"empty" };
partialDraft.timetableEntries = [];
const partialDraftReport = validateWorkspaceSnapshot(partialDraft, { allowEmpty:true });
assert.equal(partialDraftReport.ok, true);
assert.ok(partialDraftReport.warnings.some(row => row.code === "ttcard-credit-placement-mismatch"));

const counts = summarizeWorkspaceSnapshot(source);
assert.deepEqual(compareWorkspaceCounts(counts, counts), []);
const compact = compactIntegrityReport(report);
assert.equal(compact.ok, true);
assert.equal(compact.errors.length, 0);
console.log("SCHOOL_YEAR_INTEGRITY_TEST_OK", report.signature);
