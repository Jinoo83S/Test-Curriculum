// Analyze Excel clipboard TSV without touching the current curriculum.
import { REPORT_FIELDS, normalizeReportValue } from "./checklist-report-options.js?v=r444";

const gradePattern = "(1[0-2]|[7-9])";
const clean = value => String(value ?? "").trim();
const key = value => clean(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
const headerKey = value => key(value).replace(/[\s#()\/·.:_-]/g, "");
const isFlag = value => /^(true|false)$/i.test(clean(value));

function gradeOf(value, allowBareNumber = true) {
  const label = key(value);
  if (!allowBareNumber && /^\d+$/.test(label)) return "";
  const match = label.match(new RegExp("^" + gradePattern + "(?:$|\\s*학년)"))
    || label.match(new RegExp("^(?:grade|g)\\s*" + gradePattern + "\\b"));
  return match ? match[1] + "학년" : "";
}

function readTsv(source) {
  const rows = [];
  let row = [], cell = "", quoted = false, line = 1, start = 1;
  const finishCell = () => { row.push(clean(cell)); cell = ""; };
  const finishRow = () => { finishCell(); rows.push({ cells: row, line: start }); row = []; };
  const input = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"' && quoted && input[index + 1] === '"') {
      cell += '"';
      index++;
    } else if (char === '"' && (quoted || !cell)) {
      quoted = !quoted;
    } else if (char === "\t" && !quoted) {
      finishCell();
    } else if (char === "\n" && !quoted) {
      finishRow();
      start = line + 1;
    } else {
      cell += char;
    }
    if (char === "\n") line++;
  }
  if (quoted) throw new Error("따옴표로 묶인 엑셀 셀이 끝나지 않았습니다. 셀 범위를 다시 복사해 주세요.");
  if (row.length || cell) finishRow();
  return rows;
}

function columnType(value) {
  const label = headerKey(value);
  const semester = label.match(/^(?:([12])학기|(?:semester|sem)([12]))(.*)$/);
  if (semester) {
    const suffix = semester[3].replace(/^semester[12]/, "");
    const part = /한글|국문|korean|nameko/.test(suffix) ? "Ko"
      : /영어|영문|english|nameen/.test(suffix) ? "En" : /교사|teacher/.test(suffix) ? "Teacher" : "";
    return "s" + (semester[1] || semester[2]) + part;
  }
  if (/^(학년|학년grade|grade)$/.test(label)) return "grade";
  if (/^(범주|범주category|category)$/.test(label)) return "category";
  if (/^(공통배정선택.*|구분.*|track)$/.test(label)) return "track";
  if (/^(교과군.*|교과group|교과군subject.*|subjectgroup|coursegroup|교과군교과|활동영역|영역)$/.test(label)) return "group";
  if (/^(언어.*|language)$/.test(label)) return "language";
  if (/^(과목명|한글.*|국문.*|nameko|koreanname)$/.test(label)) return "nameKo";
  if (/^(영문.*|영어명.*|nameen|englishname)$/.test(label)) return "nameEn";
  if (/^(교사|teacher)$/.test(label)) return "teacher";
  if (/^(학점|credits?|학점credits?)$/.test(label)) return "credits";
  if (/^(시간|hours?|시간hours?)$/.test(label)) return "hours";
  if (/^(시수|수업시수|학점시수|시수학점)$/.test(label)) return "amount";
  if (/^(과목별시수(?:totalclasshours)?|totalclasshours|teachertotalhours|교사시수)$/.test(label)) return "teacherLoadHours";
  if (/^(원점수(?:rawscore)?|rawscore)$/.test(label)) return "reportRawScore";
  if (/^((?:과목평균|평균)(?:average)?|average|subjectaverage)$/.test(label)) return "reportAverage";
  if (/^(표준편차(?:standarddeviation)?|standarddeviation|stddev)$/.test(label)) return "reportStandardDeviation";
  if (/^((?:성취도|성취수준)(?:achievementlevels?)?|achievementlevels?|achievement)$/.test(label)) return "reportAchievementLevels";
  if (/^((?:수강자수|수강인원)(?:enrollmentcount)?|enrollmentcount|numberofstudents)$/.test(label)) return "reportEnrollmentCount";
  if (/^((?:석차등급|석차)(?:ranking)?|ranking|rankgrade)$/.test(label)) return "reportRanking";
  if (/(?:반수|반개수|분반수|학급수|학급개수|학급반수|과목반수|수업반수|개설반수)/.test(label)
      || /^(?:수업반|classes|sections)$/.test(label)
      || /(?:class|section)(?:es)?(?:count|number|no|qty)/.test(label)
      || /(?:count|number|no|qty)(?:of)?(?:classes|sections)/.test(label)) return "classCount";
  return "";
}

function reportingRequirements(get) {
  return Object.fromEntries(REPORT_FIELDS.map(([field]) => [field, normalizeReportValue(get(field))]).filter(([, value]) => value));
}

const schoolReportHeaders = new Map([
  ["교과군coursegroup", "reportCourseGroup"],
  ["교과군curriculumarea", "reportCourseGroup"],
  ["구분category", "reportCategory"],
  ["평점평균gradepointsaveragegpa", "transcriptGpa"],
]);
for (const [field, korean, , english] of REPORT_FIELDS) {
  // The source repeats the achievement heading. The English one precedes grade points.
  // A plain 교과군 header can also denote the curriculum board's subject group.
  if (field === "transcriptAchievementLevels" || field === "reportCourseGroup") continue;
  for (const label of [korean, english, korean + english]) schoolReportHeaders.set(headerKey(label), field);
}

function schoolReportColumns(headers, columnTypes) {
  const reportKeys = new Set(REPORT_FIELDS.map(([field]) => field));
  const types = headers.map((label, index) => {
    const type = columnTypes[index];
    return schoolReportHeaders.get(headerKey(label)) || (reportKeys.has(type) ? type : "");
  });
  const courseGroups = types.flatMap((type, index) => type === "reportCourseGroup" ? [index] : []);
  const starts = courseGroups.length === 2 ? courseGroups : null;
  const termColumns = [new Map(), new Map()];
  types.forEach((type, index) => {
    if (!type) return;
    const field = type === "reportAchievementLevels" && types[index + 1] === "transcriptGradePoints"
      ? "transcriptAchievementLevels" : type;
    if (starts && index < starts[0]) return;
    const term = starts ? Number(index >= starts[1]) : Number(termColumns[0].has(field));
    if (!termColumns[term].has(field)) termColumns[term].set(field, index);
  });
  return termColumns;
}

function readHeader(cells, grades, priorBlocks) {
  const columns = cells.map(columnType);
  const flat = columns.includes("grade");
  const starts = columns.flatMap((column, i) => column === "track" ? [i] : []);
  const semesterStarts = columns.flatMap((column, i) => column === "s1" || column === "s1Ko" ? [i] : []);
  const hasCourseHeading = semesterStarts.length || columns.includes("nameKo") || columns.includes("nameEn") || columns.includes("s2") || columns.includes("s2Ko");
  if (!hasCourseHeading || !(flat || starts.length || columns.some(column => ["amount", "credits", "hours"].includes(column)))) return null;
  const blockStarts = flat ? [0] : starts.length === grades.length ? starts
    : grades.length === 1 ? [0]
    : semesterStarts.length === grades.length && priorBlocks?.length === grades.length
      ? priorBlocks.map(({ start }) => start) : [];
  if (!blockStarts.length) return null;
  const categoryIndex = columns.indexOf("category");
  return blockStarts.map((start, index) => {
    const end = blockStarts[index + 1] ?? columns.length;
    const indices = {};
    for (let i = start; i < end; i++) {
      if (columns[i]) indices[columns[i]] = i;
    }
    if (indices.category === undefined && categoryIndex >= 0 && categoryIndex < blockStarts[0]) {
      indices.category = categoryIndex;
    }
    return { grade: flat ? "" : grades[index], start, indices, prior: {} };
  });
}

function names(value) {
  const parts = clean(value).split(/\n+/).map(clean).filter(Boolean);
  return {
    nameKo: parts.filter(part => /[가-힣]/.test(part)).join(" "),
    nameEn: parts.filter(part => !/[가-힣]/.test(part)).join(" "),
    teacher: "",
  };
}

function categoryOf(value) {
  const label = headerKey(value);
  if (/^(?:창체|창의적체험활동)?(?:cocurricular(?:activities)?|creativeexperientialactivities)$/.test(label)
      || /^(창체|창의적체험활동)$/.test(label)) return "창체";
  if (/^(교과|교과course[s]?|course[s]?)$/.test(label)) return "교과";
  return clean(value);
}

function trackOf(value) {
  const label = clean(value);
  const match = label.match(/^(공통|배정|선택)\s*(\d*)/);
  return match ? match[1] + match[2] : label;
}

function languageOf(value) {
  const label = headerKey(value);
  if (/^(korean|한국어|국어|한국어korean|korean한국어|k)$/.test(label)) return "Korean";
  if (/^(english|영어|영어english|english영어|e)$/.test(label)) return "English";
  if (/^(both|bilingual|공통|이중언어|한영|한영병용|한국어영어|국영|koreanenglish|englishkorean|ke|ek)$/.test(label) || !label) return "Both";
  return "";
}

function isHeading(value) {
  return /^(?:total\b|sub\s*total\b|합계|소계|총\s*(?:합계|시수|학점)|교육과정\s*합계)/i.test(clean(value));
}

function optionalNumber(value, label, warn) {
  const normalized = clean(value).normalize("NFKC");
  if (!normalized) return "";
  if (/^\d+(?:\.\d+)?$/.test(normalized) && Number.isFinite(Number(normalized))) return normalized;
  warn(`${label} 값 ‘${normalized}’은 건너뜁니다. 기존 값은 유지됩니다.`);
  return "";
}

function analyzeSchoolSheet(rows, selectedGrades) {
  const entries = [], errors = [], warnings = [];
  const headers = rows[0].cells;
  const headerTypes = headers.map(columnType);
  const reportColumns = schoolReportColumns(headers, headerTypes);
  const classCountIndex = headerTypes.indexOf("classCount");
  const teacherLoadIndex = headerTypes.indexOf("teacherLoadHours");
  for (const { cells, line } of rows.slice(1)) {
    const grade = gradeOf(cells[0]);
    if (!grade || !selectedGrades.includes(grade)) continue;
    const category = /^창의적\s*체험활동/.test(clean(cells[1])) ? "창체" : categoryOf(cells[1]);
    const track = trackOf(cells[3]);
    const group = clean(cells[4]);
    const language = languageOf(cells[9]);
    const warn = message => warnings.push({ line, grade, message });
    const credits = optionalNumber(cells[11], "학급별 시수", warn);
    const rawClassCount = optionalNumber(cells[classCountIndex], "반 수", warn);
    const fractionalClassCount = rawClassCount && /^\d+(?:\.\d+)?$/.test(rawClassCount) && !/^\d+$/.test(rawClassCount);
    const classCount = fractionalClassCount ? String(Math.ceil(Number(rawClassCount))) : rawClassCount;
    const teacherLoadHours = optionalNumber(cells[teacherLoadIndex], "교사시수", warn)
      || (fractionalClassCount && credits ? String(Number(rawClassCount) * Number(credits)) : "");
    const semesters = [0, 1].map(index => {
      const nameKo = clean(cells[index === 0 ? 5 : 7]);
      const nameEn = clean(cells[index === 0 ? 6 : 8]);
      const firstTeacherIndex = index === 0 ? 16 : 19;
      const names = cells.slice(firstTeacherIndex, firstTeacherIndex + 3).map(clean).filter(Boolean);
      return nameKo || nameEn ? { nameKo, nameEn, teacher: [...new Set(names)].join(", ") } : null;
    });
    // This sheet records a continuing teacher only in the first-semester columns.
    // A blank second-semester teacher therefore means "same teacher", not "unassigned".
    if (semesters[0]?.teacher && semesters[1] && !semesters[1].teacher) semesters[1].teacher = semesters[0].teacher;
    const error = !["교과", "창체"].includes(category) ? "범주를 확인해 주세요."
      : !track || !group ? "구분 또는 교과군이 비어 있습니다."
      : !language ? "수업 언어를 확인해 주세요."
      : !semesters.some(Boolean) ? "과목명을 확인해 주세요." : "";
    if (error) errors.push({ line, grade, message: error });
    else {
      if (!clean(cells[11])) warn("학급별 시수가 비어 있어 새 행에는 공란으로 저장됩니다.");
      if (fractionalClassCount) warnings.push({ line, grade, message: `원본 반 수 ${rawClassCount}를 운영 반 수 ${classCount}로 반올림하고 교사시수 ${teacherLoadHours || "미입력"}를 별도로 반영합니다.` });
      const semesterReporting = reportColumns.map(columns => reportingRequirements(field => cells[columns.get(field)]));
      const reporting = semesterReporting[0];
      entries.push({ line, grade, category, track, group, language, credits, classCount, classCountSource: rawClassCount, teacherLoadHours, reporting, semesterReporting, semesters });
    }
  }
  if (!entries.length && !errors.length) errors.push({ message: "선택한 학년 탭에 해당하는 과목이 없습니다." });
  return { entries, errors, warnings };
}

export function analyzeCurriculumPaste(source, selectedGrades) {
  const parsedRows = readTsv(source);
  const headings = parsedRows[0]?.cells.map(headerKey) || [];
  if (headings[0] === "학년grade" && headings[5] === "neis과목명1"
      && headings[7] === "neis과목명2" && headings[11].includes("credits")) {
    return analyzeSchoolSheet(parsedRows, selectedGrades);
  }
  const entries = [], errors = [], warnings = [];
  let grades = [], blocks = null, foundHeader = false;
  let section = "";
  for (const { cells, line } of parsedRows) {
    const gradeLabels = [...new Set(cells.map(value => gradeOf(value, false)).filter(Boolean))];
    const categoryLabel = cells.find(value => {
      const category = categoryOf(value);
      return (category === "교과" || category === "창체") && !columnType(value);
    });
    const header = readHeader(cells, gradeLabels.length ? gradeLabels : grades, blocks);
    if (header?.length) {
      foundHeader = true;
      if (header.some(({ indices }) => !["nameKo", "nameEn", "s1", "s1Ko", "s1En", "s2", "s2Ko", "s2En"].some(column => indices[column] !== undefined))) {
        errors.push({ line, message: "이 구역은 과목명 열을 찾지 못해 건너뜁니다." });
        blocks = null;
        continue;
      }
      blocks = header;
      if (blocks.every(({ indices }) => indices.hours !== undefined && indices.credits === undefined)) section = "창체";
      else if (blocks.every(({ indices }) => indices.credits !== undefined && indices.hours === undefined)) section = "교과";
      continue;
    }
    if (gradeLabels.length && (!blocks || gradeLabels.length > 1 || cells.filter(Boolean).length === 1)) {
      grades = gradeLabels;
      continue;
    }
    if (!blocks) continue;
    if (categoryLabel && categoryOf(categoryLabel) !== section) {
      section = categoryOf(categoryLabel);
      for (const block of blocks) block.prior = {};
    }
    for (const { grade, indices, prior } of blocks) {
      const get = field => {
        const value = cells[indices[field]] || "";
        return isFlag(value) ? "" : value;
      };
      const explicitGrade = get("grade");
      const currentGrade = grade || gradeOf(explicitGrade) || prior.grade;
      if (explicitGrade && !gradeOf(explicitGrade) && isHeading(explicitGrade)) continue;
      if (gradeOf(explicitGrade) && prior.grade !== currentGrade) {
        Object.keys(prior).forEach(field => delete prior[field]);
        prior.grade = currentGrade;
      }
      if ([get("category"), get("track"), get("group"), get("s1"), get("s2"), get("nameKo"), get("nameEn")]
          .some(isHeading)) continue;
      const rawCategory = categoryOf(get("category"));
      if (rawCategory && rawCategory !== prior.category) {
        prior.track = "";
        prior.group = "";
      }
      if (rawCategory) prior.category = rawCategory;
      if (get("track")) prior.track = trackOf(get("track"));
      if (get("group")) prior.group = clean(get("group").split("\n")[0]);
      const base = { nameKo: get("nameKo"), nameEn: get("nameEn"), teacher: get("teacher") };
      const semesters = [1, 2].map(term => {
        const combined = cells[indices["s" + term]] || "";
        const included = /^(?:true|[o○✓✔v])$/i.test(combined);
        const subject = names(included ? "" : combined);
        if (/^(?:false|x|[-–—]|미개설|없음)$/i.test(combined)) return null;
        subject.nameKo = get("s" + term + "Ko") || subject.nameKo;
        subject.nameEn = get("s" + term + "En") || subject.nameEn;
        const hasSemesterColumns = Object.keys(indices).some(column => /^s[12](?:$|Ko|En)/.test(column));
        if (!subject.nameKo && !subject.nameEn && hasSemesterColumns && !included) return null;
        subject.teacher = get("s" + term + "Teacher") || base.teacher;
        subject.nameKo ||= base.nameKo;
        subject.nameEn ||= base.nameEn;
        return subject.nameKo || subject.nameEn ? subject : null;
      });
      if (!semesters.some(Boolean)) continue;
      const category = prior.category || section || "교과";
      const warn = message => warnings.push({ line, grade: currentGrade, message });
      const rawAmount = category === "창체" ? get("hours") || get("amount") || get("credits") : get("credits") || get("amount");
      const amount = optionalNumber(rawAmount, "학점 또는 시간", warn);
      const rawClassCount = optionalNumber(get("classCount"), "반 수", warn);
      const fractionalClassCount = rawClassCount && /^\d+(?:\.\d+)?$/.test(rawClassCount) && !/^\d+$/.test(rawClassCount);
      const classCount = fractionalClassCount ? String(Math.ceil(Number(rawClassCount))) : rawClassCount;
      const teacherLoadHours = optionalNumber(get("teacherLoadHours"), "교사시수", warn)
        || (fractionalClassCount && amount ? String(Number(rawClassCount) * Number(amount)) : "");
      const track = prior.track || (category === "창체" ? "공통" : "");
      const language = languageOf(get("language"));
      const error = !currentGrade || (explicitGrade && !gradeOf(explicitGrade)) ? "학년을 확인해 주세요."
        : !selectedGrades.includes(currentGrade) ? "선택한 학년 탭의 범위를 벗어났습니다."
        : !track || !prior.group ? "구분 또는 교과군이 비어 있습니다."
        : !language ? "수업 언어를 확인해 주세요." : "";
      if (error) errors.push({ line, grade: currentGrade, message: error });
      else {
        if (!rawAmount) warn("학점 또는 시간이 비어 있어 새 행에는 공란으로 저장됩니다.");
        if (fractionalClassCount) warnings.push({ line, grade: currentGrade, message: `원본 반 수 ${rawClassCount}를 운영 반 수 ${classCount}로 반올림하고 교사시수 ${teacherLoadHours || "미입력"}를 별도로 반영합니다.` });
        const reporting = reportingRequirements(get);
        entries.push({ line, grade: currentGrade, category, track, group: prior.group, language, credits: amount, classCount, classCountSource: rawClassCount, teacherLoadHours, reporting, semesterReporting: [reporting, reporting], semesters });
      }
    }
  }
  if (!foundHeader) errors.push({ message: "학년과 열 제목을 찾지 못했습니다. 엑셀에서 학년 및 열 제목까지 포함해 복사해 주세요." });
  else if (!entries.length && !errors.length) errors.push({ message: "생성할 과목이 없습니다." });
  return { entries, errors, warnings };
}

function sameSubject(a, b) {
  if (!a || !b) return false;
  return ["nameKo", "nameEn"].some(field => key(a[field]) && key(a[field]) === key(b[field]));
}

function matchesCard(template, entry, getSemester) {
  const namesOnly = (subject, existing) =>
    ["nameKo", "nameEn", "teacher"].every(field => !clean(subject[field])
      ? field !== "teacher" || !clean(existing[field]) : key(subject[field]) === key(existing[field]));
  const level = Number.parseInt(entry.grade, 10) <= 9 ? "중등" : "고등";
  return !template.isCompound && template.language === entry.language
    && (template.schoolLevel === level || template.schoolLevel === "공통")
    && entry.semesters.every((subject, i) => !subject || namesOnly(subject, getSemester(template, i)));
}

function compatibleSubjectNames(a, b) {
  return sameSubject(a, b) && ["nameKo", "nameEn"].every(field =>
    !key(a[field]) || !key(b[field]) || key(a[field]) === key(b[field]));
}

function sameImportedTeacher(subject, existing) {
  const names = value => clean(value).split(/[,，·]+/).map(key).filter(Boolean).sort().join(",");
  return names(subject?.teacher) === names(existing?.teacher || existing?.teacherNames?.join(", "));
}

export function planCurriculumPaste(entries, curriculum, templates, getSemester) {
  const byId = new Map(templates.map(template => [template.id, template]));
  const usage = new Map();
  const cardIds = row => [row.sem1TemplateId || null, row.sem2TemplateId || null];
  for (const boards of [curriculum.gradeBoards, curriculum.threeYear?.gradeBoards]) {
    for (const row of Object.values(boards || {}).flat()) {
      for (const id of new Set(cardIds(row).filter(Boolean))) usage.set(id, (usage.get(id) || 0) + 1);
    }
  }
  const pending = [];
  const rows = entries.map((entry, index) => {
    const sameTrack = row => ["category", "track"].every(field => key(row[field]) === key(entry[field]));
    const samePlacement = row => sameTrack(row) && key(row.group) === key(entry.group);
    const exact = (semesters, compare = sameSubject) => entry.semesters.every((subject, i) => subject
      ? compare(subject, semesters[i]) : !semesters[i]);
    const gradeRows = (curriculum.gradeBoards[entry.grade] || []).filter(sameTrack).map(row => {
      const ids = cardIds(row);
      return { row, ids, semesters: ids.map((id, i) => byId.has(id) ? getSemester(byId.get(id), i) : null) };
    });
    const placed = gradeRows.filter(({ row }) => samePlacement(row));
    const hasReports = entry.semesterReporting?.some(report => Object.keys(report || {}).length);
    const targetsFor = matches => hasReports
      ? matches.map(({ row, ids }) => ({ rowId: row.id, templateIds: ids })) : [];
    const sameTeachers = ({ semesters }) => entry.semesters.every((subject, i) =>
      !subject?.teacher || sameImportedTeacher(subject, semesters[i]));
    const otherGroupMatches = gradeRows.filter(match => !samePlacement(match.row)
      && exact(match.semesters, compatibleSubjectNames) && sameTeachers(match));
    const boardMatches = placed.filter(match => exact(match.semesters));
    if (boardMatches.length) {
      const nameMatches = boardMatches.filter(({ semesters }) => exact(semesters, compatibleSubjectNames));
      const matchingNames = nameMatches.length ? nameMatches : boardMatches;
      const teacherMatches = matchingNames.filter(sameTeachers);
      const candidates = teacherMatches.length ? teacherMatches : matchingNames;
      if (candidates.length !== 1) return { ...entry, status: "일치 후보 여러 개 · 건너뜀" };
      const [match] = candidates;
      // Older imports could append the same course under the source group.
      // Fill both rows when names and named teachers agree and the match is unique in each group.
      const duplicate = otherGroupMatches.length === 1 && nameMatches.includes(match) && sameTeachers(match)
        && entry.semesters.every(subject => !subject || subject.teacher) ? otherGroupMatches : [];
      const reportTargets = targetsFor([match, ...duplicate]);
      const safe = match.ids.filter(Boolean).every(id => usage.get(id) === 1 && !byId.get(id)?.sharedCardId && !byId.get(id)?.isCompound);
      if (!safe) return { ...entry, reportTargets, status: reportTargets.length ? "공유·복합 카드 · 성적표 보완" : "공유·복합 카드 · 기존 값 유지" };
      const teacherChanges = entry.semesters.map((subject, i) =>
        subject?.teacher && !sameImportedTeacher(subject, match.semesters[i]) ? subject.teacher : "");
      return { ...entry, status: "기존 행", existingIds: match.ids, teacherChanges, previousSemesters: match.semesters, reportTargets };
    }
    if (placed.some(({ semesters }) => entry.semesters.some((subject, i) => sameSubject(subject, semesters[i])))) {
      return { ...entry, status: "한 학기만 일치 · 건너뜀" };
    }
    if (otherGroupMatches.length) {
      if (otherGroupMatches.length !== 1) return { ...entry, status: "다른 교과군에 일치 후보 여러 개 · 건너뜀" };
      const reportTargets = targetsFor(otherGroupMatches);
      return { ...entry, reportTargets, status: reportTargets.length ? "기존 교과군 유지 · 성적표 보완" : "기존 교과군 유지" };
    }
    if (pending.some(row => row.grade === entry.grade && samePlacement(row) && exact(row.semesters) &&
      row.semesters.every((subject, i) => key(subject?.teacher) === key(entry.semesters[i]?.teacher)))) {
      return { ...entry, status: "붙여넣기 내 중복" };
    }
    pending.push(entry);
    const hasMetadata = entry.classCount || entry.teacherLoadHours || hasReports;
    const matches = hasMetadata ? [] : templates.filter(template => matchesCard(template, entry, getSemester));
    return {
      ...entry, status: "추가", templateId: matches.length === 1 ? matches[0].id : null,
      newCardKey: index,
    };
  });
  const claimed = new Map(), claimedReports = new Map();
  const reportKey = (row, target) => JSON.stringify([row.grade, target.rowId]);
  for (const row of rows) {
    for (const id of new Set(row.existingIds?.filter(Boolean))) claimed.set(id, (claimed.get(id) || 0) + 1);
    for (const target of row.reportTargets || []) {
      const claim = reportKey(row, target);
      claimedReports.set(claim, (claimedReports.get(claim) || 0) + 1);
    }
  }
  return rows.map(row => {
    const reportTargets = row.reportTargets?.filter(target => claimedReports.get(reportKey(row, target)) === 1);
    if (row.existingIds?.some(id => claimed.get(id) > 1)) {
      return { ...row, reportTargets, existingIds: null, status: reportTargets?.length ? "같은 기존 카드 · 성적표 보완" : "같은 기존 카드 · 건너뜀" };
    }
    if (!reportTargets || reportTargets.length === row.reportTargets.length) return row;
    const status = reportTargets.length ? row.status : "같은 기존 행의 성적표 후보 여러 개 · 성적표 건너뜀";
    return { ...row, reportTargets, status };
  });
}

export function replaceImportedTeachers(template, names) {
  // Reset old identity snapshots before resolving the imported names.
  const [first, second] = names;
  const sharedTeacher = first === second;
  template.teacher = sharedTeacher ? first : "";
  template.sem1Teacher = sharedTeacher ? "" : first;
  template.sem2Teacher = sharedTeacher ? "" : second;
  for (const prefix of ["", "sem1", "sem2"]) {
    template[prefix ? `${prefix}TeacherIds` : "teacherIds"] = [];
    template[prefix ? `${prefix}TeacherNames` : "teacherNames"] = [];
  }
  template.useSemesterOverrides = !sharedTeacher ||
    ["sem1NameKo", "sem1NameEn", "sem2NameKo", "sem2NameEn"].some(field => clean(template[field]));
}

export function curriculumPasteTemplate(entry) {
  const [first, second] = entry.semesters;
  const base = first || second;
  const separate = first && second && ["nameKo", "nameEn", "teacher"].some(field => first[field] !== second[field]);
  return {
    nameKo: separate && !second.nameKo ? "" : base.nameKo,
    nameEn: separate && !second.nameEn ? "" : base.nameEn,
    teacher: separate ? "" : base.teacher,
    language: entry.language, schoolLevel: Number.parseInt(entry.grade, 10) <= 9 ? "중등" : "고등",
    reportingRequirements: entry.reporting || {},
    sem1ReportingRequirements: entry.semesterReporting?.[0] || entry.reporting || {},
    sem2ReportingRequirements: entry.semesterReporting?.[1] || entry.reporting || {},
    ...(separate && {
      useSemesterOverrides: true,
      sem1NameKo: first.nameKo, sem1NameEn: first.nameEn, sem1Teacher: first.teacher,
      sem2NameKo: second.nameKo, sem2NameEn: second.nameEn, sem2Teacher: second.teacher,
    }),
  };
}
