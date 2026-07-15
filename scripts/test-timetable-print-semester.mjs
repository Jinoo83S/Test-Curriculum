import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPrintTemplateMap,
  normalizePrintSemester,
  printSemesterLabel,
  resolveSemesterCardValues,
  resolveSemesterEntryValues,
} from "../js/timetable-print-semester.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const html = fs.readFileSync(path.join(root, "timetable-print.html"), "utf8");
const app = fs.readFileSync(path.join(root, "js/timetable-print-app.js"), "utf8");

assert.equal(normalizePrintSemester("2"), "2");
assert.equal(normalizePrintSemester("bad"), "1");
assert.equal(printSemesterLabel("1"), "1학기");
assert.equal(printSemesterLabel("2"), "2학기");

const templates = {
  templates: [
    {
      id: "tpl-math",
      useSemesterOverrides: true,
      nameKo: "공통수학1",
      nameEn: "Mathematics",
      teacher: "김수경",
      sem1NameKo: "공통수학1",
      sem1NameEn: "Mathematics",
      sem1Teacher: "김수경",
      sem2NameKo: "공통수학2",
      sem2NameEn: "Mathematics",
      sem2Teacher: "김수경",
    },
    {
      id: "tpl-change-teacher",
      useSemesterOverrides: true,
      nameKo: "대수",
      nameEn: "Algebra",
      teacher: "Teacher A",
      sem1NameKo: "대수",
      sem1NameEn: "Algebra",
      sem1Teacher: "Teacher A",
      sem2NameKo: "미적분 I",
      sem2NameEn: "Calculus I",
      sem2Teacher: "Teacher B",
    },
    {
      id: "tpl-static",
      useSemesterOverrides: false,
      nameKo: "성경",
      nameEn: "Christian Studies",
      teacher: "Joshua",
    },
  ],
};
const map = buildPrintTemplateMap(templates);

const mathCard = { templateId: "tpl-math", subject: "공통수학1", subjectEn: "Mathematics", teacherName: "김수경", teachers: ["김수경"] };
assert.equal(resolveSemesterCardValues(mathCard, {}, map, "1").subject, "공통수학1");
assert.equal(resolveSemesterCardValues(mathCard, {}, map, "2").subject, "공통수학2");

const changingCard = { templateId: "tpl-change-teacher", subject: "대수", subjectEn: "Algebra", teacherName: "Teacher A", teachers: ["Teacher A"] };
const sem2 = resolveSemesterCardValues(changingCard, {}, map, "2");
assert.deepEqual({ subject: sem2.subject, english: sem2.english, teacher: sem2.teacher, teachers: sem2.teachers }, {
  subject: "미적분 I",
  english: "Calculus I",
  teacher: "Teacher B",
  teachers: ["Teacher B"],
});

const staticCard = { templateId: "tpl-static", subject: "수동 표시명", subjectEn: "Manual Label", teacherName: "Manual Teacher" };
assert.equal(resolveSemesterCardValues(staticCard, {}, map, "2").subject, "수동 표시명");

const compoundCard = {
  templateId: "tpl-change-teacher",
  compoundParentTemplateId: "tpl-change-teacher",
  compoundPartId: "part-1",
  subject: "심화물리(2)",
  subjectEn: "Advanced Physics (2)",
  teacherName: "정진욱",
};
assert.equal(resolveSemesterCardValues(compoundCard, {}, map, "2").subject, "심화물리(2)");
assert.equal(resolveSemesterCardValues(compoundCard, {}, map, "2").teacher, "정진욱");

const entrySem2 = resolveSemesterEntryValues({ templateId: "tpl-change-teacher", teacherName: "Teacher A" }, map, "2");
assert.equal(entrySem2.subject, "미적분 I");
assert.equal(entrySem2.teacher, "Teacher B");

assert.match(html, /<select id="semester"><option value="1">1학기<\/option><option value="2">2학기<\/option><\/select>/);
assert.match(html, /timetable-print-app\.js\?v=2026-07-15-operational-print-regression-r363/);
assert.match(app, /subscribeDomains\(\["classes","timetable","rooms","rosters","templates"\]\)/);
assert.match(app, /semester:selectedSemester\(\)/);
assert.match(app, /semester:s\.semester/);
assert.match(app, /selectedSemesterLabel\(\).*safeFilePart/s);
assert.match(app, /resolveSemesterCardValues/);
assert.match(app, /initialLoad\.templates/);

console.log("TIMETABLE_PRINT_SEMESTER_OK");
