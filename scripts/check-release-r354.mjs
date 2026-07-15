import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const build = "2026-07-15-teacher-id-migration-r354";
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
  if (!rel.startsWith("scripts/") && /2026-07-(?:14|15)-[A-Za-z0-9-]+-r(?:34[3-9]|35[0-3])/.test(text)) failures.push(`${rel}: obsolete runtime build URL`);
  for (const match of text.matchAll(/["'](?:\.\/)?(?:js\/)?[A-Za-z0-9._-]+\.js\?v=([^"']+)/g)) {
    if (match[1] !== build) failures.push(`${rel}: mixed module build URL (${match[1]})`);
  }
}

for (const file of jsFiles) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const checked = spawnSync(process.execPath, ["--check", file], { encoding:"utf8" });
  if (checked.status !== 0) failures.push(`${rel}: JavaScript syntax error: ${(checked.stderr || checked.stdout).trim()}`);
}

for (const required of [
  "js/teacher-identity.js",
  "js/school-year-paths.js",
  "js/destructive-operation-guard.js",
  "scripts/test-teacher-id-migration-r354.mjs",
  "scripts/test-school-year-path-isolation-r354.mjs",
  "scripts/test-destructive-operation-guard-r354.mjs",
  "scripts/test-school-year-verification-lifecycle-r354.mjs",
]) {
  if (!fs.existsSync(path.join(root, required))) failures.push(`${required}: missing`);
}

const state = fs.readFileSync(path.join(root, "js/state.js"), "utf8");
const teachers = fs.readFileSync(path.join(root, "js/teachers.js"), "utf8");
const identity = fs.readFileSync(path.join(root, "js/teacher-identity.js"), "utf8");
const timetableData = fs.readFileSync(path.join(root, "js/timetable-data.js"), "utf8");
const integrity = fs.readFileSync(path.join(root, "js/school-year-integrity.js"), "utf8");

for (const [condition, message] of [
  [state.includes("synchronizeTeacherIdentityState"), "state.js: teacher identity migration hook missing"],
  [state.includes("teacherConstraintsById"), "state.js: ID-keyed teacher constraints missing"],
  [state.includes("teacherIds"), "state.js: teacher IDs are not normalized"],
  [teachers.includes("countTeacherIdentityReferences"), "teachers.js: referenced-teacher delete guard missing"],
  [teachers.includes("findTeacherByName"), "teachers.js: duplicate teacher-name guard missing"],
  [teachers.includes("rows.push([t.id, t.name"), "teachers.js: teacher ID missing from Excel export"],
  [teachers.includes("aliases"), "teachers.js: rename alias preservation missing"],
  [identity.includes("__room_unavailable__:"), "teacher-identity.js: reserved constraint keys not protected"],
  [timetableData.includes("getTeacherIdsForTtCard"), "timetable-data.js: entry teacher ID builder missing"],
  [integrity.includes("teacherId"), "school-year-integrity.js: teacher ID validation missing"],
]) if (!condition) failures.push(message);

const scripts = fs.readdirSync(path.join(root, "scripts")).filter(name => name.endsWith(".mjs")).sort();
const expectedScripts = [
  "check-release-r354.mjs",
  "test-destructive-operation-guard-r354.mjs",
  "test-school-year-path-isolation-r354.mjs",
  "test-school-year-verification-lifecycle-r354.mjs",
  "test-teacher-id-migration-r354.mjs",
].sort();
if (JSON.stringify(scripts) !== JSON.stringify(expectedScripts)) failures.push(`scripts: obsolete files remain (${scripts.join(", ")})`);
if (fs.readdirSync(root).some(name => name.toLowerCase().endsWith(".bat"))) failures.push("root: BAT file must not be included");
if (fs.readdirSync(root).some(name => /[^\x00-\x7F]/.test(name))) failures.push("root: non-ASCII filename remains");

if (failures.length) {
  console.error("RELEASE_GUARD_R354_FAILED");
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}
console.log("RELEASE_GUARD_R354_OK");
