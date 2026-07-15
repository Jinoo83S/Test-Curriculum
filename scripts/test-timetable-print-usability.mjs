import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cachedPrintBaseStyleText } from "../js/timetable-print-pdf.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

const app = read("js/timetable-print-app.js");
const html = read("timetable-print.html");
const css = read("timetable-print.css");
const pdf = read("js/timetable-print-pdf.js");

assert.match(app, /const LAST_SEMESTER_KEY = "his_print_designer_last_semester_v1"/);
assert.match(app, /rememberSemester\(e\.target\.value\)/);
assert.match(app, /\$\("semester"\)\.value = readRememberedSemester\(s\.semester\)/);
assert.match(app, /function individualTimetableTitle\(label=""\) \{ return `\$\{clean\(label\)\} Timetable · \$\{selectedSemesterTitle\(\)\}`; \}/);
assert.match(app, /Class Timetable Overview/);
assert.doesNotMatch(app, /title:\s*`\$\{ent\.label\} \$\{selectedSemesterLabel\(\)\} 시간표`/);
assert.match(app, /return !!clean\(item\.english\)/);
assert.doesNotMatch(app, /Number\(splitCount \|\| 1\) >= 2\) return false/);
assert.match(css, /@media screen\{[\s\S]*\.overview-wide \.field-english-inline\{display:block!important\}/);

assert.match(html, /timetable-print\.css\?v=2026-07-15-print-usability-r365/);
assert.match(html, /timetable-print-app\.js\?v=2026-07-15-print-usability-r365/);
assert.match(html, /<span class="badge">r365<\/span>/);

let cssRulesReads = 0;
const fakeDoc = {
  styleSheets: [{
    get cssRules() {
      cssRulesReads += 1;
      return [
        { cssText: ".tt-table{border:1px solid #000}" },
        { cssText: "@media print{.tt-table{border:0}}" },
      ];
    },
  }],
  querySelectorAll: () => [],
};
const first = cachedPrintBaseStyleText(fakeDoc);
const second = cachedPrintBaseStyleText(fakeDoc);
assert.equal(first, second);
assert.equal(cssRulesReads, 1, "PDF CSS must be serialized once per document");
assert.match(first, /\.tt-table\{border:1px solid #000\}/);
assert.doesNotMatch(first, /@media print/);

assert.match(pdf, /requestIdleCallback/);
assert.match(pdf, /cachedPrintBaseStyleText\(document\)/);
assert.match(pdf, /\[PDF prepare:r365\]/);
assert.doesNotMatch(pdf, /deps\.sleep\(800\)/);
assert.doesNotMatch(pdf, /deps\.sleep\(450\)/);
assert.doesNotMatch(pdf, /deps\.sleep\(180\)/);

console.log("TIMETABLE_PRINT_USABILITY_OK");
