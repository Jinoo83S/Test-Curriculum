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
  "js/timetable-revision-history.js",
  "js/timetable-constraint-model.js",
  "js/timetable.js",
  "timetable-revision-history.css",
  "timetable.html",
]) {
  assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`);
}

for (const rel of ["js/state.js", "js/version.js", "js/timetable-save-revision.js", "js/timetable-revision-history.js", "js/timetable.js"]) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, rel)], { encoding: "utf8" });
  assert.equal(result.status, 0, `${rel} syntax failed\n${result.stderr}`);
}

const state = read("js/state.js");
const html = read("timetable.html");
const version = read("js/version.js");
const timetable = read("js/timetable.js");
const revisionModule = read("js/timetable-save-revision.js");
const revisionUi = read("js/timetable-revision-history.js");
const constraintModel = read("js/timetable-constraint-model.js");
const revisionCss = read("timetable-revision-history.css");

assert.match(state, /commitWriteOpsAtomic\(ops, `timetable revision \$\{revisionId\}`\)/);
assert.match(state, /assertAtomicTimetableRevisionCapacity/);
assert.match(state, /encodeTimetableRevisionSnapshot/);
assert.match(state, /decodeTimetableRevisionSnapshot/);
assert.match(state, /listTimetableSaveRevisions/);
assert.match(state, /restoreTimetableSaveRevision/);
assert.match(state, /pre-restore-backup/);
assert.match(state, /timetableRevisionSlot-/);
assert.doesNotMatch(state, /entries \$\{entryWrites\}, cards \$\{cardWrites\}, meta \$\{metaWrites\}/);
assert.match(revisionModule, /CompressionStream/);
assert.match(revisionModule, /TIMETABLE_REVISION_MAX_PAYLOAD_BYTES/);
assert.match(revisionUi, /복구 전 자동 백업/);
assert.match(constraintModel, /export const CLASS_UNAVAILABLE_PREFIX/);
assert.match(timetable, /import \{ CLASS_UNAVAILABLE_PREFIX \} from "\.\/timetable-constraint-model\.js\?v=2026-07-15-timetable-loading-hotfix-r358"/);
assert.match(revisionCss, /\.tt-revision-panel/);
assert.doesNotMatch(html, /\.tt-revision-panel\s*\{/);
assert.match(timetable, /ttFirestoreRevisionHistory/);
assert.match(timetable, /createTimetableRevisionHistoryUi/);
assert.match(html, /HIS_APP_VERSION = "2026-07-15-timetable-loading-hotfix-r358"/);
assert.match(html, /HIS_RUNTIME_ASSET_VERSION = "2026-07-15-room-availability-separation-r355"/);
assert.match(html, /state\.js\?v=2026-07-15-room-availability-separation-r355":"\.\/js\/state\.js\?v=2026-07-15-timetable-revision-restore-r357/);
assert.match(html, /timetable\.js\?v=2026-07-15-room-availability-separation-r355":"\.\/js\/timetable\.js\?v=2026-07-15-timetable-loading-hotfix-r358/);
assert.match(version, /HIS_RUNTIME_ASSET_VERSION/);

const importMapMatch = html.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
assert.ok(importMapMatch, "timetable import map missing");
const importMap = JSON.parse(importMapMatch[1]);
assert.equal(
  importMap.imports["./js/state.js?v=2026-07-15-room-availability-separation-r355"],
  "./js/state.js?v=2026-07-15-timetable-revision-restore-r357"
);
assert.equal(
  importMap.imports["./js/version.js?v=2026-07-15-room-availability-separation-r355"],
  "./js/version.js?v=2026-07-15-timetable-loading-hotfix-r358"
);
assert.equal(
  importMap.imports["./js/timetable.js?v=2026-07-15-room-availability-separation-r355"],
  "./js/timetable.js?v=2026-07-15-timetable-loading-hotfix-r358"
);

const regressionTests = [
  "test-destructive-operation-guard.mjs",
  "test-room-availability-separation.mjs",
  "test-school-year-path-isolation.mjs",
  "test-school-year-verification-lifecycle.mjs",
  "test-teacher-id-migration.mjs",
  "test-timetable-save-revision.mjs",
  "test-timetable-revision-history.mjs",
  "test-timetable-runtime-symbols.mjs",
];
for (const filename of regressionTests) {
  const test = spawnSync(process.execPath, [path.join(here, filename)], { encoding: "utf8" });
  assert.equal(test.status, 0, `${filename} failed\n${test.stdout}\n${test.stderr}`);
}

const scriptNames = fs.readdirSync(here).filter(name => name.endsWith(".mjs")).sort();
assert.deepEqual(scriptNames, ["check-release-current.mjs", ...regressionTests].sort(), "scripts folder must use stable filenames only");

console.log("RELEASE_GUARD_CURRENT_OK");
