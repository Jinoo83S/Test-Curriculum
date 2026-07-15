import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const before = (text, first, second, label) => {
  const a = text.indexOf(first), b = text.indexOf(second);
  assert(a >= 0, `${label}: missing ${first}`);
  assert(b >= 0, `${label}: missing ${second}`);
  assert(a < b, `${label}: ${first} must occur before ${second}`);
};

const board = read("js/app-board-ui.js");
assert(board.includes("${ACTIVE_SCHOOL_YEAR}-운영데이터-${levelKey}-보드초기화"), "2026 board reset phrase is not strengthened");
assert(board.includes("실제 저장 경로:"), "board reset does not display actual path");
before(board, "backupInfo = downloadJsonBackup", "saveNow(\"curriculum\"", "board reset");
assert(board.includes("recordDestructiveOperation"), "board reset audit missing");

const years = read("school-years.html");
assert(years.includes("${year}-학년도전체삭제"), "school-year deletion phrase missing");
assert(years.includes("실제 대상 경로:"), "school-year deletion target path missing");
before(years, "backupInfo = downloadJsonBackup", "const result = await deleteWorkspaceData(year, \"삭제\")", "school-year delete");
assert(years.includes("삭제 전 전체 백업 생성에 실패하여 삭제를 중단"), "school-year deletion is not fail-closed on backup error");
assert(years.includes("recordDestructiveOperation"), "school-year deletion audit missing");

const reset = read("reset-school-year.html");
assert(reset.includes("운영데이터-학년도전체초기화"), "2026 full reset phrase missing");
before(reset, "backupInfo = downloadJsonBackup", "deletedDocs += await deleteCollectionAll", "full reset");
assert(reset.includes("백업 생성에 실패하여 작업을 중단"), "full reset is not fail-closed on backup error");
assert(reset.includes("recordDestructiveOperation"), "full reset audit missing");

const restore = read("restore-curriculum-backup.html");
assert(restore.includes("운영데이터-커리큘럼복원"), "2026 restore phrase missing");
before(restore, "backupInfo=downloadJsonBackup", "await setDoc(targetRef()", "curriculum restore");
assert(restore.includes("현재 문서 백업에 실패하여 복원을 중단"), "restore is not fail-closed on backup error");
assert(restore.includes("recordDestructiveOperation"), "restore audit missing");

const guard = read("js/destructive-operation-guard.js");
const pathSource = read("js/school-year-paths.js");
assert(pathSource.includes("schoolYearOperations"), "operation audit path missing");
assert(guard.includes("throw new Error(\"백업 JSON 생성에 실패했습니다.\")"), "backup serialization guard missing");
assert(!fs.readdirSync(root).some(name => name.toLowerCase().endsWith(".bat")), "BAT file included in r355 source");

console.log("DESTRUCTIVE_OPERATION_GUARD_R355_OK");
