import assert from "node:assert/strict";
import {
  buildTimetablePreflightDiagnostics,
  formatTimetablePreflightSummary,
  blockingTimetablePreflightIssues,
} from "../js/timetable-preflight-diagnostics.js";

function baseState() {
  return {
    teachers: { teachers: [{ id: "teacher-1", name: "Teacher One", aliases: [] }] },
    rooms: { rooms: [{ id: "room-1", name: "Room 1", teacherName: "Teacher One", unavailableSlots: [] }] },
    classes: { classes: [{ id: "class-1", grade: "7학년", name: "A", students: [] }] },
    timetable: {
      config: { periodCount: 7 },
      teacherConstraints: { "Teacher One": { assignedRoomId: "room-1", unavailableSlots: [] } },
      teacherConstraintsById: { "teacher-1": { assignedRoomId: "room-1", unavailableSlots: [] } },
      ttcards: [{
        id: "card-1",
        gradeKey: "7학년",
        sectionIdx: 0,
        subject: "Mathematics",
        credits: 1,
        teacherId: "teacher-1",
        teacherIds: ["teacher-1"],
        teacherName: "Teacher One",
        teachers: ["Teacher One"],
        classKeys: ["7:A"],
        classLabels: ["7A"],
        roomRule: "teacher",
        allowedSlots: [],
        unavailableSlots: [],
      }],
      ttcardGroups: [],
      entries: [],
    },
  };
}

const valid = buildTimetablePreflightDiagnostics(baseState(), { scopeGrades: ["7학년"] });
assert.equal(valid.blockingCount, 0, JSON.stringify(valid.issues, null, 2));
assert.equal(valid.cardCandidates[0].candidateCount, 35);
assert.match(valid.performance.complexity, /cards×35/);
assert.match(formatTimetablePreflightSummary(valid), /진단/);
assert.deepEqual(blockingTimetablePreflightIssues(valid), []);

const missingTeacher = baseState();
missingTeacher.timetable.ttcards[0].teacherIds = ["missing-teacher"];
missingTeacher.timetable.ttcards[0].teacherId = "missing-teacher";
const missingTeacherReport = buildTimetablePreflightDiagnostics(missingTeacher, { scopeGrades: ["7학년"] });
assert.ok(missingTeacherReport.blockingCount > 0);
assert.ok(missingTeacherReport.issues.some(issue => issue.code === "card-teacher-id-unresolved" && issue.blocking));

const noSlots = baseState();
noSlots.timetable.teacherConstraintsById["teacher-1"].unavailableSlots = Array.from({ length: 35 }, (_, index) => ({ day: Math.floor(index / 7), period: index % 7 }));
const noSlotsReport = buildTimetablePreflightDiagnostics(noSlots, { scopeGrades: ["7학년"] });
assert.ok(noSlotsReport.issues.some(issue => issue.code === "card-zero-candidate"));
assert.ok(noSlotsReport.blockingCount > 0);

const dayShortage = baseState();
dayShortage.timetable.ttcards[0].credits = 2;
dayShortage.timetable.ttcards[0].allowedSlots = [{ day: 0, period: 0 }, { day: 0, period: 1 }, { day: 0, period: 2 }];
const dayShortageReport = buildTimetablePreflightDiagnostics(dayShortage, { scopeGrades: ["7학년"] });
assert.ok(dayShortageReport.issues.some(issue => issue.code === "card-day-shortage"));

const fullyProtected = baseState();
fullyProtected.timetable.ttcards[0].allowedSlots = [{ day: 0, period: 0 }];
fullyProtected.timetable.entries = [{ id: "e-protected", day: 0, period: 0, ttcardId: "card-1", teacherId: "teacher-1", teacherIds: ["teacher-1"], teacherName: "Teacher One", audienceClassKeys: ["7:A"], roomId: "room-1", pinned: true }];
const fullyProtectedReport = buildTimetablePreflightDiagnostics(fullyProtected, { scopeGrades: ["7학년"], protectedEntries: fullyProtected.timetable.entries });
assert.ok(!fullyProtectedReport.issues.some(issue => issue.code === "card-zero-candidate"), "fully protected card must not block keep mode");

const fixedConflict = baseState();
fixedConflict.timetable.entries = [
  { id: "e1", day: 0, period: 0, teacherId: "teacher-1", teacherIds: ["teacher-1"], teacherName: "Teacher One", audienceClassKeys: ["7:A"], roomId: "room-1", pinned: true },
  { id: "e2", day: 0, period: 0, teacherId: "teacher-1", teacherIds: ["teacher-1"], teacherName: "Teacher One", audienceClassKeys: ["7:A"], roomId: "room-1", pinned: true },
];
const fixedConflictReport = buildTimetablePreflightDiagnostics(fixedConflict, { scopeGrades: ["7학년"], protectedEntries: fixedConflict.timetable.entries });
assert.ok(fixedConflictReport.issues.some(issue => issue.code === "protected-teacher-conflict"));
assert.ok(fixedConflictReport.issues.some(issue => issue.code === "protected-room-conflict"));
assert.ok(fixedConflictReport.issues.some(issue => issue.code === "protected-class-conflict"));

console.log("TIMETABLE_PREFLIGHT_DIAGNOSTICS_OK");

import fs from "node:fs";
const autoAssignSource = fs.readFileSync(new URL("../js/timetable-autoassign.js", import.meta.url), "utf8");
const cpSatSource = fs.readFileSync(new URL("../js/cp-sat-webapp-import.js", import.meta.url), "utf8");
const timetableHtml = fs.readFileSync(new URL("../timetable.html", import.meta.url), "utf8");
assert.match(autoAssignSource, /buildTimetablePreflightDiagnostics/);
assert.match(autoAssignSource, /buildExactSolverCandidatePrecheck/);
assert.match(autoAssignSource, /consumeExactSolverCandidateCache/);
assert.match(autoAssignSource, /precheckCandidateCacheReused/);
assert.match(autoAssignSource, /await openAutoAssignPrecheckDialog\(precheckReport, \{ allowProceed: false \}\)/);
assert.match(cpSatSource, /function localSolverPreflight\(\)/);
assert.match(cpSatSource, /CP-SAT 실행 전 사전진단에서 차단되었습니다/);
assert.match(cpSatSource, /blockingTimetablePreflightIssues/);
assert.match(timetableHtml, /2026-07-16-cpsat-preflight-r366/);
console.log("TIMETABLE_PREFLIGHT_RUNTIME_WIRING_OK");
