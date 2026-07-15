import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

const timetable = read("js/timetable.js");
const constraintModel = read("js/timetable-constraint-model.js");
const html = read("timetable.html");
const css = read("timetable-revision-history.css");

assert.match(
  constraintModel,
  /export const CLASS_UNAVAILABLE_PREFIX\s*=\s*["']__class_unavailable__:["']/,
  "CLASS_UNAVAILABLE_PREFIX must be exported by the canonical constraint model"
);
assert.match(
  timetable,
  /import\s*\{\s*CLASS_UNAVAILABLE_PREFIX\s*\}\s*from\s*["']\.\/timetable-constraint-model\.js\?v=2026-07-15-timetable-loading-hotfix-r358["']/,
  "timetable.js must import CLASS_UNAVAILABLE_PREFIX"
);

const prefixSymbols = new Set([...timetable.matchAll(/\b([A-Z][A-Z0-9_]*_PREFIX)\b/g)].map(match => match[1]));
const importedSymbols = new Set();
for (const match of timetable.matchAll(/import\s*\{([\s\S]*?)\}\s*from/g)) {
  for (const specifier of match[1].split(",")) {
    const local = specifier.trim().split(/\s+as\s+/).at(-1)?.trim();
    if (local) importedSymbols.add(local);
  }
}
const locallyDeclared = new Set([...timetable.matchAll(/\b(?:const|let|var|function|class)\s+([A-Z][A-Z0-9_]*_PREFIX)\b/g)].map(match => match[1]));
const unresolved = [...prefixSymbols].filter(name => !importedSymbols.has(name) && !locallyDeclared.has(name));
assert.deepEqual(unresolved, [], `unresolved timetable prefix symbols: ${unresolved.join(", ")}`);

assert.match(html, /timetable-revision-history\.css\?v=2026-07-15-timetable-loading-hotfix-r358/);
assert.doesNotMatch(html, /\.tt-revision-panel\s*\{/,
  "revision-history styles must not be duplicated inline");
assert.match(css, /\.tt-revision-panel\s*\{/);
assert.match(css, /\.tt-revision-row-actions button/);

console.log("TIMETABLE_RUNTIME_SYMBOLS_TEST_OK");
