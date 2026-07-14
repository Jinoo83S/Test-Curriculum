import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const expected = "2026-07-14-school-year-integrity-r349";
const oldMarkers = ["2026-07-14-school-year-login-hotfix-r346", "2026-07-14-school-year-delete-r348"];
const failures = [];
const required = [
  "index.html", "prework.html", "results.html", "roster.html", "setup.html",
  "timetable.html", "timetable-print.html", "school-years.html", "reset-school-year.html",
  "js/version.js", "js/config.js", "js/local-dev.js", "js/school-year.js", "js/school-year-integrity.js"
];
for (const rel of required) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { failures.push(`${rel}: missing`); continue; }
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(expected) && rel !== "reset-school-year.html") failures.push(`${rel}: r349 runtime marker missing`);
  for (const old of oldMarkers) if (text.includes(old)) failures.push(`${rel}: old runtime marker remains (${old})`);
}
const management = fs.readFileSync(path.join(root, "school-years.html"), "utf8");
for (const marker of ["정합성 점검", "strictCopy", "performIntegrityCheck", "verifiedForSwitch"]) {
  if (!management.includes(marker)) failures.push(`school-years.html: missing ${marker}`);
}
const schoolYear = fs.readFileSync(path.join(root, "js/school-year.js"), "utf8");
for (const marker of ["SCHOOL_YEAR_VERIFICATION_KEY", "isSchoolYearVerified", "setSchoolYearVerification", "invalidateSchoolYearVerification", "clearSchoolYearVerification", "점검 필요"]) {
  if (!schoolYear.includes(marker)) failures.push(`js/school-year.js: missing ${marker}`);
}
const integrity = fs.readFileSync(path.join(root, "js/school-year-integrity.js"), "utf8");
for (const marker of ["validateWorkspaceSnapshot", "roster-student-missing", "ttcard-credit-placement-mismatch", "copy-count-mismatch", "allowEmpty"]) {
  if (!integrity.includes(marker)) failures.push(`js/school-year-integrity.js: missing ${marker}`);
}

const state = fs.readFileSync(path.join(root, "js/state.js"), "utf8");
for (const marker of ["invalidateActiveWorkspaceIntegrity", "workspace-edit", 'mergeFields: ["integrity", "updatedAt"]']) {
  if (!state.includes(marker)) failures.push(`js/state.js: missing ${marker}`);
}

const reset = fs.readFileSync(path.join(root, "reset-school-year.html"), "utf8");
if (!reset.includes("clearSchoolYearVerification")) failures.push("reset-school-year.html: verification invalidation missing");
if (reset.includes('["workspace meta", workspaceMeta]')) failures.push("reset-school-year.html: workspace root would be deleted");
if (failures.length) {
  console.error("RELEASE_GUARD_FAILED");
  failures.forEach(row => console.error(`- ${row}`));
  process.exit(1);
}
console.log("RELEASE_GUARD_OK", expected);
