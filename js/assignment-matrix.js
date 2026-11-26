import { buildReadOnlyCurriculumRows } from "./curriculum-read-view.js?v=r451-inline";
import { facultyCourseWorkload } from "./faculty-workload.js?v=r434";
import { isChanCheCategory } from "./utils.js?v=2026-07-15-room-availability-separation-r355";

const format = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
const hoursLabel = value => Number.isFinite(value) ? format.format(value) : "—";
const teacherKey = ({ id, name }) => id ? "id:" + id : "name:" + name.normalize("NFKC").trim().toLowerCase();

const differs = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 1e-8;

export function assignmentHourDifferences(row, subject) {
  const { credits, boardHours } = row;
  const { classCount, total } = subject;
  const creative = isChanCheCategory(row.category);
  const inputTotal = !creative && Number.isFinite(boardHours) && Number.isFinite(classCount) ? boardHours * classCount : null;
  const calculatedTotal = Number.isFinite(credits) && Number.isFinite(classCount) ? credits * classCount : null;
  const teacherHours = subject.jointLesson ? subject.jointLesson.hours : subject.teacherTotal;
  return {
    credits: !creative && differs(boardHours, credits)
      ? "입력 시수 " + hoursLabel(boardHours) + " · 계산에 적용된 시수 " + hoursLabel(credits) : "",
    course: differs(calculatedTotal, total)
      ? "계산 기준 총시수 " + hoursLabel(calculatedTotal) + " · 표시 총시수 " + hoursLabel(total)
      : differs(inputTotal, total) ? "입력 시수 × 학급수 " + hoursLabel(inputTotal) + " · 표시 총시수 " + hoursLabel(total) : "",
    teacher: subject.jointLesson && creative
      ? (subject.hasTeacherOverride && differs(subject.teacherTotal, teacherHours)
        ? "입력 교사시수 " + hoursLabel(subject.teacherTotal) + " · 합동수업 적용 시수 " + hoursLabel(teacherHours) : "")
      : differs(teacherHours, total)
        ? (subject.jointLesson ? "합동수업 교사시수 " : "교사시수 ") + hoursLabel(teacherHours) +
          " · 과목 총시수 " + hoursLabel(total) : ""
  };
}

