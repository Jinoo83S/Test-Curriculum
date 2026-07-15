 import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32Bytes, officeXmlEsc, u8FromString, zipStore } from "../js/timetable-print-archive.js";
import { createDocxBuilder } from "../js/timetable-print-word.js";
import { buildXlsxDatabaseBlob } from "../js/timetable-print-excel.js";
import { stripCssBlock } from "../js/timetable-print-pdf.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

assert.equal(crc32Bytes(u8FromString("123456789")), 0xcbf43926, "CRC32 reference vector");
assert.equal(officeXmlEsc(` A&B<\"'> `), "A&amp;B&lt;&quot;&apos;&gt;");

const rawZip = zipStore([{ name: "hello.txt", data: "hello" }], { now: new Date("2026-07-15T00:00:00Z") });
assert.equal(rawZip.type, "application/zip");
const rawBytes = new Uint8Array(await rawZip.arrayBuffer());
assert.deepEqual([...rawBytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
const rawText = new TextDecoder().decode(rawBytes);
assert.match(rawText, /hello\.txt/);
assert.match(rawText, /hello/);

const buildDocxBlob = createDocxBuilder({
  wordModelsForExport: models => models,
  isWideOfficeOverview: () => false,
  officeWordPageSize: () => ({ w: 16838, h: 11906 }),
  officeWordPageMargins: () => ({ top: 100, right: 100, bottom: 100, left: 100 }),
  wordHeaderRowXml: model => `<w:p><w:r><w:t>${model.title}</w:t></w:r></w:p>`,
  wordTableXml: () => "<w:tbl/>",
  isPortrait: () => false,
});
const docx = buildDocxBlob([{ title: "HIS" }]);
const docxText = new TextDecoder().decode(new Uint8Array(await docx.arrayBuffer()));
for (const part of ["[Content_Types].xml", "word/document.xml", "word/styles.xml", "word/settings.xml"]) {
  assert.match(docxText, new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(docxText, /HIS/);
assert.match(docxText, /w:orient="landscape"/);

const xlsx = buildXlsxDatabaseBlob([
  ["학년", "이름", "과목", "영문", "교사", "교실"],
  ["7학년", "7A", "수학", "Mathematics", "백예지", "VH304"],
]);
const xlsxText = new TextDecoder().decode(new Uint8Array(await xlsx.arrayBuffer()));
for (const part of ["xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "database", "Mathematics"]) {
  assert.match(xlsxText, new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(xlsxText, /autoFilter ref="A1:F2"/);

const css = "a{color:red}@media print{a{color:black}}b{color:blue}@page{size:A4}c{color:green}";
const withoutPrint = stripCssBlock(css, head => /^@media\s+print\b/i.test(head));
assert.equal(withoutPrint, "a{color:red}b{color:blue}@page{size:A4}c{color:green}");
const withoutPage = stripCssBlock(withoutPrint, head => /^@page\b/i.test(head));
assert.equal(withoutPage, "a{color:red}b{color:blue}c{color:green}");

const app = read("js/timetable-print-app.js");
assert.match(app, /createDocxBuilder/);
assert.match(app, /buildXlsxDatabaseBlob\(excelDbRowsForExport\(\)\)/);
assert.match(app, /createPdfExporter/);
assert.doesNotMatch(app, /function zipStore\(/);
assert.doesNotMatch(app, /function buildXlsxBlob\(/);
assert.doesNotMatch(app, /function buildOfficeHtml\(/);

console.log("TIMETABLE_PRINT_EXPORT_MODULES_OK");
