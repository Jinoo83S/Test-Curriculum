import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const build = "2026-07-15-room-availability-separation-r355";
const failures = [];
const textFiles = [];
const jsFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes:true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      if (/\.(?:js|mjs|html|css|txt)$/i.test(entry.name)) textFiles.push(full);
      if (/\.(?:js|mjs)$/i.test(entry.name)) jsFiles.push(full);
    }
  }
}
walk(root);

for (const file of textFiles) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const text = fs.readFileSync(file, "utf8");
  if (/^(?:<<<<<<< .+|=======|>>>>>>> .+)$/m.test(text)) failures.push(`${rel}: git conflict marker`);
  if (!rel.startsWith("scripts/") && /2026-07-(?:14|15)-[A-Za-z0-9-]+-r(?:34[3-9]|35[0-4])/.test(text)) failures.push(`${rel}: obsolete runtime build URL`);
  for (const match of text.matchAll(/["'](?:\.\/)?(?:js\/)?[A-Za-z0-9._-]+\.js\?v=([^"']+)/g)) {
    if (match[1] !== build) failures.push(`${rel}: mixed module build URL (${match[1]})`);
  }
  if (rel.endsWith(".js") && rel !== "js/room-availability.js" && text.includes("__room_unavailable__:")) {
    failures.push(`${rel}: legacy room pseudo-teacher key is used outside migration module`);
  }
}

for (const file of jsFiles) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const checked = spawnSync(process.execPath, ["--check", file], { encoding:"utf8" });
  if (checked.status !== 0) failures.push(`${rel}: JavaScript syntax error: ${(checked.stderr || checked.stdout).trim()}`);
}

for (const required of [
  "js/teacher-identity.js",
  "js/room-availability.js",
  "js/school-year-paths.js",
  "js/destructive-operation-guard.js",
  "scripts/test-room-availability-separation-r355.mjs",
  "scripts/test-teacher-id-migration-r355.mjs",
  "scripts/test-school-year-path-isolation-r355.mjs",
  "scripts/test-destructive-operation-guard-r355.mjs",
  "scripts/test-school-year-verification-lifecycle-r355.mjs",
]) {
  if (!fs.existsSync(path.join(root, required))) failures.push(`${required}: missing`);
}

const state = fs.readFileSync(path.join(root, "js/state.js"), "utf8");
const teachers = fs.readFileSync(path.join(root, "js/teachers.js"), "utf8");
const identity = fs.readFileSync(path.join(root, "js/teacher-identity.js"), "utf8");
const roomAvailability = fs.readFileSync(path.join(root, "js/room-availability.js"), "utf8");
const timetable = fs.readFileSync(path.join(root, "js/timetable.js"), "utf8");
const constraintModel = fs.readFileSync(path.join(root, "js/timetable-constraint-model.js"), "utf8");
const cpSat = fs.readFileSync(path.join(root, "js/cp-sat-webapp-import.js"), "utf8");
const timetableData = fs.readFileSync(path.join(root, "js/timetable-data.js"), "utf8");
const integrity = fs.readFileSync(path.join(root, "js/school-year-integrity.js"), "utf8");

for (const [condition, message] of [
  [state.includes("synchronizeTeacherIdentityState"), "state.js: teacher identity migration hook missing"],
  [state.includes("synchronizeRoomAvailabilityState"), "state.js: room availability migration hook missing"],
  [state.includes("unavailableSlots: normalizeRoomUnavailableSlots"), "state.js: room unavailable slots are not normalized in rooms domain"],
  [state.includes("roomAvailabilityOrphans"), "state.js: orphan room availability preservation missing"],
  [state.indexOf("synchronizeRoomAvailabilityState({ persist: canEdit(), reason: \"initial-load\" })") < state.indexOf("synchronizeTeacherIdentityState({ persist: canEdit(), reason: \"initial-load\" })"), "state.js: room migration must run before teacher migration"],
  [state.includes("teacherConstraintsById"), "state.js: ID-keyed teacher constraints missing"],
  [teachers.includes("countTeacherIdentityReferences"), "teachers.js: referenced-teacher delete guard missing"],
  [teachers.includes("findTeacherByName"), "teachers.js: duplicate teacher-name guard missing"],
  [teachers.includes("rows.push([t.id, t.name"), "teachers.js: teacher ID missing from Excel export"],
  [teachers.includes("aliases"), "teachers.js: rename alias preservation missing"],
  [identity.includes("isLegacyRoomAvailabilityKey"), "teacher-identity.js: legacy room key protection does not use shared migration helper"],
  [roomAvailability.includes("migrateLegacyRoomAvailability"), "room-availability.js: migration function missing"],
  [roomAvailability.includes("normalizeRoomAvailabilityOrphans"), "room-availability.js: orphan preservation missing"],
  [timetable.includes('scheduleSave("rooms", { immediate: true })'), "timetable.js: room availability is not saved through rooms domain"],
  [!timetable.includes("__room_unavailable__:"), "timetable.js: legacy pseudo-teacher room storage remains"],
  [constraintModel.includes("state?.rooms?.rooms"), "timetable-constraint-model.js: room availability is not read from rooms domain"],
  [!constraintModel.includes("__room_unavailable__:"), "timetable-constraint-model.js: legacy pseudo-teacher room storage remains"],
  [cpSat.includes("migrateLegacyRoomAvailability(data.rooms, data.timetable)"), "cp-sat-webapp-import.js: solver payload room migration missing"],
  [timetableData.includes("getTeacherIdsForTtCard"), "timetable-data.js: entry teacher ID builder missing"],
  [integrity.includes("teacherId"), "school-year-integrity.js: teacher ID validation missing"],
]) if (!condition) failures.push(message);

const scripts = fs.readdirSync(path.join(root, "scripts")).filter(name => name.endsWith(".mjs")).sort();
const expectedScripts = [
  "check-release-r355.mjs",
  "test-destructive-operation-guard-r355.mjs",
  "test-room-availability-separation-r355.mjs",
  "test-school-year-path-isolation-r355.mjs",
  "test-school-year-verification-lifecycle-r355.mjs",
  "test-teacher-id-migration-r355.mjs",
].sort();
if (JSON.stringify(scripts) !== JSON.stringify(expectedScripts)) failures.push(`scripts: obsolete files remain (${scripts.join(", ")})`);
if (fs.readdirSync(root).some(name => name.toLowerCase().endsWith(".bat"))) failures.push("root: BAT file must not be included");
if (fs.readdirSync(root).some(name => /[^\x00-\x7F]/.test(name))) failures.push("root: non-ASCII filename remains");

if (failures.length) {
  console.error("RELEASE_GUARD_R355_FAILED");
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}
console.log("RELEASE_GUARD_R355_OK");
