import assert from "node:assert/strict";

const store = new Map([
  ["his_active_school_year_v1", "2026"],
  ["his_known_school_years_v1", JSON.stringify(["2027","2026"])],
]);
globalThis.localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); },
};

const mod = await import("../js/school-year.js?test=r349");
assert.equal(mod.isSchoolYearVerified("2026"), true);
assert.equal(mod.isSchoolYearVerified("2027"), false);
mod.setSchoolYearVerification("2027", { ok:true, checkedAt:"2026-07-14T00:00:00Z", signature:"ws:test", counts:{ classes:15 } });
assert.equal(mod.isSchoolYearVerified("2027"), true);
assert.equal(mod.getSchoolYearVerification("2027").signature, "ws:test");
mod.clearSchoolYearVerification("2027");
assert.equal(mod.isSchoolYearVerified("2027"), false);
mod.setSchoolYearVerification("2027", { ok:true });
mod.invalidateSchoolYearVerification("2027", "test-edit");
assert.equal(mod.isSchoolYearVerified("2027"), false);
assert.equal(mod.getSchoolYearVerification("2027").stale, true);
assert.equal(mod.getSchoolYearVerification("2027").reason, "test-edit");
mod.setSchoolYearVerification("2027", { ok:true });
mod.unregisterKnownSchoolYear("2027");
assert.equal(mod.getKnownSchoolYears().includes("2027"), false);
assert.equal(mod.isSchoolYearVerified("2027"), false);
console.log("SCHOOL_YEAR_VERIFICATION_TEST_OK");
