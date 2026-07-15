import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || ".");
const state = fs.readFileSync(path.join(root, "js/state.js"), "utf8");
const school = fs.readFileSync(path.join(root, "js/school-year.js"), "utf8");
const management = fs.readFileSync(path.join(root, "school-years.html"), "utf8");
const reset = fs.readFileSync(path.join(root, "reset-school-year.html"), "utf8");

const checks = [
  [!state.includes("invalidateActiveWorkspaceIntegrity"), "ordinary saves do not invalidate creation verification"],
  [!state.includes("invalidateSchoolYearVerification"), "state no longer imports the invalidation API"],
  [management.includes("creationVerification"), "server metadata has a separate creation verification record"],
  [management.includes("creationPhase:true"), "new workspace creation persists the creation verification"],
  [management.includes("creationPhase:options.creationPhase === true"), "manual checks are separated from creation checks"],
  [management.includes("복제 검증 완료"), "management UI shows immutable copy verification"],
  [!management.includes("변경됨 · 재점검 필요"), "edit-driven recheck badge removed"],
  [!reset.includes("clearSchoolYearVerification(ACTIVE_SCHOOL_YEAR)"), "workspace reset does not erase creation verification"],
  [school.includes("creation-verification-migrated-r352"), "r349-r351 stale records migrate safely"],
];

for (const [ok, label] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
if (checks.some(([ok]) => !ok)) process.exit(1);

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.location = { search: "", href: "https://example.test/index.html" };

const verificationKey = "his_school_year_verification_v1";
localStorage.setItem(verificationKey, JSON.stringify({
  "2027": {
    ok: false,
    stale: true,
    source: "workspace-edit",
    checkedAt: "2026-07-14T00:00:00.000Z",
    counts: { classes: 15 },
    createMode: "copy",
    sourceYear: "2026"
  }
}));

const schoolModuleUrl = `${pathToFileURL(path.join(root, "js/school-year.js")).href}?test=${Date.now()}`;
const mod = await import(schoolModuleUrl);
const migrated = mod.getSchoolYearVerification("2027");
if (!migrated?.ok || migrated?.stale === true || migrated?.source !== "creation-verification-migrated-r352") {
  console.error("FAIL stale r351 verification migration", migrated);
  process.exit(1);
}
console.log("PASS stale r351 verification becomes immutable creation verification");

mod.invalidateSchoolYearVerification("2027", "ordinary-edit");
const afterNoOp = mod.getSchoolYearVerification("2027");
if (!afterNoOp?.ok || afterNoOp?.stale === true) {
  console.error("FAIL compatibility invalidation must be a no-op", afterNoOp);
  process.exit(1);
}
console.log("PASS compatibility invalidation is a no-op");
