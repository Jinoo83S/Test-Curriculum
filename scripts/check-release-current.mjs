import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const exists = rel => fs.existsSync(path.join(root, rel));

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
  "js/timetable-preflight-diagnostics.js",
  "js/timetable-solve-result-status.js",
  "js/timetable-cpsat-run-history.js",
  "js/timetable-autoassign.js",
  "js/cp-sat-webapp-import.js",
  "js/timetable-persistence-audit.js",
  "js/timetable.js",
  "timetable-revision-history.css",
  "timetable-print.css",
  "js/timetable-print-app.js",
  "js/timetable-print-semester.js",
  "js/timetable-print-archive.js",
  "js/timetable-print-file-utils.js",
  "js/timetable-print-word.js",
  "js/timetable-print-excel.js",
  "js/timetable-print-pdf.js",
  "js/timetable-print-word-layout.js",
  "timetable-print.html",
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
const preflightDiagnostics = read("js/timetable-preflight-diagnostics.js");
const solveResultStatus = read("js/timetable-solve-result-status.js");
const cpSatRunHistory = read("js/timetable-cpsat-run-history.js");
const autoAssign = read("js/timetable-autoassign.js");
const cpSatBridge = read("js/cp-sat-webapp-import.js");
const persistenceAuditModule = read("js/timetable-persistence-audit.js");
const revisionCss = read("timetable-revision-history.css");
const printHtml = read("timetable-print.html");
const printApp = read("js/timetable-print-app.js");

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
assert.match(preflightDiagnostics, /r367-timetable-preflight-v2/);
assert.match(solveResultStatus, /r367-cpsat-result-audit-v1/);
assert.match(solveResultStatus, /complete_success/);
assert.match(solveResultStatus, /diagnostic_mismatch/);
assert.match(cpSatRunHistory, /CP_SAT_RUN_HISTORY_LIMIT = 10/);
assert.match(cpSatRunHistory, /estimateCpSatSaveOperations/);
assert.match(cpSatRunHistory, /extractCpSatServerTiming/);
assert.match(preflightDiagnostics, /card-zero-candidate/);
assert.match(preflightDiagnostics, /protected-teacher-conflict/);
assert.match(autoAssign, /buildExactSolverCandidatePrecheck/);
assert.match(autoAssign, /consumeExactSolverCandidateCache/);
assert.match(autoAssign, /precheckCandidateCacheReused/);
assert.match(autoAssign, /configuredRoomIdsForCardDuringAuto/);
assert.match(autoAssign, /room-policy-excluded/);
assert.match(autoAssign, /후보 계산기 판정 불일치/);
assert.match(cpSatBridge, /localSolverPreflight/);
assert.match(cpSatBridge, /CP-SAT 실행 전 사전진단에서 차단되었습니다/);
assert.match(cpSatBridge, /auditCpSatResult/);
assert.match(cpSatBridge, /최종 판정/);
assert.match(cpSatBridge, /입력 카드/);
assert.match(cpSatBridge, /reconcileCpSatEntryIds/);
assert.match(cpSatBridge, /quickComplete/);
assert.match(cpSatBridge, /HIS_CP_SAT_Local_Server_r348\.zip/);
assert.match(cpSatBridge, /최근 CP-SAT 실행 기록/);
assert.match(cpSatBridge, /clientSaveEstimate/);
assert.match(cpSatBridge, /clientApplyTiming/);
assert.match(cpSatBridge, /repairContinuousSpanMetadata/);
assert.match(cpSatBridge, /verifyPersistedTimetableState/);
assert.match(cpSatBridge, /현재 시간표 메타 보정/);
assert.match(state, /compactCpSatAutoAssignMetaForStorage/);
assert.match(state, /cpSatCapacityWarningCount/);
assert.match(state, /persistenceReadbackAudit/);
assert.match(state, /verifyPersistedTimetableState/);
assert.match(state, /autoBlockSpanTotal/);
assert.match(persistenceAuditModule, /auditPersistedTimetable/);
assert.match(persistenceAuditModule, /timetableAssignmentSignatures/);
assert.doesNotMatch(cpSatBridge, /동일 상태를 다시 주입하고 2차 저장/);
assert.match(timetable, /import \{ CLASS_UNAVAILABLE_PREFIX \} from "\.\/timetable-constraint-model\.js\?v=2026-07-20-initial-load-conflict-hotfix-r371"/);
assert.match(revisionCss, /\.tt-revision-panel/);
assert.doesNotMatch(html, /\.tt-revision-panel\s*\{/);
assert.match(timetable, /ttFirestoreRevisionHistory/);
assert.match(timetable, /createTimetableRevisionHistoryUi/);
assert.match(html, /HIS_APP_VERSION = "2026-07-20-cpsat-meta-persistence-r375"/);
assert.match(html, /HIS_RUNTIME_ASSET_VERSION = "2026-07-20-cpsat-meta-persistence-r375"/);
assert.match(html, /state\.js\?v=2026-07-15-room-availability-separation-r355":"\.\/js\/state\.js\?v=2026-07-20-cpsat-meta-persistence-r375/);
assert.match(html, /timetable\.js\?v=2026-07-15-room-availability-separation-r355":"\.\/js\/timetable\.js\?v=2026-07-20-cpsat-meta-persistence-r375/);
assert.match(version, /HIS_RUNTIME_ASSET_VERSION/);
assert.match(version, /2026-07-20-cpsat-meta-persistence-r375/);
assert.match(printHtml, /<span class="badge">r365<\/span>/);
assert.match(printHtml, /timetable-print-app\.js\?v=2026-07-15-print-usability-r365/);
assert.match(printApp, /const VERSION = "2026-07-15-print-usability-r365"/);

const importMapMatch = html.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
assert.ok(importMapMatch, "timetable import map missing");
const importMap = JSON.parse(importMapMatch[1]);
assert.equal(
  importMap.imports["./js/state.js?v=2026-07-15-room-availability-separation-r355"],
  "./js/state.js?v=2026-07-20-cpsat-meta-persistence-r375"
);
assert.equal(
  importMap.imports["./js/version.js?v=2026-07-15-room-availability-separation-r355"],
  "./js/version.js?v=2026-07-20-cpsat-meta-persistence-r375"
);
assert.equal(
  importMap.imports["./js/timetable.js?v=2026-07-15-room-availability-separation-r355"],
  "./js/timetable.js?v=2026-07-20-cpsat-meta-persistence-r375"
);
assert.equal(
  importMap.imports["./js/timetable-autoassign.js?v=2026-07-15-room-availability-separation-r355"],
  "./js/timetable-autoassign.js?v=2026-07-16-cpsat-result-truth-r367"
);
assert.equal(
  importMap.imports["./js/cp-sat-webapp-import.js?v=2026-07-15-room-availability-separation-r355"],
  "./js/cp-sat-webapp-import.js?v=2026-07-20-cpsat-meta-persistence-r375"
);

const releaseInfo = JSON.parse(read("release-version.json"));
assert.equal(releaseInfo.release, "r375");
assert.equal(releaseInfo.appVersion, "2026-07-20-cpsat-meta-persistence-r375");
assert.equal(releaseInfo.serverRequired, "2026-07-20-aggregate-capacity-warning-r348");
assert.equal(releaseInfo.metadataPolicy, "persist-and-firestore-readback");
assert.match(html, /data-his-release-badge="1">r375<\/span>/);
assert.match(html, /HIS_RELEASE_BUILD = "r375-cpsat-meta-persistence-20260720"/);
assert.match(html, /Cache-Control/);
assert.ok(html.includes("await import(`./js/version.js?v=${encodeURIComponent(expectedVersion)}`)"));
assert.ok(html.includes("await import(`./js/timetable.js?v=${encodeURIComponent(expectedVersion)}`)"));
assert.match(timetable, /\.\/version\.js\?v=2026-07-20-initial-load-conflict-hotfix-r371/);
assert.match(timetable, /\.\/app-health-check\.js\?v=2026-07-20-initial-load-conflict-hotfix-r371/);
assert.match(cpSatBridge, /HIS_CP_SAT_BRIDGE_RELEASE = "r375"/);
assert.match(cpSatBridge, /cp-sat-webapp-r375/);
assert.match(cpSatBridge, /HIS_CP_SAT_SERVER_FILE = "HIS_CP_SAT_Local_Server_r348\.zip"/);
assert.match(cpSatBridge, /EXPECTED_SERVER_VERSION = "2026-07-20-aggregate-capacity-warning-r348"/);
assert.match(cpSatBridge, /function finalCapacityAudit\(/);
assert.match(cpSatBridge, /warning-apply-allowed/);
assert.match(cpSatBridge, /교실 수용인원 초과 경고/);
assert.doesNotMatch(cpSatBridge, /HIS_CP_SAT_Local_Server_r347\.zip/);
assert.doesNotMatch(cpSatBridge, /메타 source: cp-sat-webapp-r374/);
assert.match(cpSatBridge, /function finalRoomAvailabilityAudit/);
assert.match(cpSatBridge, /clientFinalConstraintAudit/);
assert.match(cpSatBridge, /교실 불가시간 위반/);
for (const forbidden of ["timetable-r370.html", "js/version-r370.js", "js/timetable-r370.js", "js/app-health-check-r370.js", "js/cp-sat-webapp-import-r370.js", "js/timetable-cpsat-run-history-r370.js"]) {
  assert.ok(!exists(forbidden), `${forbidden}: versioned filename must not exist`);
}
for (const navPage of ["index.html", "prework.html", "results.html", "roster.html", "setup.html", "timetable-print.html"]) {
  assert.match(read(navPage), /timetable\.html\?release=r375-cpsat-meta-persistence-20260720/, `${navPage}: r375 cache-busted timetable link missing`);
}
for (const rel of ["timetable.html", "js/version.js", "js/cp-sat-webapp-import.js"]) {
  assert.doesNotMatch(read(rel), /r369/, `${rel}: runtime r369 marker remains`);
}

const regressionTests = [
  "test-destructive-operation-guard.mjs",
  "test-room-availability-separation.mjs",
  "test-school-year-path-isolation.mjs",
  "test-school-year-verification-lifecycle.mjs",
  "test-teacher-id-migration.mjs",
  "test-timetable-save-revision.mjs",
  "test-timetable-revision-history.mjs",
  "test-timetable-runtime-symbols.mjs",
  "test-timetable-print-module-boundaries.mjs",
  "test-timetable-print-semester.mjs",
  "test-timetable-print-export-modules.mjs",
  "test-timetable-print-word-layout.mjs",
  "test-timetable-print-operational-data.mjs",
  "test-timetable-print-usability.mjs",
  "test-timetable-preflight-diagnostics.mjs",
  "test-timetable-autoassign-room-sources.mjs",
  "test-timetable-solve-result-status.mjs",
  "test-cpsat-stable-save.mjs",
  "test-initial-load-constraint-hotfix.mjs",
  "test-cpsat-run-history.mjs",
  "test-final-room-availability-audit-r372.mjs",
  "test-cpsat-capacity-warning-r374.mjs",
  "test-cpsat-metadata-persistence-r375.mjs",
];
for (const filename of regressionTests) {
  const test = spawnSync(process.execPath, [path.join(here, filename)], { encoding: "utf8" });
  assert.equal(test.status, 0, `${filename} failed\n${test.stdout}\n${test.stderr}`);
}

const scriptNames = fs.readdirSync(here).filter(name => name.endsWith(".mjs")).sort();
assert.deepEqual(scriptNames, ["check-release-current.mjs", ...regressionTests].sort(), "scripts folder must use stable filenames only");

console.log("RELEASE_GUARD_CURRENT_OK");
