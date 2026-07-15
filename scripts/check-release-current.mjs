import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

const sourceFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(?:js|mjs|html|css|txt)$/i.test(entry.name)) sourceFiles.push(full);
  }
}
walk(root);
for (const file of sourceFiles) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const text = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(text, /^(?:<<<<<<< .+|=======|>>>>>>> .+)$/m, `${rel}: git conflict marker`);
  if (/\.(?:js|mjs)$/i.test(file)) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${rel}: JavaScript syntax failed\n${result.stderr}`);
  }
}
assert.ok(!fs.readdirSync(root).some(name => name.toLowerCase().endsWith(".bat")), "BAT files are not allowed");

for (const rel of [
  "js/state.js",
  "js/version.js",
  "js/timetable-save-revision.js",
  "timetable.html",
]) {
  assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`);
}

for (const rel of ["js/state.js", "js/version.js", "js/timetable-save-revision.js"]) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, rel)], { encoding: "utf8" });
  assert.equal(result.status, 0, `${rel} syntax failed\n${result.stderr}`);
}

const state = read("js/state.js");
const html = read("timetable.html");
const version = read("js/version.js");

assert.match(state, /commitWriteOpsAtomic\(ops, `timetable revision \$\{revisionId\}`\)/);
assert.match(state, /assertAtomicTimetableRevisionCapacity/);
assert.match(state, /timetableRevisionSlot-/);
assert.doesNotMatch(state, /entries \$\{entryWrites\}, cards \$\{cardWrites\}, meta \$\{metaWrites\}/);
assert.match(html, /HIS_APP_VERSION = "2026-07-15-atomic-timetable-revisions-r356"/);
assert.match(html, /HIS_RUNTIME_ASSET_VERSION = "2026-07-15-room-availability-separation-r355"/);
assert.match(html, /state\.js\?v=2026-07-15-room-availability-separation-r355":"\.\/js\/state\.js\?v=2026-07-15-atomic-timetable-revisions-r356/);
assert.match(version, /HIS_RUNTIME_ASSET_VERSION/);

const importMapMatch = html.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
assert.ok(importMapMatch, "timetable import map missing");
const importMap = JSON.parse(importMapMatch[1]);
assert.equal(
  importMap.imports["./js/state.js?v=2026-07-15-room-availability-separation-r355"],
  "./js/state.js?v=2026-07-15-atomic-timetable-revisions-r356"
);
assert.equal(
  importMap.imports["./js/version.js?v=2026-07-15-room-availability-separation-r355"],
  "./js/version.js?v=2026-07-15-atomic-timetable-revisions-r356"
);

const regressionTests = [
  "test-destructive-operation-guard.mjs",
  "test-room-availability-separation.mjs",
  "test-school-year-path-isolation.mjs",
  "test-school-year-verification-lifecycle.mjs",
  "test-teacher-id-migration.mjs",
  "test-timetable-save-revision.mjs",
];
for (const filename of regressionTests) {
  const test = spawnSync(process.execPath, [path.join(here, filename)], { encoding: "utf8" });
  assert.equal(test.status, 0, `${filename} failed\n${test.stdout}\n${test.stderr}`);
}

const scriptNames = fs.readdirSync(here).filter(name => name.endsWith(".mjs")).sort();
assert.deepEqual(scriptNames, ["check-release-current.mjs", ...regressionTests].sort(), "scripts folder must use stable filenames only");

console.log("RELEASE_GUARD_CURRENT_OK");
