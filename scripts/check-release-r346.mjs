import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const expected = "2026-07-14-school-year-login-hotfix-r346";
const failures = [];
const required = [
  "index.html", "prework.html", "results.html", "roster.html", "setup.html",
  "timetable.html", "timetable-print.html", "js/version.js", "js/local-dev.js", "js/school-year.js"
];
for (const rel of required) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { failures.push(`${rel}: missing`); continue; }
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(expected)) failures.push(`${rel}: expected runtime version missing`);
}
const schoolYear = fs.readFileSync(path.join(root, "js/school-year.js"), "utf8");
if (schoolYear.includes("host.insertBefore(wrap, modeSwitch)")) failures.push("js/school-year.js: unsafe descendant insertBefore remains");
if (!schoolYear.includes("modeSwitch.parentNode.insertBefore(wrap, modeSwitch)")) failures.push("js/school-year.js: real-parent insertion guard missing");
const localDev = fs.readFileSync(path.join(root, "js/local-dev.js"), "utf8");
if (!localDev.includes("login will continue")) failures.push("js/local-dev.js: auth bootstrap isolation missing");
if (failures.length) {
  console.error("RELEASE_GUARD_FAILED");
  failures.forEach(x => console.error(`- ${x}`));
  process.exit(1);
}
console.log("RELEASE_GUARD_OK", expected);
