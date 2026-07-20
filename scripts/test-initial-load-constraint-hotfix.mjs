import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const stateSource = fs.readFileSync(path.join(root, "js/state.js"), "utf8");
const model = await import(new URL("../js/timetable-constraint-model.js?v=2026-07-20-initial-load-conflict-hotfix-r371", import.meta.url));

// Initial load is not a user edit and must never create a dirty/save-pending domain.
const initialBlock = stateSource.match(/function _checkAllLoaded\(\)[\s\S]*?function fireUpdate\(/)?.[0] || "";
assert.match(initialBlock, /synchronizeRoomAvailabilityState\(\{ persist: false, reason: "initial-load" \}\)/);
assert.match(initialBlock, /synchronizeTeacherIdentityState\(\{ persist: false, reason: "initial-load" \}\)/);
assert.doesNotMatch(initialBlock, /persist:\s*canEdit\(\)/);

const baseCard = {
  gradeKey: "7학년",
  sectionIdx: 0,
  classKeys: ["7:A"],
  classLabels: ["7A"],
  roomRule: "teacher",
  isManual: true,
  allowedSlots: [],
  unavailableSlots: [],
};
const state = {
  curriculum: { gradeBoards: {} },
  templates: { templates: [] },
  classes: { classes: [{ id: "class-7A", grade: "7학년", name: "A", students: [] }] },
  rooms: { rooms: [{ id: "room-7A", name: "7A", capacity: 30, homeRoomClassId: "class-7A", teacherName: "", unavailableSlots: [] }] },
  teachers: { teachers: [{ id: "teacher-a", name: "교사A", note: "7A", subjects: [] }] },
  timetable: {
    teacherConstraints: { 교사A: { maxPerDay: 6, maxConsecutive: 4, unavailableSlots: [] } },
    teacherConstraintsById: {},
    ttcards: [
      { ...baseCard, id: "activity-self", subject: "자율활동", category: "창체", track: "공통", group: "자율⋅자치", teacherName: "", teachers: [], isWholeGrade: true },
      { ...baseCard, id: "activity-club", subject: "동아리활동", category: "창체", track: "공통", group: "동아리", teacherName: "", teachers: [], isWholeGrade: true },
      { ...baseCard, id: "normal-missing", subject: "수학", category: "교과", track: "공통", group: "수학", teacherName: "", teachers: [] },
      { ...baseCard, id: "character", subject: "성품과 공동체", category: "창체", track: "공통", group: "자율⋅자치", teacherName: "교사A", teachers: ["교사A"] },
    ]
  }
};

const report = model.buildOperationalConstraintModel(state);
const codes = report.issues.map(x => x.code);
assert.equal(report.summary.hardIssueCount, 1, "only the ordinary teacherless subject should remain hard");
assert.equal(codes.filter(x => x === "card-intentional-teacherless").length, 2);
assert.equal(codes.filter(x => x === "card-missing-teacher").length, 1);
assert.equal(codes.filter(x => x === "card-room-unresolved").length, 0, "single-class homeroom fallback should resolve room sources for both cards");

const charCard = report.cards.find(x => x.id === "character");
assert.deepEqual(charCard.resolvedRoomIds, ["room-7A"], "single-class homeroom must be a valid fallback for teacher-room mode");

const activitiesOnly = structuredClone(state);
activitiesOnly.timetable.ttcards = activitiesOnly.timetable.ttcards.filter(card => card.id !== "normal-missing");
const cleanReport = model.buildOperationalConstraintModel(activitiesOnly);
assert.equal(cleanReport.summary.hardIssueCount, 0);
assert.equal(cleanReport.summary.warnIssueCount, 0);

console.log("INITIAL_LOAD_CONSTRAINT_HOTFIX_OK");
