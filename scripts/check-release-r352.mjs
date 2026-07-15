import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const build = "2026-07-15-school-year-verification-lifecycle-r352";
const failures = [];
const runtimeFiles = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if ([".git", "node_modules", "scripts"].includes(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (/\.(?:js|html)$/.test(name)) runtimeFiles.push(full);
  }
}
walk(root);

for (const file of runtimeFiles) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  if (/^(?:<{7}|={7}|>{7})/m.test(text)) failures.push(`${rel}: Git conflict marker`);
  if (/2026-07-14-school-year-isolation-r351/.test(text)) failures.push(`${rel}: stale r351 runtime build`);

  for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*)["'](\.\/.+?\.js(?:\?[^"']*)?)["']/g)) {
    const spec = match[1];
    if (!spec.includes(`v=${build}`)) failures.push(`${rel}: unversioned or mismatched import ${spec}`);
  }
}

const state = fs.readFileSync(path.join(root, "js/state.js"), "utf8");
const school = fs.readFileSync(path.join(root, "js/school-year.js"), "utf8");
const management = fs.readFileSync(path.join(root, "school-years.html"), "utf8");
const reset = fs.readFileSync(path.join(root, "reset-school-year.html"), "utf8");

if (state.includes("invalidateActiveWorkspaceIntegrity")) failures.push("state.js: edit-driven verification invalidation remains");
if (state.includes("invalidateSchoolYearVerification")) failures.push("state.js: stale invalidation import remains");
if (!school.includes("creation-verification-migrated-r352")) failures.push("school-year.js: stale status migration missing");
if (!management.includes("creationVerification")) failures.push("school-years.html: creation verification metadata missing");
if (!management.includes("creationPhase:true")) failures.push("school-years.html: initial creation phase marker missing");
if (management.includes("변경됨 · 재점검 필요")) failures.push("school-years.html: obsolete recheck badge remains");
if (reset.includes("clearSchoolYearVerification(ACTIVE_SCHOOL_YEAR)")) failures.push("reset-school-year.html: reset still clears creation verification");

const stateVersions = new Set();
for (const file of runtimeFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/state\.js\?v=([^"'\s)]+)/g)) stateVersions.add(match[1]);
}
if (stateVersions.size !== 1 || !stateVersions.has(build)) {
  failures.push(`state.js module URLs inconsistent: ${[...stateVersions].join(", ")}`);
}

if (failures.length) {
  console.error("RELEASE_GUARD_FAILED");
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log("RELEASE_GUARD_OK");
console.log(`build=${build}`);
console.log(`checked=${runtimeFiles.length}`);
