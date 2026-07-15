import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const mod = await import(pathToFileURL(path.join(root, "js", "room-availability.js")).href);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const fixture = {
  rooms: {
    rooms: [
      { id:"room-a", name:"A", unavailableSlots:[{ day:0, period:0 }] },
      { id:"room-b", name:"B" },
    ]
  },
  timetable: {
    teacherConstraints: {
      "Teacher A": { unavailableSlots:[{ day:1, period:1 }] },
      "__room_unavailable__:room-a": { unavailableSlots:[{ day:0, period:0 }, { day:2, period:3 }] },
      "__room_unavailable__:room-b": { unavailableSlots:[{ day:4, period:6 }] },
      "__room_unavailable__:missing-room": { unavailableSlots:[{ day:3, period:2 }] },
      "__class_unavailable__:class-a": { unavailableSlots:[{ day:0, period:2 }] },
    },
    teacherConstraintsById: {},
  }
};

const state = clone(fixture);
const first = mod.migrateLegacyRoomAvailability(state.rooms, state.timetable);
assert(first.changed, "legacy room migration did not change state");
assert(first.legacyKeyCount === 3, "legacy room key count mismatch");
assert(first.migratedRoomCount === 2, "migrated room count mismatch");
assert(first.orphanRoomIds.join(",") === "missing-room", "missing room was not preserved as orphan");
assert(state.rooms.rooms[0].unavailableSlots.length === 2, "existing and migrated room slots were not merged");
assert(state.rooms.rooms[1].unavailableSlots.length === 1, "room-b slot was not migrated");
assert(!Object.keys(state.timetable.teacherConstraints).some(mod.isLegacyRoomAvailabilityKey), "legacy room keys remain in teacherConstraints");
assert(state.timetable.teacherConstraints["Teacher A"], "real teacher constraint was removed");
assert(state.timetable.teacherConstraints["__class_unavailable__:class-a"], "class constraint was removed");
assert(state.timetable.roomAvailabilityOrphans["missing-room"].unavailableSlots.length === 1, "orphan slot was not preserved");

const stats = mod.inspectRoomAvailabilitySeparation(state.rooms, state.timetable);
assert(stats.legacyKeyCount === 0, "inspection still sees legacy room keys");
assert(stats.unavailableRoomCount === 2, "unavailable room count mismatch");
assert(stats.roomSlotCount === 3, "canonical room slot count mismatch");
assert(stats.orphanRoomCount === 1 && stats.orphanSlotCount === 1, "orphan inspection mismatch");

const second = mod.migrateLegacyRoomAvailability(state.rooms, state.timetable);
assert(!second.changed, "room availability migration is not idempotent");
assert(state.rooms.rooms[0].unavailableSlots.length === 2, "idempotent run duplicated room slots");

console.log("ROOM_AVAILABILITY_SEPARATION_CURRENT_OK");
