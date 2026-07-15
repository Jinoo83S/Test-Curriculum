import fs from "node:fs";
import path from "node:path";
const root=path.resolve(process.argv[2]||".");
const build="2026-07-14-school-year-isolation-r351";
const state=fs.readFileSync(path.join(root,"js/state.js"),"utf8");
const board=fs.readFileSync(path.join(root,"js/app-board-ui.js"),"utf8");
const config=fs.readFileSync(path.join(root,"js/config.js"),"utf8");
const school=fs.readFileSync(path.join(root,"js/school-year.js"),"utf8");
const checks=[
  [state.includes(`config.js?v=${build}`),"state uses versioned config"],
  [state.includes("verifyWriteContext(`Firestore 저장(${domain})`)"),"all domain writes guarded"],
  [config.includes(`school-year.js?v=${build}`),"config uses versioned year context"],
  [school.includes("requested !== ACTIVE_SCHOOL_YEAR"),"stored year mismatch checked"],
  [school.includes("selectorValue !== ACTIVE_SCHOOL_YEAR"),"visible selector mismatch checked"],
  [board.includes("GRADE_GROUPS[activeTab]"),"reset scoped to visible level"],
  [!board.includes("DEFAULT_GRADES.forEach"),"six-grade reset removed"],
];
const failed=checks.filter(([ok])=>!ok);
for(const [ok,label] of checks) console.log(`${ok?"PASS":"FAIL"} ${label}`);
if(failed.length) process.exit(1);
