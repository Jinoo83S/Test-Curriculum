import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOperationalPrintAudit, operationalAuditText } from "./lib/timetable-print-operational-model.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const candidates = [
  process.env.HIS_TIMETABLE_DIAGNOSTIC,
  path.join(root, "his-firestore-diagnostic-2026-07-13_r343.json"),
  path.join(root, "..", "his-firestore-diagnostic-2026-07-13_r343.json"),
  path.join(here, "fixtures", "timetable-print-operational-r343.json"),
].filter(Boolean);

const fixturePath = path.join(here, "fixtures", "timetable-print-operational-r343.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
assert.match(fixture.sourceLabel, /anonymized/);
for (const cls of fixture.classes.classes || []) {
  for (const student of cls.students || []) assert.deepEqual(Object.keys(student).sort(), ["id"], "fixture must not contain student names or birth data");
}
for (const template of fixture.templates.templates || []) {
  for (const value of [template.teacher, template.sem1Teacher, template.sem2Teacher]) {
    if (value) assert.match(value, /^T\d{2}(?:, T\d{2})*$/, "fixture teacher names must stay pseudonymized");
  }
}

const inputPath = candidates.find(file => fs.existsSync(file));
assert.ok(inputPath, "operational timetable fixture not found");
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const audit = buildOperationalPrintAudit(input);

assert.deepEqual(audit.counts, {
  classes: 15,
  students: 292,
  rooms: 29,
  templates: 133,
  cards: 237,
  entries: 368,
  periods: 7,
});
assert.equal(audit.structural.invalidEntryCount, 0, "all entries must be inside Mon-Fri and configured periods");
assert.equal(audit.structural.missingCardReferenceCount, 0, "all timetable card references must resolve");
assert.equal(audit.structural.missingRoomReferenceCount, 0, "all room references must resolve");
assert.deepEqual(audit.structural.classScopePages, { middle: 1, high: 1, all: 2 });
assert.equal(audit.semester.changedCardCount, 67, "operational semester override coverage changed unexpectedly");
assert.ok(audit.semester.changedSubjectCount >= 60);
assert.ok(audit.semester.changedEnglishCount >= 1);
assert.equal(audit.semester.changedTeacherCount, 0);
assert.equal(audit.anomalies.length, 0);

const profiles = audit.coverage.profileAudits;
assert.equal(profiles.length, 14, "2 semesters x (4 individual + 3 overview) profiles");
for (const semester of ["1", "2"]) {
  for (const type of ["class", "teacher", "room", "student"]) {
    const individual = profiles.find(profile => profile.semester === semester && profile.type === type && profile.layoutMode === "individual");
    assert.ok(individual, `${semester}학기 ${type} individual profile missing`);
    assert.equal(individual.rows, 8);
    assert.equal(individual.cols, 6);
    assert.ok(individual.entityCount > 0);
    assert.ok(individual.nonEmptySlots > 0);
    assert.deepEqual(individual.orientations, ["landscape", "portrait"]);
  }
  for (const type of ["class", "teacher", "room"]) {
    const overview = profiles.find(profile => profile.semester === semester && profile.type === type && profile.layoutMode === "overview");
    assert.ok(overview, `${semester}학기 ${type} overview profile missing`);
    assert.equal(overview.cols, 36);
    assert.deepEqual(overview.orientations, ["landscape"]);
  }
}
assert.equal(audit.coverage.pdfCombinationCount, 22);
assert.equal(audit.coverage.wordCombinationCount, 16);
assert.equal(audit.coverage.excelDatabaseCombinationCount, 2);
assert.ok(audit.coverage.splitHistogram["1"] > 0);
assert.ok(audit.coverage.splitHistogram["2"] > 0);
assert.ok(audit.coverage.splitHistogram["3"] > 0);
assert.ok(audit.coverage.splitHistogram["4"] > 0);
assert.equal(audit.coverage.splitHistogram["5+"], 0, "operational output has a cell exceeding the supported 4-way split");

console.log(operationalAuditText(audit));
console.log("TIMETABLE_PRINT_OPERATIONAL_DATA_OK");
