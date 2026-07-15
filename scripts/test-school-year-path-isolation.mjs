import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(path.join(root, "js", "school-year-paths.js"), "utf8");
const paths = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const y2026 = paths.getSchoolYearPathSpec("2026");
const y2027 = paths.getSchoolYearPathSpec("2027");
const y2028 = paths.getSchoolYearPathSpec("2028");

assert(y2026.labels.domains.curriculum === "boards/curriculum", "2026 curriculum path mismatch");
assert(y2026.labels.collections.classes === "boards/_split/classes", "2026 classes path mismatch");
assert(y2026.labels.timetableMeta === "boards/_split/timetableMeta/main", "2026 timetable meta path mismatch");
assert(y2027.labels.domains.curriculum === "schoolYears/2027/domains/curriculum", "2027 curriculum path mismatch");
assert(y2027.labels.collections.classes === "schoolYears/2027/classes", "2027 classes path mismatch");
assert(y2027.labels.timetableMeta === "schoolYears/2027/meta/timetable", "2027 timetable meta path mismatch");
assert(y2028.labels.domains.curriculum === "schoolYears/2028/domains/curriculum", "2028 curriculum path mismatch");
assert(y2027.labels.domains.curriculum !== y2028.labels.domains.curriculum, "isolated years share curriculum path");

const operational2027 = [
  ...Object.values(y2027.labels.domains),
  ...Object.values(y2027.labels.collections),
  y2027.labels.timetableMeta,
  y2027.labels.workspaceMeta,
];
assert(operational2027.every(value => String(value).startsWith("schoolYears/2027")), "2027 operational path escapes workspace");
assert(!operational2027.some(value => String(value).startsWith("boards/")), "2027 operational path points to 2026 boards");
paths.assertSchoolYearPathSpec(y2026, "2026", "test");
paths.assertSchoolYearPathSpec(y2027, "2027", "test");

const config = fs.readFileSync(path.join(root, "js", "config.js"), "utf8");
const state = fs.readFileSync(path.join(root, "js", "state.js"), "utf8");
assert(config.includes("getSchoolYearRefs"), "config does not expose central ref builder");
assert(config.includes("getSchoolYearPathSpec"), "config does not consume central path spec");
assert(state.includes("activeWorkspaceRefs.collections.classes"), "state split refs are not centralised");
assert(!/collection\(db,\s*["']boards/.test(state), "state contains direct 2026 collection path");
assert(!/collection\(db,\s*["']schoolYears/.test(state), "state contains direct schoolYears collection path");
assert(!/doc\(db,\s*["']boards/.test(state), "state contains direct 2026 document path");
assert(!/doc\(db,\s*["']schoolYears/.test(state), "state contains direct schoolYears document path");

for (const name of ["school-years.html", "reset-school-year.html", "restore-curriculum-backup.html"]) {
  const html = fs.readFileSync(path.join(root, name), "utf8");
  assert(html.includes("getSchoolYearRefs"), `${name} does not use central ref builder`);
  assert(!/doc\(db,\s*["']boards/.test(html), `${name} contains direct boards document path`);
  assert(!/doc\(db,\s*["']schoolYears/.test(html), `${name} contains direct schoolYears document path`);
  assert(!/collection\(db,\s*["']boards/.test(html), `${name} contains direct boards collection path`);
  assert(!/collection\(db,\s*["']schoolYears/.test(html), `${name} contains direct schoolYears collection path`);
}

console.log("SCHOOL_YEAR_PATH_ISOLATION_CURRENT_OK");
