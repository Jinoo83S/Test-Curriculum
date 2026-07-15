import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const build = "2026-07-15-school-year-path-guard-r353";
const failures = [];
const textFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes:true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(?:js|mjs|html|css|txt)$/i.test(entry.name)) textFiles.push(full);
  }
}
walk(root);

for (const file of textFiles) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const text = fs.readFileSync(file, "utf8");
  if (/^(?:<<<<<<< .+|=======|>>>>>>> .+)$/m.test(text)) failures.push(`${rel}: git conflict marker`);
  if (!rel.startsWith("scripts/") && text.includes("2026-07-15-school-year-verification-lifecycle-r352")) failures.push(`${rel}: old r352 build URL`);
  if (/\.\/js\/[A-Za-z0-9._-]+\.js\?v=/.test(text) && !text.includes(build)) failures.push(`${rel}: mixed module build URL`);
}

for (const required of [
  "js/school-year-paths.js",
  "js/destructive-operation-guard.js",
  "scripts/test-school-year-path-isolation-r353.mjs",
  "scripts/test-destructive-operation-guard-r353.mjs",
  "scripts/test-school-year-verification-lifecycle-r353.mjs",
]) {
  if (!fs.existsSync(path.join(root, required))) failures.push(`${required}: missing`);
}

const config = fs.readFileSync(path.join(root, "js/config.js"), "utf8");
const state = fs.readFileSync(path.join(root, "js/state.js"), "utf8");
if (!config.includes("activeWorkspaceRefs = getSchoolYearRefs")) failures.push("config.js: active workspace refs not centralised");
if (!state.includes("activeWorkspaceRefs.collections")) failures.push("state.js: split collections not centralised");

for (const file of textFiles) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  if (rel.startsWith("scripts/") || ["js/config.js", "js/school-year-paths.js"].includes(rel)) continue;
  const text = fs.readFileSync(file, "utf8");
  const direct = /(?:doc|collection)\(db,\s*["'](?:boards|schoolYears)["']/g;
  const matches = [...text.matchAll(direct)];
  if (!matches.length) continue;
  if (rel === "timetable-print.html" && matches.length === 1 && text.includes('doc(db, "boards", "printDesignerProfiles")')) continue;
  failures.push(`${rel}: direct academic-year Firestore path constructor`);
}

const scripts = fs.readdirSync(path.join(root, "scripts")).filter(name => name.endsWith(".mjs")).sort();
const expectedScripts = [
  "check-release-r353.mjs",
  "test-destructive-operation-guard-r353.mjs",
  "test-school-year-path-isolation-r353.mjs",
  "test-school-year-verification-lifecycle-r353.mjs",
].sort();
if (JSON.stringify(scripts) !== JSON.stringify(expectedScripts)) failures.push(`scripts: obsolete files remain (${scripts.join(", ")})`);
if (fs.readdirSync(root).some(name => name.toLowerCase().endsWith(".bat"))) failures.push("root: BAT file must not be included");

if (failures.length) {
  console.error("RELEASE_GUARD_R353_FAILED");
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}
console.log("RELEASE_GUARD_R353_OK");
