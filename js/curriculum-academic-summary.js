import { parseCreditValue } from "./utils.js?v=2026-07-15-room-availability-separation-r355";

const text = value => String(value ?? "").trim();
const key = value => text(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
const trackKey = row => key(row.track).replace(/\s+/g, "");
const genderMarker = /\[\s*(남|여|m|f)\s*\]/g;

export function getCurriculumSemesterTitles(template, term) {
  if (!template) return null;
  const english = text(template[term + "NameEn"] || template.nameEn);
  return { name: text(template[term + "NameKo"] || template.nameKo || english), english };
}

export function getCurriculumCalculationGroup(templates) {
  const ids = new Set(templates.map(template => text(template?.calcGroupId)).filter(Boolean));
  return ids.size === 1 ? [...ids][0] : "";
}

function pairCommonPhysicalEducation(rows) {
  const candidates = { male: [], female: [] };
  for (const row of rows) {
    if (trackKey(row) !== "공통" || !["체육", "pe", "physical education"].includes(key(row.group))) continue;
    const titles = [row.sem1, row.sem2].flatMap(subject => [key(subject?.name), key(subject?.english)]).filter(Boolean);
    const genders = new Set(titles.flatMap(title => Array.from(title.matchAll(genderMarker), ([, gender]) =>
      gender === "남" || gender === "m" ? "male" : "female")));
    if (genders.size !== 1) continue;
    candidates[[...genders][0]].push({ row, names: titles.map(title => title.replace(genderMarker, "").replace(/\s+/g, "")) });
  }

  const pairs = new Map();
  const pair = (male, female) => {
    const group = Symbol("physical education");
    pairs.set(male.row, group);
    pairs.set(female.row, group);
  };
  const matches = (first, second) => first.names.some(name => name && second.names.includes(name));
  for (const male of candidates.male) {
    const matching = candidates.female.filter(female => matches(male, female));
    if (matching.length === 1 && candidates.male.filter(other => matches(other, matching[0])).length === 1) {
      pair(male, matching[0]);
    }
  }
  const male = candidates.male.filter(item => !pairs.has(item.row));
  const female = candidates.female.filter(item => !pairs.has(item.row));
  // One parallel pair can use different NEIS course names for boys and girls.
  if (male.length === 1 && female.length === 1) pair(male[0], female[0]);
  return pairs;
}

export function summarizeAcademicCourses(rows, getGroupCredit) {
  const physicalEducation = pairCommonPhysicalEducation(rows);
  const buckets = new Map();
  let totalCourses = 0;
  let totalCredits = 0;

  for (const row of rows) {
    const track = trackKey(row);
    const common = track === "공통";
    const bucket = physicalEducation.get(row) ??
      (common && row.calcGroupId ? `common:${row.calcGroupId}` : !common && track ? `track:${track}` : null);
    if (!bucket) {
      totalCourses++;
      totalCredits += row.boardHours;
      continue;
    }
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(row);
  }

  for (const bucketRows of buckets.values()) {
    const groupId = getCurriculumCalculationGroup(bucketRows);
    const configured = groupId ? getGroupCredit(groupId) : null;
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
      track: row.track, group: row.group,
      calcGroupId: getCurriculumCalculationGroup([first, second]),
      boardHours: parseCreditValue(row.credits),
      sem1: getCurriculumSemesterTitles(first, "sem1"),
      sem2: getCurriculumSemesterTitles(second, "sem2"),
    };
  });
  return summarizeAcademicCourses(courses, getGroupCredit);
}
