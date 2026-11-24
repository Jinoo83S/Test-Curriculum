import { parseCreditValue } from "./utils.js?v=2026-07-15-room-availability-separation-r355";

const text = value => String(value ?? "").trim();
const key = value => text(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
const trackKey = row => key(row.track).replace(/\s+/g, "");

export function getCurriculumSemesterTitles(template, term) {
  if (!template) return null;
  const english = text(template[term + "NameEn"] || template.nameEn);
  return { name: text(template[term + "NameKo"] || template.nameKo || english), english };
}

export function getCurriculumCalculationGroup(templates) {
  const ids = new Set(templates.map(template => text(template?.calcGroupId)).filter(Boolean));
  return ids.size === 1 ? [...ids][0] : "";
}

export function summarizeAcademicCourses(rows, getGroupCredit) {
  const buckets = new Map();
  const memberships = new Map();
  for (const row of rows) {
    const id = text(row.academicGroupId);
    if (id && trackKey(row) === "공통") memberships.set(id, (memberships.get(id) || 0) + 1);
  }
  let totalCourses = 0;
  let totalCredits = 0;

  for (const row of rows) {
    const track = trackKey(row);
    const common = track === "공통";
    const id = text(row.academicGroupId);
    const manualGroup = common && memberships.get(id) > 1 && id;
    const bucket = manualGroup ? `manual:${manualGroup}` :
      common && row.calcGroupId ? `common:${row.calcGroupId}` : !common && track ? `track:${track}` : null;
    if (!bucket) {
      totalCourses++;
      totalCredits += row.boardHours;
      continue;
    }
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(row);
  }

  for (const [bucket, bucketRows] of buckets) {
    const groupId = getCurriculumCalculationGroup(bucketRows);
    const configured = bucket.startsWith("manual:")
      ? bucketRows[0].academicGroupCredits
      : groupId ? getGroupCredit(groupId) : null;
    totalCourses++;
    totalCredits += text(configured) ? parseCreditValue(configured) : Math.max(...bucketRows.map(row => row.boardHours), 0);
  }
  return { totalCourses, totalCredits: Number(totalCredits.toFixed(8)) };
}

export function summarizeAcademicBoardRows(rows, getTemplate, getGroupCredit) {
  const courses = rows.map(row => {
    const first = row.sem1TemplateId ? getTemplate(row.sem1TemplateId) : null;
    const second = row.sem2TemplateId ? getTemplate(row.sem2TemplateId) : null;
    return {
      track: row.track,
      academicGroupId: row.academicGroupId, academicGroupCredits: row.academicGroupCredits,
      calcGroupId: getCurriculumCalculationGroup([first, second]),
      boardHours: parseCreditValue(row.credits),
    };
  });
  return summarizeAcademicCourses(courses, getGroupCredit);
}
