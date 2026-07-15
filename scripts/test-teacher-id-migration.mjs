import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const identity = await import(pathToFileUrl(path.join(root, "js", "teacher-identity.js")));
const roomAvailability = await import(pathToFileUrl(path.join(root, "js", "room-availability.js")));

function pathToFileUrl(file) {
  const resolved = path.resolve(file).replaceAll("\\", "/");
  return new URL(`file://${resolved.startsWith("/") ? "" : "/"}${resolved}`).href;
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const base = {
  teachers: { teachers: [
    { id:"teacher-a", name:"Teacher A", aliases:[] },
    { id:"teacher-b", name:"Teacher B", aliases:["B Teacher"] },
  ]},
  templates: { templates: [{
    id:"tpl-1", teacher:"Teacher A", sem1Teacher:"Teacher A", sem2Teacher:"Teacher B",
    compoundParts:[{ id:"part-1", teacher:"Teacher B" }]
  }]},
  rooms: { rooms:[{ id:"room-1", teacherName:"Teacher A" }] },
  timetable: {
    ttcards:[{ id:"card-1", teacherName:"Teacher A, Teacher B", teachers:["Teacher A", "Teacher B"] }],
    entries:[{ id:"entry-1", teacherName:"Teacher A" }],
    savedSchedules:[{ id:"saved-1", entries:[{ id:"saved-entry-1", teacherName:"Teacher B" }] }],
    bestAutoAssignSnapshot:{ entries:[{ id:"best-entry-1", teacherName:"Teacher A" }] },
    teacherConstraints:{
      "Teacher A":{ unavailableSlots:["월-1"] },
      "__room_unavailable__:room-1":{ unavailableSlots:[{ day:1, period:1 }] }
    },
    ttcardTeacherOptions:{ representativeTeacher:"Teacher B" },
  }
};

const state = clone(base);
const roomMigration = roomAvailability.migrateLegacyRoomAvailability(state.rooms, state.timetable);
assert(roomMigration.changed && roomMigration.migratedRoomCount === 1, "room availability migration did not run before teacher migration");
assert(!state.timetable.teacherConstraints["__room_unavailable__:room-1"], "legacy room key remains in teacher constraints");
assert(state.rooms.rooms[0].unavailableSlots.length === 1, "room unavailable slot was not moved to room domain");
const first = identity.synchronizeTeacherIdentityReferences(state);
assert(first.ok, "initial teacher identity migration failed");
assert(first.missingIds.length === 0, "migration produced missing IDs");
assert(first.unresolvedNames.length === 0, "reserved constraint keys were treated as teacher names");
assert(state.templates.templates[0].teacherIds[0] === "teacher-a", "template teacher ID missing");
assert(state.templates.templates[0].sem2TeacherIds[0] === "teacher-b", "semester teacher ID missing");
assert(state.templates.templates[0].compoundParts[0].teacherIds[0] === "teacher-b", "compound teacher ID missing");
assert(state.rooms.rooms[0].teacherId === "teacher-a", "room owner teacher ID missing");
assert(state.timetable.ttcards[0].teacherIds.join(",") === "teacher-a,teacher-b", "timetable card teacher IDs missing");
assert(state.timetable.entries[0].teacherIds[0] === "teacher-a", "timetable entry teacher ID missing");
assert(state.timetable.savedSchedules[0].entries[0].teacherIds[0] === "teacher-b", "saved schedule teacher ID missing");
assert(state.timetable.teacherConstraintsById["teacher-a"], "teacher constraint ID map missing");
assert(state.timetable.ttcardTeacherOptions.representativeTeacherId === "teacher-b", "representative teacher ID missing");

const second = identity.synchronizeTeacherIdentityReferences(state);
assert(second.changedDomains.length === 0, "migration is not idempotent");

const before = identity.countTeacherIdentityReferences(state, "teacher-a", "Teacher A");
state.teachers.teachers[0].aliases.push("Teacher A");
state.teachers.teachers[0].name = "Teacher A Renamed";
const renamed = identity.synchronizeTeacherIdentityReferences(state);
const after = identity.countTeacherIdentityReferences(state, "teacher-a", "Teacher A Renamed");
assert(renamed.ok, "rename synchronization failed");
assert(before.total === after.total, "teacher rename changed reference count");
assert(state.templates.templates[0].teacher === "Teacher A Renamed", "template snapshot not renamed");
assert(state.rooms.rooms[0].teacherName === "Teacher A Renamed", "room owner snapshot not renamed");
assert(state.timetable.entries[0].teacherName === "Teacher A Renamed", "entry snapshot not renamed");
assert(state.timetable.teacherConstraints["Teacher A Renamed"], "constraint display map not renamed");

const duplicateState = clone(base);
duplicateState.teachers.teachers.push({ id:"teacher-c", name:"Teacher A" });
const duplicate = identity.synchronizeTeacherIdentityReferences(duplicateState);
assert(!duplicate.ok && duplicate.duplicateTeacherNames.length === 1, "duplicate teacher name was not detected");

console.log("TEACHER_ID_MIGRATION_CURRENT_OK");