export function summarizeMatrix(rows, term) {
  const teachers = new Map();
  const courses = [];
  for (const row of rows) {
    const subject = row[term];
    if (!subject) continue;
    const cells = new Map();
    for (const teacher of subject.teachers) {
      const key = teacherKey(teacher);
      if (cells.has(key)) continue;
      if (!teachers.has(key)) teachers.set(key, { key, name: teacher.name, hours: 0, count: 0, missing: 0, joint: new Set() });
      const summary = teachers.get(key);
      const lesson = subject.jointLesson;
      if (lesson && summary.joint.has(lesson.id)) {
        cells.set(key, { shared: true });
        continue;
      }
      if (lesson) summary.joint.add(lesson.id);
      const hours = lesson ? lesson.hours : subject.teacherTotal;
      summary.count++;
      if (Number.isFinite(hours)) summary.hours += hours;
      else summary.missing++;
      cells.set(key, { hours });
    }
    courses.push({ row, subject, cells, differences: assignmentHourDifferences(row, subject) });
  }
  return { courses, teachers: [...teachers.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")) };
}

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function flagDifference(cell, message) {
  if (!message) return;
  cell.classList.add("assignment-hours-difference");
  cell.title = message;
  const input = cell.querySelector("input");
  if (input) {
    input.title = message + " · " + input.title;
    input.setAttribute("aria-description", message);
  } else cell.setAttribute("aria-description", message);
}

function assignmentMatrixRows(data, teachers) {
  return buildReadOnlyCurriculumRows(data.curriculum, data.templates.templates, teachers.teachers, (id, credits) => {
    const roster = data.rosters.rosters?.[id];
    const meta = data.rosters.rosterMeta?.[id];
    const input = String(meta?.teacherLoadHours ?? "").trim();
    return {
      ...facultyCourseWorkload(meta, credits),
      hasTeacherOverride: /^\d+(?:\.\d+)?$/.test(input) && Number.isFinite(Number(input)),
      students: Array.isArray(roster) ? new Set(roster.map(item => item.classId + ":" + item.studentId)).size : null
    };
  });
}

export function assignmentHourIssues(data, teachers, { keys, term, grade } = {}) {
  const fields = { credits: "시수", course: "총시수", teacher: "교사시수" };
  return assignmentMatrixRows(data, teachers)
    .filter(row => (!keys || keys.has(row.grade + ":" + row.id)) && (!grade || row.grade === grade))
    .flatMap(row => (term ? [term] : ["sem1", "sem2"]).flatMap(semester => {
      const subject = row[semester];
      if (!subject) return [];
      return Object.entries(assignmentHourDifferences(row, subject))
        .filter(([, message]) => message)
        .map(([field, message]) => [row.grade, subject.name || subject.english, semester === "sem1" ? "1학기" : "2학기", fields[field], message]);
    }));
}

export function renderAssignmentMatrix(data, teachers, { term, grade, query, field, details = false, onCounts = () => {} }) {
  const needle = query.trim().toLocaleLowerCase();
  const rows = assignmentMatrixRows(data, teachers).filter(row => (!grade || row.grade === grade) && (!needle ||
      [row.grade, row.group, row.track, row[term]?.name, row[term]?.english, ...(row[term]?.teachers.map(t => t.name) || [])]
      .join(" ").toLocaleLowerCase().includes(needle)));
  const matrix = summarizeMatrix(rows, term);
  const panel = node("div");
  const warnings = matrix.courses.filter(course => Object.values(course.differences).some(Boolean)).length;
  onCounts(matrix.courses.length, matrix.teachers.length, warnings);
  if (!matrix.courses.length) {
    panel.append(node("p", "표시할 수업이 없습니다."));
    return panel;
  }

  const wrap = node("div", undefined, "assignment-matrix-scroll");
  wrap.tabIndex = 0;
  wrap.setAttribute("aria-label", "과목별·교사별 수업배정표");
  const detailColumns = details ? [
    ["범주", 46, "category"], ["구분", 50, "track"],
    ["교과군", 64, "group"], ["언어", 58, term + ".language"]
  ] : [];
  const columns = [
    ["학년", 42], ["국문 과목명", 155], ["영문 과목명", 155], ...detailColumns, ["시수/시간", 56], ["학급수", 40],
    ["총시수", 47], ["학생수", 42], ["담당교사", 94], ["교사수", 40]
  ];
  const teacherWidth = 46;
  const table = node("table", undefined, "assignment-matrix");
  const colgroup = node("colgroup");
  const widths = [...columns.map(([, width]) => width), ...matrix.teachers.map(() => teacherWidth)];
  for (const width of widths) {
    const col = node("col");
    col.style.width = width + "px";
    colgroup.append(col);
  }
  table.style.width = widths.reduce((sum, width) => sum + width, 0) + "px";
  table.style.setProperty("--assignment-grade-width", columns[0][1] + "px");
  table.append(colgroup);
  const header = table.createTHead().insertRow();
  for (const [label] of columns) {
    const cell = node("th", label);
    cell.scope = "col";
    header.append(cell);
  }
  for (const teacher of matrix.teachers) {
    const cell = node("th", undefined, "assignment-teacher-head");
    cell.scope = "col";
    const total = teacher.count === teacher.missing ? "미설정" : format.format(teacher.hours) + " 시수";
    cell.title = teacher.name + " · " + total + " · " + teacher.count + "개 수업" +
      (teacher.missing ? " · 미설정 " + teacher.missing : "");
    cell.append(node("span", teacher.name),
      node("strong", (teacher.count === teacher.missing ? "—" : format.format(teacher.hours)) +
        " / " + teacher.count + (teacher.missing ? "*" : "")));
    header.append(cell);
  }

  const body = table.createTBody();
  let previousGrade;
  for (const { row, subject, cells, differences } of matrix.courses) {
    const tr = body.insertRow();
    tr.dataset.grade = String(parseInt(row.grade, 10));
    if (row.grade !== previousGrade) tr.classList.add("assignment-grade-start");
    previousGrade = row.grade;
    const gradeCell = tr.insertCell();
    gradeCell.textContent = row.grade;
    const subjectCell = node("th");
    subjectCell.scope = "row";
    const rowKey = row.grade + ":" + row.id;
    const name = field(rowKey, term + ".nameKo");
    const note = [subject.english, row.category, row.track, row.group, subject.language, subject.jointLesson?.name]
      .filter(Boolean).join(" · ");
    if (note) name.title += " · " + note;
    subjectCell.append(name);
    if (subject.jointLesson?.name) {
      gradeCell.textContent = row.grade.replace("학년", "") + "·합";
      gradeCell.title = row.grade + " · 합동수업 · " + subject.jointLesson.name;
    }
    tr.append(subjectCell);
    const english = tr.insertCell();
    english.className = "assignment-english-name";
    english.append(field(rowKey, term + ".nameEn"));
    for (const [, , key] of detailColumns) tr.insertCell().append(field(rowKey, key));
    const creditsCell = tr.insertCell();
    const credit = field(rowKey, "credits");
    const creative = isChanCheCategory(row.category);
    if (creative) {
      creditsCell.classList.add("assignment-creative-time");
      credit.title = "창체 시간 · 시간표 적용 시수 " + hoursLabel(row.credits);
      credit.setAttribute("aria-label", row.grade + " " + (subject.name || subject.english) + " 창체 시간");
    }
    creditsCell.append(credit);
    if (creative) creditsCell.append(node("span", "시간", "assignment-time-unit"));
    flagDifference(creditsCell, differences.credits);
    tr.insertCell().append(field(rowKey, term + ".classCount"));
    const courseHours = tr.insertCell();
    courseHours.textContent = hoursLabel(subject.total);
    courseHours.className = "assignment-course-hours";
    flagDifference(courseHours, differences.course);
    tr.insertCell().textContent = hoursLabel(subject.students);
    const assigned = tr.insertCell();
    assigned.className = "assignment-teacher-names";
    if (subject.compound) assigned.textContent = subject.teachers.map(teacher => teacher.name).join(", ") || "—";
    else assigned.append(field(rowKey, term + ".teacher"));
    tr.insertCell().textContent = hoursLabel(cells.size);
    for (const { key } of matrix.teachers) {
      const cell = tr.insertCell();
      const value = cells.get(key);
      if (!value) continue;
      const known = Number.isFinite(value.hours);
      cell.className = value.shared || !known ? "assignment-hours-muted" : "assignment-hours-filled";
      if (subject.jointLesson) cell.textContent = value.shared ? "합동" : hoursLabel(value.hours);
      else cell.append(field(rowKey, term + ".teacherLoadHours", known ? hoursLabel(value.hours) : "미설정"));
      flagDifference(cell, differences.teacher);
    }
  }
  wrap.append(table);
  panel.append(wrap);
  return panel;
}
