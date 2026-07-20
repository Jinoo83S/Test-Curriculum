import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(path.join(root, "js", "cp-sat-webapp-import.js"), "utf8");

const policyBlock = source.match(/function resultApplyPolicy\([\s\S]*?\n  }\n  function resultMayBeApplied\([\s\S]*?\n  }/);
assert.ok(policyBlock, "result policy helper block missing");
assert.match(policyBlock[0], /function resultApplyPolicy\(apiResult = \{\}, scopeState = null\)/);
assert.match(policyBlock[0], /applyPolicy\(apiResult, normalized, asArray\(entries\?\.\(\)\)\.length, scopeState \|\| null\)/);
assert.match(policyBlock[0], /function resultMayBeApplied\(apiResult = \{\}, scopeState = null\)/);
assert.doesNotMatch(policyBlock[0], /latestState/, "result policy helper must not capture openOverlay latestState");

assert.match(source, /resultMayBeApplied\(latestResult, latestState\)/);
const directCalls = [...source.matchAll(/resultApplyPolicy\(latestResult(?:,\s*latestState)?\)/g)].map(m => m[0]);
assert.ok(directCalls.length >= 3, "expected resultApplyPolicy calls missing");
assert.ok(directCalls.every(call => call.includes(", latestState")), `unscoped resultApplyPolicy call remains: ${directCalls.join(" | ")}`);

console.log("CPSAT_LATESTSTATE_SCOPE_R373_OK");
