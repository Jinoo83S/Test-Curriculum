import fs from "node:fs";
import assert from "node:assert/strict";
import { finalCapacityAudit } from "../js/cp-sat-webapp-import.js";

const source = fs.readFileSync(new URL("../js/cp-sat-webapp-import.js", import.meta.url), "utf8");
assert.match(source, /export function finalCapacityAudit\(/);
assert.match(source, /policy:\s*"warning-apply-allowed"/);
assert.match(source, /capacityWarningCount/);
assert.match(source, /교실 수용인원 초과 경고/);
assert.match(source, /수용인원 경고는 적용을 차단하지 않습니다/);
assert.match(source, /HIS_CP_SAT_Local_Server_r348\.zip/);
assert.doesNotMatch(source, /HIS_CP_SAT_Local_Server_r347\.zip/);

const state = {
  data: {
    classes: { classes: [
      { id: "c1", grade: "8학년", name: "A", studentCount: 22 },
      { id: "c2", grade: "8학년", name: "B", studentCount: 22 },
    ] },
    rooms: { rooms: [{ id: "r1", name: "VH107", capacity: 30 }] },
    rosters: { rosters: {
      tpl1: Array.from({ length: 22 }, (_, i) => ({ classId: "c1", studentId: `a${i}`, sectionIdx: 0 })),
      tpl2: Array.from({ length: 22 }, (_, i) => ({ classId: "c2", studentId: `b${i}`, sectionIdx: 0 })),
    } },
    timetable: { ttcards: [
      { id: "card1", templateId: "tpl1", sectionIdx: 0, subject: "체험수학", classKeys: ["8:A"], teachers: ["T"] },
      { id: "card2", templateId: "tpl2", sectionIdx: 0, subject: "생활속의 수학적 사고", classKeys: ["8:B"], teachers: ["T"] },
    ] },
  },
};
const entries = [{
  id: "e1", day: 1, period: 1, groupId: "g1", groupName: "MS선택",
  ttcardIds: ["card1", "card2"],
  roomAssignmentsByTtCardId: { card1: "r1", card2: "r1" },
}];
const audit = finalCapacityAudit(state, entries);
assert.equal(audit.warningCount, 1, audit);
assert.equal(audit.blockingCount, 0, audit);
assert.equal(audit.policy, "warning-apply-allowed");
assert.equal(audit.details[0].studentCount, 44);
assert.equal(audit.details[0].capacity, 30);
assert.equal(audit.details[0].overBy, 14);
console.log("CPSAT_CAPACITY_WARNING_R374_OK", audit.details[0].studentCount, audit.details[0].capacity, audit.details[0].overBy);
