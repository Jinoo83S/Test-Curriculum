import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../js/timetable-autoassign.js", import.meta.url), "utf8");
const start = source.indexOf("  function configuredRoomIdsForCardDuringAuto");
const end = source.indexOf("\n  function fixedRoomForCardDuringAuto", start);
assert.ok(start >= 0 && end > start, "configured room helper missing");
const functionSource = source.slice(start, end).trim();
const uniqueRoomIds = list => [...new Set((list || []).map(value => String(value || "").trim()).filter(Boolean))];
const factory = new Function(
  "normalizeRoomRuleForAuto",
  "uniqueRoomIds",
  "homeroomRoomIdForAutoSource",
  "uniqueTeacherRoomIdForNamesAuto",
  "cardTeacherNamesForAuto",
  `${functionSource}\nreturn configuredRoomIdsForCardDuringAuto;`
);
const collect = factory(
  rule => String(rule || "teacher"),
  uniqueRoomIds,
  () => "homeroom-room",
  () => "teacher-room",
  () => ["Teacher"]
);

const fiveRooms = ["r1", "r2", "r3", "r4", "r5"];
const mission = collect({
  roomRule: "fixed",
  fixedRoomId: "r1",
  fixedRoomIds: fiveRooms,
  manualRoomIds: fiveRooms,
  requiredRoomIds: fiveRooms,
  solverFixedRoomIds: fiveRooms,
  roomIds: fiveRooms,
  requiredRoomCount: 5,
}, {});
assert.deepEqual(mission, fiveRooms, "all five configured rooms must survive de-duplication");

assert.deepEqual(collect({ roomRule: "teacher" }, {}), ["teacher-room"]);
assert.deepEqual(collect({ roomRule: "homeroom" }, {}), ["homeroom-room"]);
assert.deepEqual(collect({ roomRule: "none" }, {}), []);

assert.match(source, /entryData\.roomIds = uniqueRoomIds\(configuredRoomIds\)/);
assert.match(source, /roomRelaxedCandidateCount/);
assert.match(source, /내장 자동배치 교실 정책으로 제외/);
assert.match(source, /CP-SAT의 성공 여부와는 별개입니다/);
console.log("TIMETABLE_AUTOASSIGN_ROOM_SOURCES_OK");
