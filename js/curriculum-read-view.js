import { buildTeacherIdentityIndex, normalizeTeacherAssignment, teacherNameById } from "./teacher-identity.js?v=2026-07-15-room-availability-separation-r355";
import { assignedTeachers } from "./teacher-year-directory.js?v=r433";
import { getEffectiveCredit, parseCreditValue } from "./utils.js?v=2026-07-15-room-availability-separation-r355";
import { getCurriculumCalculationGroup, getCurriculumSemesterTitles, summarizeAcademicCourses } from "./curriculum-academic-summary.js?v=r442";
import { JOINT_LESSON_TERMS, indexJointLessons, jointLessonRowKey } from "./joint-lessons.js?v=r451";

const text = value => String(value ?? "").trim();
const key = value => text(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();

export function buildReadOnlyCurriculumRows(curriculum, templates, teachers = [], workload) {
  const cards = new Map(templates.map(card => [card.id, card]));
  const jointLessons = indexJointLessons(curriculum, cards);
  const index = buildTeacherIdentityIndex(teachers);
  const semester = (row, term, rowKey) => {
    const id = row[term + "TemplateId"];
    const card = cards.get(id);
    if (!card) return null;
    const identity = normalizeTeacherAssignment(assignedTeachers(card, term), index);
    const teachers = identity.ids.map(id => ({ name: teacherNameById(index, id), id })).filter(entry => entry.name);
    const matched = new Set(teachers.map(entry => key(entry.name)));
    const credits = getEffectiveCredit(row);
    return {
      ...getCurriculumSemesterTitles(card, term),
      language: text(card.language),
      compound: Boolean(card.isCompound),
      teachers: [...teachers, ...identity.names.filter(name => !matched.has(key(name))).map(name => ({ name, id: "" }))],
      ...workload?.(id, credits, term),
      jointLesson: jointLessons[term].get(rowKey),
    };
  };
  return Object.entries(curriculum?.gradeBoards || {}).sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
    .flatMap(([grade, rows]) => (Array.isArray(rows) ? rows : []).flatMap(row => {
      const rowKey = jointLessonRowKey(grade, row.id);
      const sem1 = semester(row, "sem1", rowKey), sem2 = semester(row, "sem2", rowKey);
      const calcGroupId = getCurriculumCalculationGroup([cards.get(row.sem1TemplateId), cards.get(row.sem2TemplateId)]);
      return sem1 || sem2 ? [{ id: row.id, grade, category: row.category, track: row.track, group: row.group,
        calcGroupId, academicGroupId: row.academicGroupId, academicGroupCredits: row.academicGroupCredits,
        credits: getEffectiveCredit(row), boardHours: parseCreditValue(row.credits), sem1, sem2 }] : [];
    }));
}

export function summarizeCurriculumGrades(rows, templateGroups = []) {
  const groups = new Map(templateGroups.map(group => [group.id, group.creditValue]));
  const byGrade = new Map();
  for (const row of rows) {
    if (key(row.category) !== "교과") continue;
    if (!byGrade.has(row.grade)) byGrade.set(row.grade, []);
    byGrade.get(row.grade).push(row);
  }
  return new Map([...byGrade].map(([grade, gradeRows]) => {
    const { totalCourses, totalCredits } = summarizeAcademicCourses(gradeRows, id => groups.get(id));
    return [grade, { courses: totalCourses, credits: totalCredits }];
  }));
}

export function groupTeacherAssignments(rows, term, currentTeacher) {
  const names = new Set([currentTeacher?.name, ...(Array.isArray(currentTeacher?.aliases) ? currentTeacher.aliases : [])]
    .map(key).filter(Boolean));
  const groups = new Map();
  for (const row of rows) {
    const assigned = new Map();
    for (const semester of term ? [term] : ["sem1", "sem2"]) {
      const subject = row[semester];
      if (!subject) continue;
      const teachers = subject.teachers.length ? subject.teachers : [{ name: "", id: "" }];
      for (const teacher of teachers) {
        const groupKey = teacher.id ? `id:${teacher.id}` : `name:${key(teacher.name)}`;
        if (!assigned.has(groupKey)) assigned.set(groupKey, { teacher, row: { ...row, sem1: null, sem2: null } });
        const entry = assigned.get(groupKey).row;
        entry[semester] = subject;
        if (term) entry.subject = subject;
      }
    }
    for (const [groupKey, { teacher, row }] of assigned) {
      if (!groups.has(groupKey)) groups.set(groupKey, {
        key: groupKey,
        name: teacher.name,
        own: !!(currentTeacher && (teacher.id ? teacher.id === currentTeacher.id : names.has(key(teacher.name)))),
        rows: [],
      });
      groups.get(groupKey).rows.push(row);
    }
  }
  for (const group of groups.values()) group.rows = combineJointAssignments(group.rows, term);
  return [...groups.values()].sort((a, b) =>
    Number(b.own) - Number(a.own) || Number(!a.name) - Number(!b.name) || a.name.localeCompare(b.name, "ko"));
}

function combineJointAssignments(rows, selectedTerm) {
  const jointRows = new Map();
  const output = [];
  for (const row of rows) {
    const ordinary = { ...row };
    for (const term of selectedTerm ? [selectedTerm] : JOINT_LESSON_TERMS) {
      const subject = row[term];
      const lesson = subject?.jointLesson;
      if (!lesson) continue;
      if (!jointRows.has(lesson.id)) {
        const joint = { grade: "", category: "합동수업", credits: "", sem1: null, sem2: null, joint: true, grades: new Set(), subjects: new Set() };
        jointRows.set(lesson.id, joint);
        output.push(joint);
      }
      const joint = jointRows.get(lesson.id);
      for (const grade of lesson.grades) joint.grades.add(grade);
      for (const name of [subject.name, subject.english].filter(Boolean)) joint.subjects.add(name);
      joint[term] ||= { name: lesson.name, total: lesson.hours, teacherTotal: lesson.hours };
      if (selectedTerm) joint.subject = joint[term];
      ordinary[term] = null;
    }
    if (ordinary.sem1 || ordinary.sem2) output.push(ordinary);
  }
  for (const joint of jointRows.values()) {
    joint.grade = [...joint.grades].map(grade => parseInt(grade, 10)).sort((a, b) => a - b).join("·") + "학년";
    joint.subjects = [...joint.subjects];
    delete joint.grades;
  }
  return output;
}

const create = (tag, label = "") => {
  const node = document.createElement(tag);
  node.textContent = label;
  return node;
};
const small = label => create("small", label);
function teacherSemesterSummary(group, term) {
  const subjects = group.rows.map(row => row[term]).filter(Boolean);
  const known = subjects.map(subject => subject.teacherTotal).filter(Number.isFinite);
  return {
    total: known.length ? Number(known.reduce((sum, hours) => sum + hours, 0).toFixed(8)) : null,
    missing: subjects.length - known.length,
  };
}

export function teacherSemesterTotal(group, term) {
  const { total, missing } = teacherSemesterSummary(group, term);
  return missing ? null : total;
}

function makeTable(labels) {
  const table = create("table");
  table.className = "faculty-curriculum-table";
  const row = table.createTHead().insertRow();
  for (const label of labels) {
    const th = create("th", label);
    th.scope = "col";
    row.append(th);
  }
  const wrap = create("div");
  wrap.className = "faculty-table-wrap";
  wrap.append(table);
  return { table, wrap };
}

export function renderTeacherAssignmentTable(groups, { language = "ko", workload = false } = {}) {
  const en = language === "en";
  const { table, wrap } = makeTable(en
    ? ["Grade", "Category", "Semester 1 · NEIS", "Semester 2 · NEIS", "Hours / class", ...(workload ? ["Classes", "Course hours"] : [])]
    : ["학년", "범주", "1학기 과목명 (NEIS)", "2학기 과목명 (NEIS)", "학급별 시수", ...(workload ? ["학급 수", "과목별 총 시수"] : [])]);
  const width = workload ? 7 : 5;
  for (const group of groups) {
    const body = table.createTBody();
    body.className = group.own ? "faculty-teacher-group own" : "faculty-teacher-group";
    const header = create("th");
    header.scope = "rowgroup";
    header.colSpan = width;
    header.append(create("strong", group.name || (en ? "Unassigned" : "미배정")));
    if (group.own) {
      const label = create("span", en ? "My courses" : "내 담당");
      label.className = "faculty-own-badge";
      header.append(label);
    }
    const summary = en ? `${group.rows.length} courses` : `${group.rows.length}과목`;
    header.append(small(summary));
    if (workload) {
      const totals = ["sem1", "sem2"].map((term, index) => {
        const { total, missing } = teacherSemesterSummary(group, term);
        const status = missing ? (en ? ` (${missing} unset)` : ` (미설정 ${missing}과목)`) : "";
        return `${en ? `S${index + 1}` : `${index + 1}학기`} ${total ?? "—"}${status}`;
      });
      const badge = create("span", `${en ? "Teaching hours" : "교사 시수"} · ${totals.join(" / ")}`);
      badge.className = "faculty-workload-badge";
      header.append(badge);
    }
    body.insertRow().append(header);
    for (const { grade, category, credits, sem1, sem2, joint } of group.rows) {
      const row = body.insertRow();
      row.insertCell().textContent = grade;
      row.insertCell().textContent = joint && en ? "Joint lesson" : category;
      appendCourse(row.insertCell(), sem1);
      appendCourse(row.insertCell(), sem2);
      row.insertCell().textContent = credits || "—";
      if (workload) {
        for (const field of ["classCount", "total"]) {
          const first = sem1?.[field], second = sem2?.[field];
          row.insertCell().textContent = sem1 && sem2 && first !== second
            ? `${first ?? "—"} / ${second ?? "—"}` : first ?? second ?? "—";
        }
      }
    }
  }
  return wrap;
}

function appendCourse(cell, subject, includeTeacher = false) {
  cell.className = "faculty-course-cell";
  if (["Korean", "English", "Both"].includes(subject?.language)) cell.dataset.language = subject.language;
  cell.append(create("strong", subject?.name || "—"));
  if (subject?.english && subject.english !== subject.name) {
    cell.append(small(includeTeacher ? subject.english : ` · ${subject.english}`));
  }
  if (includeTeacher && subject?.teachers.length) {
    const teacher = small(subject.teachers.map(item => item.name).join(", "));
    teacher.className = "faculty-course-teacher";
    cell.append(teacher);
  }
}

export function renderAnnualCurriculumTable(rows, language = "ko", grades = [...new Set(rows.map(row => row.grade))], summaries = summarizeCurriculumGrades(rows)) {
  const en = language === "en";
  const { table, wrap } = makeTable([]);
  table.classList.add("faculty-annual-board");
  for (const _grade of grades) {
    const columns = create("colgroup");
    for (const width of [52, 62, null, null, 62]) {
      const col = create("col");
      if (width !== null) col.style.width = `${width}px`;
      columns.append(col);
    }
    table.insertBefore(columns, table.tHead);
  }
  const head = table.tHead.rows[0];
  const subhead = table.tHead.insertRow();
  for (const grade of grades) {
    const label = create("th");
    const { courses = 0, credits = 0 } = summaries.get(grade) || {};
    label.append(create("strong", en ? `Grade ${parseInt(grade, 10)}` : grade));
    const totals = create("span", en
      ? `${courses} courses · ${credits} credits`
      : `${courses}과목 · ${credits}이수단위`);
    totals.className = "faculty-grade-totals";
    label.append(totals);
    label.colSpan = 5;
    label.scope = "colgroup";
    head.append(label);
    (en ? ["Track", "Area", "Semester 1", "Semester 2", "Credits"] : ["구분", "교과군", "1학기", "2학기", "이수단위"])
      .forEach((name, index) => {
        const th = create("th", name);
        th.scope = "col";
        th.classList.toggle("faculty-grade-start", index === 0);
        subhead.append(th);
      });
  }
  const body = table.createTBody();
  const categories = [...new Set(rows.map(row => row.category))];
  for (const category of categories) {
    const section = create("th", category || (en ? "Other" : "기타"));
    section.colSpan = grades.length * 5;
    section.className = "faculty-board-category";
    body.insertRow().append(section);
    const categoryRows = rows.filter(row => row.category === category);
    for (const track of new Set(categoryRows.map(row => row.track))) {
      const byGrade = grades.map(grade => categoryRows.filter(row => row.grade === grade && row.track === track));
      const count = Math.max(...byGrade.map(items => items.length), 0);
      for (let position = 0; position < count; position++) {
        const row = body.insertRow();
        if (position === 0) row.className = "faculty-track-start";
        for (const items of byGrade) {
          const item = items[position];
          const cell = row.insertCell();
          cell.className = "faculty-grade-start";
          if (!item) { cell.colSpan = 5; cell.classList.add("faculty-board-blank"); continue; }
          cell.textContent = item.track || "—";
          row.insertCell().textContent = item.group || "—";
          appendCourse(row.insertCell(), item.sem1, true);
          appendCourse(row.insertCell(), item.sem2, true);
          const amount = row.insertCell();
          amount.className = "faculty-board-credit";
          amount.textContent = item.boardHours
            ? key(category) === "창체" ? `${item.boardHours} ${en ? "hrs" : "시간"}` : item.boardHours
            : "—";
        }
      }
    }
  }
  return wrap;
}
