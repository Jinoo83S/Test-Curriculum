// Analyze Excel clipboard TSV without touching the current curriculum.
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
  if (/^(한글.*|국문.*|nameko|koreanname)$/.test(label)) return "nameKo";
  if (/^(영문.*|영어명.*|nameen|englishname)$/.test(label)) return "nameEn";
  if (/^(교사|teacher)$/.test(label)) return "teacher";
  if (/^(학점|credits?|학점credits?)$/.test(label)) return "credits";
  if (/^(시간|hours?|시간hours?)$/.test(label)) return "hours";
  if (/^(시수|수업시수|학점시수|시수학점)$/.test(label)) return "amount";
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

const REPORT_FIELDS = ["reportRawScore", "reportAverage", "reportStandardDeviation", "reportAchievementLevels", "reportEnrollmentCount", "reportRanking"];
function reportingRequirements(get) {
  return Object.fromEntries(REPORT_FIELDS.map(field => [field, clean(get(field))]).filter(([, value]) => value));
}

function nthIndex(values, target, occurrence = 0) {
  let seen = 0;
  for (let index = 0; index < values.length; index++) {
    if (values[index] !== target) continue;
    if (seen === occurrence) return index;
    seen++;
  }
  return -1;
}

function readHeader(cells, grades, priorBlocks) {
  const columns = cells.map(columnType);
  const flat = columns.includes("grade");
  const starts = columns.flatMap((column, i) => column === "track" ? [i] : []);
  const semesterStarts = columns.flatMap((column, i) => column === "s1" || column === "s1Ko" ? [i] : []);
  if (!columns.some(column => ["amount", "credits", "hours"].includes(column))
      || !(semesterStarts.length || columns.includes("nameKo") || columns.includes("nameEn") || columns.includes("s2"))) return null;
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

function analyzeSchoolSheet(rows, selectedGrades) {
  const entries = [], errors = [], warnings = [];
  const headerTypes = rows[0]?.cells.map(columnType) || [];
  const headerLabels = rows[0]?.cells.map(headerKey) || [];
  const classCountIndex = headerTypes.indexOf("classCount");
  for (const { cells, line } of rows.slice(1)) {
    const grade = gradeOf(cells[0]);
    if (!grade || !selectedGrades.includes(grade)) continue;
    const category = /^창의적\s*체험활동/.test(clean(cells[1])) ? "창체" : categoryOf(cells[1]);
    const track = trackOf(cells[3]);
    const group = clean(cells[4]);
    const language = languageOf(cells[9]);
    const credits = clean(cells[11]);
    const classCount = classCountIndex >= 0 ? clean(cells[classCountIndex]) : "";
    const semesters = [0, 1].map(index => {
      const nameKo = clean(cells[index === 0 ? 5 : 7]);
      const nameEn = clean(cells[index === 0 ? 6 : 8]);
      const firstTeacherIndex = index === 0 ? 16 : 19;
      const names = cells.slice(firstTeacherIndex, firstTeacherIndex + 3).map(clean).filter(Boolean);
      return nameKo || nameEn ? { nameKo, nameEn, teacher: [...new Set(names)].join(", ") } : null;
    });
    const fractionalClassCount = classCount && /^\d+(?:\.\d+)?$/.test(classCount) && !/^\d+$/.test(classCount);
    const error = !["교과", "창체"].includes(category) ? "범주를 확인해 주세요."
      : !track || !group ? "구분 또는 교과군이 비어 있습니다."
      : !language ? "수업 언어를 확인해 주세요."
      : credits && !/^\d+(?:\.\d+)?$/.test(credits) ? "학급별 시수를 숫자로 입력해 주세요."
      : classCount && !/^\d+(?:\.\d+)?$/.test(classCount) ? "반 수를 숫자로 입력해 주세요."
      : !semesters.some(Boolean) ? "과목명을 확인해 주세요." : "";
    if (error) errors.push({ line, grade, message: error });
    else {
      if (!credits) warnings.push({ line, grade, message: "학급별 시수가 비어 있어 공란으로 저장됩니다." });
      if (fractionalClassCount) warnings.push({ line, grade, message: `반 수 ${classCount}는 정수가 아니므로 과목 설정 반 수 반영에서만 제외됩니다.` });
      const semesterReporting = [0, 1].map(term => {
        const values = reportingRequirements(field => { const index = nthIndex(headerTypes, field, term); return index >= 0 ? cells[index] : ""; });
        const categoryIndex = nthIndex(headerLabels, "구분category", term);
        if (categoryIndex >= 0 && clean(cells[categoryIndex])) values.reportCategory = clean(cells[categoryIndex]);
        return values;
      });
      const reporting = semesterReporting[0];
      entries.push({ line, grade, category, track, group, language, credits, classCount, reporting, semesterReporting, semesters });
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
      if (header.some(({ indices }) => !["amount", "credits", "hours"].some(column => indices[column] !== undefined)
          || !["nameKo", "nameEn", "s1", "s1Ko", "s1En", "s2", "s2Ko", "s2En"].some(column => indices[column] !== undefined))) {
        errors.push({ line, message: "학년별 과목명과 학점 또는 시간 열을 모두 포함해 다시 복사해 주세요." });
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
      const amount = category === "창체" ? get("hours") || get("amount") || get("credits") : get("credits") || get("amount");
      const classCount = get("classCount");
      const track = prior.track || (category === "창체" ? "공통" : "");
      const language = languageOf(get("language"));
      const fractionalClassCount = classCount && /^\d+(?:\.\d+)?$/.test(classCount) && !/^\d+$/.test(classCount);
      const error = !currentGrade || (explicitGrade && !gradeOf(explicitGrade)) ? "학년을 확인해 주세요."
        : !selectedGrades.includes(currentGrade) ? "선택한 학년 탭의 범위를 벗어났습니다."
        : !track || !prior.group ? "구분 또는 교과군이 비어 있습니다."
        : !language ? "수업 언어를 확인해 주세요."
        : amount && !/^\d+(?:\.\d+)?$/.test(amount) ? "학점 또는 시간을 숫자로 입력해 주세요."
        : classCount && !/^\d+(?:\.\d+)?$/.test(classCount) ? "반 수를 숫자로 입력해 주세요." : "";
      if (error) errors.push({ line, grade: currentGrade, message: error });
      else {
        if (!amount) warnings.push({ line, grade: currentGrade, message: "학점 또는 시간이 비어 있어 공란으로 저장됩니다." });
        if (fractionalClassCount) warnings.push({ line, grade: currentGrade, message: `반 수 ${classCount}는 정수가 아니므로 과목 설정 반 수 반영에서만 제외됩니다.` });
        const reporting = reportingRequirements(get);
        entries.push({ line, grade: currentGrade, category, track, group: prior.group, language, credits: amount, classCount, reporting, semesterReporting: [reporting, reporting], semesters });
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

export function planCurriculumPaste(entries, curriculum, templates, getSemester) {
  const byId = new Map(templates.map(template => [template.id, template]));
  const pending = [];
  return entries.map(entry => {
    const samePlacement = row => ["category", "track", "group"].every(field => key(row[field]) === key(entry[field]));
    const overlaps = semesters => entry.semesters.some((subject, i) => sameSubject(subject, semesters[i]));
    const inBoard = (curriculum.gradeBoards[entry.grade] || []).find(row =>
      samePlacement(row) && overlaps([row.sem1TemplateId, row.sem2TemplateId].map((id, index) => getSemester(byId.get(id), index))));
    if (inBoard) {
      const ids = [inBoard.sem1TemplateId, inBoard.sem2TemplateId].filter(Boolean);
      const matchedId = [inBoard.sem1TemplateId, inBoard.sem2TemplateId].find((id, index) =>
        id && sameSubject(entry.semesters[index], getSemester(byId.get(id), index)));
      return { ...entry, status: "기존 행과 중복", templateId: matchedId || ids[0] || null };
    }
    const pendingMatch = pending.find(row => row.grade === entry.grade && samePlacement(row) && overlaps(row.semesters));
    if (pendingMatch) {
      return { ...entry, status: "붙여넣기 내 중복", newCardKey: JSON.stringify(curriculumPasteTemplate(pendingMatch)) };
    }
    pending.push(entry);
    const matches = templates.filter(template => matchesCard(template, entry, getSemester));
    return {
      ...entry, status: "추가", templateId: matches.length === 1 ? matches[0].id : null,
      newCardKey: JSON.stringify(curriculumPasteTemplate(entry)),
    };
  });
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
