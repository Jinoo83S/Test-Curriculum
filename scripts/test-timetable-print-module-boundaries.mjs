import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

const html = read("timetable-print.html");
const css = read("timetable-print.css");
const app = read("js/timetable-print-app.js");
const semester = read("js/timetable-print-semester.js");

assert.match(html, /<link rel="stylesheet" href="timetable-print\.css\?v=2026-07-15-print-module-boundary-r359">/);
assert.match(html, /<script type="module" src="\.\/js\/timetable-print-app\.js\?v=2026-07-15-print-modules-r361"><\/script>/);
assert.doesNotMatch(html, /<script type="module">[\s\S]*?<\/script>/, "large inline module must not return");
assert.doesNotMatch(html, /:root\{--nav:/, "main print stylesheet must stay external");
assert.match(html, /<style id="printPageStyle">@page\{size:/, "runtime page style element must remain available");
assert.ok(css.length > 50000, "external print stylesheet looks incomplete");
assert.ok(app.length > 160000, "external print application module looks incomplete");
assert.match(semester, /export function resolveSemesterCardValues/);

for (const signature of [
  /const buildDocxBlob = createDocxBuilder\(/,
  /buildXlsxDatabaseBlob\(excelDbRowsForExport\(\)\)/,
  /const exportPdfReal = createPdfExporter\(/,
  /function exportOfficeReal\(/,
  /function runMainExport\(/,
  /function boot\(/,
]) assert.match(app, signature);

for (const removed of [
  /function buildXlsxBlob\(/,
  /function buildOfficeHtml\(/,
  /function officeExportCss\(/,
  /function zipStore\(/,
]) assert.doesNotMatch(app, removed);

for (const rel of [
  "js/timetable-print-archive.js",
  "js/timetable-print-file-utils.js",
  "js/timetable-print-word.js",
  "js/timetable-print-excel.js",
  "js/timetable-print-pdf.js",
]) {
  assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`);
  const syntaxResult = spawnSync(process.execPath, ["--check", path.join(root, rel)], { encoding: "utf8" });
  assert.equal(syntaxResult.status, 0, `${rel} syntax failed\n${syntaxResult.stderr}`);
}

for (const importPath of ["./auth.js?", "./state.js?", "./local-dev.js?", "./config.js?"]) {
  assert.ok(app.includes(`from "${importPath}`), `print app import must be relative to js/: ${importPath}`);
}
assert.doesNotMatch(app, /from "\.\/js\//, "external module must not resolve to js/js/*");

const names = [...app.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
assert.deepEqual([...new Set(duplicates)], [], `duplicate top-level print functions: ${[...new Set(duplicates)].join(", ")}`);

const syntax = spawnSync(process.execPath, ["--check", path.join(root, "js/timetable-print-app.js")], { encoding: "utf8" });
assert.equal(syntax.status, 0, syntax.stderr || "print app syntax failed");

console.log("TIMETABLE_PRINT_MODULE_BOUNDARIES_OK");
