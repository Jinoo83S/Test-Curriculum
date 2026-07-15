import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const build = "2026-07-14-school-year-isolation-r351";
const failures = [];
const textFiles = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if ([".git", "node_modules"].includes(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (/\.(?:js|mjs|html)$/.test(name)) textFiles.push(full);
  }
}
walk(root);

const activeFiles = textFiles.filter(file => !/scripts[\\/](?:check-release-r(?:343|345|346|349|350)|test-school-year-(?:integrity|verification)-r349)\.mjs$/.test(file));
for (const file of activeFiles) {
  const text = fs.readFileSync(file, "utf8");
  if (/^(?:<{7}|={7}|>{7})/m.test(text)) failures.push(`${path.relative(root,file)}: Git conflict marker`);
  if (/school-year-(?:integrity-r349|ui-bootstrap-r350|login-hotfix-r346)/.test(text)) failures.push(`${path.relative(root,file)}: stale school-year build`);

  for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*)["'](\.\/.+?\.js(?:\?[^"']*)?)["']/g)) {
    const spec = match[1];
    if (!spec.includes(`v=${build}`)) failures.push(`${path.relative(root,file)}: unversioned or mismatched import ${spec}`);
  }
}

const state = fs.readFileSync(path.join(root,"js/state.js"),"utf8");
const config = fs.readFileSync(path.join(root,"js/config.js"),"utf8");
const schoolYear = fs.readFileSync(path.join(root,"js/school-year.js"),"utf8");
const board = fs.readFileSync(path.join(root,"js/app-board-ui.js"),"utf8");
if (!state.includes("assertSchoolYearWriteContext")) failures.push("state.js: write guard missing");
if (!config.includes("assertSchoolYearRuntimeConsistency")) failures.push("config.js: runtime guard missing");
if (!schoolYear.includes("school-year-runtime-mismatch")) failures.push("school-year.js: mismatch error missing");
if (!board.includes("GRADE_GROUPS[activeTab]")) failures.push("app-board-ui.js: active tab scope missing");
if (board.includes("DEFAULT_GRADES.forEach")) failures.push("app-board-ui.js: full six-grade reset still present");
if (!fs.existsSync(path.join(root,"restore-curriculum-backup.html"))) failures.push("restore-curriculum-backup.html missing");

const stateVersions = new Set();
for (const file of activeFiles) {
  const text = fs.readFileSync(file,"utf8");
  for (const match of text.matchAll(/state\.js\?v=([^"'\s)]+)/g)) stateVersions.add(match[1]);
}
if (stateVersions.size !== 1 || !stateVersions.has(build)) failures.push(`state.js module URLs inconsistent: ${[...stateVersions].join(", ")}`);

if (failures.length) {
  console.error("RELEASE_GUARD_FAILED");
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}
console.log("RELEASE_GUARD_OK");
console.log(`build=${build}`);
console.log(`checked=${activeFiles.length}`);
