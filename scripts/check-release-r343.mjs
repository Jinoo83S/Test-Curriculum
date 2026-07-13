import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const expected = "2026-07-13-system-audit-r343";
const textExt = new Set([".html", ".js", ".css"]);
const failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (textExt.has(path.extname(entry.name))) check(full);
  }
}
function check(file) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const text = fs.readFileSync(file, "utf8");
  const activeOld = [
    "2026-07-06-stable-state-pdf-r234",
    "2026-07-06-condition-popup-multiroom-persist-r225",
    "2026-07-13-excel-db-toolbar-r342",
  ];
  for (const token of activeOld) {
    if (text.includes(token)) failures.push(`${rel}: old runtime version ${token}`);
  }
  if (rel === "js/timetable.js") {
    if (text.includes("timetable-export.js")) failures.push(`${rel}: legacy export import remains`);
    if (text.includes("ttExportBtn")) failures.push(`${rel}: dead ttExportBtn listener remains`);
  }
  if (["index.html", "prework.html", "results.html", "roster.html", "setup.html", "timetable.html", "timetable-print.html", "js/version.js"].includes(rel)) {
    if (!text.includes(expected) && rel !== "timetable-print.html") failures.push(`${rel}: expected build version missing`);
  }
}

walk(root);
if (failures.length) {
  console.error("RELEASE_GUARD_FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("RELEASE_GUARD_OK", expected);
